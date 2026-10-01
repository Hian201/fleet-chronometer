import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const port = (maxChara: number, maxSlotitem: number) => ({
    api_ship: [], api_deck_port: [], api_ndock: [], api_material: [],
    api_basic: { api_max_chara: maxChara, api_max_slotitem: maxSlotitem },
});

describe('艦娘／裝備保有上限', () => {
    it('裝備上限比 api_max_slotitem 多 3，與遊戲畫面一致；尚未收到上限時為 0', () => {
        const state = new GameState();
        expect(state.counts()).toMatchObject({ maxShips: 0, maxGears: 0 });

        state.applyEvent('api_port/port', port(430, 2104));
        expect(state.counts()).toMatchObject({ maxShips: 430, maxGears: 2107 });
    });

    it('api_get_member/basic 在回港前更新上限，缺欄位時保留原值', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', port(430, 2104));

        // 任務獎勵「裝備保有枠＋3」：欄位直接放在 api_data，不是 api_basic 之下。
        state.applyEvent('api_get_member/basic', { api_max_chara: 430, api_max_slotitem: 2107 });
        expect(state.counts()).toMatchObject({ maxShips: 430, maxGears: 2110 });

        state.applyEvent('api_get_member/basic', {});
        expect(state.counts()).toMatchObject({ maxShips: 430, maxGears: 2110 });
    });

    it('api_get_member/record 以 [目前數量, 上限] 的第二格更新上限，格式不符時保留原值', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', port(430, 2104));

        state.applyEvent('api_get_member/record', { api_ship: [420, 440], api_slotitem: [2000, 2107] });
        expect(state.counts()).toMatchObject({ maxShips: 440, maxGears: 2110 });

        state.applyEvent('api_get_member/record', { api_ship: [420], api_slotitem: [2000, '2200'] });
        expect(state.counts()).toMatchObject({ maxShips: 440, maxGears: 2110 });
    });
});
