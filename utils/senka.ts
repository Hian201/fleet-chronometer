// 普通戰果、作戰月窗口與截止倒數計算。純函式，無 chrome.*／DOM／ui-i18n 依賴。
//
// 規則與公式依據（wikiwiki「称号・戦果」）：
// - 作戰月界：每月最後一日 22:00 JST（含前月最後一日 22:00 JST，不含當月最後一日 22:00 JST）。
//   將時間戳加上 11 小時（UTC+9 再加 2 小時）後取 UTC 年月，即可將「前月末 22:00 JST」對齊到
//   該作戰月 1 日 00:00 UTC，自動處理大小月、平閏年與跨年。
// - 戰果任務有效截止：當月最後一日 14:00 JST（月界往前 8 小時）。
// - 戰果排行榜更新：每日 03:00 JST（18:00 UTC）與 15:00 JST（06:00 UTC）。
// - 普通戰果換算：獲得提督經驗值 × 7 ÷ 10,000（保留浮點精確值，不提前四捨五入）。
// - 戰果計算用「今日」換日：依日本時間 05:00 換日（重用 questCycleWindow('daily', now)），
//   並以本月作戰起始夾住，避免月初或跨月時刻混入前月經驗。

import { questCycleWindow } from './quest-cycle';

const HOUR_MS = 60 * 60 * 1000;
const MONTH_SHIFT_MS = 11 * HOUR_MS;
const QUEST_CLOSE_BEFORE_END_MS = 8 * HOUR_MS;
const LAST_DAY_SPAN_MS = 22 * HOUR_MS;
const HALF_DAY_MS = 12 * HOUR_MS;
const RANKING_PHASE_MS = 6 * HOUR_MS;
const SENKA_EXP_NUMERATOR = 7;
const SENKA_EXP_DENOMINATOR = 10_000;

/** 作戰月識別（`month` 為 `1..12`）。 */
export interface SenkaMonth {
    year: number;
    month: number;
}

/** 作戰月的 UTC 毫秒時間窗（`[start, end)`）與戰果任務截止時刻。 */
export interface SenkaMonthWindow extends SenkaMonth {
    start: number;
    end: number;
    questCloseAt: number;
}

/** 提督經驗值觀測讀數。 */
export interface ExpReading {
    ts: number;
    exp?: number | null;
}

/** 單月普通戰果估算結果。 */
export type RegularSenkaResult =
    | { status: 'exact'; points: number; observed: number }
    | { status: 'range'; min: number; max: number; observed: number }
    | { status: 'no-start'; observed: number }
    | { status: 'no-data' }
    | { status: 'anomaly' };

/** 戰果截止與排行榜更新倒數資訊。 */
export interface SenkaDeadlineInfo {
    month: SenkaMonth;
    isLastDay: boolean;
    closeAt: number;
    closeRemainingMs: number;
    questCloseAt: number;
    questClosed: boolean;
    questRemainingMs: number;
    nextUpdateAt: number;
    nextUpdateRemainingMs: number;
}

interface ValidExpReading {
    ts: number;
    exp: number;
}

/** 過濾有效經驗值讀數並依時間戳升冪穩定排序（不改動原陣列）。 */
function normalizeReadings(readings: readonly ExpReading[]): ValidExpReading[] {
    const valid: ValidExpReading[] = [];
    for (const r of readings) {
        if (Number.isFinite(r.ts) && typeof r.exp === 'number' && Number.isSafeInteger(r.exp) && r.exp >= 0) {
            valid.push({ ts: r.ts, exp: r.exp });
        }
    }
    valid.sort((a, b) => a.ts - b.ts);
    return valid;
}

/** 檢查已依時間排序的讀數序列是否存在經驗值倒退。 */
function hasExpRegression(readings: readonly ValidExpReading[]): boolean {
    for (let i = 1; i < readings.length; i++) {
        if (readings[i].exp < readings[i - 1].exp) return true;
    }
    return false;
}

/** 將提督經驗值增量換算為普通戰果（保留浮點精確值，0 明確回傳 +0）。 */
export function expToRegularSenka(expDelta: number): number {
    if (expDelta === 0) return 0;
    return (expDelta * SENKA_EXP_NUMERATOR) / SENKA_EXP_DENOMINATOR;
}

/** 取得 UTC 毫秒時間戳所屬的戰果作戰月。 */
export function senkaMonthOf(ts: number): SenkaMonth {
    const d = new Date(ts + MONTH_SHIFT_MS);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** 取得指定作戰月的前一個作戰月。 */
export function prevSenkaMonth(m: SenkaMonth): SenkaMonth {
    return m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 };
}

/** 計算指定作戰月的起訖（`[start, end)`）與任務戰果截止時刻。 */
export function senkaMonthWindow(m: SenkaMonth): SenkaMonthWindow {
    const start = Date.UTC(m.year, m.month - 1, 1) - MONTH_SHIFT_MS;
    const end = Date.UTC(m.year, m.month, 1) - MONTH_SHIFT_MS;
    const questCloseAt = end - QUEST_CLOSE_BEFORE_END_MS;
    return { year: m.year, month: m.month, start, end, questCloseAt };
}

/** 從提督經驗值讀數計算指定作戰月的普通戰果與不確定狀態。 */
export function regularSenkaForMonth(readings: readonly ExpReading[], month: SenkaMonth): RegularSenkaResult {
    const sorted = normalizeReadings(readings);
    const win = senkaMonthWindow(month);
    const prevWin = senkaMonthWindow(prevSenkaMonth(month));

    const inMonth: ValidExpReading[] = [];
    let eBefore: ValidExpReading | null = null;
    for (const r of sorted) {
        if (r.ts < win.start) {
            eBefore = r;
        } else if (r.ts < win.end) {
            inMonth.push(r);
        } else {
            break;
        }
    }

    if (inMonth.length === 0) return { status: 'no-data' };
    if (hasExpRegression(inMonth)) return { status: 'anomaly' };

    const first = inMonth[0];
    const last = inMonth[inMonth.length - 1];
    const observed = expToRegularSenka(last.exp - first.exp);

    if (eBefore === null) return { status: 'no-start', observed };
    if (first.exp < eBefore.exp) return { status: 'anomaly' };
    if (first.exp === eBefore.exp) return { status: 'exact', points: observed, observed };

    if (eBefore.ts >= prevWin.start && eBefore.ts < win.start) {
        return {
            status: 'range',
            min: observed,
            max: expToRegularSenka(last.exp - eBefore.exp),
            observed,
        };
    }

    return { status: 'no-start', observed };
}

/** 計算今日（日本時間 05:00 換日，不混入前月經驗）至今的普通戰果新增量。 */
export function todayRegularSenka(readings: readonly ExpReading[], now: number): number | null {
    if (!Number.isFinite(now)) return null;

    const win = senkaMonthWindow(senkaMonthOf(now));
    const day = questCycleWindow('daily', now);
    if (!day) return null;

    // 確保月初 1 日 00:00–04:59 JST 與月末 22:00–23:59 JST 不把上月經驗混入本月今日新增
    const effectiveDayStart = Math.max(day.start, win.start);

    const sorted = normalizeReadings(readings);
    const inMonthSoFar: ValidExpReading[] = [];
    let eBefore: ValidExpReading | null = null;
    for (const r of sorted) {
        if (r.ts < win.start) {
            eBefore = r;
        } else if (r.ts < win.end && r.ts <= now) {
            inMonthSoFar.push(r);
        } else if (r.ts >= win.end || r.ts > now) {
            break;
        }
    }

    if (inMonthSoFar.length === 0) return null;
    if (hasExpRegression(inMonthSoFar)) return null;
    if (eBefore && inMonthSoFar[0].exp < eBefore.exp) return null;

    let beforeInMonth: ValidExpReading | null = null;
    const inToday: ValidExpReading[] = [];
    for (const r of inMonthSoFar) {
        if (r.ts < effectiveDayStart) {
            beforeInMonth = r;
        } else {
            inToday.push(r);
        }
    }

    if (inToday.length === 0) return 0;

    const base = beforeInMonth ?? (eBefore && eBefore.exp === inToday[0].exp ? eBefore : null);
    if (!base) return null;

    return expToRegularSenka(inToday[inToday.length - 1].exp - base.exp);
}

/** 計算目前作戰月的月界截止、任務截止與下次排行榜更新時間資訊。 */
export function senkaDeadlines(now: number): SenkaDeadlineInfo {
    const month = senkaMonthOf(now);
    const win = senkaMonthWindow(month);
    const isLastDay = now >= win.end - LAST_DAY_SPAN_MS && now < win.end;
    const closeAt = win.end;
    const closeRemainingMs = Math.max(0, win.end - now);
    const questCloseAt = win.questCloseAt;
    const questClosed = now >= win.questCloseAt;
    const questRemainingMs = Math.max(0, win.questCloseAt - now);
    const nextUpdateAt = (Math.floor((now - RANKING_PHASE_MS) / HALF_DAY_MS) + 1) * HALF_DAY_MS + RANKING_PHASE_MS;
    const nextUpdateRemainingMs = nextUpdateAt - now;

    return {
        month,
        isLastDay,
        closeAt,
        closeRemainingMs,
        questCloseAt,
        questClosed,
        questRemainingMs,
        nextUpdateAt,
        nextUpdateRemainingMs,
    };
}

/** 將剩餘毫秒數格式化為 `H:MM`（無條件進位至分鐘；非正數或非有限數回傳 `'0:00'`）。 */
export function formatSenkaRemaining(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    const mins = Math.ceil(ms / 60_000);
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}
