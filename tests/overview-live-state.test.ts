// 情報總括即時狀態（entrypoints/overview/live-state.ts）：廣播只當訊號，每次從游標往後補讀整段。
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../utils/db';
import { createLiveState } from '../entrypoints/overview/live-state';

const readJson = (rel: string) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const master = readJson('samples/start2-master.json');
const port = readJson('samples/slot_to_port.json');

let listeners: ((msg: unknown) => void)[] = [];
const broadcast = (id: number) => listeners.forEach((fn) => fn({ type: 'kc:live', id, ts: 0, path: '' }));

/** 第 1 艦隊換成樣本母港裡的指定艦（實例 id）。 */
function portWithFleet(ids: number[]) {
    const data = structuredClone(port.api_data);
    data.api_deck_port[0].api_ship = [...ids, ...Array(6 - ids.length).fill(-1)];
    return data;
}

const shipIds: number[] = port.api_data.api_ship.slice(0, 8).map((s: { api_id: number }) => s.api_id);
const fleet1 = (live: { state: { fleetShipIds(n: number): number[] } }) => live.state.fleetShipIds(1);

beforeEach(async () => {
    listeners = [];
    vi.stubGlobal('browser', { runtime: { onMessage: { addListener: (fn: (msg: unknown) => void) => { listeners.push(fn); } } } });
    await db.events.clear();
    await db.snapshot.clear();
    await db.events.add({ ts: 1, path: 'api_start2/getData', api: master.api_data ?? master, req: {} });
    await db.events.add({ ts: 2, path: 'api_port/port', api: portWithFleet(shipIds.slice(0, 2)), req: {} });
});

async function start() {
    const applied: string[][] = [];
    let loaded = false;
    const live = createLiveState(() => { loaded = true; }, (paths) => { applied.push(paths); });
    await vi.waitFor(() => expect(loaded).toBe(true));
    return { live, applied };
}

describe('情報總括即時狀態', () => {
    it('載入後收到廣播，套用新事件並通知 path', async () => {
        const { live, applied } = await start();
        expect(fleet1(live)).toEqual(shipIds.slice(0, 2));
        const id = await db.events.add({ ts: 3, path: 'api_port/port', api: portWithFleet(shipIds.slice(2, 6)), req: {} });
        broadcast(id as number);
        await vi.waitFor(() => expect(applied).toEqual([['api_port/port']]));
        expect(fleet1(live)).toEqual(shipIds.slice(2, 6));
    });

    it('漏收的事件由下一次廣播一併依序補上', async () => {
        const { live, applied } = await start();
        await db.events.add({ ts: 3, path: 'api_port/port', api: portWithFleet(shipIds.slice(2, 4)), req: {} });
        const last = await db.events.add({ ts: 4, path: 'api_port/port', api: portWithFleet(shipIds.slice(4, 7)), req: {} });
        broadcast(last as number);   // 只收到第二則
        await vi.waitFor(() => expect(applied.flat()).toEqual(['api_port/port', 'api_port/port']));
        expect(fleet1(live)).toEqual(shipIds.slice(4, 7));
    });

    it('重複或過時的廣播不會重複套用', async () => {
        const { applied } = await start();
        const id = await db.events.add({ ts: 3, path: 'api_port/port', api: portWithFleet(shipIds.slice(1, 3)), req: {} });
        broadcast(id as number);
        await vi.waitFor(() => expect(applied.length).toBe(1));
        broadcast(id as number);
        broadcast(1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(applied.length).toBe(1);
    });

    it('載入期間進來的廣播不會讓載入結果裡的事件重複套用', async () => {
        const applied: string[][] = [];
        let loaded = false;
        createLiveState(() => { loaded = true; }, (paths) => { applied.push(paths); });
        broadcast(2);   // 載入尚未完成時收到（事件 2 已在 DB、會含在載入結果裡）
        await vi.waitFor(() => expect(loaded).toBe(true));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(applied).toEqual([]);
    });
});
