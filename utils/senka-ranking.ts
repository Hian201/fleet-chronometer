// 戰果排行榜封包解碼與榜次推算純函式（無 chrome.*／DOM／ui-i18n 依賴）。
//
// 依據與限制：
// - 解碼驗證樣本：samples/ranking-page-1.json、samples/ranking-page-51.json、
//   samples/ranking-page-147.json（30 列已與遊戲截圖逐列核對一致，三頁玩家係數皆為 44）。
// - 演算法依 clean-room 重寫自 poi-plugin-senka-calc（lib/magic.js，MIT License，
//   登錄於 THIRD-PARTY-NOTICES.md），未複製第三方程式碼。
// - 排行榜回應中語意未證實的欄位（api_itslcqtmrxtf、api_pbgkfylkbjuy、api_pcumlrymlujh）
//   一律不使用。

import { senkaMonthOf, senkaMonthWindow, type SenkaMonth } from './senka';

const HOUR_MS = 60 * 60 * 1000;
const HALF_DAY_MS = 12 * HOUR_MS;
/** 06:00 UTC（15:00 JST）與 18:00 UTC（03:00 JST）為每日兩次榜單公布時點。 */
const RANKING_PHASE_MS = 6 * HOUR_MS;
/** 月末最後一次公開榜（15:00 JST）距作戰月界（22:00 JST）相差 7 小時。 */
const FINAL_ROUND_BEFORE_END_MS = 7 * HOUR_MS;

/** 排行榜名次（`rank % 13`）對應的混淆除數。 */
export const RANKING_RANK_FACTORS = [
    8931, 1201, 1156, 5061, 4569, 4732, 3779, 4568, 5695, 4619, 4912, 5669, 6586,
] as const;

/** 解除係數後扣除的固定偏移量。 */
export const RANKING_SCORE_OFFSET = 91;

/** 單列解碼後的排行榜紀錄。 */
export interface DecodedRankingEntry {
    rank: number;
    nickname: string;
    score: number;
}

/** 整頁解碼後的排行榜資料。 */
export interface DecodedRankingPage {
    page: number | null;
    playerFactor: number;
    entries: DecodedRankingEntry[];
}

/** 依擷取時間推定的排行榜榜次資訊。 */
export interface RankingRoundInfo {
    month: SenkaMonth;
    publishedAt: number;
    tallyAt: number;
    isFinalRound: boolean;
}

function gcd(a: number, b: number): number {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y !== 0) {
        const t = x % y;
        x = y;
        y = t;
    }
    return x;
}

/**
 * 解碼已剝離 `api_data` 外殼的 `api_req_ranking/mxltvkpyuklh` 回應。
 * 頁內至少需 2 列方可求得唯一的玩家係數（全列同分導致商數比為 1 時亦無法還原）；
 * 任一列出現非正整數、無法整除或負分數皆回傳 `null` 而不記錄。
 */
export function decodeRankingPage(apiData: unknown): DecodedRankingPage | null {
    if (typeof apiData !== 'object' || apiData === null) return null;
    const rawPage = (apiData as { api_disp_page?: unknown }).api_disp_page;
    const rawList = (apiData as { api_list?: unknown }).api_list;
    if (!Array.isArray(rawList) || rawList.length < 2) return null;

    const page = typeof rawPage === 'number' && Number.isSafeInteger(rawPage) && rawPage >= 1
        ? rawPage
        : null;

    const rows: { rank: number; nickname: string; quotient: number }[] = [];
    for (const raw of rawList) {
        if (typeof raw !== 'object' || raw === null) return null;
        const entry = raw as {
            api_mxltvkpyuklh?: unknown;
            api_wuhnhojjxmke?: unknown;
            api_mtjmdcwtvhdr?: unknown;
        };
        const rank = entry.api_mxltvkpyuklh;
        const obfuscated = entry.api_wuhnhojjxmke;
        if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank < 1) return null;
        if (typeof obfuscated !== 'number' || !Number.isSafeInteger(obfuscated) || obfuscated < 1) return null;

        const rankFactor = RANKING_RANK_FACTORS[rank % 13];
        if (obfuscated % rankFactor !== 0) return null;
        const quotient = obfuscated / rankFactor;
        if (!Number.isSafeInteger(quotient) || quotient < 1) return null;

        const nickname = typeof entry.api_mtjmdcwtvhdr === 'string' ? entry.api_mtjmdcwtvhdr : '';
        rows.push({ rank, nickname, quotient });
    }

    let playerFactor = rows[0].quotient;
    for (let i = 1; i < rows.length; i++) {
        playerFactor = gcd(playerFactor, rows[i].quotient);
    }
    if (!Number.isSafeInteger(playerFactor) || playerFactor < 1) return null;

    const entries: DecodedRankingEntry[] = [];
    for (const row of rows) {
        const score = row.quotient / playerFactor - RANKING_SCORE_OFFSET;
        // 全列同分時 quotient / playerFactor === 1，score 為 -90，於此自然擋下。
        if (!Number.isSafeInteger(score) || score < 0) return null;
        entries.push({ rank: row.rank, nickname: row.nickname, score });
    }

    return { page, playerFactor, entries };
}

/**
 * 以提督名從已解碼的排行榜頁找出本人那一列。
 * 空字串不比對（避免誤中去識別樣本）；同頁出現複數同名提督時回傳 `null`。
 */
export function findSelfRankingEntry(
    entries: readonly DecodedRankingEntry[],
    admiralNickname: string | null | undefined,
): DecodedRankingEntry | null {
    if (typeof admiralNickname !== 'string' || admiralNickname.length === 0) return null;
    let hit: DecodedRankingEntry | null = null;
    for (const entry of entries) {
        if (entry.nickname !== admiralNickname) continue;
        if (hit !== null) return null;
        hit = entry;
    }
    return hit;
}

/**
 * 依擷取時刻（UTC 毫秒）推定最近一次已公布的榜單所屬作戰月、公布時刻與資料結算時刻。
 * 結算區間（02:00–02:59 JST、14:00–14:59 JST）及月末 22:00–次月 1 日 02:59 JST 皆歸入前一次公布榜。
 */
export function rankingRoundAt(ts: number): RankingRoundInfo | null {
    if (!Number.isFinite(ts)) return null;
    const publishedAt = Math.floor((ts - RANKING_PHASE_MS) / HALF_DAY_MS) * HALF_DAY_MS + RANKING_PHASE_MS;
    const tallyAt = publishedAt - HOUR_MS;
    const month = senkaMonthOf(publishedAt);
    const isFinalRound = publishedAt === senkaMonthWindow(month).end - FINAL_ROUND_BEFORE_END_MS;
    return { month, publishedAt, tallyAt, isFinalRound };
}
