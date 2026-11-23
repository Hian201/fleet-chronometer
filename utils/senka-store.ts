// 排行榜紀錄（db.senkaRankings）與逐月對帳最終結果（db.senkaMonths）的資料契約、
// 擷取解析與交易式讀寫。純模組（不匯入 Dexie／chrome.*／DOM／ui-i18n），可獨立測試。
//
// ── 並發與寫入契約 ────────────────────────────────────────────────────────────
// senkaRankings 有兩個寫入者：background（看排行榜自動解碼）與 overview（玩家手動登錄／刪除）。
// 兩邊的「讀、比、寫」與刪除都必須包在同一個 IndexedDB `rw` 交易內（`db.transaction('rw',
// db.senkaRankings, ...)`），避免 background 讀完既有列後、寫入前插入了一筆較新的 manual
// 登錄而被較舊的 auto 蓋掉。

import type { KcDb } from './db';
import type { SenkaMonth } from './senka';
import {
    decodeRankingPage, findSelfRankingEntry, rankingRoundAt,
} from './senka-ranking';

export const RANKING_API_PATH = 'api_req_ranking/mxltvkpyuklh';

/** 看排行榜時自動記錄的標準群別榜線名次（聯合 5／一群 20／二群 100／三群 500）。 */
export const SENKA_BORDER_RANKS = [5, 20, 100, 500] as const;
const BORDER_RANK_SET = new Set<number>(SENKA_BORDER_RANKS);

/** 逐月對帳「最終結果」的合法群別值（選回「—」時刪除該列，不存 null）。 */
export const SENKA_FINAL_TIERS = ['top5', 'top20', 'top100', 'top500', 'out'] as const;
export type SenkaFinalTier = (typeof SENKA_FINAL_TIERS)[number];
const FINAL_TIER_SET = new Set<string>(SENKA_FINAL_TIERS);

/**
 * 排行榜觀測與榜線紀錄（db.senkaRankings，schema v18）。
 * 主鍵為自然語意鍵：本人 `self:${publishedAt}`、榜線 `cutoff:${publishedAt}:${rank}`。
 * 僅存名次與戰果，不儲存他人的提督名或留言。
 */
export type SenkaRankingRow =
    | {
        key: string;
        kind: 'self';
        /** 榜單公布時刻（UTC 毫秒，對齊每日 03:00／15:00 JST）。 */
        publishedAt: number;
        score: number;
        rank: number;
        /** 實際觀測到此封包的時刻（UTC 毫秒）。 */
        ts: number;
        /** 來源 raw event id（納入備份 high-water）。 */
        eventId: number;
    }
    | {
        key: string;
        kind: 'cutoff';
        /** 榜單公布時刻（UTC 毫秒，對齊每日 03:00／15:00 JST）。 */
        publishedAt: number;
        rank: number;
        score: number;
        mode: 'auto' | 'manual';
        /** 觀測或手動登錄時刻（UTC 毫秒）。 */
        ts: number;
        /** 僅 mode === 'auto' 時寫入來源 raw event id；manual 不得帶此欄。 */
        eventId?: number;
    };

/**
 * 逐月對帳的玩家自填最終結果（db.senkaMonths，schema v18）。
 * 純使用者輸入，不參照 event id；其餘當月組成與推算總額皆由既有表即時計算，不落地重複保存。
 */
export interface SenkaMonthRow {
    /** 主鍵：作戰月 `YYYY-MM`（例 `'2026-11'`）。 */
    month: string;
    finalTier: SenkaFinalTier;
    updatedAt: number;
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const senkaSelfKey = (publishedAt: number): string => `self:${publishedAt}`;
export const senkaCutoffKey = (publishedAt: number, rank: number): string => `cutoff:${publishedAt}:${rank}`;

export function senkaMonthKey(month: SenkaMonth): string {
    if (!Number.isSafeInteger(month.year) || month.year < 1 || month.year > 9999
        || !Number.isSafeInteger(month.month) || month.month < 1 || month.month > 12) {
        throw new Error(`無效的作戰月：${month.year}-${month.month}`);
    }
    return `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`;
}

export function isSenkaMonthKey(value: unknown): value is string {
    return typeof value === 'string' && MONTH_KEY_RE.test(value);
}

export function isSenkaFinalTier(value: unknown): value is SenkaFinalTier {
    return typeof value === 'string' && FINAL_TIER_SET.has(value);
}

/** 檢查時間戳是否精確對齊每日 03:00／15:00 JST（18:00／06:00 UTC）的榜單公布時刻。 */
export function isAlignedRankingPublishedAt(ts: number): boolean {
    if (!Number.isSafeInteger(ts) || ts < 0) return false;
    return rankingRoundAt(ts)?.publishedAt === ts;
}

/** 從 `api_port/port` 的 `api_data` 取出非空提督名；缺席或非字串回 null。 */
export function readPortNickname(api: unknown): string | null {
    const nick = (api as { api_basic?: { api_nickname?: unknown } | null } | null | undefined)
        ?.api_basic?.api_nickname;
    return typeof nick === 'string' && nick.length > 0 ? nick : null;
}

export interface RankingCaptureEvent {
    id: number;
    ts: number;
    path: string;
    api: unknown;
}

function buildSenkaRankingRows(
    decoded: NonNullable<ReturnType<typeof decodeRankingPage>>,
    publishedAt: number,
    eventId: number,
    ts: number,
    admiralNickname: string | null | undefined,
): SenkaRankingRow[] {
    const byKey = new Map<string, SenkaRankingRow>();
    const selfHit = findSelfRankingEntry(decoded.entries, admiralNickname);
    if (selfHit) {
        const key = senkaSelfKey(publishedAt);
        byKey.set(key, {
            key,
            kind: 'self',
            publishedAt,
            score: selfHit.score,
            rank: selfHit.rank,
            ts,
            eventId,
        });
    }

    for (const entry of decoded.entries) {
        if (!BORDER_RANK_SET.has(entry.rank)) continue;
        const key = senkaCutoffKey(publishedAt, entry.rank);
        byKey.set(key, {
            key,
            kind: 'cutoff',
            publishedAt,
            rank: entry.rank,
            score: entry.score,
            mode: 'auto',
            ts,
            eventId,
        });
    }

    return [...byKey.values()];
}

/**
 * 從單筆 `api_req_ranking/mxltvkpyuklh` 事件取出要寫入 `db.senkaRankings` 的候選列：
 * - 比對提督名命中唯一本人列時產出 `self:${publishedAt}`。
 * - 名次落在標準群別榜線（5／20／100／500）時產出 `cutoff:${publishedAt}:${rank}`。
 *   同頁若出現同名次並列，同主鍵保留最後一筆。
 * - 解碼失敗或參數異常時回傳空陣列，不拋例外。
 */
export function extractSenkaRankingRows(
    event: RankingCaptureEvent,
    admiralNickname: string | null | undefined,
): SenkaRankingRow[] {
    if (event.path !== RANKING_API_PATH) return [];
    if (!Number.isSafeInteger(event.id) || event.id < 1) return [];
    if (!Number.isFinite(event.ts) || event.ts < 0) return [];

    const decoded = decodeRankingPage(event.api);
    if (!decoded) return [];
    const round = rankingRoundAt(event.ts);
    if (!round) return [];

    return buildSenkaRankingRows(decoded, round.publishedAt, event.id, event.ts, admiralNickname);
}

/**
 * 判斷自動擷取的新列是否應覆寫既有列（確保 SW recovery 冪等，且不以較舊自動事件蓋掉較新資料）：
 * - 無既有列 → 寫入。
 * - `self`：較晚觀測（`ts` 較大，或同 `ts` 但 `eventId` 較大）勝出；結算剛過未刷新時重翻頁可自動修正。
 * - `cutoff`（既有為 `auto`）：同 `self` 規則。
 * - `cutoff`（既有為 `manual`）：僅當 `incoming.ts >= existing.ts` 時由新封包事實覆蓋；
 *   若玩家已在自動誤記後手動更正，較早事件的 recovery 重跑不會把手動更正蓋回舊值。
 */
export function shouldReplaceAutoSenkaRanking(
    existing: SenkaRankingRow | undefined,
    incoming: SenkaRankingRow,
): boolean {
    if (!existing) return true;
    if (incoming.kind === 'self') {
        if (existing.kind !== 'self') return true;
        return incoming.ts > existing.ts || (incoming.ts === existing.ts && incoming.eventId > existing.eventId);
    }
    if (incoming.mode !== 'auto') return true;
    if (existing.kind !== 'cutoff') return true;
    if (existing.mode === 'manual') return incoming.ts >= existing.ts;
    const prevEventId = existing.eventId ?? 0;
    const nextEventId = incoming.eventId ?? 0;
    return incoming.ts > existing.ts || (incoming.ts === existing.ts && nextEventId > prevEventId);
}

/** 交易式讀寫所需的最小 DB 介面（純 type-only 參照 KcDb，執行期不匯入 Dexie）。 */
export type SenkaCaptureDbLike = Pick<KcDb, 'senkaRankings' | 'transaction'> & {
    snapshot: { get(path: string): PromiseLike<{ api?: unknown } | undefined> };
};

export type SenkaManualCutoffDbLike = Pick<KcDb, 'senkaRankings' | 'transaction'>;

export interface SenkaMonthTableLike {
    put(row: SenkaMonthRow): PromiseLike<unknown>;
    delete(key: string): PromiseLike<unknown>;
}

/**
 * background.ts postProcessEvent() 呼叫的排行榜自動擷取入口。
 * 先於交易外解碼並讀母港快照取得提督名，再於單一 `rw` 交易內對 `senkaRankings` 執行讀、比、寫，
 * 確保與 overview 手動登錄的並發操作嚴格序列化。
 */
export async function captureSenkaRanking(
    database: SenkaCaptureDbLike,
    event: RankingCaptureEvent,
): Promise<number> {
    if (event.path !== RANKING_API_PATH) return 0;
    if (!Number.isSafeInteger(event.id) || event.id < 1) return 0;
    if (!Number.isFinite(event.ts) || event.ts < 0) return 0;
    // 解碼失敗或榜次無效時直接返回，不開任何 DB 交易。
    const decoded = decodeRankingPage(event.api);
    if (!decoded) return 0;
    const round = rankingRoundAt(event.ts);
    if (!round) return 0;

    const portSnap = await database.snapshot.get('api_port/port');
    const candidates = buildSenkaRankingRows(
        decoded, round.publishedAt, event.id, event.ts, readPortNickname(portSnap?.api),
    );
    if (candidates.length === 0) return 0;

    return database.transaction('rw', database.senkaRankings, async () => {
        const previousRows = await database.senkaRankings.bulkGet(candidates.map(row => row.key));
        const changed: SenkaRankingRow[] = [];
        candidates.forEach((candidate, index) => {
            if (shouldReplaceAutoSenkaRanking(previousRows[index], candidate)) {
                changed.push(candidate);
            }
        });
        if (changed.length > 0) {
            await database.senkaRankings.bulkPut(changed);
        }
        return changed.length;
    });
}

export interface ManualCutoffInput {
    publishedAt: number;
    rank: number;
    score: number;
    ts?: number;
}

/**
 * overview 玩家手動登錄特定榜次的名次榜線。
 * 包在單一 `rw` 交易內寫入，確保與 background 自動擷取依序執行。
 */
export async function saveManualCutoff(
    database: SenkaManualCutoffDbLike,
    input: ManualCutoffInput,
): Promise<Extract<SenkaRankingRow, { kind: 'cutoff' }>> {
    if (!isAlignedRankingPublishedAt(input.publishedAt)) {
        throw new Error(`無效的榜單公布時刻：${input.publishedAt}`);
    }
    if (!Number.isSafeInteger(input.rank) || input.rank < 1) {
        throw new Error(`榜線名次必須是正整數：${input.rank}`);
    }
    if (!Number.isSafeInteger(input.score) || input.score < 0) {
        throw new Error(`榜線分數必須是非負整數：${input.score}`);
    }
    const ts = input.ts ?? Date.now();
    if (!Number.isFinite(ts) || ts < 0) {
        throw new Error(`無效的登錄時刻：${ts}`);
    }

    const row: Extract<SenkaRankingRow, { kind: 'cutoff' }> = {
        key: senkaCutoffKey(input.publishedAt, input.rank),
        kind: 'cutoff',
        publishedAt: input.publishedAt,
        rank: input.rank,
        score: input.score === 0 ? 0 : input.score,
        mode: 'manual',
        ts,
    };

    await database.transaction('rw', database.senkaRankings, async () => {
        await database.senkaRankings.put(row);
    });
    return row;
}

/**
 * overview 刪除玩家手動登錄的榜線。
 * 於單一 `rw` 交易內核對該列確為 `manual` 才刪除，避免競態誤刪剛入庫的自動封包紀錄。
 */
export async function deleteManualCutoff(
    database: SenkaManualCutoffDbLike,
    publishedAt: number,
    rank: number,
): Promise<boolean> {
    if (!isAlignedRankingPublishedAt(publishedAt) || !Number.isSafeInteger(rank) || rank < 1) {
        return false;
    }
    const key = senkaCutoffKey(publishedAt, rank);
    return database.transaction('rw', database.senkaRankings, async () => {
        const existing = await database.senkaRankings.get(key);
        if (!existing || existing.kind !== 'cutoff' || existing.mode !== 'manual') return false;
        await database.senkaRankings.delete(key);
        return true;
    });
}

/**
 * overview 儲存或清除指定作戰月的最終結果；傳入 `null` 時刪除該列。
 */
export async function saveSenkaMonthFinal(
    table: SenkaMonthTableLike,
    month: SenkaMonth | string,
    finalTier: SenkaFinalTier | null,
    updatedAt: number = Date.now(),
): Promise<void> {
    const key = typeof month === 'string' ? month : senkaMonthKey(month);
    if (!isSenkaMonthKey(key)) throw new Error(`無效的作戰月格式：${key}`);
    if (finalTier === null) {
        await table.delete(key);
        return;
    }
    if (!isSenkaFinalTier(finalTier)) throw new Error(`無效的最終結果群別：${String(finalTier)}`);
    if (!Number.isFinite(updatedAt) || updatedAt < 0) throw new Error(`無效的更新時刻：${updatedAt}`);
    await table.put({ month: key, finalTier, updatedAt });
}
