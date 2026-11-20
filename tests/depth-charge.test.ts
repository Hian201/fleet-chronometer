import { describe, expect, it } from 'vitest';
import { DEPTH_CHARGE_MST, depthChargeSeasonActive, fleetDepthCharges, parseDcReminderOff } from '../utils/depth-charge';
import type { GearView, ShipView } from '../utils/state';
import start2 from '../samples/start2-master.json';

const gear = (mst: number, name = `g${mst}`) => ({ mst, name }) as GearView;
const ship = (gears: (GearView | null)[], exGear: GearView | null = null) => ({ gears, exGear }) as ShipView;

describe('fleetDepthCharges', () => {
    it('一般槽與補強增設都檢查，依 master id 判定', () => {
        const hits = fleetDepthCharges([
            ship([gear(1), gear(226, '九五式爆雷'), null]),
            ship([gear(46, '九三式水中聴音機')]),
            ship([gear(1)], gear(488, '二式爆雷改二')),
        ]);
        expect(hits).toEqual([{ index: 0, gears: ['九五式爆雷'] }, { index: 2, gears: ['二式爆雷改二'] }]);
    });

    it('沒有爆雷時回空陣列', () => {
        expect(fleetDepthCharges([ship([gear(46), null])])).toEqual([]);
    });

    it('清單涵蓋 master 中分類 15 的全部玩家裝備', () => {
        const data = (start2 as { api_data?: unknown }).api_data ?? start2;
        const items = (data as { api_mst_slotitem: { api_id: number; api_type: number[] }[] }).api_mst_slotitem;
        // 1500 以上是深海側裝備，不列入。
        const ids = items.filter(g => g.api_type[2] === 15 && g.api_id < 1500).map(g => g.api_id).sort((a, b) => a - b);
        expect([...DEPTH_CHARGE_MST].sort((a, b) => a - b)).toEqual(ids);
    });
});

describe('depthChargeSeasonActive', () => {
    const H = 3_600_000;
    const start = 1_800_000_000_000;
    const base = { start, end: null, held: 0, lastCatchTs: null };
    it('起點前不顯示；起點後 72 小時內即使還沒魚也顯示', () => {
        expect(depthChargeSeasonActive({ ...base, now: start - 1 })).toBe(false);
        expect(depthChargeSeasonActive({ ...base, now: start + 71 * H })).toBe(true);
        expect(depthChargeSeasonActive({ ...base, now: start + 73 * H })).toBe(false);
    });
    it('之後靠持有或 72 小時內的捕獲維持；兩者都沒有就自動消失', () => {
        const now = start + 10 * 24 * H;
        expect(depthChargeSeasonActive({ ...base, now, held: 5 })).toBe(true);
        expect(depthChargeSeasonActive({ ...base, now, held: null, lastCatchTs: now - 10 * H })).toBe(true);
        expect(depthChargeSeasonActive({ ...base, now, held: null, lastCatchTs: now - 80 * H })).toBe(false);
    });
    it('過了公布的結束時刻就不顯示', () => {
        expect(depthChargeSeasonActive({ ...base, now: start + 5 * H, end: start + 4 * H, held: 3 })).toBe(false);
    });
});

describe('parseDcReminderOff', () => {
    it('只認本季的關閉紀錄；季節換了就回到打開', () => {
        expect(parseDcReminderOff({ season: 100, from: 'panel' }, 100)).toEqual({ season: 100, from: 'panel' });
        expect(parseDcReminderOff({ season: 99, from: 'panel' }, 100)).toBeNull();
        expect(parseDcReminderOff({ season: 100, from: 'x' }, 100)).toBeNull();
        expect(parseDcReminderOff(null, 100)).toBeNull();
    });
});
