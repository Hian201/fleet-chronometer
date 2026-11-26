// 普通戰果、作戰月窗口與截止倒數計算。純函式，無 chrome.*／DOM／ui-i18n 依賴。
//
// 規則與公式依據（wikiwiki「称号・戦果」）：
// - 作戰月界：每月最後一日 22:00 JST（含前月最後一日 22:00 JST，不含當月最後一日 22:00 JST）。
//   將時間戳加上 11 小時（UTC+9 再加 2 小時）後取 UTC 年月，即可將「前月末 22:00 JST」對齊到
//   該作戰月 1 日 00:00 UTC，自動處理大小月、平閏年與跨年。
// - 戰果任務有效截止：當月最後一日 14:00 JST（月界往前 8 小時）。
// - 戰果排行榜更新：每日 03:00 JST（18:00 UTC）與 15:00 JST（06:00 UTC）。
// - 普通戰果換算：獲得提督經驗值 × 7 ÷ 10,000（保留浮點精確值，不提前四捨五入）。
// - 戰果計算用「今日」換日：依日本時間 05:00 換日（重用 questCycleWindow('daily', now)），
//   並以本月作戰起始夾住，避免月初或跨月時刻混入前月經驗。

import { questCycleWindow } from './quest-cycle';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;
const MONTH_SHIFT_MS = 11 * HOUR_MS;
const QUEST_CLOSE_BEFORE_END_MS = 8 * HOUR_MS;
const LAST_DAY_SPAN_MS = 22 * HOUR_MS;
const HALF_DAY_MS = 12 * HOUR_MS;
const RANKING_PHASE_MS = 6 * HOUR_MS;
const SENKA_EXP_NUMERATOR = 7;
const SENKA_EXP_DENOMINATOR = 10_000;

/** EO（擴張作戰）海域固定戰果表（依顯示順序）。 */
export const EO_SENKA_MAPS = [
    { map: '1-5', points: 75 },
    { map: '1-6', points: 75 },
    { map: '2-5', points: 100 },
    { map: '3-5', points: 150 },
    { map: '7-5', points: 170 },
    { map: '4-5', points: 180 },
    { map: '5-5', points: 200 },
    { map: '5-6', points: 225 },
    { map: '6-5', points: 250 },
] as const;

export type EoMapId = (typeof EO_SENKA_MAPS)[number]['map'];
const EO_MAP_POINTS = new Map<string, number>(EO_SENKA_MAPS.map(entry => [entry.map, entry.points]));

/** 通用 UTC 毫秒時間窗（`[start, end)`）。 */
export interface SenkaTimeRange {
    start: number;
    end: number;
}

/** EO 戰果計算所需的出擊摘要輸入。 */
export interface EoSortieInput {
    ts: number;
    map: string;
    cleared?: boolean;
    catchOnly?: boolean;
    /** battleresult `api_get_exmap_rate` 或終點 `api_req_map/next` `api_get_eo_rate` 解析為正整數時的封包戰果值。 */
    exmapRate?: number;
    /** 寫入 `cleared` 的規則來源；`'battle'` 且無 `exmapRate` 時為中間段斬殺，不計入整圖 EO 戰果。 */
    clearedBy?: 'battle' | 'mapinfo';
}

/** `api_get_member/mapinfo` 快照輸入（用於補齊非本會話內轉變的當月 EO 擊破）。 */
export interface MapinfoSnapshotInput {
    ts: number;
    api: unknown;
}

/** 單張 EO 海域於指定作戰月的擊破狀態與戰果。 */
export interface EoSenkaItem {
    map: string;
    points: number;
    cleared: boolean;
    clearedAt: number | null;
}

/** 指定作戰月的 EO 戰果彙總結果。 */
export interface EoSenkaResult {
    total: number;
    clearedCount: number;
    mapCount: number;
    items: EoSenkaItem[];
}

/** 任務戰果計算所需的領獎紀錄輸入。 */
export interface QuestClaimInput {
    eventId?: number;
    questNo: number;
    ts: number;
}

/** 任務目錄戰果查表項（純函式邊界，不綁定特定資料檔）。 */
export interface QuestSenkaLookupEntry {
    reward: { fixed: number; choice: number };
    limited: boolean;
    limitedWindow?: { start: string; end: string | null };
}

export type QuestSenkaLookup = (questNo: number) => QuestSenkaLookupEntry | null;

/** 單筆計入當月戰果的任務領獎項目。 */
export interface QuestSenkaItem {
    eventId?: number;
    questNo: number;
    ts: number;
    fixed: number;
    choice: number;
}

/** 指定作戰月的任務戰果彙總結果。 */
export interface QuestSenkaResult {
    fixed: number;
    choiceMax: number;
    min: number;
    max: number;
    items: QuestSenkaItem[];
}

/** 作戰月識別（`month` 為 `1..12`）。 */
export interface SenkaMonth {
    year: number;
    month: number;
}

/** 作戰月的 UTC 毫秒時間窗（`[start, end)`）與戰果任務截止時刻。 */
export interface SenkaMonthWindow extends SenkaMonth {
    start: number;
    end: number;
    questCloseAt: number;
}

/** 提督經驗值觀測讀數。 */
export interface ExpReading {
    ts: number;
    exp?: number | null;
}

/** 單月普通戰果估算結果。 */
export type RegularSenkaResult =
    | { status: 'exact'; points: number; observed: number }
    | { status: 'range'; min: number; max: number; observed: number }
    | { status: 'no-start'; observed: number }
    | { status: 'no-data' }
    | { status: 'anomaly' };

/** 戰果截止與排行榜更新倒數資訊。 */
export interface SenkaDeadlineInfo {
    month: SenkaMonth;
    isLastDay: boolean;
    closeAt: number;
    closeRemainingMs: number;
    questCloseAt: number;
    questClosed: boolean;
    questRemainingMs: number;
    nextUpdateAt: number;
    nextUpdateRemainingMs: number;
}

interface ValidExpReading {
    ts: number;
    exp: number;
}

/** 過濾有效經驗值讀數並依時間戳升冪穩定排序（不改動原陣列）。 */
function normalizeReadings(readings: readonly ExpReading[]): ValidExpReading[] {
    const valid: ValidExpReading[] = [];
    for (const r of readings) {
        if (Number.isFinite(r.ts) && typeof r.exp === 'number' && Number.isSafeInteger(r.exp) && r.exp >= 0) {
            valid.push({ ts: r.ts, exp: r.exp });
        }
    }
    valid.sort((a, b) => a.ts - b.ts);
    return valid;
}

/** 檢查已依時間排序的讀數序列是否存在經驗值倒退。 */
function hasExpRegression(readings: readonly ValidExpReading[]): boolean {
    for (let i = 1; i < readings.length; i++) {
        if (readings[i].exp < readings[i - 1].exp) return true;
    }
    return false;
}

/** 將提督經驗值增量換算為普通戰果（保留浮點精確值，0 明確回傳 +0）。 */
export function expToRegularSenka(expDelta: number): number {
    if (expDelta === 0) return 0;
    return (expDelta * SENKA_EXP_NUMERATOR) / SENKA_EXP_DENOMINATOR;
}

/** 取得 UTC 毫秒時間戳所屬的戰果作戰月。 */
export function senkaMonthOf(ts: number): SenkaMonth {
    const d = new Date(ts + MONTH_SHIFT_MS);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** 取得指定作戰月的前一個作戰月。 */
export function prevSenkaMonth(m: SenkaMonth): SenkaMonth {
    return m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 };
}

/** 計算指定作戰月的起訖（`[start, end)`）與任務戰果截止時刻。 */
export function senkaMonthWindow(m: SenkaMonth): SenkaMonthWindow {
    const start = Date.UTC(m.year, m.month - 1, 1) - MONTH_SHIFT_MS;
    const end = Date.UTC(m.year, m.month, 1) - MONTH_SHIFT_MS;
    const questCloseAt = end - QUEST_CLOSE_BEFORE_END_MS;
    return { year: m.year, month: m.month, start, end, questCloseAt };
}

/**
 * 計算指定作戰月的 EO 戰果有效時間窗（`[start, end)`）：
 * 當月 1 日 00:00 JST 至當月末 22:00 JST（月末 22:00～23:59 JST 擊破不計入當月亦不計入下月）。
 */
export function eoMonthWindow(m: SenkaMonth): SenkaTimeRange {
    const start = Date.UTC(m.year, m.month - 1, 1) - JST_OFFSET_MS;
    const end = senkaMonthWindow(m).end;
    return { start, end };
}

/**
 * 計算指定作戰月的任務戰果有效時間窗（`[start, end)`）：
 * 前月末 14:00 JST 至當月末 14:00 JST。
 */
export function questSenkaMonthWindow(m: SenkaMonth): SenkaTimeRange {
    const start = senkaMonthWindow(prevSenkaMonth(m)).questCloseAt;
    const end = senkaMonthWindow(m).questCloseAt;
    return { start, end };
}

/** 從提督經驗值讀數計算指定作戰月的普通戰果與不確定狀態。 */
export function regularSenkaForMonth(readings: readonly ExpReading[], month: SenkaMonth): RegularSenkaResult {
    const sorted = normalizeReadings(readings);
    const win = senkaMonthWindow(month);
    const prevWin = senkaMonthWindow(prevSenkaMonth(month));

    const inMonth: ValidExpReading[] = [];
    let eBefore: ValidExpReading | null = null;
    for (const r of sorted) {
        if (r.ts < win.start) {
            eBefore = r;
        } else if (r.ts < win.end) {
            inMonth.push(r);
        } else {
            break;
        }
    }

    if (inMonth.length === 0) return { status: 'no-data' };
    if (hasExpRegression(inMonth)) return { status: 'anomaly' };

    const first = inMonth[0];
    const last = inMonth[inMonth.length - 1];
    const observed = expToRegularSenka(last.exp - first.exp);

    if (eBefore === null) return { status: 'no-start', observed };
    if (first.exp < eBefore.exp) return { status: 'anomaly' };
    if (first.exp === eBefore.exp) return { status: 'exact', points: observed, observed };

    if (eBefore.ts >= prevWin.start && eBefore.ts < win.start) {
        return {
            status: 'range',
            min: observed,
            max: expToRegularSenka(last.exp - eBefore.exp),
            observed,
        };
    }

    return { status: 'no-start', observed };
}

/** 計算今日（日本時間 05:00 換日，不混入前月經驗）至今的普通戰果新增量。 */
export function todayRegularSenka(readings: readonly ExpReading[], now: number): number | null {
    if (!Number.isFinite(now)) return null;

    const win = senkaMonthWindow(senkaMonthOf(now));
    const day = questCycleWindow('daily', now);
    if (!day) return null;

    // 確保月初 1 日 00:00–04:59 JST 與月末 22:00–23:59 JST 不把上月經驗混入本月今日新增
    const effectiveDayStart = Math.max(day.start, win.start);

    const sorted = normalizeReadings(readings);
    const inMonthSoFar: ValidExpReading[] = [];
    let eBefore: ValidExpReading | null = null;
    for (const r of sorted) {
        if (r.ts < win.start) {
            eBefore = r;
        } else if (r.ts < win.end && r.ts <= now) {
            inMonthSoFar.push(r);
        } else if (r.ts >= win.end || r.ts > now) {
            break;
        }
    }

    if (inMonthSoFar.length === 0) return null;
    if (hasExpRegression(inMonthSoFar)) return null;
    if (eBefore && inMonthSoFar[0].exp < eBefore.exp) return null;

    let beforeInMonth: ValidExpReading | null = null;
    const inToday: ValidExpReading[] = [];
    for (const r of inMonthSoFar) {
        if (r.ts < effectiveDayStart) {
            beforeInMonth = r;
        } else {
            inToday.push(r);
        }
    }

    if (inToday.length === 0) return 0;

    const base = beforeInMonth ?? (eBefore && eBefore.exp === inToday[0].exp ? eBefore : null);
    if (!base) return null;

    return expToRegularSenka(inToday[inToday.length - 1].exp - base.exp);
}

/** 計算目前作戰月的月界截止、任務截止與下次排行榜更新時間資訊。 */
export function senkaDeadlines(now: number): SenkaDeadlineInfo {
    const month = senkaMonthOf(now);
    const win = senkaMonthWindow(month);
    const isLastDay = now >= win.end - LAST_DAY_SPAN_MS && now < win.end;
    const closeAt = win.end;
    const closeRemainingMs = Math.max(0, win.end - now);
    const questCloseAt = win.questCloseAt;
    const questClosed = now >= win.questCloseAt;
    const questRemainingMs = Math.max(0, win.questCloseAt - now);
    const nextUpdateAt = (Math.floor((now - RANKING_PHASE_MS) / HALF_DAY_MS) + 1) * HALF_DAY_MS + RANKING_PHASE_MS;
    const nextUpdateRemainingMs = nextUpdateAt - now;

    return {
        month,
        isLastDay,
        closeAt,
        closeRemainingMs,
        questCloseAt,
        questClosed,
        questRemainingMs,
        nextUpdateAt,
        nextUpdateRemainingMs,
    };
}

/** 將剩餘毫秒數格式化為 `H:MM`（無條件進位至分鐘；非正數或非有限數回傳 `'0:00'`）。 */
export function formatSenkaRemaining(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    const mins = Math.ceil(ms / 60_000);
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * 計算指定作戰月的 EO 擊破戰果：
 * - 僅計入 `[eoMonthWindow.start, eoMonthWindow.end)` 內 `cleared === true` 且非 `catchOnly` 的紀錄。
 * - `clearedBy === 'battle'` 的列只有帶正整數 `exmapRate` 才計入（不退回查表，避免 7-5／5-6 中間段斬殺誤算整圖戰果）；
 *   舊列（`clearedBy === undefined`）、`clearedBy === 'mapinfo'` 與 mapinfo 快照才退回查 `EO_SENKA_MAPS`。
 * - 同一海域同一作戰月只計一次：帶 `exmapRate` 的戰鬥列優先於查表列／較晚的 mapinfo 快照，同等級取最新 `ts`。
 * - 封包 `exmapRate` 優先於固定表分數（表內調分與表外新 EO 皆以封包值為準；表外 EO 附於 `items` 尾端）。
 */
export function eoSenkaForMonth(sorties: readonly EoSortieInput[], month: SenkaMonth): EoSenkaResult {
    const win = eoMonthWindow(month);
    const winners = new Map<string, { ts: number; points: number; fromPacket: boolean }>();

    for (const row of sorties) {
        if (row.cleared !== true || row.catchOnly) continue;
        if (!Number.isFinite(row.ts) || row.ts < win.start || row.ts >= win.end) continue;

        const hasPacketRate = typeof row.exmapRate === 'number'
            && Number.isSafeInteger(row.exmapRate) && row.exmapRate > 0;
        let points: number;
        if (hasPacketRate) {
            points = row.exmapRate!;
        } else {
            // 中間段防護：戰鬥當下判定的段落斬殺沒有 exmapRate，不得退回查固定表。
            if (row.clearedBy === 'battle') continue;
            const tablePoints = EO_MAP_POINTS.get(row.map);
            if (tablePoints === undefined) continue;
            points = tablePoints;
        }

        const prev = winners.get(row.map);
        const supersedes = !prev
            || (hasPacketRate && !prev.fromPacket)
            || (hasPacketRate === prev.fromPacket && row.ts > prev.ts);
        if (supersedes) {
            winners.set(row.map, { ts: row.ts, points, fromPacket: hasPacketRate });
        }
    }

    let total = 0;
    let clearedCount = 0;
    const items: EoSenkaItem[] = EO_SENKA_MAPS.map(({ map, points: tablePoints }) => {
        const winEntry = winners.get(map);
        const cleared = winEntry !== undefined;
        const points = winEntry ? winEntry.points : tablePoints;
        if (cleared) {
            total += points;
            clearedCount += 1;
        }
        return { map, points, cleared, clearedAt: winEntry?.ts ?? null };
    });

    const extraMaps = [...winners.entries()]
        .filter(([map]) => !EO_MAP_POINTS.has(map))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    for (const [map, entry] of extraMaps) {
        total += entry.points;
        clearedCount += 1;
        items.push({ map, points: entry.points, cleared: true, clearedAt: entry.ts });
    }

    return { total, clearedCount, mapCount: items.length, items };
}

/**
 * 從單筆 `api_get_member/mapinfo` 快照擷取 `api_cleared === 1` 的 EO 海域紀錄，
 * 供 `eoSenkaForMonth()` 依時間窗篩選與去重，補齊跨會話、裁剪前或無 Boss 戰（如 1-6）之當月已擊破海域。
 */
export function eoClearsFromMapinfoSnapshot(snapshot: MapinfoSnapshotInput | null | undefined): EoSortieInput[] {
    if (!snapshot || !Number.isFinite(snapshot.ts)) return [];
    const mapInfo = (snapshot.api as { api_map_info?: unknown } | null | undefined)?.api_map_info;
    if (!Array.isArray(mapInfo)) return [];

    const out: EoSortieInput[] = [];
    for (const raw of mapInfo) {
        const m = raw as { api_id?: unknown; api_cleared?: unknown } | null;
        if (!m) continue;
        const apiId = m.api_id;
        if (typeof apiId !== 'number' || !Number.isSafeInteger(apiId) || apiId < 10) continue;
        const map = `${Math.floor(apiId / 10)}-${apiId % 10}`;
        if (!EO_MAP_POINTS.has(map)) continue;
        if (m.api_cleared === 1 || m.api_cleared === '1') {
            out.push({ ts: snapshot.ts, map, cleared: true });
        }
    }
    return out;
}

/** 檢查時間戳是否落在期間限定任務的日本時間實裝期間 `[start 00:00, end 翌日 00:00)` 內。 */
export function isWithinLimitedQuestWindow(
    ts: number,
    window: { start: string; end: string | null } | undefined,
): boolean {
    if (!window || !Number.isFinite(ts)) return false;
    const startMs = Date.parse(`${window.start}T00:00:00+09:00`);
    if (!Number.isFinite(startMs) || ts < startMs) return false;
    if (window.end !== null) {
        const endMs = Date.parse(`${window.end}T00:00:00+09:00`) + DAY_MS;
        if (!Number.isFinite(endMs) || ts >= endMs) return false;
    }
    return true;
}

/**
 * 計算指定作戰月的任務戰果：
 * 依 `[questSenkaMonthWindow.start, questSenkaMonthWindow.end)` 篩選領獎紀錄並排除逾期的期間限定編號；
 * 僅以 `eventId` 去重，同一任務編號於換季月不同 `eventId` 可多次計入。
 */
export function questSenkaForMonth(
    claims: readonly QuestClaimInput[],
    month: SenkaMonth,
    lookup: QuestSenkaLookup,
): QuestSenkaResult {
    const win = questSenkaMonthWindow(month);
    const seenEventIds = new Set<number>();
    const items: QuestSenkaItem[] = [];

    for (const claim of claims) {
        if (!Number.isFinite(claim.ts) || claim.ts < win.start || claim.ts >= win.end) continue;
        if (claim.eventId !== undefined) {
            if (seenEventIds.has(claim.eventId)) continue;
            seenEventIds.add(claim.eventId);
        }
        const entry = lookup(claim.questNo);
        if (!entry) continue;
        if (entry.limited && !isWithinLimitedQuestWindow(claim.ts, entry.limitedWindow)) continue;
        const { fixed, choice } = entry.reward;
        if (fixed <= 0 && choice <= 0) continue;
        items.push({
            ...(claim.eventId !== undefined ? { eventId: claim.eventId } : {}),
            questNo: claim.questNo,
            ts: claim.ts,
            fixed,
            choice,
        });
    }

    items.sort((a, b) => a.ts - b.ts || a.questNo - b.questNo);

    let fixed = 0;
    let choiceMax = 0;
    for (const item of items) {
        fixed += item.fixed;
        choiceMax += item.choice;
    }

    return {
        fixed,
        choiceMax,
        min: fixed,
        max: fixed + choiceMax,
        items,
    };
}
