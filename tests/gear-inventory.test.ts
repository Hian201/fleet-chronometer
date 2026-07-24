// utils/gear-inventory.ts 的純函式驗證，以及 GameState.ownedGears() 的持有者反查。
//
// 裝備素質／類別名／圖示 id 一律以 samples/start2-master.json（真實完整 start2 的
// 去識別化子集）餵進 GameState 後取得，不手捏 master——CLAUDE.md「涉及封包欄位結構的
// 機制先拿真實封包對照」。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, type OwnedGearView } from '../utils/state';
import {
    emptyGearFilter, filterGears, groupGears, iconOptions, sortGears, stackInstances, totalCount,
} from '../utils/gear-inventory';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const gearMst = (name: string) => {
    const hit = master.api_mst_slotitem.find((g: any) => g.api_name === name);
    if (!hit) throw new Error(`fixture 缺裝備：${name}`);
    return hit.api_id as number;
};

// 真實 master 裡挑幾顆語意明確的裝備當樣本。
const AKASHI_REPAIR = gearMst('艦艇修理施設');   // 火力 0、純設施
const GUN_41 = gearMst('41cm連装砲');            // 大口径主砲：火力高、射程長
const FIGHTER = gearMst('零式艦戦52型');         // 艦戦：對空高於主砲、有熟練度
const RATION = gearMst('戦闘糧食');              // 消耗品（CONSUMABLE_NAMES 之一）

interface Slot { id: number; mst: number; level?: number; alv?: number }

/**
 * 建一個持有指定裝備的 GameState。ships/lbas 以裝備實例 id 指定裝在誰身上，
 * 其餘實例即為閒置。回傳 ownedGears() 的結果。
 */
function build(slots: Slot[], opts: {
    ships?: { mst: number; slots: number[]; slotEx?: number }[];
    lbas?: { name: string; slots: number[] }[];
} = {}): OwnedGearView[] {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: slots.map(s => ({
            api_id: s.id, api_slotitem_id: s.mst, api_level: s.level ?? 0, api_alv: s.alv ?? 0,
        })),
    });

    const apiShips = (opts.ships ?? []).map((s, i) => {
        const mst = master.api_mst_ship.find((m: any) => m.api_id === s.mst);
        return {
            api_id: 100 + i, api_ship_id: s.mst, api_lv: 1, api_exp: [0, 0, 0],
            api_nowhp: mst.api_taik[0], api_maxhp: mst.api_taik[0], api_cond: 49,
            api_soku: mst.api_soku, api_leng: mst.api_leng,
            api_slot: s.slots, api_slot_ex: s.slotEx ?? 0,
            api_kyouka: [0, 0, 0, 0, 0, 0, 0], api_locked: 1, api_sally_area: 0,
            api_karyoku: [0, 0], api_raisou: [0, 0], api_taiku: [0, 0], api_soukou: [0, 0],
            api_taisen: [0, 0], api_kaihi: [0, 0], api_sakuteki: [0, 0], api_lucky: [0, 0],
        };
    });
    state.applyEvent('api_port/port', {
        api_ship: apiShips, api_deck_port: [{ api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });

    if (opts.lbas?.length) {
        state.applyEvent('api_get_member/base_air_corps', opts.lbas.map((b, i) => ({
            api_area_id: 6, api_rid: i + 1, api_name: b.name, api_action_kind: 1,
            api_distance: { api_base: 3, api_bonus: 0 },
            api_plane_info: b.slots.map(slotId => ({
                api_squadron_id: 1, api_state: 1, api_slotid: slotId, api_count: 18, api_max_count: 18, api_cond: 1,
            })),
        })));
    }
    return state.ownedGears();
}

describe('ownedGears：實例 → master + 持有者反查', () => {
    it('素質欄位取自真實 master，且未含改修加成', () => {
        const gears = build([{ id: 1, mst: GUN_41, level: 7 }]);
        const gun = master.api_mst_slotitem.find((g: any) => g.api_id === GUN_41);
        expect(gears).toHaveLength(1);
        // ★7 的實例，素質仍是 master 的基礎值（改修加成公式未經驗證，刻意不推導）
        expect(gears[0].level).toBe(7);
        expect(gears[0].stats.houg).toBe(gun.api_houg);
        expect(gears[0].stats.leng).toBe(gun.api_leng);
        expect(gears[0].stats.houm).toBe(gun.api_houm);
        expect(gears[0].stats.baku).toBe(gun.api_baku);
        // 圖示 id＝api_type[3]，即 public/icons/equipment/<icon>.svg
        expect(gears[0].icon).toBe(gun.api_type[3]);
        expect(gears[0].catName).toBe('大口径主砲');
    });

    it('艦・補強增設・基地航空隊三種持有者都認得，其餘為閒置', () => {
        const gears = build(
            [
                { id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41 },
                { id: 3, mst: AKASHI_REPAIR }, { id: 4, mst: FIGHTER },
            ],
            {
                ships: [{ mst: 182 /* 明石 */, slots: [1], slotEx: 3 }],
                lbas: [{ name: '第一航空隊', slots: [4] }],
            },
        );
        const byId = new Map(gears.map(g => [g.id, g]));
        expect(byId.get(1)!.holder).toMatchObject({ kind: 'ship', name: '明石', ex: false });
        expect(byId.get(3)!.holder).toMatchObject({ kind: 'ship', name: '明石', ex: true });
        expect(byId.get(4)!.holder).toMatchObject({ kind: 'lbas', name: '第一航空隊' });
        // 沒被任何艦或基地使用的才是閒置
        expect(byId.get(2)!.holder).toBeNull();
    });

    it('消耗品被標記出來（不計入裝備欄上限，故 UI 要能獨立篩選）', () => {
        const gears = build([{ id: 1, mst: RATION }, { id: 2, mst: GUN_41 }]);
        expect(gears.find(g => g.mst === RATION)!.consumable).toBe(true);
        expect(gears.find(g => g.mst === GUN_41)!.consumable).toBe(false);
    });
});

describe('groupGears：實例 → 種類彙總', () => {
    const gears = build(
        [
            { id: 1, mst: GUN_41, level: 10 }, { id: 2, mst: GUN_41, level: 6 },
            { id: 3, mst: GUN_41, level: 6 }, { id: 4, mst: GUN_41 },
            { id: 5, mst: FIGHTER, alv: 7 },
        ],
        { ships: [{ mst: 182, slots: [1, 2] }] },
    );
    const groups = groupGears(gears);
    const gun = groups.find(g => g.mst === GUN_41)!;

    it('同 master 合成一組，數量／裝備中／閒置相加', () => {
        expect(gun.count).toBe(4);
        expect(gun.equipped).toBe(2);
        expect(gun.idle).toBe(2);
    });

    it('改修分佈由高到低，maxLevel 為最高星數', () => {
        expect(gun.maxLevel).toBe(10);
        expect(gun.levels).toEqual([
            { level: 10, count: 1 }, { level: 6, count: 2 }, { level: 0, count: 1 },
        ]);
    });

    it('同一艘裝兩顆算一個持有者 ×2（欄位問的是「裝在誰身上」）', () => {
        expect(gun.holders).toEqual([{ name: '明石', sub: '工作', kind: 'ship', count: 2 }]);
    });

    it('instances 保留原件：改修高者在前、同星數時裝備中的在前', () => {
        expect(gun.instances.map(i => i.id)).toEqual([1, 2, 3, 4]);
        // 熟練度屬實例層級，彙總不吃掉它
        expect(groups.find(g => g.mst === FIGHTER)!.instances[0].alv).toBe(7);
    });

    it('輸出為圖鑑順（api_sortno），與遊戲內的裝備一覧同序', () => {
        const sortNos = groups.map(g => g.sortNo);
        expect([...sortNos].sort((a, b) => a - b)).toEqual(sortNos);
    });
});

describe('stackInstances：展開列把同規格的實例疊成一行', () => {
    it('改修★＋熟練度＋持有者全同才疊在一起，並計數', () => {
        const gears = build(
            [
                // 三顆 ★0 閒置 → 疊成一行 ×3
                { id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41 }, { id: 3, mst: GUN_41 },
                // 兩顆 ★6 裝在同一艘 → 疊成一行 ×2
                { id: 4, mst: GUN_41, level: 6 }, { id: 5, mst: GUN_41, level: 6 },
            ],
            { ships: [{ mst: 182, slots: [4, 5] }] },
        );
        const stacks = stackInstances(groupGears(gears)[0].instances);
        expect(stacks).toHaveLength(2);
        expect(stacks[0]).toMatchObject({ level: 6, count: 2, ids: [4, 5] });
        expect(stacks[0].holder).toMatchObject({ name: '明石' });
        expect(stacks[1]).toMatchObject({ level: 0, count: 3, holder: null, ids: [1, 2, 3] });
    });

    it('改修不同就不疊（同一艘船也一樣）', () => {
        const gears = build(
            [{ id: 1, mst: GUN_41, level: 6 }, { id: 2, mst: GUN_41, level: 3 }],
            { ships: [{ mst: 182, slots: [1, 2] }] },
        );
        expect(stackInstances(groupGears(gears)[0].instances).map(s => s.level)).toEqual([6, 3]);
    });

    it('熟練度不同就不疊（艦載機的 alv 是實例層級的差異）', () => {
        const gears = build([
            { id: 1, mst: FIGHTER, alv: 7 }, { id: 2, mst: FIGHTER, alv: 7 }, { id: 3, mst: FIGHTER },
        ]);
        const stacks = stackInstances(groupGears(gears)[0].instances);
        expect(stacks.map(s => [s.alv, s.count])).toEqual([[7, 2], [0, 1]]);
    });

    it('持有者不同就不疊；閒置與裝備中也永遠分開', () => {
        const gears = build(
            [{ id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41 }, { id: 3, mst: GUN_41 }],
            { ships: [{ mst: 182, slots: [1] }, { mst: 187 /* 明石改 */, slots: [2] }] },
        );
        const stacks = stackInstances(groupGears(gears)[0].instances);
        expect(stacks).toHaveLength(3);
        expect(stacks.filter(s => s.holder === null)).toHaveLength(1);
    });

    it('補強增設與一般槽不疊在一起（那是兩個不同的位置）', () => {
        const gears = build(
            [{ id: 1, mst: AKASHI_REPAIR }, { id: 2, mst: AKASHI_REPAIR }],
            { ships: [{ mst: 182, slots: [1], slotEx: 2 }] },
        );
        const stacks = stackInstances(groupGears(gears)[0].instances);
        expect(stacks).toHaveLength(2);
        expect(stacks.map(s => s.holder?.ex).sort()).toEqual([false, true]);
    });

    it('疊後的總數等於原本的顆數（不多算也不漏算）', () => {
        const gears = build(
            [
                { id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41 }, { id: 3, mst: GUN_41, level: 6 },
                { id: 4, mst: GUN_41, level: 6 }, { id: 5, mst: GUN_41, level: 10 },
            ],
            { ships: [{ mst: 182, slots: [3] }] },
        );
        const group = groupGears(gears)[0];
        const stacks = stackInstances(group.instances);
        expect(stacks.reduce((n, s) => n + s.count, 0)).toBe(group.count);
        expect(stacks.flatMap(s => s.ids).sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('排序：★高者在前，裝備中的排在閒置之前', () => {
        const gears = build(
            [{ id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41, level: 10 }, { id: 3, mst: GUN_41 }],
            { ships: [{ mst: 182, slots: [3] }] },
        );
        const stacks = stackInstances(groupGears(gears)[0].instances);
        expect(stacks[0].level).toBe(10);
        expect(stacks[1].holder).not.toBeNull();   // ★0 裝備中
        expect(stacks[2].holder).toBeNull();       // ★0 閒置
    });

    it('空輸入回空陣列', () => {
        expect(stackInstances([])).toEqual([]);
    });
});

describe('filterGears', () => {
    const groups = groupGears(build(
        [
            { id: 1, mst: GUN_41, level: 10 }, { id: 2, mst: GUN_41 },
            { id: 3, mst: FIGHTER }, { id: 4, mst: RATION },
        ],
        { ships: [{ mst: 182, slots: [3] }] },
    ));
    const run = (patch: Partial<ReturnType<typeof emptyGearFilter>>) =>
        filterGears(groups, { ...emptyGearFilter(), ...patch }).map(g => g.mst);

    it('預設不篩掉任何東西', () => {
        expect(run({})).toHaveLength(3);
    });

    it('圖示多選＝聯集', () => {
        const iconOf = (mst: number) => groups.find(g => g.mst === mst)!.icon;
        expect(run({ icons: [iconOf(FIGHTER)] })).toEqual([FIGHTER]);
        expect(run({ icons: [iconOf(GUN_41), iconOf(FIGHTER)] })).toHaveLength(2);
    });

    it('關鍵字比對裝備名與類別名', () => {
        expect(run({ search: '41cm' })).toEqual([GUN_41]);
        expect(run({ search: '大口径' })).toEqual([GUN_41]);
        expect(run({ search: 'こんな装備はない' })).toEqual([]);
    });

    it('狀態：群組層級判定（有任一顆符合就保留整組）', () => {
        // 41cm 兩顆都閒置、九六式艦戦裝備中
        expect(run({ usage: 'equipped' })).toEqual([FIGHTER]);
        expect(run({ usage: 'idle' })).toEqual(expect.arrayContaining([GUN_41, RATION]));
        expect(run({ usage: 'idle' })).not.toContain(FIGHTER);
    });

    it('改修：已改修／★MAX／有未改修', () => {
        expect(run({ improve: 'plus' })).toEqual([GUN_41]);
        expect(run({ improve: 'max' })).toEqual([GUN_41]);
        // 41cm 也有一顆 ★0，故「有未改修」同樣命中它
        expect(run({ improve: 'none' })).toEqual(expect.arrayContaining([GUN_41, FIGHTER, RATION]));
    });

    it('消耗品可獨立隱藏或單獨檢視', () => {
        expect(run({ consumable: 'hide' })).not.toContain(RATION);
        expect(run({ consumable: 'only' })).toEqual([RATION]);
    });
});

describe('sortGears', () => {
    const groups = groupGears(build([
        { id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41 }, { id: 3, mst: FIGHTER }, { id: 4, mst: AKASHI_REPAIR },
    ]));

    it('數量：降冪把持有最多的排前面', () => {
        expect(sortGears(groups, 'count', 'desc')[0].mst).toBe(GUN_41);
    });

    it('素質：41cm 的火力高於艦戰與修理設施', () => {
        expect(sortGears(groups, 'houg', 'desc')[0].mst).toBe(GUN_41);
        // 對空則反過來：零式艦戦52型 對空 6 高於 41cm連装砲 的 4（真實 master 值）
        expect(sortGears(groups, 'tyku', 'desc')[0].mst).toBe(FIGHTER);
    });

    it('同值時以圖鑑順收尾，排列可預期（不隨插入順序跳動）', () => {
        // 三者的「運」都是 0，故整串等值 → 應退化成圖鑑順
        const byLuck = sortGears(groups, 'luck', 'desc').map(g => g.sortNo);
        expect([...byLuck].sort((a, b) => a - b)).toEqual(byLuck);
    });

    it('不改動輸入陣列（純函式）', () => {
        const before = groups.map(g => g.mst);
        sortGears(groups, 'count', 'desc');
        expect(groups.map(g => g.mst)).toEqual(before);
    });
});

describe('iconOptions／totalCount', () => {
    const groups = groupGears(build([
        { id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41 }, { id: 3, mst: FIGHTER },
    ], { ships: [{ mst: 182, slots: [3] }] }));

    it('只列實際持有的圖示，並帶種類數與件數', () => {
        const opts = iconOptions(groups);
        const gunIcon = groups.find(g => g.mst === GUN_41)!.icon;
        expect(opts).toHaveLength(2);
        expect(opts.find(o => o.icon === gunIcon)).toMatchObject({ count: 2, kinds: 1, label: '大口径主砲' });
    });

    it('合計：種類、件數、裝備中、閒置', () => {
        expect(totalCount(groups)).toEqual({ kinds: 2, items: 3, equipped: 1, idle: 2 });
    });
});
