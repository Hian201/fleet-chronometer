// 目標規劃：玩家指定「某艘艦改到某個形態」，列出還缺的等級、經驗、各項消耗與資材湊齊日；
// 另可宣告「正在備蓄」（存到蓄積上限，可設期限），列出各資材哪天到上限、期限當天有多少。
// 計算全在 utils/remodel-goals.ts、utils/goal-arrival.ts 與 utils/stockpile.ts（純函式）；本檔只負責 HTML、事件與讀 DB。
//
// HTML 由下面幾個匯出的純函式產生（只吃 GameState 與目標陣列，不碰 DOM），
// 離線預覽 tools/preview/goals.ts 直接共用，避免預覽與正式分區各寫一套。
//
// 重繪（design-guidelines §4.2）：說明、<details> 與搜尋框只在進入分區時建一次；
// 之後的新增／移除／排序／搜尋／state 更新只換目標清單、合計與候選表格的內容，
// 才保得住展開狀態與輸入焦點。按鈕一律走事件委派。
import type { OverviewSection, SectionContext } from './types';
import type { GameState } from '@/utils/state';
import { getLang, t } from '@/utils/ui-i18n';
import { itemCatalog } from '@/utils/item-catalog';
import {
    BOILER_NAME_JA, REMODEL_MATERIAL_ID, REMODEL_USEITEM_ID,
    goalsFromRows, goalsToRows, planRemodelGoals, remodelStep, remodelStockOf, remodelTargets,
    type GoalCostLine, type GoalPlan, type GoalShip, type GoalTotalLine, type RemodelCostKey, type RemodelGoal,
} from '@/utils/remodel-goals';
import { goalArrivals, observeFlow, FLOW_BLOCK_DAYS, FLOW_MAX_BLOCKS, type ArrivalLine, type GoalArrival, type ObservedFlow } from '@/utils/goal-arrival';
import { normalizeSamples } from '@/utils/resource-log';
import { DAY_MS, formatDate } from '@/utils/date-format';
import { db, type GoalRow, type ResourceRow } from '@/utils/db';
import { STOCKPILE_GOAL_KEY, stockpileFromRows, stockpileOutlook, stockpileToRow, type StockpileGoal, type StockpileLine } from '@/utils/stockpile';
import { dateStart, esc, fmtNum, fuzzyMatch } from '../lib';

/** 消耗項的顯示名：資材走既有文案，道具走道具目錄，缶走裝備譯名；查不到不自編名稱。 */
export function goalCostName(state: GameState, key: RemodelCostKey): string {
    if (REMODEL_MATERIAL_ID[key] !== undefined) return t(`mat.${key}.full`);
    const itemId = REMODEL_USEITEM_ID[key];
    if (itemId !== undefined) {
        const item = itemCatalog.find(row => row.countSource.kind === 'useitem' && row.countSource.id === itemId);
        return item ? item.names[getLang()] : `#${itemId}`;
    }
    if (key === 'boiler') {
        const id = [...state.masterGears].find(([, gear]) => gear.name === BOILER_NAME_JA)?.[0];
        return id === undefined ? BOILER_NAME_JA : state.gearName(id);
    }
    return key;
}

/** 到達日推算的輸入：觀測流量（不足一週為 null）與推算的起點時刻。 */
export interface GoalEta { flow: ObservedFlow | null; now: number }

export function goalPlans(state: GameState, goals: readonly RemodelGoal[], eta: GoalEta) {
    const ships = new Map<number, GoalShip>(state.ownedShips()
        .map(ship => [ship.id, { id: ship.id, masterId: ship.masterId, lv: ship.lv, exp: ship.exp }]));
    const stock = remodelStockOf(state);
    const { plans, totals } = planRemodelGoals(state, goals, ships, stock);
    return { plans, totals, arrivals: goalArrivals(plans, stock, eta.flow) };
}

/**
 * 讀出推算流量所需的資源取樣與改造紀錄：只取最後一筆往回 FLOW_MAX_BLOCKS 週，
 * 再加上邊界之前的最後一筆（取樣有空檔時第一週的起點落在那裡）。
 */
export async function loadGoalFlow(state: GameState): Promise<ObservedFlow | null> {
    const last = await db.resources.orderBy('ts').last();
    if (!last) return null;
    const from = last.ts - FLOW_MAX_BLOCKS * FLOW_BLOCK_DAYS * DAY_MS;
    const [inside, before] = await Promise.all([
        db.resources.where('ts').aboveOrEqual(from).toArray(),
        db.resources.where('ts').below(from).last(),
    ]);
    const samples = normalizeSamples([...(before ? [before] : []), ...inside] as ResourceRow[]);
    const uses = await db.materialUse.where('ts').aboveOrEqual(samples[0]?.ts ?? from).toArray();
    return observeFlow(samples, uses, state);
}

const unknownHtml = () => `<span class="gl-unknown">${esc(t('ov.glUnknown'))}</span>`;
const numOrUnknown = (n: number | null) => (n === null ? unknownHtml() : esc(fmtNum(n)));
const shortHtml = (short: number | null) => short === null ? unknownHtml()
    : short > 0 ? `<span class="gl-short">${esc(fmtNum(short))}</span>`
        : `<span class="gl-enough" title="${esc(t('ov.glEnough'))}" aria-label="${esc(t('ov.glEnough'))}">✓</span>`;

function itemCell(state: GameState, line: { key: RemodelCostKey; estimated: boolean }) {
    const est = line.estimated
        ? ` <span class="gl-est" title="${esc(t('ov.glEstTitle'))}">${esc(t('ov.glEst'))}</span>` : '';
    return `<td>${esc(goalCostName(state, line.key))}${est}</td>`;
}

function costTableHtml(state: GameState, heads: string[], rows: string[]) {
    return `<div class="vl-table-wrap gl-table-wrap"><table class="vl-table gl-table"><thead><tr>${heads.map((head, i) =>
        `<th${i ? ' class="gl-num"' : ''}>${esc(t(head))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

const days = (n: number) => Math.ceil(n);

/** 天數區間的文字：最慢一週沒有淨增加（latest 為 null）時只寫下界；天數加千分位，同表內其他數字。 */
function daysRangeText(earliest: number, latest: number | null): string {
    const a = days(earliest);
    if (latest === null) return t('ov.glDaysMin', { n: fmtNum(a) });
    const b = days(latest);
    return a === b ? t('ov.glDays', { n: fmtNum(a) }) : t('ov.glDaysRange', { a: fmtNum(a), b: fmtNum(b) });
}

const ETA_REASON: Record<Exclude<ArrivalLine['status'], 'met' | 'range'>, [string, string, string]> = {
    untracked: ['gl-unknown', 'ov.glUnknown', 'ov.glUntrackedTitle'],
    'no-data': ['gl-unknown', 'ov.glUnknown', 'ov.glNoDataTitle'],
    stalled: ['gl-stalled', 'ov.glStalled', 'ov.glStalledTitle'],
    'over-cap': ['gl-stalled', 'ov.glOverCap', 'ov.glOverCapTitle'],
};

/** 消耗表「預計天數」欄：足夠的項目留白，其餘照狀態給天數或原因（原因放 title）。 */
function etaCellHtml(line: ArrivalLine | undefined): string {
    if (!line || line.status === 'met') return '';
    const titled = (cls: string, text: string, title: string) =>
        `<span class="${cls}" title="${esc(t(title))}">${esc(t(text))}</span>`;
    if (line.status !== 'range') {
        const [cls, text, title] = ETA_REASON[line.status];
        return titled(cls, text, title);
    }
    return esc(daysRangeText(line.earliest, line.latest));
}

const lineRow = (state: GameState, line: GoalCostLine, withEta: boolean, eta: ArrivalLine | undefined) =>
    `<tr>${itemCell(state, line)}<td class="gl-num">${esc(fmtNum(line.need))}</td><td class="gl-num">${numOrUnknown(line.available)}</td><td class="gl-num">${shortHtml(line.short)}</td>${withEta ? `<td class="gl-num gl-eta-cell">${etaCellHtml(eta)}</td>` : ''}</tr>`;

/**
 * 卡片上的資材湊齊日：所有缺口都推得出區間才寫「預計 A–B」；有不可考的項目或上界看不到時
 * 只寫「最快」，因為真正的日期只會更晚。等級不在內（沒有經驗的歷史序列）。
 */
function etaSummaryHtml(arrival: GoalArrival | null, eta: GoalEta): string {
    if (!arrival || arrival.lines.every(line => line.status === 'met')) return '';
    if (!eta.flow) return `<div class="gl-eta">${esc(t('ov.glEtaNoFlow'))}</div>`;
    const title = esc(t('ov.glEtaTitle', { weeks: eta.flow.weeks }));
    const at = (n: number) => formatDate(eta.now + days(n) * DAY_MS);
    let text: string;
    // 有任一項照目前步調湊不齊（或超過上限），其他項目再快也沒有日期可言。
    if (arrival.lines.some(line => line.status === 'stalled' || line.status === 'over-cap')) text = t('ov.glEtaStalled');
    else if (arrival.earliest === null) text = t('ov.glEtaUnknown');
    else if (arrival.latest === null || arrival.blocked.length) text = t('ov.glEtaMin', { date: at(arrival.earliest) });
    else {
        const from = at(arrival.earliest), to = at(arrival.latest);
        text = from === to ? t('ov.glEtaOne', { date: from }) : t('ov.glEta', { from, to });
    }
    return `<div class="gl-eta" title="${title}">${esc(text)}</div>`;
}

const totalRow = (state: GameState, line: GoalTotalLine) =>
    `<tr>${itemCell(state, line)}<td class="gl-num">${esc(fmtNum(line.need))}</td><td class="gl-num">${numOrUnknown(line.stock)}</td><td class="gl-num">${shortHtml(line.short)}</td></tr>`;

const isReady = (plan: GoalPlan) =>
    plan.status === 'active' && plan.level?.gap === 0 && plan.lines.every(line => line.short === 0);

function moveButtons(shipId: number, index: number, count: number) {
    const button = (act: string, glyph: string, key: string, disabled = false) =>
        `<button type="button" class="ov-btn gl-act" data-act="${act}" data-ship="${shipId}" title="${esc(t(key))}" aria-label="${esc(t(key))}"${disabled ? ' disabled' : ''}>${glyph}</button>`;
    return `<span class="gl-acts">${button('up', '↑', 'ov.glUp', index === 0)}${button('down', '↓', 'ov.glDown', index === count - 1)}${button('remove', '✕', 'ov.glRemove')}</span>`;
}

const REASON_KEY: Record<Exclude<GoalPlan['status'], 'active'>, string> = {
    done: 'ov.glDone', 'ship-missing': 'ov.glShipMissing', 'no-path': 'ov.glNoPath',
};

function cardHtml(state: GameState, plan: GoalPlan, arrival: GoalArrival | null, eta: GoalEta, index: number, count: number) {
    const ready = isReady(plan);
    const who = plan.ship
        ? `<span class="gl-name">${esc(state.shipName(plan.ship.masterId))}</span><span class="gl-lv">Lv${plan.ship.lv}</span><span class="gl-arrow" aria-hidden="true">→</span>`
        : '';
    const head = `<div class="gl-head"><span class="gl-no">${index + 1}</span>${who}<span class="gl-target">${esc(state.shipName(plan.goal.targetMst))}</span>${ready ? `<span class="gl-ready">${esc(t('ov.glReady'))}</span>` : ''}<span class="grow"></span>${moveButtons(plan.goal.shipId, index, count)}</div>`;
    if (plan.status !== 'active' || !plan.level) {
        return `<article class="gl-card gl-idle">${head}<p class="gl-reason">${esc(t(REASON_KEY[plan.status as keyof typeof REASON_KEY]))}</p></article>`;
    }
    const path = plan.steps.length > 1
        ? `<div class="gl-path">${[plan.steps[0].from, ...plan.steps.map(step => step.to)].map(id => esc(state.shipName(id))).join(' → ')}</div>` : '';
    const { level } = plan;
    const levelText = level.gap > 0
        ? `<span class="gl-gap">${esc(t('ov.glLevelGap', { n: level.gap }))}</span><span class="dim">${level.expGap === null
            ? esc(t('ov.glExpUnknown')) : esc(t('ov.glExpGap', { exp: fmtNum(level.expGap) }))}</span>`
        : `<span class="dim">${esc(t('ov.glLevelMet'))}</span>`;
    const levelRow = `<div class="gl-level"><span>${esc(t('ov.glLevel', { have: level.have, need: level.need }))}</span>${levelText}</div>`;
    // 每一項都夠時不需要「預計天數」欄，整欄省略。
    const etaLines = plan.lines.some(line => line.short !== 0) ? new Map(arrival?.lines.map(line => [line.key, line])) : null;
    const table = plan.lines.length
        ? costTableHtml(state, ['ov.glColItem', 'ov.glColNeed', 'ov.glColAvail', 'ov.glColShort', ...(etaLines ? ['ov.glColEta'] : [])],
            plan.lines.map(line => lineRow(state, line, etaLines !== null, etaLines?.get(line.key)))) : '';
    return `<article class="gl-card${ready ? ' gl-card-ready' : ''}">${head}${path}${levelRow}${etaSummaryHtml(arrival, eta)}${table}</article>`;
}

/** 改造目標清單（卡片）；改造與備蓄都沒有時是一句提示。 */
export function goalListHtml(state: GameState, plans: readonly GoalPlan[], arrivals: readonly (GoalArrival | null)[], eta: GoalEta, hasStockpile = false): string {
    if (!plans.length) return hasStockpile ? '' : `<div class="ov-empty">${esc(t('ov.glEmpty'))}</div>`;
    return plans.map((plan, index) => cardHtml(state, plan, arrivals[index] ?? null, eta, index, plans.length)).join('');
}

/** 合計：進行中的目標兩個以上才有意義，否則回空字串。 */
export function goalTotalsHtml(state: GameState, plans: readonly GoalPlan[], totals: readonly GoalTotalLine[]): string {
    if (plans.filter(plan => plan.status === 'active').length < 2 || !totals.length) return '';
    return `<h3 class="ov-subhead">${esc(t('ov.glTotals'))}</h3>${costTableHtml(state,
        ['ov.glColItem', 'ov.glColNeedTotal', 'ov.glColStock', 'ov.glColShort'], totals.map(line => totalRow(state, line)))}`;
}

// ── 備蓄 ─────────────────────────────────────────────────────────────

/** 期限距今的天數（期限日 0 時起算）；沒有期限或日期無效為 null。 */
function daysToDeadline(stockpile: StockpileGoal, now: number): number | null {
    const at = stockpile.until ? dateStart(stockpile.until) : null;
    return at === null ? null : (at - now) / DAY_MS;
}

function toCapCellHtml(line: StockpileLine): string {
    const { toCap } = line;
    let html: string;
    if (toCap.status === 'range') html = esc(daysRangeText(toCap.earliest, toCap.latest));
    else if (toCap.status === 'full') html = esc(t('ov.gsFull'));
    else if (toCap.status === 'unknown') html = `<span class="gl-unknown" title="${esc(t('ov.glNoDataTitle'))}">${esc(t('ov.glUnknown'))}</span>`;
    else html = `<span class="gl-stalled" title="${esc(t('ov.gsStalledTitle'))}">${esc(t('ov.gsStalled'))}</span>`;
    // 期限前就會滿：之後流進來的收入會浪費。持有量到上限是合法狀態，只加粗不用警示色（同資源紀錄的溢出提醒）。
    return line.fillsBeforeDeadline ? `<span class="gl-fills" title="${esc(t('ov.gsFillsTitle'))}">${html}</span>` : html;
}

function atDeadlineHtml(line: StockpileLine): string {
    const at = line.atDeadline;
    if (!at) return unknownHtml();
    const low = Math.floor(at.low), high = Math.floor(at.high);
    return esc(low === high ? fmtNum(low) : `${fmtNum(low)}–${fmtNum(high)}`);
}

/**
 * 備蓄卡片的內容（說明與表格）。卡片外殼（期限輸入、移除鈕）只在出現時建一次，重繪只換這裡，
 * 期限輸入框才不會被打斷（design-guidelines §4.2）。
 */
export function stockpileBodyHtml(state: GameState, goals: readonly RemodelGoal[], stockpile: StockpileGoal, eta: GoalEta): string {
    const { totals } = goalPlans(state, goals, eta);
    const reserved = Object.fromEntries(totals.map(line => [line.key, line.need]));
    const deadline = daysToDeadline(stockpile, eta.now);
    const lines = stockpileOutlook(remodelStockOf(state), reserved, eta.flow, deadline);
    const ahead = deadline !== null && deadline > 0;
    const withReserved = lines.some(line => line.reserved > 0);
    const notes: string[] = [];
    if (!eta.flow) notes.push(esc(t('ov.gsNoFlow')));
    if (deadline !== null && !ahead) notes.push(esc(t('ov.gsPast')));
    const filling = lines.filter(line => line.fillsBeforeDeadline);
    if (filling.length) notes.push(`<b>${esc(t('ov.gsFills', { items: filling.map(line => goalCostName(state, line.key)).join(t('ov.gsSep')) }))}</b>`);
    const heads = ['ov.glColItem', 'ov.glColStock', ...(withReserved ? ['ov.gsColReserved'] : []), 'ov.gsColToCap', ...(ahead ? ['ov.gsColAtDeadline'] : [])];
    const rows = lines.map(line => `<tr><td>${esc(goalCostName(state, line.key))}</td><td class="gl-num">${numOrUnknown(line.have)}</td>${withReserved
        ? `<td class="gl-num">${line.reserved > 0 ? esc(fmtNum(line.reserved)) : ''}</td>` : ''}<td class="gl-num gl-eta-cell">${toCapCellHtml(line)}</td>${ahead
        ? `<td class="gl-num">${atDeadlineHtml(line)}</td>` : ''}</tr>`);
    const basis = eta.flow ? t('ov.gsBasis', { weeks: eta.flow.weeks }) : t('ov.gsBasisNoFlow');
    return `${notes.map(note => `<div class="gl-eta">${note}</div>`).join('')}${costTableHtml(state, heads, rows)}<p class="gl-reason">${esc(basis)}</p>`;
}

function stockpileCardHtml(state: GameState, goals: readonly RemodelGoal[], stockpile: StockpileGoal, eta: GoalEta): string {
    const remove = `<button type="button" class="ov-btn gl-act" data-act="stock-remove" title="${esc(t('ov.glRemove'))}" aria-label="${esc(t('ov.glRemove'))}">✕</button>`;
    const until = `<label class="gl-until">${esc(t('ov.gsUntil'))}<input type="date" class="rs-search gl-until-input" value="${esc(stockpile.until ?? '')}" aria-label="${esc(t('ov.gsUntil'))}"></label>`;
    return `<article class="gl-card gl-stock-card"><div class="gl-head"><span class="gl-no"></span><span class="gl-kind">${esc(t('ov.gsKind'))}</span><span class="gl-target">${esc(t('ov.gsTarget'))}</span>${until}<span class="grow"></span><span class="gl-acts">${remove}</span></div><div class="gl-stock-body">${stockpileBodyHtml(state, goals, stockpile, eta)}</div></article>`;
}

/** 新增目標的候選表格：還能改造、尚未設目標的艦，依「離下一段改造多近」排序。 */
export function goalCandidatesHtml(state: GameState, goals: readonly RemodelGoal[], query: string): string {
    const taken = new Set(goals.map(goal => goal.shipId));
    const rows = state.ownedShips().flatMap(ship => {
        if (taken.has(ship.id)) return [];
        const targets = remodelTargets(state, ship.masterId);
        const next = remodelStep(state, ship.masterId);
        if (!targets.length || !next) return [];
        const name = state.shipName(ship.masterId);
        return fuzzyMatch(name, query) ? [{ ship, name, targets, next: next.level, gap: Math.max(0, next.level - ship.lv) }] : [];
    }).sort((a, b) => a.gap - b.gap || b.ship.lv - a.ship.lv || a.ship.id - b.ship.id);
    if (!rows.length) return `<div class="ov-empty">${esc(t(query.trim() ? 'ov.glNoMatch' : 'ov.glNoCandidates'))}</div>`;
    const heads = ['ov.glColShip', 'ov.glColLv', 'ov.glColNext', 'ov.glColTarget', ''];
    return `<div class="vl-table-wrap gl-table-wrap gl-cand-wrap"><table class="vl-table gl-table"><thead><tr>${heads.map((head, i) =>
        `<th${i === 1 || i === 2 ? ' class="gl-num"' : ''}>${head ? esc(t(head)) : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
        `<tr data-ship="${row.ship.id}"><td>${esc(row.name)}</td><td class="gl-num">${row.ship.lv}</td><td class="gl-num">Lv${row.next}${row.gap === 0
            ? ` <span class="gl-reached">${esc(t('ov.glReached'))}</span>` : ''}</td><td><select class="rs-search gl-pick" aria-label="${esc(t('ov.glColTarget'))}">${row.targets.map(id =>
            `<option value="${id}">${esc(state.shipName(id))}</option>`).join('')}</select></td><td><button type="button" class="ov-btn gl-act" data-act="add" data-ship="${row.ship.id}">${esc(t('ov.glAddBtn'))}</button></td></tr>`).join('')}</tbody></table></div>`;
}

/** 整個分區的 HTML（含外殼與四塊內容）；遊戲資料未載入時只有一句說明。 */
export function goalsHtml(state: GameState, goals: readonly RemodelGoal[], stockpile: StockpileGoal | null, query: string, eta: GoalEta): string {
    if (state.master.size === 0) return `<div class="ov-empty">${esc(t('ov.glNoMaster'))}</div>`;
    const { plans, totals, arrivals } = goalPlans(state, goals, eta);
    return `<div class="gl">
        <p class="ov-note dim">${esc(t('ov.glIntro'))}</p>
        <div class="gl-stock">${stockpile ? stockpileCardHtml(state, goals, stockpile, eta) : ''}</div>
        <div class="gl-list">${goalListHtml(state, plans, arrivals, eta, stockpile !== null)}</div>
        <div class="gl-totals">${goalTotalsHtml(state, plans, totals)}</div>
        <details class="gl-add"${goals.length || stockpile ? '' : ' open'}><summary>${esc(t('ov.glAdd'))}</summary>
            <div class="ov-toolbar gl-add-bar gl-stock-add"${stockpile ? ' hidden' : ''}><span class="gl-add-label">${esc(t('ov.gsKind'))}</span><span class="dim">${esc(t('ov.gsTarget'))}</span><label class="gl-until">${esc(t('ov.gsUntilOptional'))}<input type="date" class="rs-search gl-new-until" aria-label="${esc(t('ov.gsUntilOptional'))}"></label><button type="button" class="ov-btn gl-act" data-act="stock-add">${esc(t('ov.glAddBtn'))}</button></div>
            <div class="ov-toolbar gl-add-bar"><span class="gl-add-label">${esc(t('ov.glRemodelAdd'))}</span><input class="rs-search gl-search" type="search" autocomplete="off" value="${esc(query)}" placeholder="${esc(t('ov.glSearch'))}" aria-label="${esc(t('ov.glSearch'))}"></div>
            <div class="gl-cands">${goalCandidatesHtml(state, goals, query)}</div>
        </details>
    </div>`;
}

// 備蓄只有一列，直接 put／delete，不碰改造目標的列。
async function saveStockpile(stockpile: StockpileGoal | null): Promise<void> {
    if (stockpile) await db.goals.put(stockpileToRow(stockpile));
    else await db.goals.delete(STOCKPILE_GOAL_KEY);
}

// 整份目標在同一個 transaction 內換掉：順序存在每一列的 order，逐列 put 中途失敗會留下
// 半套順序。只動 remodel: 前綴的列，日後其他種類的目標不受影響。
async function saveGoals(goals: readonly RemodelGoal[]): Promise<void> {
    await db.transaction('rw', db.goals, async () => {
        await db.goals.where(':id').startsWith('remodel:').delete();
        await db.goals.bulkPut(goalsToRows(goals));
    });
}

export const goalsSection: OverviewSection = {
    id: 'goals', titleKey: 'ov.goals',
    async render(el, ctx: SectionContext) {
        // 先畫殼、綁事件，再讀 DB（design-guidelines §4.2.1）：讀取卡住或失敗都不留白。
        el.innerHTML = `<div class="ov-empty">${esc(t('ov.loading'))}</div>`;
        let goals: RemodelGoal[] = [];
        let stockpile: StockpileGoal | null = null;
        let flow: ObservedFlow | null = null;
        let rows: GoalRow[] = [];
        let loaded = false;
        // 推算起點用每次重繪的當下：持有量是即時的，流量則是進入分區時讀的那份。
        const eta = (): GoalEta => ({ flow, now: Date.now() });
        const search = () => el.querySelector<HTMLInputElement>('.gl-search')?.value ?? '';
        // 外殼不存在（剛讀完 DB，或先前遊戲資料未載入）時整個重建；否則只換三塊內容。
        // 備蓄卡片：出現／消失時整張重建，其餘只換內容，期限輸入框才不會被打斷。
        const drawStock = (now: GoalEta) => {
            const box = el.querySelector<HTMLElement>('.gl-stock')!;
            el.querySelector<HTMLElement>('.gl-stock-add')!.hidden = stockpile !== null;
            if (!stockpile) { box.innerHTML = ''; return; }
            const body = box.querySelector('.gl-stock-body');
            if (!body) box.innerHTML = stockpileCardHtml(ctx.state, goals, stockpile, now);
            else body.innerHTML = stockpileBodyHtml(ctx.state, goals, stockpile, now);
        };
        const draw = () => {
            if (!loaded) return;
            if (!el.querySelector('.gl')) { el.innerHTML = goalsHtml(ctx.state, goals, stockpile, '', eta()); return; }
            const now = eta();
            const { plans, totals, arrivals } = goalPlans(ctx.state, goals, now);
            drawStock(now);
            el.querySelector('.gl-list')!.innerHTML = goalListHtml(ctx.state, plans, arrivals, now, stockpile !== null);
            el.querySelector('.gl-totals')!.innerHTML = goalTotalsHtml(ctx.state, plans, totals);
            el.querySelector('.gl-cands')!.innerHTML = goalCandidatesHtml(ctx.state, goals, search());
        };
        // 畫面先反映新順序，寫入失敗時明說並退回，不讓畫面與資料庫不一致。
        const update = (next: RemodelGoal[]) => {
            const previous = goals;
            goals = next;
            draw();
            saveGoals(next).catch(error => {
                goals = previous;
                draw();
                const list = el.querySelector('.gl-list');
                list?.insertAdjacentHTML('afterbegin', `<div class="ov-empty">${esc(t('ov.glSaveFailed',
                    { msg: String((error as Error)?.message ?? error) }))}</div>`);
            });
        };
        const saveFailed = (error: unknown) => el.querySelector('.gl-list')?.insertAdjacentHTML('afterbegin',
            `<div class="ov-empty">${esc(t('ov.glSaveFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`);
        const updateStock = (next: StockpileGoal | null) => {
            const previous = stockpile;
            stockpile = next;
            draw();
            saveStockpile(next).catch(error => {
                stockpile = previous;
                // 期限輸入框的值也要退回，所以整張卡重建。
                el.querySelector('.gl-stock')!.innerHTML = '';
                draw();
                saveFailed(error);
            });
        };
        el.addEventListener('change', event => {
            const input = event.target as HTMLInputElement;
            if (!input.classList.contains('gl-until-input') || !stockpile) return;
            updateStock({ until: input.value || null });
        });
        el.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.gl-act');
            if (!button || button.disabled) return;
            if (button.dataset.act === 'stock-add') {
                if (!stockpile) updateStock({ until: el.querySelector<HTMLInputElement>('.gl-new-until')?.value || null });
                return;
            }
            if (button.dataset.act === 'stock-remove') { updateStock(null); return; }
            const shipId = Number(button.dataset.ship);
            const index = goals.findIndex(goal => goal.shipId === shipId);
            const act = button.dataset.act;
            if (act === 'add') {
                const targetMst = Number(button.closest('tr')?.querySelector<HTMLSelectElement>('.gl-pick')?.value);
                if (index < 0 && targetMst > 0) update([...goals, { shipId, targetMst }]);
            } else if (act === 'remove' && index >= 0) {
                update(goals.filter(goal => goal.shipId !== shipId));
            } else if ((act === 'up' || act === 'down') && index >= 0) {
                const to = index + (act === 'up' ? -1 : 1);
                if (to < 0 || to >= goals.length) return;
                const next = [...goals];
                [next[index], next[to]] = [next[to], next[index]];
                update(next);
            }
        });
        el.addEventListener('input', event => {
            if (!(event.target as HTMLElement).classList.contains('gl-search')) return;
            el.querySelector('.gl-cands')!.innerHTML = goalCandidatesHtml(ctx.state, goals, search());
        });
        ctx.onStateChange?.(() => { if (el.isConnected) draw(); });
        try {
            // 流量讀不到只影響湊齊日（顯示不可考），不擋住目標本身。
            [rows, flow] = await Promise.all([
                db.goals.toArray(),
                loadGoalFlow(ctx.state).catch(() => null),
            ]);
        } catch (error) {
            el.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            return;
        }
        goals = goalsFromRows(rows);
        stockpile = stockpileFromRows(rows);
        loaded = true;
        draw();
    },
};
