// 開發紀錄：以可選欄位的詳細清單取代流水帳。偏好只存 localStorage，不影響已擷取資料。
import type { OverviewSection } from './types';
import { db, type FactoryLogRow } from '@/utils/db';
import { t } from '@/utils/ui-i18n';
import {
    dateEnd, dateStart, esc, fmtTs, fuzzyMatch, loadJsonPrefs, paginate, saveJsonPrefs,
} from '../lib';

const PREFS_KEY = 'kc-dev-log-view';
type ColumnId = 'time' | 'result' | 'fuel' | 'ammo' | 'steel' | 'bauxite' | 'devmat' | 'secretary';
interface DevelopmentRow extends FactoryLogRow { resultMst?: number; }
interface Column { id: ColumnId; labelKey: string; cell(row: DevelopmentRow, ctx: Parameters<OverviewSection['render']>[1]): string; }

// 配方的 0 是真實數值而不是缺值，故一律顯示，讓各欄能直接縱向比較。
const materialCell = (index: number, id: Exclude<ColumnId, 'time' | 'result' | 'secretary'>) => (row: FactoryLogRow) =>
    `<span class="vl-mat vl-mat-${id}">${esc(String(row.used[index] ?? 0))}</span>`;

const resultName = (row: DevelopmentRow, ctx: Parameters<OverviewSection['render']>[1]) =>
    row.resultMst == null ? '' : row.resultMst <= 0 ? t('factory.devFail') : ctx.state.gearName(row.resultMst);

const resultCell = (row: DevelopmentRow, ctx: Parameters<OverviewSection['render']>[1]) => {
    if (row.resultMst == null) return `<span class="vl-none">–</span>`;
    if (row.resultMst <= 0) return `<span class="vl-fail">${esc(t('factory.devFail'))}</span>`;
    const name = resultName(row, ctx);
    return `<span class="vl-result" title="${esc(name)}">${esc(name)}</span>`;
};

const COLUMNS: Column[] = [
    { id: 'time', labelKey: 'ov.buildColTime', cell: row => `<time>${esc(fmtTs(row.ts))}</time>` },
    { id: 'result', labelKey: 'ov.devColResult', cell: resultCell },
    { id: 'fuel', labelKey: 'mat.fuel.full', cell: materialCell(0, 'fuel') },
    { id: 'ammo', labelKey: 'mat.ammo.full', cell: materialCell(1, 'ammo') },
    { id: 'steel', labelKey: 'mat.steel.full', cell: materialCell(2, 'steel') },
    { id: 'bauxite', labelKey: 'mat.bauxite.full', cell: materialCell(3, 'bauxite') },
    { id: 'devmat', labelKey: 'mat.devmat.full', cell: materialCell(6, 'devmat') },
    { id: 'secretary', labelKey: 'ov.buildColSecretary', cell: (row, ctx) => esc(ctx.state.shipName(row.secretary)) },
];

const PAGE_SIZES = [20, 50, 100, 0] as const;
type PageSize = typeof PAGE_SIZES[number];
interface Prefs { cols: ColumnId[]; size: PageSize; }
const defaultPrefs = (): Prefs => ({ cols: COLUMNS.map(column => column.id), size: 20 });

function loadPrefs(): Prefs {
    const fallback = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, fallback, raw => {
        const r = raw as { cols?: unknown; size?: unknown } | null;
        const cols = Array.isArray(r?.cols)
            ? COLUMNS.filter(column => (r!.cols as unknown[]).includes(column.id)).map(column => column.id)
            : fallback.cols;
        return {
            cols: cols.length ? cols : fallback.cols,
            size: (PAGE_SIZES as readonly number[]).includes(r?.size as number) ? r!.size as PageSize : fallback.size,
        };
    });
}
function savePrefs(prefs: Prefs) { saveJsonPrefs(PREFS_KEY, prefs); }

function tableHtml(rows: DevelopmentRow[], cols: Column[], ctx: Parameters<OverviewSection['render']>[1]) {
    return `<div class="vl-table-wrap"><table class="vl-table"><thead><tr>${cols.map(column =>
        `<th class="vl-c-${column.id}">${esc(t(column.labelKey))}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
        `<tr>${cols.map(column => `<td class="vl-c-${column.id}">${column.cell(row, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export const devLogSection: OverviewSection = {
    id: 'dev-log', titleKey: 'ov.devLog',
    async render(el, ctx) {
        const prefs = loadPrefs();
        let page = 1;
        el.innerHTML = `<div class="vl"><div class="ov-toolbar vl-bar">
            <span class="vl-count"></span>
            <input class="rs-search vl-secretary" type="search" autocomplete="off" list="vl-secretaries" placeholder="${esc(t('ov.buildFilterSecretary'))}">
            <input class="rs-search vl-result-filter" type="search" autocomplete="off" list="vl-results" placeholder="${esc(t('ov.devFilterResult'))}">
            <label class="rs-inline vl-date"><span>${esc(t('ov.buildFilterTime'))}</span><input type="date" class="vl-from" aria-label="${esc(t('ov.buildFilterFrom'))}"><span>–</span><input type="date" class="vl-to" aria-label="${esc(t('ov.buildFilterTo'))}"></label>
            <label class="rs-inline"><span>${esc(t('ov.rsPageSize'))}</span><select class="vl-size">${PAGE_SIZES.map(size =>
                `<option value="${size}" ${size === prefs.size ? 'selected' : ''}>${size === 0 ? esc(t('ov.rsAll')) : size}</option>`).join('')}</select></label>
            <span class="grow"></span><details class="rs-colmenu vl-colmenu"><summary class="ov-btn">${esc(t('ov.devColumns'))}</summary>
                <div class="rs-colbox">${COLUMNS.map(column => `<label class="eo-chip"><input type="checkbox" class="vl-col" value="${column.id}" ${prefs.cols.includes(column.id) ? 'checked' : ''}>${esc(t(column.labelKey))}</label>`).join('')}</div>
            </details></div><div class="vl-body"><div class="ov-empty">${esc(t('ov.loading'))}</div></div><div class="rs-pager vl-pager" hidden></div></div>`;
        const body = el.querySelector<HTMLElement>('.vl-body')!;
        const count = el.querySelector<HTMLElement>('.vl-count')!;
        const pager = el.querySelector<HTMLElement>('.vl-pager')!;
        const secretaryFilter = el.querySelector<HTMLInputElement>('.vl-secretary')!;
        const resultFilter = el.querySelector<HTMLInputElement>('.vl-result-filter')!;
        const fromFilter = el.querySelector<HTMLInputElement>('.vl-from')!;
        const toFilter = el.querySelector<HTMLInputElement>('.vl-to')!;
        const draw = (rows: DevelopmentRow[]) => {
            const cols = COLUMNS.filter(column => prefs.cols.includes(column.id));
            const from = dateStart(fromFilter.value);
            const to = dateEnd(toFilter.value);
            const filtered = rows.filter(row =>
                fuzzyMatch(ctx.state.shipName(row.secretary), secretaryFilter.value)
                && fuzzyMatch(resultName(row, ctx), resultFilter.value)
                && (from == null || row.ts >= from) && (to == null || row.ts <= to));
            const p = paginate(filtered, prefs.size, page);
            page = p.page;
            count.textContent = t('ov.devCount', { n: filtered.length });
            body.innerHTML = p.rows.length ? tableHtml(p.rows, cols, ctx) : `<div class="ov-empty">${esc(t('factory.none'))}</div>`;
            pager.innerHTML = p.pageCount > 1 ? `<button type="button" class="ov-btn vl-page" data-page="prev" ${page <= 1 ? 'disabled' : ''}>‹</button><span class="rs-pageno">${esc(t('ov.rsPageOf', { page, pages: p.pageCount }))}</span><button type="button" class="ov-btn vl-page" data-page="next" ${page >= p.pageCount ? 'disabled' : ''}>›</button>` : '';
            pager.hidden = p.pageCount <= 1;
        };
        try {
            const rows = (await db.factory.orderBy('eventId').reverse().toArray())
                .filter(row => row.kind === 'develop')
                .flatMap(row => (row.results?.length ? row.results : [{ mst: undefined }])
                    .map(result => ({ ...row, resultMst: result.mst })));
            const options = (names: string[]) => [...new Set(names.filter(Boolean))]
                .map(name => `<option value="${esc(name)}"></option>`).join('');
            secretaryFilter.insertAdjacentHTML('afterend', `<datalist id="vl-secretaries">${options(rows.map(row => ctx.state.shipName(row.secretary)))}</datalist>`);
            resultFilter.insertAdjacentHTML('afterend', `<datalist id="vl-results">${options(rows.map(row => resultName(row, ctx)))}</datalist>`);
            draw(rows);
            const changed = () => { page = 1; draw(rows); };
            [secretaryFilter, resultFilter, fromFilter, toFilter].forEach(input => input.addEventListener('input', changed));
            el.querySelector<HTMLSelectElement>('.vl-size')!.addEventListener('change', event => {
                prefs.size = Number((event.currentTarget as HTMLSelectElement).value) as PageSize; page = 1; savePrefs(prefs); draw(rows);
            });
            el.querySelectorAll<HTMLInputElement>('.vl-col').forEach(box => box.addEventListener('change', () => {
                const checked = new Set([...el.querySelectorAll<HTMLInputElement>('.vl-col')].filter(input => input.checked).map(input => input.value as ColumnId));
                if (!checked.size) { box.checked = true; return; }
                prefs.cols = COLUMNS.filter(column => checked.has(column.id)).map(column => column.id); savePrefs(prefs); draw(rows);
            }));
            pager.addEventListener('click', event => {
                const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.vl-page');
                if (!button) return;
                page += button.dataset.page === 'next' ? 1 : -1; draw(rows);
            });
        } catch (error) { count.textContent = ''; body.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`; }
    },
};
