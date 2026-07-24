// 出擊重播的組裝／匯出 —— 純資料模組（無 chrome.*）。把出擊過程的原始戰鬥封包＋
// 出擊時艦隊快照，累積成 db.replays 的 ReplayRow，並可輸出成 KC3Kai kancolle-replay
// 「battleplayer」能直接重播（並另存圖片）的物件。
//
// 為何獨立成模組：資料格式與 GameState reduce 邏輯無關，且格式外部相容性（KC3Kai）
// 屬「一經確定就別亂動」的邊界。快照從 GameState 的公開原始欄位（ships/decks/slotItems）
// 讀取，故 state.ts 不必新增方法、維持可獨立編譯（設計原則 4）。
//
// 格式來源（見 CLAUDE.md 出擊紀錄章節）：KC3Kai player.js 解析端 ＋ poi→kc3 轉換器
// 交叉確認——替播物件頂層 { fleet1, fleet2, fleetnum, combined, battles:[{node,data,yasen}],
// world, mapnum, time }；每個 battles[].data 就是一則原始 kcsapi 戰鬥封包
// （與 samples/61-5-jibun-rengou-node52.json 同格式，該樣本本身即 KC3Kai logger 匯出）。
import type { GameState } from './state';
import type { ReplayLbas, ReplayRow, ReplayShip, ReplayNode } from './db';

// GameState 的原始欄位型別在 state.ts 是 any（封包直存），此處取需要的欄位即可。
type RawShip = {
    api_ship_id: number; api_lv: number; api_nowhp: number; api_maxhp: number;
    api_cond: number; api_slot: number[]; api_slot_ex: number; api_kyouka?: number[];
};

// 從 GameState 快照某艦隊（deckId 0-based）成 ReplayShip[]。空位（艦 id ≤0）略過。
export function snapshotDeck(gs: GameState, deckId: number): ReplayShip[] {
    const deck = gs.decks[deckId];
    if (!deck) return [];
    const out: ReplayShip[] = [];
    for (const sid of deck.api_ship as number[]) {
        if (sid <= 0) continue;
        const s = gs.ships.get(sid) as RawShip | undefined;
        if (!s) continue;
        const slots: number[] = s.api_slot ?? [];
        const equip: number[] = [], stars: number[] = [], ace: number[] = [];
        for (const gid of slots) {
            const it = gid > 0 ? gs.slotItems.get(gid) : undefined;
            equip.push(it ? it.mst : -1);
            stars.push(it ? it.level : 0);
            ace.push(it ? it.alv : 0);
        }
        const exIt = s.api_slot_ex > 0 ? gs.slotItems.get(s.api_slot_ex) : undefined;
        out.push({
            mst_id: s.api_ship_id, lv: s.api_lv,
            equip, stars, ace,
            exequip: exIt ? exIt.mst : -1,
            nowhp: s.api_nowhp, maxhp: s.api_maxhp, cond: s.api_cond,
            kyouka: s.api_kyouka,
        });
    }
    return out;
}

// 出擊當下的基地航空隊快照（只取該海域的基地）。戰鬥封包的 api_air_base_attack 只會出現
// 「有出擊的那幾波」，答不了「這次出擊時三個基地各自的編成與行動」——那只能在此刻快照。
// 讀 GameState 的原始 airBases／slotItems 公開欄位，不經 airBases_()（那支要 t() 翻譯，
// 且會把未配置中隊填成顯示用文字；此處要的是原始事實）。
export function snapshotLbas(gs: GameState, areaId: number): ReplayLbas[] {
    const out: ReplayLbas[] = [];
    for (const ab of gs.airBases.values()) {
        if (ab?.api_area_id !== areaId) continue;
        const squadrons = (ab.api_plane_info ?? []).map((sq: any) => {
            const it = sq?.api_slotid > 0 ? gs.slotItems.get(sq.api_slotid) : undefined;
            return {
                mst: it?.mst ?? 0,
                count: sq?.api_count ?? 0,
                maxCount: sq?.api_max_count ?? 0,
                stars: it?.level ?? 0,
                ace: it?.alv ?? 0,
                state: sq?.api_state ?? 0,
                cond: sq?.api_cond ?? 1,
            };
        });
        const dist = ab.api_distance;
        out.push({
            areaId: ab.api_area_id, rid: ab.api_rid,
            action: ab.api_action_kind ?? 0,
            distance: (dist?.api_base ?? 0) + (dist?.api_bonus ?? 0),
            squadrons,
        });
    }
    return out.sort((a, b) => a.rid - b.rid);
}

// 出擊開始（api_req_map/start）：建立一筆重播列（艦隊快照 + 基地航空隊快照 + 海域資訊）。
// combined>0 時第二艦隊（deck index 1）為隨伴；否則只帶出擊的那支艦隊。
// 第3/4艦隊一律快照為**支援艦隊候補**（實際有沒有出動看戰鬥封包的 api_support_info，
// 對應靠 api_deck_id）——支援艦隊的等級與裝備只有此刻拿得到。
export function startReplay(gs: GameState, sortieKey: number, ts: number, mapStartApi: any): ReplayRow {
    const combined = gs.combinedFlag ?? 0;
    const mainDeck = gs.currentSortieFleetId;
    const world = mapStartApi?.api_maparea_id ?? 0;
    const fleet3 = snapshotDeck(gs, 2);
    const fleet4 = snapshotDeck(gs, 3);
    const lbas = snapshotLbas(gs, world);
    return {
        sortieKey, ts,
        world,
        mapnum: mapStartApi?.api_mapinfo_no ?? 0,
        diff: 0,   // api_selected_rank 不在 map/start，回填見 setDifficulty()
        combined,
        fleetnum: mainDeck + 1,
        fleet1: snapshotDeck(gs, combined > 0 ? 0 : mainDeck),
        fleet2: combined > 0 ? snapshotDeck(gs, 1) : [],
        ...(fleet3.length ? { fleet3 } : {}),
        ...(fleet4.length ? { fleet4 } : {}),
        ...(lbas.length ? { lbas } : {}),
        battles: [],
        hqLv: gs.hqLv,
        nickname: gs.nickname,
    };
}

// 難度回填（mapinfo 已驗證的 api_selected_rank）。
export function setDifficulty(row: ReplayRow, diff: number) {
    if (Number.isSafeInteger(diff) && diff > 0) row.diff = diff;
}

// 追加/合併一個戰鬥節點。晝戰先到（建節點），夜戰接續則併入同一節點的 yasen，
// battleresult 補 rank。node 以 edge id 對齊；找不到同 id 就新建（防禦）。
export function appendBattle(row: ReplayRow, node: number, kind: 'day' | 'night' | 'result', data: unknown, rank?: string) {
    let n: ReplayNode | undefined = row.battles[row.battles.length - 1];
    // 夜戰接續：併入最後一個尚無 yasen 的同節點；否則新建
    if (kind === 'night' && n && n.node === node && !n.yasen) { n.yasen = data; return; }
    if (kind === 'result') { if (n && n.node === node && rank) n.rank = rank; return; }
    // 晝戰（含開幕夜戰 sp_midnight，一律當作該節點主資料）：新節點
    n = { node, data };
    row.battles.push(n);
}

// 輸出成 KC3Kai battleplayer 可貼上的物件。ship 欄位名對齊 KC3Kai（nowhps/maxhps 複數）；
// stats 由 battleplayer 依 mst_id+lv+equip 自行從其艦娘/裝備 DB 計算，故此處不帶。
export function toKc3Replay(row: ReplayRow): object {
    const ship = (s: ReplayShip) => ({
        mst_id: s.mst_id, lv: s.lv,
        equip: s.equip, stars: s.stars, ace: s.ace, exequip: s.exequip,
        nowhps: s.nowhp, maxhps: s.maxhp,
    });
    return {
        version: 4,
        combined: row.combined,
        fleetnum: row.fleetnum,
        fleet1: row.fleet1.map(ship),
        fleet2: row.fleet2.map(ship),
        battles: row.battles.map(b => ({ node: b.node, data: b.data, yasen: b.yasen ?? null })),
        world: row.world, mapnum: row.mapnum, diff: row.diff,
        time: row.ts,
        hq: row.nickname,
    };
}
