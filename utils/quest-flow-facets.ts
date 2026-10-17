// 任務導覽的多選篩選與前因後果摘要（純函式，無 chrome.*／DOM）。
// 每列任務的標籤分成六組：同一組選了多個時任一符合即可，不同組之間要全部符合。
import type { QuestFlowModel, QuestFlowRow, QuestPeriod } from './quest-flow';
import { isCompletedQuestRow, questRequirementGroups } from './quest-flow';
import { questGoalFor } from './quest-goals';
import { questRewardItemNames } from './quest-catalog-localization';
import { questCatalogIdentity } from './quest-identity';

export type QuestFacetGroup = 'list' | 'progress' | 'period' | 'category' | 'reward' | 'map';
export const QUEST_FACET_GROUPS: readonly QuestFacetGroup[] = ['list', 'progress', 'period', 'category', 'reward', 'map'];

/** 清單狀態：受注中（未達成）、達成待領取、可接受、前置接近完成。 */
export const QUEST_LIST_FACETS = ['in-progress', 'ready', 'available', 'near'] as const;
/** 完成進度：已完成（定期任務只算本週期）、未完成、不可考。 */
export const QUEST_PROGRESS_FACETS = ['done', 'todo', 'unknown'] as const;
export type QuestPeriodFacet = QuestPeriod | 'limited';
export const QUEST_PERIOD_FACETS: readonly QuestPeriodFacet[] = [
    'once', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'seasonal', 'limited', 'other', 'unknown',
];
/**
 * 可篩選的報酬：稀有或用途特定、玩家會為它排任務的道具（日文原名）。
 * 「戦果」「装備運用枠」在報酬裡帶數值（戦果+300、装備運用枠+5装備分），以前綴比對。
 */
export const QUEST_REWARD_FACETS = [
    '戦果', '勲章', '改装設計図', '戦闘詳報', '試製甲板カタパルト',
    '新型砲熕兵装資材', '新型航空兵装資材', '新型兵装資材', '新型噴進装備開発資材',
    '海外艦最新技術', 'ネ式エンジン', '熟練搭乗員', '夜間熟練搭乗員', '設営隊',
    '補強増設', '改修資材', '装備運用枠',
] as const;
const PREFIX_REWARDS = new Set<string>(['戦果', '装備運用枠']);

export type QuestFacetSelection = Partial<Record<QuestFacetGroup, readonly string[]>>;
export type QuestRowFacets = Record<QuestFacetGroup, readonly string[]>;

/** 條件表的 maparea（11＝1-1、75＝7-5）轉成海域代號。 */
export function questMapLabel(area: number): string {
    return area >= 11 && area <= 99 ? `${Math.floor(area / 10)}-${area % 10}` : String(area);
}

/** 依世界、關卡順序排序海域代號（1-1、1-2…7-5）。 */
export function compareQuestMapLabels(a: string, b: string): number {
    const [aw, am] = a.split('-').map(Number);
    const [bw, bm] = b.split('-').map(Number);
    return (aw - bw) || (am - bm) || a.localeCompare(b);
}

function liveTitle(row: QuestFlowRow): string | undefined {
    return row.current?.name || row.available?.name || undefined;
}

/** 營運重用編號的新任務：目錄的報酬與條件屬於舊任務，不提供報酬與海域標籤。 */
function reused(row: QuestFlowRow): boolean {
    return row.definition.catalogMismatch === true
        || questCatalogIdentity(row.definition.apiNo, liveTitle(row)) === 'mismatch';
}

function rewardFacets(apiNo: number): string[] {
    const names = questRewardItemNames(apiNo);
    return QUEST_REWARD_FACETS.filter(key => PREFIX_REWARDS.has(key)
        ? names.some(name => name.startsWith(key))
        : names.includes(key));
}

function mapFacets(row: QuestFlowRow): string[] {
    const goal = questGoalFor(row.definition.apiNo, liveTitle(row));
    const labels = new Set<string>();
    for (const sub of goal?.subgoals ?? []) {
        for (const area of sub.maparea ?? []) labels.add(questMapLabel(area));
    }
    return [...labels].sort(compareQuestMapLabels);
}

function progressFacet(row: QuestFlowRow): (typeof QUEST_PROGRESS_FACETS)[number] {
    if (isCompletedQuestRow(row)) return 'done';
    return row.status === 'unknown' ? 'unknown' : 'todo';
}

export function questRowFacets(row: QuestFlowRow): QuestRowFacets {
    const list: string[] = [];
    if (row.current && !row.current.done) list.push('in-progress');
    if (row.current?.done) list.push('ready');
    if (row.available && !row.current) list.push('available');
    if (row.nearUnlock) list.push('near');
    const period: string[] = [row.definition.period];
    if (row.definition.limited) period.push('limited');
    const isReused = reused(row);
    return {
        list,
        progress: [progressFacet(row)],
        period,
        category: [row.definition.category],
        reward: isReused ? [] : rewardFacets(row.definition.apiNo),
        map: isReused ? [] : mapFacets(row),
    };
}

export function hasFacetSelection(selection: QuestFacetSelection): boolean {
    return QUEST_FACET_GROUPS.some(group => (selection[group]?.length ?? 0) > 0);
}

/** 跨組全部符合、同組任一符合；skip 的那一組不檢查（算該組各選項的計數用）。 */
export function matchesFacets(facets: QuestRowFacets, selection: QuestFacetSelection, skip?: QuestFacetGroup): boolean {
    return QUEST_FACET_GROUPS.every(group => {
        const wanted = selection[group];
        if (group === skip || !wanted?.length) return true;
        return wanted.some(value => facets[group].includes(value));
    });
}

/**
 * 每個選項的計數：其他組的條件照常套用、本組不套用，所以數字代表「再加選這一項會多看到的範圍」，
 * 選了同組其他項也不會讓其餘選項歸零。
 */
export function questFacetCounts(
    all: readonly QuestRowFacets[], selection: QuestFacetSelection,
): Record<QuestFacetGroup, Map<string, number>> {
    const counts = Object.fromEntries(QUEST_FACET_GROUPS.map(group => [group, new Map<string, number>()])) as
        Record<QuestFacetGroup, Map<string, number>>;
    for (const facets of all) {
        for (const group of QUEST_FACET_GROUPS) {
            if (!matchesFacets(facets, selection, group)) continue;
            for (const value of facets[group]) counts[group].set(value, (counts[group].get(value) ?? 0) + 1);
        }
    }
    return counts;
}

export interface QuestCauseSummary {
    /** 前置群組數（群組內任一完成即可）；0＝沒有已知前置。 */
    groups: number;
    /** 已滿足的群組數。任務本身在清單上時前置必定已滿足，全數計入。 */
    satisfied: number;
    /** 完成後開放的任務數。 */
    unlocks: number;
}

export function questCauseSummary(model: QuestFlowModel, row: QuestFlowRow): QuestCauseSummary {
    const groups = questRequirementGroups(row);
    const listed = !!row.current || !!row.available;
    const satisfied = listed ? groups.length : groups.filter(group => group.some(no => {
        const prerequisite = model.byNo.get(no);
        return prerequisite !== undefined && isCompletedQuestRow(prerequisite);
    })).length;
    return { groups: groups.length, satisfied, unlocks: row.postrequisiteNos.length };
}

/** 關係圖放大檢視的縮放級距。 */
export const QUEST_GRAPH_ZOOM_MIN = 0.25;
export const QUEST_GRAPH_ZOOM_MAX = 2;

/** 讓整張圖放進可用區域的比例；不放大超過 100%，也不小於最小級距。 */
export function questGraphFitScale(graphWidth: number, graphHeight: number, availWidth: number, availHeight: number): number {
    if (!(graphWidth > 0 && graphHeight > 0 && availWidth > 0 && availHeight > 0)) return 1;
    const scale = Math.min(1, availWidth / graphWidth, availHeight / graphHeight);
    return Math.max(QUEST_GRAPH_ZOOM_MIN, scale);
}

/** 縮放一級（×1.25 或 ÷1.25），限制在最小與最大級距之間。 */
export function questGraphZoomStep(scale: number, direction: 1 | -1): number {
    const next = direction > 0 ? scale * 1.25 : scale / 1.25;
    return Math.min(QUEST_GRAPH_ZOOM_MAX, Math.max(QUEST_GRAPH_ZOOM_MIN, Math.round(next * 100) / 100));
}
