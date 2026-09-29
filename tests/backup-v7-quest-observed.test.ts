// 備份 envelope v7：full 包新增 questObserved（本機觀測到的任務領獎）。
// raw events 不進備份、也會被裁剪，不帶這張表還原後就無法證明本期日任／週任已領獎。
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type QuestObservedRow } from '../utils/db';
import {
    BACKUP_SCHEMA_VERSION, BackupValidationError, buildFullEnvelope,
    highestReferencedEventId, restoreBackup, validateBackupEnvelope,
} from '../utils/backup';
import { GameState } from '../utils/state';
import { applyArchivedQuestObservations } from '../utils/quest-observed';
import { buildQuestFlow } from '../utils/quest-flow';

const TS = 1_700_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v7-qo-${dbIndex++}`);
    await database.open();
});

const OBSERVED: QuestObservedRow[] = [
    { eventId: 88, questNo: 201, ts: TS },
    { eventId: 90, questNo: 946, ts: TS + 1_000 },
];

function emptyTables(extra: Record<string, unknown[]> = {}) {
    return {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: OBSERVED, replays: [],
        ...extra,
    };
}

const v7Full = (extra?: Record<string, unknown[]>) => ({
    schemaVersion: 7, kind: 'full', exportedAt: TS, tables: emptyTables(extra),
});

describe('版本協商', () => {
    it('目前版本為 8', () => expect(BACKUP_SCHEMA_VERSION).toBe(8));

    it('v7 full 必須含 questObserved', () => {
        const tables = emptyTables();
        delete (tables as Record<string, unknown>).questObserved;
        expect(() => validateBackupEnvelope({
            schemaVersion: 7, kind: 'full', exportedAt: TS, tables,
        })).toThrow(BackupValidationError);
    });

    it('v6 舊檔仍可匯入，且不得夾帶 questObserved', () => {
        const { questObserved: _ignored, ...v6 } = emptyTables({ questObserved: [] });
        expect(validateBackupEnvelope({
            schemaVersion: 6, kind: 'full', exportedAt: TS, tables: v6,
        }).tables.questObserved).toBeUndefined();

        expect(() => validateBackupEnvelope({
            schemaVersion: 6, kind: 'full', exportedAt: TS, tables: emptyTables(),
        })).toThrow(BackupValidationError);
    });
});

describe('欄位驗證與 event ID', () => {
    it('重複 eventId、非正整數 questNo 拒絕', () => {
        expect(() => validateBackupEnvelope(v7Full({
            questObserved: [OBSERVED[0], OBSERVED[0]],
        }))).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope(v7Full({
            questObserved: [{ eventId: 1, questNo: 0, ts: TS }],
        }))).toThrow(BackupValidationError);
    });

    it('questObserved.eventId 納入 high-water', () => {
        expect(highestReferencedEventId({ questObserved: OBSERVED })).toBe(90);
    });
});

describe('匯出與還原往返', () => {
    it('匯出帶 questObserved，還原後可重建本期日任觀測', async () => {
        await database.questObserved.bulkPut(OBSERVED);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(envelope.tables.questObserved).toEqual(OBSERVED);

        const fresh = new KcDb(`backup-v7-qo-fresh-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, envelope);
        expect(await fresh.questObserved.toArray()).toEqual(OBSERVED);

        const state = new GameState();
        applyArchivedQuestObservations(state, await fresh.questObserved.toArray(), new Set());
        const model = buildQuestFlow(state, new Set(), TS + 60_000);
        expect(model.byNo.get(201)?.observedCurrentPeriod).toBe(true);
        expect(model.byNo.get(946)?.status).toBe('observed-complete');
        expect(model.byNo.get(946)?.observedCurrentPeriod).toBe(false);
        fresh.close();
    });

    it('目標表已有領獎列時整批拒絕', async () => {
        await database.questObserved.put(OBSERVED[0]);
        await expect(restoreBackup(database, v7Full())).rejects.toThrow();
        expect(await database.questObserved.count()).toBe(1);
    });
});
