// 獨立測試：情報總括「戰果」分區在任務譯文尚未載入時的自動補載與重繪。
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../utils/db';
import { questCatalogLocaleLoaded } from '../utils/quest-catalog-localization';
import { senkaMonthWindow } from '../utils/senka';
import { setLang } from '../utils/ui-i18n';
import { GameState } from '../utils/state';
import { senkaSection } from '../entrypoints/overview/sections/senka';

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setLang('zh-TW');
    await Promise.all([
        db.resources.clear(),
        db.sorties.clear(),
        db.questObserved.clear(),
        db.snapshot.clear(),
    ]);
});

describe('senkaSection 任務譯文非同步載入與重繪', () => {
    it('非日文介面在任務譯文尚未載入時先顯示日文原文，載入完成後自動重繪為譯名', async () => {
        const parsed = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>');
        const host = parsed.document.getElementById('host') as unknown as HTMLElement;
        vi.stubGlobal('document', parsed.document);
        vi.stubGlobal('window', parsed.window);
        vi.stubGlobal('localStorage', {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
        });

        setLang('zh-TW');
        expect(questCatalogLocaleLoaded('zh-TW')).toBe(false);

        const now = Date.UTC(2026, 10, 15, 1, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const win = senkaMonthWindow({ year: 2026, month: 11 });
        await db.resources.bulkPut([
            { eventId: 1, ts: win.start - 60_000, m: [1000, 1000, 1000, 1000, 10, 10, 10, 10], exp: 1_000_000 },
            { eventId: 2, ts: win.start, m: [1000, 1000, 1000, 1000, 10, 10, 10, 10], exp: 1_000_000 },
        ]);
        await db.questObserved.put({ eventId: 30, questNo: 893, ts: now - 10_000 });

        const controller = new AbortController();
        await senkaSection.render(host, {
            rerender() {},
            state: new GameState(),
            async reloadState() {},
            signal: controller.signal,
        });

        await vi.waitFor(() => {
            expect(questCatalogLocaleLoaded('zh-TW')).toBe(true);
            expect(host.querySelector('#sk-eo details[data-fold="quest"] tbody')!.textContent)
                .toContain('確保基地周邊海域的安全');
        });
        controller.abort();
    });
});
