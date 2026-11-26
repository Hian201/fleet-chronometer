// 備份 envelope v15：full 包新增 senkaRankings（排行榜本人戰果與榜線紀錄）、
// senkaMonths（逐月對帳玩家自填最終結果）與選填 senkaTarget（戰果目標設定三態）。
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    BACKUP_SCHEMA_VERSION, BackupValidationError, buildFullEnvelope, combineBackupEnvelopes,
    highestReferencedEventId, isEmptyBackup, restoreBackup, validateBackupEnvelope,
} from '../utils/backup';
import { KcDb } from '../utils/db';
import { loadSenkaTarget, saveSenkaTarget } from '../utils/senka-prefs';
import {
    RANKING_API_PATH, senkaCutoffKey, senkaSelfKey, type SenkaMonthRow, type SenkaRankingRow,
} from '../utils/senka-store';

// 2026-11-30 15:00 JST = 2026-11-30 06:00 UTC
const PUB_NOV_30_15 = Date.UTC(2026, 10, 30, 6, 0);
// 2026-11-29 03:00 JST = 2026-11-28 18:00 UTC
const PUB_NOV_29_03 = Date.UTC(2026, 10, 28, 18, 0);
const TS = PUB_NOV_30_15 + 10 * 60_000;

function installStorage() {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => map.get(k) ?? null,
            setItem: (k: string, v: string) => { map.set(k, String(v)); },
            removeItem: (k: string) => { map.delete(k); },
            clear: () => { map.clear(); },
        },
        configurable: true,
    });
}

const RANKINGS: SenkaRankingRow[] = [
    {
        key: senkaSelfKey(PUB_NOV_30_15),
        kind: 'self',
        publishedAt: PUB_NOV_30_15,
        score: 4180,
        rank: 512,
        ts: TS,
        eventId: 201,
    },
    {
        key: senkaCutoffKey(PUB_NOV_30_15, 500),
        kind: 'cutoff',
        publishedAt: PUB_NOV_30_15,
        rank: 500,
        score: 4200,
        mode: 'auto',
        ts: TS,
        eventId: 202,
    },
    {
        key: senkaCutoffKey(PUB_NOV_29_03, 500),
        kind: 'cutoff',
        publishedAt: PUB_NOV_29_03,
        rank: 500,
        score: 4010,
        mode: 'manual',
        ts: PUB_NOV_29_03 + 30 * 60_000,
    },
];

const MONTHS: SenkaMonthRow[] = [
    { month: '2026-10', finalTier: 'top500', updatedAt: PUB_NOV_30_15 },
    { month: '2026-09', finalTier: 'out', updatedAt: PUB_NOV_29_03 },
];

function v14Tables() {
    return {
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: [], questSeen: [], goals: [], materialUse: [], sortieBills: [], replays: [],
    };
}

const v15Full = (
    senkaRankings: unknown[] = RANKINGS,
    senkaMonths: unknown[] = MONTHS,
    extra: Record<string, unknown> = {},
) => ({
    schemaVersion: 15,
    kind: 'full',
    exportedAt: TS,
    tables: { ...v14Tables(), senkaRankings, senkaMonths },
    ...extra,
});

const rejects = (envelope: unknown) => expect(() => validateBackupEnvelope(envelope)).toThrow(BackupValidationError);

const databases: KcDb[] = [];
let dbIndex = 0;

function createDb(): KcDb {
    const database = new KcDb(`backup-v15-senka-${Date.now()}-${dbIndex++}`);
    databases.push(database);
    return database;
}

beforeEach(() => {
    installStorage();
});

afterEach(async () => {
    try { delete (globalThis as { localStorage?: unknown }).localStorage; } catch { /* ignore */ }
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('v15 版本協商', () => {
    it('目前備份版本為 15', () => expect(BACKUP_SCHEMA_VERSION).toBe(15));

    it('v15 full 必須同時包含 senkaRankings 與 senkaMonths', () => {
        rejects({ schemaVersion: 15, kind: 'full', exportedAt: TS, tables: v14Tables() });
        rejects({
            schemaVersion: 15, kind: 'full', exportedAt: TS,
            tables: { ...v14Tables(), senkaRankings: [] },
        });
        rejects({
            schemaVersion: 15, kind: 'full', exportedAt: TS,
            tables: { ...v14Tables(), senkaMonths: [] },
        });
    });

    it('v14 舊檔照常匯入並維持兩新表空白，且不得夾帶新表或 senkaTarget', async () => {
        const v14 = { schemaVersion: 14, kind: 'full', exportedAt: TS, tables: v14Tables() };
        const validated = validateBackupEnvelope(v14);
        expect(validated.tables.senkaRankings).toBeUndefined();
        expect(validated.tables.senkaMonths).toBeUndefined();
        expect(validated.senkaTarget).toBeUndefined();

        rejects({ ...v14, tables: { ...v14Tables(), senkaRankings: [] } });
        rejects({ ...v14, tables: { ...v14Tables(), senkaMonths: [] } });
        rejects({ ...v14, senkaTarget: null });
        rejects({ ...v14, senkaTarget: { type: 'rank', rank: 500 } });

        saveSenkaTarget({ type: 'rank', rank: 100 });
        const db = createDb();
        await db.open();
        await restoreBackup(db, v14);
        expect(await db.senkaRankings.count()).toBe(0);
        expect(await db.senkaMonths.count()).toBe(0);
        // 舊檔 senkaTarget === undefined，不得改動本機既有目標
        expect(loadSenkaTarget()).toEqual({ type: 'rank', rank: 100 });
    });
});

describe('v15 欄位白名單驗證', () => {
    it('senkaRankings 嚴格檢查 publishedAt 對齊、主鍵一致、mode／eventId 對應與重複主鍵', () => {
        expect(validateBackupEnvelope(v15Full()).tables.senkaRankings).toEqual(RANKINGS);

        // 未對齊每日 03:00／15:00 JST
        rejects(v15Full([{ ...RANKINGS[0], publishedAt: PUB_NOV_30_15 + 60_000, key: senkaSelfKey(PUB_NOV_30_15 + 60_000) }]));
        // 主鍵與內容不一致
        rejects(v15Full([{ ...RANKINGS[0], key: senkaSelfKey(PUB_NOV_29_03) }]));
        rejects(v15Full([{ ...RANKINGS[1], key: senkaCutoffKey(PUB_NOV_30_15, 100) }]));
        // 重複主鍵
        rejects(v15Full([RANKINGS[0], RANKINGS[0]]));
        // 未知 kind／mode
        rejects(v15Full([{ ...RANKINGS[0], kind: 'other' }]));
        rejects(v15Full([{ ...RANKINGS[1], mode: 'imported' }]));
        // self 與 auto 必帶正整數 eventId
        rejects(v15Full([{ ...RANKINGS[0], eventId: undefined }]));
        rejects(v15Full([{ ...RANKINGS[0], eventId: 0 }]));
        rejects(v15Full([{ ...RANKINGS[1], eventId: undefined }]));
        // manual 不得帶 eventId
        rejects(v15Full([{ ...RANKINGS[2], eventId: 99 }]));
        // rank >= 1、score >= 0
        rejects(v15Full([{ ...RANKINGS[0], rank: 0 }]));
        rejects(v15Full([{ ...RANKINGS[0], score: -1 }]));
        rejects(v15Full([{ ...RANKINGS[1], rank: 0, key: senkaCutoffKey(PUB_NOV_30_15, 0) }]));
        rejects(v15Full([{ ...RANKINGS[1], score: 12.5 }]));

        // 多餘欄位不帶進資料庫
        const [cleaned] = validateBackupEnvelope(v15Full([{ ...RANKINGS[0], extra: 'drop-me', nickname: 'secret' }]))
            .tables.senkaRankings!;
        expect(cleaned).toEqual(RANKINGS[0]);
    });

    it('senkaMonths 嚴格檢查 YYYY-MM、合法 finalTier、時間戳與重複主鍵', () => {
        expect(validateBackupEnvelope(v15Full()).tables.senkaMonths).toEqual(MONTHS);

        for (const badMonth of ['2026-0', '2026-00', '2026-13', '26-11', '2026-11-01', 202611]) {
            rejects(v15Full([], [{ ...MONTHS[0], month: badMonth }]));
        }
        for (const badTier of ['none', 'top1', '500', null, undefined]) {
            rejects(v15Full([], [{ ...MONTHS[0], finalTier: badTier }]));
        }
        rejects(v15Full([], [MONTHS[0], MONTHS[0]]));
        rejects(v15Full([], [{ ...MONTHS[0], updatedAt: 'bad-date' }]));

        const [cleaned] = validateBackupEnvelope(v15Full([], [{ ...MONTHS[0], extra: 1 }])).tables.senkaMonths!;
        expect(cleaned).toEqual(MONTHS[0]);
    });

    it('senkaTarget 接受 undefined／null／四群 rank／非負安全整數 custom，其餘拒絕並剝除多餘欄位', () => {
        expect(validateBackupEnvelope(v15Full([], [], {})).senkaTarget).toBeUndefined();
        expect(validateBackupEnvelope(v15Full([], [], { senkaTarget: null })).senkaTarget).toBeNull();
        for (const rank of [5, 20, 100, 500] as const) {
            expect(validateBackupEnvelope(v15Full([], [], { senkaTarget: { type: 'rank', rank, extra: 1 } })).senkaTarget)
                .toEqual({ type: 'rank', rank });
        }
        expect(validateBackupEnvelope(v15Full([], [], { senkaTarget: { type: 'custom', score: 0, extra: 1 } })).senkaTarget)
            .toEqual({ type: 'custom', score: 0 });
        expect(validateBackupEnvelope(v15Full([], [], { senkaTarget: { type: 'custom', score: 4500 } })).senkaTarget)
            .toEqual({ type: 'custom', score: 4500 });

        for (const bad of [
            '500', [], {},
            { type: 'none' },
            { type: 'rank', rank: 1 },
            { type: 'rank', rank: 501 },
            { type: 'rank', rank: '500' },
            { type: 'custom', score: -1 },
            { type: 'custom', score: 12.5 },
            { type: 'custom', score: '4500' },
        ]) {
            rejects(v15Full([], [], { senkaTarget: bad }));
        }
    });
});

describe('v15 匯出、還原往返與防呆契約', () => {
    it('匯出與還原完整保留 senkaRankings、senkaMonths 與 senkaTarget（含明確 null 清除本機目標）', async () => {
        const source = createDb();
        await source.open();
        await source.senkaRankings.bulkPut(RANKINGS);
        await source.senkaMonths.bulkPut(MONTHS);
        saveSenkaTarget({ type: 'rank', rank: 500 });

        const envelope = await buildFullEnvelope(source);
        expect(envelope.schemaVersion).toBe(15);
        expect(envelope.senkaTarget).toEqual({ type: 'rank', rank: 500 });

        const wire = JSON.parse(JSON.stringify(envelope));
        saveSenkaTarget({ type: 'custom', score: 9999 });

        const fresh = createDb();
        await fresh.open();
        await restoreBackup(fresh, wire);
        expect((await fresh.senkaRankings.toArray()).sort((a, b) => a.key.localeCompare(b.key)))
            .toEqual([...RANKINGS].sort((a, b) => a.key.localeCompare(b.key)));
        expect((await fresh.senkaMonths.toArray()).sort((a, b) => a.month.localeCompare(b.month)))
            .toEqual([...MONTHS].sort((a, b) => a.month.localeCompare(b.month)));
        expect(loadSenkaTarget()).toEqual({ type: 'rank', rank: 500 });

        // 匯出「不設目標（null）」時，還原必須明確清除目的地既有本機目標
        saveSenkaTarget(null);
        const nullEnv = JSON.parse(JSON.stringify(await buildFullEnvelope(source)));
        expect(nullEnv.senkaTarget).toBeNull();

        saveSenkaTarget({ type: 'rank', rank: 20 });
        const fresh2 = createDb();
        await fresh2.open();
        await restoreBackup(fresh2, nullEnv);
        expect(loadSenkaTarget()).toBeNull();
    });

    it('還原被拒絕時（目的地已有 senkaRankings 或 senkaMonths）不寫入也不改動本機 senkaTarget', async () => {
        saveSenkaTarget({ type: 'rank', rank: 20 });
        const db1 = createDb();
        await db1.open();
        await db1.senkaRankings.put(RANKINGS[0]);
        await expect(restoreBackup(db1, v15Full(RANKINGS, MONTHS, { senkaTarget: { type: 'rank', rank: 500 } })))
            .rejects.toThrow();
        expect(await db1.senkaRankings.count()).toBe(1);
        expect(loadSenkaTarget()).toEqual({ type: 'rank', rank: 20 });

        const db2 = createDb();
        await db2.open();
        await db2.senkaMonths.put(MONTHS[0]);
        await expect(restoreBackup(db2, v15Full(RANKINGS, MONTHS, { senkaTarget: null })))
            .rejects.toThrow();
        expect(await db2.senkaMonths.count()).toBe(1);
        expect(loadSenkaTarget()).toEqual({ type: 'rank', rank: 20 });
    });

    it('highestReferencedEventId 納入 senkaRankings 的 self／auto eventId，忽略 manual 與 senkaMonths', () => {
        expect(highestReferencedEventId({ senkaRankings: RANKINGS, senkaMonths: MONTHS })).toBe(202);
        expect(highestReferencedEventId({ senkaRankings: [RANKINGS[2]], senkaMonths: MONTHS })).toBe(0);
    });

    it('只有 senkaTarget 設定、資料表全空時仍視為空備份；有戰果資料列則非空備份', () => {
        const empty = validateBackupEnvelope(v15Full([], [], { senkaTarget: { type: 'rank', rank: 500 } }));
        expect(isEmptyBackup(empty.tables, empty.questFlow)).toBe(true);

        const nonEmpty = validateBackupEnvelope(v15Full([], [MONTHS[0]]));
        expect(isEmptyBackup(nonEmpty.tables, nonEmpty.questFlow)).toBe(false);
    });

    it('舊版雙檔合併正規化為 v15 full 時補空戰果表且維持 senkaTarget undefined', () => {
        const restore = {
            schemaVersion: 5, kind: 'restore', exportedAt: TS, tables: {
                snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [], shipObtained: [],
                eventPlans: [], resources: [], resourceMarks: [],
            },
        };
        const replays = { schemaVersion: 5, kind: 'replays', exportedAt: TS, tables: { replays: [] } };
        const combined = combineBackupEnvelopes([restore, replays]);
        expect(combined.schemaVersion).toBe(15);
        expect(combined.tables.senkaRankings).toEqual([]);
        expect(combined.tables.senkaMonths).toEqual([]);
        expect(combined.senkaTarget).toBeUndefined();
    });
});

describe('Dexie v17 → v18 升級', () => {
    it('純新增 senkaRankings 與 senkaMonths，既有資料不受影響且不回填既有 raw events', async () => {
        const name = `backup-v15-upgrade-${Date.now()}-${dbIndex++}`;
        const v17 = new Dexie(name);
        v17.version(17).stores({
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
            sortieBills: 'sortieKey, ts, map',
            meta: 'key',
        });
        await v17.open();
        await v17.table('resources').put({ eventId: 3, ts: TS, m: [1, 2, 3, 4, 5, 6, 7, 8], exp: 123456 });
        await v17.table('events').add({
            ts: TS,
            path: RANKING_API_PATH,
            api: { api_disp_page: 1, api_list: [] },
            req: {},
        });
        v17.close();

        const current = new KcDb(name);
        databases.push(current);
        await current.open();
        expect(current.verno).toBe(19);
        // 明確不回填既有 raw events
        expect(await current.senkaRankings.count()).toBe(0);
        expect(await current.senkaMonths.count()).toBe(0);
        expect(await current.resources.count()).toBe(1);
        expect(await current.events.count()).toBe(1);

        // 兩張新表可正常寫入與依索引查詢
        await current.senkaRankings.bulkPut(RANKINGS);
        await current.senkaMonths.bulkPut(MONTHS);
        expect(await current.senkaRankings.where('publishedAt').equals(PUB_NOV_30_15).count()).toBe(2);
        expect(await current.senkaMonths.get('2026-10')).toEqual(MONTHS[0]);
    });
});
