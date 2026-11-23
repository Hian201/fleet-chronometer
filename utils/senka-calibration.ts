// 戰果榜單校準（推算繼承分／基線）與目標榜線差額純函式（無 chrome.*／DOM／ui-i18n 依賴）。
//
// 規則摘要：
// - 在當月任一榜單統計時刻 T（02:00 / 14:00 JST）以本人榜分減去從月起點到 T 的已觀測增量，
//   即可推算繼承戰果（carry）；缺月起點時以最新榜分作為基線（baseline），往後累加 T 以來的增量。
// - 提督經驗值換算為小數、遊戲榜分為無條件捨去的整數（C - 1 < floor(C + R) - R <= C），
//   並允許資料邊界誤差，故設定 ±1 容差（SENKA_CALIBRATION_TOLERANCE = 1）。
// - 新基線到來時，最新推算一律從最新榜分 + T_latest 後增量重起，已納入該次榜分的增量不重複計入。

import {
    EO_SENKA_MAPS,
    eoMonthWindow,
    eoSenkaForMonth,
    expToRegularSenka,
    prevSenkaMonth,
    questSenkaForMonth,
    regularSenkaForMonth,
    senkaMonthWindow,
    type EoSenkaResult,
    type EoSortieInput,
    type ExpReading,
    type QuestClaimInput,
    type QuestSenkaLookup,
    type QuestSenkaResult,
    type RegularSenkaResult,
    type SenkaMonth,
} from './senka';
import { rankingRoundAt, type RankingRoundInfo } from './senka-ranking';

/** 經驗值小數與整數榜分之間的校準容差（±1 戰果）。 */
export const SENKA_CALIBRATION_TOLERANCE = 1;

const EO_FIXED_MAP_SET = new Set<string>(EO_SENKA_MAPS.map(entry => entry.map));

/** 戰果數值的上下界區間（上下界相等代表精確值）。 */
export interface SenkaBounds {
    min: number;
    max: number;
}

/** 排行榜觀測到的本人戰果紀錄。 */
export interface SelfRankingObservation {
    publishedAt: number;
    score: number;
    rank?: number | null;
}

/** 排行榜觀測或手動登錄的特定名次榜線紀錄。 */
export interface CutoffObservation {
    publishedAt: number;
    rank: number;
    score: number;
    mode?: 'auto' | 'manual';
}

/** 玩家設定的比較目標（名次榜線或自訂分數）。 */
export type SenkaTarget =
    | { type: 'rank'; rank: number }
    | { type: 'custom'; score: number };

/** 標記戰果推算為近似／帶有不確定性的原因代碼。 */
export type SenkaCalibrationReason =
    | 'no-month-start'
    | 'month-boundary-range'
    | 'no-reading-before-tally'
    | 'choice-quest'
    | 'eo-timing-uncertain'
    | 'baseline-drift'
    | 'inconsistent-baseline'
    | 'special-senka-gap';

/** 計算單月戰果校準與推算所需的輸入資料。 */
export interface SenkaCalibrationInput {
    month: SenkaMonth;
    now: number;
    readings: readonly ExpReading[];
    sorties: readonly EoSortieInput[];
    questClaims: readonly QuestClaimInput[];
    questLookup: QuestSenkaLookup;
    selfRankings: readonly SelfRankingObservation[];
    hasSpecialSenkaGap?: boolean;
}

/** 單月戰果校準結果。 */
export type SenkaCalibrationResult =
    | {
        status: 'uncalibrated';
        month: SenkaMonth;
        regular: RegularSenkaResult;
        eo: EoSenkaResult;
        quest: QuestSenkaResult;
    }
    | {
        status: 'anomaly';
        month: SenkaMonth;
        regular: RegularSenkaResult;
        eo: EoSenkaResult;
        quest: QuestSenkaResult;
    }
    | {
        status: 'calibrated';
        month: SenkaMonth;
        kind: 'carry' | 'baseline';
        carry: SenkaBounds | null;
        calibratedAt: number | null;
        latestRound: RankingRoundInfo;
        publishedScore: number;
        publishedRank: number | null;
        sinceTally: SenkaBounds;
        estimate: SenkaBounds;
        regular: RegularSenkaResult;
        eo: EoSenkaResult;
        quest: QuestSenkaResult;
        estimated: boolean;
        reasons: SenkaCalibrationReason[];
        baselineDrift: number | null;
    };

/** 已對應至作戰月與榜次的榜線紀錄。 */
export interface ResolvedCutoff {
    publishedAt: number;
    tallyAt: number;
    rank: number;
    score: number;
    mode: 'auto' | 'manual';
    isFinalRound: boolean;
}

/** 計算目標差額所需的輸入資料。 */
export interface SenkaTargetInput {
    month: SenkaMonth;
    target: SenkaTarget;
    estimate: SenkaBounds | null;
    cutoffs: readonly CutoffObservation[];
    selfRankings?: readonly SelfRankingObservation[];
    now?: number;
}

/** 目標榜線／自訂分數比較結果。 */
export type SenkaTargetResult =
    | {
        type: 'rank';
        rank: number;
        cutoff: ResolvedCutoff | null;
        selfScoreAtCutoff: number | null;
        gapAtPublication: number | null;
        gapToTarget: SenkaBounds | null;
    }
    | {
        type: 'custom';
        targetScore: number | null;
        gapToTarget: SenkaBounds | null;
    };

interface ValidExpReading {
    ts: number;
    exp: number;
}

interface AnchorEvaluation {
    obs: SelfRankingObservation;
    round: RankingRoundInfo;
    rank: number | null;
    hasRegularGapAtT: boolean;
    eoTimingUncertain: boolean;
    rawCarry: SenkaBounds | null;
    carry: SenkaBounds | null;
    inconsistent: boolean;
    sinceTally: SenkaBounds;
    estimate: SenkaBounds;
}

const normZero = (n: number): number => (n === 0 ? 0 : n);
const exactBounds = (v: number): SenkaBounds => {
    const clean = normZero(v);
    return { min: clean, max: clean };
};
const makeBounds = (min: number, max: number): SenkaBounds => ({
    min: normZero(min),
    max: normZero(max),
});
const sameMonth = (a: SenkaMonth, b: SenkaMonth): boolean => a.year === b.year && a.month === b.month;
const isNonNegSafeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function normalizeExpReadings(readings: readonly ExpReading[]): ValidExpReading[] {
    const valid: ValidExpReading[] = [];
    for (const r of readings) {
        if (Number.isFinite(r.ts) && isNonNegSafeInt(r.exp)) {
            valid.push({ ts: r.ts, exp: r.exp });
        }
    }
    valid.sort((a, b) => a.ts - b.ts);
    return valid;
}

function isCertainPostTallyEoRow(row: EoSortieInput, map: string): boolean {
    if (row.map !== map || row.cleared !== true || row.catchOnly) return false;
    if (row.clearedBy === 'mapinfo') return false;
    if (typeof row.exmapRate === 'number' && Number.isSafeInteger(row.exmapRate) && row.exmapRate > 0) {
        return true;
    }
    if (row.clearedBy === 'battle') return false;
    return EO_FIXED_MAP_SET.has(map);
}

function evaluateAnchor(
    obs: SelfRankingObservation,
    round: RankingRoundInfo,
    rank: number | null,
    month: SenkaMonth,
    now: number,
    regular: RegularSenkaResult,
    eo: EoSenkaResult,
    quest: QuestSenkaResult,
    sortedReadingsUpToEnd: readonly ValidExpReading[],
    sortiesUpToNow: readonly EoSortieInput[],
): AnchorEvaluation {
    const win = senkaMonthWindow(month);
    const prevWin = senkaMonthWindow(prevSenkaMonth(month));
    const eoWin = eoMonthWindow(month);
    const T = round.tallyAt;

    // 1. 拆解普通戰果為 [月起點, T) 與 [T, now]
    let beforeMonth: ValidExpReading | null = null;
    const inMonth: ValidExpReading[] = [];
    for (const r of sortedReadingsUpToEnd) {
        if (r.ts < win.start) beforeMonth = r;
        else inMonth.push(r);
    }

    let regularBeforeT: SenkaBounds | null;
    let regularSinceT: SenkaBounds;
    let hasRegularGapAtT = false;

    if (inMonth.length === 0) {
        regularBeforeT = null;
        regularSinceT = exactBounds(0);
        hasRegularGapAtT = true;
    } else {
        const beforeT: ValidExpReading[] = [];
        const atOrAfterT: ValidExpReading[] = [];
        for (const r of inMonth) {
            if (r.ts < T) beforeT.push(r);
            else atOrAfterT.push(r);
        }
        const firstInMonth = inMonth[0];
        const lastInMonth = inMonth[inMonth.length - 1];

        if (beforeT.length > 0) {
            const eAtT = beforeT[beforeT.length - 1];
            regularSinceT = exactBounds(expToRegularSenka(lastInMonth.exp - eAtT.exp));
            if (regular.status === 'exact') {
                regularBeforeT = exactBounds(expToRegularSenka(eAtT.exp - firstInMonth.exp));
            } else if (regular.status === 'range' && beforeMonth !== null) {
                regularBeforeT = makeBounds(
                    expToRegularSenka(eAtT.exp - firstInMonth.exp),
                    expToRegularSenka(eAtT.exp - beforeMonth.exp),
                );
            } else {
                regularBeforeT = null;
            }
        } else if (beforeMonth !== null && beforeMonth.exp === atOrAfterT[0].exp) {
            // 跨月後在 T 之後才登入且經驗值未變：整段 [win.start, T) 確定增量為 0。
            regularBeforeT = exactBounds(0);
            regularSinceT = exactBounds(expToRegularSenka(lastInMonth.exp - atOrAfterT[0].exp));
        } else if (
            beforeMonth !== null
            && beforeMonth.ts >= prevWin.start
            && beforeMonth.ts < win.start
            && atOrAfterT[0].exp > beforeMonth.exp
        ) {
            regularBeforeT = makeBounds(0, expToRegularSenka(atOrAfterT[0].exp - beforeMonth.exp));
            regularSinceT = makeBounds(
                expToRegularSenka(lastInMonth.exp - atOrAfterT[0].exp),
                expToRegularSenka(lastInMonth.exp - beforeMonth.exp),
            );
            hasRegularGapAtT = true;
        } else {
            regularBeforeT = null;
            regularSinceT = exactBounds(expToRegularSenka(lastInMonth.exp - atOrAfterT[0].exp));
            hasRegularGapAtT = true;
        }
    }

    // 2. 拆解 EO 戰果為 [eoWin.start, T) 與 [T, min(eoWin.end, now)]
    const eoBeforeTRes = eoSenkaForMonth(
        sortiesUpToNow.filter(s => s.ts < T),
        month,
    );
    const clearedBeforeT = new Set(
        eoBeforeTRes.items.filter(item => item.cleared).map(item => item.map),
    );
    const eoPostStart = Math.max(T, eoWin.start);
    let certainEoSinceT = 0;
    let uncertainEoTotal = 0;
    let eoTimingUncertain = false;

    for (const item of eo.items) {
        if (!item.cleared || clearedBeforeT.has(item.map)) continue;
        const hasCertainPostTally = sortiesUpToNow.some(
            s => s.ts >= eoPostStart && s.ts < eoWin.end && s.ts <= now && isCertainPostTallyEoRow(s, item.map),
        );
        if (hasCertainPostTally) {
            certainEoSinceT += item.points;
        } else {
            // 僅來自 mapinfo 快照／mapinfo 補標，無法判定實際擊破落在 T 前或 T 後。
            uncertainEoTotal += item.points;
            eoTimingUncertain = true;
        }
    }
    const eoBeforeT = makeBounds(eoBeforeTRes.total, eoBeforeTRes.total + uncertainEoTotal);
    const eoSinceT = makeBounds(certainEoSinceT, certainEoSinceT + uncertainEoTotal);

    // 3. 拆解任務戰果（直接分割 quest.items，確保前後總和完全守恆）
    let qBeforeMin = 0;
    let qBeforeMax = 0;
    let qSinceMin = 0;
    let qSinceMax = 0;
    for (const item of quest.items) {
        if (item.ts < T) {
            qBeforeMin += item.fixed;
            qBeforeMax += item.fixed + item.choice;
        } else {
            qSinceMin += item.fixed;
            qSinceMax += item.fixed + item.choice;
        }
    }
    const questBeforeT = makeBounds(qBeforeMin, qBeforeMax);
    const questSinceT = makeBounds(qSinceMin, qSinceMax);

    // 4. 推算繼承分與自 T 起算的新增／本月推算
    let rawCarry: SenkaBounds | null = null;
    let carry: SenkaBounds | null = null;
    let inconsistent = false;
    if (regularBeforeT !== null) {
        const rawMin = obs.score - (regularBeforeT.max + eoBeforeT.max + questBeforeT.max);
        const rawMax = obs.score - (regularBeforeT.min + eoBeforeT.min + questBeforeT.min);
        rawCarry = makeBounds(rawMin, rawMax);
        if (rawMax < -SENKA_CALIBRATION_TOLERANCE) {
            inconsistent = true;
        } else {
            carry = makeBounds(Math.max(0, rawMin), Math.max(0, rawMax));
        }
    }

    const sinceTally = makeBounds(
        regularSinceT.min + eoSinceT.min + questSinceT.min,
        regularSinceT.max + eoSinceT.max + questSinceT.max,
    );
    const estimate = makeBounds(obs.score + sinceTally.min, obs.score + sinceTally.max);

    return {
        obs,
        round,
        rank,
        hasRegularGapAtT,
        eoTimingUncertain,
        rawCarry,
        carry,
        inconsistent,
        sinceTally,
        estimate,
    };
}

/**
 * 依當月觀測資料與榜單本人戰果推算繼承分（或基線）及截至 `now` 的本月總戰果區間。
 */
export function calibrateMonthlySenka(input: SenkaCalibrationInput): SenkaCalibrationResult {
    const { month, now, questLookup } = input;
    if (!Number.isFinite(now)) {
        return {
            status: 'uncalibrated',
            month,
            regular: regularSenkaForMonth([], month),
            eo: eoSenkaForMonth([], month),
            quest: questSenkaForMonth([], month, questLookup),
        };
    }

    const readingsUpToNow = input.readings.filter(r => Number.isFinite(r.ts) && r.ts <= now);
    const sortiesUpToNow = input.sorties.filter(s => Number.isFinite(s.ts) && s.ts <= now);
    const questClaimsUpToNow = input.questClaims.filter(q => Number.isFinite(q.ts) && q.ts <= now);

    const regular = regularSenkaForMonth(readingsUpToNow, month);
    const eo = eoSenkaForMonth(sortiesUpToNow, month);
    const quest = questSenkaForMonth(questClaimsUpToNow, month, questLookup);

    if (regular.status === 'anomaly') {
        return { status: 'anomaly', month, regular, eo, quest };
    }

    const byPublishedAt = new Map<number, {
        obs: SelfRankingObservation;
        round: RankingRoundInfo;
        rank: number | null;
    }>();
    for (const r of input.selfRankings) {
        if (!isNonNegSafeInt(r.score)) continue;
        const round = rankingRoundAt(r.publishedAt);
        if (!round || !sameMonth(round.month, month) || round.publishedAt > now) continue;
        const rank = typeof r.rank === 'number' && Number.isSafeInteger(r.rank) && r.rank >= 1
            ? r.rank
            : null;
        byPublishedAt.set(round.publishedAt, { obs: r, round, rank });
    }

    if (byPublishedAt.size === 0) {
        return { status: 'uncalibrated', month, regular, eo, quest };
    }

    const sortedObs = [...byPublishedAt.values()].sort(
        (a, b) => a.round.publishedAt - b.round.publishedAt,
    );
    const win = senkaMonthWindow(month);
    const sortedReadingsUpToEnd = normalizeExpReadings(readingsUpToNow).filter(r => r.ts < win.end);

    const anchors = sortedObs.map(({ obs, round, rank }) =>
        evaluateAnchor(
            obs,
            round,
            rank,
            month,
            now,
            regular,
            eo,
            quest,
            sortedReadingsUpToEnd,
            sortiesUpToNow,
        ),
    );

    const earliest = anchors[0];
    const latest = anchors[anchors.length - 1];

    const kind: 'carry' | 'baseline' = earliest.carry !== null ? 'carry' : 'baseline';
    const carry = earliest.carry;
    const calibratedAt = earliest.carry !== null
        ? earliest.round.publishedAt
        : latest.round.publishedAt;

    let baselineDrift: number | null = null;
    if (anchors.length >= 2 && earliest.rawCarry !== null && latest.rawCarry !== null) {
        if (latest.rawCarry.min > earliest.rawCarry.max + SENKA_CALIBRATION_TOLERANCE) {
            baselineDrift = normZero(latest.rawCarry.min - earliest.rawCarry.max);
        } else if (latest.rawCarry.max < earliest.rawCarry.min - SENKA_CALIBRATION_TOLERANCE) {
            baselineDrift = normZero(latest.rawCarry.max - earliest.rawCarry.min);
        } else {
            baselineDrift = 0;
        }
    }

    const reasons: SenkaCalibrationReason[] = [];
    if (regular.status === 'no-start') reasons.push('no-month-start');
    if (regular.status === 'range') reasons.push('month-boundary-range');
    if (latest.hasRegularGapAtT) reasons.push('no-reading-before-tally');
    if (quest.min !== quest.max) reasons.push('choice-quest');
    if (earliest.eoTimingUncertain || latest.eoTimingUncertain) reasons.push('eo-timing-uncertain');
    if (baselineDrift !== null && baselineDrift !== 0) reasons.push('baseline-drift');
    if (earliest.inconsistent || latest.inconsistent) reasons.push('inconsistent-baseline');
    if (input.hasSpecialSenkaGap === true) reasons.push('special-senka-gap');

    return {
        status: 'calibrated',
        month,
        kind,
        carry,
        calibratedAt,
        latestRound: latest.round,
        publishedScore: latest.obs.score,
        publishedRank: latest.rank,
        sinceTally: latest.sinceTally,
        estimate: latest.estimate,
        regular,
        eo,
        quest,
        estimated: reasons.length > 0,
        reasons,
        baselineDrift,
    };
}

/**
 * 依當月榜線紀錄或自訂目標分數計算「當次榜差」與「距該榜線／自訂目標」。
 * 僅採用屬於指定 `month` 的榜線紀錄，絕不借用他月榜線。
 */
export function evaluateSenkaTarget(input: SenkaTargetInput): SenkaTargetResult {
    const { month, target, estimate } = input;
    if (target.type === 'custom') {
        if (!Number.isFinite(target.score) || target.score < 0) {
            return { type: 'custom', targetScore: null, gapToTarget: null };
        }
        return {
            type: 'custom',
            targetScore: normZero(target.score),
            gapToTarget: estimate
                ? makeBounds(estimate.min - target.score, estimate.max - target.score)
                : null,
        };
    }

    const targetRank = target.rank;
    if (!Number.isSafeInteger(targetRank) || targetRank < 1) {
        return {
            type: 'rank',
            rank: targetRank,
            cutoff: null,
            selfScoreAtCutoff: null,
            gapAtPublication: null,
            gapToTarget: null,
        };
    }

    let best: {
        publishedAt: number;
        round: RankingRoundInfo;
        score: number;
        mode: 'auto' | 'manual';
    } | null = null;

    for (const c of input.cutoffs) {
        if (c.rank !== targetRank || !isNonNegSafeInt(c.score)) continue;
        const round = rankingRoundAt(c.publishedAt);
        if (!round || !sameMonth(round.month, month)) continue;
        if (input.now !== undefined && (!Number.isFinite(input.now) || round.publishedAt > input.now)) {
            continue;
        }
        const mode: 'auto' | 'manual' = c.mode === 'auto' ? 'auto' : 'manual';
        const wins = !best
            || round.publishedAt > best.publishedAt
            || (round.publishedAt === best.publishedAt && (mode === 'auto' || best.mode !== 'auto'));
        if (wins) {
            best = { publishedAt: round.publishedAt, round, score: c.score, mode };
        }
    }

    if (!best) {
        return {
            type: 'rank',
            rank: targetRank,
            cutoff: null,
            selfScoreAtCutoff: null,
            gapAtPublication: null,
            gapToTarget: null,
        };
    }

    let selfScoreAtCutoff: number | null = null;
    for (const s of input.selfRankings ?? []) {
        if (!isNonNegSafeInt(s.score)) continue;
        const round = rankingRoundAt(s.publishedAt);
        if (!round || !sameMonth(round.month, month)) continue;
        if (round.publishedAt === best.publishedAt) {
            selfScoreAtCutoff = s.score;
        }
    }

    return {
        type: 'rank',
        rank: targetRank,
        cutoff: {
            publishedAt: best.publishedAt,
            tallyAt: best.round.tallyAt,
            rank: targetRank,
            score: best.score,
            mode: best.mode,
            isFinalRound: best.round.isFinalRound,
        },
        selfScoreAtCutoff,
        gapAtPublication: selfScoreAtCutoff !== null ? normZero(selfScoreAtCutoff - best.score) : null,
        gapToTarget: estimate
            ? makeBounds(estimate.min - best.score, estimate.max - best.score)
            : null,
    };
}
