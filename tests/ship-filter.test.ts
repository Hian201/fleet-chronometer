// utils/ship-filter.ts（鎮守府全船篩選的共用核心）的驗證。
// 可裝備規則一律以 samples/start2-master.json（真實完整 start2 的去識別化子集）餵進
// GameState 後取得，不手捏 master——CLAUDE.md「涉及封包欄位結構的機制先拿真實封包對照」。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import {
    compareGameOrder, emptyFilter, filterShips, nationOptions, sallyOptions, stypeOptions,
    type EquipFilter, type FilterableShip,
} from '../utils/ship-filter';
import { nationOf, nationsOf } from '../utils/ship-nationality';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const state = new GameState();
state.applyEvent('api_start2/getData', master);

/** 用全 master 造一份名冊：可裝備／國籍都取自真實 master，不手捏。 */
const allShips: FilterableShip[] = master.api_mst_ship.map((s: any) => ({
    id: s.api_id,
    name: s.api_name,
    stypeId: s.api_stype ?? 0,
    nation: nationOf(s.api_ctype ?? 0),
    nations: nationsOf(s.api_id, s.api_ctype ?? 0),
    lv: 1,
    soku: s.api_soku ?? 0,
    equipTypes: [...state.equipTypesOf(s.api_id)],
    sallyArea: 0,
}));

const ship = (o: Partial<FilterableShip> & { id: number }): FilterableShip => ({
    name: `艦${o.id}`, stypeId: 2, nation: 'jp', lv: 1, soku: 10, equipTypes: [], sallyArea: 0, ...o,
});

const countWith = (equip: EquipFilter) => filterShips(allShips, { ...emptyFilter(), equip }).length;

describe('可裝備篩選（逐艦覆蓋規則）', () => {
    // 艦種表說駆逐艦不能裝上陸用舟艇(24)，但遊戲裡有 41 艘驅逐艦裝得了大發系。
    // 只看艦種會把「大發驅逐」整批誤判成不可裝——那正是輸送作戰的核心編成。
    it('大發驅逐不會被艦種預設誤判', () => {
        const ddDefault = Object.entries(master.api_mst_stype.find((s: any) => s.api_id === 2).api_equip_type)
            .filter(([, v]) => v === 1).map(([k]) => Number(k));
        expect(ddDefault).not.toContain(24);
        for (const mstId of [418, 434, 199]) {   // 皐月改二／睦月改二／大潮改二
            expect(state.equipTypesOf(mstId).has(24)).toBe(true);
            expect(ddDefault.every(t => state.equipTypesOf(mstId).has(t))).toBe(true);
        }
    });

    // 七個選項＝「能裝大發系」與「能裝內火艇」兩個布林的組合。
    // 數字為全 1751 艦的實算值（與獨立的 Python 統計一致），七桶皆非空。
    it.each([
        ['landingCraft', 96], ['naikatei', 199], ['both', 62],
        ['landingOnly', 34], ['naikateiOnly', 137], ['either', 233], ['neither', 1518],
    ] as [EquipFilter, number][])('%s → %i 艘', (equip, expected) => {
        expect(countWith(equip)).toBe(expected);
    });

    it('七桶彼此自洽', () => {
        expect(countWith('both') + countWith('landingOnly') + countWith('naikateiOnly'))
            .toBe(countWith('either'));
        expect(countWith('either') + countWith('neither')).toBe(allShips.length);
        expect(countWith('all')).toBe(allShips.length);
    });
});

describe('國籍篩選（共用維度）', () => {
    const roster = [
        ship({ id: 1, nation: 'jp' }), ship({ id: 2, nation: 'us' }),
        ship({ id: 3, nation: 'fr' }), ship({ id: 4, nation: 'us' }),
        ship({ id: 5, nation: null }),   // master 未載入＝不可考
    ];

    it('多選＝聯集', () => {
        const ids = (nations: any[]) =>
            filterShips(roster, { ...emptyFilter(), nations }).map(s => s.id).sort();
        expect(ids(['us'])).toEqual([2, 4]);
        expect(ids(['us', 'fr'])).toEqual([2, 3, 4]);
        expect(ids([])).toHaveLength(5);   // 空陣列＝不限
    });

    // 寧可不列，也不要在缺 master 的情況下宣稱某艘是日艦。
    it('國籍不可考的艦不落入任何白名單', () => {
        for (const n of ['jp', 'us', 'fr'] as const) {
            expect(filterShips(roster, { ...emptyFilter(), nations: [n] }).some(s => s.id === 5)).toBe(false);
        }
    });

    it('選項只列名冊裡實際有船的國籍，依顯示順序', () => {
        expect(nationOptions(roster)).toEqual([
            { nation: 'jp', count: 1 }, { nation: 'us', count: 2 }, { nation: 'fr', count: 1 },
        ]);
        expect(nationOptions([ship({ id: 9, nation: null })])).toEqual([]);
    });

    it('真實 master：外國艦型確實被歸出來', () => {
        const opts = nationOptions(allShips);
        const byNation = Object.fromEntries(opts.map(o => [o.nation, o.count]));
        expect(byNation.jp).toBeGreaterThan(0);
        expect(byNation.us).toBeGreaterThan(0);
        expect(byNation.gb).toBeGreaterThan(0);
        expect(opts.map(o => o.nation)[0]).toBe('jp');   // 日本在首（收錄量最大）
    });

    it('Верный 的國籍篩選標籤同時命中日本與蘇聯', () => {
        const verniy = allShips.find(s => s.id === 147)!;
        expect(verniy.nations).toEqual(['jp', 'su']);
        expect(filterShips(allShips, { ...emptyFilter(), nations: ['jp'] })).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 147 })]),
        );
        expect(filterShips(allShips, { ...emptyFilter(), nations: ['su'] })).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 147 })]),
        );
    });
});

describe('航速篩選（門檻比較，未來出現 15/20 不必改碼）', () => {
    const speeds = [
        ship({ id: 1, soku: 5 }), ship({ id: 2, soku: 10 }),
        ship({ id: 3, soku: 15 }), ship({ id: 4, soku: 20 }),
    ];
    const ids = (speed: any) => filterShips(speeds, { ...emptyFilter(), speed }).map(s => s.id).sort();

    it('低速＝未達高速', () => expect(ids('slow')).toEqual([1]));
    it('高速含高速+與最速', () => expect(ids('fast')).toEqual([2, 3, 4]));
    it('高速+含最速', () => expect(ids('fastPlus')).toEqual([3, 4]));
    it('缺失或無效航速不冒充低速，但不限航速時仍保留', () => {
        const unknown = [ship({ id: 5, soku: 0 }), ship({ id: 6, soku: Number.NaN })];
        expect(filterShips(unknown, { ...emptyFilter(), speed: 'all' }).map(s => s.id)).toEqual([5, 6]);
        for (const speed of ['slow', 'fast', 'fastPlus'] as const) {
            expect(filterShips(unknown, { ...emptyFilter(), speed })).toEqual([]);
        }
    });
});

describe('艦種／出擊標籤／關鍵字／排序', () => {
    const roster = [
        ship({ id: 10, name: '大鷹', stypeId: 7, lv: 98, sallyArea: 1 }),
        ship({ id: 11, name: '五十鈴', stypeId: 3, lv: 99, sallyArea: 1 }),
        ship({ id: 12, name: '秋月', stypeId: 2, lv: 95, sallyArea: 0 }),
        ship({ id: 13, name: '涼月', stypeId: 2, lv: 93, sallyArea: 0 }),
    ];
    const ids = (f: any) => filterShips(roster, { ...emptyFilter(), ...f }).map(s => s.id);

    it('艦種白名單', () => expect(ids({ stypeIds: [2] })).toEqual([12, 13]));
    it('只看無標籤（自由身）', () => expect(ids({ sallyArea: 0 })).toEqual([12, 13]));
    it('sallyArea null＝不限', () => expect(ids({ sallyArea: null })).toHaveLength(4));
    it('關鍵字部分比對且去頭尾空白', () => {
        expect(ids({ search: '月' })).toEqual([12, 13]);
        expect(ids({ search: '  大鷹 ' })).toEqual([10]);
    });
    it('預設排序＝等級降冪', () => expect(ids({})).toEqual([11, 10, 12, 13]));
    it('不修改輸入陣列', () => {
        filterShips(roster, emptyFilter(), 'name');
        expect(roster.map(s => s.id)).toEqual([10, 11, 12, 13]);
    });
    it('選項列舉', () => {
        expect(stypeOptions(roster)).toEqual([2, 3, 7]);
        expect(sallyOptions(roster)).toEqual([{ sallyArea: 0, count: 2 }, { sallyArea: 1, count: 2 }]);
    });
});

describe('降級', () => {
    it('master 未載入時不可把所有艦濾光', () => {
        const bare = new GameState();
        expect([...bare.equipTypesOf(418)]).toEqual([]);
        const roster = [ship({ id: 1 })];
        expect(filterShips(roster, emptyFilter())).toHaveLength(1);
    });
});

describe('同值次序對齊遊戲（api_sort_id）', () => {
    // 遊戲艦船選択依 Lv 排序的實際畫面：同 Lv99 依 api_sort_id 升冪，與艦名、入手順序無關。
    // 實例 id 故意打亂，確保次序不是靠入手順序湊出來的。
    const owned: [number, number, number][] = [   // [實例 id, master id, Lv]
        [1, 554, 99], [2, 541, 99], [3, 694, 99], [4, 916, 174], [5, 553, 99],
        [6, 954, 99], [7, 195, 139], [8, 592, 99], [9, 698, 143], [10, 591, 99],
    ];
    const roster = owned.map(([id, mst, lv]) =>
        ship({ id, lv, name: state.master.get(mst)!.name, sortId: state.master.get(mst)!.sortId }));

    it('等級降冪、同等級依 api_sort_id 升冪', () => {
        expect(filterShips(roster, emptyFilter()).map(s => s.name)).toEqual([
            '大和改二重', '加賀改二', '綾波改二',
            '金剛改二丙', '比叡改二丙', '榛名改二丙', '霧島改二丙', '伊勢改二', '日向改二', '長門改二',
        ]);
    });
    it('艦種排序＝api_sort_id 升冪，不比等級、不依艦種 id 分組', () => {
        // 實機艦種排序畫面：Lv1 霧島在 Lv99 霧島改二丙前；扶桑（艦種 9）在扶桑改二（艦種 10）前。
        const byMst: [number, number, number][] = [   // [實例 id, master id, Lv]
            [1, 88, 15], [2, 553, 99], [3, 411, 98], [4, 26, 1], [5, 694, 99],
            [6, 85, 1], [7, 954, 99], [8, 591, 99], [9, 412, 98], [10, 592, 99],
        ];
        const list = byMst.map(([id, mst, lv]) => {
            const m = state.master.get(mst)!;
            return ship({ id, lv, name: m.name, stypeId: m.stype, sortId: m.sortId });
        });
        expect(filterShips(list, emptyFilter(), 'stype').map(s => s.name)).toEqual([
            '金剛改二丙', '比叡改二丙', '榛名改二丙', '霧島', '霧島改二丙',
            '扶桑', '扶桑改二', '山城改二', '伊勢改二', '日向改',
        ]);
    });
    it('海外艦（3xxxx）依 api_sort_id 集中排在艦種排序最後，不併入同艦種', () => {
        // 實機艦種排序最後一頁：Eidsvold改 → Gotland改 → Gotland andra → Visby改 → De Ruyter改 → Perth改。
        const tail = [[1, 618, 98], [2, 1067, 50], [3, 739, 81], [4, 609, 98], [5, 630, 99], [6, 579, 65], [7, 591, 99]]
            .map(([id, mst, lv]) => {
                const m = state.master.get(mst)!;
                return ship({ id, lv, name: m.name, stypeId: m.stype, sortId: m.sortId });
            });
        expect(filterShips(tail, emptyFilter(), 'stype').map(s => s.name)).toEqual([
            '金剛改二丙', 'Eidsvold改', 'Gotland改', 'Gotland andra', 'Visby改', 'De Ruyter改', 'Perth改',
        ]);
    });
    it('sortId 相同比實例 id；不可考者排最後', () => {
        expect([ship({ id: 3, sortId: null }), ship({ id: 2, sortId: 1011 }), ship({ id: 1, sortId: 1011 })]
            .sort(compareGameOrder).map(s => s.id)).toEqual([1, 2, 3]);
    });
});
