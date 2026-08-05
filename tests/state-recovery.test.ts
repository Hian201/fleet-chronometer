import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreBackup } from '../utils/backup';
import { KcDb, type ApiEventRow, type SnapshotRow } from '../utils/db';
import { EventProjector, type EventProjectorTables } from '../utils/event-projector';
import { GameState } from '../utils/state';
import {
    SNAPSHOT_ORDER,
    applySnapshotBaseline,
    applyStateRecoveryPlan,
    planStateRecovery,
} from '../utils/state-recovery';

const databases: KcDb[] = [];
let databaseSerial = 0;

function createDb() {
    const database = new KcDb(`kc-state-recovery-test-${Date.now()}-${databaseSerial++}`);
    databases.push(database);
    return database;
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

function snapshot(path: string, eventId?: number): SnapshotRow {
    return { path, ts: 1_726_000_000_000, api: { path }, req: {}, eventId };
}

function event(id: number, path = `raw-${id}`): ApiEventRow {
    return { id, ts: 1_726_000_100_000 + id, path, api: { id }, req: {} };
}

function portSnapshot(eventId?: number, shipId = 101, nickname = 'snapshot'): SnapshotRow {
    return {
        path: 'api_port/port', ts: 1_726_000_000_000, eventId, req: {},
        api: {
            api_ship: [{
                api_id: shipId, api_ship_id: 500, api_lv: 99,
                api_nowhp: 69, api_maxhp: 93, api_cond: 49,
                api_slot: [-1], api_slot_ex: -1, api_kyouka: [], api_fuel: 100, api_bull: 100,
            }],
            api_deck_port: [{ api_ship: [shipId, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [], api_material: [],
            api_basic: { api_max_chara: 500, api_max_slotitem: 2_000, api_nickname: nickname, api_level: 120 },
            api_count_kdock: 4, api_combined_flag: 0,
        },
    };
}

function recordingState() {
    const applied: string[] = [];
    return {
        applied,
        state: { applyEvent: (path: string) => applied.push(path) },
    };
}

function mockTables(): EventProjectorTables & {
    sorties: EventProjectorTables['sorties'] & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; filter: ReturnType<typeof vi.fn> };
    factory: { put: ReturnType<typeof vi.fn> };
    replays: EventProjectorTables['replays'] & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
    expeditions: { put: ReturnType<typeof vi.fn> };
} {
    return {
        sorties: {
            get: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(1),
            filter: vi.fn(() => ({ toArray: async () => [] })),
        },
        factory: { put: vi.fn().mockResolvedValue(undefined) },
        replays: { get: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) },
        expeditions: { put: vi.fn().mockResolvedValue(undefined) },
    };
}

describe('state recovery replay planning', () => {
    it('raw events 為空時依 SNAPSHOT_ORDER 套用全部快照，並相容 legacy snapshot', () => {
        const snapshots = [...SNAPSHOT_ORDER].reverse().map(path => snapshot(path));
        const plan = planStateRecovery(snapshots, []);
        const recording = recordingState();

        applySnapshotBaseline(recording.state, plan.baselineSnapshots);

        expect(plan.baselineSnapshots.map(row => row.path)).toEqual(SNAPSHOT_ORDER);
        expect(recording.applied).toEqual(SNAPSHOT_ORDER);
        expect(plan.rawEvents).toEqual([]);
    });

    it('snapshot eventId 嚴格早於第一筆 raw event 時才可作為 baseline', () => {
        const plan = planStateRecovery([
            snapshot('api_port/port', 9),
            snapshot('api_get_member/mapinfo', 10),
            snapshot('api_get_member/slot_item', 11),
            snapshot('api_get_member/require_info'),
        ], [event(10)]);

        expect(plan.baselineSnapshots.map(row => row.path)).toEqual(['api_port/port']);
    });

    it('snapshot eventId 等於或大於第一筆 raw event 時不得預先套用', () => {
        const equalPlan = planStateRecovery([snapshot('api_port/port', 10)], [event(10)]);
        const newerPlan = planStateRecovery([snapshot('api_port/port', 11)], [event(10)]);

        expect(equalPlan.baselineSnapshots).toEqual([]);
        expect(newerPlan.baselineSnapshots).toEqual([]);
    });

    it('legacy snapshot 只在 raw events 為空時可用', () => {
        expect(planStateRecovery([snapshot('api_port/port')], []).baselineSnapshots)
            .toHaveLength(1);
        expect(planStateRecovery([snapshot('api_port/port')], [event(10)]).baselineSnapshots)
            .toEqual([]);
    });

    it('baseline 依 SNAPSHOT_ORDER，raw events 依 ID 完整重播', () => {
        const plan = planStateRecovery([
            snapshot('api_get_member/mapinfo', 1),
            snapshot('api_port/port', 1),
            snapshot('api_start2/getData', 1),
        ], [event(30), event(10), event(20)]);
        const recording = recordingState();

        applyStateRecoveryPlan(recording.state, plan);

        expect(recording.applied).toEqual([
            'api_start2/getData', 'api_port/port', 'api_get_member/mapinfo', 'raw-10', 'raw-20', 'raw-30',
        ]);
    });

    // 實機回報 2026-08-04：每次進遊戲，面板的基地航空隊都顯示補給前的機數。
    // 根因是 baseline 依固定 path 順序重播——mapinfo 與 base_air_corps 都會寫
    // GameState.airBases，而玩家的操作順序讓 base_air_corps 比 mapinfo 新，
    // 固定順序卻把較舊的 mapinfo 排在後面覆蓋回去。順序必須依觀測時間。
    it('較舊的 mapinfo 快照不得覆蓋較新的 base_air_corps（基地航空隊機數）', () => {
        const planeInfo = (count: number) => [
            { api_squadron_id: 1, api_state: 1, api_slotid: 101, api_count: count, api_max_count: 18, api_cond: 1 },
        ];
        const airBase = (count: number) => ({
            api_area_id: 6, api_rid: 1, api_name: '第一航空隊',
            api_distance: { api_base: 5, api_bonus: 0 }, api_action_kind: 1,
            api_plane_info: planeInfo(count),
        });
        // 先開海域選擇（mapinfo，補給前 9/18），再開基地航空隊並補給（base_air_corps，18/18）
        const snapshots: SnapshotRow[] = [
            { path: 'api_get_member/mapinfo', ts: 1_726_000_000_000, eventId: 1, req: {}, api: { api_air_base: [airBase(9)] } },
            { path: 'api_get_member/base_air_corps', ts: 1_726_000_060_000, eventId: 2, req: {}, api: [airBase(18)] },
        ];
        const state = new GameState();

        applyStateRecoveryPlan(state, planStateRecovery(snapshots, []));

        expect(state.airBases_()[0]!.squadrons[0]!.count).toBe(18);
    });

    it('反向（mapinfo 較新）時同樣以較新的為準', () => {
        const airBase = (count: number) => ({
            api_area_id: 6, api_rid: 1, api_name: '第一航空隊',
            api_distance: { api_base: 5, api_bonus: 0 }, api_action_kind: 1,
            api_plane_info: [
                { api_squadron_id: 1, api_state: 1, api_slotid: 101, api_count: count, api_max_count: 18, api_cond: 1 },
            ],
        });
        const snapshots: SnapshotRow[] = [
            { path: 'api_get_member/base_air_corps', ts: 1_726_000_000_000, eventId: 1, req: {}, api: [airBase(18)] },
            { path: 'api_get_member/mapinfo', ts: 1_726_000_060_000, eventId: 2, req: {}, api: { api_air_base: [airBase(4)] } },
        ];
        const state = new GameState();

        applyStateRecoveryPlan(state, planStateRecovery(snapshots, []));

        expect(state.airBases_()[0]!.squadrons[0]!.count).toBe(4);
    });

    it('master 表（start2）永遠先套用，不受時間順序影響', () => {
        const plan = planStateRecovery([
            { path: 'api_port/port', ts: 1_726_000_000_000, eventId: 1, req: {}, api: {} },
            { path: 'api_start2/getData', ts: 1_726_000_900_000, eventId: 9, req: {}, api: {} },
        ], []);

        expect(plan.baselineSnapshots.map(row => row.path))
            .toEqual(['api_start2/getData', 'api_port/port']);
    });

    it('專用本機 extension DB 的 snapshot-only 情境可恢復目前狀態，且不建立 derived rows', async () => {
        const tables = mockTables();
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables });
        const database = createDb();
        await database.snapshot.put(portSnapshot());
        const plan = planStateRecovery(await database.snapshot.toArray(), await database.events.toArray());

        applySnapshotBaseline(projector.state, plan.baselineSnapshots);

        expect(projector.state.ships.get(101)?.api_ship_id).toBe(500);
        expect(tables.sorties.put).not.toHaveBeenCalled();
        expect(tables.factory.put).not.toHaveBeenCalled();
        expect(tables.replays.put).not.toHaveBeenCalled();
        expect(tables.expeditions.put).not.toHaveBeenCalled();
    });

    it('專用本機 extension DB 的 snapshot 加 mock raw event，不會先套用較新的 snapshot 污染舊事件', async () => {
        const tables = mockTables();
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables });
        const database = createDb();
        const rawEventId = await database.events.add({
            ...event(10, 'api_port/port'),
            api: portSnapshot(undefined, 101, 'older-raw').api,
        });
        await database.snapshot.put(portSnapshot(rawEventId + 1, 202, 'newer-snapshot'));
        const plan = planStateRecovery(await database.snapshot.toArray(), await database.events.orderBy('id').toArray());

        applySnapshotBaseline(projector.state, plan.baselineSnapshots);
        await projector.project(plan.rawEvents[0]);

        expect(plan.baselineSnapshots).toEqual([]);
        expect(projector.state.ships.has(101)).toBe(true);
        expect(projector.state.ships.has(202)).toBe(false);
        expect(projector.state.nickname).toBe('older-raw');
    });

    it('匯入來源 snapshot 後的第一筆本機 raw event 會延續 ID，並以 snapshot 為嚴格時序 baseline', async () => {
        const database = createDb();
        const sourceEventId = 120;
        const importedSnapshot = portSnapshot(sourceEventId, 101, 'imported-snapshot');
        await restoreBackup(database, {
            schemaVersion: 3,
            kind: 'restore',
            exportedAt: 1_726_000_000_000,
            tables: {
                snapshot: [importedSnapshot],
                sorties: [],
                expeditions: [],
                factory: [],
                wanted: [],
                shipObtained: [],
            },
        });

        const rawEventId = await database.events.add({
            ts: 1_726_000_100_000,
            path: 'api_port/port',
            api: portSnapshot(undefined, 202, 'local-after-restore').api,
            req: {},
        });
        const snapshots = await database.snapshot.toArray();
        const rawEvents = await database.events.orderBy('id').toArray();
        const plan = planStateRecovery(snapshots, rawEvents);

        expect(rawEventId).toBeGreaterThan(sourceEventId);
        expect(rawEvents.map(row => row.id)).toEqual([rawEventId]);
        expect(plan.baselineSnapshots).toEqual([
            expect.objectContaining({ path: 'api_port/port', eventId: sourceEventId }),
        ]);
        expect(plan.rawEvents.map(row => row.id)).toEqual([rawEventId]);

        const applied: string[] = [];
        applyStateRecoveryPlan({
            applyEvent(path: string, api: any) {
                applied.push(`${path}:${api.api_basic.api_nickname}`);
            },
        }, plan);
        expect(applied).toEqual([
            'api_port/port:imported-snapshot',
            'api_port/port:local-after-restore',
        ]);

        const state = new GameState();
        applyStateRecoveryPlan(state, plan);
        expect(state.nickname).toBe('local-after-restore');
        expect(state.ships.has(101)).toBe(false);
        expect(state.ships.has(202)).toBe(true);

        const equalBoundaryPlan = planStateRecovery([
            { ...snapshots[0], eventId: rawEventId },
        ], rawEvents);
        expect(equalBoundaryPlan.baselineSnapshots).toEqual([]);
    });

    it('panel 與 overview 取得相同 replay plan', () => {
        const snapshots = [snapshot('api_port/port', 9), snapshot('api_get_member/mapinfo', 12)];
        const events = [event(12), event(10)];

        const overviewPlan = planStateRecovery(snapshots, events);
        const panelPlan = planStateRecovery(snapshots, events);

        expect(panelPlan).toEqual(overviewPlan);
        expect(panelPlan.rawEvents.map(row => row.id)).toEqual([10, 12]);
        expect(panelPlan.baselineSnapshots.map(row => row.path)).toEqual(['api_port/port']);
    });

    it('重播歷史入渠事件使用 event.ts，SW 終止後以 retained raw events 重建結果不變且不寫 derived rows', async () => {
        const database = createDb();
        const historicalTs = 1_700_000_000_000;
        const port = portSnapshot(undefined, 101, 'historical-port');
        const portApi = port.api as any;
        const ship = portApi.api_ship[0];
        ship.api_nowhp = 60;
        ship.api_maxhp = 93;
        ship.api_ndock_time = 1_234_000;
        portApi.api_ndock = [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }];
        // 模擬快照來源 event 已被安全裁剪：先推進 generator 再刪除，保留的 nyukyo 會是後續 ID。
        const snapshotEventId = await database.events.add({
            ts: historicalTs, path: 'api_port/port', api: portApi, req: {},
        });
        await database.events.delete(snapshotEventId);
        await database.snapshot.put({ ...port, api: portApi, ts: historicalTs, eventId: snapshotEventId });
        const nyukyoId = await database.events.add({
            ts: historicalTs + 456_000,
            path: 'api_req_nyukyo/start', api: {},
            req: { api_ship_id: '101', api_ndock_id: '1', api_highspeed: '0' },
        });
        const plan = planStateRecovery(await database.snapshot.toArray(), await database.events.orderBy('id').toArray());

        const first = new GameState();
        const resumed = new GameState();
        applyStateRecoveryPlan(first, plan);
        applyStateRecoveryPlan(resumed, plan);

        const expectedCompleteAt = historicalTs + 456_000 + 1_234_000;
        expect(first.ndockData[0]?.api_complete_time).toBe(expectedCompleteAt);
        expect(resumed.ndockData[0]?.api_complete_time).toBe(expectedCompleteAt);
        expect(plan.baselineSnapshots.map(row => row.eventId)).toEqual([snapshotEventId]);
        expect(plan.rawEvents.map(row => row.id)).toEqual([nyukyoId]);
        // state recovery 只重建 reducer context：不建立 derived rows，也不碰 projection cursor。
        expect(await database.sorties.count()).toBe(0);
        expect(await database.factory.count()).toBe(0);
        expect(await database.replays.count()).toBe(0);
        expect(await database.expeditions.count()).toBe(0);
        expect(await database.meta.get('projection')).toBeUndefined();
        expect(await database.events.count()).toBe(1);
    });
});
