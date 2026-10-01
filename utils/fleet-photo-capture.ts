import type { FleetPhotoCaptureMessage, FleetPhotoCaptureReply, GameFrameReply, GameFrameRequest } from './game-page';

export interface FleetPhotoPort {
    sender?: { tab?: { id?: number } };
    postMessage(message: GameFrameRequest): void;
    onMessage: { addListener(listener: (reply: GameFrameReply) => void): void };
    onDisconnect: { addListener(listener: () => void): void };
}

/** 每次拍攝只送到指定分頁；未選來源時，只允許唯一的遊戲分頁。 */
export class FleetPhotoCapture {
    private ports = new Set<FleetPhotoPort>();
    private pending = new Map<number, { port: FleetPhotoPort; receive: (reply: GameFrameReply) => void }>();
    private sequence = 0;

    connect(port: FleetPhotoPort): void {
        if (!Number.isInteger(port.sender?.tab?.id)) return;
        this.ports.add(port);
        port.onMessage.addListener(reply => {
            if (reply?.kind !== 'capture-result') return;
            const request = this.pending.get(reply.reqId);
            if (request?.port === port) request.receive(reply);
        });
        port.onDisconnect.addListener(() => { this.ports.delete(port); });
    }

    tabIds(): number[] {
        return [...new Set([...this.ports].map(port => port.sender!.tab!.id!))];
    }

    capture(region: FleetPhotoCaptureMessage['region'], tabId?: number): Promise<FleetPhotoCaptureReply> {
        const ids = this.tabIds();
        if (tabId === undefined && ids.length > 1) return Promise.resolve({ error: 'choose-source' });
        const source = tabId ?? ids[0];
        const ports = [...this.ports].filter(port => port.sender?.tab?.id === source);
        if (!ports.length) return Promise.resolve({ error: 'no-game' });
        return new Promise(resolve => {
            const requestIds: number[] = [];
            const errors: GameFrameReply[] = [];
            let settled = false;
            const finish = (reply: FleetPhotoCaptureReply) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                for (const id of requestIds) this.pending.delete(id);
                resolve(reply);
            };
            const timer = setTimeout(() => finish({ error: 'timeout' }), 4000);
            for (const port of ports) {
                if (settled) break;
                const reqId = ++this.sequence;
                requestIds.push(reqId);
                // 回應必須來自收到這筆請求的 port；其他分頁不能搶先填入同一 reqId。
                const receive = (reply: GameFrameReply) => {
                    this.pending.delete(reqId);
                    if ('dataUrl' in reply) { finish({ dataUrl: reply.dataUrl }); return; }
                    errors.push(reply);
                    if (errors.length < ports.length) return;
                    const best = errors.find(e => 'error' in e && e.error !== 'no-canvas') ?? errors[0];
                    finish('error' in best ? { error: best.error, detail: best.detail } : { error: 'failed' });
                };
                this.pending.set(reqId, { port, receive });
                try { port.postMessage({ kind: 'capture', reqId, region }); }
                catch {
                    this.ports.delete(port);
                    receive({ kind: 'capture-result', reqId, error: 'no-canvas' });
                }
            }
        });
    }
}
