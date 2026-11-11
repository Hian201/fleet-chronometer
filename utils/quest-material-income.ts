// 關注資材的本週期收入清單（純函式，無 chrome.*／DOM）。
// 資料來自任務目錄的報酬文字（quest-catalog-rewards.json 的 otherJa，經 questRewardGroups 解析）與任務導覽的
// 完成狀態。確定報酬照加總；擇一報酬只有玩家選它才會拿到，另列一欄，不併入確定合計。
import type { QuestFlowRow, QuestPeriod } from './quest-flow';
import { isCompletedQuestRow } from './quest-flow';
import { questRewardGroups } from './quest-catalog-localization';
import { reused } from './quest-flow-facets';

/** 可選為關注的離散資材（日文原名，與報酬文字一致）。 */
export const INCOME_MATERIALS = ['改修資材', '開発資材', '高速修復材', '高速建造材'] as const;
export type IncomeMaterial = (typeof INCOME_MATERIALS)[number];

/** 清單分組：定期任務依週期；單發、季節、其他一律歸「單發・其他」。 */
export type IncomeGroupKey = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'once';
export const INCOME_GROUP_ORDER: readonly IncomeGroupKey[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'once'];

const PERIODIC = new Set<QuestPeriod>(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);

export function incomeGroupKey(period: QuestPeriod): IncomeGroupKey {
    return PERIODIC.has(period) ? period as IncomeGroupKey : 'once';
}

/** 單一任務報酬中某資材的數量。 */
export interface RewardQuantity {
    /** 確定報酬的合計。 */
    fixed: number;
    /** 擇一報酬中該資材的合計（選它才拿得到）。 */
    choice: number;
}

export function materialQuantity(apiNo: number, material: IncomeMaterial): RewardQuantity {
    const result: RewardQuantity = { fixed: 0, choice: 0 };
    for (const group of questRewardGroups(apiNo)) {
        for (const item of group.items) {
            if (item.name !== material) continue;
            // 報酬文字有品名卻沒寫數量時不計入（不當 0 也不猜 1）；tests/quest-material-income.test.ts 鎖住目錄裡沒有這種項。
            if (item.quantity === undefined) continue;
            if (group.kind === 'fixed') result.fixed += item.quantity;
            else result.choice += item.quantity;
        }
    }
    return result;
}

export interface MaterialIncomeEntry {
    row: QuestFlowRow;
    quantity: RewardQuantity;
    /**
     * true＝任務目前在遊戲清單上（受注中、達成待領取、可接受），收入確實拿得到；
     * false＝定期任務不在清單也沒有本期完成紀錄，可能已完成未被觀測或尚未開放，狀態不明。
     */
    listed: boolean;
}

export interface MaterialIncomeGroup {
    key: IncomeGroupKey;
    entries: MaterialIncomeEntry[];
    /** 清單上任務的確定／擇一資材數量合計，及各自涉及的任務數。 */
    fixed: number;
    choice: number;
    fixedTasks: number;
    choiceTasks: number;
    /** 狀態不明任務的確定／擇一資材數量合計與任務數，與上面分開呈現。 */
    unlistedFixed: number;
    unlistedChoice: number;
    unlistedFixedTasks: number;
    unlistedChoiceTasks: number;
    /**
     * 同樣報酬含該資材、但因本期已完成或已知未開放而不在上面任何一項的任務（api_no）。
     * 目錄的篩選結果不排除它們；列出數量才對得回目錄的任務數。
     */
    doneNos: number[];
    lockedNos: number[];
}

/** 摘要裡可點的類別：點了目錄只剩該類任務。`all`＝整個週期。 */
export type IncomeFocusKind = 'all' | 'fixed' | 'choice' | 'unknown' | 'unknownChoice' | 'done' | 'locked';
export const INCOME_FOCUS_KINDS: readonly IncomeFocusKind[] = ['all', 'fixed', 'choice', 'unknown', 'unknownChoice', 'done', 'locked'];

/** 某一組某一類的任務編號；與摘要上的數字同一份分類，所以點了之後目錄與摘要必定一致。 */
export function incomeFocusNos(group: MaterialIncomeGroup, kind: IncomeFocusKind): Set<number> {
    const entryNos = (pick: (entry: MaterialIncomeEntry) => boolean) =>
        group.entries.filter(pick).map(entry => entry.row.definition.apiNo);
    switch (kind) {
        case 'fixed': return new Set(entryNos(e => e.listed && e.quantity.fixed > 0));
        case 'choice': return new Set(entryNos(e => e.listed && e.quantity.choice > 0));
        case 'unknown': return new Set(entryNos(e => !e.listed && e.quantity.fixed > 0));
        case 'unknownChoice': return new Set(entryNos(e => !e.listed && e.quantity.choice > 0));
        case 'done': return new Set(group.doneNos);
        case 'locked': return new Set(group.lockedNos);
        default: return new Set([...entryNos(() => true), ...group.doneNos, ...group.lockedNos]);
    }
}

/**
 * 本週期尚未完成、且報酬含 `material` 的任務，依週期分組。
 * 排除：本期已完成、已知未開放（locked）、營運重用編號的新任務（目錄的報酬屬於舊任務）。
 * 單發、季節、其他類與期間限定任務只收清單上的：沒有歷史就無從判斷單發是否早已完成，
 * 目錄裡已結束的往年限定任務也不在清單上，列出會把不存在的收入算進去。
 */
export function materialIncome(rows: readonly QuestFlowRow[], material: IncomeMaterial): MaterialIncomeGroup[] {
    const groups = new Map<IncomeGroupKey, MaterialIncomeGroup>();
    const groupOf = (key: IncomeGroupKey) => {
        let group = groups.get(key);
        if (!group) {
            group = {
                key, entries: [], fixed: 0, choice: 0, fixedTasks: 0, choiceTasks: 0,
                unlistedFixed: 0, unlistedChoice: 0, unlistedFixedTasks: 0, unlistedChoiceTasks: 0, doneNos: [], lockedNos: [],
            };
            groups.set(key, group);
        }
        return group;
    };
    for (const row of rows) {
        if (row.status === 'expired' || reused(row)) continue;
        const listed = !!(row.current || row.available);
        const key = incomeGroupKey(row.definition.period);
        const hidden = key === 'once' || row.definition.limited;
        if (hidden && !listed) continue;
        const quantity = materialQuantity(row.definition.apiNo, material);
        if (!quantity.fixed && !quantity.choice) continue;
        const completed = isCompletedQuestRow(row);
        if (completed || row.status === 'locked') {
            (completed ? groupOf(key).doneNos : groupOf(key).lockedNos).push(row.definition.apiNo);
            continue;
        }
        const group = groupOf(key);
        group.entries.push({ row, quantity, listed });
        if (listed) {
            group.fixed += quantity.fixed; group.choice += quantity.choice;
            if (quantity.fixed) group.fixedTasks += 1;
            if (quantity.choice) group.choiceTasks += 1;
        } else {
            group.unlistedFixed += quantity.fixed; group.unlistedChoice += quantity.choice;
            if (quantity.fixed) group.unlistedFixedTasks += 1;
            if (quantity.choice) group.unlistedChoiceTasks += 1;
        }
    }
    for (const group of groups.values()) group.entries.sort((a, b) => a.row.definition.apiNo - b.row.definition.apiNo);
    return INCOME_GROUP_ORDER.flatMap(key => groups.get(key) ?? []);
}
