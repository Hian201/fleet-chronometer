// 資源紀錄分區的**離線版面預覽產生器**（開發用，不進擴充 bundle）。同 preview/sortie-log.ts。
//
// 為什麼需要它：這個分區的版面問題只有在**真實規模**下才看得見——八條線疊在一張圖上
// 會不會糊在一起、六位數字的欄寬、一次活動七、八個里程碑、四十天的取樣密度。
// 少量資料無法顯示實際的密度與欄寬。
// 但資源序列跟出擊紀錄不同：`samples/` 裡沒有現成的餘額歷史（那要跑好幾週才生得出來），
// 故這裡用**有依據的合成序列**——起訖水位、每場出擊的燃彈消耗量級、活動的關卡數與
// 里程碑順序，都照 samples/61-*.json 那次活動的真實形狀（五關、甲難度、量表分段）。
// 合成的是「時間軸」，不是欄位語意；欄位語意仍走與分區完全相同的那一份程式碼。
//
//   npx vite-node --config vitest.config.ts tools/preview/resource-log.ts
//   → .preview/resource-log{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ResourceMarkRow, ResourceRow } from '../../utils/db';
import {
    bucketSamples, buildEventPeriods, delta, downsample, normalizeSamples, type MatIndex,
} from '../../utils/resource-log';
import {
    buildDetailRows, chartGeo, chartHtml, colRackHtml, eventsHtml, shellHtml, summaryHtml, tableHtml,
    type RenderOpts,
} from '../../entrypoints/overview/sections/resource-log';
import { setLang } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
setLang('zh-TW');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 活動開打日，往回 20 天當平時、往後 18 天當活動期，最後 2 天回到平時
const START = new Date(2026, 5, 1, 9, 0, 0).getTime();

// ── 合成序列 ────────────────────────────────────────────────────────────
// 平時：遠征收入為主，緩慢爬升到自然回復上限附近。
// 活動期：每天十幾場出擊，燃彈鋼鋁一路陡降，桶與螺絲跟著掉。
const rows: ResourceRow[] = [];
let eventId = 1000;
let m = [318_000, 305_000, 340_000, 296_000, 152, 480, 1_180, 620];

const push = (ts: number) => rows.push({ eventId: eventId++, ts, m: m.map(Math.round) });

const spend = (fuel: number, ammo: number, steel: number, baux: number, bucket = 0, screw = 0) => {
    m = [
        Math.max(0, m[0] - fuel), Math.max(0, m[1] - ammo), Math.max(0, m[2] - steel),
        Math.max(0, m[3] - baux), m[4], Math.max(0, m[5] - bucket), m[6], Math.max(0, m[7] - screw),
    ];
};

// 平時 20 天：一天四次回港（遠征回收），資源緩升
for (let day = 0; day < 20; day++) {
    for (let i = 0; i < 4; i++) {
        spend(-1_800, -1_500, -2_200, -900, -3, 0);
        push(START - (20 - day) * DAY + i * 5 * HOUR);
    }
}

// 活動 18 天：五關（E1~E5），甲難度、量表分段，每天 8～16 場
const marks: ResourceMarkRow[] = [];
let markEvent = 5_000;
let t = START;
const stageDays = [2, 3, 3, 4, 6];   // 後段關卡耗時較長（照 61-* 那次活動的形狀）
stageDays.forEach((days, stage) => {
    const mapKey = 620 + stage + 1;
    if (stage === 0) {
        marks.push({ key: `open:${mapKey}`, kind: 'stage-open', mapKey, ts: t, eventId: markEvent++ });
    } else {
        marks.push({ key: `open:${mapKey}`, kind: 'stage-open', mapKey, ts: t + HOUR, eventId: markEvent++ });
    }
    for (let day = 0; day < days; day++) {
        const sorties = 8 + ((stage + day) % 5) * 2;
        for (let i = 0; i < sorties; i++) {
            // 一場連合艦隊出擊：燃彈各千級、鋼鋁隨支援與基地補給遞減，桶跟著大破修理走
            spend(1_050 + (i % 3) * 180, 1_320 + (i % 4) * 150, 620, 980, 2 + (i % 3), 0);
            push(t + day * DAY + i * 40 * 60_000 + 9 * HOUR);
        }
    }
    t += days * DAY;
    // 最終關的量表分兩段（甲難度常見），故 E5 記兩筆歸零
    const phases = stage === 4 ? 2 : 1;
    for (let phase = 0; phase < phases; phase++) {
        marks.push({
            key: `clear:${mapKey}#${phase}`, kind: 'gauge-clear', mapKey,
            ts: t - HOUR * (phases - phase) * 4, eventId: markEvent++, seq: phase, gaugeNum: 4,
        });
    }
});

// 活動後 2 天：回到平時，資源開始回補
for (let day = 0; day < 2; day++) {
    for (let i = 0; i < 4; i++) {
        spend(-2_400, -2_000, -2_800, -1_200, -5, -1);
        push(t + day * DAY + i * 5 * HOUR);
    }
}

// ── 走與分區完全相同的那一份程式碼 ────────────────────────────────────────
const all = normalizeSamples(rows);
const periods = buildEventPeriods(marks, all);
// 預設期間是 30 天，這裡刻意用「全部」才看得到活動前後的完整形狀
const view = bucketSamples(all, 'raw');
const chartSamples = downsample(view, 500);
const SERIES: MatIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];
const geo = chartGeo(chartSamples, SERIES, view[0].ts, view[view.length - 1].ts);

const opts: RenderOpts = {
    cols: [0, 1, 2, 3, 4, 5, 6, 7],
    showDelta: true,
    // 活動名平時來自 start2 的 api_mst_maparea；預覽直接給那次活動的標題
    areaName: area => (area === 62 ? '反撃！第三十一戦隊の戦い' : `第${area}海域`),
};

const detail = buildDetailRows(view, periods.flatMap(p => p.milestones));
const body =
    summaryHtml(all[all.length - 1], delta(view[0], view[view.length - 1]), view)
    + chartHtml(chartSamples, geo, SERIES, all[all.length - 1])
    + eventsHtml(periods, opts)
    + colRackHtml(opts.cols)
    + `<div class="rl-table-wrap">${tableHtml(detail.slice(0, 60), opts)}</div>`;

const shell = shellHtml({ range: 'all', gran: 'raw', series: SERIES, cols: opts.cols, showDelta: true, marks: true, size: 50 })
    .replace('<div class="rl-body"></div>', `<div class="rl-body">${body}</div>`);

// overview 的 <style> 原封取用——預覽要驗的就是那份 CSS 在真實規模下的樣子
const overviewHtml = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
const page = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<title>資源紀錄版面預覽</title><style>${css}</style></head>
<body><main id="content">${shell}</main></body></html>`
    .replace(/src="\/icons\//g, `src="${resolve(root, 'public/icons')}/`);

mkdirSync(resolve(root, '.preview'), { recursive: true });
const out = resolve(root, '.preview/resource-log.html');
writeFileSync(out, page);
// 亮色主題也要看——兩套主題都要能讀（design-guidelines §1.1）
const light = resolve(root, '.preview/resource-log-light.html');
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log(out);
console.log(light);
console.log(`samples=${all.length} marks=${marks.length} periods=${periods.length}`);
