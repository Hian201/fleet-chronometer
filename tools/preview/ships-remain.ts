// 艦娘全覽「改修餘量」模式的**離線版面預覽產生器**（開發用，不進擴充 bundle）。
//
// 名冊直接吃 samples/slot_to_port.json（真實封包 427 艘，含結婚艦與運／耐久／對潛改修），
// 依「對空餘量」由大到小排，三語各輸出一頁，並附同一批艦的含裝備模式作對照。
//
//   npx vite-node --config vitest.config.ts tools/preview/ships-remain.ts
//   → .preview/ships-remain-{zh-TW,en,ja}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GameState } from '../../utils/state';
import { buildRoster, rosterTableHtml, COLUMNS, type StatMode, type TableView } from '../../entrypoints/overview/sections/ships';
import { sortRoster } from '../../utils/ship-roster';
import { esc } from '../../entrypoints/overview/lib';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const state = new GameState();
state.applyEvent('api_start2/getData', readJson('samples/start2-master.json'));
state.applyEvent('api_port/port', readJson('samples/slot_to_port.json').api_data);

const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));

const langs = ['zh-TW', 'en', 'ja'] as const;
mkdirSync(resolve(root, '.preview'), { recursive: true });

for (const lang of langs) {
    setLang(lang);
    const roster = buildRoster(state.ownedShips());
    const cols = new Set(COLUMNS.filter(c => c.on && c.id !== 'released' && c.id !== 'joined').map(c => c.id));
    const table = (mode: StatMode, rows: typeof roster) => {
        const view: TableView = { cols, sort: 'aa', dir: 'desc', mode };
        return rosterTableHtml(rows, view, { mode, tagLabel: id => `#${id}` });
    };
    // 結婚艦與做過特殊改修的艦排前面，確保預覽看得到耐久／對潛／運的各種狀態。
    const remainRows = sortRoster(roster, 'aa', 'desc', true).slice(0, 20);
    const picked = [
        ...roster.filter(s => s.married || s.modernSpecial).slice(0, 12),
        ...roster.filter(s => s.stypeId === 7 || s.stypeId === 11).slice(0, 4),
    ];
    const bar = (mode: StatMode) => `
        <div class="rs-bar">
            <input class="rs-search" type="search" autocomplete="off" placeholder="${esc(t('ov.shipsSearchPlaceholder'))}">
            <button type="button" class="ov-btn rs-toggle">${esc(t('ov.rsFilters'))}<span class="rs-badge" hidden></span></button>
            <details class="rs-colmenu"><summary class="ov-btn">${esc(t('ov.rsColumns'))}</summary></details>
            <label class="rs-inline"><span>${esc(t('ov.rsPageSize'))}</span><select class="rs-size"><option>20</option></select></label>
            <label class="rs-inline" title="${esc(t('ov.rsModeTip'))}"><span>${esc(t('ov.rsMode'))}</span>
                <select class="rs-mode">${(['shown', 'bare', 'remain'] as const).map(m =>
        `<option ${m === mode ? 'selected' : ''}>${esc(t(m === 'shown' ? 'ov.rsModeShown' : m === 'bare' ? 'ov.rsBare' : 'ov.rsModeRemain'))}</option>`).join('')}</select></label>
            <span class="grow"></span>
            <button type="button" class="ov-btn rs-csv">${esc(t('ov.rsExportCsv'))}</button>
            <button type="button" class="ov-btn rs-copy">${esc(t('ov.rsCopyCsv'))}</button>
            <button type="button" class="ov-btn rs-reset">${esc(t('ov.rsReset'))}</button>
        </div>`;
    const section = (title: string, mode: StatMode, rows: typeof roster) => `
        <section class="ov-section"><h2>${esc(title)}</h2><div class="rs">
            ${bar(mode)}
            ${mode === 'remain' ? `<p class="rs-remain-note ov-note dim">${esc(t('ov.rsRemainNote'))}</p>` : ''}
            <div class="rs-table-wrap">${table(mode, rows)}</div>
        </div></section>`;
    const page = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>改修餘量預覽 ${lang}</title><style>${css}</style></head>
<body>
    <div id="header"><h1 id="page-title">${esc(t('ov.ships'))}</h1></div>
    <nav id="nav"></nav>
    <main id="content">
        ${section(`${t('ov.rsModeRemain')} — 結婚艦／特殊改修／空母`, 'remain', picked)}
        ${section(`${t('ov.rsModeShown')} — 同上對照`, 'shown', picked)}
        ${section(`${t('ov.rsModeRemain')} — 對空餘量由大到小`, 'remain', remainRows)}
    </main>
</body></html>`;
    const out = resolve(root, `.preview/ships-remain-${lang}.html`);
    writeFileSync(out, page);
    console.log(out);
}
