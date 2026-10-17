// 介面日期一律「年/月/日」（design-guidelines §2.6）：toLocale* 在英文介面會變成月/日/年與 12 小時制。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime } from '../utils/date-format';

describe('日期格式', () => {
    const ts = new Date(2026, 8, 8, 7, 5, 3).getTime();

    it('年/月/日、補零、24 小時制', () => {
        expect(formatDate(ts)).toBe('2026/09/08');
        expect(formatDateTime(ts)).toBe('2026/09/08 07:05:03');
        expect(formatDateTime(ts, false)).toBe('2026/09/08 07:05');
        expect(formatTime(new Date(2026, 0, 1, 21, 0, 9).getTime())).toBe('21:00:09');
    });

    it('介面程式碼不得用 toLocale* 格式化日期時間', () => {
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else if (/\.(ts|html)$/.test(name)) files.push(path);
            }
        };
        walk('entrypoints');
        walk('utils');
        const offenders = files.filter(path => {
            const src = readFileSync(path, 'utf8');
            return /toLocaleDateString\(|toLocaleTimeString\(|new Date\([^)]*\)\.toLocaleString\(/.test(src);
        });
        expect(offenders).toEqual([]);
    });
});
