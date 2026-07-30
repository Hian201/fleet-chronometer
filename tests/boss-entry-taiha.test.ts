// `GameState.bossEntryTaiha`：抵達 boss 節點當下有沒有大破艦。
//
// 面板用它決定大破警告要不要展開成遮蔽式大框——**只是版面決策，與大破判定無關**：
// boss 是最後一個節點，之後沒有節點可以進擊，使用者沒有「要不要進擊」要決定，故一條
// banner 就夠（警告本身照樣顯示）。不展開**不代表大破無害**：大破進王一樣會被轟沈。
// 而「帶著傷進 boss」是玩家自己冒的險，那種情況警告要照舊大聲講。
//
// 三個要鎖住的性質：
//   1. **拍照時機是抵達的那一刻**（map/start・map/next），boss 戰打完的血量不能污染它。
//   2. **同一次出擊只拍一次**，之後的封包不覆寫。
//   3. **未知（null）不等於安全**——沒看到抵達那一步就不給答案，由呼叫端保守處理。
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const MST = 1;

function master() {
    return {
        api_mst_ship: [{
            api_id: MST, api_name: '吹雪', api_sortno: 1, api_aftershipid: '0', api_stype: 2,
            api_taik: [30, 39], api_fuel_max: 15, api_bull_max: 15,
        }],
        api_mst_stype: [{ api_id: 2, api_name: '駆逐艦', api_equip_type: {} }],
        api_mst_slotitem: [],
    };
}

/** 六艘一隊；`hps` 指定各艘的現在 HP（最大值固定 30，故 <=7 即大破）。 */
function port(hps: number[], deckCount = 1) {
    const ids = hps.map((_, i) => 101 + i);
    return {
        api_ship: hps.map((hp, i) => ({
            api_id: ids[i], api_ship_id: MST, api_lv: 20, api_nowhp: hp, api_maxhp: 30,
            api_cond: 49, api_slot: [-1, -1, -1, -1], api_slot_ex: 0,
            api_fuel: 15, api_bull: 15, api_onslot: [], api_soku: 10,
            api_ndock_time: 0, api_exp: [0, 0, 0],
        })),
        api_deck_port: Array.from({ length: deckCount }, (_, d) => ({
            api_ship: ids.slice(d * 6, d * 6 + 6).concat([-1, -1, -1, -1, -1, -1]).slice(0, 6),
            api_mission: [0, 0, 0, 0],
        })),
        api_material: [0, 0, 0, 0, 0, 0, 0, 0],
        api_ndock: [],
        api_basic: {},
    };
}

/** 出擊到第 1 艦隊；`node` 為抵達節點的 `api_color_no`（5＝boss）。 */
function sortie(s: GameState, startColor = 1) {
    s.applyEvent('api_req_map/start',
        { api_maparea_id: 62, api_mapinfo_no: 1, api_no: 1, api_color_no: startColor },
        { api_deck_id: '1' }, 1_726_000_000_100);
}
const nextNode = (s: GameState, no: number, color: number, ts: number) =>
    s.applyEvent('api_req_map/next', { api_no: no, api_color_no: color }, undefined, ts);

function stateWith(hps: number[], deckCount = 1) {
    const s = new GameState();
    s.applyEvent('api_start2/getData', master(), undefined, 1_726_000_000_000);
    s.applyEvent('api_port/port', port(hps, deckCount), undefined, 1_726_000_000_001);
    return s;
}

const HEALTHY = [30, 30, 30, 30, 30, 30];
/** 3 號艦大破（7/30 ≤ 25%）。 */
const ONE_TAIHA = [30, 30, 7, 30, 30, 30];

describe('bossEntryTaiha', () => {
    it('出擊起始為 null（還沒踏進 boss 節點）', () => {
        const s = stateWith(HEALTHY);
        sortie(s);
        expect(s.bossEntryTaiha).toBeNull();
    });

    it('全員健康時進 boss → false', () => {
        const s = stateWith(HEALTHY);
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(false);
    });

    it('帶著大破艦進 boss → true', () => {
        const s = stateWith(ONE_TAIHA);
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(true);
    });

    it('非 boss 節點不拍照，維持 null', () => {
        const s = stateWith(ONE_TAIHA);
        sortie(s);
        nextNode(s, 2, 4, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBeNull();
    });

    it('起始節點就是 boss（1 節點海域）也會拍到', () => {
        const s = stateWith(ONE_TAIHA);
        sortie(s, 5);
        expect(s.bossEntryTaiha).toBe(true);
    });

    it('拍過就不再覆寫——boss 戰打完的血量不污染答案', () => {
        const s = stateWith(HEALTHY);
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(false);
        // boss 戰把 3 號艦打成大破後，答案仍是「進來時沒有大破」。
        s.applyEvent('api_port/port', port(ONE_TAIHA), undefined, 1_726_000_000_300);
        nextNode(s, 3, 5, 1_726_000_000_400);
        expect(s.bossEntryTaiha).toBe(false);
    });

    it('新的出擊重新歸零', () => {
        const s = stateWith(ONE_TAIHA);
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(true);
        sortie(s);
        expect(s.bossEntryTaiha).toBeNull();
    });

    it('已退避的大破艦不算——它已經離開艦隊', () => {
        const s = stateWith(ONE_TAIHA);
        sortie(s);
        s.escapedShipIds.add(103);   // 3 號艦（大破那艘）
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(false);
    });

    it('中破不算大破（門檻是 25%）', () => {
        const s = stateWith([30, 30, 8, 30, 30, 30]);   // 8/30 > 25%
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(false);
    });

    it('已沉沒（HP 0）不算大破', () => {
        const s = stateWith([30, 30, 0, 30, 30, 30]);
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(false);
    });

    it('連合艦隊：隨伴（第2艦隊）的大破也要算進去', () => {
        const s = new GameState();
        s.applyEvent('api_start2/getData', master(), undefined, 1_726_000_000_000);
        // 第1隊全健康、第2隊 3 號艦大破；連合艦隊出擊時兩隊都進去。
        s.applyEvent('api_port/port', {
            ...port([...HEALTHY, ...ONE_TAIHA], 2), api_combined_flag: 2,
        }, undefined, 1_726_000_000_001);
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(true);
    });

    it('非連合出擊時，別隊的大破不算（只看出擊那一隊）', () => {
        const s = stateWith([...HEALTHY, ...ONE_TAIHA], 2);   // combinedFlag 預設 0
        sortie(s);
        nextNode(s, 2, 5, 1_726_000_000_200);
        expect(s.bossEntryTaiha).toBe(false);
    });
});
