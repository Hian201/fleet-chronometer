import { describe, expect, it } from 'vitest';
import { MAP_SPOTS } from '../utils/map-spots';
import {
    evalCond, exitsOf, goalVerdict, predictRoutes,
    type Rule, type RouteFleet, type RouteFleetShip,
} from '../utils/route-predict';
import { ROUTE_RULES } from '../utils/route-rules-data';
import { formatOutcome, formatRuleCond } from '../utils/route-format';
import { setLang } from '../utils/ui-i18n';

// api_stype：1 海防、2 駆逐、3 軽巡、4 雷巡、5 重巡、6 航巡、7 軽空母、8 高速戦艦、9 戦艦、
// 10 航戦、11 正規空母、13 潜水艦、16 水母、17 揚陸艦、22 補給艦
function ship(stype: number, opts: Partial<RouteFleetShip> = {}): RouteFleetShip {
    return { mst: 1, stype, ctype: null, soku: 10, gears: [], ...opts };
}

function fleet(ships: RouteFleetShip[], los = 0): RouteFleet {
    return { ships, los: () => los };
}

function targetsOf(rules: readonly Rule[]): string[] {
    const out: string[] = [];
    for (const r of rules) {
        if ('then' in r) out.push(...targetsOf(r.then));
        else if ('go' in r) out.push(r.go);
        else if ('random' in r) out.push(...r.random);
        else if ('choice' in r) out.push(...r.choice);
        else if ('unknown' in r) out.push(...r.unknown);
    }
    return out;
}

function ends(map: string, f: RouteFleet, stage: string | null = null): string[] {
    const { paths } = predictRoutes(map, ROUTE_RULES[map], f, stage);
    return [...new Set(paths.map((p) => [p.steps[0]?.from === '' ? '' : p.steps[0]?.from, ...p.steps.map((s) => s.to)].filter(Boolean).join('')))].sort();
}

describe('規則資料與遊戲路線一致', () => {
    for (const [map, rules] of Object.entries(ROUTE_RULES)) {
        const spots = MAP_SPOTS[map];
        it(`${map}：每條規則的去向都是該節點的實際出口`, () => {
            expect(spots).toBeDefined();
            for (const [node, list] of Object.entries(rules.nodes)) {
                const allowed = node === ''
                    ? [...spots.starts, ...spots.starts.flatMap((s) => exitsOf(map, s))]
                    : exitsOf(map, node);
                if (node !== '') expect(Object.keys(spots.spots), `${map} 沒有節點 ${node}`).toContain(node);
                for (const to of targetsOf(list)) expect(allowed, `${map} ${node || '出擊'} → ${to}`).toContain(to);
            }
            const goals = [...rules.goal, ...(rules.stages ?? []).flatMap((s) => s.goal)];
            for (const g of goals) expect(Object.keys(spots.spots)).toContain(g);
        });
        it(`${map}：出口兩條以上的節點都有規則`, () => {
            // 有出擊規則（鍵 ''）的海域，出擊點的去向由出擊規則統一處理
            const sortieRule = Boolean(rules.nodes['']);
            const missing = Object.keys(spots.spots).filter((n) =>
                exitsOf(map, n).length > 1 && !rules.nodes[n] && !(sortieRule && spots.starts.includes(n)));
            expect(missing).toEqual([]);
        });
    }
});

describe('三值條件', () => {
    const ctx = (ships: RouteFleetShip[]) => ({ fleet: fleet(ships), visited: new Set<string>(), phases: {} });
    it('未選階段為不可考', () => {
        expect(evalCond({ phase: 'start2Open' }, ctx([ship(2)]))).toBeNull();
    });
    it('wiki 未列的大發系裝備使搭載艦數不可考，兩端結論相同時仍有定論', () => {
        // 576 大発動艇(R35&フランス兵)：上陸用舟艇，wiki 兩份清單都沒列
        const r35 = { mst: 576, type: 24 };
        const daihatsu = { mst: 68, type: 24 };
        const f = [ship(2, { gears: [daihatsu] }), ship(2, { gears: [daihatsu] }), ship(2, { gears: [daihatsu] }), ship(2, { gears: [r35] })];
        expect(evalCond({ carriers: 'daihatsu', min: 4 }, ctx(f))).toBeNull();
        expect(evalCond({ carriers: 'daihatsu', min: 3 }, ctx(f))).toBe(true);
    });
    it('航空戦艦不算「戦艦」，但算「戦艦級」', () => {
        expect(evalCond({ count: ['BB'], min: 1 }, ctx([ship(10)]))).toBe(false);
        expect(evalCond({ count: ['BBclass'], min: 1 }, ctx([ship(10)]))).toBe(true);
    });
    it('補給艦含 stype 22（特設護衛空母）', () => {
        expect(evalCond({ count: ['AO'], min: 1 }, ctx([ship(22)]))).toBe(true);
    });
});

describe('1-5', () => {
    it('駆逐4：A→D→F→G→J 固定到王', () => {
        const f = fleet([ship(2), ship(2), ship(2), ship(2)]);
        expect(ends('1-5', f)).toEqual(['1ADFGJ']);
        expect(goalVerdict(predictRoutes('1-5', ROUTE_RULES['1-5'], f).paths)).toBe('fixed');
    });
    it('海防のみ 4 隻：D→E→J', () => {
        expect(ends('1-5', fleet([ship(1), ship(1), ship(1), ship(1)]))).toEqual(['1ADEJ']);
    });
    it('海防のみ 6 隻：D はランダム、E→C、C は海防のみで J', () => {
        const de6 = fleet([ship(1), ship(1), ship(1), ship(1), ship(1), ship(1)]);
        expect(ends('1-5', de6)).toEqual(['1ADECJ', '1ADFGH']);
    });
    it('補給艦を含む 4 隻：D→E→C→ランダム', () => {
        const f = fleet([ship(3), ship(2), ship(1), ship(22)]);
        expect(ends('1-5', f)).toEqual(['1ADECB', '1ADECJ']);
        expect(goalVerdict(predictRoutes('1-5', ROUTE_RULES['1-5'], f).paths)).toBe('possible');
    });
    it('6 隻・潜水艦なし：D はランダム、E は C へ', () => {
        const f = fleet([ship(3), ship(2), ship(2), ship(2), ship(2), ship(2)]);
        expect(ends('1-5', f)).toEqual(['1ADECB', '1ADFGH']);
        expect(goalVerdict(predictRoutes('1-5', ROUTE_RULES['1-5'], f).paths)).toBe('never');
    });
});

describe('5-6 階段', () => {
    it('第一量表：一律スタート1', () => {
        const f = fleet([ship(3), ship(2), ship(2), ship(2), ship(2), ship(2)]);
        const { paths } = predictRoutes('5-6', ROUTE_RULES['5-6'], f, 'g1');
        expect(paths.every((p) => p.steps[0].to === '1')).toBe(true);
    });
    it('未選階段：出擊點兩邊都可能（不可考）', () => {
        const f = fleet([ship(3), ship(2), ship(2), ship(2), ship(2), ship(2)]);
        const { paths } = predictRoutes('5-6', ROUTE_RULES['5-6'], f);
        const starts = new Set(paths.map((p) => p.steps[0].to));
        expect([...starts].sort()).toEqual(['1', '2']);
        expect(paths.find((p) => p.steps[0].to === '1')?.steps[0].kind).toBe('uncertain');
    });
});

describe('5-5', () => {
    it('最速統一・駆逐2：B→F 能動分岐，H→N', () => {
        const f = fleet([ship(9, { soku: 20 }), ship(9, { soku: 20 }), ship(11, { soku: 20 }), ship(11, { soku: 20 }), ship(2, { soku: 20 }), ship(2, { soku: 20 })], 90);
        const routes = ends('5-5', f);
        expect(routes).toContain('1BFJPS');
        expect(routes.some((r) => r.includes('D'))).toBe(true);
    });
});

describe('世界地圖選擇', () => {
    it('每張常規海域都有位置，且都落在印度洋～太平洋的地圖範圍內', async () => {
        const { MAP_LOCATIONS } = await import('../utils/map-locations');
        const { WORLD_PICKER } = await import('../utils/map-geo-data');
        expect(Object.keys(MAP_LOCATIONS).sort()).toEqual(Object.keys(MAP_SPOTS).sort());
        for (const [map, [lon, lat]] of Object.entries(MAP_LOCATIONS)) {
            const east = lon < 0 ? lon + 360 : lon;
            expect(east, map).toBeGreaterThanOrEqual(WORLD_PICKER.west);
            expect(east, map).toBeLessThanOrEqual(WORLD_PICKER.east);
            expect(lat, map).toBeGreaterThanOrEqual(WORLD_PICKER.south);
            expect(lat, map).toBeLessThanOrEqual(WORLD_PICKER.north);
        }
    });
    it('每張常規海域都有真實地理背景', async () => {
        const { MAP_GEO } = await import('../utils/map-geo-data');
        expect(Object.keys(MAP_GEO).sort()).toEqual(Object.keys(MAP_SPOTS).sort());
    });
    it('王點資料：1-6 的 N 是終點不是王，其餘未寫 boss 的海域以 goal 為王', () => {
        expect(ROUTE_RULES['1-6'].boss).toEqual([]);
        expect(ROUTE_RULES['1-5'].boss ?? ROUTE_RULES['1-5'].goal).toEqual(['J']);
    });
});

describe('全部常規海域', () => {
    it('37 張都有分岐規則與目標點', () => {
        expect(Object.keys(ROUTE_RULES).sort()).toEqual(Object.keys(MAP_SPOTS).sort());
        for (const [map, rules] of Object.entries(ROUTE_RULES)) {
            expect(rules.goal.length, map).toBeGreaterThan(0);
            expect(rules.checked, map).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
        }
    });

    it('每條規則的條件與去向在三語都能格式化，不露出原始鍵名', () => {
        const walk = (list: readonly Rule[], out: Rule[] = []): Rule[] => {
            for (const r of list) {
                out.push(r);
                if ('then' in r) walk(r.then, out);
            }
            return out;
        };
        for (const lang of ['zh-TW', 'en', 'ja'] as const) {
            setLang(lang);
            for (const [map, rules] of Object.entries(ROUTE_RULES)) {
                for (const [node, list] of Object.entries(rules.nodes)) {
                    for (const r of walk(list)) {
                        const text = `${formatRuleCond(r)} ${'then' in r ? '' : formatOutcome(r)}`;
                        expect(text, `${lang} ${map} ${node}`).not.toMatch(/route\.|\{\w+\}|undefined|NaN/);
                    }
                }
            }
        }
        setLang('zh-TW');
    });

    it('3-2 C：電探 0 隻 → G；最速統一かつ電探搭載艦 4 隻以上 → E（6 隻編成）', () => {
        const rules = ROUTE_RULES['3-2'];
        const radar = { mst: 99, type: 12 };
        const six = (radars: number) => fleet([...Array.from({ length: 5 }, (_, i) => ship(2, { soku: 20, gears: i < radars ? [radar] : [] })), ship(3, { soku: 20 })]);
        const second = (f: RouteFleet) => predictRoutes('3-2', rules, f).paths.map((p) => p.steps.find((s) => s.from === 'C')?.to);
        expect(second(six(0))).toEqual(['G']);
        expect(second(six(4))).toEqual(['E']);
        // 電探 3 隻では最速統一の条件に足りず、高速+統一のランダム（E／G）
        expect(new Set(second(six(3)))).toEqual(new Set(['E', 'G']));
    });

    it('5-2 D：夕張を含み他 5 隻が駆逐 5 隻 → G、夕張なしの軽空母 2 駆逐 4 は F', () => {
        const yuubari = ship(3, { mst: 115 });
        const f = fleet([yuubari, ...Array.from({ length: 5 }, () => ship(2))]);
        const fromD = (fl: RouteFleet) => predictRoutes('5-2', ROUTE_RULES['5-2'], fl).paths.flatMap((p) => p.steps).find((s) => s.from === 'D')?.to;
        expect(fromD(f)).toBe('G');
        const cvl2 = fleet([ship(7), ship(7), ship(2), ship(2), ship(2), ship(2)]);
        expect(fromD(cvl2)).toBe('F');
    });

    it('6-4 出擊：揚陸艦を含むと出擊点 2（M）、軽巡旗艦＋駆逐 3 の高速統一は B、駆逐 2 隻は A', () => {
        const lha = fleet([ship(17), ship(2), ship(2), ship(2)]);
        const clDd3 = fleet([ship(3), ship(2), ship(2), ship(2)]);
        const dd2 = fleet([ship(5), ship(5), ship(2), ship(2)]);
        const first = (f: RouteFleet) => predictRoutes('6-4', ROUTE_RULES['6-4'], f).paths[0].steps[0];
        expect(first(lha)).toMatchObject({ from: '2', to: 'M' });
        expect(first(clDd3)).toMatchObject({ from: '1', to: 'B' });
        expect(first(dd2)).toMatchObject({ from: '1', to: 'A' });
    });

    it('7-3：階段で A のルールが変わる（ゲージ2 は補給艦 1 ＋ 駆逐 3 で C）', () => {
        const f = fleet([ship(2), ship(2), ship(2), ship(22)]);
        const at = (stage: string | null) => predictRoutes('7-3', ROUTE_RULES['7-3'], f, stage).paths
            .map((p) => p.steps.find((s) => s.from === 'A')?.to);
        expect(new Set(at('g2'))).toEqual(new Set(['C']));
        expect(new Set(at('g1'))).toEqual(new Set(['B']));
        // 階段未選：両方の可能性が残る
        expect(new Set(at(null))).toEqual(new Set(['B', 'C']));
    });

    it('7-2 は階段で目標点が変わる', () => {
        const f = fleet([ship(2), ship(2), ship(2), ship(2)]);
        const goalOf = (stage: string) => {
            const { paths } = predictRoutes('7-2', ROUTE_RULES['7-2'], f, stage);
            return new Set(paths.filter((p) => p.reachesGoal).map((p) => p.end));
        };
        expect([...goalOf('g1')].every((x) => x === 'G')).toBe(true);
        expect([...goalOf('g2')].every((x) => x === 'M')).toBe(true);
    });

    it('王點 boss が省略された海域は goal が王（1-6 の N と 5-6 の機關目標 R だけが例外）', () => {
        for (const [map, rules] of Object.entries(ROUTE_RULES)) {
            if (rules.boss) continue;
            expect(rules.goal.length, map).toBe(1);
        }
    });
});
