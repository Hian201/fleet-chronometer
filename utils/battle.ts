// 輕量級戰鬥解析引擎 (純 TS)
import {
    type BattleShipView, type BattleFleetView, type BattleInfoView,
    type BattleEnemyShipView, type BattleSupportView, type BattleLbasView,
    type BattleHpSnapshot, type BattlePhaseKind, type BattlePhaseView,
    type BattleDamageEvent, type BattleDamageKind, type BattleEventSide,
} from './state';

/**
 * 支援艦隊的旗標分類，對照 poi/lib-battle 的 SupportTypeMap：
 * api_support_flag 1＝航空、2＝砲擊、3＝雷擊、4＝對潛。這與 poi 的 1／2／3
 * SupportTypeMap 及本專案 61-5 node 1 的真實潛水艦支援封包相互核對；未知旗標仍以
 * 實際存在的支援結構回退，避免補猜未驗證值。
 */
export function supportKindFromFlag(flag: number, hasAirSupport: boolean): 'air' | 'shelling' | 'torpedo' | 'asw' {
    if (flag === 3) return 'torpedo';
    if (flag === 4) return 'asw';
    if (flag === 1) return 'air';
    if (flag === 2) return 'shelling';
    return hasAirSupport ? 'air' : 'shelling';
}

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
// 註4：退避艦（艦隊司令部施設）已離開艦隊，不算在我方損害率與轟沈數內——呼叫端負責
//      先濾掉（見 analyzeBattle 末段）。此排除是機制推論、無真封包佐證，見檔末說明。
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
// 現行格式重點：
//   血量：api_f_nowhps / api_f_maxhps（我方主隊）、api_e_nowhps / api_e_maxhps（敵主隊），
//         隨伴為 *_combined。皆為 0-indexed、無 leading -1。
//   砲擊/夜戰：api_at_eflag 分辨攻擊方（0=我方,1=敵方），api_at_list / api_df_list 的索引
//             為各方局部 0-5（主隊）/ 6-11（隨伴）。
//   敵艦 master id：api_ship_ke 為 0-indexed、無 leading -1。
// 支援連續傳入多個封包（例如 晝戰 + 夜戰），血量以第一包為初始、依序重放各階段傷害。
// escaped*：該位置的艦是否已由艦隊司令部施設退避（0-indexed，與各艦隊的「存在艦」同序）。
// 退避艦仍佔封包的血量陣列位置（否則位置索引會整排錯位），但已不參戰，故不列入大破警告、
// 也不列入 rank 的損害率——**此排除是機制推論，本專案尚無帶退避的真封包**（見 state.ts
// escapedShipIds 的說明與 wantedTag 的擷取鉤子）。
export interface BattleAnalyzeOptions {
    escapedMain?: boolean[];
    escapedEscort?: boolean[];
    /** 出擊快照中的我方裝備 master id，依主隊／隨伴與艦位對齊。 */
    playerGearIds?: { main: number[][]; escort: number[][] };
    /** 出擊快照中的我方艦實例／master id，保留主隊與隨伴的原始位置。 */
    playerAaciShips?: {
        main: ({ id: number; masterId?: number } | null)[];
        escort: ({ id: number; masterId?: number } | null)[];
    };
}

// 探照燈的 master id 來自目前專案的 start2 主資料／樣本：74、140。
// 夜偵與照明彈的「是否發動」以夜戰封包明示欄位為準，避免固定 id 名單漏掉新裝備。
const SEARCHLIGHT_MST = new Set([74, 140]);

/**
 * 由艦隊現況算出三個大破訊號。
 *
 * isTaiha ＝「進擊會有轟沈風險的艦」，三種艦刻意不列入：
 *   · 主隊旗艦：遊戲本來就禁止旗艦大破進擊，不是「小心點」而是「不能去」，
 *     另以 flagshipTaiha 回報（帶損管時可突破，見 flagshipDamecon）。
 *   · 隨伴（第二艦隊）旗艦：機制上不會被擊沉，沒有轟沈風險。
 *   · 已退避艦：已離開艦隊，不再參戰。
 * damecon>0 的艦同樣不警告——下次致命傷會由損管接住（消耗後 damecon 歸 0，
 * 屆時就會恢復警告；跨節點的消耗記錄見 state.ts damaconUsed）。
 *
 * **抽成獨立函式是因為退避之後要重算**：玩家在結算畫面按下退避（goback_port）之後
 * 不會再有新的戰鬥封包，若不重跑這一段，已經退避的那艘船會繼續掛著大破警告——
 * 而退避的重點正是「讓剩下的船能繼續進擊」。見 state.ts 的 goback_port 分支。
 */
export function taihaFlags(fleets: BattleFleetView): {
    isTaiha: boolean; flagshipTaiha: boolean; flagshipDamecon: number;
} {
    let isTaiha = false;
    const atRisk = (s: BattleShipView) =>
        !s.escaped && !s.unsinkable && s.hp > 0 && s.hp * 4 <= s.maxHp && s.damecon === 0;
    for (const ships of [fleets.playerMain, fleets.playerEscort])
        for (let i = 1; i < ships.length; i++) if (atRisk(ships[i])) isTaiha = true;
    // 主隊旗艦大破＝強制返航。**不看 damecon**：損管在此不是「會自動接住」而是
    // 「結算後可選擇使用以突破進擊限制」，是否還有損管交給 flagshipDamecon 表達。
    const flagship = fleets.playerMain[0];
    const flagshipTaiha = !!flagship && !flagship.escaped && flagship.hp > 0 && flagship.hp * 4 <= flagship.maxHp;
    // 旗艦身上尚未消耗的損管種類（0無／1応急修理要員／2応急修理女神）。損管必須裝在
    // 大破的旗艦自己身上才有效，裝在其他隊員身上不保護旗艦，故只讀旗艦這一格。
    const flagshipDamecon = flagshipTaiha ? flagship.damecon : 0;
    return { isTaiha, flagshipTaiha, flagshipDamecon };
}
export function analyzeBattle(
    apiList: any[],
    playerDamecons: { main: number[], escort: number[] },
    opts: BattleAnalyzeOptions = {},
): BattleInfoView {
    const initialApi = apiList[0] ?? {};

    // 夜戰接續、空襲先行與舊重播的封包不一定在第一包重送所有白天欄位。
    // 傷害重放仍以第一包作為 HP 起點；顯示上下文則逐欄尋找同一場中第一個
    // 明確帶值的封包，避免把「欄位缺席」誤當成 0／未知。
    const packetWith = (has: (api: any) => boolean): any =>
        apiList.find(api => api && has(api)) ?? initialApi;
    const hasFleetHp = (api: any): boolean =>
        Array.isArray(api?.api_f_nowhps) && Array.isArray(api?.api_f_maxhps)
        && Array.isArray(api?.api_e_nowhps) && Array.isArray(api?.api_e_maxhps);
    const contextApi = packetWith(hasFleetHp);

    // 建立位置索引（含 null 佔位）的艦隊陣列
    const mkFleet = (nowKey: string, maxKey: string, damecons: number[], escaped: boolean[] = []): (BattleShipView | null)[] => {
        // 夜戰接續／夜轉日封包可能才補送 *_combined；逐隊找欄位，不能只沿用
        // 第一個帶主隊 HP 的封包，否則敵聯合艦隊會被錯當成單艦隊而失去夜戰預測。
        const fleetApi = packetWith(api => Array.isArray(api?.[nowKey]) && Array.isArray(api?.[maxKey]));
        const now = fleetApi[nowKey], max = fleetApi[maxKey];
        const arr: (BattleShipView | null)[] = [];
        if (!Array.isArray(now) || !Array.isArray(max)) return arr;
        for (let i = 0; i < now.length; i++) {
            if (max[i] <= 0) { arr.push(null); continue; }
            arr.push({
                hp: now[i], maxHp: max[i], beginHp: now[i],
                damecon: damecons[i] ?? 0, sunk: false, dealtDamage: 0,
                escaped: escaped[i] === true,
            });
        }
        return arr;
    };

    const pMain = mkFleet('api_f_nowhps', 'api_f_maxhps', playerDamecons.main, opts.escapedMain);
    const pEsc = mkFleet('api_f_nowhps_combined', 'api_f_maxhps_combined', playerDamecons.escort, opts.escapedEscort);
    const eMain = mkFleet('api_e_nowhps', 'api_e_maxhps', []);
    const eEsc = mkFleet('api_e_nowhps_combined', 'api_e_maxhps_combined', []);
    // 連合艦隊的第二艦隊旗艦不會被擊沉（使用者提供之遊戲設定，非封包驗證）。
    // 位置固定為隨伴艦隊的第一艘；單艦隊出擊時 pEsc 為空，此保護自然不成立。
    const escortFlagship = pEsc.find(s => !!s) ?? null;
    if (escortFlagship) escortFlagship.unsinkable = true;

    type DamageSummary = { ownDamage: number; enemyDamage: number };
    type PhaseResult = { damage: DamageSummary; events: BattleDamageEvent[] };
    const noDamage = (): DamageSummary => ({ ownDamage: 0, enemyDamage: 0 });
    const snapshotFleet = (fleet: (BattleShipView | null)[]) => fleet.filter((s): s is BattleShipView => !!s).map(s => ({
        hp: Math.max(0, s.hp), maxHp: s.maxHp, sunk: s.sunk,
    }));
    const snapshot = (): BattleHpSnapshot => ({
        playerMain: snapshotFleet(pMain),
        playerEscort: snapshotFleet(pEsc),
        enemyMain: snapshotFleet(eMain),
        enemyEscort: snapshotFleet(eEsc),
    });
    const phases: BattlePhaseView[] = [];
    const recordPhase = (kind: BattlePhaseKind, packet: number, result: PhaseResult) => {
        phases.push({ kind, packet, ...result.damage, ...snapshot(), events: result.events });
    };
    const initialSnapshot = snapshot();

    // (side, index) → 艦：index 0-5 主隊、6-11 隨伴
    const sideShip = (side: 'player' | 'enemy', idx: number): BattleShipView | null => {
        if (idx < 0) return null;
        if (side === 'player') return (idx < 6 ? pMain[idx] : pEsc[idx - 6]) ?? null;
        return (idx < 6 ? eMain[idx] : eEsc[idx - 6]) ?? null;
    };

    /** `api_cl_list`：0＝未命中、1＝一般命中、2＝暴擊；缺席時不猜判定。 */
    const criticalFromFlag = (flag: unknown): boolean | null => {
        if (flag === null || flag === undefined) return null;
        const value = Number(flag);
        if (!Number.isFinite(value)) return null;
        const code = Math.trunc(value);
        return code === 2 ? true : code === 0 || code === 1 ? false : null;
    };

    /** 戰鬥攻擊欄位只接受封包可轉成整數的原始值；其他值維持「不可考」。 */
    const rawAttackCode = (value: unknown): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isSafeInteger(n) ? n : null;
    };

    const targetIndex = (value: unknown): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isSafeInteger(n) && n >= 0 ? n : null;
    };

    /**
     * 連合艦隊夜戰的敵方攻擊／受擊位置以當前艦隊為基準 0–5；本引擎的敵艦陣列
     * 則固定為主隊 0–5、隨伴 6–11。只對尚未帶全域偏移的局部位置補 6，避免
     * 一般主隊位置或已是全域位置的資料被重複偏移。
     */
    const alignNightEnemyIndex = (index: number, enemyOffset: number): number =>
        enemyOffset > 0 && index >= 0 && index < 6 ? index + enemyOffset : index;

    /** api_si_list 的一格通常是陣列，舊格式也可能直接給單一數字。 */
    const attackSlotIds = (value: unknown): number[] => {
        const values = Array.isArray(value) ? value : [value];
        return values.map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
    };

    type AttackMetadata = {
        attackType: number | null;
        specialType: number | null;
        attackSlots: number[];
    };
    const attackMetadata = (phase: any, index: number): AttackMetadata => ({
        attackType: Array.isArray(phase?.api_at_type) ? rawAttackCode(phase.api_at_type[index]) : null,
        specialType: Array.isArray(phase?.api_sp_list) ? rawAttackCode(phase.api_sp_list[index]) : null,
        attackSlots: Array.isArray(phase?.api_si_list) ? attackSlotIds(phase.api_si_list[index]) : [],
    });

    const nightEffects = { starShell: false, nightRecon: false, searchlight: false };
    let nightObserved = false;
    let nightTouchPlane: number | undefined;
    let nightTarget: 'main' | 'escort' | 'unknown' | undefined;
    let nightTargetEstimated = false;
    const playerGearIds = opts.playerGearIds;
    /**
     * 夜戰有兩套同時存在的欄位命名：一般夜戰延續使用 `api_hougeki`，
     * 夜轉日／部分連合艦隊流程則使用 `api_n_hougeki1/2`。KC3Kai 的
     * phaseParserMap 將它們全部視為夜戰砲擊階段，不能只看單一欄位。
     */
    const nightHougekiPhases = (api: any): any[] => [
        api?.api_hougeki,
        api?.api_n_hougeki1,
        api?.api_n_hougeki2,
        api?.api_n_hougeki3,
    ].filter(Boolean);
    const hasNightPayload = (api: any): boolean =>
        nightHougekiPhases(api).length > 0
        || !!api?.api_n_support_info
        || Array.isArray(api?.api_flare_pos)
        || Array.isArray(api?.api_touch_plane)
        || Array.isArray(api?.api_active_deck);

    /**
     * KC3Kai CalculatorManager.estimateNightActiveCombinedEnemy 的 clean-room 對應：
     * 日戰預測只在判斷條件足夠時給出主隊／隨伴；其餘保持未知，不用傷害位置硬猜。
     * 隨伴存活分數是 KC3Kai 的公開規則：旗艦存活先加 1，HP 比例 >50% 再加 1，
     * >25% 再加 0.7；總分 <3 進主隊，否則進隨伴。主隊全滅時直接進隨伴。
     */
    const estimateNightTarget = (): 'main' | 'escort' | undefined => {
        const main = eMain.filter((ship): ship is BattleShipView => !!ship);
        if (!main.length || !eEsc.some(Boolean)) return undefined;
        if (main.every(ship => ship.sunk || ship.hp <= 0)) return 'escort';
        let score = 0;
        // 保留原始 0–5 位置；KC3Kai 的旗艦加分只適用 escort[0]，不能先 compact
        // 再因空位左移而把第二艘誤當旗艦。
        eEsc.forEach((ship, index) => {
            if (!ship || ship.sunk || ship.hp <= 0 || ship.maxHp <= 0) return;
            if (index === 0) score += 1;
            const ratio = ship.hp / ship.maxHp;
            if (ratio > 0.5) score += 1;
            else if (ratio > 0.25) score += 0.7;
        });
        return score < 3 ? 'main' : 'escort';
    };

    const playerHasSearchlightAtNight = (activeFleet?: number): boolean => {
        if (!playerGearIds) return false;
        const fleets = [
            ...(activeFleet === 2 ? [] : [{ rows: playerGearIds.main, ships: pMain }]),
            ...(activeFleet === 1 ? [] : [{ rows: playerGearIds.escort, ships: pEsc }]),
        ];
        return fleets.some(({ rows, ships }) => rows.some((gears, index) => {
            const ship = ships[index];
            return !!ship && ship.hp > 1 && gears.some(mst => SEARCHLIGHT_MST.has(mst));
        }));
    };
    const hougekiShowsPlayerSearchlight = (phase: any, activeFleet?: number): boolean => {
        if (!Array.isArray(phase?.api_si_list) || !Array.isArray(phase?.api_at_eflag)
            || !Array.isArray(phase?.api_at_list)) return false;
        return phase.api_si_list.some((slots: unknown, index: number) => {
            // 只有 `api_at_eflag[i] = 0` 才能把攻擊欄歸屬我方；敵方裝備不能替我方亮燈。
            if (phase.api_at_eflag[index] !== 0) return false;
            const attackerIndex = Number(phase.api_at_list[index]);
            const playerIndex = activeFleet === 2 && attackerIndex >= 0 && attackerIndex < 6
                ? attackerIndex + 6 : attackerIndex;
            const attacker = Number.isSafeInteger(playerIndex)
                ? sideShip('player', playerIndex) : null;
            // 營運規則：裝備探照燈的艦只有 HP > 1 才會發動；攻擊欄 fallback 也要遵守。
            if (!attacker || attacker.hp <= 1) return false;
            return attackSlotIds(slots).some(mst => SEARCHLIGHT_MST.has(mst));
        });
    };
    const noteNightEffects = (api: any): void => {
        const phases = nightHougekiPhases(api);
        const activePlayerFleet = Array.isArray(api.api_active_deck)
            ? Number(api.api_active_deck[0]) : undefined;
        const flarePosition = Array.isArray(api.api_flare_pos) ? Number(api.api_flare_pos[0]) : -1;
        if (Number.isSafeInteger(flarePosition) && flarePosition >= 0) {
            // KC3Kai 直接把 api_flare_pos[0] 當作照明彈發動位置；這是夜戰封包的發動
            // 事實，不因本機裝備快照尚未載入而把圖示錯畫成未發動。
            nightEffects.starShell = true;
        }

        const touchPlane = Array.isArray(api.api_touch_plane) ? Number(api.api_touch_plane[0]) : -1;
        // KC3Kai 的 Node.engageNight 以正的 api_touch_plane[0] 記錄夜間觸接機體；
        // 不需要再用固定 master id 或本機裝備表二次否定這個封包事實。
        if (Number.isSafeInteger(touchPlane) && touchPlane > 0) {
            nightEffects.nightRecon = true;
            nightTouchPlane ??= touchPlane;
        }

        // 探照燈目前沒有獨立的 API 發動旗標：依營運規則，夜戰開始時裝備艦 HP > 1
        // 且確實攜帶探照燈就會發動；攻擊欄 fallback 同樣核對攻擊艦 HP > 1。
        nightEffects.searchlight = playerHasSearchlightAtNight(activePlayerFleet)
            || phases.some(phase => hougekiShowsPlayerSearchlight(phase, activePlayerFleet));
    };

    const takeDamage = (s: BattleShipView | null, dmg: number, isPlayer: boolean) => {
        if (!s || dmg <= 0) return;
        s.hp -= dmg;
        if (s.hp <= 0) {
            if (isPlayer && s.unsinkable) {
                // 連合艦隊第二艦隊旗艦不會被擊沉；不會沉就不需要損管，故損管也不發動、
                // 留著給之後的節點。**殘 HP 值無真封包佐證**，取「存活的最低值 1」不猜
                // 其他數字；重點是不誤報轟沈（rank 的 pSunk 與大破警告都會被牽動）。
                s.hp = 1;
            } else if (isPlayer && s.damecon > 0) {
                // 応急修理要員＝修復至中破（最大HP的 50%）／女神＝全快（燃彈另在 state.ts
                // 補回）。發動後即消耗消失。50% 為使用者提供之遊戲設定（非封包驗證）。
                s.hp = s.damecon === 1 ? Math.floor(s.maxHp * 0.5) : s.maxHp;
                s.damecon = 0;
            } else {
                s.sunk = true; s.hp = 0;
            }
        }
    };

    /** 套用一筆已由封包明確提供的傷害，並保留套用前後 HP 供交戰記錄逐筆呈現。 */
    const damageEvent = (
        kind: BattleDamageKind,
        attackerSide: BattleEventSide | null,
        attackerIndex: number | null,
        defenderSide: BattleEventSide | null,
        defenderIndex: number | null,
        rawDamage: number,
        critical: boolean | null = null,
        metadata: AttackMetadata = { attackType: null, specialType: null, attackSlots: [] },
    ): BattleDamageEvent => {
        const target = defenderSide && defenderIndex !== null && defenderSide !== 'friendly'
            ? sideShip(defenderSide === 'player' ? 'player' : 'enemy', defenderIndex) : null;
        const damage = Math.max(0, Math.floor(rawDamage ?? 0));
        const beforeHp = target ? Math.max(0, target.hp) : null;
        const maxHp = target?.maxHp ?? null;
        if (target && damage > 0) takeDamage(target, damage, defenderSide === 'player');
        return {
            kind, attackerSide, attackerIndex, defenderSide, defenderIndex, damage,
            critical,
            ...metadata,
            beforeHp, afterHp: target ? Math.max(0, target.hp) : null, maxHp,
            sunk: !!target?.sunk,
        };
    };

    /** 依傷害陣列的已驗證位置逐格產生事件；0 值是陣列佔位，不當作一次攻擊顯示。 */
    const targetDamage = (
        kind: BattleDamageKind,
        arr: any,
        attackerSide: BattleEventSide,
        defenderSide: 'player' | 'enemy',
        offset = 0,
        criticalFlags: any = null,
    ): { total: number; events: BattleDamageEvent[] } => {
        if (!Array.isArray(arr)) return { total: 0, events: [] };
        const events: BattleDamageEvent[] = [];
        let total = 0;
        for (let i = 0; i < arr.length; i++) {
            const damage = Math.max(0, Math.floor(arr[i] ?? 0));
            if (damage <= 0) continue;
            total += damage;
            events.push(damageEvent(
                kind, attackerSide, null, defenderSide, i + offset, damage,
                Array.isArray(criticalFlags) ? criticalFromFlag(criticalFlags[i]) : null,
            ));
        }
        return { total, events };
    };

    /**
     * 讀取雷擊封包的「攻擊者 → 目標 → 傷害」陣列。
     *
     * 舊格式使用 api_frai／api_fydam（每個攻擊者一格）；2024-03-01 後的多目標格式
     * 使用 api_frai_list_items／api_fydam_list_items（每個攻擊者一格、格內可有多次攻擊）。
     * KC3Kai 與七四式都以這組欄位建立逐艦雷擊事件；api_fdam／api_edam 只表示受擊方
     * 的合計結果，不能拿來反推攻擊者。
     */
    const torpedoAttackEvents = (
        phase: any,
        attackerSide: 'player' | 'enemy',
        defenderSide: 'player' | 'enemy',
        enemyOffset = 0,
    ): { detailed: boolean; total: number; events: BattleDamageEvent[] } => {
        const isPlayer = attackerSide === 'player';
        const targetValues = phase?.[isPlayer ? 'api_frai' : 'api_erai'];
        const damageValues = phase?.[isPlayer ? 'api_fydam' : 'api_eydam'];
        const criticalValues = phase?.[isPlayer ? 'api_fcl' : 'api_ecl'];
        const targetListItems = phase?.[isPlayer ? 'api_frai_list_items' : 'api_erai_list_items'];
        const damageListItems = phase?.[isPlayer ? 'api_fydam_list_items' : 'api_eydam_list_items'];
        const criticalListItems = phase?.[isPlayer ? 'api_fcl_list_items' : 'api_ecl_list_items'];
        const listFormat = Array.isArray(targetListItems) && Array.isArray(damageListItems);
        const flatFormat = Array.isArray(targetValues) && Array.isArray(damageValues);
        if (!listFormat && !flatFormat) return { detailed: false, total: 0, events: [] };

        const asValues = (value: unknown): unknown[] => Array.isArray(value) ? value : [value];
        const count = listFormat
            ? Math.max(targetListItems.length, damageListItems.length, Array.isArray(criticalListItems) ? criticalListItems.length : 0)
            : Math.max(targetValues.length, damageValues.length, Array.isArray(criticalValues) ? criticalValues.length : 0);
        const events: BattleDamageEvent[] = [];
        let total = 0;
        for (let attackerIndex = 0; attackerIndex < count; attackerIndex++) {
            const targets = listFormat ? asValues(targetListItems[attackerIndex]) : [targetValues[attackerIndex]];
            const damages = listFormat ? asValues(damageListItems[attackerIndex]) : [damageValues[attackerIndex]];
            const criticals = listFormat
                ? asValues(Array.isArray(criticalListItems) ? criticalListItems[attackerIndex] : undefined)
                : [Array.isArray(criticalValues) ? criticalValues[attackerIndex] : undefined];
            const hitCount = Math.max(targets.length, damages.length, criticals.length);
            for (let hitIndex = 0; hitIndex < hitCount; hitIndex++) {
                const rawDefenderIndex = targetIndex(targets[hitIndex]);
                // -1／null 是「沒有發動這艘艦的雷擊」，不製造虛構的目標列。
                if (rawDefenderIndex === null) continue;
                const defenderIndex = defenderSide === 'enemy'
                    ? alignNightEnemyIndex(rawDefenderIndex, enemyOffset) : rawDefenderIndex;
                const damage = Math.max(0, Math.floor(Number(damages[hitIndex] ?? 0)));
                total += damage;
                const alignedAttackerIndex = attackerSide === 'enemy'
                    ? alignNightEnemyIndex(attackerIndex, enemyOffset) : attackerIndex;
                const attacker = sideShip(attackerSide, alignedAttackerIndex);
                events.push(damageEvent(
                    'torpedo', attackerSide, alignedAttackerIndex, defenderSide, defenderIndex, damage,
                    criticalFromFlag(criticals[hitIndex]),
                ));
                if (attacker) attacker.dealtDamage += damage;
            }
        }
        return { detailed: true, total, events };
    };

    // 砲擊戰／夜戰：api_at_eflag[i] 為攻擊方（0=我方,1=敵方）
    const processHougeki = (phase: any, enemyOffset = 0): PhaseResult => {
        const damage = noDamage();
        const events: BattleDamageEvent[] = [];
        if (!phase || !Array.isArray(phase.api_at_list)) return { damage, events };
        const eflag = phase.api_at_eflag;
        const atList = phase.api_at_list;
        const dfList = phase.api_df_list;
        const dmgList = phase.api_damage;
        for (let i = 0; i < atList.length; i++) {
            const at = atList[i];
            if (at < 0) continue;
            const atkPlayer = eflag ? eflag[i] === 0 : true;   // 無 eflag 時預設我方
            const alignedAttackerIndex = atkPlayer ? at : alignNightEnemyIndex(at, enemyOffset);
            const attacker = sideShip(atkPlayer ? 'player' : 'enemy', alignedAttackerIndex);
            const defenders = dfList?.[i], damages = dmgList?.[i];
            const criticals = phase.api_cl_list?.[i];
            const recordCount = Math.max(
                Array.isArray(defenders) ? defenders.length : 0,
                Array.isArray(damages) ? damages.length : 0,
                Array.isArray(criticals) ? criticals.length : 0,
                1,
            );
            const metadata = attackMetadata(phase, i);
            // KC3Kai 的 replay 解析規則：一般砲擊／夜戰 CI 只使用第一個目標，
            // 並把同一個 api_damage 陣列內的非負數視為對該目標的連續傷害；
            // 只有 100 以上的特殊攻擊才是「每個 df 對一個 damage」的多目標格式。
            // 因此 [目標, -1, -1]／[傷害, -1, -1] 的 -1 是填充欄位，不是事件。
            const multiTarget = (metadata.attackType ?? 0) >= 100 || (metadata.specialType ?? 0) >= 100;
            const targetIndexes = multiTarget
                ? Array.from({ length: recordCount }, (_, j) => targetIndex(Array.isArray(defenders) ? defenders[j] : undefined))
                : [targetIndex(Array.isArray(defenders) ? defenders[0] : undefined)];
            const hitCount = multiTarget
                ? targetIndexes.length
                : Math.max(Array.isArray(damages) ? damages.length : 0, 1);
            const defPlayer = !atkPlayer;
            for (let j = 0; j < hitCount; j++) {
                const rawDfIndex = targetIndexes[multiTarget ? j : 0] ?? null;
                if (rawDfIndex === null) continue;
                const dfIndex = defPlayer ? rawDfIndex : alignNightEnemyIndex(rawDfIndex, enemyOffset);
                const rawDamage = Array.isArray(damages) ? damages[j] : undefined;
                // -1 是連續攻擊陣列的填充值；明確的 0 仍保留為一次未造成傷害。
                if (rawDamage !== undefined && Number(rawDamage) < 0) continue;
                const dmg = Math.max(0, Math.floor(rawDamage ?? 0));
                const cl = Array.isArray(criticals) ? criticals[j] : criticals;
                events.push(damageEvent(
                    'ship', atkPlayer ? 'player' : 'enemy', alignedAttackerIndex,
                    defPlayer ? 'player' : 'enemy', dfIndex, dmg,
                    criticalFromFlag(cl), metadata,
                ));
                if (defPlayer) damage.ownDamage += dmg;
                else damage.enemyDamage += dmg;
                if (attacker) attacker.dealtDamage += dmg;
            }
        }
        return { damage, events };
    };

    // 傷害陣列的加總（不套用到任何艦，純統計）。與 targetDamage 同一套切捨規則——
    // api_edam 實測會出現小數（6-5 ec_battle 樣本的 0.1），兩邊不同調就會對不起來。
    const sumDamage = (arr: any): number => {
        if (!Array.isArray(arr)) return 0;
        let total = 0;
        for (const v of arr) total += Math.max(0, Math.floor(v ?? 0));
        return total;
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
    const processRaigeki = (phase: any, enemyOffset = 0): PhaseResult => {
        const damage = noDamage();
        const events: BattleDamageEvent[] = [];
        if (!phase) return { damage, events };
        const playerAttacks = torpedoAttackEvents(phase, 'player', 'enemy', enemyOffset);
        const enemyAttacks = torpedoAttackEvents(phase, 'enemy', 'player', enemyOffset);
        const own = playerAttacks.detailed
            ? playerAttacks
            : targetDamage('torpedo', phase.api_edam, 'player', 'enemy', enemyOffset);
        const enemy = enemyAttacks.detailed
            ? enemyAttacks
            : targetDamage('torpedo', phase.api_fdam, 'enemy', 'player');
        damage.enemyDamage = own.total;
        damage.ownDamage = enemy.total;
        events.push(...own.events, ...enemy.events);
        // 有逐艦攻擊陣列時，torpedoAttackEvents 已經把傷害記到攻擊艦；
        // 缺少目標陣列時才使用封包提供的 MVP 合計欄位。
        if (!playerAttacks.detailed) {
            creditDmg(phase.api_fydam, 'player');
            creditDmgList(phase.api_fydam_list_items, 'player');
        }
        if (!enemyAttacks.detailed) {
            creditDmg(phase.api_eydam, 'enemy');
            creditDmgList(phase.api_eydam_list_items, 'enemy');
        }
        return { damage, events };
    };
    // 航空戰（api_kouku / api_kouku2）與噴式強襲（api_injection_kouku /
    // api_air_base_injection）。
    // stage3 = 主隊、stage3_combined = 隨伴（索引 0-5，+6 對映）。
    // 已用真實 6-5 敵聯合封包驗證：不套用 *_combined 會漏算隨伴受傷 → rank 誤判 A（實際 S）。
    const processKouku = (kouku: any, eventKind: 'air' | 'landBase' = 'air'): PhaseResult => {
        const damage = noDamage();
        const events: BattleDamageEvent[] = [];
        const s3 = kouku?.api_stage3;
        if (s3) {
            const own = targetDamage(eventKind, s3.api_fdam, 'enemy', 'player');
            const enemy = targetDamage(eventKind, s3.api_edam, 'player', 'enemy');
            damage.ownDamage += own.total;
            damage.enemyDamage += enemy.total;
            events.push(...own.events, ...enemy.events);
        }
        const s3c = kouku?.api_stage3_combined;
        if (s3c) {
            const own = targetDamage(eventKind, s3c.api_fdam, 'enemy', 'player', 6);
            const enemy = targetDamage(eventKind, s3c.api_edam, 'player', 'enemy', 6);
            damage.ownDamage += own.total;
            damage.enemyDamage += enemy.total;
            events.push(...own.events, ...enemy.events);
        }
        return { damage, events };
    };
    // 友軍艦隊砲擊（api_friendly_battle.api_hougeki）。
    // 友軍只對敵方造成傷害，不計入玩家 MVP。結構與通常 hougeki 相同：
    //   api_at_eflag[i]: 0=友軍攻擊（防御方=敵方）、1=敵方攻擊（防御方=友軍，不影響玩家）
    //   api_df_list[i]: 防御方局部索引（0-5 主隊、6-11 隨伴）
    // 已用真實 61-3 甲 boss 夜戰封包驗證（samples/61-3.json node53 yasen）。
    const processFriendlyHougeki = (phase: any, enemyOffset = 0): PhaseResult => {
        const damage = noDamage();
        const events: BattleDamageEvent[] = [];
        if (!phase || !Array.isArray(phase.api_at_list)) return { damage, events };
        const eflag = phase.api_at_eflag;
        const dfList = phase.api_df_list;
        const dmgList = phase.api_damage;
        for (let i = 0; i < (phase.api_at_list?.length ?? 0); i++) {
            const friendlyAttacks = eflag?.[i] === 0;
            const defenders = dfList?.[i], damages = dmgList?.[i];
            const criticals = phase.api_cl_list?.[i];
            const recordCount = Math.max(
                Array.isArray(defenders) ? defenders.length : 0,
                Array.isArray(damages) ? damages.length : 0,
                Array.isArray(criticals) ? criticals.length : 0,
                1,
            );
            const metadata = attackMetadata(phase, i);
            const multiTarget = (metadata.attackType ?? 0) >= 100 || (metadata.specialType ?? 0) >= 100;
            const targetIndexes = multiTarget
                ? Array.from({ length: recordCount }, (_, j) => targetIndex(Array.isArray(defenders) ? defenders[j] : undefined))
                : [targetIndex(Array.isArray(defenders) ? defenders[0] : undefined)];
            const hitCount = multiTarget
                ? targetIndexes.length
                : Math.max(Array.isArray(damages) ? damages.length : 0, 1);
            const attackerSide: BattleEventSide = friendlyAttacks ? 'friendly' : 'enemy';
            const defenderSide: BattleEventSide | null = friendlyAttacks ? 'enemy' : 'friendly';
            for (let j = 0; j < hitCount; j++) {
                const rawDfIndex = targetIndexes[multiTarget ? j : 0] ?? null;
                if (rawDfIndex === null) continue;
                const dfIndex = friendlyAttacks
                    ? alignNightEnemyIndex(rawDfIndex, enemyOffset) : rawDfIndex;
                const rawDamage = Array.isArray(damages) ? damages[j] : undefined;
                if (rawDamage !== undefined && Number(rawDamage) < 0) continue;
                const dmg = Math.max(0, Math.floor(rawDamage ?? 0));
                const cl = Array.isArray(criticals) ? criticals[j] : criticals;
                events.push(damageEvent(
                    'ship', attackerSide,
                    friendlyAttacks ? phase.api_at_list[i] : alignNightEnemyIndex(phase.api_at_list[i], enemyOffset),
                    defenderSide, dfIndex,
                    dmg, criticalFromFlag(cl), metadata,
                ));
                if (friendlyAttacks) damage.enemyDamage += dmg;
                // 不追蹤 attacker.dealtDamage——友軍不計入玩家 MVP
            }
        }
        return { damage, events };
    };
    // 友軍艦隊雷擊（api_friendly_battle.api_raigeki）。
    // api_edam = 友軍雷擊對敵方造成的傷害，索引為敵方位置。
    const processFriendlyRaigeki = (phase: any, enemyOffset = 0): PhaseResult => {
        const damage = noDamage();
        const events: BattleDamageEvent[] = [];
        if (!phase) return { damage, events };
        const enemy = targetDamage('torpedo', phase.api_edam, 'friendly', 'enemy', enemyOffset);
        damage.enemyDamage = enemy.total;
        events.push(...enemy.events);
        // api_fdam 是敵方雷擊對友軍的傷害，不影響玩家，故不處理
        return { damage, events };
    };

    // 友軍艦隊編成：api_friendly_info 與 api_friendly_battle 同層出現在夜戰封包
    // （已用 samples/61-3.json node53 驗證）。api_ship_id 為 master id（非艦娘實例 id）。
    let friendlyFleetIds: number[] | null = null;
    // 基地航空隊逐波戰果（見 BattleLbasView）。夜戰封包不帶 api_air_base_attack，
    // 但 apiList 可能同時含晝夜兩則，故一律累積不覆寫。
    const lbasWaves: BattleLbasView['waves'] = [];
    // 支援艦隊戰果（見 BattleSupportView）。
    let supportDamage = 0;
    let supportSource: Omit<BattleSupportView, 'damage'> | null = null;
    let supportFlag = Number(initialApi.api_support_flag)
        || Number(initialApi.api_support_info?.api_support_flag)
        || Number(initialApi.api_n_support_flag)
        || Number(initialApi.api_n_support_info?.api_support_flag)
        || 0;

    /**
     * 支援傷害陣列的原始索引正規化：單艦隊封包多一個第 0 格佔位，聯合艦隊則直接是
     * 主隊 0–5／隨伴 6–11。只有長度與目前敵艦欄位吻合時才套用，其他形狀保留原索引。
     */
    const supportTargetOffset = (arr: any): number => {
        if (!Array.isArray(arr)) return 0;
        const targetCount = eMain.length + eEsc.length;
        const first = arr[0];
        return targetCount > 0 && arr.length === targetCount + 1
            && (first === null || first === undefined || first === 0 || first === -1) ? -1 : 0;
    };

    /** 支援欄位在白天與夜戰封包只差一個 `api_n_` 前綴，傷害與編成語意相同。 */
    const processSupport = (sup: any, flagValue: unknown, packet: number): void => {
        if (!sup) return;
        const air = sup.api_support_airatack;
        const hourai = sup.api_support_hourai;
        const packetSupportFlag = Number(flagValue) || Number(sup.api_support_flag) || 0;
        if (packetSupportFlag) supportFlag = packetSupportFlag;
        const airEdam = air?.api_stage3?.api_edam;
        const houraiDamageValues = hourai?.api_damage;
        const airDamage = targetDamage(
            'support', airEdam, 'player', 'enemy', supportTargetOffset(airEdam),
        );
        const houraiDamage = targetDamage(
            'support', houraiDamageValues, 'player', 'enemy', supportTargetOffset(houraiDamageValues),
            hourai?.api_cl_list,
        );
        const src = air ?? hourai;
        if (!src) return;
        const supportKind = supportKindFromFlag(packetSupportFlag, Boolean(air));
        const phaseDamage = airDamage.total + houraiDamage.total;
        supportDamage += phaseDamage;
        recordPhase(
            supportKind === 'asw' ? 'supportAsw'
                : supportKind === 'torpedo' ? 'supportTorpedo'
                    : supportKind === 'air' ? 'supportAir' : 'supportShell',
            packet,
            {
                damage: { ownDamage: 0, enemyDamage: phaseDamage },
                events: [...airDamage.events, ...houraiDamage.events],
            },
        );
        // 同一節點即使先有白天支援、再有夜戰支援，也只保留第一份編成摘要，
        // 避免面板把同一類支援重複畫成兩個系統欄位。
        supportSource ??= {
            kind: supportKind,
            deckId: Number.isSafeInteger(src.api_deck_id) ? src.api_deck_id : 0,
            shipIds: Array.isArray(src.api_ship_id)
                ? src.api_ship_id.filter((v: number) => Number.isSafeInteger(v) && v > 0) : [],
        };
    };

    // 依序走訪所有戰鬥封包與階段。除了產生最終結果，也在每個已存在的階段後留快照，
    // 供出擊紀錄的「交戰記錄」顯示；這裡與既有傷害套用共用同一條路徑，避免兩邊數字漂移。
    for (const [packet, api] of apiList.entries()) {
        if (!api) continue;
        if (hasNightPayload(api)) {
            nightObserved = true;
            const hasEnemyCombined = eEsc.length > 0
                || Array.isArray(api.api_ship_ke_combined)
                || Array.isArray(api.api_e_nowhps_combined)
                || Array.isArray(api.api_e_maxhps_combined);
            if (!hasEnemyCombined) {
                nightTarget = 'main';
            } else if (Array.isArray(api.api_active_deck)) {
                const activeEnemyFleet = Number(api.api_active_deck[1]);
                if (activeEnemyFleet === 1) nightTarget = 'main';
                else if (activeEnemyFleet === 2) nightTarget = 'escort';
                else if (!nightTarget) nightTarget = 'unknown';
            } else if (!nightTarget) {
                // 連合艦隊但封包沒有權威 active-deck 值時，不從傷害位置倒推。
                nightTarget = 'unknown';
            }
        }
        const nightEnemyOffset = nightTarget === 'escort' ? 6 : 0;
        // 遊戲順序：基地航空隊噴式強襲 → 空母噴式強襲 → 基地航空隊一般波次 → 航空戰。
        // `api_air_base_injection` 是基地噴式強襲（KC3Kai／七四式均單獨解析），
        // `api_injection_kouku` 是空母噴式強襲；兩者不應合併成一個「未辨識航空隊」來源。
        if (api.api_air_base_injection) {
            const injections = Array.isArray(api.api_air_base_injection)
                ? api.api_air_base_injection : [api.api_air_base_injection];
            const result = injections.reduce((acc: PhaseResult, injection: any) => {
                const next = processKouku(injection, 'landBase');
                return {
                    damage: {
                        ownDamage: acc.damage.ownDamage + next.damage.ownDamage,
                        enemyDamage: acc.damage.enemyDamage + next.damage.enemyDamage,
                    },
                    events: [...acc.events, ...next.events],
                };
            }, { damage: noDamage(), events: [] });
            recordPhase('jetBase', packet, result);
        }
        if (api.api_injection_kouku) recordPhase('jet', packet, processKouku(api.api_injection_kouku));

        // 基地航空隊（主隊 + 隨伴）。順便彙總出擊／損失機數與對敵傷害（BattleLbasView）——
        // 傷害本來就要逐格套用，這裡只是同一趟把數字加起來，不另外重掃封包。
        if (Array.isArray(api.api_air_base_attack)) {
            const damage = noDamage();
            const events: BattleDamageEvent[] = [];
            for (const ph of api.api_air_base_attack) {
                const main = targetDamage('landBase', ph?.api_stage3?.api_edam, 'player', 'enemy');
                const escort = targetDamage('landBase', ph?.api_stage3_combined?.api_edam, 'player', 'enemy', 6);
                damage.enemyDamage += main.total + escort.total;
                events.push(...main.events, ...escort.events);
                const s1 = ph?.api_stage1;
                // 制空狀態只在「這一波真的有制空戰」時才有意義：雙方都沒出動艦載機時
                // 遊戲照樣送 api_disp_seiku=1（真封包實證 samples/61-4.json），照抄會誤報
                // 「確保」。判準與主隊航空戰同一條——兩軍機數合計為 0 就是沒有制空戰。
                const hasAir = (Number(s1?.api_f_count) || 0) + (Number(s1?.api_e_count) || 0) > 0;
                lbasWaves.push({
                    baseId: Number.isSafeInteger(ph?.api_base_id) ? ph.api_base_id : 0,
                    sent: Math.max(0, Math.floor(s1?.api_f_count ?? 0)),
                    // 制空戰（stage1）＋對空砲火（stage2）兩段損失都要算。
                    lost: Math.max(0, Math.floor(s1?.api_f_lostcount ?? 0))
                        + Math.max(0, Math.floor(ph?.api_stage2?.api_f_lostcount ?? 0)),
                    damage: sumDamage(ph?.api_stage3?.api_edam) + sumDamage(ph?.api_stage3_combined?.api_edam),
                    seiku: hasAir && Number.isSafeInteger(s1?.api_disp_seiku) ? s1.api_disp_seiku : null,
                });
            }
            if (api.api_air_base_attack.length) recordPhase('landBase', packet, { damage, events });
        }
        // 空母噴式強襲已在基地航空隊一般波次之前記錄；接著才是一般航空戰。
        if (api.api_kouku) recordPhase('air', packet, processKouku(api.api_kouku));
        if (api.api_kouku2) recordPhase('airSecond', packet, processKouku(api.api_kouku2));
        // 支援艦隊（對敵）。彙總與套用讀同一批欄位，數字不會兩套（見 BattleSupportView）。
        processSupport(api.api_support_info, api.api_support_flag, packet);
        processSupport(api.api_n_support_info, api.api_n_support_flag, packet);
        // 開幕
        if (api.api_opening_taisen) {
            recordPhase('openingAntiSub', packet, processHougeki(api.api_opening_taisen));
        }
        if (api.api_opening_atack) {
            recordPhase('openingTorpedo', packet, processRaigeki(api.api_opening_atack));
        }
        // 砲擊戰
        if (api.api_hougeki1) recordPhase('shelling1', packet, processHougeki(api.api_hougeki1));
        if (api.api_hougeki2) recordPhase('shelling2', packet, processHougeki(api.api_hougeki2));
        if (api.api_hougeki3) recordPhase('shelling3', packet, processHougeki(api.api_hougeki3));
        // 雷擊戰
        if (api.api_raigeki) recordPhase('torpedo', packet, processRaigeki(api.api_raigeki));
        // 友軍艦隊（活動海域 boss 夜戰，api_friendly_battle 在夜戰封包中）
        const fb = api.api_friendly_battle;
        if (fb) {
            if (fb.api_hougeki) recordPhase('friendlyShelling', packet, processFriendlyHougeki(fb.api_hougeki, nightEnemyOffset));
            if (fb.api_raigeki) recordPhase('friendlyTorpedo', packet, processFriendlyRaigeki(fb.api_raigeki, nightEnemyOffset));
        }
        const fi = api.api_friendly_info;
        if (fi && Array.isArray(fi.api_ship_id)) {
            friendlyFleetIds = fi.api_ship_id.filter((id: number) => id > 0);
        }
        // 夜戰：一般延續與夜轉日的 api_n_hougeki* 都是同一套攻擊資料。
        const nightPhases = nightHougekiPhases(api);
        if (hasNightPayload(api)) noteNightEffects(api);
        if (nightPhases.length) {
            for (const phase of nightPhases)
                recordPhase('nightShelling', packet, processHougeki(phase, nightEnemyOffset));
        }
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

    // 評級預測（我方＝主隊+隨伴，敵方＝主隊+隨伴）。退避艦已不在艦隊裡，不計入損害率。
    const rank = predictRank(
        [...fleets.playerMain, ...fleets.playerEscort].filter(s => !s.escaped),
        [...fleets.enemyMain, ...fleets.enemyEscort],
    );

    // ── 大破警告 ──
    const { isTaiha, flagshipTaiha, flagshipDamecon } = taihaFlags(fleets);

    // ── 出擊 UI 附加資訊 ──
    // 敵艦 master id：現行 api_ship_ke 為 0-indexed、無 leading -1，直接取存在者。
    // **保留原始位置索引**——等級／素質／裝備三個平行陣列都以原始位置對齊，
    // 過濾後直接用新索引去查會在中間有空格時整排錯位。
    const pickEnemies = (keKey: string): { ids: number[]; at: number[] } => {
        const enemyApi = packetWith(api => Array.isArray(api?.[keKey]));
        const ke = enemyApi[keKey];
        const ids: number[] = [], at: number[] = [];
        if (Array.isArray(ke)) ke.forEach((id: number, i: number) => {
            if (id > 0) { ids.push(id); at.push(i); }
        });
        return { ids, at };
    };
    const mainPick = pickEnemies('api_ship_ke');
    // 敵隨伴（敵聯合艦隊），已由 samples/61-3.json node53 實測存在。
    const escortPick = pickEnemies('api_ship_ke_combined');
    const enemyIds = mainPick.ids;
    const enemyIdsEscort = escortPick.ids;
    // 敵艦詳細（等級／素質／裝備），供面板 hover 顯示。皆為戰鬥封包欄位，已用真封包核對
    // （samples/61-3.json、61-4.json、61-5-jibun-rengou-node52.json）：
    //   · `api_ship_lv`／`api_eParam`／`api_eSlot` 對主隊，`*_combined` 對隨伴，
    //     皆 0-indexed 且與 `api_ship_ke` 同序（長度一致，無 leading -1）。
    //   · `api_eParam[i]`＝[火力, 雷裝, 對空, 裝甲]。順序轉寫自社群工具，並由同封包的
    //     `api_fParam` 交叉佐證（戰艦格的第 2 項恆為 0＝雷裝，符合戰艦不能雷擊）。
    //   · `api_eSlot[i]` 是裝備 master id，`-1` 為空格。
    const readEnemyDetail = (
        pick: { ids: number[]; at: number[] }, lvKey: string, paramKey: string, slotKey: string,
    ): BattleEnemyShipView[] => {
        // 詳細欄位與艦名同樣可能只在後續封包出現；每個平行陣列各自找第一份
        // 明確存在的資料，缺席仍維持不可考，不補 0。
        const lvs = packetWith(api => Array.isArray(api?.[lvKey]))[lvKey];
        const params = packetWith(api => Array.isArray(api?.[paramKey]))[paramKey];
        const slots = packetWith(api => Array.isArray(api?.[slotKey]))[slotKey];
        const at = (arr: any, i: number) => (Array.isArray(arr) ? arr[i] : undefined);
        return pick.at.map(i => {
            const lv = at(lvs, i);
            const param = at(params, i);
            const slot = at(slots, i);
            return {
                lv: Number.isSafeInteger(lv) && lv > 0 ? lv : 0,
                param: Array.isArray(param) ? param.map((v: number) => Number(v) || 0) : null,
                slots: Array.isArray(slot)
                    ? slot.filter((v: number) => Number.isSafeInteger(v) && v > 0) : [],
            };
        });
    };

    const formation = [0, 1, 2].map(index => {
        for (const api of apiList) {
            const value = Number(api?.api_formation?.[index]);
            if (Number.isSafeInteger(value) && value > 0) return value;
        }
        return 0;
    });
    // `api_search` 的兩個值分別是我方／敵方結果。依 sortie-detail.ts 已驗證的分組，
    // 只有 1–3 可稱「發現」、4–6 可稱「未發現」；其餘值保留未知，不能硬畫成成功。
    const searchApi = packetWith(api => Array.isArray(api?.api_search));
    const ownSearch = Array.isArray(searchApi.api_search) ? Number(searchApi.api_search[0]) : 0;
    const search = ownSearch >= 1 && ownSearch <= 3 ? 'success'
        : ownSearch >= 4 && ownSearch <= 6 ? 'failed' : 'unknown';
    let seiku = 0;
    let touchPlane = [0, 0];
    const planes = {
        playerFighter: { count: 0, lost: 0 }, playerBomber: { count: 0, lost: 0 },
        enemyFighter: { count: 0, lost: 0 }, enemyBomber: { count: 0, lost: 0 },
    };
    // KC3Kai Node.yasenFlag 使用 api_midnight_flag > 0；不要把未定義的 0
    // 與其他正值混成只有恰好等於 1 才能進夜戰。
    const midnightFlag = apiList.some(api => Number(api?.api_midnight_flag) > 0 || hasNightPayload(api));
    const enemyCombined = eEsc.some(Boolean) || apiList.some(api =>
        Array.isArray(api?.api_ship_ke_combined)
        || Array.isArray(api?.api_e_nowhps_combined)
        || Array.isArray(api?.api_e_maxhps_combined),
    );
    // 日戰封包沒有 `api_active_deck`；只有 KC3Kai 的日戰後分數規則能提供聯合艦隊的
    // 「預測」。單一敵艦隊沒有可切換的隨伴隊，結構上可直接標成主隊；這兩種日戰
    // 判斷都明確標成預測，實際夜戰封包稍後到達時會覆蓋它。
    if (!nightObserved && midnightFlag) {
        const estimated = enemyCombined ? estimateNightTarget() : 'main';
        if (estimated) {
            nightTarget = estimated;
            // 單一敵艦隊的主隊不是依 HP 分數推測，而是由「沒有隨伴隊」的封包結構
            // 直接確定；只有聯合艦隊才需要把這個欄位標成 KC3Kai 式日戰預測。
            if (enemyCombined) nightTargetEstimated = true;
        }
    }
    let aaci = 0;
    const aaciDetails: BattleInfoView['aaciDetails'] = [];
    const aaciSeen = new Set<string>();
    /**
     * `api_idx` 是目前封包使用的 0-based 我方艦位；連合艦隊前六位為主隊、後六位為隨伴。
     * 單艦隊快照若含七艘，則依快照長度將位置留在主隊，避免把遊擊部隊第七艦誤當隨伴。
     * 欄位缺席或超出可辨識範圍時，只保留 Type／裝備，不自行猜艦名。
     * 這個索引規則與 KC3Kai／公開封包樣本一致：單艦隊首艦以 `api_idx: 0` 表示，
     * 聯合艦隊則以全隊 0–11 的位置表示；因此不可再當成 1-based 位置直接取值。
     */
    const aaciShipContext = (rawIndex: unknown): Pick<BattleInfoView['aaciDetails'][number], 'fleet' | 'position' | 'shipId' | 'shipMst'> => {
        const n = rawAttackCode(rawIndex);
        if (n === null || n < 0) return { fleet: 'unknown', position: 0 };
        const main = opts.playerAaciShips?.main ?? [];
        const escort = opts.playerAaciShips?.escort ?? [];
        // 沒有出擊快照時，`api_idx` 只有封包位置、沒有足夠上下文判斷是單艦隊
        // 第七艦還是連合艦隊隨伴；保留未知，避免把舊重播的艦位硬套錯誤隊伍。
        if (!opts.playerAaciShips || (main.length === 0 && escort.length === 0)) {
            return { fleet: 'unknown', position: 0 };
        }
        if (escort.length === 0 && main.length > 0) {
            if (n >= main.length) return { fleet: 'unknown', position: 0 };
            const ship = main[n];
            return {
                fleet: 'main', position: n + 1,
                ...(ship && ship.id > 0 ? { shipId: ship.id } : {}),
                ...(ship && ship.masterId && ship.masterId > 0 ? { shipMst: ship.masterId } : {}),
            };
        }
        const global = n;
        if (global < 6) {
            const ship = main[global];
            return {
                fleet: 'main', position: global + 1,
                ...(ship && ship.id > 0 ? { shipId: ship.id } : {}),
                ...(ship && ship.masterId && ship.masterId > 0 ? { shipMst: ship.masterId } : {}),
            };
        }
        if (global < 12) {
            const pos = global - 6;
            const ship = escort[pos];
            return {
                fleet: 'escort', position: pos + 1,
                ...(ship && ship.id > 0 ? { shipId: ship.id } : {}),
                ...(ship && ship.masterId && ship.masterId > 0 ? { shipMst: ship.masterId } : {}),
            };
        }
        return { fleet: 'unknown', position: 0 };
    };
    const collectAaci = (stage2: any): void => {
        const fire = stage2?.api_air_fire;
        if (!fire) return;
        const type = rawAttackCode(fire.api_kind);
        if (type === null || type <= 0) return;
        const gearMst = attackSlotIds(fire.api_use_items);
        const context = aaciShipContext(fire.api_idx);
        const key = [type, context.fleet, context.position, context.shipId ?? 0, gearMst.join(',')].join('|');
        if (aaciSeen.has(key)) return;
        aaciSeen.add(key);
        aaciDetails.push({ type, gearMst, ...context });
        aaci = type;
    };

    const setTouchPlane = (pair: unknown): void => {
        if (!Array.isArray(pair)) return;
        for (let i = 0; i < 2; i++) {
            const value = Number(pair[i]);
            if (!Number.isFinite(value)) continue;
            // 保留第一個有效接觸；夜戰封包常在白天航空戰後才補上 top-level 值，
            // 負值只作「沒有接觸」的事實，不覆蓋先前已辨識的機體。
            if (value > 0 || touchPlane[i] === 0) touchPlane[i] = value;
        }
    };
    const airApi = packetWith(api => !!api?.api_kouku?.api_stage1 || !!api?.api_kouku2?.api_stage1);
    const s1 = airApi.api_kouku?.api_stage1 ?? airApi.api_kouku2?.api_stage1;
    if (s1) {
        seiku = s1.api_disp_seiku ?? 0;
        setTouchPlane(s1.api_touch_plane);
        planes.playerFighter = { count: s1.api_f_count ?? 0, lost: s1.api_f_lostcount ?? 0 };
        planes.enemyFighter = { count: s1.api_e_count ?? 0, lost: s1.api_e_lostcount ?? 0 };
    }
    const s2 = airApi.api_kouku?.api_stage2 ?? airApi.api_kouku2?.api_stage2;
    if (s2) {
        planes.playerBomber = { count: s2.api_f_count ?? 0, lost: s2.api_f_lostcount ?? 0 };
        planes.enemyBomber = { count: s2.api_e_count ?? 0, lost: s2.api_e_lostcount ?? 0 };
        collectAaci(s2);
    }
    // 夜戰封包可能是同一場中唯一帶有對空 CI 結果的封包；不要只看第一包。
    for (const api of apiList) {
        const stage2 = api?.api_kouku?.api_stage2 ?? api?.api_kouku2?.api_stage2;
        collectAaci(stage2);
    }
    for (const api of apiList) {
        setTouchPlane(api?.api_touch_plane);
        setTouchPlane(api?.api_kouku?.api_stage1?.api_touch_plane);
    }

    const finalSupportSource = supportSource as Omit<BattleSupportView, 'damage'> | null;
    return {
        resultFleets: fleets,
        rank,
        mvp: [mainMvp, escortMvp],
        isTaiha,
        flagshipTaiha,
        flagshipDamecon,
        enemyIds,
        enemyIdsEscort,
        enemyPositions: mainPick.at,
        enemyPositionsEscort: escortPick.at,
        enemyDetail: {
            main: readEnemyDetail(mainPick, 'api_ship_lv', 'api_eParam', 'api_eSlot'),
            escort: readEnemyDetail(escortPick, 'api_ship_lv_combined', 'api_eParam_combined', 'api_eSlot_combined'),
        },
        formation,
        seiku,
        search,
        touchPlane,
        planes,
        drop: null,
        dropIsNew: false,
        supportFlag,
        aaci,
        aaciDetails,
        midnightFlag,
        nightEffects,
        nightObserved,
        ...(nightTouchPlane === undefined ? {} : { nightTouchPlane }),
        nightTarget: nightObserved ? (nightTarget ?? 'unknown') : nightTarget,
        ...(nightObserved || !nightTargetEstimated ? {} : { nightTargetEstimated: true }),
        friendlyFleetIds,
        // 沒有任何一波＝這節點基地航空隊沒出動，回 null 讓面板整段不顯示
        // （0/0/0 會被讀成「出擊了但毫無戰果」，那是另一回事）。
        lbas: lbasWaves.length ? {
            sent: lbasWaves.reduce((n, w) => n + w.sent, 0),
            lost: lbasWaves.reduce((n, w) => n + w.lost, 0),
            damage: lbasWaves.reduce((n, w) => n + w.damage, 0),
            waves: lbasWaves,
        } : null,
        support: finalSupportSource ? {
            kind: finalSupportSource.kind,
            deckId: finalSupportSource.deckId,
            shipIds: finalSupportSource.shipIds,
            damage: supportDamage,
        } : null,
        hasResult: false,
        timeline: { initial: initialSnapshot, phases },
    };
}
