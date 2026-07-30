// 翻譯對照表覆蓋率檢查（純函式，無 chrome.*，設計原則 4）。
//
// samples/i18n/*.csv 是某次下載 kancollewiki 當下的快照，遊戲後續更新（新艦娘/新深海
// 棲艦/新裝備）不會自動反映進去。這裡拿目前封包實際載入的 master id 跟
// utils/gamedata-known-ids.ts（該快照的 id 集合）做差集，找出「遊戲有、對照表沒有」
// 的缺漏，供鎮守府情報總括 LLM 分區的「匯出翻譯缺漏」匯出用。
import { KNOWN_GEAR_IDS, KNOWN_SHIP_IDS } from './gamedata-known-ids';

export type CoverageGap = { id: number; name: string };

function diff(loaded: Map<number, { name: string }>, known: Set<number>): CoverageGap[] {
    const gaps: CoverageGap[] = [];
    for (const [id, m] of loaded) {
        if (!known.has(id)) gaps.push({ id, name: m.name });
    }
    return gaps.sort((a, b) => a.id - b.id);
}

/** 目前封包看過、但不在艦娘／深海棲艦對照表快照裡的 master id（依 id 升冪）。 */
export function findUnknownShips(master: Map<number, { name: string }>): CoverageGap[] {
    return diff(master, KNOWN_SHIP_IDS);
}

/** 目前封包看過、但不在裝備對照表快照裡的 master id（依 id 升冪）。 */
export function findUnknownGears(masterGears: Map<number, { name: string }>): CoverageGap[] {
    return diff(masterGears, KNOWN_GEAR_IDS);
}
