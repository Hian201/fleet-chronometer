// 戰果榜單校準（繼承分／基線）與目標榜線差額純函式測試（utils/senka-calibration.ts）。
import { describe, expect, it } from 'vitest';
import { questSenkaCatalogEntry } from '../utils/quest-senka';
import { senkaMonthWindow, type EoSortieInput, type ExpReading, type QuestClaimInput } from '../utils/senka';
import {
    SENKA_CALIBRATION_TOLERANCE,
    calibrateMonthlySenka,
    evaluateSenkaTarget,
} from '../utils/senka-calibration';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
/** 戰果 1 分所需提督經驗值（`10,000 / 7` 的整數倍：100,000 EXP ＝ 70 戰果）。 */
const expForPts = (pts: number) => Math.round((pts * 10_000) / 7);

describe('calibrateMonthlySenka', () => {
    const nov = { year: 2026, month: 11 };
    const novWin = senkaMonthWindow(nov);
    const octWin = senkaMonthWindow({ year: 2026, month: 10 });

    it('月初乾淨校準：精確求出繼承分，1 日早登入且經驗與上月相等亦無須補猜', () => {
        const baseExp = 1_000_000;
        const round1Pub = Date.UTC(2026, 9, 31, 18, 0, 0); // 11/1 03:00 JST (tally 02:00 JST)
        const now = Date.UTC(2026, 10, 1, 2, 0, 0);        // 11/1 11:00 JST

        const res = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: novWin.start - 5 * HOUR, exp: baseExp },
                { ts: round1Pub - 10 * MINUTE, exp: baseExp }, // 11/1 02:50 JST（T 後首筆，exp 未變）
                { ts: now - 10 * MINUTE, exp: baseExp + expForPts(14) },
            ],
            sorties: [{ ts: round1Pub + HOUR, map: '1-5', cleared: true, clearedBy: 'battle', exmapRate: 75 }],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: round1Pub, score: 310, rank: 120 }],
        });

        expect(res.status).toBe('calibrated');
        if (res.status !== 'calibrated') return;
        expect(res.kind).toBe('carry');
        expect(res.carry).toEqual({ min: 310, max: 310 });
        expect(res.calibratedAt).toBe(round1Pub);
        expect(res.sinceTally).toEqual({ min: 89, max: 89 });
        expect(res.estimate).toEqual({ min: 399, max: 399 });
        expect(res.estimated).toBe(false);
        expect(res.reasons).toEqual([]);
        expect(res.baselineDrift).toBeNull();
    });

    it('提案「月底追榜」與驗收案例「同服同榜次落後，之後周回追過舊榜線」', () => {
        const baseExp = 5_000_000;
        const finalPub = Date.UTC(2026, 10, 30, 6, 0, 0); // 11/30 15:00 JST
        const finalTally = Date.UTC(2026, 10, 30, 5, 0, 0); // 11/30 14:00 JST
        const now = Date.UTC(2026, 10, 30, 9, 0, 0); // 11/30 18:00 JST

        // 至 14:00 JST：繼承 310 + 普通 2370 + EO 1200 + 任務 300 = 4180；14:00 後再打普通 +80 → 4260
        const readings: ExpReading[] = [
            { ts: novWin.start - HOUR, exp: baseExp },
            { ts: novWin.start + MINUTE, exp: baseExp },
            { ts: finalTally - 10 * MINUTE, exp: baseExp + expForPts(2370) },
            { ts: now - MINUTE, exp: baseExp + expForPts(2450) },
        ];
        const sorties: EoSortieInput[] = [
            { ts: Date.UTC(2026, 10, 5, 8, 0), map: '1-5', cleared: true },
            { ts: Date.UTC(2026, 10, 6, 8, 0), map: '1-6', cleared: true },
            { ts: Date.UTC(2026, 10, 7, 8, 0), map: '2-5', cleared: true },
            { ts: Date.UTC(2026, 10, 8, 8, 0), map: '3-5', cleared: true },
            { ts: Date.UTC(2026, 10, 9, 8, 0), map: '7-5', cleared: true, clearedBy: 'battle', exmapRate: 170 },
            { ts: Date.UTC(2026, 10, 10, 8, 0), map: '4-5', cleared: true },
            { ts: Date.UTC(2026, 10, 11, 8, 0), map: '5-5', cleared: true },
            { ts: Date.UTC(2026, 10, 12, 8, 0), map: '6-5', cleared: true, clearedBy: 'battle', exmapRate: 250 },
        ];
        const questClaims: QuestClaimInput[] = [
            { eventId: 1, questNo: 893, ts: Date.UTC(2026, 10, 15, 8, 0) }, // +300
        ];
        const selfRankings = [{ publishedAt: finalPub, score: 4180, rank: 512 }];

        const cal = calibrateMonthlySenka({
            month: nov,
            now,
            readings,
            sorties,
            questClaims,
            questLookup: questSenkaCatalogEntry,
            selfRankings,
        });

        expect(cal.status).toBe('calibrated');
        if (cal.status !== 'calibrated') return;
        expect(cal.kind).toBe('carry');
        expect(cal.carry?.min).toBeCloseTo(310, 3);
        expect(cal.carry?.max).toBeCloseTo(310, 3);
        expect(cal.latestRound.isFinalRound).toBe(true);
        expect(cal.publishedScore).toBe(4180);
        expect(cal.publishedRank).toBe(512);
        expect(cal.sinceTally.min).toBeCloseTo(80, 3);
        expect(cal.sinceTally.max).toBeCloseTo(80, 3);
        expect(cal.estimate.min).toBeCloseTo(4260, 3);
        expect(cal.estimate.max).toBeCloseTo(4260, 3);
        expect(cal.estimated).toBe(false);

        const targetRes = evaluateSenkaTarget({
            month: nov,
            target: { type: 'rank', rank: 500 },
            estimate: cal.estimate,
            cutoffs: [{ publishedAt: finalPub, rank: 500, score: 4200, mode: 'auto' }],
            selfRankings,
            now,
        });
        expect(targetRes.type).toBe('rank');
        if (targetRes.type !== 'rank') return;
        expect(targetRes.rank).toBe(500);
        expect(targetRes.cutoff).toEqual({
            publishedAt: finalPub,
            tallyAt: finalTally,
            rank: 500,
            score: 4200,
            mode: 'auto',
            isFinalRound: true,
        });
        expect(targetRes.selfScoreAtCutoff).toBe(4180);
        expect(targetRes.gapAtPublication).toBe(-20);
        expect(targetRes.gapToTarget?.min).toBeCloseTo(60, 3);
        expect(targetRes.gapToTarget?.max).toBeCloseTo(60, 3);
    });

    it('±1 容差：1 月 rawCarry = -0.6 時夾限為 0 不標異常；兩次榜分誤差 ≤ 1 視為一致', () => {
        const jan = { year: 2026, month: 1 };
        const janWin = senkaMonthWindow(jan);
        const pub1 = Date.UTC(2026, 0, 5, 6, 0, 0);
        const pub2 = Date.UTC(2026, 0, 6, 6, 0, 0);
        const now = Date.UTC(2026, 0, 6, 9, 0, 0);
        const baseExp = 1_000_000;
        // exp 增 143,715 → 100.6005 分，遊戲無條件捨去記 100 分 → rawCarry ≈ -0.6
        const deltaBefore1 = 143_715;
        const deltaBefore2 = 286_500; // 200.55 分

        const res = calibrateMonthlySenka({
            month: jan,
            now,
            readings: [
                { ts: janWin.start - HOUR, exp: baseExp },
                { ts: janWin.start + MINUTE, exp: baseExp },
                { ts: pub1 - 2 * HOUR, exp: baseExp + deltaBefore1 },
                { ts: pub2 - 2 * HOUR, exp: baseExp + deltaBefore2 },
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [
                { publishedAt: pub1, score: 100 },
                { publishedAt: pub2, score: 200 },
            ],
        });

        expect(SENKA_CALIBRATION_TOLERANCE).toBe(1);
        expect(res.status).toBe('calibrated');
        if (res.status !== 'calibrated') return;
        expect(res.kind).toBe('carry');
        expect(res.carry).toEqual({ min: 0, max: 0 });
        expect(res.baselineDrift).toBe(0);
        expect(res.estimated).toBe(false);
        expect(res.reasons).toEqual([]);
    });

    it('漂移與異常：誤差 > 1 標 baseline-drift、仍保留最早繼承分且總額改由最新榜分起算；低於 -1 標 inconsistent-baseline', () => {
        const baseExp = 2_000_000;
        const pub1 = Date.UTC(2026, 10, 5, 6, 0, 0);
        const pub2 = Date.UTC(2026, 10, 10, 6, 0, 0);
        const now = Date.UTC(2026, 10, 10, 10, 0, 0);

        // 別的裝置在 T1..T2 打了 EO 7-5 (+170)，造成第二次 rawCarry = 480（漂移 +170）
        const driftRes = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: novWin.start - HOUR, exp: baseExp },
                { ts: novWin.start + MINUTE, exp: baseExp },
                { ts: pub1 - 2 * HOUR, exp: baseExp + expForPts(140) },
                { ts: pub2 - 2 * HOUR, exp: baseExp + expForPts(280) },
                { ts: now - MINUTE, exp: baseExp + expForPts(301) },
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [
                { publishedAt: pub1, score: 450 },  // carry = 450 - 140 = 310
                { publishedAt: pub2, score: 760 },  // carry = 760 - 280 = 480
            ],
        });

        expect(driftRes.status).toBe('calibrated');
        if (driftRes.status === 'calibrated') {
            expect(driftRes.kind).toBe('carry');
            expect(driftRes.carry).toEqual({ min: 310, max: 310 });
            expect(driftRes.calibratedAt).toBe(pub1);
            expect(driftRes.baselineDrift).toBe(170);
            expect(driftRes.sinceTally).toEqual({ min: 21, max: 21 });
            expect(driftRes.estimate).toEqual({ min: 781, max: 781 });
            expect(driftRes.estimated).toBe(true);
            expect(driftRes.reasons).toEqual(['baseline-drift']);
        }

        // 負漂移（兩筆皆非負，但第二次 rawCarry 低於第一次超過 1）
        const negDriftRes = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: novWin.start - HOUR, exp: baseExp },
                { ts: novWin.start + MINUTE, exp: baseExp },
                { ts: pub1 - 2 * HOUR, exp: baseExp + expForPts(140) },
                { ts: pub2 - 2 * HOUR, exp: baseExp + expForPts(280) },
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [
                { publishedAt: pub1, score: 450 }, // carry = 310
                { publishedAt: pub2, score: 570 }, // carry = 290 → drift = -20
            ],
        });
        expect(negDriftRes.status).toBe('calibrated');
        if (negDriftRes.status === 'calibrated') {
            expect(negDriftRes.baselineDrift).toBe(-20);
            expect(negDriftRes.estimated).toBe(true);
            expect(negDriftRes.reasons).toEqual(['baseline-drift']);
        }

        // 負漂移且低於 -1（如結算期間讀到前一次榜分 100，但 T 前已觀測 150 → rawCarry = -50）
        const badRes = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: novWin.start - HOUR, exp: baseExp },
                { ts: novWin.start + MINUTE, exp: baseExp },
                { ts: pub1 - 2 * HOUR, exp: baseExp + expForPts(150) },
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: pub1, score: 100 }],
        });
        expect(badRes.status).toBe('calibrated');
        if (badRes.status === 'calibrated') {
            expect(badRes.kind).toBe('baseline');
            expect(badRes.carry).toBeNull();
            expect(badRes.estimated).toBe(true);
            expect(badRes.reasons).toEqual(['inconsistent-baseline']);
        }
    });

    it('新基線到來時已納入榜分的普通／EO／任務增量不重複計入，且重複呼叫冪等', () => {
        const baseExp = 3_000_000;
        const pub1 = Date.UTC(2026, 10, 5, 6, 0, 0);  // T1 = 05:00 UTC
        const pub2 = Date.UTC(2026, 10, 12, 6, 0, 0); // T2 = 05:00 UTC
        const now = Date.UTC(2026, 10, 13, 9, 0, 0);

        const input = {
            month: nov,
            now,
            readings: [
                { ts: novWin.start - HOUR, exp: baseExp },
                { ts: novWin.start + MINUTE, exp: baseExp },
                { ts: pub1 - 2 * HOUR, exp: baseExp + expForPts(140) },
                { ts: pub2 - 2 * HOUR, exp: baseExp + expForPts(560) },
                { ts: now - HOUR, exp: baseExp + expForPts(630) }, // T2 後 +70
            ],
            sorties: [
                { ts: Date.UTC(2026, 10, 8, 8, 0), map: '6-5', cleared: true, clearedBy: 'battle' as const, exmapRate: 250 }, // T1..T2
                { ts: Date.UTC(2026, 10, 13, 1, 0), map: '1-5', cleared: true, clearedBy: 'battle' as const, exmapRate: 75 },  // T2 後
            ],
            questClaims: [
                { eventId: 1, questNo: 893, ts: Date.UTC(2026, 10, 9, 8, 0) },  // +300 (T1..T2)
                { eventId: 2, questNo: 888, ts: Date.UTC(2026, 10, 12, 10, 0) }, // +200 (T2 後)
            ],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [
                { publishedAt: pub2, score: 1420, rank: 210 }, // 310 + 560 + 250 + 300
                { publishedAt: pub1, score: 450, rank: 400 },  // 亂序輸入亦可正常依時間排序
            ],
        };

        const first = calibrateMonthlySenka(input);
        const second = calibrateMonthlySenka(input);
        expect(first).toEqual(second);
        expect(first.status).toBe('calibrated');
        if (first.status !== 'calibrated') return;
        expect(first.carry).toEqual({ min: 310, max: 310 });
        expect(first.calibratedAt).toBe(pub1);
        expect(first.baselineDrift).toBe(0);
        // sinceTally 只包含 T2 後：普通 70 + EO 75 + 任務 200 = 345
        expect(first.sinceTally).toEqual({ min: 345, max: 345 });
        expect(first.estimate).toEqual({ min: 1765, max: 1765 });
        expect(first.estimated).toBe(false);
    });

    it('驗收案例「月中安裝、只有一次榜分」：T 前有讀數與僅 T 後有讀數皆採基線模式', () => {
        const baseExp = 4_000_000;
        const pub = Date.UTC(2026, 10, 15, 6, 0, 0); // T = 05:00 UTC
        const now = Date.UTC(2026, 10, 16, 6, 0, 0);

        // (a) 安裝於月中、T 前已有讀數
        const withPreT = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: pub - 4 * HOUR, exp: baseExp },
                { ts: pub - 2 * HOUR, exp: baseExp + expForPts(70) },
                { ts: now - HOUR, exp: baseExp + expForPts(140) },
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: pub, score: 1500, rank: 350 }],
        });
        expect(withPreT.status).toBe('calibrated');
        if (withPreT.status === 'calibrated') {
            expect(withPreT.kind).toBe('baseline');
            expect(withPreT.carry).toBeNull();
            expect(withPreT.calibratedAt).toBe(pub);
            expect(withPreT.sinceTally).toEqual({ min: 70, max: 70 });
            expect(withPreT.estimate).toEqual({ min: 1570, max: 1570 });
            expect(withPreT.estimated).toBe(true);
            expect(withPreT.reasons).toEqual(['no-month-start']);
        }

        // (b) 安裝於月中且首筆讀數在 T 之後
        const onlyPostT = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: pub + HOUR, exp: baseExp },
                { ts: now - HOUR, exp: baseExp + expForPts(49) },
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: pub, score: 1500 }],
        });
        expect(onlyPostT.status).toBe('calibrated');
        if (onlyPostT.status === 'calibrated') {
            expect(onlyPostT.kind).toBe('baseline');
            expect(onlyPostT.carry).toBeNull();
            expect(onlyPostT.sinceTally).toEqual({ min: 49, max: 49 });
            expect(onlyPostT.estimate).toEqual({ min: 1549, max: 1549 });
            expect(onlyPostT.reasons).toEqual(['no-month-start', 'no-reading-before-tally']);
        }
    });

    it('跨月區間 range：月界不確定只留在繼承分，T 前有讀數時推算總額仍收斂為單值', () => {
        const baseExp = 1_000_000;
        const pub = Date.UTC(2026, 10, 5, 6, 0, 0);
        const now = Date.UTC(2026, 10, 6, 6, 0, 0);

        const res = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: octWin.start + HOUR, exp: baseExp },                  // 前月最後一筆
                { ts: novWin.start + HOUR, exp: baseExp + expForPts(21) },  // 跨月增量 21
                { ts: pub - 2 * HOUR, exp: baseExp + expForPts(126) },      // 月內至 T：105..126
                { ts: now - HOUR, exp: baseExp + expForPts(175) },          // T 後 +49
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: pub, score: 426 }], // carry = 426 - [105, 126] = [300, 321]
        });

        expect(res.status).toBe('calibrated');
        if (res.status !== 'calibrated') return;
        expect(res.kind).toBe('carry');
        expect(res.carry).toEqual({ min: 300, max: 321 });
        expect(res.sinceTally).toEqual({ min: 49, max: 49 });
        expect(res.estimate).toEqual({ min: 475, max: 475 });
        expect(res.estimated).toBe(true);
        expect(res.reasons).toEqual(['month-boundary-range']);
    });

    it('949（B170）選擇報酬：T 前領取只放寬 carry；T 後領取放寬 sinceTally 與 estimate', () => {
        const baseExp = 1_000_000;
        const pub = Date.UTC(2026, 10, 15, 6, 0, 0);
        const now = Date.UTC(2026, 10, 16, 6, 0, 0);
        const readings: ExpReading[] = [
            { ts: novWin.start - HOUR, exp: baseExp },
            { ts: novWin.start + MINUTE, exp: baseExp },
            { ts: pub - 2 * HOUR, exp: baseExp + expForPts(105) },
            { ts: now - HOUR, exp: baseExp + expForPts(147) },
        ];

        const beforeT = calibrateMonthlySenka({
            month: nov,
            now,
            readings,
            sorties: [],
            questClaims: [{ eventId: 1, questNo: 949, ts: pub - 3 * HOUR }],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: pub, score: 1215 }], // 若選了 +800 → carry 310；沒選 → carry 1110
        });
        expect(beforeT.status).toBe('calibrated');
        if (beforeT.status === 'calibrated') {
            expect(beforeT.carry).toEqual({ min: 310, max: 1110 });
            expect(beforeT.sinceTally).toEqual({ min: 42, max: 42 });
            expect(beforeT.estimate).toEqual({ min: 1257, max: 1257 });
            expect(beforeT.reasons).toEqual(['choice-quest']);
        }

        const afterT = calibrateMonthlySenka({
            month: nov,
            now,
            readings,
            sorties: [],
            questClaims: [{ eventId: 2, questNo: 949, ts: pub + HOUR }],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: pub, score: 415 }],
        });
        expect(afterT.status).toBe('calibrated');
        if (afterT.status === 'calibrated') {
            expect(afterT.carry).toEqual({ min: 310, max: 310 });
            expect(afterT.sinceTally).toEqual({ min: 42, max: 842 });
            expect(afterT.estimate).toEqual({ min: 457, max: 1257 });
            expect(afterT.reasons).toEqual(['choice-quest']);
        }
    });

    it('特別戰果空窗：T 後 mapinfo 補記的 EO 以 [0, points] 處理並標 eo-timing-uncertain；顯式空窗標 special-senka-gap', () => {
        const baseExp = 1_000_000;
        const pub = Date.UTC(2026, 10, 15, 6, 0, 0);
        const now = Date.UTC(2026, 10, 16, 6, 0, 0);

        const res = calibrateMonthlySenka({
            month: nov,
            now,
            readings: [
                { ts: novWin.start - HOUR, exp: baseExp },
                { ts: novWin.start + MINUTE, exp: baseExp },
                { ts: pub - 2 * HOUR, exp: baseExp + expForPts(105) },
            ],
            sorties: [
                // 只有 T 後的 mapinfo 補記（可能是 T 前打完、也可能是 T 後才打）
                { ts: pub + HOUR, map: '6-5', cleared: true, clearedBy: 'mapinfo' },
                // 確定在 T 後的戰鬥擊破（不應標 uncertain）
                { ts: pub + 2 * HOUR, map: '1-5', cleared: true, clearedBy: 'battle', exmapRate: 75 },
            ],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: pub, score: 665 }],
            hasSpecialSenkaGap: true,
        });

        expect(res.status).toBe('calibrated');
        if (res.status !== 'calibrated') return;
        // 若 6-5 在 T 前就打掉：carry = 665 - 105 - 250 = 310；若在 T 後才打：carry = 560
        expect(res.carry).toEqual({ min: 310, max: 560 });
        expect(res.sinceTally).toEqual({ min: 75, max: 325 });
        expect(res.estimate).toEqual({ min: 740, max: 990 });
        expect(res.estimated).toBe(true);
        expect(res.reasons).toEqual(['eo-timing-uncertain', 'special-senka-gap']);
    });

    it('未校準與經驗倒退異常案例', () => {
        const baseExp = 1_000_000;
        const decPub = Date.UTC(2026, 11, 5, 6, 0, 0);
        const novPub = Date.UTC(2026, 10, 5, 6, 0, 0);

        // 無他月以外之榜分或 now 早於榜分
        expect(calibrateMonthlySenka({
            month: nov,
            now: novPub - 1,
            readings: [{ ts: novWin.start + MINUTE, exp: baseExp }],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [
                { publishedAt: novPub, score: 400 },
                { publishedAt: decPub, score: 500 },
            ],
        }).status).toBe('uncalibrated');

        expect(calibrateMonthlySenka({
            month: nov,
            now: Number.NaN,
            readings: [],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: novPub, score: 400 }],
        }).status).toBe('uncalibrated');

        // 經驗倒退
        expect(calibrateMonthlySenka({
            month: nov,
            now: novPub + HOUR,
            readings: [
                { ts: novWin.start + MINUTE, exp: baseExp },
                { ts: novWin.start + HOUR, exp: baseExp - 100 },
            ],
            sorties: [],
            questClaims: [],
            questLookup: questSenkaCatalogEntry,
            selfRankings: [{ publishedAt: novPub, score: 400 }],
        }).status).toBe('anomaly');
    });
});

describe('evaluateSenkaTarget', () => {
    const nov = { year: 2026, month: 11 };
    const octPub = Date.UTC(2026, 9, 25, 6, 0, 0);
    const novPub1 = Date.UTC(2026, 10, 20, 6, 0, 0);
    const novPub2 = Date.UTC(2026, 10, 25, 6, 0, 0);

    it('缺當月榜線或不借用他月榜線時回傳 null', () => {
        expect(evaluateSenkaTarget({
            month: nov,
            target: { type: 'rank', rank: 500 },
            estimate: { min: 3500, max: 3500 },
            cutoffs: [{ publishedAt: octPub, rank: 500, score: 4100, mode: 'auto' }],
        })).toEqual({
            type: 'rank',
            rank: 500,
            cutoff: null,
            selfScoreAtCutoff: null,
            gapAtPublication: null,
            gapToTarget: null,
        });
    });

    it('同榜次 auto 優先於 manual、本人不同榜次時 gapAtPublication 為 null、不混淆自訂目標', () => {
        const res = evaluateSenkaTarget({
            month: nov,
            target: { type: 'rank', rank: 500 },
            estimate: { min: 3800, max: 3900 },
            cutoffs: [
                { publishedAt: novPub2, rank: 500, score: 3750, mode: 'auto' },
                { publishedAt: novPub2, rank: 500, score: 3760, mode: 'manual' },
                { publishedAt: novPub2 + 12 * HOUR, rank: 500, score: 9999, mode: 'auto' }, // 晚於 now
            ],
            selfRankings: [{ publishedAt: novPub1, score: 3200, rank: 490 }], // 非同一榜次
            now: novPub2,
        });
        expect(res).toEqual({
            type: 'rank',
            rank: 500,
            cutoff: {
                publishedAt: novPub2,
                tallyAt: novPub2 - HOUR,
                rank: 500,
                score: 3750,
                mode: 'auto',
                isFinalRound: false,
            },
            selfScoreAtCutoff: null,
            gapAtPublication: null,
            gapToTarget: { min: 50, max: 150 },
        });

        expect(evaluateSenkaTarget({
            month: nov,
            target: { type: 'custom', score: 4500 },
            estimate: { min: 4260, max: 4260 },
            cutoffs: [],
        })).toEqual({
            type: 'custom',
            targetScore: 4500,
            gapToTarget: { min: -240, max: -240 },
        });

        expect(evaluateSenkaTarget({
            month: nov,
            target: { type: 'custom', score: -1 },
            estimate: { min: 4260, max: 4260 },
            cutoffs: [],
        })).toEqual({
            type: 'custom',
            targetScore: null,
            gapToTarget: null,
        });
    });
});
