// 秋刀魚祭的「爆雷誤帶提醒」判定（純函式，無 chrome.*／DOM）。規格見 docs/saury-plan.md §4.3。
//
// 官方只說「避免爆雷漁」，沒有點名裝備；社群整理把遊戲分類「爆雷」（api_type[2] === 15）整類算進去，
// 但沒有逐件實測。清單取 samples/start2-master.json 中分類 15 的玩家裝備（§4.3.1 表），以 master id
// 判定、不比對名稱；只靠整類涵蓋的也一樣提醒，因為漏報比多報傷害大。清單外的新裝備不會被提醒，
// 每年開撈後依 §4.3.1 核對 master 再補。
import type { ShipView } from './state';

const GRACE = 72 * 3_600_000;

export interface SeasonSignals {
    now: number;
    /** 季節起點（catch-season.ts 的季別開始）與營運公布的結束時刻（未公布為 null）。 */
    start: number;
    end: number | null;
    /** 目前持有的秋刀魚；未觀測為 null。 */
    held: number | null;
    /** 最近一次捕獲秋刀魚的時刻；沒有為 null。 */
    lastCatchTs: number | null;
}

/**
 * 提醒只在秋刀魚祭期間出現，結束後不靠發新版也會自己消失：
 * 已過起點、未過公布的結束時刻，且下列任一成立——
 *   · 手上有秋刀魚（活動結束維護時會被清除，見 docs/saury-plan.md S10）；
 *   · 起點後 72 小時內（還沒撈到第一條魚的空窗）；
 *   · 72 小時內有捕獲（魚全換光、持有變 0 的情況）。
 */
export function depthChargeSeasonActive(s: SeasonSignals): boolean {
    if (s.now < s.start || (s.end !== null && s.now >= s.end)) return false;
    return (s.held ?? 0) > 0 || s.now < s.start + GRACE || (s.lastCatchTs !== null && s.now - s.lastCatchTs < GRACE);
}

export const DEPTH_CHARGE_MST: ReadonlySet<number> = new Set([
    44, 45, 226, 227, 287, 288, 346, 347, 377, 378, 439, 472, 488, 569,
]);

export interface DepthChargeHit {
    /** 艦在艦隊中的 0-based 位置。 */
    index: number;
    /** 這艘帶的爆雷類裝備名（一般槽與補強增設都算，依槽位順序）。 */
    gears: string[];
}

/** 艦隊中帶爆雷類裝備的艦；沒有就回空陣列。 */
export function fleetDepthCharges(ships: readonly ShipView[]): DepthChargeHit[] {
    const out: DepthChargeHit[] = [];
    ships.forEach((s, index) => {
        const gears = [...s.gears, s.exGear].filter(g => g && DEPTH_CHARGE_MST.has(g.mst)).map(g => g!.name);
        if (gears.length) out.push({ index, gears });
    });
    return out;
}

// ── 提醒開關（panel 與 overview 同源共享 localStorage） ─────────────────────
// 預設打開。關閉時記下「哪一季、從哪裡關的」：季節起點換了（明年）就自動回到打開，
// 不會因為今年關掉而整個功能消失；來源讓總括說明「已從面板關閉」。
// 讀不到或格式不符一律當成打開：漏報比多報傷害大。
const DC_OFF_KEY = 'kc-dc-reminder-off';

export type DcReminderOff = { season: number; from: 'panel' | 'overview' };

export function parseDcReminderOff(raw: unknown, season: number): DcReminderOff | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r.season !== season || (r.from !== 'panel' && r.from !== 'overview')) return null;
    return { season, from: r.from };
}

/** 本季是否已關閉提醒；null＝打開。 */
export function loadDcReminderOff(season: number): DcReminderOff | null {
    try { return parseDcReminderOff(JSON.parse(localStorage.getItem(DC_OFF_KEY) ?? 'null'), season); } catch { return null; }
}

export function saveDcReminder(on: boolean, season: number, from: DcReminderOff['from']): void {
    try {
        if (on) localStorage.removeItem(DC_OFF_KEY);
        else localStorage.setItem(DC_OFF_KEY, JSON.stringify({ season, from }));
    } catch { /* 隱私模式等：本次不保存 */ }
}

/** 其他已開頁面改了開關時通知（storage 事件只在非發動變更的頁面觸發）。 */
export function onDcReminderChange(cb: () => void, signal?: AbortSignal): void {
    window.addEventListener('storage', event => { if (event.key === DC_OFF_KEY) cb(); }, { signal });
}
