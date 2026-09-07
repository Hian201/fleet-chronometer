import { afterEach, describe, expect, it } from 'vitest';
import { isDebugUiEnabled } from '../utils/debug-ui';

/** node 環境沒有 localStorage；測強制開啟時掛一個最小假實作。 */
function installMemoryStorage() {
    const map = new Map<string, string>();
    const storage = {
        getItem: (k: string) => map.has(k) ? map.get(k)! : null,
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    return storage;
}

describe('isDebugUiEnabled', () => {
    afterEach(() => {
        try { delete (globalThis as { localStorage?: unknown }).localStorage; } catch { /* ignore */ }
    });

    it('localStorage kc-debug-ui=1 時強制開啟（供正式建置本機暫時打開）', () => {
        const storage = installMemoryStorage();
        storage.setItem('kc-debug-ui', '1');
        expect(isDebugUiEnabled()).toBe(true);
    });

    it('無 localStorage 時只有 WXT serve（npm run dev）才開啟', () => {
        expect(isDebugUiEnabled()).toBe(import.meta.env.COMMAND === 'serve');
    });
});
