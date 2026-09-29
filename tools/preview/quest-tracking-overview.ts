// 情報總括任務導覽「進度紀錄」分頁的離線核對頁：以 quest-tracking-fixture 的 GameState
// 建立正式的 buildQuestFlow() 模型，右欄直接呼叫 questFlowDetailHtml()。頂端免責說明與
// 正式分區使用同一個 class 與文案。寬度取 1040px 與 760px。
//
//   npx vite-node --config vitest.config.ts tools/preview/quest-tracking-overview.ts
//   → .preview/quest-tracking-overview-{zh-TW,en,ja}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLang, t } from '../../utils/ui-i18n';
import { esc } from '../../utils/html-escape';
import { buildQuestFlow } from '../../utils/quest-flow';
import { questFlowDetailHtml } from '../../entrypoints/overview/sections/quest-flow';
import { questTrackingFixture } from './quest-tracking-fixture';

type Lang = Parameters<typeof setLang>[0];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));

function page(lang: Lang): string {
    setLang(lang);
    const state = questTrackingFixture();
    const model = buildQuestFlow(state, new Set(), new Date(2026, 8, 28, 22, 0).getTime());
    const blocks = [[1047, 1040], [1047, 760], [9001, 760]].map(([no, width]) => {
        const row = model.byNo.get(no) ?? null;
        return `<h2 class="pv-title">api_no ${no} · ${width}px</h2>
        <div class="pv-frame" style="width:${width}px"><div class="qf">
            <p class="qf-disclaimer" role="note">${esc(t('ov.qfDisclaimer'))}</p>
            <div class="qf-board">
                <section class="qf-panel qf-catalog"><div class="qf-panel-head"><h3>${esc(t('ov.qfTaskDirectory'))}</h3></div><div class="qf-panel-body"></div></section>
                ${questFlowDetailHtml(model, row, { tab: 'progress', graphDone: false, pinned: false, manual: false, japaneseOriginalOpen: false, doneOpen: false })}
            </div>
        </div></div>`;
    }).join('');
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quest progress log</title>
<style>${css}
body { display: block; height: auto; padding: 16px; overflow: auto; }
.pv-title { font-size: 12px; color: var(--dim); margin: 18px 0 6px; }
.pv-frame { height: 1180px; border: 1px dashed var(--line); display: flex; overflow: hidden; }
.pv-frame > .qf { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style></head><body>${blocks}</body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    const out = resolve(root, `.preview/quest-tracking-overview-${lang}.html`);
    writeFileSync(out, page(lang));
    console.log(out);
}
