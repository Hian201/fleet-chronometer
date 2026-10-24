// 常規導航分區的即時更新：編成改變只重畫內容區，工具列與展開中的浮層不重建（CLAUDE.md 規則 9）。
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { setLang } from '../utils/ui-i18n';
import { routeForecastSection } from '../entrypoints/overview/sections/route-forecast';

const readJson = (rel: string) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const master = readJson('samples/start2-master.json');
const port = readJson('samples/slot_to_port.json');
const stypeOf = new Map<number, number>((master.api_data ?? master).api_mst_ship.map((s: any) => [s.api_id, s.api_stype]));
const idsOfStype = (st: number, n: number) => port.api_data.api_ship
    .filter((s: any) => stypeOf.get(s.api_ship_id) === st).slice(0, n).map((s: any) => s.api_id as number);

function portWithFleet(ids: number[]) {
    const data = structuredClone(port.api_data);
    data.api_deck_port[0].api_ship = [...ids, ...Array(6 - ids.length).fill(-1)];
    return data;
}

let host: HTMLElement;
let listener: ((paths: readonly string[]) => void) | null;
let state: GameState;

beforeEach(async () => {
    setLang('zh-TW');
    const { document, window } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>');
    const store = new Map<string, string>([['kc-route-forecast', JSON.stringify({ map: '1-5', fleet: 0, stage: {} })]]);
    Object.assign(globalThis, {
        document, window,
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem() {} },
    });
    host = document.getElementById('host') as unknown as HTMLElement;
    state = new GameState();
    state.applyEvent('api_start2/getData', master.api_data ?? master);
    state.applyEvent('api_port/port', portWithFleet(idsOfStype(2, 4)));   // 驅逐 4：1-5 固定到王
    listener = null;
    await routeForecastSection.render(host, {
        get state() { return state; }, rerender() {}, async reloadState() {},
        onStateChange: (fn) => { listener = fn; },
    });
});

describe('常規導航即時更新', () => {
    it('換成帶補給艦的編成：重畫判定，工具列與展開中的世界地圖保留', () => {
        expect(host.querySelector('.rf-verdict-fixed')).not.toBeNull();
        const toolbar = host.querySelector('.rf-bar');
        const world = host.querySelector('.rf-world')!;
        world.setAttribute('open', '');
        state.applyEvent('api_port/port', portWithFleet([...idsOfStype(2, 3), ...idsOfStype(22, 1)]));
        listener!(['api_port/port']);
        expect(host.querySelector('.rf-verdict-fixed')).toBeNull();
        expect(host.querySelector('.rf-verdict-possible')).not.toBeNull();
        expect(host.querySelector('.rf-bar')).toBe(toolbar);
        expect(host.querySelector('.rf-world')!.hasAttribute('open')).toBe(true);
    });

    it('編成沒變的封包不重畫內容區', () => {
        const grid = host.querySelector('.rf-side-body .rf-fleetgrid');
        listener!(['api_req_map/next']);
        expect(host.querySelector('.rf-side-body .rf-fleetgrid')).toBe(grid);
    });

    it('艦隊分頁在右欄編成上方，切換只重畫內容、分頁本身不重建', () => {
        const tabs = [...host.querySelectorAll('.rf-side .rf-fleet-tab')];
        expect(tabs).toHaveLength(4);
        expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
        expect(host.querySelector('.rf-bar .rf-fleet-tab, .rf-bar select.rf-fleet')).toBeNull();
        (tabs[1] as unknown as HTMLElement).click();
        const after = [...host.querySelectorAll('.rf-side .rf-fleet-tab')];
        expect(after[1]).toBe(tabs[1]);
        expect(after[1].getAttribute('aria-pressed')).toBe('true');
        expect(after[0].getAttribute('aria-pressed')).toBe('false');
    });
});
