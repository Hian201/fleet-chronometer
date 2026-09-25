import { beforeEach, describe, expect, it } from 'vitest';
import { ITEM_PINS_KEY, loadItemPins, parseItemPins, saveItemPins, sortPinnedFirst, toggleItemPin } from '../utils/item-pins';

describe('道具釘選', () => {
    const store = new Map<string, string>();
    beforeEach(() => {
        store.clear();
        (globalThis as { localStorage?: unknown }).localStorage = {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => { store.set(key, value); },
            removeItem: (key: string) => { store.delete(key); },
        };
    });

    it('壞資料只丟棄該筆，不整批失敗', () => {
        expect(parseItemPins(['useitem:57', 3, '', 'useitem:57', 'material:8'])).toEqual(['useitem:57', 'material:8']);
        expect(parseItemPins({ pins: [] })).toEqual([]);
        store.set(ITEM_PINS_KEY, '{broken');
        expect(loadItemPins()).toEqual([]);
    });

    it('切換釘選保留先後，並可存回讀出', () => {
        let pins = toggleItemPin([], 'useitem:57');
        pins = toggleItemPin(pins, 'material:8');
        expect(pins).toEqual(['useitem:57', 'material:8']);
        saveItemPins(pins);
        expect(loadItemPins()).toEqual(pins);
        expect(toggleItemPin(pins, 'useitem:57')).toEqual(['material:8']);
        expect(pins).toEqual(['useitem:57', 'material:8']);
    });

    it('釘選項目依釘選先後排前，其餘維持原順序', () => {
        const items = ['a', 'b', 'c', 'd', 'e'];
        expect(sortPinnedFirst(items, item => item, ['d', 'b', 'zzz'])).toEqual(['d', 'b', 'a', 'c', 'e']);
        expect(sortPinnedFirst(items, item => item, [])).toEqual(items);
    });
});
