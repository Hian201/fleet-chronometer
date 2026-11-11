// 任務編號的身分核對（utils/quest-identity.ts）。期間限定任務每年內容不同但會重用編號，
// 標題與目錄不同時不可套用以編號對應的舊譯文、舊獎勵與舊進度條件。
import { describe, expect, it } from 'vitest';
import { questCatalogIdentity, questTitleKey } from '../utils/quest-identity';
import { buildQuestFlow } from '../utils/quest-flow';
import { GameState } from '../utils/state';
import { QUEST_CATALOG_RAW } from '../utils/quest-catalog-data';
import japaneseTitles from './fixtures/quest-catalog-japanese-titles.json';
import { questCatalogTranslation, localizedQuestReward } from '../utils/quest-catalog-localization';

// 2026 南瓜任務實施期間（10/14～11/11）內的觀測時間；結束後同編號一律視為重用。
const DURING_HALLOWEEN_2026 = Date.parse('2026-11-01T12:00:00+09:00');

describe('questCatalogIdentity', () => {
    it('所有目錄任務與固定版本 KC3Kai 日文標題相符', () => {
        // 固定版本 KC3 尚未收錄的 2026-11-11 新任務：標題依營運公告與遊戲任務清單（381 為重用編號）
        const titles = new Map([
            ...japaneseTitles.titles as [number, string][],
            [381, '【期間限定任務】秋月型演習任務2026'],
            [1172, '【雷装強化工廠任務】夜戦突撃装備の強化【I】'],
        ]);
        for (const [no] of QUEST_CATALOG_RAW) {
            const title = titles.get(no);
            expect(title, `任務 ${no} 的來源日文標題`).toBeTruthy();
            expect(questCatalogIdentity(no, title, DURING_HALLOWEEN_2026), `任務 ${no}：${title}`).toBe('match');
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
        // 目錄是 2026 年版（14年目），假設隔年沿用同一編號
        expect(questCatalogIdentity(984, '【期間限定任務】14年目実りの秋、南瓜始め！', DURING_HALLOWEEN_2026)).toBe('match');
        expect(questCatalogIdentity(984, '【期間限定任務】15年目実りの秋、南瓜始め！', DURING_HALLOWEEN_2026)).toBe('mismatch');
    });

    it('已結束的期間限定任務：結束後再出現時標題相同也是重用編號（1119 的 2025、2026 年標題一字不差）', () => {
        const title = '【期間限定】Halloweenの南瓜、食べりゅ?';
        expect(questCatalogIdentity(1119, title, DURING_HALLOWEEN_2026)).toBe('match');
        // 11/11 維護當天仍可能讀到維護前的清單；隔天 0 時（日本時間）起才判定結束
        expect(questCatalogIdentity(1119, title, Date.parse('2026-11-11T23:59:59+09:00'))).toBe('match');
        expect(questCatalogIdentity(1119, title, Date.parse('2026-11-12T00:00:00+09:00'))).toBe('mismatch');
        expect(questCatalogIdentity(1119, title, Date.parse('2027-10-14T20:00:00+09:00'))).toBe('mismatch');
        // 沒有結束日的任務仍只比標題
        expect(questCatalogIdentity(1047, '「涼波改二」ラバウルより抜錨せよ！', Date.parse('2030-01-01T00:00:00+09:00'))).toBe('match');
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
            api_no: 986, api_state: apiState, api_title: '【期間限定任務】15年目の南瓜祭り！',
            api_detail: '新任務', api_category: 2,
        }] }, { api_tab_id: '0' }, 3000);
        const model = buildQuestFlow(state);
        const row = model.byNo.get(986)!;
        expect(row.name).toContain('15年目');
        expect(row.definition.category).toBe('sortie');
        expect(row.definition.wikiIds).toEqual([]);
        expect(row.definition.period).toBe('unknown');
        expect(row.prerequisiteNos).toEqual([]);
        expect(row.postrequisiteNos).toEqual([]);
        expect(row.relation.confidence).toBe('checking');
        for (const other of model.rows) {
            expect(other.prerequisiteNos).not.toContain(986);
            expect(other.remarkNos).not.toContain(986);
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
    it('已結束的期間限定任務隔年以相同標題出現：視為新任務，不沿用今年的週期、代號與關係', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', { api_list: [{
            api_no: 1119, api_state: 2, api_title: '【期間限定】Halloweenの南瓜、食べりゅ?',
            api_detail: '新任務', api_category: 6,
        }] }, { api_tab_id: '0' }, Date.parse('2027-10-14T20:00:00+09:00'));
        const row = buildQuestFlow(state).byNo.get(1119)!;
        expect(row.definition.catalogMismatch).toBe(true);
        expect(row.definition.wikiIds).toEqual([]);
        expect(row.definition.limitedWindow).toBeUndefined();
        expect(row.prerequisiteNos).toEqual([]);
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
        expect(model.byNo.get(986)!.prerequisiteNos).toContain(359);
        expect(model.byNo.get(986)!.postrequisiteNos).toContain(987);
    });
});
