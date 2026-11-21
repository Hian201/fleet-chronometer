import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { db } from '../utils/db';
import { GameState } from '../utils/state';
import { FIRST_UNLOCK, MONTHLY_PATHS, MONTHLY_UNLOCK, unlockView } from '../utils/expedition-unlock';
import { expedLogSection } from '../entrypoints/overview/sections/exped-log';
import { unlockPageHtml } from '../entrypoints/overview/sections/exped-unlock';
import { setLang, t } from '../utils/ui-i18n';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));
const master = read('start2-master.json');
const NOW = Date.parse('2026-11-18T03:00:00Z');   // 樣本清單的本期內（換期 2026-12-15 12:00 JST）

function stateWith(list: unknown) {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master.api_data ?? master);
    if (list) state.applyEvent('api_get_member/mission', list);
    return state;
}
const viewOf = (state: GameState, now = NOW) => unlockView(state.masterMissions, state.missionList, now)!;

describe('遠征開放檢查', () => {
    it('條件表涵蓋主檔所有遠征（活動支援 S1／S2 除外），月常前置與路徑只含月常', () => {
        const state = stateWith(null);
        const ids = [...state.masterMissions].filter(([, m]) => m.maparea !== 62).map(([id]) => id);
        expect(ids.filter(id => !FIRST_UNLOCK[id])).toEqual([]);
        const monthly = new Set([...state.masterMissions].filter(([, m]) => m.resetType === 1).map(([id]) => id));
        for (const [id, reqs] of Object.entries(MONTHLY_UNLOCK)) {
            expect(monthly.has(Number(id))).toBe(true);
            expect(reqs.every(r => monthly.has(r))).toBe(true);
        }
        const pathIds = MONTHLY_PATHS.flatMap(path => path.ids);
        expect(pathIds.every(id => monthly.has(id))).toBe(true);
        expect(Object.keys(MONTHLY_UNLOCK).map(Number).every(id => pathIds.includes(id))).toBe(true);
    });

    it('沒收到遠征清單時不推論', () => {
        expect(unlockView(stateWith(null).masterMissions, null, NOW)).toBeNull();
    });

    it('真封包：本期前置未完成的月常是「本期未出現」，缺的是本期還沒完成的前置', () => {
        const view = viewOf(stateWith(read('mission-list.json')));
        expect(view.stale).toBe(false);
        expect(view.kind(1)).toBe('done');
        expect(view.kind(103)).toBe('open');      // A4
        expect(view.kind(112)).toBe('absent');    // B3
        expect(view.missing(112).missions).toEqual([111]);
        expect(view.missing(104).missions).toEqual([103, 112]);   // A5 需 A4＋B3
        expect(view.missing(105).missions).toEqual([104, 113]);   // A6 需 A5＋B4
        expect(view.missing(44).missions).toEqual([103]);
        expect(view.missing(43).missions).toEqual([42]);
        expect(view.missing(133).missions).toEqual([132]);
        expect(view.missing(103).missions).toEqual([]);
    });

    it('真封包：A4 本期完成後 44 可派，A5 只剩 B3', () => {
        const view = viewOf(stateWith(read('mission-list-a4-done.json')));
        expect(view.kind(103)).toBe('done');
        expect(view.kind(44)).toBe('open');
        expect(view.missing(104).missions).toEqual([112]);
    });

    it('成功紀錄補上本期完成，失敗、上期與未來紀錄不計，後續遠征仍等清單確認', () => {
        const state = stateWith(read('mission-list.json'));
        const view = unlockView(state.masterMissions, state.missionList, NOW, [
            { missionId: 103, ts: NOW, result: 1 }, // A4 成功
            { missionId: 112, ts: NOW, result: 2 }, // B3 大成功，舊清單尚未列出
            { missionId: 111, ts: NOW, result: 0 },
            { missionId: 42, ts: Date.parse('2026-11-15T02:59:59Z'), result: 1 },
            { missionId: 132, ts: NOW + 1, result: 2 },
        ])!;
        expect(view.kind(103)).toBe('done');
        expect(view.kind(112)).toBe('done');
        expect(view.kind(111)).toBe('open');
        expect(view.kind(42)).toBe('open');
        expect(view.kind(132)).toBe('open');
        expect(view.kind(44)).toBe('absent');
        expect(view.missing(104).missions).toEqual([]);
        expect(view.kind(104)).toBe('absent');
        expect(state.missionList?.states.get(103)).toBe(1);
    });

    it('清單是上一期的：月常完成清空、有每期前置的月常不出現', () => {
        const view = viewOf(stateWith(read('mission-list-a4-done.json')), Date.parse('2026-12-16T00:00:00Z'));
        expect(view.stale).toBe(true);
        expect(view.kind(103)).toBe('open');
        expect(view.kind(44)).toBe('absent');
        expect(view.missing(44).missions).toEqual([103]);
        expect(view.kind(1)).toBe('done');   // 一般遠征不受換期影響
    });

    it('換期後舊紀錄立即失效，新一期成功紀錄可補上仍是上一期的清單', () => {
        const state = stateWith(read('mission-list-a4-done.json'));
        const reset = state.missionList!.resetAt!;
        const view = unlockView(state.masterMissions, state.missionList, reset, [
            { missionId: 103, ts: reset - 1, result: 1 },
            { missionId: 111, ts: reset, result: 2 },
        ])!;
        expect(view.kind(103)).toBe('open');
        expect(view.kind(111)).toBe('done');
    });

    it('一般遠征未開放：缺首次條件；海域與任務照列', () => {
        const list = { api_list_items: [1, 2, 3, 9, 17, 18, 22].map(id => ({ api_mission_id: id, api_state: 2 })), api_limit_time: [1797303600] };
        const view = viewOf(stateWith(list));
        expect(view.kind(23)).toBe('locked');
        expect(view.missing(23)).toEqual({ missions: [], maps: ['1-5'], quest: false });
        expect(view.missing(4).missions).toEqual([]);
        expect(view.missing(14).missions).toEqual([11, 12, 13]);
        // 月常鏈的起點沒開過：B3 是「未開放」，不是「本期未出現」
        expect(view.kind(103)).toBe('locked');
        expect(view.missing(103).missions).toEqual([102]);
        expect(view.kind(112)).toBe('locked');
        expect(view.kind(44)).toBe('locked');
        expect(view.missing(44).missions).toEqual([103, 40, 41]);
    });

    it('開放頁：月常 16 條全列，每組第一個可派的是下一步；一般遠征全開時收合放在最後', () => {
        setLang('zh-TW');
        const html = unlockPageHtml(stateWith(read('mission-list-a4-done.json')), NOW);
        expect(html.split('class="eu-tr ').length - 1).toBe(16);
        expect([...html.matchAll(/eu-tr is-next[^]*?<span>([^<·]+)/g)].map(m => m[1].trim())).toEqual(['B2', '42', 'D2', '46']);
        expect(html).toContain('A6 · 需先完成 A5＋B4');
        expect(html).toContain('<details class="eu-general">');
        expect(html.indexOf('eu-general')).toBeGreaterThan(html.indexOf('eu-table'));
        expect(unlockPageHtml(stateWith(null), NOW)).toContain('還沒收到遠征清單');
    });

    it('開放頁已掛載時，遠征紀錄寫入即更新完成數，無須收到另一份清單', async () => {
        setLang('zh-TW');
        const { document } = parseHTML('<html><body><div id="host"></div></body></html>');
        const host = document.getElementById('host') as unknown as HTMLElement;
        const state = stateWith(read('mission-list.json'));
        const controller = new AbortController();
        vi.stubGlobal('location', { hash: '#/exped-log?sub=unlock' });
        vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            await expedLogSection.render(host, { state, signal: controller.signal, rerender() {}, async reloadState() {} });
            const page = host.querySelector('#el-page-unlock')!;
            await vi.waitFor(() => expect(page.textContent).not.toContain(t('ov.loading')));
            expect(page.textContent).toContain(t('ov.euMonthly', { a: 0, b: 16 }));
            await db.expeditions.put({
                eventId: 1, ts: NOW, deckId: 2, missionId: 103, name: '',
                result: 1, resources: [], items: [],
            });
            await vi.waitFor(() => expect(page.textContent).toContain(t('ov.euMonthly', { a: 1, b: 16 })));
            expect(page.querySelector('.eu-tr.is-done')?.textContent).toContain('A4');
            expect(state.missionList?.states.get(103)).toBe(1);
        } finally {
            controller.abort();
            await db.expeditions.clear();
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });
});
