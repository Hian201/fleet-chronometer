import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const panelMain = readFileSync(new URL('../entrypoints/panel/main.ts', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../tools/preview/panel-sortie.ts', import.meta.url), 'utf8');
const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');

describe('出擊面板的固定資訊密度', () => {
    it('敵艦晶片只保留血條，不在卡內重複顯示目前 HP 數字', () => {
        expect(panelMain).not.toContain('s-echip-hp-text');
        expect(panelHtml).not.toContain('.s-echip-hp-text');
    });

    it('十個節點含 Boss 時，標頭不會因 Gauge 的固定預留寬度而裁切節點', () => {
        const sortieHeader = panelHtml.match(/\.sortie-container \{[\s\S]*?\.s-node\.boss \{/)?.[0] ?? '';
        expect(sortieHeader).toContain('gap: 4px');
        expect(sortieHeader).toContain('.s-gauge');
        expect(sortieHeader).toContain('flex: 0 0 auto');
        expect(sortieHeader).toContain('.s-nodes');
        expect(sortieHeader).toContain('gap: 2px');
        expect(sortieHeader).not.toContain('max-width: 122px');
        expect(sortieHeader).not.toContain('flex: 0 1 122px');
    });

    it('只有可驗證的 HP 斬殺期才使用 Final；一般量表數字維持主文字色', () => {
        expect(panelMain).toContain('gaugeBar(\n            remain,\n            gauge.requiredDefeatCount,\n            false,');
        expect(panelHtml).toMatch(/\.s-gauge-num strong\s*\{[^}]*color:\s*var\(--text\)/);
    });

    it('預覽的常態出擊場景不把 Final 當成固定量表狀態', () => {
        expect(preview).not.toContain('finalGaugeHtml(500, 5500, 9.1)');
        expect(preview).not.toContain('finalGaugeHtml(720, 5200, 14)');
        expect(preview).not.toContain('finalGaugeHtml(600, 4000, 15)');
        expect(preview).toContain('normalGaugeHtml(720, 5200, 14)');
        expect(preview).toContain('normalGaugeHtml(600, 4000, 15)');
        expect(preview).toContain('.pv-prop .pv-final-gauge.normal .pv-final-gauge-value strong { color: var(--text); }');
        expect(preview).toContain('finalGaugeHtml(840, 4840, 18)');
    });

    it('敵我飛機戰損在結算後仍保留紅色減少數字', () => {
        expect(panelMain).toContain('const planeCell = (v: { count: number; lost: number }) => `<b>${v.count}</b>${planeLost(v.lost)}`;');
        expect(panelHtml).toMatch(/\.s-air-loss-cell i\s*\{[^}]*color:\s*var\(--dmg-major\)/);
    });

    it('陸航到着使用不裁字的專用標籤規則', () => {
        expect(panelHtml).toMatch(/\.s-system-signal\.lbas \.s-system-label\s*\{[^}]*overflow:\s*visible/);
        expect(panelHtml).toMatch(/\.s-system-signal\.lbas \.s-system-label\s*\{[^}]*text-overflow:\s*clip/);
    });

    it('夜戰裝備列在尚未進入夜戰時仍顯示為未發動狀態', () => {
        expect(panelMain).toContain('const nightHtml = `<div class="s-night-effects"');
        expect(panelMain).not.toContain('const nightHtml = info.midnightFlag ?');
    });

    it('旗艦大破優先於司令部退避；一般大破點擊後只隱藏文字，紅框不收縮', () => {
        expect(panelMain).toContain("} else if (info.isTaiha) {");
        expect(panelMain).toContain('s-taiha-generic open');
        expect(panelMain).toContain('taihaDetailsHidden');
        expect(panelMain).toContain('taiha-toggle');
        expect(panelMain).toContain("taihaHtml && !taihaDetailsHidden ? ' covered' : ''");
        expect(panelHtml).toContain('.s-taiha.open.s-taiha-generic.details-hidden');
        expect(panelHtml).toContain('.s-taiha-generic.details-hidden .taiha-head');
        expect(claude).not.toContain('收縮態浮在');
        expect(claude).not.toContain('預設只收成一條 banner');
    });

    it('斬殺期 Final 沿用量表內的小型淡金字，不被後段覆寫成白色粗字', () => {
        const finalOverrides = panelHtml.match(/\.s-gauge\.zansatsu \.s-gauge-final\s*\{[^}]+\}/g) ?? [];
        expect(finalOverrides.join('\n')).not.toContain('color: #fff');
        expect(finalOverrides.join('\n')).not.toContain('font-weight: 800');
        const finalRule = panelHtml.match(/\.s-gauge-final\s*\{([^}]+)\}/)?.[1] ?? '';
        expect(finalRule).toContain('font-size: 9px');
        expect(finalRule).toContain('font-weight: 700');
        expect(finalRule).not.toContain('color: #fff');
    });

    it('陣形圖示與遊戲風格的戰果 grade 維持黃銅與各 rank 固有色', () => {
        expect(panelHtml).toContain('.s-formation-icon');
        expect(panelHtml).toContain('color: var(--brass);');
        expect(panelHtml).toContain('.s-rank-grade.rank-e { color: #4d8ee8; }');
        expect(panelHtml).toContain('font-family: Georgia');
    });
});
