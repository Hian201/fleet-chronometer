import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { applySnapshotBaseline } from '../utils/state-recovery';

function makeShip(id: number, hp: number, maxhp: number, slots: number[] = [-1, -1, -1, -1], slotEx = 0) {
    return {
        api_id: id,
        api_ship_id: 1,
        api_lv: 99,
        api_nowhp: hp,
        api_maxhp: maxhp,
        api_cond: 49,
        api_fuel: 100,
        api_bull: 100,
        api_slot: slots,
        api_slot_ex: slotEx,
        api_onslot: [0, 0, 0, 0],
        api_ndock_time: 0,
    };
}

function makePort(ships: any[], decks: number[][], combinedFlag = 0) {
    return {
        api_basic: { api_nickname: 'Test', api_level: 100, api_max_chara: 100, api_max_slotitem: 400 },
        api_ship: ships,
        api_deck_port: decks.map((api_ship, i) => ({
            api_id: i + 1,
            api_name: `Fleet ${i + 1}`,
            api_mission: [0, 0, 0, 0],
            api_ship,
        })),
        api_ndock: [],
        api_material: Array.from({ length: 8 }, (_, i) => ({ api_id: i + 1, api_value: 1000 })),
        api_combined_flag: combinedFlag,
    };
}

function makeSimpleBattle(fNowhps: number[], fMaxhps: number[], dmgByPos: number[], extra: Record<string, any> = {}) {
    const dfList: number[][] = [];
    const dmgList: number[][] = [];
    const eflag: number[] = [];
    const atList: number[] = [];
    dmgByPos.forEach((dmg, idx) => {
        if (dmg > 0) {
            eflag.push(1);
            atList.push(0);
            dfList.push([idx]);
            dmgList.push([dmg]);
        }
    });
    return {
        api_deck_id: 1,
        api_f_nowhps: fNowhps,
        api_f_maxhps: fMaxhps,
        api_e_nowhps: [50],
        api_e_maxhps: [50],
        api_ship_ke: [1501],
        api_formation: [1, 1, 1],
        api_hougeki1: eflag.length > 0 ? {
            api_at_eflag: eflag,
            api_at_list: atList,
            api_df_list: dfList,
            api_damage: dmgList,
        } : null,
        ...extra,
    };
}

function makeSimpleNight(fNowhps: number[], fMaxhps: number[], dmgByPos: number[], extra: Record<string, any> = {}) {
    const dfList: number[][] = [];
    const dmgList: number[][] = [];
    const eflag: number[] = [];
    const atList: number[] = [];
    dmgByPos.forEach((dmg, idx) => {
        if (dmg > 0) {
            eflag.push(1);
            atList.push(0);
            dfList.push([idx]);
            dmgList.push([dmg]);
        }
    });
    return {
        api_deck_id: 1,
        api_f_nowhps: fNowhps,
        api_f_maxhps: fMaxhps,
        api_e_nowhps: [50],
        api_e_maxhps: [50],
        api_ship_ke: [1501],
        api_hougeki: eflag.length > 0 ? {
            api_at_eflag: eflag,
            api_at_list: atList,
            api_df_list: dfList,
            api_damage: dmgList,
        } : null,
        ...extra,
    };
}

function makeStateWithTwoShips() {
    const state = new GameState();
    state.applyEvent('api_port/port', makePort(
        [makeShip(1, 38, 38), makeShip(2, 66, 66)],
        [[1, 2, -1, -1, -1, -1]],
    ));
    state.applyEvent('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_event_id: 4 }, { api_deck_id: '1' });
    return state;
}

describe('戰鬥扣血起點與階段追蹤（design-guidelines §7.4.1）', () => {
    it('晝戰記錄扣血艦起點、夜戰以夜戰封包重新起算、結算保留、回地圖清除', () => {
        const state = makeStateWithTwoShips();

        // 晝戰：1 號艦 38 → 34（−4），2 號艦無傷（66 → 66）
        state.applyEvent('api_req_sortie/battle', makeSimpleBattle([38, 66], [38, 66], [4, 0]));
        let ships = state.fleets()[0].ships;
        expect(ships[0]).toMatchObject({ hp: 34, maxhp: 38, battleHpStart: 38, battleHpPhase: 'day' });
        expect(ships[1].battleHpStart).toBeUndefined();
        expect(ships[1].battleHpPhase).toBeUndefined();

        // 夜戰接續：1 號艦從 34 再受 −10 → 24，2 號艦無傷
        state.applyEvent('api_req_battle_midnight/battle', makeSimpleNight([34, 66], [38, 66], [10, 0]));
        ships = state.fleets()[0].ships;
        expect(ships[0]).toMatchObject({ hp: 24, maxhp: 38, battleHpStart: 34, battleHpPhase: 'night' });
        expect(ships[1].battleHpStart).toBeUndefined();

        // 結算畫面（battleresult）仍保留灰條與扣血數字
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'A' });
        ships = state.fleets()[0].ships;
        expect(ships[0]).toMatchObject({ hp: 24, battleHpStart: 34, battleHpPhase: 'night' });

        // 回到地圖（ship_deck）立即清除
        state.applyEvent('api_get_member/ship_deck', {
            api_ship_data: [makeShip(1, 24, 38), makeShip(2, 66, 66)],
            api_deck_data: [],
        });
        ships = state.fleets()[0].ships;
        expect(ships[0].battleHpStart).toBeUndefined();
        expect(ships[0].battleHpPhase).toBeUndefined();
    });

    it('晝戰受傷但夜戰未再受傷的艦，進夜戰時清除扣血顯示', () => {
        const state = makeStateWithTwoShips();
        state.applyEvent('api_req_sortie/battle', makeSimpleBattle([38, 66], [38, 66], [4, 0]));
        expect(state.fleets()[0].ships[0].battleHpStart).toBe(38);

        // 夜戰只有 2 號艦受傷，1 號艦未再被打
        state.applyEvent('api_req_battle_midnight/battle', makeSimpleNight([34, 66], [38, 66], [0, 12]));
        const ships = state.fleets()[0].ships;
        expect(ships[0].battleHpStart).toBeUndefined();
        expect(ships[1]).toMatchObject({ hp: 54, battleHpStart: 66, battleHpPhase: 'night' });
    });

    it('samples/61-3.json 真實連合夜戰：主隊清除晝戰扣血，隨伴只看夜戰傷害', () => {
        const sample = JSON.parse(readFileSync(resolve(__dirname, '../samples/61-3.json'), 'utf8'));
        const nodeWithNight = sample.battles.find((b: any) => b.yasen && Object.keys(b.yasen).length > 0);
        expect(nodeWithNight).toBeTruthy();

        const day = nodeWithNight.data;
        const night = nodeWithNight.yasen;
        const mainShips = day.api_f_nowhps.map((hp: number, i: number) => makeShip(101 + i, hp, day.api_f_maxhps[i]));
        const escortShips = day.api_f_nowhps_combined.map((hp: number, i: number) => makeShip(201 + i, hp, day.api_f_maxhps_combined[i]));

        const state = new GameState();
        state.applyEvent('api_port/port', makePort(
            [...mainShips, ...escortShips],
            [mainShips.map((s: any) => s.api_id), escortShips.map((s: any) => s.api_id)],
            1,
        ));
        state.applyEvent('api_req_map/start', { api_maparea_id: 61, api_mapinfo_no: 3, api_no: 1, api_event_id: 4 }, { api_deck_id: '1' });

        // 晝戰：主隊有多艘受傷（例如 2 號艦 83→35）
        state.applyEvent('api_req_combined_battle/ec_battle', day);
        const dayMain = state.fleets()[0].ships;
        expect(dayMain.some(s => s.battleHpStart != null && s.battleHpPhase === 'day')).toBe(true);

        // 進連合夜戰：主隊不參戰且 yasen.api_f_nowhps 已是晝戰後血量，故主隊全清
        state.applyEvent('api_req_combined_battle/ec_midnight_battle', night);
        const nightMain = state.fleets()[0].ships;
        expect(nightMain.every(s => s.battleHpStart === undefined)).toBe(true);
        const nightEscort = state.fleets()[1].ships;
        for (const s of nightEscort) {
            if (s.battleHpStart !== undefined) {
                expect(s.battleHpPhase).toBe('night');
                expect(s.battleHpStart).toBeGreaterThan(s.hp);
            }
        }
    });

    it('階段標籤區分晝戰、夜戰（含開幕夜戰）與拂曉戰（night_to_day／ec_night_to_day）', () => {
        const state = makeStateWithTwoShips();
        state.applyEvent('api_req_sortie/ld_airbattle', makeSimpleBattle([38, 66], [38, 66], [5, 0]));
        expect(state.fleets()[0].ships[0].battleHpPhase).toBe('day');

        state.applyEvent('api_req_battle_midnight/sp_midnight', makeSimpleNight([33, 66], [38, 66], [3, 0]));
        expect(state.fleets()[0].ships[0]).toMatchObject({ hp: 30, battleHpStart: 33, battleHpPhase: 'night' });

        state.applyEvent('api_req_combined_battle/ec_night_to_day', makeSimpleBattle([30, 66], [38, 66], [6, 0]));
        expect(state.fleets()[0].ships[0]).toMatchObject({ hp: 24, battleHpStart: 30, battleHpPhase: 'nightToDay' });
    });

    it('基地空襲 api_destruction_battle（位於 map/next 子欄位）不會寫入艦娘扣血，且 map/next 會清除前戰扣血', () => {
        const state = makeStateWithTwoShips();
        state.applyEvent('api_req_sortie/battle', makeSimpleBattle([38, 66], [38, 66], [4, 0]));
        expect(state.fleets()[0].ships[0].battleHpStart).toBe(38);

        state.applyEvent('api_req_map/next', {
            api_no: 2,
            api_event_id: 4,
            api_destruction_battle: {
                api_f_nowhps: [200, 200, 200],
                api_f_maxhps: [200, 200, 200],
                api_e_nowhps: [100],
                api_e_maxhps: [100],
            },
        });
        const ships = state.fleets()[0].ships;
        expect(ships[0].hp).toBe(34);
        expect(ships[0].battleHpStart).toBeUndefined();
        expect(ships[1].battleHpStart).toBeUndefined();
    });

    it('女神復活至起點以上（扣血 ≤0）與已退避艦都不記錄扣血', () => {
        const state = new GameState();
        // 1 號艦裝応急修理女神（mst 43，slotItem id 501）
        state.applyEvent('api_get_member/require_info', {
            api_slot_item: [{ api_id: 501, api_slotitem_id: 43, api_level: 0 }],
        });
        state.applyEvent('api_port/port', makePort(
            [makeShip(1, 20, 40, [-1, -1, -1, -1], 501), makeShip(2, 30, 40)],
            [[1, 2, -1, -1, -1, -1]],
        ));
        state.applyEvent('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_event_id: 4 }, { api_deck_id: '1' });

        // 1 號艦 20/40 受 25 致命傷 → 女神復活全快至 40/40（40 >= 20 → 不記錄）
        state.applyEvent('api_req_sortie/battle', makeSimpleBattle([20, 30], [40, 40], [25, 22]));
        let ships = state.fleets()[0].ships;
        expect(ships[0].hp).toBe(40);
        expect(ships[0].battleHpStart).toBeUndefined();
        expect(ships[1]).toMatchObject({ hp: 8, battleHpStart: 30, battleHpPhase: 'day' });

        // 2 號艦退避 → goback_port 清空扣血，下一戰退避艦即使封包帶位置也不寫入
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'A', api_escape: { api_escape_idx: [2] } });
        state.applyEvent('api_req_sortie/goback_port', {});
        expect(state.fleets()[0].ships[1].battleHpStart).toBeUndefined();

        state.applyEvent('api_req_sortie/battle', makeSimpleBattle([40, 8], [40, 40], [5, 8]));
        ships = state.fleets()[0].ships;
        expect(ships[0]).toMatchObject({ hp: 35, battleHpStart: 40, battleHpPhase: 'day' });
        expect(ships[1].escaped).toBe(true);
        expect(ships[1].battleHpStart).toBeUndefined();
    });

    it('全部離開戰鬥的端點（ship3／ship2／map/start／combined goback_port／port）皆清除扣血', () => {
        const triggerClear = (clearPath: string, clearApi: any, clearReq?: Record<string, string>) => {
            const state = makeStateWithTwoShips();
            state.applyEvent('api_req_sortie/battle', makeSimpleBattle([38, 66], [38, 66], [4, 0]));
            expect(state.fleets()[0].ships[0].battleHpStart).toBe(38);
            state.applyEvent(clearPath, clearApi, clearReq);
            expect(state.fleets()[0].ships[0].battleHpStart).toBeUndefined();
        };

        triggerClear('api_get_member/ship3', { api_ship_data: [makeShip(1, 34, 38)], api_deck_data: [] });
        triggerClear('api_get_member/ship2', [makeShip(1, 34, 38)]);
        triggerClear('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_event_id: 4 }, { api_deck_id: '1' });
        triggerClear('api_req_combined_battle/goback_port', {});
        triggerClear('api_port/port', makePort([makeShip(1, 34, 38), makeShip(2, 66, 66)], [[1, 2, -1, -1, -1, -1]]));
    });

    it('演習扣血於 battle_result 保留，並與 practiceRealHp 在 practice／port／map/start 三處同步清除', () => {
        const runPracticeAndClear = (clearPath: string, clearApi: any, clearReq?: Record<string, string>) => {
            const state = new GameState();
            state.applyEvent('api_port/port', makePort(
                [makeShip(1, 38, 38), makeShip(2, 66, 66)],
                [[1, 2, -1, -1, -1, -1]],
            ));
            state.applyEvent('api_req_practice/battle', makeSimpleBattle([38, 66], [38, 66], [10, 0]), { api_deck_id: '1' });
            expect(state.fleets()[0].ships[0]).toMatchObject({ hp: 28, battleHpStart: 38, battleHpPhase: 'day' });

            state.applyEvent('api_req_practice/midnight_battle', makeSimpleNight([28, 66], [38, 66], [6, 0]));
            expect(state.fleets()[0].ships[0]).toMatchObject({ hp: 22, battleHpStart: 28, battleHpPhase: 'night' });

            state.applyEvent('api_req_practice/battle_result', { api_win_rank: 'S' });
            expect(state.fleets()[0].ships[0]).toMatchObject({ hp: 22, battleHpStart: 28, battleHpPhase: 'night' });

            state.applyEvent(clearPath, clearApi, clearReq);
            expect(state.fleets()[0].ships[0].battleHpStart).toBeUndefined();
        };

        runPracticeAndClear('api_get_member/practice', { api_list: [{ api_state: 0 }] });
        runPracticeAndClear('api_port/port', makePort([makeShip(1, 38, 38), makeShip(2, 66, 66)], [[1, 2, -1, -1, -1, -1]]));
        runPracticeAndClear('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_event_id: 4 }, { api_deck_id: '1' });
    });

    it('戰鬥中途開啟面板（baseline snapshot＋重放 raw events）可還原扣血起點與階段', () => {
        const portApi = makePort([makeShip(1, 38, 38), makeShip(2, 66, 66)], [[1, 2, -1, -1, -1, -1]]);
        const restored = new GameState();
        applySnapshotBaseline(restored, [{ path: 'api_port/port', ts: 1000, api: portApi, eventId: 1 }]);
        restored.applyEvent('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_event_id: 4 }, { api_deck_id: '1' }, 2000);
        restored.applyEvent('api_req_sortie/battle', makeSimpleBattle([38, 66], [38, 66], [4, 0]), undefined, 3000);

        expect(restored.fleets()[0].ships[0]).toMatchObject({ hp: 34, maxhp: 38, battleHpStart: 38, battleHpPhase: 'day' });
        expect(restored.fleets()[0].ships[1].battleHpStart).toBeUndefined();
    });
});
