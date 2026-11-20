// 道具捕撈的「自訂換海域提醒」（純函式＋localStorage 讀寫，無 chrome.*／DOM 依賴的核心可在 node 測）。
// 規格見 docs/saury-plan.md §4.2 末項。
//
// 玩家自己設定「同一大海域 X 小時內捕獲 N 條」；達到就通知一次。這只是玩家的條件，
// 不代表漁場已枯竭——工具不提供預設門檻，也不把任何數字當成遊戲機制。
//
// ── 不連發 ─────────────────────────────────────────────────────────────
// 每個大海域記上次通知時刻。之後只有條件「中途斷過」（時窗內條數掉到 N 以下）再回到 N 以上才
// 再通知。條數只會在某條魚滑出時窗時減少，所以只要檢查上次通知後每個滑出時刻的條數，
// 不必依賴「每次結算都有評估」——面板關著、時間自己流過去的情況也算得對。
import type { SortieLogRow } from './db';
import { isCatchRow } from './item-catch-stats';
import { parseMapCode } from './sortie-detail';

export interface CatchAlertRule {
    enabled: boolean;
    itemId: number;
    /** 時窗（小時）與條數門檻；玩家自填，沒有預設值。 */
    hours: number;
    count: number;
}

const HOUR = 3_600_000;
const MAX_HOURS = 24 * 7;
const MAX_COUNT = 999;
const FIRED_TTL = 7 * 24 * HOUR;
const RULE_KEY = 'kc-catch-alert';
const FIRED_KEY = 'kc-catch-alert-fired';

const validInt = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= max;

/** 解析儲存值；格式不符一律當成未設定。 */
export function parseCatchAlertRule(raw: unknown): CatchAlertRule | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!validInt(r.itemId, Number.MAX_SAFE_INTEGER) || !validInt(r.hours, MAX_HOURS) || !validInt(r.count, MAX_COUNT)) return null;
    return { enabled: r.enabled === true, itemId: r.itemId, hours: r.hours, count: r.count };
}

export function isValidAlertNumber(v: number, kind: 'hours' | 'count'): boolean {
    return validInt(v, kind === 'hours' ? MAX_HOURS : MAX_COUNT);
}

/** 規則換了（道具、時窗或門檻）就重新起算，舊的通知紀錄作廢。 */
const ruleKey = (r: CatchAlertRule) => `${r.itemId}/${r.hours}/${r.count}`;

/** 時窗 (t - hours, t] 內的捕獲條數。catches 依時間排序。 */
function caughtAt(catches: readonly { ts: number; n: number }[], t: number, windowMs: number): number {
    let sum = 0;
    for (const c of catches) if (c.ts > t - windowMs && c.ts <= t) sum += c.n;
    return sum;
}

/** 各大海域目前時窗內的捕獲條數（只列 >0 的）。 */
export function catchesInWindow(rows: readonly SortieLogRow[], rule: CatchAlertRule, now: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const row of rows) {
        if (!isCatchRow(row) || !Array.isArray(row.useItemDrops) || row.ts <= now - rule.hours * HOUR || row.ts > now) continue;
        const n = row.useItemDrops.filter(id => id === rule.itemId).length;
        if (!n) continue;
        const area = parseMapCode(row.map).world;
        out.set(area, (out.get(area) ?? 0) + n);
    }
    return out;
}

/**
 * 這次該通知的大海域。`lastFired` 是各大海域上次通知的時刻。
 * rows 至少要涵蓋 `min(lastFired) - hours` 之後的列，否則「中途斷過」會判斷不到。
 */
export function catchAlertsToFire(
    rows: readonly SortieLogRow[], rule: CatchAlertRule, now: number, lastFired: ReadonlyMap<number, number>,
): { area: number; caught: number }[] {
    if (!rule.enabled) return [];
    const windowMs = rule.hours * HOUR;
    const byArea = new Map<number, { ts: number; n: number }[]>();
    for (const row of [...rows].sort((a, b) => a.ts - b.ts || a.eventId - b.eventId)) {
        if (!isCatchRow(row) || !Array.isArray(row.useItemDrops) || row.ts > now) continue;
        const n = row.useItemDrops.filter(id => id === rule.itemId).length;
        if (!n) continue;
        const area = parseMapCode(row.map).world;
        const list = byArea.get(area);
        if (list) list.push({ ts: row.ts, n }); else byArea.set(area, [{ ts: row.ts, n }]);
    }
    const out: { area: number; caught: number }[] = [];
    for (const [area, catches] of byArea) {
        const caught = caughtAt(catches, now, windowMs);
        if (caught < rule.count) continue;
        const fired = lastFired.get(area);
        // 上次通知後，每條魚滑出時窗的時刻都看一次；任何一刻掉到門檻以下就算離開過條件。
        // 超過 FIRED_TTL 的通知紀錄不追查（catchAlertQueryFrom 也只讀到那時），當成已離開。
        const stayed = fired !== undefined && fired >= now - FIRED_TTL && catches.every(c => {
            const exit = c.ts + windowMs;
            return exit <= fired || exit > now || caughtAt(catches, exit, windowMs) >= rule.count;
        });
        if (!stayed) out.push({ area, caught });
    }
    return out.sort((a, b) => a.area - b.area);
}

// ── localStorage（panel 與 overview 同源共享；讀寫失敗一律當成未設定，不發通知） ──

export function loadCatchAlertRule(): CatchAlertRule | null {
    try { return parseCatchAlertRule(JSON.parse(localStorage.getItem(RULE_KEY) ?? 'null')); } catch { return null; }
}

export function saveCatchAlertRule(rule: CatchAlertRule): void {
    try { localStorage.setItem(RULE_KEY, JSON.stringify(rule)); } catch { /* 隱私模式等：本次不保存 */ }
}

/** 上次通知時刻；規則換過就回空。 */
export function loadCatchAlertFired(rule: CatchAlertRule): Map<number, number> {
    try {
        const raw = JSON.parse(localStorage.getItem(FIRED_KEY) ?? 'null');
        if (raw?.rule !== ruleKey(rule) || !raw.areas || typeof raw.areas !== 'object') return new Map();
        return new Map(Object.entries(raw.areas as Record<string, unknown>)
            .filter((e): e is [string, number] => Number.isSafeInteger(Number(e[0])) && Number.isFinite(e[1]))
            .map(([k, v]) => [Number(k), v]));
    } catch {
        return new Map();
    }
}

export function saveCatchAlertFired(rule: CatchAlertRule, fired: ReadonlyMap<number, number>): void {
    try {
        localStorage.setItem(FIRED_KEY, JSON.stringify({ rule: ruleKey(rule), areas: Object.fromEntries(fired) }));
    } catch { /* 寫不進去時下次可能重發一次；寧可重發也不漏發 */ }
}

/** 要讀多早以後的列才足以判斷「中途斷過」。上次通知太久以前（超過 7 天）就只看時窗。 */
export function catchAlertQueryFrom(rule: CatchAlertRule, now: number, fired: ReadonlyMap<number, number>): number {
    const windowMs = rule.hours * HOUR;
    const oldest = Math.min(now, ...fired.values());
    return Math.max(oldest, now - FIRED_TTL) - windowMs;
}
