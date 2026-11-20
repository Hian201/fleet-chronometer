// 備蓄目標：終點是蓄積上限，先扣改造保留，推算到上限的天數與期限當天的量。
import { describe, expect, it } from 'vitest';
import type { ObservedFlow } from '../utils/goal-arrival';
import {
    STOCKPILE_KEYS, isStockpileDate, stockpileCap, stockpileFromRows, stockpileOutlook, stockpileToRow,
} from '../utils/stockpile';

const flowOf = (rates: ObservedFlow['rates']): ObservedFlow => ({ fromTs: 0, toTs: 0, weeks: 4, rates });
const line = (lines: ReturnType<typeof stockpileOutlook>, key: string) => lines.find(l => l.key === key)!;

describe('stockpileOutlook', () => {
    it('八種資材全列，上限依資材', () => {
        const lines = stockpileOutlook({}, {}, null, null);
        expect(lines.map(l => l.key)).toEqual([...STOCKPILE_KEYS]);
        expect([stockpileCap('fuel'), stockpileCap('bauxite'), stockpileCap('drum'), stockpileCap('screw')])
            .toEqual([350_000, 350_000, 3000, 3000]);
    });

    it('到上限：缺口 ÷ 最快一週為最早、÷ 最慢一週為最晚', () => {
        const lines = stockpileOutlook({ fuel: 340_000 }, {}, flowOf({ fuel: { low: 500, high: 1000, mean: 700 } }), null);
        expect(line(lines, 'fuel').toCap).toEqual({ status: 'range', earliest: 10, latest: 20 });
        expect(line(lines, 'fuel').atDeadline).toBeNull();
    });

    it('改造保留先扣掉：視為已花掉', () => {
        const lines = stockpileOutlook({ steel: 340_000 }, { steel: 10_000 }, flowOf({ steel: { low: 1000, high: 1000, mean: 1000 } }), null);
        expect(line(lines, 'steel')).toMatchObject({ have: 340_000, reserved: 10_000, toCap: { status: 'range', earliest: 20, latest: 20 } });
    });

    it('已滿、最慢一週沒增加、最快一週也沒增加、不可考', () => {
        const flow = flowOf({
            ammo: { low: -10, high: 50, mean: 20 },
            bauxite: { low: -10, high: 0, mean: -5 },
        });
        const lines = stockpileOutlook({ fuel: 350_000, ammo: 349_000, bauxite: 1000, steel: null }, {}, flow, null);
        expect(line(lines, 'fuel').toCap).toEqual({ status: 'full' });
        expect(line(lines, 'ammo').toCap).toEqual({ status: 'range', earliest: 20, latest: null });
        expect(line(lines, 'bauxite').toCap).toEqual({ status: 'stalled' });
        expect(line(lines, 'steel').toCap).toEqual({ status: 'unknown' });
        // 有持有量但沒有流量
        expect(stockpileOutlook({ fuel: 1 }, {}, null, null)[0].toCap).toEqual({ status: 'unknown' });
    });

    it('期限當天的量夾在 0 與上限之間；最快一週會在期限前滿就標出', () => {
        const flow = flowOf({
            fuel: { low: 100, high: 1000, mean: 500 },
            steel: { low: 100, high: 200, mean: 150 },
        });
        const lines = stockpileOutlook({ fuel: 340_000, steel: 1000 }, { steel: 5000 }, flow, 30);
        // 燃料：340,000 + 100×30 ＝ 343,000；最快 10 天就滿
        expect(line(lines, 'fuel')).toMatchObject({ atDeadline: { low: 343_000, high: 350_000 }, fillsBeforeDeadline: true });
        // 鋼材：1,000 − 5,000 ＋ 100×30 ＝ −1,000 → 0；＋200×30 ＝ 2,000
        expect(line(lines, 'steel')).toMatchObject({ atDeadline: { low: 0, high: 2000 }, fillsBeforeDeadline: false });
    });

    it('已滿又設了期限：期限時依流量推且標出；淨消耗時會掉下來、不標；流量不可考時期限時不可考；期限已過不推算', () => {
        expect(stockpileOutlook({ fuel: 360_000 }, {}, flowOf({ fuel: { low: 100, high: 500, mean: 300 } }), 5)[0])
            .toMatchObject({ toCap: { status: 'full' }, atDeadline: { low: 350_000, high: 350_000 }, fillsBeforeDeadline: true });
        expect(stockpileOutlook({ fuel: 350_000 }, {}, flowOf({ fuel: { low: -2000, high: -1000, mean: -1500 } }), 5)[0])
            .toMatchObject({ toCap: { status: 'full' }, atDeadline: { low: 340_000, high: 345_000 }, fillsBeforeDeadline: false });
        expect(stockpileOutlook({ fuel: 360_000 }, {}, null, 5)[0]).toMatchObject({ atDeadline: null, fillsBeforeDeadline: true });
        const past = stockpileOutlook({ fuel: 1000 }, {}, flowOf({ fuel: { low: 1, high: 1, mean: 1 } }), -2)[0];
        expect(past).toMatchObject({ atDeadline: null, fillsBeforeDeadline: false });
    });
});

describe('資料列', () => {
    it('期限必須是有效的日曆日期', () => {
        expect(isStockpileDate('2026-12-20')).toBe(true);
        expect(isStockpileDate('2026-02-30')).toBe(false);
        expect(isStockpileDate('2026-1-5')).toBe(false);
        expect(isStockpileDate(null)).toBe(false);
    });

    it('只認 stockpile 主鍵的那一列；無效期限讀成沒設期限', () => {
        expect(stockpileFromRows([{ key: 'remodel:1', kind: 'remodel' }])).toBeNull();
        expect(stockpileFromRows([stockpileToRow({ until: '2026-12-20' })])).toEqual({ until: '2026-12-20' });
        expect(stockpileFromRows([{ key: 'stockpile', kind: 'stockpile', until: 'soon' }])).toEqual({ until: null });
        expect(stockpileToRow({ until: null })).toEqual({ key: 'stockpile', kind: 'stockpile', until: null });
    });
});
