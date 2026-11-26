// 地圖 point 圖層上的節點字母辨識（純函式，不依賴 chrome.* 或 DOM）。
//
// 依據：
// - 本專案 2026-11-27 的離線實驗（62-1～62-3 留一驗證，讀對 12／10／11、讀錯 0）；參數與結果見
//   docs/completion-plan.md 4.11；
// - poi（MIT）`fcd/map-ocr.js` 以 point 圖層辨識初始節點名的做法，clean-room 重寫、未複製程式碼，
//   見 THIRD-PARTY-NOTICES.md；
// - KagamiChan/kcs2-mapdata（MIT）收錄的遊戲地圖資源，字形庫 `utils/map-glyph-data.ts` 由
//   tools/map-glyphs/generate.py 產生。
//
// 流程：遊戲頁只送節點附近的字身遮罩裁切 → `wordsFromCrops` 切成字 → `assignWords` 一對一配到節點 →
// `matchGlyph` 與字形庫容錯比對。寧可讀不出，也不讀錯（AGENTS.md 硬約束 8）。

import { MAP_GLYPHS } from './map-glyph-data';
import { CROP_SIZE, unpackBits } from './map-glyph-mask';

/** 節點附近的裁切（見 map-glyph-mask.ts 的 CROP_SIZE）；x0／y0 為圖層座標。 */
export type GlyphCrop = { x0: number; y0: number; w: number; h: number; bits: string };
export type GlyphEntry = { name: string; w: number; h: number; bits: string };
/** 圖層全域座標的字；x1／y1 不含，mask 為 (x1-x0)×(y1-y0) 的 0／1。 */
export type GlyphWord = { x0: number; y0: number; x1: number; y1: number; mask: Uint8Array };

// 以下參數與 tools/map-glyphs/generate.py 一致，改動要兩邊同步並重跑離線驗證。
const WORD_GAP = 8; // 水平間距 ≤ 8px 併成一個字（4px 會把 A1 拆成 A 與 1）
const WORD_OVERLAP = 2; // 垂直重疊的容許
const ASSIGN_DIST = 45;
const SIZE_DIFF = 2;
const MATCH_MAX = 0.15;
const MATCH_MARGIN = 0.1;
const CROP_LIMIT = 512; // 裁切邊長上限，擋掉不合理輸入

type Box = { x0: number; y0: number; x1: number; y1: number };
type Part = Box & { mask: Uint8Array };

const near = (a: Box, b: Box): boolean =>
    Math.max(a.x0 - b.x1, b.x0 - a.x1) <= WORD_GAP && !(a.y1 < b.y0 - WORD_OVERLAP || a.y0 > b.y1 + WORD_OVERLAP);

const inside = (a: Box, b: Box): boolean => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

/** 8 連通元件，座標為遮罩內的區域座標。 */
function connectedParts(mask: Uint8Array, w: number, h: number): Part[] {
    const seen = new Uint8Array(w * h);
    const parts: Part[] = [];
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || seen[start]) continue;
        const stack = [start];
        const pts: number[] = [];
        seen[start] = 1;
        let x0 = w, y0 = h, x1 = 0, y1 = 0;
        while (stack.length) {
            const cur = stack.pop()!;
            pts.push(cur);
            const cx = cur % w;
            const cy = (cur - cx) / w;
            if (cx < x0) x0 = cx;
            if (cx + 1 > x1) x1 = cx + 1;
            if (cy < y0) y0 = cy;
            if (cy + 1 > y1) y1 = cy + 1;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                    const n = ny * w + nx;
                    if (mask[n] && !seen[n]) {
                        seen[n] = 1;
                        stack.push(n);
                    }
                }
            }
        }
        const pw = x1 - x0;
        const pm = new Uint8Array(pw * (y1 - y0));
        for (const p of pts) pm[(Math.floor(p / w) - y0) * pw + (p % w) - x0] = 1;
        parts.push({ x0, y0, x1, y1, mask: pm });
    }
    return parts;
}

function mergeParts(a: Part, b: Part): Part {
    const x0 = Math.min(a.x0, b.x0), y0 = Math.min(a.y0, b.y0);
    const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
    const w = x1 - x0;
    const mask = new Uint8Array(w * (y1 - y0));
    for (const p of [a, b]) {
        const pw = p.x1 - p.x0;
        for (let i = 0; i < p.mask.length; i++) {
            if (p.mask[i]) mask[(p.y0 - y0 + Math.floor(i / pw)) * w + (p.x0 - x0) + (i % pw)] = 1;
        }
    }
    return { x0, y0, x1, y1, mask };
}

/**
 * 各裁切取元件、換回圖層全域座標、合併重疊裁切中的同一元件，再併成字。
 * 碰到裁切邊緣（且該邊不是圖層邊緣）的元件可能只是半個字，一律丟棄；字的旁邊若有被丟棄的元件
 * （例如 A1 的 1 被切掉），整個字也丟棄，免得 A 被當成完整的字。
 */
export function wordsFromCrops(crops: GlyphCrop[]): GlyphWord[] {
    const kept = new Map<string, Part>();
    const cuts: Box[] = [];
    for (const crop of crops) {
        const { x0, y0, w, h } = crop;
        if (![x0, y0, w, h].every(Number.isInteger) || w <= 0 || h <= 0 || w > CROP_LIMIT || h > CROP_LIMIT) continue;
        let mask: Uint8Array;
        try {
            mask = unpackBits(crop.bits, w, h);
        } catch {
            continue;
        }
        // 右、下邊：裁切未滿 110 且左、上不從 0 起，才是圖層邊緣；其餘一律當作被裁切邊界切斷。
        const rightIsLayer = x0 > 0 && w < CROP_SIZE;
        const bottomIsLayer = y0 > 0 && h < CROP_SIZE;
        for (const p of connectedParts(mask, w, h)) {
            const g = { x0: p.x0 + x0, y0: p.y0 + y0, x1: p.x1 + x0, y1: p.y1 + y0 };
            const cutOff = (p.x0 === 0 && x0 > 0) || (p.y0 === 0 && y0 > 0)
                || (p.x1 === w && !rightIsLayer) || (p.y1 === h && !bottomIsLayer);
            if (cutOff) cuts.push(g);
            else kept.set(`${g.x0},${g.y0},${g.x1},${g.y1}`, { ...g, mask: p.mask });
        }
    }
    const parts = [...kept.values()];
    let words = parts.slice();
    for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < words.length && !merged; i++) {
            for (let j = i + 1; j < words.length; j++) {
                if (!near(words[i], words[j])) continue;
                words[i] = mergeParts(words[i], words[j]);
                words.splice(j, 1);
                merged = true;
                break;
            }
        }
    }
    const orphanCuts = cuts.filter(c => !parts.some(k => inside(c, k)));
    words = words.filter(wd => !orphanCuts.some(c => near(wd, c)));
    return words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** 字中心與節點中心距離 ≤ maxDist 的組合由近到遠一對一，回傳 spot index → 字。 */
export function assignWords(
    words: GlyphWord[],
    spots: Array<{ x: number; y: number }>,
    maxDist = ASSIGN_DIST,
): Map<number, GlyphWord> {
    const pairs: Array<{ d: number; wi: number; si: number }> = [];
    words.forEach((wd, wi) => {
        const cx = (wd.x0 + wd.x1) / 2;
        const cy = (wd.y0 + wd.y1) / 2;
        spots.forEach((s, si) => {
            const d = Math.hypot(cx - s.x, cy - s.y);
            if (d <= maxDist) pairs.push({ d, wi, si });
        });
    });
    pairs.sort((a, b) => a.d - b.d || a.wi - b.wi || a.si - b.si);
    const usedWords = new Set<number>();
    const out = new Map<number, GlyphWord>();
    for (const { wi, si } of pairs) {
        if (usedWords.has(wi) || out.has(si)) continue;
        usedWords.add(wi);
        out.set(si, words[wi]);
    }
    return out;
}

/** ±1px 位移內，兩個遮罩「不吻合像素／聯集像素」的最小值。 */
function mismatch(a: Uint8Array, aw: number, ah: number, b: Uint8Array, bw: number, bh: number): number {
    let best = 1;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            let bad = 0;
            let tot = 0;
            for (let y = Math.min(0, dy); y < Math.max(ah, bh + dy); y++) {
                for (let x = Math.min(0, dx); x < Math.max(aw, bw + dx); x++) {
                    const va = x >= 0 && x < aw && y >= 0 && y < ah ? a[y * aw + x] : 0;
                    const xb = x - dx;
                    const yb = y - dy;
                    const vb = xb >= 0 && xb < bw && yb >= 0 && yb < bh ? b[yb * bw + xb] : 0;
                    if (va || vb) {
                        tot++;
                        if (va !== vb) bad++;
                    }
                }
            }
            if (tot) best = Math.min(best, bad / tot);
        }
    }
    return best;
}

const unpacked = new WeakMap<GlyphEntry, Uint8Array>();
function maskOf(e: GlyphEntry): Uint8Array {
    let m = unpacked.get(e);
    if (!m) unpacked.set(e, (m = unpackBits(e.bits, e.w, e.h)));
    return m;
}

/**
 * 與字形庫容錯比對。每個名稱取最小不吻合率；最佳 ≤ 0.15，且比次佳的其他名稱低至少 0.10 才回傳名稱。
 * 尺寸差超過 2px 的字形略過。同名的多個變體不互相競爭。
 */
export function matchGlyph(word: GlyphWord, library: ReadonlyArray<GlyphEntry> = MAP_GLYPHS): string | null {
    const w = word.x1 - word.x0;
    const h = word.y1 - word.y0;
    const scores = new Map<string, number>();
    for (const e of library) {
        if (Math.abs(e.w - w) > SIZE_DIFF || Math.abs(e.h - h) > SIZE_DIFF) continue;
        const s = mismatch(word.mask, w, h, maskOf(e), e.w, e.h);
        if (s < (scores.get(e.name) ?? 2)) scores.set(e.name, s);
    }
    const rank = [...scores].sort((a, b) => a[1] - b[1]);
    if (!rank.length || rank[0][1] > MATCH_MAX) return null;
    if (rank.length > 1 && rank[1][1] - rank[0][1] < MATCH_MARGIN) return null;
    return rank[0][0];
}

/** 裁切 → 字 → 配到節點 → 比對。回傳 spot index → 名稱（只含讀到的）。 */
export function readNodeLetters(
    crops: GlyphCrop[],
    spots: Array<{ x: number; y: number }>,
    library: ReadonlyArray<GlyphEntry> = MAP_GLYPHS,
): Map<number, string> {
    const out = new Map<number, string>();
    for (const [si, word] of assignWords(wordsFromCrops(crops), spots)) {
        const name = matchGlyph(word, library);
        if (name) out.set(si, name);
    }
    return out;
}
