// 資源紀錄的擷取層。三件事必須被釘死：
//   (1) 八項餘額只從**已驗證形狀**的封包取，殘缺就整筆放棄（寧可少一列，不要假的谷底）；
//   (2) 落地冪等（SW recovery 會重跑同一筆事件的 post-processing）；
//   (3) 量表歸零必須先觀測過「未歸零」才算數——「一裝上擴充就看到已通關」不是剛打通。
//
// 量表數值全部取自真實樣本的 eventmap（61-5 未歸零 809／61-4 已歸零 0／61-3 未歸零 63），
// 不手捏；mapinfo 的外殼欄位名則沿用 6-5-mapinfo.json 實測的形狀。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    captureResources, readEventGauges, readEventSortieMapKey, readMaterials,
    type ResourceCaptureTables, type ResourceMarkLike,
} from '../utils/resource-capture';

const sample = (name: string) => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf-8'));

const EVENTMAP_615 = sample('61-5-jibun-rengou-node52.json').eventmap;   // now_maphp 809（未歸零）
const EVENTMAP_614 = sample('61-4.json').eventmap;                       // now_maphp 0, cleared 1

/** 以真實 eventmap 組一筆 mapinfo（外殼欄位依 samples/6-5-mapinfo.json 的實測形狀）。 */
const mapinfo = (entries: { id: number; eventmap?: unknown; cleared?: number }[]) => ({
    api_map_info: entries.map(e => ({
        api_id: e.id,
        api_cleared: e.cleared ?? (e.eventmap as any)?.api_cleared ?? 0,
        api_gauge_type: (e.eventmap as any)?.api_gauge_type ?? 0,
        ...(e.eventmap ? { api_eventmap: e.eventmap } : {}),
    })),
});

// ── 記憶體 table adapter（同 event-projector 測試的作法）─────────────────
function memoryTables() {
    const resources: { eventId: number; ts: number; m: number[] }[] = [];
    const marks = new Map<string, ResourceMarkLike>();
    const tables: ResourceCaptureTables = {
        resources: {
            async put(row) {
                const index = resources.findIndex(r => r.eventId === row.eventId);
                if (index >= 0) resources[index] = row; else resources.push(row);
            },
        },
        resourceMarks: {
            async get(key) { return marks.get(key); },
            async put(row) { marks.set(row.key, row); },
            async delete(key) { marks.delete(key); },
            where() {
                return {
                    equals(value: number) {
                        return { async toArray() { return [...marks.values()].filter(m => m.mapKey === value); } };
                    },
                };
            },
        },
    };
    return { tables, resources, marks };
}

describe('readMaterials', () => {
    const objects = { api_material: Array.from({ length: 8 }, (_, i) => ({ api_id: i + 1, api_value: (i + 1) * 100 })) };

    it('api_port/port 的 {api_value} 形狀', () => {
        expect(readMaterials('api_port/port', objects)).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
    });

    it('純數字形狀同樣接受', () => {
        expect(readMaterials('api_get_member/material', { api_material: [1, 2, 3, 4, 5, 6, 7, 8] }))
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('不足八項、含非數字或負值一律整筆放棄——不以 0 頂替', () => {
        expect(readMaterials('api_port/port', { api_material: [1, 2, 3, 4] })).toBeNull();
        expect(readMaterials('api_port/port', { api_material: [1, 2, 3, 4, 5, 6, 7, null] })).toBeNull();
        expect(readMaterials('api_port/port', { api_material: [1, 2, 3, 4, 5, 6, 7, -1] })).toBeNull();
        expect(readMaterials('api_port/port', {})).toBeNull();
    });

    it('只認帶完整八項的 path（charge 等只帶前四項的不算一列快照）', () => {
        expect(readMaterials('api_req_hokyu/charge', objects)).toBeNull();
    });
});

describe('readEventSortieMapKey', () => {
    it('活動海域出擊回 mapKey＝area*10+no', () => {
        expect(readEventSortieMapKey('api_req_map/start', { api_maparea_id: 62, api_mapinfo_no: 1 })).toBe(621);
    });

    it('通常海域與其他 path 一律 null', () => {
        expect(readEventSortieMapKey('api_req_map/start', { api_maparea_id: 6, api_mapinfo_no: 5 })).toBeNull();
        expect(readEventSortieMapKey('api_req_map/next', { api_maparea_id: 62, api_mapinfo_no: 1 })).toBeNull();
    });
});

describe('readEventGauges', () => {
    it('只看活動海域；61-5 的 now_maphp=809 判未歸零', () => {
        const gauges = readEventGauges('api_get_member/mapinfo', mapinfo([
            { id: 15 },                              // 通常海域，不列入
            { id: 615, eventmap: EVENTMAP_615 },
        ]));
        expect(gauges).toEqual([{ mapKey: 615, broken: false, gaugeNum: 4 }]);
    });

    it('61-4 的 now_maphp=0／cleared=1 判已歸零', () => {
        const gauges = readEventGauges('api_get_member/mapinfo', mapinfo([{ id: 614, eventmap: EVENTMAP_614 }]));
        expect(gauges[0]).toMatchObject({ mapKey: 614, broken: true });
    });

    it('擊破數式（gaugeType 1）達標也算歸零', () => {
        const gauges = readEventGauges('api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 621, api_cleared: 0, api_gauge_type: 1,
                api_defeat_count: 4, api_required_defeat_count: 4, api_eventmap: {},
            }],
        });
        expect(gauges[0].broken).toBe(true);
    });
});

describe('captureResources', () => {
    const port = (id: number, ts: number, values: number[]) => ({
        id, ts, path: 'api_port/port',
        api: { api_material: values.map(v => ({ api_value: v })) },
    });

    it('母港封包落地一列；重跑同一筆事件不會變成兩列', async () => {
        const { tables, resources } = memoryTables();
        const event = port(10, 1_000, [1, 2, 3, 4, 5, 6, 7, 8]);
        await captureResources(tables, event);
        await captureResources(tables, event);
        expect(resources).toEqual([{ eventId: 10, ts: 1_000, m: [1, 2, 3, 4, 5, 6, 7, 8] }]);
    });

    it('第一次進活動海域記 stage-open，之後再出擊不會把時間往後推', async () => {
        const { tables, marks } = memoryTables();
        const start = (id: number, ts: number) => ({
            id, ts, path: 'api_req_map/start', api: { api_maparea_id: 62, api_mapinfo_no: 1 },
        });
        await captureResources(tables, start(1, 5_000));
        await captureResources(tables, start(2, 9_000));
        expect([...marks.values()]).toEqual([
            { key: 'open:621', kind: 'stage-open', mapKey: 621, ts: 5_000, eventId: 1 },
        ]);
    });

    it('沒看過未歸零就直接看到已歸零＝裝擴充前就通關了，不記里程碑', async () => {
        const { tables, marks } = memoryTables();
        await captureResources(tables, {
            id: 1, ts: 1_000, path: 'api_get_member/mapinfo',
            api: mapinfo([{ id: 614, eventmap: EVENTMAP_614 }]),
        });
        expect([...marks.values()]).toEqual([]);
    });

    it('未歸零 → 歸零的轉變才記 gauge-clear，且守衛被收掉', async () => {
        const { tables, marks } = memoryTables();
        await captureResources(tables, {
            id: 1, ts: 1_000, path: 'api_get_member/mapinfo',
            api: mapinfo([{ id: 615, eventmap: EVENTMAP_615 }]),
        });
        expect(marks.get('seen:615')).toMatchObject({ kind: 'gauge-seen', ts: 1_000 });

        await captureResources(tables, {
            id: 2, ts: 2_000, path: 'api_get_member/mapinfo',
            api: mapinfo([{ id: 615, eventmap: { ...EVENTMAP_615, api_now_maphp: 0, api_cleared: 1 } }]),
        });
        expect(marks.get('seen:615')).toBeUndefined();
        expect(marks.get('clear:615#0')).toMatchObject({
            kind: 'gauge-clear', mapKey: 615, ts: 2_000, seq: 0, gaugeNum: 4,
        });
    });

    it('之後每次 mapinfo 都回報已通關，不會一直重記', async () => {
        const { tables, marks } = memoryTables();
        const uncleared = mapinfo([{ id: 615, eventmap: EVENTMAP_615 }]);
        const cleared = mapinfo([{ id: 615, eventmap: { ...EVENTMAP_615, api_now_maphp: 0, api_cleared: 1 } }]);
        await captureResources(tables, { id: 1, ts: 1_000, path: 'api_get_member/mapinfo', api: uncleared });
        await captureResources(tables, { id: 2, ts: 2_000, path: 'api_get_member/mapinfo', api: cleared });
        await captureResources(tables, { id: 3, ts: 3_000, path: 'api_get_member/mapinfo', api: cleared });
        expect([...marks.keys()]).toEqual(['clear:615#0']);
    });

    it('下一段量表重生後可以再記一次（seq 遞增，不靠未驗證的 api_gauge_num）', async () => {
        const { tables, marks } = memoryTables();
        const phase = (nowHp: number, cleared: number, gaugeNum: number) =>
            mapinfo([{ id: 615, eventmap: { ...EVENTMAP_615, api_now_maphp: nowHp, api_cleared: cleared, api_gauge_num: gaugeNum } }]);
        await captureResources(tables, { id: 1, ts: 1_000, path: 'api_get_member/mapinfo', api: phase(809, 0, 4) });
        await captureResources(tables, { id: 2, ts: 2_000, path: 'api_get_member/mapinfo', api: phase(0, 1, 4) });
        // 下一段：量表重生（血量回來、cleared 歸 0），api_gauge_num 在樣本裡仍是 4
        await captureResources(tables, { id: 3, ts: 3_000, path: 'api_get_member/mapinfo', api: phase(5_000, 0, 4) });
        await captureResources(tables, { id: 4, ts: 4_000, path: 'api_get_member/mapinfo', api: phase(0, 1, 4) });
        expect([...marks.keys()].sort()).toEqual(['clear:615#0', 'clear:615#1']);
        expect(marks.get('clear:615#1')).toMatchObject({ ts: 4_000, seq: 1 });
    });

    it('now_maphp=1（最終段、還差一沉）不是通關', async () => {
        const { tables, marks } = memoryTables();
        const at = (nowHp: number) => mapinfo([{ id: 615, eventmap: { ...EVENTMAP_615, api_now_maphp: nowHp } }]);
        await captureResources(tables, { id: 1, ts: 1_000, path: 'api_get_member/mapinfo', api: at(809) });
        await captureResources(tables, { id: 2, ts: 2_000, path: 'api_get_member/mapinfo', api: at(1) });
        expect([...marks.keys()]).toEqual(['seen:615']);
    });
});
