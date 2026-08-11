import { describe, expect, it } from 'vitest';
import { matchOrderStype, orderStypeGroupOf, ORDER_STYPE_GROUPS } from '../utils/order-stype';

describe('order stype groups', () => {
    it('明確艦種對到縮寫組', () => {
        expect(orderStypeGroupOf(8)).toBe('bb');   // 戦艦
        expect(orderStypeGroupOf(10)).toBe('bb');  // 航空戦艦
        expect(orderStypeGroupOf(11)).toBe('cv');
        expect(orderStypeGroupOf(2)).toBe('dd');
        expect(orderStypeGroupOf(1)).toBe('de');
        expect(orderStypeGroupOf(13)).toBe('ss');
    });

    it('未列艦種落入 aux', () => {
        expect(orderStypeGroupOf(16)).toBe('aux'); // 水上機母艦
        expect(orderStypeGroupOf(19)).toBe('aux'); // 工作艦
        expect(orderStypeGroupOf(0)).toBe('aux');
    });

    it('match：all 全過、單組篩選、aux 只收其餘', () => {
        expect(matchOrderStype(2, 'all')).toBe(true);
        expect(matchOrderStype(2, 'dd')).toBe(true);
        expect(matchOrderStype(2, 'bb')).toBe(false);
        expect(matchOrderStype(16, 'aux')).toBe(true);
        expect(matchOrderStype(2, 'aux')).toBe(false);
    });

    it('aux 組的 stypeIds 為空（無法用白名單表達）', () => {
        expect(ORDER_STYPE_GROUPS.find(g => g.id === 'aux')!.stypeIds).toEqual([]);
    });
});
