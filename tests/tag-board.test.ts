// utils/tag-board.ts：配船板卡片狀態、遷移、路線檢查。
import { describe, expect, it } from 'vitest';
import type { PlanStage, SallyShip } from '../utils/event-plan';
import {
    TAG_COLOR_COUNT, applyObservedTagBindings, assignPlanTag, boardBudget, bindUnboundEstablishedTags,
    cardState, checkRoute, columnGroups, columnGroupsWithMaps, columnOf, defaultColorForTag,
    deletePlanTag, grantTagsOnMap, knownTagIds, mapsForTag, mergeObservedGrants,
    migrateSlotsToPlanByShip, setMapGrantTags, stypeGroupKey, syncPlanFromActual, unbindTagFromMap,
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
        expect(stypeGroupKey(18)).toBe('CVB');
        expect(stypeGroupKey(16)).toBe('AV');
    });
    it('columnGroupsWithMaps：master 空關也出現；無 master 退回 columnGroups', () => {
        expect(columnGroupsWithMaps([1, 2, 3], [
            { id: 10, maps: [1] },
            { id: 11, maps: [] },
        ])).toEqual([
            { mapId: 'SHARED', tags: [11] },
            { mapId: 1, tags: [10] },
            { mapId: 2, tags: [] },
            { mapId: 3, tags: [] },
        ]);
        expect(columnGroupsWithMaps([], [{ id: 1, maps: [5] }]))
            .toEqual(columnGroups([{ id: 1, maps: [5] }]));
    });
    it('applyObservedTagBindings：觀測到的標籤自動綁關卡；第二標籤開新階段', () => {
        const stages = [
            stage({ key: 'm1', mapNo: 1, grantsTag: null, allowedTags: [] }),
            stage({ key: 'm2', mapNo: 2, grantsTag: 3, allowedTags: [3] }),
        ];
        const obs = new Map<number, { tagId: number }[]>([
            [621, [{ tagId: 1 }, { tagId: 2 }]], // area 62 E1
            [622, [{ tagId: 3 }]],
        ]);
        const out = applyObservedTagBindings(stages, [], 62, [1, 2], obs);
        expect(out.changed).toBe(true);
        expect(out.tags.map(t => t.sallyArea).sort()).toEqual([1, 2, 3]);
        expect(out.stages.find(s => s.key === 'm1')?.grantsTag).toBe(1);
        expect(out.stages.some(s => s.mapNo === 1 && s.phase && s.grantsTag === 2)).toBe(true);
        expect(out.stages.find(s => s.key === 'm2')?.grantsTag).toBe(3); // 不覆寫
        // 再跑一次不應再變
        expect(applyObservedTagBindings(out.stages, out.tags, 62, [1, 2], obs).changed).toBe(false);
    });
    it('applyObservedTagBindings：有觀測時清掉誤綁到別關的 grants', () => {
        const stages = [
            stage({ key: 'm1', mapNo: 1, grantsTag: 2, allowedTags: [2] }), // 誤綁
            stage({ key: 'm2', mapNo: 2, grantsTag: null, allowedTags: [] }),
            stage({ key: 'p', mapNo: 1, phase: true, grantsTag: null, allowedTags: [], label: '' }),
        ];
        const obs = new Map([[622, [{ tagId: 2 }]]]); // 實際在 E2 貼出
        const out = applyObservedTagBindings(stages, [
            { sallyArea: 2, name: 'x', nameSource: 'manual' },
        ], 62, [1, 2], obs);
        expect(out.stages.find(s => s.key === 'm1')?.grantsTag).toBeNull();
        expect(out.stages.find(s => s.mapNo === 2)?.grantsTag).toBe(2);
        expect(out.stages.some(s => s.key === 'p')).toBe(false); // 空 phase 刪除
    });
    it('bindUnboundEstablishedTags：未觀測的已貼標籤掛到已有 grants 的最早關', () => {
        const stages = [
            stage({ key: 'm1', mapNo: 1, grantsTag: 1, allowedTags: [1] }),
            stage({ key: 'm2', mapNo: 2, grantsTag: null, allowedTags: [] }),
        ];
        const tags = [
            { sallyArea: 1, name: 'a', nameSource: 'manual' as const },
            { sallyArea: 2, name: 'b', nameSource: 'manual' as const },
        ];
        const out = bindUnboundEstablishedTags(stages, tags, [1, 2], [1, 2, 3], new Set());
        expect(out.changed).toBe(true);
        expect(grantTagsOnMap(out.stages, 1)).toEqual([1, 2]);
        // 觀測已提到的不瞎猜
        expect(bindUnboundEstablishedTags(stages, tags, [1, 2], [1], new Set([2])).changed).toBe(false);
    });
    it('setMapGrantTags：複選會貼標籤＝多階段', () => {
        const stages = [stage({ key: 'm1', mapNo: 1, grantsTag: 1, allowedTags: [1] })];
        const out = setMapGrantTags(stages, [
            { sallyArea: 1, name: 'a', nameSource: 'manual' },
            { sallyArea: 2, name: 'b', nameSource: 'manual' },
        ], 1, [1, 2]);
        expect(grantTagsOnMap(out.stages, 1)).toEqual([1, 2]);
        const cleared = setMapGrantTags(out.stages, out.tags, 1, [1]);
        expect(grantTagsOnMap(cleared.stages, 1)).toEqual([1]);
    });
    it('unbindTagFromMap／deletePlanTag：取消誤加的標籤', () => {
        const stages = [
            stage({ key: 'm1', mapNo: 1, grantsTag: 1, allowedTags: [1] }),
            stage({ key: 'p', mapNo: 1, phase: true, grantsTag: 3, allowedTags: [3], label: 'E1#1' }),
        ];
        const tags = [
            { sallyArea: 1, name: 'a', nameSource: 'manual' as const },
            { sallyArea: 3, name: '', nameSource: 'manual' as const },
        ];
        const u = unbindTagFromMap(stages, tags, {}, [], 1, 3);
        expect(grantTagsOnMap(u.stages, 1)).toEqual([1]);
        expect(u.tags.map(t => t.sallyArea)).toEqual([1]); // 空名孤兒刪除
        const blocked = deletePlanTag(stages, tags, {}, [{ sallyArea: 3 }], 3);
        expect(blocked.blocked).toBe(true);
    });
    it('mergeObservedGrants：只增不減並可餵回 applyObserved', () => {
        const live = new Map([[621, [{ tagId: 2 }]]]);
        const m = mergeObservedGrants({ 621: [1] }, live);
        expect(m.changed).toBe(true);
        expect(m.stored[621]).toEqual([1, 2]);
        expect(mergeObservedGrants(m.stored, live).changed).toBe(false);
    });
    it('syncPlanFromActual：已貼標強制覆寫計畫', () => {
        const ships: SallyShip[] = [
            { id: 1, name: 'a', sallyArea: 4 },
            { id: 2, name: 'b', sallyArea: 0 },
            { id: 3, name: 'c', sallyArea: 2 },
        ];
        expect(syncPlanFromActual({ 1: 9, 2: 1 }, ships)).toEqual({
            planByShip: { 1: 4, 2: 1, 3: 2 },
            changed: true,
        });
        expect(syncPlanFromActual({ 1: 4, 3: 2 }, ships).changed).toBe(false);
    });
});
