// 普通戰果介面顯示用的純函式摘要與格式化（零 chrome.*／DOM／db 依賴）。
// 注意：本模組匯入 ui-i18n，絕不可被 state.ts、background 或 content script 匯入，
// 以免打包器把整份字典帶進非 UI 入口。

import { formatShortDateTime } from './date-format';
import type { Lang } from './gamedata-i18n';
import {
    formatSenkaRemaining, regularSenkaForMonth, senkaDeadlines, senkaMonthOf, todayRegularSenka,
    type ExpReading, type RegularSenkaResult, type SenkaDeadlineInfo, type SenkaMonth,
} from './senka';
import { tFor } from './ui-i18n';

/** 1a 階段普通戰果摘要（含本月累積、今日新增與截止倒數）。 */
export interface SenkaRegularSummary {
    now: number;
    month: SenkaMonth;
    regular: RegularSenkaResult;
    today: number | null;
    deadlines: SenkaDeadlineInfo;
}

const intFormatters = new Map<Lang, Intl.NumberFormat>();
function intFormatter(lang: Lang): Intl.NumberFormat {
    let fmt = intFormatters.get(lang);
    if (!fmt) {
        fmt = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
        intFormatters.set(lang, fmt);
    }
    return fmt;
}

/** 依當下時間從提督經驗值讀數組裝 1a 普通戰果摘要。 */
export function buildRegularSenkaSummary(readings: readonly ExpReading[], now: number): SenkaRegularSummary {
    const month = senkaMonthOf(now);
    return {
        now,
        month,
        regular: regularSenkaForMonth(readings, month),
        today: todayRegularSenka(readings, now),
        deadlines: senkaDeadlines(now),
    };
}

/** 依顯示語言格式化名次（英文帶序數後綴，繁中與日文回傳純數字字串）。 */
export function formatSenkaRank(rank: number, lang: Lang): string {
    if (lang !== 'en') return String(rank);
    const abs = Math.abs(rank);
    const mod100 = abs % 100;
    const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][abs % 10] ?? 'th');
    return `${rank}${suffix}`;
}

/** 將 UTC 毫秒格式化為本機時區「M/D HH:MM」（不依賴 toLocaleString，見 design-guidelines §2.6）。 */
export function formatSenkaTimestamp(ts: number): string {
    return formatShortDateTime(ts);
}

/** 四捨五入為整數並依語言加上千分位（將 -0 正規化為 0）。 */
export function formatSenkaInt(n: number, lang: Lang): string {
    return intFormatter(lang).format(Math.round(n) || 0);
}

/** 格式化本月普通戰果主數值（exact / range / 缺資料回傳 '—'）。 */
export function formatRegularSenkaValue(regular: RegularSenkaResult, lang: Lang): string {
    if (regular.status === 'exact') {
        const v = Math.round(regular.points) || 0;
        return v === 0 ? '0' : `≈${formatSenkaInt(v, lang)}`;
    }
    if (regular.status === 'range') {
        const lo = Math.floor(regular.min) || 0;
        const hi = Math.ceil(regular.max) || 0;
        if (lo === hi) return lo === 0 ? '0' : `≈${formatSenkaInt(lo, lang)}`;
        return `≈${formatSenkaInt(lo, lang)}${tFor(lang, 'senka.rangeDash')}${formatSenkaInt(hi, lang)}`;
    }
    return '—';
}

/** 格式化帶正負號的戰果變動值（如今日新增、觀測期間新增；0 不加 ≈ 與正負號）。 */
export function formatSignedSenka(n: number, lang: Lang): string {
    const v = Math.round(n) || 0;
    if (v === 0) return '0';
    return v > 0 ? `≈+${formatSenkaInt(v, lang)}` : `≈−${formatSenkaInt(-v, lang)}`;
}

/**
 * 依是否為月次作戰最後一天產生截止或下次榜單更新的倒數文字行。
 * 1a 階段尚未計入任務戰果，預設不顯示任務戰果截止行；1b 起傳入 `includeQuest: true` 才一併顯示。
 */
export function senkaDeadlineLines(
    deadlines: SenkaDeadlineInfo,
    lang: Lang,
    opts?: { includeQuest?: boolean },
): string[] {
    if (!deadlines.isLastDay) {
        return [
            tFor(lang, 'senka.nextUpdate', {
                time: formatSenkaTimestamp(deadlines.nextUpdateAt),
                left: formatSenkaRemaining(deadlines.nextUpdateRemainingMs),
            }),
        ];
    }
    const cutoffLine = tFor(lang, 'senka.cutoff', {
        time: formatSenkaTimestamp(deadlines.closeAt),
        left: formatSenkaRemaining(deadlines.closeRemainingMs),
    });
    if (!opts?.includeQuest) return [cutoffLine];
    const questLine = deadlines.questClosed
        ? tFor(lang, 'senka.questClosed', { time: formatSenkaTimestamp(deadlines.questCloseAt) })
        : tFor(lang, 'senka.questOpen', {
            time: formatSenkaTimestamp(deadlines.questCloseAt),
            left: formatSenkaRemaining(deadlines.questRemainingMs),
        });
    return [cutoffLine, questLine];
}
