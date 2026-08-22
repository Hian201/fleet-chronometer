import type { ApiEventRow, SnapshotRow } from './db';

// 快照套用順序的**平手時**依據（實際順序見 orderSnapshots：一律以觀測時間為主）。
// start2 提供艦種／裝備 master 表，必須優先於其餘母港狀態。
// background.ts 的 SNAPSHOT_PATHS 定義寫入集合；這裡是 panel／overview 共用的恢復順序。
export const SNAPSHOT_ORDER = [
    'api_start2/getData',
    'api_get_member/require_info',
    'api_get_member/slot_item',
    'api_port/port',
    'api_get_member/base_air_corps',
    'api_get_member/mapinfo',
] as const;

// master 表要先進來，之後的 reducer 才有 stype／裝備資料可用；它是唯讀參照資料，
// 不會被其他 path 覆寫，故永遠排最前面不受時間順序影響。
const MASTER_PATH = 'api_start2/getData';

/**
 * 快照的重播順序＝**觀測時間順序**，不是固定的 path 順序。
 *
 * ⚠️ 每個 path 只留最新一筆快照，但**不同 path 的新舊互不相干**；若依固定 path 順序套用，
 * 較舊的快照可能覆蓋較新的基地航空隊機數：
 * `api_get_member/mapinfo` 與 `api_get_member/base_air_corps` 都會寫 `GameState.airBases`，
 * 玩家的實際操作順序是「開海域選擇（mapinfo）→ 開基地航空隊（base_air_corps）→ 補給」，
 * 於是 base_air_corps 比 mapinfo 新；若 mapinfo 後套用，就會覆蓋較新的 base_air_corps。
 *
 * 以 `ts`（該筆快照來源事件的觀測時間）為主鍵、`eventId` 為次鍵，兩者皆缺才退回
 * SNAPSHOT_ORDER 的既定位置。
 */
export function orderSnapshots(snapshots: readonly SnapshotRow[]): SnapshotRow[] {
    const rank = (path: string) => {
        const i = (SNAPSHOT_ORDER as readonly string[]).indexOf(path);
        return i < 0 ? SNAPSHOT_ORDER.length : i;
    };
    return [...snapshots].sort((left, right) => {
        if (left.path === MASTER_PATH || right.path === MASTER_PATH) {
            if (left.path !== right.path) return left.path === MASTER_PATH ? -1 : 1;
        }
        const ts = (left.ts ?? 0) - (right.ts ?? 0);
        if (ts !== 0) return ts;
        const id = (left.eventId ?? 0) - (right.eventId ?? 0);
        if (id !== 0) return id;
        return rank(left.path) - rank(right.path);
    });
}

export type RetainedRawEvent = ApiEventRow & { id: number };

export interface StateRecoveryPlan {
    // 只更新 GameState 的快照 baseline；絕不可交給 EventProjector。
    baselineSnapshots: SnapshotRow[];
    // 依事件 ID 排序的完整 retained raw events；panel 會將其交給 EventProjector。
    rawEvents: RetainedRawEvent[];
}

interface StateEventReducer {
    applyEvent(path: string, api: any, req?: Record<string, string>, ts?: number): void;
}

// 將現有的 snapshot／raw event 規劃成可安全重建 GameState 的兩段流程。
// raw events 存在時，只有來源 eventId 嚴格早於第一筆 raw event 的快照可作為 baseline；
// 因為每個 path 只保留最新快照，較新的快照若先餵入會污染較舊 raw event 的 reducer context。
export function planStateRecovery(
    snapshots: readonly SnapshotRow[],
    events: readonly ApiEventRow[],
): StateRecoveryPlan {
    const rawEvents = events
        .filter((event): event is RetainedRawEvent => typeof event.id === 'number')
        .sort((left, right) => left.id - right.id);
    const firstRawEventId = rawEvents[0]?.id;
    const snapshotsByPath = new Map(snapshots.map(snapshot => [snapshot.path, snapshot]));

    // 白名單維持 SNAPSHOT_ORDER（＝background 會寫入的 path 集合），只有「順序」改成
    // 依觀測時間；匯入的舊備份若帶了名單外的 path，仍不當 baseline。
    const known = SNAPSHOT_ORDER
        .map(path => snapshotsByPath.get(path))
        .filter((row): row is SnapshotRow => !!row);
    const baselineSnapshots = orderSnapshots(known)
        .filter((snapshot): snapshot is SnapshotRow => {
            if (!snapshot) return false;
            // raw event 為空時，legacy snapshot（沒有 eventId）仍可完整恢復目前狀態。
            if (firstRawEventId === undefined) return true;
            // raw event 存在時，legacy snapshot 沒有可驗證的時間位置，不能當 baseline。
            return typeof snapshot.eventId === 'number' && snapshot.eventId < firstRawEventId;
        });

    return { baselineSnapshots, rawEvents };
}

// baseline 只使用與 raw event 相同的 GameState.applyEvent() reducer，不觸發投影、DB 寫入或 UI 副作用。
// 單筆舊／損壞快照不得阻斷其餘狀態恢復，行為與既有 overview 重建流程一致。
export function applySnapshotBaseline(
    state: StateEventReducer,
    snapshots: readonly SnapshotRow[],
): void {
    for (const snapshot of snapshots) {
        try {
            state.applyEvent(snapshot.path, snapshot.api, snapshot.req, snapshot.ts);
        } catch {
            // 單筆壞封包不阻斷重建。
        }
    }
}

// overview 的純 state reconstruction 使用此函式；不經 EventProjector，因此不會建立 derived rows。
export function applyStateRecoveryPlan(state: StateEventReducer, plan: StateRecoveryPlan): void {
    applySnapshotBaseline(state, plan.baselineSnapshots);
    for (const event of plan.rawEvents) {
        try {
            state.applyEvent(event.path, event.api, event.req, event.ts);
        } catch {
            // 單筆壞封包不阻斷重建。
        }
    }
}
