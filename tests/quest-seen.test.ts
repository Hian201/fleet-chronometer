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
import { applyArchivedQuestSeen, captureQuestSeen, listedQuestNos, listedQuests, mergeQuestSeen } from '../utils/quest-seen';

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

describe('任務原文', () => {
    const titled = (no: number, title: string, detail: string) =>
        ({ api_list: [{ api_no: no, api_state: 2, api_title: title, api_detail: detail }] });

    it('解析標題與說明，空字串不記', () => {
        expect(listedQuests(QUESTLIST, titled(1172, '新任務', '説明'))).toEqual([{ no: 1172, title: '新任務', detail: '説明' }]);
        expect(listedQuests(QUESTLIST, questlist([107, 2]))).toEqual([{ no: 107 }]);
    });

    it('保留最近一次觀測的原文；較舊的觀測只在原本沒有原文時補上', () => {
        const first = mergeQuestSeen(undefined, 381, 10, TS, { title: '舊', detail: '舊説明' });
        const later = mergeQuestSeen(first, 381, 20, TS + 5, { title: '新', detail: '新説明' });
        expect(later).toMatchObject({ title: '新', detail: '新説明', lastEventId: 20 });
        expect(mergeQuestSeen(later, 381, 10, TS, { title: '舊', detail: '舊説明' })).toEqual(later);
        const untitled = mergeQuestSeen(undefined, 381, 20, TS + 5);
        expect(mergeQuestSeen(untitled, 381, 10, TS, { title: '舊', detail: '舊説明' })).toMatchObject({ title: '舊', lastEventId: 20 });
    });

    it('capture 寫入原文；原文改變也會更新', async () => {
        const database = track(new KcDb(`quest-seen-text-${serial++}`));
        await database.open();
        await captureQuestSeen(database, { id: 5, ts: TS, path: QUESTLIST, api: titled(1172, '新任務', '説明') });
        expect(await database.questSeen.get(1172)).toMatchObject({ title: '新任務', detail: '説明' });
    });

    it('任務離開清單後，任務導覽以保存的原文顯示（含只來自備份的觀測）', () => {
        const title = '【雷装強化工廠任務】夜戦突撃装備の強化【I】';
        const live = new GameState();
        live.applyEvent(QUESTLIST, titled(1172, title, '封包の説明'), { api_tab_id: '9' }, TS);
        live.applyEvent(QUESTLIST, { api_list: null }, { api_tab_id: '9' }, TS + 1);
        expect(buildQuestFlow(live).byNo.get(1172)!.detail).toBe('封包の説明');

        const restored = new GameState();
        applyArchivedQuestSeen(restored, [{ questNo: 1172, firstTs: TS, lastTs: TS, firstEventId: 1, lastEventId: 1, title, detail: '備份の説明' }]);
        expect(buildQuestFlow(restored).byNo.get(1172)!.detail).toBe('備份の説明');
    });

    it('保存的原文屬於營運重用前的舊任務時不用', () => {
        const state = new GameState();
        applyArchivedQuestSeen(state, [{ questNo: 1047, firstTs: TS, lastTs: TS, firstEventId: 1, lastEventId: 1, title: '別の任務', detail: '別の説明' }]);
        const row = buildQuestFlow(state).byNo.get(1047)!;
        expect(row.detail).not.toBe('別の説明');
        expect(row.name).not.toBe('別の任務');
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
        expect(v14.verno).toBeGreaterThanOrEqual(14);
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

    it('選填的 title／detail 原樣保留，非字串拒絕', () => {
        const v8 = (questSeen: unknown[]) => ({ schemaVersion: 8, kind: 'full', exportedAt: TS, tables: tables({ questSeen }) });
        const row = { ...SEEN[0], title: '新任務', detail: '説明' };
        expect(validateBackupEnvelope(v8([row])).tables.questSeen).toEqual([row]);
        expect(() => validateBackupEnvelope(v8([{ ...SEEN[0], title: 1 }]))).toThrow(BackupValidationError);
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
