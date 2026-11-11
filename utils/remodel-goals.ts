// 改造目標：玩家指定「某艘艦改到某個形態」，算出還缺的等級、經驗與各項消耗。
// 純函式模組，不依賴 chrome.*、DOM 或 Dexie。
//
// 資料分兩層，介面必須分開標示：
//   · 封包事實：等級、彈藥、鋼材（api_mst_ship）與七種道具（api_mst_shipupgrade），
//     見 utils/state.ts 的 master／remodelItems。
//   · 推算：開發資材、高速建造材、新型砲熕兵裝資材、改修資材、工廠資源。遊戲 master 沒有，
//     取自 utils/remodel-cost-data.ts 的外部參照表（來源見該檔檔頭）。
import { BLUEPRINT_STILL_NEEDS_DEVMAT, REMODEL_EXTRA_COST, SHIP_EXP_TOTAL } from './remodel-cost-data';

export type RemodelCostKey =
    | 'ammo' | 'steel'
    | 'blueprint' | 'catapult' | 'report' | 'aviationMat' | 'armsMat' | 'tech' | 'boiler'
    | 'gunMat' | 'devmat' | 'torch' | 'screw' | 'arsenalMat';

/** 顯示順序：封包事實在前，推算在後。 */
export const REMODEL_COST_KEYS: readonly RemodelCostKey[] = [
    'ammo', 'steel', 'blueprint', 'catapult', 'report', 'aviationMat', 'armsMat', 'tech', 'boiler',
    'gunMat', 'devmat', 'torch', 'screw', 'arsenalMat',
];

const ESTIMATED = new Set<RemodelCostKey>(['gunMat', 'devmat', 'torch', 'screw', 'arsenalMat']);
export const isEstimatedCost = (key: RemodelCostKey) => ESTIMATED.has(key);

export type RemodelCost = Partial<Record<RemodelCostKey, number>>;

/** GameState 的 master／remodelItems 在結構上滿足這個介面。 */
export interface RemodelMasterData {
    master: ReadonlyMap<number, { afterLv: number; afterShipId: number; afterAmmo: number; afterSteel: number }>;
    remodelItems: ReadonlyMap<number, {
        blueprint: number; catapult: number; report: number; aviationMat: number;
        armsMat: number; tech: number; boiler: number;
    }>;
}

export interface RemodelStep {
    from: number;
    to: number;
    level: number;
    cost: RemodelCost;
}

// 開發資材的通則（KC3Kai src/library/modules/RemodelDb.js calcDevMat，clean-room 重寫）：
// 例外表有列就用例外值；否則用了設計圖就不耗（少數艦例外）；再否則依鋼材量分級。
function devmatOf(from: number, steel: number, blueprint: number): number {
    const listed = REMODEL_EXTRA_COST[from]?.devmat;
    if (listed !== undefined) return listed;
    if (blueprint > 0 && !BLUEPRINT_STILL_NEEDS_DEVMAT.includes(from)) return 0;
    if (steel < 4500) return 0;
    if (steel < 5500) return 10;
    if (steel < 6500) return 15;
    return 20;
}

/** 從 from 改造一次的需求；from 已是最終形態或 master 未載入時為 null。 */
export function remodelStep(data: RemodelMasterData, from: number): RemodelStep | null {
    const ship = data.master.get(from);
    if (!ship || ship.afterShipId <= 0) return null;
    const items = data.remodelItems.get(from);
    const extra = REMODEL_EXTRA_COST[from] ?? {};
    const raw: RemodelCost = {
        ammo: ship.afterAmmo, steel: ship.afterSteel,
        ...items,
        gunMat: extra.gunMat, torch: extra.torch, screw: extra.screw, arsenalMat: extra.arsenalMat,
        devmat: devmatOf(from, ship.afterSteel, items?.blueprint ?? 0),
    };
    const cost: RemodelCost = {};
    for (const key of REMODEL_COST_KEYS) {
        const value = raw[key];
        if (value !== undefined && value > 0) cost[key] = value;
    }
    return { from, to: ship.afterShipId, level: ship.afterLv, cost };
}

/**
 * 從 from 出發依序可達的形態（不含 from 本身）。可逆改裝會互指成環（例：鈴谷改二 ⇄
 * 鈴谷航改二），繞回已走過的形態就停，所以環上的每個形態各出現一次。
 */
export function remodelTargets(data: RemodelMasterData, from: number): number[] {
    const seen = new Set([from]);
    const targets: number[] = [];
    for (let step = remodelStep(data, from); step && !seen.has(step.to); step = remodelStep(data, step.to)) {
        seen.add(step.to);
        targets.push(step.to);
    }
    return targets;
}

/** from 到 target 的逐段改造；到不了（已改過頭、master 未載入）為 null，from === target 為空陣列。 */
export function remodelPath(data: RemodelMasterData, from: number, target: number): RemodelStep[] | null {
    const path: RemodelStep[] = [];
    const seen = new Set([from]);
    for (let at = from; at !== target;) {
        const step = remodelStep(data, at);
        if (!step || seen.has(step.to)) return null;
        seen.add(step.to);
        path.push(step);
        at = step.to;
    }
    return path;
}

// ── 目標與資料列的轉換 ───────────────────────────────────────────────
// 目標存在 db.goals（見 utils/db.ts GoalRow），由分區讀寫；這裡只做純轉換。
// 一艘艦只留一個目標；陣列順序＝玩家排的優先順序，庫存依此順序分配。

export interface RemodelGoal {
    /** 艦娘實例 id（api_ship[].api_id），不是 master id：同名艦可各自設目標。 */
    shipId: number;
    targetMst: number;
}

/** db.goals 的列在結構上滿足這個介面（本檔不 import Dexie）。 */
export interface RemodelGoalRow {
    key: string;
    kind: 'remodel';
    order: number;
    shipId: number;
    targetMst: number;
}

export const remodelGoalKey = (shipId: number) => `remodel:${shipId}`;

/** 依 order 排回玩家的順序；種類不符或同一艘艦的重複列丟棄。 */
export function goalsFromRows(rows: readonly { kind: string; order: number; shipId: number; targetMst: number }[]): RemodelGoal[] {
    const seen = new Set<number>();
    return rows.filter(row => row.kind === 'remodel').sort((a, b) => a.order - b.order)
        .filter(row => !seen.has(row.shipId) && seen.add(row.shipId))
        .map(row => ({ shipId: row.shipId, targetMst: row.targetMst }));
}

export function goalsToRows(goals: readonly RemodelGoal[]): RemodelGoalRow[] {
    return goals.map((goal, order) => ({
        key: remodelGoalKey(goal.shipId), kind: 'remodel', order, shipId: goal.shipId, targetMst: goal.targetMst,
    }));
}

// ── 需求、庫存與缺口 ─────────────────────────────────────────────────

export interface GoalShip { id: number; masterId: number; lv: number; exp: number }

/** 各項目前持有量；null／缺席＝尚未收到對應封包，介面顯示不可考。 */
export type RemodelStock = Partial<Record<RemodelCostKey, number | null>>;

export interface GoalCostLine {
    key: RemodelCostKey;
    need: number;
    estimated: boolean;
    /** 排在前面的目標分配完之後，輪到這個目標時還剩多少；不可考為 null。 */
    available: number | null;
    short: number | null;
}

export type GoalStatus = 'active' | 'done' | 'ship-missing' | 'no-path';

export interface GoalPlan {
    goal: RemodelGoal;
    status: GoalStatus;
    ship: GoalShip | null;
    steps: RemodelStep[];
    /** 路徑上各段所需等級的最大值；非 active 為 null。 */
    level: { need: number; have: number; gap: number; expGap: number | null } | null;
    lines: GoalCostLine[];
}

export interface GoalTotalLine { key: RemodelCostKey; need: number; estimated: boolean; stock: number | null; short: number | null }

function expGapTo(level: number, ship: GoalShip): number | null {
    if (ship.lv >= level) return 0;
    const total = SHIP_EXP_TOTAL[level];
    // 表只到 Lv99；超出範圍不猜。
    return total === undefined ? null : Math.max(0, total - ship.exp);
}

/**
 * 依 goals 的順序逐一分配庫存。先排的目標先拿，後面的目標看到的是剩餘量；
 * 不替玩家排優先順序，也不在目標之間平均分配。
 */
export function planRemodelGoals(
    data: RemodelMasterData,
    goals: readonly RemodelGoal[],
    ships: ReadonlyMap<number, GoalShip>,
    stock: RemodelStock,
): { plans: GoalPlan[]; totals: GoalTotalLine[] } {
    const remaining = new Map<RemodelCostKey, number>();
    const totalNeed = new Map<RemodelCostKey, number>();
    for (const key of REMODEL_COST_KEYS) {
        const have = stock[key];
        if (typeof have === 'number' && Number.isFinite(have)) remaining.set(key, have);
    }

    const plans = goals.map((goal): GoalPlan => {
        const ship = ships.get(goal.shipId) ?? null;
        const idle = (status: GoalStatus): GoalPlan => ({ goal, status, ship, steps: [], level: null, lines: [] });
        if (!ship) return idle('ship-missing');
        if (ship.masterId === goal.targetMst) return idle('done');
        const steps = remodelPath(data, ship.masterId, goal.targetMst);
        if (!steps) return idle('no-path');

        const need = Math.max(...steps.map(step => step.level));
        const lines: GoalCostLine[] = [];
        for (const key of REMODEL_COST_KEYS) {
            const amount = steps.reduce((sum, step) => sum + (step.cost[key] ?? 0), 0);
            if (amount <= 0) continue;
            totalNeed.set(key, (totalNeed.get(key) ?? 0) + amount);
            const available = remaining.get(key) ?? null;
            if (available !== null) remaining.set(key, Math.max(0, available - amount));
            lines.push({
                key, need: amount, estimated: isEstimatedCost(key), available,
                short: available === null ? null : Math.max(0, amount - available),
            });
        }
        return {
            goal, status: 'active', ship, steps, lines,
            level: { need, have: ship.lv, gap: Math.max(0, need - ship.lv), expGap: expGapTo(need, ship) },
        };
    });

    const totals = REMODEL_COST_KEYS.filter(key => totalNeed.has(key)).map((key): GoalTotalLine => {
        const need = totalNeed.get(key)!;
        const have = stock[key];
        const known = typeof have === 'number' && Number.isFinite(have) ? have : null;
        return { key, need, estimated: isEstimatedCost(key), stock: known, short: known === null ? null : Math.max(0, need - known) };
    });
    return { plans, totals };
}

/** GameState 上與庫存有關的三個讀取方法（結構型別，方便測試）。 */
export interface RemodelStockSource {
    materialCount(apiId: number): number | null;
    useItemCount(id: number): number | null;
    slotItemCountByJapaneseName(name: string): number | null;
}

/** 新型高温高圧缶是裝備，持有數以日文原名查（同 utils/item-catalog.ts 的 slotitem 來源）。 */
export const BOILER_NAME_JA = '新型高温高圧缶';

/** 各消耗項對應的道具 id（api_get_member/useitem 的 api_id；名稱見 utils/item-catalog.ts）。 */
export const REMODEL_USEITEM_ID: Partial<Record<RemodelCostKey, number>> = {
    blueprint: 58, catapult: 65, report: 78, aviationMat: 77, armsMat: 94, tech: 100, gunMat: 75, arsenalMat: 104,
};

/** 各消耗項對應的資材序（api_material 的 api_id，1 起算）。 */
export const REMODEL_MATERIAL_ID: Partial<Record<RemodelCostKey, number>> = {
    ammo: 2, steel: 3, torch: 5, devmat: 7, screw: 8,
};

export function remodelStockOf(source: RemodelStockSource): RemodelStock {
    const stock: RemodelStock = { boiler: source.slotItemCountByJapaneseName(BOILER_NAME_JA) };
    for (const key of REMODEL_COST_KEYS) {
        const material = REMODEL_MATERIAL_ID[key], item = REMODEL_USEITEM_ID[key];
        if (material !== undefined) stock[key] = source.materialCount(material);
        else if (item !== undefined) stock[key] = source.useItemCount(item);
    }
    return stock;
}
