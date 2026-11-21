// 多階段（時間分配）用的通用數學：覆蓋型線性規劃、列生成與排程模擬。不認識遠征，純函式，不依賴 chrome.*、DOM 或 Dexie。
//
// 覆蓋型 LP（原問題）：min Σ_c y_c　s.t.　Σ_c P[k][c]·y_c ≥ 1（每列 k）、y ≥ 0。
// 解它的對偶：max Σ_k u_k　s.t.　Σ_k u_k·P[k][c] ≤ 1（每欄 c）、u ≥ 0。對偶限制式的右端都是 1，鬆弛變數
// 構成的基底直接可行，不需要第一階段；原問題的 y 取自最終 tableau 目標列裡鬆弛變數的 reduced cost（影子價格）。
// 這類問題高度退化，一律用 Bland's rule 選入／出基變數，保證不循環。

const EPS = 1e-9;
/** 列生成的最佳回應值超過這個才算「還有更好的欄」。 */
const PRICE_EPS = 1e-7;
const MAX_PIVOTS = 50000;
const MAX_ROUNDS = 200;

export type CoverResult =
    | { status: 'optimal'; y: number[]; u: number[]; value: number }
    /** 對偶無界＝原問題不可行；ray 是對偶的無界方向（u ≥ 0、Σ_k ray_k·P[k][c] ≤ 0 對每欄成立、Σ ray > 0），已正規化為最大元素 1。 */
    | { status: 'unbounded'; ray: number[] };

/** P[k][c]：列 k（資材）、欄 c（組合）。 */
export function solveCover(P: readonly (readonly number[])[]): CoverResult {
    const m = P.length;
    const n = m ? P[0].length : 0;
    if (!m) return { status: 'optimal', y: new Array<number>(n).fill(0), u: [], value: 0 };
    if (!n) return { status: 'unbounded', ray: new Array<number>(m).fill(1) };
    const width = m + n + 1;
    // 列 0 是目標列（z − Σu = 0）；列 1..n 是各欄的限制式 Σ_k P[k][c]·u_k + s_c = 1。
    const t: number[][] = [[...new Array<number>(m).fill(-1), ...new Array<number>(n).fill(0), 0]];
    for (let c = 0; c < n; c++) {
        const row = new Array<number>(width).fill(0);
        for (let k = 0; k < m; k++) row[k] = P[k][c];
        row[m + c] = 1;
        row[width - 1] = 1;
        t.push(row);
    }
    const basis = Array.from({ length: n }, (_, c) => m + c);
    for (let pivots = 0; pivots < MAX_PIVOTS; pivots++) {
        const obj = t[0];
        const enter = obj.findIndex((v, j) => j < width - 1 && v < -EPS);
        if (enter < 0) break;
        let leave = -1, bestRatio = Infinity;
        for (let i = 1; i <= n; i++) {
            const a = t[i][enter];
            if (a <= EPS) continue;
            const ratio = Math.max(0, t[i][width - 1]) / a;
            if (ratio < bestRatio - EPS || (ratio <= bestRatio + EPS && leave > 0 && basis[i - 1] < basis[leave - 1])) leave = i;
            bestRatio = Math.min(bestRatio, ratio);
        }
        if (leave < 0) {
            const ray = new Array<number>(m).fill(0);
            if (enter < m) ray[enter] = 1;
            basis.forEach((variable, i) => { if (variable < m) ray[variable] = -t[i + 1][enter]; });
            const top = Math.max(...ray);
            return { status: 'unbounded', ray: ray.map(v => Math.max(0, v) / top) };
        }
        const pivot = t[leave][enter];
        t[leave] = t[leave].map(v => v / pivot);
        for (let i = 0; i <= n; i++) {
            if (i === leave) continue;
            const factor = t[i][enter];
            if (factor === 0) continue;
            for (let j = 0; j < width; j++) t[i][j] -= factor * t[leave][j];
        }
        basis[leave - 1] = enter;
    }
    const u = new Array<number>(m).fill(0);
    basis.forEach((variable, i) => { if (variable < m) u[variable] = Math.max(0, t[i + 1][width - 1]); });
    return { status: 'optimal', y: Array.from({ length: n }, (_, c) => Math.max(0, t[0][m + c])), u, value: t[0][width - 1] };
}

export interface CoverColumn<T> { p: number[]; tag: T }
export type CoverSolution<T> =
    | { status: 'optimal'; columns: CoverColumn<T>[]; y: number[]; u: number[]; value: number }
    | { status: 'infeasible' };

/** 給固定的一組欄解同一個 LP（列生成與「限制版」子集比較共用）。 */
export const solveColumns = <T>(m: number, columns: readonly CoverColumn<T>[]) =>
    solveCover(Array.from({ length: m }, (_, k) => columns.map(column => column.p[k])));

/**
 * 列生成：欄（組合）多到不能全部列出時，從少數幾欄開始，反覆以目前的對偶 u 向 price 要「對 u 最有利的欄」
 * （價值 Σ_k u_k·p_k 最大者）；價值不超過 1 就沒有更好的欄，目前的解就是全域最佳。
 * 無界（原問題暫時不可行）時以 ray 取代 u：能找到 Σ ray·p > 0 的欄就加進去，找不到就是真的不可行。
 * 每次從頭解；欄數最多數百、列數 ≤ 8，成本可忽略。
 */
export function coverWithColumns<T>(
    m: number, initial: readonly CoverColumn<T>[], price: (u: number[]) => CoverColumn<T> | null,
): CoverSolution<T> {
    const columns = [...initial];
    let last: CoverSolution<T> = { status: 'infeasible' };
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const solved = solveColumns(m, columns);
        const weights = solved.status === 'optimal' ? solved.u : solved.ray;
        const best = price(weights);
        const worth = best ? best.p.reduce((sum, v, k) => sum + weights[k] * v, 0) : -Infinity;
        if (solved.status === 'optimal') {
            last = { status: 'optimal', columns: [...columns], y: solved.y, u: solved.u, value: solved.value };
            if (!best || worth <= 1 + PRICE_EPS) return last;
        } else {
            last = { status: 'infeasible' };
            if (!best || worth <= EPS) return last;
        }
        columns.push(best);
    }
    return last;
}

/** 排程模擬的步長（天）。 */
export const SCHEDULE_STEP = 0.25;
/** 判定溢出／見底的容差（資材單位）。 */
const BOUND_TOL = 1e-6;
/** 段落結束時，存量變化占上限比例超過這個才算有意義的轉折點。 */
const TRIGGER_MIN = 1e-4;

export interface ScheduleSegment {
    phase: number;
    days: number;
    start: number[];
    end: number[];
    /** 這一段怎麼結束：cap＝下一步會溢出、fall 也可能是下一步會見底（at 為當時存量）；rise／fall＝預定天數用完，取變化最大的一項（at 為段末存量）。最後一段為 null。 */
    trigger: { kind: 'cap' | 'rise' | 'fall'; index: number; at: number } | null;
}

/**
 * 防撞頂排程：把幾個階段（各有每日淨增減 rate 與預定天數）排成先後，盡量不讓任何資材超過上限或低於 0。
 * 以 step 為步長：目前階段下一步不會溢出／見底就續跑；否則換成「溢出＋見底量（各 ÷ 上限加總）」最小者，
 * 同分取剩餘天數長者、再同分取編號小者。起點沒指定 first 時同樣用這個規則挑。每步存量夾在 [0, 上限]。
 * order：固定先後，各階段依序連續跑完、不因撞頂換階段（階段數最少，撞頂的溢出照樣夾在上限）。
 * reached：各資材首次到上限的時間（天），沒到為 null。
 */
export function simulateSchedule(
    phases: readonly { rate: readonly number[]; days: number }[], start: readonly number[], caps: readonly number[],
    { first, order, step = SCHEDULE_STEP }: { first?: number; order?: readonly number[]; step?: number } = {},
): { segments: ScheduleSegment[]; end: number[]; reached: (number | null)[] } {
    const m = caps.length;
    const stock = start.map((v, k) => Math.min(caps[k], Math.max(0, v)));
    const remain = phases.map(phase => phase.days);
    const reached: (number | null)[] = stock.map((v, k) => (v >= caps[k] * (1 - EPS) ? 0 : null));
    const segments: ScheduleSegment[] = [];
    let time = 0, cur = -1, segStart: number[] = [], segDays = 0;
    // 階段 p 在下一個 dt 天的溢出／見底量，worst 是最嚴重的一項。
    const lossOf = (p: number, dt: number) => {
        let total = 0, worst = { kind: 'cap' as 'cap' | 'fall', index: 0, amount: 0 };
        for (let k = 0; k < m; k++) {
            const next = stock[k] + dt * phases[p].rate[k];
            const over = Math.max(0, next - caps[k] - BOUND_TOL) / caps[k];
            const under = Math.max(0, -next - BOUND_TOL) / caps[k];
            total += over + under;
            if (over > worst.amount) worst = { kind: 'cap', index: k, amount: over };
            if (under > worst.amount) worst = { kind: 'fall', index: k, amount: under };
        }
        return { total, worst };
    };
    // 預定天數用完：取變化占上限比例最大的資材，先看上升、再看下降。
    const finishedTrigger = (): ScheduleSegment['trigger'] => {
        const change = stock.map((v, k) => (v - segStart[k]) / caps[k]);
        const rise = change.reduce((best, v, k) => (v > change[best] ? k : best), 0);
        if (change[rise] > TRIGGER_MIN) return { kind: 'rise', index: rise, at: stock[rise] };
        const fall = change.reduce((best, v, k) => (v < change[best] ? k : best), 0);
        return change[fall] < -TRIGGER_MIN ? { kind: 'fall', index: fall, at: stock[fall] } : null;
    };
    const close = (trigger: ScheduleSegment['trigger']) => segments.push({ phase: cur, days: segDays, start: segStart, end: [...stock], trigger });
    for (;;) {
        const open = phases.map((_, p) => p).filter(p => remain[p] > EPS);
        if (!open.length) break;
        const loss = new Map(order ? [] : open.map(p => [p, lossOf(p, Math.min(step, remain[p]))] as const));
        const running = cur >= 0 && remain[cur] > EPS;
        if (!running || (!order && loss.get(cur)!.total > 0)) {
            const pick = order ? order.find(p => remain[p] > EPS)!
                : cur < 0 && first !== undefined && open.includes(first) ? first
                : [...open].sort((a, b) => loss.get(a)!.total - loss.get(b)!.total || remain[b] - remain[a] || a - b)[0];
            if (pick !== cur) {
                if (cur >= 0) close(running ? { kind: loss.get(cur)!.worst.kind, index: loss.get(cur)!.worst.index, at: stock[loss.get(cur)!.worst.index] } : finishedTrigger());
                cur = pick;
                segStart = [...stock];
                segDays = 0;
            }
        }
        const dt = Math.min(step, remain[cur]);
        for (let k = 0; k < m; k++) {
            const raw = stock[k] + dt * phases[cur].rate[k];
            if (reached[k] === null && raw >= caps[k] * (1 - EPS)) reached[k] = time + (raw > stock[k] ? dt * (caps[k] - stock[k]) / (raw - stock[k]) : 0);
            stock[k] = Math.min(caps[k], Math.max(0, raw));
        }
        remain[cur] -= dt;
        segDays += dt;
        time += dt;
    }
    if (cur >= 0) close(null);
    return { segments, end: stock, reached };
}
