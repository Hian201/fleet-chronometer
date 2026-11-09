import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { questCycleWindow, yearlyResetMonthFromLabel } from '../utils/quest-cycle';
import { buildQuestFlow, nextYearlyReset, QUEST_CATALOG_BY_NO } from '../utils/quest-flow';
import { questRowFacets } from '../utils/quest-flow-facets';
import { formatDate, formatDateTime } from '../utils/date-format';
import { questFlowDetailHtml } from '../entrypoints/overview/sections/quest-flow';
import { setLang } from '../utils/ui-i18n';
import { GameState } from '../utils/state';

// 日本時間 05:00 換期＝UTC 前一日 20:00
const jstReset = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) - 4 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe('questCycleWindow', () => {
    it('季任依 3／6／9／12 月 1 日 05:00 換期', () => {
        expect(questCycleWindow('quarterly', Date.UTC(2026, 10, 9, 3, 0)))
            .toEqual({ start: jstReset(2026, 9, 1), end: jstReset(2026, 12, 1) });
        // 12 月至隔年 2 月是同一期；2027 年 2 月沒有 29 日
        expect(questCycleWindow('quarterly', Date.UTC(2027, 0, 15)))
            .toEqual({ start: jstReset(2026, 12, 1), end: jstReset(2027, 3, 1) });
        expect(questCycleWindow('quarterly', jstReset(2027, 3, 1) - MINUTE)?.end).toBe(jstReset(2027, 3, 1));
        expect(questCycleWindow('quarterly', jstReset(2027, 3, 1))?.start).toBe(jstReset(2027, 3, 1));
        // 閏年 2 月 29 日 05:00 前仍屬冬季
        expect(questCycleWindow('quarterly', jstReset(2028, 2, 29))?.end).toBe(jstReset(2028, 3, 1));
    });

    it('年任依換期月的 1 日 05:00 換期，缺換期月時不猜', () => {
        const now = Date.UTC(2026, 10, 9, 3, 0);
        expect(questCycleWindow('yearly', now, 9)).toEqual({ start: jstReset(2026, 9, 1), end: jstReset(2027, 9, 1) });
        expect(questCycleWindow('yearly', now, 12)).toEqual({ start: jstReset(2025, 12, 1), end: jstReset(2026, 12, 1) });
        expect(questCycleWindow('yearly', jstReset(2027, 1, 1) - MINUTE, 1)?.start).toBe(jstReset(2026, 1, 1));
        expect(questCycleWindow('yearly', jstReset(2027, 1, 1), 1)?.start).toBe(jstReset(2027, 1, 1));
        expect(questCycleWindow('yearly', now)).toBeNull();
        expect(questCycleWindow('yearly', now, 13)).toBeNull();
    });

    it('日／週／月任沿用 05:00 日界，單發與季節任務沒有固定週期', () => {
        // 2026/11/09 是週一
        const mondayReset = jstReset(2026, 11, 9);
        expect(questCycleWindow('daily', mondayReset - MINUTE))
            .toEqual({ start: jstReset(2026, 11, 8), end: mondayReset });
        expect(questCycleWindow('weekly', mondayReset - MINUTE))
            .toEqual({ start: jstReset(2026, 11, 2), end: mondayReset });
        expect(questCycleWindow('weekly', mondayReset))
            .toEqual({ start: mondayReset, end: jstReset(2026, 11, 16) });
        expect(questCycleWindow('monthly', Date.UTC(2026, 11, 31, 19, 59)))
            .toEqual({ start: jstReset(2026, 12, 1), end: jstReset(2027, 1, 1) });
        expect(questCycleWindow('once', mondayReset)).toBeNull();
        expect(questCycleWindow('seasonal', mondayReset)).toBeNull();
    });
});

describe('年任換期月', () => {
    it('api_label_type 101–112 換算為月份', () => {
        expect(yearlyResetMonthFromLabel(101)).toBe(1);
        expect(yearlyResetMonthFromLabel(112)).toBe(12);
        expect(yearlyResetMonthFromLabel(7)).toBeNull();
        expect(yearlyResetMonthFromLabel(113)).toBeNull();
    });

    it('目錄的換期月與真封包 api_label_type 一致', () => {
        const sample = JSON.parse(readFileSync(resolve(__dirname, '../samples/Quest.json'), 'utf8'));
        const quests: { api_no: number; api_label_type: number }[] = [];
        const walk = (value: unknown): void => {
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value === 'object') {
                const record = value as Record<string, unknown>;
                if (typeof record.api_no === 'number' && 'api_label_type' in record) {
                    quests.push(record as unknown as { api_no: number; api_label_type: number });
                }
                Object.values(record).forEach(walk);
            }
        };
        walk(sample);
        const yearly = quests.filter(q => yearlyResetMonthFromLabel(q.api_label_type) !== null);
        expect(yearly.length).toBeGreaterThanOrEqual(18);
        for (const quest of yearly) {
            expect([quest.api_no, QUEST_CATALOG_BY_NO.get(quest.api_no)?.yearlyResetMonth])
                .toEqual([quest.api_no, yearlyResetMonthFromLabel(quest.api_label_type)]);
        }
    });

    it('目錄的常設年任都有換期月', () => {
        const missing = [...QUEST_CATALOG_BY_NO.values()]
            .filter(definition => definition.period === 'yearly' && definition.yearlyResetMonth === undefined)
            .map(definition => definition.apiNo);
        expect(missing).toEqual([]);
    });

    it('下一次年任換期取最近的換期月，並列出同月換期的任務', () => {
        // 2026/11/09 之後最近的是 12 月換期（1120【機種整理統合】新型戦闘機の量産計画）
        const catalog = [...QUEST_CATALOG_BY_NO.values()];
        expect(nextYearlyReset(catalog, Date.UTC(2026, 10, 9, 3, 0))).toEqual({ ts: jstReset(2026, 12, 1), month: 12, nos: [1120] });
        // 換期瞬間本身屬於新的一期，下一次是隔月
        const next = nextYearlyReset(catalog, jstReset(2026, 12, 1));
        expect(next?.ts).toBe(jstReset(2027, 1, 1));
        expect(next?.nos).toEqual(expect.arrayContaining([681, 1005, 1123]));
    });

    it('任務清單封包的 api_label_type 優先於目錄的換期月，並帶出換期月篩選標籤', () => {
        const state = new GameState();
        const quest = (no: number, label: number) => ({
            api_no: no, api_state: 1, api_label_type: label,
            api_title: QUEST_CATALOG_BY_NO.get(no)!.name, api_detail: QUEST_CATALOG_BY_NO.get(no)!.detail,
        });
        // 1120 目錄是 12 月；假設遊戲改標 6 月。657 與目錄一致（9 月）。
        state.applyEvent('api_get_member/questlist', { api_list: [quest(1120, 106), quest(657, 109)] }, { api_tab_id: '0' });
        expect(state.questYearlyResetMonths_()).toEqual(new Map([[1120, 6], [657, 9]]));
        const model = buildQuestFlow(state, new Set(), Date.UTC(2026, 10, 9));
        expect(model.byNo.get(1120)?.definition.yearlyResetMonth).toBe(6);
        expect(questRowFacets(model.byNo.get(1120)!).reset).toEqual(['6']);
        expect(questRowFacets(model.byNo.get(657)!).reset).toEqual(['9']);
        // 非年任標籤不產生換期月；季任沒有換期月標籤
        state.applyEvent('api_get_member/questlist', { api_list: [quest(1120, 7)] }, { api_tab_id: '0' });
        expect(state.questYearlyResetMonths_().has(1120)).toBe(false);
        expect(buildQuestFlow(state, new Set(), Date.UTC(2026, 10, 9)).byNo.get(1120)?.definition.yearlyResetMonth).toBe(12);
        expect(questRowFacets(model.byNo.get(637)!).reset).toEqual([]);
    });

    it('年任標頭寫出該任務的本期起訖，季任不重複寫（頂端摘要已有）', () => {
        setLang('zh-TW');
        const model = buildQuestFlow(new GameState(), new Set(), Date.UTC(2026, 10, 9));
        const view = { tab: 'path' as const, graphDone: false, pinned: false, manual: false,
            japaneseOriginalOpen: false, doneOpen: false, nowTs: Date.UTC(2026, 10, 9) };
        // 928（By5）歴戦「第十方面艦隊」、全力出撃！ 9 月換期
        const yearly = questFlowDetailHtml(model, model.byNo.get(928)!, view);
        expect(yearly).toContain(`>每年 ${formatDate(jstReset(2026, 9, 1))} – ${formatDate(jstReset(2027, 9, 1))}<`);
        expect(yearly).toContain(`${formatDateTime(jstReset(2026, 9, 1), false)} – ${formatDateTime(jstReset(2027, 9, 1), false)}`);
        expect(yearly).toContain('每年 9 月 1 日換期');
        expect(questFlowDetailHtml(model, model.byNo.get(637)!, view)).not.toContain('qf-yearly-cycle');
    });

    it('年任的本機完成只在同一期內算本期', () => {
        // 657（Fy1 新型兵装開発整備の強化）9 月換期
        expect(QUEST_CATALOG_BY_NO.get(657)?.yearlyResetMonth).toBe(9);
        const state = new GameState();
        const observedAt = jstReset(2026, 9, 1) + 60 * MINUTE;
        state.applyEvent('api_req_quest/clearitemget', {}, { api_quest_id: '657' }, observedAt);

        expect(buildQuestFlow(state, new Set(), jstReset(2027, 9, 1) - MINUTE).byNo.get(657)?.observedCurrentPeriod).toBe(true);
        expect(buildQuestFlow(state, new Set(), jstReset(2027, 9, 1)).byNo.get(657)?.observedCurrentPeriod).toBe(false);
    });
});
