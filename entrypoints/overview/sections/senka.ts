// 戰果分區（1a 內容）：只依 db.resources 的提督經驗值換算本月普通戰果與截止倒數。
// HTML 建構器 renderSenkaSectionBodyHtml 純函式匯出，供離線預覽直接共用。
//
// 重繪守則（design-guidelines §4.2 / §4.2.1）：
// 先同步畫出外殼並綁好工具列 checkbox 與 storage 同步，再非同步查詢 DB；
// 後續即時更新與每分鐘倒數只覆寫 #sk-body，絕不重建工具列與 checkbox。

import type { OverviewSection, SectionContext } from './types';
import { db } from '@/utils/db';
import type { Lang } from '@/utils/gamedata-i18n';
import { esc } from '@/utils/html-escape';
import { senkaMonthOf, type ExpReading, type RegularSenkaResult, type SenkaMonth } from '@/utils/senka';
import { loadSenkaExpReadings } from '@/utils/senka-readings';
import {
    buildRegularSenkaSummary, formatRegularSenkaValue, formatSignedSenka, senkaDeadlineLines,
    type SenkaRegularSummary,
} from '@/utils/senka-view';
import { getLang, t, tFor } from '@/utils/ui-i18n';
import { getSenkaHeaderPinned, persistSenkaHeaderPinned, SENKA_HEADER_KEY } from '@/utils/ui-prefs';

const HINT_KEYS: Partial<Record<RegularSenkaResult['status'], string>> = {
    range: 'ov.skReconNote',
    'no-start': 'senka.noStart',
    'no-data': 'senka.noData',
    anomaly: 'senka.anomaly',
};

function kvRowHtml(label: string, value: string): string {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd><dd class="n"></dd>`;
}

/** 依 1a 普通戰果摘要建構主卡片 HTML（純函式，供分區與離線預覽共用）。 */
export function renderSenkaSectionBodyHtml(summary: SenkaRegularSummary, lang: Lang = getLang()): string {
    const { regular } = summary;
    const hintKey = HINT_KEYS[regular.status];
    const hintHtml = hintKey ? `<p class="sk-hint">${esc(tFor(lang, hintKey))}</p>` : '';

    let kvHtml = '';
    if (regular.status === 'exact' || regular.status === 'range') {
        const todayVal = summary.today === null ? '—' : formatSignedSenka(summary.today, lang);
        kvHtml = `<dl class="sk-kv sk-sep">${kvRowHtml(tFor(lang, 'senka.today'), todayVal)}</dl>`;
    } else if (regular.status === 'no-start') {
        const rows = [kvRowHtml(tFor(lang, 'senka.observed'), formatSignedSenka(regular.observed, lang))];
        if (summary.today !== null) {
            rows.push(kvRowHtml(tFor(lang, 'senka.today'), formatSignedSenka(summary.today, lang)));
        }
        kvHtml = `<dl class="sk-kv sk-sep">${rows.join('')}</dl>`;
    }

    const closesHtml = senkaDeadlineLines(summary.deadlines, lang)
        .map(line => `<span>${esc(line)}</span>`)
        .join('');

    return `<section class="sk-card" id="sk-month">`
        + `<h3>${esc(tFor(lang, `senka.month${summary.month.month}`))}</h3>`
        + `<div class="sk-total">`
        + `<span class="sk-tl">${esc(tFor(lang, 'ov.skMonthRegular'))}</span>`
        + `<span class="sk-tv">${esc(formatRegularSenkaValue(regular, lang))}</span>`
        + `</div>`
        + hintHtml
        + kvHtml
        + `<div class="sk-sep sk-closes">${closesHtml}</div>`
        + `</section>`;
}

function sameMonth(a: SenkaMonth, b: SenkaMonth): boolean {
    return a.year === b.year && a.month === b.month;
}

export const senkaSection: OverviewSection = {
    id: 'senka',
    titleKey: 'ov.senka',
    async render(container: HTMLElement, ctx: SectionContext) {
        const pinned = getSenkaHeaderPinned();
        container.innerHTML = `<div class="sk" id="sk" data-stage="0">`
            + `<p class="ov-note">${esc(t('ov.skNoteRegular'))}</p>`
            + `<div class="ov-toolbar" id="sk-toolbar">`
            + `<label class="rs-inline" id="pin-section-label">`
            + `<input type="checkbox" id="sk-pin-header"${pinned ? ' checked' : ''}>`
            + `<span>${esc(t('ov.skPinPanel'))}</span>`
            + `</label>`
            + `</div>`
            + `<div class="sk-cols" id="sk-body">`
            + `<div class="ov-empty">${esc(t('ov.loading'))}</div>`
            + `</div>`
            + `</div>`;

        const checkbox = container.querySelector<HTMLInputElement>('#sk-pin-header')!;
        const bodyEl = container.querySelector<HTMLElement>('#sk-body')!;
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
        let cachedReadings: ExpReading[] | null = null;
        let cachedMonth: SenkaMonth | null = null;

        async function loadAndRender() {
            if (ctx.signal?.aborted || !container.isConnected) return;
            const myGen = ++loadGen;
            const now = Date.now();
            const month = senkaMonthOf(now);
            try {
                const readings = await loadSenkaExpReadings(db.resources, month);
                if (ctx.signal?.aborted || !container.isConnected || myGen !== loadGen) return;
                cachedReadings = readings;
                cachedMonth = month;
                bodyEl.innerHTML = renderSenkaSectionBodyHtml(
                    buildRegularSenkaSummary(readings, Date.now()),
                    getLang(),
                );
            } catch (err) {
                if (ctx.signal?.aborted || !container.isConnected || myGen !== loadGen) return;
                cachedReadings = null;
                cachedMonth = null;
                bodyEl.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((err as Error)?.message ?? err) }))}</div>`;
            }
        }

        ctx.onStateChange?.(paths => {
            if (paths.includes('api_port/port')) void loadAndRender();
        });

        if (!ctx.signal?.aborted) {
            const timer = setInterval(() => {
                if (ctx.signal?.aborted || !container.isConnected) {
                    clearInterval(timer);
                    return;
                }
                const now = Date.now();
                const month = senkaMonthOf(now);
                if (cachedMonth && !sameMonth(month, cachedMonth)) {
                    void loadAndRender();
                } else if (cachedReadings) {
                    bodyEl.innerHTML = renderSenkaSectionBodyHtml(
                        buildRegularSenkaSummary(cachedReadings, now),
                        getLang(),
                    );
                }
            }, 60_000);
            ctx.signal?.addEventListener('abort', () => clearInterval(timer), { once: true });
        }

        await loadAndRender();
    },
};
