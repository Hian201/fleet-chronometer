// 資源紀錄的擷取層：從封包取出「八項資材餘額」與「活動海域的特殊時間點」。
//
// ── 為什麼落在 background 而不是 EventProjector ────────────────────────────
// 其他 derived tables（sorties/factory/replays/expeditions）都由面板的 EventProjector
// 投影，因為它們需要 GameState 的上下文（出擊到哪個節點、秘書艦是誰…）。資源序列不需要
// 任何上下文——封包裡就是八個數字——而它的**價值恰恰在於連續**：面板沒開的那幾天要是
// 斷掉，「這次活動花了多少」就算不出來。故與 db.snapshot 同層，由 background 於
// ingestEvent() 的 post-processing 落地。
//
// 本檔全部是純函式＋最小 table 合約，不 import chrome.*／dexie，可用 node 餵真封包測試。

/** 八項資材的索引順序（＝遊戲 api_material 的順序，與 FactoryLogRow.used 同一組）。 */
export const MATERIAL_COUNT = 8;

/** 帶完整八項餘額的 path。其他封包（charge/createitem…）只帶部分項目，不足以構成一列快照。 */
const MATERIAL_PATHS = new Set([
    'api_port/port',
    'api_get_member/material',
]);

/** 活動海域門檻：mapArea >= 10（同 utils/sortie-detail.ts isEventWorld）。 */
const EVENT_AREA_MIN = 10;

export interface CaptureEvent {
    id: number;
    ts: number;
    path: string;
    api: unknown;
}

export interface ResourceCaptureTables {
    resources: { put(row: { eventId: number; ts: number; m: number[] }): PromiseLike<unknown> };
    resourceMarks: {
        get(key: string): PromiseLike<ResourceMarkLike | undefined>;
        put(row: ResourceMarkLike): PromiseLike<unknown>;
        delete(key: string): PromiseLike<unknown>;
        where(index: 'mapKey'): { equals(value: number): { toArray(): PromiseLike<ResourceMarkLike[]> } };
    };
}

export interface ResourceMarkLike {
    key: string;
    kind: 'stage-open' | 'gauge-clear' | 'gauge-seen';
    mapKey: number;
    ts: number;
    eventId: number;
    seq?: number;
    gaugeNum?: number;
}

/**
 * 取出八項資材餘額。元素可能是純數字或 `{ api_value }`（兩種形狀在不同 path 都出現過，
 * 見 state.ts updateMaterials 的同容錯），任一項不是有限數字就整筆放棄——寧可少一列
 * 樣本，也不要把 undefined 當成 0 畫進趨勢圖（那會變成一條假的暴跌）。
 */
export function readMaterials(path: string, api: unknown): number[] | null {
    if (!MATERIAL_PATHS.has(path)) return null;
    const list = (api as { api_material?: unknown } | null | undefined)?.api_material;
    if (!Array.isArray(list) || list.length < MATERIAL_COUNT) return null;
    const out: number[] = [];
    for (let i = 0; i < MATERIAL_COUNT; i++) {
        const raw = list[i];
        const value = typeof raw === 'number' ? raw : (raw as { api_value?: unknown } | null)?.api_value;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
        out.push(value);
    }
    return out;
}

/** 出擊起點所屬的活動海域鍵（`api_req_map/start`）；非活動海域回 null。 */
export function readEventSortieMapKey(path: string, api: unknown): number | null {
    if (path !== 'api_req_map/start') return null;
    const data = api as { api_maparea_id?: unknown; api_mapinfo_no?: unknown } | null | undefined;
    const area = data?.api_maparea_id;
    const no = data?.api_mapinfo_no;
    if (!Number.isSafeInteger(area) || !Number.isSafeInteger(no)) return null;
    if ((area as number) < EVENT_AREA_MIN || (no as number) < 1) return null;
    return (area as number) * 10 + (no as number);
}

export interface EventGaugeState {
    mapKey: number;
    broken: boolean;
    gaugeNum?: number;
}

/**
 * `api_get_member/mapinfo` 裡各活動海域的量表狀態。
 *
 * 歸零判定與 EventProjector.isGaugeBroken 逐條相同（欄位皆已實測，見 CLAUDE.md
 * 「關卡進度與剩餘次數」）：`api_cleared`、HP 量表 `api_now_maphp === 0`、
 * 擊破數式達標。**只認 `now_maphp === 0`**——`=== 1` 是「最終段、還差一沉」，不是通關。
 */
export function readEventGauges(path: string, api: unknown): EventGaugeState[] {
    if (path !== 'api_get_member/mapinfo') return [];
    const list = (api as { api_map_info?: unknown } | null | undefined)?.api_map_info;
    if (!Array.isArray(list)) return [];
    const out: EventGaugeState[] = [];
    for (const raw of list) {
        const m = raw as Record<string, any> | null;
        if (!m) continue;
        const mapKey = m?.api_id;
        if (!Number.isSafeInteger(mapKey) || Math.floor(mapKey / 10) < EVENT_AREA_MIN) continue;
        const ev = m.api_eventmap;
        const cleared = m.api_cleared === 1 || m.api_cleared === '1';
        const gaugeType = m.api_gauge_type ?? 0;
        const nowHp = ev?.api_now_maphp ?? 0;
        const maxHp = ev?.api_max_maphp ?? 0;
        const defeat = m.api_defeat_count ?? 0;
        const required = m.api_required_defeat_count ?? 0;
        const broken = cleared
            || (gaugeType === 2 && maxHp > 0 && nowHp === 0)
            || (gaugeType === 1 && required > 0 && defeat >= required);
        out.push({
            mapKey,
            broken,
            // mapinfo 正常回應把 gauge_num 放在海域列；select_eventmap_rank 則包在
            // api_maphp／eventmap 物件。兩種端點都保存原值，不能因讀錯層級而把多血條合併。
            ...(Number.isSafeInteger(m?.api_gauge_num)
                ? { gaugeNum: m.api_gauge_num }
                : Number.isSafeInteger(ev?.api_gauge_num) ? { gaugeNum: ev.api_gauge_num } : {}),
        });
    }
    return out;
}

/**
 * 把一筆事件的資源與標記落地。**必須冪等**：SW recovery 會重跑同一筆事件的
 * post-processing，重跑不得產生第二列樣本、也不得把已記錄的通關時間往後推。
 *
 * 標記的狀態機（見 utils/db.ts ResourceMarkRow）：
 *   未歸零 → 建立 `seen:` 守衛（已存在就不動，保留最早觀測時間）
 *   已歸零 → 只有守衛存在時才記 `clear:`（刪守衛），否則視為「裝擴充前就通關了」而略過
 */
export async function captureResources(
    tables: ResourceCaptureTables,
    event: CaptureEvent,
): Promise<void> {
    const { id, ts, path, api } = event;

    const materials = readMaterials(path, api);
    if (materials) await tables.resources.put({ eventId: id, ts, m: materials });

    const sortieMapKey = readEventSortieMapKey(path, api);
    if (sortieMapKey !== null) {
        const key = `open:${sortieMapKey}`;
        // add-if-absent：要的是「第一次踏進這張圖」的時間，不是最後一次。
        if (!await tables.resourceMarks.get(key)) {
            await tables.resourceMarks.put({
                key, kind: 'stage-open', mapKey: sortieMapKey, ts, eventId: id,
            });
        }
    }

    for (const gauge of readEventGauges(path, api)) {
        const seenKey = `seen:${gauge.mapKey}`;
        const seen = await tables.resourceMarks.get(seenKey);
        if (!gauge.broken) {
            if (!seen) {
                await tables.resourceMarks.put({
                    key: seenKey, kind: 'gauge-seen', mapKey: gauge.mapKey, ts, eventId: id,
                });
            }
            continue;
        }
        if (!seen) continue;   // 沒看過它未歸零 → 不是我們觀測到的斬殺，不記
        // seq 用「該圖已有幾筆 clear」推導，而不是 api_gauge_num——後者語意未經驗證
        // （61-5 樣本為 4，可能是第幾段也可能是總段數），拿它當主鍵會賭在猜測上。
        const existing = await tables.resourceMarks.where('mapKey').equals(gauge.mapKey).toArray();
        const seq = existing.filter(row => row.kind === 'gauge-clear').length;
        await tables.resourceMarks.delete(seenKey);
        await tables.resourceMarks.put({
            key: `clear:${gauge.mapKey}#${seq}`,
            kind: 'gauge-clear', mapKey: gauge.mapKey, ts, eventId: id, seq,
            ...(gauge.gaugeNum === undefined ? {} : { gaugeNum: gauge.gaugeNum }),
        });
    }
}
