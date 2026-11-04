import { describe, expect, it } from 'vitest';
import { IdleCaptureQueue, type IdleDeadlineLike, type IdleCaptureScheduler, type QueueTiming } from '../utils/idle-capture-queue';

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

    it('量測：記錄入列、輪到最前、安靜期延後與讀取耗時', () => {
        const scheduler = new FakeIdleScheduler();
        let clock = 1000;
        let quietLeft = 750;
        const timings: { path: string; timing: QueueTiming }[] = [];
        const queue = new IdleCaptureQueue(
            scheduler,
            (path, _req, _text, timing) => timings.push({ path, timing }),
            { now: () => clock, nextEligibleDelayMs: () => quietLeft },
        );

        queue.enqueue('first', '', () => { clock += 5; return 'one'; });
        clock = 1010;
        queue.enqueue('second', '', () => { clock += 2; return 'two'; });
        expect(scheduler.deferred[0].delayMs).toBe(750);

        clock = 1760;
        quietLeft = 0;
        scheduler.runNextDeferred();
        scheduler.runNext(enoughIdle);
        clock = 1800;
        scheduler.runNext(enoughIdle);

        expect(timings.map(t => t.path)).toEqual(['first', 'second']);
        expect(timings[0].timing).toEqual({ enqueuedAt: 1000, headAt: 1000, quietMs: 750, readMs: 5, dispatchAt: 1765 });
        // 第二筆在第一筆送出那一刻成為最前；之後沒有安靜期。
        expect(timings[1].timing).toEqual({ enqueuedAt: 1010, headAt: 1765, quietMs: 0, readMs: 2, dispatchAt: 1802 });
    });

    it('已知大小的小封包不等 idle，排到下一個 task；大封包與大小未知者仍等 idle，順序不變', () => {
        const scheduler = new FakeIdleScheduler();
        const delivered: string[] = [];
        const queue = new IdleCaptureQueue(
            scheduler,
            (path) => delivered.push(path),
            { immediateMaxChars: 100 },
        );

        queue.enqueue('small', '', () => 's', 10);
        expect(scheduler.callbacks).toHaveLength(0);
        expect(scheduler.deferred.map(d => d.delayMs)).toEqual([0]);
        queue.enqueue('large', '', () => 'l', 1000);
        queue.enqueue('unknown', '', () => 'u');
        queue.enqueue('small2', '', () => 's2', 10);

        scheduler.runNextDeferred();
        expect(delivered).toEqual(['small']);
        // 大封包輪到最前：改等 idle
        expect(scheduler.deferred).toHaveLength(0);
        scheduler.runNext(enoughIdle);
        expect(delivered).toEqual(['small', 'large']);
        scheduler.runNext(enoughIdle);
        expect(delivered).toEqual(['small', 'large', 'unknown']);
        scheduler.runNextDeferred();
        expect(delivered).toEqual(['small', 'large', 'unknown', 'small2']);
    });

    it('小封包仍先套用輸入後的安靜期', () => {
        const scheduler = new FakeIdleScheduler();
        const delivered: string[] = [];
        let quietLeft = 17;
        const queue = new IdleCaptureQueue(
            scheduler,
            (path) => delivered.push(path),
            { immediateMaxChars: 100, nextEligibleDelayMs: () => quietLeft },
        );

        queue.enqueue('small', '', () => 's', 10);
        expect(scheduler.deferred.map(d => d.delayMs)).toEqual([17]);
        quietLeft = 0;
        scheduler.runNextDeferred();
        expect(delivered).toEqual([]);
        expect(scheduler.deferred.map(d => d.delayMs)).toEqual([0]);
        scheduler.runNextDeferred();
        expect(delivered).toEqual(['small']);
    });
});
