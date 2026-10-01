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
};
