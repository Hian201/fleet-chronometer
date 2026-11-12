// 備份 envelope v9：full 包新增 goals（玩家在「目標規劃」設定的目標）。
// 目標是玩家自己輸入的資料，無法從封包重建；不帶這張表，重裝後就得全部重設。
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type GoalRow } from '../utils/db';
import {
    BACKUP_SCHEMA_VERSION, BackupValidationError, buildFullEnvelope, restoreBackup, validateBackupEnvelope,
} from '../utils/backup';
import { goalsFromRows, goalsToRows } from '../utils/remodel-goals';

const TS = 1_700_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v9-goals-${dbIndex++}`);
    await database.open();
});

const GOALS: GoalRow[] = goalsToRows([{ shipId: 12, targetMst: 911 }, { shipId: 7, targetMst: 553 }]);

function v8Tables() {
    return {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: [], questSeen: [], replays: [],
    };
}
const v9Full = (goals: unknown[] = GOALS) => ({
    schemaVersion: 9, kind: 'full', exportedAt: TS, tables: { ...v8Tables(), goals },
});

describe('版本協商', () => {
    it('目前版本為 10', () => expect(BACKUP_SCHEMA_VERSION).toBe(10));

    it('v9 full 必須含 goals', () => {
        expect(() => validateBackupEnvelope({ schemaVersion: 9, kind: 'full', exportedAt: TS, tables: v8Tables() }))
            .toThrow(BackupValidationError);
    });

    it('v8 舊檔仍可匯入，且不得夾帶 goals', () => {
        expect(validateBackupEnvelope({ schemaVersion: 8, kind: 'full', exportedAt: TS, tables: v8Tables() })
            .tables.goals).toBeUndefined();
        expect(() => validateBackupEnvelope({
            schemaVersion: 8, kind: 'full', exportedAt: TS, tables: { ...v8Tables(), goals: [] },
        })).toThrow(BackupValidationError);
    });
});

describe('欄位驗證', () => {
    it('主鍵與內容不一致、重複主鍵、未知種類、非正整數 id 一律拒絕', () => {
        const bad = (row: unknown) => () => validateBackupEnvelope(v9Full([row]));
        expect(bad({ ...GOALS[0], key: 'remodel:99' })).toThrow(BackupValidationError);
        expect(bad({ ...GOALS[0], kind: 'stockpile' })).toThrow(BackupValidationError);
        expect(bad({ ...GOALS[0], targetMst: 0 })).toThrow(BackupValidationError);
        expect(bad({ ...GOALS[0], order: -1 })).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope(v9Full([GOALS[0], GOALS[0]]))).toThrow(BackupValidationError);
    });

    it('多餘欄位不帶進資料庫', () => {
        const [row] = validateBackupEnvelope(v9Full([{ ...GOALS[0], extra: 'x' }])).tables.goals!;
        expect(row).toEqual(GOALS[0]);
    });
});

describe('匯出與還原往返', () => {
    it('匯出帶 goals，還原後順序不變', async () => {
        await database.goals.bulkPut(GOALS);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(envelope.tables.goals).toHaveLength(2);

        const fresh = new KcDb(`backup-v9-goals-fresh-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, JSON.parse(JSON.stringify(envelope)));
        expect(goalsFromRows(await fresh.goals.toArray()))
            .toEqual([{ shipId: 12, targetMst: 911 }, { shipId: 7, targetMst: 553 }]);
        fresh.close();
    });

    it('v8 舊檔還原後 goals 維持空表', async () => {
        await restoreBackup(database, {
            schemaVersion: 8, kind: 'full', exportedAt: TS,
            tables: { ...v8Tables(), questObserved: [{ eventId: 5, questNo: 201, ts: TS }] },
        });
        expect(await database.goals.count()).toBe(0);
        expect(await database.questObserved.count()).toBe(1);
    });

    it('目標表已有資料時整批拒絕，既有目標不動', async () => {
        await database.goals.put(GOALS[0]);
        await expect(restoreBackup(database, v9Full())).rejects.toThrow();
        expect(await database.goals.toArray()).toEqual([GOALS[0]]);
    });
});

describe('v14 → v15 升級', () => {
    it('純新增 goals 表，既有資料不受影響', async () => {
        const name = `backup-v9-goals-upgrade-${dbIndex++}`;
        const v14 = new Dexie(name);
        v14.version(14).stores({
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
            meta: 'key',
        });
        await v14.open();
        await v14.table('questObserved').put({ eventId: 77, questNo: 201, ts: TS });
        await v14.table('resources').put({ eventId: 3, ts: TS, m: [1, 2, 3, 4, 5, 6, 7, 8] });
        v14.close();

        const current = new KcDb(name);
        await current.open();
        expect(current.verno).toBe(16);
        expect(await current.goals.count()).toBe(0);
        expect(await current.questObserved.toArray()).toEqual([{ eventId: 77, questNo: 201, ts: TS }]);
        expect(await current.resources.count()).toBe(1);
        current.close();
    });
});
