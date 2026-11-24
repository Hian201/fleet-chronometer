// 面板本月戰果：頁首戰果按鈕與 270 px 托盤。取得當月本人榜分時顯示校準後的本月戰果推算與榜線區，
// 否則顯示已觀測戰果（普通＋EO＋任務，不含繼承分）。
// 開啟時取代 #tabpanel，出擊進點／新戰鬥封包／切分頁／Esc 時收起；面板不寫入偏好。

import type { Lang } from '@/utils/gamedata-i18n';
import { esc } from '@/utils/html-escape';
import { senkaDeadlines } from '@/utils/senka';
import type { SenkaTarget } from '@/utils/senka-calibration';
import {
    formatObservedGainValue, formatObservedSenkaValue, formatQuestSenkaValue,
    formatRegularPartValue, formatSenkaBounds, formatSenkaHeadline, formatSenkaInt, formatSenkaIntGap,
    formatSenkaPartBounds, formatSenkaRank, formatSenkaTimestamp, formatSignedSenka, formatSignedSenkaBounds,
    senkaDeadlineLines,
    type SenkaMonthView, type SenkaObservedSummary,
} from '@/utils/senka-view';
import { getLang, tFor } from '@/utils/ui-i18n';

export type SenkaTrayFocusTarget = 'points' | 'close';

/** 托盤可接受 1b 已觀測摘要，或含校準與目標的第二期月檢視。 */
export type SenkaTraySummary = SenkaObservedSummary | SenkaMonthView;

export interface SenkaTrayState {
    summary?: SenkaTraySummary | null;
    loading?: boolean;
    error?: string | null;
}

export interface SenkaTrayDeps {
    root: HTMLElement;
    onOpenChange: (open: boolean, focus?: SenkaTrayFocusTarget) => void;
}

export interface SenkaTrayController {
    isOpen(): boolean;
    setOpen(open: boolean, focus?: SenkaTrayFocusTarget): void;
    toggle(): void;
    setState(next: SenkaTrayState): void;
    relabel(): void;
}

/** 頁首戰果按鈕（1b 已納入 EO 與任務，顯示「戰果」短標籤；完整標題與無障礙標籤為「本月戰果」）。 */
export function senkaHeaderButtonHtml(
    summary: SenkaTraySummary | null,
    open: boolean,
    lang: Lang = getLang(),
): string {
    const shortLabel = tFor(lang, 'senka.short');
    const value = summary ? formatSenkaHeadline(summary, lang) : '—';
    const full = `${tFor(lang, 'senka.full')} ${value}`;
    return `<button type="button" id="points" data-senka="1" aria-controls="senka-tray" aria-expanded="${open}" `
        + `title="${esc(full)}" aria-label="${esc(full)}">`
        + `<span class="lbl">${esc(shortLabel)}</span> <b>${esc(value)}</b></button>`;
}

/** 戰果托盤內部 HTML（正式面板與離線預覽共用）。 */
const TIER_KEYS: Record<number, string> = { 5: 'ov.skFinal5', 20: 'ov.skFinal20', 100: 'ov.skFinal100', 500: 'ov.skFinal500' };

function targetShortLabel(target: SenkaTarget, lang: Lang): string {
    if (target.type === 'custom') return tFor(lang, 'senka.targetCustom', { v: formatSenkaInt(target.score, lang) });
    const key = TIER_KEYS[target.rank];
    return key ? tFor(lang, key) : tFor(lang, 'senka.rankN', { rank: formatSenkaRank(target.rank, lang) });
}

const row = (label: string, value: string, cls = '') =>
    `<div class="sn-row${cls ? ` ${cls}` : ''}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;

/**
 * 榜線區：公布時刻、本人與目標榜線、當次榜差、統計後新增與距目標。
 * 有目標榜線時以該榜次為準（本人取同榜次分數），否則以最近一次本人榜分為準。
 */
function senkaBoardHtml(view: SenkaMonthView, lang: Lang): string {
    const cal = view.calibration.status === 'calibrated' ? view.calibration : null;
    const tr = view.targetResult;
    const cutoff = tr?.type === 'rank' ? tr.cutoff : null;
    if (!cal && !(tr?.type === 'rank')) return '';

    const round = cutoff ?? (cal ? cal.latestRound : null);
    const sub = round
        ? `<div class="sn-sub">${esc(tFor(lang, round.isFinalRound ? 'senka.finalPublished' : 'senka.lastPublished'))} `
            + `${esc(formatSenkaTimestamp(round.publishedAt))}</div>`
        : '';

    const parts: string[] = [];
    if (cal) {
        const self = tr?.type === 'rank' && cutoff ? tr.selfScoreAtCutoff : cal.publishedScore;
        parts.push(`${tFor(lang, 'senka.you')} ${self === null ? '—' : formatSenkaInt(self, lang)}`);
    }
    if (tr?.type === 'rank') {
        parts.push(`${tFor(lang, 'senka.rankN', { rank: formatSenkaRank(tr.rank, lang) })} `
            + `${cutoff ? formatSenkaInt(cutoff.score, lang) : '—'}`);
    }
    const line = `<div class="sn-line">${esc(parts.join(' · '))}</div>`;

    const dl: [string, string][] = [];
    if (tr?.type === 'rank' && tr.gapAtPublication !== null) {
        dl.push([tFor(lang, 'senka.gap'), formatSenkaIntGap(tr.gapAtPublication, lang)]);
    }
    if (cal) dl.push([tFor(lang, 'senka.since'), formatSignedSenkaBounds(cal.sinceTally, lang)]);
    if (cal && tr) {
        const gap = tr.gapToTarget ? formatSignedSenkaBounds(tr.gapToTarget, lang) : '—';
        if (tr.type === 'custom') dl.push([tFor(lang, 'ov.skToCustom'), gap]);
        else if (cutoff) dl.push([tFor(lang, 'senka.toCutoff'), gap]);
    }
    const dlHtml = dl.length
        ? `<dl>${dl.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
        : '';
    const missing = tr?.type === 'rank' && !cutoff
        ? `<div class="sn-comp">${esc(tFor(lang, 'ov.skNoCutoff'))}</div>`
        : '';
    return `<div class="sn-board">${sub}${line}${dlHtml}${missing}</div>`;
}

/** 戰果托盤內部 HTML（正式面板與離線預覽共用）。 */
export function senkaTrayInnerHtml(
    summary: SenkaTraySummary | null,
    lang: Lang = getLang(),
    opts?: { loading?: boolean; error?: string | null },
): string {
    const view = summary && 'calibration' in summary ? summary : null;
    const monthShort = summary ? tFor(lang, `senka.monthShort${summary.month.month}`) : '';
    const target = view?.target ? ` · ${targetShortLabel(view.target, lang)}` : '';
    const head = `<div class="ph-head">`
        + `<span class="ph-title" id="senka-title">${esc(tFor(lang, 'senka.trayTitle'))}</span>`
        + `<span class="ph-target">${esc(monthShort + target)}</span>`
        + `<button type="button" class="ph-close" id="senka-close" aria-label="${esc(tFor(lang, 'senka.close'))}">✕</button>`
        + `</div>`;

    const compLine = summary
        ? `${tFor(lang, 'senka.partRegular')} ${formatRegularPartValue(summary.regular, lang)}`
            + ` · ${tFor(lang, 'senka.partEo')} ${formatSenkaInt(summary.eo.total, lang)}`
            + ` · ${tFor(lang, 'senka.partQuest')} ${formatQuestSenkaValue(summary.quest, lang)}`
        : '';

    const cal = view?.calibration.status === 'calibrated' ? view.calibration : null;
    let body: string;
    if (opts?.loading && !summary) {
        body = `<div class="sn-comp">${esc(tFor(lang, 'ov.loading'))}</div>`;
    } else if (opts?.error) {
        body = `<div class="sn-comp sn-err">${esc(tFor(lang, 'ov.loadFailed', { msg: opts.error }))}</div>`;
    } else if (view && cal) {
        const carry = cal.carry ? formatSenkaPartBounds(cal.carry, lang) : '—';
        const drift = cal.reasons.includes('baseline-drift') || cal.reasons.includes('inconsistent-baseline')
            ? `<div class="sn-comp">${esc(tFor(lang, 'senka.driftNote'))}</div>`
            : '';
        const todayText = view.today === null ? '—' : formatSignedSenka(view.today, lang);
        body = row(tFor(lang, 'senka.estimate'), formatSenkaBounds(cal.estimate, lang), 'sn-total')
            + `<div class="sn-comp">${esc(`${tFor(lang, 'senka.partCarry')} ${carry} · ${compLine}`)}</div>`
            + drift
            + row(tFor(lang, 'senka.today'), todayText)
            + senkaBoardHtml(view, lang);
    } else if (!summary || summary.regular.status === 'no-data') {
        const extra = summary && (summary.eo.total > 0 || summary.quest.max > 0)
            ? `<div class="sn-comp">${esc(compLine)}</div>`
            : '';
        body = row(tFor(lang, 'ov.skObserved'), '—', 'sn-total')
            + extra
            + `<div class="sn-comp">${esc(tFor(lang, 'senka.noData'))}</div>`;
    } else if (summary.regular.status === 'anomaly') {
        const extra = summary.eo.total > 0 || summary.quest.max > 0
            ? `<div class="sn-comp">${esc(compLine)}</div>`
            : '';
        body = row(tFor(lang, 'ov.skObserved'), '—', 'sn-total')
            + extra
            + `<div class="sn-comp">${esc(tFor(lang, 'senka.anomaly'))}</div>`;
    } else if (summary.regular.status === 'no-start') {
        const todayRow = summary.today === null ? '' : row(tFor(lang, 'senka.today'), formatSignedSenka(summary.today, lang));
        body = row(tFor(lang, 'ov.skObserved'), '—', 'sn-total')
            + `<div class="sn-comp">${esc(compLine)}</div>`
            + `<div class="sn-comp">${esc(`${tFor(lang, 'senka.noStart')} · ${tFor(lang, 'ov.skExclCarry')}`)}</div>`
            + row(tFor(lang, 'senka.observed'), formatObservedGainValue(summary, lang))
            + todayRow;
    } else {
        const value = formatObservedSenkaValue(summary, lang);
        const todayText = summary.today === null ? '—' : formatSignedSenka(summary.today, lang);
        body = row(tFor(lang, 'ov.skObserved'), value, 'sn-total')
            + `<div class="sn-comp">${esc(compLine)}</div>`
            + `<div class="sn-comp">${esc(tFor(lang, 'ov.skExclCarry'))}</div>`
            + row(tFor(lang, 'senka.today'), todayText);
    }

    if (view && !cal && !opts?.error && !(opts?.loading && !summary)) body += senkaBoardHtml(view, lang);

    const deadlines = summary?.deadlines ?? senkaDeadlines(Date.now());
    const foot = senkaDeadlineLines(deadlines, lang, { includeQuest: true })
        .map(line => `<span>${esc(line)}</span>`)
        .join('')
        + `<span class="sn-note">${esc(tFor(lang, 'senka.unlisted'))}</span>`;
    return `${head}<div class="sn-body">${body}</div><div class="sn-foot">${foot}</div>`;
}

/** 掛載戰果托盤控制器（生命週期同面板視窗）。 */
export function mountSenkaTray(deps: SenkaTrayDeps): SenkaTrayController {
    const { root } = deps;
    let open = false;
    let summary: SenkaTraySummary | null = null;
    let loading = false;
    let error: string | null = null;

    function render() {
        if (!open) return;
        const keepCloseFocus = root.ownerDocument.activeElement?.id === 'senka-close';
        root.innerHTML = senkaTrayInnerHtml(summary, getLang(), { loading, error });
        if (keepCloseFocus) root.querySelector<HTMLElement>('#senka-close')?.focus();
    }

    function setOpen(next: boolean, focus?: SenkaTrayFocusTarget) {
        if (open === next) {
            if (open && focus === 'close') root.querySelector<HTMLElement>('#senka-close')?.focus();
            return;
        }
        open = next;
        root.hidden = !open;
        if (open) render();
        deps.onOpenChange(open, focus);
        if (open && focus === 'close') {
            root.querySelector<HTMLElement>('#senka-close')?.focus();
        }
    }

    root.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('#senka-close')) setOpen(false, 'points');
    });
    root.ownerDocument.addEventListener('keydown', e => {
        if (e.key === 'Escape' && open) setOpen(false, 'points');
    });

    return {
        isOpen: () => open,
        setOpen,
        toggle: () => setOpen(!open, open ? 'points' : 'close'),
        setState(next: SenkaTrayState) {
            if ('summary' in next) summary = next.summary ?? null;
            if (next.loading !== undefined) loading = next.loading;
            if ('error' in next) error = next.error ?? null;
            render();
        },
        relabel() {
            render();
        },
    };
}
