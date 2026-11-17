import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGS, pickLang } from '../utils/lang';
import { THEATER_STRINGS, tTheater } from '../utils/theater-i18n';
import { tFor } from '../utils/ui-i18n';
import { importClosure } from './helpers/import-closure';

const ROOT = resolve(__dirname, '..');
const ENTRY = resolve(ROOT, 'entrypoints/theater.content.ts');

// theater.content.ts 實際用到的 15 個鍵（程式碼裡的 t('…') 呼叫）。
const USED_KEYS = [
    'theater.enter', 'theater.exit', 'theater.mute', 'theater.unmute', 'theater.screenshot',
    'theater.popIn', 'theater.hint', 'theater.popoutHint', 'theater.muteNoTab', 'theater.notFound',
    'theater.popInFailed', 'theater.popoutFailed',
    'screenshot.done', 'screenshot.failed', 'screenshot.noReply',
];

describe('劇場工具列文案', () => {
    for (const { code } of LANGS) {
        it(`${code} 的 15 個鍵都可取得，且與 ui-i18n 同值`, () => {
            for (const key of USED_KEYS) {
                const s = tTheater(code, key);
                expect(s, `${code} ${key}`).not.toBe('');
                expect(s, `${code} ${key} 缺譯`).not.toBe(key);
                expect(s, `${code} ${key} 與 ui-i18n 分叉`).toBe(tFor(code, key));
            }
            expect(Object.keys(THEATER_STRINGS[code]).sort()).toEqual([...USED_KEYS].sort());
        });
    }

    it('content script 原始碼用到的 t() 鍵都在小表內', () => {
        const src = readFileSync(ENTRY, 'utf8');
        const used = new Set([...src.matchAll(/\bt\('([\w.]+)'\)/g)].map(m => m[1]));
        expect([...used].sort()).toEqual([...USED_KEYS].sort());
    });
});

describe('劇場 content script 不帶大表', () => {
    it('遞移匯入不含整份介面字串表與譯名表', () => {
        const rel = importClosure('entrypoints/theater.content.ts');
        const banned = ['utils/ui-i18n.ts', 'utils/ui-prefs.ts', 'utils/gamedata-i18n.ts', 'utils/gamedata-names.ts'];
        expect(rel.filter(f => banned.includes(f))).toEqual([]);
        expect(rel).toContain('utils/theater-i18n.ts');
    });
});

describe('語言碼收斂（pickLang）', () => {
    it('支援語系原樣回傳，其餘一律 null', () => {
        for (const { code } of LANGS) expect(pickLang(code)).toBe(code);
        for (const bad of ['zh-CN', 'ZH-TW', 'en-US', '', null, undefined, 0, {}]) {
            expect(pickLang(bad), String(bad)).toBeNull();
        }
    });
});

describe('語言切換即時生效的接線', () => {
    // 工具列的語言在遊戲頁，只能靠 background 轉發；兩端任一邊被拿掉就會退回「要 F5」。
    // 這裡只守住接線存在，實際訊息往返仍需開發者在遊戲頁確認。
    const background = readFileSync(resolve(ROOT, 'entrypoints/background.ts'), 'utf8');
    const entry = readFileSync(ENTRY, 'utf8');

    it('background 收到語言變更會轉發給已連線的遊戲分頁', () => {
        expect(background).toContain('notifyGameTabsLang');
        expect(background).toMatch(/browser\.tabs\.sendMessage\([\s\S]*MSG_UI_LANG_SET/);
    });

    it('轉發前先確認已授權 dmm.com，不自行索取權限', () => {
        const forward = background.slice(background.indexOf('const notifyGameTabsLang'));
        const body = forward.slice(0, forward.indexOf('browser.tabs.sendMessage'));
        expect(body).toMatch(/permissions\.contains/);
        expect(forward).not.toMatch(/permissions\.request/);
    });

    it('劇場腳本收到語言變更會換文案並重繪', () => {
        const handler = entry.slice(entry.indexOf('MSG_UI_LANG_SET'));
        expect(handler).toMatch(/pickLang\(msg\.lang\)/);
        expect(handler).toMatch(/ui\.render\(\)/);
    });
});
