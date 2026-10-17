// 產品介紹頁建置：輸出 .site/（Cloudflare Pages 的發布目錄）。
//
//   npm run site:build
//
// demo 直接打包正式 entrypoints/panel/main.ts；示範資料從 samples/ 抽出，只保留遊戲 master、
// 戰鬥封包與任務文字，提督 ID、時間戳等帳號相關欄位一律不帶出。
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_PATH, type SiteLang } from './content';
import { renderPage } from './page';
import type { DemoData } from './demo/scenario';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.site');
// canonical／hreflang 需要絕對網址；換網域時以環境變數覆寫。
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://fleet-chronometer.pages.dev').replace(/\/$/, '');
const SORTIE_SAMPLE = 'samples/61-4.json';
const QUEST_NOS = new Set([201, 210, 214, 226, 303, 402, 503, 605]);

const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, 'demo'), { recursive: true });

// ── 示範資料 ──
const master = readJson('samples/start2-master.json');
delete master._note;
const kc3 = readJson(SORTIE_SAMPLE);
const pickShip = (s: any) => ({ mst_id: s.mst_id, level: s.level, morale: s.morale, stats: s.stats, kyouka: s.kyouka, equip: s.equip, stars: s.stars, ace: s.ace });
const demoData: DemoData = {
    master,
    sortie: {
        world: kc3.world, mapnum: kc3.mapnum, diff: kc3.diff,
        fleets: [kc3.fleet1, kc3.fleet2, kc3.fleet3, kc3.fleet4].map((f: any[]) => f.map(pickShip)),
        lbas: kc3.lbas.map((b: any) => ({ rid: b.rid, range: b.range, action: b.action, planes: b.planes })),
        eventmap: { api_max_maphp: kc3.eventmap.api_max_maphp, api_gauge_type: kc3.eventmap.api_gauge_type, api_gauge_num: kc3.eventmap.api_gauge_num },
        nodes: kc3.nodes.map((n: any) => ({ id: n.id, eventId: n.eventId, eventKind: n.eventKind, eventColorNo: n.eventColorNo })),
        battles: kc3.battles.map((b: any) => ({ node: b.node, rating: b.rating, drop: b.drop, mvp: b.mvp, data: b.data, yasen: b.yasen && Object.keys(b.yasen).length ? b.yasen : null })),
    },
    quests: readJson('samples/Quest.json').api_data.api_list
        .filter((q: any) => q && QUEST_NOS.has(q.api_no))
        .map((q: any) => ({ api_no: q.api_no, api_category: q.api_category, api_type: q.api_type, api_label_type: q.api_label_type, api_title: q.api_title, api_detail: q.api_detail, api_get_material: q.api_get_material, api_bonus_flag: q.api_bonus_flag, api_invalid_flag: 0 })),
};
const demoJson = JSON.stringify(demoData);
// 樣本源自開發者本人的帳號；輸出前再確認沒有帳號識別欄位混進來。
for (const key of ['api_member_id', 'api_nickname_id', '"hq"', 'api_token']) {
    if (demoJson.includes(key)) throw new Error(`demo-data.json 含有帳號欄位 ${key}`);
}
writeFileSync(resolve(out, 'demo/demo-data.json'), demoJson);

// ── 打包 ──
const define = { 'import.meta.env.COMMAND': '"build"' };
await build({
    entryPoints: [resolve(root, 'site/demo/panel-entry.ts')],
    outdir: resolve(out, 'demo'), bundle: true, format: 'esm', splitting: true, minify: true,
    target: 'chrome120', alias: { '@': root }, define, entryNames: '[name]', chunkNames: 'chunk-[hash]',
    legalComments: 'none',
});
await build({
    entryPoints: [resolve(root, 'site/landing.ts')],
    outfile: resolve(out, 'landing.js'), bundle: true, format: 'iife', minify: true, target: 'es2020',
});

// 面板 HTML 沿用正式檔，只把入口換成 demo shim。
const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const entryTag = '<script type="module" src="./main.ts"></script>';
if (!panelHtml.includes(entryTag)) throw new Error('找不到正式面板的入口 script，demo 無法替換');
writeFileSync(resolve(out, 'demo/panel.html'), panelHtml
    .replace(entryTag, '<script type="module" src="./panel-entry.js"></script>')
    .replace('<head>', '<head>\n    <meta name="robots" content="noindex">'));

// ── 靜態資產與頁面 ──
cpSync(resolve(root, 'public/icons'), resolve(out, 'icons'), { recursive: true });
cpSync(resolve(root, 'public/icon'), resolve(out, 'icon'), { recursive: true });
mkdirSync(resolve(out, 'img'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja']) {
    cpSync(resolve(root, `docs/architecture-${lang}.svg`), resolve(out, `img/architecture-${lang}.svg`));
}
cpSync(resolve(root, 'site/style.css'), resolve(out, 'style.css'));
for (const lang of Object.keys(PAGE_PATH) as SiteLang[]) {
    const dir = resolve(out, '.' + PAGE_PATH[lang]);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'index.html'), renderPage(lang, ORIGIN));
}
writeFileSync(resolve(out, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /demo/\nSitemap: ${ORIGIN}/sitemap.xml\n`);
writeFileSync(resolve(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + Object.values(PAGE_PATH).map(p => `  <url><loc>${ORIGIN}${p}</loc></url>`).join('\n') + '\n</urlset>\n');
// Cloudflare Pages 的回應標頭：demo 資料與圖示可長快取，頁面每次重新驗證。
writeFileSync(resolve(out, '_headers'), [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: SAMEORIGIN',
    '/icons/*',
    '  Cache-Control: public, max-age=604800',
    '/demo/demo-data.json',
    '  Cache-Control: public, max-age=3600',
    '',
].join('\n'));
console.log(out);
