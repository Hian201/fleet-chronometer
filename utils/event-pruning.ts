import type { ApiEventRow, DatabaseMetaRow, KcDb } from './db';
import { validProjectionThroughEventId } from './projection-cursor';

// 跨登入仍須從原始事件重建的基石封包。數量延續既有 M6 規則；start2 是本批次新增，
// 避免 safety prune 刪掉 cutoff 前最後一筆 master data。
export const KEEP_RECENT: Record<string, number> = {
    'api_start2/getData': 1,
    // 各 tab 整批回傳（2020-03-27 起 API 不分頁）；保留多筆以覆蓋不同分類。
    'api_get_member/questlist': 10,
    'api_get_member/base_air_corps': 1,
    'api_get_member/mapinfo': 1,
    'api_get_member/slot_item': 1,
    'api_get_member/require_info': 1,
    'api_port/port': 1,
};

export interface RawEventPrunePlan {
    candidateEventIds: number[];
    protectedEventIds: Set<number>;
    deleteEventIds: number[];
    throughEventId?: number;
}

function isBeforeCutoff(event: Pick<ApiEventRow, 'id'>, cutoff: number): event is ApiEventRow & { id: number } {
    return event.id !== undefined
        && Number.isSafeInteger(event.id)
        && event.id >= 0
        && event.id < cutoff;
}

// 純函式：集中候選範圍與所有保護規則，測試不需要載入 WXT service worker。
export function planRawEventPrune(
    events: Array<Pick<ApiEventRow, 'id' | 'path'>>,
    wantedEventIds: Iterable<number>,
    cutoff: number,
    metadata: DatabaseMetaRow | undefined,
): RawEventPrunePlan {
    const throughEventId = validProjectionThroughEventId(metadata);
    if (!Number.isSafeInteger(cutoff) || cutoff < 0 || throughEventId === undefined) {
        return { candidateEventIds: [], protectedEventIds: new Set(), deleteEventIds: [] };
    }

    const candidates = events.filter(event => isBeforeCutoff(event, cutoff));
    const protectedEventIds = new Set<number>(wantedEventIds);
    for (const [path, count] of Object.entries(KEEP_RECENT)) {
        candidates
            .filter(event => event.path === path)
            .sort((left, right) => right.id - left.id)
            .slice(0, count)
            .forEach(event => protectedEventIds.add(event.id));
    }

    return {
        candidateEventIds: candidates.map(event => event.id),
        protectedEventIds,
        deleteEventIds: candidates
            .filter(event => event.id <= throughEventId && !protectedEventIds.has(event.id))
            .map(event => event.id),
        throughEventId,
    };
}

export interface RawEventPruneResult {
    removed: number;
    skippedForInvalidProjection: boolean;
    plan: RawEventPrunePlan;
}

// 此函式只會刪 db.events；metadata 與所有 derived tables 都只讀取或完全不碰。
export async function pruneRawEventsBefore(
    database: Pick<KcDb, 'events' | 'wanted' | 'meta'>,
    cutoff: number,
): Promise<RawEventPruneResult> {
    // 必須先確認 cursor，再讀候選或進行任何破壞性操作。
    const metadata = await database.meta.get('projection');
    const throughEventId = validProjectionThroughEventId(metadata);
    if (throughEventId === undefined) {
        return {
            removed: 0,
            skippedForInvalidProjection: true,
            plan: { candidateEventIds: [], protectedEventIds: new Set(), deleteEventIds: [] },
        };
    }

    // 只有 id 同時 < cutoff 且 <= cursor 的事件可能被刪。cursor 為 0（面板從未開過、
    // 投影還沒推進過）或落在整個裁剪窗之前時，這個範圍是空的——舊寫法仍會把 cutoff 以下
    // 的事件（每筆都帶完整封包，超長 session 下可達數千筆）全部讀進 service worker，
    // 算完才發現一筆都不能刪。這裡先用純索引 count 確認範圍非空，再決定要不要載入。
    // 不改變任何裁剪判斷：範圍非空時走的仍是原本那條路。
    const deletableBelow = Math.min(cutoff, throughEventId + 1);
    const deletableInRange = deletableBelow > 0
        ? await database.events.where('id').below(deletableBelow).count()
        : 0;
    if (deletableInRange === 0) {
        return {
            removed: 0,
            skippedForInvalidProjection: false,
            plan: {
                candidateEventIds: [], protectedEventIds: new Set(), deleteEventIds: [], throughEventId,
            },
        };
    }

    const [events, wanted] = await Promise.all([
        database.events.where('id').below(cutoff).toArray(),
        database.wanted.toArray(),
    ]);
    const plan = planRawEventPrune(events, wanted.map(row => row.eventId), cutoff, metadata);
    const removed = plan.deleteEventIds.length;
    if (removed) await database.events.bulkDelete(plan.deleteEventIds);
    return { removed, skippedForInvalidProjection: false, plan };
}
