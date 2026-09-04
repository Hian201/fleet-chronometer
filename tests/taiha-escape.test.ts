// 大破機制（旗艦大破／第二艦隊旗艦不沉／損管）與艦隊司令部退避的行為測試。
// 艦與裝備 master 一律取自真實 start2 fixture，不手捏 api_stype／裝備 id。
//
// 退避：比照 KC3Kai（`api_escape_idx`／`api_tow_idx` 各取 [0]；1-based；連合 >6＝隨伴）。
// 本檔鎖住解析與下游影響；旗艦哨兵（位置 1／連合的 7）解不出則不標。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeBattle } from '../utils/battle';
import { GameState } from '../utils/state';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const MUTSUKI = 1;      // 睦月（駆逐、燃彈 max 15/15）
const SHOUHOU = 74;     // 祥鳳（軽空母、maxeq [18,9,3]）
const FIGHTER = 20;     // 零式艦戦21型（対空 5）
const DAIHATSU = 68;    // 大発動艇（TP 8）
const DAMECON_TEAM = 42;    // 応急修理要員
const DAMECON_GODDESS = 43; // 応急修理女神
const NAGARA = 21;      // 長良（軽巡洋艦 stype 3＝水雷戦隊の旗艦資格）
const COMMAND_FACILITY = 107;      // 艦隊司令部施設（連合艦隊の護衛退避）
const YUUGEKI_COMMAND = 272;       // 遊撃部隊 艦隊司令部（七艘遊撃部隊の単艦退避）
const TORPEDO_COMMAND = 413;       // 精鋭水雷戦隊 司令部（水雷戦隊の単艦退避）

// ── analyzeBattle 用的最小戰鬥封包 ──────────────────────────────
// 敵方單艦砲擊我方指定位置（api_at_eflag=1＝敵方攻擊），傷害由呼叫端指定。
function battlePacket(opts: {
    fHp: number[]; fMax: number[];
    fHpEsc?: number[]; fMaxEsc?: number[];
    hits: { target: number; dmg: number }[];   // target：我方局部索引（0-5 主隊、6-11 隨伴）
}) {
    return {
        api_f_nowhps: opts.fHp, api_f_maxhps: opts.fMax,
        ...(opts.fHpEsc ? { api_f_nowhps_combined: opts.fHpEsc, api_f_maxhps_combined: opts.fMaxEsc } : {}),
        api_e_nowhps: [90], api_e_maxhps: [90],
        api_ship_ke: [1501],
        api_hougeki1: {
            api_at_eflag: opts.hits.map(() => 1),
            api_at_list: opts.hits.map(() => 0),
            api_df_list: opts.hits.map(h => [h.target]),
            api_damage: opts.hits.map(h => [h.dmg]),
        },
    };
}

const noDamecon = { main: [] as number[], escort: [] as number[] };

describe('損管（応急修理要員／女神）', () => {
    it('応急修理要員：致命傷時修復至中破（最大HP的50%）並消耗', () => {
        const info = analyzeBattle(
            [battlePacket({ fHp: [40], fMax: [40], hits: [{ target: 0, dmg: 99 }] })],
            { main: [1], escort: [] });
        const flagship = info.resultFleets!.playerMain[0];
        expect(flagship.sunk).toBe(false);
        expect(flagship.hp).toBe(20);
        expect(flagship.damecon).toBe(0);
    });

    it('応急修理女神：致命傷時修復至滿血並消耗', () => {
        const info = analyzeBattle(
            [battlePacket({ fHp: [40], fMax: [40], hits: [{ target: 0, dmg: 99 }] })],
            { main: [2], escort: [] });
        const flagship = info.resultFleets!.playerMain[0];
        expect(flagship.hp).toBe(40);
        expect(flagship.damecon).toBe(0);
    });

    it('沒吃到致命傷就不發動，損管留給後面的節點', () => {
        const info = analyzeBattle(
            [battlePacket({ fHp: [40], fMax: [40], hits: [{ target: 0, dmg: 35 }] })],
            { main: [1], escort: [] });
        expect(info.resultFleets!.playerMain[0].damecon).toBe(1);
    });
});

describe('第二艦隊旗艦不會被擊沉', () => {
    const combined = (dmg: number, damecon = 0) => analyzeBattle(
        [battlePacket({
            fHp: [40, 40], fMax: [40, 40], fHpEsc: [30, 30], fMaxEsc: [30, 30],
            hits: [{ target: 6, dmg }],
        })],
        { main: [0, 0], escort: [damecon, 0] });

    it('致命傷時存活（不判轟沈），也不消耗損管', () => {
        const escortFlagship = combined(99, 1).resultFleets!.playerEscort[0];
        expect(escortFlagship.sunk).toBe(false);
        expect(escortFlagship.hp).toBe(1);
        expect(escortFlagship.damecon).toBe(1);
    });

    it('不會被擊沉＝沒有轟沈風險，故不觸發大破警告', () => {
        expect(combined(99).isTaiha).toBe(false);
    });

    it('隨伴艦隊的其他艦大破仍要警告', () => {
        const info = analyzeBattle(
            [battlePacket({
                fHp: [40, 40], fMax: [40, 40], fHpEsc: [30, 30], fMaxEsc: [30, 30],
                hits: [{ target: 7, dmg: 24 }],
            })],
            noDamecon);
        expect(info.resultFleets!.playerEscort[1].hp).toBe(6);
        expect(info.isTaiha).toBe(true);
    });
});

describe('大破警告的三種語意', () => {
    it('非旗艦大破 → isTaiha（可進擊但會被轟沈）', () => {
        const info = analyzeBattle(
            [battlePacket({ fHp: [40, 40], fMax: [40, 40], hits: [{ target: 1, dmg: 31 }] })],
            noDamecon);
        expect(info.isTaiha).toBe(true);
        expect(info.flagshipTaiha).toBe(false);
    });

    it('旗艦大破 → flagshipTaiha（強制返航），不混進 isTaiha', () => {
        const info = analyzeBattle(
            [battlePacket({ fHp: [40, 40], fMax: [40, 40], hits: [{ target: 0, dmg: 31 }] })],
            noDamecon);
        expect(info.flagshipTaiha).toBe(true);
        expect(info.flagshipDamecon).toBe(0);
        expect(info.isTaiha).toBe(false);
    });

    it('旗艦大破且旗艦自己帶損管 → 回報可用的損管種類', () => {
        const info = analyzeBattle(
            [battlePacket({ fHp: [40, 40], fMax: [40, 40], hits: [{ target: 0, dmg: 31 }] })],
            { main: [1, 0], escort: [] });
        expect(info.flagshipTaiha).toBe(true);
        expect(info.flagshipDamecon).toBe(1);
    });

    it('損管裝在別的隊員身上不算旗艦的保險', () => {
        const info = analyzeBattle(
            [battlePacket({ fHp: [40, 40], fMax: [40, 40], hits: [{ target: 0, dmg: 31 }] })],
            { main: [0, 2], escort: [] });
        expect(info.flagshipDamecon).toBe(0);
    });

    it('退避艦不再列入大破警告', () => {
        const packet = battlePacket({ fHp: [40, 40], fMax: [40, 40], hits: [{ target: 1, dmg: 31 }] });
        expect(analyzeBattle([packet], noDamecon).isTaiha).toBe(true);
        expect(analyzeBattle([packet], noDamecon, { escapedMain: [false, true] }).isTaiha).toBe(false);
    });
});

// ── GameState 端：退避的擷取與下游影響 ─────────────────────────
interface TestShip { mst: number; gears?: number[]; lv?: number; hp?: number }

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
                api_lv: ship.lv ?? 1, api_nowhp: ship.hp ?? 40, api_maxhp: 40, api_cond: 49,
                api_onslot: slots.map(() => 18), api_soku: 10,
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

/** 結算 → 退避：遊戲先在結算畫面提供退避候補，玩家按下退避才送 goback_port。 */
function retreat(state: GameState, escapeIdx: number[], towIdx: number[] = []) {
    state.applyEvent('api_req_combined_battle/battleresult', {
        api_win_rank: 'B',
        api_escape_flag: 1,
        api_escape: { api_escape_idx: escapeIdx, api_tow_idx: towIdx },
    });
    state.applyEvent('api_req_combined_battle/goback_port', {});
}

describe('ship3／ship_deck 的艦隊同步', () => {
    it('局部回傳的第3艦隊依 api_id 留在第3格，不覆蓋第1艦隊或清空其他艦隊', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI, hp: 11 }],
            [{ mst: MUTSUKI, hp: 22 }],
            [{ mst: MUTSUKI, hp: 33 }],
        ]);
        const firstDeck = state.decks[0];
        const secondDeck = state.decks[1];
        const thirdDeck = { ...state.decks[2], api_id: 3, api_name: '第三艦隊（更新）' };

        // 能動分歧後遊戲重取目前編成時，可只回傳指定艦隊；陣列第 0 格不是艦隊 1。
        state.applyEvent('api_get_member/ship3', {
            api_ship_data: [],
            api_deck_data: [thirdDeck],
        });

        expect(state.decks[0]).toBe(firstDeck);
        expect(state.decks[1]).toBe(secondDeck);
        expect(state.decks[2]).toBe(thirdDeck);
        expect(state.fleets().map(fleet => fleet.ships[0]?.hp)).toEqual([11, 22, 33]);
    });

    it('沒有 api_id 的局部資料不臆測艦隊位置', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI, hp: 11 }],
            [{ mst: MUTSUKI, hp: 22 }],
            [{ mst: MUTSUKI, hp: 33 }],
        ]);
        const before = state.decks.slice();

        state.applyEvent('api_get_member/ship_deck', {
            api_ship_data: [],
            api_deck_data: [{ api_ship: [999] }],
        });

        expect(state.decks).toEqual(before);
    });
});

// 夜戰接續會把晝戰封包整場重放一次（analyzeBattle([晝, 夜])），故餵進去的損管必須是
// **晝戰開打前**的狀態。晝戰觸發過損管的艦已被記進 damaconUsed，若在夜戰用「當下」重算
// 的損管去重放，那艘船會在重放晝戰傷害時無損管可用 → 誤報轟沈：血量被寫回 0（編成面板
// 出現一艘沉船）、predictRank 多算一艘損失，女神還會在結算把「沉船」的燃彈補滿。
describe('損管與夜戰接續（GameState 端）', () => {
    /** 晝戰把 2 號艦打到致命傷（由損管接住），接著夜戰接續且不再造成任何傷害。 */
    const dayThenNight = (gearMst: number) => {
        const state = stateWithFleets([[{ mst: MUTSUKI }, { mst: MUTSUKI, gears: [gearMst] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', battlePacket({
            fHp: [40, 40], fMax: [40, 40], hits: [{ target: 1, dmg: 99 }],
        }));
        const day = { ...state.battleInfo!.resultFleets!.playerMain[1]! };
        state.applyEvent('api_req_battle_midnight/battle', battlePacket({
            fHp: [40, day.hp], fMax: [40, 40], hits: [],
        }));
        return { state, day, night: state.battleInfo!.resultFleets!.playerMain[1]! };
    };

    it('応急修理要員：晝戰救回的船在夜戰不會變成轟沈', () => {
        const { state, day, night } = dayThenNight(DAMECON_TEAM);
        expect(day).toMatchObject({ sunk: false, hp: 20, damecon: 0 });
        expect(night).toMatchObject({ sunk: false, hp: 20 });
        expect(state.fleets()[0].ships[1].hp).toBe(20);
    });

    it('応急修理女神：同上，且結算不會去補一艘「沉船」的燃彈', () => {
        const { state, day, night } = dayThenNight(DAMECON_GODDESS);
        expect(day).toMatchObject({ sunk: false, hp: 40 });
        expect(night).toMatchObject({ sunk: false, hp: 40 });
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' });
        const ship = state.fleets()[0].ships[1];
        expect(ship.hp).toBe(40);
        expect(ship.fuel).toBe(15);   // 睦月 燃15：女神全快（晝夜兩戰的消耗都補回）
    });

    it('損管本來就用掉了才進節點：下一場戰鬥恢復成沒有損管', () => {
        const { state } = dayThenNight(DAMECON_TEAM);
        // 下一個節點（新的晝戰）：同一顆損管不能再接一次，這次要如實判定轟沈。
        state.applyEvent('api_req_sortie/battle', battlePacket({
            fHp: [40, 20], fMax: [40, 40], hits: [{ target: 1, dmg: 99 }],
        }));
        expect(state.battleInfo!.resultFleets!.playerMain[1]).toMatchObject({ sunk: true, hp: 0 });
    });

    it('夜戰包缺少白天欄位時保留陣形／制空／索敵，且仍標示夜戰入口', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI }, { mst: MUTSUKI }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', {
            ...battlePacket({ fHp: [40, 40], fMax: [40, 40], hits: [] }),
            api_formation: [1, 5, 3],
            api_search: [1, 1],
            api_kouku: {
                api_stage1: {
                    api_f_count: 12, api_f_lostcount: 0,
                    api_e_count: 8, api_e_lostcount: 0,
                    api_disp_seiku: 2,
                },
            },
            api_midnight_flag: 1,
        });
        // 模擬從保留事件中途重建：夜戰包本身仍有 HP／夜戰傷害，但白天基準不在
        // lastDayBattle；這是面板最容易把陣形洗成 [0,0,0] 的路徑。
        state.lastDayBattle = null;
        state.applyEvent('api_req_battle_midnight/battle', {
            api_f_nowhps: [40, 40], api_f_maxhps: [40, 40],
            api_e_nowhps: [90], api_e_maxhps: [90], api_ship_ke: [1501],
            api_hougeki: {
                api_at_eflag: [0], api_at_list: [0], api_df_list: [[0]], api_damage: [[0]],
            },
        });
        expect(state.battleInfo?.formation).toEqual([1, 5, 3]);
        expect(state.battleInfo?.seiku).toBe(2);
        expect(state.battleInfo?.search).toBe('success');
        expect(state.battleInfo?.midnightFlag).toBe(true);
        expect(state.battleInfo?.nightObserved).toBe(true);
    });

    it('日戰聯合敵艦尚未進夜戰時，把 KC3Kai 式主／伴隊預測留在正式 BattleInfo', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI }],
            [{ mst: MUTSUKI }],
        ], 1);
        sortie(state);
        state.applyEvent('api_req_combined_battle/battle', {
            api_f_nowhps: [40], api_f_maxhps: [40],
            api_f_nowhps_combined: [40], api_f_maxhps_combined: [40],
            api_e_nowhps: [20], api_e_maxhps: [20],
            api_e_nowhps_combined: [10, 10], api_e_maxhps_combined: [10, 10],
            api_ship_ke: [1501], api_ship_ke_combined: [1502, 1503],
            api_midnight_flag: 1,
        });
        expect(state.battleInfo?.nightObserved).toBe(false);
        expect(state.battleInfo?.nightTarget).toBe('escort');
        expect(state.battleInfo?.nightTargetEstimated).toBe(true);
    });
});

describe('夜轉日封包的夜戰解析', () => {
    it('api_req_sortie/night_to_day 不被當成普通白天戰鬥，保留 api_n_hougeki* 與夜戰狀態', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/night_to_day', {
            api_f_nowhps: [40], api_f_maxhps: [40],
            api_e_nowhps: [30], api_e_maxhps: [30], api_ship_ke: [1501],
            api_n_hougeki1: {
                api_at_eflag: [0], api_at_list: [0], api_df_list: [[0]], api_damage: [[4]],
            },
            api_day_flag: 1,
        });
        expect(state.battleInfo?.nightObserved).toBe(true);
        expect(state.battleInfo?.nightTarget).toBe('main');
        expect(state.battleInfo?.timeline?.phases.map(phase => phase.kind)).toContain('nightShelling');
    });
});

describe('艦隊司令部退避', () => {
    it('第3艦隊七艘：戰鬥封包 api_deck_id 會校正 HP 回寫目標，結算候補在退避後正確標記', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI, hp: 40 }],
            [{ mst: MUTSUKI, hp: 40 }],
            Array.from({ length: 7 }, () => ({ mst: MUTSUKI, hp: 40 })),
        ]);
        sortie(state, 3);
        // 模擬面板中途重建後遺失 map/start 的艦隊上下文；戰鬥封包本身明示第3艦隊。
        state.currentSortieFleetId = 0;
        const packet = battlePacket({
            fHp: [40, 40, 40, 40, 40, 1, 40],
            fMax: [40, 40, 40, 40, 40, 40, 40],
            hits: [],
        });
        Object.assign(packet, { api_deck_id: 3 });
        state.applyEvent('api_req_battle_midnight/battle', packet);

        expect(state.currentSortieFleetId).toBe(2);
        expect(state.fleets()[0].ships[0].hp).toBe(40);
        expect(state.fleets()[2].ships[5].hp).toBe(1);

        // KC3Kai 同樣從 battleresult.api_escape 暫存候補；實際按退避送出
        // goback_port 後才離隊。
        state.applyEvent('api_req_sortie/battleresult', {
            api_escape: { api_escape_idx: [6], api_tow_idx: [] },
        });
        state.applyEvent('api_req_combined_battle/goback_port', {});
        expect(state.fleets()[2].ships.map(ship => ship.escaped)).toEqual([
            false, false, false, false, false, true, false,
        ]);
    });

    it('退避的是結算封包指名的位置（1-based），其餘艦不受影響', () => {
        const state = stateWithFleets([[{ mst: 1 }, { mst: 1 }, { mst: 1 }]]);
        sortie(state);
        retreat(state, [2]);
        expect([...state.escapedShipIds]).toEqual([2]);
        expect(state.fleets()[0].ships.map(s => s.escaped)).toEqual([false, true, false]);
    });

    it('七艘遊撃部隊：位置 7 是第七艘，不會被當成第二艦隊', () => {
        const state = stateWithFleets([
            Array.from({ length: 7 }, () => ({ mst: 1 })),
            [{ mst: 1 }],
        ]);
        sortie(state);
        retreat(state, [7]);
        expect([...state.escapedShipIds]).toEqual([7]);
    });

    it('連合艦隊：位置 7-12 對到第二艦隊，曳航艦一起退避', () => {
        const state = stateWithFleets([
            [{ mst: 1 }, { mst: 1 }],
            [{ mst: 1 }, { mst: 1 }, { mst: 1 }],
        ], 1);
        sortie(state);
        retreat(state, [8], [9]);   // 第2艦隊的 2、3 號艦
        expect([...state.escapedShipIds].sort((a, b) => a - b)).toEqual([4, 5]);
    });

    it('兩隊的旗艦都不可能退避，解到旗艦位置一律不採信', () => {
        const state = stateWithFleets([
            [{ mst: 1 }, { mst: 1 }],
            [{ mst: 1 }, { mst: 1 }],
        ], 1);
        sortie(state);
        retreat(state, [1], [7]);
        expect(state.escapedShipIds.size).toBe(0);
    });

    it('只取 escape_idx[0]：開頭是旗艦哨兵就不標（後面候補忽略）', () => {
        const state = stateWithFleets([[{ mst: 1 }, { mst: 1 }]]);
        sortie(state);
        retreat(state, [1, 2]);
        expect([...state.escapedShipIds]).toEqual([]);
    });

    it('連合：只取 [0]，開頭是第二艦隊旗艦哨兵就不標', () => {
        const state = stateWithFleets([
            [{ mst: 1 }, { mst: 1 }],
            [{ mst: 1 }, { mst: 1 }],
        ], 1);
        sortie(state);
        retreat(state, [7, 8]);
        expect([...state.escapedShipIds]).toEqual([]);
    });

    it('沒有 api_escape 就不猜是哪艘船退避（維持原本的警告）', () => {
        const state = stateWithFleets([[{ mst: 1 }, { mst: 1 }]]);
        sortie(state);
        state.applyEvent('api_req_combined_battle/battleresult', { api_win_rank: 'B' });
        state.applyEvent('api_req_combined_battle/goback_port', {});
        expect(state.escapedShipIds.size).toBe(0);
    });

    it('超出範圍或非整數的位置一律丟棄', () => {
        const state = stateWithFleets([[{ mst: 1 }, { mst: 1 }]]);
        sortie(state);
        retreat(state, [0, 13, NaN as unknown as number], ['x' as unknown as number]);
        expect(state.escapedShipIds.size).toBe(0);
    });

    it('只在結算畫面提供退避、玩家沒按下去時不算退避', () => {
        const state = stateWithFleets([[{ mst: 1 }, { mst: 1 }]]);
        sortie(state);
        state.applyEvent('api_req_combined_battle/battleresult', {
            api_win_rank: 'B', api_escape: { api_escape_idx: [2], api_tow_idx: [] },
        });
        expect(state.escapedShipIds.size).toBe(0);
    });

    it('回港與下次出擊都會清空退避狀態', () => {
        const state = stateWithFleets([[{ mst: 1 }, { mst: 1 }]]);
        sortie(state);
        retreat(state, [2]);
        expect(state.escapedShipIds.size).toBe(1);
        sortie(state);
        expect(state.escapedShipIds.size).toBe(0);
    });
});

// api_escape_idx／api_tow_idx 可能列多艘候補；比照 KC3Kai 只取各陣列 [0]，
// 絕不可整批標記；健康驅逐艦不得因候補陣列中的其他艦而被標退避。
describe('退避只取各陣列 [0]（inspired by KC3Kai）', () => {
    it('曳航候補有多艘時只取 tow_idx[0]，不整批標記', () => {
        const state = stateWithFleets([
            [{ mst: 1 }, { mst: 1 }],
            // 第2艦隊：旗艦＋大破的 2 號艦＋三艘健康驅逐艦（＝遊戲會列出的曳航候補）
            [{ mst: 1 }, { mst: 1, hp: 4 }, { mst: 1 }, { mst: 1 }, { mst: 1 }],
        ], 1);
        sortie(state);
        retreat(state, [8], [9, 10, 11]);
        // 大破的第2艦隊2號艦（id 4）＋ tow[0]（id 5）；6、7 不受影響
        expect([...state.escapedShipIds].sort((a, b) => a - b)).toEqual([4, 5]);
        expect(state.fleets()[1].ships.map(s => s.escaped)).toEqual([false, true, true, false, false]);
    });

    it('escape_idx 有多筆時只取 [0]，不靠本機血量另猜', () => {
        const state = stateWithFleets([[{ mst: 1 }, { mst: 1 }, { mst: 1, hp: 4 }]]);
        sortie(state);
        retreat(state, [2, 3]);
        expect([...state.escapedShipIds]).toEqual([2]);
    });

    it('只有曳航候補、沒有大破艦候補時不標任何退避艦', () => {
        const state = stateWithFleets([
            [{ mst: 1 }, { mst: 1 }],
            [{ mst: 1 }, { mst: 1 }, { mst: 1 }],
        ], 1);
        sortie(state);
        retreat(state, [], [8, 9]);
        expect([...state.escapedShipIds]).toEqual([]);
    });

    it('連合：tow_idx[0] 原樣採信（不另以護衛條件過濾）', () => {
        const state = stateWithFleets([
            [{ mst: 1 }, { mst: 1 }],
            [{ mst: 1 }, { mst: 1, hp: 4 }, { mst: 1, hp: 25 }],
        ], 1);
        sortie(state);
        retreat(state, [8], [9]);
        expect([...state.escapedShipIds].sort((a, b) => a - b)).toEqual([4, 5]);
    });

    it('單艦隊（遊撃部隊／水雷戦隊）沒有曳航艦：封包帶了 tow 也不採信', () => {
        const state = stateWithFleets([Array.from({ length: 7 }, () => ({ mst: 1 }))]);
        sortie(state);
        retreat(state, [3], [4, 5]);
        expect([...state.escapedShipIds]).toEqual([3]);
    });

    it('tow[0] 與 escape 同一艘時不重複佔名額', () => {
        const state = stateWithFleets([
            [{ mst: 1 }, { mst: 1 }],
            [{ mst: 1 }, { mst: 1, hp: 4 }, { mst: 1 }],
        ], 1);
        sortie(state);
        retreat(state, [8], [8, 9]);
        expect([...state.escapedShipIds]).toEqual([4]);
    });
});

describe('退避後按剩下的船重算大破警告', () => {
    // 退避的意義就是「讓剩下的船繼續進擊」。退掉唯一那艘大破艦之後還掛著警告，
    // 等於叫玩家別做他剛剛才做完的事——而 goback_port 沒有新的戰鬥封包會觸發重算，
    // 故 state.ts 必須在那條路徑自己重跑 taihaFlags()。
    //
    // hp 12/40 = 30% > 25%（無傷）、hp 8/40 = 20% ≤ 25%（大破）。
    const HEALTHY = 40, TAIHA_HP = 8;

    /** 打一場只是為了產生 battleInfo；血量直接由封包給定，不另外造傷害。 */
    const fight = (state: GameState, fHp: number[]) => {
        state.applyEvent('api_req_sortie/battle', battlePacket({
            fHp, fMax: fHp.map(() => 40), hits: [],
        }));
    };

    it('退掉唯一的大破艦 → 警告消失', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI }, { mst: MUTSUKI }, { mst: MUTSUKI }]]);
        sortie(state);
        fight(state, [HEALTHY, TAIHA_HP, HEALTHY]);
        expect(state.battleInfo!.isTaiha).toBe(true);
        retreat(state, [2]);   // 2 號艦＝那艘大破的
        expect(state.battleInfo!.isTaiha).toBe(false);
    });

    it('還有別的大破艦 → 警告繼續顯示', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI }, { mst: MUTSUKI }, { mst: MUTSUKI }]]);
        sortie(state);
        fight(state, [HEALTHY, TAIHA_HP, TAIHA_HP]);
        expect(state.battleInfo!.isTaiha).toBe(true);
        retreat(state, [2]);   // 一場只能退一艘，3 號艦還大破著
        expect(state.battleInfo!.isTaiha).toBe(true);
    });

    it('連合艦隊：退掉第2艦隊的大破艦同樣重算', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI }, { mst: MUTSUKI }],
            [{ mst: MUTSUKI }, { mst: MUTSUKI }],
        ], 1);
        sortie(state);
        state.applyEvent('api_req_combined_battle/battle', battlePacket({
            fHp: [HEALTHY, HEALTHY], fMax: [40, 40],
            fHpEsc: [HEALTHY, TAIHA_HP], fMaxEsc: [40, 40],
            hits: [],
        }));
        expect(state.battleInfo!.isTaiha).toBe(true);
        retreat(state, [8]);   // 第2艦隊 2 號艦
        expect(state.battleInfo!.isTaiha).toBe(false);
    });

    it('解不出退避位置時不動警告（保守方向）', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI }, { mst: MUTSUKI }]]);
        sortie(state);
        fight(state, [HEALTHY, TAIHA_HP]);
        // 位置 1＝旗艦，機制上不可能退避 → shipAtSortiePos 回 null，什麼都不標
        retreat(state, [1]);
        expect(state.escapedShipIds.size).toBe(0);
        expect(state.battleInfo!.isTaiha).toBe(true);
    });

    it('旗艦大破不因為別人退避而消失', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI }, { mst: MUTSUKI }, { mst: MUTSUKI }]]);
        sortie(state);
        fight(state, [TAIHA_HP, TAIHA_HP, HEALTHY]);
        expect(state.battleInfo!.flagshipTaiha).toBe(true);
        retreat(state, [2]);
        expect(state.battleInfo!.isTaiha).toBe(false);      // 2 號艦已離隊
        expect(state.battleInfo!.flagshipTaiha).toBe(true); // 旗艦還在，仍禁止進擊
    });
});

describe('退避後艦隊戰力按剩下的船重算', () => {
    const fleet = (): TestShip[] => [
        { mst: SHOUHOU, gears: [FIGHTER], lv: 50 },
        { mst: SHOUHOU, gears: [FIGHTER], lv: 30 },
        { mst: MUTSUKI, gears: [DAIHATSU], lv: 20 },
    ];

    it('等級／制空／索敵／TP 全部排除退避艦', () => {
        const state = stateWithFleets([fleet()]);
        sortie(state);
        const before = state.fleetSummary(0)!;
        expect(before.lvSum).toBe(100);

        retreat(state, [2]);   // 2 號艦（Lv30 的祥鳳）退避
        const after = state.fleetSummary(0)!;
        expect(after.lvSum).toBe(70);
        expect(after.air.min).toBeLessThan(before.air.min);
        expect(after.air.max).toBeLessThan(before.air.max);
        expect(after.f33).not.toBe(before.f33);
        // 大発（TP 8）在第 3 艘、沒退避 → 裝備 TP 不變；退避的祥鳳基本 TP 為 0
        expect(after.tp).toEqual(before.tp);
    });

    it('退避輸送艦會讓 TP 跟著減少', () => {
        const state = stateWithFleets([fleet()]);
        sortie(state);
        const before = state.fleetTP(0);
        retreat(state, [3]);   // 帶大発的睦月退避
        expect(state.fleetTP(0)).toEqual({ total: before.total - 13, gear: before.gear - 8 });
    });

    it('連合艦隊合計同樣排除退避艦', () => {
        const state = stateWithFleets([
            [{ mst: SHOUHOU, lv: 50 }, { mst: MUTSUKI, lv: 10 }],
            [{ mst: MUTSUKI, lv: 40 }, { mst: MUTSUKI, lv: 20 }],
        ], 1);
        sortie(state);
        expect(state.combinedSummary().lvSum).toBe(120);
        retreat(state, [8]);   // 第2艦隊 2 號艦（Lv20）
        expect(state.combinedSummary().lvSum).toBe(100);
    });

    it('退避艦不再跟著消耗燃彈', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI }, { mst: MUTSUKI }]]);
        sortie(state);
        retreat(state, [2]);
        state.applyEvent('api_req_sortie/battle', battlePacket({
            fHp: [40, 40], fMax: [40, 40], hits: [],
        }));
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' });
        // 燃料在退避當下就被歸 0，看不出「有沒有再扣」，故用彈藥驗（退避不動彈藥）
        const [stay, gone] = state.fleets()[0].ships;
        expect(stay.bull).toBe(12);    // 睦月 彈15 × 20% = 3
        expect(gone.bull).toBe(15);
        expect(gone.fuel).toBe(0);
    });
});

describe('護衛退避的可用性判定（連合艦隊・107）', () => {
    // 連合艦隊：第1艦隊旗艦帶 107，護衛艦從第2艦隊 2 號艦以後的「未損傷驅逐艦」挑
    const combinedWith = (escortFleet: TestShip[], facilityAt = 0) => {
        const main: TestShip[] = [{ mst: MUTSUKI }, { mst: MUTSUKI }];
        main[facilityAt] = { mst: MUTSUKI, gears: [COMMAND_FACILITY] };
        const state = stateWithFleets([main, escortFleet], 1);
        sortie(state);
        return state;
    };
    const dd = (hp = 40) => ({ mst: MUTSUKI, hp });

    it('第2艦隊有未損傷驅逐艦 → 可能出現護衛退避', () => {
        expect(combinedWith([dd(), dd()]).retreatAvailability())
            .toEqual({ state: 'ready', kind: 'combined' });
    });

    it('第2艦隊的驅逐艦全部小破以上 → 不會出現退避選項（但大破仍然是真的）', () => {
        expect(combinedWith([dd(), dd(25)]).retreatAvailability())   // 25/40＝62.5%＝小破
            .toEqual({ state: 'noEscort', kind: 'combined' });
    });

    // 門檻是「損傷未達小破」而不是「滿血」（使用者提供之遊戲設定）。用滿血判定會把
    // かすり傷的驅逐艦謊報成沒人可當護衛艦＝「沒有退避選項」，那是最危險的誤讀方向。
    it('かすり傷（殘 HP 高於 75%）照樣拖得動，不是只有滿血才行', () => {
        expect(combinedWith([dd(), dd(38)]).retreatAvailability())   // 38/40＝95%
            .toEqual({ state: 'ready', kind: 'combined' });
    });

    it('小破的門檻在 75%：恰好 75% 算小破，拖不了', () => {
        expect(combinedWith([dd(), dd(30)]).retreatAvailability().state).toBe('noEscort');
        expect(combinedWith([dd(), dd(31)]).retreatAvailability().state).toBe('ready');
    });

    it('第2艦隊旗艦不能當護衛艦', () => {
        expect(combinedWith([dd(), dd(20)]).retreatAvailability().state).toBe('noEscort');
    });

    it('第1艦隊的驅逐艦再健康也不能當護衛艦', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI, gears: [COMMAND_FACILITY] }, { mst: MUTSUKI }, { mst: MUTSUKI }],
            [{ mst: SHOUHOU }, { mst: SHOUHOU }],
        ], 1);
        sortie(state);
        expect(state.retreatAvailability().state).toBe('noEscort');
    });

    it('司令部施設不在第1艦隊旗艦身上就完全無效', () => {
        expect(combinedWith([dd(), dd()], 1).retreatAvailability())
            .toEqual({ state: 'none', kind: null });
    });

    it('已退避的驅逐艦不能再被算成可用的護衛艦', () => {
        const state = combinedWith([dd(), dd()]);
        expect(state.retreatAvailability().state).toBe('ready');
        retreat(state, [8]);   // 第2艦隊 2 號艦退避
        expect(state.retreatAvailability().state).toBe('noEscort');
    });

    it('連合艦隊帶的是遊撃部隊／水雷戦隊用的司令部 → 無效', () => {
        for (const gear of [YUUGEKI_COMMAND, TORPEDO_COMMAND]) {
            const state = stateWithFleets([
                [{ mst: MUTSUKI, gears: [gear] }, { mst: MUTSUKI }],
                [{ mst: MUTSUKI }, { mst: MUTSUKI }],
            ], 1);
            sortie(state);
            expect(state.retreatAvailability()).toEqual({ state: 'none', kind: null });
        }
    });
});

// 三顆司令部各自綁一種編制，**不可互換**；272 僅適用七艘遊撃部隊，413 僅適用
// 水雷戦隊，其他編制不得顯示可退避。
// ⚠️ 遊撃部隊／水雷戦隊的成立條件為使用者提供之遊戲設定、未經封包驗證（見 state.ts）。
describe('單艦退避的可用性判定（遊撃部隊・272／水雷戦隊・413）', () => {
    const singleWith = (ships: TestShip[]) => {
        const state = stateWithFleets([ships]);
        sortie(state);
        return state;
    };
    /** 七艘遊撃部隊：旗艦帶 272。 */
    const striking = (n: number) => singleWith([
        { mst: MUTSUKI, gears: [YUUGEKI_COMMAND] },
        ...Array.from({ length: n - 1 }, () => ({ mst: MUTSUKI })),
    ]);

    it('七艘遊撃部隊＋272 → 單艦退避成立', () => {
        expect(striking(7).retreatAvailability()).toEqual({ state: 'ready', kind: 'striking' });
    });

    it('272 但只有六艘（不是遊撃部隊）→ 沒有退避選項', () => {
        expect(striking(6).retreatAvailability()).toEqual({ state: 'none', kind: null });
    });

    it('水雷戦隊（輕巡旗艦＋驅逐艦）＋413 → 單艦退避成立', () => {
        const state = singleWith([
            { mst: NAGARA, gears: [TORPEDO_COMMAND] }, { mst: MUTSUKI }, { mst: MUTSUKI },
        ]);
        expect(state.retreatAvailability()).toEqual({ state: 'ready', kind: 'torpedo' });
    });

    it('413 但旗艦不是輕巡系 → 不成立', () => {
        const state = singleWith([
            { mst: MUTSUKI, gears: [TORPEDO_COMMAND] }, { mst: MUTSUKI },
        ]);
        expect(state.retreatAvailability()).toEqual({ state: 'none', kind: null });
    });

    it('413 但隊裡混了大型艦 → 不成立', () => {
        const state = singleWith([
            { mst: NAGARA, gears: [TORPEDO_COMMAND] }, { mst: MUTSUKI }, { mst: SHOUHOU },
        ]);
        expect(state.retreatAvailability()).toEqual({ state: 'none', kind: null });
    });

    // 反方向（七艘編成只帶 413、不帶 272）**在遊戲裡建不出來**：第七格本身就是 272 開出來的
    // （封包事實，見 CLAUDE.md）。不可達的狀態不寫斷言，免得把任意答案當成契約鎖死。
    it('兩顆不可互換：272 裝在水雷戦隊（六艘）裡不成立', () => {
        const state = singleWith([
            { mst: NAGARA, gears: [YUUGEKI_COMMAND] },
            ...Array.from({ length: 5 }, () => ({ mst: MUTSUKI })),
        ]);
        expect(state.retreatAvailability()).toEqual({ state: 'none', kind: null });
    });

    it('107 在單艦隊完全無效（不論編制形狀）', () => {
        expect(singleWith([{ mst: NAGARA, gears: [COMMAND_FACILITY] }, { mst: MUTSUKI }])
            .retreatAvailability()).toEqual({ state: 'none', kind: null });
        expect(singleWith([
            { mst: MUTSUKI, gears: [COMMAND_FACILITY] },
            ...Array.from({ length: 6 }, () => ({ mst: MUTSUKI })),
        ]).retreatAvailability()).toEqual({ state: 'none', kind: null });
    });

    it('單艦退避不需要護衛艦：全隊都受損也照樣成立', () => {
        const state = singleWith([
            { mst: MUTSUKI, gears: [YUUGEKI_COMMAND], hp: 8 },
            ...Array.from({ length: 6 }, () => ({ mst: MUTSUKI, hp: 8 })),
        ]);
        expect(state.retreatAvailability()).toEqual({ state: 'ready', kind: 'striking' });
    });

    // 一顆不成立要繼續看下一顆：272 因艦數不是 7 而不成立時就回 none 的話，實際成立的
    // 413 會被謊報成「沒有退避選項」——正是「沒出現退避選項 ≠ 沒有人大破」的誤讀。
    it('旗艦同時帶 272＋413 的六艘水雷戦隊：272 不成立不擋 413', () => {
        const state = singleWith([
            { mst: NAGARA, gears: [YUUGEKI_COMMAND, TORPEDO_COMMAND] },
            ...Array.from({ length: 5 }, () => ({ mst: MUTSUKI })),
        ]);
        expect(state.retreatAvailability()).toEqual({ state: 'ready', kind: 'torpedo' });
    });
});

describe('退避的代價', () => {
    it('大破艦與護衛艦一起燃料歸0、cond 變 22', () => {
        const state = stateWithFleets([
            [{ mst: MUTSUKI }, { mst: MUTSUKI }],
            [{ mst: MUTSUKI }, { mst: MUTSUKI }],
        ], 1);
        sortie(state);
        retreat(state, [2], [8]);   // 第1艦隊 2 號艦大破退避、第2艦隊 2 號艦護衛
        const [f1, f2] = state.fleets();
        expect(f1.ships[1]).toMatchObject({ escaped: true, fuel: 0, cond: 22 });
        expect(f2.ships[1]).toMatchObject({ escaped: true, fuel: 0, cond: 22 });
        // 留下來的船不受影響
        expect(f1.ships[0]).toMatchObject({ escaped: false, fuel: 15, cond: 49 });
    });
});

describe('応急修理女神：燃彈也全快', () => {
    it('結算套完燃彈消耗後才補滿，不會被同一節點的消耗再扣一次', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI, gears: [DAMECON_GODDESS] }, { mst: MUTSUKI }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', battlePacket({
            fHp: [40, 40], fMax: [40, 40], hits: [{ target: 0, dmg: 99 }],
        }));
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'B' });
        const [saved, other] = state.fleets()[0].ships;
        expect(saved.hp).toBe(40);
        expect(saved.fuel).toBe(15);
        expect(saved.bull).toBe(15);
        expect(other.fuel).toBe(12);   // 其他艦照常消耗
    });

    it('応急修理要員只補 HP 到中破，不補燃彈', () => {
        const state = stateWithFleets([[{ mst: MUTSUKI, gears: [DAMECON_TEAM] }]]);
        sortie(state);
        state.applyEvent('api_req_sortie/battle', battlePacket({
            fHp: [40], fMax: [40], hits: [{ target: 0, dmg: 99 }],
        }));
        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'B' });
        const [saved] = state.fleets()[0].ships;
        expect(saved.hp).toBe(20);
        expect(saved.fuel).toBe(12);
    });
});
