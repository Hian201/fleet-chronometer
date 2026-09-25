import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getLang, setLang, t } from '../utils/ui-i18n';

const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const panelMain = readFileSync(new URL('../entrypoints/panel/main.ts', import.meta.url), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));

describe('遠征收益與門檻版面', () => {
    it('四項資源共用固定欄位，圖示和右對齊數字上下對齊', () => {
        expect(css).toMatch(/\.exped-resource-matrix\s*\{[^}]*table-layout:\s*fixed/);
        expect(css).toMatch(/\.exped-resource-matrix col\.exped-resource-stub,[\s\S]*?width:\s*112px/);
        expect(css).toMatch(/\.exped-resource-head \.m-icon\s*\{[^}]*width:\s*16px/);
        expect(css).toMatch(/\.exped-resource-head\s*\{[^}]*text-align:\s*right/);
        expect(css).toMatch(/\.exped-resource-head\s*\{[^}]*padding:\s*0 4px !important/);
        expect(css).toMatch(/\.exped-resource-head \.m-icon\s*\{[^}]*margin-left:\s*auto/);
        expect(css).toMatch(/\.exped-resource-head \.m-icon\s*\{[^}]*margin-right:\s*0/);
        expect(css).not.toMatch(/\.exped-resource-head \.m-icon\s*\{[^}]*margin-inline:\s*auto/);
        expect(css).toMatch(/\.exped-resource-value\s*\{[^}]*text-align:\s*right/);
        expect(css).toMatch(/\.exped-resource-value\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
        expect(css).toMatch(/\.exped-resource-value\s*\{[^}]*padding:\s*0 4px !important/);
        expect(panelMain).toContain("file: 'fuel'");
        expect(panelMain).toContain("file: 'ammo'");
        expect(panelMain).toContain("file: 'steel'");
        expect(panelMain).toContain("file: 'bauxite'");
        expect(panelMain).toContain('matIconHtml(`mat.${resource.file}`)');
        expect(panelMain).toContain("const matIconHtml = (key: string) => matIconFile(key.slice(4), t(key))");
    });

    it('獎勵數字沿用預覽的文字色；裝備加成仍保留提示但不改成黃字', () => {
        expect(css).toMatch(/\.exped-resource-value\s*\{[^}]*color:\s*var\(--text\)/);
        expect(css).not.toContain('.exped-resource-value.bonus');
        expect(panelMain).toContain("t('exped.bonusHint')");
        expect(panelMain).not.toContain("exped-resource-value${rewards.bonusActive");
    });

    it('成功狀態與結果名稱同列，數值未知時保留明確提示', () => {
        expect(css).toMatch(/\.exped-outcome-label\s*\{[^}]*display:\s*flex/);
        expect(css).toMatch(/\.exped-outcome-label\s*\{[^}]*white-space:\s*nowrap/);
        expect(panelMain).toMatch(/exped-outcome-status ok" aria-label=/);
        expect(panelMain).toMatch(/exped-outcome-status ng" aria-label=/);
        expect(panelMain).toContain("t('exped.rewardAmountUnverified')");
        expect(panelMain).toContain("greatSuccess.note");
    });

    it('基本成功與大成功門檻分組，各組未達條件先列且固定雙欄', () => {
        expect(css).toMatch(/\.exped-check-group\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
        expect(css).toMatch(/\.exped-conditions\s*\{[^}]*overflow:\s*hidden/);
        expect(css).toMatch(/\.check-row \.grow\s*\{[^}]*white-space:\s*normal/);
        expect(css).toMatch(/\.check-row \.grow\s*\{[^}]*overflow:\s*visible/);
        expect(css).toMatch(/\.check-row \.grow\s*\{[^}]*text-overflow:\s*clip/);
        expect(css).toMatch(/\.check-row \.grow\s*\{[^}]*overflow-wrap:\s*anywhere/);
        expect(css).toMatch(/\.check-row \.num\s*\{[^}]*text-align:\s*right/);
        expect(css).toMatch(/\.exped-tier-heading\s*\{[^}]*height:\s*auto/);
        expect(css).toMatch(/\.exped-tier-heading\s*\{[^}]*font-size:\s*11px/);
        expect(css).toMatch(/\.exped-tier-heading\s*\{[^}]*line-height:\s*15px/);
        expect(css).toMatch(/\.exped-tier-heading\s*\{[^}]*padding:\s*0/);
        expect(css).toMatch(/\.exped-tier-heading\s*\{[^}]*border:\s*0/);
        expect(panelMain).toContain("renderTier(t('exped.successThreshold'), rows, true)");
        expect(panelMain).toContain("renderTier(t('exped.gsThreshold'), gsRows)");
        expect(panelMain).toContain('[...unmet, ...met]');
    });

    it('繁中最長艦種條件作為雙欄換行壓測', () => {
        const preview = readFileSync(new URL('../tools/preview/panel-exped-editorial.ts', import.meta.url), 'utf8');
        expect(preview).toContain('輕空母/空母/水母/裝甲空母 2艘以上');
        expect(preview).toContain('高密度＋長華語');
    });

    it('繁中、日文與英文的標籤、計數與狀態都有翻譯', () => {
        const original = getLang();
        const expected = {
            'zh-TW': { met: '✓ 條件達成', notMet: '✕ 條件未達成', excluded: '✕ 不列入計算', rate: '~0%', shortMet: '✓ 達成', shortNotMet: '✕ 未達', excludedShort: '— 不適用', resources: '遠征資源收益', successThreshold: '成功門檻', gsThreshold: '大成功門檻', metCount: '2 項符合', unmetCount: '2 項未達' },
            ja: { met: '✓ 条件達成', notMet: '✕ 条件未達成', excluded: '✕ 対象外', rate: '目安 0%', shortMet: '✓ 達成', shortNotMet: '✕ 未達', excludedShort: '— 対象外', resources: '遠征資源報酬', successThreshold: '成功条件', gsThreshold: '大成功条件', metCount: '2件達成', unmetCount: '2件未達' },
            en: { met: '✓ Condition Met', notMet: '✕ Condition Not Met', excluded: '✕ Excluded', rate: '~0%', shortMet: '✓ Met', shortNotMet: '✕ Not met', excludedShort: '— N/A', resources: 'Expedition resource rewards', successThreshold: 'Success threshold', gsThreshold: 'Great Success threshold', metCount: '2 met', unmetCount: '2 unmet' },
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
                expect(t('exped.statusMetShort')).toBe(expected[lang].shortMet);
                expect(t('exped.statusNotMetShort')).toBe(expected[lang].shortNotMet);
                expect(t('exped.gsExcludedShort')).toBe(expected[lang].excludedShort);
                expect(t('exped.successThreshold')).toBe(expected[lang].successThreshold);
                expect(t('exped.gsThreshold')).toBe(expected[lang].gsThreshold);
                expect(t('exped.rewardMatrixLabel')).toBe(expected[lang].resources);
                expect(t('exped.metCount', { n: 2 })).toBe(expected[lang].metCount);
                expect(t('exped.unmetCount', { n: 2 })).toBe(expected[lang].unmetCount);
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

    it('道具標籤垂直置中，切換編隊時恢復該隊遠征選擇', () => {
        expect(css).toMatch(/\.exped-items-row\s*\{[^}]*align-items:\s*center/);
        expect(panelMain).toContain('expeditionSelectionForDeck(');
        expect(panelMain).toContain('selectedExpedByFleet.set(currentExpedFleet(), expedId)');
        expect(panelMain).toContain('renderFleetNav(); renderFleets(); renderExped();');
    });
});
