// 資源紀錄分區的**離線版面預覽產生器**（開發用，不進擴充 bundle）。同 preview/sortie-log.ts。
//
// 為什麼需要它：這個分區的版面問題只有在**真實規模**下才看得見——八條線疊在一張圖上
// 會不會糊在一起、六位數字的欄寬、一次活動七、八個里程碑、四十天的取樣密度。
// 少量資料無法顯示實際的密度與欄寬。
// 但資源序列跟出擊紀錄不同：`samples/` 裡沒有現成的餘額歷史（那要跑好幾週才生得出來），
// 故這裡用**有依據的合成序列**——起訖水位、每場出擊的燃彈消耗量級、活動的關卡數、
// 前後段分拆與里程碑順序，都照實際活動的形狀（2025春／秋、2026夏）。
// 合成的是「時間軸」，不是欄位語意；欄位語意仍走與分區完全相同的那一份程式碼。
//
//   npx vite-node --config vitest.config.ts tools/preview/resource-log.ts
//   → .preview/resource-log{,-en,-ja}{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ResourceMarkRow, ResourceRow } from '../../utils/db';
import {
    bucketSamples, buildEventPeriods, delta, downsample, normalizeSamples, type MatIndex,
} from '../../utils/resource-log';
import {
    buildDetailRows, buildEventEntries, chartGeo, chartHtml, colRackHtml, eventCompareHtml, eventDetailHtml,
    eventFilterOptions, eventListHtml, shellHtml, summaryHtml, tableHtml, type RenderOpts,
} from '../../entrypoints/overview/sections/resource-log';
import { eventTermLabel } from '../../utils/event-calendar';
import { setLang, t } from '../../utils/ui-i18n';
import type { Lang } from '../../utils/gamedata-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── 合成序列 ────────────────────────────────────────────────────────────
// 平時：遠征收入為主，緩慢爬升。活動：每天十幾場出擊，燃彈鋼鋁一路陡降。
// 前段打完會先撈幾天前段，等後段開放；後段打完再撈一陣子（攻略後）。
const rows: ResourceRow[] = [];
const marks: ResourceMarkRow[] = [];
const sortieRows: { ts: number; map: string }[] = [];
let eventId = 1000;
let markEvent = 5_000;
let m = [318_000, 305_000, 340_000, 296_000, 152, 2_400, 1_180, 620];

const push = (ts: number) => rows.push({ eventId: eventId++, ts, m: m.map(Math.round) });
const spend = (fuel: number, ammo: number, steel: number, baux: number, bucket = 0) => {
    m = [m[0] - fuel, m[1] - ammo, m[2] - steel, m[3] - baux, m[4], m[5] - bucket, m[6], m[7]];
};
const sortie = (area: number, mapNo: number, ts: number) => { push(ts); sortieRows.push({ ts, map: `${area}-${mapNo}` }); };

function idle(from: number, days: number): number {
    for (let day = 0; day < days; day++) {
        for (let i = 0; i < 4; i++) {
            spend(-1_800, -1_500, -2_200, -900, -3);
            push(from + day * DAY + i * 5 * HOUR);
        }
    }
    return from + days * DAY;
}

function farm(area: number, mapNo: number, from: number, days: number): number {
    for (let day = 0; day < days; day++) {
        for (let i = 0; i < 5; i++) { spend(420, 560, 120, 80, 1); sortie(area, mapNo, from + day * DAY + i * HOUR + 10 * HOUR); }
        spend(-1_500, -1_300, -1_900, -800, -3);
        push(from + day * DAY + 20 * HOUR);
    }
    return from + days * DAY;
}

/** 一段作戰：逐關開打、出擊、歸零（最後一關可留著不打完）；末關量表分兩段。 */
function part(area: number, firstMap: number, start: number, stageDays: number[], scale: number, leaveLastOpen = false): number {
    let t0 = start;
    stageDays.forEach((days, k) => {
        const mapNo = firstMap + k;
        const mapKey = area * 10 + mapNo;
        marks.push({ key: `open:${mapKey}`, kind: 'stage-open', mapKey, ts: t0 + HOUR, eventId: markEvent++ });
        for (let day = 0; day < days; day++) {
            const n = 8 + ((k + day) % 5) * 2;
            for (let i = 0; i < n; i++) {
                spend((1_050 + (i % 3) * 180) * scale, (1_320 + (i % 4) * 150) * scale, 620 * scale, 980 * scale, 2 + (i % 3));
                sortie(area, mapNo, t0 + day * DAY + i * 40 * 60_000 + 9 * HOUR);
            }
        }
        t0 += days * DAY;
        const last = k === stageDays.length - 1;
        if (last && leaveLastOpen) {
            marks.push({ key: `seen:${mapKey}`, kind: 'gauge-seen', mapKey, ts: t0 - DAY, eventId: markEvent++ });
            return;
        }
        const phases = last ? 2 : 1;
        for (let seq = 0; seq < phases; seq++) {
            marks.push({
                key: `clear:${mapKey}#${seq}`, kind: 'gauge-clear', mapKey,
                ts: t0 - HOUR * (phases - seq) * 4, eventId: markEvent++, seq, gaugeNum: 4,
            });
        }
    });
    return t0;
}

let cur = new Date(2025, 2, 8, 9).getTime();
idle(cur - 10 * DAY, 10);
cur = part(60, 1, cur, [3, 4, 5], 0.9);
cur = idle(farm(60, 3, cur, 3), 8);
cur = idle(part(60, 4, cur, [3, 5, 9], 0.9, true), 10);         // 2025春季：E6 沒打完
cur = idle(cur, 180);
cur = part(61, 1, cur, [2, 3, 5], 1.0);
cur = idle(farm(61, 2, cur, 4), 6);
cur = part(61, 4, cur, [4, 7], 1.0);
cur = idle(farm(61, 5, cur, 12), 200);
cur = part(62, 1, cur, [3, 3, 5], 1.15);
cur = idle(farm(62, 1, cur, 5), 9);
cur = part(62, 4, cur, [6, 9], 1.15);
idle(farm(62, 4, cur, 14), 3);

// ── 走與分區完全相同的那一份程式碼 ────────────────────────────────────────
const all = normalizeSamples(rows);
const periods = buildEventPeriods(marks, all);
// 預設期間是 30 天，這裡刻意用「全部」才看得到活動前後的完整形狀
const view = bucketSamples(all, 'raw');
const chartSamples = downsample(view, 500);
const SERIES: MatIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];
const geo = chartGeo(chartSamples, SERIES, view[0].ts, view[view.length - 1].ts);

// overview 的 <style> 原封取用——預覽要驗的就是那份 CSS 在真實規模下的樣子
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));

mkdirSync(resolve(root, '.preview'), { recursive: true });
const LANGS: Lang[] = ['zh-TW', 'en', 'ja'];
for (const lang of LANGS) {
    setLang(lang);
    const opts: RenderOpts = {
        cols: [0, 1, 2, 3, 4, 5, 6, 7],
        showDelta: true,
        areaName: area => eventTermLabel(area, t) ?? `#${area}`,
    };
    const entries = buildEventEntries(periods, all, marks, sortieRows, () => undefined, area => `#${area}`);
    const selected = entries[0]?.area ?? null;
    const options = eventFilterOptions(entries);
    const detail = buildDetailRows(view, periods.flatMap(p => p.milestones));
    const prefs = {
        range: 'all', gran: 'raw' as const, series: SERIES, cols: opts.cols, showDelta: true, marks: true, size: 50 as const,
        evView: 'detail' as const, evCmp: 'attack' as const, evAvg: false,
    };
    const shell = shellHtml(prefs)
        .replace('<div class="rl-top"></div>', `<div class="rl-top">${
            summaryHtml(all[all.length - 1], delta(view[0], view[view.length - 1]), view)
            + chartHtml(chartSamples, geo, SERIES, all[all.length - 1])}</div>`)
        .replace(/<select class="rl-ev-fyear">[\s\S]*?<\/select>/, `<select class="rl-ev-fyear">${options.years}</select>`)
        .replace(/<select class="rl-ev-fseason">[\s\S]*?<\/select>/, `<select class="rl-ev-fseason">${options.seasons}</select>`)
        .replace(/<span class="dim rl-ev-count"><\/span>/, `<span class="dim rl-ev-count">${t('ov.rlEvCount', { n: entries.length, total: entries.length })}</span>`)
        .replace(/<div class="rl-ev-list">[\s\S]*?<\/div><\/div>/, `<div class="rl-ev-list">${eventListHtml(entries, selected)}</div>`)
        .replace('<div class="rl-ev-detail"></div>', `<div class="rl-ev-detail">${entries[0] ? eventDetailHtml(entries[0]) : ''}</div>`)
        .replace('<div class="rl-ev-cmp"></div>', `<div class="rl-ev-cmp">${eventCompareHtml(entries, selected)}</div>`)
        .replace('<div class="rl-bottom"></div>', `<div class="rl-bottom">${colRackHtml(opts.cols)}`
            + `<div class="rl-table-wrap">${tableHtml(detail.slice(0, 60), opts)}</div></div>`);

    const page = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>資源紀錄版面預覽</title><style>${css}</style></head>
<body><main id="content">${shell}</main></body></html>`
        .replace(/src="\/icons\//g, `src="${resolve(root, 'public/icons')}/`);
    const suffix = lang === 'zh-TW' ? '' : `-${lang}`;
    const out = resolve(root, `.preview/resource-log${suffix}.html`);
    writeFileSync(out, page);
    // 亮色主題也要看——兩套主題都要能讀（design-guidelines §1.1）
    writeFileSync(out.replace('.html', '-light.html'), page.replace(`<html lang="${lang}">`, `<html lang="${lang}" data-theme="light">`));
    console.log(out);
}
console.log(`samples=${all.length} marks=${marks.length} periods=${periods.length} sorties=${sortieRows.length}`);
