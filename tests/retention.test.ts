import { describe, expect, it } from 'vitest';
import type { ReplayRow, ShipObtainedRow, SortieLogRow } from '../utils/db';
import {
    computePrunableKeys,
    DEFAULT_RETENTION,
    firstOwnedDropKeys,
    planRetention,
    prunableSortieKeys,
    type RetentionConfig,
} from '../utils/retention';

const DAY = 86_400_000;

function sortie(overrides: Partial<SortieLogRow> & Pick<SortieLogRow, 'eventId' | 'sortieKey'>): SortieLogRow {
    return {
        ts: overrides.eventId,
        map: '1-1',
        node: 1,
        boss: false,
        kind: 'battle',
        rank: 'S',
        seiku: null,
        enemyIds: [],
        enemyIdsEscort: [],
        drop: null,
        taiha: false,
        ...overrides,
    };
}

function obtained(overrides: Partial<ShipObtainedRow> & Pick<ShipObtainedRow, 'id' | 'mst'>): ShipObtainedRow {
    return { obtainedTs: null, source: null, ...overrides };
}

function replay(sortieKey: number, ts: number, overrides: Partial<ReplayRow> = {}): ReplayRow {
    return {
        sortieKey,
        ts,
        world: 1,
        mapnum: 1,
        diff: 0,
        combined: 0,
        fleetnum: 1,
        fleet1: [],
        fleet2: [],
        battles: [],
        ...overrides,
    };
}

describe('firstOwnedDropKeys', () => {
    it('最早同 master ID 紀錄是 baseline 時，後續 auto 重複取得不算新船', () => {
        const keys = firstOwnedDropKeys(
            [sortie({ eventId: 20, sortieKey: 2, dropMst: 124, drop: '鈴谷' })],
            [
                obtained({ id: 102, mst: 124, source: 'auto', observedEventId: 21 }),
                obtained({ id: 101, mst: 124, source: null, observedEventId: 10 }),
            ],
        );

        expect([...keys]).toEqual([]);
    });

    it.each([
        ['manual', 'manual' as const],
        ['unknown', undefined],
        ['baseline-like source', 'baseline' as any],
    ])('最早來源為 %s 時不給 newShip', (_label, source) => {
        const keys = firstOwnedDropKeys(
            [sortie({ eventId: 20, sortieKey: 2, dropMst: 124 })],
            [obtained({ id: 101, mst: 124, source, observedEventId: 21 })],
        );

        expect([...keys]).toEqual([]);
    });

    it('auto 首次觀測只關聯 observation 前最近的相同 master-ID battle-result', () => {
        const keys = firstOwnedDropKeys([
            sortie({ eventId: 10, sortieKey: 1, dropMst: 124, drop: 'Suzuya' }),
            sortie({ eventId: 20, sortieKey: 2, dropMst: 124, drop: '鈴谷' }),
            sortie({ eventId: 24, sortieKey: 3, dropMst: 125, drop: '鈴谷' }),
            sortie({ eventId: 25, sortieKey: 4, dropMst: 124, drop: '任意顯示名' }),
            sortie({ eventId: 26, sortieKey: 5, dropMst: 124, drop: '任意顯示名' }),
        ], [
            obtained({ id: 101, mst: 124, source: 'auto', observedEventId: 25 }),
        ]);

        expect([...keys]).toEqual([2]);
    });

    it.each([
        ['sortie 缺 dropMst', [sortie({ eventId: 20, sortieKey: 2, drop: '鈴谷' })], [obtained({ id: 101, mst: 124, source: 'auto', observedEventId: 21 })]],
        ['observation 缺 event ID', [sortie({ eventId: 20, sortieKey: 2, dropMst: 124 })], [obtained({ id: 101, mst: 124, source: 'auto' })]],
        ['沒有相符 master ID', [sortie({ eventId: 20, sortieKey: 2, dropMst: 125 })], [obtained({ id: 101, mst: 124, source: 'auto', observedEventId: 21 })]],
        ['只有相等或更晚結果', [sortie({ eventId: 21, sortieKey: 2, dropMst: 124 }), sortie({ eventId: 22, sortieKey: 3, dropMst: 124 })], [obtained({ id: 101, mst: 124, source: 'auto', observedEventId: 21 })]],
    ] as const)('%s 時不猜測新船關聯', (_label, sorties, observations) => {
        expect([...firstOwnedDropKeys([...sorties], [...observations])]).toEqual([]);
    });
});

describe('planRetention', () => {
    it('維持既有保護理由優先序、最近天數、保底場數與裁剪政策', () => {
        const now = 200 * DAY;
        const replays = [
            replay(1, now - 100 * DAY, { pinned: true }),
            replay(2, now - 100 * DAY),
            replay(3, now - 100 * DAY),
            replay(4, now - 100 * DAY, { diff: 2 }),
            replay(5, now - 100 * DAY, { mapnum: 5 }),
            replay(6, now - DAY),
            replay(7, now - 70 * DAY),
            replay(8, now - 60 * DAY),
        ];
        const sorties = [
            sortie({ eventId: 20, sortieKey: 2, dropMst: 124 }),
            sortie({ eventId: 30, sortieKey: 3, cleared: true }),
            sortie({ eventId: 40, sortieKey: 4, boss: true }),
        ];
        const observations = [
            obtained({ id: 101, mst: 124, source: 'auto', observedEventId: 21 }),
        ];
        const cfg: RetentionConfig = { ...DEFAULT_RETENTION, keepRecentCount: 2 };

        const decisions = planRetention(replays, sorties, observations, new Set(['1-5']), cfg, now);
        const byKey = new Map(decisions.map(decision => [decision.sortieKey, decision]));

        expect(byKey.get(1)).toMatchObject({ keep: true, reason: 'pinned' });
        expect(byKey.get(2)).toMatchObject({ keep: true, reason: 'newShip' });
        expect(byKey.get(3)).toMatchObject({ keep: true, reason: 'cleared' });
        expect(byKey.get(4)).toMatchObject({ keep: true, reason: 'eventBoss' });
        expect(byKey.get(5)).toMatchObject({ keep: true, reason: 'uncleared' });
        expect(byKey.get(6)).toMatchObject({ keep: true, reason: 'recent' });
        expect(byKey.get(7)).toEqual({ sortieKey: 7, keep: false, reason: null });
        expect(byKey.get(8)).toMatchObject({ keep: true, reason: 'recent' });
    });

    it('舊 sortie／舊 backup row 缺少新欄位時可讀取，但不給 newShip', () => {
        const oldSortie = sortie({ eventId: 20, sortieKey: 2, drop: '鈴谷' });
        const oldObservation = obtained({ id: 101, mst: 124, source: 'auto' });
        const cfg = { ...DEFAULT_RETENTION, keepRecentDays: 0, keepRecentCount: 0 };

        expect(planRetention(
            [replay(2, 1)],
            [oldSortie],
            [oldObservation],
            new Set(),
            cfg,
            100 * DAY,
        )).toEqual([{ sortieKey: 2, keep: false, reason: null }]);
    });

    it('prunableSortieKeys／computePrunableKeys：釘選後不再出現在可刪清單', () => {
        const now = 200 * DAY;
        const cfg = { ...DEFAULT_RETENTION, keepRecentDays: 0, keepRecentCount: 0 };
        const sorties: SortieLogRow[] = [];
        const obtainedRows: ShipObtainedRow[] = [];
        const uncleared = new Set<string>();

        const before = computePrunableKeys(
            [replay(7, now - 70 * DAY), replay(8, now - 60 * DAY)],
            sorties, obtainedRows, uncleared, cfg, now,
        );
        expect(before.sort()).toEqual([7, 8]);
        expect(prunableSortieKeys(planRetention(
            [replay(7, now - 70 * DAY), replay(8, now - 60 * DAY)],
            sorties, obtainedRows, uncleared, cfg, now,
        )).sort()).toEqual([7, 8]);

        // 模擬確認框期間另一分頁釘選 sortieKey=7
        const afterPin = computePrunableKeys(
            [replay(7, now - 70 * DAY, { pinned: true }), replay(8, now - 60 * DAY)],
            sorties, obtainedRows, uncleared, cfg, now,
        );
        expect(afterPin).toEqual([8]);
    });
});
