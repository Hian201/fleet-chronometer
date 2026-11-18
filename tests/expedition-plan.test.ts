import { describe, expect, it } from 'vitest';
import type { ExpeditionRow } from '../utils/db';
import { DAY_MS } from '../utils/date-format';
import {
    ITEM_FLAG_SINCE, MIN_RUNS, daysToFill, fleetSupply, lightestWeek, planExpeditions, playerProfile, resourceNeeds,
    type PlanMission, type ResourceNeed,
} from '../utils/expedition-plan';
import { stockpileCap, STOCKPILE_KEYS } from '../utils/stockpile';

const AFTER = ITEM_FLAG_SINCE + 1000;
const BEFORE = ITEM_FLAG_SINCE - 1000;

// 測試用的遠征編號從 900 起，避開 expedition-data 的固定報酬（那些另外測）。
const mission = (id: number, time: number, over: Partial<PlanMission> = {}): PlanMission =>
    ({ id, dispNo: String(id), name: `遠征${id}`, time, resetType: 0, winItems: [[0, 0], [0, 0]], use: [0, 0], ...over });
const run = (missionId: number, over: Partial<ExpeditionRow> = {}): ExpeditionRow => ({
    eventId: 1, ts: AFTER, deckId: 2, missionId, name: `遠征${missionId}`, result: 1,
    resources: [0, 0, 0, 0], items: [], ...over,
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
    it('月常不進組合，另列最後一次成功時間；沒有紀錄的月常不列', () => {
        const result = plan({
            missions: [mission(905, 60), mission(942, 60, { resetType: 1 }), mission(943, 60, { resetType: 1 }), mission(944, 60, { resetType: 1 })],
            records: [
                ...runs(MIN_RUNS, 905, { resources: [100, 0, 0, 0] }),
                run(942, { ts: 1000 }), run(942, { ts: 3000 }), run(942, { ts: 5000, result: 0 }),
                run(943, { result: 0 }),
            ],
            needs: [need('fuel', 1000)],
        });
        expect(ids(result.top)).toEqual([905]);
        expect(result.monthly).toEqual([
            { missionId: 942, dispNo: '942', name: '遠征942', lastSuccessTs: 3000 },
            { missionId: 943, dispNo: '943', name: '遠征943', lastSuccessTs: null },
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

    it('高速修復材等只用修正 commit 之後的紀錄判斷筆數；不足時改推算', () => {
        const result = plan({
            missions: [mission(903, 30, { winItems: [[0, 0], [1, 1]] })],
            records: [...runs(MIN_RUNS, 903, { ts: BEFORE, result: 2, items: [{ id: 1, count: 9 }] }), run(903, { result: 2, items: [{ id: 1, count: 1 }] })],
            needs: [need('drum', 0)],
        });
        const [row] = result.candidates;
        expect(row.itemRuns).toBe(1);
        expect(row.estimated).toContain('drum');            // 修正後只有 1 筆 < MIN_RUNS
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

    it('支出照：最近平均／支出最少的一週／不計；最少的一週早於道具記錄時道具沿用平均', () => {
        const W = 7 * DAY_MS;
        const week = (from: number, fuel: number, ammo: number, steel: number, bauxite: number, drum: number) =>
            ({ fromTs: from, toTs: from + W, rates: { fuel, ammo, steel, bauxite, drum } });
        // 兩週：前一週（早於道具記錄）每天各 +100、水桶 +9；後一週每天各 −900、水桶 −1。沒有遠征紀錄，淨增減＝基本淨增減。
        const light = week(BEFORE - W, 100, 100, 100, 100, 9);
        const heavy = week(BEFORE, -900, -900, -900, -900, -1);
        const avg = (key: 'fuel' | 'drum') => (light.rates[key] + heavy.rates[key]) / 2;
        const flow = { fromTs: light.fromTs, toTs: heavy.toTs, weeks: 2, blocks: [heavy, light], rates: Object.fromEntries(
            (['fuel', 'ammo', 'steel', 'bauxite', 'drum'] as const).map(key => [key, { low: 0, high: 0, mean: avg(key === 'drum' ? 'drum' : 'fuel') }])) };
        const of = (basis: Parameters<typeof resourceNeeds>[7]) =>
            Object.fromEntries(resourceNeeds(['fuel', 'drum'], { fuel: 0, drum: 0 }, caps, flow, [], [], new Map(), basis).map(need => [need.key, need.base]));
        expect(of('recent')).toEqual({ fuel: -400, drum: 4 });
        expect(of('lightest')).toEqual({ fuel: 100, drum: 4 });
        expect(of('none')).toEqual({ fuel: 0, drum: 0 });
        expect(lightestWeek(flow, [])).toMatchObject({ fromTs: light.fromTs, toTs: light.toTs });
        // 沒有各週明細：退回整段平均。
        expect(resourceNeeds(['fuel'], { fuel: 0 }, caps, { ...flow, blocks: undefined }, [], [], new Map(), 'lightest')[0].base).toBe(-400);
    });

    it('沒有流量時基本淨增減不可考', () => {
        expect(resourceNeeds(['fuel'], { fuel: 999 }, caps, null, [])).toEqual([{ key: 'fuel', have: 999, cap: caps.fuel, base: null, current: null }]);
    });

    it('daysToFill：缺口 0 為 0，速度不為正為 Infinity', () => {
        expect(daysToFill(0, -5)).toBe(0);
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
        // 兩條在線、睡前都用上，同一條只能同一隊跑：921 那隊在線 14 小時（每天 2400 × 14/24）＋睡前 1000；
        // 901 那隊在線 16 小時（每天 2400 × 16/24）＋睡前 200。
        const pairs = result.top.map((row, i) => [row.missionId, result.sleep[i].missionId]);
        expect(pairs).toEqual(expect.arrayContaining([[921, 921], [901, 901]]));
        expect(result.outlook[0].planRate).toBeCloseTo(1400 + 1000 + 1600 + 200);
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
