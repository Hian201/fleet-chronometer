// 艦娘士氣（cond）的分級與回復到 49（野埼給糧中為 54）的推算。
//
// **純函式、零 chrome.* 依賴**（同 repair.ts），可用 Node／Vitest 驗證。
// 遊戲不推送士氣回復；伺服器只在「進入母港畫面」時，依伺服器時鐘每 3 分鐘一格補算
// 自上次回復以來的份量。單憑一次母港無法得知 3 分鐘週期的相位（且本機時鐘與伺服器可能有誤差），
// 相位由 GameState 從前後兩次母港推估（CondPhase）；推算一律取相位範圍內最壞的情況，
// 保證回復次數取下界、到 49 的時刻取上界，避免提早誤報。
// 產出一律是推算值，UI 必須如實標示。
//
// 規則來源：wikiwiki.jp/kancolle「疲労度」「野埼」兩頁。
//   ・自然回復：每 3 分鐘 +3，只回復到 49，不會自行進入キラ。
//   ・野埼給糧：計時滿 15 分後進母港，同隊他艦 +2（野埼）／+3（野埼改），上限 54；
//     多個週期一次結算（floor(經過時間 / 15 分)），且**先自然回復、再給糧**。
//   ・入渠自然結束：入渠期間的自然回復照算，完成當下仍未滿 40 才補到 40，之後從完成時刻起照常
//     自然回復（wikiwiki「疲労度」）。完成時刻取 api_complete_time 或 ndock 觀測出渠的時刻。
//   ・高速修復（使用者確認之遊戲行為，與 ElectronicObserver Data/ShipData.cs `Repair()`＋
//     FleetManager `CalculateConditionHealingEstimation` 一致）：用桶當下把母港觀測的 cond
//     補到 40，自然回復仍從母港時刻起算——回港後到用桶之間的時間照樣算進去，不從用桶時刻重新起算。
//     伺服器只在進母港時補算自然回復，用桶時改的是母港當時的值。到 49 不早於用桶時刻。
//   補值後面板 cond 已是 40，推算一律從 ShipView.condAtPort（母港觀測的原值）起算。

import type { FleetView, ShipView } from './state';
import {
    MORALE_CAP, MORALE_INTERVAL_MS, MORALE_SOURCE_MIN_COND, TIMER_SAFETY_MS, moraleTimer, planMoraleSupply,
} from './repair';

export const COND_STEP_MS = 3 * 60_000;     // 自然回復週期（3 分鐘）
export const COND_STEP_GAIN = 3;            // 每週期回復量
export const COND_NATURAL_CAP = 49;         // 自然回復上限
export const COND_SPARKLE = 50;             // キラ（戰意高揚）下限
export const COND_DOCK_FLOOR = 40;          // 入渠完成時補到的 cond

/**
 * 對照遊戲疲勞度分級：
 *   heavy 0–19（赤臉）／tired 20–29（橙臉）／mild 30–39（遊戲不畫臉、只讓「給」圖示閃爍）
 *   ／normal 40–49／sparkle 50 以上。
 */
export type CondTier = 'sparkle' | 'normal' | 'mild' | 'tired' | 'heavy';

export function condTier(cond: number): CondTier {
    if (cond >= COND_SPARKLE) return 'sparkle';
    if (cond >= 40) return 'normal';
    if (cond >= 30) return 'mild';
    if (cond >= 20) return 'tired';
    return 'heavy';
}

/**
 * 自然回復週期的相位：伺服器回復時刻對 3 分鐘取餘數（毫秒）可能落在的範圍，以 [0, COND_STEP_MS]
 * 內不重疊的閉區間表示。未觀測時為整圈（COND_PHASE_UNKNOWN），推算退回「從觀測時刻起每滿 3 分鐘」的
 * 保守下界／上界；GameState 以前後兩次母港的 cond 變化逐次縮小（condPhaseConstraint）。
 */
export type CondPhase = readonly (readonly [number, number])[];
export const COND_PHASE_UNKNOWN: CondPhase = [[0, COND_STEP_MS]];
// 封包時間戳是本機收到回應的時刻，與伺服器結算時刻有往返延遲與時鐘誤差，每個觀測區間兩端各放寬。
const COND_PHASE_MARGIN_MS = 2_000;

const phaseOf = (t: number) => ((t % COND_STEP_MS) + COND_STEP_MS) % COND_STEP_MS;

/** 從 `from` 起、長 `length` 的環狀區段（模 3 分鐘），拆成不跨 0 的閉區間；滿一圈即整圈。 */
function phaseArc(from: number, length: number): CondPhase {
    if (length >= COND_STEP_MS) return COND_PHASE_UNKNOWN;
    const lo = phaseOf(from);
    const hi = lo + length;
    return hi <= COND_STEP_MS ? [[lo, hi]] : [[0, hi - COND_STEP_MS], [lo, COND_STEP_MS]];
}

/**
 * 前後兩次母港 p1 < p2 之間回復了 `ticks` 次時，相位必須落在的範圍。(p1, p2] 必含
 * floor(Δ/3分)＝m 次回復，剩下長 r 的尾段（模 3 分鐘即 p1 之後的 r）內有無回復決定多不多一次：
 * m+1 次＝相位在 p1 之後的 r 內，m 次＝在其外。次數不是 m 或 m+1（有自然回復以外的增減）回 null。
 */
export function condPhaseConstraint(p1: number, p2: number, ticks: number): CondPhase | null {
    if (!(p2 > p1) || !Number.isInteger(ticks)) return null;
    const m = Math.floor((p2 - p1) / COND_STEP_MS);
    const r = p2 - p1 - m * COND_STEP_MS;
    if (ticks === m + 1) return phaseArc(p1 - COND_PHASE_MARGIN_MS, r + 2 * COND_PHASE_MARGIN_MS);
    if (ticks === m) return phaseArc(p2 - COND_PHASE_MARGIN_MS, COND_STEP_MS - r + 2 * COND_PHASE_MARGIN_MS);
    return null;
}

/** 既有範圍與新觀測取交集；互相矛盾（例如維護後伺服器相位改變）時改信新觀測。 */
export function narrowCondPhase(current: CondPhase, constraint: CondPhase): CondPhase {
    const next: [number, number][] = [];
    for (const [al, ah] of current) {
        for (const [bl, bh] of constraint) {
            const lo = Math.max(al, bl);
            const hi = Math.min(ah, bh);
            if (lo <= hi) next.push([lo, hi]);
        }
    }
    return next.length ? next.sort((a, b) => a[0] - b[0]) : constraint;
}

/** `asOf` 之後第一次回復最晚可能在多久後（相位範圍內取最壞），範圍 (0, 3 分鐘]。 */
function latestFirstTickDelay(asOf: number, phase: CondPhase): number {
    const x = phaseOf(asOf);
    let worst = 0;
    for (const [lo, hi] of phase) {
        // 相位可能正好等於 asOf：那次回復算不算進觀測不確定，保守視為下一次在整 3 分鐘後。
        if ((lo <= x && x <= hi) || (x === 0 && hi === COND_STEP_MS)) return COND_STEP_MS;
        worst = Math.max(worst, phaseOf(hi - x));
    }
    return worst > 0 ? worst : COND_STEP_MS;
}

/** (from, to] 之間保證至少發生的回復次數（相位範圍內取最壞）。 */
function stepsBetween(from: number, to: number, phase: CondPhase): number {
    if (to <= from) return 0;
    const first = latestFirstTickDelay(from, phase);
    const span = to - from;
    return span < first ? 0 : 1 + Math.floor((span - first) / COND_STEP_MS);
}

/** 只計自然回復時，cond 在 `at` 進母港保證至少是多少。49 以上不受自然回復影響。 */
export function projectNaturalCond(cond: number, asOf: number, at: number, phase: CondPhase = COND_PHASE_UNKNOWN): number {
    if (cond >= COND_NATURAL_CAP) return cond;
    return Math.min(COND_NATURAL_CAP, cond + COND_STEP_GAIN * stepsBetween(asOf, at, phase));
}

/** 只計自然回復時保證已達 49 的時刻（相位範圍內取最晚）；已達 49 回 null。 */
export function naturalRecoveryAt(cond: number, asOf: number, phase: CondPhase = COND_PHASE_UNKNOWN): number | null {
    if (cond >= COND_NATURAL_CAP) return null;
    const steps = Math.ceil((COND_NATURAL_CAP - cond) / COND_STEP_GAIN);
    return asOf + latestFirstTickDelay(asOf, phase) + (steps - 1) * COND_STEP_MS;
}

type CondShip = Pick<ShipView, 'cond' | 'condAtPort' | 'inDock' | 'dockCompleteAt' | 'condFloorAt' | 'condFloorByBucket'>;

/** 推算的起點：觀測時刻（母港）的 cond。高速修復已在畫面上補值時取補值前的原值。 */
const portCond = (ship: CondShip) => ship.condAtPort ?? ship.cond;

/**
 * 入渠把 cond 補到 40 的時刻：高速修復的請求時刻優先，否則取入渠中的完成時刻。
 * 早於觀測時刻的不算——那次進母港的 cond 已包含補值。
 */
function dockFloorAt(ship: CondShip, asOf: number): number | null {
    const at = ship.condFloorAt ?? (ship.inDock ? ship.dockCompleteAt : null);
    return at != null && at > asOf ? at : null;
}

/** cond 在 `at` 進母港會是多少：自然回復，加上入渠完成補到 40 後的接續回復。 */
export function projectShipCond(ship: CondShip, asOf: number, at: number, phase: CondPhase = COND_PHASE_UNKNOWN): number {
    const floorAt = dockFloorAt(ship, asOf);
    const cond = portCond(ship);
    if (floorAt === null || at < floorAt) return projectNaturalCond(cond, asOf, at, phase);
    // 高速修復：母港的值補到 40，自然回復仍從母港時刻起算。
    if (ship.condFloorByBucket) return projectNaturalCond(Math.max(cond, COND_DOCK_FLOOR), asOf, at, phase);
    const floored = Math.max(projectNaturalCond(cond, asOf, floorAt, phase), COND_DOCK_FLOOR);
    return projectNaturalCond(floored, floorAt, at, phase);
}

/** 不計給糧時單艦到 49 的時刻（含入渠補值）；已達 49 回 null。 */
export function shipRecoveryAt(ship: CondShip, asOf: number, phase: CondPhase = COND_PHASE_UNKNOWN): number | null {
    const cond = portCond(ship);
    const natural = naturalRecoveryAt(cond, asOf, phase);
    const floorAt = dockFloorAt(ship, asOf);
    if (natural === null || floorAt === null || floorAt >= natural) return natural;
    // 高速修復：從母港時刻以 40 起算；用桶時已超過該時刻者在用桶當下就到 49。
    if (ship.condFloorByBucket) {
        return Math.max(floorAt, naturalRecoveryAt(Math.max(cond, COND_DOCK_FLOOR), asOf, phase) ?? floorAt);
    }
    const floored = Math.max(projectNaturalCond(cond, asOf, floorAt, phase), COND_DOCK_FLOOR);
    return Math.min(natural, naturalRecoveryAt(floored, floorAt, phase) ?? floorAt);
}

export interface CondRecoveryEta {
    /** 全隊進母港即可達 49 的最早推算時刻；全員已達 49 時為 null。 */
    at: number | null;
    /** 不計給糧時的時刻（含入渠補值，比較用）；全員已達 49 時為 null。 */
    naturalAt: number | null;
    /** 目前未滿 49 的艦數。 */
    below: number;
    /** 野埼給糧是否讓時刻提前。 */
    supplyHelps: boolean;
}

/**
 * 全隊士氣回到 49 的推算時刻。
 *
 * 假設玩家在時刻 X **只進一次母港**：自然回復與給糧都是進母港時一次結算，給糧的
 * floor(經過 / 15 分) 讓「分多次進港」不會比一次進港多，所以單次進港就是最早可達的情況。
 * 給糧的週期門檻沿用面板倒數的 1 分鐘安全緩衝（TIMER_SAFETY_MS），兩邊顯示的時刻才一致。
 *
 * 出門中（遠征／出擊，moraleAnchor === null）或 cond 觀測時間不可考時回 undefined：
 * 回港時的士氣扣減未知，算出來的時刻沒有意義。
 */
export function fleetCondRecoveryEta(fleet: FleetView): CondRecoveryEta | undefined {
    const asOf = fleet.condAsOf;
    if (asOf === undefined || fleet.mission || fleet.moraleAnchor === null) return undefined;

    const supply = supplyContext(fleet);
    let at: number | null = null;
    let naturalMax: number | null = null;
    let below = 0;
    for (const [index, ship] of fleet.ships.entries()) {
        const natural = shipRecoveryAt(ship, asOf, fleet.condPhase);
        if (natural === null) continue;
        below += 1;
        naturalMax = Math.max(naturalMax ?? natural, natural);
        const eta = supply?.recovers(index) ? withSupplyAt(ship, asOf, natural, supply) : natural;
        at = Math.max(at ?? eta, eta);
    }
    return { at, naturalAt: naturalMax, below, supplyHelps: at !== null && naturalMax !== null && at < naturalMax };
}

/**
 * 野埼給糧發動中的艦隊，給糧對象全員到 54（給糧上限）的推算時刻。給糧每次的回復量全隊相同，
 * 所以就是給糧對象中士氣最低那艘到 54 的時刻。野埼自身、入渠中、已達 54 的艦不列入。
 *
 * 只在隊上有 cond 未滿 49 的艦時才有值（與疲勞倒數同條件；平時的給糧計時在泊地分組）：
 * 全員 ≥49 或無給糧對象時回 null。給糧不發動、出門中或錨點／觀測時間不可考時回 undefined
 * （呼叫端改用一般的 49 推算）。進港次數假設與 fleetCondRecoveryEta 相同。
 */
export function fleetSupplyCapAt(fleet: FleetView): number | null | undefined {
    const asOf = fleet.condAsOf;
    if (asOf === undefined || fleet.mission) return undefined;
    const supply = supplyContext(fleet);
    if (!supply) return undefined;
    if (!fleet.ships.some(s => portCond(s) < COND_NATURAL_CAP)) return null;
    let at: number | null = null;
    for (const [index, ship] of fleet.ships.entries()) {
        if (!supply.recovers(index)) continue;
        const eta = supplyCapReachAt(ship, asOf, supply);
        at = Math.max(at ?? eta, eta);
    }
    return at;
}

export interface SupplyProgress {
    /** 現在進母港可結算的給糧次數。 */
    ticks: number;
    /** 給糧對象全員現在進母港即達 54（再等也不會多）。 */
    full: boolean;
    /** 給糧對象全員到 54 的推算時刻；已滿或無對象時為 null。 */
    fullAt: number | null;
}

/**
 * 泊地分組用：給糧發動中的艦隊「現在回母港」能得到什麼。與 fleetSupplyCapAt 不同，
 * 不以隊上有艦未滿 49 為前提（給糧常用來把 49 推到 54）。給糧不發動、出門中或錨點／
 * 觀測時間不可考時回 undefined。
 */
export function fleetSupplyProgress(fleet: FleetView, now: number = Date.now()): SupplyProgress | undefined {
    const asOf = fleet.condAsOf;
    if (asOf === undefined || fleet.mission) return undefined;
    const supply = supplyContext(fleet);
    if (!supply) return undefined;
    const { ticks } = moraleTimer(fleet.moraleAnchor as number, now, fleet.moraleHeld);
    let fullAt: number | null = null;
    for (const [index, ship] of fleet.ships.entries()) {
        if (!supply.recovers(index)) continue;
        const eta = supplyCapReachAt(ship, asOf, supply);
        fullAt = Math.max(fullAt ?? eta, eta);
    }
    const full = fullAt === null || fullAt <= now;
    return { ticks, full, fullAt: full ? null : fullAt };
}

/**
 * 單艦靠給糧到 54 的最早時刻。自然回復只到 49，超過 49 的份量只會在給糧週期門檻出現，
 * 所以候選時刻只需看各週期門檻。野埼自身 cond 會自然回復到 49，迴圈必定結束。
 */
function supplyCapReachAt(ship: ShipView, asOf: number, supply: SupplyContext): number {
    const { anchor, perTick, source, targetMin, phase } = supply;
    for (let ticks = 1; ; ticks++) {
        const at = anchor + ticks * MORALE_INTERVAL_MS + TIMER_SAFETY_MS;
        if (at <= asOf || projectShipCond(source, asOf, at, phase) < MORALE_SOURCE_MIN_COND) continue;
        const natural = projectShipCond(ship, asOf, at, phase);
        if (natural >= targetMin && natural + perTick * ticks >= MORALE_CAP) return at;
    }
}

interface SupplyContext {
    anchor: number;
    perTick: number;
    /** 給糧對象自然回復後須達的 cond（未改野埼 49）。 */
    targetMin: number;
    source: ShipView;
    phase: CondPhase;
    recovers(index: number): boolean;
}

function supplyContext(fleet: FleetView): SupplyContext | undefined {
    const raw = fleet.moraleAnchor;
    if (typeof raw !== 'number') return undefined;
    // 計時器因士氣條件暫停（moraleHeld）時，進港只結算 1 次、之後重新起算。推算一律假設單次進港，
    // 故保守地改從觀測時刻起算：第 1 次的時點與實際相同，之後只會晚、不會提早（通知不早響）。
    const anchor = fleet.moraleHeld && fleet.condAsOf !== undefined ? Math.max(raw, fleet.condAsOf) : raw;
    let plan = planMoraleSupply(fleet);
    // low-cond 是 planMoraleSupply 的最後一道檢查：野埼現在 cond 低於 30 不發動，但它也會
    // 自然回復。先把它抬到門檻上確認其餘條件，實際門檻改在每個候選時刻判定。
    if (plan.reason === 'low-cond') {
        plan = planMoraleSupply({
            ...fleet,
            ships: fleet.ships.map((s, i) => i === plan.sourceIndex ? { ...s, cond: MORALE_SOURCE_MIN_COND } : s),
        });
    }
    // supplyCapReachAt 的迴圈靠「每次給糧確實有加值、錨點是有限時刻」才會結束。
    if (!plan.active || !(plan.perTick > 0) || !Number.isFinite(anchor)) return undefined;
    const slots = plan.slots;
    return {
        anchor, perTick: plan.perTick, targetMin: plan.targetMinCond, source: fleet.ships[plan.sourceIndex]!,
        phase: fleet.condPhase ?? COND_PHASE_UNKNOWN,
        recovers: index => slots[index]?.willRecover === true,
    };
}

/** 單艦納入給糧後到 49 的最早時刻；最晚等於純自然回復的時刻。 */
function withSupplyAt(ship: ShipView, asOf: number, naturalAt: number, supply: SupplyContext): number {
    const { anchor, perTick, source, phase } = supply;
    const supplyTicks = (at: number) => Math.max(0, Math.floor((at - anchor - TIMER_SAFETY_MS) / MORALE_INTERVAL_MS));
    // 候選時刻：cond 推算值會跳動的時點——回港後與入渠／水桶補值後的每次保證回復、補值時刻本身，
    // 加上每個給糧週期門檻。
    const candidates: number[] = [];
    const addTicks = (start: number | null, includeStart: boolean) => {
        if (start === null) return;
        if (includeStart && start > asOf && start < naturalAt) candidates.push(start);
        for (let at = start + latestFirstTickDelay(start, phase); at < naturalAt; at += COND_STEP_MS) {
            if (at > asOf) candidates.push(at);
        }
    };
    addTicks(asOf, false);
    addTicks(dockFloorAt(ship, asOf), true);
    addTicks(dockFloorAt(source, asOf), true);
    for (let at = anchor + MORALE_INTERVAL_MS + TIMER_SAFETY_MS; at < naturalAt; at += MORALE_INTERVAL_MS) {
        if (at > asOf) candidates.push(at);
    }
    candidates.sort((a, b) => a - b);
    for (const at of candidates) {
        const natural = projectShipCond(ship, asOf, at, phase);
        const ticks = supplyTicks(at);
        // 進母港時先自然回復，野埼的 cond 要在那之後仍 ≥30 才發動。
        if (ticks === 0 || projectShipCond(source, asOf, at, phase) < MORALE_SOURCE_MIN_COND) continue;
        if (natural >= supply.targetMin && Math.min(MORALE_CAP, natural + perTick * ticks) >= COND_NATURAL_CAP) return at;
    }
    return naturalAt;
}
