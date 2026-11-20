import { describe, expect, it } from 'vitest';
import type { ExpeditionRow } from '../utils/db';
import { DAY_MS } from '../utils/date-format';
import {
    MIN_RUNS, daysToFill, fleetSupply, lightestWeek, monthlyExpeditionCycle, planExpeditionSteps, planExpeditions, playerProfile, resourceNeeds,
    type PlanMission, type ResourceNeed,
} from '../utils/expedition-plan';
import { stockpileCap, STOCKPILE_KEYS } from '../utils/stockpile';

const AFTER = Date.parse('2026-12-01T00:00:00Z');
const BEFORE = AFTER - 1000;

// 測試用的遠征編號從 900 起，避開 expedition-data 的固定報酬（那些另外測）。
const mission = (id: number, time: number, over: Partial<PlanMission> = {}): PlanMission =>
    ({ id, dispNo: String(id), name: `遠征${id}`, time, resetType: 0, winItems: [[0, 0], [0, 0]], use: [0, 0], ...over });
/** 月常（獎勵含改修資材，大成功限定，同 A6 等）。 */
const monthlyMission = (id: number, winItems: [number, number][] = [[0, 0], [4, 1]]) => mission(id, 60, { resetType: 1, winItems });
const run = (missionId: number, over: Partial<ExpeditionRow> = {}): ExpeditionRow => ({
    eventId: 1, ts: AFTER, deckId: 2, missionId, name: `遠征${missionId}`, result: 1,
    resources: [0, 0, 0, 0], items: [], flagItems: true, ...over,
});
const runs = (n: number, missionId: number, over: Partial<ExpeditionRow> = {}) => Array.from({ length: n }, () => run(missionId, over));
const need = (key: ResourceNeed['key'], have: number | null, base: number | null = 0, cap = stockpileCap(key)): ResourceNeed =>
    ({ key, have, cap, base, current: base });
/** 每 24 小時收一次：耗時一天以內的遠征每天都是一趟，perDay＝每趟平均。 */
const DAILY = 1440;
const ids = (rows: { missionId: number }[]) => rows.map(row => row.missionId).sort((a, b) => a - b);
const plan = (input: Partial<Parameters<typeof planExpeditions>[0]> & Pick<Parameters<typeof planExpeditions>[0], 'missions' | 'records' | 'needs'>) =>
    planExpeditions({ intervalMinutes: DAILY, horizonDays: 10, ...input });

describe('planExpeditions：候選與收益', () => {
    it('月常不進組合；只列獎勵含開發資材或改修資材的，附最後一次成功時間（沒紀錄也列）', () => {
        const result = plan({
            missions: [mission(905, 60), monthlyMission(942), monthlyMission(943, [[3, 2], [0, 0]]), monthlyMission(944), monthlyMission(945, [[1, 2], [12, 1]])],
            records: [
                ...runs(MIN_RUNS, 905, { resources: [100, 0, 0, 0] }),
                run(942, { ts: 1000 }), run(942, { ts: 3000 }), run(942, { ts: 5000, result: 0 }),
                run(943, { result: 0 }),
            ],
            needs: [need('fuel', 1000)],
        });
        expect(ids(result.top)).toEqual([905]);
        expect(result.monthly).toEqual([
            { missionId: 942, dispNo: '942', name: '遠征942', lastSuccessTs: 3000, open: null },
            { missionId: 943, dispNo: '943', name: '遠征943', lastSuccessTs: null, open: null },
            { missionId: 944, dispNo: '944', name: '遠征944', lastSuccessTs: null, open: null },
        ]);
    });

    it('紀錄達 MIN_RUNS 用紀錄平均（失敗與大成功都算）；沒有收益的遠征不列入', () => {
        const result = plan({
            missions: [mission(901, 30), mission(902, 30)],
            records: [
                ...runs(MIN_RUNS - 2, 901, { result: 1, resources: [100, 0, 0, 0] }),
                run(901, { result: 2, resources: [300, 0, 60, 0] }), run(901, { result: 0 }),
                ...runs(MIN_RUNS, 902),
            ],
            needs: [need('fuel', 0)],
        });
        expect(result.candidates.map(row => row.missionId)).toEqual([901]);
        const [row] = result.candidates;
        expect(row.income.fuel).toBeCloseTo((100 * (MIN_RUNS - 2) + 300) / MIN_RUNS);
        expect(row.income.steel).toBeCloseTo(60 / MIN_RUNS);
        expect(row.estimated).toEqual([]);
    });

    it('紀錄不足時以固定報酬推算：資源 ×（成功＋1.5×大成功）× 大發加成，道具依左右欄規則', () => {
        // 長距離練習航海（id 2）：固定報酬彈藥 100、鋼材 30；左欄高速修復材 ×1（成功或大成功隨機 0～1）。
        // 海峡警備行動（id 101）：右欄高速修復材 ×1（大成功限定）。
        const missions = [
            mission(2, 30, { winItems: [[1, 1], [0, 0]] }),
            mission(101, 55, { winItems: [[3, 1], [1, 1]] }),
        ];
        // 玩家平常的跑法：一半成功、一半大成功；沒有常跑的遠征，大發加成水準為 1。
        const records = [run(950, { result: 1 }), run(950, { result: 2 })];
        const result = plan({ missions: [...missions, mission(950, 30)], records, needs: [need('drum', 0)] });
        const two = result.candidates.find(row => row.missionId === 2)!;
        expect(two.runs).toBe(0);
        expect(two.income.ammo).toBeCloseTo(100 * (0.5 + 1.5 * 0.5));
        expect(two.income.drum).toBeCloseTo(1 * 1 / 2);
        expect(two.estimated).toContain('drum');
        const a2 = result.candidates.find(row => row.missionId === 101)!;
        expect(a2.income.drum).toBeCloseTo(0.5 * (1 + 1) / 2);
        expect(a2.income.devmat).toBeCloseTo(1 * 1 / 2);
    });

    it('高速修復材等只用有道具標記的紀錄判斷筆數（與時間無關）；不足時改推算', () => {
        const result = plan({
            missions: [mission(903, 30, { winItems: [[0, 0], [1, 1]] })],
            records: [...runs(MIN_RUNS, 903, { ts: AFTER + 1000, flagItems: undefined, result: 2, items: [{ id: 1, count: 9 }] }), run(903, { result: 2, items: [{ id: 1, count: 1 }] })],
            needs: [need('drum', 0)],
        });
        const [row] = result.candidates;
        expect(row.itemRuns).toBe(1);
        expect(row.estimated).toContain('drum');            // 有標記的只有 1 筆 < MIN_RUNS
        expect(row.income.drum).toBeCloseTo(1);             // 玩家全是大成功 → 右欄期望 (1+1)/2
    });

    it('燃彈扣掉每趟補給；每日收入＝每趟 × 每天能收幾次，比回收間隔長的遠征一輪佔多個間隔', () => {
        const shipMax = new Map([['睦月', [15, 15] as const], ['如月', [15, 15] as const]]);
        const fleet = [{ name: '睦月', level: 1 }, { name: '如月', level: 1 }];
        const result = plan({
            missions: [mission(904, 30, { use: [0.5, 0.4] }), mission(906, 200)],
            records: [...runs(MIN_RUNS, 904, { resources: [100, 50, 0, 0], fleet }), ...runs(MIN_RUNS, 906, { resources: [100, 0, 0, 0] })],
            needs: [need('fuel', 0)], intervalMinutes: 180, shipMax,
        });
        const byId = new Map(result.candidates.map(row => [row.missionId, row]));
        expect(byId.get(904)!.supply).toEqual([14, 12]);                 // 2 艘 × floor(15×0.5)、floor(15×0.4)
        expect(byId.get(904)!.income.fuel).toBe(100 - 14);
        expect(byId.get(904)!.perDay.fuel).toBeCloseTo((100 - 14) * 8);  // 3 小時收一次 → 一天 8 趟
        expect(byId.get(906)!.perDay.fuel).toBeCloseTo(100 * 4);         // 200 分鐘要兩個間隔 → 一天 4 趟
    });

    it('補給取最近一次可換算的編成，不受紀錄排列方向影響', () => {
        const shipMax = new Map([['睦月', [15, 15] as const], ['如月', [15, 15] as const]]);
        const old = run(904, { ts: AFTER, resources: [100, 0, 0, 0], fleet: [{ name: '睦月', level: 1 }] });
        const recent = run(904, { ts: AFTER + 1000, resources: [100, 0, 0, 0], fleet: [{ name: '睦月', level: 1 }, { name: '如月', level: 1 }] });
        const supplyWith = (records: ExpeditionRow[]) => plan({
            missions: [mission(904, 30, { use: [0.5, 0.4] })], records, needs: [need('fuel', 0)], shipMax,
        }).candidates[0].supply;
        expect(supplyWith([old, recent])).toEqual([14, 12]);
        expect(supplyWith([recent, old])).toEqual([14, 12]);
    });
});

describe('planExpeditions：組合', () => {
    // 1 號給彈藥最多、2、4 號次之，3、5 號給鋁土。
    const missions = [901, 902, 903, 904, 905].map(id => mission(id, 60));
    const records = [
        ...runs(MIN_RUNS, 901, { resources: [0, 6000, 0, 0] }),
        ...runs(MIN_RUNS, 902, { resources: [0, 5000, 0, 0] }),
        ...runs(MIN_RUNS, 903, { resources: [0, 0, 0, 2000] }),
        ...runs(MIN_RUNS, 904, { resources: [0, 4000, 0, 0] }),
        ...runs(MIN_RUNS, 905, { resources: [0, 0, 0, 1500] }),
    ];

    it('資材互補：三隊不會全擠向彈藥，期限時比例最低的鋁土拿到兩隊', () => {
        const result = plan({ missions, records, needs: [need('ammo', 200000, 2000), need('bauxite', 100000, 300)] });
        expect(ids(result.top)).toEqual([901, 903, 905]);
        expect(result.bottleneck).toBe('bauxite');
        expect(result.top[0].missionId).toBe(903);                    // 依對瓶頸的每日收入排列
        const bauxite = result.outlook.find(line => line.key === 'bauxite')!;
        expect(bauxite.planAt).toBeCloseTo(100000 + (300 + 2000 + 1500) * 10);
    });

    it('上限以上算滿：會滿的資材不再吸走隊伍', () => {
        // 彈藥只差 10,000，一隊 1 號十天就滿；其餘兩隊給鋁土。
        const result = plan({ missions, records, needs: [need('ammo', 340000, 0), need('bauxite', 0, 0)] });
        expect(ids(result.top)).toEqual([901, 903, 905]);
        expect(result.outlook.find(line => line.key === 'ammo')!.planDays).toBeCloseTo(10000 / 6000);
    });

    it('淨增減為負也照比例比較：基本淨增減為負的資材優先補', () => {
        const result = plan({ missions, records, needs: [need('ammo', 175000, -12000), need('bauxite', 175000, 0)] });
        // 三隊都給彈藥：彈藥 175,000 + (−12,000 + 15,000) × 10 = 205,000（59%），比例最低的變成鋁土（50%）；
        // 少一隊彈藥則彈藥掉到 47% 以下，更差。
        expect(ids(result.top)).toEqual([901, 902, 904]);
        expect(result.outlook.find(line => line.key === 'ammo')!.planAt).toBeCloseTo(205000);
        expect(result.bottleneck).toBe('bauxite');
    });

    it('期限前都會滿時不隨便挑：比誰最快滿，不給該資材的遠征不入選', () => {
        // 只勾高速修復材：現有 1,692／3,000、期限 44 天，任兩條給水桶的遠征都會在期限前滿，比例全部同分。
        // 1 號什麼都不給、2 號一天 12 桶、3～5 號一天 23 桶：應選 3～5 號（最快滿），而不是編號最小的組合。
        const bucket = (id: number, perRun: number) => mission(id, 60, { winItems: [[0, 0], [1, 1]] }) && runs(MIN_RUNS, id, { result: 2, items: [{ id: 1, count: perRun }] });
        const result = plan({
            missions: [901, 902, 903, 904, 905].map(id => mission(id, 60)),
            records: [...runs(MIN_RUNS, 901, { resources: [100, 0, 0, 0] }), ...bucket(902, 0.5), ...bucket(903, 1), ...bucket(904, 1), ...bucket(905, 1)],
            needs: [need('drum', 1692, 1)], horizonDays: 44, intervalMinutes: 60,
        });
        expect(ids(result.top)).toEqual([903, 904, 905]);
        expect(result.focus).toBe('drum');
        expect(result.candidates[0].perDay.drum).toBeCloseTo(24);
    });

    it('持有不可考的資材不參與比較', () => {
        const result = plan({ missions, records, needs: [{ key: 'ammo', have: 0, cap: 350000, base: 0, current: 500 }, need('bauxite', null)] });
        expect(ids(result.top)).toEqual([901, 902, 904]);
        expect(result.outlook[0].nowAt).toBe(5000);
        expect(result.outlook[1]).toMatchObject({ key: 'bauxite', have: null, planAt: null, planDays: null });
    });
});

describe('playerProfile', () => {
    it('大發加成水準＝常跑遠征的實際 ÷ 理論的中位數，下限 1', () => {
        // 海上護衛任務（id 5）固定報酬 200/200/20/20：大成功 ×1.5 = 660，實際 792 → 1.2 倍。
        const profile = playerProfile([mission(5, 90)], runs(MIN_RUNS, 5, { result: 2, resources: [360, 360, 36, 36] }));
        expect(profile.great).toBe(1);
        expect(profile.bonus).toBeCloseTo(1.2);
        expect(playerProfile([mission(5, 90)], runs(MIN_RUNS, 5, { result: 1, resources: [100, 100, 10, 10] })).bonus).toBe(1);
    });

    it('fleetSupply：艦名對不到 master 時為 null', () => {
        expect(fleetSupply([{ name: '不存在' }], [0.5, 0.5], new Map())).toBeNull();
        expect(fleetSupply([], [0.5, 0.5], new Map())).toBeNull();
    });
});

describe('月常遠征的本期', () => {
    const utc = (iso: string) => Date.parse(`${iso}Z`);

    it('日本時間每月 15 日 12:00（UTC 03:00）換期，跨年照算', () => {
        expect(monthlyExpeditionCycle(utc('2026-11-15T02:59:59'))).toEqual({ start: utc('2026-10-15T03:00:00'), end: utc('2026-11-15T03:00:00') });
        expect(monthlyExpeditionCycle(utc('2026-11-15T03:00:00'))).toEqual({ start: utc('2026-11-15T03:00:00'), end: utc('2026-12-15T03:00:00') });
        expect(monthlyExpeditionCycle(utc('2026-12-31T20:00:00'))).toEqual({ start: utc('2026-12-15T03:00:00'), end: utc('2027-01-15T03:00:00') });
        expect(monthlyExpeditionCycle(utc('2027-01-10T00:00:00'))).toEqual({ start: utc('2026-12-15T03:00:00'), end: utc('2027-01-15T03:00:00') });
    });

    it('本期有成功紀錄就算已完成、不再提示（失敗可再跑）', () => {
        const now = utc('2026-11-18T00:00:00');
        const result = plan({
            missions: [mission(905, 60), monthlyMission(942), monthlyMission(943), monthlyMission(944)],
            records: [
                ...runs(MIN_RUNS, 905, { resources: [100, 0, 0, 0] }),
                run(942, { ts: utc('2026-11-16T00:00:00') }),                       // 本期成功
                run(943, { ts: utc('2026-11-14T00:00:00') }),                       // 上一期成功
                run(944, { ts: utc('2026-11-17T00:00:00'), result: 0 }),            // 本期失敗
            ],
            needs: [need('fuel', 1000)], now,
        });
        expect(result.monthlyCycle).toEqual({ start: utc('2026-11-15T03:00:00'), end: utc('2026-12-15T03:00:00') });
        expect(result.monthly.map(row => row.missionId)).toEqual([943, 944]);
    });

    it('遠征清單：不在清單的一般遠征不列入候選；本期的清單決定月常開放與本期截止', () => {
        const now = utc('2026-11-18T00:00:00');
        const resetAt = utc('2026-12-15T03:00:00');
        const data = {
            missions: [mission(905, 60), mission(906, 60), monthlyMission(942), monthlyMission(943)],
            records: [
                ...runs(MIN_RUNS, 905, { resources: [100, 0, 0, 0] }), ...runs(MIN_RUNS, 906, { resources: [200, 0, 0, 0] }),
                run(942, { ts: utc('2026-08-01T00:00:00') }), run(943, { ts: utc('2026-08-02T00:00:00') }),
            ],
            needs: [need('fuel', 1000)], now,
        };
        const missionList = { states: new Map([[905, 2], [942, 1]]), resetAt };
        const result = plan({ ...data, missionList });
        expect(result.candidates.map(row => row.missionId)).toEqual([905]);
        expect(result.lockedCount).toBe(1);
        expect(result.listKnown).toBe(true);
        expect(result.monthlyCycle).toEqual({ start: utc('2026-11-15T03:00:00'), end: resetAt });
        // 本期能跑的在前，未開放的其次。
        expect(result.monthly.map(row => [row.missionId, row.open])).toEqual([[942, true], [943, false]]);

        // 本期清單狀態 2＝本期已完成，即使沒有本期紀錄（擴充沒開著時跑的）。
        const done = plan({ ...data, missionList: { ...missionList, states: new Map([[905, 2], [942, 2], [943, 1]]) } });
        expect(done.monthly.map(row => row.missionId)).toEqual([943]);

        // 上一期的清單（換期時間已過）：一般遠征照樣過濾，月常開放與否不可知，本期截止回到推算。
        const stale = plan({ ...data, missionList: { ...missionList, resetAt: utc('2026-11-15T03:00:00') } });
        expect(stale.candidates.map(row => row.missionId)).toEqual([905]);
        expect(stale.monthly.map(row => row.open)).toEqual([null, null]);
        // 上一期清單的狀態 2 不算本期完成。
        const staleDone = plan({ ...data, missionList: { states: new Map([[905, 2], [942, 2]]), resetAt: utc('2026-11-15T03:00:00') } });
        expect(staleDone.monthly.map(row => row.missionId)).toEqual([942, 943]);
        expect(stale.monthlyCycle).toEqual(monthlyExpeditionCycle(now));

        // 維修把換期延到 15 日 17:00（日本時間）：本期起點仍是上個月 15 日。
        const delayed = plan({ ...data, missionList: { ...missionList, resetAt: utc('2026-12-15T08:00:00') } });
        expect(delayed.monthlyCycle).toEqual({ start: utc('2026-11-15T03:00:00'), end: utc('2026-12-15T08:00:00') });

        // 從沒收到清單：全部照列。
        const none = plan(data);
        expect(ids(none.candidates)).toEqual([905, 906]);
        expect([none.lockedCount, none.listKnown]).toEqual([0, false]);
    });
});

describe('resourceNeeds', () => {
    const caps = Object.fromEntries(STOCKPILE_KEYS.map(key => [key, stockpileCap(key)])) as Parameters<typeof resourceNeeds>[2];

    it('基本淨增減＝觀測淨增減 − 同期間遠征的淨收入（收益 − 補給）；只回傳勾選的資材', () => {
        const flow = { fromTs: AFTER, toTs: AFTER + 10 * DAY_MS, weeks: 1, rates: {
            ammo: { low: 0, high: 0, mean: 1000 }, bauxite: { low: 0, high: 0, mean: 200 },
        } };
        const shipMax = new Map([['睦月', [15, 20] as const]]);
        const records = [
            run(904, { ts: AFTER + DAY_MS, resources: [0, 3000, 0, 1000], fleet: [{ name: '睦月', level: 1 }] }),
            run(904, { ts: AFTER - DAY_MS, resources: [0, 99999, 0, 0] }),     // 觀測期間外
        ];
        const needs = resourceNeeds(['bauxite', 'ammo'], { ammo: 340000, bauxite: null }, caps, flow, records, [mission(904, 30, { use: [0, 0.5] })], shipMax);
        expect(needs).toEqual([
            { key: 'ammo', have: 340000, cap: caps.ammo, base: 1000 - (3000 - 10) / 10, current: 1000 },
            { key: 'bauxite', have: null, cap: caps.bauxite, base: 200 - 100, current: 200 },
        ]);
    });

    it('支出照：最近平均／支出最少的一週／不計；最少的一週有沒標記的紀錄時道具沿用平均', () => {
        const W = 7 * DAY_MS;
        const week = (from: number, fuel: number, ammo: number, steel: number, bauxite: number, drum: number) =>
            ({ fromTs: from, toTs: from + W, rates: { fuel, ammo, steel, bauxite, drum } });
        // 兩週：前一週每天各 +100、水桶 +9；後一週每天各 −900、水桶 −1。前一週有一筆沒道具標記、沒有收益的遠征紀錄，
        // 不影響基本淨增減，但那週的道具收入不全。
        const light = week(BEFORE - W, 100, 100, 100, 100, 9);
        const heavy = week(BEFORE, -900, -900, -900, -900, -1);
        const avg = (key: 'fuel' | 'drum') => (light.rates[key] + heavy.rates[key]) / 2;
        const flow = { fromTs: light.fromTs, toTs: heavy.toTs, weeks: 2, blocks: [heavy, light], rates: Object.fromEntries(
            (['fuel', 'ammo', 'steel', 'bauxite', 'drum'] as const).map(key => [key, { low: 0, high: 0, mean: avg(key === 'drum' ? 'drum' : 'fuel') }])) };
        const old = [run(999, { ts: light.fromTs + DAY_MS, flagItems: undefined })];
        const of = (basis: Parameters<typeof resourceNeeds>[7], records = old) =>
            Object.fromEntries(resourceNeeds(['fuel', 'drum'], { fuel: 0, drum: 0 }, caps, flow, records, [], new Map(), basis).map(need => [need.key, need.base]));
        expect(of('recent')).toEqual({ fuel: -400, drum: 4 });
        expect(of('lightest')).toEqual({ fuel: 100, drum: 4 });
        expect(of('none')).toEqual({ fuel: 0, drum: 0 });
        expect(lightestWeek(flow, old)).toMatchObject({ fromTs: light.fromTs, toTs: light.toTs, itemsRecorded: false });
        // 那週的紀錄都有標記時，道具也照那週。
        expect(of('lightest', [run(999, { ts: light.fromTs + DAY_MS })])).toEqual({ fuel: 100, drum: 9 });
        // 沒有各週明細：退回整段平均。
        expect(resourceNeeds(['fuel'], { fuel: 0 }, caps, { ...flow, blocks: undefined }, [], [], new Map(), 'lightest')[0].base).toBe(-400);
    });

    it('沒有流量時基本淨增減不可考', () => {
        expect(resourceNeeds(['fuel'], { fuel: 999 }, caps, null, [])).toEqual([{ key: 'fuel', have: 999, cap: caps.fuel, base: null, current: null }]);
    });

    it('daysToFill：已滿且不減為 0，已滿卻會掉出上限或速度不為正為 Infinity', () => {
        expect(daysToFill(0, 0)).toBe(0);
        expect(daysToFill(0, -5)).toBe(Infinity);
        expect(daysToFill(10, 0)).toBe(Infinity);
        expect(daysToFill(10, 4)).toBe(2.5);
    });
});

describe('planExpeditions：睡前組合', () => {
    // 每趟固定燃料：紀錄達 MIN_RUNS 才用平均，不受固定報酬影響。
    const fuelMission = (id: number, time: number, fuel: number) => ({ mission: mission(id, time), records: runs(MIN_RUNS, id, { resources: [fuel, 0, 0, 0] }) });
    const setup = (...items: { mission: PlanMission; records: ExpeditionRow[] }[]) =>
        ({ missions: items.map(item => item.mission), records: items.flatMap(item => item.records) });

    it('沒有作息離開（0 或省略）時與原本相同，睡前組合為空', () => {
        const data = setup(fuelMission(901, 60, 100), fuelMission(902, 60, 80), fuelMission(903, 60, 60), fuelMission(904, 60, 40));
        const base = plan({ ...data, intervalMinutes: 60, needs: [need('fuel', 0)] });
        const zero = plan({ ...data, intervalMinutes: 60, sleepMinutes: 0, needs: [need('fuel', 0)] });
        expect(zero).toEqual(base);
        expect(base.sleep).toEqual([]);
        expect(base.sleepMinutes).toBe(0);
    });

    it('睡前挑單趟收益高、離開期間跑得完的長遠征；在線挑時產高的短遠征', () => {
        const data = setup(
            fuelMission(901, 30, 50), fuelMission(902, 30, 45), fuelMission(903, 30, 40),   // 每小時 100／90／80
            fuelMission(911, 480, 500), fuelMission(912, 420, 450), fuelMission(913, 360, 400), // 單趟多、時產低
        );
        const result = plan({ ...data, intervalMinutes: 30, sleepMinutes: 480, needs: [need('fuel', 0)] });
        expect(ids(result.top)).toEqual([901, 902, 903]);
        expect(ids(result.sleep)).toEqual([911, 912, 913]);
        // 在線 16 小時：(100 + 90 + 80) × 16 ＋ 睡前 500 + 450 + 400。
        expect(result.outlook[0].planRate).toBeCloseTo(270 * 16 + 1350);
    });

    it('比離開時間長的睡前遠征會吃掉在線時間：回來後要等到下一個收取點', () => {
        // 離開 8 小時、每 2 小時收：10 小時的遠征佔用 8 + 2 = 10 小時，那一隊在線只剩 14 小時。
        const data = setup(fuelMission(901, 120, 200), fuelMission(921, 600, 1000));
        const result = plan({ ...data, intervalMinutes: 120, sleepMinutes: 480, needs: [need('fuel', 0)] });
        expect(ids(result.top)).toEqual([901, 921]);
        // 兩條在線、睡前都用上，同一條只能同一隊跑：921 那隊在線 14 小時只跑得完 1 趟 1000（第二趟睡前收不回來）＋睡前 1000；
        // 901 那隊在線 16 小時 8 趟 1600＋睡前 200。
        const pairs = result.top.map((row, i) => [row.missionId, result.sleep[i].missionId]);
        expect(pairs).toEqual(expect.arrayContaining([[921, 921], [901, 901]]));
        expect(result.outlook[0].planRate).toBeCloseTo(1000 + 1000 + 1600 + 200);
    });

    it('同一條遠征不會兩隊同時跑：在線組合的遠征只能是同一隊的睡前遠征', () => {
        const data = setup(fuelMission(901, 60, 100), fuelMission(902, 60, 90), fuelMission(903, 60, 80), fuelMission(904, 300, 2000));
        const result = plan({ ...data, intervalMinutes: 60, sleepMinutes: 300, needs: [need('fuel', 0)] });
        result.sleep.forEach((row, j) => result.top.forEach((other, i) => {
            if (i !== j) expect(other.missionId).not.toBe(row.missionId);
        }));
        // 904 單趟最多：睡前一定派它，且由在線也跑 904 的那一隊（若有）派。
        expect(result.sleep.map(row => row.missionId)).toContain(904);
    });

    it('睡前遠征比在線少時仍排到每一隊，輸出不丟失也不錯位', () => {
        // 離開 8 小時、每 4 小時收：兩天的 931、932 回不來，睡前只有 951 能派，且只能派給在線也跑 951 的那一隊。
        // 組合依編號是 [931, 932, 951]：睡前那條不能固定排在第一隊。
        const data = setup(fuelMission(931, 2880, 5000), fuelMission(932, 2880, 4000), fuelMission(951, 240, 100));
        const result = plan({ ...data, intervalMinutes: 240, sleepMinutes: 480, needs: [need('fuel', 0)] });
        expect(ids(result.sleep)).toEqual([951]);
        expect(ids(result.top)).toEqual([931, 932, 951]);
        // 951 那隊在線 16 小時跑 4 趟＋睡前 1 趟；兩天的遠征在有作息離開時一天跑不完一趟。
        expect(result.outlook[0].planRate).toBeCloseTo(5 * 100);
        expect(result.roles.top[result.top.findIndex(row => row.missionId === 951)]).toBe('fuel');
    });

    it('在線候選有淨收入為負的項目時，佔用較短的睡前遠征不算勝過佔用較長的', () => {
        // 905 是唯一的鋼材來源，但每趟燃料 −50。922 與 923–927 每趟燃料相同，922 佔用較長（10 小時）：
        // 派給 905 那隊時在線少兩趟，燃料多 100、鋼材少 200；鋼材兩種都會滿，燃料是瓶頸，所以 922 較好。
        const cap = stockpileCap('fuel');
        const data = setup(
            { mission: mission(905, 60), records: runs(MIN_RUNS, 905, { resources: [-50, 0, 100, 0] }) },
            fuelMission(922, 600, 500), ...[923, 924, 925, 926, 927].map(id => fuelMission(id, 480, 500)),
        );
        const result = plan({ ...data, intervalMinutes: 60, sleepMinutes: 480, needs: [need('fuel', cap - 30000), need('steel', stockpileCap('steel') - 10000)] });
        expect(result.top.map(row => row.missionId)).toContain(905);
        expect(ids(result.sleep)).toContain(922);
    });

    it('有作息離開時在線趟數取整數：最後一趟睡前收不回來就不算', () => {
        // 每小時收、睡 8 小時：2 小時 45 分的遠征一輪 3 小時，在線 16 小時只跑得完 5 趟（不是 5.33 趟），睡前再一趟。
        const data = setup(fuelMission(901, 165, 100));
        const result = plan({ ...data, intervalMinutes: 60, sleepMinutes: 480, needs: [need('fuel', 0)] });
        expect(result.outlook[0].planRate).toBeCloseTo(5 * 100 + 100);
    });

    it('分段計算先給近似解，最後給精確解；精確解在近似解卡在局部解時更好', () => {
        // 隨機資料找到的例子：交替搜尋停在 [907, 902, 905]＋[904, 903, 905]，最缺的一項較低。
        const spec: [number, number, number[]][] = [
            [901, 180, [400, 0, 0, 0]], [902, 30, [200, 250, 500, 0]], [903, 300, [300, 400, 0, 100]],
            [904, 60, [450, 0, 0, 0]], [905, 120, [0, 0, 0, 250]], [907, 30, [150, 450, 500, 0]],
        ];
        const input = {
            missions: spec.map(([id, time]) => mission(id, time)),
            records: spec.flatMap(([id, , resources]) => runs(MIN_RUNS, id, { resources })),
            needs: [need('fuel', 60000), need('ammo', 10000), need('steel', 90000), need('bauxite', 80000)],
            intervalMinutes: 60, sleepMinutes: 360, horizonDays: 10,
        };
        const lowest = (result: ReturnType<typeof planExpeditions>) => Math.min(...result.outlook.map(line => line.planAt! / line.cap));
        const steps = planExpeditionSteps(input);
        const quick = steps.next().value!;
        let step = steps.next();
        while (!step.done) step = steps.next();
        const exact = step.value;
        expect(ids(quick.top)).toEqual([902, 905, 907]);
        expect(ids(exact.top)).toEqual([903, 905, 907]);
        expect(ids(exact.sleep)).toEqual([901, 903, 904]);
        expect(lowest(exact)).toBeGreaterThan(lowest(quick));
        expect(planExpeditions(input)).toEqual(exact);
    });
});

describe('planExpeditions：每條遠征主要補哪一項', () => {
    const fuelBaux = (id: number, fuel: number, bauxite: number) => runs(MIN_RUNS, id, { resources: [fuel, 0, 0, bauxite] });

    it('取這條占組合中該資材收入比例最高的一項；都是唯一來源時取較缺的', () => {
        const result = plan({
            missions: [mission(901, 60), mission(902, 60)],
            records: [...fuelBaux(901, 100, 0), ...fuelBaux(902, 50, 50)],
            needs: [need('fuel', 0), need('bauxite', 0)],
        });
        const roleOf = (id: number) => result.roles.top[result.top.findIndex(row => row.missionId === id)];
        expect(roleOf(901)).toBe('fuel');        // 燃料 100／150
        expect(roleOf(902)).toBe('bauxite');     // 鋁土的唯一來源
        // 只有一條同時給兩項：都是唯一來源，取期限時比例較低的鋁土（持有較少）。
        const solo = plan({ missions: [mission(902, 60)], records: fuelBaux(902, 50, 50), needs: [need('fuel', 100000), need('bauxite', 0)] });
        expect(solo.roles.top).toEqual(['bauxite']);
    });

    it('已滿或沒有正收入的資材不標；沒有可標的為 null', () => {
        const result = plan({
            missions: [mission(901, 60)], records: fuelBaux(901, 100, 0),
            needs: [need('fuel', stockpileCap('fuel')), need('bauxite', 0)],
        });
        expect(result.roles.top).toEqual([null]);
        expect(result.roles.sleep).toEqual([]);
    });
});

describe('planExpeditions：沒設期限時比全部存滿的天數', () => {
    // 燃料已有 9,000、鋁土 0，上限都是 10,000；每天收一次，perDay＝每趟。
    const baux = (id: number, fuel: number, bauxite: number) => runs(MIN_RUNS, id, { resources: [fuel, 0, 0, bauxite] });
    const data = {
        missions: [mission(901, 60), mission(902, 60), mission(903, 60), mission(904, 60)],
        records: [...baux(901, 0, 100), ...baux(902, 0, 100), ...baux(903, 0, 100), ...baux(904, 50, 50)],
    };
    const needs = [need('fuel', 9000, 0, 10000), need('bauxite', 0, 0, 10000)];

    it('有期限時比期限時的比例；沒設期限時挑最快全部存滿的組合，推算時點改為那一天', () => {
        // 28 天後：三條鋁土 → 燃料 90%、鋁土 84%；換一條給燃料的 → 燃料滿、鋁土 70%。比例看前者較好，
        // 但前者燃料永遠差 1,000 存不滿；後者 20 天燃料滿、40 天鋁土滿。
        expect(ids(plan({ ...data, needs, horizonDays: 28 }).top)).toEqual([901, 902, 903]);
        const result = plan({ ...data, needs, horizonDays: 28, untilFull: true });
        expect(ids(result.top)).toContain(904);
        expect(result.horizonDays).toBeCloseTo(40);
    });

    it('怎樣都存不滿（消耗大於遠征）時維持呼叫端的推算時點', () => {
        const result = plan({ ...data, needs: [need('fuel', 9000, -1000, 10000), need('bauxite', 0, -1000, 10000)], horizonDays: 28, untilFull: true });
        expect(result.horizonDays).toBe(28);
    });

    it('最需要補＝不跑遠征時推算時點比例最低的一項，不隨收取間隔改變', () => {
        const flowNeeds = [need('fuel', 9000, -100, 10000), need('bauxite', 5000, -100, 10000)];
        for (const intervalMinutes of [60, 180, 1440]) {
            expect(plan({ ...data, needs: flowNeeds, horizonDays: 28, intervalMinutes }).focus).toBe('bauxite');
        }
    });
});
