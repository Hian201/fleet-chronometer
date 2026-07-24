// utils/csv.ts：CSV／TSV 解析與序列化的最小純函式測試。
import { describe, expect, it } from 'vitest';
import { csvCell, parseDelimitedText, rowsToCsv } from '../utils/csv';

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
