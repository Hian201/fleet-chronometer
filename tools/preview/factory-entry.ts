// factory 預覽的瀏覽器端入口：以正式 factorySection（含正式 build-log／dev-log／improve-plan 子頁）
// 與正式 normalizeHash 轉向在真實 IndexedDB（Dexie）上跑，檢查子分頁、舊網址轉向與切換時的狀態保留。
// 資料：samples 的真實 master／port；工廠紀錄、持有裝備都是預覽專用的假資料。
// headless 的虛擬時間下真實 IndexedDB 不會前進，預覽改用記憶體實作
import 'fake-indexeddb/auto';
import { db, type FactoryLogRow } from '../../utils/db';
import { GameState } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';
import { AKASHI_SCHEDULE } from '../../utils/akashi-schedule-data';
import { normalizeHash } from '../../entrypoints/overview/routes';
import { factorySection } from '../../entrypoints/overview/sections/factory';
import type { SectionContext } from '../../entrypoints/overview/sections/types';
import start2 from '../../samples/start2-master.json';
import port from '../../samples/slot_to_port.json';

const lang = (window as unknown as { __lang?: Parameters<typeof setLang>[0] }).__lang ?? 'zh-TW';
setLang(lang);
document.documentElement.lang = lang;
const width = Number(new URLSearchParams(location.search).get('w')) || 1166;

const NOW = Date.UTC(2026, 10, 17, 3, 0, 0);
const state = new GameState();
state.applyEvent('api_start2/getData', start2);
state.applyEvent('api_port/port', (port as { api_data: unknown }).api_data);
const heldMasters = AKASHI_SCHEDULE.slice(0, 30).map(([mst]) => mst);
state.applyEvent('api_get_member/slot_item', {
    api_slot_item: heldMasters.map((mst, index) => ({ api_id: 900000 + index, api_slotitem_id: mst, api_level: 0, api_alv: 0 })),
});

// 假資料：建造／開發／改修紀錄各若干筆
const ships = state.ownedShips().slice(0, 16).map(ship => ship.masterId);
const rows: FactoryLogRow[] = [];
let eventId = 1;
for (let i = 0; i < 14; i++) rows.push({ eventId: eventId++, ts: NOW - i * 3_600_000, kind: 'build', used: [30, 30, 30, 30, 1, 0, 0, 0], secretary: ships[i % 4], hqLv: 120, shipMst: ships[i] });
for (let i = 0; i < 14; i++) rows.push({ eventId: eventId++, ts: NOW - i * 5_400_000, kind: 'develop', used: [10, 30, 30, 10, 0, 0, 1, 0], secretary: ships[i % 4], results: [{ mst: i % 5 ? heldMasters[i] : -1 }] });
for (let i = 0; i < 10; i++) rows.push({ eventId: eventId++, ts: NOW - i * 86_400_000, kind: 'improve', used: [0, 0, 0, 0, 0, 0, 3, 1], secretary: ships[0], gearMst: heldMasters[i % 8], success: i % 3 !== 0, certain: i % 4 === 0, levelBefore: 1, levelAfter: 2 });
document.title = 'stage:db';
await db.factory.clear();
await db.factory.bulkPut(rows);

// 以「合併前的分區 id＋工廠」模擬登錄表：舊網址轉向走正式的 normalizeHash
const sections = [{ id: 'fleet-overview' }, factorySection];
const initialHash = location.hash;
const routeId = normalizeHash(sections);
const ctx: SectionContext = { rerender() { }, state, reloadState: async () => { }, onStateChange() { } };
const host = document.createElement('div');
host.className = 'ov-section-host';
document.getElementById('frame')!.style.width = `${width}px`;
document.getElementById('frame')!.append(host);
document.title = 'stage:render';
await factorySection.render(host, ctx);
document.title = 'stage:rendered';
await new Promise(resolve => setTimeout(resolve, 300));

const activeTab = () => host.querySelector('.fa-tab[aria-selected="true"]')?.textContent ?? '';
const visiblePage = () => [...host.querySelectorAll<HTMLElement>('.fa-page')].filter(page => !page.hidden).map(page => page.id).join(',');
const measure: Record<string, unknown> = {
    width, initialHash, routeId, hashAfter: location.hash, activeTab: activeTab(), visiblePage: visiblePage(),
    tabs: host.querySelectorAll('.fa-tab').length,
    // 子頁惰性 render：只有目前這一頁有內容
    renderedPages: [...host.querySelectorAll<HTMLElement>('.fa-page')].filter(page => page.childElementCount > 0).map(page => page.id).join(','),
    tableRows: host.querySelectorAll('.fa-page:not([hidden]) tbody tr').length,
};

// 改修子頁的版面（雙欄或單欄）
const ip = host.querySelector<HTMLElement>('.ip');
if (ip) {
    const main = ip.querySelector<HTMLElement>('.ip-main')!, side = ip.querySelector<HTMLElement>('.ip-side')!;
    measure.improveLayout = `${ip.clientWidth}px ${main.offsetTop === side.offsetTop ? '雙欄' : '單欄'} main ${main.clientWidth} side ${side.clientWidth}`;
}
// 切換不重建：在改修子頁的搜尋框打字 → 切到開發 → 切回改修，輸入與結果數要還在
const click = (sub: string) => host.querySelector<HTMLButtonElement>(`.fa-tab[data-sub="${sub}"]`)!.click();
if (host.querySelector('.ip-search')) {
    const search = host.querySelector<HTMLInputElement>('.ip-search')!;
    search.value = 'Gun';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const before = host.querySelector('.ip-count')!.textContent;
    const searchNode = search;
    click('develop');
    const developHash = location.hash;
    const developSaved = localStorage.getItem('kc-factory-view');
    await new Promise(resolve => setTimeout(resolve, 200));
    const developRows = host.querySelectorAll('.fa-page:not([hidden]) tbody tr').length;
    click('improve');
    measure.switchKeepsState = host.querySelector('.ip-search') === searchNode && searchNode.value === 'Gun' && host.querySelector('.ip-count')!.textContent === before;
    measure.afterClickHash = developHash;
    measure.afterClickSaved = developSaved;
    measure.developRows = developRows;
}

document.getElementById('measure')!.textContent = JSON.stringify(measure);
