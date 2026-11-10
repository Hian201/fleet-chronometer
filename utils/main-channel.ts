/**
 * 遊戲框 MAIN world（interceptor）與 ISOLATED world（bridge）之間的私有通道。
 *
 * `window.postMessage` 會把每筆封包廣播給頁面上所有 message 監聽者，遊戲程式也收得到。
 * 這裡改用 MessageChannel：只有建立通道時的握手經過 window，之後的封包都走兩端私有的
 * MessagePort，而且只有 MAIN → bridge 一個方向。兩支 content script 都在 document_start 注入、早於遊戲程式，
 * 正常情況下握手在遊戲掛上任何監聽之前就完成。
 *
 * 兩個 world 的注入先後不保證，故握手兩邊都會發起：bridge 啟動即送出一個 offer（附 port），
 * MAIN 啟動即送 hello；bridge 在尚未建立通道時收到 hello 會再送一個新的 offer。MAIN 只接受
 * 第一個 offer，並經該 port 回 ready；bridge 以收到 ready 的 port 為準、關閉其他 offer。
 *
 * 通道建立前產生的封包留在 MAIN 端緩衝，建立後依序送出；**不改走 window.postMessage 備援**，
 * 否則就失去私有通道的意義。本檔不依賴 chrome.* 或 DOM，window 由呼叫端包成 HandshakeEndpoint。
 */
import type { MainCaptureTiming } from './capture-timing';
import { parseCaptureHealth, type CaptureHealth } from './capture-health';

export const CHANNEL_MARK = '__kc_channel__';

export type ChannelHandshake =
    | { [CHANNEL_MARK]: 1; kind: 'hello' }
    | { [CHANNEL_MARK]: 1; kind: 'offer' };

/** MAIN → bridge（私有 port 上）。 */
export type MainToBridgeMessage =
    | { kind: 'ready' }
    | { kind: 'capture'; path: string; req: string; apiText: string; timing?: MainCaptureTiming }
    | { kind: 'health'; health: CaptureHealth };

export interface PortLike {
    postMessage(message: unknown): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    close(): void;
}

export interface ChannelLike {
    port1: PortLike;
    port2: PortLike;
}

/**
 * 同一個 window 上的握手通道。listen 的回呼只會收到已通過來源檢查（同一 window、同源）
 * 的握手訊息；回傳值用來解除監聽。
 */
export interface HandshakeEndpoint {
    post(message: ChannelHandshake, transfer?: PortLike[]): void;
    listen(handler: (message: ChannelHandshake, ports: readonly PortLike[]) => void): () => void;
}

export function isChannelHandshake(value: unknown): value is ChannelHandshake {
    const data = value as Record<string, unknown> | null;
    return !!data && typeof data === 'object' && data[CHANNEL_MARK] === 1
        && (data.kind === 'hello' || data.kind === 'offer');
}

/** 通道建立前最多緩衝的封包數；登入前 axios 尚未出現，正常情況不會接近上限。 */
export const MAIN_PENDING_LIMIT = 500;

export interface MainChannel {
    send(message: Extract<MainToBridgeMessage, { kind: 'capture' }>): void;
    /** 擷取健康度只保留最新一筆；通道建立前不佔封包緩衝，建立後在積壓封包之後送出。 */
    sendHealth(health: CaptureHealth): void;
    isReady(): boolean;
}

export function connectMainChannel(
    endpoint: HandshakeEndpoint,
    onOverflow?: (dropped: number) => void,
): MainChannel {
    let port: PortLike | null = null;
    const pending: MainToBridgeMessage[] = [];
    let latestHealth: CaptureHealth | null = null;
    let dropped = 0;

    const stop = endpoint.listen((message, ports) => {
        if (port || message.kind !== 'offer' || !ports[0]) return;
        port = ports[0];
        stop();
        port.postMessage({ kind: 'ready' } satisfies MainToBridgeMessage);
        for (const message of pending.splice(0)) port.postMessage(message);
        if (latestHealth) port.postMessage({ kind: 'health', health: latestHealth } satisfies MainToBridgeMessage);
    });
    endpoint.post({ [CHANNEL_MARK]: 1, kind: 'hello' });

    return {
        send(message) {
            if (port) { port.postMessage(message); return; }
            pending.push(message);
            if (pending.length > MAIN_PENDING_LIMIT) {
                pending.shift();
                dropped++;
                onOverflow?.(dropped);
            }
        },
        sendHealth(health) {
            latestHealth = health;
            port?.postMessage({ kind: 'health', health } satisfies MainToBridgeMessage);
        },
        isReady: () => port !== null,
    };
}

/** 尚未建立通道時，bridge 最多回應幾次 hello；避免被重複的 hello 無限建立通道。 */
export const BRIDGE_OFFER_LIMIT = 5;

export interface BridgeChannel {
    isReady(): boolean;
}

export function offerBridgeChannel(
    endpoint: HandshakeEndpoint,
    onCapture: (message: Extract<MainToBridgeMessage, { kind: 'capture' }>) => void,
    createChannel: () => ChannelLike,
    onHealth?: (health: CaptureHealth) => void,
): BridgeChannel {
    let ready: PortLike | null = null;
    let offers = 0;
    const offered: PortLike[] = [];
    let stop: (() => void) | null = null;

    const accept = (port: PortLike) => {
        ready = port;
        stop?.();
        stop = null;
        for (const other of offered) if (other !== port) other.close();
        offered.length = 0;
    };

    const offer = () => {
        if (ready || offers >= BRIDGE_OFFER_LIMIT) return;
        offers++;
        const channel = createChannel();
        const port = channel.port1;
        offered.push(port);
        port.onmessage = (event) => {
            const data = event.data as Partial<MainToBridgeMessage> | null;
            if (data?.kind === 'ready') {
                if (!ready) accept(port);
                return;
            }
            if (port !== ready) return;
            if (data?.kind === 'health') {
                const health = parseCaptureHealth(data.health);
                if (health) onHealth?.(health);
                return;
            }
            if (data?.kind !== 'capture') return;
            if (typeof data.path !== 'string' || typeof data.apiText !== 'string') return;
            onCapture({
                kind: 'capture',
                path: data.path,
                req: typeof data.req === 'string' ? data.req : '',
                apiText: data.apiText,
                timing: data.timing,
            });
        };
        endpoint.post({ [CHANNEL_MARK]: 1, kind: 'offer' }, [channel.port2]);
    };

    stop = endpoint.listen((message) => {
        if (message.kind === 'hello') offer();
    });
    offer();

    return {
        isReady: () => ready !== null,
    };
}
