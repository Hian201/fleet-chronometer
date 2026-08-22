import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

/**
 * 基地航空隊中隊格完整保留的行為測試。
 *
 * `set_plane`／`supply` 的回應只帶被更動的中隊；若整排覆蓋，未被更動的中隊會消失，
 * 進而同時影響 `airBases_()` 與 `lbasAirPower()`。
 *
 * 合併時必須依 `api_squadron_id` 更新局部項目並保留其他中隊。
 */

const AREA = 6;
const RID = 1;
/** req 是表單編碼，值一律是字串（`applyEvent` 的 `Record<string, string>`）。 */
const REQ = { api_area_id: String(AREA), api_base_id: String(RID) };

/** 四格中隊：1、2 有機，3、4 未配備。 */
function fourSquadrons() {
    return [
        { api_squadron_id: 1, api_state: 1, api_slotid: 101, api_count: 18, api_max_count: 18, api_cond: 1 },
        { api_squadron_id: 2, api_state: 1, api_slotid: 102, api_count: 9, api_max_count: 18, api_cond: 1 },
        { api_squadron_id: 3, api_state: 0, api_slotid: 0, api_count: 0, api_max_count: 0, api_cond: 1 },
        { api_squadron_id: 4, api_state: 0, api_slotid: 0, api_count: 0, api_max_count: 0, api_cond: 1 },
    ];
}

function stateWithBase() {
    const s = new GameState();
    s.applyEvent('api_get_member/base_air_corps', [{
        api_area_id: AREA, api_rid: RID, api_name: '第一航空隊',
        api_distance: { api_base: 5, api_bonus: 0 },
        api_action_kind: 1,
        api_plane_info: fourSquadrons(),
    }], undefined, 1_726_000_000_000);
    return s;
}

function squadronCount(s: GameState) {
    return s.airBases_()[0].squadrons.length;
}

describe('基地航空隊中隊合併', () => {
    it('基準：完整封包給四格', () => {
        expect(squadronCount(stateWithBase())).toBe(4);
    });

    it('set_plane 只回一個中隊時，其餘三格不得消失', () => {
        const s = stateWithBase();
        s.applyEvent(
            'api_req_air_corps/set_plane',
            {
                api_plane_info: [
                    { api_squadron_id: 2, api_state: 1, api_slotid: 999, api_count: 18, api_max_count: 18, api_cond: 1 },
                ],
                api_distance: { api_base: 5, api_bonus: 0 },
            },
            REQ,
            1_726_000_000_001,
        );
        expect(squadronCount(s)).toBe(4);
        const sq = s.airBases_()[0].squadrons;
        expect(sq[1].slotId).toBe(999);   // 被更動的中隊確實更新
        expect(sq[0].slotId).toBe(101);   // 沒動到的中隊原樣保留
    });

    it('supply 只回被補給的中隊時，其餘格不得消失且機數要更新', () => {
        const s = stateWithBase();
        s.applyEvent(
            'api_req_air_corps/supply',
            {
                api_plane_info: [
                    { api_squadron_id: 2, api_state: 1, api_slotid: 102, api_count: 18, api_max_count: 18, api_cond: 1 },
                ],
            },
            REQ,
            1_726_000_000_002,
        );
        expect(squadronCount(s)).toBe(4);
        expect(s.airBases_()[0].squadrons[1].count).toBe(18);
    });

    it('連續兩次 set_plane（互換位置）後仍是四格', () => {
        const s = stateWithBase();
        
        s.applyEvent('api_req_air_corps/set_plane',
            { api_plane_info: [{ api_squadron_id: 1, api_state: 1, api_slotid: 102, api_count: 9, api_max_count: 18, api_cond: 1 }] },
            REQ, 1_726_000_000_003);
        s.applyEvent('api_req_air_corps/set_plane',
            { api_plane_info: [{ api_squadron_id: 2, api_state: 1, api_slotid: 101, api_count: 18, api_max_count: 18, api_cond: 1 }] },
            REQ, 1_726_000_000_004);
        expect(squadronCount(s)).toBe(4);
        expect(s.airBases_()[0].squadrons.map(q => q.slotId)).toEqual([102, 101, 0, 0]);
    });

    it('回應是完整四格時，合併與覆蓋等價', () => {
        const s = stateWithBase();
        const full = fourSquadrons();
        full[0].api_slotid = 555;
        s.applyEvent('api_req_air_corps/set_plane', { api_plane_info: full },
            REQ, 1_726_000_000_005);
        expect(squadronCount(s)).toBe(4);
        expect(s.airBases_()[0].squadrons[0].slotId).toBe(555);
    });

    it('回應缺 api_squadron_id 時退回整排覆蓋，不猜對位', () => {
        const s = stateWithBase();
        s.applyEvent('api_req_air_corps/set_plane',
            { api_plane_info: [{ api_state: 1, api_slotid: 777, api_count: 18, api_max_count: 18, api_cond: 1 }] },
            REQ, 1_726_000_000_006);
        expect(squadronCount(s)).toBe(1);
    });
});

/**
 * 補給後機數依請求中的基地鍵正確更新。
 *
 * 機數只有 base_air_corps／mapinfo／set_plane／supply 四條路徑會更新——戰鬥封包不帶
 * `api_count`。`api_base_id` 可能逗號分隔，`api_area_id` 也可能缺席；解析器必須逐項解析，
 * 並在無法唯一定位時保留可診斷的結果。
 */
describe('基地航空隊補給的請求解析', () => {
    const supply = (s: GameState, req: Record<string, string>, count = 18) =>
        s.applyEvent('api_req_air_corps/supply', {
            api_plane_info: [
                { api_squadron_id: 2, api_state: 1, api_slotid: 102, api_count: count, api_max_count: 18, api_cond: 1 },
            ],
        }, req, 1_726_000_100_000);

    it('一般形狀：機數更新', () => {
        const s = stateWithBase();
        supply(s, REQ);
        expect(s.airBases_()[0].squadrons[1].count).toBe(18);
    });

    it('api_base_id 是逗號分隔的單一基地時也要套用', () => {
        const s = stateWithBase();
        supply(s, { api_area_id: String(AREA), api_base_id: `${RID},` });
        expect(s.airBases_()[0].squadrons[1].count).toBe(18);
    });

    it('api_area_id 缺席時，rid 唯一就用那一個', () => {
        const s = stateWithBase();
        supply(s, { api_base_id: String(RID) } as Record<string, string>);
        expect(s.airBases_()[0].squadrons[1].count).toBe(18);
    });

    // 多基地一次補給時無法確定 api_plane_info 各屬哪個基地（squadron id 在各基地內都是
    // 1–4），無法唯一對應時保留原機數並記錄 console 警告，不猜。
    it('多個基地一次補給時不亂套用（維持原機數）', () => {
        const s = stateWithBase();
        s.applyEvent('api_get_member/base_air_corps', [{
            api_area_id: AREA, api_rid: RID, api_name: '第一航空隊',
            api_distance: { api_base: 5, api_bonus: 0 }, api_action_kind: 1,
            api_plane_info: fourSquadrons(),
        }, {
            api_area_id: AREA, api_rid: 2, api_name: '第二航空隊',
            api_distance: { api_base: 5, api_bonus: 0 }, api_action_kind: 1,
            api_plane_info: fourSquadrons(),
        }], undefined, 1_726_000_099_000);
        supply(s, { api_area_id: String(AREA), api_base_id: `${RID},2` });
        expect(s.airBases_()[0].squadrons[1].count).toBe(9);
        expect(s.airBases_()[1].squadrons[1].count).toBe(9);
    });
});

// ── 真封包（samples/mapinfo-air-base.json + samples/air-corps-supply.json） ──────
// 2026-08-04 實機擷取。這一組定案了補給路徑的請求／回應形狀：
//   · req  = api_area_id + api_base_id（**單一基地，非逗號分隔**）+ api_squadron_id（逐中隊）
//   · api  = api_plane_info 只帶被補給的那一個中隊，另有 api_after_fuel／api_after_bauxite
// 亦即「回應只回一隊」是常態而非邊角，mergeSquadrons 的存在是必要的。
describe('真封包的基地航空隊補給', () => {
    const mapinfo = JSON.parse(
        readFileSync(new URL('../samples/mapinfo-air-base.json', import.meta.url), 'utf8'));
    const supply = JSON.parse(
        readFileSync(new URL('../samples/air-corps-supply.json', import.meta.url), 'utf8'));

    /** mapinfo 的六隊為 baseline，再把 62-1 的第 4 中隊打成耗損狀態 */
    function stateWithDepleted() {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', mapinfo.api, undefined, 1_785_800_000_000);
        const base = state.airBases.get('62_1');
        base.api_plane_info[3].api_count = 9;
        return state;
    }

    it('真實請求形狀能對到基地，機數更新且其餘中隊不受影響', () => {
        const state = stateWithDepleted();
        expect(state.airBases_().find(b => b.rid === 1 && b.areaId === 62)!.squadrons[3]!.count).toBe(9);

        state.applyEvent('api_req_air_corps/supply', supply.api, supply.req, 1_785_800_060_000);

        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 1)!;
        expect(base.squadrons).toHaveLength(4);
        expect(base.squadrons[3]!.count).toBe(18);
        expect(base.squadrons.map(s => s.slotId)).toEqual([114543, 95035, 117038, 116192]);
    });

    // 補給只補這一隊，別的海域／基地不得被牽動
    it('其他基地完全不受影響', () => {
        const state = stateWithDepleted();
        state.applyEvent('api_req_air_corps/supply', supply.api, supply.req, 1_785_800_060_000);
        for (const ab of state.airBases_().filter(b => !(b.areaId === 62 && b.rid === 1))) {
            expect(ab.squadrons).toHaveLength(4);
            for (const sq of ab.squadrons) expect(sq.count).toBe(sq.maxCount);
        }
    });

    // api_cond 實測值：mapinfo 全 0（全滿）、補給回應為 1（輕度疲勞）。
    // 補給不會消除疲勞——這一隊剛出撃回來，1 是預期中的；遊戲同樣不顯示標記。
    it('補給回應的 api_cond: 1 判為 mild（輕度疲勞、遊戲無標記）', () => {
        const state = stateWithDepleted();
        state.applyEvent('api_req_air_corps/supply', supply.api, supply.req, 1_785_800_060_000);
        const sq = state.airBases_().find(b => b.areaId === 62 && b.rid === 1)!.squadrons[3]!;
        expect(sq.cond).toBe(1);
        expect(state.lbasCondState(sq.cond)).toBe('mild');
    });

    // api_after_fuel／api_after_bauxite 是封包明示的餘額；其餘六項不得被動到
    it('燃料與鋁土餘額就地更新，其餘資材不動', () => {
        const state = stateWithDepleted();
        state.materials = [1, 2, 3, 4, 5, 6, 7, 8];
        state.applyEvent('api_req_air_corps/supply', supply.api, supply.req, 1_785_800_060_000);
        expect(state.materials).toEqual([304968, 2, 3, 316824, 5, 6, 7, 8]);
    });
});
