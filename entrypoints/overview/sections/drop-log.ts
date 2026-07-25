// 打撈紀錄：只讀 db.sorties 的結算摘要。掉落艦、節點、Boss 與 rank 都是既有歸檔欄位，
// 不需要為了這份清單新增資料表或重新解析重播封包。
import type { SortieLogRow } from '@/utils/db';
import { db } from '@/utils/db';
import { nodeLabel } from '@/utils/map-node-letters';
import { firstOwnedDropKeys } from '@/utils/retention';
import {
    dropLogCsvText, DropLogImportError, importDropLogRows, parseDropLogCsv, reverseShipLookup,
} from '@/utils/drop-log-import';
import { t } from '@/utils/ui-i18n';
import { esc, fmtTs, downloadText, copyWithFeedback, rankClassSuffix } from '../lib';
import type { OverviewSection, SectionContext } from './types';

const PREFS_KEY = 'kc-drop-log-view';
type Category = 'normal' | 'event';
type NewShipFilter = 'all' | 'new' | 'old';
type ColumnId = 'time' | 'map' | 'drop' | 'node' | 'boss' | 'rank';
const PAGE_SIZES = [10, 20, 50, 100, 0] as const;
type PageSize = typeof PAGE_SIZES[number];

interface Prefs { cat: Category; cols: ColumnId[]; size: PageSize; }

interface Column {
    id: ColumnId;
    labelKey: string;
    cell(row: SortieLogRow, ctx: SectionContext): string;
}

function dropName(row: SortieLogRow, ctx: SectionContext): string | null {
    return row.drop || (row.dropMst ? ctx.state.shipName(row.dropMst) : null);
}

function isEvent(row: SortieLogRow): boolean {
    return Number(row.map.split('-')[0]) >= 10;
}

function mapLabel(row: SortieLogRow): string {
    const [, mapNo] = row.map.split('-');
    return isEvent(row) ? `E${mapNo}` : row.map;
}

// 匯入徽章只標示「非本機擷取」，同 sortie-log.ts 的 sl-flag.imported 慣例。
const importedBadge = (row: SortieLogRow) => row.imported
    ? `<span class="dl-flag imported" title="${esc(t('ov.dropImportedTip'))}">${esc(t('ov.dropImported'))}</span>` : '';

const COLUMNS: Column[] = [
    { id: 'time', labelKey: 'ov.dropColTime', cell: row => `<time>${esc(fmtTs(row.ts))}</time>${importedBadge(row)}` },
    { id: 'map', labelKey: 'ov.dropColMap', cell: row => `<span class="dl-map" title="${esc(row.map)}">${esc(mapLabel(row))}</span>` },
    { id: 'drop', labelKey: 'ov.dropColDrop', cell: (row, ctx) => `<b>${esc(dropName(row, ctx) ?? t('ov.dropUnknown'))}</b>` },
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
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
        const cat: Category = raw?.cat === 'event' ? 'event' : 'normal';
        const cols = Array.isArray(raw?.cols)
            ? COLUMNS.filter(c => raw.cols.includes(c.id)).map(c => c.id)
            : fallback.cols;
        const size = (PAGE_SIZES as readonly number[]).includes(raw?.size) ? raw.size : fallback.size;
        return { cat, cols: cols.length ? cols : fallback.cols, size };
    } catch { return fallback; }
}

function savePrefs(prefs: Prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* 隱私模式等：靜默 */ }
}

export function dropTableHtml(rows: SortieLogRow[], cols: Column[], ctx: SectionContext): string {
    return `<div class="dl-table-wrap"><table class="dl-table"><thead><tr>${cols.map(c =>
        `<th class="dl-c-${c.id}">${esc(t(c.labelKey))}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
        `<tr>${cols.map(c => `<td class="dl-c-${c.id}">${c.cell(row, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function dateStart(value: string): number | null {
    if (!value) return null;
    const ts = new Date(`${value}T00:00:00`).getTime();
    return Number.isFinite(ts) ? ts : null;
}

function dateEnd(value: string): number | null {
    if (!value) return null;
    const ts = new Date(`${value}T23:59:59.999`).getTime();
    return Number.isFinite(ts) ? ts : null;
}

const matches = (name: string, query: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

export const dropLogSection: OverviewSection = {
    id: 'drop-log',
    titleKey: 'ov.dropLog',
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
                <button type="button" class="ov-btn dl-import-toggle" aria-expanded="false">${esc(t('ov.dropImport'))}</button>
            </div>
            <div class="dl-import" hidden>
                <p class="dl-dim">${esc(t('ov.dropImportHint'))}</p>
                <div class="dl-import-row">
                    <input type="file" class="dl-import-file" accept=".csv,text/csv">
                    <button type="button" class="ov-btn dl-import-go">${esc(t('ov.dropImportGo'))}</button>
                    <span class="dl-import-status" role="status"></span>
                </div>
                <textarea class="ov-textarea small dl-import-text" placeholder="${esc(t('ov.dropImportPaste'))}"></textarea>
                <p class="dl-dim">${esc(t('ov.dropImportNote'))}</p>
            </div>
            <div class="dl-body"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
            <div class="rs-pager dl-pager" hidden></div>
        </div>`;

        const body = el.querySelector<HTMLElement>('.dl-body')!;
        const count = el.querySelector<HTMLElement>('.dl-count')!;
        const pager = el.querySelector<HTMLElement>('.dl-pager')!;
        const cats = el.querySelectorAll<HTMLButtonElement>('.dl-cat button');
        const newShipButtons = el.querySelectorAll<HTMLButtonElement>('.dl-newship button');
        const keyword = el.querySelector<HTMLInputElement>('.dl-keyword')!;
        const fromFilter = el.querySelector<HTMLInputElement>('.dl-from')!;
        const toFilter = el.querySelector<HTMLInputElement>('.dl-to')!;
        let newShip: NewShipFilter = 'all';
        let rows: SortieLogRow[] = [];
        let newShipKeys = new Set<number>();

        const draw = () => {
            cats.forEach(button => button.classList.toggle('on', button.dataset.cat === prefs.cat));
            newShipButtons.forEach(button => button.classList.toggle('on', button.dataset.new === newShip));
            const from = dateStart(fromFilter.value);
            const to = dateEnd(toFilter.value);
            const filtered = rows.filter(row => isEvent(row) === (prefs.cat === 'event')
                && matches(dropName(row, ctx) ?? '', keyword.value)
                && (from == null || row.ts >= from) && (to == null || row.ts <= to)
                && (newShip === 'all' || (newShipKeys.has(row.sortieKey) === (newShip === 'new'))));
            const cols = COLUMNS.filter(c => prefs.cols.includes(c.id));
            const pageCount = prefs.size ? Math.max(1, Math.ceil(filtered.length / prefs.size)) : 1;
            page = Math.min(Math.max(page, 1), pageCount);
            const pageRows = prefs.size ? filtered.slice((page - 1) * prefs.size, page * prefs.size) : filtered;
            count.textContent = t('ov.dropCount', { n: filtered.length, total: rows.length });
            body.innerHTML = pageRows.length
                ? dropTableHtml(pageRows, cols, ctx)
                : `<div class="ov-empty">${esc(t('ov.dropNone'))}</div>`;
            pager.innerHTML = pageCount > 1 ? `
                <button type="button" class="ov-btn dl-page" data-page="prev" ${page <= 1 ? 'disabled' : ''}>‹</button>
                <span class="rs-pageno">${esc(t('ov.rsPageOf', { page, pages: pageCount }))}</span>
                <button type="button" class="ov-btn dl-page" data-page="next" ${page >= pageCount ? 'disabled' : ''}>›</button>` : '';
            pager.hidden = pageCount <= 1;
        };
        const changed = () => { page = 1; draw(); };

        cats.forEach(button => button.addEventListener('click', () => {
            prefs.cat = button.dataset.cat === 'event' ? 'event' : 'normal';
            savePrefs(prefs);
            changed();
        }));
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
        const visibleRows = () => {
            const from = dateStart(fromFilter.value);
            const to = dateEnd(toFilter.value);
            return rows.filter(row => isEvent(row) === (prefs.cat === 'event')
                && matches(dropName(row, ctx) ?? '', keyword.value)
                && (from == null || row.ts >= from) && (to == null || row.ts <= to)
                && (newShip === 'all' || (newShipKeys.has(row.sortieKey) === (newShip === 'new'))));
        };
        el.querySelector<HTMLButtonElement>('.dl-csv')!.addEventListener('click', () =>
            downloadText('kanmusu-drops.csv', dropLogCsvText(visibleRows()), 'text/csv'));
        el.querySelector<HTMLButtonElement>('.dl-copy')!.addEventListener('click', e =>
            copyWithFeedback(e.currentTarget as HTMLButtonElement, dropLogCsvText(visibleRows()), t('ov.rsCopied')));

        // ── CSV 匯入 ──────────────────────────────────────────────────
        // 解析／去重／落地都在 utils/drop-log-import.ts；這裡只負責 UI 狀態顯示，
        // 同 sortie-log.ts 單場 JSON 匯入的互動模式（切換面板／選檔或貼上／狀態列三態）。
        const importToggle = el.querySelector<HTMLButtonElement>('.dl-import-toggle')!;
        const importPanel = el.querySelector<HTMLDivElement>('.dl-import')!;
        const importFile = el.querySelector<HTMLInputElement>('.dl-import-file')!;
        const importText = el.querySelector<HTMLTextAreaElement>('.dl-import-text')!;
        const importGo = el.querySelector<HTMLButtonElement>('.dl-import-go')!;
        const importStatus = el.querySelector<HTMLSpanElement>('.dl-import-status')!;
        importToggle.addEventListener('click', () => {
            const show = importPanel.hidden;
            importPanel.hidden = !show;
            importToggle.setAttribute('aria-expanded', String(show));
        });
        const setStatus = (kind: 'ok' | 'dup' | 'bad' | '', message: string) => {
            importStatus.className = `dl-import-status${kind ? ' ' + kind : ''}`;
            importStatus.textContent = message;
        };
        // 連續選 A→B 時，較慢的 file.text() 不得覆寫較新選擇的內容。
        let importFileGen = 0;
        importFile.addEventListener('change', async () => {
            const gen = ++importFileGen;
            const file = importFile.files?.[0];
            if (!file) return;
            const text = await file.text();
            if (gen !== importFileGen) return;
            importText.value = text;
        });
        importGo.addEventListener('click', async () => {
            const text = importText.value.trim();
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
                draw();
            } catch (error) {
                setStatus('bad', t('ov.dropImportBad', { msg: String((error as Error)?.message ?? error) }));
            }
        });

        // ── 資料載入 ──────────────────────────────────────────────────
        async function load() {
            try {
                // 打撈紀錄只列有確定掉落艦的結算列；中途撤退或「無掉落」不混入。
                const [sorties, shipObtained] = await Promise.all([
                    db.sorties.orderBy('ts').reverse().toArray(),
                    db.shipObtained.toArray(),
                ]);
                rows = sorties.filter(row => row.kind === 'battle' && !!dropName(row, ctx));
                newShipKeys = firstOwnedDropKeys(rows, shipObtained);
                const drops = [...new Set(rows.map(row => dropName(row, ctx)).filter((n): n is string => !!n))];
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
            draw();
        } catch { /* load() 已顯示錯誤 */ }
    },
};
