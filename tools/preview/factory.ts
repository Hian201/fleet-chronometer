// 情報總括「工廠」分區（建造｜開發｜改修三個子分頁）的離線預覽：打包正式 factorySection 與三個子頁，
// 在 headless Chrome 的真實 IndexedDB 上跑；舊網址（#/build-log、#/dev-log、#/improve-plan）經正式
// normalizeHash 轉向，印出轉向後的網址與選中的子分頁，並驗證切換子分頁不會重建改修頁的控制項。
// 資料：samples/start2-master.json＋samples/slot_to_port.json（真實封包）；工廠紀錄與持有裝備是假資料。
// 樣式取 overview/index.html 的 <style>。
//
//   npx vite-node --config vitest.config.ts tools/preview/factory.ts
//   → .preview/factory{,-en,-ja}.html（共用 .preview/factory.bundle.js）與各情境截圖 factory-<語言>-<情境>.png
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
const bundle = await build({
    entryPoints: [resolve(root, 'tools/preview/factory-entry.ts')],
    bundle: true, write: false, format: 'esm', target: 'chrome120', platform: 'browser',
    alias: { '@': root }, loader: { '.json': 'json' },
});
mkdirSync(resolve(root, '.preview'), { recursive: true });
// 預覽頁在 .preview/ 下，絕對路徑的圖示改指到 public/
writeFileSync(resolve(root, '.preview/factory.bundle.js'), bundle.outputFiles[0].text.replaceAll('/icons/', '../public/icons/'));

const langs = [['zh-TW', 'factory.html'], ['en', 'factory-en.html'], ['ja', 'factory-ja.html']] as const;
for (const [lang, name] of langs) {
    const page = `<!doctype html><html lang="${lang}" data-theme="dark"><head><meta charset="utf-8"><title>factory ${lang}</title><style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; background: var(--bg); color: var(--text); }
#frame { border: 1px dashed var(--line); padding: 16px 20px; }
</style></head><body><div id="frame"></div><pre id="measure" hidden></pre><script>window.__lang = ${JSON.stringify(lang)};window.addEventListener("error",e=>{document.getElementById("measure").textContent=JSON.stringify({error:String(e.message)+" @"+e.lineno})});window.addEventListener("unhandledrejection",e=>{document.getElementById("measure").textContent=JSON.stringify({error:String(e.reason&&e.reason.stack||e.reason).slice(0,600)})});</script><script type="module" src="factory.bundle.js"></script></body></html>`;
    writeFileSync(resolve(root, '.preview', name), page);
    console.log(resolve(root, '.preview', name));
}

// 情境：舊網址轉向與預設；760 寬看單欄
const scenes = [
    { key: 'default', query: '', hash: '' },
    { key: 'old-build-log', query: '', hash: '#/build-log' },
    { key: 'old-dev-log', query: '', hash: '#/dev-log' },
    { key: 'old-improve-plan', query: '', hash: '#/improve-plan' },
    { key: 'factory-develop', query: '', hash: '#/factory?sub=develop' },
    { key: 'improve-760', query: '?w=760', hash: '#/factory?sub=improve' },
];
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
if (!chrome) console.log('找不到 Chrome／Edge，未量測；請用瀏覽器開上面的頁面（可加 #/build-log 等 hash）。');
else {
    const run = (args: string[]) => execFileSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=6000', ...args],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const [lang, name] of langs) {
        const table: Record<string, unknown>[] = [];
        for (const scene of scenes) {
            const url = `file://${resolve(root, '.preview', name)}${scene.query}${scene.hash}`;
            const dom = run(['--window-size=1400,1100', '--dump-dom', url]);
            const raw = dom.match(/<pre id="measure"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
            if (!raw) { table.push({ scene: scene.key, error: '沒有量到資料' }); continue; }
            table.push({ scene: scene.key, ...JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) });
            run(['--window-size=1400,1100', `--screenshot=${resolve(root, '.preview', `factory-${lang}-${scene.key}.png`)}`, url]);
        }
        console.log(`\n[${lang}]`);
        console.table(table);
    }
}
