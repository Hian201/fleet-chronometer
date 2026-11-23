import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    loadSenkaTarget, onSenkaTargetChange, parseSenkaTarget, saveSenkaTarget,
    SENKA_TARGET_KEY, SENKA_TARGET_RANKS,
} from '../utils/senka-prefs';

function installStorage() {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => map.get(k) ?? null,
            setItem: (k: string, v: string) => { map.set(k, String(v)); },
            removeItem: (k: string) => { map.delete(k); },
            clear: () => { map.clear(); },
        },
        configurable: true,
    });
    return map;
}

let storageMap: Map<string, string>;

beforeEach(() => {
    storageMap = installStorage();
});

afterEach(() => {
    try { delete (globalThis as { localStorage?: unknown }).localStorage; } catch { /* ignore */ }
    try { delete (globalThis as { window?: unknown }).window; } catch { /* ignore */ }
});

describe('senkaTarget 驗證與 localStorage 持久化', () => {
    it('預設為 null（不設目標），且不寫入預設鍵', () => {
        expect(loadSenkaTarget()).toBeNull();
        expect(storageMap.has(SENKA_TARGET_KEY)).toBe(false);
    });

    it('只接受 5／20／100／500 四個群別名次與非負安全整數自訂分數', () => {
        for (const rank of SENKA_TARGET_RANKS) {
            expect(parseSenkaTarget({ type: 'rank', rank })).toEqual({ type: 'rank', rank });
        }
        expect(parseSenkaTarget({ type: 'custom', score: 0 })).toEqual({ type: 'custom', score: 0 });
        expect(parseSenkaTarget({ type: 'custom', score: 4500 })).toEqual({ type: 'custom', score: 4500 });
        // 剝除多餘欄位
        expect(parseSenkaTarget({ type: 'rank', rank: 500, extra: 'x' })).toEqual({ type: 'rank', rank: 500 });

        for (const bad of [
            null, undefined, '500', [], {},
            { type: 'none' },
            { type: 'rank', rank: 1 },
            { type: 'rank', rank: 50 },
            { type: 'rank', rank: 501 },
            { type: 'rank', rank: '500' },
            { type: 'custom', score: -1 },
            { type: 'custom', score: 12.5 },
            { type: 'custom', score: Number.NaN },
            { type: 'custom', score: '4500' },
        ]) {
            expect(parseSenkaTarget(bad), JSON.stringify(bad)).toBeNull();
        }
    });

    it('讀寫與設回 null（移除鍵）正常往返', () => {
        expect(saveSenkaTarget({ type: 'rank', rank: 500 })).toEqual({ type: 'rank', rank: 500 });
        expect(loadSenkaTarget()).toEqual({ type: 'rank', rank: 500 });

        expect(saveSenkaTarget({ type: 'custom', score: 4200 })).toEqual({ type: 'custom', score: 4200 });
        expect(loadSenkaTarget()).toEqual({ type: 'custom', score: 4200 });

        expect(saveSenkaTarget(null)).toBeNull();
        expect(storageMap.has(SENKA_TARGET_KEY)).toBe(false);
        expect(loadSenkaTarget()).toBeNull();
    });

    it('localStorage 含有壞 JSON 或非法內容時退回 null', () => {
        storageMap.set(SENKA_TARGET_KEY, '{bad json');
        expect(loadSenkaTarget()).toBeNull();

        storageMap.set(SENKA_TARGET_KEY, JSON.stringify({ type: 'rank', rank: 501 }));
        expect(loadSenkaTarget()).toBeNull();
    });

    it('onSenkaTargetChange 響應 storage 事件並於 abort 後停止接收', () => {
        const listeners = new Set<(e: StorageEvent) => void>();
        Object.defineProperty(globalThis, 'window', {
            value: {
                addEventListener: (_type: string, fn: (e: StorageEvent) => void) => { listeners.add(fn); },
                removeEventListener: (_type: string, fn: (e: StorageEvent) => void) => { listeners.delete(fn); },
            },
            configurable: true,
        });

        const controller = new AbortController();
        const cb = vi.fn();
        onSenkaTargetChange(cb, controller.signal);

        storageMap.set(SENKA_TARGET_KEY, JSON.stringify({ type: 'rank', rank: 100 }));
        for (const fn of listeners) fn({ key: 'other-key' } as StorageEvent);
        expect(cb).not.toHaveBeenCalled();

        for (const fn of listeners) fn({ key: SENKA_TARGET_KEY } as StorageEvent);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenLastCalledWith({ type: 'rank', rank: 100 });

        storageMap.delete(SENKA_TARGET_KEY);
        for (const fn of listeners) fn({ key: SENKA_TARGET_KEY } as StorageEvent);
        expect(cb).toHaveBeenLastCalledWith(null);

        controller.abort();
        expect(listeners.size).toBe(0);
    });
});
