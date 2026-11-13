// 演習畫面：對手清單解析、戰鬥對應對手、夜戰目標門檻與面板字串。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { practiceBattleHeadHtml, practiceListHtml, practiceNightHtml } from '../entrypoints/panel/practice';
import { nightRankTargets, predictRank } from '../utils/battle';
import type { BattleShipView } from '../utils/battle-types';
import { idleMarks, nextPracticeReset } from '../utils/idle-check';
import { GameState } from '../utils/state';
import { setLang } from '../utils/ui-i18n';

const sample = (name: string) =>
    JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')).api_data;

// 2026-11-11（三）12:00 JST
const WED_NOON = Date.UTC(2026, 10, 11, 3);

function harbor() {
    const state = new GameState();
    state.applyEvent('api_port/port', {
        api_ship: [{ api_id: 1, api_ship_id: 1, api_slot: [], api_slot_ex: 0, api_lv: 1, api_nowhp: 40, api_maxhp: 40, api_cond: 49, api_ndock_time: 0 }],
        api_deck_port: [{ api_id: 1, api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0,
    });
    return state;
}
const battle = (flagship: number) => ({
    api_deck_id: 1, api_f_nowhps: [40], api_f_maxhps: [40],
    api_e_nowhps: [30], api_e_maxhps: [30], api_ship_ke: [flagship], api_midnight_flag: 1,
});

describe('演習對手清單', () => {
    const list = sample('practice-list-after-battles.json');

    it('保留每位對手的等級、階級、旗艦、勳章與 api_state', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/practice', list, undefined, WED_NOON);
        const opponents = state.practiceList_()!.opponents;
        expect(opponents.map(o => o.state)).toEqual([0, 3, 0, 0, 6]);
        expect(opponents.map(o => o.flagship)).toEqual([369, 538, 187, 723, 911]);
        expect(opponents.map(o => o.medals)).toEqual([0, 0, 18, 0, 1]);
        expect(opponents[1]).toMatchObject({ level: 120, rank: '大将', fought: false, localRank: null });
    });

    it('api_create_kind 記為清單抽自哪一群；標題列三語依 KC3Kai 對照顯示 0–2，其他值不顯示', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/practice', list, undefined, WED_NOON);
        expect(state.practiceList_()!.createKind).toBe(0);
        setLang('zh-TW');
        expect(practiceListHtml([], 3, '14:00', 0)).toContain('第一群');
        expect(practiceListHtml([], 3, '14:00', 2)).toContain('舊式全體');
        setLang('en');
        expect(practiceListHtml([], 3, '14:00', 1)).toContain('Group 2');
        setLang('ja');
        expect(practiceListHtml([], 3, '14:00', 2)).toContain('旧式全体');
        expect(practiceListHtml([], 3, '14:00', 5)).not.toContain('pr-group');
        expect(practiceListHtml([], 3, '14:00', null)).not.toContain('pr-group');
    });

    it('敵旗艦對上清單時記在該對手：開戰算交戰、結算寫入評價、回港結束戰況', () => {
        const state = harbor();
        state.applyEvent('api_get_member/practice', list, undefined, WED_NOON);
        state.applyEvent('api_req_practice/battle', battle(369), { api_deck_id: '1' }, WED_NOON + 60_000);
        expect(state.practiceBattle_()).toEqual({ opponent: 0 });
        expect(state.practiceList_()!.opponents[0].fought).toBe(true);
        expect(idleMarks(state, WED_NOON + 90_000).practice).toBe(2);
        state.applyEvent('api_req_practice/battle_result', { api_win_rank: 'S' }, undefined, WED_NOON + 120_000);
        expect(state.practiceList_()!.opponents[0].localRank).toBe('S');
        state.applyEvent('api_port/port', {
            api_ship: [], api_deck_port: [], api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0,
        }, undefined, WED_NOON + 180_000);
        expect(state.practiceBattle_()).toBeNull();
        expect(idleMarks(state, WED_NOON + 200_000).practice).toBe(2);
    });

    it('同旗艦有兩位未交戰對手時不猜，只扣場數', () => {
        const state = harbor();
        const dup = structuredClone(list);
        dup.api_list[2].api_enemy_flag_ship = 369;
        state.applyEvent('api_get_member/practice', dup, undefined, WED_NOON);
        state.applyEvent('api_req_practice/battle', battle(369), { api_deck_id: '1' }, WED_NOON + 60_000);
        expect(state.practiceBattle_()).toEqual({ opponent: null });
        expect(state.practiceList_()!.opponents.every(o => !o.fought)).toBe(true);
        expect(idleMarks(state, WED_NOON + 90_000).practice).toBe(2);
    });

    it('下一次換新在 15:00 JST', () => {
        expect(nextPracticeReset(WED_NOON)).toBe(Date.UTC(2026, 10, 11, 6));
    });
});

describe('夜戰目標門檻', () => {
    const ship = (beginHp: number, hp: number): BattleShipView => ({ hp, maxHp: beginHp, beginHp, damecon: 0, sunk: hp <= 0, dealtDamage: 0 });

    it('演習夜戰樣本的日戰結束狀態：敵 6 沉 5 已是 A，S 再擊沉 1 艘', () => {
        const night = sample('practice-midnight-battle.json');
        // 樣本只有夜戰包；api_*_nowhps 是日戰結束值，日戰開始值以最大 HP 代替（只影響 B／C 的 HP 門檻）。
        const player = night.api_f_maxhps.map((max: number, i: number) => ship(max, night.api_f_nowhps[i]));
        const enemy = night.api_e_maxhps.map((max: number, i: number) => ship(max, night.api_e_nowhps[i]));
        expect(predictRank(player, enemy)).toBe('A');
        expect(nightRankTargets(player, enemy)).toEqual([{ rank: 'S', sink: 1 }]);
    });

    it('目前 C 時依序列出 B 的 HP 門檻、A 與 S 的擊沉數', () => {
        const player = [60, 50, 45, 40, 35, 35].map(b => ship(b, Math.round(b * 0.75)));
        const enemy = [90, 60, 60, 40, 30, 30].map((b, i) => ship(b, i < 2 ? 0 : i < 4 ? b : Math.round(b * 0.9)));
        expect(predictRank(player, enemy)).toBe('C');
        const needs = nightRankTargets(player, enemy);
        expect(needs.map(n => n.rank)).toEqual(['B', 'A', 'S']);
        expect(needs[1]).toEqual({ rank: 'A', sink: 2 });
        expect(needs[2]).toEqual({ rank: 'S', sink: 4 });
        // 補上 B 的 HP 門檻後，預測評級確實升到 B；少 1 HP 則不夠。
        const hp = needs[0].hp!;
        const hit = (x: number) => enemy.map((s, i) => i === 2 ? { ...s, hp: s.hp - x } : s);
        expect(predictRank(player, hit(hp))).toBe('B');
        expect(predictRank(player, hit(hp - 1))).toBe('C');
    });

    it('已全滅時沒有門檻；我方有轟沈時不列 S', () => {
        expect(nightRankTargets([ship(40, 40)], [ship(30, 0), ship(30, 0)])).toEqual([]);
        expect(nightRankTargets([ship(40, 0), ship(40, 40)], [ship(30, 30), ship(30, 0)]).map(n => n.rank)).not.toContain('S');
    });
});

describe('面板演習字串', () => {
    it('清單不可考時不寫場數，只說明何時會有資料', () => {
        setLang('zh-TW');
        const html = practiceListHtml(null, null, '14:00');
        expect(html).toContain('本輪清單尚未取得');
        expect(html).not.toContain('剩');
    });

    it('交戰中的對手用實心圈，已交戰顯示評價，夜戰格只列下一級與 S', () => {
        setLang('zh-TW');
        const rows = [
            { name: 'A', level: 120, rank: '元帥', flagshipName: '山風改', stype: '驅逐', comment: '', medals: 0, result: null, current: true },
            { name: 'B', level: 120, rank: '元帥', flagshipName: '冬月改', stype: '驅逐', comment: '', medals: 0, result: 'C', current: false },
        ];
        const head = practiceBattleHeadHtml(rows, 0);
        expect(head).toContain('pr-open now');
        expect(head).toContain('rank-c');
        const night = practiceNightHtml([{ rank: 'B', hp: 38 }, { rank: 'A', sink: 2 }, { rank: 'S', sink: 4 }], false);
        expect(night).toContain('敵再損 38 HP');
        expect(night).toContain('再擊沉 4 艘');
        expect(night).not.toContain('再擊沉 2 艘');
        expect(practiceNightHtml([], true)).toContain('已全滅');
    });
});
