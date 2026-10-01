import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUEST_CATALOG_BY_NO } from '../utils/quest-flow';
import { questCategoryFromApi } from '../utils/quest-category';
import { GameState } from '../utils/state';

const sample = JSON.parse(readFileSync('samples/Quest.json', 'utf8')).api_data.api_list
    .filter((q: unknown) => q && typeof q === 'object') as { api_no: number; api_category: number }[];

describe('任務種類', () => {
    it('封包的 api_category 對照與任務目錄的種類一致', () => {
        for (const q of sample) {
            const catalog = QUEST_CATALOG_BY_NO.get(q.api_no);
            if (catalog) expect([q.api_no, questCategoryFromApi(q.api_category)]).toEqual([q.api_no, catalog.category]);
        }
    });

    it('未見過或缺少的值回傳 unknown', () => {
        expect(questCategoryFromApi(12)).toBe('unknown');
        expect(questCategoryFromApi(undefined)).toBe('unknown');
        expect(questCategoryFromApi('2')).toBe('unknown');
    });

    it('面板任務帶出即時種類', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', { api_list: [
            { api_no: 303, api_category: 3, api_state: 2, api_title: '', api_detail: '' },
            { api_no: 402, api_state: 2, api_title: '', api_detail: '' },
            { api_no: 503, api_category: 5, api_state: 1, api_title: '', api_detail: '' },
        ] }, { api_tab_id: '0' }, 1);
        expect(state.quests_().map(q => [q.no, q.category])).toEqual([[303, 'practice'], [402, 'unknown']]);
        expect(state.availableQuests_().map(q => [q.no, q.category])).toEqual([[503, 'supply-dock']]);
    });
});
