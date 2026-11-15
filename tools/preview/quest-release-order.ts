// 任務實裝順序的三語離線預覽，直接打包正式分區與樣式。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { esc } from '../../utils/html-escape';

const overview = readFileSync('entrypoints/overview/index.html', 'utf8');
const css = overview.slice(overview.indexOf('<style>') + 7, overview.indexOf('</style>'));
const copy = {
    'zh-TW': { proposal: '任務實裝順序篩選', demo: '離線預覽：任務進度為模擬情境，不代表你的帳號。' },
    en: { proposal: 'Quest release order', demo: 'Offline preview: quest progress is simulated and does not represent your account.' },
    ja: { proposal: '任務の実装順', demo: 'オフラインプレビュー：任務の進捗はサンプルで、実際のアカウントとは異なります。' },
};
mkdirSync('.preview', { recursive: true });
const runtime = readFileSync('tools/preview/quest-release-order-runtime.ts', 'utf8');
const bundled = (await build({ stdin: { contents: runtime, resolveDir: process.cwd() + '/tools/preview', loader: 'ts' }, bundle: true, write: false, format: 'iife', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text;
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    writeFileSync(`.preview/quest-release-order-${lang}.html`, `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy[lang].proposal}</title><style>${css}
body{height:auto;min-height:100vh;display:block;overflow:auto}main{padding:16px 20px;height:calc(100vh - 65px);display:flex;flex-direction:column}.pv-banner{padding:12px 20px;color:var(--dim);border-bottom:1px solid var(--line)}#host{flex:1;min-height:0;display:flex;flex-direction:column}
</style><body><div class="pv-banner">${esc(copy[lang].proposal)} · ${esc(copy[lang].demo)}</div><main><div id="host"></div></main><script>window.previewLang=${JSON.stringify(lang)};</script><script>${bundled.replaceAll('</script', '<\\/script')}</script></body></html>`);
    console.log(`.preview/quest-release-order-${lang}.html`);
}
