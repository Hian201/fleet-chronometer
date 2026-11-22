// entrypoints/panel/senka-tray.ts 單元測試：驗證頁首按鈕、托盤開關／Esc／焦點、各資料狀態與三語渲染。
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSenkaTray, senkaHeaderButtonHtml, senkaTrayInnerHtml } from '../entrypoints/panel/senka-tray';
import { buildRegularSenkaSummary, type SenkaRegularSummary } from '../utils/senka-view';
import { senkaMonthWindow } from '../utils/senka';
import { LANGS, setLang, tFor } from '../utils/ui-i18n';

afterEach(() => setLang('zh-TW'));

const MONTH = { year: 2026, month: 11 };
const WIN = senkaMonthWindow(MONTH);
const NOW = Date.UTC(2026, 10, 30, 9, 0); // 11/30 18:00 JST（最後一天、任務已截止）

function makeSummary(status: 'exact' | 'range' | 'no-start' | 'no-data' | 'anomaly'): SenkaRegularSummary {
    if (status === 'exact') {
        return buildRegularSenkaSummary([
            { ts: WIN.start - 10_000, exp: 1_000_000 },
            { ts: WIN.start + 60_000, exp: 1_000_000 },
            { ts: NOW - 20 * 3_600_000, exp: 4_362_858 }, // 今日 05:00 JST 之前的讀數
            { ts: NOW - 60_000, exp: 4_500_000 },
        ], NOW);
    }
    if (status === 'range') {
        return buildRegularSenkaSummary([
            { ts: WIN.start - 10_000, exp: 1_000_000 },
            { ts: WIN.start + 60_000, exp: 1_010_000 },
            { ts: NOW - 60_000, exp: 4_500_000 },
        ], NOW);
    }
    if (status === 'no-start') {
        return buildRegularSenkaSummary([
            { ts: WIN.start + 60_000, exp: 1_000_000 },
            { ts: NOW - 60_000, exp: 1_100_000 },
        ], NOW);
    }
    if (status === 'anomaly') {
        return buildRegularSenkaSummary([
            { ts: WIN.start - 10_000, exp: 1_000_000 },
            { ts: WIN.start + 60_000, exp: 900_000 },
        ], NOW);
    }
    return buildRegularSenkaSummary([], NOW);
}

describe('senkaHeaderButtonHtml', () => {
    it('1a 固定顯示普通戰果短標籤與 aria 屬性；缺 summary 時顯示破折號', () => {
        const empty = senkaHeaderButtonHtml(null, false, 'en');
        expect(empty).toContain('Reg. pts');
        expect(empty).toContain('<b>—</b>');
        expect(empty).toContain('aria-expanded="false"');

        const summary = makeSummary('exact');
        const filled = senkaHeaderButtonHtml(summary, true, 'zh-TW');
        expect(filled).toContain('普通戰果');
        expect(filled).toContain('<b>≈2,450</b>');
        expect(filled).toContain('aria-expanded="true"');
        expect(filled).toContain('title="普通戰果 ≈2,450"');
    });
});

describe('senkaTrayInnerHtml', () => {
    it('涵蓋 loading、error 與五種 RegularSenkaResult 狀態', () => {
        const loading = senkaTrayInnerHtml(null, 'zh-TW', { loading: true });
        expect(loading).toContain(tFor('zh-TW', 'ov.loading'));

        const err = senkaTrayInnerHtml(null, 'en', { error: 'IDB blocked' });
        expect(err).toContain('IDB blocked');

        expect(senkaTrayInnerHtml(makeSummary('exact'), 'zh-TW')).toContain('≈2,450');
        expect(senkaTrayInnerHtml(makeSummary('exact'), 'zh-TW')).toContain('≈+96');
        expect(senkaTrayInnerHtml(makeSummary('exact'), 'zh-TW')).toContain(tFor('zh-TW', 'senka.regularOnly'));
        expect(senkaTrayInnerHtml(makeSummary('range'), 'en')).toContain('≈2,443–2,450');
        const noStart = senkaTrayInnerHtml(makeSummary('no-start'), 'ja');
        expect(noStart).toContain(tFor('ja', 'senka.noStart'));
        expect(noStart).toContain(tFor('ja', 'senka.observed'));
        expect(noStart).toContain('≈+70');
        expect(senkaTrayInnerHtml(makeSummary('no-data'), 'zh-TW')).toContain(tFor('zh-TW', 'senka.noData'));
        expect(senkaTrayInnerHtml(makeSummary('anomaly'), 'en')).toContain(tFor('en', 'senka.anomaly'));
    });

    for (const { code } of LANGS) {
        it(`${code}：托盤 HTML 不外露任何 i18n 鍵名，標題列使用短月名`, () => {
            const html = senkaTrayInnerHtml(makeSummary('exact'), code);
            expect(html).not.toMatch(/senka\.|ov\./);
            expect(html).toContain(tFor(code, 'senka.monthShort11'));
        });
    }
});

describe('mountSenkaTray', () => {
    function setup() {
        const { document, window } = parseHTML('<!doctype html><html><body><section id="senka-tray" hidden></section></body></html>');
        const root = document.getElementById('senka-tray') as unknown as HTMLElement;
        const calls: Array<{ open: boolean; focus?: string }> = [];
        const tray = mountSenkaTray({
            root,
            onOpenChange: (open, focus) => calls.push({ open, focus }),
        });
        return { document, window, root, tray, calls };
    }

    it('開關切換、點擊關閉鈕與按 Escape 皆通知對應焦點目標並聚焦關閉鈕', () => {
        const { document, window, root, tray, calls } = setup();
        const focusedIds: string[] = [];
        const origFocus = window.HTMLElement.prototype.focus;
        window.HTMLElement.prototype.focus = function (this: HTMLElement) {
            if (this.id) focusedIds.push(this.id);
            return origFocus?.call(this);
        };
        try {
            tray.setState({ summary: makeSummary('exact') });
            expect(tray.isOpen()).toBe(false);
            expect(root.hidden).toBe(true);

            tray.toggle();
            expect(tray.isOpen()).toBe(true);
            expect(root.hidden).toBe(false);
            expect(calls[0]).toEqual({ open: true, focus: 'close' });
            expect(focusedIds).toEqual(['senka-close']);

            root.querySelector<HTMLButtonElement>('#senka-close')!.click();
            expect(tray.isOpen()).toBe(false);
            expect(root.hidden).toBe(true);
            expect(calls[1]).toEqual({ open: false, focus: 'points' });

            tray.setOpen(true, 'close');
            document.dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true }), { key: 'Escape' }));
            expect(tray.isOpen()).toBe(false);
            expect(calls[3]).toEqual({ open: false, focus: 'points' });
        } finally {
            window.HTMLElement.prototype.focus = origFocus;
        }
    });

    it('relabel 與 setState 在開啟狀態會即時更新內容，不外洩未開啟時的狀態', () => {
        const { root, tray } = setup();
        setLang('en');
        tray.setState({ summary: makeSummary('exact') });
        expect(root.innerHTML).toBe('');

        tray.setOpen(true);
        expect(root.textContent).toContain('November');
        setLang('ja');
        tray.relabel();
        expect(root.textContent).toContain('十一月作戦');
    });
});
