// 匯入去重用的時間桶索引：同分組鍵、時間差在容差內的候選才需要逐一比對，
// 把「每列掃全表」降成「只看相鄰三個時間桶」。純函式、零 chrome.* 依賴。

export class TimeBucketIndex<T> {
    private readonly buckets = new Map<string, T[]>();
    // 時間不是有限數值的既有列沒有桶可放；舊的線性比對把它們當萬用，這裡每次查詢都掃一遍以維持結果。
    private readonly loose: T[] = [];

    constructor(
        private readonly toleranceMs: number,
        private readonly keyOf: (row: T) => string,
        private readonly tsOf: (row: T) => number,
    ) {}

    private slot(key: string, index: number): string { return `${key}\u0000${index}`; }

    add(row: T): void {
        const ts = this.tsOf(row);
        if (!Number.isFinite(ts)) { this.loose.push(row); return; }
        const slot = this.slot(this.keyOf(row), Math.floor(ts / this.toleranceMs));
        const bucket = this.buckets.get(slot);
        if (bucket) bucket.push(row); else this.buckets.set(slot, [row]);
    }

    /** 候選集合是超集合：容差內的列必在其中，呼叫端仍須用原本的完整判斷式過濾。 */
    some(key: string, ts: number, predicate: (row: T) => boolean): boolean {
        if (this.loose.some(predicate)) return true;
        if (!Number.isFinite(ts)) {
            for (const bucket of this.buckets.values()) if (bucket.some(predicate)) return true;
            return false;
        }
        const base = Math.floor(ts / this.toleranceMs);
        for (let offset = -1; offset <= 1; offset++) {
            if (this.buckets.get(this.slot(key, base + offset))?.some(predicate)) return true;
        }
        return false;
    }
}
