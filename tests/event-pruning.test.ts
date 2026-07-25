import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KcDb, type ApiEventRow } from '../utils/db';
import { KEEP_RECENT, planRawEventPrune, pruneRawEventsBefore } from '../utils/event-pruning';
import { PROJECTION_META_VERSION } from '../utils/projection-cursor';

const databases: KcDb[] = [];
let serial = 0;

function createDb() {
    const database = new KcDb(`kc-event-pruning-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function event(id: number, path = 'api_test/event', postProcessState?: ApiEventRow['postProcessState']): ApiEventRow {
    return { id, ts: 1_726_000_000_000 + id, path, api: { id }, req: {}, postProcessState };
}

async function seedEvents(database: KcDb, events: ApiEventRow[]) {
    await database.events.bulkAdd(events);
}

async function eventIds(database: KcDb) {
    return (await database.events.orderBy('id').toArray()).map(row => row.id);
}

async function setProjection(database: KcDb, throughEventId: number, version: number = PROJECTION_META_VERSION) {
    await database.meta.put({ key: 'projection', version, throughEventId, updatedAt: 100 });
}

/**
 * 記錄 `events.where('id').below(...)` 上各呼叫了幾次 count／toArray。
 * `toArray` 會把候選事件（每筆含完整封包）整批讀進記憶體，正是 cursor 為 0 時要避免的動作；
 * 只斷言「沒刪東西」看不出差別，必須看有沒有真的去載。
 */
function watchCandidateReads(database: KcDb) {
    const reads = { count: 0, toArray: 0 };
    const realWhere = database.events.where.bind(database.events);
    vi.spyOn(database.events, 'where').mockImplementation(((index: never) => {
        const clause = realWhere(index);
        const realBelow = clause.below.bind(clause);
        clause.below = (value: never) => {
            const collection = realBelow(value);
            const realCount = collection.count.bind(collection);
            const realToArray = collection.toArray.bind(collection);
            collection.count = ((...args: never[]) => { reads.count++; return (realCount as never as CallableFunction)(...args); }) as typeof collection.count;
            collection.toArray = ((...args: never[]) => { reads.toArray++; return (realToArray as never as CallableFunction)(...args); }) as typeof collection.toArray;
            return collection;
        };
        return clause;
    }) as typeof database.events.where);
    return reads;
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('投影 cursor 安全事件裁剪', () => {
    it('沒有 projection metadata 時完全不刪除 raw event', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);

        const result = await pruneRawEventsBefore(database, 3);

        expect(result).toMatchObject({ removed: 0, skippedForInvalidProjection: true });
        expect(await eventIds(database)).toEqual([1, 2, 3]);
        expect(await database.meta.get('projection')).toBeUndefined();
    });

    it('backup restore marker 不得被錯認為 projection metadata', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);
        await database.meta.put({
            key: 'backup-restore',
            importedRestore: true,
            importedReplays: false,
            highestSourceEventId: 10,
            nextEventId: 11,
            updatedAt: 100,
        });

        const result = await pruneRawEventsBefore(database, 3);

        expect(result).toMatchObject({ removed: 0, skippedForInvalidProjection: true });
        expect(await eventIds(database)).toEqual([1, 2, 3]);
        expect(await database.meta.get('backup-restore')).toMatchObject({ highestSourceEventId: 10 });
    });

    it('Batch 3.1 projection version 過期時完全不刪除 raw event', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);
        await setProjection(database, 999, 2);

        const result = await pruneRawEventsBefore(database, 3);

        expect(result).toMatchObject({ removed: 0, skippedForInvalidProjection: true });
        expect(await eventIds(database)).toEqual([1, 2, 3]);
        expect(await database.meta.get('projection')).toMatchObject({ version: 2, throughEventId: 999 });
    });

    it('projection cursor 不是有效非負整數時完全不刪除 raw event', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);
        await setProjection(database, -1);

        const result = await pruneRawEventsBefore(database, 3);

        expect(result).toMatchObject({ removed: 0, skippedForInvalidProjection: true });
        expect(await eventIds(database)).toEqual([1, 2, 3]);
        expect(await database.meta.get('projection')).toMatchObject({ version: PROJECTION_META_VERSION, throughEventId: -1 });
    });

    it('cursor 為 0（面板從未投影過）時直接跳出，不把候選事件讀進記憶體', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);
        await setProjection(database, 0);
        const reads = watchCandidateReads(database);

        const result = await pruneRawEventsBefore(database, 3);

        expect(result).toMatchObject({ removed: 0, skippedForInvalidProjection: false });
        expect(result.plan.throughEventId).toBe(0);
        expect(reads.toArray).toBe(0);
        expect(await eventIds(database)).toEqual([1, 2, 3]);
    });

    it('cursor 落在整個裁剪窗之前時同樣不讀取候選', async () => {
        const database = createDb();
        await seedEvents(database, [event(10), event(11), event(12)]);
        await setProjection(database, 5);   // 比最小的事件 id 還小＝這個窗裡沒有可刪的
        const reads = watchCandidateReads(database);

        const result = await pruneRawEventsBefore(database, 12);

        expect(result.removed).toBe(0);
        expect(reads.toArray).toBe(0);
        expect(await eventIds(database)).toEqual([10, 11, 12]);
    });

    it('範圍內有可刪事件時仍照原本流程讀取候選並裁剪', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);
        await setProjection(database, 2);
        const reads = watchCandidateReads(database);

        const result = await pruneRawEventsBefore(database, 3);

        expect(reads.toArray).toBe(1);
        expect(result.removed).toBe(2);
        expect(await eventIds(database)).toEqual([3]);
    });

    it('projection 尚未追完 cutoff 時只刪 cursor 以內，保留所有尚未投影事件', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3), event(4), event(5)]);
        await setProjection(database, 2);

        const result = await pruneRawEventsBefore(database, 4);

        expect(result.plan.candidateEventIds).toEqual([1, 2, 3]);
        expect(result.plan.deleteEventIds).toEqual([1, 2]);
        expect(await eventIds(database)).toEqual([3, 4, 5]);
    });

    it('cursor 大於 generation cutoff 時仍只依 generation cutoff 刪除', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3), event(4), event(5)]);
        await setProjection(database, 99);

        await pruneRawEventsBefore(database, 4);

        expect(await eventIds(database)).toEqual([4, 5]);
    });

    it('safety cutoff 大於 cursor 時保留所有未投影事件', async () => {
        const database = createDb();
        const events = Array.from({ length: 5_001 }, (_, index) => event(index + 1));
        await seedEvents(database, events);
        await setProjection(database, 4_400);
        // 沿用既有 safety 規則：倒數第 SAFETY_KEEP_RAW 筆作為 exclusive cutoff。
        const safetyCutoff = events.slice().reverse()[500].id!;

        await pruneRawEventsBefore(database, safetyCutoff);

        const remaining = await eventIds(database);
        expect(remaining).not.toContain(1);
        expect(remaining).not.toContain(4_400);
        expect(remaining).toContain(4_401);
        expect(remaining).toContain(4_500);
        expect(remaining).toContain(4_501);
        expect(remaining).toContain(5_001);
    }, 20_000);

    it('cursor 大於 safety cutoff 時依既有 safety 規則裁剪', async () => {
        const database = createDb();
        const events = Array.from({ length: 5_001 }, (_, index) => event(index + 1));
        // cutoff 前最近的 port 與 start2 仍須被保護，模擬既有基石規則。
        events[9] = event(10, 'api_start2/getData');
        events[4_498] = event(4_499, 'api_port/port');
        await seedEvents(database, events);
        await setProjection(database, 5_001);
        const safetyCutoff = events.slice().reverse()[500].id!;

        await pruneRawEventsBefore(database, safetyCutoff);

        const remaining = await eventIds(database);
        expect(remaining).toContain(10);
        expect(remaining).toContain(4_499);
        expect(remaining).toContain(safetyCutoff);
        expect(remaining).toContain(5_001);
        expect(remaining).not.toContain(1);
    }, 20_000);

    it('wanted reference 即使已投影且在 cutoff 前也永遠保留', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);
        await database.wanted.add({ eventId: 1, tag: 'wanted', ts: 1, path: 'api_test/event' });
        await setProjection(database, 3);

        await pruneRawEventsBefore(database, 3);

        expect(await eventIds(database)).toEqual([1, 3]);
    });

    it('api_start2/getData 在 cutoff 前最近一筆受到 KEEP_RECENT 保護', async () => {
        const database = createDb();
        await seedEvents(database, [
            event(1, 'api_start2/getData'), event(2), event(3), event(4, 'api_start2/getData'), event(5),
        ]);
        await setProjection(database, 99);

        await pruneRawEventsBefore(database, 5);

        expect(await eventIds(database)).toEqual([4, 5]);
    });

    it('既有 KEEP_RECENT path 的數量規則保持不變', () => {
        const events = Array.from({ length: 12 }, (_, index) => event(index + 1, 'api_get_member/questlist'));
        const metadata = { key: 'projection' as const, version: PROJECTION_META_VERSION, throughEventId: 99, updatedAt: 1 };

        const plan = planRawEventPrune(events, [], 13, metadata);

        expect(KEEP_RECENT['api_get_member/questlist']).toBe(10);
        expect([...plan.protectedEventIds].sort((left, right) => left - right)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(plan.deleteEventIds).toEqual([1, 2]);
    });

    it('pending、processing 與任何 id 大於 cursor 的事件皆保留', async () => {
        const database = createDb();
        await seedEvents(database, [
            event(1), event(2), event(3), event(4),
            event(5, 'api_test/event', 'pending'), event(6, 'api_test/event', 'processing'),
        ]);
        await setProjection(database, 4);

        await pruneRawEventsBefore(database, 7);

        expect(await eventIds(database)).toEqual([5, 6]);
        expect((await database.events.get(5))?.postProcessState).toBe('pending');
        expect((await database.events.get(6))?.postProcessState).toBe('processing');
    });

    it('同一個 prune 重跑結果相同且不再造成刪除', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3), event(4)]);
        await setProjection(database, 4);

        const first = await pruneRawEventsBefore(database, 4);
        const afterFirst = await eventIds(database);
        const second = await pruneRawEventsBefore(database, 4);

        expect(first.removed).toBe(3);
        expect(second.removed).toBe(0);
        expect(await eventIds(database)).toEqual(afterFirst);
    });

    it('裁剪只改 raw events，derived tables、snapshot、shipObtained 與 metadata 均不變', async () => {
        const database = createDb();
        await seedEvents(database, [event(1), event(2), event(3)]);
        await setProjection(database, 3);
        await database.sorties.put({ eventId: 101, sortieKey: 100, ts: 1, map: '1-1', node: 1, boss: false, kind: 'battle', rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false });
        await database.factory.put({ eventId: 102, ts: 1, kind: 'develop', used: [], secretary: 1, results: [] });
        await database.expeditions.put({ eventId: 103, ts: 1, deckId: 1, missionId: 1, name: 'test', result: 2, resources: [], items: [] });
        await database.replays.put({ sortieKey: 100, ts: 1, world: 1, mapnum: 1, diff: 0, combined: 0, fleetnum: 1, fleet1: [], fleet2: [], battles: [] });
        await database.snapshot.put({ path: 'api_port/port', ts: 1, api: { snapshot: true }, eventId: 3 });
        await database.shipObtained.put({ id: 1, mst: 1, obtainedTs: null, source: null });
        const before = await Promise.all([
            database.sorties.toArray(), database.factory.toArray(), database.expeditions.toArray(),
            database.replays.toArray(), database.snapshot.toArray(), database.shipObtained.toArray(), database.meta.toArray(),
        ]);

        await pruneRawEventsBefore(database, 3);

        expect(await Promise.all([
            database.sorties.toArray(), database.factory.toArray(), database.expeditions.toArray(),
            database.replays.toArray(), database.snapshot.toArray(), database.shipObtained.toArray(), database.meta.toArray(),
        ])).toEqual(before);
    });

    it('service-worker recovery 重做同一 start2 side effect 時不會額外刪除', async () => {
        const database = createDb();
        // id=5 視為 recovery 重做的 current start2；其上一筆 start2(id=4) 繼續是 generation cutoff。
        await seedEvents(database, [
            event(1), event(2, 'api_start2/getData'), event(3), event(4, 'api_start2/getData'), event(5, 'api_start2/getData'),
        ]);
        await setProjection(database, 3);

        const first = await pruneRawEventsBefore(database, 4);
        const afterFirst = await eventIds(database);
        const recoveryRedo = await pruneRawEventsBefore(database, 4);

        expect(first.removed).toBe(2);
        expect(recoveryRedo.removed).toBe(0);
        expect(await eventIds(database)).toEqual(afterFirst);
    });
});
