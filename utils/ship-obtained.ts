import type { ShipObtainedRow } from './db';

interface ShipObtainedTable {
    count(): PromiseLike<number>;
    toArray(): PromiseLike<ShipObtainedRow[]>;
    bulkPut(rows: ShipObtainedRow[]): PromiseLike<unknown>;
}

// api_port/port 的收藏日誌投影。呼叫端傳入已保存的 raw event ID，讓 retention 能用確定的
// 事件順序關聯前一筆 battle-result。既有 row 絕不補猜 observedEventId；同事件 retry 由
// api_id 主鍵與 known set 保持冪等。
export async function captureShipObtained(
    table: ShipObtainedTable,
    observedEventId: number,
    ts: number,
    api: any,
): Promise<void> {
    if (!Number.isSafeInteger(observedEventId) || observedEventId <= 0) {
        throw new Error(`無效的 ship-obtained observation event ID：${observedEventId}`);
    }
    const ships = api?.api_ship;
    if (!Array.isArray(ships) || !ships.length) return;
    if ((await table.count()) === 0) {
        await table.bulkPut(ships.map((ship: any) => ({
            id: ship.api_id,
            mst: ship.api_ship_id,
            obtainedTs: null,
            source: null,
            observedEventId,
        })));
        return;
    }

    const known = new Set((await table.toArray()).map(row => row.id));
    const fresh: ShipObtainedRow[] = ships
        .filter((ship: any) => !known.has(ship.api_id))
        .map((ship: any) => ({
            id: ship.api_id,
            mst: ship.api_ship_id,
            obtainedTs: ts,
            source: 'auto',
            observedEventId,
        }));
    if (fresh.length) await table.bulkPut(fresh);
}
