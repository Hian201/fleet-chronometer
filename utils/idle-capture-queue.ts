/**
 * 在頁面有空檔時才讀取並送出擷取到的回應內容。
 *
 * MAIN world 與遊戲 renderer 共用主執行緒；若在 XHR load callback 立刻讀取大型
 * responseText，再連續 postMessage 初始登入的一串封包，會阻塞遊戲介面的下一次繪製。
 * 此佇列保留事件順序、每個 idle slice 至多處理一筆，讓遊戲輸入與繪製優先。
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
}

export interface IdleCaptureQueueOptions {
    // 沒有至少這段空檔就留待下一輪 idle，避免在一個快結束的空檔起手做大字串複製。
    minIdleBudgetMs?: number;
    // 大型封包可等到使用者操作停止後再讀取，避免與剛點開的遊戲介面同時搶 renderer。
    nextEligibleDelayMs?: () => number;
    onError?: (path: string, error: unknown) => void;
}

/**
 * 依加入順序處理 capture。非同步 reader 完成後仍須等到下一個 idle slice 才 dispatch，
 * 因此 Response.text() 完成的 microtask 不會直接觸發 postMessage 的大字串傳輸。
 */
export class IdleCaptureQueue {
    private readonly pending: QueuedCapture[] = [];
    private readonly minIdleBudgetMs: number;
    private readonly nextEligibleDelayMs?: () => number;
    private scheduled = false;
    private reading = false;

    constructor(
        private readonly scheduler: IdleCaptureScheduler,
        private readonly dispatch: (path: string, reqBody: string, text: string) => void,
        options: IdleCaptureQueueOptions = {},
    ) {
        this.minIdleBudgetMs = options.minIdleBudgetMs ?? 12;
        this.nextEligibleDelayMs = options.nextEligibleDelayMs;
        this.onError = options.onError;
    }

    private readonly onError?: (path: string, error: unknown) => void;

    enqueue(path: string, reqBody: string, readText: CaptureTextReader): void {
        this.pending.push({ path, reqBody, readText });
        this.schedule();
    }

    private schedule(): void {
        if (this.scheduled || this.reading || this.pending.length === 0) return;
        const eligibilityDelay = Math.max(0, this.nextEligibleDelayMs?.() ?? 0);
        if (eligibilityDelay > 0) {
            this.deferSchedule(eligibilityDelay);
            return;
        }
        this.scheduled = true;
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
            this.pending.shift();
            try {
                this.dispatch(capture.path, capture.reqBody, capture.text);
            } catch (error) {
                this.onError?.(capture.path, error);
            }
            this.schedule();
            return;
        }

        let result: string | Promise<string>;
        try {
            result = capture.readText();
        } catch (error) {
            this.dropFailedCapture(capture, error);
            return;
        }

        if (typeof result === 'string') {
            this.pending.shift();
            try {
                this.dispatch(capture.path, capture.reqBody, result);
            } catch (error) {
                this.onError?.(capture.path, error);
            }
            this.schedule();
            return;
        }

        this.reading = true;
        void result.then(
            (text) => {
                capture.text = text;
                this.reading = false;
                this.schedule();
            },
            (error) => this.dropFailedCapture(capture, error),
        );
    }

    private dropFailedCapture(capture: QueuedCapture, error: unknown): void {
        if (this.pending[0] === capture) this.pending.shift();
        this.reading = false;
        this.onError?.(capture.path, error);
        this.schedule();
    }
}
