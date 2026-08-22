// 節點類型（`api_event_id`／`api_event_kind`）→ i18n key —— 純函式，無 chrome.*。
//
// **這兩個欄位是封包事實**（`api_req_map/start`／`next` 直接給），與需要外部對照表的「節點字母」
// 完全不同層次：字母不在封包裡（見 utils/map-node-letters.ts），類型在。
//
// ── 對照來源與驗證狀態 ──────────────────────────────────────────────
// `api_event_id` 的語意轉寫自航海日誌拡張版（Nishisonic/logbook，MIT）的
// `MapCellDto.getNextKind()`；`api_event_kind` 的三個值另有本專案樣本的獨立佐證——
// KC3Kai 匯出的 `nodes[].desc` 與同一筆 `eventKind` 對得上：
//   · eventKind 1 → 一般戰鬥（61-5 的節點 1／15／52，封包 `fc_battle_water`）
//   · eventKind 5 → 敵連合艦隊（61-3 節點 53、61-5 節點 55，desc「深海聯合艦隊」）
//   · eventKind 6 → 空襲戰（61-3 節點 50、61-5 節點 48／37／51，desc「空襲」，封包 `fc_ld_airbattle`）
// **其餘 eventKind（2/3/4…）沒有樣本佐證，一律回 null 不猜**——寧可少顯示一個標籤，
// 也不要把未驗證值標成錯誤的節點類型。
export const NODE_KIND_KEYS = {
    resource: 'node.resource',
    maelstrom: 'node.maelstrom',
    noEnemy: 'node.noEnemy',
    branch: 'node.branch',
    nothing: 'node.nothing',
    airRecon: 'node.airRecon',
    airBattle: 'node.airBattle',
    escortSuccess: 'node.escortSuccess',
    landing: 'node.landing',
    airRaid: 'node.airRaid',
    enemyCombined: 'node.enemyCombined',
} as const;

/**
 * 節點類型的 i18n key。回 null 代表「一般戰鬥／boss 或無法判定」——那兩者本來就另有標記
 * （rank、BOSS 徽章），再標一次只是雜訊。
 */
export function nodeKindKey(eventId: number | undefined, eventKind: number | undefined): string | null {
    if (!Number.isSafeInteger(eventId as number)) return null;
    switch (eventId) {
        case 2: return NODE_KIND_KEYS.resource;        // 資源獲得
        case 3: return NODE_KIND_KEYS.maelstrom;       // 渦潮
        case 6:                                        // 何も無い：kind 依序為 敵影を見ず／能動分岐
            return eventKind === 1 ? NODE_KIND_KEYS.noEnemy
                : eventKind === 2 ? NODE_KIND_KEYS.branch
                    : NODE_KIND_KEYS.nothing;
        case 7:                                        // 航空：kind 0 為偵察，其餘為航空戰
            return eventKind === 0 ? NODE_KIND_KEYS.airRecon : NODE_KIND_KEYS.airBattle;
        case 8: return NODE_KIND_KEYS.escortSuccess;   // 船團護衛成功
        case 9: return NODE_KIND_KEYS.landing;         // 揚陸地點
        case 4: case 5:                                // 戰鬥／boss：只認有樣本佐證的 kind
            return eventKind === 6 ? NODE_KIND_KEYS.airRaid
                : eventKind === 5 ? NODE_KIND_KEYS.enemyCombined
                    : null;
        default: return null;
    }
}
