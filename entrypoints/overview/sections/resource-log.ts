// 資源紀錄：八項資材餘額的時間序列（趨勢圖）＋詳細清單＋活動海域的區段消耗。
//
// ── 版面與資料契約 ───────────────────────────────────────────────────
// 1. **趨勢圖是最上方的一張大圖，八條線疊在一起，用圖例逐條開關**（使用者指定；
//    量級差距（燃料十萬級、螺絲千級）由**開關**解決：y 軸值域只看「顯示中」的序列，關掉大宗資源後剩下的線
//    會自動撐滿整張圖。**雙 y 軸仍然不做**——兩套刻度沒有共同基準，交叉是視覺巧合。
//    序列配色是 dataviz 參考色盤的**固定順序**（資材 i 恆定拿第 i 個色位，開關不重新
//    分配），深淺主題皆維持 CVD 可分辨性與足夠對比。
// 2. **餘額是封包事實，消長是差分**。所有「花了多少」都成對顯示起訖時刻；算不出來
//    （期間內沒有取樣）就寫「不可考」，不以 0 頂替（同全專案的缺席處理原則）。
// 3. **控制項只建一次、只重繪 `.rl-body`**（design-guidelines §4.2 的第二種例外）：
//    這裡有使用者自己造出來的狀態——圖表的十字準線、詳細清單的捲動位置與分頁。
//    整塊重繪會把它們全部洗掉。
import type { OverviewSection } from './types';
import { db, type ResourceMarkRow, type ResourceRow } from '@/utils/db';
import { t } from '@/utils/ui-i18n';
import {
    copyWithFeedback, downloadText, esc, fmtShortTs, fmtTs, loadJsonPrefs, matIconHtml,
    paginate, saveJsonPrefs,
} from '../lib';
import { multiChartGeometry, nearestIndex, type ChartBox, type MultiChartGeometry } from '@/utils/line-chart';
import {
    MAT_FILES, MAT_KEYS, bucketSamples, buildEventPeriods, delta, downsample, normalizeSamples,
    toCsv, type EventPeriod, type Granularity, type MatIndex, type Milestone, type Sample,
} from '@/utils/resource-log';

const ALL_COLS: MatIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];
// 折線圖預設只看四大資源：量級相近，開頁即可比較消長；其餘資材仍可由圖例隨時加入。
const MAIN_COLS: MatIndex[] = [0, 1, 2, 3];
const PAGE_SIZES = [25, 50, 100, 200, 0] as const;
type PageSize = typeof PAGE_SIZES[number];

const RANGES = [
    { key: '7', days: 7, labelKey: 'ov.rlRange7' },
    { key: '30', days: 30, labelKey: 'ov.rlRange30' },
    { key: '90', days: 90, labelKey: 'ov.rlRange90' },
    { key: 'all', days: 0, labelKey: 'ov.rlRangeAll' },
] as const;

// 折線圖抽稀上限：一張圖 1000 單位寬，超過這個點數再多畫也只是同一個像素疊筆。
const MAX_POINTS = 500;
// padLeft 留給 y 軸刻度標籤（六位數＋千分位）
const BOX: ChartBox = { width: 1000, height: 300, padTop: 12, padBottom: 12, padLeft: 66, padRight: 14 };

// ── 顯示偏好（localStorage；純 UI 偏好，不進 Dexie、不進備份）─────────────
const PREFS_KEY = 'kc-resource-view';

interface Prefs {
    range: string;
    gran: Granularity;
    /** 折線圖顯示中的資材（圖例開關）。 */
    series: MatIndex[];
    cols: MatIndex[];
    showDelta: boolean;
    marks: boolean;
    size: PageSize;
}

const defaultPrefs = (): Prefs => ({
    range: '30', gran: 'raw', series: [...MAIN_COLS], cols: [...ALL_COLS],
    showDelta: true, marks: true, size: 50,
});

function loadPrefs(): Prefs {
    const d = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, d, raw => {
        if (!raw || typeof raw !== 'object') return d;
        const r = raw as Record<string, unknown>;
        return {
            range: RANGES.some(range => range.key === r.range) ? r.range as string : d.range,
            gran: r.gran === 'hour' || r.gran === 'day' || r.gran === 'raw' ? r.gran : d.gran,
            // 全部關掉會變成一張空白圖；壞值或空陣列一律退回全開
            series: Array.isArray(r.series) && r.series.length
                ? ALL_COLS.filter(i => (r.series as unknown[]).includes(i)) : d.series,
            cols: Array.isArray(r.cols) && r.cols.length
                ? ALL_COLS.filter(i => (r.cols as unknown[]).includes(i)) : d.cols,
            showDelta: r.showDelta !== false,
            marks: r.marks !== false,
            size: (PAGE_SIZES as readonly number[]).includes(r.size as number) ? r.size as PageSize : d.size,
        };
    });
}

const savePrefs = (p: Prefs) => { saveJsonPrefs(PREFS_KEY, p); };

// ── 小工具 ───────────────────────────────────────────────────────────────

const fmtNum = (n: number) => n.toLocaleString();
/** 消長：正負號一律顯示（沒有符號就分不出「增加 3000」與「剩 3000」）。 */
const fmtDelta = (n: number) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? fmtNum(n) : '0');
const deltaClass = (n: number) => (n > 0 ? 'rl-gain' : n < 0 ? 'rl-drain' : 'rl-flat');

const matChip = (i: MatIndex, value: string, cls = '') =>
    `<span class="rl-chip ${cls}" title="${esc(t(MAT_KEYS[i] + '.full'))}">`
    + `${matIconHtml(MAT_FILES[i], t(MAT_KEYS[i]))}<b>${esc(value)}</b></span>`;

/** 里程碑的顯示名。`mapNo` 就是 E 幾——不顯示 area 編號（玩家不需要知道 62 是什麼）。 */
export function milestoneLabel(m: Milestone): string {
    if (m.kind === 'open') return t('ov.rlEventOpen', { n: m.mapNo });
    return m.seq && m.seq > 0
        ? t('ov.rlEventClearSeq', { n: m.mapNo, seq: m.seq + 1 })
        : t('ov.rlEventClear', { n: m.mapNo });
}

const noSample = () =>
    `<span class="dim" title="${esc(t('ov.rlNoSampleTip'))}">${esc(t('ov.rlNoSample'))}</span>`;

const deltaChips = (values: number[] | null) => (values
    ? ALL_COLS.map(i => matChip(i, fmtDelta(values[i]), deltaClass(values[i]))).join('')
    : noSample());

// ── 純 HTML 建構器 ────────────────────────────────────────────────────────
// 抽到 module scope（不吃閉包）是為了讓 tools/preview/resource-log.ts 能用真實資料
// 產出離線版面預覽——同 sortie-log 分區的作法。真實資料才看得出版面問題（八格圖表、
// 一次活動七個里程碑、六位數字的欄寬…），手捏的假資料看不出來。

/** 詳細清單的一列（含掛在它前面的里程碑）。 */
export interface DetailRow {
    ts: number;
    m: number[];
    /** 與前一列（較舊）的差分；第一列沒有前一列 → null。 */
    d: number[] | null;
    milestones: Milestone[];
}

export interface RenderOpts {
    cols: MatIndex[];
    showDelta: boolean;
    /** 活動 area → 顯示名（GameState.mapAreaName）。 */
    areaName(area: number): string;
}

/**
 * 折線圖區＝**一張大圖＋圖例開關**（使用者指定的形狀）。
 *
 * 圖例不是說明，是控制項：一顆一項資材，點了就開關那條線。y 軸值域只看顯示中的序列
 * （見 utils/line-chart.ts），故關掉燃料之後螺絲會撐滿整張圖——這就是量級差距的解法，
 * 不是拆圖也不是雙 y 軸。
 *
 * 顏色由 `.rl-s{i}` class 決定，**資材 i 恆定拿第 i 個色位**：開關序列時絕不重新分配
 * 顏色，否則關掉一條線會讓其他線全部換色（dataviz 硬規則：色彩跟著實體，不跟著排名）。
 */
export function chartHtml(
    samples: Sample[], geo: MultiChartGeometry, visible: MatIndex[], current: Sample | null,
): string {
    const on = new Set(visible);
    const first = samples[0], last = samples[samples.length - 1];
    const byKey = new Map(geo.series.map(sg => [sg.key, sg]));

    // 圖例：色塊＋圖示＋名稱＋目前值。關掉的仍留在列上（淡化），否則使用者不知道還有那一項
    const legend = ALL_COLS.map(i => `<button type="button" class="rl-leg${on.has(i) ? ' on' : ''}"
        data-series="${i}" aria-pressed="${on.has(i)}" title="${esc(t(MAT_KEYS[i] + '.full'))}">
        <span class="rl-swatch rl-s${i}"></span>
        ${matIconHtml(MAT_FILES[i], t(MAT_KEYS[i]))}
        <span class="rl-leg-name">${esc(t(MAT_KEYS[i] + '.full'))}</span>
        <b class="rl-leg-now">${esc(fmtNum(current?.m[i] ?? 0))}</b>
    </button>`).join('');

    const xTicks = first && last && first.ts !== last.ts
        ? `<div class="rl-xaxis dim">
            <span>${esc(fmtShortTs(first.ts))}</span>
            <span>${esc(fmtShortTs((first.ts + last.ts) / 2))}</span>
            <span>${esc(fmtShortTs(last.ts))}</span>
        </div>` : '';

    return `<div class="rl-legend">
        ${legend}
        <span class="grow"></span>
        <button type="button" class="rs-mini rl-series-all">${esc(t('ov.rlSeriesAll'))}</button>
        <button type="button" class="rs-mini rl-series-main">${esc(t('ov.rlSeriesMain'))}</button>
    </div>
    <div class="rl-chart">
        <svg class="rl-svg" viewBox="0 0 ${BOX.width} ${BOX.height}"
             role="img" aria-label="${esc(t('ov.rlChartLabel'))}">
            ${geo.ticks.map(tick => `<line class="rl-grid" x1="${BOX.padLeft}" x2="${BOX.width - BOX.padRight}" y1="${tick.y}" y2="${tick.y}"/>`
                + `<text class="rl-ytick" x="${BOX.padLeft - 8}" y="${tick.y + 4}">${esc(fmtNum(Math.round(tick.value)))}</text>`).join('')}
            <line class="rl-cross" x1="0" x2="0" y1="${geo.top}" y2="${geo.bottom}" hidden/>
            ${visible.map(i => {
        const sg = byKey.get(i);
        if (!sg) return '';
        return sg.line
            ? `<path class="rl-line rl-s${i}" d="${sg.line}"/>`
            : sg.points[0] ? `<circle class="rl-dot rl-s${i}" cx="${sg.points[0].x}" cy="${sg.points[0].y}" r="3"/>` : '';
    }).join('')}
            ${visible.map(i => `<circle class="rl-cursor rl-s${i}" data-cursor="${i}" r="4" hidden/>`).join('')}
        </svg>
        ${xTicks}
    </div>
    <p class="ov-note rl-chart-note">${esc(t('ov.rlChartNote'))}</p>
    <div class="rl-tip" hidden></div>`;
}

/** 顯示中序列的幾何（y 值域只看這幾條——關掉大宗資源，剩下的線才撐得滿）。 */
export function chartGeo(samples: Sample[], visible: MatIndex[], from: number, to: number): MultiChartGeometry {
    const tMin = samples[0]?.ts ?? from;
    const tMax = samples[samples.length - 1]?.ts ?? to;
    return multiChartGeometry(
        samples.map(s => s.ts),
        visible.map(i => ({ key: i, values: samples.map(s => s.m[i] ?? 0) })),
        tMin, tMax, BOX,
    );
}

export function eventCardHtml(p: EventPeriod, opts: RenderOpts): string {
    return `<div class="rl-event">
        <div class="rl-event-head">
            <b class="rl-event-name">${esc(opts.areaName(p.area))}</b>
            <span class="dim">${esc(fmtTs(p.startTs))} ～ ${esc(fmtTs(p.endTs))}</span>
            <span class="grow"></span>
            <button type="button" class="rs-mini rl-only" data-from="${p.startTs}" data-to="${p.endTs}">${esc(t('ov.rlOnlyThis'))}</button>
        </div>
        <div class="rl-seg-list">
            ${p.segments.map(seg => `<div class="rl-seg-row">
                <span class="rl-seg-name">${esc(milestoneLabel(seg.to))}</span>
                <span class="dim rl-seg-time">${esc(fmtTs(seg.to.ts))}</span>
                <span class="rl-seg-chips">${seg.from === null ? '' : deltaChips(seg.delta)}</span>
            </div>`).join('')}
            <div class="rl-seg-row rl-seg-total">
                <span class="rl-seg-name">${esc(t('ov.rlTotal'))}</span>
                <span class="dim rl-seg-time"></span>
                <span class="rl-seg-chips">${deltaChips(p.total)}</span>
            </div>
        </div>
    </div>`;
}

export function eventsHtml(periods: EventPeriod[], opts: RenderOpts): string {
    const head = `<h3>${esc(t('ov.rlEventTitle'))}</h3>`
        + `<p class="ov-note">${esc(t('ov.rlEventNote'))}</p>`;
    const cards = periods.length
        ? periods.map(p => eventCardHtml(p, opts)).join('')
        : `<div class="ov-empty">${esc(t('ov.rlEventNone'))}</div>`;
    return `<section class="rl-events">${head}${cards}</section>`;
}

/**
 * 詳細清單的欄位開關（一項資材一顆圖示鈕，點了就開關該欄）。**只放圖示不放文字**
 * （使用者要求）——表頭同樣是純圖示，兩處一致；名稱靠 title 與上方圖表圖例補足。
 * 至少留一欄（全部關掉會變成一張只有時間的空表）。
 */
export function colRackHtml(cols: MatIndex[]): string {
    const on = new Set(cols);
    return `<div class="rl-colrack">
        <span class="rl-colrack-label">${esc(t('ov.rlColumns'))}</span>
        ${ALL_COLS.map(i => `<button type="button" class="rl-colbtn${on.has(i) ? ' on' : ''}"
            data-col="${i}" aria-pressed="${on.has(i)}" title="${esc(t(MAT_KEYS[i] + '.full'))}">
            ${matIconHtml(MAT_FILES[i], t(MAT_KEYS[i]))}</button>`).join('')}
    </div>`;
}

export function tableHtml(rows: DetailRow[], opts: RenderOpts): string {
    const cols = opts.cols;
    return `<table class="rl-table">
        <thead><tr>
            <th class="rl-th-time">${esc(t('ov.rlTime'))}</th>
            ${cols.map(i => `<th class="rl-th-mat" title="${esc(t(MAT_KEYS[i] + '.full'))}">`
        + `${matIconHtml(MAT_FILES[i], t(MAT_KEYS[i]))}</th>`).join('')}
        </tr></thead>
        <tbody>${rows.map(row => `
            ${row.milestones.map(m => `<tr class="rl-mark-row"><td colspan="${cols.length + 1}">
                <span class="rl-mark-badge">${esc(opts.areaName(m.area))}</span>
                <span class="rl-mark-name">${esc(milestoneLabel(m))}</span>
                <span class="dim">${esc(fmtTs(m.ts))}</span>
            </td></tr>`).join('')}
            <tr>
                <td class="rl-td-time">${esc(fmtTs(row.ts))}</td>
                ${cols.map(i => `<td class="rl-td-mat"><span class="rl-v">${esc(fmtNum(row.m[i] ?? 0))}</span>`
            + (opts.showDelta
                ? `<span class="rl-d ${row.d ? deltaClass(row.d[i]) : 'rl-flat'}">${row.d ? esc(fmtDelta(row.d[i])) : '–'}</span>`
                : '') + `</td>`).join('')}
            </tr>`).join('')}</tbody>
    </table>`;
}

/** 摘要列（目前餘額＋期間消長＋取樣範圍）。 */
export function summaryHtml(
    current: Sample, rangeDelta: number[] | null, samples: Sample[], clearable = false,
): string {
    const first = samples[0], last = samples[samples.length - 1];
    const meta = samples.length > 1 && first && last
        ? t('ov.rlSummary', { n: samples.length, from: fmtTs(first.ts), to: fmtTs(last.ts) })
        : first ? t('ov.rlSummaryOne', { n: samples.length, from: fmtTs(first.ts) }) : '';
    return `<div class="rl-summary">
        <div class="rl-sum-block">
            <span class="rl-sum-label">${esc(t('ov.rlCurrent'))}</span>
            <span class="rl-sum-chips">${ALL_COLS.map(i => matChip(i, fmtNum(current.m[i] ?? 0))).join('')}</span>
        </div>
        <div class="rl-sum-block">
            <span class="rl-sum-label">${esc(t('ov.rlRangeDelta'))}</span>
            <span class="rl-sum-chips">${deltaChips(rangeDelta)}</span>
        </div>
        <div class="rl-sum-meta dim">${esc(meta)}
            ${clearable ? `<button type="button" class="rs-mini rl-clear-custom" title="${esc(t('ov.rlRangeCustom'))}">×</button>` : ''}</div>
    </div>`;
}

/** 工具列（分區與離線預覽共用同一份 markup）。 */
export function shellHtml(prefs = defaultPrefs()): string {
    return `<div class="rl">
        <p class="ov-note">${esc(t('ov.rlIntro'))}</p>
        <div class="ov-toolbar rl-bar">
            <span class="rl-label">${esc(t('ov.rlRange'))}</span>
            <div class="rs-seg rl-range">${RANGES.map(r =>
        `<button type="button" data-range="${r.key}" class="${prefs.range === r.key ? 'on' : ''}">${esc(t(r.labelKey))}</button>`).join('')}</div>
            <label class="rs-inline" title="${esc(t('ov.rlGranTip'))}"><span>${esc(t('ov.rlGranularity'))}</span>
                <select class="rl-gran">
                    <option value="raw">${esc(t('ov.rlGranRaw'))}</option>
                    <option value="hour">${esc(t('ov.rlGranHour'))}</option>
                    <option value="day">${esc(t('ov.rlGranDay'))}</option>
                </select></label>
            <label class="rs-inline"><input type="checkbox" class="rl-delta" ${prefs.showDelta ? 'checked' : ''}><span>${esc(t('ov.rlShowDelta'))}</span></label>
            <label class="rs-inline" title="${esc(t('ov.rlMarksTip'))}"><input type="checkbox" class="rl-marks" ${prefs.marks ? 'checked' : ''}><span>${esc(t('ov.rlMarks'))}</span></label>
            <label class="rs-inline"><span>${esc(t('ov.rlPageSize'))}</span>
                <select class="rl-size">${PAGE_SIZES.map(s =>
                `<option value="${s}">${s === 0 ? esc(t('ov.rlAll')) : s}</option>`).join('')}</select></label>
            <span class="grow"></span>
            <button type="button" class="ov-btn rl-csv">${esc(t('ov.rlExportCsv'))}</button>
            <button type="button" class="ov-btn rl-copy">${esc(t('ov.rlCopyCsv'))}</button>
        </div>
        <div class="rl-body"></div>
    </div>`;
}

/** 詳細清單的列（把里程碑掛到「它之後最近的那一列」——那才是通關後的第一個觀測值）。 */
export function buildDetailRows(view: Sample[], milestones: Milestone[]): DetailRow[] {
    if (!view.length) return [];
    const lo = view[0].ts, hi = view[view.length - 1].ts;
    const byRow = new Map<number, Milestone[]>();
    for (const m of milestones) {
        if (m.ts < lo || m.ts > hi) continue;
        const row = view.find(s => s.ts >= m.ts) ?? view[view.length - 1];
        const list = byRow.get(row.ts);
        if (list) list.push(m); else byRow.set(row.ts, [m]);
    }
    return view.map((s, i) => ({
        ts: s.ts,
        m: s.m,
        d: i === 0 ? null : delta(view[i - 1], s),
        milestones: byRow.get(s.ts) ?? [],
    })).reverse();   // 新的在上
}

export const resourceLogSection: OverviewSection = {
    id: 'resource-log',
    titleKey: 'ov.resourceLog',
    async render(el, ctx) {
        // **先畫殼、再讀資料**（同 sortie／exped）：DB 阻塞時工具列仍可見。
        const prefs = loadPrefs();
        el.innerHTML = shellHtml(prefs);

        const body = el.querySelector<HTMLDivElement>('.rl-body')!;
        const granSel = el.querySelector<HTMLSelectElement>('.rl-gran')!;
        const sizeSel = el.querySelector<HTMLSelectElement>('.rl-size')!;
        granSel.value = prefs.gran;
        sizeSel.value = String(prefs.size);
        body.innerHTML = `<div class="ov-empty">${esc(t('ov.loading'))}</div>`;

        let all: Sample[] = [];
        let periods: ReturnType<typeof buildEventPeriods> = [];
        let allMilestones: Milestone[] = [];
        const opts: RenderOpts = {
            cols: prefs.cols,
            showDelta: prefs.showDelta,
            areaName: area => ctx.state.mapAreaName(area),
        };
        /** 指定期間（按「只看這次活動」設定）；非 null 時蓋過 prefs.range。 */
        let custom: { from: number; to: number } | null = null;
        let page = 1;
        /** 目前期間內、已依粒度收斂的樣本（清單與圖表共用）。 */
        let view: Sample[] = [];
        /** 圖表實際畫的（抽稀後）樣本與各格幾何，供十字準線查詢。 */
        let chartSamples: Sample[] = [];
        let geo: MultiChartGeometry | null = null;

        function rangeBounds(): { from: number; to: number } {
            if (custom) return custom;
            const to = all[all.length - 1].ts;
            const days = RANGES.find(r => r.key === prefs.range)?.days ?? 0;
            return { from: days ? to - days * 86_400_000 : all[0].ts, to };
        }

        const detailRows = () => buildDetailRows(view, prefs.marks ? allMilestones : []);

        function draw(keepScroll = false) {
            if (!all.length) {
                body.innerHTML = `<div class="ov-empty">${esc(t('ov.rlNone'))}</div>`;
                return;
            }
            const scroll = keepScroll ? body.scrollTop : 0;
            const { from, to } = rangeBounds();
            view = bucketSamples(all.filter(s => s.ts >= from && s.ts <= to), prefs.gran);
            chartSamples = downsample(view, MAX_POINTS);
            geo = chartGeo(chartSamples, prefs.series, from, to);
            opts.cols = prefs.cols;
            opts.showDelta = prefs.showDelta;

            const rows = detailRows();
            const p = paginate(rows, prefs.size, page);
            page = p.page;

            body.innerHTML =
                summaryHtml(all[all.length - 1], delta(view[0] ?? null, view[view.length - 1] ?? null), view, !!custom)
                + chartHtml(chartSamples, geo, prefs.series, all[all.length - 1])
                + (prefs.marks ? eventsHtml(periods, opts) : '')
                + colRackHtml(prefs.cols)
                + `<div class="rl-table-wrap">${tableHtml(p.rows, opts)}</div>`
                + (prefs.size && p.pageCount > 1 ? `<div class="rs-pager rl-pager">
                    <button type="button" class="ov-btn rl-page" data-step="-1" ${page <= 1 ? 'disabled' : ''}>${esc(t('ov.rlPagePrev'))}</button>
                    <span class="dim">${esc(t('ov.rlPageOf', { page, total: p.pageCount }))}</span>
                    <button type="button" class="ov-btn rl-page" data-step="1" ${page >= p.pageCount ? 'disabled' : ''}>${esc(t('ov.rlPageNext'))}</button>
                </div>` : '');

            if (keepScroll) body.scrollTop = scroll;
        }

        // ── 十字準線 ─────────────────────────────────────────────────
        // 所有序列共用同一組 x 座標，故只要算一次索引就能同時標出每條線在該時刻的點。
        function moveCrosshair(clientX: number) {
            const svg = body.querySelector<SVGSVGElement>('.rl-svg');
            if (!svg || !geo || !geo.xs.length) return;
            const rect = svg.getBoundingClientRect();
            const vx = ((clientX - rect.left) / Math.max(1, rect.width)) * BOX.width;
            const index = nearestIndex(geo.xs, vx);
            if (index < 0) return;
            const sample = chartSamples[index];
            const x = geo.xs[index];

            const cross = svg.querySelector<SVGLineElement>('.rl-cross');
            if (cross) {
                cross.setAttribute('x1', String(x));
                cross.setAttribute('x2', String(x));
                cross.removeAttribute('hidden');
            }
            const byKey = new Map(geo.series.map(sg => [sg.key, sg]));
            for (const dot of svg.querySelectorAll<SVGCircleElement>('.rl-cursor')) {
                const point = byKey.get(Number(dot.dataset.cursor))?.points[index];
                if (!point) { dot.setAttribute('hidden', ''); continue; }
                dot.setAttribute('cx', String(point.x));
                dot.setAttribute('cy', String(point.y));
                dot.removeAttribute('hidden');
            }

            const tip = body.querySelector<HTMLDivElement>('.rl-tip');
            if (!tip) return;
            // 提示框只列顯示中的序列——關掉的線不在圖上，列在這裡只會讓人找不到它
            tip.innerHTML = `<div class="rl-tip-time">${esc(fmtTs(sample.ts))}</div>`
                + `<div class="rl-tip-chips">${prefs.series.map(i =>
                    `<span class="rl-tip-row"><span class="rl-swatch rl-s${i}"></span>`
                    + matChip(i, fmtNum(sample.m[i] ?? 0)) + '</span>').join('')}</div>`;
            tip.hidden = false;
            const host = body.getBoundingClientRect();
            tip.style.left = `${Math.max(0, Math.min(host.width - tip.offsetWidth, clientX - host.left + 14))}px`;
            tip.style.top = `${svg.getBoundingClientRect().top - host.top + 8}px`;
        }

        function clearCrosshair() {
            for (const node of body.querySelectorAll<SVGElement>('.rl-cross, .rl-cursor')) {
                node.setAttribute('hidden', '');
            }
            const tip = body.querySelector<HTMLDivElement>('.rl-tip');
            if (tip) tip.hidden = true;
        }

        // ── 綁定（控制項只建一次；結果區一律事件委派，見 design-guidelines §4.2）──
        el.querySelector('.rl-range')!.addEventListener('click', ev => {
            const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-range]');
            if (!btn) return;
            prefs.range = btn.dataset.range!;
            custom = null;
            page = 1;
            savePrefs(prefs);
            el.querySelectorAll<HTMLButtonElement>('.rl-range button')
                .forEach(b => b.classList.toggle('on', b === btn));
            draw();
        });
        granSel.addEventListener('change', () => {
            prefs.gran = granSel.value as Granularity;
            page = 1; savePrefs(prefs); draw();
        });
        sizeSel.addEventListener('change', () => {
            prefs.size = Number(sizeSel.value) as PageSize;
            page = 1; savePrefs(prefs); draw();
        });
        el.querySelector<HTMLInputElement>('.rl-delta')!.addEventListener('change', ev => {
            prefs.showDelta = (ev.target as HTMLInputElement).checked;
            savePrefs(prefs); draw(true);
        });
        el.querySelector<HTMLInputElement>('.rl-marks')!.addEventListener('change', ev => {
            prefs.marks = (ev.target as HTMLInputElement).checked;
            savePrefs(prefs); draw();
        });

        const csv = () => toCsv(
            detailRows(), prefs.cols,
            { time: t('ov.rlTime'), mats: MAT_KEYS.map(k => t(k + '.full')) },
            prefs.showDelta,
        );
        el.querySelector<HTMLButtonElement>('.rl-csv')!.addEventListener('click', () =>
            downloadText(`kanmusu-resources-${new Date().toISOString().slice(0, 10)}.csv`, csv(), 'text/csv'));
        el.querySelector<HTMLButtonElement>('.rl-copy')!.addEventListener('click', ev =>
            copyWithFeedback(ev.currentTarget as HTMLButtonElement, csv(), t('ov.rlCopied')));

        /** 圖例開關。結果區每次重繪都換掉子元素，故走事件委派。 */
        function setSeries(next: MatIndex[]) {
            if (!next.length) return;   // 全部關掉會變成一張空白圖，至少留一條
            prefs.series = ALL_COLS.filter(i => next.includes(i));
            savePrefs(prefs);
            draw(true);
        }

        body.addEventListener('click', ev => {
            const target = ev.target as HTMLElement;
            const leg = target.closest<HTMLButtonElement>('.rl-leg');
            if (leg) {
                const i = Number(leg.dataset.series) as MatIndex;
                setSeries(prefs.series.includes(i)
                    ? prefs.series.filter(x => x !== i) : [...prefs.series, i]);
                return;
            }
            if (target.closest('.rl-series-all')) { setSeries([...ALL_COLS]); return; }
            // 「只看四大資源」：燃彈鋼鋁量級相近，這是最常用的一組
            if (target.closest('.rl-series-main')) { setSeries([0, 1, 2, 3]); return; }
            // 詳細清單的欄位開關（純圖示鈕）。至少留一欄，全部關掉會變成一張只有時間的空表
            const colBtn = target.closest<HTMLButtonElement>('.rl-colbtn');
            if (colBtn) {
                const i = Number(colBtn.dataset.col) as MatIndex;
                const next = prefs.cols.includes(i) ? prefs.cols.filter(x => x !== i) : [...prefs.cols, i];
                if (!next.length) return;
                prefs.cols = ALL_COLS.filter(x => next.includes(x));
                savePrefs(prefs);
                draw(true);
                return;
            }
            const only = target.closest<HTMLButtonElement>('.rl-only');
            if (only) {
                // 要看得出「開打前的水位」，故區間往前後各留一小時餘裕
                custom = { from: Number(only.dataset.from) - 3_600_000, to: Number(only.dataset.to) + 3_600_000 };
                page = 1;
                draw();
                return;
            }
            if (target.closest('.rl-clear-custom')) { custom = null; page = 1; draw(); return; }
            const pager = target.closest<HTMLButtonElement>('.rl-page');
            if (pager) { page += Number(pager.dataset.step); draw(); }
        });
        body.addEventListener('pointermove', ev => {
            if ((ev.target as HTMLElement).closest('.rl-chart')) moveCrosshair(ev.clientX);
            else clearCrosshair();
        });
        body.addEventListener('pointerleave', clearCrosshair);

        try {
            const [rawRows, markRows] = await Promise.all([
                db.resources.orderBy('ts').toArray() as Promise<ResourceRow[]>,
                db.resourceMarks.orderBy('ts').toArray() as Promise<ResourceMarkRow[]>,
            ]);
            all = normalizeSamples(rawRows);
            periods = buildEventPeriods(markRows, all);
            allMilestones = periods.flatMap(p => p.milestones);
            draw();
        } catch (error) {
            body.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
        }
    },
};
