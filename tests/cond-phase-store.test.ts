// 士氣回復相位推估的持久化：背景每次回港以「上一次母港～這次母港」觀測一次並累積在 db.meta。
import { beforeEach, describe, expect, it } from 'vitest';
import { COND_PHASE_UNKNOWN, COND_STEP_MS } from '../utils/cond';
import { COND_PHASE_META_KEY, learnCondPhaseAtPort, readCondPhase } from '../utils/cond-phase-store';
import { KcDb, type SortieBillRow } from '../utils/db';
import { buildFullEnvelope, restoreBackup } from '../utils/backup';

const SEC = 1_000;
const MIN = 60 * SEC;
// 時鐘 3 分鐘整點（例如 20:57:00）。
const TICK = Math.floor(1_795_700_000_000 / COND_STEP_MS) * COND_STEP_MS;
let dbIndex = 0;
let database: KcDb;

beforeEach(async () => {
    database = new KcDb(`cond-phase-store-${dbIndex++}`);
    await database.open();
});

const port = (conds: number[]) => ({
    api_ship: conds.map((cond, i) => ({
        api_id: i + 1, api_ship_id: 2, api_lv: 1, api_nowhp: 10, api_maxhp: 10, api_cond: cond, api_ndock_time: 0,
        api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1,
    })),
    api_deck_port: [{ api_ship: [...conds.map((_, i) => i + 1), ...Array(6 - conds.length).fill(-1)], api_mission: [0, 0, 0, 0] }],
    api_ndock: [{ api_id: 1, api_state: 0, api_ship_id: 0, api_complete_time: 0 }],
});
const addPort = (conds: number[], ts: number) =>
    database.events.add({ ts, path: 'api_port/port', api: port(conds), req: {} }) as Promise<number>;

describe('learnCondPhaseAtPort', () => {
    it('以上一次母港到這次母港觀測相位並存回；同一筆母港不重複處理', async () => {
        const first = await addPort([41, 49], TICK - 26 * SEC);
        await learnCondPhaseAtPort(database, first);
        expect(await readCondPhase(database)).toEqual(COND_PHASE_UNKNOWN);

        const second = await addPort([44, 49], TICK + 6 * SEC);
        await learnCondPhaseAtPort(database, second);
        const learned = [[0, 8 * SEC], [152 * SEC, COND_STEP_MS]];
        expect(await readCondPhase(database)).toEqual(learned);

        const row = await database.meta.get(COND_PHASE_META_KEY);
        await learnCondPhaseAtPort(database, second);
        expect(await database.meta.get(COND_PHASE_META_KEY)).toEqual(row);
    });

    it('之後的觀測與既有結果取交集', async () => {
        await learnCondPhaseAtPort(database, await addPort([41], TICK - 26 * SEC));
        await learnCondPhaseAtPort(database, await addPort([44], TICK + 6 * SEC));
        // 30 分後另一對：整點前 5 秒與後 40 秒回港，回復 1 次 → 相位縮到整點前 7 秒～後 8 秒。
        await learnCondPhaseAtPort(database, await addPort([38], TICK + 30 * MIN - 5 * SEC));
        await learnCondPhaseAtPort(database, await addPort([41], TICK + 30 * MIN + 40 * SEC));
        expect(await readCondPhase(database)).toEqual([[0, 8 * SEC], [173 * SEC, COND_STEP_MS]]);
    });

    it('期間出擊的艦不拿來推估', async () => {
        await learnCondPhaseAtPort(database, await addPort([41], TICK - 26 * SEC));
        await database.events.add({ ts: TICK - 20 * SEC, path: 'api_req_map/start', api: {}, req: { api_deck_id: '1' } });
        await learnCondPhaseAtPort(database, await addPort([44], TICK + 6 * SEC));
        expect(await readCondPhase(database)).toEqual(COND_PHASE_UNKNOWN);
    });
});

describe('cond-phase 與備份還原', () => {
    it('還原環境只有 cond-phase 時仍視為乾淨環境', async () => {
        const bill: SortieBillRow = {
            sortieKey: 40, ts: TICK, map: '1-1', ships: [], payable: [0, 0, 0, 0], balanceDelta: null, specialDelta: null,
            planesLost: 0, estimated: false, damagedShipIds: [], lostShipIds: [],
        };
        await database.sortieBills.put(bill);
        const wire = JSON.parse(JSON.stringify(await buildFullEnvelope(database)));

        const fresh = new KcDb(`cond-phase-store-fresh-${dbIndex++}`);
        await fresh.open();
        await fresh.meta.put({ key: 'cond-phase', phase: [[0, 8 * SEC]], throughPortTs: TICK, updatedAt: TICK });
        await restoreBackup(fresh, wire);
        expect(await fresh.sortieBills.toArray()).toEqual([bill]);
        fresh.close();
    });
});
