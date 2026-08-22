// 面板「一般」分頁的可互動離線預覽（開發用，不進擴充 bundle）。
// 套 panel/index.html 的同一份 CSS，產出 420×850 實窗：資源抬頭＋遠征／入渠／建造
// 三欄並排＋任務主面。可切情境、點遠征列／任務列展開；編成區只提供整體高度參照。
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

const RES = [
    ['fuel', '12,450'], ['ammo', '8,200'], ['steel', '15,080'], ['bauxite', '9,340'],
    ['torch', '24'], ['drum', '18'], ['devmat', '86'], ['screw', '12'],
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
    { no: 8, name: '装備開発任務', progress: '受注中', done: false, detail: '開發一次裝備。' },
];

const extraCss = `
html, body { height: auto; overflow: auto; }
body { display: block; min-height: 0; padding: 16px; }
.pv-intro { max-width: 900px; font-size: 12px; color: var(--dim); line-height: 1.7; margin: 0 0 12px; }
.pv-intro b { color: var(--text); }
.pv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.pv-bar button {
  background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 10px; font: 12px/1.4 inherit; cursor: pointer;
}
.pv-bar button.on { border-color: var(--brass); color: var(--sparkle); }
.pv-wins { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.pv-win { width: 420px; }
.pv-win-label { font-size: 11px; letter-spacing: var(--track-label); color: var(--brass); margin-bottom: 6px; }
.pv-measure { font-size: 11px; color: var(--dim); margin-top: 8px; font-variant-numeric: tabular-nums; }
.pv-measure b { color: var(--text); }
.pv-measure.over b { color: var(--dmg-major); }
.pv-app {
  width: 420px; height: 850px; background: var(--bg); border: 1px solid var(--line);
  display: flex; flex-direction: column; overflow: hidden;
}
.pv-app #tabs button, .pv-app #fleetnav button { pointer-events: none; }
.pv-app #tabpanel { flex: none; }
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
`;

const page = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>一般分頁預覽</title>
<style>${css}${extraCss}</style>
</head>
<body>
  <p class="pv-intro">
    <b>這是預覽，不是擴充本身。</b>
    資源圖示與數字成組；遠征／入渠／建造／任務皆以色線＋圖示騎在線上標身分；任務完整保留於兩欄清單，超出時只在任務區內捲動。
    點遠征列展開名稱；點任務列展開說明。編成區只提供高度參照。視窗外框 420×850，資訊區固定 270px。
  </p>
  <div class="pv-bar">
    <button type="button" data-sc="full" class="on">全滿、無事可領</button>
    <button type="button" data-sc="complete">有完成待領</button>
    <button type="button" data-sc="sparse">只有少數進行中</button>
    <button type="button" data-theme>亮／暗</button>
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
  return scenario === 'complete' ? DATA.KDOCK : DATA.KDOCK.filter(k => !k.done);
}
function questCells() {
  return DATA.QUESTS.map(q =>
    '<div class="quest-cell">' +
      '<div class="quest-row' + (q.done ? ' done' : '') + '" data-no="' + q.no + '">' +
        '<span class="grow" title="' + q.name + '">' + q.name + '</span>' +
        '<span class="num">' + q.progress + '</span>' +
      '</div>' +
      '<div class="quest-detail" hidden>' + q.detail + '</div>' +
    '</div>'
  ).join('');
}
function emptyRow() {
  return '<div class="g-empty">' + EMPTY + '</div>';
}
function catCol(kind, body) {
  return '<div class="g-cat g-cat-' + kind + '" title="' + CAT_TITLE[kind] + '">' +
    '<span class="t-tag tt-' + kind + '">' + ICONS.tag[kind] + '</span>' +
    '<div>' + (body || emptyRow()) + '</div>' +
  '</div>';
}
function generalInner() {
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
  return '<div class="g-status">' +
    '<div class="resblock">' + resHtml() + '</div>' +
    '<div class="g-occ">' +
      catCol('exped', exped) +
      catCol('dock', docks) +
      catCol('build', builds) +
    '</div>' +
  '</div>' +
  '<div class="g-quest-block" title="' + CAT_TITLE.quest + '">' +
    '<span class="t-tag tt-quest">' + ICONS.tag.quest + '</span>' +
    '<div id="quests">' + questCells() + '</div>' +
  '</div>';
}
function chrome(inner) {
  const ships = SHIPS.map((n, i) =>
    '<div class="pv-ship"><b>' + (i + 1) + '</b><span>' + n + '</span><i>Lv99</i><em>77/77</em></div>'
  ).join('');
  return '<div class="pv-win">' +
    '<div class="pv-win-label">一般分頁 · 資源抬頭＋三欄＋任務主面</div>' +
    '<div class="pv-app">' +
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
function bind() {
  document.querySelectorAll('[data-exped-fleet]').forEach(row => {
    row.addEventListener('click', () => {
      const item = row.parentElement;
      const d = item.querySelector('.exped-detail');
      if (d) d.hidden = !d.hidden;
    });
  });
  document.querySelectorAll('.quest-row').forEach(row => {
    row.addEventListener('click', () => {
      const cell = row.parentElement;
      const d = cell.querySelector('.quest-detail');
      if (d) {
        d.hidden = !d.hidden;
        document.getElementById('quests').classList.toggle('has-open',
          !!document.querySelector('.quest-detail:not([hidden])'));
      }
    });
  });
  measure();
}
function measure() {
  const el = document.querySelector('.pv-measure');
  const panel = document.querySelector('.pv-app #tabpanel');
  const quests = document.querySelector('.pv-app #quests');
  if (!el || !panel) return;
  const avail = Math.round(panel.clientHeight);
  const qh = quests ? Math.round(quests.clientHeight) : 0;
  const over = panel.scrollHeight > avail + 1;
  el.classList.toggle('over', over);
  el.innerHTML = '資訊區固定 <b>' + avail + 'px</b>；任務主面約 ' + qh + 'px' +
    (over ? '（內部應自捲，抬頭不跟著走）' : '');
}
function render() {
  document.getElementById('wins').innerHTML = chrome(generalInner());
  bind();
}
document.querySelectorAll('[data-sc]').forEach(b => {
  b.addEventListener('click', () => {
    scenario = b.getAttribute('data-sc');
    document.querySelectorAll('[data-sc]').forEach(x => x.classList.toggle('on', x === b));
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
console.log(dark);
console.log(light);
