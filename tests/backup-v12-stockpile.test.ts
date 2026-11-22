// 備份 envelope v12：goals 多了備蓄目標（kind 'stockpile'，唯一一列）。表組合與 v11 相同；
// v11 以前的檔案不可能有備蓄目標，夾帶時拒絕。
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type GoalRow } from '../utils/db';
import { BACKUP_SCHEMA_VERSION, BackupValidationError, buildFullEnvelope, restoreBackup, validateBackupEnvelope } from '../utils/backup';
import { goalsFromRows, goalsToRows } from '../utils/remodel-goals';
import { stockpileFromRows, stockpileToRow } from '../utils/stockpile';

const TS = 1_700_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v12-stockpile-${dbIndex++}`);
    await database.open();
});

const ROWS: GoalRow[] = [...goalsToRows([{ shipId: 12, targetMst: 911 }]), stockpileToRow({ until: '2026-12-20' })];

const full = (schemaVersion: number, goals: unknown[] = ROWS) => ({
    schemaVersion, kind: 'full', exportedAt: TS, tables: {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: [], questSeen: [], replays: [], goals, materialUse: [], sortieBills: [],
    },
});

describe('版本協商與欄位驗證', () => {
    it('v12 接受備蓄目標；v11 夾帶時拒絕', () => {
        expect(validateBackupEnvelope(full(12)).tables.goals).toEqual(ROWS);
        expect(() => validateBackupEnvelope(full(11))).toThrow(BackupValidationError);
        expect(validateBackupEnvelope(full(11, [ROWS[0]])).tables.goals).toEqual([ROWS[0]]);
    });

    it('主鍵不對、期限格式錯誤一律拒絕；沒設期限可接受，多餘欄位不帶進資料庫', () => {
        const bad = (row: unknown) => () => validateBackupEnvelope(full(12, [row]));
        expect(bad({ ...ROWS[1], key: 'stockpile:1' })).toThrow(BackupValidationError);
        expect(bad({ ...ROWS[1], until: '2026-13-01' })).toThrow(BackupValidationError);
        expect(bad({ ...ROWS[1], until: 1_700_000_000_000 })).toThrow(BackupValidationError);
        expect(validateBackupEnvelope(full(12, [{ ...ROWS[1], until: null, extra: 1 }])).tables.goals)
            .toEqual([{ key: 'stockpile', kind: 'stockpile', until: null }]);
    });
});

describe('匯出與還原往返', () => {
    it('改造目標與備蓄目標都原樣還原', async () => {
        await database.goals.bulkPut(ROWS);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        const fresh = new KcDb(`backup-v12-stockpile-fresh-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, JSON.parse(JSON.stringify(envelope)));
        const rows = await fresh.goals.toArray();
        expect(goalsFromRows(rows)).toEqual([{ shipId: 12, targetMst: 911 }]);
        expect(stockpileFromRows(rows)).toEqual({ until: '2026-12-20' });
        fresh.close();
    });
});
