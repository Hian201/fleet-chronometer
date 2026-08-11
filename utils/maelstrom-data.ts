// 渦潮節點的基本喪失比例／上限表。
//
// 來源：KC3Kai `src/data/fud_weekly.json` 的 `maelstromLoss`（MIT）。
// 鍵：`m{area}{map}` → edge id（字串）→ `[資源種類, 上限, 一般比例, 強渦潮比例]`
//   資源種類 1＝燃料、2＝彈藥（節點「預設」種類；實際扣哪一種以封包 api_mst_id 為準）
//   上限 0＝無固定上限（以封包 api_count 為 cap）
//   一般比例＝強渦潮比例 → 非強渦潮節點
//
// 表外節點：不猜、不扣（與 KC3Kai 相同）。活動圖／新圖需等上游更新。

/** `[rscHint, lossCap, lossRate, lossRateHigh]` */
export type MaelstromLossDef = readonly [number, number, number, number];

/** mapKey（如 `"13"`＝1-3）→ edgeId → 定義 */
export const MAELSTROM_LOSS: Readonly<Record<string, Readonly<Record<string, MaelstromLossDef>>>> = {
    '13': { '8': [1, 20, 0.4, 1.5] },
    '24': { '3': [1, 30, 0.3, 0.3] },
    '25': { '7': [1, 150, 0.4, 1.5] },
    '32': { '7': [1, 30, 0.35, 0.35] },
    '33': {
        '3': [1, 40, 0.3, 0.3],
        '6': [1, 40, 0.4, 1.5],
    },
    '34': {
        '4': [1, 0, 0.3, 0.3],
        '6': [1, 70, 0.4, 1.5],
    },
    '43': {
        '5': [2, 60, 0.35, 0.35],
        '11': [1, 80, 0.45, 0.45],
    },
    '44': { '4': [2, 0, 0.35, 0.35] },
    '45': { '18': [1, 100, 0.35, 0.35] },
    '51': { '1': [1, 0, 0.3, 0.3] },
    '52': {
        '1': [1, 70, 0.3, 0.3],
        '13': [1, 100, 0.4, 1.5],
    },
    '53': { '12': [1, 70, 0.3, 0.3] },
    '54': {
        '4': [1, 0, 0.3, 0.3],
        '17': [1, 0, 0.3, 0.3],
        '11': [1, 120, 0.4, 1.5],
    },
    '55': {
        '4': [1, 80, 0.35, 0.35],
        '12': [1, 120, 0.4, 1.5],
        '21': [1, 120, 0.4, 1.5],
        '22': [1, 120, 0.4, 1.5],
    },
    '62': {
        '4': [2, 15, 0.4, 1.5],
        '13': [2, 15, 0.4, 1.5],
    },
    '71': { '1': [2, 0, 0.35, 0.35] },
    '72': { '1': [1, 40, 0.3, 0.3] },
    '73': {
        '13': [1, 0, 0.35, 0.35],
        '14': [1, 0, 0.35, 0.35],
    },
};

/** 電探減輕係數（電探搭載艦數 0–6；超過 6 當 6）。wiki／KC3Kai 同表。 */
export const RADAR_REDUCE_RATE = [0, 0.25, 0.4, 0.5, 0.55, 0.58, 0.6] as const;

/** 小型電探(12)／大型電探(13)。潛艦電探等其他 type 不計入（wiki 明載）。 */
export const MAELSTROM_RADAR_CATS = new Set([12, 13]);

export function maelstromMapKey(area: number, mapNo: number): string {
    return `${area}${mapNo}`;
}

export function lookupMaelstromLoss(area: number, mapNo: number, edgeId: number): MaelstromLossDef | null {
    const def = MAELSTROM_LOSS[maelstromMapKey(area, mapNo)]?.[String(edgeId)];
    return def ?? null;
}
