// 調度分頁裝備表的離線預覽：直接打包正式 entrypoints/panel/order.ts 與面板 CSS，
// 不另寫一份模擬邏輯。輸出 .preview/panel-order.html，以 ?lang=&theme=&view=holders&open=<mst,...> 切換情境。
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error('無法取得正式面板樣式');
const bundle = await build({
    entryPoints: [resolve(root, 'tools/preview/panel-order-entry.ts')],
    bundle: true, write: false, format: 'iife', target: 'chrome120',
    alias: { '@': root },
});
const frame = [
    'html,body{height:auto;overflow:auto}body{display:block;padding:0}',
    '.mock-panel{width:370px;height:270px;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}',
    '.mock-panel #tabpanel{flex:none;box-sizing:border-box;height:270px}',
].join('\n');
const page = '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>panel order</title><style>' + css + '\n' + frame +
    '</style></head><body><div class="mock-panel"><div id="tabpanel" class="has-order"><div id="tab-order"></div></div></div><script>' +
    bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
mkdirSync(resolve(root, '.preview'), { recursive: true });
writeFileSync(resolve(root, '.preview/panel-order.html'), page);
console.log(resolve(root, '.preview/panel-order.html'));
