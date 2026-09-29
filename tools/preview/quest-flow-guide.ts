// 情報總括「任務導覽」右欄的離線預覽：解鎖路線、關係圖、完成後開放，以及「備考」「本週期先完成」
// 「觸發條件分段」指引在繁中／英文、兩種內容寬度下的排版。右欄 HTML 直接呼叫正式分區的
// questFlowDetailHtml()；完成狀態以「使用者標記完成」模擬玩家進度。
//
//   npx vite-node --config vitest.config.ts tools/preview/quest-flow-guide.ts
//   → .preview/quest-flow-guide-{zh,en,ja}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameState } from '../../utils/state';
import { setLang, t } from '../../utils/ui-i18n';
import { esc } from '../../utils/html-escape';
import { buildQuestFlow, type QuestFlowModel } from '../../utils/quest-flow';
import {
    questFlowDetailHtml, type QuestFlowDetailTab,
} from '../../entrypoints/overview/sections/quest-flow';

type Lang = Parameters<typeof setLang>[0];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));

/** 目標上游中「離根不超過 depth 層」的任務標成完成（對祖先封閉，模擬玩得有進度的玩家）。 */
function progressed(no: number, depth: number): QuestFlowModel {
    const base = buildQuestFlow(new GameState());
    const height = new Map<number, number>();
    const visit = (id: number, stack: Set<number>): number => {
        if (height.has(id)) return height.get(id)!;
        if (stack.has(id)) return 0;
        stack.add(id);
        let value = 0;
        for (const prerequisite of base.byNo.get(id)?.prerequisiteNos ?? []) {
            value = Math.max(value, visit(prerequisite, stack) + 1);
        }
        stack.delete(id);
        height.set(id, value);
        return value;
    };
    visit(no, new Set());
    const done = [...height].filter(([id, value]) => id !== no && value <= depth).map(([id]) => id);
    return buildQuestFlow(new GameState(), new Set(done));
}

interface Scene { key: string; no: number; tab: QuestFlowDetailTab; model: () => QuestFlowModel; note: string }

// B214（1042）86 項前置、完成過半；A81（186）新玩家 40 項前置；A82（187）主要前置 D27＋Dd1、備考 Bw8；
// C56（351）人工裁決；2603D1（450）觸發條件分段；Fy10（1123）前置未定。
/** 只有 By6（944）出現在任務清單：By8 的路線應只剩 By6，不要求重做 Gy2／Gy1。 */
function by6Available(): QuestFlowModel {
    const state = new GameState();
    state.applyEvent('api_get_member/questlist', {
        api_list: [{ api_no: 944, api_state: 1, api_title: '鎮守府近海海域の哨戒を実施せよ！', api_detail: '' }],
    }, { api_tab_id: '0' });
    return buildQuestFlow(state);
}

const SCENES: Scene[] = [
    { key: 'by8-unlocked', no: 946, tab: 'path', model: by6Available, note: 'By8 · By6 already listed' },
    { key: 'b114-rewards', no: 879, tab: 'path', model: () => buildQuestFlow(new GameState()), note: 'B114 · rewards' },
    { key: 'cy5-reward-options', no: 353, tab: 'path', model: () => buildQuestFlow(new GameState()), note: 'Cy5 · reward options' },
    { key: 'b214-path', no: 1042, tab: 'path', model: () => progressed(1042, 13), note: 'B214 · progressed' },
    { key: 'b214-graph', no: 1042, tab: 'graph', model: () => progressed(1042, 13), note: 'B214 · progressed' },
    { key: 'a81-path', no: 186, tab: 'path', model: () => buildQuestFlow(new GameState()), note: 'A81 · new player' },
    { key: 'a81-post', no: 101, tab: 'post', model: () => buildQuestFlow(new GameState()), note: 'A1 · downstream' },
    { key: 'a82-path', no: 187, tab: 'path', model: () => progressed(187, 6), note: 'A82 · remarks' },
    { key: 'c56-path', no: 351, tab: 'path', model: () => buildQuestFlow(new GameState()), note: 'C56 · reviewed' },
    { key: '2603d1-path', no: 450, tab: 'path', model: () => buildQuestFlow(new GameState()), note: '2603D1 · phases' },
    { key: 'fy10-path', no: 1123, tab: 'path', model: () => buildQuestFlow(new GameState()), note: 'Fy10 · undecided' },
];
const WIDTHS = [1040, 760];

function page(lang: Lang): string {
    setLang(lang);
    const blocks = SCENES.flatMap(scene => {
        const model = scene.model();
        const row = model.byNo.get(scene.no) ?? null;
        return WIDTHS.map(width => `<div class="pv-scene" data-scene="${scene.key}-${width}">
        <h2 class="pv-title">${esc(scene.note)} · api_no ${scene.no} · ${width}px</h2>
        <div class="pv-frame" style="width:${width}px">
            <div class="qf"><div class="qf-board">
                <section class="qf-panel qf-catalog"><div class="qf-panel-head"><h3>${esc(t('ov.qfTaskDirectory'))}</h3></div><div class="qf-panel-body"></div></section>
                ${questFlowDetailHtml(model, row, {
                    tab: scene.tab, graphDone: false, pinned: false, manual: false,
                    japaneseOriginalOpen: false, doneOpen: false,
                })}
            </div></div>
        </div></div>`);
    }).join('');
    return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>任務導覽右欄（預覽）</title>
<style>${css}
        body { display: block; height: auto; padding: 16px; overflow: auto; }
        .pv-title { font-size: 12px; color: var(--dim); margin: 18px 0 6px; }
        .pv-frame { height: 900px; border: 1px dashed var(--line); display: flex; overflow: hidden; }
        .pv-frame > .qf { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style></head><body>${blocks}
<script>
// ?scene=b214-path-1040 只顯示單一場景（截圖用）；?h=1800 拉高框，讓長路線整段入鏡
const params = new URLSearchParams(location.search);
const scene = params.get('scene');
if (scene) document.querySelectorAll('.pv-scene').forEach(el => { el.hidden = el.dataset.scene !== scene; });
const h = params.get('h');
if (h) document.querySelectorAll('.pv-frame').forEach(el => { el.style.height = h + 'px'; });
</script></body></html>`;
}

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const [lang, file] of [['zh-TW', 'quest-flow-guide-zh.html'], ['en', 'quest-flow-guide-en.html'], ['ja', 'quest-flow-guide-ja.html']] as const) {
    const out = resolve(root, '.preview', file);
    writeFileSync(out, page(lang));
    console.log(out);
}
