// 遠征紀錄分區的 HTML 產出驗證（無 DOM，同 ships-overview／sortie-log-overview 的作法：
// 只測「純字串產出」的部分，事件與 DOM 綁定留給實際使用）。
import { describe, expect, it, beforeEach } from 'vitest';
import type { ExpeditionRow } from '../utils/db';
import { groupByMission, summarize } from '../utils/expedition-stats';
import { MIN_RUNS, planExpeditions, type ResourceNeed } from '../utils/expedition-plan';
import { COLUMNS, defaultPrefs, planResultHtml, statsHtml, summaryHtml } from '../entrypoints/overview/sections/exped-log';
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
        { id: 942, dispNo: '42', name: '月常遠征', time: 60, resetType: 1, winItems: [[0, 0], [0, 0]] as [number, number][], use: [0, 0] as [number, number] },
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
        const now = Date.parse('2026-12-14T23:00:00Z');
        const monthlyRecords = [...tenRuns, exped({ ts: 2000, missionId: 942, result: 0 })];
        const due = planResultHtml({
            ...view(monthlyRecords), now,
            plan: planExpeditions({ missions, records: monthlyRecords, intervalMinutes: 180, needs: [need('fuel', 1000, null, 350000)], horizonDays: 10, now }),
        });
        // 本期在 12/15 03:00 UTC 截止：剩 4 小時（不到一天改用小時）。
        expect(due).toContain(t('ov.epMonthlyDue', { date: formatDateTime(Date.parse('2026-12-15T03:00:00Z'), false), left: t('ov.epLeftHours', { n: 4 }) }));
        expect(due).toContain(`<th>${t('ov.epCycle')}</th>`);
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
        expect(html.split('el-plan-table').length).toBe(1 + 3);     // 在線、睡前、全部候選
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
        // 期限：改寫到期限為止。會存滿：(350,000 − 340,000) ÷ 2,400 ≈ 4.2 → 5 天。
        expect(planResultHtml({ ...view(tenRuns, [need('fuel', 175000, 100, 350000)]), deadline: '2026-12-31' }))
            .toContain(t('ov.epSpanDeadline', { date: '2026-12-31' }));
        // 支出照最少的一週：寫明是哪一週；那週早於道具記錄且勾了道具時另外說明。
        const weekView = { ...view(tenRuns, [need('fuel', 175000, 100, 350000), need('drum', 300, 1)]), basis: 'lightest' as const, week: { fromTs: 0, toTs: 7 * 86400000 } };
        expect(planResultHtml(weekView)).toContain(t('ov.epSpendWeek', { from: formatDate(0), to: formatDate(7 * 86400000) }));
        expect(planResultHtml(weekView)).toContain(t('ov.epSpendWeekItems'));
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
