// 地圖 point 圖層節點字母辨識的 background 端調度（純函式，不依賴 chrome.* 或 DOM）。
//
// 流程見 docs/engineering/capture.md「地圖節點字母辨識」：地圖資源寫進 db.mapLabels 後，找出靜態表、
// 人工覆蓋、追加檔標籤與先前辨識結果都沒有字母的終點節點；有缺字且這組節點還沒讀過，才請遊戲頁裁切
// point 圖層（utils/map-point-layer.ts），再在這裡與字形庫比對（utils/map-glyph.ts）。
// 常規海域的靜態表完整，所以正式建置下永遠不讀。
//
// 本檔匯入字形庫與靜態表，只能被 background 匯入。
import type { MapLabelRow } from './db';
import { EDGE_LETTERS } from './map-edge-letters';
import { readNodeLetters, type GlyphCrop } from './map-glyph';
import {
    combinedMapLetters, isPointLayerFrame, MAP_INFO_BASE_PART, orderedMapInfoParts, POINT_LAYER_SPOT_LIMIT,
    type PointLayerSpot,
} from './map-labels';
import { EDGE_LETTER_OVERRIDES } from './map-node-letters';
import { mapNodesFromMapInfo, type MapNode } from './map-resource';

/** fill：補缺字節點並寫回 row；verify：開發建置的驗證模式，只比對、不寫回。 */
export type PointLayerPlan = { mode: 'fill' | 'verify'; frame: string; spots: PointLayerSpot[]; key: string };

const spotKey = (n: PointLayerSpot) => `${n.x},${n.y}`;
const toSpot = (n: MapNode): PointLayerSpot => ({ x: n.x, y: n.y });

/** 遊戲的材質影格名：`"map" + 海域 3 位 + 關卡 2 位 + "_" + 圖層名`（62-1 → `map06201_map62-1_point`）。 */
export function pointLayerFrame(map: string, pointLayer: string): string | null {
    const m = /^(\d{1,3})-(\d{1,2})$/.exec(map);
    if (!m) return null;
    return `map${m[1].padStart(3, '0')}${m[2].padStart(2, '0')}_${pointLayer}`;
}

/** 人工覆蓋 → 靜態表。不看遊戲內補充對照。 */
function staticLetter(map: string, edge: number): string | null {
    return EDGE_LETTER_OVERRIDES[map]?.[edge] ?? EDGE_LETTERS[map]?.[edge] ?? null;
}

export function mapNodesOfRow(row: MapLabelRow): MapNode[] {
    return mapNodesFromMapInfo(orderedMapInfoParts(row.parts));
}

/** 所有 edge 在人工覆蓋、靜態表、標籤與先前圖層辨識結果（row.letters）中都沒有字母的節點。 */
export function missingNodes(row: MapLabelRow, nodes = mapNodesOfRow(row)): MapNode[] {
    return nodes.filter(n => n.edges.every(e => !staticLetter(row.map, e) && !row.letters[e]));
}

/** 節點座標串（已依座標排序），存進 `ocrAttemptKey`。 */
export function nodeSetKey(nodes: PointLayerSpot[]): string {
    return nodes.map(spotKey).join(';');
}

/**
 * 決定要不要讀 point 圖層。沒有 pointLayer、沒有缺字節點，或目前的缺字節點都已在上次讀取的那組裡
 * （`ocrAttemptKey`）→ 不讀。用「涵蓋」而不是「相等」：遊戲先載基本檔、再載追加檔，每載一檔缺字組就
 * 縮小一次；只有地圖開放新階段、出現沒讀過的缺字節點時才再讀。
 * `verify` 為真（只在開發建置）且沒有缺字節點時（例如靜態表完整的常規海域），改對全部非出擊點節點做驗證讀取。
 */
export function planPointLayerRead(row: MapLabelRow, verify: boolean): PointLayerPlan | null {
    const pointLayer = row.parts[MAP_INFO_BASE_PART]?.pointLayer;
    const frame = pointLayer ? pointLayerFrame(row.map, pointLayer) : null;
    if (!isPointLayerFrame(frame)) return null;
    const nodes = mapNodesOfRow(row);
    const missing = missingNodes(row, nodes);
    const tried = new Set((row.ocrAttemptKey ?? '').split(';'));
    // 捷徑：超過單次上限的節點不讀；目前活動一關最多約 40 個節點，遇到再分批。
    if (missing.length) {
        if (missing.every(n => tried.has(spotKey(n)))) return null;
        return { mode: 'fill', frame, spots: missing.slice(0, POINT_LAYER_SPOT_LIMIT).map(toSpot), key: nodeSetKey(missing) };
    }
    if (!verify || !nodes.length) return null;
    return { mode: 'verify', frame, spots: nodes.slice(0, POINT_LAYER_SPOT_LIMIT).map(toSpot), key: nodeSetKey(nodes) };
}

/** planPointLayerRead 回 null 的原因（只供開發建置的診斷輸出）。 */
export function pointLayerSkipReason(row: MapLabelRow, verify: boolean): string {
    const pointLayer = row.parts[MAP_INFO_BASE_PART]?.pointLayer;
    if (!pointLayer) return '基本檔沒有 point 圖層（尚未載入基本檔或 bg 沒有 _point）';
    if (!isPointLayerFrame(pointLayerFrame(row.map, pointLayer))) return `影格名格式不符（${pointLayer}）`;
    if (missingNodes(row).length) return '缺字節點都已讀過';
    return verify ? '沒有非出擊點節點' : '沒有缺字節點（本 SW 生命週期已驗證過，或為正式建置）';
}

/**
 * 把辨識結果併進 row。全部非出擊點節點都參與一對一指派（避免鄰近節點的字被配錯），但只採用「目前仍缺字、
 * 且在這次要求內」的節點；同一節點的每條 edge 給同名。沒有新字母回 null（不必寫回）。
 */
export function applyPointLayerResult(row: MapLabelRow, requested: PointLayerSpot[], crops: GlyphCrop[]): MapLabelRow | null {
    const nodes = mapNodesOfRow(row);
    const read = readNodeLetters(crops, nodes);
    const missing = new Set(missingNodes(row, nodes).map(spotKey));
    const asked = new Set(requested.map(spotKey));
    const ocrLetters = { ...row.ocrLetters };
    let changed = false;
    for (const [i, name] of read) {
        const key = spotKey(nodes[i]);
        if (!missing.has(key) || !asked.has(key)) continue;
        for (const e of nodes[i].edges) ocrLetters[e] = name;
        changed = true;
    }
    if (!changed) return null;
    return { ...row, ocrLetters, letters: combinedMapLetters(row.parts, ocrLetters) };
}

export interface PointLayerVerification {
    map: string;
    nodes: number;
    ok: number;
    /** `靜態表字母→讀到的字母` */
    wrong: string[];
    unread: number;
    /** 靜態表沒有字母、無從比對的節點數 */
    noStatic: number;
}

/** 驗證模式：把辨識結果與靜態表逐一比對（不寫回）。 */
export function verifyPointLayerResult(row: MapLabelRow, crops: GlyphCrop[]): PointLayerVerification {
    const nodes = mapNodesOfRow(row);
    const read = readNodeLetters(crops, nodes);
    const out: PointLayerVerification = { map: row.map, nodes: nodes.length, ok: 0, wrong: [], unread: 0, noStatic: 0 };
    nodes.forEach((n, i) => {
        const expected = n.edges.map(e => staticLetter(row.map, e)).find(v => v !== null) ?? null;
        const got = read.get(i);
        if (expected === null) out.noStatic++;
        else if (got === undefined) out.unread++;
        else if (got === expected) out.ok++;
        else out.wrong.push(`${expected}→${got}`);
    });
    return out;
}

/** 驗證模式在 service worker console 的一行摘要。 */
export function formatPointLayerVerification(v: PointLayerVerification, totalMs: number, maxMs: number): string {
    const wrong = v.wrong.length ? `（${v.wrong.join('、')}）` : '';
    const noStatic = v.noStatic ? `、無靜態字母 ${v.noStatic}` : '';
    return `[Fleet Chronometer] 圖層字母驗證 ${v.map}：節點 ${v.nodes}、讀對 ${v.ok}、讀錯 ${v.wrong.length}${wrong}、`
        + `讀不出 ${v.unread}${noStatic}；遊戲頁主執行緒 總 ${totalMs.toFixed(1)}ms／單節點最大 ${maxMs.toFixed(1)}ms`;
}
