// 地圖資源（`kcs2/resources/map/.../_info*.json`）的旁路：bridge → background 的訊息、
// `db.mapLabels` 列的合併，以及 background → 擴充頁面的更新廣播。純函式，不依賴 chrome.* 或 DOM。
//
// 這不是 kcsapi raw event：不進 `db.events`、不經 `ingestEvent()`、不進備份；內容隨時可從遊戲
// 重新取得（AGENTS.md 硬約束 3 的地圖資源例外）。見 docs/engineering/capture.md。
import type { MapLabelRow } from './db';
import { edgeLettersFromMapInfo, type MapInfoPart } from './map-resource';

/** bridge → background：一個地圖資源檔的原文。 */
export const MSG_MAP_RESOURCE = 'kc:map-resource';
/** background → 面板／情報總括：某關的補充節點字母已更新。 */
export const MSG_MAP_LABELS = 'kc:map-labels';

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

/** 以新觀測的一個檔覆蓋同一 part，對全部 parts 重算字母。同一檔重複觀測結果相同（冪等）。 */
export function mergeMapLabelRow(
    prev: MapLabelRow | undefined,
    map: string,
    part: number | null,
    info: MapInfoPart,
    ts: number,
): MapLabelRow {
    const parts = { ...(prev?.parts ?? {}), [part === null ? MAP_INFO_BASE_PART : String(part)]: info };
    // 依遊戲載入順序（基本檔、再依 N 遞增）合併：後載入的同編號路線覆蓋前者，標籤順序決定等距時的配對。
    const order = (key: string) => key === MAP_INFO_BASE_PART ? -1 : Number(key);
    const ordered = Object.keys(parts).sort((a, b) => order(a) - order(b)).map(key => parts[key]);
    return { map, parts, letters: edgeLettersFromMapInfo(ordered), ts };
}
