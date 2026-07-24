// 泊地修理（工作艦）與母港給糧（補給艦）的涵蓋範圍與結算預估。
//
// **純函式、零 chrome.* 依賴**（同 retention.ts），可獨立編譯用 node 餵真實封包測試。
// 遊戲**不送任何泊地修理／給糧封包**——這兩個機制完全在伺服器端靜默結算，我們只能
// 從 api_port/port 的編成、HP、cond 反推，故本模組的產出一律是「預估」，UI 必須如實標示。
//
// 規則來源：wikiwiki.jp/kancolle 明石／朝日改／野埼三頁，並經使用者實測校正
// （2026-07-21）。與 wiki 摘要有出入處以使用者實測為準，逐條註明於下。

import type { FleetView, ShipView } from './state';

// ── 常數（皆已用 samples/start2-master.json 真實 master 驗證，非推測）──
export const REPAIR_FACILITY_MST = 86;      // 艦艇修理施設（俗稱吊車/吊臂）
export const AKASHI_MST = [182, 187];       // 明石 / 明石改
export const ASAHI_KAI_MST = 958;           // 朝日改（朝日 953 為練習巡洋艦，改造後才是工作艦）
export const NOSAKI_MST = [996, 1002];      // 野埼 / 野埼改

export const REPAIR_INTERVAL_MS = 20 * 60_000;   // 泊地修理最短結算間隔
export const MORALE_INTERVAL_MS = 15 * 60_000;   // 母港給糧結算間隔
export const MORALE_CAP = 54;                    // 給糧的 cond 上限（高於一般的 49，屬キラ區間）
export const MORALE_SOURCE_MIN_COND = 30;        // 野埼自身可發動的 cond 下限

// 雙工作艦（明石＋朝日改同列 1、2 號位且 2 號位帶吊車）的修理時間倍率。
// 使用者實測為 82%~84% 且與雙方等級有關，wiki 記 5/6≈83.3%——取 5/6 為代表值，
// **這是估算**，UI 不應把預估回復量講得像保證值。
export const ACCEL_FACTOR = 5 / 6;

// 計時器誤差緩衝：使用者實測「系統更新維修時間可能有約 1 分鐘誤差」，
// 建議預測時間向上取整並多留 1 分鐘，以免玩家提早出擊中斷修理。
export const TIMER_SAFETY_MS = 60_000;

const isAkashi = (mst: number) => AKASHI_MST.includes(mst);
const isRepairShip = (mst: number) => isAkashi(mst) || mst === ASAHI_KAI_MST;
const isNosaki = (mst: number) => NOSAKI_MST.includes(mst);

const hpRatio = (s: ShipView) => (s.maxhp > 0 ? s.hp / s.maxhp : 1);
/** 中破以上（HP ≤ 50%）＝泊地修理不受理，工作艦自身亦不得發動。 */
const isChuhaOrWorse = (s: ShipView) => hpRatio(s) <= 0.5;
/** 小破未滿（HP > 75%）＝野埼發動自身條件。 */
const isBelowShouha = (s: ShipView) => hpRatio(s) > 0.75;
const isResupplied = (s: ShipView) => s.fuel >= s.maxFuel && s.bull >= s.maxBull;
const facilityCount = (s: ShipView) =>
    s.gears.filter(g => g?.mst === REPAIR_FACILITY_MST).length
    + (s.exGear?.mst === REPAIR_FACILITY_MST ? 1 : 0);

export type SkipReason = 'chuha' | 'dock' | 'full' | 'capped';

export interface RepairSlot {
    index: number;              // 0-based 艦隊位置
    willRepair: boolean;
    skip?: SkipReason;
    /** 本次結算預估回復 HP（willRepair 時才有）。 */
    predictedHp?: number;
}

export interface AnchorageRepairPlan {
    active: boolean;
    /** 未發動原因（active=false 時）。 */
    reason?: 'no-repair-ship' | 'flagship-chuha' | 'flagship-dock' | 'on-mission' | 'no-coverage';
    /** 涵蓋到第幾號位（＝可修理艦數，1-based 連續自旗艦起算）。 */
    coverage: number;
    facilities: number;
    /** 雙工作艦加速是否成立。 */
    accelerated: boolean;
    slots: RepairSlot[];
}

export interface MoraleSlot {
    index: number;
    willRecover: boolean;
    skip?: SkipReason;
    predictedCond?: number;     // 結算後的 cond
}

export interface MoralePlan {
    active: boolean;
    reason?: 'no-supply-ship' | 'bad-position' | 'low-cond' | 'damaged' | 'unsupplied' | 'dock' | 'on-mission';
    /** 野埼所在位置（0 或 1）。 */
    sourceIndex: number;
    /** 每次結算的 cond 增量（野埼 +2／野埼改 +3）。 */
    perTick: number;
    slots: MoraleSlot[];
    /** 本次結算預估消耗燃料（每艘實際回復的艦 1）。 */
    fuelCost: number;
}

/**
 * 泊地修理涵蓋範圍與結算預估。
 *
 * 涵蓋艦數 =（1、2 號位工作艦的基本數合計）+（該兩艦裝備的艦艇修理施設合計）
 *   ・明石／明石改 基本數 2（涵蓋自己＋2 號艦）
 *   ・朝日改 基本數 0（不帶吊車則誰都不修）
 * 使用者實測範例全部吻合：明石改+4吊=6、明石+3吊=5、朝日改+3吊=3、明石改+1吊=3、
 * 明石+朝日改+5吊=7（遊撃部隊全隊）。
 *
 * @param elapsedMs 自計時器錨點起算的經過時間；undefined＝錨點不可考，只算範圍不預估 HP。
 */
export function planAnchorageRepair(fleet: FleetView, elapsedMs?: number): AnchorageRepairPlan {
    const ships = fleet.ships;
    const idle: AnchorageRepairPlan = { active: false, coverage: 0, facilities: 0, accelerated: false, slots: [] };

    const flag = ships[0];
    if (!flag || !isRepairShip(flag.mst)) return { ...idle, reason: 'no-repair-ship' };
    if (fleet.mission) return { ...idle, reason: 'on-mission' };
    if (flag.inDock) return { ...idle, reason: 'flagship-dock' };
    // 工作艦自身中破以上不發動（wiki 明載）。
    if (isChuhaOrWorse(flag)) return { ...idle, reason: 'flagship-chuha' };

    // 雙工作艦：1、2 號位皆為工作艦時，基本數與吊車數合併計算（順序不拘，使用者實測）。
    const second = ships[1];
    const pairIsRepairShip = !!second && isRepairShip(second.mst) && !isChuhaOrWorse(second) && !second.inDock;
    const crew = pairIsRepairShip ? [flag, second!] : [flag];

    const base = crew.reduce((n, s) => n + (isAkashi(s.mst) ? 2 : 0), 0);
    const facilities = crew.reduce((n, s) => n + facilityCount(s), 0);
    const coverage = Math.min(base + facilities, ships.length);

    // 加速條件：1、2 號位皆工作艦，且 **2 號位至少帶 1 個吊車**
    // （使用者實測：2 號位完全不帶吊車則無加速或效果較弱）。
    const accelerated = pairIsRepairShip && facilityCount(second!) >= 1;

    if (coverage <= 0) return { ...idle, facilities, reason: 'no-coverage' };

    const slots = ships.slice(0, coverage).map((s, index): RepairSlot => {
        // 範圍內不符條件的艦「跳過、不由後面的艦遞補」——故這裡逐位判定、不重排。
        if (s.inDock) return { index, willRepair: false, skip: 'dock' };
        if (s.hp >= s.maxhp) return { index, willRepair: false, skip: 'full' };
        if (isChuhaOrWorse(s)) return { index, willRepair: false, skip: 'chuha' };
        return { index, willRepair: true, predictedHp: predictRepairHp(s, elapsedMs, accelerated) };
    });

    return { active: true, coverage, facilities, accelerated, slots };
}

/**
 * 單艦本次結算預估回復 HP。
 *
 * 每 1HP 所需時間 t 直接取自遊戲的 `api_ndock_time / 損傷HP`——**不猜艦種係數表**
 * （wiki 只列出部分艦種倍率，且與實測有落差；遊戲自己給的數字是精確的）。
 * 結算量（使用者提供之實測規則）：τ < t 時強制回 1HP；否則 H = floor(τ / t)。
 */
export function predictRepairHp(s: ShipView, elapsedMs: number | undefined, accelerated: boolean): number | undefined {
    const lost = s.maxhp - s.hp;
    if (lost <= 0) return 0;
    if (elapsedMs === undefined || s.ndockTime <= 0) return undefined;
    const tau = Math.max(elapsedMs, REPAIR_INTERVAL_MS);   // 最短 20 分才結算
    const perHp = (s.ndockTime / lost) * (accelerated ? ACCEL_FACTOR : 1);
    if (perHp <= 0) return lost;
    // τ < t 也保底回復 1HP（常見於修得極慢的戰艦/航母）。
    return Math.min(lost, Math.max(1, Math.floor(tau / perHp)));
}

/**
 * 母港給糧（野埼）涵蓋範圍與結算預估。
 * 野埼須在 1 或 2 號位；回復對象為同隊「野埼以外」全員，野埼自身不回復。
 */
export function planMoraleSupply(fleet: FleetView, elapsedMs?: number): MoralePlan {
    const ships = fleet.ships;
    const idle: MoralePlan = { active: false, sourceIndex: -1, perTick: 0, slots: [], fuelCost: 0 };

    const sourceIndex = ships.findIndex((s, i) => i < 2 && isNosaki(s.mst));
    if (sourceIndex < 0) {
        // 野埼在隊上但不在 1/2 號位時，回報 bad-position 讓 UI 能提示「換個位置就會生效」。
        return { ...idle, reason: ships.some(s => isNosaki(s.mst)) ? 'bad-position' : 'no-supply-ship' };
    }
    const src = ships[sourceIndex]!;
    const perTick = src.mst === 1002 ? 3 : 2;               // 野埼改 +3／野埼 +2

    if (fleet.mission) return { ...idle, sourceIndex, perTick, reason: 'on-mission' };
    if (src.inDock) return { ...idle, sourceIndex, perTick, reason: 'dock' };
    if (!isBelowShouha(src)) return { ...idle, sourceIndex, perTick, reason: 'damaged' };
    if (!isResupplied(src)) return { ...idle, sourceIndex, perTick, reason: 'unsupplied' };
    if (src.cond < MORALE_SOURCE_MIN_COND) return { ...idle, sourceIndex, perTick, reason: 'low-cond' };

    const ticks = elapsedMs === undefined ? 1 : Math.max(1, Math.floor(elapsedMs / MORALE_INTERVAL_MS));
    let fuelCost = 0;
    const slots = ships.map((s, index): MoraleSlot => {
        if (index === sourceIndex) return { index, willRecover: false, skip: 'full' };  // 野埼自身不回復
        if (s.inDock) return { index, willRecover: false, skip: 'dock' };
        if (s.cond >= MORALE_CAP) return { index, willRecover: false, skip: 'capped' };
        fuelCost += 1;   // 每艘實際回復的艦消耗燃料 1
        return { index, willRecover: true, predictedCond: Math.min(MORALE_CAP, s.cond + perTick * ticks) };
    });

    return { active: true, sourceIndex, perTick, slots, fuelCost };
}

/**
 * 下次結算的剩餘毫秒（已含 1 分鐘安全緩衝，見 TIMER_SAFETY_MS）。
 * anchor 為 null（出門中）或 undefined（不可考）時回 undefined——UI 應只顯示範圍、不顯示倒數。
 */
export function nextSettlementIn(
    anchor: number | null | undefined,
    intervalMs: number,
    now: number = Date.now(),
): number | undefined {
    if (anchor == null) return undefined;
    const elapsed = now - anchor;
    if (elapsed < 0) return undefined;
    // 已超過一個週期：下次結算是「再進一次母港」，剩餘時間視為 0（隨時可結算）。
    const remain = intervalMs - (elapsed % intervalMs);
    return elapsed >= intervalMs ? 0 : remain + TIMER_SAFETY_MS;
}
