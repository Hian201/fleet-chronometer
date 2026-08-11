import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    addMembers, createGroup, deleteGroup, filterByGroup, ORDER_GROUPS_KEY,
    parseOrderGroups, removeMembers, saveOrderGroups, loadOrderGroups,
} from '../utils/order-groups';

/** node 環境沒有 localStorage；掛最小假實作測往返。 */
function installStorage(): void {
    const map = new Map<string, string>();
    const storage = {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
        clear: () => { map.clear(); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

beforeEach(() => { installStorage(); });
afterEach(() => {
    try { delete (globalThis as { localStorage?: unknown }).localStorage; } catch { /* ignore */ }
});

describe('parseOrderGroups', () => {
    it('丟棄壞列、去重 id、正規化 memberIds', () => {
        const rows = parseOrderGroups([
            { id: 'a', name: '甲', memberIds: [3, 1, 1, -2, 'x'] },
            { id: 'a', name: '重複', memberIds: [9] },
            { id: '', name: '空', memberIds: [] },
            null,
            { id: 'b', name: ' 乙 ', memberIds: [] },
        ]);
        expect(rows).toEqual([
            { id: 'a', name: '甲', memberIds: [3, 1] },
            { id: 'b', name: '乙', memberIds: [] },
        ]);
    });

    it('非陣列回空', () => {
        expect(parseOrderGroups(null)).toEqual([]);
        expect(parseOrderGroups({})).toEqual([]);
    });
});

describe('組別 CRUD', () => {
    it('建立／加入／移出／篩選／刪除', () => {
        const created = createGroup([], '輸送', [10, 20]);
        expect('error' in created).toBe(false);
        if ('error' in created) return;
        let groups = created.groups;
        expect(groups[0].memberIds).toEqual([10, 20]);

        groups = addMembers(groups, created.id, [20, 30]);
        expect(groups[0].memberIds).toEqual([10, 20, 30]);

        groups = removeMembers(groups, created.id, [20, 99]);
        expect(groups[0].memberIds).toEqual([10, 30]);
        // 未知組：不動
        expect(removeMembers(groups, 'missing', [10])).toEqual(groups);

        const ships = [{ id: 10 }, { id: 99 }, { id: 30 }];
        expect(filterByGroup(ships, groups, created.id).map(s => s.id)).toEqual([10, 30]);
        expect(filterByGroup(ships, groups, 'missing')).toEqual([]);

        groups = deleteGroup(groups, created.id);
        expect(groups).toEqual([]);
    });

    it('空名／重名拒絕', () => {
        expect(createGroup([], '  ', [])).toEqual({ error: 'empty' });
        const a = createGroup([], '甲', []);
        if ('error' in a) throw new Error('unexpected');
        expect(createGroup(a.groups, '甲', [])).toEqual({ error: 'exists' });
    });

    it('localStorage 往返', () => {
        saveOrderGroups([{ id: 'g1', name: '夜戰', memberIds: [1] }]);
        expect(loadOrderGroups()).toEqual([{ id: 'g1', name: '夜戰', memberIds: [1] }]);
        localStorage.setItem(ORDER_GROUPS_KEY, '{not json');
        expect(loadOrderGroups()).toEqual([]);
    });
});
