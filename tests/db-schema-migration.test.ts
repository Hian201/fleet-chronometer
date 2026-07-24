import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
    KcDb,
    type ApiEventRow,
    type ExpeditionRow,
    type FactoryLogRow,
    type NotifiedRow,
    type ReplayRow,
    type ShipObtainedRow,
    type SnapshotRow,
    type SortieLogRow,
    type WantedRow,
} from '../utils/db';

// 正式 v9 的完整 schema，用來驗證實際 IndexedDB 升級路徑，而非從空白資料庫模擬。
class V9KcDb extends Dexie {
    events!: Table<ApiEventRow, number>;
    wanted!: Table<WantedRow, number>;
    sorties!: Table<SortieLogRow, number>;
    notified!: Table<NotifiedRow, number>;
    factory!: Table<FactoryLogRow, number>;
    replays!: Table<ReplayRow, number>;
    expeditions!: Table<ExpeditionRow, number>;
    snapshot!: Table<SnapshotRow, string>;
    shipObtained!: Table<ShipObtainedRow, number>;

    constructor(name: string) {
        super(name);
        this.version(9).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
            shipObtained: 'id, mst',
        });
    }
}

const databases: Dexie[] = [];
let databaseSerial = 0;

function databaseName(label: string) {
    return `kc-monitor-${label}-${Date.now()}-${databaseSerial++}`;
}

function track<T extends Dexie>(database: T): T {
    databases.push(database);
    return database;
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('KcDb 現行 schema 與 v9 相容遷移', () => {
    it('從真正 v9 升級後保留九張既有表的資料、主鍵、索引與關聯 ID', async () => {
        const name = databaseName('v9-upgrade');
        const v9 = track(new V9KcDb(name));
        await v9.open();

        const firstEventId = await v9.events.add({
            ts: 1_726_000_000_001,
            path: 'api_port/port',
            api: { marker: 'v9-event-1' },
            req: { api_deck_id: '1' },
        });
        const secondEventId = await v9.events.add({
            ts: 1_726_000_000_002,
            path: 'api_port/port',
            api: { marker: 'v9-event-2' },
            req: { api_deck_id: '2' },
        });
        const wantedId = await v9.wanted.add({
            eventId: firstEventId,
            tag: 'v9-wanted',
            ts: 1_726_000_000_003,
            path: 'api_req_sortie/battle',
        });
        await v9.sorties.add({
            eventId: firstEventId,
            sortieKey: firstEventId,
            ts: 1_726_000_000_004,
            map: '6-5',
            node: 3,
            boss: true,
            kind: 'battle',
            rank: 'S',
            seiku: 1,
            enemyIds: [1501],
            enemyIdsEscort: [1502],
            drop: 'v9-drop',
            taiha: false,
        });
        await v9.notified.add({ deckId: 2, completeAt: 1_726_000_600_000, ts: 1_726_000_000_005 });
        await v9.factory.add({
            eventId: secondEventId,
            ts: 1_726_000_000_006,
            kind: 'develop',
            used: [10, 20, 30, 40, 0, 1, 0, 0],
            secretary: 100,
            results: [{ mst: 200 }],
        });
        await v9.replays.add({
            sortieKey: firstEventId,
            ts: 1_726_000_000_007,
            world: 6,
            mapnum: 5,
            diff: 0,
            combined: 0,
            fleetnum: 1,
            fleet1: [],
            fleet2: [],
            battles: [{ node: 3, data: { marker: 'v9-replay' }, rank: 'S' }],
        });
        await v9.expeditions.add({
            eventId: secondEventId,
            ts: 1_726_000_000_008,
            deckId: 2,
            missionId: 5,
            name: 'v9-expedition',
            result: 2,
            resources: [100, 200, 300, 400],
            items: [{ id: 1, count: 2 }],
        });
        await v9.snapshot.add({
            path: 'api_port/port',
            ts: 1_726_000_000_009,
            api: { marker: 'v9-snapshot' },
            req: { api_port: '1' },
        });
        await v9.shipObtained.add({ id: 9001, mst: 100, obtainedTs: null, source: null });

        v9.close();

        const v10 = track(new KcDb(name));
        await v10.open();

        expect(await v10.events.toArray()).toEqual([
            { id: firstEventId, ts: 1_726_000_000_001, path: 'api_port/port', api: { marker: 'v9-event-1' }, req: { api_deck_id: '1' } },
            { id: secondEventId, ts: 1_726_000_000_002, path: 'api_port/port', api: { marker: 'v9-event-2' }, req: { api_deck_id: '2' } },
        ]);
        expect(await v10.wanted.get(wantedId)).toMatchObject({ id: wantedId, eventId: firstEventId, tag: 'v9-wanted' });
        expect(await v10.sorties.get(firstEventId)).toMatchObject({ eventId: firstEventId, sortieKey: firstEventId, map: '6-5', drop: 'v9-drop' });
        expect(await v10.notified.get(2)).toMatchObject({ deckId: 2, completeAt: 1_726_000_600_000 });
        expect(await v10.factory.get(secondEventId)).toMatchObject({ eventId: secondEventId, kind: 'develop', secretary: 100 });
        expect(await v10.replays.get(firstEventId)).toMatchObject({ sortieKey: firstEventId, world: 6, mapnum: 5 });
        expect(await v10.expeditions.get(secondEventId)).toMatchObject({ eventId: secondEventId, deckId: 2, name: 'v9-expedition' });
        expect(await v10.snapshot.get('api_port/port')).toMatchObject({ path: 'api_port/port', api: { marker: 'v9-snapshot' } });
        expect(await v10.shipObtained.get(9001)).toEqual({ id: 9001, mst: 100, obtainedTs: null, source: null });

        expect(await v10.events.where('path').equals('api_port/port').primaryKeys()).toEqual([firstEventId, secondEventId]);
        expect(await v10.wanted.where('eventId').equals(firstEventId).primaryKeys()).toEqual([wantedId]);
        expect(await v10.factory.where('kind').equals('develop').primaryKeys()).toEqual([secondEventId]);
        expect(await v10.replays.where('world').equals(6).primaryKeys()).toEqual([firstEventId]);
        expect(await v10.expeditions.where('deckId').equals(2).primaryKeys()).toEqual([secondEventId]);
        expect(await v10.shipObtained.where('mst').equals(100).primaryKeys()).toEqual([9001]);

        expect(v10.events.schema.primKey.name).toBe('id');
        expect(v10.snapshot.schema.primKey.name).toBe('path');
        expect(v10.events.schema.idxByName.captureId.unique).toBe(true);
        expect(v10.events.schema.idxByName.postProcessState).toBeDefined();
        expect(v10.meta.schema.primKey.name).toBe('key');

        // 兩筆 v9 歷史事件都沒有 captureId；升級不會回填，也不會建立 projection metadata。
        expect((await v10.events.get(firstEventId))?.captureId).toBeUndefined();
        expect((await v10.events.get(firstEventId))?.postProcessState).toBeUndefined();
        expect(await v10.events.where('postProcessState').equals('pending').count()).toBe(0);
        expect(await v10.meta.count()).toBe(0);

        const thirdHistoricEventId = await v10.events.add({
            ts: 1_726_000_000_010,
            path: 'api_get_member/mission',
            api: { marker: 'still-no-capture-id' },
            req: {},
        });
        expect(await v10.events.where('captureId').equals('missing').count()).toBe(0);
        expect([firstEventId, secondEventId, thirdHistoricEventId]).toHaveLength(3);
        expect(await v10.events.count()).toBe(3);

        await v10.events.add({
            ts: 1_726_000_000_011,
            path: 'api_req_map/start',
            api: { marker: 'capture-a' },
            req: {},
            captureId: 'capture-a',
            postProcessState: 'done',
        });
        await expect(v10.events.add({
            ts: 1_726_000_000_012,
            path: 'api_req_map/start',
            api: { marker: 'duplicate-capture-a' },
            req: {},
            captureId: 'capture-a',
        })).rejects.toMatchObject({ name: 'ConstraintError' });
        await expect(v10.events.add({
            ts: 1_726_000_000_013,
            path: 'api_req_map/start',
            api: { marker: 'capture-b' },
            req: {},
            captureId: 'capture-b',
        })).resolves.toEqual(expect.any(Number));

        const projection = { key: 'projection' as const, version: 1, throughEventId: secondEventId, updatedAt: 1_726_000_000_014 };
        await v10.meta.put(projection);
        expect(await v10.meta.get('projection')).toEqual(projection);
    });

    // 這裡刻意寫死目前的版號與表清單：schema 一改就會紅，逼人回來確認「這次真的要改
    // 資料庫結構」而不是手滑。升版時把版號與清單一起更新即可
    // （v11 新增 eventPlans、v12 新增 resources／resourceMarks）。
    it('全新資料庫可直接建立目前的 schema 與 projection metadata', async () => {
        const database = track(new KcDb(databaseName('fresh-current')));
        await database.open();

        expect(database.verno).toBe(12);
        expect(database.tables.map(table => table.name).sort()).toEqual([
            'eventPlans', 'events', 'expeditions', 'factory', 'meta', 'notified', 'replays',
            'resourceMarks', 'resources', 'shipObtained', 'snapshot', 'sorties', 'wanted',
        ]);

        await database.snapshot.put({
            path: 'api_start2/getData',
            ts: 1_726_000_000_100,
            api: { marker: 'fresh-snapshot' },
            eventId: 42,
        });
        expect(await database.snapshot.get('api_start2/getData')).toMatchObject({ eventId: 42 });

        const projection = { key: 'projection' as const, version: 1, throughEventId: 42, updatedAt: 1_726_000_000_101 };
        await database.meta.add(projection);
        expect(await database.meta.get('projection')).toEqual(projection);
    });
});
