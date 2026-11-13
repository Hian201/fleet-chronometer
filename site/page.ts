// 產品介紹頁的 HTML 模板：每種語言輸出一份靜態頁，demo 控制只依賴頁內的 JSON 文案。
import { COPY, LINKS, PAGE_PATH, type SiteLang } from './content';
import { THEME_BOOT } from './theme';
import { MAP_GEO } from '../utils/map-geo-data';
import { mapName } from '../utils/map-names';
import { changelogPath } from './changelog';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const LANGS: SiteLang[] = ['zh-TW', 'en', 'ja'];
// 架構圖有亮／暗兩份（tools/architecture/generate.py），依頁面主題只顯示其中一張；隱藏的那張不會載入。
const ARCH_SVG: Record<SiteLang, string> = { 'zh-TW': 'architecture-zh-TW', en: 'architecture-en', ja: 'architecture-ja' };

// 標題：「|」切出的每一段包成不換行的 span，只在段與段之間斷行。CJK 的瀏覽器斷行不認詞，
// 不標的話「看懂整支艦隊」可能在任何兩字之間被切開。
const heading = (s: string) => s.includes('|')
    ? s.split('|').map(part => `<span class="nw">${esc(part)}</span>`).join('<wbr>')
    : esc(s);

// 段落的詞語保護（Apple 中文官網以人工 nowrap 保護會被換行切斷的詞；這裡在建置時自動做）：
// CJK 段落以 Intl.Segmenter 斷詞，兩字以上的詞包成不換行，換行只落在詞與詞之間。
// ICU 會把部分詞切得太細（如「航海｜鐘」），KEEP 列出要合併回來的詞。
// 末尾另外把最後約四個字綁在一起，避免最後一行只剩一兩個字（孤字）；英文則以不換行空格
// 連接最後兩個單字。text-wrap: pretty 也處理孤字，但仍有瀏覽器不支援，這裡在 HTML 層保底。
const KEEP: Partial<Record<SiteLang, string[]>> = {
    'zh-TW': ['航海鐘', '燃彈', '同一個'],
    ja: ['受け取った', '受け取', '1つ', '残します', '読み取ります', '読み取り', '確かめて'],
};
const SEGMENTER_LOCALE: Record<SiteLang, string> = { 'zh-TW': 'zh-Hant-TW', ja: 'ja', en: 'en' };
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;
const CJK_TAIL = 4;

function words(lang: SiteLang, s: string): string[] {
    const segs = [...new Intl.Segmenter(SEGMENTER_LOCALE[lang], { granularity: 'word' }).segment(s)].map(x => x.segment);
    const out: string[] = [];
    for (let i = 0; i < segs.length;) {
        let merged = false;
        for (const term of KEEP[lang] ?? []) {
            let acc = '', j = i;
            while (j < segs.length && acc.length < term.length) acc += segs[j++];
            if (acc === term) { out.push(acc); i = j; merged = true; break; }
        }
        if (!merged) out.push(segs[i++]);
    }
    return out;
}

function para(lang: SiteLang, s: string): string {
    if (lang === 'en') {
        const i = s.lastIndexOf(' ');
        return i > 0 ? esc(s.slice(0, i)) + '&nbsp;' + esc(s.slice(i + 1)) : esc(s);
    }
    const tokens = words(lang, s);
    const cjkCount = (t: string) => [...t].filter(ch => CJK.test(ch)).length;
    let tail = tokens.length;
    for (let n = 0; tail > 0 && n < CJK_TAIL;) n += cjkCount(tokens[--tail]);
    const wrap = (t: string) => CJK.test(t) && [...t].length > 1 ? `<span class="nw">${esc(t)}</span>` : esc(t);
    return tokens.slice(0, tail).map(wrap).join('') + `<span class="nw">${esc(tokens.slice(tail).join(''))}</span>`;
}

// 根目錄（英文版）首次造訪依瀏覽器語言導向；使用者選過語言後以 site-lang 為準。
const ROOT_REDIRECT = `<script>try{if(location.pathname==='/'){var n=(navigator.language||'').toLowerCase(),l=localStorage.getItem('site-lang')||(n.indexOf('ja')===0?'ja':n.indexOf('zh')===0?'zh-TW':'en');if(l==='ja')location.replace('/ja/'+location.hash);else if(l==='zh-TW')location.replace('/zh-tw/'+location.hash)}}catch(e){}</script>`;

// 首屏背景海圖：取常規導航底圖（utils/map-geo-data.ts）中陸地偏右、左側留海面給文字的幾關，
// 每次載入隨機顯示一張，右下角標出海域名。五張都內嵌在頁面裡（經緯格線共用），
// 由緊接在後的內聯腳本在第一次繪製前選定；沒有 JS 時固定顯示第一張。
const HERO_MAPS = ['7-1', '3-5', '4-3', '5-1', '5-6'];
const heroMap = (lang: SiteLang) => {
    // 經緯格線：每 120 單位一條，讓底圖讀起來像海圖而不是色塊。
    const grid = Array.from({ length: 11 }, (_, i) => `M${(i + 1) * 120} 0V720`).join('')
        + Array.from({ length: 5 }, (_, i) => `M0 ${(i + 1) * 120}H1200`).join('');
    const charts = HERO_MAPS.map((map, i) => {
        const geo = MAP_GEO[map];
        if (!geo?.land) throw new Error(`首屏海圖 ${map} 沒有陸地資料`);
        return `<div class="hero-chart${i === 0 ? ' on' : ''}" aria-hidden="true">`
            + `<svg class="hero-map" viewBox="0 0 1200 720" preserveAspectRatio="xMaxYMax slice" focusable="false">`
            + `<path class="grid" d="${grid}"/><path class="land" d="${geo.land}"/>${geo.reef ? `<path class="reef" d="${geo.reef}"/>` : ''}</svg>`
            + `<p class="hero-place">${map}　${esc(mapName(map, lang) ?? '')}</p></div>`;
    }).join('');
    const pick = `<script>(function(){var c=document.querySelectorAll('.hero-chart'),i=Math.floor(Math.random()*c.length);`
        + `if(i){c[0].classList.remove('on');c[i].classList.add('on')}})()</script>`;
    return charts + pick;
};

// 截圖標註的編號位置（面板 CSS px，截圖寬 370、高 560）：與語言無關，三語共用。
// 圓點壓在截圖左右邊緣上（x 為 -2 或 372），不遮住面板裡的數字；凸出量小於頁面 16px 邊距。
// 截圖由 Demo 面板拍下（port＝母港第 0 步，sortie＝Z 點夜戰後第 15 步）。
const SHOT_SIZE = { w: 370, h: 560 };
const SHOT_MARKS: Record<'port' | 'sortie', [number, number][]> = {
    port: [[-2, 133], [372, 251], [-2, 356], [-2, 386], [-2, 428]],
    sortie: [[372, 87], [-2, 124], [-2, 166], [372, 198], [372, 482], [-2, 441]],
};

export interface Release { version: string; date: string }

export function renderPage(lang: SiteLang, origin: string, release: Release | null): string {
    const c = COPY[lang];
    const p = (s: string) => para(lang, s);
    const alternates = LANGS.map(l => `<link rel="alternate" hreflang="${COPY[l].htmlLang}" href="${origin}${PAGE_PATH[l]}">`).join('\n  ');
    const langLinks = LANGS.map(l => l === lang
        ? `<span aria-current="true">${esc(COPY[l].langName)}</span>`
        : `<a href="${PAGE_PATH[l]}" hreflang="${COPY[l].htmlLang}" lang="${COPY[l].htmlLang}" data-lang="${l}">${esc(COPY[l].langName)}</a>`).join('');
    const demoCopy = { ...c.demo, lang };
    const repoFile = (path: string) => `${LINKS.repo}/blob/main/${path}`;
    const shot = (id: 'port' | 'sortie', flip: boolean) => {
        const s = c.highlights.shots[id];
        const marks = SHOT_MARKS[id].map(([x, y], i) =>
            `<span class="mark" style="left:${(x / SHOT_SIZE.w * 100).toFixed(2)}%;top:${(y / SHOT_SIZE.h * 100).toFixed(2)}%">${i + 1}</span>`).join('');
        const img = (theme: string) => `<img class="shot-${theme}" src="/shots/${id}-${lang}-${theme}.webp" width="${SHOT_SIZE.w}" height="${SHOT_SIZE.h}" alt="${esc(s.alt)}" loading="lazy">`;
        return `<article class="shot-row${flip ? ' flip' : ''}">
          <figure class="shot">${img('dark')}${img('light')}${marks}</figure>
          <div class="shot-text">
            <h3>${esc(s.title)}</h3>
            <p>${p(s.text)}</p>
            <ol class="notes">${s.notes.map(n => `<li>${p(n)}</li>`).join('')}</ol>
          </div>
        </article>`;
    };
    const ghIcon = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
    return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="google-site-verification" content="CzFlCWImEwHjMTUZDg2WW-1dBU0Kf2ZUyKwcXE7LImg">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  ${THEME_BOOT}
  <title>${esc(c.title)}</title>
  <meta name="description" content="${esc(c.description)}">
  <meta property="og:title" content="${esc(c.title)}">
  <meta property="og:description" content="${esc(c.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${origin}${PAGE_PATH[lang]}">
  <meta property="og:image" content="${origin}/icon/128.png">
  <link rel="canonical" href="${origin}${PAGE_PATH[lang]}">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${origin}/">
  <link rel="icon" href="/icon/32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/icon/128.png">
  <link rel="stylesheet" href="/style.css">
${lang === 'en' ? ROOT_REDIRECT : ''}
</head>
<body>
  <header class="top">
    <div class="wrap top-row">
      <a class="brand" href="${PAGE_PATH[lang]}"><img src="/icon/48.png" alt="" width="24" height="24"><span>${esc(c.brand)}</span></a>
      <nav class="top-nav" aria-label="${esc(c.nav.features)}">
        <a href="#demo">${esc(c.nav.demo)}</a><a href="#features">${esc(c.nav.features)}</a><a href="#trust">${esc(c.nav.trust)}</a><a href="#install">${esc(c.nav.install)}</a>
      </nav>
      <a class="top-gh" href="${LINKS.repo}" rel="noopener">GitHub <span aria-hidden="true">↗</span></a>
      <div class="langs">${langLinks}</div>
    </div>
  </header>

  <main>
    <section class="hero">
      ${heroMap(lang)}
      <div class="wrap hero-body">
        <h1 class="hero-name"><img src="/icon/128.png" alt="" width="72" height="72"><span>${esc(c.brand)}</span></h1>
        ${lang === 'en' ? '' : '<p class="hero-latin" lang="en">Fleet Chronometer</p>'}
        <p class="hero-tagline">${heading(c.hero.tagline)}</p>
        <div class="hero-cta">
          <a class="btn primary big" href="${LINKS.store}" rel="noopener">${esc(c.hero.store)}</a>
          <a class="text-link" href="#demo">${esc(c.hero.demo)} <span aria-hidden="true">→</span></a>
        </div>
        <p class="hero-meta">${release ? `v${esc(release.version)} · ${esc(release.date)} · ` : ''}${esc(c.hero.note)}</p>
        <p class="hero-meta"><a class="text-link" href="${changelogPath(lang)}">${esc(c.hero.changelog)} <span aria-hidden="true">→</span></a></p>
      </div>
    </section>

    <section id="demo" class="demo">
      <div class="wrap demo-grid">
        <div class="device">
          <div class="device-bar"><i></i><i></i><i></i></div>
          <div class="device-screen">
            <iframe id="panel" title="${esc(c.demo.frameTitle)}" loading="lazy"></iframe>
          </div>
        </div>
        <div class="demo-intro">
          <h2>${heading(c.demo.title)}</h2>
          <p>${p(c.demo.lead)}</p>
          <p class="fine">${p(c.demo.hint)}</p>
        </div>
        <div class="demo-side">
          <div class="controls">
            <button type="button" class="btn primary" id="demo-next" disabled>${esc(c.demo.next)}</button>
            <button type="button" class="btn" id="demo-auto" disabled>${esc(c.demo.auto)}</button>
            <button type="button" class="btn ghost" id="demo-restart">${esc(c.demo.restart)}</button>
            <button type="button" class="btn ghost" id="demo-theme">${esc(c.demo.theme)}</button>
          </div>
          <p class="caption" id="demo-caption" aria-live="polite">${esc(c.demo.loading)}</p>
          <ol class="steps" id="demo-steps"></ol>
        </div>
      </div>
    </section>

    <section id="features" class="features">
      <div class="wrap">
        <header class="section-head">
          <h2>${heading(c.highlights.title)}</h2>
          <p class="lead">${p(c.highlights.lead)}</p>
        </header>
        ${shot('port', false)}
        ${shot('sortie', true)}
        <div class="more">
          <header class="more-head">
            <h3>${esc(c.more.title)}</h3>
            <p>${p(c.more.lead)}</p>
          </header>
          <dl class="more-list">
            ${c.more.items.map(f => `<div><dt>${esc(f.title)}</dt><dd>${p(f.text)}</dd></div>`).join('\n            ')}
          </dl>
        </div>
      </div>
    </section>

    <section id="trust" class="trust">
      <div class="wrap">
        <header class="section-head">
          <h2>${heading(c.trust.title)}</h2>
          <p class="lead">${p(c.trust.lead)}</p>
        </header>
        <figure class="arch"><img class="arch-light" src="/img/${ARCH_SVG[lang]}.svg" alt="${esc(c.trust.alt)}" loading="lazy"><img class="arch-dark" src="/img/${ARCH_SVG[lang]}-dark.svg" alt="${esc(c.trust.alt)}" loading="lazy"></figure>
        <dl class="more-list trust-list">
          ${c.trust.items.map(f => `<div><dt>${esc(f.title)}</dt><dd>${p(f.text)}</dd></div>`).join('\n          ')}
        </dl>
        <div class="sources">
          <p>${p(c.trust.sourceTitle)}</p>
          <ul>
            ${c.trust.sources.map(s => `<li><a href="${repoFile(s.path)}" rel="noopener"><code>${esc(s.path)}</code></a><span>${p(s.text)}</span></li>`).join('\n            ')}
          </ul>
        </div>
      </div>
    </section>

    <section id="install" class="install">
      <div class="wrap">
        <h2>${heading(c.install.title)}</h2>
        <p class="lead">${p(c.install.text)}</p>
        <div class="cta">
          <a class="btn primary" href="${LINKS.store}" rel="noopener">${esc(c.install.store)}</a>
          <a class="btn" href="${LINKS.contact}">${esc(c.install.contact)}</a>
        </div>
        <p class="notice" role="note">${p(c.install.notice)}</p>
      </div>
    </section>
  </main>

  <footer class="foot">
    <div class="wrap">
      <div class="foot-row">
        <span>© 2026 ${esc(c.brand)}</span>
        <nav class="foot-links">
          <a href="${LINKS.repo}" rel="noopener">${ghIcon}<span>GitHub</span></a>
          <a href="${LINKS.privacy}">${esc(c.install.privacyPolicy)}</a>
          <a href="${LINKS.contact}">${esc(c.install.contact)}</a>
        </nav>
      </div>
      <p>${p(c.footer)}</p>
    </div>
  </footer>
  <script id="demo-copy" type="application/json">${JSON.stringify(demoCopy).replace(/</g, '\\u003c')}</script>
  <script src="/landing.js" defer></script>
</body>
</html>
`;
}
