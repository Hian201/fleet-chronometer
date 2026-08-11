import { describe, expect, it } from 'vitest';
import {
    matchGearCat, ORDER_GEAR_CATS, resolveGearCatIds,
} from '../utils/order-gear-cats';

describe('resolveGearCatIds / matchGearCat', () => {
    it('全装備（null）不篩', () => {
        expect(resolveGearCatIds(null, 'all')).toBeNull();
        expect(matchGearCat(6, null)).toBe(true);
    });

    it('大項回父層 catIds；二次篩收窄', () => {
        const fighter = resolveGearCatIds('fighter', 'all');
        expect(fighter).toEqual([6, 48, 56]);
        expect(resolveGearCatIds('fighter', 'land')).toEqual([48]);
        expect(matchGearCat(48, resolveGearCatIds('fighter', 'land'))).toBe(true);
        expect(matchGearCat(6, resolveGearCatIds('fighter', 'land'))).toBe(false);
    });

    it('未知大項／未知二次篩：未知大項＝不篩；未知 sub 退回父層', () => {
        expect(resolveGearCatIds('nope', 'all')).toBeNull();
        expect(resolveGearCatIds('mainGun', 'nope')).toEqual([1, 2, 3, 38]);
    });

    it('大発系不含獨立戰車項（戰車大発在大発 cat 24）', () => {
        const landing = ORDER_GEAR_CATS.find(c => c.id === 'landing')!;
        expect(landing.subs.map(s => s.id).sort()).toEqual(['daihatsu', 'tank']);
        expect(landing.subs.find(s => s.id === 'daihatsu')!.catIds).toEqual([24]);
        expect(landing.subs.find(s => s.id === 'tank')!.catIds).toEqual([46]);
        expect(landing.subs.some(s => s.id === 'sensha')).toBe(false);
    });
});
