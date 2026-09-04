// 面板「一般」分頁的可互動離線預覽（開發用，不進擴充 bundle）。
// 套 panel/index.html 的同一份 CSS，產出 420×850 實窗：資源抬頭＋遠征／入渠／建造
// 三欄並排＋任務主面。嚴格鎖定標準 420px 寬度，高密度排版，無溢出捲軸。
//
//   npx vite-node --config vitest.config.ts tools/preview/panel-general.ts
//   → .preview/panel-general{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { esc, matIconHtml } from '../../utils/html-escape';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
setLang('zh-TW');

const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

const tag = (kind: 'exped' | 'dock' | 'build' | 'quest') =>
    `<img class="t-icon" src="/icons/ui/${kind}.svg" alt="${esc(t('tag.' + kind))}">`;
const mat = (file: string) => matIconHtml(file, t(`mat.${file}.full`));

// 滿載資材數據測試：油彈鋼鋁上限 35 萬（350,000 六位數＋千分逗號＝7 字元寬度）
const RES = [
    ['fuel', '348,250'], ['ammo', '350,000'], ['steel', '324,180'], ['bauxite', '298,400'],
    ['torch', '1,420'], ['drum', '2,850'], ['devmat', '2,980'], ['screw', '845'],
] as const;

const EXPED = [
    { fleet: '2', disp: 'A2', name: '長距離練習航海', eta: '2:10:04' },
    { fleet: '3', disp: '5', name: '海上護衛任務', eta: '0:42:18' },
    { fleet: '4', disp: 'S1', name: '前衛支援任務（道中）', eta: '0:12:00' },
];
const NDOCK = [
    { ship: '長門改二', eta: '0:04:22' },
    { ship: '金剛改二丙', eta: '1:20:00' },
    { ship: '能代改二', eta: '3:05:40' },
    { ship: '雪風改二', eta: '5:11:08' },
];
const KDOCK = [
    { ship: '島風', eta: '完成', done: true },
    { ship: '夕立改二', eta: '2:00:00', done: false },
];
const QUESTS = [
    { no: 1, name: '敵艦隊を撃破せよ！', progress: '達成', done: true, detail: '勝利 3 次。回母港後可領取。' },
    { no: 2, name: '南西に進出せよ！', progress: '3/5', done: false, detail: '在南西諸島海域出擊並獲得勝利。' },
    { no: 3, name: 'はじめての補給！', progress: '受注中', done: false, detail: '進行一次補給。' },
    { no: 4, name: 'はじめての入渠！', progress: '1/1', done: false, detail: '入渠修復一艘艦娘。' },
    { no: 5, name: '艦隊の編成', progress: '受注中', done: false, detail: '編成一支艦隊。' },
    { no: 6, name: 'はじめての建造！', progress: '受注中', done: false, detail: '建造一艘艦娘。' },
    { no: 7, name: '遠征任務', progress: '2/3', done: false, detail: '成功完成遠征 3 次。' },
    { no: 8, name: '装備開發任務', progress: '受注中', done: false, detail: '開發一次裝備。' },
];

const extraCss = `
html, body { height: auto; overflow: auto; }
body { display: block; min-height: 0; padding: 16px; font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; background: var(--bg); color: var(--text); }
.pv-intro { max-width: 900px; font-size: 12px; color: var(--dim); line-height: 1.6; margin: 0 0 14px; }
.pv-intro b { color: var(--text); }
.pv-intro code { color: var(--sparkle); font-weight: 600; }
.pv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
.pv-bar-group { display: flex; align-items: center; gap: 4px; background: color-mix(in srgb, var(--panel) 80%, var(--bg)); padding: 2px 4px; border: 1px solid var(--line); border-radius: 8px; }
.pv-bar-group label { font-size: 11px; font-weight: 600; color: var(--brass); padding: 0 6px; }
.pv-bar button {
  background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 10px; font: 12px/1.4 inherit; cursor: pointer;
  transition: all 120ms ease;
}
.pv-bar button:hover { border-color: var(--brass); }
.pv-bar button.on { border-color: var(--brass); background: color-mix(in srgb, var(--brass) 16%, var(--panel)); color: var(--sparkle); font-weight: 600; }
.pv-wins { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.pv-win { width: 420px; flex: none; }
.pv-win-label { font-size: 12px; font-weight: 600; letter-spacing: var(--track-label); color: var(--brass); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
.pv-win-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--brass); background: color-mix(in srgb, var(--brass) 14%, transparent); color: var(--sparkle); }
.pv-measure { font-size: 11px; color: var(--dim); margin-top: 8px; font-variant-numeric: tabular-nums; }
.pv-measure b { color: var(--text); }
.pv-measure.ok b { color: #58a55c; }
.pv-measure.over b { color: var(--dmg-major); }
.pv-app {
  width: 420px; height: 850px; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: 0 4px 20px color-mix(in srgb, #000 25%, transparent);
  display: flex; flex-direction: column; overflow: hidden;
}
.pv-app #tabs button, .pv-app #fleetnav button { pointer-events: none; }
.pv-app #tabpanel { flex: none; height: 270px; box-sizing: border-box; }
.pv-fleet { flex: 1; min-height: 0; overflow: hidden; padding: 4px 10px 8px; }
.pv-ship {
  display: flex; gap: 8px; align-items: baseline; padding: 6px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  font-size: 12px;
}
.pv-ship b { color: var(--dim); width: 1.2em; font-weight: 400; }
.pv-ship span { flex: 1; }
.pv-ship i, .pv-ship em { font-style: normal; color: var(--dim); font-variant-numeric: tabular-nums; }
.pv-fleet-note { margin-top: 8px; font-size: 10px; color: var(--stub); letter-spacing: var(--track-tag); }
.exped-detail[hidden], .quest-detail[hidden] { display: none; }

/* ── 420px 高密度極簡現代化樣式（無框線濫用、依靠對比與間距） ────── */
.pv-refined #tab-general {
  gap: 6px;
  padding: 0;
}
.pv-refined .g-status {
  gap: 6px;
}

/* 1. 資源看板：純淨排版，靠對比與間距區分，無框線無卡片容器 */
.pv-refined .resblock {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-flow: row;
  gap: 3px 12px;
  padding: 2px 2px;
  background: transparent;
  border: none;
  font-size: 11px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  align-items: center;
}
.pv-refined .resblock .res-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
  min-width: 0;
  white-space: nowrap;
}
.pv-refined .resblock .res-item .mat-icon {
  width: 14px;
  height: 14px;
  flex: none;
}
/* 主資材：高對比文字清晰呈現，容納 350,000 六位數無省略 */
.pv-refined .resblock .res-item b {
  color: var(--text);
  font-weight: 600;
  letter-spacing: -0.01em;
}
/* 消耗資材：低對比調暗層次區分 */
.pv-refined .resblock .res-item.sec b {
  color: var(--dim);
  font-weight: 400;
}

/* 2. 運作看板：極簡三欄，無框線 Chip，依靠色線頂界與背景微對比 */
.pv-refined .g-occ {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}
.pv-refined .g-cat {
  position: relative;
  min-width: 0;
  border-top: 1px solid var(--line);
  padding-top: 4px;
}
.pv-refined .g-cat-exped { border-top-color: var(--brass); }
.pv-refined .g-cat-dock  { border-top-color: #7fd0ff; }
.pv-refined .g-cat-build { border-top-color: #58a55c; }

.pv-refined .g-cat > .t-tag {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  padding: 0 4px;
  background: var(--bg);
  height: 14px;
  display: flex;
  align-items: center;
}
.pv-refined .g-cat > .t-tag .t-icon {
  width: 13px;
  height: 13px;
}

.pv-refined .g-cat > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.pv-refined .g-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 21px;
  padding: 2px 5px;
  border-radius: 3px;
  background: var(--panel);
  border: none;
  color: var(--text);
  font-size: 11px;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  cursor: default;
  transition: background 80ms ease;
}
.pv-refined .g-chip[data-exped-fleet] {
  cursor: pointer;
}
.pv-refined .g-chip:hover {
  background: color-mix(in srgb, var(--line) 40%, var(--panel));
}
.pv-refined .g-chip[data-exped-fleet]:hover {
  background: color-mix(in srgb, var(--brass) 14%, var(--panel));
}
/* 艦隊編號：純淨高對比標註，無厚重外框 */
.pv-refined .g-chip .fleet-box {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  color: var(--sparkle);
  min-width: 12px;
  text-align: center;
}
.pv-refined .g-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.pv-refined .g-eta {
  flex: none;
  color: var(--brass);
  font-weight: 600;
  font-size: 11px;
  white-space: nowrap;
}
.pv-refined .g-chip .g-eta.grow {
  flex: 1;
  min-width: 0;
  color: var(--dim);
  font-weight: 500;
}
.pv-refined .g-chip > .g-eta:last-child {
  margin-left: auto;
  text-align: right;
}
/* 完成高亮：以顏色對比高亮（--sparkle），無邊框裝飾 */
.pv-refined .g-chip.done {
  background: color-mix(in srgb, var(--sparkle) 12%, var(--panel));
}
.pv-refined .g-chip.done .g-name {
  color: var(--sparkle);
  font-weight: 600;
}
.pv-refined .g-chip.done .g-eta {
  color: var(--sparkle);
  font-weight: 700;
}
.pv-refined .exped-detail {
  padding: 2px 6px;
  margin-top: 1px;
  font-size: 10px;
  color: var(--dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: color-mix(in srgb, var(--bg) 80%, var(--panel));
  border-left: 2px solid var(--brass);
}

/* 空工位：低對比靜態佔位，無外框無虛線框 */
.pv-refined .g-empty {
  min-height: 21px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  border: none;
  color: var(--stub);
  font-size: 10.5px;
  user-select: none;
}

/* 3. 任務清單區：平整雙欄斑馬紋條列，無框線，無裝飾藥丸標籤 */
.pv-refined .g-quest-block {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  border-top: 1px solid var(--line);
  padding-top: 4px;
}
.pv-refined .g-quest-block > .t-tag {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  padding: 0 4px;
  background: var(--bg);
  height: 14px;
  display: flex;
  align-items: center;
}
.pv-refined .g-quest-block > .t-tag .t-icon {
  width: 13px;
  height: 13px;
}

.pv-refined #quests {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: min-content;
  gap: 1px 10px;
  align-content: start;
  align-items: start;
}
.pv-refined .quest-cell {
  min-width: 0;
}
/* 任務列：無外框，以純淨 panel 背景微弱斑馬紋區隔奇數列 */
.pv-refined .quest-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 2.5px 6px;
  border-radius: 3px;
  cursor: pointer;
  min-height: 21px;
  background: transparent;
  border: none;
  line-height: 1.25;
  transition: background 80ms ease;
}
.pv-refined .quest-cell:nth-child(odd) .quest-row {
  background: var(--panel);
}
.pv-refined .quest-row:hover {
  background: color-mix(in srgb, var(--line) 40%, var(--panel));
}
.pv-refined .quest-row .grow {
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
}
/* 完成任務：文字以高亮對比（--sparkle），無邊框裝飾 */
.pv-refined .quest-row.done .grow {
  color: var(--sparkle);
  font-weight: 600;
}
/* 進度狀態：純粹等寬數字對齊，無邊框藥丸（pill）裝飾 */
.pv-refined .quest-row .q-prog {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--brass);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pv-refined .quest-row .q-st {
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--dim);
}
.pv-refined .quest-row.done .q-st {
  color: #58a55c;
  font-weight: 600;
}
.pv-refined .quest-detail {
  padding: 3px 6px 4px;
  font-size: 10px;
  color: var(--dim);
  line-height: 1.35;
  background: color-mix(in srgb, var(--panel) 70%, var(--bg));
  border-left: 2px solid var(--brass);
  margin: 1px 0 2px;
}
`;

const page = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>一般分頁高密度重構預覽（標準 420px）</title>
<style>${css}${extraCss}</style>
</head>
<body>
  <div class="pv-intro">
    <b>【一般資訊頁 · 極簡現代化 420px 重構預覽】</b><br>
    落實「<b>減少框線濫用、依靠對比與間距區分資訊、零多餘特效與過度裝飾</b>」原則，專注工具本質：<br>
    1. <b>完全去除框線濫用</b>：徹底移除資材外框、運作 Chip 外框、任務列外框與藥丸框線，純化視覺焦點。<br>
    2. <b>對比與間距分級</b>：主資材（加粗高對比）／消耗材（調暗低對比）完整容納 <b>350,000 六位數</b>；區塊以精確間距自然聚合。<br>
    3. <b>零特效與無過度裝飾</b>：移除陰影、縮放與發光，任務列採純淨輕量斑馬紋，狀態與進度以純粹等寬數字與語意色彩自然呈現。
  </div>
  <div class="pv-bar">
    <div class="pv-bar-group">
      <label>檢視方案</label>
      <button type="button" data-view="compare" class="on">對照檢視 (A vs B)</button>
      <button type="button" data-view="refined">方案 B (全新精簡排版)</button>
      <button type="button" data-view="baseline">方案 A (現行基準)</button>
    </div>
    <div class="pv-bar-group">
      <label>情境狀態</label>
      <button type="button" data-sc="full" class="on">全滿活躍 (8任務+滿工位)</button>
      <button type="button" data-sc="complete">完成待領取</button>
      <button type="button" data-sc="sparse">工位空置 (展示 Stub)</button>
    </div>
    <button type="button" data-theme>切換 亮／暗 色主題</button>
  </div>
  <div class="pv-wins" id="wins"></div>
<script>
const DATA = ${JSON.stringify({ RES, EXPED, NDOCK, KDOCK, QUESTS })};
const ICONS = ${JSON.stringify({
    mat: Object.fromEntries(RES.map(([f]) => [f, mat(f)])),
    tag: { exped: tag('exped'), dock: tag('dock'), build: tag('build'), quest: tag('quest') },
})};
const EMPTY = ${JSON.stringify(t('common.empty'))};
const MAT_TITLE = ${JSON.stringify(Object.fromEntries(RES.map(([f]) => [f, t(`mat.${f}.full`)])))};
const CAT_TITLE = ${JSON.stringify({
    exped: t('tab.exped'),
    dock: t('section.dock'),
    build: t('section.build'),
    quest: t('section.quest'),
})};
const SHIPS = ['長門改二', '陸奥改二', '金剛改二丙', '比叡改二丙', '能代改二', '雪風改二'];

let scenario = 'full';
let viewMode = 'compare';

function resHtml() {
  return DATA.RES.map(([file, n], i) =>
    '<span class="res-item' + (i >= 4 ? ' sec' : '') + '" title="' + MAT_TITLE[file] + '">' +
    ICONS.mat[file] + ' <b>' + n + '</b></span>'
  ).join('');
}
function expedList() {
  return scenario === 'sparse' ? DATA.EXPED.slice(0, 1) : DATA.EXPED;
}
function dockList() {
  return scenario === 'sparse' ? DATA.NDOCK.slice(0, 1) : DATA.NDOCK;
}
function buildList() {
  return scenario === 'complete' ? DATA.KDOCK : (scenario === 'sparse' ? [] : DATA.KDOCK.filter(k => !k.done));
}
function questCells() {
  return DATA.QUESTS.map(q => {
    const isDone = q.done;
    const isProg = !isDone && q.progress !== '受注中';
    const progLabel = isProg 
      ? '<span class="q-prog" title="進度">' + q.progress + '</span>'
      : '<span class="q-st">' + (isDone ? '達成' : '受注中') + '</span>';
    return '<div class="quest-cell">' +
      '<div class="quest-row' + (isDone ? ' done' : '') + '" data-no="' + q.no + '">' +
        '<span class="grow" title="' + q.name + '">' + q.name + '</span>' +
        progLabel +
      '</div>' +
      '<div class="quest-detail" hidden>' + q.detail + '</div>' +
    '</div>';
  }).join('');
}
function emptyRow(stubText) {
  return '<div class="g-empty">' + (stubText || EMPTY) + '</div>';
}
function catCol(kind, body, stubText) {
  return '<div class="g-cat g-cat-' + kind + '" title="' + CAT_TITLE[kind] + '">' +
    '<span class="t-tag tt-' + kind + '">' + ICONS.tag[kind] + '</span>' +
    '<div>' + (body || emptyRow(stubText)) + '</div>' +
  '</div>';
}
function generalInner(isRefined) {
  const exped = expedList().map(e =>
    '<div class="g-item">' +
      '<div class="g-chip" data-exped-fleet="' + e.fleet + '" title="' + e.name + '">' +
        '<span class="fleet-box">' + e.fleet + '</span>' +
        '<span class="g-eta grow">' + e.disp + '</span>' +
        '<span class="g-eta">' + e.eta + '</span>' +
      '</div>' +
      '<div class="exped-detail" hidden>' + e.name + '</div>' +
    '</div>'
  ).join('');
  const docks = dockList().map(n =>
    '<div class="g-chip">' +
      '<span class="g-name" title="' + n.ship + '">' + n.ship + '</span>' +
      '<span class="g-eta">' + n.eta + '</span>' +
    '</div>'
  ).join('');
  const builds = buildList().map(k =>
    '<div class="g-chip' + (k.done ? ' done' : '') + '">' +
      '<span class="g-name" title="' + k.ship + '">' + k.ship + '</span>' +
      '<span class="g-eta">' + k.eta + '</span>' +
    '</div>'
  ).join('');
  const stubText = EMPTY;
  return '<div class="g-status">' +
    '<div class="resblock">' + resHtml() + '</div>' +
    '<div class="g-occ">' +
      catCol('exped', exped, stubText) +
      catCol('dock', docks, stubText) +
      catCol('build', builds, stubText) +
    '</div>' +
  '</div>' +
  '<div class="g-quest-block" title="' + CAT_TITLE.quest + '">' +
    '<span class="t-tag tt-quest">' + ICONS.tag.quest + '</span>' +
    '<div id="quests">' + questCells() + '</div>' +
  '</div>';
}
function renderAppWin(isRefined, title, badge) {
  const inner = generalInner(isRefined);
  const cls = isRefined ? 'pv-refined' : 'pv-baseline';
  const ships = SHIPS.map((n, i) =>
    '<div class="pv-ship"><b>' + (i + 1) + '</b><span>' + n + '</span><i>Lv99</i><em>77/77</em></div>'
  ).join('');
  return '<div class="pv-win">' +
    '<div class="pv-win-label">' +
      '<span>' + title + '</span>' +
      '<span class="pv-win-badge">' + badge + '</span>' +
    '</div>' +
    '<div class="pv-app ' + cls + '">' +
      '<div id="header">' +
        '<span class="idbox"><span class="nick">第一艦隊</span><span class="num">Lv120</span></span>' +
        '<span class="grow"></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/ship.svg" alt=""> <b>198/250</b></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/equip.svg" alt=""> <b>812/900</b></span>' +
      '</div>' +
      '<div id="tabs">' +
        '<button type="button" class="on">一般</button>' +
        '<button type="button">出擊</button>' +
        '<button type="button">遠征</button>' +
        '<button type="button">工廠</button>' +
        '<button type="button">調度</button>' +
      '</div>' +
      '<div id="tabpanel" class="has-general"><div id="tab-general">' + inner + '</div></div>' +
      '<div id="fleetnav">' +
        '<button type="button" class="on">1</button><button type="button">2</button>' +
        '<button type="button">3</button><button type="button">4</button>' +
        '<button type="button">連合艦隊</button><span class="grow"></span>' +
        '<button type="button">基地航空隊</button>' +
      '</div>' +
      '<div class="pv-fleet">' + ships +
        '<div class="pv-fleet-note">編成區（高度參照）</div>' +
      '</div>' +
    '</div>' +
    '<div class="pv-measure"></div>' +
  '</div>';
}
function render() {
  const container = document.getElementById('wins');
  if (viewMode === 'compare') {
    container.innerHTML = 
      renderAppWin(false, '方案 A · 現行基準 (Baseline)', '420px') +
      renderAppWin(true, '方案 B · 全新精簡現代化排版 (Redesigned)', '420px 零捲軸');
  } else if (viewMode === 'refined') {
    container.innerHTML = renderAppWin(true, '方案 B · 全新精簡現代化排版 (Redesigned)', '420px 零捲軸');
  } else {
    container.innerHTML = renderAppWin(false, '方案 A · 現行基準 (Baseline)', '420px');
  }
  bind();
}
function bind() {
  document.querySelectorAll('[data-exped-fleet]').forEach(row => {
    row.addEventListener('click', () => {
      const item = row.parentElement;
      const d = item.querySelector('.exped-detail');
      if (d) d.hidden = !d.hidden;
      measure();
    });
  });
  document.querySelectorAll('.quest-row').forEach(row => {
    row.addEventListener('click', () => {
      const cell = row.parentElement;
      const d = cell.querySelector('.quest-detail');
      if (d) {
        d.hidden = !d.hidden;
      }
      measure();
    });
  });
  measure();
}
function measure() {
  document.querySelectorAll('.pv-win').forEach(win => {
    const el = win.querySelector('.pv-measure');
    const panel = win.querySelector('#tabpanel');
    const quests = win.querySelector('#quests');
    if (!el || !panel) return;
    const avail = Math.round(panel.clientHeight);
    const scrollH = Math.round(panel.scrollHeight);
    const qh = quests ? Math.round(quests.clientHeight) : 0;
    const over = scrollH > avail;
    el.classList.toggle('over', over);
    el.classList.toggle('ok', !over);
    el.innerHTML = '資訊區高度: <b>' + avail + 'px</b> (內容: ' + scrollH + 'px) ｜ 任務區: ' + qh + 'px ｜ 狀態: <b>' +
      (over ? '⚠ 產生外部捲軸 (' + scrollH + 'px > ' + avail + 'px)' : '✓ 完美貼合，無溢出捲軸') + '</b>';
  });
}
document.querySelectorAll('[data-sc]').forEach(b => {
  b.addEventListener('click', () => {
    scenario = b.getAttribute('data-sc');
    document.querySelectorAll('[data-sc]').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
});
document.querySelectorAll('[data-view]').forEach(b => {
  b.addEventListener('click', () => {
    viewMode = b.getAttribute('data-view');
    document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
});
document.querySelector('[data-theme]').addEventListener('click', () => {
  const on = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
});
render();
</script>
</body></html>`
    .replace(/src="\/icons\//g, 'src="/public/icons/')
    .replace(/src=\\"\/icons\//g, 'src=\\"/public/icons/');

mkdirSync(resolve(root, '.preview'), { recursive: true });
const dark = resolve(root, '.preview/panel-general.html');
const light = resolve(root, '.preview/panel-general-light.html');
writeFileSync(dark, page);
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log('Generated:');
console.log(' - ' + dark);
console.log(' - ' + light);
