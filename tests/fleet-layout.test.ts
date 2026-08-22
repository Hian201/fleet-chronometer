import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 面板編成版面硬約束（見 CLAUDE.md 慣例）：#tabpanel 270px 不放寬；七船單行裝備；
// 左欄五格＋打洞、右欄 96px 儀器（對齊預覽）；摘要兩列不 wrap；大破不進摘要；
// 連合不顯示泊地修理／給糧。離線預覽：
//   npx vite-node --config vitest.config.ts tools/preview/panel-sortie.ts
const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const panelMain = readFileSync(new URL('../entrypoints/panel/main.ts', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../tools/preview/panel-sortie.ts', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../utils/ui-i18n.ts', import.meta.url), 'utf8');
const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));
const combinedFn = panelMain.slice(
    panelMain.indexOf('function renderCombinedFleets'),
    panelMain.indexOf('function renderFleets'),
);
const shipRowFn = panelMain.slice(
    panelMain.indexOf('function shipRow'),
    panelMain.indexOf('function renderExped'),
);
const compactShipRowFn = panelMain.slice(
    panelMain.indexOf('function compactShipRow'),
    panelMain.indexOf('// 聯合艦隊：頂部一列'),
);

describe('編成版面', () => {
    it('七船編成硬安全線固定 740px，預覽超線必須標紅', () => {
        expect(preview).toContain('const FLEET_SAFE_HEIGHT = 740;');
        expect(preview).toContain('used > FLEET_SAFE_HEIGHT');
        expect(preview).toContain("+ FLEET_SAFE_HEIGHT + 'px 安全線'");
        expect(preview).not.toContain('760px 安全線');
    });

    it('#tabpanel 固定 270px，不准改 max-height', () => {
        expect(css).toMatch(/#tabpanel\s*\{[^}]*height:\s*270px/);
        expect(css).not.toMatch(/#tabpanel\s*\{[^}]*max-height:\s*270px/);
        expect(background).toMatch(/width:\s*420,\s*height:\s*850/);
    });

    it('裝備列 nowrap，一般格 40／打洞 34；單隊列燃彈不走 supply-combo chip', () => {
        expect(css).toMatch(/\.chips\s*\{[^}]*flex-wrap:\s*nowrap/);
        expect(css).toMatch(/\.chip\s*\{[^}]*width:\s*40px/);
        expect(css).toMatch(/\.chip\.ex\s*\{[^}]*min-width:\s*34px/);
        expect(css).toMatch(/\.chips\s*\{[^}]*max-width:\s*100%/);
        expect(css).toMatch(/\.chips\s*\{[^}]*width:\s*244px/);
        expect(css).toMatch(/\.chips\s*\{[^}]*overflow:\s*visible/);
        expect(panelMain).toContain('class="vit-sup"');
        expect(shipRowFn).toContain('vitSupply(s)');
        expect(shipRowFn).not.toContain('supply-combo');
        expect(shipRowFn).toContain('class="ship-body"');
        expect(shipRowFn).not.toContain('class="ship-row"');
        expect(panelMain).toContain('FLEET_REGULAR_SLOTS = 5');
        expect(panelMain).toContain('FLEET_REGULAR_SLOTS - s.gears.length');
        expect(shipRowFn).toContain("blankChip('chip-pad ex', true)");
        expect(panelMain).not.toMatch(/maxSlots = Math\.max/);
    });

    it('單隊列：左欄裝備、右欄 96px 儀器；彈藥不進裝備列', () => {
        expect(css).toMatch(/\.ship-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+96px/);
        expect(css).toMatch(/\.ship-body\s*\{[^}]*row-gap:\s*6px/);
        expect(css).toMatch(/\.ship:has\(\.ship-body\)\s*\{[^}]*padding:\s*4px 6px/);
        expect(css).toMatch(/\.ship-body > \.sub-row\s*\{[^}]*grid-column:\s*1;/);
        expect(css).not.toMatch(/\.ship-body > \.sub-row\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
        expect(css).toMatch(/\.ship-vitals\s*\{[^}]*grid-column:\s*2/);
        expect(css).toMatch(/\.chips\s*\{[^}]*flex:\s*0 0 auto/);
        expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/);
        expect(css).toMatch(/\.vit-hp \.hpbar\s*\{[^}]*width:\s*100%/);
        expect(css).toMatch(/\.hp-num\s*\{[^}]*font-size:\s*12px/);
        expect(css).toMatch(/\.ship\.st-minor \.hp-num[\s\S]*?color:\s*var\(--dmg-minor\)/);
        expect(css).toMatch(/\.ship\.st-mid \.hp-num[\s\S]*?color:\s*var\(--dmg-mid\)/);
        expect(css).toMatch(/\.ship\.st-major \.hp-num[\s\S]*?color:\s*var\(--dmg-major\)/);
        expect(css).toMatch(/\.vit-sup \.sup-f\s*\{[^}]*color:\s*#58a55c/);
        expect(css).toMatch(/\.vit-sup \.m-icon\s*\{[^}]*min-width:\s*10px/);
        expect(css).toMatch(/\.ship-id \.stype[\s\S]*?background:\s*none/);
        expect(css).toMatch(/\.ship-id \.stype[\s\S]*?font-size:\s*10px/);
        expect(css).toMatch(/\.ship-id > \.grow\s*\{[^}]*font-size:\s*12px/);
        expect(css).toMatch(/\.ship-id > \.num\s*\{[^}]*font-size:\s*10px/);
        expect(css).toMatch(/\.chip \.g-icon,\s*\.chip \.g-icon-slot\s*\{[^}]*height:\s*16px/);
        expect(css).not.toMatch(/\.chip \.g-icon,\s*\.chip \.g-icon-slot\s*\{[^}]*height:\s*20px/);
        expect(css).toMatch(/\.chip\s*\{[^}]*font-size:\s*10px/);
        expect(css).toMatch(/\.chip u\s*\{[^}]*font-size:\s*10px/);
        expect(css).toMatch(/\.r-col \.oc\s*\{[^}]*font-size:\s*8px/);
        expect(css).toMatch(/\.ship\.c \.c-top\s*\{[^}]*font-size:\s*12px/);
        expect(shipRowFn).toContain('class="ship-vitals"');
        expect(shipRowFn).toContain('class="vit-aux"');
        expect(shipRowFn.indexOf('vitSupply(s)')).toBeLessThan(shipRowFn.indexOf('class="sub-row"'));
        expect(panelMain).toContain('function fitPanelInnerWidth');
        expect(panelMain).toContain('PANEL_INNER_WIDTH = 420');
        expect(css).toMatch(/\.fleet\.fleet-seven\s*>\s*\.ship:has\(\.ship-body\)\s*\{[^}]*padding:\s*1px 6px/);
        expect(css).toMatch(/\.fleet\.fleet-seven\s*>\s*\.ship\s*>\s*\.ship-body\s*\{[^}]*row-gap:\s*2px/);
        expect(panelMain).toContain("f.ships.length >= 7 ? ' fleet-seven' : ''");
    });

    it('摘要兩列不 wrap：狀態全稱線框、制空／索敵為主、索敵 toFixed(1)', () => {
        expect(css).toMatch(/\.fsummary\s*\{[^}]*flex-direction:\s*column/);
        expect(css).toMatch(/\.fs-ops\s*\{[^}]*flex-wrap:\s*nowrap/);
        expect(css).toMatch(/\.fs-metrics\s*\{[^}]*flex-wrap:\s*nowrap/);
        expect(panelMain).toContain('class="fs-tick');
        expect(panelMain).toContain('class="fs-pri"');
        expect(panelMain).toContain('class="fs-sec"');
        expect(panelMain).toContain('sum.f33.toFixed(1)');
        expect(panelMain).not.toContain('badge-tag danger');
        expect(panelMain).not.toContain('class="badge-tag mission"');
    });

    it('大破長在艦身：整列紅色警示＋士氣位置標籤，退避與入渠中不算', () => {
        expect(panelMain).toContain('class="taiha-mark"');
        expect(panelMain).toContain('class="taiha-hp-mark"');
        expect(panelMain).toContain('class="taiha-cond-toggle');
        expect(panelMain).toContain('class="dock-mark"');
        expect(css).toMatch(/\.taiha-mark\s*\{[^}]*white-space:\s*nowrap/);
        expect(css).toMatch(/\.dock-mark\s*\{[^}]*white-space:\s*nowrap/);
        expect(css).toMatch(/\.ship\.st-major:not\(\.escaped\):not\(\.in-dock\)[\s\S]*?box-shadow:\s*inset 0 0 0 1px var\(--dmg-major\)/);
        expect(css).not.toMatch(/\.ship\.st-major:not\(\.escaped\):not\(\.in-dock\)[\s\S]*?inset -3px 0 0 0 var\(--dmg-major\)/);
        expect(css).toMatch(/\.st-major:not\(\.in-dock\) \.ship-id \.grow/);
        expect(shipRowFn).toContain('s.inDock');
        expect(shipRowFn).toContain('dockMark(s)');
        expect(shipRowFn).toContain('taihaHpMark(s)');
        expect(shipRowFn).toContain('<span class="cond ${condClass(s)}">${s.cond}</span>');
        expect(shipRowFn).not.toContain('condDisplay(s)');
        const dockMarkFn = panelMain.slice(
            panelMain.indexOf('function dockMark'),
            panelMain.indexOf('function shipRow'),
        );
        expect(dockMarkFn).not.toContain('data-complete');
        expect(dockMarkFn).not.toContain('dockCompleteAt');
        expect(dockMarkFn).not.toContain('fmt(');
        expect(panelMain).not.toContain('.rcd[data-complete]');
        expect(i18n).toMatch(/'fleet\.inDock': '入渠'/);
        expect(i18n).not.toMatch(/'fleet\.inDock': '修理中'/);
    });

    it('連合不顯示泊地修理／給糧，compact 用 c-hp 而非條件列徽章', () => {
        expect(combinedFn).not.toContain('repairPlansOf');
        expect(combinedFn).not.toContain('repairMarks');
        expect(combinedFn).not.toContain('fsummary compact');
        expect(panelMain).toContain('class="c-hp"');
        expect(panelMain.indexOf('<div class="c-hp"><span class="hpbar"')).toBeLessThan(
            panelMain.indexOf('<span class="c-hp-value"'),
        );
        expect(compactShipRowFn).not.toContain('<span class="lv">Lv${s.lv}</span>');
        const previewCompactShipRowFn = preview.slice(
            preview.indexOf('const compactShipRow'),
            preview.indexOf('const combinedFleetColumn'),
        );
        expect(previewCompactShipRowFn).not.toContain('<span class="lv">Lv${s.lv}</span>');
        expect(panelMain).toContain('fleetsEl.addEventListener(\'click\'');
        expect(panelMain).toMatch(/<span class="c-aux">\$\{supply\}<\/span>/);
        expect(css).toMatch(/\.ship\.c \.c-hp\s*\{/);
        expect(css).toMatch(/\.ship\.c \.c-hp\s*\{[\s\S]*?justify-content:\s*flex-start/);
        expect(css).toMatch(/\.ship\.c \.c-hp \.hpbar\s*\{[\s\S]*?flex:\s*1 1 auto/);
    });

    it('單艦隊艦種、遠征與入渠標籤對齊目前 renderer 的 .ship-id 結構', () => {
        expect(shipRowFn).toContain('<span class="stype">${esc(s.stype)}</span>');
        expect(css).toMatch(/\.ship-id \.stype,\s*\.c-top \.stype\s*\{/);
        expect(css).toMatch(/\.ship-id \.stype\s*\{[^}]*width:\s*32px/);
        expect(css).toMatch(/\.fs-tick\.mission,\s*\.dock-mark\s*\{/);
        expect(css).toMatch(/\.fs-tick\.mission\s*\{[^}]*color:\s*var\(--brass\)/);
        expect(css).toMatch(/\.dock-mark\s*\{[^}]*color:\s*#7fd0ff/);
    });

    it('倒數 tick 仍只改 .rcd，不整塊重繪艦隊', () => {
        expect(panelMain).toContain('class="rcd"');
        expect(panelMain).toContain('function tickRepairCountdowns');
        expect(panelMain).toContain('.rcd[data-anchor]');
    });

    it('chrome／一般分頁只收 padding、艦／裝數不用 brass', () => {
        expect(css).toMatch(/#fleetnav\s*\{[^}]*padding:\s*3px 10px/);
        expect(css).toMatch(/#fleets\s*\{[^}]*padding:\s*4px 10px 2px/);
        expect(css).toMatch(/#header \.stat b\s*\{[^}]*color:\s*var\(--text\)/);
        expect(css).toMatch(/\.g-chip \.g-eta\.grow\s*\{[^}]*color:\s*var\(--dim\)/);
        expect(panelMain).toContain('class="q-prog"');
        expect(panelMain).toContain('class="q-st"');
    });
});
