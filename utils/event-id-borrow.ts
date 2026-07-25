// 共用的「借 event ID」手法：sortie-import.ts／drop-log-import.ts／build-log-import.ts／
// backup.ts 都需要讓匯入或還原的 derived rows 使用不會與未來擷取的 raw event 撞號的 id，
// 但這些路徑本身**不是** raw ingestion（見各檔頭註解），故不可經 background.ts 的
// ingestEvent() 走正常流程，只能直接借用 events table 的 key generator：新增一筆佔位 row、
// 在同一個呼叫端 transaction 內立即刪除，只推進 generator 不回頭，且從不留下任何一筆
// 可被當成本機觀測封包的 raw event（provider 合約例外路徑，見 CLAUDE.md 設計原則 3）。
import type { Table } from 'dexie';
import type { ApiEventRow } from './db';

/**
 * 借一個 event ID。呼叫端必須已在包含 `events` table 的 rw transaction 內執行；
 * 借用後同一 transaction 內立即刪除，不影響最終落地的表內容。
 *
 * - `debugPath`：佔位 row 的 `path`，只供除錯辨識用途（各呼叫端維持各自可辨識的字面字串），
 *   不對應真實 kcsapi path。
 * - `options.explicitId`：省略時借用 auto-increment 產生的下一個 id，並驗證其仍在安全整數
 *   範圍內（超出時呼叫 `options.onOverflow`，未提供則拋通用 Error）；提供時直接借用該 id
 *   （呼叫端須已自行驗證過範圍——例如備份還原延續既有序號時），不重複檢查。
 */
export async function borrowEventId(
    events: Table<ApiEventRow, number>,
    debugPath: string,
    options?: { explicitId?: number; onOverflow?: (message: string) => never },
): Promise<number> {
    const { explicitId, onOverflow } = options ?? {};
    const row: ApiEventRow = {
        ...(explicitId === undefined ? {} : { id: explicitId }),
        ts: 0,
        path: debugPath,
        api: null,
        req: {},
    };
    const id = await events.add(row);
    if (explicitId === undefined && (!Number.isSafeInteger(id) || id < 1)) {
        const message = 'events key generator 已超出安全整數範圍。';
        if (onOverflow) onOverflow(message);
        throw new Error(message);
    }
    await events.delete(id);
    return id;
}
