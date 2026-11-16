// 基本資源分帳（純函式，無 chrome.*／DOM）：燃料、彈藥、鋼材、鋁土。
// 輸出 `期初 + 自然回復 + 收入 + 途中進出 − 支出 + 未歸因 = 期末`，恆等式恆成立；對不到來源的差額一律歸
// 「未歸因」，不猜是購買或其他來源。與離散資材分帳（material-ledger.ts）共用同一條計入邊界：
// 期初樣本 < ts ≤ 期末樣本。
//
// 各項的性質（介面必須照此標示）：
//   · 自然回復：推算（utils/resource-cap.ts）。司令部等級取呼叫端傳入的目前等級，升級前的期間上限偏高。
//   · 遠征收入：封包事實（api_get_material）。任務收入：目錄的確定報酬。
//   · 出擊的補給與修理：出擊帳單的待付帳（估算，見 sortie-bill.ts），以出擊開始時刻計；實際付款在回港後。
//   · 出擊途中進出：出擊帳單的餘額變動，是「途中取得 − 基地航空隊出擊消耗」的合計，封包無從再拆；
//     不可考的出擊不計入，計 `counts.routeUnknown`。
//   · 工廠：建造取自建造渠封包，開發與改修取回應前後的餘額差（可能含途中的其他消耗，只會少算不會多算）。
//   · 基地航空隊補充：補充前餘額可信時取餘額差，否則依缺機數×規則費率推算（見 event-projector.ts）；兩者都不可得時
//     花費為 null，不計入，計 `counts.airSupplyUnknown`。
// 解體、廢棄、近代化改修、勳章交換、轟沈返還等尚未拆出的來源都落在未歸因，這是預期行為。
import type { ExpeditionRow, FactoryLogRow, MaterialUseRow, SortieBillRow } from './db';
import { remodelStep, type RemodelMasterData } from './remodel-goals';
import { BASIC_HARD_CAP, estimateRegen, incomeAtCap, naturalCapOf } from './resource-cap';
import { sampleAt, type Sample } from './resource-log';

export const BASIC_MATS = [0, 1, 2, 3] as const;
export type BasicMat = (typeof BASIC_MATS)[number];
export type BasicIncomeSource = 'quest' | 'expedition';
export type BasicSpendSource = 'sortie' | 'factory' | 'remodel' | 'airSupply';

/** 會消耗基本資源的工廠動作；高速建造只用高速建造材。 */
const FACTORY_KINDS = new Set<FactoryLogRow['kind']>(['develop', 'build', 'improve']);

export interface BasicLedgerInputs {
    /** 已 normalizeSamples。 */
    samples: Sample[];
    /** 目前司令部等級；null＝未知，自然回復不可考。 */
    hqLv: number | null;
    factory: readonly Pick<FactoryLogRow, 'ts' | 'kind' | 'used'>[];
    expeditions: readonly Pick<ExpeditionRow, 'ts' | 'resources'>[];
    questClears: readonly { ts: number; questNo: number }[];
    /** 該次領獎某資源的確定報酬；null＝無法確認是哪個任務，不計入。 */
    questReward: (questNo: number, ts: number, mat: BasicMat) => number | null;
    materialUse: readonly MaterialUseRow[];
    /** 改造前形態的改造消耗；null＝查不到（master 沒載入或已是最終形態），不計入。 */
    remodelCost: (fromMst: number) => { ammo: number; steel: number } | null;
    sortieBills: readonly Pick<SortieBillRow, 'ts' | 'payable' | 'balanceDelta' | 'support'>[];
}

export interface BasicLedgerRow {
    mat: BasicMat;
    opening: number;
    closing: number;
    /** 推算；司令部等級未知時為 null。 */
    regen: number | null;
    income: Record<BasicIncomeSource, number>;
    /** 正值。 */
    spending: Record<BasicSpendSource, number>;
    /** 出擊途中的淨進出，可正可負。 */
    route: number;
    /** closing − opening − regen − Σincome − route + Σspending，可正可負。 */
    unattributed: number;
    /** 自然回復上限（司令部等級決定）；等級未知時為 null。 */
    naturalCap: number | null;
    /** 兩端餘額都在自然回復上限以上的時段，本來可以回復的量（上界）；等級未知時為 null。 */
    stalledRegen: number | null;
    /** 落在已達蓄積上限的資源上的收入，可能溢出。 */
    fullIncome: number;
}

export interface BasicLedger {
    fromTs: number;
    toTs: number;
    /** BASIC_MATS 順序。 */
    rows: BasicLedgerRow[];
    counts: {
        sorties: number; routeUnknown: number; factory: number; expeditions: number;
        questClears: number; questUnknown: number; remodelUnknown: number; airSupplyUnknown: number;
    };
}

const emptyRow = (mat: BasicMat): BasicLedgerRow => ({
    mat, opening: 0, closing: 0, regen: null,
    income: { quest: 0, expedition: 0 },
    spending: { sortie: 0, factory: 0, remodel: 0, airSupply: 0 },
    route: 0, unattributed: 0, naturalCap: null, stalledRegen: null, fullIncome: 0,
});

export function buildBasicLedger(inputs: BasicLedgerInputs, from: number, to: number): BasicLedger | null {
    const { samples } = inputs;
    const start = sampleAt(samples, from) ?? samples.find(s => s.ts >= from && s.ts <= to) ?? null;
    const end = sampleAt(samples, to);
    if (!start || !end || end.ts <= start.ts) return null;
    const inRange = (ts: number) => ts > start.ts && ts <= end.ts;

    const rows = BASIC_MATS.map(emptyRow);
    const counts = {
        sorties: 0, routeUnknown: 0, factory: 0, expeditions: 0,
        questClears: 0, questUnknown: 0, remodelUnknown: 0, airSupplyUnknown: 0,
    };
    const incomeEvents = new Map<BasicMat, { ts: number; amount: number }[]>(BASIC_MATS.map(mat => [mat, []]));

    for (const bill of inputs.sortieBills) {
        if (!inRange(bill.ts)) continue;
        counts.sorties += 1;
        if (!bill.balanceDelta) counts.routeUnknown += 1;
        for (const row of rows) {
            row.spending.sortie += bill.payable[row.mat] + (bill.support ?? []).reduce((sum, fleet) => sum + fleet.payable[row.mat], 0);
            row.route += bill.balanceDelta?.[row.mat] ?? 0;
        }
    }
    for (const entry of inputs.factory) {
        if (!inRange(entry.ts) || !FACTORY_KINDS.has(entry.kind)) continue;
        counts.factory += 1;
        for (const row of rows) row.spending.factory += entry.used[row.mat] ?? 0;
    }
    for (const use of inputs.materialUse) {
        if (!inRange(use.ts)) continue;
        if (use.kind === 'remodel') {
            const cost = inputs.remodelCost(use.fromMst);
            if (!cost) { counts.remodelUnknown += 1; continue; }
            rows[1].spending.remodel += cost.ammo;
            rows[2].spending.remodel += cost.steel;
        } else if (use.kind === 'airSupply') {
            if (use.fuel === null || use.bauxite === null) counts.airSupplyUnknown += 1;
            rows[0].spending.airSupply += use.fuel ?? 0;
            rows[3].spending.airSupply += use.bauxite ?? 0;
        }
    }
    for (const exp of inputs.expeditions) {
        if (!inRange(exp.ts)) continue;
        counts.expeditions += 1;
        for (const row of rows) {
            const amount = exp.resources[row.mat] ?? 0;
            row.income.expedition += amount;
            incomeEvents.get(row.mat)!.push({ ts: exp.ts, amount });
        }
    }
    for (const clear of inputs.questClears) {
        if (!inRange(clear.ts)) continue;
        counts.questClears += 1;
        let unknown = false;
        for (const row of rows) {
            const qty = inputs.questReward(clear.questNo, clear.ts, row.mat);
            if (qty === null) { unknown = true; continue; }
            row.income.quest += qty;
            incomeEvents.get(row.mat)!.push({ ts: clear.ts, amount: qty });
        }
        if (unknown) counts.questUnknown += 1;
    }

    const span = samples.filter(sample => sample.ts >= start.ts && sample.ts <= end.ts);
    const naturalCap = inputs.hqLv === null ? null : naturalCapOf(inputs.hqLv);
    for (const row of rows) {
        row.opening = start.m[row.mat] ?? 0;
        row.closing = end.m[row.mat] ?? 0;
        row.naturalCap = naturalCap;
        if (naturalCap !== null) {
            const { regen, stalled } = estimateRegen(span, row.mat, naturalCap);
            row.regen = regen;
            row.stalledRegen = stalled;
        }
        row.fullIncome = incomeAtCap(span, incomeEvents.get(row.mat)!, row.mat, BASIC_HARD_CAP);
        const income = row.income.quest + row.income.expedition;
        const spending = Object.values(row.spending).reduce((a, b) => a + b, 0);
        row.unattributed = row.closing - row.opening - (row.regen ?? 0) - income - row.route + spending;
    }
    return { fromTs: start.ts, toTs: end.ts, rows, counts };
}

/** 改造消耗中的彈藥與鋼材取自 start2 的 api_afterbull／api_afterfuel（後者是鋼材，見 state.ts）；查不到（master 未載入、已是最終形態）回 null。 */
export function remodelBasicCostResolver(data: RemodelMasterData): BasicLedgerInputs['remodelCost'] {
    return fromMst => {
        const step = remodelStep(data, fromMst);
        return step ? { ammo: step.cost.ammo ?? 0, steel: step.cost.steel ?? 0 } : null;
    };
}
