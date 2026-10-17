// 艦娘士氣（cond）的分級與回復到 49 的推算。
//
// **純函式、零 chrome.* 依賴**（同 repair.ts），可用 Node／Vitest 驗證。
// 遊戲不推送士氣回復；伺服器只在「進入母港畫面」時，依伺服器時鐘每 3 分鐘一格補算
// 自上次回復以來的份量。因此本模組只能從最近一次 `api_port/port` 的 cond 與其觀測時間推算，
// 產出一律是推算值，UI 必須如實標示。
//
// 規則來源：wikiwiki.jp/kancolle「疲労度」「野埼」兩頁。
//   ・自然回復：伺服器時鐘每 3 分鐘 +3，只回復到 49，不會自行進入キラ。
//   ・野埼給糧：計時滿 15 分後進母港，同隊他艦 +2（野埼）／+3（野埼改），上限 54；
//     多個週期一次結算（floor(經過時間 / 15 分)），且**先自然回復、再給糧**。
//   ・入渠（使用者確認之遊戲行為）：完成當下 cond 未滿 40 即補到 40，之後從完成時刻起照常
//     自然回復；入渠期間的自然回復也照算。自然結束以 api_complete_time 為完成時刻，入渠時直接
//     用高速修復材則以該請求時刻為準（見 ShipView.condFloorAt）。

import type { FleetView, ShipView } from './state';
import {
    MORALE_CAP, MORALE_INTERVAL_MS, MORALE_SOURCE_MIN_COND, TIMER_SAFETY_MS, planMoraleSupply,
} from './repair';

export const COND_STEP_MS = 3 * 60_000;     // 自然回復週期（伺服器時鐘的 3 分鐘邊界）
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

/** (from, to] 之間跨過的 3 分鐘邊界數。JST 與 UTC 相差整 9 小時，邊界位置不受時區影響。 */
function stepsBetween(from: number, to: number): number {
    if (to <= from) return 0;
    return Math.floor(to / COND_STEP_MS) - Math.floor(from / COND_STEP_MS);
}

/** 只計自然回復時，cond 在 `at` 進母港會是多少。49 以上不受自然回復影響。 */
export function projectNaturalCond(cond: number, asOf: number, at: number): number {
    if (cond >= COND_NATURAL_CAP) return cond;
    return Math.min(COND_NATURAL_CAP, cond + COND_STEP_GAIN * stepsBetween(asOf, at));
}

/** 只計自然回復時到 49 的時刻；已達 49 回 null。 */
export function naturalRecoveryAt(cond: number, asOf: number): number | null {
    if (cond >= COND_NATURAL_CAP) return null;
    const steps = Math.ceil((COND_NATURAL_CAP - cond) / COND_STEP_GAIN);
    return (Math.floor(asOf / COND_STEP_MS) + steps) * COND_STEP_MS;
}

type CondShip = Pick<ShipView, 'cond' | 'inDock' | 'dockCompleteAt' | 'condFloorAt'>;

/**
 * 入渠把 cond 補到 40 的時刻：高速修復的請求時刻優先，否則取入渠中的完成時刻。
 * 早於觀測時刻的不算——那次進母港的 cond 已包含補值。
 */
function dockFloorAt(ship: CondShip, asOf: number): number | null {
    const at = ship.condFloorAt ?? (ship.inDock ? ship.dockCompleteAt : null);
    return at != null && at > asOf ? at : null;
}

/** cond 在 `at` 進母港會是多少：自然回復，加上入渠完成補到 40 後的接續回復。 */
export function projectShipCond(ship: CondShip, asOf: number, at: number): number {
    const floorAt = dockFloorAt(ship, asOf);
    if (floorAt === null || at < floorAt) return projectNaturalCond(ship.cond, asOf, at);
    const floored = Math.max(projectNaturalCond(ship.cond, asOf, floorAt), COND_DOCK_FLOOR);
    return projectNaturalCond(floored, floorAt, at);
}

/** 不計給糧時單艦到 49 的時刻（含入渠補值）；已達 49 回 null。 */
export function shipRecoveryAt(ship: CondShip, asOf: number): number | null {
    const natural = naturalRecoveryAt(ship.cond, asOf);
    const floorAt = dockFloorAt(ship, asOf);
    if (natural === null || floorAt === null || floorAt >= natural) return natural;
    const floored = Math.max(projectNaturalCond(ship.cond, asOf, floorAt), COND_DOCK_FLOOR);
    return Math.min(natural, naturalRecoveryAt(floored, floorAt) ?? floorAt);
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
        const natural = shipRecoveryAt(ship, asOf);
        if (natural === null) continue;
        below += 1;
        naturalMax = Math.max(naturalMax ?? natural, natural);
        const eta = supply?.recovers(index) ? withSupplyAt(ship, asOf, natural, supply) : natural;
        at = Math.max(at ?? eta, eta);
    }
    return { at, naturalAt: naturalMax, below, supplyHelps: at !== null && naturalMax !== null && at < naturalMax };
}

interface SupplyContext {
    anchor: number;
    perTick: number;
    source: ShipView;
    recovers(index: number): boolean;
}

function supplyContext(fleet: FleetView): SupplyContext | undefined {
    const anchor = fleet.moraleAnchor;
    if (typeof anchor !== 'number') return undefined;
    let plan = planMoraleSupply(fleet);
    // low-cond 是 planMoraleSupply 的最後一道檢查：野埼現在 cond 低於 30 不發動，但它也會
    // 自然回復。先把它抬到門檻上確認其餘條件，實際門檻改在每個候選時刻判定。
    if (plan.reason === 'low-cond') {
        plan = planMoraleSupply({
            ...fleet,
            ships: fleet.ships.map((s, i) => i === plan.sourceIndex ? { ...s, cond: MORALE_SOURCE_MIN_COND } : s),
        });
    }
    if (!plan.active) return undefined;
    const slots = plan.slots;
    return {
        anchor, perTick: plan.perTick, source: fleet.ships[plan.sourceIndex]!,
        recovers: index => slots[index]?.willRecover === true,
    };
}

/** 單艦納入給糧後到 49 的最早時刻；最晚等於純自然回復的時刻。 */
function withSupplyAt(ship: ShipView, asOf: number, naturalAt: number, supply: SupplyContext): number {
    const { anchor, perTick, source } = supply;
    const supplyTicks = (at: number) => Math.max(0, Math.floor((at - anchor - TIMER_SAFETY_MS) / MORALE_INTERVAL_MS));
    // 候選時刻：自然回復的每個 3 分鐘邊界，加上每個給糧週期的門檻。
    const candidates: number[] = [];
    for (let at = (Math.floor(asOf / COND_STEP_MS) + 1) * COND_STEP_MS; at < naturalAt; at += COND_STEP_MS) {
        candidates.push(at);
    }
    for (let at = anchor + MORALE_INTERVAL_MS + TIMER_SAFETY_MS; at < naturalAt; at += MORALE_INTERVAL_MS) {
        if (at > asOf) candidates.push(at);
    }
    candidates.sort((a, b) => a - b);
    for (const at of candidates) {
        const natural = projectShipCond(ship, asOf, at);
        const ticks = supplyTicks(at);
        // 進母港時先自然回復，野埼的 cond 要在那之後仍 ≥30 才發動。
        if (ticks === 0 || projectShipCond(source, asOf, at) < MORALE_SOURCE_MIN_COND) continue;
        if (Math.min(MORALE_CAP, natural + perTick * ticks) >= COND_NATURAL_CAP) return at;
    }
    return naturalAt;
}
