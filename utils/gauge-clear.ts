// 量表進度與斬殺的戰鬥當下解析、判定與推算純函式（無 chrome.*／DOM／ui-i18n 依賴）。
//
// 封包欄位依據（clean-room 重寫，未複製第三方程式碼）：
// - battleresult `api_get_exmap_rate`：samples/6-5-battleresult-{before-clear,clear}.json
//   （擊破場為字串 "250"、未擊破場為數字 0），對照 KancolleSniffer `KancolleSniffer/Model/ExMapInfo.cs`
//   `InspectBattleResult()`（非 0 視為 EO 擊破並取其戰果值，字串與數字皆處理）。
// - battleresult `api_first_clear`：同上 6-5 樣本（擊破場 1、未擊破場 0），對照 KC3Kai
//   `src/library/objects/Node.js`；僅作原始事實保存與測試交叉核對，不參與判定。
// - battleresult `api_landing_hp`（`api_now_hp`／`api_max_hp`／`api_sub_value`，皆可能為字串）：
//   欄位形狀對照 kcsapi.ts（poi 以真實擷取樣本經 quicktype 產生的型別）
//   `api_req_sortie/battleresult/response.ts`（三者皆 number | string）與
//   `api_req_combined_battle/battleresult/response.ts`（`api_now_hp`／`api_max_hp` 僅見字串）；
//   語意對照 KC3Kai `src/library/objects/Node.js` 的 gauge-tp 結算：`api_now_hp` 為戰前剩餘量、
//   `api_sub_value` 為本場登陸量，戰後＝`api_now_hp − min(api_now_hp, api_sub_value)`。
//   KC3Kai 不從 TP 值判定通關；本檔以「戰後值歸 0」視為打掉該段。
//   本專案樣本 samples/5-6-1-battleresult-landing.json（通常艦隊，數字 280/280/79）證實
//   `api_now_hp` 為戰前值：登陸後的 mapinfo（samples/5-6-mapinfo-after-landing.json）為已登陸 79/280。
// - HP 量表扣量規則：每場以敵主隊旗艦受傷量扣量表，最終段未擊沉停在 1，擊沉才歸 0
//   （見 docs/engineering/maps.md，已以 61-5／61-4 真封包驗證）。
import type { BattleFleetView } from './battle-types';

/** 出擊起點（`api_req_map/start` 帶 `api_eventmap`）記錄的伺服器量表快照。 */
export interface GaugeAtStart {
    type: number;
    now: number;
    max: number;
    gaugeNum?: number;
}

/** 運輸作戰結算封包（`api_landing_hp`）的原始數值。 */
export interface LandingHp {
    now: number;
    max: number;
    sub: number;
}

/** `SortieLogRow.clearedBy` 的來源標記。 */
export type ClearSource = 'battle' | 'mapinfo';

/** `MapGaugeView.source` 的資料來源標記（缺席視為 `'server'`）。 */
export type MapGaugeSource = 'server' | 'estimate';

/** 戰鬥結算封包中與量表／EO 擊破相關的原始欄位。 */
export interface BattleResultGaugeFields {
    exmapRate?: number;
    firstClear?: 0 | 1;
    landing?: LandingHp;
}

/** 敵主隊旗艦於本場戰鬥的結果（只取敵主隊位置 0）。 */
export interface FlagshipOutcome {
    flagshipSunk?: boolean;
    flagshipDamage?: number;
}

/** 判定與推算所需的最小量表視圖（結構對齊 `MapGaugeView`）。 */
export interface GaugeViewLike {
    cleared: boolean;
    gaugeType: number;
    defeatCount: number;
    requiredDefeatCount: number;
    nowHp: number;
    maxHp: number;
    selectedRank: number;
    gaugeNum?: number;
    source?: MapGaugeSource;
}

/** 開發版比對「同段推算與伺服器值」時的差異摘要。 */
export interface GaugeEstimateDiff {
    gaugeType: number;
    gaugeNum?: number;
    estimate: number;
    server: number;
}

const UINT_RE = /^\d+$/;

/**
 * 解析封包中的非負安全整數，同時接受數字與純數字字串（`api_get_exmap_rate`、
 * `api_landing_hp` 皆可能回傳字串）。空字串、小數、負數、非數字一律回傳 `undefined`。
 */
export function parsePacketInt(value: unknown, min = 0): number | undefined {
    let n: number;
    if (typeof value === 'number') {
        n = value;
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!UINT_RE.test(trimmed)) return undefined;
        n = Number(trimmed);
    } else {
        return undefined;
    }
    return Number.isSafeInteger(n) && n >= min ? n : undefined;
}

/**
 * 由 `api_req_sortie/battleresult` 或 `api_req_combined_battle/battleresult` 解析量表相關原始欄位。
 * 欄位缺席或格式不符時維持缺席，不補預設值。
 */
export function parseBattleResultGaugeFields(api: unknown): BattleResultGaugeFields {
    if (!api || typeof api !== 'object') return {};
    const record = api as Record<string, unknown>;
    const out: BattleResultGaugeFields = {};

    const exmapRate = parsePacketInt(record.api_get_exmap_rate, 1);
    if (exmapRate !== undefined) out.exmapRate = exmapRate;

    const firstClear = parsePacketInt(record.api_first_clear, 0);
    if (firstClear === 0 || firstClear === 1) out.firstClear = firstClear;

    const rawLanding = record.api_landing_hp;
    if (rawLanding && typeof rawLanding === 'object' && !Array.isArray(rawLanding)) {
        const l = rawLanding as Record<string, unknown>;
        const now = parsePacketInt(l.api_now_hp, 0);
        const max = parsePacketInt(l.api_max_hp, 1);
        const sub = parsePacketInt(l.api_sub_value, 0);
        if (now !== undefined && max !== undefined && sub !== undefined) {
            out.landing = { now, max, sub };
        }
    }

    return out;
}

/**
 * 由戰鬥分析結果取出敵主隊旗艦的擊沉狀態與受傷量（敵聯合艦隊時只看主隊位置 0）。
 * 面板開在夜戰畫面而缺少晝戰起點（`missingDayStart: true`）時，戰後是否擊沉仍可確定，
 * 但整場受傷量不可考，因此不寫 `flagshipDamage`。
 */
export function extractFlagshipOutcome(
    resultFleets: BattleFleetView | null | undefined,
    options?: { missingDayStart?: boolean },
): FlagshipOutcome {
    const flagship = resultFleets?.enemyMain?.[0];
    if (!flagship || !Number.isFinite(flagship.hp)) return {};

    const flagshipSunk = flagship.hp <= 0;
    if (options?.missingDayStart) return { flagshipSunk };

    if (!Number.isFinite(flagship.beginHp)) return { flagshipSunk };
    const begin = Math.trunc(flagship.beginHp);
    const after = Math.max(0, Math.trunc(flagship.hp));
    const flagshipDamage = Math.max(0, begin - after);
    return { flagshipSunk, flagshipDamage };
}

export interface EvaluateBattleClearInput {
    /** 戰前量表視圖（必須在更新 `mapGauges` 之前傳入）。 */
    gauge?: GaugeViewLike | null;
    /** 本戰是否位於 `isGaugeBossNode()` 判定的目前量表目標 Boss 節點。 */
    atGaugeBoss: boolean;
    /** 出擊起點的 `api_eventmap` 快照（一般海域缺席）。 */
    gaugeAtStart?: GaugeAtStart;
    flagshipSunk?: boolean;
    flagshipDamage?: number;
    exmapRate?: number;
    landing?: LandingHp;
}

/**
 * 戰鬥結算當下判斷本場是否打掉一段量表（`SortieLogRow.cleared`）。
 *
 * - EO 整圖通關：`exmapRate > 0`（封包事實，不依賴本機量表狀態）。
 * - 擊破數式：`!gauge.cleared`、`gaugeType === 1`、`requiredDefeatCount > 0`、
 *   `defeatCount === requiredDefeatCount - 1` 且目標 Boss 旗艦擊沉。
 * - HP 式：`!gauge.cleared`、`gaugeAtStart.type === 2`、`gaugeAtStart.now > 0`、
 *   `flagshipDamage !== undefined`、`gaugeAtStart.now - flagshipDamage <= 0` 且目標 Boss 旗艦擊沉。
 * - TP 式：`!gauge.cleared`、`landing.sub > 0` 且 `landing.now - landing.sub <= 0`。
 */
export function evaluateBattleGaugeClear(input: EvaluateBattleClearInput): boolean {
    if (input.exmapRate !== undefined && input.exmapRate > 0) return true;

    const gauge = input.gauge;
    if (!gauge || gauge.cleared) return false;

    if (input.landing && input.landing.sub > 0 && input.landing.now - input.landing.sub <= 0) {
        return true;
    }

    if (!input.atGaugeBoss) return false;

    if (gauge.gaugeType === 1
        && gauge.requiredDefeatCount > 0
        && gauge.defeatCount === gauge.requiredDefeatCount - 1
        && input.flagshipSunk === true) {
        return true;
    }

    if (input.gaugeAtStart
        && input.gaugeAtStart.type === 2
        && input.gaugeAtStart.now > 0
        && input.flagshipDamage !== undefined
        && input.gaugeAtStart.now - input.flagshipDamage <= 0
        && input.flagshipSunk === true) {
        return true;
    }

    return false;
}

/**
 * 一般海域的 TP 量表（如 5-6 第一段）：mapinfo 不帶 `api_eventmap`，改以 `api_defeat_count`
 * 表示已登陸量、`api_required_defeat_count` 表示上限（samples/5-6-mapinfo-after-landing.json：
 * 79/280，與 samples/5-6-1-battleresult-landing.json 的 `api_landing_hp` 280 − 79 一致）。
 * 活動海域的 TP 量表沒有這兩欄，仍以 `api_eventmap` 的 now/max 表示。
 */
export function isDefeatCountTpGauge(gauge: GaugeViewLike | null | undefined): boolean {
    return !!gauge && gauge.gaugeType === 3 && gauge.requiredDefeatCount > 0;
}

/**
 * 判斷該量表是否已歸零（不論整圖是否已通關）：
 * 供面板標題列在打掉一段量表後立即顯示 `✓`，而不把 `MapGaugeView.cleared` 改成 `true`。
 */
export function isGaugeZeroed(gauge: GaugeViewLike | null | undefined): boolean {
    if (!gauge) return false;
    if (gauge.cleared) return true;
    if (gauge.gaugeType === 1 && gauge.requiredDefeatCount > 0
        && gauge.defeatCount >= gauge.requiredDefeatCount) {
        return true;
    }
    if (isDefeatCountTpGauge(gauge) && gauge.defeatCount >= gauge.requiredDefeatCount) return true;
    if ((gauge.gaugeType === 2 || gauge.gaugeType === 3)
        && gauge.maxHp > 0 && gauge.maxHp !== 9999 && gauge.nowHp === 0) {
        return true;
    }
    return false;
}

/**
 * 依戰前量表與戰鬥結算事實，計算戰後記憶體中 `MapGaugeView` 的新狀態。
 *
 * - 除 `exmapRate > 0`（確定整圖通關）外，量表歸零不把 `cleared` 設為 `true`，
 *   保留整圖通關語意給 `onReqMapStart()`、`mapCleared()` 與重播保留規則。
 * - 只有「未歸零的 HP 扣量／擊破數遞增」標為 `source: 'estimate'`；
 *   封包事實（`exmapRate`、`api_landing_hp`）與已確定的歸零標為 `source: 'server'`。
 */
export function computePostBattleGauge<T extends GaugeViewLike>(
    gauge: T | undefined,
    input: Omit<EvaluateBattleClearInput, 'gauge'>,
): T | undefined {
    if (!gauge) return undefined;

    const hasExmapClear = input.exmapRate !== undefined && input.exmapRate > 0;
    if (gauge.cleared) {
        return hasExmapClear && gauge.source !== 'server'
            ? { ...gauge, source: 'server' }
            : gauge;
    }

    let next: T = gauge;
    let changed = false;

    if (input.landing) {
        const nextNow = Math.max(0, input.landing.now - input.landing.sub);
        if (isDefeatCountTpGauge(gauge)) {
            // 一般海域 TP 沿用 mapinfo 的存法（已登陸量／上限），不寫 nowHp／maxHp：mapinfo 缺
            // api_eventmap 時會沿用上一筆的 nowHp／maxHp，寫進去就會在月初重置或跨裝置後顯示過時值。
            const required = input.landing.max > 0 ? input.landing.max : gauge.requiredDefeatCount;
            next = {
                ...next,
                requiredDefeatCount: required,
                defeatCount: Math.max(0, required - nextNow),
                source: 'server',
            };
        } else {
            const nextMax = input.landing.max > 0 ? input.landing.max : gauge.maxHp;
            next = {
                ...next,
                nowHp: nextNow,
                maxHp: nextMax,
                source: 'server',
            };
        }
        changed = true;
    } else if (input.atGaugeBoss) {
        if (gauge.gaugeType === 1 && gauge.requiredDefeatCount > 0 && input.flagshipSunk === true) {
            const nextDefeat = Math.min(gauge.requiredDefeatCount, gauge.defeatCount + 1);
            next = {
                ...next,
                defeatCount: nextDefeat,
                source: nextDefeat >= gauge.requiredDefeatCount ? 'server' : 'estimate',
            };
            changed = true;
        } else {
            // gaugeAtStart.type === 0（未知量表種類）時不得做 HP 扣量推算，避免把 TP 條當 HP 扣。
            const hpGaugeConfirmed = input.gaugeAtStart
                ? input.gaugeAtStart.type === 2
                : gauge.gaugeType === 2;
            const baseNow = input.gaugeAtStart ? input.gaugeAtStart.now : gauge.nowHp;
            if (hpGaugeConfirmed
                && gauge.maxHp > 0 && gauge.maxHp !== 9999
                && baseNow > 0
                && input.flagshipDamage !== undefined) {
                const floor = input.flagshipSunk === true ? 0 : 1;
                const nextNow = Math.max(baseNow - input.flagshipDamage, floor);
                next = {
                    ...next,
                    nowHp: nextNow,
                    source: nextNow === 0 ? 'server' : 'estimate',
                };
                changed = true;
            }
        }
    }

    if (hasExmapClear) {
        next = { ...next, cleared: true, source: 'server' };
        changed = true;
    }

    return changed ? next : gauge;
}

/**
 * 比較同一段量表的推算值與後續到達的伺服器值；兩者一致、非推算、已通關、
 * 換段（`gaugeNum` 不同）或量表種類不同時回傳 `null`。
 */
export function gaugeEstimateMismatch(
    previous: GaugeViewLike | undefined,
    server: GaugeViewLike,
): GaugeEstimateDiff | null {
    if (!previous || previous.source !== 'estimate') return null;
    if (server.cleared) return null;
    if (previous.gaugeNum !== server.gaugeNum) return null;
    if (previous.gaugeType !== server.gaugeType) return null;

    if (server.gaugeType === 1 && server.requiredDefeatCount > 0) {
        if (previous.defeatCount !== server.defeatCount) {
            return {
                gaugeType: server.gaugeType,
                ...(server.gaugeNum === undefined ? {} : { gaugeNum: server.gaugeNum }),
                estimate: previous.defeatCount,
                server: server.defeatCount,
            };
        }
        return null;
    }

    if ((server.gaugeType === 2 || server.gaugeType === 3)
        && server.maxHp > 0 && server.maxHp !== 9999
        && previous.nowHp !== server.nowHp) {
        return {
            gaugeType: server.gaugeType,
            ...(server.gaugeNum === undefined ? {} : { gaugeNum: server.gaugeNum }),
            estimate: previous.nowHp,
            server: server.nowHp,
        };
    }

    return null;
}
