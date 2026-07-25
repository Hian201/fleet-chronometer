// 建造紀錄：可選欄位的詳細清單。投入資源來自 kdock 快照的真實值；舊摘要沒有的
// 司令部等級不以目前 state 回填，明確顯示為不可考。
import type { OverviewSection } from './types';
import { db, type FactoryLogRow } from '@/utils/db';
import {
    buildLogCsvText, BuildLogImportError, importBuildLogRows, parseBuildLogCsv, reverseShipLookup,
} from '@/utils/build-log-import';
import { t } from '@/utils/ui-i18n';
import { bindImportPanel, importPanelHtml, importToggleHtml } from '../import-panel';
import {
    copyWithFeedback, dateEnd, dateStart, downloadText, esc, fmtTs, fuzzyMatch,
    loadJsonPrefs, matIconHtml, paginate, saveJsonPrefs,
} from '../lib';

const PREFS_KEY = 'kc-build-log-view';

type ColumnId = 'time' | 'ship' | 'type' | 'fuel' | 'ammo' | 'steel' | 'bauxite' | 'devmat' | 'torch' | 'secretary' | 'hq';

interface Column {
    id: ColumnId;
    labelKey: string;
    cell(row: FactoryLogRow, ctx: Parameters<OverviewSection['render']>[1]): string;
}

const materialCell = (index: number, file?: string, labelKey?: string) => (row: FactoryLogRow) => {
    const value = row.used[index] ?? 0;
    return value > 0
        ? `<span class="bl-mat${file ? '' : ` bl-mat-${COLUMNS_BY_MATERIAL[index]}`}">`
            + `${file && labelKey ? matIconHtml(file, t(labelKey)) : ''}<b>${esc(String(value))}</b></span>`
        : `<span class="bl-none">–</span>`;
};

// 四大資源以數字顏色辨識；不重複放圖示，避免表格在窄螢幕下浪費欄寬。
const COLUMNS_BY_MATERIAL: Record<number, string> = { 0: 'fuel', 1: 'ammo', 2: 'steel', 3: 'bauxite' };

const shipType = (row: FactoryLogRow, ctx: Parameters<OverviewSection['render']>[1]) => {
    const stype = row.shipMst ? ctx.state.master.get(row.shipMst)?.stype : undefined;
    if (!stype) return `<span class="bl-none">${esc(t('ov.buildUnknown'))}</span>`;
    const key = `stype.${stype}`;
    const name = t(key);
    return esc(name === key ? String(stype) : name);
};

// 匯入徽章只標示「非本機擷取」，同 sortie-log.ts／drop-log.ts 的 imported 慣例。
const importedBadge = (r: FactoryLogRow) => r.imported
    ? `<span class="bl-flag imported" title="${esc(t('ov.buildImportedTip'))}">${esc(t('ov.buildImported'))}</span>` : '';

// 匯入來源查不到 master id 時，`importedShipName`／`importedSecretaryName` 是唯一還留著的
// 名字——優先顯示它，而不是把 shipMst 當 0 丟給 shipName() 換來一個沒有意義的「？」。
const shipCell = (r: FactoryLogRow, ctx: Parameters<OverviewSection['render']>[1]) =>
    r.shipMst ? ctx.state.shipName(r.shipMst) : (r.importedShipName ?? ctx.state.shipName(0));
const secretaryCell = (r: FactoryLogRow, ctx: Parameters<OverviewSection['render']>[1]) =>
    r.secretary ? ctx.state.shipName(r.secretary) : (r.importedSecretaryName ?? ctx.state.shipName(0));

const COLUMNS: Column[] = [
    { id: 'time', labelKey: 'ov.buildColTime', cell: r => `<time>${esc(fmtTs(r.ts))}</time>${importedBadge(r)}` },
    { id: 'ship', labelKey: 'ov.buildColShip', cell: (r, ctx) => `<b class="bl-ship">${esc(shipCell(r, ctx))}</b>` },
    { id: 'type', labelKey: 'ov.buildColType', cell: shipType },
    { id: 'fuel', labelKey: 'mat.fuel.full', cell: materialCell(0) },
    { id: 'ammo', labelKey: 'mat.ammo.full', cell: materialCell(1) },
    { id: 'steel', labelKey: 'mat.steel.full', cell: materialCell(2) },
    { id: 'bauxite', labelKey: 'mat.bauxite.full', cell: materialCell(3) },
    { id: 'devmat', labelKey: 'mat.devmat.full', cell: materialCell(6, 'devmat', 'mat.devmat') },
    { id: 'torch', labelKey: 'mat.torch.full', cell: materialCell(4, 'torch', 'mat.torch') },
    { id: 'secretary', labelKey: 'ov.buildColSecretary', cell: (r, ctx) => esc(secretaryCell(r, ctx)) },
    { id: 'hq', labelKey: 'ov.buildColHq', cell: r => Number.isSafeInteger(r.hqLv) ? `Lv${r.hqLv}` : `<span class="bl-unknown" title="${esc(t('ov.buildHqUnknownTip'))}">${esc(t('ov.buildUnknown'))}</span>` },
];

const PAGE_SIZES = [10, 20, 50, 100, 0] as const;
type PageSize = typeof PAGE_SIZES[number];

interface Prefs { cols: ColumnId[]; size: PageSize; }

const defaultPrefs = (): Prefs => ({ cols: COLUMNS.map(c => c.id), size: 20 });

function loadPrefs(): Prefs {
    const d = defaultPrefs();
    return loadJsonPrefs(PREFS_KEY, d, raw => {
        const r = raw as { cols?: unknown; size?: unknown } | null;
        const cols = Array.isArray(r?.cols)
            ? COLUMNS.filter(c => (r!.cols as unknown[]).includes(c.id)).map(c => c.id) : d.cols;
        return {
            cols: cols.length ? cols : d.cols,
            size: (PAGE_SIZES as readonly number[]).includes(r?.size as number) ? r!.size as PageSize : d.size,
        };
    });
}

function savePrefs(prefs: Prefs) {
    saveJsonPrefs(PREFS_KEY, prefs);
}

function tableHtml(rows: FactoryLogRow[], cols: Column[], ctx: Parameters<OverviewSection['render']>[1]) {
    return `<div class="bl-table-wrap"><table class="bl-table"><thead><tr>${cols.map(c =>
        `<th class="bl-c-${c.id}">${esc(t(c.labelKey))}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
        `<tr>${cols.map(c => `<td class="bl-c-${c.id}">${c.cell(row, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export const buildLogSection: OverviewSection = {
    id: 'build-log',
    titleKey: 'ov.buildLog',
    async render(el, ctx) {
        const prefs = loadPrefs();
        let page = 1;
        el.innerHTML = `<div class="bl">
            <div class="ov-toolbar bl-bar">
                <span class="bl-count"></span>
                <input class="rs-search bl-secretary" type="search" autocomplete="off" list="bl-secretaries" placeholder="${esc(t('ov.buildFilterSecretary'))}">
                <input class="rs-search bl-ship-filter" type="search" autocomplete="off" list="bl-ships" placeholder="${esc(t('ov.buildFilterShip'))}">
                <label class="rs-inline bl-date"><span>${esc(t('ov.buildFilterTime'))}</span><input type="date" class="bl-from" aria-label="${esc(t('ov.buildFilterFrom'))}"><span>–</span><input type="date" class="bl-to" aria-label="${esc(t('ov.buildFilterTo'))}"></label>
                <label class="rs-inline"><span>${esc(t('ov.rsPageSize'))}</span><select class="bl-size">${PAGE_SIZES.map(s =>
                    `<option value="${s}" ${s === prefs.size ? 'selected' : ''}>${s === 0 ? esc(t('ov.rsAll')) : s}</option>`).join('')}</select></label>
                <span class="grow"></span>
                <details class="rs-colmenu bl-colmenu">
                    <summary class="ov-btn">${esc(t('ov.buildColumns'))}</summary>
                    <div class="rs-colbox">${COLUMNS.map(c =>
                        `<label class="eo-chip"><input type="checkbox" class="bl-col" value="${c.id}" ${prefs.cols.includes(c.id) ? 'checked' : ''}>${esc(t(c.labelKey))}</label>`).join('')}</div>
                </details>
                <button type="button" class="ov-btn bl-csv">${esc(t('ov.rsExportCsv'))}</button>
                <button type="button" class="ov-btn bl-copy">${esc(t('ov.rsCopyCsv'))}</button>
                ${importToggleHtml('bl', t('ov.buildImport'))}
            </div>
            ${importPanelHtml('bl', '.csv,text/csv', {
                hint: t('ov.buildImportHint'), go: t('ov.buildImportGo'),
                paste: t('ov.buildImportPaste'), note: t('ov.buildImportNote'),
            })}
            <div class="bl-body"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
            <div class="rs-pager bl-pager" hidden></div>
        </div>`;
        const body = el.querySelector<HTMLElement>('.bl-body')!;
        const count = el.querySelector<HTMLElement>('.bl-count')!;
        const pager = el.querySelector<HTMLElement>('.bl-pager')!;
        const secretaryFilter = el.querySelector<HTMLInputElement>('.bl-secretary')!;
        const shipFilter = el.querySelector<HTMLInputElement>('.bl-ship-filter')!;
        const fromFilter = el.querySelector<HTMLInputElement>('.bl-from')!;
        const toFilter = el.querySelector<HTMLInputElement>('.bl-to')!;
        let rows: FactoryLogRow[] = [];

        const filteredRows = () => {
            const from = dateStart(fromFilter.value);
            const to = dateEnd(toFilter.value);
            return rows.filter(row =>
                fuzzyMatch(secretaryCell(row, ctx), secretaryFilter.value)
                && fuzzyMatch(shipCell(row, ctx), shipFilter.value)
                && (from == null || row.ts >= from) && (to == null || row.ts <= to));
        };
        const draw = () => {
            const cols = COLUMNS.filter(c => prefs.cols.includes(c.id));
            const filtered = filteredRows();
            const p = paginate(filtered, prefs.size, page);
            page = p.page;
            count.textContent = t('ov.buildCount', { n: filtered.length });
            body.innerHTML = p.rows.length ? tableHtml(p.rows, cols, ctx) : `<div class="ov-empty">${esc(t('factory.none'))}</div>`;
            pager.innerHTML = p.pageCount > 1 ? `
                <button type="button" class="ov-btn bl-page" data-page="prev" ${page <= 1 ? 'disabled' : ''}>‹</button>
                <span class="rs-pageno">${esc(t('ov.rsPageOf', { page, pages: p.pageCount }))}</span>
                <button type="button" class="ov-btn bl-page" data-page="next" ${page >= p.pageCount ? 'disabled' : ''}>›</button>` : '';
            pager.hidden = p.pageCount <= 1;
        };
        const changed = () => { page = 1; draw(); };

        async function load() {
            rows = (await db.factory.orderBy('eventId').reverse().toArray())
                .filter(r => r.kind === 'build' || r.kind === 'speedup');
            const options = (names: string[]) => [...new Set(names)].map(name => `<option value="${esc(name)}"></option>`).join('');
            el.querySelector('#bl-secretaries')?.remove();
            el.querySelector('#bl-ships')?.remove();
            el.querySelector('.bl-secretary')!.insertAdjacentHTML('afterend',
                `<datalist id="bl-secretaries">${options(rows.map(r => secretaryCell(r, ctx)))}</datalist>`);
            el.querySelector('.bl-ship-filter')!.insertAdjacentHTML('afterend',
                `<datalist id="bl-ships">${options(rows.map(r => shipCell(r, ctx)))}</datalist>`);
        }

        try {
            await load();
            draw();
            [secretaryFilter, shipFilter, fromFilter, toFilter].forEach(input => input.addEventListener('input', changed));
            el.querySelector<HTMLSelectElement>('.bl-size')!.addEventListener('change', event => {
                prefs.size = Number((event.currentTarget as HTMLSelectElement).value) as PageSize;
                savePrefs(prefs);
                changed();
            });
            el.querySelectorAll<HTMLInputElement>('.bl-col').forEach(box => box.addEventListener('change', () => {
                const checked = new Set([...el.querySelectorAll<HTMLInputElement>('.bl-col')]
                    .filter(input => input.checked).map(input => input.value as ColumnId));
                if (!checked.size) { box.checked = true; return; }
                prefs.cols = COLUMNS.filter(c => checked.has(c.id)).map(c => c.id);
                savePrefs(prefs);
                draw();
            }));
            pager.addEventListener('click', event => {
                const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.bl-page');
                if (!button) return;
                page += button.dataset.page === 'next' ? 1 : -1;
                draw();
            });

            // ── CSV 匯出 ──────────────────────────────────────────────
            const shipNameOf = (mst: number | undefined) => ctx.state.shipName(mst);
            el.querySelector<HTMLButtonElement>('.bl-csv')!.addEventListener('click', () =>
                downloadText('kanmusu-builds.csv', buildLogCsvText(filteredRows(), shipNameOf), 'text/csv'));
            el.querySelector<HTMLButtonElement>('.bl-copy')!.addEventListener('click', e =>
                copyWithFeedback(e.currentTarget as HTMLButtonElement, buildLogCsvText(filteredRows(), shipNameOf), t('ov.rsCopied')));

            // ── CSV 匯入 ──────────────────────────────────────────────
            bindImportPanel(el, 'bl', {
                async onImport(text, setStatus) {
                    if (!text) { setStatus('bad', t('ov.buildImportEmpty')); return; }
                    let parsed;
                    try {
                        parsed = parseBuildLogCsv(text, reverseShipLookup(ctx.state.master));
                    } catch (error) {
                        const msg = error instanceof BuildLogImportError ? error.message : String((error as Error)?.message ?? error);
                        setStatus('bad', t('ov.buildImportBad', { msg }));
                        return;
                    }
                    if (!parsed.rows.length) {
                        setStatus('bad', t('ov.buildImportNoRows', { n: parsed.skipped.length }));
                        return;
                    }
                    try {
                        const result = await importBuildLogRows(db, parsed.rows);
                        setStatus(result.added ? 'ok' : 'dup', t('ov.buildImportOk', {
                            added: result.added, dup: result.duplicates, skipped: parsed.skipped.length,
                        }));
                        await load();
                        draw();
                    } catch (error) {
                        setStatus('bad', t('ov.buildImportBad', { msg: String((error as Error)?.message ?? error) }));
                    }
                },
            });
        } catch (error) {
            count.textContent = '';
            body.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`;
        }
    },
};
