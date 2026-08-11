import { describe, expect, it } from 'vitest';
import { parseQuestGoal, resolveQuestGoal } from '../utils/quest-progress';
import { GameState } from '../utils/state';

function loadQuests(state: GameState) {
    state.applyEvent('api_get_member/questlist', {
        api_list: [
            { api_no: 1, api_state: 2, api_title: '艦隊酒保祭り！受注中', api_detail: '艦隊を補給せよ！補給15回を達成せよ！' },
            { api_no: 2, api_state: 2, api_title: '入渠任務', api_detail: '入渠を５回実施せよ！' },
        ],
    }, {});
}

describe('任務本機進度：補給與入渠', () => {
    it('從任務詳細文字辨識補給／入渠與全半形次數', () => {
        expect(parseQuestGoal('艦隊酒保祭り！受注中', '補給15回を達成せよ！')).toEqual({ kind: 'supply', target: 15 });
        expect(parseQuestGoal('入渠任務', '入渠を５回実施せよ！')).toEqual({ kind: 'dock', target: 5 });
    });

    it('入渠系任務用「N隻...ドック入り」（非「N回」）也要辨識為 dock（實際任務「艦隊大整備！」文字）', () => {
        expect(parseQuestGoal(
            '艦隊大整備！',
            '各艦隊から整備が必要な艦を5隻以上ドック入りさせ、大規模な整備をしよう！',
        )).toEqual({ kind: 'dock', target: 5 });
    });

    it('不把無關的「N隻」批次條件（撃沈/撃破數）誤判成 dock', () => {
        // 實際任務「海上通商破壊作戦」：撃沈数，非入渠動作次數，附近沒有「ドック入り／入渠」字樣。
        expect(parseQuestGoal('海上通商破壊作戦', '1週間で敵輸送船を20隻以上撃沈せよ！')).toBeNull();
    });

    it('在補給與入渠請求到達時分別累計，並在目標值封頂', () => {
        const state = new GameState();
        loadQuests(state);

        for (let i = 0; i < 16; i++) state.applyEvent('api_req_hokyu/charge', {}, {});
        for (let i = 0; i < 6; i++) state.applyEvent('api_req_nyukyo/start', {}, { api_ship_id: '1', api_ndock_id: '1', api_highspeed: '0' });

        expect(state.quests_().map(q => ({ no: q.no, progress: q.progress }))).toEqual([
            { no: 1, progress: { count: 15, target: 15 } },
            { no: 2, progress: { count: 5, target: 5 } },
        ]);
    });
});

describe('任務本機進度：出擊任務 id 白名單（僅無條件任務，見 QUEST_ID_OVERRIDES）', () => {
    it('任務 201「敵艦隊を撃破せよ！」內文沒有數字，文字解析回傳 null，須靠 id 白名單', () => {
        // 文字取自真實封包 samples/Quest.json（api_no=201）。
        expect(parseQuestGoal('敵艦隊を撃破せよ！', '艦隊を出撃させ、敵艦隊を捕捉、これを撃滅せよ！')).toBeNull();
        expect(resolveQuestGoal(201, '敵艦隊を撃破せよ！', '艦隊を出撃させ、敵艦隊を捕捉、これを撃滅せよ！'))
            .toEqual({ kind: 'battleWin', target: 1 });
    });

    it('未知 id 且文字解析不出目標時，resolveQuestGoal 回傳 null', () => {
        expect(resolveQuestGoal(999999, '未知任務', '沒有數字也沒有對照表的任務')).toBeNull();
    });

    it('battleresult rank 為 S/A/B 才累加 battleWin，rank 為 C/D 不計', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 201, api_state: 2, api_title: '敵艦隊を撃破せよ！', api_detail: '艦隊を出撃させ、敵艦隊を捕捉、これを撃滅せよ！' }],
        }, {});

        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'C' }, {});
        expect(state.quests_().find(q => q.no === 201)?.progress).toEqual({ count: 0, target: 1 });

        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'A' }, {});
        expect(state.quests_().find(q => q.no === 201)?.progress).toEqual({ count: 1, target: 1 });
    });

    it('任務210內文同時含「10回」與「出撃」，id 白名單須優先於文字解析（否則會被誤判成 sortie）', () => {
        const title = '敵艦隊を10回邀撃せよ！';
        const detail = '艦隊全力出撃！遊弋する敵艦隊を10回邀撃せよ！';
        expect(parseQuestGoal(title, detail)).toEqual({ kind: 'sortie', target: 10 }); // 文字解析本身確實會誤判
        expect(resolveQuestGoal(210, title, detail)).toEqual({ kind: 'battleEngage', target: 10 }); // id 白名單糾正回來
    });

    it('任務216「出撃一次（失敗可完成）」用 battleEngage，不論勝敗都算', () => {
        expect(resolveQuestGoal(216, '敵艦隊主力を撃滅せよ！', '艦隊を出撃させ、敵艦隊「主力」を捕捉！これを撃滅せよ！'))
            .toEqual({ kind: 'battleEngage', target: 1 });
    });

    it('battleEngage 不論 rank 都累加，battleWin 只在 S/A/B 累加，同一次結算兩者可能不同步', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [
                { api_no: 210, api_state: 2, api_title: '敵艦隊を10回邀撃せよ！', api_detail: '艦隊全力出撃！遊弋する敵艦隊を10回邀撃せよ！' },
                { api_no: 201, api_state: 2, api_title: '敵艦隊を撃破せよ！', api_detail: '艦隊を出撃させ、敵艦隊を捕捉、これを撃滅せよ！' },
            ],
        }, {});

        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'C' }, {}); // 輸了：battleEngage算、battleWin不算
        expect(state.quests_().find(q => q.no === 210)?.progress).toEqual({ count: 1, target: 10 });
        expect(state.quests_().find(q => q.no === 201)?.progress).toEqual({ count: 0, target: 1 });

        state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' }, {}); // 贏了：兩者都算
        expect(state.quests_().find(q => q.no === 210)?.progress).toEqual({ count: 2, target: 10 });
        expect(state.quests_().find(q => q.no === 201)?.progress).toEqual({ count: 1, target: 1 });
    });

    it('工廠/改裝類無數字任務（605/606/608/609/613/619/1166/1167）靠 id 白名單解出目標', () => {
        expect(resolveQuestGoal(605, '新装備「開発」指令', '「工廠」で装備アイテムを新たに「開発」しよう(失敗もOK)！'))
            .toEqual({ kind: 'development', target: 1 });
        expect(resolveQuestGoal(606, '新造艦「建造」指令', '「工廠」で艦娘を本日中に新たに「建造」しよう！'))
            .toEqual({ kind: 'build', target: 1 });
        expect(resolveQuestGoal(608, '艦娘「建造」艦隊強化！', '艦隊強化のため、「工廠」で艦娘を本日中に新たに3隻「建造」しよう！'))
            .toEqual({ kind: 'build', target: 3 });
        expect(resolveQuestGoal(609, '軍縮条約対応！', '少し艦隊規模が大きくなりすぎました！「工廠」で不要な艦を2隻「解体」してください！'))
            .toEqual({ kind: 'shipScrap', target: 2 });
        expect(resolveQuestGoal(613, '資源の再利用', '「工廠」で余剰の装備アイテムをなるべく多く「廃棄」して、鋼材の再利用に努めよう！'))
            .toEqual({ kind: 'gearScrap', target: 24 });
        expect(resolveQuestGoal(619, '装備の改修強化', '「改修工廠」で「装備」の改修強化に努めます。'))
            .toEqual({ kind: 'remodelAttempt', target: 1 });
        expect(resolveQuestGoal(1166, '続：装備の改修強化', '工廠任務：「改修工廠」で「装備」のさらなる改修強化を実施せよ！'))
            .toEqual({ kind: 'remodel', target: 1 });
        expect(resolveQuestGoal(1167, '装備の改修集中強化', '工廠任務：さらなる戦力強化のため、本日中に「改修工廠」で「装備」改修強化を連続三回実施せよ！'))
            .toEqual({ kind: 'remodel', target: 3 }); // 漢字數字「三回」非阿拉伯數字，文字解析吃不到，須靠 id 白名單
    });

    it('解体艦娘一次請求可逗號分隔多艘，逐艘計數（非逐次請求計數）', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 609, api_state: 2, api_title: '軍縮条約対応！', api_detail: '少し艦隊規模が大きくなりすぎました！「工廠」で不要な艦を2隻「解体」してください！' }],
        }, {});

        state.applyEvent('api_req_kaisou/destroyship', {}, { api_ship_id: '11,22', api_slot_dest: '0' });
        expect(state.quests_().find(q => q.no === 609)?.progress).toEqual({ count: 2, target: 2 });
    });

    it('廢棄裝備一次請求可逗號分隔多個，逐個計數', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 613, api_state: 2, api_title: '資源の再利用', api_detail: '「工廠」で余剰の装備アイテムをなるべく多く「廃棄」して、鋼材の再利用に努めよう！' }],
        }, {});

        state.applyEvent('api_req_kaisou/destroyitem2', {}, { api_slotitem_ids: '1,2,3' });
        expect(state.quests_().find(q => q.no === 613)?.progress).toEqual({ count: 3, target: 24 });
    });

    it('改修「嘗試」不論成敗都累加 remodelAttempt，remodel 僅成功才累加，兩者可能不同步', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [
                { api_no: 619, api_state: 2, api_title: '装備の改修強化', api_detail: '「改修工廠」で「装備」の改修強化に努めます。' },
                { api_no: 1166, api_state: 2, api_title: '続：装備の改修強化', api_detail: '工廠任務：「改修工廠」で「装備」のさらなる改修強化を実施せよ！' },
            ],
        }, {});

        state.applyEvent('api_req_kousyou/remodel_slot', { api_remodel_flag: 0 }, { api_slot_id: '1' }); // 失敗
        expect(state.quests_().find(q => q.no === 619)?.progress).toEqual({ count: 1, target: 1 });
        expect(state.quests_().find(q => q.no === 1166)?.progress).toEqual({ count: 0, target: 1 });

        state.applyEvent('api_req_kousyou/remodel_slot', { api_remodel_flag: 1 }, { api_slot_id: '2' }); // 成功
        expect(state.quests_().find(q => q.no === 619)?.progress).toEqual({ count: 1, target: 1 }); // 已達標，不再累加
        expect(state.quests_().find(q => q.no === 1166)?.progress).toEqual({ count: 1, target: 1 });
    });
});

// 出擊到 area/mapNo，走一節點戰鬥並結算，回傳結算 rank；boss 用 color=5 表示。
function sortieAndBattleresult(state: GameState, mapArea: number, mapNo: number, boss: boolean, rank: string) {
    state.applyEvent('api_req_map/start', { api_maparea_id: mapArea, api_mapinfo_no: mapNo, api_no: 1, api_color_no: boss ? 5 : 1 }, { api_deck_id: '1' });
    state.applyEvent('api_req_sortie/battleresult', { api_win_rank: rank }, {});
}

describe('任務本機進度：海域/boss/rank 限定的出擊任務（226/229/241/242/243/261/265）', () => {
    it('任務226「南西諸島海域」限定 area 21~25＋boss＋B胜以上，海域不符不算', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 226, api_state: 2, api_title: '南西諸島海域の制海権を握れ！', api_detail: '艦隊を南西諸島海域に全力出撃させ、多数の敵艦隊「主力」群を捕捉、撃滅せよ！' }],
        }, {});

        sortieAndBattleresult(state, 4, 1, true, 'A'); // 海域不符（4-1 非南西諸島）
        expect(state.quests_().find(q => q.no === 226)?.progress).toEqual({ count: 0, target: 5 });

        sortieAndBattleresult(state, 2, 3, false, 'A'); // 海域符合但非 boss 節點
        expect(state.quests_().find(q => q.no === 226)?.progress).toEqual({ count: 0, target: 5 });

        sortieAndBattleresult(state, 2, 3, true, 'C'); // boss 但 rank 不足 B
        expect(state.quests_().find(q => q.no === 226)?.progress).toEqual({ count: 0, target: 5 });

        sortieAndBattleresult(state, 2, 5, true, 'B'); // 2-5 也算南西諸島範圍內、boss、B胜
        expect(state.quests_().find(q => q.no === 226)?.progress).toEqual({ count: 1, target: 5 });
    });

    it('任務243「5-2」限定 S 勝，A 勝不算', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 243, api_state: 2, api_title: '南方海域珊瑚諸島沖の制空権を握れ！', api_detail: '南方海域珊瑚諸島沖に出撃し、敵機動部隊本体を撃滅、これに完全勝利せよ！' }],
        }, {});

        sortieAndBattleresult(state, 5, 2, true, 'A'); // boss 但只有 A，未達 S 門檻
        expect(state.quests_().find(q => q.no === 243)?.progress).toEqual({ count: 0, target: 2 });

        sortieAndBattleresult(state, 5, 2, true, 'S');
        expect(state.quests_().find(q => q.no === 243)?.progress).toEqual({ count: 1, target: 2 });
    });

    it('同一次結算可能同時符合無條件與海域限定任務，各自獨立判斷', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [
                { api_no: 201, api_state: 2, api_title: '敵艦隊を撃破せよ！', api_detail: '艦隊を出撃させ、敵艦隊を捕捉、これを撃滅せよ！' },
                { api_no: 242, api_state: 2, api_title: '敵東方中枢艦隊を撃破せよ！', api_detail: '西方海域カスガダマ島沖に出撃し、敵東方中枢艦隊を捕捉、これを撃破せよ！' },
            ],
        }, {});

        sortieAndBattleresult(state, 4, 4, true, 'A'); // 4-4 boss A胜：201(任意)算、242(限定4-4 boss B+)也算
        expect(state.quests_().find(q => q.no === 201)?.progress).toEqual({ count: 1, target: 1 });
        expect(state.quests_().find(q => q.no === 242)?.progress).toEqual({ count: 1, target: 1 });
    });
});

describe('任務本機進度：限定特定遠征任務 id（410/411/424）', () => {
    function expedition(state: GameState, deckId: number, missionId: number, clearResult: number) {
        state.applyEvent('api_req_mission/start', { api_complatetime: 0 }, { api_deck_id: String(deckId), api_mission_id: String(missionId) });
        state.applyEvent('api_req_mission/result', { api_clear_result: clearResult }, { api_deck_id: String(deckId) });
    }

    it('任務410限定「東京急行」系（id 37/38），其他遠征成功不算', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 410, api_state: 2, api_title: '南方への輸送作戦を成功させよ！', api_detail: '激戦海域である南方海域への「東京急行」系遠征を敢行、これを成功させよ！' }],
        }, {});

        expedition(state, 1, 5, 1); // 海上護衛任務成功，非東京急行系
        expect(state.quests_().find(q => q.no === 410)?.progress).toEqual({ count: 0, target: 1 });

        expedition(state, 1, 38, 1); // 東京急行(弐)成功
        expect(state.quests_().find(q => q.no === 410)?.progress).toEqual({ count: 1, target: 1 });
    });

    it('任務424限定「海上護衛任務」（id 5）四次，累計並在目標值封頂', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 424, api_state: 2, api_title: '輸送船団護衛を強化せよ！', api_detail: '遠征任務：「海上護衛任務」を反復実施し、輸送船団の護衛に務めよ！' }],
        }, {});

        expedition(state, 1, 37, 1); // 東京急行，非海上護衛任務
        expect(state.quests_().find(q => q.no === 424)?.progress).toEqual({ count: 0, target: 4 });

        for (let i = 0; i < 5; i++) expedition(state, 1, 5, 1);
        expect(state.quests_().find(q => q.no === 424)?.progress).toEqual({ count: 4, target: 4 });
    });
});

describe('任務清單同步：完整 tab 缺席清除（2020-03-27 起 API 不分頁）', () => {
    function seedActive(state: GameState, nos: number[], doneNo?: number) {
        state.applyEvent('api_get_member/questlist', {
            api_list: nos.map(no => ({
                api_no: no,
                api_state: no === doneNo ? 3 : 2,
                api_title: `任務${no}`,
                api_detail: '補給15回を達成せよ！',
            })),
        }, { api_tab_id: '9' });
    }

    it('tab 9（遂行中）缺席的達成任務必須從面板清除', () => {
        const state = new GameState();
        seedActive(state, [201, 210], 201);
        expect(state.quests_().map(q => q.no).sort()).toEqual([201, 210]);
        expect(state.quests_().find(q => q.no === 201)?.done).toBe(true);

        // 領完 201 後再開遂行中：清單只剩 210（201 缺席＝已不在受注中/達成）
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 210, api_state: 2, api_title: '任務210', api_detail: '補給15回を達成せよ！' }],
        }, { api_tab_id: '9' });

        expect(state.quests_().map(q => q.no)).toEqual([210]);
        expect(state.questProgress.has(201)).toBe(false);
    });

    it('tab 0（全て）缺席或變回未受注（state 1）的任務必須清除', () => {
        const state = new GameState();
        seedActive(state, [201, 210], 201);

        state.applyEvent('api_get_member/questlist', {
            api_list: [
                { api_no: 210, api_state: 2, api_title: '任務210', api_detail: '補給15回を達成せよ！' },
                // 201 已領獎後隔日重置會以 state 1 再出現；同時驗證 -1 空欄不誤判
                { api_no: 201, api_state: 1, api_title: '任務201', api_detail: '…' },
                -1,
            ],
        }, { api_tab_id: '0' });

        expect(state.quests_().map(q => q.no)).toEqual([210]);
        expect(state.questProgress.has(201)).toBe(false);
    });

    it('tab 9 回傳 api_list=null（該集合空了）時清空本機追蹤', () => {
        const state = new GameState();
        seedActive(state, [201], 201);

        state.applyEvent('api_get_member/questlist', { api_list: null }, { api_tab_id: '9' });
        expect(state.quests_()).toEqual([]);
        expect(state.questProgress.size).toBe(0);
    });

    it('子集 tab（例如每日）缺席不得誤刪其他分類的任務', () => {
        const state = new GameState();
        seedActive(state, [201, 210]);

        // 只刷新每日 tab：清單裡沒有 210 不代表 210 消失了
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 201, api_state: 2, api_title: '任務201', api_detail: '補給15回を達成せよ！' }],
        }, { api_tab_id: '1' });

        expect(state.quests_().map(q => q.no).sort()).toEqual([201, 210]);
    });

    it('clearitemget 仍即時刪除；缺 api_quest_id 時不亂刪', () => {
        const state = new GameState();
        seedActive(state, [201, 210], 201);

        state.applyEvent('api_req_quest/clearitemget', {}, { api_quest_id: '201' });
        expect(state.quests_().map(q => q.no)).toEqual([210]);

        state.applyEvent('api_req_quest/clearitemget', {}, {});
        expect(state.quests_().map(q => q.no)).toEqual([210]);
    });

    it('無 api_tab_id 的舊封包維持只更新出現列、不因缺席刪除（防禦）', () => {
        const state = new GameState();
        seedActive(state, [201, 210], 201);

        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 210, api_state: 2, api_title: '任務210', api_detail: '補給15回を達成せよ！' }],
        }, {});

        expect(state.quests_().map(q => q.no).sort()).toEqual([201, 210]);
    });
});
