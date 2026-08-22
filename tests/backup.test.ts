import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BackupDestinationError, BackupValidationError, backupFileName, combineBackupEnvelopes,
    countBackupRecords, highestReferencedEventId, isEmptyBackup, MAX_RESTORABLE_SOURCE_EVENT_ID,
    parseBackupJson, restoreBackup, unusedBackupFileName, validateBackupEnvelope,
} from '../utils/backup';
import { KcDb, type ExpeditionRow } from '../utils/db';

const databases: KcDb[] = [];
let serial = 0;
const TS = 1_726_000_000_000;

function createDb() {
    const database = new KcDb(`kc-backup-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function restoreTables() {
    return {
        snapshot: [{ path: 'api_port/port', ts: TS, api: { api_ship: [{ api_id: 1 }] }, req: { api_deck_id: '1' }, eventId: 1 }],
        sorties: [{
            eventId: 2, sortieKey: 1, ts: TS, map: '6-5', node: 3, boss: true, kind: 'battle', rank: 'S',
            seiku: 1, enemyIds: [1501], enemyIdsEscort: [], drop: null, taiha: false, dropMst: 124,
        }],
        expeditions: [{
            eventId: 3, ts: TS, deckId: 2, missionId: 5, name: '遠征', result: 2,
            resources: [1, 2, 3, 4], items: [{ id: 1, count: 2 }],
        }],
        factory: [{ eventId: 4, ts: TS, kind: 'develop', used: [1, 2, 3, 4, 0, 1, 0, 0], secretary: 100, results: [{ mst: 200 }] }],
        wanted: [{ id: 1, eventId: 5, tag: 'fixture', ts: TS, path: 'api_req_sortie/battle' }],
    };
}

function replayTables() {
    return {
        replays: [{
            sortieKey: 1, ts: TS, world: 6, mapnum: 5, diff: 4, combined: 0, fleetnum: 1,
            fleet1: [{ mst_id: 100, lv: 99, equip: [-1], stars: [0], ace: [0], exequip: -1, nowhp: 30, maxhp: 30, cond: 49 }],
            fleet2: [], battles: [{ node: 3, data: { opaque: ['do not', 'interpret'] }, rank: 'S' }],
        }],
    };
}

function v3Replays(sortieKey = 1) {
    const tables = replayTables();
    tables.replays[0].sortieKey = sortieKey;
    return { schemaVersion: 3, kind: 'replays', exportedAt: TS, tables };
}

function v3Restore() {
    return {
        schemaVersion: 3,
        kind: 'restore',
        exportedAt: TS,
        tables: {
            ...restoreTables(),
            shipObtained: [
                { id: 101, mst: 124, obtainedTs: null, source: null },
                { id: 102, mst: 125, obtainedTs: TS, source: 'auto', observedEventId: 5 },
            ],
        },
    };
}

function emptyV3Restore() {
    return {
        schemaVersion: 3,
        kind: 'restore',
        exportedAt: TS,
        tables: {
            snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [], shipObtained: [],
        },
    };
}

/** v6 現行完整檔：所有 restore tables 與 replays 必須一次具備。 */
function v6Full() {
    const restore = v3Restore().tables;
    const replays = v3Replays().tables;
    return {
        schemaVersion: 6,
        kind: 'full',
        exportedAt: TS,
        tables: {
            ...restore,
            replays: replays.replays,
            // v3 時尚未存在的資料表，在遷移到 v6 完整格式時誠實表示為空歷史。
            eventPlans: [], resources: [], resourceMarks: [],
        },
    };
}

function rawEvent(path = 'api_port/port') {
    return { ts: TS, path, api: { fixture: true }, req: {} };
}

async function databaseState(database: KcDb) {
    const [
        events, meta, notified, snapshot, sorties, expeditions, factory, replays, wanted, shipObtained,
    ] = await Promise.all([
        database.events.toArray(), database.meta.toArray(), database.notified.toArray(),
        database.snapshot.toArray(), database.sorties.toArray(), database.expeditions.toArray(),
        database.factory.toArray(), database.replays.toArray(), database.wanted.toArray(),
        database.shipObtained.toArray(),
    ]);
    return { events, meta, notified, snapshot, sorties, expeditions, factory, replays, wanted, shipObtained };
}

function allReferencedIdTables(): BackupTables {
    const restore = validateBackupEnvelope(v3Restore());
    const replays = validateBackupEnvelope(v3Replays());
    const tables = { ...restore.tables, replays: replays.tables.replays };
    tables.snapshot![0].eventId = 1;
    tables.sorties![0].eventId = 1;
    tables.sorties![0].sortieKey = 1;
    tables.expeditions![0].eventId = 1;
    tables.factory![0].eventId = 1;
    tables.replays![0].sortieKey = 1;
    tables.wanted![0].eventId = 1;
    tables.shipObtained![1].observedEventId = 1;
    return tables;
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('備份 envelope runtime validation', () => {
    it('接受 v1 legacy-full、v2 split 與含 shipObtained 的 v3 restore', () => {
        const v1 = { schemaVersion: 1, exportedAt: TS, tables: { ...restoreTables(), ...replayTables() } };
        const v2Restore = { schemaVersion: 2, kind: 'restore', exportedAt: TS, tables: restoreTables() };
        const v2Replays = { schemaVersion: 2, kind: 'replays', exportedAt: TS, tables: replayTables() };
        const v3 = v3Restore();

        expect(validateBackupEnvelope(v1).kind).toBe('legacy-full');
        expect(validateBackupEnvelope(v2Restore).kind).toBe('restore');
        expect(validateBackupEnvelope(v2Replays).kind).toBe('replays');
        expect(validateBackupEnvelope(v3).tables.shipObtained).toHaveLength(2);
    });

    it('v6 只接受一份包含所有資料表的 full 備份', () => {
        const full = validateBackupEnvelope(v6Full());
        expect(full.kind).toBe('full');
        expect(full.tables.sorties).toHaveLength(1);
        expect(full.tables.replays).toHaveLength(1);

        expect(() => validateBackupEnvelope({ ...v6Full(), kind: 'restore' }))
            .toThrow(BackupValidationError);
        const missing = v6Full();
        delete (missing.tables as Record<string, unknown>).replays;
        expect(() => validateBackupEnvelope(missing)).toThrow(BackupValidationError);
    });

    it('舊版 restore + replays 一次選取後正規化為完整 v6，順序不影響結果', () => {
        const normal = combineBackupEnvelopes([v3Restore(), v3Replays()]);
        const reverse = combineBackupEnvelopes([v3Replays(), v3Restore()]);

        expect(normal).toMatchObject({ schemaVersion: 6, kind: 'full' });
        expect(reverse.tables).toEqual(normal.tables);
        expect(normal.tables.eventPlans).toEqual([]);
        expect(normal.tables.resources).toEqual([]);
        expect(normal.tables.replays).toHaveLength(1);
    });

    it('舊版 split 少一檔或多選不相容檔案時，在寫入前拒絕', () => {
        expect(() => combineBackupEnvelopes([v3Restore()])).toThrow(BackupValidationError);
        expect(() => combineBackupEnvelopes([v3Replays()])).toThrow(BackupValidationError);
        expect(() => combineBackupEnvelopes([v3Restore(), v3Restore()])).toThrow(BackupValidationError);
        expect(() => combineBackupEnvelopes([v6Full(), v3Replays()])).toThrow(BackupValidationError);
    });

    it('v6 full 以一次 transaction 還原摘要與重播，並標記兩層皆完成', async () => {
        const database = createDb();
        await restoreBackup(database, v6Full());

        expect(await database.sorties.count()).toBe(1);
        expect(await database.replays.count()).toBe(1);
        expect(await database.meta.get('backup-restore')).toMatchObject({
            importedRestore: true, importedReplays: true,
        });
        expect(await database.events.add(rawEvent('api_mock/v6_full'))).toBeGreaterThan(5);
    });

    it('舊雙檔先合併再還原，失敗前不會留下只有摘要的半套出擊', async () => {
        const database = createDb();
        await expect(restoreBackup(database, combineBackupEnvelopes([v3Restore(), v3Replays()])))
            .resolves.toBeUndefined();

        expect(await database.sorties.count()).toBe(1);
        expect(await database.replays.count()).toBe(1);
    });

    it('拒絕未知或零/負版本、錯誤 kind、非陣列資料表、缺少主鍵與非有限數值', () => {
        const cases: unknown[] = [
            { ...v3Restore(), schemaVersion: 4 },
            { ...v3Restore(), schemaVersion: 0 },
            { ...v3Restore(), schemaVersion: -1 },
            { ...v3Restore(), kind: 'legacy-full' },
            { ...v3Restore(), tables: { ...v3Restore().tables, snapshot: {} } },
            { ...v3Restore(), tables: { ...v3Restore().tables, sorties: [{ ...restoreTables().sorties[0], eventId: undefined }] } },
            { ...v3Restore(), tables: { ...v3Restore().tables, snapshot: [{ ...restoreTables().snapshot[0], ts: Number.POSITIVE_INFINITY }] } },
        ];

        for (const input of cases) {
            expect(() => validateBackupEnvelope(input)).toThrow(BackupValidationError);
        }
    });

    it('拒絕錯誤的 tables 組合與危險 snapshot.req', () => {
        const v3 = v3Restore();
        const malformedKindTables = { schemaVersion: 3, kind: 'replays', exportedAt: TS, tables: v3.tables };
        expect(() => validateBackupEnvelope(malformedKindTables)).toThrow(BackupValidationError);

        for (const key of ['api_token', 'api_verno']) {
            const unsafe = v3Restore() as unknown as { tables: { snapshot: Array<{ req: Record<string, string> }> } };
            unsafe.tables.snapshot[0].req = { [key]: 'secret' };
            expect(() => validateBackupEnvelope(unsafe)).toThrow(BackupValidationError);
        }
    });

    it('JSON parser 不信任 cast，且保留合法 api 原始內容不改寫', () => {
        const opaqueApi = { nested: { arbitrary: ['raw', { value: 1 }] } };
        const input = v3Restore() as unknown as { tables: { snapshot: Array<{ api: unknown }> } };
        input.tables.snapshot[0].api = opaqueApi;
        const validated = validateBackupEnvelope(input);

        expect(validated.tables.snapshot?.[0].api).toBe(opaqueApi);
        expect(() => parseBackupJson('{not json')).toThrow('備份檔不是有效的 JSON');
    });

    // 備份檔是使用者可以任意編輯的外部輸入；驗證器只應保留明確列舉的鍵，避免未知欄位
    // 進入 IndexedDB 後被各分區當成自家欄位讀取。
    it('未列舉的多餘欄位一律丟棄，不會進到還原結果', () => {
        const input = v3Restore() as unknown as { tables: Record<string, Array<Record<string, unknown>>> };
        input.tables.snapshot[0].evil = { nested: true };
        input.tables.sorties[0].__proto__x = 'x';
        input.tables.sorties[0].imported = true;
        input.tables.expeditions[0].evil = 1;
        input.tables.factory[0].evil = 'x';
        input.tables.wanted[0].evil = [1];
        input.tables.shipObtained[0].evil = 'x';

        const tables = validateBackupEnvelope(input).tables;

        const rows: object[] = [
            tables.snapshot![0], tables.sorties![0], tables.expeditions![0],
            tables.factory![0], tables.wanted![0], tables.shipObtained![0],
        ];
        for (const row of rows) {
            expect(Object.keys(row)).not.toContain('evil');
            expect(Object.keys(row)).not.toContain('__proto__x');
        }
        // 已列舉的可選欄位仍要留著（丟棄的只有未列舉的鍵）。
        expect(tables.sorties![0].imported).toBe(true);
    });

    it('replays 的巢狀結構同樣只保留已驗證欄位', () => {
        const input = v3Replays() as unknown as {
            tables: { replays: Array<Record<string, any>> };
        };
        input.tables.replays[0].evil = 1;
        input.tables.replays[0].fleet1[0].evil = 1;
        input.tables.replays[0].battles[0].evil = 1;

        const replay = validateBackupEnvelope(input).tables.replays![0];

        expect(Object.keys(replay)).not.toContain('evil');
        expect(Object.keys(replay.fleet1[0])).not.toContain('evil');
        expect(Object.keys(replay.battles[0])).not.toContain('evil');
        // 戰鬥封包本身是 opaque 原始內容，不得被逐欄過濾掉。
        expect(replay.battles[0].data).toEqual({ opaque: ['do not', 'interpret'] });
    });

    // 建造紀錄分區直接把這兩個名字當字串餵給 esc()：放行物件會讓整個分區在渲染時炸掉。
    it('factory 的匯入備援欄位型別不對時整列拒絕，不寫入', async () => {
        const database = createDb();
        const cases: Array<Record<string, unknown>> = [
            { importedShipName: { toString: 'evil' } },
            { importedSecretaryName: 42 },
            { imported: 'yes' },
            { hqLv: '120' },
        ];

        for (const patch of cases) {
            const input = v3Restore() as unknown as { tables: { factory: Array<Record<string, unknown>> } };
            Object.assign(input.tables.factory[0], patch);
            expect(() => validateBackupEnvelope(input), JSON.stringify(patch)).toThrow(BackupValidationError);
            await expect(restoreBackup(database, input)).rejects.toBeInstanceOf(BackupValidationError);
        }

        expect(await database.factory.count()).toBe(0);
        expect(await database.events.count()).toBe(0);
    });

    it('factory 的匯入欄位型別正確時原樣往返', () => {
        const input = v3Restore() as unknown as { tables: { factory: Array<Record<string, unknown>> } };
        Object.assign(input.tables.factory[0], {
            imported: true, importedShipName: '謎の艦', importedSecretaryName: '睦月', hqLv: 120,
        });
        expect(validateBackupEnvelope(input).tables.factory![0]).toMatchObject({
            imported: true, importedShipName: '謎の艦', importedSecretaryName: '睦月', hqLv: 120,
        });
    });

    it('遠征編成快照可往返，格式不完整時拒絕而不靜默遺失', () => {
        const input = v3Restore();
        (input.tables.expeditions[0] as ExpeditionRow).fleet = [{ name: '睦月', level: 99 }];
        expect(validateBackupEnvelope(input).tables.expeditions?.[0].fleet)
            .toEqual([{ name: '睦月', level: 99 }]);

        const malformed = v3Restore();
        (malformed.tables.expeditions[0] as ExpeditionRow).fleet = [{ name: '睦月', level: 0 }];
        expect(() => validateBackupEnvelope(malformed)).toThrow(BackupValidationError);
    });

    it('最高來源 ID 計算涵蓋所有關聯欄位，factory 小數主鍵以原值納入上界', () => {
        const cases: Array<[string, (tables: BackupTables) => void, number]> = [
            ['snapshot.eventId', tables => { tables.snapshot![0].eventId = 101; }, 101],
            ['sorties.eventId', tables => { tables.sorties![0].eventId = 102; }, 102],
            ['sorties.sortieKey', tables => { tables.sorties![0].sortieKey = 103; }, 103],
            ['factory.eventId', tables => { tables.factory![0].eventId = 104.875; }, 104.875],
            ['replays.sortieKey', tables => { tables.replays![0].sortieKey = 105; }, 105],
            ['expeditions.eventId', tables => { tables.expeditions![0].eventId = 106; }, 106],
            ['wanted.eventId', tables => { tables.wanted![0].eventId = 107; }, 107],
            ['shipObtained.observedEventId', tables => { tables.shipObtained![1].observedEventId = 108; }, 108],
        ];

        for (const [where, mutate, expected] of cases) {
            const tables = allReferencedIdTables();
            mutate(tables);
            expect(highestReferencedEventId(tables), where).toBe(expected);
        }
    });
});

describe('備份還原 transaction', () => {
    it('空資料庫可成功匯入 restore，wanted 重新配號且不留下 reservation row', async () => {
        const database = createDb();
        const input = v3Restore();
        input.tables.wanted[0].id = 99;

        await restoreBackup(database, input);

        expect(await database.snapshot.get('api_port/port')).toMatchObject({
            path: 'api_port/port', req: { api_deck_id: '1' }, eventId: 1,
        });
        expect(await database.sorties.get(2)).toMatchObject({ dropMst: 124, map: '6-5' });
        expect(await database.expeditions.get(3)).toMatchObject({ missionId: 5 });
        expect(await database.factory.get(4)).toMatchObject({ kind: 'develop' });
        expect(await database.replays.count()).toBe(0);
        expect(await database.shipObtained.get(101)).toEqual({ id: 101, mst: 124, obtainedTs: null, source: null });
        expect(await database.shipObtained.get(102)).toEqual({
            id: 102, mst: 125, obtainedTs: TS, source: 'auto', observedEventId: 5,
        });
        expect(await database.wanted.toArray()).toEqual([
            { id: 1, eventId: 5, tag: 'fixture', ts: TS, path: 'api_req_sortie/battle' },
        ]);
        expect(await database.events.toArray()).toEqual([]);

        const nextId = await database.events.add(rawEvent('api_mock/after_restore'));
        expect(nextId).toBe(6);
    });

    it('關閉並重新開啟資料庫後，還原資料與 sequence high-water 仍持久存在', async () => {
        const database = createDb();
        await restoreBackup(database, v3Restore());

        database.close();
        await database.open();

        expect(await database.snapshot.get('api_port/port')).toMatchObject({ eventId: 1 });
        expect(await database.meta.get('backup-restore')).toMatchObject({ highestSourceEventId: 5 });
        expect(await database.events.count()).toBe(0);
        expect(await database.events.add(rawEvent('api_mock/after_reopen'))).toBe(6);
    });

    it('restore 後可匯入 complementary replays，並以兩檔較高 ID 延續', async () => {
        const database = createDb();
        const restore = v3Restore();
        restore.tables.wanted[0].eventId = 80;
        const replays = v3Replays(120);

        await restoreBackup(database, restore);
        await restoreBackup(database, replays);

        expect(await database.snapshot.count()).toBe(1);
        expect(await database.replays.get(120)).toMatchObject({ world: 6, mapnum: 5 });
        expect(await database.events.count()).toBe(0);
        expect(await database.meta.get('backup-restore')).toMatchObject({
            importedRestore: true, importedReplays: true, highestSourceEventId: 120,
        });
        expect(await database.events.add(rawEvent('api_mock/restore_then_replays'))).toBeGreaterThan(120);
    });

    it('replays 後可匯入 complementary restore，並保留先匯入檔案的較高 ID', async () => {
        const database = createDb();
        const replays = v3Replays(120);
        const restore = v3Restore();
        restore.tables.wanted[0].eventId = 80;

        await restoreBackup(database, replays);
        await restoreBackup(database, restore);

        expect(await database.replays.get(120)).toMatchObject({ world: 6, mapnum: 5 });
        expect(await database.snapshot.count()).toBe(1);
        expect(await database.events.count()).toBe(0);
        expect(await database.meta.get('backup-restore')).toMatchObject({
            importedRestore: true, importedReplays: true, highestSourceEventId: 120,
        });
        expect(await database.events.add(rawEvent('api_mock/replays_then_restore'))).toBeGreaterThan(120);
    });

    it('先前 complementary rows 已裁剪時仍沿用 import marker 保存的最高 ID', async () => {
        const database = createDb();
        await restoreBackup(database, v3Replays(500));
        await database.replays.clear();

        await restoreBackup(database, v3Restore());

        expect(await database.meta.get('backup-restore')).toMatchObject({
            importedRestore: true, importedReplays: true, highestSourceEventId: 500,
        });
        expect(await database.events.add(rawEvent('api_mock/marker_high_water'))).toBeGreaterThan(500);
    });

    it('v1 legacy-full 可經正規化後一次還原所有目標 tables', async () => {
        const database = createDb();
        const v1 = validateBackupEnvelope({
            schemaVersion: 1, exportedAt: TS, tables: { ...restoreTables(), ...replayTables() },
        });

        await restoreBackup(database, v1);

        expect(await database.snapshot.get('api_port/port')).toMatchObject({ path: 'api_port/port' });
        expect(await database.replays.get(1)).toMatchObject({ diff: 4, world: 6, mapnum: 5 });
        expect(await database.sorties.count()).toBe(1);
        expect(await database.expeditions.count()).toBe(1);
        expect(await database.factory.count()).toBe(1);
        expect(await database.wanted.count()).toBe(1);
        expect(await database.events.count()).toBe(0);
        expect(await database.events.add(rawEvent('api_mock/legacy'))).toBeGreaterThan(5);
    });

    it('raw events 非空時拒絕匯入，所有 object stores 與 generator 皆保持不變', async () => {
        const database = createDb();
        const restore = validateBackupEnvelope(v3Restore()).tables;
        const replays = validateBackupEnvelope(v3Replays()).tables;
        await database.events.add(rawEvent('api_mock/local'));
        await database.meta.put({ key: 'projection', version: 3, throughEventId: 1, updatedAt: TS });
        await database.notified.put({ deckId: 2, completeAt: TS + 60_000, ts: TS });
        await database.snapshot.bulkPut(restore.snapshot!);
        await database.sorties.bulkPut(restore.sorties!);
        await database.expeditions.bulkPut(restore.expeditions!);
        await database.factory.bulkPut(restore.factory!);
        await database.replays.bulkPut(replays.replays!);
        await database.wanted.bulkPut(restore.wanted!);
        await database.shipObtained.bulkPut(restore.shipObtained!);
        const before = await databaseState(database);

        await expect(restoreBackup(database, v3Restore())).rejects.toThrow('raw events');

        expect(await databaseState(database)).toEqual(before);
        expect(await database.events.add(rawEvent('api_mock/still_local'))).toBe(2);
    });

    it('目標 derived table 非空時拒絕同主鍵匯入，不覆寫或寫入其他 table', async () => {
        const database = createDb();
        const existing = validateBackupEnvelope(v3Restore()).tables.sorties![0];
        await database.sorties.put({ ...existing, map: 'local', rank: 'A' });
        const before = await databaseState(database);

        await expect(restoreBackup(database, v3Restore())).rejects.toBeInstanceOf(BackupDestinationError);

        expect(await databaseState(database)).toEqual(before);
        expect(await database.sorties.get(existing.eventId)).toMatchObject({ map: 'local', rank: 'A' });
        expect(await database.events.add(rawEvent('api_mock/no_preflight_probe'))).toBe(1);
    });

    it('replays 目標 table 非空且沒有安全 import marker 時拒絕來源不明資料', async () => {
        const database = createDb();
        const existing = validateBackupEnvelope(v3Replays(33)).tables.replays![0];
        await database.replays.put({ ...existing, nickname: 'local-replay' });
        const before = await databaseState(database);

        await expect(restoreBackup(database, v3Replays(33))).rejects.toBeInstanceOf(BackupDestinationError);

        expect(await databaseState(database)).toEqual(before);
        expect(await database.replays.get(33)).toMatchObject({ nickname: 'local-replay' });
    });

    it('rows 雖為空但 events generator 曾被未知寫入推進時仍拒絕，且不再改動 sequence', async () => {
        const database = createDb();
        const priorId = await database.events.add(rawEvent('api_mock/deleted_history'));
        await database.events.delete(priorId);

        await expect(restoreBackup(database, v3Restore())).rejects.toBeInstanceOf(BackupDestinationError);

        expect(await databaseState(database)).toEqual({
            events: [], meta: [], notified: [], snapshot: [], sorties: [], expeditions: [],
            factory: [], replays: [], wanted: [], shipObtained: [],
        });
        expect(await database.events.add(rawEvent('api_mock/after_unknown_history'))).toBe(2);
    });

    it('既有 ingestion side-effect 或 projection metadata 都會拒絕，且不推進 generator', async () => {
        const notifiedDb = createDb();
        await notifiedDb.notified.put({ deckId: 3, completeAt: TS, ts: TS });
        await expect(restoreBackup(notifiedDb, v3Restore())).rejects.toBeInstanceOf(BackupDestinationError);
        expect(await notifiedDb.events.add(rawEvent('api_mock/notified_rejected'))).toBe(1);

        const projectedDb = createDb();
        await projectedDb.meta.put({ key: 'projection', version: 3, throughEventId: 0, updatedAt: TS });
        await expect(restoreBackup(projectedDb, v3Restore())).rejects.toBeInstanceOf(BackupDestinationError);
        expect(await projectedDb.events.add(rawEvent('api_mock/projection_rejected'))).toBe(1);
    });

    it('重複匯入同一份非空檔案會安全拒絕，第一次資料完全不變', async () => {
        const database = createDb();
        const envelope = v3Restore();

        await restoreBackup(database, envelope);
        const once = await databaseState(database);
        await expect(restoreBackup(database, envelope)).rejects.toBeInstanceOf(BackupDestinationError);

        expect(await databaseState(database)).toEqual(once);
    });

    it('即使檔案沒有 rows，import marker 仍會讓重複匯入安全拒絕', async () => {
        const database = createDb();
        const envelope = emptyV3Restore();

        await restoreBackup(database, envelope);
        expect(await database.snapshot.count()).toBe(0);
        expect(await database.meta.get('backup-restore')).toMatchObject({
            importedRestore: true, importedReplays: false, highestSourceEventId: 0,
        });
        const once = await databaseState(database);

        await expect(restoreBackup(database, envelope)).rejects.toBeInstanceOf(BackupDestinationError);
        expect(await databaseState(database)).toEqual(once);
        expect(await database.events.add(rawEvent('api_mock/after_empty_duplicate'))).toBe(2);
    });

    it('factory 小數 eventId 會以 ceil 推進 sequence，成功後不留下暫存事件', async () => {
        const database = createDb();
        const envelope = v3Restore();
        envelope.tables.factory[0].eventId = 50.25;

        await restoreBackup(database, envelope);

        expect(await database.events.toArray()).toEqual([]);
        expect(await database.factory.get(50.25)).toMatchObject({ kind: 'develop' });
        expect(await database.events.add(rawEvent('api_mock/decimal_factory'))).toBe(52);
    });

    it('統一 safe 上界可完成兩個 split，並保留一筆安全的未來 raw event ID', async () => {
        const database = createDb();

        await restoreBackup(database, v3Replays(MAX_RESTORABLE_SOURCE_EVENT_ID));
        await restoreBackup(database, emptyV3Restore());

        expect(await database.events.count()).toBe(0);
        expect(await database.events.add(rawEvent('api_mock/safe_boundary'))).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('malformed、負值、非有限及超出 safe range 的來源 ID 都不會推進 sequence', async () => {
        const database = createDb();
        const invalidIds: unknown[] = [
            '5', -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_RESTORABLE_SOURCE_EVENT_ID + 1,
        ];

        for (const eventId of invalidIds) {
            const input = v3Restore() as unknown as {
                tables: { snapshot: Array<Record<string, unknown>> };
            };
            input.tables.snapshot[0].eventId = eventId;
            await expect(restoreBackup(database, input)).rejects.toBeInstanceOf(BackupValidationError);
        }

        expect(await database.events.count()).toBe(0);
        expect(await database.meta.count()).toBe(0);
        expect(await database.events.add(rawEvent('api_mock/after_invalid'))).toBe(1);
    });

    it('還原入口會再次完整驗證，壞列不會留下任何部分寫入', async () => {
        const database = createDb();
        const invalid = v3Restore();
        invalid.tables.sorties[0].ts = Number.NaN;

        await expect(restoreBackup(database, invalid)).rejects.toBeInstanceOf(BackupValidationError);

        expect(await database.snapshot.count()).toBe(0);
        expect(await database.sorties.count()).toBe(0);
        expect(await database.shipObtained.count()).toBe(0);
        expect(await database.events.add(rawEvent('api_mock/after_malformed'))).toBe(1);
    });

    it('任一 target table 寫入失敗時，資料與 sequence guard 一起 rollback', async () => {
        const database = createDb();
        const envelope = validateBackupEnvelope(v3Restore());
        vi.spyOn(database.factory, 'bulkPut').mockRejectedValueOnce(new Error('fixture factory write failure'));

        await expect(restoreBackup(database, envelope)).rejects.toThrow('fixture factory write failure');

        expect(await database.snapshot.count()).toBe(0);
        expect(await database.sorties.count()).toBe(0);
        expect(await database.expeditions.count()).toBe(0);
        expect(await database.factory.count()).toBe(0);
        expect(await database.wanted.count()).toBe(0);
        expect(await database.shipObtained.count()).toBe(0);
        expect(await database.meta.count()).toBe(0);
        expect(await database.events.count()).toBe(0);
        expect(await database.events.add(rawEvent('api_mock/after_write_rollback'))).toBe(1);
    });

    it('sequence reservation 完成後 meta 寫入失敗，rows 與 key generator 仍全部 rollback', async () => {
        const database = createDb();
        const envelope = v3Restore();
        envelope.tables.wanted[0].eventId = 500;
        vi.spyOn(database.meta, 'put').mockRejectedValueOnce(new Error('fixture meta write failure'));

        await expect(restoreBackup(database, envelope)).rejects.toThrow('fixture meta write failure');

        expect(await databaseState(database)).toEqual({
            events: [], meta: [], notified: [], snapshot: [], sorties: [], expeditions: [],
            factory: [], replays: [], wanted: [], shipObtained: [],
        });
        expect(await database.events.add(rawEvent('api_mock/after_meta_rollback'))).toBe(1);
    });
});

describe('備份檔名與空備份拒絕', () => {
    it('檔名用本地日期與時分秒，不是 UTC；同一秒再備加序號', () => {
        const ts = new Date(2026, 7, 14, 3, 8, 9).getTime();
        expect(backupFileName(ts)).toBe('kanmusu-backup-2026-08-14-030809.json');
        expect(backupFileName(ts, 1)).toBe('kanmusu-backup-2026-08-14-030809.json');
        expect(backupFileName(ts, 2)).toBe('kanmusu-backup-2026-08-14-030809-2.json');
    });

    it('資料夾撞名時跳過已佔用檔名', async () => {
        const ts = new Date(2026, 7, 14, 3, 8, 9).getTime();
        const taken = new Set([
            'kanmusu-backup-2026-08-14-030809.json',
            'kanmusu-backup-2026-08-14-030809-2.json',
        ]);
        await expect(unusedBackupFileName(ts, name => taken.has(name)))
            .resolves.toBe('kanmusu-backup-2026-08-14-030809-3.json');
    });

    it('表全空視為不可寫檔；有任一筆記錄即可', () => {
        const empty = validateBackupEnvelope({
            schemaVersion: 6, kind: 'full', exportedAt: TS,
            tables: {
                snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
                shipObtained: [], eventPlans: [], resources: [], resourceMarks: [], replays: [],
            },
        });
        expect(isEmptyBackup(empty.tables)).toBe(true);
        expect(countBackupRecords(empty.tables)).toBe(0);
        expect(isEmptyBackup(validateBackupEnvelope(v6Full()).tables)).toBe(false);
    });
});
