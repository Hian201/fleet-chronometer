import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formationRects } from '../utils/formation-geometry';
import { setLang, t } from '../utils/ui-i18n';

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

    it('左側出擊資訊區保留底色但不繪製大外框', () => {
        expect(panelHtml).toMatch(/\.s-eside\s*\{[\s\S]*?border:\s*0;/);
        expect(preview).toMatch(/\.pv-prop \.s-eside\s*\{[\s\S]*?border:\s*0;/);
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

    it('陸航抵達使用不裁字的專用標籤規則', () => {
        expect(panelHtml).toMatch(/\.s-system-signal\.lbas \.s-system-label\s*\{[^}]*overflow:\s*visible/);
        expect(panelHtml).toMatch(/\.s-system-signal\.lbas \.s-system-label\s*\{[^}]*text-overflow:\s*clip/);
    });

    it('夜戰裝備未發動或狀態未知時轉灰階，發動才顯示原色', () => {
        expect(panelHtml).toMatch(/\.s-night-effect\.off\s*\{[^}]*grayscale\(100%\)/);
        expect(panelHtml).toMatch(/\.s-night-effect\.unknown\s*\{[^}]*grayscale\(100%\)/);
        expect(panelHtml).not.toMatch(/\.s-night-effect\.on\s*\{[^}]*grayscale/);
    });

    it('支援列前兩格保留完整支援／陸航文字，其他三格維持圖示與短狀態', () => {
        expect(panelHtml).toContain('grid-template-columns: minmax(0, 36fr) minmax(0, 36fr) minmax(0, 33fr) minmax(0, 31fr) minmax(0, 24fr);');
        expect(panelHtml).toContain('.s-action-rail.with-system > .s-system-rail { grid-column: 1; }');
        expect(panelHtml).toContain('.s-action-rail.with-system > .s-drop-slot { grid-column: 2; }');
        expect(panelHtml).toMatch(/\.s-system-signal\.support \.s-system-label\s*\{[^}]*overflow:\s*visible/);
        expect(panelHtml).toContain('.s-system-signal.aaci .s-system-label,');
        expect(panelHtml).toMatch(/\.s-system-signal\.aaci \.s-system-val\s*\{[^}]*overflow:\s*visible/);
        expect(panelHtml).toContain('padding-inline-end: 6px;');
        expect(panelHtml).toContain('.s-system-label { color: var(--dim); font-size: 8.5px; font-weight: 500; }');
        expect(panelHtml).toContain('.s-system-val { color: currentColor; font-size: 8.5px; font-weight: 500; }');
        expect(panelHtml).toContain('.s-system-signal.on .s-system-label { color: var(--sparkle); font-weight: 500; }');
        expect(panelMain).toContain("'sortie.supportRailShelling'");
        expect(panelMain).toContain('const supportRailLabel = support');
        expect(preview).toContain('grid-template-columns: minmax(0, 36fr) minmax(0, 36fr) minmax(0, 33fr) minmax(0, 31fr) minmax(0, 24fr);');
        expect(preview).toContain("const aaciLabel = aaciFired ? '' : '對空 CI';");
        expect(preview).toContain('padding: 0 6px 0 0;');
        expect(preview).toContain('font-weight: 500;');
        expect(preview).not.toContain('.pv-prop .s-system-signal.on .s-system-label {\n  color: var(--sparkle);\n  font-weight: 600;');
        expect(panelMain).toContain('const aaciValue = info.aaci > 0 ? `Typ ${info.aaci}` : \'\';');
        expect(panelMain).toContain('const aaciDetails = info.aaciDetails ?? [];');
        expect(panelMain).toContain('const aaciGearLabel = (detail: typeof aaciDetails[number]): string =>');
        expect(panelMain).toContain('const aaciGearHoverHtml = (detail: typeof aaciDetails[number]): string =>');
        expect(panelMain).toContain('class="s-aaci-gear"');
        expect(panelMain).toContain('${t(\'sortie.aaciEquipment\')}${aaciGearLabel(detail)}');
        expect(panelMain).not.toContain('`Type ${info.aaci}`');
        expect(preview).toContain("aaci: 'Typ 2'");
        expect(preview).toContain('const aaciHoverHtml = aaciDetails.map');
        expect(preview).toContain('const aaciGearHoverHtml =');
        expect(preview).toContain('class="s-aaci-gear"');
        expect(preview).toContain('max-width: calc(100vw - 16px);');
        expect(preview).toContain('flex-direction: column;');
        expect(preview).not.toContain("aaci: 'Type 2'");
    });

    it('掉落櫻錨由正式與預覽共用的金色／灰色透明資產呈現', () => {
        expect(panelMain).toContain("sakura-anchor-new.png");
        expect(panelMain).toContain("sakura-anchor-owned.png");
        expect(panelHtml).toContain('.s-sakura-anchor.new');
        expect(panelHtml).toContain('.s-sakura-anchor.owned');
        expect(preview).toContain("sakura-anchor-new.png");
        expect(preview).toContain("sakura-anchor-owned.png");
    });

    it('夜戰裝備列在尚未進入夜戰時仍顯示為未發動狀態', () => {
        expect(panelMain).toContain('const nightHtml = `<div class="s-night-effects"');
        expect(panelMain).not.toContain('const nightHtml = info.midnightFlag ?');
    });

    it('友軍 hover 以逐艦換行清單呈現，不用斜線串接', () => {
        expect(panelMain).toContain('const friendlyFleetShipNames = friendlyFleet?.map(id => state.shipName(id)).filter(Boolean) ?? [];');
        expect(panelMain).toContain('friendlyFleetShipNames.join(\'\\n\')');
        expect(panelMain).toContain('class="s-friendly-hover"');
        expect(panelMain).toContain('friendlyFleetShipNames.map(name => `<span>${esc(name)}</span>`).join(\'\')');
        expect(panelHtml).toContain('.s-friendly-hover > span { display: block; }');
        expect(preview).toContain('friendlyShips: string[] = [],');
        expect(preview).toContain('class="s-friendly-hover"');
        expect(preview).toContain('friendlyShips.map(ship => `<span>${esc(ship)}</span>`).join(\'\')');
        expect(preview).toContain("friendlyShips.join('\\n')");
    });

    it('對空 CI 只保留白色自訂 tooltip，不再輸出黑色原生 title', () => {
        expect(panelMain).toContain('const titleAttr = kind === \'aaci\' || !title ? \'\' :');
        expect(panelMain).toContain('const aaciGunHtml = () => `<span class="s-system-glyph aaci">');
        expect(preview).toContain("const signalTitle = kind === 'contact' || kind === 'aaci' ? '' : title;");
        expect(preview).toContain('const aaciGunIconHtml = () =>\n    `<span class="s-system-glyph aaci">');
    });

    it('日戰預測到聯合艦隊夜戰目標時，不因舊資料缺少 midnightFlag 而隱藏指示', () => {
        expect(panelMain).toContain('const showNightEntry = true;');
        expect(panelMain).toContain("const nightEntryUnavailable = !info.midnightFlag && !nightObserved && !info.nightTarget;");
        expect(panelMain).toContain('const nightEntryHtml = !showNightEntry ?');
    });

    it('旗艦大破優先於司令部退避；大破警告點擊後只隱藏文字，紅框不收縮', () => {
        expect(panelMain).toContain("} else if (info.isTaiha) {");
        expect(panelMain).toContain('s-taiha-toggle open');
        expect(panelMain).toContain('taihaDetailsHidden');
        expect(panelMain).toContain('taiha-toggle');
        expect(panelMain).toContain("taihaHtml && !taihaDetailsHidden ? ' covered' : ''");
        expect(panelHtml).toContain('.s-taiha.open.s-taiha-toggle.details-hidden');
        expect(panelHtml).toContain('.s-taiha-toggle.details-hidden .taiha-head');
        // 可切換提示：折角只出現在一般大破，兩態都要看得到，切換方向寫進提示與無障礙名稱。
        expect(panelMain).toContain('<span class="taiha-flip" aria-hidden="true"></span>');
        expect(panelMain).toContain('s-taiha-${taihaWarning.kind} s-taiha-toggle open');
        expect(panelMain).not.toContain('<div class="taiha-alert s-taiha s-taiha-flagship');
        expect(panelMain).toContain("taihaDetailsHidden ? 'sortie.taihaExpandHint' : 'sortie.taihaCollapseHint'");
        expect(panelHtml).toContain('.s-taiha-toggle.details-hidden .taiha-flip');
        expect(panelHtml).toContain('.s-taiha-toggle:hover .taiha-flip');
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

    it('所有陣形共用置中的六艦位圖稿，且點位不碰圓框', () => {
        const formationIds = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14];
        expect(panelMain).toContain('formationRects(id)');
        expect(preview).toContain('formationRects(id)');
        for (const id of formationIds) {
            const rects = formationRects(id);
            const xs = rects.map(([x]) => x);
            const ys = rects.map(([, y]) => y);
            expect(Math.abs((Math.min(...xs) + Math.max(...xs) + 6) / 2 - 31)).toBeLessThanOrEqual(.5);
            expect(Math.abs((Math.min(...ys) + Math.max(...ys) + 6) / 2 - 31)).toBeLessThanOrEqual(.5);
            for (const [x, y] of rects) {
                for (const [cx, cy] of [[x, y], [x + 6, y], [x, y + 6], [x + 6, y + 6]]) {
                    const sx = 31 + .82 * (cx - 31);
                    const sy = 31 + .82 * (cy - 31);
                    expect(Math.hypot(sx - 31, sy - 31)).toBeLessThan(27);
                }
            }
        }
        expect(formationRects(6)).toEqual([[28, 7], [15, 21], [41, 21], [28, 31], [28, 41], [28, 50]]);
        expect(panelMain).toContain("6: 'form.vigilant'");
        expect(preview).toContain("{ id: 6, label: '警戒陣'");
        expect(preview).toContain('FORMATIONS.filter(f => f.id <= 6)');
        expect(preview).toContain('FORMATIONS.filter(f => f.id > 6)');
    });

    it('敵艦晶片固定高度、長 Rank 不蓋陣形、節點狀態與掉落底色規則在正式與預覽同步', () => {
        for (const source of [panelHtml, preview]) {
            expect(source).toContain('flex: 0 0 25px');
            expect(source).toContain('min-height: 25px');
            expect(source).toContain('height: 25px');
            expect(source).toContain('gap: 2px');
            expect(source).toContain('text-overflow: ellipsis');
        }
        expect(panelHtml).toContain('grid-template-columns: 18px minmax(0, 1fr)');
        expect(preview).toContain('grid-template-columns: 18px minmax(0, 1fr)');
        expect(panelHtml).toContain('width: 18px;');
        expect(preview).toContain('width: 18px;');
        expect(panelHtml).toMatch(/\.s-nodes\s*\{[\s\S]*?padding-inline:\s*4px;/);
        expect(preview).toMatch(/\.pv-prop \.s-air-loss-grid\s*\{[\s\S]*?align-content:\s*center;/);
        expect(preview).toMatch(/\.pv-prop \.s-nodes\s*\{[\s\S]*?padding-inline:\s*4px;/);
        expect(panelHtml).toMatch(/\.s-drop-slot\.empty\s*\{[^}]*border:\s*0;/);
        expect(panelMain).toContain("'<span class=\"s-drop-empty\">No Drop</span>'");
        expect(preview).toContain("'<span class=\"s-drop-empty\">No Drop</span>'");
        expect(preview).not.toContain('No drop');
        expect(panelHtml).toContain('.s-node:not(.boss).no-battle::before');
        expect(panelHtml).toContain('.s-node:not(.boss).branch::before');
        expect(panelHtml).toContain('.s-node:not(.boss).current::before');
        expect(panelHtml).toContain('.s-node.boss.current');
        expect(panelMain).toContain('NODE_KIND_KEYS.branch');
        expect(panelMain).toContain('NON_BATTLE_NODE_KINDS');
        expect(preview).toContain("sortieNodeHtml('Z', true, true, 'battle', true)");
        expect(preview).toContain("sortieNodeHtml('T', true, false, 'no-battle')");
        expect(preview).toContain("sortieNodeHtml('V', true, false, 'branch')");
        expect(panelHtml).toContain('.s-drop-slot.filled {');
        expect(panelHtml).toMatch(/\.s-drop-slot\.filled\s*\{[^}]*border:\s*0;/);
        expect(preview).toMatch(/\.s-action-rail\.with-system \.s-drop-slot\.filled\s*\{[^}]*border:\s*0;/);
        expect(preview).not.toContain('<div class="s-phase active">BOSS</div>');
        expect(panelHtml).toMatch(/\.s-rank-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) max-content/);
        expect(preview).toMatch(/\.pv-prop \.s-rank-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) max-content/);
        expect(panelHtml).toMatch(/\.s-rank-name\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
        expect(preview).toMatch(/\.pv-prop \.s-rank-name\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
        expect(panelHtml).toMatch(/\.s-formation-compact\s*\{[\s\S]*?width:\s*max-content/);
        expect(preview).toMatch(/\.pv-prop \.s-formation-compact\s*\{[\s\S]*?width:\s*max-content/);
    });

    it('英文制空／航向用社群短稱，且兩欄不得互相覆蓋', () => {
        expect(panelHtml).toMatch(/\.s-priority-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
        expect(panelHtml).toMatch(/\.s-priority-item\s*\{[\s\S]*?flex-direction:\s*column/);
        expect(panelHtml).toMatch(/\.s-priority-item b\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
        expect(preview).toMatch(/\.pv-prop \.s-priority-item\s*\{[\s\S]*?flex-direction:\s*column/);
        expect(preview).toMatch(/\.pv-prop \.s-priority-item b\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
        expect(panelMain).toContain("S: 'rank.s', A: 'rank.a'");
        expect(panelMain).toContain("t('sortie.mainFleet')");
        expect(panelMain).toContain("t('sortie.escortFleet')");
        expect(panelMain).toContain("t('sortie.lbas')");
        expect(panelMain).toContain("t('sortie.aaciRail')");
        expect(panelMain).not.toContain('<span>主隊</span>');
        expect(panelMain).not.toContain('<span>伴隨</span>');
        expect(panelMain).not.toContain("info.aaci > 0 ? '' : '對空 CI'");
        expect(panelMain).not.toContain("lbas ? t('sortie.lbasArrived') : '陸航'");
        setLang('en');
        expect(t('seiku.secured')).toBe('AS+');
        expect(t('seiku.superior')).toBe('AS');
        expect(t('seiku.even')).toBe('AP');
        expect(t('eng.tAdvantage')).toBe('T-Adv');
        expect(t('eng.tDisadvantage')).toBe('T-Dis');
        expect(t('rank.a')).toBe('Victory');
        expect(t('rank.s')).toBe('Perfect Victory');
        expect(t('sortie.lbas')).toBe('LBAS');
        expect(t('sortie.aaciRail')).toBe('AACI');
        expect(t('sortie.mainFleet')).toBe('Main');
        expect(t('sortie.escortFleet')).toBe('Escort');
        expect(t('fleet.heavyDamage')).toBe('Taiha');
        expect(t('sortie.taihaWarning')).toBe('Taiha!');
        expect(t('sortie.taihaRetreatNoEscort')).toBe('No retreat');
        expect(t('sortie.taihaRetreatHint')).toBe('Retreat available');
        setLang('zh-TW');
        expect(t('rank.a')).toBe('勝利');
        expect(t('sortie.aaciRail')).toBe('對空 CI');
        expect(t('fleet.heavyDamage')).toBe('大破');
        expect(t('sortie.taihaWarning')).toBe('大破！');
        setLang('ja');
    });

    it('大破警告文案在繁中、英文、日文都限兩行，三語對照預覽都要產生', () => {
        const keys = ['sortie.taihaFlagship', 'sortie.taihaFlagshipDamecon'];
        for (const lang of ['zh-TW', 'en', 'ja'] as const) {
            setLang(lang);
            for (const key of keys) {
                expect(t(key, { item: 'X' }).split('\n').length, `${lang} ${key}`).toBeLessThanOrEqual(2);
            }
        }
        setLang('ja');
        expect(preview).toContain("for (const lang of ['zh-TW', 'en', 'ja'] as const) {\n    writeFileSync(resolve(root, `.preview/panel-taiha-overlay-${lang}.html`), taihaOverlayPage(lang));");
    });

    it('大破警告釘在 44px 航空戰格內，英文短句走 i18n', () => {
        expect(panelHtml).toMatch(/min-height:\s*44px;\s*margin:\s*0;\s*overflow:\s*hidden;/);
        expect(panelHtml).toMatch(/\.s-taiha\.open\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow:\s*hidden;/);
        expect(preview).toContain('.preview/panel-taiha-en.html');
        expect(preview).toContain("t('sortie.taihaWarning')");
        expect(preview).toContain("t('sortie.taihaRetreatNoEscort')");
        expect(preview).toContain("t('sortie.taihaRetreatHint')");
    });
});
