// 情報總括「常規導航」分區的離線預覽：linkedom 跑正式 routeForecastSection.render()。
// 艦隊取自真實樣本 samples/slot_to_port.json，依情境挑指定艦種的艦重組第 1 艦隊（只換 deck 的
// api_ship，艦與 master 都是真封包）。每個框模擬一種可視區，標題列印出地圖與側欄的實測尺寸。
//
//   npx vite-node --config vitest.config.ts tools/preview/route-forecast.ts
//   → .preview/route-forecast-{zh-TW,en,ja}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { GameState } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';
import { routeForecastSection } from '../../entrypoints/overview/sections/route-forecast';

type Lang = Parameters<typeof setLang>[0];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));

const master = readJson('samples/start2-master.json');
const port = readJson('samples/slot_to_port.json');
const stypeOf = new Map<number, number>((master.api_data ?? master).api_mst_ship.map((s: any) => [s.api_id, s.api_stype]));

/** 依艦種序列從樣本母港挑艦（不重複）。 */
function pickShips(stypes: number[]): number[] {
    const used = new Set<number>();
    return stypes.map((st) => {
        const s = port.api_data.api_ship.find((x: any) => !used.has(x.api_id) && stypeOf.get(x.api_ship_id) === st);
        if (!s) throw new Error(`樣本沒有 stype ${st} 的艦`);
        used.add(s.api_id);
        return s.api_id;
    });
}

function fixture(stypes: number[]): GameState {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    const data = structuredClone(port.api_data);
    const ids = pickShips(stypes);
    data.api_deck_port[0].api_ship = [...ids, ...Array(6 - ids.length).fill(-1)];
    state.applyEvent('api_port/port', data);
    return state;
}

interface Scene { title: string; viewport: [number, number]; navPinned: boolean; map: string; stypes: number[]; stage?: string; world?: boolean; tall?: boolean }
const SCENES: Scene[] = [
    { title: '1366×768：世界地圖選擇（浮層展開）', viewport: [1366, 657], navPinned: true, map: '5-5', stypes: [3, 2, 2, 2], world: true },
    { title: '760×640（側欄浮層）：世界地圖選擇', viewport: [760, 640], navPinned: false, map: '1-5', stypes: [3, 2, 2, 2], world: true },
    { title: '760×640（側欄浮層）：世界地圖選擇 2-3（捲到目前海域、左右提示）', viewport: [760, 640], navPinned: false, map: '2-3', stypes: [3, 2, 2, 2], world: true },
    { title: '1366×768：7-3 戦力ゲージ2（階段選擇、A 點規則依階段不同）', viewport: [1366, 657], navPinned: true, map: '7-3', stypes: [3, 2, 2, 2], stage: 'g2' },
    { title: '1366×768：7-4（規則含「條件不可考」的去向）', viewport: [1366, 657], navPinned: true, map: '7-4', stypes: [3, 2, 2, 2] },
    { title: '1366×768：5-2 軽空母2＋駆逐4（指定艦規則多）', viewport: [1366, 657], navPinned: true, map: '5-2', stypes: [7, 7, 2, 2, 2, 2] },
    { title: '1366×768：4-5 補給1 駆逐3（能動分岐多、航路長）', viewport: [1366, 657], navPinned: true, map: '4-5', stypes: [22, 2, 2, 2] },
    { title: '1366×768：1-5 駆逐4（固定到王）', viewport: [1366, 657], navPinned: true, map: '1-5', stypes: [2, 2, 2, 2] },
    { title: '1366×768：1-5 含補給艦（D→E 偏離）', viewport: [1366, 657], navPinned: true, map: '1-5', stypes: [3, 2, 1, 22] },
    { title: '1920×1080：5-5 戦艦2 正規空母2 駆逐2', viewport: [1920, 1032], navPinned: true, map: '5-5', stypes: [9, 9, 11, 11, 2, 2] },
    { title: '1920×1080：5-6 未指定階段', viewport: [1920, 1032], navPinned: true, map: '5-6', stypes: [3, 2, 2, 2, 5, 5] },
    { title: '760×640（側欄浮層）：6-5', viewport: [760, 640], navPinned: false, map: '6-5', stypes: [3, 2, 2, 11, 11, 5] },
    { title: '1366×768：到王編成參考 5-5（裝備擇一、索敵、含隨機）全高', viewport: [1366, 657], navPinned: true, map: '5-5', stypes: [9, 9, 11, 11, 2, 2], tall: true },
    { title: '1366×768：到王編成參考 7-4（與法則不符）全高', viewport: [1366, 657], navPinned: true, map: '7-4', stypes: [3, 2, 2, 2], tall: true },
    { title: '760×640（側欄浮層）：到王編成參考 3-2（可選節點、多路線）全高', viewport: [760, 640], navPinned: false, map: '3-2', stypes: [3, 2, 2, 2], tall: true },
];

async function renderScene(lang: Lang, scene: Scene): Promise<string> {
    setLang(lang);
    const { document, window } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>');
    const prefs = { map: scene.map, fleet: 0, stage: scene.stage ? { [scene.map]: scene.stage } : {} };
    const store = new Map<string, string>([['kc-route-forecast', JSON.stringify(prefs)]]);
    const localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
    };
    Object.assign(globalThis, { document, window, localStorage });
    const host = document.getElementById('host') as unknown as HTMLElement;
    await routeForecastSection.render(host, { state: fixture(scene.stypes), rerender() {}, async reloadState() {} });
    if (scene.world) {
        const world = host.querySelector('.rf-world') as unknown as HTMLDetailsElement;
        world.setAttribute('open', '');
        world.dispatchEvent(new window.Event('toggle') as unknown as Event);
    }
    return host.innerHTML;
}

const MEASURE = `<script>
addEventListener('load', () => {
    // ?only=N：只顯示第 N 個場景（截圖用）
    const only = new URLSearchParams(location.search).get('only');
    if (only !== null) document.querySelectorAll('.pv-frame').forEach((f, i) => { if (String(i) !== only) { f.previousElementSibling.remove(); f.remove(); } });
    for (const frame of document.querySelectorAll('.pv-frame')) {
        const pop = frame.querySelector('.rf-world[open] .rf-world-pop');
        if (pop) {
            // 靜態預覽沒有分區的事件：照 route-forecast.ts 開啟時的處理，捲到目前海域並顯示左右提示
            const sc0 = pop.querySelector('.rf-world-scroll'), on = sc0.querySelector('.rf-wchip.on');
            if (on && sc0.scrollWidth > sc0.clientWidth + 1) {
                const a = on.getBoundingClientRect(), v = sc0.getBoundingClientRect();
                sc0.scrollLeft += (a.left + a.width / 2) - (v.left + v.width / 2);
            }
            const max = sc0.scrollWidth - sc0.clientWidth, view = pop.querySelector('.rf-world-view');
            const canL = max > 1 && sc0.scrollLeft > 1, canR = max > 1 && sc0.scrollLeft < max - 1;
            pop.querySelector('.rf-world-pan-l').hidden = !canL; pop.querySelector('.rf-world-pan-r').hidden = !canR;
            pop.querySelector('.rf-world-panhint').hidden = max <= 1;
            view.classList.toggle('rf-can-l', canL); view.classList.toggle('rf-can-r', canR);
            const out = frame.previousElementSibling.querySelector('.pv-measure');
            const p = pop.getBoundingClientRect(), sc = pop.querySelector('.rf-world-scroll');
            out.textContent = '浮層 ' + Math.round(p.width) + '×' + Math.round(p.height) + 'px・' + (sc.scrollWidth > sc.clientWidth + 1 ? '浮層內可橫捲 ' + (sc.scrollWidth - sc.clientWidth) + 'px' : '浮層內不需橫捲')
                + '・' + (frame.scrollWidth > frame.clientWidth + 1 ? '⚠ 頁面橫向溢出' : '頁面無橫向溢出');
            continue;
        }
        const svg = frame.querySelector('.rf-svg');
        const side = frame.querySelector('.rf-side');
        const out = frame.previousElementSibling.querySelector('.pv-measure');
        const s = svg.getBoundingClientRect(), d = side.getBoundingClientRect();
        const stacked = d.top >= s.bottom - 1;
        out.textContent = '地圖 ' + Math.round(s.width) + '×' + Math.round(s.height) + 'px・側欄寬 ' + Math.round(d.width)
            + 'px・' + (stacked ? '單欄（側欄在下）' : '雙欄') + '・' + (frame.scrollWidth > frame.clientWidth + 1 ? '⚠ 橫向溢出' : '無橫向溢出');
    }
});
</script>`;

async function page(lang: Lang): Promise<string> {
    const blocks: string[] = [];
    for (const scene of SCENES) {
        const [w, h] = scene.viewport;
        const width = w - (scene.navPinned ? 200 : 0);
        const height = h - 48;
        blocks.push(`<h2 class="pv-title">${scene.title}<small>內容區 ${width}×${height}</small><span class="pv-measure"></span></h2>
        <div class="pv-frame" style="width:${width}px;${scene.tall ? 'min-' : ''}height:${height}px">${await renderScene(lang, scene)}</div>`);
    }
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Normal map routes</title>
<style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; }
.pv-title { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; font-size: 13px; color: var(--text); margin: 28px 0 6px; }
.pv-title small { color: var(--dim); font-weight: 400; }
.pv-measure { color: var(--sparkle); font-size: 12px; font-weight: 400; }
.pv-frame { overflow-x: hidden; overflow-y: auto; padding: 16px 20px 12px; border: 1px dashed var(--line); }
</style>${MEASURE}</head><body>${blocks.join('')}</body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    const out = resolve(root, `.preview/route-forecast-${lang}.html`);
    writeFileSync(out, await page(lang));
    console.log(out);
}
