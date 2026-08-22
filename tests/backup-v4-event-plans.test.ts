// 備份 envelope v4：restore 包新增 eventPlans（活動作戰板）。
//
// 重點在兩件事：(1) 舊檔（v1 legacy-full／v2／v3）不得因為缺少 eventPlans 就被拒；
// (2) 作戰板是使用者手輸的攻略意圖，重裝擴充後必須能原樣回來。
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type EventPlanRow } from '../utils/db';
import { resolveSallyRoster } from '../utils/event-plan';
import {
    BACKUP_SCHEMA_VERSION, BackupValidationError, buildFullEnvelope,
    restoreBackup, validateBackupEnvelope,
} from '../utils/backup';

const TS = 1_700_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v4-${dbIndex++}`);
    await database.open();
});

/** 一份填得夠滿的作戰板：標籤、關卡主列＋階段、具體艦與角色格、鎖定與貼標快照都有。 */
function samplePlan(areaId = 62): EventPlanRow {
    return {
        areaId,
        title: '反撃！第三十一戦隊の戦い',
        updatedTs: TS,
        unlocked: false,
        sallySnapshot: { 101: 1, 102: 1, 201: 2 },
        tags: [
            { sallyArea: 1, name: '第三十一戦隊', nameSource: 'manual' },
            { sallyArea: 2, name: '増強第三十一戦隊', nameSource: 'manual', manualName: '増強31' },
        ],
        stages: [
            {
                key: 'm1', label: '', allowedTags: [1], grantsTag: 1, mapNo: 1,
                slots: [{ shipId: 101 }, { role: '對空驅逐' }],
            },
            {
                key: 'p1', label: 'E1-2', allowedTags: [1, 2], grantsTag: 2, mapNo: 1, phase: true,
                slots: [{ shipId: 201 }],
            },
        ],
    };
}

function restoreTables(plans: EventPlanRow[] = [samplePlan()]) {
    return {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: plans,
    };
}

const v4Restore = (plans?: EventPlanRow[]) => ({
    schemaVersion: 4, kind: 'restore', exportedAt: TS, tables: restoreTables(plans),
});

describe('版本協商', () => {
    // 後續版本新增的表不得反向改變 v4 契約；這裡固定的是
    // 「v4 檔案永遠讀得進來」這條相容承諾，不是目前版號。
    it('v4 仍在支援範圍內', () => expect(BACKUP_SCHEMA_VERSION).toBeGreaterThanOrEqual(4));

    it('v4 restore 必須含 eventPlans', () => {
        const { eventPlans, ...withoutPlans } = restoreTables();
        expect(() => validateBackupEnvelope({
            schemaVersion: 4, kind: 'restore', exportedAt: TS, tables: withoutPlans,
        })).toThrow(BackupValidationError);
    });

    // 舊檔不得因為缺少後來新增的表而被拒。
    it('v3 舊檔仍可匯入，且不得夾帶 eventPlans', () => {
        const v3Tables = {
            snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [], shipObtained: [],
        };
        expect(validateBackupEnvelope({
            schemaVersion: 3, kind: 'restore', exportedAt: TS, tables: v3Tables,
        }).kind).toBe('restore');
        expect(() => validateBackupEnvelope({
            schemaVersion: 3, kind: 'restore', exportedAt: TS,
            tables: { ...v3Tables, eventPlans: [samplePlan()] },
        })).toThrow(BackupValidationError);
    });
});

describe('欄位驗證', () => {
    const bad = (mutate: (plan: any) => void) => {
        const plan: any = samplePlan();
        mutate(plan);
        return () => validateBackupEnvelope(v4Restore([plan]));
    };

    it('接受完整的一筆', () => {
        const parsed = validateBackupEnvelope(v4Restore());
        expect(parsed.tables.eventPlans).toEqual([samplePlan()]);
    });

    it.each([
        ['areaId 非整數', (p: any) => { p.areaId = 'E62'; }],
        ['tags 非陣列', (p: any) => { p.tags = {}; }],
        ['nameSource 不是 auto/manual', (p: any) => { p.tags[0].nameSource = 'guessed'; }],
        ['stages.key 空字串', (p: any) => { p.stages[0].key = ''; }],
        ['allowedTags 含非整數', (p: any) => { p.stages[0].allowedTags = [1, 'x']; }],
        ['slots 非物件', (p: any) => { p.stages[0].slots = ['大鷹']; }],
        ['unlocked 非布林', (p: any) => { p.unlocked = 'yes'; }],
        ['sallySnapshot 鍵非艦實例 id', (p: any) => { p.sallySnapshot = { abc: 1 }; }],
    ])('拒絕 %s', (_label, mutate) => expect(bad(mutate)).toThrow(BackupValidationError));

    it('主鍵重複會被拒', () => {
        expect(() => validateBackupEnvelope(v4Restore([samplePlan(62), samplePlan(62)])))
            .toThrow(BackupValidationError);
    });

    it('可選欄位可省略', () => {
        const minimal: EventPlanRow = { areaId: 63, title: '', tags: [], stages: [], updatedTs: TS };
        expect(validateBackupEnvelope(v4Restore([minimal])).tables.eventPlans).toEqual([minimal]);
    });
});

describe('匯出與還原往返', () => {
    it('可接受 optional color／planByShip；舊檔缺欄仍有效', () => {
        const withNew: EventPlanRow = {
            ...samplePlan(),
            tags: [
                { sallyArea: 1, name: '第三十一戦隊', nameSource: 'manual', color: 4 },
                { sallyArea: 2, name: '増強第三十一戦隊', nameSource: 'manual', color: 7 },
            ],
            planByShip: { 101: 1, 201: 2 },
        };
        expect(validateBackupEnvelope(v4Restore([withNew])).tables.eventPlans).toEqual([withNew]);
        const minimal: EventPlanRow = { areaId: 63, title: '', tags: [], stages: [], updatedTs: TS };
        expect(validateBackupEnvelope(v4Restore([minimal])).tables.eventPlans).toEqual([minimal]);
    });

    it('color 超出 1–13 或 planByShip 值為 0 必須拒絕', () => {
        expect(() => validateBackupEnvelope(v4Restore([{
            ...samplePlan(),
            tags: [{ sallyArea: 1, name: 'x', nameSource: 'manual', color: 14 }],
        }]))).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope(v4Restore([{
            ...samplePlan(),
            planByShip: { 101: 0 } as any,
        }]))).toThrow(BackupValidationError);
    });

    it('匯出的 envelope 帶 eventPlans 且為目前版本', async () => {
        await database.eventPlans.bulkPut([samplePlan(62), samplePlan(63)]);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(envelope.tables.eventPlans?.map(p => p.areaId).sort()).toEqual([62, 63]);
    });

    it('還原到全新環境後作戰板原樣回來', async () => {
        await restoreBackup(database, v4Restore());
        const rows = await database.eventPlans.toArray();
        expect(rows).toEqual([samplePlan()]);
        // 階段子列、角色格、貼標快照都不能在往返中掉欄位
        expect(rows[0].stages[1]).toMatchObject({ phase: true, mapNo: 1, allowedTags: [1, 2] });
        expect(rows[0].stages[0].slots[1]).toEqual({ role: '對空驅逐' });
        expect(rows[0].sallySnapshot).toEqual({ 101: 1, 102: 1, 201: 2 });
        // 活動海域已不在 master 時，備份還原的快照仍可作為歷史標籤總帳來源。
        const historical = resolveSallyRoster([
            { id: 101, name: '大鷹', sallyArea: 0 },
            { id: 102, name: '五十鈴', sallyArea: 0 },
            { id: 201, name: '比叡', sallyArea: 0 },
        ], rows[0].sallySnapshot, false);
        expect(historical.source).toBe('snapshot');
        expect(historical.ships.map(ship => [ship.id, ship.sallyArea]))
            .toEqual([[101, 1], [102, 1], [201, 2]]);
    });

    it('自製匯出可直接還原（真正的往返）', async () => {
        await database.eventPlans.put(samplePlan());
        const envelope = await buildFullEnvelope(database);

        const fresh = new KcDb(`backup-v4-roundtrip-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, JSON.parse(JSON.stringify(envelope)));
        expect(await fresh.eventPlans.toArray()).toEqual([samplePlan()]);
    });

    it('目標已有作戰板資料時拒絕匯入，且不改動既有資料', async () => {
        await database.eventPlans.put(samplePlan(62));
        await expect(restoreBackup(database, v4Restore([samplePlan(63)]))).rejects.toThrow();
        expect((await database.eventPlans.toArray()).map(p => p.areaId)).toEqual([62]);
    });
});
