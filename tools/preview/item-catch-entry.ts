// item-catch 預覽的瀏覽器端入口：以正式 dropLogSection（含道具捕撈子頁）在記憶體 IndexedDB 上跑。
// 資料：samples 的真實 master／port；出擊紀錄、道具掉落與持有數都是預覽專用的假資料。
// 情境由網址參數選：?scene=default|empty|unknown|error，open=1 展開第一個大海域與海域，sub=ship 看艦娘打撈。
import 'fake-indexeddb/auto';
import { db, type SortieLogRow } from '../../utils/db';
import { GameState } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';
import { latestSeason } from '../../utils/catch-season';
const CATCH_SEASON_START = latestSeason().start;
import { dropLogSection } from '../../entrypoints/overview/sections/drop-log';
import type { SectionContext } from '../../entrypoints/overview/sections/types';
import start2 from '../../samples/start2-master.json';
import port from '../../samples/slot_to_port.json';
import '../../utils/state-display';

const lang = (window as unknown as { __lang?: Parameters<typeof setLang>[0] }).__lang ?? 'zh-TW';
setLang(lang);
document.documentElement.lang = lang;
const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'default';
const width = Number(params.get('w')) || 1166;

const state = new GameState();
state.applyEvent('api_start2/getData', start2);
state.applyEvent('api_port/port', (port as { api_data: unknown }).api_data);
if (scene === 'default') state.applyEvent('api_get_member/useitem', [{ api_id: 68, api_count: 37 }]);

const H = 3_600_000;
// 統計預設只算最新一季開始之後；把預覽的「現在」固定在開始後 16 天，
// 假資料才落在期間內。400 小時前的匯入列刻意落在起點之前，用來確認會被排除。
const NOW = CATCH_SEASON_START + 16 * 24 * H;
Date.now = () => NOW;
const rows: SortieLogRow[] = [];
let id = 1;
const add = (map: string, node: number, rank: string, ago: number, drops: number[] | undefined, sortieKey = id, extra: Partial<SortieLogRow> = {}) => {
    const row: SortieLogRow = {
        eventId: id++, sortieKey, ts: NOW - ago * H, map, node, boss: false, kind: 'battle', rank,
        seiku: null, enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false, ...extra,
    };
    if (drops) row.useItemDrops = drops;
    rows.push(row);
};
if (scene === 'default') {
    // 1-4：一趟兩個漁點；3-3／3-5 同大海域；5-4 從未捕獲；其他道具 69；舊紀錄不可考
    for (let i = 0; i < 18; i++) {
        const key = 1000 + i;
        add('1-4', 6, i % 3 ? 'S' : 'A', 40 - i * 2, i % 4 === 0 ? [68] : [], key);
        add('1-4', 10, 'S', 40 - i * 2 - 0.1, i % 5 === 0 ? [68, 68] : [], key);
    }
    for (let i = 0; i < 9; i++) add('3-3', 3, 'S', 30 - i * 3, i === 2 || i === 4 ? [68] : []);
    for (let i = 0; i < 6; i++) add('3-5', 5, i % 2 ? 'B' : 'S', 20 - i, i === 5 ? [69] : []);
    for (let i = 0; i < 5; i++) add('3-3', 3, 'S', 200 + i, undefined);
    add('3-3', 3, 'S', 5, undefined);
    for (let i = 0; i < 4; i++) add('5-4', 2, 'S', 10 + i, []);
    for (let i = 0; i < 3; i++) add('62-3', 7, 'A', 50 + i, [68]);
    add('1-4', 6, 'S', 400, undefined, 999, { imported: true });
    add('1-4', 10, 'S', 3, [68], 2000, { drop: '雪風', dropMst: 20 });
    // 不記錄的 1-1 在「仍統計道具掉落」開啟時寫的列：道具捕撈要算，艦娘打撈不得出現
    for (let i = 0; i < 8; i++) add('1-1', 1, 'S', 4 + i, i % 3 ? [] : [68], 3000 + i, { catchOnly: true, ...(i === 0 ? { drop: '睦月', dropMst: 1 } : {}) });
} else if (scene === 'unknown') {
    for (let i = 0; i < 6; i++) add('1-4', 6, 'S', 10 + i, undefined);
}
await db.sorties.clear();
await db.sorties.bulkPut(rows);
if (scene === 'error') {
    (db.sorties as unknown as { toArray: () => Promise<never> }).toArray = () => Promise.reject(new Error('preview: 模擬讀取失敗'));
}
try {
    localStorage.setItem('kc-sortie-exclude-maps', JSON.stringify(scene === 'default' ? ['1-1', '1-5'] : []));
    localStorage.setItem('kc-sortie-exclude-catch', params.get('catch') === '1' ? '1' : '0');
    // 自訂換海域提醒：alert=1 設好「6 小時 2 條」並展開設定；alert=bad 是勾了但沒填
    if (params.get('alert') === '1') localStorage.setItem('kc-catch-alert', JSON.stringify({ enabled: true, itemId: 68, hours: 6, count: 2 }));
    else localStorage.removeItem('kc-catch-alert');
    // season=inferred：本季結束已由回收推算（30 小時前最後一次捕獲、2 小時前重新登入時已回收）
    if (params.get('season') === 'inferred') localStorage.setItem('kc-catch-season-end', JSON.stringify({ [latestSeason().id]: { after: NOW - 30 * H, before: NOW - 2 * H } }));
    else localStorage.removeItem('kc-catch-season-end');
    // season=user：玩家自填結束時刻（優先於推算）
    if (params.get('season') === 'user') localStorage.setItem('kc-catch-season-user-end', JSON.stringify({ [latestSeason().id]: NOW - 2 * H }));
    else localStorage.removeItem('kc-catch-season-user-end');
    // dc=panel：爆雷提醒已從面板關閉
    if (params.get('dc') === 'panel') localStorage.setItem('kc-dc-reminder-off', JSON.stringify({ season: CATCH_SEASON_START, from: 'panel' }));
    else localStorage.removeItem('kc-dc-reminder-off');
} catch { /* 預覽 */ }
history.replaceState(null, '', `${location.pathname}${location.search}#/drop-log?sub=${params.get('sub') ?? 'item'}`);

const ctx: SectionContext = { rerender() { }, state, reloadState: async () => { }, onStateChange() { } };
const host = document.createElement('div');
host.className = 'ov-section-host';
document.getElementById('frame')!.style.width = `${width}px`;
document.getElementById('frame')!.append(host);
await dropLogSection.render(host, ctx);
await new Promise(resolve => setTimeout(resolve, 300));
if (params.get('open') === '1') {
    host.querySelector<HTMLDetailsElement>('.ic-area')?.setAttribute('open', '');
    host.querySelector<HTMLDetailsElement>('.ic-map')?.setAttribute('open', '');
    // 切換道具再切回：展開狀態要還在
    const sel = host.querySelector<HTMLSelectElement>('.ic-item')!;
    sel.value = '69'; sel.dispatchEvent(new Event('change'));
    sel.value = '68'; sel.dispatchEvent(new Event('change'));
}
if (params.get('alert')) host.querySelector<HTMLDetailsElement>('.ic-alert')?.setAttribute('open', '');
if (params.get('alert') === 'bad') {
    const on = host.querySelector<HTMLInputElement>('.ic-alert-on')!;
    on.checked = true; on.dispatchEvent(new Event('change'));
}
const grid = host.querySelector<HTMLElement>('.ic-grid');
document.getElementById('measure')!.textContent = JSON.stringify({
    scene, width,
    activeTab: host.querySelector('.fa-tab[aria-selected="true"]')?.textContent ?? '',
    areas: host.querySelectorAll('.ic-area').length,
    shipRows: host.querySelectorAll('.dl-table tbody tr').length,
    openKept: host.querySelectorAll('details[open]').length,
    gridOverflow: grid ? grid.scrollWidth > grid.clientWidth : null,
    summary: host.querySelector('.ic-summary')?.textContent?.replace(/\s+/g, ' ').trim(),
    excludedNote: host.querySelector('.ic-excluded')?.textContent ?? '',
    alertHits: host.querySelectorAll('.ic-alert-hit').length,
    alertInvalid: !host.querySelector<HTMLElement>('.ic-alert-invalid')?.hidden,
    body: host.querySelector('.ic-body > .ov-empty, .ic-body > .ov-note')?.textContent ?? '',
});
