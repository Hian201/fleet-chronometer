// 本機條件（utils/quest-goal-local.ts）的套用順序與來源比對（utils/quest-goal-compare.ts）。
import { describe, expect, it } from 'vitest';
import { QUEST_GOAL_LOCAL } from '../utils/quest-goal-local';
import { localQuestGoalDef, parseGoalDef, questGoalDef, questGoalFor } from '../utils/quest-goals';
import { compareGoalDefs } from '../utils/quest-goal-compare';

describe('本機條件的套用順序', () => {
    it('本機條件的標題與即時標題相同時優先採用', () => {
        const title = QUEST_GOAL_LOCAL[1047].title;
        expect(questGoalFor(1047, title)).toBe(localQuestGoalDef(1047));
    });

    it('即時標題與本機條件不同（編號被重用）時不採用本機條件；也與目錄不同時不採用任何舊條件', () => {
        expect(questGoalFor(1047, '（新）別の任務')).toBeNull();
    });

    it('沒有本機條件時採用來源條件表；即時標題與目錄不同時不採用', () => {
        expect(questGoalFor(226, '南西諸島海域の制海権を握れ！')).toBe(questGoalDef(226));
        expect(questGoalFor(226, '（新）別の任務')).toBeNull();
    });

    it('本機條件每筆都能解析且為支援的格式，並記錄依據與日期', () => {
        for (const [no, local] of Object.entries(QUEST_GOAL_LOCAL)) {
            expect(localQuestGoalDef(Number(no))?.supported).toBe(true);
            expect(local.basis.length).toBeGreaterThan(0);
            expect(local.written).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });
});

describe('compareGoalDefs', () => {
    const base = {
        fuzzy: true,
        'battle_boss_win_rank_s@54': { maparea: [54], flagshipId: [1034], escortshipIdAll: [[[69, 124], 2]], required: 2, init: 0 },
        'battle_boss_win_rank_s@56Z': { maparea: [56], mapcell: [43], required: 2, init: 0 },
    };

    it('範例 1047 與固定版本的來源一致', () => {
        expect(compareGoalDefs(localQuestGoalDef(1047)!, questGoalDef(1047)).status).toBe('same');
    });

    it('子目標標籤與陣列順序不同不算差異', () => {
        const reordered = {
            fuzzy: true,
            'battle_boss_win_rank_s@56': { maparea: [56], mapcell: [43], required: 2, init: 0 },
            'battle_boss_win_rank_s@54': { maparea: [54], flagshipId: [1034], escortshipIdAll: [[[124, 69], 2]], required: 2, init: 0 },
        };
        expect(compareGoalDefs(parseGoalDef(1, base), parseGoalDef(1, reordered)).status).toBe('same');
    });

    it('列出次數、編成與節點的差異', () => {
        const changed = {
            fuzzy: true,
            'battle_boss_win_rank_s@54': { maparea: [54], flagshipId: [1034], escortshipIdAll: [[[69, 124, 70], 2]], required: 1, init: 0 },
            'battle_boss_win_rank_s@56': { maparea: [56], mapcell: [41], required: 2, init: 0 },
        };
        const result = compareGoalDefs(parseGoalDef(1, base), parseGoalDef(1, changed));
        expect(result.status).toBe('different');
        expect(result.diffs.map(diff => diff.field).sort()).toEqual(['escortshipIdAll', 'mapcell', 'required']);
    });

    it('來源未收錄與子目標數不同', () => {
        expect(compareGoalDefs(parseGoalDef(1, base), null).status).toBe('sourceMissing');
        const fewer = { fuzzy: true, 'battle_boss_win_rank_s@54': base['battle_boss_win_rank_s@54'] };
        expect(compareGoalDefs(parseGoalDef(1, base), parseGoalDef(1, fewer))).toMatchObject({ status: 'different', countMismatch: true });
    });
});
