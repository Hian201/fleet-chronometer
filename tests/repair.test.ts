import { describe, expect, it, vi } from 'vitest';
import {
    MORALE_INTERVAL_MS,
    REPAIR_INTERVAL_MS,
    TIMER_SAFETY_MS,
    nextSettlementIn,
    planAnchorageRepair,
    planMoraleSupply,
    predictRepairHp,
    repairProgress,
} from '../utils/repair';
import { GameState, type FleetView, type ShipView } from '../utils/state';

const TS = 1_726_000_000_000;

function ship(overrides: Partial<ShipView> = {}): ShipView {
    return {
        name: '測試艦', nameJa: '測試艦', stype: '', lv: 99, hp: 100, maxhp: 100, cond: 49,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100,
        id: 1, mst: 1, stypeId: 1, ndockTime: 2_000_000, inDock: false, dockCompleteAt: null, escaped: false,
        firepower: 0, luck: 0,
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

describe('泊地修理累積狀態', () => {
    const start = TS + TIMER_SAFETY_MS;
    // 損傷 10HP、入渠 100 分 → 每 HP 10 分；明石自身滿血。
    const repairFleet = () => fleet([ship({ mst: 182 }), ship({ hp: 90, ndockTime: 6_000_000 })]);

    it('未滿 20 分（含緩衝）只倒數，滿了再轉可結算', () => {
        expect(repairProgress(repairFleet(), TS, start + REPAIR_INTERVAL_MS - 1)).toMatchObject({ ready: false, refreshAt: start + REPAIR_INTERVAL_MS });
        expect(repairProgress(repairFleet(), null, start + REPAIR_INTERVAL_MS)).toBeUndefined();
        expect(repairProgress(repairFleet(), undefined, start + REPAIR_INTERVAL_MS)).toBeUndefined();
    });

    it('滿 20 分後回復量依經過時間持續累積到修滿，不停在第一次結算', () => {
        expect(repairProgress(repairFleet(), TS, start + REPAIR_INTERVAL_MS)).toMatchObject({
            ready: true, gain: 2, full: false, fullAt: start + 100 * 60_000, refreshAt: start + 30 * 60_000,
        });
        expect(repairProgress(repairFleet(), TS, start + 55 * 60_000)).toMatchObject({ gain: 5, full: false, refreshAt: start + 60 * 60_000 });
        expect(repairProgress(repairFleet(), TS, start + 100 * 60_000)).toMatchObject({ gain: 10, full: true, fullAt: null, refreshAt: null });
        expect(repairProgress(repairFleet(), TS, start + 300 * 60_000)).toMatchObject({ gain: 10, full: true });
    });

    it('回復以整分鐘判定：每 HP 10.5 分時，第 2 HP 要到 21 分整', () => {
        const f = fleet([ship({ mst: 182 }), ship({ hp: 90, ndockTime: 6_300_000 })]);
        expect(repairProgress(f, TS, start + 21 * 60_000 - 1)).toMatchObject({ gain: 1, refreshAt: start + 21 * 60_000 });
        expect(repairProgress(f, TS, start + 21 * 60_000)).toMatchObject({ gain: 2, fullAt: start + 105 * 60_000 });
    });

    it('範圍內有艦缺入渠時間時回復量不可推算', () => {
        const f = fleet([ship({ mst: 182 }), ship({ hp: 90, ndockTime: 0 })]);
        expect(repairProgress(f, TS, start + REPAIR_INTERVAL_MS)).toMatchObject({ ready: true, gain: null, full: false });
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
        const plan = planMoraleSupply(fleet([ship({ mst: 996 }), ship({ cond: 49 }), ship({ cond: 40 })]));
        expect(plan.slots[1]).toMatchObject({ willRecover: true, predictedCond: 51 });
        // 未改野埼：未滿 49 的艦本次不回復，仍列為給糧對象。
        expect(plan.slots[2]).toMatchObject({ willRecover: true, predictedCond: 40 });
    });
});

describe('結算倒數與 GameState 錨點', () => {
    it('nextSettlementIn 處理 undefined、null、未來時間、安全緩衝與 ready；15／20 分互不相干', () => {
        expect(nextSettlementIn(undefined, REPAIR_INTERVAL_MS, TS)).toBeUndefined();
        expect(nextSettlementIn(null, REPAIR_INTERVAL_MS, TS)).toBeUndefined();
        expect(nextSettlementIn(TS + 1, REPAIR_INTERVAL_MS, TS)).toBeUndefined();
        expect(nextSettlementIn(TS, REPAIR_INTERVAL_MS, TS + 5 * 60_000))
            .toBe(15 * 60_000 + TIMER_SAFETY_MS);
        expect(nextSettlementIn(TS, REPAIR_INTERVAL_MS, TS + REPAIR_INTERVAL_MS)).toBe(TIMER_SAFETY_MS);
        expect(nextSettlementIn(TS, REPAIR_INTERVAL_MS, TS + REPAIR_INTERVAL_MS + TIMER_SAFETY_MS)).toBe(0);
        expect(nextSettlementIn(TS, MORALE_INTERVAL_MS, TS + 16 * 60_000)).toBe(0);
        expect(nextSettlementIn(TS, REPAIR_INTERVAL_MS, TS + 16 * 60_000)).toBe(4 * 60_000 + TIMER_SAFETY_MS);
    });

    it('旗艦是工作艦的艦隊變更編成才重置全域修理計時；-2 與 preset_select 不重置；1、2 號位沒有野埼不動給糧計時', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portApi(), {}, TS);
        expect(state.repairAnchor).toBeUndefined();
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '1', api_ship_id: '-1' }, TS + 10);
        expect(state.repairAnchor).toBe(TS + 10);
        expect(state.moraleAnchor).toBeUndefined();
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '1', api_ship_id: '-2' }, TS + 20);
        state.applyEvent('api_req_hensei/preset_select', state.decks[0], { api_deck_id: '1' }, TS + 30);
        expect(state.repairAnchor).toBe(TS + 10);
        // 第 2 艦隊旗艦不是工作艦：變更不影響。
        state.applyEvent('api_req_hensei/change', {}, { api_id: '2', api_ship_idx: '0', api_ship_id: '2' }, TS + 40);
        expect(state.repairAnchor).toBe(TS + 10);
        // 共用一個計時器：各隊的 repairAnchor 都是同一個值。
        expect(state.fleets().map(f => f.repairAnchor)).toEqual([TS + 10, TS + 10]);
    });

    it('明石與 2 號艦互換而離開旗艦不重置；從工作艦旗艦的艦隊換走隨伴也重置', () => {
        const api = portApi();
        api.api_ship.push({ ...api.api_ship[1], api_id: 3 });
        api.api_deck_port[1].api_ship = [3, -1, -1, -1, -1, -1];
        const state = new GameState();
        state.applyEvent('api_port/port', api, {}, TS);
        state.repairAnchor = TS;
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '1', api_ship_id: '1' }, TS + 60_000);
        expect(state.decks[0].api_ship.slice(0, 2)).toEqual([2, 1]);
        expect(state.repairAnchor).toBe(TS);
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '1', api_ship_id: '2' }, TS + 2 * 60_000);
        expect(state.repairAnchor).toBe(TS + 2 * 60_000);
        // 第 2 艦隊把第 1 艦隊（明石旗艦）的隨伴換過去：第 1 艦隊被改動，重置。
        state.applyEvent('api_req_hensei/change', {}, { api_id: '2', api_ship_idx: '0', api_ship_id: '2' }, TS + 3 * 60_000);
        expect(state.repairAnchor).toBe(TS + 3 * 60_000);
    });

    it('出擊不影響修理計時；工作艦所在的艦隊出發遠征重置；20 分內進港不重置、滿 20 分重置', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portApi(), {}, TS);
        state.repairAnchor = TS;
        state.combinedFlag = 2;
        state.applyEvent('api_req_map/start', { api_maparea_id: 6, api_mapinfo_no: 5, api_no: 1 }, { api_deck_id: '1' }, TS + 1);
        expect(state.repairAnchor).toBe(TS);
        expect(state.fleets()[0].repairAnchor).toBe(TS);
        expect(state.fleets()[1].moraleAnchor).toBeNull();   // 出擊中不在母港，給糧不結算
        // 工作艦不在的艦隊出發遠征：不重置。
        state.applyEvent('api_req_mission/start', { api_complatetime: 0 }, { api_deck_id: '2', api_mission_id: '5' }, TS + 2);
        expect(state.repairAnchor).toBe(TS);
        expect(state.fleets()[1].repairAnchor).toBeNull();
        state.applyEvent('api_port/port', portApi(), {}, TS + 10 * 60_000);
        expect(state.repairAnchor).toBe(TS);
        state.moraleAnchor = TS;
        state.applyEvent('api_port/port', portApi(), {}, TS + 21 * 60_000);
        expect(state.repairAnchor).toBe(TS + 21 * 60_000);
        expect(state.moraleAnchor).toBe(TS + 21 * 60_000);
        // 明石所在的第 1 艦隊出發遠征：重置。
        state.applyEvent('api_req_mission/start', { api_complatetime: 0 }, { api_deck_id: '1', api_mission_id: '2' }, TS + 25 * 60_000);
        expect(state.repairAnchor).toBe(TS + 25 * 60_000);
    });

    it('錨點不可考時，兩次進港相隔 ≥20 分或範圍內 HP 回升即確定；推算未滿 20 分但 HP 回升時校正', () => {
        const healed = (hp: number) => {
            const api = portApi();
            api.api_ship[1].api_nowhp = hp;
            return api;
        };
        const state = new GameState();
        state.applyEvent('api_port/port', healed(40), {}, TS);
        state.applyEvent('api_port/port', healed(40), {}, TS + 19 * 60_000);
        expect(state.repairAnchor).toBeUndefined();
        state.applyEvent('api_port/port', healed(41), {}, TS + 25 * 60_000);
        expect(state.repairAnchor).toBe(TS + 25 * 60_000);
        state.applyEvent('api_port/port', healed(43), {}, TS + 30 * 60_000);
        expect(state.repairAnchor).toBe(TS + 30 * 60_000);
        const late = new GameState();
        late.applyEvent('api_port/port', healed(40), {}, TS);
        late.applyEvent('api_port/port', healed(40), {}, TS + 20 * 60_000);
        expect(late.repairAnchor).toBe(TS + 20 * 60_000);
    });

    it('入渠使用 event.ts；live 未傳 ts 維持 Date.now()；高速修復不建立倒數', () => {
        const historical = new GameState();
        historical.applyEvent('api_port/port', portApi(), {}, TS);
        historical.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '2', api_ndock_id: '1', api_highspeed: '0' }, TS + 123);
        expect(historical.ndockData[0].api_complete_time).toBe(TS + 123 + 600_000);
        expect(historical.fleets()[0].ships.find(s => s.id === 2))
            .toMatchObject({ inDock: true, dockCompleteAt: TS + 123 + 600_000 });
        expect(historical.fleets()[0].ships.find(s => s.id === 1))
            .toMatchObject({ inDock: false, dockCompleteAt: null });

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

describe('全域給糧計時器（wikiwiki「野埼」＋NGA 野埼研究）', () => {
    const MIN = 60_000;
    function nosakiPort() {
        const api = portApi();
        api.api_ship.push(
            { api_id: 3, api_ship_id: 1002, api_lv: 60, api_nowhp: 20, api_maxhp: 20, api_cond: 49, api_ndock_time: 0, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 10, api_bull: 10 },
            { api_id: 4, api_ship_id: 2, api_lv: 1, api_nowhp: 10, api_maxhp: 10, api_cond: 49, api_ndock_time: 0, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 10, api_bull: 10 },
        );
        api.api_deck_port[1].api_ship = [4, -1, -1, -1, -1, -1];
        return api;
    }

    it('錨點不可考時，兩次進港相隔 ≥15 分即在後一次確定；未滿不推進', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portApi(), {}, TS);
        state.applyEvent('api_port/port', portApi(), {}, TS + 10 * MIN);
        expect(state.moraleAnchor).toBeUndefined();
        state.applyEvent('api_port/port', portApi(), {}, TS + 26 * MIN);
        expect(state.moraleAnchor).toBe(TS + 26 * MIN);
        state.applyEvent('api_port/port', portApi(), {}, TS + 40 * MIN);
        expect(state.moraleAnchor).toBe(TS + 26 * MIN);
    });

    it('1、2 號位放入野埼重置全帳號計時；從 3 號位以後放入、解體使其遞補都不重置；出擊不影響', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', nosakiPort(), {}, TS);
        state.moraleAnchor = TS;
        // 第 1 艦隊 3 號位放入野埼改：不重置。
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '2', api_ship_id: '3' }, TS + MIN);
        expect(state.moraleAnchor).toBe(TS);
        // 解體 2 號位，野埼改遞補到 2 號位：給糧與修理計時都不重置（５－４水上編成研究室：解体で旗艦が変わってもリセットなし）。
        state.repairAnchor = TS;
        state.applyEvent('api_req_kousyou/destroyship', {}, { api_ship_id: '2', api_slot_dest_flag: '0' }, TS + 2 * MIN);
        expect(state.moraleAnchor).toBe(TS);
        expect(state.repairAnchor).toBe(TS);
        // 第 2 艦隊加入一艘後，1、2 號位有野埼改的第 1 艦隊沒動：不重置。
        // 出擊不影響全域計時。
        state.applyEvent('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1 }, { api_deck_id: '2' }, TS + 3 * MIN);
        expect(state.moraleAnchor).toBe(TS);
        // 第 1 艦隊（1、2 號位有野埼）任意換位：重置，而且是全帳號共用的那一個。
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '0', api_ship_id: '3' }, TS + 4 * MIN);
        expect(state.moraleAnchor).toBe(TS + 4 * MIN);
        expect(state.fleets()[0].moraleAnchor).toBe(TS + 4 * MIN);
        expect(state.fleets()[1].moraleAnchor).toBeNull();   // 出擊中的隊不在母港
    });

    it('只因士氣條件落空時計時器保留並暫停，條件滿足的那次進港只結算 1 次並重置', () => {
        const port = (nosakiCond: number) => {
            const api = nosakiPort();
            api.api_ship.find(ship => ship.api_id === 3)!.api_cond = nosakiCond;
            api.api_deck_port[1].api_ship = [3, 4, -1, -1, -1, -1];
            return api;
        };
        const state = new GameState();
        state.applyEvent('api_port/port', port(49), {}, TS);
        state.moraleAnchor = TS;
        state.applyEvent('api_port/port', port(20), {}, TS + 16 * MIN);
        expect(state).toMatchObject({ moraleAnchor: TS, moraleHeld: true });
        expect(state.fleets()[1].moraleHeld).toBe(true);
        state.applyEvent('api_port/port', port(35), {}, TS + 40 * MIN);
        expect(state).toMatchObject({ moraleAnchor: TS + 40 * MIN, moraleHeld: false });
    });

    it('未改野埼的給糧對象都未滿 49 也算士氣條件落空；損傷等其他條件落空照常重置', () => {
        const port = (mst: number, targetCond: number, nosakiHp = 20) => {
            const api = nosakiPort();
            const nosaki = api.api_ship.find(ship => ship.api_id === 3)!;
            nosaki.api_ship_id = mst;
            nosaki.api_nowhp = nosakiHp;
            api.api_ship.find(ship => ship.api_id === 4)!.api_cond = targetCond;
            api.api_deck_port[1].api_ship = [3, 4, -1, -1, -1, -1];
            return api;
        };
        const held = new GameState();
        held.applyEvent('api_port/port', port(996, 40), {}, TS);
        held.moraleAnchor = TS;
        held.applyEvent('api_port/port', port(996, 40), {}, TS + 16 * MIN);
        expect(held.moraleHeld).toBe(true);
        const kai = new GameState();
        kai.applyEvent('api_port/port', port(1002, 40), {}, TS);
        kai.moraleAnchor = TS;
        kai.applyEvent('api_port/port', port(1002, 43), {}, TS + 16 * MIN);
        expect(kai).toMatchObject({ moraleAnchor: TS + 16 * MIN, moraleHeld: false });
        const empty = new GameState();
        empty.applyEvent('api_port/port', port(996, 40, 10), {}, TS);
        empty.moraleAnchor = TS;
        empty.applyEvent('api_port/port', port(996, 40, 10), {}, TS + 16 * MIN);
        expect(empty).toMatchObject({ moraleAnchor: TS + 16 * MIN, moraleHeld: false });
    });

    it('未改野埼的給糧門檻為 49、野埼改不限', () => {
        expect(planMoraleSupply(fleet([ship({ mst: 996 }), ship({ cond: 40 })])).targetMinCond).toBe(49);
        expect(planMoraleSupply(fleet([ship({ mst: 1002 }), ship({ cond: 40 })])).targetMinCond).toBe(0);
    });
});
