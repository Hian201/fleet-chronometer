// 備份 envelope v13：resources 多了選填的 exp（api_port/port 的提督累計經驗值）。
// 表組合與 v11／v12 相同；v12 以前的檔案不會有 exp，夾帶時拒絕，沒有 exp 的舊備份照常匯入。
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type ResourceRow } from '../utils/db';
import { BACKUP_SCHEMA_VERSION, BackupValidationError, buildFullEnvelope, restoreBackup, validateBackupEnvelope } from '../utils/backup';

const TS = 1_700_000_000_000;
const MATS = [100_000, 100_000, 100_000, 100_000, 500, 1_500, 800, 120];
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v13-resource-exp-${dbIndex++}`);
    await database.open();
});

const ROWS: ResourceRow[] = [
    { eventId: 10, ts: TS, m: MATS, exp: 28_486_455 },
    { eventId: 11, ts: TS + 60_000, m: MATS },
    { eventId: 12, ts: TS + 120_000, m: MATS, exp: 0 },
];

const full = (schemaVersion: number, resources: unknown[] = ROWS) => ({
    schemaVersion, kind: 'full', exportedAt: TS, tables: {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources, resourceMarks: [],
        questObserved: [], questSeen: [], replays: [], goals: [], materialUse: [], sortieBills: [],
    },
});

const v5Restore = (resources: unknown[]) => ({
    schemaVersion: 5, kind: 'restore', exportedAt: TS, tables: {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources, resourceMarks: [],
    },
});

describe('版本協商與欄位驗證', () => {
    it('目前版本為 13，v13 接受含或不含 exp 的資源列', () => {
        expect(BACKUP_SCHEMA_VERSION).toBe(13);
        const validated = validateBackupEnvelope(full(13)).tables.resources!;
        expect(validated).toEqual(ROWS);
        expect('exp' in validated[1]).toBe(false);
    });

    it('v12 與更舊版本夾帶 exp 一律拒絕；不帶 exp 的舊備份照常匯入', () => {
        expect(() => validateBackupEnvelope(full(12, [ROWS[0]]))).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope(full(12, [ROWS[2]]))).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope(full(12, [{ ...ROWS[1], exp: null }]))).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope(v5Restore([ROWS[0]]))).toThrow(BackupValidationError);

        expect(validateBackupEnvelope(full(12, [ROWS[1]])).tables.resources).toEqual([ROWS[1]]);
        expect(validateBackupEnvelope(v5Restore([ROWS[1]])).tables.resources).toEqual([ROWS[1]]);
    });

    it('v13 拒絕負數、小數、非數字與超出安全整數的 exp，並丟棄多餘未知欄位', () => {
        const bad = (exp: unknown) => () => validateBackupEnvelope(full(13, [{ ...ROWS[1], exp }]));
        expect(bad(-1)).toThrow(BackupValidationError);
        expect(bad(12.5)).toThrow(BackupValidationError);
        expect(bad('100')).toThrow(BackupValidationError);
        expect(bad(null)).toThrow(BackupValidationError);
        expect(bad(Number.MAX_SAFE_INTEGER + 1)).toThrow(BackupValidationError);

        expect(validateBackupEnvelope(full(13, [{ ...ROWS[0], extra: 1 }])).tables.resources)
            .toEqual([ROWS[0]]);
    });
});

describe('匯出與還原往返', () => {
    it('帶 exp 與不帶 exp 的資料列經過匯出再還原後逐筆原樣保留', async () => {
        await database.resources.bulkPut(ROWS);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);

        const fresh = new KcDb(`backup-v13-resource-exp-fresh-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, JSON.parse(JSON.stringify(envelope)));

        const rows = (await fresh.resources.orderBy('eventId').toArray());
        expect(rows).toEqual(ROWS);
        expect('exp' in rows[1]).toBe(false);
        fresh.close();
    });
});
