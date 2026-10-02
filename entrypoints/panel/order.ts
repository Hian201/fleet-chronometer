// 調度／采配／Order 分頁：配船配裝用的快篩（不是情報總括的完整全覽）。
//
// 殼只建一次；篩選變更只重繪目標列＋表，避免整塊洗掉選取與捲動。
// 下拉選單以 position:fixed 掛 body，不被 #tabpanel overflow 裁切。
import type { GameState, OwnedShipView } from '@/utils/state';
import { nationOf, nationsOf, NATIONS, type Nation } from '@/utils/ship-nationality';
import {
    compareGameOrder, EQUIP_TYPE, matchEquip, matchSpeed, type EquipFilter, type SpeedFilter,
} from '@/utils/ship-filter';
import { SPARKLE_COND } from '@/utils/ship-roster';
import {
    addMembers, createGroup, deleteGroup, filterByGroup, loadOrderGroups, removeMembers,
    saveOrderGroups, type OrderGroup,
} from '@/utils/order-groups';
import { ORDER_GEAR_CATS, matchGearCat, resolveGearCatIds } from '@/utils/order-gear-cats';
import { matchOrderStype, ORDER_STYPE_GROUPS } from '@/utils/order-stype';
import {
    filterGears, groupGears, sortGears, type GearGroup, type GearSortKey,
} from '@/utils/gear-inventory';
import { esc } from '@/utils/html-escape';
import { t } from '@/utils/ui-i18n';

type Mode = 'ship' | 'gear';
/** 裝備表的呈現：素質欄，或改列裝備艦（收起素質欄、整表不需橫捲）。不影響篩選。 */
type GearView = 'stats' | 'holders';
type Amphib = 'all' | 'daihatsu' | 'naikatei' | 'either' | 'both';
type ShipSortKey =
    'name' | 'lv' | 'cond' | 'maxhp' | 'firepower' | 'torpedo' | 'aa' | 'armor'
    | 'asw' | 'evasion' | 'los' | 'luck';
type SortDir = 'asc' | 'desc';

interface ShipRow extends OwnedShipView {
    nation: Nation | null;
    nations: Nation[];
}

const AMPHIB_EQUIP: Record<Amphib, EquipFilter> = {
    all: 'all',
    daihatsu: 'landingCraft',
    naikatei: 'naikatei',
    either: 'either',
    both: 'both',
};

const SHIP_COLS: { key: ShipSortKey; labelKey: string }[] = [
    { key: 'name', labelKey: 'order.colName' },
    { key: 'lv', labelKey: 'order.colLv' },
    { key: 'cond', labelKey: 'order.colCond' },
    { key: 'maxhp', labelKey: 'order.colHp' },
    { key: 'firepower', labelKey: 'ov.rsColFire' },
    { key: 'torpedo', labelKey: 'ov.rsColTorp' },
    { key: 'aa', labelKey: 'ov.rsColAa' },
    { key: 'armor', labelKey: 'ov.rsColArmor' },
    { key: 'asw', labelKey: 'ov.rsColAsw' },
    { key: 'evasion', labelKey: 'ov.rsColEvasion' },
    { key: 'los', labelKey: 'ov.rsColLos' },
    { key: 'luck', labelKey: 'ov.rsColLuck' },
];

const GEAR_COLS: { key: GearSortKey; labelKey: string }[] = [
    { key: 'name', labelKey: 'order.colGear' },
    { key: 'count', labelKey: 'order.colCount' },
    { key: 'star', labelKey: 'order.colStar' },
    { key: 'houg', labelKey: 'ov.rsColFire' },
    { key: 'houm', labelKey: 'ov.eqColHoum' },
    { key: 'leng', labelKey: 'ov.rsLeng' },
    { key: 'houk', labelKey: 'ov.rsColEvasion' },
    { key: 'baku', labelKey: 'ov.eqColBaku' },
    { key: 'raig', labelKey: 'ov.rsColTorp' },
    { key: 'saku', labelKey: 'ov.rsColLos' },
    { key: 'tais', labelKey: 'ov.rsColAsw' },
    { key: 'tyku', labelKey: 'ov.rsColAa' },
    { key: 'souk', labelKey: 'ov.rsColArmor' },
];

// 裝備艦檢視：裝備、數量、閒置、裝備艦。裝備艦欄以裝備中顆數排序。
const HOLDER_COLS: { key: GearSortKey; labelKey: string; cls: string }[] = [
    { key: 'name', labelKey: 'order.colGear', cls: 'n' },
    { key: 'count', labelKey: 'order.colCount', cls: '' },
    { key: 'idle', labelKey: 'order.colIdle', cls: 'idle' },
    { key: 'equipped', labelKey: 'order.colHolders', cls: 'h' },
];

let root: HTMLElement | null = null;
let getState: (() => GameState) | null = null;
let shellReady = false;
let langToken = '';

let mode: Mode = 'ship';
let command = false;
let amphib: Amphib = 'all';
let nation: Nation | 'all' = 'all';
let stypeGroup = 'all';
let speed: SpeedFilter = 'all';
let groupFilter = 'all';
let groups: OrderGroup[] = loadOrderGroups();
const selected = new Set<number>();

let gearCat: string | null = null;
let gearSub = 'all';
let gearView: GearView = 'stats';
/** 素質檢視下展開裝備艦子列的裝備（master id）。表重繪時沿用。 */
const openGears = new Set<number>();

const shipSort = { key: 'lv' as ShipSortKey, dir: 'desc' as SortDir };
const gearSort = { key: 'count' as GearSortKey, dir: 'desc' as SortDir };

let menuEl: HTMLDivElement | null = null;
let openMenu: { kind: string; key: string; anchor: HTMLElement } | null = null;

export function mountOrder(el: HTMLElement, stateFn: () => GameState): void {
    root = el;
    getState = stateFn;
    ensureMenu();
    shellReady = false;
}

export function renderOrder(): void {
    if (!root || !getState) return;
    const token = t('tab.order') + t('order.modeShip');
    if (!shellReady || token !== langToken) {
        buildShell();
        langToken = token;
        shellReady = true;
    }
    paint();
}

function ensureMenu(): void {
    if (menuEl) return;
    menuEl = document.createElement('div');
    menuEl.className = 'od-menu';
    menuEl.hidden = true;
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', onMenuClick);
    document.addEventListener('click', e => {
        if (!openMenu) return;
        const node = e.target as Node;
        if (menuEl?.contains(node)) return;
        if ((e.target as HTMLElement).closest?.('[data-od-open]')) return;
        if ((e.target as HTMLElement).closest?.('#od-join')) return;
        closeMenu();
    });
    window.addEventListener('resize', closeMenu);
}

function buildShell(): void {
    if (!root) return;
    root.innerHTML = `
      <div class="od-top">
        <button type="button" class="od-mode" id="od-mode" data-mode="ship" aria-pressed="false">
          <span class="od-mode-thumb" id="od-mode-label"></span>
        </button>
        <div class="od-goals" id="od-goals"></div>
      </div>
      <div class="od-sel" id="od-sel" hidden>
        <span id="od-sel-label"></span>
        <button type="button" class="primary" id="od-join"></button>
        <button type="button" id="od-leave" hidden></button>
        <span class="grow"></span>
        <button type="button" id="od-clear"></button>
      </div>
      <div class="od-table-wrap" id="od-table"></div>`;
    root.querySelector('#od-mode')!.addEventListener('click', () => {
        mode = mode === 'ship' ? 'gear' : 'ship';
        if (mode === 'gear') selected.clear();
        closeMenu();
        paint();
    });
    root.querySelector('#od-goals')!.addEventListener('click', onGoalsClick);
    root.querySelector('#od-goals')!.addEventListener('scroll', closeMenu);
    root.querySelector('#od-join')!.addEventListener('click', e => {
        e.stopPropagation();
        const btn = e.currentTarget as HTMLElement;
        if (openMenu?.kind === 'gadd') closeMenu();
        else openAddGroupMenu(btn);
    });
    // 組別篩選開啟時才露出：把選取艦從「目前這組」剔除（不是清選取）。
    root.querySelector('#od-leave')!.addEventListener('click', () => {
        if (groupFilter === 'all' || selected.size === 0) return;
        groups = removeMembers(groups, groupFilter, selected);
        saveOrderGroups(groups);
        selected.clear();
        closeMenu();
        paint();
    });
    root.querySelector('#od-clear')!.addEventListener('click', () => {
        selected.clear();
        paint();
    });
    root.querySelector('#od-table')!.addEventListener('click', onTableClick);
}

function paint(): void {
    if (!root || !getState) return;
    const modeBtn = root.querySelector('#od-mode') as HTMLButtonElement;
    const isShip = mode === 'ship';
    modeBtn.dataset.mode = mode;
    modeBtn.setAttribute('aria-pressed', isShip ? 'false' : 'true');
    modeBtn.setAttribute(
        'aria-label',
        `${t('order.modeShip')}／${t('order.modeGear')}：${isShip ? t('order.modeShip') : t('order.modeGear')}`,
    );
    (root.querySelector('#od-mode-label') as HTMLElement).textContent =
        isShip ? t('order.modeShip') : t('order.modeGear');
    paintGoals();
    paintTable();
    paintSelBar();
}

function paintGoals(): void {
    const el = root!.querySelector('#od-goals')!;
    const parts: string[] = [];
    if (mode === 'ship') {
        parts.push(pill('command', t('order.command'), command));
        parts.push(ddBtn('amphib', amphibLabel(), amphib !== 'all'));
        parts.push(ddBtn('nation', nation === 'all' ? t('order.nation') : t(`nation.${nation}`), nation !== 'all'));
        parts.push(ddBtn('stype', stypeLabel(), stypeGroup !== 'all'));
        parts.push(ddBtn('speed', speedLabel(), speed !== 'all'));
        parts.push(ddBtn('group', groupLabel(), groupFilter !== 'all'));
    } else {
        parts.push(`<button type="button" class="od-pill ${gearView === 'holders' ? 'on' : ''}" data-toggle="gearView" aria-pressed="${gearView === 'holders'}" title="${esc(t('order.viewHoldersTitle'))}">${esc(t('order.viewHolders'))}</button>`);
        for (const c of ORDER_GEAR_CATS) {
            const on = gearCat === c.id;
            let lab = t(c.labelKey);
            if (on && gearSub !== 'all') {
                const sub = c.subs.find(s => s.id === gearSub);
                if (sub) lab = t(sub.labelKey);
            }
            parts.push(`<button type="button" class="od-dd-btn ${on ? 'on' : ''}" data-od-open="gcat" data-gcat="${esc(c.id)}">${esc(lab)}</button>`);
        }
    }
    el.innerHTML = parts.join('');
}

function pill(id: string, label: string, on: boolean): string {
    return `<button type="button" class="od-pill ${on ? 'on' : ''}" data-toggle="${esc(id)}">${esc(label)}</button>`;
}
function ddBtn(key: string, label: string, on: boolean): string {
    return `<button type="button" class="od-dd-btn ${on ? 'on' : ''}" data-od-open="${esc(key)}">${esc(label)}</button>`;
}

function amphibLabel(): string {
    if (amphib === 'all') return t('order.amphib');
    const map: Record<Amphib, string> = {
        all: 'order.amphib',
        daihatsu: 'order.amphibDaihatsu',
        naikatei: 'order.amphibNaikatei',
        either: 'order.amphibEither',
        both: 'order.amphibBoth',
    };
    return t(map[amphib]);
}
function stypeLabel(): string {
    if (stypeGroup === 'all') return t('order.stype');
    return ORDER_STYPE_GROUPS.find(g => g.id === stypeGroup)?.label ?? t('order.stype');
}
function speedLabel(): string {
    if (speed === 'all') return t('order.speed');
    if (speed === 'fast') return t('order.speedFast');
    if (speed === 'slow') return t('order.speedSlow');
    return t('order.speed');
}
function groupLabel(): string {
    if (groupFilter === 'all') return t('order.group');
    return groups.find(g => g.id === groupFilter)?.name ?? t('order.group');
}

function paintSelBar(): void {
    const bar = root!.querySelector('#od-sel') as HTMLElement;
    const show = mode === 'ship' && selected.size > 0;
    bar.hidden = !show;
    if (!show) return;
    root!.querySelector('#od-sel-label')!.innerHTML =
        `${esc(t('order.selected'))} <span class="n">${selected.size}</span>`;
    (root!.querySelector('#od-join') as HTMLButtonElement).textContent = `${t('order.join')} ▾`;
    const leaveBtn = root!.querySelector('#od-leave') as HTMLButtonElement;
    const canLeave = groupFilter !== 'all';
    leaveBtn.hidden = !canLeave;
    leaveBtn.textContent = t('order.leave');
    (root!.querySelector('#od-clear') as HTMLButtonElement).textContent = t('order.clear');
}

function shipRows(): ShipRow[] {
    const state = getState!();
    let rows: ShipRow[] = state.ownedShips().map(s => ({
        ...s, nation: nationOf(s.ctype), nations: nationsOf(s.masterId, s.ctype),
    }));
    rows = rows.filter(s => {
        if (!matchSpeed(s.soku, speed)) return false;
        if (!matchOrderStype(s.stypeId, stypeGroup)) return false;
        if (nation !== 'all' && !s.nations.includes(nation)) return false;
        if (!matchEquip(s.equipTypes, AMPHIB_EQUIP[amphib])) return false;
        if (command && !s.equipTypes.includes(EQUIP_TYPE.commandFacility)) return false;
        return true;
    });
    if (groupFilter !== 'all') rows = filterByGroup(rows, groups, groupFilter);
    return sortShips(rows);
}

function sortShips(rows: ShipRow[]): ShipRow[] {
    const { key, dir } = shipSort;
    const zeroLast = key !== 'name' && key !== 'lv' && key !== 'cond' && key !== 'maxhp';
    return [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (key === 'name') { av = a.name; bv = b.name; }
        else if (key === 'lv') { av = a.lv; bv = b.lv; }
        else if (key === 'cond') { av = a.cond; bv = b.cond; }
        else if (key === 'maxhp') { av = a.maxhp; bv = b.maxhp; }
        else { av = a.stats[key]; bv = b.stats[key]; }
        if (zeroLast) {
            const aE = av === 0, bE = bv === 0;
            if (aE !== bE) return aE ? 1 : -1;
        }
        const c = typeof av === 'string'
            ? av.localeCompare(String(bv), undefined, { sensitivity: 'base' })
            : (av as number) - (bv as number);
        // 同值次序對齊遊戲；反向排序時整串反轉（見 compareGameOrder）。名稱的自然方向是 asc。
        const gameDir: SortDir = key === 'name' ? (dir === 'asc' ? 'desc' : 'asc') : dir;
        return (dir === 'asc' ? c : -c) || compareGameOrder(a, b, gameDir);
    });
}

function gearRows(): GearGroup[] {
    const state = getState!();
    const groupsAll = groupGears(state.ownedGears());
    const allowed = resolveGearCatIds(gearCat, gearSub);
    const filtered = filterGears(groupsAll, {
        search: '', icons: [], usage: 'all', improve: 'all', consumable: 'all',
    }).filter(g => matchGearCat(g.catId, allowed));
    return sortGears(filtered, gearSort.key, gearSort.dir);
}

function paintTable(): void {
    const wrap = root!.querySelector('#od-table')!;
    const scrollTop = wrap.scrollTop;
    const scrollLeft = wrap.scrollLeft;
    const state = getState!();
    const restoreScroll = () => {
        wrap.scrollTop = scrollTop;
        wrap.scrollLeft = scrollLeft;
    };
    if (mode === 'ship') {
        if (state.ships.size === 0) {
            wrap.innerHTML = `<div class="od-empty">${esc(t('order.noneLoaded'))}</div>`;
            return;
        }
        const rows = shipRows();
        if (!rows.length) {
            wrap.innerHTML = `<div class="od-empty">${esc(t('order.empty'))}</div>`;
            return;
        }
        const head = SHIP_COLS.map(c => sortHead(c.key, c.labelKey, c.key === 'name' ? 'n' : '')).join('');
        const body = rows.map(s => {
            const picked = selected.has(s.id);
            const condCls = s.cond >= SPARKLE_COND ? 'cond-spark'
                : s.cond < 20 ? 'cond-red' : s.cond < 30 ? 'cond-tired' : '';
            const fleet = s.fleetNo != null ? 'in-fleet' : '';
            return `<tr class="${fleet} ${picked ? 'picked' : ''}">
              <td class="n" data-pick="${s.id}" title="${esc(state.shipNameJa(s.masterId))}">${esc(s.name)}</td>
              <td>${s.lv}</td>
              <td class="${condCls}">${s.cond}</td>
              <td>${s.maxhp}</td>
              <td>${s.stats.firepower}</td>
              <td>${statOrDot(s.stats.torpedo)}</td>
              <td>${s.stats.aa}</td>
              <td>${s.stats.armor}</td>
              <td>${statOrDot(s.stats.asw)}</td>
              <td>${s.stats.evasion}</td>
              <td>${s.stats.los}</td>
              <td>${s.stats.luck}</td>
            </tr>`;
        }).join('');
        wrap.innerHTML = `<table class="od"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
        restoreScroll();
    } else {
        if (state.slotItems.size === 0) {
            wrap.innerHTML = `<div class="od-empty">${esc(t('order.noneLoaded'))}</div>`;
            return;
        }
        const rows = gearRows();
        if (!rows.length) {
            wrap.innerHTML = `<div class="od-empty">${esc(t('order.empty'))}</div>`;
            return;
        }
        if (gearView === 'holders') {
            wrap.innerHTML = holderTable(rows);
            restoreScroll();
            return;
        }
        const head = GEAR_COLS.map(c => sortHead(c.key, c.labelKey, c.key === 'name' ? 'n' : '')).join('');
        const body = rows.map(g => {
            const open = openGears.has(g.mst);
            const row = `<tr class="${open ? 'open' : ''}">
          <td class="n"><button type="button" class="od-gear" data-gear="${g.mst}" title="${esc(state.gearNameJa(g.mst))}" aria-expanded="${open}"><span class="od-tw" aria-hidden="true">${open ? '▼' : '▶'}</span>${esc(g.name)}</button></td>
          <td><b>${g.count}</b></td>
          <td>${g.maxLevel ? '★' + g.maxLevel : '<span class="zero">·</span>'}</td>
          <td>${statOrDot(g.stats.houg)}</td>
          <td>${statOrDot(g.stats.houm)}</td>
          <td>${lengLabel(g.stats.leng)}</td>
          <td>${statOrDot(g.stats.houk)}</td>
          <td>${statOrDot(g.stats.baku)}</td>
          <td>${statOrDot(g.stats.raig)}</td>
          <td>${statOrDot(g.stats.saku)}</td>
          <td>${statOrDot(g.stats.tais)}</td>
          <td>${statOrDot(g.stats.tyku)}</td>
          <td>${statOrDot(g.stats.souk)}</td>
        </tr>`;
            // 子列內容 sticky 在可視寬度內：表橫捲時裝備艦清單不跟著捲走。
            return open
                ? row + `<tr class="od-hold"><td colspan="${GEAR_COLS.length}"><div class="od-hold-in">${holderChips(g)}</div></td></tr>`
                : row;
        }).join('');
        wrap.innerHTML = `<table class="od"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
        restoreScroll();
    }
}

function sortHead(key: GearSortKey | ShipSortKey, labelKey: string, cls: string): string {
    const sort = mode === 'ship' ? shipSort : gearSort;
    const on = sort.key === key;
    const arrow = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
    return `<th class="${cls} ${on ? 'on' : ''}" data-sort="${key}"><span class="od-head"><span class="od-label">${esc(t(labelKey))}</span><span class="od-arrow" aria-hidden="true">${arrow}</span></span></th>`;
}

function holderTable(rows: GearGroup[]): string {
    const head = HOLDER_COLS.map(c => sortHead(c.key, c.labelKey, c.cls)).join('');
    const state = getState!();
    const body = rows.map(g => `<tr>
          <td class="n" title="${esc(state.gearNameJa(g.mst))}">${esc(g.name)}</td>
          <td><b>${g.count}</b></td>
          <td>${statOrDot(g.idle)}</td>
          <td class="h" title="${esc(holderTitle(g))}">${holderChips(g, false)}</td>
        </tr>`).join('');
    return `<table class="od od-hv"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** 裝備艦標籤；showIdle＝末尾補「閒置 N」（裝備艦檢視已有閒置欄，不重複）。 */
function holderChips(g: GearGroup, showIdle = true): string {
    const chips = g.holders.map(h => {
        const exTag = h.ex === 0 ? ''
            : `<span class="od-hc-ex">${esc(t('order.ex'))}${h.ex < h.count ? h.ex : ''}</span>`;
        return `<span class="od-hc ${h.kind === 'lbas' ? 'lbas' : ''}">${esc(h.name)}${h.count > 1 ? `<span class="x">×${h.count}</span>` : ''}${exTag}</span>`;
    });
    if (!g.holders.length) chips.push(`<span class="od-hc idle">${esc(t('order.allIdle'))}</span>`);
    else if (showIdle && g.idle > 0) chips.push(`<span class="od-hc idle">${esc(t('order.idleN', { n: g.idle }))}</span>`);
    return `<div class="od-hc-list">${chips.join('')}</div>`;
}

/** 裝備艦欄的純文字版，供 title 與複製用。 */
function holderTitle(g: GearGroup): string {
    if (!g.holders.length) return t('order.allIdle');
    return g.holders.map(h => {
        const ex = h.ex ? `（${t('order.ex')}${h.ex < h.count ? h.ex : ''}）` : '';
        return `${h.name}${h.count > 1 ? `×${h.count}` : ''}${ex}`;
    }).join('、');
}

function statOrDot(n: number): string {
    return n ? String(n) : '<span class="zero">·</span>';
}
function lengLabel(leng: number): string {
    if (!leng) return '<span class="zero">·</span>';
    const keys = ['', 'ov.rsLengShort', 'ov.rsLengMedium', 'ov.rsLengLong', 'ov.rsLengVeryLong'];
    return esc(t(keys[leng] ?? 'ov.rsLeng'));
}

function onGoalsClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!btn) return;
    if (btn.dataset.toggle) {
        if (btn.dataset.toggle === 'command') command = !command;
        else if (btn.dataset.toggle === 'gearView') gearView = gearView === 'stats' ? 'holders' : 'stats';
        paint();
        return;
    }
    const open = btn.dataset.odOpen;
    if (!open) return;
    e.stopPropagation();
    if (openMenu && openMenu.kind === open && openMenu.key === (btn.dataset.gcat ?? open)) {
        closeMenu();
        return;
    }
    if (open === 'amphib') openAmphibMenu(btn);
    else if (open === 'nation') openNationMenu(btn);
    else if (open === 'stype') openStypeMenu(btn);
    else if (open === 'speed') openSpeedMenu(btn);
    else if (open === 'group') openGroupFilterMenu(btn);
    else if (open === 'gcat' && btn.dataset.gcat) openGearCatMenu(btn.dataset.gcat, btn);
}

function onTableClick(e: Event): void {
    const gear = (e.target as HTMLElement).closest('[data-gear]') as HTMLElement | null;
    if (gear) {
        const mst = Number(gear.dataset.gear);
        if (openGears.has(mst)) openGears.delete(mst); else openGears.add(mst);
        paintTable();
        return;
    }
    const pick = (e.target as HTMLElement).closest('[data-pick]') as HTMLElement | null;
    if (pick) {
        const id = Number(pick.dataset.pick);
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        // 只重繪表＋選取列，保留捲動位置與目標列。
        paintTable();
        paintSelBar();
        return;
    }
    const th = (e.target as HTMLElement).closest('th[data-sort]') as HTMLElement | null;
    if (!th) return;
    const key = th.dataset.sort!;
    if (mode === 'ship') {
        const k = key as ShipSortKey;
        if (shipSort.key === k) shipSort.dir = shipSort.dir === 'asc' ? 'desc' : 'asc';
        else { shipSort.key = k; shipSort.dir = k === 'name' ? 'asc' : 'desc'; }
    } else {
        const k = key as GearSortKey;
        if (gearSort.key === k) gearSort.dir = gearSort.dir === 'asc' ? 'desc' : 'asc';
        else { gearSort.key = k; gearSort.dir = k === 'name' ? 'asc' : 'desc'; }
    }
    paintTable();
}

function placeMenu(anchor: HTMLElement): void {
    if (!menuEl) return;
    menuEl.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pad = 4;
    const mw = menuEl.offsetWidth;
    const mh = menuEl.offsetHeight;
    let left = r.left;
    let top = r.bottom + pad;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - pad);
    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;
}

function closeMenu(): void {
    openMenu = null;
    if (menuEl) { menuEl.hidden = true; menuEl.innerHTML = ''; }
}

function menuButtons(items: { v: string; lab: string; on: boolean; attr: string }[]): string {
    return items.map(i =>
        `<button type="button" ${i.attr}="${esc(i.v)}" class="${i.on ? 'on' : ''}">${esc(i.lab)}</button>`
    ).join('');
}

function openAmphibMenu(anchor: HTMLElement): void {
    const opts: [Amphib, string][] = [
        ['all', t('order.all')],
        ['daihatsu', t('order.amphibDaihatsu')],
        ['naikatei', t('order.amphibNaikatei')],
        ['either', t('order.amphibEither')],
        ['both', t('order.amphibBoth')],
    ];
    menuEl!.innerHTML = menuButtons(opts.map(([v, lab]) => ({
        v, lab, on: amphib === v, attr: 'data-amphib',
    })));
    openMenu = { kind: 'amphib', key: 'amphib', anchor };
    placeMenu(anchor);
}

function openNationMenu(anchor: HTMLElement): void {
    const opts = [
        { v: 'all', lab: t('order.all'), on: nation === 'all', attr: 'data-nation' },
        ...NATIONS.map(n => ({
            v: n, lab: t(`nation.${n}`), on: nation === n, attr: 'data-nation',
        })),
    ];
    menuEl!.innerHTML = menuButtons(opts);
    openMenu = { kind: 'nation', key: 'nation', anchor };
    placeMenu(anchor);
}

function openStypeMenu(anchor: HTMLElement): void {
    const opts = [
        { v: 'all', lab: t('order.all'), on: stypeGroup === 'all', attr: 'data-stype' },
        ...ORDER_STYPE_GROUPS.map(g => ({
            v: g.id, lab: g.label, on: stypeGroup === g.id, attr: 'data-stype',
        })),
    ];
    menuEl!.innerHTML = menuButtons(opts);
    openMenu = { kind: 'stype', key: 'stype', anchor };
    placeMenu(anchor);
}

function openSpeedMenu(anchor: HTMLElement): void {
    const opts: { v: SpeedFilter; lab: string }[] = [
        { v: 'all', lab: t('order.all') },
        { v: 'fast', lab: t('order.speedFast') },
        { v: 'slow', lab: t('order.speedSlow') },
    ];
    menuEl!.innerHTML = menuButtons(opts.map(o => ({
        v: o.v, lab: o.lab, on: speed === o.v, attr: 'data-speed',
    })));
    openMenu = { kind: 'speed', key: 'speed', anchor };
    placeMenu(anchor);
}

function openGroupFilterMenu(anchor: HTMLElement): void {
    let html = `<button type="button" data-gfilter="all" class="${groupFilter === 'all' ? 'on' : ''}">${esc(t('order.all'))}</button>`;
    if (!groups.length) html += `<div class="subhead">${esc(t('order.groupEmpty'))}</div>`;
    else {
        html += groups.map(g => `
          <div class="row">
            <button type="button" class="pick ${groupFilter === g.id ? 'on' : ''}" data-gfilter="${esc(g.id)}">
              ${esc(g.name)}<span class="meta">${g.memberIds.length}</span>
            </button>
            <button type="button" class="x" data-gdel="${esc(g.id)}" title="×">×</button>
          </div>`).join('');
    }
    menuEl!.innerHTML = html;
    openMenu = { kind: 'group', key: 'group', anchor };
    placeMenu(anchor);
}

function openAddGroupMenu(anchor: HTMLElement): void {
    let html = `<div class="subhead">${esc(t('order.groupAdd'))}</div>`;
    if (!groups.length) html += `<div class="subhead">${esc(t('order.groupEmpty'))}</div>`;
    else {
        html += groups.map(g =>
            `<button type="button" data-gadd="${esc(g.id)}">${esc(g.name)}<span class="meta">${g.memberIds.length}</span></button>`
        ).join('');
    }
    html += `<div class="sep"></div><button type="button" data-gnew="1">${esc(t('order.groupNew'))}</button>`;
    menuEl!.innerHTML = html;
    openMenu = { kind: 'gadd', key: 'add', anchor };
    placeMenu(anchor);
}

function openGearCatMenu(catId: string, anchor: HTMLElement): void {
    const c = ORDER_GEAR_CATS.find(x => x.id === catId);
    if (!c) return;
    const active = gearCat === catId;
    let html = `<div class="subhead">${esc(t(c.labelKey))}</div>`;
    html += `<button type="button" data-gcat-pick="${esc(catId)}" data-gsub="all" class="${active && gearSub === 'all' ? 'on' : ''}">${esc(t('order.all'))}</button>`;
    html += c.subs.map(s =>
        `<button type="button" data-gcat-pick="${esc(catId)}" data-gsub="${esc(s.id)}" class="${active && gearSub === s.id ? 'on' : ''}">${esc(t(s.labelKey))}</button>`
    ).join('');
    menuEl!.innerHTML = html;
    openMenu = { kind: 'gcat', key: catId, anchor };
    placeMenu(anchor);
}

function onMenuClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!btn) return;
    if (btn.dataset.amphib != null) {
        amphib = btn.dataset.amphib as Amphib;
        closeMenu(); paint(); return;
    }
    if (btn.dataset.nation != null) {
        nation = btn.dataset.nation === 'all' ? 'all' : btn.dataset.nation as Nation;
        closeMenu(); paint(); return;
    }
    if (btn.dataset.stype != null) {
        stypeGroup = btn.dataset.stype;
        closeMenu(); paint(); return;
    }
    if (btn.dataset.speed != null) {
        speed = btn.dataset.speed as SpeedFilter;
        closeMenu(); paint(); return;
    }
    if (btn.dataset.gdel) {
        groups = deleteGroup(groups, btn.dataset.gdel);
        if (groupFilter === btn.dataset.gdel) groupFilter = 'all';
        saveOrderGroups(groups);
        closeMenu(); paint(); return;
    }
    if (btn.dataset.gfilter != null) {
        groupFilter = btn.dataset.gfilter;
        closeMenu(); paint(); return;
    }
    if (btn.dataset.gadd) {
        groups = addMembers(groups, btn.dataset.gadd, selected);
        saveOrderGroups(groups);
        selected.clear();
        closeMenu(); paint(); return;
    }
    if (btn.dataset.gnew) {
        const name = (prompt(t('order.groupPrompt')) || '').trim();
        const result = createGroup(groups, name, selected);
        if ('error' in result) {
            if (result.error === 'exists') alert(t('order.groupExists'));
            return;
        }
        groups = result.groups;
        groupFilter = result.id;
        saveOrderGroups(groups);
        selected.clear();
        closeMenu(); paint(); return;
    }
    if (btn.dataset.gcatPick) {
        gearCat = btn.dataset.gcatPick;
        gearSub = btn.dataset.gsub || 'all';
        closeMenu(); paint();
    }
}
