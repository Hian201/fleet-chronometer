import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import {
    applyArchivedQuestObservations, captureQuestObserved, readQuestClaim,
} from '../utils/quest-observed';
import { buildQuestFlow } from '../utils/quest-flow';

function memoryTable() {
    const rows = new Map<number, { eventId: number; questNo: number; ts: number }>();
    return {
        rows,
        questObserved: {
            async put(row: { eventId: number; questNo: number; ts: number }) {
                rows.set(row.eventId, row);
            },
        },
    };
}

describe('readQuestClaim', () => {
    it('只接受 clearitemget 的正整數 api_quest_id', () => {
        expect(readQuestClaim('api_req_quest/clearitemget', { api_quest_id: '210' })).toBe(210);
        expect(readQuestClaim('api_req_quest/stop', { api_quest_id: '210' })).toBeNull();
        expect(readQuestClaim('api_req_quest/clearitemget', { api_quest_id: '0' })).toBeNull();
        expect(readQuestClaim('api_req_quest/clearitemget', {})).toBeNull();
    });
});

describe('captureQuestObserved', () => {
    it('同一 eventId 再寫一次不增加列數', async () => {
        const tables = memoryTable();
        const event = {
            id: 9, ts: 1_000, path: 'api_req_quest/clearitemget', req: { api_quest_id: '210' },
        };
        await captureQuestObserved(tables, event);
        await captureQuestObserved(tables, event);
        expect([...tables.rows.values()]).toEqual([{ eventId: 9, questNo: 210, ts: 1_000 }]);
    });
});

describe('applyArchivedQuestObservations', () => {
    it('已重播的 eventId 不重複計數；裁掉的列會補上', () => {
        const state = new GameState();
        state.applyEvent('api_req_quest/clearitemget', {}, { api_quest_id: '210' }, 2_000);
        applyArchivedQuestObservations(state, [
            { eventId: 1, questNo: 210, ts: 1_000 },
            { eventId: 2, questNo: 210, ts: 2_000 },
        ], new Set([2]));
        expect(state.questObservedCompletions_().get(210)).toEqual({ count: 2, lastTs: 2_000 });
    });

    it('日任用領獎時間對目前週期；跨日重置後不再當本期完成', () => {
        const state = new GameState();
        const claimed = Date.UTC(2026, 8, 8, 20, 0);
        applyArchivedQuestObservations(state, [
            { eventId: 1, questNo: 201, ts: claimed },
        ], new Set());

        const sameCycle = buildQuestFlow(state, new Set(), Date.UTC(2026, 8, 9, 19, 0));
        expect(sameCycle.byNo.get(201)?.observedCurrentPeriod).toBe(true);

        const nextCycle = buildQuestFlow(state, new Set(), Date.UTC(2026, 8, 9, 20, 0));
        expect(nextCycle.byNo.get(201)?.status).toBe('observed-complete');
        expect(nextCycle.byNo.get(201)?.observedCurrentPeriod).toBe(false);
    });

    it('季任用 3／6／9／12 月 1 日 05:00 JST，不使用西曆季', () => {
        const state = new GameState();
        const claimed = Date.UTC(2026, 7, 20, 3, 0);
        applyArchivedQuestObservations(state, [
            { eventId: 1, questNo: 284, ts: claimed },
        ], new Set());

        const sameQuarter = buildQuestFlow(state, new Set(), Date.UTC(2026, 7, 31, 19, 0));
        expect(sameQuarter.byNo.get(284)?.observedCurrentPeriod).toBe(true);

        const septemberReset = buildQuestFlow(state, new Set(), Date.UTC(2026, 7, 31, 20, 0));
        expect(septemberReset.byNo.get(284)?.observedCurrentPeriod).toBe(false);

        const marchQuarter = new GameState();
        applyArchivedQuestObservations(marchQuarter, [
            { eventId: 1, questNo: 284, ts: Date.UTC(2026, 2, 15, 3, 0) },
        ], new Set());
        expect(buildQuestFlow(marchQuarter, new Set(), Date.UTC(2026, 3, 2, 3, 0))
            .byNo.get(284)?.observedCurrentPeriod).toBe(true);
        expect(buildQuestFlow(marchQuarter, new Set(), Date.UTC(2026, 4, 31, 20, 0))
            .byNo.get(284)?.observedCurrentPeriod).toBe(false);
    });

    it('年任保存觀測紀錄，但不自行對齊年度週期', () => {
        const state = new GameState();
        applyArchivedQuestObservations(state, [
            { eventId: 1, questNo: 946, ts: Date.UTC(2026, 8, 1) },
        ], new Set());
        const model = buildQuestFlow(state, new Set(), Date.UTC(2026, 8, 2));
        expect(model.byNo.get(946)?.status).toBe('observed-complete');
        expect(model.byNo.get(946)?.observedCurrentPeriod).toBe(false);
    });
});
