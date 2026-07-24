// 艦隊全覽分區的**離線版面預覽產生器**（開發用，不進擴充 bundle）。
//
// 為什麼需要它：這次改版的核心是「縱向具名裝備清單＋每艘船折疊」的版面密度，
// 只有真實資料（六艘滿編、五六格裝備）才看得出實際高度與換行狀況，同 sortie-log.ts
// 的離線預覽動機。艦隊資料直接吃 samples/slot_to_port.json（真實封包，4 隊多數 6 艦
// 滿編）；**基地航空隊沒有現成樣本**（見 CLAUDE.md 待辦，本專案尚未取得
// api_get_member/base_air_corps 真實封包），故用**有依據的合成資料**——裝備 id 取自
// samples/start2-master.json 真實存在的「一式陸攻」系列（21=陸攻類），三個基地分屬
// 不同海域，驗證「不同海域各自標示」與「LBAS 不採右側欄、往下排」這兩點版面決定。
//
//   npx vite-node --config vitest.config.ts tools/preview/fleet-overview.ts
//   → .preview/fleet-overview{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GameState } from '../../utils/state';
import { fleetHtml, baseHtml } from '../../entrypoints/overview/sections/fleet-overview';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const master = readJson('samples/start2-master.json');
const port = readJson('samples/slot_to_port.json');

const state = new GameState();
setLang('zh-TW');
state.applyEvent('api_start2/getData', master);

// samples/slot_to_port.json 的全部 427 艦是 api_slot 皆為 -1 的「無裝備」快照（該樣本
// 原本是為了驗證槽位/國籍篩選才取的，見 CLAUDE.md「鎮守府全船篩選」）——裝備清單版面
// 因此需要另外注入幾組真實 master id 的裝備才看得出縱向清單的實際樣子（含超長全名
// 的省略號、改修星、補強增設）。只動第1艦隊前兩個槽位的艦（用 deck_port 的實例 id
// 反查，不能假設 api_ship 陣列順序＝deck 順序——兩者互不相干）。
const fleet1Ids: number[] = port.api_data.api_deck_port[0].api_ship.filter((id: number) => id > 0);
const shipById = new Map<number, any>(port.api_data.api_ship.map((s: any) => [s.api_id, s]));
shipById.get(fleet1Ids[0]).api_slot = [90101, 90102, -1, -1, -1];
shipById.get(fleet1Ids[0]).api_slot_ex = 90103;
shipById.get(fleet1Ids[1]).api_slot = [90104, -1, -1, -1, -1];
state.applyEvent('api_port/port', port.api_data);

// 合成三個基地：分屬本土（area 6）、南西諸島（area 7）、與一個活動海域（area 62，
// 與 samples/ 既有活動樣本同一次活動）——驗證海域名稱正確區分、且合成資料不影響
// 真實艦隊部分的正確性。裝備 id 168/169/170 皆為真實一式陸攻系列（見檔頭）。
state.applyEvent('api_get_member/base_air_corps', [
    {
        api_area_id: 6, api_rid: 1, api_name: '第1航空隊', api_action_kind: 1,
        api_distance: { api_base: 6, api_bonus: 2 },
        api_plane_info: [
            { api_slotid: 90001, api_state: 1, api_count: 18, api_max_count: 18, api_cond: 1 },
            { api_slotid: 90002, api_state: 1, api_count: 16, api_max_count: 18, api_cond: 2 },
            { api_slotid: 0, api_state: 2, api_max_count: 18, api_cond: 1 },
            { api_slotid: 0, api_state: 2, api_max_count: 18, api_cond: 1 },
        ],
    },
    {
        api_area_id: 7, api_rid: 2, api_name: '第2航空隊', api_action_kind: 2,
        api_distance: { api_base: 5, api_bonus: 0 },
        api_plane_info: [
            { api_slotid: 90003, api_state: 1, api_count: 18, api_max_count: 18, api_cond: 1 },
        ],
    },
    {
        api_area_id: 62, api_rid: 3, api_name: '第3航空隊', api_action_kind: 0,
        api_distance: { api_base: 7, api_bonus: 1 },
        api_plane_info: [
            { api_slotid: 90004, api_state: 1, api_count: 12, api_max_count: 18, api_cond: 3 },
            { api_slotid: 0, api_state: 2, api_max_count: 18, api_cond: 1 },
        ],
    },
]);
// slot_item 事件每次都會清空重建整個裝備庫（state.ts 的 require_info/slot_item
// 分支：`this.slotItems.clear()`），故艦娘裝備（90101-90104）與基地中隊裝備
// （90001-90004）必須合在同一次呼叫，且要在下面 state.fleets()/airBases_() 之前——
// 分兩次呼叫會讓後一次把前一次蓋掉（除錯用真封包踩過這個坑，別再分開呼叫）。
state.applyEvent('api_get_member/slot_item', {
    api_slot_item: [
        // 361：現存最長全名的裝備，用來檢查 .fo-gear-name 的 ellipsis 是否正常截斷。
        { api_id: 90101, api_slotitem_id: 361, api_level: 8, api_alv: 0 },
        { api_id: 90102, api_slotitem_id: 1, api_level: 0, api_alv: 7 },
        { api_id: 90103, api_slotitem_id: 42, api_level: 0, api_alv: 0 },
        { api_id: 90104, api_slotitem_id: 3, api_level: 3, api_alv: 0 },
        { api_id: 90001, api_slotitem_id: 169, api_level: 0, api_alv: 0 },
        { api_id: 90002, api_slotitem_id: 170, api_level: 0, api_alv: 7 },
        { api_id: 90003, api_slotitem_id: 168, api_level: 0, api_alv: 0 },
        { api_id: 90004, api_slotitem_id: 169, api_level: 0, api_alv: 4 },
    ],
});

const fleetsAll = state.fleets();
const basesAll = state.airBases_();
const areaNames = new Map(basesAll.map(b => [b.rid, state.mapAreaName(b.areaId)]));

const fleetsHtml = fleetsAll.map((f, i) => fleetHtml(f, i)).join('');
const lbasHtml = basesAll.map(b => baseHtml(b, areaNames.get(b.rid) ?? '')).join('');

// 顯示範圍摺疊區塊：markup 與 render() 手寫的那份一致，僅供預覽外觀比對用
// （這塊本身不是本次要驗的重點，重點是艦卡/裝備清單，故不透過額外 export 共用）。
const scopeBody = `
    ${fleetsAll.map((f, i) => f.ships.length
        ? `<label class="eo-chip on" data-fleet="${i}"><input type="checkbox" checked>${t('ov.fleetN', { n: i + 1 })}</label>`
        : '').join('')}
    ${basesAll.map(b => `<label class="eo-chip on" data-lbas-rid="${b.rid}"><input type="checkbox" checked>${b.name}　${areaNames.get(b.rid) ?? ''}</label>`).join('')}`;

const shell = `
    <div class="ov-toolbar">
        <button class="ov-btn">${t('ov.copyMarkdown')}</button>
        <button class="ov-btn">${t('ov.downloadMarkdown')}</button>
        <button class="ov-btn">${t('ov.downloadPng')}</button>
        <button class="ov-btn">${t('ov.exportImgBuilder')}</button>
        <button class="ov-btn">${t('ov.exportAirCalc')}</button>
    </div>
    <p class="fo-note">${t('ov.exportExternalNote')}</p>
    <details class="fo-scope" open>
        <summary>
            <span class="fo-scope-label">${t('ov.fleetOverviewScope')}</span>
            <span class="fo-scope-hint">${t('ov.fleetOverviewAllShown')}</span>
        </summary>
        <div class="fo-scope-body">${scopeBody}</div>
    </details>
    <div class="fo-body">
        <div class="fo-fleets">${fleetsHtml}</div>
        <div class="fo-lbas-row">${lbasHtml}</div>
    </div>`;

// overview 的 <style> 原封取用——預覽要驗的就是那份 CSS 在真實資料下的樣子。
// body 是 grid（header/nav/content 三區，見 index.html 的 `body { grid-template-areas }`），
// 側欄 200px 一起佔掉可用寬度——**這是使用者指定「820px 寬度排幾欄」的實際扣打**，
// 少了 #nav 這個佔位元素，預覽算出來的可用寬度會比真實頁面寬 200px，欄數會多算。
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
// 圖示是 root-relative（擴充內為 /icons/…），預覽走 file:// 故改指向 public/
const page = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<title>艦隊全覽版面預覽</title><style>${css}</style></head>
<body>
    <div id="header"><h1 id="page-title">鎮守府情報總括</h1></div>
    <nav id="nav"></nav>
    <main id="content">${shell}</main>
</body></html>`
    .replace(/src="\/icons\//g, `src="${resolve(root, 'public/icons')}/`);

mkdirSync(resolve(root, '.preview'), { recursive: true });
const out = resolve(root, '.preview/fleet-overview.html');
writeFileSync(out, page);
// 亮色主題也要看——本專案兩套主題都要能讀（design-guidelines §1.1）
const light = resolve(root, '.preview/fleet-overview-light.html');
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log(out);
console.log(light);
