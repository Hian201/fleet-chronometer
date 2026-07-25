// 艦娘全覽：全持有艦的**詳細清單**（唯讀 view 來自 GameState，入手觀測只從 shipObtained 關聯）。
//
// ── 版面取捨（參照 samples/kanmusu_filter.png，但刻意不照抄）──────────────
// 參照圖把二十幾組「全部／是／否」全部常駐攤開，佔掉半個畫面才看得到第一艘船。本分區改成：
//   1. **常駐工具列**只留每次都會用的：關鍵字、每頁筆數、欄位開關、篩選抽屜開關、匯出。
//   2. **篩選抽屜**（`<details>`）收納全部條件，開關狀態記在 localStorage。
//   3. **生效條件 chip 列**常駐——只列「不是預設值」的條件，每個可單獨 ×。這是關鍵：
//      抽屜收起來時仍然一眼看得出「現在被什麼篩著」，不必展開整面牆去找那顆亮起來的選項。
// 參照圖裡「顯示滾動條／提示框／鎖定圖示／分頁 顯示隱藏」這類純顯示開關**不照做**：
// 滾動條與提示框交給瀏覽器；鎖定狀態直接畫在艦名旁；分頁改成使用者要的 10/20/50/100/全部。
//
// 篩選／排序／分頁的**邏輯**全在 utils/ship-roster.ts（純函式、可用 node 餵真封包驗證），
// 本檔只負責 DOM 與事件——同 ship-picker.ts 與 event-ops.ts 的分工。
//
// ── 為什麼這支不遵守「全量重繪」慣例（design-guidelines §4.2）──────────
// 同 ship-picker.ts：篩選器含關鍵字與等級輸入框，整塊重繪會讓輸入框每打一個字就失焦。
// 故「工具列＋抽屜」只建一次並綁定，之後只重繪 `.rs-body`（chip 列／表格／分頁列／摘要）。
import type { ShipObtainedRow } from '../../../utils/db';
import type { OwnedShipView } from '../../../utils/state';
import type { OverviewSection } from './types';
import { db } from '../../../utils/db';
import { t } from '../../../utils/ui-i18n';
import { debutDateOf } from '../../../utils/ship-debut-data';
import { sallyOptions, stypeOptions } from '../../../utils/ship-filter';
import {
    annotateRoster, emptyRosterFilter, filterRoster, nationOptions, paginate, sortRoster, PAGE_SIZES,
    type PageSize, type RosterFilter, type RosterShip, type RosterSortKey, type SortDir,
} from '../../../utils/ship-roster';
import type { Nation } from '../../../utils/ship-nationality';
import { copyWithFeedback, downloadText, esc, gearIconHtml, loadJsonPrefs, saveJsonPrefs } from '../lib';

export interface OwnedShipRow extends OwnedShipView {
    obtained?: ShipObtainedRow;
}

// ── 兩個日期 ────────────────────────────────────────────────
// date1 官方登場日（表頭 Released）：該艦（基礎形態）在遊戲正式實裝那天，來自
//   utils/ship-debut-data.ts 參照資料；遊戲 API 不提供，改造形態沿用基礎形態。
// date2 打撈上任日（表頭 Joined）：本鎮守府實際入手日。追蹤啟用後入手的自動記錄
//   （source='auto'）；啟用前就擁有的是 baseline（source=null、obtainedTs=null），
//   真實日期不可考，開放手填。
// 手填下限＝date1：不可能比該艦實裝日更早入手。date1 未收錄時不設下限（不猜測）。

/** 該艦可手動填寫入手日嗎？只有 baseline（非 auto 觀測）才開放，避免覆蓋確定的觀測值。 */
export function isObtainedEditable(row: OwnedShipRow): boolean {
    return row.obtained?.source !== 'auto';
}

/**
 * 驗證手填入手日。回傳 null 代表通過，否則回傳錯誤訊息 key。
 * 不得早於官方登場日（date1）；date1 未知時只擋未來日期。
 */
export function validateObtainedDate(value: string, debut: string | null, today: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'ov.shipsDateInvalid';
    if (value > today) return 'ov.shipsDateFuture';
    if (debut && value < debut) return 'ov.shipsDateBeforeDebut';
    return null;
}

// 讓 section 的 DB 讀取可在 fake-indexeddb 測試中以獨立資料庫驗證；本函式絕不寫入資料庫。
export async function loadOwnedShipRows(
    state: { ownedShips(): OwnedShipView[] },
    getObtained = (ids: number[]) => db.shipObtained.bulkGet(ids),
): Promise<OwnedShipRow[]> {
    const ships = state.ownedShips();
    const obtained = await getObtained(ships.map(ship => ship.id));
    return ships.map((ship, index) => ({ ...ship, obtained: obtained[index] }));
}

/**
 * 清單列＝ship-roster 的 RosterShip ＋ 入手觀測 row。
 * 需要 `obtained` 是因為「上任日可不可以手填」看的是 `source`（auto＝確定觀測、唯讀），
 * 而那是 DB 概念、不該滲進純函式模組，故在 UI 這層合併。
 */
export type ShipsRow = RosterShip & { obtained?: ShipObtainedRow };

/** 補上兩個日期與衍生旗標，交給 ship-roster 的純函式處理。 */
export function buildRoster(rows: OwnedShipRow[]): ShipsRow[] {
    const obtainedById = new Map(rows.map(row => [row.id, row.obtained]));
    return annotateRoster(rows, {
        debutOf: baseMst => (baseMst == null ? null : debutDateOf(baseMst)),
        obtainedOf: id => obtainedById.get(id)?.obtainedTs ?? null,
    }).map(row => ({ ...row, obtained: obtainedById.get(row.id) }));
}

/** 本機日期 → 'YYYY-MM-DD'（<input type=date> 用；不可用 toISOString，那是 UTC 會差一天）。 */
export function toDateInputValue(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── 欄位定義 ────────────────────────────────────────────────────────────

export type ColumnId =
    'id' | 'book' | 'stype' | 'nation' | 'name' | 'lv' | 'cond' | 'hp'
    | 'firepower' | 'torpedo' | 'aa' | 'armor' | 'asw' | 'evasion' | 'los' | 'luck'
    | 'night' | 'released' | 'joined' | 'fleet' | 'sally' | 'gears';

interface RenderCtx {
    /** 素質顯示：true＝裸值（扣掉裝備自身加成，估算），false＝遊戲畫面的含裝備值。 */
    bare: boolean;
    /** 依 sallyArea 取顯示名（供出撃札欄）。 */
    tagLabel(sallyArea: number): string;
}

interface ColumnDef {
    id: ColumnId;
    labelKey: string;
    /** 可排序時對應的 ship-roster 排序鍵；不給即不可排序。 */
    sort?: RosterSortKey;
    /** 數值欄：靠右、等寬數字，且第一次點表頭時預設由大到小。 */
    numeric?: boolean;
    /** 預設是否顯示。 */
    on: boolean;
    /** 不可關閉（艦名是識別主詞，關掉整張表就沒有主詞了；同 equipment always）。 */
    always?: boolean;
    /** 額外的表頭提示（滑鼠停留）。 */
    tipKey?: string;
    cell(ship: ShipsRow, ctx: RenderCtx): string;
    /** 匯出 CSV 用的純文字；未提供時由 cell 去標籤不可靠，故一律各自實作。 */
    text(ship: ShipsRow, ctx: RenderCtx): string;
}

const stat = (ship: ShipsRow, ctx: RenderCtx, key: keyof ShipsRow['stats']) =>
    String((ctx.bare ? ship.bareStats : ship.stats)[key]);

function hpClass(ship: ShipsRow): string {
    const ratio = ship.maxhp > 0 ? ship.hp / ship.maxhp : 1;
    return ratio <= .25 ? 'taiha' : ratio <= .5 ? 'chuha' : ratio < 1 ? 'shouha' : '';
}

/** 士氣：疲勞（<20 紅／<30 橙）與キラキラ（≥50）各自上色，與遊戲的區間一致。 */
function condClass(cond: number): string {
    if (cond >= 50) return 'sparkle';
    if (cond < 20) return 'tired2';
    if (cond < 30) return 'tired1';
    return '';
}

const numericStat = (id: ColumnId, labelKey: string, key: keyof ShipsRow['stats'], sort: RosterSortKey): ColumnDef => ({
    id, labelKey, sort, numeric: true, on: true,
    cell: (s, c) => stat(s, c, key),
    text: (s, c) => stat(s, c, key),
});

/** 裝備格：一律畫滿該艦的真實槽數，空槽顯示「空裝」佔位；補強增設另成一格（有孔才畫）。 */
function gearsCell(ship: ShipsRow): string {
    const slot = (g: ShipsRow['gears'][number], extra = '') => {
        if (!g) return `<span class="rs-slot empty${extra}" title="${esc(t('ov.rsEmptySlot'))}"></span>`;
        const star = g.level > 0 ? `<b class="rs-star">★${g.level}</b>` : '';
        const alv = g.alv > 0 ? `<u class="rs-alv">${g.alv}</u>` : '';
        const title = `${g.name}${g.level > 0 ? ` ★${g.level}` : ''}${g.alv > 0 ? ` »${g.alv}` : ''}`;
        return `<span class="rs-slot${extra}" title="${esc(title)}">${gearIconHtml(g.icon, g.short)}${alv}${star}</span>`;
    };
    const main = ship.gears.map(g => slot(g)).join('');
    // 補強增設：無孔（api_slot_ex===0）就完全不畫，才分得出「沒開孔」與「開了孔沒裝」。
    const ex = !ship.exSlotOpen ? ''
        : ship.exGear ? slot(ship.exGear, ' ex')
            : `<span class="rs-slot ex empty" title="${esc(t('ov.shipsExEquipment'))}"></span>`;
    return `<span class="rs-slots">${main}${ex}</span>`;
}

function gearsText(ship: ShipsRow): string {
    const names = ship.gears.map(g => (g ? `${g.name}${g.level > 0 ? `★${g.level}` : ''}` : t('ov.rsEmptySlot')));
    if (ship.exGear) names.push(`[${t('ov.shipsEx')}]${ship.exGear.name}${ship.exGear.level > 0 ? `★${ship.exGear.level}` : ''}`);
    return names.join(' / ');
}

// date2 打撈上任日。auto 觀測值＝確定事實，唯讀顯示；baseline（未知）開放手填，
// 下限綁 date1（min 屬性做第一道防線，送出時再用 validateObtainedDate 實際驗證）。
function joinedCell(ship: ShipsRow): string {
    const ts = ship.obtainedTs;
    const known = typeof ts === 'number' && Number.isFinite(ts);
    if (known && !isObtainedEditable(ship)) {
        return `<span class="ships-date-auto" title="${esc(t('ov.shipsDateAutoTip'))}">${esc(toDateInputValue(ts as number))}</span>`;
    }
    const debut = ship.debut;
    return `<input class="ships-date-input" type="date" data-ship-date="${ship.id}"
        value="${known ? esc(toDateInputValue(ts as number)) : ''}"
        ${debut ? `min="${esc(debut)}"` : ''} max="${esc(toDateInputValue(Date.now()))}"
        title="${esc(t('ov.shipsDateEditTip'))}">`;
}

export const COLUMNS: ColumnDef[] = [
    { id: 'id', labelKey: 'ov.rsColId', sort: 'id', numeric: true, on: true, cell: s => String(s.id), text: s => String(s.id) },
    {
        id: 'book', labelKey: 'ov.shipsBookNo', sort: 'book', numeric: true, on: false,
        cell: s => (s.bookNo == null ? esc(t('ov.shipsDateUnknown')) : `No.${s.bookNo}`),
        text: s => (s.bookNo == null ? '' : String(s.bookNo)),
    },
    { id: 'stype', labelKey: 'ov.rsColStype', sort: 'stype', on: true, cell: s => `<span class="rs-stype">${esc(s.stype)}</span>`, text: s => s.stype },
    {
        // 國籍預設關閉：多數提督的名冊九成是日艦，常駐一整欄「日本」只是佔寬度；
        // 要看的時候（或篩了外國艦之後）再打開即可。
        id: 'nation', labelKey: 'ov.rsColNation', sort: 'nation', on: false, tipKey: 'ov.rsColNationTip',
        cell: s => (s.nation
            ? `<span class="rs-nation">${esc(t(`nation.${s.nation}`))}</span>`
            : `<span class="dim">${esc(t('ov.shipsDateUnknown'))}</span>`),
        text: s => (s.nation ? t(`nation.${s.nation}`) : ''),
    },
    {
        id: 'name', labelKey: 'ov.rsColName', sort: 'name', on: true, always: true,
        cell: s => `<span class="rs-name" title="${esc(s.name)}">${esc(s.name)}</span>`
            + (s.locked ? `<span class="rs-lock" title="${esc(t('ov.shipsLocked'))}">🔒</span>` : '')
            + (s.married ? `<span class="rs-ring" title="${esc(t('ov.rsMarried'))}">💍</span>` : ''),
        text: s => s.name,
    },
    { id: 'lv', labelKey: 'ov.rsColLv', sort: 'level', numeric: true, on: true, cell: s => String(s.lv), text: s => String(s.lv) },
    {
        id: 'cond', labelKey: 'ov.rsColCond', sort: 'cond', numeric: true, on: true,
        cell: s => `<span class="rs-cond ${condClass(s.cond)}">${s.cond}</span>`, text: s => String(s.cond),
    },
    {
        id: 'hp', labelKey: 'ov.rsColHp', sort: 'hp', numeric: true, on: true,
        cell: s => `<span class="ships-hp ${hpClass(s)}">${s.hp}/${s.maxhp}</span>`,
        text: s => `${s.hp}/${s.maxhp}`,
    },
    numericStat('firepower', 'ov.rsColFire', 'firepower', 'firepower'),
    numericStat('torpedo', 'ov.rsColTorp', 'torpedo', 'torpedo'),
    numericStat('aa', 'ov.rsColAa', 'aa', 'aa'),
    numericStat('armor', 'ov.rsColArmor', 'armor', 'armor'),
    numericStat('asw', 'ov.rsColAsw', 'asw', 'asw'),
    numericStat('evasion', 'ov.rsColEvasion', 'evasion', 'evasion'),
    numericStat('los', 'ov.rsColLos', 'los', 'los'),
    numericStat('luck', 'ov.rsColLuck', 'luck', 'luck'),
    {
        // 夜戰火力＝火力＋雷裝。跟著素質顯示模式走（裸值模式下兩項都是裸值）。
        id: 'night', labelKey: 'ov.rsColNight', sort: 'night', numeric: true, on: true, tipKey: 'ov.rsColNightTip',
        cell: (s, c) => String(c.bare ? s.bareStats.firepower + s.bareStats.torpedo : s.night),
        text: (s, c) => String(c.bare ? s.bareStats.firepower + s.bareStats.torpedo : s.night),
    },
    {
        id: 'released', labelKey: 'ov.rsColReleased', sort: 'released', on: true, tipKey: 'ov.rsColReleasedTip',
        cell: s => (s.debut ? `<span class="rs-date">${esc(s.debut)}</span>` : esc(t('ov.shipsDateUnknown'))),
        text: s => s.debut ?? '',
    },
    {
        id: 'joined', labelKey: 'ov.rsColJoined', sort: 'joined', on: true, tipKey: 'ov.rsColJoinedTip',
        cell: s => joinedCell(s),
        text: s => (s.obtainedTs == null ? '' : toDateInputValue(s.obtainedTs)),
    },
    {
        id: 'fleet', labelKey: 'ov.shipsFleet', on: false,
        cell: s => (s.fleetNo == null ? `<span class="dim">${esc(t('ov.shipsUnassigned'))}</span>` : esc(t('ov.shipsFleetN', { n: s.fleetNo }))),
        text: s => (s.fleetNo == null ? '' : String(s.fleetNo)),
    },
    {
        id: 'sally', labelKey: 'ov.rsColSally', on: false,
        cell: (s, c) => (s.sallyArea > 0
            ? `<span class="rs-tag">${esc(c.tagLabel(s.sallyArea))}</span>`
            : `<span class="dim">${esc(t('ov.spFree'))}</span>`),
        text: (s, c) => (s.sallyArea > 0 ? c.tagLabel(s.sallyArea) : ''),
    },
    { id: 'gears', labelKey: 'ov.rsColGears', on: true, cell: s => gearsCell(s), text: s => gearsText(s) },
];

// ── 表格 ────────────────────────────────────────────────────────────────

export interface TableView {
    cols: Set<ColumnId>;
    sort: RosterSortKey;
    dir: SortDir;
    bare: boolean;
}

/** 依 COLUMNS 宣告順序取顯示欄位；always 欄（艦名）一律保留。 */
export const visibleColumns = (view: TableView) =>
    COLUMNS.filter(c => c.always || view.cols.has(c.id));

/** 表頭：可排序欄可點，目前排序欄顯示方向箭頭（純文字，無圖檔依賴）。 */
function headHtml(view: TableView): string {
    const cells = visibleColumns(view).map(c => {
        const active = c.sort != null && c.sort === view.sort;
        const arrow = active ? (view.dir === 'asc' ? '▲' : '▼') : '';
        const tip = c.tipKey ? ` title="${esc(t(c.tipKey))}"` : '';
        const attrs = c.sort ? ` data-sort="${c.sort}" tabindex="0" role="button"` : '';
        return `<th class="rs-th${c.numeric ? ' num' : ''}${c.sort ? ' sortable' : ''}${active ? ' active' : ''} rs-c-${c.id}"${attrs}${tip}>`
            + `${esc(t(c.labelKey))}<span class="rs-arrow">${arrow}</span></th>`;
    });
    return `<thead><tr>${cells.join('')}</tr></thead>`;
}

export function rosterTableHtml(rows: ShipsRow[], view: TableView, ctx: RenderCtx): string {
    if (!rows.length) return `<div class="ov-empty">${esc(t('ov.shipsNoResults'))}</div>`;
    const cols = visibleColumns(view);
    const body = rows.map(ship => `<tr data-ship="${ship.id}">${cols.map(c =>
        `<td class="${c.numeric ? 'num ' : ''}rs-c-${c.id}">${c.cell(ship, ctx)}</td>`).join('')}</tr>`).join('');
    return `<table class="rs-table">${headHtml(view)}<tbody>${body}</tbody></table>`;
}

/** 匯出目前**篩選後的全部**列（不是只有這一頁）為 CSV。取代參照圖的「匯出至 kanmusu_list」。 */
export function rosterCsv(rows: ShipsRow[], view: TableView, ctx: RenderCtx): string {
    const cols = visibleColumns(view);
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [cols.map(c => cell(t(c.labelKey))).join(',')];
    for (const ship of rows) lines.push(cols.map(c => cell(c.text(ship, ctx))).join(','));
    return lines.join('\n');
}

// ── 篩選抽屜 ────────────────────────────────────────────────────────────

/** 一組分段按鈕的選項（value 一律字串，寫回 filter 時再依欄位轉型）。 */
interface SegOption { value: string; labelKey: string }
interface SegRow { key: keyof RosterFilter; labelKey: string; options: SegOption[]; tipKey?: string }

const TRI: SegOption[] = [
    { value: 'all', labelKey: 'ov.spAll' },
    { value: 'yes', labelKey: 'ov.rsYes' },
    { value: 'no', labelKey: 'ov.rsNo' },
];

const SEG_ROWS: SegRow[] = [
    {
        key: 'remodel', labelKey: 'ov.rsRemodel', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'done', labelKey: 'ov.rsRemodelDone' },
            { value: 'pending', labelKey: 'ov.rsRemodelPending' },
        ],
    },
    {
        key: 'modern', labelKey: 'ov.rsModern', tipKey: 'ov.rsModernTip', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'full', labelKey: 'ov.rsModernFull' },
            { value: 'partial', labelKey: 'ov.rsModernPartial' },
            { value: 'special', labelKey: 'ov.rsModernSpecial' },
        ],
    },
    { key: 'married', labelKey: 'ov.rsMarried', options: TRI },
    { key: 'inFleet', labelKey: 'ov.rsInFleet', options: TRI },
    { key: 'locked', labelKey: 'ov.rsLocked', options: TRI },
    { key: 'sparkle', labelKey: 'ov.rsSparkle', tipKey: 'ov.rsSparkleTip', options: TRI },
    { key: 'exSlotOpen', labelKey: 'ov.rsExSlotOpen', options: TRI },
    { key: 'duplicate', labelKey: 'ov.rsDuplicate', tipKey: 'ov.rsDuplicateTip', options: TRI },
    {
        key: 'speed', labelKey: 'ov.spSpeed', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'slow', labelKey: 'ov.spSlow' },
            { value: 'fast', labelKey: 'ov.spFast' },
            { value: 'fastPlus', labelKey: 'ov.spFastPlus' },
        ],
    },
    {
        key: 'leng', labelKey: 'ov.rsLeng', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: '1', labelKey: 'ov.rsLengShort' },
            { value: '2', labelKey: 'ov.rsLengMedium' },
            { value: '3', labelKey: 'ov.rsLengLong' },
            { value: '4', labelKey: 'ov.rsLengVeryLong' },
        ],
    },
    {
        key: 'opening', labelKey: 'ov.rsOpening', tipKey: 'ov.rsOpeningTip', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'asw', labelKey: 'ov.rsOpeningAsw' },
            { value: 'torpedo', labelKey: 'ov.rsOpeningTorpedo' },
            { value: 'both', labelKey: 'ov.rsOpeningBoth' },
        ],
    },
    {
        key: 'equip', labelKey: 'ov.spEquip', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'landingCraft', labelKey: 'ov.spLandingCraft' },
            { value: 'landingOnly', labelKey: 'ov.spLandingOnly' },
            { value: 'naikatei', labelKey: 'ov.spNaikatei' },
            { value: 'naikateiOnly', labelKey: 'ov.spNaikateiOnly' },
            { value: 'both', labelKey: 'ov.spBoth' },
            { value: 'either', labelKey: 'ov.spEither' },
            { value: 'neither', labelKey: 'ov.spNeither' },
        ],
    },
    {
        key: 'namedEquip', labelKey: 'ov.rsNamedEquip', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'commandFacility', labelKey: 'ov.rsNeCommandFacility' },
            { value: 'seaplaneFighter', labelKey: 'ov.rsNeSeaplaneFighter' },
            { value: 'seaplaneBomber', labelKey: 'ov.rsNeSeaplaneBomber' },
            { value: 'largeFlyingBoat', labelKey: 'ov.rsNeLargeFlyingBoat' },
            { value: 'extraArmor', labelKey: 'ov.rsNeExtraArmor' },
            { value: 'midget', labelKey: 'ov.rsNeMidget' },
        ],
    },
    {
        key: 'exSlot', labelKey: 'ov.rsExSlot', tipKey: 'ov.rsExSlotTip', options: [
            { value: 'all', labelKey: 'ov.spAll' },
            { value: 'secondary', labelKey: 'ov.rsExSecondary' },
            { value: 'radar', labelKey: 'ov.rsExRadar' },
            { value: 'depthCharge', labelKey: 'ov.rsExDepthCharge' },
            { value: 'landingCraft', labelKey: 'ov.rsExLandingCraft' },
            { value: 'commandFacility', labelKey: 'ov.rsExCommandFacility' },
            { value: 'boiler', labelKey: 'ov.rsExBoiler' },
            { value: 'any', labelKey: 'ov.rsExAny' },
        ],
    },
];

/** 把 segment 的字串值寫回 filter（leng 是數值欄，其餘都是字面量聯集）。 */
function applySeg(filter: RosterFilter, key: keyof RosterFilter, value: string) {
    if (key === 'leng') { filter.leng = value === 'all' ? null : Number(value); return; }
    // 其餘欄位都是字面量聯集，值域由 SEG_ROWS 的 options 保證（DOM 上的 data-v 只可能是
    // 那些字串），故這裡的寬鬆寫入是安全的——型別系統無法表達「這個 key 配這個 value」。
    (filter as unknown as Record<string, unknown>)[key] = value;
}

function segValue(filter: RosterFilter, key: keyof RosterFilter): string {
    if (key === 'leng') return filter.leng == null ? 'all' : String(filter.leng);
    return String(filter[key]);
}

/** 生效中的條件（供 chip 列）。只列非預設值，順序照抽屜的排列，可預期。 */
export function describeFilter(
    filter: RosterFilter, stypeLabel: Map<number, string>, tagLabel: (id: number) => string,
): { key: string; label: string }[] {
    const out: { key: string; label: string }[] = [];
    if (filter.search.trim()) out.push({ key: 'search', label: `${t('ov.rsSearchLabel')}: ${filter.search.trim()}` });
    for (const id of filter.stypeIds) out.push({ key: `stype:${id}`, label: stypeLabel.get(id) ?? String(id) });
    for (const n of filter.nations) out.push({ key: `nation:${n}`, label: t(`nation.${n}`) });
    for (const row of SEG_ROWS) {
        const value = segValue(filter, row.key);
        if (value === 'all') continue;
        const opt = row.options.find(o => o.value === value);
        out.push({ key: row.key, label: `${t(row.labelKey)}: ${opt ? t(opt.labelKey) : value}` });
    }
    if (filter.lvMin != null || filter.lvMax != null) {
        out.push({ key: 'lv', label: `${t('ov.rsLevel')}: ${filter.lvMin ?? ''}–${filter.lvMax ?? ''}` });
    }
    if (filter.sallyArea != null) {
        out.push({
            key: 'sallyArea',
            label: `${t('ov.spSally')}: ${filter.sallyArea === 0 ? t('ov.spFree') : tagLabel(filter.sallyArea)}`,
        });
    }
    return out;
}

// ── 顯示偏好（localStorage）──────────────────────────────────────────────
// 欄位開關／每頁筆數／排序／素質模式／抽屜開合。純 UI 偏好，不進 Dexie、不進備份
// （同 backup 分區的裁剪設定作法）。壞掉的值一律退回預設，不讓畫面卡住。
const PREFS_KEY = 'kc-ships-view';

interface Prefs {
    cols: ColumnId[];
    size: PageSize;
    sort: RosterSortKey;
    dir: SortDir;
    bare: boolean;
    open: boolean;
}

const defaultPrefs = (): Prefs => ({
    cols: COLUMNS.filter(c => c.on).map(c => c.id),
    size: 20, sort: 'level', dir: 'desc', bare: false, open: false,
});

function loadPrefs(): Prefs {
    const d = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, d, raw => {
        if (!raw || typeof raw !== 'object') return d;
        const r = raw as Record<string, unknown>;
        const ids = new Set(COLUMNS.map(c => c.id));
        return {
            cols: Array.isArray(r.cols) ? r.cols.filter((c: ColumnId) => ids.has(c)) : d.cols,
            size: PAGE_SIZES.includes(r.size as PageSize) ? r.size as PageSize : d.size,
            sort: COLUMNS.some(c => c.sort === r.sort) ? r.sort as Prefs['sort'] : d.sort,
            dir: r.dir === 'asc' || r.dir === 'desc' ? r.dir : d.dir,
            bare: r.bare === true,
            open: r.open === true,
        };
    });
}

const savePrefs = (p: Prefs) => { saveJsonPrefs(PREFS_KEY, p); };

// ── section ─────────────────────────────────────────────────────────────

const seg = (row: SegRow, filter: RosterFilter) => `
    <div class="rs-row">
        <span class="rs-row-label"${row.tipKey ? ` title="${esc(t(row.tipKey))}"` : ''}>${esc(t(row.labelKey))}${row.tipKey ? '<i class="rs-info">?</i>' : ''}</span>
        <div class="rs-seg" data-f="${row.key}">${row.options.map(o =>
    `<button type="button" data-v="${esc(o.value)}" class="${segValue(filter, row.key) === o.value ? 'on' : ''}">${esc(t(o.labelKey))}</button>`).join('')}</div>
    </div>`;

export const shipsSection: OverviewSection = {
    id: 'ships',
    titleKey: 'ov.ships',
    async render(el, ctx) {
        // **先畫殼、再讀資料**（同 sortie／exped）：DB 阻塞時工具列仍可見。
        const filter = emptyRosterFilter();
        const prefs = loadPrefs();
        let page = 1;
        let rows: OwnedShipRow[] = [];
        let roster: ShipsRow[] = [];
        const stypeLabel = new Map<number, string>();
        // 札名 API 不提供（見 utils/event-plan.ts 檔頭），故只顯示遊戲給的數字 id。
        const tagLabel = (id: number) => `#${id}`;
        const renderCtx: RenderCtx = { bare: prefs.bare, tagLabel };

        el.innerHTML = `
        <div class="rs">
            <div class="rs-bar">
                <input class="rs-search" type="search" autocomplete="off" placeholder="${esc(t('ov.shipsSearchPlaceholder'))}">
                <button type="button" class="ov-btn rs-toggle" aria-expanded="${prefs.open}">${esc(t('ov.rsFilters'))}<span class="rs-badge"></span></button>
                <details class="rs-colmenu">
                    <summary class="ov-btn">${esc(t('ov.rsColumns'))}</summary>
                    <div class="rs-colbox">${COLUMNS.filter(c => !c.always).map(c =>
            `<label class="eo-chip"><input type="checkbox" class="rs-col" value="${c.id}" ${prefs.cols.includes(c.id) ? 'checked' : ''}>${esc(t(c.labelKey))}</label>`).join('')}</div>
                </details>
                <label class="rs-inline"><span>${esc(t('ov.rsPageSize'))}</span>
                    <select class="rs-size">${PAGE_SIZES.map(s =>
            `<option value="${s}" ${s === prefs.size ? 'selected' : ''}>${s === 0 ? esc(t('ov.rsAll')) : s}</option>`).join('')}</select></label>
                <label class="rs-inline" title="${esc(t('ov.rsBareTip'))}">
                    <input type="checkbox" class="rs-bare" ${prefs.bare ? 'checked' : ''}><span>${esc(t('ov.rsBare'))}</span></label>
                <span class="grow"></span>
                <button type="button" class="ov-btn rs-csv">${esc(t('ov.rsExportCsv'))}</button>
                <button type="button" class="ov-btn rs-copy">${esc(t('ov.rsCopyCsv'))}</button>
                <button type="button" class="ov-btn rs-reset">${esc(t('ov.rsReset'))}</button>
            </div>

            <div class="rs-drawer" ${prefs.open ? '' : 'hidden'}>
                <div class="rs-row">
                    <span class="rs-row-label">${esc(t('ov.rsStype'))}</span>
                    <div class="rs-stypes rs-stype-chips">
                        <span class="rs-stype-ops">
                            <button type="button" class="rs-mini" data-stype-op="all">${esc(t('ov.rsStypeAll'))}</button>
                            <button type="button" class="rs-mini" data-stype-op="none">${esc(t('ov.rsStypeNone'))}</button>
                            <button type="button" class="rs-mini" data-stype-op="invert">${esc(t('ov.rsStypeInvert'))}</button>
                        </span>
                    </div>
                </div>
                <div class="rs-row">
                    <span class="rs-row-label" title="${esc(t('ov.rsNationTip'))}">${esc(t('ov.rsNation'))}<i class="rs-info">?</i></span>
                    <div class="rs-stypes rs-nation-chips"></div>
                </div>
                ${SEG_ROWS.map(row => seg(row, filter)).join('')}
                <div class="rs-row">
                    <span class="rs-row-label">${esc(t('ov.rsLevel'))}</span>
                    <div class="rs-range">
                        <input type="number" class="rs-lvmin" min="1" max="185" placeholder="1">
                        <span>${esc(t('ov.rsTo'))}</span>
                        <input type="number" class="rs-lvmax" min="1" max="185" placeholder="185">
                    </div>
                </div>
                <div class="rs-row">
                    <span class="rs-row-label">${esc(t('ov.spSally'))}</span>
                    <select class="rs-sally"><option value="">${esc(t('ov.spAll'))}</option></select>
                </div>
            </div>

            <div class="rs-chips"></div>
            <div class="rs-summary"></div>
            <div class="rs-table-wrap"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
            <div class="rs-pager"></div>
            <p class="ov-note dim">${esc(t('ov.shipsDateNote'))}</p>
            <p class="rs-status ov-note dim"></p>
        </div>`;

        const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
        const drawerEl = q<HTMLDivElement>('.rs-drawer');
        const toggleEl = q<HTMLButtonElement>('.rs-toggle');
        const badgeEl = q<HTMLSpanElement>('.rs-badge');
        const chipsEl = q<HTMLDivElement>('.rs-chips');
        const summaryEl = q<HTMLDivElement>('.rs-summary');
        const tableEl = q<HTMLDivElement>('.rs-table-wrap');
        const pagerEl = q<HTMLDivElement>('.rs-pager');
        const statusEl = q<HTMLParagraphElement>('.rs-status');
        const sallyEl = q<HTMLSelectElement>('.rs-sally');
        const stypeChipsEl = q<HTMLDivElement>('.rs-stype-chips');
        const nationChipsEl = q<HTMLDivElement>('.rs-nation-chips');

        /** 目前篩選後的全部列（不分頁）——匯出與分頁都吃它。 */
        let visible: ShipsRow[] = [];

        function view(): TableView {
            return { cols: new Set(prefs.cols), sort: prefs.sort, dir: prefs.dir, bare: prefs.bare };
        }

        function draw() {
            renderCtx.bare = prefs.bare;
            visible = sortRoster(filterRoster(roster, filter), prefs.sort, prefs.dir);
            const p = paginate(visible, prefs.size, page);
            page = p.page;

            const active = describeFilter(filter, stypeLabel, tagLabel);
            badgeEl.textContent = active.length ? String(active.length) : '';
            badgeEl.hidden = !active.length;
            chipsEl.innerHTML = active.map(a =>
                `<button type="button" class="rs-chip" data-clear="${esc(a.key)}">${esc(a.label)}<span aria-hidden="true">×</span></button>`).join('');
            chipsEl.hidden = !active.length;

            summaryEl.textContent = t('ov.rsSummary', {
                from: p.from, to: p.to, shown: p.total, total: roster.length,
            });
            tableEl.innerHTML = rosterTableHtml(p.rows, view(), renderCtx);
            pagerEl.innerHTML = p.pageCount <= 1 ? '' : `
                <button type="button" class="ov-btn rs-page" data-page="prev" ${p.page <= 1 ? 'disabled' : ''}>‹</button>
                <span class="rs-pageno">${t('ov.rsPageOf', { page: p.page, pages: p.pageCount })}</span>
                <button type="button" class="ov-btn rs-page" data-page="next" ${p.page >= p.pageCount ? 'disabled' : ''}>›</button>`;
            pagerEl.hidden = p.pageCount <= 1;
        }

        // 條件變更一律回到第 1 頁——留在第 7 頁看新條件的結果只會讓人以為壞了。
        const changed = () => { page = 1; draw(); };

        toggleEl.addEventListener('click', () => {
            prefs.open = !prefs.open;
            drawerEl.hidden = !prefs.open;
            toggleEl.setAttribute('aria-expanded', String(prefs.open));
            savePrefs(prefs);
        });

        q<HTMLInputElement>('.rs-search').addEventListener('input', e => {
            filter.search = (e.currentTarget as HTMLInputElement).value;
            changed();
        });

        // 分段按鈕：事件委派到抽屜，值寫回 filter 後只換該組的 .on。
        drawerEl.addEventListener('click', e => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.rs-seg button');
            if (btn) {
                const group = btn.closest<HTMLElement>('.rs-seg')!;
                applySeg(filter, group.dataset.f as keyof RosterFilter, btn.dataset.v!);
                group.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
                changed();
                return;
            }
            const op = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-stype-op]');
            if (!op) return;
            const boxes = [...drawerEl.querySelectorAll<HTMLInputElement>('.rs-stype')];
            for (const box of boxes) {
                box.checked = op.dataset.stypeOp === 'all' ? true
                    : op.dataset.stypeOp === 'none' ? false : !box.checked;
                box.closest('.eo-chip')?.classList.toggle('on', box.checked);
            }
            filter.stypeIds = boxes.filter(b => b.checked).map(b => Number(b.value));
            changed();
        });

        drawerEl.addEventListener('change', e => {
            const target = e.target as HTMLElement;
            if (target.matches('.rs-stype')) {
                const box = target as HTMLInputElement;
                const id = Number(box.value);
                filter.stypeIds = box.checked
                    ? [...filter.stypeIds, id]
                    : filter.stypeIds.filter(x => x !== id);
                box.closest('.eo-chip')?.classList.toggle('on', box.checked);
                changed();
            } else if (target.matches('.rs-nation')) {
                const box = target as HTMLInputElement;
                const nation = box.value as Nation;
                filter.nations = box.checked
                    ? [...filter.nations, nation]
                    : filter.nations.filter(x => x !== nation);
                box.closest('.eo-chip')?.classList.toggle('on', box.checked);
                changed();
            } else if (target.matches('.rs-sally')) {
                const value = (target as HTMLSelectElement).value;
                filter.sallyArea = value === '' ? null : Number(value);
                changed();
            }
        });

        // 等級範圍用 input（邊打邊篩）；空字串＝不限，不要當成 0。
        const readRange = () => {
            const parse = (input: HTMLInputElement) => (input.value === '' ? null : Number(input.value));
            filter.lvMin = parse(q<HTMLInputElement>('.rs-lvmin'));
            filter.lvMax = parse(q<HTMLInputElement>('.rs-lvmax'));
            changed();
        };
        q<HTMLInputElement>('.rs-lvmin').addEventListener('input', readRange);
        q<HTMLInputElement>('.rs-lvmax').addEventListener('input', readRange);

        // chip 的 × ：清掉單一條件。艦種 chip 要順便把抽屜裡的勾拿掉，兩邊不能不同步。
        chipsEl.addEventListener('click', e => {
            const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.rs-chip');
            if (!chip) return;
            const key = chip.dataset.clear!;
            if (key === 'search') {
                filter.search = '';
                q<HTMLInputElement>('.rs-search').value = '';
            } else if (key.startsWith('stype:')) {
                const id = Number(key.slice(6));
                filter.stypeIds = filter.stypeIds.filter(x => x !== id);
                const box = drawerEl.querySelector<HTMLInputElement>(`.rs-stype[value="${id}"]`);
                if (box) { box.checked = false; box.closest('.eo-chip')?.classList.remove('on'); }
            } else if (key.startsWith('nation:')) {
                const nation = key.slice(7) as Nation;
                filter.nations = filter.nations.filter(x => x !== nation);
                const box = drawerEl.querySelector<HTMLInputElement>(`.rs-nation[value="${nation}"]`);
                if (box) { box.checked = false; box.closest('.eo-chip')?.classList.remove('on'); }
            } else if (key === 'lv') {
                filter.lvMin = filter.lvMax = null;
                q<HTMLInputElement>('.rs-lvmin').value = '';
                q<HTMLInputElement>('.rs-lvmax').value = '';
            } else if (key === 'sallyArea') {
                filter.sallyArea = null;
                sallyEl.value = '';
            } else {
                // 所有分段列的預設值都是 'all'（leng 由 applySeg 轉回 null）——**不可以**
                // 寫成 String(fresh[key])，那會讓 leng 拿到字串 'null' 再被 Number() 變成 NaN。
                applySeg(filter, key as keyof RosterFilter, 'all');
                const group = drawerEl.querySelector<HTMLElement>(`.rs-seg[data-f="${key}"]`);
                group?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === 'all'));
            }
            changed();
        });

        q<HTMLButtonElement>('.rs-reset').addEventListener('click', () => {
            Object.assign(filter, emptyRosterFilter());
            q<HTMLInputElement>('.rs-search').value = '';
            q<HTMLInputElement>('.rs-lvmin').value = '';
            q<HTMLInputElement>('.rs-lvmax').value = '';
            sallyEl.value = '';
            drawerEl.querySelectorAll<HTMLInputElement>('.rs-stype, .rs-nation').forEach(box => {
                box.checked = false;
                box.closest('.eo-chip')?.classList.remove('on');
            });
            drawerEl.querySelectorAll<HTMLElement>('.rs-seg').forEach(group =>
                group.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === 'all')));
            changed();
        });

        q<HTMLSelectElement>('.rs-size').addEventListener('change', e => {
            prefs.size = Number((e.currentTarget as HTMLSelectElement).value) as PageSize;
            savePrefs(prefs);
            changed();
        });

        q<HTMLInputElement>('.rs-bare').addEventListener('change', e => {
            prefs.bare = (e.currentTarget as HTMLInputElement).checked;
            savePrefs(prefs);
            draw();
        });

        el.querySelectorAll<HTMLInputElement>('.rs-col').forEach(box =>
            box.addEventListener('change', () => {
                // 保持 COLUMNS 的宣告順序，不要用使用者勾選的先後順序，否則欄位會亂跳。
                const checked = new Set([...el.querySelectorAll<HTMLInputElement>('.rs-col')]
                    .filter(b => b.checked).map(b => b.value as ColumnId));
                prefs.cols = COLUMNS.filter(c => checked.has(c.id)).map(c => c.id);
                savePrefs(prefs);
                draw();
            }));

        // 表頭排序：數值欄第一次點由大到小（想看的是「最強的是誰」），文字欄由小到大。
        tableEl.addEventListener('click', e => {
            const th = (e.target as HTMLElement).closest<HTMLElement>('.rs-th.sortable');
            if (!th) return;
            const key = th.dataset.sort as RosterSortKey;
            if (prefs.sort === key) prefs.dir = prefs.dir === 'asc' ? 'desc' : 'asc';
            else {
                prefs.sort = key;
                prefs.dir = COLUMNS.find(c => c.sort === key)?.numeric ? 'desc' : 'asc';
            }
            savePrefs(prefs);
            draw();
        });
        tableEl.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const th = (e.target as HTMLElement).closest<HTMLElement>('.rs-th.sortable');
            if (!th) return;
            e.preventDefault();
            th.click();
        });

        pagerEl.addEventListener('click', e => {
            const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.rs-page');
            if (!btn) return;
            page += btn.dataset.page === 'next' ? 1 : -1;
            draw();
        });

        // 匯出：目前**篩選後的全部**列（不是只有這一頁）＋目前顯示的欄位。
        q<HTMLButtonElement>('.rs-csv').addEventListener('click', () =>
            downloadText('kanmusu-list.csv', rosterCsv(visible, view(), renderCtx), 'text/csv'));
        q<HTMLButtonElement>('.rs-copy').addEventListener('click', e =>
            copyWithFeedback(e.currentTarget as HTMLButtonElement, rosterCsv(visible, view(), renderCtx), t('ov.rsCopied')));

        // 手填入手日：只寫 source='manual'——絕不可寫成 'auto'，那是「首見觀測」的證據標記，
        // utils/retention.ts firstOwnedDropKeys 只認 auto＋observedEventId 來判定「新船場」，
        // 手填值混進去會污染重播保留判定。同理不補 observedEventId（手填無事件序可依據）。
        tableEl.addEventListener('change', async e => {
            const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-ship-date]');
            if (!input) return;
            const shipId = Number(input.dataset.shipDate);
            const row = rows.find(s => s.id === shipId);
            if (!row) return;

            const sync = (ts: number | null, source: ShipObtainedRow['source']) => {
                row.obtained = { ...(row.obtained ?? { id: shipId, mst: row.masterId }), obtainedTs: ts, source };
                // roster 是 rows 的投影，日期改了要重新投影才會反映到排序（Joined 欄可排序）。
                roster = buildRoster(rows);
            };

            if (!input.value) {   // 清空＝取消手填，回到「未知」
                await db.shipObtained.update(shipId, { obtainedTs: null, source: null });
                sync(null, null);
                statusEl.textContent = t('ov.shipsDateCleared', { name: row.name });
                draw();
                return;
            }
            const debut = row.baseMst == null ? null : debutDateOf(row.baseMst);
            const err = validateObtainedDate(input.value, debut, toDateInputValue(Date.now()));
            if (err) {
                statusEl.textContent = t(err, { name: row.name, debut: debut ?? '' });
                input.value = row.obtained?.obtainedTs ? toDateInputValue(row.obtained.obtainedTs) : '';
                return;
            }
            // 以本機當日 12:00 存，避免時區換算把日期推移到前後一天。
            const ts = new Date(`${input.value}T12:00:00`).getTime();
            await db.shipObtained.put({ id: shipId, mst: row.masterId, obtainedTs: ts, source: 'manual' });
            sync(ts, 'manual');
            statusEl.textContent = t('ov.shipsDateSaved', { name: row.name, date: input.value });
            draw();
        });

        try {
            rows = await loadOwnedShipRows(ctx.state);
            if (!rows.length) {
                tableEl.innerHTML = `<div class="ov-empty">${esc(t('ov.shipsNone'))}</div>`;
                return;
            }
            roster = buildRoster(rows);
            stypeLabel.clear();
            for (const s of roster) if (!stypeLabel.has(s.stypeId)) stypeLabel.set(s.stypeId, s.stype);
            // 艦種／國籍／札選項依名冊填充（殼上先留空容器，避免 await 前整區空白）。
            const stypeOps = stypeChipsEl.querySelector('.rs-stype-ops')!;
            for (const id of stypeOptions(roster)) {
                stypeOps.insertAdjacentHTML('beforebegin',
                    `<label class="eo-chip"><input type="checkbox" class="rs-stype" value="${id}">${esc(stypeLabel.get(id) ?? String(id))}</label>`);
            }
            nationChipsEl.innerHTML = nationOptions(roster).map(o =>
                `<label class="eo-chip"><input type="checkbox" class="rs-nation" value="${o.nation}">${esc(t(`nation.${o.nation}`))}（${o.count}）</label>`).join('');
            sallyEl.innerHTML = [`<option value="">${esc(t('ov.spAll'))}</option>`]
                .concat(sallyOptions(roster).map(o =>
                    `<option value="${o.sallyArea}">${esc(o.sallyArea === 0 ? t('ov.spFree') : tagLabel(o.sallyArea))}（${o.count}）</option>`))
                .join('');
            draw();
        } catch (error) {
            tableEl.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
        }
    },
};
