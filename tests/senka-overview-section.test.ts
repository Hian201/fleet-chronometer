// 情報總括「戰果」分區（1a 內容）單元與生命週期測試。
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sections } from '../entrypoints/overview/sections';
import { renderSenkaSectionBodyHtml, senkaSection } from '../entrypoints/overview/sections/senka';
import type { SectionContext } from '../entrypoints/overview/sections/types';
import { db, type ResourceRow } from '../utils/db';
import type { Lang } from '../utils/gamedata-i18n';
import { senkaDeadlines, senkaMonthWindow } from '../utils/senka';
import { buildRegularSenkaSummary, type SenkaRegularSummary } from '../utils/senka-view';
import { LANGS, setLang, t, tFor } from '../utils/ui-i18n';
import { SENKA_HEADER_KEY } from '../utils/ui-prefs';
import { GameState } from '../utils/state';

const resourceRow = (eventId: number, ts: number, exp: number): ResourceRow => ({
    eventId,
    ts,
    m: [1000, 1000, 1000, 1000, 10, 10, 10, 10],
    exp,
});

function createContext(overrides: Partial<SectionContext> = {}): SectionContext {
    return {
        rerender() {},
        state: new GameState(),
        async reloadState() {},
        ...overrides,
    };
}

let host: HTMLElement;
let domWindow: ReturnType<typeof parseHTML>['window'];
let store: Map<string, string>;

beforeEach(async () => {
    setLang('zh-TW');
    const parsed = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>');
    domWindow = parsed.window;
    host = parsed.document.getElementById('host') as unknown as HTMLElement;
    store = new Map<string, string>();
    vi.stubGlobal('document', parsed.document);
    vi.stubGlobal('window', domWindow);
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => { store.set(key, val); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
    });
    await db.resources.clear();
});

afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setLang('zh-TW');
    await db.resources.clear();
});

describe('分區登錄順序', () => {
    it('sections 包含 senkaSection 且緊接在 resource-log 之後', () => {
        const ids = sections.map(s => s.id);
        const resIdx = ids.indexOf('resource-log');
        const skIdx = ids.indexOf('senka');
        expect(resIdx).toBeGreaterThanOrEqual(0);
        expect(skIdx).toBe(resIdx + 1);
        expect(sections[skIdx]).toBe(senkaSection);
        expect(senkaSection.titleKey).toBe('ov.senka');
    });
});

describe('renderSenkaSectionBodyHtml（五種狀態 × 三語）', () => {
    const baseNow = Date.UTC(2026, 10, 15, 1, 0);
    const month = { year: 2026, month: 11 };
    const deadlines = senkaDeadlines(baseNow);

    const cases: { name: string; summary: SenkaRegularSummary; expectHintKey: string | null; expectRows: number }[] = [
        {
            name: 'exact（含今日新增）',
            summary: { now: baseNow, month, regular: { status: 'exact', points: 2450, observed: 2450 }, today: 96, deadlines },
            expectHintKey: null,
            expectRows: 1,
        },
        {
            name: 'exact（today 為 null）',
            summary: { now: baseNow, month, regular: { status: 'exact', points: 2450, observed: 2450 }, today: null, deadlines },
            expectHintKey: null,
            expectRows: 1,
        },
        {
            name: 'range',
            summary: { now: baseNow, month, regular: { status: 'range', min: 2318, max: 2331, observed: 2318 }, today: 40, deadlines },
            expectHintKey: 'ov.skReconNote',
            expectRows: 1,
        },
        {
            name: 'no-start（有今日新增）',
            summary: { now: baseNow, month, regular: { status: 'no-start', observed: 120 }, today: 35, deadlines },
            expectHintKey: 'senka.noStart',
            expectRows: 2,
        },
        {
            name: 'no-start（today 為 null）',
            summary: { now: baseNow, month, regular: { status: 'no-start', observed: 120 }, today: null, deadlines },
            expectHintKey: 'senka.noStart',
            expectRows: 1,
        },
        {
            name: 'no-data',
            summary: { now: baseNow, month, regular: { status: 'no-data' }, today: null, deadlines },
            expectHintKey: 'senka.noData',
            expectRows: 0,
        },
        {
            name: 'anomaly',
            summary: { now: baseNow, month, regular: { status: 'anomaly' }, today: null, deadlines },
            expectHintKey: 'senka.anomaly',
            expectRows: 0,
        },
    ];

    for (const { code } of LANGS) {
        for (const c of cases) {
            it(`${code} / ${c.name} 正確渲染且無鍵名外露`, () => {
                // 全域語言故意設成其他語言，確認 renderSenkaSectionBodyHtml 依賴傳入的 lang 參數
                setLang(code === 'ja' ? 'en' : 'ja');
                const html = renderSenkaSectionBodyHtml(c.summary, code as Lang);
                expect(html).not.toMatch(/senka\.|ov\.|undefined|\{[a-zA-Z]+\}/);

                const doc = parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
                expect(doc.querySelector('#sk-month')).not.toBeNull();
                expect(doc.querySelector('#sk-month h3')!.textContent).toBe(tFor(code, 'senka.month11'));
                expect(doc.querySelector('.sk-tl')!.textContent).toBe(tFor(code, 'ov.skMonthRegular'));

                const hint = doc.querySelector('.sk-hint');
                if (c.expectHintKey) {
                    expect(hint).not.toBeNull();
                    expect(hint!.textContent).toBe(tFor(code, c.expectHintKey));
                } else {
                    expect(hint).toBeNull();
                }

                const dl = doc.querySelector('dl.sk-kv.sk-sep');
                if (c.expectRows === 0) {
                    expect(dl).toBeNull();
                } else {
                    expect(dl).not.toBeNull();
                    expect(dl!.querySelectorAll('dt')).toHaveLength(c.expectRows);
                    expect(dl!.querySelectorAll('dd')).toHaveLength(c.expectRows * 2);
                    expect(dl!.querySelectorAll('dd.n')).toHaveLength(c.expectRows);
                }

                const closes = doc.querySelectorAll('.sk-closes > span');
                expect(closes).toHaveLength(1);
            });
        }
    }

    it('exact / today=null 顯示破折號；no-start 同時列 observed 與 today', () => {
        const htmlNull = renderSenkaSectionBodyHtml(cases[1].summary, 'zh-TW');
        const docNull = parseHTML(htmlNull).document;
        expect(docNull.querySelector('dl.sk-kv dt')!.textContent).toBe(tFor('zh-TW', 'senka.today'));
        expect(docNull.querySelector('dl.sk-kv dd')!.textContent).toBe('—');

        const htmlNoStart = renderSenkaSectionBodyHtml(cases[3].summary, 'zh-TW');
        const docNoStart = parseHTML(htmlNoStart).document;
        const dts = [...docNoStart.querySelectorAll('dl.sk-kv dt')].map(el => el.textContent);
        const dds = [...docNoStart.querySelectorAll('dl.sk-kv dd:not(.n)')].map(el => el.textContent);
        expect(dts).toEqual([tFor('zh-TW', 'senka.observed'), tFor('zh-TW', 'senka.today')]);
        expect(dds).toEqual(['≈+120', '≈+35']);
    });
});

describe('senkaSection 外殼、checkbox 與 storage 同步', () => {
    it('先畫殼與 #sk-pin-header（預設 false）並顯示載入中，再渲染 DB 資料', async () => {
        let resolveQuery!: (rows: ResourceRow[]) => void;
        const pendingRows = new Promise<ResourceRow[]>(resolve => { resolveQuery = resolve; });

        vi.spyOn(db.resources, 'where').mockImplementation((() => ({
            below: () => ({ reverse: () => ({ filter: () => ({ first: async () => undefined }) }) }),
            between: () => ({ toArray: () => pendingRows }),
        })) as unknown as typeof db.resources.where);

        const controller = new AbortController();
        const renderPromise = senkaSection.render(host, createContext({ signal: controller.signal }));

        // DB 尚未 resolve 前，殼與 checkbox 與載入中提示皆已存在
        const root = host.querySelector('#sk');
        expect(root?.getAttribute('data-stage')).toBe('0');
        expect(host.querySelector('.ov-note')!.textContent).toBe(t('ov.skNoteRegular'));
        const checkbox = host.querySelector<HTMLInputElement>('#sk-pin-header')!;
        expect(checkbox).not.toBeNull();
        expect(checkbox.checked).toBe(false);
        expect(host.querySelector('#sk-body .ov-empty')!.textContent).toBe(t('ov.loading'));

        resolveQuery([]);
        await renderPromise;

        expect(host.querySelector('#sk-month')).not.toBeNull();
        controller.abort();
    });

    it('勾選寫入 localStorage；storage 事件原地同步勾選態且不重建 <input>', async () => {
        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));

        const checkbox = host.querySelector<HTMLInputElement>('#sk-pin-header')!;
        expect(checkbox.checked).toBe(false);

        checkbox.checked = true;
        checkbox.dispatchEvent(new domWindow.Event('change'));
        expect(store.get(SENKA_HEADER_KEY)).toBe('true');

        checkbox.checked = false;
        checkbox.dispatchEvent(new domWindow.Event('change'));
        expect(store.get(SENKA_HEADER_KEY)).toBe('false');

        // 模擬其他分頁改動 localStorage 並觸發 storage 事件
        store.set(SENKA_HEADER_KEY, 'true');
        const ev = Object.assign(new domWindow.Event('storage'), { key: SENKA_HEADER_KEY });
        domWindow.dispatchEvent(ev);
        expect(checkbox.checked).toBe(true);
        expect(host.querySelector('#sk-pin-header')).toBe(checkbox);

        // 無關的 key 不影響勾選態
        store.set(SENKA_HEADER_KEY, 'false');
        domWindow.dispatchEvent(Object.assign(new domWindow.Event('storage'), { key: 'kc-theme' }));
        expect(checkbox.checked).toBe(true);

        domWindow.dispatchEvent(Object.assign(new domWindow.Event('storage'), { key: SENKA_HEADER_KEY }));
        expect(checkbox.checked).toBe(false);
        expect(host.querySelector('#sk-pin-header')).toBe(checkbox);

        controller.abort();

        // abort 後收到 storage 事件不再更新 checkbox
        store.set(SENKA_HEADER_KEY, 'true');
        domWindow.dispatchEvent(Object.assign(new domWindow.Event('storage'), { key: SENKA_HEADER_KEY }));
        expect(checkbox.checked).toBe(false);
    });

    it('localStorage 事前已釘選時，初始 #sk-pin-header 即為勾選狀態', async () => {
        store.set(SENKA_HEADER_KEY, 'true');
        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));
        const checkbox = host.querySelector<HTMLInputElement>('#sk-pin-header')!;
        expect(checkbox.checked).toBe(true);
        expect(checkbox.hasAttribute('checked')).toBe(true);
        controller.abort();
    });
});

describe('senkaSection DB 查詢、錯誤處理與即時更新', () => {
    it('DB 讀取成功時渲染本月普通戰果、今日新增與截止時間', async () => {
        const now = Date.UTC(2026, 10, 15, 1, 0); // 2026/11/15 10:00 JST
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const win = senkaMonthWindow({ year: 2026, month: 11 });
        await db.resources.bulkPut([
            resourceRow(1, win.start - 60_000, 1_000_000),
            resourceRow(2, win.start, 1_000_000),
            resourceRow(3, now - 10_000, 1_500_000), // +500,000 exp = +350 戰果
        ]);

        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));

        expect(host.querySelector('#sk-month h3')!.textContent).toBe(t('senka.month11'));
        expect(host.querySelector('.sk-tv')!.textContent).toBe('≈350');
        expect(host.querySelector('.sk-hint')).toBeNull();
        expect(host.querySelector('dl.sk-kv dd:not(.n)')!.textContent).toBe('≈+350');
        expect(host.querySelectorAll('.sk-closes span')).toHaveLength(1);

        controller.abort();
    });

    it('DB 讀取拋錯時顯示錯誤訊息（含失敗原因）不留白', async () => {
        vi.spyOn(db.resources, 'where').mockImplementation(() => {
            throw new Error('indexeddb failure');
        });
        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));

        const empty = host.querySelector('#sk-body .ov-empty');
        expect(empty).not.toBeNull();
        expect(empty!.textContent).toBe(t('ov.loadFailed', { msg: 'indexeddb failure' }));
        expect(empty!.textContent).toContain('indexeddb failure');

        controller.abort();
    });

    it('onStateChange 收到 api_port/port 只更新 #sk-body 並保留 #sk-pin-header；其他 path 不重讀', async () => {
        const now = Date.UTC(2026, 10, 15, 1, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const win = senkaMonthWindow({ year: 2026, month: 11 });
        await db.resources.bulkPut([
            resourceRow(1, win.start - 60_000, 1_000_000),
            resourceRow(2, win.start, 1_000_000),
            resourceRow(3, now - 20_000, 1_100_000), // +70
        ]);

        let stateListener: ((paths: readonly string[]) => void) | null = null;
        const controller = new AbortController();
        const whereSpy = vi.spyOn(db.resources, 'where');

        await senkaSection.render(host, createContext({
            signal: controller.signal,
            onStateChange: fn => { stateListener = fn; },
        }));

        const checkbox = host.querySelector<HTMLInputElement>('#sk-pin-header')!;
        checkbox.checked = true;
        expect(host.querySelector('.sk-tv')!.textContent).toBe('≈70');
        const initialCalls = whereSpy.mock.calls.length;

        // 非 api_port/port 不重讀 DB
        stateListener!(['api_get_member/material']);
        await Promise.resolve();
        expect(whereSpy.mock.calls.length).toBe(initialCalls);

        // api_port/port 進來後重讀並更新 #sk-body，保留 #sk-pin-header 實例與勾選狀態
        await db.resources.put(resourceRow(4, now - 5_000, 1_300_000)); // +210
        stateListener!(['api_port/port']);
        await vi.waitFor(() => expect(host.querySelector('.sk-tv')!.textContent).toBe('≈210'));

        expect(host.querySelector('#sk-pin-header')).toBe(checkbox);
        expect(checkbox.checked).toBe(true);

        controller.abort();
    });
});

describe('每分鐘倒數與 abort 生命週期收尾', () => {
    it('每分鐘原地重算倒數、跨月重讀 DB；abort 後清除計時器且不再重讀或更新 DOM', async () => {
        vi.useFakeTimers();
        const start = Date.UTC(2026, 10, 30, 12, 55); // 2026/11/30 21:55 JST（距月界 13:00Z 剩 5 分鐘）
        vi.setSystemTime(start);

        const winNov = senkaMonthWindow({ year: 2026, month: 11 });
        const whereSpy = vi.spyOn(db.resources, 'where').mockImplementation((() => ({
            below: () => ({
                reverse: () => ({
                    filter: () => ({
                        first: async () => (Date.now() < winNov.end
                            ? resourceRow(1, winNov.start - 60_000, 1_000_000)
                            : resourceRow(2, winNov.end - 60_000, 1_500_000)),
                    }),
                }),
            }),
            between: () => ({
                toArray: async () => (Date.now() < winNov.end
                    ? [resourceRow(2, winNov.end - 60_000, 1_500_000)]
                    : [resourceRow(3, winNov.end + 10_000, 1_600_000)]),
            }),
        })) as unknown as typeof db.resources.where);

        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));

        expect(vi.getTimerCount()).toBe(1);
        expect(host.querySelector('#sk-month h3')!.textContent).toBe(t('senka.month11'));
        expect(host.querySelector('.sk-closes span')!.textContent).toContain('0:05');
        const callsAfterInit = whereSpy.mock.calls.length;

        // 過 1 分鐘（仍在 11 月）：不重查 DB，倒數原地更新為 0:04
        await vi.advanceTimersByTimeAsync(60_000);
        expect(whereSpy.mock.calls.length).toBe(callsAfterInit);
        expect(host.querySelector('.sk-closes span')!.textContent).toContain('0:04');

        // 跨到 12 月作戰月（13:00Z 之後）：觸發重讀 DB 並更新月份標題與戰果
        vi.setSystemTime(Date.UTC(2026, 10, 30, 13, 0)); // 2026/11/30 22:00 JST，再進 60 秒即 22:01 JST
        await vi.advanceTimersByTimeAsync(60_000);
        await vi.waitFor(() => expect(host.querySelector('#sk-month h3')!.textContent).toBe(t('senka.month12')));
        expect(whereSpy.mock.calls.length).toBeGreaterThan(callsAfterInit);
        const callsBeforeAbort = whereSpy.mock.calls.length;
        const bodyBeforeAbort = host.querySelector('#sk-body')!.innerHTML;

        // abort 後清除計時器，就算再經過 1 分鐘或跨月也不重讀、不改 DOM
        controller.abort();
        expect(vi.getTimerCount()).toBe(0);

        vi.setSystemTime(Date.UTC(2026, 11, 31, 13, 0)); // 再跨一個月
        await vi.advanceTimersByTimeAsync(60_000);
        expect(whereSpy.mock.calls.length).toBe(callsBeforeAbort);
        expect(host.querySelector('#sk-body')!.innerHTML).toBe(bodyBeforeAbort);
    });

    it('DB 查詢尚未返回時觸發 abort，resolve 後不覆蓋畫面', async () => {
        let resolveQuery!: (rows: ResourceRow[]) => void;
        const pendingRows = new Promise<ResourceRow[]>(resolve => { resolveQuery = resolve; });

        vi.spyOn(db.resources, 'where').mockImplementation((() => ({
            below: () => ({ reverse: () => ({ filter: () => ({ first: async () => undefined }) }) }),
            between: () => ({ toArray: () => pendingRows }),
        })) as unknown as typeof db.resources.where);

        const controller = new AbortController();
        const renderPromise = senkaSection.render(host, createContext({ signal: controller.signal }));

        expect(host.querySelector('#sk-body .ov-empty')!.textContent).toBe(t('ov.loading'));
        controller.abort();
        resolveQuery([resourceRow(1, Date.now(), 1_000_000)]);
        await renderPromise;

        // 保持在 abort 前的載入中狀態，未寫入過期的卡片內容
        expect(host.querySelector('#sk-month')).toBeNull();
        expect(host.querySelector('#sk-body .ov-empty')!.textContent).toBe(t('ov.loading'));
    });

    it('並行載入時較早的過期請求不覆蓋較新的結果', async () => {
        let resolveFirst!: (rows: ResourceRow[]) => void;
        let resolveSecond!: (rows: ResourceRow[]) => void;
        const firstRows = new Promise<ResourceRow[]>(resolve => { resolveFirst = resolve; });
        const secondRows = new Promise<ResourceRow[]>(resolve => { resolveSecond = resolve; });

        const now = Date.UTC(2026, 10, 15, 1, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const win = senkaMonthWindow({ year: 2026, month: 11 });

        let call = 0;
        vi.spyOn(db.resources, 'where').mockImplementation((() => {
            const idx = Math.floor(call / 2);
            call++;
            return {
                below: () => ({
                    reverse: () => ({
                        filter: () => ({
                            first: async () => resourceRow(1, win.start - 60_000, 1_000_000),
                        }),
                    }),
                }),
                between: () => ({
                    toArray: () => (idx === 0 ? firstRows : secondRows),
                }),
            };
        }) as unknown as typeof db.resources.where);

        let stateListener: ((paths: readonly string[]) => void) | null = null;
        const controller = new AbortController();
        const renderPromise = senkaSection.render(host, createContext({
            signal: controller.signal,
            onStateChange: fn => { stateListener = fn; },
        }));

        // 在第一次查詢還沒回來前就觸發第二次查詢
        stateListener!(['api_port/port']);

        // 第二次較快完成（+700 戰果）
        resolveSecond([
            resourceRow(2, win.start, 1_000_000),
            resourceRow(3, now - 1_000, 2_000_000),
        ]);
        await vi.waitFor(() => expect(host.querySelector('.sk-tv')?.textContent).toBe('≈700'));

        // 第一次較晚回來（+70 戰果），不應覆蓋 ≈700
        resolveFirst([
            resourceRow(2, win.start, 1_000_000),
            resourceRow(3, now - 1_000, 1_100_000),
        ]);
        await renderPromise;
        expect(host.querySelector('.sk-tv')!.textContent).toBe('≈700');

        controller.abort();
    });
});
