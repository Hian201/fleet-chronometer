// 目標規劃第二階段：觀測流量與到達日推算。master 取自 samples/start2-master.json。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { DAY_MS } from '../utils/date-format';
import { goalArrivals, observeFlow, type ObservedFlow } from '../utils/goal-arrival';
import { planRemodelGoals, type GoalShip, type RemodelStock } from '../utils/remodel-goals';
import type { MaterialUseRow } from '../utils/db';
import type { Sample } from '../utils/resource-log';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const state = new GameState();
state.applyEvent('api_start2/getData', master.api_data ?? master);

const YAMATO_KAI = 136, YAMATO_K2 = 911; // 彈藥 9900、鋼材 9800、設計圖 3
const ISE_KAI = 82, ISE_K2 = 553; // 彈藥 4800、鋼材 7200、開發資材 80

const T0 = Date.UTC(2026, 9, 1);
/** 索引 1 彈藥、2 鋼材、6 開發資材、7 改修資材。 */
const at = (day: number, ammo: number, steel: number, devmat = 0, screw = 0): Sample =>
    ({ ts: T0 + day * DAY_MS, m: [0, ammo, steel, 0, 0, 0, devmat, screw] });

describe('observeFlow', () => {
    it('觀測不足一週回 null（不可考）', () => {
        expect(observeFlow([at(0, 0, 0), at(6, 100, 100)], [], state)).toBeNull();
        expect(observeFlow([], [], state)).toBeNull();
    });

    it('逐週算淨增加，區間取最慢與最快一週', () => {
        // 第一週彈藥 +700（每日 100），第二週 +1400（每日 200）
        const flow = observeFlow([at(0, 0, 0), at(7, 700, 0), at(14, 2100, -700)], [], state)!;
        expect(flow.weeks).toBe(2);
        expect(flow.fromTs).toBe(T0);
        expect(flow.rates.ammo).toEqual({ low: 100, high: 200, mean: 150 });
        expect(flow.rates.steel).toEqual({ low: -100, high: 0, mean: -50 });
        // 道具類沒有序列
        expect(flow.rates.blueprint).toBeUndefined();
        // 各週明細由新到舊
        expect(flow.blocks!.map(block => [block.fromTs, block.toTs, block.rates.ammo])).toEqual([
            [T0 + 7 * DAY_MS, T0 + 14 * DAY_MS, 200], [T0, T0 + 7 * DAY_MS, 100],
        ]);
    });

    it('最多往回取四週', () => {
        const samples = Array.from({ length: 8 }, (_, week) => at(week * 7, week * 70, 0));
        expect(observeFlow(samples, [], state)!.weeks).toBe(4);
    });

    it('改造支出加回去，不讓一次性改造拉低步調', () => {
        const remodel: MaterialUseRow = { eventId: 1, ts: T0 + 3 * DAY_MS, kind: 'remodel', shipId: 1, fromMst: ISE_KAI };
        // 期間彈藥從 5000 掉到 900：其中 4800 是改造伊勢改二
        const flow = observeFlow([at(0, 5000, 0, 100), at(7, 900, 0, 20)], [remodel], state)!;
        expect(flow.rates.ammo!.mean).toBeCloseTo(700 / 7);
        expect(flow.rates.devmat!.mean).toBe(0);
    });

    it('取樣有空檔時用實際天數，不重複使用同一筆取樣', () => {
        // 第 0 天之後直接跳到第 20 天：只有一段 20 天
        const flow = observeFlow([at(0, 0, 0), at(20, 2000, 0)], [], state)!;
        expect(flow.weeks).toBe(1);
        expect(flow.rates.ammo).toEqual({ low: 100, high: 100, mean: 100 });
    });

    it('空檔前同一天的密集取樣不會切出只有幾分鐘的一段', () => {
        const min = DAY_MS / 1440;
        const samples = [at(0, 0, 0), { ...at(0, 50, 0), ts: T0 + 3 * min }, at(14, 1450, 0)];
        const flow = observeFlow(samples, [], state)!;
        expect(flow.weeks).toBe(1);
        expect(flow.blocks!.every(block => block.toTs - block.fromTs >= 7 * DAY_MS)).toBe(true);
        expect(flow.rates.ammo!.high).toBeCloseTo(1400 / (14 - 3 / 1440));
    });
});

const ship = (id: number, masterId: number): GoalShip => ({ id, masterId, lv: 99, exp: 0 });
const flowOf = (rates: ObservedFlow['rates']): ObservedFlow => ({ fromTs: 0, toTs: 0, weeks: 4, rates });

function arrivals(stock: RemodelStock, flow: ObservedFlow | null, goals = [{ shipId: 1, targetMst: YAMATO_K2 }]) {
    const ships = new Map([[1, ship(1, YAMATO_KAI)], [2, ship(2, ISE_KAI)]]);
    const { plans } = planRemodelGoals(state, goals, ships, stock);
    return goalArrivals(plans, stock, flow);
}

describe('goalArrivals', () => {
    it('缺口 ÷ 最快與最慢步調＝最早與最晚天數', () => {
        const [arrival] = arrivals({ ammo: 8900, steel: 9800, blueprint: 3, report: 1, boiler: 2, gunMat: 3 },
            flowOf({ ammo: { low: 50, high: 100, mean: 75 }, steel: { low: 0, high: 0, mean: 0 } }));
        expect(arrival!.lines.find(line => line.key === 'ammo')).toEqual({ key: 'ammo', status: 'range', deficit: 1000, earliest: 10, latest: 20 });
        expect(arrival!.lines.find(line => line.key === 'steel')!.status).toBe('met');
        expect(arrival).toMatchObject({ earliest: 10, latest: 20, blocked: [] });
    });

    it('道具類缺口不可考，整個目標只剩下界', () => {
        const [arrival] = arrivals({ ammo: 8900, steel: 9800, blueprint: 1, report: 1, boiler: 2, gunMat: 3 },
            flowOf({ ammo: { low: 50, high: 100, mean: 75 } }));
        expect(arrival!.lines.find(line => line.key === 'blueprint')).toEqual({ key: 'blueprint', status: 'untracked', deficit: 2 });
        expect(arrival).toMatchObject({ earliest: 10, latest: 20, blocked: ['blueprint'] });
    });

    it('最慢一週沒有淨增加：上界看不到；最快一週也沒有：照目前步調湊不齊', () => {
        const stock = { ammo: 8900, steel: 8800, blueprint: 3, report: 1, boiler: 2, gunMat: 3 };
        const [open] = arrivals(stock, flowOf({ ammo: { low: -10, high: 100, mean: 40 }, steel: { low: 50, high: 100, mean: 75 } }));
        expect(open).toMatchObject({ earliest: 10, latest: null, blocked: [] });
        const [stalled] = arrivals(stock, flowOf({ ammo: { low: -10, high: 0, mean: -5 }, steel: { low: 50, high: 100, mean: 75 } }));
        expect(stalled!.lines.find(line => line.key === 'ammo')!.status).toBe('stalled');
        expect(stalled).toMatchObject({ earliest: 10, latest: null, blocked: ['ammo'] });
    });

    it('觀測不足或持有量不可考時為 no-data', () => {
        const [noFlow] = arrivals({ ammo: 8900, steel: 9800, blueprint: 3, report: 1, boiler: 2, gunMat: 3 }, null);
        expect(noFlow!.lines.find(line => line.key === 'ammo')!.status).toBe('no-data');
        expect(noFlow).toMatchObject({ earliest: null, latest: null, blocked: ['ammo'] });
        const [noStock] = arrivals({ steel: 9800, blueprint: 3, report: 1, boiler: 2, gunMat: 3 }, flowOf({ ammo: { low: 1, high: 1, mean: 1 } }));
        expect(noStock!.lines.find(line => line.key === 'ammo')).toMatchObject({ status: 'no-data', deficit: null });
    });

    it('後面的目標要等前面的也湊齊：缺口取累計需求 − 持有量', () => {
        // 彈藥持有 5000：大和需 9900、伊勢需 4800 → 伊勢的累計缺口是 14700 − 5000 = 9700
        const stock = { ammo: 5000, steel: 20000, devmat: 100, blueprint: 5, catapult: 1, report: 2, boiler: 2, gunMat: 3 };
        const [yamato, ise] = arrivals(stock, flowOf({ ammo: { low: 100, high: 100, mean: 100 }, steel: { low: 0, high: 0, mean: 0 }, devmat: { low: 0, high: 0, mean: 0 } }),
            [{ shipId: 1, targetMst: YAMATO_K2 }, { shipId: 2, targetMst: ISE_K2 }]);
        expect(yamato!.lines.find(line => line.key === 'ammo')).toMatchObject({ deficit: 4900, earliest: 49 });
        expect(ise!.lines.find(line => line.key === 'ammo')).toMatchObject({ deficit: 9700, earliest: 97 });
        expect(ise!.lines.find(line => line.key === 'devmat')!.status).toBe('met');
    });

    it('累計需求超過蓄積上限不算存不到：改造逐艘花掉，前面的做完就扣', () => {
        const goals = Array.from({ length: 40 }, (_, i) => ({ shipId: 100 + i, targetMst: ISE_K2 }));
        const ships = new Map(goals.map(goal => [goal.shipId, ship(goal.shipId, ISE_KAI)]));
        const stock = { ammo: 1e6, steel: 1e6, devmat: 0, blueprint: 99, catapult: 99, report: 99 };
        const { plans } = planRemodelGoals(state, goals, ships, stock);
        const result = goalArrivals(plans, stock, flowOf({ devmat: { low: 10, high: 10, mean: 10 } }));
        // 開發資材上限 3000：第 38 個起累計 3040 > 3000，但每艘只要 80，照樣推得出日期
        expect(result[37]!.lines.find(line => line.key === 'devmat')).toMatchObject({ status: 'range', deficit: 3040, earliest: 304 });
    });

    it('非 active 的目標回 null', () => {
        expect(arrivals({}, null, [{ shipId: 9, targetMst: YAMATO_K2 }])).toEqual([null]);
    });
});
