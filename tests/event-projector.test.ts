import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KcDb, type SortieLogRow } from '../utils/db';
import {
    EventProjector,
    projectEventAndAdvance,
    type EventProjectorTables,
    type ProjectableEvent,
} from '../utils/event-projector';
import { GameState } from '../utils/state';

const databases: KcDb[] = [];
let serial = 0;

function fixture<T = any>(name: string): T {
    return JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')) as T;
}

function createDb() {
    const database = new KcDb(`kc-event-projector-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function row(id: number, path: string, api: any, req?: Record<string, string>): ProjectableEvent {
    return { id, ts: 1_726_000_000_000 + id, path, api, req };
}

function portApi() {
    return {
        api_ship: [{
            api_id: 101, api_ship_id: 500, api_lv: 99,
            api_nowhp: 69, api_maxhp: 93, api_cond: 49,
            api_slot: [201, -1], api_slot_ex: -1, api_kyouka: [1, 2, 3, 4, 5],
            api_fuel: 100, api_bull: 100,
        }],
        api_deck_port: [{ api_ship: [101, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [],
        api_material: new Array(8).fill(400_000).map(api_value => ({ api_value })),
        api_basic: { api_max_chara: 500, api_max_slotitem: 2_000, api_nickname: 'fixture', api_level: 120 },
        api_count_kdock: 4,
        api_combined_flag: 0,
    };
}

function mapInfo(id: number, cleared: boolean) {
    return {
        api_map_info: [{
            api_id: id,
            api_cleared: cleared ? 1 : 0,
            api_gauge_type: 1,
            api_defeat_count: cleared ? 6 : 4,
            api_required_defeat_count: 6,
        }],
    };
}

function fullEventStream(): ProjectableEvent[] {
    const battle = fixture('6-5-ec_battle.json');
    const result = fixture('6-5-ec_result.json');
    const improve = fixture<{ req: Record<string, string>; api: any }>('remodel_1.json');
    const builds = fixture<{ api_data: any[] }>('build_1.json').api_data;
    return [
        row(1, 'api_get_member/require_info', {
            api_slot_item: [{ api_id: 201, api_slotitem_id: 301, api_level: 6, api_alv: 7 }],
        }),
        row(2, 'api_port/port', portApi()),
        row(3, 'api_req_map/start', { api_maparea_id: 6, api_mapinfo_no: 5, api_no: 42, api_color_no: 5 }, { api_deck_id: '1' }),
        row(4, 'api_req_combined_battle/ec_battle', battle),
        row(5, 'api_req_battle_midnight/battle', { ...battle, marker: 'night' }),
        row(6, 'api_req_combined_battle/battleresult', result),
        row(10, 'api_req_kousyou/createitem', fixture('kousyou_2.json')),
        row(11, 'api_req_kousyou/remodel_slot', improve.api, improve.req),
        row(12, 'api_get_member/kdock', builds),
        row(13, 'api_req_kousyou/createship_speedchange', {}, { api_kdock_id: '1' }),
        row(20, 'api_req_mission/start', { api_complatetime: 1_726_000_600_000 }, { api_deck_id: '1', api_mission_id: '5' }),
        row(21, 'api_req_mission/result', {
            api_quest_name: 'fixture expedition',
            api_clear_result: 2,
            api_get_material: [100, 200, 300, 400],
            api_get_item1: { api_useitem_id: 1, api_useitem_count: 2 },
        }, { api_deck_id: '1' }),
        row(30, 'api_get_member/mapinfo', mapInfo(65, false)),
        row(31, 'api_get_member/mapinfo', mapInfo(65, true)),
    ];
}

async function projectAll(projector: EventProjector, events = fullEventStream()) {
    for (const event of events) await projector.project(event);
}

function mockBattleInfo(): NonNullable<GameState['battleInfo']> {
    return {
        resultFleets: null,
        rank: 'S',
        mvp: [1, 0],
        isTaiha: false,
        flagshipTaiha: false,
        flagshipDamecon: 0,
        enemyIds: [1501],
        enemyIdsEscort: [],
        enemyDetail: { main: [], escort: [] },
        formation: [1, 1, 1],
        seiku: 1,
        touchPlane: [-1, -1],
        planes: {
            playerFighter: { count: 1, lost: 0 },
            playerBomber: { count: 0, lost: 0 },
            enemyFighter: { count: 1, lost: 1 },
            enemyBomber: { count: 0, lost: 0 },
        },
        drop: null,
        dropIsNew: false,
        supportFlag: 0,
        aaci: 0,
        aaciDetails: [],
        midnightFlag: false,
        friendlyFleetIds: null,
        lbas: null,
        support: null,
        hasResult: false,
    };
}

function mockTables(): EventProjectorTables & {
    sorties: EventProjectorTables['sorties'] & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; filter: ReturnType<typeof vi.fn> };
    factory: { put: ReturnType<typeof vi.fn> };
    replays: EventProjectorTables['replays'] & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
    expeditions: { put: ReturnType<typeof vi.fn> };
} {
    const sorties: SortieLogRow[] = [];
    return {
        sorties: {
            get: vi.fn().mockResolvedValue(undefined),
            put: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(1),
            filter: vi.fn((predicate: (sortie: SortieLogRow) => boolean) => ({
                toArray: async () => sorties.filter(predicate),
            })),
        },
        factory: { put: vi.fn().mockResolvedValue(undefined) },
        replays: { get: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) },
        expeditions: { put: vi.fn().mockResolvedValue(undefined) },
    };
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('EventProjector persist 模式', () => {
    it('map/next 補回目前血條目標 Boss 節點並保存到 replay 上下文', async () => {
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables: mockTables() });
        await projector.project(row(1, 'api_req_map/start', {
            api_maparea_id: 62, api_mapinfo_no: 2, api_no: 1, api_color_no: 4,
        }, { api_deck_id: '1' }));
        expect(projector.state.sortieInfo?.bossCellNo).toBeUndefined();
        expect(projector.currentReplay?.bossCellNo).toBeUndefined();

        await projector.project(row(2, 'api_req_map/next', {
            api_maparea_id: 62, api_mapinfo_no: 2, api_no: 55,
            api_color_no: 5, api_event_id: 5, api_event_kind: 5,
            api_bosscell_no: 32,
        }));

        expect(projector.state.sortieInfo?.bossCellNo).toBe(32);
        expect(projector.currentReplay?.bossCellNo).toBe(32);
    });

    it('維持 sorties、factory、expeditions 與 replay 的既有主鍵、row shape 與累積順序', async () => {
        const database = createDb();
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables: database });

        await projectAll(projector);

        expect(await database.sorties.toArray()).toEqual([
            expect.objectContaining({
                eventId: 6, sortieKey: 3, map: '6-5', node: 42,
                boss: true, kind: 'battle', rank: 'S', dropMst: 124, cleared: true,
            }),
        ]);

        const factory = (await database.factory.toArray()).sort((left, right) => left.eventId - right.eventId);
        expect(factory.map(item => item.eventId)).toEqual([10, 11, 12, 12.002, 13]);
        expect(factory).toEqual([
            expect.objectContaining({ kind: 'develop', results: [{ mst: -1 }, { mst: 1 }, { mst: 37 }], secretary: 500, hqLv: 120 }),
            expect.objectContaining({ kind: 'improve', gearMst: 36, success: true, certain: false, secretary: 500, hqLv: 120 }),
            expect.objectContaining({ kind: 'build', kdockId: 1, shipMst: 56, used: [30, 30, 30, 30, 0, 0, 1, 0], secretary: 500, hqLv: 120 }),
            expect.objectContaining({ kind: 'build', kdockId: 2, shipMst: 86, used: [1500, 1500, 2000, 1000, 0, 0, 1, 0], secretary: 500, hqLv: 120 }),
            expect.objectContaining({ kind: 'speedup', kdockId: 1, shipMst: 56, used: [0, 0, 0, 0, 1, 0, 0, 0], secretary: 500, hqLv: 120 }),
        ]);

        expect(await database.expeditions.toArray()).toEqual([{
            eventId: 21,
            ts: 1_726_000_000_021,
            deckId: 1,
            missionId: 5,
            name: 'fixture expedition',
            result: 2,
            resources: [100, 200, 300, 400],
            items: [{ id: 1, count: 2 }],
            fleet: [{ name: '?', level: 99 }],
        }]);

        const replay = await database.replays.get(3);
        expect(replay).toMatchObject({
            sortieKey: 3,
            world: 6,
            mapnum: 5,
            fleetnum: 1,
            combined: 0,
            nickname: 'fixture',
            hqLv: 120,
        });
        expect(replay?.fleet1).toEqual([expect.objectContaining({
            mst_id: 500,
            lv: 99,
            equip: [301, -1],
            stars: [6, 0],
            ace: [7, 0],
            exequip: -1,
        })]);
        expect(replay?.battles).toHaveLength(1);
        expect(replay?.battles[0]).toMatchObject({ node: 42, rank: 'S' });
        expect(replay?.battles[0].data).toBeTruthy();
        expect(replay?.battles[0].yasen).toMatchObject({ marker: 'night' });
    });

    it('api_get_material 非陣列（實機觀測過）時不拋錯，resources 退回空陣列', async () => {
        const database = createDb();
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables: database });

        await expect(projector.project(row(1, 'api_req_mission/result', {
            api_quest_name: 'fixture expedition',
            api_clear_result: 0,
            api_get_material: 0,
        }, { api_deck_id: '1' }))).resolves.not.toThrow();

        expect(await database.expeditions.toArray()).toEqual([
            expect.objectContaining({ eventId: 1, result: 0, resources: [] }),
        ]);
    });

    it('同一事件流以新的 projector 重播兩次時，四張表都以 put 保持 row count 不增加', async () => {
        const database = createDb();
        await projectAll(new EventProjector({ state: new GameState(), tables: database }));
        const firstCounts = await Promise.all([
            database.sorties.count(),
            database.factory.count(),
            database.replays.count(),
            database.expeditions.count(),
        ]);

        await projectAll(new EventProjector({ state: new GameState(), tables: database }));

        expect(firstCounts).toEqual([1, 5, 1, 1]);
        expect(await Promise.all([
            database.sorties.count(),
            database.factory.count(),
            database.replays.count(),
            database.expeditions.count(),
        ])).toEqual(firstCounts);
    });

    it('battle-result 只從已驗證的 api_get_ship.api_ship_id 保存有效 dropMst', async () => {
        const tables = mockTables();
        const state = new GameState();
        state.sortieInfo = { mapArea: 6, mapNo: 5, nodes: [{ id: 42, color: 5 }] };
        state.battleInfo = mockBattleInfo();
        const projector = new EventProjector({ state, tables });

        await projector.project(row(1, 'api_req_combined_battle/battleresult', fixture('6-5-ec_result.json')));

        expect(tables.sorties.put).toHaveBeenCalledWith(expect.objectContaining({
            eventId: 1,
            dropMst: 124,
        }));
    });

    it('節點類型（api_event_id／api_event_kind）從 map/start|next 一路存到 sorties', async () => {
        const tables = mockTables();
        const state = new GameState();
        const projector = new EventProjector({ state, tables });

        await projector.project(row(1, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 3, api_color_no: 4,
            api_event_id: 4, api_event_kind: 6,
        }, { api_deck_id: '1' }));
        state.battleInfo = mockBattleInfo();
        await projector.project(row(2, 'api_req_sortie/battleresult', { api_win_rank: 'S' }));

        expect(tables.sorties.put).toHaveBeenCalledWith(expect.objectContaining({
            node: 3, nodeEventId: 4, nodeEventKind: 6,
        }));
    });

    it('battle-result 一併保存提督經驗值／MVP／敵艦隊名（真封包 6-5-ec_result）', async () => {
        const tables = mockTables();
        const state = new GameState();
        state.sortieInfo = { mapArea: 6, mapNo: 5, nodes: [{ id: 42, color: 5 }] };
        state.battleInfo = mockBattleInfo();
        const projector = new EventProjector({ state, tables });

        await projector.project(row(1, 'api_req_combined_battle/battleresult', fixture('6-5-ec_result.json')));

        expect(tables.sorties.put).toHaveBeenCalledWith(expect.objectContaining({
            getExp: 3520,
            mvp: 4,                       // 1-based，與 analyzeBattle 的傷害推算在同一場封包上一致
            enemyName: '任務部隊 主力群',
        }));
        // api_mvp_combined 為 null（非自軍連合）→ 不寫入該欄位，不補 0
        expect(tables.sorties.put.mock.calls[0][0]).not.toHaveProperty('mvpEscort');
    });

    it.each([
        ['missing api_get_exp', { api_win_rank: 'S' }],
        ['zero exp', { api_win_rank: 'S', api_get_exp: 0 }],
        ['string mvp', { api_win_rank: 'S', api_mvp: '4' }],
        ['empty enemy name', { api_win_rank: 'S', api_enemy_info: { api_deck_name: '' } }],
    ])('battle-result 的追加欄位 %s 時不保存猜測值', async (_label, api) => {
        const tables = mockTables();
        const state = new GameState();
        state.sortieInfo = { mapArea: 6, mapNo: 5, nodes: [{ id: 42, color: 5 }] };
        state.battleInfo = mockBattleInfo();
        const projector = new EventProjector({ state, tables });

        await projector.project(row(1, 'api_req_sortie/battleresult', api));

        const saved = tables.sorties.put.mock.calls[0][0];
        expect(saved).not.toHaveProperty('getExp');
        expect(saved).not.toHaveProperty('mvp');
        expect(saved).not.toHaveProperty('enemyName');
    });

    it.each([
        ['missing api_get_ship', { api_win_rank: 'S' }],
        ['missing api_ship_id', { api_win_rank: 'S', api_get_ship: { api_ship_name: '同名顯示' } }],
        ['zero', { api_win_rank: 'S', api_get_ship: { api_ship_id: 0, api_ship_name: '同名顯示' } }],
        ['negative', { api_win_rank: 'S', api_get_ship: { api_ship_id: -1, api_ship_name: '同名顯示' } }],
        ['fraction', { api_win_rank: 'S', api_get_ship: { api_ship_id: 12.5, api_ship_name: '同名顯示' } }],
        ['numeric string', { api_win_rank: 'S', api_get_ship: { api_ship_id: '124', api_ship_name: '同名顯示' } }],
    ])('battle-result 的 drop master ID %s 時不保存或由船名猜測', async (_label, api) => {
        const tables = mockTables();
        const state = new GameState();
        state.sortieInfo = { mapArea: 6, mapNo: 5, nodes: [{ id: 42, color: 5 }] };
        state.battleInfo = mockBattleInfo();
        const projector = new EventProjector({ state, tables });

        await projector.project(row(1, 'api_req_sortie/battleresult', api));

        const saved = tables.sorties.put.mock.calls[0][0] as SortieLogRow;
        expect(saved).not.toHaveProperty('dropMst');
    });
});

describe('EventProjector 出擊 replay 不含演習', () => {
    function practiceNight(marker: string) {
        return {
            api_deck_id: 1,
            api_formation: [1, 1, 1],
            api_f_nowhps: [2, 1, 16, 2, 7, 15],
            api_f_maxhps: [27, 107, 60, 19, 17, 17],
            api_ship_ke: [364, 733, 713, 397, 698, 488],
            api_e_effect_list: [[0], [0], [0], [0], [0], [0]],
            api_touch_plane: [-1, -1],
            api_flare_pos: [-1, -1],
            api_hougeki: { marker },
        };
    }

    it('回港後的演習夜戰不追加 node 0，也不覆寫已存的出擊 replay', async () => {
        const database = createDb();
        const projector = new EventProjector({ state: new GameState(), tables: database });
        const battle = fixture('6-5-ec_battle.json');
        const result = fixture('6-5-ec_result.json');

        await projector.project(row(1, 'api_get_member/require_info', {
            api_slot_item: [{ api_id: 201, api_slotitem_id: 301, api_level: 6, api_alv: 7 }],
        }));
        await projector.project(row(2, 'api_port/port', portApi()));
        await projector.project(row(3, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 42, api_color_no: 5,
        }, { api_deck_id: '1' }));
        await projector.project(row(4, 'api_req_combined_battle/ec_battle', battle));
        await projector.project(row(5, 'api_req_battle_midnight/battle', { ...battle, marker: 'night' }));
        await projector.project(row(6, 'api_req_combined_battle/battleresult', result));
        await projector.project(row(7, 'api_port/port', portApi()));
        await projector.project(row(8, 'api_req_practice/midnight_battle', practiceNight('practice-1')));
        await projector.project(row(9, 'api_req_practice/midnight_battle', practiceNight('practice-2')));

        expect(projector.currentReplay).toBeNull();
        const replay = await database.replays.get(3);
        expect(replay?.battles).toHaveLength(1);
        expect(replay?.battles[0]).toMatchObject({ node: 42, rank: 'S' });
        expect(replay?.battles[0].yasen).toMatchObject({ marker: 'night' });
        expect(replay?.battles.some(battle => battle.node === 0)).toBe(false);
    });

    it('出擊尚未回港時，演習夜戰也不併進最後一個出擊節點', async () => {
        const database = createDb();
        const projector = new EventProjector({ state: new GameState(), tables: database });
        const battle = fixture('6-5-ec_battle.json');

        await projector.project(row(1, 'api_get_member/require_info', {
            api_slot_item: [{ api_id: 201, api_slotitem_id: 301, api_level: 6, api_alv: 7 }],
        }));
        await projector.project(row(2, 'api_port/port', portApi()));
        await projector.project(row(3, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 42, api_color_no: 5,
        }, { api_deck_id: '1' }));
        await projector.project(row(4, 'api_req_combined_battle/ec_battle', battle));
        await projector.project(row(5, 'api_req_practice/midnight_battle', practiceNight('practice')));

        const replay = await database.replays.get(3);
        expect(replay?.battles).toHaveLength(1);
        expect(replay?.battles[0]).toMatchObject({ node: 42 });
        expect(replay?.battles[0].yasen).toBeUndefined();
    });
});

describe('EventProjector state-only 模式', () => {
    it('不存取 derived tables，但仍重建 sortie、replay 與 gauge context', async () => {
        const tables = mockTables();
        const projector = new EventProjector({ state: new GameState(), mode: 'state-only', tables });

        await projectAll(projector);

        expect(tables.sorties.put).not.toHaveBeenCalled();
        expect(tables.sorties.get).not.toHaveBeenCalled();
        expect(tables.sorties.filter).not.toHaveBeenCalled();
        expect(tables.sorties.update).not.toHaveBeenCalled();
        expect(tables.factory.put).not.toHaveBeenCalled();
        expect(tables.replays.put).not.toHaveBeenCalled();
        expect(tables.replays.get).not.toHaveBeenCalled();
        expect(tables.expeditions.put).not.toHaveBeenCalled();
        expect(projector.currentSortieKey).toBe(3);
        expect(projector.currentReplay?.battles).toHaveLength(1);
        expect(projector.currentReplay?.battles[0]).toMatchObject({ node: 42, rank: 'S' });
        expect(projector.currentReplay?.battles[0].yasen).toMatchObject({ marker: 'night' });
        expect(projector.gaugeSeenUncleared.has(65)).toBe(true);
        expect(projector.gaugeBroken.has(65)).toBe(true);
    });
});

describe('EventProjector 寫入失敗傳播', () => {
    it('sorties put 失敗時 reject', async () => {
        const tables = mockTables();
        const failure = new Error('sorties put failure');
        tables.sorties.put.mockRejectedValue(failure);
        const state = new GameState();
        state.sortieInfo = { mapArea: 6, mapNo: 5, nodes: [{ id: 42, color: 5 }] };
        state.battleInfo = mockBattleInfo();
        const projector = new EventProjector({ state, tables });

        await expect(projector.project(row(1, 'api_req_sortie/battleresult', { api_win_rank: 'S' }))).rejects.toBe(failure);
    });

    it('factory put 失敗時 reject', async () => {
        const tables = mockTables();
        const failure = new Error('factory put failure');
        tables.factory.put.mockRejectedValue(failure);
        const projector = new EventProjector({ state: new GameState(), tables });

        await expect(projector.project(row(1, 'api_req_kousyou/createitem', fixture('kousyou_1.json')))).rejects.toBe(failure);
    });

    it('replays put 失敗時 reject', async () => {
        const tables = mockTables();
        const failure = new Error('replays put failure');
        tables.replays.put.mockRejectedValue(failure);
        const projector = new EventProjector({ state: new GameState(), tables });
        await projector.project(row(1, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 42, api_color_no: 5,
        }, { api_deck_id: '1' }));

        await expect(projector.project(row(2, 'api_req_combined_battle/ec_battle', fixture('6-5-ec_battle.json')))).rejects.toBe(failure);
    });

    it('expeditions put 失敗時 reject', async () => {
        const tables = mockTables();
        const failure = new Error('expeditions put failure');
        tables.expeditions.put.mockRejectedValue(failure);
        const projector = new EventProjector({ state: new GameState(), tables });

        await expect(projector.project(row(1, 'api_req_mission/result', {}, { api_deck_id: '1' }))).rejects.toBe(failure);
    });

    it('sorties clear update 失敗時 reject', async () => {
        const tables = mockTables();
        const boss: SortieLogRow = {
            eventId: 9, sortieKey: 1, ts: 9, map: '6-5', node: 42, boss: true,
            kind: 'battle', rank: 'S', seiku: 1, enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false,
        };
        tables.sorties.filter.mockImplementation((predicate: (sortie: SortieLogRow) => boolean) => ({
            toArray: async () => [boss].filter(predicate),
        }));
        const failure = new Error('sorties update failure');
        tables.sorties.update.mockRejectedValue(failure);
        const projector = new EventProjector({ state: new GameState(), tables });
        await projector.project(row(1, 'api_get_member/mapinfo', mapInfo(65, false)));

        await expect(projector.project(row(2, 'api_get_member/mapinfo', mapInfo(65, true)))).rejects.toBe(failure);
    });

    it('projector reject 時 panel 使用的 maxId 指派模式不會前進', async () => {
        const failure = new Error('projection failure');
        const projector = { projectWithMode: vi.fn().mockRejectedValue(failure) };
        let maxId = 40;

        await expect((async () => {
            maxId = await projectEventAndAdvance(
                projector,
                row(41, 'api_port/port', {}),
                maxId,
                async eventId => eventId,
            );
        })()).rejects.toBe(failure);

        expect(maxId).toBe(40);
    });
});

// ── 基地空襲的真封包（samples/base-air-raid.json，2026-08-04 實機擷取） ──────────
// 這筆樣本確認三項封包契約：
//   ✅ 頂層 key 是 `api_destruction_battle`（掛在 api_req_map/next 上）
//   ✅ `api_lost_kind` 確實存在（本樣本值＝4；各值語意仍未知，只有這一個樣本）
//   ✅ 空襲的 `api_air_base_attack` 是**物件**（出擊時的陸航波次是陣列）——
//      故 sortie-detail 的 lbasWaves() 只認陣列是對的，不可為了「相容」而放寬。
// 節點類型 api_event_id=4／api_event_kind=6 亦與 map-node-kind 的 airRaid 對得上，
// 且 `api_destruction_battle` 提供了獨立的封包佐證。
describe('基地空襲的真封包歸檔', () => {
    it('projector 讀得出 seiku／lost_kind／節點類型，且標記為 raid', async () => {
        const raid = fixture<{ api: any }>('base-air-raid.json').api;
        const tables = mockTables();
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables });

        await projector.project(row(1, 'api_req_map/start',
            { api_maparea_id: 62, api_mapinfo_no: 1, api_no: 1, api_color_no: 4 }, { api_deck_id: '1' }));
        await projector.project(row(2, 'api_req_map/next', raid, { api_recovery_type: '0' }));

        const saved = tables.sorties.put.mock.calls.at(-1)![0] as SortieLogRow;
        expect(saved.kind).toBe('raid');
        expect(saved.map).toBe('62-1');
        expect(saved.node).toBe(11);
        expect(saved.seiku).toBe(4);            // api_air_base_attack.api_stage1.api_disp_seiku
        expect(saved.raidLostKind).toBe(4);     // api_lost_kind
        expect(saved.nodeEventId).toBe(4);
        expect(saved.nodeEventKind).toBe(6);
        expect(saved.rank).toBe('');
        expect(saved.boss).toBe(false);
    });

    it('空襲的 api_air_base_attack 是物件，不得被當成出擊波次陣列', () => {
        const raid = fixture<{ api: any }>('base-air-raid.json').api;
        const attack = raid.api_destruction_battle.api_air_base_attack;
        expect(Array.isArray(attack)).toBe(false);
        expect(attack.api_stage1.api_disp_seiku).toBe(4);
    });
});
