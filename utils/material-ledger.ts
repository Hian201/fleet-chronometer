// 離散資材分帳（純函式，無 chrome.*／DOM）：改修資材、開發資材、高速修復材、高速建造材。
// 這四種資材不會自然回復，期間內的增減幾乎都對應一個動作；輸出
// `期初 + 收入 − 支出 + 未歸因 = 期末`，對不到來源的差額一律歸「未歸因」，不猜是購買或其他來源。
// 入渠用桶（db.materialUse）與艦娘改造已拆出；改造消耗是查改造消耗表（外部參照資料），介面標推算。
// 目前未拆出的來源（勳章、禮物箱、活動報酬等）都落在未歸因，這是預期行為。
import type { ExpeditionRow, FactoryLogRow, MaterialUseRow } from './db';
import { itemCatalog } from './item-catalog';
import { QUEST_CATALOG_BY_NO } from './quest-flow';
import { questCatalogIdentity } from './quest-identity';
import { materialQuantity, type IncomeMaterial } from './quest-material-income';
import { remodelStep, type RemodelMasterData } from './remodel-goals';
import { sampleAt, type Sample } from './resource-log';

/** 資材索引沿用 api_material 順序（4 高速建造材、5 高速修復材、6 開發資材、7 改修資材）；陣列為顯示順序。 */
export const LEDGER_MATS = [7, 6, 5, 4] as const;
export type LedgerMat = (typeof LEDGER_MATS)[number];
export type LedgerIncomeSource = 'quest' | 'expedition';
type FactorySource = 'develop' | 'build' | 'improve' | 'speedup';
export type LedgerSpendSource = FactorySource | 'dock' | 'remodel';

/**
 * 工廠動作真的會消耗的資材。`used[]` 是「上次已知餘額 − 回應後餘額」，會吸進期間內其他減少
 * （例如入渠用桶）；入渠已另有紀錄，不濾會重複計。
 */
const FACTORY_CONSUMES: Record<FactorySource, readonly LedgerMat[]> = {
    develop: [6],
    improve: [6, 7],
    build: [4, 6],
    speedup: [4],
};

export interface LedgerInputs {
    /** 已 normalizeSamples。 */
    samples: Sample[];
    factory: readonly Pick<FactoryLogRow, 'ts' | 'kind' | 'used'>[];
    expeditions: readonly Pick<ExpeditionRow, 'ts' | 'items'>[];
    questClears: readonly { ts: number; questNo: number }[];
    /** 該次領獎某資材的「確定報酬」數量；null＝無法確認是哪個任務（例：營運重用編號），不計入收入。 */
    questReward: (questNo: number, ts: number, mat: LedgerMat) => number | null;
    materialUse: readonly MaterialUseRow[];
    /** 改造前形態的改造消耗；null＝查不到（master 沒載入或已是最終形態），不計入。 */
    remodelCost: (fromMst: number) => { devmat: number; torch: number; screw: number } | null;
}

export interface MaterialLedgerRow {
    mat: LedgerMat;
    opening: number;
    closing: number;
    income: Record<LedgerIncomeSource, number>;
    /** 正值。 */
    spending: Record<LedgerSpendSource, number>;
    /** closing − opening − Σincome + Σspending，可正可負。 */
    unattributed: number;
}

export interface MaterialLedger {
    /** 實際期初樣本時刻。 */
    fromTs: number;
    /** 實際期末樣本時刻。 */
    toTs: number;
    /** LEDGER_MATS 順序。 */
    rows: MaterialLedgerRow[];
    counts: {
        factory: number; expeditions: number; questClears: number; questUnknown: number;
        materialUse: number; remodelUnknown: number;
    };
}

/**
 * 遠征回航道具 `api_get_item{n}.api_useitem_id` → 資材索引。
 * useitem id 1–4 即道具目錄裡高速修復材、高速建造材、開發資材、改修資材四項的目錄 id，
 * 對應的 api_material 編號（1 起算）見 utils/item-catalog.ts 的 countSource.apiId，減 1 即索引。
 * 欄位語意依 KC3Kai src/library/modules/Kcsapi.js 的 `api_req_mission/result`：以 `api_useitem_flag` 判種類，
 * flag 為 4 時須 `api_useitem_id` 為 4 才是改修資材。本專案 samples 沒有這支封包的樣本，其他 id 一律忽略。
 */
const USEITEM_TO_MAT = new Map<number, LedgerMat>(
    itemCatalog.flatMap(item =>
        item.inventory === 'standard' && item.id >= 1 && item.id <= 4 && item.countSource.kind === 'material'
            ? [[item.id, (item.countSource.apiId - 1) as LedgerMat] as const]
            : []),
);

const emptyRow = (mat: LedgerMat): MaterialLedgerRow => ({
    mat, opening: 0, closing: 0,
    income: { quest: 0, expedition: 0 },
    spending: { develop: 0, build: 0, improve: 0, speedup: 0, dock: 0, remodel: 0 },
    unattributed: 0,
});

/** 期初樣本不在 `from` 之前時取 `[from, to]` 內第一筆；缺樣本或期末不晚於期初回 null（不可考，不以 0 頂替）。 */
/**
 * 某時刻之後的紀錄筆數。分帳的期末是最後一筆餘額取樣，之後的動作（例如在入渠畫面用桶、還沒回母港）
 * 要等下一筆餘額才能對帳；介面用這個數字說明還有幾筆在等，而不是默默不算。
 */
export function countRecordsAfter(
    inputs: Pick<LedgerInputs, 'factory' | 'expeditions' | 'questClears' | 'materialUse'>, ts: number,
): number {
    const after = (rows: readonly { ts: number }[]) => rows.filter(row => row.ts > ts).length;
    return after(inputs.factory) + after(inputs.expeditions) + after(inputs.questClears) + after(inputs.materialUse);
}

export function buildMaterialLedger(inputs: LedgerInputs, from: number, to: number): MaterialLedger | null {
    const { samples } = inputs;
    const start = sampleAt(samples, from) ?? samples.find(s => s.ts >= from && s.ts <= to) ?? null;
    const end = sampleAt(samples, to);
    if (!start || !end || end.ts <= start.ts) return null;
    // 各來源同一條規則：期初樣本之後、期末樣本（含）之前。
    const inRange = (ts: number) => ts > start.ts && ts <= end.ts;

    const rows = LEDGER_MATS.map(emptyRow);
    const byMat = new Map(rows.map(row => [row.mat, row]));
    const counts = { factory: 0, expeditions: 0, questClears: 0, questUnknown: 0, materialUse: 0, remodelUnknown: 0 };

    for (const entry of inputs.factory) {
        if (!inRange(entry.ts)) continue;
        counts.factory += 1;
        for (const mat of FACTORY_CONSUMES[entry.kind]) byMat.get(mat)!.spending[entry.kind] += entry.used[mat] ?? 0;
    }
    for (const use of inputs.materialUse) {
        if (!inRange(use.ts)) continue;
        counts.materialUse += 1;
        if (use.kind === 'bucket') {
            byMat.get(5)!.spending.dock += 1;
            continue;
        }
        const cost = inputs.remodelCost(use.fromMst);
        if (!cost) {
            counts.remodelUnknown += 1;
            continue;
        }
        byMat.get(6)!.spending.remodel += cost.devmat;
        byMat.get(4)!.spending.remodel += cost.torch;
        byMat.get(7)!.spending.remodel += cost.screw;
    }
    for (const exp of inputs.expeditions) {
        if (!inRange(exp.ts)) continue;
        counts.expeditions += 1;
        for (const item of exp.items) {
            const mat = USEITEM_TO_MAT.get(item.id);
            if (mat !== undefined) byMat.get(mat)!.income.expedition += item.count;
        }
    }
    for (const clear of inputs.questClears) {
        if (!inRange(clear.ts)) continue;
        counts.questClears += 1;
        let unknown = false;
        for (const row of rows) {
            const qty = inputs.questReward(clear.questNo, clear.ts, row.mat);
            if (qty === null) unknown = true;
            else row.income.quest += qty;
        }
        if (unknown) counts.questUnknown += 1;
    }

    for (const row of rows) {
        row.opening = start.m[row.mat] ?? 0;
        row.closing = end.m[row.mat] ?? 0;
        const income = row.income.quest + row.income.expedition;
        const spending = Object.values(row.spending).reduce((a, b) => a + b, 0);
        row.unattributed = row.closing - row.opening - income + spending;
    }
    return { fromTs: start.ts, toTs: end.ts, rows, counts };
}

const MAT_TO_INCOME_NAME: Record<LedgerMat, IncomeMaterial> = {
    7: '改修資材', 6: '開発資材', 5: '高速修復材', 4: '高速建造材',
};

/**
 * 以任務目錄的報酬文字回傳確定報酬（擇一報酬不計）。titles＝questNo→遊戲任務標題（呼叫端從 db.questSeen.title 組）。
 * 標題與目錄不符＝營運重用編號，目錄報酬屬於舊任務 → null；沒有標題可核對且是期間限定任務（每年內容不同）→ null；
 * 目錄沒有這個任務編號也無從確認 → null。
 */
export function catalogQuestReward(titles: ReadonlyMap<number, string>): LedgerInputs['questReward'] {
    return (questNo, ts, mat) => {
        const definition = QUEST_CATALOG_BY_NO.get(questNo);
        if (!definition) return null;
        const identity = questCatalogIdentity(questNo, titles.get(questNo), ts);
        if (identity === 'mismatch' || (identity === 'unknown' && definition.limited)) return null;
        return materialQuantity(questNo, MAT_TO_INCOME_NAME[mat]).fixed;
    };
}

/** 改造消耗表只提供推算值；`remodelStep()` 查不到（master 未載入、已是最終形態）回 null。 */
export function remodelCostResolver(data: RemodelMasterData): LedgerInputs['remodelCost'] {
    return fromMst => {
        const step = remodelStep(data, fromMst);
        if (!step) return null;
        return { devmat: step.cost.devmat ?? 0, torch: step.cost.torch ?? 0, screw: step.cost.screw ?? 0 };
    };
}
