import { describe, expect, it } from 'vitest';
import { SAURY_CHAINS, sauryNeed } from '../utils/saury-chain';

const steps = SAURY_CHAINS['2026'];

describe('sauryNeed', () => {
    it('全部做完的最少尾數：持有最高 27、消耗 8＋20＋27＋7×2＝69', () => {
        expect(sauryNeed(steps, new Set(), {}, null)).toEqual({ hold: 27, consume: 69, need: 69, toCatch: null });
    });

    it('扣掉完成的任務與勾掉的兌換，並以持有數算還要撈的尾數', () => {
        const done = new Set(['q866', 'q369', 'q867', 'q868', 'q1110']);
        // 剩 1144（20）＋咖哩（27）＋蒲燒 1 次（7）
        expect(sauryNeed(steps, done, { kabayaki: 1 }, 30)).toEqual({ hold: 0, consume: 54, need: 54, toCatch: 24 });
    });

    it('持有任務未完成且消耗不多時，以持有門檻為準', () => {
        const need = sauryNeed(steps, new Set(['q866']), { q1144: 1, curry: 1, kabayaki: 2 }, 20);
        expect(need).toEqual({ hold: 27, consume: 8, need: 27, toCatch: 7 });
    });

    it('勾選次數夾在 0～上限之間；手上已夠時為 0', () => {
        expect(sauryNeed(steps, new Set(), { kabayaki: 9, curry: -3 }, 99).consume).toBe(8 + 20 + 27);
        expect(sauryNeed(steps, new Set(), {}, 99).toCatch).toBe(0);
    });
});
