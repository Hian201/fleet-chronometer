// 「資源紀錄」分區的核心（純函式，無 chrome.*／無 DOM，node 可測）：
// 序列取樣、消長差分、活動海域的區段消耗。UI 殼在 entrypoints/overview/sections/resource-log.ts。
//
// 兩個貫穿全檔的取捨：
//   1. **餘額是事實，消長是差分**。封包只給餘額，任何「花了多少」都是兩筆餘額相減，
//      故一定要說清楚是「哪兩個時間點之間」。區段表因此永遠成對顯示起訖時刻。
//   2. **缺樣本就講缺樣本**。標記（開打／量表歸零）與資源取樣是兩條獨立的觀測，
//      標記時刻不保證正好有一筆餘額；找不到就回 null，不內插、不拿最近的假裝是當下。
import type { ResourceMarkRow, ResourceRow } from './db';
import { MATERIAL_COUNT } from './resource-capture';

/** 八項資材的圖示檔名（public/icons/resource/*.svg），索引＝api_material 順序。 */
export const MAT_FILES = ['fuel', 'ammo', 'steel', 'bauxite', 'torch', 'drum', 'devmat', 'screw'] as const;
/** 對應的 i18n key 前綴（`mat.fuel` 短名／`mat.fuel.full` 全名）。 */
export const MAT_KEYS = MAT_FILES.map(f => `mat.${f}`);

export type MatIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ── 取樣與消長 ───────────────────────────────────────────────────────────

export interface Sample {
    ts: number;
    m: number[];
}

/** 時間升冪、同一毫秒去重（保留較晚的 eventId，那是較新的觀測）。 */
export function normalizeSamples(rows: ResourceRow[]): Sample[] {
    const byTs = new Map<number, ResourceRow>();
    for (const row of rows) {
        if (!Array.isArray(row.m) || row.m.length < MATERIAL_COUNT) continue;
        const prev = byTs.get(row.ts);
        if (!prev || prev.eventId <= row.eventId) byTs.set(row.ts, row);
    }
    return [...byTs.values()]
        .sort((a, b) => a.ts - b.ts)
        .map(row => ({ ts: row.ts, m: row.m.slice(0, MATERIAL_COUNT) }));
}

/** 在 `ts` 當下（含）之前最近的一筆餘額。沒有任何更早的樣本時回 null＝不可考。 */
export function sampleAt(samples: Sample[], ts: number): Sample | null {
    let lo = 0, hi = samples.length - 1, found: Sample | null = null;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].ts <= ts) { found = samples[mid]; lo = mid + 1; }
        else hi = mid - 1;
    }
    return found;
}

/** 逐項差分（後 − 前）。任一邊缺席就回 null，不用 0 頂替。 */
export function delta(from: Sample | null, to: Sample | null): number[] | null {
    if (!from || !to) return null;
    return Array.from({ length: MATERIAL_COUNT }, (_, i) => (to.m[i] ?? 0) - (from.m[i] ?? 0));
}

export type Granularity = 'raw' | 'hour' | 'day';

const BUCKET_MS: Record<Exclude<Granularity, 'raw'>, number> = {
    hour: 3_600_000,
    day: 86_400_000,
};

/**
 * 依粒度收斂樣本：每個時間桶只留**最後一筆**（餘額是「當下有多少」，取平均沒有意義，
 * 取最後一筆才等於「這一天結束時剩多少」）。'day' 依本地時區切，不用 UTC——
 * 玩家心裡的「今天」是本地日期。
 */
export function bucketSamples(samples: Sample[], granularity: Granularity): Sample[] {
    if (granularity === 'raw') return samples;
    const out: Sample[] = [];
    let currentKey: string | null = null;
    for (const s of samples) {
        const key = granularity === 'day' ? localDayKey(s.ts) : String(Math.floor(s.ts / BUCKET_MS.hour));
        if (key !== currentKey) { out.push(s); currentKey = key; }
        else out[out.length - 1] = s;
    }
    return out;
}

export function localDayKey(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 折線圖用的等距抽稀：超過 `maxPoints` 時**保留每個時間桶的最後一筆**（同 bucketSamples
 * 的理由），並保證首尾兩筆一定在。純減量、不平滑——平滑會把「一次活動燒掉十萬燃料」
 * 的那道陡降磨圓，那正是這張圖要看的東西。
 */
export function downsample(samples: Sample[], maxPoints: number): Sample[] {
    if (samples.length <= maxPoints || maxPoints < 2) return samples;
    const first = samples[0].ts, last = samples[samples.length - 1].ts;
    const span = Math.max(1, last - first);
    const out: Sample[] = [];
    let currentBucket = -1;
    for (const s of samples) {
        const bucket = Math.min(maxPoints - 1, Math.floor(((s.ts - first) / span) * maxPoints));
        if (bucket !== currentBucket) { out.push(s); currentBucket = bucket; }
        else out[out.length - 1] = s;
    }
    if (out[0].ts !== first) out.unshift(samples[0]);
    if (out[out.length - 1].ts !== last) out.push(samples[samples.length - 1]);
    return out;
}

// ── 活動海域的特殊時間點 ─────────────────────────────────────────────────

export type MilestoneKind = 'open' | 'clear';

export interface Milestone {
    kind: MilestoneKind;
    /** `mapArea * 10 + mapNo`。 */
    mapKey: number;
    area: number;
    mapNo: number;
    ts: number;
    /** clear：該圖第幾次量表歸零（0 起）。多段量表的活動海域會有多筆。 */
    seq?: number;
    /** 該時刻（含）之前最近一筆餘額；null＝當時沒有取樣，不可考。 */
    sample: Sample | null;
}

export interface EventSegment {
    /** 從哪個里程碑到哪個里程碑；`from` 為 null 代表這是活動的第一個時間點。 */
    from: Milestone | null;
    to: Milestone;
    /** 期間消長（後 − 前）。任一端缺樣本即 null。 */
    delta: number[] | null;
}

export interface EventPeriod {
    area: number;
    /** 依時間排序的里程碑（開打／各段歸零）。 */
    milestones: Milestone[];
    segments: EventSegment[];
    /** 全活動消長（第一個到最後一個里程碑）。 */
    total: number[] | null;
    startTs: number;
    endTs: number;
}

/**
 * 把標記表整理成「一個活動一段」的區段消耗。
 *
 * 活動的起點刻意用**該 area 最早的 stage-open**（通常就是第一次進 E1），而不是寫死
 * mapNo===1：玩家有可能先開 E2（前段開放時間不同），寫死第一關會漏掉更早的消耗。
 */
export function buildEventPeriods(marks: ResourceMarkRow[], samples: Sample[]): EventPeriod[] {
    const byArea = new Map<number, Milestone[]>();
    for (const mark of marks) {
        if (mark.kind === 'gauge-seen') continue;   // 內部守衛，不是里程碑
        const area = Math.floor(mark.mapKey / 10);
        const milestone: Milestone = {
            kind: mark.kind === 'stage-open' ? 'open' : 'clear',
            mapKey: mark.mapKey,
            area,
            mapNo: mark.mapKey % 10,
            ts: mark.ts,
            ...(mark.seq === undefined ? {} : { seq: mark.seq }),
            sample: sampleAt(samples, mark.ts),
        };
        const list = byArea.get(area);
        if (list) list.push(milestone); else byArea.set(area, [milestone]);
    }

    const periods: EventPeriod[] = [];
    for (const [area, list] of byArea) {
        // 同一時刻的 open 排在 clear 前面（先進圖才可能打通）
        list.sort((a, b) => a.ts - b.ts || (a.kind === b.kind ? a.mapNo - b.mapNo : a.kind === 'open' ? -1 : 1));
        const segments: EventSegment[] = list.map((to, i) => {
            const from = i === 0 ? null : list[i - 1];
            return { from, to, delta: delta(from?.sample ?? null, to.sample) };
        });
        periods.push({
            area,
            milestones: list,
            segments,
            total: delta(list[0].sample, list[list.length - 1].sample),
            startTs: list[0].ts,
            endTs: list[list.length - 1].ts,
        });
    }
    return periods.sort((a, b) => b.startTs - a.startTs);
}

// ── 匯出 ─────────────────────────────────────────────────────────────────

/** CSV（同 ships/equipment 分區的規則：**匯出跟著顯示欄位走**）。 */
export function toCsv(
    rows: { ts: number; m: number[]; d: number[] | null }[],
    cols: MatIndex[],
    header: { time: string; mats: string[] },
    withDelta: boolean,
): string {
    const cells: string[][] = [[
        header.time,
        ...cols.flatMap(i => (withDelta ? [header.mats[i], `${header.mats[i]} Δ`] : [header.mats[i]])),
    ]];
    for (const row of rows) {
        cells.push([
            new Date(row.ts).toISOString(),
            ...cols.flatMap(i => (withDelta
                ? [String(row.m[i] ?? ''), row.d ? String(row.d[i]) : '']
                : [String(row.m[i] ?? '')])),
        ]);
    }
    return cells.map(line => line.map(csvCell).join(',')).join('\n');
}

function csvCell(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
