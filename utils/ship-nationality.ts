// 艦娘國籍的兩層規則：第一層艦型基本國籍（就役時所屬海軍）＋第二層逐艦篩選國籍標籤。
//
// 純資料＋純函式，無 chrome.* 與 DOM，可獨立編譯用 node 驗證（AGENTS.md 硬約束 6）。
// 本檔匯入 `utils/ship-class.ts` 的三語艦型表，因此同樣不得出現在 service worker 的匯入鏈
// （tests/state-format.test.ts 把關）。
//
// ── 為什麼需要人工維護 ──────────────────────────────────────────────────
// **遊戲 API 完全不提供國籍**：`api_mst_ship` 只有艦種 stype 與艦型 ctype，沒有任何國別欄位。
//
// ── 第一層：艦型基本國籍（`nationOf(ctype)`，每個 ctype 一國）────────────
// 依該艦型「就役時所屬海軍」判定（金剛於英國建造但就役日本海軍→jp；神威於美國建造→jp；
// Thonburi 於日本建造但就役泰國海軍→th）。資料全部集中於 `utils/ship-class.ts` 的
// `SHIP_CLASSES`（140 個図鑑內 ctype 全數明列，不設「未列出一律日本」預設）。
//   · 用途：表格「國籍」欄的排序鍵，以及配裝參考（equip-ref）套用的國別藍字加成。
//   · ctype 86（呂號潛水艦／呂500）原為德國海軍 U-511，故第一層歸 `de`（KC3Kai 單表只能
//     標一國而標成日本，本專案刻意不同，並以第二層補上日本篩選標籤）。
//   · ctype 80（Guglielmo Marconi級／伊504）與 ctype 124（Marcello級／伊503）就役義大利
//     海軍，故第一層歸 `it`。
//   · ctype 5（曉型／Верный）就役日本海軍→jp；ctype 110（Brooklyn級／General Belgrano）
//     與 ctype 114（Gato級／Leonardo da Vinci）就役美國海軍→us。
//   · 未收錄的新艦型或 ctype=0（master 未載入）一律回傳 `null`（不可考），絕不猜成日本。
//
// ── 第二層：篩選國籍標籤（`nationsOf(masterId, ctype)`，逐艦可多國）──────
// 活動倍率會把特定移交並改為他國艦名的形態同時計入兩國，篩選與國籍欄顯示都讀這一層：
//   · 147 Верный：jp ＋ su
//   · 436 呂500 ：de ＋ jp
//   · 530 伊504 ：it ＋ jp
//   · 940 伊503 ：it ＋ jp
// 雙標籤只掛在該移交改名形態（U-511、Luigi Torelli、UIT-25、C.Cappellini、UIT-24 維持單國）。
// UIT-24／25、Leonardo da Vinci 等目前缺乏活動雙國籍倍率依據，依未驗證不猜原則不列入。
// 配裝參考只讀第一層，不讀本層，避免未驗證的跨國藍字加成混入。
import { SHIP_CLASSES } from './ship-class';

/** 目前遊戲收錄的國籍。新增國家時同步補 `utils/ui-i18n.ts` 的 `nation.*` 三語字串與 `NATIONS`。 */
export type Nation =
    | 'jp' | 'us' | 'gb' | 'de' | 'it' | 'fr'
    | 'su' | 'nl' | 'au' | 'se' | 'no' | 'th';

/**
 * 顯示順序（排序鍵與篩選晶片都吃它）。日本在首（收錄量最大），其餘依收錄量大致遞減，
 * 不用字母序——字母序會讓「主要陣營」散落在小國之間，掃視時找不到重點。
 */
export const NATIONS: Nation[] = ['jp', 'us', 'gb', 'de', 'it', 'fr', 'su', 'nl', 'au', 'se', 'no', 'th'];

/**
 * 第一層：艦型 → 基本國籍（就役時所屬海軍）。
 * `ctype` 為 0（master 未載入）或表內尚未收錄的新活動艦型皆回傳 null＝不可考，
 * 刻意不比照 KC3Kai 預設落回日本，避免新實裝的外國艦被誤歸日本。
 */
export function nationOf(ctype: number): Nation | null {
    if (!ctype) return null;
    return SHIP_CLASSES[ctype]?.nation ?? null;
}

/**
 * 第二層：國籍篩選與顯示用的多重標籤（只掛在有明確活動雙國籍歸屬的移交改名形態）。
 * 順序以第一層基本國籍在前，方便與排序鍵對齊。
 */
export const NATION_FILTER_OVERRIDES: Readonly<Record<number, readonly Nation[]>> = {
    147: ['jp', 'su'], // Верный（響改二，繁中「信賴」）
    436: ['de', 'jp'], // 呂500（ex U-511）
    530: ['it', 'jp'], // 伊504（ex Luigi Torelli）
    940: ['it', 'jp'], // 伊503（ex C.Cappellini）
};

export function nationsOf(masterId: number | undefined, ctype: number): Nation[] {
    // master 未載入或 ctype 未收錄時不可用 id 覆蓋把未知資料誤標成國籍；先確認第一層可考。
    const base = nationOf(ctype);
    if (base == null) return [];
    return [...(NATION_FILTER_OVERRIDES[masterId ?? -1] ?? [base])];
}
