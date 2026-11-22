// 從 db.resources 查詢指定作戰月計算普通戰果所需的提督經驗值讀數。

import type { db } from './db';
import { senkaMonthWindow, type ExpReading, type SenkaMonth } from './senka';

const hasValidExp = (exp: unknown): exp is number =>
    typeof exp === 'number' && Number.isSafeInteger(exp) && exp >= 0;

/**
 * 讀取指定作戰月計算普通戰果需要的讀數：
 * 1) 月界前最後一筆帶有效 `exp` 的紀錄（作為月初基準 `E_before`，涵蓋跨月長休），以及
 * 2) 落於 `[win.start, win.end)` 區間內的所有帶有效 `exp` 紀錄。
 * 無 `exp` 的紀錄（例如 `api_get_member/material`）會被忽略。
 */
export async function loadSenkaExpReadings(
    resources: typeof db.resources,
    month: SenkaMonth,
): Promise<ExpReading[]> {
    const win = senkaMonthWindow(month);
    const [eBefore, inMonth] = await Promise.all([
        resources
            .where('ts')
            .below(win.start)
            .reverse()
            .filter(r => hasValidExp(r.exp))
            .first(),
        resources
            .where('ts')
            .between(win.start, win.end, true, false)
            .toArray(),
    ]);
    const readings: ExpReading[] = [];
    if (eBefore && hasValidExp(eBefore.exp)) {
        readings.push({ ts: eBefore.ts, exp: eBefore.exp });
    }
    for (const r of inMonth) {
        if (hasValidExp(r.exp)) readings.push({ ts: r.ts, exp: r.exp });
    }
    return readings;
}
