// 打撈紀錄活動／關卡篩選的離線預覽（開發用，不進 bundle）。
//
//   npx vite-node --config vitest.config.ts tools/preview/drop-log-filter.ts
//   → .preview/drop-log-filter{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropMapLabel, dropMapTitle, dropTableHtml } from '../../entrypoints/overview/sections/drop-log';
import type { SectionContext } from '../../entrypoints/overview/sections/types';
import { esc, eventDisplayName, eventFilterSelectHtml, eventTermForFilter, mapFilterSelectHtml } from '../../entrypoints/overview/lib';
import type { SortieLogRow } from '../../utils/db';
import {
    isEventWorld, parseMapCode, planEventMapFilter,
} from '../../utils/sortie-detail';
import { GameState } from '../../utils/state';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
setLang('zh-TW');
const state = new GameState();
state.applyEvent('api_start2/getData', JSON.parse(readFileSync(resolve(root, 'samples/start2-master.json'), 'utf8')));
const ctx = { state } as SectionContext;

const row = (map: string, drop: string, ts: number): SortieLogRow => ({
    eventId: ts, sortieKey: ts, ts, map, node: 7, boss: true,
    kind: 'battle', rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop, taiha: false,
});
const rows = [
    row('62-1', '雪風', 1_700_000_002_000),
    row('62-7', '時雨', 1_700_000_003_000),
    row('61-3', '響', 1_600_000_001_000),
    row('6-5', '夕立', 1_500_000_000_000),
];
const items = rows.map(r => {
    const parsed = parseMapCode(r.map);
    return { map: r.map, world: parsed.world, mapnum: parsed.mapnum, event: isEventWorld(parsed.world) };
});
const worldLabel = (world: number) => eventDisplayName(world, state.masterMapAreas.get(world));
const latest = planEventMapFilter(items, {
    category: 'event', eventFilter: 'all', mapFilter: 'all', pinLatestEvent: true,
    worldLabel, eventTerm: eventTermForFilter, normalGroupLabel: t('ov.dropNormal'),
});
const allEvents = planEventMapFilter(items, {
    category: 'event', eventFilter: 'all', mapFilter: 'all', pinLatestEvent: false,
    worldLabel, eventTerm: eventTermForFilter, normalGroupLabel: t('ov.dropNormal'),
});
const cols = [
    {
        id: 'map' as const, labelKey: 'ov.dropColMap',
        cell: (r: SortieLogRow, c: SectionContext, view: { qualifyEventWorld: boolean }) =>
            `<span class="dl-map" title="${esc(dropMapTitle(r, c))}">${esc(dropMapLabel(r, view.qualifyEventWorld))}</span>`,
    },
    { id: 'drop' as const, labelKey: 'ov.dropColDrop', cell: (r: SortieLogRow) => `<b>${esc(r.drop ?? '')}</b>` },
];

function panel(plan: typeof latest, title: string): string {
    const eventRows = rows.filter(r => isEventWorld(parseMapCode(r.map).world)
        && (plan.eventFilter === 'all' || parseMapCode(r.map).world === plan.eventFilter));
    return `<h2>${esc(title)}</h2>
        <div class="dl"><div class="ov-toolbar dl-bar">
            <div class="rs-seg dl-cat">
                <button type="button">${esc(t('ov.dropNormal'))}</button>
                <button type="button" class="on">${esc(t('ov.dropEvent'))}</button>
            </div>
            <label class="rs-inline"><span>${esc(t('ov.slEvent'))}</span>
                <select class="dl-event-sel">${eventFilterSelectHtml(plan.eventGroups, plan.eventFilter, t('ov.slEventAll'))}</select>
            </label>
            <label class="rs-inline"><span>${esc(t('ov.slMap'))}</span>
                <select class="dl-map-sel">${mapFilterSelectHtml(plan.mapGroups, plan.mapFilter, t('ov.slMapAll'))}</select>
            </label>
        </div>
        ${dropTableHtml(eventRows, cols, ctx, { qualifyEventWorld: plan.qualifyEventWorld })}
        </div>`;
}

const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
const page = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<title>打撈紀錄篩選預覽</title><style>${css}</style></head>
<body><main id="content" style="padding:16px">
${panel(latest, '切到活動分類：預設最新一次活動，關卡為該活動實際有的 En')}
${panel(allEvents, '全部活動：活動下拉依年份分組，列上 En 帶年份季節')}
</main></body></html>`;

mkdirSync(resolve(root, '.preview'), { recursive: true });
const out = resolve(root, '.preview/drop-log-filter.html');
const light = resolve(root, '.preview/drop-log-filter-light.html');
writeFileSync(out, page);
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log(out);
console.log(light);
