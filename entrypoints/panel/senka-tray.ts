// 面板本月戰果（1a 普通戰果）：頁首戰果按鈕與 270 px 托盤。
// 開啟時取代 #tabpanel，出擊進點／新戰鬥封包／切分頁／Esc 時收起；面板不寫入偏好。

import type { Lang } from '@/utils/gamedata-i18n';
import { esc } from '@/utils/html-escape';
import { senkaDeadlines } from '@/utils/senka';
import {
    formatRegularSenkaValue, formatSignedSenka, senkaDeadlineLines, type SenkaRegularSummary,
} from '@/utils/senka-view';
import { getLang, tFor } from '@/utils/ui-i18n';

export type SenkaTrayFocusTarget = 'points' | 'close';

export interface SenkaTrayState {
    summary?: SenkaRegularSummary | null;
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

/** 頁首戰果按鈕（1a 固定顯示「普通戰果」短標籤，避免誤當總分）。 */
export function senkaHeaderButtonHtml(
    summary: SenkaRegularSummary | null,
    open: boolean,
    lang: Lang = getLang(),
): string {
    const shortLabel = tFor(lang, 'senka.shortRegular');
    const value = summary ? formatRegularSenkaValue(summary.regular, lang) : '—';
    const full = `${tFor(lang, 'senka.regular')} ${value}`;
    return `<button type="button" id="points" data-senka="1" aria-controls="senka-tray" aria-expanded="${open}" `
        + `title="${esc(full)}" aria-label="${esc(full)}">`
        + `<span class="lbl">${esc(shortLabel)}</span> <b>${esc(value)}</b></button>`;
}

/** 戰果托盤內部 HTML（正式面板與離線預覽共用）。 */
export function senkaTrayInnerHtml(
    summary: SenkaRegularSummary | null,
    lang: Lang = getLang(),
    opts?: { loading?: boolean; error?: string | null },
): string {
    const monthShort = summary ? tFor(lang, `senka.monthShort${summary.month.month}`) : '';
    const head = `<div class="ph-head">`
        + `<span class="ph-title" id="senka-title">${esc(tFor(lang, 'senka.trayTitle'))}</span>`
        + `<span class="ph-target">${esc(monthShort)}</span>`
        + `<button type="button" class="ph-close" id="senka-close" aria-label="${esc(tFor(lang, 'senka.close'))}">✕</button>`
        + `</div>`;

    const row = (label: string, value: string, cls = '') =>
        `<div class="sn-row${cls ? ` ${cls}` : ''}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;

    let body: string;
    if (opts?.loading && !summary) {
        body = `<div class="sn-comp">${esc(tFor(lang, 'ov.loading'))}</div>`;
    } else if (opts?.error) {
        body = `<div class="sn-comp sn-err">${esc(tFor(lang, 'ov.loadFailed', { msg: opts.error }))}</div>`;
    } else if (!summary || summary.regular.status === 'no-data') {
        body = row(tFor(lang, 'senka.regular'), '—', 'sn-total')
            + `<div class="sn-comp">${esc(tFor(lang, 'senka.noData'))}</div>`;
    } else if (summary.regular.status === 'anomaly') {
        body = row(tFor(lang, 'senka.regular'), '—', 'sn-total')
            + `<div class="sn-comp">${esc(tFor(lang, 'senka.anomaly'))}</div>`;
    } else if (summary.regular.status === 'no-start') {
        const todayRow = summary.today === null ? '' : row(tFor(lang, 'senka.today'), formatSignedSenka(summary.today, lang));
        body = row(tFor(lang, 'senka.regular'), '—', 'sn-total')
            + `<div class="sn-comp">${esc(tFor(lang, 'senka.noStart'))}</div>`
            + row(tFor(lang, 'senka.observed'), formatSignedSenka(summary.regular.observed, lang))
            + todayRow
            + `<div class="sn-comp">${esc(tFor(lang, 'senka.regularOnly'))}</div>`;
    } else {
        const value = formatRegularSenkaValue(summary.regular, lang);
        const todayText = summary.today === null ? '—' : formatSignedSenka(summary.today, lang);
        body = row(tFor(lang, 'senka.regular'), value, 'sn-total')
            + `<div class="sn-comp">${esc(tFor(lang, 'senka.regularOnly'))}</div>`
            + row(tFor(lang, 'senka.today'), todayText);
    }

    const deadlines = summary?.deadlines ?? senkaDeadlines(Date.now());
    const foot = senkaDeadlineLines(deadlines, lang).map(line => `<span>${esc(line)}</span>`).join('');
    return `${head}<div class="sn-body">${body}</div><div class="sn-foot">${foot}</div>`;
}

/** 掛載戰果托盤控制器（生命週期同面板視窗）。 */
export function mountSenkaTray(deps: SenkaTrayDeps): SenkaTrayController {
    const { root } = deps;
    let open = false;
    let summary: SenkaRegularSummary | null = null;
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
