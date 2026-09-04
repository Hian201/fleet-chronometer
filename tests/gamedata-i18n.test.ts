import { afterEach, describe, expect, it } from 'vitest';
import { localizeShip, setDisplayLang } from '../utils/gamedata-i18n';

describe('艦娘名稱本地化', () => {
    afterEach(() => setDisplayLang('ja'));

    it('Верный 依語言顯示繁中譯名或原始日文名', () => {
        setDisplayLang('zh-TW');
        expect(localizeShip(147, 'Верный')).toBe('信賴');

        setDisplayLang('ja');
        expect(localizeShip(147, 'Верный')).toBe('Верный');
    });

    it('Phoenix 艦線使用台灣慣用的 General Belgrano 譯名', () => {
        setDisplayLang('zh-TW');
        expect(localizeShip(952, 'フェニックス')).toBe('鳳凰城');
        expect(localizeShip(734, 'Phoenix改')).toBe('鳳凰城改');
        expect(localizeShip(957, 'General Belgrano')).toBe('貝爾格蘭諾將軍號');
    });
});
