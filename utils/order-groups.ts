// 調度分頁的自訂艦娘組別（純函式＋localStorage 讀寫契約）。
//
// 組別是使用者手建的配船捷徑，不是封包衍生資料——存 localStorage（`kc-order-groups`），
// 不進 Dexie、不進備份（同艦娘全覽的欄位偏好 `kc-ships-view`）。
// memberIds 是艦**實例** id（api_ship.api_id），不是 master id——同名多號機要能分開標記。

export const ORDER_GROUPS_KEY = 'kc-order-groups';

export interface OrderGroup {
    id: string;
    name: string;
    /** 艦實例 id。 */
    memberIds: number[];
}

export function emptyGroups(): OrderGroup[] {
    return [];
}

/** 從未知 JSON 正規化；壞資料丟棄該筆，不整批失敗。 */
export function parseOrderGroups(raw: unknown): OrderGroup[] {
    if (!Array.isArray(raw)) return [];
    const out: OrderGroup[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const id = typeof r.id === 'string' ? r.id.trim() : '';
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        if (!id || !name || seen.has(id)) continue;
        const memberIds = Array.isArray(r.memberIds)
            ? [...new Set(r.memberIds.filter((x): x is number =>
                typeof x === 'number' && Number.isSafeInteger(x) && x > 0))]
            : [];
        seen.add(id);
        out.push({ id, name, memberIds });
    }
    return out;
}

export function loadOrderGroups(): OrderGroup[] {
    try {
        const text = localStorage.getItem(ORDER_GROUPS_KEY);
        if (!text) return emptyGroups();
        return parseOrderGroups(JSON.parse(text));
    } catch {
        return emptyGroups();
    }
}

export function saveOrderGroups(groups: OrderGroup[]): void {
    localStorage.setItem(ORDER_GROUPS_KEY, JSON.stringify(groups));
}

export function createGroupId(): string {
    return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 把選取的艦加入組；回傳新陣列（不修改輸入）。 */
export function addMembers(groups: OrderGroup[], groupId: string, ids: Iterable<number>): OrderGroup[] {
    const add = new Set(ids);
    return groups.map(g => {
        if (g.id !== groupId) return g;
        const merged = new Set(g.memberIds);
        for (const id of add) if (id > 0) merged.add(id);
        return { ...g, memberIds: [...merged].sort((a, b) => a - b) };
    });
}

/** 把選取的艦移出組；回傳新陣列（不修改輸入）。組不存在時原樣回傳。 */
export function removeMembers(groups: OrderGroup[], groupId: string, ids: Iterable<number>): OrderGroup[] {
    const drop = new Set(ids);
    return groups.map(g => {
        if (g.id !== groupId) return g;
        return { ...g, memberIds: g.memberIds.filter(id => !drop.has(id)) };
    });
}

export function createGroup(
    groups: OrderGroup[], name: string, ids: Iterable<number>,
): { groups: OrderGroup[]; id: string } | { error: 'empty' | 'exists' } {
    const n = name.trim();
    if (!n) return { error: 'empty' };
    if (groups.some(g => g.name === n)) return { error: 'exists' };
    const id = createGroupId();
    const memberIds = [...new Set([...ids].filter(x => x > 0))].sort((a, b) => a - b);
    return { groups: [...groups, { id, name: n, memberIds }], id };
}

export function deleteGroup(groups: OrderGroup[], groupId: string): OrderGroup[] {
    return groups.filter(g => g.id !== groupId);
}

/** 篩選：只留組內成員。組不存在時回空陣列（不可把未知組當「全部」）。 */
export function filterByGroup<T extends { id: number }>(
    ships: T[], groups: OrderGroup[], groupId: string,
): T[] {
    const g = groups.find(x => x.id === groupId);
    if (!g) return [];
    const set = new Set(g.memberIds);
    return ships.filter(s => set.has(s.id));
}
