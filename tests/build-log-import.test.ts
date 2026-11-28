// 建造紀錄 CSV 匯出／匯入（utils/build-log-import.ts）：解析（自家格式＋航海日誌拡張版
// 建造報告書相容）、去重、以及落地時的 event ID 借號。
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb, type FactoryLogRow } from '../utils/db';
import {
    buildLogCsvText, BuildLogImportError, importBuildLogRows, mergeBuildRows, parseBuildLogCsv,
} from '../utils/build-log-import';

const databases: KcDb[] = [];
let serial = 0;
function createDb() {
    const database = new KcDb(`kc-build-log-import-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}
afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

const shipName = (mst: number | undefined) => (mst === 135 ? '長波' : mst === 1 ? '睦月' : '?');

const row = (over: Partial<FactoryLogRow> = {}): FactoryLogRow => ({
    eventId: 1, ts: Date.parse('2026-07-23T12:00:00Z'), kind: 'build',
    used: [1750, 30, 30, 1750, 0, 0, 0, 0], secretary: 1, shipMst: 135, hqLv: 120,
    ...over,
});

describe('parseBuildLogCsv（自家格式，往返）', () => {
    it('匯出再匯入得到相同欄位', () => {
        const csv = buildLogCsvText([row()], shipName);
        const parsed = parseBuildLogCsv(csv);
        expect(parsed.format).toBe('own');
        expect(parsed.skipped).toHaveLength(0);
        expect(parsed.rows).toEqual([{
            ts: row().ts, kind: 'build', used: [1750, 30, 30, 1750, 0, 0, 0, 0],
            shipMst: 135, secretary: 1, hqLv: 120,
        }]);
    });

    it('shipMst 解不出來時改存 shipName 供顯示', () => {
        const csv = buildLogCsvText([row({ shipMst: undefined, importedShipName: '謎の艦' })], shipName);
        const parsed = parseBuildLogCsv(csv);
        expect(parsed.rows[0].shipMst).toBeUndefined();
        expect(parsed.rows[0].shipName).toBe('謎の艦');
    });

    it('kind 欄位不是 build/speedup 的列被跳過並記錄原因', () => {
        const csv = 'ts\tkind\tshipMst\tshipName\tfuel\tammo\tsteel\tbauxite\tdevmat\ttorch\tsecretary\tsecretaryName\thqLv\r\n'
            .replace(/\t/g, ',')
            + '2026-07-23T12:00:00.000Z,develop,0,,0,0,0,0,0,0,0,,\r\n';
        const parsed = parseBuildLogCsv(csv);
        expect(parsed.rows).toHaveLength(0);
        expect(parsed.skipped).toHaveLength(1);
        expect(parsed.skipped[0].reason).toMatch(/kind/);
    });

    it('資材欄非有限非負整數時 skip，不 Number||0 靜默寫入', () => {
        const header = 'ts,kind,shipMst,shipName,fuel,ammo,steel,bauxite,devmat,torch,secretary,secretaryName,hqLv';
        const badFuel = '2026-07-23T12:00:00.000Z,build,135,,abc,30,30,1750,0,0,1,,120';
        const neg = '2026-07-23T12:00:01.000Z,build,135,,1750,-1,30,1750,0,0,1,,120';
        const ok = '2026-07-23T12:00:02.000Z,build,135,,1750,30,30,1750,0,0,1,,120';
        const parsed = parseBuildLogCsv(`${header}\r\n${badFuel}\r\n${neg}\r\n${ok}\r\n`);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0].used).toEqual([1750, 30, 30, 1750, 0, 0, 0, 0]);
        expect(parsed.skipped).toHaveLength(2);
        expect(parsed.skipped[0].reason).toMatch(/fuel/);
        expect(parsed.skipped[1].reason).toMatch(/ammo/);
    });

    // hqLv 走 Number() 時「あ」會變成 NaN 寫進 DB（JSON 序列化成 null、UI 顯示 NaN）。
    it('hqLv 非合法整數時 skip；空欄維持缺席而不是補 0', () => {
        const header = 'ts,kind,shipMst,shipName,fuel,ammo,steel,bauxite,devmat,torch,secretary,secretaryName,hqLv';
        const bad = '2026-07-23T12:00:00.000Z,build,135,,1750,30,30,1750,0,0,1,,あ';
        const blank = '2026-07-23T12:00:01.000Z,build,135,,1750,30,30,1750,0,0,1,,';
        const parsed = parseBuildLogCsv(`${header}\r\n${bad}\r\n${blank}\r\n`);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0]).not.toHaveProperty('hqLv');
        expect(parsed.skipped).toHaveLength(1);
        expect(parsed.skipped[0].reason).toMatch(/hqLv/);
    });
});

describe('parseBuildLogCsv（航海日誌拡張版相容）', () => {
    const HEADER = ['No.', '日付', '種類', '名前', '艦種', '燃料', '弾薬', '鋼材', 'ボーキ', '開発資材', '空きドック', '秘書艦', '司令部Lv'].join('\t');

    it('名前／秘書艦欄位解析成 shipName／secretaryName，數字欄解析成 used／hqLv', () => {
        const line = ['1', '2026-07-23 21:00:00', '建造', '長波', '駆逐艦', '1750', '30', '30', '1750', '0', '3', '睦月', '120'].join('\t');
        const parsed = parseBuildLogCsv(`${HEADER}\r\n${line}\r\n`);
        expect(parsed.format).toBe('logbook');
        expect(parsed.rows).toEqual([{
            ts: new Date(2026, 6, 23, 21, 0, 0).getTime(), kind: 'build',
            used: [1750, 30, 30, 1750, 0, 0, 0, 0],
            shipName: '長波', secretaryName: '睦月', hqLv: 120,
        }]);
    });

    it('resolveShipMst 命中時解析成 shipMst／secretary 而非文字欄位', () => {
        const line = ['1', '2026-07-23 21:00:00', '建造', '長波', '駆逐艦', '1750', '30', '30', '1750', '0', '3', '睦月', '120'].join('\t');
        const resolve = (name: string) => (name === '長波' ? 135 : name === '睦月' ? 1 : undefined);
        const parsed = parseBuildLogCsv(`${HEADER}\r\n${line}\r\n`, resolve);
        expect(parsed.rows[0].shipMst).toBe(135);
        expect(parsed.rows[0].shipName).toBeUndefined();
        expect(parsed.rows[0].secretary).toBe(1);
        expect(parsed.rows[0].secretaryName).toBeUndefined();
    });

    it('名前欄位空白的列被跳過', () => {
        const line = ['1', '2026-07-23 21:00:00', '建造', '', '', '0', '0', '0', '0', '0', '0', '', ''].join('\t');
        const parsed = parseBuildLogCsv(`${HEADER}\r\n${line}\r\n`);
        expect(parsed.rows).toHaveLength(0);
        expect(parsed.skipped).toHaveLength(1);
    });

    // 這份格式沒有實機樣本佐證，不合預期的欄位是常態；`Number(x) || 0` 會把無法解讀的
    // 來源值偽裝成精確的投入資材（「あ」→0、「-5」→-5），事後再也分不出來。
    it('資材欄非有限非負整數時整列跳過並記原因，不 Number||0 靜默寫入', () => {
        const bad = ['1', '2026-07-23 21:00:00', '建造', '長波', '駆逐艦', 'あ', '30', '30', '1750', '0', '3', '睦月', '120'].join('\t');
        const neg = ['2', '2026-07-23 21:01:00', '建造', '長波', '駆逐艦', '1750', '-5', '30', '1750', '0', '3', '睦月', '120'].join('\t');
        const frac = ['3', '2026-07-23 21:02:00', '建造', '長波', '駆逐艦', '1750', '30', '1.5', '1750', '0', '3', '睦月', '120'].join('\t');
        const ok = ['4', '2026-07-23 21:03:00', '建造', '長波', '駆逐艦', '1750', '30', '30', '1750', '0', '3', '睦月', '120'].join('\t');
        const parsed = parseBuildLogCsv([HEADER, bad, neg, frac, ok, ''].join('\r\n'));
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0].used).toEqual([1750, 30, 30, 1750, 0, 0, 0, 0]);
        expect(parsed.skipped.map(s => s.reason)).toEqual([
            expect.stringContaining('燃料'),
            expect.stringContaining('弾薬'),
            expect.stringContaining('鋼材'),
        ]);
    });

    it('司令部Lv 非合法整數時整列跳過，不寫 NaN；空欄則維持缺席', () => {
        const bad = ['1', '2026-07-23 21:00:00', '建造', '長波', '駆逐艦', '1750', '30', '30', '1750', '0', '3', '睦月', 'あ'].join('\t');
        const blank = ['2', '2026-07-23 21:01:00', '建造', '長波', '駆逐艦', '1750', '30', '30', '1750', '0', '3', '睦月', ''].join('\t');
        const parsed = parseBuildLogCsv([HEADER, bad, blank, ''].join('\r\n'));
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0]).not.toHaveProperty('hqLv');
        expect(parsed.skipped).toHaveLength(1);
        expect(parsed.skipped[0].reason).toMatch(/司令部Lv/);
    });
});

it('不是任何已知格式的表頭直接拒絕', () => {
    expect(() => parseBuildLogCsv('foo,bar\r\n1,2\r\n')).toThrow(BuildLogImportError);
});

describe('importBuildLogRows（落地）', () => {
    it('借用的 event ID 探針不留下，寫入的列標記 imported', async () => {
        const database = createDb();
        const parsed = parseBuildLogCsv(buildLogCsvText([row()], shipName));
        const result = await importBuildLogRows(database, parsed.rows);
        expect(result).toEqual({ added: 1, duplicates: 0 });
        expect(await database.events.count()).toBe(0);
        const rows = await database.factory.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].imported).toBe(true);
        expect(rows[0].shipMst).toBe(135);
    });

    it('同一份 CSV 匯入兩次：第二次判定為重複', async () => {
        const database = createDb();
        const parsed = parseBuildLogCsv(buildLogCsvText([row()], shipName));
        await importBuildLogRows(database, parsed.rows);
        const second = await importBuildLogRows(database, parsed.rows);
        expect(second).toEqual({ added: 0, duplicates: 1 });
        expect(await database.factory.count()).toBe(1);
    });

    it('投入資材不同則不視為重複（同時間同艦種也可能是兩艘不同的船）', async () => {
        const database = createDb();
        const parsed = parseBuildLogCsv(buildLogCsvText([row()], shipName));
        await importBuildLogRows(database, parsed.rows);
        const differentUsed = await importBuildLogRows(database, [{
            ...parsed.rows[0], used: [2000, 30, 30, 1750, 0, 0, 0, 0],
        }]);
        expect(differentUsed.added).toBe(1);
    });

    it('未能解析 shipMst 的匯入列以 shipName 比對去重', async () => {
        const database = createDb();
        const unresolved = parseBuildLogCsv(buildLogCsvText([row({ shipMst: undefined, importedShipName: '謎の艦' })], shipName)).rows;
        await importBuildLogRows(database, unresolved);
        const second = await importBuildLogRows(database, unresolved);
        expect(second).toEqual({ added: 0, duplicates: 1 });
    });

    it('資料庫有配對 build＋speedup 時，重匯入合併後的 CSV 仍判定為重複', async () => {
        const database = createDb();
        const baseTs = Date.parse('2026-07-23T12:00:00Z');
        const buildRow = row({ eventId: 10, ts: baseTs, kdockId: 1, shipMst: 135, used: [30, 30, 30, 30, 0, 0, 1, 0] });
        const speedupRow = row({ eventId: 11, ts: baseTs + 5_000, kind: 'speedup', kdockId: 1, shipMst: 135, used: [0, 0, 0, 0, 1, 0, 0, 0] });
        await database.factory.bulkPut([buildRow, speedupRow]);

        const merged = mergeBuildRows([buildRow, speedupRow]);
        expect(merged).toHaveLength(1);
        const reimported = await importBuildLogRows(database, parseBuildLogCsv(buildLogCsvText(merged, shipName)).rows);
        expect(reimported).toEqual({ added: 0, duplicates: 1 });
        expect(await database.factory.count()).toBe(2);
    });
});

describe('mergeBuildRows（同建造渠 build＋speedup 合併）', () => {
    const T0 = Date.parse('2026-07-23T12:00:00Z');
    const MIN = 60_000;
    const HOUR = 60 * MIN;

    it('同建造渠同艦的 build 與後續 speedup 合併為單筆，保留建造當下的時間／旗艦／司令部等級並併入火槍數', () => {
        const build = row({
            eventId: 10, ts: T0, kind: 'build', kdockId: 1, shipMst: 56,
            used: [30, 30, 30, 30, 0, 0, 1, 0], secretary: 1, hqLv: 119,
        });
        const speedup = row({
            eventId: 11, ts: T0 + 3 * MIN, kind: 'speedup', kdockId: 1, shipMst: 56,
            used: [0, 0, 0, 0, 1, 0, 0, 0], secretary: 2, hqLv: 120,
        });
        const merged = mergeBuildRows([speedup, build]);
        expect(merged).toHaveLength(1);
        expect(merged[0]).toEqual({
            eventId: 10, ts: T0, kind: 'build', kdockId: 1, shipMst: 56,
            used: [30, 30, 30, 30, 1, 0, 1, 0], secretary: 1, hqLv: 119,
        });
        // 不改動輸入列
        expect(build.used[4]).toBe(0);
    });

    it('大型建造消耗 10 支火槍與多渠同時造同船時，只併入對應建造渠', () => {
        const dock1 = row({
            eventId: 10, ts: T0, kind: 'build', kdockId: 1, shipMst: 86,
            used: [1500, 1500, 2000, 1000, 0, 0, 1, 0],
        });
        const dock2 = row({
            eventId: 11, ts: T0 + MIN, kind: 'build', kdockId: 2, shipMst: 86,
            used: [4000, 6000, 6000, 2000, 0, 0, 20, 0],
        });
        const rushDock1 = row({
            eventId: 12, ts: T0 + 2 * MIN, kind: 'speedup', kdockId: 1, shipMst: 86,
            used: [0, 0, 0, 0, 10, 0, 0, 0],
        });
        const merged = mergeBuildRows([dock1, dock2, rushDock1]);
        expect(merged).toHaveLength(2);
        expect(merged[0].kdockId).toBe(2);
        expect(merged[0].used[4]).toBe(0);
        expect(merged[1].kdockId).toBe(1);
        expect(merged[1].used[4]).toBe(10);
    });

    it('同建造渠連續建造同艦：先未加速再加速，加速只併入第二次建造', () => {
        const first = row({ eventId: 10, ts: T0, kind: 'build', kdockId: 1, shipMst: 56, used: [30, 30, 30, 30, 0, 0, 1, 0] });
        const second = row({ eventId: 20, ts: T0 + 30 * MIN, kind: 'build', kdockId: 1, shipMst: 56, used: [30, 30, 30, 30, 0, 0, 1, 0] });
        const rushSecond = row({ eventId: 21, ts: T0 + 31 * MIN, kind: 'speedup', kdockId: 1, shipMst: 56, used: [0, 0, 0, 0, 1, 0, 0, 0] });
        const merged = mergeBuildRows([first, second, rushSecond]);
        expect(merged.map(r => [r.eventId, r.used[4]])).toEqual([[20, 1], [10, 0]]);
    });

    it('同建造渠連續建造同艦：兩次皆加速，各自合併成兩筆', () => {
        const b1 = row({ eventId: 10, ts: T0, kind: 'build', kdockId: 1, shipMst: 56, used: [30, 30, 30, 30, 0, 0, 1, 0] });
        const s1 = row({ eventId: 11, ts: T0 + MIN, kind: 'speedup', kdockId: 1, shipMst: 56, used: [0, 0, 0, 0, 1, 0, 0, 0] });
        const b2 = row({ eventId: 12, ts: T0 + 2 * MIN, kind: 'build', kdockId: 1, shipMst: 56, used: [30, 30, 30, 30, 0, 0, 1, 0] });
        const s2 = row({ eventId: 13, ts: T0 + 3 * MIN, kind: 'speedup', kdockId: 1, shipMst: 56, used: [0, 0, 0, 0, 1, 0, 0, 0] });
        const merged = mergeBuildRows([b1, s1, b2, s2]);
        expect(merged.map(r => [r.eventId, r.used[4]])).toEqual([[12, 1], [10, 1]]);
    });

    it('孤立 speedup、不同艦或相隔超過 12 小時不誤合併，保留原列', () => {
        const orphan = row({ eventId: 1, ts: T0, kind: 'speedup', kdockId: 3, shipMst: 56, used: [0, 0, 0, 0, 1, 0, 0, 0] });
        const oldBuild = row({ eventId: 2, ts: T0, kind: 'build', kdockId: 1, shipMst: 56, used: [30, 30, 30, 30, 0, 0, 1, 0] });
        const tooLate = row({ eventId: 3, ts: T0 + 13 * HOUR, kind: 'speedup', kdockId: 1, shipMst: 56, used: [0, 0, 0, 0, 1, 0, 0, 0] });
        const otherBuild = row({ eventId: 4, ts: T0 + 14 * HOUR, kind: 'build', kdockId: 2, shipMst: 56, used: [30, 30, 30, 30, 0, 0, 1, 0] });
        const diffShip = row({ eventId: 5, ts: T0 + 14 * HOUR + MIN, kind: 'speedup', kdockId: 2, shipMst: 99, used: [0, 0, 0, 0, 1, 0, 0, 0] });
        const merged = mergeBuildRows([orphan, oldBuild, tooLate, otherBuild, diffShip]);
        expect(merged).toHaveLength(5);
        expect(merged.find(r => r.eventId === 2)!.used[4]).toBe(0);
        expect(merged.find(r => r.eventId === 4)!.used[4]).toBe(0);
    });

    it('無 kdockId 的舊版匯入 build＋speedup（含同毫秒）也能配對合併', () => {
        const b = row({ eventId: 50, ts: T0, kind: 'build', kdockId: undefined, shipMst: 135, used: [30, 30, 30, 30, 0, 0, 1, 0], imported: true });
        const s = row({ eventId: 49, ts: T0, kind: 'speedup', kdockId: undefined, shipMst: 135, used: [0, 0, 0, 0, 1, 0, 0, 0], imported: true });
        const merged = mergeBuildRows([s, b]);
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ eventId: 50, kind: 'build', shipMst: 135, imported: true });
        expect(merged[0].used[4]).toBe(1);
    });
});
