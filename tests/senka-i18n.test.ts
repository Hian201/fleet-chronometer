// 戰果介面文案（utils/ui-i18n.ts）三語一致性、佔位符與 §2.5 資料來源檢查。
import { describe, expect, it } from 'vitest';
import type { Lang } from '../utils/gamedata-i18n';
import { LANGS, tFor, uiStringKeys } from '../utils/ui-i18n';

const SENKA_PREFIXES = ['senka.', 'ov.senka', 'ov.sk'] as const;
const senkaKeys = (lang: Lang) => uiStringKeys(lang).filter(key => SENKA_PREFIXES.some(prefix => key.startsWith(prefix)));
const placeholders = (text: string) => [...text.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort();

describe('戰果三語文案', () => {
    const baseKeys = senkaKeys(LANGS[0].code).sort();

    it('三語鍵集合一致且共 95 個鍵', () => {
        expect(baseKeys).toHaveLength(95);
        for (const { code } of LANGS) {
            expect(senkaKeys(code).sort(), code).toEqual(baseKeys);
        }
    });

    for (const { code } of LANGS) {
        it(`${code}：95 個鍵皆為非空字串且不會退回原鍵名`, () => {
            const keys = senkaKeys(code);
            expect(keys).toHaveLength(95);
            for (const key of keys) {
                const text = tFor(code, key);
                expect(text.trim(), `${code} ${key}`).not.toBe('');
                expect(text, `${code} ${key}`).not.toBe(key);
            }
        });
    }

    it('帶有 {...} 佔位符的鍵在三語間的佔位符集合完全一致', () => {
        let withPlaceholderCount = 0;
        for (const key of baseKeys) {
            const expected = placeholders(tFor(LANGS[0].code, key));
            if (expected.length > 0) withPlaceholderCount++;
            for (const { code } of LANGS.slice(1)) {
                expect(placeholders(tFor(code, key)), `${code} ${key}`).toEqual(expected);
            }
        }
        expect(withPlaceholderCount).toBeGreaterThan(0);
    });

    it('設計規範 §2.5：三語新增文案皆不含資料來源字樣', () => {
        // 以 \bpoi\b 比對工具名稱「poi」，避免誤傷英文正常用字「points」
        const forbidden = /wiki|KC3|kc3|\bpoi\b|社群|community/i;
        for (const { code } of LANGS) {
            for (const key of senkaKeys(code)) {
                expect(tFor(code, key), `${code} ${key}`).not.toMatch(forbidden);
            }
        }
    });
});
