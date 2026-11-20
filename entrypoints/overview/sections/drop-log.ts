// 打撈紀錄：「艦娘打撈」與「道具捕撈」兩個子分頁（hash 參數 sub=ship|item）。道具子頁在
// item-catch.ts；本檔前半是艦娘打撈清單，檔尾是子分頁切換（同 factory.ts 的做法）。
//
// 艦娘打撈：只讀 db.sorties 的結算摘要。掉落艦、節點、Boss 與 rank 都是既有歸檔欄位，
// 不需要為了這份清單新增資料表或重新解析重播封包。
// 活動篩選與出擊紀錄共用 planEventMapFilter：歷次活動以年份＋季節區分，關卡數跟紀錄走。
import type { ShipObtainedRow, SortieLogRow } from '@/utils/db';
import { db } from '@/utils/db';
import { nodeLabel } from '@/utils/map-node-letters';
import { newShipDropKeys } from '@/utils/drop-new-ship';
import {
    dropLogCsvText, DropLogImportError, importDropLogRows, parseDropLogCsv, reverseShipLookup,
} from '@/utils/drop-log-import';
import {
    isEventWorld, mapLabel, parseMapCode, planEventMapFilter,
    qualifiedEventMapLabel, type EventMapFilterPlan, type EventWorldFilter,
} from '@/utils/sortie-detail';
import { t } from '@/utils/ui-i18n';
import { bindImportPanel, importPanelHtml, importToggleHtml } from '../import-panel';
import {
    copyWithFeedback, dateEnd, dateStart, downloadText, dropName, esc, eventDisplayName,
    eventDisplayTitle, eventFilterSelectHtml, eventNameOf, eventTermForFilter, fmtTs,
    fuzzyMatch, hashParams, loadJsonPrefs, mapFilterSelectHtml, paginate, parseColumnIds, parsePageSize, rankClassSuffix,
    readEventWorldFilter, saveJsonPrefs,
} from '../lib';
import { itemCatchSection } from './item-catch';
import type { OverviewSection, SectionContext } from './types';

const PREFS_KEY = 'kc-drop-log-view';
type Category = 'normal' | 'event';
type NewShipFilter = 'all' | 'new' | 'old';
type ColumnId = 'time' | 'map' | 'drop' | 'node' | 'boss' | 'rank';
const PAGE_SIZES = [10, 20, 50, 100, 0] as const;
type PageSize = typeof PAGE_SIZES[number];

interface Prefs { cat: Category; cols: ColumnId[]; size: PageSize; }

interface MapView { qualifyEventWorld: boolean }

interface Column {
    id: ColumnId;
    labelKey: string;
    cell(row: SortieLogRow, ctx: SectionContext, view: MapView): string;
}

function catalogItem(row: SortieLogRow) {
    const parsed = parseMapCode(row.map);
    return { map: row.map, world: parsed.world, mapnum: parsed.mapnum, event: isEventWorld(parsed.world) };
}

export function dropMapLabel(row: SortieLogRow, qualifyEventWorld: boolean): string {
    const item = catalogItem(row);
    if (item.event && qualifyEventWorld) return qualifiedEventMapLabel(item, eventDisplayName(item.world, undefined));
    return mapLabel(item);
}

export function dropMapTitle(row: SortieLogRow, ctx: SectionContext): string {
    const item = catalogItem(row);
    if (!item.event) return row.map;
    return `${eventDisplayTitle(item.world, ctx.state.masterMapAreas.get(item.world))}（${row.map}）`;
}

// 匯入徽章只標示「非本機擷取」，同 sortie-log.ts 的 sl-flag.imported 慣例。
const importedBadge = (row: SortieLogRow) => row.imported
    ? `<span class="dl-flag imported" title="${esc(t('ov.dropImportedTip'))}">${esc(t('ov.dropImported'))}</span>` : '';

const COLUMNS: Column[] = [
    { id: 'time', labelKey: 'ov.dropColTime', cell: row => `<time>${esc(fmtTs(row.ts))}</time>${importedBadge(row)}` },
    { id: 'map', labelKey: 'ov.dropColMap', cell: (row, ctx, view) =>
        `<span class="dl-map" title="${esc(dropMapTitle(row, ctx))}">${esc(dropMapLabel(row, view.qualifyEventWorld))}</span>` },
    { id: 'drop', labelKey: 'ov.dropColDrop', cell: (row, ctx) => `<b>${esc(dropName(row, ctx.state) ?? t('ov.dropUnknown'))}</b>` },
    {
        id: 'node', labelKey: 'ov.dropColNode',
        cell: row => {
            const label = nodeLabel(row.map, row.node);
            return `<span class="dl-node" title="${esc(label === String(row.node) ? label : `edge ${row.node}`)}">${esc(label)}</span>`;
        },
    },
    { id: 'boss', labelKey: 'ov.dropColBoss', cell: row => row.boss ? `<span class="dl-boss">BOSS</span>` : `<span class="dl-none">–</span>` },
    { id: 'rank', labelKey: 'ov.dropColRank', cell: row => {
        if (!row.rank) return `<span class="dl-none">–</span>`;
        const suf = rankClassSuffix(row.rank);
        return `<b class="dl-rank${suf ? ` rank-${suf}` : ''}">${esc(row.rank)}</b>`;
    } },
];

function loadPrefs(): Prefs {
    const fallback: Prefs = { cat: 'normal', cols: COLUMNS.map(c => c.id), size: 20 };
    return loadJsonPrefs(PREFS_KEY, fallback, raw => {
        const r = raw as { cat?: unknown; cols?: unknown; size?: unknown } | null;
        const cat: Category = r?.cat === 'event' ? 'event' : 'normal';
        const cols = parseColumnIds(r?.cols, COLUMNS, fallback.cols);
        const size = parsePageSize(r?.size, PAGE_SIZES, fallback.size);
        return { cat, cols, size };
    });
}

function savePrefs(prefs: Prefs) {
    saveJsonPrefs(PREFS_KEY, prefs);
}

export function dropTableHtml(
    rows: SortieLogRow[],
    cols: Column[],
    ctx: SectionContext,
    view: MapView = { qualifyEventWorld: false },
): string {
    return `<div class="dl-table-wrap"><table class="dl-table"><thead><tr>${cols.map(c =>
        `<th class="dl-c-${c.id}">${esc(t(c.labelKey))}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
        `<tr>${cols.map(c => `<td class="dl-c-${c.id}">${c.cell(row, ctx, view)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const shipDropSection: OverviewSection = {
    id: 'ship-drop',
    titleKey: 'ov.dropSubShip',
    async render(el, ctx) {
        // 先畫殼，再讀 IndexedDB；讀取被其他頁面的 schema 升級阻塞時也不能留下空白分區。
        const prefs = loadPrefs();
        let page = 1;
        el.innerHTML = `<div class="dl">
            <div class="ov-toolbar dl-bar">
                <div class="rs-seg dl-cat">
                    <button type="button" data-cat="normal">${esc(t('ov.dropNormal'))}</button>
                    <button type="button" data-cat="event">${esc(t('ov.dropEvent'))}</button>
                </div>
                <label class="rs-inline dl-event-wrap" hidden><span>${esc(t('ov.slEvent'))}</span><select class="dl-event-sel"></select></label>
                <label class="rs-inline"><span>${esc(t('ov.slMap'))}</span><select class="dl-map-sel"></select></label>
                <div class="rs-seg dl-newship">
                    <button type="button" data-new="all">${esc(t('ov.dropShipAll'))}</button>
                    <button type="button" data-new="new">${esc(t('ov.dropShipNew'))}</button>
                    <button type="button" data-new="old">${esc(t('ov.dropShipOld'))}</button>
                </div>
                <input class="rs-search dl-keyword" type="search" autocomplete="off" list="dl-drops" placeholder="${esc(t('ov.dropFilterKeyword'))}">
                <label class="rs-inline dl-date"><span>${esc(t('ov.buildFilterTime'))}</span><input type="date" class="dl-from" aria-label="${esc(t('ov.buildFilterFrom'))}"><span>–</span><input type="date" class="dl-to" aria-label="${esc(t('ov.buildFilterTo'))}"></label>
                <label class="rs-inline"><span>${esc(t('ov.rsPageSize'))}</span><select class="dl-size">${PAGE_SIZES.map(s =>
                    `<option value="${s}" ${s === prefs.size ? 'selected' : ''}>${s === 0 ? esc(t('ov.rsAll')) : s}</option>`).join('')}</select></label>
                <span class="dl-count"></span>
                <span class="grow"></span>
                <details class="rs-colmenu dl-colmenu">
                    <summary class="ov-btn">${esc(t('ov.dropColumns'))}</summary>
                    <div class="rs-colbox">${COLUMNS.map(c =>
                        `<label class="eo-chip"><input type="checkbox" class="dl-col" value="${c.id}" ${prefs.cols.includes(c.id) ? 'checked' : ''}>${esc(t(c.labelKey))}</label>`).join('')}</div>
                </details>
                <button type="button" class="ov-btn dl-csv">${esc(t('ov.rsExportCsv'))}</button>
                <button type="button" class="ov-btn dl-copy">${esc(t('ov.rsCopyCsv'))}</button>
                ${importToggleHtml('dl', t('ov.dropImport'))}
            </div>
            ${importPanelHtml('dl', '.csv,text/csv', {
                hint: t('ov.dropImportHint'), go: t('ov.dropImportGo'),
                paste: t('ov.dropImportPaste'), note: t('ov.dropImportNote'),
            })}
            <div class="dl-body"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
            <div class="rs-pager dl-pager" hidden></div>
        </div>`;

        const body = el.querySelector<HTMLElement>('.dl-body')!;
        const count = el.querySelector<HTMLElement>('.dl-count')!;
        const pager = el.querySelector<HTMLElement>('.dl-pager')!;
        const cats = el.querySelectorAll<HTMLButtonElement>('.dl-cat button');
        const eventWrap = el.querySelector<HTMLLabelElement>('.dl-event-wrap')!;
        const eventSel = el.querySelector<HTMLSelectElement>('.dl-event-sel')!;
        const mapSel = el.querySelector<HTMLSelectElement>('.dl-map-sel')!;
        const newShipButtons = el.querySelectorAll<HTMLButtonElement>('.dl-newship button');
        const keyword = el.querySelector<HTMLInputElement>('.dl-keyword')!;
        const fromFilter = el.querySelector<HTMLInputElement>('.dl-from')!;
        const toFilter = el.querySelector<HTMLInputElement>('.dl-to')!;
        let newShip: NewShipFilter = 'all';
        let eventFilter: EventWorldFilter = 'all';
        let mapFilter = 'all';
        let pinLatestEvent = prefs.cat === 'event';
        let filterPlan: EventMapFilterPlan | null = null;
        let rows: SortieLogRow[] = [];
        let shipObtained: ShipObtainedRow[] = [];
        let newShipEventIds = new Set<number>();

        const recalculateNewShipEventIds = () => {
            newShipEventIds = newShipDropKeys(rows, shipObtained, mst => ctx.state.baseShipId(mst));
        };

        const matchesRow = (row: SortieLogRow) => {
            const item = catalogItem(row);
            const from = dateStart(fromFilter.value);
            const to = dateEnd(toFilter.value);
            return item.event === (prefs.cat === 'event')
                && (eventFilter === 'all' || item.world === eventFilter)
                && (mapFilter === 'all' || item.map === mapFilter)
                && (fuzzyMatch(dropName(row, ctx.state) ?? '', keyword.value)
                    || fuzzyMatch(row.drop ?? '', keyword.value))
                && (from == null || row.ts >= from) && (to == null || row.ts <= to)
                && (newShip === 'all' || (newShipEventIds.has(row.eventId) === (newShip === 'new')));
        };

        const drawFilters = () => {
            const plan = planEventMapFilter(rows.map(catalogItem), {
                category: prefs.cat,
                eventFilter,
                mapFilter,
                pinLatestEvent,
                worldLabel: world => eventNameOf(world, ctx.state),
                eventTerm: eventTermForFilter,
                normalGroupLabel: t('ov.dropNormal'),
            });
            pinLatestEvent = false;
            eventFilter = plan.eventFilter;
            mapFilter = plan.mapFilter;
            filterPlan = plan;
            eventWrap.hidden = !plan.showEventSelect;
            eventSel.innerHTML = eventFilterSelectHtml(plan.eventGroups, plan.eventFilter, t('ov.slEventAll'));
            mapSel.innerHTML = mapFilterSelectHtml(plan.mapGroups, plan.mapFilter, t('ov.slMapAll'));
        };

        const draw = () => {
            cats.forEach(button => button.classList.toggle('on', button.dataset.cat === prefs.cat));
            newShipButtons.forEach(button => button.classList.toggle('on', button.dataset.new === newShip));
            const filtered = rows.filter(matchesRow);
            const cols = COLUMNS.filter(c => prefs.cols.includes(c.id));
            const p = paginate(filtered, prefs.size, page);
            page = p.page;
            count.textContent = t('ov.dropCount', { n: filtered.length, total: rows.length });
            body.innerHTML = p.rows.length
                ? dropTableHtml(p.rows, cols, ctx, { qualifyEventWorld: filterPlan?.qualifyEventWorld === true })
                : `<div class="ov-empty">${esc(t('ov.dropNone'))}</div>`;
            pager.innerHTML = p.pageCount > 1 ? `
                <button type="button" class="ov-btn dl-page" data-page="prev" ${page <= 1 ? 'disabled' : ''}>‹</button>
                <span class="rs-pageno">${esc(t('ov.rsPageOf', { page, pages: p.pageCount }))}</span>
                <button type="button" class="ov-btn dl-page" data-page="next" ${page >= p.pageCount ? 'disabled' : ''}>›</button>` : '';
            pager.hidden = p.pageCount <= 1;
        };
        const changed = () => { page = 1; draw(); };

        cats.forEach(button => button.addEventListener('click', () => {
            prefs.cat = button.dataset.cat === 'event' ? 'event' : 'normal';
            savePrefs(prefs);
            pinLatestEvent = prefs.cat === 'event';
            if (prefs.cat !== 'event') eventFilter = 'all';
            drawFilters();
            changed();
        }));
        eventSel.addEventListener('change', () => {
            eventFilter = readEventWorldFilter(eventSel.value);
            drawFilters();
            changed();
        });
        mapSel.addEventListener('change', () => { mapFilter = mapSel.value; changed(); });
        newShipButtons.forEach(button => button.addEventListener('click', () => {
            newShip = (button.dataset.new as NewShipFilter) ?? 'all';
            changed();
        }));
        [keyword, fromFilter, toFilter].forEach(input => input.addEventListener('input', changed));
        el.querySelector<HTMLSelectElement>('.dl-size')!.addEventListener('change', event => {
            prefs.size = Number((event.currentTarget as HTMLSelectElement).value) as PageSize;
            savePrefs(prefs);
            changed();
        });
        el.querySelectorAll<HTMLInputElement>('.dl-col').forEach(box => box.addEventListener('change', () => {
            const selected = new Set([...el.querySelectorAll<HTMLInputElement>('.dl-col')]
                .filter(input => input.checked).map(input => input.value as ColumnId));
            if (!selected.size) { box.checked = true; return; }
            prefs.cols = COLUMNS.filter(c => selected.has(c.id)).map(c => c.id);
            savePrefs(prefs);
            draw();
        }));
        pager.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.dl-page');
            if (!button) return;
            page += button.dataset.page === 'next' ? 1 : -1;
            draw();
        });

        // ── CSV 匯出 ──────────────────────────────────────────────────
        const visibleRows = () => rows.filter(matchesRow);
        el.querySelector<HTMLButtonElement>('.dl-csv')!.addEventListener('click', () =>
            downloadText('kanmusu-drops.csv', dropLogCsvText(visibleRows()), 'text/csv'));
        el.querySelector<HTMLButtonElement>('.dl-copy')!.addEventListener('click', e =>
            copyWithFeedback(e.currentTarget as HTMLButtonElement, dropLogCsvText(visibleRows()), t('ov.rsCopied')));

        // ── CSV 匯入 ──────────────────────────────────────────────────
        // 解析／去重／落地都在 utils/drop-log-import.ts；面板 UI 走共用 import-panel。
        bindImportPanel(el, 'dl', {
            async onImport(text, setStatus) {
                if (!text) { setStatus('bad', t('ov.dropImportEmpty')); return; }
                let parsed;
                try {
                    parsed = parseDropLogCsv(text, reverseShipLookup(ctx.state.master));
                } catch (error) {
                    const msg = error instanceof DropLogImportError ? error.message : String((error as Error)?.message ?? error);
                    setStatus('bad', t('ov.dropImportBad', { msg }));
                    return;
                }
                if (!parsed.rows.length) {
                    setStatus('bad', t('ov.dropImportNoRows', { n: parsed.skipped.length }));
                    return;
                }
                try {
                    const result = await importDropLogRows(db, parsed.rows);
                    setStatus(result.added ? 'ok' : 'dup', t('ov.dropImportOk', {
                        added: result.added, dup: result.duplicates, skipped: parsed.skipped.length,
                    }));
                    await load();
                    drawFilters();
                    draw();
                } catch (error) {
                    setStatus('bad', t('ov.dropImportBad', { msg: String((error as Error)?.message ?? error) }));
                }
            },
        });

        // ── 資料載入 ──────────────────────────────────────────────────
        async function load() {
            try {
                // 打撈紀錄只列有確定掉落艦的結算列；中途撤退或「無掉落」不混入。
                const [sorties, obtained] = await Promise.all([
                    db.sorties.orderBy('ts').reverse().toArray(),
                    db.shipObtained.toArray(),
                ]);
                // catchOnly＝不記錄海域只供道具捕撈統計的列，不列入艦娘打撈。
                rows = sorties.filter(row => row.kind === 'battle' && !row.catchOnly && !!dropName(row, ctx.state));
                shipObtained = obtained;
                // 依歷史上的首次自動入手觀測定位「入手那一撈」，並以 eventId 對應單筆掉落。
                // 這樣同一場出擊內的多筆掉落不會互相影響。
                recalculateNewShipEventIds();
                const drops = [...new Set(rows.map(row => dropName(row, ctx.state)).filter((n): n is string => !!n))];
                el.querySelector('#dl-drops')?.remove();
                el.querySelector('.dl-keyword')!.insertAdjacentHTML('afterend',
                    `<datalist id="dl-drops">${drops.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`);
            } catch (error) {
                count.textContent = '';
                body.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`;
                throw error;
            }
        }
        try {
            await load();
            drawFilters();
            draw();
        } catch { /* load() 已顯示錯誤 */ }
    },
};

// ── 子分頁 ────────────────────────────────────────────────────────────────
// 切換不重建（design-guidelines §4.2）：各子頁第一次進入才 render，之後只切 hidden。
// 子分頁選擇存 localStorage（kc-drop-log-sub，不進備份），網址的 sub 參數優先。
export const DROP_LOG_SECTION_ID = 'drop-log';
export const DROP_LOG_SUB_PREFS_KEY = 'kc-drop-log-sub';
export const DROP_LOG_SUBS = [
    { key: 'ship', labelKey: 'ov.dropSubShip', section: shipDropSection },
    { key: 'item', labelKey: 'ov.dropSubItem', section: itemCatchSection },
] as const;
export type DropLogSub = typeof DROP_LOG_SUBS[number]['key'];

const isDropLogSub = (value: unknown): value is DropLogSub => DROP_LOG_SUBS.some(sub => sub.key === value);

/** 子分頁的決定順序：網址參數 → 上次選的 → 艦娘打撈。 */
export function resolveDropLogSub(param: string | null, saved: unknown): DropLogSub {
    if (isDropLogSub(param)) return param;
    return isDropLogSub(saved) ? saved : 'ship';
}

export const dropLogSection: OverviewSection = {
    id: DROP_LOG_SECTION_ID,
    titleKey: 'ov.dropLog',
    async render(el, ctx) {
        let active = resolveDropLogSub(hashParams().get('sub'),
            loadJsonPrefs<unknown>(DROP_LOG_SUB_PREFS_KEY, null, raw => raw));
        el.innerHTML = `<div class="dls"><nav class="fa-nav" role="tablist" aria-label="${esc(t('ov.dropLog'))}">${DROP_LOG_SUBS.map(sub =>
            `<button type="button" role="tab" class="fa-tab" id="dls-tab-${sub.key}" data-sub="${sub.key}" aria-selected="${sub.key === active}" aria-controls="dls-page-${sub.key}">${esc(t(sub.labelKey))}</button>`).join('')}</nav>${DROP_LOG_SUBS.map(sub =>
            `<div class="fa-page" id="dls-page-${sub.key}" role="tabpanel" aria-labelledby="dls-tab-${sub.key}" hidden></div>`).join('')}</div>`;
        const rendered = new Map<DropLogSub, Promise<void>>();
        // 子頁自己的 render 例外只影響該子頁，顯示原因而不是留白。
        const open = (key: DropLogSub) => {
            if (rendered.has(key)) return rendered.get(key)!;
            const host = el.querySelector<HTMLElement>(`#dls-page-${key}`)!;
            const sub = DROP_LOG_SUBS.find(item => item.key === key)!;
            const job = Promise.resolve().then(() => sub.section.render(host, ctx)).catch(error => {
                console.error(`[overview] 打撈紀錄子頁 ${key} render 失敗`, error);
                host.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
                // 失敗的子頁不記成已載入：切走再切回會重試。
                rendered.delete(key);
            });
            rendered.set(key, job);
            return job;
        };
        const show = (key: DropLogSub) => {
            active = key;
            for (const button of el.querySelectorAll<HTMLButtonElement>('.dls > .fa-nav .fa-tab')) button.setAttribute('aria-selected', String(button.dataset.sub === key));
            for (const sub of DROP_LOG_SUBS) el.querySelector<HTMLElement>(`#dls-page-${sub.key}`)!.hidden = sub.key !== key;
            return open(key);
        };
        el.querySelector('.dls > .fa-nav')!.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.fa-tab');
            if (!button || button.dataset.sub === active) return;
            const key = button.dataset.sub as DropLogSub;
            void show(key);
            saveJsonPrefs(DROP_LOG_SUB_PREFS_KEY, key);
            // 網址跟著子頁走，切語言重繪才不會被舊的 sub 參數拉回去；replaceState 不觸發 hashchange。
            history.replaceState(null, '', `${location.pathname}${location.search}#/${DROP_LOG_SECTION_ID}?sub=${key}`);
        });
        await show(active);
    },
};
