import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { itemCatalog, itemMatches } from '../utils/item-catalog';

const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const panelMain = readFileSync(new URL('../entrypoints/panel/main.ts', import.meta.url), 'utf8');
const general = readFileSync(new URL('../entrypoints/panel/general.ts', import.meta.url), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));

describe('一般分頁', () => {
    it('把港務、任務、道具放在可切換且固定高度的區域', () => {
        expect(panelHtml).toContain('id="general-nav"');
        expect(panelHtml).toContain('id="general-harbor"');
        expect(panelHtml).toContain('id="general-quests" hidden');
        expect(panelHtml).toContain('id="general-items" hidden');
        expect(css).toMatch(/#tabpanel\.has-general\s*\{[^}]*overflow:\s*hidden/);
        expect(css).toMatch(/#tabpanel\.has-general>#tab-general\.ledger\{[^}]*grid-template-rows:27px minmax\(0,1fr\)/);
        expect(panelMain).toContain('mountGeneral(state, fmt)');
    });

    it('八項資源只顯示圖示和數量，名稱保留給輔助說明', () => {
        expect(general).toContain("const materialKeys = ['fuel', 'ammo', 'steel', 'bauxite', 'torch', 'drum', 'devmat', 'screw']");
        expect(general).toContain('matIconHtml(key, title)');
        expect(general).toContain('aria-label=');
        expect(general).not.toContain('class="label"');
    });

    it('一般分頁以底線分頁建立層級，資源數值緊鄰所屬圖示', () => {
        expect(css).toMatch(/\.ledger-nav button\[aria-selected=true\]\s*\{[^}]*border-bottom-color:\s*var\(--brass\)[^}]*font-weight:\s*600/);
        expect(css).toMatch(/\.ledger-nav button\s*\{[^}]*display:flex[^}]*justify-content:center/);
        expect(css).toMatch(/\.ledger-group-tabs button\s*\{[^}]*display:flex[^}]*justify-content:center/);
        expect(css).toMatch(/\.ledger-item-switch button\s*\{[^}]*display:flex[^}]*justify-content:center[^}]*gap:5px/);
        expect(css).toMatch(/\.ledger-nav \.count\s*\{[^}]*font-variant-numeric:tabular-nums/);
        expect(general).toContain('<span class="count">${state.quests_().length}</span>');
        expect(general).toContain('<span class="count">${groupCounts[key]}</span>');
        expect(css).toMatch(/\.ledger-materials\s*\{[^}]*grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)[^}]*gap:\s*2px 12px/);
        expect(css).toMatch(/\.ledger-material\s*\{[^}]*display:flex[^}]*align-items:center[^}]*gap:5px/);
        expect(css).toMatch(/\.ledger-material \.value\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*600[^}]*font-variant-numeric:\s*tabular-nums[^}]*text-align:\s*left/);
        expect(css).toMatch(/\.ledger-quest \.description\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*1\.5/);
        expect(css).toContain('html[lang="en"] .ledger-item-grid,html[lang="ja"] .ledger-item-grid');
    });

    it('遠征、入渠和建造各自切換，建造渠依觀測資料顯示', () => {
        expect(panelHtml).toContain('id="operation-exped"');
        expect(panelHtml).toContain('id="operation-dock" hidden');
        expect(panelHtml).toContain('id="operation-build" hidden');
        expect(general).toContain('state.kdockData.map');
        expect(general).toContain('stateCode === -1');
        expect(general).toContain('state.kdockData.length');
    });

    it('任務用原生 details 展開完整敘述，保留展開和捲動位置', () => {
        expect(general).toContain('<details class="ledger-quest');
        expect(general).toContain("detail: `${reusedNote}${detail ? detailHtml(detail) : esc(t('quest.noDetail'))}${rewardHtml}`");
        // 營運重用編號的新任務（標題與目錄不同）不套用舊譯文與舊獎勵。
        expect(general).toContain("questCatalogIdentity(q.no, q.name) === 'mismatch'");
        expect(general).not.toContain('description-label');
        // 展開後「說明／原文／進度」三選一，同時只顯示一個分頁；日文介面沒有原文分頁，
        // 只剩一個分頁時不顯示切換鈕。選中的分頁跨重繪保留。
        expect(general).toContain('localizedQuestDetail(q.no, questLocale, q.detail)');
        expect(general).toContain("questLocale !== 'ja' && !reused && (q.name || q.detail) ? ['original' as const] : []");
        // 說明與原文的獎勵共用同一個元件（原文以日文輸出），排版一致。
        expect(general).toContain('localizedQuestRewardHtml(q.no, questLocale)');
        expect(general).toContain("localizedQuestRewardHtml(q.no, 'ja')");
        // 編成條件在進度分頁以短標籤呈現，完整條件放在提示。
        expect(general).toContain('class="ledger-quest-cond"');
        expect(general).toContain('questConditionShort(check)');
        expect(general).toContain('const seg = panes.length > 1');
        expect(general).toContain('questPanes.get(q.no)');
        expect(general).toContain('data-quest-pane-body="${pane}"');
        expect(general).toContain('openQuests.has(q.no)');
        expect(general).toContain('const scrollTop = questsEl.scrollTop');
        expect(general).toContain('questsEl.scrollTop = scrollTop');
    });

    it('正式任務清單與預覽共用單欄容器，不套用舊版雙欄規則', () => {
        const questRule = css.match(/#quests\s*\{([^}]*)\}/)?.[1] ?? '';
        const preview = readFileSync(new URL('../tools/preview/panel-general-ledger.ts', import.meta.url), 'utf8');
        expect(questRule).not.toMatch(/display:\s*grid/);
        expect(questRule).not.toMatch(/grid-template-columns/);
        expect(css).toMatch(/\.ledger-quest-list\s*\{[^}]*display:block[^}]*overflow-y:auto/);
        expect(preview).toContain('<div class="ledger-quest-list" id="quests">');
    });

    it('八項收攏任務在 270px 面板內全數可見，展開後才在任務清單內捲動', () => {
        expect(css).toMatch(/\.ledger-quest summary\s*\{[^}]*min-height:24px[^}]*padding:3px 4px/);
        expect(css).toMatch(/\.ledger-quest-list\s*\{[^}]*overflow-y:auto/);
        const questListHeight = 270 - 12 - 27 - 6 - 21;
        expect(8 * 25).toBeLessThanOrEqual(questListHeight);
    });

    it('四個入渠與建造船塢在 270px 面板內可一次看完', () => {
        expect(css).toMatch(/\.ledger-op\s*\{[^}]*min-height:25px/);
        expect(css).toMatch(/\.ledger-group-list\s*\{[^}]*overflow-y:auto/);
        const operationListHeight = 270 - 12 - 27 - 6 - 48 - 34 - 14 - 20;
        expect(4 * 25).toBeLessThanOrEqual(operationListHeight);
    });

    it('繁中、日文、英文名稱連結同一筆資料並搜尋兩欄', () => {
        const report = itemCatalog.find(item => item.names['zh-TW'] === '戰鬥詳報');
        expect(report?.inventory).toBe('expansion');
        expect(report?.id).toBe(78);
        expect(report?.countSource).toEqual({ kind: 'useitem', id: 78 });
        expect(report?.names.ja).toBe('戦闘詳報');
        expect(report?.names.en).toBe('Action Report');
        for (const term of ['戰鬥詳報', '戦闘詳報', 'action report']) expect(itemMatches(report!, term)).toBe(true);
        expect(itemMatches(report!, '家具箱')).toBe(false);
        expect(general).toContain("const matches = allItems.filter(item => itemMatches(item, term))");
        expect(general).toContain("const tabs = [...inventoryNav.querySelectorAll<HTMLButtonElement>('[data-inventory]')]");
        expect(general).toContain('tabs[(currentIndex + delta + tabs.length) % tabs.length]');
        expect(general).toContain("const inventoryKeys: ItemInventory[] = ['standard', 'expansion']");
        expect(general).toContain("inventoryKeys.push('other')");
    });

    it('道具持有量依來源資料呈現，缺資料顯示 —，不以範例數量充當持有量', () => {
        expect(general).toContain('state.useItemCount(source.id)');
        expect(general).toContain('state.payItemCount(source.id)');
        expect(general).toContain('state.materialCount(source.apiId)');
        expect(general).toContain('state.slotItemCountByJapaneseName(source.nameJa)');
        expect(general).toContain("item.count === null ? '—' : item.count.toLocaleString()");
        expect(general).toContain('最近取得的遊戲資料');
        expect(general).not.toContain('count: 153');
    });

    it('搜尋列平時收起，由分頁列右端的按鈕展開，收起時清空條件', () => {
        expect(panelHtml).toMatch(/<div class="ledger-item-bar"><div class="ledger-item-switch" id="inventory-nav"[^>]*><\/div><button type="button" class="ledger-item-search-toggle" id="item-search-toggle" aria-expanded="false" aria-controls="item-search-row">/);
        expect(panelHtml).toContain('<div class="ledger-item-tools" id="item-search-row" hidden>');
        expect(panelHtml).not.toContain('item-search-label');
        expect(css).toMatch(/\.ledger-item-layout\{display:flex;flex-direction:column/);
        expect(css).toMatch(/\.ledger-item-bar\{[^}]*height:28px/);
        expect(css).toContain('.ledger-item-tools[hidden]');
        expect(general).toContain("if (!open && search.value) search.value = ''");
        expect(general).toContain("if (event.key !== 'Escape') return;");
        expect(general).toContain("searchToggle.setAttribute('aria-expanded', String(!searchRow.hidden))");
        expect(general).not.toContain('ledger-item-notice');
    });

    it('釘選道具排在所屬道具欄最前面，釘選鈕只在展開內容', () => {
        expect(general).toContain('sortPinnedFirst(matches.filter(item => item.inventory === inventory), itemIdentity, pins)');
        expect(general).toMatch(/<div class="item-detail">[^`]*<button type="button" class="item-pin" data-pin-key=/);
        const itemSummary = general.match(/<details class="ledger-item-row[\s\S]*?<\/summary>/)?.[0] ?? '';
        expect(itemSummary).toContain('<span class="count"');
        expect(itemSummary).not.toContain('item-pin');
        expect(general).toContain('[...openItems].sort(), pins]');
        expect(css).toMatch(/\.ledger-item-row \.item-pin\{[^}]*grid-column:1\/-1[^}]*justify-self:end/);
    });
});
