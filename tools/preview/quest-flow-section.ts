// 情報總括「任務導覽」整個分區的離線預覽：linkedom 跑正式 questFlowSection.render()，
// 含篩選工具列、目錄與右欄。每個框模擬一種瀏覽器可視區（扣掉 48px 頂列，側欄釘選時再扣 200px），
// 框本身照 #content 的規則捲動；標題列印出實測的面板高度與是否需要整頁捲動，避免只看截圖誤判。
//
//   npx vite-node --config vitest.config.ts tools/preview/quest-flow-section.ts
//   → .preview/quest-flow-section-{zh-TW,en,ja}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { build } from 'esbuild';
import { GameState } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';
import { QUEST_CATALOG_BY_NO } from '../../utils/quest-flow';
import { QUEST_FLOW_PREFS_KEY } from '../../utils/quest-flow-prefs';
import { questFlowSection } from '../../entrypoints/overview/sections/quest-flow';

type Lang = Parameters<typeof setLang>[0];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));

const NOW = Date.UTC(2026, 9, 6, 3, 0);

/** 受注 Bw1／Bd1、Cd1 達成待領取、可接受若干，另有本機觀測完成的日常與單發。 */
function fixture(): GameState {
    const state = new GameState();
    const quest = (no: number, apiState: number) => ({
        api_no: no, api_state: apiState,
        api_title: QUEST_CATALOG_BY_NO.get(no)?.name ?? '', api_detail: QUEST_CATALOG_BY_NO.get(no)?.detail ?? '',
    });
    state.applyEvent('api_get_member/questlist', {
        api_list: [
            quest(214, 2), quest(201, 2), quest(303, 3),
            quest(216, 1), quest(313, 1), quest(893, 1), quest(261, 1), quest(613, 1),
        ],
    }, { api_tab_id: '0' }, NOW - 60_000);
    for (const no of [202, 402, 604, 605]) {
        state.applyEvent('api_req_quest/clearitemget', {}, { api_quest_id: String(no) }, NOW - 3_600_000);
    }
    return state;
}

interface Scene {
    title: string;
    /** 瀏覽器可視區（不含瀏覽器自身的分頁列與網址列）。 */
    viewport: [number, number];
    /** 視窗 ≤760px 時側欄改浮層，不佔寬。 */
    navPinned: boolean;
    prefs: Record<string, unknown>;
    /** 展開「更多條件」浮層。 */
    open?: boolean;
    /** 打開關係圖放大檢視（預覽以框內絕對定位模擬 modal）。 */
    expand?: boolean;
}

// B214（1042）上游 86 項，關係圖最吃高度
const GRAPH = { targetNo: 1042, tab: 'graph' };
const FILTERED = { ...GRAPH, filters: { period: ['weekly'], category: ['sortie'], map: ['1-5'] } };

const SCENES: Scene[] = [
    { title: '筆電 1366×768 螢幕：預設、關係圖分頁', viewport: [1366, 657], navPinned: true, prefs: GRAPH },
    { title: '筆電 1366×768 螢幕：展開「任務內容與獎勵」', viewport: [1366, 657], navPinned: true, prefs: { ...GRAPH, headOpen: true } },
    { title: '筆電 1366×768 螢幕：關係圖「放大檢視」', viewport: [1366, 657], navPinned: true, prefs: GRAPH, expand: true },
    { title: '筆電 1366×768 螢幕：展開「更多條件」浮層', viewport: [1366, 657], navPinned: true, prefs: GRAPH, open: true },
    { title: '筆電 1366×768 螢幕：選了三個條件、關係圖分頁', viewport: [1366, 657], navPinned: true, prefs: FILTERED },
    { title: '桌機 1920×1080 螢幕：選了三個條件、關係圖分頁', viewport: [1920, 969], navPinned: true, prefs: FILTERED },
    { title: '矮視窗 1280×600：選了三個條件（面板保底高度，整頁可捲）', viewport: [1280, 600], navPinned: true, prefs: FILTERED },
    { title: '窄視窗 760×640（側欄浮層）：展開「更多條件」浮層', viewport: [760, 640], navPinned: false, prefs: GRAPH, open: true },
    { title: '窄視窗 760×640（側欄浮層）：選了三個條件、關係圖分頁', viewport: [760, 640], navPinned: false, prefs: FILTERED },
    // 期間限定任務標頭的實裝期間（2026 南瓜：10/14 更新後開始、結束未公告）
    { title: '筆電 1366×768 螢幕：期間限定任務（實裝期間）', viewport: [1366, 657], navPinned: true, prefs: { targetNo: 1039, tab: 'path' } },
    { title: '窄視窗 760×640（側欄浮層）：期間限定任務（實裝期間）', viewport: [760, 640], navPinned: false, prefs: { targetNo: 1039, tab: 'path' } },
];

async function renderScene(lang: Lang, scene: Scene): Promise<string> {
    setLang(lang);
    const { document, window } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>');
    const store = new Map<string, string>([[QUEST_FLOW_PREFS_KEY, JSON.stringify(scene.prefs)]]);
    const localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
    };
    Object.assign(globalThis, { document, window, localStorage, location: { hash: '#/quest-flow' }, history: { replaceState() {} } });
    const host = document.getElementById('host') as unknown as HTMLElement;
    await questFlowSection.render(host, {
        state: fixture(), rerender() {}, async reloadState() {},
    });
    if (scene.open) host.querySelector('.qf-more')?.setAttribute('open', '');
    if (scene.expand) {
        const dialog = host.querySelector('.qf-graph-dialog') as unknown as { showModal(): void; setAttribute(k: string, v: string): void };
        dialog.showModal = () => dialog.setAttribute('open', '');
        (host.querySelector('[data-qf-graph-expand]') as unknown as HTMLElement).click();
    }
    return host.innerHTML;
}

// 拍照的繪製程式打包進預覽頁，在瀏覽器裡對放大檢視的圖實際跑一次，產生的 PNG 接在該情境下方
const photoBundle = (await build({
    entryPoints: [resolve(root, 'entrypoints/overview/quest-graph-photo.ts')],
    bundle: true, write: false, format: 'iife', globalName: 'QuestGraphPhoto', target: 'chrome120',
    alias: { '@': root },
})).outputFiles[0].text;
const PHOTO = `<script>${photoBundle}</script><script>
addEventListener('load', async () => {
    for (const dialog of document.querySelectorAll('.qf-graph-dialog[open]')) try {
        const frame = dialog.closest('.pv-frame');
        const graph = dialog.querySelector('.qf-graph');
        const title = dialog.querySelector('#qf-graph-dialog-title').textContent;
        const blob = await QuestGraphPhoto.renderQuestGraphPhoto(graph, title, Date.now());
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        const box = document.createElement('figure');
        box.className = 'pv-photo';
        box.innerHTML = '<figcaption>「拍照」實際輸出（' + img.naturalWidth + '×' + img.naturalHeight + ' px，以一半大小顯示）</figcaption>';
        img.style.width = (img.naturalWidth / 2) + 'px';
        box.append(img);
        frame.after(box);
    } catch (error) { console.error('[preview] 拍照失敗', error); }
});
</script>`;

// 在瀏覽器裡量：面板高度、目前分頁可用高度、整頁是否要捲、浮層是否只蓋住目錄而沒有撐高版面
const MEASURE = `<script>
addEventListener('load', () => {
    // 放大檢視開啟時正式程式以版面尺寸算「符合寬度」；linkedom 沒有版面，這裡用同一公式
    // （utils/quest-flow-facets.ts questGraphFitScale）在瀏覽器補算一次
    for (const dialog of document.querySelectorAll('.qf-graph-dialog[open]')) {
        const body = dialog.querySelector('.qf-graph-dialog-body');
        const graph = body.querySelector('.qf-graph');
        const tools = body.querySelector('.qf-graph-tools');
        const w = parseFloat(graph.style.width), h = parseFloat(graph.style.height);
        // 開啟時的預設＝符合寬度
        const scale = Math.max(0.25, Math.min(1, (body.clientWidth - 32) / w));
        graph.parentElement.style.width = Math.round(w * scale) + 'px';
        graph.parentElement.style.height = Math.round(h * scale) + 'px';
        graph.style.transform = 'scale(' + scale + ')';
        dialog.querySelector('.qf-graph-zoom-value').textContent = Math.round(scale * 100) + '%';
    }
    for (const frame of document.querySelectorAll('.pv-frame')) {
        const board = frame.querySelector('.qf-board');
        const pane = [...frame.querySelectorAll('.qf-pane')].find(item => !item.hidden);
        const dialogBody = frame.querySelector('.qf-graph-dialog[open] .qf-graph-dialog-body');
        const more = frame.querySelector('.qf-more[open] .qf-more-body');
        const out = frame.previousElementSibling.querySelector('.pv-measure');
        const scroll = frame.scrollHeight > frame.clientHeight + 1;
        out.textContent = '面板高 ' + Math.round(board.getBoundingClientRect().height)
            + 'px・目前分頁可視高 ' + Math.round(pane.clientHeight)
            + 'px・' + (scroll ? '整頁可往下捲 ' + (frame.scrollHeight - frame.clientHeight) + 'px' : '不需整頁捲動')
            + (more ? '・浮層高 ' + Math.round(more.getBoundingClientRect().height) + 'px（蓋在目錄上，不佔版面）' : '')
            + (dialogBody ? '・放大檢視可視區 ' + Math.round(dialogBody.clientWidth) + '×' + Math.round(dialogBody.clientHeight) + 'px' : '');
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
        <div class="pv-frame" style="width:${width}px;height:${height}px"><div class="pv-host">${await renderScene(lang, scene)}</div></div>`);
    }
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quest navigator</title>
<style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; }
.pv-title { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; font-size: 13px; color: var(--text); margin: 28px 0 6px; }
.pv-title small { color: var(--dim); font-weight: 400; }
.pv-measure { color: var(--sparkle); font-size: 12px; font-weight: 400; }
/* 照 #content:has(.qf) 與 .ov-section-host 的規則 */
.pv-frame { display: flex; flex-direction: column; overflow-x: hidden; overflow-y: auto; padding: 16px 20px 12px; border: 1px dashed var(--line); }
.pv-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pv-frame { position: relative; }
/* 預覽沒有 top layer：放大檢視以框內置中模擬 showModal() 的 92vh／96vw */
.pv-frame .qf-graph-dialog[open] { position: absolute; inset: 4% 2%; width: auto; height: auto; margin: 0; z-index: 50; box-shadow: 0 0 0 100vmax color-mix(in srgb, #000 55%, transparent); }
.pv-photo { margin: 10px 0 0; }
.pv-photo figcaption { color: var(--sparkle); font-size: 12px; margin-bottom: 6px; }
.pv-photo img { display: block; max-width: none; border: 1px dashed var(--line); }
</style>${MEASURE}${PHOTO}</head><body>${blocks.join('')}</body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    const out = resolve(root, `.preview/quest-flow-section-${lang}.html`);
    writeFileSync(out, await page(lang));
    console.log(out);
}
