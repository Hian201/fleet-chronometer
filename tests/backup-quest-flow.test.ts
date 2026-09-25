import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    BackupValidationError, buildFullEnvelope, combineBackupEnvelopes, isEmptyBackup,
    restoreBackup, validateBackupEnvelope,
} from '../utils/backup';
import { KcDb } from '../utils/db';
import {
    QUEST_FLOW_PREFS_KEY, readQuestFlowBackupPrefs,
} from '../utils/quest-flow-prefs';

const databases: KcDb[] = [];
let serial = 0;
const TS = 1_726_000_000_000;

function installStorage(): void {
    const map = new Map<string, string>();
    const storage = {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
        clear: () => { map.clear(); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

function createDb() {
    const database = new KcDb(`kc-backup-qf-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function emptyV6Tables() {
    return {
        snapshot: [] as unknown[],
        sorties: [] as unknown[],
        expeditions: [] as unknown[],
        factory: [] as unknown[],
        wanted: [] as unknown[],
        shipObtained: [] as unknown[],
        eventPlans: [] as unknown[],
        resources: [] as unknown[],
        resourceMarks: [] as unknown[],
        replays: [] as unknown[],
    };
}

function v6Full(extra: Record<string, unknown> = {}) {
    return {
        schemaVersion: 6,
        kind: 'full',
        exportedAt: TS,
        tables: {
            ...emptyV6Tables(),
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

describe('備份的任務導覽釘選／人工完成', () => {
    it('匯出讀取 localStorage，還原後寫回且保留其他 UI 偏好', async () => {
        localStorage.setItem(QUEST_FLOW_PREFS_KEY, JSON.stringify({
            pinned: [210, 101],
            manualComplete: [201],
            query: '空母',
            focus: 'all',
        }));
        const source = createDb();
        await source.snapshot.put({
            path: 'api_port/port', ts: TS, api: { api_ship: [{ api_id: 1 }] }, req: {}, eventId: 1,
        });
        const envelope = await buildFullEnvelope(source);
        expect(envelope.questFlow).toEqual({ pinned: [101, 210], manualComplete: [201] });
        expect(isEmptyBackup(envelope.tables, envelope.questFlow)).toBe(false);

        localStorage.setItem(QUEST_FLOW_PREFS_KEY, JSON.stringify({
            pinned: [999],
            manualComplete: [888],
            query: '空母',
            focus: 'all',
        }));
        const target = createDb();
        await restoreBackup(target, envelope);
        expect(readQuestFlowBackupPrefs()).toEqual({ pinned: [101, 210], manualComplete: [201] });
        expect(JSON.parse(localStorage.getItem(QUEST_FLOW_PREFS_KEY)!)).toMatchObject({
            pinned: [101, 210],
            manualComplete: [201],
            query: '空母',
            focus: 'all',
        });
    });

    it('還原被拒絕時不得改寫本機釘選', async () => {
        localStorage.setItem(QUEST_FLOW_PREFS_KEY, JSON.stringify({ pinned: [210], manualComplete: [] }));
        const database = createDb();
        await database.snapshot.put({
            path: 'api_port/port', ts: TS, api: {}, req: {}, eventId: 1,
        });
        await expect(restoreBackup(database, v6Full({
            questFlow: { pinned: [101], manualComplete: [201] },
        }))).rejects.toThrow();
        expect(readQuestFlowBackupPrefs()).toEqual({ pinned: [210], manualComplete: [] });
    });

    it('舊備份沒有 questFlow 時不得清空本機釘選', async () => {
        localStorage.setItem(QUEST_FLOW_PREFS_KEY, JSON.stringify({ pinned: [210], manualComplete: [] }));
        const database = createDb();
        await restoreBackup(database, v6Full());
        expect(readQuestFlowBackupPrefs()).toEqual({ pinned: [210], manualComplete: [] });
        expect(validateBackupEnvelope(v6Full()).questFlow).toBeUndefined();
    });

    it('表全空但有釘選仍可寫檔；惡意欄位拒絕，多餘鍵丟棄', () => {
        const empty = validateBackupEnvelope({
            schemaVersion: 6, kind: 'full', exportedAt: TS, tables: emptyV6Tables(),
        });
        expect(isEmptyBackup(empty.tables, empty.questFlow)).toBe(true);

        const pinnedOnly = validateBackupEnvelope({
            schemaVersion: 6, kind: 'full', exportedAt: TS, tables: emptyV6Tables(),
            questFlow: { pinned: [210, 210, 101], manualComplete: [], query: 'ignore-me' },
        });
        expect(isEmptyBackup(pinnedOnly.tables, pinnedOnly.questFlow)).toBe(false);
        expect(pinnedOnly.questFlow).toEqual({ pinned: [101, 210], manualComplete: [] });

        expect(() => validateBackupEnvelope({
            ...v6Full(),
            questFlow: { pinned: [1], manualComplete: [], api_token: 'secret' },
        })).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope({
            ...v6Full(),
            questFlow: { pinned: [0], manualComplete: [] },
        })).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope({
            ...v6Full(),
            questFlow: { pinned: '210', manualComplete: [] },
        })).toThrow(BackupValidationError);
    });

    it('舊版 split 合併時沿用 restore 檔的 questFlow', () => {
        const restore = {
            schemaVersion: 3,
            kind: 'restore',
            exportedAt: TS,
            tables: {
                snapshot: [{ path: 'api_port/port', ts: TS, api: {}, req: {}, eventId: 1 }],
                sorties: [], expeditions: [], factory: [], wanted: [], shipObtained: [],
            },
            questFlow: { pinned: [210], manualComplete: [101] },
        };
        const replays = {
            schemaVersion: 3,
            kind: 'replays',
            exportedAt: TS,
            tables: {
                replays: [{
                    sortieKey: 1, ts: TS, world: 1, mapnum: 1, diff: 0, bossCellNo: 1, combined: 0,
                    fleetnum: 1,
                    fleet1: [{
                        mst_id: 1, lv: 1, equip: [-1], stars: [0], ace: [0], exequip: -1,
                        nowhp: 10, maxhp: 10, cond: 49,
                    }],
                    fleet2: [],
                    battles: [],
                }],
            },
        };
        const combined = combineBackupEnvelopes([restore, replays]);
        expect(combined.questFlow).toEqual({ pinned: [210], manualComplete: [101] });
    });
});
