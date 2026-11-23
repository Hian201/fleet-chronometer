// EO 戰果與任務戰果純函式測試（utils/senka.ts、utils/quest-senka.ts）。
import { describe, expect, it } from 'vitest';
import {
    EO_SENKA_MAPS,
    eoClearsFromMapinfoSnapshot,
    eoMonthWindow,
    eoSenkaForMonth,
    isWithinLimitedQuestWindow,
    questSenkaForMonth,
    questSenkaMonthWindow,
    type QuestSenkaLookup,
} from '../utils/senka';
import { catalogQuestSenkaForMonth } from '../utils/quest-senka';

describe('EO 戰果時間窗與計算', () => {
    const nov = { year: 2026, month: 11 };
    const dec = { year: 2026, month: 12 };

    it('eoMonthWindow 為當月 1 日 00:00 JST 至當月末 22:00 JST（含頭不含尾）', () => {
        expect(eoMonthWindow(nov)).toEqual({
            start: Date.UTC(2026, 9, 31, 15, 0, 0),  // 11/1 00:00 JST
            end: Date.UTC(2026, 10, 30, 13, 0, 0),   // 11/30 22:00 JST
        });
    });

    it('全部 9 張 EO 全清總和為 1,425（含 5-6 +225 與 7-5 +170）', () => {
        const ts = Date.UTC(2026, 10, 10, 12, 0);
        const sorties = EO_SENKA_MAPS.map(({ map }, i) => ({
            ts: ts + i * 1000,
            map,
            cleared: true,
        }));
        const res = eoSenkaForMonth(sorties, nov);
        expect(res.total).toBe(1425);
        expect(res.clearedCount).toBe(9);
        expect(res.mapCount).toBe(9);
        expect(res.items.map(i => [i.map, i.points, i.cleared])).toEqual([
            ['1-5', 75, true],
            ['1-6', 75, true],
            ['2-5', 100, true],
            ['3-5', 150, true],
            ['7-5', 170, true],
            ['4-5', 180, true],
            ['5-5', 200, true],
            ['5-6', 225, true],
            ['6-5', 250, true],
        ]);
    });

    it('EO 時間窗邊界：1 日 00:00 JST 計入；前月末與當月末 22:00～23:59 JST 皆不計入任何月份', () => {
        const octEndBefore = Date.UTC(2026, 9, 31, 13, 0, 0); // 10/31 22:00 JST
        const octLateGap = Date.UTC(2026, 9, 31, 14, 59, 59, 999); // 10/31 23:59:59.999 JST
        const novStart = Date.UTC(2026, 9, 31, 15, 0, 0); // 11/1 00:00 JST
        const novEndLastMs = Date.UTC(2026, 10, 30, 12, 59, 59, 999); // 11/30 21:59:59.999 JST
        const novClose = Date.UTC(2026, 10, 30, 13, 0, 0); // 11/30 22:00 JST

        const sorties = [
            { ts: octEndBefore, map: '1-5', cleared: true },
            { ts: octLateGap, map: '1-6', cleared: true },
            { ts: novStart, map: '2-5', cleared: true },
            { ts: novEndLastMs, map: '3-5', cleared: true },
            { ts: novClose, map: '4-5', cleared: true },
        ];

        const octRes = eoSenkaForMonth(sorties, { year: 2026, month: 10 });
        expect(octRes.total).toBe(0);

        const novRes = eoSenkaForMonth(sorties, nov);
        expect(novRes.total).toBe(250); // 2-5 (+100) + 3-5 (+150)
        expect(novRes.clearedCount).toBe(2);

        const decRes = eoSenkaForMonth(sorties, dec);
        expect(decRes.total).toBe(0);
    });

    it('同海域重複 cleared 不重複計分（取最新時刻）；忽略未擊破、catchOnly 與非 EO 海域', () => {
        const t1 = Date.UTC(2026, 10, 5, 10, 0);
        const t2 = Date.UTC(2026, 10, 6, 10, 0);
        const sorties = [
            { ts: t1, map: '6-5', cleared: true },
            { ts: t2, map: '6-5', cleared: true },
            { ts: t1, map: '5-5', cleared: false },
            { ts: t1, map: '4-5' },
            { ts: t1, map: '3-5', cleared: true, catchOnly: true },
            { ts: t1, map: '2-4', cleared: true },
        ];

        const res = eoSenkaForMonth(sorties, nov);
        expect(res.total).toBe(250);
        expect(res.clearedCount).toBe(1);
        const item65 = res.items.find(i => i.map === '6-5')!;
        expect(item65).toEqual({ map: '6-5', points: 250, cleared: true, clearedAt: t2 });
        expect(res.items.find(i => i.map === '5-6')).toEqual({
            map: '5-6',
            points: 225,
            cleared: false,
            clearedAt: null,
        });
    });

    it('eoClearsFromMapinfoSnapshot 擷取 EO 的 api_cleared: 1/"1"，忽略未通關與一般／活動圖', () => {
        const snapTs = Date.UTC(2026, 10, 20, 8, 0);
        expect(eoClearsFromMapinfoSnapshot(null)).toEqual([]);
        expect(eoClearsFromMapinfoSnapshot({ ts: Number.NaN, api: { api_map_info: [] } })).toEqual([]);
        expect(eoClearsFromMapinfoSnapshot({ ts: snapTs, api: {} })).toEqual([]);

        const clears = eoClearsFromMapinfoSnapshot({
            ts: snapTs,
            api: {
                api_map_info: [
                    { api_id: 11, api_cleared: 1 },                                      // 一般圖 1-1 → 忽略
                    { api_id: 16, api_cleared: 1 },                                      // 1-6（無 Boss 戰）
                    { api_id: 35, api_cleared: 1 },                                      // 3-5
                    { api_id: 45, api_cleared: '1' },                                    // 4-5（字串 '1'）
                    { api_id: 55, api_cleared: 1 },                                      // 5-5
                    { api_id: 56, api_cleared: 1 },                                      // 5-6
                    { api_id: 64, api_cleared: 1 },                                      // 一般圖 6-4 → 忽略
                    { api_id: 65, api_cleared: 0, api_defeat_count: 5, api_required_defeat_count: 6 }, // 未擊破
                    { api_id: 72, api_cleared: 1 },                                      // 一般圖 7-2 → 忽略
                    { api_id: 75, api_cleared: 1 },                                      // 7-5
                    { api_id: 621, api_cleared: 1 },                                     // 活動圖 62-1 → 忽略
                ],
            },
        });
        expect(clears).toEqual([
            { ts: snapTs, map: '1-6', cleared: true },
            { ts: snapTs, map: '3-5', cleared: true },
            { ts: snapTs, map: '4-5', cleared: true },
            { ts: snapTs, map: '5-5', cleared: true },
            { ts: snapTs, map: '5-6', cleared: true },
            { ts: snapTs, map: '7-5', cleared: true },
        ]);
    });

    it('僅有當月 mapinfo 快照可計得 3-5／4-5／5-5（530），與 sorties 同海域不去重加總，跨月與月末空白期不計入', () => {
        const novSnapTs = Date.UTC(2026, 10, 20, 8, 0);
        const snapClears = eoClearsFromMapinfoSnapshot({
            ts: novSnapTs,
            api: {
                api_map_info: [
                    { api_id: 35, api_cleared: 1 }, // +150
                    { api_id: 45, api_cleared: 1 }, // +180
                    { api_id: 55, api_cleared: 1 }, // +200
                ],
            },
        });

        const onlySnap = eoSenkaForMonth(snapClears, nov);
        expect(onlySnap.total).toBe(530);
        expect(onlySnap.clearedCount).toBe(3);

        // sorties 與快照皆有 4-5 時不重複加總
        const merged = eoSenkaForMonth([
            { ts: Date.UTC(2026, 10, 10, 8, 0), map: '4-5', cleared: true },
            ...snapClears,
        ], nov);
        expect(merged.total).toBe(530);
        expect(merged.clearedCount).toBe(3);

        // 上月（10 月）與月末 22:00～23:59 JST 空白期快照不計入 11 月
        const octClears = eoClearsFromMapinfoSnapshot({
            ts: Date.UTC(2026, 9, 31, 14, 0), // 10/31 23:00 JST
            api: { api_map_info: [{ api_id: 65, api_cleared: 1 }] },
        });
        const lateNovGap = eoClearsFromMapinfoSnapshot({
            ts: Date.UTC(2026, 10, 30, 13, 30), // 11/30 22:30 JST
            api: { api_map_info: [{ api_id: 25, api_cleared: 1 }] },
        });
        expect(eoSenkaForMonth([...octClears, ...lateNovGap], nov).total).toBe(0);
    });
});

describe('任務戰果時間窗與計算', () => {
    const nov = { year: 2026, month: 11 };
    const dec = { year: 2026, month: 12 };

    it('questSenkaMonthWindow 為前月末 14:00 JST 至當月末 14:00 JST（含頭不含尾）', () => {
        expect(questSenkaMonthWindow(nov)).toEqual({
            start: Date.UTC(2026, 9, 31, 5, 0, 0),  // 10/31 14:00 JST
            end: Date.UTC(2026, 10, 30, 5, 0, 0),   // 11/30 14:00 JST
        });
    });

    it('任務時間窗邊界：14:00 JST 精確切換到下個月', () => {
        const octEndBefore = Date.UTC(2026, 9, 31, 4, 59, 59, 999); // 10/31 13:59:59.999 JST → 10 月
        const novWindowStart = Date.UTC(2026, 9, 31, 5, 0, 0);     // 10/31 14:00:00 JST → 11 月
        const novWindowEnd = Date.UTC(2026, 10, 30, 4, 59, 59, 999); // 11/30 13:59:59.999 JST → 11 月
        const decWindowStart = Date.UTC(2026, 10, 30, 5, 0, 0);    // 11/30 14:00:00 JST → 12 月

        const claims = [
            { eventId: 1, questNo: 284, ts: octEndBefore },   // +80
            { eventId: 2, questNo: 854, ts: novWindowStart }, // +350
            { eventId: 3, questNo: 888, ts: novWindowEnd },   // +200
            { eventId: 4, questNo: 893, ts: decWindowStart }, // +300
        ];

        expect(catalogQuestSenkaForMonth(claims, { year: 2026, month: 10 }).fixed).toBe(80);
        const novRes = catalogQuestSenkaForMonth(claims, nov);
        expect(novRes.fixed).toBe(550);
        expect(novRes.items.map(i => i.questNo)).toEqual([854, 888]);
        expect(catalogQuestSenkaForMonth(claims, dec).fixed).toBe(300);
    });

    it('提案跨界案例：月底 15:00 JST 領 893 (+300) 與 18:00 JST 破 6-5 (+250)', () => {
        const questTs = Date.UTC(2026, 10, 30, 6, 0, 0); // 11/30 15:00 JST
        const eoTs = Date.UTC(2026, 10, 30, 9, 0, 0);    // 11/30 18:00 JST

        const sorties = [{ ts: eoTs, map: '6-5', cleared: true }];
        const claims = [{ eventId: 10, questNo: 893, ts: questTs }];

        expect(eoSenkaForMonth(sorties, nov).total).toBe(250);
        expect(catalogQuestSenkaForMonth(claims, nov).fixed).toBe(0);

        expect(eoSenkaForMonth(sorties, dec).total).toBe(0);
        expect(catalogQuestSenkaForMonth(claims, dec).fixed).toBe(300);
    });

    it('949（B170）選擇報酬算為區間 [0, 800]，搭配固定戰果任務一併累計', () => {
        const t1 = Date.UTC(2026, 10, 10, 3, 0);
        const t2 = Date.UTC(2026, 10, 12, 3, 0);

        const only949 = catalogQuestSenkaForMonth([{ eventId: 1, questNo: 949, ts: t1 }], nov);
        expect(only949).toEqual({
            fixed: 0,
            choiceMax: 800,
            min: 0,
            max: 800,
            items: [{ eventId: 1, questNo: 949, ts: t1, fixed: 0, choice: 800 }],
        });

        const combined = catalogQuestSenkaForMonth([
            { eventId: 2, questNo: 893, ts: t2 },
            { eventId: 1, questNo: 949, ts: t1 },
        ], nov);
        expect(combined.fixed).toBe(300);
        expect(combined.choiceMax).toBe(800);
        expect(combined.min).toBe(300);
        expect(combined.max).toBe(1100);
        expect(combined.items.map(i => i.questNo)).toEqual([949, 893]);
    });

    it('換季月同編號季任不同 eventId 可累計兩次；相同 eventId 僅計一次', () => {
        // 11 月作戰窗：10/31 14:00 JST ～ 11/30 14:00 JST（跨季月交替邊界僅測試同編號不同 eventId）
        const t1 = Date.UTC(2026, 10, 1, 5, 0);
        const t2 = Date.UTC(2026, 10, 29, 5, 0);

        const twice = catalogQuestSenkaForMonth([
            { eventId: 101, questNo: 893, ts: t1 },
            { eventId: 102, questNo: 893, ts: t2 },
        ], nov);
        expect(twice.fixed).toBe(600);
        expect(twice.items).toHaveLength(2);

        const dupEvent = catalogQuestSenkaForMonth([
            { eventId: 101, questNo: 893, ts: t1 },
            { eventId: 101, questNo: 893, ts: t1 },
        ], nov);
        expect(dupEvent.fixed).toBe(300);
        expect(dupEvent.items).toHaveLength(1);
    });

    it('期間限定任務僅在有效期間（日本時間 [start, end 翌日 00:00)）內計入', () => {
        const win = { start: '2026-10-14', end: '2026-11-11' };
        expect(isWithinLimitedQuestWindow(Date.UTC(2026, 9, 13, 14, 59, 59, 999), win)).toBe(false); // 10/13 23:59 JST
        expect(isWithinLimitedQuestWindow(Date.UTC(2026, 9, 13, 15, 0, 0), win)).toBe(true);       // 10/14 00:00 JST
        expect(isWithinLimitedQuestWindow(Date.UTC(2026, 10, 11, 14, 59, 59, 999), win)).toBe(true); // 11/11 23:59:59 JST
        expect(isWithinLimitedQuestWindow(Date.UTC(2026, 10, 11, 15, 0, 0), win)).toBe(false);     // 11/12 00:00 JST
        expect(isWithinLimitedQuestWindow(Date.UTC(2026, 10, 12, 0, 0), undefined)).toBe(false);
        expect(isWithinLimitedQuestWindow(Date.UTC(2026, 10, 12, 0, 0), { start: '2026-11-11', end: null })).toBe(true);

        const lookup: QuestSenkaLookup = no => {
            if (no === 9001) return { reward: { fixed: 200, choice: 0 }, limited: true, limitedWindow: win };
            if (no === 9002) return { reward: { fixed: 150, choice: 0 }, limited: true }; // 缺期間
            if (no === 9003) return { reward: { fixed: 100, choice: 0 }, limited: true, limitedWindow: { start: '2026-11-11', end: null } };
            return null;
        };

        const res = questSenkaForMonth([
            { eventId: 1, questNo: 9001, ts: Date.UTC(2026, 10, 11, 14, 59) }, // 11/11 23:59 JST → 有效
            { eventId: 2, questNo: 9001, ts: Date.UTC(2026, 10, 11, 15, 0) },  // 11/12 00:00 JST → 逾期忽略
            { eventId: 3, questNo: 9002, ts: Date.UTC(2026, 10, 10, 12, 0) },  // 無期間 → 忽略
            { eventId: 4, questNo: 9003, ts: Date.UTC(2026, 10, 10, 14, 59) }, // 11/10 23:59 JST → 尚未開始
            { eventId: 5, questNo: 9003, ts: Date.UTC(2026, 10, 10, 15, 0) },  // 11/11 00:00 JST → 有效
            { eventId: 6, questNo: 101, ts: Date.UTC(2026, 10, 10, 15, 0) },   // 無戰果 → 忽略
        ], nov, lookup);

        expect(res.fixed).toBe(300);
        expect(res.items.map(i => i.questNo)).toEqual([9003, 9001]);
    });
});
