import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../utils/state';
import { buildQuestFlow, QUEST_CATALOG_BY_NO } from '../utils/quest-flow';
import { questRewardGroups } from '../utils/quest-catalog-localization';
import { INCOME_FOCUS_KINDS, INCOME_MATERIALS, incomeFocusNos, materialIncome, materialQuantity } from '../utils/quest-material-income';
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

describe('資材收入：報酬數量', () => {
    it('目錄裡四種資材的每個報酬項都寫了數量，不會被默默略過', () => {
        const missing: number[] = [];
        for (const no of QUEST_CATALOG_BY_NO.keys()) {
            for (const group of questRewardGroups(no)) {
                for (const item of group.items) {
                    if ((INCOME_MATERIALS as readonly string[]).includes(item.name) && item.quantity === undefined) missing.push(no);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('品名要完全相同：新型噴進装備開発資材不算開発資材', () => {
        const rocket = [...QUEST_CATALOG_BY_NO.keys()].find(no =>
            questRewardGroups(no).some(group => group.items.some(item => item.name === '新型噴進装備開発資材')));
        expect(rocket).toBeDefined();
        const rewards = questRewardGroups(rocket!).flatMap(group => group.items);
        const rocketQty = rewards.filter(item => item.name === '新型噴進装備開発資材').reduce((sum, item) => sum + (item.quantity ?? 0), 0);
        const dev = materialQuantity(rocket!, '開発資材');
        expect(dev.fixed + dev.choice).toBe(
            rewards.filter(item => item.name === '開発資材').reduce((sum, item) => sum + (item.quantity ?? 0), 0));
        expect(rocketQty).toBeGreaterThan(0);
    });

    // 對照 wikiwiki「資材」頁（2026-11-11）的每日／每週任務表逐列加總。
    // 每日的開発資材 17、高速修復材 12 含表下方註記的兩個隔日任務（空母系3隻撃破、補給艦5隻撃破）。
    // 每週的改修資材 15 是表內各列相加；該頁自己的「計」欄寫 12，與表內各列不一致。
    it('定期任務各週期的確定報酬合計與 wiki 的任務表一致', () => {
        const model = buildQuestFlow(new GameState());
        const total = (period: string, material: (typeof INCOME_MATERIALS)[number]) => model.rows
            .filter(row => row.definition.period === period && !row.definition.limited)
            .reduce((sum, row) => sum + materialQuantity(row.definition.apiNo, material).fixed, 0);
        expect(INCOME_MATERIALS.map(m => total('daily', m))).toEqual([2, 17, 12, 5]);
        expect(INCOME_MATERIALS.map(m => total('weekly', m))).toEqual([15, 33, 12, 3]);
    });
});

describe('資材收入：清單', () => {
    it('擇一報酬與確定報酬分開加總；清單上的任務與狀態不明的任務分開', () => {
        // 1167（Fw5 改修工廠3回）：改修資材 確定 3、擇一 2
        const model = buildQuestFlow(listed([1167, 1]));
        const weekly = materialIncome(model.rows, '改修資材').find(group => group.key === 'weekly')!;
        const fw5 = weekly.entries.find(entry => entry.row.definition.apiNo === 1167)!;
        expect(fw5.listed).toBe(true);
        expect(fw5.quantity).toEqual({ fixed: 3, choice: 2 });
        expect(weekly.fixed).toBe(3);
        expect(weekly.choice).toBe(2);
        expect(weekly.entries.filter(entry => entry.listed).map(entry => entry.row.definition.apiNo)).toEqual([1167]);
        const rest = weekly.entries.filter(entry => !entry.listed);
        expect(weekly.unlistedFixed).toBe(rest.reduce((sum, entry) => sum + entry.quantity.fixed, 0));
    });

    it('本期已完成與已知未開放的任務不列入', () => {
        // 216（Bd2）每日，開発資材 1；改寫它的狀態來驗證排除規則
        const rows = buildQuestFlow(listed([216, 1])).rows;
        const daily = (list: typeof rows) => materialIncome(list, '開発資材').find(group => group.key === 'daily')?.entries
            .map(entry => entry.row.definition.apiNo) ?? [];
        expect(daily(rows)).toContain(216);
        for (const status of ['manual-complete', 'locked'] as const) {
            const changed = rows.map(row => row.definition.apiNo === 216 ? { ...row, status, current: null, available: null } : row);
            expect(daily(changed)).not.toContain(216);
        }
    });

    it('各組另寫任務數與本期已完成、未開放的任務數，合起來對得回目錄的篩選結果', () => {
        // 每日、報酬含開発資材的任務；空狀態下全是未開放，所以先列出 216 讓它的前置鏈開放，再只改狀態不明的幾項
        const rows = buildQuestFlow(listed([216, 1])).rows;
        const dailyRows = rows.filter(row => row.definition.period === 'daily' && !row.definition.limited
            && materialQuantity(row.definition.apiNo, '開発資材').fixed > 0);
        const open = dailyRows.filter(row => row.status === 'unknown' && !row.current && !row.available);
        const baseLocked = dailyRows.filter(row => row.status === 'locked').length;
        expect(open.length).toBeGreaterThan(2);
        const [done1, locked, ...rest] = open;
        const changed = rows.map(row => {
            if (row === done1) return { ...row, status: 'manual-complete' as const };
            if (row === locked) return { ...row, status: 'locked' as const };
            return row;
        });
        const daily = materialIncome(changed, '開発資材').find(group => group.key === 'daily')!;
        expect(daily.doneNos).toEqual([done1.definition.apiNo]);
        expect(daily.lockedNos).toHaveLength(baseLocked + 1);
        expect(daily.lockedNos).toContain(locked.definition.apiNo);
        // 其餘任務都不在清單上：全歸狀態不明，任務數與資材數量各自加總
        expect(daily.unlistedFixedTasks).toBe(rest.length);
        expect(daily.unlistedFixed).toBe(rest.reduce((sum, row) => sum + materialQuantity(row.definition.apiNo, '開発資材').fixed, 0));
        expect(daily.fixedTasks + daily.unlistedFixedTasks + daily.doneNos.length + daily.lockedNos.length).toBe(dailyRows.length);
    });

    it('同一組全部已完成時仍顯示該組，讓玩家看得到「都做完了」', () => {
        const rows = buildQuestFlow(new GameState()).rows.map(row =>
            row.definition.period === 'daily' && !row.definition.limited ? { ...row, status: 'manual-complete' as const } : row);
        const daily = materialIncome(rows, '開発資材').find(group => group.key === 'daily')!;
        expect(daily.entries).toEqual([]);
        expect(daily.doneNos.length).toBeGreaterThan(0);
    });

    it('每個可點的類別，任務編號數量與摘要上的任務數一致；「整個週期」是各類加總', () => {
        const rows = buildQuestFlow(listed([216, 1, ], [1167, 1])).rows;
        for (const material of INCOME_MATERIALS) {
            for (const group of materialIncome(rows, material)) {
                expect(incomeFocusNos(group, 'fixed').size).toBe(group.fixedTasks);
                expect(incomeFocusNos(group, 'choice').size).toBe(group.choiceTasks);
                expect(incomeFocusNos(group, 'unknown').size).toBe(group.unlistedFixedTasks);
                expect(incomeFocusNos(group, 'unknownChoice').size).toBe(group.unlistedChoiceTasks);
                expect(incomeFocusNos(group, 'done').size).toBe(group.doneNos.length);
                expect(incomeFocusNos(group, 'locked').size).toBe(group.lockedNos.length);
                const all = incomeFocusNos(group, 'all');
                expect(all.size).toBe(group.entries.length + group.doneNos.length + group.lockedNos.length);
                for (const kind of INCOME_FOCUS_KINDS) for (const no of incomeFocusNos(group, kind)) expect(all.has(no)).toBe(true);
            }
        }
    });

    it('單發任務只收清單上的，期間限定任務沒在清單上也不列', () => {
        // 146（A45）單發，改修資材 5
        expect(materialIncome(buildQuestFlow(new GameState()).rows, '改修資材').some(group => group.key === 'once')).toBe(false);
        const once = materialIncome(buildQuestFlow(listed([146, 1])).rows, '改修資材').find(group => group.key === 'once')!;
        expect(once.entries.map(entry => entry.row.definition.apiNo)).toEqual([146]);
        expect(once.fixed).toBe(5);

        const rows = buildQuestFlow(new GameState()).rows;
        for (const material of INCOME_MATERIALS) {
            for (const group of materialIncome(rows, material)) {
                expect(group.entries.some(entry => entry.row.definition.limited && !entry.listed)).toBe(false);
            }
        }
    });

    it('營運重用編號的新任務不沿用舊任務的報酬', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 1167, api_state: 1, api_title: '完全不同的新任務', api_detail: '新任務' }],
        }, { api_tab_id: '0' });
        const weekly = materialIncome(buildQuestFlow(state).rows, '改修資材').find(group => group.key === 'weekly');
        expect(weekly?.entries.some(entry => entry.row.definition.apiNo === 1167) ?? false).toBe(false);
    });
});

describe('資材收入摘要條', () => {
    async function mount(prefs: Record<string, unknown>, state = listed([1167, 1])) {
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
        const strip = () => host.querySelector<HTMLElement>('.qf-income-strip');
        const chip = (value: string) =>
            host.querySelector<HTMLButtonElement>(`[data-qf-facet="reward"][data-qf-value="${value}"]`)!;
        return { host, strip, chip };
    }

    it('獎勵篩選沒選資材時沒有摘要條，也沒有獨立的資材選擇器', async () => {
        const { host, strip } = await mount({});
        expect(strip()).toBeNull();
        expect(host.querySelector('.qf-income, [data-qf-income-material]')).toBeNull();
    });

    it('獎勵篩選四種資材都能選，選了剛好一種才出現摘要條', async () => {
        const { strip, chip } = await mount({});
        for (const name of INCOME_MATERIALS) expect(chip(name)).not.toBeNull();
        chip('改修資材').click();
        expect(strip()!.textContent).toContain('改修資材');
        const weekly = strip()!.querySelector('[data-qf-income-group="weekly"]')!;
        // 1167 在清單上：確定 1 項 +3、擇一 1 項 +2（「N 項」是任務數，「+數字」是資材數量）
        expect(weekly.textContent).toMatch(/確定\s*1 項\s*\+3/);
        expect(weekly.textContent).toMatch(/擇一\s*1 項\s*\+2/);

        chip('開発資材').click();
        expect(strip() === null).toBe(true);
        chip('改修資材').click();
        expect(strip()!.textContent).toContain('開發資材');
        chip('開発資材').click();
        expect(strip() === null).toBe(true);
    });

    it('其他種類的報酬篩選不觸發摘要條；摘要條與資材同時選其他報酬時照常出現', async () => {
        const { strip, chip } = await mount({ filters: { reward: ['戦果'] } });
        expect(strip()).toBeNull();
        chip('改修資材').click();
        expect(strip()).not.toBeNull();
    });

    it('點週期名稱或合計，目錄只剩摘要那一類任務；再點取消，改選資材也自動取消', async () => {
        const { host, chip } = await mount({ filters: { reward: ['改修資材'] } });
        const catalog = () => [...host.querySelectorAll('.qf-catalog [data-qf-target]')]
            .map(n => Number(n.getAttribute('data-qf-target'))).sort((a, b) => a - b);
        const press = (focus: string) => host.querySelector<HTMLButtonElement>(`[data-qf-income-focus="${focus}"]`)!;
        const before = catalog();

        // 1167 在清單上：「確定」只剩它一個
        press('weekly:fixed').click();
        expect(catalog()).toEqual([1167]);
        expect(press('weekly:fixed').getAttribute('aria-pressed')).toBe('true');
        // 「整個週期」= 摘要各類任務加總（含已完成、未開放）
        press('weekly:all').click();
        const weekly = catalog();
        expect(weekly).toContain(1167);
        expect(weekly.length).toBeGreaterThan(1);
        expect(weekly.length).toBeLessThan(before.length);
        // 再點同一個取消
        press('weekly:all').click();
        expect(catalog()).toEqual(before);

        press('weekly:fixed').click();
        chip('開発資材').click();
        expect(host.querySelector('.qf-income-strip')).toBeNull();
        chip('開発資材').click();
        expect(host.querySelector('[data-qf-income-focus][aria-pressed="true"]')).toBeNull();
        expect(catalog().length).toBeGreaterThan(1);
    });

    it('摘要條不重複列任務：逐列任務仍在目錄，且目錄只因篩選而變', async () => {
        const { host, chip } = await mount({});
        chip('改修資材').click();
        const rows = [...host.querySelectorAll('.qf-catalog [data-qf-target]')].map(n => Number(n.getAttribute('data-qf-target')));
        expect(rows).toContain(1167);
        expect(host.querySelector('.qf-catalog .qf-income-strip')).not.toBeNull();
    });
});
