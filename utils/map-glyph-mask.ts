// 字形遮罩的取得與位元打包（純函式，不依賴 chrome.* 或 DOM）。
//
// 遊戲頁 MAIN world 與 background 都會匯入本檔，所以必須保持極小，不得匯入字形庫或其他大模組。
// 打包格式與 tools/map-glyphs/generate.py 一致：列優先，第 i 個像素在第 i>>3 位元組的
// (7 - (i & 7)) 位元，整串再做 base64。依據見 docs/completion-plan.md 4.11 的離線實驗。

/** 字身遮罩：alpha ≥ 128 且亮度（299R＋587G＋114B）/1000 < 110 的像素為 1，其餘為 0。 */
export function darkMaskFromRGBA(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) {
        const p = i * 4;
        if (rgba[p + 3] >= 128 && rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114 < 110000) mask[i] = 1;
    }
    return mask;
}

/** 0／1 遮罩（長度 w*h）打包成 base64。 */
export function packBits(mask: ArrayLike<number>, w: number, h: number): string {
    const bytes = new Uint8Array((w * h + 7) >> 3);
    for (let i = 0; i < w * h; i++) {
        if (mask[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

/** `packBits` 的反向。長度與 w*h 對不上時丟出 RangeError，不補零猜測。 */
export function unpackBits(bits: string, w: number, h: number): Uint8Array {
    const bin = atob(bits);
    if (bin.length !== (w * h + 7) >> 3) throw new RangeError('遮罩長度與尺寸不符');
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
    return mask;
}
