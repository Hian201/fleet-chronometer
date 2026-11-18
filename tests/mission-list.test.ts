import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { monthlyExpeditionCycle } from '../utils/expedition-plan';

// samples/mission-list.json：開發者 2026-11-18 進遠征畫面時的 api_get_member/mission 回應本體。
const sample = JSON.parse(readFileSync(new URL('../samples/mission-list.json', import.meta.url), 'utf8'));
const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const missions: { api_id: number; api_disp_no: string; api_reset_type: number }[] = (master.api_data ?? master).api_mst_mission;

describe('遠征清單（api_get_member/mission）', () => {
    it('真封包：記下清單裡的遠征與下次月常換期', () => {
        const state = new GameState();
        expect(state.missionList).toBeNull();
        state.applyEvent('api_get_member/mission', sample, undefined, 123);
        const list = state.missionList!;
        expect(list.ts).toBe(123);
        expect(list.states.size).toBe(54);
        expect(list.states.get(1)).toBe(2);
        // api_limit_time[0] 是 Unix 秒，與推算的本期截止（每月 15 日 12:00 JST）一致。
        expect(list.resetAt).toBe(Date.parse('2026-12-15T03:00:00Z'));
        expect(list.resetAt).toBe(monthlyExpeditionCycle(Date.parse('2026-11-18T00:00:00Z')).end);
    });

    it('真封包：不在清單的是支援遠征與本期前置還沒成功的月常', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mission', sample);
        const absent = missions.filter(m => !state.missionList!.states.has(m.api_id)).map(m => m.api_disp_no);
        expect(absent).toEqual(['43', '44', 'A5', 'A6', 'B3', 'B4', 'B5', 'B6', 'D3', 'S1', 'S2']);
        // 已通關的一般遠征為 2；本期還沒跑的月常為 1。
        const monthly = missions.filter(m => m.api_reset_type === 1 && state.missionList!.states.has(m.api_id));
        expect(monthly.every(m => state.missionList!.states.get(m.api_id) === 1)).toBe(true);
    });

    it('真封包：月常本期成功後狀態變 2，以它為前置的月常同時出現在清單', () => {
        // samples/mission-list-a4-done.json：同一期跑完 A4（103）後再進遠征畫面取得。
        const after = JSON.parse(readFileSync(new URL('../samples/mission-list-a4-done.json', import.meta.url), 'utf8'));
        const before = new GameState();
        before.applyEvent('api_get_member/mission', sample);
        const state = new GameState();
        state.applyEvent('api_get_member/mission', after);
        const changed = [...new Set([...before.missionList!.states.keys(), ...state.missionList!.states.keys()])]
            .filter(id => before.missionList!.states.get(id) !== state.missionList!.states.get(id))
            .sort((a, b) => a - b)
            .map(id => [id, before.missionList!.states.get(id), state.missionList!.states.get(id)]);
        // 44 的前置是 103（KC3Kai monthlyUnlockTable）。
        expect(changed).toEqual([[44, undefined, 1], [103, 1, 2]]);
        expect(state.missionList!.resetAt).toBe(before.missionList!.resetAt);
    });

    it('清單不是陣列時保留舊值；換期時間缺漏為 null，壞掉的單筆略過', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mission', sample);
        const before = state.missionList;
        state.applyEvent('api_get_member/mission', { api_list_items: null });
        expect(state.missionList).toBe(before);
        state.applyEvent('api_get_member/mission', { api_list_items: [{ api_mission_id: 5, api_state: 2 }, { api_mission_id: 'x', api_state: 1 }, null] });
        expect([...state.missionList!.states]).toEqual([[5, 2]]);
        expect(state.missionList!.resetAt).toBeNull();
    });
});
