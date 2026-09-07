// 遊戲資料（艦名／裝備名）的譯名查表 —— 預留掛鉤，資料由外部填入。
//
// 設計：以 master id（api_mst_ship / api_mst_slotitem 的 api_id，遊戲全域穩定）為 key，
// 對應各顯示語言的譯名。查表命中即回譯名，缺譯回退遊戲封包原始日文名（api_name）。
// 因此「未填 = 顯示日文」，永不出現空白或壞掉的畫面；可逐步補譯、任何時候都能上線。
//
// 為何獨立成模組：本檔為純資料 + 純函式，不含 chrome.*，符合「核心零瀏覽器依賴」
// （見 CLAUDE.md 設計原則4）——state.ts 可照常獨立編譯、用 node 餵封包測試。
//
// ── 譯名表從哪裡來 ──
// SHIP_NAMES / GEAR_NAMES 由 utils/gamedata-names.ts 提供，該檔是 tools/gamedata-names/
// generate.py 的產出物，來源是人工整理的 samples/i18n/*.csv（見 CLAUDE.md「翻譯對照
// 表」）。**要補譯名一律改 CSV 後重跑產生器，不要手改 gamedata-names.ts**。
// JSON 形狀即下面的 NameTable：{ "<masterId>": { "zh-TW": "…", "en": "…" }, ... }；
// 日文欄不用填（回退用封包原名即可），缺譯的語言欄整個不出現（見該檔生成規則）。
export type Lang = 'ja' | 'zh-TW' | 'en';
// masterId → { 語言: 譯名 }。日文可省略（回退封包原名）。
export type NameTable = Record<number, Partial<Record<Lang, string>>>;
// 目前面板顯示語言。面板啟動時由 setDisplayLang() 設定；state.ts 的名稱解析讀取此值。
// 因名稱解析是每次 render 現算（非快取），切換語言後重繪即整批換語言。
let displayLang: Lang = 'ja';
export function setDisplayLang(lang: Lang) { displayLang = lang; }
export function getDisplayLang(): Lang { return displayLang; }

// `api_mst_slotitem_equiptype` 的分類 ID 不是 `api_type[3]` 的圖示 ID，兩者不能混用。
// 以下英文名稱依 samples/start2-master.json 的分類 ID，參照使用者提供的 Kancolle Wiki
// Equipment 頁面用語整理；未列入的未來分類一律保留封包原名，不猜測翻譯。
const EQUIPMENT_TYPE_NAMES_EN: Readonly<Record<number, string>> = {
    1: 'Small Caliber Main Gun',
    2: 'Medium Caliber Main Gun',
    3: 'Large Caliber Main Gun',
    4: 'Secondary Gun',
    5: 'Torpedo',
    6: 'Carrier-based Fighter',
    7: 'Carrier-based Dive Bomber',
    8: 'Carrier-based Torpedo Bomber',
    9: 'Carrier-based Reconnaissance Aircraft',
    10: 'Reconnaissance Seaplane',
    11: 'Seaplane Bomber',
    12: 'Small Radar',
    13: 'Large Radar',
    14: 'Sonar',
    15: 'Depth Charge',
    16: 'Extra Armor',
    17: 'Engine Improvement',
    18: 'Anti-Aircraft Shell',
    19: 'Armor Piercing Shell',
    20: 'VT Fuze',
    21: 'Anti-Aircraft Gun',
    22: 'Midget Submarine',
    23: 'Emergency Repair Personnel',
    24: 'Landing Craft',
    25: 'Autogyro',
    26: 'Anti-submarine Patrol Aircraft',
    27: 'Extra Armor (Medium)',
    28: 'Extra Armor (Large)',
    29: 'Searchlight',
    30: 'Supply Transport Container',
    31: 'Ship Repair Facility',
    32: 'Submarine Torpedo',
    33: 'Star Shell',
    34: 'Command Facility',
    35: 'Aviation Personnel',
    36: 'Anti-Aircraft Fire Director',
    37: 'Anti-Ground Equipment',
    38: 'Large Caliber Main Gun (II)',
    39: 'Surface Ship Personnel',
    40: 'Large Sonar',
    41: 'Large Flying Boat',
    42: 'Large Searchlight',
    43: 'Combat Ration',
    44: 'Supplies',
    45: 'Seaplane Fighter',
    46: 'Special Amphibious Tank',
    47: 'Land-based Attack Aircraft',
    48: 'Land-based Fighter',
    49: 'Land-based Reconnaissance Aircraft',
    50: 'Transportation Material',
    51: 'Submarine Equipment',
    52: 'Landing Force',
    53: 'Large Land-based Aircraft',
    54: 'Surface Ship Equipment',
    56: 'Jet-powered Fighter',
    57: 'Jet-powered Fighter-Bomber',
    58: 'Jet Bomber',
    59: 'Jet Reconnaissance Aircraft',
    91: 'Jet-powered Fighter-Bomber (II)',
    93: 'Large Radar (II)',
    94: 'Carrier-based Reconnaissance Aircraft (II)',
    95: 'Secondary Gun (II)',
};

/** 裝備類別名只在英文介面翻譯；其他介面保留遊戲封包原名。 */
export function localizeEquipmentType(typeId: number | undefined, ja: string | undefined): string {
    if (displayLang === 'en' && typeId != null) return EQUIPMENT_TYPE_NAMES_EN[typeId] ?? ja ?? '?';
    return ja ?? '?';
}
// ── 譯名表 ──────────────────────────────────────────────────
import { SHIP_NAMES, GEAR_NAMES } from './gamedata-names';
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
