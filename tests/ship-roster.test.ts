// utils/ship-roster.ts 的純函式驗證。素質／改修上限／補強增設等欄位一律以
// samples/start2-master.json（真實完整 start2 的去識別化子集）餵進 GameState 後取得，
// 不手捏 master——CLAUDE.md「涉及封包欄位結構的機制先拿真實封包對照」。
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameState, type OwnedShipView } from '../utils/state';
import {
    GEAR_TYPE, MARRIED_LV, SPARKLE_COND, annotateRoster, emptyRosterFilter,
    filterRoster, isOpeningAsw, isOpeningTorpedo, paginate, sortRoster,
} from '../utils/ship-roster';
import { nationOptions } from '../utils/ship-filter';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

/** 依裝備 master id 建一個 slot item 實例，回傳實例 id。 */
let nextInstance = 1000;

function build(ships: {
    id?: number; mst: number; lv?: number; cond?: number; slots?: number[]; slotEx?: number;
    taisen?: number; kyouka?: number[]; sally?: number;
}[], opts: { fleet?: number[] } = {}): OwnedShipView[] {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);

    const slotItems: any[] = [];
    const apiShips = ships.map((s, i) => {
        const slotIds = (s.slots ?? []).map(gearMst => {
            const id = nextInstance++;
            slotItems.push({ api_id: id, api_slotitem_id: gearMst, api_level: 0, api_alv: 0 });
            return id;
        });
        const mst = master.api_mst_ship.find((m: any) => m.api_id === s.mst);
        return {
            api_id: s.id ?? 100 + i,
            api_ship_id: s.mst,
            api_lv: s.lv ?? 1,
            api_exp: [0, 0, 0],
            api_nowhp: mst.api_taik[0], api_maxhp: mst.api_taik[0],
            api_cond: s.cond ?? 49,
            api_soku: mst.api_soku, api_leng: mst.api_leng,
            api_slot: slotIds, api_slot_ex: s.slotEx ?? 0,
            api_kyouka: s.kyouka ?? [0, 0, 0, 0, 0, 0, 0],
            api_locked: 1, api_sally_area: s.sally ?? 0,
            api_karyoku: [mst.api_houg[0], mst.api_houg[1]],
            api_raisou: [mst.api_raig[0], mst.api_raig[1]],
            api_taiku: [mst.api_tyku[0], mst.api_tyku[1]],
            api_soukou: [mst.api_souk[0], mst.api_souk[1]],
            api_taisen: [s.taisen ?? 0, s.taisen ?? 0],
            api_kaihi: [10, 20], api_sakuteki: [5, 10],
            api_lucky: [mst.api_luck[0], mst.api_luck[1]],
        };
    });
    state.applyEvent('api_get_member/require_info', { api_slot_item: slotItems });
    state.applyEvent('api_port/port', {
        api_ship: apiShips,
        api_deck_port: [{ api_ship: [...(opts.fleet ?? []), -1, -1, -1, -1, -1, -1].slice(0, 6), api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    return state.ownedShips();
}

const roster = (ships: OwnedShipView[]) =>
    annotateRoster(ships, { debutOf: () => null, obtainedOf: () => null });

// 真實 master 的參照 id（測試裡到處用，集中在此並註明是什麼）
const MUTSUKI = 1;        // 睦月（未改造・後續改造あり）
const MURAKUMO_K2 = 420;  // 叢雲改二（改造終点・改修上限が houg 等と一致することを確認済み）
const ISUZU_K2 = 141;     // 五十鈴改二（先制対潜の例外艦）
const FLETCHER = 596;     // Fletcher（ctype 91＝例外艦級）
const SONAR_93 = 45;      // 三式爆雷投射機（type[2]=15 爆雷）
const KOUHYOUTEKI = 41;   // 甲標的 甲型（type[2]=22）

beforeAll(() => {
    // 使用的參照 id 真的在 fixture 裡，且類別如註解所述——測試本身也要防手滑。
    const gear = (id: number) => master.api_mst_slotitem.find((g: any) => g.api_id === id);
    expect(gear(SONAR_93).api_type[2]).toBe(GEAR_TYPE.depthCharge);
    expect(gear(KOUHYOUTEKI).api_type[2]).toBe(GEAR_TYPE.midget);
    expect(master.api_mst_ship.find((s: any) => s.api_id === FLETCHER).api_ctype).toBe(91);
});

describe('素質與改修欄位（以真實 start2 建立）', () => {
    it('近代化改修上限＝master 的 (最大−初期)，四項全滿才算已滿', () => {
        const [none, full] = build([
            { mst: MURAKUMO_K2, kyouka: [0, 0, 0, 0, 0, 0, 0] },
            { mst: MURAKUMO_K2, kyouka: [43, 57, 47, 37, 0, 0, 0] },
        ]);

        // 叢雲改二：houg[14,57]／raig[32,89]／tyku[27,74]／souk[14,51]
        expect(full.kyoukaMax).toEqual([43, 57, 47, 37]);
        const rows = roster([none, full]);
        expect(rows.map(r => r.modernFull)).toEqual([false, true]);
        expect(rows.map(r => r.modernSpecial)).toEqual([false, false]);
    });

    it('特殊改修看的是運／耐久／對潛（api_kyouka[4..6]），與四項是否全滿無關', () => {
        const rows = roster(build([{ mst: MURAKUMO_K2, kyouka: [0, 0, 0, 0, 3, 0, 0] }]));
        expect(rows[0]).toMatchObject({ modernFull: false, modernSpecial: true });
    });

    it('改造終點以 api_aftershipid 判定，非以等級', () => {
        const [mutsuki, murakumo] = build([{ mst: MUTSUKI, lv: 99 }, { mst: MURAKUMO_K2, lv: 1 }]);
        expect(mutsuki.remodelDone).toBe(false);
        expect(murakumo.remodelDone).toBe(true);
    });

    it('裸素質＝顯示值扣掉裝備自身加成', () => {
        // 三式爆雷投射機 api_houg 為 0、api_tais > 0，故只有對潛會被扣回去。
        const gear = master.api_mst_slotitem.find((g: any) => g.api_id === SONAR_93);
        const [ship] = build([{ mst: MURAKUMO_K2, slots: [SONAR_93], taisen: 60 }]);
        expect(ship.stats.asw - ship.bareStats.asw).toBe(gear.api_tais);
        expect(ship.bareStats.firepower).toBe(ship.stats.firepower - gear.api_houg);
    });

    it('補強增設三態：無孔／有孔未裝／已裝', () => {
        const ships = build([
            { mst: MUTSUKI, slotEx: 0 }, { mst: MUTSUKI, slotEx: -1 },
        ]);
        expect(ships.map(s => s.exSlotOpen)).toEqual([false, true]);
        expect(ships.map(s => s.exEmpty)).toEqual([false, true]);
    });
});

describe('開幕：開幕雷擊是事實、先制對潛是推算', () => {
    it('開幕雷擊只看有沒有裝甲標的', () => {
        const [with_, without] = build([
            { mst: MURAKUMO_K2, slots: [KOUHYOUTEKI] }, { mst: MURAKUMO_K2, slots: [] },
        ]);
        expect(isOpeningTorpedo(with_)).toBe(true);
        expect(isOpeningTorpedo(without)).toBe(false);
    });

    it('一般艦需要聲納＋對潛 100；爆雷不算聲納', () => {
        const [noSonar, sonarLow, sonarHigh] = build([
            { mst: MURAKUMO_K2, slots: [SONAR_93], taisen: 120 },
            { mst: MURAKUMO_K2, slots: [SONAR_93], taisen: 80 },
            { mst: MURAKUMO_K2, slots: [sonarGearId()], taisen: 120 },
        ]);
        expect(isOpeningAsw(noSonar)).toBe(false);
        expect(isOpeningAsw(sonarLow)).toBe(false);
        expect(isOpeningAsw(sonarHigh)).toBe(true);
    });

    it('例外艦（單艦 id 與整個艦級）不需要聲納，但仍需對潛 100', () => {
        const [isuzu, fletcher, fletcherLow] = build([
            { mst: ISUZU_K2, taisen: 100 },
            { mst: FLETCHER, taisen: 100 },
            { mst: FLETCHER, taisen: 99 },
        ]);
        expect(isOpeningAsw(isuzu)).toBe(true);
        expect(isOpeningAsw(fletcher)).toBe(true);
        expect(isOpeningAsw(fletcherLow)).toBe(false);
    });

    it('對潛 0 的艦一律不成立（戰艦等）', () => {
        const [yamato] = build([{ mst: 136, taisen: 0 }]);   // 大和改
        expect(isOpeningAsw(yamato)).toBe(false);
    });
});

/** fixture 裡任一個「ソナー」類別的裝備 id（不寫死型號，避免 fixture 換版就壞）。 */
function sonarGearId(): number {
    const g = master.api_mst_slotitem.find((x: any) => x.api_type[2] === GEAR_TYPE.sonar);
    return g.api_id;
}

describe('補強增設可裝的特殊類別（對真實 master 全艦驗算）', () => {
    it('六個增設篩選選項在真實資料下都不是空桶，且不含全艦通用的類別', () => {
        const state = new GameState();
        state.applyEvent('api_start2/getData', master);
        const counts = new Map<number, number>();
        for (const s of master.api_mst_ship) {
            if (!s.api_sortno) continue;   // 図鑑外（深海棲艦等）不算
            // 等級門檻取上限，這裡問的是「這艘船有沒有這個能力」而非「現在夠不夠等級」。
            for (const type of state.exSlotSpecialTypes(s.api_id, 185)) {
                counts.set(type, (counts.get(type) ?? 0) + 1);
            }
        }
        // UI 的六個選項＋「所有特殊」。空桶＝選了之後永遠零筆，等於選項壞掉。
        for (const type of [
            GEAR_TYPE.secondary, GEAR_TYPE.smallRadar, GEAR_TYPE.largeRadar,
            GEAR_TYPE.depthCharge, GEAR_TYPE.landingCraft, GEAR_TYPE.commandFacility,
            GEAR_TYPE.boiler,
        ]) expect(counts.get(type) ?? 0).toBeGreaterThan(0);

        // 全艦通用清單（api_mst_equip_exslot）裡的類別沒有鑑別度，刻意不列進來。
        for (const type of state.exSlotTypes) expect(counts.has(type)).toBe(false);
    });
});

describe('篩選', () => {
    const ships = () => build([
        { id: 1, mst: MUTSUKI, lv: MARRIED_LV, cond: SPARKLE_COND, slotEx: -1, sally: 3 },
        { id: 2, mst: MUTSUKI, lv: 20, cond: 40 },
        { id: 3, mst: MURAKUMO_K2, lv: 80, cond: 20 },
    ], { fleet: [1] });
    const ids = (patch: Partial<ReturnType<typeof emptyRosterFilter>>) =>
        filterRoster(roster(ships()), { ...emptyRosterFilter(), ...patch }).map(s => s.id).sort();

    it('三態欄位各自獨立', () => {
        expect(ids({ married: 'yes' })).toEqual([1]);
        expect(ids({ married: 'no' })).toEqual([2, 3]);
        expect(ids({ inFleet: 'yes' })).toEqual([1]);
        expect(ids({ locked: 'no' })).toEqual([]);
        expect(ids({ sparkle: 'yes' })).toEqual([1]);
        expect(ids({ exSlotOpen: 'yes' })).toEqual([1]);
    });

    it('多號機以基礎形態計數：睦月×2 算重複，叢雲改二只有一艘不算', () => {
        expect(ids({ duplicate: 'yes' })).toEqual([1, 2]);
        expect(ids({ duplicate: 'no' })).toEqual([3]);
    });

    it('等級範圍與出擊標籤', () => {
        expect(ids({ lvMin: 21 })).toEqual([1, 3]);
        expect(ids({ lvMax: 20 })).toEqual([2]);
        expect(ids({ sallyArea: 3 })).toEqual([1]);
        expect(ids({ sallyArea: 0 })).toEqual([2, 3]);
    });

    it('改造與射程沿用真實 master 值', () => {
        expect(ids({ remodel: 'done' })).toEqual([3]);
        expect(ids({ remodel: 'pending' })).toEqual([1, 2]);
        expect(ids({ leng: 1 })).toEqual([1, 2, 3]);   // 駆逐艦は全て射程「短」
        expect(ids({ leng: 3 })).toEqual([]);
    });

    it('未設定的維度不篩掉任何人', () => {
        expect(ids({})).toEqual([1, 2, 3]);
    });
});

describe('國籍篩選', () => {
    // 真實 master 的參照：叢雲改二＝日本、Iowa＝美國、Warspite＝英國。
    const IOWA = 440, WARSPITE = 439;
    const ships = () => build([
        { id: 1, mst: MURAKUMO_K2 }, { id: 2, mst: IOWA }, { id: 3, mst: WARSPITE },
    ]);
    const ids = (nations: any[]) =>
        filterRoster(roster(ships()), { ...emptyRosterFilter(), nations }).map(s => s.id).sort();

    it('國籍由 ctype 查表而來，空陣列＝不限', () => {
        expect(roster(ships()).map(s => s.nation)).toEqual(['jp', 'us', 'gb']);
        expect(ids([])).toEqual([1, 2, 3]);
    });

    it('多選＝聯集', () => {
        expect(ids(['us'])).toEqual([2]);
        expect(ids(['us', 'gb'])).toEqual([2, 3]);
        expect(ids(['jp'])).toEqual([1]);
    });

    it('選項只列名冊裡實際有船的國家，並依 NATIONS 順序帶出艘數', () => {
        expect(nationOptions(roster(ships()))).toEqual([
            { nation: 'jp', count: 1 }, { nation: 'us', count: 1 }, { nation: 'gb', count: 1 },
        ]);
    });

    it('依國籍排序用顯示順序，不用字母序', () => {
        expect(sortRoster(roster(ships()), 'nation', 'asc').map(s => s.nation)).toEqual(['jp', 'us', 'gb']);
    });

    it('Верный 可從日本與蘇聯國籍篩選找到', () => {
        const rows = roster(build([{ id: 147, mst: 147 }]));
        expect(rows[0]).toMatchObject({ nation: 'jp', nations: ['jp', 'su'] });
        expect(filterRoster(rows, { ...emptyRosterFilter(), nations: ['jp'] }).map(s => s.id)).toEqual([147]);
        expect(filterRoster(rows, { ...emptyRosterFilter(), nations: ['su'] }).map(s => s.id)).toEqual([147]);
    });
});

describe('排序與分頁', () => {
    const rows = roster(build([
        { id: 1, mst: MUTSUKI, lv: 5 }, { id: 2, mst: MURAKUMO_K2, lv: 90 }, { id: 3, mst: MUTSUKI, lv: 50 },
    ]));

    it('等級遞減／遞增，同值以艦實例 id 穩定', () => {
        expect(sortRoster(rows, 'level', 'desc').map(s => s.id)).toEqual([2, 3, 1]);
        expect(sortRoster(rows, 'level', 'asc').map(s => s.id)).toEqual([1, 3, 2]);
    });

    it('夜戰＝火力＋雷裝', () => {
        const first = sortRoster(rows, 'night', 'desc')[0];
        expect(first.night).toBe(first.stats.firepower + first.stats.torpedo);
    });

    it('缺值一律排最後，不論升冪降冪', () => {
        const withDates = rows.map((r, i) => ({ ...r, obtainedTs: i === 1 ? null : 1000 + i }));
        expect(sortRoster(withDates, 'joined', 'asc').at(-1)!.id).toBe(2);
        expect(sortRoster(withDates, 'joined', 'desc').at(-1)!.id).toBe(2);
    });

    it('分頁：0＝全部，超出範圍會夾回有效頁', () => {
        const items = Array.from({ length: 25 }, (_, i) => i + 1);
        expect(paginate(items, 10, 2)).toMatchObject({ page: 2, pageCount: 3, from: 11, to: 20 });
        expect(paginate(items, 10, 99)).toMatchObject({ rows: [21, 22, 23, 24, 25], page: 3, from: 21, to: 25 });
        expect(paginate(items, 0, 1)).toMatchObject({ rows: items, pageCount: 1, from: 1, to: 25 });
        expect(paginate([], 10, 1)).toMatchObject({ rows: [], page: 1, from: 0, to: 0, total: 0 });
    });
});
