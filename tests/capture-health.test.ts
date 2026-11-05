import { describe, expect, it } from 'vitest';
import {
    CAPTURE_HEALTH_MISS_MIN, CAPTURE_HEALTH_SETTLE_MS,
    CaptureHealthMonitor, CaptureHealthRegistry, parseCaptureHealth, parseCaptureHealthSummary,
    type CaptureHealth, type CaptureHealthPort, type CaptureHealthSummary,
} from '../utils/capture-health';

/** 可手動推進的時鐘與排程。 */
function harness() {
    let now = 0;
    const timers: { at: number; run: () => void }[] = [];
    const changes: CaptureHealth[] = [];
    const monitor = new CaptureHealthMonitor({
        now: () => now,
        schedule: (run, delay) => { timers.push({ at: now + delay, run }); },
        onChange: h => changes.push(h),
    });
    const advance = (ms: number) => {
        now += ms;
        for (const timer of timers.filter(t => t.at <= now)) {
            timers.splice(timers.indexOf(timer), 1);
            timer.run();
        }
    };
    return { monitor, changes, advance };
}

describe('CaptureHealthMonitor', () => {
    it('尚未看到任何通訊時不回報（例如停在標題畫面）', () => {
        const { changes, advance } = harness();
        advance(60_000);
        expect(changes).toEqual([]);
    });

    it('觀察器正常收到時回報 ok，且不重複回報', () => {
        const { monitor, changes, advance } = harness();
        monitor.noteAxios();
        for (const path of ['api_start2/getData', 'api_port/port', 'api_get_member/require_info']) {
            monitor.noteTraffic(path);
            monitor.noteCapture(path);
            advance(100);
        }
        advance(CAPTURE_HEALTH_SETTLE_MS);
        expect(changes).toEqual([{ status: 'ok' }]);
    });

    it('觀察器先於 resource timing 觸發時仍能配對', () => {
        const { monitor, changes, advance } = harness();
        monitor.noteAxios();
        for (let i = 0; i < CAPTURE_HEALTH_MISS_MIN + 2; i++) {
            monitor.noteCapture('api_port/port');
            monitor.noteTraffic('api_port/port');
            advance(50);
        }
        advance(CAPTURE_HEALTH_SETTLE_MS);
        expect(changes).toEqual([{ status: 'ok' }]);
    });

    it('全域 axios 從未出現且通訊連續未被收到：no-axios', () => {
        const { monitor, changes, advance } = harness();
        for (let i = 0; i < CAPTURE_HEALTH_MISS_MIN; i++) {
            monitor.noteTraffic('api_port/port');
            advance(200);
        }
        expect(changes).toEqual([]);   // 寬限期內不判定
        advance(CAPTURE_HEALTH_SETTLE_MS);
        expect(changes).toEqual([{ status: 'missed', reason: 'no-axios' }]);
    });

    it('已掛上 axios 但通訊不經過它：not-via-axios', () => {
        const { monitor, changes, advance } = harness();
        monitor.noteAxios();
        for (let i = 0; i < CAPTURE_HEALTH_MISS_MIN; i++) monitor.noteTraffic(`api_x/${i}`);
        advance(CAPTURE_HEALTH_SETTLE_MS);
        expect(changes).toEqual([{ status: 'missed', reason: 'not-via-axios' }]);
    });

    it('未達連續門檻時不判定失效（容忍個別端點不經 axios）', () => {
        const { monitor, changes, advance } = harness();
        monitor.noteAxios();
        for (let round = 0; round < 4; round++) {
            for (let i = 0; i < CAPTURE_HEALTH_MISS_MIN - 1; i++) monitor.noteTraffic('api_other/unseen');
            monitor.noteTraffic('api_port/port');
            monitor.noteCapture('api_port/port');
            advance(1000);
        }
        advance(CAPTURE_HEALTH_SETTLE_MS);
        expect(changes).toEqual([{ status: 'ok' }]);
    });

    it('失效後觀察器恢復即回報 ok', () => {
        const { monitor, changes, advance } = harness();
        monitor.noteAxios();
        for (let i = 0; i < CAPTURE_HEALTH_MISS_MIN; i++) monitor.noteTraffic('api_port/port');
        advance(CAPTURE_HEALTH_SETTLE_MS);
        monitor.noteTraffic('api_port/port');
        monitor.noteCapture('api_port/port');
        expect(changes).toEqual([{ status: 'missed', reason: 'not-via-axios' }, { status: 'ok' }]);
    });

    it('寬限期內觀察器補上就不誤判', () => {
        const { monitor, changes, advance } = harness();
        monitor.noteAxios();
        for (let i = 0; i < CAPTURE_HEALTH_MISS_MIN; i++) monitor.noteTraffic(`api_x/${i}`);
        advance(CAPTURE_HEALTH_SETTLE_MS - 1);
        for (let i = 0; i < CAPTURE_HEALTH_MISS_MIN; i++) monitor.noteCapture(`api_x/${i}`);
        advance(CAPTURE_HEALTH_SETTLE_MS);
        expect(changes).toEqual([{ status: 'ok' }]);
    });
});

function port(tabId: number | undefined) {
    let onMessage!: (message: unknown) => void;
    let onDisconnect!: () => void;
    const p: CaptureHealthPort = {
        sender: { tab: { id: tabId } },
        onMessage: { addListener: fn => { onMessage = fn; } },
        onDisconnect: { addListener: fn => { onDisconnect = fn; } },
    };
    return {
        port: p,
        report: (health: unknown) => onMessage({ kind: 'capture-health', health }),
        send: (message: unknown) => onMessage(message),
        disconnect: () => onDisconnect(),
    };
}

describe('CaptureHealthRegistry', () => {
    it('任一框失效即彙整為失效；斷線後移除該框的回報', () => {
        const summaries: CaptureHealthSummary[] = [];
        const registry = new CaptureHealthRegistry(s => summaries.push(s));
        const a = port(1), b = port(2);
        registry.connect(a.port);
        registry.connect(b.port);
        expect(registry.summary()).toEqual({ status: 'unknown' });

        a.report({ status: 'ok' });
        b.report({ status: 'missed', reason: 'no-axios' });
        expect(registry.summary()).toEqual({ status: 'missed', reason: 'no-axios' });
        b.disconnect();
        expect(registry.summary()).toEqual({ status: 'ok' });
        a.disconnect();
        expect(summaries).toEqual([
            { status: 'ok' },
            { status: 'missed', reason: 'no-axios' },
            { status: 'ok' },
            { status: 'unknown' },
        ]);
    });

    it('忽略其他訊息、不合格的回報與沒有分頁的連線', () => {
        const summaries: CaptureHealthSummary[] = [];
        const registry = new CaptureHealthRegistry(s => summaries.push(s));
        const a = port(1), orphan = port(undefined);
        registry.connect(a.port);
        registry.connect(orphan.port);
        a.send({ kind: 'capture-result', reqId: 1, dataUrl: 'x' });
        a.report({ status: 'missed', reason: 'made-up' });
        a.report({ status: 'broken' });
        expect(summaries).toEqual([]);
    });

    it('相同狀態重複回報不重複廣播', () => {
        const summaries: CaptureHealthSummary[] = [];
        const registry = new CaptureHealthRegistry(s => summaries.push(s));
        const a = port(1);
        registry.connect(a.port);
        a.report({ status: 'ok' });
        a.report({ status: 'ok' });
        expect(summaries).toEqual([{ status: 'ok' }]);
    });
});

describe('parseCaptureHealth', () => {
    it('只接受已知狀態與原因', () => {
        expect(parseCaptureHealth({ status: 'ok', extra: 1 })).toEqual({ status: 'ok' });
        expect(parseCaptureHealth({ status: 'missed', reason: 'not-via-axios' }))
            .toEqual({ status: 'missed', reason: 'not-via-axios' });
        expect(parseCaptureHealth({ status: 'unknown' })).toBeNull();
        expect(parseCaptureHealthSummary({ status: 'unknown' })).toEqual({ status: 'unknown' });
        expect(parseCaptureHealthSummary(undefined)).toBeNull();
    });
});
