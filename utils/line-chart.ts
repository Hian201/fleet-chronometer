// 折線圖幾何（純函式，無 DOM、無 chrome.*，node 可測）。只算座標與刻度，
// SVG 標記由呼叫端組——這樣同一份幾何可同時服務畫面與離線預覽。
//
// ── 一張圖、多條線、可開關 ────────────────────────────────────────────
// 八項資材畫在同一張大圖、共用一條 y 軸，使用者用圖例逐條開關。量級差距（燃料十萬級、
// 螺絲千級）的解法是**開關**，不是拆成多張圖，也不是雙 y 軸——後者兩套刻度沒有共同
// 基準，任何交叉都是視覺巧合。
//
// 關鍵在 `multiChartGeometry()` 的 y 值域**只由傳進來的（＝顯示中的）序列決定**：
// 關掉燃料之後，螺絲那條線就會撐滿整張圖，而不是繼續被十萬級壓在底部。

export interface ChartPoint {
    x: number;
    y: number;
}

export interface ChartBox {
    width: number;
    height: number;
    padTop: number;
    padBottom: number;
    padLeft: number;
    padRight: number;
}

export interface SeriesGeometry {
    /** 呼叫端給的識別（此處是資材索引），用來把幾何對回原序列。 */
    key: number;
    /** 折線的 SVG path `d`。少於兩點時為空字串（呼叫端改畫單點）。 */
    line: string;
    points: ChartPoint[];
}

export interface MultiChartGeometry {
    series: SeriesGeometry[];
    min: number;
    max: number;
    /** y 軸刻度（值與畫布座標）。 */
    ticks: { value: number; y: number }[];
    /** 各樣本的 x 座標（所有序列共用同一組）。十字準線用。 */
    xs: number[];
    /** 繪圖區的上下緣（畫格線與十字準線用）。 */
    top: number;
    bottom: number;
}

/**
 * 多序列共用一條 y 軸。x 依 `ts` 在 `[tMin, tMax]` 的相對位置（**不是等距索引**）：
 * 取樣本身就是不等距的（一天打十場、隔天不上線），等距畫會把時間軸扭曲。
 */
export function multiChartGeometry(
    ts: number[],
    series: { key: number; values: number[] }[],
    tMin: number,
    tMax: number,
    box: ChartBox,
    tickCount = 4,
): MultiChartGeometry {
    const plotW = Math.max(1, box.width - box.padLeft - box.padRight);
    const plotH = Math.max(1, box.height - box.padTop - box.padBottom);
    const span = Math.max(1, tMax - tMin);

    const all = series.flatMap(s => s.values);
    let min = all.length ? Math.min(...all) : 0;
    let max = all.length ? Math.max(...all) : 1;
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    // 全平的序列（整段沒動過）給一點高度，否則線會貼在框邊看不見
    if (min === max) { const pad = Math.max(1, Math.abs(min) * 0.05); min -= pad; max += pad; }

    const yOf = (v: number) => box.padTop + plotH - ((v - min) / (max - min)) * plotH;
    const xs = ts.map(t => round(box.padLeft + ((t - tMin) / span) * plotW));

    return {
        min, max, xs,
        top: round(box.padTop),
        bottom: round(box.padTop + plotH),
        series: series.map(s => {
            const points = s.values.map((v, i) => ({ x: xs[i], y: round(yOf(v)) }));
            return {
                key: s.key,
                points,
                line: points.length < 2 ? ''
                    : points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '),
            };
        }),
        ticks: niceTicks(min, max, tickCount).map(value => ({ value, y: round(yOf(value)) })),
    };
}

/** 讀得出來的刻度值（1／2／2.5／5 × 10^n）。回傳落在 [min,max] 內的刻度。 */
export function niceTicks(min: number, max: number, count = 4): number[] {
    if (!(max > min) || count < 1) return [];
    const rawStep = (max - min) / count;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;
    // 2.5 這一階不能省：少了它，rawStep 落在 2～5 之間時會被推到 5，一張圖只剩一條刻度線
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5
        : normalized <= 5 ? 5 : 10) * magnitude;
    const out: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
        out.push(Math.round(v * 1e6) / 1e6);
    }
    return out;
}

/** 畫布 x → 樣本索引（最接近者）。十字準線用；空序列回 -1。 */
export function nearestIndex(xs: number[], x: number): number {
    if (!xs.length) return -1;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
        const dist = Math.abs(xs[i] - x);
        if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
}

const round = (n: number) => Math.round(n * 100) / 100;
