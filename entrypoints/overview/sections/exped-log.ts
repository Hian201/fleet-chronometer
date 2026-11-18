// 遠征：紀錄／規劃／開放三個子分頁（hash 參數 sub=log|plan|unlock，預設紀錄）。
// 紀錄：期間彙總（跑了哪些遠征、各幾次、總共拿回多少資源）＋可選欄位的詳細清單。
// 遠征編成是 result 當下的摘要快照；缺少快照的紀錄誠實標為不可考。
// 規劃：遠征組合建議。開放：月常解鎖路徑與一般遠征的開放狀況（exped-unlock.ts）。
// 三頁都在同一次 render 建好、切換只改 hidden，輸入、展開與捲動都保留（design-guidelines §4.2）。
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
import { expedDisplayName, getLang, t } from '@/utils/ui-i18n';
import { buildEventPeriods, type EventPeriod } from '@/utils/resource-log';
import { DAY_MS, formatDate, formatDateTime } from '@/utils/date-format';
import { DEFAULT_CHOSEN, MIN_RUNS, PLAN_KEYS, SPEND_BASES, lightestWeek, planExpeditionSteps, resourceNeeds, type ExpeditionPlan, type PlanKey, type PlanRow, type SpendBasis } from '@/utils/expedition-plan';
import { stockpileFromRows, type StockpileGoal } from '@/utils/stockpile';
import { goalsFromRows, remodelStockOf, type RemodelGoal } from '@/utils/remodel-goals';
import { FLOW_BLOCK_DAYS, FLOW_MAX_BLOCKS, type ObservedFlow } from '@/utils/goal-arrival';
import {
    EXPED_MAT_COUNT, filterByPeriod, groupByMission, sortStats, statsCsv, summarize,
    type ExpeditionStat, type ExpeditionTotals, type StatSortKey,
} from '@/utils/expedition-stats';
import {
    copyWithFeedback, dateEnd, dateStart, downloadText, esc, fmtNum, fmtTs, hashParams,
    itemName, loadJsonPrefs, matIconHtml, paginate, USE_ITEM_ICONS, parseColumnIds, parsePageSize, saveJsonPrefs,
} from '../lib';
import { loadGoalFlow, stockpileLinesOf } from './goals';
import { rowsToCsv } from '@/utils/csv';
import { unlockPageHtml } from './exped-unlock';

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

const itemText = (item: { id: number; count: number }) => `${itemName(item.id)} ×${item.count}`;
const itemsText = (row: ExpeditionRow) => (row.items ?? []).map(itemText).join(' / ');
const itemHtml = (item: { id: number; count: number }) => USE_ITEM_ICONS[item.id]
    ? `<img class="m-icon" src="/icons/${USE_ITEM_ICONS[item.id]}.svg" alt="${esc(itemName(item.id))}"><b>×${esc(String(item.count))}</b>`
    : esc(itemText(item));

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
            ? `<div class="el-items">${r.items.map(item => `<span title="${esc(itemName(item.id))}">${itemHtml(item)}</span>`).join('')}</div>`
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
        return {
            cols: parseColumnIds(r?.cols, COLUMNS, d.cols),
            range: RANGES.some(range => range.key === r?.range) ? r!.range as Prefs['range'] : d.range,
            size: parsePageSize(r?.size, PAGE_SIZES, d.size),
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
        `<span class="el-sum-chip" title="${esc(itemName(item.id))}">${itemHtml(item)}</span>`).join('')}</span>
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

// ── 遠征組合建議 ──────────────────────────────────────────────────────────
// 排序邏輯在 utils/expedition-plan.ts（純函式）；這裡只有偏好、資料載入與 HTML。

const PLAN_PREFS_KEY = 'kc-exped-plan';
const PLAN_DEFAULT_HOURS = 3;
/** 沒設備蓄期限時的推算時點：與流量的觀測窗同長（FLOW_MAX_BLOCKS 週）。 */
const PLAN_DEFAULT_HORIZON_DAYS = FLOW_MAX_BLOCKS * FLOW_BLOCK_DAYS;

/** hours：在線時多久回來收一次遠征；sleep：每天一次較長離開的小時數（0＝不另排睡前組合）；basis：支出照哪一段算。 */
export interface PlanPrefs { hours: number; sleep: number; basis: SpendBasis; chosen: PlanKey[] }

/** 睡前離開的上限（小時）：再長就幾乎沒有在線時間，在線組合失去意義。 */
const PLAN_MAX_SLEEP = 20;
/** 精確搜尋先同步試算的時間（毫秒）：算得完就不先閃一下近似解。 */
const PLAN_SYNC_MS = 100;
/** 之後在背景每段算多久（毫秒）。 */
const PLAN_SLICE_MS = 30;

export const defaultPlanPrefs = (): PlanPrefs => ({ hours: PLAN_DEFAULT_HOURS, sleep: 0, basis: 'recent', chosen: [...DEFAULT_CHOSEN] });

function loadPlanPrefs(): PlanPrefs {
    const d = defaultPlanPrefs();
    return loadJsonPrefs(PLAN_PREFS_KEY, d, raw => {
        const r = raw as Partial<Record<keyof PlanPrefs, unknown>> | null;
        return {
            hours: typeof r?.hours === 'number' && r.hours > 0 && r.hours <= 168 ? r.hours : d.hours,
            sleep: typeof r?.sleep === 'number' && r.sleep >= 0 && r.sleep <= PLAN_MAX_SLEEP ? r.sleep : d.sleep,
            basis: SPEND_BASES.includes(r?.basis as SpendBasis) ? r!.basis as SpendBasis : d.basis,
            chosen: Array.isArray(r?.chosen) ? PLAN_KEYS.filter(key => (r!.chosen as unknown[]).includes(key)) : d.chosen,
        };
    });
}

export interface PlanView {
    plan: ExpeditionPlan;
    /** 勾選的資材，依顯示順序。 */
    chosen: PlanKey[];
    hasMaster: boolean;
    /** 沒有資源流量資料：只能用遠征本身推算，不含自然回復、出擊等其他增減。 */
    noFlow: boolean;
    /** 支出照哪一段算；lightest 時 week 是實際採用的那一週（沒有各週明細為 null，退回整段平均）。 */
    basis?: SpendBasis;
    week?: { fromTs: number; toTs: number; itemsRecorded?: boolean } | null;
    /** 現在時刻（月常剩餘時間）；省略為 Date.now()。 */
    now?: number;
    /** 顯示的是近似解，精確搜尋還在背景算（結果可能再更新）。 */
    refining?: boolean;
    /** 備蓄期限（YYYY-MM-DD）；沒設期限為 null，推算時點改為 plan.horizonDays 天後。 */
    deadline: string | null;
}

const keyName = (key: PlanKey) => t(`mat.${key}.full`);
const hourMinute = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
// 平均值不是整數：數百以上取整，離散資材（個位數）留一位小數。
const incomeText = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 });

const unknownHtml = () => `<span class="el-unknown">${esc(t('ov.expedUnknown'))}</span>`;
const percentText = (value: number, cap: number) => `${Math.round(Math.max(0, Math.min(1, value / cap)) * 100)}%`;

/** 推算存量：夾在 0～上限之間顯示比例，數量放在提示。 */
function atHtml(value: number | null, cap: number): string {
    if (value === null) return unknownHtml();
    const amount = Math.round(Math.max(0, Math.min(cap, value)));
    return `<span title="${esc(fmtNum(amount))}">${esc(percentText(value, cap))}</span>`;
}

/** 遠征列表：每趟淨收益（燃彈已扣補給）或每日淨收入；推算值與沒跑過的遠征加標記；roles 有值時標「補哪一項」。 */
function missionTableHtml(rows: PlanRow[], keys: PlanKey[], perDay: boolean, roles: readonly (PlanKey | null)[] = [], listKnown = false): string {
    const flagged = keys.some(key => key === 'drum' || key === 'torch' || key === 'devmat');
    return `<div class="el-table-wrap"><table class="el-table el-plan-table"><thead><tr>
        <th>${esc(t('ov.expedColMission'))}</th><th>${esc(t('ov.epColTime'))}</th>
        <th title="${esc(t('ov.epIncomeTip'))}">${esc(t(perDay ? 'ov.epColPerDay' : 'ov.epColIncome'))}</th><th>${esc(t('ov.epColRuns'))}</th></tr></thead><tbody>${rows.map((row, i) => {
        const name = expedDisplayName(row.missionId, row.name);
        const chips = keys.map(key => {
            const value = (perDay ? row.perDay : row.income)[key];
            const est = row.estimated.includes(key) || ((key === 'fuel' || key === 'ammo') && row.supplyEstimated);
            return `<span class="el-sum-chip${est ? ' el-plan-est' : ''}" title="${esc(est ? `${keyName(key)}（${t('ov.epEst')}）` : keyName(key))}">${matIconHtml(key, keyName(key))}${value === null
                ? `<span class="el-unknown" title="${esc(t('ov.epUnknownTip'))}">${esc(t('ov.expedUnknown'))}</span>`
                : `<b>${esc(incomeText(value))}</b>`}</span>`;
        }).join('');
        const runs = row.runs ? t('ov.epRuns', { n: row.runs }) : t('ov.epUnrun');
        const tip = row.runs && flagged ? ` class="el-plan-n" title="${esc(t('ov.epItemRunsTip', { n: row.itemRuns }))}"` : row.runs ? '' : ` class="el-none" title="${esc(t(listKnown ? 'ov.epUnrunOpenTip' : 'ov.epUnrunTip'))}"`;
        const role = roles[i];
        const roleHtml = role ? ` <span class="el-plan-role" title="${esc(t('ov.epRoleTip'))}">${matIconHtml(role, keyName(role))}${esc(t('ov.epRole', { item: keyName(role) }))}</span>` : '';
        return `<tr><td><div class="el-type"><b title="${esc(name)}">${esc(name)}</b><span>${esc(row.dispNo)}${roleHtml}</span></div></td>
            <td class="el-plan-time">${esc(hourMinute(row.time))}</td>
            <td><div class="el-sum-chips">${chips}</div></td>
            <td class="el-plan-time"><span${tip}>${esc(runs)}</span></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

/** 各勾選資材：現有、照目前步調與照建議組合在推算時點的存量比例、照建議的每日淨增減；瓶頸那一列加粗。 */
function outlookTableHtml(plan: ExpeditionPlan, when: string): string {
    return `<div class="el-table-wrap"><table class="el-table el-plan-outlook"><thead><tr>
        <th>${esc(t('ov.glColItem'))}</th><th>${esc(t('ov.epColHave'))}</th>
        <th title="${esc(t('ov.epNowAtTip', { when }))}">${esc(t('ov.epColNowAt'))}</th>
        <th title="${esc(t('ov.epPlanAtTip', { when }))}">${esc(t('ov.epColPlanAt'))}</th>
        <th>${esc(t('ov.epColPlanRate'))}</th></tr></thead><tbody>${plan.outlook.map(line => {
        const isNeck = line.key === plan.bottleneck;
        const name = `${matIconHtml(line.key, keyName(line.key))} ${esc(keyName(line.key))}${isNeck
            ? ` <span class="el-plan-neck" title="${esc(t('ov.epNeckTip'))}">${esc(t('ov.epNeck'))}</span>` : ''}`;
        const rate = Math.round(line.planRate);
        return `<tr${isNeck ? ' class="el-plan-neck-row"' : ''}><td>${name}</td>
            <td class="el-plan-time">${atHtml(line.have, line.cap)}</td>
            <td class="el-plan-time">${atHtml(line.nowAt, line.cap)}</td><td class="el-plan-time">${atHtml(line.planAt, line.cap)}</td>
            <td class="el-plan-time">${line.have === null ? unknownHtml() : esc(`${rate > 0 ? '+' : ''}${incomeText(line.planRate)}`)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

/** 數量：基本資源（上限十萬級）用「21.1 萬」這種簡寫，離散資材照原數。 */
function amountText(value: number, cap: number): string {
    if (cap < 100000) return fmtNum(Math.round(value));
    return new Intl.NumberFormat(getLang(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/**
 * 結果頂端的一句結論：最需要補的資材（focus）現有多少、這組遠征到推算時點帶進多少、合計多少。
 * 只用遠征本身的淨收入，玩家才能直接對上「跑這三條能存幾萬」；出擊等消耗只用來判斷哪項最需要補，另附一行說明。
 * 合計會超過上限時改說幾天存滿。
 */
function verdictHtml(plan: ExpeditionPlan, view: PlanView): string {
    const line = plan.outlook.find(item => item.key === plan.focus);
    if (!line || line.have === null) return '';
    const item = keyName(line.key);
    const gain = line.expRate * plan.horizonDays;
    const amount = (value: number) => amountText(value, line.cap);
    const text = line.have + gain < line.cap
        ? t('ov.epVerdict', {
            item, have: amount(line.have), gain: amount(gain), total: amount(line.have + gain), cap: amount(line.cap),
            span: view.deadline ? t('ov.epSpanDeadline', { date: view.deadline }) : t('ov.epSpanDays', { n: Math.round(plan.horizonDays) }),
        })
        : t('ov.epVerdictFull', { item, have: amount(line.have), cap: amount(line.cap), n: Math.ceil((line.cap - line.have) / line.expRate) });
    // 沒設期限、而組合能讓勾選資材全部存滿時，先講全部存滿的天數（這時的推算時點就是那一天）。
    const days = plan.outlook.map(item => item.planDays);
    const allFull = !view.deadline && days.every(day => day !== null && Number.isFinite(day))
        ? `<p class="el-plan-verdict">${esc(t('ov.epAllFull', { n: Math.ceil(Math.max(...(days as number[]))) }))}</p>` : '';
    return `${allFull}<p class="el-plan-verdict">${matIconHtml(line.key, item)} ${esc(text)}</p><p class="ov-note dim el-plan-note">${esc(t('ov.epVerdictNote'))}</p>`;
}

/** 建議區外殼（控制項與說明）；body 是結果區的初始內容，離線預覽與正式分區共用。 */
export function planShellHtml(prefs: PlanPrefs, body: string): string {
    return `<section class="el-plan">
        <h3 class="el-h">${esc(t('ov.epTitle'))}<span class="gl-est" title="${esc(t('ov.epBasis'))}">${esc(t('ov.epEst'))}</span></h3>
        <div class="ov-toolbar el-plan-bar">
            <label class="rs-inline"><span title="${esc(t('ov.epAwayTip'))}">${esc(t('ov.epAway'))}</span>
                <input type="number" class="rs-search el-plan-hours" min="0.5" max="168" step="0.5" value="${prefs.hours}" aria-label="${esc(t('ov.epAway'))}">
                <span>${esc(t('ov.epHoursUnit'))}</span></label>
            <label class="rs-inline"><span title="${esc(t('ov.epSleepTip'))}">${esc(t('ov.epSleep'))}</span>
                <input type="number" class="rs-search el-plan-hours el-plan-sleep" min="0" max="${PLAN_MAX_SLEEP}" step="0.5" value="${prefs.sleep}" aria-label="${esc(t('ov.epSleep'))}">
                <span>${esc(t('ov.epHoursUnit'))}</span></label>
            <label class="rs-inline"><span title="${esc(t('ov.epSpendTip'))}">${esc(t('ov.epSpend'))}</span>
                <select class="rs-search el-plan-basis" aria-label="${esc(t('ov.epSpend'))}">${SPEND_BASES.map(basis =>
        `<option value="${basis}"${prefs.basis === basis ? ' selected' : ''}>${esc(t(`ov.epSpend.${basis}`))}</option>`).join('')}</select></label>
            <div class="el-plan-pick"><span class="el-label">${esc(t('ov.epPick'))}</span>${PLAN_KEYS.map(key =>
        `<label class="eo-chip"><input type="checkbox" class="el-plan-key" value="${key}" ${prefs.chosen.includes(key) ? 'checked' : ''}>${esc(keyName(key))}</label>`).join('')}</div>
        </div>
        <p class="ov-note dim">${esc(t('ov.epBasis'))}</p>
        <div class="el-plan-body">${body}</div>
    </section>`;
}

/** 建議區的結果（組合、各資材到上限天數、月常）；控制項不在這裡，重繪不會打斷輸入。 */
export function planResultHtml(view: PlanView): string {
    const { plan } = view;
    let main: string;
    if (!view.hasMaster) main = `<div class="ov-empty">${esc(t('ov.epNoMaster'))}</div>`;
    else if (!view.chosen.length) main = `<div class="ov-empty">${esc(t('ov.epNoKeys'))}</div>`;
    // 能派的都沒有收益、其餘未開放時，空狀態改說未開放的條數（「主檔裡沒有」不對）。
    else if (!plan.candidateCount) main = `<div class="ov-empty">${esc(t(plan.lockedCount ? 'ov.epLocked' : 'ov.epNoRecords', { n: plan.lockedCount }))}</div>`;
    else {
        const when = view.deadline ? t('ov.epWhenDeadline', { date: view.deadline }) : t('ov.epWhenDays', { n: Math.round(plan.horizonDays) });
        const week = view.basis === 'lightest' && !view.noFlow ? view.week ?? null : null;
        const notes = [
            view.noFlow ? t('ov.epNoFlow') : '',
            week ? t('ov.epSpendWeek', { from: formatDate(week.fromTs), to: formatDate(week.toTs) }) : '',
            week && week.itemsRecorded === false && view.chosen.some(key => key === 'drum' || key === 'torch' || key === 'devmat') ? t('ov.epSpendWeekItems') : '',
            view.basis === 'lightest' && !view.noFlow && !week ? t('ov.epSpendNoWeek') : '',
            t('ov.epProfile', { gs: Math.round(plan.profile.great * 100), bonus: plan.profile.bonus.toFixed(2), n: MIN_RUNS }),
        ].filter(Boolean).map(note => `<p class="ov-note dim el-plan-note">${esc(note)}</p>`).join('')
            + (plan.lockedCount ? `<p class="ov-note dim el-plan-note">${esc(t('ov.epLocked', { n: plan.lockedCount }))} <a href="#/exped-log?sub=unlock">${esc(t('ov.euSeeUnlock'))}</a></p>` : '');
        const night = plan.sleep.length
            ? `<h4 class="el-h">${esc(t('ov.epOnline'))}</h4>${missionTableHtml(plan.top, view.chosen, false, plan.roles.top, plan.listKnown)}
                <h4 class="el-h" title="${esc(t('ov.epNightTip'))}">${esc(t('ov.epNight', { h: plan.sleepMinutes / 60 }))}</h4>${missionTableHtml(plan.sleep, view.chosen, false, plan.roles.sleep, plan.listKnown)}`
            : missionTableHtml(plan.top, view.chosen, false, plan.roles.top, plan.listKnown);
        // 推算表與全部候選是細節，預設收合；展開狀態由分區在重繪時保留（data-part）。
        const refining = view.refining
            ? `<p class="el-plan-refining" role="status"><span class="el-plan-spin" aria-hidden="true"></span>${esc(t('ov.epRefining'))}</p>` : '';
        main = `${refining}${verdictHtml(plan, view)}${night}${notes}
            <details class="el-plan-all" data-part="outlook"><summary class="el-h">${esc(t('ov.epOutlook', { when }))}</summary>${outlookTableHtml(plan, when)}</details>
            <details class="el-plan-all" data-part="all"><summary class="el-h">${esc(t('ov.epAll', { n: plan.candidates.length }))}</summary>
            ${plan.focus ? `<p class="ov-note dim">${esc(t('ov.epAllNote', { item: keyName(plan.focus) }))}</p>` : ''}${missionTableHtml(plan.candidates, view.chosen, true, [], plan.listKnown)}</details>`;
    }
    // 本期截止：顯示本機時間，剩餘不到一天改用小時。
    const left = plan.monthlyCycle.end - (view.now ?? Date.now());
    const leftText = left >= DAY_MS ? t('ov.epLeftDays', { n: Math.floor(left / DAY_MS) }) : t('ov.epLeftHours', { n: Math.max(0, Math.ceil(left / 3600000)) });
    const monthly = plan.monthly.length ? `<h4 class="el-h">${esc(t('ov.epMonthly'))}</h4>
        <p class="ov-note dim">${esc(t('ov.epMonthlyNote'))}</p>
        <p class="ov-note el-plan-note">${esc(t('ov.epMonthlyDue', { date: formatDateTime(plan.monthlyCycle.end, false), left: leftText }))}</p>
        <div class="el-table-wrap"><table class="el-table el-plan-table"><thead><tr><th>${esc(t('ov.expedColMission'))}</th><th>${esc(t('ov.epCycle'))}</th><th>${esc(t('ov.epLastSuccess'))}</th></tr></thead><tbody>${plan.monthly.map(row => {
        const name = expedDisplayName(row.missionId, row.name);
        return `<tr><td><div class="el-type"><b title="${esc(name)}">${esc(name)}</b><span>${esc(row.dispNo)}</span></div></td>
            <td class="el-plan-time">${row.open === false ? `<span class="el-none" title="${esc(t('ov.epCycleLockedTip'))}">${esc(t('ov.epCycleLocked'))}</span>`
        : `<b>${esc(t('ov.epCycleOpen'))}</b>`}</td>
            <td class="el-plan-time">${row.lastSuccessTs === null ? `<span class="el-none">${esc(t('ov.epNever'))}</span>` : esc(formatDate(row.lastSuccessTs))}</td></tr>`;
    }).join('')}</tbody></table></div>` : '';
    return `${main}${monthly}`;
}

/** 活動期間捷徑的選項文字（`db.resourceMarks` 推出來的區段，見 utils/resource-log.ts）。 */
function periodLabel(period: EventPeriod, ctx: SectionContext): string {
    const name = ctx.state.mapAreaName(period.area) || `#${period.area}`;
    return `${name}（${dateInputValue(period.startTs)} – ${dateInputValue(period.endTs)}）`;
}

export const EXPED_SUBS = [
    { key: 'log', labelKey: 'ov.exSubLog' },
    { key: 'plan', labelKey: 'ov.exSubPlan' },
    { key: 'unlock', labelKey: 'ov.exSubUnlock' },
] as const;
export type ExpedSub = typeof EXPED_SUBS[number]['key'];

/** 網址的 sub 參數；沒有或不認得時看紀錄。 */
export function resolveExpedSub(param: string | null): ExpedSub {
    return EXPED_SUBS.some(sub => sub.key === param) ? param as ExpedSub : 'log';
}

export const expedLogSection: OverviewSection = {
    id: 'exped-log',
    titleKey: 'ov.exped',
    async render(el, ctx) {
        // 先畫殼，再讀 IndexedDB；讀取被其他頁面的 schema 升級阻塞時也不能留下空白分區。
        const prefs = loadPrefs();
        const planPrefs = loadPlanPrefs();
        let active = resolveExpedSub(hashParams().get('sub'));
        let page = 1;
        el.innerHTML = `<div class="el"><nav class="fa-nav" role="tablist" aria-label="${esc(t('ov.exped'))}">${EXPED_SUBS.map(sub =>
            `<button type="button" role="tab" class="fa-tab" id="el-tab-${sub.key}" data-sub="${sub.key}" aria-selected="${sub.key === active}" aria-controls="el-page-${sub.key}">${esc(t(sub.labelKey))}</button>`).join('')}</nav>
            <div class="fa-page" id="el-page-plan" role="tabpanel" aria-labelledby="el-tab-plan" hidden>${planShellHtml(planPrefs, `<div class="ov-empty">${esc(t('ov.loading'))}</div>`)}</div>
            <div class="fa-page eu" id="el-page-unlock" role="tabpanel" aria-labelledby="el-tab-unlock" hidden></div>
            <div class="fa-page" id="el-page-log" role="tabpanel" aria-labelledby="el-tab-log" hidden>
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
            </div>
        </div>`;

        // ── 子分頁 ────────────────────────────────────────────────────
        const unlockPage = el.querySelector<HTMLElement>('#el-page-unlock')!;
        let unlockDrawn = false;
        // 開放頁只有一般遠征的 <details>，重繪時保留玩家的展開選擇。
        const drawUnlock = () => {
            const box = unlockPage.querySelector<HTMLDetailsElement>('.eu-general');
            unlockPage.innerHTML = unlockPageHtml(ctx.state, Date.now(), unlockDrawn ? box?.open : undefined);
            unlockDrawn = true;
        };
        const show = (key: ExpedSub) => {
            active = key;
            for (const button of el.querySelectorAll<HTMLButtonElement>('.el > .fa-nav .fa-tab')) button.setAttribute('aria-selected', String(button.dataset.sub === key));
            for (const sub of EXPED_SUBS) el.querySelector<HTMLElement>(`#el-page-${sub.key}`)!.hidden = sub.key !== key;
            if (key === 'unlock' && !unlockDrawn) drawUnlock();
        };
        el.querySelector('.el > .fa-nav')!.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.fa-tab');
            if (!button || button.dataset.sub === active) return;
            show(button.dataset.sub as ExpedSub);
            // 網址跟著子頁走，切語言重繪才不會被舊的 sub 參數拉回去；replaceState 不觸發 hashchange。
            history.replaceState(null, '', `${location.pathname}${location.search}#/exped-log?sub=${active}`);
        });
        show(active);
        // 進遠征畫面（新的遠征清單）時更新開放頁；還沒打開過就等第一次切過去再畫。
        ctx.onStateChange?.(() => { if (el.isConnected && unlockDrawn) drawUnlock(); });

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

        // ── 遠征組合建議（控制項只建一次，只重繪 .el-plan-body）──────────────
        const planBody = el.querySelector<HTMLElement>('.el-plan-body')!;
        const planPick = el.querySelector<HTMLElement>('.el-plan-pick')!;
        const hoursInput = el.querySelector<HTMLInputElement>('.el-plan-hours:not(.el-plan-sleep)')!;
        const sleepInput = el.querySelector<HTMLInputElement>('.el-plan-sleep')!;
        let planData: { goals: RemodelGoal[]; stockpile: StockpileGoal | null; flow: ObservedFlow | null } | null = null;
        let planRun = 0;   // 每次重算加一；背景還在算的舊結果不再畫上去

        function drawPlan() {
            if (!planData) return;
            planRun++;
            try {
                const { goals, stockpile, flow } = planData;
                // 改造目標的需求視為已花掉（同備蓄）；有沒有設備蓄都一樣扣。
                const lines = stockpileLinesOf(ctx.state, goals, stockpile ?? { until: null }, { flow, now: Date.now() });
                const free = Object.fromEntries(lines.map(line => [line.key, line.have === null ? null : line.have - line.reserved]));
                const caps = Object.fromEntries(lines.map(line => [line.key, line.cap])) as Record<PlanKey, number>;
                const missions = [...ctx.state.masterMissions].map(([id, m]) =>
                    ({ id, dispNo: m.dispNo, name: m.name, time: m.time, resetType: m.resetType, winItems: m.winItems, use: m.use }));
                // 遠征紀錄的編成存的是當時語言的顯示名稱：原名與目前語言的譯名都收。
                const shipMax = new Map<string, [number, number]>();
                for (const [id, m] of ctx.state.master) {
                    shipMax.set(m.name, [m.fuelMax, m.bullMax]);
                    shipMax.set(ctx.state.shipName(id), [m.fuelMax, m.bullMax]);
                }
                const needs = resourceNeeds(planPrefs.chosen, free, caps, flow, all, missions, shipMax, planPrefs.basis);
                const week = planPrefs.basis === 'lightest' ? lightestWeek(flow, all, missions, shipMax) : null;
                const deadline = stockpile?.until ?? null;
                const now = Date.now();
                const end = deadline ? dateEnd(deadline) : null;
                const horizonDays = end !== null ? Math.max(0, (end - now) / DAY_MS) : PLAN_DEFAULT_HORIZON_DAYS;
                const steps = planExpeditionSteps({ missions, records: all, intervalMinutes: planPrefs.hours * 60, sleepMinutes: planPrefs.sleep * 60, needs, horizonDays, untilFull: !deadline, shipMax, missionList: ctx.state.missionList });
                const render = (plan: ExpeditionPlan, refining: boolean) => {
                    // 重繪不收合玩家展開的細節（design-guidelines §4.2）。
                    const opened = new Set([...planBody.querySelectorAll<HTMLDetailsElement>('details[data-part]')].filter(d => d.open).map(d => d.dataset.part));
                    planBody.innerHTML = planResultHtml({
                        plan, chosen: needs.map(need => need.key), hasMaster: missions.length > 0,
                        noFlow: needs.every(need => need.base === null), deadline, basis: planPrefs.basis, week, refining,
                    });
                    for (const box of planBody.querySelectorAll<HTMLDetailsElement>('details[data-part]')) box.open = opened.has(box.dataset.part);
                };
                // 先拿近似解；精確搜尋在短時間內算得完就直接顯示精確解，否則先顯示近似解，其餘分段在背景算完再換上。
                // 每段不超過數十毫秒，輸入與捲動不會卡；條件改變（重算）時放棄舊的計算。
                const first = steps.next();
                if (first.done) { render(first.value, false); return; }
                const run = planRun;
                const pump = (budget: number): boolean => {
                    const until = performance.now() + budget;
                    for (;;) {
                        const step = steps.next();
                        if (step.done) { render(step.value, false); return true; }
                        if (performance.now() >= until) return false;
                    }
                };
                if (pump(PLAN_SYNC_MS)) return;
                render(first.value!, true);
                const resume = () => {
                    if (run !== planRun) return;
                    try {
                        if (!pump(PLAN_SLICE_MS)) setTimeout(resume, 0);
                    } catch (error) {
                        planBody.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`;
                    }
                };
                setTimeout(resume, 0);
            } catch (error) {
                planBody.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`;
            }
        }
        // 有睡前組合時近似解要零點幾秒；數字輸入停下來才算，打字不卡。
        // 一輸入就放棄背景還在算的舊結果，等待期間不會再畫上舊條件的組合。
        let planTimer: ReturnType<typeof setTimeout> | undefined;
        const drawPlanSoon = () => { planRun++; clearTimeout(planTimer); planTimer = setTimeout(drawPlan, 300); };
        hoursInput.addEventListener('input', () => {
            const hours = Number(hoursInput.value);
            if (!(hours > 0 && hours <= 168)) return;   // 輸入到一半（空白、0）不重算也不存
            planPrefs.hours = hours;
            saveJsonPrefs(PLAN_PREFS_KEY, planPrefs);
            drawPlanSoon();
        });
        sleepInput.addEventListener('input', () => {
            const sleep = Number(sleepInput.value);
            if (sleepInput.value === '' || !(sleep >= 0 && sleep <= PLAN_MAX_SLEEP)) return;   // 輸入到一半不重算也不存
            planPrefs.sleep = sleep;
            saveJsonPrefs(PLAN_PREFS_KEY, planPrefs);
            drawPlanSoon();
        });
        el.querySelector<HTMLSelectElement>('.el-plan-basis')!.addEventListener('change', event => {
            planPrefs.basis = (event.target as HTMLSelectElement).value as SpendBasis;
            saveJsonPrefs(PLAN_PREFS_KEY, planPrefs);
            drawPlan();
        });
        planPick.addEventListener('change', () => {
            planPrefs.chosen = PLAN_KEYS.filter(key =>
                el.querySelector<HTMLInputElement>(`.el-plan-key[value="${key}"]`)?.checked);
            saveJsonPrefs(PLAN_PREFS_KEY, planPrefs);
            drawPlan();
        });

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
            return { from: anchor - days * DAY_MS, to: null };
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
            // （監聽器隨節點一起消失）。
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
            // 活動期間捷徑靠 db.resourceMarks（舊安裝可能整張表是空的）；
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
        // 建議區的資料獨立載入，失敗只影響它自己；流量讀不到只讓推算少一個依據（備蓄的到上限天數不可考）。
        try {
            const [goalRows, flow] = await Promise.all([db.goals.toArray(), loadGoalFlow(ctx.state).catch(() => null)]);
            planData = { goals: goalsFromRows(goalRows), stockpile: stockpileFromRows(goalRows), flow };
            drawPlan();
        } catch (error) {
            planBody.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`;
        }
    },
};
