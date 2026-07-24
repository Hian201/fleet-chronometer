import type { ApiEventRow, SnapshotRow } from './db';

// 快照套用順序：start2 提供艦種／裝備 master 表，必須優先於其餘母港狀態。
// background.ts 的 SNAPSHOT_PATHS 定義寫入集合；這裡是 panel／overview 共用的恢復順序。
export const SNAPSHOT_ORDER = [
    'api_start2/getData',
    'api_get_member/require_info',
    'api_get_member/slot_item',
    'api_port/port',
    'api_get_member/base_air_corps',
    'api_get_member/mapinfo',
] as const;

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

    const baselineSnapshots = SNAPSHOT_ORDER
        .map(path => snapshotsByPath.get(path))
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
