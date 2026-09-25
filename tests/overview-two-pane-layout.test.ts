import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 情報總括「左選右看」雙欄硬約束（docs/design-guidelines.md §4.7）：
// 內容區還放得下兩欄時，不得因 viewport 中等寬度改成單欄往下堆。
const overviewHtml = readFileSync(new URL('../entrypoints/overview/index.html', import.meta.url), 'utf8');
const css = overviewHtml.slice(overviewHtml.indexOf('<style>') + 7, overviewHtml.indexOf('</style>'));
const preview = readFileSync(new URL('../tools/preview/equip-ref.ts', import.meta.url), 'utf8');
const guidelines = readFileSync(new URL('../docs/design-guidelines.md', import.meta.url), 'utf8');
const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');

describe('情報總括雙欄不得過早改單欄', () => {
    it('硬約束寫在 design-guidelines §4.7 與 CLAUDE.md，並指向本測試', () => {
        expect(guidelines).toContain('### 4.7 情報總括雙欄：容器夠寬就並排（硬約束）');
        expect(guidelines).toContain('tests/overview-two-pane-layout.test.ts');
        expect(claude).toContain('§4.7');
    });

    it('配裝參考以 .er 容器寬度決定單欄，不用 viewport 820／760 堆疊', () => {
        expect(css).toMatch(/\.er\s*\{[^}]*container-type:\s*inline-size/);
        expect(css).toMatch(/container-name:\s*er/);
        expect(css).toMatch(/@container er \(max-width:\s*520px\)/);
        expect(css).not.toMatch(/@media \(max-width:\s*820px\)\s*\{[^}]*\.er-layout/);
        expect(css).not.toMatch(/@media \(max-width:\s*760px\)\s*\{[^}]*\.er-layout/);
    });

    it('任務導覽在 ≤760px 仍維持左右兩欄', () => {
        const narrow = css.slice(css.indexOf('/* ── 窄視窗'));
        expect(narrow).toMatch(/\.qf-board\s*\{[^}]*grid-template-columns:\s*minmax\(180px, 38%\) minmax\(0, 1fr\)/);
        expect(narrow).not.toMatch(/\.er-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
        expect(narrow).not.toMatch(/\.qf-board\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    });

    it('離線預覽不得用較晚的 extraCss 把 820px 單欄疊回去', () => {
        expect(preview).toMatch(/@container er \(max-width:\s*520px\)/);
        expect(preview).not.toMatch(/@media \(max-width:\s*820px\)[\s\S]{0,160}\.er-layout/);
    });
});
