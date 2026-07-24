// 輕量級戰鬥解析引擎 (純 TS)
import { type BattleShipView, type BattleFleetView, type BattleInfoView } from './state';

// ── 戰鬥評級預測 ──────────────────────────────────────────────
// clean-room 重寫，依公開文件化的艦これ勝利判定規則（inspired by KC3Kai, MIT）。
// 損害率 = (戰鬥開始時殘HP合計 − 現在殘HP合計) / 戰鬥開始時殘HP合計
// 判定由上而下：
//   1. 敵全滅 + 我方無轟沈                        → S（無傷即遊戲的「完全勝利」，但 api_win_rank 同為 S）
//   2. 敵全滅（但我方有轟沈）                     → A
//   3. 我方無轟沈 + 敵數>1 + 敵撃沈數 ≥ ⌊敵數×0.7⌋ → A
//   4. 敵損害率 > 我方損害率 × 2.5               → B
//   5. 敵損害率 > 我方損害率 × 0.9               → C
//   6. 其餘                                       → D
// 註1：遊戲結算 api_win_rank 對「完全勝利」也回傳 S（非 SS），故預測不區分 SS，以免與結算不一致。
// 註2：A 的撃沈門檻是 floor（截斷）非 ceil——已用真實 1-1 boss 封包驗證（敵3艦沉2=A）。
//      floor(1×0.7)=0 會讓單艦誤判，故加「敵數>1」守衛。
// 註3：敵全滅但我方有轟沈=A、以及敵旗艦撃沈加成，這兩個 edge 尚無實測資料，待驗證。
export function predictRank(player: BattleShipView[], enemy: BattleShipView[]): string {
    if (enemy.length === 0) return '?';

    const sum = (arr: BattleShipView[], f: (s: BattleShipView) => number) =>
        arr.reduce((a, s) => a + f(s), 0);

    const pSunk = player.filter(s => s.sunk).length;
    const eSunk = enemy.filter(s => s.sunk).length;
    const eCount = enemy.length;

    const pBegin = sum(player, s => s.beginHp);
    const pNow = sum(player, s => Math.max(0, s.hp));
    const eBegin = sum(enemy, s => s.beginHp);
    const eNow = sum(enemy, s => Math.max(0, s.hp));
    const pLoss = pBegin > 0 ? (pBegin - pNow) / pBegin : 0;   // 0..1
    const eLoss = eBegin > 0 ? (eBegin - eNow) / eBegin : 0;   // 0..1

    const allEnemySunk = eSunk === eCount;
    const noPlayerSunk = pSunk === 0;

    // 1~2：敵全滅（無傷全滅即遊戲「完全勝利」，但 rank 欄位同為 S）
    if (allEnemySunk) {
        return noPlayerSunk ? 'S' : 'A';
    }
    // 3：我方無轟沈且撃沈敵七成以上（⌊敵艦數×0.7⌋，截斷；敵數>1 才適用）
    if (noPlayerSunk && eCount > 1 && eSunk >= Math.floor(eCount * 0.7)) return 'A';
    // 4~6：損害率ゲージ比較
    if (eLoss > 2.5 * pLoss) return 'B';
    if (eLoss > 0.9 * pLoss) return 'C';
    return 'D';
}

// ── 戰鬥解析（現行遊戲 API 格式）─────────────────────────────────
// 現行格式重點（與舊版不同）：
//   血量：api_f_nowhps / api_f_maxhps（我方主隊）、api_e_nowhps / api_e_maxhps（敵主隊），
//         隨伴為 *_combined。皆為 0-indexed、無 leading -1。
//   砲擊/夜戰：api_at_eflag 分辨攻擊方（0=我方,1=敵方），api_at_list / api_df_list 的索引
//             為各方局部 0-5（主隊）/ 6-11（隨伴）。
//   敵艦 master id：api_ship_ke 為 0-indexed、無 leading -1。
// 支援連續傳入多個封包（例如 晝戰 + 夜戰），血量以第一包為初始、依序重放各階段傷害。
export function analyzeBattle(apiList: any[], playerDamecons: { main: number[], escort: number[] }): BattleInfoView {
    const initialApi = apiList[0] ?? {};

    // 建立位置索引（含 null 佔位）的艦隊陣列
    const mkFleet = (nowKey: string, maxKey: string, damecons: number[]): (BattleShipView | null)[] => {
        const now = initialApi[nowKey], max = initialApi[maxKey];
        const arr: (BattleShipView | null)[] = [];
        if (!Array.isArray(now) || !Array.isArray(max)) return arr;
        for (let i = 0; i < now.length; i++) {
            if (max[i] <= 0) { arr.push(null); continue; }
            arr.push({
                hp: now[i], maxHp: max[i], beginHp: now[i],
                damecon: damecons[i] ?? 0, sunk: false, dealtDamage: 0,
            });
        }
        return arr;
    };

    const pMain = mkFleet('api_f_nowhps', 'api_f_maxhps', playerDamecons.main);
    const pEsc = mkFleet('api_f_nowhps_combined', 'api_f_maxhps_combined', playerDamecons.escort);
    const eMain = mkFleet('api_e_nowhps', 'api_e_maxhps', []);
    const eEsc = mkFleet('api_e_nowhps_combined', 'api_e_maxhps_combined', []);

    // (side, index) → 艦：index 0-5 主隊、6-11 隨伴
    const sideShip = (side: 'player' | 'enemy', idx: number): BattleShipView | null => {
        if (idx < 0) return null;
        if (side === 'player') return (idx < 6 ? pMain[idx] : pEsc[idx - 6]) ?? null;
        return (idx < 6 ? eMain[idx] : eEsc[idx - 6]) ?? null;
    };

    const takeDamage = (s: BattleShipView | null, dmg: number, isPlayer: boolean) => {
        if (!s || dmg <= 0) return;
        s.hp -= dmg;
        if (s.hp <= 0) {
            if (isPlayer && s.damecon > 0) {
                // 応急修理要員(0.2)／女神(全快)：發動並消耗
                s.hp = s.damecon === 1 ? Math.floor(s.maxHp * 0.2) : s.maxHp;
                s.damecon = 0;
            } else {
                s.sunk = true; s.hp = 0;
            }
        }
    };

    // 砲擊戰／夜戰：api_at_eflag[i] 為攻擊方（0=我方,1=敵方）
    const processHougeki = (phase: any) => {
        if (!phase || !Array.isArray(phase.api_at_list)) return;
        const eflag = phase.api_at_eflag;
        const atList = phase.api_at_list;
        const dfList = phase.api_df_list;
        const dmgList = phase.api_damage;
        for (let i = 0; i < atList.length; i++) {
            const at = atList[i];
            if (at < 0) continue;
            const atkPlayer = eflag ? eflag[i] === 0 : true;   // 無 eflag 時預設我方
            const attacker = sideShip(atkPlayer ? 'player' : 'enemy', at);
            const defenders = dfList?.[i], damages = dmgList?.[i];
            if (!Array.isArray(defenders) || !Array.isArray(damages)) continue;
            for (let j = 0; j < defenders.length; j++) {
                const df = defenders[j];
                if (df < 0) continue;
                const dmg = Math.max(0, Math.floor(damages[j]));
                const defPlayer = !atkPlayer;
                takeDamage(sideShip(defPlayer ? 'player' : 'enemy', df), dmg, defPlayer);
                if (attacker) attacker.dealtDamage += dmg;
            }
        }
    };

    // 雷擊/航空/開幕/支援：api_fdam(我方受傷) / api_edam(敵受傷) / api_fydam,api_eydam(造成傷害=MVP)
    // offset：隨伴(*_combined)欄位索引為 0-5，需 +6 對映到 sideShip 的隨伴區段。
    const applyDmg = (arr: any, side: 'player' | 'enemy', offset = 0) => {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++)
            takeDamage(sideShip(side, i + offset), Math.max(0, Math.floor(arr[i] ?? 0)), side === 'player');
    };
    const creditDmg = (arr: any, side: 'player' | 'enemy') => {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
            const s = sideShip(side, i);
            if (s) s.dealtDamage += Math.max(0, Math.floor(arr[i] ?? 0));
        }
    };
    // 聯合艦隊開幕雷擊（api_opening_atack）的造成傷害欄改叫 api_*ydam_list_items，
    // 每個位置是 null 或陣列（如 [21]）。已用真實 61-5 甲自軍聯合封包實證：
    // 若只讀 api_fydam/api_eydam 會漏算開幕雷擊的 MVP 貢獻（傷害/血量本身走 flat 的 fdam/edam 仍正確）。
    const creditDmgList = (arr: any, side: 'player' | 'enemy') => {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
            const items = arr[i];
            if (!Array.isArray(items)) continue;
            const s = sideShip(side, i);
            if (s) for (const d of items) s.dealtDamage += Math.max(0, Math.floor(d ?? 0));
        }
    };
    const processRaigeki = (phase: any) => {
        if (!phase) return;
        applyDmg(phase.api_fdam, 'player');
        applyDmg(phase.api_edam, 'enemy');
        creditDmg(phase.api_fydam, 'player');
        creditDmg(phase.api_eydam, 'enemy');
        creditDmgList(phase.api_fydam_list_items, 'player');   // 聯合艦隊開幕雷擊變體
        creditDmgList(phase.api_eydam_list_items, 'enemy');
    };
    // 航空戰（api_kouku / api_kouku2 / api_injection_kouku 噴式強襲）。
    // stage3 = 主隊、stage3_combined = 隨伴（索引 0-5，+6 對映）。
    // 已用真實 6-5 敵聯合封包驗證：不套用 *_combined 會漏算隨伴受傷 → rank 誤判 A（實際 S）。
    const processKouku = (kouku: any) => {
        const s3 = kouku?.api_stage3;
        if (s3) {
            applyDmg(s3.api_fdam, 'player');
            applyDmg(s3.api_edam, 'enemy');
        }
        const s3c = kouku?.api_stage3_combined;
        if (s3c) {
            applyDmg(s3c.api_fdam, 'player', 6);
            applyDmg(s3c.api_edam, 'enemy', 6);
        }
    };
    // 友軍艦隊砲擊（api_friendly_battle.api_hougeki）。
    // 友軍只對敵方造成傷害，不計入玩家 MVP。結構與通常 hougeki 相同：
    //   api_at_eflag[i]: 0=友軍攻擊（防御方=敵方）、1=敵方攻擊（防御方=友軍，不影響玩家）
    //   api_df_list[i]: 防御方局部索引（0-5 主隊、6-11 隨伴）
    // 已用真實 61-3 甲 boss 夜戰封包驗證（samples/61-3.json node53 yasen）。
    const processFriendlyHougeki = (phase: any) => {
        if (!phase || !Array.isArray(phase.api_at_list)) return;
        const eflag = phase.api_at_eflag;
        const dfList = phase.api_df_list;
        const dmgList = phase.api_damage;
        for (let i = 0; i < (phase.api_at_list?.length ?? 0); i++) {
            // 只處理友軍攻擊敵方（eflag=0）；敵方攻擊友軍（eflag=1）不影響玩家艦
            if (eflag?.[i] !== 0) continue;
            const defenders = dfList?.[i], damages = dmgList?.[i];
            if (!Array.isArray(defenders) || !Array.isArray(damages)) continue;
            for (let j = 0; j < defenders.length; j++) {
                const df = defenders[j];
                if (df < 0) continue;
                const dmg = Math.max(0, Math.floor(damages[j]));
                takeDamage(sideShip('enemy', df), dmg, false);
                // 不追蹤 attacker.dealtDamage——友軍不計入玩家 MVP
            }
        }
    };
    // 友軍艦隊雷擊（api_friendly_battle.api_raigeki）。
    // api_edam = 友軍雷擊對敵方造成的傷害，索引為敵方位置。
    const processFriendlyRaigeki = (phase: any) => {
        if (!phase) return;
        applyDmg(phase.api_edam, 'enemy');
        // api_fdam 是敵方雷擊對友軍的傷害，不影響玩家，故不處理
    };

    // 友軍艦隊編成：api_friendly_info 與 api_friendly_battle 同層出現在夜戰封包
    // （已用 samples/61-3.json node53 驗證）。api_ship_id 為 master id（非艦娘實例 id）。
    let friendlyFleetIds: number[] | null = null;

    // 依序走訪所有戰鬥封包與階段
    for (const api of apiList) {
        if (!api) continue;
        // 基地航空隊（主隊 + 隨伴）
        if (Array.isArray(api.api_air_base_attack))
            for (const ph of api.api_air_base_attack) {
                applyDmg(ph?.api_stage3?.api_edam, 'enemy');
                applyDmg(ph?.api_stage3_combined?.api_edam, 'enemy', 6);
            }
        // 噴式強襲（api_injection_kouku）→ 航空戰 → 二巡航空戰
        processKouku(api.api_injection_kouku);
        processKouku(api.api_kouku);
        processKouku(api.api_kouku2);
        // 支援艦隊（對敵）
        const sup = api.api_support_info;
        if (sup) {
            applyDmg(sup.api_support_airatack?.api_stage3?.api_edam, 'enemy');
            applyDmg(sup.api_support_hourai?.api_damage, 'enemy');
        }
        // 開幕
        processHougeki(api.api_opening_taisen);   // 開幕對潛
        processRaigeki(api.api_opening_atack);     // 開幕雷擊
        // 砲擊戰
        processHougeki(api.api_hougeki1);
        processHougeki(api.api_hougeki2);
        processHougeki(api.api_hougeki3);
        // 雷擊戰
        processRaigeki(api.api_raigeki);
        // 友軍艦隊（活動海域 boss 夜戰，api_friendly_battle 在夜戰封包中）
        const fb = api.api_friendly_battle;
        if (fb) {
            processFriendlyHougeki(fb.api_hougeki);
            processFriendlyRaigeki(fb.api_raigeki);
        }
        const fi = api.api_friendly_info;
        if (fi && Array.isArray(fi.api_ship_id)) {
            friendlyFleetIds = fi.api_ship_id.filter((id: number) => id > 0);
        }
        // 夜戰
        processHougeki(api.api_hougeki);
    }

    // 彙整（過濾 null 佔位）
    const compact = (arr: (BattleShipView | null)[]) =>
        arr.filter((s): s is BattleShipView => !!s);
    const fleets: BattleFleetView = {
        playerMain: compact(pMain), playerEscort: compact(pEsc),
        enemyMain: compact(eMain), enemyEscort: compact(eEsc),
    };

    // MVP（依造成傷害取最高，回傳 1-based 位置）
    const mvpOf = (arr: BattleShipView[]) => {
        let idx = 0, best = -1;
        arr.forEach((s, i) => { if (s.dealtDamage > best) { best = s.dealtDamage; idx = i; } });
        return arr.length ? idx + 1 : 0;
    };
    const mainMvp = mvpOf(fleets.playerMain);
    const escortMvp = fleets.playerEscort.length ? mvpOf(fleets.playerEscort) : 0;

    // 評級預測（我方＝主隊+隨伴，敵方＝主隊+隨伴）
    const rank = predictRank(
        [...fleets.playerMain, ...fleets.playerEscort],
        [...fleets.enemyMain, ...fleets.enemyEscort],
    );

    // 大破警告：只有主隊旗艦大破不算（無法進擊），隨伴旗艦大破仍警告
    let isTaiha = false;
    const checkTaiha = (ships: BattleShipView[], skipFlagship: boolean) => {
        for (let i = 0; i < ships.length; i++) {
            if (skipFlagship && i === 0) continue;
            const s = ships[i];
            if (s.hp > 0 && s.hp * 4 <= s.maxHp && s.damecon === 0) isTaiha = true;
        }
    };
    checkTaiha(fleets.playerMain, true);
    checkTaiha(fleets.playerEscort, false);

    // ── 出擊 UI 附加資訊 ──
    // 敵艦 master id：現行 api_ship_ke 為 0-indexed、無 leading -1，直接取存在者
    const enemyIds: number[] = Array.isArray(initialApi.api_ship_ke)
        ? initialApi.api_ship_ke.filter((id: number) => id > 0)
        : [];
    // 敵隨伴（敵聯合艦隊）。api_ship_ke_combined 尚無實測樣本，先 best-effort 讀取。
    const enemyIdsEscort: number[] = Array.isArray(initialApi.api_ship_ke_combined)
        ? initialApi.api_ship_ke_combined.filter((id: number) => id > 0)
        : [];

    const formation = Array.isArray(initialApi.api_formation) ? initialApi.api_formation : [0, 0, 0];
    let seiku = 0;
    let touchPlane = [0, 0];
    const planes = {
        playerFighter: { count: 0, lost: 0 }, playerBomber: { count: 0, lost: 0 },
        enemyFighter: { count: 0, lost: 0 }, enemyBomber: { count: 0, lost: 0 },
    };
    const supportFlag = initialApi.api_support_flag ?? 0;
    const midnightFlag = initialApi.api_midnight_flag === 1;
    let aaci = 0;

    const s1 = initialApi.api_kouku?.api_stage1;
    if (s1) {
        seiku = s1.api_disp_seiku ?? 0;
        if (Array.isArray(s1.api_touch_plane)) touchPlane = s1.api_touch_plane;
        planes.playerFighter = { count: s1.api_f_count ?? 0, lost: s1.api_f_lostcount ?? 0 };
        planes.enemyFighter = { count: s1.api_e_count ?? 0, lost: s1.api_e_lostcount ?? 0 };
    }
    const s2 = initialApi.api_kouku?.api_stage2;
    if (s2) {
        planes.playerBomber = { count: s2.api_f_count ?? 0, lost: s2.api_f_lostcount ?? 0 };
        planes.enemyBomber = { count: s2.api_e_count ?? 0, lost: s2.api_e_lostcount ?? 0 };
        if (s2.api_air_fire?.api_kind) aaci = s2.api_air_fire.api_kind;
    }

    return {
        resultFleets: fleets,
        rank,
        mvp: [mainMvp, escortMvp],
        isTaiha,
        enemyIds,
        enemyIdsEscort,
        formation,
        seiku,
        touchPlane,
        planes,
        drop: null,
        supportFlag,
        aaci,
        midnightFlag,
        friendlyFleetIds,
        hasResult: false,
    };
}
