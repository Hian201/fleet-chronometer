// 面板「工廠」分頁（子分頁：今日改修）的離線預覽：打包正式 entrypoints/panel/factory-today.ts，
// 掛在正式面板 index.html 的 #tab-factory 骨架與 <style> 上，每個情境一個 370×850 假窗（§7.5）。
// 資料：samples/start2-master.json＋samples/slot_to_port.json（真實封包）；sample 的 port 沒有裝備庫，
// 持有的裝備是預覽專用的假資料（見 panel-factory-entry.ts）。
//
//   npx vite-node --config vitest.config.ts tools/preview/panel-factory.ts
//   → .preview/panel-factory{,-en,-ja}.html（共用 .preview/panel-factory.bundle.js）
//   並以本機 headless Chrome 開這三頁，印出各情境在 270px #tabpanel 內的實際高度。
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const start = source.indexOf('<div id="tab-factory"');
const end = source.indexOf('<div id="tab-order"', start);
if (!css || start < 0 || end < 0) throw new Error('無法取得正式面板樣式或工廠分頁骨架');
const skeleton = source.slice(start, end).trim();

const bundle = await build({
    entryPoints: [resolve(root, 'tools/preview/panel-factory-entry.ts')],
    bundle: true, write: false, format: 'esm', target: 'chrome120',
    alias: { '@': root }, loader: { '.json': 'json' },
});
mkdirSync(resolve(root, '.preview'), { recursive: true });
writeFileSync(resolve(root, '.preview/panel-factory.bundle.js'), bundle.outputFiles[0].text);

// §7.5：預覽頁必須覆寫 html/body 的高度與捲動；.pv-app 維持 370×850 且 overflow:hidden。
const frame = `
html, body { height: auto; overflow: auto; }
body { display: block; padding: 12px; }
#stage { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.pv-app { position: relative; width: 370px; height: 850px; overflow: hidden; background: var(--bg); outline: 1px dashed var(--line); display: flex; flex-direction: column; }
.pv-title { position: absolute; top: 0; left: 0; right: 0; z-index: 1; margin: 0; padding: 0 6px; font: 11px/16px system-ui, sans-serif; color: var(--dim); background: color-mix(in srgb, var(--bg) 85%, transparent); pointer-events: none; }
.pv-stub { flex: none; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--dim); border: 1px dashed var(--line); }
.pv-top { height: 70px; padding-top: 14px; }
.pv-app #tabpanel { flex: none; box-sizing: border-box; width: 370px; }
.pv-bottom { flex: 1; }`;

const langs = [['zh-TW', 'panel-factory.html'], ['en', 'panel-factory-en.html'], ['ja', 'panel-factory-ja.html']] as const;
for (const [lang, name] of langs) {
    const page = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>panel factory ${lang}</title><style>${css}\n${frame}</style></head>` +
        `<body><template id="tab-template">${skeleton}</template><div id="stage"></div><pre id="measure" hidden></pre>` +
        `<script>window.__lang = ${JSON.stringify(lang)};</script><script type="module" src="panel-factory.bundle.js"></script></body></html>`;
    writeFileSync(resolve(root, '.preview', name), page);
    console.log(resolve(root, '.preview', name));
}

// 量測：本機 headless Chrome 開預覽頁、讀回 #measure。找不到 Chrome 時只印提示，不算失敗。
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
if (!chrome) console.log('找不到 Chrome／Edge，未量測；請用瀏覽器開上面的頁面，讀 #measure。');
else {
    for (const [lang, name] of langs) {
        // 模組腳本在 file:// 下載不了 import 的 src 以外的資源，這裡的 bundle 是單檔，沒有相依。
        const dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--window-size=2000,1000',
            '--virtual-time-budget=4000', '--dump-dom', `file://${resolve(root, '.preview', name)}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
        const raw = dom.match(/<pre id="measure"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
        if (!raw) { console.log(`${lang}: 沒有量到資料（頁面腳本未執行）`); continue; }
        const rows = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as Record<string, number | string>[];
        console.log(`\n[${lang}] #tabpanel 釘死 270px；panelHeight／panelScrollHeight 必須都是 270`);
        console.table(rows);
    }
}
