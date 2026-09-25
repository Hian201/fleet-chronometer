import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import {
    buildQuestFlow, normalizeQuestSearch, questRelation, questSearchHaystack,
    QUEST_CATALOG, QUEST_CATALOG_BY_NO,
} from '../utils/quest-flow';

describe('任務導覽資料目錄', () => {
    it('保留 api_no 作為核心身分，並以 Wiki ID 作為對照欄位', () => {
        const first = QUEST_CATALOG_BY_NO.get(101);
        expect(first?.apiNo).toBe(101);
        expect(first?.wikiIds).toContain('A1');
        expect(first?.name).toBe('はじめての「編成」！');
    });

    it('同一 api_no 的重複資料只採用日文任務欄位', () => {
        const task = QUEST_CATALOG_BY_NO.get(353);
        expect(task?.name).toBe('「巡洋艦戦隊」演習！');
        expect(task?.detail).toContain('艦隊');
        expect(task?.detail).toContain('勝利');
    });

    it('常設年常出擊任務 By8 有目錄紀錄，搜尋可略過句末感嘆號與全形標點', () => {
        const task = QUEST_CATALOG_BY_NO.get(946);
        expect(task?.wikiIds).toContain('By8');
        expect(task?.period).toBe('yearly');
        expect(task?.name).toBe('空母機動部隊、出撃！敵艦隊を迎撃せよ！');
        const haystack = questSearchHaystack({
            name: task!.name, detail: task!.detail, definition: task!,
        });
        expect(haystack).toContain(normalizeQuestSearch('空母機動部隊、出撃！敵艦隊を迎撃せよ'));
        expect(haystack).toContain(normalizeQuestSearch('空母機動部隊、出撃!敵艦隊を迎撃せよ'));
        expect(haystack).toContain('by8');
    });

    it('收錄 2026-09-10 北上改三與扶桑型補強的相關任務', () => {
        const kitakamiYearly = QUEST_CATALOG_BY_NO.get(1050);
        const yamashiroYearly = QUEST_CATALOG_BY_NO.get(1051);
        const kitakamiSortie = QUEST_CATALOG_BY_NO.get(1052);
        const arsenal = QUEST_CATALOG_BY_NO.get(1170);
        expect(kitakamiYearly?.wikiIds).toContain('By17');
        expect(kitakamiYearly?.period).toBe('yearly');
        expect(yamashiroYearly?.wikiIds).toContain('By18');
        expect(yamashiroYearly?.name).toContain('1YB3H');
        expect(kitakamiSortie?.wikiIds).toContain('B217');
        expect(kitakamiSortie?.period).toBe('once');
        expect(arsenal?.wikiIds).toContain('F143');
        expect(questRelation(1052).prerequisites).toEqual([1050]);
        expect(questRelation(1170).prerequisites).toEqual([1050]);
        expect(questRelation(1052).operator).toBe('unknown');
        // wiki 列 Bd8 與 A44，KC3 開放邊只有 Bd8，不把組合判成已確認。
        expect(questRelation(1051).operator).toBe('conflict');
        expect(questRelation(1051).prerequisites).toEqual([147, 230]);
        expect(QUEST_CATALOG_BY_NO.get(313)?.wikiIds).toContain('Cs8');
        expect(QUEST_CATALOG_BY_NO.get(384)?.wikiIds).toContain('2609C1');
        expect(QUEST_CATALOG_BY_NO.get(385)?.period).toBe('weekly');
        expect(QUEST_CATALOG_BY_NO.get(385)?.limited).toBe(true);
    });

    it('只存在多個前置但無法判定組合時，不自行指定 all 或 any', () => {
        const relation = questRelation({
            apiNo: 999999,
            wikiIds: ['TEST'],
            name: '測試任務',
            detail: '',
            category: 'unknown',
            period: 'unknown',
            limited: false,
            limitedState: 'unknown',
            apiCategory: null,
            apiType: null,
            wikiPrerequisites: [101, 102],
            structuredPrerequisites: [],
            unresolvedPrerequisites: [],
            sources: ['catalog'],
            wikiPresent: true,
            structuredPresent: false,
            wikiConditionUnknown: false,
            structuredConditionUnknown: false,
        });
        expect(relation.prerequisites).toEqual([101, 102]);
        expect(relation.operator).toBe('unknown');
        expect(relation.confidence).toBe('single-source');
    });

    it('不同來源的前置不做多數決，保留 conflict', () => {
        const relation = questRelation({
            apiNo: 999998,
            wikiIds: [],
            name: '測試任務',
            detail: '',
            category: 'unknown',
            period: 'unknown',
            limited: false,
            limitedState: 'unknown',
            apiCategory: null,
            apiType: null,
            wikiPrerequisites: [101],
            structuredPrerequisites: [102],
            unresolvedPrerequisites: [],
            sources: ['catalog', 'structured'],
            wikiPresent: true,
            structuredPresent: true,
            wikiConditionUnknown: false,
            structuredConditionUnknown: false,
        });
        expect(relation.prerequisites).toEqual([101, 102]);
        expect(relation.operator).toBe('conflict');
        expect(relation.confidence).toBe('conflict');
    });
});

describe('任務導覽與本機狀態', () => {
    it('把目前可接受的 state 1 任務與受注中任務分開', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [
                { api_no: 101, api_state: 1, api_title: '可接受任務', api_detail: '內容' },
                { api_no: 102, api_state: 2, api_title: '進行中任務', api_detail: '內容' },
            ],
        }, { api_tab_id: '0' });

        expect(state.availableQuests_().map(quest => quest.no)).toEqual([101]);
        expect(state.quests_().map(quest => quest.no)).toEqual([102]);
    });

    it('領獎事件只形成獨立的本機觀測紀錄', () => {
        const state = new GameState();
        state.applyEvent('api_req_quest/clearitemget', {}, { api_quest_id: '101' }, 1000);
        state.applyEvent('api_req_quest/clearitemget', {}, { api_quest_id: '101' }, 2000);

        expect(state.questObservedCompletions_().get(101)).toEqual({ count: 2, lastTs: 2000 });
        expect(state.quests_()).toEqual([]);
    });

    it('定期任務的歷史觀測不直接解除目前週期的前置', () => {
        const state = new GameState();
        const observedAt = Date.UTC(2026, 8, 1, 20, 0);
        const nextWeek = observedAt + 7 * 24 * 60 * 60 * 1000;
        state.applyEvent('api_req_quest/clearitemget', {}, { api_quest_id: '302' }, observedAt);

        const sameWeek = buildQuestFlow(state, new Set(), observedAt + 24 * 60 * 60 * 1000);
        expect(sameWeek.byNo.get(302)?.observedCurrentPeriod).toBe(true);

        const model = buildQuestFlow(state, new Set(), nextWeek);
        const weekly = model.byNo.get(302);
        expect(weekly?.status).toBe('observed-complete');
        expect(weekly?.observedCurrentPeriod).toBe(false);
    });

    it('達成待領取仍保留為目前狀態，不先當成已完成前置', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 102, api_state: 3, api_title: '達成任務', api_detail: '內容' }],
        }, { api_tab_id: '9' });

        const model = buildQuestFlow(state);
        expect(model.byNo.get(102)?.status).toBe('ready-to-claim');
        expect(model.byNo.get(103)?.blockers).toContain(102);
    });

    it('後續任務出現在目前清單時，前置只標為關聯推論完成', () => {
        const definition = QUEST_CATALOG.find(row => {
            const relation = questRelation(row);
            return relation.operator === 'all' && relation.prerequisites.length === 1;
        });
        expect(definition).toBeDefined();
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{
                api_no: definition!.apiNo,
                api_state: 2,
                api_title: definition!.name,
                api_detail: definition!.detail,
            }],
        }, { api_tab_id: '9' });

        const model = buildQuestFlow(state);
        const prerequisite = questRelation(definition!).prerequisites[0];
        expect(model.byNo.get(prerequisite)?.status).toBe('inferred-complete');
        expect(model.byNo.get(prerequisite)?.observed).toBeNull();
    });

    it('可見任務會沿 operator=all 的前置鏈往回標，不把旁支單發當成完成', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{
                api_no: 107,
                api_state: 2,
                api_title: '空母機動部隊を編成せよ！',
                api_detail: '空母1隻以上を旗艦とし',
            }],
        }, { api_tab_id: '9' });

        const model = buildQuestFlow(state);
        expect(model.byNo.get(107)?.status).toBe('in-progress');
        expect(model.byNo.get(106)?.status).toBe('inferred-complete');
        expect(model.byNo.get(105)?.status).toBe('inferred-complete');
        expect(model.byNo.get(103)?.status).toBe('inferred-complete');
        expect(model.byNo.get(102)?.status).toBe('inferred-complete');
        expect(model.byNo.get(101)?.status).toBe('inferred-complete');
        expect(model.byNo.get(104)?.status).not.toBe('inferred-complete');
        expect(state.questOnceCatalogNos_()).toBeNull();
    });

    it('全部 tab 的缺席單發，在前置已滿足時標成關聯推論完成', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{
                api_no: 107,
                api_state: 1,
                api_title: '空母機動部隊を編成せよ！',
                api_detail: '空母1隻以上を旗艦とし',
            }],
        }, { api_tab_id: '0' });

        const model = buildQuestFlow(state);
        expect(state.questOnceCatalogNos_()).toEqual([107]);
        expect(model.byNo.get(107)?.status).toBe('available');
        for (const no of [101, 102, 103, 104, 105, 106, 108, 109]) {
            expect(model.byNo.get(no)?.status, `api_no ${no}`).toBe('inferred-complete');
        }
        expect(model.byNo.get(104)?.nearUnlock).toBe(false);
    });

    it('單發 tab 也足以做缺席推論；遂行中不會清掉全部 tab 的可接受任務', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [
                { api_no: 107, api_state: 1, api_title: '空母機動部隊を編成せよ！', api_detail: '內容' },
                { api_no: 201, api_state: 2, api_title: '敵艦隊を撃破せよ！', api_detail: '內容' },
            ],
        }, { api_tab_id: '0' });
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 201, api_state: 2, api_title: '敵艦隊を撃破せよ！', api_detail: '內容' }],
        }, { api_tab_id: '9' });

        expect(state.availableQuests_().map(quest => quest.no)).toEqual([107]);
        expect(state.quests_().map(quest => quest.no)).toEqual([201]);
        expect(state.questOnceCatalogNos_()).toEqual([107, 201]);

        const model = buildQuestFlow(state);
        expect(model.byNo.get(107)?.status).toBe('available');
        expect(model.byNo.get(101)?.status).toBe('inferred-complete');
    });

    it('期間限定與未解析條件的單發，不因清單缺席而標成完成', () => {
        const limited = QUEST_CATALOG.find(row => row.period === 'once' && row.limited);
        const unresolved = QUEST_CATALOG.find(row =>
            row.period === 'once' && !row.limited && row.unresolvedPrerequisites.length > 0);
        const unknownCondition = QUEST_CATALOG.find(row =>
            row.period === 'once' && !row.limited && (row.wikiConditionUnknown || row.structuredConditionUnknown));
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 107, api_state: 1, api_title: '空母機動部隊を編成せよ！', api_detail: '內容' }],
        }, { api_tab_id: '4' });

        const model = buildQuestFlow(state);
        expect(state.questOnceCatalogNos_()).toEqual([107]);
        if (limited) expect(model.byNo.get(limited.apiNo)?.status).not.toBe('inferred-complete');
        if (unresolved) expect(model.byNo.get(unresolved.apiNo)?.status).not.toBe('inferred-complete');
        if (unknownCondition) {
            expect(model.byNo.get(unknownCondition.apiNo)?.status).not.toBe('inferred-complete');
        }
    });
});
