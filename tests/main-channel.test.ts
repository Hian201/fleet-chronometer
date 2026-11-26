import { afterEach, describe, expect, it } from 'vitest';
import {
    BRIDGE_OFFER_LIMIT, CHANNEL_MARK, MAIN_PENDING_LIMIT,
    connectMainChannel, isChannelHandshake, offerBridgeChannel,
    type ChannelHandshake, type ChannelLike, type HandshakeEndpoint, type MainToBridgeMessage, type PortLike,
} from '../utils/main-channel';

/** 模擬同一個 window：訊息非同步派送，只送給派送當下已掛上的監聽者。 */
class FakeWindow {
    posted: ChannelHandshake[] = [];
    private listeners = new Set<(message: ChannelHandshake, ports: readonly PortLike[]) => void>();

    endpoint(): HandshakeEndpoint {
        return {
            post: (message, transfer) => {
                this.posted.push(message);
                setTimeout(() => {
                    for (const listener of [...this.listeners]) listener(message, transfer ?? []);
                }, 0);
            },
            listen: (handler) => {
                this.listeners.add(handler);
                return () => this.listeners.delete(handler);
            },
        };
    }

    listenerCount(): number { return this.listeners.size; }
}

const channels: MessageChannel[] = [];
const createChannel = (): ChannelLike => {
    const channel = new MessageChannel();
    channels.push(channel);
    return channel as unknown as ChannelLike;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const capture = (path: string): Extract<MainToBridgeMessage, { kind: 'capture' }> =>
    ({ kind: 'capture', path, req: 'api_deck_id=1', apiText: `svdata={"path":"${path}"}` });

afterEach(() => {
    for (const channel of channels.splice(0)) { channel.port1.close(); channel.port2.close(); }
});

describe('main-channel', () => {
    it('bridge 先注入、MAIN 後注入：bridge 首次 offer 落空，收到 hello 後重送並建立通道', async () => {
        const win = new FakeWindow();
        const received: string[] = [];
        const bridge = offerBridgeChannel(win.endpoint(), m => received.push(m.path), createChannel);
        await settle();   // 首次 offer 派送時 MAIN 還沒掛監聽

        const main = connectMainChannel(win.endpoint());
        main.send(capture('a'));
        main.send(capture('b'));
        await settle();

        expect(main.isReady()).toBe(true);
        expect(bridge.isReady()).toBe(true);
        main.send(capture('c'));
        await settle();
        // 通道建立前的封包依序補送，不經過 window
        expect(received).toEqual(['a', 'b', 'c']);
        expect(win.posted.every(isChannelHandshake)).toBe(true);
        expect(win.listenerCount()).toBe(0);
    });

    it('MAIN 先注入：直接接受 bridge 的首次 offer，只有一條通道送資料', async () => {
        const win = new FakeWindow();
        const received: string[] = [];
        const main = connectMainChannel(win.endpoint());
        const bridge = offerBridgeChannel(win.endpoint(), m => received.push(m.path), createChannel);
        main.send(capture('a'));
        await settle();
        main.send(capture('b'));
        await settle();

        expect(bridge.isReady()).toBe(true);
        expect(received).toEqual(['a', 'b']);
        // 封包本身從未出現在 window 上
        expect(JSON.stringify(win.posted)).not.toContain('svdata');
    });

    it('bridge 忽略格式不符的 capture，並把缺少的 req 視為空字串', async () => {
        const win = new FakeWindow();
        const received: MainToBridgeMessage[] = [];
        offerBridgeChannel(win.endpoint(), m => received.push(m), createChannel);
        let port: PortLike | undefined;
        win.endpoint().listen((message, ports) => { if (message.kind === 'offer' && !port) port = ports[0]; });
        await settle();
        port!.onmessage = () => { };
        port!.postMessage({ kind: 'ready' });
        port!.postMessage({ kind: 'capture', path: 1, apiText: 'x' });
        port!.postMessage({ kind: 'capture', path: 'p', apiText: 'svdata={}' });
        await settle();
        expect(received).toEqual([{ kind: 'capture', path: 'p', req: '', apiText: 'svdata={}', timing: undefined }]);
    });

    it('通道建立後不再回應 hello；建立前回應 hello 的次數有上限', async () => {
        const win = new FakeWindow();
        offerBridgeChannel(win.endpoint(), () => { }, createChannel);
        const spam = win.endpoint();
        for (let i = 0; i < 20; i++) spam.post({ [CHANNEL_MARK]: 1, kind: 'hello' });
        await settle();
        expect(win.posted.filter(m => m.kind === 'offer')).toHaveLength(BRIDGE_OFFER_LIMIT);
    });

    it('通道遲遲未建立時緩衝有上限，超出時丟最舊的並回報', () => {
        const win = new FakeWindow();
        const overflow: number[] = [];
        const main = connectMainChannel(win.endpoint(), n => overflow.push(n));
        for (let i = 0; i < MAIN_PENDING_LIMIT + 2; i++) main.send(capture(String(i)));
        expect(overflow).toEqual([1, 2]);
    });

    it('擷取健康度只送最新一筆，不佔封包緩衝，建立後排在積壓封包之後', async () => {
        const win = new FakeWindow();
        const order: string[] = [];
        const main = connectMainChannel(win.endpoint());
        main.sendHealth({ status: 'missed', reason: 'no-axios' });
        main.send(capture('a'));
        main.sendHealth({ status: 'ok' });
        offerBridgeChannel(
            win.endpoint(),
            m => order.push(m.path),
            createChannel,
            h => order.push(`health:${h.status}`),
        );
        await settle();
        expect(order).toEqual(['a', 'health:ok']);

        main.sendHealth({ status: 'missed', reason: 'not-via-axios' });
        await settle();
        expect(order).toEqual(['a', 'health:ok', 'health:missed']);
    });

    it('bridge 丟棄不合格的健康度訊息', async () => {
        const win = new FakeWindow();
        const health: unknown[] = [];
        offerBridgeChannel(win.endpoint(), () => { }, createChannel, h => health.push(h));
        let port: PortLike | undefined;
        win.endpoint().listen((message, ports) => { if (message.kind === 'offer' && !port) port = ports[0]; });
        await settle();
        port!.onmessage = () => { };
        port!.postMessage({ kind: 'ready' });
        port!.postMessage({ kind: 'health', health: { status: 'missed', reason: 'guess' } });
        port!.postMessage({ kind: 'health', health: { status: 'ok' } });
        await settle();
        expect(health).toEqual([{ status: 'ok' }]);
    });

    it('地圖資源走獨立的 kind，bridge 驗證格式後交給專用回呼，不進 capture', async () => {
        const win = new FakeWindow();
        const captures: string[] = [];
        const resources: unknown[] = [];
        const main = connectMainChannel(win.endpoint());
        main.send({ kind: 'mapResource', map: '62-1', part: null, text: '{"spots":[]}' });
        main.send(capture('a'));
        offerBridgeChannel(win.endpoint(), m => captures.push(m.path), createChannel, undefined, m => resources.push(m));
        await settle();
        expect(captures).toEqual(['a']);
        expect(resources).toEqual([{ kind: 'mapResource', map: '62-1', part: null, text: '{"spots":[]}' }]);
    });

    it('bridge 丟棄不合格的地圖資源訊息', async () => {
        const win = new FakeWindow();
        const resources: unknown[] = [];
        offerBridgeChannel(win.endpoint(), () => { }, createChannel, undefined, m => resources.push(m));
        let port: PortLike | undefined;
        win.endpoint().listen((message, ports) => { if (message.kind === 'offer' && !port) port = ports[0]; });
        await settle();
        port!.onmessage = () => { };
        port!.postMessage({ kind: 'ready' });
        port!.postMessage({ kind: 'mapResource', map: 'https://x/kcs2/resources/map/062/01_info.json', part: null, text: '{}' });
        port!.postMessage({ kind: 'mapResource', map: '62-1', part: -1, text: '{}' });
        port!.postMessage({ kind: 'mapResource', map: '62-1', part: 1.5, text: '{}' });
        port!.postMessage({ kind: 'mapResource', map: '62-1', part: 18, text: {} });
        port!.postMessage({ kind: 'mapResource', map: '62-1', part: 18, text: '{}' });
        await settle();
        expect(resources).toEqual([{ kind: 'mapResource', map: '62-1', part: 18, text: '{}' }]);
    });

    describe('bridge → MAIN：讀取 point 圖層', () => {
        const request = { requestId: 'r1', frame: 'map06201_map62-1_point', spots: [{ x: 100, y: 200 }] };
        const ok = { ok: true as const, crops: [{ x0: 45, y0: 145, w: 1, h: 1, bits: 'gA==' }], totalMs: 1.5, maxMs: 1 };
        const immediate = (_: () => void, __: number) => { };

        it('MAIN 收到要求交給回呼，回覆依 requestId 交回 bridge', async () => {
            const win = new FakeWindow();
            const requests: unknown[] = [];
            const main = connectMainChannel(win.endpoint(), undefined, (r) => {
                requests.push(r);
                main.send({ kind: 'pointLayerCrops', requestId: 'other', result: { ...ok, crops: [] } });
                main.send({ kind: 'pointLayerCrops', requestId: r.requestId, result: ok });
            });
            const bridge = offerBridgeChannel(win.endpoint(), () => { }, createChannel);
            await settle();
            const result = await bridge.readPointLayer(request, 1000, immediate);
            expect(requests).toEqual([{ kind: 'readPointLayer', ...request }]);
            expect(result).toEqual(ok);
        });

        it('通道未建立回 no-channel；逾時回 timeout', async () => {
            const win = new FakeWindow();
            const bridge = offerBridgeChannel(win.endpoint(), () => { }, createChannel);
            expect(await bridge.readPointLayer(request, 1000, immediate)).toMatchObject({ ok: false, reason: 'no-channel' });
            connectMainChannel(win.endpoint(), undefined, () => { /* 不回覆 */ });
            await settle();
            let fire: (() => void) | undefined;
            const pending = bridge.readPointLayer(request, 1000, (cb) => { fire = cb; });
            fire!();
            expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
        });

        it('bridge 把格式不合的回覆當失敗', async () => {
            const win = new FakeWindow();
            const main = connectMainChannel(win.endpoint(), undefined, (r) => {
                main.send({ kind: 'pointLayerCrops', requestId: r.requestId, result: { ...ok, crops: [{ x0: 0, y0: 0, w: 999, h: 1, bits: '' }] } as never });
            });
            const bridge = offerBridgeChannel(win.endpoint(), () => { }, createChannel);
            await settle();
            expect(await bridge.readPointLayer(request, 1000, immediate)).toMatchObject({ ok: false, reason: 'bad-reply' });
        });

        it('MAIN 只接受讀取要求，格式不合或其他 kind 一律丟棄', async () => {
            const win = new FakeWindow();
            const requests: unknown[] = [];
            connectMainChannel(win.endpoint(), undefined, r => requests.push(r));
            const channel = createChannel();
            channel.port1.onmessage = () => { };
            win.endpoint().post({ [CHANNEL_MARK]: 1, kind: 'offer' }, [channel.port2]);
            await settle();
            for (const bad of [
                { kind: 'capture', path: 'x', apiText: '' },
                { kind: 'readPointLayer', ...request, frame: 'map62-1_point' },
                { kind: 'readPointLayer', ...request, frame: '../x_point' },
                { kind: 'readPointLayer', ...request, spots: [] },
                { kind: 'readPointLayer', ...request, spots: [{ x: -1, y: 0 }] },
                { kind: 'readPointLayer', ...request, spots: [{ x: '1', y: 0 }] },
                { kind: 'readPointLayer', ...request, spots: Array.from({ length: 101 }, () => ({ x: 1, y: 1 })) },
                { kind: 'readPointLayer', ...request, requestId: '' },
                null,
            ]) channel.port1.postMessage(bad);
            channel.port1.postMessage({ kind: 'readPointLayer', ...request, extra: 'dropped' });
            await settle();
            expect(requests).toEqual([{ kind: 'readPointLayer', ...request }]);
        });
    });
});
