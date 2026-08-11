// 調度分頁艦種分組（對齊遊戲編成快篩縮寫）。
// 純函式；未命中明確組 → aux（AV/AO/AS…）。

export interface OrderStypeGroup {
    id: string;
    /** 顯示縮寫（BB/BC、CV/CVL…）；三語共用遊戲慣用縮寫，不走 i18n。 */
    label: string;
    stypeIds: number[];
}

export const ORDER_STYPE_GROUPS: readonly OrderStypeGroup[] = [
    { id: 'bb', label: 'BB / BC', stypeIds: [8, 9, 10] },
    { id: 'cv', label: 'CV / CVL', stypeIds: [7, 11, 18] },
    { id: 'ca', label: 'CA', stypeIds: [5, 6] },
    { id: 'cl', label: 'CL', stypeIds: [3, 4] },
    { id: 'dd', label: 'DD', stypeIds: [2] },
    { id: 'de', label: 'DE', stypeIds: [1] },
    { id: 'ss', label: 'SS', stypeIds: [13, 14] },
    { id: 'aux', label: 'AV / AO / AS…', stypeIds: [] },
] as const;

export function orderStypeGroupOf(stypeId: number): string {
    for (const g of ORDER_STYPE_GROUPS) {
        if (g.id === 'aux') continue;
        if (g.stypeIds.includes(stypeId)) return g.id;
    }
    return 'aux';
}

/** 單選艦種組 → ship-filter 的 stypeIds 白名單；all／未知 → 空＝不限。 */
export function stypeIdsForOrderGroup(groupId: string): number[] {
    if (!groupId || groupId === 'all') return [];
    const g = ORDER_STYPE_GROUPS.find(x => x.id === groupId);
    if (!g) return [];
    if (g.id === 'aux') {
        // 其餘艦種：回傳「非明確組」無法用白名單表達，呼叫端改用 orderStypeGroupOf 判定。
        return [];
    }
    return [...g.stypeIds];
}

export function matchOrderStype(stypeId: number, groupId: string): boolean {
    if (!groupId || groupId === 'all') return true;
    return orderStypeGroupOf(stypeId) === groupId;
}
