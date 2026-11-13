// 更新紀錄頁：建置時把各語言的 CHANGELOG 轉成 /changelog/、/zh-tw/changelog/、/ja/changelog/，
// 首屏的「更新紀錄」依頁面語言連到對應的一頁。只收已發布的版本（`## [版本] - 日期`），
// Unreleased 是送審中的變更，商店上還沒有，不放上網站。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COPY, LINKS, PAGE_PATH, type SiteLang } from './content';
import { markdownToHtml } from './privacy';
import { THEME_BOOT } from './theme';

export const CHANGELOG_SOURCE: Record<SiteLang, string> = { en: 'CHANGELOG.md', 'zh-TW': 'CHANGELOG.zh-TW.md', ja: 'CHANGELOG.ja.md' };
export const changelogPath = (lang: SiteLang) => `${PAGE_PATH[lang]}changelog/`;

const LANGS: SiteLang[] = ['zh-TW', 'en', 'ja'];
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const RELEASED = /^## \[(\d[\d.]*)\] - (\d{4}-\d{2}-\d{2})\s*$/;

// 三語檔案的已發布版本必須一致，否則某個語言的頁面會缺版本；建置時直接失敗。
function releasedMarkdown(root: string, lang: SiteLang): { md: string; versions: string[] } {
    const lines = readFileSync(resolve(root, CHANGELOG_SOURCE[lang]), 'utf8').replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex(l => RELEASED.test(l));
    if (start < 0) return { md: '', versions: [] };
    const versions: string[] = [];
    const md = lines.slice(start).map(l => {
        const m = RELEASED.exec(l);
        if (!m) return l;
        versions.push(m[1]);
        return `## ${m[1]} · ${m[2]}`;
    }).join('\n');
    return { md, versions };
}

export function renderChangelogPages(root: string, origin: string): Record<SiteLang, string> {
    const sources = Object.fromEntries(LANGS.map(l => [l, releasedMarkdown(root, l)])) as Record<SiteLang, { md: string; versions: string[] }>;
    const expected = sources.en.versions.join(',');
    for (const l of LANGS) {
        if (sources[l].versions.join(',') !== expected) {
            throw new Error(`${CHANGELOG_SOURCE[l]} 的已發布版本（${sources[l].versions.join(', ')}）與 CHANGELOG.md（${expected}）不一致`);
        }
    }
    const out = {} as Record<SiteLang, string>;
    for (const lang of LANGS) {
        const c = COPY[lang];
        const langLinks = LANGS.map(l => l === lang
            ? `<span aria-current="true">${esc(COPY[l].langName)}</span>`
            : `<a href="${changelogPath(l)}" hreflang="${COPY[l].htmlLang}" lang="${COPY[l].htmlLang}" data-lang="${l}">${esc(COPY[l].langName)}</a>`).join('');
        const alternates = LANGS.map(l => `<link rel="alternate" hreflang="${COPY[l].htmlLang}" href="${origin}${changelogPath(l)}">`).join('\n  ');
        out[lang] = `<!doctype html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  ${THEME_BOOT}
  <title>${esc(c.changelog.title)} — ${esc(c.brand)}</title>
  <meta name="description" content="${esc(c.changelog.lead)}">
  <link rel="canonical" href="${origin}${changelogPath(lang)}">
  ${alternates}
  <link rel="icon" href="/icon/32.png" sizes="32x32">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="top">
    <div class="wrap top-row">
      <a class="brand" href="${PAGE_PATH[lang]}"><img src="/icon/48.png" alt="" width="24" height="24"><span>${esc(c.brand)}</span></a>
      <a class="top-gh" href="${LINKS.repo}" rel="noopener">GitHub <span aria-hidden="true">↗</span></a>
      <div class="langs">${langLinks}</div>
    </div>
  </header>
  <main class="doc changelog">
    <article class="wrap doc-body">
      <p class="doc-back"><a class="text-link" href="${PAGE_PATH[lang]}"><span aria-hidden="true">←</span> ${esc(c.changelog.back)}</a></p>
      <h1>${esc(c.changelog.title)}</h1>
      <p class="lead">${esc(c.changelog.lead)}</p>
${markdownToHtml(sources[lang].md)}
    </article>
  </main>
</body>
</html>
`;
    }
    return out;
}
