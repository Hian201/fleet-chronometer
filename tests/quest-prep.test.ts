// 任務達成條件（utils/quest-prep.ts、utils/quest-prep-data.ts）與 GameState 串接。
// 要鎖住的性質：
//   1. 條件表的艦娘、裝備皆為 master id；艦名表示此改造階段以後。
//   2. 未指定艦隊的編成任務看任一艦隊；艘數上限、指定格位、改修與熟練度門檻照實判定。
//   3. 持有只算未裝備的裝備；道具、資源、裝備清單不可考時不判為可完成。
//   4. 機種轉換類的廢棄只在秘書艦條件成立時計入；裝備準備類廢棄計數滿而伺服器未達成不算多算。
import { describe, expect, it } from 'vitest';
import { checkPrep, questPrepDef, type PrepFacts, type PrepFleet } from '../utils/quest-prep';
import { factoryGains, questGoalFor } from '../utils/quest-goals';
import { GameState } from '../utils/state';

const fleetOf = (ships: { ids: number[]; stype?: number; ctype?: number; lv?: number; soku?: number }[]): PrepFleet => ({
    countsAs: ships.map(ship => ship.ids),
    stype: ships.map(ship => ship.stype ?? 2),
    ctype: ships.map(ship => ship.ctype ?? 0),
    lv: ships.map(ship => ship.lv ?? 99),
    soku: ships.map(ship => ship.soku ?? 10),
});

const facts = (over: Partial<PrepFacts> = {}): PrepFacts => ({
    fleets: [fleetOf([]), fleetOf([]), fleetOf([]), fleetOf([])],
    secretarySlots: [],
    freeGears: [],
    materials: [0, 0, 0, 0, 0, 0, 0, 0],
    useItems: new Map(),
    furnitureCoins: 0,
    mapCleared: () => null,
    ...over,
});

describe('條件表', () => {
    it('kcwiki 舊資料的錯誤已依現行說明修正：149 為五艘中任四艘且僅四艘', () => {
        expect(questPrepDef(149)).toEqual({
            kind: 'composition', code: 'A47', fleet: 'any',
            reqs: [{ k: 'ships', ships: [9, 10, 32, 11, 33], n: 4 }, { k: 'size', max: 4 }],
        });
    });

    it('使用者確認的條件：A3 輕巡旗艦＋駆逐艦 2 艘；F118 的「バルジ」暫且只計可開發的兩件増設バルジ', () => {
        expect(questPrepDef(103)?.reqs).toEqual([{ k: 'flagType', types: [3] }, { k: 'types', types: [2], n: 2 }]);
        const def = questGoalFor(1130, undefined)!;
        expect(def.subgoals[2]).toMatchObject({ slotitemId: [72, 73], required: 3 });
        expect(factoryGains(def, { event: 'destory_item', amount: 1, gears: [{ id: 72, type: 27 }, { id: 136, type: 28 }, { id: 73, type: 28 }] }))
            .toEqual(new Map([[2, 2]]));
    });

    it('來源條件表沒有的裝備準備任務，以本表的廢棄條件計數', () => {
        const def = questGoalFor(626, undefined)!;
        expect(def.supported).toBe(true);
        expect(def.subgoals.map(sub => [sub.slotitemId, sub.required])).toEqual([[[20], 2], [[19], 1]]);
        expect(questGoalFor(624, undefined)!.subgoals[0]).toMatchObject({ anyItem: true, required: 7 });
    });
});

describe('編成任務', () => {
    const def114 = questPrepDef(114)!;
    const nagumo = [{ ids: [83] }, { ids: [84] }, { ids: [91] }, { ids: [90] }];

    it('未指定艦隊時看任一艦隊，回報所用艦隊', () => {
        const result = checkPrep(def114, facts({ fleets: [fleetOf([{ ids: [1] }]), fleetOf(nagumo), fleetOf([]), fleetOf([])] }));
        expect(result).toMatchObject({ ready: true, fleet: 2 });
    });

    it('僅列出的艦：多一艘就不符合', () => {
        const result = checkPrep(def114, facts({ fleets: [fleetOf([...nagumo, { ids: [1] }]), fleetOf([]), fleetOf([]), fleetOf([])] }));
        expect(result.ready).toBe(false);
        expect(result.checks.find(check => check.kind === 'size')).toMatchObject({ ok: false, have: 5, max: 4 });
    });

    it('指定第一艦隊與練度：182 旗艦、二番艦各需 Lv50 以上', () => {
        const def = questPrepDef(182)!;
        const fleet = (lv: number) => fleetOf([
            { ids: [82, 77], lv }, { ids: [88, 87], lv: 60 }, { ids: [1], stype: 3 }, { ids: [1] }, { ids: [1] }, { ids: [1], stype: 5 },
        ]);
        expect(checkPrep(def, facts({ fleets: [fleet(60), fleetOf([]), fleetOf([]), fleetOf([])] })).ready).toBe(true);
        expect(checkPrep(def, facts({ fleets: [fleet(49), fleetOf([]), fleetOf([]), fleetOf([])] })).ready).toBe(false);
        expect(checkPrep(def, facts({ fleets: [fleetOf([]), fleet(60), fleetOf([]), fleetOf([])] })).ready).toBe(false);
    });
});

describe('裝備準備／機種轉換', () => {
    it('626：鳳翔旗艦、零戦21型熟練度 ≫、熟練搭乗員', () => {
        const def = questPrepDef(626)!;
        const base = { fleets: [fleetOf([{ ids: [89], stype: 7 }]), fleetOf([]), fleetOf([]), fleetOf([])] };
        const ok = facts({ ...base, secretarySlots: [{ mst: 20, level: 0, alv: 7 }], useItems: new Map([[70, 1]]) });
        expect(checkPrep(def, ok).ready).toBe(true);
        expect(checkPrep(def, { ...ok, secretarySlots: [{ mst: 20, level: 0, alv: 6 }] }).ready).toBe(false);
        expect(checkPrep(def, { ...ok, useItems: null }).ready).toBeNull();
    });

    it('持有只算未裝備的裝備，★ 門檻照算；裝備清單未收到為不可考', () => {
        const def = questPrepDef(1111)!;
        const gears = [{ mst: 180, level: 10, alv: 0 }, { mst: 169, level: 0, alv: 0 }, { mst: 169, level: 0, alv: 0 }];
        expect(checkPrep(def, facts({ freeGears: gears, useItems: new Map([[70, 3]]) })).ready).toBe(true);
        expect(checkPrep(def, facts({ freeGears: [{ ...gears[0], level: 9 }, gears[1], gears[2]], useItems: new Map([[70, 3]]) })).ready).toBe(false);
        expect(checkPrep(def, facts({ freeGears: null, useItems: new Map([[70, 3]]) })).ready).toBeNull();
    });

    it('鎖定的裝備：準備用的不計入持有，轉換用的秘書艦裝備判不符合；留在艦上的不要求解鎖', () => {
        const def645 = questPrepDef(645)!;
        const drums = [{ mst: 75, level: 0, alv: 0 }, { mst: 75, level: 0, alv: 0, locked: true }, { mst: 36, level: 0, alv: 0 }];
        const hold = checkPrep(def645, facts({ freeGears: drums, materials: [750, 750, 0, 0, 0, 0, 0, 0] })).checks.find(check => check.ids[0] === 75)!;
        expect(hold).toMatchObject({ kind: 'hold', ok: false, have: 1, locked: 1 });

        const def626 = questPrepDef(626)!;
        const fleets = [fleetOf([{ ids: [89], stype: 7 }]), fleetOf([]), fleetOf([]), fleetOf([])];
        const slot = (locked: boolean) => checkPrep(def626, facts({ fleets, secretarySlots: [{ mst: 20, level: 0, alv: 7, locked }], useItems: new Map([[70, 1]]) }));
        expect(slot(true).checks.find(check => check.kind === 'slot')).toMatchObject({ ok: false, locked: 1 });
        expect(slot(false).ready).toBe(true);

        const def678 = questPrepDef(678)!;
        const fighters = [{ mst: 21, level: 0, alv: 0, locked: true }, { mst: 21, level: 0, alv: 0, locked: true }];
        expect(checkPrep(def678, facts({ secretarySlots: fighters, materials: [0, 0, 0, 4000, 0, 0, 0, 0] })).ready).toBe(true);
    });

    it('任一格的條件不重複使用同一件裝備（639 要兩種魚雷各一）', () => {
        const def = questPrepDef(639)!;
        const fleets = [fleetOf([{ ids: [50] }]), fleetOf([]), fleetOf([]), fleetOf([])];
        const torpedo = (mst: number) => ({ mst, level: 10, alv: 0 });
        expect(checkPrep(def, facts({ fleets, secretarySlots: [torpedo(58), torpedo(125)], useItems: new Map([[57, 2]]) })).ready).toBe(true);
        expect(checkPrep(def, facts({ fleets, secretarySlots: [torpedo(58), null], useItems: new Map([[57, 2]]) })).ready).toBe(false);
    });

    it('海域攻略：7-4 已攻略為可完成，mapinfo 未收到為不可考', () => {
        const def = questPrepDef(967)!;
        expect(checkPrep(def, facts({ mapCleared: id => id === 74 })).ready).toBe(true);
        expect(checkPrep(def, facts()).ready).toBeNull();
    });
});

describe('GameState 串接', () => {
    function state(flagship: number, slot: { mst: number; alv: number }) {
        const s = new GameState();
        s.applyEvent('api_start2/getData', {
            api_mst_ship: [
                { api_id: 89, api_name: '鳳翔', api_sortno: 89, api_aftershipid: '0', api_stype: 7, api_ctype: 27 },
                { api_id: 1, api_name: '睦月', api_sortno: 1, api_aftershipid: '0', api_stype: 2, api_ctype: 28 },
            ],
            api_mst_slotitem: [
                { api_id: 20, api_name: '零式艦戦21型', api_type: [3, 5, 6, 6, 0] },
                { api_id: 19, api_name: '九六式艦戦', api_type: [3, 5, 6, 6, 0] },
            ],
        }, undefined, 1_000);
        s.applyEvent('api_get_member/slot_item', [
            { api_id: 1, api_slotitem_id: slot.mst, api_alv: slot.alv },
            { api_id: 2, api_slotitem_id: 20 }, { api_id: 3, api_slotitem_id: 20 }, { api_id: 4, api_slotitem_id: 19 },
        ], undefined, 1_100);
        s.applyEvent('api_port/port', {
            api_ship: [{ api_id: 101, api_ship_id: flagship, api_lv: 50, api_nowhp: 30, api_maxhp: 30, api_cond: 49,
                api_slot: [1, -1, -1, -1], api_slot_ex: 0, api_onslot: [], api_soku: 5, api_ndock_time: 0, api_exp: [0, 0, 0] }],
            api_deck_port: [{ api_ship: [101], api_mission: [0, 0, 0, 0] }],
            api_material: [1, 2, 3, 4, 5, 6, 7, 8].map((id, i) => ({ api_id: id, api_value: i < 4 ? 1000 : 10 })),
            api_ndock: [], api_basic: { api_fcoin: 3000 },
        }, undefined, 1_200);
        s.applyEvent('api_get_member/require_info', { api_slot_item: [
            { api_id: 1, api_slotitem_id: slot.mst, api_alv: slot.alv },
            { api_id: 2, api_slotitem_id: 20 }, { api_id: 3, api_slotitem_id: 20 }, { api_id: 4, api_slotitem_id: 19 },
        ], api_useitem: [{ api_id: 70, api_count: 1 }] }, undefined, 1_300);
        s.applyEvent('api_get_member/questlist', { api_list: [
            { api_no: 626, api_state: 2, api_title: '精鋭「艦戦」隊の新編成', api_detail: '…', api_progress_flag: 0 },
        ] }, { api_tab_id: '0' }, 2_000);
        return s;
    }

    it('秘書艦條件成立時廢棄才計入；計數滿且條件齊備時可完成，伺服器未達成不算多算', () => {
        const s = state(89, { mst: 20, alv: 7 });
        s.applyEvent('api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: '2,3,4' }, 3_000);
        expect(s.quests_().find(q => q.no === 626)?.progress).toEqual({ count: 3, target: 3 });
        expect(s.quests_().find(q => q.no === 626)?.tracking?.prep).toMatchObject({ kind: 'equipment', ready: true });
        s.applyEvent('api_get_member/questlist', { api_list: [
            { api_no: 626, api_state: 2, api_title: '精鋭「艦戦」隊の新編成', api_detail: '…', api_progress_flag: 2 },
        ] }, { api_tab_id: '0' }, 3_100);
        expect(s.quests_().find(q => q.no === 626)?.tracking?.recheck).toBe(false);
    });

    it('秘書艦裝備的熟練度不足時，廢棄不計入', () => {
        const s = state(89, { mst: 20, alv: 6 });
        s.applyEvent('api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: '2,3,4' }, 3_000);
        expect(s.quests_().find(q => q.no === 626)?.progress).toEqual({ count: 0, target: 3 });
        expect(s.quests_().find(q => q.no === 626)?.tracking?.prep?.ready).toBe(false);
    });

    it('裝備鎖定：取自 api_locked，api_req_kaisou/lock 即時更新', () => {
        const s = state(89, { mst: 20, alv: 7 });
        expect(s.slotItems.get(2)?.locked).toBe(false);
        s.applyEvent('api_req_kaisou/lock', { api_locked: 1 }, { api_slotitem_id: '1' }, 2_500);
        expect(s.slotItems.get(1)?.locked).toBe(true);
        expect(s.quests_().find(q => q.no === 626)?.tracking?.prep?.checks.find(check => check.kind === 'slot')).toMatchObject({ ok: false, locked: 1 });
        s.applyEvent('api_get_member/slot_item', [{ api_id: 1, api_slotitem_id: 20, api_alv: 7, api_locked: 0 }], undefined, 2_600);
        expect(s.slotItems.get(1)?.locked).toBe(false);
    });

    it('家具幣取自 api_basic.api_fcoin', () => {
        expect(state(89, { mst: 20, alv: 7 }).furnitureCoins).toBe(3000);
    });
});
