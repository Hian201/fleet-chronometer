import { describe, expect, it } from 'vitest';
import { excludeCandidateGroups, normalizeExcludedMap, parseExcludedMaps } from '../utils/sortie-exclude';

describe('不記錄的海域清單', () => {
    it('只接受通常海域，全形與長音符號正規化', () => {
        expect(normalizeExcludedMap(' 1-5 ')).toBe('1-5');
        expect(normalizeExcludedMap('７－２')).toBe('7-2');
        expect(normalizeExcludedMap('3ー2')).toBe('3-2');
        expect(normalizeExcludedMap('61-5')).toBeNull();
        expect(normalizeExcludedMap('E1')).toBeNull();
        expect(normalizeExcludedMap('0-1')).toBeNull();
    });

    it('儲存值去重、略過無效項並依海域序排列', () => {
        expect(parseExcludedMaps(['5-4', '1-5', '1-5', 'x', 3, '2-10', '1-1'])).toEqual(['1-1', '1-5', '5-4']);
        expect(parseExcludedMaps(null)).toEqual([]);
        expect(parseExcludedMaps({ maps: ['1-5'] })).toEqual([]);
    });

    it('下拉候選依海域分組、排除活動海域與已加入的關', () => {
        expect(excludeCandidateGroups(['2-1', '1-2', '1-1', '61-3', '1-2', '7-5', '1-6'], ['1-2'])).toEqual([
            { area: 1, maps: ['1-1', '1-6'] },
            { area: 2, maps: ['2-1'] },
            { area: 7, maps: ['7-5'] },
        ]);
        expect(excludeCandidateGroups(['1-1'], ['1-1'])).toEqual([]);
    });
});
