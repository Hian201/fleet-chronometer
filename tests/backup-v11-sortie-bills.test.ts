// 備份 envelope v11：full 包新增 sortieBills（出擊帳單），materialUse 多了 airSupply 與 bucket.shipId。
// 帳單要靠出擊開始當下的 GameState 才算得出，raw events 裁剪後無從重建，所以必須進備份。
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { KcDb, type MaterialUseRow, type SortieBillRow } from '../utils/db';
import {
    BACKUP_SCHEMA_VERSION, BackupValidationError, buildFullEnvelope, highestReferencedEventId, restoreBackup,
    validateBackupEnvelope,
} from '../utils/backup';

const TS = 1_700_000_000_000;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`backup-v11-sortie-bills-${dbIndex++}`);
    await database.open();
});

const BILLS: SortieBillRow[] = [
    {
        sortieKey: 40, ts: TS, map: '1-1',
        ships: [
            { id: 7, masterId: 119, fuel: 12, ammo: 20, bauxite: 0, repairFuel: 30, repairSteel: 15 },
            { id: 9, masterId: 553, fuel: 8, ammo: 10, bauxite: 25, repairFuel: 0, repairSteel: 0, estimated: true },
        ],
        payable: [20, 30, 15, 25], balanceDelta: [-5, 10, 0, 0], specialDelta: [0, -1, 2, 0],
        planesLost: 5, estimated: true, damagedShipIds: [7], lostShipIds: [],
    },
    {
        // 活動海域：有難度；餘額與特殊資材無法確定（null），也沒有任何耗損。
        sortieKey: 88, ts: TS + 1, map: '60-2', difficulty: 3,
        ships: [], payable: [0, 0, 0, 0], balanceDelta: null, specialDelta: null,
        planesLost: 0, estimated: false, damagedShipIds: [], lostShipIds: [9],
        support: [{ deckId: 3, payable: [120, 96, 0, 40], planesLost: 8, estimated: true }],
    },
];

const USE_ROWS: MaterialUseRow[] = [
    { eventId: 11, ts: TS, kind: 'bucket', via: 'start' },
    { eventId: 12, ts: TS + 1, kind: 'bucket', via: 'speedchange', shipId: 7 },
    { eventId: 95, ts: TS + 2, kind: 'remodel', shipId: 7, fromMst: 119 },
    { eventId: 96, ts: TS + 3, kind: 'airSupply', areaId: 6, fuel: 30, bauxite: 120 },
    { eventId: 97, ts: TS + 4, kind: 'airSupply', areaId: 6, fuel: null, bauxite: null },
];

function v10Tables() {
    return {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: [], questSeen: [], goals: [], materialUse: [], replays: [],
    };
}
const v11Full = (sortieBills: unknown[] = BILLS, materialUse: unknown[] = USE_ROWS) => ({
    schemaVersion: 11, kind: 'full', exportedAt: TS, tables: { ...v10Tables(), materialUse, sortieBills },
});
const rejects = (envelope: unknown) => expect(() => validateBackupEnvelope(envelope)).toThrow(BackupValidationError);

describe('版本協商', () => {
    it('v11 full 必須含 sortieBills', () => {
        rejects({ schemaVersion: 11, kind: 'full', exportedAt: TS, tables: v10Tables() });
    });

    it('v10 舊檔仍可匯入，表保持空白；夾帶 sortieBills 則拒絕', () => {
        const old = validateBackupEnvelope({ schemaVersion: 10, kind: 'full', exportedAt: TS, tables: v10Tables() });
        expect(old.tables.sortieBills).toBeUndefined();
        rejects({
            schemaVersion: 10, kind: 'full', exportedAt: TS, tables: { ...v10Tables(), sortieBills: [] },
        });
    });

    it('v10 舊檔還原後 sortieBills 為空', async () => {
        await restoreBackup(database, { schemaVersion: 10, kind: 'full', exportedAt: TS, tables: v10Tables() });
        expect(await database.sortieBills.count()).toBe(0);
    });

    it('合法的 v11 檔案通過驗證並保留 sortieBills', () => {
        expect(validateBackupEnvelope(v11Full()).tables.sortieBills).toEqual(BILLS);
    });
});

describe('sortieBills 欄位驗證', () => {
    const withBill = (patch: Record<string, unknown>) => v11Full([{ ...BILLS[0], ...patch }]);
    const withShip = (patch: Record<string, unknown>) =>
        v11Full([{ ...BILLS[0], ships: [{ ...BILLS[0].ships[0], ...patch }] }]);

    it('sortieKey 必須是正整數，且不得重複', () => {
        for (const sortieKey of [0, -1, 1.5, '40', null, undefined]) rejects(withBill({ sortieKey }));
        rejects(v11Full([BILLS[0], BILLS[0]]));
        rejects(v11Full([BILLS[0], { ...BILLS[1], sortieKey: BILLS[0].sortieKey }]));
    });

    it('payable 必須是 4 項非負數值', () => {
        rejects(withBill({ payable: [1, 2, 3] }));
        rejects(withBill({ payable: [1, 2, 3, 4, 5] }));
        rejects(withBill({ payable: [1, 2, 3, -1] }));
        rejects(withBill({ payable: [1, 2, 3, '4'] }));
        rejects(withBill({ payable: [1, 2, 3, Number.NaN] }));
        rejects(withBill({ payable: null }));
        rejects(withBill({ payable: undefined }));
    });

    it('balanceDelta／specialDelta 為 null 或 4 項數值（可為負數），其餘拒絕', () => {
        for (const field of ['balanceDelta', 'specialDelta']) {
            expect(validateBackupEnvelope(withBill({ [field]: null })).tables.sortieBills?.[0])
                .toMatchObject({ [field]: null });
            expect(validateBackupEnvelope(withBill({ [field]: [-300, 0, -1, 7] })).tables.sortieBills?.[0])
                .toMatchObject({ [field]: [-300, 0, -1, 7] });
            rejects(withBill({ [field]: [1, 2, 3] }));
            rejects(withBill({ [field]: [1, 2, 3, 4, 5] }));
            rejects(withBill({ [field]: [1, 2, 3, 'x'] }));
            rejects(withBill({ [field]: undefined }));
            rejects(withBill({ [field]: {} }));
        }
    });

    it('ships[].estimated 只能是 true 或省略', () => {
        rejects(withShip({ estimated: false }));
        rejects(withShip({ estimated: 'true' }));
        rejects(withShip({ estimated: 1 }));
        const kept = validateBackupEnvelope(withShip({ estimated: true })).tables.sortieBills?.[0].ships[0];
        expect(kept?.estimated).toBe(true);
        const omitted = validateBackupEnvelope(withShip({})).tables.sortieBills?.[0].ships[0];
        expect(omitted && 'estimated' in omitted).toBe(false);
    });

    it('ships 內的 id／masterId 必須是正整數，數量欄位不得為負', () => {
        rejects(withShip({ id: 0 }));
        rejects(withShip({ masterId: 0 }));
        rejects(withShip({ fuel: -1 }));
        rejects(withShip({ repairSteel: Number.POSITIVE_INFINITY }));
        rejects(withBill({ ships: 'none' }));
    });

    it('difficulty 選填，有值時必須是正整數', () => {
        expect(validateBackupEnvelope(withBill({ difficulty: undefined })).tables.sortieBills?.[0])
            .not.toHaveProperty('difficulty');
        expect(validateBackupEnvelope(withBill({ difficulty: 2 })).tables.sortieBills?.[0].difficulty).toBe(2);
        rejects(withBill({ difficulty: 0 }));
        rejects(withBill({ difficulty: 1.5 }));
        rejects(withBill({ difficulty: null }));
    });

    it('其他欄位型別錯誤一律拒絕', () => {
        rejects(withBill({ map: '' }));
        rejects(withBill({ ts: 'yesterday' }));
        rejects(withBill({ planesLost: -1 }));
        rejects(withBill({ estimated: 'yes' }));
        rejects(withBill({ damagedShipIds: [0] }));
        rejects(withBill({ lostShipIds: [1.5] }));
        rejects(withBill({ lostShipIds: undefined }));
        rejects(withBill({ support: [{ deckId: 0, payable: [0, 0, 0, 0], planesLost: 0, estimated: false }] }));
        rejects(withBill({ support: [{ deckId: 3, payable: [1, 2, 3], planesLost: 0, estimated: false }] }));
        rejects(withBill({ support: [{ deckId: 3, payable: [0, 0, 0, 0], planesLost: 0 }] }));
    });

    it('多餘欄位不帶進資料庫', () => {
        const [kept] = validateBackupEnvelope(withBill({ extra: 'x' })).tables.sortieBills ?? [];
        expect(kept).toEqual(BILLS[0]);
    });
});

describe('materialUse 新增 airSupply 與 bucket.shipId', () => {
    const use = (row: unknown) => v11Full(BILLS, [row]);

    it('airSupply 的 fuel／bauxite 可為 null，areaId 必須是正整數', () => {
        const base = { eventId: 5, ts: TS, kind: 'airSupply', areaId: 6, fuel: 10, bauxite: 20 };
        expect(validateBackupEnvelope(use(base)).tables.materialUse).toEqual([base]);
        const nulls = { ...base, fuel: null, bauxite: null };
        expect(validateBackupEnvelope(use(nulls)).tables.materialUse).toEqual([nulls]);
        for (const areaId of [0, -1, 1.5, '6', null, undefined]) rejects(use({ ...base, areaId }));
        for (const field of ['fuel', 'bauxite']) {
            rejects(use({ ...base, [field]: undefined }));
            rejects(use({ ...base, [field]: -1 }));
            rejects(use({ ...base, [field]: 1.5 }));
            rejects(use({ ...base, [field]: '3' }));
        }
    });

    it('bucket.shipId 選填，有值時必須是正整數', () => {
        const base = { eventId: 5, ts: TS, kind: 'bucket', via: 'speedchange' };
        expect(validateBackupEnvelope(use(base)).tables.materialUse).toEqual([base]);
        expect(validateBackupEnvelope(use({ ...base, shipId: 7 })).tables.materialUse).toEqual([{ ...base, shipId: 7 }]);
        for (const shipId of [0, -3, 1.5, '7', null]) rejects(use({ ...base, shipId }));
    });

    it('未知 kind 仍拒絕', () => {
        rejects(use({ eventId: 5, ts: TS, kind: 'supply' }));
    });
});

describe('匯出與還原往返', () => {
    it('匯出帶 sortieBills 與新版 materialUse，還原到乾淨環境後逐筆相同', async () => {
        await database.sortieBills.bulkPut(BILLS);
        await database.materialUse.bulkPut(USE_ROWS);
        const envelope = await buildFullEnvelope(database);
        expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(envelope.tables.sortieBills).toEqual(BILLS);
        expect(envelope.tables.materialUse).toEqual(USE_ROWS);

        const wire = JSON.parse(JSON.stringify(envelope));
        const validated = validateBackupEnvelope(wire);
        expect(validated.tables.sortieBills).toEqual(BILLS);
        expect(validated.tables.materialUse).toEqual(USE_ROWS);

        const fresh = new KcDb(`backup-v11-sortie-bills-fresh-${dbIndex++}`);
        await fresh.open();
        await restoreBackup(fresh, wire);
        expect(await fresh.sortieBills.orderBy('sortieKey').toArray()).toEqual(BILLS);
        expect(await fresh.materialUse.orderBy('eventId').toArray()).toEqual(USE_ROWS);
        fresh.close();
    });

    it('還原環境已有 sortieBills 時拒絕（還原不是 merge）', async () => {
        await database.sortieBills.put(BILLS[0]);
        await expect(restoreBackup(database, v11Full())).rejects.toThrow();
        expect(await database.sortieBills.count()).toBe(1);
    });

    it('sortieBills.sortieKey 納入 high-water', () => {
        expect(highestReferencedEventId({ sortieBills: BILLS })).toBe(88);
        expect(highestReferencedEventId({ sortieBills: BILLS, materialUse: USE_ROWS })).toBe(97);
        expect(highestReferencedEventId({ sortieBills: [{ ...BILLS[0], sortieKey: 500 }], materialUse: USE_ROWS }))
            .toBe(500);
    });
});

describe('v16 → v17 升級', () => {
    it('純新增 sortieBills 表，既有資料不受影響', async () => {
        const name = `backup-v11-upgrade-${dbIndex++}`;
        const v16 = new Dexie(name);
        v16.version(16).stores({
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
            materialUse: 'eventId, ts, kind',
            meta: 'key',
        });
        await v16.open();
        await v16.table('materialUse').put({ eventId: 11, ts: TS, kind: 'bucket', via: 'start' });
        await v16.table('goals').put({ key: 'remodel:7', kind: 'remodel', order: 0, shipId: 7, targetMst: 553 });
        await v16.table('resources').put({ eventId: 3, ts: TS, m: [1, 2, 3, 4, 5, 6, 7, 8] });
        v16.close();

        const current = new KcDb(name);
        await current.open();
        expect(current.verno).toBe(17);
        expect(await current.sortieBills.count()).toBe(0);
        expect(await current.materialUse.toArray()).toEqual([{ eventId: 11, ts: TS, kind: 'bucket', via: 'start' }]);
        expect(await current.goals.count()).toBe(1);
        expect(await current.resources.count()).toBe(1);
        // 新表可正常寫入與依索引查詢
        await current.sortieBills.put(BILLS[0]);
        expect(await current.sortieBills.where('map').equals('1-1').count()).toBe(1);
        current.close();
    });
});
