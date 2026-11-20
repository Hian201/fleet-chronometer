// 改修日程：把明石改修工廠的曜日表對上玩家持有的裝備與艦。
// 三塊：一週總表（列＝裝備、欄＝日～六）、今日可用的改修秘書艦（以改修秘書艦反查）、自己的改修紀錄彙總。
// 查表與彙總全在 utils/akashi-schedule.ts（純函式）；本檔只負責 HTML 與事件。
//
// HTML 由下面匯出的純函式產生（只吃 GameState 與選項，不碰 DOM），離線預覽
// tools/preview/improve-plan.ts 與測試直接共用。
//
// 重繪（design-guidelines §4.2）：控制項（曜日／範圍／搜尋）只在進入分區時建一次，
// 之後只換各塊的結果區；改修秘書艦選單只在候選名單改變時才重建。先畫殼再讀 DB（§4.2.1）。
import type { OverviewSection, SectionContext } from './types';
import type { GameState } from '@/utils/state';
import { db } from '@/utils/db';
import { t } from '@/utils/ui-i18n';
import { AKASHI_SCHEDULE } from '@/utils/akashi-schedule-data';
import {
    akashiByHelper, akashiWeek, improveStats, jstWeekday, type ImproveStat,
} from '@/utils/akashi-schedule';
import { akashiDataDate, groupHelpers, heldGearCounts, ownedShipMasterIds } from '@/utils/akashi-owned';
import { formatDateTime } from '@/utils/date-format';
import { esc, gearIconHtml } from '../lib';
import { gearMatchesQuery } from '@/utils/gamedata-i18n';
import { buildStypeLabels } from '@/utils/stype-label';

export interface PlanOptions {
    /** 0=週日…6=週六；'all' 不限曜日 */
    day: number | 'all';
    heldOnly: boolean;
    query: string;
    /** 改修秘書艦的 master id；null 取候選名單第一艘 */
    helper: number | null;
}

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const defaultOptions = (now: number): PlanOptions => ({ day: jstWeekday(now), heldOnly: true, query: '', helper: null });

interface WeekRow { gearMst: number; held: number; week: ReturnType<typeof akashiWeek> }

/** 一週總表的列：依選項篩過；持有的排前面，同組維持裝備 id 順序。 */
export function weekRows(state: GameState, opts: PlanOptions): WeekRow[] {
    const held = heldGearCounts(state);
    const owned = ownedShipMasterIds(state);
    return AKASHI_SCHEDULE.flatMap(([gearMst]) => {
        const count = held.get(gearMst) ?? 0;
        if (opts.heldOnly && count <= 0) return [];
        // 繁中／日文／英文名稱都能搜，與面板「今日改修」共用同一支比對
        if (!gearMatchesQuery(gearMst, state.gearNameJa(gearMst), opts.query)) return [];
        const week = akashiWeek(gearMst, owned);
        if (opts.day !== 'all' && !week[opts.day].solo && !week[opts.day].helpers.length) return [];
        return [{ gearMst, held: count, week }];
    }).sort((a, b) => Number(b.held > 0) - Number(a.held > 0));
}

const gearCell = (state: GameState, gearMst: number, held: number) => {
    const name = state.gearName(gearMst);
    return `<span class="ip-gear" title="${esc(name)}">${gearIconHtml(state.gearIconId(gearMst), '')}<span class="ip-gear-name">${esc(name)}</span>${held > 0 ? `<span class="ip-held">×${held}</span>` : ''}</span>`;
};

function dayCell(state: GameState, day: WeekRow['week'][number]): string {
    if (day.solo) return `<span class="ip-solo" role="img" title="${esc(t('ov.ipSoloTitle'))}" aria-label="${esc(t('ov.ipSoloTitle'))}">●</span>`;
    if (!day.helpers.length) return `<span class="ip-none" aria-hidden="true">–</span>`;
    // 同一艘艦的各改造形態併成一個名字；持有的排前面並標 ✓，整格以持有與否決定亮暗。
    const names = groupHelpers(day.helpers).map(group => `${group.owned ? '✓' : ''}${state.shipName(group.shown)}`).join(t('ui.listSep'));
    const title = t('ov.ipHelperCell', { names });
    return `<span class="ip-need${day.helpers.some(helper => helper.owned) ? ' own' : ''}" role="img" title="${esc(title)}" aria-label="${esc(title)}">○</span>`;
}

/** 一週總表本體（表格或一句空狀態）。 */
export function weekBodyHtml(state: GameState, now: number, rows: readonly WeekRow[], opts: PlanOptions): string {
    if (!rows.length) {
        const noHeld = opts.heldOnly && heldGearCounts(state).size === 0;
        return `<div class="ov-empty">${esc(t(noHeld ? 'ov.ipNoHeld' : 'ov.ipEmptyWeek'))}</div>`;
    }
    const today = jstWeekday(now);
    const head = `<th class="ip-c-gear">${esc(t('ov.ipColGear'))}</th>${DAYS.map(day =>
        `<th class="ip-c-day${day === today ? ' ip-today' : ''}">${esc(t(`ov.ipDay${day}`))}</th>`).join('')}`;
    const body = rows.map(row => `<tr${row.held > 0 ? '' : ' class="ip-off"'}><td class="ip-c-gear">${gearCell(state, row.gearMst, row.held)}</td>${DAYS.map(day =>
        `<td class="ip-c-day${day === today ? ' ip-today' : ''}">${dayCell(state, row.week[day])}</td>`).join('')}</tr>`).join('');
    return `<div class="vl-table-wrap ip-table-wrap"><table class="vl-table ip-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** stypeId／stype／soku 供選單依艦種分組（標籤與消歧走 utils/stype-label.ts）。 */
export interface HelperCandidate { id: number; name: string; n: number; stypeId: number; stype: string; soku: number }

/** 候選艦（以形態計）的航速：取持有的該形態實例自己的 api_soku（取最高者，與實例順序無關）。master 沒有航速欄。 */
function ownedSoku(state: GameState, shipMasterId: number): number {
    let soku = 0;
    for (const ship of state.ships.values()) {
        if (Number(ship?.api_ship_id) === shipMasterId) soku = Math.max(soku, Number(ship.api_soku) || 0);
    }
    return soku;
}

/** 今天放改修秘書艦會多出可改修裝備的持有艦（以形態計）：多出件數多者在前。 */
export function helperCandidates(state: GameState, now: number): HelperCandidate[] {
    const weekday = jstWeekday(now);
    const held = heldGearCounts(state);
    return [...ownedShipMasterIds(state)]
        .map(id => ({
            id, name: state.shipName(id), n: akashiByHelper(weekday, held, id).length,
            stypeId: state.master.get(id)?.stype ?? 0, stype: state.shipStypeLabel(id), soku: ownedSoku(state, id),
        }))
        .filter(candidate => candidate.n > 0)
        .sort((a, b) => b.n - a.n || a.id - b.id);
}

/** 選中的候選：指定者不在名單內（語言或裝備變動後）就退回第一艘。 */
const pickedHelper = (candidates: readonly HelperCandidate[], helper: number | null) =>
    candidates.find(candidate => candidate.id === helper) ?? candidates[0] ?? null;

/** 候選依艦種分組（組序＝stype id，組內維持候選原有順序）；標籤以候選名單當 roster 消歧（同名艦種不重複）。 */
export function helperGroups(candidates: readonly HelperCandidate[]): { stypeId: number; label: string; items: HelperCandidate[] }[] {
    const labels = new Map<number, string>();
    buildStypeLabels(candidates.map(candidate => ({ stype: candidate.stype, stypeId: candidate.stypeId, soku: candidate.soku })), labels);
    const byStype = new Map<number, HelperCandidate[]>();
    for (const candidate of candidates) byStype.set(candidate.stypeId, [...(byStype.get(candidate.stypeId) ?? []), candidate]);
    return [...byStype.keys()].sort((a, b) => a - b).map(stypeId => ({ stypeId, label: labels.get(stypeId) ?? '', items: byStype.get(stypeId)! }));
}

/** 改修秘書艦選單（以 optgroup 依艦種分組；候選名單改變才重建）。沒有候選時是一句說明。 */
export function helperPickHtml(state: GameState, candidates: readonly HelperCandidate[], helper: number | null): string {
    if (!candidates.length) return `<div class="ov-empty">${esc(t(heldGearCounts(state).size === 0 ? 'ov.ipNoHeld' : 'ov.ipHelperNone'))}</div>`;
    const picked = pickedHelper(candidates, helper);
    const option = (candidate: HelperCandidate) =>
        `<option value="${candidate.id}"${candidate.id === picked?.id ? ' selected' : ''}>${esc(t('ov.ipHelperOption', { name: candidate.name, n: candidate.n }))}</option>`;
    return `<label class="rs-inline"><span>${esc(t('ov.ipHelperPick'))}</span><select class="rs-search ip-helper" aria-label="${esc(t('ov.ipHelperPick'))}">${helperGroups(candidates).map(group =>
        `<optgroup label="${esc(group.label)}">${group.items.map(option).join('')}</optgroup>`).join('')}</select></label>`;
}

/** 選中改修秘書艦今天多出的裝備清單。 */
export function helperResultHtml(state: GameState, now: number, candidates: readonly HelperCandidate[], helper: number | null): string {
    const picked = pickedHelper(candidates, helper);
    if (!picked) return '';
    const rows = akashiByHelper(jstWeekday(now), heldGearCounts(state), picked.id);
    if (!rows.length) return `<div class="ov-empty">${esc(t('ov.ipHelperNoEquip'))}</div>`;
    return `<div class="ip-helper-head dim">${esc(t('ov.ipHelperResult', { n: rows.length }))}</div><ul class="ip-helper-list">${rows.map(row =>
        `<li>${gearCell(state, row.gearMst, row.held)}</li>`).join('')}</ul>`;
}

/** 自己的改修紀錄彙總；stats 為 null＝讀取中。 */
export function statsBodyHtml(state: GameState, stats: readonly ImproveStat[] | null): string {
    if (stats === null) return `<div class="ov-empty">${esc(t('ov.loading'))}</div>`;
    if (!stats.length) return `<div class="ov-empty">${esc(t('ov.ipStNone'))}</div>`;
    const heads = ['ov.ipColGear', 'ov.ipStColAttempts', 'factory.improveOk', 'ov.ipStColRate', 'ov.ipStColCertain', 'ov.ipStColLast'];
    return `<div class="vl-table-wrap ip-stats-wrap"><table class="vl-table ip-stats"><thead><tr>${heads.map((head, i) =>
        `<th${i && i < 5 ? ' class="ip-num"' : ''}${head === 'ov.ipStColCertain' ? ` title="${esc(t('factory.certain'))}"` : ''}>${esc(t(head))}</th>`).join('')}</tr></thead><tbody>${stats.map(stat =>
        `<tr><td>${gearCell(state, stat.gearMst, 0)}</td><td class="ip-num">${stat.attempts}</td><td class="ip-num">${stat.successes}</td><td class="ip-num">${Math.round(stat.successes / stat.attempts * 100)}%</td><td class="ip-num">${stat.certain}</td><td class="vl-c-time">${esc(formatDateTime(stat.lastTs, false))}</td></tr>`).join('')}</tbody></table></div>`;
}

const segHtml = (cls: string, buttons: { value: string; label: string; on: boolean }[]) =>
    `<div class="rs-seg ${cls}">${buttons.map(button =>
        `<button type="button" data-value="${esc(button.value)}" class="${button.on ? 'on' : ''}" aria-pressed="${button.on}">${esc(button.label)}</button>`).join('')}</div>`;

/** 整個分區的 HTML（含外殼與三塊內容）；遊戲資料未載入時只有一句說明。 */
export function improvePlanHtml(state: GameState, now: number, stats: readonly ImproveStat[] | null, opts: PlanOptions = defaultOptions(now)): string {
    if (state.master.size === 0) return `<div class="ov-empty">${esc(t('ov.glNoMaster'))}</div>`;
    const rows = weekRows(state, opts);
    const candidates = helperCandidates(state, now);
    return `<div class="ip">
        <p class="ov-note dim">${esc(t('ov.ipIntro'))}<br><span class="ip-date">${esc(t('ov.ipDataDate', { date: akashiDataDate() }))}</span></p>
        <div class="ip-cols"><div class="ip-main">
        <h3 class="ov-subhead">${esc(t('ov.ipWeekTitle'))}</h3>
        <div class="ov-toolbar ip-bar">
            ${segHtml('ip-day', [{ value: 'all', label: t('ov.ipAnyDay'), on: opts.day === 'all' },
        ...DAYS.map(day => ({ value: String(day), label: t(`ov.ipDay${day}`), on: opts.day === day }))])}
            ${segHtml('ip-scope', [{ value: 'held', label: t('ov.ipScopeHeld'), on: opts.heldOnly }, { value: 'all', label: t('ov.ipScopeAll'), on: !opts.heldOnly }])}
            <input class="rs-search ip-search" type="search" autocomplete="off" value="${esc(opts.query)}" placeholder="${esc(t('ov.ipSearch'))}" aria-label="${esc(t('ov.ipSearchLabel'))}" title="${esc(t('ov.ipSearchLabel'))}">
            <span class="ip-count dim">${esc(t('ov.ipCount', { n: rows.length }))}</span>
        </div>
        <div class="ip-week-body">${weekBodyHtml(state, now, rows, opts)}</div>
        <p class="ip-legend dim">${esc(t('ov.ipLegend'))}</p>
        </div><div class="ip-side">
        <h3 class="ov-subhead">${esc(t('ov.ipHelperTitle'))}</h3>
        <div class="ov-toolbar ip-helper-pick">${helperPickHtml(state, candidates, opts.helper)}</div>
        <div class="ip-helper-result">${helperResultHtml(state, now, candidates, opts.helper)}</div>
        <h3 class="ov-subhead">${esc(t('ov.ipStatsTitle'))}</h3>
        <div class="ip-stats-body">${statsBodyHtml(state, stats)}</div>
        </div></div>
    </div>`;
}

export const improvePlanSection: OverviewSection = {
    id: 'improve-plan', titleKey: 'ov.improvePlan',
    async render(el, ctx: SectionContext) {
        // 「今天」每次重繪都重取：分區開著跨過 JST 00:00 時，今天欄與今天可用的秘書艦跟著換日。
        let now = Date.now();
        const opts = defaultOptions(now);
        let stats: ImproveStat[] | null = null;
        // 先畫殼、綁事件，再讀 DB：讀取卡住或失敗只影響第三塊，前兩塊照常可用。
        el.innerHTML = improvePlanHtml(ctx.state, now, null, opts);
        if (!el.querySelector('.ip')) {
            // 遊戲資料還沒載入（冷啟動）：載入後整個分區重畫一次。
            ctx.onStateChange?.(() => { if (el.isConnected && ctx.state.master.size > 0) ctx.rerender(); });
            return;
        }
        const q = <T extends HTMLElement>(selector: string) => el.querySelector<T>(selector)!;
        // 用產生的字串比對（DOM 的 innerHTML 會把 selected 序列化成 selected=""，比對永遠不同）。
        let pickPainted = helperPickHtml(ctx.state, helperCandidates(ctx.state, now), opts.helper);
        const drawWeek = () => {
            now = Date.now();
            const rows = weekRows(ctx.state, opts);
            q('.ip-week-body').innerHTML = weekBodyHtml(ctx.state, now, rows, opts);
            q('.ip-count').textContent = t('ov.ipCount', { n: rows.length });
        };
        // 選單本身就是使用者剛操作的控制項：選擇改變時只換結果，不重建選單（會丟掉焦點）。
        const drawHelper = (rebuildPick = true) => {
            now = Date.now();
            const candidates = helperCandidates(ctx.state, now);
            const pick = helperPickHtml(ctx.state, candidates, opts.helper);
            if (rebuildPick && pick !== pickPainted) q('.ip-helper-pick').innerHTML = pick;
            pickPainted = pick;
            q('.ip-helper-result').innerHTML = helperResultHtml(ctx.state, now, candidates, opts.helper);
        };
        const press = (group: string, value: string) => {
            for (const button of el.querySelectorAll<HTMLButtonElement>(`${group} button`)) {
                const on = button.dataset.value === value;
                button.classList.toggle('on', on);
                button.setAttribute('aria-pressed', String(on));
            }
        };
        el.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.ip-day button, .ip-scope button');
            if (!button) return;
            const value = button.dataset.value!;
            if (button.closest('.ip-day')) { opts.day = value === 'all' ? 'all' : Number(value); press('.ip-day', value); }
            else { opts.heldOnly = value === 'held'; press('.ip-scope', value); }
            drawWeek();
        });
        el.addEventListener('input', event => {
            if (!(event.target as HTMLElement).classList.contains('ip-search')) return;
            opts.query = (event.target as HTMLInputElement).value;
            drawWeek();
        });
        el.addEventListener('change', event => {
            if (!(event.target as HTMLElement).classList.contains('ip-helper')) return;
            opts.helper = Number((event.target as HTMLSelectElement).value);
            drawHelper(false);
        });
        // 持有的裝備與艦隨封包更新：只補畫結果區，不動曜日／搜尋等控制項。
        ctx.onStateChange?.(() => { if (el.isConnected) { drawWeek(); drawHelper(); } });
        try {
            stats = improveStats(await db.factory.where('kind').equals('improve').toArray());
        } catch (error) {
            q('.ip-stats-body').innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            return;
        }
        q('.ip-stats-body').innerHTML = statsBodyHtml(ctx.state, stats);
    },
};
