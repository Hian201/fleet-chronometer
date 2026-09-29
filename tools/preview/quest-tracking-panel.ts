// 面板任務分頁的離線核對頁：用 linkedom 載入正式 panel/index.html，呼叫正式的
// mountGeneral() 渲染 quest-tracking-fixture 的情境，再取出任務清單放進 370px 框。
// 三個框分別是：展開預設（說明）、切到進度、其他可信度狀態的進度分頁。
//
//   npx vite-node --config vitest.config.ts tools/preview/quest-tracking-panel.ts
//   → .preview/quest-tracking-panel-{zh-TW,en,ja}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { mountGeneral } from '../../entrypoints/panel/general';
import { setLang } from '../../utils/ui-i18n';

type Lang = Parameters<typeof setLang>[0];
import { questTrackingFixture } from './quest-tracking-fixture';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error('無法取得正式面板樣式');

type Scene = { title: string; open: number[]; progress: number[]; pane?: 'original' | 'progress' };

function renderQuests(lang: Lang, scene: Scene): string {
    setLang(lang);
    const { document, window } = parseHTML(panelHtml);
    Object.assign(globalThis, { document, window });
    mountGeneral(questTrackingFixture(), () => '');
    const list = document.getElementById('quests')!;
    for (const node of list.querySelectorAll('.ledger-quest')) {
        const no = Number(node.getAttribute('data-no'));
        if (!scene.open.includes(no)) continue;
        node.setAttribute('open', '');
        if (!scene.progress.includes(no)) continue;
        const pane = scene.pane ?? 'progress';
        for (const button of node.querySelectorAll('[data-quest-pane]')) {
            button.setAttribute('aria-pressed', String(button.getAttribute('data-quest-pane') === pane));
        }
        for (const body of node.querySelectorAll('[data-quest-pane-body]')) {
            if (body.getAttribute('data-quest-pane-body') === pane) body.removeAttribute('hidden');
            else body.setAttribute('hidden', '');
        }
    }
    return `<div class="ledger-quests"><div class="ledger-quest-heading">${document.getElementById('quest-heading')!.innerHTML}</div>${list.outerHTML}</div>`;
}

const TITLES: Record<Lang, [string, string, string, string]> = {
    'zh-TW': ['① 展開預設：說明', '② 切到進度', '③ 其他狀態的進度分頁', '④ 切到原文'],
    en: ['① Expanded default: details', '② Switched to progress', '③ Progress pane in other states', '④ Switched to original'],
    ja: ['① 展開時の既定：説明', '② 進捗に切替', '③ ほかの状態の進捗', ''],
};

function page(lang: Lang): string {
    const [a, b, c, d] = TITLES[lang];
    const scenes: Scene[] = [
        { title: a, open: [1047], progress: [] },
        { title: b, open: [1047], progress: [1047] },
        { title: c, open: [342, 9001, 9002, 243], progress: [342, 9001, 9002, 243] },
        // 日文介面沒有原文分頁。
        ...(lang === 'ja' ? [] : [{ title: d, open: [1047], progress: [1047], pane: 'original' as const }]),
    ];
    const frames = scenes.map(scene => `<section class="pv-scene"><h2>${scene.title}</h2><div class="pv-frame">${renderQuests(lang, scene)}</div></section>`).join('');
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quest tracking panel</title><style>${css}
html, body { overflow: auto !important; height: auto; }
body { padding: 16px; }
.pv-scenes { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.pv-scene > h2 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: var(--dim); }
.pv-frame { width: 370px; padding: 6px 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; }
</style></head><body><div class="pv-scenes">${frames}</div>
<script>
document.querySelectorAll('[data-quest-pane]').forEach(button => button.addEventListener('click', () => {
  const quest = button.closest('.ledger-quest'), pane = button.dataset.questPane;
  quest.querySelectorAll('[data-quest-pane]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  quest.querySelectorAll('[data-quest-pane-body]').forEach(body => { body.hidden = body.dataset.questPaneBody !== pane; });
}));
</script></body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    const out = resolve(root, `.preview/quest-tracking-panel-${lang}.html`);
    writeFileSync(out, page(lang));
    console.log(out);
}
