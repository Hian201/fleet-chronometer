// utils/csv.ts：CSV／TSV 解析與序列化的最小純函式測試。
import { describe, expect, it } from 'vitest';
import { csvCell, parseDelimitedText, parseTimestamp, rowsToCsv } from '../utils/csv';

describe('csvCell／rowsToCsv', () => {
    it('不含特殊字元的欄位不加引號', () => {
        expect(csvCell('6-5')).toBe('6-5');
    });

    it('含逗號／引號／換行的欄位加引號並雙寫內部引號', () => {
        expect(csvCell('a,b')).toBe('"a,b"');
        expect(csvCell('a"b')).toBe('"a""b"');
        expect(csvCell('a\nb')).toBe('"a\nb"');
    });

    it('rowsToCsv 以逗號分欄、CRLF 分行', () => {
        expect(rowsToCsv([['a', 'b'], ['c,d', 'e']])).toBe('a,b\r\n"c,d",e');
    });
});

describe('parseDelimitedText', () => {
    it('逗號分隔：往返一致', () => {
        const text = rowsToCsv([['ts', 'map', 'drop'], ['2026-07-23T00:00:00.000Z', '6-5', '長波']]);
        const parsed = parseDelimitedText(text)!;
        expect(parsed.delimiter).toBe(',');
        expect(parsed.header).toEqual(['ts', 'map', 'drop']);
        expect(parsed.rows).toEqual([['2026-07-23T00:00:00.000Z', '6-5', '長波']]);
    });

    it('Tab 分隔（航海日誌風格，無跳脫）：依表頭 tab 數判定為 TSV', () => {
        const text = 'No.\t日付\t海域\r\n1\t2026-07-23 12:00:00\t6-5\r\n';
        const parsed = parseDelimitedText(text)!;
        expect(parsed.delimiter).toBe('\t');
        expect(parsed.header).toEqual(['No.', '日付', '海域']);
        expect(parsed.rows).toEqual([['1', '2026-07-23 12:00:00', '6-5']]);
    });

    it('空白文字回傳 null', () => {
        expect(parseDelimitedText('')).toBeNull();
    });

    it('欄位內的逗號被引號保護，不會被錯誤切開', () => {
        const parsed = parseDelimitedText('a,b\r\n"1,000",x\r\n')!;
        expect(parsed.rows).toEqual([['1,000', 'x']]);
    });
});

describe('parseDelimitedText 邊界', () => {
    it('剝掉 Excel 的 UTF-8 BOM，第一個表頭仍可比對', () => {
        expect(parseDelimitedText('\uFEFFts,map\r\n1,6-5\r\n')!.header).toEqual(['ts', 'map']);
    });
    it('TSV 欄位以雙引號開頭時照字面保留，不吃掉後面的欄位與換行', () => {
        const parsed = parseDelimitedText('a\tb\r\n"x\ty\r\n1\t2\r\n')!;
        expect(parsed.rows).toEqual([['"x', 'y'], ['1', '2']]);
    });
});

describe('parseTimestamp', () => {
    it('接受 ISO 與航海日誌格式', () => {
        expect(parseTimestamp('2026-07-23T00:00:00.000Z')).toBe(Date.UTC(2026, 6, 23));
        expect(parseTimestamp('2026-07-23 12:00:00')).toBe(new Date(2026, 6, 23, 12).getTime());
    });
    it('1970 年以前的時刻回 null（負 ts 會讓備份還原失敗）', () => {
        expect(parseTimestamp('1969-01-01T00:00:00Z')).toBeNull();
    });
});
