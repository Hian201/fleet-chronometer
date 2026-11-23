// 任務目錄戰果獎勵結構化解析測試（utils/quest-senka.ts）。
import { describe, expect, it } from 'vitest';
import questCatalogRewards from '../utils/quest-catalog-rewards.json';
import {
    parseQuestSenkaFromOtherJa,
    QUEST_SENKA_CATALOG,
    QUEST_SENKA_REWARDS,
    questSenkaCatalogEntry,
    questSenkaReward,
} from '../utils/quest-senka';

describe('任務目錄戰果結構化解析', () => {
    it('quest-catalog-rewards.json 中每一筆含「戦果」的任務皆被完整解析且不遺漏', () => {
        const expectedNos: number[] = [];
        for (const [id, entry] of Object.entries(questCatalogRewards as Record<string, { otherJa?: string }>)) {
            if ((entry.otherJa ?? '').includes('戦果')) {
                expectedNos.push(Number(id));
            }
        }
        expectedNos.sort((a, b) => a - b);

        const actualNos = [...QUEST_SENKA_REWARDS.keys()].sort((a, b) => a - b);
        expect(actualNos).toEqual(expectedNos);
        expect(actualNos).toHaveLength(10);
        for (const no of actualNos) {
            const reward = questSenkaReward(no)!;
            expect(reward.fixed + reward.choice).toBeGreaterThan(0);
        }
    });

    it('十筆已知戰果任務（含抽樣 854、949 選擇報酬、284）的數值與 wiki 代號皆正確', () => {
        const expected: Array<[number, string, { fixed: number; choice: number }]> = [
            [284, 'Bq11', { fixed: 80, choice: 0 }],
            [845, 'Bq12', { fixed: 330, choice: 0 }],
            [854, 'Bq2', { fixed: 350, choice: 0 }],
            [872, 'Bq10', { fixed: 400, choice: 0 }],
            [888, 'Bq7', { fixed: 200, choice: 0 }],
            [893, 'Bq8', { fixed: 300, choice: 0 }],
            [903, 'Bq13', { fixed: 390, choice: 0 }],
            [947, 'By9', { fixed: 480, choice: 0 }],
            [948, 'By10', { fixed: 600, choice: 0 }],
            [949, 'B170', { fixed: 0, choice: 800 }],
        ];

        expect(QUEST_SENKA_CATALOG.size).toBe(expected.length);
        for (const [apiNo, wikiId, reward] of expected) {
            expect(questSenkaReward(apiNo)).toEqual(reward);
            const entry = questSenkaCatalogEntry(apiNo);
            expect(entry).not.toBeNull();
            expect(entry!.apiNo).toBe(apiNo);
            expect(entry!.wikiId).toBe(wikiId);
            expect(entry!.nameJa.length).toBeGreaterThan(0);
            expect(entry!.reward).toEqual(reward);
            expect(entry!.limited).toBe(false);
        }
    });

    it('非戰果任務或不存在的編號回傳 null', () => {
        expect(questSenkaReward(101)).toBeNull();
        expect(questSenkaReward(201)).toBeNull();
        expect(questSenkaReward(999999)).toBeNull();
        expect(questSenkaCatalogEntry(101)).toBeNull();
        expect(questSenkaCatalogEntry(999999)).toBeNull();
    });

    it('parseQuestSenkaFromOtherJa 正確處理確定、選擇、混合、全形加號與無戰果情況', () => {
        expect(parseQuestSenkaFromOtherJa('')).toBeNull();
        expect(parseQuestSenkaFromOtherJa('確定報酬\n・高速修復材x3')).toBeNull();
        expect(parseQuestSenkaFromOtherJa('確定報酬\n・戦果+350')).toEqual({ fixed: 350, choice: 0 });
        expect(parseQuestSenkaFromOtherJa('選択報酬2\n・戦果+800\n・FR-1 Fireball x1')).toEqual({ fixed: 0, choice: 800 });
        expect(parseQuestSenkaFromOtherJa('確定報酬\n・戦果 ＋ 120\n\n選択報酬\n・戦果+80')).toEqual({ fixed: 120, choice: 80 });
    });
});
