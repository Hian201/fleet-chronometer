// 打撈紀錄 › 道具捕撈：方案 A 左右雙欄（左：漁場捕撈狀況；右：任務鏈與兌換；上：目標進度帶）。
// 統計規則全在 utils/item-catch-stats.ts（k／n／u 的定義、場數與趟數分計、連續無魚場數、近期 12 場）；
// 本檔只管殼、篩選、載入與重畫。規格見 docs/saury-layout-plan.md 與 docs/saury-plan.md §4.2。
//
// 狀態保留（design-guidelines §4.2）：篩選與設定控制項只畫一次；重畫只換統計區，展開中的
// <details> 依 data-key 記住後還原，捲動位置跟著頁面不動。查詢以遞增序號丟棄過期結果。
// 即時更新只用 ts 索引讀新進來的列並合併，不重讀整段歷史。
import type { SortieLogRow } from '@/utils/db';
import { db } from '@/utils/db';
import { useItemDisplayName } from '@/utils/item-catalog';
import {
    RECENT_OUTCOME_LIMIT,
    compareDryCatch, isCatchRow, itemCatchStats, type AreaCatchStat, type CatchCounts, type CatchGroundScope,
    type MapCatchStat, type NodeCatchStat, type RecentOutcome,
} from '@/utils/item-catch-stats';
import {
    catchesInWindow, isValidAlertNumber, loadCatchAlertRule, saveCatchAlertRule, type CatchAlertRule,
} from '@/utils/catch-alert';
import {
    CATCH_SEASONS, currentSeasonRange, jstInputToTs, latestSeason, loadInferredEnd, loadUserEnd, onSeasonEndChange, saveUserEnd,
    SAURY_ITEM, tsToJstInput, type CatchSeason,
} from '@/utils/catch-season';
import { loadDcReminderOff, onDcReminderChange, saveDcReminder } from '@/utils/depth-charge';
import { nodeLabel } from '@/utils/map-node-letters';
import { loadExcludeCatch, loadExcludedMaps, onExcludeCatchChange, onExcludedMapsChange } from '@/utils/sortie-exclude';
import { isEventWorld, mapLabel, parseMapCode } from '@/utils/sortie-detail';
import { buildQuestFlow, QUEST_CATALOG_BY_NO, type QuestFlowModel } from '@/utils/quest-flow';
import { loadQuestCatalogLocale, localizedQuestName } from '@/utils/quest-catalog-localization';
import { readQuestFlowBackupPrefs } from '@/utils/quest-flow-prefs';
import { loadSauryMarks, SAURY_CHAINS, saveSauryMarks, sauryNeed, type SauryNeed, type SauryStep } from '@/utils/saury-chain';
import { getLang, t } from '@/utils/ui-i18n';
import { dateEnd, dateStart, esc, eventDisplayName, fmtShortTs, fmtTs } from '../lib';
import type { OverviewSection, SectionContext } from './types';

/** 秋刀魚（useitem 68）。 */
export const DEFAULT_CATCH_ITEM = 68;

/** 結算寫入 db.sorties 的封包；投影由面板做，與通知的先後不保證，所以稍等再讀。 */
const REFRESH_PATHS = new Set(['api_req_sortie/battleresult', 'api_req_combined_battle/battleresult']);
// 任務清單與領獎會改變任務鏈的狀態。
const HELD_PATHS = new Set(['api_port/port', 'api_get_member/useitem', 'api_get_member/questlist', 'api_req_quest/clearitemget', ...REFRESH_PATHS]);
const REFRESH_DELAY = 1500;

type GroundSort = 'area' | 'recent' | 'dry';
type ChainState = 'done' | 'claim' | 'active' | 'open' | 'locked' | 'unknown';
const CHAIN_STATE_KEY: Record<ChainState, string> = {
    done: 'ov.icChainDone', claim: 'ov.qfStatusReadyToClaim', active: 'ov.qfStatusInProgress',
    open: 'ov.qfStatusAvailable', locked: 'ov.qfStatusLocked', unknown: 'ov.qfStatusUnknown',
};

const num = (n: number) => n.toLocaleString('en-US');
const none = `<span class="ic-none">–</span>`;

function hitsHtml(c: CatchCounts): string {
    return c.n || c.u ? `<span class="ic-hits" title="${esc(t('ov.icHitsTip'))}">${num(c.k)}／${num(c.n)}</span>` : none;
}

function unknownHtml(u: number): string {
    return u ? `<span class="ic-unknown">${num(u)}</span>` : none;
}

function dryHtml(s: AreaCatchStat | MapCatchStat): string {
    const dry = s.dryStreak;
    if (!dry) {
        if (s.total.n === 0) return none;
        const tip = [t('ov.icDryTip', { s: s.byRank.S.n, a: s.byRank.A.n }), s.total.u ? t('ov.icDryUnknown', { u: s.total.u }) : ''].filter(Boolean).join('\n');
        return `<span class="ic-dry ic-dry-badge is-zero" title="${esc(tip)}">${esc(t('ov.icDryN', { n: num(s.total.n) }))}</span><span class="ic-sub">${esc(t('ov.icDryNever'))}</span>`;
    }
    const cls = dry.n === 0 ? 'is-zero' : 'is-mid';
    const tip = [t('ov.icDryTip', { s: dry.s, a: dry.a }), dry.u ? t('ov.icDryUnknown', { u: dry.u }) : ''].filter(Boolean).join('\n');
    const sub = dry.n > 0 || dry.u > 0
        ? `<span class="ic-sub">${esc(dry.u ? t('ov.icDrySubU', { s: dry.s, a: dry.a, u: num(dry.u) }) : t('ov.icDrySub', { s: dry.s, a: dry.a }))}</span>`
        : '';
    return `<span class="ic-dry ic-dry-badge ${cls}" title="${esc(tip)}">${esc(t('ov.icDryN', { n: num(dry.n) }))}</span>${sub}`;
}

/** 近期 12 場（左舊右新）純紀錄節奏條。 */
function rhythmHtml(outcomes: readonly RecentOutcome[]): string {
    const padCount = Math.max(0, RECENT_OUTCOME_LIMIT - outcomes.length);
    const pads = Array.from({ length: padCount }, () => `<span class="ic-dot is-pad"></span>`).join('');
    const dots = outcomes.slice(-RECENT_OUTCOME_LIMIT).map(o => {
        const cls = o.caught === null ? 'is-unknown'
            : o.caught >= 2 ? 'is-hit2'
                : o.caught === 1 ? 'is-hit1'
                    : o.rank !== 'other' ? 'is-sa' : 'is-other';
        const node = nodeLabel(o.map, o.node);
        const rankText = o.rank === 'other' ? t('ov.icRankOther') : o.rank;
        const valText = o.caught === null ? t('ov.icColUnknown') : num(o.caught);
        const tip = `${fmtShortTs(o.ts)} · ${o.map} ${node} · ${rankText} · ${valText}`;
        return `<span class="ic-dot ${cls}" title="${esc(tip)}"></span>`;
    }).join('');
    return `<span class="ic-rhythm" title="${esc(t('ov.icColRhythmTip'))}">${pads}${dots}</span>`;
}

/** 出擊紀錄看得到的結算時刻；catchOnly 列不在出擊紀錄，連過去會找不到那一場。 */
type Linkable = ReadonlySet<number>;

function timeHtml(ts: number | null, linkable: Linkable | null, short = false): string {
    if (ts === null) return none;
    const time = `<time>${esc(short ? fmtShortTs(ts) : fmtTs(ts))}</time>`;
    // 出擊紀錄的深連結：解除篩選、翻到該場並展開，可核對地圖、節點、勝利等級與道具。
    return linkable?.has(ts) ? `<a class="ic-link" href="#/sortie-log?ts=${ts}" title="${esc(t('ov.icOpenSortie'))}">${time}</a>` : time;
}

function elapsedLabel(ts: number, now: number): string {
    const mins = Math.max(0, Math.floor((now - ts) / 60_000));
    if (mins < 1) return t('ov.icAgoSoon');
    if (mins < 60) return t('ov.icAgoMin', { n: mins });
    if (mins < 24 * 60) return t('ov.icAgoHour', { n: Math.floor(mins / 60) });
    return t('ov.icAgoDay', { n: Math.floor(mins / (24 * 60)) });
}

/** 距最後戰鬥經過時間；歷史檢視（選了早於現在的截止日）改回絕對時刻以免誤讀。 */
function lastBattleAgoHtml(ts: number | null, now: number, historical: boolean, sameYear: boolean): string {
    if (ts === null) return none;
    const tip = `${fmtTs(ts)}\n${t('ov.icColLastBattleAgoTip')}`;
    if (historical) {
        return `<span class="ic-ago" title="${esc(tip)}">${esc(sameYear ? fmtShortTs(ts) : fmtTs(ts))}</span>`;
    }
    return `<span class="ic-ago" data-battle-ts="${ts}" title="${esc(tip)}">${esc(elapsedLabel(ts, now))}</span>`;
}

function totalCellHtml(c: CatchCounts): string {
    const main = c.caught ? `<b>${num(c.caught)}</b>` : '0';
    const sub = c.n || c.u ? `${num(c.k)}／${num(c.n)}${c.u ? ` +${num(c.u)}?` : ''}` : '–';
    return `${main}<span class="ic-sub" title="${esc(t('ov.icColTotalTip'))}">${esc(sub)}</span>`;
}

/** 換曲範圍外、但撈到魚而照算的場數標記。 */
function outsideBadge(outside: number): string {
    return outside ? ` <span class="ic-outside" title="${esc(t('ov.icOutsideTip', { n: outside }))}">${esc(t('ov.icOutside'))}</span>` : '';
}

function areaTitle(area: number, ctx: SectionContext): string {
    return isEventWorld(area)
        ? eventDisplayName(area, ctx.state.masterMapAreas.get(area))
        : `${area} ${ctx.state.mapAreaName(area)}`.trim();
}

/** 大海域 → 自訂提醒時窗內的捕獲條數；只放已達門檻的。 */
type AlertHits = ReadonlyMap<number, number>;

function alertBadge(area: number, hits: AlertHits, rule: CatchAlertRule | null): string {
    const n = hits.get(area);
    return n === undefined || !rule ? ''
        : ` <span class="ic-alert-hit" title="${esc(t('ov.icAlertHitTip', { hours: rule.hours, n }))}">${esc(t('ov.icAlertHit'))}</span>`;
}

function alertBarHtml(windowCount: number | undefined, rule: CatchAlertRule | null): string {
    if (windowCount === undefined || !rule) return '';
    const pct = Math.min(100, Math.round((windowCount / Math.max(1, rule.count)) * 100));
    const hit = windowCount >= rule.count;
    return `<span class="ic-alert-bar${hit ? ' is-hit' : ''}" title="${esc(`${windowCount}／${rule.count}`)}"><i style="width:${pct}%"></i></span>`;
}

function nodeTableHtml(map: MapCatchStat, linkable: Linkable, sameYear: boolean): string {
    const hasUnknown = map.total.u > 0;
    const rank = (c: CatchCounts) => `<td class="ic-num">${hitsHtml(c)}</td>`;
    const lastCatch = map.lastCatchTs !== null
        ? `<p class="ic-nodes-foot">${esc(t('ov.icColLastCatch'))}：${timeHtml(map.lastCatchTs, linkable, sameYear)}</p>` : '';
    return `<div class="dl-table-wrap ic-nodes"><table class="dl-table"><thead><tr>
        <th>${esc(t('ov.dropColNode'))}</th>
        <th class="ic-num" title="${esc(t('ov.icColCaughtTip'))}">${esc(t('ov.icColCaught'))}</th>
        <th class="ic-num" title="${esc(t('ov.icHitsTip'))}">S</th>
        <th class="ic-num" title="${esc(t('ov.icHitsTip'))}">A</th>
        <th class="ic-num" title="${esc(t('ov.icHitsTip'))}">${esc(t('ov.icRankOther'))}</th>
        ${hasUnknown ? `<th class="ic-num" title="${esc(t('ov.icColUnknownTip'))}">${esc(t('ov.icColUnknown'))}</th>` : ''}
        <th class="ic-num" title="${esc(t('ov.icColSortiesTip'))}">${esc(t('ov.icColSorties'))}</th>
    </tr></thead><tbody>${map.nodes.map(n => {
        const label = nodeLabel(n.map, n.node);
        return `<tr>
            <td><span class="dl-node" title="${esc(label === String(n.node) ? label : `edge ${n.node}`)}">${esc(label)}</span>${outsideBadge(n.outside)}</td>
            <td class="ic-num">${n.total.caught ? `<b>${num(n.total.caught)}</b>` : '0'}</td>
            ${rank(n.byRank.S)}${rank(n.byRank.A)}${rank(n.byRank.other)}
            ${hasUnknown ? `<td class="ic-num">${unknownHtml(n.total.u)}</td>` : ''}
            <td class="ic-num">${num(n.sorties)}</td>
        </tr>`;
    }).join('')}</tbody></table>${lastCatch}</div>`;
}

function rowCells(
    s: AreaCatchStat | MapCatchStat,
    now: number,
    historical: boolean,
    sameYear: boolean,
    windowCount: number | undefined,
    rule: CatchAlertRule | null,
): string {
    return `<span class="ic-num">${rhythmHtml(s.recentOutcomes)}</span>
        <span class="ic-num ic-recent-cell"><span>${num(s.recent6h)}／${num(s.recent24h)}</span>${alertBarHtml(windowCount, rule)}</span>
        <span class="ic-num">${dryHtml(s)}</span>
        <span class="ic-num">${lastBattleAgoHtml(s.lastBattleTs, now, historical, sameYear)}</span>
        <span class="ic-num">${totalCellHtml(s.total)}</span>`;
}

function headHtml(): string {
    return `<div class="ic-row ic-head">
        <span>${esc(t('ov.icColArea'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColRhythmTip'))}">${esc(t('ov.icColRhythm'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColRecentTip'))}">${esc(t('ov.icColRecent'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColDryTip'))}">${esc(t('ov.icColDry'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColLastBattleAgoTip'))}">${esc(t('ov.icColLastBattleAgo'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColTotalTip'))}">${esc(t('ov.icColTotal'))}</span>
    </div>`;
}

function sortAreas(areas: AreaCatchStat[], sort: GroundSort): AreaCatchStat[] {
    if (sort === 'recent') {
        return [...areas].sort((a, b) => (b.lastBattleTs ?? -1) - (a.lastBattleTs ?? -1) || a.area - b.area);
    }
    if (sort === 'dry') {
        return [...areas].sort((a, b) => compareDryCatch(a, b) || a.area - b.area);
    }
    return areas;
}

function sortMaps(maps: MapCatchStat[], sort: GroundSort): MapCatchStat[] {
    if (sort === 'recent') {
        return [...maps].sort((a, b) => (b.lastBattleTs ?? -1) - (a.lastBattleTs ?? -1));
    }
    if (sort === 'dry') {
        return [...maps].sort(compareDryCatch);
    }
    return maps;
}

function statsHtml(
    areas: AreaCatchStat[],
    ctx: SectionContext,
    open: ReadonlySet<string>,
    linkable: Linkable,
    hits: AlertHits,
    windowCounts: ReadonlyMap<number, number> | null,
    rule: CatchAlertRule | null,
    sort: GroundSort,
    now: number,
    historical: boolean,
    sameYear: boolean,
): string {
    const isOpen = (key: string) => open.has(key) ? ' open' : '';
    const ordered = sortAreas(areas, sort);
    return `<div class="ic-grid">${headHtml()}${ordered.map(a => `
        <details class="ic-area" data-key="a${a.area}"${isOpen(`a${a.area}`)}>
            <summary class="ic-row"><span class="ic-name ic-name-flex"><span class="ic-name-text">${esc(areaTitle(a.area, ctx))}</span>${outsideBadge(a.outside)}${alertBadge(a.area, hits, rule)}</span>${rowCells(a, now, historical, sameYear, windowCounts ? (windowCounts.get(a.area) ?? 0) : undefined, rule)}</summary>
            ${sortMaps(a.maps, sort).map(m => {
                const p = parseMapCode(m.map);
                const label = mapLabel({ map: m.map, mapnum: p.mapnum, event: isEventWorld(p.world) });
                return `<details class="ic-map" data-key="m${esc(m.map)}"${isOpen(`m${esc(m.map)}`)}>
                    <summary class="ic-row"><span class="ic-name ic-name-flex" title="${esc(m.map)}"><span class="ic-name-text">${esc(label)}</span>${outsideBadge(m.outside)}</span>${rowCells(m, now, historical, sameYear, undefined, null)}</summary>
                    ${nodeTableHtml(m, linkable, sameYear)}
                </details>`;
            }).join('')}
        </details>`).join('')}</div>`;
}

// ── 任務鏈（utils/saury-chain.ts）──────────────────────────────────────

/**
 * 任務步驟的狀態。編號每年重用，所以本機領獎紀錄只認本季開始之後的；週任（369）本季領過一次就算
 * 鏈上完成，本週又出現在清單也一樣。
 */
function chainState(model: QuestFlowModel, no: number, seasonStart: number): ChainState {
    const row = model.byNo.get(no);
    if (!row) return 'unknown';
    if (row.observed && row.observed.lastTs >= seasonStart) return 'done';
    switch (row.status) {
        case 'ready-to-claim': return 'claim';
        case 'in-progress': return 'active';
        case 'available': return 'open';
        case 'manual-complete': case 'inferred-complete': return 'done';
        case 'locked': return 'locked';
        default: return 'unknown';
    }
}

function chainFishHtml(s: SauryStep): string {
    if (s.kind === 'hold') return `<span title="${esc(t('ov.icChainHoldTip'))}">${esc(t('ov.icChainHold', { n: s.fish }))}</span>`;
    if (s.kind === 'exercise') return esc(t('ov.icChainExercise'));
    if (s.kind === 'consume') return esc(t('ov.icChainConsume', { n: s.fish }));
    return esc(s.times > 1 ? t('ov.icChainTimes', { n: s.fish, times: s.times }) : t('ov.icChainConsume', { n: s.fish }));
}

function chainNameHtml(s: SauryStep): string {
    if (s.quest === undefined) return esc(t(`ov.icChainEx.${s.id}`));
    const def = QUEST_CATALOG_BY_NO.get(s.quest);
    const name = localizedQuestName(s.quest, getLang(), def?.name ?? String(s.quest));
    const code = def?.wikiIds[0] ?? String(s.quest);
    return `<a class="ic-link" href="#/quest-flow?no=${s.quest}" title="${esc(t('ov.icChainOpenQuest'))}"><span class="ic-chain-code">${esc(code)}</span>${esc(name)}</a>`;
}

function chainStepRowHtml(s: SauryStep, marks: Readonly<Record<string, number>>): string {
    const skippable = s.kind === 'consume' || s.kind === 'exchange';
    const checkedN = marks[s.id] ?? 0;
    const boxes = skippable ? `<span class="ic-step-checks" title="${esc(t('ov.icChainColSkipTip'))}">${Array.from({ length: s.times }, (_, i) =>
        `<input type="checkbox" data-chain-mark="${esc(s.id)}" aria-label="${esc(t('ov.icChainColSkip'))}"${i < checkedN ? ' checked' : ''}>`).join('')}</span>` : '';
    const metTag = s.kind === 'hold' ? `<span class="ic-met-tag" hidden>${esc(t('ov.icChainMet'))}</span>` : '';
    const remTag = s.kind === 'exchange' && s.times > 1 ? `<span class="ic-step-rem"></span>` : '';
    return `<div class="ic-step" data-chain-step="${esc(s.id)}">
        <span class="ic-step-icon">·</span>
        <span class="ic-step-title">${chainNameHtml(s)}${remTag}</span>
        <span class="ic-step-right">${metTag}<span class="ic-step-fish">${chainFishHtml(s)}</span>${boxes}</span>
    </div>`;
}

/** 步驟骨架只在換季或譯文載入時重畫；勾選框由存檔還原，狀態與達標標記由 drawChain 就地更新。 */
function chainBodyHtml(steps: readonly SauryStep[], marks: Readonly<Record<string, number>>): string {
    const holdSteps = steps.filter(s => s.kind === 'hold' || s.kind === 'exercise');
    const consumeSteps = steps.filter(s => s.kind === 'consume' || s.kind === 'exchange');
    return `
        <div class="ic-phase-label">${esc(t('ov.icChainPhaseHold'))}</div>
        <div class="ic-chain-list is-rail">${holdSteps.map(s => chainStepRowHtml(s, marks)).join('')}</div>
        <div class="ic-guard-sep"></div>
        <div class="ic-phase-label">${esc(t('ov.icChainPhaseConsume'))}</div>
        <div class="ic-chain-list">${consumeSteps.map(s => chainStepRowHtml(s, marks)).join('')}</div>
    `;
}

// 跨頁 storage 監聽器：每次 render 先解除上一次的，避免已卸離的分區閉包一直留在 window 上。
let listeners: AbortController | null = null;

function mergeRows(base: SortieLogRow[], incoming: SortieLogRow[]): SortieLogRow[] {
    const seen = new Set(base.map(r => r.eventId));
    return [...base, ...incoming.filter(r => !seen.has(r.eventId))];
}

interface ChainSummary {
    steps: readonly SauryStep[];
    total: SauryNeed;
    need: SauryNeed;
    held: number | null;
    done: ReadonlySet<string>;
}

export const itemCatchSection: OverviewSection = {
    id: 'item-catch',
    titleKey: 'ov.dropSubItem',
    async render(el, ctx) {
        listeners?.abort();
        listeners = new AbortController();
        const { signal } = listeners;
        // 先畫殼、綁事件，再讀 IndexedDB；讀取被阻塞時也不留白。
        el.innerHTML = `<div class="ic">
            <div class="ov-toolbar dl-bar ic-bar">
                <label class="rs-inline"><span>${esc(t('ov.icSeason'))}</span><select class="ic-season">${[...CATCH_SEASONS].reverse().map(sn =>
                    `<option value="${esc(sn.id)}">${esc(t('ov.icSeasonOpt', { year: sn.id }))}</option>`).join('')}<option value="">${esc(t('ov.icSeasonAll'))}</option></select></label>
                <label class="rs-inline"><span>${esc(t('ov.icItem'))}</span><select class="ic-item"></select></label>
                <label class="rs-inline dl-date"><span>${esc(t('ov.buildFilterTime'))}</span><input type="date" class="ic-from" aria-label="${esc(t('ov.buildFilterFrom'))}"><span>–</span><input type="date" class="ic-to" aria-label="${esc(t('ov.buildFilterTo'))}"></label>
                <span class="ic-bar-spacer"></span>
                <details class="ic-settings">
                    <summary class="ov-btn ic-settings-btn">⚙ ${esc(t('ov.icSettings'))} <span class="ic-settings-badge"></span></summary>
                    <div class="ic-settings-panel">
                        <div class="ic-set-block">
                            <span class="ic-set-title">${esc(t('ov.icSettingsAlertTitle'))}</span>
                            <label class="rs-inline"><input type="checkbox" class="ic-alert-on"><span class="ic-alert-label"></span></label>
                            <div class="ic-alert-fields">
                                <label class="rs-inline"><span>${esc(t('ov.icAlertHours'))}</span><input type="number" class="rs-search ic-alert-num ic-alert-hours" min="1" max="168" step="1" inputmode="numeric"></label>
                                <label class="rs-inline"><span>${esc(t('ov.icAlertCount'))}</span><input type="number" class="rs-search ic-alert-num ic-alert-count" min="1" max="999" step="1" inputmode="numeric"></label>
                            </div>
                            <p class="ov-note ic-alert-invalid" hidden>${esc(t('ov.icAlertInvalid'))}</p>
                            <p class="ov-note dim">${esc(t('ov.icAlertNote'))}</p>
                        </div>
                        <div class="ic-set-block">
                            <span class="ic-set-title">${esc(t('ov.icSettingsPanelTitle'))}</span>
                            <p class="ic-dc"><label class="rs-inline" title="${esc(t('ov.icDcTip'))}"><input type="checkbox" class="ic-dc-on"><span>${esc(t('ov.icDc'))}</span></label><span class="ic-dc-state"></span></p>
                            <div class="ic-end-row" hidden>
                                <label class="rs-inline" title="${esc(t('ov.icEndTip'))}"><span>${esc(t('ov.icEnd'))}</span><input type="datetime-local" class="rs-search ic-end-input"></label>
                                <button type="button" class="ov-btn ic-end-clear" hidden>${esc(t('ov.icEndClear'))}</button>
                                <span class="ic-end-note"></span>
                            </div>
                        </div>
                        <div class="ic-set-foot ic-clear-row" hidden>
                            <button type="button" class="ov-btn ic-clear" title="${esc(t('ov.icClearTip'))}"></button>
                        </div>
                    </div>
                </details>
            </div>
            <p class="ov-note ic-excluded" hidden></p>
            <div class="ic-hero" aria-live="polite"></div>
            <div class="ic-split">
                <div class="ic-grounds-pane">
                    <div class="ic-pane-head">
                        <h3 class="ic-pane-title">${esc(t('ov.icGroundsTitle'))}</h3>
                        <div class="ic-pane-controls">
                            <div class="ic-sort" role="group" aria-label="${esc(t('ov.icGroundsTitle'))}">
                                <button type="button" data-sort="area" aria-pressed="true">${esc(t('ov.icSortArea'))}</button>
                                <button type="button" data-sort="recent" aria-pressed="false">${esc(t('ov.icSortRecent'))}</button>
                                <button type="button" data-sort="dry" aria-pressed="false">${esc(t('ov.icSortDry'))}</button>
                            </div>
                            <button type="button" class="ov-btn ic-mini-btn ic-toggle-all" hidden>${esc(t('ov.icExpandAll'))}</button>
                        </div>
                    </div>
                    <div class="ic-body"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
                    <div class="ic-candidates" hidden></div>
                    <p class="ov-note dim ic-foot-note">${esc(t('ov.icNote'))}</p>
                </div>
                <aside class="ic-chain-pane" hidden>
                    <div class="ic-pane-head">
                        <h3 class="ic-pane-title">${esc(t('ov.icChain'))} <span class="ic-chain-total"></span></h3>
                        <span class="ic-chain-prog"></span>
                    </div>
                    <div class="ic-chain-body"></div>
                    <p class="ov-note dim ic-chain-foot">${esc(t('ov.icChainFoot'))}</p>
                    <details class="ic-chain-rule">
                        <summary>${esc(t('ov.icChainRuleBtn'))}</summary>
                        <p class="ov-note dim ic-chain-note"></p>
                    </details>
                </aside>
            </div>
        </div>`;

        const itemSel = el.querySelector<HTMLSelectElement>('.ic-item')!;
        const fromInput = el.querySelector<HTMLInputElement>('.ic-from')!;
        const toInput = el.querySelector<HTMLInputElement>('.ic-to')!;
        const settingsDetails = el.querySelector<HTMLDetailsElement>('.ic-settings')!;
        const settingsBadge = el.querySelector<HTMLElement>('.ic-settings-badge')!;
        const excluded = el.querySelector<HTMLElement>('.ic-excluded')!;
        const hero = el.querySelector<HTMLElement>('.ic-hero')!;
        const split = el.querySelector<HTMLElement>('.ic-split')!;
        const groundsPane = el.querySelector<HTMLElement>('.ic-grounds-pane')!;
        const sortBtns = [...el.querySelectorAll<HTMLButtonElement>('.ic-sort button[data-sort]')];
        const toggleAllBtn = el.querySelector<HTMLButtonElement>('.ic-toggle-all')!;
        const body = el.querySelector<HTMLElement>('.ic-body')!;
        const candidates = el.querySelector<HTMLElement>('.ic-candidates')!;
        const footNote = el.querySelector<HTMLElement>('.ic-foot-note')!;
        const alertOn = el.querySelector<HTMLInputElement>('.ic-alert-on')!;
        const alertHours = el.querySelector<HTMLInputElement>('.ic-alert-hours')!;
        const alertCount = el.querySelector<HTMLInputElement>('.ic-alert-count')!;
        const alertLabel = el.querySelector<HTMLElement>('.ic-alert-label')!;
        const alertInvalid = el.querySelector<HTMLElement>('.ic-alert-invalid')!;
        const seasonSel = el.querySelector<HTMLSelectElement>('.ic-season')!;
        const endRow = el.querySelector<HTMLElement>('.ic-end-row')!;
        const endInput = el.querySelector<HTMLInputElement>('.ic-end-input')!;
        const endClear = el.querySelector<HTMLButtonElement>('.ic-end-clear')!;
        const endNote = el.querySelector<HTMLElement>('.ic-end-note')!;
        const clearRow = el.querySelector<HTMLElement>('.ic-clear-row')!;
        const clearBtn = el.querySelector<HTMLButtonElement>('.ic-clear')!;
        const dcOn = el.querySelector<HTMLInputElement>('.ic-dc-on')!;
        const dcState = el.querySelector<HTMLElement>('.ic-dc-state')!;
        const chainPane = el.querySelector<HTMLElement>('.ic-chain-pane')!;
        const chainBody = el.querySelector<HTMLElement>('.ic-chain-body')!;
        const chainTotal = el.querySelector<HTMLElement>('.ic-chain-total')!;
        const chainProg = el.querySelector<HTMLElement>('.ic-chain-prog')!;
        const chainNote = el.querySelector<HTMLElement>('.ic-chain-note')!;

        // 總括開著未收到遊戲封包、或切回分頁時，每分鐘只更新經過時間文字節點。
        const refreshElapsed = () => {
            if (!el.isConnected) return;
            const now = Date.now();
            for (const span of body.querySelectorAll<HTMLElement>('.ic-ago[data-battle-ts]')) {
                const ts = Number(span.dataset.battleTs);
                if (Number.isFinite(ts)) span.textContent = elapsedLabel(ts, now);
            }
        };
        const elapsedInterval = setInterval(refreshElapsed, 60_000);
        signal.addEventListener('abort', () => clearInterval(elapsedInterval), { once: true });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refreshElapsed();
        }, { signal });

        // §4.4b：點設定浮層外面或 Esc 時自動收起。
        document.addEventListener('click', event => {
            if (!settingsDetails.open) return;
            if (!(event.target as HTMLElement).closest('.ic-settings')) settingsDetails.open = false;
        }, { signal });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && settingsDetails.open) settingsDetails.open = false;
        }, { signal });

        let itemId = DEFAULT_CATCH_ITEM;
        let rows: SortieLogRow[] = [];
        let loaded = false;
        let query = 0;
        let sortMode: GroundSort = 'area';
        let didAutoExpand = false;
        const itemName = (id: number) => useItemDisplayName(id, getLang(), ctx.state.useItemName(id));

        // 自訂換海域提醒（utils/catch-alert.ts；通知由面板在結算後發）。控制項只在載入時填一次，
        // 之後只寫回設定，不因重畫覆蓋玩家正在輸入的值。沒有預設門檻：欄位留空要玩家自己填。
        let alertRule = loadCatchAlertRule();
        if (alertRule) {
            alertOn.checked = alertRule.enabled;
            alertHours.value = String(alertRule.hours);
            alertCount.value = String(alertRule.count);
        }

        const drawSettingsBadge = () => {
            const dcWord = dcOn.checked ? t('ov.icOn') : t('ov.icOff');
            settingsBadge.textContent = alertRule?.enabled
                ? t('ov.icSettingsBadgeOn', { hours: alertRule.hours, n: alertRule.count, dc: dcWord })
                : t('ov.icSettingsBadgeOff', { dc: dcWord });
        };

        // 爆雷提醒開關（utils/depth-charge.ts）：預設打開，面板點掉時這裡同步顯示關閉。
        const drawDc = () => {
            const off = loadDcReminderOff(latestSeason().start);
            dcOn.checked = !off;
            dcState.textContent = off?.from === 'panel' ? t('ov.icDcOffPanel') : '';
            drawSettingsBadge();
        };
        drawDc();
        dcOn.addEventListener('change', () => { saveDcReminder(dcOn.checked, latestSeason().start, 'overview'); drawDc(); });
        onDcReminderChange(() => { if (el.isConnected) drawDc(); }, signal);

        const drawAlertLabel = () => {
            const item = itemName(alertRule?.enabled ? alertRule.itemId : itemId);
            alertLabel.textContent = t('ov.icAlertEnable', { item });
            drawSettingsBadge();
        };
        const saveAlert = (event: Event) => {
            const hours = Number(alertHours.value), count = Number(alertCount.value);
            const valid = isValidAlertNumber(hours, 'hours') && isValidAlertNumber(count, 'count');
            alertInvalid.hidden = valid || !alertOn.checked;
            if (valid) {
                // 與標籤一致：已啟用時改數值沿用原本的道具；勾選開關才換成目前選的道具。
                const target = alertRule?.enabled && event.target !== alertOn ? alertRule.itemId : itemId;
                alertRule = { enabled: alertOn.checked, itemId: target, hours, count };
                saveCatchAlertRule(alertRule);
            } else if (alertRule?.enabled) {
                alertRule = { ...alertRule, enabled: false };
                saveCatchAlertRule(alertRule);
            }
            drawAlertLabel();
            draw();
        };
        [alertOn, alertHours, alertCount].forEach(input => input.addEventListener('change', saveAlert));

        // 開關打開時，排除海域的結算仍以 catchOnly 列寫入（見 utils/sortie-exclude.ts），提示改放表底且用淡字。
        const drawExcluded = () => {
            const maps = loadExcludedMaps();
            const catchOn = loadExcludeCatch();
            const key = catchOn ? 'ov.icExcludedCatch' : 'ov.icExcluded';
            excluded.hidden = !maps.length;
            excluded.classList.toggle('dim', catchOn);
            excluded.classList.toggle('ic-excluded-warn', !catchOn);
            if (catchOn) footNote.before(excluded);
            else hero.before(excluded);
            const mapSep = getLang() === 'en' ? ', ' : '、';
            excluded.innerHTML = maps.length
                ? `${esc(t(key, { maps: maps.join(mapSep) }))} <a href="#/sortie-log">${esc(t('ov.icExcludedLink'))}</a>` : '';
        };
        drawExcluded();
        const onExcludeChange = () => {
            if (!el.isConnected) return;
            drawExcluded();
            if (loaded) draw();
        };
        onExcludedMapsChange(onExcludeChange, signal);
        onExcludeCatchChange(onExcludeChange, signal);

        // 選項集合沒變就不動下拉（使用者可能正開著它）。
        let itemKey = '';
        const drawItems = () => {
            const { from, to } = period();
            const ids = new Set([DEFAULT_CATCH_ITEM, itemId]);
            for (const row of rows) {
                if (!isCatchRow(row) || (from !== null && row.ts < from) || (to !== null && row.ts > to)) continue;
                for (const id of row.useItemDrops ?? []) ids.add(id);
            }
            const sorted = [...ids].sort((a, b) => a - b);
            if (sorted.join() === itemKey) return;
            itemKey = sorted.join();
            itemSel.innerHTML = sorted.map(id =>
                `<option value="${id}"${id === itemId ? ' selected' : ''}>${esc(itemName(id))}</option>`).join('');
        };

        // 提醒進度與徽章只看「現在」：歷史檢視（選了截止日）或載入範圍晚於時窗起點時不標。
        const windowHitsMap = (to: number | null, now: number): ReadonlyMap<number, number> | null => {
            if (!alertRule?.enabled || alertRule.itemId !== itemId || (to !== null && to < now)) return null;
            const loadedFrom = dateStart(fromInput.value);
            if (loadedFrom !== null && loadedFrom > now - alertRule.hours * 3_600_000) return null;
            return catchesInWindow(rows, alertRule, now);
        };

        // 季別（utils/catch-season.ts）：期間 = 所選季與日期篩選的交集；「全部期間」只看日期篩選。
        const selectedSeason = (): CatchSeason | null => CATCH_SEASONS.find(sn => sn.id === seasonSel.value) ?? null;
        // 結束時刻：官方（新版內建）→ 玩家自填（日本時間）→ 回收推算（只給範圍）→ 下一季開始。
        const seasonRangeHtml = (season: CatchSeason, sameYear: boolean) => {
            const inferred = loadInferredEnd(season.id);
            const range = currentSeasonRange(season);
            const fmtR = (ts: number) => sameYear ? fmtShortTs(ts) : fmtTs(ts);
            const endText = range.end === null ? esc(t('ov.icSeasonOngoing'))
                : range.endKind === 'inferred' && inferred
                    ? `<span class="ic-est" title="${esc(t('ov.icSeasonInferredTip'))}">${esc(t('ov.icSeasonInferred', { after: fmtR(inferred.after), before: fmtR(inferred.before) }))}</span>`
                    : range.endKind === 'user' ? esc(t('ov.icSeasonUser', { t: fmtR(range.end) }))
                        : esc(fmtR(range.end));
            return { range, html: `<span title="${esc(t('ov.icSeasonRangeTip'))}">${esc(fmtR(range.start))} – ${endText}</span>` };
        };
        // 統計期間 = 所選季與日期篩選的交集。
        const period = (): { from: number | null; to: number | null } => {
            const season = selectedSeason();
            const range = season ? currentSeasonRange(season) : null;
            const dFrom = dateStart(fromInput.value), dTo = dateEnd(toInput.value);
            const from = range ? Math.max(dFrom ?? -Infinity, range.start) : dFrom;
            const toMin = Math.min(dTo ?? Infinity, range?.end ?? Infinity);
            return { from, to: Number.isFinite(toMin) ? toMin : null };
        };
        // 自填欄位：官方結束已內建或選「全部期間」時不顯示。正在輸入時不覆寫欄位值。
        const drawEnd = (season: CatchSeason | null) => {
            endRow.hidden = !season || season.end !== null;
            if (!season || season.end !== null) return;
            const user = loadUserEnd(season.id);
            if (document.activeElement !== endInput) endInput.value = user === null ? '' : tsToJstInput(user);
            endClear.hidden = user === null;
            const inferred = loadInferredEnd(season.id);
            endNote.textContent = user === null && inferred ? t('ov.icEndInferredNote') : '';
        };
        endInput.addEventListener('change', () => {
            const season = selectedSeason();
            const ts = jstInputToTs(endInput.value);
            if (!season || (endInput.value && ts === null)) return;
            if (ts !== null && ts < season.start) {
                const user = loadUserEnd(season.id);
                endInput.value = user === null ? '' : tsToJstInput(user);
                return;
            }
            saveUserEnd(season.id, ts);
            draw();
        });
        endClear.addEventListener('click', () => {
            const season = selectedSeason();
            if (!season) return;
            saveUserEnd(season.id, null);
            endInput.value = '';
            draw();
        });
        onSeasonEndChange(() => { if (el.isConnected && loaded) draw(); }, signal);

        // 任務鏈：只在看某一季的秋刀魚、且該季有任務資料時顯示。
        let chainSeason = '';
        const drawChain = (season: CatchSeason | null): ChainSummary | null => {
            const steps = season && itemId === SAURY_ITEM ? SAURY_CHAINS[season.id] : undefined;
            chainPane.hidden = !steps;
            split.classList.toggle('is-single', !steps);
            if (!season || !steps) return null;
            const rawMarks = loadSauryMarks(season.id);
            if (chainSeason !== season.id) {
                chainSeason = season.id;
                chainBody.innerHTML = chainBodyHtml(steps, rawMarks);
            }
            const model = buildQuestFlow(ctx.state, new Set(readQuestFlowBackupPrefs().manualComplete));
            const done = new Set<string>();
            const held = ctx.state.useItemCount(SAURY_ITEM);
            let doneSteps = 0;

            for (const s of steps) {
                const rowEl = chainBody.querySelector<HTMLElement>(`[data-chain-step="${s.id}"]`);
                if (!rowEl) continue;
                const iconEl = rowEl.querySelector<HTMLElement>('.ic-step-icon');
                const metEl = rowEl.querySelector<HTMLElement>('.ic-met-tag');
                const remEl = rowEl.querySelector<HTMLElement>('.ic-step-rem');
                const checksEl = rowEl.querySelector<HTMLElement>('.ic-step-checks');

                const st: ChainState = s.quest === undefined ? 'open' : chainState(model, s.quest, season.start);
                const isDone = st === 'done';
                if (isDone) done.add(s.id);

                const checkedN = Math.min(s.times, Math.max(0, Math.floor(rawMarks[s.id] ?? 0)));
                const isSkipped = !isDone && (s.kind === 'consume' || s.kind === 'exchange') && checkedN >= s.times;
                if (isDone || isSkipped) doneSteps++;

                const isFocus = !isDone && (st === 'claim' || st === 'active' || st === 'open') && s.quest !== undefined;
                rowEl.classList.toggle('is-done', isDone);
                rowEl.classList.toggle('is-focus', isFocus);
                rowEl.classList.toggle('is-skipped', isSkipped);
                if (iconEl) {
                    iconEl.textContent = isDone ? '✓' : st === 'claim' ? '★' : isFocus ? '●' : '·';
                    iconEl.title = t(CHAIN_STATE_KEY[st]);
                }
                if (metEl) metEl.hidden = !(s.kind === 'hold' && !isDone && held !== null && held >= s.fish);
                if (remEl) {
                    const rem = s.fish * Math.max(0, s.times - checkedN);
                    remEl.textContent = rem > 0 ? ` (${t('ov.icChainRem', { n: rem })})` : '';
                }
                if (checksEl) checksEl.hidden = isDone;
            }

            // 已完成的任務若曾被勾「不計入」，勾選不再有意義；只算還沒做的部分。
            const marks = Object.fromEntries(Object.entries(rawMarks).filter(([id]) => !done.has(id)));
            const total = sauryNeed(steps, new Set(), {}, null);
            const need = sauryNeed(steps, done, marks, held);
            chainTotal.textContent = t('ov.icChainTotal', { n: num(total.need) });
            chainProg.textContent = `${doneSteps} / ${steps.length}`;
            const sep = chainBody.querySelector<HTMLElement>('.ic-guard-sep');
            if (sep) {
                sep.classList.toggle('is-ok', need.hold === 0);
                sep.textContent = need.hold > 0
                    ? t('ov.icChainGuardSepWarn', { n: need.hold })
                    : t('ov.icChainGuardSepOk');
            }
            chainNote.textContent = t('ov.icChainNote', { total: total.need, hold: total.hold, consume: total.consume });
            return { steps, total, need, held, done };
        };
        chainBody.addEventListener('change', event => {
            const box = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-chain-mark]');
            const season = selectedSeason();
            if (!box || !season) return;
            const id = box.dataset.chainMark!;
            const n = chainBody.querySelectorAll(`input[data-chain-mark="${id}"]:checked`).length;
            saveSauryMarks(season.id, { ...loadSauryMarks(season.id), [id]: n });
            draw();
        });
        // 任務名稱的譯文非同步載入；到齊後重畫步驟骨架（勾選由存檔還原）。尚未讀完 DB 時只重畫任務鏈，不覆寫載入中或錯誤訊息。
        void loadQuestCatalogLocale(getLang()).then(() => {
            if (!el.isConnected) return;
            chainSeason = '';
            if (loaded) draw();
            else drawChain(selectedSeason());
        }).catch(() => { /* 譯文載不到就維持日文原名 */ });

        const drawHero = (
            chainInfo: ChainSummary | null,
            stats: ReturnType<typeof itemCatchStats>,
            scHtml: string | null,
            sameYear: boolean,
        ) => {
            const held = chainInfo ? chainInfo.held : ctx.state.useItemCount(itemId);
            const obsText = stats.observedFrom === null ? none
                : `${esc(sameYear ? fmtShortTs(stats.observedFrom) : fmtTs(stats.observedFrom))} – ${esc(sameYear ? fmtShortTs(stats.observedTo!) : fmtTs(stats.observedTo!))}`;

            if (!chainInfo) {
                const chip = (label: string, value: string, tip?: string) =>
                    `<span class="ic-chip"${tip ? ` title="${esc(tip)}"` : ''}><span class="ic-chip-label">${esc(label)}</span>${value}</span>`;
                hero.innerHTML = `<div class="ic-summary">${[
                    chip(t('ov.icCaught'), `<b>${num(stats.caught)}</b>`, t('ov.icCaughtTip')),
                    scHtml ? chip(t('ov.icSeasonRange'), scHtml, t('ov.icSeasonRangeTip')) : '',
                    chip(t('ov.icHeld'), held === null ? esc(t('ov.dropUnknown')) : `<b>${num(held)}</b>`),
                    chip(t('ov.icObserved'), obsText),
                    stats.firstCatchTs === null ? '' : chip(t('ov.icFirstCatch'), esc(sameYear ? fmtShortTs(stats.firstCatchTs) : fmtTs(stats.firstCatchTs))),
                    stats.unknown ? chip(t('ov.icColUnknown'), num(stats.unknown), t('ov.icColUnknownTip')) : '',
                ].join('')}</div>`;
                return;
            }

            const { need, total, steps, done } = chainInfo;
            const stillUnit = t('ov.icHeroStillNeedUnit');
            const kpiHtml = need.toCatch === null
                ? `<span class="ic-kpi-label">${esc(t('ov.icHeroStillNeedPre'))}</span><span class="ic-kpi-num is-unknown">${num(need.need)}</span>${stillUnit ? `<span class="ic-kpi-label">${esc(stillUnit)}</span>` : ''}`
                : need.toCatch === 0
                    ? `<span class="ic-kpi-num is-done">${esc(t('ov.icHeroEnough'))}</span>`
                    : `<span class="ic-kpi-label">${esc(t('ov.icHeroToCatchPre'))}</span><span class="ic-kpi-num">${num(need.toCatch)}</span><span class="ic-kpi-label">${esc(t('ov.icHeroToCatchUnit'))}</span>`;
            const heldFact = held === null
                ? `<span><span class="ic-fact-label">${esc(t('ov.icHeld'))}</span><b>${esc(t('ov.dropUnknown'))}</b></span>`
                : `<span><span class="ic-fact-label">${esc(t('ov.icHeld'))}</span><b>${num(held)}</b> ／ <span class="ic-fact-label">${esc(t('ov.icHeroNeed'))}</span><b>${num(need.need)}</b></span>`;

            const holdSteps = steps.filter(s => s.kind === 'hold');
            const scale = Math.max(need.need, total.hold, 1);
            const fillPct = held === null ? 0 : need.need === 0 ? 100 : Math.min(100, Math.round((held / scale) * 100));
            const ticks = holdSteps.map(s => {
                const pct = Math.min(99, Math.round((s.fish / scale) * 100));
                const isDone = done.has(s.id);
                const cls = isDone ? 'is-done' : 'is-active';
                const edgeCls = pct > 90 ? ' is-edge-right' : '';
                return { fish: s.fish, pct, cls, edgeCls };
            });

            hero.innerHTML = `
                <div class="ic-hero-top">
                    <div class="ic-hero-main">
                        <span class="ic-kpi">${kpiHtml}</span>
                        <span class="ic-hero-facts">
                            ${heldFact}
                            <span title="${esc(t('ov.icCaughtTip'))}"><span class="ic-fact-label">${esc(t('ov.icCaught'))}</span><b>${num(stats.caught)}</b></span>
                            ${stats.unknown ? `<span title="${esc(t('ov.icColUnknownTip'))}"><span class="ic-fact-label">${esc(t('ov.icColUnknown'))}</span>${num(stats.unknown)}</span>` : ''}
                        </span>
                    </div>
                    <div class="ic-hero-meta">${scHtml ? `<span>${scHtml}</span>` : ''}<span>${esc(t('ov.icObserved'))} ${obsText}</span></div>
                </div>
                <div class="ic-progress">
                    <div class="ic-track${held === null ? ' is-unknown' : ''}">
                        <div class="ic-fill" style="width:${fillPct}%"></div>
                        ${ticks.map(tk => `<span class="ic-tick ${tk.cls}" style="left:${tk.pct}%"></span>`).join('')}
                    </div>
                    <div class="ic-ticks-labels">
                        ${ticks.map(tk => `<span class="ic-tick-lbl ${tk.cls}${tk.edgeCls}" style="left:${tk.pct}%">${esc(t('ov.icTickHold', { n: tk.fish }))}</span>`).join('')}
                    </div>
                </div>`;
        };

        const drawCandidates = (likely: Record<string, CatchGroundScope> | undefined, areas: readonly AreaCatchStat[]) => {
            const entries = Object.entries(likely ?? {});
            candidates.hidden = !entries.length;
            if (!entries.length) { candidates.innerHTML = ''; return; }
            const visited = new Set(areas.flatMap(a => a.maps.map(m => m.map)));
            const nodeSep = getLang() === 'en' ? ', ' : '・';
            const mapSep = getLang() === 'en' ? ', ' : '、';
            const formatScope = (scope: CatchGroundScope): string => {
                if (scope === 'all') return '';
                if (scope === 'boss') return t('ov.icGroundBossWord');
                return (scope.boss ? [...scope.nodes, t('ov.icGroundBossWord')] : [...scope.nodes]).join(nodeSep);
            };
            const formatGround = (map: string, scope: CatchGroundScope): string => {
                const detail = formatScope(scope);
                return detail ? t('ov.icGroundNodes', { map, nodes: detail }) : map;
            };
            const excludedSet = loadExcludeCatch() ? new Set<string>() : new Set(loadExcludedMaps());
            const unvisited = entries.filter(([map]) => !visited.has(map) && !excludedSet.has(map));
            const pillsHtml = unvisited.length
                ? `<div class="ic-cand-head"><span class="ic-cand-label">${esc(t('ov.icCandTitle'))}</span>${unvisited.map(([map, scope]) =>
                    `<span class="ic-cand-pill" title="${esc(formatGround(map, scope))}">${esc(map)}</span>`).join('')}</div>`
                : '';
            const allText = entries.map(([map, scope]) => `<span class="ic-nowrap">${esc(formatGround(map, scope))}</span>`).join(mapSep);
            candidates.innerHTML = `${pillsHtml}<details class="ic-cand-all"><summary>${esc(t('ov.icCandAllSummary', { n: entries.length }))}</summary><p class="ic-cand-list">${allText}</p></details>`;
        };

        const draw = () => {
            const now = Date.now();
            const thisYear = new Date(now).getFullYear();
            const season = selectedSeason();
            const { from, to } = period();
            const sameYear = (from === null || new Date(from).getFullYear() === thisYear)
                && (to === null || new Date(to).getFullYear() === thisYear);
            const sc = season ? seasonRangeHtml(season, sameYear) : null;
            drawEnd(season);
            const chainInfo = drawChain(season);
            // 參考漁場範圍只套在所選季的秋刀魚；其他道具或「全部期間」不限。
            const likely = itemId === SAURY_ITEM ? season?.likelyGrounds : undefined;
            drawItems();
            void drawClear(season, sc?.range ?? null);
            const stats = itemCatchStats(rows, { itemId, from, to, now, grounds: likely });
            drawHero(chainInfo, stats, sc?.html ?? null, sameYear);
            drawCandidates(likely, stats.areas);

            sortBtns.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.sort === sortMode)));
            toggleAllBtn.hidden = !stats.areas.length;

            if (!stats.areas.length) {
                body.innerHTML = `<div class="ov-empty">${esc(t('ov.icNone'))}</div>`;
                return;
            }
            const open = new Set([...body.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.key!));
            if (!didAutoExpand && loaded) {
                didAutoExpand = true;
                if (!open.size) {
                    const topRecent = [...stats.areas]
                        .sort((a, b) => (b.lastBattleTs ?? 0) - (a.lastBattleTs ?? 0))
                        .slice(0, 2);
                    for (const a of topRecent) open.add(`a${a.area}`);
                }
            }
            const allAreasOpen = stats.areas.every(a => open.has(`a${a.area}`));
            toggleAllBtn.textContent = allAreasOpen ? t('ov.icCollapseAll') : t('ov.icExpandAll');

            const wMap = windowHitsMap(to, now);
            const hits: AlertHits = wMap
                ? new Map([...wMap].filter(([, n]) => n >= alertRule!.count))
                : new Map();
            const historical = to !== null && to < now;
            body.innerHTML = (stats.caught ? '' : `<p class="ov-note dim">${esc(t('ov.icNoCatch', { item: itemName(itemId) }))}</p>`)
                + statsHtml(stats.areas, ctx, open, new Set(rows.filter(r => !r.catchOnly).map(r => r.ts)), hits, wMap, alertRule, sortMode, now, historical, sameYear);
        };

        for (const btn of sortBtns) {
            btn.addEventListener('click', () => {
                sortMode = (btn.dataset.sort as GroundSort) || 'area';
                draw();
            });
        }
        toggleAllBtn.addEventListener('click', () => {
            const areas = [...body.querySelectorAll<HTMLDetailsElement>('details.ic-area')];
            const shouldOpen = !areas.every(d => d.open);
            for (const d of areas) d.open = shouldOpen;
            toggleAllBtn.textContent = shouldOpen ? t('ov.icCollapseAll') : t('ov.icExpandAll');
        });
        body.addEventListener('toggle', event => {
            if (!(event.target as HTMLElement).classList.contains('ic-area')) return;
            const areas = [...body.querySelectorAll<HTMLDetailsElement>('details.ic-area')];
            if (areas.length) toggleAllBtn.textContent = areas.every(d => d.open) ? t('ov.icCollapseAll') : t('ov.icExpandAll');
        }, true);

        // 清除該季的捕撈專用紀錄：只刪 catchOnly 列（不記錄海域為統計另寫的列），一般出擊紀錄不動。
        // 由玩家自己按、確認後才刪；與出擊紀錄刪除重播同屬使用者主動刪除，不經投影。
        let clearToken = 0;
        let clearKeys: number[] = [];
        const catchOnlyKeys = (range: { start: number; end: number | null }) =>
            db.sorties.where('ts').between(range.start, range.end ?? Infinity, true, true)
                .filter(r => r.catchOnly === true).primaryKeys() as Promise<number[]>;
        const drawClear = async (season: CatchSeason | null, range: { start: number; end: number | null } | null) => {
            const token = ++clearToken;
            if (!season || !range) { clearRow.hidden = true; return; }
            try {
                const keys = await catchOnlyKeys(range);
                if (token !== clearToken || !el.isConnected) return;
                clearKeys = keys;
                clearRow.hidden = !keys.length;
                clearBtn.textContent = t('ov.icClear', { season: t('ov.icSeasonOpt', { year: season.id }), n: num(keys.length) });
                clearBtn.dataset.season = season.id;
            } catch {
                if (token === clearToken) clearRow.hidden = true;
            }
        };
        clearBtn.addEventListener('click', async () => {
            const season = selectedSeason();
            if (!season || clearBtn.dataset.season !== season.id || !clearKeys.length) return;
            if (!confirm(t('ov.icClearConfirm', { season: t('ov.icSeasonOpt', { year: season.id }), n: num(clearKeys.length) }))) return;
            // 確認之後依當下期間重算，不刪畫按鈕時的快取（期間可能剛改過）。
            clearBtn.disabled = true;
            try {
                await db.sorties.bulkDelete(await catchOnlyKeys(currentSeasonRange(season)));
            } catch (error) {
                alert(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }));
            } finally {
                clearBtn.disabled = false;
            }
            await load();
        });
        seasonSel.addEventListener('change', () => draw());

        // 期間改變才重讀 DB（ts 索引）；道具切換只重算。
        const load = async () => {
            const token = ++query;
            const from = dateStart(fromInput.value), to = dateEnd(toInput.value);
            try {
                const table = db.sorties;
                const next = from === null && to === null
                    ? await table.toArray()
                    : await table.where('ts').between(from ?? -Infinity, to ?? Infinity, true, true).toArray();
                if (token !== query || !el.isConnected) return;
                rows = next;
                loaded = true;
                draw();
            } catch (error) {
                if (token !== query) return;
                body.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            }
        };

        itemSel.addEventListener('change', () => { itemId = Number(itemSel.value) || DEFAULT_CATCH_ITEM; drawAlertLabel(); draw(); });
        [fromInput, toInput].forEach(input => input.addEventListener('change', () => void load()));

        let timer: ReturnType<typeof setTimeout> | undefined;
        ctx.onStateChange?.(paths => {
            if (!el.isConnected || !loaded) return;
            if (!paths.some(path => HELD_PATHS.has(path))) return;
            if (!paths.some(path => REFRESH_PATHS.has(path))) { draw(); return; }
            clearTimeout(timer);
            timer = setTimeout(async () => {
                if (!el.isConnected) return;
                const token = query;
                const from = dateStart(fromInput.value), to = dateEnd(toInput.value);
                const since = rows.reduce((max, r) => Math.max(max, r.ts), from ?? 0);
                try {
                    const incoming = await db.sorties.where('ts').aboveOrEqual(since).toArray();
                    // 期間查詢在等待中換過就交給那次查詢，不合併舊期間的結果。
                    if (token !== query || !el.isConnected) return;
                    rows = mergeRows(rows, incoming.filter(r => to === null || r.ts <= to));
                } catch {
                    return;   // 讀不到就維持舊畫面，下次通知再試
                }
                draw();
            }, REFRESH_DELAY);
        });

        drawAlertLabel();
        drawItems();
        drawChain(selectedSeason());
        await load();
    },
};
