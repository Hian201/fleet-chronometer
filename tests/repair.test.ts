import { describe, expect, it, vi } from 'vitest';
import {
    MORALE_INTERVAL_MS,
    REPAIR_INTERVAL_MS,
    TIMER_SAFETY_MS,
    nextSettlementIn,
    planAnchorageRepair,
    planMoraleSupply,
    predictRepairHp,
} from '../utils/repair';
import { GameState, type FleetView, type ShipView } from '../utils/state';

const TS = 1_726_000_000_000;

function ship(overrides: Partial<ShipView> = {}): ShipView {
    return {
        name: '測試艦', nameJa: '測試艦', stype: '', lv: 99, hp: 100, maxhp: 100, cond: 49,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100,
        id: 1, mst: 1, stypeId: 1, ndockTime: 2_000_000, inDock: false, escaped: false,
        gears: [], exGear: null, exEmpty: false, slotCapacity: [],
        ...overrides,
    };
}

function fleet(ships: ShipView[], overrides: Partial<FleetView> = {}): FleetView {
    return { name: '第一艦隊', ships, mission: false, repairAnchor: TS, moraleAnchor: TS, ...overrides };
}

function portApi() {
    return {
        api_ship: [
            { api_id: 1, api_ship_id: 182, api_lv: 99, api_nowhp: 50, api_maxhp: 50, api_cond: 49, api_ndock_time: 0, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 10, api_bull: 10 },
            { api_id: 2, api_ship_id: 2, api_lv: 99, api_nowhp: 40, api_maxhp: 50, api_cond: 30, api_ndock_time: 600_000, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 10, api_bull: 10 },
        ],
        api_deck_port: [
            { api_ship: [1, 2, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
        ],
        api_ndock: [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }],
        api_material: [], api_basic: {}, api_count_kdock: 4, api_combined_flag: 0,
    };
}

describe('泊地修理預估', () => {
    it('沒有工作艦、未改造朝日不啟動；明石／明石改／朝日改皆依既有 master id 判定', () => {
        expect(planAnchorageRepair(fleet([ship()])).reason).toBe('no-repair-ship');
        expect(planAnchorageRepair(fleet([ship({ mst: 953 })])).reason).toBe('no-repair-ship');
        for (const mst of [182, 187]) {
            expect(planAnchorageRepair(fleet([ship({ mst })])).active).toBe(true);
        }
        expect(planAnchorageRepair(fleet([ship({ mst: 958, gears: [{ mst: 86 } as any] })])).active).toBe(true);
    });

    it('明石基本涵蓋 2、吊車加成；朝日改無吊車時 coverage 為 0', () => {
        const akashi = planAnchorageRepair(fleet([
            ship({ mst: 182, gears: [{ mst: 86 } as any, { mst: 86 } as any] }), ship(), ship(), ship(),
        ]));
        expect(akashi).toMatchObject({ active: true, coverage: 4, facilities: 2 });
        expect(planAnchorageRepair(fleet([ship({ mst: 958 }), ship()]))).toMatchObject({
            active: false, coverage: 0, reason: 'no-coverage',
        });
    });

    it('雙工作艦合併涵蓋，且第二位置帶吊車才加速', () => {
        const withoutSecondFacility = planAnchorageRepair(fleet([
            ship({ mst: 182, gears: [{ mst: 86 } as any] }), ship({ mst: 958 }), ship(), ship(),
        ]));
        expect(withoutSecondFacility).toMatchObject({ coverage: 3, accelerated: false });
        const accelerated = planAnchorageRepair(fleet([
            ship({ mst: 182, hp: 90, gears: [{ mst: 86 } as any] }),
            ship({ mst: 958, gears: [{ mst: 86 } as any, { mst: 86 } as any] }), ship(), ship(), ship(),
        ]));
        expect(accelerated).toMatchObject({ coverage: 5, facilities: 3, accelerated: true });
    });

    it('中破旗艦、入渠旗艦與遠征皆停用；範圍內跳過不遞補', () => {
        expect(planAnchorageRepair(fleet([ship({ mst: 182, hp: 50 })])).reason).toBe('flagship-chuha');
        expect(planAnchorageRepair(fleet([ship({ mst: 182, inDock: true })])).reason).toBe('flagship-dock');
        expect(planAnchorageRepair(fleet([ship({ mst: 182 })], { mission: true })).reason).toBe('on-mission');
        const plan = planAnchorageRepair(fleet([
            ship({ mst: 182, hp: 90, gears: [{ mst: 86 } as any, { mst: 86 } as any] }),
            ship({ hp: 50 }), ship({ inDock: true }), ship({ hp: 100 }), ship({ hp: 60 }),
        ]));
        expect(plan.coverage).toBe(4);
        expect(plan.slots).toEqual([
            expect.objectContaining({ index: 0, willRepair: true }),
            expect.objectContaining({ index: 1, skip: 'chuha' }),
            expect.objectContaining({ index: 2, skip: 'dock' }),
            expect.objectContaining({ index: 3, skip: 'full' }),
        ]);
        expect(plan.slots.find(slot => slot.index === 4)).toBeUndefined();
    });

    it('predictRepairHp 處理無資料、最低回復、上限與 accelerated 邊界', () => {
        const damaged = ship({ hp: 90, maxhp: 100, ndockTime: 2_000_000 });
        expect(predictRepairHp(damaged, undefined, false)).toBeUndefined();
        expect(predictRepairHp(damaged, REPAIR_INTERVAL_MS, false)).toBe(6);
        expect(predictRepairHp(damaged, REPAIR_INTERVAL_MS, true)).toBe(7);
        expect(predictRepairHp(ship({ hp: 99, maxhp: 100, ndockTime: 9_999_999 }), REPAIR_INTERVAL_MS, false)).toBe(1);
        expect(predictRepairHp(damaged, 99_999_999, false)).toBe(10);
        expect(predictRepairHp(ship({ hp: 100, maxhp: 100 }), REPAIR_INTERVAL_MS, false)).toBe(0);
    });
});

describe('野埼母港給糧預估', () => {
    it('野埼不在前兩位回 bad-position，野埼／野埼改的每 tick 增量正確', () => {
        expect(planMoraleSupply(fleet([ship(), ship(), ship({ mst: 996 })])).reason).toBe('bad-position');
        expect(planMoraleSupply(fleet([ship({ mst: 996 }), ship({ cond: 40 })]))).toMatchObject({ active: true, perTick: 2 });
        expect(planMoraleSupply(fleet([ship({ mst: 1002 }), ship({ cond: 40 })]))).toMatchObject({ active: true, perTick: 3 });
    });

    it('遠征、入渠、未補給、小破以上與低 cond 都不發動', () => {
        const source = ship({ mst: 996 });
        expect(planMoraleSupply(fleet([source], { mission: true })).reason).toBe('on-mission');
        expect(planMoraleSupply(fleet([ship({ mst: 996, inDock: true })])).reason).toBe('dock');
        expect(planMoraleSupply(fleet([ship({ mst: 996, fuel: 99 })])).reason).toBe('unsupplied');
        expect(planMoraleSupply(fleet([ship({ mst: 996, hp: 75 })])).reason).toBe('damaged');
        expect(planMoraleSupply(fleet([ship({ mst: 996, cond: 29 })])).reason).toBe('low-cond');
    });

    it('野埼自身、入渠艦與已達 cap 艦不回復也不耗燃料；多 tick 正確封頂', () => {
        const plan = planMoraleSupply(fleet([
            ship({ mst: 1002, cond: 40 }), ship({ cond: 30 }), ship({ cond: 53 }),
            ship({ cond: 40, inDock: true }), ship({ cond: 54 }),
        ]), 3 * MORALE_INTERVAL_MS + 1);
        expect(plan.fuelCost).toBe(2);
        expect(plan.slots).toEqual([
            expect.objectContaining({ skip: 'full' }),
            expect.objectContaining({ willRecover: true, predictedCond: 39 }),
            expect.objectContaining({ willRecover: true, predictedCond: 54 }),
            expect.objectContaining({ skip: 'dock' }),
            expect.objectContaining({ skip: 'capped' }),
        ]);
    });

    it('elapsedMs 不可考時維持一個 tick 的既有預估', () => {
        const plan = planMoraleSupply(fleet([ship({ mst: 996 }), ship({ cond: 40 })]));
        expect(plan.slots[1]).toMatchObject({ willRecover: true, predictedCond: 42 });
        expect(plan.fuelCost).toBe(1);
    });
});

describe('結算倒數與 GameState 錨點', () => {
    it('nextSettlementIn 處理 undefined、null、未來時間、安全緩衝與 ready；15／20 分互不相干', () => {
        expect(nextSettlementIn(undefined, REPAIR_INTERVAL_MS, TS)).toBeUndefined();
        expect(nextSettlementIn(null, REPAIR_INTERVAL_MS, TS)).toBeUndefined();
        expect(nextSettlementIn(TS + 1, REPAIR_INTERVAL_MS, TS)).toBeUndefined();
        expect(nextSettlementIn(TS, REPAIR_INTERVAL_MS, TS + 5 * 60_000))
            .toBe(15 * 60_000 + TIMER_SAFETY_MS);
        expect(nextSettlementIn(TS, REPAIR_INTERVAL_MS, TS + REPAIR_INTERVAL_MS)).toBe(0);
        expect(nextSettlementIn(TS, MORALE_INTERVAL_MS, TS + 16 * 60_000)).toBe(0);
        expect(nextSettlementIn(TS, REPAIR_INTERVAL_MS, TS + 16 * 60_000)).toBe(4 * 60_000 + TIMER_SAFETY_MS);
    });

    it('編成 change 以事件 ts 重設兩種錨點；-2 與 preset_select 不重設', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portApi(), {}, TS);
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '1', api_ship_id: '-1' }, TS + 10);
        expect(state.repairAnchorByDeck.get(0)).toBe(TS + 10);
        expect(state.moraleAnchorByDeck.get(0)).toBe(TS + 10);
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '1', api_ship_id: '-2' }, TS + 20);
        state.applyEvent('api_req_hensei/preset_select', state.decks[0], { api_deck_id: '1' }, TS + 30);
        expect(state.repairAnchorByDeck.get(0)).toBe(TS + 10);
        expect(state.moraleAnchorByDeck.get(0)).toBe(TS + 10);
    });

    it('出擊、聯合隨伴與遠征標成 away/null；回港用事件 ts 重啟且兩週期獨立', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portApi(), {}, TS);
        state.repairAnchorByDeck.set(0, TS);
        state.moraleAnchorByDeck.set(0, TS);
        state.combinedFlag = 2;
        state.applyEvent('api_req_map/start', { api_maparea_id: 6, api_mapinfo_no: 5, api_no: 1 }, { api_deck_id: '1' }, TS + 1);
        expect(state.repairAnchorByDeck.get(0)).toBeNull();
        expect(state.moraleAnchorByDeck.get(1)).toBeNull();
        state.applyEvent('api_req_mission/start', { api_complatetime: 0 }, { api_deck_id: '2', api_mission_id: '5' }, TS + 2);
        expect(state.repairAnchorByDeck.get(1)).toBeNull();
        state.repairAnchorByDeck.set(0, TS);
        state.moraleAnchorByDeck.set(0, TS);
        state.applyEvent('api_port/port', portApi(), {}, TS + 16 * 60_000);
        expect(state.repairAnchorByDeck.get(0)).toBe(TS);
        expect(state.moraleAnchorByDeck.get(0)).toBe(TS + 16 * 60_000);
        expect(state.repairAnchorByDeck.get(1)).toBe(TS + 16 * 60_000);
        expect(state.repairAnchorByDeck.get(9)).toBeUndefined();
    });

    it('入渠使用 event.ts；live 未傳 ts 維持 Date.now()；高速修復不建立倒數', () => {
        const historical = new GameState();
        historical.applyEvent('api_port/port', portApi(), {}, TS);
        historical.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '2', api_ndock_id: '1', api_highspeed: '0' }, TS + 123);
        expect(historical.ndockData[0].api_complete_time).toBe(TS + 123 + 600_000);

        vi.useFakeTimers();
        vi.setSystemTime(TS + 456);
        const live = new GameState();
        live.applyEvent('api_port/port', portApi());
        live.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '2', api_ndock_id: '1', api_highspeed: '0' });
        expect(live.ndockData[0].api_complete_time).toBe(TS + 456 + 600_000);
        live.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '2', api_ndock_id: '1', api_highspeed: '1' }, TS + 999);
        expect(live.ndockData[0].api_complete_time).toBe(TS + 456 + 600_000);
        expect(live.ships.get(2)?.api_nowhp).toBe(50);
        vi.useRealTimers();
    });
});
