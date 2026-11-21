// 遠征紀錄分區的 HTML 產出驗證（無 DOM，同 ships-overview／sortie-log-overview 的作法：
// 只測「純字串產出」的部分，事件與 DOM 綁定留給實際使用）。
import { describe, expect, it, beforeEach } from 'vitest';
import type { ExpeditionRow } from '../utils/db';
import { groupByMission, summarize } from '../utils/expedition-stats';
import { MIN_RUNS, planExpeditions, type PlanRow, type PlanSegment, type ResourceNeed } from '../utils/expedition-plan';
import { COLUMNS, defaultPlanPrefs, defaultPrefs, lastOf, loadPlanPrefs, planResultHtml, routeKeyOf, routeOf, runningOf, statsHtml, summaryHtml, updateRoute } from '../entrypoints/overview/sections/exped-log';
import { getLang, setLang, t } from '../utils/ui-i18n';
import { formatDate, formatDateTime } from '../utils/date-format';
import { parseHTML } from 'linkedom';
import { existsSync, readFileSync } from 'node:fs';

beforeEach(() => setLang('zh-TW'));

const exped = (over: Partial<ExpeditionRow> & { ts: number }): ExpeditionRow => ({
    eventId: over.ts,
    deckId: 2,
    missionId: 5,
    name: '海上護衛任務',
    result: 1,
    resources: [0, 200, 0, 0],
    items: [],
    ...over,
});

describe('期間彙總列', () => {
    it('列出四項資材小計與次數分佈', () => {
        const rows = [
            exped({ ts: 3000, result: 2, resources: [10, 20, 30, 40] }),
            exped({ ts: 2000, result: 1, resources: [1, 2, 3, 4] }),
            exped({ ts: 1000, result: 0, resources: [0, 0, 0, 0] }),
        ];
        const html = summaryHtml(summarize(rows), null, null, rows);
        expect(html).toContain(t('ov.expedTotalCount', { n: 3 }));
        // 大成功折進成功裡並寫明——三個獨立數字會被讀者加總，但成功本來就含大成功
        expect(html).toContain(t('ov.expedTotalSuccess', { n: 2, g: 1 }));
        expect(html).toContain(t('ov.expedTotalFail', { n: 1 }));
        expect(html).toContain('>11<');   // 燃料 10+1
        expect(html).toContain('>44<');   // 鋁土 40+4
    });

    it('起訖取實際落在期間內的紀錄，不寫使用者選的那個窗（窗可能比資料寬）', () => {
        const rows = [exped({ ts: 2000 }), exped({ ts: 1000 })];
        const html = summaryHtml(summarize(rows), 0, 9_999_999, rows);
        expect(html).toContain(t('ov.expedSumRange', {
            from: formatDateTime(1000), to: formatDateTime(2000),
        }));
    });

    it('期間內沒有紀錄時明講是「這個期間沒有」，並附上所選的窗', () => {
        const html = summaryHtml(summarize([]), 1000, 2000, []);
        expect(html).toContain(t('ov.expedSumRangeNone', {
            from: formatDateTime(1000), to: formatDateTime(2000),
        }));
    });

    it('回航道具顯示圖示與數量，且不併進資源小計', () => {
        const rows = [exped({ ts: 1000, resources: [0, 0, 0, 0], items: [{ id: 4, count: 3 }] })];
        const html = summaryHtml(summarize(rows), null, null, rows);
        expect(html).toContain('title="改修資材"');
        expect(html).toContain('/icons/resource/screw.svg');
        expect(html).toContain('<b>×3</b>');
        expect(html).toContain(t('ov.expedItemsLabel'));
    });
});

describe('回航道具名稱與數量', () => {
    const itemsCol = COLUMNS.find(c => c.id === 'items')!;
    const items = [1, 2, 3, 4, 10, 11, 12, 59].map((id, i) => ({ id, count: i + 1 }));
    const files = ['resource/drum', 'resource/torch', 'resource/devmat', 'resource/screw',
        'resource/furniture-box-small', 'resource/furniture-box-medium', 'resource/furniture-box-large', 'ui/provision'];

    it.each([
        ['zh-TW', ['高速修復材', '高速建造材', '開發資材', '改修資材', '家具箱（小）', '家具箱（中）', '家具箱（大）', '給糧艦「伊良湖」']],
        ['en', ['Instant Repair Material', 'Instant Construction Material', 'Development Material', 'Improvement Material', 'Furniture Box (Small)', 'Furniture Box (Medium)', 'Furniture Box (Large)', 'Irako']],
        ['ja', ['高速修復材', '高速建造材', '開発資材', '改修資材', '家具箱（小）', '家具箱（中）', '家具箱（大）', '給糧艦「伊良湖」']],
    ] as const)('%s 的明細、總計與 CSV 使用同一組名稱與原始數量', (lang, names) => {
        setLang(lang);
        const row = exped({ ts: 1000, items });
        const detail = itemsCol.cell(row);
        const summary = summaryHtml(summarize([row, row]), null, null, [row, row]);
        expect(itemsCol.text(row)).toBe(names.map((name, i) => `${name} ×${i + 1}`).join(' / '));
        const detailNodes = parseHTML(detail).document.querySelectorAll('.el-items > span');
        const summaryNodes = parseHTML(summary).document.querySelectorAll('.el-sum-chip[title]');
        names.forEach((name, i) => {
            const node = detailNodes[i];
            expect(node.getAttribute('title')).toBe(name);
            expect(node.textContent).toBe(`×${i + 1}`);
            expect(node.querySelector('img')?.getAttribute('alt')).toBe(name);
            expect(node.querySelector('img')?.getAttribute('src')).toBe(`/icons/${files[i]}.svg`);
            expect(existsSync(new URL(`../public/icons/${files[i]}.svg`, import.meta.url))).toBe(true);
            const chip = [...summaryNodes].find(el => el.getAttribute('title') === name)!;
            expect(chip.textContent).toBe(`×${(i + 1) * 2}`);
            expect(chip.querySelector('img')?.getAttribute('alt')).toBe(name);
            expect(chip.querySelector('img')?.getAttribute('src')).toBe(`/icons/${files[i]}.svg`);
        });
    });

    it('start2 樣本中的所有遠征獎勵均有圖示與名稱', () => {
        const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
        const ids = [...new Set<number>(master.api_mst_mission.flatMap((mission: {
            api_win_item1: number[]; api_win_item2: number[];
        }) => [mission.api_win_item1[0], mission.api_win_item2[0]]).filter((id: number) => id > 0))];
        expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11, 12, 59]);
        for (const id of ids) {
            const row = exped({ ts: 1000, items: [{ id, count: 1 }] });
            const img = parseHTML(itemsCol.cell(row)).document.querySelector('img');
            expect(img, `遠征獎勵 #${id} 缺圖示`).not.toBeNull();
            expect(img!.getAttribute('alt')).not.toMatch(/^#/);
            expect(existsSync(new URL(`../public${img!.getAttribute('src')}`, import.meta.url))).toBe(true);
        }
    });

    it('已知道具沒有圖示時保留名稱，不借用其他圖示', () => {
        const row = exped({ ts: 1000, items: [{ id: 57, count: 1 }] });
        expect(itemsCol.cell(row)).toContain('勳章 ×1');
        expect(itemsCol.cell(row)).not.toContain('<img');
        expect(itemsCol.text(row)).toBe('勳章 ×1');
    });

    it('未知編號保留原值，沒有道具時不補造數量', () => {
        const row = exped({ ts: 1000, items: [{ id: 99999, count: 2 }] });
        expect(itemsCol.cell(row)).toContain('#99999 ×2');
        expect(itemsCol.text(row)).toBe('#99999 ×2');
        expect(summaryHtml(summarize([row]), null, null, [row])).toContain('#99999 ×2');
        expect(itemsCol.text(exped({ ts: 1000 }))).toBe('');
        expect(itemsCol.cell(exped({ ts: 1000 }))).toContain('–');
    });
});

describe('各遠征彙總表', () => {
    it('遠征名稱一律 escape，不讓紀錄內容變成標記', () => {
        const stats = groupByMission([exped({ ts: 1000, name: '<img src=x onerror=alert(1)>' })]);
        const html = statsHtml(stats, defaultPrefs());
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).not.toContain('<img src=x');
    });

    it('只在目前排序中的欄位標方向箭頭', () => {
        const stats = groupByMission([exped({ ts: 1000 })]);
        const html = statsHtml(stats, { ...defaultPrefs(), sort: 'count', desc: true });
        expect(html).toContain(`${t('ov.expedColCount')} ▾`);
        expect(html).not.toContain(`${t('ov.expedColLast')} ▾`);
        expect(html).not.toContain(`${t('ov.expedColLast')} ▴`);
    });

    it('沒有資料時整段不畫（空表格比不畫更難讀）', () => {
        expect(statsHtml([], defaultPrefs())).toBe('');
    });

    // 本分區的主體是逐筆明細（一趟回來拿了什麼／多少／成功還是失敗）；依遠征種類加總的
    // 統計是次要的查詢工具，故收進 <details> 且**預設收合**，避免搶占逐筆明細的空間。
    it('收在 <details> 裡且預設收合', () => {
        const stats = groupByMission([exped({ ts: 1000 })]);
        const html = statsHtml(stats, defaultPrefs());
        expect(html.startsWith('<details class="el-stats">')).toBe(true);
        expect(html).not.toContain('<details class="el-stats" open>');
    });

    it('展開狀態由 prefs 帶入（表頭排序會整塊重繪，不記狀態就會自己收起來）', () => {
        const stats = groupByMission([exped({ ts: 1000 })]);
        expect(statsHtml(stats, { ...defaultPrefs(), statsOpen: true })).toContain('<details class="el-stats" open>');
    });
});

describe('逐筆明細的編成欄', () => {
    it('預設收合成「N艘」，展開才列出艦名（避免每列高好幾倍）', () => {
        const fleetCol = COLUMNS.find(c => c.id === 'fleet')!;
        const html = fleetCol.cell(exped({
            ts: 1000,
            fleet: [{ name: '睦月', level: 30 }, { name: '如月', level: 28 }],
        }));
        expect(html).toContain('<details class="el-fleet-d">');
        expect(html).not.toContain('<details class="el-fleet-d" open>');
        expect(html).toContain(`<summary>${t('unit.ships', { n: 2 })}</summary>`);
        expect(html).toContain('睦月');
    });

    it('沒有編成快照的舊紀錄照實標為不可考，不畫成空的折疊區', () => {
        const fleetCol = COLUMNS.find(c => c.id === 'fleet')!;
        const html = fleetCol.cell(exped({ ts: 1000 }));
        expect(html).not.toContain('<details');
        expect(html).toContain(t('ov.expedUnknown'));
    });

    it('CSV 仍匯出完整編成（收合只是顯示層的事）', () => {
        const fleetCol = COLUMNS.find(c => c.id === 'fleet')!;
        expect(fleetCol.text(exped({ ts: 1000, fleet: [{ name: '睦月', level: 30 }] })))
            .toBe('睦月 Lv30');
    });
});

describe('遠征組合建議', () => {
    const missions = [
        { id: 905, dispNo: '905', name: '海上護衛任務', time: 90, resetType: 0, winItems: [[0, 0], [1, 1]] as [number, number][], use: [0, 0] as [number, number] },
        { id: 942, dispNo: '42', name: '月常遠征', time: 60, resetType: 1, winItems: [[3, 2], [0, 0]] as [number, number][], use: [0, 0] as [number, number] },
        // 獎勵沒有開發資材或改修資材的月常不提示
        { id: 946, dispNo: '46', name: '月常遠征二', time: 60, resetType: 1, winItems: [[1, 1], [12, 1]] as [number, number][], use: [0, 0] as [number, number] },
    ];
    const need = (key: ResourceNeed['key'], have: number | null, base: number | null = null, cap = 3000): ResourceNeed =>
        ({ key, have, cap, base, current: base });
    const view = (records: ExpeditionRow[], needs: ResourceNeed[] = [need('fuel', 1000, null, 350000)], over: Partial<Parameters<typeof planResultHtml>[0]> = {}) => ({
        plan: planExpeditions({ missions, records, intervalMinutes: 180, needs, horizonDays: 10 }),
        chosen: needs.map(n => n.key), hasMaster: true, noFlow: needs.every(n => n.base === null), deadline: null, ...over,
    });
    const tenRuns = Array.from({ length: MIN_RUNS }, (_, i) => exped({ ts: 1000 + i, missionId: 905, result: 1, resources: [300, 0, 0, 0] }));

    it('組合、期限時存量比例、全部候選與月常；推算值與沒有成功紀錄的月常寫明', () => {
        const html = planResultHtml(view([...tenRuns, exped({ ts: 2000, missionId: 942, result: 0 })],
            [need('fuel', 175000, 100, 350000), need('drum', 300, 1)]));
        expect(html).toContain('1:30');
        expect(html).toContain('>300<');
        expect(html).toContain('el-plan-est');            // 高速修復材修正後的紀錄不足 MIN_RUNS → 推算
        expect(html).toContain(t('ov.epNever'));
        // 月常：本期截止與剩餘時間、本期狀態欄。
        expect(html).toContain(t('ov.epCycleOpen'));
        expect(html).not.toContain('月常遠征二');
        const now = Date.parse('2026-12-14T23:00:00Z');
        const monthlyRecords = [...tenRuns, exped({ ts: 2000, missionId: 942, result: 0 })];
        const due = planResultHtml({
            ...view(monthlyRecords), now,
            plan: planExpeditions({ missions, records: monthlyRecords, intervalMinutes: 180, needs: [need('fuel', 1000, null, 350000)], horizonDays: 10, now }),
        });
        // 本期在 12/15 03:00 UTC 截止：剩 4 小時（不到一天改用小時）。
        expect(due).toContain(t('ov.epMonthlyDue', { date: formatDateTime(Date.parse('2026-12-15T03:00:00Z'), false), left: t('ov.epLeftHours', { n: 4 }) }));
        expect(due).toContain(`<th>${t('ov.epCycle')}</th>`);
        // 遠征清單：本期未開放的月常標「未開放」；清單外的一般遠征不列入並說明條數；沒跑過的不再請玩家確認是否開放。
        const listed = planResultHtml({
            ...view(monthlyRecords), now,
            plan: planExpeditions({
                // 5（海上護衛任務）沒有紀錄、以固定報酬推算；905 不在清單。
                missions: [...missions, { ...missions[0], id: 5, dispNo: '05' }], records: monthlyRecords, intervalMinutes: 180,
                needs: [need('fuel', 1000, null, 350000)], horizonDays: 10, now,
                missionList: { states: new Map([[5, 2]]), resetAt: Date.parse('2026-12-15T03:00:00Z') },
            }),
        });
        expect(listed).toContain(t('ov.epCycleLocked'));
        expect(listed).not.toContain(t('ov.epCycleOpen'));
        expect(listed).toContain(t('ov.epLocked', { n: 1 }));
        expect(listed).toContain(t('ov.epUnrunOpenTip'));
        expect(listed).not.toContain(t('ov.epUnrunTip'));
        expect(html).toContain(t('ov.epAll', { n: 1 }));
        expect(html).toContain(t('ov.epWhenDays', { n: 10 }));
        // 燃料：每 3 小時收一次 → 8 趟 × 300 + 100 = 2,500／日，十天後 200,000（57%）；高速修復材 300 + 10 = 310（10%），是瓶頸
        expect(html).toContain('>57%<');
        expect(html).toMatch(/el-plan-neck-row"><td>[^]*?高速修復材/);
        expect(html).not.toContain(t('ov.epNoFlow'));
    });

    it('沒跑過的遠征標明；沒有流量時說明只用遠征推算；沒有候選時依原因說明', () => {
        const unrunView = view([]);
        unrunView.plan = planExpeditions({
            missions: [{ ...missions[0], id: 5, dispNo: '05' }], records: [], intervalMinutes: 180,
            needs: [need('fuel', 1000, null, 350000)], horizonDays: 10,
        });
        const unrun = planResultHtml(unrunView);
        expect(unrun).toContain(t('ov.epUnrun'));          // 海上護衛任務有固定報酬，沒跑過也列出
        expect(unrun).toContain(t('ov.epNoFlow'));
        expect(planResultHtml({ ...unrunView, deadline: '2026-12-31' })).toContain(t('ov.epOutlook', { when: t('ov.epWhenDeadline', { date: '2026-12-31' }) }));
        expect(planResultHtml(view([], undefined, { hasMaster: false }))).toContain(t('ov.epNoMaster'));
        expect(planResultHtml(view([], []))).toContain(t('ov.epNoKeys'));
        const none = view([]);
        none.plan = planExpeditions({ missions: [missions[1]], records: [], intervalMinutes: 180, needs: [need('fuel', 0)], horizonDays: 10 });
        expect(planResultHtml(none)).toContain(t('ov.epNoRecords'));
    });

    it('有作息離開時分列在線與睡前兩表；沒有時只有一表', () => {
        const withSleep = view(tenRuns);
        withSleep.plan = planExpeditions({ missions, records: tenRuns, intervalMinutes: 60, sleepMinutes: 450, needs: [need('fuel', 1000, null, 350000)], horizonDays: 10 });
        const html = planResultHtml(withSleep);
        expect(html).toContain(t('ov.epOnline'));
        expect(html).toContain(t('ov.epNight', { h: 7.5 }));
        expect(html.split('el-plan-table').length).toBe(1 + 4);     // 在線、睡前、全部候選、月常提示
        expect(planResultHtml(view(tenRuns))).not.toContain(t('ov.epOnline'));
    });

    it('頂端一句結論：最需要補的資材現有、這組遠征帶進與合計多少（只算遠征）；會存滿時說幾天；細節預設收合', () => {
        // 燃料：每 3 小時 8 趟 × 300 ＝ 遠征 2,400／日，十天 24,000；基本淨增減 100／日不算進結論。
        const html = planResultHtml(view(tenRuns, [need('fuel', 175000, 100, 350000)]));
        const amount = (n: number) => new Intl.NumberFormat(getLang(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
        expect(html).toContain(t('ov.epVerdict', {
            item: t('mat.fuel.full'), have: amount(175000), gain: amount(24000), total: amount(199000), cap: amount(350000),
            span: t('ov.epSpanDays', { n: 10 }),
        }));
        expect(html).toContain(t('ov.epVerdictNote'));
        expect(html).toContain(t('ov.epRole', { item: t('mat.fuel.full') }));
        expect(html).toContain('<details class="el-plan-all" data-part="outlook">');
        expect(html).not.toMatch(/<details[^>]* open/);
        // 精確搜尋還在背景算時，頂端多一行說明；算完就沒有。
        expect(html).not.toContain(t('ov.epRefining'));
        expect(planResultHtml({ ...view(tenRuns, [need('fuel', 175000, 100, 350000)]), refining: true })).toContain(t('ov.epRefining'));
        // 期限：改寫到期限為止。會存滿：(350,000 − 340,000) ÷ 2,400 ≈ 4.2 → 5 天。
        expect(planResultHtml({ ...view(tenRuns, [need('fuel', 175000, 100, 350000)]), deadline: '2026-12-31' }))
            .toContain(t('ov.epSpanDeadline', { date: '2026-12-31' }));
        // 支出照最少的一週：寫明是哪一週；那週有沒道具標記的紀錄且勾了道具時另外說明。
        const weekView = { ...view(tenRuns, [need('fuel', 175000, 100, 350000), need('drum', 300, 1)]), basis: 'lightest' as const, week: { fromTs: 0, toTs: 7 * 86400000, itemsRecorded: false } };
        expect(planResultHtml(weekView)).toContain(t('ov.epSpendWeek', { from: formatDate(0), to: formatDate(7 * 86400000) }));
        expect(planResultHtml(weekView)).toContain(t('ov.epSpendWeekItems'));
        expect(planResultHtml({ ...weekView, week: { ...weekView.week, itemsRecorded: true } })).not.toContain(t('ov.epSpendWeekItems'));
        expect(planResultHtml({ ...weekView, week: null })).toContain(t('ov.epSpendNoWeek'));
        expect(planResultHtml({ ...weekView, basis: 'recent' })).not.toContain(t('ov.epSpendWeekItems'));
        // 沒設期限、組合能全部存滿：先講幾天全部存滿。
        const filling = view(tenRuns, [need('fuel', 340000, null, 350000)]);
        filling.plan = planExpeditions({ missions, records: tenRuns, intervalMinutes: 180, needs: [need('fuel', 340000, null, 350000)], horizonDays: 10, untilFull: true });
        expect(planResultHtml(filling)).toContain(t('ov.epAllFull', { n: 5 }));
        expect(planResultHtml({ ...filling, deadline: '2026-12-31' })).not.toContain(t('ov.epAllFull', { n: 5 }));
        expect(planResultHtml(view(tenRuns, [need('fuel', 340000, null, 350000)])))
            .toContain(t('ov.epVerdictFull', { item: t('mat.fuel.full'), have: amount(340000), cap: amount(350000), n: 5 }));
    });
});

describe('遠征組合建議：多階段與黏著', () => {
    const mission = { id: 905, dispNo: '905', name: '海上護衛任務', time: 90, resetType: 0, winItems: [[0, 0], [1, 1]] as [number, number][], use: [0, 0] as [number, number] };
    const records = Array.from({ length: MIN_RUNS }, (_, i) => exped({ ts: 1000 + i, missionId: 905, result: 1, resources: [300, 0, 0, 0] }));
    const base = planExpeditions({
        missions: [mission], records, intervalMinutes: 180, horizonDays: 10,
        needs: [{ key: 'fuel', have: 175000, cap: 350000, base: 100, current: 100 }],
    });
    const row = (id: number, dispNo: string): PlanRow => ({ ...base.top[0], missionId: id, dispNo, name: `遠征${dispNo}` });
    const fleet = (deck: number | null, day: number | null, night: number | null = null) =>
        ({ deck, day: day === null ? null : row(day, String(day).padStart(2, '0')), night: night === null ? null : row(night, String(night)) });
    const seg = (days: number, fleets: PlanSegment['fleets'], trigger: PlanSegment['trigger'], changed: number[] = [], rate: PlanSegment['rate'] = { fuel: 1000 }): PlanSegment =>
        ({ fleets, days, start: {}, end: {}, rate, trigger, changed });
    // 三段、兩套組合（第三段回到第一套）：段數 3、組合數（階段數）2。
    const segments = [
        seg(10.6, [fleet(1, 2), fleet(2, 13)], { kind: 'rise', key: 'fuel', at: 166000 }),
        seg(20, [fleet(1, 2), fleet(2, null)], { kind: 'cap', key: 'fuel', at: 349000 }, [1]),
        seg(5, [fleet(1, 2), fleet(2, 13)], null, [1]),
    ];
    const phaseOf = (over: Partial<NonNullable<typeof base.phases>> = {}): NonNullable<typeof base.phases> =>
        ({ segments, days: 35.6, untilFull: true, single: { days: 50.2, fill: null }, routeKept: false, stage: [1, 2, 1], stageCount: 2, ...over });
    const phasePlan = (over: Partial<typeof base> = {}, phases = phaseOf()) => ({ ...base, top: [row(2, '02'), row(13, '13')], ...over, phases });
    const view = (plan: typeof base, deadline: string | null = null) => ({ plan, chosen: ['fuel' as const], hasMaster: true, noFlow: false, deadline });
    const summaryOf = (n: number) => t('ov.epPhaseFull', { n, days: 36, single: t('ov.epPhaseSingleDays', { n: 51 }) });

    it('最上面是「現在派這三隊」，多階段時標題後附「第 k／n 階段」', () => {
        const html = planResultHtml(view(phasePlan()));
        expect(html).toContain(t('ov.epNowTitle'));
        expect(html).toContain(t('ov.epPhaseOf', { k: 1, n: 2 }));
        // 現在派的在最前面，整體規劃在後面。
        expect(html.indexOf(t('ov.epNowTitle'))).toBeLessThan(html.indexOf(t('ov.epOverall')));
        expect(html.indexOf(t('ov.epNowTitle'))).toBeLessThan(html.indexOf('el-plan-table'));
        // 只有一個階段（單組）時不寫「第 1／1 階段」。
        const one = planResultHtml(view(phasePlan({}, phaseOf({ segments: [segments[0]], stage: [1], stageCount: 1 }))));
        expect(one).not.toContain(t('ov.epPhaseOf', { k: 1, n: 1 }));
        expect(one).toContain(t('ov.epNowTitle'));
    });

    it('表格第一欄的遠征名前標艦隊；對不到艦隊或沒有艦隊編號時不加，不猜', () => {
        const html = planResultHtml(view(phasePlan()));
        expect(html).toContain(`<span class="el-plan-fleet">${t('ov.expedDeck', { n: 2 })}</span>`);
        expect(html).toContain(`<span class="el-plan-fleet">${t('ov.expedDeck', { n: 3 })}</span>`);
        // top 的列順序與 fleets 不同也照遠征對應（13 仍是第 3 艦隊），並依艦隊編號排列，與整體規劃表的欄順序一致。
        const swapped = planResultHtml(view(phasePlan({ top: [row(13, '13'), row(2, '02')] })));
        expect(swapped.indexOf(`>${t('ov.expedDeck', { n: 3 })}</span>遠征13`)).toBeGreaterThan(-1);
        expect(swapped.indexOf(`>${t('ov.expedDeck', { n: 2 })}</span>遠征02`)).toBeLessThan(swapped.indexOf(`>${t('ov.expedDeck', { n: 3 })}</span>遠征13`));
        // fleets 裡找不到的遠征、deck 為 null 的隊都不標。
        const unmatched = planResultHtml(view(phasePlan({ top: [row(77, '77')] })));
        expect(unmatched).not.toContain('class="el-plan-fleet"');
        const noDeck = phaseOf({ segments: [seg(10, [fleet(null, 2), fleet(null, 13)], null), segments[1]] });
        expect(planResultHtml(view(phasePlan({}, noDeck)))).not.toContain('class="el-plan-fleet"');
        // 單組（沒有 phases）不標艦隊。
        expect(planResultHtml(view(base))).not.toContain('class="el-plan-fleet"');
        // 有睡前遠征時睡前那張表也標，與同一隊對應。
        const night = phaseOf({ segments: [seg(10, [fleet(1, 2, 36), fleet(2, 13, 35)], null), segments[1]] });
        const nightHtml = planResultHtml(view(phasePlan({ sleepMinutes: 450, sleep: [row(35, '35'), row(36, '36')], roles: { top: [null, null], sleep: [null, null] } }, night)));
        expect(nightHtml.indexOf(`>${t('ov.expedDeck', { n: 3 })}</span>遠征35`)).toBeGreaterThan(-1);
        expect(nightHtml.indexOf(`>${t('ov.expedDeck', { n: 2 })}</span>遠征36`)).toBeGreaterThan(-1);
    });

    it('整體規劃：總結句寫階段數（不是段數）與全程天數，對照固定一套；不顯示結論句與「全部存滿」那句', () => {
        const html = planResultHtml(view(phasePlan()));
        expect(html).toContain(t('ov.epOverall'));
        expect(html).toContain(summaryOf(2));
        expect(html).not.toContain(t('ov.epAllFull', { n: 36 }));
        expect(html).not.toContain(t('ov.epVerdictNote'));
        // 固定一套存不滿：寫一年內存不滿。
        expect(planResultHtml(view(phasePlan({}, phaseOf({ single: { days: null, fill: null } }))))).toContain(t('ov.epPhaseSingleNever'));
    });

    it('期限：寫期限時最低存量比例與固定一套的比例', () => {
        const plan = phasePlan({ outlook: [{ ...base.outlook[0], planAt: 245000 }] }, phaseOf({ untilFull: false, single: { days: null, fill: 0.4 } }));
        const html = planResultHtml(view(plan, '2026-12-31'));
        expect(html).toContain(t('ov.epPhaseFill', { n: 2, fill: '70%', single: '40%' }));
        // 最後一段沒有切換條件，期限模式寫破折號（不是「全部存滿」）。
        expect(html).not.toContain(t('ov.epStageFull'));
        expect(html).toMatch(/<td>—<\/td><\/tr>/);
    });

    it('整體規劃表：目前列寫「見上方」，其他列各隊派什麼、與前一列不同的加粗，天數與切換條件，最後一列寫全部存滿', () => {
        const html = planResultHtml(view(phasePlan())).replace(/>\s+</g, '><');
        // 欄名：各艦隊一欄。
        expect(html).toContain(`<th>${t('ov.expedDeck', { n: 2 })}</th><th>${t('ov.expedDeck', { n: 3 })}</th>`);
        // 目前列：階段序號與「目前」標記；艦隊格與切換條件都寫見上方，不重複遠征。
        expect(html).toContain(`${t('ov.epStageN', { n: 1 })} <span class="el-plan-cur">${t('ov.epStageNow')}</span>`);
        expect(html).toContain(`<td>${t('ov.epSeeAbove')}</td><td>${t('ov.epSeeAbove')}</td><td class="el-plan-time">${t('ov.epStageDays', { n: 11 })}</td><td>${t('ov.epSeeAbove')}</td>`);
        // 第二列：只有第三艦隊（索引 1）換，改不派；其餘不加粗。
        expect(html).toContain(`<td><span title="遠征02">02</span></td><td><b>${t('ov.epSendNone')}</b></td>`);
        expect(html).toContain(t('ov.epStageDays', { n: 20 }));
        expect(html).toContain(t('ov.epTrigCap', { item: t('mat.fuel.full'), d: 31 }));
        // 第三列回到第一套：階段序號 1（不是 3）；換回 13 加粗；最後一列寫全部存滿。
        expect(html).toContain(`<td><b><span title="遠征13">13</span></b></td>`);
        expect(html).toContain(`<td>${t('ov.epStageFull')}</td></tr>`);
        // 目前階段的切換條件只在上方寫一次。
        expect(html.split(t('ov.epTrigRise', { item: t('mat.fuel.full'), amount: '16.6萬', d: 11 })).length).toBe(2);
        // 艦隊編號不明時欄名寫「第 n 隊」。
        const noDeck = phaseOf({ segments: [seg(10, [fleet(null, 2), fleet(null, 13)], null), segments[1]] });
        expect(planResultHtml(view(phasePlan({}, noDeck)))).toContain(`<th>${t('ov.epFleetN', { n: 1 })}</th><th>${t('ov.epFleetN', { n: 2 })}</th>`);
    });

    it('整體規劃表：有睡前遠征時格內寫「在線・睡前」，缺的一半寫破折號，並附一行說明', () => {
        const night = phaseOf({ segments: [segments[0], seg(20, [fleet(1, 2, 36), fleet(2, null, 35)], null, [0, 1])], stage: [1, 2] });
        const html = planResultHtml(view(phasePlan({ sleepMinutes: 450 }, night))).replace(/>\s+</g, '><');
        expect(html).toContain(`<td><b><span title="遠征02">02</span>・<span title="遠征36">36</span></b></td>`);
        expect(html).toContain(`<td><b>—・<span title="遠征35">35</span></b></td>`);
        expect(html).toContain(t('ov.epCellNote'));
        expect(planResultHtml(view(phasePlan()))).not.toContain(t('ov.epCellNote'));
    });

    it('目前階段下面：切換條件、會減少的資材與沿用說明', () => {
        const html = planResultHtml(view(phasePlan({ sticky: true })));
        expect(html).toContain(t('ov.epTrigRise', { item: t('mat.fuel.full'), amount: '16.6萬', d: 11 }));
        expect(html).not.toContain(t('ov.epPhaseDip', { items: t('mat.fuel.full') }));
        expect(html).toContain(t('ov.epSticky'));
        // 第一段有勾選資材的淨增減為負時說明後面會補回。
        const dip = planResultHtml(view(phasePlan({}, phaseOf({ segments: [{ ...segments[0], rate: { fuel: -5 } }, ...segments.slice(1)] }))));
        expect(dip).toContain(t('ov.epPhaseDip', { items: t('mat.fuel.full') }));
        expect(planResultHtml(view(phasePlan()))).not.toContain(t('ov.epSticky'));
    });

    it('沿用上次的路線：標題寫第 k／n 階段、總結句說還要幾天、說明照上次的規劃繼續（不再寫沿用目前遠征）', () => {
        const kept = phasePlan({ sticky: true }, phaseOf({ routeKept: true, stage: [2, 3, 2], stageCount: 3 }));
        const html = planResultHtml(view(kept));
        expect(html).toContain(t('ov.epPhaseOf', { k: 2, n: 3 }));
        expect(html).toContain(t('ov.epPhaseFullLeft', { n: 3, days: 36, single: t('ov.epPhaseSingleDays', { n: 51 }) }));
        expect(html).not.toContain(summaryOf(3));
        expect(html).toContain(t('ov.epRouteKept'));
        expect(html).not.toContain(t('ov.epSticky'));
        expect(html).toContain(t('ov.epStageN', { n: 2 }));
        // 沒沿用路線時不寫。
        expect(planResultHtml(view(phasePlan()))).not.toContain(t('ov.epRouteKept'));
    });

    it('切換條件：存滿、快到上限、降到、沒有明確轉折；只剩一段時沒有切換條件也沒有整體規劃與結論句以外的階段內容', () => {
        const withFirst = (trigger: PlanSegment['trigger']) => planResultHtml(view(phasePlan({}, phaseOf({ segments: [{ ...segments[0], trigger }, ...segments.slice(1)] }))));
        expect(withFirst({ kind: 'rise', key: 'fuel', at: 350000 })).toContain(t('ov.epTrigRiseFull', { item: t('mat.fuel.full'), d: 11 }));
        expect(withFirst({ kind: 'cap', key: 'fuel', at: 349000 })).toContain(t('ov.epTrigCap', { item: t('mat.fuel.full'), d: 11 }));
        expect(withFirst({ kind: 'fall', key: 'fuel', at: 50000 })).toContain(t('ov.epTrigFall', { item: t('mat.fuel.full'), amount: '5萬', d: 11 }));
        expect(withFirst(null)).toContain(t('ov.epTrigTime', { d: 11 }));
        const single = planResultHtml(view(phasePlan({}, phaseOf({ segments: [segments[0]], stage: [2], stageCount: 3, routeKept: true }))));
        expect(single).not.toContain(t('ov.epTrigRise', { item: t('mat.fuel.full'), amount: '16.6萬', d: 11 }));
        expect(single).not.toContain('el-plan-phases');
        expect(single).not.toContain(t('ov.epOverall'));
        // 還在最後階段：標題仍寫第 k／n 階段，並有結論句。
        expect(single).toContain(t('ov.epPhaseOf', { k: 2, n: 3 }));
        expect(single).toContain(t('ov.epVerdictNote'));
    });

    it('單組沒有整體規劃：現在派這三隊之後是全部存滿那句與結論句', () => {
        const filling = planExpeditions({
            missions: [mission], records, intervalMinutes: 180, horizonDays: 10, untilFull: true,
            needs: [{ key: 'fuel', have: 340000, cap: 350000, base: null, current: null }],
        });
        expect(filling.phases).toBeNull();
        const html = planResultHtml(view(filling));
        expect(html).toContain(t('ov.epNowTitle'));
        expect(html).toContain(t('ov.epAllFull', { n: 5 }));
        expect(html).toContain(t('ov.epVerdictNote'));
        expect(html.indexOf(t('ov.epNowTitle'))).toBeLessThan(html.indexOf(t('ov.epAllFull', { n: 5 })));
        expect(html.indexOf(t('ov.epAllFull', { n: 5 }))).toBeLessThan(html.indexOf(t('ov.epVerdictNote')));
        for (const key of ['ov.epOverall', 'ov.epRouteKept', 'ov.epSticky']) expect(html).not.toContain(t(key));
        expect(html).not.toContain('class="el-plan-stage"');
        expect(html).not.toContain('el-plan-phases');
    });

    it('running：進行中的優先、同一遠征只留一次、最後附上偏好備援', () => {
        const state = {
            decks: [{ api_mission: [0, 0] }, { api_mission: [1, 13] }, { api_mission: [0, 0] }, { api_mission: [2, 38] }],
            lastMissionForDeck: (deck: number) => ({ 1: 13, 2: 21, 3: 5 } as Record<number, number>)[deck] ?? null,
        };
        // 第二艦隊進行中 13、第四艦隊回港待收 38（兩者都排在前面）、第三艦隊上次跑 21；備援沒有艦隊編號，附在最後。
        expect(runningOf(state, [13, 7])).toEqual([
            { deck: 1, missionId: 13 }, { deck: 3, missionId: 38 }, { deck: 2, missionId: 21 },
            { deck: null, missionId: 13 }, { deck: null, missionId: 7 },
        ]);
        // 上次執行也是 13 的第三艦隊不重複；進行中的 38 仍在。
        expect(runningOf({ ...state, lastMissionForDeck: () => 13 }, []).map(item => item.deck)).toEqual([1, 3]);
        expect(runningOf({ decks: [], lastMissionForDeck: () => null }, [])).toEqual([]);
    });

    it('last：多階段取第一段各隊（在線優先、沒有在線取睡前），單組取在線再補只有睡前的隊', () => {
        expect(lastOf(phasePlan({ top: [] }))).toEqual([2, 13]);
        const first = { ...segments[0], fleets: [fleet(1, null, 36), fleet(2, 13, 35), fleet(3, 2, 2)] };
        expect(lastOf({ ...phasePlan(), phases: { ...phasePlan().phases, segments: [first] } })).toEqual([36, 13, 2]);
        const rows = [row(1, '1'), row(2, '2')];
        expect(lastOf({ ...base, top: rows, sleep: [row(3, '3'), row(4, '4'), row(5, '5')] })).toEqual([1, 2, 5]);
        expect(lastOf({ ...base, top: [], sleep: [] })).toEqual([]);
    });

    const withStore = (run: (store: Map<string, string>) => void) => {
        const store = new Map<string, string>();
        Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }, configurable: true });
        try { run(store); } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
    };

    it('偏好的 last 只收三個以內的正整數，壞資料退回空陣列', () => {
        withStore(store => {
            const load = (last: unknown) => { store.set('kc-exped-plan', JSON.stringify({ hours: 2, last })); return loadPlanPrefs().last; };
            expect(load([13, 38, 2])).toEqual([13, 38, 2]);
            for (const bad of [[1, 2, 3, 4], [0], [-1], [1.5], ['13'], 'x', null, undefined]) expect(load(bad)).toEqual([]);
            store.clear();
            expect(loadPlanPrefs()).toEqual(defaultPlanPrefs());
        });
    });

    it('偏好的路線：最多三階段、每階段最多三隊、id 為正整數或 null，壞資料連同條件一起退回空值', () => {
        withStore(store => {
            const load = (route: unknown, routeKey: unknown = 'k') => { store.set('kc-exped-plan', JSON.stringify({ hours: 2, route, routeKey })); const prefs = loadPlanPrefs(); return [prefs.route, prefs.routeKey]; };
            const good = [[{ day: 2, night: 36 }, { day: 13, night: null }], [{ day: null, night: 35 }]];
            expect(load(good)).toEqual([good, 'k']);
            expect(load([])).toEqual([[], 'k']);
            const f = { day: 1, night: null };
            for (const bad of [[[f], [f], [f], [f]], [[f, f, f, f]], [[{ day: 0, night: null }]], [[{ day: 1.5, night: null }]], [[{ day: '2', night: null }]],
                [[{ day: 1 }]], [[null]], [[1]], [f], 'x', null, undefined]) expect(load(bad)).toEqual([[], '']);
            // 條件不是字串時只退回條件（路線沒有條件就不會被沿用）。
            expect(load(good, 5)).toEqual([good, '']);
            store.clear();
            expect(loadPlanPrefs().route).toEqual([]);
            expect(loadPlanPrefs().routeKey).toBe('');
        });
    });

    it('routeKeyOf：回收間隔、睡多久、支出基準、勾選與期限任一改變，條件就不同', () => {
        const prefs = { ...defaultPlanPrefs(), chosen: ['fuel' as const, 'steel' as const] };
        const key = routeKeyOf(prefs, null);
        expect(routeKeyOf({ ...prefs }, null)).toBe(key);
        const running = { ...prefs, last: [1, 2] };
        expect(routeKeyOf(running, null)).toBe(key);   // 正在跑什麼不算條件
        for (const changed of [{ hours: 2 }, { sleep: 7 }, { basis: 'none' as const }, { chosen: ['fuel' as const] }]) expect(routeKeyOf({ ...prefs, ...changed }, null)).not.toBe(key);
        expect(routeKeyOf(prefs, '2026-12-31')).not.toBe(key);
    });

    it('routeOf：多階段依階段序號去重（同一組合出現兩次只算一階段），單組是一階段；沒派的隊略過', () => {
        const plan = phasePlan({}, phaseOf({ segments: [segments[0], seg(20, [fleet(1, 2), fleet(2, null)], null, [1]), seg(5, [fleet(1, 2), fleet(2, 13)], null, [1])], stage: [1, 2, 1] }));
        expect(routeOf(plan)).toEqual([
            [{ day: 2, night: null }, { day: 13, night: null }],
            [{ day: 2, night: null }],
        ]);
        // 單組：同索引的在線與睡前是同一隊，睡前比在線多的隊只有睡前。
        expect(routeOf({ ...base, top: [row(2, '02'), row(13, '13')], sleep: [row(35, '35'), row(36, '36'), row(37, '37')] })).toEqual([
            [{ day: 2, night: 35 }, { day: 13, night: 36 }, { day: null, night: 37 }],
        ]);
        expect(routeOf({ ...base, top: [row(2, '02')], sleep: [] })).toEqual([[{ day: 2, night: null }]]);
        expect(routeOf({ ...base, top: [], sleep: [] })).toEqual([]);
    });

    it('updateRoute：新路線寫入偏好並記條件；沿用原路線不改（編號才延續）；空建議不覆蓋；沒變不寫', () => {
        const prefs = defaultPlanPrefs();
        const plan = phasePlan();
        expect(updateRoute(prefs, plan, 'k1')).toBe(true);
        expect(prefs.routeKey).toBe('k1');
        expect(prefs.route).toEqual(routeOf(plan));
        expect(updateRoute(prefs, plan, 'k1')).toBe(false);
        // 條件變了（同一路線）要換掉條件。
        expect(updateRoute(prefs, plan, 'k2')).toBe(true);
        expect(prefs.routeKey).toBe('k2');
        // 沿用原路線：偏好裡的路線完整保留，不被「剩下的階段」覆蓋。
        const before = JSON.stringify(prefs.route);
        const kept = phasePlan({}, phaseOf({ routeKept: true, stage: [2, 2, 2], stageCount: 2, segments: [segments[1]] }));
        expect(updateRoute(prefs, kept, 'k2')).toBe(false);
        expect(JSON.stringify(prefs.route)).toBe(before);
        // 單組（phases 為 null）存一階段路線。
        expect(updateRoute(prefs, { ...base, top: [row(2, '02')], sleep: [] }, 'k2')).toBe(true);
        expect(prefs.route).toEqual([[{ day: 2, night: null }]]);
        // 空建議不覆蓋。
        expect(updateRoute(prefs, { ...base, top: [], sleep: [] }, 'k3')).toBe(false);
        expect(prefs.routeKey).toBe('k2');
    });
});
