// 出擊途中的艦載機戰損（估算）回歸測試。
//
// 實機回報：出擊中船艦的搭載數不會隨戰鬥遞減，要回母港才更新。原因是遊戲的戰鬥封包
// **只給整場合計損失機數**（api_stage1／api_stage2 的 api_f_lostcount），沒有任何逐格
// 殘量欄位，而 api_onslot 先前只在 api_port/port 與 api_req_hokyu/charge 被更新。
//
// 故本檔鎖住的是「估算的行為契約」：
//   ・可辨識搭載池足夠時，合計扣除量等於封包給的損失數（合計是封包事實，不容打折）
//   ・搭載池不足或為零時不猜未知格，並留下診斷訊號
//   ・只攤到參戰的艦載機格（偵察機／對潛機不參戰，不分攤）
//   ・不會把某一格扣成負數；扣不下的餘額順延給其他格
//   ・出擊／回港重置估算標記（回港的 api_port/port 帶實數，那一刻起又是封包事實）
// **逐格分配是永久估算**（wikiwiki「航空戰」為逐格獨立亂數，封包只有合計，無法反推），
// 故此處只斷言合計與邊界，不鎖特定分配。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GameState } from '../utils/state';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const SHOUHOU = 74;     // 祥鳳（軽空母、maxeq [18, 9, 3]）
const MUTSUKI = 1;      // 睦月（駆逐、無搭載格）
const FIGHTER = 20;     // 零式艦戦21型（api_type[2]=6 艦戦）
const TORPEDO_BOMBER = 16;  // 九七式艦攻（api_type[2]=8 艦攻）
const RECON = 25;       // 零式水上偵察機（api_type[2]=10 水偵，不參與航空戰）

interface TestShip { mst: number; gears?: number[]; onslot?: number[] }

function stateWithFleets(fleets: TestShip[][], combinedFlag = 0) {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    let nextShipId = 1, nextSlotId = 1;
    const slotItems: any[] = [];
    const apiShips: any[] = [];
    const decks = fleets.map(ships => {
        const ids = ships.map(ship => {
            const slots = (ship.gears ?? []).map(mst => {
                const id = nextSlotId++;
                slotItems.push({ api_id: id, api_slotitem_id: mst, api_level: 0, api_alv: 0 });
                return id;
            });
            const id = nextShipId++;
            apiShips.push({
                api_id: id, api_ship_id: ship.mst, api_slot: slots, api_slot_ex: 0,
                api_lv: 1, api_nowhp: 40, api_maxhp: 40, api_cond: 49,
                api_onslot: ship.onslot ?? slots.map(() => 18), api_soku: 10,
                api_fuel: 15, api_bull: 15, api_sakuteki: [10],
            });
            return id;
        });
        return { api_ship: ids, api_mission: [0, 0, 0, 0] };
    });
    state.applyEvent('api_get_member/require_info', { api_slot_item: slotItems });
    state.applyEvent('api_port/port', {
        api_ship: apiShips, api_deck_port: decks,
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0,
        api_combined_flag: combinedFlag,
    });
    return state;
}

function sortie(state: GameState, deckId = 1) {
    state.applyEvent('api_req_map/start',
        { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_color_no: 1 },
        { api_deck_id: String(deckId) });
}

/** 帶航空戰的最小戰鬥封包：stage1 制空戰損失 + stage2 對空砲火損失。 */
function airBattle(stage1Lost: number, stage2Lost = 0, extra: Record<string, unknown> = {}) {
    return {
        api_f_nowhps: [40], api_f_maxhps: [40],
        api_e_nowhps: [90], api_e_maxhps: [90],
        api_ship_ke: [1501],
        api_kouku: {
            api_stage1: { api_f_count: 40, api_f_lostcount: stage1Lost, api_e_count: 30, api_e_lostcount: 0, api_disp_seiku: 1 },
            api_stage2: { api_f_count: 20, api_f_lostcount: stage2Lost, api_e_count: 10, api_e_lostcount: 0 },
        },
        ...extra,
    };
}

/** 出擊艦隊所有艦的搭載數合計。 */
function totalOnslot(state: GameState, fleet = 0) {
    return state.fleets()[fleet].ships
        .flatMap(s => s.gears)
        .reduce((n, g) => n + (g?.count ?? 0), 0);
}

/**
 * 一個節點打完：戰鬥封包＋結算。**戰損要等結算才寫回**（與燃彈同一個 pattern，見
 * GameState.pendingPlaneLoss）——交戰途中的制空必須維持交戰當下的值，故單送戰鬥封包
 * 不會改變任何搭載數。想驗「途中不動」的測試才刻意只送戰鬥封包。
 */
function fightNode(state: GameState, api: Record<string, unknown>, combined = false) {
    state.applyEvent(combined ? 'api_req_combined_battle/battle' : 'api_req_sortie/battle', api);
    state.applyEvent(combined ? 'api_req_combined_battle/battleresult' : 'api_req_sortie/battleresult',
        { api_win_rank: 'S' });
}

describe('出擊途中的艦載機戰損（估算）', () => {
    it('合計扣除量等於封包給的損失數（制空戰＋對空砲火兩段都算）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER, TORPEDO_BOMBER] }]]);
        sortie(state);
        const before = totalOnslot(state);
        fightNode(state, airBattle(5, 3));
        expect(totalOnslot(state)).toBe(before - 8);
    });

    it('不必回母港就看得到（此前 api_onslot 只在母港／補給封包更新）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        fightNode(state, airBattle(4));
        expect(state.fleets()[0].ships[0].gears[0]!.count).toBe(14);
    });

    // 與燃彈同一個 pattern（pendingConsumption）：戰鬥封包只累積，結算才寫回。
    // **交戰途中的制空必須維持交戰當下的值** —— 打到一半就把機數扣掉，等於在戰鬥中
    // 顯示一個「這場其實沒有用到」的制空值。別改回戰鬥封包當場扣。
    it('交戰途中不扣：搭載數與制空維持交戰當下的值，結算才更新', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        const air = state.airPower(0);
        state.applyEvent('api_req_sortie/battle', airBattle(4));
        expect(state.fleets()[0].ships[0].gears[0]!.count).toBe(18);   // 途中不動
        expect(state.airPower(0)).toEqual(air);                         // 制空也不動
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' });
        expect(state.fleets()[0].ships[0].gears[0]!.count).toBe(14);   // 結算才扣
        expect(state.airPower(0).min).toBeLessThan(air.min);
    });

    it('同節點多段航空戰在結算時逐段套用，合計仍等於封包損失數', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER, TORPEDO_BOMBER] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(3));
        state.applyEvent('api_req_battle_midnight/battle', {
            api_f_nowhps: [40], api_f_maxhps: [40],
            api_e_nowhps: [90], api_e_maxhps: [90], api_ship_ke: [1501],
        });
        expect(totalOnslot(state)).toBe(36);   // 晝夜都打完了仍未結算 → 不動
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' });
        expect(totalOnslot(state)).toBe(36 - 3);
    });

    it('搭載數標記為估算值，回港由母港封包實數校正後解除', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        fightNode(state, airBattle(4));
        expect(state.fleets()[0].ships[0].gears[0]!.countEst).toBe(true);
        state.applyEvent('api_port/port', {
            api_ship: [{
                api_id: 1, api_ship_id: SHOUHOU, api_slot: [1], api_slot_ex: 0,
                api_lv: 1, api_nowhp: 40, api_maxhp: 40, api_cond: 49,
                api_onslot: [12], api_fuel: 15, api_bull: 15, api_sakuteki: [10],
            }],
            api_deck_port: [{ api_ship: [1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0,
        });
        const gear = state.fleets()[0].ships[0].gears[0]!;
        expect(gear.count).toBe(12);
        expect(gear.countEst).toBeFalsy();
    });

    it('偵察機格不參與航空戰，不分攤損失', () => {
        // 祥鳳 1 格水偵、2 格艦戰：損失只能從艦戰格出
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [RECON, FIGHTER] }]]);
        sortie(state);
        fightNode(state, airBattle(6));
        const [recon, fighter] = state.fleets()[0].ships[0].gears;
        expect(recon!.count).toBe(18);          // 原樣不動
        expect(fighter!.count).toBe(18 - 6);
    });

    it('損失超過全艦隊搭載數時只扣到 0，不會出現負數', () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER], onslot: [3] }]]);
        sortie(state);
        fightNode(state, airBattle(99));
        expect(state.fleets()[0].ships[0].gears[0]!.count).toBe(0);
        expect(warning).toHaveBeenCalledWith(
            '[KC-Monitor] 艦載機損失超過可辨識的參戰搭載數', { total: 99, pool: 3 },
        );
        warning.mockRestore();
    });

    it('有損失但沒有可辨識的參戰搭載格時不靜默略過', () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [RECON] }]]);
        sortie(state);
        fightNode(state, airBattle(4));
        expect(state.fleets()[0].ships[0].gears[0]!.count).toBe(18);
        expect(warning).toHaveBeenCalledWith(
            '[KC-Monitor] 找不到可分攤艦載機損失的參戰搭載格', { total: 4, pool: 0 },
        );
        warning.mockRestore();
    });

    it('單格扣不下的餘額順延給其他格，合計仍等於損失數', () => {
        // 兩格：一格只剩 1 架、一格 18 架。合計損失 10 架必須全數扣掉。
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER, TORPEDO_BOMBER], onslot: [1, 18] }]]);
        sortie(state);
        fightNode(state, airBattle(10));
        expect(totalOnslot(state)).toBe(19 - 10);
        expect(state.fleets()[0].ships[0].gears.every(g => (g?.count ?? 0) >= 0)).toBe(true);
    });

    it('沒有航空戰的節點（無 api_kouku）不動搭載數', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        fightNode(state, {
            api_f_nowhps: [40], api_f_maxhps: [40],
            api_e_nowhps: [90], api_e_maxhps: [90], api_ship_ke: [1501],
        });
        expect(state.fleets()[0].ships[0].gears[0]!.count).toBe(18);
    });

    it('夜戰接續重放晝戰封包不會重複扣（只吃當下這一則封包）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(4));
        state.applyEvent('api_req_battle_midnight/battle', {
            api_f_nowhps: [40], api_f_maxhps: [40],
            api_e_nowhps: [90], api_e_maxhps: [90], api_ship_ke: [1501],
        });
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' });
        expect(state.fleets()[0].ships[0].gears[0]!.count).toBe(14);
    });

    it('噴式強襲與二巡航空戰各自結算，三段損失都算', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER, TORPEDO_BOMBER] }]]);
        sortie(state);
        const stage = (lost: number) => ({
            api_stage1: { api_f_count: 40, api_f_lostcount: lost, api_e_count: 30, api_e_lostcount: 0, api_disp_seiku: 1 },
        });
        fightNode(state, airBattle(2, 0, {
            api_injection_kouku: stage(1), api_kouku2: stage(3),
        }));
        expect(totalOnslot(state)).toBe(36 - 6);
    });

    it('連合艦隊：隨伴（第2艦隊）的艦載機也一起分攤', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI }, { mst: MUTSUKI }],
            [{ mst: MUTSUKI }, { mst: SHOUHOU, gears: [FIGHTER] }],
        ], 1);
        sortie(state);
        fightNode(state, {
            ...airBattle(5),
            api_f_nowhps_combined: [40, 40], api_f_maxhps_combined: [40, 40],
        }, true);
        expect(state.fleets()[1].ships[1].gears[0]!.count).toBe(13);
    });

    it('已退避艦不分攤（已離開艦隊）', () => {
        const state = stateWithFleets([[
            { mst: MUTSUKI }, { mst: SHOUHOU, gears: [FIGHTER] }, { mst: SHOUHOU, gears: [FIGHTER] },
        ]]);
        sortie(state);
        state.applyEvent('api_req_combined_battle/battleresult', {
            api_win_rank: 'B', api_escape: { api_escape_idx: [2], api_tow_idx: [] },
        });
        state.applyEvent('api_req_combined_battle/goback_port', {});
        fightNode(state, airBattle(6));
        const ships = state.fleets()[0].ships;
        expect(ships[1].gears[0]!.count).toBe(18);        // 退避艦原樣不動
        expect(ships[2].gears[0]!.count).toBe(18 - 6);    // 損失全落在留下來的那艘
    });

    it('制空跟著搭載數一起掉（airPower 讀的就是 api_onslot）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        const before = state.airPower(0);
        fightNode(state, airBattle(9));
        const after = state.airPower(0);
        expect(after.min).toBeLessThan(before.min);
        expect(after.max).toBeLessThan(before.max);
    });

    it('下次出擊重置估算標記', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        fightNode(state, airBattle(4));
        expect(state.fleets()[0].ships[0].gears[0]!.countEst).toBe(true);
        sortie(state);
        expect(state.fleets()[0].ships[0].gears[0]!.countEst).toBeFalsy();
    });
});

// 制空公式本身（`airPower()`）。**這一組存在的理由**：熟練度過時的問題容易被誤讀成
// 「公式沒算熟練度」，其實公式一直都是照遊戲機制算的，缺的只是輸入值 alv。
//
//   單格制空 = floor(對空 × √搭載數 + 機種類型加成 + √(內部熟練度 / 10))
//   ・小數在單格計算過程中全程保留，**只在該格算完才捨去**（每格可能因此多出 1 制空）
//   ・機種類型加成：戰鬥機系 [0,0,2,5,9,14,14,22]、水爆 [0,0,1,1,1,3,3,6]、
//     艦攻／艦爆為 0（但 √(內部熟練度/10) 這一項照樣有，故仍最多 +3）
//   ・內部熟練度看不到實際值，只看得到 0-7 的階級，故一律回 min~max 區間
//     （階級 n 的內部值域 [EXP_LO[n], EXP_HI[n]]）
const AA10_FIGHTER = 22;   // 試製烈風 後期型（對空 10、艦戰）＝與 wiki 例題同素質
describe('制空公式（airPower）', () => {
    it('wiki 例題：對空10 的艦戰、24 搭載、熟練 >>（內部100）→ 74', () => {
        // 10×√24 ＋ 22 ＋ √(100/10) ＝ 48.98… ＋ 22 ＋ 3.16… ＝ 74.15… → 74
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [AA10_FIGHTER], onslot: [24] }]]);
        state.applyEvent('api_get_member/slot_item',
            [{ api_id: 1, api_slotitem_id: AA10_FIGHTER, api_level: 0, api_alv: 7 }]);
        // min＝內部熟練度取階級下限 100（即例題的條件）；上限 120 則多 0.3 → 仍是 74
        expect(state.airPower(0).min).toBe(74);
    });

    it('小數只在每格算完才捨去（先捨去會少 1 制空）', () => {
        // 10×√8 ＝ 28.28…；先捨去成 28 再加 2 會得 30，正確做法是 28.28+2+1.58=31.8→31
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [AA10_FIGHTER], onslot: [8] }]]);
        state.applyEvent('api_get_member/slot_item',
            [{ api_id: 1, api_slotitem_id: AA10_FIGHTER, api_level: 0, api_alv: 2 }]);
        expect(state.airPower(0).min).toBe(31);
    });

    it('熟練度掉一階，制空跟著掉（公式一直都吃 alv，缺的只是新的 alv）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [AA10_FIGHTER], onslot: [24] }]]);
        const at = (alv: number) => {
            state.applyEvent('api_get_member/slot_item',
                [{ api_id: 1, api_slotitem_id: AA10_FIGHTER, api_level: 0, api_alv: alv }]);
            return state.airPower(0).min;
        };
        expect(at(7)).toBe(74);
        expect(at(6)).toBeLessThan(74);
        expect(at(0)).toBe(48);   // 10×√24 ＝ 48.98… → 48（無任何熟練度加成）
    });
});

// 熟練度（api_alv）過時旗標。艦載機被擊墜後熟練度會下降、制空跟著掉，但**沒有任何
// 出擊中／回港的封包帶熟練度**——本檔就是把這個限制與「誠實標示」的行為鎖住。
describe('熟練度過時旗標（alvStale）', () => {
    const gear = (id: number, mst: number, alv: number) =>
        ({ api_id: id, api_slotitem_id: mst, api_level: 0, api_alv: alv });
    const portOnly = (onslot: number[]) => ({
        api_ship: [{
            api_id: 1, api_ship_id: SHOUHOU, api_slot: [1], api_slot_ex: 0,
            api_lv: 1, api_nowhp: 40, api_maxhp: 40, api_cond: 49,
            api_onslot: onslot, api_fuel: 15, api_bull: 15, api_sakuteki: [10],
        }],
        api_deck_port: [{ api_ship: [1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0,
    });

    it('一開始不過時', () => {
        expect(stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]).alvStale).toBe(false);
    });

    // ⚠️ 時機是本組的核心。日wiki 明載熟練度是**回港那一刻**依「出撃時の残数 vs
    // 帰投時の残数」結算的，不是每場戰鬥即時掉——所以出擊途中手上的 alv 還是對的，
    // 標過時反而是報一個當下不成立的警示。別改回「一擊墜就標」。
    it('出擊途中不標過時：熟練度是回港才結算的', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(3));
        expect(state.alvStale).toBe(false);
        expect(state.fleetSummary(0)!.airStale).toBe(false);
    });

    it('回港才結算：部分損耗 → 標過時（降了多少 wiki 沒給數字，不推算）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(3));
        state.applyEvent('api_port/port', portOnly([15]));   // 18 → 15
        expect(state.alvStale).toBe(true);
        expect(state.fleetSummary(0)!.airStale).toBe(true);
        expect(state.combinedSummary().airStale).toBe(true);
    });

    // wiki 唯一給出的絕對規則：「スロットが全滅すると元の状態（帯なし）に戻る」。
    // 兩端搭載數都是母港封包實數，故這是**確定值不是估算** → 直接寫 alv=0，且不標過時。
    it('回港全滅（0 架）→ 熟練度確定歸零，且不標過時', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        state.applyEvent('api_get_member/slot_item', [gear(1, FIGHTER, 7)]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(18));
        state.applyEvent('api_port/port', portOnly([0]));     // 18 → 0＝全滅
        expect(state.alvStale).toBe(false);                   // 確定值，不是「不可考」
        // 熟練度歸零：制空只剩本體対空的部分（搭載 0 → 這一格完全不貢獻）
        expect(state.airPower(0)).toEqual({ min: 0, max: 0 });
        // 補回艦載機後，熟練度確實是帯なし（沒有殘留舊的 >>）
        state.applyEvent('api_req_hokyu/charge', {
            api_ship: [{ api_id: 1, api_fuel: 15, api_bull: 15, api_onslot: [18] }],
            api_material: [],
        });
        expect(state.airPower(0).min).toBe(21);   // 5×√18 ＝ 21.2… → 21（零式21型 対空5、無加成）
    });

    it('回港沒損耗就完全不動（連標記都不加）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(0));
        state.applyEvent('api_port/port', portOnly([18]));
        expect(state.alvStale).toBe(false);
    });

    // 母港封包**不帶裝備資料**（已用 samples/slot_to_port.json 查證，只有 api_ship），
    // 所以「回港」不等於「熟練度已校正」——部分損耗的那一格會一路過時到下次裝備資料到手。
    it('回港不會校正部分損耗的熟練度——母港封包不帶裝備資料', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(3));
        state.applyEvent('api_port/port', portOnly([15]));
        state.applyEvent('api_port/port', portOnly([15]));   // 再進一次母港也一樣
        expect(state.alvStale).toBe(true);
    });

    // KC3Kai／EO：ship_deck／ship3 的 api_slot_data＝未裝備清單，不是裝備＋alv。
    // 熟練度校正只靠 require_info／slot_item；編成端點不得誤消過時標記。
    it('編成端點的 api_slot_data 不校正熟練度（等同 unsetslot）', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        state.applyEvent('api_get_member/slot_item', [gear(1, FIGHTER, 7)]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(3));
        state.applyEvent('api_port/port', portOnly([15]));
        const before = state.airPower(0);
        expect(state.alvStale).toBe(true);
        state.applyEvent('api_get_member/ship_deck', { api_slot_data: [gear(1, FIGHTER, 3)] });
        expect(state.alvStale).toBe(true);
        expect(state.airPower(0)).toEqual(before);
        expect(state.slotItems.get(1)?.alv).toBe(7);
    });

    it('裝備資料整批刷新（slot_item／require_info）才歸零，且制空跟著新熟練度重算', () => {
        const state = stateWithFleets([[{ mst: SHOUHOU, gears: [FIGHTER] }]]);
        state.applyEvent('api_get_member/slot_item', [gear(1, FIGHTER, 7)]);   // 出擊前熟練 >>
        sortie(state);
        state.applyEvent('api_req_sortie/battle', airBattle(3));
        state.applyEvent('api_port/port', portOnly([15]));
        // 回港：搭載數已是實數，熟練度卻還是出擊前的 7 → 制空偏高。
        const stale = state.airPower(0);
        expect(state.alvStale).toBe(true);
        // 玩家開了裝備畫面：遊戲送來熟練度已下降的實數。
        state.applyEvent('api_get_member/slot_item', [gear(1, FIGHTER, 3)]);
        expect(state.alvStale).toBe(false);
        expect(state.airPower(0).min).toBeLessThan(stale.min);
    });
});

// 拖曳交換裝備槽位（母港編成畫面把兩個已裝備的艦載機格互換）走
// `api_req_kaisou/slot_exchange_index`，不是逐格點擊用的 `slotset`（見 utils/state.ts
// 該分支說明）。兩格的搭載數（api_onslot）通常不同（例如一格滿員、一格出擊後有損耗），
// 若實作只搬動 api_slot、沒有讓 api_onslot 跟著同一格走，制空就會用錯的搭載數重算。
describe('拖曳交換槽位後制空重新計算（api_req_kaisou/slot_exchange_index）', () => {
    // 回應的 api_ship_data 是完整艦快照（已用真封包驗證，見
    // samples/slot-exchange-index.json＋tests/equipment-position.test.ts），不是只帶
    // slot/onslot 的局部物件；這裡沿用既有艦記錄複製一份再改槽位，貼近真實回應形狀，
    // 順便確保整艦覆蓋不會把 hp/cond 等其餘欄位意外洗掉。
    function exchange(state: GameState, shipId: number, slot: number[], onslot: number[]) {
        const current = (state as any).ships.get(shipId);
        state.applyEvent('api_req_kaisou/slot_exchange_index', {
            api_ship_data: { ...current, api_slot: slot, api_onslot: onslot },
        }, { api_id: String(shipId), api_src_idx: '0', api_dst_idx: '1' });
    }

    it('單艦隊：兩格互換後，搭載數跟著裝備一起走，制空合計不變但逐格歸屬正確', () => {
        const state = stateWithFleets([[
            { mst: SHOUHOU, gears: [FIGHTER, TORPEDO_BOMBER], onslot: [18, 9] },
        ]]);
        const shipId = state.fleets()[0].ships[0].id;
        const before = state.airPower(0);
        const rawSlot = (state as any).ships.get(shipId).api_slot as number[];

        exchange(state, shipId, [rawSlot[1], rawSlot[0]], [9, 18]);

        const gears = state.fleets()[0].ships[0].gears;
        expect(gears.map(g => g?.mst)).toEqual([TORPEDO_BOMBER, FIGHTER]);
        // 熟練度未變、對空未變，純位置對調＋搭載數同行——合計必須跟交換前一樣；
        // 若 onslot 沒跟著移動（停在原位），戰鬥機會誤用 9 而非 18，合計會偏低。
        expect(state.airPower(0)).toEqual(before);
        expect(gears[0]!.count).toBe(9);   // 艦攻現在在 0 號格，帶走它原本的搭載數
        expect(gears[1]!.count).toBe(18);  // 戰鬥機換到 1 號格，搭載數同行
    });

    it('連合艦隊：第2艦隊（隨伴）的艦載機交換也會即時重算制空', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI }],
            [{ mst: MUTSUKI }, { mst: SHOUHOU, gears: [FIGHTER, TORPEDO_BOMBER], onslot: [18, 9] }],
        ], 1);
        const shipId = state.fleets()[1].ships[1].id;
        const before = state.airPower(1);
        const combinedBefore = state.combinedSummary().air;
        const rawSlot = (state as any).ships.get(shipId).api_slot as number[];

        exchange(state, shipId, [rawSlot[1], rawSlot[0]], [9, 18]);

        const gears = state.fleets()[1].ships[1].gears;
        expect(gears.map(g => g?.mst)).toEqual([TORPEDO_BOMBER, FIGHTER]);
        expect(gears[0]!.count).toBe(9);
        expect(gears[1]!.count).toBe(18);
        expect(state.airPower(1)).toEqual(before);
        expect(state.combinedSummary().air).toEqual(combinedBefore);
    });
});
