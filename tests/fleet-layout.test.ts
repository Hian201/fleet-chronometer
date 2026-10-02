import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 面板編成版面硬約束：370px 內容寬度、三列艦身、七船完整顯示；
// 730px 排版目標、740px 硬上限；遠征各門檻雙欄並保留完整條件名稱。離線預覽：
//   npx vite-node --config vitest.config.ts tools/preview/panel-sortie.ts
const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const panelMain = readFileSync(new URL('../entrypoints/panel/main.ts', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../tools/preview/panel-sortie.ts', import.meta.url), 'utf8');
const expedPreview = readFileSync(new URL('../tools/preview/panel-exped.ts', import.meta.url), 'utf8');
const expedEditorialPreview = readFileSync(new URL('../tools/preview/panel-exped-editorial.ts', import.meta.url), 'utf8');
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
const compactGearRowFn = panelMain.slice(
    panelMain.indexOf('function compactGearRow'),
    panelMain.indexOf('function compactShipRow'),
);
const compactShipRowFn = panelMain.slice(
    panelMain.indexOf('function compactShipRow'),
    panelMain.indexOf('// 聯合艦隊：頂部一列'),
);

describe('編成版面', () => {
    it('六／七船編成以 730px 為排版目標，預覽超線必須標紅', () => {
        expect(preview).toContain('const FLEET_SAFE_HEIGHT = 730;');
        expect(preview).toContain('used > FLEET_SAFE_HEIGHT');
        expect(preview).toContain("+ FLEET_SAFE_HEIGHT + 'px 安全線'");
        expect(preview).not.toContain('760px 安全線');
        expect(expedPreview).toContain('const FLEET_LAYOUT_GOAL = 730;');
    });

    it('正式面板內容區固定 370px 寬、850px 高，資訊區仍固定 270px', () => {
        expect(css).toMatch(/#tabpanel\s*\{[^}]*height:\s*270px/);
        expect(css).not.toMatch(/#tabpanel\s*\{[^}]*max-height:\s*270px/);
        expect(background).toMatch(/type:\s*'popup',\s*width:\s*370,\s*height:\s*850/);
        expect(panelMain).toContain('PANEL_INNER_WIDTH = 370');
        expect(panelMain).toContain('function fitPanelInnerWidth');
        expect(panelMain).not.toMatch(/fetch\(['"]http:\/\/127\.0\.0\.1:7295\/ingest/);
    });

    it('單隊列採三列艦身，保留原艦種徽章與完整裝備／增設 chip', () => {
        expect(css).toMatch(/\.ship-body\s*\{[^}]*grid-template-columns:\s*32px\s+minmax\(0,\s*1fr\)/);
        expect(css).toMatch(/\.ship-kind-status\s*\{[^}]*justify-content:\s*center/);
        expect(css).toMatch(/\.ship-kind-status\.has-state\s*\{[^}]*justify-content:\s*space-evenly/);
        expect(css).toMatch(/\.ship-kind-status\s*>\s*\.stype\s*\{[^}]*width:\s*32px/);
        expect(css).toMatch(/\.ship-state\s*\{[^}]*width:\s*32px/);
        expect(css).toMatch(/\.ship-state \.taiha-hp-mark[\s\S]*?width:\s*32px/);
        expect(css).toMatch(/\.ship-id\s*\{[^}]*height:\s*12px|\.ship-identity-row\s*\{[^}]*height:\s*12px/);
        // .ship-hp 是 display: contents，血條與數字直接落在 .ship-main 的第 2 列（11px）。
        expect(css).toMatch(/\.ship-main\s*\{[^}]*grid-template-rows:\s*12px\s+11px\s+16px/);
        expect(css).toMatch(/\.ship-hp\s*\{[^}]*display:\s*contents/);
        expect(css).toMatch(/\.escaped \.ship-hp > \*/);
        expect(css).toMatch(/\.hp-num\s*\{[^}]*font-size:\s*11px/);
        expect(css).toMatch(/\.hp-num\s*\{[^}]*font-weight:\s*400/);
        expect(css).toMatch(/\.ship-gear-row\s*\{[^}]*height:\s*16px/);
        expect(css).toMatch(/\.ship-gear-row\s*>\s*\.cond[\s\S]*?width:\s*28px/);
        expect(css).toMatch(/\.vit-sup\.resource-pair[\s\S]*?width:\s*51px/);
        expect(css).toMatch(/\.resource-bar\.fuel\s*\{[^}]*color:\s*#58a55c/);
        expect(css).toMatch(/\.resource-bar\.ammo\s*\{[^}]*color:\s*#a8763e/);
        expect(css).toMatch(/\.resource-percent\s*\{[^}]*color:\s*#fff/);
        expect(css).toMatch(/\.ship-gear-row\s*>\s*\.chips\s*\{[^}]*width:\s*221px/);
        expect(css).toMatch(/\.ship-gear-row \.chip:not\(\.ex\)\s*\{[^}]*width:\s*36px/);
        expect(css).toMatch(/\.ship-gear-row \.chip\.ex\s*\{[^}]*width:\s*31px/);
        expect(css).toMatch(/\.chips\s*\{[^}]*flex-wrap:\s*nowrap/);
        expect(css).toMatch(/\.chip\s*\{[^}]*width:\s*40px/);
        expect(css).toMatch(/\.chip\.ex\s*\{[^}]*min-width:\s*34px/);
        expect(css).toMatch(/\.chips\s*\{[^}]*overflow:\s*visible/);
        expect(panelMain).toContain('const vitSupply =');
        expect(panelMain).toContain('class="resource-bar ${kind}"');
        expect(panelMain).toContain('Math.max(0, Math.min(100');
        expect(panelMain).toContain('class="vit-sup resource-pair"');
        expect(shipRowFn).toContain('vitSupply(s)');
        expect(shipRowFn).not.toContain('supply-combo');
        expect(shipRowFn).toContain('class="ship-body"');
        expect(shipRowFn).toContain('class="ship-kind-status');
        expect(shipRowFn).toContain('class="ship-identity-row"');
        expect(shipRowFn).toContain('class="ship-hp"');
        expect(shipRowFn).toContain('class="ship-gear-row"');
        expect(shipRowFn).not.toMatch(/ship-row1|ship-row2|ship-aux|ship-ops/);
        expect(panelMain).toContain('FLEET_REGULAR_SLOTS = 5');
        expect(panelMain).toContain('FLEET_REGULAR_SLOTS - s.gears.length');
        expect(shipRowFn).toContain("blankChip('chip-pad ex', true)");
        expect(panelMain).not.toMatch(/maxSlots = Math\.max/);
    });

    it('一至六船共用單艦列規格，七船維持高度預算專用微調', () => {
        expect(panelMain).toContain("f.ships.length === 6 ? ' fleet-six' : ''");
        expect(panelMain).toContain("f.ships.length >= 7 ? ' fleet-seven' : ''");
        expect(panelMain).toContain("ops ? ' fleet-ops' : ' fleet-no-ops'");
        expect(css).toMatch(/\.fleet:not\(\.compact\)\s*>\s*\.ship:has\(\.ship-body\)\s*\{[^}]*padding:\s*3px 4px/);
        expect(css).toMatch(/\.fleet:not\(\.compact\)\s*>\s*\.ship\s*>\s*\.ship-body \.ship-main\s*\{[^}]*row-gap:\s*1px/);
        expect(css).toMatch(/\.fleet:not\(\.compact\):not\(\.fleet-seven\)\.fleet-no-ops[^}]*\{[^}]*margin-bottom:\s*8px/);
        expect(css).toMatch(/\.fleet:not\(\.compact\):not\(\.fleet-seven\)\.fleet-no-ops\s*>\s*\.fsummary\s*\{[^}]*margin-bottom:\s*4px/);
        expect(css).toMatch(/\.fleet:not\(\.compact\):not\(\.fleet-seven\)\.fleet-ops\s*>\s*\.fsummary\s*\{[^}]*margin-bottom:\s*1px/);
        expect(css).toMatch(/\.fleet:not\(\.compact\)\s*>\s*\.ship:has\(\.ship-body\):not\(:last-child\)\s*\{[^}]*margin-bottom:\s*5px/);
        expect(css).not.toContain('.fleet.fleet-six > .ship:has(.ship-body) {');
        expect(css).toMatch(/\.fleet\.fleet-seven\s*>\s*\.ship:has\(\.ship-body\)\s*\{[^}]*padding:\s*1px 4px/);
        expect(css).toMatch(/\.fleet\.fleet-seven\.fleet-ops\s*>\s*\.ship:has\(\.ship-body\)\s*\{[^}]*padding-bottom:\s*0/);
        expect(css).toMatch(/\.fleet\.fleet-seven\.fleet-ops\s*>\s*\.fsummary\s*\{[^}]*padding-bottom:\s*3px;[^}]*height:\s*40px/);
        expect(css).toMatch(/\.fleet\.fleet-seven\.fleet-ops\s*>\s*\.ship:has\(\.ship-body\):not\(:last-child\)\s*\{[^}]*margin-bottom:\s*3px/);
        expect(preview).toContain('fleet-six${ops ?');
        expect(preview).toContain('fleet-no-ops');
        expect(preview).toContain("id: 'five-fleet-spacing'");
        expect(preview).toContain("id: 'five-fleet-spacing-ops'");
        expect(preview).toContain('Five ships · no .fs-ops');
        expect(preview).toContain('Five ships · with .fs-ops');
        expect(preview).toContain('const FIVE_FLEET_SPACING_HTML');
        expect(preview).toContain('const FIVE_FLEET_SPACING_OPS_HTML');
        expect(preview).toContain('摘要指標至首艦與艦間距皆為 8px');
        expect(preview).toContain('摘要指標至首艦與艦間距皆為 5px');
        expect(preview).toContain('摘要至首艦 \' + metricsGap + \'px／艦間距 \' + shipGap + \'px');
    });

    it('遠征成功與大成功門檻分組雙欄，12 項預覽允許換行且保留完整條件', () => {
        expect(panelMain).toContain("renderTier(t('exped.successThreshold'), rows, true)");
        expect(panelMain).toContain("renderTier(t('exped.gsThreshold'), gsRows)");
        expect(panelMain).toContain('[...unmet, ...met]');
        expect(css).toMatch(/\.exped-check-group\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
        expect(css).toMatch(/\.check-row \.grow\s*\{[^}]*white-space:\s*normal/);
        expect(css).toMatch(/\.check-row \.grow\s*\{[^}]*overflow:\s*visible/);
        expect(css).toMatch(/\.check-row \.grow\s*\{[^}]*overflow-wrap:\s*anywhere/);
        expect(css).toMatch(/\.check-row \.num\s*\{[^}]*text-align:\s*right/);
        expect(expedPreview).toContain("id: 'max-12'");
        expect(expedPreview).toContain('不截斷');
        expect(expedPreview).toContain('370×850');
        expect(expedEditorialPreview).toContain('data-scene="max-12"');
        expect(expedEditorialPreview).toContain('class="exped-check-group"');
    });

    it('摘要兩列不 wrap：狀態列與統計卡片正常字重、索敵倍率整合、索敵 toFixed(1)', () => {
        expect(css).toMatch(/\.fsummary\s*\{[^}]*flex-direction:\s*column/);
        expect(css).toMatch(/\.fs-ops\s*\{[^}]*flex-wrap:\s*nowrap/);
        expect(css).toMatch(/\.fs-metrics\s*\{[^}]*flex-wrap:\s*nowrap/);
        expect(panelMain).toContain('class="fs-op');
        expect(panelMain).toContain('class="fs-metric fs-los');
        expect(panelMain).toContain('class="fs-scale');
        expect(panelMain).toContain('data-accelerated');
        expect(panelMain).toContain('function speedTone');
        expect(panelMain).toContain("t('fleet.airPowerShort')");
        expect(panelMain).toContain("t('fleet.scouting33Short')");
        expect(panelMain).toContain("t('order.speedShort')");
        expect(panelMain).toContain('fs-pri');
        expect(panelMain).toContain('fs-sec');
        expect(panelMain).toContain('sum.f33.toFixed(1)');
        expect(css).toMatch(/\.fs-metric \.fs-value,[\s\S]*?font-weight:\s*400/);
        expect(css).toMatch(/\.fs-scale select\.cn\s*\{[\s\S]*?color-scheme:\s*dark/);
        expect(css).toMatch(/\.fs-op\.repair\[data-accelerated="true"\] \.fs-op-time\s*\{[\s\S]*?color:\s*var\(--sparkle\)/);
        expect(css).toMatch(/\.fs-metrics\s*\{[^}]*gap:\s*3px/);
        expect(css).toMatch(/\.fs-metrics\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*70px\)\s+minmax\(0,\s*86px\)\s+minmax\(0,\s*62px\)\s+minmax\(0,\s*52px\)\s+minmax\(0,\s*48px\)/);
        expect(css).toMatch(/\.fs-metrics\s*\{[^}]*width:\s*100%/);
        expect(css).toMatch(/\.fs-metrics\s*\{[^}]*max-width:\s*100%/);
        expect(css).toMatch(/\.fs-metric\s*\{[\s\S]*?padding:\s*0 3px/);
        expect(css).toMatch(/\.fs-los\s*\{[\s\S]*?padding:\s*0 3px/);
        expect(css).toMatch(/\.fs-scale\s*\{[\s\S]*?flex:\s*0 0 28px/);
        expect(css).toMatch(/\.fs-scale select\.cn\s*\{[\s\S]*?padding:\s*0 11px 0 5px/);
        expect(css).toMatch(/\.fs-metrics\s*\{[^}]*overflow:\s*hidden/);
        expect(css).toMatch(/\.fsummary\s*\{[^}]*overflow:\s*hidden/);
        expect(panelMain).toContain('document.documentElement.clientWidth');
        expect(panelMain).toContain('browser.windows.update');
        expect(css).toMatch(/\.fs-air \.fs-value\s*\{[\s\S]*?font-size:\s*11px/);
        expect(css).toMatch(/\.fs-tp \.fs-value\s*\{[\s\S]*?font-size:\s*11px/);
        expect(css).toMatch(/\.fs-speed \.fs-value\s*\{[\s\S]*?font-size:\s*9px/);
        expect(css).toMatch(/\.fs-metric \.fs-label\s*\{[\s\S]*?font-size:\s*7px/);
        expect(css).toMatch(/\.fs-metric \.fs-value,[\s\S]*?min-width:\s*0/);
        expect(css).toMatch(/\.fs-metric\s*\{[\s\S]*?background:\s*var\(--panel\)/);
        expect(css).toMatch(/\.fs-metric\s*\{[\s\S]*?width:\s*100%/);
        expect(css).toMatch(/\.fs-metric\s*\{[\s\S]*?overflow:\s*hidden/);
        expect(css).not.toMatch(/:root\[lang="en"\] \.fs-metrics/);
        expect(css).toMatch(/\.fs-op-unknown\s*\{[\s\S]*?border-left:\s*1px solid var\(--line\)/);
        expect(css).toMatch(/\.fs-scale select\.cn\s*\{[\s\S]*?background:\s*var\(--panel\)/);
        expect(panelMain).toContain('const tp = sum.tp');
        expect(panelMain).not.toContain('sum.tp.gear > 0');
        expect(preview).toContain("{ air: '1234', lv: '1234', tp: '104' }");
        expect(preview).toContain("summaryMetrics({ air: '1234~1245', los: '-20.6', lv: '1234', tp: '104' })");
        expect(preview).toContain("const summaryLanguagePage = (lang: 'zh-TW' | 'en' | 'ja')");
        expect(panelMain).not.toContain('badge-tag danger');
        expect(panelMain).not.toContain('class="badge-tag mission"');
    });

    it('大破長在艦身：整列紅色警示＋士氣位置標籤，退避與入渠中不算', () => {
        expect(panelMain).toContain('class="taiha-mark"');
        expect(panelMain).toContain('class="taiha-hp-mark"');
        expect(panelMain).toContain('class="taiha-cond-toggle');
        expect(panelMain).toContain('class="dock-mark"');
        expect(css).toMatch(/\.taiha-mark\s*\{[^}]*white-space:\s*nowrap/);
        expect(css).toMatch(/\.ship-state \.taiha-hp-mark[\s\S]*?width:\s*32px/);
        expect(css).toMatch(/\.ship\.c \.taiha-cond-toggle\s*\{[\s\S]*?max-width:\s*3\.2em/);
        expect(i18n).toMatch(/'fleet\.heavyDamage': 'Taiha'/);
        expect(i18n).toMatch(/'fleet\.escaped': 'Esc'/);
        expect(css).toMatch(/\.dock-mark\s*\{[^}]*white-space:\s*nowrap/);
        expect(css).toMatch(/\.ship\.st-major:not\(\.escaped\):not\(\.in-dock\)\s*\{[^}]*box-shadow:\s*none/);
        expect(css).toMatch(/\.ship\.st-major:not\(\.escaped\):not\(\.in-dock\)\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--dmg-major\) 18%, var\(--panel\)\)/);
        expect(css).not.toMatch(/\.st-major:not\(\.escaped\):not\(\.in-dock\)\s*\{[^}]*inset -3px/);
        expect(css).not.toMatch(/inset 0 0 0 1px var\(--dmg-major\)/);
        expect(css).not.toMatch(/\.fleet-seven[^{]*\.st-major[^{]*box-shadow/);
        expect(css).not.toMatch(/\.ship\.c\.st-major[^{]*box-shadow:\s*inset/);
        expect(css).toMatch(/\.st-major:not\(\.in-dock\) \.ship-id \.grow/);
        expect(css).toMatch(/\.ship:has\(\.ship-body\)\.escaped\s*\{[^}]*opacity:\s*1/);
        expect(shipRowFn).toContain('shipStateSlot(s)');
        expect(panelMain).toContain('dockMark(s)');
        expect(panelMain).toContain('taihaHpMark(s)');
        expect(preview).toContain('SIX_FLEET_TAIHA_HTML');
        expect(preview).toContain("id: 'six-fleet-taiha'");
        expect(shipRowFn).toContain('<span class="cond ${condClass(s)}"><span class="cond-spark" aria-hidden="true">✦</span><span class="cond-value">${s.cond}</span></span>${vitSupply(s)}');
        expect(shipRowFn).toContain('<span class="hpbar" aria-hidden="true"><i style="width:${Math.round(r * 100)}%"></i></span><span class="hp-pair">');
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
        expect(css).toMatch(/\.hpbar::after\s*\{[^}]*75%[^}]*50%[^}]*25%/);
        expect(css).toMatch(/--hp-tick:\s*rgba\(255, 255, 255, \.92\)/);
    });

    it('聯合 compact 的五格空母裝備與搭載數維持同一列', () => {
        expect(css).toMatch(/\.c-gear-slots\s*\{[^}]*flex-wrap:\s*nowrap/);
        expect(css).toMatch(/\.c-gear-slots\s*\{[^}]*gap:\s*3px/);
        expect(css).toMatch(/\.cg-item\s*\{[^}]*flex:\s*0 0 auto/);
        expect(preview).toContain('const FIVE_SLOT_CARRIER');
        expect(preview).toContain("cap: [20, 20, 44, 12, 3]");
    });

    it('370px 連合編成保留雙欄、六格極限與雙隊大破預覽', () => {
        expect(preview).toContain("id: 'combined-fleet'");
        expect(preview).toContain("id: 'combined-fleet-six-gear'");
        expect(preview).toContain("id: 'combined-fleet-taiha'");
        expect(preview).toContain("label: '編成預覽｜連合六格極限'");
        expect(preview).toContain('const SIX_GEAR_CARRIER');
        expect(preview).toContain("level: 10");
        expect(preview).toContain('gear rows over width');
        expect(css).toMatch(/\.c-fleet-row\s*\{[^}]*gap:\s*6px/);
        expect(css).toMatch(/section\.fleet\.compact\s*>\s*\.ship\.c:not\(:last-child\)\s*\{[^}]*margin-bottom:\s*6px/);
        expect(css).toMatch(/\.cg-item \.g-icon,\s*\.cg-item \.g-icon-slot\s*\{[^}]*width:\s*14px/);
        expect(css).toMatch(/\.cg-item\.ex em\s*\{[^}]*color:\s*#7fd0ff/);
        expect(compactGearRowFn).toContain("ex && (g.level ?? 0) >= 10 ? '★' : ''");
        expect(preview).toContain("ex && (g.level ?? 0) >= 10 ? '★' : ''");
        expect(preview).toContain('const enCombinedDual');
        expect(preview).toContain('const enCombinedSixGear');
        expect(preview).toContain('.pv-app .sortie-combined-fleet .c-fleet-row {\n  gap: 6px;\n}');
    });

    it('六船／七船功能艦的泊地修理／給糧狀態列納入離線安全線案例', () => {
        expect(preview).toContain('SEVEN_FLEET_REPAIR_HTML');
        expect(preview).toContain('SEVEN_FLEET_MORALE_HTML');
        expect(preview).toContain('SEVEN_FLEET_REPAIR_MORALE_HTML');
        expect(preview).toContain('SEVEN_FLEET_MORALE_UNKNOWN_HTML');
        expect(preview).toContain('SIX_FLEET_MORALE_UNKNOWN_HTML');
        expect(preview).toContain('data-accelerated="${accelerated}"');
        expect(preview).toContain('fleet-seven${ops ? \' fleet-ops\' : \' fleet-no-ops\'}');
        expect(preview).toContain('${ops ? \' fleet-ops\' : \' fleet-no-ops\'}');
        expect(preview).toContain('第一艘為明石改的七船編成');
        expect(preview).toContain('第一艘為野埼改的七船編成');
        expect(preview).toContain('六船單隊出現給糧摘要列');
    });

    it('單艦隊艦種、遠征與入渠標籤對齊目前 renderer 的 .ship-body 莖結構', () => {
        expect(shipRowFn).toContain('<span class="stype">${esc(s.stype)}</span>');
        expect(css).toMatch(/\.ship-kind-status > \.stype,\s*\.c-top \.stype\s*\{/);
        expect(css).toMatch(/\.ship-kind-status > \.stype\s*\{[^}]*width:\s*32px/);
        expect(css).toMatch(/\.fs-tick\.mission,\s*\.dock-mark\s*\{/);
        expect(css).toMatch(/\.fs-tick\.mission\s*\{[^}]*color:\s*var\(--brass\)/);
        expect(css).toMatch(/\.dock-mark\s*\{[^}]*color:\s*#7fd0ff/);
    });

    it('倒數 tick 仍只改 .rcd，不整塊重繪艦隊', () => {
        expect(panelMain).toContain(' rcd ');
        expect(panelMain).toContain('function tickRepairCountdowns');
        expect(panelMain).toContain('.rcd[data-anchor]');
    });

    it('chrome／一般分頁只收 padding、艦／裝數不用 brass', () => {
        expect(css).toMatch(/#fleetnav\s*\{[^}]*padding:\s*3px 10px/);
        expect(css).not.toMatch(/#fleetnav\s*\{[^}]*border-bottom:\s*1px solid var\(--line\)/);
        expect(css).toMatch(/#fleets\s*\{[^}]*padding:\s*4px 10px 2px/);
        expect(css).toMatch(/\.fsummary\.combined-total\s*\{[^}]*padding:\s*0 6px 4px/);
        expect(css).not.toMatch(/\.fsummary\.combined-total\s*\{[^}]*border-bottom:/);
        expect(css).toMatch(/\.combined-wrap\s*\{[^}]*gap:\s*0/);
        expect(css).toMatch(/\.fsummary\s*\{[^}]*gap:\s*2px/);
        expect(css).toMatch(/#header \.stat b\s*\{[^}]*color:\s*var\(--text\)/);
        expect(css).toMatch(/\.g-chip \.g-eta\.grow\s*\{[^}]*color:\s*var\(--dim\)/);
        expect(panelHtml).toContain('id="general-quests" hidden');
        expect(panelMain).toContain('mountGeneral(state, fmt)');
    });
});
