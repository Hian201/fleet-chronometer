// 任務編號的身分核對（utils/quest-identity.ts）。期間限定任務每年內容不同但會重用編號，
// 標題與目錄不同時不可套用以編號對應的舊譯文、舊獎勵與舊進度條件。
import { describe, expect, it } from 'vitest';
import { questCatalogIdentity, questTitleKey } from '../utils/quest-identity';
import { buildQuestFlow } from '../utils/quest-flow';
import { GameState } from '../utils/state';
import { QUEST_CATALOG_RAW } from '../utils/quest-catalog-data';
import japaneseTitles from './fixtures/quest-catalog-japanese-titles.json';
import { questCatalogTranslation, localizedQuestReward } from '../utils/quest-catalog-localization';

describe('questCatalogIdentity', () => {
    it('所有目錄任務與固定版本 KC3Kai 日文標題相符', () => {
        const titles = new Map(japaneseTitles.titles as [number, string][]);
        for (const [no] of QUEST_CATALOG_RAW) {
            const title = titles.get(no);
            expect(title, `任務 ${no} 的來源日文標題`).toBeTruthy();
            expect(questCatalogIdentity(no, title), `任務 ${no}：${title}`).toBe('match');
        }
    });

    it('已有名稱的目錄任務均有雙語翻譯與可顯示的獎勵', () => {
        for (const [no, , name] of QUEST_CATALOG_RAW) {
            if (!name) continue;
            for (const locale of ['zh-TW', 'en'] as const) {
                expect(questCatalogTranslation(no, locale), `任務 ${no} ${locale}`).toBeDefined();
                expect(localizedQuestReward(no, locale).verified, `任務 ${no} ${locale} 獎勵`).toBe(true);
            }
        }
    });

    it.each([
        [345, '演習ティータイム！'],
        [346, '最精鋭！主力オブ主力、演習開始！'],
        [355, '精鋭「第十五駆逐隊」第一小隊演習！'],
    ])('已校正的日文標題不誤判為編號重用（%i）', (no, title) => {
        expect(questCatalogIdentity(no, title)).toBe('match');
    });

    it('同一任務的括號與驚嘆號寫法差異視為相同（1047：目錄【】、遊戲「」）', () => {
        expect(questCatalogIdentity(1047, '「涼波改二」ラバウルより抜錨せよ！')).toBe('match');
        expect(questTitleKey('【涼波改二】ラバウルより抜錨せよ!')).toBe(questTitleKey('「涼波改二」ラバウルより抜錨せよ！'));
    });

    it('同編號但標題不同：營運重用編號的新任務', () => {
        expect(questCatalogIdentity(984, '【期間限定任務】14年目実りの秋、南瓜始め！')).toBe('mismatch');
    });

    it('沒有即時標題或目錄沒有這個編號：無從比對', () => {
        expect(questCatalogIdentity(984, undefined)).toBe('unknown');
        expect(questCatalogIdentity(999_999, '新任務')).toBe('unknown');
    });
});

describe('GameState：重用編號的新任務不套用舊資料', () => {
    const questlist = (s: GameState, list: object[]) =>
        s.applyEvent('api_get_member/questlist', { api_list: list }, { api_tab_id: '0' }, 3_000);

    it('標題不同時不套用進度條件表（1047 的舊條件）', () => {
        const s = new GameState();
        questlist(s, [{ api_no: 1047, api_state: 2, api_title: '（新）別の任務', api_detail: '艦隊を整備せよ！', api_progress_flag: 0 }]);
        const quest = s.quests_().find(q => q.no === 1047)!;
        expect(quest.progress).toBeNull();
        expect(quest.tracking?.tier).toBe('server');
    });

    it('標題不同時不套用以編號對應的人工目標（216），只剩文字推算', () => {
        const s = new GameState();
        questlist(s, [{ api_no: 216, api_state: 2, api_title: '（新）演習任務', api_detail: '「演習」で3回勝利せよ！', api_progress_flag: 0 }]);
        expect(s.quests_().find(q => q.no === 216)?.progress).toEqual({ count: 0, target: 3 });
    });

    it('標題相同時照常套用條件表', () => {
        const s = new GameState();
        questlist(s, [{ api_no: 1047, api_state: 2, api_title: '「涼波改二」ラバウルより抜錨せよ！', api_detail: '…', api_progress_flag: 0 }]);
        expect(s.quests_().find(q => q.no === 1047)?.progress).toEqual({ count: 0, target: 6 });
    });
});


describe('任務導覽：重用編號的關係隔離', () => {
    it.each([1, 2])('即時新任務（state %i）不沿用舊前後置、週期與 Wiki ID', apiState => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', { api_list: [{
            api_no: 984, api_state: apiState, api_title: '【期間限定任務】14年目実りの秋、南瓜始め！',
            api_detail: '新任務', api_category: 2,
        }] }, { api_tab_id: '0' }, 3000);
        const model = buildQuestFlow(state);
        const row = model.byNo.get(984)!;
        expect(row.name).toContain('14年目');
        expect(row.definition.category).toBe('sortie');
        expect(row.definition.wikiIds).toEqual([]);
        expect(row.definition.period).toBe('unknown');
        expect(row.prerequisiteNos).toEqual([]);
        expect(row.postrequisiteNos).toEqual([]);
        expect(row.relation.confidence).toBe('checking');
        for (const other of model.rows) {
            expect(other.prerequisiteNos).not.toContain(984);
            expect(other.remarkNos).not.toContain(984);
        }
    });
    it('重用編號不從人工裁決沿前置鏈推論完成', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', { api_list: [{
            api_no: 1052, api_state: 2, api_title: '別の新任務', api_detail: '新任務', api_category: 2,
        }] }, { api_tab_id: '0' }, 3000);
        const model = buildQuestFlow(state);
        expect(model.byNo.get(1052)!.relation.reviewed).toBeNull();
        expect(model.byNo.get(1052)!.prerequisiteNos).toEqual([]);
        expect(model.byNo.get(1050)!.status).not.toBe('inferred-complete');
    });
    it.each(['claim', 'stop', 'empty'])('新任務離開清單（%s）仍隔離舊關係', reason => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', { api_list: [{
            api_no: 984, api_state: 2, api_title: '別の新任務', api_detail: '新任務', api_category: 2,
        }] }, { api_tab_id: '0' }, 3000);
        if (reason === 'empty') state.applyEvent('api_get_member/questlist', { api_list: null }, { api_tab_id: '0' }, 4000);
        else state.applyEvent(reason === 'claim' ? 'api_req_quest/clearitemget' : 'api_req_quest/stop', {}, { api_quest_id: '984' }, 4000);
        const model = buildQuestFlow(state);
        expect(model.byNo.get(984)!.name).toBe('別の新任務');
        expect(model.byNo.get(984)!.prerequisiteNos).toEqual([]);
        expect(model.byNo.get(984)!.postrequisiteNos).toEqual([]);
    });
    it('未重用任務保持既有解鎖關係', () => {
        const model = buildQuestFlow(new GameState());
        expect(model.byNo.get(984)!.prerequisiteNos).toContain(207);
        expect(model.byNo.get(984)!.postrequisiteNos).toContain(985);
    });
});
