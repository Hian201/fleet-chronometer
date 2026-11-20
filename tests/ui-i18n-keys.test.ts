import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGS, uiStringKeys } from '../utils/ui-i18n';

// t() 缺鍵時退回日文，畫面不會報錯，只會在華語／英文介面冒出日文；所以要在測試擋。
describe('介面字典三語鍵一致', () => {
    const all = new Set(LANGS.flatMap(({ code }) => uiStringKeys(code)));
    for (const { code } of LANGS) {
        it(`${code} 沒有缺鍵`, () => {
            const own = new Set(uiStringKeys(code));
            expect([...all].filter(key => !own.has(key)).sort()).toEqual([]);
        });
    }
});

// 三語都沒有的鍵，t() 會原樣顯示鍵名；只檢查字面鍵，`t('idle.' + x)` 這類組字前綴略過。
describe('程式碼裡的 t() 字面鍵都在字典中', () => {
    const keys = new Set(LANGS.flatMap(({ code }) => uiStringKeys(code)));
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d =>
        d.isDirectory() ? walk(join(dir, d.name)) : /\.ts$/.test(d.name) ? [join(dir, d.name)] : []);
    const usesUiT = (src: string) => /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'(?:@\/utils|(?:\.\.\/)+utils|\.\.?)\/ui-i18n'/.test(src);
    it('沒有未定義的鍵', () => {
        const missing: string[] = [];
        for (const file of [...walk('entrypoints'), ...walk('utils')]) {
            const src = readFileSync(file, 'utf8');
            if (!usesUiT(src)) continue;
            for (const m of src.matchAll(/(?<![\w.$])t\(\s*'([^']+)'/g)) {
                if (!m[1].endsWith('.') && !keys.has(m[1])) missing.push(`${file}: ${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });
});
