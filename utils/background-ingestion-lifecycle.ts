import type { ApiEventRow, KcDb } from './db';
import { ingestWithPostProcessing, type IngestionPersistenceDependencies } from './ingestion-persistence';

type PersistedEventRow = ApiEventRow & { id: number };

export interface BackgroundIngestionLifecycleDependencies
    extends Pick<IngestionPersistenceDependencies, 'db' | 'postProcess' | 'createCollisionError'> {}

function hasCaptureId(event: ApiEventRow): event is ApiEventRow & { captureId: string } {
    return typeof event.captureId === 'string' && event.captureId.length > 0;
}

/**
 * 將上一次 service worker 終止時遺留的 claim 歸還為 pending，再依事件 ID 順序重跑。
 * 只認帶 captureId 的事件——這不只是為了不動到歷史資料（v10 遷移前的舊列 postProcessState
 * 是 undefined，本來就不會命中下面的查詢），更是因為 `persistIngestedEvent` 讓沒有
 * captureId 的事件也能進入這個狀態機時，明講了「沒有跨 retry 去重保證」：captureId 正是
 * recovery 敢重跑 postProcess 而不怕副作用重複執行（重複通知等）的依據，沒有它就沒有這個
 * 安全網。故沒有 captureId 的事件卡在 pending/processing 時寧可放著不管，也不要冒著重複
 * 副作用的風險去重跑——這是刻意的取捨，不是遺漏（`tests/background-ingestion-lifecycle.test.ts`
 * 有專門測資鎖住這個行為，別為了「不留孤兒事件」把這層過濾拿掉）。
 */
export async function recoverPendingPostProcessing(
    dependencies: BackgroundIngestionLifecycleDependencies,
): Promise<void> {
    const { db } = dependencies;

    // 同一個 readwrite transaction 內只歸還可識別的 processing claim，避免動到歷史資料。
    await db.transaction('rw', db.events, async () => {
        await db.events
            .where('postProcessState')
            .equals('processing')
            .filter(hasCaptureId)
            .modify({ postProcessState: 'pending' });
    });

    const pending = (await db.events
        .where('postProcessState')
        .equals('pending')
        .filter(hasCaptureId)
        .sortBy('id')) as PersistedEventRow[];

    // 沿用 Batch 2.3 的 persist → claim → post-process 狀態機；任何一筆失敗都會由
    // helper 歸還 pending 並中止，不能越過它處理後面的副作用。
    for (const event of pending) {
        await ingestWithPostProcessing(event, dependencies);
    }
}

/**
 * 單一 service worker 生命週期的 ingestion 閘門。recovery 與後續每筆 ingestion 共用
 * 同一條 promise queue，因此較後事件的副作用不可能超前較前事件完成。
 */
export class BackgroundIngestionLifecycle {
    readonly recoveryPromise: Promise<void>;
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly dependencies: BackgroundIngestionLifecycleDependencies) {
        this.recoveryPromise = this.enqueue(() => recoverPendingPostProcessing(this.dependencies));
    }

    ingest(row: ApiEventRow): Promise<number> {
        return this.enqueue(async () => {
            // recovery 失敗時拒絕新 ingestion，保留其原始 event 等下次 SW 啟動處理。
            await this.recoveryPromise;
            return ingestWithPostProcessing(row, this.dependencies);
        });
    }

    private enqueue<T>(work: () => Promise<T>): Promise<T> {
        const result = this.queue.then(work);
        // queue 本身要能繼續排入工作；是否可處理仍由 recoveryPromise 的結果決定。
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
}
