// 工廠分頁的「今日改修」子頁：玩家持有的裝備裡，今天（日本時間 0 點換表）能改修者與可用的改修秘書艦。
// 主清單只放「現在就動得了」的裝備（明石單獨，或持有至少一艘可用的改修秘書艦）；需要未持有改修秘書艦的
// 收進清單下方的 <details>。查表邏輯全在 utils/akashi-schedule.ts（純函式），本檔只負責 HTML 與子分頁切換。
//
// 重繪（design-guidelines §4.2）：標頭、清單、底部三塊各自只在內容改變時才換 innerHTML，
// 清單的捲動位置與 <details> 的展開狀態才不會被每秒的 tick 洗掉。
import type { GameState } from '@/utils/state';
import { akashiToday, akashiUnconfirmed, jstWeekday, type AkashiTodayRow } from '@/utils/akashi-schedule';
import { groupHelpers, heldGearCounts, ownedShipMasterIds } from '@/utils/akashi-owned';
import { esc, gearIconHtml } from '@/utils/html-escape';
import { gearMatchesQuery } from '@/utils/gamedata-i18n';
import { t } from '@/utils/ui-i18n';

/** 右側最多直接顯示幾艘改修秘書艦；其餘只收進 title，列高不因艦名多寡而變。 */
export const TODAY_HELPER_LIMIT = 3;

type SubPage = 'live' | 'today';
export interface TodayOpen { need?: boolean; unconfirmed?: boolean }
interface TodayView { head: string; list: string; foot: string }

/** 一列：左側圖示＋名稱＋持有數，右側明石單獨徽章或改修秘書艦。only 為 owned 時只列持有的艦。 */
function rowHtml(state: GameState, row: AkashiTodayRow, only: 'owned' | 'all'): string {
    const name = state.gearName(row.gearMst);
    const left = `<span class="fac-t-gear" title="${esc(name)}">${gearIconHtml(state.gearIconId(row.gearMst), '')}<span class="fac-t-name">${esc(name)}</span></span><span class="fac-t-held">×${row.held}</span>`;
    if (row.solo) return `<div class="fac-t-row">${left}<span class="fac-t-side"><span class="fac-solo" title="${esc(t('factory.todaySoloTitle'))}">${esc(t('factory.todaySolo'))}</span></span></div>`;
    const names = groupHelpers(row.helpers).filter(group => only === 'all' || group.owned)
        .map(group => ({ text: state.shipName(group.shown), owned: group.owned }));
    const shown = names.slice(0, TODAY_HELPER_LIMIT);
    const more = names.length - shown.length;
    const title = t('factory.todayHelperTitle', { names: names.map(item => item.text).join(t('ui.listSep')) });
    return `<div class="fac-t-row">${left}<span class="fac-t-side" title="${esc(title)}"><span class="fac-t-ships">${shown.map(item =>
        `<span class="fac-h${item.owned ? '' : ' off'}">${esc(item.text)}</span>`).join('')}</span>${more > 0 ? `<span class="fac-more">+${more}</span>` : ''}</span></div>`;
}

/** 「今日改修」三塊的 HTML。now 以毫秒時間戳傳入，方便測試與預覽固定曜日。
 *  query 是裝備名搜尋（繁中／日文／英文），主清單、「需要未持有」摺疊與底部「資料待確認」都套同一個條件。 */
export function factoryTodayView(state: GameState, now: number, open: TodayOpen = {}, query = ''): TodayView {
    const weekday = jstWeekday(now);
    const day = t(`factory.todayDay${weekday}`);
    const held = heldGearCounts(state);
    if (held.size === 0) {
        return { head: esc(day), list: `<div class="empty">${esc(t('factory.todayNoData'))}</div>`, foot: '' };
    }
    const searching = query.trim() !== '';
    const matches = (mst: number) => gearMatchesQuery(mst, state.gearNameJa(mst), query);
    const all = akashiToday(weekday, held, ownedShipMasterIds(state)).filter(row => matches(row.gearMst));
    const ready = all.filter(row => row.solo || row.helpers.some(helper => helper.owned));
    const blocked = all.filter(row => !ready.includes(row));
    const emptyText = t(searching ? 'factory.todayNoMatch' : blocked.length ? 'factory.todayNoneNow' : 'factory.todayNone');
    const unconfirmed = akashiUnconfirmed(held).filter(matches);
    const unconfirmedCount = unconfirmed.reduce((sum, mst) => sum + (held.get(mst) ?? 0), 0);
    return {
        head: esc(t(searching ? 'factory.todayHeadMatch' : 'factory.todayHead', { day, n: ready.length })),
        list: (ready.length ? ready.map(row => rowHtml(state, row, 'owned')).join('') : `<div class="empty">${esc(emptyText)}</div>`)
            + (blocked.length ? `<details class="fac-need"${open.need ? ' open' : ''}><summary>${esc(t('factory.todayNeedHelper', { n: blocked.length }))}</summary>${blocked.map(row => rowHtml(state, row, 'all')).join('')}</details>` : ''),
        foot: unconfirmedCount ? `<details class="fac-unconfirmed"${open.unconfirmed ? ' open' : ''}><summary title="${esc(t('factory.todayUnconfirmedTitle'))}">${esc(t('factory.todayUnconfirmed', { n: unconfirmedCount }))}</summary><div class="fac-unconfirmed-list">${unconfirmed.map(mst =>
            `<span>${esc(state.gearName(mst))} ×${held.get(mst)}</span>`).join('')}</div></details>` : '',
    };
}

/**
 * 掛上工廠分頁的子分頁（看板／今日改修）。回傳 render：看板內容仍由 main.ts 的 renderFactoryLive 畫，
 * 這裡只管子分頁列、顯示哪一頁，以及「今日改修」的內容。
 */
export function mountFactoryTabs(root: HTMLElement, state: GameState, now: () => number = Date.now) {
    const nav = root.querySelector<HTMLElement>('.fac-nav')!;
    const pages: Record<SubPage, HTMLElement> = {
        live: root.querySelector<HTMLElement>('#factory-page-live')!,
        today: root.querySelector<HTMLElement>('#factory-page-today')!,
    };
    const title = root.querySelector<HTMLElement>('.fac-today-title')!;
    const list = root.querySelector<HTMLElement>('.fac-today-list')!;
    const foot = root.querySelector<HTMLElement>('.fac-today-foot')!;
    // 搜尋框與放大鏡都是外殼：不在每秒重畫的區塊內，輸入值、游標與展開狀態才不會被洗掉。
    const searchToggle = root.querySelector<HTMLButtonElement>('#factory-search-toggle')!;
    const searchRow = root.querySelector<HTMLElement>('#factory-search-row')!;
    const search = root.querySelector<HTMLInputElement>('#factory-search')!;
    let sub: SubPage = 'live';
    const open: TodayOpen = {};
    const painted = { nav: '', head: '', list: '', foot: '' };
    // 內容相同就不動 DOM：保住清單捲動位置，也不打斷 <details> 的互動。
    const paint = (el: HTMLElement, key: keyof typeof painted, html: string) => {
        if (painted[key] === html) return;
        painted[key] = html;
        el.innerHTML = html;
    };
    const setAttr = (el: HTMLElement, name: string, value: string) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };

    function render() {
        paint(nav, 'nav', (['live', 'today'] as const).map(key =>
            `<button type="button" data-fsub="${key}" role="tab" aria-selected="${key === sub}">${esc(t(key === 'live' ? 'factory.todayNavLive' : 'factory.todayNavToday'))}</button>`).join(''));
        for (const key of ['live', 'today'] as const) pages[key].hidden = key !== sub;
        // 搜尋只對「今日改修」有效，看板頁不顯示放大鏡。
        searchToggle.hidden = sub !== 'today';
        const label = t(searchRow.hidden ? 'factory.searchOpen' : 'factory.searchClose');
        setAttr(searchToggle, 'aria-label', label);
        setAttr(searchToggle, 'title', label);
        setAttr(searchToggle, 'aria-expanded', String(!searchRow.hidden));
        setAttr(search, 'placeholder', t('factory.searchPlaceholder'));
        setAttr(search, 'aria-label', t('factory.searchLabel'));
        if (sub !== 'today') return;
        const view = factoryTodayView(state, now(), open, search.value);
        paint(title, 'head', view.head);
        paint(list, 'list', view.list);
        paint(foot, 'foot', view.foot);
    }
    // 搜尋列平時收起；收起即清空條件，避免看不見的篩選殘留（同道具搜尋列）。
    function setSearchOpen(wanted: boolean, focus = true) {
        searchRow.hidden = !wanted;
        if (!wanted) search.value = '';
        render();
        if (focus) (wanted ? search : searchToggle).focus();
    }
    searchToggle.addEventListener('click', () => setSearchOpen(searchRow.hidden));
    search.addEventListener('input', render);
    search.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        setSearchOpen(false);
    });
    nav.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-fsub]');
        if (!button) return;
        sub = button.dataset.fsub as SubPage;
        // 離開「今日改修」時一併收起搜尋，回來不會帶著看不見的條件。
        if (sub !== 'today' && !searchRow.hidden) setSearchOpen(false, false);
        else render();
    });
    // toggle 不冒泡，用 capture 在容器上接；開合狀態記在這裡，內容重畫時才還得回來。
    // 已畫上的字串也跟著改 open 屬性，與 DOM 一致：否則下一秒的 tick 會因字串不同而整塊重寫，捲動位置與焦點就丟了。
    const syncOpen = (key: 'list' | 'foot', cls: string, isOpen: boolean) => {
        const shut = `<details class="${cls}">`, opened = `<details class="${cls}" open>`;
        painted[key] = painted[key].replace(isOpen ? shut : opened, isOpen ? opened : shut);
    };
    const remember = (event: Event) => {
        const details = event.target as HTMLDetailsElement;
        if (details.classList.contains('fac-need')) { open.need = details.open; syncOpen('list', 'fac-need', details.open); }
        else if (details.classList.contains('fac-unconfirmed')) { open.unconfirmed = details.open; syncOpen('foot', 'fac-unconfirmed', details.open); }
    };
    list.addEventListener('toggle', remember, true);
    foot.addEventListener('toggle', remember, true);
    return render;
}
