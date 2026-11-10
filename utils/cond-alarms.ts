// 背景士氣通知的排程計畫（純函式、零 chrome.* 依賴，可用 Vitest 驗證）。
//
// 一般艦隊：全隊回到 49 時通知。回復 tick 的相位在背景不另推算，取上界 ceil(缺口/3)×3 分鐘，
// 通知響起時保證全隊已回復到 49，不會提早誤報。
// 野埼給糧發動中、且隊上有 cond 未滿 49 的艦隊：不發 49 通知，改在給糧對象中士氣最低者到 54
// （給糧上限）時通知，與面板「士氣 49 › 54」同一定義（fleetSupplyCapAt）。
//
// 背景只用母港快照＋其後的 raw events 重建 GameState，給糧錨點在這段期間沒被重置
// （undefined）時取該次進港時刻：真正的錨點不晚於進港（進港時已滿週期者會推進到此刻），
// 推算出的給糧次數只少不多，通知不會提早，最多晚一個週期（15 分）。

import { fleetSupplyCapAt } from './cond';
import type { FleetView } from './state';

export interface CondAlarm { name: string; when: number }

/** 本模組建立的通知名稱；重排時用來只清掉士氣通知、不動遠征／入渠。 */
export const COND_ALARM_RE = / (疲労回復（cond \d+→49）|給糧完了（cond→54）)$/;

/**
 * @param fleets   以母港快照＋其後事件重建的艦隊（順序同 api_deck_port）
 * @param deckNames 通知用的艦隊名稱（api_deck_port[].api_name，與既有通知名稱一致）
 * @param portTs   母港快照的觀測時刻
 * @param now      排程當下
 */
export function planCondAlarms(fleets: readonly FleetView[], deckNames: readonly string[], portTs: number, now: number): CondAlarm[] {
    return fleets.flatMap((fleet, index): CondAlarm[] => {
        const name = deckNames[index] ?? fleet.name;
        const moraleAnchor = fleet.moraleAnchor === undefined ? portTs : fleet.moraleAnchor;
        // null（無給糧對象，例如只剩野埼自身未滿 49）照一般 49 推算；全員 ≥49 時下面也不排。
        const capAt = fleetSupplyCapAt({ ...fleet, moraleAnchor });
        if (capAt != null) return [{ name: `${name} 給糧完了（cond→54）`, when: capAt }];
        const minCond = Math.min(49, ...fleet.ships.map(ship => ship.cond));
        if (minCond >= 49) return [];
        const mins = Math.ceil((49 - minCond) / 3) * 3;
        return [{ name: `${name} 疲労回復（cond ${minCond}→49）`, when: now + mins * 60_000 }];
    });
}
