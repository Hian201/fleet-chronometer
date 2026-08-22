// api_req_hensei/change 的回應通常不含新編成，必須在本機維持「編成不留空位」。
// 漏補會讓後續請求的 api_ship_idx 對到錯格：面板 fleets() 又會跳過 -1，看起來像艦消失。
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const YAMATO = 10;
const NAGATO = 20;
const SHIP_C = 30;

function shipRow(id: number) {
    return {
        api_id: id, api_ship_id: id, api_lv: 99, api_nowhp: 50, api_maxhp: 50, api_cond: 49,
        api_ndock_time: 0, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 10, api_bull: 10,
    };
}

function stateWithDecks(decks: number[][], ships = [YAMATO, NAGATO, SHIP_C]) {
    const state = new GameState();
    state.applyEvent('api_port/port', {
        api_ship: ships.map(shipRow),
        api_deck_port: decks.map(api_ship => ({ api_ship, api_mission: [0, 0, 0, 0] })),
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    return state;
}

function change(state: GameState, deckId: number, idx: number, shipId: number) {
    state.applyEvent('api_req_hensei/change', {}, {
        api_id: String(deckId),
        api_ship_idx: String(idx),
        api_ship_id: String(shipId),
    });
}

function fleetIds(state: GameState, deckIdx = 0) {
    return state.fleets()[deckIdx].ships.map(s => s.id);
}

describe('編成 change 補位', () => {
    it('移除旗艦後剩餘艦往前補，不會留下 -1 空洞', () => {
        const state = stateWithDecks([[YAMATO, NAGATO, -1, -1, -1, -1]]);
        change(state, 1, 0, -1);
        expect(state.decks[0].api_ship).toEqual([NAGATO, -1, -1, -1, -1, -1]);
        expect(fleetIds(state)).toEqual([NAGATO]);
    });

    it('點後面的空格加入時，船會落到第一個空位', () => {
        const state = stateWithDecks([[YAMATO, -1, -1, -1, -1, -1]]);
        change(state, 1, 4, NAGATO);
        expect(state.decks[0].api_ship).toEqual([YAMATO, NAGATO, -1, -1, -1, -1]);
        expect(fleetIds(state)).toEqual([YAMATO, NAGATO]);
    });

    it('同隊兩艦交換後順序對調，長度與空位不變', () => {
        const state = stateWithDecks([[YAMATO, NAGATO, -1, -1, -1, -1]]);
        change(state, 1, 0, NAGATO);
        expect(state.decks[0].api_ship).toEqual([NAGATO, YAMATO, -1, -1, -1, -1]);
        expect(fleetIds(state)).toEqual([NAGATO, YAMATO]);
    });

    it('從別隊把船移到空格時，來源艦隊也要補位', () => {
        const state = stateWithDecks([
            [YAMATO, -1, -1, -1, -1, -1],
            [NAGATO, SHIP_C, -1, -1, -1, -1],
        ]);
        change(state, 1, 1, NAGATO);
        expect(state.decks[0].api_ship).toEqual([YAMATO, NAGATO, -1, -1, -1, -1]);
        expect(state.decks[1].api_ship).toEqual([SHIP_C, -1, -1, -1, -1, -1]);
        expect(fleetIds(state, 0)).toEqual([YAMATO, NAGATO]);
        expect(fleetIds(state, 1)).toEqual([SHIP_C]);
    });

    it('遊撃七船編成補位後仍維持長度 7', () => {
        const extra = 40;
        const state = stateWithDecks(
            [[YAMATO, NAGATO, SHIP_C, extra, -1, -1, -1]],
            [YAMATO, NAGATO, SHIP_C, extra],
        );
        change(state, 1, 1, -1);
        expect(state.decks[0].api_ship).toEqual([YAMATO, SHIP_C, extra, -1, -1, -1, -1]);
        expect(state.decks[0].api_ship).toHaveLength(7);
    });

    it('交換後移除再加入：旗艦不會被蓋掉，也不會整隊變空', () => {
        // 交換、移除與再次加入必須維持艦列緊湊：移除後尾端補位，避免後續 change 蓋掉
        // 仍在隊上的艦或讓整隊清空。
        const state = stateWithDecks([[YAMATO, -1, -1, -1, -1, -1]]);
        change(state, 1, 1, NAGATO);
        change(state, 1, 0, NAGATO);
        expect(fleetIds(state)).toEqual([NAGATO, YAMATO]);

        change(state, 1, 0, -1);
        expect(state.decks[0].api_ship).toEqual([YAMATO, -1, -1, -1, -1, -1]);
        expect(fleetIds(state)).toEqual([YAMATO]);

        change(state, 1, 1, NAGATO);
        expect(state.decks[0].api_ship).toEqual([YAMATO, NAGATO, -1, -1, -1, -1]);
        expect(fleetIds(state)).toEqual([YAMATO, NAGATO]);

        change(state, 1, 1, -1);
        expect(state.decks[0].api_ship).toEqual([YAMATO, -1, -1, -1, -1, -1]);
        expect(fleetIds(state)).toEqual([YAMATO]);
    });

    it('解体中間艦後剩餘艦往前補，後續 change 的 idx 才對得上遊戲', () => {
        const state = stateWithDecks([[YAMATO, NAGATO, SHIP_C, -1, -1, -1]]);
        state.applyEvent('api_req_kaisou/destroyship', {}, { api_ship_id: String(NAGATO), api_slot_dest: '0' });
        expect(state.decks[0].api_ship).toEqual([YAMATO, SHIP_C, -1, -1, -1, -1]);
        change(state, 1, 1, -1);
        expect(state.decks[0].api_ship).toEqual([YAMATO, -1, -1, -1, -1, -1]);
        expect(fleetIds(state)).toEqual([YAMATO]);
    });
});
