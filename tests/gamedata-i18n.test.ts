import { afterEach, describe, expect, it } from 'vitest';
import { gearMatchesQuery, gearSearchNames, localizeEquipmentType, localizeShip, setDisplayLang } from '../utils/gamedata-i18n';

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

describe('裝備類別本地化', () => {
    afterEach(() => setDisplayLang('ja'));

    it('英文介面翻譯 API 分類，而不是誤用圖示分類', () => {
        setDisplayLang('en');
        expect(localizeEquipmentType(3, '大口径主砲')).toBe('Large Caliber Main Gun');
        expect(localizeEquipmentType(7, '艦上爆撃機')).toBe('Carrier-based Dive Bomber');
    });

    it('未知分類保留封包原名', () => {
        setDisplayLang('en');
        expect(localizeEquipmentType(999, '未確認分類')).toBe('未確認分類');
    });
});

describe('裝備搜尋（繁中／日文／英文）', () => {
    // 1 號：12cm單裝砲（封包原名 12cm単装砲，注意「単」與繁中「單」字形不同）
    const JA = '12cm単装砲';

    it('名稱涵蓋繁中、英文與封包原始日文，且與目前顯示語言無關', () => {
        setDisplayLang('en');
        expect(gearSearchNames(1, JA)).toEqual(['12cm單裝砲', '12cm Single Gun Mount', JA]);
        setDisplayLang('ja');
        expect(gearSearchNames(1, JA)).toEqual(['12cm單裝砲', '12cm Single Gun Mount', JA]);
    });

    it('同一件裝備用繁中、日文、英文關鍵字都搜得到', () => {
        expect(gearMatchesQuery(1, JA, '單裝砲')).toBe(true);
        expect(gearMatchesQuery(1, JA, '単装砲')).toBe(true);
        expect(gearMatchesQuery(1, JA, 'single gun')).toBe(true);
        expect(gearMatchesQuery(1, JA, '魚雷')).toBe(false);
    });

    it('大小寫與全形半形視為相同，頭尾空白忽略', () => {
        expect(gearMatchesQuery(1, JA, 'SINGLE GUN MOUNT')).toBe(true);
        expect(gearMatchesQuery(1, JA, '１２ｃｍ')).toBe(true);
        expect(gearMatchesQuery(1, JA, '  單裝砲 ')).toBe(true);
    });

    it('空關鍵字全部符合；譯表沒有的裝備仍可用日文名搜尋', () => {
        expect(gearMatchesQuery(1, JA, '')).toBe(true);
        expect(gearMatchesQuery(1, JA, '   ')).toBe(true);
        expect(gearSearchNames(999999, '未知の装備')).toEqual(['未知の装備']);
        expect(gearMatchesQuery(999999, '未知の装備', '未知')).toBe(true);
        expect(gearMatchesQuery(undefined, undefined, '單裝砲')).toBe(false);
    });
});
