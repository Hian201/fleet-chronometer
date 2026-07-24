// 「遠征紀錄」的期間彙總核心（純函式，無 chrome.*／無 DOM，node 可測）：
// 指定期間內跑了哪些遠征、各幾次、總共拿回多少資源。UI 殼在
// entrypoints/overview/sections/exped-log.ts。
//
// ── 為什麼這份彙總放在遠征紀錄、不放資源紀錄（別搬家）───────────────────
// 資源紀錄的一切消長都是**兩個時刻的餘額差分**（封包只給餘額）；遠征收入則是
// **逐筆事件的獲得量**（`api_get_material` 是封包直接給的收入，精確且可加總）。
// 兩者放同一張表，使用者必然會拿「這期間遠征賺了 12 萬燃料」去對「這期間燃料只
// 增加 3 萬」——中間還隔著出擊消耗、補給、建造、任務獎勵，本來就對不起來。
// 缺席規則也相反：期間內沒有餘額取樣時資源紀錄必須寫「不可考」，遠征收入卻照樣
// 算得出來（`db.expeditions` 獨立於事件裁剪、永久保留）。
//
// ── 兩個誠實性前提 ──────────────────────────────────────────────────────
//   1. **回航道具（items）的欄位語意未經真封包驗證**（見 CLAUDE.md 待辦 8，
//      `api_get_item1/2` 目前是 best-effort），故一律以 `id × count` 原樣彙總，
//      不翻譯成「螺絲 N 個」，也不併入四資源小計。
//   2. **彙總的母集合是「紀錄中的」遠征**，不是遊戲的完整歷史。`db.expeditions`
//      由面板的 EventProjector 投影，面板長期沒開、raw event 又已被 M6 裁剪的
//      那段期間會永久缺席。UI 必須如實說明，不可暗示這是完整帳。
import type { ExpeditionRow } from './db';
import { rowsToCsv } from './csv';

/** 遠征回收的四項資材（`api_get_material` 順序：燃／彈／鋼／鋁）。 */
export const EXPED_MAT_COUNT = 4;

export interface ExpeditionTotals {
    /** 期間內的遠征次數（含失敗——「跑了幾次」與「成功幾次」是兩個問題）。 */
    count: number;
    /** `api_clear_result >= 1`，含大成功。 */
    success: number;
    /** `api_clear_result === 2`。 */
    great: number;
    /** `api_clear_result === 0`。 */
    fail: number;
    /** 四項資材加總（長度恆為 4，缺欄補 0——這裡的 0 是「這次遠征沒給」的事實）。 */
    resources: number[];
    /** 回航道具依 id 彙總，依 id 升冪。語意未驗證，只加總不解讀。 */
    items: { id: number; count: number }[];
}

/** 一種遠征一列（彙總表的資料列）。 */
export interface ExpeditionStat extends ExpeditionTotals {
    missionId: number;
    /** 遠征名（`api_quest_name` 原文）；同 id 出現多種名稱時取最新一筆。 */
    name: string;
    /** 期間內最後一次執行的時刻。 */
    lastTs: number;
}

export type StatSortKey =
    | 'mission' | 'name' | 'count' | 'great' | 'fail' | 'last'
    | 'fuel' | 'ammo' | 'steel' | 'bauxite' | 'total';

const MAT_SORT: Record<'fuel' | 'ammo' | 'steel' | 'bauxite', number> = {
    fuel: 0, ammo: 1, steel: 2, bauxite: 3,
};

const emptyTotals = (): ExpeditionTotals => ({
    count: 0, success: 0, great: 0, fail: 0,
    resources: new Array(EXPED_MAT_COUNT).fill(0),
    items: [],
});

/**
 * 期間篩選（皆為含端點；null＝該端不設限）。
 *
 * 呼叫端傳進來的是「本地日期的 00:00:00 / 23:59:59.999」——`ExpeditionRow.ts` 是絕對
 * 時間戳，玩家心裡的「7 月 20 日」則是本地日期，換算留在 UI 層（同 drop-log 分區）。
 */
export function filterByPeriod(rows: ExpeditionRow[], from: number | null, to: number | null): ExpeditionRow[] {
    return rows.filter(row => (from == null || row.ts >= from) && (to == null || row.ts <= to));
}

/** 把一批遠征紀錄加總成一組總計。 */
export function summarize(rows: ExpeditionRow[]): ExpeditionTotals {
    const totals = emptyTotals();
    const items = new Map<number, number>();
    for (const row of rows) {
        totals.count++;
        if (row.result >= 1) totals.success++;
        if (row.result === 2) totals.great++;
        if (row.result === 0) totals.fail++;
        for (let i = 0; i < EXPED_MAT_COUNT; i++) {
            const value = row.resources?.[i];
            // 非有限數字一律當 0（缺欄）——不讓一筆壞資料把整個期間的小計變成 NaN。
            if (Number.isFinite(value)) totals.resources[i] += value as number;
        }
        for (const item of row.items ?? []) {
            if (!Number.isFinite(item?.id) || !Number.isFinite(item?.count)) continue;
            items.set(item.id, (items.get(item.id) ?? 0) + item.count);
        }
    }
    totals.items = [...items.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => a.id - b.id);
    return totals;
}

/**
 * 依遠征編號分組。
 *
 * **分組鍵用 `missionId` 不用 `name`**：名稱會隨 UI 語言與遊戲改版變動，編號不會；
 * 但 `missionId` 為 0（舊紀錄解不出編號）時只剩名稱可辨識，故那批以名稱分組，
 * 不把互不相干的遠征全部塞進同一列 `#0`。
 */
export function groupByMission(rows: ExpeditionRow[]): ExpeditionStat[] {
    const groups = new Map<string, ExpeditionRow[]>();
    for (const row of rows) {
        const key = row.missionId ? `#${row.missionId}` : `name:${row.name}`;
        const list = groups.get(key);
        if (list) list.push(row); else groups.set(key, [row]);
    }
    const stats: ExpeditionStat[] = [];
    for (const list of groups.values()) {
        // 名稱取最新一筆：遊戲改名時新名字才是玩家現在看得懂的那個
        const latest = list.reduce((a, b) => (b.ts > a.ts ? b : a));
        stats.push({
            missionId: latest.missionId,
            name: latest.name,
            lastTs: latest.ts,
            ...summarize(list),
        });
    }
    return stats;
}

/** 彙總表排序。缺值（名稱空白）一律排最後，不論升降冪——同 ship-roster 的缺席規則。 */
export function sortStats(stats: ExpeditionStat[], key: StatSortKey, desc: boolean): ExpeditionStat[] {
    const sign = desc ? -1 : 1;
    const value = (s: ExpeditionStat): number => {
        if (key === 'total') return s.resources.reduce((sum, n) => sum + n, 0);
        if (key in MAT_SORT) return s.resources[MAT_SORT[key as keyof typeof MAT_SORT]];
        if (key === 'mission') return s.missionId;
        if (key === 'last') return s.lastTs;
        return s[key as 'count' | 'great' | 'fail'];
    };
    return [...stats].sort((a, b) => {
        if (key === 'name') {
            if (!a.name !== !b.name) return a.name ? -1 : 1;   // 無名稱恆排最後
            return sign * a.name.localeCompare(b.name);
        }
        // 同值時以編號當穩定的第二鍵，避免每次重繪順序亂跳
        return sign * (value(a) - value(b)) || a.missionId - b.missionId;
    });
}

/**
 * 彙總表 CSV。
 *
 * 這裡是**唯讀報表的匯出**（同 ships／equipment 分區的規則：匯出跟著顯示走），
 * 不是可重新匯入的資料交換格式（那是 drop-log／build-log 的固定欄位集合），故表頭
 * 直接用目前語言的欄名。
 */
export function statsCsv(
    stats: ExpeditionStat[],
    header: { mission: string; name: string; count: string; great: string; fail: string; mats: string[]; last: string },
): string {
    const rows: string[][] = [[
        header.mission, header.name, header.count, header.great, header.fail,
        ...header.mats.slice(0, EXPED_MAT_COUNT), header.last,
    ]];
    for (const stat of stats) {
        rows.push([
            stat.missionId ? String(stat.missionId) : '',
            stat.name,
            String(stat.count), String(stat.great), String(stat.fail),
            ...stat.resources.map(String),
            new Date(stat.lastTs).toISOString(),
        ]);
    }
    return rowsToCsv(rows);
}
