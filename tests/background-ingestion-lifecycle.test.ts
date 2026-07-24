import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BackgroundIngestionLifecycle,
    recoverPendingPostProcessing,
} from '../utils/background-ingestion-lifecycle';
import { KcDb, type ApiEventRow } from '../utils/db';
import { createEventNotificationId } from '../utils/event-notification';

const databases: KcDb[] = [];
let serial = 0;

function createDb() {
    const database = new KcDb(`kc-background-lifecycle-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function event(captureId: string, marker: string): ApiEventRow {
    return {
        ts: 1_726_000_000_000,
        path: 'api_port/port',
        api: { marker },
        req: {},
        captureId,
        source: 'main',
    };
}

async function waitFor(check: () => boolean) {
    for (let index = 0; index < 30 && !check(); index++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(check()).toBe(true);
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('background ingestion lifecycle', () => {
    it('新的 processor 會把遺留的 processing event 恢復並完成', async () => {
        const db = createDb();
        const id = await db.events.add({ ...event('capture-processing', 'processing'), postProcessState: 'processing' });
        const postProcess = vi.fn().mockResolvedValue(undefined);

        const lifecycle = new BackgroundIngestionLifecycle({ db, postProcess });
        await lifecycle.recoveryPromise;

        expect(postProcess).toHaveBeenCalledWith(expect.objectContaining({ id, captureId: 'capture-processing' }));
        expect((await db.events.get(id))?.postProcessState).toBe('done');
    });

    it('recovery 依 events.id 由小到大處理所有 pending event', async () => {
        const db = createDb();
        const first = await db.events.add({ ...event('capture-first', 'first'), postProcessState: 'pending' });
        const second = await db.events.add({ ...event('capture-second', 'second'), postProcessState: 'pending' });
        const processed: number[] = [];

        await recoverPendingPostProcessing({
            db,
            postProcess: async persisted => { processed.push(persisted.id); },
        });

        expect(processed).toEqual([first, second]);
        expect((await db.events.get(first))?.postProcessState).toBe('done');
        expect((await db.events.get(second))?.postProcessState).toBe('done');
    });

    it('recovery 完成前，新 ingestion 會等待且不會平行執行 post-processing', async () => {
        const db = createDb();
        await db.events.add({ ...event('capture-recovery', 'recovery'), postProcessState: 'pending' });
        let releaseRecovery!: () => void;
        let running = 0;
        let maxRunning = 0;
        const processed: string[] = [];
        const postProcess = vi.fn(async persisted => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            processed.push((persisted.api as { marker: string }).marker);
            if (processed.length === 1) await new Promise<void>(resolve => { releaseRecovery = resolve; });
            running--;
        });
        const lifecycle = new BackgroundIngestionLifecycle({ db, postProcess });

        await waitFor(() => postProcess.mock.calls.length === 1);
        const incoming = lifecycle.ingest(event('capture-new', 'new'));
        expect(await db.events.count()).toBe(1);

        releaseRecovery();
        await incoming;

        expect(processed).toEqual(['recovery', 'new']);
        expect(maxRunning).toBe(1);
    });

    it('recovery 失敗時把該 event 留在 pending，且不處理後續新 ingestion', async () => {
        const db = createDb();
        const id = await db.events.add({ ...event('capture-failure', 'failure'), postProcessState: 'pending' });
        const laterId = await db.events.add({ ...event('capture-later', 'later'), postProcessState: 'pending' });
        const failure = new Error('recovery failure');
        const postProcess = vi.fn().mockRejectedValue(failure);
        const lifecycle = new BackgroundIngestionLifecycle({ db, postProcess });

        await expect(lifecycle.recoveryPromise).rejects.toBe(failure);
        await expect(lifecycle.ingest(event('capture-new', 'new'))).rejects.toBe(failure);

        expect((await db.events.get(id))?.postProcessState).toBe('pending');
        expect((await db.events.get(laterId))?.postProcessState).toBe('pending');
        expect(postProcess).toHaveBeenCalledTimes(1);
        expect(await db.events.where('captureId').equals('capture-new').count()).toBe(0);
    });

    it('done 與沒有 captureId 的歷史 event 不會在 recovery 重跑', async () => {
        const db = createDb();
        const doneId = await db.events.add({ ...event('capture-done', 'done'), postProcessState: 'done' });
        const legacyId = await db.events.add({
            ts: 1_726_000_000_001,
            path: 'api_port/port',
            api: { marker: 'legacy' },
            req: {},
            postProcessState: 'pending',
        });
        const postProcess = vi.fn().mockResolvedValue(undefined);

        await recoverPendingPostProcessing({ db, postProcess });

        expect(postProcess).not.toHaveBeenCalled();
        expect((await db.events.get(doneId))?.postProcessState).toBe('done');
        expect((await db.events.get(legacyId))?.postProcessState).toBe('pending');
    });

    it('同一事件 recovery 重做時使用固定 notification ID', async () => {
        const db = createDb();
        const id = await db.events.add({ ...event('capture-notify', 'notify'), postProcessState: 'processing' });
        const notificationIds: string[] = [];
        const postProcess = vi.fn(async persisted => {
            notificationIds.push(createEventNotificationId(persisted.id, 'mission-start'));
        });

        await recoverPendingPostProcessing({ db, postProcess });
        await db.events.update(id, { postProcessState: 'processing' });
        await recoverPendingPostProcessing({ db, postProcess });

        expect(notificationIds).toEqual([
            `kc-event-${id}-mission-start`,
            `kc-event-${id}-mission-start`,
        ]);
    });

    it('Batch 2.3 的 duplicate suppression 在 recovery 後仍成立', async () => {
        const db = createDb();
        const postProcess = vi.fn().mockResolvedValue(undefined);
        const lifecycle = new BackgroundIngestionLifecycle({ db, postProcess });
        await lifecycle.recoveryPromise;

        const row = event('capture-duplicate', 'duplicate');
        const first = await lifecycle.ingest(row);
        const second = await lifecycle.ingest(row);

        expect(first).toBe(second);
        expect(await db.events.where('captureId').equals('capture-duplicate').count()).toBe(1);
        expect(postProcess).toHaveBeenCalledTimes(1);
    });
});
