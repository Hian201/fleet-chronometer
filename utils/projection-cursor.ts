import type { DatabaseMetaRow, KcDb } from './db';

export const PROJECTION_META_KEY = 'projection' as const;
// Batch 3.2：SortieLogRow 投影新增 battle-result 的 dropMst，舊 cursor 必須重投影 retained events。
export const PROJECTION_META_VERSION = 3 as const;

// 裁剪屬破壞性操作，只有已知版本且游標格式完整的 metadata 才能作為刪除上限。
// undefined 與 0 必須區分：0 是有效的「尚未投影任何事件」，undefined 則是不能裁剪。
export function validProjectionThroughEventId(metadata: DatabaseMetaRow | undefined): number | undefined {
    if (metadata?.key !== PROJECTION_META_KEY || metadata.version !== PROJECTION_META_VERSION) return undefined;
    return Number.isSafeInteger(metadata.throughEventId) && metadata.throughEventId >= 0
        ? metadata.throughEventId
        : undefined;
}

// metadata 缺少、版本未知或內容損壞時一律從 0 開始；無法證實的投影進度不作推定。
export function projectionCursorValue(metadata: DatabaseMetaRow | undefined): number {
    return validProjectionThroughEventId(metadata) ?? 0;
}

export async function readProjectionCursor(database: Pick<KcDb, 'meta'>): Promise<number> {
    return projectionCursorValue(await database.meta.get(PROJECTION_META_KEY));
}

// 每次 persist event 的所有 derived writes 成功後才呼叫。read + max + put 放在同一個
// metadata transaction，避免兩個本機 panel 同時存在時由較舊的寫入把游標往回推。
export async function advanceProjectionCursor(
    database: KcDb,
    eventId: number,
    updatedAt = Date.now(),
): Promise<number> {
    if (!Number.isSafeInteger(eventId) || eventId < 0) {
        throw new Error(`無效的 projection event ID：${eventId}`);
    }

    return database.transaction('rw', database.meta, async () => {
        const stored = await database.meta.get(PROJECTION_META_KEY);
        const current = projectionCursorValue(stored);
        const throughEventId = Math.max(current, eventId);

        // 已由另一個寫入者推進到相同或更後面時不重寫 updatedAt。
        if (stored?.key === PROJECTION_META_KEY
            && stored.version === PROJECTION_META_VERSION
            && current >= eventId) return current;

        await database.meta.put({
            key: PROJECTION_META_KEY,
            version: PROJECTION_META_VERSION,
            throughEventId,
            updatedAt,
        });
        return throughEventId;
    });
}
