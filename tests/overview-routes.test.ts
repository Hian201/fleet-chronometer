// 情報總括 hash 路由與「工廠」分區：舊分區網址要能轉進合併後的分區，並選到對應子分頁。
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRoute } from '../entrypoints/overview/routes';
import { sections } from '../entrypoints/overview/sections';
import {
    DEFAULT_FACTORY_SUB, FACTORY_SECTION_ID, FACTORY_SUBS, factoryNavHtml, factorySection, resolveFactorySub,
} from '../entrypoints/overview/sections/factory';
import { LANGS, setLang, t, tFor } from '../utils/ui-i18n';

afterEach(() => setLang('zh-TW'));

describe('分區登錄', () => {
    it('三個舊分區不再各自登錄，只有一個工廠分區', () => {
        const ids = sections.map(section => section.id);
        expect(ids).toContain(FACTORY_SECTION_ID);
        for (const legacy of ['build-log', 'dev-log', 'improve-plan']) expect(ids).not.toContain(legacy);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('子分頁依序是 建造｜開發｜改修，各自對應原來的分區', () => {
        expect(FACTORY_SUBS.map(sub => sub.key)).toEqual(['build', 'develop', 'improve']);
        expect(FACTORY_SUBS.map(sub => sub.section.id)).toEqual(['build-log', 'dev-log', 'improve-plan']);
    });
});

describe('舊網址轉向', () => {
    const cases: [string, string][] = [
        ['#/build-log', '#/factory?sub=build'],
        ['#/dev-log', '#/factory?sub=develop'],
        ['#/improve-plan', '#/factory?sub=improve'],
        ['#build-log', '#/factory?sub=build'], // 沒有斜線的寫法
    ];
    for (const [old, expected] of cases) {
        it(`${old} → ${expected}`, () => {
            expect(resolveRoute(old, sections)).toEqual({ id: FACTORY_SECTION_ID, canonical: expected });
        });
    }

    it('舊網址自帶的其他參數保留，子頁參數以轉向為準', () => {
        expect(resolveRoute('#/build-log?foo=1&sub=develop', sections).canonical).toBe('#/factory?foo=1&sub=build');
    });

    it('已是標準 id 或未知 id 不改寫；未知退回第一個分區', () => {
        expect(resolveRoute('#/factory?sub=develop', sections)).toEqual({ id: 'factory', canonical: null });
        expect(resolveRoute('#/goals', sections)).toEqual({ id: 'goals', canonical: null });
        expect(resolveRoute('#/no-such-section', sections)).toEqual({ id: sections[0].id, canonical: null });
        expect(resolveRoute('', sections)).toEqual({ id: sections[0].id, canonical: null });
    });

    it('工廠分區宣告的舊 id 都能解到對應子頁', () => {
        const redirects = factorySection.redirects!;
        expect(Object.keys(redirects).sort()).toEqual(['build-log', 'dev-log', 'improve-plan']);
        for (const sub of FACTORY_SUBS) {
            const canonical = resolveRoute(`#/${sub.section.id}`, sections).canonical!;
            expect(new URLSearchParams(canonical.split('?')[1]).get('sub')).toBe(sub.key);
        }
    });
});

describe('子分頁的決定順序', () => {
    it('網址參數 → 上次選的 → 預設（改修）', () => {
        expect(DEFAULT_FACTORY_SUB).toBe('improve');
        expect(resolveFactorySub('build', 'develop')).toBe('build');
        expect(resolveFactorySub(null, 'develop')).toBe('develop');
        expect(resolveFactorySub(null, null)).toBe('improve');
    });

    it('無效的參數或偏好值退回下一順位', () => {
        expect(resolveFactorySub('nope', 'develop')).toBe('develop');
        expect(resolveFactorySub('nope', 'also-nope')).toBe('improve');
        expect(resolveFactorySub(null, 42)).toBe('improve');
    });
});

describe('工廠文案與子分頁列', () => {
    it('側欄標題：繁中「工廠」、日文「工廠」、英文「Arsenal」', () => {
        expect(tFor('zh-TW', 'ov.factory')).toBe('工廠');
        expect(tFor('ja', 'ov.factory')).toBe('工廠');
        expect(tFor('en', 'ov.factory')).toBe('Arsenal');
        expect(factorySection.titleKey).toBe('ov.factory');
    });

    for (const { code } of LANGS) {
        it(`${code}：子分頁列三顆、只有選取的那顆 aria-selected、沒有鍵名外露`, () => {
            setLang(code);
            const html = factoryNavHtml('develop');
            expect(html.match(/role="tab"/g)).toHaveLength(3);
            expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
            expect(html).toMatch(/data-sub="develop"[^>]*aria-selected="true"/);
            expect(html).not.toMatch(/ov\.fac/);
        });
    }
});

describe('用語', () => {
    it('繁中建造／開發子分頁的欄位叫「旗艦」，日文與英文不動', () => {
        expect(tFor('zh-TW', 'ov.buildColSecretary')).toBe('旗艦');
        expect(tFor('ja', 'ov.buildColSecretary')).toBe('秘書艦');
        expect(tFor('en', 'ov.buildColSecretary')).toBe('Secretary');
    });

    it('改修用的第 2 位艦：繁中「改修秘書艦」、日文「2番艦」、英文「Helper」', () => {
        expect(tFor('zh-TW', 'ov.ipHelperPick')).toBe('改修秘書艦');
        expect(tFor('ja', 'ov.ipHelperPick')).toBe('2番艦');
        expect(tFor('en', 'ov.ipHelperPick')).toBe('Helper');
        expect(tFor('zh-TW', 'ov.ipIntro')).toContain('第一艦隊第 2 位的艦');
        expect(tFor('en', 'ov.ipIntro')).toContain('2nd ship in Fleet 1');
        expect(t('ov.ipIntro')).not.toMatch(/第二艦/);
    });
});
