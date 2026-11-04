/**
 * 擷取延遲量測（開發用 UI 才收集與顯示）。
 *
 * 一筆 kcsapi 回應從遊戲 axios 到面板畫面要經過 MAIN world 佇列、bridge、background、
 * panel 四個 context。各 context 以 `performance.timeOrigin + performance.now()` 取同一
 * 牆鐘的毫秒時間，跨 context 相減可能有亞毫秒誤差，個別段落出現極小負值屬正常。
 *
 * 量測值只隨記憶體中的訊息傳遞，**不寫入任何 DB 欄位**；raw event 的 `ts` 仍由 bridge
 * 的 `Date.now()` 決定。MAIN world 送來的欄位視為不可信輸入，進入擴充 context 前一律驗證。
 * 本檔為純函式，不依賴 chrome.* 或 DOM。
 */

export function wallNow(): number {
    return performance.timeOrigin + performance.now();
}

/** MAIN world 在 postMessage 前填入的欄位。 */
export interface MainCaptureTiming {
    /** axios response interceptor 收到並入列 */
    hit: number;
    /** 成為佇列最前一筆（前面的封包都送出了） */
    head: number;
    /** 因使用者操作安靜期而延後的累計時間（取自延後排程的設定值，為估計值） */
    quietMs: number;
    /** 回應序列化成字串的耗時（佔用遊戲主執行緒） */
    readMs: number;
    /** 佇列交出這筆的時間 */
    dispatch: number;
    /** 呼叫 postMessage 前一刻；dispatch→emit 之間是 emit 內的處理（含戰鬥封包除錯解析） */
    emit: number;
    /** apiText 字元數 */
    size: number;
}

export interface CaptureTiming extends MainCaptureTiming {
    /** bridge 送出 runtime message */
    bridge?: number;
    /** background 收到 runtime message */
    bgRecv?: number;
    /** background 解析 apiText 的耗時 */
    parseMs?: number;
    /** background 已保存 raw event、送出 kc:live */
    live?: number;
    /** panel 收到 kc:live */
    panelRecv?: number;
    /** panel 佇列輪到這筆、開始讀 DB */
    picked?: number;
    /** panel 讀完 db.events */
    loaded?: number;
    /** panel 投影（GameState＋derived tables）完成 */
    projected?: number;
    /** panel renderAll() 完成 */
    rendered?: number;
    /** renderAll 後的下一個 animation frame（畫面已可繪出） */
    painted?: number;
}

const MAIN_KEYS = ['hit', 'head', 'quietMs', 'readMs', 'dispatch', 'emit', 'size'] as const;
const LATER_KEYS = [
    'bridge', 'bgRecv', 'parseMs', 'live',
    'panelRecv', 'picked', 'loaded', 'projected', 'rendered', 'painted',
] as const;

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** 驗證跨 context 送來的量測物件；欄位不齊或型別錯一律回 null，不拿半套資料計算。 */
export function parseCaptureTiming(value: unknown): CaptureTiming | null {
    if (!value || typeof value !== 'object') return null;
    const src = value as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const key of MAIN_KEYS) {
        if (!finite(src[key])) return null;
        out[key] = src[key] as number;
    }
    for (const key of LATER_KEYS) {
        if (src[key] === undefined) continue;
        if (!finite(src[key])) return null;
        out[key] = src[key] as number;
    }
    return out as unknown as CaptureTiming;
}

/** 報告中的分段，依封包經過的順序排列。 */
export const TIMING_SEGMENTS = [
    'queueAhead', 'quiet', 'idle', 'read', 'emitWork',
    'toBridge', 'toBackground', 'bgParse', 'bgStore', 'toPanel',
    'panelQueue', 'dbRead', 'project', 'render', 'paint',
] as const;
export type TimingSegment = typeof TIMING_SEGMENTS[number];

const SEGMENT_NOTE: Record<TimingSegment, string> = {
    queueAhead: 'MAIN 排在前面封包之後',
    quiet: 'MAIN 輸入後安靜期（估計）',
    idle: 'MAIN 等排程（小封包下一個 task、大封包 idle）',
    read: 'MAIN 序列化回應（佔遊戲主執行緒）',
    emitWork: 'MAIN emit 內處理（佔遊戲主執行緒）',
    toBridge: 'postMessage 複製＋bridge 處理',
    toBackground: 'runtime message 到 SW',
    bgParse: 'SW 解析 apiText',
    bgStore: 'SW 排隊＋寫入 raw event',
    toPanel: 'kc:live 到 panel',
    panelQueue: 'panel 排在前面事件之後',
    dbRead: 'panel 讀 db.events',
    project: 'panel 投影',
    render: 'panel renderAll',
    paint: '等下一個畫面幀',
};

export interface CaptureTimingRecord {
    path: string;
    size: number;
    /** 遊戲收到回應的牆鐘時間 */
    at: number;
    seg: Record<TimingSegment, number>;
    /** 遊戲收到回應 → 面板可繪出 */
    total: number;
    /** 佔用遊戲主執行緒的已知部分（read＋emitWork；不含 postMessage 內部複製） */
    mainThread: number;
}

/** 各段都齊才建立紀錄；缺段（例如 SW 重啟回收的事件）回 null。 */
export function toTimingRecord(path: string, t: CaptureTiming): CaptureTimingRecord | null {
    const { bridge, bgRecv, parseMs, live, panelRecv, picked, loaded, projected, rendered, painted } = t;
    if (![bridge, bgRecv, parseMs, live, panelRecv, picked, loaded, projected, rendered, painted].every(finite)) {
        return null;
    }
    const emitWork = t.emit - t.dispatch;
    const seg: Record<TimingSegment, number> = {
        queueAhead: t.head - t.hit,
        quiet: t.quietMs,
        idle: t.dispatch - t.head - t.quietMs - t.readMs,
        read: t.readMs,
        emitWork,
        toBridge: bridge! - t.emit,
        toBackground: bgRecv! - bridge!,
        bgParse: parseMs!,
        bgStore: live! - bgRecv! - parseMs!,
        toPanel: panelRecv! - live!,
        panelQueue: picked! - panelRecv!,
        dbRead: loaded! - picked!,
        project: projected! - loaded!,
        render: rendered! - projected!,
        paint: painted! - rendered!,
    };
    return {
        path,
        size: t.size,
        at: t.hit,
        seg,
        total: painted! - t.hit,
        mainThread: t.readMs + emitWork,
    };
}

/** 線性內插分位數；空陣列回 NaN（報告中顯示為「-」）。 */
export function quantile(values: number[], q: number): number {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function ms(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

function kb(chars: number): string {
    if (!Number.isFinite(chars)) return '-';
    return chars >= 1024 ? `${(chars / 1024).toFixed(chars >= 10240 ? 0 : 1)}K` : `${Math.round(chars)}`;
}

function stats(values: number[]): string {
    return `${ms(quantile(values, 0.5))} / ${ms(quantile(values, 0.95))} / ${ms(Math.max(...values))}`;
}

/** 依 p50 找出這組紀錄最耗時的分段。 */
function dominantSegment(records: CaptureTimingRecord[]): string {
    let best: TimingSegment = TIMING_SEGMENTS[0];
    let bestValue = -Infinity;
    for (const key of TIMING_SEGMENTS) {
        const value = quantile(records.map(r => r.seg[key]), 0.5);
        if (value > bestValue) { best = key; bestValue = value; }
    }
    return `${best} ${ms(bestValue)}`;
}

export const SIZE_BUCKETS: { label: string; max: number }[] = [
    { label: '<4K', max: 4 * 1024 },
    { label: '4K–64K', max: 64 * 1024 },
    { label: '64K–512K', max: 512 * 1024 },
    { label: '≥512K', max: Infinity },
];

export interface TimingReportMeta {
    version: string;
    userAgent: string;
    startedAt: number;
    now: number;
    /** 收到量測但缺段而未計入的筆數 */
    incomplete: number;
    /** 超過保留上限被丟掉的最舊筆數 */
    dropped: number;
    formatDateTime: (ts: number) => string;
}

/**
 * 產生可直接貼回對話的純文字報告。分段名稱固定用英文代號，方便跨語系比對；
 * 開頭附各代號的中文說明。
 */
export function formatTimingReport(records: CaptureTimingRecord[], meta: TimingReportMeta): string {
    const minutes = Math.max(0, (meta.now - meta.startedAt) / 60000);
    const lines: string[] = [];
    lines.push('# Fleet Chronometer 擷取延遲量測');
    lines.push(`版本 ${meta.version}｜${meta.userAgent}`);
    lines.push(`期間 ${meta.formatDateTime(meta.startedAt)} → ${meta.formatDateTime(meta.now)}（${minutes.toFixed(1)} 分）`);
    lines.push(`完整紀錄 ${records.length} 筆｜缺段未計 ${meta.incomplete} 筆｜超出上限丟棄 ${meta.dropped} 筆`);
    if (!records.length) {
        lines.push('', '（沒有完整紀錄：請確認遊戲分頁已 F5、面板維持開啟，並在開啟計時後操作遊戲）');
        return lines.join('\n');
    }

    lines.push('', '## 全體（ms，p50 / p95 / max）');
    lines.push(`total（遊戲收到 → 面板可繪出）: ${stats(records.map(r => r.total))}`);
    lines.push(`mainThread（佔遊戲主執行緒的已知部分）: ${stats(records.map(r => r.mainThread))}`);
    for (const key of TIMING_SEGMENTS) {
        lines.push(`${key}: ${stats(records.map(r => r.seg[key]))}　— ${SEGMENT_NOTE[key]}`);
    }

    lines.push('', '## 依封包大小（ms）');
    lines.push('size | n | total p50 / p95 / max | mainThread p95 | 最大宗段(p50)');
    let lower = 0;
    for (const bucket of SIZE_BUCKETS) {
        const group = records.filter(r => r.size >= lower && r.size < bucket.max);
        lower = bucket.max;
        if (!group.length) continue;
        lines.push(`${bucket.label} | ${group.length} | ${stats(group.map(r => r.total))} | ${ms(quantile(group.map(r => r.mainThread), 0.95))} | ${dominantSegment(group)}`);
    }

    lines.push('', '## 依 path（筆數多者在前，最多 30 種）');
    lines.push('path | n | size p50 | total p50 / p95 / max | 最大宗段(p50)');
    const byPath = new Map<string, CaptureTimingRecord[]>();
    for (const record of records) {
        const group = byPath.get(record.path);
        if (group) group.push(record); else byPath.set(record.path, [record]);
    }
    const groups = [...byPath.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, 30);
    for (const [path, group] of groups) {
        lines.push(`${path} | ${group.length} | ${kb(quantile(group.map(r => r.size), 0.5))} | ${stats(group.map(r => r.total))} | ${dominantSegment(group)}`);
    }

    lines.push('', '## 最慢 15 筆（各段 ms，依上方順序）');
    lines.push(`time | path | size | total | ${TIMING_SEGMENTS.join(' ')}`);
    const slowest = [...records].sort((a, b) => b.total - a.total).slice(0, 15);
    for (const record of slowest) {
        lines.push(`${meta.formatDateTime(record.at)} | ${record.path} | ${kb(record.size)} | ${ms(record.total)} | ${TIMING_SEGMENTS.map(key => ms(record.seg[key])).join(' ')}`);
    }
    return lines.join('\n');
}
