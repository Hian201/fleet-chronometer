import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    assignWords, matchGlyph, readNodeLetters, wordsFromCrops,
    type GlyphCrop, type GlyphEntry, type GlyphWord,
} from '../utils/map-glyph';
import { MAP_GLYPHS } from '../utils/map-glyph-data';
import { darkMaskFromRGBA, packBits, unpackBits } from '../utils/map-glyph-mask';

type Node = { x: number; y: number; name: string; crop?: GlyphCrop };
type Fixture = { map: string; layer: { w: number; h: number }; nodes: Node[]; sprites: GlyphEntry[] };

const MAPS = ['62-1', '62-2', '62-3'];
// 離線實驗（docs/completion-plan.md 4.11）每關讀對的數量，實作不得更少。
const EXPECTED_OK: Record<string, number> = { '62-1': 12, '62-2': 10, '62-3': 11 };
const fixtures: Record<string, Fixture> = Object.fromEntries(MAPS.map(m => [
    m, JSON.parse(readFileSync(new URL(`../samples/map-glyph/${m}.json`, import.meta.url), 'utf8')) as Fixture,
]));
// 需要辨識的節點＝沒有追加檔標籤、字母只畫在 point 圖層上的節點（fixture 只為它們存裁切）。
const missingOf = (f: Fixture) => f.nodes.filter(n => n.crop) as Array<Node & { crop: GlyphCrop }>;

const entryOf = (name: string, word: GlyphWord): GlyphEntry => {
    const w = word.x1 - word.x0;
    const h = word.y1 - word.y0;
    return { name, w, h, bits: packBits(word.mask, w, h) };
};

/** 以 KC3Kai 名稱監督 point 圖層的字（模擬過去活動累積的字形庫），再加上追加檔標籤 sprite。 */
function libraryFrom(maps: string[]): GlyphEntry[] {
    const lib: GlyphEntry[] = [];
    for (const m of maps) {
        const f = fixtures[m];
        lib.push(...f.sprites);
        const nodes = missingOf(f);
        const got = assignWords(wordsFromCrops(nodes.map(n => n.crop)), nodes);
        for (const [i, word] of got) lib.push(entryOf(nodes[i].name, word));
    }
    return lib;
}

function evaluate(f: Fixture, nodes: Node[], library: GlyphEntry[]) {
    const read = readNodeLetters(nodes.flatMap(n => (n.crop ? [n.crop] : [])), nodes, library);
    let ok = 0;
    let wrong = 0;
    nodes.forEach((n, i) => {
        const got = read.get(i);
        if (got === undefined) return;
        if (got === n.name) ok++;
        else wrong++;
    });
    return { ok, wrong, unread: nodes.length - ok - wrong };
}

describe('字形比對：62-1～62-3 留一驗證', () => {
    for (const m of MAPS) {
        it(`${m} 以另兩關建庫，讀對不少於實驗值、讀錯 0`, () => {
            const f = fixtures[m];
            const nodes = missingOf(f);
            const r = evaluate(f, nodes, libraryFrom(MAPS.filter(o => o !== m)));
            expect(r.wrong).toBe(0);
            expect(r.ok).toBeGreaterThanOrEqual(EXPECTED_OK[m]);
            expect(r.ok + r.unread).toBe(nodes.length);
        });

        it(`${m} 連已有標籤的節點也當成待辨識，仍然讀錯 0`, () => {
            const f = fixtures[m];
            const r = evaluate(f, f.nodes, libraryFrom(MAPS.filter(o => o !== m)));
            expect(r.wrong).toBe(0);
            expect(r.ok).toBeGreaterThanOrEqual(EXPECTED_OK[m]);
        });

        it(`${m} 用正式字形庫讀，讀錯 0`, () => {
            const f = fixtures[m];
            const r = evaluate(f, missingOf(f), MAP_GLYPHS as GlyphEntry[]);
            expect(r.wrong).toBe(0);
            expect(r.ok).toBeGreaterThanOrEqual(EXPECTED_OK[m]);
        });
    }
});

// 以 ASCII 圖組出遮罩：'#' 為字身。
const art = (...rows: string[]) => ({ w: rows[0].length, h: rows.length, mask: Uint8Array.from(rows.join(''), c => (c === '#' ? 1 : 0)) });
const A = art('.###.', '#...#', '#####', '#...#', '#...#');
const B = art('####.', '#...#', '####.', '#...#', '####.');
const ONE = art('.#.', '##.', '.#.', '.#.', '###');

/** 在 w×h 的裁切裡把圖放在 (dx, dy)。 */
function crop(x0: number, y0: number, w: number, h: number, ...items: Array<[ReturnType<typeof art>, number, number]>): GlyphCrop {
    const mask = new Uint8Array(w * h);
    for (const [a, dx, dy] of items) {
        for (let i = 0; i < a.mask.length; i++) {
            if (a.mask[i]) mask[(dy + Math.floor(i / a.w)) * w + dx + (i % a.w)] = 1;
        }
    }
    return { x0, y0, w, h, bits: packBits(mask, w, h) };
}
const wordOf = (a: ReturnType<typeof art>, x0 = 0, y0 = 0): GlyphWord => ({ x0, y0, x1: x0 + a.w, y1: y0 + a.h, mask: a.mask });
const entry = (name: string, a: ReturnType<typeof art>): GlyphEntry => ({ name, w: a.w, h: a.h, bits: packBits(a.mask, a.w, a.h) });

describe('map-glyph-mask', () => {
    it('packBits／unpackBits 往返（含非 8 倍數的尺寸）', () => {
        const w = 7;
        const h = 5;
        const mask = Uint8Array.from({ length: w * h }, (_, i) => (i * 7 + (i >> 2)) % 3 === 0 ? 1 : 0);
        expect(unpackBits(packBits(mask, w, h), w, h)).toEqual(mask);
        expect(packBits(new Uint8Array(0), 0, 0)).toBe('');
    });

    it('打包格式：列優先、高位元在前（與產生器一致）', () => {
        // 第 0、9 個像素為 1 → 位元組 0 = 0x80、位元組 1 = 0x40
        const mask = new Uint8Array(16);
        mask[0] = 1;
        mask[9] = 1;
        expect(btoa(String.fromCharCode(0x80, 0x40))).toBe(packBits(mask, 4, 4));
    });

    it('長度與尺寸不符時丟出錯誤', () => {
        expect(() => unpackBits(packBits(new Uint8Array(16), 4, 4), 5, 5)).toThrow(RangeError);
    });

    it('darkMaskFromRGBA：alpha 128、亮度 110 的門檻邊界', () => {
        const px = (r: number, g: number, b: number, a: number) => [r, g, b, a];
        const rgba = new Uint8ClampedArray([
            ...px(109, 109, 109, 128), // 亮度 109 且 alpha 128 → 字身
            ...px(110, 110, 110, 255), // 亮度剛好 110 → 不是
            ...px(109, 109, 109, 127), // alpha 127 → 不是
            ...px(0, 0, 0, 255),
        ]);
        expect([...darkMaskFromRGBA(rgba, 2, 2)]).toEqual([1, 0, 0, 1]);
        // 權重 299／587／114：純藍 255 的亮度 = 29.07，純綠 255 = 149.7
        expect([...darkMaskFromRGBA(new Uint8Array([0, 0, 255, 255, 0, 255, 0, 255]), 2, 1)]).toEqual([1, 0]);
    });
});

describe('wordsFromCrops', () => {
    it('水平間距 ≤ 8px 併成一個字，更遠的是另一個字', () => {
        const one = wordsFromCrops([crop(20, 20, 110, 110, [A, 10, 10], [ONE, 23, 10])]); // 間距 8
        expect(one).toHaveLength(1);
        expect([one[0].x0, one[0].x1, one[0].y0, one[0].y1]).toEqual([30, 46, 30, 35]);
        expect(wordsFromCrops([crop(20, 20, 110, 110, [A, 10, 10], [ONE, 24, 10])])).toHaveLength(2); // 間距 9
    });

    it('垂直不重疊的元件不併，容許 2px', () => {
        expect(wordsFromCrops([crop(20, 20, 110, 110, [A, 10, 10], [ONE, 16, 17])])).toHaveLength(1); // 差 2 格空白
        expect(wordsFromCrops([crop(20, 20, 110, 110, [A, 10, 10], [ONE, 16, 18])])).toHaveLength(2);
    });

    it('重疊裁切中的同一元件只算一個字，且換成圖層全域座標', () => {
        const words = wordsFromCrops([crop(0, 0, 110, 110, [A, 50, 50]), crop(30, 30, 110, 110, [A, 20, 20])]);
        expect(words).toHaveLength(1);
        expect([words[0].x0, words[0].y0]).toEqual([50, 50]);
        expect(words[0].mask).toEqual(A.mask);
    });

    it('碰到裁切邊緣且不在圖層邊緣的元件丟棄，另一個裁切裡完整的同一元件則保留', () => {
        expect(wordsFromCrops([crop(30, 30, 110, 110, [A, 0, 20])])).toHaveLength(0); // 左邊緣被切（x0 > 0）
        expect(wordsFromCrops([crop(30, 30, 110, 110, [A, 105, 20])])).toHaveLength(0); // 右邊緣被切（滿 110）
        expect(wordsFromCrops([crop(30, 30, 110, 110, [A, 20, 105])])).toHaveLength(0); // 下邊緣被切
        const both = wordsFromCrops([crop(30, 30, 110, 110, [A, 0, 20]), crop(10, 10, 110, 110, [A, 20, 40])]);
        expect(both).toHaveLength(1);
    });

    it('圖層邊緣不算被切斷', () => {
        expect(wordsFromCrops([crop(0, 0, 110, 110, [A, 0, 0])])).toHaveLength(1); // 左上角
        expect(wordsFromCrops([crop(1100, 600, 100, 100, [A, 95, 95])])).toHaveLength(1); // 右下角（裁切未滿 110）
        // 左側被圖層截斷的裁切（x0 = 0、w < 110）右邊緣仍是被切出來的
        expect(wordsFromCrops([crop(0, 0, 75, 110, [A, 70, 20])])).toHaveLength(0);
    });

    it('字旁邊有被切斷的元件時，整個字丟棄（避免 A1 只剩 A）', () => {
        const half = crop(30, 30, 110, 110, [A, 100, 20], [ONE, 107, 20]); // 1 碰右緣被切
        expect(wordsFromCrops([half])).toHaveLength(0);
        // 另一個裁切裡 A 與 1 都完整 → 讀得到完整的字
        const full = crop(60, 10, 110, 110, [A, 70, 40], [ONE, 77, 40]);
        const words = wordsFromCrops([half, full]);
        expect(words).toHaveLength(1);
        expect(words[0].x1 - words[0].x0).toBe(10);
    });

    it('欄位不合法或遮罩長度不符的裁切略過', () => {
        const ok = crop(20, 20, 110, 110, [A, 10, 10]);
        expect(wordsFromCrops([{ ...ok, bits: 'AAAA' }, { ...ok, w: 0 }, { ...ok, x0: 1.5 }, { ...ok, bits: '!!' }])).toEqual([]);
    });
});

describe('assignWords', () => {
    const words = [wordOf(A, 100, 100), wordOf(B, 200, 100)];
    it('一個字只給一個節點，由近到遠', () => {
        const got = assignWords(words, [{ x: 102, y: 102 }, { x: 110, y: 110 }]);
        expect([...got.keys()]).toEqual([0]);
        expect(got.get(0)).toBe(words[0]);
    });
    it('一個節點只拿一個字', () => {
        const got = assignWords(words, [{ x: 150, y: 102 }], 60);
        expect(got.size).toBe(1);
    });
    it('超過距離上限不配', () => {
        expect(assignWords(words, [{ x: 102 + 46, y: 102 }]).size).toBe(0);
        expect(assignWords(words, [{ x: 102 + 45, y: 102 }]).size).toBe(1);
    });
});

describe('matchGlyph', () => {
    const lib = [entry('A', A), entry('B', B)];
    const flip = (a: ReturnType<typeof art>, ...idx: number[]) => ({ ...a, mask: a.mask.map((v, i) => (idx.includes(i) ? 1 - v : v)) });

    it('完全相同與小幅抗鋸齒差異都讀得出', () => {
        expect(matchGlyph(wordOf(A), lib)).toBe('A');
        expect(matchGlyph(wordOf(flip(A, 0, 6)), lib)).toBe('A'); // 2 個不吻合 / 約 15 個聯集
    });

    it('±1px 位移仍可比對，2px 不行', () => {
        const pad1 = art('.###..', '#...#.', '#####.', '#...#.', '#...#.'); // 字身在右側多出 1 欄空白，等於相對庫位移 1px
        const pad2 = art('..###..', '.#...#.', '.#####.', '.#...#.', '.#...#.');
        expect(matchGlyph(wordOf(pad1), [entry('A', A)])).toBe('A');
        expect(matchGlyph(wordOf(art('.###.', '#...#', '#####', '#...#', '#...#')), [entry('A', A)])).toBe('A');
        const right2 = art('...###.', '..#...#', '..#####', '..#...#', '..#...#');
        expect(matchGlyph(wordOf(right2), [entry('A', A)])).toBeNull();
        expect(matchGlyph(wordOf(pad2), [entry('A', A)])).toBe('A'); // 左右各 1：位移 1px
    });

    it('不吻合率超過 0.15 讀不出', () => {
        expect(matchGlyph(wordOf(flip(A, 0, 6, 7, 8, 11)), lib)).toBeNull();
    });

    it('尺寸差超過 2px 的字形不比對', () => {
        const tall = art('.###.', '#...#', '#####', '#...#', '#...#', '#...#', '#...#', '#...#');
        expect(matchGlyph(wordOf(tall), [entry('A', A)])).toBeNull();
    });

    it('次佳的「其他名稱」差距不足 0.10 讀不出；同名的次佳不算', () => {
        const near = flip(A, 6); // 與 A 差 1 格、與 A' 差 0
        expect(matchGlyph(wordOf(A), [entry('A', A), entry('A', near)])).toBe('A'); // 同名變體不競爭
        expect(matchGlyph(wordOf(A), [entry('A', A), entry('V3', A)])).toBeNull(); // 同遮罩兩個名稱
        expect(matchGlyph(wordOf(A), [entry('A', A), entry('V3', near)])).toBeNull(); // 差距 < 0.10
    });

    it('庫為空時讀不出', () => {
        expect(matchGlyph(wordOf(A), [])).toBeNull();
    });
});

describe('readNodeLetters', () => {
    it('串起切字、指派與比對，只回傳讀到的節點', () => {
        const lib = [entry('A', A), entry('B', B)];
        const c = crop(0, 0, 110, 110, [A, 20, 20], [B, 60, 60]);
        const spots = [{ x: 18, y: 18 }, { x: 58, y: 58 }, { x: 100, y: 5 }];
        const got = readNodeLetters([c], spots, lib);
        expect([...got]).toEqual([[0, 'A'], [1, 'B']]);
    });
});
