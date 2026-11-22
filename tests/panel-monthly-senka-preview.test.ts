import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSenkaExample } from '../tools/preview/panel-monthly-senka';

const keys = ['inherit', 'normal', 'eo', 'quest', 'today', 'published', 'border'];
const block = (value: unknown) => '<!-- senka-preview -->\n```json\n' + JSON.stringify(value) + '\n```';
const valid = { inherit: 310, normal: 2450, eo: 1200, quest: 300, today: 96, published: 4180, border: 4200 };

describe('戰果預覽與提案共用試排數值', () => {
    it('讀取提案中標記的範例', () => {
        const text = readFileSync(new URL('../docs/panel-monthly-senka-plan.md', import.meta.url), 'utf8');
        expect(readSenkaExample(text)).toEqual(Object.fromEntries(keys.map(key => [key, expect.any(Number)])));
    });

    it('讀出七個欄位', () => {
        expect(readSenkaExample(block(valid))).toEqual(valid);
    });

    it('缺少標記、缺欄或無效數值時停止產生，允許已確認的零', () => {
        expect(() => readSenkaExample('')).toThrow('提案缺少月底試排數值');
        for (const key of keys) {
            const { [key as keyof typeof valid]: _omit, ...rest } = valid;
            expect(() => readSenkaExample(block(rest))).toThrow(key);
            expect(() => readSenkaExample(block({ ...valid, [key]: -1 }))).toThrow(key);
            expect(() => readSenkaExample(block({ ...valid, [key]: 1.5 }))).toThrow(key);
            expect(() => readSenkaExample(block({ ...valid, [key]: null }))).toThrow(key);
        }
        expect(readSenkaExample(block({ ...valid, today: 0, quest: 0 })).today).toBe(0);
    });
});
