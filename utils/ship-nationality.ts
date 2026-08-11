// 艦娘基本國籍（建造國）與國籍篩選標籤對照表。
//
// 純資料＋純函式，無 chrome.* 與 DOM，可獨立編譯用 node 驗證（CLAUDE.md 設計原則 4）。
//
// ── 為什麼需要這張表 ──────────────────────────────────────────────────
// **遊戲 API 完全不提供國籍**（同「兩個日期」的處境）：`api_mst_ship` 只有艦種 stype 與
// 艦型 ctype，沒有任何國別欄位。故本表是人工維護的參照資料，不是從封包推導的衍生值。
//
// ── 鍵為什麼是 ctype（艦型）而不是逐艦 ────────────────────────────────
// 基本國籍是**艦型層級**的屬性：同一艦型的所有艦與其所有改造形態都同國。以 ctype 為鍵有兩個
// 好處：(1) 一個艦型只需一筆，新增改造形態不必回來補；(2) 改造形態自己的 master id 會隨
// 改版增加，逐艦列舉必然腐爛。已用真實完整 start2 核對：862 艘図鑑內艦分屬 140 個 ctype，
// **沒有任何 ctype 為 0**，也沒有跨國混編的 ctype（見下方「戰後移交」說明）。
//
// ── 「建造國」而非「最後的所屬國」（這條看起來像 bug，其實是刻意的）──────
// 遊戲收錄了數個**戰後移交他國並改名**的形態，它們沿用本體的 ctype，故本表一律歸給
// **建造國**。已用真實 master 逐一確認的三個實例：
//   · Верный      ＝響改二（暁型 ctype 5）→ **日本**，不是蘇聯
//   · General Belgrano ＝ Phoenix 的移交形態（Brooklyn級 ctype 110）→ **美國**，不是阿根廷
//   · Leonardo da Vinci ＝ Dace 的移交形態（Gato級 ctype 114，改造鏈
//     Dace → Dace改 → Leonardo da Vinci，yomi 仍是「デイス」）→ **美國**，不是義大利
// 反向的例子同樣成立：伊504（ex Luigi Torelli，ctype 80）與伊503（ex C.Cappellini，
// ctype 124）是義大利建造後移交日本，故歸**義大利**。
// 這條規則讓基本 ctype 表自洽。國籍篩選若有明確的遊戲機制需求，另由下方的逐艦篩選
// 標籤補充；它不會改寫 ctype 的基本國籍，也不會把封包欄位假裝成官方國籍資料。
//
// ── 維護方式 ────────────────────────────────────────────────────────────
// 遊戲新增外國艦型時在下表補一列（鍵＝該艦型的 ctype，註解寫艦型名）。**未列出的 ctype
// 一律視為日本**——收錄艦絕大多數是日艦，逐一列出 82 個日本艦型只會讓表更難維護。

/** 目前遊戲收錄的國籍。新增國家時同步補 `utils/ui-i18n.ts` 的 `nation.*` 三語字串。 */
export type Nation =
    | 'jp' | 'us' | 'gb' | 'de' | 'it' | 'fr'
    | 'su' | 'nl' | 'au' | 'se' | 'no' | 'th';

/**
 * 顯示順序（排序鍵與篩選晶片都吃它）。日本在首（收錄量最大），其餘依收錄量大致遞減，
 * 不用字母序——字母序會讓「主要陣營」散落在小國之間，掃視時找不到重點。
 */
export const NATIONS: Nation[] = ['jp', 'us', 'gb', 'de', 'it', 'fr', 'su', 'nl', 'au', 'se', 'no', 'th'];

/** 艦型 → 基本國籍（建造國）。未列出者一律為日本，見檔頭。 */
export const NATION_BY_CTYPE: Readonly<Record<number, Nation>> = {
    // ── アメリカ ──
    65: 'us',   // Iowa級
    69: 'us',   // Lexington級（Saratoga）
    83: 'us',   // Casablanca級（Gambier Bay）
    84: 'us',   // Essex級（Intrepid / Wasp）
    87: 'us',   // John C.Butler級（Samuel B.Roberts）
    91: 'us',   // Fletcher級（Johnston / Heywood L.E. / Richard P.Leary）
    93: 'us',   // Colorado級（Maryland）
    95: 'us',   // Northampton級（Houston）
    99: 'us',   // Atlanta級（Reno）
    102: 'us',  // South Dakota級（Massachusetts / Indiana）
    105: 'us',  // Yorktown級（Hornet）
    106: 'us',  // St.Louis級（Helena）
    107: 'us',  // North Carolina級（Washington）
    110: 'us',  // Brooklyn級（Honolulu / Phoenix / General Belgrano）
    114: 'us',  // Gato級（Drum / Dace / Wahoo / Scamp / Leonardo da Vinci）
    116: 'us',  // Independence級（Langley）
    118: 'us',  // Ranger級
    121: 'us',  // New Orleans級（Minneapolis / Tuscaloosa）
    122: 'us',  // Salmon級
    125: 'us',  // Nevada級

    // ── イギリス ──
    67: 'gb',   // Queen Elizabeth級（Warspite / Valiant）
    78: 'gb',   // Ark Royal級
    82: 'gb',   // J級（Jervis / Janus / Javelin）
    88: 'gb',   // Nelson級（Rodney）
    108: 'gb',  // Town級（Sheffield）
    112: 'gb',  // Illustrious級（Victorious）
    134: 'gb',  // Courageous級（Glorious・戦艦形態）
    135: 'gb',  // Courageous級（Glorious・空母形態）

    // ── ドイツ ──
    47: 'de',   // Bismarck級
    48: 'de',   // Z1型（Z3）
    55: 'de',   // Admiral Hipper級（Prinz Eugen）
    57: 'de',   // Type IXC（U-511／呂500）
    63: 'de',   // Graf Zeppelin級

    // ── イタリア ──
    58: 'it',   // Littorio級（Roma / Italia）
    61: 'it',   // Maestrale級（Libeccio / Grecale / Scirocco）
    64: 'it',   // Zara級（Pola）
    68: 'it',   // Aquila級
    80: 'it',   // Marconi級（Luigi Torelli / UIT-25 / 伊504）
    92: 'it',   // Duca degli Abruzzi級（G.Garibaldi）
    113: 'it',  // Conte di Cavour級
    124: 'it',  // Marconi級（C.Cappellini / UIT-24 / 伊503）

    // ── フランス ──
    70: 'fr',   // Commandant Teste級
    79: 'fr',   // Richelieu級（Jean Bart）
    128: 'fr',  // La Galissonnière級（Gloire）
    129: 'fr',  // Mogador級
    138: 'fr',  // Algérie級
    139: 'fr',  // Aigle級（Vautour）
    141: 'fr',  // Béarn級

    // ── ソ連 ──
    73: 'su',   // Гангут級（Октябрьская революция）
    81: 'su',   // Ташкент級
    131: 'su',  // Киров級

    // ── その他 ──
    96: 'au',   // Perth級（オーストラリア）
    98: 'nl',   // De Ruyter級（オランダ）
    89: 'se',   // Gotland級（スウェーデン）
    140: 'se',  // Visby級（スウェーデン）
    133: 'no',  // Eidsvold級（Norge／ノルウェー）
    137: 'th',  // Thonburi級（タイ）
};

/**
 * 艦型 → 國籍。`ctype` 為 0（master 尚未載入，`OwnedShipView.ctype` 的降級值）時回傳
 * null＝不可考——**不可以當成日本**，那會在沒有 master 的情況下把全部艦誤標成日艦。
 * 真實 start2 實測沒有任何図鑑內艦的 ctype 為 0，故 0 只可能來自 master 缺席。
 */
export function nationOf(ctype: number): Nation | null {
    if (!ctype) return null;
    return NATION_BY_CTYPE[ctype] ?? 'jp';
}

/**
 * 國籍篩選用的多重標籤。
 *
 * `nationOf()` 仍代表 ctype 查出的基本國籍；這支只在篩選層補上同一艦娘需要命中的
 * 其他國籍。Верный（master id 147）依本專案的遊戲機制需求同時列入日本與蘇聯，讓
 * 熟練見張員的日本艦加成與活動的海外艦篩選都能找到它。這不是遊戲 API 提供的國籍欄位。
 */
export const NATION_FILTER_OVERRIDES: Readonly<Record<number, readonly Nation[]>> = {
    147: ['jp', 'su'], // Верный：繁中顯示「信賴」，原名仍是 Верный。
};

export function nationsOf(masterId: number | undefined, ctype: number): Nation[] {
    // master 未載入時不可用 id 覆蓋把未知資料誤標成國籍；先確認基本 ctype 可考。
    const base = nationOf(ctype);
    if (base == null) return [];
    return [...(NATION_FILTER_OVERRIDES[masterId ?? -1] ?? [base])];
}
