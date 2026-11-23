// utils/senka-view.ts 與 utils/senka-readings.ts 單元測試。
import { afterEach, describe, expect, it } from 'vitest';
import { db, type QuestObservedRow, type ResourceRow, type SortieLogRow } from '../utils/db';
import { loadSenkaExpReadings, loadSenkaMonthData } from '../utils/senka-readings';
import {
    buildObservedSenkaSummary,
    buildRegularSenkaSummary,
    formatObservedGainValue,
    formatObservedSenkaValue,
    formatQuestItemPoints,
    formatQuestSenkaValue,
    formatRegularPartValue,
    formatRegularSenkaValue,
    formatSenkaInt,
    formatSenkaRank,
    formatSenkaTimestamp,
    formatSignedSenka,
    senkaDeadlineLines,
} from '../utils/senka-view';
import { eoMonthWindow, questSenkaMonthWindow, senkaDeadlines, senkaMonthWindow } from '../utils/senka';
import { formatTime } from '../utils/date-format';
import { tFor } from '../utils/ui-i18n';

afterEach(async () => {
    await Promise.all([
        db.resources.clear(),
        db.sorties.clear(),
        db.questObserved.clear(),
        db.snapshot.clear(),
    ]);
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

describe('1b 已觀測戰果格式化', () => {
    const eo = (total: number) => ({ total, clearedCount: 0, mapCount: 9, items: [] });

    it('formatObservedSenkaValue 處理 exact、range、選擇報酬區間與缺起點', () => {
        expect(formatObservedSenkaValue({
            regular: { status: 'exact', points: 2450.2, observed: 2450.2 },
            eo: eo(1200),
            quest: { fixed: 300, choiceMax: 0, min: 300, max: 300, items: [] },
        }, 'zh-TW')).toBe('≈3,950');

        expect(formatObservedSenkaValue({
            regular: { status: 'exact', points: 2450, observed: 2450 },
            eo: eo(0),
            quest: { fixed: 300, choiceMax: 800, min: 300, max: 1100, items: [] },
        }, 'en')).toBe('≈2,750–3,550');

        expect(formatObservedSenkaValue({
            regular: { status: 'exact', points: 0, observed: 0 },
            eo: eo(0),
            quest: { fixed: 0, choiceMax: 0, min: 0, max: 0, items: [] },
        }, 'ja')).toBe('0');

        expect(formatObservedSenkaValue({
            regular: { status: 'range', min: 100.2, max: 110.4, observed: 100.2 },
            eo: eo(75),
            quest: { fixed: 0, choiceMax: 800, min: 0, max: 800, items: [] },
        }, 'zh-TW')).toBe('≈175～986');

        expect(formatObservedSenkaValue({
            regular: { status: 'no-start', observed: 100 },
            eo: eo(250),
            quest: { fixed: 300, choiceMax: 0, min: 300, max: 300, items: [] },
        }, 'en')).toBe('—');
    });

    it('formatObservedGainValue / formatRegularPartValue / formatQuestSenkaValue / formatQuestItemPoints', () => {
        expect(formatObservedGainValue({
            regular: { status: 'no-start', observed: 80 },
            eo: eo(250),
            quest: { fixed: 300, choiceMax: 0, min: 300, max: 300, items: [] },
        }, 'zh-TW')).toBe('≈+630');

        expect(formatObservedGainValue({
            regular: { status: 'no-start', observed: 80 },
            eo: eo(0),
            quest: { fixed: 0, choiceMax: 800, min: 0, max: 800, items: [] },
        }, 'en')).toBe('≈+80–+880');

        expect(formatRegularPartValue({ status: 'exact', points: 2450.2, observed: 2450.2 }, 'en')).toBe('2,450');
        expect(formatRegularPartValue({ status: 'range', min: 10.1, max: 15.8, observed: 10.1 }, 'zh-TW')).toBe('10～16');
        expect(formatRegularPartValue({ status: 'no-start', observed: 10 }, 'ja')).toBe('—');

        expect(formatQuestSenkaValue({ min: 300, max: 300 }, 'zh-TW')).toBe('300');
        expect(formatQuestSenkaValue({ min: 300, max: 1100 }, 'en')).toBe('300–1,100');

        expect(formatQuestItemPoints({ fixed: 300, choice: 0 }, 'zh-TW')).toBe('+300');
        expect(formatQuestItemPoints({ fixed: 0, choice: 800 }, 'zh-TW')).toBe('0～+800');
        expect(formatQuestItemPoints({ fixed: 0, choice: 800 }, 'en')).toBe('0–+800');
        expect(formatQuestItemPoints({ fixed: 100, choice: 800 }, 'ja')).toBe('+100～+900');
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

describe('buildRegularSenkaSummary & loadSenkaExpReadings & loadSenkaMonthData', () => {
    const row = (eventId: number, ts: number, exp?: number): ResourceRow => ({
        eventId,
        ts,
        m: [1000, 1000, 1000, 1000, 10, 10, 10, 10],
        ...(exp === undefined ? {} : { exp }),
    });

    const sortieRow = (eventId: number, ts: number, map: string, cleared: boolean, catchOnly = false): SortieLogRow => ({
        eventId,
        sortieKey: eventId - 1,
        ts,
        map,
        node: 1,
        boss: true,
        kind: 'battle',
        rank: 'S',
        seiku: null,
        enemyIds: [],
        enemyIdsEscort: [],
        drop: null,
        taiha: false,
        cleared,
        ...(catchOnly ? { catchOnly: true } : {}),
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

    it('loadSenkaMonthData 依各組成時間窗查詢 resources、sorties 與 questObserved 並組裝 1b 摘要', async () => {
        const month = { year: 2026, month: 11 };
        const win = senkaMonthWindow(month);
        const eoWin = eoMonthWindow(month);
        const questWin = questSenkaMonthWindow(month);

        await db.resources.bulkPut([
            row(1, win.start - 10_000, 1_000_000),
            row(2, win.start, 1_000_000),
            row(3, win.start + 3_600_000, 1_100_000), // +70 普通戰果
        ]);
        await db.sorties.bulkPut([
            sortieRow(10, eoWin.start - 1000, '1-5', true),       // 10/31 23:59 JST → 不屬 11 月
            sortieRow(11, eoWin.start, '6-5', true),              // 11/1 00:00 JST → +250
            sortieRow(12, eoWin.start + 1000, '5-5', false),      // 未擊破 → 忽略
            sortieRow(13, eoWin.start + 2000, '4-5', true, true), // catchOnly → 忽略
            sortieRow(14, eoWin.end, '1-5', true),                // 11/30 22:00 JST → 排除
        ]);
        const claims: QuestObservedRow[] = [
            { eventId: 20, questNo: 854, ts: questWin.start - 1 }, // 上月
            { eventId: 21, questNo: 893, ts: questWin.start },     // +300
            { eventId: 22, questNo: 949, ts: questWin.end - 1 },   // 0..+800
            { eventId: 23, questNo: 888, ts: questWin.end },       // 下月
        ];
        await db.questObserved.bulkPut(claims);

        const data = await loadSenkaMonthData(db, month);
        expect(data.readings).toHaveLength(3);
        expect(data.sorties).toHaveLength(1);
        expect(data.questClaims).toHaveLength(2);

        const summary = buildObservedSenkaSummary(data, win.start + 7_200_000);
        expect(summary.regular).toEqual({ status: 'exact', points: 70, observed: 70 });
        expect(summary.eo.total).toBe(250);
        expect(summary.eo.clearedCount).toBe(1);
        expect(summary.quest.min).toBe(300);
        expect(summary.quest.max).toBe(1100);
        expect(formatObservedSenkaValue(summary, 'zh-TW')).toBe('≈620～1,420');
    });

    it('db.sorties 為空時可從當月 mapinfo 快照讀出已擊破的 3-5／4-5／5-5（+530），忽略上月與月末 22:00 後快照', async () => {
        const month = { year: 2026, month: 11 };
        const eoWin = eoMonthWindow(month);

        await db.snapshot.put({
            path: 'api_get_member/mapinfo',
            ts: Date.UTC(2026, 10, 20, 8, 0),
            api: {
                api_map_info: [
                    { api_id: 35, api_cleared: 1 },
                    { api_id: 45, api_cleared: 1 },
                    { api_id: 55, api_cleared: 1 },
                    { api_id: 65, api_cleared: 0, api_defeat_count: 3, api_required_defeat_count: 6 },
                ],
            },
        });
        const fromCurrentSnap = await loadSenkaMonthData(db, month);
        const currentSummary = buildObservedSenkaSummary(fromCurrentSnap, Date.UTC(2026, 10, 20, 9, 0));
        expect(currentSummary.eo.total).toBe(530);
        expect(currentSummary.eo.clearedCount).toBe(3);

        // 上月（10/31 23:00 JST）與月末 22:00 後（11/30 22:30 JST）快照不得計入本月
        for (const outOfWindowTs of [eoWin.start - 3_600_000, eoWin.end + 1_800_000]) {
            await db.snapshot.put({
                path: 'api_get_member/mapinfo',
                ts: outOfWindowTs,
                api: { api_map_info: [{ api_id: 35, api_cleared: 1 }] },
            });
            const outData = await loadSenkaMonthData(db, month);
            expect(outData.sorties).toEqual([]);
        }
    });
});
