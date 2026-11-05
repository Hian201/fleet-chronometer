/**
 * 擷取健康度：判斷「遊戲確實在通訊，但 axios 觀察器沒有收到」。
 *
 * 擷取完全依賴遊戲把 axios 掛在全域 `window.axios`。遊戲改版若改成私有模組或原生 fetch，
 * `waitForAxios()` 會永遠找不到、觀察器不再觸發，資料就靜靜停止記錄。為了讓這種失效看得見，
 * MAIN world 另以 `PerformanceObserver`（resource timing，只讀、不碰網路 API）看遊戲實際完成的
 * kcsapi 請求，再和觀察器收到的 path 逐筆配對。
 *
 * 判定規則：已過配對寬限期（`settleMs`）的最近 `missMin` 筆請求全都沒被觀察器收到，且這段期間
 * 觀察器完全沒有觸發，才算失效。只看「最近連續」而不是比例，是為了容忍個別端點可能本來就不經
 * axios；寬限期則吸收 resource timing 與 interceptor 兩邊先後不定的時序。
 *
 * 本檔不依賴 chrome.* 或 DOM，時鐘與排程由呼叫端注入。
 */

export type CaptureHealthReason =
    /** 遊戲頁從頭到尾沒出現全域 axios */
    | 'no-axios'
    /** 已掛上 axios 觀察器，但遊戲通訊沒經過它 */
    | 'not-via-axios';

/** 單一遊戲框的回報。尚未看到任何 kcsapi 通訊（例如停在標題畫面）時不回報。 */
export type CaptureHealth =
    | { status: 'ok' }
    | { status: 'missed'; reason: CaptureHealthReason };

/** background 彙整所有遊戲框後給 UI 的結果。 */
export type CaptureHealthSummary =
    | { status: 'unknown' }
    | { status: 'ok' }
    | { status: 'missed'; reason: CaptureHealthReason };

/** background → 擴充頁面：彙整結果變動時廣播。 */
export const MSG_CAPTURE_HEALTH = 'kc:capture-health';
/** 擴充頁面 → background：查詢目前彙整結果。 */
export const MSG_CAPTURE_HEALTH_GET = 'kc:capture-health-get';

export const CAPTURE_HEALTH_SETTLE_MS = 5000;
export const CAPTURE_HEALTH_MISS_MIN = 3;
/** 只需保留最近幾筆即可判斷；上限避免長時間掛機時無限成長。 */
const ENTRY_LIMIT = 32;

const REASONS: readonly CaptureHealthReason[] = ['no-axios', 'not-via-axios'];

export function parseCaptureHealth(value: unknown): CaptureHealth | null {
    const v = value as { status?: unknown; reason?: unknown } | null;
    if (!v || typeof v !== 'object') return null;
    if (v.status === 'ok') return { status: 'ok' };
    if (v.status === 'missed' && REASONS.includes(v.reason as CaptureHealthReason)) {
        return { status: 'missed', reason: v.reason as CaptureHealthReason };
    }
    return null;
}

export function parseCaptureHealthSummary(value: unknown): CaptureHealthSummary | null {
    if ((value as { status?: unknown } | null)?.status === 'unknown') return { status: 'unknown' };
    return parseCaptureHealth(value);
}

const sameHealth = (a: CaptureHealthSummary | null, b: CaptureHealthSummary | null) =>
    a?.status === b?.status
    && (a?.status !== 'missed' || a.reason === (b as Extract<CaptureHealthSummary, { status: 'missed' }>).reason);

export interface CaptureHealthMonitorOptions {
    now: () => number;
    schedule: (callback: () => void, delayMs: number) => void;
    /** 只在狀態或原因改變時呼叫。 */
    onChange: (health: CaptureHealth) => void;
    settleMs?: number;
    missMin?: number;
}

interface TrafficEntry { path: string; at: number; matched: boolean }

/** 單一遊戲框（MAIN world）內的配對器。 */
export class CaptureHealthMonitor {
    private entries: TrafficEntry[] = [];
    /** 觀察器先於 resource timing 收到的 path，等對應的通訊紀錄出現時抵銷。 */
    private credits: { path: string; at: number }[] = [];
    private axiosFound = false;
    private lastCaptureAt = -Infinity;
    private current: CaptureHealth | null = null;
    private readonly settleMs: number;
    private readonly missMin: number;

    constructor(private readonly options: CaptureHealthMonitorOptions) {
        this.settleMs = options.settleMs ?? CAPTURE_HEALTH_SETTLE_MS;
        this.missMin = options.missMin ?? CAPTURE_HEALTH_MISS_MIN;
    }

    noteAxios(): void {
        this.axiosFound = true;
    }

    /** resource timing 看到一筆已完成的 kcsapi 請求。 */
    noteTraffic(path: string): void {
        const at = this.options.now();
        this.pruneCredits(at);
        const credit = this.credits.findIndex(c => c.path === path);
        if (credit >= 0) this.credits.splice(credit, 1);
        this.entries.push({ path, at, matched: credit >= 0 });
        if (this.entries.length > ENTRY_LIMIT) this.entries.splice(0, this.entries.length - ENTRY_LIMIT);
        this.options.schedule(() => this.evaluate(), this.settleMs);
    }

    /** axios 觀察器收到一筆 kcsapi 回應。 */
    noteCapture(path: string): void {
        const at = this.options.now();
        this.lastCaptureAt = at;
        const entry = this.entries.find(e => !e.matched && e.path === path);
        if (entry) entry.matched = true;
        else {
            this.pruneCredits(at);
            this.credits.push({ path, at });
            if (this.credits.length > ENTRY_LIMIT) this.credits.shift();
        }
        this.evaluate();
    }

    health(): CaptureHealth | null {
        return this.current;
    }

    private pruneCredits(now: number): void {
        const cutoff = now - this.settleMs * 2;
        while (this.credits.length && this.credits[0].at < cutoff) this.credits.shift();
    }

    private evaluate(): void {
        const cutoff = this.options.now() - this.settleMs;
        const settled = this.entries.filter(e => e.at <= cutoff);
        const recent = settled.slice(-this.missMin);
        let next: CaptureHealth | null = null;
        if (recent.length >= this.missMin
            && recent.every(e => !e.matched)
            && this.lastCaptureAt < recent[0].at) {
            next = { status: 'missed', reason: this.axiosFound ? 'not-via-axios' : 'no-axios' };
        } else if (this.lastCaptureAt > -Infinity) {
            next = { status: 'ok' };
        }
        if (!next || sameHealth(this.current, next)) return;
        this.current = next;
        this.options.onChange(next);
    }
}

export interface CaptureHealthPort {
    sender?: { tab?: { id?: number } };
    onMessage: { addListener(listener: (message: unknown) => void): void };
    onDisconnect: { addListener(listener: () => void): void };
}

/**
 * background 端：彙整各遊戲框（PORT_GAME_FRAME）的回報。任一框失效即視為失效；
 * 框斷線（分頁關閉、重新整理）時移除其回報。
 */
export class CaptureHealthRegistry {
    private reports = new Map<CaptureHealthPort, CaptureHealth>();
    private last: CaptureHealthSummary = { status: 'unknown' };

    constructor(private readonly onChange: (summary: CaptureHealthSummary) => void) { }

    connect(port: CaptureHealthPort): void {
        if (!Number.isInteger(port.sender?.tab?.id)) return;
        port.onMessage.addListener(message => {
            const m = message as { kind?: unknown; health?: unknown } | null;
            if (m?.kind !== 'capture-health') return;
            const health = parseCaptureHealth(m.health);
            if (!health) return;
            this.reports.set(port, health);
            this.publish();
        });
        port.onDisconnect.addListener(() => {
            if (this.reports.delete(port)) this.publish();
        });
    }

    summary(): CaptureHealthSummary {
        const reports = [...this.reports.values()];
        const missed = reports.find((h): h is Extract<CaptureHealth, { status: 'missed' }> => h.status === 'missed');
        if (missed) return { status: 'missed', reason: missed.reason };
        return reports.length ? { status: 'ok' } : { status: 'unknown' };
    }

    private publish(): void {
        const next = this.summary();
        if (sameHealth(this.last, next)) return;
        this.last = next;
        this.onChange(next);
    }
}
