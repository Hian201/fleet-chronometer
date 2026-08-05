// 基地航空隊的唯一鍵＝海域 id＋rid（`airBaseKey`）。
//
// 這支測試鎖的是一個**實機回報過的災情**：舊碼一律拿 rid（「該海域的第幾個基地」）當鍵，
// 於是同時擁有中部海域與活動海域的基地時，海域名對照表、顯示範圍開關、匯出 dialog 的
// selector 全部撞號——畫面上每個基地都掛同一個海域名（最後寫入的那個），一整排長得一模
// 一樣分不出誰是誰，開關也變成兩個海域連動。詳見 utils/state.ts airBaseKey 的註解。
import { describe, expect, it } from 'vitest';
import { GameState, airBaseKey } from '../utils/state';
import { airBaseAreaLabel, fleetMarkdown } from '../entrypoints/overview/lib';
import { buildDeckBuilder } from '../utils/deckbuilder';
import { setLang } from '../utils/ui-i18n';

// 兩個海域各有一個 rid=1 的基地——正是撞號的最小情境（中部海域與活動海域都有
// 「第一基地航空隊」）。master 不載入：mapAreaName 走既有的回退（6→中部海域、
// >10→活動海域），本測試要驗的是鍵與範圍，不是譯名表。
function stateWithTwoAreas(): GameState {
    const state = new GameState();
    setLang('zh-TW');
    state.applyEvent('api_get_member/slot_item', {
        api_slot_item: [
            { api_id: 901, api_slotitem_id: 168, api_level: 0, api_alv: 0 },
            { api_id: 902, api_slotitem_id: 169, api_level: 0, api_alv: 0 },
        ],
    });
    state.applyEvent('api_get_member/base_air_corps', [
        {
            api_area_id: 6, api_rid: 1, api_name: '第一基地航空隊', api_action_kind: 1,
            api_distance: { api_base: 6, api_bonus: 0 },
            api_plane_info: [{ api_slotid: 901, api_state: 1, api_count: 18, api_max_count: 18, api_cond: 1 }],
        },
        {
            api_area_id: 62, api_rid: 1, api_name: '第一基地航空隊', api_action_kind: 1,
            api_distance: { api_base: 7, api_bonus: 0 },
            api_plane_info: [{ api_slotid: 902, api_state: 1, api_count: 18, api_max_count: 18, api_cond: 1 }],
        },
    ]);
    return state;
}

describe('基地航空隊的唯一鍵', () => {
    it('同 rid 不同海域是兩顆不同的基地，複合鍵不得相同', () => {
        const bases = stateWithTwoAreas().airBases_();
        expect(bases).toHaveLength(2);
        const keys = bases.map(airBaseKey);
        expect(new Set(keys).size).toBe(2);
        // 分隔符必須與 GameState.airBases 的 map key 完全一致——airBaseKey() 就是那把鍵
        // 本身，拿去 airBases.get() 要查得到（曾經一邊 `_` 一邊 `-`，查不到又不報錯）。
        expect(keys).toEqual(['6_1', '62_1']);
        const state = stateWithTwoAreas();
        for (const key of keys) expect(state.airBases.get(key)).toBeTruthy();
    });

    it('海域標籤：通常海域標編號（6-x 的 6），活動海域用活動名', () => {
        const state = stateWithTwoAreas();
        expect(airBaseAreaLabel(state, 6)).toBe('6 中部海域');
        // master 查無此 id（活動已結束／尚未載入 start2）時補上 id，否則兩個活動海域
        // 都會顯示成「活動海域」而分不出誰是誰。
        expect(airBaseAreaLabel(state, 62)).toBe('活動海域 #62');
    });

    // 顯示範圍以**海域**為單位（使用者指定「每個海域一個 checkbox 就好」），鍵是
    // String(areaId)——關掉中部海域不得連帶關掉活動海域那顆同 rid 的基地。
    it('顯示範圍以海域為單位，且兩個海域互不連動', () => {
        const state = stateWithTwoAreas();
        const md = fleetMarkdown(state, '##', { fleets: [], lbas: { 6: false } });
        expect(md).toContain('活動海域 #62');
        expect(md).not.toContain('中部海域');

        const md2 = fleetMarkdown(state, '##', { fleets: [], lbas: { 62: false } });
        expect(md2).toContain('中部海域');
        expect(md2).not.toContain('活動海域 #62');
    });

    it('DeckBuilder 輸出：兩個海域的基地各佔一格，不互相覆蓋', () => {
        const state = stateWithTwoAreas();
        const deck = buildDeckBuilder(state, { fleets: [], lbas: {} }) as Record<string, unknown>;
        // 舊碼用 `a${rid}` 當鍵，兩顆都是 rid=1 ⇒ 後者覆蓋前者、只剩一格。
        expect(deck.a1).toBeTruthy();
        expect(deck.a2).toBeTruthy();
    });
});
