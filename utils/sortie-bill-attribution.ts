// 出擊帳單的讀取時歸屬與海域彙總。純函式，不依賴 chrome.*、DOM 或 Dexie。
//
// 高速修復材與基地航空隊補充是回港後才付的帳，帳單列寫入後不再更動（見 utils/sortie-bill.ts），
// 所以在讀取時依 db.materialUse 的紀錄列歸給某一趟：
//   · 高速修復材：帶 shipId 的 bucket 列 → ts 在它之前、damagedShipIds 含該艦、最近的一趟。
//   · 基地航空隊補充：airSupply 列 → ts 在它之前、海域（map 的第一段）等於 areaId、最近的一趟。
// 找不到就不歸屬。兩者都另列，不併入 netCost。
import type { MaterialUseRow, SortieBillRow, SortieLogRow } from './db';
import { summarizeBills, type BillSummary } from './sortie-bill';

/** 基地航空隊補充的合計。fuel／bauxite 只加總有值的列；每一列都不可考時為 null，不以 0 頂替。 */
export interface AirSupplyTotal {
    rows: number;
    fuel: number | null;
    bauxite: number | null;
    /** 燃料或鋁土任一項不可考的列數。 */
    unknownRows: number;
}

export interface BillExtras {
    buckets: number;
    air: AirSupplyTotal | null;
}

type BillKey = Pick<SortieBillRow, 'sortieKey' | 'ts' | 'map' | 'damagedShipIds'>;

const addKnown = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

function mergeAir(a: AirSupplyTotal | null, b: AirSupplyTotal | null): AirSupplyTotal | null {
    if (!a || !b) return a ?? b;
    return {
        rows: a.rows + b.rows,
        fuel: addKnown(a.fuel, b.fuel),
        bauxite: addKnown(a.bauxite, b.bauxite),
        unknownRows: a.unknownRows + b.unknownRows,
    };
}

/** 多趟的追加支出合計（海域彙總用）。 */
export function mergeExtras(list: readonly (BillExtras | undefined)[]): BillExtras {
    let buckets = 0;
    let air: AirSupplyTotal | null = null;
    for (const extras of list) {
        if (!extras) continue;
        buckets += extras.buckets;
        air = mergeAir(air, extras.air);
    }
    return { buckets, air };
}

const areaOf = (map: string) => Number(map.split('-')[0]);

/** 回傳 sortieKey → 歸屬到這一趟的追加支出；沒有任何歸屬的趟不在表裡。 */
export function attributeMaterialUse(
    bills: readonly BillKey[],
    uses: readonly MaterialUseRow[],
): Map<number, BillExtras> {
    const sorted = [...bills].sort((a, b) => a.ts - b.ts || a.sortieKey - b.sortieKey);
    const latestBefore = (ts: number, match: (bill: BillKey) => boolean) => {
        for (let index = sorted.length - 1; index >= 0; index--) {
            if (sorted[index].ts < ts && match(sorted[index])) return sorted[index];
        }
        return undefined;
    };
    const out = new Map<number, BillExtras>();
    const extrasOf = (key: number) => {
        let extras = out.get(key);
        if (!extras) out.set(key, extras = { buckets: 0, air: null });
        return extras;
    };
    for (const use of uses) {
        if (use.kind === 'bucket') {
            const shipId = use.shipId;
            if (shipId === undefined) continue;
            const bill = latestBefore(use.ts, candidate => candidate.damagedShipIds.includes(shipId));
            if (bill) extrasOf(bill.sortieKey).buckets += 1;
        } else if (use.kind === 'airSupply') {
            const bill = latestBefore(use.ts, candidate => areaOf(candidate.map) === use.areaId);
            if (!bill) continue;
            const extras = extrasOf(bill.sortieKey);
            extras.air = mergeAir(extras.air, {
                rows: 1, fuel: use.fuel, bauxite: use.bauxite,
                unknownRows: use.fuel === null || use.bauxite === null ? 1 : 0,
            });
        }
    }
    return out;
}

export interface BillGroupInput {
    bill: SortieBillRow;
    /** db.sorties 同一個 sortieKey 的列。 */
    rows: readonly Pick<SortieLogRow, 'boss' | 'kind' | 'rank'>[];
    extras?: BillExtras;
}

export interface BillGroup {
    /** `${map}|${difficulty}`；通常海域的難度為空。 */
    key: string;
    map: string;
    difficulty?: number;
    lastTs: number;
    summary: BillSummary;
    /** 餘額變動不可考的趟數（summary.partial 的明細）。 */
    partialRuns: number;
    extras: BillExtras;
    /** 帶了支援艦隊的趟數與支援花費合計；沒有任何一趟帶支援時為 null。 */
    support: { runs: number; total: [number, number, number, number]; estimated: boolean } | null;
}

function sumSupport(bills: readonly SortieBillRow[]): BillGroup['support'] {
    const withSupport = bills.filter(bill => bill.support?.length);
    if (!withSupport.length) return null;
    const total: [number, number, number, number] = [0, 0, 0, 0];
    let estimated = false;
    for (const fleet of withSupport.flatMap(bill => bill.support!)) {
        fleet.payable.forEach((value, index) => { total[index] += value; });
        estimated ||= fleet.estimated;
    }
    return { runs: withSupport.length, total, estimated };
}

/**
 * 依海域彙總；活動海域再依難度分開，不同難度的成本不平均在一起。
 * since：只算 ts ≥ since 的趟（0＝全部）。依最近一趟的時間新→舊排序。
 */
export function groupBillRuns(items: readonly BillGroupInput[], since = 0): BillGroup[] {
    const groups = new Map<string, BillGroupInput[]>();
    for (const item of items) {
        if (item.bill.ts < since) continue;
        const key = `${item.bill.map}|${item.bill.difficulty ?? ''}`;
        const list = groups.get(key);
        if (list) list.push(item); else groups.set(key, [item]);
    }
    const out: BillGroup[] = [];
    for (const [key, list] of groups) {
        const summary = summarizeBills(list.map(({ bill, rows }) => {
            const boss = rows.find(row => row.boss && row.kind === 'battle');
            return { bill, reachedBoss: !!boss, bossRank: boss?.rank || null };
        }));
        if (!summary) continue;
        const { map, difficulty } = list[0].bill;
        out.push({
            key, map, ...(difficulty === undefined ? {} : { difficulty }),
            lastTs: Math.max(...list.map(item => item.bill.ts)),
            summary,
            partialRuns: list.filter(item => item.bill.balanceDelta === null).length,
            extras: mergeExtras(list.map(item => item.extras)),
            support: sumSupport(list.map(item => item.bill)),
        });
    }
    return out.sort((a, b) => b.lastTs - a.lastTs);
}
