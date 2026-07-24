// 備份 envelope v5：restore 包新增 resources／resourceMarks（資源紀錄）。
//
// 為什麼非帶不可：資源餘額的歷史**不可能重新產生**——它只存在於當初收到的那些封包裡，
// 而 db.events 早就被 M6 裁剪掉了。不進備份等於每次重裝就歸零，而這份序列的全部價值
// 就在長期連續。同理，'gauge-seen' 守衛也要一起帶，否則還原後「已經看過它未歸零」的
// 前提會消失，接下來的量表歸零就會被當成「裝擴充前就通關」而漏記。
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type ResourceMarkRow, type ResourceRow } from '../utils/db';
import {
    BACKUP_SCHEMA_VERSION, BackupValidationError, buildRestoreEnvelope,
    highestReferencedEventId, restoreBackup, validateBackupEnvelope,
} from '../utils/backup';

const TS = 1_700_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v5-${dbIndex++}`);
    await database.open();
});

const RESOURCES: ResourceRow[] = [
    { eventId: 101, ts: TS, m: [300_000, 300_000, 300_000, 300_000, 120, 340, 900, 480] },
    { eventId: 205, ts: TS + 3_600_000, m: [180_000, 170_000, 290_000, 250_000, 118, 300, 900, 480] },
];

const MARKS: ResourceMarkRow[] = [
    { key: 'open:621', kind: 'stage-open', mapKey: 621, ts: TS, eventId: 100 },
    { key: 'clear:621#0', kind: 'gauge-clear', mapKey: 621, ts: TS + 1_000, eventId: 150, seq: 0, gaugeNum: 4 },
    { key: 'seen:622', kind: 'gauge-seen', mapKey: 622, ts: TS + 2_000, eventId: 160 },
];

function restoreTables(extra: Partial<Record<string, unknown[]>> = {}) {
    return {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: RESOURCES, resourceMarks: MARKS,
        ...extra,
    };
}

const v5Restore = (extra?: Partial<Record<string, unknown[]>>) => ({
    schemaVersion: 5, kind: 'restore', exportedAt: TS, tables: restoreTables(extra),
});

describe('版本協商', () => {
    it('目前版本為 5', () => expect(BACKUP_SCHEMA_VERSION).toBe(5));

    it('v5 restore 必須含 resources 與 resourceMarks', () => {
        for (const missing of ['resources', 'resourceMarks']) {
            const tables = restoreTables();
            delete (tables as Record<string, unknown>)[missing];
            expect(() => validateBackupEnvelope({
                schemaVersion: 5, kind: 'restore', exportedAt: TS, tables,
            })).toThrow(BackupValidationError);
        }
    });

    // 舊檔不得因為缺少後來新增的表被拒，也不得夾帶它。
    it('v4 舊檔仍可匯入，且不得夾帶資源紀錄', () => {
        const { resources, resourceMarks, ...v4 } = restoreTables();
        expect(validateBackupEnvelope({
            schemaVersion: 4, kind: 'restore', exportedAt: TS, tables: v4,
        }).tables.resources).toBeUndefined();

        expect(() => validateBackupEnvelope({
            schemaVersion: 4, kind: 'restore', exportedAt: TS, tables: restoreTables(),
        })).toThrow(BackupValidationError);
    });
});

describe('欄位驗證', () => {
    const bad = (extra: Partial<Record<string, unknown[]>>) =>
        () => validateBackupEnvelope(v5Restore(extra));

    it('餘額必須剛好八項——缺一項就無從計算消長', () => {
        expect(bad({ resources: [{ eventId: 1, ts: TS, m: [1, 2, 3, 4] }] })).toThrow(BackupValidationError);
        expect(bad({ resources: [{ eventId: 1, ts: TS, m: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] })).toThrow(BackupValidationError);
    });

    it('負餘額不是遊戲會送出的狀態，放行只會畫出不存在的谷底', () => {
        expect(bad({ resources: [{ eventId: 1, ts: TS, m: [-1, 2, 3, 4, 5, 6, 7, 8] }] })).toThrow(BackupValidationError);
    });

    it('未知的標記種類一律拒絕', () => {
        expect(bad({ resourceMarks: [{ ...MARKS[0], kind: 'whatever' }] })).toThrow(BackupValidationError);
    });

    it('重複主鍵拒絕（resources 依 eventId、resourceMarks 依 key）', () => {
        expect(bad({ resources: [RESOURCES[0], RESOURCES[0]] })).toThrow(BackupValidationError);
        expect(bad({ resourceMarks: [MARKS[0], MARKS[0]] })).toThrow(BackupValidationError);
    });

    it('可選欄位（seq／gaugeNum）可省略', () => {
        const minimal: ResourceMarkRow = { key: 'open:631', kind: 'stage-open', mapKey: 631, ts: TS, eventId: 9 };
        expect(validateBackupEnvelope(v5Restore({ resourceMarks: [minimal] })).tables.resourceMarks)
            .toEqual([minimal]);
    });
});

describe('event ID 延續', () => {
    // 匯入後本機新擷取的 raw event ID 必須高於備份裡的一切引用，否則新事件會撞到
    // 既有 derived rows 的主鍵。資源列的主鍵就是來源 event ID，故必須納入計算。
    it('resources／resourceMarks 的 eventId 納入 high-water', () => {
        expect(highestReferencedEventId({ resources: RESOURCES })).toBe(205);
        expect(highestReferencedEventId({ resourceMarks: MARKS })).toBe(160);
    });
});

describe('匯出與還原往返', () => {
    it('匯出的 envelope 帶資源紀錄兩張表', async () => {
        await database.resources.bulkPut(RESOURCES);
        await database.resourceMarks.bulkPut(MARKS);
        const envelope = await buildRestoreEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(envelope.tables.resources?.map(r => r.eventId)).toEqual([101, 205]);
        expect(envelope.tables.resourceMarks?.map(r => r.key).sort())
            .toEqual(['clear:621#0', 'open:621', 'seen:622']);
    });

    it('還原到全新環境後原樣回來（含 gauge-seen 守衛）', async () => {
        await restoreBackup(database, v5Restore());
        expect(await database.resources.orderBy('ts').toArray()).toEqual(RESOURCES);
        const marks = await database.resourceMarks.toArray();
        expect(marks.sort((a, b) => a.ts - b.ts)).toEqual(MARKS);
    });

    it('還原後下一筆本機 event ID 高於備份的所有引用', async () => {
        await restoreBackup(database, v5Restore());
        const id = await database.events.add({ ts: TS, path: 'api_port/port', api: null, req: {} });
        expect(id).toBeGreaterThan(205);
    });

    it('目標表已有資料時整批拒絕，且不改動既有資料', async () => {
        await database.resources.put(RESOURCES[0]);
        await expect(restoreBackup(database, v5Restore())).rejects.toThrow();
        expect(await database.resources.count()).toBe(1);
        expect(await database.resourceMarks.count()).toBe(0);
    });
});
