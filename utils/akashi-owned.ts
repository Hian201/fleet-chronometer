// 改修日程要用的「玩家持有」彙總（純函式，無 chrome.*／DOM）。
// 面板「今日改修」與情報總括「改修日程」共用，避免兩邊各算一份。
import type { GameState } from './state';
import { AKASHI_SOURCE } from './akashi-schedule-data';
import { helperBase, helperDepth, type AkashiHelper } from './akashi-schedule';
import { formatDate } from './date-format';

/** 玩家持有的裝備 master id → 件數（含已裝備者）。裝備庫尚未取得時為空。 */
export function heldGearCounts(state: Pick<GameState, 'slotItems'>): Map<number, number> {
    const counts = new Map<number, number>();
    for (const item of state.slotItems.values()) counts.set(item.mst, (counts.get(item.mst) ?? 0) + 1);
    return counts;
}

/** 玩家持有的艦 master id（以形態計：持有改二不代表持有改）。 */
export function ownedShipMasterIds(state: Pick<GameState, 'ships'>): Set<number> {
    const ids = new Set<number>();
    for (const ship of state.ships.values()) {
        const id = Number(ship?.api_ship_id);
        if (id > 0) ids.add(id);
    }
    return ids;
}

/** 資料表的更新日（YYYY/MM/DD）。只取日期、以本機日曆組出，避免 UTC 零時在西半球退一天。 */
export function akashiDataDate(): string {
    const [year, month, day] = AKASHI_SOURCE.wikiLastModified.slice(0, 10).split('-').map(Number);
    return formatDate(new Date(year, month - 1, day).getTime());
}

export interface HelperGroup {
    /** 改造鏈起點的 master id */
    base: number;
    /** 要顯示的形態：持有者顯示持有的那個形態，都沒持有時顯示該組裡最早的形態（起點本身常不在可用清單內） */
    shown: number;
    owned: boolean;
}

/** 同一艘艦的各改造形態歸成一組；持有的組排前面，同組內維持原順序。 */
export function groupHelpers(helpers: readonly AkashiHelper[]): HelperGroup[] {
    const groups = new Map<number, HelperGroup>();
    for (const helper of helpers) {
        const base = helperBase(helper.masterId);
        const group = groups.get(base);
        if (!group) groups.set(base, { base, shown: helper.masterId, owned: helper.owned });
        else if (helper.owned && !group.owned) { group.owned = true; group.shown = helper.masterId; }
        else if (!group.owned && helperDepth(helper.masterId) < helperDepth(group.shown)) group.shown = helper.masterId;
    }
    return [...groups.values()].sort((a, b) => Number(b.owned) - Number(a.owned));
}
