// 改修工廠日程的查詢（純函式，無 chrome.*／DOM，node 可測）。
//
// 規則：明石／明石改當第一艦隊旗艦才能用改修工廠；可改修的裝備由「第一艦隊二番艦」與曜日決定。
// 資料表 AKASHI_SCHEDULE 由 tools/akashi-schedule/generate.py 產生（週位元 bit0=週日 … bit6=週六）。
import type { FactoryLogRow } from './db';
import { AKASHI_HELPER_BASE, AKASHI_SCHEDULE, AKASHI_SOLO, AKASHI_UNCONFIRMED } from './akashi-schedule-data';

const JST_OFFSET_MS = 9 * 3600_000;

/** JST 曜日：0=週日…6=週六。改修清單在 JST 00:00 換表（與任務的 05:00 不同）。 */
export function jstWeekday(ts: number): number {
    return new Date(ts + JST_OFFSET_MS).getUTCDay();
}

export interface AkashiHelper { masterId: number; owned: boolean }
export interface AkashiTodayRow {
    gearMst: number;
    /** 玩家持有的同型裝備數（含已裝備者） */
    held: number;
    /** 當天明石單獨即可 */
    solo: boolean;
    /** 當天可用的二番艦（owned=玩家持有該形態）；solo 時可為空陣列 */
    helpers: AkashiHelper[];
}

const SCHEDULE = new Map(AKASHI_SCHEDULE);
const NONE: ReadonlySet<number> = new Set();
const HELPER_BASE = new Map(AKASHI_HELPER_BASE);

function dayEntry(pairs: readonly (readonly [number, number])[], weekday: number, owned: ReadonlySet<number>) {
    const open = pairs.filter(([, bits]) => bits >> weekday & 1);
    return {
        solo: open.some(([ship]) => ship === AKASHI_SOLO),
        helpers: open.filter(([ship]) => ship !== AKASHI_SOLO).map(([ship]) => ({ masterId: ship, owned: owned.has(ship) })),
    };
}

/** 今天可改修、且玩家持有該裝備的清單。ownedShipMasterIds 用來標 helper 的 owned。 */
export function akashiToday(weekday: number, heldGearCounts: ReadonlyMap<number, number>,
    ownedShipMasterIds: ReadonlySet<number>): AkashiTodayRow[] {
    const rows: AkashiTodayRow[] = [];
    for (const [gearMst, pairs] of AKASHI_SCHEDULE) {
        const held = heldGearCounts.get(gearMst) ?? 0;
        if (held <= 0) continue;
        const day = dayEntry(pairs, weekday, ownedShipMasterIds);
        if (day.solo || day.helpers.length) rows.push({ gearMst, held, ...day });
    }
    return rows;
}

/** 某件裝備一週的可改修狀況（給總括的七天表）；索引 0=週日。表內沒有該裝備時七天皆空。 */
export function akashiWeek(gearMst: number, ownedShipMasterIds: ReadonlySet<number> = NONE): { solo: boolean; helpers: AkashiHelper[] }[] {
    const pairs = SCHEDULE.get(gearMst) ?? [];
    return Array.from({ length: 7 }, (_, weekday) => dayEntry(pairs, weekday, ownedShipMasterIds));
}

/**
 * 把某艘艦放第一艦隊二番艦時，當天「多出」的可改修裝備（只列玩家持有者）。
 * 明石單獨本來就能改修的裝備不算「多出」，故排除。shipMasterId 要是表內的二番艦形態（含改造形態）。
 */
export function akashiByHelper(weekday: number, heldGearCounts: ReadonlyMap<number, number>,
    shipMasterId: number): { gearMst: number; held: number }[] {
    const rows: { gearMst: number; held: number }[] = [];
    if (shipMasterId === AKASHI_SOLO) return rows;
    for (const [gearMst, pairs] of AKASHI_SCHEDULE) {
        const held = heldGearCounts.get(gearMst) ?? 0;
        if (held <= 0) continue;
        const open = pairs.filter(([, bits]) => bits >> weekday & 1);
        if (!open.some(([ship]) => ship === AKASHI_SOLO) && open.some(([ship]) => ship === shipMasterId)) rows.push({ gearMst, held });
    }
    return rows;
}

/**
 * 玩家持有、但整張表都查不到的裝備 master id（UI 顯示「尚未收錄」）。
 * 查不到＝多半根本不能改修（表內沒有這件裝備），不是資料漏收；曜日未確認的裝備（akashiUnconfirmed）也不在 SCHEDULE 內，所以會一併出現在這裡，要區分時先用 akashiUnconfirmed 扣掉。
 */
export function akashiUncovered(heldGearCounts: ReadonlyMap<number, number>): number[] {
    return [...heldGearCounts].filter(([mst, count]) => count > 0 && !SCHEDULE.has(mst))
        .map(([mst]) => mst).sort((a, b) => a - b);
}

/** 玩家持有、表內有這件裝備但曜日旗標尚未確認的裝備 master id（不等於「不能改修」）。 */
export function akashiUnconfirmed(heldGearCounts: ReadonlyMap<number, number>): number[] {
    return AKASHI_UNCONFIRMED.filter(mst => (heldGearCounts.get(mst) ?? 0) > 0);
}

/** 二番艦所屬改造鏈的起點 master id；表內沒出現過的艦回傳自己。 */
export function helperBase(shipMasterId: number): number {
    return HELPER_BASE.get(shipMasterId) ?? shipMasterId;
}

export interface ImproveStat { gearMst: number; attempts: number; successes: number; certain: number; lastTs: number }

/**
 * 自己的改修紀錄彙總（吃 db.factory 的 kind==='improve' 列，不碰 DB）。
 * 沒有裝備 id（gearMst 缺值或 0）或沒有成敗結果（success 缺值）的列不計入，缺值不當成失敗。
 * 排序：嘗試次數多者在前，同次數取最近的在前，再依裝備 id。
 */
export function improveStats(rows: readonly Pick<FactoryLogRow, 'kind' | 'ts' | 'gearMst' | 'success' | 'certain'>[]): ImproveStat[] {
    const stats = new Map<number, ImproveStat>();
    for (const row of rows) {
        if (row.kind !== 'improve' || !row.gearMst || typeof row.success !== 'boolean') continue;
        let stat = stats.get(row.gearMst);
        if (!stat) stats.set(row.gearMst, stat = { gearMst: row.gearMst, attempts: 0, successes: 0, certain: 0, lastTs: row.ts });
        stat.attempts++;
        if (row.success) stat.successes++;
        if (row.certain) stat.certain++;
        stat.lastTs = Math.max(stat.lastTs, row.ts);
    }
    return [...stats.values()].sort((a, b) => b.attempts - a.attempts || b.lastTs - a.lastTs || a.gearMst - b.gearMst);
}
