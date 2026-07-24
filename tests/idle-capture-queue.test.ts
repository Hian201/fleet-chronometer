import { describe, expect, it } from 'vitest';
import { IdleCaptureQueue, type IdleDeadlineLike, type IdleCaptureScheduler } from '../utils/idle-capture-queue';

class FakeIdleScheduler implements IdleCaptureScheduler {
    callbacks: ((deadline: IdleDeadlineLike) => void)[] = [];
    deferred: { callback: () => void; delayMs: number }[] = [];

    schedule(callback: (deadline: IdleDeadlineLike) => void): void {
        this.callbacks.push(callback);
    }

    defer(callback: () => void, delayMs: number): void {
        this.deferred.push({ callback, delayMs });
    }

    runNext(deadline: IdleDeadlineLike): void {
        const callback = this.callbacks.shift();
        if (!callback) throw new Error('沒有待執行的 idle callback');
        callback(deadline);
    }

    runNextDeferred(): void {
        const task = this.deferred.shift();
        if (!task) throw new Error('沒有待執行的延後 callback');
        task.callback();
    }
}

const enoughIdle: IdleDeadlineLike = { didTimeout: false, timeRemaining: () => 20 };
const almostNoIdle: IdleDeadlineLike = { didTimeout: false, timeRemaining: () => 2 };

describe('IdleCaptureQueue', () => {
    it('空檔不足時不讀取封包，且每個 idle slice 只送出一筆', () => {
        const scheduler = new FakeIdleScheduler();
        const delivered: string[] = [];
        const queue = new IdleCaptureQueue(scheduler, (path, _req, text) => delivered.push(`${path}:${text}`));
        const reads: string[] = [];

        queue.enqueue('first', '', () => { reads.push('first'); return 'one'; });
        queue.enqueue('second', '', () => { reads.push('second'); return 'two'; });

        scheduler.runNext(almostNoIdle);
        expect(reads).toEqual([]);
        expect(delivered).toEqual([]);
        expect(scheduler.callbacks).toHaveLength(0);
        expect(scheduler.deferred).toHaveLength(1);
        expect(scheduler.deferred[0].delayMs).toBe(50);

        scheduler.runNextDeferred();
        scheduler.runNext(enoughIdle);
        expect(reads).toEqual(['first']);
        expect(delivered).toEqual(['first:one']);

        scheduler.runNext(enoughIdle);
        expect(reads).toEqual(['first', 'second']);
        expect(delivered).toEqual(['first:one', 'second:two']);
    });

    it('非同步讀取完成後仍等下一個 idle，並維持後續封包順序', async () => {
        const scheduler = new FakeIdleScheduler();
        const delivered: string[] = [];
        let resolveFirst!: (text: string) => void;
        const first = new Promise<string>(resolve => { resolveFirst = resolve; });
        const queue = new IdleCaptureQueue(scheduler, (path, _req, text) => delivered.push(`${path}:${text}`));

        queue.enqueue('first', '', () => first);
        queue.enqueue('second', '', () => 'two');
        scheduler.runNext(enoughIdle);
        expect(delivered).toEqual([]);

        resolveFirst('one');
        await Promise.resolve();
        scheduler.runNext(enoughIdle);
        expect(delivered).toEqual(['first:one']);

        scheduler.runNext(enoughIdle);
        expect(delivered).toEqual(['first:one', 'second:two']);
    });

    it('使用者剛操作後會等候安靜時間才開始讀取', () => {
        const scheduler = new FakeIdleScheduler();
        const delivered: string[] = [];
        let remainingQuietMs = 750;
        const queue = new IdleCaptureQueue(
            scheduler,
            (path, _req, text) => delivered.push(`${path}:${text}`),
            { nextEligibleDelayMs: () => remainingQuietMs },
        );

        queue.enqueue('slot_item', '', () => 'large-gear-list');
        expect(scheduler.callbacks).toHaveLength(0);
        expect(scheduler.deferred).toHaveLength(1);
        expect(scheduler.deferred[0].delayMs).toBe(750);

        remainingQuietMs = 0;
        scheduler.runNextDeferred();
        scheduler.runNext(enoughIdle);
        expect(delivered).toEqual(['slot_item:large-gear-list']);
    });
});
