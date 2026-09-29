// 任務進度判定（utils/quest-goals.ts 條件表引擎、utils/quest-tracking.ts 可信度）與 GameState 串接。
// 要鎖住的性質：
//   1. 條件表語意：艦娘 id 表示「此改造階段以後」；僚艦預設含旗艦；escortshipId OR、escortshipIdAll AND；
//      mapcell 以 edge 比對；認不得的欄位或事件整個任務不支援，不可默默放寬。
//   2. 一場戰鬥回報走得最遠的失敗原因；擊沉只算指定艦種。
//   3. 伺服器回報只當推算範圍；本機少算顯示範圍，本機多算（或已滿而未達成）需重核。
//   4. 文字級只抽官方說明文字明寫的必要條件（含大區名稱），符合者只算候選。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    fleetReason, judgeBattleGoals, judgeMissionGoals, judgePracticeGoals, judgeReachGoals, mapListLabel, questDay,
    questGoalDef, simpleGoalFromDef, sinkingGains, type FleetFacts,
} from '../utils/quest-goals';
import {
    compareWithServer, extractTextRule, formatQuestTime, judgeTextBattle, progressRange, questTier, serverBounds,
    type BattleFacts, type ServerObservation,
} from '../utils/quest-tracking';
import { GameState } from '../utils/state';
import { questConditionShort } from '../utils/quest-goal-label';
import { setLang } from '../utils/ui-i18n';

// 涼波改二 1034 → 涼波改二補 745；鳥海 69、玉波 674；睦月 1 當作不相關的艦。
const LINE: Record<number, number[]> = { 745: [745, 1034, 710, 675], 1034: [1034, 710, 675] };
const fleetOf = (ids: number[], stype = 2): FleetFacts => ({
    countsAs: ids.map(id => LINE[id] ?? [id]), stype: ids.map(() => stype), ctype: ids.map(() => 0),
});
const FLEET_OK = fleetOf([1034, 69, 674, 1, 1, 1]);
const DEF_1047 = questGoalDef(1047)!;

describe('條件表：1047 的定義與判定', () => {
    it('條件表收錄 1047：5-4／5-5 王點 S 各 2 次，5-6 限定 edge 43（Z）', () => {
        expect(DEF_1047.supported).toBe(true);
        expect(DEF_1047.subgoals.map(sub => [sub.event, sub.maparea, sub.mapcell ?? null, sub.required])).toEqual([
            ['battle_boss_win_rank_s', [54], null, 2],
            ['battle_boss_win_rank_s', [55], null, 2],
            ['battle_boss_win_rank_s', [56], [43], 2],
        ]);
    });

    it('符合時只計入該海域的子目標', () => {
        expect(judgeBattleGoals(DEF_1047, [0, 0, 0], { maparea: 54, mapcell: 20, boss: true, rank: 'S', fleet: FLEET_OK }))
            .toEqual({ counted: [0], reason: null });
    });

    it('不在任何目標海域的戰鬥不記錄', () => {
        expect(judgeBattleGoals(DEF_1047, [0, 0, 0], { maparea: 11, mapcell: 1, boss: true, rank: 'S', fleet: FLEET_OK })).toBeNull();
    });

    it('回報旗艦、僚艦、非 Boss、節點、評價、已達成', () => {
        const at = (over: Partial<{ maparea: number; mapcell: number; boss: boolean; rank: string; fleet: FleetFacts }>, counts = [0, 0, 0]) =>
            judgeBattleGoals(DEF_1047, counts, { maparea: 54, mapcell: 20, boss: true, rank: 'S', fleet: FLEET_OK, ...over })?.reason;
        expect(at({ fleet: fleetOf([69, 1034, 674]) })).toBe('flagship');
        expect(at({ fleet: fleetOf([1034, 69, 1, 1]) })).toBe('escort');
        expect(at({ boss: false })).toBe('notBoss');
        expect(at({ maparea: 56, mapcell: 41 })).toBe('node');
        expect(at({ rank: 'A' })).toBe('rank');
        expect(at({}, [2, 0, 0])).toBe('full');
        expect(at({ maparea: 56, mapcell: 43 })).toBeNull();
    });

    it('出擊艦隊不可考時，帶編成條件的子目標不計入', () => {
        expect(judgeBattleGoals(DEF_1047, [0, 0, 0], { maparea: 54, mapcell: 20, boss: true, rank: 'S', fleet: null }))
            .toEqual({ counted: [], reason: 'fleetUnknown' });
    });

    it('艦娘 id 表示此改造階段以後：涼波改二補 745 也符合旗艦 1034；未改二的涼波不符合', () => {
        expect(fleetReason(DEF_1047.subgoals[0], fleetOf([745, 69, 674]))).toBeNull();
        expect(fleetReason(DEF_1047.subgoals[0], fleetOf([675, 69, 674]))).toBe('flagship');
    });
});

describe('條件表：比對語意', () => {
    const sub = (fields: object) => ({ key: 'battle', event: 'battle', required: 1, init: 0, ...fields });

    it('僚艦條目預設把旗艦算進數量，第三項為 true 時排除旗艦', () => {
        const withFlag = sub({ escortshipIdAll: [[[1034, 69], 2]] });
        const exclFlag = sub({ escortshipIdAll: [[[1034, 69], 2, true]] });
        expect(fleetReason(withFlag, fleetOf([1034, 69]))).toBeNull();
        expect(fleetReason(exclFlag, fleetOf([1034, 69]))).toBe('escort');
    });

    it('escortshipId 任一條目成立即可，escortshipIdAll 需全部成立', () => {
        const any = sub({ escortshipId: [[[69], 1], [[674], 1]] });
        const all = sub({ escortshipIdAll: [[[69], 1], [[674], 1]] });
        expect(fleetReason(any, fleetOf([1, 69]))).toBeNull();
        expect(fleetReason(all, fleetOf([1, 69]))).toBe('escort');
    });

    it('艦數上限與禁止艦種', () => {
        expect(fleetReason(sub({ fleetlimit: 4 }), fleetOf([1, 1, 1, 1, 1]))).toBe('fleetSize');
        expect(fleetReason(sub({ banshiptype: [2] }), fleetOf([1]))).toBe('banned');
    });

    it('認不得的欄位或事件：整個任務不支援（不默默放寬條件）', () => {
        expect(questGoalDef(605)?.supported).toBe(false);   // 開發（工廠事件尚未支援）
        expect(questGoalDef(226)?.supported).toBe(true);
        expect(questGoalDef(307)?.supported).toBe(true);    // 演習勝利
        expect(questGoalDef(410)?.supported).toBe(true);    // 指定遠征
    });

    it('遠征名稱在產生資料時已換成封包驗證過的遠征 id（410：東京急行 37／38）', () => {
        expect(questGoalDef(410)?.subgoals[0]).toMatchObject({ event: 'mission_success', missionId: [37, 38], required: 1 });
    });

    it('遠征：不限遠征的子目標任何成功都算；限定者只算指定遠征，其餘不記錄', () => {
        expect(judgeMissionGoals(questGoalDef(402)!, [0], 5)).toEqual({ counted: [0], reason: null });
        expect(judgeMissionGoals(questGoalDef(410)!, [0], 37)).toEqual({ counted: [0], reason: null });
        expect(judgeMissionGoals(questGoalDef(410)!, [0], 5)).toBeNull();
    });

    it('演習：依評價門檻；艦隊不可考時，帶編成條件的子目標判為 fleetUnknown', () => {
        expect(judgePracticeGoals(questGoalDef(307)!, [0], 'B', null)).toEqual({ counted: [0], reason: null });
        expect(judgePracticeGoals(questGoalDef(307)!, [0], 'C', null)?.reason).toBe('rank');
        const def342 = questGoalDef(342)!;   // A 以上、驅逐／海防等 4 艘以上
        expect(judgePracticeGoals(def342, [0], 'A', null)?.reason).toBe('fleetUnknown');
        expect(judgePracticeGoals(def342, [0], 'A', fleetOf([1, 1, 1, 1], 2))).toEqual({ counted: [0], reason: null });
        expect(judgePracticeGoals(def342, [0], 'B', fleetOf([1, 1, 1, 1], 2))?.reason).toBe('rank');
    });

    it('擊沉只算指定艦種', () => {
        const def = questGoalDef(211)!;
        expect(def.supported).toBe(true);
        expect(sinkingGains(def, [7, 11, 2, 13])).toEqual(new Map([[0, 2]]));
    });

    it('抵達節點以 edge 比對', () => {
        const def = { no: 1, supported: true, subgoals: [{ key: 'reach_mapcell', event: 'reach_mapcell', required: 1, init: 0, maparea: [16], mapcell: [14] }] };
        expect(judgeReachGoals(def, [0], 16, 14, FLEET_OK)).toEqual({ counted: [0], reason: null });
        expect(judgeReachGoals(def, [0], 16, 13, FLEET_OK)).toBeNull();
    });

    it('未支援事件的單純計數沿用舊動作計數；帶篩選或每日歸零的不沿用', () => {
        expect(simpleGoalFromDef({ no: 1, supported: false, subgoals: [{ key: 'practice', event: 'practice', required: 3, init: 0 }] }))
            .toEqual({ kind: 'practiceAttempt', target: 3 });
        expect(simpleGoalFromDef(questGoalDef(605)!)).toEqual({ kind: 'development', target: 1 });
        expect(simpleGoalFromDef(questGoalDef(307)!)).toBeNull();
    });

    it('海域清單縮寫、遊戲日以 05:00 JST 換日', () => {
        expect(mapListLabel([21, 22, 23, 24, 25])).toBe('2-1〜2-5');
        expect(mapListLabel([54, 55, 72])).toBe('5-4/5-5/7-2');
        const jst = (h: number) => Date.UTC(2026, 8, 28, h - 9);
        expect(questDay(jst(4))).not.toBe(questDay(jst(6)));
        expect(questDay(jst(6))).toBe(questDay(jst(23)));
    });
});

describe('伺服器回報與本機計數', () => {
    it('flag 1／2 換算成 50%／80% 下限，達成時上下限都是目標', () => {
        expect(serverBounds(1, false, 6)).toEqual({ lo: 3, hi: 5 });
        expect(serverBounds(2, false, 10)).toEqual({ lo: 8, hi: 9 });
        expect(serverBounds(null, true, 6)).toEqual({ lo: 6, hi: 6 });
        expect(serverBounds(0, false, 10)).toEqual({ lo: 0, hi: 4 });
    });

    it('本機少於下限為 under；本機已滿但伺服器未達成為 over', () => {
        expect(compareWithServer(3, 6, 1, false, false)).toBe('consistent');
        expect(compareWithServer(1, 6, 1, false, false)).toBe('under');
        expect(compareWithServer(6, 6, 2, false, false)).toBe('over');
    });

    it('多目標任務不以 flag 上限判 over，單一目標才判', () => {
        expect(compareWithServer(4, 6, 0, false, false)).toBe('consistent');
        expect(compareWithServer(8, 10, 0, false, true)).toBe('over');
    });

    it('本機少算時顯示推算範圍', () => {
        const latest: ServerObservation = { ts: 1, flag: 1, done: false, local: 1, target: 6, status: 'under' };
        expect(progressRange(1, 6, latest)).toEqual({ lo: 3, hi: 5 });
    });

    it('可信度：與非零進度一致過才是 verified；最近一次 over 退回 unchecked', () => {
        const zero: ServerObservation = { ts: 1, flag: 0, done: false, local: 0, target: 6, status: 'consistent' };
        const half: ServerObservation = { ts: 2, flag: 1, done: false, local: 3, target: 6, status: 'consistent' };
        const over: ServerObservation = { ts: 3, flag: 1, done: false, local: 6, target: 6, status: 'over' };
        expect(questTier(true, false, [zero])).toBe('unchecked');
        expect(questTier(true, false, [zero, half])).toBe('verified');
        expect(questTier(true, false, [zero, half, over])).toBe('unchecked');
        expect(questTier(false, true, [])).toBe('text');
        expect(questTier(false, false, [])).toBe('server');
    });
});

describe('文字級：只從官方說明文字抽必要條件', () => {
    const mapNames = new Map([
        ['5-1', '南方海域前面'], ['5-4', 'サーモン海域'], ['5-5', 'サーモン海域北方'], ['5-6', 'ラバウル方面海域'],
        ['7-1', 'ブルネイ泊地沖'], ['7-2', 'タウイタウイ泊地沖'], ['2-1', '南西諸島近海'], ['1-1', '鎮守府正面海域'],
    ]);
    const ships = new Map([['涼波改二', [1034]]]);
    const facts = (over: Partial<BattleFacts>): BattleFacts =>
        ({ ts: 1, map: '5-5', nodeLetter: 'P', boss: true, rank: 'S', fleet: [1034, 69], ...over });

    it('長海域名優先，不把「サーモン海域北方」拆成「サーモン海域」', () => {
        const rule = extractTextRule('「涼波改二」旗艦で、サーモン海域北方最深部に出撃せよ！S勝利を達成せよ！', mapNames, ships);
        expect(rule).toEqual({ flagship: [1034], maps: ['5-5'], bossOnly: true, minRank: 'S' });
    });

    it('修正片假名後誤植的「一」（1047 原文的「サ一モン」）', () => {
        const rule = extractTextRule('「涼波改二/補」旗艦、サ一モン海域、サ一モン海域北方に反復出撃!', mapNames, ships);
        expect(rule?.maps).toEqual(['5-4', '5-5']);
        expect(rule?.flagship).toEqual([1034]);
    });

    it('大區名稱展開成該區所有海域；南西海域是 7-X，不是南西諸島海域的 2-X', () => {
        expect(extractTextRule('艦隊を南西海域に出撃させよ！', mapNames, ships)?.maps).toEqual(['7-1', '7-2']);
        expect(extractTextRule('艦隊を南西諸島海域に出撃させよ！', mapNames, ships)?.maps).toEqual(['2-1']);
        // 單一海域名稱「南方海域前面」先比對掉，不會再被大區「南方海域」展開。
        expect(extractTextRule('南方海域前面に出撃せよ！', mapNames, ships)?.maps).toEqual(['5-1']);
    });

    it('沒有可比對的海域名稱時不建立規則', () => {
        expect(extractTextRule('艦隊を出撃させよ！', mapNames, ships)).toBeNull();
    });

    it('符合全部抽出條件者為候選，不直接計入', () => {
        const rule = { flagship: [1034], maps: ['5-5'], bossOnly: true, minRank: 'S' as const };
        expect(judgeTextBattle(rule, facts({}))).toMatchObject({ candidate: true, counted: false });
        expect(judgeTextBattle(rule, facts({ rank: 'A' }))?.reason).toBe('rank');
        expect(judgeTextBattle(rule, facts({ map: '1-1' }))).toBeNull();
    });
});

describe('formatQuestTime', () => {
    it('時間一律帶年月日', () => {
        expect(formatQuestTime(new Date(2026, 8, 28, 21, 32).getTime())).toBe('2026-09-28 21:32');
    });
});

// ── GameState 串接 ─────────────────────────────────────────────────────

// [id, 名稱, 改造後 id]：涼波 675 → 710 → 1034 → 745（與 samples/start2-master.json 相同）。
const SHIPS: [number, string, number][] = [
    [675, '涼波', 710], [710, '涼波改', 1034], [1034, '涼波改二', 745], [745, '涼波改二補', 0],
    [69, '鳥海', 0], [674, '玉波', 0], [1, '睦月', 0],
];

function stateWithFleet(fleet = [1034, 69, 674, 1, 1, 1]): GameState {
    const s = new GameState();
    s.applyEvent('api_start2/getData', {
        api_mst_ship: [
            ...SHIPS.map(([id, name, after]) => ({
                api_id: id, api_name: name, api_sortno: id, api_aftershipid: String(after), api_stype: 2,
                api_taik: [30, 39], api_fuel_max: 15, api_bull_max: 15,
            })),
            { api_id: 1510, api_name: '軽母ヌ級', api_stype: 7, api_taik: [30, 30] },
        ],
        api_mst_stype: [{ api_id: 2, api_name: '駆逐艦', api_equip_type: {} }],
        api_mst_slotitem: [],
        api_mst_mapinfo: [
            { api_id: 54, api_maparea_id: 5, api_no: 4, api_name: 'サーモン海域' },
            { api_id: 55, api_maparea_id: 5, api_no: 5, api_name: 'サーモン海域北方' },
        ],
    }, undefined, 1_000);
    s.applyEvent('api_port/port', {
        api_ship: fleet.map((mst, i) => ({
            api_id: 101 + i, api_ship_id: mst, api_lv: 90, api_nowhp: 30, api_maxhp: 30,
            api_cond: 49, api_slot: [-1, -1, -1, -1], api_slot_ex: 0, api_fuel: 15, api_bull: 15,
            api_onslot: [], api_soku: 10, api_ndock_time: 0, api_exp: [0, 0, 0],
        })),
        api_deck_port: [{ api_ship: fleet.map((_, i) => 101 + i), api_mission: [0, 0, 0, 0] }],
        api_material: [0, 0, 0, 0, 0, 0, 0, 0], api_ndock: [], api_basic: {},
    }, undefined, 2_000);
    return s;
}

function questlist(s: GameState, list: object[], ts: number) {
    s.applyEvent('api_get_member/questlist', { api_list: list }, { api_tab_id: '0' }, ts);
}

function bossBattle(s: GameState, area: number, no: number, rank: string, ts: number, edge = 2) {
    s.applyEvent('api_req_map/start', { api_maparea_id: area, api_mapinfo_no: no, api_no: 1, api_color_no: 1 }, { api_deck_id: '1' }, ts);
    s.applyEvent('api_req_map/next', { api_no: edge, api_color_no: 5, api_event_id: 5 }, undefined, ts + 1);
    s.applyEvent('api_req_sortie/battleresult', { api_win_rank: rank }, {}, ts + 2);
}

const Q1047 = { api_no: 1047, api_state: 2, api_title: '「涼波改二」ラバウルより抜錨せよ！', api_detail: '…', api_progress_flag: 0 };

describe('GameState：任務判定與伺服器對照', () => {
    it('條件表任務逐場記錄判定，計數只算符合的戰鬥', () => {
        const s = stateWithFleet();
        questlist(s, [Q1047], 3_000);
        bossBattle(s, 5, 4, 'S', 10_000);
        bossBattle(s, 5, 4, 'A', 20_000);
        const quest = s.quests_().find(q => q.no === 1047)!;
        expect(quest.progress).toEqual({ count: 1, target: 6 });
        expect(quest.tracking?.tier).toBe('unchecked');
        expect(quest.tracking?.targets?.[0]).toMatchObject({ event: 'battle_boss_win_rank_s', maparea: [54], count: 1, need: 2 });
        expect(quest.tracking?.targets?.[2]).toMatchObject({ maparea: [56], nodeLetters: ['Z'] });
        expect(quest.tracking?.lastJudgement).toMatchObject({ counted: false, reason: 'rank', ts: 20_002 });
        const detail = s.questTrackingDetail(1047)!;
        expect(detail.judgements.map(item => item.counted)).toEqual([true, false]);
        expect(detail.fleetCheck).toEqual([
            { kind: 'flagshipId', ids: [1034], ok: true, hits: [1034] },
            { kind: 'escortshipIdAll', ids: [69, 124, 70, 138, 674, 485, 528], min: 2, ignoreFlagship: false, ok: true, hits: [69, 674] },
        ]);
        expect(detail.shipNames[1034]).toBeTruthy();
        // panel 的任務檢視也帶編成條件，供進度分頁的條件標籤使用。
        expect(quest.tracking?.fleetCheck.map(check => [check.kind, check.ok])).toEqual([['flagshipId', true], ['escortshipIdAll', true]]);
        expect(quest.tracking?.conditionNames.ships[69]).toBeTruthy();
    });

    it('條件短標籤：艦種全部列出，兩條相似的艦種條件看得出差別', () => {
        setLang('zh-TW');
        const check = (ids: number[], min: number, hits: number[]) =>
            ({ kind: 'escortshiptype' as const, ids, min, ok: hits.length >= min, hits });
        expect(questConditionShort(check([1, 2, 3, 4, 21], 4, [1, 2, 3, 4]))).toBe('海防/驅逐/輕巡/雷巡/練巡 4/4');
        expect(questConditionShort(check([1, 2], 3, [1]))).toBe('海防/驅逐 1/3');
        expect(questConditionShort({ kind: 'flagshipId', ids: [1034], ok: true, hits: [1034] })).toBe('旗艦');
    });

    it('涼波改二補（745）當旗艦也計入：改造前身經 api_aftershipid 反推', () => {
        const s = stateWithFleet([745, 69, 674]);
        questlist(s, [Q1047], 3_000);
        bossBattle(s, 5, 4, 'S', 10_000);
        expect(s.quests_().find(q => q.no === 1047)?.progress).toEqual({ count: 1, target: 6 });
    });

    it('伺服器回報與本機一致且非零時升為 verified；重複的 questlist 不重複記錄', () => {
        const s = stateWithFleet();
        questlist(s, [Q1047], 3_000);
        for (const [ts, no] of [[10_000, 4], [20_000, 4], [30_000, 5]]) bossBattle(s, 5, no, 'S', ts);
        questlist(s, [{ ...Q1047, api_progress_flag: 1 }], 40_000);
        questlist(s, [{ ...Q1047, api_progress_flag: 1 }], 41_000);
        const detail = s.questTrackingDetail(1047)!;
        expect(detail.count).toBe(3);
        expect(detail.server.map(obs => obs.status)).toEqual(['consistent', 'consistent']);
        expect(detail.tier).toBe('verified');
    });

    it('本機已滿而伺服器未達成時需重核', () => {
        const s = stateWithFleet();
        questlist(s, [Q1047], 3_000);
        let ts = 10_000;
        for (const [no, edge] of [[4, 2], [4, 2], [5, 2], [5, 2], [6, 43], [6, 43]]) { bossBattle(s, 5, no, 'S', ts, edge); ts += 10_000; }
        expect(s.quests_().find(q => q.no === 1047)?.progress).toEqual({ count: 6, target: 6 });
        questlist(s, [{ ...Q1047, api_progress_flag: 2 }], ts);
        const quest = s.quests_().find(q => q.no === 1047)!;
        expect(quest.tracking?.recheck).toBe(true);
        expect(quest.tracking?.tier).toBe('unchecked');
    });

    it('擊沉任務：結算後 HP 為 0 的敵輕空母計入 211', () => {
        const s = stateWithFleet();
        questlist(s, [{ api_no: 211, api_state: 2, api_title: '敵空母を3隻撃沈せよ！', api_detail: '…', api_progress_flag: 0 }], 3_000);
        s.applyEvent('api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 1, api_no: 1, api_color_no: 4 }, { api_deck_id: '1' }, 10_000);
        s.applyEvent('api_req_sortie/battle', {
            api_deck_id: 1, api_formation: [1, 1, 1],
            api_f_nowhps: [30, 30, 30, 30, 30, 30], api_f_maxhps: [30, 30, 30, 30, 30, 30],
            api_e_nowhps: [0], api_e_maxhps: [30], api_ship_ke: [1510], api_ship_lv: [1],
        }, {}, 10_001);
        s.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' }, {}, 10_002);
        expect(s.quests_().find(q => q.no === 211)?.progress).toEqual({ count: 1, target: 3 });
    });

    it('戰鬥封包的艦隊與出擊時不同：帶編成條件的子目標判為艦隊不可考，不帶的照常計入', () => {
        const s = stateWithFleet();
        s.decks.push({ api_ship: [104, 105, 106], api_mission: [0, 0, 0, 0] });
        questlist(s, [Q1047, { api_no: 211, api_state: 2, api_title: '敵空母を3隻撃沈せよ！', api_detail: '…', api_progress_flag: 0 }], 3_000);
        s.applyEvent('api_req_map/start', { api_maparea_id: 5, api_mapinfo_no: 4, api_no: 1, api_color_no: 1 }, { api_deck_id: '1' }, 10_000);
        s.applyEvent('api_req_map/next', { api_no: 2, api_color_no: 5, api_event_id: 5 }, undefined, 10_001);
        s.applyEvent('api_req_sortie/battle', {
            api_deck_id: 2, api_formation: [1, 1, 1],
            api_f_nowhps: [30, 30, 30], api_f_maxhps: [30, 30, 30],
            api_e_nowhps: [0], api_e_maxhps: [30], api_ship_ke: [1510], api_ship_lv: [1],
        }, {}, 10_002);
        s.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' }, {}, 10_003);
        expect(s.quests_().find(q => q.no === 1047)?.progress).toEqual({ count: 0, target: 6 });
        expect(s.questTrackingDetail(1047)?.judgements.at(-1)).toMatchObject({ counted: false, reason: 'fleetUnknown', flagship: null });
        expect(s.quests_().find(q => q.no === 211)?.progress).toEqual({ count: 1, target: 3 });
        // 下一次出擊重新記下編成，不沿用上一趟的不可考標記。
        bossBattle(s, 5, 4, 'S', 20_000);
        expect(s.quests_().find(q => q.no === 1047)?.progress).toEqual({ count: 1, target: 6 });
    });

    it('領獎或放棄後清掉判定紀錄', () => {
        const s = stateWithFleet();
        questlist(s, [Q1047], 3_000);
        bossBattle(s, 5, 4, 'S', 10_000);
        s.applyEvent('api_req_quest/stop', {}, { api_quest_id: '1047' }, 20_000);
        expect(s.questTrackingDetail(1047)).toBeNull();
        expect(s.questTracking.has(1047)).toBe(false);
    });

    it('條件表收錄但事件未支援、又帶篩選的任務：不用文字推算次數，只顯示伺服器回報', () => {
        const s = stateWithFleet();
        questlist(s, [{ api_no: 638, api_state: 2, api_title: '対空機銃量産', api_detail: '機銃を10個廃棄せよ！', api_progress_flag: 1 }], 3_000);
        const quest = s.quests_().find(q => q.no === 638)!;
        expect(quest.progress).toBeNull();
        expect(quest.tracking).toMatchObject({ tier: 'server', latestServer: { flag: 1 } });
    });

    const PRACTICE_RESULT = JSON.parse(readFileSync(new URL('../samples/practice-battle-result.json', import.meta.url), 'utf8')).api_data;
    function practice(s: GameState, ts: number, rank = PRACTICE_RESULT.api_win_rank, deckId: number | null = 1) {
        s.applyEvent('api_req_practice/battle', {
            ...(deckId === null ? {} : { api_deck_id: deckId }), api_formation: [1, 1, 1],
            api_f_nowhps: [30, 30, 30, 30, 30, 30], api_f_maxhps: [30, 30, 30, 30, 30, 30],
            api_e_nowhps: [30], api_e_maxhps: [30], api_ship_ke: [576], api_ship_lv: [99],
        }, {}, ts);
        s.applyEvent('api_req_practice/battle_result', { ...PRACTICE_RESULT, api_win_rank: rank }, {}, ts + 1);
    }

    it('演習結算樣本：有評價、有對手資訊、沒有任何海域欄位', () => {
        expect(PRACTICE_RESULT.api_win_rank).toBe('A');
        expect(PRACTICE_RESULT.api_enemy_info).toMatchObject({ api_level: 120 });
        expect(Object.keys(PRACTICE_RESULT).some(key => /map|cell/.test(key))).toBe(false);
    });

    it('演習勝利任務以樣本結算計入；「本日中」的計數在 05:00 JST 換日後歸零', () => {
        const s = stateWithFleet();
        const day1 = Date.UTC(2026, 8, 28, 3);   // 12:00 JST
        questlist(s, [{ api_no: 307, api_state: 2, api_title: '艦隊の練度向上に努めよ！', api_detail: '…', api_progress_flag: 0 }], day1);
        practice(s, day1 + 1_000);
        practice(s, day1 + 2_000, 'C');
        expect(s.quests_().find(q => q.no === 307)?.progress).toEqual({ count: 1, target: 3 });
        expect(s.questTrackingDetail(307)?.lastJudgement).toMatchObject({ practice: true, counted: false, reason: 'rank' });
        practice(s, day1 + 86_400_000, 'S');
        expect(s.quests_().find(q => q.no === 307)?.progress).toEqual({ count: 1, target: 3 });
    });

    it('編成限定演習：演習艦隊取自戰鬥封包的 api_deck_id；解不出艦隊時不計入', () => {
        const s = stateWithFleet();
        questlist(s, [{ api_no: 342, api_state: 2, api_title: '小艦艇群演習強化任務', api_detail: '…', api_progress_flag: 0 }], 3_000);
        practice(s, 10_000, 'A');           // 第一艦隊：涼波改二、鳥海（重巡）、玉波、睦月×3 → 驅逐 5 艘
        practice(s, 20_000, 'A', null);     // 沒有 api_deck_id
        const detail = s.questTrackingDetail(342)!;
        expect(detail.count).toBe(1);
        expect(detail.judgements.map(item => item.reason)).toEqual([null, 'fleetUnknown']);
    });

    it('遠征成功：402 任何遠征都算，410 只算東京急行', () => {
        const s = stateWithFleet();
        questlist(s, [
            { api_no: 402, api_state: 2, api_title: '「遠征」を3回成功させよう！', api_detail: '…', api_progress_flag: 0 },
            { api_no: 410, api_state: 2, api_title: '南方への輸送作戦を成功させよ！', api_detail: '…', api_progress_flag: 0 },
        ], 3_000);
        const expedition = (missionId: number, ts: number) => {
            s.applyEvent('api_req_mission/start', { api_complatetime: 0 }, { api_deck_id: '1', api_mission_id: String(missionId) }, ts);
            s.applyEvent('api_req_mission/result', { api_clear_result: 1 }, { api_deck_id: '1' }, ts + 1);
        };
        expedition(5, 10_000);
        expedition(37, 20_000);
        expect(s.quests_().find(q => q.no === 402)?.progress).toEqual({ count: 2, target: 3 });
        expect(s.quests_().find(q => q.no === 410)?.progress).toEqual({ count: 1, target: 1 });
        expect(s.questTrackingDetail(410)?.judgements.map(item => item.mission)).toEqual([37]);
    });

    it('條件表沒有的出擊任務走文字級：符合抽出條件的戰鬥記為候選', () => {
        const s = stateWithFleet();
        questlist(s, [{
            api_no: 9001, api_state: 2, api_title: '示意', api_progress_flag: 0,
            api_detail: '「涼波改二」旗艦の艦隊でサーモン海域北方最深部へ出撃、S勝利を達成せよ！',
        }], 3_000);
        bossBattle(s, 5, 5, 'S', 10_000);
        const quest = s.quests_().find(q => q.no === 9001)!;
        expect(quest.progress).toBeNull();
        expect(quest.tracking).toMatchObject({ tier: 'text', candidates: 1 });
    });
});
