// 裝備圖示與改裝畫面同艦換位的行為測試。
//
// SC 雷達的 master、圖示分類與名稱都來自真實 start2 fixture；不在測試內手捏裝備資料，
// 以免把「資料缺失」誤測成「面板渲染正常」。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const scRadar = master.api_mst_slotitem.find((g: any) => g.api_name.includes('SCレーダー'));
const e27Radar = master.api_mst_slotitem.find((g: any) => g.api_id === 517);
const gunMst = master.api_mst_slotitem.find((g: any) => g.api_name === '41cm連装砲');

function stateWithSlots(
    slots: number[],
    onslot: number[] = [4, 18, 0, 0],
    masterIds: number[] = slots.filter(id => id > 0).map((_, i) => i === 0 ? scRadar.api_id : gunMst.api_id),
) {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: slots.filter(id => id > 0).map((id, i) => ({
            api_id: id, api_slotitem_id: masterIds[i] ?? gunMst.api_id,
            api_level: 0, api_alv: 0,
        })),
    });
    const akashi = master.api_mst_ship.find((m: any) => m.api_id === 182);
    state.applyEvent('api_port/port', {
        api_ship: [{
            api_id: 100, api_ship_id: 182, api_lv: 1, api_exp: [0, 0, 0],
            api_nowhp: akashi.api_taik[0], api_maxhp: akashi.api_taik[0], api_cond: 49,
            api_soku: akashi.api_soku, api_leng: akashi.api_leng,
            api_slot: slots, api_onslot: onslot, api_slot_ex: 0,
            api_kyouka: [0, 0, 0, 0, 0, 0, 0], api_locked: 1, api_sally_area: 0,
            api_karyoku: [0, 0], api_raisou: [0, 0], api_taiku: [0, 0], api_soukou: [0, 0],
            api_taisen: [0, 0], api_kaihi: [0, 0], api_sakuteki: [0, 0], api_lucky: [0, 0],
        }],
        api_deck_port: [{ api_ship: [100, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    return state;
}

describe('裝備位置與面板視圖', () => {
    it('SC 雷達改（後期調整型）沿用通用裝備路徑顯示', () => {
        expect(scRadar.api_id).toBe(574);
        const state = stateWithSlots([9001, 9002, -1, -1]);
        const gear = state.fleets()[0].ships[0].gears[0];
        expect(gear).toMatchObject({
            mst: scRadar.api_id,
            name: scRadar.api_name,
            icon: scRadar.api_type[3],
            cat: 'c-radar',
            type: scRadar.api_type[2],
        });
        expect(state.ownedGears().find(g => g.mst === scRadar.api_id)).toMatchObject({
            name: scRadar.api_name, icon: scRadar.api_type[3], catId: scRadar.api_type[2],
        });
    });

    it('517 與 574 都沿用小型電探的通用 master／圖示路徑', () => {
        expect(e27Radar.api_id).toBe(517);
        expect(e27Radar.api_type).toEqual(scRadar.api_type);
        const state = stateWithSlots([9101, 9102, -1, -1], [4, 18, 0, 0], [e27Radar.api_id, scRadar.api_id]);
        const gears = state.fleets()[0].ships[0].gears;

        expect(gears[0]).toMatchObject({
            mst: e27Radar.api_id,
            name: e27Radar.api_name,
            icon: e27Radar.api_type[3],
            cat: 'c-radar',
            type: e27Radar.api_type[2],
        });
        expect(gears[1]).toMatchObject({
            mst: scRadar.api_id,
            icon: scRadar.api_type[3],
            cat: 'c-radar',
            type: scRadar.api_type[2],
        });
        expect(state.ownedGears().map(g => g.mst)).toEqual([e27Radar.api_id, scRadar.api_id]);
    });

    it('編成局部快照缺 api_ship_id 時不覆蓋完整艦資料，且 api_slot_data 不寫裝備庫', () => {
        const state = stateWithSlots([9202, -1, -1, -1], [4, 0, 0, 0], [scRadar.api_id]);
        const originalShip = state.ships.get(100);
        const beforeGear = state.slotItems.get(9202);
        state.applyEvent('api_get_member/ship_deck', {
            // 只有 id 的局部物件不能覆蓋掉 HP／裝備欄等完整資料。
            api_ship_data: [{ api_id: 100 }],
            api_slot_data: [{
                api_id: '9202', api_slotitem_id: String(scRadar.api_id),
                api_level: '2', api_alv: '1',
            }],
        });
        expect(state.ships.get(100)).toBe(originalShip);
        // KC3Kai：api_slot_data＝unsetslot，不是裝備實例刷新
        expect(state.slotItems.get(9202)).toEqual(beforeGear);
    });

    it('ship_deck 帶完整 api_ship_data 時合併艦資料與艦隊', () => {
        const state = stateWithSlots([9202, -1, -1, -1], [4, 0, 0, 0], [scRadar.api_id]);
        state.applyEvent('api_get_member/ship_deck', {
            api_ship_data: [{
                api_id: 100, api_ship_id: 1, api_slot: [9202, -1, -1, -1],
                api_nowhp: 25, api_maxhp: 30, api_fuel: 10, api_bull: 10,
                api_lv: 50, api_cond: 40, api_onslot: [0, 0, 0, 0],
            }],
            api_deck_data: [{ api_ship: [100, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        });
        expect(state.ships.get(100)?.api_nowhp).toBe(25);
        expect(state.decks[0].api_ship[0]).toBe(100);
    });

    it('只有未確認語意的任務獎勵 api_bounus 不會被誤當裝備實例', () => {
        const state = stateWithSlots([-1, -1, -1, -1]);
        state.applyEvent('api_req_quest/clearitemget', {
            api_bounus: [{ api_type: 12, api_id: e27Radar.api_id, api_count: 1 }],
        }, { api_quest_id: '9999' });
        expect(state.slotItems.size).toBe(0);
    });

    it('回應缺 api_ship_data 時不猜索引語意，等待後續完整快照校正', () => {
        const state = stateWithSlots([9001, 9002, -1, -1]);
        state.applyEvent('api_req_kaisou/slot_exchange_index', { api_result: 1 }, {
            api_id: '100', api_src_idx: '0', api_dst_idx: '1',
        });

        const ship = state.ships.get(100);
        expect(ship.api_slot).toEqual([9001, 9002, -1, -1]);
        expect(ship.api_onslot).toEqual([4, 18, 0, 0]);
        expect(state.fleets()[0].ships[0].gears.map(g => g?.mst ?? 0)).toEqual([
            scRadar.api_id, gunMst.api_id, 0,
        ]);
    });

    it('回應的 api_id 與請求對不上時不改動既有投影', () => {
        const state = stateWithSlots([9001, 9002, -1, -1]);
        state.applyEvent('api_req_kaisou/slot_exchange_index', {
            api_ship_data: { api_id: 999, api_slot: [9002, 9001, -1, -1], api_onslot: [18, 4, 0, 0] },
        }, { api_id: '100', api_src_idx: '0', api_dst_idx: '1' });
        expect(state.ships.get(100).api_slot).toEqual([9001, 9002, -1, -1]);
    });

    it('拖曳交換槽位（api_req_kaisou/slot_exchange_index）用回應的完整 api_ship_data 整艦覆蓋，槽位與其餘欄位一併同步', () => {
        const state = stateWithSlots([9001, 9002, -1, -1]);
        const before = state.fleets()[0].ships[0].gears.map(g => g?.mst ?? 0);
        expect(before).toEqual([scRadar.api_id, gunMst.api_id, 0]);

        // 已用真封包驗證（samples/slot-exchange-index.json）：回應的 api_ship_data 是
        // 完整艦快照（與 api_port/port 單艦記錄同形），不是只帶 slot/onslot 的局部物件，
        // 故這裡也給一份完整快照（保留 HP/cond，僅槽位與搭載數對調），驗證整艦覆蓋
        // 沒有把其餘欄位（例如 HP）意外洗掉。
        state.applyEvent('api_req_kaisou/slot_exchange_index', {
            api_ship_data: {
                api_id: 100, api_ship_id: 182, api_lv: 1, api_exp: [0, 0, 0],
                api_nowhp: 32, api_maxhp: 32, api_cond: 49, api_soku: 5, api_leng: 2,
                api_slot: [9002, 9001, -1, -1], api_onslot: [18, 4, 0, 0], api_slot_ex: 0,
                api_kyouka: [0, 0, 0, 0, 0, 0, 0], api_locked: 1, api_sally_area: 0,
                api_karyoku: [0, 0], api_raisou: [0, 0], api_taiku: [0, 0], api_soukou: [0, 0],
                api_taisen: [0, 0], api_kaihi: [0, 0], api_sakuteki: [0, 0], api_lucky: [0, 0],
            },
        }, { api_id: '100', api_src_idx: '0', api_dst_idx: '1' });

        const ship = state.ships.get(100);
        expect(ship.api_slot).toEqual([9002, 9001, -1, -1]);
        expect(ship.api_onslot).toEqual([18, 4, 0, 0]);
        expect(ship.api_nowhp).toBe(32);   // 整艦覆蓋沒有把其餘欄位洗掉
        expect(state.fleets()[0].ships[0].gears.map(g => g?.mst ?? 0)).toEqual([
            gunMst.api_id, scRadar.api_id, 0,
        ]);
    });

    it('拖曳交換槽位：直接餵真封包樣本（samples/slot-exchange-index.json）跑一遍完整解析', () => {
        const samples = JSON.parse(
            readFileSync(new URL('../samples/slot-exchange-index.json', import.meta.url), 'utf8'));
        const state = new GameState();
        state.applyEvent('api_start2/getData', master);
        // 樣本艦（api_ship_id 297）不在測試用的最小艦隊裡，直接把樣本的初始 api_slot
        // （逆操作那筆，src/dst_idx=0/3 的結果即為第一筆套用前的原始排列）灌成起始狀態。
        state.applyEvent('api_port/port', {
            api_ship: [{
                api_id: 69, api_ship_id: 297, api_lv: 98, api_exp: [923482, 76518, 48],
                api_nowhp: 1, api_maxhp: 58, api_cond: 80, api_soku: 10, api_leng: 1,
                api_slot: [69693, 98825, 86404, 116473, -1], api_onslot: [24, 16, 11, 8, 0],
                api_slot_ex: 1151, api_kyouka: [34, 0, 42, 33, 0, 0, 0],
                api_locked: 1, api_sally_area: 4,
                api_karyoku: [37, 34], api_raisou: [23, 0], api_taiku: [121, 72],
                api_soukou: [66, 65], api_taisen: [11, 0], api_kaihi: [74, 69],
                api_sakuteki: [86, 79], api_lucky: [13, 59],
            }],
            api_deck_port: [{ api_ship: [69, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
        });

        const [first, second] = samples;
        state.applyEvent('api_req_kaisou/slot_exchange_index', first.api, first.req);
        expect(state.ships.get(69).api_slot).toEqual([116473, 98825, 86404, 69693, -1]);

        state.applyEvent('api_req_kaisou/slot_exchange_index', second.api, second.req);
        expect(state.ships.get(69).api_slot).toEqual([69693, 98825, 86404, 116473, -1]);
        // 兩筆是互為逆操作的交換，來回一趟後應完全還原成原始排列。
        expect(state.ships.get(69).api_onslot).toEqual([24, 16, 11, 8, 0]);
    });
});
