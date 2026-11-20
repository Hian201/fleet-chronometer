// 匯入／還原路徑的效能與健壯性：時間桶去重與線性比對等價、備份只驗證一次、深層巢狀 JSON 的拒絕方式。
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb, type FactoryLogRow, type SortieLogRow } from '../utils/db';
import { importDropLogRows, type ParsedDropRow } from '../utils/drop-log-import';
import { importBuildLogRows, type ParsedBuildRow } from '../utils/build-log-import';
import { TimeBucketIndex } from '../utils/time-bucket-index';
import {
    BackupValidationError, buildFullEnvelope, combineBackupEnvelopes, parseBackupJson, restoreBackup,
    validateBackupEnvelope,
} from '../utils/backup';
import { SortieImportError, packetHash, stableSerialize } from '../utils/sortie-import';

const databases: KcDb[] = [];
let serial = 0;
function createDb() {
    const database = new KcDb(`kc-import-hardening-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}
afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

const MIN = 60 * 1000;
const T0 = Date.parse('2026-07-23T12:00:00Z');

describe('TimeBucketIndex 與線性 some 等價', () => {
    it('隨機資料（含剛好等於容差與桶邊界）的判斷結果完全一致', () => {
        const tolerance = 10 * MIN;
        let seed = 12345;
        const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        type Item = { key: string; ts: number };
        const index = new TimeBucketIndex<Item>(tolerance, r => r.key, r => r.ts);
        const all: Item[] = [];
        const near = (q: Item) => (e: Item) => e.key === q.key && Math.abs(q.ts - e.ts) <= tolerance;
        for (let i = 0; i < 2000; i++) {
            // 刻意把時間壓在少數桶上，並混入剛好落在容差邊界的值。
            const ts = T0 + Math.round((rand() * 6 - 3) * tolerance) + (rand() < 0.2 ? tolerance : 0);
            const probe: Item = { key: rand() < 0.5 ? 'a' : 'b', ts };
            expect(index.some(probe.key, probe.ts, near(probe))).toBe(all.some(near(probe)));
            if (rand() < 0.5) { index.add(probe); all.push(probe); }
        }
    });

    it('容差上下界：剛好 10 分鐘算重複，多 1 毫秒不算', () => {
        const index = new TimeBucketIndex<{ ts: number }>(10 * MIN, () => 'k', r => r.ts);
        index.add({ ts: T0 });
        const hit = (ts: number) => index.some('k', ts, e => Math.abs(ts - e.ts) <= 10 * MIN);
        expect(hit(T0 + 10 * MIN)).toBe(true);
        expect(hit(T0 - 10 * MIN)).toBe(true);
        expect(hit(T0 + 10 * MIN + 1)).toBe(false);
        expect(hit(T0 - 10 * MIN - 1)).toBe(false);
    });
});

describe('importDropLogRows 去重與借號', () => {
    const parsed = (over: Partial<ParsedDropRow> = {}): ParsedDropRow => ({
        ts: T0, map: '6-5', node: 0, boss: true, rank: 'S', drop: '長波', dropMst: 135, ...over,
    });

    it('既有資料與同批次內都去重；event ID 逐列連號、不留 raw event', async () => {
        const database = createDb();
        const existing: SortieLogRow = {
            eventId: 100, sortieKey: 100, ts: T0, map: '6-5', node: 53, boss: true, kind: 'battle', rank: 'S',
            seiku: 1, enemyIds: [1], enemyIdsEscort: [], drop: '長波', dropMst: 135, taiha: false,
        };
        await database.sorties.put(existing);
        const result = await importDropLogRows(database, [
            parsed({ ts: T0 + 10 * MIN }),                         // 容差邊界：重複既有
            parsed({ ts: T0 + 10 * MIN + 1, drop: '雪風', dropMst: 20 }),  // 超出容差且不同艦：新增
            parsed({ ts: T0 + 10 * MIN + 2, drop: '雪風', dropMst: 20 }),  // 同批次內重複
            parsed({ map: '1-1', ts: T0, drop: '雪風', dropMst: 20 }),     // 不同海域：新增
        ]);
        expect(result).toEqual({ added: 2, duplicates: 2 });
        const rows = await database.sorties.orderBy('eventId').toArray();
        expect(rows.filter(r => r.imported).map(r => r.eventId)).toEqual([1, 2]);
        expect(await database.events.count()).toBe(0);
    });
});

describe('importBuildLogRows 去重', () => {
    const parsed = (over: Partial<ParsedBuildRow> = {}): ParsedBuildRow => ({
        ts: T0, kind: 'build', used: [30, 30, 30, 30, 0, 0, 1], shipMst: 135, ...over,
    });

    it('同 kind＋容差內＋同資材才算重複；不同 kind 或超出 2 分鐘不算', async () => {
        const database = createDb();
        const existing: FactoryLogRow = { eventId: 100, ts: T0, kind: 'build', used: [30, 30, 30, 30, 0, 0, 1], shipMst: 135, secretary: 0 };
        await database.factory.put(existing);
        const result = await importBuildLogRows(database, [
            parsed({ ts: T0 + 2 * MIN }),            // 邊界：重複
            parsed({ ts: T0 + 2 * MIN + 1 }),        // 超出容差：新增
            parsed({ kind: 'speedup' }),             // 不同 kind：新增
            parsed({ ts: T0 + 2 * MIN + 1 }),        // 與剛新增的那列重複
        ]);
        expect(result).toEqual({ added: 2, duplicates: 2 });
        expect((await database.factory.toArray()).map(r => r.eventId).sort((a, b) => a - b)).toEqual([1, 2, 100]);
        expect(await database.events.count()).toBe(0);
    });
});

describe('備份只驗證一次', () => {
    async function validatedEmpty() {
        const source = createDb();
        await source.open();
        return parseBackupJson(JSON.stringify(await buildFullEnvelope(source)));
    }

    // 驗證時會讀 envelope.schemaVersion；在已驗證物件上掛計數器，就能看出有沒有被重驗。
    function countSchemaReads(envelope: object) {
        const counter = { reads: 0 };
        const value = (envelope as { schemaVersion: number }).schemaVersion;
        Object.defineProperty(envelope, 'schemaVersion', { get: () => { counter.reads++; return value; }, configurable: true });
        return counter;
    }

    it('已驗證的 envelope 經 combine／restore 不再重驗，restore 仍成功', async () => {
        const validated = await validatedEmpty();
        const counter = countSchemaReads(validated);
        const combined = combineBackupEnvelopes([validated]);
        expect(combined).toBe(validated);
        const target = createDb();
        await target.open();
        await restoreBackup(target, validated);
        expect(counter.reads).toBe(0);
    });

    it('同形的原始物件（非 validateBackupEnvelope 產物）一律完整驗證', async () => {
        const validated = await validatedEmpty();
        const forged = { ...validated };
        const counter = countSchemaReads(forged);
        combineBackupEnvelopes([forged]);
        expect(counter.reads).toBeGreaterThan(0);
    });

    it('restoreBackup 對原始不合法輸入仍拒絕且不寫入', async () => {
        const target = createDb();
        await target.open();
        const bad = { schemaVersion: 12, kind: 'full', exportedAt: T0, tables: { sorties: [{ eventId: 'x' }] } };
        await expect(restoreBackup(target, bad)).rejects.toBeInstanceOf(BackupValidationError);
        expect(await target.sorties.count()).toBe(0);
    });

    it('validateBackupEnvelope 公開入口每次都重驗（傳入已驗證物件也一樣）', async () => {
        const validated = await validatedEmpty();
        const counter = countSchemaReads(validated);
        validateBackupEnvelope(validated);
        expect(counter.reads).toBeGreaterThan(0);
    });
});

describe('stableSerialize 深度上限', () => {
    const nest = (depth: number, wrap: (inner: unknown) => unknown) => {
        let value: unknown = 1;
        for (let i = 0; i < depth; i++) value = wrap(value);
        return value;
    };

    it('極深的巢狀陣列／物件丟 SortieImportError，而不是 RangeError', () => {
        expect(() => stableSerialize(nest(200_000, v => [v]))).toThrow(SortieImportError);
        expect(() => stableSerialize(nest(200_000, v => ({ a: v })))).toThrow(SortieImportError);
        expect(() => packetHash([{ node: 1, data: nest(200_000, v => [v]) }])).toThrow(SortieImportError);
    });

    it('一般深度的輸出不變', () => {
        expect(stableSerialize({ b: [1, { d: 2, c: null }], a: 'x' })).toBe('{"a":"x","b":[1,{"c":null,"d":2}]}');
        expect(() => stableSerialize(nest(60, v => [v]))).not.toThrow();
    });
});
