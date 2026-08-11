// 渦潮燃彈扣減：比照 KC3Kai reduceFleetRscOnMaelstrom＋maelstromLoss 表。
import { describe, expect, it } from 'vitest';
import { lookupMaelstromLoss, RADAR_REDUCE_RATE } from '@/utils/maelstrom-data';
import {
    planMaelstromLosses,
    readMaelstromHappening,
    resolveMaelstromLossRate,
    type MaelstromShipSnap,
} from '@/utils/maelstrom';
import { GameState } from '@/utils/state';

function snap(partial: Partial<MaelstromShipSnap> & { id: number }): MaelstromShipSnap {
    return {
        fuel: 100, ammo: 100, hasRadar: false, escaped: false, ...partial,
    };
}

describe('readMaelstromHappening', () => {
    it('讀出 mst／count／dentan；形狀不對回 null', () => {
        expect(readMaelstromHappening({
            api_happening: { api_mst_id: 1, api_count: 40, api_dentan: 1 },
        })).toEqual({ mstId: 1, count: 40, dentan: true });
        expect(readMaelstromHappening({})).toBeNull();
        expect(readMaelstromHappening({ api_happening: { api_mst_id: 3, api_count: 10 } })).toBeNull();
    });
});

describe('lookupMaelstromLoss', () => {
    it('查表命中 1-3 edge 8；表外回 null', () => {
        expect(lookupMaelstromLoss(1, 3, 8)).toEqual([1, 20, 0.4, 1.5]);
        expect(lookupMaelstromLoss(1, 3, 99)).toBeNull();
        expect(lookupMaelstromLoss(99, 9, 1)).toBeNull();
    });
});

describe('resolveMaelstromLossRate', () => {
    const def = [1, 20, 0.4, 1.5] as const;
    it('一般渦潮：比例固定，電探減輕', () => {
        const flat = [1, 30, 0.3, 0.3] as const;
        expect(resolveMaelstromLossRate(flat, { mstId: 1, count: 30, dentan: false }, 100, 0))
            .toBeCloseTo(0.3);
        expect(resolveMaelstromLossRate(flat, { mstId: 1, count: 30, dentan: true }, 100, 2))
            .toBeCloseTo(0.3 * (1 - RADAR_REDUCE_RATE[2]));
    });
    it('強渦潮：依 api_count 反推高／低檔', () => {
        // maxRemaining=100 → low floor=40、high floor=150（但 capped by count）
        const high = resolveMaelstromLossRate(def, { mstId: 1, count: 60, dentan: false }, 100, 0);
        expect(high).toBeCloseTo(1.5);
        const low = resolveMaelstromLossRate(def, { mstId: 1, count: 20, dentan: false }, 100, 0);
        expect(low).toBeCloseTo(0.4);
    });
});

describe('planMaelstromLosses', () => {
    it('表外不扣', () => {
        const r = planMaelstromLosses(1, 3, 99,
            { mstId: 1, count: 40, dentan: false },
            [snap({ id: 1, fuel: 80 })]);
        expect(r.def).toBeNull();
        expect(r.losses.size).toBe(0);
    });
    it('逐艦扣燃、電探艦數影響比例、已退避略過', () => {
        // 2-4 edge 3：比例 0.3／0.3，上限 30
        const ships = [
            snap({ id: 1, fuel: 100, hasRadar: true }),
            snap({ id: 2, fuel: 50, hasRadar: false }),
            snap({ id: 3, fuel: 80, hasRadar: false, escaped: true }),
        ];
        const r = planMaelstromLosses(2, 4, 3,
            { mstId: 1, count: 30, dentan: true }, ships);
        expect(r.rsc).toBe('fuel');
        expect(r.def).not.toBeNull();
        // 1 艘電探 → ×(1-0.25)=0.75 → rate 0.225
        expect(r.lossRate).toBeCloseTo(0.3 * 0.75);
        expect(r.losses.get(1)).toBe(Math.min(30, Math.floor(100 * r.lossRate)));
        expect(r.losses.get(2)).toBe(Math.min(30, Math.floor(50 * r.lossRate)));
        expect(r.losses.has(3)).toBe(false);
    });
    it('彈藥渦潮（mst_id=2）寫 ammo', () => {
        const r = planMaelstromLosses(4, 3, 5,
            { mstId: 2, count: 60, dentan: false },
            [snap({ id: 1, ammo: 100 })]);
        expect(r.rsc).toBe('ammo');
        expect(r.losses.get(1)).toBeGreaterThan(0);
    });
});

describe('GameState 套用渦潮', () => {
    it('map/next 出現 happening 時寫回燃彈', () => {
        const state = new GameState();
        state.masterGears.set(1, {
            name: '電探', cat: 12, icon: 11, aa: 0, los: 0, distance: 0, sortNo: 1,
            stats: { houg: 0, raig: 0, tyku: 0, souk: 0, houm: 0, houk: 0,
                baku: 0, saku: 0, tais: 0, leng: 0, luck: 0 },
        });
        state.slotItems.set(10, { mst: 1, level: 0, alv: 0 });
        state.ships.set(1, {
            api_id: 1, api_ship_id: 1, api_slot: [10], api_fuel: 100, api_bull: 100,
            api_nowhp: 30, api_maxhp: 30, api_lv: 1, api_cond: 49, api_onslot: [0],
        });
        state.decks = [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }] as any;
        state.applyEvent('api_req_map/start', {
            api_maparea_id: 2, api_mapinfo_no: 4, api_no: 3,
            api_happening: { api_mst_id: 1, api_count: 30, api_dentan: 1 },
            api_event_id: 1, api_event_kind: 0, api_color_no: 1,
        }, { api_deck_id: '1' });
        const fuel = Number(state.ships.get(1)!.api_fuel);
        expect(fuel).toBeLessThan(100);
        expect(fuel).toBeGreaterThanOrEqual(70); // 約 22% 損失
    });
    it('表外 happening 不扣', () => {
        const state = new GameState();
        state.ships.set(1, {
            api_id: 1, api_ship_id: 1, api_slot: [-1], api_fuel: 100, api_bull: 100,
            api_nowhp: 30, api_maxhp: 30, api_lv: 1, api_cond: 49, api_onslot: [0],
        });
        state.decks = [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }] as any;
        state.applyEvent('api_req_map/start', {
            api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1,
            api_happening: { api_mst_id: 1, api_count: 30, api_dentan: 0 },
            api_event_id: 1, api_event_kind: 0, api_color_no: 1,
        }, { api_deck_id: '1' });
        expect(state.ships.get(1)!.api_fuel).toBe(100);
        expect(state.wantedTag('api_req_map/start', {
            api_no: 1,
            api_happening: { api_mst_id: 1, api_count: 30, api_dentan: 0 },
        })).toMatch(/渦潮|Maelstrom|表外/);
    });
});
