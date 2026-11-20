// utils/ui-prefs.ts：語言／主題偏好的持久化。Node 環境以最小的 localStorage、document、
// window、navigator、browser 替身驗證；不涉及 chrome.*。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLang, setLang } from '../utils/ui-i18n';
import { MSG_UI_LANG_SET } from '../utils/game-page';
import { applyTheme, getTheme, initLang, onPrefsChange, persistLang, persistTheme } from '../utils/ui-prefs';

class MemoryStorage {
    private map = new Map<string, string>();
    getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
    setItem(k: string, v: string) { this.map.set(k, String(v)); }
}

type StorageListener = (e: { key: string | null; newValue: string | null }) => void;

let storage: MemoryStorage;
let docEl: { dataset: Record<string, string> };
let listeners: StorageListener[];
let sendMessage: ReturnType<typeof vi.fn>;
let browserLanguage: string;

beforeEach(() => {
    storage = new MemoryStorage();
    docEl = { dataset: {} };
    listeners = [];
    browserLanguage = 'en-US';
    sendMessage = vi.fn(() => Promise.resolve());
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { documentElement: docEl });
    vi.stubGlobal('window', {
        addEventListener: (type: string, cb: StorageListener) => { if (type === 'storage') listeners.push(cb); },
    });
    vi.stubGlobal('navigator', { get language() { return browserLanguage; } });
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    setLang('zh-TW');
});
afterEach(() => {
    vi.unstubAllGlobals();
    setLang('zh-TW');
});

describe('initLang', () => {
    it('讀到有效的儲存語言就套用並回傳', () => {
        storage.setItem('kc-panel-lang', 'ja');
        expect(initLang()).toBe('ja');
        expect(getLang()).toBe('ja');
    });

    it('沒有儲存值時依瀏覽器語言偵測（ja／zh／其他）', () => {
        browserLanguage = 'ja-JP';
        expect(initLang()).toBe('ja');
        browserLanguage = 'zh-Hant-TW';
        expect(initLang()).toBe('zh-TW');
        browserLanguage = 'fr-FR';
        expect(initLang()).toBe('en');
        expect(getLang()).toBe('en');
    });

    it('儲存值無效時退回瀏覽器偵測，不採用無效值', () => {
        storage.setItem('kc-panel-lang', 'klingon');
        browserLanguage = 'ja';
        expect(initLang()).toBe('ja');
    });

    it('把語言鏡像給 background', () => {
        storage.setItem('kc-panel-lang', 'en');
        initLang();
        expect(sendMessage).toHaveBeenCalledWith({ type: MSG_UI_LANG_SET, lang: 'en' });
    });

    it('沒有 browser 全域（非擴充環境）時不拋錯', () => {
        vi.stubGlobal('browser', undefined);
        expect(() => initLang()).not.toThrow();
    });

    it('鏡像訊息被拒絕時不產生未處理的 rejection', async () => {
        sendMessage.mockReturnValue(Promise.reject(new Error('no receiver')));
        expect(() => initLang()).not.toThrow();
        await Promise.resolve();
    });
});

describe('persistLang', () => {
    it('套用到 i18n 層並寫入 localStorage', () => {
        persistLang('en');
        expect(getLang()).toBe('en');
        expect(storage.getItem('kc-panel-lang')).toBe('en');
        expect(sendMessage).toHaveBeenCalledWith({ type: MSG_UI_LANG_SET, lang: 'en' });
    });

    it('寫入後 initLang 可還原同一語言', () => {
        persistLang('ja');
        setLang('zh-TW');
        expect(initLang()).toBe('ja');
    });
});

describe('主題', () => {
    it('預設 dark；只有 "light" 才是 light，其餘值一律 dark', () => {
        expect(getTheme()).toBe('dark');
        storage.setItem('kc-theme', 'light');
        expect(getTheme()).toBe('light');
        storage.setItem('kc-theme', 'purple');
        expect(getTheme()).toBe('dark');
    });

    it('applyTheme 寫入 <html data-theme>，省略參數時讀 localStorage', () => {
        applyTheme('light');
        expect(docEl.dataset.theme).toBe('light');
        storage.setItem('kc-theme', 'dark');
        applyTheme();
        expect(docEl.dataset.theme).toBe('dark');
    });

    it('persistTheme 同時寫入儲存與 DOM', () => {
        persistTheme('light');
        expect(storage.getItem('kc-theme')).toBe('light');
        expect(docEl.dataset.theme).toBe('light');
    });
});

describe('onPrefsChange（跨頁面同步）', () => {
    const fire = (key: string | null, newValue: string | null) => listeners.forEach(l => l({ key, newValue }));

    it('其他頁面切換語言：套用新語言並通知 lang', () => {
        const cb = vi.fn();
        onPrefsChange(cb);
        fire('kc-panel-lang', 'ja');
        expect(getLang()).toBe('ja');
        expect(cb).toHaveBeenCalledExactlyOnceWith('lang');
    });

    it('語言碼無效或與目前相同時不通知', () => {
        const cb = vi.fn();
        onPrefsChange(cb);
        fire('kc-panel-lang', 'klingon');
        fire('kc-panel-lang', 'zh-TW');
        fire('kc-panel-lang', null);
        expect(cb).not.toHaveBeenCalled();
    });

    it('其他頁面切換主題：重新套用並通知 theme', () => {
        const cb = vi.fn();
        onPrefsChange(cb);
        storage.setItem('kc-theme', 'light');
        fire('kc-theme', 'light');
        expect(docEl.dataset.theme).toBe('light');
        expect(cb).toHaveBeenCalledExactlyOnceWith('theme');
    });

    it('無關的 key 被忽略', () => {
        const cb = vi.fn();
        onPrefsChange(cb);
        fire('other', 'x');
        expect(cb).not.toHaveBeenCalled();
    });
});
