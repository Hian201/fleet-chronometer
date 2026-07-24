import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb, type ShipObtainedRow } from '../utils/db';
import { SHIP_NAMES } from '../utils/gamedata-i18n';
import { GameState } from '../utils/state';
import {
    COLUMNS, buildRoster, loadOwnedShipRows, rosterCsv, rosterTableHtml,
    type ColumnId, type TableView,
} from '../entrypoints/overview/sections/ships';
import {
    emptyRosterFilter, filterRoster, sortRoster,
    type RosterFilter, type RosterSortKey, type SortDir,
} from '../utils/ship-roster';
import { setLang, t } from '../utils/ui-i18n';

const databases: KcDb[] = [];
let serial = 0;

function createDb() {
    const database = new KcDb(`kc-ships-overview-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function createState() {
    const state = new GameState();
    state.applyEvent('api_start2/getData', {
        api_mst_ship: [
            { api_id: 1, api_name: 'Alpha <Ship>', api_stype: 2, api_fuel_max: 15, api_bull_max: 15, api_slot_num: 2 },
            { api_id: 2, api_name: 'Bravo', api_stype: 3, api_fuel_max: 20, api_bull_max: 20, api_slot_num: 1 },
        ],
        api_mst_slotitem: [{ api_id: 11, api_name: 'Gun <Mk.1>', api_type: [0, 0, 1, 1] }],
    });
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: [{ api_id: 501, api_slotitem_id: 11, api_level: 4, api_alv: 0 }],
    });
    state.applyEvent('api_port/port', {
        api_ship: [
            { api_id: 101, api_ship_id: 1, api_lv: 70, api_nowhp: 8, api_maxhp: 32, api_cond: 49, api_locked: 1, api_slot: [501, 999], api_slot_ex: -1 },
            { api_id: 102, api_ship_id: 2, api_lv: 30, api_nowhp: 20, api_maxhp: 32, api_cond: 40, api_locked: 0, api_slot: [-1], api_slot_ex: 888 },
            { api_id: 103, api_ship_id: 999, api_lv: 1, api_nowhp: 1, api_maxhp: 1, api_cond: 0, api_locked: 0, api_slot: [777], api_slot_ex: 0 },
        ],
        api_deck_port: [{ api_ship: [101, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    return state;
}

// 表格測試的預設視圖：預設欄位、依等級遞減、素質含裝備。
const view = (cols?: ColumnId[]): TableView => ({
    cols: new Set(cols ?? COLUMNS.filter(c => c.on).map(c => c.id)),
    sort: 'level', dir: 'desc', bare: false,
});
const ctx = { bare: false, tagLabel: (id: number) => `#${id}` };

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
    for (const id of Object.keys(SHIP_NAMES)) delete SHIP_NAMES[Number(id)];
    setLang('ja');
});

describe('艦娘全覽的 GameState 唯讀 view', () => {
    it('包含未編成艦，並提供艦隊、能力、鎖定與既有裝備 view', () => {
        const ships = createState().ownedShips();
        const assigned = ships.find(ship => ship.id === 101)!;
        const unassigned = ships.find(ship => ship.id === 102)!;

        expect(ships.map(ship => ship.id)).toEqual([101, 102, 103]);
        expect(assigned).toMatchObject({ masterId: 1, stype: t('stype.2'), lv: 70, hp: 8, maxhp: 32, cond: 49, locked: true, fleetNo: 1, exEmpty: true });
        expect(assigned.gears[0]).toMatchObject({ name: 'Gun <Mk.1>', level: 4 });
        expect(assigned.gears[1]).toBeNull();
        expect(unassigned).toMatchObject({ fleetNo: null, locked: false });
    });

    it('master data、裝備 master 或 slot item 缺少時安全降級', () => {
        const missing = createState().ownedShips().find(ship => ship.id === 103)!;
        const exMissing = createState().ownedShips().find(ship => ship.id === 102)!;

        expect(missing).toMatchObject({ name: '?', stype: '0', fleetNo: null });
        expect(missing.gears).toEqual([null]);
        expect(exMissing.exGear).toBeNull();
    });
});

describe('艦娘全覽的入手觀測關聯與畫面資料', () => {
    it('以 fake-indexeddb 讀取 auto、manual、baseline、舊資料與缺 row', async () => {
        const database = createDb();
        const state = createState();
        state.ships.set(104, { ...state.ships.get(102), api_id: 104 });
        state.ships.set(105, { ...state.ships.get(102), api_id: 105 });
        await database.shipObtained.bulkPut([
            { id: 101, mst: 1, obtainedTs: 1_726_000_000_000, source: 'auto' },
            { id: 102, mst: 2, obtainedTs: 1_726_100_000_000, source: 'manual' },
            { id: 103, mst: 999, obtainedTs: null, source: null },
            { id: 104, mst: 2, obtainedTs: null, source: null } as ShipObtainedRow,
        ]);

        const rows = await loadOwnedShipRows(state, ids => database.shipObtained.bulkGet(ids));
        expect(rows.find(row => row.id === 101)?.obtained?.source).toBe('auto');
        expect(rows.find(row => row.id === 102)?.obtained?.source).toBe('manual');
        expect(rows.find(row => row.id === 103)?.obtained?.obtainedTs).toBeNull();
        expect(rows.find(row => row.id === 104)?.obtained).toMatchObject({ id: 104, obtainedTs: null });
        expect(rows.find(row => row.id === 105)?.obtained).toBeUndefined();
        // 図鑑番号不明（master 缺）顯示「—」，不假造番号
        expect(rosterTableHtml(buildRoster(rows), view(['book']), ctx)).toContain(t('ov.shipsDateUnknown'));
    });

    it('以目前本地化名稱不分大小寫搜尋，並依艦種與排序規則穩定篩選', () => {
        SHIP_NAMES[1] = { en: 'Harbor Fox' };
        SHIP_NAMES[2] = { en: 'alpha' };
        setLang('en');
        const ships = createState().ownedShips();
        const first = ships.find(ship => ship.id === 101)!;
        const second = ships.find(ship => ship.id === 102)!;
        const roster = buildRoster([first, second, { ...second, id: 99, lv: first.lv, name: 'alpha' }]);
        const ids = (f: Partial<RosterFilter>, sort: RosterSortKey = 'level', dir: SortDir = 'desc') =>
            sortRoster(filterRoster(roster, { ...emptyRosterFilter(), ...f }), sort, dir).map(ship => ship.id);

        expect(ids({ search: 'hArBoR' })).toEqual([101]);
        expect(ids({ stypeIds: [second.stypeId] })).toEqual([99, 102]);
        expect(ids({})).toEqual([99, 101, 102]);
        expect(ids({}, 'name', 'asc')).toEqual([99, 102, 101]);
    });

    it('輸出名稱與裝備名稱時會 HTML escape', () => {
        const roster = buildRoster([createState().ownedShips().find(ship => ship.id === 101)!]);
        const html = rosterTableHtml(roster, view(), ctx);

        expect(html).toContain('Alpha &lt;Ship&gt;');
        expect(html).toContain('Gun &lt;Mk.1&gt;');
        expect(html).not.toContain('Alpha <Ship>');
        expect(html).not.toContain('Gun <Mk.1>');
    });

    it('裝備欄畫滿真實槽數，空槽以「空裝」佔位', () => {
        // Alpha 是 2 槽艦，只裝了第 1 槽 → 一格有圖示、一格空；補強增設有孔未裝再一格。
        const roster = buildRoster([createState().ownedShips().find(ship => ship.id === 101)!]);
        const html = rosterTableHtml(roster, view(), ctx);

        expect(html.match(/class="rs-slot"/g)).toHaveLength(1);
        expect(html.match(/class="rs-slot empty"/g)).toHaveLength(1);
        expect(html).toContain('rs-slot ex empty');
    });

    it('CSV 匯出的欄位與表格一致，含逗號的值會加引號', () => {
        const roster = buildRoster(createState().ownedShips());
        const csv = rosterCsv(roster, view(['name', 'gears']), ctx).split('\n');

        expect(csv[0]).toBe(`${t('ov.rsColName')},${t('ov.rsColGears')}`);
        // 兩件裝備以 ' / ' 相連、不含逗號，故不需引號；空槽輸出「空裝」文字而非留白。
        expect(csv[1]).toBe(`Alpha <Ship>,Gun <Mk.1>★4 / ${t('ov.rsEmptySlot')}`);
    });
});
