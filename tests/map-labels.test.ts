// 地圖資源旁路：runtime message 驗證與 db.mapLabels 列的合併（utils/map-labels.ts）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EDGE_LETTERS } from '../utils/map-edge-letters';
import { MAP_INFO_BASE_PART, MSG_MAP_RESOURCE, mergeMapLabelRow, parseMapResourceMessage } from '../utils/map-labels';
import { edgeLettersFromMapInfo, parseMapInfo, type MapInfoPart } from '../utils/map-resource';
import type { MapLabelRow } from '../utils/db';

const load = (file: string): MapInfoPart => {
    const part = parseMapInfo(JSON.parse(readFileSync(new URL(`../samples/map-info/${file}.json`, import.meta.url), 'utf8')));
    if (!part) throw new Error(`fixture 解析失敗：${file}`);
    return part;
};

// 62-1 的遊戲原檔：基本檔＋四個追加檔
const PARTS: Array<[number | null, string]> = [
    [null, '62-01_info'], [18, '62-01_info18'], [19, '62-01_info19'], [23, '62-01_info23'], [39, '62-01_info39'],
];

function foldParts(order: Array<[number | null, string]>): MapLabelRow | undefined {
    let row: MapLabelRow | undefined;
    order.forEach(([part, file], i) => { row = mergeMapLabelRow(row, '62-1', part, load(file), 1000 + i); });
    return row;
}

describe('mergeMapLabelRow', () => {
    it('逐檔合併的結果與一次給全部檔相同，且與靜態表一致', () => {
        const row = foldParts(PARTS)!;
        expect(Object.keys(row.parts).sort()).toEqual(['18', '19', '23', '39', MAP_INFO_BASE_PART].sort());
        expect(row.letters).toEqual(edgeLettersFromMapInfo(PARTS.map(([, f]) => load(f))));
        expect(Object.keys(row.letters)).toHaveLength(29);
        for (const [no, name] of Object.entries(row.letters)) expect(name).toBe(EDGE_LETTERS['62-1'][Number(no)]);
        expect(row.ts).toBe(1004);
    });

    it('觀測順序不影響結果（依基本檔、再依 N 遞增合併）', () => {
        const shuffled = [PARTS[3], PARTS[0], PARTS[4], PARTS[1], PARTS[2]];
        expect(foldParts(shuffled)!.letters).toEqual(foldParts(PARTS)!.letters);
    });

    it('同一檔重複觀測冪等，只更新時間', () => {
        const row = foldParts(PARTS)!;
        const again = mergeMapLabelRow(row, '62-1', 18, load('62-01_info18'), 9999);
        expect(again.letters).toEqual(row.letters);
        expect(again.parts).toEqual(row.parts);
        expect(again.ts).toBe(9999);
    });

    it('只有基本檔時沒有字母；不改動傳入的舊列', () => {
        const base = mergeMapLabelRow(undefined, '62-1', null, load('62-01_info'), 1);
        expect(base.letters).toEqual({});
        const next = mergeMapLabelRow(base, '62-1', 18, load('62-01_info18'), 2);
        expect(Object.keys(base.parts)).toEqual([MAP_INFO_BASE_PART]);
        expect(Object.keys(next.parts).sort()).toEqual(['18', MAP_INFO_BASE_PART].sort());
    });
});

describe('parseMapResourceMessage', () => {
    it('接受合格訊息', () => {
        expect(parseMapResourceMessage({ type: MSG_MAP_RESOURCE, map: '62-1', part: 18, text: '{}' }))
            .toEqual({ type: MSG_MAP_RESOURCE, map: '62-1', part: 18, text: '{}' });
        expect(parseMapResourceMessage({ type: MSG_MAP_RESOURCE, map: '1-1', part: null, text: '{}' })?.part).toBeNull();
    });

    it.each([
        null,
        { type: 'kc:api', map: '62-1', part: null, text: '{}' },
        { type: MSG_MAP_RESOURCE, map: '62_1', part: null, text: '{}' },
        { type: MSG_MAP_RESOURCE, map: '62-1', part: '18', text: '{}' },
        { type: MSG_MAP_RESOURCE, map: '62-1', part: -1, text: '{}' },
        { type: MSG_MAP_RESOURCE, map: '62-1', part: null, text: {} },
    ])('不合格回 null（%#）', (msg) => {
        expect(parseMapResourceMessage(msg)).toBeNull();
    });
});
