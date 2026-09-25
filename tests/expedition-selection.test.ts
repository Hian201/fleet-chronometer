import { describe, expect, it } from 'vitest';
import { expeditionSelectionForDeck } from '../utils/expedition-selection';

describe('expeditionSelectionForDeck', () => {
    const available = new Set([2, 3, 4]);

    it('uses the selected fleet’s recorded expedition when it exists in the catalog', () => {
        expect(expeditionSelectionForDeck(1, 3, new Map([[1, 2]]), available, 2)).toBe(3);
    });

    it('restores that fleet’s manual selection when no recorded expedition exists', () => {
        expect(expeditionSelectionForDeck(1, null, new Map([[0, 4], [1, 3]]), available, 2)).toBe(3);
    });

    it('uses the catalog default instead of inheriting another fleet’s selection', () => {
        expect(expeditionSelectionForDeck(1, null, new Map([[0, 4]]), available, 2)).toBe(2);
    });

    it('ignores missing catalog entries and returns null when no option is available', () => {
        expect(expeditionSelectionForDeck(1, 99, new Map([[1, 98]]), available, 2)).toBe(2);
        expect(expeditionSelectionForDeck(1, null, new Map(), new Set(), null)).toBeNull();
    });
});
