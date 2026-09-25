// 一般分頁道具頁的離線預覽：直接打包正式 entrypoints/panel/general.ts 與面板 CSS／骨架，
// 不另寫一份模擬邏輯。輸出 .preview/panel-items.html，以 ?lang=&theme=&inventory=&q=&pins=&open= 切換情境。
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const start = source.indexOf('<div id="tab-general" class="ledger">');
const end = source.indexOf('<div id="tab-exped"', start);
if (!css || start < 0 || end < 0) throw new Error('無法取得正式面板樣式或一般分頁骨架');
const bundle = await build({
    entryPoints: [resolve(root, 'tools/preview/panel-items-entry.ts')],
    bundle: true, write: false, format: 'iife', target: 'chrome120',
    alias: { '@': root },
});
const frame = [
    'html,body{height:auto;overflow:auto}body{display:block;padding:0}',
    '.mock-panel{width:370px;height:270px;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}',
    '.mock-panel #tabpanel{flex:none;box-sizing:border-box;height:270px}',
].join('\n');
const page = '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>panel items</title><style>' + css + '\n' + frame +
    '</style></head><body><div class="mock-panel"><div id="tabpanel" class="has-general">' +
    source.slice(start, end).trim().replace(/<\/div>\s*$/, '') + '</div></div></div><script>' +
    bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
mkdirSync(resolve(root, '.preview'), { recursive: true });
writeFileSync(resolve(root, '.preview/panel-items.html'), page);
console.log(resolve(root, '.preview/panel-items.html'));
