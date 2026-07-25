// 建造紀錄 CSV 匯出／匯入（utils/build-log-import.ts）：解析（自家格式＋航海日誌拡張版
// 建造報告書相容）、去重、以及落地時的 event ID 借號。
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb, type FactoryLogRow } from '../utils/db';
import {
    buildLogCsvText, BuildLogImportError, importBuildLogRows, parseBuildLogCsv,
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
});
