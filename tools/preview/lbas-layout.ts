// 基地航空隊版面的**離線高度驗收**（開發用，不進擴充 bundle）。
//
// 為什麼需要它：LBAS 區塊的硬約束是「一個海域最多三隊、一隊最多四個中隊，**三隊必須在
// 不捲動的前提下全部看得完**」，而實機驗證要有已開放基地的活動海域＋三隊都配好，成本高
// 且無法隨時重現。本腳本套面板的**同一份 CSS**、同一份 markup，用最壞情況的假資料量出
// 實際高度並畫出可用高度線，離線即可判斷改動有沒有把版面弄爆。
//
//   npx vite-node --config vitest.config.ts tools/preview/lbas-layout.ts
//   → .preview/lbas-layout{,-light}.html（瀏覽器直接開）
//
// ⚠️ 本檔的 `card()` 是 panel/main.ts `renderAirBases()` 的**逐字鏡像**（那支綁在 DOM 上
// 不能直接匯入）。改了那邊就要改這邊，否則量到的是舊版面。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { esc, gearIconHtml } from '../../utils/html-escape';
import type { AirBaseView, SquadronView } from '../../utils/state';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
setLang('zh-TW');

// LBAS 區塊與 #fleets 共用同一塊可用高度：850 窗高扣掉 header／分頁列／#tabpanel 270px／
// #fleetnav 之後約此數。超過就是實機要捲動的量。
const BUDGET = 440;

// 面板的兩支符號函式（與 panel/main.ts 同一份轉寫；那邊是 module-local 不能匯入）
const alvMark = (alv: number) =>
    ['', '|', '||', '|||', '/', '//', '///', '&gt;&gt;'][Math.min(7, Math.max(0, alv))];
const impMark = (level: number) => (level >= 10 ? '★' : level > 0 ? String(level) : '');

// ── 假資料 ─────────────────────────────────────────────────────────────────
// 名稱刻意取真實遊戲裡最長的幾個（隼III型甲(54戦隊)／付岩井隊／飛行第244戦隊），
// 版面壓力才是真的；另含機數耗損與疲勞標記，把一列塞到最滿。
const sq = (o: Partial<SquadronView> & { name: string; short: string; cat: string; icon: number }): SquadronView => ({
    slotId: 0, state: 1, mst: 0, level: 0, alv: 0, count: 18, maxCount: 18, cond: null, ...o,
});
const EMPTY: SquadronView = {
    slotId: 0, state: 2, name: t('lbas.notDeployed'), short: '—', cat: 'c-etc',
    icon: -1, mst: 0, level: 0, alv: 0, count: 0, maxCount: 0, cond: null,
};
const BASE1: AirBaseView = {
    areaId: 62, rid: 1, name: '第一基地', actionKind: 1, distance: 7,
    airPower: { min: 320, max: 348 },
    condAsOf: null, condRate: 4,
    squadrons: [
        sq({ name: '一式戦 隼III型甲(54戦隊)', short: '戦', cat: 'c-ftr', icon: 6, level: 10, alv: 7 }),
        sq({ name: '二式陸上偵察機(熟練)', short: '偵', cat: 'c-rec', icon: 9, count: 4, maxCount: 4, alv: 7, cond: 2 }),
        sq({ name: '零戦五二型丙(付岩井隊)', short: '戦', cat: 'c-ftr', icon: 6, level: 4, alv: 7, cond: 1 }),
        sq({ name: '四式重爆 飛龍(熟練)', short: '攻', cat: 'c-tb', icon: 8, level: 6, alv: 5, cond: 3 }),
    ],
};
const BASE2: AirBaseView = {
    areaId: 62, rid: 2, name: '第二基地', actionKind: 2, distance: 6,
    airPower: { min: 288, max: 301 },
    condAsOf: null, condRate: 4,
    squadrons: [
        sq({ name: '雷電', short: '戦', cat: 'c-ftr', icon: 6, level: 10, alv: 7 }),
        sq({ name: '紫電改(三四三空) 戦闘301', short: '戦', cat: 'c-ftr', icon: 6, level: 7, alv: 7 }),
        sq({ name: 'Fw 190 A-5/U2', short: '戦', cat: 'c-ftr', icon: 6, count: 9, alv: 4, cond: 2 }),
        sq({ name: '三式戦 飛燕(飛行第244戦隊)', short: '戦', cat: 'c-ftr', icon: 6, level: 3, alv: 6 }),
    ],
};
const BASE3: AirBaseView = {
    areaId: 62, rid: 3, name: '第三基地', actionKind: 0, distance: 4,
    airPower: { min: 176, max: 180 },
    condAsOf: null, condRate: 4,
    squadrons: [
        sq({ name: '銀河', short: '攻', cat: 'c-tb', icon: 8, level: 2, alv: 3 }),
        sq({ name: '二式大艇', short: '水', cat: 'c-sea', icon: 10, count: 4, maxCount: 4 }),
        EMPTY, EMPTY,
    ],
};
// 最壞情況＝三隊全滿、名稱全長、全部有改修/熟練標記
const BASE3_FULL: AirBaseView = {
    ...BASE3, actionKind: 3,
    squadrons: [
        sq({ name: '二式陸上偵察機(熟練)', short: '偵', cat: 'c-rec', icon: 9, count: 4, maxCount: 4, alv: 7 }),
        sq({ name: '一式陸攻 二二型甲(熟練)', short: '攻', cat: 'c-tb', icon: 8, level: 8, alv: 7, cond: 2 }),
        sq({ name: '深山改', short: '攻', cat: 'c-tb', icon: 8, level: 10, alv: 6 }),
        sq({ name: '零式艦戦21型(熟練)', short: '戦', cat: 'c-ftr', icon: 6, level: 10, alv: 7, count: 17 }),
    ],
};
const ACTION_LABEL = ['待機', '出擊', '防空', '退避', '休息'];

const airStr = (ab: AirBaseView) =>
    ab.airPower.min === ab.airPower.max ? `${ab.airPower.min}` : `${ab.airPower.min}~${ab.airPower.max}`;
// 顯示碼 0=全滿／1=輕度(無標記)／2=橙／3=赤（見 GameState.lbasCondState，四份真封包定案）
const condLabel = (cond: number | null) => (cond === 2 || cond === 3 ? '疲勞'
    : cond === 1 ? '輕度疲勞' : cond === 0 || cond == null ? '' : `不明(${cond})`);
const condState = (cond: number | null) => (cond === 2 ? 'tired' : cond === 3 ? 'exhausted'
    : cond === 1 ? 'mild' : 'unknown');

// ── 疲勞標記的表現候選 ─────────────────────────────────────────────────────
// 遊戲內是三段（內部 cond 30–46 無標記／20–29 黃臉／0–19 紅臉），封包給的 `api_cond` 是
// 四段顯示碼（**0=全滿／1=輕度(無標記)／2=黃／3=紅**，四份真封包定案），故顯示層只是換符號。文字「疲勞」要進三語字典，
// 符號則零 i18n——但符號本身必須自己講得清「黃 < 紅」的嚴重度階序。
type CondStyle = (cond: number | null) => string;

/** 內聯 SVG 表情：inline 才吃得到 currentColor（圖示走 <img> 時吃不到外部 CSS） */
const faceSvg = (kind: 'tired' | 'exhausted') => `<svg class="cond-face" viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3"/>
  ${kind === 'tired'
        // 黃臉：平眼平嘴——「還撐得住但該休息了」
        ? `<circle cx="5.6" cy="6.5" r=".95" fill="currentColor"/><circle cx="10.4" cy="6.5" r=".95" fill="currentColor"/>
     <path d="M5.3 10.6h5.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>`
        // 紅臉：閉眼＋苦笑嘴——階序一眼看得出比黃臉更慘
        : `<path d="M4.4 6.3l2.2 1.2M11.6 6.3l-2.2 1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>
     <path d="M5.3 11.4q2.7-2.6 5.4 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>`}
</svg>`;

const COND_STYLES: Record<string, { title: string; note: string; render: CondStyle }> = {
    // 現況：三語字典各一條，且雙欄下「疲勞」兩字吃掉中隊名約 30px
    text: {
        title: '（舊版）文字',
        note: '「疲勞」文字。需要三語字典，且在雙欄下吃掉中隊名約 30px 寬。已改為 B。',
        render: c => (condLabel(c) ? `<span class="sq-cond cond-${condState(c)}">${condLabel(c)}</span>` : ''),
    },
    emoji: {
        title: 'A：Unicode 表情符號',
        note: '零資產零 i18n，但字形由 OS 決定（macOS／Windows／Linux 長得不一樣），顏色也不受主題控制、對不上面板既有的黃／紅語意色。',
        render: c => (condState(c) === 'tired' ? `<span class="sq-cond emoji" title="疲勞">😥</span>`
            : condState(c) === 'exhausted' ? `<span class="sq-cond emoji" title="疲勞">😫</span>` : ''),
    },
    face: {
        title: 'B：內聯 SVG 表情（現行）',
        note: '自家向量、跨平台一致，且因為是<b>內聯</b>（非 &lt;img&gt;）吃得到 currentColor，直接沿用既有的 --dmg-mid／--dmg-major 語意色。黃臉平嘴、紅臉閉眼苦笑，嚴重度階序自明。',
        render: c => (condState(c) === 'tired' ? `<span class="sq-cond face cond-tired" title="疲勞">${faceSvg('tired')}</span>`
            : condState(c) === 'exhausted' ? `<span class="sq-cond face cond-exhausted" title="疲勞">${faceSvg('exhausted')}</span>`
                // 輕度疲勞（cond 1）：遊戲本身沒有標記，只給一顆安靜的空心點
                : condState(c) === 'mild' ? `<span class="sq-cond mild" title="輕度疲勞（遊戲未顯示標記）"><i class="cond-dot"></i></span>` : ''),
    },
    dot: {
        title: 'C：色點',
        note: '最省空間，但黃點／紅點只有顏色差；色覺障礙者與縮小後幾乎分不出兩段。',
        render: c => (condState(c) === 'tired' || condState(c) === 'exhausted'
            ? `<span class="sq-cond dot cond-${condState(c)}" title="疲勞"><i class="cond-dot"></i></span>` : ''),
    },
};

/** panel/main.ts renderAirBases() 的逐字鏡像——改那邊要同步改這裡 */
const card = (ab: AirBaseView, cond: CondStyle = COND_STYLES.face!.render) => `<div class="ab-card">
  <div class="ab-head1">
    <span class="ab-name">${esc(ab.name)}</span>
    <span class="ab-inline-stats">${t('fleet.airPower')} <b>${airStr(ab)}</b> · ${t('lbas.radius')} <b>${ab.distance}</b></span>
    <span class="grow"></span>
    <span class="ab-action act-${Math.min(ab.actionKind, 4)}">${ACTION_LABEL[ab.actionKind]}</span>
  </div>
  <div class="ab-sq-grid">${ab.squadrons.map(s => s.state !== 1
    ? `<div class="ab-sq empty-sq"><span class="sq-name">${t('lbas.notDeployed')}</span></div>`
    : `<div class="ab-sq">
        <span class="sq-chip ${s.cat}" title="${esc(s.name)}${s.level ? ` ★${s.level}` : ''}${s.alv ? ` »${s.alv}` : ''}">${gearIconHtml(s.icon, s.short)}${s.alv ? `<u>${alvMark(s.alv)}</u>` : ''}${s.level ? `<b>${impMark(s.level)}</b>` : ''}</span>
        <span class="sq-name" title="${esc(s.name)}">${esc(s.name)}</span>
        <span class="sq-count ${s.count < s.maxCount ? 'depleted' : ''}">${s.count}/${s.maxCount}</span>
        ${cond(s.cond)}
      </div>`).join('')}</div>
</div>`;

const tabsHtml = `<div class="ab-tabs"><button class="on">南西諸島海域</button><button>中部海域</button></div>`;
const labelHtml = `<h3 class="ab-area-label"><span>南西諸島海域</span><span class="ab-maintenance">整備 Lv.2</span></h3>`;

function column(key: string, title: string, note: string, bases: AirBaseView[]): string {
    return `<div class="pv-col">
      <div class="pv-title">${title}</div>
      <div class="pv-note">${note}</div>
      <div class="pv-frame limit">
        <div id="pv-${key}" class="air-bases">${tabsHtml}${labelHtml}${bases.map(b => card(b)).join('')}</div>
        <div class="pv-limit"><span>可用高度 ≈${BUDGET}px</span></div>
      </div>
      <div class="pv-measure" data-for="pv-${key}"></div>
    </div>`;
}

// 疲勞標記比較用：一隊四個中隊剛好把四種狀態各擺一個（無標記／黃／紅／紅＋機數耗損）
const COND_DEMO: AirBaseView = {
    ...BASE1, actionKind: 1,
    squadrons: [
        sq({ name: '一式戦 隼III型甲(54戦隊)', short: '戦', cat: 'c-ftr', icon: 6, level: 10, alv: 7 }),
        sq({ name: '二式陸上偵察機(熟練)', short: '偵', cat: 'c-rec', icon: 9, count: 4, maxCount: 4, alv: 7, cond: 2 }),
        sq({ name: '零戦五二型丙(付岩井隊)', short: '戦', cat: 'c-ftr', icon: 6, level: 4, alv: 7, cond: 2 }),
        sq({ name: '四式重爆 飛龍(熟練)', short: '攻', cat: 'c-tb', icon: 8, level: 6, alv: 5, count: 9, cond: 2 }),
    ],
};

function condColumn(key: string): string {
    const s = COND_STYLES[key]!;
    return `<div class="pv-col">
      <div class="pv-title">${s.title}</div>
      <div class="pv-note">${s.note}</div>
      <div class="pv-frame"><div class="air-bases">${card(COND_DEMO, s.render)}</div></div>
      <div class="pv-zoom"><span>放大 3×（實機是 11px，先確認縮到那麼小還讀得出來）</span>
        <div class="pv-zoom-in"><div class="air-bases">${card(COND_DEMO, s.render)}</div></div>
      </div>
    </div>`;
}

const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));

const page = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<title>基地航空隊版面預覽</title><style>${css}
body { padding: 16px; background: var(--bg); }
.pv-intro { color: var(--dim); font-size: 12px; max-width: 900px; line-height: 1.7; }
.pv-intro b { color: var(--text); }
.pv-cols { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; margin-top: 14px; }
.pv-col { width: 420px; }
.pv-title { font-size: 13px; font-weight: 600; color: var(--brass); margin-bottom: 2px; }
.pv-note { font-size: 11px; color: var(--dim); min-height: 32px; line-height: 1.5; }
/* 面板實寬 420px；虛線＝可用高度上限 */
.pv-frame { position: relative; width: 420px; border: 1px solid var(--line); }
/* 高度驗收欄：框本身至少畫到可用高度線，否則那條線會落到框外、橫穿下方文字 */
.pv-frame.limit { min-height: ${BUDGET + 24}px; }
.pv-limit { position: absolute; left: 0; right: 0; top: ${BUDGET}px; border-top: 2px dashed var(--dmg-major);
            pointer-events: none; }
.pv-limit span { position: absolute; right: 2px; top: 2px; font-size: 10px; color: var(--dmg-major); }
.pv-measure { font-size: 11px; color: var(--dim); margin-top: 6px; font-variant-numeric: tabular-nums; }
.pv-measure b { color: var(--text); }
.pv-measure.over b { color: var(--dmg-major); }
.pv-h2 { color: var(--brass); font-size: 14px; margin: 26px 0 4px; border-top: 1px solid var(--line); padding-top: 18px; }
.pv-navs { margin-top: 12px; }
.pv-nav-row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.pv-nav-label { width: 200px; font-size: 11px; color: var(--dim); text-align: right; }
/* 面板實寬，按鈕間距與換行壓力才是真的 */
.pv-nav-row #fleetnav { width: 420px; }
.pv-zoom { margin-top: 8px; font-size: 11px; color: var(--dim); }
/* 3× 檢視：實機只有 11px，符號在那個尺寸下還能不能分辨才是重點。
   原點取右上角——疲勞標記在每格的最右端，從左上角放大會剛好把它裁掉。 */
.pv-zoom-in { width: 420px; height: 280px; overflow: hidden; margin-top: 4px; }
.pv-zoom-in .air-bases { width: 420px; transform: scale(3); transform-origin: 100% 0; }

/* ── 落選候選的專屬 CSS（B 已搬進 panel/index.html，這裡不再重複定義） ── */
/* A：emoji 用系統字形，字級要略降才不會比同列文字高 */
.sq-cond.emoji { font-size: 10px; line-height: 1; }
/* C：色點（落選候選專用；必須限定在 .sq-cond.dot 底下，否則會蓋掉面板本身
   .sq-cond.mild .cond-dot 的空心點樣式） */
.sq-cond.dot .cond-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
</style></head>
<body>
<div class="pv-intro">
  <b>基地航空隊版面驗收</b>——面板 markup 與 CSS 原樣，假資料取遊戲中最長的中隊名並含機數
  耗損／疲勞標記。紅色虛線＝可用高度（850 窗高扣掉 header／分頁／<code>#tabpanel</code>
  270px／<code>#fleetnav</code>）。<b>越過虛線就是實機要捲動的量</b>；每欄下方是實測高度。
</div>
<div class="pv-cols">
${column('full', '最壞情況：三隊 × 四中隊全配備', '三隊全滿、名稱全長、全部帶改修/熟練標記。這一欄不越線才算過。', [BASE1, BASE2, BASE3_FULL])}
${column('mixed', '常見情況：含未配備與待機隊', '第三隊只配兩個中隊，其餘兩格未配備。', [BASE1, BASE2, BASE3])}
</div>

<h2 class="pv-h2">疲勞標記的表現候選</h2>
<div class="pv-intro">
  遊戲內是三段：<b>cond 30–46 無標記／20–29 黃臉／0–19 紅臉</b>；封包的 <code>api_cond</code>
  已經是對應的狀態碼（1=無／2=黃／3=紅），顯示層只是換符號。示範用的一隊四個中隊剛好各擺
  一種狀態（無／黃／紅／紅＋機數耗損 9/18）。每欄下方是 3× 放大版——<b>實機只有 11px，
  縮到那個尺寸還分得出黃紅兩段才算數</b>。
</div>
<div class="pv-cols">
${['text', 'emoji', 'face', 'dot'].map(condColumn).join('')}
</div>

<h2 class="pv-h2">編成列的「基地航空隊」鈕</h2>
<div class="pv-intro">
  有中隊帶疲勞標記時，整顆鈕的文字與外框轉成對應語意色（取最嚴重的一段）。
  <b>疲勞（框線色）與未補給（外圈紅框 <code>.attn</code>）是兩套獨立語意，可同時成立</b>；
  面板正開著 LBAS 分區（<code>.on</code>）時也要照樣看得到疲勞。
</div>
<div class="pv-navs">
${[
        ['一般', ''],
        ['輕度疲勞（cond 20–29）', 'cond-tired'],
        ['重度疲勞（cond 0–19）', 'cond-exhausted'],
        ['重度疲勞＋未補給', 'cond-exhausted attn'],
        ['輕度疲勞＋分區開啟中', 'cond-tired on'],
    ].map(([label, cls]) => `<div class="pv-nav-row">
      <div class="pv-nav-label">${label}</div>
      <!-- id 重複是刻意的：面板 CSS 以 #fleetnav 為選擇器，而 CSS 的 id 選擇器會套到每個
           帶該 id 的元素（只有 getElementById 取第一個）。預覽不用 JS 取這些節點。 -->
      <div id="fleetnav"><button>1</button><button class="attn">2</button><button>3</button><button>4</button>
        <button>連合艦隊</button><span class="grow"></span>
        <button class="${cls}">基地航空隊</button></div>
    </div>`).join('')}
</div>
<script>
for (const m of document.querySelectorAll('.pv-measure')) {
  const h = Math.round(document.getElementById(m.dataset.for).getBoundingClientRect().height);
  m.classList.toggle('over', h > ${BUDGET});
  m.innerHTML = '實測高度 <b>' + h + 'px</b>' + (h > ${BUDGET} ? '（超出 ' + (h - ${BUDGET}) + 'px，需捲動）' : '（餘裕 ' + (${BUDGET} - h) + 'px）');
}
</script>
</body></html>`
    .replace(/src="\/icons\//g, `src="${resolve(root, 'public/icons')}/`);

mkdirSync(resolve(root, '.preview'), { recursive: true });
const out = resolve(root, '.preview/lbas-layout.html');
writeFileSync(out, page);
// 亮色主題也要看（design-guidelines §1.1）
const light = resolve(root, '.preview/lbas-layout-light.html');
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log(out);
console.log(light);
