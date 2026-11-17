// 情報總括「改修日程」分區的離線版面預覽。HTML 直接用正式分區匯出的 improvePlanHtml()，
// 預覽與正式畫面同一份 markup；樣式取 overview/index.html 的 <style>。
//
// 資料：samples/start2-master.json＋samples/slot_to_port.json（真實封包）。sample 的 port 沒有裝備庫，
// 也沒有改修紀錄，下面兩份都是預覽專用的假資料（FAKE_HELD、FAKE_STATS），只存在於這個 GameState 實例。
//
//   npx vite-node --config vitest.config.ts tools/preview/improve-plan.ts
//   → .preview/improve-plan.html、improve-plan-light.html、improve-plan-en.html、improve-plan-ja.html
//   並以本機 headless Chrome 開三語頁，印出各情境 .ip 的實寬、左右欄與表格容器的 client／scroll 寬、單欄或雙欄。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameState } from '../../utils/state';
import { setLang, t } from '../../utils/ui-i18n';
import type { Lang } from '../../utils/gamedata-i18n';
import { AKASHI_SCHEDULE } from '../../utils/akashi-schedule-data';
import type { ImproveStat } from '../../utils/akashi-schedule';
import { defaultOptions, improvePlanHtml } from '../../entrypoints/overview/sections/improve-plan';
// 離線預覽也要顯示艦名與介面文案：安裝 state.ts 的顯示命名（見 utils/state-format.ts）。
import '../../utils/state-display';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

// 2026-11-17（週二）12:00 JST：固定時間，預覽輸出可重現。
const NOW = Date.UTC(2026, 10, 17, 3, 0, 0);

function makeState(held: ReadonlyMap<number, number>): GameState {
    const state = new GameState();
    state.applyEvent('api_start2/getData', readJson('samples/start2-master.json'));
    state.applyEvent('api_port/port', readJson('samples/slot_to_port.json').api_data);
    const items: { api_id: number; api_slotitem_id: number; api_level: number; api_alv: number }[] = [];
    let id = 900000;
    for (const [mst, count] of held) for (let i = 0; i < count; i++) items.push({ api_id: id++, api_slotitem_id: mst, api_level: 0, api_alv: 0 });
    if (items.length) state.applyEvent('api_get_member/slot_item', { api_slot_item: items });
    return state;
}

// 假資料：表內前 30 種裝備各持有 1～3 件，另加 4 種表內查不到的裝備。
const unlisted = [...makeState(new Map()).masterGears.keys()].filter(mst => !AKASHI_SCHEDULE.some(([id]) => id === mst));
const FAKE_HELD = new Map<number, number>([
    ...AKASHI_SCHEDULE.slice(0, 30).map(([mst], index) => [mst, index % 3 + 1] as [number, number]),
    ...unlisted.slice(0, 4).map(mst => [mst, 1] as [number, number]),
]);
// 假資料：改修紀錄彙總（正式畫面讀 db.factory 的 kind==='improve' 列）。
const FAKE_STATS: ImproveStat[] = [...FAKE_HELD.keys()].slice(0, 8).map((gearMst, index) => ({
    gearMst, attempts: 12 - index, successes: 9 - index, certain: index % 3, lastTs: NOW - index * 86_400_000,
}));

const full = makeState(FAKE_HELD);
const noGear = makeState(new Map());
const SCENES = [
    { title: '1366 寬（側欄釘選）', width: 1366 - 200, pad: '16px 20px' },
    { title: '760 寬（側欄浮層）', width: 760, pad: '12px 12px 20px' },
];

const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
const frame = (title: string, width: number, pad: string, html: string) =>
    `<h2 class="pv-title">${title}</h2><div class="pv-frame" style="width:${width}px;padding:${pad}"><div class="ov-section-host">${html}</div></div>`;

// 頁內量測：每個 .ip 一列；wrap 欄位是各表格容器的 [clientWidth, scrollWidth]，scroll>client 表示靠橫向捲軸補。
const MEASURE = `(() => {
  const rows = [...document.querySelectorAll('.pv-frame')].map(frame => {
    const ip = frame.querySelector('.ip'); if (!ip) return null;
    const main = ip.querySelector('.ip-main'), side = ip.querySelector('.ip-side');
    const wrap = sel => { const el = ip.querySelector(sel); return el ? el.clientWidth + '/' + el.scrollWidth : '-'; };
    return { scene: frame.previousElementSibling.textContent, ip: ip.clientWidth, main: main.clientWidth, side: side.clientWidth,
      layout: main.offsetTop === side.offsetTop ? '雙欄' : '單欄', weekWrap: wrap('.ip-table-wrap'), statsWrap: wrap('.ip-stats-wrap'),
      helperList: wrap('.ip-helper-list'),
      helperGroups: [...ip.querySelectorAll('.ip-helper optgroup')].map(group => group.label + ':' + group.children.length).join(' '),
      helperSelect: (() => { const sel = ip.querySelector('.ip-helper'), bar = ip.querySelector('.ip-helper-pick'); return sel ? sel.offsetWidth + '/' + bar.clientWidth + (sel.scrollWidth > sel.clientWidth + 1 ? ' 截斷' : '') : '-'; })(), overflowX: getComputedStyle(ip.querySelector('.vl-table-wrap') || ip).overflowX };
  }).filter(Boolean);
  document.getElementById('measure').textContent = JSON.stringify(rows);
})();`;

function page(lang: Lang, theme: 'dark' | 'light'): string {
    setLang(lang);
    const blocks = SCENES.map(scene => frame(scene.title, scene.width, scene.pad, improvePlanHtml(full, NOW, FAKE_STATS)));
    // 「全部」＋曜日不限＋搜尋：未持有的列淡化（只看 1366 寬）
    const all = frame('全部／不限曜日', SCENES[0].width, SCENES[0].pad,
        improvePlanHtml(full, NOW, FAKE_STATS, { ...defaultOptions(NOW), heldOnly: false, day: 'all' }));
    const noData = frame('尚未取得裝備資料；沒有改修紀錄', SCENES[0].width, SCENES[0].pad, improvePlanHtml(noGear, NOW, []));
    const loading = frame('改修紀錄讀取中', SCENES[0].width, SCENES[0].pad, improvePlanHtml(full, NOW, null));
    const noMaster = frame('遊戲資料尚未載入', SCENES[0].width, SCENES[0].pad, improvePlanHtml(new GameState(), NOW, null));
    return `<!doctype html><html lang="${lang}" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('ov.improvePlan')}</title>
<style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; background: var(--bg); color: var(--text); }
.pv-title { display: flex; gap: 12px; align-items: baseline; font-size: 13px; margin: 28px 0 6px; }
.pv-frame { border: 1px dashed var(--line); }
</style></head><body><pre id="measure" hidden></pre>${blocks.join('')}${all}${noData}${loading}${noMaster}<script>${MEASURE}</script></body></html>`
        // 預覽頁在 .preview/ 下，絕對路徑的圖示改指到 public/
        .replaceAll('src="/icons/', 'src="../public/icons/');
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
const outputs: [string, Lang, 'dark' | 'light'][] = [
    ['improve-plan.html', 'zh-TW', 'dark'],
    ['improve-plan-light.html', 'zh-TW', 'light'],
    ['improve-plan-en.html', 'en', 'dark'],
    ['improve-plan-ja.html', 'ja', 'dark'],
];
for (const [name, lang, theme] of outputs) {
    const out = resolve(root, '.preview', name);
    writeFileSync(out, page(lang, theme));
    console.log(out);
}

// 量測：找不到 Chrome／Edge 時只印提示，不算失敗。
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
if (!chrome) console.log('找不到 Chrome／Edge，未量測；請用瀏覽器開上面的頁面，讀 #measure。');
else {
    for (const [name, lang] of outputs.filter(([, , theme]) => theme === 'dark')) {
        const dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1400,1000',
            '--virtual-time-budget=3000', '--dump-dom', `file://${resolve(root, '.preview', name)}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
        const raw = dom.match(/<pre id="measure"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
        if (!raw) { console.log(`${lang}: 沒有量到資料`); continue; }
        console.log(`\n[${lang}] main／side／wrap 為 client 寬（wrap 另有 /scroll 寬）`);
        console.table(JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
    }
}
