import { describe, expect, it } from 'vitest';
import {
    COND_STEP_MS,
    condTier,
    fleetCondRecoveryEta,
    naturalRecoveryAt,
    projectNaturalCond,
    projectShipCond,
    shipRecoveryAt,
} from '../utils/cond';
import { MORALE_INTERVAL_MS, TIMER_SAFETY_MS } from '../utils/repair';
import { GameState, type FleetView, type ShipView } from '../utils/state';

const MIN = 60_000;
// 對齊 3 分鐘邊界後再加 30 秒，模擬「12:00:30 進母港」。
const BOUNDARY = Math.floor(1_726_000_000_000 / COND_STEP_MS) * COND_STEP_MS;
const AS_OF = BOUNDARY + 30_000;
const NOSAKI_KAI = 1002;
const NOSAKI = 996;

function ship(overrides: Partial<ShipView> = {}): ShipView {
    return {
        name: '測試艦', nameJa: '測試艦', stype: '', lv: 99, hp: 100, maxhp: 100, cond: 49,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100,
        id: 1, mst: 1, stypeId: 1, ndockTime: 0, inDock: false, dockCompleteAt: null, escaped: false,
        firepower: 0, luck: 0,
        gears: [], exGear: null, exEmpty: false, slotCapacity: [],
        ...overrides,
    };
}

function fleet(ships: ShipView[], overrides: Partial<FleetView> = {}): FleetView {
    return { name: '第一艦隊', ships, mission: false, repairAnchor: AS_OF, moraleAnchor: AS_OF, condAsOf: AS_OF, ...overrides };
}

describe('condTier', () => {
    it('對照遊戲疲勞度分級，由紅到黃', () => {
        expect([0, 19, 20, 29, 30, 39, 40, 49, 50, 85].map(condTier)).toEqual([
            'heavy', 'heavy', 'tired', 'tired', 'mild', 'mild', 'normal', 'normal', 'sparkle', 'sparkle',
        ]);
    });
});

describe('自然回復', () => {
    it('每個伺服器 3 分鐘邊界 +3，上限 49', () => {
        expect(projectNaturalCond(40, AS_OF, BOUNDARY + 3 * MIN - 1)).toBe(40);
        expect(projectNaturalCond(40, AS_OF, BOUNDARY + 3 * MIN)).toBe(43);
        expect(projectNaturalCond(40, AS_OF, BOUNDARY + 60 * MIN)).toBe(49);
        expect(projectNaturalCond(52, AS_OF, BOUNDARY + 60 * MIN)).toBe(52);
    });

    it('到 49 的時刻落在第 ceil((49-cond)/3) 個邊界', () => {
        expect(naturalRecoveryAt(19, AS_OF)).toBe(BOUNDARY + 30 * MIN);   // 赤疲勞消失後約 30 分
        expect(naturalRecoveryAt(46, AS_OF)).toBe(BOUNDARY + 3 * MIN);
        expect(naturalRecoveryAt(47, AS_OF)).toBe(BOUNDARY + 3 * MIN);
        expect(naturalRecoveryAt(49, AS_OF)).toBeNull();
    });
});

describe('入渠完成補到 40', () => {
    it('自然結束：完成當下補到 40，之後從完成時刻接續每 3 分 +3', () => {
        // 完成於 12:05:30；12:03 自然回復一次（10→13），完成時補到 40，12:06／09／12 各 +3。
        const docked = ship({ cond: 10, inDock: true, dockCompleteAt: BOUNDARY + 5 * MIN + 30_000 });
        expect(projectShipCond(docked, AS_OF, BOUNDARY + 5 * MIN)).toBe(13);
        expect(projectShipCond(docked, AS_OF, BOUNDARY + 5 * MIN + 30_000)).toBe(40);
        expect(projectShipCond(docked, AS_OF, BOUNDARY + 6 * MIN)).toBe(43);
        expect(shipRecoveryAt(docked, AS_OF)).toBe(BOUNDARY + 12 * MIN);
        expect(naturalRecoveryAt(10, AS_OF)).toBe(BOUNDARY + 39 * MIN);
    });

    it('入渠時直接用高速修復材：以請求時刻補到 40', () => {
        const bucketed = ship({ cond: 10, condFloorAt: AS_OF + MIN });
        expect(shipRecoveryAt(bucketed, AS_OF)).toBe(BOUNDARY + 9 * MIN);
        const eta = fleetCondRecoveryEta(fleet([bucketed, ship({ cond: 46 })]));
        expect(eta).toEqual({ at: BOUNDARY + 9 * MIN, naturalAt: BOUNDARY + 9 * MIN, below: 2, supplyHelps: false });
    });

    it('只把未滿 40 補到 40；40 以上（含キラ）維持原值，不會被拉回 40', () => {
        const sparkle = ship({ cond: 60, condFloorAt: AS_OF + MIN });
        expect(projectShipCond(sparkle, AS_OF, AS_OF + 30 * MIN)).toBe(60);
        expect(shipRecoveryAt(sparkle, AS_OF)).toBeNull();
        expect(projectShipCond(ship({ cond: 53, inDock: true, dockCompleteAt: AS_OF + MIN }), AS_OF, AS_OF + 2 * MIN)).toBe(53);
        // 45 用水桶：不降到 40，照自然回復在 12:03／12:06 到 48／49。
        const normal = ship({ cond: 45, condFloorAt: AS_OF + MIN });
        expect(projectShipCond(normal, AS_OF, AS_OF + MIN)).toBe(45);
        expect(shipRecoveryAt(normal, AS_OF)).toBe(BOUNDARY + 6 * MIN);
    });

    it('完成時已 ≥40、完成時刻晚於自然回復，或早於觀測時刻，都不改變結果', () => {
        expect(shipRecoveryAt(ship({ cond: 45, inDock: true, dockCompleteAt: AS_OF + MIN }), AS_OF)).toBe(BOUNDARY + 6 * MIN);
        expect(shipRecoveryAt(ship({ cond: 43, inDock: true, dockCompleteAt: AS_OF + 60 * MIN }), AS_OF)).toBe(BOUNDARY + 6 * MIN);
        expect(shipRecoveryAt(ship({ cond: 10, condFloorAt: AS_OF - MIN }), AS_OF)).toBe(BOUNDARY + 39 * MIN);
    });
});

describe('fleetCondRecoveryEta', () => {
    it('全隊取最慢的一艘；全員 ≥49 時 at 為 null', () => {
        const eta = fleetCondRecoveryEta(fleet([ship({ cond: 40 }), ship({ cond: 25 }), ship({ cond: 60 })]));
        expect(eta).toEqual({ at: BOUNDARY + 24 * MIN, naturalAt: BOUNDARY + 24 * MIN, below: 2, supplyHelps: false });
        expect(fleetCondRecoveryEta(fleet([ship({ cond: 49 }), ship({ cond: 53 })]))?.at).toBeNull();
    });

    it('出門中、遠征中或 cond 觀測時刻不可考時不推算', () => {
        const ships = [ship({ cond: 30 })];
        expect(fleetCondRecoveryEta(fleet(ships, { moraleAnchor: null }))).toBeUndefined();
        expect(fleetCondRecoveryEta(fleet(ships, { mission: true }))).toBeUndefined();
        expect(fleetCondRecoveryEta(fleet(ships, { condAsOf: undefined }))).toBeUndefined();
    });

    it('野埼改給糧在自然回復之後套用，讓到 49 的時刻提前', () => {
        // 計時器在進母港前 14 分起算：給糧門檻＝起算 +15 分 +1 分安全緩衝＝AS_OF 後 2 分。
        const anchor = AS_OF - 14 * MIN;
        const eta = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 47 })],
            { moraleAnchor: anchor },
        ));
        expect(anchor + MORALE_INTERVAL_MS + TIMER_SAFETY_MS).toBe(AS_OF + 2 * MIN);
        expect(eta).toEqual({ at: AS_OF + 2 * MIN, naturalAt: BOUNDARY + 3 * MIN, below: 1, supplyHelps: true });
    });

    it('給糧門檻與自然回復邊界交錯時，取兩者合計首次達 49 的時刻', () => {
        const anchor = AS_OF - 14 * MIN;
        // 43：門檻（AS_OF+2 分）時 43+3=46 未達；下一個邊界自然 +3 → 46，加給糧 +3 → 49。
        const eta = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 43 })],
            { moraleAnchor: anchor },
        ));
        expect(eta?.at).toBe(BOUNDARY + 3 * MIN);
        expect(eta?.naturalAt).toBe(BOUNDARY + 6 * MIN);
    });

    it('野埼自身不受給糧；野埼（未改）每次 +2', () => {
        const anchor = AS_OF - 14 * MIN;
        const eta = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI, cond: 46 }), ship({ cond: 47 })],
            { moraleAnchor: anchor },
        ));
        // 47+2=49 在門檻即達；野埼自己 46 只能等自然回復的第一個邊界。
        expect(eta?.at).toBe(BOUNDARY + 3 * MIN);
        expect(eta?.supplyHelps).toBe(false);
    });

    it('野埼要在自然回復後 cond ≥30 才發動', () => {
        const anchor = AS_OF - 14 * MIN;
        const eta = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 21 }), ship({ cond: 43 })],
            { moraleAnchor: anchor },
        ));
        // 隨伴 43 在門檻與首個邊界時野埼仍是 21／24，給糧不發動。
        expect(eta?.at).toBe(BOUNDARY + 30 * MIN);   // 全隊受野埼自身 21→49 拖住
        const escort = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 43, inDock: true, dockCompleteAt: AS_OF + 60 * MIN })],
            { moraleAnchor: anchor },
        ));
        expect(escort?.at).toBe(BOUNDARY + 6 * MIN);   // 入渠中的艦不受給糧
    });
});

describe('GameState 高速修復入渠', () => {
    it('記下請求時刻，回母港後清空', () => {
        const state = new GameState();
        const port = {
            api_ship: [{ api_id: 1, api_ship_id: 2, api_lv: 1, api_nowhp: 5, api_maxhp: 10, api_cond: 12, api_ndock_time: 600_000, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 }],
            api_deck_port: [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }],
        };
        state.applyEvent('api_port/port', port, undefined, AS_OF);
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '1', api_ndock_id: '1', api_highspeed: '1' }, AS_OF + MIN);
        const docked = state.fleets()[0]!.ships[0]!;
        expect(docked.condFloorAt).toBe(AS_OF + MIN);
        expect(docked.hp).toBe(10);
        // 面板當下就顯示補到 40，推算仍從母港的 12 起算。
        expect(docked.cond).toBe(40);
        expect(docked.condAtPort).toBe(12);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(BOUNDARY + 9 * MIN);
        state.applyEvent('api_port/port', port, undefined, AS_OF + 2 * MIN);
        expect(state.fleets()[0]!.ships[0]!.condFloorAt).toBeNull();
        expect(state.fleets()[0]!.ships[0]!.condAtPort).toBeUndefined();
    });

    it('cond 已滿 40 不動；同一次母港內再用桶保留第一次的原值', () => {
        const state = new GameState();
        const port = {
            api_ship: [
                { api_id: 1, api_ship_id: 2, api_lv: 1, api_nowhp: 5, api_maxhp: 10, api_cond: 45, api_ndock_time: 600_000, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 },
                { api_id: 2, api_ship_id: 2, api_lv: 1, api_nowhp: 5, api_maxhp: 10, api_cond: 12, api_ndock_time: 600_000, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 },
            ],
            api_deck_port: [{ api_ship: [1, 2, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }],
        };
        state.applyEvent('api_port/port', port, undefined, AS_OF);
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '1', api_ndock_id: '1', api_highspeed: '1' }, AS_OF + MIN);
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '2', api_ndock_id: '1', api_highspeed: '1' }, AS_OF + MIN);
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '2', api_ndock_id: '1', api_highspeed: '1' }, AS_OF + 2 * MIN);
        const [high, low] = state.fleets()[0]!.ships;
        expect(high!.cond).toBe(45);
        expect(low!.cond).toBe(40);
        expect(low!.condAtPort).toBe(12);
        expect(low!.condFloorAt).toBe(AS_OF + MIN);
    });

    it('入渠途中用高速修復材：以請求時刻補到 40，並清空該槽', () => {
        const state = new GameState();
        const port = {
            api_ship: [{ api_id: 1, api_ship_id: 2, api_lv: 1, api_nowhp: 5, api_maxhp: 10, api_cond: 10, api_ndock_time: 60 * MIN, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 }],
            api_deck_port: [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [
                { api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 },
                { api_id: 2, api_state: 0, api_ship_id: 0, api_complete_time: 0 },
            ],
        };
        state.applyEvent('api_port/port', port, undefined, AS_OF);
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '1', api_ndock_id: '2', api_highspeed: '0' }, AS_OF);
        // 對不上的槽（空槽／不存在）不動作。
        state.applyEvent('api_req_nyukyo/speedchange', {}, { api_ndock_id: '1' }, AS_OF + 30_000);
        state.applyEvent('api_req_nyukyo/speedchange', {}, { api_ndock_id: '9' }, AS_OF + 30_000);
        expect(state.fleets()[0]!.ships[0]!.inDock).toBe(true);
        state.applyEvent('api_req_nyukyo/speedchange', {}, { api_ndock_id: '2' }, AS_OF + MIN);
        const repaired = state.fleets()[0]!.ships[0]!;
        expect(repaired.inDock).toBe(false);
        expect(repaired.hp).toBe(10);
        expect(repaired.condFloorAt).toBe(AS_OF + MIN);
        expect(repaired.cond).toBe(40);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(BOUNDARY + 9 * MIN);
    });

    it('一般入渠以 api_complete_time 為補值時刻', () => {
        const state = new GameState();
        const port = {
            api_ship: [{ api_id: 1, api_ship_id: 2, api_lv: 1, api_nowhp: 5, api_maxhp: 10, api_cond: 10, api_ndock_time: 5 * MIN, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 }],
            api_deck_port: [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }],
        };
        state.applyEvent('api_port/port', port, undefined, AS_OF);
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '1', api_ndock_id: '1', api_highspeed: '0' }, AS_OF);
        const docked = state.fleets()[0]!.ships[0]!;
        expect(docked.inDock).toBe(true);
        expect(docked.dockCompleteAt).toBe(AS_OF + 5 * MIN);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(BOUNDARY + 12 * MIN);
    });
});

describe('GameState cond 觀測時刻', () => {
    it('取最近一次 api_port/port 的時間戳', () => {
        const state = new GameState();
        const port = {
            api_ship: [{ api_id: 1, api_ship_id: 2, api_lv: 1, api_nowhp: 10, api_maxhp: 10, api_cond: 30, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 }],
            api_deck_port: [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [],
        };
        state.applyEvent('api_port/port', port, undefined, AS_OF);
        expect(state.fleets()[0]?.condAsOf).toBe(AS_OF);
        state.applyEvent('api_port/port', port, undefined, AS_OF + 5 * MIN);
        expect(state.fleets()[0]?.condAsOf).toBe(AS_OF + 5 * MIN);
    });
});
