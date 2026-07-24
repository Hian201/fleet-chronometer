// 遠征紀錄的期間彙總核心。重點在三件事：壞資料不得把整個期間的小計變成 NaN、
// 分組鍵是遠征編號（名稱會隨語言與改版變動）、回航道具只加總不解讀（語意未驗證）。
import { describe, expect, it } from 'vitest';
import type { ExpeditionRow } from '../utils/db';
import {
    filterByPeriod, groupByMission, sortStats, statsCsv, summarize,
} from '../utils/expedition-stats';

const HOUR = 3_600_000;

const exped = (over: Partial<ExpeditionRow> & { ts: number }): ExpeditionRow => ({
    eventId: over.ts,
    deckId: 2,
    missionId: 5,
    name: '海上護衛任務',
    result: 1,
    resources: [0, 200, 0, 0],
    items: [],
    ...over,
});

describe('filterByPeriod', () => {
    const rows = [exped({ ts: 100 }), exped({ ts: 200 }), exped({ ts: 300 })];

    it('兩端皆含端點', () => {
        expect(filterByPeriod(rows, 200, 300).map(r => r.ts)).toEqual([200, 300]);
        expect(filterByPeriod(rows, 100, 100).map(r => r.ts)).toEqual([100]);
    });

    it('null 代表該端不設限（「某天以後」也是一次輸入就問得出來）', () => {
        expect(filterByPeriod(rows, 200, null).map(r => r.ts)).toEqual([200, 300]);
        expect(filterByPeriod(rows, null, 200).map(r => r.ts)).toEqual([100, 200]);
        expect(filterByPeriod(rows, null, null)).toHaveLength(3);
    });
});

describe('summarize', () => {
    it('四資源逐項加總，並分開數成功／大成功／失敗', () => {
        const totals = summarize([
            exped({ ts: 1, result: 1, resources: [10, 20, 30, 40] }),
            exped({ ts: 2, result: 2, resources: [1, 2, 3, 4] }),
            exped({ ts: 3, result: 0, resources: [0, 0, 0, 0] }),
        ]);
        expect(totals.resources).toEqual([11, 22, 33, 44]);
        expect(totals.count).toBe(3);
        // 大成功也是成功——「跑了幾次」「成功幾次」「大成功幾次」是三個不同的問題
        expect(totals.success).toBe(2);
        expect(totals.great).toBe(1);
        expect(totals.fail).toBe(1);
    });

    it('缺欄或壞值當 0，不讓一筆髒資料把整個期間變成 NaN', () => {
        const totals = summarize([
            exped({ ts: 1, resources: [10] }),
            exped({ ts: 2, resources: [Number.NaN, 5, undefined as unknown as number, 7] }),
            exped({ ts: 3, resources: undefined as unknown as number[] }),
        ]);
        expect(totals.resources).toEqual([10, 5, 0, 7]);
        expect(totals.resources.every(Number.isFinite)).toBe(true);
    });

    it('回航道具依 id 彙總、不併入資源小計（語意未經真封包驗證）', () => {
        const totals = summarize([
            exped({ ts: 1, items: [{ id: 4, count: 2 }, { id: 1, count: 1 }] }),
            exped({ ts: 2, items: [{ id: 4, count: 3 }] }),
            exped({ ts: 3, items: undefined as unknown as { id: number; count: number }[] }),
        ]);
        expect(totals.items).toEqual([{ id: 1, count: 1 }, { id: 4, count: 5 }]);
        expect(totals.resources).toEqual([0, 600, 0, 0]);
    });

    it('空集合回全 0 而非 NaN，UI 才能照常畫出「這期間 0 次」', () => {
        const totals = summarize([]);
        expect(totals).toMatchObject({ count: 0, success: 0, great: 0, fail: 0 });
        expect(totals.resources).toEqual([0, 0, 0, 0]);
        expect(totals.items).toEqual([]);
    });
});

describe('groupByMission', () => {
    it('依遠征編號分組，名稱取最新一筆（改名後看得懂的是新名字）', () => {
        const stats = groupByMission([
            exped({ ts: 100, missionId: 5, name: '舊名' }),
            exped({ ts: 300, missionId: 5, name: '新名' }),
            exped({ ts: 200, missionId: 37, name: '東京急行' }),
        ]);
        const guard = stats.find(s => s.missionId === 5)!;
        expect(guard.count).toBe(2);
        expect(guard.name).toBe('新名');
        expect(guard.lastTs).toBe(300);
        expect(stats.find(s => s.missionId === 37)!.count).toBe(1);
    });

    it('編號為 0 的舊紀錄改以名稱分組，不全部塞進同一列 #0', () => {
        const stats = groupByMission([
            exped({ ts: 1, missionId: 0, name: '甲' }),
            exped({ ts: 2, missionId: 0, name: '乙' }),
            exped({ ts: 3, missionId: 0, name: '甲' }),
        ]);
        expect(stats).toHaveLength(2);
        expect(stats.find(s => s.name === '甲')!.count).toBe(2);
    });
});

describe('sortStats', () => {
    const stats = groupByMission([
        exped({ ts: 1 * HOUR, missionId: 5, name: 'B', resources: [0, 100, 0, 0] }),
        exped({ ts: 2 * HOUR, missionId: 5, name: 'B', resources: [0, 100, 0, 0] }),
        exped({ ts: 3 * HOUR, missionId: 37, name: 'A', result: 2, resources: [900, 0, 0, 0] }),
    ]);

    it('依次數與依單項資源排序是兩個不同的答案', () => {
        expect(sortStats(stats, 'count', true).map(s => s.missionId)).toEqual([5, 37]);
        expect(sortStats(stats, 'fuel', true).map(s => s.missionId)).toEqual([37, 5]);
        expect(sortStats(stats, 'ammo', true).map(s => s.missionId)).toEqual([5, 37]);
    });

    it('total 是四項合計，last 是最後執行時刻', () => {
        expect(sortStats(stats, 'total', true).map(s => s.missionId)).toEqual([37, 5]);
        expect(sortStats(stats, 'last', true).map(s => s.missionId)).toEqual([37, 5]);
    });

    it('升冪是降冪的反序，且不動到原陣列', () => {
        const before = stats.map(s => s.missionId);
        expect(sortStats(stats, 'count', false).map(s => s.missionId)).toEqual([37, 5]);
        expect(stats.map(s => s.missionId)).toEqual(before);
    });

    it('名稱排序時無名稱者恆排最後，不論升降冪', () => {
        const withBlank = groupByMission([
            exped({ ts: 1, missionId: 1, name: 'B' }),
            exped({ ts: 2, missionId: 2, name: '' }),
            exped({ ts: 3, missionId: 3, name: 'A' }),
        ]);
        expect(sortStats(withBlank, 'name', false).map(s => s.missionId)).toEqual([3, 1, 2]);
        expect(sortStats(withBlank, 'name', true).map(s => s.missionId)).toEqual([1, 3, 2]);
    });
});

describe('statsCsv', () => {
    const header = {
        mission: '編號', name: '遠征', count: '次數', great: '大成功', fail: '失敗',
        mats: ['燃料', '彈藥', '鋼材', '鋁土', '不該出現的第五項'], last: '最後執行',
    };

    it('表頭只取四項資材，資料列與表頭欄數一致', () => {
        const stats = groupByMission([exped({ ts: 1, resources: [1, 2, 3, 4] })]);
        const lines = statsCsv(stats, header).split(/\r?\n/);
        // 編號／遠征／次數／大成功／失敗＋四項資材＋最後執行＝10 欄
        expect(lines[0].split(',')).toHaveLength(10);
        expect(lines[0]).not.toContain('不該出現的第五項');
        expect(lines[1].split(',').slice(5, 9)).toEqual(['1', '2', '3', '4']);
    });

    it('含逗號的遠征名會被跳脫，不撐破欄位', () => {
        const stats = groupByMission([exped({ ts: 1, name: '護衛,任務' })]);
        expect(statsCsv(stats, header)).toContain('"護衛,任務"');
    });
});
