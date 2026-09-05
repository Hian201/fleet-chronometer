import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReplayRow, ReplayShip, ReplaySupportShip } from '../utils/db';
import {
    AIR_CALC_PAGE_URL, airCalcUrl, buildReplayAirCalcDeck, buildReplayDeckBuilder,
} from '../utils/deckbuilder';

const sample = JSON.parse(readFileSync(new URL('../samples/61-3.json', import.meta.url), 'utf8'));

const ship = (mst_id: number, lv: number): ReplayShip => ({
    mst_id, lv, equip: [11], stars: [2], ace: [7], exequip: -1, nowhp: 90, maxhp: 100, cond: 49,
});

const supportShip = (mst_id: number): ReplaySupportShip => ({
    mst_id, lv: 80, equip: [21], stars: [1], ace: [6], exequip: -1, cond: 48,
});

const replay = (over: Partial<ReplayRow> = {}): ReplayRow => ({
    sortieKey: 61, ts: 1, world: 61, mapnum: 3, diff: 4,
    combined: 1, fleetnum: 1,
    fleet1: [ship(364, 97)],
    fleet2: [ship(538, 90)],
    fleet3: [supportShip(20)],
    fleet4: [supportShip(21)],
    lbas: [{
        areaId: 61, rid: 1, action: 1, distance: 8,
        squadrons: [{ mst: 225, count: 18, maxCount: 18, stars: 4, ace: 7, state: 1, cond: 1 }],
    }],
    battles: sample.battles.map((battle: { node: number; data: unknown; yasen?: unknown }) => ({
        node: battle.node, data: battle.data, yasen: battle.yasen,
    })),
    ...over,
});

describe('出擊紀錄 → 制空権シミュレータ DeckBuilder', () => {
    it('帶我方編成、連合旗標、陸航與各節點敵艦隊，不含支援艦隊', () => {
        const deck = buildReplayAirCalcDeck(replay()) as Record<string, any>;
        expect(deck.version).toBe(4);
        expect(deck.f1).toMatchObject({ t: 1, s1: { id: 364, lv: 97 } });
        expect(deck.f2.s1.id).toBe(538);
        expect(deck).not.toHaveProperty('f3');
        expect(deck).not.toHaveProperty('f4');
        expect(deck.a1).toMatchObject({
            mode: 1,
            items: { i1: { id: 225, rf: 4, mas: 7, count: 18 } },
        });
        expect(deck.s).toMatchObject({ a: 61, i: 3 });
        expect(deck.s.c.map((cell: { c: number }) => cell.c)).toEqual([25, 50, 51, 52, 53]);
    });

    it('節點敵編成與陣形取自原始封包；連合隨伴進 f2', () => {
        const deck = buildReplayAirCalcDeck(replay()) as Record<string, any>;
        const first = deck.s.c[0];
        const boss = deck.s.c.find((cell: { c: number }) => cell.c === 53);
        expect(first).toMatchObject({ c: 25, pf: 14, ef: 6 });
        expect(first.f1.s.map((ship: { id: number }) => ship.id)).toEqual(
            sample.battles[0].data.api_ship_ke.filter((id: number) => id > 0),
        );
        expect(boss.pf).toBe(12);
        expect(boss.ef).toBe(14);
        expect(boss.f1.s.map((ship: { id: number }) => ship.id)).toEqual([2343, 1759, 1759, 1664, 2322, 2319]);
        expect(boss.f2.s.map((ship: { id: number }) => ship.id)).toEqual([1862, 2051, 2051, 2051, 1623, 1623]);
        expect(boss.f1.s[0]).toEqual({ id: 2343 });
    });

    it('陸航 sp 依各波實際出擊節點排列，同一節點兩波就寫兩次', () => {
        const deck = buildReplayAirCalcDeck(replay()) as Record<string, any>;
        expect(deck.a1.sp).toEqual(
            sample.battles.flatMap((battle: { node: number; data: { api_air_base_attack?: unknown } }) => (
                Array.isArray(battle.data.api_air_base_attack)
                    ? battle.data.api_air_base_attack
                        .filter((wave: { api_base_id?: number }) => wave.api_base_id === 1)
                        .map(() => battle.node)
                    : []
            )),
        );
        expect(deck.a1.sp).toContain(53);
    });

    it('沒有封包的摘要節點仍可補敵艦 id，不猜陣形', () => {
        const deck = buildReplayAirCalcDeck(replay({ battles: [] }), {
            routeNodes: [
                { node: 7, enemyIds: [1501, 1502], enemyIdsEscort: [1601] },
            ],
        }) as Record<string, any>;
        expect(deck.s.c).toEqual([{
            c: 7,
            f1: { s: [{ id: 1501 }, { id: 1502 }] },
            f2: { s: [{ id: 1601 }] },
        }]);
    });

    it('單艦隊不寫 f1.t；複製用 JSON 不加 s／sp、仍含支援艦隊', () => {
        const single = replay({ combined: 0, fleet2: [] });
        const air = buildReplayAirCalcDeck(single) as Record<string, any>;
        const copy = buildReplayDeckBuilder(single) as Record<string, any>;
        expect(air.f1.t).toBeUndefined();
        expect(copy).not.toHaveProperty('s');
        expect(copy.a1.sp).toBeUndefined();
        expect(copy.f3.s1.id).toBe(20);
        expect(copy.f4.s1.id).toBe(21);
    });

    it('跳轉網址走 hash #import，不把 predeck 放進 query', () => {
        const url = airCalcUrl(buildReplayAirCalcDeck(replay()));
        const prefix = `${AIR_CALC_PAGE_URL}#import:`;
        expect(url.startsWith(prefix)).toBe(true);
        expect(url).not.toContain('?');
        const payload = JSON.parse(decodeURIComponent(url.slice(prefix.length)));
        expect(payload.predeck.s.c[payload.predeck.s.c.length - 1].c).toBe(53);
    });
});
