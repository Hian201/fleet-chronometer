import { describe, expect, it } from 'vitest';
import {
    DAIHATSU_MST,
    LANDING_CRAFT_BASE_BONUS,
    TOKU_DAIHATSU_MST,
    applyExpeditionBonus,
    collectLandingCraftGears,
    computeExpeditionBonus,
    type LandingCraftGear,
} from '../utils/expedition-bonus';

const DAIHATSU = DAIHATSU_MST;    // 大発動艇
const DAIHATSU_TANK = 166;       // 大発動艇(八九式中戦車＆陸戦隊)
const BUSO_DAIHATSU = 409;       // 武装大発
const NAIKATEI = 167;            // 特二式内火艇
const AB_TEI = 408;              // 装甲艇(AB艇)
const NAIKATEI4 = 525;           // 特四式内火艇
const NAIKATEI4_KAI = 526;       // 特四式内火艇改
const UNRELATED_MST = 1;         // 與加成無關的一般裝備

function gears(...items: LandingCraftGear[]): LandingCraftGear[] {
    return items;
}

function nOf(mst: number, count: number, level = 0): LandingCraftGear[] {
    return Array.from({ length: count }, () => ({ mst, level }));
}

describe('computeExpeditionBonus', () => {
    it('沒有大発系裝備時不生效', () => {
        const bonus = computeExpeditionBonus(gears({ mst: UNRELATED_MST, level: 0 }));
        expect(bonus).toEqual({ active: false, multiplier: 1, tokuBonusRate: 0 });
    });

    it('4個大発動艇（無改修）＝軟上限20%，無超頂加成', () => {
        const bonus = computeExpeditionBonus(nOf(DAIHATSU, 4));
        expect(bonus.active).toBe(true);
        expect(bonus.multiplier).toBeCloseTo(1.2, 10);
        expect(bonus.tokuBonusRate).toBe(0);
    });

    it('超過20%的基礎補正加總會被軟上限鎖住（5個以上大発系裝備）', () => {
        const bonus = computeExpeditionBonus(gears(
            { mst: DAIHATSU, level: 0 }, { mst: DAIHATSU, level: 0 }, { mst: DAIHATSU, level: 0 },
            { mst: DAIHATSU_TANK, level: 0 }, { mst: BUSO_DAIHATSU, level: 0 },
        ));
        // 3×5% + 2% + 3% = 20%，剛好卡在上限，改修0時倍率仍是1.2
        expect(bonus.multiplier).toBeCloseTo(1.2, 10);
    });

    it('改修★平均值是平坦的 0.2%×平均★，與基本補正是否已達20%上限無關', () => {
        // 2個大発動艇★max（基本補正僅10%，未達20%上限）——若誤植成「乘以基本補正」會偏低。
        const bonus = computeExpeditionBonus(nOf(DAIHATSU, 2, 10));
        expect(bonus.multiplier).toBeCloseTo(1.12, 10);   // 10%基本 + 0.2%×10=2%改修 = 12%
    });

    it('特二式内火艇／裝甲艇單獨裝備時的基礎加成分別為1%／2%', () => {
        expect(computeExpeditionBonus(gears({ mst: NAIKATEI, level: 0 })).multiplier).toBeCloseTo(1.01, 10);
        expect(computeExpeditionBonus(gears({ mst: AB_TEI, level: 0 })).multiplier).toBeCloseTo(1.02, 10);
    });

    it('特四式内火艇／改的基礎加成分別為4%／5%', () => {
        expect(computeExpeditionBonus(gears({ mst: NAIKATEI4, level: 0 })).multiplier).toBeCloseTo(1.04, 10);
        expect(computeExpeditionBonus(gears({ mst: NAIKATEI4_KAI, level: 0 })).multiplier).toBeCloseTo(1.05, 10);
    });

    it('特大発動艇的超頂加成是「特大発個數×同時裝備的一般大発個數」2D表，不是只看特大発個數', () => {
        const rate = (tokuCount: number, daihatsuCount: number) => computeExpeditionBonus(
            gears(...nOf(TOKU_DAIHATSU_MST, tokuCount), ...nOf(DAIHATSU, daihatsuCount)),
        ).tokuBonusRate;
        // 特大発+1／+2 對大発個數不敏感
        expect(rate(1, 0)).toBeCloseTo(0.02, 10);
        expect(rate(1, 4)).toBeCloseTo(0.02, 10);
        expect(rate(2, 0)).toBeCloseTo(0.04, 10);
        expect(rate(2, 3)).toBeCloseTo(0.04, 10);
        // 特大発+3：大発0/1/2/3/4以上 → 5.0/5.0/5.2/5.4/5.4%
        expect(rate(3, 0)).toBeCloseTo(0.05, 10);
        expect(rate(3, 1)).toBeCloseTo(0.05, 10);
        expect(rate(3, 2)).toBeCloseTo(0.052, 10);
        expect(rate(3, 3)).toBeCloseTo(0.054, 10);
        expect(rate(3, 4)).toBeCloseTo(0.054, 10);
        expect(rate(3, 6)).toBeCloseTo(0.054, 10);   // 4以上封頂
        // 特大発4以上：大発0/1/2/3/4以上 → 5.4/5.6/5.8/5.9/6.0%
        expect(rate(4, 0)).toBeCloseTo(0.054, 10);
        expect(rate(4, 1)).toBeCloseTo(0.056, 10);
        expect(rate(4, 2)).toBeCloseTo(0.058, 10);
        expect(rate(4, 3)).toBeCloseTo(0.059, 10);
        expect(rate(4, 4)).toBeCloseTo(0.06, 10);
        expect(rate(6, 4)).toBeCloseTo(0.06, 10);    // 特大発個數同樣 4以上封頂
    });

    it('大発動艇(八九式中戦車＆陸戦隊)等非「大発動艇」本體不計入超頂表的大発個數維度（wiki 腳注*3）', () => {
        // 特大発3 + 陸戦隊4（不是大発動艇本體）→ 大発維度仍是0，非4
        const bonus = computeExpeditionBonus(gears(
            ...nOf(TOKU_DAIHATSU_MST, 3), ...nOf(DAIHATSU_TANK, 4),
        ));
        expect(bonus.tokuBonusRate).toBeCloseTo(0.05, 10);   // 等同 rate(3,0)，不是 rate(3,4)=0.054
    });

    it('特大発動艇的基礎5%仍計入20%軟上限的加總', () => {
        const bonus = computeExpeditionBonus(nOf(TOKU_DAIHATSU_MST, 2));
        expect(bonus.multiplier).toBeCloseTo(1.1, 10);   // 2×5%
        expect(bonus.tokuBonusRate).toBeCloseTo(0.04, 10);
    });

    // 以下五例逐字取自 wikiwiki.jp/kancolle/特大発動艇 #bonus 的實際算例，鎖住整體公式；
    // 數字來自該頁原始 HTML 表格與例題（非 WebFetch 摘要——同一資料先前經小模型摘要兩次
    // 都拿到彼此矛盾的數字，這裡直接讀原始 HTML 核對後才收斂，見 CLAUDE.md 說明）。
    describe('wiki 原文算例（回歸鎖定）', () => {
        it('特大発1台＋大発動艇4台（全部★0）＝+22%', () => {
            const bonus = computeExpeditionBonus(gears(...nOf(TOKU_DAIHATSU_MST, 1), ...nOf(DAIHATSU, 4)));
            expect(bonus.multiplier + bonus.tokuBonusRate).toBeCloseTo(1.22, 10);
        });
        it('特大発★max4台＋大発★max4台＝+28%', () => {
            const bonus = computeExpeditionBonus(gears(...nOf(TOKU_DAIHATSU_MST, 4, 10), ...nOf(DAIHATSU, 4, 10)));
            expect(bonus.multiplier + bonus.tokuBonusRate).toBeCloseTo(1.28, 10);
        });
        it('特大発3台のみ（無大発動艇）＝+20%', () => {
            const bonus = computeExpeditionBonus(nOf(TOKU_DAIHATSU_MST, 3));
            expect(bonus.multiplier + bonus.tokuBonusRate).toBeCloseTo(1.2, 10);
        });
        it('特大発3台＋大発3台（全部★max）＝+27.4%', () => {
            const bonus = computeExpeditionBonus(gears(...nOf(TOKU_DAIHATSU_MST, 3, 10), ...nOf(DAIHATSU, 3, 10)));
            expect(bonus.multiplier + bonus.tokuBonusRate).toBeCloseTo(1.274, 10);
        });
        it('特大発4台＋大発2台（全部★max）＝+27.8%（優於特大発3+大発3）', () => {
            const bonus = computeExpeditionBonus(gears(...nOf(TOKU_DAIHATSU_MST, 4, 10), ...nOf(DAIHATSU, 2, 10)));
            expect(bonus.multiplier + bonus.tokuBonusRate).toBeCloseTo(1.278, 10);
        });
    });
});

describe('applyExpeditionBonus', () => {
    it('無加成時等同原數字（大成功倍率沿用既有×1.5慣例）', () => {
        const noBonus = computeExpeditionBonus([]);
        expect(applyExpeditionBonus(1000, noBonus)).toBe(1000);
        expect(applyExpeditionBonus(1000, noBonus, 1.5)).toBe(1500);
    });

    it('20%加成＋特大発超頂各自 floor 後相加', () => {
        const bonus = computeExpeditionBonus(gears(
            { mst: DAIHATSU, level: 0 }, { mst: DAIHATSU, level: 0 }, { mst: DAIHATSU, level: 0 },
            { mst: TOKU_DAIHATSU_MST, level: 0 },
        ));
        // 基本補正 3×5%+5%=20%（封頂）、特大発1台超頂+2%
        expect(bonus.multiplier).toBeCloseTo(1.2, 10);
        expect(bonus.tokuBonusRate).toBeCloseTo(0.02, 10);
        // floor(1000*1.2) + floor(1000*0.02) = 1200 + 20 = 1220
        expect(applyExpeditionBonus(1000, bonus)).toBe(1220);
    });

    it('每個資材各自獨立 floor，小數不會互相污染', () => {
        const bonus = computeExpeditionBonus(gears({ mst: NAIKATEI, level: 3 }));
        expect(applyExpeditionBonus(33, bonus)).toBe(Math.floor(33 * bonus.multiplier));
    });
});

describe('collectLandingCraftGears', () => {
    it('只收計入加成的裝備，忽略無關裝備與空槽', () => {
        const slotItems = new Map<number, { mst: number; level: number }>([
            [101, { mst: DAIHATSU, level: 2 }],
            [102, { mst: UNRELATED_MST, level: 0 }],
            [103, { mst: NAIKATEI, level: 0 }],
        ]);
        const ships = [
            { api_slot: [101, 102, -1] },
            { api_slot: [103] },
            { api_slot: undefined as unknown as number[] },
        ];
        const result = collectLandingCraftGears(ships, slotItems);
        expect(result).toEqual([
            { mst: DAIHATSU, level: 2 },
            { mst: NAIKATEI, level: 0 },
        ]);
    });
});

describe('LANDING_CRAFT_BASE_BONUS', () => {
    it('八種裝備的基礎加成率與 master id 對照（samples/start2-master.json 實測）', () => {
        expect(LANDING_CRAFT_BASE_BONUS[68]).toBeCloseTo(0.05, 10);
        expect(LANDING_CRAFT_BASE_BONUS[166]).toBeCloseTo(0.02, 10);
        expect(LANDING_CRAFT_BASE_BONUS[193]).toBeCloseTo(0.05, 10);
        expect(LANDING_CRAFT_BASE_BONUS[409]).toBeCloseTo(0.03, 10);
        expect(LANDING_CRAFT_BASE_BONUS[167]).toBeCloseTo(0.01, 10);
        expect(LANDING_CRAFT_BASE_BONUS[408]).toBeCloseTo(0.02, 10);
        expect(LANDING_CRAFT_BASE_BONUS[525]).toBeCloseTo(0.04, 10);
        expect(LANDING_CRAFT_BASE_BONUS[526]).toBeCloseTo(0.05, 10);
    });
});
