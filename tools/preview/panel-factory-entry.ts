// panel-factory 預覽的瀏覽器端入口：以正式 mountFactoryTabs 掛在正式面板骨架上，
// 每個情境各一個 370×850 假窗，並把各情境實際量到的高度寫進 #measure 供 Node 端讀取。
import { mountFactoryTabs } from '../../entrypoints/panel/factory-today';
import { AKASHI_SCHEDULE } from '../../utils/akashi-schedule-data';
import { GameState } from '../../utils/state';
import { setLang, t } from '../../utils/ui-i18n';
import start2 from '../../samples/start2-master.json';
import port from '../../samples/slot_to_port.json';

// 語言由預覽頁在載入前寫入 window.__lang（三語各一份 html）。
const lang = (window as unknown as { __lang?: Parameters<typeof setLang>[0] }).__lang ?? 'zh-TW';
setLang(lang);
document.documentElement.lang = lang;

// 假設情境：持有的裝備只供版面預覽（sample 的 port 沒有裝備庫），艦隊取自真實封包。
// 2026-11-17（週二）12:00 JST：週二的可改修組合最多，第二艦名單也最長。
const TUESDAY = Date.UTC(2026, 10, 17, 3, 0, 0);
const WEDNESDAY = Date.UTC(2026, 10, 18, 3, 0, 0);
const scheduleDay = (weekday: number) => AKASHI_SCHEDULE.filter(([, pairs]) => pairs.some(([, bits]) => bits >> weekday & 1)).map(([mst]) => mst);

function makeState(held: Map<number, number>): GameState {
    const state = new GameState();
    state.applyEvent('api_start2/getData', start2);
    state.applyEvent('api_port/port', (port as { api_data: unknown }).api_data);
    const items: { api_id: number; api_slotitem_id: number; api_level: number; api_alv: number }[] = [];
    let id = 900000;
    for (const [mst, count] of held) for (let i = 0; i < count; i++) items.push({ api_id: id++, api_slotitem_id: mst, api_level: 0, api_alv: 0 });
    if (items.length) state.applyEvent('api_get_member/slot_item', { api_slot_item: items });
    return state;
}

const notInSchedule = [...makeState(new Map()).masterGears.keys()].filter(mst => !AKASHI_SCHEDULE.some(([id]) => id === mst));
const manyTuesday = new Map<number, number>(scheduleDay(2).slice(0, 40).map((mst, index) => [mst, index % 3 + 1]));
for (const mst of notInSchedule.slice(0, 6)) manyTuesday.set(mst, 2);
// 曜日資料待確認的裝備（AKASHI_UNCONFIRMED）
for (const mst of [305, 466, 579, 580]) manyTuesday.set(mst, 1);
const few = new Map<number, number>([[8, 1], ...scheduleDay(3).slice(0, 3).map(mst => [mst, 1] as [number, number])]);
few.set(notInSchedule[0], 1);

interface Scene { key: string; title: string; now: number; held: Map<number, number>; openNeed?: boolean; openFoot?: boolean; search?: string }
// 搜尋情境的關鍵字依語言各挑一個會命中多件的字（繁中／日文用「砲」，英文用 gun）
const GUN = lang === 'en' ? 'gun' : '砲';
const scenes: Scene[] = [
    { key: 'many', title: '週二・持有 50 種（含不能改修 6 種、待確認 4 種）', now: TUESDAY, held: manyTuesday },
    { key: 'need', title: '週二・展開「需要未持有的改修秘書艦」', now: TUESDAY, held: manyTuesday, openNeed: true },
    { key: 'foot', title: '週二・展開「資料待確認」', now: TUESDAY, held: manyTuesday, openFoot: true },
    { key: 'search', title: '週二・搜尋裝備（展開「需要未持有」）', now: TUESDAY, held: manyTuesday, openNeed: true, search: GUN },
    { key: 'search-none', title: '週二・搜尋沒有符合', now: TUESDAY, held: manyTuesday, search: 'zzzz' },
    { key: 'few', title: '週三・持有 5 種', now: WEDNESDAY, held: few },
    { key: 'none', title: '週三・只持有今天不能改修的裝備', now: WEDNESDAY, held: new Map([[8, 1]]) },
    { key: 'nodata', title: '尚未取得裝備資料', now: TUESDAY, held: new Map() },
];

const template = document.getElementById('tab-template') as HTMLTemplateElement;
const stage = document.getElementById('stage')!;
const measure: Record<string, unknown>[] = [];
for (const scene of scenes) {
    const app = document.createElement('section');
    app.className = 'pv-app';
    app.innerHTML = `<h2 class="pv-title">${scene.title}</h2><div class="pv-stub pv-top">header＋分頁列（≈70px）</div><div id="tabpanel" class="has-factory"></div><div class="pv-stub pv-bottom">編成區（其餘高度，不得被推動）</div>`;
    const panel = app.querySelector<HTMLElement>('#tabpanel')!;
    panel.append(template.content.cloneNode(true));
    const root = panel.querySelector<HTMLElement>('#tab-factory')!;
    root.style.display = '';
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
    stage.append(app);
    const render = mountFactoryTabs(root, makeState(scene.held), () => scene.now);
    render();
    root.querySelector<HTMLButtonElement>('[data-fsub="today"]')!.click();
    // 展開 <details> 後等 toggle 事件記下狀態，再 render 一次，同時驗證重畫不會把它收回去。
    for (const [wanted, selector] of [[scene.openNeed, '.fac-need'], [scene.openFoot, '.fac-unconfirmed']] as const) {
        const details = wanted ? root.querySelector<HTMLDetailsElement>(selector) : null;
        if (!details) continue;
        details.open = true;
        await new Promise(resolve => setTimeout(resolve, 0));
        render();
        if (!root.querySelector<HTMLDetailsElement>(selector)!.open) throw new Error(`${selector} 重畫後被收回`);
    }
    const list = root.querySelector<HTMLElement>('.fac-today-list')!;
    // 搜尋：點放大鏡展開、輸入關鍵字，再模擬幾次每秒 tick 的 render()，輸入值、游標、節點與展開狀態都要還在。
    const toggle = root.querySelector<HTMLButtonElement>('#factory-search-toggle')!;
    const searchRow = root.querySelector<HTMLElement>('#factory-search-row')!;
    const searchInput = root.querySelector<HTMLInputElement>('#factory-search')!;
    const searchCheck: Record<string, unknown> = { collapsedRowHeight: searchRow.offsetHeight, toggleVisible: toggle.offsetParent !== null };
    if (scene.search) {
        toggle.click();
        searchInput.value = scene.search;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.setSelectionRange(1, 1);
        const before = searchInput;
        for (let i = 0; i < 3; i++) render();
        Object.assign(searchCheck, {
            openRowHeight: searchRow.offsetHeight,
            kept: root.querySelector('#factory-search') === before && before.value === scene.search && before.selectionStart === 1 && toggle.getAttribute('aria-expanded') === 'true',
            placeholder: searchInput.placeholder, label: toggle.getAttribute('aria-label'),
            head: root.querySelector('.fac-today-title')!.textContent,
            empty: root.querySelector('.fac-today-list .empty')?.textContent ?? '',
        });
    }
    // 只量看得見的列（收合的 <details> 內不算）
    const visible = (el: HTMLElement) => el.offsetParent !== null;
    const rows = [...root.querySelectorAll<HTMLElement>('.fac-t-row')].filter(visible);
    const clipped = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)].filter(visible).filter(el => el.scrollWidth > el.clientWidth + 1).length;
    measure.push({
        scene: scene.key, ...searchCheck,
        panelHeight: panel.offsetHeight, panelScrollHeight: panel.scrollHeight,
        todayPageHeight: root.querySelector<HTMLElement>('#factory-page-today')!.offsetHeight,
        listClient: list.clientHeight, listScroll: list.scrollHeight,
        rowCount: rows.length, wrappedRows: rows.filter(row => row.offsetHeight > 26).length, maxRowHeight: Math.max(0, ...rows.map(row => row.offsetHeight)),
        footHeight: root.querySelector<HTMLElement>('.fac-today-foot')!.offsetHeight,
        truncatedRows: rows.filter(row => [...row.querySelectorAll<HTMLElement>('.fac-t-name, .fac-t-ships, .fac-h')].some(el => el.scrollWidth > el.clientWidth + 1)).length, headOverflow: clipped('.fac-today-title'),
        sideOverlap: rows.filter(row => row.querySelector('.fac-t-side') && row.querySelector('.fac-t-gear')!.getBoundingClientRect().right > row.querySelector('.fac-t-side')!.getBoundingClientRect().left).length,
    });
}
// 預覽頁在 .preview/ 下，絕對路徑的圖示要改指到 public/。
// Esc 收起即清空：用最後一個搜尋情境驗證（收起後輸入框為空、放大鏡 aria-expanded=false、清單回到未篩選）
{
    const app = [...stage.children].find(el => el.querySelector('.pv-title')!.textContent!.includes('搜尋裝備'))!;
    const input = app.querySelector<HTMLInputElement>('#factory-search')!;
    const listEl = app.querySelector<HTMLElement>('.fac-today-list')!;
    const rowsBefore = app.querySelectorAll('.fac-today-list .fac-t-row').length;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    measure.push({ scene: 'esc', escCleared: input.value === '' && app.querySelector<HTMLElement>('#factory-search-row')!.hidden && app.querySelector('#factory-search-toggle')!.getAttribute('aria-expanded') === 'false', rowsBefore, rowsAfter: listEl.querySelectorAll('.fac-t-row').length });
    // 量完 Esc 再把這個情境還原成「搜尋中」：存下來的預覽頁要看得到篩選後的樣子，不是被清空的樣子。
    app.querySelector<HTMLButtonElement>('#factory-search-toggle')!.click();
    input.value = GUN;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
document.querySelectorAll<HTMLImageElement>('img[src^="/icons/"]').forEach(img => { img.src = `../public${img.getAttribute('src')}`; });
document.getElementById('measure')!.textContent = JSON.stringify(measure);
