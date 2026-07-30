// 輸送TP計算的回歸測試。艦種與裝備 master 均取自真實 start2 fixture，避免手捏
// api_stype／裝備 master id 而把測試本身寫錯。
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const DAIHATSU_VARIANTS = [
    { mst: 68, name: '大発動艇' },
    { mst: 193, name: '特大発動艇' },
    { mst: 166, name: '大発動艇(八九式中戦車&陸戦隊)' },
    { mst: 230, name: '特大発動艇+戦車第11連隊' },
];

interface TestShip { mst: number; gears?: number[] }

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
        return { api_id: index + 1, api_ship_id: ship.mst, api_slot: slots };
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
    for (const gear of DAIHATSU_VARIANTS) {
        expect(master.api_mst_slotitem.find((item: any) => item.api_id === gear.mst)?.api_name).toBe(gear.name);
    }
    expect(master.api_mst_ship.find((ship: any) => ship.api_id === 1)?.api_stype).toBe(2);  // 睦月＝驅逐
    expect(master.api_mst_ship.find((ship: any) => ship.api_id === 21)?.api_stype).toBe(3); // 長良＝輕巡
    expect(master.api_mst_ship.find((ship: any) => ship.api_id === 74)?.api_stype).toBe(7); // 祥鳳＝輕空母
});

describe('輸送TP', () => {
    it.each(DAIHATSU_VARIANTS)('$name（#$mst）每艘為 8 TP', ({ mst }) => {
        expect(stateWithFleet([{ mst: 1, gears: [mst] }]).fleetTP(0)).toEqual({ total: 13, gear: 8 });
    });

    it('未列艦種（輕空母）不提供基本TP', () => {
        expect(stateWithFleet([{ mst: 74 }]).fleetTP(0)).toEqual({ total: 0, gear: 0 });
    });

    it('七船編成：5驅逐＋輕巡＋輕空母、十個大發系裝備＝107 TP', () => {
        const state = stateWithFleet([
            { mst: 1, gears: [68, 68] },
            { mst: 2, gears: [193, 193] },
            { mst: 6, gears: [166, 166] },
            { mst: 7, gears: [230, 230] },
            { mst: 9, gears: [68, 193] },
            { mst: 21 },
            { mst: 74 },
        ]);
        expect(state.fleetTP(0)).toEqual({ total: 107, gear: 80 });
    });
});
