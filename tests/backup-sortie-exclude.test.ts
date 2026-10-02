import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    BackupValidationError, buildFullEnvelope, combineBackupEnvelopes, isEmptyBackup,
    restoreBackup, validateBackupEnvelope,
} from '../utils/backup';
import { KcDb } from '../utils/db';
import { loadExcludedMaps, saveExcludedMaps } from '../utils/sortie-exclude';

const databases: KcDb[] = [];
let serial = 0;
const TS = 1_726_000_000_000;

function installStorage(): void {
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

function createDb() {
    const database = new KcDb(`kc-backup-se-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

const emptyV8Tables = () => ({
    snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [], shipObtained: [],
    eventPlans: [], resources: [], resourceMarks: [], questObserved: [], questSeen: [], replays: [],
});

function v8Full(extra: Record<string, unknown> = {}) {
    return {
        schemaVersion: 8,
        kind: 'full',
        exportedAt: TS,
        tables: {
            ...emptyV8Tables(),
            snapshot: [{ path: 'api_port/port', ts: TS, api: { api_ship: [{ api_id: 1 }] }, req: {}, eventId: 1 }],
        },
        ...extra,
    };
}

beforeEach(() => { installStorage(); });

afterEach(async () => {
    try { delete (globalThis as { localStorage?: unknown }).localStorage; } catch { /* ignore */ }
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('備份的「不記錄的海域」', () => {
    it('匯出讀取本機設定，還原後覆寫回本機', async () => {
        saveExcludedMaps(['6-5', '1-5']);
        const source = createDb();
        await source.snapshot.put({ path: 'api_port/port', ts: TS, api: {}, req: {}, eventId: 1 });
        const envelope = await buildFullEnvelope(source);
        expect(envelope.sortieExclude).toEqual(['1-5', '6-5']);

        saveExcludedMaps(['2-2']);
        await restoreBackup(createDb(), envelope);
        expect(loadExcludedMaps()).toEqual(['1-5', '6-5']);
    });

    it('還原被拒絕時不改寫本機設定', async () => {
        saveExcludedMaps(['2-2']);
        const database = createDb();
        await database.snapshot.put({ path: 'api_port/port', ts: TS, api: {}, req: {}, eventId: 1 });
        await expect(restoreBackup(database, v8Full({ sortieExclude: ['1-5'] }))).rejects.toThrow();
        expect(loadExcludedMaps()).toEqual(['2-2']);
    });

    it('舊備份沒有 sortieExclude 時不清空本機設定；空陣列則照樣覆寫', async () => {
        saveExcludedMaps(['2-2']);
        await restoreBackup(createDb(), v8Full());
        expect(loadExcludedMaps()).toEqual(['2-2']);
        expect(validateBackupEnvelope(v8Full()).sortieExclude).toBeUndefined();

        await restoreBackup(createDb(), v8Full({ sortieExclude: [] }));
        expect(loadExcludedMaps()).toEqual([]);
    });

    it('只拒絕非通常海域、非正規寫法與重複值', () => {
        expect(validateBackupEnvelope(v8Full({ sortieExclude: ['3-5', '1-1'] })).sortieExclude).toEqual(['3-5', '1-1']);
        for (const bad of [['61-1'], ['1-5', '1-5'], ['１-５'], [' 1-5'], [15], 'not-array']) {
            expect(() => validateBackupEnvelope(v8Full({ sortieExclude: bad })), JSON.stringify(bad))
                .toThrow(BackupValidationError);
        }
    });

    it('只有這項設定、資料表全空時仍視為空備份', () => {
        const envelope = validateBackupEnvelope({
            schemaVersion: 8, kind: 'full', exportedAt: TS, tables: emptyV8Tables(), sortieExclude: ['1-5'],
        });
        expect(isEmptyBackup(envelope.tables, envelope.questFlow)).toBe(true);
    });

    it('舊版雙檔合併時沿用 restore 檔的設定（舊檔本來就沒有）', () => {
        const restore = { schemaVersion: 5, kind: 'restore', exportedAt: TS, tables: {
            snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [], shipObtained: [],
            eventPlans: [], resources: [], resourceMarks: [],
        } };
        const replays = { schemaVersion: 5, kind: 'replays', exportedAt: TS, tables: { replays: [] } };
        expect(combineBackupEnvelopes([restore, replays]).sortieExclude).toBeUndefined();
    });
});
