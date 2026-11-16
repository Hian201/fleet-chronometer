// 任務譯文依語言載入（utils/quest-catalog-localization.ts）：未載入的語言回退日文原文。
// 模組內的已載入表是全域狀態，本檔單獨成檔，第一個案例才看得到「尚未載入」。
import { describe, expect, it } from 'vitest';
import {
    loadQuestCatalogLocale, localizedQuestDetail, localizedQuestName, questCatalogLocaleLoaded,
} from '../utils/quest-catalog-localization';

describe('loadQuestCatalogLocale', () => {
    it('未載入時回退日文原文，載入後取得譯文', async () => {
        expect(questCatalogLocaleLoaded('en')).toBe(false);
        expect(localizedQuestName(101, 'en', 'はじめての「編成」！')).toBe('はじめての「編成」！');
        await loadQuestCatalogLocale('en');
        expect(questCatalogLocaleLoaded('en')).toBe(true);
        expect(questCatalogLocaleLoaded('zh-TW')).toBe(false);
        expect(localizedQuestName(101, 'en', 'はじめての「編成」！')).toBe('The First Attempt at Fleet Organization!');
        expect(localizedQuestName(101, 'zh-TW', 'はじめての「編成」！')).toBe('はじめての「編成」！');
    });

    it('台灣華語連同英文一起載入，說明照常補上英文才有的海域對照', async () => {
        await loadQuestCatalogLocale('zh-TW');
        expect(questCatalogLocaleLoaded('zh-TW')).toBe(true);
        expect(localizedQuestName(101, 'zh-TW', '原文')).toBe('首次編成艦隊！');
        expect(localizedQuestDetail(226, 'zh-TW', '原文')).toContain('（海域對照：');
    });

    it('日文不需載入', async () => {
        expect(questCatalogLocaleLoaded('ja')).toBe(true);
        await expect(loadQuestCatalogLocale('ja')).resolves.toBeUndefined();
        expect(localizedQuestName(101, 'ja', '原文')).toBe('原文');
    });
});
