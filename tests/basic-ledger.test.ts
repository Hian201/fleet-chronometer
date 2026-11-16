import { describe, expect, it } from 'vitest';
import { BASIC_MATS, buildBasicLedger, type BasicLedger, type BasicLedgerInputs, type BasicMat } from '../utils/basic-ledger';
import { catalogQuestBasicReward } from '../utils/material-ledger';
import { BASIC_HARD_CAP, estimateRegen, incomeAtCap, naturalCapOf } from '../utils/resource-cap';
import type { Sample } from '../utils/resource-log';

const MIN = 60_000;
const sample = (ts: number, fuel: number, ammo = 0, steel = 0, bauxite = 0): Sample =>
    ({ ts, m: [fuel, ammo, steel, bauxite, 0, 0, 0, 0] });

const base = (over: Partial<BasicLedgerInputs> = {}): BasicLedgerInputs => ({
    samples: [], hqLv: 100, factory: [], expeditions: [], questClears: [], questReward: () => 0,
    materialUse: [], remodelCost: () => null, sortieBills: [], ...over,
});
const rowOf = (ledger: BasicLedger, mat: BasicMat) => ledger.rows.find(row => row.mat === mat)!;
const bill = (ts: number, payable: [number, number, number, number], balanceDelta: [number, number, number, number] | null) =>
    ({ ts, payable, balanceDelta });

/** 每個案例都必須成立的恆等式。 */
function expectIdentity(ledger: BasicLedger) {
    expect(ledger.rows.map(row => row.mat)).toEqual([...BASIC_MATS]);
    for (const row of ledger.rows) {
        const income = row.income.quest + row.income.expedition;
        const spending = Object.values(row.spending).reduce((a, b) => a + b, 0);
        expect(row.opening + (row.regen ?? 0) + income + row.route - spending + row.unattributed).toBe(row.closing);
    }
}

describe('自然回復與上限', () => {
    it('自然回復上限＝司令部等級 × 250 + 750', () => {
        expect(naturalCapOf(1)).toBe(1_000);
        expect(naturalCapOf(120)).toBe(30_750);
    });

    it('每 3 分鐘燃彈鋼 +3、鋁土 +1，不足 3 分鐘的零頭不算', () => {
        const span = [sample(0, 1_000, 1_000, 1_000, 1_000), sample(61 * MIN, 0, 0, 0, 0)];
        // 61 分鐘 = 20 個 3 分鐘
        expect(estimateRegen(span, 0, 30_750).regen).toBe(60);
        expect(estimateRegen(span, 3, 30_750).regen).toBe(20);
    });

    it('回復量受兩端較低餘額距上限的空間限制', () => {
        // 較低的一端離上限 10：一天的 1,440 只能回復 10
        const span = [sample(0, 30_740), sample(24 * 60 * MIN, 30_745)];
        expect(estimateRegen(span, 0, 30_750)).toEqual({ regen: 10, stalled: 0 });
    });

    it('兩端都在上限以上時停擺，stalled 記下本來可以回復的量', () => {
        const span = [sample(0, 300_000), sample(24 * 60 * MIN, 310_000)];
        expect(estimateRegen(span, 0, 30_750)).toEqual({ regen: 0, stalled: 1_440 });
    });

    it('收入只在前後兩筆餘額都已達上限時算「落在已滿的資源上」', () => {
        const span = [sample(0, 349_000), sample(100, 350_000), sample(200, 350_000), sample(300, 340_000)];
        const events = [{ ts: 50, amount: 1_000 }, { ts: 150, amount: 2_000 }, { ts: 250, amount: 4_000 }, { ts: 300, amount: 8_000 }];
        // 50：前一筆未滿；150：前後都滿；250：後一筆已不滿；300：前一筆是 200（滿）、後一筆就是 300（不滿）
        expect(incomeAtCap(span, events, 0, BASIC_HARD_CAP)).toBe(2_000);
    });
});

describe('基本資源分帳', () => {
    it('各來源落在正確的列，恆等式成立', () => {
        const ledger = buildBasicLedger(base({
            samples: [sample(0, 20_000, 20_000, 20_000, 20_000), sample(60 * MIN, 21_000, 18_000, 17_000, 19_000)],
            factory: [
                { ts: 10 * MIN, kind: 'build', used: [30, 30, 30, 30, 0, 0, 0, 0] },
                { ts: 11 * MIN, kind: 'develop', used: [10, 10, 10, 10, 0, 0, 1, 0] },
                { ts: 12 * MIN, kind: 'speedup', used: [0, 0, 0, 0, 1, 0, 0, 0] },
            ],
            expeditions: [{ ts: 30 * MIN, resources: [100, 200, 300, 40] }, { ts: 40 * MIN, resources: [] }],
            questClears: [{ ts: 35 * MIN, questNo: 1 }],
            questReward: (_no, _ts, mat) => [10, 20, 30, 4][mat] as number,
            materialUse: [
                { eventId: 1, ts: 20 * MIN, kind: 'remodel', shipId: 5, fromMst: 7 },
                { eventId: 2, ts: 21 * MIN, kind: 'airSupply', areaId: 6, fuel: 50, bauxite: 60 },
                { eventId: 3, ts: 22 * MIN, kind: 'bucket', via: 'start' },
            ],
            remodelCost: () => ({ ammo: 200, steel: 300 }),
            sortieBills: [{
                ts: 5 * MIN, payable: [400, 500, 600, 70], balanceDelta: [-30, 5, 0, -7],
                support: [{ deckId: 2, payable: [100, 80, 0, 5], planesLost: 1, estimated: false }],
            }],
        }), 0, 60 * MIN)!;
        expectIdentity(ledger);
        expect(ledger.counts).toEqual({
            sorties: 1, routeUnknown: 0, factory: 2, expeditions: 2, questClears: 1, questUnknown: 0, remodelUnknown: 0, airSupplyUnknown: 0,
        });
        expect(rowOf(ledger, 0)).toMatchObject({
            opening: 20_000, closing: 21_000, regen: 60, route: -30,
            income: { quest: 10, expedition: 100 },
            spending: { sortie: 500, factory: 40, remodel: 0, airSupply: 50 },
        });
        expect(rowOf(ledger, 1).spending).toEqual({ sortie: 580, factory: 40, remodel: 200, airSupply: 0 });
        expect(rowOf(ledger, 2).spending).toEqual({ sortie: 600, factory: 40, remodel: 300, airSupply: 0 });
        expect(rowOf(ledger, 3)).toMatchObject({ regen: 20, route: -7, spending: { sortie: 75, factory: 40, remodel: 0, airSupply: 60 } });
        // 燃料：21,000 = 20,000 + 60 + 110 − 30 − 590 + 未歸因 → 1,450
        expect(rowOf(ledger, 0).unattributed).toBe(1_450);
    });

    it('期初時刻的事件不算、期末時刻的事件算', () => {
        const ledger = buildBasicLedger(base({
            samples: [sample(100, 1_000), sample(900, 1_100)],
            expeditions: [
                { ts: 100, resources: [1, 0, 0, 0] }, { ts: 900, resources: [10, 0, 0, 0] }, { ts: 901, resources: [100, 0, 0, 0] },
            ],
        }), 100, 900)!;
        expect(rowOf(ledger, 0).income.expedition).toBe(10);
        expect(ledger.counts.expeditions).toBe(1);
    });

    it('不可考的來源不以 0 頂替：出擊途中進出、任務報酬、改造消耗、基地補充都分開計數', () => {
        const ledger = buildBasicLedger(base({
            samples: [sample(0, 1_000), sample(60 * MIN, 1_000)],
            questClears: [{ ts: MIN, questNo: 1 }],
            questReward: (_no, _ts, mat) => (mat === 0 ? 5 : null),
            materialUse: [
                { eventId: 1, ts: 2 * MIN, kind: 'remodel', shipId: 5, fromMst: 7 },
                { eventId: 2, ts: 3 * MIN, kind: 'airSupply', areaId: 6, fuel: null, bauxite: 10 },
            ],
            sortieBills: [bill(4 * MIN, [1, 2, 3, 4], null)],
        }), 0, 60 * MIN)!;
        expectIdentity(ledger);
        expect(ledger.counts).toMatchObject({ routeUnknown: 1, questUnknown: 1, remodelUnknown: 1, airSupplyUnknown: 1 });
        expect(rowOf(ledger, 0).route).toBe(0);
        expect(rowOf(ledger, 3).spending.airSupply).toBe(10);
    });

    it('司令部等級未知時自然回復不可考（null），帳仍成立', () => {
        const ledger = buildBasicLedger(base({ hqLv: null, samples: [sample(0, 100), sample(MIN * 60, 200)] }), 0, 60 * MIN)!;
        expectIdentity(ledger);
        const row = rowOf(ledger, 0);
        expect(row).toMatchObject({ regen: null, naturalCap: null, stalledRegen: null, unattributed: 100 });
    });

    it('已達蓄積上限仍有收入：標出落在已滿資源上的收入；持有量超過上限不是錯誤', () => {
        const ledger = buildBasicLedger(base({
            samples: [sample(0, 350_000, 351_000), sample(60 * MIN, 350_000, 351_000)],
            expeditions: [{ ts: 30 * MIN, resources: [800, 0, 0, 0] }],
        }), 0, 60 * MIN)!;
        expectIdentity(ledger);
        expect(rowOf(ledger, 0).fullIncome).toBe(800);
        expect(rowOf(ledger, 1).closing).toBe(351_000);
        // 兩端都在自然回復上限以上：1 小時 20 個 3 分鐘 → 本來可以回復 60
        expect(rowOf(ledger, 0).stalledRegen).toBe(60);
    });

    it('期間內餘額取樣不足、或期末不晚於期初時回 null', () => {
        expect(buildBasicLedger(base({ samples: [sample(0, 1)] }), 0, 100)).toBeNull();
        expect(buildBasicLedger(base({ samples: [sample(50, 1), sample(60, 1)] }), 0, 40)).toBeNull();
    });
});

describe('任務的基本資源報酬', () => {
    it('取目錄的資源欄位；目錄沒有的任務編號不可信（null）', () => {
        const reward = catalogQuestBasicReward(new Map());
        expect(reward(102, Date.UTC(2026, 10, 1), 0)).toBe(30);   // 102 編成：燃彈鋼各 30
        expect(reward(102, Date.UTC(2026, 10, 1), 3)).toBe(0);
        expect(reward(999_999, Date.UTC(2026, 10, 1), 0)).toBeNull();
    });
});
