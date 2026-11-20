// utils/plain-object.ts：containsApiToken 以顯式堆疊走訪，不得因深層巢狀或循環參照出錯。
import { describe, expect, it } from 'vitest';
import { containsApiToken } from '../utils/plain-object';

describe('containsApiToken', () => {
    it('任一層出現 api_token 鍵即為 true（含陣列內的物件）', () => {
        expect(containsApiToken({ api_token: 'x' })).toBe(true);
        expect(containsApiToken({ a: [{ b: { api_token: '' } }] })).toBe(true);
    });

    it('沒有該鍵的物件、陣列與原始值回 false', () => {
        expect(containsApiToken({ a: 1, b: [1, 2, { c: 'api_token' }] })).toBe(false);
        expect(containsApiToken([])).toBe(false);
        expect(containsApiToken([{ x: [] }])).toBe(false);
        expect(containsApiToken(null)).toBe(false);
        expect(containsApiToken('api_token')).toBe(false);
    });

    it('巢狀 10000 層仍能找到深處的 api_token，不丟 RangeError', () => {
        const build = (leaf: Record<string, unknown>) => {
            let node: Record<string, unknown> = leaf;
            for (let i = 0; i < 10000; i++) node = { child: i % 2 ? [node] : node };
            return node;
        };
        expect(() => containsApiToken(build({ api_token: 'x' }))).not.toThrow();
        expect(containsApiToken(build({ api_token: 'x' }))).toBe(true);
        expect(containsApiToken(build({ ok: 1 }))).toBe(false);
    });

    it('循環參照不會無窮迴圈', () => {
        const a: Record<string, unknown> = {};
        a.self = a;
        a.list = [a];
        expect(containsApiToken(a)).toBe(false);
        a.deep = { api_token: 't' };
        expect(containsApiToken(a)).toBe(true);
    });
});
