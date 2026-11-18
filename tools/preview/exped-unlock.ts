// 「遠征」分區的開放子頁離線預覽：用正式的 unlockPageHtml，資料是 samples 的真實主檔與遠征清單。
// 兩種情境：samples/mission-list-a4-done.json（一般遠征全開、A4 本期完成），以及只通關部分一般遠征的合成清單。
// 紀錄與規劃子頁另見 tools/preview/exped-log.ts。
//   npx vite-node --config vitest.config.ts tools/preview/exped-unlock.ts
//   → .preview/exped-unlock-<語言>-<主題>-<情境>.html，可加 ?w=<寬> 模擬內容區寬度
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { unlockPageHtml } from '../../entrypoints/overview/sections/exped-unlock';
import { GameState } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';
import '../../utils/state-display';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(resolve(root, 'samples', name), 'utf8'));
const source = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
const master = read('start2-master.json');
const NOW = Date.parse('2026-11-18T03:00:00Z');

const cleared = [1, 2, 3, 4, 5, 6, 7, 8, 100, 101, 9, 10, 11, 12, 13, 14, 15, 16, 110, 17, 18, 21, 22, 24, 19, 25, 26, 33, 32];
const opened = [102, 20, 23, 27, 34, 35, 131];
const scenes = {
    vet: read('mission-list-a4-done.json'),
    new: { api_list_items: [...cleared.map(id => ({ api_mission_id: id, api_state: 2 })), ...opened.map(id => ({ api_mission_id: id, api_state: 1 }))], api_limit_time: [1797303600] },
};

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    setLang(lang);
    for (const [scene, list] of Object.entries(scenes)) {
        const state = new GameState();
        state.applyEvent('api_start2/getData', master.api_data ?? master);
        state.applyEvent('api_get_member/mission', list, undefined, NOW - 3600000);
        for (const theme of ['dark', 'light']) {
            const page = `<!doctype html><html lang="${lang}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>遠征開放預覽</title><style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; background: var(--bg); color: var(--text); }
#frame { border: 1px dashed var(--line); padding: 16px 20px; margin: 0 auto; max-width: 100%; box-sizing: border-box; }
</style></head><body><div id="frame"><div class="eu">${unlockPageHtml(state, NOW)}</div></div>
<script>const w = Number(new URLSearchParams(location.search).get('w')); if (w) document.getElementById('frame').style.width = w + 'px';</script></body></html>`
                .replaceAll('src="/icons/', 'src="../public/icons/');
            const name = `.preview/exped-unlock-${lang}-${theme}-${scene}.html`;
            writeFileSync(resolve(root, name), page);
            console.log(name);
        }
    }
}
