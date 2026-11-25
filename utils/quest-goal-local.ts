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
    // 2026 秋刀魚塩焼き演習（11/24 實裝，週任；重用往年 369；866 完成後開放），來源條件表尚未收錄。結束後刪除這筆。
    // 時雨改二（145）透過 shipCountsAs 自動涵蓋時雨改三（961）。
    369: {
        title: '【鎮守府秋刀魚祭り】秋刀魚塩焼き演習！',
        basis: ['任務說明原文（KC3Kai kc3-translations 041c065311，2026-11-25）', 'ぜかまし攻略（2026sannma-ensyuu，2026-11-24）', 'samples/start2-master.json（第七駆逐隊：朧 93、曙 15、漣 94、潮 16；夕立改二 144、時雨改二 145、秋月 421、初月 423、敷波 14、磯風 167、祥鳳 74、大泊 995、平安丸 944、Béarn 1055、Vautour 1053、Mogador 962）', '編成：名單中 4 艘以上；本日中 A 勝利以上 4 次'],
        written: '2026-11-25',
        goal: {
            resetInterval: 1,
            practice_win_a: {
                escortshipId: [[[93, 15, 94, 16, 144, 145, 421, 423, 14, 167, 74, 995, 944, 1055, 1053, 962], 4]],
                required: 4,
                init: 0,
            },
        },
    },
    // 2026 秋月型演習任務（11/11 實裝，週任；重用 2025 年的 381），來源條件表尚未收錄。結束後刪除這筆。
    381: {
        title: '【期間限定任務】秋月型演習任務2026',
        basis: ['任務說明原文（wikiwiki 任務頁留言 2026-11-11）', '開發者提供的任務條件與獎勵', 'samples/start2-master.json（秋月型 ctype 54：秋月 421、照月 422、初月 423、涼月 532、冬月 533、花月 1041；秋雲 132、秋霜 625、秋津洲 445）', '編成：名單中 3 艘以上；本日中 A 勝利以上 3 次'],
        written: '2026-11-11',
        goal: { resetInterval: 1, practice_win_a: { escortshipId: [[[421, 422, 423, 532, 533, 1041, 132, 625, 445], 3]], required: 3, init: 0 } },
    },
    // 2026 秋刀魚祭準備演習（11/11 實裝，週任；218 完成後開放，可能另有未確認條件），來源條件表尚未收錄。結束後刪除這筆。
    // 「旗艦を含む計4隻」寫成旗艦在名單內＋名單計 4 艘（含旗艦）。
    // 11/24 維護後對象艦更新（同一任務、進度延續）；原文已由 KC3Kai 041c065311 與ぜかまし攻略確認。
    386: {
        title: '【期間限定任務】秋刀魚祭り準備演習！',
        basis: ['任務說明原文（KC3Kai kc3-translations 041c065311，2026-11-25）', '11/24 更新後對象艦：wikiwiki 任務頁留言＋ぜかまし攻略（sanma-junbi-ensyuu-2026，2026-11-24）', 'samples/start2-master.json（しまね丸 1003、熊野丸 943、山汐丸 900、Béarn 1055、狭霧 480、天霧 479、村雨 44、夕立改二 144、敷波 14、大潮 96、曙 15）', '編成：名單中 1 艘任旗艦，名單計 4 艘以上；本日中 S 勝利 3 次'],
        written: '2026-11-25',
        goal: {
            resetInterval: 1,
            practice_win_s: {
                flagshipId: [1003, 943, 900, 1055, 480, 479, 44, 144, 14, 96, 15],
                escortshipId: [[[1003, 943, 900, 1055, 480, 479, 44, 144, 14, 96, 15], 4]],
                required: 3,
                init: 0,
            },
        },
    },
    // 修正來源條件：來源寫成「魚雷」系任意 3 件，任務原文指定「61cm三連装(酸素)魚雷」（會多算）。
    1103: {
        title: '潜水艦強化兵装の量産',
        basis: ['任務說明原文（KC3Kai kc3-translations 日文任務表 e72c4261）', 'wikiwiki「任務/工廠任務」Fy5 2026-11-03', 'samples/start2-master.json（61cm三連装(酸素)魚雷 125）'],
        written: '2026-11-03',
        goal: { type: 106, destory_item: { slotitemId: [125], required: 3, init: 0 } },
    },
};
