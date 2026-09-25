// 一般分頁道具清單的釘選（純函式＋localStorage 讀寫契約）。
//
// 釘選是使用者的檢視偏好，不是封包衍生資料——存 localStorage（`kc-item-pins`），
// 不進 Dexie、不進備份（同調度分頁的 `kc-order-groups`）。
// 鍵沿用面板的道具身分字串（`useitem:57`、`material:8`…），以實際 API 來源識別，
// 不用目錄 id，避免同 id 跨來源撞號。持有量歸零時該道具不顯示，但釘選保留。

export const ITEM_PINS_KEY = 'kc-item-pins';

/** 從未知 JSON 正規化；非字串或重複的鍵丟棄，不整批失敗。 */
export function parseItemPins(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((key): key is string => typeof key === 'string' && key.trim() !== ''))];
}

export function loadItemPins(): string[] {
    try {
        const text = localStorage.getItem(ITEM_PINS_KEY);
        return text ? parseItemPins(JSON.parse(text)) : [];
    } catch {
        return [];
    }
}

export function saveItemPins(pins: readonly string[]): void {
    try {
        localStorage.setItem(ITEM_PINS_KEY, JSON.stringify(pins));
    } catch {
        // storage 不可用時釘選只在本次開啟有效，不影響道具清單本身。
    }
}

/** 切換釘選；新釘選的放最後，保留使用者釘選的先後。回傳新陣列（不修改輸入）。 */
export function toggleItemPin(pins: readonly string[], key: string): string[] {
    return pins.includes(key) ? pins.filter(pin => pin !== key) : [...pins, key];
}

/** 釘選項目依釘選先後排在前面，其餘維持原順序（遊戲內欄位順序）。 */
export function sortPinnedFirst<T>(items: readonly T[], keyOf: (item: T) => string, pins: readonly string[]): T[] {
    const rank = new Map(pins.map((key, index) => [key, index]));
    const pinned = items.filter(item => rank.has(keyOf(item)))
        .sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
    return [...pinned, ...items.filter(item => !rank.has(keyOf(item)))];
}
