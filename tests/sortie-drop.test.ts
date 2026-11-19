// 面板出擊結算的掉落格（entrypoints/panel/sortie-drop.ts）與道具顯示名（utils/item-catalog.ts）。
import { afterEach, describe, expect, it } from 'vitest';
import { sortieDropSlotHtml } from '../entrypoints/panel/sortie-drop';
import { useItemDisplayName } from '../utils/item-catalog';
import { setLang } from '../utils/ui-i18n';

const SHIP = '<div class="s-drop-chip sakura-drop owned">睦月</div>';

describe('出擊結算掉落格', () => {
    afterEach(() => setLang('zh-TW'));

    it('沒有艦娘也沒有道具才顯示 No Drop', () => {
        const html = sortieDropSlotHtml('', []);
        expect(html).toContain('s-drop-slot empty');
        expect(html).toContain('No Drop');
    });

    it('只有道具時顯示道具名與持有數，不顯示 No Drop', () => {
        setLang('zh-TW');
        const html = sortieDropSlotHtml('', [{ name: '秋刀魚', held: 42 }]);
        expect(html).toContain('s-drop-slot filled"');
        expect(html).not.toContain('No Drop');
        expect(html).toContain('<span class="s-drop-item-name">秋刀魚</span>');
        expect(html).toContain('<span class="s-drop-item-held">持有 42</span>');
        expect(html).toContain('title="掉落道具：秋刀魚（持有 42）"');
    });

    it('艦娘與道具同場掉落時兩者並列', () => {
        const html = sortieDropSlotHtml(SHIP, [{ name: '秋刀魚', held: 1 }]);
        expect(html).toContain('s-drop-slot filled with-item');
        expect(html.indexOf('sakura-drop')).toBeLessThan(html.indexOf('s-drop-item'));
    });

    it('只有艦娘時維持原本樣式', () => {
        const html = sortieDropSlotHtml(SHIP, []);
        expect(html).toContain('s-drop-slot filled"');
        expect(html).not.toContain('s-drop-item');
    });

    it('庫存未觀測時不顯示持有數，也不顯示成 0', () => {
        const html = sortieDropSlotHtml('', [{ name: '秋刀魚', held: null }]);
        expect(html).not.toContain('s-drop-item-held');
        expect(html).toContain('title="掉落道具：秋刀魚"');
    });

    it('道具名經跳脫', () => {
        expect(sortieDropSlotHtml('', [{ name: '<b>x</b>', held: null }])).not.toContain('<b>x</b>');
    });

    it('三語的持有數文案', () => {
        for (const [lang, held] of [['en', 'Held 3'], ['ja', '所持 3']] as const) {
            setLang(lang);
            expect(sortieDropSlotHtml('', [{ name: 'x', held: 3 }])).toContain(`>${held}</span>`);
        }
    });
});

describe('useItemDisplayName', () => {
    it('目錄有收錄時用該語言名稱', () => {
        expect(useItemDisplayName(68, 'zh-TW', '秋刀魚')).toBe('秋刀魚');
        expect(useItemDisplayName(68, 'en')).toBe('Saury');
    });

    it('目錄沒有時用遊戲主檔日文原名，再沒有才顯示 id', () => {
        expect(useItemDisplayName(99999, 'zh-TW', '謎の道具')).toBe('謎の道具');
        expect(useItemDisplayName(99999, 'en')).toBe('#99999');
    });
});
