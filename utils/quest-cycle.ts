// 定期任務的「本期」起訖。純函式，無 chrome.*／DOM。
//
// 所有定期任務都在日本時間 05:00 換期：UTC+9 再扣 5 小時，等於時間戳加 4 小時後取 UTC 日曆，
// 換期瞬間則是該 UTC 日曆日 00:00 再扣 4 小時。
// - 日任：每日；週任：週一；月任：每月 1 日。
// - 季任不是西曆季：3／6／9／12 月 1 日換期（3–5、6–8、9–11、12–隔年 2 月）。
//   KC3Kai src/library/managers/QuestManager.js 的 quarterly.calculateNextReset 同此劃分。
// - 年任每個任務的換期月不同，在該月 1 日換期。遊戲的 api_label_type 101–112 即 100＋換期月
//   （samples/Quest.json 18 個年任；ElectronicObserver ElectronicObserver/Data/QuestData.cs 的
//   LabelType 註解「100+x=イヤーリー(x月-)」；KC3Kai src/library/objects/Quest.js isYearly()）。
//   目錄的換期月由 tools/quest-graph/generate.py 從 wikiwiki 年任表產生。

import type { QuestPeriod } from './quest-flow';

const HOUR_MS = 60 * 60 * 1000;
const RESET_SHIFT_MS = 4 * HOUR_MS;

/** 本期起訖（毫秒時間戳）。`end` 是下次換期的瞬間，本期不含 `end`。 */
export interface QuestCycleWindow {
    start: number;
    end: number;
}

const resetAt = (year: number, month0: number, day = 1) => Date.UTC(year, month0, day) - RESET_SHIFT_MS;

/**
 * 回傳 `ts` 所在的那一期；單發、季節、期間限定等不按固定週期換期的任務回傳 null。
 * 年任需要 `yearlyResetMonth`（1–12），缺值時回傳 null，不猜。
 */
export function questCycleWindow(period: QuestPeriod, ts: number, yearlyResetMonth?: number | null): QuestCycleWindow | null {
    if (!Number.isFinite(ts)) return null;
    const shifted = new Date(ts + RESET_SHIFT_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();
    switch (period) {
        case 'daily':
            return { start: resetAt(year, month, day), end: resetAt(year, month, day + 1) };
        case 'weekly': {
            const monday = day - (shifted.getUTCDay() + 6) % 7;
            return { start: resetAt(year, month, monday), end: resetAt(year, month, monday + 7) };
        }
        case 'monthly':
            return { start: resetAt(year, month), end: resetAt(year, month + 1) };
        case 'quarterly': {
            // 3 月起每 3 個月一期；1、2 月屬於前一年 12 月開始的那期
            const startMonth = month < 2 ? -1 : month - (month - 2) % 3;
            return { start: resetAt(year, startMonth), end: resetAt(year, startMonth + 3) };
        }
        case 'yearly': {
            if (!yearlyResetMonth || !Number.isInteger(yearlyResetMonth) || yearlyResetMonth < 1 || yearlyResetMonth > 12) return null;
            const month0 = yearlyResetMonth - 1;
            const startYear = month < month0 ? year - 1 : year;
            return { start: resetAt(startYear, month0), end: resetAt(startYear + 1, month0) };
        }
        default:
            return null;
    }
}

/** 遊戲的 `api_label_type` 換算年任換期月；不是年任標籤時回傳 null。 */
export function yearlyResetMonthFromLabel(labelType: unknown): number | null {
    return typeof labelType === 'number' && Number.isInteger(labelType) && labelType >= 101 && labelType <= 112
        ? labelType - 100 : null;
}
