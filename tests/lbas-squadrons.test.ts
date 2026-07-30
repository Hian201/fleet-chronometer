import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

/**
 * 基地航空隊中隊格消失的回歸測試。
 *
 * 症狀（實機回報）：補給完只剩一架飛機格；出擊前換飛機四格變兩格甚至一格；
 * 陸航飛機互換位置同樣不正常；回母港才會恢復。制空與格數一起錯，因為
 * `airBases_()` 與 `lbasAirPower()` 都直接讀 `ab.api_plane_info`。
 *
 * 根因：`set_plane`／`supply` 的回應只帶被更動的中隊，舊寫法整排覆蓋。
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
