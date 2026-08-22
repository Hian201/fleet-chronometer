// 出擊當下的「支援艦隊候補（第3/4艦隊）＋基地航空隊」快照（utils/replay.ts）。
// 戰鬥封包的 api_support_info 只給艦實例 id、api_air_base_attack 只給有出擊的那幾波，
// 故這兩份資訊只有在 api_req_map/start 當下拿得到——這支測試把那條界線釘住。
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { repairLegacyReplayFleet, snapshotLbas, startReplay, toKc3Replay } from '../utils/replay';

/** 造一個最小 GameState：四支艦隊 + 兩個海域的基地航空隊。 */
function buildState(): GameState {
    const state = new GameState();
    // 艦與裝備（master 不必載入——快照只存 id 與數值）
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: [
            { api_id: 501, api_slotitem_id: 41, api_level: 3, api_alv: 7 },
            { api_id: 502, api_slotitem_id: 42, api_level: 0, api_alv: 0 },
            { api_id: 503, api_slotitem_id: 68, api_level: 6, api_alv: 0 },
        ],
    });
    const ship = (id: number, mst: number, slot: number[], slotEx = 0) => ({
        api_id: id, api_ship_id: mst, api_lv: 90, api_nowhp: 30, api_maxhp: 30,
        api_cond: 49, api_slot: slot, api_slot_ex: slotEx, api_exp: [0, 0, 0],
    });
    state.applyEvent('api_port/port', {
        api_ship: [
            ship(1, 100, [501], 503),
            ship(2, 200, [502]),
            ship(3, 300, []),
            ship(4, 400, []),
        ],
        api_deck_port: [
            { api_id: 1, api_name: '1', api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_id: 2, api_name: '2', api_ship: [2, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_id: 3, api_name: '3', api_ship: [3, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_id: 4, api_name: '4', api_ship: [4, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
        ],
        api_material: [], api_basic: {}, api_ndock: [],
    });
    state.applyEvent('api_get_member/base_air_corps', [
        {
            api_area_id: 62, api_rid: 1, api_name: '第一', api_action_kind: 1,
            api_distance: { api_base: 7, api_bonus: 1 },
            api_plane_info: [
                { api_squadron_id: 1, api_slotid: 501, api_state: 1, api_count: 18, api_max_count: 18, api_cond: 1 },
                { api_squadron_id: 2, api_slotid: 0, api_state: 0, api_count: 0, api_max_count: 18, api_cond: 1 },
            ],
        },
        {
            api_area_id: 62, api_rid: 2, api_name: '第二', api_action_kind: 2,
            api_distance: { api_base: 4, api_bonus: 0 },
            api_plane_info: [
                { api_squadron_id: 1, api_slotid: 502, api_state: 1, api_count: 9, api_max_count: 18, api_cond: 2 },
            ],
        },
        // 別的海域的基地——出擊到 62 時不該被帶進快照
        {
            api_area_id: 61, api_rid: 1, api_name: '舊', api_action_kind: 1,
            api_distance: { api_base: 5, api_bonus: 0 }, api_plane_info: [],
        },
    ]);
    return state;
}

describe('基地航空隊快照', () => {
    it('只取出擊海域的基地，並解出行動／半徑／中隊機種★熟練', () => {
        const bases = snapshotLbas(buildState(), 62);
        expect(bases.map(b => b.rid)).toEqual([1, 2]);
        expect(bases[0]).toMatchObject({ areaId: 62, action: 1, distance: 8 });
        expect(bases[0].squadrons[0]).toMatchObject({ mst: 41, count: 18, maxCount: 18, stars: 3, ace: 7, state: 1 });
        // 未配置的中隊仍保留一格（少一格與「這格沒放飛機」是兩件事）
        expect(bases[0].squadrons[1]).toMatchObject({ mst: 0, state: 0, maxCount: 18 });
        expect(bases[1]).toMatchObject({ rid: 2, action: 2, distance: 4 });
    });

    it('該海域沒有基地時回空陣列（不回退到別的海域）', () => {
        expect(snapshotLbas(buildState(), 3)).toEqual([]);
    });
});

describe('出擊快照', () => {
    const mapStart = { api_maparea_id: 62, api_mapinfo_no: 3 };

    it('單艦隊出擊：fleet2 為空，第3/4艦隊仍作為支援候補快照', () => {
        const state = buildState();
        const replay = startReplay(state, 10, 1_726_000_000_000, mapStart);
        expect(replay.fleet1.map(s => s.mst_id)).toEqual([100]);
        expect(replay.fleet1[0]).toMatchObject({
            equip: [41], stars: [3], ace: [7],
            exequip: 68, exstars: 6, exace: 0,
        });
        expect(replay.fleet2).toEqual([]);
        expect(replay.fleet3?.map(s => s.mst_id)).toEqual([300]);
        expect(replay.fleet4?.map(s => s.mst_id)).toEqual([400]);
        expect(replay.lbas?.map(b => b.rid)).toEqual([1, 2]);
    });

    it('無補強增設時不寫 exstars／exace（缺席＝不可考，不是 ★0）', () => {
        const state = buildState();
        const replay = startReplay(state, 10, 1_726_000_000_000, mapStart);
        expect(replay.fleet2).toEqual([]);
        expect(replay.fleet3?.[0]).toMatchObject({ exequip: -1 });
        expect(replay.fleet3?.[0]).not.toHaveProperty('exstars');
        expect(replay.fleet3?.[0]).not.toHaveProperty('exace');
    });

    it('連合艦隊出擊：第2艦隊為隨伴，支援候補不變', () => {
        const state = buildState();
        state.combinedFlag = 1;
        const replay = startReplay(state, 11, 1_726_000_000_000, mapStart);
        expect(replay.fleet2.map(s => s.mst_id)).toEqual([200]);
        expect(replay.fleet3?.map(s => s.mst_id)).toEqual([300]);
    });

    it('第一／第二艦隊維持水上打擊編成時，第3艦隊仍記為獨立出擊', () => {
        const state = buildState();
        state.combinedFlag = 2;
        // 實際出擊艦隊以 map/start request 的 api_deck_id 為準（1-based）。
        state.applyEvent('api_req_map/start', mapStart, { api_deck_id: '3' });

        const replay = startReplay(state, 12, 1_726_000_000_000, mapStart);

        expect(replay).toMatchObject({ combined: 0, fleetnum: 3 });
        expect(replay.fleet1.map(s => s.mst_id)).toEqual([300]);
        expect(replay.fleet2).toEqual([]);
    });

    it('既有的錯誤第3艦隊紀錄有完整快照時，在讀取與匯出時安全修復', () => {
        const state = buildState();
        state.combinedFlag = 2;
        // 模擬相容資料：fleetnum 是 3，但 combined/fleet1/fleet2 仍記成水上打擊部隊。
        const legacy = { ...startReplay(state, 13, 1_726_000_000_000, mapStart), fleetnum: 3 };

        const repaired = repairLegacyReplayFleet(legacy);

        expect(repaired).not.toBe(legacy);
        expect(repaired).toMatchObject({ combined: 0, fleetnum: 3 });
        expect(repaired.fleet1.map(s => s.mst_id)).toEqual([300]);
        expect(repaired.fleet2).toEqual([]);
        expect(legacy.combined).toBe(2);                 // 不改動原始資料
        expect(toKc3Replay(legacy)).toMatchObject({ combined: 0, fleetnum: 1, sourceFleetnum: 3 });
    });

    it('舊紀錄缺少第3艦隊完整快照時維持原樣，不猜編成', () => {
        const state = buildState();
        state.combinedFlag = 2;
        const legacy = {
            ...startReplay(state, 14, 1_726_000_000_000, mapStart),
            fleetnum: 3,
            fleet3: undefined,
        };

        expect(repairLegacyReplayFleet(legacy)).toBe(legacy);
    });

    it('沒有第3/4艦隊或基地航空隊時不寫空欄位（缺席＝不可考，不是空陣列）', () => {
        const state = buildState();
        state.decks = state.decks.slice(0, 2);
        state.airBases.clear();
        const replay = startReplay(state, 12, 1_726_000_000_000, mapStart);
        expect(replay).not.toHaveProperty('fleet3');
        expect(replay).not.toHaveProperty('fleet4');
        expect(replay).not.toHaveProperty('lbas');
    });
});
