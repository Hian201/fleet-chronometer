import { describe, expect, it } from 'vitest';
import type { MaterialUseRow, SortieBillRow } from '../utils/db';
import { attributeMaterialUse, groupBillRuns, mergeExtras } from '../utils/sortie-bill-attribution';

const bill = (sortieKey: number, ts: number, map: string, extra: Partial<SortieBillRow> = {}): SortieBillRow => ({
    sortieKey, ts, map,
    ships: [], payable: [100, 80, 20, 10], balanceDelta: [0, 0, 0, 0], specialDelta: null,
    planesLost: 0, estimated: false, damagedShipIds: [], lostShipIds: [],
    ...extra,
});

describe('高速修復材的歸屬', () => {
    it('歸給之前、damagedShipIds 含該艦、最近的一趟', () => {
        const bills = [
            bill(1, 100, '1-5', { damagedShipIds: [11] }),
            bill(2, 200, '1-5', { damagedShipIds: [11, 12] }),
            bill(3, 300, '1-5', { damagedShipIds: [12] }),
        ];
        const uses: MaterialUseRow[] = [
            { eventId: 10, ts: 350, kind: 'bucket', via: 'start', shipId: 11 },
            { eventId: 11, ts: 150, kind: 'bucket', via: 'speedchange', shipId: 11 },
            { eventId: 12, ts: 350, kind: 'bucket', via: 'start', shipId: 12 },
        ];
        const out = attributeMaterialUse(bills, uses);
        expect(out.get(1)?.buckets).toBe(1);
        expect(out.get(2)?.buckets).toBe(1);
        expect(out.get(3)?.buckets).toBe(1);
    });

    it('沒有 shipId、找不到受損的那一趟、或時間在所有帳單之前都不歸屬', () => {
        const bills = [bill(1, 100, '1-5', { damagedShipIds: [11] })];
        const uses: MaterialUseRow[] = [
            { eventId: 10, ts: 200, kind: 'bucket', via: 'start' },
            { eventId: 11, ts: 200, kind: 'bucket', via: 'start', shipId: 99 },
            { eventId: 12, ts: 50, kind: 'bucket', via: 'start', shipId: 11 },
            { eventId: 13, ts: 100, kind: 'bucket', via: 'start', shipId: 11 },
            { eventId: 14, ts: 200, kind: 'remodel', shipId: 11, fromMst: 1 },
        ];
        expect(attributeMaterialUse(bills, uses).size).toBe(0);
    });
});

describe('基地航空隊補充的歸屬', () => {
    it('歸給同一海域、之前最近的一趟；不同海域不算', () => {
        const bills = [bill(1, 100, '61-2'), bill(2, 200, '7-4'), bill(3, 300, '61-3')];
        const uses: MaterialUseRow[] = [
            { eventId: 10, ts: 250, kind: 'airSupply', areaId: 61, fuel: 30, bauxite: 50 },
            { eventId: 11, ts: 350, kind: 'airSupply', areaId: 61, fuel: 12, bauxite: null },
            { eventId: 12, ts: 360, kind: 'airSupply', areaId: 7, fuel: 6, bauxite: 15 },
            { eventId: 13, ts: 360, kind: 'airSupply', areaId: 6, fuel: 6, bauxite: 15 },
        ];
        const out = attributeMaterialUse(bills, uses);
        expect(out.get(1)?.air).toEqual({ rows: 1, fuel: 30, bauxite: 50, unknownRows: 0 });
        expect(out.get(3)?.air).toEqual({ rows: 1, fuel: 12, bauxite: null, unknownRows: 1 });
        expect(out.get(2)?.air).toEqual({ rows: 1, fuel: 6, bauxite: 15, unknownRows: 0 });
        expect(out.size).toBe(3);
    });

    it('不可考的值不當 0 加總：有值的才加，全部不可考時維持 null', () => {
        const bills = [bill(1, 100, '61-2')];
        const uses: MaterialUseRow[] = [
            { eventId: 10, ts: 200, kind: 'airSupply', areaId: 61, fuel: null, bauxite: null },
            { eventId: 11, ts: 210, kind: 'airSupply', areaId: 61, fuel: 9, bauxite: null },
        ];
        expect(attributeMaterialUse(bills, uses).get(1)?.air).toEqual({ rows: 2, fuel: 9, bauxite: null, unknownRows: 2 });
        expect(mergeExtras([
            { buckets: 1, air: { rows: 1, fuel: null, bauxite: 5, unknownRows: 1 } },
            undefined,
            { buckets: 2, air: null },
        ])).toEqual({ buckets: 3, air: { rows: 1, fuel: null, bauxite: 5, unknownRows: 1 } });
    });
});

describe('海域彙總', () => {
    const boss = (rank: string) => [
        { boss: false, kind: 'battle' as const, rank: 'S' },
        { boss: true, kind: 'battle' as const, rank },
    ];
    const road = [{ boss: false, kind: 'battle' as const, rank: 'S' }];

    it('Boss 到達與 rank 取自 db.sorties 同一趟的 boss 戰鬥列', () => {
        const [group] = groupBillRuns([
            { bill: bill(1, 100, '1-5'), rows: boss('S') },
            { bill: bill(2, 200, '1-5'), rows: boss('A') },
            { bill: bill(3, 300, '1-5', { balanceDelta: null, estimated: true }), rows: road },
        ]);
        expect(group.summary.runs).toBe(3);
        expect(group.summary.bossReaches).toBe(2);
        expect(group.summary.bossS).toBe(1);
        expect(group.summary.partial).toBe(true);
        expect(group.summary.estimated).toBe(true);
        expect(group.partialRuns).toBe(1);
        expect(group.lastTs).toBe(300);
    });

    it('活動海域依難度分開，期間外的趟不算，追加支出依組合計', () => {
        const groups = groupBillRuns([
            { bill: bill(1, 100, '61-3', { difficulty: 4 }), rows: boss('S'), extras: { buckets: 2, air: null } },
            { bill: bill(2, 200, '61-3', { difficulty: 4 }), rows: boss('S'), extras: { buckets: 1, air: null } },
            { bill: bill(3, 300, '61-3', { difficulty: 1 }), rows: boss('S') },
            { bill: bill(4, 50, '61-3', { difficulty: 4 }), rows: boss('S'), extras: { buckets: 5, air: null } },
        ], 100);
        expect(groups.map(group => group.key)).toEqual(['61-3|1', '61-3|4']);
        const hard = groups.find(group => group.difficulty === 4)!;
        expect(hard.summary.runs).toBe(2);
        expect(hard.extras.buckets).toBe(3);
        expect(groups.find(group => group.difficulty === 1)!.extras).toEqual({ buckets: 0, air: null });
    });
});
