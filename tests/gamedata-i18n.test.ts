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
});
