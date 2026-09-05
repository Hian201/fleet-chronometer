import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReplayRow } from '../utils/db';
import { decompressFromEncodedURIComponent } from '../utils/lz-string-uri';
import {
    KC3_REPLAY_DIRECT_URL_LIMIT, KC3_REPLAY_PLAYER_URL, kc3ReplayPlayerUrl,
    toKc3Replay, toKc3ReplayUrl,
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

    it('直接播放 URL 使用 KC3Kai 原生 #fromLZString=，解壓後等於複製的 JSON', () => {
        const row = replay();
        const url = toKc3ReplayUrl(row);
        const prefix = `${KC3_REPLAY_PLAYER_URL}#fromLZString=`;

        expect(url.startsWith(prefix)).toBe(true);
        const encoded = url.slice(prefix.length);
        expect(JSON.parse(decompressFromEncodedURIComponent(encoded)!)).toEqual(toKc3Replay(row));
        expect(KC3_REPLAY_DIRECT_URL_LIMIT).toBe(30_000);
    });

    it('連合艦隊多節點重播壓縮後仍低於直接播放上限', () => {
        const sample = JSON.parse(
            readFileSync(new URL('../samples/61-5-jibun-rengou-node52.json', import.meta.url), 'utf8'),
        ) as {
            combined: number; fleetnum: number; world: number; mapnum: number; diff: number;
            time: number; hq: string;
            fleet1: Array<{ mst_id: number; level: number; equip: number[]; stars: number[]; ace: number[] }>;
            fleet2: Array<{ mst_id: number; level: number; equip: number[]; stars: number[]; ace: number[] }>;
            battles: Array<{ node: number; data?: unknown; yasen?: unknown }>;
        };
        const row: ReplayRow = {
            sortieKey: 1,
            ts: sample.time * 1000,
            world: sample.world,
            mapnum: sample.mapnum,
            diff: sample.diff,
            combined: sample.combined,
            fleetnum: sample.fleetnum,
            fleet1: sample.fleet1.map(s => ({
                mst_id: s.mst_id, lv: s.level, equip: s.equip, stars: s.stars, ace: s.ace,
                exequip: -1, nowhp: 0, maxhp: 1,
            })),
            fleet2: sample.fleet2.map(s => ({
                mst_id: s.mst_id, lv: s.level, equip: s.equip, stars: s.stars, ace: s.ace,
                exequip: -1, nowhp: 0, maxhp: 1,
            })),
            battles: sample.battles.map(b => ({ node: b.node, data: b.data ?? {}, yasen: b.yasen })),
        };
        const json = JSON.stringify(toKc3Replay(row));
        const rawUrl = `${KC3_REPLAY_PLAYER_URL}#${encodeURIComponent(json)}`;
        const url = toKc3ReplayUrl(row);

        expect(sample.combined).toBeGreaterThan(0);
        expect(rawUrl.length).toBeGreaterThan(KC3_REPLAY_DIRECT_URL_LIMIT);
        expect(url.length).toBeLessThan(KC3_REPLAY_DIRECT_URL_LIMIT);
        expect(url).toBe(kc3ReplayPlayerUrl(json));
        expect(JSON.parse(decompressFromEncodedURIComponent(
            url.slice(`${KC3_REPLAY_PLAYER_URL}#fromLZString=`.length),
        )!)).toEqual(toKc3Replay(row));
    });

    it.each([2, 3, 4])('第 %i 艦隊獨立出擊以 fleet1 播放，並保留來源艦隊編號', sourceFleetnum => {
        const out = toKc3Replay({ ...replay(), fleetnum: sourceFleetnum }) as {
            fleetnum: number; sourceFleetnum: number; fleet1: unknown[];
        };

        expect(out).toMatchObject({ fleetnum: 1, sourceFleetnum });
        expect(out.fleet1).toHaveLength(1);
    });
});
