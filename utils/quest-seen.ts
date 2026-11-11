// 本機觀測到出現在任務清單（questlist）的任務。
//
// 任務出現在清單＝它的單發前置必定已完成；單發任務完成後不會變回未完成，所以這份證據
// 永久有效，重裝＋還原後不必重新開任務清單，也不必手動標記。與 questObserved 同層落在
// background：只需要封包本身、不需要 GameState，面板沒開的那幾天也要記。
//
// 只存「看過」的證據，不存推論結論：推論規則（哪些前置可推、期間限定不當起點）在
// quest-flow.ts，規則修正後舊證據仍能重新解讀。
import type { QuestSeenRow } from './db';

const QUESTLIST_PATH = 'api_get_member/questlist';

export interface QuestSeenTables {
    questSeen: {
        get(questNo: number): PromiseLike<QuestSeenRow | undefined>;
        put(row: QuestSeenRow): PromiseLike<unknown>;
    };
}

export interface QuestListEvent {
    id: number;
    ts: number;
    path: string;
    api: unknown;
}

export interface ListedQuest {
    no: number;
    /** 遊戲送來的標題與說明；不是字串時不記。 */
    title?: string;
    detail?: string;
}

/** questlist 封包裡受注中／達成／可接受（api_state 1–3）的任務；空欄 -1 與異常列略過，依編號排序。 */
export function listedQuests(path: string, api: unknown): ListedQuest[] {
    if (path !== QUESTLIST_PATH || !api || typeof api !== 'object') return [];
    const list = (api as { api_list?: unknown }).api_list;
    if (!Array.isArray(list)) return [];
    const quests = new Map<number, ListedQuest>();
    for (const quest of list) {
        if (!quest || typeof quest !== 'object') continue;
        const { api_no: no, api_state: state, api_title: title, api_detail: detail } =
            quest as { api_no?: unknown; api_state?: unknown; api_title?: unknown; api_detail?: unknown };
        if (typeof no !== 'number' || !Number.isSafeInteger(no) || no < 1) continue;
        if (state !== 1 && state !== 2 && state !== 3) continue;
        quests.set(no, {
            no,
            ...(typeof title === 'string' && title ? { title } : {}),
            ...(typeof detail === 'string' && detail ? { detail } : {}),
        });
    }
    return [...quests.values()].sort((a, b) => a.no - b.no);
}

/** questlist 封包裡受注中／達成／可接受（api_state 1–3）的任務編號。 */
export function listedQuestNos(path: string, api: unknown): number[] {
    return listedQuests(path, api).map(quest => quest.no);
}

/**
 * 合併一次觀測；以 min／max 取最早與最近，重跑同一筆事件結果不變。
 * 標題與說明保留最近一次觀測的版本（營運重用編號時是最新的任務）；先前沒有文字時以這次補上。
 */
export function mergeQuestSeen(
    previous: QuestSeenRow | undefined,
    questNo: number,
    eventId: number,
    ts: number,
    text: { title?: string; detail?: string } = {},
): QuestSeenRow {
    const own = {
        ...(text.title ? { title: text.title } : {}),
        ...(text.detail ? { detail: text.detail } : {}),
    };
    if (!previous) return { questNo, firstTs: ts, lastTs: ts, firstEventId: eventId, lastEventId: eventId, ...own };
    const earlier = ts < previous.firstTs || (ts === previous.firstTs && eventId < previous.firstEventId);
    const later = ts > previous.lastTs || (ts === previous.lastTs && eventId > previous.lastEventId);
    const useOwn = text.title !== undefined && (later || previous.title === undefined);
    const kept = {
        ...(previous.title !== undefined ? { title: previous.title } : {}),
        ...(previous.detail !== undefined ? { detail: previous.detail } : {}),
    };
    return {
        questNo,
        firstTs: earlier ? ts : previous.firstTs,
        firstEventId: earlier ? eventId : previous.firstEventId,
        lastTs: later ? ts : previous.lastTs,
        lastEventId: later ? eventId : previous.lastEventId,
        ...(useOwn ? own : kept),
    };
}

export async function captureQuestSeen(tables: QuestSeenTables, event: QuestListEvent): Promise<void> {
    for (const quest of listedQuests(event.path, event.api)) {
        const previous = await tables.questSeen.get(quest.no);
        const next = mergeQuestSeen(previous, quest.no, event.id, event.ts, quest);
        if (previous
            && previous.firstTs === next.firstTs && previous.lastTs === next.lastTs
            && previous.firstEventId === next.firstEventId && previous.lastEventId === next.lastEventId
            && previous.title === next.title && previous.detail === next.detail) continue;
        await tables.questSeen.put(next);
    }
}

export interface QuestSeenSink {
    ingestArchivedQuestSeen(questNo: number, text?: { title?: string; detail?: string; ts?: number }): void;
}

/** 把已裁剪或只存在備份的觀測補進 GameState；集合語意，重複送入無副作用。 */
export function applyArchivedQuestSeen(sink: QuestSeenSink, rows: readonly QuestSeenRow[]): void {
    for (const row of rows) {
        sink.ingestArchivedQuestSeen(row.questNo, row.title ? { title: row.title, detail: row.detail, ts: row.lastTs } : undefined);
    }
}
