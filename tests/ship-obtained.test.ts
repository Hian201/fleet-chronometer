import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb } from '../utils/db';
import { captureShipObtained } from '../utils/ship-obtained';

const databases: KcDb[] = [];
let serial = 0;

function createDb() {
    const database = new KcDb(`kc-ship-obtained-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function port(...ships: Array<{ api_id: number; api_ship_id: number }>) {
    return { api_ship: ships };
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('background ship-obtained capture', () => {
    it('baseline 與後續 auto observation 都保存正在處理的 raw event ID', async () => {
        const database = createDb();
        await captureShipObtained(database.shipObtained, 10, 1_726_000_000_010, port(
            { api_id: 101, api_ship_id: 500 },
        ));
        await captureShipObtained(database.shipObtained, 12, 1_726_000_000_012, port(
            { api_id: 101, api_ship_id: 500 },
            { api_id: 102, api_ship_id: 124 },
        ));

        expect(await database.shipObtained.orderBy('id').toArray()).toEqual([
            { id: 101, mst: 500, obtainedTs: null, source: null, observedEventId: 10 },
            { id: 102, mst: 124, obtainedTs: 1_726_000_000_012, source: 'auto', observedEventId: 12 },
        ]);
    });

    it('相同 raw event retry 不新增或覆寫 ship-obtained row', async () => {
        const database = createDb();
        const api = port({ api_id: 101, api_ship_id: 500 });

        await captureShipObtained(database.shipObtained, 10, 1_726_000_000_010, api);
        await captureShipObtained(database.shipObtained, 10, 1_726_000_000_010, api);

        expect(await database.shipObtained.count()).toBe(1);
        expect(await database.shipObtained.get(101)).toEqual({
            id: 101, mst: 500, obtainedTs: null, source: null, observedEventId: 10,
        });
    });

    it('既有舊 row 缺少 observedEventId 時保持原樣，不猜測回填', async () => {
        const database = createDb();
        await database.shipObtained.put({ id: 101, mst: 500, obtainedTs: null, source: null });

        await captureShipObtained(database.shipObtained, 20, 1_726_000_000_020, port(
            { api_id: 101, api_ship_id: 500 },
        ));

        expect(await database.shipObtained.get(101)).toEqual({
            id: 101, mst: 500, obtainedTs: null, source: null,
        });
    });
});
