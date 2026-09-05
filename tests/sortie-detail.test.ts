// utils/sortie-detail.ts 的驗證。基地航空隊各波與支援艦隊編組的欄位佈局一律以**真封包**
// 對照（samples/61-3.json、61-5-jibun-rengou-node52.json 皆為 KC3Kai logger 匯出，
// battles[].data 就是原封的 kcsapi 戰鬥封包）——CLAUDE.md 驗證原則：欄位結構先拿真封包對照。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReplayRow, ReplayShip, SortieLogRow } from '../utils/db';
import {
    buildSortieDetail, eventStageLabel, eventWorldLabel, groupEventWorlds, groupSorties,
    isEventWorld, lbasWaves, numberSorties, parseMapCode, planEventMapFilter,
    qualifiedEventMapLabel, supportUse,
} from '../utils/sortie-detail';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));

/** KC3Kai 匯出的艦隊快照（level/equip…）→ 本專案的 ReplayShip 欄位命名。 */
function toReplayShip(s: any): ReplayShip {
    return {
        mst_id: s.mst_id, lv: s.level, equip: s.equip ?? [], stars: s.stars ?? [], ace: s.ace ?? [],
        exequip: s.exequip ?? -1, nowhp: s.nowhp ?? 0, maxhp: s.maxhp ?? 0, cond: s.morale ?? 49,
    };
}

/** 用樣本組一筆 ReplayRow（欄位對齊 db.ts 的 ReplayRow，不是 KC3 匯出格式）。 */
function toReplayRow(sample: any, sortieKey = 1000): ReplayRow {
    return {
        sortieKey, ts: (sample.time ?? 0) * 1000,
        world: sample.world, mapnum: sample.mapnum, diff: sample.diff,
        combined: sample.combined, fleetnum: sample.fleetnum,
        fleet1: (sample.fleet1 ?? []).map(toReplayShip),
        fleet2: (sample.fleet2 ?? []).map(toReplayShip),
        battles: sample.battles.map((b: any) => ({ node: b.node, data: b.data, yasen: b.yasen ?? undefined })),
    };
}

/** 依 replay 的節點造出對應的摘要列（db.sorties 每個節點一筆）。 */
function summaryRows(replay: ReplayRow, map: string, opts: { boss?: number; ranks?: Record<number, string> } = {}): SortieLogRow[] {
    return replay.battles.map((b, i) => ({
        eventId: 100 + i, sortieKey: replay.sortieKey, ts: replay.ts + i * 1000,
        map, node: b.node, boss: b.node === opts.boss,
        kind: 'battle' as const, rank: opts.ranks?.[b.node] ?? 'S',
        seiku: null,
        enemyIds: ((b.data as any).api_ship_ke ?? []).filter((v: number) => v > 0),
        enemyIdsEscort: ((b.data as any).api_ship_ke_combined ?? []).filter((v: number) => v > 0),
        drop: null, taiha: false,
    }));
}

describe('海域分類與編號', () => {
    it('活動海域以 world >= 10 判定（不列舉活動編號）', () => {
        expect(isEventWorld(61)).toBe(true);
        expect(isEventWorld(62)).toBe(true);
        expect(isEventWorld(6)).toBe(false);
        expect(isEventWorld(0)).toBe(false);
    });

    it('parseMapCode 解析摘要的 map 字串，解不出時 world 為 0', () => {
        expect(parseMapCode('6-5')).toEqual({ world: 6, mapnum: 5 });
        expect(parseMapCode('61-3')).toEqual({ world: 61, mapnum: 3 });
        expect(parseMapCode('62-7')).toEqual({ world: 62, mapnum: 7 });
        expect(parseMapCode('')).toEqual({ world: 0, mapnum: 0 });
    });

    it('活動關卡標籤不設五關上限，跨活動並列才補 area id', () => {
        expect(eventStageLabel(1)).toBe('E1');
        expect(eventStageLabel(7)).toBe('E7');
        expect(qualifiedEventMapLabel({ world: 61, mapnum: 3 })).toBe('E3 · #61');
        expect(qualifiedEventMapLabel({ world: 61, mapnum: 3 }, '2025秋季')).toBe('2025秋季 E3');
        expect(eventWorldLabel(62, '反撃！第三十一戦隊の戦い', '活動海域'))
            .toBe('反撃！第三十一戦隊の戦い');
        expect(eventWorldLabel(61, undefined, '活動海域')).toBe('活動海域 #61');
        expect(eventWorldLabel(61, '  ', '活動海域')).toBe('活動海域 #61');
    });

    it('活動篩選依 area 分組、關卡跟資料走，切到活動分類預設最新一次', () => {
        const item = (map: string, n = 1): { map: string; world: number; mapnum: number; event: boolean }[] => {
            const { world, mapnum } = parseMapCode(map);
            return Array.from({ length: n }, () => ({
                map, world, mapnum, event: isEventWorld(world),
            }));
        };
        const items = [
            ...item('6-5', 2),
            ...item('61-1', 3),
            ...item('61-3', 1),
            ...item('62-1', 4),
            ...item('62-7', 2),
        ];
        const groups = groupEventWorlds(items);
        expect(groups.map(g => g.world)).toEqual([62, 61]);
        expect(groups[0]!.stages.map(s => s.mapnum)).toEqual([1, 7]);
        expect(groups[0]!.count).toBe(6);

        const worldLabel = (world: number) => world === 62 ? '當次活動' : `舊活動 #${world}`;
        const pinned = planEventMapFilter(items, {
            category: 'event', eventFilter: 'all', mapFilter: 'all',
            pinLatestEvent: true, worldLabel, normalGroupLabel: '通常海域',
        });
        expect(pinned.eventFilter).toBe(62);
        expect(pinned.showEventSelect).toBe(true);
        expect(pinned.qualifyEventWorld).toBe(false);
        expect(pinned.mapGroups).toEqual([{
            label: null,
            options: [
                { map: '62-1', label: 'E1', count: 4 },
                { map: '62-7', label: 'E7', count: 2 },
            ],
        }]);

        const allEvents = planEventMapFilter(items, {
            category: 'event', eventFilter: 'all', mapFilter: '61-3',
            pinLatestEvent: false, worldLabel, normalGroupLabel: '通常海域',
        });
        expect(allEvents.eventFilter).toBe('all');
        expect(allEvents.mapFilter).toBe('61-3');
        expect(allEvents.qualifyEventWorld).toBe(true);
        expect(allEvents.mapGroups.map(g => g.label)).toEqual(['當次活動', '舊活動 #61']);
        expect(allEvents.mapGroups[0]!.options.map(o => o.label)).toEqual(['E1', 'E7']);

        const normal = planEventMapFilter(items, {
            category: 'normal', eventFilter: 62, mapFilter: '62-1',
            pinLatestEvent: false, worldLabel, normalGroupLabel: '通常海域',
        });
        expect(normal.showEventSelect).toBe(false);
        expect(normal.eventFilter).toBe('all');
        expect(normal.mapFilter).toBe('all');
        expect(normal.mapGroups).toEqual([{
            label: null,
            options: [{ map: '6-5', label: '6-5', count: 2 }],
        }]);

        const terms: Record<number, { year: number; seasonLabel: string }> = {
            62: { year: 2026, seasonLabel: '夏季' },
            61: { year: 2025, seasonLabel: '秋季' },
        };
        const byYear = planEventMapFilter(items, {
            category: 'event', eventFilter: 'all', mapFilter: 'all',
            pinLatestEvent: false, worldLabel,
            eventTerm: world => terms[world] ?? null,
            normalGroupLabel: '通常海域',
        });
        expect(byYear.eventGroups).toEqual([
            { label: '2026', options: [{ world: 62, label: '夏季', count: 6 }] },
            { label: '2025', options: [{ world: 61, label: '秋季', count: 4 }] },
        ]);
        expect(byYear.mapGroups.map(g => g.label)).toEqual(['當次活動', '舊活動 #61']);

        const oneYear = planEventMapFilter(items.filter(item => item.world === 62), {
            category: 'event', eventFilter: 'all', mapFilter: 'all',
            pinLatestEvent: false, worldLabel,
            eventTerm: world => terms[world] ?? null,
            normalGroupLabel: '通常海域',
        });
        expect(oneYear.eventGroups).toEqual([{
            label: null,
            options: [{ world: 62, label: '當次活動', count: 6 }],
        }]);
    });

    it('「第幾次」逐海域各自計數，且不受其他海域穿插影響', () => {
        const row = (eventId: number, sortieKey: number, map: string): SortieLogRow => ({
            eventId, sortieKey, ts: eventId, map, node: 1, boss: false, kind: 'battle',
            rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false,
        });
        const groups = groupSorties([
            row(1, 1, '6-5'), row(2, 1, '6-5'),
            row(3, 3, '61-3'),
            row(4, 4, '6-5'),
        ]);
        expect(groups.map(g => g.sortieKey)).toEqual([1, 3, 4]);
        const nth = numberSorties(groups);
        expect(nth.get(1)).toBe(1);
        expect(nth.get(3)).toBe(1);
        expect(nth.get(4)).toBe(2);
    });
});

describe('基地航空隊各波（真封包 61-3 node53）', () => {
    const sample = load('61-3.json');
    const node53 = sample.battles.find((b: any) => b.node === 53).data;

    it('四波依序解出基地編號、中隊組成與各波制空', () => {
        const waves = lbasWaves(node53);
        expect(waves).toHaveLength(4);
        expect(waves.map(w => w.baseId)).toEqual([1, 1, 2, 2]);
        expect(waves[0].seiku).toBe(3);
        expect(waves[0].fLost).toBe(23);
        expect(waves[0].planes).toEqual([
            { mst: 225, count: 18 }, { mst: 479, count: 18 },
            { mst: 459, count: 18 }, { mst: 224, count: 18 },
        ]);
    });

    it('沒有 api_air_base_attack、或該欄位不是陣列（基地防空的物件形態）時回空陣列', () => {
        expect(lbasWaves({})).toEqual([]);
        expect(lbasWaves({ api_air_base_attack: { api_stage1: { api_disp_seiku: 1 } } })).toEqual([]);
    });
});

describe('支援艦隊編組（真封包）', () => {
    it('砲擊支援走 api_support_hourai（61-3 node53：第4艦隊、6 艘）', () => {
        const node53 = load('61-3.json').battles.find((b: any) => b.node === 53).data;
        const use = supportUse(node53)!;
        expect(use.kind).toBe('shell');
        expect(use.deckId).toBe(4);
        expect(use.shipIds).toHaveLength(6);
    });

    it('對潛支援走 api_support_airatack（61-5 node1：潛水艦節點、第4艦隊、flag 4）', () => {
        const node1 = load('61-5-jibun-rengou-node52.json').battles.find((b: any) => b.node === 1).data;
        const use = supportUse(node1)!;
        expect(use.kind).toBe('asw');
        expect(use.deckId).toBe(4);
        expect(use.flag).toBe(4);
        expect(use.shipIds).toHaveLength(6);
    });

    it('flag 3 依 poi 的旗標對應保留為雷擊支援，不誤標成對潛', () => {
        const use = supportUse({
            api_support_flag: 3,
            api_support_info: {
                api_support_airatack: { api_deck_id: 4, api_ship_id: [101, 102] },
            },
        });
        expect(use?.kind).toBe('torpedo');
    });

    it('沒出支援的節點回 null', () => {
        const node50 = load('61-3.json').battles.find((b: any) => b.node === 50).data;
        expect(supportUse(node50)).toBeNull();
    });
});

describe('buildSortieDetail：摘要 × 原始封包', () => {
    const sample = load('61-3.json');
    const replay = toReplayRow(sample);
    const rows = summaryRows(replay, '61-3', { boss: 53, ranks: { 53: 'A' } });

    it('節點序列與摘要一致，並接上對應的原始封包', () => {
        const d = buildSortieDetail(rows, replay);
        expect(d.map).toBe('61-3');
        expect(d.world).toBe(61);
        expect(d.event).toBe(true);
        expect(d.diff).toBe(4);           // 甲
        expect(d.nodes.map(n => n.node)).toEqual([25, 50, 51, 52, 53]);
        expect(d.hasReplay).toBe(true);
        expect(d.boss).toBe(true);
        expect(d.lastRank).toBe('A');
    });

    it('boss 節點解出夜戰接續、敵隨伴、基地航空隊與支援艦隊', () => {
        const boss = buildSortieDetail(rows, replay).nodes.find(n => n.node === 53)!;
        expect(boss.night).toBe(true);
        expect(boss.enemyIds).toHaveLength(6);
        expect(boss.enemyIdsEscort).toHaveLength(6);
        expect(boss.enemyLv).toHaveLength(6);
        expect(boss.lbas).toHaveLength(4);
        expect(boss.support?.kind).toBe('shell');
        // 戰鬥重放（analyzeBattle）：敵主隊/隨伴各 6 位、我方主隊 6 艘
        expect(boss.battle?.resultFleets?.enemyMain).toHaveLength(6);
        expect(boss.battle?.resultFleets?.enemyEscort).toHaveLength(6);
        expect(boss.battle?.resultFleets?.playerMain).toHaveLength(6);
    });

    it('沒有 replay 時仍以摘要重建節點（battle/lbas/support 留空，不臆測）', () => {
        const d = buildSortieDetail(rows);
        expect(d.hasReplay).toBe(false);
        expect(d.nodes).toHaveLength(5);
        expect(d.nodes.every(n => n.battle === null && n.lbas.length === 0 && n.support === null)).toBe(true);
        expect(d.nodes[0].enemyIds.length).toBeGreaterThan(0);
    });

    it('只有摘要的基地空襲節點照序保留，不被戰鬥封包對應吃掉', () => {
        const raid: SortieLogRow = {
            eventId: 99, sortieKey: replay.sortieKey, ts: replay.ts - 1, map: '61-3',
            node: 40, boss: false, kind: 'raid', rank: '', seiku: 2,
            enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false, raidLostKind: 2,
        };
        const d = buildSortieDetail([raid, ...rows], replay);
        expect(d.nodes[0].kind).toBe('raid');
        expect(d.nodes[0].seiku).toBe(2);
        expect(d.nodes[0].raidLostKind).toBe(2);
        expect(d.nodes.map(n => n.node)).toEqual([40, 25, 50, 51, 52, 53]);
    });

    it('replay 有、摘要沒有的節點補在最後且 rank 留空', () => {
        const d = buildSortieDetail(rows.slice(0, 2), replay);
        expect(d.nodes.map(n => n.node)).toEqual([25, 50, 51, 52, 53]);
        expect(d.nodes.slice(2).every(n => n.rank === '')).toBe(true);
    });
});

describe('出擊層級的彙整', () => {
    const sample = load('61-3.json');
    const replay = toReplayRow(sample);
    // 支援艦隊候補快照（新紀錄才有）：deck 3 → fleet3、deck 4 → fleet4
    replay.fleet3 = [toReplayShip({ mst_id: 111, level: 90, equip: [], stars: [], ace: [] })];
    replay.fleet4 = [toReplayShip({ mst_id: 222, level: 80, equip: [], stars: [], ace: [] })];
    replay.lbas = [{ areaId: 61, rid: 1, action: 1, distance: 8, squadrons: [] }];
    const rows = summaryRows(replay, '61-3', { boss: 53 }).map((r, i) => ({
        ...r, getExp: i === 4 ? 3520 : 260, mvp: 1, enemyName: i === 4 ? '深海任務部隊' : undefined,
    }));

    // 61-3 真封包實測：第3艦隊在 25／51 出動（道中支援）、第4艦隊在 53 出動（決戰支援）。
    // 這正是「道中／決戰要分兩欄」的真實依據——同一次出擊可以有兩支不同的支援艦隊。
    it('支援艦隊彙整成出擊層級：出動節點、是否 boss 場、對應的艦隊快照', () => {
        const d = buildSortieDetail(rows, replay);
        expect(d.supports).toHaveLength(2);
        const route = d.supports.find(s => s.use.deckId === 3)!;
        const boss = d.supports.find(s => s.use.deckId === 4)!;
        expect(route.nodes).toEqual([25, 51]);
        expect(route.boss).toBe(false);                      // 道中支援
        expect(route.fleet?.map(s => s.mst)).toEqual([111]);  // deck 3 → fleet3
        expect(boss.nodes).toEqual([53]);
        expect(boss.boss).toBe(true);                        // 53 為 boss ⇒ 決戰支援
        expect(boss.fleet?.map(s => s.mst)).toEqual([222]);   // deck 4 → fleet4
        expect(boss.use.kind).toBe('shell');
    });

    it('沒有快照的舊紀錄：支援艦隊的 fleet 為 null（不由艦實例 id 猜 master）', () => {
        const legacy = { ...replay, fleet3: undefined, fleet4: undefined };
        const d = buildSortieDetail(rows, legacy);
        expect(d.supports.every(s => s.fleet === null)).toBe(true);
        expect(d.supports[0].use.shipIds.length).toBeGreaterThan(0);
    });

    it('基地航空隊：快照與逐節點波次分開保存（波次仍照節點順序）', () => {
        const d = buildSortieDetail(rows, replay);
        expect(d.lbas.map(b => b.rid)).toEqual([1]);
        expect(d.lbasWaves).toHaveLength(4);              // 61-3 boss 節點的四波
        expect(new Set(d.lbasWaves.map(w => w.node))).toEqual(new Set([53]));
    });

    it('經驗值合計只加總有值的節點，且節點帶出 battleresult 的追加欄位', () => {
        const d = buildSortieDetail(rows, replay);
        expect(d.totalExp).toBe(260 * 4 + 3520);
        const boss = d.nodes.find(n => n.node === 53)!;
        expect(boss.getExp).toBe(3520);
        expect(boss.mvp).toBe(1);
        expect(boss.enemyName).toBe('深海任務部隊');
        expect(boss.search).toEqual([1, 1]);               // api_search 原始值（真封包）
    });

    it('沒有 replay 也不會憑空生出支援艦隊或基地航空隊', () => {
        const d = buildSortieDetail(rows);
        expect(d.supports).toEqual([]);
        expect(d.lbas).toEqual([]);
        expect(d.lbasWaves).toEqual([]);
        expect(d.totalExp).toBe(260 * 4 + 3520);           // 摘要欄位仍在
    });
});
