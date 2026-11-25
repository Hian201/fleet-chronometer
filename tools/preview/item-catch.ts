// 情報總括「打撈紀錄 › 道具捕撈」子頁的離線預覽：打包正式 dropLogSection 並內嵌 IIFE，
// 雙擊 file:// 即可開；同時在 headless Chrome 跑各情境、三語各一份並截圖。
// 資料：samples/start2-master.json＋samples/slot_to_port.json（真實封包）；出擊紀錄與道具掉落是假資料。
//
//   npx vite-node --config vitest.config.ts tools/preview/item-catch.ts
//   → .preview/item-catch{,-en,-ja}.html（單檔自足）與截圖 item-catch-<語言>-<情境>.png
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
const bundle = await build({
    entryPoints: [resolve(root, 'tools/preview/item-catch-entry.ts')],
    bundle: true, write: false, format: 'iife', target: 'chrome120', platform: 'browser',
    alias: { '@': root }, loader: { '.json': 'json' },
});
mkdirSync(resolve(root, '.preview'), { recursive: true });
rmSync(resolve(root, '.preview/item-catch.bundle.js'), { force: true });
// 預覽頁在 .preview/ 下，絕對路徑的圖示改指到 public/；內嵌 IIFE 以免 file:// 被 CORS 擋下。
const scriptJs = bundle.outputFiles[0].text.replaceAll('/icons/', '../public/icons/').replaceAll('</script', '<\\/script');

const langs = [['zh-TW', 'item-catch.html'], ['en', 'item-catch-en.html'], ['ja', 'item-catch-ja.html']] as const;
for (const [lang, name] of langs) {
    const page = `<!doctype html><html lang="${lang}" data-theme="dark"><head><meta charset="utf-8"><title>item-catch ${lang}</title><style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; background: var(--bg); color: var(--text); }
#frame { border: 1px dashed var(--line); padding: 16px 20px; }
</style></head><body><div id="frame"></div><pre id="measure" hidden></pre><script>window.__lang = ${JSON.stringify(lang)};window.addEventListener("error",e=>{document.getElementById("measure").textContent=JSON.stringify({error:String(e.message)+" @"+e.lineno})});window.addEventListener("unhandledrejection",e=>{document.getElementById("measure").textContent=JSON.stringify({error:String(e.reason&&e.reason.stack||e.reason).slice(0,600)})});</script><script>${scriptJs}</script></body></html>`;
    writeFileSync(resolve(root, '.preview', name), page);
    console.log(resolve(root, '.preview', name));
}

const scenes = [
    { key: 'default', query: '?scene=default', hash: '' },
    { key: 'open', query: '?scene=default&open=1', hash: '' },
    { key: 'empty', query: '?scene=empty', hash: '' },
    { key: 'unknown', query: '?scene=unknown&open=1', hash: '' },
    { key: 'error', query: '?scene=error', hash: '' },
    { key: 'open-900', query: '?scene=default&open=1&w=900', hash: '' },
    { key: 'ship', query: '?scene=default&sub=ship', hash: '' },
    { key: 'catch-on', query: '?scene=default&catch=1&open=1', hash: '' },
    { key: 'alert', query: '?scene=default&catch=1&alert=1', hash: '' },
    { key: 'alert-bad', query: '?scene=default&alert=bad', hash: '' },
    { key: 'season-inferred', query: '?scene=default&catch=1&season=inferred', hash: '' },
    { key: 'season-inferred-375', query: '?scene=default&catch=1&season=inferred&w=375', hash: '' },
    { key: 'season-user', query: '?scene=default&catch=1&season=user', hash: '' },
    { key: 'dc-off', query: '?scene=default&catch=1&dc=panel', hash: '' },
    { key: 'dc-off-375', query: '?scene=default&catch=1&dc=panel&w=375', hash: '' },
    { key: 'alert-375', query: '?scene=default&catch=1&alert=1&w=375', hash: '' },
];
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
if (!chrome) console.log('找不到 Chrome／Edge，未量測；請用瀏覽器開上面的頁面（可加 ?scene=empty 等參數）。');
else {
    const run = (args: string[]) => execFileSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=6000', ...args],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const [lang, name] of langs) {
        const table: Record<string, unknown>[] = [];
        for (const scene of scenes) {
            const url = `file://${resolve(root, '.preview', name)}${scene.query}${scene.hash}`;
            const dom = run(['--window-size=1400,1100', '--dump-dom', url]);
            const raw = dom.match(/<pre id="measure"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
            if (!raw) { table.push({ scene: scene.key, error: '沒有量到資料' }); continue; }
            table.push({ scene: scene.key, ...JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) });
            run(['--window-size=1400,1100', `--screenshot=${resolve(root, '.preview', `item-catch-${lang}-${scene.key}.png`)}`, url]);
        }
        console.log(`\n[${lang}]`);
        console.table(table);
    }
}
