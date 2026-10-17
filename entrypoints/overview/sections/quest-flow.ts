// 任務導覽：把任務目錄、已知關係與目前 GameState 疊成可聚焦的導覽。
// 釘選／人工完成存在 localStorage，並隨完整備份往返；本機觀測完成另存 db.questObserved，
// 曾出現在任務清單的任務另存 db.questSeen（單發前置推論的永久證據）。
// 搜尋與篩選仍只留在本機。
import type { OverviewSection } from './types';
import type {
    QuestFlowModel, QuestFlowRow, QuestPeriod, QuestStatus, QuestUnlockPlan,
} from '@/utils/quest-flow';
import {
    buildQuestFlow, isCompletedQuestRow, normalizeQuestSearch, questDownstreamLayers,
    questRequirementGroups, questSearchHaystack, questUnlockPlan,
} from '@/utils/quest-flow';
import { layoutQuestGraph } from '@/utils/quest-graph-layout';
import { expedDisplayName, getLang, t } from '@/utils/ui-i18n';
import {
    localizedQuestDetail, localizedQuestName, localizedQuestRewardHtml, pendingQuestRewardHtml, questRewardItemLabel,
} from '@/utils/quest-catalog-localization';
import {
    QUEST_FLOW_PREFS_KEY, normalizeQuestApiNos,
} from '@/utils/quest-flow-prefs';
import { clearHashParams, downloadBlob, esc, fmtTs, hashParams, loadJsonPrefs, saveJsonPrefs } from '../lib';
import { renderQuestGraphPhoto } from '../quest-graph-photo';
import { questGraphPhotoFilename } from '@/utils/quest-graph-photo';
import { formatQuestTime, type ServerObservation } from '@/utils/quest-tracking';
import { questConditionText, questTargetLabel } from '@/utils/quest-goal-label';
import { questCatalogIdentity } from '@/utils/quest-identity';
import { formatDate } from '@/utils/date-format';
import { QUEST_CATEGORY_LABEL_KEYS, type QuestCategory } from '@/utils/quest-category';
import { questCategoryMarkHtml } from '@/utils/html-escape';
import { loadExcludedMaps } from '@/utils/sortie-exclude';
import { areaName, mapName } from '@/utils/map-names';
import {
    QUEST_FACET_GROUPS, QUEST_LIST_FACETS, QUEST_PERIOD_FACETS, QUEST_PROGRESS_FACETS, QUEST_REWARD_FACETS,
    compareQuestMapLabels, hasFacetSelection, matchesFacets, questCauseSummary, questFacetCounts, questGraphFitScale,
    questGraphZoomStep, questRowFacets,
    type QuestFacetGroup, type QuestFacetSelection, type QuestRowFacets,
} from '@/utils/quest-flow-facets';

const PREFS_KEY = QUEST_FLOW_PREFS_KEY;
type FocusMode = 'focus' | 'all';
interface QuestFlowPrefs {
    targetNo: number | null;
    manualComplete: number[];
    pinned: number[];
    focus: FocusMode;
    query: string;
    /** 多選篩選：同組任一符合、跨組全部符合。 */
    filters: QuestFacetSelection;
    pinnedOnly: boolean;
    /** 右欄標頭「任務內容與獎勵」是否展開；預設收起，把高度留給路線與關係圖。 */
    headOpen: boolean;
    tab: QuestFlowDetailTab;
    graphDone: boolean;
}

const CATEGORIES: QuestCategory[] = [
    'composition', 'sortie', 'practice', 'expedition',
    'supply-dock', 'arsenal', 'modernization', 'unknown',
];
const PERIOD_KEYS: Record<QuestPeriod, string> = {
    once: 'ov.qfPeriodOnce',
    daily: 'ov.qfPeriodDaily',
    weekly: 'ov.qfPeriodWeekly',
    monthly: 'ov.qfPeriodMonthly',
    quarterly: 'ov.qfPeriodQuarterly',
    yearly: 'ov.qfPeriodYearly',
    seasonal: 'ov.qfPeriodSeasonal',
    other: 'ov.qfPeriodOther',
    unknown: 'ov.qfPeriodUnknown',
};
const STATUS_KEYS: Record<QuestStatus, string> = {
    available: 'ov.qfStatusAvailable',
    'in-progress': 'ov.qfStatusInProgress',
    'ready-to-claim': 'ov.qfStatusReadyToClaim',
    'observed-complete': 'ov.qfStatusObserved',
    'inferred-complete': 'ov.qfStatusInferred',
    'manual-complete': 'ov.qfStatusManual',
    locked: 'ov.qfStatusLocked',
    unknown: 'ov.qfStatusUnknown',
    expired: 'ov.qfStatusExpired',
};
const LIST_FACET_KEYS: Record<(typeof QUEST_LIST_FACETS)[number], string> = {
    'in-progress': 'ov.qfStatusInProgress',
    ready: 'ov.qfStatusReadyToClaim',
    available: 'ov.qfStatusAvailable',
    near: 'ov.qfNearUnlockBadge',
};
const PROGRESS_FACET_KEYS: Record<(typeof QUEST_PROGRESS_FACETS)[number], string> = {
    done: 'ov.qfProgressDone',
    todo: 'ov.qfProgressTodo',
    unknown: 'ov.qfStatusUnknown',
};
/** 「更多條件」摺疊區裡的組；清單狀態與完成進度常駐在工具列。 */
const MORE_GROUPS: QuestFacetGroup[] = ['period', 'category', 'reward', 'map'];
const MAP_LABEL = /^\d-\d$/;

const defaultPrefs = (): QuestFlowPrefs => ({
    targetNo: null,
    manualComplete: [],
    pinned: [],
    focus: 'focus',
    query: '',
    filters: {},
    pinnedOnly: false,
    headOpen: false,
    tab: 'path',
    graphDone: false,
});

function allowedFacetValues(group: QuestFacetGroup): ((value: string) => boolean) {
    if (group === 'list') return value => (QUEST_LIST_FACETS as readonly string[]).includes(value);
    if (group === 'progress') return value => (QUEST_PROGRESS_FACETS as readonly string[]).includes(value);
    if (group === 'period') return value => (QUEST_PERIOD_FACETS as readonly string[]).includes(value);
    if (group === 'category') return value => (CATEGORIES as readonly string[]).includes(value);
    if (group === 'reward') return value => (QUEST_REWARD_FACETS as readonly string[]).includes(value);
    return value => MAP_LABEL.test(value);
}

function normalizeFilters(raw: unknown): QuestFacetSelection {
    const filters: QuestFacetSelection = {};
    if (!raw || typeof raw !== 'object') return filters;
    for (const group of QUEST_FACET_GROUPS) {
        const values = (raw as Record<string, unknown>)[group];
        if (!Array.isArray(values)) continue;
        const allowed = allowedFacetValues(group);
        const kept = [...new Set(values.filter((value): value is string => typeof value === 'string' && allowed(value)))];
        if (kept.length) filters[group] = kept;
    }
    return filters;
}

/** 舊版的單選統計列與分類／週期下拉，換算成對應的多選條件。 */
function legacyFilters(value: Record<string, unknown>): { filters: QuestFacetSelection; pinnedOnly: boolean } {
    const filters: Record<string, string[]> = {};
    const add = (group: QuestFacetGroup, ...values: string[]) => { filters[group] = [...(filters[group] ?? []), ...values]; };
    if (typeof value.category === 'string' && value.category !== 'all') add('category', value.category);
    if (typeof value.period === 'string' && value.period !== 'all') add('period', value.period);
    const bucket = value.bucket;
    if (bucket === 'current') add('list', 'in-progress', 'ready');
    else if (bucket === 'ready') add('list', 'ready');
    else if (bucket === 'available') add('list', 'available');
    else if (bucket === 'near') add('list', 'near');
    else if (bucket === 'recurring') add('period', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'seasonal');
    else if (bucket === 'limited') add('period', 'limited');
    else if (bucket === 'inferred') add('progress', 'done');
    else if (bucket === 'unknown') add('progress', 'unknown');
    return { filters: normalizeFilters(filters), pinnedOnly: bucket === 'pinned' };
}

function loadPrefs(): QuestFlowPrefs {
    const fallback = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, fallback, raw => {
        if (!raw || typeof raw !== 'object') return fallback;
        const value = raw as Partial<QuestFlowPrefs> & Record<string, unknown>;
        const targetNo = Number(value.targetNo);
        const legacy = 'filters' in value ? null : legacyFilters(value);
        return {
            targetNo: Number.isSafeInteger(targetNo) && targetNo > 0 ? targetNo : null,
            manualComplete: normalizeQuestApiNos(value.manualComplete),
            pinned: normalizeQuestApiNos(value.pinned),
            focus: value.focus === 'all' ? 'all' : 'focus',
            query: typeof value.query === 'string' ? value.query : '',
            filters: legacy ? legacy.filters : normalizeFilters(value.filters),
            pinnedOnly: legacy ? legacy.pinnedOnly : value.pinnedOnly === true,
            headOpen: value.headOpen === true,
            tab: DETAIL_TABS.includes(value.tab as QuestFlowDetailTab) ? value.tab as QuestFlowDetailTab : 'path',
            graphDone: value.graphDone === true,
        };
    });
}

function savePrefs(prefs: QuestFlowPrefs): void {
    saveJsonPrefs(PREFS_KEY, prefs);
}

function toggleNo(values: number[], no: number): number[] {
    const next = new Set(values);
    if (next.has(no)) next.delete(no); else next.add(no);
    return [...next].sort((a, b) => a - b);
}

function statusKey(status: QuestStatus): string {
    return STATUS_KEYS[status];
}

function statusLabel(status: QuestStatus): string {
    return t(statusKey(status));
}

function categoryLabel(category: QuestCategory): string {
    return t(QUEST_CATEGORY_LABEL_KEYS[category]);
}

function categoryMark(row: QuestFlowRow | undefined): string {
    const category = row?.definition.category ?? 'unknown';
    return questCategoryMarkHtml(category, categoryLabel(category));
}

function periodLabel(period: QuestPeriod): string {
    return t(PERIOD_KEYS[period]);
}

function relationLabel(row: QuestFlowRow): string {
    const key = row.relation.operator === 'all' ? 'ov.qfRelationAll'
        : row.relation.operator === 'any' ? 'ov.qfRelationAny'
            : row.relation.operator === 'same-period' ? 'ov.qfRelationSamePeriod'
                : row.relation.operator === 'none' ? 'ov.qfRelationNone'
                    : row.relation.operator === 'conflict' ? 'ov.qfRelationConflict'
                        : 'ov.qfRelationUnknown';
    return t(key);
}

function evidenceLabel(row: QuestFlowRow): string {
    const key = row.relation.confidence === 'confirmed' ? 'ov.qfConfidenceConfirmed'
        : row.relation.confidence === 'single-source' ? 'ov.qfConfidenceSingle'
            : row.relation.confidence === 'conflict' ? 'ov.qfConfidenceConflict'
                : 'ov.qfConfidenceChecking';
    return t(key);
}

/** 營運重用編號的新任務：即時標題與目錄不同，以編號對應的譯文、獎勵與關係都是舊任務的。 */
function isReusedQuest(row: QuestFlowRow): boolean {
    return row.definition.catalogMismatch === true
        || questCatalogIdentity(row.definition.apiNo, row.current?.name || row.available?.name) === 'mismatch';
}

function taskName(row: QuestFlowRow): string {
    if (isReusedQuest(row)) return row.name;
    return localizedQuestName(
        row.definition.apiNo,
        getLang(),
        row.name || row.definition.name || t('ov.qfNameUnknown'),
    );
}

function taskDetail(row: QuestFlowRow): string {
    if (isReusedQuest(row)) return row.detail || t('ov.qfNoDetail');
    return localizedQuestDetail(
        row.definition.apiNo,
        getLang(),
        row.detail || row.definition.detail || t('ov.qfNoDetail'),
    );
}

function lineBreaks(value: string): string {
    return esc(value).replace(/\r?\n/g, '<br>');
}

function japaneseOriginalHtml(row: QuestFlowRow, expanded: boolean): string {
    if (getLang() === 'ja' || isReusedQuest(row)) return '';
    const name = row.name || row.definition.name;
    const detail = row.detail || row.definition.detail;
    const no = row.definition.apiNo;
    if (!name && !detail) return '';
    const panelId = `qf-ja-original-${no}`;
    return `<div class="qf-ja-original-tools">
        <button type="button" class="ov-btn qf-ja-original-toggle" data-qf-ja-original-toggle="${no}"
                aria-expanded="${expanded}" aria-controls="${panelId}">${esc(t(expanded
                    ? 'ov.qfHideJapaneseOriginal'
                    : 'ov.qfShowJapaneseOriginal'))}</button>
    </div>
    <div id="${panelId}" class="qf-ja-original" data-qf-ja-original-panel="${no}"${expanded ? '' : ' hidden'}>
        <strong class="qf-ja-original-label">${esc(t('ov.qfJapaneseOriginal'))}</strong>
        ${name ? `<p class="qf-ja-original-name">${lineBreaks(name)}</p>` : ''}
        ${detail ? `<p class="qf-ja-original-detail">${lineBreaks(detail)}</p>` : ''}
        ${localizedQuestRewardHtml(no, 'ja')}
    </div>`;
}

function wikiIds(row: QuestFlowRow): string {
    return row.definition.wikiIds.length
        ? row.definition.wikiIds.map(id => `<span class="qf-id qf-wiki-id">${esc(id)}</span>`).join('')
        : `<span class="qf-id qf-wiki-id dim">${esc(t('ov.qfNoWikiId'))}</span>`;
}

function rowMeta(row: QuestFlowRow): string {
    return `<span class="qf-meta-item">api_no ${row.definition.apiNo}</span>
        <span class="qf-meta-item">${esc(categoryLabel(row.definition.category))}</span>
        <span class="qf-meta-item">${esc(periodLabel(row.definition.period))}</span>
        <span class="qf-meta-item qf-wiki-ids">${wikiIds(row)}</span>`;
}

function progressLabel(row: QuestFlowRow): string {
    if (row.progress) return t('ov.qfProgressValue', { count: row.progress.count, target: row.progress.target });
    if (row.observed) return t('ov.qfObservedCount', { n: row.observed.count });
    return t('ov.qfProgressUnknown');
}

/** 前因後果的短摘要：前置群組滿足幾組、完成後開放幾項。沒有已知前置且也不開放任何任務時不顯示。 */
function causeLineHtml(model: QuestFlowModel, row: QuestFlowRow): string {
    const cause = questCauseSummary(model, row);
    const parts: string[] = [];
    if (cause.groups) {
        const met = cause.satisfied === cause.groups;
        parts.push(`<span class="qf-cause-prereq${met ? ' met' : ''}" title="${esc(t('ov.qfCausePrereqTitle'))}">${esc(t('ov.qfCausePrereq', { done: cause.satisfied, total: cause.groups }))}</span>`);
    }
    if (cause.unlocks) parts.push(`<span>${esc(t('ov.qfCauseUnlocksShort', { n: cause.unlocks }))}</span>`);
    return parts.length ? `<span class="qf-cause-line">${parts.join('')}</span>` : '';
}

function rowHtml(model: QuestFlowModel, row: QuestFlowRow, selected: boolean, pinned: boolean, manuallyComplete: boolean): string {
    return `<article class="qf-row${selected ? ' selected' : ''}${row.nearUnlock ? ' near' : ''}">
        <button type="button" class="qf-row-main" data-qf-target="${row.definition.apiNo}">
            <span class="qf-row-top">
                <span class="qf-status qf-status-${row.status}">${esc(statusLabel(row.status))}</span>
                ${row.nearUnlock ? `<span class="qf-near-badge">${esc(t('ov.qfNearUnlockBadge'))}</span>` : ''}
            </span>
            <strong class="qf-row-name">${categoryMark(row)}${esc(taskName(row))}</strong>
            <span class="qf-row-meta">${rowMeta(row)}</span>
            <span class="qf-row-foot"><span class="qf-progress">${esc(progressLabel(row))}</span>${causeLineHtml(model, row)}</span>
        </button>
        <div class="qf-row-actions">
            <button type="button" class="qf-row-action${pinned ? ' on' : ''}" data-qf-pin="${row.definition.apiNo}"
                    aria-pressed="${pinned}" title="${esc(pinned ? t('ov.qfUnpin') : t('ov.qfPin'))}">${esc(pinned ? t('ov.qfUnpin') : t('ov.qfPin'))}</button>
            <button type="button" class="qf-row-action${manuallyComplete ? ' on' : ''}" data-qf-manual="${row.definition.apiNo}"
                    aria-pressed="${manuallyComplete}" title="${esc(manuallyComplete ? t('ov.qfManualUnmark') : t('ov.qfManualMark'))}">${esc(manuallyComplete ? t('ov.qfManualUnmark') : t('ov.qfManualMark'))}</button>
        </div>
    </article>`;
}

function guideNodeHtml(model: QuestFlowModel, no: number, note = ''): string {
    const row = model.byNo.get(no);
    const status = row ? statusTagHtml(row) : '';
    const name = row ? taskName(row) : t('ov.qfUnknown');
    return `<li><button type="button" class="qf-node-summary" data-qf-target="${no}">${status}<b>${categoryMark(row)}${esc(name)}</b><small>api_no ${no}</small>${note ? `<small class="qf-guide-source">${esc(note)}</small>` : ''}</button></li>`;
}

/** 刷不出任務時的指引：本週期尚未完成的定期前置，以及來源衝突時只有單一來源提出的備考。 */
function preGuideHtml(model: QuestFlowModel, row: QuestFlowRow, listed: ReadonlySet<number> = new Set()): string {
    const notShown = row.status === 'locked' || row.status === 'unknown';
    // 已列在解鎖路線步驟裡的定期前置不再重複列出。
    const periodicNos = row.periodicBlockerNos.filter(no => !listed.has(no));
    const periodic = notShown && periodicNos.length
        ? `<div class="qf-guide"><b>${esc(t('ov.qfPeriodicTitle'))}</b><p>${esc(t('ov.qfPeriodicHint'))}</p>
            <ul>${periodicNos.map(no => guideNodeHtml(model, no)).join('')}</ul></div>`
        : '';
    const remarks = row.relation.remarks.length
        ? `<div class="qf-guide"><b>${esc(t('ov.qfRemarksTitle'))}</b><p>${esc(t(row.relation.reviewed ? 'ov.qfRemarksReviewedHint' : 'ov.qfRemarksHint'))}</p>
            <ul>${row.relation.remarks.map(edge => guideNodeHtml(model, edge.no, edge.sources.length
                ? t('ov.qfConfidenceSingle')
                // 只在來源的舊資料列出現、由人工裁決納入的候選（例：Fy10 的 F73／B107）
                : t('ov.qfReviewedCandidate'))).join('')}</ul></div>`
        : '';
    const phases = row.relation.phases?.length
        ? `<div class="qf-guide"><b>${esc(t('ov.qfPhasesTitle'))}</b><p>${esc(t('ov.qfPhasesHint'))}</p>
            ${row.relation.phases.map(phase => {
                const range = phase.until
                    ? t('ov.qfPhaseRange', { from: phase.from, until: phase.until })
                    : t('ov.qfPhaseSince', { from: phase.from });
                return `<p class="qf-guide-phase">${esc(range)}${phase.current ? ` · ${esc(t('ov.qfPhaseCurrent'))}` : ''}</p>
                    <ul>${phase.prerequisites.map(no => guideNodeHtml(model, no)).join('')}</ul>`;
            }).join('')}</div>`
        : '';
    return periodic + phases + remarks;
}

function statusTagHtml(row: QuestFlowRow): string {
    return `<span class="qf-status qf-status-${row.status}">${esc(statusLabel(row.status))}</span>`;
}

/** 任務的短代號：優先 Wiki ID，沒有時用 api_no。 */
function shortLabel(row: QuestFlowRow | undefined, no: number): string {
    return row?.definition.wikiIds[0] ?? `#${no}`;
}

function nameOf(model: QuestFlowModel, no: number): string {
    const row = model.byNo.get(no);
    return row ? taskName(row) : t('ov.qfUnknown');
}

/** covered＝未完成但已不需要：後續任務已出現在清單，或同一「任一」群組已有其他選項完成。 */
type ChipState = 'done' | 'covered' | 'now' | 'todo';

function chipHtml(model: QuestFlowModel, no: number, state: ChipState): string {
    const row = model.byNo.get(no);
    const title = `${shortLabel(row, no)} ${nameOf(model, no)}${row ? ` · ${statusLabel(row.status)}` : ''}`
        + (state === 'covered' ? ` · ${t('ov.qfPathCovered')}` : '');
    return `<button type="button" class="qf-chip is-${state}" data-qf-target="${no}" data-qf-ref="${no}" title="${esc(title)}">${esc(shortLabel(row, no))}</button>`;
}

/** 「需要」列：群組之間全部需要，群組內任一即可。 */
function requirementsHtml(model: QuestFlowModel, no: number, stateOf: (no: number) => ChipState): string {
    const row = model.byNo.get(no);
    const groups = row ? questRequirementGroups(row) : [];
    if (!groups.length) return '';
    const any = t('ov.qfPathAnyOf');
    return `<span class="qf-req"><span class="qf-req-label">${esc(t('ov.qfPathRequires'))}</span>${groups.map(group => group.length > 1
        ? `<span class="qf-or" title="${esc(t('ov.qfRelationAny'))}"><span class="qf-or-label">${esc(any)}</span>${group.map(member => chipHtml(model, member, stateOf(member))).join('<span class="qf-or-sep" aria-hidden="true">/</span>')}</span>`
        : chipHtml(model, group[0], stateOf(group[0]))).join('')}</span>`;
}

function itemHtml(model: QuestFlowModel, no: number, className: string, sub: string): string {
    const row = model.byNo.get(no);
    return `<li class="qf-item${className ? ` ${className}` : ''}" data-qf-item="${no}">
        <button type="button" class="qf-item-main" data-qf-target="${no}">
            <span class="qf-item-id">${esc(shortLabel(row, no))}</span>
            <span class="qf-item-name">${categoryMark(row)}${esc(nameOf(model, no))}</span>
            ${row ? statusTagHtml(row) : ''}
        </button>
        ${sub ? `<div class="qf-item-sub">${sub}</div>` : ''}
    </li>`;
}

function planChipState(plan: QuestUnlockPlan): (no: number) => ChipState {
    return no => plan.done.has(no) ? 'done'
        : plan.covered.has(no) ? 'covered'
            : plan.step.get(no) === 1 ? 'now' : 'todo';
}

function relationHeadline(row: QuestFlowRow): string {
    return t('ov.qfRelation') + (getLang() === 'en' ? ': ' : '：') + relationLabel(row) + (row.relation.reviewed
        ? ` · ${t('ov.qfReviewed', { date: row.relation.reviewed })}`
        : row.relation.consensus ? ` · ${t('ov.qfConsensus')}` : '');
}

/** 解鎖路線：上游攤平成「第 N 步」，已完成的前置收進摺疊區。 */
function pathPaneHtml(model: QuestFlowModel, row: QuestFlowRow, doneOpen: boolean): string {
    const target = row.definition.apiNo;
    const plan = questUnlockPlan(model, target)!;
    const guide = preGuideHtml(model, row, new Set(plan.needed));
    const total = plan.ancestors.length;
    if (!total) {
        const note = plan.incomplete.has(target)
            ? `<p class="qf-path-relation qf-warn-text">${esc(relationHeadline(row))}</p>` : '';
        return `<p class="qf-empty-line">${esc(t('ov.qfNoPrerequisites'))}</p>${note}${guide}`;
    }
    const stateOf = planChipState(plan);
    const needed = new Set(plan.needed);
    const rounds = plan.step.get(target)! - 1;
    const satisfied = plan.done.size + plan.covered.size;
    const pct = Math.round(satisfied / total * 100);
    const unknownNeeded = plan.needed.some(no => model.byNo.get(no)?.status === 'unknown');
    const summary = `<div class="qf-path-sum">
        <div class="qf-path-sum-line">
            <b>${esc(plan.needed.length ? t('ov.qfPathLeft', { n: plan.needed.length }) : t('ov.qfPathAllDone'))}</b>
            <span>${esc(t('ov.qfPathDone', { done: satisfied, total }))}</span>
            ${rounds > 0 ? `<span>${esc(t(rounds === 1 ? 'ov.qfPathStepsOne' : 'ov.qfPathSteps', { n: rounds }))}</span>` : ''}
        </div>
        <div class="qf-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${satisfied}" aria-label="${esc(t('ov.qfPathProgress'))}"><i style="width:${pct}%"></i></div>
        <p class="qf-path-relation">${esc(relationHeadline(row))}</p>
        ${unknownNeeded ? `<p class="qf-path-note">${esc(t('ov.qfPathUnknownNote'))}</p>` : ''}
    </div>`;

    const byStep = new Map<number, number[]>();
    for (const no of plan.needed) {
        const step = plan.step.get(no)!;
        byStep.set(step, [...(byStep.get(step) ?? []), no]);
    }
    const itemSub = (no: number, isTarget: boolean) => {
        const unlocks = isTarget ? 0
            : (model.byNo.get(no)?.postrequisiteNos ?? []).filter(post => needed.has(post) || post === target).length;
        // 已出現在清單的任務前置此刻已滿足，不再列「需要」，免得看起來要重做一輪。
        const requirements = plan.unlocked.has(no) && questRequirementGroups(model.byNo.get(no)!).length
            ? `<span class="qf-item-note">${esc(t('ov.qfPathUnlockedNote'))}</span>`
            : requirementsHtml(model, no, stateOf);
        return requirements
            + (unlocks ? `<span class="qf-item-unlocks">${esc(t('ov.qfPathUnlocks', { n: unlocks }))}</span>` : '')
            + (plan.incomplete.has(no) ? `<span class="qf-warn-text">${esc(t('ov.qfPathIncomplete'))}</span>` : '');
    };
    const steps = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, nos]) => `<section class="qf-step${step === 1 ? ' is-now' : ''}">
        <h4><span class="qf-step-no">${esc(t('ov.qfPathStep', { n: step }))}</span>${step === 1 ? `<span class="qf-step-now">${esc(t('ov.qfPathNow'))}</span>` : ''}<small>${esc(t(step === 1 ? 'ov.qfPathNowHint' : 'ov.qfPathStepHint'))}</small><em>${nos.length}</em></h4>
        <ol class="qf-items">${nos.map(no => itemHtml(model, no, step === 1 ? 'is-now' : '', itemSub(no, false))).join('')}</ol>
    </section>`).join('');
    const targetStep = `<section class="qf-step is-target">
        <h4><span class="qf-step-no">${esc(t('ov.qfPathTarget'))}</span></h4>
        <ol class="qf-items">${itemHtml(model, target, 'is-target', itemSub(target, true))}</ol>
    </section>`;
    const doneList = plan.ancestors.filter(no => plan.done.has(no) || plan.covered.has(no));
    const doneGroup = doneList.length ? `<details class="qf-path-done" data-qf-done-group${doneOpen ? ' open' : ''}>
        <summary>${esc(t('ov.qfPathDoneGroup', { n: doneList.length }))} <small>${esc(t('ov.qfPathDoneHint'))}</small></summary>
        ${plan.covered.size ? `<p class="qf-path-note">${esc(t('ov.qfPathCoveredNote'))}</p>` : ''}
        <div class="qf-chips">${doneList.map(no => chipHtml(model, no, stateOf(no))).join('')}</div>
    </details>` : '';
    return summary + `<div class="qf-steps">${steps}${targetStep}</div>` + guide + doneGroup;
}

/** 關係圖：分層節點圖，預設只畫尚未完成的上游與目標。 */
/** expandable＝顯示「放大檢視」；放大檢視裡的同一張圖不再提供。 */
function graphPaneHtml(model: QuestFlowModel, row: QuestFlowRow, showDone: boolean, expandable = true): string {
    const target = row.definition.apiNo;
    const plan = questUnlockPlan(model, target)!;
    if (!plan.ancestors.length) return `<p class="qf-empty-line">${esc(t('ov.qfNoPrerequisites'))}</p>`;
    const tools = `<div class="qf-graph-tools">
        <label class="qf-graph-toggle"><input type="checkbox" data-qf-graph-done${showDone ? ' checked' : ''}> ${esc(t('ov.qfGraphShowDone', { n: plan.done.size + plan.covered.size }))}</label>
        <span class="qf-graph-hint">${esc(t('ov.qfGraphHint'))}</span>
        ${expandable ? `<button type="button" class="ov-btn qf-graph-expand" data-qf-graph-expand>${esc(t('ov.qfGraphExpand'))}</button>` : ''}
    </div>`;
    if (!showDone && !plan.needed.length) return `${tools}<p class="qf-empty-line">${esc(t('ov.qfGraphAllDone'))}</p>`;
    const nos = showDone ? [...plan.ancestors, target] : [...plan.needed, target];
    const layout = layoutQuestGraph(nos, no => model.byNo.get(no)?.prerequisiteNos ?? []);
    const edges = layout.edges.map(edge => `<path class="qf-edge${plan.done.has(edge.from) || plan.covered.has(edge.from) ? ' is-done' : ''}" data-from="${edge.from}" data-to="${edge.to}" d="${edge.d}"/>`).join('');
    const nodes = layout.nodes.map(node => {
        const item = model.byNo.get(node.no);
        const state = node.no === target ? 'target' : planChipState(plan)(node.no);
        const label = `${shortLabel(item, node.no)} ${nameOf(model, node.no)}${item ? ` · ${statusLabel(item.status)}` : ''}`
            + (state === 'covered' ? ` · ${t('ov.qfPathCovered')}` : '');
        return `<button type="button" class="qf-node is-${state}" data-qf-target="${node.no}" data-qf-node="${node.no}"
            style="left:${node.x}px;top:${node.y}px;width:${layout.nodeWidth}px;height:${layout.nodeHeight}px"
            title="${esc(label)}" aria-label="${esc(label)}"><b>${categoryMark(item)}${esc(shortLabel(item, node.no))}</b><span>${esc(nameOf(model, node.no))}</span></button>`;
    }).join('');
    return `${tools}<div class="qf-graph-scroll"><div class="qf-graph" style="width:${layout.width}px;height:${layout.height}px">
        <svg class="qf-graph-edges" width="${layout.width}" height="${layout.height}" aria-hidden="true">${edges}</svg>${nodes}
    </div></div>`;
}

/** 完成後開放：直接開放的任務逐項列出，更下游依距離收進摺疊區。 */
function postPaneHtml(model: QuestFlowModel, row: QuestFlowRow): string {
    const layers = questDownstreamLayers(model, row.definition.apiNo);
    if (!layers.length) return `<p class="qf-empty-line">${esc(t('ov.qfNoPostrequisites'))}</p>`;
    const total = layers.reduce((sum, layer) => sum + layer.length, 0);
    const stateOf = (no: number): ChipState => {
        const item = model.byNo.get(no);
        return item && isCompletedQuestRow(item) ? 'done' : 'todo';
    };
    const direct = layers[0].map(no => itemHtml(model, no, '', requirementsHtml(model, no, stateOf))).join('');
    const later = layers.slice(1);
    const laterHtml = later.length ? `<details class="qf-post-later">
        <summary>${esc(t('ov.qfPostLater', { n: total - layers[0].length }))}</summary>
        ${later.map((layer, index) => `<div class="qf-post-layer"><span>${esc(t('ov.qfPostDepth', { n: index + 1 }))}</span><div class="qf-chips">${layer.map(no => chipHtml(model, no, stateOf(no))).join('')}</div></div>`).join('')}
    </details>` : '';
    return `<p class="qf-path-sum-line"><span>${esc(t('ov.qfPostAll', { n: total }))}</span></p>
        <h4 class="qf-pane-h">${esc(t('ov.qfPostDirect'))}</h4>
        <ol class="qf-items">${direct}</ol>${laterHtml}`;
}

function evidencePaneHtml(row: QuestFlowRow): string {
    const observed = row.observed
        ? `<div class="qf-fact"><span>${esc(t('ov.qfObserved'))}</span><b>${esc(t('ov.qfObservedCount', { n: row.observed.count }))}</b><small>${esc(t('ov.qfObservedAt', { time: fmtTs(row.observed.lastTs) }))}</small>${row.observedCurrentPeriod ? '' : `<small class="qf-warning-text">${esc(t('ov.qfObservedNotCurrent'))}</small>`}</div>`
        : '';
    const localProgress = row.progress
        ? `<div class="qf-fact"><span>${esc(t('ov.qfProgressLocal'))}</span><b>${esc(progressLabel(row))}</b><small>${esc(t('quest.progressHint'))}</small></div>`
        : `<div class="qf-fact"><span>${esc(t('ov.qfProgressLocal'))}</span><b class="dim">${esc(t('ov.qfProgressUnknown'))}</b><small>${esc(t('ov.qfNeedObservation'))}</small></div>`;
    return `<div class="qf-facts">
            <div class="qf-fact"><span>${esc(t('ov.qfRelation'))}</span><b>${esc(relationLabel(row))}</b></div>
            <div class="qf-fact"><span>${esc(t('ov.qfConfidenceLabel'))}</span><b>${esc(evidenceLabel(row))}</b>${row.relation.sources.length ? '' : `<small class="dim">${esc(t('ov.qfNoEvidence'))}</small>`}</div>
            <div class="qf-fact"><span>${esc(t('ov.qfBlockers'))}</span><b>${row.blockers.length ? row.blockers.join(', ') : esc(t('ov.qfNoBlockers'))}</b></div>
            ${localProgress}${observed}
        </div>
        <p class="qf-evidence-note">${esc(t('ov.qfEvidenceNote'))}</p>
        <div class="qf-no-external"><span>${esc(t('ov.qfExternalNotEmbedded'))}</span></div>`;
}

export type QuestFlowDetailTab = 'path' | 'graph' | 'post' | 'progress' | 'evidence';
const DETAIL_TABS: QuestFlowDetailTab[] = ['path', 'graph', 'post', 'progress', 'evidence'];
const DETAIL_TAB_KEYS: Record<QuestFlowDetailTab, string> = {
    path: 'ov.qfTabPath',
    graph: 'ov.qfTabGraph',
    post: 'ov.qfTabPost',
    progress: 'ov.qfTabProgress',
    evidence: 'ov.qfTabEvidence',
};

function serverText(obs: ServerObservation | null): string {
    if (!obs) return t('ov.qpServerNone');
    if (obs.done) return t('quest.srv.done');
    return obs.flag === null ? t('quest.srv.unknown') : t(`quest.srv.${obs.flag}`);
}

/** 「進度紀錄」分頁：概況、條件核對、逐場判定與伺服器對照。只讀 GameState 的判定紀錄。 */
function progressPaneHtml(row: QuestFlowRow): string {
    const missionName = (id: number) => expedDisplayName(id, row.tracking?.missionNames[id] ?? `#${id}`);
    const d = row.tracking;
    if (!d) return `<div class="ov-empty">${esc(t('ov.qpNoRecord'))}</div>`;
    const excludedMaps = new Set(loadExcludedMaps());
    const joiner = getLang() === 'en' ? ', ' : '、';
    const names = (ids: readonly number[]) => ids.map(id => d.shipNames[id] ?? `#${id}`).join(joiner);
    const statusKey = d.recheck ? 'over' : d.latestServer?.status ?? 'none';
    const fact = (label: string, value: string, note: string) =>
        `<div class="qf-fact"><span>${esc(label)}</span><b>${value}</b><small>${esc(note)}</small></div>`;
    const local = d.count !== null && d.target !== null
        ? esc(d.range ? `${d.range.lo}–${d.range.hi}/${d.target}` : `${d.count}/${d.target}`)
        : d.tier === 'text' ? esc(t('quest.candidates', { n: d.candidates })) : esc(t('ov.qpLocalNone'));
    const facts = `<div class="qf-facts">
        ${fact(t('ov.qpTier'), `<i class="qp-tier tier-${d.tier}">${esc(t(`quest.tier.${d.tier}`))}</i>`, t(`quest.tierTip.${d.tier}`))}
        ${fact(t('ov.qpLocal'), local, t('ov.qpLocalSince', { time: formatQuestTime(d.acceptedTs) }))}
        ${fact(t('ov.qpServer'), esc(serverText(d.latestServer)), d.latestServer ? t('ov.qpServerAt', { time: formatQuestTime(d.latestServer.ts) }) : '')}
        ${fact(t('ov.qpCompare'), esc(t(`ov.qpStatus.${statusKey}`)), t(`ov.qpStatusNote.${statusKey}`))}
    </div>`;
    const table = (head: string[], rows: string[]) => `<div class="rl-table-wrap"><table class="rl-table qp-table">
        <thead><tr>${head.map(item => `<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    const td = (html: string, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${html}</td>`;
    const state = (ok: boolean, doneLabel = false) => td(esc(t(ok ? (doneLabel ? 'ov.qpDone' : 'ov.qpOk') : 'ov.qpNg')), ok ? 'ok' : 'dim');
    const pips = (count: number, need: number) => `<span class="qp-pips">${Array.from({ length: need }, (_, index) =>
        `<i${index < count ? ' class="on"' : ''}></i>`).join('')}</span>${count}/${need}`;
    let conditions = '';
    if (d.goals) {
        const rows: string[] = [];
        const shipKinds = ['flagshipId', 'secondshipId', 'escortshipId', 'escortshipIdAll'];
        const shipIds = d.fleetCheck.some(check => shipKinds.includes(check.kind));
        for (const check of d.fleetCheck) {
            const text = questConditionText(check, { ships: d.shipNames, classes: d.classNames });
            rows.push(`<tr>${td(esc(text), 'wrap')}${td(esc(names(check.hits) || '—'), 'wrap keep')}${state(check.ok)}</tr>`);
        }
        for (const goal of d.goals) {
            const meter = goal.need <= 6 ? pips(goal.count, goal.need) : `${goal.count}/${goal.need}`;
            rows.push(`<tr>${td(esc(`${questTargetLabel(goal)} ×${goal.need}`), 'wrap')}${td(meter)}${goal.count >= goal.need ? state(true, true) : td('—', 'dim')}</tr>`);
        }
        conditions = `<h4 class="qp-h">${esc(t('ov.qpCond'))}</h4>${table([t('ov.qpColItem'), t('ov.qpColNow'), t('ov.qpColState')], rows)}`
            + (shipIds ? `<p class="qp-empty">${esc(t('ov.qpLaterNote'))}</p>` : '');
    } else if (d.textRule) {
        const rule = d.textRule;
        const rows = [
            ...(rule.flagship ? [t('ov.qpFlagship', { ships: names(rule.flagship.slice(0, 1)) })] : []),
            t('ov.qpTextMaps', { maps: rule.maps.join(joiner) }),
            ...(rule.bossOnly ? [t('ov.qpTextBoss')] : []),
            ...(rule.minRank ? [t('ov.qpTextRank', { rank: rule.minRank })] : []),
            t('ov.qpTextHidden'),
        ].map(text => `<tr>${td(esc(text), 'wrap')}</tr>`);
        conditions = `<h4 class="qp-h">${esc(t('ov.qpTextCond'))}</h4>${table([t('ov.qpColItem')], rows)}`;
    }
    const battles = d.judgements.length
        ? table(
            [t('ov.qpColTime'), t('ov.qpColMap'), t('ov.qpColNode'), t('ov.qpColRank'), t('ov.qpColFlagship'), t('ov.qpColResult'), t('ov.qpColReason')],
            [...d.judgements].reverse().map(item => `<tr>
                ${td(item.mission !== undefined || item.practice || item.reach
                    // 出擊紀錄只收戰鬥結算；遠征、演習與抵達節點沒有對應的場次可連。
                    ? esc(formatQuestTime(item.ts))
                    : excludedMaps.has(item.map)
                    // 不記錄的海域仍計入任務，但出擊紀錄沒有這場可開。
                    ? `<span title="${esc(t('ov.qpSortieNotLogged'))}">${esc(formatQuestTime(item.ts))}</span>`
                    : `<a href="#/sortie-log?ts=${item.ts}" title="${esc(t('ov.qpOpenSortie'))}">${esc(formatQuestTime(item.ts))}</a>`)}
                ${td(esc(item.mission !== undefined ? missionName(item.mission) : item.practice ? t('quest.practice') : item.map), 'wrap')}
                ${td(esc(item.mission !== undefined || item.practice ? '—' : item.reach ? `${item.nodeLetter ?? '?'} ${t('quest.goal.reach')}` : item.boss ? t('quest.boss') : item.nodeLetter ?? t('quest.route')))}
                ${td(esc(item.rank || '—'))}
                ${td(esc(item.flagship === null ? '—' : names([item.flagship])), 'wrap keep')}
                ${td(esc(item.counted ? t('quest.counted') : item.candidate ? t('quest.candidate') : t('quest.notCountedShort')), item.counted || item.candidate ? 'ok' : 'dim')}
                ${td(esc(item.reason ? t(`quest.reason.${item.reason}`) : '—'), 'dim wrap')}
            </tr>`))
        : `<p class="qp-empty">${esc(t('ov.qpNoBattles'))}</p>`;
    const server = table(
        [t('ov.qpColTime'), t('ov.qpColServer'), t('ov.qpColLocal'), t('ov.qpColCompare')],
        [
            ...[...d.server].reverse().map(obs => `<tr>${td(esc(formatQuestTime(obs.ts)))}${td(esc(serverText(obs)))}${td(esc(obs.local !== null && obs.target !== null ? `${obs.local}/${obs.target}` : '—'))}${obs.status ? td(esc(t(`ov.qpStatus.${obs.status}`)), obs.status === 'consistent' ? 'ok' : 'dim') : td('—', 'dim')}</tr>`),
            `<tr>${td(esc(formatQuestTime(d.acceptedTs)))}${td(esc(t('ov.qpFirstSeen')), 'dim')}${td('—', 'dim')}${td('—', 'dim')}</tr>`,
        ],
    );
    return `${facts}${conditions}
        <h4 class="qp-h">${esc(t('ov.qpBattles'))}<span class="qp-hint">${esc(t('ov.qpBattlesHint'))}</span></h4>${battles}
        <h4 class="qp-h">${esc(t('ov.qpServerLog'))}</h4>${server}
        <p class="qp-note">${esc(t('ov.qpNote'))}</p>`;
}

const defaultView: QuestFlowDetailView = {
    tab: 'path', graphDone: false, pinned: false, manual: false, japaneseOriginalOpen: false, doneOpen: false,
};

export interface QuestFlowDetailView {
    tab: QuestFlowDetailTab;
    graphDone: boolean;
    pinned: boolean;
    manual: boolean;
    japaneseOriginalOpen: boolean;
    doneOpen: boolean;
    /** 標頭「任務內容與獎勵」是否展開；未指定時展開（離線預覽與測試沿用完整標頭）。 */
    headOpen?: boolean;
}

/** 標頭已用第一個 Wiki ID 當代號，這裡只列其餘的別名。 */
function headMeta(row: QuestFlowRow): string {
    const aliases = row.definition.wikiIds.slice(1)
        .map(id => `<span class="qf-id qf-wiki-id">${esc(id)}</span>`).join('');
    return `<span class="qf-meta-item">api_no ${row.definition.apiNo}</span>
        <span class="qf-meta-item">${esc(categoryLabel(row.definition.category))}</span>
        <span class="qf-meta-item">${esc(periodLabel(row.definition.period))}</span>
        ${aliases ? `<span class="qf-meta-item qf-wiki-ids">${aliases}</span>` : ''}`;
}

/** 標頭的前因後果：前置滿足幾組、解鎖還要完成幾項、完成後開放幾項；點了切到對應分頁。 */
function causeStripHtml(model: QuestFlowModel, row: QuestFlowRow): string {
    const cause = questCauseSummary(model, row);
    const plan = questUnlockPlan(model, row.definition.apiNo);
    const need = plan?.needed.length ?? 0;
    const item = (tab: QuestFlowDetailTab, text: string, extra = '', title = '') =>
        `<button type="button" class="qf-cause-item${extra}" data-qf-goto="${tab}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</button>`;
    const prereq = cause.groups
        ? item('path', t('ov.qfCausePrereq', { done: cause.satisfied, total: cause.groups }),
            cause.satisfied === cause.groups ? ' met' : '', t('ov.qfCausePrereqTitle'))
        : item('path', row.relation.operator === 'none' ? t('ov.qfCausePrereqNone') : relationLabel(row));
    return `<span class="qf-cause">
        ${prereq}
        ${need ? item('path', t('ov.qfCauseNeed', { n: need })) : ''}
        ${item('post', t('ov.qfCauseUnlocks', { n: cause.unlocks }), cause.unlocks ? '' : ' zero')}
    </span>`;
}

/** 實裝期間：開始日是實裝當天的維護更新；結束多由營運視情況公告，未公告時明寫。 */
function limitedWindowText(window: { start: string; end: string | null } | undefined): string {
    if (!window) return t('ov.qfLimitedUnknown');
    // 來源日期是日本時間的日曆日，以本機午夜建立只為走共用的年/月/日格式
    const date = (iso: string) => {
        const [y, m, d] = iso.split('-').map(Number);
        return formatDate(new Date(y, m - 1, d).getTime());
    };
    return window.end
        ? t('ov.qfLimitedWindow', { start: date(window.start), end: date(window.end) })
        : t('ov.qfLimitedOpenEnded', { start: date(window.start) });
}

function headHtml(model: QuestFlowModel, row: QuestFlowRow, view: QuestFlowDetailView): string {
    const no = row.definition.apiNo;
    const unresolved = row.relation.unresolvedPrerequisites.length
        ? `<div class="qf-warning"><b>${esc(t('ov.qfUnresolved'))}</b><span>${row.relation.unresolvedPrerequisites.map(value => esc(value)).join('、')}</span></div>`
        : '';
    const limited = row.definition.limited
        ? `<div class="qf-warning"><b>${esc(t('ov.qfLimited'))}</b><span>${esc(limitedWindowText(row.definition.limitedWindow))}</span></div>`
        : '';
    const flags = [view.pinned ? t('ov.qfPinned') : '', view.manual ? t('ov.qfManual') : ''].filter(Boolean).join(' · ');
    return `<header class="qf-head">
        <div class="qf-head-top">
            <span class="qf-head-id">${esc(shortLabel(row, no))}</span>
            <strong class="qf-now-name">${categoryMark(row)}${esc(taskName(row))}</strong>
        </div>
        <div class="qf-head-meta">
            ${statusTagHtml(row)}
            ${flags ? `<span class="qf-now-flags">${esc(flags)}</span>` : ''}
            <span class="qf-row-meta">${headMeta(row)}</span>
            ${causeStripHtml(model, row)}
            <span class="qf-head-actions">
                <button type="button" class="ov-btn" data-qf-pin="${no}" aria-pressed="${view.pinned}">${esc(view.pinned ? t('ov.qfUnpin') : t('ov.qfPin'))}</button>
                <button type="button" class="ov-btn" data-qf-manual="${no}" aria-pressed="${view.manual}">${esc(view.manual ? t('ov.qfManualUnmark') : t('ov.qfManualMark'))}</button>
            </span>
        </div>
        ${isReusedQuest(row) ? `<p class="qf-reused-note" role="note">${esc(t('ov.qfReusedNote'))}</p>` : ''}
        ${unresolved}${limited}
        <details class="qf-head-more" data-qf-head-more${view.headOpen === false ? '' : ' open'}>
            <summary><span class="qf-head-more-label">${esc(t('ov.qfHeadMore'))}</span><span class="qf-head-more-peek">${esc(taskDetail(row).replace(/\s+/g, ' '))}</span></summary>
            <p class="qf-task-detail">${lineBreaks(taskDetail(row))}</p>
            ${isReusedQuest(row) ? pendingQuestRewardHtml(getLang()) : localizedQuestRewardHtml(no, getLang())}
            ${japaneseOriginalHtml(row, view.japaneseOriginalOpen)}
        </details>
    </header>`;
}

function tabCount(model: QuestFlowModel, row: QuestFlowRow, tab: QuestFlowDetailTab): string {
    if (tab === 'path') {
        const plan = questUnlockPlan(model, row.definition.apiNo);
        return plan && plan.ancestors.length ? String(plan.needed.length) : '';
    }
    if (tab === 'post') return row.postrequisiteNos.length ? String(row.postrequisiteNos.length) : '';
    return '';
}

/** 解鎖路線以外的分頁內容；圖只在切到該分頁時才需要重畫。 */
export function questFlowPaneHtml(
    model: QuestFlowModel, row: QuestFlowRow, tab: QuestFlowDetailTab, view: QuestFlowDetailView,
): string {
    if (tab === 'path') return pathPaneHtml(model, row, view.doneOpen);
    if (tab === 'graph') return graphPaneHtml(model, row, view.graphDone);
    if (tab === 'post') return postPaneHtml(model, row);
    if (tab === 'progress') return progressPaneHtml(row);
    return evidencePaneHtml(row);
}

/** 右欄：選中任務的標頭與「解鎖路線／關係圖／完成後開放／資料來源」分頁；離線預覽共用同一份輸出。 */
export function questFlowDetailHtml(
    model: QuestFlowModel, row: QuestFlowRow | null, view: QuestFlowDetailView, picker = '',
): string {
    const tools = picker ? `<div class="qf-picker-tools">${picker}</div>` : '';
    if (!row) {
        return `<section class="qf-panel qf-main">
            <div class="qf-pane"><div class="ov-empty">${esc(t('ov.qfNoTarget'))}</div>${tools}</div>
        </section>`;
    }
    const tabs = DETAIL_TABS.map(tab => {
        const on = tab === view.tab;
        const count = tabCount(model, row, tab);
        return `<button type="button" role="tab" class="qf-tab${on ? ' on' : ''}" id="qf-tab-${tab}" data-qf-tab="${tab}"
            aria-controls="qf-pane-${tab}" aria-selected="${on}" tabindex="${on ? 0 : -1}">${esc(t(DETAIL_TAB_KEYS[tab]))}${count ? `<em>${count}</em>` : ''}</button>`;
    }).join('');
    const panes = DETAIL_TABS.map(tab => `<div class="qf-pane" role="tabpanel" id="qf-pane-${tab}" data-qf-pane="${tab}"
        aria-labelledby="qf-tab-${tab}"${tab === view.tab ? '' : ' hidden'}>${questFlowPaneHtml(model, row, tab, view)}${tab === 'evidence' ? tools : ''}</div>`).join('');
    return `<section class="qf-panel qf-main">
        ${headHtml(model, row, view)}
        <div class="qf-tabs" role="tablist" aria-label="${esc(t('ov.qfTabsLabel'))}">${tabs}</div>
        ${panes}
    </section>`;
}

function boardPanel(title: string, hint: string, inner: string, extra?: { titleAttr?: string; className?: string }): string {
    const cls = extra?.className ? ` ${extra.className}` : '';
    const titleAttr = extra?.titleAttr ? ` title="${esc(extra.titleAttr)}"` : '';
    return `<section class="qf-panel${cls}"${titleAttr}>
        <div class="qf-panel-head"><h3>${esc(title)}</h3><span class="qf-list-hint dim">${esc(hint)}</span></div>
        <div class="qf-panel-body">${inner}</div>
    </section>`;
}

function listInner(model: QuestFlowModel, rows: QuestFlowRow[], selectedNo: number | undefined, pinned: Set<number>, prefs: QuestFlowPrefs, empty: string): string {
    if (!rows.length) return `<div class="ov-empty">${esc(empty)}</div>`;
    return `<div class="qf-list" role="list">${rows.map(row => rowHtml(model, row, row.definition.apiNo === selectedNo, pinned.has(row.definition.apiNo), prefs.manualComplete.includes(row.definition.apiNo))).join('')}</div>`;
}

function focusRow(row: QuestFlowRow): boolean {
    const recurringIncomplete = row.status === 'observed-complete'
        ? !row.observedCurrentPeriod
        : !['inferred-complete', 'manual-complete'].includes(row.status);
    return !!row.current || !!row.available
        || row.nearUnlock || row.definition.limited
        || (row.definition.period !== 'once'
            && row.definition.period !== 'unknown'
            && row.definition.period !== 'other'
            && recurringIncomplete);
}

function matches(row: QuestFlowRow, facets: QuestRowFacets, prefs: QuestFlowPrefs, pinned: Set<number>): boolean {
    if (!matchesQueryAndPin(row, prefs, pinned)) return false;
    if (!matchesFacets(facets, prefs.filters)) return false;
    // 有搜尋或任何篩選條件時比對整個目錄；都沒有時才套用「聚焦導覽」的預設範圍。
    return filtering(prefs) || prefs.focus === 'all' || focusRow(row);
}

function filtering(prefs: QuestFlowPrefs): boolean {
    return !!normalizeQuestSearch(prefs.query) || prefs.pinnedOnly || hasFacetSelection(prefs.filters);
}

/** 搜尋字與「只看釘選」；篩選標籤的計數在這個範圍內算。 */
function matchesQueryAndPin(row: QuestFlowRow, prefs: QuestFlowPrefs, pinned: Set<number>): boolean {
    if (prefs.pinnedOnly && !pinned.has(row.definition.apiNo)) return false;
    const query = normalizeQuestSearch(prefs.query);
    return !query || questSearchHaystack({
        name: `${taskName(row)} ${row.name} ${row.definition.name}`,
        detail: `${taskDetail(row)} ${row.detail} ${row.definition.detail}`,
        definition: row.definition,
    }).includes(query);
}

function listRank(row: QuestFlowRow): number {
    if (row.current && !row.current.done) return 1;
    if (row.current) return 2;
    if (row.available) return 3;
    if (row.nearUnlock) return 4;
    return 5;
}

const FACET_GROUP_KEYS: Record<QuestFacetGroup, string> = {
    list: 'ov.qfFacetList',
    progress: 'ov.qfFacetProgress',
    period: 'ov.qfPeriodLabel',
    category: 'ov.qfCategoryLabel',
    reward: 'ov.qfFacetReward',
    map: 'ov.qfFacetMap',
};

function facetLabel(group: QuestFacetGroup, value: string): string {
    if (group === 'list') return t(LIST_FACET_KEYS[value as keyof typeof LIST_FACET_KEYS]);
    if (group === 'progress') return t(PROGRESS_FACET_KEYS[value as keyof typeof PROGRESS_FACET_KEYS]);
    if (group === 'period') return value === 'limited' ? t('ov.qfLimited') : periodLabel(value as QuestPeriod);
    if (group === 'category') return categoryLabel(value as QuestCategory);
    if (group === 'reward') {
        if (value === '戦果') return t('ov.qfRewardRanking');
        if (value === '装備運用枠') return t('ov.qfRewardSlots');
        return questRewardItemLabel(value, getLang());
    }
    return value;
}

/** 計數（<b>）與按下狀態在每次重繪時原地更新，按鈕本身只建一次。 */
/** titleLabel：提示框裡用的完整名稱（例：海域標籤只寫「1-5」，提示寫「1-5 鎮守府近海」）。 */
function facetChipHtml(
    group: QuestFacetGroup | 'pinned', value: string, label: string, on: boolean,
    extra: { style?: string; titleLabel?: string } = {},
): string {
    return `<button type="button" class="qf-fchip qf-fchip-${group}" data-qf-facet="${group}" data-qf-value="${esc(value)}"
        ${extra.titleLabel ? `data-qf-title="${esc(extra.titleLabel)}"` : ''}${extra.style ? ` style="${esc(extra.style)}"` : ''}
        aria-pressed="${on}"><span>${esc(label)}</span><b></b></button>`;
}

/** 出擊海域：一個世界一列，各關固定在自己的欄位（x-1 永遠在第一欄），沒有任務的關卡留空不遞補。 */
function mapFacetHtml(values: readonly string[], selected: Set<string>): string {
    const lang = getLang();
    const parts = (value: string) => value.split('-').map(Number);
    const worlds = [...new Set(values.map(value => parts(value)[0]))].sort((a, b) => a - b);
    const columns = Math.max(1, ...values.map(value => parts(value)[1]));
    // 海域名稱欄依語言給寬：英文最長「South Western Waters」，中日文最長「南西諸島海域」
    const labelWidth = lang === 'en' ? 140 : 96;
    return `<div class="qf-map-worlds" style="--qf-map-cols:${columns};--qf-map-label:${labelWidth}px">${worlds.map(world => {
        const name = areaName(world, lang) ?? '';
        const chips = values.filter(value => parts(value)[0] === world).map(value => facetChipHtml('map', value, value, selected.has(value), {
            style: `grid-column:${parts(value)[1] + 1}`,
            titleLabel: [value, mapName(value, lang)].filter(Boolean).join(' '),
        })).join('');
        return `<div class="qf-map-world"><span class="qf-map-world-label" title="${esc(`${world} ${name}`)}"><b>${world}</b><span>${esc(name)}</span></span>${chips}</div>`;
    }).join('')}</div>`;
}

function facetGroupHtml(group: QuestFacetGroup, values: readonly string[], prefs: QuestFlowPrefs): string {
    const selected = new Set(prefs.filters[group] ?? []);
    const chips = (list: readonly string[]) => list
        .map(value => facetChipHtml(group, value, facetLabel(group, value), selected.has(value))).join('');
    // 出擊海域依世界分行，一列一個海域群
    const body = group === 'map' ? mapFacetHtml(values, selected) : `<div class="qf-fchips">${chips(values)}</div>`;
    return `<fieldset class="qf-facet-group qf-facet-${group}" data-qf-group="${group}">
        <legend>${esc(t(FACET_GROUP_KEYS[group]))}</legend>${body}</fieldset>`;
}

/** 目錄裡實際出現過的選項（週期、分類、報酬、海域）；清單狀態與完成進度固定全列。 */
function facetValues(all: readonly QuestRowFacets[]): Record<QuestFacetGroup, string[]> {
    const present = (group: QuestFacetGroup) => new Set(all.flatMap(facets => facets[group]));
    const period = present('period');
    const category = present('category');
    const reward = present('reward');
    return {
        list: [...QUEST_LIST_FACETS],
        progress: [...QUEST_PROGRESS_FACETS],
        period: QUEST_PERIOD_FACETS.filter(value => period.has(value)),
        category: CATEGORIES.filter(value => category.has(value)),
        reward: QUEST_REWARD_FACETS.filter(value => reward.has(value)),
        map: [...present('map')].sort(compareQuestMapLabels),
    };
}

/**
 * 「更多條件」是錨定工具列的浮層（設計規範 §4.4b），展開時蓋在目錄上方、不推擠下方版面；
 * 重新進入分區時一律收起。已選條件以可個別移除的標籤列在同一列，只有選了條件才佔一行。
 */
function facetPanelHtml(values: Record<QuestFacetGroup, string[]>, prefs: QuestFlowPrefs): string {
    return `<div class="qf-facets" role="group" aria-label="${esc(t('ov.qfFiltersGroup'))}">
        <div class="qf-facets-main">
            ${facetGroupHtml('list', values.list, prefs)}
            ${facetGroupHtml('progress', values.progress, prefs)}
            <fieldset class="qf-facet-group qf-facet-pinned"><legend>${esc(t('ov.qfFacetPinned'))}</legend>
                <div class="qf-fchips">${facetChipHtml('pinned', 'only', t('ov.qfPinnedOnly'), prefs.pinnedOnly)}</div></fieldset>
            <details class="qf-more">
                <summary><span>${esc(t('ov.qfMoreFilters'))}</span><em class="qf-more-count"></em></summary>
                <div class="qf-more-body">
                    ${MORE_GROUPS.map(group => facetGroupHtml(group, values[group], prefs)).join('')}
                    <div class="qf-more-foot"><button type="button" class="ov-btn qf-more-close">${esc(t('ov.qfMoreDone'))}</button></div>
                </div>
            </details>
        </div>
        <div class="qf-selected" hidden>
            <span class="qf-selected-label">${esc(t('ov.qfSelectedLabel'))}</span>
            <span class="qf-selected-tags"></span>
            <button type="button" class="qf-clear">${esc(t('ov.qfClearFilters'))}</button>
        </div>
    </div>`;
}

function pickerHtml(model: QuestFlowModel, selectedNo: number | undefined): string {
    return `<label class="qf-target-picker"><span>${esc(t('ov.qfTarget'))}</span><select data-qf-target-select><option value="">${esc(t('ov.qfTargetPlaceholder'))}</option>${model.rows.map(item => `<option value="${item.definition.apiNo}"${item.definition.apiNo === selectedNo ? ' selected' : ''}>${esc(`${item.definition.apiNo} · ${taskName(item)}`)}</option>`).join('')}</select></label>`;
}

export const questFlowSection: OverviewSection = {
    id: 'quest-flow', titleKey: 'ov.questFlow',
    async render(el, ctx) {
        const prefs = loadPrefs();
        // 面板「詳細紀錄」深連結：#/quest-flow?no=<api_no>&tab=progress。套用後從網址移除。
        const params = hashParams();
        const deepNo = Number(params.get('no'));
        const deepLink = Number.isSafeInteger(deepNo) && deepNo > 0;
        if (deepLink) {
            prefs.targetNo = deepNo;
            const deepTab = params.get('tab') as QuestFlowDetailTab | null;
            if (deepTab && DETAIL_TABS.includes(deepTab)) prefs.tab = deepTab;
            savePrefs(prefs);
        }
        clearHashParams();
        // 篩選選項只依目錄建一次；之後重繪只更新計數與按下狀態。
        const initialModel = buildQuestFlow(ctx.state, new Set(prefs.manualComplete));
        // 免責說明固定顯示在頂端，不收進可摺疊的簡介。
        el.innerHTML = `<div class="qf">
            <div class="qf-topline">
                <p class="qf-disclaimer" role="note">${esc(t('ov.qfDisclaimer'))}</p>
                <details class="qf-intro">
                    <summary><span class="qf-kicker">${esc(t('ov.qfKicker'))}</span> ${esc(t('ov.qfHelp'))}</summary>
                    <p>${esc(t('ov.qfIntro'))}</p>
                    <p class="qf-intro-note">${esc(t('ov.qfIdentityNote'))}</p>
                </details>
            </div>
            <div class="ov-toolbar qf-toolbar">
                <label class="qf-search"><span class="sr-only">${esc(t('ov.qfSearch'))}</span><input class="rs-search qf-query" type="search" autocomplete="off" value="${esc(prefs.query)}" placeholder="${esc(t('ov.qfSearchPlaceholder'))}"></label>
                <div class="qf-focus" role="group" aria-label="${esc(t('ov.qfViewMode'))}">
                    <button type="button" class="ov-btn${prefs.focus === 'focus' ? ' on' : ''}" data-qf-focus="focus" aria-pressed="${prefs.focus === 'focus'}">${esc(t('ov.qfFilterFocus'))}</button>
                    <button type="button" class="ov-btn${prefs.focus === 'all' ? ' on' : ''}" data-qf-focus="all" aria-pressed="${prefs.focus === 'all'}">${esc(t('ov.qfFilterAll'))}</button>
                </div>
                ${facetPanelHtml(facetValues(initialModel.rows.map(questRowFacets)), prefs)}
            </div>
            <div class="qf-body"></div>
            <dialog class="qf-graph-dialog" aria-labelledby="qf-graph-dialog-title">
                <div class="qf-graph-dialog-head">
                    <h3 id="qf-graph-dialog-title"></h3>
                    <div class="qf-graph-zoom-tools" role="group" aria-label="${esc(t('ov.qfGraphZoom'))}">
                        <button type="button" class="ov-btn" data-qf-zoom="out" title="${esc(t('ov.qfGraphZoomOut'))}" aria-label="${esc(t('ov.qfGraphZoomOut'))}">−</button>
                        <output class="qf-graph-zoom-value" aria-live="polite"></output>
                        <button type="button" class="ov-btn" data-qf-zoom="in" title="${esc(t('ov.qfGraphZoomIn'))}" aria-label="${esc(t('ov.qfGraphZoomIn'))}">+</button>
                        <button type="button" class="ov-btn" data-qf-zoom="fit">${esc(t('ov.qfGraphFit'))}</button>
                        <button type="button" class="ov-btn" data-qf-zoom="actual">100%</button>
                    </div>
                    <span class="qf-graph-photo-status" role="status" aria-live="polite"></span>
                    <button type="button" class="ov-btn qf-graph-photo" data-qf-graph-photo title="${esc(t('ov.qfGraphPhotoTitle'))}">${esc(t('ov.qfGraphPhoto'))}</button>
                    <button type="button" class="ov-btn" data-qf-graph-close>${esc(t('ov.qfGraphClose'))}</button>
                </div>
                <div class="qf-graph-dialog-body"></div>
            </dialog>
        </div>`;

        const body = el.querySelector<HTMLElement>('.qf-body')!;
        const facetPanel = el.querySelector<HTMLElement>('.qf-facets')!;
        const more = el.querySelector<HTMLDetailsElement>('.qf-more')!;
        const graphDialog = el.querySelector<HTMLDialogElement>('.qf-graph-dialog')!;
        const query = el.querySelector<HTMLInputElement>('.qf-query')!;
        let japaneseOriginalOpenNo: number | null = null;
        let doneOpen = false;
        let drawn: { model: QuestFlowModel; selected: QuestFlowRow | null } | null = null;

        const detailView = (row: QuestFlowRow): QuestFlowDetailView => ({
            tab: prefs.tab,
            graphDone: prefs.graphDone,
            pinned: prefs.pinned.includes(row.definition.apiNo),
            manual: prefs.manualComplete.includes(row.definition.apiNo),
            japaneseOriginalOpen: japaneseOriginalOpenNo === row.definition.apiNo,
            doneOpen,
            headOpen: prefs.headOpen,
        });

        /** 標籤計數與「已選」摘要：搜尋與只看釘選之內，其他組的條件照常套用、本組不套用。 */
        const updateFacets = (model: QuestFlowModel, facetsByNo: Map<number, QuestRowFacets>, pinned: Set<number>) => {
            const scope = model.rows.filter(row => matchesQueryAndPin(row, prefs, pinned));
            const scopeFacets = scope.map(row => facetsByNo.get(row.definition.apiNo)!);
            const counts = questFacetCounts(scopeFacets, prefs.filters);
            const pinnedCount = model.rows.filter(row => pinned.has(row.definition.apiNo)
                && matchesFacets(facetsByNo.get(row.definition.apiNo)!, prefs.filters)).length;
            const done = scope.filter(row => {
                const facets = facetsByNo.get(row.definition.apiNo)!;
                return facets.progress.includes('done') && matchesFacets(facets, prefs.filters, 'progress');
            });
            const doneBy = (status: QuestStatus) => done.filter(row => row.status === status).length;
            facetPanel.querySelectorAll<HTMLButtonElement>('[data-qf-facet]').forEach(chip => {
                const group = chip.dataset.qfFacet as QuestFacetGroup | 'pinned';
                const value = chip.dataset.qfValue ?? '';
                const on = group === 'pinned' ? prefs.pinnedOnly : (prefs.filters[group] ?? []).includes(value);
                const count = group === 'pinned' ? pinnedCount : counts[group].get(value) ?? 0;
                const label = chip.dataset.qfTitle ?? chip.querySelector('span')?.textContent ?? '';
                chip.setAttribute('aria-pressed', String(on));
                chip.classList.toggle('zero', count === 0 && !on);
                chip.querySelector('b')!.textContent = String(count);
                chip.title = group === 'progress' && value === 'done'
                    ? t('ov.qfDoneBreakdown', {
                        observed: doneBy('observed-complete'), inferred: doneBy('inferred-complete'), manual: doneBy('manual-complete'),
                    })
                    : t('ov.qfChipTitle', { label, n: count });
            });
            const chosen: [QuestFacetGroup | 'pinned', string, string][] = [
                ...(prefs.pinnedOnly ? [['pinned', 'only', t('ov.qfPinnedOnly')] as [QuestFacetGroup | 'pinned', string, string]] : []),
                ...QUEST_FACET_GROUPS.flatMap(group => (prefs.filters[group] ?? [])
                    .map(value => [group, value, facetLabel(group, value)] as [QuestFacetGroup, string, string])),
            ];
            const selectedBox = facetPanel.querySelector<HTMLElement>('.qf-selected')!;
            selectedBox.hidden = chosen.length === 0;
            selectedBox.querySelector('.qf-selected-tags')!.innerHTML = chosen.map(([group, value, label]) =>
                `<button type="button" class="qf-selected-tag" data-qf-remove="${group}" data-qf-value="${esc(value)}"
                    title="${esc(t('ov.qfRemoveFilter', { label }))}">${esc(label)}<span aria-hidden="true">×</span></button>`).join('');
            const moreCount = MORE_GROUPS.reduce((sum, group) => sum + (prefs.filters[group]?.length ?? 0), 0);
            facetPanel.querySelector('.qf-more-count')!.textContent = moreCount ? String(moreCount) : '';
        };

        const draw = () => {
            const model = buildQuestFlow(ctx.state, new Set(prefs.manualComplete));
            const pinned = new Set(prefs.pinned);
            const facetsByNo = new Map(model.rows.map(row => [row.definition.apiNo, questRowFacets(row)]));
            const rows = model.rows
                .filter(row => matches(row, facetsByNo.get(row.definition.apiNo)!, prefs, pinned))
                .sort((a, b) => listRank(a) - listRank(b)
                    || a.definition.apiNo - b.definition.apiNo);
            const selectedNo = prefs.targetNo && model.byNo.has(prefs.targetNo)
                ? prefs.targetNo
                : rows.find(row => row.current && !row.current.done)?.definition.apiNo
                    ?? rows.find(row => row.current)?.definition.apiNo
                    ?? rows.find(row => row.available)?.definition.apiNo
                    ?? rows[0]?.definition.apiNo;
            const selected = selectedNo == null ? null : model.byNo.get(selectedNo) ?? null;
            const listHint = query.value.trim()
                ? t('ov.qfSearchHint')
                : filtering(prefs)
                    ? t('ov.qfFilterHint')
                    : prefs.focus === 'focus' ? t('ov.qfFocusHint') : t('ov.qfAllHint');
            const catalogHint = t('ov.qfCatalogCount', { n: rows.length, total: model.rows.length });
            const catalogEmpty = prefs.pinnedOnly && !prefs.pinned.length ? t('ov.qfNoPinned') : t('ov.qfNoResults');
            updateFacets(model, facetsByNo, pinned);
            // 重畫時保留目錄與同一任務分頁的捲動位置；換任務時分頁回到頂端。
            const sameTarget = drawn?.selected?.definition.apiNo === selected?.definition.apiNo;
            const catalogScroll = body.querySelector('.qf-catalog .qf-panel-body')?.scrollTop ?? 0;
            const paneScroll = new Map([...body.querySelectorAll<HTMLElement>('[data-qf-pane]')]
                .map(pane => [pane.dataset.qfPane, pane.scrollTop] as const));
            body.innerHTML = `<div class="qf-board">
                ${boardPanel(t('ov.qfTaskDirectory'), catalogHint, listInner(model, rows, selectedNo, pinned, prefs, catalogEmpty), { titleAttr: listHint, className: 'qf-catalog' })}
                ${questFlowDetailHtml(model, selected, selected ? detailView(selected) : { ...defaultView }, pickerHtml(model, selectedNo))}
            </div>`;
            const catalogBody = body.querySelector<HTMLElement>('.qf-catalog .qf-panel-body');
            if (catalogBody) catalogBody.scrollTop = catalogScroll;
            if (sameTarget) {
                body.querySelectorAll<HTMLElement>('[data-qf-pane]').forEach(pane => {
                    pane.scrollTop = paneScroll.get(pane.dataset.qfPane) ?? 0;
                });
            }
            drawn = { model, selected };
        };

        const selectTab = (tab: QuestFlowDetailTab, focus = false) => {
            prefs.tab = tab;
            savePrefs(prefs);
            body.querySelectorAll<HTMLElement>('[data-qf-tab]').forEach(button => {
                const on = button.dataset.qfTab === tab;
                button.classList.toggle('on', on);
                button.setAttribute('aria-selected', String(on));
                button.tabIndex = on ? 0 : -1;
                if (on && focus) button.focus();
            });
            body.querySelectorAll<HTMLElement>('[data-qf-pane]').forEach(pane => { pane.hidden = pane.dataset.qfPane !== tab; });
        };

        // 滑過「需要」晶片時標出清單中對應的任務；滑過圖上節點時標出它的整條上游與下游。
        const clearHighlight = () => {
            el.querySelectorAll('.qf-hl').forEach(node => node.classList.remove('qf-hl'));
            el.querySelectorAll('.qf-graph.tracing').forEach(graph => graph.classList.remove('tracing'));
        };
        const highlight = (from: HTMLElement) => {
            clearHighlight();
            const node = from.closest<HTMLElement>('[data-qf-node]');
            const graph = node?.closest<HTMLElement>('.qf-graph');
            if (node && graph) {
                const edges = [...graph.querySelectorAll<SVGPathElement>('.qf-edge')];
                const lineage = new Set([node.dataset.qfNode!]);
                for (const [key, other] of [['to', 'from'], ['from', 'to']] as const) {
                    const queue = [node.dataset.qfNode!];
                    while (queue.length) {
                        const current = queue.pop()!;
                        for (const edge of edges) {
                            const next = edge.dataset[other]!;
                            if (edge.dataset[key] === current && !lineage.has(next)) { lineage.add(next); queue.push(next); }
                        }
                    }
                }
                graph.classList.add('tracing');
                graph.querySelectorAll<HTMLElement>('[data-qf-node]').forEach(item => {
                    if (lineage.has(item.dataset.qfNode!)) item.classList.add('qf-hl');
                });
                edges.forEach(edge => {
                    if (lineage.has(edge.dataset.from!) && lineage.has(edge.dataset.to!)) edge.classList.add('qf-hl');
                });
                return;
            }
            const chip = from.closest<HTMLElement>('[data-qf-ref]');
            const pane = chip?.closest<HTMLElement>('[data-qf-pane]');
            pane?.querySelectorAll(`[data-qf-item="${chip!.dataset.qfRef}"]`).forEach(item => item.classList.add('qf-hl'));
        };
        // 關係圖放大檢視：原生 dialog 以接近整個視窗的大小顯示同一張圖，不受面板高度限制；
        // 可縮放；開啟時先符合寬度（字仍可讀、只需上下捲），「符合視窗」才縮到整張可見。
        let graphZoom: number | 'fit' | 'width' = 'width';
        const applyGraphZoom = () => {
            const dialogBody = graphDialog.querySelector<HTMLElement>('.qf-graph-dialog-body')!;
            const graph = dialogBody.querySelector<HTMLElement>('.qf-graph');
            const frame = graph?.parentElement;
            const output = graphDialog.querySelector<HTMLOutputElement>('.qf-graph-zoom-value')!;
            if (!graph || !frame) { output.textContent = ''; return; }
            const width = parseFloat(graph.style.width);
            const height = parseFloat(graph.style.height);
            const tools = dialogBody.querySelector<HTMLElement>('.qf-graph-tools');
            const availWidth = dialogBody.clientWidth - 32;
            const scale = graphZoom === 'fit'
                ? questGraphFitScale(width, height, availWidth, dialogBody.clientHeight - (tools?.offsetHeight ?? 0) - 40)
                : graphZoom === 'width'
                    ? questGraphFitScale(width, 1, availWidth, Infinity)
                    : graphZoom;
            // 縮放後的實際占位交給外框，捲動範圍才會跟著縮
            frame.style.width = `${Math.round(width * scale)}px`;
            frame.style.height = `${Math.round(height * scale)}px`;
            graph.style.transform = `scale(${scale})`;
            output.textContent = `${Math.round(scale * 100)}%`;
            graphDialog.dataset.zoom = String(scale);
        };
        const fillGraphDialog = () => {
            if (!drawn?.selected) return;
            graphDialog.querySelector('#qf-graph-dialog-title')!.textContent = t('ov.qfGraphDialogTitle', {
                name: `${shortLabel(drawn.selected, drawn.selected.definition.apiNo)} ${taskName(drawn.selected)}`,
            });
            graphDialog.querySelector('.qf-graph-dialog-body')!.innerHTML = graphPaneHtml(drawn.model, drawn.selected, prefs.graphDone, false);
            if (graphDialog.open) applyGraphZoom();
        };
        // 拍照：整張圖（含捲出畫面的部分）依目前顯示狀態存成 PNG；結果寫在按鈕旁，失敗也要說明
        const saveGraphPhoto = async (button: HTMLButtonElement) => {
            const graph = graphDialog.querySelector<HTMLElement>('.qf-graph');
            const status = graphDialog.querySelector<HTMLElement>('.qf-graph-photo-status')!;
            if (!graph || !drawn?.selected) {
                status.textContent = t('ov.qfGraphPhotoEmpty');
                return;
            }
            const selected = drawn.selected;
            button.disabled = true;
            status.textContent = t('ov.qfGraphPhotoBusy');
            try {
                const ts = Date.now();
                const title = graphDialog.querySelector('#qf-graph-dialog-title')?.textContent ?? '';
                const blob = await renderQuestGraphPhoto(graph, title, ts);
                const filename = questGraphPhotoFilename(selected.definition.wikiIds[0] ?? String(selected.definition.apiNo), ts);
                downloadBlob(filename, blob);
                status.textContent = t('ov.qfGraphPhotoSaved', { name: filename });
            } catch (error) {
                console.error('[overview] 關係圖拍照失敗', error);
                status.textContent = t('ov.qfGraphPhotoFailed', { msg: String((error as Error)?.message ?? error) });
            } finally {
                button.disabled = false;
            }
        };
        graphDialog.addEventListener('close', () => {
            graphDialog.querySelector('.qf-graph-photo-status')!.textContent = '';
        });
        graphDialog.addEventListener('mouseover', event => highlight(event.target as HTMLElement));
        graphDialog.addEventListener('mouseleave', clearHighlight);
        graphDialog.addEventListener('focusin', event => highlight(event.target as HTMLElement));
        graphDialog.addEventListener('focusout', clearHighlight);
        graphDialog.addEventListener('close', clearHighlight);
        graphDialog.addEventListener('click', event => {
            const target = event.target as HTMLElement;
            if (target === graphDialog || target.closest('[data-qf-graph-close]')) { graphDialog.close(); return; }
            const photo = target.closest<HTMLButtonElement>('[data-qf-graph-photo]');
            if (photo) {
                void saveGraphPhoto(photo);
                return;
            }
            const zoom = target.closest<HTMLElement>('[data-qf-zoom]')?.dataset.qfZoom;
            if (zoom) {
                const current = Number(graphDialog.dataset.zoom) || 1;
                graphZoom = zoom === 'fit' ? 'fit' : zoom === 'actual' ? 1 : questGraphZoomStep(current, zoom === 'in' ? 1 : -1);
                applyGraphZoom();
                return;
            }
            const node = target.closest<HTMLElement>('[data-qf-target]');
            if (!node) return;
            // 點節點＝改看那個任務：關閉放大檢視，右欄換成該任務
            event.stopPropagation();
            const no = Number(node.dataset.qfTarget);
            graphDialog.close();
            if (Number.isSafeInteger(no) && no > 0) { prefs.targetNo = no; savePrefs(prefs); draw(); }
        });
        graphDialog.addEventListener('change', event => {
            const toggle = (event.target as HTMLElement).closest<HTMLInputElement>('[data-qf-graph-done]');
            if (!toggle) return;
            prefs.graphDone = toggle.checked;
            savePrefs(prefs);
            fillGraphDialog();
            graphDialog.querySelector<HTMLInputElement>('[data-qf-graph-done]')?.focus();
            const pane = body.querySelector<HTMLElement>('[data-qf-pane="graph"]');
            if (pane && drawn?.selected) pane.innerHTML = questFlowPaneHtml(drawn.model, drawn.selected, 'graph', detailView(drawn.selected));
        });
        body.addEventListener('mouseover', event => highlight(event.target as HTMLElement));
        body.addEventListener('mouseleave', clearHighlight);
        body.addEventListener('focusin', event => highlight(event.target as HTMLElement));
        body.addEventListener('focusout', clearHighlight);
        body.addEventListener('keydown', event => {
            const tabButton = (event.target as HTMLElement).closest<HTMLElement>('[data-qf-tab]');
            if (!tabButton) return;
            const index = DETAIL_TABS.indexOf(tabButton.dataset.qfTab as QuestFlowDetailTab);
            const next = event.key === 'ArrowRight' ? (index + 1) % DETAIL_TABS.length
                : event.key === 'ArrowLeft' ? (index + DETAIL_TABS.length - 1) % DETAIL_TABS.length
                    : event.key === 'Home' ? 0
                        : event.key === 'End' ? DETAIL_TABS.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            selectTab(DETAIL_TABS[next], true);
        });
        // details 的 toggle 不冒泡，改在捕獲階段記住「已完成的前置」展開狀態。
        body.addEventListener('toggle', event => {
            const details = event.target as HTMLElement;
            if (details.matches?.('[data-qf-done-group]')) doneOpen = (details as HTMLDetailsElement).open;
            if (details.matches?.('[data-qf-head-more]')) {
                prefs.headOpen = (details as HTMLDetailsElement).open;
                savePrefs(prefs);
            }
        }, true);

        query.addEventListener('input', () => { prefs.query = query.value; savePrefs(prefs); draw(); });
        facetPanel.addEventListener('click', event => {
            const target = event.target as HTMLElement;
            if (target.closest('.qf-clear')) {
                prefs.filters = {};
                prefs.pinnedOnly = false;
                savePrefs(prefs); draw();
                return;
            }
            if (target.closest('.qf-more-close')) {
                more.open = false;
                more.querySelector('summary')?.focus();
                return;
            }
            const chip = target.closest<HTMLElement>('[data-qf-facet], [data-qf-remove]');
            if (!chip) return;
            const group = (chip.dataset.qfFacet ?? chip.dataset.qfRemove) as QuestFacetGroup | 'pinned';
            if (group === 'pinned') {
                prefs.pinnedOnly = !prefs.pinnedOnly;
            } else {
                const value = chip.dataset.qfValue ?? '';
                const current = prefs.filters[group] ?? [];
                const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
                prefs.filters = { ...prefs.filters, [group]: next };
                if (!next.length) delete prefs.filters[group];
            }
            savePrefs(prefs); draw();
        });
        // 「更多條件」浮層：點浮層以外的地方或按 Esc 收起，焦點回到開關。
        el.addEventListener('click', event => {
            if (more.open && !more.contains(event.target as Node)) more.open = false;
        });
        el.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !more.open) return;
            more.open = false;
            more.querySelector('summary')?.focus();
        });
        el.querySelectorAll<HTMLButtonElement>('[data-qf-focus]').forEach(button => button.addEventListener('click', () => {
            prefs.focus = button.dataset.qfFocus === 'all' ? 'all' : 'focus';
            el.querySelectorAll<HTMLButtonElement>('[data-qf-focus]').forEach(item => {
                const on = item.dataset.qfFocus === prefs.focus;
                item.classList.toggle('on', on); item.setAttribute('aria-pressed', String(on));
            });
            savePrefs(prefs); draw();
        }));
        body.addEventListener('change', event => {
            const graphDone = (event.target as HTMLElement).closest<HTMLInputElement>('[data-qf-graph-done]');
            if (graphDone) {
                prefs.graphDone = graphDone.checked;
                savePrefs(prefs);
                const pane = body.querySelector<HTMLElement>('[data-qf-pane="graph"]');
                if (pane && drawn?.selected) {
                    pane.innerHTML = questFlowPaneHtml(drawn.model, drawn.selected, 'graph', detailView(drawn.selected));
                    pane.querySelector<HTMLInputElement>('[data-qf-graph-done]')?.focus();
                }
                return;
            }
            const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-qf-target-select]');
            if (!select) return;
            const no = Number(select.value);
            prefs.targetNo = Number.isSafeInteger(no) && no > 0 ? no : null;
            savePrefs(prefs); draw();
        });
        body.addEventListener('click', event => {
            const target = event.target as HTMLElement;
            const tabButton = target.closest<HTMLElement>('[data-qf-tab]');
            if (tabButton) {
                selectTab(tabButton.dataset.qfTab as QuestFlowDetailTab);
                return;
            }
            if (target.closest('[data-qf-graph-expand]')) {
                graphZoom = 'width';
                fillGraphDialog();
                graphDialog.showModal();
                applyGraphZoom();
                return;
            }
            const goto = target.closest<HTMLElement>('[data-qf-goto]');
            if (goto) {
                selectTab(goto.dataset.qfGoto as QuestFlowDetailTab, true);
                return;
            }
            const japaneseOriginal = target.closest<HTMLButtonElement>('[data-qf-ja-original-toggle]');
            if (japaneseOriginal) {
                const no = Number(japaneseOriginal.dataset.qfJaOriginalToggle);
                const panel = Number.isSafeInteger(no) && no > 0
                    ? body.querySelector<HTMLElement>(`[data-qf-ja-original-panel="${no}"]`)
                    : null;
                if (!panel) return;
                event.preventDefault(); event.stopPropagation();
                const expanded = japaneseOriginal.getAttribute('aria-expanded') === 'true';
                japaneseOriginalOpenNo = expanded ? null : no;
                japaneseOriginal.setAttribute('aria-expanded', String(!expanded));
                japaneseOriginal.textContent = t(expanded
                    ? 'ov.qfShowJapaneseOriginal'
                    : 'ov.qfHideJapaneseOriginal');
                panel.hidden = expanded;
                return;
            }
            const pin = target.closest<HTMLElement>('[data-qf-pin]');
            if (pin) {
                event.preventDefault(); event.stopPropagation();
                const no = Number(pin.dataset.qfPin);
                const adding = !prefs.pinned.includes(no);
                prefs.pinned = toggleNo(prefs.pinned, no);
                if (adding && Number.isSafeInteger(no) && no > 0) prefs.targetNo = no;
                savePrefs(prefs); draw(); return;
            }
            const manual = target.closest<HTMLElement>('[data-qf-manual]');
            if (manual) {
                event.preventDefault(); event.stopPropagation();
                prefs.manualComplete = toggleNo(prefs.manualComplete, Number(manual.dataset.qfManual));
                savePrefs(prefs); draw(); return;
            }
            const targetButton = target.closest<HTMLElement>('[data-qf-target]');
            if (targetButton) {
                const no = Number(targetButton.dataset.qfTarget);
                if (Number.isSafeInteger(no) && no > 0) { prefs.targetNo = no; savePrefs(prefs); draw(); }
            }
        });
        if (!deepLink) {
            draw();
            return;
        }
        // 從面板跳來時，這個分頁可能早就開著、狀態停在開啟當時；先重讀一次，進度紀錄才會是最新的。
        body.innerHTML = `<div class="ov-empty">${esc(t('ov.loading'))}</div>`;
        try {
            await ctx.reloadState();
        } catch (error) {
            console.error('[overview] 任務導覽重讀狀態失敗', error);
            body.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            return;
        }
        if (el.isConnected) draw();
    },
};
