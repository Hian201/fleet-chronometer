// 士氣自然回復相位推估的持久化（db.meta['cond-phase']）。
//
// 面板啟動時重播所有保留中的 raw event 就能重建相位（GameState.condPhase），但背景排士氣通知只從
// 最近一次母港快照重建 GameState，看不到更早的母港。故背景每次回港時，以「上一次母港～這次母港」
// 的 raw events 重建一次 GameState 觀測相位，與既有結果取交集後存回；排通知與面板啟動都以此為起點。
// 寫入者只有 background（learnCondPhaseAtPort）。

import { COND_PHASE_UNKNOWN, COND_STEP_MS, type CondPhase } from './cond';
import type { CondPhaseMetaRow, KcDb } from './db';
import { GameState } from './state';

export const COND_PHASE_META_KEY = 'cond-phase';

function validPhase(value: unknown): CondPhase | undefined {
    if (!Array.isArray(value) || !value.length) return undefined;
    const ok = value.every(range => Array.isArray(range) && range.length === 2
        && range.every(n => Number.isFinite(n) && n >= 0 && n <= COND_STEP_MS) && range[0] <= range[1]);
    return ok ? value as CondPhase : undefined;
}

async function readRow(database: KcDb): Promise<CondPhaseMetaRow | undefined> {
    return await database.meta.get(COND_PHASE_META_KEY) as CondPhaseMetaRow | undefined;
}

/** 已累積的相位推估；沒有或損壞時為不可考。 */
export async function readCondPhase(database: KcDb): Promise<CondPhase> {
    return validPhase((await readRow(database))?.phase) ?? COND_PHASE_UNKNOWN;
}

/**
 * 這筆母港與上一筆母港之間觀測一次相位並存回。上一筆母港已裁剪、已處理過，或兩者之間沒有可用的艦時不變。
 */
export async function learnCondPhaseAtPort(database: KcDb, portEventId: number): Promise<void> {
    const current = await database.events.get(portEventId);
    if (!current || current.path !== 'api_port/port') return;
    const row = await readRow(database);
    if (row && Number.isFinite(row.throughPortTs) && row.throughPortTs >= current.ts) return;
    const portIds = await database.events.where('path').equals('api_port/port').primaryKeys();
    const previousId = portIds.filter(id => id < portEventId).reduce<number | undefined>(
        (best, id) => (best === undefined || id > best ? id : best), undefined);
    const known = validPhase(row?.phase) ?? COND_PHASE_UNKNOWN;
    let phase = known;
    if (previousId !== undefined) {
        const state = new GameState();
        state.condPhase = known;
        for (const event of await database.events.where('id').between(previousId, portEventId, true, true).toArray()) {
            try {
                state.applyEvent(event.path, event.api, event.req, event.ts);
            } catch {
                // 單筆壞封包不阻斷其餘重建。
            }
        }
        phase = state.condPhase;
    }
    await database.meta.put({
        key: COND_PHASE_META_KEY,
        phase: phase.map(([lo, hi]) => [lo, hi]),
        throughPortTs: current.ts,
        updatedAt: Date.now(),
    } satisfies CondPhaseMetaRow);
}
