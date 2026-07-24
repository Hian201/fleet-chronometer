// 節點字母（A／B／…／ZZ）的查表 —— 純函式，無 chrome.*。
//
// ── 為什麼一定要查表：`api_no` 是「路線段」不是「格子」──────────────
// 進軍／戰鬥封包給的 `api_no`（本專案存成 `SortieLogRow.node`）是**路線段（edge）id**。
// KC3Kai 的 edges.json 一筆 edge 對到 `[起點字母, 終點字母]`，我們要的是終點字母；
// 而且**多個 edge 會對到同一個字母**（同一節點從不同方向進入，例：6-5 的 C／G／H／I／M
// 各有兩條 edge）。所以「編號 → 字母」是多對一，**不可能由編號推算**：
//
//   61-5 實測（使用者提供，與 edges.json 逐筆相符）
//   edge    1   48   15   37   51   52   55
//   letter  A    E    I    Q    Y    Z   ZZ
//
//   · `String.fromCharCode(64 + id)`：15 會算成 O（實際 I），48 以上變小寫亂碼。
//   · 「該圖 edge 由小到大排序後依序給字母」：48 排在 37 之後，但 48=E 在 37=Q 之前。
//
// ── 為什麼不是從 `api_get_master/mapcell` 推導 ────────────────────────
// 那類 master 端點給的是**格子**（`api_id` 全海域通號／`api_no` 同海域內編號／顏色…），
// 沒有字母、也不是我們手上的 edge id；字母本身是攻略圈的命名慣例，不在任何封包裡。
// 詳見 CLAUDE.md「節點字母」。
import { EDGE_LETTERS } from './map-edge-letters';

/**
 * 少數海域的人工覆蓋（新活動開圖當下對照表還沒更新，或發現來源有誤時暫時墊著）。
 * 平時應該是空的——正解是更新 `tools/map-edges/edges.json` 後重跑產生器。
 */
export const EDGE_LETTER_OVERRIDES: Record<string, Record<number, string>> = {};

/** 查該圖某 edge 的節點字母。沒有對照就回 null（呼叫端顯示原始編號）。 */
export function nodeLetter(map: string, edge: number): string | null {
    if (!Number.isSafeInteger(edge) || edge <= 0) return null;
    return EDGE_LETTER_OVERRIDES[map]?.[edge] ?? EDGE_LETTERS[map]?.[edge] ?? null;
}

/** 顯示用標籤：有對照給字母，沒有給原始 edge 編號（`?` 為連編號都沒有）。 */
export function nodeLabel(map: string, edge: number): string {
    if (!Number.isSafeInteger(edge) || edge <= 0) return '?';
    return nodeLetter(map, edge) ?? String(edge);
}

/** 這張圖有沒有對照資料（UI 用來決定要不要說明「此海域尚無字母對照」）。 */
export function hasNodeLetters(map: string): boolean {
    return Object.keys(EDGE_LETTER_OVERRIDES[map] ?? EDGE_LETTERS[map] ?? {}).length > 0;
}
