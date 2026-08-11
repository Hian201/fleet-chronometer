// 出擊紀錄的「一次出擊」重建 —— 純資料模組（無 chrome.*，node/vitest 可直接餵真封包）。
//
// 資料來源是既有的兩張表，本模組不新增任何持久化：
//   · db.sorties（SortieLogRow）＝每個節點的**消化後摘要**（rank／掉落／大破／基地空襲），
//     永久保留、不受事件裁剪影響。它是節點序列與勝負的權威。
//   · db.replays（ReplayRow）＝該次出擊的**原始戰鬥封包＋出擊時艦隊快照**。有它才拿得到
//     敵艦等級、制空詳情、基地航空隊各波組成與支援艦隊編組——這些欄位摘要裡沒有。
//
// 節點戰鬥細節**不自行重寫一套解析**：直接餵 utils/battle.ts 的 `analyzeBattle()`
// （面板即時監控用的同一支純函式），故 overview 展開看到的資訊與當初面板顯示的一致，
// 且日後戰鬥解析修正兩邊同時受惠。damecon 由快照的裝備 master id 還原（42=応急修理要員、
// 43=応急修理女神，同 state.ts getDamecon），不是猜的。
//
// ── 已用真封包驗證的欄位（samples/61-3.json、61-5-jibun-rengou-node52.json）──
//   · api_air_base_attack：**陣列**，一波一個元素；`api_base_id`＝第幾基地、
//     `api_squadron_plane[]`＝該波出擊的中隊（api_mst_id／api_count）、
//     `api_stage1.api_disp_seiku`＝該波制空狀態。
//     （注意：基地「防空」的 api_destruction_battle 底下同名欄位是**物件不是陣列**，
//      那條路徑不經過本模組——空襲節點只有 db.sorties 的摘要，見 event-projector.ts。）
//   · api_support_info：`api_support_airatack`（航空支援類）與 `api_support_hourai`
//     （砲擊支援類）擇一非 null，兩者都帶 `api_deck_id` 與 `api_ship_id[]`。
//     ⚠️ `api_ship_id` 是**艦實例 id 不是 master id**，要靠當前 GameState.ships 反查
//     （呼叫端負責；本模組只如實回傳原始 id）。
import { analyzeBattle } from './battle';
import type { ReplayLbas, ReplayNode, ReplayRow, ReplayShip, ReplaySupportShip, SortieLogRow } from './db';
import { repairLegacyReplayFleet } from './replay';
import type { BattleInfoView } from './state';
import { t } from './ui-i18n';

/** 応急修理要員／女神的裝備 master id（同 state.ts getDamecon 的判定值）。 */
const DAMECON_MST = 42;
const GODDESS_MST = 43;

/**
 * 活動海域判定。一般海域 world 為 1–7（含未來擴充的個位數），活動海域歷來都是兩位數以上
 * （近期為 61／62）。以 >= 10 為界，不列舉活動編號——活動每次都換號，列舉必然過期。
 */
export function isEventWorld(world: number): boolean {
    return Number.isSafeInteger(world) && world >= 10;
}

/** `SortieLogRow.map`（`${mapArea}-${mapNo}`）→ 數值。解析不出時回 world 0。 */
export function parseMapCode(map: string): { world: number; mapnum: number } {
    const m = /^(\d+)-(\d+)$/.exec(map ?? '');
    return m ? { world: Number(m[1]), mapnum: Number(m[2]) } : { world: 0, mapnum: 0 };
}

/**
 * 海域代號的顯示寫法：活動用玩家的說法 `E{n}`，一般海域維持 `6-5`。完整編號（62-1）
 * 留給 title。
 *
 * `map` 是原始字串，解析不出 world/mapnum 時原樣顯示它（不用 `${world}-${mapnum}`
 * 反組，那樣會把不可考的紀錄顯示成「0-0」）。
 *
 * **面板與出擊紀錄分區共用同一支**：兩邊寫法必須一致，日後改活動海域的表記法也只有
 * 一處要動。難度徽章（`diffLabel`）同理。
 */
export function mapLabel(entry: { event: boolean; mapnum: number; map: string }): string {
    return entry.event ? `E${entry.mapnum}` : entry.map;
}

// 活動難度 api_selected_rank：1丁 2丙 3乙 4甲（0＝一般圖或尚未選難度）。
const DIFF_KEYS = ['', 'ov.slDiff1', 'ov.slDiff2', 'ov.slDiff3', 'ov.slDiff4'];

/** 難度徽章文字（活動限定；0＝一般圖或尚未選難度時回空字串＝不顯示）。 */
export const diffLabel = (diff: number) => (DIFF_KEYS[diff] ? t(DIFF_KEYS[diff]) : '');

/** 基地航空隊的一波出擊（api_air_base_attack 的一個元素）。 */
export interface LbasWave {
    baseId: number;
    planes: { mst: number; count: number }[];
    /**
     * 該波制空（0互角/1確保/2優勢/3劣勢/4喪失）；stage1 缺席**或這一波沒有制空戰**時
     * 為 null。後者是必要的：雙方都沒出動艦載機時遊戲照樣送 `api_disp_seiku: 1`，
     * 照抄會誤報「確保」（判準與面板同一條，見 CLAUDE.md「別只改一邊」）。
     */
    seiku: number | null;
    fCount: number; fLost: number;
    eCount: number; eLost: number;
}

/** 支援艦隊的一次出動。shipIds 為**艦實例 id**（非 master id），呼叫端自行反查名稱。 */
export interface SupportUse {
    deckId: number;
    /** air＝走 api_support_airatack（航空／對潛支援），shell＝走 api_support_hourai（砲擊系）。 */
    kind: 'air' | 'shell';
    /** 原始 api_support_flag，僅供顯示／除錯（各值語意未逐一以真封包驗證，不據以分類）。 */
    flag: number;
    shipIds: number[];
}

/** 出擊編成的一艘（快照 + 戰鬥後 HP）。 */
export interface SortieShip {
    mst: number;
    lv: number;
    equip: number[];
    stars: number[];
    exequip: number;
    cond: number | null;
    /** 出擊當下的 HP（快照值）。 */
    hp: number | null; maxHp: number | null;
}

/** 一個節點。無 replay 封包時只有摘要欄位，battle/lbas/support 皆為空。 */
export interface NodeDetail {
    node: number;
    boss: boolean;
    kind: 'battle' | 'raid';
    /** 結算 rank；raid 或尚無結算時為空字串。 */
    rank: string;
    /** 摘要的制空（raid 亦有值）。有 battle 時以 battle.seiku 為準。 */
    seiku: number | null;
    taiha: boolean;
    drop: string | null;
    dropMst?: number;
    /** 提督經驗值／MVP 位置（1-based）／敵艦隊名——皆來自 battleresult，舊紀錄沒有。 */
    getExp?: number;
    /** 基礎經驗值：只有從 KC3Kai 匯出匯入的紀錄才有（遊戲封包沒這欄）。 */
    baseExp?: number;
    /** 節點類型的原始欄位（見 utils/map-node-kind.ts）。舊紀錄沒有。 */
    nodeEventId?: number;
    nodeEventKind?: number;
    mvp?: number;
    mvpEscort?: number;
    enemyName?: string;
    raidLostKind?: number;
    /** 敵主隊／隨伴 master id（摘要欄位，無 replay 時仍有）。 */
    enemyIds: number[];
    enemyIdsEscort: number[];
    /** 以下需要原始封包 —— 沒有 replay 時為 null／空陣列。 */
    battle: BattleInfoView | null;
    /** 敵艦等級（api_ship_lv／api_ship_lv_combined，與 enemyIds 同序）。 */
    enemyLv: number[];
    enemyLvEscort: number[];
    lbas: LbasWave[];
    support: SupportUse | null;
    /** 該節點有夜戰接續（replay 節點帶 yasen）。 */
    night: boolean;
    /**
     * 索敵結果 `api_search`＝[我方, 敵方]。**只把 1–3 視為「發現」、4–6 視為「未發現」**
     * （樣本實測值只出現過 1 與 5；各子分類的確切語意未經真封包驗證，故 UI 要同時顯示原始值）。
     */
    search: number[];
}

/** 一次出擊（一個 sortieKey）。 */
export interface SortieDetail {
    sortieKey: number;
    ts: number;
    map: string;
    world: number;
    mapnum: number;
    event: boolean;
    /** api_selected_rank（0＝一般圖／未選難度，1丁 2丙 3乙 4甲）。 */
    diff: number;
    combined: number;
    fleetnum: number;
    fleet1: SortieShip[];
    fleet2: SortieShip[];
    nodes: NodeDetail[];
    /**
     * 支援艦隊（彙整到出擊層級）：同一支出動多次只一列，附上在哪些節點出動。
     * `boss` ＝ 曾在 boss 節點出動（＝決戰支援；否則為道中支援）。
     * `fleet` ＝ 出擊當下的第 3／4 艦隊快照（新紀錄才有；舊紀錄為 null，只能靠 use.shipIds
     * 的**艦實例 id** 反查名字）。
     */
    supports: { use: SupportUse; nodes: number[]; boss: boolean; fleet: SortieShip[] | null }[];
    /** 出擊當下的基地航空隊快照（新紀錄才有）。 */
    lbas: ReplayLbas[];
    /** 各節點實際出擊的基地航空隊波次（依節點順序）。 */
    lbasWaves: { wave: LbasWave; node: number }[];
    /** 本次出擊取得的提督經驗值合計（缺欄位的節點不計）。 */
    totalExp: number;
    /** 這次出擊打到了 boss 節點。 */
    boss: boolean;
    /** 這次出擊擊破了該海域量表（斬殺）。 */
    cleared: boolean;
    taiha: boolean;
    /**
     * 本次出擊的掉落。**保留 master id**——匯入的紀錄可能只有 id 沒有名字，
     * 名字要由呼叫端依當前語言解析（同 NodeDetail.drop／dropMst）。
     */
    drops: { drop: string | null; dropMst?: number }[];
    /** 最後一個戰鬥節點的 rank（清單列的代表值）；無戰鬥節點時為空字串。 */
    lastRank: string;
    hasReplay: boolean;
}

/** 依 sortieKey 分組。輸入須為時間（eventId）升冪；輸出亦為升冪。 */
export function groupSorties(rows: SortieLogRow[]): { sortieKey: number; rows: SortieLogRow[] }[] {
    const groups: { sortieKey: number; rows: SortieLogRow[] }[] = [];
    for (const r of rows) {
        const last = groups[groups.length - 1];
        if (last && last.sortieKey === r.sortieKey) last.rows.push(r);
        else groups.push({ sortieKey: r.sortieKey, rows: [r] });
    }
    return groups;
}

/** 一次出擊的時間＝第一筆摘要的 ts。用於「第幾次」計數與清單排序。 */
export const sortieTime = (group: { rows: SortieLogRow[] }): number => group.rows[0]?.ts ?? 0;

/**
 * 「這張海域的第幾次出擊」。依**時間**升冪逐張海域各自計數，回傳 sortieKey → 序號。
 * **不隨篩選變動**（序號是該海域的歷史事實，篩選只是視窗）——故呼叫端要餵全部紀錄，
 * 不是篩選後的子集。
 *
 * 依時間而非 event ID 排序，是因為**匯入的紀錄**（utils/sortie-import.ts）會拿到當下最大的
 * event ID，但它的時間可能很舊；照 ID 數會讓一場三年前的出擊被算成「最新一次」。
 */
export function numberSorties(groups: { sortieKey: number; rows: SortieLogRow[] }[]): Map<number, number> {
    const counter = new Map<string, number>();
    const out = new Map<number, number>();
    for (const g of [...groups].sort((a, b) => sortieTime(a) - sortieTime(b))) {
        const map = g.rows[0]?.map ?? '';
        const n = (counter.get(map) ?? 0) + 1;
        counter.set(map, n);
        out.set(g.sortieKey, n);
    }
    return out;
}

/** 快照的裝備 → damecon 種別（0無／1要員／2女神），同 state.ts getDamecon。 */
function dameconOf(ship: ReplayShip): number {
    const all = [...(ship.equip ?? []), ship.exequip];
    if (all.includes(GODDESS_MST)) return 2;
    if (all.includes(DAMECON_MST)) return 1;
    return 0;
}

/** 基地航空隊各波（api_air_base_attack）。非陣列（含基地防空的物件形態）一律回空陣列。 */
export function lbasWaves(api: any): LbasWave[] {
    const list = api?.api_air_base_attack;
    if (!Array.isArray(list)) return [];
    const out: LbasWave[] = [];
    for (const wave of list) {
        if (!wave) continue;
        const planes = Array.isArray(wave.api_squadron_plane)
            ? wave.api_squadron_plane
                .filter((p: any) => p && Number(p.api_mst_id) > 0)
                .map((p: any) => ({ mst: Number(p.api_mst_id), count: Number(p.api_count) || 0 }))
            : [];
        const s1 = wave.api_stage1;
        // 兩軍機數合計為 0 ＝這一波沒有制空戰，不報制空狀態（見 LbasWave.seiku）。
        const hasAir = (Number(s1?.api_f_count) || 0) + (Number(s1?.api_e_count) || 0) > 0;
        out.push({
            baseId: Number(wave.api_base_id) || 0,
            planes,
            seiku: hasAir && Number.isSafeInteger(s1?.api_disp_seiku) ? s1.api_disp_seiku : null,
            fCount: s1?.api_f_count ?? 0, fLost: s1?.api_f_lostcount ?? 0,
            eCount: s1?.api_e_count ?? 0, eLost: s1?.api_e_lostcount ?? 0,
        });
    }
    return out;
}

/** 支援艦隊出動（api_support_info）。兩種結構擇一，皆無則 null。 */
export function supportUse(api: any): SupportUse | null {
    const info = api?.api_support_info;
    if (!info) return null;
    const flag = Number(api?.api_support_flag) || Number(info.api_support_flag) || 0;
    const air = info.api_support_airatack;
    const shell = info.api_support_hourai;
    const src = air ?? shell;
    if (!src) return null;
    return {
        deckId: Number(src.api_deck_id) || 0,
        kind: air ? 'air' : 'shell',
        flag,
        shipIds: Array.isArray(src.api_ship_id) ? src.api_ship_id.filter((v: number) => v > 0) : [],
    };
}

/** 敵艦等級（api_ship_lv／api_ship_lv_combined）。與 api_ship_ke 同為 0-indexed、無 -1。 */
function enemyLevels(api: any, key: 'api_ship_lv' | 'api_ship_lv_combined', ids: number[]): number[] {
    const raw = api?.[key];
    if (!Array.isArray(raw)) return [];
    // 防禦：長度與 id 不一致時只取前 ids.length 個，不做位移猜測。
    return raw.slice(0, ids.length).map((v: number) => Number(v) || 0);
}

function toSortieShip(s: ReplayShip | ReplaySupportShip): SortieShip {
    return {
        mst: s.mst_id, lv: s.lv, equip: s.equip ?? [], stars: s.stars ?? [],
        exequip: s.exequip ?? -1, cond: s.cond ?? null,
        hp: s.nowhp ?? null, maxHp: s.maxhp ?? null,
    };
}

/** 出擊快照的裝備 master id（含補強增設），供夜戰裝備發動判定使用。 */
function gearMasterIds(s: ReplayShip): number[] {
    return [...(s.equip ?? []), s.exequip].filter((mst): mst is number => Number.isSafeInteger(mst) && mst > 0);
}

/** 對一個 replay 節點跑戰鬥重放。封包損壞時不讓整頁掛掉，回 null（UI 退回摘要欄位）。 */
function analyzeNode(entry: ReplayNode, replay: ReplayRow): BattleInfoView | null {
    const day: any = entry.data;
    if (!day?.api_f_nowhps) return null;
    const damecons = {
        main: replay.fleet1.map(dameconOf),
        escort: replay.fleet2.map(dameconOf),
    };
    try {
        const playerGearIds = {
            main: replay.fleet1.map(gearMasterIds),
            escort: replay.fleet2.map(gearMasterIds),
        };
        return entry.yasen
            ? analyzeBattle([day, entry.yasen], damecons, { playerGearIds })
            : analyzeBattle([day], damecons, { playerGearIds });
    } catch {
        return null;
    }
}

/**
 * 把「一次出擊的摘要列」＋（可選）「該次出擊的重播列」組成完整的展開資料。
 *
 * 節點序列以摘要列為準（含只有摘要的基地空襲節點）；replay 的戰鬥封包依節點 id 由前往後
 * 對應消化。replay 有、摘要沒有的節點（例如面板中途關閉、battleresult 沒歸檔）補在最後，
 * rank 留空——**不臆測結果**。
 */
export function buildSortieDetail(rows: SortieLogRow[], replay?: ReplayRow): SortieDetail {
    if (replay) replay = repairLegacyReplayFleet(replay);
    const ordered = [...rows].sort((a, b) => a.eventId - b.eventId);
    const first = ordered[0];
    const map = first?.map ?? '';
    const parsed = parseMapCode(map);
    const world = replay?.world || parsed.world;
    const mapnum = replay?.mapnum || parsed.mapnum;

    const battles = replay?.battles ?? [];
    const used = new Array(battles.length).fill(false);
    /** 從 cursor 往後找第一個同節點且未被消化的戰鬥封包。 */
    const takeBattle = (node: number): ReplayNode | undefined => {
        for (let i = 0; i < battles.length; i++) {
            if (!used[i] && battles[i].node === node) { used[i] = true; return battles[i]; }
        }
        return undefined;
    };

    const nodes: NodeDetail[] = ordered.map(row => {
        const entry = row.kind === 'battle' ? takeBattle(row.node) : undefined;
        return nodeDetail(row, entry, replay);
    });
    // 摘要沒對應到的戰鬥封包（節點打了但沒歸檔結算）——照時序補在最後，rank 留空。
    battles.forEach((entry, i) => {
        if (used[i]) return;
        nodes.push(nodeDetail(null, entry, replay, entry.node));
    });

    // 支援艦隊與基地航空隊在封包裡是**逐節點**出現的，彙整到出擊層級（展開時第一眼要看的是
    // 「這次帶了什麼」）。支援艦隊對應快照：api_deck_id 3 → fleet3、4 → fleet4。
    const supportMap = new Map<string, { use: SupportUse; nodes: number[]; boss: boolean; fleet: SortieShip[] | null }>();
    const lbasWaves: { wave: LbasWave; node: number }[] = [];
    for (const n of nodes) {
        if (n.support) {
            const key = `${n.support.deckId}/${n.support.kind}`;
            const hit = supportMap.get(key) ?? {
                use: n.support, nodes: [], boss: false,
                fleet: supportFleet(replay, n.support.deckId),
            };
            hit.nodes.push(n.node);
            hit.boss ||= n.boss;
            supportMap.set(key, hit);
        }
        for (const wave of n.lbas) lbasWaves.push({ wave, node: n.node });
    }

    const battleNodes = nodes.filter(n => n.kind === 'battle');
    return {
        sortieKey: first?.sortieKey ?? replay?.sortieKey ?? 0,
        ts: first?.ts ?? replay?.ts ?? 0,
        map, world, mapnum,
        event: isEventWorld(world),
        diff: replay?.diff ?? 0,
        combined: replay?.combined ?? 0,
        fleetnum: replay?.fleetnum ?? 0,
        fleet1: (replay?.fleet1 ?? []).map(toSortieShip),
        fleet2: (replay?.fleet2 ?? []).map(toSortieShip),
        nodes,
        supports: [...supportMap.values()],
        lbas: replay?.lbas ?? [],
        lbasWaves,
        totalExp: nodes.reduce((sum, n) => sum + (n.getExp ?? 0), 0),
        boss: nodes.some(n => n.boss),
        cleared: ordered.some(r => r.cleared),
        taiha: nodes.some(n => n.taiha),
        drops: ordered
            .filter(r => r.drop || r.dropMst)
            .map(r => ({ drop: r.drop, ...(r.dropMst ? { dropMst: r.dropMst } : {}) })),
        lastRank: battleNodes.length ? battleNodes[battleNodes.length - 1].rank : '',
        hasReplay: !!replay,
    };
}

/** 支援艦隊 deck id（3／4）→ 出擊當下的艦隊快照。舊紀錄沒有快照時回 null（不猜）。 */
function supportFleet(replay: ReplayRow | undefined, deckId: number): SortieShip[] | null {
    const raw = deckId === 3 ? replay?.fleet3 : deckId === 4 ? replay?.fleet4 : undefined;
    return raw?.length ? raw.map(toSortieShip) : null;
}

function nodeDetail(row: SortieLogRow | null, entry: ReplayNode | undefined, replay: ReplayRow | undefined, fallbackNode = 0): NodeDetail {
    const api: any = entry?.data;
    const battle = entry && replay ? analyzeNode(entry, replay) : null;
    const enemyIds = row?.enemyIds ?? battle?.enemyIds ?? [];
    const enemyIdsEscort = row?.enemyIdsEscort ?? battle?.enemyIdsEscort ?? [];
    const search = Array.isArray(api?.api_search) ? api.api_search.map((v: number) => Number(v) || 0) : [];
    return {
        node: row?.node ?? fallbackNode,
        boss: row?.boss ?? false,
        kind: row?.kind ?? 'battle',
        rank: entry?.rank ?? row?.rank ?? '',
        seiku: row?.seiku ?? (battle ? battle.seiku : null),
        taiha: row?.taiha ?? battle?.isTaiha ?? false,
        drop: row?.drop ?? null,
        ...(row?.dropMst === undefined ? {} : { dropMst: row.dropMst }),
        ...(row?.getExp === undefined ? {} : { getExp: row.getExp }),
        ...(row?.baseExp === undefined ? {} : { baseExp: row.baseExp }),
        ...(row?.nodeEventId === undefined ? {} : { nodeEventId: row.nodeEventId }),
        ...(row?.nodeEventKind === undefined ? {} : { nodeEventKind: row.nodeEventKind }),
        ...(row?.mvp === undefined ? {} : { mvp: row.mvp }),
        ...(row?.mvpEscort === undefined ? {} : { mvpEscort: row.mvpEscort }),
        ...(row?.enemyName === undefined ? {} : { enemyName: row.enemyName }),
        ...(row?.raidLostKind === undefined ? {} : { raidLostKind: row.raidLostKind }),
        enemyIds, enemyIdsEscort,
        battle,
        enemyLv: enemyLevels(api, 'api_ship_lv', enemyIds),
        enemyLvEscort: enemyLevels(api, 'api_ship_lv_combined', enemyIdsEscort),
        lbas: lbasWaves(api),
        support: supportUse(api),
        night: !!entry?.yasen,
        search,
    };
}
