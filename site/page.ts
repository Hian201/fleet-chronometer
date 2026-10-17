// 產品介紹頁的 HTML 模板：每種語言輸出一份靜態頁，demo 控制只依賴頁內的 JSON 文案。
import { COPY, LINKS, PAGE_PATH, type SiteLang } from './content';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const LANGS: SiteLang[] = ['zh-TW', 'en', 'ja'];
const ARCH_SVG: Record<SiteLang, string> = { 'zh-TW': 'architecture-zh-TW.svg', en: 'architecture-en.svg', ja: 'architecture-ja.svg' };

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

export function renderPage(lang: SiteLang, origin: string): string {
    const c = COPY[lang];
    const p = (s: string) => para(lang, s);
    const alternates = LANGS.map(l => `<link rel="alternate" hreflang="${COPY[l].htmlLang}" href="${origin}${PAGE_PATH[l]}">`).join('\n  ');
    const langLinks = LANGS.map(l => l === lang
        ? `<span aria-current="true">${esc(COPY[l].langName)}</span>`
        : `<a href="${PAGE_PATH[l]}" hreflang="${COPY[l].htmlLang}" lang="${COPY[l].htmlLang}" data-lang="${l}">${esc(COPY[l].langName)}</a>`).join('');
    const demoCopy = { ...c.demo, lang };
    const cards = (items: { title: string; text: string }[]) =>
        items.map(f => `<li><h3>${esc(f.title)}</h3><p>${p(f.text)}</p></li>`).join('\n          ');
    return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
      <a class="brand" href="${PAGE_PATH[lang]}"><img src="/icon/48.png" alt="" width="28" height="28"><span>${esc(c.brand)}</span></a>
      <nav class="top-nav" aria-label="${esc(c.nav.features)}">
        <a href="#demo">${esc(c.nav.demo)}</a><a href="#features">${esc(c.nav.features)}</a><a href="#how">${esc(c.nav.how)}</a><a href="#privacy">${esc(c.nav.privacy)}</a><a href="#install">${esc(c.nav.install)}</a>
      </nav>
      <div class="langs">${langLinks}</div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap">
        <p class="eyebrow">${esc(c.hero.eyebrow)}</p>
        <h1>${heading(c.hero.title)}</h1>
        <p class="lead">${p(c.hero.lead)}</p>
        <div class="cta">
          <a class="btn primary" href="${LINKS.store}" rel="noopener">${esc(c.hero.store)}</a>
          <a class="btn" href="#demo">${esc(c.hero.demo)}</a>
        </div>
        <p class="note">${p(c.hero.note)}</p>
      </div>
    </section>

    <section id="demo" class="demo">
      <div class="wrap demo-grid">
        <div class="device">
          <div class="device-bar"><i></i><i></i><i></i></div>
          <div class="device-screen">
            <iframe id="panel" title="${esc(c.demo.frameTitle)}" src="/demo/panel.html?lang=${lang}" loading="lazy"></iframe>
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
          <h2>${heading(c.features.title)}</h2>
          <p class="lead">${p(c.features.lead)}</p>
        </header>
        <ul class="cards">
          ${cards(c.features.items)}
        </ul>
      </div>
    </section>

    <section id="how" class="how">
      <div class="wrap">
        <header class="section-head">
          <h2>${heading(c.how.title)}</h2>
          <p class="lead">${p(c.how.lead)}</p>
        </header>
        <figure class="arch"><img src="/img/${ARCH_SVG[lang]}" alt="${esc(c.how.alt)}" loading="lazy"></figure>
      </div>
    </section>

    <section id="privacy" class="privacy">
      <div class="wrap">
        <header class="section-head">
          <h2>${heading(c.privacy.title)}</h2>
        </header>
        <ul class="cards two">
          ${cards(c.privacy.items)}
        </ul>
      </div>
    </section>

    <section id="install" class="install">
      <div class="wrap">
        <header class="section-head">
          <h2>${heading(c.install.title)}</h2>
          <p class="lead">${p(c.install.text)}</p>
        </header>
        <div class="cta">
          <a class="btn primary" href="${LINKS.store}" rel="noopener">${esc(c.install.store)}</a>
          <a class="btn" href="${LINKS.source}" rel="noopener">${esc(c.install.source)}</a>
          <a class="btn ghost" href="${LINKS.privacy}" rel="noopener">${esc(c.install.privacyPolicy)}</a>
        </div>
        <p class="notice" role="note">${p(c.install.notice)}</p>
      </div>
    </section>
  </main>

  <footer class="foot">
    <div class="wrap"><p>${p(c.footer)}</p></div>
  </footer>
  <script id="demo-copy" type="application/json">${JSON.stringify(demoCopy).replace(/</g, '\\u003c')}</script>
  <script src="/landing.js" defer></script>
</body>
</html>
`;
}
