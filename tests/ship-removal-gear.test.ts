// 解体與近代化改修的餌艦移除：api_slot_dest_flag=1 時裝備隨艦消失。回應與之後的 api_port/port
// 都不帶裝備清單，漏刪會讓裝備數偏高到下次 require_info／slot_item 才校正。
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const TARGET = 1;
const FEEDER_A = 2;
const FEEDER_B = 3;

function shipRow(id: number, slot: number[], slotEx = -1) {
    return {
        api_id: id, api_ship_id: 1, api_lv: 50, api_nowhp: 17, api_maxhp: 17, api_cond: 49,
        api_ndock_time: 0, api_slot: [...slot, -1, -1, -1, -1, -1].slice(0, 5), api_slot_ex: slotEx,
        api_kyouka: [0, 0, 0, 0, 0, 0, 0], api_fuel: 10, api_bull: 10,
    };
}

function setup() {
    const state = new GameState();
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: [11, 12, 21, 22, 23, 31].map(id => ({ api_id: id, api_slotitem_id: 2, api_level: 0 })),
    });
    state.applyEvent('api_port/port', {
        api_ship: [shipRow(TARGET, [11, 12]), shipRow(FEEDER_A, [21, 22], 23), shipRow(FEEDER_B, [31])],
        api_deck_port: [{ api_ship: [TARGET, FEEDER_A, FEEDER_B, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    return state;
}

const gearIds = (state: GameState) => [...state.slotItems.keys()].sort((a, b) => a - b);

describe('餌艦／解體艦的裝備', () => {
    it('近代化改修 api_slot_dest_flag=1：餌艦一般槽與補強增設的裝備一起移出倉庫', () => {
        const state = setup();
        state.applyEvent('api_req_kaisou/powerup',
            { api_powerup_flag: 1, api_ship: shipRow(TARGET, [11, 12]) },
            { api_id: String(TARGET), api_id_items: `${FEEDER_A},${FEEDER_B}`, api_slot_dest_flag: '1' });
        expect(state.ships.has(FEEDER_A)).toBe(false);
        expect(state.ships.has(FEEDER_B)).toBe(false);
        expect(gearIds(state)).toEqual([11, 12]);
        expect(state.decks[0].api_ship).toEqual([TARGET, -1, -1, -1, -1, -1]);
    });

    it('近代化改修 api_slot_dest_flag=0：裝備留在倉庫', () => {
        const state = setup();
        state.applyEvent('api_req_kaisou/powerup',
            { api_powerup_flag: 1, api_ship: shipRow(TARGET, [11, 12]) },
            { api_id: String(TARGET), api_id_items: `${FEEDER_A},${FEEDER_B}`, api_slot_dest_flag: '0' });
        expect(state.ships.has(FEEDER_A)).toBe(false);
        expect(gearIds(state)).toEqual([11, 12, 21, 22, 23, 31]);
    });

    it('回港封包不會把已廢棄的裝備加回來', () => {
        const state = setup();
        state.applyEvent('api_req_kaisou/powerup',
            { api_powerup_flag: 1, api_ship: shipRow(TARGET, [11, 12]) },
            { api_id: String(TARGET), api_id_items: String(FEEDER_A), api_slot_dest_flag: '1' });
        state.applyEvent('api_port/port', {
            api_ship: [shipRow(TARGET, [11, 12]), shipRow(FEEDER_B, [31])],
            api_deck_port: [{ api_ship: [TARGET, FEEDER_B, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
        });
        expect(gearIds(state)).toEqual([11, 12, 31]);
    });

    it('解体走工廠端點 api_req_kousyou/destroyship，依 api_slot_dest_flag 決定裝備去留', () => {
        const scrapGear = setup();
        scrapGear.applyEvent('api_req_kousyou/destroyship', {},
            { api_ship_id: `${FEEDER_A},${FEEDER_B}`, api_slot_dest_flag: '1' });
        expect(scrapGear.ships.has(FEEDER_A)).toBe(false);
        expect(gearIds(scrapGear)).toEqual([11, 12]);

        const keepGear = setup();
        keepGear.applyEvent('api_req_kousyou/destroyship', {},
            { api_ship_id: String(FEEDER_A), api_slot_dest_flag: '0' });
        expect(keepGear.ships.has(FEEDER_A)).toBe(false);
        expect(gearIds(keepGear)).toEqual([11, 12, 21, 22, 23, 31]);
    });

    it('廢棄裝備走工廠端點 api_req_kousyou/destroyitem2', () => {
        const state = setup();
        state.applyEvent('api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: '31' });
        expect(gearIds(state)).toEqual([11, 12, 21, 22, 23]);
    });
});
