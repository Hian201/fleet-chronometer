// 鎮守府全船篩選清單（共用 UI 元件）。篩選邏輯在 utils/ship-filter.ts（純函式、node 已驗證），
// 這裡只負責 DOM 與事件。目前由「活動作戰板」使用，「艦娘全覽」之後接同一支。
//
// ── 為什麼這支不遵守「全量重繪」慣例（design-guidelines §4.2）──────────
// 篩選器含一個關鍵字輸入框。若沿用「任何變更就整塊重繪」，每打一個字元都會重建 DOM、
// 輸入框失焦，實際上打不了字。故本元件把「篩選器控制項」與「結果清單」分開：控制項只在
// 建立時渲染一次並綁定，之後的變更**只重繪 `.sp-list` 與計數**。這是刻意的例外，
// 不是疏漏——改回全量重繪會直接讓搜尋框不能用。
import type { OwnedShipView } from '@/utils/state';
import {
    emptyFilter, filterShips, nationOptions, sallyOptions, stypeOptions,
    type EquipFilter, type ShipFilterState, type ShipSortKey, type SpeedFilter,
} from '@/utils/ship-filter';
import { nationOf, type Nation } from '@/utils/ship-nationality';
import { t } from '@/utils/ui-i18n';
import { esc, gearIconHtml } from './lib';

const SPEEDS: SpeedFilter[] = ['all', 'slow', 'fast', 'fastPlus'];
const SPEED_KEYS: Record<SpeedFilter, string> = {
    all: 'ov.spAll', slow: 'ov.spSlow', fast: 'ov.spFast', fastPlus: 'ov.spFastPlus',
};
const EQUIPS: EquipFilter[] = [
    'all', 'landingCraft', 'landingOnly', 'naikatei', 'naikateiOnly',
    'both', 'either', 'neither', 'commandFacility', 'seaplaneFighter',
];
const EQUIP_KEYS: Record<EquipFilter, string> = {
    all: 'ov.spAll',
    landingCraft: 'ov.spLandingCraft',
    landingOnly: 'ov.spLandingOnly',
    naikatei: 'ov.spNaikatei',
    naikateiOnly: 'ov.spNaikateiOnly',
    both: 'ov.spBoth',
    either: 'ov.spEither',
    neither: 'ov.spNeither',
    commandFacility: 'ov.spCommandFacility',
    seaplaneFighter: 'ov.spSeaplaneFighter',
};
const SORTS: ShipSortKey[] = ['level', 'stype', 'name'];
const SORT_KEYS: Record<ShipSortKey, string> = {
    level: 'ov.spSortLevel', stype: 'ov.spSortStype', name: 'ov.spSortName',
};

/** 裝備欄的顯示開關（使用者列的「裝備：包含數值／顯示圖示／補強增設」）。 */
interface GearDisplay { icons: boolean; stars: boolean; exSlot: boolean; }

export interface ShipPickerOptions {
    ships: OwnedShipView[];
    /** 標籤的顯示名（0＝自由身時呼叫端可回傳「──」之類）。 */
    tagLabel(sallyArea: number): string;
    /** 點擊某艘艦。未提供則清單為純瀏覽。 */
    onPick?(ship: OwnedShipView): void;
    /** 已被選入編成的艦（清單上標示，避免重複加）。 */
    pickedIds?: Set<number>;
    /** 沒有可加入的目標時顯示的提示（例：尚未選擇關卡）。 */
    pickHint?: string;
    /**
     * 額外要列進「出擊標籤」下拉的標籤 id（即使目前沒有任何船帶著它）。
     * 用於作戰板手動宣告、但遊戲裡還沒產生的標籤——否則使用者建了標籤卻在下拉找不到，
     * 會誤以為壞掉（實際回報過）。
     */
    extraSallyTags?: number[];
    /**
     * 已被排進計畫（任一關卡）的艦。提供時才會出現「計畫」篩選。
     * 排表時最常問的其實是「還有誰沒排」，而那**不等於**「無標籤」——標籤要出擊才會貼上。
     */
    plannedIds?: Set<number>;
}

export interface ShipPickerHandle {
    /** 外部資料變更後更新清單（標籤改名、編成增刪…）。不重建篩選器，故不影響輸入焦點。 */
    refresh(patch?: Partial<Pick<ShipPickerOptions,
        'ships' | 'pickedIds' | 'pickHint' | 'extraSallyTags' | 'plannedIds'>>): void;
}

type PlanFilter = 'all' | 'yes' | 'no';

/**
 * 清單列＝艦娘 view ＋ 國籍。國籍**刻意不放進 `OwnedShipView`**：它不是封包事實，而是
 * `ship-nationality.ts` 的人工參照表查出來的（遊戲 API 不提供國籍），把它塞進 state 的
 * view 會讓「封包事實」與「參照資料」混在同一層。同 ship-roster.ts 的作法。
 */
type PickerShip = OwnedShipView & { nation: Nation | null };

const option = (value: string, label: string, selected: boolean) =>
    `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

export function renderShipPicker(el: HTMLElement, options: ShipPickerOptions): ShipPickerHandle {
    let opts = options;
    let rows: PickerShip[] = options.ships.map(s => ({ ...s, nation: nationOf(s.ctype) }));
    const filter: ShipFilterState = emptyFilter();
    let sort: ShipSortKey = 'level';
    let planned: PlanFilter = 'all';
    const gear: GearDisplay = { icons: false, stars: false, exSlot: false };

    // 艦種選項只列名冊裡實際有的，並用該艦種第一艘的 stype 字串當顯示名
    // （OwnedShipView 已帶解析好的艦種名，不需要另外開 master 查詢 API）。
    // 內容在 drawStypeOptions() 重建——refresh({ ships }) 也會走同一支。
    const stypeLabel = new Map<number, string>();

    el.innerHTML = `
        <div class="sp">
            <div class="sp-filters">
                <label class="sp-f"><span>${esc(t('ov.spSpeed'))}</span>
                    <select class="sp-speed">${SPEEDS.map(v => option(v, t(SPEED_KEYS[v]), v === 'all')).join('')}</select></label>
                <label class="sp-f"><span>${esc(t('ov.spEquip'))}</span>
                    <select class="sp-equip">${EQUIPS.map(v => option(v, t(EQUIP_KEYS[v]), v === 'all')).join('')}</select></label>
                <label class="sp-f"><span>${esc(t('ov.spSally'))}</span>
                    <select class="sp-sally"></select></label>
                <label class="sp-f" ${opts.plannedIds ? '' : 'hidden'}><span>${esc(t('ov.spPlanned'))}</span>
                    <select class="sp-planned">
                        ${option('all', t('ov.spAll'), true)}
                        ${option('yes', t('ov.spPlannedYes'), false)}
                        ${option('no', t('ov.spPlannedNo'), false)}
                    </select></label>
                <label class="sp-f"><span>${esc(t('ov.spSort'))}</span>
                    <select class="sp-sort">${SORTS.map(v => option(v, t(SORT_KEYS[v]), v === 'level')).join('')}</select></label>
                <input class="sp-search" placeholder="${esc(t('ov.spSearch'))}">
                <details class="sp-nations">
                    <summary>${esc(t('ov.spNation'))}</summary>
                    <div class="sp-stype-chips sp-nation-chips"></div>
                </details>
                <details class="sp-stypes">
                    <summary>${esc(t('ov.spStype'))}</summary>
                    <div class="sp-stype-chips sp-stype-box"></div>
                </details>
                <details class="sp-gears">
                    <summary>${esc(t('ov.spGearDisplay'))}</summary>
                    <div class="sp-stype-chips">
                        <label class="eo-chip"><input type="checkbox" class="sp-g-icons">${esc(t('ov.spGearIcons'))}</label>
                        <label class="eo-chip"><input type="checkbox" class="sp-g-stars">${esc(t('ov.spGearStars'))}</label>
                        <label class="eo-chip"><input type="checkbox" class="sp-g-ex">${esc(t('ov.spGearEx'))}</label>
                    </div>
                </details>
            </div>
            <div class="sp-count"></div>
            <div class="sp-hint"></div>
            <ul class="sp-list"></ul>
        </div>`;

    const listEl = el.querySelector<HTMLUListElement>('.sp-list')!;
    const countEl = el.querySelector<HTMLDivElement>('.sp-count')!;
    const hintEl = el.querySelector<HTMLDivElement>('.sp-hint')!;
    const sallySel = el.querySelector<HTMLSelectElement>('.sp-sally')!;
    const nationBox = el.querySelector<HTMLDivElement>('.sp-nation-chips')!;
    const stypeBox = el.querySelector<HTMLDivElement>('.sp-stype-box')!;

    function rebuildStypeLabels() {
        stypeLabel.clear();
        for (const s of rows) if (!stypeLabel.has(s.stypeId)) stypeLabel.set(s.stypeId, s.stype);
    }

    /** 只列名冊裡實際有船的國籍——沒有船的國家排出來只是雜訊（同艦種篩選的規則）。 */
    function drawNationOptions() {
        nationBox.innerHTML = nationOptions(rows).map(o =>
            `<label class="eo-chip ${filter.nations.includes(o.nation) ? 'on' : ''}">
                <input type="checkbox" class="sp-nation" value="${o.nation}"
                    ${filter.nations.includes(o.nation) ? 'checked' : ''}>${
                esc(t(`nation.${o.nation}`))}<span class="dim">${o.count}</span></label>`).join('');
        nationBox.querySelectorAll<HTMLInputElement>('.sp-nation').forEach(box =>
            box.addEventListener('change', () => {
                const n = box.value as Nation;
                filter.nations = box.checked
                    ? [...filter.nations, n]
                    : filter.nations.filter(x => x !== n);
                box.closest('.eo-chip')?.classList.toggle('on', box.checked);
                drawList();
            }));
    }

    /** 艦種 checkbox 隨 refresh({ ships }) 重建；勾選狀態在仍存在的艦種上保留。 */
    function drawStypeOptions() {
        rebuildStypeLabels();
        const available = new Set(stypeOptions(rows));
        filter.stypeIds = filter.stypeIds.filter(id => available.has(id));
        stypeBox.innerHTML = [...available].map(id =>
            `<label class="eo-chip ${filter.stypeIds.includes(id) ? 'on' : ''}">
                <input type="checkbox" class="sp-stype" value="${id}"
                    ${filter.stypeIds.includes(id) ? 'checked' : ''}>${
                esc(stypeLabel.get(id) ?? String(id))}</label>`).join('');
        stypeBox.querySelectorAll<HTMLInputElement>('.sp-stype').forEach(box =>
            box.addEventListener('change', () => {
                const id = Number(box.value);
                filter.stypeIds = box.checked
                    ? [...filter.stypeIds, id]
                    : filter.stypeIds.filter(x => x !== id);
                box.closest('.eo-chip')?.classList.toggle('on', box.checked);
                drawList();
            }));
    }

    function drawSallyOptions() {
        const prev = filter.sallyArea;
        // 實際有船的標籤 ∪ 呼叫端宣告的標籤（後者可能 0 艘，仍要列出，見 extraSallyTags）
        const counts = new Map(sallyOptions(rows).map(o => [o.sallyArea, o.count]));
        for (const id of opts.extraSallyTags ?? []) if (!counts.has(id)) counts.set(id, 0);
        const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
        sallySel.innerHTML = [option('', t('ov.spAll'), prev == null)]
            .concat(entries.map(([id, count]) => option(
                String(id),
                `${id === 0 ? t('ov.spFree') : opts.tagLabel(id)}（${count}）`,
                prev === id)))
            .join('');
    }

    function gearHtml(ship: OwnedShipView): string {
        if (!gear.icons && !gear.stars && !gear.exSlot) return '';
        const one = (g: { name: string; short: string; icon: number; level: number } | null) => {
            if (!g) return '';
            const star = gear.stars && g.level > 0 ? `<span class="sp-star">★${g.level}</span>` : '';
            return `<span class="sp-gear" title="${esc(g.name)}">${gear.icons ? gearIconHtml(g.icon, g.short) : esc(g.short || g.name)}${star}</span>`;
        };
        const main = ship.gears.filter(Boolean).map(one).join('');
        const ex = gear.exSlot && ship.exGear ? `<span class="sp-ex">${one(ship.exGear)}</span>` : '';
        return `<span class="sp-gears">${main}${ex}</span>`;
    }

    function drawList() {
        // 「計畫中」不進 ship-filter.ts——那支要保持通用（艦娘全覽也用），而「有沒有被排進
        // 計畫」是作戰板獨有的概念。故在這裡後篩，ship-filter 的職責維持乾淨。
        const base = filterShips(rows, filter, sort);
        const list = planned === 'all' || !opts.plannedIds
            ? base
            : base.filter(s => opts.plannedIds!.has(s.id) === (planned === 'yes'));
        countEl.textContent = t('ov.spCount', { n: list.length, total: rows.length });
        // 點選無效時要講原因（例：尚未選關卡），不能讓使用者對著沒反應的清單猜。
        hintEl.textContent = opts.pickHint ?? '';
        hintEl.hidden = !opts.pickHint;
        if (!list.length) {
            listEl.innerHTML = `<li class="sp-empty dim">${esc(t('ov.spNone'))}</li>`;
            return;
        }
        listEl.innerHTML = list.map(s => {
            const picked = opts.pickedIds?.has(s.id) ? ' picked' : '';
            const inPlan = opts.plannedIds?.has(s.id)
                ? `<span class="sp-plan" title="${esc(t('ov.spPlannedYes'))}">◆</span>` : '';
            const tag = s.sallyArea > 0
                ? `<span class="sp-tag">#${s.sallyArea}</span>`
                : `<span class="sp-tag free">${esc(t('ov.spFree'))}</span>`;
            return `<li class="sp-row${picked}" data-id="${s.id}">
                <span class="sp-stype">${esc(s.stype)}</span>
                <span class="sp-name" title="${esc(s.name)}">${esc(s.name)}</span>
                <span class="sp-lv">Lv${s.lv}</span>
                ${inPlan}${tag}${gearHtml(s)}
            </li>`;
        }).join('');
    }

    const onChange = <T extends HTMLElement>(sel: string, fn: (el: T) => void) =>
        el.querySelector<T>(sel)!.addEventListener('change', e => { fn(e.currentTarget as T); drawList(); });

    onChange<HTMLSelectElement>('.sp-speed', s => { filter.speed = s.value as SpeedFilter; });
    onChange<HTMLSelectElement>('.sp-equip', s => { filter.equip = s.value as EquipFilter; });
    onChange<HTMLSelectElement>('.sp-sally', s => { filter.sallyArea = s.value === '' ? null : Number(s.value); });
    onChange<HTMLSelectElement>('.sp-sort', s => { sort = s.value as ShipSortKey; });
    onChange<HTMLSelectElement>('.sp-planned', s => { planned = s.value as PlanFilter; });
    onChange<HTMLInputElement>('.sp-g-icons', c => { gear.icons = c.checked; });
    onChange<HTMLInputElement>('.sp-g-stars', c => { gear.stars = c.checked; });
    onChange<HTMLInputElement>('.sp-g-ex', c => { gear.exSlot = c.checked; });
    // 搜尋用 input 而非 change：邊打邊篩。只重繪清單，輸入框本身不動、焦點得以保留。
    el.querySelector<HTMLInputElement>('.sp-search')!.addEventListener('input', e => {
        filter.search = (e.currentTarget as HTMLInputElement).value;
        drawList();
    });

    // 事件委派：清單每次重繪都會換掉 <li>，逐項綁定會失效，故綁在容器上。
    listEl.addEventListener('click', e => {
        const row = (e.target as HTMLElement).closest<HTMLLIElement>('.sp-row');
        if (!row) return;
        if (!opts.onPick) return;
        const ship = rows.find(s => s.id === Number(row.dataset.id));
        if (ship) opts.onPick(ship);
    });

    drawNationOptions();
    drawStypeOptions();
    drawSallyOptions();
    drawList();

    return {
        refresh(patch) {
            opts = { ...opts, ...patch };
            if (patch?.ships) {
                rows = patch.ships.map(s => ({ ...s, nation: nationOf(s.ctype) }));
                drawStypeOptions();
            }
            drawNationOptions();
            drawSallyOptions();
            drawList();
        },
    };
}
