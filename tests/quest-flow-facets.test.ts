import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../utils/state';
import { buildQuestFlow, QUEST_CATALOG_BY_NO } from '../utils/quest-flow';
import {
    compareQuestMapLabels, matchesFacets, questCauseSummary, questFacetCounts, questGraphFitScale, questGraphZoomStep,
    questMapLabel, questRowFacets, type QuestRowFacets,
} from '../utils/quest-flow-facets';
import { QUEST_FLOW_PREFS_KEY } from '../utils/quest-flow-prefs';
import { setLang } from '../utils/ui-i18n';
import { questFlowSection } from '../entrypoints/overview/sections/quest-flow';

afterEach(() => { vi.unstubAllGlobals(); setLang('zh-TW'); });

function listed(...entries: [number, number][]): GameState {
    const state = new GameState();
    state.applyEvent('api_get_member/questlist', {
        api_list: entries.map(([no, apiState]) => ({
            api_no: no, api_state: apiState,
            api_title: QUEST_CATALOG_BY_NO.get(no)!.name, api_detail: QUEST_CATALOG_BY_NO.get(no)!.detail,
        })),
    }, { api_tab_id: '0' });
    return state;
}

const facets = (partial: Partial<QuestRowFacets>): QuestRowFacets => ({
    list: [], progress: [], period: [], category: [], reward: [], map: [], ...partial,
});

describe('任務導覽篩選標籤', () => {
    it('條件表的 maparea 轉成海域代號，依世界與關卡排序', () => {
        expect(questMapLabel(15)).toBe('1-5');
        expect(questMapLabel(75)).toBe('7-5');
        expect(['7-1', '1-6', '2-1', '1-2'].sort(compareQuestMapLabels)).toEqual(['1-2', '1-6', '2-1', '7-1']);
    });

    it('每列任務帶出清單狀態、進度、週期、分類、報酬與出擊海域', () => {
        // Bw10（261）：1-5 王點 A 勝 3 次，獎勵改修資材
        const model = buildQuestFlow(listed([261, 1], [214, 2], [303, 3]));
        const bw10 = questRowFacets(model.byNo.get(261)!);
        expect(bw10.list).toEqual(['available']);
        expect(bw10.progress).toEqual(['todo']);
        expect(bw10.period).toEqual(['weekly']);
        expect(bw10.category).toEqual(['sortie']);
        expect(bw10.map).toEqual(['1-5']);
        expect(bw10.reward).toContain('改修資材');
        expect(questRowFacets(model.byNo.get(214)!).list).toEqual(['in-progress']);
        expect(questRowFacets(model.byNo.get(303)!).list).toEqual(['ready']);
    });

    it('戦果與装備運用枠帶數值，以前綴比對', () => {
        const model = buildQuestFlow(new GameState());
        const withRanking = [...model.rows].filter(row => questRowFacets(row).reward.includes('戦果'));
        const withSlots = [...model.rows].filter(row => questRowFacets(row).reward.includes('装備運用枠'));
        expect(withRanking.length).toBeGreaterThan(0);
        expect(withSlots.length).toBeGreaterThan(0);
    });

    it('營運重用編號的新任務不沿用舊任務的報酬與海域', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 261, api_state: 1, api_title: '新しい任務', api_detail: '' }],
        }, { api_tab_id: '0' });
        const row = buildQuestFlow(state).byNo.get(261)!;
        expect(questRowFacets(row).reward).toEqual([]);
        expect(questRowFacets(row).map).toEqual([]);
    });

    it('同組任一符合、跨組全部符合', () => {
        const row = facets({ period: ['weekly'], category: ['sortie'], map: ['1-5'] });
        expect(matchesFacets(row, { period: ['daily', 'weekly'] })).toBe(true);
        expect(matchesFacets(row, { period: ['weekly'], category: ['practice'] })).toBe(false);
        expect(matchesFacets(row, { period: ['weekly'], map: ['1-4', '1-5'] })).toBe(true);
        expect(matchesFacets(row, {})).toBe(true);
    });

    it('計數不套用本組條件，選了同組其他項也不會讓其餘選項歸零', () => {
        const all = [
            facets({ period: ['weekly'], category: ['sortie'] }),
            facets({ period: ['daily'], category: ['sortie'] }),
            facets({ period: ['daily'], category: ['practice'] }),
        ];
        const counts = questFacetCounts(all, { period: ['weekly'] });
        expect(counts.period.get('daily')).toBe(2);
        expect(counts.period.get('weekly')).toBe(1);
        expect(counts.category.get('sortie')).toBe(1);
        expect(counts.category.get('practice')).toBeUndefined();
    });

    it('關係圖放大檢視：符合視窗不放大超過 100%、不小於 25%，縮放一級為 1.25 倍', () => {
        expect(questGraphFitScale(2000, 1000, 1000, 1000)).toBe(0.5);
        expect(questGraphFitScale(500, 300, 1000, 1000)).toBe(1);
        expect(questGraphFitScale(8000, 8000, 1000, 1000)).toBe(0.25);
        expect(questGraphFitScale(1000, 9000, 900, Infinity)).toBe(0.9);
        expect(questGraphZoomStep(1, 1)).toBe(1.25);
        expect(questGraphZoomStep(1, -1)).toBe(0.8);
        expect(questGraphZoomStep(2, 1)).toBe(2);
        expect(questGraphZoomStep(0.25, -1)).toBe(0.25);
    });

    it('已出現在任務清單的任務不算前置接近完成，直接前置全數滿足', () => {
        const model = buildQuestFlow(listed([216, 1]));
        const row = model.byNo.get(216)!;
        expect(row.nearUnlock).toBe(false);
        const cause = questCauseSummary(model, row);
        expect(cause.satisfied).toBe(cause.groups);
        expect(cause.unlocks).toBe(row.postrequisiteNos.length);
    });
});

describe('任務導覽篩選工具列', () => {
    async function mount(prefs: Record<string, unknown>, state = listed([261, 1], [214, 2])) {
        const { document, window } = parseHTML('<html><body><div id="host"></div></body></html>');
        const store = new Map([[QUEST_FLOW_PREFS_KEY, JSON.stringify(prefs)]]);
        vi.stubGlobal('document', document);
        vi.stubGlobal('window', window);
        vi.stubGlobal('location', { hash: '#/quest-flow' });
        vi.stubGlobal('history', { replaceState() {} });
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => { store.set(key, value); },
            removeItem: (key: string) => { store.delete(key); },
        });
        const host = document.getElementById('host') as unknown as HTMLElement;
        await questFlowSection.render(host, { state, rerender() {}, async reloadState() {} });
        const saved = () => JSON.parse(store.get(QUEST_FLOW_PREFS_KEY)!);
        const chip = (group: string, value: string) =>
            host.querySelector<HTMLButtonElement>(`[data-qf-facet="${group}"][data-qf-value="${value}"]`)!;
        const catalog = () => [...host.querySelectorAll('.qf-catalog [data-qf-target]')]
            .map(node => Number(node.getAttribute('data-qf-target')));
        return { host, saved, chip, catalog };
    }

    it('「更多條件」浮層每次進入分區都收起，點完成或浮層外即關閉', async () => {
        const { host } = await mount({ moreOpen: true });
        const more = host.querySelector<HTMLDetailsElement>('.qf-more')!;
        expect(more.hasAttribute('open')).toBe(false);
        more.setAttribute('open', '');
        (more as unknown as { open: boolean }).open = true;
        host.querySelector<HTMLButtonElement>('.qf-more-close')!.click();
        expect(more.open).toBe(false);
    });

    it('舊版的統計列與下拉偏好換算成多選條件', async () => {
        const { chip, saved } = await mount({ bucket: 'recurring', category: 'sortie' });
        expect(chip('period', 'weekly').getAttribute('aria-pressed')).toBe('true');
        expect(chip('period', 'once').getAttribute('aria-pressed')).toBe('false');
        expect(chip('category', 'sortie').getAttribute('aria-pressed')).toBe('true');
        expect(saved().bucket).toBe('recurring');

        const pinned = await mount({ bucket: 'pinned' });
        expect(pinned.chip('pinned', 'only').getAttribute('aria-pressed')).toBe('true');
    });

    it('點選標籤只重繪結果；同一個按鈕更新按下狀態與計數', async () => {
        const { host, chip, saved, catalog } = await mount({});
        const weekly = chip('period', 'weekly');
        weekly.click();
        expect(chip('period', 'weekly')).toBe(weekly);
        expect(weekly.getAttribute('aria-pressed')).toBe('true');
        expect(saved().filters).toEqual({ period: ['weekly'] });
        // Bw10（261）與受注中的あ号作戦（214）都是週任；日常的進攻敵軍艦隊（216）不在結果裡
        expect(catalog()).toEqual(expect.arrayContaining([261, 214]));
        expect(catalog()).not.toContain(216);

        chip('map', '1-5').click();
        // 1-5 的週任：Bw10 與 2026 南瓜週任（985 特務護衛戦隊、1039 Halloween海上護衛隊）
        expect([...catalog()].sort((x, y) => x - y)).toEqual([261, 985, 1039]);
        expect(chip('list', 'available').querySelector('b')!.textContent).toBe('1');
        expect(host.querySelector<HTMLElement>('.qf-selected')!.hidden).toBe(false);

        // 已選條件逐一移除
        host.querySelector<HTMLButtonElement>('[data-qf-remove="map"][data-qf-value="1-5"]')!.click();
        expect(saved().filters).toEqual({ period: ['weekly'] });
        expect(catalog()).toEqual(expect.arrayContaining([261, 214]));

        host.querySelector<HTMLButtonElement>('.qf-clear')!.click();
        expect(saved().filters).toEqual({});
        expect(weekly.getAttribute('aria-pressed')).toBe('false');
        expect(host.querySelector<HTMLElement>('.qf-selected')!.hidden).toBe(true);
    });
});
