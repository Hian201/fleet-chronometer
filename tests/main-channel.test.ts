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

        const main = connectMainChannel(win.endpoint(), () => { });
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
        const main = connectMainChannel(win.endpoint(), () => { });
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

    it('靜音狀態在通道建立前只保留最後一次，建立後送達 MAIN', async () => {
        const win = new FakeWindow();
        const muted: boolean[] = [];
        const bridge = offerBridgeChannel(win.endpoint(), () => { }, createChannel);
        bridge.sendMute(true);
        bridge.sendMute(false);
        bridge.sendMute(true);
        await settle();
        connectMainChannel(win.endpoint(), m => muted.push(m.muted));
        await settle();
        expect(muted).toEqual([true]);

        bridge.sendMute(false);
        await settle();
        expect(muted).toEqual([true, false]);
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
        const main = connectMainChannel(win.endpoint(), () => { }, n => overflow.push(n));
        for (let i = 0; i < MAIN_PENDING_LIMIT + 2; i++) main.send(capture(String(i)));
        expect(overflow).toEqual([1, 2]);
    });

    it('擷取健康度只送最新一筆，不佔封包緩衝，建立後排在積壓封包之後', async () => {
        const win = new FakeWindow();
        const order: string[] = [];
        const main = connectMainChannel(win.endpoint(), () => { });
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
});
