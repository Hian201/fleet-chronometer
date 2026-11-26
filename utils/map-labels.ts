// 地圖資源（`kcs2/resources/map/.../_info*.json`）的旁路：bridge → background 的訊息、
// `db.mapLabels` 列的合併，以及 background → 擴充頁面的更新廣播。純函式，不依賴 chrome.* 或 DOM。
//
// 這不是 kcsapi raw event：不進 `db.events`、不經 `ingestEvent()`、不進備份；內容隨時可從遊戲
// 重新取得（AGENTS.md 硬約束 3 的地圖資源例外）。見 docs/engineering/capture.md。
import type { MapLabelRow } from './db';
import type { GlyphCrop } from './map-glyph';
import { CROP_SIZE } from './map-glyph-mask';
import { edgeLettersFromMapInfo, type MapInfoPart } from './map-resource';

/** bridge → background：一個地圖資源檔的原文。 */
export const MSG_MAP_RESOURCE = 'kc:map-resource';
/** background → 面板／情報總括：某關的補充節點字母已更新。 */
export const MSG_MAP_LABELS = 'kc:map-labels';
/** background → bridge：讀取地圖 point 圖層（經 PORT_POINT_LAYER，只送給傳來地圖資源的 frame）。 */
export const MSG_POINT_LAYER_READ = 'kc:point-layer-read';
/**
 * 遊戲框 bridge 主動連上的長連線，承載讀取要求與回覆。理由同 PORT_MUTE（utils/game-page.ts）：
 * background 不需要遊戲分頁的 host permission；bridge 也因此不掛 runtime.onMessage。
 */
export const PORT_POINT_LAYER = 'kc:point-layer';

export interface MapResourceMessage {
    type: typeof MSG_MAP_RESOURCE;
    map: string;
    part: number | null;
    text: string;
}

// 基本檔（`_info.json`）在 `parts` 的鍵；追加檔用 N 的十進位字串。
export const MAP_INFO_BASE_PART = 'base';

const MAP_KEY_RE = /^\d+-\d+$/;

export function isMapKey(value: unknown): value is string {
    return typeof value === 'string' && MAP_KEY_RE.test(value);
}

export function isMapInfoPartNo(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

/** 驗證 runtime message 的形狀；不合格回 null。 */
export function parseMapResourceMessage(msg: unknown): MapResourceMessage | null {
    const m = msg as Partial<MapResourceMessage> | null;
    if (!m || m.type !== MSG_MAP_RESOURCE) return null;
    if (!isMapKey(m.map) || !isMapInfoPartNo(m.part) || typeof m.text !== 'string') return null;
    return { type: MSG_MAP_RESOURCE, map: m.map, part: m.part, text: m.text };
}

/** 依遊戲載入順序（基本檔、再依 N 遞增）排列：後載入的同編號路線覆蓋前者，標籤順序決定等距時的配對。 */
export function orderedMapInfoParts(parts: Record<string, MapInfoPart>): MapInfoPart[] {
    const order = (key: string) => key === MAP_INFO_BASE_PART ? -1 : Number(key);
    return Object.keys(parts).sort((a, b) => order(a) - order(b)).map(key => parts[key]);
}

/** 廣播與注入用的合併字母：標籤配對結果＋圖層辨識結果，同一 edge 以標籤為準。 */
export function combinedMapLetters(parts: Record<string, MapInfoPart>, ocrLetters?: Record<number, string>): Record<number, string> {
    return { ...ocrLetters, ...edgeLettersFromMapInfo(orderedMapInfoParts(parts)) };
}

/** 以新觀測的一個檔覆蓋同一 part，對全部 parts 重算字母。同一檔重複觀測結果相同（冪等）。圖層辨識欄位原樣保留。 */
export function mergeMapLabelRow(
    prev: MapLabelRow | undefined,
    map: string,
    part: number | null,
    info: MapInfoPart,
    ts: number,
): MapLabelRow {
    const parts = { ...(prev?.parts ?? {}), [part === null ? MAP_INFO_BASE_PART : String(part)]: info };
    const row: MapLabelRow = { map, parts, letters: combinedMapLetters(parts, prev?.ocrLetters), ts };
    if (prev?.ocrLetters) row.ocrLetters = prev.ocrLetters;
    if (prev?.ocrAttemptKey !== undefined) row.ocrAttemptKey = prev.ocrAttemptKey;
    return row;
}

// ── point 圖層讀取（utils/map-point-ocr.ts 調度；遊戲頁端見 utils/map-point-layer.ts）──────
// 以下訊息會經過 bridge 與 MAIN world，兩端都用同一組驗證；不合格整筆丟棄。

export type PointLayerSpot = { x: number; y: number };

/** 讀取要求：point 圖層的影格名與要裁切的節點中心（圖層座標）。 */
export interface PointLayerReadRequest {
    requestId: string;
    frame: string;
    spots: PointLayerSpot[];
}

export interface PointLayerReadMessage extends PointLayerReadRequest {
    type: typeof MSG_POINT_LAYER_READ;
    map: string;
}

/** bridge → background（PORT_POINT_LAYER 上）：對某個 requestId 的回覆，result 由 background 再驗證。 */
export interface PointLayerReplyMessage {
    requestId: string;
    result: PointLayerReadResult;
}

/** 讀取結果。totalMs／maxMs 是遊戲頁主執行緒上每個節點耗時的總和與最大值（供驗證模式顯示）。 */
export type PointLayerReadResult =
    | { ok: true; crops: GlyphCrop[]; totalMs: number; maxMs: number }
    | { ok: false; reason: string; totalMs: number; maxMs: number };

/** 單次要求的節點數上限；62 活動最多的一關約 40 個節點。 */
export const POINT_LAYER_SPOT_LIMIT = 100;
// 圖層座標上限：遊戲畫面 1200×720，留餘裕擋掉不合理輸入。
const LAYER_COORD_MAX = 4096;
const FRAME_RE = /^map\d{5}_[\w.-]{1,64}_point$/;
const REQUEST_ID_RE = /^[\w-]{1,64}$/;
const REASON_RE = /^[\w-]{1,64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** 影格名格式（`map` + 5 位數 + `_` + 以 `_point` 結尾的圖層名）。 */
export function isPointLayerFrame(value: unknown): value is string {
    return typeof value === 'string' && FRAME_RE.test(value);
}

/** 驗證讀取要求（不含 type／map）；不合格回 null。 */
export function parsePointLayerReadRequest(value: unknown): PointLayerReadRequest | null {
    if (!isRecord(value)) return null;
    const { requestId, frame, spots } = value;
    if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) return null;
    if (!isPointLayerFrame(frame)) return null;
    if (!Array.isArray(spots) || !spots.length || spots.length > POINT_LAYER_SPOT_LIMIT) return null;
    const clean: PointLayerSpot[] = [];
    for (const s of spots) {
        if (!isRecord(s)) return null;
        const { x, y } = s;
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (x < 0 || y < 0 || x > LAYER_COORD_MAX || y > LAYER_COORD_MAX) return null;
        clean.push({ x, y });
    }
    return { requestId, frame, spots: clean };
}

/** 驗證 background → bridge 的讀取訊息；不合格回 null。 */
export function parsePointLayerReadMessage(msg: unknown): PointLayerReadMessage | null {
    if (!isRecord(msg) || msg.type !== MSG_POINT_LAYER_READ || !isMapKey(msg.map)) return null;
    const req = parsePointLayerReadRequest(msg);
    return req ? { type: MSG_POINT_LAYER_READ, map: msg.map, ...req } : null;
}

function parseCrop(value: unknown): GlyphCrop | null {
    if (!isRecord(value)) return null;
    const { x0, y0, w, h, bits } = value;
    if (![x0, y0, w, h].every(Number.isSafeInteger)) return null;
    const [cx, cy, cw, ch] = [x0, y0, w, h] as number[];
    if (cx < 0 || cy < 0 || cx > LAYER_COORD_MAX || cy > LAYER_COORD_MAX) return null;
    if (cw <= 0 || ch <= 0 || cw > CROP_SIZE || ch > CROP_SIZE) return null;
    // base64 長度必須正好是 ceil(w*h/8) 位元組的編碼長度。
    if (typeof bits !== 'string' || bits.length !== 4 * Math.ceil(((cw * ch + 7) >> 3) / 3) || !BASE64_RE.test(bits)) return null;
    return { x0: cx, y0: cy, w: cw, h: ch, bits };
}

/** 驗證 MAIN → bridge → background 的讀取結果；不合格回 null。 */
export function parsePointLayerReadResult(value: unknown): PointLayerReadResult | null {
    if (!isRecord(value) || !isMs(value.totalMs) || !isMs(value.maxMs)) return null;
    const { totalMs, maxMs } = value;
    if (value.ok === false) {
        return typeof value.reason === 'string' && REASON_RE.test(value.reason)
            ? { ok: false, reason: value.reason, totalMs, maxMs } : null;
    }
    if (value.ok !== true || !Array.isArray(value.crops) || value.crops.length > POINT_LAYER_SPOT_LIMIT) return null;
    const crops: GlyphCrop[] = [];
    for (const c of value.crops) {
        const crop = parseCrop(c);
        if (!crop) return null;
        crops.push(crop);
    }
    return { ok: true, crops, totalMs, maxMs };
}
