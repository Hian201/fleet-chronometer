// 任務清單觀測（db.questSeen）：任務曾出現在清單＝單發前置已完成，這份證據要撐過裁剪與
// 重裝還原；備份 v8 帶走它，v7 以前的舊檔仍可匯入。
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb, type QuestSeenRow } from '../utils/db';
import {
    BackupValidationError, buildFullEnvelope, highestReferencedEventId, restoreBackup, validateBackupEnvelope,
} from '../utils/backup';
import { GameState } from '../utils/state';
import { buildQuestFlow, QUEST_CATALOG } from '../utils/quest-flow';
import { applyArchivedQuestSeen, captureQuestSeen, listedQuestNos, mergeQuestSeen } from '../utils/quest-seen';

const TS = 1_700_000_000_000;
const QUESTLIST = 'api_get_member/questlist';
const databases: Dexie[] = [];
let serial = 0;

function track<T extends Dexie>(database: T): T {
    databases.push(database);
    return database;
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

function questlist(...quests: [number, number][]) {
    return { api_list: [...quests.map(([no, state]) => ({ api_no: no, api_state: state, api_title: '', api_detail: '' })), -1] };
}

function statusesOf(state: GameState) {
    return new Map(buildQuestFlow(state).rows.map(row => [row.definition.apiNo, row.status]));
}

describe('解析與合併', () => {
    it('只收 api_state 1–3 的任務，略過空欄 -1 與其他 path', () => {
        expect(listedQuestNos(QUESTLIST, questlist([107, 2], [201, 1], [303, 3], [999, 4]))).toEqual([107, 201, 303]);
        expect(listedQuestNos(QUESTLIST, { api_list: null })).toEqual([]);
        expect(listedQuestNos('api_port/port', questlist([107, 2]))).toEqual([]);
    });

    it('合併取最早與最近的觀測，重跑同一筆事件結果不變', () => {
        const first = mergeQuestSeen(undefined, 107, 10, TS);
        const later = mergeQuestSeen(first, 107, 20, TS + 5);
        expect(later).toEqual({ questNo: 107, firstTs: TS, firstEventId: 10, lastTs: TS + 5, lastEventId: 20 });
        expect(mergeQuestSeen(later, 107, 10, TS)).toEqual(later);
        expect(mergeQuestSeen(later, 107, 20, TS + 5)).toEqual(later);
    });

    it('capture 冪等寫入', async () => {
        const database = track(new KcDb(`quest-seen-capture-${serial++}`));
        await database.open();
        const event = { id: 5, ts: TS, path: QUESTLIST, api: questlist([107, 2], [201, 1]) };
        await captureQuestSeen(database, event);
        await captureQuestSeen(database, event);
        await captureQuestSeen(database, { ...event, id: 9, ts: TS + 100, api: questlist([107, 3]) });
        expect(await database.questSeen.toArray()).toEqual([
            { questNo: 107, firstTs: TS, firstEventId: 5, lastTs: TS + 100, lastEventId: 9 },
            { questNo: 201, firstTs: TS, firstEventId: 5, lastTs: TS, lastEventId: 5 },
        ]);
    });
});

describe('v13 → v14 升級', () => {
    it('從仍保留的 questlist raw events 回填，其他表不受影響', async () => {
        const name = `quest-seen-upgrade-${serial++}`;
        const v13 = track(new Dexie(name));
        v13.version(13).stores({
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
            meta: 'key',
        });
        await v13.open();
        const first = await v13.table('events').add({ ts: TS, path: QUESTLIST, api: questlist([107, 2], [201, 1]), req: { api_tab_id: '0' } });
        await v13.table('events').add({ ts: TS + 1, path: 'api_port/port', api: {} });
        const second = await v13.table('events').add({ ts: TS + 2, path: QUESTLIST, api: questlist([107, 3]), req: { api_tab_id: '9' } });
        await v13.table('questObserved').put({ eventId: 77, questNo: 201, ts: TS });
        v13.close();

        const v14 = track(new KcDb(name));
        await v14.open();
        expect(v14.verno).toBe(14);
        expect(await v14.questSeen.toArray()).toEqual([
            { questNo: 107, firstTs: TS, firstEventId: first, lastTs: TS + 2, lastEventId: second },
            { questNo: 201, firstTs: TS, firstEventId: first, lastTs: TS, lastEventId: first },
        ]);
        expect(await v14.events.count()).toBe(3);
        expect(await v14.questObserved.get(77)).toEqual({ eventId: 77, questNo: 201, ts: TS });
    });
});

describe('推論', () => {
    it('重裝後只有 questSeen、沒有 raw questlist，也能推出與當初看到清單時相同的單發前置', () => {
        const live = new GameState();
        live.applyEvent(QUESTLIST, questlist([107, 2]), { api_tab_id: '9' });
        const liveStatus = statusesOf(live);

        const restored = new GameState();
        applyArchivedQuestSeen(restored, [{ questNo: 107, firstTs: TS, lastTs: TS, firstEventId: 1, lastEventId: 1 }]);
        const restoredStatus = statusesOf(restored);

        const inferred = [...liveStatus].filter(([, status]) => status === 'inferred-complete').map(([no]) => no);
        expect(inferred).toEqual(expect.arrayContaining([101, 102, 103, 105, 106]));
        for (const no of inferred) expect(restoredStatus.get(no)).toBe('inferred-complete');
        // 任務本身只是「看過」，不因此算完成。
        expect(['inferred-complete', 'observed-complete', 'manual-complete']).not.toContain(restoredStatus.get(107));
    });

    it('即時封包也會記入 GameState，任務做完離開清單後推論仍在', () => {
        const state = new GameState();
        state.applyEvent(QUESTLIST, questlist([107, 2]), { api_tab_id: '9' });
        state.applyEvent(QUESTLIST, { api_list: null }, { api_tab_id: '9' });
        expect(state.questSeenNos_().has(107)).toBe(true);
        expect(statusesOf(state).get(106)).toBe('inferred-complete');
    });

    it('期間限定任務的舊觀測不當推論起點', () => {
        const limited = QUEST_CATALOG.find(definition => {
            if (!definition.limited) return false;
            const live = new GameState();
            live.applyEvent(QUESTLIST, questlist([definition.apiNo, 1]), { api_tab_id: '9' });
            return [...statusesOf(live).values()].some(status => status === 'inferred-complete');
        });
        expect(limited).toBeDefined();
        const state = new GameState();
        state.ingestArchivedQuestSeen(limited!.apiNo);
        expect([...statusesOf(state).values()].some(status => status === 'inferred-complete')).toBe(false);
    });
});

describe('備份 v8', () => {
    const SEEN: QuestSeenRow[] = [
        { questNo: 107, firstTs: TS, lastTs: TS + 10, firstEventId: 3, lastEventId: 120 },
        { questNo: 201, firstTs: TS, lastTs: TS, firstEventId: 3, lastEventId: 3 },
    ];
    const tables = (extra: Record<string, unknown[]> = {}) => ({
        snapshot: [], sorties: [], expeditions: [], factory: [], wanted: [],
        shipObtained: [], eventPlans: [], resources: [], resourceMarks: [],
        questObserved: [], replays: [],
        ...extra,
    });

    it('v8 full 必須含 questSeen；v7 舊檔不含時照常匯入，夾帶則拒絕', () => {
        expect(() => validateBackupEnvelope({ schemaVersion: 8, kind: 'full', exportedAt: TS, tables: tables() }))
            .toThrow(BackupValidationError);
        expect(validateBackupEnvelope({ schemaVersion: 8, kind: 'full', exportedAt: TS, tables: tables({ questSeen: SEEN }) })
            .tables.questSeen).toEqual(SEEN);
        expect(validateBackupEnvelope({ schemaVersion: 7, kind: 'full', exportedAt: TS, tables: tables() })
            .tables.questSeen).toBeUndefined();
        expect(() => validateBackupEnvelope({ schemaVersion: 7, kind: 'full', exportedAt: TS, tables: tables({ questSeen: SEEN }) }))
            .toThrow(BackupValidationError);
    });

    it('重複 questNo、lastTs 早於 firstTs 拒絕；event ID 納入 high-water', () => {
        const v8 = (questSeen: unknown[]) => ({ schemaVersion: 8, kind: 'full', exportedAt: TS, tables: tables({ questSeen }) });
        expect(() => validateBackupEnvelope(v8([SEEN[0], SEEN[0]]))).toThrow(BackupValidationError);
        expect(() => validateBackupEnvelope(v8([{ ...SEEN[0], lastTs: TS - 1 }]))).toThrow(BackupValidationError);
        expect(highestReferencedEventId({ questSeen: SEEN })).toBe(120);
    });

    it('匯出後還原到乾淨資料庫，推論隨之回來', async () => {
        const source = track(new KcDb(`quest-seen-backup-src-${serial++}`));
        await source.open();
        await source.questSeen.bulkPut(SEEN);
        const envelope = await buildFullEnvelope(source);
        expect(envelope.tables.questSeen).toEqual(SEEN);

        const fresh = track(new KcDb(`quest-seen-backup-dst-${serial++}`));
        await fresh.open();
        await restoreBackup(fresh, JSON.parse(JSON.stringify(envelope)));
        expect(await fresh.questSeen.toArray()).toEqual(SEEN);

        const state = new GameState();
        applyArchivedQuestSeen(state, await fresh.questSeen.toArray());
        expect(statusesOf(state).get(106)).toBe('inferred-complete');
    });

    it('v7 舊備份還原到新版：其他資料照常寫入，questSeen 保持空白', async () => {
        const fresh = track(new KcDb(`quest-seen-backup-v7-${serial++}`));
        await fresh.open();
        await restoreBackup(fresh, {
            schemaVersion: 7, kind: 'full', exportedAt: TS,
            tables: tables({ questObserved: [{ eventId: 50, questNo: 201, ts: TS }] }),
        });
        expect(await fresh.questObserved.count()).toBe(1);
        expect(await fresh.questSeen.count()).toBe(0);
    });
});
