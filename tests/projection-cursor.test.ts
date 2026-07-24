import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KcDb } from '../utils/db';
import {
    EventProjector,
    projectEventAndAdvance,
    type EventProjectorTables,
    type ProjectableEvent,
} from '../utils/event-projector';
import {
    advanceProjectionCursor,
    PROJECTION_META_VERSION,
    readProjectionCursor,
} from '../utils/projection-cursor';
import { applySnapshotBaseline } from '../utils/state-recovery';
import { GameState } from '../utils/state';

const databases: KcDb[] = [];
let serial = 0;

function createDb() {
    const database = new KcDb(`kc-projection-cursor-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function fixture<T = any>(name: string): T {
    return JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')) as T;
}

function row(id: number, path = 'api_port/port', api: any = {}, req?: Record<string, string>): ProjectableEvent {
    return { id, ts: 1_726_000_000_000 + id, path, api, req };
}

function portApi() {
    return {
        api_ship: [{
            api_id: 101, api_ship_id: 500, api_lv: 99,
            api_nowhp: 69, api_maxhp: 93, api_cond: 49,
            api_slot: [-1], api_slot_ex: -1, api_kyouka: [], api_fuel: 100, api_bull: 100,
        }],
        api_deck_port: [{ api_ship: [101, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [],
        api_basic: { api_max_chara: 500, api_max_slotitem: 2_000, api_nickname: 'cursor-fixture', api_level: 120 },
        api_count_kdock: 4, api_combined_flag: 0,
    };
}

function replayEvents(): ProjectableEvent[] {
    return [
        row(1, 'api_port/port', portApi()),
        row(2, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 42, api_color_no: 5,
        }, { api_deck_id: '1' }),
        row(3, 'api_req_combined_battle/ec_battle', fixture('6-5-ec_battle.json')),
        row(4, 'api_req_combined_battle/battleresult', fixture('6-5-ec_result.json')),
    ];
}

function mockTables(): EventProjectorTables & {
    sorties: EventProjectorTables['sorties'] & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    factory: { put: ReturnType<typeof vi.fn> };
    replays: EventProjectorTables['replays'] & { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
    expeditions: { put: ReturnType<typeof vi.fn> };
} {
    return {
        sorties: {
            get: vi.fn().mockResolvedValue(undefined),
            put: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(1),
            filter: vi.fn(() => ({ toArray: async () => [] })),
        },
        factory: { put: vi.fn().mockResolvedValue(undefined) },
        replays: { get: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) },
        expeditions: { put: vi.fn().mockResolvedValue(undefined) },
    };
}

async function projectRows(
    database: KcDb,
    projector: Pick<EventProjector, 'projectWithMode'>,
    events: ProjectableEvent[],
) {
    let cursor = await readProjectionCursor(database);
    for (const event of events) {
        cursor = await projectEventAndAdvance(
            projector,
            event,
            cursor,
            eventId => advanceProjectionCursor(database, eventId, event.ts),
        );
    }
    return cursor;
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('projection metadata 讀取與單調更新', () => {
    it('無 metadata 時從 0 開始，且不建立虛構進度', async () => {
        const database = createDb();

        expect(await readProjectionCursor(database)).toBe(0);
        expect(await database.meta.get('projection')).toBeUndefined();
    });

    it('backup restore marker 與 projection cursor 使用不同 key，彼此不冒充或覆蓋', async () => {
        const database = createDb();
        const restoreMarker = {
            key: 'backup-restore' as const,
            importedRestore: true,
            importedReplays: false,
            highestSourceEventId: 10,
            nextEventId: 11,
            updatedAt: 100,
        };
        await database.meta.put(restoreMarker);

        expect(await readProjectionCursor(database)).toBe(0);
        await advanceProjectionCursor(database, 12, 200);

        expect(await database.meta.get('backup-restore')).toEqual(restoreMarker);
        expect(await database.meta.get('projection')).toMatchObject({
            version: PROJECTION_META_VERSION,
            throughEventId: 12,
        });
    });

    it('目前 version metadata 正常讀取', async () => {
        const database = createDb();
        await database.meta.put({ key: 'projection', version: PROJECTION_META_VERSION, throughEventId: 42, updatedAt: 100 });

        expect(await readProjectionCursor(database)).toBe(42);
    });

    it('Batch 3.1 的 version 2 metadata 視為 stale，不沿用舊游標', async () => {
        const database = createDb();
        await database.meta.put({ key: 'projection', version: 2, throughEventId: 999, updatedAt: 100 });

        expect(await readProjectionCursor(database)).toBe(0);
    });

    it('每一筆成功 persist 後更新固定格式 metadata，且游標不倒退', async () => {
        const database = createDb();
        const projector = { projectWithMode: vi.fn().mockResolvedValue(undefined) };
        let cursor = 0;

        for (const event of [row(1), row(3)]) {
            cursor = await projectEventAndAdvance(
                projector,
                event,
                cursor,
                eventId => advanceProjectionCursor(database, eventId, event.ts),
            );
            expect(await readProjectionCursor(database)).toBe(event.id);
        }

        expect(await advanceProjectionCursor(database, 2, 999)).toBe(3);
        expect(await database.meta.get('projection')).toEqual({
            key: 'projection', version: PROJECTION_META_VERSION, throughEventId: 3, updatedAt: row(3).ts,
        });
        expect(projector.projectWithMode.mock.calls.map(call => call[1])).toEqual(['persist', 'persist']);
    });
});

describe('projection 失敗邊界與重新啟動', () => {
    it('derived write 失敗時 cursor 不前進', async () => {
        const database = createDb();
        await database.meta.put({ key: 'projection', version: PROJECTION_META_VERSION, throughEventId: 5, updatedAt: 100 });
        const tables = mockTables();
        const failure = new Error('derived write failure');
        tables.expeditions.put.mockRejectedValue(failure);
        const projector = new EventProjector({ state: new GameState(), tables });

        await expect(projectEventAndAdvance(
            projector,
            row(6, 'api_req_mission/result', {}, { api_deck_id: '1' }),
            5,
            eventId => advanceProjectionCursor(database, eventId),
        )).rejects.toBe(failure);

        expect(await readProjectionCursor(database)).toBe(5);
    });

    it('derived write 成功但 meta write 失敗時保留舊 cursor', async () => {
        const database = createDb();
        await database.meta.put({ key: 'projection', version: PROJECTION_META_VERSION, throughEventId: 5, updatedAt: 100 });
        const tables = mockTables();
        const projector = new EventProjector({ state: new GameState(), tables });
        const failure = new Error('meta write failure');
        vi.spyOn(database.meta, 'put').mockRejectedValueOnce(failure);

        await expect(projectEventAndAdvance(
            projector,
            row(6, 'api_req_mission/result', {}, { api_deck_id: '1' }),
            5,
            eventId => advanceProjectionCursor(database, eventId),
        )).rejects.toBe(failure);

        expect(tables.expeditions.put).toHaveBeenCalledTimes(1);
        expect(await readProjectionCursor(database)).toBe(5);
    });

    it('失敗事件之後不處理，重開後從舊 cursor 繼續', async () => {
        const database = createDb();
        const failure = new Error('projector failure');
        const firstProjector = {
            projectWithMode: vi.fn(async (event: ProjectableEvent) => {
                if (event.id === 2) throw failure;
            }),
        };

        await expect(projectRows(database, firstProjector, [row(1), row(2), row(3)])).rejects.toBe(failure);
        expect(firstProjector.projectWithMode.mock.calls.map(call => call[0].id)).toEqual([1, 2]);
        expect(await readProjectionCursor(database)).toBe(1);

        const reopenedProjector = { projectWithMode: vi.fn().mockResolvedValue(undefined) };
        await expect(projectRows(database, reopenedProjector, [row(1), row(2), row(3)])).resolves.toBe(3);
        expect(reopenedProjector.projectWithMode.mock.calls.map(call => [call[0].id, call[1]])).toEqual([
            [1, 'state-only'], [2, 'persist'], [3, 'persist'],
        ]);
    });
});

describe('projection replay context 與冪等性', () => {
    it('id <= cursor 只執行 state-only，且可供後續 persist 重建 replay 與 sortie context', async () => {
        const database = createDb();
        await database.meta.put({ key: 'projection', version: PROJECTION_META_VERSION, throughEventId: 3, updatedAt: 100 });
        const projector = new EventProjector({ state: new GameState(), tables: database });

        await expect(projectRows(database, projector, replayEvents())).resolves.toBe(4);

        expect(projector.currentSortieKey).toBe(2);
        expect(await database.sorties.get(4)).toMatchObject({ eventId: 4, sortieKey: 2, map: '6-5' });
        expect(await database.replays.get(2)).toMatchObject({
            sortieKey: 2,
            battles: [expect.objectContaining({ node: 42, rank: 'S' })],
        });
        expect(await database.sorties.count()).toBe(1);
        expect(await database.replays.count()).toBe(1);
    });

    it('snapshot baseline 不建立或更新 projection cursor', async () => {
        const database = createDb();
        const state = new GameState();

        applySnapshotBaseline(state, [{ path: 'api_port/port', ts: 100, api: portApi(), eventId: 99 }]);

        expect(state.nickname).toBe('cursor-fixture');
        expect(await readProjectionCursor(database)).toBe(0);
        expect(await database.meta.get('projection')).toBeUndefined();
    });

    it('首次升級與 version mismatch 都完整重做 retained events，且同主鍵不增加 derived row count', async () => {
        const database = createDb();
        const events = replayEvents();

        await expect(projectRows(
            database,
            new EventProjector({ state: new GameState(), tables: database }),
            events,
        )).resolves.toBe(4);
        const firstCounts = await Promise.all([database.sorties.count(), database.replays.count()]);
        await database.sorties.update(4, { cleared: true });
        await database.replays.update(2, { pinned: true });

        await database.meta.put({ key: 'projection', version: 2, throughEventId: 999, updatedAt: 200 });
        await expect(projectRows(
            database,
            new EventProjector({ state: new GameState(), tables: database }),
            events,
        )).resolves.toBe(4);

        expect(firstCounts).toEqual([1, 1]);
        expect(await Promise.all([database.sorties.count(), database.replays.count()])).toEqual(firstCounts);
        expect(await database.sorties.get(4)).toMatchObject({ dropMst: 124, cleared: true });
        expect(await database.replays.get(2)).toMatchObject({ pinned: true });
        expect(await database.meta.get('projection')).toMatchObject({
            key: 'projection', version: PROJECTION_META_VERSION, throughEventId: 4,
        });
    });
});
