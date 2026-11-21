// 遠征開放檢查：依最近一次遠征清單與本期成功紀錄判斷狀態（純函式）。
//
// 首次開放條件：wikiwiki.jp/kancolle/遠征「各遠征の開放要件」（2026-11-18 讀原始 HTML；該表注明參照英 wiki，
// 2023-05-16 閱覽）。遊戲不送這份資料，所以只寫成「需先完成 X」的提示，不據以改變能不能派的判斷——能不能派
// 以遠征清單為準（見 docs/engineering/expeditions.md「遠征清單」）。
// 同頁留言有兩筆尚未寫回表格的回報：B2 可能另需 B1、東京急行(37) 可能不需 1-5；表格未改前照表。
//
// 月常每期的前置：同表標「(毎月)」者。與 KC3Kai src/library/helpers/KanColleHelpers.js 的 monthlyUnlockTable
// 九條逐一相符，也與 samples/mission-list.json（缺 43、44、A5、A6、B3–B6、D3）及 mission-list-a4-done.json
// （A4 本期完成後 44 出現）一致。
import type { ExpeditionRow } from './db';
import { monthlyExpeditionCycle } from './expedition-plan';

export interface FirstUnlock {
    /** 需先達成的遠征 id */
    missions?: readonly number[];
    /** 需先攻略的海域 */
    maps?: readonly string[];
    /** 需先完成任務 A4「6隻編成の艦隊を編成せよ！」（第二艦隊開放） */
    quest?: true;
}

export const FIRST_UNLOCK: Readonly<Record<number, FirstUnlock>> = {
    1: { quest: true }, 2: { missions: [1] }, 3: { missions: [1] }, 4: { missions: [2, 3] }, 5: { missions: [2, 3] },
    6: { missions: [4] }, 7: { missions: [6] }, 8: { missions: [7] },
    100: { missions: [5] }, 101: { missions: [8, 100] }, 102: { missions: [101, 24] }, 103: { missions: [102] },
    104: { missions: [103, 112] }, 105: { missions: [104, 113] },
    9: { missions: [1] }, 10: { missions: [9] }, 11: { missions: [10] }, 12: { missions: [10] }, 13: { missions: [10] },
    14: { missions: [11, 12, 13] }, 15: { missions: [14] }, 16: { missions: [15] },
    110: { missions: [10] }, 111: { missions: [102] }, 112: { missions: [111] }, 113: { missions: [112] },
    114: { missions: [113] }, 115: { missions: [103, 113] },
    17: { missions: [1] }, 18: { missions: [16, 17] }, 19: { missions: [18] }, 20: { missions: [19] }, 21: { missions: [17] },
    22: { missions: [18] }, 23: { missions: [22], maps: ['1-5'] }, 24: { missions: [18] },
    41: { missions: [110], maps: ['2-4'] }, 42: { missions: [41] }, 43: { missions: [42] }, 44: { missions: [40, 41] },
    45: { missions: [32, 41] }, 46: { missions: [131] },
    25: { missions: [18] }, 26: { missions: [25] }, 27: { missions: [20] }, 28: { missions: [27] }, 29: { missions: [28] },
    30: { missions: [29], maps: ['1-5'] }, 31: { missions: [29], maps: ['1-5'] }, 32: { missions: [8] },
    131: { missions: [32] }, 132: { missions: [131] }, 133: { missions: [132] },
    33: { missions: [18] }, 34: { missions: [26] }, 35: { missions: [26] }, 36: { missions: [35] },
    37: { missions: [36], maps: ['1-5'] }, 38: { missions: [37] }, 39: { missions: [36], maps: ['1-5'] }, 40: { missions: [38] },
    141: { missions: [40] }, 142: { missions: [38] },
};

/** 月常每期換期後，要本期先完成這些遠征才會出現在清單；不在表裡的月常換期後直接出現。 */
export const MONTHLY_UNLOCK: Readonly<Record<number, readonly number[]>> = {
    43: [42], 44: [103], 104: [103, 112], 105: [104, 113], 112: [111], 113: [112], 114: [113], 115: [103, 113], 133: [132],
};

/**
 * 月常的解鎖路徑分組（依每期前置串起來；areas 只用來取組名）。第一組依最快順序 A4 → B2 → B3 → A5 → B4 → A6
 * （wikiwiki 同頁「(A4+B2+B3)→A5+(B4)→A6」），分支 B5、B6、44 接在後面。
 */
export const MONTHLY_PATHS: readonly { areas: readonly number[]; ids: readonly number[] }[] = [
    { areas: [1, 2], ids: [103, 111, 112, 104, 113, 105, 114, 115, 44] },
    { areas: [7], ids: [42, 43] },
    { areas: [4], ids: [132, 133] },
];

export interface UnlockMission { dispNo: string; maparea: number; resetType: number }

/**
 * 每條遠征的狀態：done＝已達成（月常為本期完成）、open＝可派、absent＝開過但本期還沒出現（月常前置未完成）、
 * locked＝首次開放條件還沒滿足。
 */
export type UnlockKind = 'done' | 'open' | 'absent' | 'locked';

export interface UnlockView {
    /** 清單是上一期的：月常狀態依換期規則推算（本期完成清空、有每期前置的月常不出現）。 */
    stale: boolean;
    kind(id: number): UnlockKind;
    /** 還缺的條件：遠征 id、海域、任務 A4；可派或已達成的回空。 */
    missing(id: number): { missions: number[]; maps: readonly string[]; quest: boolean };
}

export type ExpeditionResult = Pick<ExpeditionRow, 'missionId' | 'ts' | 'result'>;

/** 以本期成功紀錄補上清單尚未更新的月常完成狀態；清單從沒收到時回 null。 */
export function unlockView(
    missions: ReadonlyMap<number, UnlockMission>,
    list: { states: ReadonlyMap<number, number>; resetAt: number | null } | null,
    now: number,
    results: readonly ExpeditionResult[] = [],
): UnlockView | null {
    if (!list) return null;
    const stale = list.resetAt !== null && list.resetAt <= now;
    const states = new Map(list.states);
    if (stale) {
        // 換期：月常本期完成清空；有每期前置的月常要重跑前置才會再出現。一般遠征開了不會再鎖。
        for (const [id, m] of missions) {
            if (m.resetType !== 1 || !states.has(id)) continue;
            if (MONTHLY_UNLOCK[id]) states.delete(id);
            else states.set(id, 1);
        }
    }
    const cycle = monthlyExpeditionCycle(now, list.resetAt);
    for (const { missionId, ts, result } of results) {
        if (missions.get(missionId)?.resetType === 1 && result >= 1 && ts >= cycle.start && ts < cycle.end && ts <= now) {
            states.set(missionId, 2);
        }
    }
    const cleared = (id: number) => states.get(id) === 2;
    const isMonthly = (id: number) => missions.get(id)?.resetType === 1;
    // 有每期前置的月常不在清單時，前置一路追得回清單裡的月常（且首次條件的一般遠征已達成）就算「開過、本期未出現」；
    // 遊戲不分「從沒開過」與「本期還沒出現」，兩者要做的事相同，這裡只用來決定措辭。
    const reachable = (id: number): boolean => states.has(id) || (!!MONTHLY_UNLOCK[id]
        && MONTHLY_UNLOCK[id].every(reachable)
        && (FIRST_UNLOCK[id]?.missions ?? []).every(x => isMonthly(x) || cleared(x)));
    const kind = (id: number): UnlockKind => {
        const state = states.get(id);
        if (state === 2) return 'done';
        if (state !== undefined) return 'open';
        return reachable(id) ? 'absent' : 'locked';
    };
    return {
        stale,
        kind,
        missing(id) {
            const k = kind(id);
            if (k === 'done' || k === 'open') return { missions: [], maps: [], quest: false };
            const first = FIRST_UNLOCK[id] ?? {};
            // 有每期前置的月常：缺本期還沒完成的前置，加上首次條件裡還沒達成的一般遠征（44 的 40、41）
            if (MONTHLY_UNLOCK[id]) return {
                missions: [...MONTHLY_UNLOCK[id], ...(first.missions ?? []).filter(x => !isMonthly(x))].filter(x => !cleared(x)),
                maps: [], quest: false,
            };
            return { missions: (first.missions ?? []).filter(x => !cleared(x)), maps: first.maps ?? [], quest: !!first.quest };
        },
    };
}
