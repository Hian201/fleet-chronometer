// 本機觀測到的任務領獎（clearitemget）。
//
// 為什麼落在 background 而不是 EventProjector：領獎證據只需要 req.api_quest_id 與
// 事件時間，不需要 GameState 上下文；面板沒開的那幾天若漏記，還原／裁剪後就無法證明
// 「這期日任／週任已經領過」。與 snapshot、resources 同層，put 以 eventId 冪等。
//
// 循環任務不另存「本期已完成」旗標：還原後用領獎時間對日本時間 05:00 的週期邊界比對
// （見 quest-flow.ts）。年任的開始月尚未進目錄，故只保存紀錄、不自行對齊年度週期。
import type { QuestObservedRow } from './db';

export interface QuestObservedTables {
    questObserved: { put(row: QuestObservedRow): PromiseLike<unknown> };
}

export interface QuestClaimEvent {
    id: number;
    ts: number;
    path: string;
    req?: Record<string, string>;
}

export function readQuestClaim(path: string, req: Record<string, string> | undefined): number | null {
    if (path !== 'api_req_quest/clearitemget') return null;
    const questNo = Number(req?.api_quest_id);
    if (!Number.isSafeInteger(questNo) || questNo < 1) return null;
    return questNo;
}

export async function captureQuestObserved(
    tables: QuestObservedTables,
    event: QuestClaimEvent,
): Promise<void> {
    const questNo = readQuestClaim(event.path, event.req);
    if (questNo === null) return;
    await tables.questObserved.put({ eventId: event.id, questNo, ts: event.ts });
}

export interface QuestObservedSink {
    ingestArchivedQuestClaim(questNo: number, ts: number): void;
}

/** 把已裁剪或不在本次重播範圍內的領獎列補進 GameState；已重播過的 eventId 不重複計數。 */
export function applyArchivedQuestObservations(
    sink: QuestObservedSink,
    rows: readonly QuestObservedRow[],
    appliedEventIds: ReadonlySet<number>,
): void {
    for (const row of rows) {
        if (appliedEventIds.has(row.eventId)) continue;
        sink.ingestArchivedQuestClaim(row.questNo, row.ts);
    }
}
