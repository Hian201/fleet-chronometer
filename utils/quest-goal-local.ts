// 本機撰寫的任務進度條件（純資料，無 chrome.*）。
//
// 用途：新活動任務在來源條件表更新前先自行撰寫，或修正來源條件。格式與 QUEST_GOAL_RAW
// 相同（見 utils/quest-goals.ts 的語意說明），判定時優先於來源條件表。
// 撰寫依據與來源條件表相同：遊戲送來的任務說明原文（擴充已存下的 questlist）、wikiwiki 任務頁
// （以 curl 讀原始 HTML 核對，不用摘要工具）、艦娘 id 以 samples/start2-master.json 的完整艦名查。
//
// title 是撰寫時對照的任務日文標題：遊戲即時標題與它不同時（營運重用編號）不套用這筆。
// 來源條件表收錄後，以 tools/quest-goal/compare.ts 比對；一致就刪掉本機這筆，有差異再查證。

export interface LocalQuestGoal {
    /** 撰寫時對照的任務日文標題（身分核對用）。 */
    title: string;
    /** 撰寫依據，例：「任務說明原文」「wikiwiki 任務頁 2026-10-14」。 */
    basis: readonly string[];
    /** 撰寫日期（YYYY-MM-DD）。 */
    written: string;
    /** 與 QUEST_GOAL_RAW 相同格式的條件。 */
    goal: Record<string, unknown>;
}

export const QUEST_GOAL_LOCAL: Readonly<Record<number, LocalQuestGoal>> = {
    // 驗證本機條件流程用的範例：與來源條件表相同，比對工具應回報一致。來源更新到一致後可刪除。
    1047: {
        title: '「涼波改二」ラバウルより抜錨せよ！',
        basis: ['任務說明原文', '任務目錄譯文（5-4／5-5／5-6-Z 各王點 S 勝利 2 次）', 'samples/start2-master.json（涼波改二 1034、鳥海 69、鈴谷 124、最上 70、能代 138、玉波 674、藤波 485、早波 528）'],
        written: '2026-09-30',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@54': { maparea: [54], flagshipId: [1034], escortshipIdAll: [[[69, 124, 70, 138, 674, 485, 528], 2]], required: 2, init: 0 },
            'battle_boss_win_rank_s@55': { maparea: [55], flagshipId: [1034], escortshipIdAll: [[[69, 124, 70, 138, 674, 485, 528], 2]], required: 2, init: 0 },
            'battle_boss_win_rank_s@56Z': { maparea: [56], mapcell: [43], flagshipId: [1034], escortshipIdAll: [[[69, 124, 70, 138, 674, 485, 528], 2]], required: 2, init: 0 },
        },
    },
    // 2026 南瓜任務（10/14 實裝），來源條件表尚未收錄。名單「旗艦含む N 隻」寫成旗艦在名單內＋名單計 N 艘（含旗艦）。
    // 2610F1／F2 是工廠類（未支援）；B218（1053）的「狭霧改二」不在 start2 樣本，艦娘 id 無從查證，不撰寫。
    984: {
        title: '【期間限定任務】14年目実りの秋、南瓜始め！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（鈴谷 124、村雨 44、夕立 45、曙 15、朧 93、朝潮 95、野分 415、迅鯨 634、長鯨 635）', '編成：名單中 1 艘任旗艦＋僚艦 2 艘（共 3 艘）'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@13': { maparea: [13], flagshipId: [124, 44, 45, 15, 93, 95, 415, 634, 635], escortshipId: [[[124, 44, 45, 15, 93, 95, 415, 634, 635], 3]], required: 2, init: 0 },
            'battle_boss_win_rank_s@14': { maparea: [14], flagshipId: [124, 44, 45, 15, 93, 95, 415, 634, 635], escortshipId: [[[124, 44, 45, 15, 93, 95, 415, 634, 635], 3]], required: 2, init: 0 },
            'battle_boss_win_rank_s@21': { maparea: [21], flagshipId: [124, 44, 45, 15, 93, 95, 415, 634, 635], escortshipId: [[[124, 44, 45, 15, 93, 95, 415, 634, 635], 3]], required: 2, init: 0 },
        },
    },
    985: {
        title: '【期間限定任務】特務護衛戦隊、抜錨せよ！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（対馬 540、鵜来 921、稲木 922、大泊 995、迅鯨 634、長鯨 635、朝日 953、村雨 44、巻波 671、早波 528、浜波 484、樫 993）', '編成：名單中 3 艘以上（不限旗艦）'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@12': { maparea: [12], escortshipId: [[[540, 921, 922, 995, 634, 635, 953, 44, 671, 528, 484, 993], 3]], required: 1, init: 0 },
            'battle_boss_win_rank_s@15': { maparea: [15], escortshipId: [[[540, 921, 922, 995, 634, 635, 953, 44, 671, 528, 484, 993], 3]], required: 1, init: 0 },
            'battle_boss_win_rank_s@22': { maparea: [22], escortshipId: [[[540, 921, 922, 995, 634, 635, 953, 44, 671, 528, 484, 993], 3]], required: 1, init: 0 },
            'battle_boss_win_rank_s@23': { maparea: [23], escortshipId: [[[540, 921, 922, 995, 634, 635, 953, 44, 671, 528, 484, 993], 3]], required: 1, init: 0 },
        },
    },
    986: {
        title: '【期間限定任務】USS Trick or Treat！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（Minneapolis 1005、Tuscaloosa 923、Gambier Bay 544、Brooklyn 896、Johnston 562、Richard P.Leary 942、Indiana 932）', '編成：名單中 3 艘以上（不限旗艦）'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@21': { maparea: [21], escortshipId: [[[1005, 923, 544, 896, 562, 942, 932], 3]], required: 2, init: 0 },
            'battle_boss_win_rank_s@25': { maparea: [25], escortshipId: [[[1005, 923, 544, 896, 562, 942, 932], 3]], required: 2, init: 0 },
            'battle_boss_win_rank_s@31': { maparea: [31], escortshipId: [[[1005, 923, 544, 896, 562, 942, 932], 3]], required: 2, init: 0 },
        },
    },
    987: {
        title: '【期間限定任務】西方南瓜祭り!  Buono!',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（Roma 442、Luigi Torelli 535、Maestrale 575、Grecale 614、Libeccio 443、Scirocco 653、Jervis 519、伊47 636、伊201 881、鈴谷 124、村雨 44、朧 93、曙 15）', '編成：名單中含旗艦 3 艘以上'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@42': { maparea: [42], flagshipId: [442, 535, 575, 614, 443, 653, 519, 636, 881, 124, 44, 93, 15], escortshipId: [[[442, 535, 575, 614, 443, 653, 519, 636, 881, 124, 44, 93, 15], 3]], required: 1, init: 0 },
            'battle_boss_win_rank_s@43': { maparea: [43], flagshipId: [442, 535, 575, 614, 443, 653, 519, 636, 881, 124, 44, 93, 15], escortshipId: [[[442, 535, 575, 614, 443, 653, 519, 636, 881, 124, 44, 93, 15], 3]], required: 1, init: 0 },
            'battle_boss_win_rank_s@44': { maparea: [44], flagshipId: [442, 535, 575, 614, 443, 653, 519, 636, 881, 124, 44, 93, 15], escortshipId: [[[442, 535, 575, 614, 443, 653, 519, 636, 881, 124, 44, 93, 15], 3]], required: 1, init: 0 },
        },
    },
    1002: {
        title: '【限定拡張作戦】南瓜祭り2026、北方作戦！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（Minneapolis 1005、Tuscaloosa 923、Gambier Bay 544、Johnston 562、鈴谷 124、阿武隈 114、曙 15、朧 93、清霜 410、樫 993）', '編成：名單中含旗艦 3 艘以上'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@32': { maparea: [32], flagshipId: [1005, 923, 544, 562, 124, 114, 15, 93, 410, 993], escortshipId: [[[1005, 923, 544, 562, 124, 114, 15, 93, 410, 993], 3]], required: 1, init: 0 },
            'battle_boss_win_rank_s@34': { maparea: [34], flagshipId: [1005, 923, 544, 562, 124, 114, 15, 93, 410, 993], escortshipId: [[[1005, 923, 544, 562, 124, 114, 15, 93, 410, 993], 3]], required: 1, init: 0 },
            'battle_boss_win_rank_s@35': { maparea: [35], flagshipId: [1005, 923, 544, 562, 124, 114, 15, 93, 410, 993], escortshipId: [[[1005, 923, 544, 562, 124, 114, 15, 93, 410, 993], 3]], required: 1, init: 0 },
        },
    },
    1038: {
        title: '【限定拡張作戦】Halloween、おかわり開始！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（鈴谷 124、曙 15、朧 93、樫 993、朝日 953、迅鯨 634、長鯨 635、瑞穂 451、Johnston 562、Richard P.Leary 942）', '編成：名單中含旗艦 4 艘以上'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@11': { maparea: [11], flagshipId: [124, 15, 93, 993, 953, 634, 635, 451, 562, 942], escortshipId: [[[124, 15, 93, 993, 953, 634, 635, 451, 562, 942], 4]], required: 4, init: 0 },
            'battle_boss_win_rank_s@13': { maparea: [13], flagshipId: [124, 15, 93, 993, 953, 634, 635, 451, 562, 942], escortshipId: [[[124, 15, 93, 993, 953, 634, 635, 451, 562, 942], 4]], required: 4, init: 0 },
        },
    },
    1039: {
        title: '【限定拡張作戦】Halloween海上護衛隊出撃！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（対馬 540、樫 993、朝潮 95、巻波 671、浜波 484、阿武隈 114、鵜来 921、稲木 922、能美 904、丁型海防艦（第四号 637、第二十二号 898、第三〇号 638））', '編成：名單中 4 艘以上（不限旗艦）；丁型海防艦依 wiki／KC3／ぜかまし列出的 3 艘'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@12': { maparea: [12], escortshipId: [[[540, 993, 95, 671, 484, 114, 921, 922, 904, 637, 898, 638], 4]], required: 1, init: 0 },
            'battle_boss_win_rank_s@14': { maparea: [14], escortshipId: [[[540, 993, 95, 671, 484, 114, 921, 922, 904, 637, 898, 638], 4]], required: 1, init: 0 },
            'battle_boss_win_rank_s@15': { maparea: [15], escortshipId: [[[540, 993, 95, 671, 484, 114, 921, 922, 904, 637, 898, 638], 4]], required: 1, init: 0 },
        },
    },
    1040: {
        title: '【限定拡張作戦】Halloween狼隊、夜の襲撃！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（朧 93、夕立 45、野分 415、早波 528、熊野丸 943、迅鯨改 639、Tuscaloosa 923、Indiana 932）', '編成：名單中 1 艘任旗艦＋僚艦 2 艘（共 3 艘）'],
        written: '2026-10-17',
        goal: {
            fuzzy: true,
            'battle_boss_win_rank_s@21': { maparea: [21], flagshipId: [93, 45, 415, 528, 943, 639, 923, 932], escortshipId: [[[93, 45, 415, 528, 943, 639, 923, 932], 3]], required: 2, init: 0 },
            'battle_boss_win_rank_s@22': { maparea: [22], flagshipId: [93, 45, 415, 528, 943, 639, 923, 932], escortshipId: [[[93, 45, 415, 528, 943, 639, 923, 932], 3]], required: 2, init: 0 },
        },
    },
    359: {
        title: 'Halloween艦隊 実りの秋、最新演習！',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 6fed2aac）', 'wikiwiki 任務頁「新着」10 月 14 日實裝分', 'ぜかまし 2026pumpkin 攻略', 'samples/start2-master.json（鈴谷 124、阿武隈 114、朧 93、曙 15、村雨 44、夕立 45、野分 415、朝潮 95、早波 528、浜波 484、伊201 881、Jervis 519、Minneapolis 1005、Johnston 562）', '編成：名單中 4 艘以上；本日中 A 勝利以上 5 次'],
        written: '2026-10-17',
        goal: { resetInterval: 1, practice_win_a: { escortshipId: [[[124, 114, 93, 15, 44, 45, 415, 95, 528, 484, 881, 519, 1005, 562], 4]], required: 5, init: 0 } },
    },
};
