// 戰果分區（第二期）：目標設定、本月戰果推算（含榜分校準）、榜線紀錄與登錄表單、EO／任務清單、逐月對帳。
// HTML 建構器 renderSenkaSectionBodyHtml（1b 版面）、renderSenkaMonthCardHtml、renderSenkaLogRowsHtml 以純函式匯出，供離線預覽共用。
//
// 重繪守則（design-guidelines §4.2 / §4.2.1）：
// 先同步畫出外殼並綁好所有控制項（釘選 checkbox、目標 select／number input、登錄表單、對帳 select），再非同步查詢 DB。
// 之後的即時更新、每分鐘倒數與譯文到達只覆寫各插槽（#sk-month、#sk-log-body、#sk-eo、對帳列的文字欄位），
// 絕不重建帶使用者輸入的控制項；<details> 展開／收合狀態沿用 isFoldOpen 保留。

import type { OverviewSection, SectionContext } from './types';
import { db } from '@/utils/db';
import type { Lang } from '@/utils/gamedata-i18n';
import { esc } from '@/utils/html-escape';
import {
    loadQuestCatalogLocale, localizedQuestName, questCatalogLocaleLoaded,
} from '@/utils/quest-catalog-localization';
import { questSenkaCatalogEntry } from '@/utils/quest-senka';
import { senkaMonthOf, type RegularSenkaResult, type SenkaMonth } from '@/utils/senka';
import type { SenkaTarget } from '@/utils/senka-calibration';
import { loadSenkaReconMonths, type SenkaReconMonthData } from '@/utils/senka-readings';
import { rankingRoundAt } from '@/utils/senka-ranking';
import { loadSenkaTarget, onSenkaTargetChange, saveSenkaTarget, SENKA_TARGET_RANKS } from '@/utils/senka-prefs';
import {
    deleteManualCutoff, RANKING_API_PATH, saveManualCutoff, saveSenkaMonthFinal, SENKA_FINAL_TIERS,
    isSenkaFinalTier, senkaMonthKey, type SenkaRankingRow,
} from '@/utils/senka-store';
import {
    buildSenkaMonthView, buildSenkaReconRow, formatObservedGainValue, formatObservedSenkaValue,
    formatQuestItemPoints, formatQuestSenkaValue, formatRegularPartValue, formatSenkaBounds,
    formatSenkaInt, formatSenkaIntGap, formatSenkaPartBounds, formatSenkaRank, formatSenkaTimestamp,
    formatSignedSenka, formatSignedSenkaBounds, senkaDeadlineLines,
    type SenkaMonthView, type SenkaObservedSummary, type SenkaReconRow,
} from '@/utils/senka-view';
import { getLang, t, tFor } from '@/utils/ui-i18n';
import { getSenkaHeaderPinned, persistSenkaHeaderPinned, SENKA_HEADER_KEY } from '@/utils/ui-prefs';

const HINT_KEYS: Partial<Record<RegularSenkaResult['status'], string>> = {
    range: 'ov.skReconNote',
    'no-start': 'senka.noStart',
    'no-data': 'senka.noData',
    anomaly: 'senka.anomaly',
};

const REFRESH_PATHS = new Set([
    'api_port/port', 'api_get_member/mapinfo', 'api_req_quest/clearitemget', RANKING_API_PATH,
]);

const FINAL_LABEL_KEYS: Record<string, string> = {
    '': 'ov.skFinalNone',
    top5: 'ov.skFinal5',
    top20: 'ov.skFinal20',
    top100: 'ov.skFinal100',
    top500: 'ov.skFinal500',
    out: 'ov.skFinalOut',
};

const TARGET_LABEL_KEYS: Record<number, string> = {
    5: 'ov.skTarget5', 20: 'ov.skTarget20', 100: 'ov.skTarget100', 500: 'ov.skTarget500',
};

const HALF_DAY_MS = 12 * 3_600_000;
const DEFAULT_ADD_RANK = 500;

function kvRowHtml(label: string, value: string, note = ''): string {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd><dd class="n">${esc(note)}</dd>`;
}

function isFoldOpen(el: Element | null, fallback = true): boolean {
    if (!el) return fallback;
    const openProp = (el as HTMLDetailsElement).open;
    return typeof openProp === 'boolean' ? openProp : el.hasAttribute('open');
}

/**
 * 以 option.selected 設定 select 的選取值（linkedom 的 select.value 沒有 setter）。
 * 只對命中的 option 設 true：單選時它會取消其他選項，對其餘 option 設 false 在 linkedom 會誤取消命中項。
 */
function setSelectValue(select: HTMLSelectElement, value: string) {
    const hit = Array.from(select.options).find(opt => opt.value === value);
    if (hit) hit.selected = true;
}

function isFocused(el: Element): boolean {
    return typeof document !== 'undefined' && document.activeElement === el;
}

/** 自訂目標輸入框的有效值：非負安全整數字串，否則 null。 */
function parseCustomScore(raw: string): number | null {
    const text = raw.trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : null;
}

/** 目標對應的 select 值：不設目標 ''、名次 '5'…、自訂 'custom'。 */
function targetSelectValue(target: SenkaTarget | null, customPending: boolean): string {
    if (customPending) return 'custom';
    if (!target) return '';
    return target.type === 'rank' ? String(target.rank) : 'custom';
}

/** 主卡片內容：1b 摘要；帶入 view 時改為榜分校準版本並附目標差額。 */
function monthCardInnerHtml(
    summary: SenkaObservedSummary,
    lang: Lang,
    view: SenkaMonthView | null,
    customPending: boolean,
): string {
    const { regular, eo, quest } = summary;
    const calibrated = view && view.calibration.status === 'calibrated' ? view.calibration : null;
    const totalVal = formatObservedSenkaValue(summary, lang);
    const hasTotal = regular.status === 'exact' || regular.status === 'range';
    const hintKey = HINT_KEYS[regular.status];
    let hintHtml = hintKey ? `<p class="sk-hint">${esc(tFor(lang, hintKey))}</p>` : '';
    if (calibrated && (calibrated.reasons.includes('baseline-drift') || calibrated.reasons.includes('inconsistent-baseline'))) {
        hintHtml += `<p class="sk-hint">${esc(tFor(lang, 'senka.driftNote'))}</p>`;
    }

    const totalHtml = calibrated
        ? `<span class="sk-tl">${esc(tFor(lang, 'senka.estimate'))}</span>`
            + `<span class="sk-tv">${esc(formatSenkaBounds(calibrated.estimate, lang))}</span>`
        : `<span class="sk-tl">${esc(tFor(lang, 'ov.skObserved'))}</span>`
            + `<span class="sk-tv">${esc(totalVal)}${hasTotal ? ` <small>${esc(tFor(lang, 'ov.skExclCarry'))}</small>` : ''}</span>`;

    const carryRow = calibrated && calibrated.carry
        ? kvRowHtml(
            tFor(lang, 'ov.skPartCarry'),
            formatSenkaPartBounds(calibrated.carry, lang),
            calibrated.calibratedAt === null
                ? ''
                : tFor(lang, 'ov.skCalibrated', { t: formatSenkaTimestamp(calibrated.calibratedAt) }),
        )
        : kvRowHtml(tFor(lang, 'ov.skPartCarry'), '—');
    const compHtml = `<dl class="sk-kv sk-sep">`
        + carryRow
        + kvRowHtml(tFor(lang, 'senka.partRegular'), formatRegularPartValue(regular, lang))
        + kvRowHtml(tFor(lang, 'senka.partEo'), formatSenkaInt(eo.total, lang))
        + kvRowHtml(tFor(lang, 'senka.partQuest'), formatQuestSenkaValue(quest, lang))
        + `</dl>`;

    const gainRows: string[] = [];
    if (regular.status === 'exact' || regular.status === 'range') {
        const todayVal = summary.today === null ? '—' : formatSignedSenka(summary.today, lang);
        gainRows.push(kvRowHtml(tFor(lang, 'senka.today'), todayVal));
    } else if (regular.status === 'no-start') {
        gainRows.push(kvRowHtml(tFor(lang, 'senka.observed'), formatObservedGainValue(summary, lang)));
        if (summary.today !== null) {
            gainRows.push(kvRowHtml(tFor(lang, 'senka.today'), formatSignedSenka(summary.today, lang)));
        }
    }
    if (calibrated) {
        gainRows.push(kvRowHtml(
            tFor(lang, 'senka.since'),
            formatSignedSenkaBounds(calibrated.sinceTally, lang),
            tFor(lang, 'ov.skPublished', { t: formatSenkaTimestamp(calibrated.latestRound.publishedAt) }),
        ));
    }
    const gainHtml = gainRows.length ? `<dl class="sk-kv sk-sep">${gainRows.join('')}</dl>` : '';

    const targetHtml = view ? targetDlHtml(view, lang, customPending) : '';

    const closesHtml = senkaDeadlineLines(summary.deadlines, lang, { includeQuest: true })
        .map(line => `<span>${esc(line)}</span>`)
        .join('');

    return `<h3>${esc(tFor(lang, `senka.month${summary.month.month}`))}</h3>`
        + `<div class="sk-total">${totalHtml}</div>`
        + compHtml
        + hintHtml
        + gainHtml
        + targetHtml
        + `<div class="sk-sep sk-closes">${closesHtml}</div>`;
}

/** 目標差額 dl；沒有目標且非「自訂、分數未定」時整塊不出現。 */
function targetDlHtml(view: SenkaMonthView, lang: Lang, customPending: boolean): string {
    const result = view.targetResult;
    const rows: string[] = [];
    if (result?.type === 'rank') {
        const name = tFor(lang, 'ov.skCutoffName', { n: formatSenkaRank(result.rank, lang) });
        const cutoff = result.cutoff;
        if (cutoff) {
            const time = formatSenkaTimestamp(cutoff.publishedAt);
            rows.push(kvRowHtml(
                name,
                formatSenkaInt(cutoff.score, lang),
                cutoff.isFinalRound
                    ? `${tFor(lang, 'senka.finalPublished')} ${time}`
                    : tFor(lang, 'ov.skPublished', { t: time }),
            ));
            if (result.gapAtPublication !== null) {
                rows.push(kvRowHtml(tFor(lang, 'senka.gap'), formatSenkaIntGap(result.gapAtPublication, lang)));
            }
            rows.push(kvRowHtml(
                tFor(lang, 'ov.skToCutoff'),
                result.gapToTarget ? formatSignedSenkaBounds(result.gapToTarget, lang) : '—',
            ));
        } else {
            rows.push(kvRowHtml(name, '—', tFor(lang, 'ov.skNoCutoff')));
        }
    } else if (result?.type === 'custom') {
        rows.push(kvRowHtml(
            tFor(lang, 'ov.skToCustom'),
            result.gapToTarget ? formatSignedSenkaBounds(result.gapToTarget, lang) : '—',
            result.targetScore === null ? '—' : formatSenkaInt(result.targetScore, lang),
        ));
    } else if (customPending) {
        rows.push(kvRowHtml(tFor(lang, 'ov.skToCustom'), '—', '—'));
    }
    return rows.length ? `<dl class="sk-kv sk-sep">${rows.join('')}</dl>` : '';
}

/** EO 與任務卡片內容（含兩個 <details>，展開狀態由呼叫端傳入）。 */
function eoCardInnerHtml(
    summary: SenkaObservedSummary,
    lang: Lang,
    foldOpen?: { eo?: boolean; quest?: boolean },
): string {
    const { eo, quest } = summary;
    const eoOpen = foldOpen?.eo ?? true;
    const questOpen = foldOpen?.quest ?? true;
    const clearedText = tFor(lang, 'ov.skCleared');
    const notClearedText = tFor(lang, 'ov.skNotCleared');

    const eoRowsHtml = eo.items.map(item =>
        `<tr${item.cleared ? '' : ' class="sk-off"'}>`
        + `<td>${esc(item.map)}</td>`
        + `<td class="n">+${esc(formatSenkaInt(item.points, lang))}</td>`
        + `<td>${esc(item.cleared ? clearedText : notClearedText)}</td>`
        + `</tr>`).join('');

    const eoFoldHtml = `<details${eoOpen ? ' open' : ''} class="sk-fold" data-fold="eo">`
        + `<summary>${esc(tFor(lang, 'ov.skEoTitle', { done: eo.clearedCount, total: eo.mapCount }))}</summary>`
        + `<table class="sk-list"><tbody>${eoRowsHtml}</tbody></table>`
        + `</details>`;

    const questRowsHtml = quest.items.map(item => {
        const entry = questSenkaCatalogEntry(item.questNo);
        const codeText = entry?.wikiId ? `${item.questNo} ${entry.wikiId}` : String(item.questNo);
        const questName = localizedQuestName(item.questNo, lang, entry?.nameJa || `#${item.questNo}`);
        const pointsText = formatQuestItemPoints(item, lang);
        return `<tr>`
            + `<td class="sk-off">${esc(codeText)}</td>`
            + `<td>${esc(questName)}</td>`
            + `<td class="n">${esc(pointsText)}</td>`
            + `</tr>`;
    }).join('');

    const questFoldHtml = `<details${questOpen ? ' open' : ''} class="sk-fold" data-fold="quest">`
        + `<summary>${esc(tFor(lang, 'ov.skQuestTitle', { n: quest.items.length }))}</summary>`
        + (questRowsHtml ? `<table class="sk-list"><tbody>${questRowsHtml}</tbody></table>` : '')
        + `<p class="sk-hint">${esc(tFor(lang, 'senka.unlisted'))}</p>`
        + `</details>`;

    return `<h3>${esc(tFor(lang, 'ov.skEoQuestTitle'))}</h3>${eoFoldHtml}${questFoldHtml}`;
}

/** 依 1b 已觀測戰果摘要建構主卡片與 EO／任務卡片 HTML（純函式，供分區與離線預覽共用）。 */
export function renderSenkaSectionBodyHtml(
    summary: SenkaObservedSummary,
    lang: Lang = getLang(),
    opts?: { foldOpen?: { eo?: boolean; quest?: boolean } },
): string {
    return `<section class="sk-card" id="sk-month">${monthCardInnerHtml(summary, lang, null, false)}</section>`
        + `<section class="sk-card" id="sk-eo">${eoCardInnerHtml(summary, lang, opts?.foldOpen)}</section>`;
}

/**
 * 第二期主卡片（純函式，供分區與離線預覽共用）：已校準時主數值為本月戰果推算並列出繼承分，
 * 設有目標時附榜線與差額。customPending 表示選了「自訂分數」但分數尚未填妥。
 */
export function renderSenkaMonthCardHtml(
    view: SenkaMonthView,
    lang: Lang = getLang(),
    opts?: { customPending?: boolean },
): string {
    return `<section class="sk-card" id="sk-month">${monthCardInnerHtml(view, lang, view, opts?.customPending === true)}</section>`;
}

/**
 * 榜線紀錄表的 <tr>：依公布時刻分組、新到舊；組內每筆榜線一列（名次升冪），
 * 本人戰果與名次只列在該組第一列。手動登錄的榜線附刪除鈕（data-del＝公布時刻:名次）。
 */
export function renderSenkaLogRowsHtml(rows: readonly SenkaRankingRow[], lang: Lang = getLang()): string {
    if (rows.length === 0) return `<tr><td colspan="6">—</td></tr>`;
    type Cutoff = Extract<SenkaRankingRow, { kind: 'cutoff' }>;
    const groups = new Map<number, { self: SenkaRankingRow | null; cutoffs: Cutoff[] }>();
    for (const row of rows) {
        let g = groups.get(row.publishedAt);
        if (!g) groups.set(row.publishedAt, g = { self: null, cutoffs: [] });
        if (row.kind === 'self') g.self = row;
        else g.cutoffs.push(row);
    }
    const autoText = tFor(lang, 'ov.skAuto');
    const manualText = tFor(lang, 'ov.skManual');
    const deleteText = tFor(lang, 'ov.skDelete');
    const out: string[] = [];
    for (const publishedAt of [...groups.keys()].sort((a, b) => b - a)) {
        const g = groups.get(publishedAt)!;
        const cutoffs = [...g.cutoffs].sort((a, b) => a.rank - b.rank);
        for (let i = 0; i < Math.max(cutoffs.length, 1); i++) {
            const c = cutoffs[i];
            const first = i === 0;
            const cutoffCell = c
                ? tFor(lang, 'ov.skCutoffCell', { n: formatSenkaRank(c.rank, lang), v: formatSenkaInt(c.score, lang) })
                : '—';
            const del = c && c.mode === 'manual'
                ? `<button type="button" data-del="${publishedAt}:${c.rank}" aria-label="${esc(`${deleteText} ${tFor(lang, 'ov.skCutoffName', { n: formatSenkaRank(c.rank, lang) })}`)}">${esc(deleteText)}</button>`
                : '';
            out.push(`<tr>`
                + `<td>${first ? esc(formatSenkaTimestamp(publishedAt)) : ''}</td>`
                + `<td class="n">${first && g.self ? esc(formatSenkaInt(g.self.score, lang)) : ''}</td>`
                + `<td class="n">${first && g.self ? esc(formatSenkaRank(g.self.rank, lang)) : ''}</td>`
                + `<td class="n">${esc(cutoffCell)}</td>`
                + `<td>${esc(c && c.mode === 'manual' ? manualText : autoText)}</td>`
                + `<td>${del}</td>`
                + `</tr>`);
        }
    }
    return out.join('');
}

/** 對帳列前七格（月份、繼承、普通、EO、任務、推算總額、最後名次）的 HTML。 */
function reconCellsHtml(row: SenkaReconRow, lang: Lang): string[] {
    const month = esc(tFor(lang, `senka.monthShort${row.month.month}`))
        + (row.inProgress ? ` <small>${esc(tFor(lang, 'ov.skInProgress'))}</small>` : '');
    return [
        month,
        esc(row.carry ? formatSenkaPartBounds(row.carry, lang) : '—'),
        row.regular.status === 'no-start'
            ? `<small>${esc(tFor(lang, 'ov.skStartUnknown'))}</small>`
            : esc(formatRegularPartValue(row.regular, lang)),
        esc(formatSenkaInt(row.eo, lang)),
        esc(formatQuestSenkaValue(row.quest, lang)),
        esc(row.total ? formatSenkaBounds(row.total, lang) : '—'),
        esc(row.lastRank ? formatSenkaRank(row.lastRank, lang) : '—'),
    ];
}

/** 當月已公布的榜次（公布時刻，新到舊）。 */
function currentMonthRounds(now: number): number[] {
    const month = senkaMonthOf(now);
    const latest = rankingRoundAt(now);
    const out: number[] = [];
    if (!latest) return out;
    for (let ts = latest.publishedAt; ; ts -= HALF_DAY_MS) {
        const round = rankingRoundAt(ts);
        if (!round || round.month.year !== month.year || round.month.month !== month.month) break;
        out.push(ts);
    }
    return out;
}

function sameMonth(a: SenkaMonth, b: SenkaMonth): boolean {
    return a.year === b.year && a.month === b.month;
}

export const senkaSection: OverviewSection = {
    id: 'senka',
    titleKey: 'ov.senka',
    async render(container: HTMLElement, ctx: SectionContext) {
        const pinned = getSenkaHeaderPinned();
        let target: SenkaTarget | null = loadSenkaTarget();
        // 選了「自訂分數」但分數尚未填妥：本頁暫以自訂、分數未定顯示，不寫入偏好。
        let customPending = false;
        let addRankDefault = target?.type === 'rank' ? target.rank : DEFAULT_ADD_RANK;

        const lang0 = getLang();
        const targetOptions = [
            `<option value="">${esc(tFor(lang0, 'ov.skTargetNone'))}</option>`,
            ...SENKA_TARGET_RANKS.map(r => `<option value="${r}">${esc(tFor(lang0, TARGET_LABEL_KEYS[r]))}</option>`),
            `<option value="custom">${esc(tFor(lang0, 'ov.skTargetCustom'))}</option>`,
        ].join('');
        const logCols = ['ov.skLogColPublished', 'ov.skLogColYou', 'ov.skLogColRank', 'ov.skLogColCutoff', 'ov.skLogColMode'];
        const logHead = logCols.map((key, i) => `<th${i === 0 || i === 4 ? '' : ' class="n"'}>${esc(tFor(lang0, key))}</th>`).join('')
            + '<th></th>';
        const reconCols = [
            'ov.skReconColMonth', 'ov.skPartCarry', 'senka.partRegular', 'senka.partEo', 'senka.partQuest',
            'ov.skReconColTotal', 'ov.skReconColLastRank', 'ov.skReconColFinal',
        ];
        const reconHead = reconCols.map((key, i) => `<th${i > 0 && i < 7 ? ' class="n"' : ''}>${esc(tFor(lang0, key))}</th>`).join('');
        const addLabels = ['ov.skAddRound', 'ov.skAddRank', 'ov.skAddScore'].map(k => esc(tFor(lang0, k)));

        container.innerHTML = `<div class="sk" id="sk" data-stage="2">`
            + `<p class="ov-note" id="sk-note">${esc(t('ov.skNoteObserved'))}</p>`
            + `<div class="ov-toolbar" id="sk-toolbar">`
            + `<label class="rs-inline" id="pin-section-label">`
            + `<input type="checkbox" id="sk-pin-header"${pinned ? ' checked' : ''}>`
            + `<span>${esc(t('ov.skPinPanel'))}</span>`
            + `</label>`
            + `<label>${esc(tFor(lang0, 'ov.skTarget'))}<select id="sk-target-select">${targetOptions}</select></label>`
            + `<input id="sk-custom" type="number" min="0" step="1" aria-label="${esc(tFor(lang0, 'ov.skTargetCustom'))}" hidden>`
            + `</div>`
            + `<div class="sk-cols" id="sk-body-cols">`
            + `<section class="sk-card" id="sk-month"><div class="ov-empty">${esc(t('ov.loading'))}</div></section>`
            + `<div class="sk-side">`
            + `<section class="sk-card" id="sk-log"><h3>${esc(tFor(lang0, 'ov.skLogTitle'))}</h3>`
            + `<div class="rl-table-wrap"><table class="rl-table sk-table"><thead><tr>${logHead}</tr></thead>`
            + `<tbody id="sk-log-body"><tr><td colspan="6">${esc(t('ov.loading'))}</td></tr></tbody></table></div>`
            + `<p class="sk-hint">${esc(tFor(lang0, 'ov.skLogHint'))}</p>`
            + `<form class="sk-form" id="sk-add">`
            + `<select id="sk-add-round" aria-label="${addLabels[0]}" required></select>`
            + `<input id="sk-add-rank" type="number" min="1" step="1" required aria-label="${addLabels[1]}" placeholder="${addLabels[1]}">`
            + `<input id="sk-add-score" type="number" min="0" step="1" required aria-label="${addLabels[2]}" placeholder="${addLabels[2]}">`
            + `<button type="submit">${esc(tFor(lang0, 'ov.skAdd'))}</button>`
            + `</form>`
            + `<p class="sk-hint" id="sk-add-err" hidden></p>`
            + `</section>`
            + `<section class="sk-card" id="sk-eo" hidden></section>`
            + `</div>`
            + `</div>`
            + `<section class="sk-card sk-wide" id="sk-recon" hidden><h3>${esc(tFor(lang0, 'ov.skReconTitle'))}</h3>`
            + `<div class="rl-table-wrap"><table class="rl-table sk-table"><thead><tr>${reconHead}</tr></thead><tbody id="sk-recon-body"></tbody></table></div>`
            + `<p class="sk-hint">${esc(tFor(lang0, 'ov.skReconNote'))}</p></section>`
            + `</div>`;

        const $ = <T extends Element>(sel: string) => container.querySelector<T>(sel)!;
        const noteEl = $<HTMLElement>('#sk-note');
        const checkbox = $<HTMLInputElement>('#sk-pin-header');
        const targetSelect = $<HTMLSelectElement>('#sk-target-select');
        const customInput = $<HTMLInputElement>('#sk-custom');
        const monthEl = $<HTMLElement>('#sk-month');
        const logBody = $<HTMLElement>('#sk-log-body');
        const addForm = $<HTMLFormElement>('#sk-add');
        const roundSelect = $<HTMLSelectElement>('#sk-add-round');
        const rankInput = $<HTMLInputElement>('#sk-add-rank');
        const scoreInput = $<HTMLInputElement>('#sk-add-score');
        const addErr = $<HTMLElement>('#sk-add-err');
        const eoEl = $<HTMLElement>('#sk-eo');
        const reconEl = $<HTMLElement>('#sk-recon');
        const reconBody = $<HTMLElement>('#sk-recon-body');

        // linkedom 不會將 HTML checked 屬性自動反映至 .checked，顯式設定可保證兩端型別一致。
        checkbox.checked = pinned;
        checkbox.addEventListener('change', () => {
            persistSenkaHeaderPinned(checkbox.checked);
        });

        const onStorage = (e: StorageEvent) => {
            if (ctx.signal?.aborted || !container.isConnected) return;
            if (e.key === SENKA_HEADER_KEY) {
                checkbox.checked = getSenkaHeaderPinned();
            }
        };
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !ctx.signal?.aborted) {
            window.addEventListener('storage', onStorage, ctx.signal ? { signal: ctx.signal } : undefined);
            // linkedom 的 addEventListener 不處理 AbortSignal 選項，同時於 abort 主動 removeEventListener。
            ctx.signal?.addEventListener('abort', () => window.removeEventListener('storage', onStorage), { once: true });
        }

        let loadGen = 0;
        let recon: SenkaReconMonthData[] | null = null;
        let reconMonth: SenkaMonth | null = null;
        let view: SenkaMonthView | null = null;

        const alive = () => !ctx.signal?.aborted && container.isConnected;

        // ── 目標設定 ──
        function syncTargetControls() {
            setSelectValue(targetSelect, targetSelectValue(target, customPending));
            customInput.hidden = targetSelect.value !== 'custom';
            if (target?.type === 'custom' && !isFocused(customInput)) customInput.value = String(target.score);
        }

        function syncAddRankDefault() {
            const next = target?.type === 'rank' ? target.rank : DEFAULT_ADD_RANK;
            if (rankInput.value === String(addRankDefault) && !isFocused(rankInput)) rankInput.value = String(next);
            addRankDefault = next;
        }

        function applyTarget(next: SenkaTarget | null, pending: boolean) {
            target = next;
            customPending = pending;
            syncTargetControls();
            syncAddRankDefault();
            refreshMonth(Date.now());
        }

        syncTargetControls();
        rankInput.value = String(addRankDefault);
        refreshRoundOptions(Date.now());

        targetSelect.addEventListener('change', () => {
            const v = targetSelect.value;
            if (v === '') {
                applyTarget(saveSenkaTarget(null), false);
            } else if (v === 'custom') {
                const score = parseCustomScore(customInput.value);
                if (score === null) applyTarget(null, true);
                else applyTarget(saveSenkaTarget({ type: 'custom', score }), false);
            } else {
                applyTarget(saveSenkaTarget({ type: 'rank', rank: Number(v) }), false);
            }
        });
        customInput.addEventListener('input', () => {
            const score = parseCustomScore(customInput.value);
            if (score === null) applyTarget(null, true);
            else applyTarget(saveSenkaTarget({ type: 'custom', score }), false);
        });
        onSenkaTargetChange(next => {
            if (!alive()) return;
            applyTarget(next, false);
        }, ctx.signal);

        // ── 畫面更新（只覆寫插槽，不重建控制項） ──
        function renderEo() {
            if (!view) return;
            const eoFold = eoEl.querySelector('details[data-fold="eo"]');
            const questFold = eoEl.querySelector('details[data-fold="quest"]');
            const foldOpen = eoFold && questFold
                ? { eo: isFoldOpen(eoFold), quest: isFoldOpen(questFold) }
                : undefined;
            eoEl.innerHTML = eoCardInnerHtml(view, getLang(), foldOpen);
            eoEl.hidden = false;
        }

        function refreshMonth(now: number) {
            if (!recon) return;
            const cur = recon[0];
            view = buildSenkaMonthView(cur.data, cur.rankings, target, now);
            noteEl.textContent = t(view.calibration.status === 'calibrated' ? 'ov.skNoteCalibrated' : 'ov.skNoteObserved');
            monthEl.innerHTML = monthCardInnerHtml(view, getLang(), view, customPending);
        }

        function refreshLog() {
            if (!recon) return;
            logBody.innerHTML = renderSenkaLogRowsHtml(recon[0].rankings.rows, getLang());
        }

        /** 只有選項集合改變時才重建 option，並保留原本選中的榜次。 */
        function refreshRoundOptions(now: number) {
            const rounds = currentMonthRounds(now).map(String);
            const current = Array.from(roundSelect.options).map(o => o.value);
            if (rounds.length === current.length && rounds.every((v, i) => v === current[i])) return;
            const picked = roundSelect.value;
            roundSelect.innerHTML = rounds
                .map(v => `<option value="${v}">${esc(formatSenkaTimestamp(Number(v)))}</option>`)
                .join('');
            if (rounds.length) setSelectValue(roundSelect, rounds.includes(picked) ? picked : rounds[0]);
        }

        function createReconRow(key: string): HTMLTableRowElement {
            const lang = getLang();
            const tr = document.createElement('tr') as HTMLTableRowElement;
            tr.setAttribute('data-month', key);
            const options = ['', ...SENKA_FINAL_TIERS]
                .map(v => `<option value="${v}">${esc(tFor(lang, FINAL_LABEL_KEYS[v]))}</option>`)
                .join('');
            tr.innerHTML = Array.from({ length: 7 }, (_, i) => `<td${i > 0 ? ' class="n"' : ''}></td>`).join('')
                + `<td><select>${options}</select></td>`;
            return tr;
        }

        function refreshRecon(now: number) {
            if (!recon) return;
            const lang = getLang();
            const rows = recon.map(r => buildSenkaReconRow(r.month, r.data, r.rankings, r.finalTier, now));
            const wanted = new Set(rows.map(r => r.key));
            const existing = new Map<string, HTMLTableRowElement>();
            for (const tr of Array.from(reconBody.children) as HTMLTableRowElement[]) {
                const key = tr.getAttribute('data-month');
                if (key && wanted.has(key)) existing.set(key, tr);
                else tr.remove();
            }
            let ref: Element | null = reconBody.firstElementChild;
            for (const row of rows) {
                const tr = existing.get(row.key) ?? createReconRow(row.key);
                if (tr === ref) ref = ref.nextElementSibling;
                else reconBody.insertBefore(tr, ref);
                const cells = reconCellsHtml(row, lang);
                const tds = tr.children;
                cells.forEach((html, i) => {
                    if (tds[i].innerHTML !== html) tds[i].innerHTML = html;
                });
                const select = tr.querySelector('select') as HTMLSelectElement;
                select.setAttribute('aria-label', `${tFor(lang, `senka.monthShort${row.month.month}`)} ${tFor(lang, 'ov.skReconColFinal')}`);
                if (!isFocused(select)) setSelectValue(select, row.finalTier ?? '');
                // 最終結果要等作戰月結束（月末 22:00 JST）才可能得知，進行中的月份不開放填寫，
                // 避免玩家先猜群別。跨月時 loadAndRender 重讀，上個月的列隨之解除停用。
                select.disabled = row.inProgress;
                if (row.inProgress) select.title = tFor(lang, 'ov.skFinalAfterClose');
                else select.removeAttribute('title');
            }
            reconEl.hidden = false;
        }

        function showErr(err: unknown) {
            if (err === null) {
                addErr.hidden = true;
                addErr.textContent = '';
                return;
            }
            addErr.textContent = t('ov.loadFailed', { msg: String((err as Error)?.message ?? err) });
            addErr.hidden = false;
        }

        // ── 榜線紀錄：登錄與刪除 ──
        addForm.querySelector('button')!.addEventListener('click', () => addForm.classList.add('tried'));
        addForm.addEventListener('submit', e => {
            e.preventDefault();
            void (async () => {
                try {
                    await saveManualCutoff(db, {
                        publishedAt: Number(roundSelect.value),
                        rank: Number(rankInput.value),
                        score: Number(scoreInput.value),
                    });
                    scoreInput.value = '';
                    addForm.classList.remove('tried');
                    showErr(null);
                    await loadAndRender();
                } catch (err) {
                    showErr(err);
                }
            })();
        });
        logBody.addEventListener('click', e => {
            const btn = (e.target as Element | null)?.closest?.('button[data-del]');
            const [publishedAt, rank] = (btn?.getAttribute('data-del') ?? '').split(':').map(Number);
            if (!btn || !Number.isFinite(publishedAt) || !Number.isFinite(rank)) return;
            void (async () => {
                try {
                    await deleteManualCutoff(db, publishedAt, rank);
                    showErr(null);
                    await loadAndRender();
                } catch (err) {
                    showErr(err);
                }
            })();
        });

        // ── 逐月對帳：最終結果 ──
        reconBody.addEventListener('change', e => {
            const select = e.target as HTMLSelectElement | null;
            const key = select?.closest?.('tr')?.getAttribute('data-month');
            if (!select || !key) return;
            const tier = isSenkaFinalTier(select.value) ? select.value : null;
            void (async () => {
                try {
                    await saveSenkaMonthFinal(db.senkaMonths, key, tier);
                    const entry = recon?.find(r => senkaMonthKey(r.month) === key);
                    if (entry) entry.finalTier = tier;
                } catch (err) {
                    // 寫入失敗：還原成快取中的值，避免畫面顯示未儲存的結果。
                    const entry = recon?.find(r => senkaMonthKey(r.month) === key);
                    setSelectValue(select, entry?.finalTier ?? '');
                    showErr(err);
                }
            })();
        });

        function ensureQuestLocale(lang: Lang) {
            if (lang === 'ja' || questCatalogLocaleLoaded(lang)) return;
            void loadQuestCatalogLocale(lang).then(() => {
                if (!alive() || !view) return;
                renderEo();
            }).catch(() => { /* 載入失敗維持日文任務名，不阻斷其餘資訊。 */ });
        }

        ensureQuestLocale(getLang());

        async function loadAndRender() {
            if (!alive()) return;
            const myGen = ++loadGen;
            const now = Date.now();
            const month = senkaMonthOf(now);
            try {
                const rows = await loadSenkaReconMonths(db, now);
                if (!alive() || myGen !== loadGen) return;
                recon = rows;
                reconMonth = month;
                refreshMonth(now);
                refreshLog();
                renderEo();
                refreshRecon(now);
                refreshRoundOptions(now);
                ensureQuestLocale(getLang());
            } catch (err) {
                if (!alive() || myGen !== loadGen) return;
                recon = null;
                reconMonth = null;
                view = null;
                monthEl.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((err as Error)?.message ?? err) }))}</div>`;
            }
        }

        ctx.onStateChange?.(paths => {
            if (paths.some(path => REFRESH_PATHS.has(path))) void loadAndRender();
        });

        if (!ctx.signal?.aborted) {
            const timer = setInterval(() => {
                if (!alive()) {
                    clearInterval(timer);
                    return;
                }
                const now = Date.now();
                if (reconMonth && !sameMonth(senkaMonthOf(now), reconMonth)) {
                    void loadAndRender();
                } else if (recon) {
                    refreshMonth(now);
                    refreshRecon(now);
                    refreshRoundOptions(now);
                }
            }, 60_000);
            ctx.signal?.addEventListener('abort', () => clearInterval(timer), { once: true });
        }

        await loadAndRender();
    },
};
