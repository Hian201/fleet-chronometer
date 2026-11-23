// 情報總括「戰果」分區（1b 內容）單元與生命週期測試。
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sections } from '../entrypoints/overview/sections';
import { renderSenkaSectionBodyHtml, senkaSection } from '../entrypoints/overview/sections/senka';
import type { SectionContext } from '../entrypoints/overview/sections/types';
import { db, type ResourceRow, type SortieLogRow } from '../utils/db';
import type { Lang } from '../utils/gamedata-i18n';
import { loadQuestCatalogLocale } from '../utils/quest-catalog-localization';
import { EO_SENKA_MAPS, eoSenkaForMonth, questSenkaForMonth, senkaDeadlines, senkaMonthWindow } from '../utils/senka';
import { type SenkaObservedSummary } from '../utils/senka-view';
import { LANGS, setLang, t, tFor } from '../utils/ui-i18n';
import { SENKA_HEADER_KEY } from '../utils/ui-prefs';
import { GameState } from '../utils/state';

const resourceRow = (eventId: number, ts: number, exp: number): ResourceRow => ({
    eventId,
    ts,
    m: [1000, 1000, 1000, 1000, 10, 10, 10, 10],
    exp,
});

const bossClearedRow = (eventId: number, ts: number, map: string): SortieLogRow => ({
    eventId,
    sortieKey: eventId - 1,
    ts,
    map,
    node: 1,
    boss: true,
    kind: 'battle',
    rank: 'S',
    seiku: null,
    enemyIds: [],
    enemyIdsEscort: [],
    drop: null,
    taiha: false,
    cleared: true,
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
    await Promise.all([
        db.resources.clear(),
        db.sorties.clear(),
        db.questObserved.clear(),
        db.snapshot.clear(),
    ]);
});

afterEach(async () => {
    vi.useRealTimers();
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

describe('renderSenkaSectionBodyHtml（1b 五種狀態 × 三語）', () => {
    const baseNow = Date.UTC(2026, 10, 15, 1, 0);
    const month = { year: 2026, month: 11 };
    const deadlines = senkaDeadlines(baseNow);
    const emptyEo = eoSenkaForMonth([], month);
    const emptyQuest = questSenkaForMonth([], month, () => null);
    const sampleEo = eoSenkaForMonth([{ ts: baseNow - 3_600_000, map: '6-5', cleared: true }], month);
    const sampleQuest = {
        fixed: 300,
        choiceMax: 800,
        min: 300,
        max: 1100,
        items: [
            { eventId: 1, questNo: 893, ts: baseNow - 7_200_000, fixed: 300, choice: 0 },
            { eventId: 2, questNo: 949, ts: baseNow - 3_600_000, fixed: 0, choice: 800 },
        ],
    };

    const cases: {
        name: string;
        summary: SenkaObservedSummary;
        expectHintKey: string | null;
        expectGainRows: number;
    }[] = [
        {
            name: 'exact（含今日新增與 EO／任務）',
            summary: {
                now: baseNow, month,
                regular: { status: 'exact', points: 2450, observed: 2450 },
                today: 96, deadlines, eo: sampleEo, quest: sampleQuest,
            },
            expectHintKey: null,
            expectGainRows: 1,
        },
        {
            name: 'exact（today 為 null）',
            summary: {
                now: baseNow, month,
                regular: { status: 'exact', points: 2450, observed: 2450 },
                today: null, deadlines, eo: emptyEo, quest: emptyQuest,
            },
            expectHintKey: null,
            expectGainRows: 1,
        },
        {
            name: 'range',
            summary: {
                now: baseNow, month,
                regular: { status: 'range', min: 2318, max: 2331, observed: 2318 },
                today: 40, deadlines, eo: emptyEo, quest: emptyQuest,
            },
            expectHintKey: 'ov.skReconNote',
            expectGainRows: 1,
        },
        {
            name: 'no-start（有今日新增）',
            summary: {
                now: baseNow, month,
                regular: { status: 'no-start', observed: 120 },
                today: 35, deadlines, eo: sampleEo, quest: emptyQuest,
            },
            expectHintKey: 'senka.noStart',
            expectGainRows: 2,
        },
        {
            name: 'no-start（today 為 null）',
            summary: {
                now: baseNow, month,
                regular: { status: 'no-start', observed: 120 },
                today: null, deadlines, eo: emptyEo, quest: emptyQuest,
            },
            expectHintKey: 'senka.noStart',
            expectGainRows: 1,
        },
        {
            name: 'no-data',
            summary: {
                now: baseNow, month,
                regular: { status: 'no-data' },
                today: null, deadlines, eo: emptyEo, quest: emptyQuest,
            },
            expectHintKey: 'senka.noData',
            expectGainRows: 0,
        },
        {
            name: 'anomaly',
            summary: {
                now: baseNow, month,
                regular: { status: 'anomaly' },
                today: null, deadlines, eo: emptyEo, quest: emptyQuest,
            },
            expectHintKey: 'senka.anomaly',
            expectGainRows: 0,
        },
    ];

    for (const { code } of LANGS) {
        for (const c of cases) {
            it(`${code} / ${c.name} 正確渲染雙卡片、四項組成與 EO／任務折疊且無鍵名外露`, async () => {
                await loadQuestCatalogLocale(code);
                // 全域語言故意設成其他語言，確認 renderSenkaSectionBodyHtml 依賴傳入的 lang 參數
                setLang(code === 'ja' ? 'en' : 'ja');
                const html = renderSenkaSectionBodyHtml(c.summary, code as Lang);
                expect(html).not.toMatch(/senka\.|ov\.|undefined|\{[a-zA-Z]+\}/);

                const doc = parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
                expect(doc.querySelector('#sk-month')).not.toBeNull();
                expect(doc.querySelector('#sk-eo')).not.toBeNull();
                expect(doc.querySelector('#sk-month h3')!.textContent).toBe(tFor(code, 'senka.month11'));
                expect(doc.querySelector('.sk-tl')!.textContent).toBe(tFor(code, 'ov.skObserved'));

                const hint = doc.querySelector('#sk-month .sk-hint');
                if (c.expectHintKey) {
                    expect(hint).not.toBeNull();
                    expect(hint!.textContent).toBe(tFor(code, c.expectHintKey));
                } else {
                    expect(hint).toBeNull();
                }

                const dls = [...doc.querySelectorAll('#sk-month dl.sk-kv.sk-sep')];
                // 第一個 dl 固定為 4 項組成（繼承／普通／EO／任務）
                expect(dls[0].querySelectorAll('dt')).toHaveLength(4);
                if (c.expectGainRows === 0) {
                    expect(dls).toHaveLength(1);
                } else {
                    expect(dls).toHaveLength(2);
                    expect(dls[1].querySelectorAll('dt')).toHaveLength(c.expectGainRows);
                    expect(dls[1].querySelectorAll('dd')).toHaveLength(c.expectGainRows * 2);
                }

                // EO 固定列出全部 9 張海域，任務折疊始終附帶未收錄註記
                expect(doc.querySelectorAll('#sk-eo details[data-fold="eo"] tbody tr')).toHaveLength(EO_SENKA_MAPS.length);
                expect(doc.querySelector('#sk-eo details[data-fold="quest"] .sk-hint')!.textContent)
                    .toBe(tFor(code, 'senka.unlisted'));
                expect(doc.querySelectorAll('.sk-closes > span')).toHaveLength(1);
            });
        }
    }

    it('渲染 EO 擊破清單（含未擊破淡化）、893／949 任務戰果列與月底兩行截止', async () => {
        await loadQuestCatalogLocale('zh-TW');
        const endDay = Date.UTC(2026, 10, 30, 9, 0); // 11/30 18:00 JST
        const summary: SenkaObservedSummary = {
            now: endDay,
            month,
            regular: { status: 'no-start', observed: 120 },
            today: 35,
            deadlines: senkaDeadlines(endDay),
            eo: sampleEo,
            quest: sampleQuest,
        };
        const html = renderSenkaSectionBodyHtml(summary, 'zh-TW');
        const doc = parseHTML(html).document;

        // no-start 加上 EO 250 + 任務 300～1,100 = +670～+1,470
        const dls = [...doc.querySelectorAll('#sk-month dl.sk-kv.sk-sep')];
        expect([...dls[1].querySelectorAll('dt')].map(e => e.textContent)).toEqual([
            tFor('zh-TW', 'senka.observed'),
            tFor('zh-TW', 'senka.today'),
        ]);
        expect([...dls[1].querySelectorAll('dd:not(.n)')].map(e => e.textContent)).toEqual([
            '≈+670～+1,470',
            '≈+35',
        ]);
        expect(doc.querySelectorAll('#sk-month .sk-closes > span')).toHaveLength(2);

        const eoRows = [...doc.querySelectorAll('#sk-eo details[data-fold="eo"] tbody tr')];
        expect(eoRows.filter(r => !r.classList.contains('sk-off'))).toHaveLength(1);
        expect(eoRows.filter(r => r.classList.contains('sk-off'))).toHaveLength(8);
        expect(eoRows.find(r => r.textContent?.includes('6-5'))!.textContent).toContain('+250');

        const questRows = [...doc.querySelectorAll('#sk-eo details[data-fold="quest"] tbody tr')];
        expect(questRows).toHaveLength(2);
        expect(questRows[0].textContent).toContain('893 Bq8');
        expect(questRows[0].textContent).toContain('+300');
        expect(questRows[1].textContent).toContain('949 B170');
        expect(questRows[1].textContent).toContain('0～+800');
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
        expect(root?.getAttribute('data-stage')).toBe('1');
        expect(host.querySelector('.ov-note')!.textContent).toBe(t('ov.skNoteObserved'));
        const checkbox = host.querySelector<HTMLInputElement>('#sk-pin-header')!;
        expect(checkbox).not.toBeNull();
        expect(checkbox.checked).toBe(false);
        expect(host.querySelector('#sk-body .ov-empty')!.textContent).toBe(t('ov.loading'));

        resolveQuery([]);
        await renderPromise;

        expect(host.querySelector('#sk-month')).not.toBeNull();
        expect(host.querySelector('#sk-eo')).not.toBeNull();
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

describe('senkaSection DB 查詢、錯誤處理、即時更新與動態譯文', () => {
    it('DB 讀取成功時渲染本月已觀測戰果、組成、EO 與任務清單', async () => {
        await loadQuestCatalogLocale('zh-TW');
        const now = Date.UTC(2026, 10, 15, 1, 0); // 2026/11/15 10:00 JST
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const win = senkaMonthWindow({ year: 2026, month: 11 });
        await db.resources.bulkPut([
            resourceRow(1, win.start - 60_000, 1_000_000),
            resourceRow(2, win.start, 1_000_000),
            resourceRow(3, now - 10_000, 1_500_000), // +350
        ]);
        await db.sorties.put(bossClearedRow(10, now - 5_000, '6-5')); // +250
        await db.questObserved.put({ eventId: 20, questNo: 893, ts: now - 3_000 }); // +300

        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));

        expect(host.querySelector('#sk-month h3')!.textContent).toBe(t('senka.month11'));
        expect(host.querySelector('.sk-tv')!.textContent).toBe(`≈900 ${t('ov.skExclCarry')}`);
        expect(host.querySelector('#sk-month .sk-hint')).toBeNull();
        expect(host.querySelectorAll('#sk-month dl.sk-kv')[1].querySelector('dd:not(.n)')!.textContent).toBe('≈+350');
        expect(host.querySelector('#sk-eo details[data-fold="quest"] tbody')!.textContent).toContain('893 Bq8');
        expect(host.querySelectorAll('#sk-month .sk-closes span')).toHaveLength(1);

        controller.abort();
    });

    it('db.sorties 為空、僅當月 mapinfo 快照含已擊破的 3-5／4-5／5-5 時，總括分區顯示 EO 擊破 3／9 與 +530', async () => {
        const now = Date.UTC(2026, 10, 20, 8, 0);
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const win = senkaMonthWindow({ year: 2026, month: 11 });
        await db.resources.bulkPut([
            resourceRow(1, win.start - 60_000, 1_000_000),
            resourceRow(2, win.start, 1_000_000),
        ]);
        await db.snapshot.put({
            path: 'api_get_member/mapinfo',
            ts: now - 1_000,
            api: {
                api_map_info: [
                    { api_id: 35, api_cleared: 1 },
                    { api_id: 45, api_cleared: 1 },
                    { api_id: 55, api_cleared: 1 },
                ],
            },
        });

        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));

        expect(host.querySelector('.sk-tv')!.textContent).toBe(`≈530 ${t('ov.skExclCarry')}`);
        expect(host.querySelector('#sk-eo details[data-fold="eo"] summary')!.textContent)
            .toBe(t('ov.skEoTitle', { done: 3, total: 9 }));
        const clearedRows = [...host.querySelectorAll('#sk-eo details[data-fold="eo"] tbody tr:not(.sk-off)')];
        expect(clearedRows.map(r => r.querySelector('td')!.textContent)).toEqual(['3-5', '4-5', '5-5']);

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

    it('onStateChange 收到 port／mapinfo／clearitemget 皆重讀更新，保留 #sk-pin-header 與其他無關 path 不重讀', async () => {
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
        expect(host.querySelector('.sk-tv')!.textContent).toBe(`≈70 ${t('ov.skExclCarry')}`);
        const initialCalls = whereSpy.mock.calls.length;

        // 無關的 path 不重讀 DB
        stateListener!(['api_get_member/material']);
        await Promise.resolve();
        expect(whereSpy.mock.calls.length).toBe(initialCalls);

        // api_port/port 更新普通戰果
        await db.resources.put(resourceRow(4, now - 5_000, 1_300_000)); // +210
        stateListener!(['api_port/port']);
        await vi.waitFor(() => expect(host.querySelector('.sk-tv')!.textContent).toBe(`≈210 ${t('ov.skExclCarry')}`));

        // api_get_member/mapinfo 更新 EO 擊破
        await db.sorties.put(bossClearedRow(10, now - 4_000, '6-5')); // +250
        stateListener!(['api_get_member/mapinfo']);
        await vi.waitFor(() => expect(host.querySelector('.sk-tv')!.textContent).toBe(`≈460 ${t('ov.skExclCarry')}`));

        // api_req_quest/clearitemget 更新任務戰果
        await db.questObserved.put({ eventId: 20, questNo: 893, ts: now - 3_000 }); // +300
        stateListener!(['api_req_quest/clearitemget']);
        await vi.waitFor(() => expect(host.querySelector('.sk-tv')!.textContent).toBe(`≈760 ${t('ov.skExclCarry')}`));

        expect(host.querySelector('#sk-pin-header')).toBe(checkbox);
        expect(checkbox.checked).toBe(true);

        controller.abort();
    });
});

describe('每分鐘倒數、折疊狀態保留與 abort 生命週期收尾', () => {
    it('每分鐘原地重算倒數並保留 <details> 收合狀態、跨月重讀 DB；abort 後清除計時器且不再重讀或更新 DOM', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
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
        vi.spyOn(db.sorties, 'where').mockImplementation((() => ({
            between: () => ({ filter: () => ({ toArray: async () => [] }) }),
        })) as unknown as typeof db.sorties.where);
        vi.spyOn(db.questObserved, 'where').mockImplementation((() => ({
            between: () => ({ toArray: async () => [] }),
        })) as unknown as typeof db.questObserved.where);
        vi.spyOn(db.snapshot, 'get').mockResolvedValue(undefined);

        const controller = new AbortController();
        await senkaSection.render(host, createContext({ signal: controller.signal }));

        expect(vi.getTimerCount()).toBe(1);
        expect(host.querySelector('#sk-month h3')!.textContent).toBe(t('senka.month11'));
        expect(host.querySelector('.sk-closes span')!.textContent).toContain('0:05');

        // 模擬使用者收合 EO 清單、維持任務清單展開
        const eoFold = host.querySelector<HTMLDetailsElement>('details[data-fold="eo"]')!;
        const questFold = host.querySelector<HTMLDetailsElement>('details[data-fold="quest"]')!;
        eoFold.open = false;
        questFold.open = true;

        const callsAfterInit = whereSpy.mock.calls.length;

        // 過 1 分鐘（仍在 11 月）：不重查 DB，倒數原地更新為 0:04，且保留 <details> 折疊狀態
        await vi.advanceTimersByTimeAsync(60_000);
        expect(whereSpy.mock.calls.length).toBe(callsAfterInit);
        expect(host.querySelector('.sk-closes span')!.textContent).toContain('0:04');
        expect(host.querySelector('details[data-fold="eo"]')!.hasAttribute('open')).toBe(false);
        expect(host.querySelector('details[data-fold="quest"]')!.hasAttribute('open')).toBe(true);

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
        await vi.waitFor(() => expect(host.querySelector('.sk-tv')?.textContent).toBe(`≈700 ${t('ov.skExclCarry')}`));

        // 第一次較晚回來（+70 戰果），不應覆蓋 ≈700
        resolveFirst([
            resourceRow(2, win.start, 1_000_000),
            resourceRow(3, now - 1_000, 1_100_000),
        ]);
        await renderPromise;
        expect(host.querySelector('.sk-tv')!.textContent).toBe(`≈700 ${t('ov.skExclCarry')}`);

        controller.abort();
    });
});
