import { describe, expect, it } from 'vitest';
import {
    LEDGER_MATS, buildMaterialLedger, catalogQuestReward, countRecordsAfter, remodelCostResolver,
    type LedgerInputs, type LedgerMat, type MaterialLedger,
} from '../utils/material-ledger';
import { QUEST_CATALOG_BY_NO } from '../utils/quest-flow';
import { materialQuantity } from '../utils/quest-material-income';
import type { Sample } from '../utils/resource-log';

/** 八項餘額：只有 4–7 有意義，前四項固定 0。 */
const sample = (ts: number, torch: number, bucket: number, dev: number, screw: number): Sample =>
    ({ ts, m: [0, 0, 0, 0, torch, bucket, dev, screw] });
/** 工廠消耗：索引 4–7。 */
const used = (torch = 0, bucket = 0, dev = 0, screw = 0) => [0, 0, 0, 0, torch, bucket, dev, screw];

const base = (over: Partial<LedgerInputs> = {}): LedgerInputs => ({
    samples: [], factory: [], expeditions: [], questClears: [], questReward: () => 0,
    materialUse: [], remodelCost: () => null, ...over,
});
const rowOf = (ledger: MaterialLedger, mat: LedgerMat) => ledger.rows.find(row => row.mat === mat)!;

/** 每個案例都必須成立的恆等式。 */
function expectIdentity(ledger: MaterialLedger) {
    expect(ledger.rows.map(row => row.mat)).toEqual([...LEDGER_MATS]);
    for (const row of ledger.rows) {
        const income = row.income.quest + row.income.expedition;
        const spending = Object.values(row.spending).reduce((a, b) => a + b, 0);
        expect(row.opening + income - spending + row.unattributed).toBe(row.closing);
    }
}

describe('離散資材分帳', () => {
    it('四種資材的工廠各去向、遠征與任務收入都落在正確的列', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 10, 20, 30, 40), sample(900, 12, 25, 33, 48)],
            factory: [
                { ts: 200, kind: 'develop', used: used(0, 0, 1, 0) },
                { ts: 300, kind: 'build', used: used(1, 0, 1, 0) },
                { ts: 400, kind: 'improve', used: used(0, 0, 2, 3) },
                { ts: 500, kind: 'speedup', used: used(2, 0, 0, 0) },
            ],
            // useitem id 1→高速修復材、2→高速建造材、3→開発資材、4→改修資材
            expeditions: [{ ts: 600, items: [{ id: 1, count: 2 }, { id: 2, count: 1 }, { id: 3, count: 1 }, { id: 4, count: 1 }] }],
            questClears: [{ ts: 700, questNo: 1 }],
            questReward: (_no, _ts, mat) => ({ 7: 5, 6: 4, 5: 3, 4: 2 })[mat],
        }), 100, 900)!;
        expect(ledger).not.toBeNull();
        expectIdentity(ledger);
        expect(ledger.counts).toEqual({ factory: 4, expeditions: 1, questClears: 1, questUnknown: 0, materialUse: 0, remodelUnknown: 0 });
        const screw = rowOf(ledger, 7), dev = rowOf(ledger, 6), bucket = rowOf(ledger, 5), torch = rowOf(ledger, 4);
        expect(screw).toMatchObject({ opening: 40, closing: 48, income: { quest: 5, expedition: 1 }, spending: { develop: 0, build: 0, improve: 3, speedup: 0, dock: 0, remodel: 0 } });
        expect(dev).toMatchObject({ opening: 30, closing: 33, income: { quest: 4, expedition: 1 }, spending: { develop: 1, build: 1, improve: 2, speedup: 0, dock: 0, remodel: 0 } });
        expect(bucket).toMatchObject({ opening: 20, closing: 25, income: { quest: 3, expedition: 2 }, spending: { develop: 0, build: 0, improve: 0, speedup: 0, dock: 0, remodel: 0 } });
        expect(torch).toMatchObject({ opening: 10, closing: 12, income: { quest: 2, expedition: 1 }, spending: { develop: 0, build: 1, improve: 0, speedup: 2, dock: 0, remodel: 0 } });
        // 改修資材：40 + 6 − 3 = 43，實際 48 → 未歸因 +5
        expect(screw.unattributed).toBe(5);
    });

    it('期初時刻的事件不算、期末時刻的事件算（三種來源同一條規則）', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 0, 0, 10, 10), sample(200, 0, 0, 10, 10)],
            factory: [
                { ts: 100, kind: 'develop', used: used(0, 0, 1, 0) },
                { ts: 200, kind: 'build', used: used(0, 0, 2, 0) },
                { ts: 201, kind: 'build', used: used(0, 0, 4, 0) },
            ],
            expeditions: [{ ts: 100, items: [{ id: 3, count: 10 }] }, { ts: 200, items: [{ id: 3, count: 20 }] }],
            questClears: [{ ts: 100, questNo: 1 }, { ts: 200, questNo: 2 }],
            questReward: (no, _ts, mat) => (mat === 6 ? no * 100 : 0),
        }), 100, 200)!;
        expectIdentity(ledger);
        const dev = rowOf(ledger, 6);
        expect(dev.spending).toEqual({ develop: 0, build: 2, improve: 0, speedup: 0, dock: 0, remodel: 0 });
        expect(dev.income).toEqual({ quest: 200, expedition: 20 });
        expect(ledger.counts).toEqual({ factory: 1, expeditions: 1, questClears: 1, questUnknown: 0, materialUse: 0, remodelUnknown: 0 });
    });

    it('沒有樣本、只有一筆樣本、期末不晚於期初都回 null', () => {
        expect(buildMaterialLedger(base(), 0, 1000)).toBeNull();
        expect(buildMaterialLedger(base({ samples: [sample(100, 1, 1, 1, 1)] }), 0, 1000)).toBeNull();
        // 期間內只有同一筆樣本：期初與期末同時刻
        expect(buildMaterialLedger(base({ samples: [sample(500, 1, 1, 1, 1), sample(2000, 1, 1, 1, 1)] }), 400, 1000)).toBeNull();
        // 期末之前沒有任何樣本
        expect(buildMaterialLedger(base({ samples: [sample(2000, 1, 1, 1, 1), sample(3000, 1, 1, 1, 1)] }), 0, 1000)).toBeNull();
    });

    it('期初之前已有樣本時取 sampleAt；之前沒有則取期間內第一筆', () => {
        const samples = [sample(50, 1, 1, 1, 1), sample(80, 2, 2, 2, 2), sample(300, 5, 5, 5, 5)];
        const early = buildMaterialLedger(base({
            samples,
            factory: [{ ts: 60, kind: 'develop', used: used(0, 0, 1, 0) }, { ts: 90, kind: 'develop', used: used(0, 0, 1, 0) }],
        }), 100, 300)!;
        expect(early.fromTs).toBe(80);
        expect(rowOf(early, 6).opening).toBe(2);
        // ts 60 在期初樣本（80）之前，不算；ts 90 算
        expect(early.counts.factory).toBe(1);
        expectIdentity(early);

        const late = buildMaterialLedger(base({ samples }), 60, 300)!;
        expect(late.fromTs).toBe(50);
        const first = buildMaterialLedger(base({ samples: [sample(150, 7, 7, 7, 7), sample(300, 9, 9, 9, 9)] }), 100, 300)!;
        expect(first.fromTs).toBe(150);
        expect(rowOf(first, 4).opening).toBe(7);
    });

    it('未知的 useitem id 被忽略，缺項的 used 當 0', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 5, 5, 5, 5), sample(200, 5, 5, 5, 5)],
            expeditions: [{ ts: 150, items: [{ id: 10, count: 9 }, { id: 0, count: 9 }, { id: 5, count: 9 }] }],
            factory: [{ ts: 150, kind: 'improve', used: [0, 0, 0, 0] }],
        }), 100, 200)!;
        expectIdentity(ledger);
        expect(ledger.counts).toMatchObject({ factory: 1, expeditions: 1 });
        for (const row of ledger.rows) {
            expect(row.income).toEqual({ quest: 0, expedition: 0 });
            expect(row.spending).toEqual({ develop: 0, build: 0, improve: 0, speedup: 0, dock: 0, remodel: 0 });
            expect(row.unattributed).toBe(0);
        }
    });

    it('questReward 回 null 時不加收入，每筆領獎最多記一次不明', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 0, 0, 0, 0), sample(500, 0, 0, 0, 0)],
            questClears: [{ ts: 200, questNo: 1 }, { ts: 300, questNo: 2 }],
            questReward: (no, _ts, mat) => (no === 1 ? null : mat === 7 ? 3 : 0),
        }), 100, 500)!;
        expectIdentity(ledger);
        expect(ledger.counts).toMatchObject({ questClears: 2, questUnknown: 1 });
        expect(rowOf(ledger, 7).income.quest).toBe(3);
    });

    it('入渠用桶落在高速修復材的 dock，每筆 1 個', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 0, 10, 0, 0), sample(500, 0, 7, 0, 0)],
            materialUse: [
                { eventId: 1, ts: 200, kind: 'bucket', via: 'start' },
                { eventId: 2, ts: 300, kind: 'bucket', via: 'speedchange' },
            ],
        }), 100, 500)!;
        expectIdentity(ledger);
        expect(ledger.counts).toMatchObject({ materialUse: 2, remodelUnknown: 0 });
        expect(rowOf(ledger, 5).spending.dock).toBe(2);
        expect(rowOf(ledger, 5).unattributed).toBe(-1);
        expect(rowOf(ledger, 6).spending.dock).toBe(0);
    });

    it('改造用注入的 resolver 落到三種資材的 remodel', () => {
        const seen: number[] = [];
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 600, 0, 100, 10), sample(500, 50, 0, 45, 10)],
            materialUse: [{ eventId: 1, ts: 200, kind: 'remodel', shipId: 7, fromMst: 119 }],
            remodelCost: from => { seen.push(from); return { devmat: 55, torch: 550, screw: 0 }; },
        }), 100, 500)!;
        expectIdentity(ledger);
        expect(seen).toEqual([119]);
        expect(rowOf(ledger, 6).spending.remodel).toBe(55);
        expect(rowOf(ledger, 4).spending.remodel).toBe(550);
        expect(rowOf(ledger, 7).spending.remodel).toBe(0);
        expect(rowOf(ledger, 6).unattributed).toBe(0);
        expect(rowOf(ledger, 4).unattributed).toBe(0);
    });

    it('resolver 回 null：計 remodelUnknown，不計入任何去向', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 0, 0, 10, 0), sample(500, 0, 0, 10, 0)],
            materialUse: [
                { eventId: 1, ts: 200, kind: 'remodel', shipId: 7, fromMst: 1 },
                { eventId: 2, ts: 300, kind: 'bucket', via: 'start' },
            ],
        }), 100, 500)!;
        expectIdentity(ledger);
        expect(ledger.counts).toMatchObject({ materialUse: 2, remodelUnknown: 1 });
        expect(rowOf(ledger, 6).spending.remodel).toBe(0);
        expect(rowOf(ledger, 5).spending.dock).toBe(1);
    });

    it('materialUse 的邊界：期初那刻不算、期末那刻算', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 0, 5, 0, 0), sample(200, 0, 5, 0, 0)],
            materialUse: [
                { eventId: 1, ts: 100, kind: 'bucket', via: 'start' },
                { eventId: 2, ts: 200, kind: 'bucket', via: 'start' },
                { eventId: 3, ts: 201, kind: 'bucket', via: 'start' },
            ],
        }), 100, 200)!;
        expectIdentity(ledger);
        expect(rowOf(ledger, 5).spending.dock).toBe(1);
        expect(ledger.counts.materialUse).toBe(1);
    });

    it('工廠 used 只取該動作會消耗的資材：develop 帶桶與高速建造材的差額不計入', () => {
        const ledger = buildMaterialLedger(base({
            // used 索引 4（高速建造材）＝2、索引 5（桶）＝1：develop 不消耗這兩項
            samples: [sample(100, 5, 5, 5, 5), sample(200, 3, 4, 4, 5)],
            factory: [{ ts: 150, kind: 'develop', used: used(2, 1, 1, 0) }],
        }), 100, 200)!;
        expectIdentity(ledger);
        expect(rowOf(ledger, 4).spending.develop).toBe(0);
        expect(rowOf(ledger, 5).spending.develop).toBe(0);
        expect(rowOf(ledger, 6).spending.develop).toBe(1);
        expect(rowOf(ledger, 4).unattributed).toBe(-2);
        expect(rowOf(ledger, 5).unattributed).toBe(-1);
    });

    it('各工廠動作的消耗過濾：improve 取 6、7，build 取 4、6，speedup 只取 4', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 0, 0, 0, 0), sample(200, 0, 0, 0, 0)],
            factory: [
                { ts: 110, kind: 'improve', used: used(1, 1, 1, 1) },
                { ts: 120, kind: 'build', used: used(1, 1, 1, 1) },
                { ts: 130, kind: 'speedup', used: used(1, 1, 1, 1) },
            ],
        }), 100, 200)!;
        expectIdentity(ledger);
        const only = (mat: LedgerMat) => Object.entries(rowOf(ledger, mat).spending).filter(([, n]) => n > 0).map(([k]) => k).sort();
        expect(only(7)).toEqual(['improve']);
        expect(only(6)).toEqual(['build', 'improve']);
        expect(only(5)).toEqual([]);
        expect(only(4)).toEqual(['build', 'speedup']);
    });

    it('未歸因可為負（支出多於餘額減少）', () => {
        const ledger = buildMaterialLedger(base({
            samples: [sample(100, 0, 0, 10, 0), sample(200, 0, 0, 5, 0)],
            factory: [{ ts: 150, kind: 'develop', used: used(0, 0, 2, 0) }],
        }), 100, 200)!;
        expectIdentity(ledger);
        // 10 − 2 = 8，實際 5 → 未歸因 −3
        expect(rowOf(ledger, 6).unattributed).toBe(-3);
    });
});

describe('countRecordsAfter', () => {
    it('只數嚴格晚於該時刻的工廠、遠征、任務領獎與入渠／改造紀錄', () => {
        const inputs = base({
            factory: [{ ts: 100, kind: 'develop', used: used() }, { ts: 201, kind: 'develop', used: used() }],
            expeditions: [{ ts: 200, items: [] }],
            questClears: [{ ts: 300, questNo: 1 }],
            materialUse: [
                { eventId: 1, ts: 250, kind: 'bucket', via: 'start' },
                { eventId: 2, ts: 260, kind: 'bucket', via: 'start' },
            ],
        });
        expect(countRecordsAfter(inputs, 200)).toBe(4);
        expect(countRecordsAfter(inputs, 300)).toBe(0);
    });
});

describe('catalogQuestReward', () => {
    // 目錄裡有確定改修資材報酬、非期間限定的定期任務。
    const weekly = [...QUEST_CATALOG_BY_NO.values()].find(def =>
        !def.limited && def.period === 'weekly' && materialQuantity(def.apiNo, '改修資材').fixed > 0)!;
    const ts = Date.UTC(2026, 10, 1);

    it('標題相符時回確定報酬數量', () => {
        const fixed = materialQuantity(weekly.apiNo, '改修資材').fixed;
        expect(fixed).toBeGreaterThan(0);
        const reward = catalogQuestReward(new Map([[weekly.apiNo, weekly.name]]));
        expect(reward(weekly.apiNo, ts, 7)).toBe(fixed);
        expect(reward(weekly.apiNo, ts, 6)).toBe(materialQuantity(weekly.apiNo, '開発資材').fixed);
    });

    it('擇一報酬不計入確定報酬', () => {
        const withChoice = [...QUEST_CATALOG_BY_NO.values()].find(def =>
            !def.limited && (['改修資材', '開発資材', '高速修復材', '高速建造材'] as const).some(name => materialQuantity(def.apiNo, name).choice > 0))!;
        const name = (['改修資材', '開発資材', '高速修復材', '高速建造材'] as const).find(n => materialQuantity(withChoice.apiNo, n).choice > 0)!;
        const mat = ({ 改修資材: 7, 開発資材: 6, 高速修復材: 5, 高速建造材: 4 } as const)[name];
        const reward = catalogQuestReward(new Map([[withChoice.apiNo, withChoice.name]]));
        expect(reward(withChoice.apiNo, ts, mat)).toBe(materialQuantity(withChoice.apiNo, name).fixed);
    });

    it('標題與目錄不符（營運重用編號）→ null', () => {
        const reward = catalogQuestReward(new Map([[weekly.apiNo, '完全不同的新任務']]));
        expect(reward(weekly.apiNo, ts, 7)).toBeNull();
    });

    it('沒有標題可核對：期間限定任務 → null，一般任務與有標題的限定任務照目錄', () => {
        const limited = QUEST_CATALOG_BY_NO.get(199)!; // 【期間限定任務】第三十一戦隊特務編成！，高速修復材 3
        expect(limited.limited).toBe(true);
        expect(materialQuantity(199, '高速修復材').fixed).toBe(3);
        const none = catalogQuestReward(new Map());
        expect(none(199, ts, 5)).toBeNull();
        expect(none(weekly.apiNo, ts, 7)).toBe(materialQuantity(weekly.apiNo, '改修資材').fixed);
        expect(catalogQuestReward(new Map([[199, limited.name]]))(199, ts, 5)).toBe(3);
    });

    it('目錄沒有的任務編號 → null', () => {
        expect(catalogQuestReward(new Map())(99999, ts, 7)).toBeNull();
    });
});

describe('remodelCostResolver', () => {
    const master = (afterShipId: number) => ({ afterLv: 80, afterShipId, afterAmmo: 0, afterSteel: 0 });

    it('從改造消耗表回開發資材、高速建造材、改修資材', () => {
        // 119 在 REMODEL_EXTRA_COST 為 { devmat: 55, torch: 550, arsenalMat: 5 }
        const resolve = remodelCostResolver({ master: new Map([[119, master(120)]]), remodelItems: new Map() });
        expect(resolve(119)).toEqual({ devmat: 55, torch: 550, screw: 0 });
    });

    it('master 沒有該艦或已是最終形態 → null', () => {
        const resolve = remodelCostResolver({ master: new Map([[119, master(0)]]), remodelItems: new Map() });
        expect(resolve(119)).toBeNull();
        expect(resolve(99999)).toBeNull();
    });
});
