/**
 * 遊戲框 MAIN world（interceptor）與 ISOLATED world（bridge）之間的私有通道。
 *
 * `window.postMessage` 會把每筆封包廣播給頁面上所有 message 監聽者，遊戲程式也收得到。
 * 這裡改用 MessageChannel：只有建立通道時的握手經過 window，之後的封包都走兩端私有的
 * MessagePort。資料以 MAIN → bridge 為主；反方向只承載「讀取地圖 point 圖層」一種要求（見下方
 * BridgeToMainMessage）。兩支 content script 都在 document_start 注入、早於遊戲程式，
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
import {
    isMapInfoPartNo, isMapKey, parsePointLayerReadRequest, parsePointLayerReadResult,
    type PointLayerReadRequest, type PointLayerReadResult,
} from './map-labels';

export const CHANNEL_MARK = '__kc_channel__';

export type ChannelHandshake =
    | { [CHANNEL_MARK]: 1; kind: 'hello' }
    | { [CHANNEL_MARK]: 1; kind: 'offer' };

/** MAIN → bridge（私有 port 上）。 */
export type MainToBridgeMessage =
    | { kind: 'ready' }
    | { kind: 'capture'; path: string; req: string; apiText: string; timing?: MainCaptureTiming }
    // 地圖資源 `_info*.json`（utils/map-resource.ts）：不是 kcsapi，bridge 另以獨立訊息轉交。
    | { kind: 'mapResource'; map: string; part: number | null; text: string }
    | { kind: 'health'; health: CaptureHealth }
    // 對 bridge 讀取要求的回覆（utils/map-point-layer.ts）：只含字身遮罩字串，不含材質或圖片。
    | { kind: 'pointLayerCrops'; requestId: string; result: PointLayerReadResult };

/** bridge → MAIN（私有 port 上）：只有讀取地圖 point 圖層這一種要求，其他內容 MAIN 一律丟棄。 */
export type BridgeToMainMessage = { kind: 'readPointLayer' } & PointLayerReadRequest;

type MapResourceChannelMessage = Extract<MainToBridgeMessage, { kind: 'mapResource' }>;

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
    send(message: Extract<MainToBridgeMessage, { kind: 'capture' | 'mapResource' | 'pointLayerCrops' }>): void;
    /** 擷取健康度只保留最新一筆；通道建立前不佔封包緩衝，建立後在積壓封包之後送出。 */
    sendHealth(health: CaptureHealth): void;
    isReady(): boolean;
}

/** MAIN 端驗證 bridge 的要求；不是讀取要求或格式不合回 null。 */
export function parseBridgeToMainMessage(data: unknown): BridgeToMainMessage | null {
    if ((data as Partial<BridgeToMainMessage> | null)?.kind !== 'readPointLayer') return null;
    const request = parsePointLayerReadRequest(data);
    return request ? { kind: 'readPointLayer', ...request } : null;
}

export function connectMainChannel(
    endpoint: HandshakeEndpoint,
    onOverflow?: (dropped: number) => void,
    onReadPointLayer?: (request: BridgeToMainMessage) => void,
): MainChannel {
    let port: PortLike | null = null;
    const pending: MainToBridgeMessage[] = [];
    let latestHealth: CaptureHealth | null = null;
    let dropped = 0;

    const stop = endpoint.listen((message, ports) => {
        if (port || message.kind !== 'offer' || !ports[0]) return;
        port = ports[0];
        stop();
        port.onmessage = (event) => {
            const request = parseBridgeToMainMessage(event.data);
            if (request) onReadPointLayer?.(request);
        };
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
    /**
     * 經私有 port 要求 MAIN 讀取 point 圖層，等對應 requestId 的回覆。通道未建立、逾時或回覆格式
     * 不合都回失敗結果，不重試。
     */
    readPointLayer(
        request: PointLayerReadRequest,
        timeoutMs: number,
        schedule: (callback: () => void, delayMs: number) => void,
    ): Promise<PointLayerReadResult>;
}

const failedRead = (reason: string): PointLayerReadResult => ({ ok: false, reason, totalMs: 0, maxMs: 0 });

export function offerBridgeChannel(
    endpoint: HandshakeEndpoint,
    onCapture: (message: Extract<MainToBridgeMessage, { kind: 'capture' }>) => void,
    createChannel: () => ChannelLike,
    onHealth?: (health: CaptureHealth) => void,
    onMapResource?: (message: MapResourceChannelMessage) => void,
): BridgeChannel {
    let ready: PortLike | null = null;
    let offers = 0;
    const offered: PortLike[] = [];
    let stop: (() => void) | null = null;
    const pendingReads = new Map<string, (result: PointLayerReadResult) => void>();

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
            if (data?.kind === 'pointLayerCrops') {
                const settle = typeof data.requestId === 'string' ? pendingReads.get(data.requestId) : undefined;
                if (!settle) return;
                settle(parsePointLayerReadResult(data.result) ?? failedRead('bad-reply'));
                return;
            }
            if (data?.kind === 'mapResource') {
                const { map, part, text } = data;
                if (!isMapKey(map) || !isMapInfoPartNo(part) || typeof text !== 'string') return;
                onMapResource?.({ kind: 'mapResource', map, part, text });
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
        readPointLayer(request, timeoutMs, schedule) {
            const port = ready;
            if (!port) return Promise.resolve(failedRead('no-channel'));
            if (pendingReads.has(request.requestId)) return Promise.resolve(failedRead('duplicate'));
            return new Promise((resolve) => {
                const settle = (result: PointLayerReadResult) => {
                    if (pendingReads.get(request.requestId) !== settle) return;
                    pendingReads.delete(request.requestId);
                    resolve(result);
                };
                pendingReads.set(request.requestId, settle);
                schedule(() => settle(failedRead('timeout')), timeoutMs);
                const message: BridgeToMainMessage = {
                    kind: 'readPointLayer', requestId: request.requestId, frame: request.frame, spots: request.spots,
                };
                try { port.postMessage(message); } catch { settle(failedRead('no-channel')); }
            });
        },
    };
}
