import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overview = readFileSync(new URL('../entrypoints/overview/sections/fleet-overview.ts', import.meta.url), 'utf8');
const overviewHtml = readFileSync(new URL('../entrypoints/overview/index.html', import.meta.url), 'utf8');
const config = readFileSync(new URL('../wxt.config.ts', import.meta.url), 'utf8');
const localCodeSection = overview.slice(overview.indexOf('// ── 本機代碼複製'));

describe('艦隊代碼複製介面', () => {
    it('按鈕只開啟本機代碼對話框，且出擊／支援選取彼此分開', () => {
        expect(overview).toContain('id="fo-fleet-codes"');
        expect(overview).toContain('data-fleet-code="owned"');
        expect(overview).toContain('data-fleet-code="sortie"');
        expect(overview).toContain('data-fleet-code="support"');
        expect(overview).toContain('data-fleet-code-selection="sortie"');
        expect(overview).toContain('data-fleet-code-selection="support"');
        expect(overview).toContain('data-fleet-code-air-base-selection="sortie"');
        expect(overview).toContain('data-fleet-code-air-base-choices="sortie"');
        expect(overview).toContain('buildSelectedDeckBuilder(state, fleetNos, airBaseKeys)');
        expect(overview).toContain('buildSelectedSupportDeckBuilder(state, fleetNos)');
        expect(overview).toContain('ov.fleetCodesSupportHint');
        expect(overview).not.toContain('data-fleet-code-air-base-selection="support"');
        expect(localCodeSection).not.toContain('browser.permissions.request');
        expect(localCodeSection).not.toContain('browser.tabs.create');
        expect(localCodeSection).not.toContain('window.open');
    });

    it('對話框保留可鍵盤操作的勾選、唯讀輸出與錯誤回饋樣式', () => {
        expect(overviewHtml).toContain('.fo-code-dialog');
        expect(overviewHtml).toContain('.fo-code-fleet-choice:has(input:checked)');
        expect(overviewHtml).toContain('.fo-code-output');
        expect(overviewHtml).toContain('.fo-code-error');
        expect(overview).toContain('role="alert"');
        expect(overview).toContain('readonly');
    });

    it('不再請求外部支援工具網站權限', () => {
        expect(config).toContain('optional_host_permissions: GAME_PAGE_MATCHES');
        expect(config).not.toContain('SUPPORT_KAI');
    });
});
