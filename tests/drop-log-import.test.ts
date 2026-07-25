// 打撈紀錄 CSV 匯出／匯入（utils/drop-log-import.ts）：解析（自家格式＋航海日誌拡張版
// 戦績／ドロップ報告書相容）、去重、以及落地時的 event ID 借號（同 sortie-import.ts 的手法）。
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb, type SortieLogRow } from '../utils/db';
import {
    dropLogCsvText, DropLogImportError, importDropLogRows, parseDropLogCsv, reverseShipLookup,
} from '../utils/drop-log-import';

const databases: KcDb[] = [];
let serial = 0;
function createDb() {
    const database = new KcDb(`kc-drop-log-import-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}
afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

const row = (over: Partial<SortieLogRow> = {}): SortieLogRow => ({
    eventId: 1, sortieKey: 1, ts: Date.parse('2026-07-23T12:00:00Z'), map: '6-5', node: 53,
    boss: true, kind: 'battle', rank: 'S', seiku: 1, enemyIds: [1], enemyIdsEscort: [],
    drop: '長波', dropMst: 135, taiha: false,
    ...over,
});

describe('parseDropLogCsv（自家格式，往返）', () => {
    it('匯出再匯入得到相同欄位', () => {
        const csv = dropLogCsvText([row()]);
        const parsed = parseDropLogCsv(csv);
        expect(parsed.format).toBe('own');
        expect(parsed.skipped).toHaveLength(0);
        expect(parsed.rows).toEqual([{
            ts: row().ts, map: '6-5', node: 53, boss: true, rank: 'S', drop: '長波', dropMst: 135,
        }]);
    });

    it('map 不是 world-mapnum 格式的列被跳過並記錄原因，不影響其餘列', () => {
        const csv = dropLogCsvText([row(), row({ map: '海域A', ts: row().ts + 1000 })]);
        const parsed = parseDropLogCsv(csv);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.skipped).toHaveLength(1);
        expect(parsed.skipped[0].reason).toMatch(/map/);
    });

    it('沒有掉落艦的列（drop 欄空白）被跳過', () => {
        const csv = dropLogCsvText([row({ drop: '' })]);
        const parsed = parseDropLogCsv(csv);
        expect(parsed.rows).toHaveLength(0);
        expect(parsed.skipped).toHaveLength(1);
    });

    it('rank 走 normalizeRank（尾字元／大小寫）', () => {
        const header = 'ts,map,node,boss,rank,drop,dropMst';
        const line = `${new Date(row().ts).toISOString()},6-5,53,1,完全勝利!!s,長波,135`;
        const parsed = parseDropLogCsv(`${header}\r\n${line}\r\n`);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0].rank).toBe('S');
    });

    it('無效 node 跳過並記錄原因，不靜默改成 0', () => {
        const header = 'ts,map,node,boss,rank,drop,dropMst';
        const bad = [
            `${new Date(row().ts).toISOString()},6-5,,1,S,長波,135`,
            `${new Date(row().ts + 1000).toISOString()},6-5,0,1,S,長波,135`,
            `${new Date(row().ts + 2000).toISOString()},6-5,abc,1,S,長波,135`,
            `${new Date(row().ts + 3000).toISOString()},6-5,53,1,S,長波,135`,
        ].join('\r\n');
        const parsed = parseDropLogCsv(`${header}\r\n${bad}\r\n`);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0].node).toBe(53);
        expect(parsed.skipped).toHaveLength(3);
        expect(parsed.skipped.every(s => /node/.test(s.reason))).toBe(true);
    });
});

describe('parseDropLogCsv（航海日誌拡張版相容）', () => {
    const HEADER = ['No.', '日付', '海域', 'マス', '出撃', 'ランク', '敵艦隊', 'ドロップ艦種', 'ドロップ艦娘', 'ドロップアイテム'].join('\t');

    it('從マス欄取出海域，ランク欄取尾字元，出撃欄含ボス即判定為 boss', () => {
        const line = ['1', '2026-07-23 21:00:00', '出撃任務', 'マップ:6-5 セル:13 (ボス)', 'ボス', '完全勝利!!S', '深海棲艦本隊', '駆逐艦', '長波', ''].join('\t');
        const parsed = parseDropLogCsv(`${HEADER}\r\n${line}\r\n`);
        expect(parsed.format).toBe('logbook');
        expect(parsed.rows).toEqual([{
            ts: new Date(2026, 6, 23, 21, 0, 0).getTime(),
            map: '6-5', node: 0, boss: true, rank: 'S', drop: '長波', enemyName: '深海棲艦本隊',
        }]);
    });

    it('ドロップ艦娘為「※空きなし」代表沒有掉落，靜默跳過（不是錯誤）', () => {
        const line = ['1', '2026-07-23 21:00:00', '出撃任務', 'マップ:6-5 セル:13', '', 'S', '', '', '※空きなし', ''].join('\t');
        const parsed = parseDropLogCsv(`${HEADER}\r\n${line}\r\n`);
        expect(parsed.rows).toHaveLength(0);
        expect(parsed.skipped).toHaveLength(0);
    });

    it('簡寫 rank（單一字母）也能正確解析', () => {
        const line = ['1', '2026-07-23 21:00:00', '出撃任務', 'マップ:1-1 セル:1', '', 'A', '', '', '睦月', ''].join('\t');
        const parsed = parseDropLogCsv(`${HEADER}\r\n${line}\r\n`);
        expect(parsed.rows[0].rank).toBe('A');
        expect(parsed.rows[0].map).toBe('1-1');
    });

    it('resolveShipMst 命中時附上 dropMst', () => {
        const line = ['1', '2026-07-23 21:00:00', '出撃任務', 'マップ:6-5 セル:13', '', 'S', '', '', '長波', ''].join('\t');
        const parsed = parseDropLogCsv(`${HEADER}\r\n${line}\r\n`, name => name === '長波' ? 135 : undefined);
        expect(parsed.rows[0].dropMst).toBe(135);
    });
});

it('不是任何已知格式的表頭直接拒絕', () => {
    expect(() => parseDropLogCsv('foo,bar\r\n1,2\r\n')).toThrow(DropLogImportError);
});

it('空字串拒絕', () => {
    expect(() => parseDropLogCsv('')).toThrow(DropLogImportError);
});

describe('reverseShipLookup', () => {
    it('依 master 建立艦名→id 反查表', () => {
        const master = new Map([[135, { name: '長波' }], [1, { name: '睦月' }]]);
        const lookup = reverseShipLookup(master);
        expect(lookup('長波')).toBe(135);
        expect(lookup('不存在')).toBeUndefined();
    });
});

describe('importDropLogRows（落地）', () => {
    it('借用的 event ID 探針不留下，寫入的列標記 imported', async () => {
        const database = createDb();
        const parsed = parseDropLogCsv(dropLogCsvText([row()]));
        const result = await importDropLogRows(database, parsed.rows);
        expect(result).toEqual({ added: 1, duplicates: 0 });
        expect(await database.events.count()).toBe(0);
        const rows = await database.sorties.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].imported).toBe(true);
        expect(rows[0].drop).toBe('長波');
    });

    it('同一份 CSV 匯入兩次：第二次全數判定為重複，不新增', async () => {
        const database = createDb();
        const parsed = parseDropLogCsv(dropLogCsvText([row()]));
        await importDropLogRows(database, parsed.rows);
        const second = await importDropLogRows(database, parsed.rows);
        expect(second).toEqual({ added: 0, duplicates: 1 });
        expect(await database.sorties.count()).toBe(1);
    });

    it('海域不同或超出時間容差則不視為重複', async () => {
        const database = createDb();
        await importDropLogRows(database, [{
            ts: row().ts, map: '6-5', node: 53, boss: true, rank: 'S', drop: '長波', dropMst: 135,
        }]);
        const differentMap = await importDropLogRows(database, [{
            ts: row().ts, map: '6-4', node: 53, boss: true, rank: 'S', drop: '長波', dropMst: 135,
        }]);
        expect(differentMap.added).toBe(1);
        const farInTime = await importDropLogRows(database, [{
            ts: row().ts + 20 * 60 * 1000, map: '6-5', node: 53, boss: true, rank: 'S', drop: '長波', dropMst: 135,
        }]);
        expect(farInTime.added).toBe(1);
    });

    it('本機擷取（無 imported 標記）的既有紀錄也能被匯入去重', async () => {
        const database = createDb();
        await database.sorties.put(row({ imported: undefined }));
        const result = await importDropLogRows(database, [{
            ts: row().ts, map: '6-5', node: 53, boss: true, rank: 'S', drop: '長波', dropMst: 135,
        }]);
        expect(result).toEqual({ added: 0, duplicates: 1 });
    });
});
