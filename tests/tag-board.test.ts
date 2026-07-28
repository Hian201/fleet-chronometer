// utils/tag-board.ts：配船板卡片狀態、遷移、路線檢查。
import { describe, expect, it } from 'vitest';
import type { PlanStage, SallyShip } from '../utils/event-plan';
import {
    TAG_COLOR_COUNT, assignPlanTag, boardBudget, cardState, checkRoute, columnGroups,
    columnOf, defaultColorForTag, knownTagIds, mapsForTag, migrateSlotsToPlanByShip,
    stypeGroupKey,
} from '../utils/tag-board';

const stage = (o: Partial<PlanStage> & { key: string }): PlanStage => ({
    label: o.key, allowedTags: [], grantsTag: null, slots: [], ...o,
});

describe('cardState / columnOf', () => {
    it('pool：計畫與實際皆 0', () => {
        expect(cardState(0, 0)).toBe('pool');
        expect(columnOf(0, 0)).toBe(0);
    });
    it('stamped：實際＝計畫', () => {
        expect(cardState(3, 3)).toBe('stamped');
        expect(columnOf(3, 3)).toBe(3);
    });
    it('planned：有計畫、尚未貼', () => {
        expect(cardState(2, 0)).toBe('planned');
        expect(columnOf(2, 0)).toBe(2);
    });
    it('mismatch：實際≠計畫（含 plan＝0）', () => {
        expect(cardState(2, 4)).toBe('mismatch');
        expect(columnOf(2, 4)).toBe(2);   // 留在計畫欄
        expect(cardState(0, 4)).toBe('mismatch');
        expect(columnOf(0, 4)).toBe(4);   // 無計畫 → 實際欄
    });
});

describe('migrateSlotsToPlanByShip', () => {
    it('先到先得；同艦不同 grantsTag → dropped', () => {
        const stages = [
            stage({ key: 'a', grantsTag: 1, slots: [{ shipId: 10 }, { shipId: 11 }] }),
            stage({ key: 'b', grantsTag: 2, slots: [{ shipId: 10 }, { shipId: 12 }] }),
        ];
        const out = migrateSlotsToPlanByShip(stages);
        expect(out.planByShip).toEqual({ 10: 1, 11: 1, 12: 2 });
        expect(out.dropped).toEqual([{ shipId: 10, stageKey: 'b' }]);
        expect(out.skipped).toEqual([]);
    });
    it('grantsTag 未填的格進 skipped，不寫 planByShip', () => {
        const stages = [
            stage({ key: 'x', grantsTag: null, slots: [{ shipId: 7 }, { role: '對空' }] }),
            stage({ key: 'y', grantsTag: 3, slots: [{ shipId: 8 }] }),
        ];
        const out = migrateSlotsToPlanByShip(stages);
        expect(out.planByShip).toEqual({ 8: 3 });
        expect(out.skipped).toEqual([{ shipId: 7, stageKey: 'x' }]);
    });
    it('同標籤重複不 dropped', () => {
        const stages = [
            stage({ key: 'a', grantsTag: 5, slots: [{ shipId: 1 }] }),
            stage({ key: 'b', grantsTag: 5, slots: [{ shipId: 1 }] }),
        ];
        expect(migrateSlotsToPlanByShip(stages)).toEqual({
            planByShip: { 1: 5 }, dropped: [], skipped: [],
        });
    });
});

describe('checkRoute', () => {
    const ships = new Map<number, SallyShip>([
        [1, { id: 1, name: 'A', sallyArea: 1 }],
        [2, { id: 2, name: 'B', sallyArea: 0 }],
        [3, { id: 3, name: 'C', sallyArea: 9 }],
        [4, { id: 4, name: 'D', sallyArea: 0 }],
    ]);
    const plan = { 2: 1, 4: 7 };

    it('allowedTags 空 → unknown、不判紅', () => {
        const r = checkRoute([1, 2, 3], ships, plan, [], 1);
        expect(r).toEqual({ ok: [], blocked: [], willStamp: [], unknown: true });
    });
    it('實際允許／阻擋／將貼；計畫不符亦 blocked', () => {
        const r = checkRoute([1, 2, 3, 4], ships, plan, [1], 1);
        expect(r.unknown).toBe(false);
        expect(r.ok).toEqual([1]);
        expect(r.blocked).toEqual([3, 4]); // 3＝他標籤；4＝計畫 7 不在 allowed 且 ≠ grants
        expect(r.willStamp).toEqual([2]);  // 無標籤、計畫在 allowed
    });
    it('willStamp：無標籤且計畫＝grants 或未排', () => {
        const r = checkRoute([2, 4], ships, { 2: 5, 4: 0 }, [1, 5], 5);
        expect(r.willStamp.sort()).toEqual([2, 4]);
        expect(r.blocked).toEqual([]);
    });
});

describe('columnGroups / knownTagIds / budget / color', () => {
    it('跨關與未綁 → SHARED 置前；單關依 mapNo 升冪', () => {
        expect(columnGroups([
            { id: 3, maps: [2] },
            { id: 1, maps: [1, 2] },
            { id: 4, maps: [] },
            { id: 2, maps: [1] },
        ])).toEqual([
            { mapId: 'SHARED', tags: [1, 4] },
            { mapId: 1, tags: [2] },
            { mapId: 2, tags: [3] },
        ]);
    });
    it('knownTagIds 合併三來源', () => {
        expect(knownTagIds(
            [{ sallyArea: 2, name: '', nameSource: 'manual' }],
            [{ id: 1, name: 'x', sallyArea: 5 }],
            { 9: 3, 10: 0 },
        )).toEqual([2, 3, 5]);
    });
    it('boardBudget 四態', () => {
        const ships: SallyShip[] = [
            { id: 1, name: 'a', sallyArea: 0 },
            { id: 2, name: 'b', sallyArea: 0 },
            { id: 3, name: 'c', sallyArea: 1 },
            { id: 4, name: 'd', sallyArea: 2 },
        ];
        expect(boardBudget(ships, { 2: 1, 3: 1, 4: 1 })).toEqual({
            free: 1, planned: 1, stamped: 1, mismatch: 1,
        });
    });
    it('defaultColorForTag 穩定落在 1–13', () => {
        expect(TAG_COLOR_COUNT).toBe(13);
        expect(defaultColorForTag(1)).toBe(1);
        expect(defaultColorForTag(13)).toBe(13);
        expect(defaultColorForTag(14)).toBe(1);
    });
    it('mapsForTag／assignPlanTag／stypeGroupKey', () => {
        const stages = [
            stage({ key: 'a', grantsTag: 2, mapNo: 1 }),
            stage({ key: 'b', grantsTag: 2, mapNo: 3 }),
            stage({ key: 'c', grantsTag: 1, mapNo: 1 }),
        ];
        expect(mapsForTag(stages, 2)).toEqual([1, 3]);
        expect(assignPlanTag({ 1: 2 }, 1, 0)).toEqual({});
        expect(assignPlanTag({}, 5, 3)).toEqual({ 5: 3 });
        expect(stypeGroupKey(11)).toBe('CV');
        expect(stypeGroupKey(2)).toBe('DD');
        expect(stypeGroupKey(16)).toBe('AV');
    });
});
