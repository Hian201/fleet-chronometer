// 遊戲頁 MAIN world 端：唯讀讀取地圖 point 圖層節點附近的小區塊，算成字身遮罩（純函式，PIXI 與畫布由
// 呼叫端注入，不依賴 chrome.*）。調度與比對在 background（utils/map-point-ocr.ts）。
//
// AGENTS.md 硬約束 1 的唯一例外：只在擴充明確要求時動作；只讀 `PIXI.utils.TextureCache` 中已載入的
// 材質屬性，不修改、包裝或替換任何遊戲物件，不發請求，讀不到就放棄、不重試。圖像只畫到擴充自己的
// 小畫布，送出的只有遮罩字串。
//
// 材質形狀依據：遊戲 main.js 以 `PIXI.Texture.fromFrame("map" + 海域關卡 + "_" + 圖層名)` 建立地圖背景
// （開發者 2026-11-26 另存的 main.js 靜態閱讀）。live 遊戲框為 PixiJS 4.8.8、`PIXI` 是全域（開發者
// 2026-11-27 遊戲框 console 確認），底圖在 v4 的 `baseTexture.source`；遊戲日後升版時仍嘗試 v5 以後的
// `baseTexture.resource.source`。影格旋轉、裁邊或解析度不是 1 時，影格座標與底圖像素對不上，直接放棄。
//
// MAIN world 只准匯入本檔與 map-glyph-mask.ts；字形庫與比對（map-glyph*.ts）不得進遊戲頁。
import type { GlyphCrop } from './map-glyph';
import { CROP_SIZE, darkMaskFromRGBA, packBits } from './map-glyph-mask';
import type { PointLayerReadRequest, PointLayerReadResult } from './map-labels';

/** 擴充自己的 2D 畫布（OffscreenCanvas 或未加入 DOM 的 canvas）。 */
export interface CanvasContextLike {
    clearRect(x: number, y: number, w: number, h: number): void;
    drawImage(image: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

export interface PointLayerReaderDeps {
    /** 讀 `PIXI.utils.TextureCache[frame]`；沒有就回 undefined。 */
    getTexture(frame: string): unknown;
    createContext(w: number, h: number): CanvasContextLike | null;
    /** performance.now()。 */
    now(): number;
    delay(callback: () => void, delayMs: number): void;
    /** 在瀏覽器閒置時執行（interceptor 的 requestIdle）。 */
    idle(callback: () => void): void;
}

/** 等材質出現的檢查間隔與上限；離開地圖時遊戲會清掉材質快取，所以等不到就放棄。 */
export const POINT_LAYER_POLL_MS = 500;
export const POINT_LAYER_WAIT_MS = 10_000;
/** 從收到要求起的總時限；bridge 的逾時（POINT_LAYER_BRIDGE_TIMEOUT_MS）必須比它長。 */
export const POINT_LAYER_DEADLINE_MS = 25_000;
export const POINT_LAYER_BRIDGE_TIMEOUT_MS = 30_000;

const HALF = CROP_SIZE / 2;

type Layer = { texture: object; source: object; fx: number; fy: number; fw: number; fh: number };
type LayerState = { layer: Layer } | { wait: true } | { fail: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 只讀取材質屬性判斷能不能裁切；尚未載入回 wait，形狀不符回 fail。 */
export function resolvePointLayer(texture: unknown): LayerState {
    if (!isObject(texture)) return { wait: true };
    const base = texture.baseTexture;
    if (!isObject(base)) return { fail: 'no-base-texture' };
    if (base.valid === false || base.hasLoaded === false) return { wait: true };
    const resource = base.resource;
    const source = (isObject(resource) ? resource.source : undefined) ?? base.source;
    if (!isObject(source)) return { fail: 'no-source' };
    if (source.complete === false) return { wait: true };
    if (texture.rotate) return { fail: 'rotated' };
    if (texture.trim) return { fail: 'trimmed' };
    if (base.resolution !== undefined && base.resolution !== 1) return { fail: 'resolution' };
    const frame = texture.frame;
    if (!isObject(frame)) return { fail: 'bad-frame' };
    const { x, y, width, height } = frame;
    if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width <= 0 || height <= 0) return { fail: 'bad-frame' };
    return { layer: { texture, source, fx: x, fy: y, fw: width, fh: height } };
}

/** 節點中心 [x-55, y-55] 起 110×110，截在影格範圍內；完全在影格外回 null。 */
export function cropRect(x: number, y: number, fw: number, fh: number): { x0: number; y0: number; w: number; h: number } | null {
    const left = Math.round(x) - HALF;
    const top = Math.round(y) - HALF;
    const x0 = Math.max(0, left);
    const y0 = Math.max(0, top);
    const w = Math.min(Math.floor(fw), left + CROP_SIZE) - x0;
    const h = Math.min(Math.floor(fh), top + CROP_SIZE) - y0;
    return w > 0 && h > 0 ? { x0, y0, w, h } : null;
}

/**
 * 等材質出現後，每個閒置時段處理一個節點，回傳全部裁切的字身遮罩與主執行緒耗時。
 * 任何例外、材質消失或換掉、逾時都回失敗，不重試。
 */
export function readPointLayer(request: PointLayerReadRequest, deps: PointLayerReaderDeps): Promise<PointLayerReadResult> {
    return new Promise((resolve) => {
        const started = deps.now();
        let totalMs = 0;
        let maxMs = 0;
        const fail = (reason: string) => resolve({ ok: false, reason, totalMs, maxMs });

        const current = (): LayerState => {
            try { return resolvePointLayer(deps.getTexture(request.frame)); }
            catch { return { fail: 'read-error' }; }
        };

        const poll = () => {
            const state = current();
            if ('fail' in state) { fail(state.fail); return; }
            if ('wait' in state) {
                if (deps.now() - started >= POINT_LAYER_WAIT_MS) { fail('timeout'); return; }
                deps.delay(poll, POINT_LAYER_POLL_MS);
                return;
            }
            run(state.layer);
        };

        const run = (layer: Layer) => {
            const crops: GlyphCrop[] = [];
            let ctx: CanvasContextLike | null = null;
            const step = (i: number) => deps.idle(() => {
                if (i >= request.spots.length) { resolve({ ok: true, crops, totalMs, maxMs }); return; }
                if (deps.now() - started >= POINT_LAYER_DEADLINE_MS) { fail('timeout'); return; }
                const t0 = deps.now();
                let reason: string | null = null;
                try {
                    // 每個節點都重新確認：玩家離開地圖時材質會被清掉或換掉。
                    const state = current();
                    if (!('layer' in state) || state.layer.texture !== layer.texture || state.layer.source !== layer.source) {
                        reason = 'texture-gone';
                    } else {
                        const spot = request.spots[i];
                        const rect = cropRect(spot.x, spot.y, layer.fw, layer.fh);
                        if (rect) {
                            ctx ??= deps.createContext(CROP_SIZE, CROP_SIZE);
                            if (!ctx) {
                                reason = 'no-canvas';
                            } else {
                                const { x0, y0, w, h } = rect;
                                ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
                                ctx.drawImage(layer.source as never, layer.fx + x0, layer.fy + y0, w, h, 0, 0, w, h);
                                const rgba = ctx.getImageData(0, 0, w, h).data;
                                crops.push({ x0, y0, w, h, bits: packBits(darkMaskFromRGBA(rgba, w, h), w, h) });
                            }
                        }
                    }
                } catch {
                    // 畫布被汙染（SecurityError）、底圖已釋放等都在這裡。
                    reason = 'read-error';
                }
                const spent = deps.now() - t0;
                totalMs += spent;
                maxMs = Math.max(maxMs, spent);
                if (reason) { fail(reason); return; }
                step(i + 1);
            });
            step(0);
        };

        poll();
    });
}
