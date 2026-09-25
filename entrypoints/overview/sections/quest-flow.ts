// 任務導覽：把任務目錄、已知關係與目前 GameState 疊成可聚焦的導覽。
// 釘選／人工完成存在 localStorage，並隨完整備份往返；本機觀測完成另存 db.questObserved。
// 搜尋與篩選仍只留在本機。
import type { OverviewSection } from './types';
import type {
    QuestCategory, QuestFlowModel, QuestFlowRow, QuestPeriod, QuestStatus,
} from '@/utils/quest-flow';
import {
    buildQuestFlow, isCompletedQuestRow, normalizeQuestSearch, questSearchHaystack, sourceLabelKey,
} from '@/utils/quest-flow';
import { t } from '@/utils/ui-i18n';
import {
    QUEST_FLOW_PREFS_KEY, normalizeQuestApiNos,
} from '@/utils/quest-flow-prefs';
import { esc, fmtTs, loadJsonPrefs, saveJsonPrefs } from '../lib';

const PREFS_KEY = QUEST_FLOW_PREFS_KEY;
type FocusMode = 'focus' | 'all';
type StatBucket =
    | 'current' | 'pinned' | 'ready' | 'available' | 'recurring'
    | 'near' | 'limited' | 'inferred' | 'unknown';

interface QuestFlowPrefs {
    targetNo: number | null;
    manualComplete: number[];
    pinned: number[];
    focus: FocusMode;
    bucket: StatBucket | 'none';
    query: string;
    category: QuestCategory | 'all';
    period: QuestPeriod | 'all';
    status: QuestStatus | 'all';
}

const CATEGORIES: QuestCategory[] = [
    'composition', 'sortie', 'practice', 'expedition',
    'supply-dock', 'arsenal', 'modernization', 'unknown',
];
const PERIODS: QuestPeriod[] = [
    'once', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'other', 'unknown',
];
const STATUSES: QuestStatus[] = [
    'available', 'in-progress', 'ready-to-claim', 'observed-complete',
    'inferred-complete', 'manual-complete', 'locked', 'unknown', 'expired',
];
const STAT_BUCKETS: StatBucket[] = [
    'current', 'pinned', 'ready', 'available', 'recurring', 'near', 'limited', 'inferred', 'unknown',
];
const STAT_BUCKET_KEYS: Record<StatBucket, string> = {
    current: 'ov.qfCurrentTasks',
    pinned: 'ov.qfPinnedPanel',
    ready: 'ov.qfReadyToClaim',
    available: 'ov.qfAvailableTasks',
    recurring: 'ov.qfRecurring',
    near: 'ov.qfNearUnlock',
    limited: 'ov.qfLimited',
    inferred: 'ov.qfInferredCount',
    unknown: 'ov.qfUnknownCount',
};

const CATEGORY_KEYS: Record<QuestCategory, string> = {
    composition: 'ov.qfCategoryComposition',
    sortie: 'ov.qfCategorySortie',
    practice: 'ov.qfCategoryPractice',
    expedition: 'ov.qfCategoryExpedition',
    'supply-dock': 'ov.qfCategorySupplyDock',
    arsenal: 'ov.qfCategoryArsenal',
    modernization: 'ov.qfCategoryModernization',
    unknown: 'ov.qfCategoryUnknown',
};
const PERIOD_KEYS: Record<QuestPeriod, string> = {
    once: 'ov.qfPeriodOnce',
    daily: 'ov.qfPeriodDaily',
    weekly: 'ov.qfPeriodWeekly',
    monthly: 'ov.qfPeriodMonthly',
    quarterly: 'ov.qfPeriodQuarterly',
    yearly: 'ov.qfPeriodYearly',
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

const defaultPrefs = (): QuestFlowPrefs => ({
    targetNo: null,
    manualComplete: [],
    pinned: [],
    focus: 'focus',
    bucket: 'none',
    query: '',
    category: 'all',
    period: 'all',
    status: 'all',
});

function loadPrefs(): QuestFlowPrefs {
    const fallback = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, fallback, raw => {
        if (!raw || typeof raw !== 'object') return fallback;
        const value = raw as Partial<QuestFlowPrefs>;
        const targetNo = Number(value.targetNo);
        const category = CATEGORIES.includes(value.category as QuestCategory)
            ? value.category as QuestCategory : 'all';
        const period = PERIODS.includes(value.period as QuestPeriod)
            ? value.period as QuestPeriod : 'all';
        const status = STATUSES.includes(value.status as QuestStatus)
            ? value.status as QuestStatus : 'all';
        const bucket = STAT_BUCKETS.includes(value.bucket as StatBucket)
            ? value.bucket as StatBucket : 'none';
        return {
            targetNo: Number.isSafeInteger(targetNo) && targetNo > 0 ? targetNo : null,
            manualComplete: normalizeQuestApiNos(value.manualComplete),
            pinned: normalizeQuestApiNos(value.pinned),
            focus: value.focus === 'all' ? 'all' : 'focus',
            bucket,
            query: typeof value.query === 'string' ? value.query : '',
            category, period, status,
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
    return t(CATEGORY_KEYS[category]);
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

function taskName(row: QuestFlowRow): string {
    return row.name || row.definition.name || t('ov.qfNameUnknown');
}

function taskDetail(row: QuestFlowRow): string {
    return row.detail || row.definition.detail || t('ov.qfNoDetail');
}

function lineBreaks(value: string): string {
    return esc(value).replace(/\r?\n/g, '<br>');
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

function rowHtml(row: QuestFlowRow, selected: boolean, pinned: boolean, manuallyComplete: boolean): string {
    return `<article class="qf-row${selected ? ' selected' : ''}${row.nearUnlock ? ' near' : ''}">
        <button type="button" class="qf-row-main" data-qf-target="${row.definition.apiNo}">
            <span class="qf-row-top">
                <span class="qf-status qf-status-${row.status}">${esc(statusLabel(row.status))}</span>
                ${row.nearUnlock ? `<span class="qf-near-badge">${esc(t('ov.qfNearUnlockBadge'))}</span>` : ''}
            </span>
            <strong class="qf-row-name">${esc(taskName(row))}</strong>
            <span class="qf-row-meta">${rowMeta(row)}</span>
            <span class="qf-progress">${esc(progressLabel(row))}</span>
        </button>
        <div class="qf-row-actions">
            <button type="button" class="qf-row-action${pinned ? ' on' : ''}" data-qf-pin="${row.definition.apiNo}"
                    aria-pressed="${pinned}" title="${esc(pinned ? t('ov.qfUnpin') : t('ov.qfPin'))}">${esc(pinned ? t('ov.qfUnpin') : t('ov.qfPin'))}</button>
            <button type="button" class="qf-row-action${manuallyComplete ? ' on' : ''}" data-qf-manual="${row.definition.apiNo}"
                    aria-pressed="${manuallyComplete}" title="${esc(manuallyComplete ? t('ov.qfManualUnmark') : t('ov.qfManualMark'))}">${esc(manuallyComplete ? t('ov.qfManualUnmark') : t('ov.qfManualMark'))}</button>
        </div>
    </article>`;
}

function routeNodeHtml(
    model: QuestFlowModel,
    no: number,
    direction: 'pre' | 'post',
    path: Set<string>,
    depth: number,
    budget: { value: number },
): string {
    if (budget.value-- <= 0) return `<li class="qf-tree-more">${esc(t('ov.qfRouteLimit'))}</li>`;
    const row = model.byNo.get(no);
    if (!row) {
        return `<li class="qf-tree-node qf-tree-missing"><span class="qf-node-summary"><b>#${no}</b> ${esc(t('ov.qfUnknown'))}</span></li>`;
    }
    const key = `${direction}:${no}`;
    const summary = `<button type="button" class="qf-node-summary" data-qf-target="${no}">
        <span class="qf-status qf-status-${row.status}">${esc(statusLabel(row.status))}</span>
        <b>${esc(taskName(row))}</b><small>api_no ${no}</small>
    </button>`;
    if (path.has(key)) {
        return `<li class="qf-tree-node qf-tree-cycle">${summary}<span class="qf-tree-note">${esc(t('ov.qfRouteCycle'))}</span></li>`;
    }
    if (depth >= 5) {
        return `<li class="qf-tree-node">${summary}<span class="qf-tree-note">${esc(t('ov.qfRouteDepth'))}</span></li>`;
    }
    const children = direction === 'pre' ? row.prerequisiteNos : row.postrequisiteNos;
    if (!children.length) return `<li class="qf-tree-node">${summary}</li>`;
    path.add(key);
    const collapsed = direction === 'pre' ? isCompletedQuestRow(row) : true;
    const nested = children.map(child => routeNodeHtml(model, child, direction, path, depth + 1, budget)).join('');
    path.delete(key);
    return `<li class="qf-tree-node">${summary}
        <details class="qf-tree-children"${collapsed ? '' : ' open'}>
            <summary>${esc(direction === 'pre' ? t('ov.qfPrerequisites') : t('ov.qfPostrequisites'))} · ${children.length}</summary>
            <ul>${nested}</ul>
        </details>
    </li>`;
}

function treeHtml(model: QuestFlowModel, row: QuestFlowRow, direction: 'pre' | 'post'): string {
    const children = direction === 'pre' ? row.prerequisiteNos : row.postrequisiteNos;
    if (!children.length) return `<p class="qf-empty-line">${esc(direction === 'pre' ? t('ov.qfNoPrerequisites') : t('ov.qfNoPostrequisites'))}</p>`;
    const budget = { value: 80 };
    return `<div class="qf-tree-note-head">${esc(direction === 'pre' ? relationLabel(row) : t('ov.qfKnownPostrequisites'))}</div>
        <ul class="qf-tree">${children.map(no => routeNodeHtml(model, no, direction, new Set(), 0, budget)).join('')}</ul>`;
}

function sourcesHtml(row: QuestFlowRow): string {
    if (!row.relation.sources.length) return `<span class="dim">${esc(t('ov.qfNoEvidence'))}</span>`;
    return row.relation.sources.map(source => `<span class="qf-source">${esc(t(sourceLabelKey(source)))}</span>`).join('');
}

function selectedEvidenceHtml(row: QuestFlowRow, picker: string): string {
    const observed = row.observed
        ? `<div class="qf-fact"><span>${esc(t('ov.qfObserved'))}</span><b>${esc(t('ov.qfObservedCount', { n: row.observed.count }))}</b><small>${esc(t('ov.qfObservedAt', { time: fmtTs(row.observed.lastTs) }))}</small>${row.observedCurrentPeriod ? '' : `<small class="qf-warning-text">${esc(t('ov.qfObservedNotCurrent'))}</small>`}</div>`
        : '';
    const localProgress = row.progress
        ? `<div class="qf-fact"><span>${esc(t('ov.qfProgressLocal'))}</span><b>${esc(progressLabel(row))}</b><small>${esc(t('quest.progressHint'))}</small></div>`
        : `<div class="qf-fact"><span>${esc(t('ov.qfProgressLocal'))}</span><b class="dim">${esc(t('ov.qfProgressUnknown'))}</b><small>${esc(t('ov.qfNeedObservation'))}</small></div>`;
    return `<details class="qf-now-evidence">
        <summary>${esc(t('ov.qfNowMore'))}</summary>
        <div class="qf-now-more-tools">${picker}</div>
        <div class="qf-facts">
            <div class="qf-fact"><span>${esc(t('ov.qfRelation'))}</span><b>${esc(relationLabel(row))}</b></div>
            <div class="qf-fact"><span>${esc(t('ov.qfConfidenceLabel'))}</span><b>${esc(evidenceLabel(row))}</b><small>${sourcesHtml(row)}</small></div>
            <div class="qf-fact"><span>${esc(t('ov.qfBlockers'))}</span><b>${row.blockers.length ? row.blockers.join(', ') : esc(t('ov.qfNoBlockers'))}</b></div>
            ${localProgress}${observed}
        </div>
        <p class="qf-evidence-note">${esc(t('ov.qfEvidenceNote'))}</p>
        <div class="qf-no-external"><span>${esc(t('ov.qfExternalNotEmbedded'))}</span></div>
    </details>`;
}

function nowHtml(row: QuestFlowRow | null, prefs: QuestFlowPrefs, model: QuestFlowModel): string {
    const picker = `<label class="qf-target-picker"><span>${esc(t('ov.qfTarget'))}</span><select data-qf-target-select><option value="">${esc(t('ov.qfTargetPlaceholder'))}</option>${model.rows.map(item => `<option value="${item.definition.apiNo}"${row && item.definition.apiNo === row.definition.apiNo ? ' selected' : ''}>${esc(`${item.definition.apiNo} · ${taskName(item)}`)}</option>`).join('')}</select></label>`;
    if (!row) {
        return `<section class="qf-panel qf-now">
            <div class="qf-panel-head"><h3>${esc(t('ov.qfSelectedPanel'))}</h3></div>
            <div class="qf-panel-body"><div class="ov-empty">${esc(t('ov.qfNoTarget'))}</div><div class="qf-now-more-tools">${picker}</div></div>
        </section>`;
    }
    const manual = prefs.manualComplete.includes(row.definition.apiNo);
    const pinned = prefs.pinned.includes(row.definition.apiNo);
    const unresolved = row.relation.unresolvedPrerequisites.length
        ? `<div class="qf-warning"><b>${esc(t('ov.qfUnresolved'))}</b><span>${row.relation.unresolvedPrerequisites.map(value => esc(value)).join('、')}</span></div>`
        : '';
    const limited = row.definition.limited
        ? `<div class="qf-warning"><b>${esc(t('ov.qfLimited'))}</b><span>${esc(t('ov.qfLimitedUnknown'))}</span></div>`
        : '';
    return `<section class="qf-panel qf-now">
        <div class="qf-panel-head">
            <div class="qf-now-head-main">
                <h3>${esc(t('ov.qfSelectedPanel'))}</h3>
                <span class="qf-status qf-status-${row.status}">${esc(statusLabel(row.status))}</span>
                <span class="qf-now-flags">${pinned ? esc(t('ov.qfPinned')) : ''}${pinned && manual ? ' · ' : ''}${manual ? esc(t('ov.qfManual')) : ''}</span>
            </div>
            <div class="qf-now-head-actions">
                <button type="button" class="ov-btn" data-qf-pin="${row.definition.apiNo}" aria-pressed="${pinned}">${esc(pinned ? t('ov.qfUnpin') : t('ov.qfPin'))}</button>
                <button type="button" class="ov-btn" data-qf-manual="${row.definition.apiNo}" aria-pressed="${manual}">${esc(manual ? t('ov.qfManualUnmark') : t('ov.qfManualMark'))}</button>
            </div>
        </div>
        <div class="qf-panel-body">
            <strong class="qf-now-name">${esc(taskName(row))}</strong>
            <div class="qf-row-meta">${rowMeta(row)}</div>
            <p class="qf-task-detail">${lineBreaks(taskDetail(row))}</p>
            ${unresolved}${limited}
            ${selectedEvidenceHtml(row, picker)}
        </div>
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

function listInner(rows: QuestFlowRow[], selectedNo: number | undefined, pinned: Set<number>, prefs: QuestFlowPrefs, empty: string): string {
    if (!rows.length) return `<div class="ov-empty">${esc(empty)}</div>`;
    return `<div class="qf-list" role="list">${rows.map(row => rowHtml(row, row.definition.apiNo === selectedNo, pinned.has(row.definition.apiNo), prefs.manualComplete.includes(row.definition.apiNo))).join('')}</div>`;
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

function bucketRow(row: QuestFlowRow, bucket: StatBucket, pinned: Set<number>): boolean {
    if (bucket === 'current') return !!row.current;
    if (bucket === 'pinned') return pinned.has(row.definition.apiNo);
    if (bucket === 'ready') return row.status === 'ready-to-claim';
    if (bucket === 'available') return row.status === 'available';
    if (bucket === 'recurring') {
        return !['once', 'unknown', 'other'].includes(row.definition.period);
    }
    if (bucket === 'near') return row.nearUnlock;
    if (bucket === 'limited') return row.definition.limited;
    if (bucket === 'inferred') return row.status === 'inferred-complete';
    return row.status === 'unknown';
}

function matches(row: QuestFlowRow, prefs: QuestFlowPrefs, pinned: Set<number>): boolean {
    const query = normalizeQuestSearch(prefs.query);
    const inSearch = !query || questSearchHaystack({
        name: taskName(row),
        detail: taskDetail(row),
        definition: row.definition,
    }).includes(query);
    if (!inSearch) return false;
    const inBucket = prefs.bucket === 'none'
        || bucketRow(row, prefs.bucket, pinned)
        || (!!query && prefs.bucket !== 'pinned');
    const inFocus = !!query || prefs.bucket !== 'none' || prefs.focus === 'all' || focusRow(row);
    return inBucket && inFocus
        && (prefs.category === 'all' || row.definition.category === prefs.category)
        && (prefs.period === 'all' || row.definition.period === prefs.period);
}

function listRank(row: QuestFlowRow): number {
    if (row.current && !row.current.done) return 1;
    if (row.current) return 2;
    if (row.available) return 3;
    if (row.nearUnlock) return 4;
    return 5;
}

function statHtml(bucket: StatBucket, value: number, on: boolean): string {
    const label = t(STAT_BUCKET_KEYS[bucket]);
    return `<button type="button" class="qf-stat ${bucket}${on ? ' on' : ''}" data-qf-bucket="${bucket}"
        aria-pressed="${on}" title="${esc(t('ov.qfBucketTitle', { label }))}">
        <span>${esc(label)}</span><b>${value}</b>
    </button>`;
}

export const questFlowSection: OverviewSection = {
    id: 'quest-flow', titleKey: 'ov.questFlow',
    render(el, ctx) {
        const prefs = loadPrefs();
        el.innerHTML = `<div class="qf">
            <details class="qf-intro">
                <summary><span class="qf-kicker">${esc(t('ov.qfKicker'))}</span> ${esc(t('ov.qfHelp'))}</summary>
                <p>${esc(t('ov.qfIntro'))}</p>
                <p class="qf-intro-note">${esc(t('ov.qfIdentityNote'))}</p>
            </details>
            <div class="ov-toolbar qf-toolbar">
                <label class="qf-search"><span class="sr-only">${esc(t('ov.qfSearch'))}</span><input class="rs-search qf-query" type="search" autocomplete="off" value="${esc(prefs.query)}" placeholder="${esc(t('ov.qfSearchPlaceholder'))}"></label>
                <div class="qf-focus" role="group" aria-label="${esc(t('ov.qfViewMode'))}">
                    <button type="button" class="ov-btn${prefs.focus === 'focus' ? ' on' : ''}" data-qf-focus="focus" aria-pressed="${prefs.focus === 'focus'}">${esc(t('ov.qfFilterFocus'))}</button>
                    <button type="button" class="ov-btn${prefs.focus === 'all' ? ' on' : ''}" data-qf-focus="all" aria-pressed="${prefs.focus === 'all'}">${esc(t('ov.qfFilterAll'))}</button>
                </div>
                <label class="qf-select"><span>${esc(t('ov.qfCategoryLabel'))}</span><select class="qf-category"><option value="all">${esc(t('ov.qfAll'))}</option>${CATEGORIES.map(value => `<option value="${value}"${prefs.category === value ? ' selected' : ''}>${esc(categoryLabel(value))}</option>`).join('')}</select></label>
                <label class="qf-select"><span>${esc(t('ov.qfPeriodLabel'))}</span><select class="qf-period"><option value="all">${esc(t('ov.qfAll'))}</option>${PERIODS.map(value => `<option value="${value}"${prefs.period === value ? ' selected' : ''}>${esc(periodLabel(value))}</option>`).join('')}</select></label>
                <div class="qf-stats" role="group" aria-label="${esc(t('ov.qfStatsGroup'))}"></div>
            </div>
            <div class="qf-body"></div>
        </div>`;

        const body = el.querySelector<HTMLElement>('.qf-body')!;
        const stats = el.querySelector<HTMLElement>('.qf-stats')!;
        const query = el.querySelector<HTMLInputElement>('.qf-query')!;
        const category = el.querySelector<HTMLSelectElement>('.qf-category')!;
        const period = el.querySelector<HTMLSelectElement>('.qf-period')!;

        const draw = () => {
            const model = buildQuestFlow(ctx.state, new Set(prefs.manualComplete));
            const pinned = new Set(prefs.pinned);
            const rows = model.rows
                .filter(row => matches(row, prefs, pinned))
                .sort((a, b) => listRank(a) - listRank(b)
                    || a.definition.apiNo - b.definition.apiNo);
            const selectedNo = prefs.targetNo && model.byNo.has(prefs.targetNo)
                ? prefs.targetNo
                : rows.find(row => row.current && !row.current.done)?.definition.apiNo
                    ?? rows.find(row => row.current)?.definition.apiNo
                    ?? rows.find(row => row.available)?.definition.apiNo
                    ?? rows[0]?.definition.apiNo;
            const selected = selectedNo == null ? null : model.byNo.get(selectedNo) ?? null;
            const counts: Record<StatBucket, number> = {
                current: model.rows.filter(row => row.current).length,
                pinned: prefs.pinned.length,
                ready: model.rows.filter(row => row.status === 'ready-to-claim').length,
                available: model.rows.filter(row => row.status === 'available').length,
                recurring: model.rows.filter(row => !['once', 'unknown', 'other'].includes(row.definition.period)).length,
                near: model.rows.filter(row => row.nearUnlock).length,
                limited: model.rows.filter(row => row.definition.limited).length,
                inferred: model.rows.filter(row => row.status === 'inferred-complete').length,
                unknown: model.rows.filter(row => row.status === 'unknown').length,
            };
            const listHint = query.value.trim()
                ? t('ov.qfSearchHint')
                : prefs.bucket === 'none'
                    ? (prefs.focus === 'focus' ? t('ov.qfFocusHint') : t('ov.qfAllHint'))
                    : t('ov.qfBucketHint', { label: t(STAT_BUCKET_KEYS[prefs.bucket]) });
            const catalogHint = t('ov.qfCatalogCount', { n: rows.length, total: model.rows.length });
            const catalogEmpty = prefs.bucket === 'pinned' ? t('ov.qfNoPinned') : t('ov.qfNoResults');
            const preHint = selected
                ? String(selected.prerequisiteNos.length)
                : t('ov.qfNoTarget');
            const postHint = selected
                ? String(selected.postrequisiteNos.length)
                : t('ov.qfNoTarget');
            const chainLabel = selected
                ? t('ov.qfChainOf', { name: taskName(selected) })
                : t('ov.qfNoTarget');
            stats.innerHTML = STAT_BUCKETS.map(bucket => statHtml(bucket, counts[bucket], prefs.bucket === bucket)).join('');
            body.innerHTML = `<div class="qf-board">
                ${boardPanel(t('ov.qfTaskDirectory'), catalogHint, listInner(rows, selectedNo, pinned, prefs, catalogEmpty), { titleAttr: listHint, className: 'qf-catalog' })}
                <div class="qf-context">
                    ${nowHtml(selected, prefs, model)}
                    <div class="qf-chain">
                        <p class="qf-chain-label">${esc(chainLabel)}</p>
                        <div class="qf-route">
                            ${boardPanel(t('ov.qfPreArrow'), preHint, selected ? treeHtml(model, selected, 'pre') : `<div class="ov-empty">${esc(t('ov.qfNoTarget'))}</div>`)}
                            ${boardPanel(t('ov.qfPostArrow'), postHint, selected ? treeHtml(model, selected, 'post') : `<div class="ov-empty">${esc(t('ov.qfNoTarget'))}</div>`)}
                        </div>
                    </div>
                </div>
            </div>`;
        };

        query.addEventListener('input', () => { prefs.query = query.value; savePrefs(prefs); draw(); });
        category.addEventListener('change', () => { prefs.category = category.value as QuestCategory | 'all'; savePrefs(prefs); draw(); });
        period.addEventListener('change', () => { prefs.period = period.value as QuestPeriod | 'all'; savePrefs(prefs); draw(); });
        el.querySelectorAll<HTMLButtonElement>('[data-qf-focus]').forEach(button => button.addEventListener('click', () => {
            prefs.focus = button.dataset.qfFocus === 'all' ? 'all' : 'focus';
            el.querySelectorAll<HTMLButtonElement>('[data-qf-focus]').forEach(item => {
                const on = item.dataset.qfFocus === prefs.focus;
                item.classList.toggle('on', on); item.setAttribute('aria-pressed', String(on));
            });
            savePrefs(prefs); draw();
        }));
        body.addEventListener('change', event => {
            const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-qf-target-select]');
            if (!select) return;
            const no = Number(select.value);
            prefs.targetNo = Number.isSafeInteger(no) && no > 0 ? no : null;
            savePrefs(prefs); draw();
        });
        stats.addEventListener('click', event => {
            const bucketButton = (event.target as HTMLElement).closest<HTMLElement>('[data-qf-bucket]');
            if (!bucketButton) return;
            const next = bucketButton.dataset.qfBucket as StatBucket;
            prefs.bucket = prefs.bucket === next ? 'none' : next;
            if (prefs.bucket !== 'none') {
                prefs.status = 'all';
                prefs.period = 'all';
                period.value = 'all';
            }
            savePrefs(prefs); draw();
        });
        body.addEventListener('click', event => {
            const target = event.target as HTMLElement;
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
        draw();
    },
};
