import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getLang, setLang, t } from '../utils/ui-i18n';

const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));

describe('遠征收益 HUD 多語系版面', () => {
    it('收益標籤依內容取寬，中間狀態欄可收縮', () => {
        expect(css).toMatch(/\.exped-yield-grid\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\) auto/);
        expect(css).toMatch(/\.exped-status\s*\{[^}]*min-width:\s*0/);
        expect(css).toMatch(/\.exped-status\s*\{[^}]*white-space:\s*normal/);
        expect(css).toMatch(/\.exped-status\s*\{[^}]*overflow-wrap:\s*anywhere/);
    });

    it('三種語言的收益標籤與狀態文字都有被納入檢查', () => {
        const original = getLang();
        const expected = {
            'zh-TW': { met: '✓ 條件達成', notMet: '✕ 條件未達成', excluded: '✕ 不列入計算', rate: '~0%' },
            ja: { met: '✓ 条件達成', notMet: '✕ 条件未達成', excluded: '✕ 対象外', rate: '目安 0%' },
            en: { met: '✓ Condition Met', notMet: '✕ Condition Not Met', excluded: '✕ Excluded', rate: '~0%' },
        } as const;
        try {
            for (const lang of ['zh-TW', 'ja', 'en'] as const) {
                setLang(lang);
                expect(t('exped.success')).toBeTruthy();
                expect(t('exped.greatSuccess')).toBeTruthy();
                expect(t('exped.successMet')).toBe(expected[lang].met);
                expect(t('exped.successNotMet')).toBe(expected[lang].notMet);
                expect(t('exped.gsExcluded')).toBe(expected[lang].excluded);
                expect(t('exped.gsRate', { rate: 0 })).toBe(expected[lang].rate);
            }
        } finally {
            setLang(original);
        }
    });

    it('長遠征名稱不以省略號截斷，完整文字保留在原生選項內', () => {
        expect(css).toMatch(/\.exped-detail\s*\{[^}]*white-space:\s*normal/);
        expect(css).toMatch(/\.exped-detail\s*\{[^}]*overflow-wrap:\s*anywhere/);
        expect(css).not.toMatch(/\.exped-detail\s*\{[^}]*text-overflow:\s*ellipsis/);
        expect(css).toMatch(/\.exped-select option,\s*\.exped-select optgroup\s*\{[^}]*white-space:\s*normal/);
        expect(css).toMatch(/\.exped-select option,\s*\.exped-select optgroup\s*\{[^}]*overflow-wrap:\s*anywhere/);
        expect(panelHtml).not.toContain('id="exped-current-name"');
    });

    it('原生遠征下拉選單沿用面板深色底，亮色主題才切換為亮色', () => {
        expect(css).toMatch(/\.exped-select\s*\{[^}]*color-scheme:\s*dark/);
        expect(css).toMatch(/\.exped-select option,\s*\.exped-select optgroup\s*\{[^}]*background:\s*var\(--menu\)/);
        expect(css).toMatch(/:root\[data-theme="light"\]\s+\.exped-select\s*\{[^}]*color-scheme:\s*light/);
    });
});
