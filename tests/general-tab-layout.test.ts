import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 面板「一般」分頁的硬約束（見 CLAUDE.md 慣例）：資源抬頭釘在上方，遠征／入渠／建造
// 三欄並排、身分騎在色線上；任務完整保留於兩欄清單，超出時只在任務區自身捲動。
// #tabpanel.has-general 本身不捲。
// 五塊直向堆疊會讓全滿時任務被推到 270px 摺線下。離線預覽：
//   npx vite-node --config vitest.config.ts tools/preview/panel-general.ts
const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const panelMain = readFileSync(new URL('../entrypoints/panel/main.ts', import.meta.url), 'utf8');
const css = panelHtml.slice(panelHtml.indexOf('<style>') + 7, panelHtml.indexOf('</style>'));

describe('一般分頁版面', () => {
   it('#tabpanel.has-general 本身不捲，任務區內自捲', () => {
       expect(panelHtml).toMatch(/id="tabpanel"[^>]*class="has-general"/);
       expect(css).toMatch(/#tabpanel\.has-general\s*\{[^}]*overflow:\s*hidden/);
       expect(css).toMatch(/#quests\s*\{[^}]*overflow-y:\s*auto/);
       expect(panelMain).toContain("tabpanelEl.classList.toggle('has-general', tab === 'general')");
   });

    it('任務完整保留並在兩欄區域內捲動', () => {
        expect(panelMain).toContain('const quests = state.quests_();');
        expect(panelMain).not.toContain('GENERAL_QUEST_LIMIT');
        expect(css).toMatch(/#quests\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
        expect(css).toMatch(/#quests\s*\{[^}]*grid-auto-rows:\s*min-content/);
        expect(css).not.toMatch(/#quests\s*\{[^}]*grid-template-rows:\s*repeat\(4,/);
        expect(css).not.toMatch(/#quests\s*\{[^}]*grid-auto-flow:\s*column/);
    });

    it('資源為 4×2、圖示與數字成組靠左', () => {
        expect(css).toMatch(/\.resblock\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
        expect(css).toMatch(/\.resblock\s*\{[^}]*grid-auto-flow:\s*row/);
        expect(css).toMatch(/\.resblock span\s*\{[^}]*justify-content:\s*flex-start/);
        expect(css).toMatch(/\.resblock\s*\{[^}]*gap:\s*2px 14px/);
    expect(css).not.toMatch(/\.resblock\s*\{[^}]*grid-auto-flow:\s*column/);
    });

    it('遠征／入渠／建造三欄並排，身分圖示在欄頂不進資料列', () => {
        expect(panelHtml).toContain('g-cat-exped');
        expect(panelHtml).toContain('g-cat-dock');
        expect(panelHtml).toContain('g-cat-build');
        expect(css).toMatch(/\.g-occ\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
        expect(panelHtml).toContain('/icons/ui/exped.svg');
        expect(panelHtml).toContain('/icons/ui/dock.svg');
        expect(panelHtml).toContain('/icons/ui/build.svg');
        expect(panelMain).not.toContain('tagIconHtml');
        expect(panelMain).not.toContain('exped-name');
    });

    it('任務吃剩餘高度，沒有「任務」h3 標題列', () => {
        expect(panelHtml).toContain('g-quest-block');
        expect(panelHtml).toContain('/icons/ui/quest.svg');
        expect(panelHtml).not.toMatch(/<h3[^>]*data-i18n="section\.quest"/);
        expect(css).toMatch(/\.g-quest-block\s*\{[^}]*flex:\s*1/);
    });

    it('三欄用獨立 .g-chip／.g-eta（11px），不複用 .timer-row／.badge', () => {
        expect(css).toMatch(/\.g-chip\s*\{[^}]*font-size:\s*11px/);
        expect(css).toMatch(/\.g-eta\s*\{[^}]*font-weight:\s*600/);
        expect(panelMain).toContain('class="g-chip"');
        expect(panelMain).toContain('class="g-eta grow"');
        expect(panelMain).toContain('class="g-name"');
        expect(panelMain).toContain('class="g-chip" data-exped-fleet=');
        expect(panelMain).not.toContain('class="badge grow"');
        expect(panelMain).not.toContain('class="timer-row" data-exped-fleet=');
    });

    it('遠征任務編號為 metadata，倒數才是 brass／600', () => {
        expect(css).toMatch(/\.g-eta\s*\{[^}]*font-weight:\s*600/);
        expect(css).toMatch(/\.g-chip \.g-eta\.grow\s*\{[^}]*color:\s*var\(--dim\)/);
        expect(css).toMatch(/\.g-chip \.g-eta\.grow\s*\{[^}]*font-weight:\s*500/);
    });

    it('任務進度分數加粗，受注中／達成維持 status', () => {
        expect(panelMain).toContain('class="q-prog"');
        expect(panelMain).toContain('class="q-st"');
        expect(css).toMatch(/\.quest-row \.q-prog\s*\{[^}]*font-weight:\s*600/);
        expect(css).toMatch(/\.quest-row \.q-st\s*\{[^}]*color:\s*var\(--dim\)/);
    });

    it('遠征名稱靠 hover／點列展開，展開狀態撐過重繪', () => {
        expect(panelMain).toContain('expandedExped');
        expect(panelMain).toContain('data-exped-fleet');
        expect(panelMain).toContain('exped-detail');
        expect(panelMain).toContain('missionsEl.addEventListener');
    });

    it('建造完成以 .done 高亮，不佔四條空渠', () => {
        expect(panelMain).toContain("k.state === 3 ? ' done' : ''");
        expect(css).toMatch(/\.g-chip\.done \.g-eta\s*\{[^}]*color:\s*var\(--sparkle\)/);
        expect(panelMain).toContain("t('common.empty')");
    });

    it('切語言時欄 title／圖示 alt 跟著換，不可用 textContent 清掉欄標子節點', () => {
        expect(panelMain).toContain('[data-i18n-title]');
        expect(panelMain).toContain('[data-i18n-alt]');
        expect(panelHtml).toContain('data-i18n-title="tag.exped"');
        expect(panelHtml).toContain('data-i18n-alt="tag.quest"');
    });
});
