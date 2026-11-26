// 遊戲地圖資源 `_info*.json` 的節點字母補齊（純函式，不依賴 chrome.* 或 DOM）。
//
// 依據：
// - poi（MIT）`fcd/gen-map.js` 的 `extract()`／`gameLabels()`／`assignLabels()`／`mergeNearby()`，
//   clean-room 重寫，見 THIRD-PARTY-NOTICES.md；
// - KagamiChan/kcs2-mapdata（MIT）收錄的遊戲原檔（`samples/map-info/`）；
// - 遊戲 main.js 以 `axios.get` 載入 `kcs2/resources/map/<海域>/<關>_info*.json`
//   （開發者 2026-11-26 另存的 main.js 靜態閱讀，主程式檔不放進專案）。
//
// 檔案結構：`spots[]` 每筆是一條路線，`no` 是 edge id，`x`／`y` 是終點座標；沒有 `line` 的是出擊點。
// `labels[]`（只在追加檔）是畫在地圖上的節點名。初始節點的字母畫在背景圖上，不在 JSON 裡，
// 所以只給基本檔時補不出任何字母；沒有配到標籤的終點不自行編字母（AGENTS.md 硬約束 8）。

export type MapSpot = { no: number; x: number; y: number; isStart: boolean };
export type MapLabel = { x: number; y: number; name: string };
/** `pointLayer` 是基本檔 `bg` 中名稱以 `_point` 結尾的圖層（節點字母畫在這層，見 utils/map-point-ocr.ts）。 */
export type MapInfoPart = { spots: MapSpot[]; labels: MapLabel[]; pointLayer?: string };
/** 終點座標相距 ≤ 4px 併成的節點；`edges` 為抵達該節點的路線編號。 */
export type MapNode = { x: number; y: number; edges: number[] };

// 終點座標相距在此以內視為同一節點、標籤與節點相距在此以內才可配對（poi mergeDist／assignLabels）。
const MERGE_DIST = 4;
const LABEL_DIST = 45;

const URL_RE = /(?:^|\/)kcs2\/resources\/map\/(\d{3})\/(\d{2})_info(\d*)\.json(?:[?#]|$)/;

/** 認出地圖資源網址。`map` 與 `utils/map-edge-letters.ts` 的鍵同格式；基本檔 `part` 為 null。 */
export function parseMapResourceUrl(url: string): { map: string; part: number | null } | null {
    if (typeof url !== 'string') return null;
    const m = URL_RE.exec(url);
    if (!m) return null;
    return { map: `${Number(m[1])}-${Number(m[2])}`, part: m[3] === '' ? null : Number(m[3]) };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 解析單一 info 檔。形狀不對回 null；個別欄位不是有限數字的項目略過，不猜值。 */
export function parseMapInfo(json: unknown): MapInfoPart | null {
    if (!isRecord(json) || !Array.isArray(json.spots)) return null;
    const spots: MapSpot[] = [];
    for (const s of json.spots) {
        if (!isRecord(s) || !finite(s.no) || !finite(s.x) || !finite(s.y)) continue;
        spots.push({ no: s.no, x: s.x, y: s.y, isStart: !isRecord(s.line) });
    }
    const labels: MapLabel[] = [];
    if (Array.isArray(json.labels)) {
        for (const l of json.labels) {
            if (!isRecord(l) || !finite(l.x) || !finite(l.y) || typeof l.img !== 'string') continue;
            const name = l.img.replace(/^.*_text_/, '');
            if (name) labels.push({ x: l.x, y: l.y, name });
        }
    }
    // bg 的元素是圖層名字串或 `{ name, img }`（取 img），依據：samples/map-info/62-01_info.json。
    const pointLayer = Array.isArray(json.bg)
        ? json.bg.map((b) => (isRecord(b) ? b.img : b)).find((n): n is string => typeof n === 'string' && n.endsWith('_point'))
        : undefined;
    return pointLayer ? { spots, labels, pointLayer } : { spots, labels };
}

/**
 * 合併同一關的多個 info 檔（依載入順序，後者的同編號路線覆蓋前者），取非出擊點的終點並把相距
 * ≤ MERGE_DIST 的併成同一節點（以第一個進來的座標為準；edge 依編號處理以求穩定）。依座標排序。
 */
export function mapNodesFromMapInfo(parts: MapInfoPart[]): MapNode[] {
    const byNo = new Map<number, MapSpot>();
    for (const p of parts) for (const s of p.spots) byNo.set(s.no, s);
    const nodes: MapNode[] = [];
    for (const s of [...byNo.values()].filter((v) => !v.isStart).sort((a, b) => a.no - b.no)) {
        const hit = nodes.find((n) => Math.hypot(n.x - s.x, n.y - s.y) <= MERGE_DIST);
        if (hit) hit.edges.push(s.no);
        else nodes.push({ x: s.x, y: s.y, edges: [s.no] });
    }
    return nodes.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** 合併同一關的多個 info 檔，配對標籤與終點節點，輸出 `edge no → 節點名`。 */
export function edgeLettersFromMapInfo(parts: MapInfoPart[]): Record<number, string> {
    const labels = parts.flatMap((p) => p.labels);
    const nodes = mapNodesFromMapInfo(parts);

    // 標籤 × 節點由近到遠，每個標籤、每個節點各取一次；距離相同依標籤原始順序再依節點順序。
    const pairs: Array<{ d: number; li: number; ni: number }> = [];
    labels.forEach((l, li) => {
        nodes.forEach((n, ni) => {
            const d = Math.hypot(l.x - n.x, l.y - n.y);
            if (d <= LABEL_DIST) pairs.push({ d, li, ni });
        });
    });
    pairs.sort((a, b) => a.d - b.d || a.li - b.li || a.ni - b.ni);

    const usedLabel = new Set<number>();
    const usedNode = new Set<number>();
    const out: Record<number, string> = {};
    for (const { li, ni } of pairs) {
        if (usedLabel.has(li) || usedNode.has(ni)) continue;
        usedLabel.add(li);
        usedNode.add(ni);
        for (const no of nodes[ni].edges) out[no] = labels[li].name;
    }
    return out;
}
