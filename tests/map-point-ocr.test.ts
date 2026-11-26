// 地圖 point 圖層字母辨識的 background 調度（utils/map-point-ocr.ts）。
// 以 62-1 的遊戲原檔與 samples/map-glyph 的裁切 fixture 驗證；'99-1' 是靜態表沒有的假海域，
// 用來模擬「新活動、擴充還沒更新」的情況。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapLabelRow } from '../utils/db';
import { EDGE_LETTERS } from '../utils/map-edge-letters';
import type { GlyphCrop } from '../utils/map-glyph';
import { mergeMapLabelRow } from '../utils/map-labels';
import {
    applyPointLayerResult, formatPointLayerVerification, missingNodes, nodeSetKey, planPointLayerRead,
    pointLayerFrame, verifyPointLayerResult,
} from '../utils/map-point-ocr';
import { parseMapInfo, type MapInfoPart } from '../utils/map-resource';

const load = (file: string): MapInfoPart => parseMapInfo(JSON.parse(readFileSync(new URL(`../samples/map-info/${file}.json`, import.meta.url), 'utf8')))!;
const fixture = JSON.parse(readFileSync(new URL('../samples/map-glyph/62-1.json', import.meta.url), 'utf8')) as {
    nodes: Array<{ x: number; y: number; name: string; crop?: GlyphCrop }>;
};
const CROPS = fixture.nodes.flatMap(n => (n.crop ? [n.crop] : []));

const PARTS: Array<[number | null, string]> = [
    [null, '62-01_info'], [18, '62-01_info18'], [19, '62-01_info19'], [23, '62-01_info23'], [39, '62-01_info39'],
];
function rowOf(map: string, parts = PARTS): MapLabelRow {
    let row: MapLabelRow | undefined;
    for (const [part, file] of parts) row = mergeMapLabelRow(row, map, part, load(file), 1);
    return row!;
}

describe('pointLayerFrame', () => {
    it('海域 3 位＋關卡 2 位', () => {
        expect(pointLayerFrame('62-1', 'map62-1_point')).toBe('map06201_map62-1_point');
        expect(pointLayerFrame('1-5', 'map1-5_point')).toBe('map00105_map1-5_point');
        expect(pointLayerFrame('1234-1', 'x_point')).toBeNull();
    });
});

describe('planPointLayerRead', () => {
    it('靜態表完整的海域不讀；驗證模式才對全部非出擊點節點讀', () => {
        const row = rowOf('62-1');
        expect(missingNodes(row)).toEqual([]);
        expect(planPointLayerRead(row, false)).toBeNull();
        const verify = planPointLayerRead(row, true)!;
        expect(verify.mode).toBe('verify');
        expect(verify.frame).toBe('map06201_map62-1_point');
        expect(verify.spots).toHaveLength(35);
    });

    it('缺字節點＝靜態表、標籤都沒有字母的終點；正好是 point 圖層上有字的節點', () => {
        const plan = planPointLayerRead(rowOf('99-1'), false)!;
        expect(plan.mode).toBe('fill');
        expect(plan.frame).toBe('map09901_map62-1_point');
        const expected = fixture.nodes.filter(n => n.crop).map(n => ({ x: n.x, y: n.y }))
            .sort((a, b) => a.x - b.x || a.y - b.y);
        expect(plan.spots).toEqual(expected);
        expect(plan.key).toBe(nodeSetKey(expected));
    });

    it('沒有基本檔（沒有 pointLayer）不讀', () => {
        expect(planPointLayerRead(rowOf('99-1', PARTS.slice(1)), false)).toBeNull();
    });

    it('同一組缺字節點只讀一次：之後載入的追加檔只帶有標籤的節點，不再讀', () => {
        const baseOnly = rowOf('99-1', PARTS.slice(0, 1));
        const first = planPointLayerRead(baseOnly, false)!;
        expect(first.spots).toHaveLength(13);
        // background 送出要求前先寫 ocrAttemptKey
        let row: MapLabelRow = { ...baseOnly, ocrAttemptKey: first.key };
        expect(planPointLayerRead(row, false)).toBeNull();
        for (const [part, file] of PARTS.slice(1)) {
            row = mergeMapLabelRow(row, '99-1', part, load(file), 2);
            expect(planPointLayerRead(row, false)).toBeNull();
        }
        // 仍有缺字節點（已讀過）時，驗證模式也不再送要求
        expect(planPointLayerRead(row, true)).toBeNull();
    });

    it('缺字組縮小（例如辨識補上一部分、或標籤補上）不再讀；出現沒讀過的缺字節點才再讀', () => {
        const row = rowOf('99-1');
        const first = planPointLayerRead(row, false)!;
        const tried: MapLabelRow = { ...row, ocrAttemptKey: first.key };
        const shrunk = { ...tried, letters: { ...tried.letters, [missingNodes(tried)[0].edges[0]]: 'X' } };
        expect(missingNodes(shrunk)).toHaveLength(first.spots.length - 1);
        expect(planPointLayerRead(shrunk, false)).toBeNull();
        const extra: MapInfoPart = { spots: [{ no: 900, x: 300, y: 600, isStart: false }], labels: [] };
        const next = planPointLayerRead(mergeMapLabelRow(tried, '99-1', 99, extra, 3), false)!;
        expect(next.mode).toBe('fill');
        expect(next.spots).toContainEqual({ x: 300, y: 600 });
    });
});

describe('applyPointLayerResult', () => {
    it('補上缺字節點的字母（以 edge 為鍵、同節點同名），全部讀對；合併後 letters 含兩種來源', () => {
        const row = rowOf('99-1');
        const plan = planPointLayerRead(row, false)!;
        const next = applyPointLayerResult({ ...row, ocrAttemptKey: plan.key }, plan.spots, CROPS)!;
        expect(next.ocrAttemptKey).toBe(plan.key);
        const ocr = Object.entries(next.ocrLetters!);
        expect(ocr.length).toBeGreaterThanOrEqual(12);
        for (const [edge, name] of ocr) expect(name, `edge ${edge}`).toBe(EDGE_LETTERS['62-1'][Number(edge)]);
        // 標籤的字母原樣保留
        for (const [edge, name] of Object.entries(row.letters)) expect(next.letters[Number(edge)]).toBe(name);
        expect(Object.keys(next.letters)).toHaveLength(Object.keys(row.letters).length + ocr.length);
        // 這組讀過之後，剩下讀不出的也不再讀
        expect(planPointLayerRead(next, false)).toBeNull();
    });

    it('只採用要求內且仍缺字的節點，其他節點的結果捨棄', () => {
        const row = rowOf('99-1');
        const plan = planPointLayerRead(row, false)!;
        const asked = plan.spots.slice(0, 3);
        const next = applyPointLayerResult(row, asked, CROPS)!;
        const askedKeys = new Set(asked.map(s => `${s.x},${s.y}`));
        const nodeOf = (edge: number) => row.parts.base.spots.concat(...Object.values(row.parts).map(p => p.spots))
            .find(s => s.no === edge)!;
        for (const edge of Object.keys(next.ocrLetters!)) {
            const s = nodeOf(Number(edge));
            expect([...askedKeys].some(k => {
                const [x, y] = k.split(',').map(Number);
                return Math.hypot(x - s.x, y - s.y) <= 4;
            })).toBe(true);
        }
        // 已由先前辨識補上的節點不再覆蓋
        const filled = applyPointLayerResult(row, plan.spots, CROPS)!;
        const forged = Object.fromEntries(Object.keys(filled.ocrLetters!).map(e => [e, 'ZZ']));
        const prior: MapLabelRow = { ...row, ocrLetters: forged, letters: { ...forged, ...row.letters } };
        expect(applyPointLayerResult(prior, plan.spots, CROPS)).toBeNull();
    });

    it('沒有讀到新字母回 null', () => {
        const row = rowOf('99-1');
        expect(applyPointLayerResult(row, planPointLayerRead(row, false)!.spots, [])).toBeNull();
    });
});

describe('letters 合併：標籤優先', () => {
    it('mergeMapLabelRow 保留圖層辨識欄位，同一 edge 以標籤為準', () => {
        const base = rowOf('99-1', PARTS.slice(0, 1));
        const [labeledEdge, labeledName] = Object.entries(rowOf('99-1').letters)[0];
        const withOcr: MapLabelRow = {
            ...base, ocrLetters: { [labeledEdge]: 'WRONG', 1: 'A' }, ocrAttemptKey: 'k',
            letters: { [labeledEdge]: 'WRONG', 1: 'A' },
        };
        let row = withOcr;
        for (const [part, file] of PARTS.slice(1)) row = mergeMapLabelRow(row, '99-1', part, load(file), 2);
        expect(row.ocrAttemptKey).toBe('k');
        expect(row.ocrLetters).toEqual(withOcr.ocrLetters);
        expect(row.letters[Number(labeledEdge)]).toBe(labeledName);
        expect(row.letters[1]).toBe('A');
    });
});

describe('驗證模式', () => {
    it('與靜態表逐一比對並輸出一行摘要', () => {
        const row = rowOf('62-1');
        const v = verifyPointLayerResult(row, CROPS);
        expect(v.nodes).toBe(35);
        expect(v.wrong).toEqual([]);
        expect(v.ok).toBeGreaterThanOrEqual(12);
        expect(v.ok + v.unread).toBe(35);
        const line = formatPointLayerVerification(v, 3.25, 0.5);
        expect(line).toContain('62-1');
        expect(line).toContain(`讀對 ${v.ok}`);
        expect(line).toContain('讀錯 0');
        expect(line).toContain('3.3ms');
        expect(line).not.toContain('\n');
        expect(formatPointLayerVerification({ ...v, wrong: ['A→B'] }, 0, 0)).toContain('讀錯 1（A→B）');
    });
});
