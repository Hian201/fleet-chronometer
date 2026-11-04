/**
 * 依序讀取並送出擷取到的回應內容，避免在遊戲 axios 回呼內同步做事。
 *
 * MAIN world 與遊戲 renderer 共用主執行緒。已知大小低於 `immediateMaxChars` 的封包
 * 以下一個 task（scheduler.defer 0ms）送出；大小未知或較大的封包（例如登入時的
 * start2）每個 idle slice 至多處理一筆，讓遊戲輸入與繪製優先。兩條路徑共用同一佇列，
 * 順序不變。
 */
export interface IdleDeadlineLike {
    didTimeout: boolean;
    timeRemaining(): number;
}

export interface IdleCaptureScheduler {
    schedule(callback: (deadline: IdleDeadlineLike) => void): void;
    // idle slice 剩餘時間不足時，先離開目前的 renderer turn，再重試；不可在同一個
    // idle callback 直接重新 requestIdleCallback，否則接近 frame deadline 時可能空轉。
    defer(callback: () => void, delayMs: number): void;
}

export type CaptureTextReader = () => string | Promise<string>;

interface QueuedCapture {
    path: string;
    reqBody: string;
    readText: CaptureTextReader;
    text?: string;
    enqueuedAt: number;
    headAt?: number;
    quietMs: number;
    readMs: number;
    sizeHint?: number;
}

/** 這筆在佇列裡各階段的時間（開發用延遲量測；見 utils/capture-timing.ts）。 */
export interface QueueTiming {
    enqueuedAt: number;
    headAt: number;
    quietMs: number;
    readMs: number;
    dispatchAt: number;
}

export interface IdleCaptureQueueOptions {
    // 沒有至少這段空檔就留待下一輪 idle，避免在一個快結束的空檔起手做大字串複製。
    minIdleBudgetMs?: number;
    // 大型封包可等到使用者操作停止後再讀取，避免與剛點開的遊戲介面同時搶 renderer。
    nextEligibleDelayMs?: () => number;
    onError?: (path: string, error: unknown) => void;
    /** 量測用時鐘；未提供時 QueueTiming 全為 0。 */
    now?: () => number;
    /** 已知大小（字元數）低於此值時不等 idle，直接排到下一個 task；未設定時一律等 idle。 */
    immediateMaxChars?: number;
}

/**
 * 依加入順序處理 capture。非同步 reader 完成後仍須等到下一個 idle slice 才 dispatch，
 * 因此 Response.text() 完成的 microtask 不會直接觸發 postMessage 的大字串傳輸。
 */
export class IdleCaptureQueue {
    private readonly pending: QueuedCapture[] = [];
    private readonly minIdleBudgetMs: number;
    private readonly nextEligibleDelayMs?: () => number;
    private readonly now: () => number;
    private readonly immediateMaxChars?: number;
    private scheduled = false;
    private reading = false;

    constructor(
        private readonly scheduler: IdleCaptureScheduler,
        private readonly dispatch: (path: string, reqBody: string, text: string, timing: QueueTiming) => void,
        options: IdleCaptureQueueOptions = {},
    ) {
        this.minIdleBudgetMs = options.minIdleBudgetMs ?? 12;
        this.nextEligibleDelayMs = options.nextEligibleDelayMs;
        this.onError = options.onError;
        this.now = options.now ?? (() => 0);
        this.immediateMaxChars = options.immediateMaxChars;
    }

    private readonly onError?: (path: string, error: unknown) => void;

    enqueue(path: string, reqBody: string, readText: CaptureTextReader, sizeHint?: number): void {
        const at = this.now();
        this.pending.push({
            path, reqBody, readText,
            enqueuedAt: at,
            headAt: this.pending.length === 0 ? at : undefined,
            quietMs: 0,
            readMs: 0,
            sizeHint,
        });
        this.schedule();
    }

    private schedule(): void {
        if (this.scheduled || this.reading || this.pending.length === 0) return;
        const eligibilityDelay = Math.max(0, this.nextEligibleDelayMs?.() ?? 0);
        if (eligibilityDelay > 0) {
            this.pending[0].quietMs += eligibilityDelay;
            this.deferSchedule(eligibilityDelay);
            return;
        }
        this.scheduled = true;
        if (this.isImmediate(this.pending[0])) {
            this.scheduler.defer(() => {
                this.scheduled = false;
                this.drainOne();
            }, 0);
            return;
        }
        this.scheduler.schedule((deadline) => {
            this.scheduled = false;
            // timeout 是防止遊戲持續忙碌時永遠不送；此時仍只處理一筆，避免產生尖峰。
            if (!deadline.didTimeout && deadline.timeRemaining() < this.minIdleBudgetMs) {
                this.deferSchedule(50);
                return;
            }
            this.drainOne();
        });
    }

    private isImmediate(capture: QueuedCapture): boolean {
        return this.immediateMaxChars !== undefined
            && capture.sizeHint !== undefined
            && capture.sizeHint < this.immediateMaxChars;
    }

    private deferSchedule(delayMs: number): void {
        if (this.scheduled || this.reading || this.pending.length === 0) return;
        this.scheduled = true;
        this.scheduler.defer(() => {
            this.scheduled = false;
            this.schedule();
        }, delayMs);
    }

    private drainOne(): void {
        const capture = this.pending[0];
        if (!capture) return;

        // async reader（fetch Response.text）先只取得字串；真正跨 world 傳輸留到下一個 idle。
        if (capture.text !== undefined) {
            this.dispatchHead(capture, capture.text);
            return;
        }

        const readStart = this.now();
        let result: string | Promise<string>;
        try {
            result = capture.readText();
        } catch (error) {
            this.dropFailedCapture(capture, error);
            return;
        }

        if (typeof result === 'string') {
            capture.readMs = this.now() - readStart;
            this.dispatchHead(capture, result);
            return;
        }

        this.reading = true;
        void result.then(
            (text) => {
                capture.text = text;
                capture.readMs = this.now() - readStart;
                this.reading = false;
                this.schedule();
            },
            (error) => this.dropFailedCapture(capture, error),
        );
    }

    private dispatchHead(capture: QueuedCapture, text: string): void {
        this.shiftHead();
        const timing: QueueTiming = {
            enqueuedAt: capture.enqueuedAt,
            headAt: capture.headAt ?? capture.enqueuedAt,
            quietMs: capture.quietMs,
            readMs: capture.readMs,
            dispatchAt: this.now(),
        };
        try {
            this.dispatch(capture.path, capture.reqBody, text, timing);
        } catch (error) {
            this.onError?.(capture.path, error);
        }
        this.schedule();
    }

    private shiftHead(): void {
        this.pending.shift();
        const next = this.pending[0];
        if (next && next.headAt === undefined) next.headAt = this.now();
    }

    private dropFailedCapture(capture: QueuedCapture, error: unknown): void {
        if (this.pending[0] === capture) this.shiftHead();
        this.reading = false;
        this.onError?.(capture.path, error);
        this.schedule();
    }
}
