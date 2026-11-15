// 遠征紀錄的離線預覽：合成紀錄涵蓋四種資材、三種家具箱、伊良湖及未知編號，不連遊戲。
// npx vite-node --config vitest.config.ts tools/preview/exped-log.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { COLUMNS, summaryHtml, tableHtml } from '../../entrypoints/overview/sections/exped-log';
import { summarize } from '../../utils/expedition-stats';
import { setLang } from '../../utils/ui-i18n';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
const rows = [1, 2, 3, 4, 10, 11, 12, 59, 99999].map((id, i) => ({
    eventId: i + 1, ts: 1794733200000 - i * 3600000, deckId: 2, missionId: 5,
    name: '海上護衛任務', result: 1, resources: [200, 200, 20, 20],
    items: [{ id, count: i + 1 }, { id: id === 10 ? 3 : 10, count: 2 }],
}));
mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    setLang(lang);
    for (const theme of ['dark', 'light']) {
        const page = `<!doctype html><html lang="${lang}" data-theme="${theme}"><meta charset="utf-8">
<title>遠征紀錄預覽</title><style>${css}</style><body style="display:block"><div style="padding:20px;min-width:0">
${summaryHtml(summarize(rows), null, null, rows)}${tableHtml(rows, COLUMNS.filter(c => c.on))}
</div></body></html>`.replaceAll('src="/icons/', 'src="/public/icons/');
        writeFileSync(resolve(root, `.preview/exped-log-${lang}-${theme}.html`), page);
    }
}
