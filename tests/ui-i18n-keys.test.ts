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
