// 從 db.resources、db.sorties、db.questObserved、db.snapshot 與 db.senkaRankings
// 查詢指定作戰月計算戰果所需的資料。

import type { db } from './db';
import {
    eoClearsFromMapinfoSnapshot, eoMonthWindow, questSenkaMonthWindow, senkaMonthWindow,
    type EoSortieInput, type ExpReading, type QuestClaimInput, type SenkaMonth,
} from './senka';
import type { CutoffObservation, SelfRankingObservation } from './senka-calibration';
import type { SenkaRankingRow } from './senka-store';

/** 指定作戰月計算已觀測戰果（普通＋EO＋任務）所需的查詢結果。 */
export interface SenkaMonthData {
    readings: ExpReading[];
    sorties: EoSortieInput[];
    questClaims: QuestClaimInput[];
}

/** 指定作戰月的排行榜本人紀錄與榜線紀錄查詢結果。 */
export interface SenkaMonthRankings {
    selfRankings: SelfRankingObservation[];
    cutoffs: CutoffObservation[];
    rows: SenkaRankingRow[];
}

const hasValidExp = (exp: unknown): exp is number =>
    typeof exp === 'number' && Number.isSafeInteger(exp) && exp >= 0;

/**
 * 讀取指定作戰月計算普通戰果需要的讀數：
 * 1) 月界前最後一筆帶有效 `exp` 的紀錄（作為月初基準 `E_before`，涵蓋跨月長休），以及
 * 2) 落於 `[win.start, win.end)` 區間內的所有帶有效 `exp` 紀錄。
 * 無 `exp` 的紀錄（例如 `api_get_member/material`）會被忽略。
 */
export async function loadSenkaExpReadings(
    resources: typeof db.resources,
    month: SenkaMonth,
): Promise<ExpReading[]> {
    const win = senkaMonthWindow(month);
    const [eBefore, inMonth] = await Promise.all([
        resources
            .where('ts')
            .below(win.start)
            .reverse()
            .filter(r => hasValidExp(r.exp))
            .first(),
        resources
            .where('ts')
            .between(win.start, win.end, true, false)
            .toArray(),
    ]);
    const readings: ExpReading[] = [];
    if (eBefore && hasValidExp(eBefore.exp)) {
        readings.push({ ts: eBefore.ts, exp: eBefore.exp });
    }
    for (const r of inMonth) {
        if (hasValidExp(r.exp)) readings.push({ ts: r.ts, exp: r.exp });
    }
    return readings;
}

/** 一次讀取指定作戰月計算普通戰果、EO 擊破與任務領獎所需的 IndexedDB 資料列。 */
export async function loadSenkaMonthData(
    tables: Pick<typeof db, 'resources' | 'sorties' | 'questObserved' | 'snapshot'>,
    month: SenkaMonth,
): Promise<SenkaMonthData> {
    const eoWin = eoMonthWindow(month);
    const questWin = questSenkaMonthWindow(month);

    const [readings, clearedSorties, questClaims, mapinfoSnap] = await Promise.all([
        loadSenkaExpReadings(tables.resources, month),
        tables.sorties
            .where('ts')
            .between(eoWin.start, eoWin.end, true, false)
            .filter(r => r.cleared === true && !r.catchOnly)
            .toArray(),
        tables.questObserved
            .where('ts')
            .between(questWin.start, questWin.end, true, false)
            .toArray(),
        tables.snapshot.get('api_get_member/mapinfo'),
    ]);

    const snapshotClears = mapinfoSnap && mapinfoSnap.ts >= eoWin.start && mapinfoSnap.ts < eoWin.end
        ? eoClearsFromMapinfoSnapshot(mapinfoSnap)
        : [];

    return {
        readings,
        sorties: [...clearedSorties, ...snapshotClears],
        questClaims,
    };
}

/**
 * 查詢指定作戰月的所有排行榜本人紀錄與榜線紀錄。
 * 作戰月 `[win.start, win.end)`（前月末 22:00 JST～當月末 22:00 JST）精確涵蓋該月
 * 第一次公開榜（1 日 03:00 JST）至最後一次公開榜（月末 15:00 JST）。
 */
export async function loadSenkaRankingsForMonth(
    table: typeof db.senkaRankings,
    month: SenkaMonth,
): Promise<SenkaMonthRankings> {
    const win = senkaMonthWindow(month);
    const rows = await table
        .where('publishedAt')
        .between(win.start, win.end, true, false)
        .toArray();
    rows.sort((a, b) => a.publishedAt - b.publishedAt || a.key.localeCompare(b.key));

    const selfRankings: SelfRankingObservation[] = [];
    const cutoffs: CutoffObservation[] = [];
    for (const row of rows) {
        if (row.kind === 'self') selfRankings.push(row);
        else cutoffs.push(row);
    }
    return { selfRankings, cutoffs, rows };
}
