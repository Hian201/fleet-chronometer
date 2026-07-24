// 遊戲資料（艦名／裝備名）的譯名查表 —— 預留掛鉤，資料由外部填入。
//
// 設計：以 master id（api_mst_ship / api_mst_slotitem 的 api_id，遊戲全域穩定）為 key，
// 對應各顯示語言的譯名。查表命中即回譯名，缺譯回退遊戲封包原始日文名（api_name）。
// 因此「未填 = 顯示日文」，永不出現空白或壞掉的畫面；可逐步補譯、任何時候都能上線。
//
// 為何獨立成模組：本檔為純資料 + 純函式，不含 chrome.*，符合「核心零瀏覽器依賴」
// （見 CLAUDE.md 設計原則4）——state.ts 可照常獨立編譯、用 node 餵封包測試。
//
// ── 如何填資料（給未來的你 / 外部工具）──
// 直接編輯下方 SHIP_NAMES / GEAR_NAMES 兩張表，或（建議）改成從 JSON 匯入：
//   import shipJson from './gamedata-ship-names.json';
//   export const SHIP_NAMES = shipJson as NameTable;
// JSON 形狀就是下面 NameTable：{ "<masterId>": { "zh-TW": "…", "en": "…" }, ... }
// 日文欄不用填（回退用封包原名即可）；只填想覆蓋的語言。
// 外部資料來源參考：KC3Kai translations（ships.json / items.json，皆以 master id 為 key）。
export type Lang = 'ja' | 'zh-TW' | 'en';
// masterId → { 語言: 譯名 }。日文可省略（回退封包原名）。
export type NameTable = Record<number, Partial<Record<Lang, string>>>;
// 目前面板顯示語言。面板啟動時由 setDisplayLang() 設定；state.ts 的名稱解析讀取此值。
// 因名稱解析是每次 render 現算（非快取），切換語言後重繪即整批換語言。
let displayLang: Lang = 'ja';
export function setDisplayLang(lang: Lang) { displayLang = lang; }
export function getDisplayLang(): Lang { return displayLang; }
// ── 譯名表（待填）────────────────────────────────────────────
// 目前為空 → 全部回退日文原名，行為與加此模組前完全一致。
export const SHIP_NAMES: NameTable = {};
export const GEAR_NAMES: NameTable = {};
// ── 解析入口（state.ts 唯一呼叫點）──────────────────────────
// ja 為封包原始日文名（可能 undefined，如 master 尚未載入）。命中譯表用譯名，否則回退。
export function localizeShip(masterId: number | undefined, ja: string | undefined): string {
    if (masterId == null) return ja ?? '?';
    return SHIP_NAMES[masterId]?.[displayLang] ?? ja ?? '?';
}
export function localizeGear(mstId: number | undefined, ja: string | undefined): string {
    if (mstId == null) return ja ?? '?';
    return GEAR_NAMES[mstId]?.[displayLang] ?? ja ?? '?';
}