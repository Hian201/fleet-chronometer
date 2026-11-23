// 戰果介面顯示用的純函式摘要與格式化（零 chrome.*／DOM／db 依賴）。
// 注意：本模組匯入 ui-i18n 與 quest-senka，絕不可被 state.ts、background 或 content script 匯入，
// 以免打包器把整份字典或任務資料帶進非 UI 入口。

import { formatShortDateTime } from './date-format';
import type { Lang } from './gamedata-i18n';
import { questSenkaCatalogEntry } from './quest-senka';
import {
    eoSenkaForMonth, formatSenkaRemaining, questSenkaForMonth, regularSenkaForMonth,
    senkaDeadlines, senkaMonthOf, todayRegularSenka,
    type EoSenkaResult, type ExpReading, type QuestSenkaItem, type QuestSenkaLookup,
    type QuestSenkaResult, type RegularSenkaResult, type SenkaDeadlineInfo, type SenkaMonth,
} from './senka';
import type { SenkaMonthData } from './senka-readings';
import { tFor } from './ui-i18n';

/** 1a 階段普通戰果摘要（含本月累積、今日新增與截止倒數）。 */
export interface SenkaRegularSummary {
    now: number;
    month: SenkaMonth;
    regular: RegularSenkaResult;
    today: number | null;
    deadlines: SenkaDeadlineInfo;
}

/** 1b 階段已觀測戰果摘要（含普通戰果、EO 擊破與任務戰果，不含繼承分）。 */
export interface SenkaObservedSummary extends SenkaRegularSummary {
    eo: EoSenkaResult;
    quest: QuestSenkaResult;
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

/** 依當下時間組裝 1b 已觀測戰果摘要（普通＋EO＋任務，不含繼承分）。 */
export function buildObservedSenkaSummary(
    data: SenkaMonthData,
    now: number,
    questLookup: QuestSenkaLookup = questSenkaCatalogEntry,
): SenkaObservedSummary {
    const base = buildRegularSenkaSummary(data.readings, now);
    return {
        ...base,
        eo: eoSenkaForMonth(data.sorties, base.month),
        quest: questSenkaForMonth(data.questClaims, base.month, questLookup),
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

/** 格式化單值或 `[min, max]` 近似戰果；上下界相等或取整重合時收斂為單值，0 不加 ≈。 */
function formatApproxSenkaBounds(min: number, max: number, exactPoints: boolean, lang: Lang): string {
    if (exactPoints) {
        const v = Math.round(min) || 0;
        return v === 0 ? '0' : `≈${formatSenkaInt(v, lang)}`;
    }
    const lo = Math.floor(min) || 0;
    const hi = Math.ceil(max) || 0;
    if (lo === hi) return lo === 0 ? '0' : `≈${formatSenkaInt(lo, lang)}`;
    return `≈${formatSenkaInt(lo, lang)}${tFor(lang, 'senka.rangeDash')}${formatSenkaInt(hi, lang)}`;
}

/** 格式化本月普通戰果主數值（exact / range / 缺資料回傳 '—'）。 */
export function formatRegularSenkaValue(regular: RegularSenkaResult, lang: Lang): string {
    if (regular.status === 'exact') {
        return formatApproxSenkaBounds(regular.points, regular.points, true, lang);
    }
    if (regular.status === 'range') {
        return formatApproxSenkaBounds(regular.min, regular.max, false, lang);
    }
    return '—';
}

/** 格式化 1b 已觀測戰果總額（exact / range 加計 EO 與任務；缺起點或異常回傳 '—'）。 */
export function formatObservedSenkaValue(
    summary: Pick<SenkaObservedSummary, 'regular' | 'eo' | 'quest'>,
    lang: Lang,
): string {
    const { regular, eo, quest } = summary;
    const specialMin = eo.total + quest.min;
    const specialMax = eo.total + quest.max;
    if (regular.status === 'exact') {
        return formatApproxSenkaBounds(
            regular.points + specialMin,
            regular.points + specialMax,
            quest.min === quest.max,
            lang,
        );
    }
    if (regular.status === 'range') {
        return formatApproxSenkaBounds(
            regular.min + specialMin,
            regular.max + specialMax,
            false,
            lang,
        );
    }
    return '—';
}

/** 格式化帶正負號的戰果變動值（如今日新增、觀測期間新增；0 不加 ≈ 與正負號）。 */
export function formatSignedSenka(n: number, lang: Lang): string {
    const v = Math.round(n) || 0;
    if (v === 0) return '0';
    return v > 0 ? `≈+${formatSenkaInt(v, lang)}` : `≈−${formatSenkaInt(-v, lang)}`;
}

/** 格式化 1b `no-start` 的觀測期間新增總額（普通觀測增量＋EO＋任務區間）。 */
export function formatObservedGainValue(
    summary: Pick<SenkaObservedSummary, 'regular' | 'eo' | 'quest'>,
    lang: Lang,
): string {
    const { regular, eo, quest } = summary;
    const base = 'observed' in regular ? regular.observed : 0;
    const min = base + eo.total + quest.min;
    const max = base + eo.total + quest.max;
    if (min === max) return formatSignedSenka(min, lang);
    const lo = Math.floor(min) || 0;
    const hi = Math.ceil(max) || 0;
    if (lo === hi) return formatSignedSenka(lo, lang);
    const fmtBound = (v: number) => (v >= 0 ? `+${formatSenkaInt(v, lang)}` : `−${formatSenkaInt(-v, lang)}`);
    return `≈${fmtBound(lo)}${tFor(lang, 'senka.rangeDash')}${fmtBound(hi)}`;
}

/** 格式化組成列中的普通戰果部分（不含 `≈`；缺起點／無資料／異常回傳 `'—'`）。 */
export function formatRegularPartValue(regular: RegularSenkaResult, lang: Lang): string {
    if (regular.status === 'exact') return formatSenkaInt(regular.points, lang);
    if (regular.status === 'range') {
        const lo = Math.floor(regular.min) || 0;
        const hi = Math.ceil(regular.max) || 0;
        if (lo === hi) return formatSenkaInt(lo, lang);
        return `${formatSenkaInt(lo, lang)}${tFor(lang, 'senka.rangeDash')}${formatSenkaInt(hi, lang)}`;
    }
    return '—';
}

/** 格式化組成列中的任務戰果合計（含選擇報酬時顯示區間）。 */
export function formatQuestSenkaValue(quest: Pick<QuestSenkaResult, 'min' | 'max'>, lang: Lang): string {
    if (quest.min === quest.max) return formatSenkaInt(quest.min, lang);
    return `${formatSenkaInt(quest.min, lang)}${tFor(lang, 'senka.rangeDash')}${formatSenkaInt(quest.max, lang)}`;
}

/** 格式化任務戰果清單中單筆任務的戰果欄（例 `+300`、`0～+800`）。 */
export function formatQuestItemPoints(item: Pick<QuestSenkaItem, 'fixed' | 'choice'>, lang: Lang): string {
    if (item.choice === 0) return `+${formatSenkaInt(item.fixed, lang)}`;
    const dash = tFor(lang, 'senka.rangeDash');
    if (item.fixed === 0) return `0${dash}+${formatSenkaInt(item.choice, lang)}`;
    return `+${formatSenkaInt(item.fixed, lang)}${dash}+${formatSenkaInt(item.fixed + item.choice, lang)}`;
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
