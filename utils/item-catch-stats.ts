// 「打撈紀錄 › 道具捕撈」的統計核心（純函式，無 chrome.*／無 DOM，node 可測）：
// 把 db.sorties 的 `useItemDrops` 依大海域／海域／節點彙總成某一種道具（預設秋刀魚 68）的
// 捕獲紀錄。規格見 docs/saury-plan.md §4.2。
//
// ── 三個數字不可混用 ────────────────────────────────────────────────────
//   · n＝道具結果**已知**的結算場數（`useItemDrops` 為陣列，含 []）；k＝其中有該道具的場數；
//     u＝道具結果**不可考**的結算場數（欄位缺席：舊紀錄、匯入列）。u 不併入 n 當未命中。
//   · caught＝捕獲條數，按 id 在陣列中出現的次數加總；與命中場數 k 分開。
//   · sorties＝出擊趟數（相異 sortieKey）。n 是節點結算場數，一趟多個漁點會貢獻多場。
//
// ── 不做的判斷 ──────────────────────────────────────────────────────────
// 不判定哪些節點「有資格掉魚」：所選期間內有紀錄的戰鬥節點全部列出，從未捕獲的也保留 0，
// 分母不因首筆捕獲而改變。不推算枯竭、恢復或掉率；連續無魚場數只是紀錄事實。
// 基地空襲（kind='raid'）沒有結算道具，不列入。
//
// 活動海域（world >= 10）不列入：秋刀魚祭的漁場歷來是通常海域，活動海域掉的道具（含少數年度
// 活動也掉魚的情況）混進來會讓「大海域」與換海域判斷失真。往後營運明說活動海域也是漁場時再改。
import type { SortieLogRow } from './db';
import { isEventWorld, parseMapCode } from './sortie-detail';

/** 道具捕撈統計收的結算：通常海域的戰鬥列（catchOnly 列照收）。 */
export function isCatchRow(row: SortieLogRow): boolean {
    return row.kind === 'battle' && !isEventWorld(parseMapCode(row.map).world);
}

/** 勝利等級分列：S、A 與其他（B 以下、缺 rank）。 */
export type CatchRank = 'S' | 'A' | 'other';

export interface CatchCounts {
    /** 道具結果已知的結算場數。 */
    n: number;
    /** 其中有該道具的場數。 */
    k: number;
    /** 道具結果不可考的結算場數。 */
    u: number;
    /** 捕獲條數。 */
    caught: number;
}

/** 上次捕獲之後的紀錄：n＝已知無魚場數（再分 S／A），u＝其間不可考場數。 */
export interface DryStreak {
    n: number;
    s: number;
    a: number;
    u: number;
}

interface CatchGroup {
    total: CatchCounts;
    byRank: Record<CatchRank, CatchCounts>;
    /** 出擊趟數（相異 sortieKey）。 */
    sorties: number;
}

export interface NodeCatchStat extends CatchGroup {
    map: string;
    /** 原始 edge id；字母由 UI 經 map-node-letters 查表。 */
    node: number;
}

interface CatchTimeline extends CatchGroup {
    /** 截止時間前 6／24 小時內的捕獲條數（工具的查詢時窗，不是遊戲機制週期）。 */
    recent6h: number;
    recent24h: number;
    /** 最後捕獲與最後一場戰鬥結算的時刻；兩者都不代表漁場恢復。 */
    lastCatchTs: number | null;
    lastBattleTs: number | null;
    /** 期間內沒有任何捕獲時為 null（沒有「上次捕獲」可當起點）。 */
    dryStreak: DryStreak | null;
}

export interface MapCatchStat extends CatchTimeline {
    map: string;
    nodes: NodeCatchStat[];
}

export interface AreaCatchStat extends CatchTimeline {
    /** 大海域（`map` 的前段）。分組只是整理方式，不代表遊戲內共用同一個隱藏值。 */
    area: number;
    maps: MapCatchStat[];
}

export interface ItemCatchStats {
    itemId: number;
    /** 所選期間的已記錄捕獲條數；不是完整年度總數。 */
    caught: number;
    /** 首筆／最後一筆捕獲；首筆捕獲不是記錄功能的啟用時間。 */
    firstCatchTs: number | null;
    lastCatchTs: number | null;
    /** 期間內第一場與最後一場戰鬥結算（觀測區間）；沒有紀錄時為 null。 */
    observedFrom: number | null;
    observedTo: number | null;
    /** 不可考的結算場數合計。 */
    unknown: number;
    areas: AreaCatchStat[];
}

export interface ItemCatchQuery {
    itemId: number;
    /** 期間（含端點；null＝不設限）。 */
    from: number | null;
    to: number | null;
    /** 近 6／24 小時時窗的基準：`to` 有值時以它為準（歷史檢視），否則用這個時刻。 */
    now: number;
}

const HOUR = 3_600_000;

const emptyCounts = (): CatchCounts => ({ n: 0, k: 0, u: 0, caught: 0 });

export function catchRank(rank: string): CatchRank {
    return rank === 'S' || rank === 'A' ? rank : 'other';
}

/** 一場結算對該道具的結果；null＝不可考。 */
function catchOf(row: SortieLogRow, itemId: number): number | null {
    return Array.isArray(row.useItemDrops) ? row.useItemDrops.filter(id => id === itemId).length : null;
}

/** 同時間的先後以 event id 決定。 */
const byTime = (a: SortieLogRow, b: SortieLogRow) => a.ts - b.ts || a.eventId - b.eventId;

function addTo(counts: CatchCounts, caught: number | null): void {
    if (caught === null) { counts.u++; return; }
    counts.n++;
    if (caught > 0) { counts.k++; counts.caught += caught; }
}

function group(rows: SortieLogRow[], itemId: number): CatchGroup {
    const total = emptyCounts();
    const byRank: Record<CatchRank, CatchCounts> = { S: emptyCounts(), A: emptyCounts(), other: emptyCounts() };
    for (const row of rows) {
        const caught = catchOf(row, itemId);
        addTo(total, caught);
        addTo(byRank[catchRank(row.rank)], caught);
    }
    return { total, byRank, sorties: new Set(rows.map(r => r.sortieKey)).size };
}

/** rows 必須已依 byTime 排序。 */
function timeline(rows: SortieLogRow[], itemId: number, cutoff: number): CatchTimeline {
    let recent6h = 0, recent24h = 0, lastCatchTs: number | null = null;
    for (const row of rows) {
        const caught = catchOf(row, itemId);
        if (!caught) continue;
        lastCatchTs = row.ts;
        if (row.ts > cutoff - 6 * HOUR) recent6h += caught;
        if (row.ts > cutoff - 24 * HOUR) recent24h += caught;
    }
    let dryStreak: DryStreak | null = null;
    if (lastCatchTs !== null) {
        dryStreak = { n: 0, s: 0, a: 0, u: 0 };
        for (let i = rows.length - 1; i >= 0; i--) {
            const caught = catchOf(rows[i], itemId);
            if (caught) break;
            if (caught === null) { dryStreak.u++; continue; }
            dryStreak.n++;
            const rank = catchRank(rows[i].rank);
            if (rank === 'S') dryStreak.s++;
            else if (rank === 'A') dryStreak.a++;
        }
    }
    return {
        ...group(rows, itemId),
        recent6h, recent24h, lastCatchTs,
        lastBattleTs: rows.length ? rows[rows.length - 1].ts : null,
        dryStreak,
    };
}

function groupBy<K>(rows: SortieLogRow[], key: (row: SortieLogRow) => K): Map<K, SortieLogRow[]> {
    const out = new Map<K, SortieLogRow[]>();
    for (const row of rows) {
        const list = out.get(key(row));
        if (list) list.push(row); else out.set(key(row), [row]);
    }
    return out;
}

const mapOrder = (a: string, b: string) => {
    const x = parseMapCode(a), y = parseMapCode(b);
    return x.world - y.world || x.mapnum - y.mapnum || a.localeCompare(b);
};

/** 依所選期間彙總某一種道具的捕獲紀錄。 */
export function itemCatchStats(sorties: readonly SortieLogRow[], q: ItemCatchQuery): ItemCatchStats {
    const rows = sorties
        .filter(r => isCatchRow(r)
            && (q.from == null || r.ts >= q.from) && (q.to == null || r.ts <= q.to))
        .sort(byTime);
    const cutoff = q.to ?? q.now;

    const areas = [...groupBy(rows, r => parseMapCode(r.map).world)]
        .sort(([a], [b]) => a - b)
        .map(([area, areaRows]): AreaCatchStat => ({
            area,
            ...timeline(areaRows, q.itemId, cutoff),
            maps: [...groupBy(areaRows, r => r.map)]
                .sort(([a], [b]) => mapOrder(a, b))
                .map(([map, mapRows]): MapCatchStat => ({
                    map,
                    ...timeline(mapRows, q.itemId, cutoff),
                    nodes: [...groupBy(mapRows, r => r.node)]
                        .sort(([a], [b]) => a - b)
                        .map(([node, nodeRows]) => ({ map, node, ...group(nodeRows, q.itemId) })),
                })),
        }));

    const catches = rows.filter(r => catchOf(r, q.itemId));
    return {
        itemId: q.itemId,
        caught: areas.reduce((sum, a) => sum + a.total.caught, 0),
        firstCatchTs: catches[0]?.ts ?? null,
        lastCatchTs: catches.at(-1)?.ts ?? null,
        observedFrom: rows[0]?.ts ?? null,
        observedTo: rows.at(-1)?.ts ?? null,
        unknown: areas.reduce((sum, a) => sum + a.total.u, 0),
        areas,
    };
}
