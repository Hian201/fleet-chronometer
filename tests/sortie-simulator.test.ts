import { describe, expect, it } from 'vitest';
import type { ReplayRow, ReplayShip, ReplaySupportShip } from '../utils/db';
import {
    buildSortieSimulator, toSortieSimulatorUrl,
} from '../utils/sortie-simulator';
import { buildReplayDeckBuilder } from '../utils/deckbuilder';

const ship = (mst_id: number, lv: number, ex = -1, exstars?: number, exace?: number): ReplayShip => ({
    mst_id, lv, equip: [11, -1], stars: [2, 0], ace: [7, -1], exequip: ex,
    ...(ex > 0 && exstars !== undefined ? { exstars } : {}),
    ...(ex > 0 && exace !== undefined ? { exace } : {}),
    nowhp: 90, maxhp: 100, cond: 52,
});

const supportShip = (mst_id: number): ReplaySupportShip => ({
    mst_id, lv: 80, equip: [21], stars: [1], ace: [6], exequip: -1, cond: 48,
});

const replay = (): ReplayRow => ({
    sortieKey: 77, ts: 1_700_000_000_000, world: 61, mapnum: 5, diff: 4,
    combined: 2, fleetnum: 1,
    fleet1: [ship(101, 140, 42, 4, 0)],
    fleet2: [ship(102, 130)],
    fleet3: [supportShip(103)],
    fleet4: [supportShip(104)],
    lbas: [{
        areaId: 61, rid: 1, action: 1, distance: 8,
        squadrons: [
            { mst: 301, count: 17, maxCount: 18, stars: 3, ace: 7, state: 1, cond: 1 },
            { mst: 0, count: 0, maxCount: 18, stars: 0, ace: 0, state: 0, cond: 1 },
        ],
    }],
    battles: [
        {
            node: 11,
            data: {
                api_name: 'fc_battle_water', api_formation: [11, 5, 1],
                api_fParam: [[100, 0, 80, 90]], api_fParam_combined: [[70, 40, 60, 50]],
                api_ship_ke: [1, 2], api_ship_lv: [10, 11], api_e_maxhps: [30, 40],
                api_eParam: [[30, 20, 15, 10], [40, 25, 18, 12]],
                api_eSlot: [[501, -1], [502, -1]],
                api_air_base_attack: [{
                    api_base_id: 1,
                    api_squadron_plane: [{ api_mst_id: 701, api_count: 17 }],
                }],
                api_support_info: {
                    api_support_airatack: null,
                    api_support_hourai: { api_deck_id: 3, api_ship_id: [30001, 30002] },
                },
            },
        },
        {
            node: 22,
            data: {
                api_name: 'fc_battle_water', api_formation: [12, 14, 1],
                api_fParam: [[101, 0, 81, 91]], api_fParam_combined: [[71, 41, 61, 51]],
                api_ship_ke: [1501], api_ship_lv: [90], api_e_maxhps: [500],
                api_eParam: [[300, 200, 150, 100]], api_eSlot: [[1515, -1]],
                api_ship_ke_combined: [1502], api_ship_lv_combined: [91],
                api_e_maxhps_combined: [250], api_eParam_combined: [[200, 100, 120, 80]],
                api_eSlot_combined: [[502, -1]],
                api_support_info: {
                    api_support_airatack: { api_deck_id: 4, api_ship_id: [40001] },
                    api_support_hourai: null,
                },
            },
            yasen: { api_midnight: true },
        },
    ],
});

describe('出擊記錄 simulator JSON', () => {
    it('保留主隊、隨伴、支援、基地、逐節點敵艦隊與陣形', () => {
        const input = buildSortieSimulator(replay(), {
            bossNodes: new Set([22]),
            routeNodes: [
                { node: 11, kind: 'battle', enemyIds: [1, 2], enemyIdsEscort: [] },
                { node: 22, boss: true, kind: 'battle', enemyIds: [1501], enemyIdsEscort: [1502] },
                { node: 30, kind: 'raid', enemyIds: [], enemyIdsEscort: [] },
            ],
        });

        expect(input.map).toBe('61-5');
        expect(input.fleetF).toMatchObject({ combineType: 2, formation: 11 });
        expect(input.fleetF.ships[0]).toMatchObject({
            masterId: 101, LVL: 140, HPInit: 90, morale: 52,
            stats: { HP: 100, FP: 100, TP: 0, AA: 80, AR: 90 },
            includesEquipStats: 0,
        });
        expect(input.fleetF.ships[0].equips).toEqual([
            { masterId: 11, improve: 2, proficiency: 7 },
            { masterId: 42, improve: 4, proficiency: 0 },
        ]);
        expect(input.fleetF.shipsC?.[0]).toMatchObject({ masterId: 102, stats: { FP: 70 } });

        expect(input.fleetSupportN?.ships[0]).toMatchObject({ masterId: 103, LVL: 80, morale: 48 });
        expect(input.fleetSupportB?.ships[0]).toMatchObject({ masterId: 104, LVL: 80 });
        expect(input.lbas?.[0]).toEqual({
            slots: [17], equips: [{ masterId: 301, improve: 3, proficiency: 7 }],
        });

        expect(input.nodes).toHaveLength(2);
        expect(input.nodes[0]).toMatchObject({ node: 11, formationOverride: 11, lbas: [1] });
        expect(input.nodes[0].fleetE).toMatchObject({ formation: 5 });
        expect(input.nodes[0].fleetE.ships[0]).toMatchObject({
            masterId: 1001, LVL: 10, HPInit: 30,
            stats: { HP: 30, FP: 30, TP: 20, AA: 15, AR: 10 },
        });
        expect(input.nodes[0].fleetE.ships[0].equips).toEqual([
            { masterId: 1501, improve: 0, proficiency: 0 },
        ]);
        expect(input.nodes[1]).toMatchObject({ node: 22, doNB: true, formationOverride: 12, boss: true });
        expect(input.nodes[1].fleetE).toMatchObject({ formation: 14 });
        expect(input.nodes[1].fleetE.shipsC?.[0]).toMatchObject({ masterId: 1502, equips: [{ masterId: 1502 }] });

        expect(input.fleetChronometer.routeNodes).toHaveLength(3);
        expect(input.fleetChronometer.supportUses).toMatchObject([
            { node: 11, boss: false, deckId: 3, kind: 'shell' },
            { node: 22, boss: true, deckId: 4, kind: 'air' },
        ]);
        expect(input.fleetChronometer.lbasWaves).toEqual([
            { node: 11, baseId: 1, planes: [{ masterId: 701, count: 17 }] },
        ]);
    });

    it('URL fragment 可解碼成同一份 simulator JSON', () => {
        const row = replay();
        const url = toSortieSimulatorUrl(row);
        const encoded = url.slice(url.indexOf('#') + 1);
        const decoded = JSON.parse(decodeURIComponent(encoded));
        expect(decoded.fleetF.ships[0].masterId).toBe(101);
        expect(decoded.nodes).toHaveLength(row.battles.length);
        expect(decoded.world).toBe(61);
        expect(decoded.mapnum).toBe(5);
    });

    it('複製用的 DeckBuilder JSON 與網址用的模擬器 JSON 是不同且各自正確的契約', () => {
        const deck = buildReplayDeckBuilder(replay()) as Record<string, any>;
        expect(deck).toMatchObject({ version: 4, f1: { s1: { id: 101, lv: 140 } } });
        expect(deck).not.toHaveProperty('fleetF');
        expect(deck.f2.s1.id).toBe(102);
        expect(deck.f3.s1.id).toBe(103);
        expect(deck.f4.s1.id).toBe(104);
        expect(deck.a1.items.i1).toEqual({ id: 301, rf: 3, mas: 7, count: 17 });
    });

    it('舊快照缺 exstars／exace 時補強增設改修退回 0，不拿一般槽 stars 湊數', () => {
        const row = replay();
        row.fleet1 = [ship(101, 140, 42)]; // 有 exequip、無 exstars
        const input = buildSortieSimulator(row);
        expect(input.fleetF.ships[0].equips).toEqual([
            { masterId: 11, improve: 2, proficiency: 7 },
            { masterId: 42, improve: 0, proficiency: 0 },
        ]);
    });
});
