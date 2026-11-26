// 遊戲頁 MAIN 端的 point 圖層讀取（utils/map-point-layer.ts）：以假的 PIXI 材質與假畫布驗證。
import { describe, expect, it } from 'vitest';
import { unpackBits } from '../utils/map-glyph-mask';
import {
    POINT_LAYER_POLL_MS, POINT_LAYER_WAIT_MS, cropRect, readPointLayer, resolvePointLayer,
    type CanvasContextLike, type PointLayerReaderDeps,
} from '../utils/map-point-layer';
import type { PointLayerReadResult } from '../utils/map-labels';

const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
};

const FRAME = 'map06201_map62-1_point';
/** PIXI v5 形狀：底圖在 baseTexture.resource.source。 */
const textureV5 = (frame = { x: 100, y: 50, width: 1200, height: 720 }) => deepFreeze({
    baseTexture: { valid: true, resolution: 1, resource: { source: { complete: true, tag: 'img' } } },
    frame, rotate: 0, trim: undefined,
});

/** 手動推進的排程：delay 與 idle 都排進佇列，一次執行一個。 */
function harness(getTexture: () => unknown, opts: { failDraw?: boolean } = {}) {
    let clock = 0;
    const queue: Array<{ kind: 'delay' | 'idle'; run: () => void }> = [];
    const draws: number[][] = [];
    const ctx: CanvasContextLike = {
        clearRect: () => { },
        drawImage: (_img: never, ...args: number[]) => {
            if (opts.failDraw) throw new DOMException('tainted', 'SecurityError');
            draws.push(args);
        },
        getImageData: (_x, _y, w, h) => {
            // 左上角一個深色像素，其餘透明
            const data = new Uint8ClampedArray(w * h * 4);
            data.set([0, 0, 0, 255]);
            return { data };
        },
    };
    let contexts = 0;
    const deps: PointLayerReaderDeps = {
        getTexture,
        createContext: () => { contexts++; return ctx; },
        now: () => clock,
        delay: (run, ms) => queue.push({ kind: 'delay', run: () => { clock += ms; run(); } }),
        idle: (run) => queue.push({ kind: 'idle', run: () => { clock += 2; run(); } }),
    };
    return {
        deps, draws, queue,
        contexts: () => contexts,
        /** 執行一個排程；回傳執行的種類。 */
        tick: () => { const next = queue.shift(); next?.run(); return next?.kind; },
        drain: async (p: Promise<PointLayerReadResult>) => { while (queue.length) queue.shift()!.run(); return p; },
    };
}

describe('cropRect', () => {
    it('以節點中心 [x-55, y-55] 起 110×110，截在影格內', () => {
        expect(cropRect(600, 300, 1200, 720)).toEqual({ x0: 545, y0: 245, w: 110, h: 110 });
        expect(cropRect(20, 30, 1200, 720)).toEqual({ x0: 0, y0: 0, w: 75, h: 85 });
        expect(cropRect(1190, 700, 1200, 720)).toEqual({ x0: 1135, y0: 645, w: 65, h: 75 });
        expect(cropRect(1300, 300, 1200, 720)).toBeNull();
    });
});

describe('resolvePointLayer', () => {
    it('v5 取 resource.source、v4 取 baseTexture.source', () => {
        const v4 = deepFreeze({ baseTexture: { hasLoaded: true, source: { complete: true } }, frame: { x: 0, y: 0, width: 10, height: 10 }, rotate: 0, trim: null });
        expect(resolvePointLayer(v4)).toMatchObject({ layer: { source: v4.baseTexture.source, fw: 10 } });
        const v5 = textureV5();
        expect(resolvePointLayer(v5)).toMatchObject({ layer: { source: v5.baseTexture.resource.source, fx: 100, fy: 50 } });
    });
    it('尚未出現或尚未載入時等待；旋轉、裁邊、解析度不是 1、沒有底圖時放棄', () => {
        expect(resolvePointLayer(undefined)).toEqual({ wait: true });
        expect(resolvePointLayer({ baseTexture: { valid: false } })).toEqual({ wait: true });
        expect(resolvePointLayer({ baseTexture: { source: { complete: false } } })).toEqual({ wait: true });
        const base = { baseTexture: { source: {} }, frame: { x: 0, y: 0, width: 1, height: 1 } };
        expect(resolvePointLayer({ ...base, rotate: 2 })).toEqual({ fail: 'rotated' });
        expect(resolvePointLayer({ ...base, trim: { x: 1 } })).toEqual({ fail: 'trimmed' });
        expect(resolvePointLayer({ ...base, baseTexture: { source: {}, resolution: 2 } })).toEqual({ fail: 'resolution' });
        expect(resolvePointLayer({ frame: base.frame })).toEqual({ fail: 'no-base-texture' });
        expect(resolvePointLayer({ baseTexture: {} })).toEqual({ fail: 'no-source' });
        expect(resolvePointLayer({ ...base, frame: { x: 0, y: 0, width: 0, height: 1 } })).toEqual({ fail: 'bad-frame' });
    });
});

describe('readPointLayer', () => {
    const request = deepFreeze({ requestId: 'r', frame: FRAME, spots: [{ x: 600, y: 300 }, { x: 20, y: 30 }, { x: 5000, y: 5000 }] });

    it('每個閒置時段處理一個節點；以影格位移畫到自己的畫布、裁切截在影格內；不寫入遊戲物件', async () => {
        const texture = textureV5();
        const h = harness(() => texture);
        const p = readPointLayer(request, h.deps);
        // 第一個節點要等閒置時段，呼叫當下不畫
        expect(h.draws).toHaveLength(0);
        expect(h.tick()).toBe('idle');
        expect(h.draws).toHaveLength(1);
        expect(h.tick()).toBe('idle');
        expect(h.draws).toHaveLength(2);
        const result = await h.drain(p);
        expect(h.draws).toEqual([
            [100 + 545, 50 + 245, 110, 110, 0, 0, 110, 110],
            [100 + 0, 50 + 0, 75, 85, 0, 0, 75, 85],
        ]);
        expect(h.contexts()).toBe(1);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // 影格外的節點不產生裁切
        expect(result.crops.map(c => [c.x0, c.y0, c.w, c.h])).toEqual([[545, 245, 110, 110], [0, 0, 75, 85]]);
        expect(unpackBits(result.crops[1].bits, 75, 85)[0]).toBe(1);
        expect(result.totalMs).toBeGreaterThanOrEqual(0);
        expect(result.maxMs).toBeLessThanOrEqual(result.totalMs);
    });

    it('材質晚出現時以低頻檢查；等不到就逾時失敗', async () => {
        let texture: unknown;
        const texture5 = textureV5();
        const late = harness(() => texture);
        const p = readPointLayer(request, late.deps);
        expect(late.tick()).toBe('delay');
        texture = texture5;
        expect(late.tick()).toBe('delay');
        expect(late.tick()).toBe('idle');
        expect((await late.drain(p)).ok).toBe(true);

        const never = harness(() => undefined);
        const r = await never.drain(readPointLayer(request, never.deps));
        expect(r).toMatchObject({ ok: false, reason: 'timeout' });
        expect(never.draws).toHaveLength(0);
        expect(POINT_LAYER_WAIT_MS / POINT_LAYER_POLL_MS).toBe(20);
    });

    it('處理途中材質消失或換掉就失敗，不再讀', async () => {
        let texture: unknown = textureV5();
        const h = harness(() => texture);
        const p = readPointLayer(request, h.deps);
        h.tick();
        texture = undefined;
        expect(await h.drain(p)).toMatchObject({ ok: false, reason: 'texture-gone' });
        expect(h.draws).toHaveLength(1);

        let swapped: unknown = textureV5();
        const h2 = harness(() => swapped);
        const p2 = readPointLayer(request, h2.deps);
        h2.tick();
        swapped = textureV5();
        expect(await h2.drain(p2)).toMatchObject({ ok: false, reason: 'texture-gone' });
    });

    it('畫布例外（例如被汙染）、取材質丟例外、形狀不符都回失敗', async () => {
        const one = textureV5();
        const tainted = harness(() => one, { failDraw: true });
        expect(await tainted.drain(readPointLayer(request, tainted.deps))).toMatchObject({ ok: false, reason: 'read-error' });

        const throwing = harness(() => { throw new Error('boom'); });
        expect(await throwing.drain(readPointLayer(request, throwing.deps))).toMatchObject({ ok: false, reason: 'read-error' });

        const turned = { ...textureV5(), rotate: 2 };
        const rotated = harness(() => turned);
        expect(await rotated.drain(readPointLayer(request, rotated.deps))).toMatchObject({ ok: false, reason: 'rotated' });
    });
});
