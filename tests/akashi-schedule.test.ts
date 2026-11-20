// 改修日程資料與查詢（utils/akashi-schedule*.ts）。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AKASHI_HELPER_BASE, AKASHI_KC3_ONLY, AKASHI_SCHEDULE, AKASHI_SOLO, AKASHI_UNCONFIRMED } from '../utils/akashi-schedule-data';
import { akashiByHelper, akashiToday, akashiUncovered, akashiUnconfirmed, akashiWeek, helperBase, improveStats, jstWeekday } from '../utils/akashi-schedule';

const text = readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8');
const master = JSON.parse(text.slice(text.indexOf('{')));
const start2 = master.api_data ?? master;
const shipIds = new Set<number>(start2.api_mst_ship.map((s: { api_id: number }) => s.api_id));
const gearIds = new Set<number>(start2.api_mst_slotitem.map((g: { api_id: number }) => g.api_id));

describe('jstWeekday', () => {
    it('JST 00:00 換日（UTC 15:00），不依賴執行機時區', () => {
        // 2026-11-15 是週日
        expect(jstWeekday(Date.UTC(2026, 10, 14, 14, 59, 59))).toBe(6); // 週六 23:59:59 JST
        expect(jstWeekday(Date.UTC(2026, 10, 14, 15, 0, 0))).toBe(0); // 週日 00:00:00 JST
        expect(jstWeekday(Date.UTC(2026, 10, 15, 14, 59, 59))).toBe(0); // 週日 23:59:59 JST
        expect(jstWeekday(Date.UTC(2026, 10, 15, 15, 0, 0))).toBe(1); // 週一 00:00:00 JST
    });
});

describe('真實資料抽樣', () => {
    // 下列四件裝備在 wiki 改修表與 KC3Kai akashi.json 的逐日二番艦集合完全一致（產生器交叉比對），
    // 預期值取自產生物；艦 id 為 start2 master id。
    it('41cm連装砲(8)：長門系／陸奥系分曜日', () => {
        // 長門 80／改 275／改二 541；陸奥 81／改 276／改二 573。
        // 陸奥改二只在週日、週一；其餘曜日只剩 陸奥／陸奥改（wiki 例 5：較具體的記載優先）。
        const week = akashiWeek(8);
        expect(week.map(d => d.helpers.map(h => h.masterId))).toEqual([
            [81, 276, 573], [81, 276, 573], [80, 275, 541], [], [81, 276], [80, 275, 541], [80, 275, 541],
        ]);
        expect(week.some(d => d.solo)).toBe(false);
    });

    it('新型高温高圧缶(87)：島風系與天津風系', () => {
        // 島風 50／改 229：月火金；天津風改 316：火水木；天津風改二 951：月火水木
        const week = akashiWeek(87);
        expect(week.map(d => d.helpers.map(h => h.masterId))).toEqual([
            [], [50, 229, 951], [50, 229, 316, 951], [316, 951], [316, 951], [50, 229], [],
        ]);
    });

    it('22号対水上電探改四(88)：三位二番艦各自的曜日', () => {
        // 金剛改二 149：火木金；羽黒改二 194：日月金土；妙高改二 319：日木金土
        const week = akashiWeek(88);
        expect(week.map(d => d.helpers.map(h => h.masterId))).toEqual([
            [194, 319], [194], [149], [], [149, 319], [149, 194, 319], [194, 319],
        ]);
    });

    it('SBD(195)：Saratoga 系每天都行，其餘形態只有四天', () => {
        const week = akashiWeek(195, new Set([433]));
        expect(week[3].helpers.filter(h => h.masterId === 433)).toEqual([{ masterId: 433, owned: true }]);
        expect(week[0].helpers.map(h => h.masterId)).toContain(438); // Saratoga改：日月金土
        expect(week[3].helpers.map(h => h.masterId)).not.toContain(438);
    });

    it('12.7cm連装砲(2)：每天明石單獨即可', () => {
        const week = akashiWeek(2);
        expect(week.every(d => d.solo && d.helpers.length === 0)).toBe(true);
    });

    it('表內沒有的裝備：七天皆空', () => {
        const week = akashiWeek(999999);
        expect(week).toHaveLength(7);
        expect(week.every(d => !d.solo && d.helpers.length === 0)).toBe(true);
    });
});

describe('akashiToday', () => {
    const held = new Map([[2, 1], [8, 2], [87, 1], [999999, 5], [3, 0]]);

    it('只回傳玩家持有的裝備，並標出二番艦是否持有', () => {
        const rows = akashiToday(2, held, new Set([80, 316])); // 週二
        expect(rows).toEqual([
            { gearMst: 2, held: 1, solo: true, helpers: [] },
            { gearMst: 8, held: 2, solo: false, helpers: [
                { masterId: 80, owned: true }, { masterId: 275, owned: false }, { masterId: 541, owned: false },
            ] },
            { gearMst: 87, held: 1, solo: false, helpers: [
                { masterId: 50, owned: false }, { masterId: 229, owned: false },
                { masterId: 316, owned: true }, { masterId: 951, owned: false },
            ] },
        ]);
    });

    it('當天沒有可用二番艦也不是單獨的裝備不列出', () => {
        const rows = akashiToday(3, new Map([[8, 1]]), new Set()); // 41cm連装砲 週三沒有
        expect(rows).toEqual([]);
    });

    it('單獨與二番艦並存時兩者都回報', async () => {
        vi.resetModules();
        vi.doMock('../utils/akashi-schedule-data', async importOriginal => ({
            ...await importOriginal<typeof import('../utils/akashi-schedule-data')>(),
            AKASHI_SOLO: 0,
            AKASHI_SCHEDULE: [[10, [[0, 0b0000011], [50, 0b0000010]]]],
        }));
        const mocked = await import('../utils/akashi-schedule');
        const owned = new Set([50]);
        const counts = new Map([[10, 1]]);
        expect(mocked.akashiToday(0, counts, owned)).toEqual([{ gearMst: 10, held: 1, solo: true, helpers: [] }]);
        expect(mocked.akashiToday(1, counts, owned)).toEqual([
            { gearMst: 10, held: 1, solo: true, helpers: [{ masterId: 50, owned: true }] },
        ]);
        expect(mocked.akashiToday(2, counts, owned)).toEqual([]);
        vi.doUnmock('../utils/akashi-schedule-data');
        vi.resetModules();
    });
});

describe('akashiUncovered', () => {
    it('持有但整張表沒有的裝備，排除數量為 0 者，依 id 排序', () => {
        expect(akashiUncovered(new Map([[999999, 1], [8, 1], [888888, 2], [777777, 0]]))).toEqual([888888, 999999]);
    });
});

describe('akashiUnconfirmed', () => {
    it('表內有、曜日未確認的裝備：只回傳玩家持有的', () => {
        // 305 Ju87C改二(KMX搭載機)、466 流星改(熟練)、579 13.8cm単装砲 Modèle 1927、580 55cm三連装魚雷 Modèle 1924
        expect(AKASHI_UNCONFIRMED).toEqual([305, 466, 579, 580]);
        expect(akashiUnconfirmed(new Map([[466, 2], [8, 1], [579, 0], [305, 1]]))).toEqual([305, 466]);
        // 這幾件不在週表內，所以 akashiUncovered 仍會列出（總表用）
        expect(akashiUncovered(new Map([[466, 1]]))).toEqual([466]);
    });
});

describe('helperBase', () => {
    it('一般改造鏈歸到起點', () => {
        // 睦月 1／改 254／改二 434；衣笠 123／改 295／改二 142；龍鳳 185／改 318／改二戊 883／改二 888 起點為大鯨 184
        expect([1, 254, 434].map(helperBase)).toEqual([1, 1, 1]);
        expect([123, 295, 142].map(helperBase)).toEqual([123, 123, 123]);
        expect([185, 318, 883, 888].map(helperBase)).toEqual([184, 184, 184, 184]);
    });

    it('宗谷三形態互指成環，仍收斂到 699', () => {
        expect([645, 650, 699].map(helperBase)).toEqual([699, 699, 699]);
    });

    it('表外的艦回傳自己', () => {
        expect(helperBase(999999)).toBe(999999);
    });

    it('涵蓋表內所有二番艦，且起點在同一條改造鏈上', () => {
        const base = new Map(AKASHI_HELPER_BASE.map(([ship, start]) => [ship, start]));
        for (const [, pairs] of AKASHI_SCHEDULE) {
            for (const [ship] of pairs) if (ship !== AKASHI_SOLO) expect(base.has(ship), `艦 ${ship}`).toBe(true);
        }
        for (const [ship, start] of AKASHI_HELPER_BASE) expect(shipIds.has(start), `起點 ${start}（${ship}）`).toBe(true);
    });
});

describe('improveStats', () => {
    const row = (ts: number, gearMst: number | undefined, success: boolean | undefined, certain?: boolean, kind = 'improve') =>
        ({ kind, ts, gearMst, success, certain }) as Parameters<typeof improveStats>[0][number];

    it('彙總嘗試、成功、確実化與最後時間，次數多者在前', () => {
        const stats = improveStats([
            row(100, 8, true), row(300, 8, false, true), row(200, 8, true, true),
            row(500, 2, false),
            row(400, 87, true), row(450, 87, true),
        ]);
        expect(stats).toEqual([
            { gearMst: 8, attempts: 3, successes: 2, certain: 2, lastTs: 300 },
            { gearMst: 87, attempts: 2, successes: 2, certain: 0, lastTs: 450 },
            { gearMst: 2, attempts: 1, successes: 0, certain: 0, lastTs: 500 },
        ]);
    });

    it('其他種類、缺裝備 id、缺成敗結果的列不計入', () => {
        expect(improveStats([
            row(1, 8, true, false, 'develop'), row(2, undefined, true), row(3, 0, true), row(4, 8, undefined),
        ])).toEqual([]);
    });
});

describe('資料模組健全性', () => {
    it('每筆的裝備 id、艦 id 都在 start2 master，週位元在 1..127', () => {
        for (const [gear, pairs] of AKASHI_SCHEDULE) {
            expect(gearIds.has(gear), `裝備 ${gear}`).toBe(true);
            expect(pairs.length, `裝備 ${gear} 沒有任何二番艦／單獨`).toBeGreaterThan(0);
            for (const [ship, bits] of pairs) {
                expect(ship === AKASHI_SOLO || shipIds.has(ship), `艦 ${ship}`).toBe(true);
                expect(bits).toBeGreaterThanOrEqual(1);
                expect(bits).toBeLessThanOrEqual(127);
            }
        }
    });

    it('裝備 id 不重複且遞增，同一裝備的二番艦不重複', () => {
        const gears = AKASHI_SCHEDULE.map(([gear]) => gear);
        expect(gears).toEqual([...new Set(gears)].sort((a, b) => a - b));
        for (const [, pairs] of AKASHI_SCHEDULE) {
            const ships = pairs.map(([ship]) => ship);
            expect(ships.length).toBe(new Set(ships).size);
        }
    });

    it('KC3Kai 獨有的裝備都在表內', () => {
        const gears = new Set(AKASHI_SCHEDULE.map(([gear]) => gear));
        for (const gear of AKASHI_KC3_ONLY) expect(gears.has(gear)).toBe(true);
    });
});

describe('akashiByHelper', () => {
    it('二番艦今天多出的持有裝備：41cm連装砲(8) 週二只有長門系', () => {
        const held = new Map([[8, 2], [2, 1], [999999, 1]]);
        expect(akashiByHelper(2, held, 80)).toEqual([{ gearMst: 8, held: 2 }]);
        expect(akashiByHelper(2, held, 81)).toEqual([]); // 陸奧系週二沒有
    });

    it('明石單獨本來就能改修的裝備不算多出；沒持有的不列；AKASHI_SOLO 不當二番艦', () => {
        const held = new Map([[2, 1], [8, 0]]);
        expect(akashiByHelper(2, held, 80)).toEqual([]);
        expect(akashiByHelper(2, new Map([[2, 1]]), AKASHI_SOLO)).toEqual([]);
    });
});
