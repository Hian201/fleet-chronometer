// 工廠：建造紀錄、開發紀錄、改修日程三項收成側欄一個分區、三個子分頁。
// 合併理由：遊戲的工廠畫面本來就含建造／開發／改修，面板的工廠分頁也是同一結構；三項各佔側欄一格
// 只是把同一個地方拆散。本檔只管子分頁列與切換；內容仍由 build-log.ts、dev-log.ts、improve-plan.ts
// 各自的分區提供，一個子頁一檔。
//
// 切換不重建（design-guidelines §4.2）：各子頁第一次進入才 render，之後只切 hidden，
// 所以篩選條件、分頁、展開狀態與捲動位置都留著。子分頁選擇存 localStorage（鍵名 kc-factory-view，
// 與其他分區的 prefs 同慣例，不進備份），網址的 sub 參數優先；舊網址 #/build-log 等由 redirects 轉進來。
import type { OverviewSection, SectionContext } from './types';
import { t } from '@/utils/ui-i18n';
import { esc, hashParams, loadJsonPrefs, saveJsonPrefs } from '../lib';
import { buildLogSection } from './build-log';
import { devLogSection } from './dev-log';
import { improvePlanSection } from './improve-plan';

export const FACTORY_SECTION_ID = 'factory';
export const FACTORY_PREFS_KEY = 'kc-factory-view';

export const FACTORY_SUBS = [
    { key: 'build', labelKey: 'ov.facSubBuild', section: buildLogSection },
    { key: 'develop', labelKey: 'ov.facSubDevelop', section: devLogSection },
    { key: 'improve', labelKey: 'ov.facSubImprove', section: improvePlanSection },
] as const;
export type FactorySub = typeof FACTORY_SUBS[number]['key'];
/** 今天能做什麼是最常看的，沒有網址參數與偏好時先看改修。 */
export const DEFAULT_FACTORY_SUB: FactorySub = 'improve';

const isSub = (value: unknown): value is FactorySub => FACTORY_SUBS.some(sub => sub.key === value);

/** 子分頁的決定順序：網址參數 → 上次選的 → 預設。 */
export function resolveFactorySub(param: string | null, saved: unknown): FactorySub {
    if (isSub(param)) return param;
    return isSub(saved) ? saved : DEFAULT_FACTORY_SUB;
}

/** 子分頁列（純 HTML）。 */
export function factoryNavHtml(active: FactorySub): string {
    return FACTORY_SUBS.map(sub =>
        `<button type="button" role="tab" class="fa-tab" id="fa-tab-${sub.key}" data-sub="${sub.key}" aria-selected="${sub.key === active}" aria-controls="fa-page-${sub.key}">${esc(t(sub.labelKey))}</button>`).join('');
}

export const factorySection: OverviewSection = {
    id: FACTORY_SECTION_ID,
    titleKey: 'ov.factory',
    redirects: { 'build-log': 'sub=build', 'dev-log': 'sub=develop', 'improve-plan': 'sub=improve' },
    async render(el, ctx: SectionContext) {
        let active = resolveFactorySub(hashParams().get('sub'),
            loadJsonPrefs<unknown>(FACTORY_PREFS_KEY, null, raw => raw));
        el.innerHTML = `<div class="fa"><nav class="fa-nav" role="tablist" aria-label="${esc(t('ov.factory'))}">${factoryNavHtml(active)}</nav>${FACTORY_SUBS.map(sub =>
            `<div class="fa-page" id="fa-page-${sub.key}" role="tabpanel" aria-labelledby="fa-tab-${sub.key}" hidden></div>`).join('')}</div>`;
        const rendered = new Map<FactorySub, Promise<void>>();
        // 子頁自己的 render 例外只影響該子頁，顯示原因而不是留白。
        const open = (key: FactorySub) => {
            if (rendered.has(key)) return rendered.get(key)!;
            const host = el.querySelector<HTMLElement>(`#fa-page-${key}`)!;
            const sub = FACTORY_SUBS.find(item => item.key === key)!;
            const job = Promise.resolve().then(() => sub.section.render(host, ctx)).catch(error => {
                console.error(`[overview] 工廠子頁 ${key} render 失敗`, error);
                host.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            });
            rendered.set(key, job);
            return job;
        };
        const show = (key: FactorySub) => {
            active = key;
            for (const button of el.querySelectorAll<HTMLButtonElement>('.fa-tab')) button.setAttribute('aria-selected', String(button.dataset.sub === key));
            for (const sub of FACTORY_SUBS) el.querySelector<HTMLElement>(`#fa-page-${sub.key}`)!.hidden = sub.key !== key;
            return open(key);
        };
        el.querySelector('.fa-nav')!.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.fa-tab');
            if (!button || button.dataset.sub === active) return;
            const key = button.dataset.sub as FactorySub;
            void show(key);
            saveJsonPrefs(FACTORY_PREFS_KEY, key);
            // 網址跟著子頁走，之後切語言重繪才不會被舊的 sub 參數拉回去；replaceState 不觸發 hashchange。
            history.replaceState(null, '', `${location.pathname}${location.search}#/${FACTORY_SECTION_ID}?sub=${key}`);
        });
        await show(active);
    },
};
