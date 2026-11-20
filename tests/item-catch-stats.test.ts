import { describe, expect, it } from 'vitest';
import type { SortieLogRow } from '../utils/db';
import { itemCatchStats } from '../utils/item-catch-stats';

const SAURY = 68;
const H = 3_600_000;
const NOW = 1_800_000_000_000;

let nextId = 1;
function row(over: Partial<SortieLogRow> & { useItemDrops?: number[] | undefined }): SortieLogRow {
    const id = nextId++;
    const base: SortieLogRow = {
        eventId: id, sortieKey: id, ts: NOW - 48 * H + id, map: '1-1', node: 1, boss: false,
        kind: 'battle', rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false,
    };
    const out = { ...base, ...over };
    // 沒指定＝已確認無道具；明確傳 undefined＝欄位缺席（不可考）。
    if (!('useItemDrops' in over)) out.useItemDrops = [];
    else if (over.useItemDrops === undefined) delete out.useItemDrops;
    return out;
}

const query = { itemId: SAURY, from: null, to: null, now: NOW };

describe('itemCatchStats', () => {
    it('分 S／A／其他，n 不含不可考，k 與條數分開', () => {
        const rows = [
            row({ rank: 'S', useItemDrops: [SAURY] }),
            row({ rank: 'S', useItemDrops: [] }),
            row({ rank: 'A', useItemDrops: [SAURY, SAURY] }),
            row({ rank: 'B', useItemDrops: [] }),
            row({ rank: 'S', useItemDrops: undefined }),
        ];
        const node = itemCatchStats(rows, query).areas[0].maps[0].nodes[0];
        expect(node.total).toEqual({ n: 4, k: 2, u: 1, caught: 3 });
        expect(node.byRank.S).toEqual({ n: 2, k: 1, u: 1, caught: 1 });
        expect(node.byRank.A).toEqual({ n: 1, k: 1, u: 0, caught: 2 });
        expect(node.byRank.other).toEqual({ n: 1, k: 0, u: 0, caught: 0 });
    });

    it('其他道具不算捕獲；從未捕獲的節點保留為 0', () => {
        const rows = [
            row({ node: 3, useItemDrops: [SAURY] }),
            row({ node: 5, useItemDrops: [69] }),
            row({ node: 5, useItemDrops: [] }),
        ];
        const nodes = itemCatchStats(rows, query).areas[0].maps[0].nodes;
        expect(nodes.map(n => [n.node, n.total.n, n.total.k])).toEqual([[3, 1, 1], [5, 2, 0]]);
    });

    it('首筆捕獲不改變節點分母', () => {
        const dry = [row({ node: 2 }), row({ node: 2 })];
        const before = itemCatchStats(dry, query).areas[0].maps[0].nodes[0].total;
        const after = itemCatchStats([...dry, row({ node: 2, useItemDrops: [SAURY] })], query)
            .areas[0].maps[0].nodes[0].total;
        expect(before).toEqual({ n: 2, k: 0, u: 0, caught: 0 });
        expect(after).toEqual({ n: 3, k: 1, u: 0, caught: 1 });
    });

    it('同大海域不同圖分開彙總，基地空襲不列入', () => {
        const rows = [
            row({ map: '3-3', useItemDrops: [SAURY] }),
            row({ map: '3-5', useItemDrops: [] }),
            row({ map: '3-5', kind: 'raid', rank: '', useItemDrops: undefined }),
            row({ map: '1-1', useItemDrops: [SAURY] }),
        ];
        const stats = itemCatchStats(rows, query);
        expect(stats.areas.map(a => a.area)).toEqual([1, 3]);
        const area3 = stats.areas[1];
        expect(area3.total).toEqual({ n: 2, k: 1, u: 0, caught: 1 });
        expect(area3.maps.map(m => [m.map, m.total.caught])).toEqual([['3-3', 1], ['3-5', 0]]);
        expect(stats.unknown).toBe(0);
    });

    it('一趟多個漁點：場數與趟數分計', () => {
        const rows = [
            row({ sortieKey: 100, node: 1, useItemDrops: [SAURY] }),
            row({ sortieKey: 100, node: 4, useItemDrops: [SAURY] }),
            row({ sortieKey: 200, node: 1, useItemDrops: [] }),
        ];
        const map = itemCatchStats(rows, query).areas[0].maps[0];
        expect(map.total.n).toBe(3);
        expect(map.sorties).toBe(2);
        expect(map.nodes.map(n => n.sorties)).toEqual([2, 1]);
    });

    it('連續無魚場數只計已知場次，另列其間的不可考', () => {
        const rows = [
            row({ useItemDrops: [SAURY] }),
            row({ rank: 'S', useItemDrops: [] }),
            row({ useItemDrops: undefined }),
            row({ rank: 'A', useItemDrops: [69] }),
            row({ rank: 'B', useItemDrops: [] }),
        ];
        expect(itemCatchStats(rows, query).areas[0].dryStreak).toEqual({ n: 3, s: 1, a: 1, u: 1 });
    });

    it('期間內沒有捕獲時沒有連續無魚起點', () => {
        const stats = itemCatchStats([row({}), row({})], query);
        expect(stats.areas[0].dryStreak).toBeNull();
        expect(stats.firstCatchTs).toBeNull();
        expect(stats.caught).toBe(0);
    });

    it('同時間依 event id 排序決定最後一場', () => {
        const ts = NOW - H;
        const rows = [
            row({ eventId: 901, ts, useItemDrops: [] }),
            row({ eventId: 900, ts, useItemDrops: [SAURY] }),
        ];
        expect(itemCatchStats(rows, query).areas[0].dryStreak).toEqual({ n: 1, s: 1, a: 0, u: 0 });
    });

    it('期間含端點；近 6／24 小時以截止時間為基準', () => {
        const to = NOW - 100 * H;
        const rows = [
            row({ ts: to - 30 * H, useItemDrops: [SAURY] }),
            row({ ts: to - 10 * H, useItemDrops: [SAURY] }),
            row({ ts: to - 2 * H, useItemDrops: [SAURY, SAURY] }),
            row({ ts: to, useItemDrops: [] }),
            row({ ts: to + 1, useItemDrops: [SAURY] }),
        ];
        const stats = itemCatchStats(rows, { ...query, from: to - 30 * H, to });
        const area = stats.areas[0];
        expect(stats.caught).toBe(4);
        expect(area.recent6h).toBe(2);
        expect(area.recent24h).toBe(3);
        expect(area.lastCatchTs).toBe(to - 2 * H);
        expect(area.lastBattleTs).toBe(to);
        expect(stats.observedFrom).toBe(to - 30 * H);
        expect(stats.observedTo).toBe(to);
    });

    it('只有不可考紀錄時不顯示成 0 次未命中', () => {
        const stats = itemCatchStats([row({ useItemDrops: undefined, imported: true })], query);
        expect(stats.unknown).toBe(1);
        expect(stats.areas[0].total).toEqual({ n: 0, k: 0, u: 1, caught: 0 });
        expect(stats.areas[0].dryStreak).toBeNull();
    });

    it('沒有紀錄時觀測區間為 null', () => {
        expect(itemCatchStats([], query)).toEqual({
            itemId: SAURY, caught: 0, firstCatchTs: null, lastCatchTs: null,
            observedFrom: null, observedTo: null, unknown: 0, areas: [],
        });
    });

    it('活動海域不列入', () => {
        const stats = itemCatchStats([
            row({ map: '62-5', useItemDrops: [SAURY] }),
            row({ map: '1-5', useItemDrops: [SAURY] }),
        ], query);
        expect(stats.areas.map(a => a.area)).toEqual([1]);
        expect(stats.caught).toBe(1);
    });
});
