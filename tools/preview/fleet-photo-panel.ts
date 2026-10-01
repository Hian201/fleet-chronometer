// 編成寫真的離線預覽：直接打包正式 entrypoints/panel/fleet-photo.ts、header-fit.ts 與面板 CSS，
// 以假資料與佔位卡（不含遊戲素材）檢查托盤、header 縮放與輸出圖。
//
//   npx vite-node --config vitest.config.ts tools/preview/fleet-photo-panel.ts
//   → .preview/fleet-photo-panel.html
//   網址參數：?lang=zh-TW|ja|en&theme=light&mode=1|2|3|4|c|lbas&bases=1|2|3&shots=N&stale=1
//            &opts=1&outLang=ja&export=1&nick=…&ships=888/888&gears=8888/8888
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error('無法取得正式面板樣式');
const bundle = await build({
    entryPoints: [resolve(root, 'tools/preview/fleet-photo-panel-entry.ts')],
    bundle: true, write: false, format: 'iife', target: 'chrome120',
    alias: { '@': root },
});
const frame = [
    'html,body{height:auto;overflow:auto}body{display:flex;gap:24px;align-items:flex-start;padding:16px}',
    '.mock-panel{width:370px;height:620px;flex:none;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);border:1px solid var(--line);border-radius:6px}',
    '.pv-meta{font:11px/1.6 system-ui;color:var(--dim);margin-top:6px}',
    '#out img{max-width:640px;height:auto;border:1px solid var(--line);display:block}',
].join('\n');
const page = '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>fleet photo panel</title><style>' + css + '\n' + frame +
    '</style></head><body><div><div class="mock-panel"><div id="header"></div><div id="tabs"></div><div id="photo-tray" hidden></div>' +
    '<div id="fleetnav"></div></div><div class="pv-meta" id="measure-header"></div><div class="pv-meta" id="measure-tray"></div></div>' +
    '<div><div id="out"></div><div class="pv-meta" id="out-meta"></div></div><script>' +
    bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
mkdirSync(resolve(root, '.preview'), { recursive: true });
writeFileSync(resolve(root, '.preview/fleet-photo-panel.html'), page);
console.log(resolve(root, '.preview/fleet-photo-panel.html'));
