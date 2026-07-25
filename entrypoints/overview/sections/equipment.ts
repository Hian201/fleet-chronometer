// 裝備全覽：全持有裝備的**圖示導覽＋詳細清單**（唯讀 view 來自 GameState.ownedGears()）。
//
// ── 版面取捨 ──────────────────────────────────────────────────────────
// 裝備和艦娘不一樣：玩家心裡的第一層分類是「圖示長什麼樣」（主砲／魚雷／電探／艦戰…），
// 那是遊戲裡挑裝備時唯一的視覺線索，也是本專案已經有的 74 顆原創圖示資產。故本分區的
// 主導覽**就是那排圖示**（`.eq-rail`）：一顆圖示一個可切換的篩選鈕、右上角疊持有件數，
// 不再另做一個看不出東西長怎樣的類別下拉。**只列實際持有的圖示**——把 60 顆全排出來會
// 讓「我有什麼」這個第一眼問題淹沒在一整面沒有的東西裡。
//
// 兩種瀏覽模式共用同一組篩選、排序與欄位開關（切換模式不會重置，那會讓人以為東西不見了）：
//   · 詳細清單（**預設**）：十四欄表格（數量／改修星數＋十一項素質），表頭可排序。
//     這個分區真正要回答的是「我有幾個、改修到哪、哪個素質最高」——那是逐欄比較的問題，
//     表格一次看得到十幾種裝備，故它才是預設。
//   · 圖磚：一種裝備一張卡，responsive grid。適合瀏覽而非比較——「我有什麼、有幾個、
//     改修到哪」。卡上唯一的圖形化編碼是**裝備中／閒置比例條**（「有幾顆閒著可以拿去改修／
//     配基地」是最常被問的問題，長度比例一眼可比）。
// 兩種模式的列都可展開成**逐顆實例**（★／熟練度／裝在誰身上）——彙總答不了「是哪一顆閒著」。
//
// **「裝備中艦娘」是可開的欄位，但預設關閉**：一種裝備常裝在十幾艘船上，一格只塞得下截斷
// 後的名字，既答不完整又把本來就要橫捲的表撐更寬，平常看展開列即可。但 CSV 沒有「展開」
// 這個動作，要在試算表裡回答「這顆裝在誰身上」就把該欄打開——**匯出跟著顯示欄位走**
// （同 ships.ts：畫面顯示什麼，CSV 就匯出什麼）。
//
// ── 為什麼這支不遵守「全量重繪」慣例（design-guidelines §4.2）──────────
// 同 ships.ts／ship-picker.ts：工具列有關鍵字輸入框，整塊重繪會讓它每打一個字就失焦。
// 故「圖示架＋工具列」只建一次並綁定，之後只重繪 `.eq-body`（chip 列／摘要／內容／備註）。
//
// 彙總／篩選／排序的**邏輯**全在 utils/gear-inventory.ts（純函式、可用 node 餵真實資料
// 驗證），本檔只負責 DOM 與事件——同 ships.ts 與 event-ops.ts 的分工。
import type { GearStats } from '../../../utils/state';
import type { OverviewSection } from './types';
import { t } from '../../../utils/ui-i18n';
import {
    emptyGearFilter, filterGears, groupGears, iconOptions, sortGears, stackInstances, totalCount,
    MAX_IMPROVE,
    type ConsumableFilter, type GearFilter, type GearGroup, type GearSortKey, type ImproveFilter,
    type SortDir, type UsageFilter,
} from '../../../utils/gear-inventory';
import { copyWithFeedback, downloadText, esc, gearIconHtml, loadJsonPrefs, saveJsonPrefs } from '../lib';

// ── 共用小片段 ──────────────────────────────────────────────────────────

const LENG_KEYS = ['', 'ov.rsLengShort', 'ov.rsLengMedium', 'ov.rsLengLong', 'ov.rsLengVeryLong'];

/** 射程：0＝無（用弱化的「·」表示，與素質 0 一致），1–4 為短/中/長/超長。 */
const lengLabel = (leng: number) => (LENG_KEYS[leng] ? t(LENG_KEYS[leng]) : '');

/** 素質 0 一律畫成弱化的點：讓非零值在十一個數值欄裡跳出來，掃描時不必逐格讀數字。 */
const statCell = (v: number) => (v === 0 ? '<span class="eq-zero">·</span>' : String(v));

/**
 * 改修分佈（★10×1 ★6×2 …）。星數高者在前、最多顯示三段，其餘收進「+n」，
 * 完整內容放 title——同一種裝備湊到十幾種星數是常態，全攤開會把欄位撐爆。
 */
function starChips(group: GearGroup, limit = 3): string {
    if (group.maxLevel === 0) return `<span class="eq-zero">${esc(t('ov.eqNoImprove'))}</span>`;
    const parts = group.levels.map(l => `★${l.level}×${l.count}`);
    const shown = group.levels.slice(0, limit).map(l =>
        `<span class="eq-star${l.level >= MAX_IMPROVE ? ' max' : l.level > 0 ? '' : ' zero'}">★${l.level}<i>×${l.count}</i></span>`);
    const rest = group.levels.length - limit;
    if (rest > 0) shown.push(`<span class="eq-more">+${rest}</span>`);
    return `<span class="eq-stars" title="${esc(parts.join('  '))}">${shown.join('')}</span>`;
}

const starText = (group: GearGroup) =>
    (group.maxLevel === 0 ? '' : group.levels.map(l => `★${l.level}×${l.count}`).join(' '));

/** 裝備中艦娘（匯出用純文字）。同一艘裝兩顆顯示「×2」。畫面上這是展開列，不是欄位。 */
const holderText = (group: GearGroup) =>
    group.holders.map(h => `${h.name}${h.count > 1 ? `×${h.count}` : ''}`).join(' / ');

/**
 * 展開後的實例明細。彙總答不了「是哪一顆閒著」，這裡才是。
 *
 * **同規格的實例疊成一行 ×N**（`stackInstances()`：改修★＋熟練度＋持有者全同才算同一疊）。
 * 逐顆列會讓常見裝備變成一整片一模一樣的方塊——二三十顆「★0 閒置」佔滿畫面，卻只表達了
 * 一件事。疊起來之後，這裡的讀法就跟「改修星數」欄同一個語感（★0 ×18・★6 明石 ×2）。
 */
function instancesHtml(group: GearGroup): string {
    const rows = stackInstances(group.instances).map(stack => {
        const star = stack.level > 0
            ? `<span class="eq-i-star">★${stack.level}</span>`
            : '<span class="eq-zero">★0</span>';
        const alv = stack.alv > 0 ? `<span class="eq-i-alv">»${stack.alv}</span>` : '';
        const where = stack.holder
            ? `<span class="eq-i-where${stack.holder.kind === 'lbas' ? ' lbas' : ''}">${esc(stack.holder.name)}`
              + `${stack.holder.sub ? `<i>${esc(stack.holder.sub)}</i>` : ''}`
              + `${stack.holder.ex ? `<b>${esc(t('ov.shipsEx'))}</b>` : ''}</span>`
            : `<span class="eq-i-idle">${esc(t('ov.eqIdle'))}</span>`;
        // ×1 不畫：每行都掛一個「×1」只是雜訊，有數字才代表「這裡不只一顆」。
        const n = stack.count > 1 ? `<b class="eq-i-n">×${stack.count}</b>` : '';
        return `<li>${star}${alv}${where}${n}</li>`;
    });
    return `<ul class="eq-inst">${rows.join('')}</ul>`;
}

// ── 詳細清單的欄位定義 ──────────────────────────────────────────────────
// 欄序即使用者指定的順序：數量、改修星數，其後十一項素質（裝備中艦娘見檔頭說明）。

interface EqColumn {
    id: string;
    labelKey: string;
    /** 可排序時對應 gear-inventory 的排序鍵；不給即不可排序。 */
    sort?: GearSortKey;
    /** 數值欄：靠右、等寬數字，且第一次點表頭時預設由大到小。 */
    numeric?: boolean;
    /** 預設是否顯示。 */
    on: boolean;
    /** 不可關閉（裝備名同時是識別與展開鈕，關掉整張表就沒有主詞了）。 */
    always?: boolean;
    /** open＝該列目前是否展開（只有裝備名格在意，用來反映 aria-expanded 與展開箭頭）。 */
    cell(group: GearGroup, open: boolean): string;
    text(group: GearGroup): string;
}

/** 素質欄一律同一個形狀，只差取哪個欄位。 */
const statCol = (id: keyof GearStats, labelKey: string): EqColumn => ({
    id, labelKey, sort: id, numeric: true, on: true,
    cell: (g: GearGroup) => statCell(g.stats[id]),
    text: (g: GearGroup) => String(g.stats[id]),
});

export const COLUMNS: EqColumn[] = [
    {
        id: 'name', labelKey: 'ov.eqColName', sort: 'name', on: true, always: true,
        cell: (g, open) => nameCell(g, open),
        text: g => g.name,
    },
    { id: 'count', labelKey: 'ov.eqColCount', sort: 'count', numeric: true, on: true, cell: g => `<b>${g.count}</b>`, text: g => String(g.count) },
    { id: 'star', labelKey: 'ov.eqColStar', sort: 'star', on: true, cell: g => starChips(g), text: g => starText(g) },
    {
        // 裝備中艦娘：**預設關閉**，但保留成可開的欄位。
        // 平常用展開列看（一種裝備常裝在十幾艘船上，一格只塞得下截斷後的三個名字），
        // 但 CSV 沒有「展開」這個動作——要在試算表裡回答「這顆裝在誰身上」，就把這欄打開，
        // 匯出跟著顯示欄位走（同 ships.ts：畫面顯示什麼，CSV 就匯出什麼）。
        id: 'holder', labelKey: 'ov.eqColHolder', sort: 'equipped', on: false,
        cell: g => (g.holders.length ? esc(holderText(g)) : `<span class="eq-zero">${esc(t('ov.eqIdle'))}</span>`),
        text: g => holderText(g),
    },
    statCol('houg', 'ov.rsColFire'),
    statCol('houm', 'ov.eqColHoum'),
    {
        // 射程是分級（短/中/長/超長）不是數量，故不靠右對齊也不當數值欄，但排序仍走數值。
        id: 'leng', labelKey: 'ov.rsLeng', sort: 'leng', on: true,
        cell: g => (g.stats.leng ? esc(lengLabel(g.stats.leng)) : '<span class="eq-zero">·</span>'),
        text: g => lengLabel(g.stats.leng),
    },
    statCol('luck', 'ov.rsColLuck'),
    statCol('houk', 'ov.rsColEvasion'),
    statCol('baku', 'ov.eqColBaku'),
    statCol('raig', 'ov.rsColTorp'),
    statCol('saku', 'ov.rsColLos'),
    statCol('tais', 'ov.rsColAsw'),
    statCol('tyku', 'ov.rsColAa'),
    statCol('souk', 'ov.rsColArmor'),
];

/** 裝備名格：展開鈕＋圖示＋名稱＋類別。表格與圖磚共用同一組識別元素。 */
function nameCell(group: GearGroup, open: boolean): string {
    return `<button type="button" class="eq-name" data-mst="${group.mst}" aria-expanded="${open}">`
        // 展開狀態用**字元**表示而非旋轉動畫：開了 prefers-reduced-motion 的使用者
        // 不該因此失去「這列展開了沒」的訊號（design-guidelines §3.2）。
        + `<span class="eq-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>`
        + `<span class="eq-ico">${gearIconHtml(group.icon)}</span>`
        + `<span class="eq-title"><span class="eq-label">${esc(group.name)}</span>`
        + `<span class="eq-cat">${esc(group.catName)}${group.consumable ? `<i>${esc(t('ov.eqConsumableTag'))}</i>` : ''}</span></span>`
        + `</button>`;
}

// ── 兩種模式的渲染 ──────────────────────────────────────────────────────

export interface View {
    sort: GearSortKey;
    dir: SortDir;
    expanded: Set<number>;
    /** 目前顯示的欄位 id；表格欄位、圖磚素質 chip 與 CSV 匯出三者共用同一份。 */
    cols: Set<string>;
}

/** 依 COLUMNS 的宣告順序取目前顯示的欄位——不可用使用者勾選的先後，否則欄位會亂跳。 */
export const visibleColumns = (view: View) =>
    COLUMNS.filter(c => c.always || view.cols.has(c.id));

export function tableHtml(groups: GearGroup[], view: View): string {
    const cols = visibleColumns(view);
    const head = cols.map(c => {
        const active = c.sort != null && c.sort === view.sort;
        const arrow = active ? (view.dir === 'asc' ? '▲' : '▼') : '';
        const attrs = c.sort ? ` data-sort="${c.sort}" tabindex="0" role="button"` : '';
        return `<th class="eq-th${c.numeric ? ' num' : ''}${c.sort ? ' sortable' : ''}${active ? ' active' : ''} eq-c-${c.id}"${attrs}>`
            + `${esc(t(c.labelKey))}<span class="eq-arrow">${arrow}</span></th>`;
    }).join('');

    const body = groups.map(g => {
        const open = view.expanded.has(g.mst);
        const cells = cols.map(c => `<td class="${c.numeric ? 'num ' : ''}eq-c-${c.id}">${c.cell(g, open)}</td>`).join('');
        const row = `<tr class="${open ? 'open' : ''}" data-mst="${g.mst}">${cells}</tr>`;
        if (!open) return row;
        return row + `<tr class="eq-subrow"><td colspan="${cols.length}">${instancesHtml(g)}</td></tr>`;
    }).join('');

    // 表格自己的橫向捲動容器：十四個欄位一定會超出寬度，頁面本身永不橫捲。
    return `<div class="eq-table-wrap"><table class="eq-table">`
        + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** 圖磚：一種裝備一張卡。素質只列非零項——裝備的素質欄大多是 0，全列會蓋掉真正的重點。 */
export function cardsHtml(groups: GearGroup[], view: View): string {
    const cards = groups.map(g => {
        const stats = visibleColumns(view)
            .filter(c => c.sort != null && c.sort in g.stats && g.stats[c.sort as keyof GearStats] !== 0)
            .map(c => {
                const key = c.sort as keyof GearStats;
                const value = key === 'leng' ? lengLabel(g.stats.leng) : String(g.stats[key]);
                return `<span class="eq-stat"><i>${esc(t(c.labelKey))}</i>${esc(value)}</span>`;
            }).join('');

        // 裝備中／閒置比例條：本卡唯一的圖形化編碼。「還有幾顆閒著」是這張表最常被問的事，
        // 用長度比例一眼可比，比兩個數字快。全部裝備中時整條實心，全閒置時整條空心。
        const pct = g.count > 0 ? Math.round(g.equipped / g.count * 100) : 0;
        const label = t('ov.eqUsageBar', { equipped: g.equipped, idle: g.idle });
        const usage = `<span class="eq-meter" role="img" aria-label="${esc(label)}" title="${esc(label)}">`
            + `<span class="eq-meter-fill" style="width:${pct}%"></span></span>`;

        return `<article class="eq-card${view.expanded.has(g.mst) ? ' open' : ''}" data-mst="${g.mst}">
            <div class="eq-card-head">${nameCell(g, view.expanded.has(g.mst))}<span class="eq-count">×${g.count}</span></div>
            <div class="eq-card-row">${starChips(g, 4)}</div>
            <div class="eq-card-row eq-usage">${usage}
                <span class="eq-usage-text">${esc(t('ov.eqEquippedN', { n: g.equipped }))}
                    <i>${esc(t('ov.eqIdleN', { n: g.idle }))}</i></span></div>
            ${stats ? `<div class="eq-card-row eq-stats">${stats}</div>` : ''}
            ${view.expanded.has(g.mst) ? instancesHtml(g) : ''}
        </article>`;
    }).join('');

    return `<div class="eq-grid">${cards}</div>`;
}

/**
 * 匯出目前**篩選後的全部**種類（不是只有展開的）＋**目前顯示的欄位**。
 * 「畫面顯示什麼就匯出什麼」與 ships.ts 同一條規則——欄位開關若不影響匯出，
 * 使用者關掉一堆欄位後匯出仍是滿滿一片，會覺得開關沒作用。
 */
export function gearCsv(groups: GearGroup[], view: View): string {
    const cols = visibleColumns(view);
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [cols.map(c => cell(t(c.labelKey))).join(',')];
    for (const g of groups) lines.push(cols.map(c => cell(c.text(g))).join(','));
    return lines.join('\n');
}

// ── 篩選控制項 ──────────────────────────────────────────────────────────

interface SegOption { value: string; labelKey: string }
interface SegRow { key: 'usage' | 'improve' | 'consumable'; labelKey: string; options: SegOption[] }

const SEG_ROWS: SegRow[] = [
    {
        key: 'usage', labelKey: 'ov.eqUsage', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'equipped', labelKey: 'ov.eqUsageEquipped' },
            { value: 'idle', labelKey: 'ov.eqUsageIdle' },
        ],
    },
    {
        key: 'improve', labelKey: 'ov.eqImprove', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'plus', labelKey: 'ov.eqImprovePlus' },
            { value: 'max', labelKey: 'ov.eqImproveMax' },
            { value: 'none', labelKey: 'ov.eqImproveNone' },
        ],
    },
    {
        key: 'consumable', labelKey: 'ov.eqConsumable', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'hide', labelKey: 'ov.eqConsumableHide' },
            { value: 'only', labelKey: 'ov.eqConsumableOnly' },
        ],
    },
];

/** 生效中的條件（供 chip 列）。只列非預設值，每個可單獨清除。同 ships.ts 的作法。 */
export function describeGearFilter(
    filter: GearFilter, iconLabel: (icon: number) => string,
): { key: string; label: string }[] {
    const out: { key: string; label: string }[] = [];
    if (filter.search.trim()) out.push({ key: 'search', label: `${t('ov.rsSearchLabel')}: ${filter.search.trim()}` });
    for (const icon of filter.icons) out.push({ key: `icon:${icon}`, label: iconLabel(icon) });
    for (const row of SEG_ROWS) {
        const value = filter[row.key];
        if (value === 'all') continue;
        const opt = row.options.find(o => o.value === value);
        out.push({ key: row.key, label: `${t(row.labelKey)}: ${opt ? t(opt.labelKey) : value}` });
    }
    return out;
}

// ── 顯示偏好（localStorage）──────────────────────────────────────────────
// 模式／排序／欄位開關。純 UI 偏好，不進 Dexie、不進備份（同 ships.ts 的 kc-ships-view）。
// 壞掉的值一律退回預設，不讓畫面卡住。
const PREFS_KEY = 'kc-equip-view';

type Mode = 'grid' | 'table';
interface Prefs { mode: Mode; sort: GearSortKey; dir: SortDir; cols: string[] }

// 預設是**詳細清單**：這個分區真正要回答的是「我有幾個、改修到哪、哪個素質最高」，
// 那是逐欄比較的問題，表格一次看得到十幾種裝備；圖磚一次只看得到幾張卡，適合瀏覽而非比較。
const defaultPrefs = (): Prefs => ({
    mode: 'table', sort: 'sortNo', dir: 'asc',
    cols: COLUMNS.filter(c => c.on).map(c => c.id),
});

function loadPrefs(): Prefs {
    const d = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, d, raw => {
        if (!raw || typeof raw !== 'object') return d;
        const r = raw as Record<string, unknown>;
        const ids = new Set(COLUMNS.map(c => c.id));
        return {
            mode: r.mode === 'grid' ? 'grid' : 'table',
            sort: COLUMNS.some(c => c.sort === r.sort) || r.sort === 'sortNo' ? r.sort as Prefs['sort'] : d.sort,
            dir: r.dir === 'asc' || r.dir === 'desc' ? r.dir : d.dir,
            cols: Array.isArray(r.cols) ? r.cols.filter((c: string) => ids.has(c)) : d.cols,
        };
    });
}

const savePrefs = (p: Prefs) => { saveJsonPrefs(PREFS_KEY, p); };

/** 排序下拉的選項：圖鑑順＋各欄位。表頭排序只在清單模式有，圖磚模式靠這個下拉。 */
const SORT_OPTIONS: { key: GearSortKey; labelKey: string }[] = [
    { key: 'sortNo', labelKey: 'ov.eqSortBook' },
    ...COLUMNS.filter(c => c.sort != null).map(c => ({ key: c.sort as GearSortKey, labelKey: c.labelKey })),
];

// ── section ─────────────────────────────────────────────────────────────

export const equipmentSection: OverviewSection = {
    id: 'equipment',
    titleKey: 'ov.equip',
    render(el, ctx) {
        const groups = groupGears(ctx.state.ownedGears());
        if (!groups.length) {
            el.innerHTML = `<div class="ov-empty">${esc(t('ov.eqNone'))}</div>`;
            return;
        }

        const filter = emptyGearFilter();
        const prefs = loadPrefs();
        const expanded = new Set<number>();
        const icons = iconOptions(groups);
        const counts = ctx.state.counts();

        const iconLabel = (icon: number) => {
            const hit = icons.find(o => o.icon === icon);
            return hit && hit.label ? hit.label : `#${icon}`;
        };

        el.innerHTML = `
        <div class="eq">
            <div class="eq-rail" role="group" aria-label="${esc(t('ov.eqIconFilter'))}">
                ${icons.map(o => `
                <button type="button" class="eq-icon" data-icon="${o.icon}" aria-pressed="false"
                    title="${esc(`${o.label || `#${o.icon}`}　${t('ov.eqIconTip', { kinds: o.kinds, items: o.count })}`)}">
                    ${gearIconHtml(o.icon)}<b>${o.count}</b>
                </button>`).join('')}
            </div>

            <div class="eq-bar">
                <input class="eq-search" type="search" autocomplete="off" placeholder="${esc(t('ov.eqSearchPlaceholder'))}">
                <div class="eq-seg eq-mode">
                    <button type="button" data-mode="grid" class="${prefs.mode === 'grid' ? 'on' : ''}">${esc(t('ov.eqModeGrid'))}</button>
                    <button type="button" data-mode="table" class="${prefs.mode === 'table' ? 'on' : ''}">${esc(t('ov.eqModeTable'))}</button>
                </div>
                ${SEG_ROWS.map(row => `
                <div class="eq-group">
                    <span class="eq-group-label">${esc(t(row.labelKey))}</span>
                    <div class="eq-seg" data-f="${row.key}">${row.options.map(o =>
            `<button type="button" data-v="${esc(o.value)}" class="${filter[row.key] === o.value ? 'on' : ''}">${esc(t(o.labelKey))}</button>`).join('')}</div>
                </div>`).join('')}
                <details class="eq-colmenu">
                    <summary class="ov-btn">${esc(t('ov.rsColumns'))}</summary>
                    <div class="eq-colbox">${COLUMNS.filter(c => !c.always).map(c =>
            `<label class="eo-chip"><input type="checkbox" class="eq-col" value="${esc(c.id)}" ${prefs.cols.includes(c.id) ? 'checked' : ''}>${esc(t(c.labelKey))}</label>`).join('')}
                        <span class="eq-colops">
                            <button type="button" class="rs-mini" data-col-op="all">${esc(t('ov.rsStypeAll'))}</button>
                            <button type="button" class="rs-mini" data-col-op="none">${esc(t('ov.rsStypeNone'))}</button>
                            <button type="button" class="rs-mini" data-col-op="reset">${esc(t('ov.eqColsDefault'))}</button>
                        </span>
                    </div>
                </details>
                <label class="eq-group"><span class="eq-group-label">${esc(t('ov.eqSort'))}</span>
                    <select class="eq-sort">${SORT_OPTIONS.map(o =>
            `<option value="${o.key}" ${o.key === prefs.sort ? 'selected' : ''}>${esc(t(o.labelKey))}</option>`).join('')}</select></label>
                <button type="button" class="ov-btn eq-dir" title="${esc(t('ov.eqSortDir'))}">${prefs.dir === 'asc' ? '▲' : '▼'}</button>
                <span class="grow"></span>
                <button type="button" class="ov-btn eq-csv">${esc(t('ov.rsExportCsv'))}</button>
                <button type="button" class="ov-btn eq-copy">${esc(t('ov.rsCopyCsv'))}</button>
                <button type="button" class="ov-btn eq-reset">${esc(t('ov.rsReset'))}</button>
            </div>

            <div class="eq-chips"></div>
            <div class="eq-summary"></div>
            <div class="eq-body"></div>
            <p class="ov-note dim">${esc(t('ov.eqStatNote'))}</p>
        </div>`;

        const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
        const railEl = q<HTMLDivElement>('.eq-rail');
        const barEl = q<HTMLDivElement>('.eq-bar');
        const chipsEl = q<HTMLDivElement>('.eq-chips');
        const summaryEl = q<HTMLDivElement>('.eq-summary');
        const bodyEl = q<HTMLDivElement>('.eq-body');

        /** 目前篩選後的全部種類（匯出吃它）。 */
        let visible: GearGroup[] = [];

        const view = (): View =>
            ({ sort: prefs.sort, dir: prefs.dir, expanded, cols: new Set(prefs.cols) });

        /**
         * 重繪內容區。`keepScroll` 用於「內容集合沒變、只是換個排法／換個模式」的重繪
         * （排序、升降冪、圖磚⇄清單）——那種情況被丟回頂端會讓人找不到剛才在看的東西。
         * 篩選變更則刻意不保留：集合換了，停在原本的捲動位置沒有意義。
         */
        function draw(keepScroll = false) {
            const wrap = bodyEl.querySelector<HTMLElement>('.eq-table-wrap');
            const top = keepScroll ? (wrap?.scrollTop ?? 0) : 0;

            visible = sortGears(filterGears(groups, filter), prefs.sort, prefs.dir);
            const v = view();

            const active = describeGearFilter(filter, iconLabel);
            chipsEl.innerHTML = active.map(a =>
                `<button type="button" class="eq-chip" data-clear="${esc(a.key)}">${esc(a.label)}<span aria-hidden="true">×</span></button>`).join('');
            chipsEl.hidden = !active.length;

            const sum = totalCount(visible);
            const all = totalCount(groups);
            summaryEl.innerHTML = `${esc(t('ov.eqSummary', {
                kinds: sum.kinds, items: sum.items, equipped: sum.equipped, idle: sum.idle, total: all.items,
            }))}<span class="eq-cap">${esc(t('ov.eqCapacity', { n: counts.gears, max: counts.maxGears }))}</span>`;

            bodyEl.innerHTML = !visible.length
                ? `<div class="ov-empty">${esc(t('ov.eqNoResults'))}</div>`
                : prefs.mode === 'table' ? tableHtml(visible, v) : cardsHtml(visible, v);

            if (top) {
                const next = bodyEl.querySelector<HTMLElement>('.eq-table-wrap');
                if (next) next.scrollTop = top;
            }
        }

        /**
         * 展開／收合逐顆實例——**只動這一列，不重繪整個內容區**。
         *
         * 原本是重繪整塊，結果每按一次展開，畫面就跳掉：詳細清單的捲動容器
         * (`.eq-table-wrap`) 被換掉後 scrollTop 歸零，圖磚模式則整片重排，剛剛點的那張卡
         * 不知道跑去哪，得再滑一次捲軸把它找回來。改成就地插入／移除展開內容後，
         * 捲動位置與周圍元素都原地不動。
         */
        function toggleExpand(mst: number, btn: HTMLElement) {
            const group = visible.find(g => g.mst === mst);
            if (!group) return;
            const open = !expanded.has(mst);
            if (open) expanded.add(mst); else expanded.delete(mst);

            btn.setAttribute('aria-expanded', String(open));
            const caret = btn.querySelector('.eq-caret');
            if (caret) caret.textContent = open ? '▾' : '▸';

            const row = btn.closest<HTMLTableRowElement>('tr');
            if (row) {                       // 詳細清單：在該列之後插入／移除展開列
                row.classList.toggle('open', open);
                const next = row.nextElementSibling;
                if (!open) {
                    if (next?.classList.contains('eq-subrow')) next.remove();
                    return;
                }
                const sub = document.createElement('tr');
                sub.className = 'eq-subrow';
                sub.innerHTML = `<td colspan="${visibleColumns(view()).length}">${instancesHtml(group)}</td>`;
                row.after(sub);
                return;
            }

            const card = btn.closest<HTMLElement>('.eq-card');
            if (!card) return;               // 圖磚：在卡片內附加／移除展開內容
            card.classList.toggle('open', open);
            if (!open) card.querySelector('.eq-inst')?.remove();
            else card.insertAdjacentHTML('beforeend', instancesHtml(group));
        }

        // 圖示架：多選 toggle。選中狀態直接改 class，不重繪整排（圖示會閃）。
        railEl.addEventListener('click', e => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.eq-icon');
            if (!btn) return;
            const icon = Number(btn.dataset.icon);
            const on = !filter.icons.includes(icon);
            filter.icons = on ? [...filter.icons, icon] : filter.icons.filter(x => x !== icon);
            btn.classList.toggle('on', on);
            btn.setAttribute('aria-pressed', String(on));
            draw();
        });

        q<HTMLInputElement>('.eq-search').addEventListener('input', e => {
            filter.search = (e.currentTarget as HTMLInputElement).value;
            draw();
        });

        // 工具列的分段控制（模式＋三組篩選）一律事件委派，值寫回後只換該組的 .on。
        barEl.addEventListener('click', e => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.eq-seg button');
            if (!btn) return;
            const group = btn.closest<HTMLElement>('.eq-seg')!;
            group.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
            if (group.classList.contains('eq-mode')) {
                prefs.mode = btn.dataset.mode === 'table' ? 'table' : 'grid';
                savePrefs(prefs);
            } else {
                const key = group.dataset.f as SegRow['key'];
                const value = btn.dataset.v!;
                if (key === 'usage') filter.usage = value as UsageFilter;
                else if (key === 'improve') filter.improve = value as ImproveFilter;
                else filter.consumable = value as ConsumableFilter;
            }
            draw();
        });

        // 欄位開關：勾選狀態就是 prefs.cols，但寫回時**照 COLUMNS 的宣告順序**排，
        // 不用使用者勾選的先後——否則欄位會隨勾選順序亂跳。
        const colBoxEl = q<HTMLElement>('.eq-colbox');
        const syncCols = () => {
            const checked = new Set([...colBoxEl.querySelectorAll<HTMLInputElement>('.eq-col')]
                .filter(b => b.checked).map(b => b.value));
            prefs.cols = COLUMNS.filter(c => checked.has(c.id)).map(c => c.id);
            savePrefs(prefs);
            draw(true);
        };

        colBoxEl.addEventListener('change', e => {
            const box = (e.target as HTMLElement).closest<HTMLInputElement>('.eq-col');
            if (!box) return;
            box.closest('.eo-chip')?.classList.toggle('on', box.checked);
            syncCols();
        });

        colBoxEl.addEventListener('click', e => {
            const op = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-col-op]')?.dataset.colOp;
            if (!op) return;
            const defaults = new Set(COLUMNS.filter(c => c.on).map(c => c.id));
            for (const box of colBoxEl.querySelectorAll<HTMLInputElement>('.eq-col')) {
                box.checked = op === 'all' ? true : op === 'none' ? false : defaults.has(box.value);
                box.closest('.eo-chip')?.classList.toggle('on', box.checked);
            }
            syncCols();
        });

        q<HTMLSelectElement>('.eq-sort').addEventListener('change', e => {
            prefs.sort = (e.currentTarget as HTMLSelectElement).value as GearSortKey;
            savePrefs(prefs);
            draw(true);
        });

        q<HTMLButtonElement>('.eq-dir').addEventListener('click', e => {
            prefs.dir = prefs.dir === 'asc' ? 'desc' : 'asc';
            (e.currentTarget as HTMLButtonElement).textContent = prefs.dir === 'asc' ? '▲' : '▼';
            savePrefs(prefs);
            draw(true);
        });

        // chip 的 ×：清掉單一條件。圖示 chip 要順便把圖示架上的選中態拿掉，兩邊不能不同步。
        chipsEl.addEventListener('click', e => {
            const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.eq-chip');
            if (!chip) return;
            const key = chip.dataset.clear!;
            if (key === 'search') {
                filter.search = '';
                q<HTMLInputElement>('.eq-search').value = '';
            } else if (key.startsWith('icon:')) {
                const icon = Number(key.slice(5));
                filter.icons = filter.icons.filter(x => x !== icon);
                const btn = railEl.querySelector<HTMLButtonElement>(`.eq-icon[data-icon="${icon}"]`);
                btn?.classList.remove('on');
                btn?.setAttribute('aria-pressed', 'false');
            } else {
                if (key === 'usage') filter.usage = 'all';
                else if (key === 'improve') filter.improve = 'all';
                else if (key === 'consumable') filter.consumable = 'all';
                const group = barEl.querySelector<HTMLElement>(`.eq-seg[data-f="${key}"]`);
                group?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === 'all'));
            }
            draw();
        });

        q<HTMLButtonElement>('.eq-reset').addEventListener('click', () => {
            Object.assign(filter, emptyGearFilter());
            expanded.clear();
            q<HTMLInputElement>('.eq-search').value = '';
            railEl.querySelectorAll<HTMLButtonElement>('.eq-icon').forEach(btn => {
                btn.classList.remove('on');
                btn.setAttribute('aria-pressed', 'false');
            });
            barEl.querySelectorAll<HTMLElement>('.eq-seg[data-f]').forEach(group =>
                group.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === 'all')));
            draw();
        });

        // 展開／收合逐顆實例，兩種模式共用同一個 expanded 集合（切模式不會忘記展開了誰）。
        bodyEl.addEventListener('click', e => {
            const name = (e.target as HTMLElement).closest<HTMLButtonElement>('.eq-name');
            if (name) {
                toggleExpand(Number(name.dataset.mst), name);
                return;
            }
            // 表頭排序：數值欄第一次點由大到小（想看的是「哪個最高」），文字欄由小到大。
            const th = (e.target as HTMLElement).closest<HTMLElement>('.eq-th.sortable');
            if (!th) return;
            const key = th.dataset.sort as GearSortKey;
            if (prefs.sort === key) prefs.dir = prefs.dir === 'asc' ? 'desc' : 'asc';
            else {
                prefs.sort = key;
                prefs.dir = COLUMNS.find(c => c.sort === key)?.numeric ? 'desc' : 'asc';
            }
            q<HTMLSelectElement>('.eq-sort').value = prefs.sort;
            q<HTMLButtonElement>('.eq-dir').textContent = prefs.dir === 'asc' ? '▲' : '▼';
            savePrefs(prefs);
            draw(true);
        });

        bodyEl.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const th = (e.target as HTMLElement).closest<HTMLElement>('.eq-th.sortable');
            if (!th) return;
            e.preventDefault();
            th.click();
        });

        q<HTMLButtonElement>('.eq-csv').addEventListener('click', () =>
            downloadText('kanmusu-equipment.csv', gearCsv(visible, view()), 'text/csv'));
        q<HTMLButtonElement>('.eq-copy').addEventListener('click', e =>
            copyWithFeedback(e.currentTarget as HTMLButtonElement, gearCsv(visible, view()), t('ov.rsCopied')));

        draw();
    },
};
