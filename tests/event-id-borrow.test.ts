// utils/event-id-borrow.ts：借 event ID 的合約（只推進 key generator、不留佔位 row）。
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb } from '../utils/db';
import { borrowEventId } from '../utils/event-id-borrow';

const databases: KcDb[] = [];
let serial = 0;
function createDb() {
    const database = new KcDb(`kc-event-id-borrow-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}
afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('borrowEventId', () => {
    it('連續借用回傳遞增的 id，且 transaction 結束後 events 表仍為空', async () => {
        const database = createDb();
        const ids = await database.transaction('rw', database.events, async () => {
            const a = await borrowEventId(database.events, 'test:a');
            const b = await borrowEventId(database.events, 'test:b');
            const c = await borrowEventId(database.events, 'test:c');
            return [a, b, c];
        });
        expect(ids[0]).toBeGreaterThanOrEqual(1);
        expect(ids[1]).toBeGreaterThan(ids[0]);
        expect(ids[2]).toBeGreaterThan(ids[1]);
        expect(await database.events.count()).toBe(0);
    });

    it('借過的 id 不會被之後真正寫入的 raw event 重用', async () => {
        const database = createDb();
        const borrowed = await database.transaction('rw', database.events,
            () => borrowEventId(database.events, 'test:borrow'));
        const realId = await database.events.add({ ts: 1, path: '/kcsapi/api_port/port', api: null, req: {} });
        expect(realId).toBeGreaterThan(borrowed);
    });

    it('已有資料時借到的 id 接在現有最大 id 之後', async () => {
        const database = createDb();
        const existing = await database.events.add({ ts: 1, path: '/x', api: null, req: {} });
        const borrowed = await database.transaction('rw', database.events,
            () => borrowEventId(database.events, 'test:after'));
        expect(borrowed).toBeGreaterThan(existing);
        expect(await database.events.count()).toBe(1);
    });

    it('explicitId：直接借用指定 id，且同樣不留下 row，之後的 auto id 接續其後', async () => {
        const database = createDb();
        const id = await database.transaction('rw', database.events,
            () => borrowEventId(database.events, 'test:explicit', { explicitId: 500 }));
        expect(id).toBe(500);
        expect(await database.events.count()).toBe(0);
        const next = await database.events.add({ ts: 1, path: '/x', api: null, req: {} });
        expect(next).toBeGreaterThan(500);
    });

    it('explicitId 不做範圍檢查（呼叫端已驗證）', async () => {
        const database = createDb();
        const id = await database.transaction('rw', database.events,
            () => borrowEventId(database.events, 'test:explicit-big', { explicitId: 9_000_000_000 }));
        expect(id).toBe(9_000_000_000);
    });

    it('佔位 row 的 path 使用呼叫端給的 debugPath', async () => {
        const database = createDb();
        let seen: string | undefined;
        database.events.hook('creating', (_key, obj) => { seen = obj.path; });
        await database.transaction('rw', database.events,
            () => borrowEventId(database.events, 'test:debug-path'));
        expect(seen).toBe('test:debug-path');
    });

    // 用假 table 模擬 key generator 超出安全整數範圍（真 IndexedDB 無法實際推到那裡）。
    const fakeTable = (id: number) => {
        const deleted: number[] = [];
        const table = {
            add: async () => id,
            delete: async (k: number) => { deleted.push(k); },
        };
        return { table: table as unknown as Parameters<typeof borrowEventId>[0], deleted };
    };

    it('auto id 超出安全整數時呼叫 onOverflow，且不刪除任何 row', async () => {
        const { table, deleted } = fakeTable(Number.MAX_SAFE_INTEGER + 2);
        await expect(borrowEventId(table, 'test:overflow', {
            onOverflow: (message) => { throw new RangeError(`匯入失敗：${message}`); },
        })).rejects.toThrow(/匯入失敗：events key generator/);
        expect(deleted).toEqual([]);
    });

    it('未提供 onOverflow 時拋通用 Error', async () => {
        const { table } = fakeTable(Number.MAX_SAFE_INTEGER + 2);
        await expect(borrowEventId(table, 'test:overflow')).rejects.toThrow('events key generator 已超出安全整數範圍。');
    });

    it('auto id 小於 1 或非整數同樣視為溢位', async () => {
        for (const bad of [0, -1, 1.5, Number.NaN]) {
            const { table } = fakeTable(bad);
            await expect(borrowEventId(table, 'test:bad')).rejects.toThrow('已超出安全整數範圍');
        }
    });
});
