// 戰果分區（1b 內容）：依 db.resources（普通戰果）、db.sorties（EO 擊破）與 db.questObserved（任務戰果）
// 呈現本月已觀測戰果（不含繼承分）、EO 擊破清單、任務戰果清單與截止倒數。
// HTML 建構器 renderSenkaSectionBodyHtml 純函式匯出，供離線預覽直接共用。
//
// 重繪守則（design-guidelines §4.2 / §4.2.1）：
// 先同步畫出外殼並綁好工具列 checkbox 與 storage 同步，再非同步查詢 DB；
// 後續即時更新、譯文到達與每分鐘倒數只覆寫 #sk-body 並保留 <details> 展開／收合狀態，絕不重建工具列與 checkbox。

import type { OverviewSection, SectionContext } from './types';
import { db } from '@/utils/db';
import type { Lang } from '@/utils/gamedata-i18n';
import { esc } from '@/utils/html-escape';
import {
    loadQuestCatalogLocale, localizedQuestName, questCatalogLocaleLoaded,
} from '@/utils/quest-catalog-localization';
import { questSenkaCatalogEntry } from '@/utils/quest-senka';
import { senkaMonthOf, type RegularSenkaResult, type SenkaMonth } from '@/utils/senka';
import { loadSenkaMonthData, type SenkaMonthData } from '@/utils/senka-readings';
import {
    buildObservedSenkaSummary, formatObservedGainValue, formatObservedSenkaValue,
    formatQuestItemPoints, formatQuestSenkaValue, formatRegularPartValue,
    formatSenkaInt, formatSignedSenka, senkaDeadlineLines,
    type SenkaObservedSummary,
} from '@/utils/senka-view';
import { getLang, t, tFor } from '@/utils/ui-i18n';
import { getSenkaHeaderPinned, persistSenkaHeaderPinned, SENKA_HEADER_KEY } from '@/utils/ui-prefs';

const HINT_KEYS: Partial<Record<RegularSenkaResult['status'], string>> = {
    range: 'ov.skReconNote',
    'no-start': 'senka.noStart',
    'no-data': 'senka.noData',
    anomaly: 'senka.anomaly',
};

const REFRESH_PATHS = new Set(['api_port/port', 'api_get_member/mapinfo', 'api_req_quest/clearitemget']);

function kvRowHtml(label: string, value: string): string {
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd><dd class="n"></dd>`;
}

function isFoldOpen(el: Element | null, fallback = true): boolean {
    if (!el) return fallback;
    const openProp = (el as HTMLDetailsElement).open;
    return typeof openProp === 'boolean' ? openProp : el.hasAttribute('open');
}

/** 依 1b 已觀測戰果摘要建構主卡片與 EO／任務卡片 HTML（純函式，供分區與離線預覽共用）。 */
export function renderSenkaSectionBodyHtml(
    summary: SenkaObservedSummary,
    lang: Lang = getLang(),
    opts?: { foldOpen?: { eo?: boolean; quest?: boolean } },
): string {
    const { regular, eo, quest } = summary;
    const totalVal = formatObservedSenkaValue(summary, lang);
    const hasTotal = regular.status === 'exact' || regular.status === 'range';
    const hintKey = HINT_KEYS[regular.status];
    const hintHtml = hintKey ? `<p class="sk-hint">${esc(tFor(lang, hintKey))}</p>` : '';

    const compHtml = `<dl class="sk-kv sk-sep">`
        + kvRowHtml(tFor(lang, 'ov.skPartCarry'), '—')
        + kvRowHtml(tFor(lang, 'senka.partRegular'), formatRegularPartValue(regular, lang))
        + kvRowHtml(tFor(lang, 'senka.partEo'), formatSenkaInt(eo.total, lang))
        + kvRowHtml(tFor(lang, 'senka.partQuest'), formatQuestSenkaValue(quest, lang))
        + `</dl>`;

    let gainHtml = '';
    if (regular.status === 'exact' || regular.status === 'range') {
        const todayVal = summary.today === null ? '—' : formatSignedSenka(summary.today, lang);
        gainHtml = `<dl class="sk-kv sk-sep">${kvRowHtml(tFor(lang, 'senka.today'), todayVal)}</dl>`;
    } else if (regular.status === 'no-start') {
        const rows = [kvRowHtml(tFor(lang, 'senka.observed'), formatObservedGainValue(summary, lang))];
        if (summary.today !== null) {
            rows.push(kvRowHtml(tFor(lang, 'senka.today'), formatSignedSenka(summary.today, lang)));
        }
        gainHtml = `<dl class="sk-kv sk-sep">${rows.join('')}</dl>`;
    }

    const closesHtml = senkaDeadlineLines(summary.deadlines, lang, { includeQuest: true })
        .map(line => `<span>${esc(line)}</span>`)
        .join('');

    const monthCard = `<section class="sk-card" id="sk-month">`
        + `<h3>${esc(tFor(lang, `senka.month${summary.month.month}`))}</h3>`
        + `<div class="sk-total">`
        + `<span class="sk-tl">${esc(tFor(lang, 'ov.skObserved'))}</span>`
        + `<span class="sk-tv">${esc(totalVal)}${hasTotal ? ` <small>${esc(tFor(lang, 'ov.skExclCarry'))}</small>` : ''}</span>`
        + `</div>`
        + compHtml
        + hintHtml
        + gainHtml
        + `<div class="sk-sep sk-closes">${closesHtml}</div>`
        + `</section>`;

    const eoOpen = opts?.foldOpen?.eo ?? true;
    const questOpen = opts?.foldOpen?.quest ?? true;
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

    const eoCard = `<section class="sk-card" id="sk-eo">`
        + `<h3>${esc(tFor(lang, 'ov.skEoQuestTitle'))}</h3>`
        + eoFoldHtml
        + questFoldHtml
        + `</section>`;

    return `${monthCard}${eoCard}`;
}

function sameMonth(a: SenkaMonth, b: SenkaMonth): boolean {
    return a.year === b.year && a.month === b.month;
}

export const senkaSection: OverviewSection = {
    id: 'senka',
    titleKey: 'ov.senka',
    async render(container: HTMLElement, ctx: SectionContext) {
        const pinned = getSenkaHeaderPinned();
        container.innerHTML = `<div class="sk" id="sk" data-stage="1">`
            + `<p class="ov-note">${esc(t('ov.skNoteObserved'))}</p>`
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
        let cachedData: SenkaMonthData | null = null;
        let cachedMonth: SenkaMonth | null = null;

        function renderBody(summary: SenkaObservedSummary) {
            const eoFold = bodyEl.querySelector('details[data-fold="eo"]');
            const questFold = bodyEl.querySelector('details[data-fold="quest"]');
            const foldOpen = eoFold && questFold
                ? { eo: isFoldOpen(eoFold), quest: isFoldOpen(questFold) }
                : undefined;
            bodyEl.innerHTML = renderSenkaSectionBodyHtml(summary, getLang(), foldOpen ? { foldOpen } : undefined);
        }

        function ensureQuestLocale(lang: Lang) {
            if (lang === 'ja' || questCatalogLocaleLoaded(lang)) return;
            void loadQuestCatalogLocale(lang).then(() => {
                if (ctx.signal?.aborted || !container.isConnected || !cachedData) return;
                renderBody(buildObservedSenkaSummary(cachedData, Date.now()));
            }).catch(() => { /* 載入失敗維持日文任務名，不阻斷其餘資訊。 */ });
        }

        ensureQuestLocale(getLang());

        async function loadAndRender() {
            if (ctx.signal?.aborted || !container.isConnected) return;
            const myGen = ++loadGen;
            const now = Date.now();
            const month = senkaMonthOf(now);
            try {
                const data = await loadSenkaMonthData(db, month);
                if (ctx.signal?.aborted || !container.isConnected || myGen !== loadGen) return;
                cachedData = data;
                cachedMonth = month;
                const lang = getLang();
                renderBody(buildObservedSenkaSummary(data, Date.now()));
                ensureQuestLocale(lang);
            } catch (err) {
                if (ctx.signal?.aborted || !container.isConnected || myGen !== loadGen) return;
                cachedData = null;
                cachedMonth = null;
                bodyEl.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((err as Error)?.message ?? err) }))}</div>`;
            }
        }

        ctx.onStateChange?.(paths => {
            if (paths.some(path => REFRESH_PATHS.has(path))) void loadAndRender();
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
                } else if (cachedData) {
                    renderBody(buildObservedSenkaSummary(cachedData, now));
                }
            }, 60_000);
            ctx.signal?.addEventListener('abort', () => clearInterval(timer), { once: true });
        }

        await loadAndRender();
    },
};
