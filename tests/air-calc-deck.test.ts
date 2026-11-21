import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReplayRow, ReplayShip, ReplaySupportShip } from '../utils/db';
import {
    AIR_CALC_PAGE_URL, airCalcUrl, buildReplayAirCalcDeck, buildReplayDeckBuilder,
} from '../utils/deckbuilder';
import { snapshotDeck } from '../utils/replay';
import { parseSortieImport } from '../utils/sortie-import';
import { GameState } from '../utils/state';
import { validateBackupEnvelope } from '../utils/backup';

const sample = JSON.parse(readFileSync(new URL('../samples/61-3.json', import.meta.url), 'utf8'));
const sample614 = JSON.parse(readFileSync(new URL('../samples/61-4.json', import.meta.url), 'utf8'));
const sample615 = JSON.parse(readFileSync(new URL('../samples/61-5-jibun-rengou-node52.json', import.meta.url), 'utf8'));
const start2 = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

function masterState(): GameState {
    const state = new GameState();
    state.applyEvent('api_start2/getData', start2);
    return state;
}

const ship = (mst_id: number, lv: number, over: Partial<ReplayShip> = {}): ReplayShip => ({
    mst_id, lv, equip: [11], stars: [2], ace: [7], exequip: -1, nowhp: 90, maxhp: 100, cond: 49,
    ...over,
});

const supportShip = (mst_id: number, over: Partial<ReplaySupportShip> = {}): ReplaySupportShip => ({
    mst_id, lv: 80, equip: [21], stars: [1], ace: [6], exequip: -1, cond: 48,
    ...over,
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
    it('帶我方編成、連合旗標、支援艦隊（f3／f4）、陸航（ac）與各節點敵艦隊', () => {
        const deck = buildReplayAirCalcDeck(replay()) as Record<string, any>;
        expect(deck.version).toBe(4);
        expect(deck.f1).toMatchObject({ t: 1, s1: { id: 364, lv: 97, hp: 100 } });
        expect(deck.f2.s1.id).toBe(538);
        // kc-web 2.54.0 只以 f1（或連合 f1＋f2）計主隊制空，f3／f4 支援艦隊獨立計算、不污染本隊。
        expect(deck.f3.s1).toMatchObject({ id: 20, lv: 80, items: { i1: { id: 21, rf: 1, mas: 6 } } });
        expect(deck.f4.s1).toMatchObject({ id: 21, lv: 80, items: { i1: { id: 21, rf: 1, mas: 6 } } });
        expect(deck.a1).toMatchObject({
            mode: 1,
            items: { i1: { id: 225, rf: 4, mas: 7, ac: 18 } },
        });
        expect(deck.a1.items.i1).not.toHaveProperty('count');
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

    it('陸航 sp 依各波實際出擊節點排列，同一節點兩波就寫兩次；未配置／轉換中中隊不輸出', () => {
        const withMixedSquads = replay({
            lbas: [
                {
                    areaId: 61, rid: 1, action: 1, distance: 8,
                    squadrons: [
                        { mst: 225, count: 14, maxCount: 18, stars: 4, ace: 7, state: 1, cond: 1 },
                        { mst: 175, count: 0, maxCount: 18, stars: 0, ace: 0, state: 2, cond: 1 },
                        { mst: 0, count: 0, maxCount: 18, stars: 0, ace: 0, state: 0, cond: 1 },
                    ],
                },
                {
                    areaId: 61, rid: 3, action: 2, distance: 4,
                    squadrons: [
                        { mst: 175, count: 18, maxCount: 18, stars: 0, ace: 7, state: 1, cond: 1 },
                    ],
                },
            ],
        });
        const deck = buildReplayAirCalcDeck(withMixedSquads) as Record<string, any>;
        expect(deck.a1.items).toEqual({ i1: { id: 225, rf: 4, mas: 7, ac: 14 } });
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
        expect(deck.a3).toEqual({
            mode: 2,
            items: { i1: { id: 175, rf: 0, mas: 7, ac: 18 } },
        });
    });

    it('出擊札但該場 0 波次出動（例如道中撤退）改輸出待機，避免 kc-web 預設轟炸第 1 戰；退避／休息也正規化為待機', () => {
        const retreated = replay({
            battles: [sample.battles[0]], // node 25 沒有 api_air_base_attack
            lbas: [
                {
                    areaId: 61, rid: 1, action: 1, distance: 8,
                    squadrons: [{ mst: 225, count: 18, maxCount: 18, stars: 0, ace: 7, state: 1, cond: 1 }],
                },
                {
                    areaId: 61, rid: 2, action: 3, distance: 8,
                    squadrons: [{ mst: 225, count: 18, maxCount: 18, stars: 0, ace: 7, state: 1, cond: 1 }],
                },
                {
                    areaId: 61, rid: 3, action: 4, distance: 8,
                    squadrons: [{ mst: 225, count: 18, maxCount: 18, stars: 0, ace: 7, state: 1, cond: 1 }],
                },
            ],
        });
        const deck = buildReplayAirCalcDeck(retreated) as Record<string, any>;
        expect(deck.a1.mode).toBe(0);
        expect(deck.a1.sp).toBeUndefined();
        expect(deck.a1.items.i1.id).toBe(225);
        expect(deck.a2.mode).toBe(0);
        expect(deck.a3.mode).toBe(0);
    });

    it('沒有封包的摘要戰鬥節點仍可補敵艦 id，不猜陣形；基地空襲（raid）不混入 s.c，且無法觀測陸航波次時保守轉待機', () => {
        const deck = buildReplayAirCalcDeck(replay({ battles: [] }), {
            routeNodes: [
                { node: 40, kind: 'raid', enemyIds: [2119, 2361] },
                { node: 7, kind: 'battle', enemyIds: [1501, 1502], enemyIdsEscort: [1601] },
            ],
        }) as Record<string, any>;
        expect(deck.s.c).toEqual([{
            c: 7,
            f1: { s: [{ id: 1501 }, { id: 1502 }] },
            f2: { s: [{ id: 1601 }] },
        }]);
        // 摘要補出的節點沒有 api_air_base_attack 可確認波次；保守轉待機（mode 0）並保留編成，不讓 kc-web 誤算打第 1 戰。
        expect(deck.a1.mode).toBe(0);
        expect(deck.a1.sp).toBeUndefined();
        expect(deck.a1.items.i1.id).toBe(225);
    });

    it('單艦隊不寫 f1.t；第 3 艦隊遊撃部隊獨立出擊不重複輸出 f3，仍保留第 4 艦隊支援', () => {
        const strikingForce = replay({
            combined: 0,
            fleetnum: 3,
            fleet1: [ship(364, 97), ship(538, 90)],
            fleet2: [],
            fleet3: [ship(364, 97), ship(538, 90)],
            fleet4: [supportShip(21)],
        });
        const air = buildReplayAirCalcDeck(strikingForce) as Record<string, any>;
        const copy = buildReplayDeckBuilder(strikingForce) as Record<string, any>;
        expect(air.f1.t).toBeUndefined();
        expect(air.f2).toBeUndefined();
        expect(air.f3).toBeUndefined();
        expect(air.f4.s1.id).toBe(21);
        expect(copy.f3).toBeUndefined();
        expect(copy.f4.s1.id).toBe(21);
        expect(copy).not.toHaveProperty('s');
        expect(copy.a1.sp).toBeUndefined();
    });

    it('輸出艦娘運、補強増設開放、艦載機搭載數（僅航空機）、對潛改修（僅 kyouka[6]>0）與特殊補強道具', () => {
        const state = masterState();
        const r = replay({
            fleet1: [
                // 蒼龍改二（mst 197，4 槽）：帶艦戰(21)、艦攻(16)、主砲(1)，其中槽 1 未補滿（15/18）
                ship(197, 99, {
                    equip: [21, 16, 1, -1, -1],
                    stars: [10, 0, 4, 0, 0],
                    ace: [7, 7, -1, -1, -1],
                    exequip: 274, exstars: 6, exace: 0,
                    luck: 42,
                    kyouka: [10, 0, 20, 15, 22, 0, 0],
                    asw: 0,
                    onslot: [15, 35, 23, 7, 0],
                    exOpen: true,
                    spEffect: 2,
                }),
                // 矢矧改二乙（mst 668）：無增設、對潛改修 +9（asw=115）、海色リボン
                ship(668, 99, {
                    equip: [50, -1, -1, -1, -1],
                    stars: [10, 0, 0, 0, 0],
                    ace: [-1, -1, -1, -1, -1],
                    exequip: -1,
                    kyouka: [51, 64, 52, 42, 10, 0, 9],
                    asw: 115,
                    onslot: [1, 1, 2, 2, 0],
                    exOpen: false,
                    spEffect: 1,
                }),
                // 運與對潛都未改修（kyouka[6]=0）：不應輸出 asw 以免裝備加成差異造出假對潛改修
                ship(364, 97, {
                    equip: [137, -1, -1, -1, -1],
                    stars: [6, 0, 0, 0, 0],
                    ace: [-1, -1, -1, -1, -1],
                    exequip: -1,
                    kyouka: [21, 0, 50, 15, 0, 0, 0],
                    asw: 40,
                    onslot: [3, 3, 3, 3, 0],
                    exOpen: false,
                }),
            ],
        });
        const deck = buildReplayAirCalcDeck(r, {
            masterShips: state.master,
            masterGears: state.masterGears,
        }) as Record<string, any>;

        expect(deck.f1.s1).toMatchObject({
            id: 197, lv: 99, luck: 42, exa: true, hp: 100,
            spi: [{ kind: 2, fp: 2, tp: 1, ar: 1, ev: 2 }],
        });
        expect(deck.f1.s1.asw).toBeUndefined();
        expect(deck.f1.s1.items.i1).toEqual({ id: 21, rf: 10, mas: 7, ac: 15 });
        expect(deck.f1.s1.items.i2).toEqual({ id: 16, rf: 0, mas: 7, ac: 35 });
        // 主砲（mst 1）不是航空機，不寫 ac
        expect(deck.f1.s1.items.i3).toEqual({ id: 1, rf: 4, mas: 0 });
        expect(deck.f1.s1.items.ix).toEqual({ id: 274, rf: 6, mas: 0 });

        // 矢矧改二乙：luck 由 start2 基礎運(18) + kyouka[4](10) = 28 還原，asw 因 kyouka[6]=9 而輸出
        expect(deck.f1.s2).toMatchObject({
            id: 668, lv: 99, luck: 28, exa: false, hp: 100, asw: 115,
            spi: [{ kind: 1, fp: 0, tp: 1, ar: 1, ev: 0 }],
        });

        // Warspite改：kyouka[6]=0 不輸出 asw；luck = 70 + 0 = 70
        expect(deck.f1.s3.luck).toBe(70);
        expect(deck.f1.s3.asw).toBeUndefined();
        expect(deck.f1.s3.exa).toBe(false);
        expect(deck.f1.s3.items.i1).toEqual({ id: 137, rf: 6, mas: 0 });
    });

    it('真實 KC3Kai 樣本（61-3／61-4／61-5）：保留 f3／f4、還原運改修、3 槽艦補強増設歸位到 ix 且排除基地空襲', () => {
        const state = masterState();
        const opts = { masterShips: state.master, masterGears: state.masterGears };

        const parsed613 = parseSortieImport(sample);
        const deck613 = buildReplayAirCalcDeck(parsed613.replay, {
            ...opts,
            routeNodes: parsed613.rows.map(r => ({
                node: r.node, kind: r.kind, enemyIds: r.enemyIds, enemyIdsEscort: r.enemyIdsEscort,
            })),
        }) as Record<string, any>;
        expect(deck613.f1.t).toBe(1);
        expect(deck613.f2.s1.id).toBeGreaterThan(0);
        expect(deck613.f3.s1.id).toBe(538);
        expect(deck613.f4.s1.id).toBe(651);
        // 61-3 有 5 戰＋1 基地空襲，s.c 只含 5 場本隊戰鬥
        expect(deck613.s.c).toHaveLength(5);
        // 3 槽艦（mst 652，slotNum=3，equip=[217,501,501,0,203]）的補強増設 203 必須落在 ix 而非 i5
        const dd652 = Object.values<any>(deck613.f1).find(v => v?.id === 652);
        expect(dd652.exa).toBe(true);
        expect(dd652.items.ix?.id).toBe(203);
        expect(dd652.items.i5).toBeUndefined();
        // 陸航 1、2 打王點 53，陸航 3 防空維持 mode 2
        expect(deck613.a1.sp).toEqual([53, 53]);
        expect(deck613.a2.sp).toEqual([53, 53]);
        expect(deck613.a3.mode).toBe(2);
        expect(deck613.a3.sp).toBeUndefined();

        const parsed614 = parseSortieImport(sample614);
        const deck614 = buildReplayAirCalcDeck(parsed614.replay, opts) as Record<string, any>;
        expect(deck614.f1.t).toBeUndefined();
        expect(deck614.f2).toBeUndefined();
        // 矢矧改二乙（mst 668，基礎運 18 + kyouka[4]=10 → 28）；補強増設 413 歸位到 ix
        expect(deck614.f1.s1.luck).toBe(28);
        expect(deck614.f1.s1.exa).toBe(true);
        expect(deck614.f1.s1.items.ix?.id).toBe(413);

        const parsed615 = parseSortieImport(sample615);
        const deck615 = buildReplayAirCalcDeck(parsed615.replay, {
            ...opts,
            routeNodes: parsed615.rows.map(r => ({
                node: r.node, kind: r.kind, enemyIds: r.enemyIds, enemyIdsEscort: r.enemyIdsEscort,
            })),
        }) as Record<string, any>;
        expect(deck615.f1.t).toBe(2);
        expect(deck615.f3.s1.id).toBe(651);
        expect(deck615.f4.s1.id).toBe(538);
        // 大和改二（mst 916，5 槽，kyouka[4]=15）補強増設 460 歸位到 ix
        expect(deck615.f1.s1.items.ix?.id).toBe(460);
        expect(deck615.f1.s1.exa).toBe(true);
        expect(deck615.s.c).toHaveLength(7);
    });

    it('snapshotDeck 與備份驗證保留運、對潛、搭載數、增設開放與特殊補強道具', () => {
        const state = masterState();
        state.applyEvent('api_get_member/slot_item', {
            api_slot_item: [
                { api_id: 9001, api_slotitem_id: 21, api_level: 10, api_alv: 7 },
                { api_id: 9002, api_slotitem_id: 274, api_level: 4, api_alv: 0 },
            ],
        });
        state.applyEvent('api_port/port', {
            api_ship: [{
                api_id: 101, api_ship_id: 197, api_lv: 99, api_nowhp: 70, api_maxhp: 72, api_cond: 49,
                api_slot: [9001, -1, -1, -1, -1], api_onslot: [16, 35, 23, 7, 0], api_slot_ex: 9002,
                api_kyouka: [10, 0, 20, 15, 5, 2, 4],
                api_lucky: [25, 84], api_taisen: [62, 60],
                api_sp_effect_items: [{ api_kind: 2, api_houg: 2, api_kaih: 2 }],
            }],
            api_deck_port: [{ api_id: 1, api_ship: [101, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
            api_ndock: [], api_material: [], api_basic: { api_level: 120 }, api_count_kdock: 0, api_combined_flag: 0,
        });
        const snapped = snapshotDeck(state, 0);
        expect(snapped[0]).toMatchObject({
            mst_id: 197, lv: 99, luck: 25, asw: 62, onslot: [16, 35, 23, 7, 0], exOpen: true, spEffect: 2,
        });
        const validated = validateBackupEnvelope({
            schemaVersion: 5,
            kind: 'replays',
            exportedAt: 1_700_000_000_000,
            tables: {
                replays: [{
                    sortieKey: 1, ts: 1_700_000_000_000, world: 1, mapnum: 1, diff: 0,
                    combined: 0, fleetnum: 1, fleet1: snapped, fleet2: [], battles: [],
                }],
            },
        });
        expect(validated.tables.replays?.[0].fleet1[0]).toMatchObject({
            luck: 25, asw: 62, onslot: [16, 35, 23, 7, 0], exOpen: true, spEffect: 2,
        });
        expect(() => validateBackupEnvelope({
            schemaVersion: 5,
            kind: 'replays',
            exportedAt: 1_700_000_000_000,
            tables: {
                replays: [{
                    sortieKey: 1, ts: 1_700_000_000_000, world: 1, mapnum: 1, diff: 0,
                    combined: 0, fleetnum: 1,
                    fleet1: [{ ...snapped[0], spEffect: 3 }],
                    fleet2: [], battles: [],
                }],
            },
        })).toThrow(/spEffect/);
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

describe('相容資料的艦隊編號修復', () => {
    it('第3艦隊獨立出擊被記成連合艦隊時，匯出以修復後的單艦隊為準且不重複輸出 f3', () => {
        const legacy = replay({ combined: 2, fleetnum: 3, fleet3: [ship(300, 50)], fleet2: [ship(538, 90)] });
        const deck = buildReplayDeckBuilder(legacy) as Record<string, any>;
        expect(deck.f1.s1.id).toBe(300);
        expect(deck.f2).toBeUndefined();
        expect(deck.f3).toBeUndefined();
        const air = buildReplayAirCalcDeck(legacy) as Record<string, any>;
        expect(air.f1.t).toBeUndefined();
        expect(air.f3).toBeUndefined();
        expect(legacy.combined).toBe(2);
    });
});
