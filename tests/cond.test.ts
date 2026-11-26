import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    COND_PHASE_UNKNOWN,
    COND_STEP_MS,
    condPhaseConstraint,
    condTier,
    narrowCondPhase,
    fleetCondRecoveryEta,
    fleetSupplyCapAt,
    fleetSupplyProgress,
    naturalRecoveryAt,
    projectNaturalCond,
    projectShipCond,
    shipRecoveryAt,
} from '../utils/cond';
import { parseKcsapiResponse } from '../utils/kcsapi';
import { MORALE_INTERVAL_MS, TIMER_SAFETY_MS, moraleTimer } from '../utils/repair';
import { GameState, type FleetView, type ShipView } from '../utils/state';

const MIN = 60_000;
// 刻意不落在 3 分鐘整點上（+30 秒），確認保守推算以觀測／補值時刻為準而非假設固定整點。
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
    it('自觀測時刻起每滿 3 分鐘保證 +3，上限 49', () => {
        expect(projectNaturalCond(40, AS_OF, AS_OF + 3 * MIN - 1)).toBe(40);
        expect(projectNaturalCond(40, AS_OF, AS_OF + 3 * MIN)).toBe(43);
        expect(projectNaturalCond(40, AS_OF, AS_OF + 60 * MIN)).toBe(49);
        expect(projectNaturalCond(52, AS_OF, AS_OF + 60 * MIN)).toBe(52);
    });

    it('到 49 的保守上界為 asOf + ceil((49-cond)/3)×3 分鐘', () => {
        expect(naturalRecoveryAt(19, AS_OF)).toBe(AS_OF + 30 * MIN);
        expect(naturalRecoveryAt(46, AS_OF)).toBe(AS_OF + 3 * MIN);
        expect(naturalRecoveryAt(47, AS_OF)).toBe(AS_OF + 3 * MIN);
        expect(naturalRecoveryAt(49, AS_OF)).toBeNull();
    });
});

describe('入渠完成補到 40', () => {
    it('自然結束：完成當下補到 40，之後從完成時刻接續每 3 分 +3', () => {
        const docked = ship({ cond: 10, inDock: true, dockCompleteAt: AS_OF + 5 * MIN });
        expect(projectShipCond(docked, AS_OF, AS_OF + 5 * MIN - 1)).toBe(13);
        expect(projectShipCond(docked, AS_OF, AS_OF + 5 * MIN)).toBe(40);
        expect(projectShipCond(docked, AS_OF, AS_OF + 8 * MIN)).toBe(43);
        expect(shipRecoveryAt(docked, AS_OF)).toBe(AS_OF + 14 * MIN);
        expect(naturalRecoveryAt(10, AS_OF)).toBe(AS_OF + 39 * MIN);
    });

    it('入渠時直接用高速修復材：以請求時刻補到 40', () => {
        const bucketed = ship({ cond: 10, condFloorAt: AS_OF + MIN });
        expect(shipRecoveryAt(bucketed, AS_OF)).toBe(AS_OF + 10 * MIN);
        const eta = fleetCondRecoveryEta(fleet([bucketed, ship({ cond: 46 })]));
        expect(eta).toEqual({ at: AS_OF + 10 * MIN, naturalAt: AS_OF + 10 * MIN, below: 2, supplyHelps: false });
    });

    it('回港後才用高速修復材：受損艦從母港時刻以 40 起算，全隊以最低士氣艦為準', () => {
        // 12:02:45 回港（受損艦 cond 37、隊友 cond 40），12:03:05 對受損艦用水桶。
        const portAt = BOUNDARY + 2 * MIN + 45_000;
        const bucketAt = BOUNDARY + 3 * MIN + 5_000;
        const state = new GameState();
        state.applyEvent('api_port/port', {
            api_ship: [
                { api_id: 1, api_ship_id: 2, api_lv: 1, api_nowhp: 5, api_maxhp: 10, api_cond: 37, api_ndock_time: 600_000, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 },
                { api_id: 2, api_ship_id: 2, api_lv: 1, api_nowhp: 10, api_maxhp: 10, api_cond: 40, api_ndock_time: 0, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 },
            ],
            api_deck_port: [{ api_ship: [1, 2, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }],
        }, undefined, portAt);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(portAt + 12 * MIN);

        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '1', api_ndock_id: '1', api_highspeed: '1' }, bucketAt);
        // 兩艘都是母港時 40 起算，回港 9 分後到 49。
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(portAt + 9 * MIN);
        expect(state.fleets()[0]!.ships[0]!.condFloorByBucket).toBe(true);
    });

    it('高速修復：回港後經過的時間照算，不從用桶時刻重新起算；到 49 不早於用桶時刻', () => {
        const bucketed = (at: number) => ship({ cond: 40, condAtPort: 26, condFloorAt: at, condFloorByBucket: true });
        // 回港 4 分後用桶：從母港時刻以 40 起算，回港 9 分後到 49。
        expect(shipRecoveryAt(bucketed(AS_OF + 4 * MIN), AS_OF)).toBe(AS_OF + 9 * MIN);
        expect(projectShipCond(bucketed(AS_OF + 4 * MIN), AS_OF, AS_OF + 4 * MIN)).toBe(43);
        expect(projectShipCond(bucketed(AS_OF + 4 * MIN), AS_OF, AS_OF + 4 * MIN - 1)).toBe(29);
        // 回港 12 分後才用桶：用桶當下就到 49。
        expect(shipRecoveryAt(bucketed(AS_OF + 12 * MIN), AS_OF)).toBe(AS_OF + 12 * MIN);
        // 自然回復本來就更早到 49（用桶晚於該時刻）時維持自然回復。
        expect(shipRecoveryAt(ship({ cond: 40, condAtPort: 26, condFloorAt: AS_OF + 30 * MIN, condFloorByBucket: true }), AS_OF))
            .toBe(AS_OF + 24 * MIN);
    });

    it('只把未滿 40 補到 40；40 以上（含キラ）維持原值，不會被拉回 40', () => {
        const sparkle = ship({ cond: 60, condFloorAt: AS_OF + MIN });
        expect(projectShipCond(sparkle, AS_OF, AS_OF + 30 * MIN)).toBe(60);
        expect(shipRecoveryAt(sparkle, AS_OF)).toBeNull();
        expect(projectShipCond(ship({ cond: 53, inDock: true, dockCompleteAt: AS_OF + MIN }), AS_OF, AS_OF + 2 * MIN)).toBe(53);
        // 45 用水桶：不降到 40，照自然回復在 +3／+6 分到 48／49。
        const normal = ship({ cond: 45, condFloorAt: AS_OF + MIN });
        expect(projectShipCond(normal, AS_OF, AS_OF + MIN)).toBe(45);
        expect(shipRecoveryAt(normal, AS_OF)).toBe(AS_OF + 6 * MIN);
    });

    it('完成時已 ≥40、完成時刻晚於自然回復，或早於觀測時刻，都不改變結果', () => {
        expect(shipRecoveryAt(ship({ cond: 45, inDock: true, dockCompleteAt: AS_OF + MIN }), AS_OF)).toBe(AS_OF + 6 * MIN);
        expect(shipRecoveryAt(ship({ cond: 43, inDock: true, dockCompleteAt: AS_OF + 60 * MIN }), AS_OF)).toBe(AS_OF + 6 * MIN);
        expect(shipRecoveryAt(ship({ cond: 10, condFloorAt: AS_OF - MIN }), AS_OF)).toBe(AS_OF + 39 * MIN);
    });
});

describe('fleetCondRecoveryEta', () => {
    it('全隊取最慢的一艘；全員 ≥49 時 at 為 null', () => {
        const eta = fleetCondRecoveryEta(fleet([ship({ cond: 40 }), ship({ cond: 25 }), ship({ cond: 60 })]));
        expect(eta).toEqual({ at: AS_OF + 24 * MIN, naturalAt: AS_OF + 24 * MIN, below: 2, supplyHelps: false });
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
        expect(eta).toEqual({ at: AS_OF + 2 * MIN, naturalAt: AS_OF + 3 * MIN, below: 1, supplyHelps: true });
    });

    it('給糧門檻與自然回復週期交錯時，取兩者合計首次達 49 的時刻', () => {
        const anchor = AS_OF - 14 * MIN;
        // 43：門檻（AS_OF+2 分）時 43+3=46 未達；AS_OF+3 分自然 +3 → 46，加給糧 +3 → 49。
        const eta = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 43 })],
            { moraleAnchor: anchor },
        ));
        expect(eta?.at).toBe(AS_OF + 3 * MIN);
        expect(eta?.naturalAt).toBe(AS_OF + 6 * MIN);
    });

    it('高速修復時刻及其後的 3 分鐘週期一併列入給糧候選時刻', () => {
        // 已累積 3 次給糧（+9）：AS_OF+4 分用水桶補到 40 的當下（k=0）即達 49。
        const immediate = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 40, condAtPort: 10, condFloorAt: AS_OF + 4 * MIN })],
            { moraleAnchor: AS_OF - 44 * MIN },
        ));
        expect(immediate?.at).toBe(AS_OF + 4 * MIN);

        // 已累積 2 次給糧（+6）：AS_OF+1 分用水桶補到 40（40+6=46 未達），水桶後第 1 個週期（AS_OF+4 分）43+6=49。
        const afterOneStep = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 40, condAtPort: 10, condFloorAt: AS_OF + MIN })],
            { moraleAnchor: AS_OF - 29 * MIN },
        ));
        expect(afterOneStep?.at).toBe(AS_OF + 4 * MIN);
        expect(afterOneStep?.naturalAt).toBe(AS_OF + 10 * MIN);
    });

    it('野埼自身不受給糧；野埼（未改）每次 +2', () => {
        const anchor = AS_OF - 14 * MIN;
        const eta = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI, cond: 46 }), ship({ cond: 47 })],
            { moraleAnchor: anchor },
        ));
        // 47+2=49 在門檻即達；野埼自己 46 只能等自然回復的第一個週期。
        expect(eta?.at).toBe(AS_OF + 3 * MIN);
        expect(eta?.supplyHelps).toBe(false);
    });

    it('野埼要在自然回復後 cond ≥30 才發動', () => {
        const anchor = AS_OF - 14 * MIN;
        const eta = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 21 }), ship({ cond: 43 })],
            { moraleAnchor: anchor },
        ));
        // 隨伴 43 在門檻與首個週期時野埼仍是 21／24，給糧不發動。
        expect(eta?.at).toBe(AS_OF + 30 * MIN);   // 全隊受野埼自身 21→49 拖住
        const escort = fleetCondRecoveryEta(fleet(
            [ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 43, inDock: true, dockCompleteAt: AS_OF + 60 * MIN })],
            { moraleAnchor: anchor },
        ));
        expect(escort?.at).toBe(AS_OF + 6 * MIN);   // 入渠中的艦不受給糧
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
        // 面板當下就顯示補到 40；推算從母港時刻以 40 起算。
        expect(docked.cond).toBe(40);
        expect(docked.condAtPort).toBe(12);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(AS_OF + 9 * MIN);
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
        expect(repaired.condFloorByBucket).toBe(true);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(AS_OF + 9 * MIN);
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
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(AS_OF + 14 * MIN);
    });

    it('api_get_member/ndock（真封包樣本）：更新伺服器完成時刻，出渠後保留原完成時刻補到 40 並回歸給糧對象', () => {
        const ndockSample = parseKcsapiResponse(
            `svdata=${readFileSync(new URL('../samples/ndock-in-dock.json', import.meta.url), 'utf8')}`,
        ) as any[];
        const serverCompleteAt = 1_795_735_034_881;
        const portAt = serverCompleteAt - 5 * MIN;

        const state = new GameState();
        state.applyEvent('api_port/port', {
            api_ship: [
                { api_id: 1, api_ship_id: NOSAKI_KAI, api_lv: 99, api_nowhp: 40, api_maxhp: 40, api_cond: 49, api_ndock_time: 0, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 100, api_bull: 100 },
                { api_id: 215, api_ship_id: 2, api_lv: 80, api_nowhp: 12, api_maxhp: 30, api_cond: 10, api_ndock_time: 302_000, api_ndock_item: [198, 372], api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 100, api_bull: 100 },
            ],
            api_deck_port: [{ api_ship: [1, 215, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [1, 2, 3, 4].map(id => ({ api_id: id, api_state: 0, api_ship_id: 0, api_complete_time: 0 })),
        }, undefined, portAt);
        // 讓給糧計時器在母港時刻起算。
        state.moraleAnchor = portAt;

        // 一般入渠後收到真實 ndock 快照（渠 4 為艦 215）：完成時刻對齊伺服器值，入渠中不列給糧對象。
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '215', api_ndock_id: '4', api_highspeed: '0' }, portAt + 1_000);
        state.applyEvent('api_get_member/ndock', ndockSample, undefined, portAt + 1_500);
        const inDockShip = state.fleets()[0]!.ships[1]!;
        expect(inDockShip.inDock).toBe(true);
        expect(inDockShip.dockCompleteAt).toBe(serverCompleteAt);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(serverCompleteAt + 9 * MIN);
        expect(fleetSupplyCapAt(state.fleets()[0]!)).toBeNull();

        // 完成時刻過後 3 分鐘才進「入渠」畫面看到空渠：補值時刻保留原 serverCompleteAt（非收到封包時刻），並重新納入給糧。
        const emptyNdock = ndockSample.map(d => ({ ...d, api_state: 0, api_ship_id: 0, api_complete_time: 0, api_complete_time_str: '0' }));
        state.applyEvent('api_get_member/ndock', emptyNdock, undefined, serverCompleteAt + 3 * MIN);
        const finishedShip = state.fleets()[0]!.ships[1]!;
        expect(finishedShip.inDock).toBe(false);
        expect(finishedShip.hp).toBe(30);
        expect(finishedShip.ndockTime).toBe(0);
        expect(finishedShip.cond).toBe(40);
        expect(finishedShip.condAtPort).toBe(10);
        expect(finishedShip.condFloorAt).toBe(serverCompleteAt);
        expect(shipRecoveryAt(finishedShip, portAt)).toBe(serverCompleteAt + 9 * MIN);
        expect(fleetSupplyCapAt(state.fleets()[0]!)).toBe(portAt + 2 * MORALE_INTERVAL_MS + TIMER_SAFETY_MS);
    });

    it('api_get_member/ndock 在原完成時刻前觀測到空渠時，補值時刻以封包時刻為上限', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', {
            api_ship: [{ api_id: 1, api_ship_id: 2, api_lv: 1, api_nowhp: 5, api_maxhp: 10, api_cond: 12, api_ndock_time: 5 * MIN, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1 }],
            api_deck_port: [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [{ api_id: 1, api_state: 1, api_ship_id: 1, api_complete_time: AS_OF + 5 * MIN }],
        }, undefined, AS_OF);

        const earlyTs = AS_OF + 4 * MIN;
        state.applyEvent('api_get_member/ndock', [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }], undefined, earlyTs);
        const repaired = state.fleets()[0]!.ships[0]!;
        expect(repaired.condFloorAt).toBe(earlyTs);
        expect(projectShipCond(repaired, AS_OF, earlyTs)).toBe(40);
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

describe('fleetSupplyCapAt', () => {
    // 給糧週期門檻＝錨點 + k×15 分 + 1 分安全緩衝；錨點取進港時刻（同 background 通知）。
    const tick = (k: number) => AS_OF + k * MORALE_INTERVAL_MS + TIMER_SAFETY_MS;

    it('以給糧對象中士氣最低者到 54 為準', () => {
        // 野埼改 +3：48 → 第 1 門檻 自然 49+3=52 → 第 2 門檻 49+6=55（上限 54）；52 在第 1 門檻即達。
        expect(fleetSupplyCapAt(fleet([
            ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 52 }), ship({ cond: 48 }),
        ]))).toBe(tick(2));
    });

    it('野埼自身、入渠中與已達 54 的艦不列入', () => {
        expect(fleetSupplyCapAt(fleet([
            ship({ mst: NOSAKI, cond: 35 }),
            ship({ cond: 52 }),
            ship({ cond: 54 }),
            ship({ cond: 10, inDock: true, dockCompleteAt: AS_OF + 60 * MIN }),
        ]))).toBe(tick(1));   // 只看 52+2=54；野埼 35 與入渠艦另由疲勞倒數處理
    });

    it('隊上沒有未滿 49 的艦，或沒有給糧對象時回 null', () => {
        expect(fleetSupplyCapAt(fleet([ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 50 })]))).toBeNull();
        // 只有野埼自身未滿 49：沒有給糧對象，呼叫端改用一般的 49 推算。
        expect(fleetSupplyCapAt(fleet([ship({ mst: NOSAKI_KAI, cond: 40 }), ship({ cond: 54 })]))).toBeNull();
    });

    it('給糧不發動、出門中或錨點不可考時回 undefined', () => {
        expect(fleetSupplyCapAt(fleet([ship({ cond: 30 }), ship({ cond: 40 })]))).toBeUndefined();
        expect(fleetSupplyCapAt(fleet([ship({ cond: 40 }), ship(), ship({ mst: NOSAKI_KAI })]))).toBeUndefined();
        const ships = [ship({ mst: NOSAKI_KAI }), ship({ cond: 40 })];
        expect(fleetSupplyCapAt(fleet(ships, { mission: true }))).toBeUndefined();
        expect(fleetSupplyCapAt(fleet(ships, { moraleAnchor: undefined }))).toBeUndefined();
        expect(fleetSupplyCapAt(fleet(ships, { condAsOf: undefined }))).toBeUndefined();
    });
});

describe('給糧累積（moraleTimer／fleetSupplyProgress）', () => {
    const tick = (k: number) => AS_OF + k * MORALE_INTERVAL_MS + TIMER_SAFETY_MS;

    it('倒數到了不停住：次數 +1，接著倒數下一次', () => {
        expect(moraleTimer(AS_OF, AS_OF)).toEqual({ ticks: 0, nextIn: MORALE_INTERVAL_MS + TIMER_SAFETY_MS });
        expect(moraleTimer(AS_OF, tick(1) - 1)).toEqual({ ticks: 0, nextIn: 1 });
        expect(moraleTimer(AS_OF, tick(1))).toEqual({ ticks: 1, nextIn: MORALE_INTERVAL_MS });
        expect(moraleTimer(AS_OF, tick(2) + 5 * MIN).ticks).toBe(2);
    });

    it('全員 ≥49 也回報累積；給糧對象全員到 54 的時點起標成「回港即滿」', () => {
        const f = fleet([ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 49 }), ship({ cond: 51 })]);
        // 野埼改 +3：49 要兩次才到 54（49+6 封頂）。
        expect(fleetSupplyProgress(f, tick(1))).toEqual({ ticks: 1, full: false, fullAt: tick(2) });
        expect(fleetSupplyProgress(f, tick(2))).toEqual({ ticks: 2, full: true, fullAt: null });
        // 給糧對象都已 54：現在回港就是滿的。
        expect(fleetSupplyProgress(fleet([ship({ mst: NOSAKI_KAI }), ship({ cond: 54 })]), AS_OF))
            .toEqual({ ticks: 0, full: true, fullAt: null });
    });

    it('給糧不發動、出門中或錨點不可考時回 undefined', () => {
        const ships = [ship({ mst: NOSAKI }), ship({ cond: 40 })];
        expect(fleetSupplyProgress(fleet(ships, { mission: true }), AS_OF)).toBeUndefined();
        expect(fleetSupplyProgress(fleet(ships, { moraleAnchor: null }), AS_OF)).toBeUndefined();
        expect(fleetSupplyProgress(fleet(ships, { moraleAnchor: undefined }), AS_OF)).toBeUndefined();
        expect(fleetSupplyProgress(fleet([ship(), ship({ cond: 40 })]), AS_OF)).toBeUndefined();
    });

    it('暫停中只結算 1 次、不再倒數', () => {
        expect(moraleTimer(AS_OF, tick(3), true)).toEqual({ ticks: 1, nextIn: null });
        expect(moraleTimer(AS_OF, AS_OF, true).nextIn).toBe(MORALE_INTERVAL_MS + TIMER_SAFETY_MS);
    });
});

describe('未改野埼只給糧 cond ≥49 的艦', () => {
    it('自然回復後未滿 49 的艦不靠給糧提早回到 49；野埼改照常', () => {
        // 32 在第 1 次門檻（16 分）自然回復到 47：野埼改 +3＝50 提早，未改野埼不給糧。
        const plain = fleetCondRecoveryEta(fleet([ship({ mst: NOSAKI, cond: 49 }), ship({ cond: 32 })]))!;
        expect(plain.supplyHelps).toBe(false);
        expect(plain.at).toBe(plain.naturalAt);
        expect(fleetCondRecoveryEta(fleet([ship({ mst: NOSAKI_KAI, cond: 49 }), ship({ cond: 32 })]))!.supplyHelps).toBe(true);
    });
});

describe('自然回復相位推估', () => {
    const SEC = 1_000;
    // 時鐘 3 分鐘整點（例如 20:57:00）；回復實際落在這個整點上。
    const TICK = BOUNDARY + 3 * MIN;
    const rawShip = (id: number, cond: number) => ({
        api_id: id, api_ship_id: 2, api_lv: 1, api_nowhp: 10, api_maxhp: 10, api_cond: cond, api_ndock_time: 0,
        api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1,
    });
    const port = (conds: number[], deckShips: number[][] = [conds.map((_, i) => i + 1)]) => ({
        api_ship: conds.map((cond, i) => rawShip(i + 1, cond)),
        api_deck_port: deckShips.map(ids => ({ api_ship: [...ids, ...Array(6 - ids.length).fill(-1)], api_mission: [0, 0, 0, 0] })),
        api_ndock: [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }],
    });

    it('前後兩次母港之間多回復一次：相位落在兩次之間（兩端各放寬 2 秒）', () => {
        // 20:56:34 回港、20:57:06 再回港，回復 1 次 → 相位在 20:56:32～20:57:08。
        expect(condPhaseConstraint(TICK - 26 * SEC, TICK + 6 * SEC, 1)).toEqual([[0, 8 * SEC], [152 * SEC, COND_STEP_MS]]);
        // 沒有回復 → 相位在這段之外。
        expect(condPhaseConstraint(TICK - 26 * SEC, TICK + 6 * SEC, 0)).toEqual([[4 * SEC, 156 * SEC]]);
        // 次數不可能（32 秒內回復 2 次）→ 不採用。
        expect(condPhaseConstraint(TICK - 26 * SEC, TICK + 6 * SEC, 2)).toBeNull();
    });

    it('多次觀測取交集；與既有範圍矛盾時改信新觀測', () => {
        const a = condPhaseConstraint(TICK - 26 * SEC, TICK + 6 * SEC, 1)!;
        const b = condPhaseConstraint(TICK - 5 * SEC, TICK + 40 * SEC, 1)!;
        expect(narrowCondPhase(a, b)).toEqual([[0, 8 * SEC], [173 * SEC, COND_STEP_MS]]);
        const far = condPhaseConstraint(TICK + 60 * SEC, TICK + 70 * SEC, 1)!;
        expect(narrowCondPhase(a, far)).toEqual(far);
        expect(narrowCondPhase(COND_PHASE_UNKNOWN, a)).toEqual(a);
    });

    it('相位已知時，到 49 的上界只等到最晚可能的那次回復，不必多等一整個週期', () => {
        const phase = condPhaseConstraint(TICK - 26 * SEC, TICK + 6 * SEC, 1)!;
        // 整點前 40 秒回港、cond 41：最晚 48 秒後第一次回復，再兩次到 49。
        const asOf = TICK + 30 * MIN - 40 * SEC;
        expect(naturalRecoveryAt(41, asOf)).toBe(asOf + 9 * MIN);
        expect(naturalRecoveryAt(41, asOf, phase)).toBe(asOf + 48 * SEC + 6 * MIN);
        expect(projectNaturalCond(41, asOf, asOf + 48 * SEC - 1, phase)).toBe(41);
        expect(projectNaturalCond(41, asOf, asOf + 48 * SEC, phase)).toBe(44);
        // 回港時刻落在相位範圍內：那次回復算沒算進觀測不確定，仍保守多等一整個週期。
        expect(naturalRecoveryAt(41, TICK + 30 * MIN, phase)).toBe(TICK + 30 * MIN + 9 * MIN);
    });

    it('GameState：20:56:34 回港 cond 41、20:57:06 再回港 cond 44，下次回港起用推估的相位', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', port([41, 49]), undefined, TICK - 26 * SEC);
        expect(state.condPhase).toEqual(COND_PHASE_UNKNOWN);
        state.applyEvent('api_port/port', port([44, 49]), undefined, TICK + 6 * SEC);
        expect(state.condPhase).toEqual([[0, 8 * SEC], [152 * SEC, COND_STEP_MS]]);
        const later = TICK + 30 * MIN - 40 * SEC;
        state.applyEvent('api_port/port', port([41, 49]), undefined, later);
        expect(state.fleets()[0]!.condPhase).toEqual(state.condPhase);
        expect(fleetCondRecoveryEta(state.fleets()[0]!)?.at).toBe(later + 48 * SEC + 6 * MIN);
    });

    it('期間出擊的艦不拿來推估；各艦回復次數不一致時整次不採用', () => {
        const sortied = new GameState();
        sortied.applyEvent('api_port/port', port([41, 40], [[1], [2]]), undefined, TICK - 26 * SEC);
        sortied.applyEvent('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1 }, { api_deck_id: '2' }, TICK - 20 * SEC);
        sortied.applyEvent('api_port/port', port([44, 25], [[1], [2]]), undefined, TICK + 6 * SEC);
        expect(sortied.condPhase).toEqual([[0, 8 * SEC], [152 * SEC, COND_STEP_MS]]);

        const odd = new GameState();
        odd.applyEvent('api_port/port', port([41, 40]), undefined, TICK - 26 * SEC);
        odd.applyEvent('api_port/port', port([44, 46]), undefined, TICK + 6 * SEC);
        expect(odd.condPhase).toEqual(COND_PHASE_UNKNOWN);
    });
});
