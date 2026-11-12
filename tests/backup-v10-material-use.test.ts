// 備份 envelope v10：full 包新增 materialUse（入渠用高速修復材、艦娘改造）。
// 來源 raw events 會被裁剪，不帶這張表，重裝後離散資材分帳就失去這兩項支出。
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type MaterialUseRow } from '../utils/db';
import {
    BackupValidationError, buildFullEnvelope, highestReferencedEventId, restoreBackup, validateBackupEnvelope,
} from '../utils/backup';

const TS = 1_700_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v10-material-use-${dbIndex++}`);
    await database.open();
});

const ROWS: MaterialUseRow[] = [
    { eventId: 11, ts: TS, kind: 'bucket', via: 'start' },
    { eventId: 12, ts: TS + 1, kind: 'bucket', via: 'speedchange' },
    { eventId: 95, ts: TS + 2, kind: 'remodel', shipId: 7, fromMst: 119 },
];

function v9Tables() {
    return {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: [], questSeen: [], goals: [], replays: [],
    };
}
const v10Full = (materialUse: unknown[] = ROWS) => ({
    schemaVersion: 10, kind: 'full', exportedAt: TS, tables: { ...v9Tables(), materialUse },
});

describe('版本協商', () => {
    it('v10 full 必須含 materialUse', () => {
        expect(() => validateBackupEnvelope({ schemaVersion: 10, kind: 'full', exportedAt: TS, tables: v9Tables() }))
            .toThrow(BackupValidationError);
    });

    it('v9 舊檔仍可匯入，且不得夾帶 materialUse', () => {
        expect(validateBackupEnvelope({ schemaVersion: 9, kind: 'full', exportedAt: TS, tables: v9Tables() })
            .tables.materialUse).toBeUndefined();
        expect(() => validateBackupEnvelope({
            schemaVersion: 9, kind: 'full', exportedAt: TS, tables: { ...v9Tables(), materialUse: [] },
        })).toThrow(BackupValidationError);
    });

    it('拒絕重複主鍵與不合格的列', () => {
        for (const bad of [
            [ROWS[0], ROWS[0]],
            [{ eventId: 1, ts: TS, kind: 'bucket', via: 'other' }],
            [{ eventId: 1, ts: TS, kind: 'remodel', shipId: 0, fromMst: 1 }],
            [{ eventId: 1, ts: TS, kind: 'unknown' }],
        ]) {
            expect(() => validateBackupEnvelope(v10Full(bad))).toThrow(BackupValidationError);
        }
    });

    it('materialUse.eventId 納入 high-water', () => {
        expect(highestReferencedEventId({ materialUse: ROWS })).toBe(95);
    });
});

describe('匯出與還原', () => {
    it('匯出帶 materialUse，還原到乾淨環境後逐筆相同', async () => {
        await database.materialUse.bulkPut(ROWS);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(10);
        expect(envelope.tables.materialUse).toEqual(ROWS);

        const fresh = new KcDb(`backup-v10-material-use-fresh-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, JSON.parse(JSON.stringify(envelope)));
        expect(await fresh.materialUse.orderBy('eventId').toArray()).toEqual(ROWS);
        fresh.close();
    });

    it('還原環境已有 materialUse 時拒絕（還原不是 merge）', async () => {
        await database.materialUse.put(ROWS[0]);
        await expect(restoreBackup(database, v10Full())).rejects.toThrow();
        expect(await database.materialUse.count()).toBe(1);
    });
});

describe('v15 → v16 升級', () => {
    it('純新增 materialUse 表，既有資料不受影響', async () => {
        const name = `backup-v10-upgrade-${dbIndex++}`;
        const v15 = new Dexie(name);
        v15.version(15).stores({
            events: '++id, ts, path, &captureId, postProcessState',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
            shipObtained: 'id, mst',
            eventPlans: 'areaId',
            resources: 'eventId, ts',
            resourceMarks: 'key, mapKey, ts',
            questObserved: 'eventId, questNo, ts',
            questSeen: 'questNo, lastTs',
            goals: 'key',
            meta: 'key',
        });
        await v15.open();
        await v15.table('goals').put({ key: 'remodel:7', kind: 'remodel', order: 0, shipId: 7, targetMst: 553 });
        await v15.table('resources').put({ eventId: 3, ts: TS, m: [1, 2, 3, 4, 5, 6, 7, 8] });
        v15.close();

        const current = new KcDb(name);
        await current.open();
        expect(current.verno).toBe(16);
        expect(await current.materialUse.count()).toBe(0);
        expect(await current.goals.count()).toBe(1);
        expect(await current.resources.count()).toBe(1);
        current.close();
    });
});
