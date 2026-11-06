import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mountGeneral } from '../entrypoints/panel/general';
import { GameState } from '../utils/state';
import { setLang } from '../utils/ui-i18n';

const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');
const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

type Row = { id: number; mst: number; cond?: number };
function rawShip({ id, mst, cond = 40 }: Row) {
    const m = master.api_mst_ship.find((x: any) => x.api_id === mst);
    return {
        api_id: id, api_ship_id: mst, api_lv: 99, api_nowhp: m.api_taik[0], api_maxhp: m.api_taik[0], api_cond: cond,
        api_fuel: m.api_fuel_max, api_bull: m.api_bull_max, api_slot: Array(m.api_slot_num).fill(-1), api_slot_ex: -1,
        api_onslot: m.api_maxeq,
    };
}
// 艦隊 1：明石改旗艦＋野埼改 2 號位；艦隊 3：明石旗艦但遠征中（不運作）；艦隊 4：野埼旗艦。
function portState(decks: Row[][], missions: number[][]) {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    state.applyEvent('api_get_member/require_info', { api_slot_item: [] });
    state.applyEvent('api_port/port', {
        api_ship: decks.flat().map(rawShip),
        api_deck_port: decks.map((deck, i) => ({ api_id: i + 1, api_ship: [...deck.map(s => s.id), ...Array(6 - deck.length).fill(-1)], api_mission: missions[i] })),
        api_ndock: [], api_material: [], api_basic: {}, api_combined_flag: 0,
    });
    return state;
}
const idle = [0, 0, 0, 0];
const OPS_DECKS: Row[][] = [
    [{ id: 1, mst: 187, cond: 49 }, { id: 2, mst: 1002, cond: 49 }, { id: 3, mst: 1 }],
    [{ id: 4, mst: 1 }],
    [{ id: 5, mst: 182, cond: 49 }, { id: 6, mst: 1 }],
    [{ id: 7, mst: 996, cond: 49 }, { id: 8, mst: 1 }],
];
const OPS_MISSIONS = [idle, idle, [1, 2, Date.now() + 3_600_000, 0], idle];
const QUIET_DECKS: Row[][] = [[{ id: 1, mst: 1 }], [{ id: 4, mst: 1 }], [{ id: 6, mst: 1 }], [{ id: 8, mst: 1 }]];

beforeAll(() => setLang('zh-TW'));
afterEach(() => vi.unstubAllGlobals());

function mount(state: GameState) {
    const { document, window } = parseHTML(panelHtml);
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    let current = state;
    const proxy = new Proxy({} as GameState, { get: (_, key) => Reflect.get(current, key, current) });
    const render = mountGeneral(proxy, () => '0:00:00', () => '9:59');
    render();
    return { document, render, swap: (next: GameState) => { current = next; render(); } };
}
const tabs = (document: Document) =>
    [...document.querySelectorAll('#operation-nav [data-operation]')].map(b => b.getAttribute('data-operation'));

describe('母港「泊地」分組', () => {
    it('有艦隊泊地修理或給糧時才出現，每隊一列、遠征中的艦隊不列入', () => {
        const { document } = mount(portState(OPS_DECKS, OPS_MISSIONS));
        expect(tabs(document)).toEqual(['exped', 'dock', 'build', 'anchor']);
        expect(document.getElementById('operation-nav')!.classList.contains('has-anchor')).toBe(true);
        const rows = [...document.querySelectorAll('#anchorage .upkeep-row:not(.upkeep-head)')];
        expect(rows.map(r => r.querySelector('.slot')!.textContent)).toEqual(['1', '4']);
        // 艦隊 1：修理與給糧都有；艦隊 4：只有給糧，修理欄是「—」而不是 0。
        expect(rows[0].querySelectorAll('.upkeep-cell:not(.none)').length).toBe(2);
        expect(rows[1].querySelectorAll('.upkeep-cell')[0].classList.contains('none')).toBe(true);
        expect(rows[1].querySelectorAll('.upkeep-cell')[0].textContent).toBe('—');
    });

    it('沒有艦隊運作時不顯示；正在看泊地分組時運作結束就退回遠征分組', () => {
        const quiet = mount(portState(QUIET_DECKS, [idle, idle, idle, idle]));
        expect(tabs(quiet.document)).toEqual(['exped', 'dock', 'build']);
        expect(quiet.document.getElementById('operation-nav')!.classList.contains('has-anchor')).toBe(false);

        const live = mount(portState(OPS_DECKS, OPS_MISSIONS));
        (live.document.querySelector('#operation-nav [data-operation="anchor"]') as unknown as HTMLElement).click();
        expect((live.document.getElementById('operation-anchor') as unknown as HTMLElement).hidden).toBe(false);
        live.swap(portState(QUIET_DECKS, [idle, idle, idle, idle]));
        expect(tabs(live.document)).toEqual(['exped', 'dock', 'build']);
        expect((live.document.getElementById('operation-anchor') as unknown as HTMLElement).hidden).toBe(true);
        expect((live.document.getElementById('operation-exped') as unknown as HTMLElement).hidden).toBe(false);
    });

    it('showUpkeep 從任務頁或其他分組直接切到母港「泊地」；沒有運作時不動', () => {
        const live = mount(portState(OPS_DECKS, OPS_MISSIONS));
        (live.document.querySelector('#general-nav [data-page="quests"]') as unknown as HTMLElement).click();
        expect((live.document.getElementById('general-harbor') as unknown as HTMLElement).hidden).toBe(true);
        expect(live.render.showUpkeep()).toBe(true);
        expect((live.document.getElementById('general-harbor') as unknown as HTMLElement).hidden).toBe(false);
        expect((live.document.getElementById('operation-anchor') as unknown as HTMLElement).hidden).toBe(false);
        expect(live.document.querySelector('#operation-nav [data-operation="anchor"]')!.getAttribute('aria-selected')).toBe('true');

        const quiet = mount(portState(QUIET_DECKS, [idle, idle, idle, idle]));
        (quiet.document.querySelector('#general-nav [data-page="quests"]') as unknown as HTMLElement).click();
        expect(quiet.render.showUpkeep()).toBe(false);
        expect((quiet.document.getElementById('general-quests') as unknown as HTMLElement).hidden).toBe(false);
    });
});
