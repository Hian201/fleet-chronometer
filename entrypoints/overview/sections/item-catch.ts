// 打撈紀錄 › 道具捕撈：依大海域 → 海域 → 節點列出某一種道具（預設秋刀魚）的捕獲紀錄。
// 統計規則全在 utils/item-catch-stats.ts（k／n／u 的定義、場數與趟數分計、連續無魚場數）；
// 本檔只管殼、篩選、載入與重畫。規格見 docs/saury-plan.md §4.2。
//
// 狀態保留（design-guidelines §4.2）：篩選控制項只畫一次；重畫只換統計區，展開中的
// <details> 依 data-key 記住後還原，捲動位置跟著頁面不動。查詢以遞增序號丟棄過期結果。
// 即時更新只用 ts 索引讀新進來的列並合併，不重讀整段歷史。
import type { SortieLogRow } from '@/utils/db';
import { db } from '@/utils/db';
import { useItemDisplayName } from '@/utils/item-catalog';
import {
    CATCH_SEASON_START, isCatchRow, itemCatchStats, type AreaCatchStat, type CatchCounts, type DryStreak, type MapCatchStat, type NodeCatchStat,
} from '@/utils/item-catch-stats';
import {
    catchesInWindow, isValidAlertNumber, loadCatchAlertRule, saveCatchAlertRule, type CatchAlertRule,
} from '@/utils/catch-alert';
import { nodeLabel } from '@/utils/map-node-letters';
import { loadExcludeCatch, loadExcludedMaps, onExcludeCatchChange, onExcludedMapsChange } from '@/utils/sortie-exclude';
import { isEventWorld, mapLabel, parseMapCode } from '@/utils/sortie-detail';
import { getLang, t } from '@/utils/ui-i18n';
import { dateEnd, dateStart, esc, eventDisplayName, fmtTs } from '../lib';
import type { OverviewSection, SectionContext } from './types';

/** 秋刀魚（useitem 68）。 */
export const DEFAULT_CATCH_ITEM = 68;

/** 結算寫入 db.sorties 的封包；投影由面板做，與通知的先後不保證，所以稍等再讀。 */
const REFRESH_PATHS = new Set(['api_req_sortie/battleresult', 'api_req_combined_battle/battleresult']);
const HELD_PATHS = new Set(['api_port/port', 'api_get_member/useitem', ...REFRESH_PATHS]);
const REFRESH_DELAY = 1500;

const num = (n: number) => n.toLocaleString('en-US');
const none = `<span class="ic-none">–</span>`;

function hitsHtml(c: CatchCounts): string {
    return c.n || c.u ? `<span class="ic-hits" title="${esc(t('ov.icHitsTip'))}">${num(c.k)}／${num(c.n)}</span>` : none;
}

function unknownHtml(u: number): string {
    return u ? `<span class="ic-unknown">${num(u)}</span>` : none;
}

function dryHtml(dry: DryStreak | null): string {
    if (!dry) return none;
    const tip = [t('ov.icDryTip', { s: dry.s, a: dry.a }), dry.u ? t('ov.icDryUnknown', { u: dry.u }) : ''].filter(Boolean).join('\n');
    return `<span class="ic-dry" title="${esc(tip)}">${esc(t('ov.icDryN', { n: num(dry.n) }))}${dry.u ? `<small>+${num(dry.u)}?</small>` : ''}</span>`;
}

/** 出擊紀錄看得到的結算時刻；catchOnly 列不在出擊紀錄，連過去會找不到那一場。 */
type Linkable = ReadonlySet<number>;

function timeHtml(ts: number | null, linkable: Linkable | null): string {
    if (ts === null) return none;
    const time = `<time>${esc(fmtTs(ts))}</time>`;
    // 出擊紀錄的深連結：解除篩選、翻到該場並展開，可核對地圖、節點、勝利等級與道具。
    return linkable?.has(ts) ? `<a class="ic-link" href="#/sortie-log?ts=${ts}" title="${esc(t('ov.icOpenSortie'))}">${time}</a>` : time;
}

/** 大海域與單張圖共用的一列。 */
function rowCells(s: AreaCatchStat | MapCatchStat, linkable: Linkable): string {
    return `<span class="ic-num">${s.total.caught ? `<b>${num(s.total.caught)}</b>` : '0'}</span>
        <span class="ic-num">${hitsHtml(s.total)}</span>
        <span class="ic-num">${unknownHtml(s.total.u)}</span>
        <span class="ic-num">${num(s.sorties)}</span>
        <span class="ic-num">${num(s.recent6h)}／${num(s.recent24h)}</span>
        <span>${timeHtml(s.lastCatchTs, linkable)}</span>
        <span class="ic-num">${dryHtml(s.dryStreak)}</span>
        <span>${timeHtml(s.lastBattleTs, null)}</span>`;
}

function headHtml(first: string): string {
    return `<div class="ic-row ic-head">
        <span>${esc(first)}</span>
        <span class="ic-num" title="${esc(t('ov.icColCaughtTip'))}">${esc(t('ov.icColCaught'))}</span>
        <span class="ic-num" title="${esc(t('ov.icHitsTip'))}">${esc(t('ov.icColHits'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColUnknownTip'))}">${esc(t('ov.icColUnknown'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColSortiesTip'))}">${esc(t('ov.icColSorties'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColRecentTip'))}">${esc(t('ov.icColRecent'))}</span>
        <span>${esc(t('ov.icColLastCatch'))}</span>
        <span class="ic-num" title="${esc(t('ov.icColDryTip'))}">${esc(t('ov.icColDry'))}</span>
        <span>${esc(t('ov.icColLastBattle'))}</span>
    </div>`;
}

function nodeTableHtml(nodes: NodeCatchStat[]): string {
    const rank = (c: CatchCounts) => `<td class="ic-num">${hitsHtml(c)}</td>`;
    return `<div class="dl-table-wrap ic-nodes"><table class="dl-table"><thead><tr>
        <th>${esc(t('ov.dropColNode'))}</th>
        <th class="ic-num" title="${esc(t('ov.icColCaughtTip'))}">${esc(t('ov.icColCaught'))}</th>
        <th class="ic-num" title="${esc(t('ov.icHitsTip'))}">S</th>
        <th class="ic-num" title="${esc(t('ov.icHitsTip'))}">A</th>
        <th class="ic-num" title="${esc(t('ov.icHitsTip'))}">${esc(t('ov.icRankOther'))}</th>
        <th class="ic-num" title="${esc(t('ov.icColUnknownTip'))}">${esc(t('ov.icColUnknown'))}</th>
        <th class="ic-num" title="${esc(t('ov.icColSortiesTip'))}">${esc(t('ov.icColSorties'))}</th>
    </tr></thead><tbody>${nodes.map(n => {
        const label = nodeLabel(n.map, n.node);
        return `<tr>
            <td><span class="dl-node" title="${esc(label === String(n.node) ? label : `edge ${n.node}`)}">${esc(label)}</span></td>
            <td class="ic-num">${n.total.caught ? `<b>${num(n.total.caught)}</b>` : '0'}</td>
            ${rank(n.byRank.S)}${rank(n.byRank.A)}${rank(n.byRank.other)}
            <td class="ic-num">${unknownHtml(n.total.u)}</td>
            <td class="ic-num">${num(n.sorties)}</td>
        </tr>`;
    }).join('')}</tbody></table></div>`;
}

function areaTitle(area: number, ctx: SectionContext): string {
    return isEventWorld(area)
        ? eventDisplayName(area, ctx.state.masterMapAreas.get(area))
        : `${area} ${ctx.state.mapAreaName(area)}`;
}

/** 大海域 → 自訂提醒時窗內的捕獲條數；只放已達門檻的。 */
type AlertHits = ReadonlyMap<number, number>;

function alertBadge(area: number, hits: AlertHits, rule: CatchAlertRule | null): string {
    const n = hits.get(area);
    return n === undefined || !rule ? ''
        : ` <span class="ic-alert-hit" title="${esc(t('ov.icAlertHitTip', { hours: rule.hours, n }))}">${esc(t('ov.icAlertHit'))}</span>`;
}

function statsHtml(areas: AreaCatchStat[], ctx: SectionContext, open: ReadonlySet<string>, linkable: Linkable,
    hits: AlertHits, rule: CatchAlertRule | null): string {
    const isOpen = (key: string) => open.has(key) ? ' open' : '';
    return `<div class="ic-grid">${headHtml(t('ov.icColArea'))}${areas.map(a => `
        <details class="ic-area" data-key="a${a.area}"${isOpen(`a${a.area}`)}>
            <summary class="ic-row"><span class="ic-name ic-name-flex"><span class="ic-name-text">${esc(areaTitle(a.area, ctx))}</span>${alertBadge(a.area, hits, rule)}</span>${rowCells(a, linkable)}</summary>
            ${a.maps.map(m => {
                const p = parseMapCode(m.map);
                const label = mapLabel({ map: m.map, mapnum: p.mapnum, event: isEventWorld(p.world) });
                return `<details class="ic-map" data-key="m${esc(m.map)}"${isOpen(`m${m.map}`)}>
                    <summary class="ic-row"><span class="ic-name" title="${esc(m.map)}">${esc(label)}</span>${rowCells(m, linkable)}</summary>
                    ${nodeTableHtml(m.nodes)}
                </details>`;
            }).join('')}
        </details>`).join('')}</div>`;
}

function mergeRows(base: SortieLogRow[], incoming: SortieLogRow[]): SortieLogRow[] {
    const seen = new Set(base.map(r => r.eventId));
    return [...base, ...incoming.filter(r => !seen.has(r.eventId))];
}

export const itemCatchSection: OverviewSection = {
    id: 'item-catch',
    titleKey: 'ov.dropSubItem',
    async render(el, ctx) {
        // 先畫殼、綁事件，再讀 IndexedDB；讀取被阻塞時也不留白。
        el.innerHTML = `<div class="ic">
            <div class="ov-toolbar dl-bar ic-bar">
                <label class="rs-inline"><span>${esc(t('ov.icItem'))}</span><select class="ic-item"></select></label>
                <label class="rs-inline dl-date"><span>${esc(t('ov.buildFilterTime'))}</span><input type="date" class="ic-from" aria-label="${esc(t('ov.buildFilterFrom'))}"><span>–</span><input type="date" class="ic-to" aria-label="${esc(t('ov.buildFilterTo'))}"></label>
            </div>
            <div class="ic-summary" aria-live="polite"></div>
            <p class="ov-note dim ic-excluded" hidden></p>
            <details class="ic-alert">
                <summary>${esc(t('ov.icAlert'))}<span class="ic-alert-state"></span></summary>
                <div class="ic-alert-body">
                    <label class="rs-inline"><input type="checkbox" class="ic-alert-on"><span class="ic-alert-label"></span></label>
                    <div class="ic-alert-fields">
                        <label class="rs-inline"><span>${esc(t('ov.icAlertHours'))}</span><input type="number" class="rs-search ic-alert-num ic-alert-hours" min="1" max="168" step="1" inputmode="numeric"></label>
                        <label class="rs-inline"><span>${esc(t('ov.icAlertCount'))}</span><input type="number" class="rs-search ic-alert-num ic-alert-count" min="1" max="999" step="1" inputmode="numeric"></label>
                    </div>
                    <p class="ov-note ic-alert-invalid" hidden>${esc(t('ov.icAlertInvalid'))}</p>
                    <p class="ov-note dim">${esc(t('ov.icAlertNote'))}</p>
                </div>
            </details>
            <div class="ic-body"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
            <p class="ov-note dim">${esc(t('ov.icNote'))}</p>
        </div>`;
        const itemSel = el.querySelector<HTMLSelectElement>('.ic-item')!;
        const fromInput = el.querySelector<HTMLInputElement>('.ic-from')!;
        const toInput = el.querySelector<HTMLInputElement>('.ic-to')!;
        const summary = el.querySelector<HTMLElement>('.ic-summary')!;
        const excluded = el.querySelector<HTMLElement>('.ic-excluded')!;
        const body = el.querySelector<HTMLElement>('.ic-body')!;
        const alertOn = el.querySelector<HTMLInputElement>('.ic-alert-on')!;
        const alertHours = el.querySelector<HTMLInputElement>('.ic-alert-hours')!;
        const alertCount = el.querySelector<HTMLInputElement>('.ic-alert-count')!;
        const alertLabel = el.querySelector<HTMLElement>('.ic-alert-label')!;
        const alertState = el.querySelector<HTMLElement>('.ic-alert-state')!;
        const alertInvalid = el.querySelector<HTMLElement>('.ic-alert-invalid')!;

        let itemId = DEFAULT_CATCH_ITEM;
        let rows: SortieLogRow[] = [];
        let loaded = false;
        let query = 0;
        const itemName = (id: number) => useItemDisplayName(id, getLang(), ctx.state.useItemName(id));

        // 自訂換海域提醒（utils/catch-alert.ts；通知由面板在結算後發）。控制項只在載入時填一次，
        // 之後只寫回設定，不因重畫覆蓋玩家正在輸入的值。沒有預設門檻：欄位留空要玩家自己填。
        let alertRule = loadCatchAlertRule();
        if (alertRule) {
            alertOn.checked = alertRule.enabled;
            alertHours.value = String(alertRule.hours);
            alertCount.value = String(alertRule.count);
        }
        const drawAlertLabel = () => {
            const item = itemName(alertRule?.enabled ? alertRule.itemId : itemId);
            alertLabel.textContent = t('ov.icAlertEnable', { item });
            alertState.textContent = alertRule?.enabled
                ? t('ov.icAlertStateOn', { hours: alertRule.hours, n: alertRule.count, item: itemName(alertRule.itemId) }) : '';
        };
        const saveAlert = () => {
            const hours = Number(alertHours.value), count = Number(alertCount.value);
            const valid = isValidAlertNumber(hours, 'hours') && isValidAlertNumber(count, 'count');
            alertInvalid.hidden = valid || !alertOn.checked;
            if (valid) {
                // 改任何一項都套到目前選的道具。
                alertRule = { enabled: alertOn.checked, itemId, hours, count };
                saveCatchAlertRule(alertRule);
            } else if (alertRule?.enabled) {
                alertRule = { ...alertRule, enabled: false };
                saveCatchAlertRule(alertRule);
            }
            drawAlertLabel();
            draw();
        };
        [alertOn, alertHours, alertCount].forEach(input => input.addEventListener('change', saveAlert));

        // 開關打開時，排除海域的結算仍以 catchOnly 列寫入（見 utils/sortie-exclude.ts），提示改寫成「另外統計」。
        const drawExcluded = () => {
            const maps = loadExcludedMaps();
            const catchOn = loadExcludeCatch();
            const key = catchOn ? 'ov.icExcludedCatch' : 'ov.icExcluded';
            excluded.hidden = !maps.length;
            // 沒開例外時是要玩家採取行動的提醒，不用淡色。
            excluded.classList.toggle('dim', catchOn);
            excluded.innerHTML = maps.length
                ? `${esc(t(key, { maps: maps.join('、') }))} <a href="#/sortie-log">${esc(t('ov.icExcludedLink'))}</a>` : '';
        };
        drawExcluded();
        onExcludedMapsChange(() => { if (el.isConnected) drawExcluded(); });
        onExcludeCatchChange(() => { if (el.isConnected) drawExcluded(); });

        // 選項集合沒變就不動下拉（使用者可能正開著它）。
        let itemKey = '';
        const drawItems = () => {
            const ids = new Set([DEFAULT_CATCH_ITEM, itemId]);
            for (const row of rows) if (isCatchRow(row)) for (const id of row.useItemDrops ?? []) ids.add(id);
            const sorted = [...ids].sort((a, b) => a - b);
            if (sorted.join() === itemKey) return;
            itemKey = sorted.join();
            itemSel.innerHTML = sorted.map(id =>
                `<option value="${id}"${id === itemId ? ' selected' : ''}>${esc(itemName(id))}</option>`).join('');
        };

        // 提醒徽章只看「現在」：歷史檢視（選了截止日）不標，避免誤以為當時達到過條件。
        const alertHits = (): AlertHits => {
            if (!alertRule?.enabled || alertRule.itemId !== itemId || toInput.value) return new Map();
            const rule = alertRule;
            return new Map([...catchesInWindow(rows, rule, Date.now())].filter(([, n]) => n >= rule.count));
        };

        const draw = () => {
            const from = Math.max(dateStart(fromInput.value) ?? -Infinity, CATCH_SEASON_START), to = dateEnd(toInput.value);
            const stats = itemCatchStats(rows, { itemId, from, to, now: Date.now() });
            const held = ctx.state.useItemCount(itemId);
            const chip = (label: string, value: string, tip?: string) =>
                `<span class="ic-chip"${tip ? ` title="${esc(tip)}"` : ''}><span class="ic-chip-label">${esc(label)}</span>${value}</span>`;
            summary.innerHTML = [
                chip(t('ov.icCaught'), `<b>${num(stats.caught)}</b>`, t('ov.icCaughtTip')),
                chip(t('ov.icSince'), esc(fmtTs(from)), t('ov.icSinceTip')),
                chip(t('ov.icHeld'), held === null ? esc(t('ov.dropUnknown')) : `<b>${num(held)}</b>`),
                chip(t('ov.icObserved'), stats.observedFrom === null ? none
                    : `${esc(fmtTs(stats.observedFrom))} – ${esc(fmtTs(stats.observedTo!))}`),
                stats.firstCatchTs === null ? '' : chip(t('ov.icFirstCatch'), esc(fmtTs(stats.firstCatchTs))),
                stats.unknown ? chip(t('ov.icColUnknown'), num(stats.unknown), t('ov.icColUnknownTip')) : '',
            ].join('');
            if (!stats.areas.length) {
                body.innerHTML = `<div class="ov-empty">${esc(t('ov.icNone'))}</div>`;
                return;
            }
            const open = new Set([...body.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.key!));
            body.innerHTML = (stats.caught ? '' : `<p class="ov-note dim">${esc(t('ov.icNoCatch', { item: itemName(itemId) }))}</p>`)
                + statsHtml(stats.areas, ctx, open, new Set(rows.filter(r => !r.catchOnly).map(r => r.ts)), alertHits(), alertRule);
        };

        // 期間改變才重讀 DB（ts 索引）；道具切換只重算。
        const load = async () => {
            const token = ++query;
            const from = dateStart(fromInput.value), to = dateEnd(toInput.value);
            try {
                const table = db.sorties;
                const next = from === null && to === null
                    ? await table.toArray()
                    : await table.where('ts').between(from ?? -Infinity, to ?? Infinity, true, true).toArray();
                if (token !== query || !el.isConnected) return;
                rows = next;
                loaded = true;
                drawItems();
                draw();
            } catch (error) {
                if (token !== query) return;
                body.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            }
        };

        itemSel.addEventListener('change', () => { itemId = Number(itemSel.value) || DEFAULT_CATCH_ITEM; drawAlertLabel(); draw(); });
        [fromInput, toInput].forEach(input => input.addEventListener('change', () => void load()));

        let timer: ReturnType<typeof setTimeout> | undefined;
        ctx.onStateChange?.(paths => {
            if (!el.isConnected || !loaded) return;
            if (!paths.some(path => HELD_PATHS.has(path))) return;
            if (!paths.some(path => REFRESH_PATHS.has(path))) { draw(); return; }
            clearTimeout(timer);
            timer = setTimeout(async () => {
                if (!el.isConnected) return;
                const token = query;
                const since = rows.reduce((max, r) => Math.max(max, r.ts), 0);
                const to = dateEnd(toInput.value);
                try {
                    const incoming = await db.sorties.where('ts').aboveOrEqual(since).toArray();
                    // 期間查詢在等待中換過就交給那次查詢，不合併舊期間的結果。
                    if (token !== query || !el.isConnected) return;
                    rows = mergeRows(rows, incoming.filter(r => to === null || r.ts <= to));
                } catch {
                    return;   // 讀不到就維持舊畫面，下次通知再試
                }
                drawItems();
                draw();
            }, REFRESH_DELAY);
        });

        drawAlertLabel();
        await load();
    },
};
