// 遠征資源加成（大発動艇系裝備）——**遊戲不送任何加成相關封包**，公式為社群機制轉寫
// （非封包驗證），與 repair.ts／ship-nationality.ts 同屬「使用者提供之遊戲設定」類別，
// UI 必須標示為估算。
//
// 規則來源：wikiwiki.jp/kancolle/遠征（#daihatsu 節，裝備基礎加成率表）與
// wikiwiki.jp/kancolle/特大発動艇（#bonus 節，完整公式＋特大発超頂 2D 表），2026-08-03
// 直接讀取原始 HTML 逐字核對（非 WebFetch 摘要——同一批資料先前透過 WebFetch 小模型摘要
// 兩次都拿到彼此矛盾的數字，唯有讀原始 HTML 表格才收斂到一致版本，往後同類資料缺口應
// 比照辦理，見 CLAUDE.md 開發流程記錄）。
//
// 公式（wikiwiki.jp 原文逐字）：
//   獲得資源量 ＝ [ 基本量 × 大成功 × ( 100% ＋ min(大発系の素補正の合計,20%)
//                   ＋ (0.2% × 艦隊全体の大発系の★の数の平均値) ) ]
//               ＋ [ 基本量 × 大成功 × 特大発補正 ]
// 改修★項是「平坦」的 0.2%×平均★（★0–10，故最高 +2%），**與軟上限補正無關**——
// 別誤植成 `0.01×min(...)×平均★`（那會讓★加成隨基礎補正縮放，來源沒有這層乘積）。
// 特大発補正是獨立一段（不受 20% 限制），且同時吃「特大発個數」與「同時裝備的一般大発
// 個數」兩個維度（見 TOKU_BONUS_TABLE），不是只看特大発個數。

// 純函式、零 chrome.* 依賴，可獨立編譯用 node 餵真實封包測試（同 repair.ts）。

// ── 常數（master id 皆已用 samples/start2-master.json 真實資料核對，非猜測）──
/** 各裝備 master id → 基礎（軟上限内）資源加成率。特大発動艇的基礎 5% 亦計入此表。 */
export const LANDING_CRAFT_BASE_BONUS: Record<number, number> = {
    68: 0.05,   // 大発動艇
    166: 0.02,  // 大発動艇(八九式中戦車＆陸戦隊)
    193: 0.05,  // 特大発動艇（基礎部分；超頂加成見 TOKU_DAIHATSU_MST／TOKU_BONUS_TABLE）
    409: 0.03,  // 武装大発
    167: 0.01,  // 特二式内火艇
    408: 0.02,  // 装甲艇(AB艇)
    525: 0.04,  // 特四式内火艇
    526: 0.05,  // 特四式内火艇改
};

/** 大発動艇 master id——特大発超頂加成表的「同時裝備大発個數」維度只算這一款。 */
export const DAIHATSU_MST = 68;
/** 特大発動艇 master id——唯一有「超過 20% 軟上限」額外加成的裝備。 */
export const TOKU_DAIHATSU_MST = 193;

/** 軟上限（大発系基礎補正加總的天花板）。 */
export const SOFT_CAP = 0.2;

/**
 * 特大発超頂加成表（wikiwiki.jp/kancolle/特大発動艇 #bonus 逐字轉寫）：列＝特大発個數
 * （1／2／3／4以上），欄＝同時裝備的一般大発個數（0/1/2/3/4以上）。特大発+1／+2 兩列
 * 對大発個數不敏感（各只有單一數值），+3／4以上兩列才會隨大発個數變動。
 */
const TOKU_BONUS_TABLE: readonly (readonly number[])[] = [
    [0.02, 0.02, 0.02, 0.02, 0.02],            // 特大発 1
    [0.04, 0.04, 0.04, 0.04, 0.04],            // 特大発 2
    [0.05, 0.05, 0.052, 0.054, 0.054],         // 特大発 3
    [0.054, 0.056, 0.058, 0.059, 0.06],        // 特大発 4以上
];

function tokuDaihatsuPostcap(tokuCount: number, daihatsuCount: number): number {
    if (tokuCount <= 0) return 0;
    const row = TOKU_BONUS_TABLE[Math.min(tokuCount, 4) - 1];
    const col = Math.min(daihatsuCount, 4);
    return row[col];
}

/** 計算加成所需的裝備輸入：master id ＋ 改修★等級（0–10）。 */
export interface LandingCraftGear {
    mst: number;
    level: number;
}

export interface ExpeditionBonus {
    /** 艦隊是否裝有任一計入加成的裝備（面板用來決定是否需要變色標示）。 */
    active: boolean;
    /** 套用於基本量的乘數（1 ＋ 軟上限補正 ＋ 改修補正）。 */
    multiplier: number;
    /** 特大発動艇超頂加成率，需另外相加（floor 各自獨立，見 applyExpeditionBonus）。 */
    tokuBonusRate: number;
}

/** 從艦隊全體裝備清單（跨全艦掃 api_slot 篩出的大発系裝備）計算遠征資源加成。 */
export function computeExpeditionBonus(gears: LandingCraftGear[]): ExpeditionBonus {
    const relevant = gears.filter(g => LANDING_CRAFT_BASE_BONUS[g.mst] != null);
    if (relevant.length === 0) return { active: false, multiplier: 1, tokuBonusRate: 0 };

    const baseSum = relevant.reduce((a, g) => a + LANDING_CRAFT_BASE_BONUS[g.mst], 0);
    const cappedBaseSum = Math.min(baseSum, SOFT_CAP);
    const avgLevel = relevant.reduce((a, g) => a + (g.level || 0), 0) / relevant.length;
    const improvementBonus = 0.002 * avgLevel;
    const tokuCount = relevant.filter(g => g.mst === TOKU_DAIHATSU_MST).length;
    const daihatsuCount = relevant.filter(g => g.mst === DAIHATSU_MST).length;

    return {
        active: true,
        multiplier: 1 + cappedBaseSum + improvementBonus,
        tokuBonusRate: tokuDaihatsuPostcap(tokuCount, daihatsuCount),
    };
}

/** 對單一資材套用加成（含大成功倍率）；兩段 floor 各自獨立處理，依來源公式的【】分段。 */
export function applyExpeditionBonus(base: number, bonus: ExpeditionBonus, successMultiplier = 1): number {
    return Math.floor(base * bonus.multiplier * successMultiplier)
        + Math.floor(base * bonus.tokuBonusRate * successMultiplier);
}

/** 掃描艦隊全艦 `api_slot`，收集計入遠征資源加成的大発系裝備實例（含改修★）。 */
export function collectLandingCraftGears(
    ships: readonly { api_slot?: number[] }[],
    slotItems: ReadonlyMap<number, { mst: number; level: number }>,
): LandingCraftGear[] {
    const out: LandingCraftGear[] = [];
    for (const s of ships) {
        for (const gid of s.api_slot ?? []) {
            const it = slotItems.get(gid);
            if (it && LANDING_CRAFT_BASE_BONUS[it.mst] != null) out.push({ mst: it.mst, level: it.level });
        }
    }
    return out;
}
