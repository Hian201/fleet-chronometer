import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameState, type AirBaseView, type FleetView, type GearView, type ShipView, type SquadronView } from '../utils/state';
import { buildOwnedEquipmentCode, buildSelectedDeckBuilder, buildSelectedSupportDeckBuilder } from '../utils/deckbuilder';

const gear = (mst: number, level: number, alv = 0): GearView => ({
    mst, name: `gear-${mst}`, short: '', cat: '', type: 0, asw: 0, icon: 0, level, alv,
});

const ship = (mst: number, equipped: (GearView | null)[] = [], exGear: GearView | null = null): ShipView => ({
    id: mst + 10_000,
    name: `ship-${mst}`,
    nameJa: `ship-ja-${mst}`,
    stype: 'DD', stypeId: 2, mst,
    lv: 90, hp: 98, maxhp: 100, cond: 49,
    fuel: 10, maxFuel: 10, bull: 20, maxBull: 20,
    firepower: 100, luck: 30,
    ndockTime: 0, inDock: false, dockCompleteAt: null, escaped: false,
    gears: equipped, exGear, exEmpty: false, slotCapacity: equipped.map(() => undefined),
});

const fleet = (...ships: ShipView[]): FleetView => ({
    name: 'fleet', ships, mission: false, repairAnchor: null, moraleAnchor: null,
});

const squadron = (mst: number, level: number, alv: number): SquadronView => ({
    slotId: mst + 20_000, state: 1, name: `plane-${mst}`, short: '', cat: '', icon: 0, mst,
    level, alv, count: 18, maxCount: 18, cond: 1,
});

const airBase = (areaId: number, rid: number, mst: number): AirBaseView => ({
    areaId, rid, name: `base-${areaId}-${rid}`, actionKind: 1, distance: 8,
    squadrons: [squadron(mst, 2, 7)], airPower: { min: 0, max: 0 }, condAsOf: null, condRate: 0,
});

function testState() {
    const fleets = [
        fleet(ship(101, [gear(201, 3, 7)], gear(202, 0, 2))),
        fleet(),
        fleet(ship(103, [gear(203, 1)])),
        fleet(ship(104)),
    ];
    const state = {
        hqLv: 120,
        fleets: () => fleets,
        ownedGears: () => ([
            { mst: 201, level: 3 },
            { mst: 202, level: 0 },
            { mst: 203, level: 1 },
        ] as unknown as ReturnType<GameState['ownedGears']>),
        airBases_: () => [airBase(6, 1, 301), airBase(62, 1, 302)],
    };
    return state as unknown as Pick<GameState, 'hqLv' | 'fleets' | 'ownedGears' | 'airBases_'>;
}

function supportStateWithStringEquipmentIds(): GameState {
    const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: [
            { api_id: 9101, api_slotitem_id: 531, api_level: 4, api_alv: 7 },
            { api_id: 9102, api_slotitem_id: 532, api_level: 0, api_alv: 0 },
            { api_id: 9103, api_slotitem_id: 31, api_level: 1, api_alv: 0 },
        ],
    });
    state.applyEvent('api_port/port', {
        api_ship: [],
        api_deck_port: [
            { api_id: 1, api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_id: 2, api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            { api_id: 3, api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
        ],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    state.applyEvent('api_get_member/ship_deck', {
        api_ship_data: [{
            api_id: 7001, api_ship_id: 538, api_lv: 95, api_nowhp: 30, api_maxhp: 30, api_cond: 49,
            // 編成端點可能以字串傳回裝備實例 ID；slot item 表的鍵仍是數字。
            api_slot: ['9101', '9102', '9103', -1, -1], api_slot_ex: 0,
            api_karyoku: [0, 0], api_lucky: [0, 0],
        }],
        api_deck_data: [{
            api_id: 3, api_ship: [7001, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0],
        }],
    });
    return state;
}

describe('艦隊全覽本機代碼', () => {
    it('輸出鎮守府目前所有裝備的 id／改修值，不帶裝備實例 id 或名稱', () => {
        const code = JSON.parse(buildOwnedEquipmentCode(testState())) as unknown[];

        expect(code).toEqual([
            { id: 201, lv: 3 },
            { id: 202, lv: 0 },
            { id: 203, lv: 1 },
        ]);
        expect(JSON.stringify(code)).not.toContain('gear-');
        expect(code[0]).not.toHaveProperty('name');
    });

    it('將選取艦隊依原編號排序後連續產生 DeckBuilder v4 的 f1、f2', () => {
        const deck = buildSelectedDeckBuilder(testState(), [4, 1]) as Record<string, any>;

        expect(deck).toMatchObject({ version: 4, hqlv: 120 });
        expect(deck.f1.s1).toMatchObject({ id: 101, lv: 90, luck: 30, exa: true, hp: 98 });
        expect(deck.f1.s1.items).toEqual({
            i1: { id: 201, rf: 3, mas: 7 },
            ix: { id: 202, rf: 0, mas: 2 },
        });
        expect(deck.f2.s1).toMatchObject({ id: 104, lv: 90 });
        expect(deck.f3).toBeUndefined();
        expect(deck.a1).toBeUndefined();
        expect(JSON.stringify(deck)).not.toContain('ship-');
        expect(JSON.stringify(deck)).not.toContain('gear-');
    });

    it('將選取的基地航空隊依海域／基地編號填入 a1、a2，且不與同 rid 的基地互相覆蓋', () => {
        const deck = buildSelectedDeckBuilder(testState(), [1], ['62_1', '6_1']) as Record<string, any>;

        expect(deck.a1).toEqual({ mode: 1, items: { i1: { id: 301, rf: 2, mas: 7 } } });
        expect(deck.a2).toEqual({ mode: 1, items: { i1: { id: 302, rf: 2, mas: 7 } } });
    });

    it('支援艦隊的裝備實例 ID 為字串時仍輸出裝備 items', () => {
        const state = supportStateWithStringEquipmentIds();
        const deck = buildSelectedDeckBuilder(state, [3]) as Record<string, any>;

        expect(deck.f1.s1.id).toBe(538);
        expect(deck.f1.s1.items).toEqual({
            i1: { id: 531, rf: 4, mas: 7 },
            i2: { id: 532, rf: 0, mas: 0 },
            i3: { id: 31, rf: 1, mas: 0 },
        });
        expect(deck.f1.s1.exa).toBe(false);
    });

    it('支援隊伍代碼對齊らくらく編成出力的欄位與 items 格式', () => {
        const deck = buildSelectedSupportDeckBuilder(testState(), [1]) as Record<string, any>;

        expect(deck).toEqual({
            version: 4,
            f1: {
                s1: {
                    id: '101',
                    lv: 90,
                    luck: 30,
                    exa: true,
                    items: {
                        i1: { id: 201, rf: 3 },
                        ix: { id: 202, rf: 0 },
                    },
                },
            },
        });
        expect(deck.hqlv).toBeUndefined();
        expect(deck.f1.s1.hp).toBeUndefined();
    });

    it('支援隊伍拒絕七艘艦，避免らくらく靜默捨棄第七艘', () => {
        const sevenShipState = {
            ...testState(),
            fleets: () => [fleet(...Array.from({ length: 7 }, (_, index) => ship(500 + index)))],
        };

        expect(() => buildSelectedSupportDeckBuilder(sevenShipState, [1])).toThrow(/六艘/);
    });

    it('支援艦隊局部刷新缺少 api_slot 時仍輸出原有裝備 items', () => {
        const state = supportStateWithStringEquipmentIds();
        state.applyEvent('api_get_member/ship_deck', {
            api_ship_data: [{ api_id: 7001, api_ship_id: 538, api_lv: 96, api_nowhp: 30 }],
            api_deck_data: [{ api_id: 3, api_ship: [7001, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        });

        const deck = buildSelectedDeckBuilder(state, [3]) as Record<string, any>;
        expect(deck.f1.s1.items).toEqual({
            i1: { id: 531, rf: 4, mas: 7 },
            i2: { id: 532, rf: 0, mas: 0 },
            i3: { id: 31, rf: 1, mas: 0 },
        });
        expect(deck.f1.s1.exa).toBe(false);
    });

    it('拒絕空選取、重複艦隊、不存在的艦隊與無編成艦隊', () => {
        const state = testState();

        expect(() => buildSelectedDeckBuilder(state, [])).toThrow();
        expect(() => buildSelectedDeckBuilder(state, [1, 1])).toThrow();
        expect(() => buildSelectedDeckBuilder(state, [9])).toThrow();
        expect(() => buildSelectedDeckBuilder(state, [2])).toThrow();
        expect(() => buildSelectedDeckBuilder(state, [1], ['6_1', '6_1'])).toThrow();
        expect(() => buildSelectedDeckBuilder(state, [1], ['6_1', '62_1', '7_1', '8_1'])).toThrow();
        expect(() => buildSelectedDeckBuilder(state, [1], ['7_1'])).toThrow();
    });

    it('遇到無法驗證的艦娘或裝備數值時留在錯誤邊界', () => {
        const invalidGear = gear(0, 0);
        const invalidState = {
            ...testState(),
            fleets: () => [fleet(ship(101, [invalidGear]))],
        } as Pick<GameState, 'hqLv' | 'fleets'>;

        expect(() => buildSelectedDeckBuilder(invalidState, [1])).toThrow();

        const invalidBaseState = {
            ...testState(),
            airBases_: () => [{
                ...airBase(6, 1, 301),
                squadrons: [{ ...squadron(0, 0, 0), state: 1 }],
            }],
        };
        expect(() => buildSelectedDeckBuilder(invalidBaseState, [1], ['6_1'])).toThrow();
    });
});
