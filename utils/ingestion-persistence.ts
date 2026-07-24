import type { KcDb, ApiEventRow } from './db';

type CapturedEventRow = ApiEventRow & { id: number; captureId: string };
type PersistedEventRow = ApiEventRow & { id: number };

export interface IngestionPersistenceDependencies {
    db: KcDb;
    postProcess: (event: ApiEventRow & { id: number }) => Promise<void>;
    createCollisionError?: (existing: CapturedEventRow, incoming: ApiEventRow) => Error;
}

function defaultCollisionError(existing: CapturedEventRow, incoming: ApiEventRow): Error {
    return new Error(
        `captureId collision：${existing.captureId} 已對應 ${existing.path} @ ${existing.ts}，` +
        `收到 ${incoming.path} @ ${incoming.ts}`,
    );
}

function assertSameCapture(
    existing: CapturedEventRow,
    incoming: ApiEventRow,
    createCollisionError: (existing: CapturedEventRow, incoming: ApiEventRow) => Error,
) {
    // captureId 是 bridge 的一次傳輸識別碼；只比對不昂貴且可辨識傳輸內容的欄位。
    if (existing.path !== incoming.path || existing.ts !== incoming.ts) {
        throw createCollisionError(existing, incoming);
    }
}

async function findCapturedEvent(db: KcDb, captureId: string): Promise<CapturedEventRow | undefined> {
    const event = await db.events.where('captureId').equals(captureId).first();
    return event?.id === undefined ? undefined : event as CapturedEventRow;
}

/**
 * 先保存 raw event，並為帶 captureId 的新事件建立 pending 狀態。
 * 沒有 captureId 的舊 provider 也會進入狀態機，但沒有跨 retry 去重保證。
 */
export async function persistIngestedEvent(
    row: ApiEventRow,
    { db, createCollisionError = defaultCollisionError }: Pick<IngestionPersistenceDependencies, 'db' | 'createCollisionError'>,
): Promise<ApiEventRow & { id: number }> {
    if (!row.captureId) {
        const event = { ...row, postProcessState: 'pending' as const };
        const id = await db.events.add(event);
        return { ...event, id };
    }

    const existing = await findCapturedEvent(db, row.captureId);
    if (existing) {
        assertSameCapture(existing, row, createCollisionError);
        return existing;
    }

    try {
        return await db.transaction('rw', db.events, async () => {
            const concurrent = await findCapturedEvent(db, row.captureId!);
            if (concurrent) {
                assertSameCapture(concurrent, row, createCollisionError);
                return concurrent;
            }
            const event = { ...row, postProcessState: 'pending' as const };
            const id = await db.events.add(event);
            return { ...event, id };
        });
    } catch (error) {
        // 兩個 readwrite transaction 同時新增同一 captureId 時，唯一索引會讓其中一個
        // 在 commit 失敗。重新讀取後把它當作 duplicate，而非遺失已成功落地的事件。
        const concurrent = await findCapturedEvent(db, row.captureId);
        if (concurrent) {
            assertSameCapture(concurrent, row, createCollisionError);
            return concurrent;
        }
        throw error;
    }
}

async function claimPostProcessing(db: KcDb, event: PersistedEventRow): Promise<boolean> {
    return db.transaction('rw', db.events, async () => {
        const current = await db.events.get(event.id);
        if (!current || current.postProcessState !== 'pending') return false;

        // 讀取與 pending → processing 更新位於同一 readwrite transaction，
        // 因此同一 captureId 最多一個呼叫端取得副作用的處理權。
        return (await db.events.update(event.id, { postProcessState: 'processing' })) === 1;
    });
}

/**
 * ingestion 的持久化狀態機。raw event 必先落地；只有取得 processing claim 才能執行副作用。
 */
export async function ingestWithPostProcessing(
    row: ApiEventRow,
    dependencies: IngestionPersistenceDependencies,
): Promise<number> {
    const event = await persistIngestedEvent(row, dependencies);

    if (event.postProcessState === 'done' || event.postProcessState === 'processing') {
        return event.id;
    }
    if (!await claimPostProcessing(dependencies.db, event)) return event.id;

    try {
        await dependencies.postProcess(event);
        await dependencies.db.events.update(event.id, { postProcessState: 'done' });
    } catch (error) {
        await dependencies.db.events.update(event.id, { postProcessState: 'pending' });
        throw error;
    }
    return event.id;
}
