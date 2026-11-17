// state.ts 的顯示命名注入點。純函式、不匯入任何字串表或譯名表（設計原則：核心零瀏覽器依賴，
// AGENTS.md 硬約束 6）。
//
// 為什麼要這一層：`entrypoints/background.ts` 匯入 `GameState` 只為了用 applyEvent()＋fleets()
// 排士氣通知，自己一次都沒呼叫 t()；但 state.ts 會呼叫 t() 與 localizeShip() 等產生顯示名稱，
// 於是整張介面字串表（ui-i18n，約 389 kB）與艦名／裝備譯名表（gamedata-names，約 186 kB）
// 都跟著進 service worker——實測佔 background.js 的 499 kB。service worker 會頻繁休眠重啟，
// 這份解析成本是反覆付的。
//
// 真正的實作由 ui-i18n.ts 於載入時註冊（見該檔結尾），所以任何（間接）匯入 ui-i18n 的頁面、
// 預覽腳本與測試都自動生效，不必各自安裝；background 不匯入 ui-i18n，兩張表就不會進去。
// 未註冊時 localize 系列回退封包原名（與譯表查無該語言時完全相同），t() 回傳 key：
// 缺註冊會在畫面上看見 key，是大聲的錯，不是靜默錯譯。
import type { Lang } from './gamedata-i18n';

export interface StateFormatters {
    t(key: string, vars?: Record<string, string | number>): string;
    localizeShip(masterId: number | undefined, ja: string | undefined): string;
    localizeGear(mstId: number | undefined, ja: string | undefined): string;
    localizeEquipmentType(typeId: number | undefined, ja: string | undefined): string;
    expedItemDisplayName(itemType: number, rawName: string): string;
    expedItemFullName(itemType: number, rawName: string): string;
    getLang(): Lang;
}

export const stateFormatters: StateFormatters = {
    t: key => key,
    localizeShip: (_masterId, ja) => ja ?? '?',
    localizeGear: (_mstId, ja) => ja ?? '?',
    localizeEquipmentType: (_typeId, ja) => ja ?? '?',
    expedItemDisplayName: (_itemType, rawName) => rawName,
    expedItemFullName: (_itemType, rawName) => rawName,
    getLang: () => 'ja',
};

/** 註冊真正的本地化實作；只有 ui-i18n.ts 會呼叫。 */
export function setStateFormatters(next: Partial<StateFormatters>): void {
    Object.assign(stateFormatters, next);
}
