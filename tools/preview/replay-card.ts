// 出擊重播分享卡的離線設計稿（開發用，不進擴充 bundle）。
//
// 卡片固定 400×400：這是之後 steganography 容量公式的基準格（與 KC3Kai 同尺寸）。
// 看得見的是本專案自己的版面；艦名走 localizeShip，不用官方立繪、不抄 KC3Kai 封面。
// 編成只留艦名：論壇縮圖要靠字級讀得清楚，不放編號、等級、rank、艦種。
//
//   npx vite-node --config vitest.config.ts tools/preview/replay-card.ts
//   → .preview/replay-card.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventTermLabel } from '../../utils/event-calendar';
import { nodeLabel } from '../../utils/map-node-letters';
import { GameState } from '../../utils/state';
import { type Lang } from '../../utils/gamedata-i18n';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const state = new GameState();
state.applyEvent('api_start2/getData', readJson('samples/start2-master.json'));

const sample = readJson('samples/61-5-jibun-rengou-node52.json');
const map = `${sample.world}-${sample.mapnum}`;
const nodes: { letter: string; last: boolean }[] = sample.battles.map(
    (b: { node: number }, i: number, all: { node: number }[]) => ({
        letter: nodeLabel(map, b.node),
        last: i === all.length - 1,
    }),
);

const FLEET_COL: Record<Lang, [string, string]> = {
    'zh-TW': ['第一艦隊', '第二艦隊'],
    ja: ['第一艦隊', '第二艦隊'],
    en: ['Fleet 1', 'Fleet 2'],
};
const HINT: Record<Lang, string> = {
    'zh-TW': '上傳此圖即可重播',
    ja: 'この画像をアップロードして再生',
    en: 'Upload this image to replay',
};
const DATE_LOCALE: Record<Lang, string> = {
    'zh-TW': 'zh-TW',
    ja: 'ja-JP',
    en: 'en-US',
};

interface CardCopy {
    lang: Lang;
    brand: string;
    hq: string;
    event: string;
    mapNo: number;
    diff: string;
    combined: string;
    date: string;
    fleet1: string[];
    fleet2: string[];
    fleetTitle: [string, string];
    hint: string;
}

function buildCard(lang: Lang): CardCopy {
    setLang(lang);
    const names = (fleet: Array<{ mst_id: number }>) => fleet.map(s => state.shipName(s.mst_id));
    return {
        lang,
        brand: t('ov.brandShort'),
        hq: '暁の水平線',
        event: eventTermLabel(sample.world, t) ?? '',
        mapNo: sample.mapnum,
        diff: t(`ov.slDiff${sample.diff}` as 'ov.slDiff4'),
        combined: t('ov.slCombinedSurface'),
        date: new Date(sample.time * 1000).toLocaleDateString(DATE_LOCALE[lang], {
            year: 'numeric', month: '2-digit', day: '2-digit',
        }),
        fleet1: names(sample.fleet1),
        fleet2: names(sample.fleet2),
        fleetTitle: FLEET_COL[lang],
        hint: HINT[lang],
    };
}

function fleetCol(title: string, ships: string[]): string {
    const rows = ships.map(name => `<li>${name}</li>`).join('');
    return `<section class="col"><h3>${title}</h3><ol>${rows}</ol></section>`;
}

function nodesHtml(): string {
    return nodes.map(n =>
        `<span class="node${n.last ? ' last' : ''}">${n.letter}</span>`
    ).join('<i class="dot"></i>');
}

function cardHtml(card: CardCopy, theme: 'dark' | 'light'): string {
    return `<figure class="rc" data-theme="${theme}" lang="${card.lang}">
  <header>
    <p class="brand"><span>${card.brand}</span><span>REPLAY</span></p>
    <h1>${card.hq}</h1>
    <p class="meta">${card.combined} · ${card.date}</p>
  </header>
  <div class="map">
    <span class="term">${card.event}</span>
    <strong>E${card.mapNo}</strong>
    <span class="diff">${card.diff}</span>
  </div>
  <div class="fleets">
    ${fleetCol(card.fleetTitle[0], card.fleet1)}
    ${fleetCol(card.fleetTitle[1], card.fleet2)}
  </div>
  <footer>
    <div class="trail">${nodesHtml()}</div>
    <p class="hint">${card.hint}</p>
  </footer>
</figure>`;
}

const css = `
:root {
  --bg: #10151d; --panel: #182030; --line: #2a3548; --text: #cfd6e4;
  --dim: #7d8aa0; --brass: #b8860b; --sparkle: #e6c35c;
  --track-tag: .14em; --track-label: .12em; --track-title: -.01em;
}
.rc[data-theme="light"] {
  --bg: #eef0f4; --panel: #ffffff; --line: #d3d8e2; --text: #26303f;
  --dim: #6b7688; --brass: #9a6b0b; --sparkle: #8a6d1a;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px; background: #0b1016; color: #cfd6e4;
  font: 13px/1.5 system-ui, -apple-system, "Hiragino Sans", "Noto Sans TC", sans-serif;
}
h2 { font-size: 15px; letter-spacing: var(--track-title); line-height: 1.2; margin: 0 0 8px; }
.note { color: #7d8aa0; font-size: 12px; max-width: 880px; margin: 0 0 24px; }
.row { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
.cap { color: #7d8aa0; font-size: 11px; letter-spacing: var(--track-label); margin: 8px 0 0; }

.rc {
  width: 400px; height: 400px; margin: 0;
  padding: 8px 10px 8px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--brass) 10%, var(--panel)) 0 64px, var(--panel) 64px);
  color: var(--text);
  border: 2px solid var(--brass);
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brass) 28%, transparent);
  display: flex; flex-direction: column; gap: 6px;
  overflow: hidden;
}
.brand {
  display: flex; justify-content: space-between; align-items: baseline;
  margin: 0; font-size: 10px; letter-spacing: var(--track-tag); color: var(--dim);
}
.rc h1 {
  margin: 0; font-size: 20px; font-weight: 700; line-height: 1.1;
  letter-spacing: var(--track-title); color: var(--sparkle);
}
.meta { margin: 0; font-size: 12px; color: var(--dim); letter-spacing: var(--track-label); }
.map { display: flex; align-items: center; gap: 6px; min-width: 0; }
.term { font-size: 17px; color: var(--dim); letter-spacing: var(--track-label); }
.map strong { font-size: 22px; line-height: 1; letter-spacing: var(--track-title); color: var(--text); }
.diff {
  display: inline-flex; align-items: center; justify-content: center;
  height: 22px; box-sizing: border-box;
  font-size: 13px; font-style: normal; font-synthesis: none; font-weight: 700; line-height: 1; letter-spacing: var(--track-tag);
  color: var(--sparkle);
  border: 1px solid color-mix(in srgb, var(--sparkle) 55%, var(--line));
  background: color-mix(in srgb, var(--sparkle) 12%, transparent);
  border-radius: 4px; padding: 0 calc(5px - var(--track-tag)) 0 5px;
}
.fleets { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; flex: 1; min-height: 0; }
.col h3 {
  margin: 0 0 3px; font-size: 12px; font-weight: 600; color: var(--brass);
  letter-spacing: var(--track-label);
}
.col ol {
  margin: 0; padding: 0; list-style: none;
  display: grid; gap: 2px; align-content: start;
}
.col li {
  font-size: 20px; font-weight: 400; line-height: 1.2;
  letter-spacing: var(--track-title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.trail { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.node {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 22px; padding: 0 6px;
  border: 1px solid var(--line); border-radius: 4px;
  font-size: 12px; font-weight: 700; letter-spacing: var(--track-tag);
}
.node.last {
  color: var(--sparkle);
  border-color: color-mix(in srgb, var(--sparkle) 50%, var(--line));
}
.dot { width: 4px; height: 4px; border-radius: 50%; background: var(--line); flex: none; }
.hint { margin: 5px 0 0; font-size: 10px; color: var(--dim); letter-spacing: var(--track-label); }
`;

const zh = buildCard('zh-TW');
const ja = buildCard('ja');
const en = buildCard('en');

const html = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>出擊重播卡片 · 設計稿</title>
<style>${css}</style>
</head>
<body>
<h2>出擊重播分享卡 · 400×400</h2>
<p class="note">編成只留艦名，字級 16px，給論壇打開後能掃過一列就讀完。
一張 PNG 只能印一種語言；下面三張是同一場、三種介面語言。英文艦名較長，欄內會省略。</p>
<div class="row">
  <div>${cardHtml(zh, 'dark')}<p class="cap">繁中 · 預設匯出</p></div>
  <div>${cardHtml(ja, 'dark')}<p class="cap">日本語</p></div>
  <div>${cardHtml(en, 'dark')}<p class="cap">English</p></div>
</div>
</body>
</html>`;

const isolated = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>出擊重播卡片</title>
<style>
${css}
html, body { margin: 0; padding: 0; background: #10151d; }
</style>
</head>
<body>${cardHtml(zh, 'dark')}</body>
</html>`;

mkdirSync(resolve(root, '.preview'), { recursive: true });
const out = resolve(root, '.preview/replay-card.html');
writeFileSync(out, html);
writeFileSync(resolve(root, '.preview/replay-card-dark.html'), isolated);
console.log(out);
