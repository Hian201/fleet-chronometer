// 遠征紀錄：期間彙總（跑了哪些遠征、各幾次、總共拿回多少資源）＋可選欄位的詳細清單。
// 遠征編成是 result 當下的摘要快照；舊紀錄沒有就誠實標為不可考。
//
// ── 期間彙總為什麼落在這一區（別搬到資源紀錄）────────────────────────────
// 遠征收入是**逐筆事件的獲得量**（`api_get_material`，封包直接給、可加總），資源紀錄
// 的一切消長則是**兩個時刻的餘額差分**。兩者放同一張表必然被拿去互相對照，但中間隔著
// 出擊消耗、補給、建造、任務獎勵，本來就對不起來。彙總邏輯在 utils/expedition-stats.ts
// （純函式、node 可測），本檔只負責 UI 狀態。
//
// ── 版面慣例 ────────────────────────────────────────────────────────────
// 控制項只建一次、只重繪 `.el-body`（design-guidelines §4.2 的第二種例外）：這裡有
// 關鍵字與日期輸入框，整塊重繪會讓輸入框每打一個字就失焦。
import type { ExpeditionRow, ResourceMarkRow } from '@/utils/db';
import type { OverviewSection, SectionContext } from './types';
import { db } from '@/utils/db';
import { expedDisplayName, t } from '@/utils/ui-i18n';
import { buildEventPeriods, type EventPeriod } from '@/utils/resource-log';
import {
    EXPED_MAT_COUNT, filterByPeriod, groupByMission, sortStats, statsCsv, summarize,
    type ExpeditionStat, type ExpeditionTotals, type StatSortKey,
} from '@/utils/expedition-stats';
import {
    copyWithFeedback, dateEnd, dateStart, downloadText, esc, fmtTs, loadJsonPrefs,
    matIconHtml, paginate, saveJsonPrefs,
} from '../lib';
import { rowsToCsv } from '@/utils/csv';

const PREFS_KEY = 'kc-exped-log-view';
const RESULT_KEYS = ['ov.expedFail', 'ov.expedSuccess', 'ov.expedGreat'];
const MAT_FILES = ['fuel', 'ammo', 'steel', 'bauxite'];
const MAT_LABELS = ['mat.fuel', 'mat.ammo', 'mat.steel', 'mat.bauxite'];

// 期間捷徑。錨點是**最後一筆紀錄**而非現在（同資源紀錄的 rangeBounds）：久沒上線時
// 以現在為錨會讓「7 天」一片空白，看起來像資料不見了。實際起訖一律寫在彙總列上。
const RANGES = [
    { key: '7', days: 7, labelKey: 'ov.rlRange7' },
    { key: '30', days: 30, labelKey: 'ov.rlRange30' },
    { key: '90', days: 90, labelKey: 'ov.rlRange90' },
    { key: 'all', days: 0, labelKey: 'ov.rlRangeAll' },
] as const;

const PAGE_SIZES = [20, 50, 100, 200, 0] as const;
type PageSize = typeof PAGE_SIZES[number];

type ColumnId = 'time' | 'type' | 'fleet' | 'result' | 'fuel' | 'ammo' | 'steel' | 'bauxite' | 'items';

interface Column {
    id: ColumnId;
    labelKey: string;
    on: boolean;
    cell(row: ExpeditionRow): string;
    /** CSV 用的純文字（匯出跟著顯示欄位走，同 ships／equipment 分區的規則）。 */
    text(row: ExpeditionRow): string;
}

const materialCell = (index: number) => (row: ExpeditionRow) => {
    const value = row.resources?.[index] ?? 0;
    return value > 0
        ? `<span class="el-mat">${matIconHtml(MAT_FILES[index], t(MAT_LABELS[index]))}<b>${esc(String(value))}</b></span>`
        : `<span class="el-none">–</span>`;
};

const itemsText = (row: ExpeditionRow) =>
    (row.items ?? []).map(item => `#${item.id}x${item.count}`).join(' ');

export const COLUMNS: Column[] = [
    {
        id: 'time', labelKey: 'ov.expedColTime', on: true,
        cell: r => `<time>${esc(fmtTs(r.ts))}</time>`,
        text: r => new Date(r.ts).toISOString(),
    },
    {
        id: 'type', labelKey: 'ov.expedColType', on: true,
        // 活動限定的 S1／S2 支援遠征補「道中／王點」註記；CSV 的 text 刻意維持封包原名，
        // 匯出的是資料不是解說。
        cell: r => `<div class="el-type"><b title="${esc(expedDisplayName(r.missionId, r.name))}">${
            esc(r.name ? expedDisplayName(r.missionId, r.name) : `#${r.missionId}`)}</b>`
            + `<span>${esc(t('ov.expedDeck', { n: r.deckId }))} · #${r.missionId || '–'}</span></div>`,
        text: r => `${r.name || ''} #${r.missionId || ''}`.trim(),
    },
    {
        // 編成**預設收合**（使用者要求）：六艘 chip 攤開會讓每一列高出好幾倍，而逐筆
        // 瀏覽時要看的是「這趟拿了什麼」，編成是想確認時才點開的細節。折疊一律用原生
        // `<details>`（design-guidelines §4.3），caret 走 ::before 字元不用 rotate。
        id: 'fleet', labelKey: 'ov.expedColFleet', on: true,
        cell: r => r.fleet?.length
            ? `<details class="el-fleet-d"><summary>${esc(t('unit.ships', { n: r.fleet.length }))}</summary>`
            + `<div class="el-fleet">${r.fleet.map(ship => `<span class="el-ship" title="${esc(`${ship.name} Lv${ship.level}`)}">${esc(ship.name)}<i>Lv${ship.level}</i></span>`).join('')}</div></details>`
            : `<span class="el-unknown" title="${esc(t('ov.expedFleetUnknownTip'))}">${esc(t('ov.expedUnknown'))}</span>`,
        text: r => r.fleet?.length ? r.fleet.map(s => `${s.name} Lv${s.level}`).join(' / ') : t('ov.expedUnknown'),
    },
    {
        id: 'result', labelKey: 'ov.expedColResult', on: true,
        cell: r => `<span class="el-result r${r.result}">${esc(t(RESULT_KEYS[r.result] ?? 'ov.expedSuccess'))}</span>`,
        text: r => t(RESULT_KEYS[r.result] ?? 'ov.expedSuccess'),
    },
    { id: 'fuel', labelKey: 'mat.fuel.full', on: true, cell: materialCell(0), text: r => String(r.resources?.[0] ?? 0) },
    { id: 'ammo', labelKey: 'mat.ammo.full', on: true, cell: materialCell(1), text: r => String(r.resources?.[1] ?? 0) },
    { id: 'steel', labelKey: 'mat.steel.full', on: true, cell: materialCell(2), text: r => String(r.resources?.[2] ?? 0) },
    { id: 'bauxite', labelKey: 'mat.bauxite.full', on: true, cell: materialCell(3), text: r => String(r.resources?.[3] ?? 0) },
    {
        id: 'items', labelKey: 'ov.expedColItems', on: true,
        cell: r => r.items?.length
            ? `<div class="el-items">${r.items.map(item => `<span>#${item.id} ×${item.count}</span>`).join('')}</div>`
            : `<span class="el-none">–</span>`,
        text: itemsText,
    },
];

// 彙總表的欄位（表頭可點排序；數值欄第一次點由大到小，同艦娘全覽的規則）。
const STAT_COLUMNS: { key: StatSortKey; labelKey: string; numeric: boolean }[] = [
    { key: 'mission', labelKey: 'ov.expedColMission', numeric: false },
    { key: 'count', labelKey: 'ov.expedColCount', numeric: true },
    { key: 'great', labelKey: 'ov.expedGreat', numeric: true },
    { key: 'fail', labelKey: 'ov.expedFail', numeric: true },
    { key: 'fuel', labelKey: 'mat.fuel.full', numeric: true },
    { key: 'ammo', labelKey: 'mat.ammo.full', numeric: true },
    { key: 'steel', labelKey: 'mat.steel.full', numeric: true },
    { key: 'bauxite', labelKey: 'mat.bauxite.full', numeric: true },
    { key: 'last', labelKey: 'ov.expedColLast', numeric: true },
];

export interface Prefs {
    cols: ColumnId[];
    range: string;
    size: PageSize;
    sort: StatSortKey;
    desc: boolean;
    /** 「各遠征次數與收穫」是否展開。**必須持久化**：表頭排序會觸發整塊重繪，
     *  不記狀態的話每點一次排序就自己收合起來。 */
    statsOpen: boolean;
}

export const defaultPrefs = (): Prefs => ({
    cols: COLUMNS.filter(c => c.on).map(c => c.id),
    range: '30', size: 50, sort: 'count', desc: true, statsOpen: false,
});

function loadPrefs(): Prefs {
    const d = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, d, raw => {
        const r = raw as {
            cols?: unknown; range?: unknown; size?: unknown; sort?: unknown; desc?: unknown;
            statsOpen?: unknown;
        } | null;
        const ids = new Set(COLUMNS.map(c => c.id));
        const cols = Array.isArray(r?.cols)
            ? COLUMNS.filter(c => (r!.cols as unknown[]).includes(c.id) && ids.has(c.id)).map(c => c.id)
            : d.cols;
        return {
            // 不能沒有可見欄位，否則表格失去內容與可恢復控制項。
            cols: cols.length ? cols : d.cols,
            range: RANGES.some(range => range.key === r?.range) ? r!.range as Prefs['range'] : d.range,
            size: (PAGE_SIZES as readonly number[]).includes(r?.size as number) ? r!.size as PageSize : d.size,
            sort: STAT_COLUMNS.some(c => c.key === r?.sort) ? r!.sort as Prefs['sort'] : d.sort,
            desc: typeof r?.desc === 'boolean' ? r.desc : d.desc,
            statsOpen: typeof r?.statsOpen === 'boolean' ? r.statsOpen : d.statsOpen,
        };
    });
}

function savePrefs(prefs: Prefs) {
    saveJsonPrefs(PREFS_KEY, prefs);
}

// ── 日期輸入 ↔ 時間戳 ────────────────────────────────────────────────────
// `ExpeditionRow.ts` 是絕對時間戳，日期輸入框給的是玩家心裡的本地日期，故兩端各自
// 補到本地日的頭與尾（同 drop-log 分區）；dateStart／dateEnd 見 ../lib。

/** 時間戳 → `<input type="date">` 的本地日期字串（不能用 toISOString，那是 UTC）。 */
function dateInputValue(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const fmtNum = (n: number) => n.toLocaleString();

const matChip = (index: number, value: string, cls = '') =>
    `<span class="el-sum-chip ${cls}" title="${esc(t(MAT_LABELS[index] + '.full'))}">`
    + `${matIconHtml(MAT_FILES[index], t(MAT_LABELS[index]))}<b>${esc(value)}</b></span>`;

// ── 純 HTML 建構器 ────────────────────────────────────────────────────────

/** 期間彙總：四資源小計＋次數分佈＋回航道具。 */
export function summaryHtml(totals: ExpeditionTotals, from: number | null, to: number | null, rows: ExpeditionRow[]): string {
    // 起訖一律用「實際落在期間內的紀錄」的頭尾——捷徑窗與自訂日期都可能比資料本身寬，
    // 寫成使用者選的那個範圍會讓人誤以為兩端之間都有觀測。
    const first = rows[rows.length - 1], last = rows[0];   // rows 為時間降冪
    const span = first && last
        ? t('ov.expedSumRange', { from: fmtTs(first.ts), to: fmtTs(last.ts) })
        : t('ov.expedSumRangeNone', {
            from: from == null ? '–' : fmtTs(from),
            to: to == null ? '–' : fmtTs(to),
        });
    return `<div class="el-summary">
        <div class="el-sum-block">
            <span class="el-sum-label">${esc(t('ov.expedGain'))}</span>
            <span class="el-sum-chips">${Array.from({ length: EXPED_MAT_COUNT }, (_, i) =>
        matChip(i, fmtNum(totals.resources[i] ?? 0))).join('')}</span>
        </div>
        <div class="el-sum-block">
            <span class="el-sum-label">${esc(t('ov.expedRuns'))}</span>
            <span class="el-sum-chips">
                <span class="el-sum-chip"><b>${esc(t('ov.expedTotalCount', { n: totals.count }))}</b></span>
                <span class="el-sum-chip r1"><b>${esc(t('ov.expedTotalSuccess', { n: totals.success, g: totals.great }))}</b></span>
                <span class="el-sum-chip r0"><b>${esc(t('ov.expedTotalFail', { n: totals.fail }))}</b></span>
            </span>
        </div>
        ${totals.items.length ? `<div class="el-sum-block">
            <span class="el-sum-label" title="${esc(t('ov.expedItemsTip'))}">${esc(t('ov.expedItemsLabel'))}</span>
            <span class="el-sum-chips">${totals.items.map(item =>
        `<span class="el-sum-chip"><b>#${item.id} ×${item.count}</b></span>`).join('')}</span>
        </div>` : ''}
        <div class="el-sum-meta dim">${esc(span)}</div>
    </div>`;
}

/**
 * 各遠征的次數與收穫。**這是次要的查詢工具、不是主表**：本分區的主體是逐筆明細
 * （一趟遠征回來拿了什麼、多少、成功還是失敗），依遠征種類加總的統計是想回答
 * 「哪個遠征跑最多／最賺」時才展開的另一個問題，故收進 `<details>` 放在明細下方。
 */
export function statsHtml(stats: ExpeditionStat[], prefs: Prefs): string {
    if (!stats.length) return '';
    return `<details class="el-stats"${prefs.statsOpen ? ' open' : ''}>
        <summary class="el-h">${esc(t('ov.expedByMission'))}</summary>
        <div class="el-table-wrap"><table class="el-table el-sum-table"><thead><tr>${STAT_COLUMNS.map(c => {
        const on = prefs.sort === c.key;
        return `<th class="el-s-${c.key}${c.numeric ? ' el-num' : ''}${on ? ' on' : ''}">`
            + `<button type="button" class="el-sort" data-sort="${c.key}" data-numeric="${c.numeric ? 1 : 0}">`
            + `${esc(t(c.labelKey))}${on ? (prefs.desc ? ' ▾' : ' ▴') : ''}</button></th>`;
    }).join('')}</tr></thead><tbody>${stats.map(stat => `<tr>
            <td class="el-s-mission"><div class="el-type"><b title="${esc(expedDisplayName(stat.missionId, stat.name))}">${
            esc(stat.name ? expedDisplayName(stat.missionId, stat.name) : `#${stat.missionId}`)}</b>`
        + `<span>#${stat.missionId || '–'}</span></div></td>
            <td class="el-s-count el-num"><b>${esc(fmtNum(stat.count))}</b></td>
            <td class="el-s-great el-num">${stat.great ? `<span class="el-result r2">${esc(fmtNum(stat.great))}</span>` : `<span class="el-none">–</span>`}</td>
            <td class="el-s-fail el-num">${stat.fail ? `<span class="el-result r0">${esc(fmtNum(stat.fail))}</span>` : `<span class="el-none">–</span>`}</td>
            ${Array.from({ length: EXPED_MAT_COUNT }, (_, i) => `<td class="el-s-${MAT_FILES[i]} el-num">${stat.resources[i]
            ? `<span class="el-mat">${matIconHtml(MAT_FILES[i], t(MAT_LABELS[i]))}<b>${esc(fmtNum(stat.resources[i]))}</b></span>`
            : `<span class="el-none">–</span>`}</td>`).join('')}
            <td class="el-s-last el-c-time">${esc(fmtTs(stat.lastTs))}</td>
        </tr>`).join('')}</tbody></table></div>
    </details>`;
}

export function tableHtml(rows: ExpeditionRow[], cols: Column[]) {
    return `<div class="el-table-wrap"><table class="el-table"><thead><tr>${cols.map(c =>
        `<th class="el-c-${c.id}">${esc(t(c.labelKey))}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
        `<tr>${cols.map(c => `<td class="el-c-${c.id}">${c.cell(row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** 活動期間捷徑的選項文字（`db.resourceMarks` 推出來的區段，見 utils/resource-log.ts）。 */
function periodLabel(period: EventPeriod, ctx: SectionContext): string {
    const name = ctx.state.mapAreaName(period.area) || `#${period.area}`;
    return `${name}（${dateInputValue(period.startTs)} – ${dateInputValue(period.endTs)}）`;
}

export const expedLogSection: OverviewSection = {
    id: 'exped-log',
    titleKey: 'ov.expedLog',
    async render(el, ctx) {
        // 先畫殼，再讀 IndexedDB；讀取被其他頁面的 schema 升級阻塞時也不能留下空白分區。
        const prefs = loadPrefs();
        let page = 1;
        el.innerHTML = `<div class="el">
            <p class="ov-note">${esc(t('ov.expedStatsNote'))}</p>
            <div class="ov-toolbar el-bar">
                <span class="el-label">${esc(t('ov.rlRange'))}</span>
                <div class="rs-seg el-range">${RANGES.map(r =>
            `<button type="button" data-range="${r.key}">${esc(t(r.labelKey))}</button>`).join('')}</div>
                <label class="rs-inline el-date"><span>${esc(t('ov.buildFilterTime'))}</span>
                    <input type="date" class="el-from" aria-label="${esc(t('ov.buildFilterFrom'))}">
                    <span>–</span>
                    <input type="date" class="el-to" aria-label="${esc(t('ov.buildFilterTo'))}"></label>
                <label class="rs-inline el-eventpick" hidden><span>${esc(t('ov.expedEventPreset'))}</span>
                    <select class="el-event"><option value="">${esc(t('ov.expedEventPick'))}</option></select></label>
                <input class="rs-search el-keyword" type="search" autocomplete="off" list="el-missions" placeholder="${esc(t('ov.expedFilterKeyword'))}">
                <label class="rs-inline"><span>${esc(t('ov.rsPageSize'))}</span>
                    <select class="el-size">${PAGE_SIZES.map(s =>
                `<option value="${s}" ${s === prefs.size ? 'selected' : ''}>${s === 0 ? esc(t('ov.rsAll')) : s}</option>`).join('')}</select></label>
                <span class="el-count"></span>
                <span class="grow"></span>
                <details class="rs-colmenu el-colmenu">
                    <summary class="ov-btn">${esc(t('ov.expedColumns'))}</summary>
                    <div class="rs-colbox">${COLUMNS.map(c =>
                    `<label class="eo-chip"><input type="checkbox" class="el-col" value="${c.id}" ${prefs.cols.includes(c.id) ? 'checked' : ''}>${esc(t(c.labelKey))}</label>`).join('')}</div>
                </details>
                <button type="button" class="ov-btn el-csv">${esc(t('ov.rsExportCsv'))}</button>
                <button type="button" class="ov-btn el-copy">${esc(t('ov.rsCopyCsv'))}</button>
                <button type="button" class="ov-btn el-sum-csv">${esc(t('ov.expedSumCsv'))}</button>
            </div>
            <div class="el-body"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
            <div class="rs-pager el-pager" hidden></div>
        </div>`;

        const body = el.querySelector<HTMLElement>('.el-body')!;
        const count = el.querySelector<HTMLElement>('.el-count')!;
        const pager = el.querySelector<HTMLElement>('.el-pager')!;
        const rangeButtons = el.querySelectorAll<HTMLButtonElement>('.el-range button');
        const fromInput = el.querySelector<HTMLInputElement>('.el-from')!;
        const toInput = el.querySelector<HTMLInputElement>('.el-to')!;
        const eventPick = el.querySelector<HTMLLabelElement>('.el-eventpick')!;
        const eventSel = el.querySelector<HTMLSelectElement>('.el-event')!;
        const keyword = el.querySelector<HTMLInputElement>('.el-keyword')!;

        let all: ExpeditionRow[] = [];        // 時間降冪（新的在上）
        let periods: EventPeriod[] = [];

        /**
         * 目前的期間。自訂日期只要填了任一端就蓋過捷徑窗（另一端維持不設限），
         * 這樣「從某天以後」也是一次輸入就問得出來。
         */
        function bounds(): { from: number | null; to: number | null } {
            const from = dateStart(fromInput.value);
            const to = dateEnd(toInput.value);
            if (from != null || to != null) return { from, to };
            const days = RANGES.find(r => r.key === prefs.range)?.days ?? 0;
            if (!days || !all.length) return { from: null, to: null };
            const anchor = all[0].ts;   // 最後一筆紀錄
            return { from: anchor - days * 86_400_000, to: null };
        }

        const custom = () => dateStart(fromInput.value) != null || dateEnd(toInput.value) != null;

        const matches = (row: ExpeditionRow) => {
            const query = keyword.value.trim().toLocaleLowerCase();
            if (!query) return true;
            return `${row.name} #${row.missionId}`.toLocaleLowerCase().includes(query);
        };

        /** 期間＋關鍵字篩選後的紀錄（彙總、清單與兩份 CSV 共用同一個母集合）。 */
        function selected(): ExpeditionRow[] {
            const { from, to } = bounds();
            return filterByPeriod(all, from, to).filter(matches);
        }

        function draw() {
            // 自訂日期生效時捷徑窗一律不亮，否則兩個控制項會同時看起來像「正在生效」
            const useRange = !custom();
            rangeButtons.forEach(b => b.classList.toggle('on', useRange && b.dataset.range === prefs.range));

            const { from, to } = bounds();
            const rows = selected();
            const totals = summarize(rows);
            const stats = sortStats(groupByMission(rows), prefs.sort, prefs.desc);

            const p = paginate(rows, prefs.size, page);
            page = p.page;
            const cols = COLUMNS.filter(c => prefs.cols.includes(c.id));

            count.textContent = t('ov.expedCountOf', { n: rows.length, total: all.length });
            // 順序＝這一區在回答的問題的優先序：期間總計（脈絡，一行）→ **逐筆明細（主體）**
            // → 各遠征彙總（收合，想查「哪個遠征跑最多」時才展開）。
            body.innerHTML = all.length
                ? summaryHtml(totals, from, to, rows)
                    + (p.rows.length
                        ? `<section class="el-detail">${tableHtml(p.rows, cols)}</section>`
                        : `<div class="ov-empty">${esc(t('ov.expedNoneInRange'))}</div>`)
                    + statsHtml(stats, prefs)
                : `<div class="ov-empty">${esc(t('ov.expedNone'))}</div>`;
            // `toggle` 不會冒泡，無法用 body 委派；每次重繪都是新節點，就地重綁即可
            // （舊監聽器隨舊節點一起消失）。
            body.querySelector<HTMLDetailsElement>('.el-stats')?.addEventListener('toggle', event => {
                prefs.statsOpen = (event.currentTarget as HTMLDetailsElement).open;
                savePrefs(prefs);
            });
            pager.innerHTML = p.pageCount > 1 ? `
                <button type="button" class="ov-btn el-page" data-page="prev" ${page <= 1 ? 'disabled' : ''}>‹</button>
                <span class="rs-pageno">${esc(t('ov.rsPageOf', { page, pages: p.pageCount }))}</span>
                <button type="button" class="ov-btn el-page" data-page="next" ${page >= p.pageCount ? 'disabled' : ''}>›</button>` : '';
            pager.hidden = p.pageCount <= 1;
        }

        const changed = () => { page = 1; draw(); };

        // ── 綁定（控制項只建一次；結果區一律事件委派）──────────────────
        rangeButtons.forEach(button => button.addEventListener('click', () => {
            prefs.range = button.dataset.range!;
            // 按捷徑＝放棄自訂日期，否則按了沒反應（自訂永遠蓋過捷徑）
            fromInput.value = '';
            toInput.value = '';
            eventSel.value = '';
            savePrefs(prefs);
            changed();
        }));
        [fromInput, toInput].forEach(input => input.addEventListener('input', () => {
            eventSel.value = '';
            changed();
        }));
        keyword.addEventListener('input', changed);
        eventSel.addEventListener('change', () => {
            const period = periods.find(p => String(p.area) === eventSel.value);
            if (!period) { fromInput.value = ''; toInput.value = ''; changed(); return; }
            fromInput.value = dateInputValue(period.startTs);
            toInput.value = dateInputValue(period.endTs);
            changed();
        });
        el.querySelector<HTMLSelectElement>('.el-size')!.addEventListener('change', event => {
            prefs.size = Number((event.currentTarget as HTMLSelectElement).value) as PageSize;
            savePrefs(prefs);
            changed();
        });
        el.querySelectorAll<HTMLInputElement>('.el-col').forEach(box => box.addEventListener('change', () => {
            const checked = new Set([...el.querySelectorAll<HTMLInputElement>('.el-col')]
                .filter(input => input.checked).map(input => input.value as ColumnId));
            // 至少保留一欄；關掉最後一欄時把它復原，避免控制項本身消失後無從復原。
            if (!checked.size) { box.checked = true; return; }
            prefs.cols = COLUMNS.filter(c => checked.has(c.id)).map(c => c.id);
            savePrefs(prefs);
            draw();
        }));
        pager.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.el-page');
            if (!button) return;
            page += button.dataset.page === 'next' ? 1 : -1;
            draw();
        });
        // 彙總表的表頭排序：數值欄第一次點由大到小（要看的是「最多／最賺」那幾列）
        body.addEventListener('click', event => {
            const sorter = (event.target as HTMLElement).closest<HTMLButtonElement>('.el-sort');
            if (!sorter) return;
            const key = sorter.dataset.sort as StatSortKey;
            prefs.desc = prefs.sort === key ? !prefs.desc : sorter.dataset.numeric === '1';
            prefs.sort = key;
            savePrefs(prefs);
            draw();
        });

        // ── CSV 匯出 ──────────────────────────────────────────────────
        // 兩份匯出對應兩個問題：彙總＝「哪些遠征各幾次、賺了多少」，明細＝逐筆紀錄。
        const statsCsvText = () => statsCsv(
            sortStats(groupByMission(selected()), prefs.sort, prefs.desc),
            {
                mission: t('ov.expedColMission'), name: t('ov.expedColType'),
                count: t('ov.expedColCount'), great: t('ov.expedGreat'), fail: t('ov.expedFail'),
                mats: MAT_LABELS.map(k => t(k + '.full')), last: t('ov.expedColLast'),
            },
        );
        const detailCsvText = () => {
            const cols = COLUMNS.filter(c => prefs.cols.includes(c.id));
            return rowsToCsv([
                cols.map(c => t(c.labelKey)),
                ...selected().map(row => cols.map(c => c.text(row))),
            ]);
        };
        const stamp = () => new Date().toISOString().slice(0, 10);
        el.querySelector<HTMLButtonElement>('.el-sum-csv')!.addEventListener('click', () =>
            downloadText(`kanmusu-expedition-stats-${stamp()}.csv`, statsCsvText(), 'text/csv'));
        el.querySelector<HTMLButtonElement>('.el-csv')!.addEventListener('click', () =>
            downloadText(`kanmusu-expeditions-${stamp()}.csv`, detailCsvText(), 'text/csv'));
        el.querySelector<HTMLButtonElement>('.el-copy')!.addEventListener('click', event =>
            copyWithFeedback(event.currentTarget as HTMLButtonElement, detailCsvText(), t('ov.rsCopied')));

        // ── 資料載入 ──────────────────────────────────────────────────
        try {
            // 活動期間捷徑靠 db.resourceMarks（v12 才有，舊安裝可能整張表是空的）；
            // 它只是捷徑，讀不到就不顯示那個控制項，不影響彙總本身。
            const [rows, marks] = await Promise.all([
                db.expeditions.orderBy('ts').reverse().toArray(),
                db.resourceMarks.orderBy('ts').toArray().catch((): ResourceMarkRow[] => []),
            ]);
            all = rows;
            periods = buildEventPeriods(marks, []);
            if (periods.length) {
                eventSel.insertAdjacentHTML('beforeend', periods.map(p =>
                    `<option value="${p.area}">${esc(periodLabel(p, ctx))}</option>`).join(''));
                eventPick.hidden = false;
            }
            const names = [...new Set(all.map(row => row.name).filter(Boolean))];
            keyword.insertAdjacentHTML('afterend',
                `<datalist id="el-missions">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`);
            draw();
        } catch (error) {
            count.textContent = '';
            body.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`;
        }
    },
};
