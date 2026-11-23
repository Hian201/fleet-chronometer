// 備份 envelope v14：sorties 多了戰鬥當下量表與斬殺相關的七個選填原始事實欄位。
// 表組合同 v11–v13；v13 以前的檔案夾帶任一新欄位時拒絕，不含新欄位的舊備份照常匯入。
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type SortieLogRow } from '../utils/db';
import {
    BACKUP_SCHEMA_VERSION,
    BackupValidationError,
    buildFullEnvelope,
    restoreBackup,
    validateBackupEnvelope,
} from '../utils/backup';

const TS = 1_726_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v14-gauge-clear-${dbIndex++}`);
    await database.open();
});

const BASE_SORTIE: SortieLogRow = {
    eventId: 10,
    sortieKey: 1,
    ts: TS,
    map: '6-5',
    node: 13,
    boss: true,
    kind: 'battle',
    rank: 'S',
    seiku: 1,
    enemyIds: [1586],
    enemyIdsEscort: [],
    drop: null,
    taiha: false,
};

const ROWS: SortieLogRow[] = [
    // 舊格式列：所有 v14 新欄位皆缺席
    { ...BASE_SORTIE, eventId: 10 },
    // EO 擊破場 + 0 傷害邊界測試
    {
        ...BASE_SORTIE,
        eventId: 11,
        sortieKey: 2,
        ts: TS + 1000,
        flagshipSunk: false,
        flagshipDamage: 0,
        exmapRate: 250,
        firstClear: 1,
        cleared: true,
        clearedBy: 'battle',
    },
    // HP 量表（含 gaugeNum）+ firstClear: 0
    {
        ...BASE_SORTIE,
        eventId: 12,
        sortieKey: 3,
        ts: TS + 2000,
        map: '61-5',
        flagshipSunk: true,
        flagshipDamage: 1200,
        gaugeAtStart: { type: 2, now: 809, max: 8400, gaugeNum: 4 },
        firstClear: 0,
        cleared: true,
        clearedBy: 'battle',
    },
    // gaugeAtStart 不帶 gaugeNum（type=0, now=0 允許）+ landing 三個數字（含 0）+ mapinfo 後備
    {
        ...BASE_SORTIE,
        eventId: 13,
        sortieKey: 4,
        ts: TS + 3000,
        map: '62-1',
        gaugeAtStart: { type: 0, now: 0, max: 500 },
        landing: { now: 0, max: 500, sub: 0 },
        cleared: true,
        clearedBy: 'mapinfo',
    },
];

const full = (schemaVersion: number, sorties: unknown[] = ROWS) => ({
    schemaVersion,
    kind: 'full',
    exportedAt: TS,
    tables: {
        snapshot: [], sorties, expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: [], questSeen: [], replays: [], goals: [], materialUse: [], sortieBills: [],
    },
});

describe('v14 版本協商與欄位驗證', () => {
    it('目前版本不低於 14，v14 接受含與不含新欄位的 sorties 列並原樣保留', () => {
        expect(BACKUP_SCHEMA_VERSION).toBeGreaterThanOrEqual(14);
        const validated = validateBackupEnvelope(full(14)).tables.sorties!;
        expect(validated).toEqual(ROWS);
        for (const key of ['flagshipSunk', 'flagshipDamage', 'gaugeAtStart', 'exmapRate', 'firstClear', 'landing', 'clearedBy']) {
            expect(key in validated[0]).toBe(false);
        }
        expect('gaugeNum' in validated[3].gaugeAtStart!).toBe(false);
    });

    it('v13 與更舊版本夾帶任一 v14 新欄位一律拒絕；不帶新欄位的舊檔照常匯入', () => {
        const samples: Partial<SortieLogRow>[] = [
            { flagshipSunk: true },
            { flagshipDamage: 0 },
            { gaugeAtStart: { type: 2, now: 100, max: 1000 } },
            { exmapRate: 75 },
            { firstClear: 0 },
            { landing: { now: 100, max: 500, sub: 50 } },
            { clearedBy: 'battle' },
        ];
        for (const extra of samples) {
            expect(() => validateBackupEnvelope(full(13, [{ ...BASE_SORTIE, ...extra }]))).toThrow(BackupValidationError);
        }
        expect(validateBackupEnvelope(full(13, [ROWS[0]])).tables.sorties).toEqual([ROWS[0]]);
    });

    it('v14 嚴格檢查各新欄位的型別與下限', () => {
        const bad = (patch: Record<string, unknown>) => () =>
            validateBackupEnvelope(full(14, [{ ...BASE_SORTIE, ...patch }]));

        expect(bad({ flagshipSunk: 1 })).toThrow(BackupValidationError);
        expect(bad({ flagshipDamage: -1 })).toThrow(BackupValidationError);
        expect(bad({ flagshipDamage: 12.5 })).toThrow(BackupValidationError);
        expect(bad({ gaugeAtStart: { type: -1, now: 0, max: 100 } })).toThrow(BackupValidationError);
        expect(bad({ gaugeAtStart: { type: 2, now: -1, max: 100 } })).toThrow(BackupValidationError);
        expect(bad({ gaugeAtStart: { type: 2, now: 0, max: 0 } })).toThrow(BackupValidationError);
        expect(bad({ gaugeAtStart: { type: 2, now: 0, max: 100, gaugeNum: 0 } })).toThrow(BackupValidationError);
        expect(bad({ exmapRate: 0 })).toThrow(BackupValidationError);
        expect(bad({ exmapRate: '250' })).toThrow(BackupValidationError);
        expect(bad({ firstClear: 2 })).toThrow(BackupValidationError);
        expect(bad({ firstClear: true })).toThrow(BackupValidationError);
        expect(bad({ landing: { now: -1, max: 100, sub: 10 } })).toThrow(BackupValidationError);
        expect(bad({ landing: { now: 10, max: 0, sub: 10 } })).toThrow(BackupValidationError);
        expect(bad({ landing: { now: 10, max: 100, sub: -1 } })).toThrow(BackupValidationError);
        expect(bad({ clearedBy: 'other' })).toThrow(BackupValidationError);
    });
});

describe('v14 匯出與還原往返', () => {
    it('缺席、flagshipDamage: 0、landing 與 gaugeAtStart（有無 gaugeNum）皆原樣往返', async () => {
        await database.sorties.bulkPut(ROWS);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);

        const fresh = new KcDb(`backup-v14-gauge-clear-fresh-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, JSON.parse(JSON.stringify(envelope)));

        const restored = await fresh.sorties.orderBy('eventId').toArray();
        expect(restored).toEqual(ROWS);
        expect('flagshipSunk' in restored[0]).toBe(false);
        expect('gaugeNum' in restored[3].gaugeAtStart!).toBe(false);
        fresh.close();
    });
});
