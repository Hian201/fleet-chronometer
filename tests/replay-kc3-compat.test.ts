import { describe, expect, it } from 'vitest';
import type { ReplayRow } from '../utils/db';
import {
    KC3_REPLAY_DIRECT_URL_LIMIT, KC3_REPLAY_PLAYER_URL, toKc3Replay, toKc3ReplayUrl,
} from '../utils/replay';

function replay(): ReplayRow {
    return {
        sortieKey: 10,
        ts: 1_700_000_000_000,
        world: 6,
        mapnum: 5,
        diff: 0,
        combined: 0,
        fleetnum: 1,
        fleet1: [{
            mst_id: 100, lv: 99,
            equip: [1, -1], stars: [0, 0], ace: [0, 0], exequip: -1,
            nowhp: 30, maxhp: 30,
        }],
        fleet2: [],
        battles: [
            { node: 1, data: { api_formation: [1, 1, 1] } },
            { node: 2, data: { api_formation: [1, 1, 1] }, yasen: { api_hougeki: {} } },
        ],
    };
}

describe('KC3Kai battleplayer 相容輸出', () => {
    it('沒有夜戰時輸出空物件，讓 player.js 的 Object.keys(yasen) 可安全執行', () => {
        const out = toKc3Replay(replay()) as {
            time: number; fleet1: Array<{ lv: number; level: number }>;
            battles: Array<{ yasen: unknown }>;
        };

        expect(out.time).toBe(1_700_000_000);
        expect(out.fleet1[0]).toMatchObject({ lv: 99, level: 99 });
        expect(out.battles[0].yasen).toEqual({});
        expect(() => Object.keys(out.battles[0].yasen as object)).not.toThrow();
        expect(out.battles[1].yasen).toEqual({ api_hougeki: {} });
    });

    it('直接播放 URL 使用 KC3Kai 原生 raw JSON fragment，解碼後等於複製的 JSON', () => {
        const row = replay();
        const url = toKc3ReplayUrl(row);

        expect(url.startsWith(`${KC3_REPLAY_PLAYER_URL}#`)).toBe(true);
        const fragment = url.slice(url.indexOf('#') + 1);
        expect(JSON.parse(decodeURIComponent(fragment))).toEqual(toKc3Replay(row));
        expect(KC3_REPLAY_DIRECT_URL_LIMIT).toBe(30_000);
    });

    it.each([2, 3, 4])('第 %i 艦隊獨立出擊以 fleet1 播放，並保留來源艦隊編號', sourceFleetnum => {
        const out = toKc3Replay({ ...replay(), fleetnum: sourceFleetnum }) as {
            fleetnum: number; sourceFleetnum: number; fleet1: unknown[];
        };

        expect(out).toMatchObject({ fleetnum: 1, sourceFleetnum });
        expect(out.fleet1).toHaveLength(1);
    });
});
