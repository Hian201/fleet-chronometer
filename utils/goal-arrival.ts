// 目標規劃第二階段：以玩家自己觀測到的淨流量，推算各缺口哪天湊得齊。
// 純函式模組，不依賴 chrome.*、DOM 或 Dexie。
//
// 流量的定義：把觀測期間切成連續的整週，每週的「期末餘額 − 期初餘額 + 該週改造支出」÷ 天數。
//   · 用餘額差而不是分帳的收入：分帳的收入只含已拆出的來源，淨增加才是玩家實際的存量步調
//     （自然回復、遠征、任務、出擊與工廠消耗全部在內）。分帳的恆等式保證兩者總和一致。
//   · 改造支出加回去：改造是一次性的大額支出，而未來要做的改造已經是目標的需求，不加回會重複扣。
//     改造消耗取 remodelStep()，開發資材、高速建造材、改修資材屬推算（同分帳）。
//   · 區間＝最慢一週到最快一週的步調；不套用任何「標準玩家」的假設。
//
// 只有資源取樣（api_material）有序列的項目算得出流量：彈藥、鋼材、高速建造材、開發資材、改修資材。
// 道具類（設計圖、戰鬥詳報等）與新型高溫高壓缶沒有歷史序列，到達日不可考。
// 捷徑：線性外插不模擬自然回復在上限停止；餘額接近自然回復上限時實際會比推算慢，需要時改為逐日模擬。
import type { MaterialUseRow } from './db';
import { DAY_MS } from './date-format';
import { REMODEL_COST_KEYS, REMODEL_MATERIAL_ID, remodelStep, type GoalPlan, type RemodelCostKey, type RemodelMasterData, type RemodelStock } from './remodel-goals';
import { hardCapOf } from './resource-cap';
import { sampleAt, type Sample } from './resource-log';

export const FLOW_BLOCK_DAYS = 7;
export const FLOW_MAX_BLOCKS = 4;

/** 有資源取樣序列的消耗項 → api_material 索引（0 起算）。 */
const FLOW_MAT_INDEX: Partial<Record<RemodelCostKey, number>> = Object.fromEntries(
    REMODEL_COST_KEYS.flatMap(key => (REMODEL_MATERIAL_ID[key] === undefined ? [] : [[key, REMODEL_MATERIAL_ID[key]! - 1]])),
);
export const isFlowTracked = (key: RemodelCostKey) => FLOW_MAT_INDEX[key] !== undefined;

/** 每日淨增加；low／high 是最慢與最快一週，mean 是整段觀測期間。 */
export interface FlowRate { low: number; high: number; mean: number }

export interface ObservedFlow {
    fromTs: number;
    toTs: number;
    /** 實際用到的整週數（1–FLOW_MAX_BLOCKS）。 */
    weeks: number;
    rates: Partial<Record<RemodelCostKey, FlowRate>>;
}

/**
 * 從最後一筆取樣往回切整週。第一週的起點之前沒有任何取樣＝觀測不足一週，回 null（不可考）。
 * 取樣有空檔時，週界取「該時刻以前最後一筆」，同一筆取樣不會同時當兩週的端點。
 */
export function observeFlow(
    samples: readonly Sample[], materialUse: readonly MaterialUseRow[], data: RemodelMasterData,
): ObservedFlow | null {
    const last = samples[samples.length - 1];
    if (!last) return null;
    const list = samples as Sample[];
    const blocks: { start: Sample; end: Sample }[] = [];
    let end = last;
    for (let i = 1; i <= FLOW_MAX_BLOCKS; i++) {
        const start = sampleAt(list, last.ts - i * FLOW_BLOCK_DAYS * DAY_MS);
        if (!start || start.ts >= end.ts) break;
        blocks.push({ start, end });
        end = start;
    }
    if (!blocks.length) return null;

    const remodels = materialUse.filter((use): use is Extract<MaterialUseRow, { kind: 'remodel' }> => use.kind === 'remodel');
    const gain = (key: RemodelCostKey, mat: number, start: Sample, stop: Sample) => {
        const spent = remodels.filter(use => use.ts > start.ts && use.ts <= stop.ts)
            .reduce((sum, use) => sum + (remodelStep(data, use.fromMst)?.cost[key] ?? 0), 0);
        return (stop.m[mat] ?? 0) - (start.m[mat] ?? 0) + spent;
    };
    const first = blocks[blocks.length - 1].start;
    const rates: ObservedFlow['rates'] = {};
    for (const key of REMODEL_COST_KEYS) {
        const mat = FLOW_MAT_INDEX[key];
        if (mat === undefined) continue;
        const weekly = blocks.map(({ start, end }) => gain(key, mat, start, end) / ((end.ts - start.ts) / DAY_MS));
        rates[key] = {
            low: Math.min(...weekly), high: Math.max(...weekly),
            mean: gain(key, mat, first, last) / ((last.ts - first.ts) / DAY_MS),
        };
    }
    return { fromTs: first.ts, toTs: last.ts, weeks: blocks.length, rates };
}

/**
 * 單一消耗項的到達狀態。
 *   met：已夠；untracked：沒有流量序列；no-data：持有量或觀測期間不足；
 *   over-cap：排到這個目標為止的累計需求超過蓄積上限，存不到；
 *   stalled：最快一週也沒有淨增加，照目前步調湊不齊；
 *   range：earliest／latest 為天數，latest 為 null 表示最慢一週沒有淨增加、上界看不到。
 */
export type ArrivalLine =
    | { key: RemodelCostKey; status: 'met' | 'untracked' | 'no-data' | 'over-cap' | 'stalled'; deficit: number | null }
    | { key: RemodelCostKey; status: 'range'; deficit: number; earliest: number; latest: number | null };

export interface GoalArrival {
    lines: ArrivalLine[];
    /** 所有可推算的缺口中最晚的那個；沒有任何可推算的缺口為 null。 */
    earliest: number | null;
    /** 任一缺口上界看不到、或有 stalled／over-cap 時為 null。 */
    latest: number | null;
    /** 有缺口但無法推算（untracked、no-data、stalled、over-cap）的項目；非空時整個目標的到達日只是下界。 */
    blocked: RemodelCostKey[];
}

/**
 * 依 plans 的順序（＝庫存分配順序）推算每個 active 目標的到達日。
 * 排在後面的目標要等前面的也湊齊，所以缺口取「到這個目標為止的累計需求 − 目前持有」，
 * 與 planRemodelGoals() 的分配一致：前面的目標先拿。非 active 的目標回 null。
 */
export function goalArrivals(plans: readonly GoalPlan[], stock: RemodelStock, flow: ObservedFlow | null): (GoalArrival | null)[] {
    const cumulative = new Map<RemodelCostKey, number>();
    return plans.map(plan => {
        if (plan.status !== 'active') return null;
        const lines = plan.lines.map((line): ArrivalLine => {
            const before = cumulative.get(line.key) ?? 0;
            cumulative.set(line.key, before + line.need);
            if (line.short === 0) return { key: line.key, status: 'met', deficit: 0 };
            if (!isFlowTracked(line.key)) return { key: line.key, status: 'untracked', deficit: line.short };
            const have = stock[line.key];
            if (typeof have !== 'number' || !Number.isFinite(have) || !flow) return { key: line.key, status: 'no-data', deficit: line.short };
            const mat = FLOW_MAT_INDEX[line.key]!;
            if (before + line.need > hardCapOf(mat)) return { key: line.key, status: 'over-cap', deficit: line.short };
            // line.short 是夾在 0 以上的可用量算出的；前面的目標還沒湊齊時，真正的缺口是累計需求 − 持有量。
            const deficit = before + line.need - have;
            const rate = flow.rates[line.key]!;
            if (rate.high <= 0) return { key: line.key, status: 'stalled', deficit };
            return { key: line.key, status: 'range', deficit, earliest: deficit / rate.high, latest: rate.low > 0 ? deficit / rate.low : null };
        });
        const ranged = lines.filter((line): line is Extract<ArrivalLine, { status: 'range' }> => line.status === 'range');
        const blocked = lines.filter(line => line.status !== 'met' && line.status !== 'range').map(line => line.key);
        const hard = lines.some(line => line.status === 'stalled' || line.status === 'over-cap');
        return {
            lines,
            earliest: ranged.length ? Math.max(...ranged.map(line => line.earliest)) : null,
            latest: hard || ranged.some(line => line.latest === null) || !ranged.length ? null
                : Math.max(...ranged.map(line => line.latest!)),
            blocked,
        };
    });
}
