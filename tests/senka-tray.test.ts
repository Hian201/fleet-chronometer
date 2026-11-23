// entrypoints/panel/senka-tray.ts 單元測試：驗證 1b 頁首按鈕、托盤開關／Esc／焦點、各資料狀態與三語渲染。
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it } from 'vitest';
import { mountSenkaTray, senkaHeaderButtonHtml, senkaTrayInnerHtml } from '../entrypoints/panel/senka-tray';
import { buildObservedSenkaSummary, type SenkaObservedSummary } from '../utils/senka-view';
import { senkaMonthWindow, type EoSortieInput, type QuestClaimInput } from '../utils/senka';
import { LANGS, setLang, tFor } from '../utils/ui-i18n';

afterEach(() => setLang('zh-TW'));

const MONTH = { year: 2026, month: 11 };
const WIN = senkaMonthWindow(MONTH);
const NOW = Date.UTC(2026, 10, 30, 9, 0); // 11/30 18:00 JST（最後一天、任務已截止）

function makeSummary(
    status: 'exact' | 'range' | 'no-start' | 'no-data' | 'anomaly',
    opts?: { sorties?: EoSortieInput[]; questClaims?: QuestClaimInput[] },
): SenkaObservedSummary {
    const sorties = opts?.sorties ?? [];
    const questClaims = opts?.questClaims ?? [];
    if (status === 'exact') {
        return buildObservedSenkaSummary({
            readings: [
                { ts: WIN.start - 10_000, exp: 1_000_000 },
                { ts: WIN.start + 60_000, exp: 1_000_000 },
                { ts: NOW - 20 * 3_600_000, exp: 4_362_858 }, // 今日 05:00 JST 之前的讀數
                { ts: NOW - 60_000, exp: 4_500_000 },
            ],
            sorties,
            questClaims,
        }, NOW);
    }
    if (status === 'range') {
        return buildObservedSenkaSummary({
            readings: [
                { ts: WIN.start - 10_000, exp: 1_000_000 },
                { ts: WIN.start + 60_000, exp: 1_010_000 },
                { ts: NOW - 60_000, exp: 4_500_000 },
            ],
            sorties,
            questClaims,
        }, NOW);
    }
    if (status === 'no-start') {
        return buildObservedSenkaSummary({
            readings: [
                { ts: WIN.start + 60_000, exp: 1_000_000 },
                { ts: NOW - 60_000, exp: 1_100_000 },
            ],
            sorties,
            questClaims,
        }, NOW);
    }
    if (status === 'anomaly') {
        return buildObservedSenkaSummary({
            readings: [
                { ts: WIN.start - 10_000, exp: 1_000_000 },
                { ts: WIN.start + 60_000, exp: 900_000 },
            ],
            sorties,
            questClaims,
        }, NOW);
    }
    return buildObservedSenkaSummary({ readings: [], sorties, questClaims }, NOW);
}

describe('senkaHeaderButtonHtml', () => {
    it('1b 使用 senka.short 與 senka.full，加總普通＋EO＋任務；缺 summary 時顯示破折號', () => {
        const empty = senkaHeaderButtonHtml(null, false, 'en');
        expect(empty).toContain('Pts');
        expect(empty).toContain('<b>—</b>');
        expect(empty).toContain('aria-expanded="false"');

        const summary = makeSummary('exact', {
            sorties: [{ ts: NOW - 10 * 3_600_000, map: '6-5', cleared: true }], // +250
            questClaims: [{ eventId: 1, questNo: 893, ts: NOW - 15 * 3_600_000 }], // +300
        });
        const filled = senkaHeaderButtonHtml(summary, true, 'zh-TW');
        expect(filled).toContain(`>${tFor('zh-TW', 'senka.short')}<`);
        expect(filled).toContain('<b>≈3,000</b>');
        expect(filled).toContain('aria-expanded="true"');
        expect(filled).toContain(`title="${tFor('zh-TW', 'senka.full')} ≈3,000"`);
    });
});

describe('senkaTrayInnerHtml', () => {
    it('涵蓋 loading、error、組成列、949 區間、五種狀態與月底兩行截止＋未收錄註記', () => {
        const loading = senkaTrayInnerHtml(null, 'zh-TW', { loading: true });
        expect(loading).toContain(tFor('zh-TW', 'ov.loading'));

        const err = senkaTrayInnerHtml(null, 'en', { error: 'IDB blocked' });
        expect(err).toContain('IDB blocked');

        const exact = senkaTrayInnerHtml(makeSummary('exact', {
            sorties: [{ ts: NOW - 10 * 3_600_000, map: '6-5', cleared: true }],
            questClaims: [
                { eventId: 1, questNo: 893, ts: NOW - 15 * 3_600_000 },
                { eventId: 2, questNo: 949, ts: NOW - 14 * 3_600_000 },
            ],
        }), 'zh-TW');
        expect(exact).toContain(tFor('zh-TW', 'ov.skObserved'));
        expect(exact).toContain('≈3,000～3,800');
        expect(exact).toContain('普通 2,450 · EO 250 · 任務 300～1,100');
        expect(exact).toContain(tFor('zh-TW', 'ov.skExclCarry'));
        expect(exact).toContain('≈+96');
        expect(exact).toContain(tFor('zh-TW', 'senka.unlisted'));
        expect(exact).toContain(tFor('zh-TW', 'senka.questClosed', { time: '' }).split('{')[0].slice(0, 4));

        expect(senkaTrayInnerHtml(makeSummary('range'), 'en')).toContain('≈2,443–2,450');

        const noStart = senkaTrayInnerHtml(makeSummary('no-start', {
            sorties: [{ ts: NOW - 10 * 3_600_000, map: '1-5', cleared: true }],
        }), 'ja');
        expect(noStart).toContain(tFor('ja', 'senka.noStart'));
        expect(noStart).toContain(tFor('ja', 'ov.skExclCarry'));
        expect(noStart).toContain(tFor('ja', 'senka.observed'));
        expect(noStart).toContain('通常 — · EO 75 · 任務 0');
        expect(noStart).toContain('≈+145');

        expect(senkaTrayInnerHtml(makeSummary('no-data'), 'zh-TW')).toContain(tFor('zh-TW', 'senka.noData'));
        expect(senkaTrayInnerHtml(makeSummary('anomaly'), 'en')).toContain(tFor('en', 'senka.anomaly'));
    });

    for (const { code } of LANGS) {
        it(`${code}：托盤 HTML 不外露任何 i18n 鍵名，標題列使用短月名且底列有兩行截止與未收錄註記`, () => {
            const html = senkaTrayInnerHtml(makeSummary('exact'), code);
            expect(html).not.toMatch(/senka\.|ov\./);
            expect(html).toContain(tFor(code, 'senka.monthShort11'));
            const doc = parseHTML(html).document;
            expect(doc.querySelectorAll('.sn-foot > span')).toHaveLength(3);
            expect(doc.querySelector('.sn-foot .sn-note')!.textContent).toBe(tFor(code, 'senka.unlisted'));
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
