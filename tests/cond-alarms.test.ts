import { describe, expect, it } from 'vitest';
import { COND_STEP_MS } from '../utils/cond';
import { COND_ALARM_RE, planCondAlarms } from '../utils/cond-alarms';
import { MORALE_INTERVAL_MS, TIMER_SAFETY_MS } from '../utils/repair';
import { GameState } from '../utils/state';

const MIN = 60_000;
const BOUNDARY = Math.floor(1_726_000_000_000 / COND_STEP_MS) * COND_STEP_MS;
const AS_OF = BOUNDARY + 30_000;
const NOSAKI_KAI = 1002;
// 錨點取進港時刻時的給糧週期門檻。
const tick = (k: number) => AS_OF + k * MORALE_INTERVAL_MS + TIMER_SAFETY_MS;

const rawShip = (id: number, mst: number, cond: number, hp = 10) => ({
    api_id: id, api_ship_id: mst, api_lv: 1, api_nowhp: hp, api_maxhp: 10, api_cond: cond, api_ndock_time: 60 * MIN,
    api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 1, api_bull: 1,
});

// 野埼改旗艦、52 的僚艦、cond 10 入渠中的僚艦（入渠中不算給糧對象）。
function supplyPort() {
    const state = new GameState();
    state.applyEvent('api_port/port', {
        // 4 號艦（cond 45）不在編成，留給編成變更的測試換上。
        api_ship: [rawShip(1, NOSAKI_KAI, 49), rawShip(2, 2, 52), rawShip(3, 2, 10, 5), rawShip(4, 2, 45)],
        api_deck_port: [{ api_name: '第1艦隊', api_ship: [1, 2, 3, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [{ api_id: 1, api_state: 1, api_ship_id: 3, api_complete_time: AS_OF + 60 * MIN }],
    }, undefined, AS_OF);
    return state;
}

describe('planCondAlarms', () => {
    it('野埼給糧中只排 54 通知，錨點不可考時取進港時刻', () => {
        const alarms = planCondAlarms(supplyPort().fleets(), ['第1艦隊'], AS_OF, AS_OF);
        // 52+3 在第 1 個門檻即達 54；入渠中的 cond 10 不列入給糧對象。
        expect(alarms).toEqual([{ name: '第1艦隊 給糧完了（cond→54）', when: tick(1) }]);
        expect(COND_ALARM_RE.test(alarms[0]!.name)).toBe(true);
    });

    it('高速修復後入渠艦補到 40 並成為給糧對象，54 通知延後而不會提早', () => {
        const state = supplyPort();
        state.applyEvent('api_req_nyukyo/speedchange', {}, { api_ndock_id: '1' }, AS_OF + MIN);
        // 40 → 第 1 門檻自然回復到 49 +3=52 → 第 2 門檻 49+6=55（上限 54）。
        expect(planCondAlarms(state.fleets(), ['第1艦隊'], AS_OF, AS_OF + MIN))
            .toEqual([{ name: '第1艦隊 給糧完了（cond→54）', when: tick(2) }]);
    });

    it('進港後的編成變更重置錨點時，以實際錨點推算', () => {
        const state = supplyPort();
        // 入渠艦換成 cond 45：重置後第 1 門檻 49+3=52、第 2 門檻 49+6 達 54。
        state.applyEvent('api_req_hensei/change', {}, { api_id: '1', api_ship_idx: '2', api_ship_id: '4' }, AS_OF + 5 * MIN);
        expect(planCondAlarms(state.fleets(), ['第1艦隊'], AS_OF, AS_OF + 5 * MIN))
            .toEqual([{ name: '第1艦隊 給糧完了（cond→54）', when: AS_OF + 5 * MIN + 2 * MORALE_INTERVAL_MS + TIMER_SAFETY_MS }]);
    });

    it('無給糧時排 49 通知，取 ceil(缺口/3)×3 分鐘的上界；全員 ≥49 不排', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', {
            api_ship: [rawShip(1, 2, 40), rawShip(2, 2, 49), rawShip(3, 2, 49)],
            api_deck_port: [
                { api_name: '第1艦隊', api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
                { api_name: '第2艦隊', api_ship: [2, 3, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
            ],
            api_ndock: [],
        }, undefined, AS_OF);
        const alarms = planCondAlarms(state.fleets(), ['第1艦隊', '第2艦隊'], AS_OF, AS_OF);
        expect(alarms).toEqual([{ name: '第1艦隊 疲労回復（cond 40→49）', when: AS_OF + 9 * MIN }]);
        expect(COND_ALARM_RE.test(alarms[0]!.name)).toBe(true);
        expect(COND_ALARM_RE.test('入渠ドック1 修理完了')).toBe(false);
    });

    it('只剩野埼自身未滿 49 時沒有給糧對象，改排 49 通知', () => {
        const state = new GameState();
        state.applyEvent('api_port/port', {
            api_ship: [rawShip(1, NOSAKI_KAI, 40), rawShip(2, 2, 54)],
            api_deck_port: [{ api_name: '第1艦隊', api_ship: [1, 2, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [],
        }, undefined, AS_OF);
        expect(planCondAlarms(state.fleets(), ['第1艦隊'], AS_OF, AS_OF))
            .toEqual([{ name: '第1艦隊 疲労回復（cond 40→49）', when: AS_OF + 9 * MIN }]);
    });
});
