import { describe, expect, it } from 'vitest';
import {
    formatTimingReport, parseCaptureTiming, quantile, toTimingRecord, TIMING_SEGMENTS,
    type CaptureTiming,
} from '../utils/capture-timing';

const main = { hit: 0, head: 10, quietMs: 750, readMs: 3, dispatch: 800, emit: 802, size: 2048 };
const full: CaptureTiming = {
    ...main,
    bridge: 805, bgRecv: 810, parseMs: 4, live: 830,
    panelRecv: 835, picked: 836, loaded: 840, projected: 850, rendered: 870, painted: 880,
};

describe('capture-timing', () => {
    it('頁面送來的量測欄位不齊或型別錯時整組捨棄', () => {
        expect(parseCaptureTiming(main)).toEqual(main);
        expect(parseCaptureTiming({ ...main, hit: '0' })).toBeNull();
        expect(parseCaptureTiming({ ...main, size: undefined })).toBeNull();
        expect(parseCaptureTiming({ ...main, live: Number.NaN })).toBeNull();
        expect(parseCaptureTiming(null)).toBeNull();
        // 多餘欄位不帶進擴充 context
        expect(parseCaptureTiming({ ...main, extra: 1 })).not.toHaveProperty('extra');
    });

    it('分段相加等於總延遲，主執行緒佔用只算 read 與 emit 內處理', () => {
        const record = toTimingRecord('api_port/port', full)!;
        expect(record.total).toBe(880);
        expect(record.seg.quiet).toBe(750);
        expect(record.seg.idle).toBe(800 - 10 - 750 - 3);
        expect(record.seg.bgStore).toBe(830 - 810 - 4);
        expect(record.mainThread).toBe(5);
        const sum = TIMING_SEGMENTS.reduce((acc, key) => acc + record.seg[key], 0);
        expect(sum).toBeCloseTo(record.total);
    });

    it('缺段的量測不建立紀錄', () => {
        const { painted: _painted, ...partial } = full;
        expect(toTimingRecord('api_port/port', partial)).toBeNull();
    });

    it('分位數採線性內插', () => {
        expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(quantile([5], 0.95)).toBe(5);
        expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    });

    it('報告含全體、大小分組、path 分組與最慢紀錄', () => {
        const records = [
            toTimingRecord('api_port/port', full)!,
            toTimingRecord('api_start2/getData', { ...full, size: 2_000_000 })!,
        ];
        const report = formatTimingReport(records, {
            version: '1.1.0.9', userAgent: 'UA', startedAt: 0, now: 600_000,
            incomplete: 1, dropped: 0, formatDateTime: ts => `T${ts}`,
        });
        expect(report).toContain('完整紀錄 2 筆｜缺段未計 1 筆');
        expect(report).toContain('quiet: 750 / 750 / 750');
        expect(report).toContain('≥512K | 1 |');
        expect(report).toContain('api_port/port | 1 |');
        expect(report).toContain('## 最慢 15 筆');
    });

    it('沒有完整紀錄時說明可能原因', () => {
        const report = formatTimingReport([], {
            version: 'v', userAgent: 'UA', startedAt: 0, now: 0, incomplete: 0, dropped: 0, formatDateTime: String,
        });
        expect(report).toContain('沒有完整紀錄');
    });
});
