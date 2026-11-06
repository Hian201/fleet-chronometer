import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const AS_OF = 1_726_000_000_000;

function shipRow(id: number, nowhp: number, maxhp: number, ndockTime: number) {
    return {
        api_id: id, api_ship_id: 2, api_lv: 50, api_nowhp: nowhp, api_maxhp: maxhp, api_cond: 49,
        api_ndock_time: ndockTime, api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1,
    };
}

// 以開發者提供的入渠畫面為準：21/93、19/81、19/48、16/37、30/37… 依耐久比例由低到高。
function portWithDamage() {
    return {
        api_ship: [
            shipRow(1, 30, 37, 2_470_000),
            shipRow(2, 19, 48, 4_710_000),
            shipRow(3, 21, 93, 112_360_000),
            shipRow(4, 16, 37, 7_520_000),
            shipRow(5, 19, 81, 96_010_000),
            shipRow(6, 40, 40, 0),          // 無傷
            shipRow(7, 5, 10, 600_000),     // 入渠中
            shipRow(8, 10, 20, 900_000),    // 與 9 號同比例
            shipRow(9, 5, 10, 300_000),
            shipRow(10, 20, 30, 1_200_000), // 遠征中艦隊
        ],
        api_deck_port: [
            { api_ship: [3, 5, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_ship: [2, 4, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_ship: [10, -1, -1, -1, -1, -1], api_mission: [1, 5, AS_OF + 3_600_000, 0] },
        ],
        api_ndock: [
            { api_id: 1, api_state: 1, api_ship_id: 7, api_complete_time: AS_OF + 600_000 },
            { api_id: 2, api_state: 0, api_ship_id: 0, api_complete_time: 0 },
            { api_id: 3, api_state: -1, api_ship_id: 0, api_complete_time: 0 },
        ],
    };
}

describe('GameState 待修清單', () => {
    it('依耐久比例由低到高排序，排除無傷與入渠中的艦', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portWithDamage(), undefined, AS_OF);
        const rows = state.damagedShips();
        // 同比例（8、9 號同為 50%）在 sort_id 不可考時以艦實例 id 穩定排序。
        expect(rows.map(r => r.id)).toEqual([3, 5, 2, 4, 8, 9, 10, 1]);
        expect(rows.find(r => r.id === 7)).toBeUndefined();
        expect(rows.find(r => r.id === 6)).toBeUndefined();
    });

    it('附上所屬艦隊、遠征狀態與遊戲給的入渠時間', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portWithDamage(), undefined, AS_OF);
        const byId = new Map(state.damagedShips().map(r => [r.id, r]));
        expect(byId.get(3)).toMatchObject({ fleet: 1, onExpedition: false, ndockTime: 112_360_000, hp: 21, maxhp: 93 });
        expect(byId.get(4)).toMatchObject({ fleet: 2, onExpedition: false });
        expect(byId.get(10)).toMatchObject({ fleet: 3, onExpedition: true, ndockTime: 1_200_000 });
        expect(byId.get(1)).toMatchObject({ fleet: null, onExpedition: false });
    });

    it('入渠開始後該艦離開待修清單', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portWithDamage(), undefined, AS_OF);
        state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '1', api_ndock_id: '2', api_highspeed: '0' }, AS_OF + 1_000);
        expect(state.damagedShips().some(r => r.id === 1)).toBe(false);
        expect(state.ndockSlots()[1]).toMatchObject({ id: 2, state: 1, completeAt: AS_OF + 1_000 + 2_470_000 });
    });

    it('渠位列出入渠中、空渠與未開放', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', portWithDamage(), undefined, AS_OF);
        expect(state.ndockSlots()).toEqual([
            { id: 1, state: 1, ship: state.shipName(2), completeAt: AS_OF + 600_000 },
            { id: 2, state: 0, ship: null, completeAt: null },
            { id: 3, state: -1, ship: null, completeAt: null },
        ]);
    });

    it('出擊中艦隊的入渠時間要回港才更新，改給 null；回港後恢復', () => {
        const state = new GameState();
        const port = portWithDamage();
        state.applyEvent('api_port/port', port, undefined, AS_OF);
        state.applyEvent('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1 },
            { api_deck_id: '1', api_maparea_id: '1', api_mapinfo_no: '1' }, AS_OF + 1_000);
        const byId = new Map(state.damagedShips().map(r => [r.id, r]));
        expect(byId.get(3)?.ndockTime).toBeNull();
        expect(byId.get(2)?.ndockTime).toBe(4_710_000);
        state.applyEvent('api_port/port', port, undefined, AS_OF + 2_000);
        expect(state.damagedShips().find(r => r.id === 3)?.ndockTime).toBe(112_360_000);
    });

    it('比例相同時依 api_sort_id 升冪（開發者入渠畫面截圖的金剛級排列）', () => {
        const state = new GameState();
        // sort_id 取自 samples/start2-master.json。
        const mst = [
            [591, '金剛改二丙', 1017], [592, '比叡改二丙', 1027], [954, '榛名改二丙', 1038],
            [85, '霧島', 1041], [694, '霧島改二丙', 1047],
        ] as const;
        state.applyEvent('api_start2/getData', {
            api_mst_ship: mst.map(([id, name, sortId]) => ({
                api_id: id, api_name: name, api_sortno: id, api_sort_id: sortId, api_aftershipid: '0', api_stype: 8,
                api_taik: [80, 99], api_fuel_max: 100, api_bull_max: 100,
            })),
            api_mst_stype: [{ api_id: 8, api_name: '戦艦', api_equip_type: {} }],
            api_mst_slotitem: [],
        }, undefined, AS_OF);
        // 艦實例 id 故意與截圖次序相反（Lv1 霧島最新取得），排序不能依它。
        const owned = [[50, 694], [40, 85], [30, 954], [20, 592], [10, 591]] as const;
        state.applyEvent('api_port/port', {
            api_ship: owned.map(([id, mstId]) => ({ ...shipRow(id, 40, 80, 3_600_000), api_ship_id: mstId })),
            api_deck_port: [{ api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [],
        }, undefined, AS_OF);
        expect(state.damagedShips().map(r => r.name)).toEqual(
            ['金剛改二丙', '比叡改二丙', '榛名改二丙', '霧島', '霧島改二丙'].map(n => state.shipName(mst.find(m => m[1] === n)![0])));
    });
});
