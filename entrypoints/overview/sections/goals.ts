// 目標規劃：玩家指定「某艘艦改到某個形態」，列出還缺的等級、經驗、各項消耗與資材湊齊日。
// 計算全在 utils/remodel-goals.ts 與 utils/goal-arrival.ts（純函式）；本檔只負責 HTML、事件與讀 DB。
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
import { db, type ResourceRow } from '@/utils/db';
import { esc, fmtNum, fuzzyMatch } from '../lib';

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
    const a = days(line.earliest);
    if (line.latest === null) return esc(t('ov.glDaysMin', { n: a }));
    const b = days(line.latest);
    return esc(a === b ? t('ov.glDays', { n: a }) : t('ov.glDaysRange', { a, b }));
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

/** 目標清單（卡片）；沒有目標時是一句提示。 */
export function goalListHtml(state: GameState, plans: readonly GoalPlan[], arrivals: readonly (GoalArrival | null)[], eta: GoalEta): string {
    if (!plans.length) return `<div class="ov-empty">${esc(t('ov.glEmpty'))}</div>`;
    return plans.map((plan, index) => cardHtml(state, plan, arrivals[index] ?? null, eta, index, plans.length)).join('');
}

/** 合計：進行中的目標兩個以上才有意義，否則回空字串。 */
export function goalTotalsHtml(state: GameState, plans: readonly GoalPlan[], totals: readonly GoalTotalLine[]): string {
    if (plans.filter(plan => plan.status === 'active').length < 2 || !totals.length) return '';
    return `<h3 class="ov-subhead">${esc(t('ov.glTotals'))}</h3>${costTableHtml(state,
        ['ov.glColItem', 'ov.glColNeedTotal', 'ov.glColStock', 'ov.glColShort'], totals.map(line => totalRow(state, line)))}`;
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

/** 整個分區的 HTML（含外殼與三塊內容）；遊戲資料未載入時只有一句說明。 */
export function goalsHtml(state: GameState, goals: readonly RemodelGoal[], query: string, eta: GoalEta): string {
    if (state.master.size === 0) return `<div class="ov-empty">${esc(t('ov.glNoMaster'))}</div>`;
    const { plans, totals, arrivals } = goalPlans(state, goals, eta);
    return `<div class="gl">
        <p class="ov-note dim">${esc(t('ov.glIntro'))}</p>
        <div class="gl-list">${goalListHtml(state, plans, arrivals, eta)}</div>
        <div class="gl-totals">${goalTotalsHtml(state, plans, totals)}</div>
        <details class="gl-add"${goals.length ? '' : ' open'}><summary>${esc(t('ov.glAdd'))}</summary>
            <div class="ov-toolbar gl-add-bar"><input class="rs-search gl-search" type="search" autocomplete="off" value="${esc(query)}" placeholder="${esc(t('ov.glSearch'))}" aria-label="${esc(t('ov.glSearch'))}"></div>
            <div class="gl-cands">${goalCandidatesHtml(state, goals, query)}</div>
        </details>
    </div>`;
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
        let flow: ObservedFlow | null = null;
        let loaded = false;
        // 推算起點用每次重繪的當下：持有量是即時的，流量則是進入分區時讀的那份。
        const eta = (): GoalEta => ({ flow, now: Date.now() });
        const search = () => el.querySelector<HTMLInputElement>('.gl-search')?.value ?? '';
        // 外殼不存在（剛讀完 DB，或先前遊戲資料未載入）時整個重建；否則只換三塊內容。
        const draw = () => {
            if (!loaded) return;
            if (!el.querySelector('.gl')) { el.innerHTML = goalsHtml(ctx.state, goals, '', eta()); return; }
            const now = eta();
            const { plans, totals, arrivals } = goalPlans(ctx.state, goals, now);
            el.querySelector('.gl-list')!.innerHTML = goalListHtml(ctx.state, plans, arrivals, now);
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
        el.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.gl-act');
            if (!button || button.disabled) return;
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
            [goals, flow] = await Promise.all([
                db.goals.toArray().then(goalsFromRows),
                loadGoalFlow(ctx.state).catch(() => null),
            ]);
        } catch (error) {
            el.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            return;
        }
        loaded = true;
        draw();
    },
};
