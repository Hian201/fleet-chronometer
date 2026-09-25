import type { GameState, QuestView } from './state';
import {
    KC3_UNLOCKS_RAW, QUEST_CATALOG_RAW, QUEST_CATALOG_TEXT_OVERRIDES,
} from './quest-catalog-data';

export type QuestCategory =
    | 'composition' | 'sortie' | 'practice' | 'expedition'
    | 'supply-dock' | 'arsenal' | 'modernization' | 'unknown';

export type QuestPeriod =
    | 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'other' | 'unknown';

export type QuestEvidence = 'confirmed' | 'single-source' | 'checking' | 'conflict';
export type QuestRelationOperator = 'none' | 'all' | 'any' | 'same-period' | 'unknown' | 'conflict';
export type QuestSourceId = 'catalog' | 'structured' | 'unlock';

export type QuestStatus =
    | 'available'
    | 'in-progress'
    | 'ready-to-claim'
    | 'observed-complete'
    | 'inferred-complete'
    | 'manual-complete'
    | 'locked'
    | 'unknown'
    | 'expired';

export interface QuestDefinition {
    apiNo: number;
    wikiIds: string[];
    name: string;
    detail: string;
    category: QuestCategory;
    period: QuestPeriod;
    limited: boolean;
    limitedState: 'active' | 'unknown';
    apiCategory: number | null;
    apiType: number | null;
    wikiPrerequisites: number[];
    structuredPrerequisites: number[];
    unresolvedPrerequisites: string[];
    sources: QuestSourceId[];
    wikiPresent: boolean;
    structuredPresent: boolean;
    wikiConditionUnknown: boolean;
    structuredConditionUnknown: boolean;
}

export interface QuestRelation {
    prerequisites: number[];
    unresolvedPrerequisites: string[];
    confidence: QuestEvidence;
    operator: QuestRelationOperator;
    sources: QuestSourceId[];
}

export interface QuestObservedCompletion {
    count: number;
    lastTs: number;
}

export interface QuestAvailableView {
    no: number;
    name: string;
    detail: string;
}

export interface QuestFlowRow {
    definition: QuestDefinition;
    name: string;
    detail: string;
    status: QuestStatus;
    current: QuestView | null;
    available: QuestAvailableView | null;
    observed: QuestObservedCompletion | null;
    observedCurrentPeriod: boolean;
    progress: { count: number; target: number } | null;
    relation: QuestRelation;
    prerequisiteNos: number[];
    postrequisiteNos: number[];
    blockers: number[];
    nearUnlock: boolean;
}

export interface QuestFlowModel {
    rows: QuestFlowRow[];
    byNo: Map<number, QuestFlowRow>;
    currentNos: Set<number>;
    availableNos: Set<number>;
}

type RawCatalogEntry = readonly [
    number,
    readonly string[],
    string,
    string,
    QuestCategory,
    QuestPeriod,
    boolean,
    number | null,
    number | null,
    readonly number[],
    readonly number[],
    readonly string[],
    number,
];

/** 原始開放邊只保留數字關係；方向是「前置 → 被開放任務」。 */
export const KC3_UNLOCKS = new Map<number, number[]>(
    (KC3_UNLOCKS_RAW as readonly (readonly [number, readonly number[]])[])
        .map(([from, targets]) => [from, [...targets]]),
);

const KC3_GRAPH_NOS = new Set<number>([
    ...KC3_UNLOCKS_RAW.flatMap(([from, targets]) => [from, ...targets]),
]);

const rawEntry = (value: RawCatalogEntry): QuestDefinition => {
    const [
        apiNo, wikiIds, name, detail, category, period, limited,
        apiCategory, apiType, wikiPrerequisites, structuredPrerequisites,
        unresolvedPrerequisites, flags,
    ] = value as RawCatalogEntry;
    const wikiPresent = (flags & 1) !== 0;
    const structuredPresent = (flags & 2) !== 0;
    const textOverride = QUEST_CATALOG_TEXT_OVERRIDES[apiNo as keyof typeof QUEST_CATALOG_TEXT_OVERRIDES];
    return {
        apiNo,
        wikiIds: [...wikiIds],
        name: textOverride?.name ?? name,
        detail: textOverride?.detail ?? detail,
        category,
        period,
        limited,
        limitedState: limited ? 'unknown' : name ? 'active' : 'unknown',
        apiCategory,
        apiType,
        wikiPrerequisites: [...wikiPrerequisites],
        structuredPrerequisites: [...structuredPrerequisites],
        unresolvedPrerequisites: [...unresolvedPrerequisites],
        sources: [
            ...(wikiPresent ? ['catalog' as const] : []),
            ...(structuredPresent ? ['structured' as const] : []),
            ...(KC3_GRAPH_NOS.has(apiNo) ? ['unlock' as const] : []),
        ],
        wikiPresent,
        structuredPresent,
        wikiConditionUnknown: (flags & 4) !== 0,
        structuredConditionUnknown: (flags & 8) !== 0,
    };
};

export const QUEST_CATALOG: QuestDefinition[] =
    (QUEST_CATALOG_RAW as readonly RawCatalogEntry[]).map(rawEntry);

export const QUEST_CATALOG_BY_NO = new Map<number, QuestDefinition>(
    QUEST_CATALOG.map(definition => [definition.apiNo, definition]),
);

const KC3_INCOMING = (() => {
    const incoming = new Map<number, number[]>();
    for (const [from, targets] of KC3_UNLOCKS) {
        for (const target of targets) {
            const list = incoming.get(target) ?? [];
            list.push(from);
            incoming.set(target, list);
        }
    }
    for (const [target, list] of incoming) {
        incoming.set(target, [...new Set(list)].sort((a, b) => a - b));
    }
    return incoming;
})();

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

const unionNumbers = (...lists: readonly number[][]): number[] =>
    [...new Set(lists.flat())].sort((a, b) => a - b);

const relationSources = (definition: QuestDefinition): {
    source: QuestSourceId;
    values: number[];
}[] => {
    const sources: { source: QuestSourceId; values: number[] }[] = [];
    if (definition.wikiPresent) {
        sources.push({ source: 'catalog', values: definition.wikiPrerequisites });
    }
    if (definition.structuredPresent) {
        sources.push({ source: 'structured', values: definition.structuredPrerequisites });
    }
    const unlockValues = KC3_INCOMING.get(definition.apiNo);
    // 沒有 unlock 邊不代表「沒有前置」；只有實際有反向邊時才列入比較。
    if (unlockValues?.length) sources.push({ source: 'unlock', values: unlockValues });
    return sources;
};

export function questRelation(definitionOrNo: QuestDefinition | number): QuestRelation {
    const definition = typeof definitionOrNo === 'number'
        ? QUEST_CATALOG_BY_NO.get(definitionOrNo)
        : definitionOrNo;
    if (!definition) {
        return {
            prerequisites: [], unresolvedPrerequisites: [],
            confidence: 'checking', operator: 'unknown', sources: [],
        };
    }

    const sources = relationSources(definition);
    const values = sources.map(source => [...new Set(source.values)].sort((a, b) => a - b));
    const differs = values.some((value, index) =>
        values.slice(index + 1).some(other => !sameNumbers(value, other)));
    const conditionUnknown = definition.wikiConditionUnknown || definition.structuredConditionUnknown
        || definition.unresolvedPrerequisites.length > 0;
    const prerequisites = unionNumbers(...values);
    const confidence: QuestEvidence = differs
        ? 'conflict'
        : conditionUnknown
            ? 'checking'
            : sources.length >= 2
                ? 'confirmed'
                : sources.length === 1
                    ? 'single-source'
                    : 'checking';
    const operator: QuestRelationOperator = differs
        ? 'conflict'
        : conditionUnknown
            ? 'unknown'
            : prerequisites.length === 0
                ? sources.length ? 'none' : 'unknown'
                : prerequisites.length === 1
                    ? 'all'
                    : 'unknown';
    return {
        prerequisites,
        unresolvedPrerequisites: [...definition.unresolvedPrerequisites],
        confidence,
        operator,
        sources: [...new Set(sources.map(source => source.source))],
    };
}

export function questPostrequisites(no: number): number[] {
    const result = new Set<number>();
    for (const definition of QUEST_CATALOG) {
        if (questRelation(definition).prerequisites.includes(no)) result.add(definition.apiNo);
    }
    return [...result].sort((a, b) => a - b);
}

function dynamicDefinition(no: number): QuestDefinition {
    return {
        apiNo: no, wikiIds: [], name: '', detail: '', category: 'unknown', period: 'unknown',
        limited: false, limitedState: 'unknown', apiCategory: null, apiType: null,
        wikiPrerequisites: [], structuredPrerequisites: [], unresolvedPrerequisites: [], sources: [],
        wikiPresent: false, structuredPresent: false,
        wikiConditionUnknown: false, structuredConditionUnknown: false,
    };
}

function completionStatus(status: QuestStatus): boolean {
    return status === 'observed-complete'
        || status === 'inferred-complete'
        || status === 'manual-complete';
}

function relationAllowsPrerequisiteInference(relation: QuestRelation): boolean {
    return relation.operator === 'all';
}

function onceQuestWouldAppearIfIncomplete(
    definition: QuestDefinition,
    relation: QuestRelation,
    completed: ReadonlySet<number>,
): boolean {
    if (definition.period !== 'once' || definition.limited) return false;
    if (definition.wikiConditionUnknown || definition.structuredConditionUnknown) return false;
    if (definition.unresolvedPrerequisites.length > 0) return false;
    if (relation.operator === 'same-period' || relation.operator === 'none') {
        return relation.operator === 'none';
    }
    if (relation.prerequisites.length === 0) return false;
    if (relation.operator === 'all') return relation.prerequisites.every(no => completed.has(no));
    if (relation.operator === 'any') return relation.prerequisites.some(no => completed.has(no));
    // unknown／conflict：只有列出的前置全部完成時，不論 AND／OR 都會開這項任務。
    return relation.prerequisites.every(no => completed.has(no));
}

function inferPrerequisiteChain(
    startNos: Iterable<number>,
    relationByNo: ReadonlyMap<number, QuestRelation>,
    inferred: Set<number>,
): void {
    const stack = [...startNos];
    const seen = new Set<number>();
    while (stack.length) {
        const no = stack.pop();
        if (no == null || seen.has(no)) continue;
        seen.add(no);
        const relation = relationByNo.get(no);
        if (!relation || !relationAllowsPrerequisiteInference(relation)) continue;
        for (const prerequisite of relation.prerequisites) {
            inferred.add(prerequisite);
            stack.push(prerequisite);
        }
    }
}

function inferAbsentOnceQuests(
    definitions: ReadonlyMap<number, QuestDefinition>,
    relationByNo: ReadonlyMap<number, QuestRelation>,
    listed: ReadonlySet<number>,
    completed: Set<number>,
    inferred: Set<number>,
): void {
    let changed = true;
    while (changed) {
        changed = false;
        for (const definition of definitions.values()) {
            if (listed.has(definition.apiNo) || completed.has(definition.apiNo)) continue;
            const relation = relationByNo.get(definition.apiNo);
            if (!relation) continue;
            if (!onceQuestWouldAppearIfIncomplete(definition, relation, completed)) continue;
            inferred.add(definition.apiNo);
            completed.add(definition.apiNo);
            changed = true;
        }
    }
}

// 日／週／月以日本時間 05:00 為日界：UTC+9 再扣 5 小時，等於時間戳加 4 小時後取 UTC 日曆。
// 季任不是西曆季，重置日是 3／6／9／12 月 1 日 05:00（12–2 月、3–5 月、6–8 月、9–11 月）。
// 年任開始月尚未進目錄，不在這裡對齊。
function currentCycleKey(period: QuestPeriod, ts: number): string | null {
    if (!Number.isFinite(ts) || !['daily', 'weekly', 'monthly', 'quarterly'].includes(period)) return null;
    const resetDate = new Date(ts + (4 * 60 * 60 * 1000));
    const year = resetDate.getUTCFullYear();
    const month = resetDate.getUTCMonth();
    const day = resetDate.getUTCDate();
    const pad = (value: number) => String(value).padStart(2, '0');
    if (period === 'daily') return `D:${year}-${pad(month + 1)}-${pad(day)}`;
    if (period === 'monthly') return `M:${year}-${pad(month + 1)}`;
    if (period === 'quarterly') {
        if (month < 2) return `Q:${year - 1}-12`;
        const startMonth = month < 5 ? 3 : month < 8 ? 6 : month < 11 ? 9 : 12;
        return `Q:${year}-${pad(startMonth)}`;
    }
    const mondayOffset = (resetDate.getUTCDay() + 6) % 7;
    resetDate.setUTCDate(day - mondayOffset);
    return `W:${resetDate.getUTCFullYear()}-${pad(resetDate.getUTCMonth() + 1)}-${pad(resetDate.getUTCDate())}`;
}

function observedIsCurrentPeriod(definition: QuestDefinition, observed: QuestObservedCompletion, nowTs: number): boolean {
    if (definition.period === 'once') return true;
    const observedCycle = currentCycleKey(definition.period, observed.lastTs);
    const currentCycle = currentCycleKey(definition.period, nowTs);
    return observedCycle !== null && observedCycle === currentCycle;
}

export function buildQuestFlow(
    state: GameState,
    manualComplete: ReadonlySet<number> = new Set(),
    nowTs = Date.now(),
): QuestFlowModel {
    const current = new Map(state.quests_().map(quest => [quest.no, quest]));
    const available = new Map(state.availableQuests_().map(quest => [quest.no, quest]));
    const observed = state.questObservedCompletions_();
    const definitions = new Map(QUEST_CATALOG.map(definition => [definition.apiNo, definition]));
    for (const quest of [...current.values(), ...available.values()]) {
        if (!definitions.has(quest.no)) definitions.set(quest.no, dynamicDefinition(quest.no));
    }
    for (const no of observed.keys()) {
        if (!definitions.has(no)) definitions.set(no, dynamicDefinition(no));
    }
    for (const no of manualComplete) {
        if (!definitions.has(no)) definitions.set(no, dynamicDefinition(no));
    }

    const relationByNo = new Map<number, QuestRelation>();
    const postByNo = new Map<number, Set<number>>();
    for (const definition of [...definitions.values()]) {
        const relation = questRelation(definition);
        relationByNo.set(definition.apiNo, relation);
        for (const prerequisite of relation.prerequisites) {
            if (!definitions.has(prerequisite)) definitions.set(prerequisite, dynamicDefinition(prerequisite));
            const posts = postByNo.get(prerequisite) ?? new Set<number>();
            posts.add(definition.apiNo);
            postByNo.set(prerequisite, posts);
        }
    }
    for (const definition of definitions.values()) {
        if (!relationByNo.has(definition.apiNo)) relationByNo.set(definition.apiNo, questRelation(definition));
    }

    // 關聯推論完成只來自任務關係，不取代領獎／本機觀測標示。
    // 1. 目前清單或完整「全部／單發」tab 裡看得到的任務，沿 operator=all 的前置鏈往回標。
    // 2. 有完整單發清單時，缺席且「若未完成就應出現」的單發任務再做固定點繼流。
    // 期間限定、未解析條件、以及 all/any 無法判定且前置未全部完成的任務維持不可考。
    const listedNos = new Set<number>([
        ...current.keys(),
        ...available.keys(),
        ...(state.questOnceCatalogNos_() ?? []),
    ]);
    const inferred = new Set<number>();
    inferPrerequisiteChain(listedNos, relationByNo, inferred);

    const observedCurrent = new Set<number>();
    for (const [no, observedCompletion] of observed) {
        const definition = definitions.get(no);
        if (definition && observedIsCurrentPeriod(definition, observedCompletion, nowTs)) {
            observedCurrent.add(no);
        }
    }

    const completed = new Set<number>();
    for (const no of inferred) {
        if (!listedNos.has(no)) completed.add(no);
    }
    for (const no of manualComplete) completed.add(no);
    for (const no of observedCurrent) completed.add(no);
    if (state.questOnceCatalogNos_() !== null) {
        inferAbsentOnceQuests(definitions, relationByNo, listedNos, completed, inferred);
    }

    const rows: QuestFlowRow[] = [];
    for (const definition of [...definitions.values()].sort((a, b) => a.apiNo - b.apiNo)) {
        const quest = current.get(definition.apiNo) ?? null;
        const availableQuest = available.get(definition.apiNo) ?? null;
        const observedQuest = observed.get(definition.apiNo) ?? null;
        const observedCurrentPeriod = observedQuest
            ? observedCurrent.has(definition.apiNo) : false;
        const relation = relationByNo.get(definition.apiNo) ?? questRelation(definition);
        const blockers = relation.prerequisites.filter(no => !completed.has(no));
        const knownAll = relation.operator === 'all'
            && relation.confidence !== 'checking' && relation.confidence !== 'conflict';

        let status: QuestStatus;
        if (quest?.done) status = 'ready-to-claim';
        else if (quest) status = 'in-progress';
        else if (availableQuest) status = 'available';
        else if (observedQuest) status = 'observed-complete';
        else if (manualComplete.has(definition.apiNo)) status = 'manual-complete';
        else if (inferred.has(definition.apiNo) && !listedNos.has(definition.apiNo)) status = 'inferred-complete';
        else if (knownAll && blockers.length > 0) status = 'locked';
        else status = 'unknown';

        rows.push({
            definition,
            name: quest?.name || availableQuest?.name || definition.name,
            detail: quest?.detail || availableQuest?.detail || definition.detail,
            status,
            current: quest,
            available: availableQuest,
            observed: observedQuest,
            observedCurrentPeriod,
            progress: quest?.progress ?? null,
            relation,
            prerequisiteNos: [...relation.prerequisites],
            postrequisiteNos: [...(postByNo.get(definition.apiNo) ?? [])].sort((a, b) => a - b),
            blockers,
            nearUnlock: knownAll && blockers.length > 0 && blockers.length <= 2,
        });
    }

    const byNo = new Map(rows.map(row => [row.definition.apiNo, row]));
    return {
        rows,
        byNo,
        currentNos: new Set(current.keys()),
        availableNos: new Set(available.keys()),
    };
}

export function isCompletedQuestRow(row: QuestFlowRow): boolean {
    if (row.status === 'observed-complete') return row.observedCurrentPeriod;
    return completionStatus(row.status);
}

export function sourceLabelKey(source: QuestSourceId): string {
    return source === 'catalog' ? 'ov.qfSourceCatalog'
        : source === 'structured' ? 'ov.qfSourceStructured'
            : 'ov.qfSourceUnlock';
}

/** 搜尋用：全形標點與空白不應擋住任務名稱對得上。 */
export function normalizeQuestSearch(value: string): string {
    return value.normalize('NFKC').replace(/[、，]/g, ',').replace(/\s+/g, '').toLocaleLowerCase();
}

export function questSearchHaystack(row: {
    name: string;
    detail: string;
    definition: Pick<QuestDefinition, 'apiNo' | 'wikiIds'>;
}): string {
    return normalizeQuestSearch(
        `${row.name} ${row.detail} ${row.definition.apiNo} ${row.definition.wikiIds.join(' ')}`,
    );
}
