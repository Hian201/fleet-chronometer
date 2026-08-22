// 輸送TP計算的行為測試。艦種與裝備 master 均取自真實 start2 fixture，避免手捏
// api_stype／裝備 master id 而把測試本身寫錯。
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const DAIHATSU_VARIANTS = [
    { mst: 68, name: '大発動艇', tp: 8 },
    { mst: 166, name: '大発動艇(八九式中戦車&陸戦隊)', tp: 8 },
    { mst: 193, name: '特大発動艇', tp: 8 },
    { mst: 230, name: '特大発動艇+戦車第11連隊', tp: 8 },
    { mst: 355, name: 'M4A1 DD', tp: 8 },
    { mst: 408, name: '装甲艇(AB艇)', tp: 8 },
    { mst: 409, name: '武装大発', tp: 8 },
    { mst: 436, name: '大発動艇(II号戦車/北アフリカ仕様)', tp: 8 },
    { mst: 449, name: '特大発動艇+一式砲戦車', tp: 8 },
    { mst: 482, name: '特大発動艇+Ⅲ号戦車(北アフリカ仕様)', tp: 8 },
    { mst: 494, name: '特大発動艇+チハ', tp: 8 },
    { mst: 495, name: '特大発動艇+チハ改', tp: 8 },
    { mst: 514, name: '特大発動艇+Ⅲ号戦車J型', tp: 8 },
    { mst: 576, name: '大発動艇(R35&フランス兵)', tp: 8 },
];

const TANK_AND_SPECIAL_VARIANTS = [
    { mst: 75, name: 'ドラム缶(輸送用)', tp: 5 },
    { mst: 167, name: '特二式内火艇', tp: 2 },
    { mst: 525, name: '特四式内火艇', tp: 2 },
    { mst: 526, name: '特四式内火艇改', tp: 2 },
    { mst: 145, name: '戦闘糧食', tp: 1 },
    { mst: 150, name: '秋刀魚の缶詰', tp: 1 },
    { mst: 241, name: '戦闘糧食(特別なおにぎり)', tp: 1 },
    { mst: 496, name: '陸軍歩兵部隊', tp: 5 },
    { mst: 497, name: '九七式中戦車(チハ)', tp: 7 },
    { mst: 498, name: '九七式中戦車 新砲塔(チハ改)', tp: 9 },
    { mst: 499, name: '陸軍歩兵部隊+チハ改', tp: 14 },
];

interface TestShip { mst: number; gears?: number[]; exGear?: number }

function stateWithFleet(ships: TestShip[]) {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);

    let nextSlotId = 1;
    const slotItems: any[] = [];
    const apiShips = ships.map((ship, index) => {
        const slots = (ship.gears ?? []).map(mst => {
            const id = nextSlotId++;
            slotItems.push({ api_id: id, api_slotitem_id: mst, api_level: 0, api_alv: 0 });
            return id;
        });
        let exSlotId = -1;
        if (ship.exGear) {
            exSlotId = nextSlotId++;
            slotItems.push({ api_id: exSlotId, api_slotitem_id: ship.exGear, api_level: 0, api_alv: 0 });
        }
        return { api_id: index + 1, api_ship_id: ship.mst, api_slot: slots, api_slot_ex: exSlotId };
    });
    state.applyEvent('api_get_member/require_info', { api_slot_item: slotItems });
    state.applyEvent('api_port/port', {
        api_ship: apiShips,
        api_deck_port: [{ api_ship: apiShips.map(ship => ship.api_id), api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    return state;
}

beforeAll(() => {
    for (const gear of [...DAIHATSU_VARIANTS, ...TANK_AND_SPECIAL_VARIANTS]) {
        expect(master.api_mst_slotitem.find((item: any) => item.api_id === gear.mst)?.api_name).toBe(gear.name);
    }
    expect(master.api_mst_ship.find((ship: any) => ship.api_id === 1)?.api_stype).toBe(2);  // 睦月＝驅逐
    expect(master.api_mst_ship.find((ship: any) => ship.api_id === 21)?.api_stype).toBe(3); // 長良＝輕巡
    expect(master.api_mst_ship.find((ship: any) => ship.api_id === 74)?.api_stype).toBe(7); // 祥鳳＝輕空母
    expect(master.api_mst_ship.find((ship: any) => ship.api_id === 487)?.api_name).toBe('鬼怒改二');
});

describe('輸送TP', () => {
    it.each(DAIHATSU_VARIANTS)('$name（#$mst）每件為 8 TP', ({ mst, tp }) => {
        expect(stateWithFleet([{ mst: 1, gears: [mst] }]).fleetTP(0)).toEqual({ total: 5 + tp, gear: tp });
    });

    it.each(TANK_AND_SPECIAL_VARIANTS)('$name（#$mst）每件為 $tp TP', ({ mst, tp }) => {
        expect(stateWithFleet([{ mst: 1, gears: [mst] }]).fleetTP(0)).toEqual({ total: 5 + tp, gear: tp });
    });

    it('未列艦種（輕空母）不提供基本TP', () => {
        expect(stateWithFleet([{ mst: 74 }]).fleetTP(0)).toEqual({ total: 0, gear: 0 });
    });

    it('鬼怒改二自帶大發效果（+8 TP），素體為 10 TP（輕巡 2 + 固有 8）', () => {
        expect(stateWithFleet([{ mst: 487 }]).fleetTP(0)).toEqual({ total: 10, gear: 8 });
        // 裝備大發後正常疊加
        expect(stateWithFleet([{ mst: 487, gears: [68, 68] }]).fleetTP(0)).toEqual({ total: 26, gear: 24 });
    });

    it('七船 112 TP 出擊組合（酒匂改＋冬月＋天津風＋山風＋梅＋高波＋谷風，含10大發系戰車裝備）', () => {
        const state = stateWithFleet([
            // 酒匂改 Lv97 (CL=2)
            { mst: 314, gears: [118, 262, 413] },
            // 冬月改 Lv96 (DD=5)
            { mst: 538, gears: [533, 533, 500], exGear: 506 },
            // 天津風改二 Lv99 (DD=5, 3大發/戰車=24)
            { mst: 951, gears: [514, 514, 449], exGear: 240 },
            // 山風改二丁 Lv99 (DD=5, 2大發/戰車=16)
            { mst: 667, gears: [482, 449, 438], exGear: 412 },
            // 梅改 Lv99 (DD=5, 3大發/武裝大發=24)
            { mst: 716, gears: [68, 68, 409] },
            // 高波改二 Lv96 (DD=5)
            { mst: 649, gears: [366, 286, 574], exGear: 412 },
            // 谷風丁改 Lv99 (DD=5, 2大發/戰車=16)
            { mst: 559, gears: [230, 495, 262] },
        ]);
        // 艦種 2 + 5*6 = 32
        // 裝備 24 + 16 + 24 + 16 = 80
        // 總和 112 TP
        expect(state.fleetTP(0)).toEqual({ total: 112, gear: 80 });
    });
});
