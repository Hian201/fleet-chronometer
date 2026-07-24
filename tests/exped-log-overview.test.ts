// 遠征紀錄分區的 HTML 產出驗證（無 DOM，同 ships-overview／sortie-log-overview 的作法：
// 只測「純字串產出」的部分，事件與 DOM 綁定留給實際使用）。
import { describe, expect, it, beforeAll } from 'vitest';
import type { ExpeditionRow } from '../utils/db';
import { groupByMission, summarize } from '../utils/expedition-stats';
import { defaultPrefs, statsHtml, summaryHtml } from '../entrypoints/overview/sections/exped-log';
import { setLang, t } from '../utils/ui-i18n';

beforeAll(() => setLang('zh-TW'));

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
            from: new Date(1000).toLocaleString(), to: new Date(2000).toLocaleString(),
        }));
    });

    it('期間內沒有紀錄時明講是「這個期間沒有」，並附上所選的窗', () => {
        const html = summaryHtml(summarize([]), 1000, 2000, []);
        expect(html).toContain(t('ov.expedSumRangeNone', {
            from: new Date(1000).toLocaleString(), to: new Date(2000).toLocaleString(),
        }));
    });

    it('回航道具只顯示 id × 數量，且不併進資源小計', () => {
        const rows = [exped({ ts: 1000, resources: [0, 0, 0, 0], items: [{ id: 4, count: 3 }] })];
        const html = summaryHtml(summarize(rows), null, null, rows);
        expect(html).toContain('#4 ×3');
        expect(html).toContain(t('ov.expedItemsLabel'));
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
});
