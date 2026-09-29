import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import {
    buildQuestFlow, normalizeQuestSearch, questRelation, questSearchHaystack,
    QUEST_CATALOG, QUEST_CATALOG_BY_NO,
} from '../utils/quest-flow';
import type { QuestDefinition } from '../utils/quest-flow';

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
        // 舰娘百科另列 Cs8 秋季大演習（313），目前只有它一個來源
        expect(questRelation(1052).prerequisites).toEqual([313, 1050]);
        expect(questRelation(1052).edges.find(edge => edge.no === 313)?.evidence).toBe('single-source');
        expect(questRelation(1170).prerequisites).toEqual([1050]);
        expect(questRelation(1052).operator).toBe('unknown');
        // 目錄 wiki 列 Bd8 與 A44，KC3 開放邊只有 Bd8：KC3 少列不算矛盾。
        // wikiwiki 總表尚未收錄 By18，沒有「及び」句型可依，組合維持不可考。
        expect(questRelation(1051).operator).toBe('unknown');
        expect(questRelation(1051).confidence).not.toBe('conflict');
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

const syntheticDefinition = (overrides: Partial<QuestDefinition>): QuestDefinition => ({
    apiNo: 999990,
    wikiIds: [],
    name: '測試任務',
    detail: '',
    category: 'unknown',
    period: 'once',
    limited: false,
    limitedState: 'unknown',
    apiCategory: null,
    apiType: null,
    wikiPrerequisites: [],
    structuredPrerequisites: [],
    unresolvedPrerequisites: [],
    sources: [],
    wikiPresent: false,
    structuredPresent: false,
    wikiConditionUnknown: false,
    structuredConditionUnknown: false,
    ...overrides,
});

describe('任務前置的逐條證據', () => {
    it('某來源少列前置只是沒提到，不算衝突；逐條記錄支持來源', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101, 102],
            structuredPrerequisites: [101],
            wikiPresent: true,
            structuredPresent: true,
        }));
        expect(relation.operator).toBe('unknown');
        expect(relation.confidence).toBe('single-source');
        expect(relation.edges.map(edge => [edge.no, edge.evidence])).toEqual([
            [101, 'confirmed'],
            [102, 'single-source'],
        ]);
    });

    it('wiki 的「及び」「または」句型決定 all／any，混合時不壓成單一運算子', () => {
        const edge = (no: number) => ({ no, pending: false });
        const all = questRelation(syntheticDefinition({
            wikiPrerequisites: [101, 102], wikiPresent: true, wikiClauses: [[edge(101)], [edge(102)]],
        }));
        const any = questRelation(syntheticDefinition({
            wikiPrerequisites: [101, 102], wikiPresent: true, wikiClauses: [[edge(101), edge(102)]],
        }));
        const mixed = questRelation(syntheticDefinition({
            wikiPrerequisites: [101, 102, 103], wikiPresent: true,
            wikiClauses: [[edge(101)], [edge(102), edge(103)]],
        }));
        expect(all.operator).toBe('all');
        expect(any.operator).toBe('any');
        expect(mixed.operator).toBe('unknown');
        expect(mixed.clauses).toEqual([[101], [102, 103]]);
    });

    it('其他來源多列 wiki 句型沒有的前置時，不沿用 wiki 的組合', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiClauses: [[{ no: 101, pending: false }]],
            structuredPrerequisites: [101, 102], structuredPresent: true,
        }));
        expect(relation.clauses).toBeNull();
        expect(relation.operator).toBe('unknown');
    });

    it('wiki 標【検証中】的前置讓整體可信度為檢證中', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101, 102], wikiPresent: true,
            wikiClauses: [[{ no: 101, pending: false }], [{ no: 102, pending: true }]],
            structuredPrerequisites: [101, 102], structuredPresent: true,
        }));
        expect(relation.operator).toBe('all');
        expect(relation.confidence).toBe('checking');
        expect(relation.edges.find(edge => edge.no === 102)?.pending).toBe(true);
    });

    it('ぜかまし明確列出的前置，解除 wiki 的【検証中】；兩方都待驗證時維持', () => {
        const wikiClauses = [[{ no: 101, pending: true }], [{ no: 102, pending: true }]];
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101, 102], wikiPresent: true, wikiClauses,
            zekamashiPrerequisites: [{ no: 101, pending: false }, { no: 102, pending: true }],
        }));
        expect(relation.edges.find(edge => edge.no === 101)).toMatchObject({
            pending: false, evidence: 'confirmed', sources: ['catalog', 'zekamashi'],
        });
        expect(relation.edges.find(edge => edge.no === 102)?.pending).toBe(true);
        expect(relation.confidence).toBe('checking');
    });

    it('ぜかまし多列的前置成為額外的 AND 子句，並補上 wiki「他」的缺口', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiConditionUnknown: true,
            wikiClauses: [[{ no: 101, pending: false }]],
            zekamashiPrerequisites: [{ no: 101, pending: false }, { no: 102, pending: false }],
        }));
        expect(relation.clauses).toEqual([[101], [102]]);
        expect(relation.operator).toBe('all');
        expect(relation.confidence).toBe('single-source');
    });

    it('ぜかまし自己註記「他不明」且沒有其他來源補上時，組合維持不可考', () => {
        const relation = questRelation(syntheticDefinition({
            zekamashiPrerequisites: [{ no: 101, pending: false }], zekamashiConditionUnknown: true,
        }));
        expect(relation.operator).toBe('unknown');
        expect(relation.confidence).toBe('checking');
    });

    it('ぜかまし與 wiki 互有對方沒有的前置時才算衝突', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiClauses: [[{ no: 101, pending: false }]],
            zekamashiPrerequisites: [{ no: 102, pending: false }],
        }));
        expect(relation.operator).toBe('conflict');
    });

    it('wiki 與ぜかまし一致時，只有 KC3／poi 多列的前置標為有爭議，不成為 conflict', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiClauses: [[{ no: 101, pending: false }]],
            zekamashiPrerequisites: [{ no: 101, pending: false }],
            structuredPrerequisites: [102], structuredPresent: true,
        }));
        expect(relation.operator).not.toBe('conflict');
        expect(relation.edges.find(edge => edge.no === 102)).toMatchObject({ disputed: true, pending: true });
        expect(relation.edges.find(edge => edge.no === 101)?.evidence).toBe('confirmed');
    });

    it('來源衝突時以至少兩個來源的共識為主要前置，單一來源的說法列為備考', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101, 102], wikiPresent: true,
            wikiClauses: [[{ no: 101, pending: false }], [{ no: 102, pending: false }]],
            zekamashiPrerequisites: [{ no: 101, pending: false }, { no: 103, pending: false }],
            structuredPrerequisites: [101, 102], structuredPresent: true,
        }));
        expect(relation.consensus).toBe(true);
        expect(relation.operator).toBe('all');
        expect(relation.prerequisites).toEqual([101, 102]);
        expect(relation.remarks.map(edge => [edge.no, edge.sources])).toEqual([[103, ['zekamashi']]]);
    });

    it('tsukinohashi 只在衝突時投票；沒有衝突的任務不受它影響', () => {
        const calm = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiClauses: [[{ no: 101, pending: false }]],
            tsukinohashiPrerequisites: [999],
        }));
        expect(calm.prerequisites).toEqual([101]);
        expect(calm.sources).not.toContain('tsukinohashi');

        const contested = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiClauses: [[{ no: 101, pending: false }]],
            structuredPrerequisites: [102], structuredPresent: true,
            tsukinohashiPrerequisites: [102],
        }));
        expect(contested.consensus).toBe(true);
        expect(contested.prerequisites).toEqual([102]);
        expect(contested.edges[0].sources).toEqual(['structured', 'tsukinohashi']);
        expect(contested.remarks.map(edge => edge.no)).toEqual([101]);
    });

    it('沒有任何前置達到兩個來源時維持 conflict', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiClauses: [[{ no: 101, pending: false }]],
            structuredPrerequisites: [102], structuredPresent: true,
        }));
        expect(relation.consensus).toBe(false);
        expect(relation.operator).toBe('conflict');
        expect(relation.remarks).toEqual([]);
    });

    it('產生資料：A82 以 D27＋Dd1 為主要前置，ぜかまし單獨提出的 Bw8 為備考', () => {
        const relation = questRelation(187);
        expect(relation.consensus).toBe(true);
        expect(relation.prerequisites).toEqual([402, 429]);
        expect(relation.remarks.map(edge => edge.no)).toEqual([242]);
    });

    it('產生資料：poi 前置改用 quest-planner 新版，取代目錄舊版而不另計來源', () => {
        // A51（153）：目錄舊版 poi 列 A17＋B42，quest-planner 新版只列 B42，與 wiki 一致
        const definition = QUEST_CATALOG_BY_NO.get(153)!;
        expect(definition.structuredPrerequisites).toEqual([274]);
        expect(questRelation(153).edges.find(edge => edge.no === 111)).toBeUndefined();
        expect(questRelation(153).confidence).not.toBe('conflict');
    });

    it('舰娘百科與 poi 同源，計票合為一票，不會湊成兩個來源的共識', () => {
        const relation = questRelation(syntheticDefinition({
            wikiPrerequisites: [101], wikiPresent: true, wikiClauses: [[{ no: 101, pending: false }]],
            structuredPrerequisites: [102], structuredPresent: true,
            kcwikiPrerequisites: [{ no: 102, pending: false }],
        }));
        expect(relation.operator).toBe('conflict');
        expect(relation.consensus).toBe(false);
    });

    it('人工裁決：C56 以 B14＋C31 為主要前置，ぜかまし標要確認的 A50 列為備考', () => {
        const relation = questRelation(351);
        expect(relation.reviewed).toBe('2026-09-28');
        expect(relation.operator).toBe('all');
        expect(relation.prerequisites).toEqual([224, 331]);
        expect(relation.remarks.map(edge => [edge.no, edge.pending])).toEqual([[152, true]]);
        expect(relation.confidence).not.toBe('conflict');
    });

    it('人工裁決：Fy10 前置未定，四個候選都列為備考、不推論', () => {
        const relation = questRelation(1123);
        expect(relation.prerequisites).toEqual([]);
        expect(relation.remarks.map(edge => edge.no)).toEqual([682, 715, 716, 869]);
        expect(relation.operator).toBe('unknown');
        expect(relation.confidence).toBe('checking');
    });

    it('人工裁決：C33 ← Cq1（可能另有條件）、Bq9 ← Cd1，舰娘百科的說法列為備考', () => {
        const c33 = questRelation(333);
        expect(c33.prerequisites).toEqual([330]);
        expect(c33.remarks.map(edge => edge.no)).toEqual([209]);
        expect(c33.operator).toBe('unknown');
        const bq9 = questRelation(894);
        expect(bq9.prerequisites).toEqual([303]);
        expect(bq9.remarks.map(edge => edge.no)).toEqual([206]);
    });

    it('人工裁決：2412B7 ← 海上護衛部隊 特別演習！＋鎮守府大掃除！良いお年を！', () => {
        const relation = questRelation(990);
        expect(relation.prerequisites).toEqual([361, 1121]);
        expect(relation.operator).toBe('all');
        expect(relation.remarks.map(edge => edge.no)).toEqual([910]);
    });

    it('人工裁決：2603D1 的觸發條件在 2026-04-07 維護時更新，依日期取對應前置', () => {
        const march = questRelation(450, Date.parse('2026-03-20T12:00:00+09:00'));
        expect(march.prerequisites).toEqual([709]);
        expect(march.phases?.map(phase => phase.current)).toEqual([true, false]);
        const april = questRelation(450, Date.parse('2026-04-08T12:00:00+09:00'));
        expect(april.prerequisites).toEqual([941]);
        expect(april.phases?.map(phase => phase.current)).toEqual([false, true]);
        expect(april.confidence).not.toBe('conflict');
    });

    it('產生資料：B204 與 2603G2 補齊代號後，期間限定前置對上 KC3 的 api_no', () => {
        // 1020＝2409B1「第三戦隊」緊急展開！、450＝2603D1「水雷戦隊遠征作戦！」
        expect(QUEST_CATALOG_BY_NO.get(1020)?.wikiIds).toContain('2409B1');
        expect(questRelation(1017).prerequisites).toContain(1020);
        expect(questRelation(1017).confidence).not.toBe('conflict');
        expect(questRelation(720).prerequisites).toEqual([450, 702]);
        expect(questRelation(720).confidence).not.toBe('conflict');
    });

    it('產生資料：B137 的兩條【検証中】前置已由ぜかまし攻略確認', () => {
        // B137（283）：wiki「【検証中】(C33) 及び 【検証中】(B40)」，ぜかまし明確列出兩者
        const relation = questRelation(283);
        expect(relation.clauses).toEqual([[333], [272]]);
        expect(relation.edges.every(edge => !edge.pending)).toBe(true);
        expect(relation.operator).toBe('all');
        expect(relation.sources).toContain('zekamashi');
    });

    it('wikiwiki 產生資料：Fq2 與 B48 的組合依現行開放条件', () => {
        // Fq2（643）：(F38) 及び (Dw2)
        expect(questRelation(643).clauses).toEqual([[642], [410]]);
        expect(questRelation(643).operator).toBe('all');
        // B48（286）：wiki「【検証中】(B5) 及び 【検証中】(Bd1) または 【検証中】(Bd2)」；
        // 舰娘百科明確列出 B5 與 Bd2，解除這兩條的待驗證，Bd1 仍待驗證
        const b48 = questRelation(286);
        expect(b48.clauses).toEqual([[205], [201, 216]]);
        expect(b48.edges.map(edge => [edge.no, edge.pending])).toEqual([[201, true], [205, false], [216, false]]);
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

    it('前置鏈不經過待驗證的前置，也不把定期任務標成推論完成', () => {
        // B121（889）：(B115) 及び (Dd1) 及び 【検証中】(Bm3)
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 889, api_state: 2, api_title: 'B121', api_detail: '內容' }],
        }, { api_tab_id: '9' });

        const model = buildQuestFlow(state);
        expect(model.byNo.get(880)?.status).toBe('inferred-complete');
        expect(model.byNo.get(257)?.status).not.toBe('inferred-complete');
        expect(model.byNo.get(402)?.status).not.toBe('inferred-complete');
    });

    it('接到的任務：單發前置推論已完成，定期前置維持未完成並列為本週期待完成', () => {
        // A82（187）主要前置：D27（429，單發）＋Dd1（402，每日）；Bw8 為備考
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 187, api_state: 2, api_title: 'A82', api_detail: '內容' }],
        }, { api_tab_id: '9' });

        const model = buildQuestFlow(state);
        expect(model.byNo.get(429)?.status).toBe('inferred-complete');
        expect(model.byNo.get(402)?.status).not.toBe('inferred-complete');
        expect(model.byNo.get(242)?.status).not.toBe('inferred-complete');
    });

    it('未出現的任務：主要前置中本週期未完成的定期任務列為 periodicBlockerNos', () => {
        const state = new GameState();
        const model = buildQuestFlow(state);
        const row = model.byNo.get(187)!;
        expect(row.periodicBlockerNos).toEqual([402]);
        expect(row.remarkNos).toEqual([242]);
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
