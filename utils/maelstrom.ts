// 渦潮燃彈扣減（純函式）。
//
// inspired by KC3Kai `Node.js#reduceFleetRscOnMaelstrom`（MIT）＋ wikiwiki「資材」公式。
// 封包 `api_happening.api_count` 是畫面上「損失最大那一艘」的數字，不能原樣套到全艦隊；
// 逐艦重算需要該格的基本比例／上限（`maelstrom-data.ts`）。表外節點不猜、不扣。
//
// 連合艦隊 A／B 兩種電探計算法：KC3Kai 也未完整處理活動圖，本專案同樣擱置——
// 出擊中各隊合併計電探、合併扣減（與 KC3Kai 現行行為一致）。

import {
    lookupMaelstromLoss,
    MAELSTROM_RADAR_CATS,
    RADAR_REDUCE_RATE,
    type MaelstromLossDef,
} from './maelstrom-data';

export type MaelstromRsc = 'fuel' | 'ammo';

export interface MaelstromHappening {
    /** api_mst_id：1＝燃料、2＝彈藥 */
    mstId: number;
    /** api_count：畫面顯示的最大損失 */
    count: number;
    /** api_dentan：電探減輕是否生效 */
    dentan: boolean;
}

export interface MaelstromShipSnap {
    id: number;
    fuel: number;
    ammo: number;
    /** 是否帶至少一顆小型／大型電探（type 12／13） */
    hasRadar: boolean;
    /** 已退避則不分攤（同 KC3Kai shipsUnescaped） */
    escaped?: boolean;
}

export interface MaelstromApplyResult {
    rsc: MaelstromRsc;
    /** shipId → 扣減量 */
    losses: Map<number, number>;
    lossRate: number;
    /** 查表失敗＝null（呼叫端應不扣） */
    def: MaelstromLossDef | null;
}

/** 從 map/next（或 start）的 api_happening 讀出可用欄位；形狀不對回 null。 */
export function readMaelstromHappening(api: any): MaelstromHappening | null {
    const h = api?.api_happening;
    if (!h || typeof h !== 'object') return null;
    const mstId = Number(h.api_mst_id);
    const count = Math.floor(Number(h.api_count));
    if (!Number.isFinite(mstId) || (mstId !== 1 && mstId !== 2)) return null;
    if (!Number.isFinite(count) || count <= 0) return null;
    return { mstId, count, dentan: !!h.api_dentan };
}

/**
 * 推算這一波要用的損失比例（含強渦潮猜骰）。
 * 回傳 null＝表外或無法推算 → 呼叫端不扣。
 */
export function resolveMaelstromLossRate(
    def: MaelstromLossDef,
    happening: MaelstromHappening,
    maxRemaining: number,
    radarShips: number,
): number | null {
    const [, defLossCap, defLossRate, defLossRateHigh] = def;
    if (!(defLossRate > 0)) return null;

    const isReducedByRadar = happening.dentan;
    const radarReduceRate = radarShips && isReducedByRadar
        ? RADAR_REDUCE_RATE[Math.min(6, radarShips)] ?? 0
        : 0;
    const definedCappedLoss = defLossCap || happening.count;
    const actualMaxLoss = happening.count;

    if (defLossRate === defLossRateHigh) {
        return defLossRate * (1 - radarReduceRate);
    }

    // 強渦潮：用 api_count 反推這次骰到一般還是高損失（KC3Kai 同邏輯）
    const lossRateLow = defLossRate * (1 - radarReduceRate);
    const lossRateHigh = defLossRateHigh * (1 - radarReduceRate);
    const expectedLow = Math.floor(maxRemaining * lossRateLow);
    const expectedHigh = Math.floor(maxRemaining * lossRateHigh);
    if (
        actualMaxLoss >= expectedHigh
        || (definedCappedLoss > expectedLow && actualMaxLoss > expectedLow && actualMaxLoss < expectedHigh)
        || (definedCappedLoss <= expectedLow && actualMaxLoss > definedCappedLoss)
    ) {
        return lossRateHigh;
    }
    return lossRateLow;
}

/**
 * 對出擊艦隊逐艦計算渦潮損失。
 * `def == null`（表外）時 losses 為空、呼叫端應略過。
 */
export function planMaelstromLosses(
    area: number,
    mapNo: number,
    edgeId: number,
    happening: MaelstromHappening,
    ships: readonly MaelstromShipSnap[],
): MaelstromApplyResult {
    const rsc: MaelstromRsc = happening.mstId === 2 ? 'ammo' : 'fuel';
    const def = lookupMaelstromLoss(area, mapNo, edgeId);
    const empty = { rsc, losses: new Map<number, number>(), lossRate: 0, def };
    if (!def) return empty;

    const active = ships.filter(s => !s.escaped);
    if (!active.length) return empty;

    let maxRemaining = 0;
    let radarShips = 0;
    for (const s of active) {
        const cur = rsc === 'fuel' ? s.fuel : s.ammo;
        maxRemaining = Math.max(maxRemaining, cur);
        if (s.hasRadar) radarShips++;
    }
    if (maxRemaining <= 0) return empty;

    const lossRate = resolveMaelstromLossRate(def, happening, maxRemaining, radarShips);
    if (lossRate == null || !(lossRate > 0)) return empty;

    const losses = new Map<number, number>();
    for (const s of active) {
        const cur = rsc === 'fuel' ? s.fuel : s.ammo;
        // 單艦損失 ≤ 畫面最大損失（＝節點上限或最大艦的實損），且不超過自身殘量
        let loss = Math.min(happening.count, Math.floor(cur * lossRate));
        loss = Math.min(cur, loss);
        if (loss > 0) losses.set(s.id, loss);
    }
    return { rsc, losses, lossRate, def };
}
