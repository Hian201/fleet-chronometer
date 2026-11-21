import { describe, expect, it } from 'vitest';
import { coverWithColumns, simulateSchedule, solveCover, solveColumns, type CoverColumn } from '../utils/expedition-phases';

/** 固定種子的亂數，測試才穩定。 */
function rng(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** 高斯消去解 A x = b；奇異回傳 null。 */
function gauss(A: number[][], b: number[]): number[] | null {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
        if (Math.abs(M[pivot][col]) < 1e-9) return null;
        [M[col], M[pivot]] = [M[pivot], M[col]];
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col] / M[col][col];
            for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
        }
    }
    return M.map((row, i) => row[n] / row[i]);
}

function* subsets(n: number, size: number, start = 0, picked: number[] = []): Generator<number[]> {
    if (picked.length === size) { yield picked; return; }
    for (let i = start; i < n; i++) yield* subsets(n, size, i + 1, [...picked, i]);
}

/** 暴力解：枚舉「選 s 欄、s 列為緊」的所有頂點，取可行者的最小 Σy；沒有可行頂點為 null。 */
function brute(P: number[][]): number | null {
    const m = P.length, n = P[0].length;
    let best: number | null = null;
    for (let size = 1; size <= Math.min(m, n); size++) {
        for (const cols of subsets(n, size)) for (const rows of subsets(m, size)) {
            const y = gauss(rows.map(k => cols.map(c => P[k][c])), rows.map(() => 1));
            if (!y || y.some(v => v < -1e-9)) continue;
            const full = new Array<number>(n).fill(0);
            cols.forEach((c, i) => { full[c] = Math.max(0, y[i]); });
            if (P.every(row => row.reduce((sum, v, c) => sum + v * full[c], 0) >= 1 - 1e-7)) {
                const value = full.reduce((a, b) => a + b, 0);
                if (best === null || value < best) best = value;
            }
        }
    }
    return best;
}

describe('solveCover', () => {
    it('隨機 3×6 正矩陣：最佳值與暴力解一致，y 可行且總和等於對偶值', () => {
        const rand = rng(7);
        for (let round = 0; round < 60; round++) {
            const P = Array.from({ length: 3 }, () => Array.from({ length: 6 }, () => 0.1 + rand() * 2));
            const result = solveCover(P);
            expect(result.status).toBe('optimal');
            if (result.status !== 'optimal') continue;
            expect(result.value).toBeCloseTo(brute(P)!, 6);
            expect(result.y.reduce((a, b) => a + b, 0)).toBeCloseTo(result.value, 6);
            expect(result.u.reduce((a, b) => a + b, 0)).toBeCloseTo(result.value, 6);
            P.forEach(row => expect(row.reduce((sum, v, c) => sum + v * result.y[c], 0)).toBeGreaterThanOrEqual(1 - 1e-7));
        }
    });

    it('含負值的矩陣：可行時與暴力解一致，不可行時回傳無界方向', () => {
        const rand = rng(11);
        let feasible = 0, infeasible = 0;
        for (let round = 0; round < 80; round++) {
            const P = Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => rand() * 2 - 0.8));
            const expected = brute(P);
            const result = solveCover(P);
            if (expected === null) {
                infeasible++;
                expect(result.status).toBe('unbounded');
                if (result.status === 'unbounded') {
                    // Farkas 證明：ray ≥ 0、對每欄 Σ ray_k·P[k][c] ≤ 0、Σ ray > 0。
                    expect(result.ray.every(v => v >= 0)).toBe(true);
                    expect(result.ray.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
                    for (let c = 0; c < 5; c++) expect(result.ray.reduce((sum, v, k) => sum + v * P[k][c], 0)).toBeLessThanOrEqual(1e-7);
                }
            } else {
                feasible++;
                expect(result.status).toBe('optimal');
                if (result.status === 'optimal') expect(result.value).toBeCloseTo(expected, 6);
            }
        }
        expect(feasible).toBeGreaterThan(5);
        expect(infeasible).toBeGreaterThan(5);
    });

    it('高度退化（重複欄、零欄、相同列）不會卡住', () => {
        const P = [
            [1, 1, 1, 0, 2, 2],
            [1, 1, 1, 0, 2, 2],
            [0.5, 0.5, 0.5, 0, 1, 1],
            [2, 2, 2, 0, 4, 4],
        ];
        const result = solveCover(P);
        expect(result.status).toBe('optimal');
        if (result.status === 'optimal') expect(result.value).toBeCloseTo(brute(P)!, 6);
        // 全部元素相同：每個基底都退化。
        const flat = solveCover(Array.from({ length: 8 }, () => new Array<number>(8).fill(1)));
        expect(flat.status === 'optimal' && flat.value).toBeCloseTo(1, 9);
    });

    it('沒有欄時不可行、沒有列時值為 0', () => {
        expect(solveCover([[], []]).status).toBe('unbounded');
        expect(solveCover([])).toMatchObject({ status: 'optimal', value: 0 });
    });
});

describe('coverWithColumns', () => {
    const pool = (rand: () => number, n: number, m: number): CoverColumn<number>[] =>
        Array.from({ length: n }, (_, tag) => ({ tag, p: Array.from({ length: m }, () => rand() * 2 - 0.3) }));
    // 在整個欄池裡找對 u 價值最大的欄，等價於 LP 的 pricing。
    const priceFrom = (columns: CoverColumn<number>[]) => (u: number[]) =>
        columns.reduce<CoverColumn<number> | null>((best, column) => {
            const value = column.p.reduce((sum, v, k) => sum + v * u[k], 0);
            return !best || value > best.p.reduce((sum, v, k) => sum + v * u[k], 0) ? column : best;
        }, null);

    it('從少數欄開始，結果與一次解完整欄池相同', () => {
        const rand = rng(3);
        for (let round = 0; round < 30; round++) {
            const all = pool(rand, 40, 4);
            const direct = solveColumns(4, all);
            const generated = coverWithColumns(4, all.slice(0, 2), priceFrom(all));
            if (direct.status === 'optimal') {
                expect(generated.status).toBe('optimal');
                if (generated.status === 'optimal') expect(generated.value).toBeCloseTo(direct.value, 6);
            } else expect(generated.status).toBe('infeasible');
        }
    });

    it('不可行：所有欄在某一列都不為正', () => {
        const all: CoverColumn<number>[] = [{ tag: 0, p: [1, -1] }, { tag: 1, p: [2, 0] }, { tag: 2, p: [0.5, -3] }];
        expect(coverWithColumns(2, [all[0]], priceFrom(all)).status).toBe('infeasible');
    });
});

describe('simulateSchedule', () => {
    it('起點接近上限時先跑不會溢出的階段，任何時刻都不超過上限或低於 0', () => {
        // 階段 0 使資材 0 上升（會溢出）、階段 1 使它下降。資材 0 從 95／100 開始：先跑階段 1，不撞頂。
        const result = simulateSchedule([{ rate: [10, 0], days: 4 }, { rate: [-5, 4], days: 6 }], [95, 0], [100, 100]);
        expect(result.segments[0].phase).toBe(1);
        for (const segment of result.segments) {
            segment.start.concat(segment.end).forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100 + 1e-9); });
        }
        expect(result.segments.reduce((sum, segment) => sum + segment.days, 0)).toBeCloseTo(10);
        expect(result.segments[result.segments.length - 1].trigger).toBeNull();
    });

    it('指定 first 時從它開始；預定天數用完時轉折點取上升最多的資材', () => {
        const result = simulateSchedule([{ rate: [10, 1], days: 3 }, { rate: [0, 10], days: 3 }], [0, 0], [1000, 1000], { first: 1 });
        expect(result.segments.map(segment => segment.phase)).toEqual([1, 0]);
        expect(result.segments[0].trigger).toEqual({ kind: 'rise', index: 1, at: 30 });
        expect(result.reached).toEqual([null, null]);
    });

    it('下降的轉折：存量見底時換階段（fall、at 為當時存量）；預定天數用完且只有下降時也是 fall', () => {
        const drain = simulateSchedule([{ rate: [-10, 0], days: 5 }, { rate: [0, 10], days: 5 }], [10, 0], [100, 100], { first: 0 });
        expect(drain.segments[0].trigger).toEqual({ kind: 'fall', index: 0, at: 0 });
        // 第二段預定天數用完時資材 1 升了 50；最後一段（回頭補完階段 0）沒有轉折。
        expect(drain.segments[1].trigger).toEqual({ kind: 'rise', index: 1, at: 50 });
        expect(drain.segments[drain.segments.length - 1].trigger).toBeNull();
        const down = simulateSchedule([{ rate: [-1, 0], days: 2 }, { rate: [0, 0], days: 1 }], [50, 0], [100, 100], { first: 0 });
        expect(down.segments[0].trigger).toEqual({ kind: 'fall', index: 0, at: 48 });
        // 變化都在門檻內（占上限 0.01% 以下）時沒有轉折條件。
        const flat = simulateSchedule([{ rate: [0.001, 0], days: 1 }, { rate: [0, 0], days: 1 }], [50, 0], [100, 100], { first: 0 });
        expect(flat.segments[0].trigger).toBeNull();
    });

    it('下一步會溢出的階段改派別的：cap 轉折記錄溢出最多的資材與當時存量', () => {
        const result = simulateSchedule([{ rate: [10, 0], days: 10 }, { rate: [0, 10], days: 10 }], [90, 0], [100, 100], { first: 0 });
        expect(result.segments[0]).toMatchObject({ phase: 0, trigger: { kind: 'cap', index: 0, at: 100 } });
        expect(result.segments[1].phase).toBe(1);
    });

    it('固定先後（order）：各階段連續跑完，不因撞頂換階段，撞頂的溢出夾在上限', () => {
        const phases = [{ rate: [10, 0], days: 10 }, { rate: [0, 10], days: 10 }];
        const result = simulateSchedule(phases, [90, 0], [100, 100], { order: [0, 1] });
        expect(result.segments.map(segment => [segment.phase, segment.days])).toEqual([[0, 10], [1, 10]]);
        expect(result.end).toEqual([100, 100]);
        expect(result.reached[0]).toBeCloseTo(1);
        expect(result.segments[0].trigger).toEqual({ kind: 'rise', index: 0, at: 100 });
        // 同樣的輸入用防撞頂排程：先跑階段 1 避開溢出（階段 0 一開始就撞頂）。
        expect(simulateSchedule(phases, [99.9, 0], [100, 100]).segments[0].phase).toBe(1);
    });
});
