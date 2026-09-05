// 活動海域的年份／季節年表。
//
// 純資料＋純函式，無 chrome.* 與 DOM，可獨立編譯用 node 驗證（CLAUDE.md 設計原則 4）。
//
// ── 為什麼需要這張表 ──────────────────────────────────────────────────
// **遊戲 API 完全不提供活動的西元年與季節**。封包只有 `api_maparea_id`（本專案的
// world）與當次 start2 的作戰標題；舊活動結束後標題會從 master 消失。玩家辨識活動
// 的說法是「2026夏季」，不是 area 編號或一長串日文作戰名。
//
// ── 為什麼不能從出擊時間戳反推 ────────────────────────────────────────
// 冬季活動常跨 12／1 月，梅雨夏季、初春、初秋、小型活動也不是「該月＝該季」。
// 從紀錄日期猜季節會在跨年邊界說錯話，故表外一律不猜，退回既有的 master 名／
// `活動海域 #id`。
//
// ── 鍵為什麼是 world（maparea id）────────────────────────────────────
// 一次活動一個 maparea，關卡是同一個 world 底下的 mapnum。年表是活動層級的屬性，
// 不是關卡層級。本專案 `map-edge-letters` 的活動圖從 world 31 起；更早的活動不在
// 表內，匯入舊紀錄時走 fallback，不補假季節。
//
// ── 維護方式 ────────────────────────────────────────────────────────────
// 新活動開圖、start2 出現新的 `api_maparea_id` 時在下表補一列。季節用下方
// `EventSeason` 列舉，特殊檔期（初春／初秋／梅雨夏季／小型）不得硬套春夏秋冬。

export type EventSeason =
    | 'winter'
    | 'spring'
    | 'summer'
    | 'autumn'
    | 'earlySpring'
    | 'earlyFall'
    | 'rainySummer'
    | 'mini';

export interface EventTerm {
    year: number;
    season: EventSeason;
}

const EVENT_TERMS: Readonly<Record<number, EventTerm>> = {
    31: { year: 2015, season: 'summer' },
    32: { year: 2015, season: 'autumn' },
    33: { year: 2016, season: 'winter' },
    34: { year: 2016, season: 'spring' },
    35: { year: 2016, season: 'summer' },
    36: { year: 2016, season: 'autumn' },
    37: { year: 2017, season: 'winter' },
    38: { year: 2017, season: 'spring' },
    39: { year: 2017, season: 'summer' },
    40: { year: 2017, season: 'autumn' },
    41: { year: 2018, season: 'winter' },
    42: { year: 2018, season: 'earlyFall' },
    43: { year: 2019, season: 'winter' },
    44: { year: 2019, season: 'spring' },
    45: { year: 2019, season: 'summer' },
    46: { year: 2019, season: 'autumn' },
    47: { year: 2020, season: 'mini' },
    48: { year: 2020, season: 'rainySummer' },
    49: { year: 2020, season: 'autumn' },
    50: { year: 2021, season: 'spring' },
    51: { year: 2021, season: 'summer' },
    52: { year: 2021, season: 'autumn' },
    53: { year: 2022, season: 'winter' },
    54: { year: 2022, season: 'spring' },
    55: { year: 2022, season: 'summer' },
    56: { year: 2023, season: 'earlySpring' },
    57: { year: 2023, season: 'summer' },
    58: { year: 2024, season: 'earlySpring' },
    59: { year: 2024, season: 'summer' },
    60: { year: 2025, season: 'spring' },
    61: { year: 2025, season: 'autumn' },
    62: { year: 2026, season: 'summer' },
};

export function eventTermOf(world: number): EventTerm | null {
    return EVENT_TERMS[world] ?? null;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 年表命中則回「2026夏季」這類說法；表外回 null，呼叫端再走 master／#id。 */
export function eventTermLabel(world: number, translate: Translate): string | null {
    const term = EVENT_TERMS[world];
    if (!term) return null;
    return translate('event.term', {
        year: term.year,
        season: translate(`event.season.${term.season}`),
    });
}

export function eventTermSeasonLabel(world: number, translate: Translate): { year: number; seasonLabel: string } | null {
    const term = EVENT_TERMS[world];
    if (!term) return null;
    return { year: term.year, seasonLabel: translate(`event.season.${term.season}`) };
}
