import { describe, expect, it } from 'vitest';
import {
    expToRegularSenka,
    formatSenkaRemaining,
    prevSenkaMonth,
    regularSenkaForMonth,
    senkaDeadlines,
    senkaMonthOf,
    senkaMonthWindow,
    todayRegularSenka,
    type ExpReading,
} from '../utils/senka';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe('senka 月界與曆法換算', () => {
    it('以每月最後一日 22:00 JST（13:00 UTC）切換作戰月', () => {
        expect(senkaMonthOf(Date.UTC(2026, 9, 31, 12, 59, 59, 999))).toEqual({ year: 2026, month: 10 });
        expect(senkaMonthOf(Date.UTC(2026, 9, 31, 13, 0, 0))).toEqual({ year: 2026, month: 11 });
    });

    it('計算 11 月作戰窗起訖與戰果任務截止時刻', () => {
        expect(senkaMonthWindow({ year: 2026, month: 11 })).toEqual({
            year: 2026,
            month: 11,
            start: Date.UTC(2026, 9, 31, 13),
            end: Date.UTC(2026, 10, 30, 13),
            questCloseAt: Date.UTC(2026, 10, 30, 5),
        });
    });

    it('正確處理跨年、平年 2 月與閏年 2 月', () => {
        expect(senkaMonthWindow({ year: 2026, month: 1 }).start).toBe(Date.UTC(2025, 11, 31, 13));
        expect(senkaMonthWindow({ year: 2026, month: 12 }).end).toBe(Date.UTC(2026, 11, 31, 13));
        expect(prevSenkaMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
        expect(prevSenkaMonth({ year: 2026, month: 11 })).toEqual({ year: 2026, month: 10 });

        // 平年 2 月僅 28 日；閏年 2 月有 29 日
        expect(senkaMonthWindow({ year: 2026, month: 3 }).start).toBe(Date.UTC(2026, 1, 28, 13));
        expect(senkaMonthWindow({ year: 2024, month: 3 }).start).toBe(Date.UTC(2024, 1, 29, 13));
    });
});

describe('expToRegularSenka', () => {
    it('將提督經驗增量精確換算為普通戰果且避免 -0', () => {
        expect(Object.is(expToRegularSenka(0), 0)).toBe(true);
        expect(Object.is(expToRegularSenka(-0), 0)).toBe(true);
        expect(expToRegularSenka(10_000)).toBe(7);
        expect(expToRegularSenka(3_500_000)).toBe(2450);
        expect(expToRegularSenka(1_000)).toBeCloseTo(0.7, 12);
    });
});

describe('regularSenkaForMonth', () => {
    const nov = { year: 2026, month: 11 };
    const novWin = senkaMonthWindow(nov);
    const octWin = senkaMonthWindow({ year: 2026, month: 10 });

    it('月界前後讀數相等時回傳 exact', () => {
        const readings: ExpReading[] = [
            { ts: novWin.start - 5 * MINUTE, exp: 5_000_000 },
            { ts: novWin.start + 10 * MINUTE, exp: 5_000_000 },
            { ts: novWin.start + 5 * HOUR, exp: 5_020_000 },
        ];
        expect(regularSenkaForMonth(readings, nov)).toEqual({
            status: 'exact',
            points: 14,
            observed: 14,
        });
    });

    it('相隔數月長休但前筆與本月首筆經驗相同時仍回傳 exact', () => {
        const readings: ExpReading[] = [
            { ts: Date.UTC(2026, 6, 15, 3), exp: 2_000_000 },
            { ts: novWin.start + 2 * HOUR, exp: 2_000_000 },
            { ts: novWin.end - MINUTE, exp: 2_010_000 },
        ];
        expect(regularSenkaForMonth(readings, nov)).toEqual({
            status: 'exact',
            points: 7,
            observed: 7,
        });
    });

    it('月界前後讀數不同且前筆落在前一個作戰月內時回傳 range', () => {
        const eBefore = 1_000_000;
        const eAfter = 1_030_000;
        const eLast = 1_130_000;
        const readings: ExpReading[] = [
            { ts: octWin.start + HOUR, exp: eBefore },
            { ts: novWin.start + HOUR, exp: eAfter },
            { ts: novWin.start + 10 * HOUR, exp: eLast },
        ];
        const result = regularSenkaForMonth(readings, nov);
        expect(result).toEqual({
            status: 'range',
            min: 70,
            max: 91,
            observed: 70,
        });
        if (result.status === 'range') {
            expect(result.observed).toBe(result.min);
            expect(result.max - result.min).toBeCloseTo(expToRegularSenka(eAfter - eBefore), 12);
        }
    });

    it('月界前後讀數不同但前筆早於前一個作戰月時回傳 no-start', () => {
        const readings: ExpReading[] = [
            { ts: octWin.start - MINUTE, exp: 1_000_000 },
            { ts: novWin.start + HOUR, exp: 1_050_000 },
            { ts: novWin.start + 5 * HOUR, exp: 1_070_000 },
        ];
        expect(regularSenkaForMonth(readings, nov)).toEqual({
            status: 'no-start',
            observed: 14,
        });
    });

    it('只有月界後讀數而無任何前筆時回傳 no-start', () => {
        const readings: ExpReading[] = [
            { ts: novWin.start, exp: 3_000_000 },
            { ts: novWin.start + 3 * HOUR, exp: 3_040_000 },
        ];
        expect(regularSenkaForMonth(readings, nov)).toEqual({
            status: 'no-start',
            observed: 28,
        });
    });

    it('整個作戰月沒有讀數時回傳 no-data（即使前月與次月有讀數）', () => {
        const readings: ExpReading[] = [
            { ts: novWin.start - MINUTE, exp: 1_000_000 },
            { ts: novWin.end, exp: 1_050_000 },
        ];
        expect(regularSenkaForMonth(readings, nov)).toEqual({ status: 'no-data' });
    });

    it('月界跨筆或月內讀數倒退時回傳 anomaly', () => {
        expect(regularSenkaForMonth([
            { ts: novWin.start - HOUR, exp: 1_000_000 },
            { ts: novWin.start + HOUR, exp: 999_999 },
        ], nov)).toEqual({ status: 'anomaly' });

        expect(regularSenkaForMonth([
            { ts: novWin.start - HOUR, exp: 1_000_000 },
            { ts: novWin.start + HOUR, exp: 1_000_000 },
            { ts: novWin.start + 2 * HOUR, exp: 1_020_000 },
            { ts: novWin.start + 3 * HOUR, exp: 1_010_000 },
        ], nov)).toEqual({ status: 'anomaly' });
    });

    it('忽略無效經驗值讀數，且支援未排序輸入而不改動原陣列', () => {
        const readings: ExpReading[] = [
            { ts: novWin.start + 4 * HOUR, exp: 1_030_000 },
            { ts: novWin.start + 2 * HOUR, exp: null },
            { ts: novWin.start + 2 * HOUR, exp: undefined },
            { ts: novWin.start + 2 * HOUR, exp: -100 },
            { ts: novWin.start + 2 * HOUR, exp: 1_000_000.5 },
            { ts: Number.NaN, exp: 9_999_999 },
            { ts: novWin.start + HOUR, exp: 1_000_000 },
            { ts: novWin.start - HOUR, exp: 1_000_000 },
        ];
        const snapshot = readings.map(r => ({ ...r }));
        expect(regularSenkaForMonth(readings, nov)).toEqual({
            status: 'exact',
            points: 21,
            observed: 21,
        });
        expect(readings).toEqual(snapshot);
    });
});

describe('todayRegularSenka（JST 05:00 換日）', () => {
    it('依 JST 05:00（20:00 UTC）分界計算今日戰果', () => {
        // 2026-11-15 05:00 JST = 2026-11-14 20:00 UTC
        const resetAt = Date.UTC(2026, 10, 14, 20, 0, 0);
        const readings: ExpReading[] = [
            { ts: resetAt - 25 * HOUR, exp: 1_000_000 }, // 11/14 04:00 JST（前一個日週期基底）
            { ts: resetAt - 3 * HOUR, exp: 1_005_000 },  // 11/15 02:00 JST
            { ts: resetAt - MINUTE, exp: 1_010_000 },    // 11/15 04:59 JST（換日前）
            { ts: resetAt + MINUTE, exp: 1_030_000 },    // 11/15 05:01 JST（換日後）
        ];

        // 04:59:30 JST：屬前一日週期（11/14 04:00 → 11/15 04:59）
        expect(todayRegularSenka(readings, resetAt - 30_000)).toBe(7);
        // 05:00:00 JST 整點：剛換日，尚無 05:00 後讀數 → 0
        expect(todayRegularSenka(readings, resetAt)).toBe(0);
        // 05:02:00 JST：今日從 04:59（1_010_000）起算到 05:01（1_030_000）
        expect(todayRegularSenka(readings, resetAt + 2 * MINUTE)).toBe(14);
    });

    it('今日有多筆讀數且昨日有讀數時，以昨日最後一筆到今日最新一筆計（忽略未來讀數）', () => {
        const resetAt = Date.UTC(2026, 10, 14, 20, 0, 0);
        const now = resetAt + 5 * HOUR;
        const readings: ExpReading[] = [
            { ts: resetAt - 10 * HOUR, exp: 2_000_000 },
            { ts: resetAt - 2 * HOUR, exp: 2_010_000 },
            { ts: resetAt + HOUR, exp: 2_020_000 },
            { ts: resetAt + 4 * HOUR, exp: 2_050_000 },
            { ts: resetAt + 8 * HOUR, exp: 2_090_000 }, // 晚於 now
        ];
        expect(todayRegularSenka(readings, now)).toBe(28);
    });

    it('剛過 05:00 尚無今日讀數但本月稍早有讀數時回傳 0', () => {
        const resetAt = Date.UTC(2026, 10, 14, 20, 0, 0);
        const readings: ExpReading[] = [
            { ts: resetAt - 2 * HOUR, exp: 2_010_000 },
        ];
        expect(todayRegularSenka(readings, resetAt + 30 * MINUTE)).toBe(0);
    });

    it('跨月後首日登入且 E_before === E_after，再打一場時回傳該場增量', () => {
        const novWin = senkaMonthWindow({ year: 2026, month: 11 });
        // 11/05 10:00 JST = 11/05 01:00 UTC
        const loginAt = Date.UTC(2026, 10, 5, 1, 0, 0);
        const readings: ExpReading[] = [
            { ts: novWin.start - 48 * HOUR, exp: 4_000_000 },
            { ts: loginAt, exp: 4_000_000 },
            { ts: loginAt + 20 * MINUTE, exp: 4_010_000 },
        ];
        expect(todayRegularSenka(readings, loginAt)).toBe(0);
        expect(todayRegularSenka(readings, loginAt + 30 * MINUTE)).toBe(7);
    });

    it('1 日 02:00 JST（已過前月末 22:00 月界、未到 05:00 換日）不把前月經驗混入本月今日新增', () => {
        // 10/31 18:00 JST = 10/31 09:00 UTC；11/01 02:00 JST = 10/31 17:00 UTC
        const prevMonthEvening = Date.UTC(2026, 9, 31, 9, 0, 0);
        const novFirst2am = Date.UTC(2026, 9, 31, 17, 0, 0);

        // 跨月前後經驗不等：無法拆出前月 18:00–21:59 與本月 22:00 後增量 → 不猜，回 null
        expect(todayRegularSenka([
            { ts: prevMonthEvening, exp: 1_000_000 },
            { ts: novFirst2am, exp: 1_010_000 },
        ], novFirst2am)).toBeNull();

        // 若跨月後首筆與前月最後一筆相等，後續增量確定全屬本月
        expect(todayRegularSenka([
            { ts: prevMonthEvening, exp: 1_000_000 },
            { ts: Date.UTC(2026, 9, 31, 13, 30, 0), exp: 1_000_000 }, // 10/31 22:30 JST
            { ts: novFirst2am, exp: 1_010_000 },
        ], novFirst2am)).toBe(7);
    });

    it('缺本月起點、無本月讀數、異常倒退或 now 非有限數時回傳 null', () => {
        const novWin = senkaMonthWindow({ year: 2026, month: 11 });
        const dayNow = Date.UTC(2026, 10, 10, 6, 0, 0);

        expect(todayRegularSenka([], Number.NaN)).toBeNull();
        expect(todayRegularSenka([{ ts: novWin.start - HOUR, exp: 1_000_000 }], dayNow)).toBeNull();
        // 無 eBefore 且本月僅今日有讀數，缺今日起點
        expect(todayRegularSenka([
            { ts: dayNow - 2 * HOUR, exp: 1_000_000 },
            { ts: dayNow - HOUR, exp: 1_010_000 },
        ], dayNow)).toBeNull();
        // 異常倒退
        expect(todayRegularSenka([
            { ts: novWin.start + HOUR, exp: 1_010_000 },
            { ts: dayNow - 2 * HOUR, exp: 1_020_000 },
            { ts: dayNow - HOUR, exp: 1_015_000 },
        ], dayNow)).toBeNull();
        expect(todayRegularSenka([
            { ts: novWin.start - HOUR, exp: 1_020_000 },
            { ts: dayNow - HOUR, exp: 1_010_000 },
        ], dayNow)).toBeNull();
    });
});

describe('senkaDeadlines 與 formatSenkaRemaining', () => {
    it('月底 18:00 JST 顯示最終日、任務已截止與剩餘 4 小時', () => {
        const info = senkaDeadlines(Date.UTC(2026, 10, 30, 9));
        expect(info.month).toEqual({ year: 2026, month: 11 });
        expect(info.isLastDay).toBe(true);
        expect(info.closeRemainingMs).toBe(4 * HOUR);
        expect(formatSenkaRemaining(info.closeRemainingMs)).toBe('4:00');
        expect(info.questClosed).toBe(true);
        expect(info.questRemainingMs).toBe(0);
    });

    it('月底 00:00 JST 顯示最終日、任務尚未截止且剩餘 14 小時', () => {
        const info = senkaDeadlines(Date.UTC(2026, 10, 29, 15));
        expect(info.isLastDay).toBe(true);
        expect(info.questClosed).toBe(false);
        expect(info.questRemainingMs).toBe(14 * HOUR);
    });

    it('月底前一日 23:59:59 JST 尚未進入最終日且下次更新為 03:00 JST', () => {
        const info = senkaDeadlines(Date.UTC(2026, 10, 29, 14, 59, 59));
        expect(info.isLastDay).toBe(false);
        expect(info.nextUpdateAt).toBe(Date.UTC(2026, 10, 29, 18));
        expect(info.nextUpdateRemainingMs).toBe(3 * HOUR + 1000);
    });

    it('排行榜更新整點（03:00 JST / 15:00 JST）嚴格進到 12 小時後的下一輪', () => {
        const jst0300 = Date.UTC(2026, 10, 15, 18, 0, 0);
        const at0300 = senkaDeadlines(jst0300);
        expect(at0300.nextUpdateAt).toBe(jst0300 + 12 * HOUR);
        expect(at0300.nextUpdateRemainingMs).toBe(12 * HOUR);

        const jst1500 = Date.UTC(2026, 10, 16, 6, 0, 0);
        const at1500 = senkaDeadlines(jst1500);
        expect(at1500.nextUpdateAt).toBe(jst1500 + 12 * HOUR);
        expect(at1500.nextUpdateRemainingMs).toBe(12 * HOUR);
    });

    it('formatSenkaRemaining 格式化各種剩餘毫秒數', () => {
        expect(formatSenkaRemaining(0)).toBe('0:00');
        expect(formatSenkaRemaining(-1000)).toBe('0:00');
        expect(formatSenkaRemaining(Number.NaN)).toBe('0:00');
        expect(formatSenkaRemaining(1)).toBe('0:01');
        expect(formatSenkaRemaining(60_000)).toBe('0:01');
        expect(formatSenkaRemaining(4 * HOUR)).toBe('4:00');
        expect(formatSenkaRemaining(11 * HOUR + 5 * MINUTE)).toBe('11:05');
    });
});
