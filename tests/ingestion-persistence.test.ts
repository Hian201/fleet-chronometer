import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KcDb, type ApiEventRow } from '../utils/db';
import {
    ingestWithPostProcessing,
    persistIngestedEvent,
} from '../utils/ingestion-persistence';

const databases: KcDb[] = [];
let serial = 0;

function createDb() {
    const database = new KcDb(`kc-ingestion-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function event(captureId?: string, overrides: Partial<ApiEventRow> = {}): ApiEventRow {
    return {
        ts: 1_726_000_000_000,
        path: 'api_port/port',
        api: { marker: 'mock-event' },
        req: { api_deck_id: '1' },
        captureId,
        source: 'main',
        ...overrides,
    };
}

async function waitForCall(spy: ReturnType<typeof vi.fn>) {
    for (let index = 0; index < 20 && spy.mock.calls.length === 0; index++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(spy).toHaveBeenCalledTimes(1);
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('ingestion persistence', () => {
    it('新 captureId 先建立一筆 pending event', async () => {
        const db = createDb();
        const persisted = await persistIngestedEvent(event('capture-new'), { db });

        expect(persisted.id).toEqual(expect.any(Number));
        expect(await db.events.toArray()).toMatchObject([{
            id: persisted.id,
            captureId: 'capture-new',
            postProcessState: 'pending',
        }]);
    });

    it('claim 後進入 processing，副作用成功後進入 done', async () => {
        const db = createDb();
        let releasePostProcess!: () => void;
        const postProcess = vi.fn(() => new Promise<void>(resolve => { releasePostProcess = resolve; }));
        const ingesting = ingestWithPostProcessing(event('capture-processing'), { db, postProcess });

        await waitForCall(postProcess);
        const processing = await db.events.where('captureId').equals('capture-processing').first();
        expect(processing?.postProcessState).toBe('processing');

        releasePostProcess();
        await expect(ingesting).resolves.toBe(processing?.id);
        expect((await db.events.get(processing!.id!))?.postProcessState).toBe('done');
    });

    it('done duplicate 重送不新增 event，也不重跑副作用', async () => {
        const db = createDb();
        const postProcess = vi.fn().mockResolvedValue(undefined);
        const row = event('capture-done');

        const id = await ingestWithPostProcessing(row, { db, postProcess });
        await expect(ingestWithPostProcessing(row, { db, postProcess })).resolves.toBe(id);
        await expect(ingestWithPostProcessing(row, { db, postProcess })).resolves.toBe(id);

        expect(await db.events.count()).toBe(1);
        expect(postProcess).toHaveBeenCalledTimes(1);
        expect((await db.events.get(id))?.postProcessState).toBe('done');
    });

    it('pending event 可由 retry 重新 claim', async () => {
        const db = createDb();
        const postProcess = vi.fn()
            .mockRejectedValueOnce(new Error('mock side effect failure'))
            .mockResolvedValueOnce(undefined);
        const row = event('capture-retry');

        await expect(ingestWithPostProcessing(row, { db, postProcess })).rejects.toThrow('mock side effect failure');
        const pending = await db.events.where('captureId').equals('capture-retry').first();
        expect(pending?.postProcessState).toBe('pending');

        await expect(ingestWithPostProcessing(row, { db, postProcess })).resolves.toBe(pending?.id);
        expect(postProcess).toHaveBeenCalledTimes(2);
        expect((await db.events.get(pending!.id!))?.postProcessState).toBe('done');
    });

    it('processing duplicate 不會平行執行副作用', async () => {
        const db = createDb();
        let releasePostProcess!: () => void;
        const postProcess = vi.fn(() => new Promise<void>(resolve => { releasePostProcess = resolve; }));
        const row = event('capture-in-flight');
        const first = ingestWithPostProcessing(row, { db, postProcess });

        await waitForCall(postProcess);
        const id = (await db.events.where('captureId').equals('capture-in-flight').first())!.id!;
        await expect(ingestWithPostProcessing(row, { db, postProcess })).resolves.toBe(id);
        expect(postProcess).toHaveBeenCalledTimes(1);

        releasePostProcess();
        await expect(first).resolves.toBe(id);
        expect((await db.events.get(id))?.postProcessState).toBe('done');
    });

    it('副作用失敗時回到 pending 並向呼叫端拋出錯誤', async () => {
        const db = createDb();
        const failure = new Error('mock failure');
        const postProcess = vi.fn().mockRejectedValue(failure);

        await expect(ingestWithPostProcessing(event('capture-failure'), { db, postProcess })).rejects.toBe(failure);
        expect((await db.events.where('captureId').equals('capture-failure').first())?.postProcessState).toBe('pending');
    });

    it('captureId collision 會拒絕，且不新增 event 或執行副作用', async () => {
        const db = createDb();
        const postProcess = vi.fn().mockResolvedValue(undefined);
        await ingestWithPostProcessing(event('capture-collision'), { db, postProcess });

        await expect(ingestWithPostProcessing(event('capture-collision', {
            path: 'api_req_map/start',
            ts: 1_726_000_000_001,
        }), { db, postProcess })).rejects.toThrow('captureId collision');

        expect(await db.events.count()).toBe(1);
        expect(postProcess).toHaveBeenCalledTimes(1);
    });

    it('不同 captureId 可各自寫入與處理', async () => {
        const db = createDb();
        const postProcess = vi.fn().mockResolvedValue(undefined);

        const first = await ingestWithPostProcessing(event('capture-a'), { db, postProcess });
        const second = await ingestWithPostProcessing(event('capture-b'), { db, postProcess });

        expect(first).not.toBe(second);
        expect(await db.events.count()).toBe(2);
        expect(postProcess).toHaveBeenCalledTimes(2);
    });

    it('post-processing callback 可把正確來源 eventId 寫入 snapshot row', async () => {
        const db = createDb();
        const postProcess = vi.fn(async (persisted: ApiEventRow & { id: number }) => {
            await db.snapshot.put({
                path: persisted.path,
                ts: persisted.ts,
                api: persisted.api,
                req: persisted.req,
                eventId: persisted.id,
            });
        });

        const id = await ingestWithPostProcessing(event('capture-snapshot'), { db, postProcess });
        expect(await db.snapshot.get('api_port/port')).toMatchObject({ eventId: id });
    });

    it('沒有 captureId 的 legacy row 仍可新增', async () => {
        const db = createDb();
        const postProcess = vi.fn().mockResolvedValue(undefined);

        const id = await ingestWithPostProcessing(event(undefined), { db, postProcess });
        const saved = await db.events.get(id);

        expect(saved?.captureId).toBeUndefined();
        expect(saved?.postProcessState).toBe('done');
        expect(postProcess).toHaveBeenCalledTimes(1);
    });
});
