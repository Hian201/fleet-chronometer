// 改造目標：路徑、消耗與庫存分配。master 取自 samples/start2-master.json（真實 start2 子集）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { SHIP_EXP_TOTAL } from '../utils/remodel-cost-data';
import {
    goalsFromRows, goalsToRows, planRemodelGoals, remodelPath, remodelStep, remodelStockOf, remodelTargets,
    type GoalShip,
} from '../utils/remodel-goals';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const state = new GameState();
state.applyEvent('api_start2/getData', master.api_data ?? master);

const YAMATO = 131, YAMATO_KAI = 136, YAMATO_K2 = 911, YAMATO_K2J = 916;
const ISE_KAI = 82, ISE_K2 = 553;
const SUZUYA_KAI = 129, SUZUYA_K2 = 503, SUZUYA_KOU_K2 = 508;

describe('remodelStep', () => {
    it('大和改→大和改二：道具取自 shipupgrade，彈藥鋼材取自 mst_ship', () => {
        expect(remodelStep(state, YAMATO_KAI)).toEqual({
            from: YAMATO_KAI, to: YAMATO_K2, level: 88,
            // 用了設計圖 → 通則下不耗開發資材；gunMat 來自例外表
            cost: { ammo: 9900, steel: 9800, blueprint: 3, report: 1, boiler: 2, gunMat: 3 },
        });
    });

    it('伊勢改→伊勢改二：例外表的開發資材優先於「用設計圖不耗」的通則', () => {
        expect(remodelStep(state, ISE_KAI)?.cost).toEqual({
            ammo: 4800, steel: 7200, blueprint: 2, catapult: 1, report: 1, devmat: 80,
        });
    });

    it('鈴谷改二→航改二：用了設計圖仍依鋼材量耗開發資材（例外艦）', () => {
        // 鋼材 4700 落在 4500–5499 → 10
        expect(remodelStep(state, SUZUYA_K2)?.cost).toMatchObject({ blueprint: 1, steel: 4700, devmat: 10, torch: 20 });
    });

    it('最終形態與未知 id 回傳 null', () => {
        expect(remodelStep(state, 999999)).toBeNull();
        const final = [...state.master].find(([, ship]) => ship.afterShipId === 0)![0];
        expect(remodelStep(state, final)).toBeNull();
    });
});

describe('remodelTargets／remodelPath', () => {
    it('可逆改裝的環上每個形態各出現一次', () => {
        expect(remodelTargets(state, YAMATO)).toEqual([YAMATO_KAI, YAMATO_K2, YAMATO_K2J]);
        expect(remodelTargets(state, SUZUYA_K2)).toEqual([SUZUYA_KOU_K2]);
    });

    it('路徑逐段列出；到不了的形態為 null', () => {
        expect(remodelPath(state, YAMATO, YAMATO_K2)?.map(step => step.to)).toEqual([YAMATO_KAI, YAMATO_K2]);
        expect(remodelPath(state, YAMATO_K2, YAMATO_K2)).toEqual([]);
        expect(remodelPath(state, YAMATO_K2, ISE_K2)).toBeNull();
        expect(remodelPath(state, SUZUYA_KOU_K2, SUZUYA_KAI)).toBeNull();
    });
});

describe('planRemodelGoals', () => {
    const ships = new Map<number, GoalShip>([
        [1, { id: 1, masterId: YAMATO, lv: 70, exp: SHIP_EXP_TOTAL[70] }],
        [2, { id: 2, masterId: ISE_KAI, lv: 90, exp: SHIP_EXP_TOTAL[90] }],
        [3, { id: 3, masterId: ISE_K2, lv: 99, exp: 1000000 }],
    ]);

    it('多段改造加總消耗，等級取各段最大值，經驗差以累計表計算', () => {
        const { plans } = planRemodelGoals(state, [{ shipId: 1, targetMst: YAMATO_K2 }], ships, {});
        const [plan] = plans;
        expect(plan.status).toBe('active');
        expect(plan.level).toEqual({ need: 88, have: 70, gap: 18, expGap: SHIP_EXP_TOTAL[88] - SHIP_EXP_TOTAL[70] });
        // 大和→改 2500／3000，改→改二 9900／9800
        expect(plan.lines.find(line => line.key === 'ammo')).toMatchObject({ need: 12400, available: null, short: null });
        expect(plan.lines.find(line => line.key === 'steel')?.need).toBe(12800);
        expect(plan.lines.find(line => line.key === 'gunMat')).toMatchObject({ need: 3, estimated: true });
        expect(plan.lines.find(line => line.key === 'blueprint')?.estimated).toBe(false);
    });

    it('庫存依目標順序分配，後面的目標只看得到剩餘量', () => {
        const goals = [{ shipId: 1, targetMst: YAMATO_K2 }, { shipId: 2, targetMst: ISE_K2 }];
        const { plans, totals } = planRemodelGoals(state, goals, ships, { blueprint: 4, report: 5 });
        const line = (index: number, key: string) => plans[index].lines.find(l => l.key === key);
        expect(line(0, 'blueprint')).toMatchObject({ need: 3, available: 4, short: 0 });
        expect(line(1, 'blueprint')).toMatchObject({ need: 2, available: 1, short: 1 });
        expect(line(1, 'report')).toMatchObject({ need: 1, available: 4, short: 0 });
        // 沒給庫存的項目是不可考，不是缺
        expect(line(1, 'catapult')).toMatchObject({ need: 1, available: null, short: null });
        expect(totals.find(t => t.key === 'blueprint')).toMatchObject({ need: 5, stock: 4, short: 1 });
        expect(plans[1].level).toMatchObject({ gap: 0, expGap: 0 });
    });

    it('已達成、艦不在名冊、到不了的目標不佔庫存', () => {
        const goals = [
            { shipId: 3, targetMst: ISE_K2 }, { shipId: 99, targetMst: ISE_K2 },
            { shipId: 3, targetMst: YAMATO_K2 }, { shipId: 2, targetMst: ISE_K2 },
        ];
        const { plans } = planRemodelGoals(state, goals, ships, { blueprint: 2 });
        expect(plans.map(plan => plan.status)).toEqual(['done', 'ship-missing', 'no-path', 'active']);
        expect(plans[3].lines.find(line => line.key === 'blueprint')).toMatchObject({ available: 2, short: 0 });
    });
});

describe('資料列轉換與庫存來源', () => {
    it('目標與資料列互轉：順序存成 order，讀回時依 order 排並丟棄重複艦', () => {
        const goals = [{ shipId: 5, targetMst: 911 }, { shipId: 7, targetMst: 553 }];
        const rows = goalsToRows(goals);
        expect(rows).toEqual([
            { key: 'remodel:5', kind: 'remodel', order: 0, shipId: 5, targetMst: 911 },
            { key: 'remodel:7', kind: 'remodel', order: 1, shipId: 7, targetMst: 553 },
        ]);
        expect(goalsFromRows([...rows].reverse())).toEqual(goals);
        expect(goalsFromRows([
            { kind: 'remodel', order: 2, shipId: 5, targetMst: 916 }, { kind: 'other', order: 0, shipId: 9, targetMst: 1 },
            { kind: 'remodel', order: 1, shipId: 5, targetMst: 911 },
        ])).toEqual([{ shipId: 5, targetMst: 911 }]);
    });

    it('remodelStockOf 把資材、道具與裝備對到各消耗項；未收到封包維持 null', () => {
        const stock = remodelStockOf({
            materialCount: id => ({ 2: 300000, 3: 250000, 5: 1500, 7: 725, 8: 130 } as Record<number, number>)[id] ?? null,
            useItemCount: id => (id === 58 ? 4 : null),
            slotItemCountByJapaneseName: name => (name === '新型高温高圧缶' ? 6 : null),
        });
        expect(stock).toMatchObject({
            ammo: 300000, steel: 250000, torch: 1500, devmat: 725, screw: 130, blueprint: 4, boiler: 6, report: null,
        });
    });

    it('經驗表與 wikiwiki「経験値」頁抽驗一致', () => {
        expect([SHIP_EXP_TOTAL[50], SHIP_EXP_TOTAL[88], SHIP_EXP_TOTAL[98], SHIP_EXP_TOTAL[99]])
            .toEqual([122500, 509000, 851500, 1000000]);
    });
});
