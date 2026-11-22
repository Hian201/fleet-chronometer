// utils/senka-view.ts 與 utils/senka-readings.ts 單元測試。
import { afterEach, describe, expect, it } from 'vitest';
import { db, type ResourceRow } from '../utils/db';
import { loadSenkaExpReadings } from '../utils/senka-readings';
import {
    buildRegularSenkaSummary, formatRegularSenkaValue, formatSenkaInt, formatSenkaRank,
    formatSenkaTimestamp, formatSignedSenka, senkaDeadlineLines,
} from '../utils/senka-view';
import { senkaDeadlines, senkaMonthWindow } from '../utils/senka';
import { formatTime } from '../utils/date-format';
import { tFor } from '../utils/ui-i18n';

afterEach(async () => {
    await db.resources.clear();
});

describe('formatSenkaRank', () => {
    it('英文處理 1st／2nd／3rd／11th–13th／21st–23rd／100th／111th／500th；繁中與日文維持數字', () => {
        const cases: [number, string][] = [
            [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'],
            [11, '11th'], [12, '12th'], [13, '13th'],
            [21, '21st'], [22, '22nd'], [23, '23rd'],
            [100, '100th'], [111, '111th'], [500, '500th'],
        ];
        for (const [rank, expected] of cases) {
            expect(formatSenkaRank(rank, 'en')).toBe(expected);
            expect(formatSenkaRank(rank, 'zh-TW')).toBe(String(rank));
            expect(formatSenkaRank(rank, 'ja')).toBe(String(rank));
        }
    });
});

describe('formatSenkaTimestamp', () => {
    it('依本機時區格式化為 M/D HH:MM，時間部分與 formatTime(ts, false) 一致', () => {
        const ts = Date.UTC(2026, 10, 30, 13, 0);
        const d = new Date(ts);
        expect(formatSenkaTimestamp(ts)).toBe(`${d.getMonth() + 1}/${d.getDate()} ${formatTime(ts, false)}`);
    });
});

describe('formatRegularSenkaValue / formatSignedSenka / formatSenkaInt', () => {
    it('exact 狀態格式化（含四捨五入、千分位與 0 值）', () => {
        expect(formatSenkaInt(1234.6, 'en')).toBe('1,235');
        expect(formatSenkaInt(-0, 'zh-TW')).toBe('0');
        expect(formatRegularSenkaValue({ status: 'exact', points: 2450.2, observed: 2450.2 }, 'zh-TW')).toBe('≈2,450');
        expect(formatRegularSenkaValue({ status: 'exact', points: 0.4, observed: 0.4 }, 'en')).toBe('0');
    });

    it('range 狀態顯示 floor～ceil；上下界相同時收斂為單值', () => {
        expect(formatRegularSenkaValue({ status: 'range', min: 2318.2, max: 2330.6, observed: 2318.2 }, 'zh-TW')).toBe('≈2,318～2,331');
        expect(formatRegularSenkaValue({ status: 'range', min: 2318.2, max: 2330.6, observed: 2318.2 }, 'en')).toBe('≈2,318–2,331');
        expect(formatRegularSenkaValue({ status: 'range', min: 100.4, max: 100.6, observed: 100.4 }, 'ja')).toBe('≈100～101');
        expect(formatRegularSenkaValue({ status: 'range', min: 100, max: 100, observed: 100 }, 'ja')).toBe('≈100');
        expect(formatRegularSenkaValue({ status: 'range', min: 0.1, max: 0.2, observed: 0.1 }, 'en')).toBe('≈0–1');
    });

    it('no-start / no-data / anomaly 回傳破折號', () => {
        expect(formatRegularSenkaValue({ status: 'no-start', observed: 120 }, 'zh-TW')).toBe('—');
        expect(formatRegularSenkaValue({ status: 'no-data' }, 'en')).toBe('—');
        expect(formatRegularSenkaValue({ status: 'anomaly' }, 'ja')).toBe('—');
    });

    it('formatSignedSenka 處理 0、正數與負數', () => {
        expect(formatSignedSenka(0, 'zh-TW')).toBe('0');
        expect(formatSignedSenka(0.4, 'en')).toBe('0');
        expect(formatSignedSenka(96.4, 'en')).toBe('≈+96');
        expect(formatSignedSenka(-20.2, 'ja')).toBe('≈−20');
    });
});

describe('senkaDeadlineLines', () => {
    it('平日只顯示下次榜單更新一行（includeQuest 不影響平日）', () => {
        // 2026/11/15 10:00 JST = 01:00 UTC → 下次更新 15:00 JST = 06:00 UTC（剩 5:00）
        const now = Date.UTC(2026, 10, 15, 1, 0);
        const info = senkaDeadlines(now);
        const expected = [tFor('zh-TW', 'senka.nextUpdate', {
            time: formatSenkaTimestamp(info.nextUpdateAt),
            left: '5:00',
        })];
        expect(senkaDeadlineLines(info, 'zh-TW')).toEqual(expected);
        expect(senkaDeadlineLines(info, 'zh-TW', { includeQuest: true })).toEqual(expected);
    });

    it('最後一天預設（1a）只顯示普通戰果・EO 截止行，不顯示任務戰果截止', () => {
        // 2026/11/30 18:00 JST = 09:00 UTC → 普通 22:00 JST 剩 4:00
        const now = Date.UTC(2026, 10, 30, 9, 0);
        const info = senkaDeadlines(now);
        const lines = senkaDeadlineLines(info, 'zh-TW');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toBe(tFor('zh-TW', 'senka.cutoff', { time: formatSenkaTimestamp(info.closeAt), left: '4:00' }));
    });

    it('最後一天 includeQuest: true 時：14:00 JST 前顯示兩行開放截止倒數', () => {
        // 2026/11/30 10:00 JST = 01:00 UTC → 普通 22:00 JST 剩 12:00，任務 14:00 JST 剩 4:00
        const now = Date.UTC(2026, 10, 30, 1, 0);
        const info = senkaDeadlines(now);
        const lines = senkaDeadlineLines(info, 'en', { includeQuest: true });
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(tFor('en', 'senka.cutoff', { time: formatSenkaTimestamp(info.closeAt), left: '12:00' }));
        expect(lines[1]).toBe(tFor('en', 'senka.questOpen', { time: formatSenkaTimestamp(info.questCloseAt), left: '4:00' }));
    });

    it('最後一天 includeQuest: true 時：14:00 JST 後任務行改顯示已截止', () => {
        // 2026/11/30 18:00 JST = 09:00 UTC → 普通 22:00 JST 剩 4:00，任務已於 14:00 JST 截止
        const now = Date.UTC(2026, 10, 30, 9, 0);
        const info = senkaDeadlines(now);
        const lines = senkaDeadlineLines(info, 'ja', { includeQuest: true });
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(tFor('ja', 'senka.cutoff', { time: formatSenkaTimestamp(info.closeAt), left: '4:00' }));
        expect(lines[1]).toBe(tFor('ja', 'senka.questClosed', { time: formatSenkaTimestamp(info.questCloseAt) }));
    });
});

describe('buildRegularSenkaSummary & loadSenkaExpReadings', () => {
    const row = (eventId: number, ts: number, exp?: number): ResourceRow => ({
        eventId,
        ts,
        m: [1000, 1000, 1000, 1000, 10, 10, 10, 10],
        ...(exp === undefined ? {} : { exp }),
    });

    it('從 db.resources 取出月界前最後一筆有效 exp（跨長休）與本月讀數，忽略無 exp 列與下月列', async () => {
        const month = { year: 2026, month: 11 };
        const win = senkaMonthWindow(month);
        await db.resources.bulkPut([
            row(1, Date.UTC(2026, 7, 10, 0), 1_000_000),      // 8 月長休前最後一筆有效 exp
            row(2, win.start - 10_000),                        // 月界前 material 列（無 exp，不得蓋掉 eventId 1）
            row(3, win.start, 1_000_000),                      // 本月起點（exact 邊界含入）
            row(4, win.start + 60_000),                        // 本月中 material 列（無 exp）
            row(5, win.start + 3_600_000, 1_100_000),          // 本月成長
            row(6, win.end, 1_200_000),                        // 下月起點（[start, end) 應排除）
        ]);

        const readings = await loadSenkaExpReadings(db.resources, month);
        expect(readings).toEqual([
            { ts: Date.UTC(2026, 7, 10, 0), exp: 1_000_000 },
            { ts: win.start, exp: 1_000_000 },
            { ts: win.start + 3_600_000, exp: 1_100_000 },
        ]);

        const summary = buildRegularSenkaSummary(readings, win.start + 7_200_000);
        expect(summary.month).toEqual(month);
        expect(summary.regular).toEqual({ status: 'exact', points: 70, observed: 70 });
        expect(summary.today).toBe(70);
    });
});
