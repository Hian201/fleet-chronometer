// 備蓄目標：玩家宣告「我在存資源」，終點固定是各資材的蓄積上限，可另設一個期限（例如活動開始日）。
// 純函式模組，不依賴 chrome.*、DOM 或 Dexie。
//
// 設計：
//   · 不讓玩家填數量。存資源是為了活動之類用量說不準的場合，實際做法是能存多少就存多少，終點是上限。
//   · 不參與改造目標的排序分配。上限等於「全部」，排進順序會把後面的目標吃光；改成先扣掉所有改造目標
//     的需求（視為已經花掉），剩下的才是備蓄。
//   · 回答兩件事：哪天到上限（到了之後的收入會浪費，是「該花掉或換遠征」的訊號），以及期限當天各有多少。
//     不替玩家判斷哪一項是瓶頸，八種全列。
//   · 流量沿用 utils/goal-arrival.ts 的逐週淨增加；線性外插不模擬自然回復在自然回復上限停止，
//     基本資源越過自然回復上限後實際會比推算慢。
import type { ObservedFlow } from './goal-arrival';
import { REMODEL_MATERIAL_ID, type RemodelCostKey, type RemodelStock } from './remodel-goals';
import { hardCapOf } from './resource-cap';

/** 備蓄涵蓋的資材：有資源取樣序列（api_material）的八種，顯示順序同遊戲的資材列。 */
export const STOCKPILE_KEYS = ['fuel', 'ammo', 'steel', 'bauxite', 'drum', 'torch', 'devmat', 'screw'] as const satisfies readonly RemodelCostKey[];
export type StockpileKey = typeof STOCKPILE_KEYS[number];

export const stockpileCap = (key: StockpileKey) => hardCapOf(REMODEL_MATERIAL_ID[key]! - 1);

/** db.goals 中備蓄目標的唯一一列（不帶 order：不參與排序分配）。 */
export const STOCKPILE_GOAL_KEY = 'stockpile';
export interface StockpileGoal {
    /** 期限，`<input type="date">` 的本地日期字串（YYYY-MM-DD）；null＝沒設期限。 */
    until: string | null;
}
export interface StockpileGoalRow { key: typeof STOCKPILE_GOAL_KEY; kind: 'stockpile'; until: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 期限字串是否為有效的日曆日期（拒絕 2026-02-30 這類會被 Date 進位的值）。 */
export function isStockpileDate(value: unknown): value is string {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function stockpileFromRows(rows: readonly { key: string; kind: string; until?: unknown }[]): StockpileGoal | null {
    const row = rows.find(row => row.kind === 'stockpile' && row.key === STOCKPILE_GOAL_KEY);
    return row ? { until: isStockpileDate(row.until) ? row.until : null } : null;
}

export const stockpileToRow = (goal: StockpileGoal): StockpileGoalRow =>
    ({ key: STOCKPILE_GOAL_KEY, kind: 'stockpile', until: goal.until });

/**
 * 到上限的狀態。
 *   full：扣掉改造保留後已在上限；unknown：持有量或流量不可考；
 *   stalled：最快一週也沒有淨增加，照目前步調不會滿；
 *   range：earliest／latest 為天數，latest 為 null 表示最慢一週沒有淨增加、上界看不到。
 */
export type ToCap =
    | { status: 'full' | 'unknown' | 'stalled' }
    | { status: 'range'; earliest: number; latest: number | null };

export interface StockpileLine {
    key: StockpileKey;
    cap: number;
    have: number | null;
    /** 所有進行中改造目標對這項的需求合計（視為已花掉）。 */
    reserved: number;
    toCap: ToCap;
    /** 期限當天扣掉改造保留後的預估量（最慢一週～最快一週，夾在 0 與上限之間）；沒有期限、期限已過或不可考為 null。 */
    atDeadline: { low: number; high: number } | null;
    /** 照最快一週的步調，期限前（含已經）就會到上限：之後流進來的收入會浪費。沒有期限時為 false。 */
    fillsBeforeDeadline: boolean;
}

/**
 * @param reserved 各項的改造需求合計（planRemodelGoals 的 totals）。
 * @param days 距期限的天數；沒有期限為 null，期限已過為 0 以下。
 */
export function stockpileOutlook(
    stock: RemodelStock,
    reserved: Partial<Record<RemodelCostKey, number>>,
    flow: ObservedFlow | null,
    days: number | null,
): StockpileLine[] {
    const ahead = days !== null && days > 0 ? days : null;
    return STOCKPILE_KEYS.map((key): StockpileLine => {
        const cap = stockpileCap(key);
        const raw = stock[key];
        const have = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
        const held = reserved[key] ?? 0;
        const rate = flow?.rates[key];
        const base = { key, cap, have, reserved: held };
        if (have === null) return { ...base, toCap: { status: 'unknown' }, atDeadline: null, fillsBeforeDeadline: false };
        const free = have - held;
        if (free >= cap) return { ...base, toCap: { status: 'full' }, atDeadline: ahead === null ? null : { low: cap, high: cap }, fillsBeforeDeadline: ahead !== null };
        if (!rate) return { ...base, toCap: { status: 'unknown' }, atDeadline: null, fillsBeforeDeadline: false };
        const toCap: ToCap = rate.high <= 0 ? { status: 'stalled' }
            : { status: 'range', earliest: (cap - free) / rate.high, latest: rate.low > 0 ? (cap - free) / rate.low : null };
        // 改造保留比持有多時 free 為負：缺的部分已在改造卡片上列為缺口，這裡只說備蓄剩 0，不顯示負數。
        const project = (perDay: number) => Math.max(0, Math.min(cap, free + perDay * ahead!));
        return {
            ...base, toCap,
            atDeadline: ahead === null ? null : { low: project(rate.low), high: project(rate.high) },
            fillsBeforeDeadline: ahead !== null && toCap.status === 'range' && toCap.earliest <= ahead,
        };
    });
}
