import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EDGE_LETTERS } from '../utils/map-edge-letters';
import { edgeLettersFromMapInfo, parseMapInfo, parseMapResourceUrl, type MapInfoPart } from '../utils/map-resource';

const load = (file: string): MapInfoPart => {
    const part = parseMapInfo(JSON.parse(readFileSync(new URL(`../samples/map-info/${file}`, import.meta.url), 'utf8')));
    if (!part) throw new Error(`fixture 解析失敗：${file}`);
    return part;
};

const FIXTURES: Record<string, { files: string[]; count: number }> = {
    '62-1': { files: ['62-01_info', '62-01_info18', '62-01_info19', '62-01_info23', '62-01_info39'], count: 29 },
    '62-2': { files: ['62-02_info', '62-02_info15', '62-02_info25', '62-02_info38', '62-02_info49'], count: 39 },
};

describe('edgeLettersFromMapInfo：遊戲原檔', () => {
    for (const [map, { files, count }] of Object.entries(FIXTURES)) {
        it(`${map} 合併全部檔後與靜態表一致`, () => {
            const got = edgeLettersFromMapInfo(files.map((f) => load(`${f}.json`)));
            expect(Object.keys(got)).toHaveLength(count);
            for (const [no, name] of Object.entries(got)) {
                expect(name, `${map} edge ${no}`).toBe(EDGE_LETTERS[map][Number(no)]);
            }
        });
    }

    it('只有基本檔時不輸出任何字母（初始節點的字母不在 JSON 裡）', () => {
        expect(edgeLettersFromMapInfo([load('62-01_info.json')])).toEqual({});
    });
});

describe('parseMapResourceUrl', () => {
    it('完整網址含 query', () => {
        expect(parseMapResourceUrl('https://w00g.kancolle-server.com/kcs2/resources/map/062/01_info18.json?version=5')).toEqual({ map: '62-1', part: 18 });
    });
    it('相對路徑與基本檔', () => {
        expect(parseMapResourceUrl('/kcs2/resources/map/062/02_info.json')).toEqual({ map: '62-2', part: null });
        expect(parseMapResourceUrl('kcs2/resources/map/001/01_info.json?version=1')).toEqual({ map: '1-1', part: null });
    });
    it('其他網址回 null', () => {
        for (const u of [
            '/kcs2/resources/map/062/01_image.json',
            '/kcs2/resources/map/062/01_image.png',
            '/kcs2/resources/map/062/01_info.png',
            '/kcsapi/api_get_member/mapinfo',
            'https://example.com/xkcs2/resources/map/062/01_info.json',
            '',
            'not a url',
        ]) expect(parseMapResourceUrl(u), u).toBeNull();
    });
    it('非字串不丟例外', () => {
        expect(parseMapResourceUrl(undefined as unknown as string)).toBeNull();
    });
});

describe('parseMapInfo', () => {
    it('形狀不對回 null', () => {
        for (const j of [null, undefined, 1, 'x', [], {}, { spots: {} }]) expect(parseMapInfo(j)).toBeNull();
    });
    it('欄位缺漏或非有限數字的項目略過', () => {
        const got = parseMapInfo({
            spots: [
                { no: 1, x: 10, y: 20, line: { x: 1, y: 1 } },
                { no: 2, x: '10', y: 20 },
                { no: 3, x: 10 },
                { no: 4, x: Infinity, y: 1 },
                { no: 5, x: 5, y: 6 },
                null,
            ],
            labels: [{ x: 1, y: 2, img: 'A' }, { x: 1, y: 2 }, { x: NaN, y: 2, img: 'B' }, { x: 1, y: 2, img: '' }, 'x'],
        });
        expect(got).toEqual({
            spots: [{ no: 1, x: 10, y: 20, isStart: false }, { no: 5, x: 5, y: 6, isStart: true }],
            labels: [{ x: 1, y: 2, name: 'A' }],
        });
    });
    it('labels 缺漏視為空；去除 _text_ 前綴', () => {
        expect(parseMapInfo({ spots: [] })).toEqual({ spots: [], labels: [] });
        const got = parseMapInfo({ spots: [], labels: [{ x: 0, y: 0, img: '62-5_text_E1' }, { x: 0, y: 0, img: 'I' }] });
        expect(got?.labels.map((l) => l.name)).toEqual(['E1', 'I']);
    });
});

describe('edgeLettersFromMapInfo：配對規則', () => {
    const spot = (no: number, x: number, y: number, isStart = false) => ({ no, x, y, isStart });
    const label = (x: number, y: number, name: string) => ({ x, y, name });

    it('兩個標籤搶同一節點時近者勝，遠者在 45px 內改配另一節點', () => {
        const part = {
            spots: [spot(1, 100, 100), spot(2, 140, 100)],
            labels: [label(110, 100, 'far'), label(102, 100, 'near')],
        };
        // near 與節點 1 距離 2、far 與節點 1 距離 10、與節點 2 距離 30
        expect(edgeLettersFromMapInfo([part])).toEqual({ 1: 'near', 2: 'far' });
    });
    it('超過 45px 不配；沒配到的節點不輸出', () => {
        const part = { spots: [spot(1, 0, 0), spot(2, 300, 0)], labels: [label(46, 0, 'X'), label(300, 0, 'Y')] };
        expect(edgeLettersFromMapInfo([part])).toEqual({ 2: 'Y' });
        expect(edgeLettersFromMapInfo([{ spots: [spot(1, 0, 0)], labels: [label(45, 0, 'X')] }])).toEqual({ 1: 'X' });
    });
    it('終點相距 4px 內併成同一節點；出擊點不參與', () => {
        const part = {
            spots: [spot(0, 50, 50, true), spot(1, 100, 100), spot(2, 103, 100), spot(3, 109, 100)],
            labels: [label(50, 50, 'S'), label(100, 100, 'A'), label(109, 100, 'B')],
        };
        expect(edgeLettersFromMapInfo([part])).toEqual({ 1: 'A', 2: 'A', 3: 'B' });
    });
    it('後讀的 spot 依 no 覆蓋；距離相同依標籤原始順序', () => {
        const base = { spots: [spot(1, 0, 0)], labels: [] };
        const add = { spots: [spot(1, 200, 0)], labels: [label(190, 0, 'first'), label(210, 0, 'second')] };
        expect(edgeLettersFromMapInfo([base, add])).toEqual({ 1: 'first' });
    });
});
