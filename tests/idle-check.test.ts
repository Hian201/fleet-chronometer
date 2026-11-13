// 登出前閒置檢查（docs/completion-plan.md §4.4）的判定。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idleMarks, practiceRound } from '../utils/idle-check';
import { GameState } from '../utils/state';

const sample = (name: string) =>
    JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')).api_data;

// 2026-11-11（三）12:00 JST
const WED_NOON = Date.UTC(2026, 10, 11, 3);
// 2026-11-15（日）22:00 JST：下一次 05:00 是週一，週任也會換期
const SUN_NIGHT = Date.UTC(2026, 10, 15, 13);

/** decks：每隊的艦實例 id；mission：各隊 api_mission[0]。 */
function harbor(opts: {
    decks: number[][];
    mission?: number[];
    hp?: Record<number, number>;
    mst?: Record<number, number>;
    ndock?: { state: number; ship?: number }[];
}) {
    const state = new GameState();
    const ids = [...new Set(opts.decks.flat())];
    state.applyEvent('api_port/port', {
        api_ship: ids.map(id => ({
            api_id: id, api_ship_id: opts.mst?.[id] ?? 1, api_slot: [], api_slot_ex: 0, api_lv: 1,
            api_nowhp: opts.hp?.[id] ?? 40, api_maxhp: 40, api_cond: 49, api_ndock_time: 60_000,
        })),
        api_deck_port: opts.decks.map((ships, i) => ({
            api_id: i + 1, api_ship: [...ships, ...Array(6 - ships.length).fill(-1)],
            api_mission: [opts.mission?.[i] ?? 0, 0, 0, 0],
        })),
        api_ndock: (opts.ndock ?? []).map((d, i) => ({
            api_id: i + 1, api_state: d.state, api_ship_id: d.ship ?? 0, api_complete_time: 0,
        })),
        api_material: [], api_basic: {}, api_count_kdock: 0,
    });
    return state;
}

describe('遠征：閒置艦隊', () => {
    it('第 2–4 艦隊中有艦、沒出遠征的才算；空艦隊與第 1 艦隊不算', () => {
        const state = harbor({ decks: [[1], [2], [3], []], mission: [0, 1, 0, 0] });
        expect(idleMarks(state, WED_NOON).exped).toBe(1);
    });

    it('泊地修理運作中的艦隊不算（明石旗艦）', () => {
        const state = harbor({ decks: [[1], [2], [3, 4]], mst: { 3: 187 } });
        expect(idleMarks(state, WED_NOON).exped).toBe(1);
    });

    it('連合艦隊編成中的第 2 艦隊不算', () => {
        const state = harbor({ decks: [[1], [2], [3]] });
        state.applyEvent('api_req_hensei/combined', { api_combined: 1 }, { api_combined_type: '1' });
        expect(idleMarks(state, WED_NOON).exped).toBe(1);
    });

    it('出擊中的艦隊不算', () => {
        const state = harbor({ decks: [[1], [2], [3]] });
        state.applyEvent('api_req_map/start',
            { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_color_no: 1 }, { api_deck_id: '3' });
        expect(idleMarks(state, WED_NOON).exped).toBe(1);
    });
});

describe('入渠：空渠＋待修艦', () => {
    const ndock = [{ state: 0 }, { state: 0 }, { state: 1, ship: 3 }, { state: -1 }];

    it('取空渠數與可入渠待修艦數的較小值；遠征中與入渠中的艦不算', () => {
        const state = harbor({
            decks: [[1], [2], [3]], mission: [0, 1, 0],
            hp: { 1: 20, 2: 20, 3: 20 }, ndock,
        });
        expect(idleMarks(state, WED_NOON).dock).toBe(1);
    });

    it('沒有待修艦時不標', () => {
        const state = harbor({ decks: [[1]], ndock });
        expect(idleMarks(state, WED_NOON).dock).toBe(0);
    });

    it('沒有空渠時不標', () => {
        const state = harbor({ decks: [[1]], hp: { 1: 20 }, ndock: [{ state: 1, ship: 9 }, { state: -1 }] });
        expect(idleMarks(state, WED_NOON).dock).toBe(0);
    });
});

describe('任務：換期前已達成未領獎', () => {
    const questlist = (state: GameState, ts: number) => state.applyEvent('api_get_member/questlist', {
        api_list: [
            { api_no: 201, api_state: 3, api_type: 1, api_label_type: 2, api_category: 2, api_title: '每日達成', api_detail: '' },
            { api_no: 214, api_state: 3, api_type: 2, api_label_type: 3, api_category: 2, api_title: '每週達成', api_detail: '' },
            { api_no: 249, api_state: 2, api_type: 3, api_label_type: 6, api_category: 2, api_title: '每月進行中', api_detail: '' },
            { api_no: 999, api_state: 3, api_type: 5, api_label_type: 7, api_category: 2, api_title: '週期不明', api_detail: '' },
        ],
    }, { api_tab_id: '0' }, ts);

    it('平日只數每日任務', () => {
        const state = new GameState();
        questlist(state, WED_NOON);
        expect(idleMarks(state, WED_NOON).quests).toBe(1);
    });

    it('週日晚上連週任一起數；api_type 5 且沒有年任換期月的不猜', () => {
        const state = new GameState();
        questlist(state, SUN_NIGHT);
        expect(idleMarks(state, SUN_NIGHT).quests).toBe(2);
    });

    it('換期後還沒重開任務清單時，上一期的達成不算', () => {
        const state = new GameState();
        questlist(state, WED_NOON);
        expect(idleMarks(state, WED_NOON + 24 * 3600_000).quests).toBe(0);
    });
});

describe('演習：本輪剩餘場數', () => {
    const list = sample('practice-list-after-battles.json');

    it('清單中 api_state 為 0 的對手數', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/practice', list, undefined, WED_NOON);
        expect(idleMarks(state, WED_NOON + 3600_000).practice).toBe(3);
    });

    it('清單之後每次開戰扣一場，夜戰接續不另扣；新清單到達以清單為準', () => {
        const state = harbor({ decks: [[1]] });
        state.applyEvent('api_get_member/practice', list, undefined, WED_NOON);
        const battle = {
            api_deck_id: 1, api_f_nowhps: [40], api_f_maxhps: [40],
            api_e_nowhps: [30], api_e_maxhps: [30], api_ship_ke: [1501],
        };
        state.applyEvent('api_req_practice/battle', battle, { api_deck_id: '1' }, WED_NOON + 60_000);
        state.applyEvent('api_req_practice/midnight_battle', { ...battle, api_hougeki: null }, undefined, WED_NOON + 120_000);
        expect(idleMarks(state, WED_NOON + 180_000).practice).toBe(2);
        state.applyEvent('api_get_member/practice', list, undefined, WED_NOON + 240_000);
        expect(idleMarks(state, WED_NOON + 300_000).practice).toBe(3);
    });

    it('換輪（15:00 JST）後尚未看到新清單時不可考；沒看過清單也不可考', () => {
        const state = new GameState();
        expect(idleMarks(state, WED_NOON).practice).toBeNull();
        state.applyEvent('api_get_member/practice', list, undefined, WED_NOON);
        expect(idleMarks(state, WED_NOON + 3 * 3600_000).practice).toBeNull();
    });

    it('輪次在 03:00 與 15:00 JST 換新', () => {
        const jst = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 9, m);
        expect(practiceRound(jst(11, 14, 59))).toBe(practiceRound(jst(11, 3)));
        expect(practiceRound(jst(11, 15))).toBe(practiceRound(jst(11, 3)) + 1);
        expect(practiceRound(jst(12, 2, 59))).toBe(practiceRound(jst(11, 15)));
        expect(practiceRound(jst(12, 3))).toBe(practiceRound(jst(11, 15)) + 1);
    });
});
