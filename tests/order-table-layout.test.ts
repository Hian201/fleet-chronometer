import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const orderSource = readFileSync(new URL('../entrypoints/panel/order.ts', import.meta.url), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));
const gearColsSource = orderSource.slice(orderSource.indexOf('const GEAR_COLS'), orderSource.indexOf('let root'));

describe('調度表格欄位對齊', () => {
    it('表頭標籤與數值置中，排序箭頭使用獨立欄位', () => {
        expect(css).toMatch(/table\.od th\s*\{[^}]*text-align:\s*center;/);
        expect(css).toContain('table.od td { text-align: center; color: var(--text); }');
        expect(css).toMatch(/table\.od th \.od-head\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\);/);
        expect(css).toMatch(/table\.od th \.od-arrow\s*\{[\s\S]*grid-column:\s*3;[\s\S]*pointer-events:\s*none;/);
        expect(css).toContain('table.od th .od-arrow:empty { display: none; }');
    });

    it('艦娘與裝備兩種模式都以獨立標籤呈現表頭文字', () => {
        expect(orderSource).toContain('<span class="od-label">${esc(t(labelKey))}</span>');
        expect(orderSource).toContain('<span class="od-arrow" aria-hidden="true">${arrow}</span>');
    });

    it('裝備表格不顯示艦娘專用的運氣欄', () => {
        expect(gearColsSource).not.toContain("key: 'luck'");
        expect(gearColsSource).not.toContain('ov.rsColLuck');
        expect(orderSource).not.toMatch(/<td>\$\{statOrDot\(g\.stats\.luck\)\}<\/td>/);
    });

    it('裝備艦展開子列 sticky 在可視寬度內，不隨表格橫捲', () => {
        expect(css).toMatch(/table\.od tr\.od-hold \.od-hold-in\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0;/);
        expect(orderSource).toContain('colspan="${GEAR_COLS.length}"');
    });

    it('裝備名稱的展開切換是原生按鈕，鍵盤可操作並回報展開狀態', () => {
        expect(orderSource).toMatch(/<button type="button" class="od-gear" data-gear="\$\{g\.mst\}"[^>]*aria-expanded="\$\{open\}"/);
        expect(orderSource).not.toMatch(/<td[^>]*data-gear=/);
        expect(css).toMatch(/table\.od td\.n \.od-gear:focus-visible\s*\{[^}]*outline:/);
    });

    it('裝備艦檢視不截斷清單，數量／閒置表頭不被壓成省略', () => {
        expect(css).not.toMatch(/od-hv td\.h \.od-hc-list\s*\{[^}]*max-height/);
        expect(css).toMatch(/table\.od\.od-hv th:not\(\.n\):not\(\.h\) \.od-label\s*\{[^}]*overflow:\s*visible;/);
    });
});
