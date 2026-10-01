// 本機條件與來源條件表的比對（純函式，無 chrome.*）。tools/quest-goal/compare.ts 用它產生報告。
//
// 子目標的 key 標籤兩邊寫法可能不同（例：「@56Z」與「@56」），故不比 key：依事件、海域、節點排序後
// 逐欄比較。欄位值一律排序後比較，順序不同不算差異。
import type { GoalSubgoal, QuestGoalDef } from './quest-goals';

const COMPARED_FIELDS: (keyof GoalSubgoal)[] = [
    'event', 'maparea', 'mapcell', 'required', 'init', 'shipType', 'missionId',
    'flagshipId', 'secondshipId', 'escortshipId', 'escortshipIdAll',
    'flagshiptype', 'escortshiptype', 'flagshipclass', 'secondshipclass', 'escortshipclass',
    'fleetlimit', 'banshiptype',
];

/** 欄位正規化：數字陣列排序；條目陣列 [ids, 數量, 排除旗艦?] 的 ids 排序、條目本身再排序。 */
function normalize(value: unknown): unknown {
    if (!Array.isArray(value)) return value ?? null;
    if (value.every(item => typeof item === 'number')) return [...value].sort((a, b) => a - b);
    return value
        .map(entry => Array.isArray(entry) && Array.isArray(entry[0])
            ? [[...entry[0]].sort((a: number, b: number) => a - b), entry[1], entry[2] === true]
            : normalize(entry))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function sortKey(sub: GoalSubgoal): string {
    return JSON.stringify([sub.event, normalize(sub.maparea), normalize(sub.mapcell), normalize(sub.missionId), normalize(sub.shipType)]);
}

export interface GoalFieldDiff { subgoal: number; field: string; local: unknown; source: unknown }
export interface GoalCompareResult {
    status: 'same' | 'different' | 'sourceMissing';
    /** 子目標數不同時為 true；此時逐欄差異只比到較短的一邊。 */
    countMismatch: boolean;
    diffs: GoalFieldDiff[];
    resetInterval?: { local: number | null; source: number | null };
}

export function compareGoalDefs(local: QuestGoalDef, source: QuestGoalDef | null): GoalCompareResult {
    if (!source) return { status: 'sourceMissing', countMismatch: false, diffs: [] };
    const a = [...local.subgoals].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    const b = [...source.subgoals].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    const diffs: GoalFieldDiff[] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        for (const field of COMPARED_FIELDS) {
            const left = normalize(a[i][field]), right = normalize(b[i][field]);
            if (JSON.stringify(left) !== JSON.stringify(right)) diffs.push({ subgoal: i, field, local: left, source: right });
        }
    }
    const reset = (local.resetInterval ?? null) !== (source.resetInterval ?? null)
        ? { local: local.resetInterval ?? null, source: source.resetInterval ?? null } : undefined;
    const countMismatch = a.length !== b.length;
    return {
        status: diffs.length || countMismatch || reset ? 'different' : 'same',
        countMismatch, diffs, ...(reset ? { resetInterval: reset } : {}),
    };
}
