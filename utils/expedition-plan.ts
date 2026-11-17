// 遠征組合建議：用玩家自己的遠征紀錄與資源流量，挑出三隊遠征，讓勾選的資材裡最慢存滿的那一項最快存滿。
// 純函式模組，不依賴 chrome.*、DOM 或 Dexie。
//
// 規則（現行；理由見 docs/engineering/expeditions.md「遠征組合建議」）：
//   · 資材之間是互補、不是替代：存資源是為了活動之類每項都要夠的場合，彈藥再多也補不了鋁土。
//     所以不把各資材收益加權加總（那會讓三隊擠向單趟總量最高的同一類遠征），而是三隊一起挑，
//     讓勾選資材在推算時點（備蓄期限，沒設期限為四週後）的「存量 ÷ 上限」最低的那一項最高；
//     同樣低時再比第二低的，依此類推（leximin）。超過上限的部分算 1：已滿或會滿的資材不再吸走隊伍。
//   · 存量推算＝持有 ＋（不含遠征的每日基本淨增減 ＋ 三隊遠征每日收入）× 天數。基本淨增減取玩家最近的實際流量
//     （出擊、工廠等消耗都在內），所以平常打得兇的資材自然成為瓶頸；不由程式指定權重。
//     以「占上限的比例」比較，基本資源與高速修復材等不同量級的資材才可比，淨增減為負時也照樣成立。
//   · 遠征的效率是每日收入：每趟期望收益 × 每天能收幾次。玩家每隔 interval 回來收一次，耗時 t 的遠征一輪佔
//     interval × ⌈t ÷ interval⌉。
//   · 作息：每天有一段較長的離開（睡覺、上班，sleep 分鐘）時，三隊在離開前各派一條「睡前」遠征，其餘時間跑「在線」組合。
//     睡前遠征比離開時間長時，回來後要等到下一個收取點才收得到，那一隊在線的時間跟著變短。
//     兩組合一起比同一個目標；窮舉兩組的所有配對太大（數萬 × 數萬），改為交替固定一組、窮舉另一組直到不再變（近似解）。
//   · 候選＝所有非月常、有收益的遠征。開放狀態沒有封包可判斷，沒跑過的照列並標明；不檢查編成。
//   · 月常（resetType === 1）每月只能通關一次，當定額收入，不進排序，另列最後成功時間。
//   · 每趟收益：玩家自己的紀錄夠多（MIN_RUNS）就用紀錄平均（含失敗、大成功與大發加成，是玩家實際的跑法）；
//     不夠時以固定報酬推算，套用玩家自己的成功／大成功比例與大發加成水準（expectedIncome）。
import type { ExpeditionRow } from './db';
import EXPEDITION_DATA from './expedition-data';
import { DAY_MS } from './date-format';
import type { ObservedFlow } from './goal-arrival';
import { STOCKPILE_KEYS, stockpileCap, type StockpileKey } from './stockpile';

/** 可勾選的資材，同備蓄的八種，顯示順序同遊戲的資材列。 */
export const PLAN_KEYS = STOCKPILE_KEYS;
export type PlanKey = StockpileKey;
/**
 * 預設勾選：四大資源與高速修復材。高速建造材、開發資材、改修資材靠遠征取得的效率極低，
 * 預設不讓它們影響遠征的順位；玩家仍可自己勾選。
 */
export const DEFAULT_CHOSEN: readonly PlanKey[] = ['fuel', 'ammo', 'steel', 'bauxite', 'drum'];
/** 同時出遠征的艦隊數（第二～第四艦隊）。 */
export const PLAN_FLEETS = 3;

/** winItems：主檔 [api_win_item1, api_win_item2]，各為 [useitem id, 數量]；use：[api_use_fuel, api_use_bull]。 */
export interface PlanMission {
    id: number; dispNo: string; name: string; time: number; resetType: number;
    winItems: [number, number][]; use: [number, number];
}
/** 艦名 → [燃料上限, 彈藥上限]（master 的 api_fuel_max／api_bull_max），用來換算遠征紀錄編成的補給量。 */
export type ShipMaxByName = ReadonlyMap<string, readonly [number, number]>;

/** 紀錄筆數達到這個數才用玩家自己的平均；少於時用固定報酬推算（少數幾趟的平均受大成功與道具亂數影響太大）。 */
export const MIN_RUNS = 10;
/** 大成功的資源倍率（wikiwiki.jp/kancolle「遠征」：大成功すると獲得資材が1.5倍）。 */
const GREAT_SUCCESS_RATE = 1.5;

/** 回航道具 useitem id 與資材的對應；useitem 1／2／3／4 正好是高速修復材／高速建造材／開發資材／改修資材。 */
const ITEM_ID = { drum: 1, torch: 2, devmat: 3, screw: 4 } as const;
const MAT_INDEX = { fuel: 0, ammo: 1, steel: 2, bauxite: 3 } as const;

// 捷徑：以修正 commit（f2b6986，回航道具依 api_useitem_flag 投影）的時刻切分；那之前的紀錄沒有
// useitem 1／2／3（高速修復材、高速建造材、開發資材），不能當 0。那之後若仍跑舊版 build，紀錄會被當成真的 0；
// 改用紀錄裡的投影版本標記時再移除。
export const ITEM_FLAG_SINCE = Date.parse('2026-11-12T13:21:27Z');
const FLAG_ITEM_KEYS: readonly PlanKey[] = ['drum', 'torch', 'devmat'];

type Income = Record<PlanKey, number | null>;

export interface PlanRow {
    missionId: number;
    dispNo: string;
    name: string;
    /** 分鐘。 */
    time: number;
    /** 每趟的平均收益；null＝這段期間沒有可用紀錄（不可考），不以 0 頂替、不計入速度。 */
    income: Income;
    /** 每日收入（每趟平均 × 每天能收幾次）；null 同 income。 */
    perDay: Income;
    /** 玩家紀錄的筆數（0＝沒跑過）。 */
    runs: number;
    /** 以固定報酬推算（而非玩家紀錄平均）的資材。 */
    estimated: PlanKey[];
    /** 每趟補給消耗 [燃料, 彈藥]；已從 income／perDay 的燃料與彈藥扣掉。 */
    supply: [number, number];
    /** 補給是用最低編成艘數推算（沒有可換算的紀錄編成）。 */
    supplyEstimated: boolean;
    /** 高速修復材／高速建造材／開發資材平均所依據的紀錄筆數（修正 commit 之後）。 */
    itemRuns: number;
}

/** 一項勾選資材的需求：持有、上限與不含遠征的每日基本淨增減。 */
export interface ResourceNeed {
    key: PlanKey;
    /** 扣掉改造保留後的持有量；不可考為 null（不參與比較）。 */
    have: number | null;
    cap: number;
    /** 不含遠征收入的每日淨增減（自然回復、任務等減去出擊、工廠等消耗）；沒有流量資料為 null，推算時當 0。 */
    base: number | null;
    /** 觀測期間的實際每日淨增減（含當時跑的遠征）；沒有流量資料為 null。 */
    current: number | null;
}

/** 一項資材在推算時點的展望。存量未夾在 0～上限之間，由畫面決定怎麼呈現。 */
export interface ResourceOutlook {
    key: PlanKey;
    have: number | null;
    cap: number;
    /** 照觀測期間的步調（含當時跑的遠征）的推算存量；不可考為 null。 */
    nowAt: number | null;
    /** 照建議組合的推算存量；持有不可考為 null。 */
    planAt: number | null;
    /** 照建議組合的每日淨增減。 */
    planRate: number;
    /** 照建議組合到上限的天數（0＝已滿，Infinity＝不會滿）；持有不可考為 null。 */
    planDays: number | null;
}

export interface MonthlyRow { missionId: number; dispNo: string; name: string; lastSuccessTs: number | null }

export interface ExpeditionPlan {
    /** 建議的（在線）組合（最多三條，遠征不重複），依對 focus 資材的每日收入排列。 */
    top: PlanRow[];
    /** 睡前組合，與 top 同位置的是同一隊；沒有作息離開時為空陣列。 */
    sleep: PlanRow[];
    /** 每天一次的較長離開（分鐘）；0＝沒有。 */
    sleepMinutes: number;
    outlook: ResourceOutlook[];
    /** 建議組合下推算時點存量比例最低（且未滿）的資材；都會滿或不可考為 null。 */
    bottleneck: PlanKey | null;
    /** top 與 candidates 的排列依據：有候選遠征給得到、未滿的資材中期限時比例最低（都會滿時取最慢滿）的一項；沒有為 null。 */
    focus: PlanKey | null;
    monthly: MonthlyRow[];
    /** 候選遠征數；0 表示沒有可建議的遠征。 */
    candidateCount: number;
    /** 全部候選，依對 focus 資材的每日收入排列（供玩家對照）。 */
    candidates: PlanRow[];
    profile: PlayerProfile;
    /** 推算時點距今的天數。 */
    horizonDays: number;
}

const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const finite = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const itemCount = (row: ExpeditionRow, id: number) =>
    (row.items ?? []).reduce((sum, item) => sum + (item.id === id ? finite(item.count) : 0), 0);
const gainOf = (row: ExpeditionRow, key: PlanKey) => key in MAT_INDEX
    ? finite(row.resources?.[MAT_INDEX[key as keyof typeof MAT_INDEX]])
    : itemCount(row, ITEM_ID[key as keyof typeof ITEM_ID]);

/** 一條遠征的固定報酬（expedition-data 的燃彈鋼鋁）；沒有資料為 null。 */
const BASE_REWARD = new Map<number, number[]>(EXPEDITION_DATA.map(entry =>
    [entry.id, [entry.reward_fuel, entry.reward_bullet, entry.reward_steel, entry.reward_alum]]));
/** 一條遠征的最低編成艘數（expedition-data 的 ship_count）。 */
const SHIP_COUNT = new Map<number, number>(EXPEDITION_DATA.map(entry => [entry.id, entry.ship_count]));

/**
 * 一支編成跑一趟的補給消耗 [燃料, 彈藥]。依 wikiwiki.jp/kancolle「遠征」：各艦消耗出發時燃彈 × 消費率，端數切捨
 * （補給滿載出發，出發時燃彈即上限）。編成中有艦名對不到 master 時為 null。
 */
export function fleetSupply(fleet: readonly { name: string }[] | undefined, use: readonly [number, number], shipMax: ShipMaxByName): [number, number] | null {
    if (!fleet?.length) return null;
    let fuel = 0, ammo = 0;
    for (const ship of fleet) {
        const max = shipMax.get(ship.name);
        if (!max) return null;
        fuel += Math.floor(max[0] * use[0]);
        ammo += Math.floor(max[1] * use[1]);
    }
    return [fuel, ammo];
}

/** 玩家整體的成功（不含大成功）與大成功比例。 */
export interface PlayerProfile {
    success: number; great: number; bonus: number;
    /** 玩家遠征艦的燃彈上限中位數；推算沒跑過的遠征補給用。對不到任何艦時為 null。 */
    shipMax: [number, number] | null;
}

/**
 * 從玩家全部紀錄估出推算用的參數。
 *   success／great：全部紀錄的比例（玩家平常是否刷閃，反映在這裡）；沒有紀錄時為 1／0。
 *   bonus：大發加成水準＝常跑遠征（≥ MIN_RUNS）的實際資源 ÷（固定報酬 × 成功與大成功倍率）的中位數，下限 1。
 *     沒有常跑的遠征時為 1（不含加成）。
 */
export function playerProfile(missions: readonly PlanMission[], records: readonly ExpeditionRow[], shipMax: ShipMaxByName = new Map()): PlayerProfile {
    const total = records.length;
    // 完全沒有紀錄時一律當成功推算，不假設會大成功。
    const success = total ? records.filter(row => row.result === 1).length / total : 1;
    const great = total ? records.filter(row => row.result === 2).length / total : 0;
    const known = new Set(missions.map(mission => mission.id));
    const byMission = new Map<number, ExpeditionRow[]>();
    for (const row of records) if (known.has(row.missionId)) byMission.set(row.missionId, [...(byMission.get(row.missionId) ?? []), row]);
    const ratios: number[] = [];
    for (const [id, rows] of byMission) {
        const base = BASE_REWARD.get(id);
        const baseSum = base ? base.reduce((sum, v) => sum + v, 0) : 0;
        if (rows.length < MIN_RUNS || !(baseSum > 0)) continue;
        const theory = rows.reduce((sum, row) => sum + (row.result === 2 ? GREAT_SUCCESS_RATE : row.result === 1 ? 1 : 0), 0) * baseSum;
        const actual = rows.reduce((sum, row) => sum + [0, 1, 2, 3].reduce((acc, i) => acc + finite(row.resources?.[i]), 0), 0);
        if (theory > 0) ratios.push(actual / theory);
    }
    ratios.sort((a, b) => a - b);
    const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
    const maxes = records.flatMap(row => (row.fleet ?? []).flatMap(ship => { const max = shipMax.get(ship.name); return max ? [max] : []; }));
    const mid = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    return {
        success, great, bonus: Math.max(1, median),
        shipMax: maxes.length ? [mid(maxes.map(max => max[0])), mid(maxes.map(max => max[1]))] : null,
    };
}

/**
 * 用固定報酬推算每趟期望收益；這條遠征沒有該項資料為 null。
 * 道具規則依 wikiwiki.jp/kancolle「遠征」：api_win_item1 成功或大成功都隨機入手，數量 0～上限平均分布（期望＝上限 ÷ 2）；
 * api_win_item2 只有大成功入手，數量 1～上限平均分布（期望＝(上限 + 1) ÷ 2）。資源大成功 1.5 倍，再乘大發加成水準。
 */
function expectedIncome(mission: PlanMission, key: PlanKey, profile: PlayerProfile): number | null {
    if (key in MAT_INDEX) {
        const base = BASE_REWARD.get(mission.id);
        if (!base) return null;
        return base[MAT_INDEX[key as keyof typeof MAT_INDEX]] * (profile.success + GREAT_SUCCESS_RATE * profile.great) * profile.bonus;
    }
    const id = ITEM_ID[key as keyof typeof ITEM_ID];
    const [first, second] = mission.winItems;
    let value = 0;
    if (first?.[0] === id) value += (profile.success + profile.great) * first[1] / 2;
    if (second?.[0] === id) value += profile.great * (second[1] + 1) / 2;
    return value;
}

/**
 * 一條遠征每趟的補給：玩家最近一次跑它的編成可換算時用它；否則用最低編成艘數 × 玩家遠征艦燃彈上限的中位數推算。
 */
function supplyOf(mission: PlanMission, records: readonly ExpeditionRow[], profile: PlayerProfile, shipMax: ShipMaxByName): { supply: [number, number]; estimated: boolean } {
    for (let i = records.length - 1; i >= 0; i--) {
        const supply = fleetSupply(records[i].fleet, mission.use, shipMax);
        if (supply) return { supply, estimated: false };
    }
    const count = SHIP_COUNT.get(mission.id) ?? 0;
    const max = profile.shipMax;
    if (!max || !count) return { supply: [0, 0], estimated: true };
    return { supply: [count * Math.floor(max[0] * mission.use[0]), count * Math.floor(max[1] * mission.use[1])], estimated: true };
}

function incomeOf(mission: PlanMission, records: readonly ExpeditionRow[], profile: PlayerProfile): { income: Income; itemRuns: number; estimated: PlanKey[] } {
    const flagged = records.filter(row => row.ts >= ITEM_FLAG_SINCE);
    const income = {} as Income;
    const estimated: PlanKey[] = [];
    for (const key of PLAN_KEYS) {
        const sample = FLAG_ITEM_KEYS.includes(key) ? flagged : records;
        if (sample.length >= MIN_RUNS) { income[key] = average(sample.map(row => gainOf(row, key))); continue; }
        const guess = expectedIncome(mission, key, profile);
        if (guess !== null) { income[key] = guess; estimated.push(key); continue; }
        income[key] = sample.length ? average(sample.map(row => gainOf(row, key))) : null;
    }
    return { income, itemRuns: flagged.length, estimated };
}

/** 到上限天數：缺口 0 以下為 0；速度不為正為 Infinity。 */
export const daysToFill = (gap: number, perDay: number) => (gap <= 0 ? 0 : perDay > 0 ? gap / perDay : Infinity);

/**
 * 勾選資材的需求。基本淨增減＝觀測期間的每日淨增減 − 同期間遠征紀錄的每日收入。
 * @param free 各資材扣掉改造保留後的持有量；不可考為 null。
 */
export function resourceNeeds(
    chosen: readonly PlanKey[], free: Partial<Record<PlanKey, number | null>>, caps: Record<PlanKey, number>,
    flow: ObservedFlow | null, records: readonly ExpeditionRow[],
    missions: readonly PlanMission[] = [], shipMax: ShipMaxByName = new Map(),
): ResourceNeed[] {
    const days = flow ? (flow.toTs - flow.fromTs) / DAY_MS : 0;
    const inWindow = flow && days > 0 ? records.filter(row => row.ts > flow.fromTs && row.ts <= flow.toTs) : [];
    // 遠征的補給也算在遠征帳上：基本淨增減扣掉的是遠征的淨收入（收益 − 補給），換遠征時補給才不會重複算或漏算。
    const missionById = new Map(missions.map(mission => [mission.id, mission]));
    const supplies = inWindow.map(row => {
        const mission = missionById.get(row.missionId);
        return mission ? fleetSupply(row.fleet, mission.use, shipMax) ?? [0, 0] : [0, 0];
    });
    return PLAN_KEYS.filter(key => chosen.includes(key)).map(key => {
        const raw = free[key];
        const have = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
        const rate = flow?.rates[key];
        if (!rate || !(days > 0)) return { key, have, cap: caps[key], base: null, current: null };
        // 捷徑：觀測期間跨過 ITEM_FLAG_SINCE 時，之前的遠征道具收入沒有紀錄，高速修復材等的基本淨增減會偏高；
        // 觀測期間（最多四週）完全落在修正之後就沒有這個偏差。
        const spent = key === 'fuel' ? 0 : key === 'ammo' ? 1 : -1;
        const expedPerDay = inWindow.reduce((sum, row, i) => sum + gainOf(row, key) - (spent >= 0 ? supplies[i][spent] : 0), 0) / days;
        return { key, have, cap: caps[key], base: rate.mean - expedPerDay, current: rate.mean };
    });
}

const DAY_MINUTES = 1440;

/** 一隊一天的淨收入（八種資材；不可考算 0，不計入速度）。 */
type Daily = Record<PlanKey, number>;

const rateWith = (need: ResourceNeed, fleets: readonly Daily[]) =>
    (need.base ?? 0) + fleets.reduce((sum, fleet) => sum + fleet[need.key], 0);

/**
 * 一個組合的評分，依序比較：
 *   1. fill：各資材推算時點的存量比例（上限算 1），由小到大排，越大越好。
 *   2. days：各資材到上限的天數，由大到小排，越小越好。期限前都會滿的組合在 fill 全部同分，
 *      這一層讓它們比誰最快滿，不會隨便挑到不給該資材的遠征。
 *   3. total：勾選資材每日淨增減 ÷ 上限的總和，越大越好（前兩層都同分時，多拿的才是好組合）。
 *   4. byproduct：所有八種資材每日淨收入 ÷ 上限的總和，越大越好。勾選資材完全同分時（例如兩條遠征每天給一樣多的鋼），
 *      順便多給沒勾的資材的那組較好，不由窮舉順序決定。
 */
interface ComboScore { fill: number[]; days: number[]; total: number; byproduct: number }

function scoreOf(needs: readonly ResourceNeed[], fleets: readonly Daily[], horizon: number): ComboScore {
    const known = needs.filter(need => need.have !== null);
    const rates = known.map(need => rateWith(need, fleets));
    return {
        fill: known.map((need, i) => Math.min(1, (need.have! + rates[i] * horizon) / need.cap)).sort((a, b) => a - b),
        days: known.map((need, i) => daysToFill(need.cap - need.have!, rates[i])).sort((a, b) => b - a),
        total: known.reduce((sum, need, i) => sum + rates[i] / need.cap, 0),
        byproduct: fleets.reduce((sum, fleet) => sum + PLAN_KEYS.reduce((acc, key) => acc + fleet[key] / stockpileCap(key), 0), 0),
    };
}

/** 逐項比較；回傳正數表示 a 優先（ascending＝較小者優先）。Infinity 彼此相等。 */
function compareVectors(a: number[], b: number[], ascending = false): number {
    for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        return (a[i] > b[i] ? 1 : -1) * (ascending ? -1 : 1);
    }
    return 0;
}

const compareNumbers = (a: number, b: number) => (a === b ? 0 : a > b ? 1 : -1);
const compareScores = (a: ComboScore, b: ComboScore) =>
    compareVectors(a.fill, b.fill) || compareVectors(a.days, b.days, true)
    || compareNumbers(a.total, b.total) || compareNumbers(a.byproduct, b.byproduct);

function* mapIter<T, U>(items: readonly T[], fn: (item: T) => U): Generator<U> {
    for (const item of items) yield fn(item);
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
    if (items.length <= 1) { yield [...items]; return; }
    for (let i = 0; i < items.length; i++) {
        for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
    }
}

function* combinations<T>(items: readonly T[], size: number, start = 0, picked: T[] = []): Generator<T[]> {
    if (picked.length === size) { yield picked; return; }
    for (let i = start; i <= items.length - (size - picked.length); i++) yield* combinations(items, size, i + 1, [...picked, items[i]]);
}

export function planExpeditions(input: {
    missions: readonly PlanMission[];
    records: readonly ExpeditionRow[];
    /** 玩家（在線時）多久回來收一次遠征（分鐘）。 */
    intervalMinutes: number;
    /** 每天一次較長的離開（分鐘，睡覺、上班）；0 或省略＝沒有，整天都照 intervalMinutes 收。 */
    sleepMinutes?: number;
    needs: readonly ResourceNeed[];
    /** 推算時點距今的天數（備蓄期限，沒設期限時由呼叫端給預設）。 */
    horizonDays: number;
    shipMax?: ShipMaxByName;
}): ExpeditionPlan {
    const shipMax = input.shipMax ?? new Map();
    const horizon = Math.max(0, input.horizonDays);
    const interval = input.intervalMinutes;
    const sleep = Math.min(DAY_MINUTES, Math.max(0, input.sleepMinutes ?? 0));
    const missionById = new Map(input.missions.map(mission => [mission.id, mission]));
    const byMission = new Map<number, ExpeditionRow[]>();
    for (const row of input.records) {
        // missionId 為 0 的舊紀錄只剩名稱，無從對到主檔的遠征時間。
        if (!(row.missionId > 0) || !missionById.has(row.missionId)) continue;
        const list = byMission.get(row.missionId);
        if (list) list.push(row); else byMission.set(row.missionId, [row]);
    }
    const profile = playerProfile(input.missions, input.records, shipMax);
    const monthly: MonthlyRow[] = [];
    const candidates: PlanRow[] = [];
    for (const mission of input.missions) {
        const records = byMission.get(mission.id) ?? [];
        if (mission.resetType === 1) {
            if (!records.length) continue;
            const successes = records.filter(row => row.result >= 1).map(row => row.ts);
            monthly.push({ missionId: mission.id, dispNo: mission.dispNo, name: mission.name, lastSuccessTs: successes.length ? Math.max(...successes) : null });
            continue;
        }
        if (!(mission.time > 0)) continue;
        const { income, itemRuns, estimated } = incomeOf(mission, records, profile);
        // 沒有任何收益的遠征（支援遠征等）不列入。
        if (!PLAN_KEYS.some(key => (income[key] ?? 0) > 0)) continue;
        const { supply, estimated: supplyEstimated } = supplyOf(mission, records, profile, shipMax);
        if (income.fuel !== null) income.fuel -= supply[0];
        if (income.ammo !== null) income.ammo -= supply[1];
        const cyclesPerDay = DAY_MINUTES / (interval * Math.ceil(mission.time / interval));
        const perDay = {} as Income;
        for (const key of PLAN_KEYS) perDay[key] = income[key] === null ? null : income[key]! * cyclesPerDay;
        candidates.push({ missionId: mission.id, dispNo: mission.dispNo, name: mission.name, time: mission.time, income, perDay, runs: records.length, itemRuns, estimated, supply, supplyEstimated });
    }
    candidates.sort((a, b) => a.missionId - b.missionId);
    monthly.sort((a, b) => a.missionId - b.missionId);

    // 一隊一天：在線組合在扣掉睡前遠征佔用的時間裡照 interval 收；睡前遠征一天一趟。
    // 睡前遠征佔用＝離開時間，比離開時間長時再加上回來後等到下一個收取點的時間。
    const occupied = (row: PlanRow) => (row.time <= sleep ? sleep : sleep + interval * Math.ceil((row.time - sleep) / interval));
    const fleetDaily = (day: PlanRow | undefined, night: PlanRow | undefined): Daily => {
        const online = DAY_MINUTES - (night ? occupied(night) : sleep);
        const daily = {} as Daily;
        for (const key of PLAN_KEYS) {
            daily[key] = (day ? (day.perDay[key] ?? 0) * online / DAY_MINUTES : 0) + (night ? night.income[key] ?? 0 : 0);
        }
        return daily;
    };
    interface Pick { day: PlanRow[]; night: PlanRow[]; fleets: Daily[]; score: ComboScore }
    const pickOf = (day: PlanRow[], night: PlanRow[]): Pick => {
        const fleets = Array.from({ length: Math.max(day.length, night.length) }, (_, i) => fleetDaily(day[i], night[i]));
        return { day, night, fleets, score: scoreOf(input.needs, fleets, horizon) };
    };
    // 同一條遠征不能兩隊同時跑：在線組合的某條若是另一隊的睡前遠征，睡前出發時它可能還沒回來。
    // 同一隊白天、睡前跑同一條沒有衝突。
    const clashes = (day: PlanRow[], night: PlanRow[]) =>
        night.some((row, j) => day.some((other, i) => i !== j && other.missionId === row.missionId));
    // 睡前遠征佔用時間不同時，哪一隊配哪一條會影響在線時間，三條的排列都試；佔用都一樣只需找一個不衝突的排列。
    const bestPairing = (day: PlanRow[], night: PlanRow[]): Pick | null => {
        const sameLength = night.every(row => occupied(row) === occupied(night[0]));
        let best: Pick | null = null;
        for (const order of permutations(night)) {
            if (clashes(day, order)) continue;
            const pick = pickOf(day, order);
            if (sameLength) return pick;
            if (!best || compareScores(pick.score, best.score) > 0) best = pick;
        }
        return best;
    };
    const argmax = (picks: Iterable<Pick | null>): Pick | null => {
        let best: Pick | null = null;
        for (const pick of picks) if (pick && (!best || compareScores(pick.score, best.score) > 0)) best = pick;
        return best;
    };

    // 候選約六十條，C(n, 3) 在數萬以內，沒有作息離開時直接窮舉求精確解。
    const size = Math.min(PLAN_FLEETS, candidates.length);
    const daySets = [...combinations(candidates, size)];
    let best: Pick;
    if (!sleep) best = argmax(daySets.map(day => pickOf(day, [])))!;
    else {
        // 超過一天才回得來的遠征不能每天睡前派，只當在線組合。
        const nightCandidates = candidates.filter(row => occupied(row) <= DAY_MINUTES);
        const nightSets = [...combinations(nightCandidates, Math.min(PLAN_FLEETS, nightCandidates.length))];
        const withDay = (night: PlanRow[]) => argmax(mapIter(daySets, day => bestPairing(day, night)));
        const withNight = (day: PlanRow[]) => argmax(mapIter(nightSets, night => bestPairing(day, night)));
        // 交替固定一組、窮舉另一組；每一步都含目前的組合，分數不會下降，不再變好就停。
        // 從「先挑在線」與「先挑睡前」兩個起點各跑一次，取較好的，減少卡在局部解。
        // 候選很少時可能每個組合都衝突（沒有解），就停在目前的組合。
        const alternate = (start: Pick, nightNext: boolean): Pick => {
            let current = start;
            for (let step = 0; step < 20; step++) {
                const next = nightNext ? withNight(current.day) : withDay(current.night);
                nightNext = !nightNext;
                if (!next || (step > 0 && compareScores(next.score, current.score) <= 0)) break;
                current = next;
            }
            return current;
        };
        const fromDay = alternate(argmax(daySets.map(day => pickOf(day, [])))!, true);
        const fromNight = alternate(argmax(nightSets.map(night => pickOf([], night)))!, false);
        best = compareScores(fromNight.score, fromDay.score) > 0 ? fromNight : fromDay;
    }

    const outlook: ResourceOutlook[] = input.needs.map(need => {
        const planRate = rateWith(need, best.fleets);
        if (need.have === null) return { key: need.key, have: null, cap: need.cap, nowAt: null, planAt: null, planRate, planDays: null };
        return {
            key: need.key, have: need.have, cap: need.cap,
            nowAt: need.current === null ? null : need.have + need.current * horizon,
            planAt: need.have + planRate * horizon,
            planRate,
            planDays: daysToFill(need.cap - need.have, planRate),
        };
    });
    const lowest = outlook.filter(line => line.planAt !== null && line.planAt < line.cap)
        .sort((a, b) => a.planAt! / a.cap - b.planAt! / b.cap)[0];
    const bottleneck = lowest?.key ?? null;
    // 排列依據：有候選遠征給得到、還沒滿的資材中，期限時比例最低的一項（與瓶頸同一個判準）；
    // 期限前都會滿時改取最慢滿的一項。瓶頸若沒有任何遠征給得到，依它排序沒有意義，所以只看給得到的資材。
    const focus = outlook.filter(line => line.planDays !== null && line.planDays > 0
        && candidates.some(row => (row.perDay[line.key] ?? 0) > 0))
        .sort((a, b) => Math.min(1, a.planAt! / a.cap) - Math.min(1, b.planAt! / b.cap)
            || compareVectors([a.planDays!], [b.planDays!]))[0]?.key ?? null;
    const focusOrder = (a: PlanRow, b: PlanRow) => focus ? (b.perDay[focus] ?? 0) - (a.perDay[focus] ?? 0) || a.time - b.time : 0;
    const byFocus = (rows: PlanRow[]) => (focus ? [...rows].sort(focusOrder) : rows);
    // 在線組合依 focus 排列，睡前組合跟著同一隊移動。
    const fleetOrder = best.day.map((_, i) => i).sort((a, b) => focusOrder(best.day[a], best.day[b]));
    return {
        top: fleetOrder.map(i => best.day[i]), sleep: best.day.length ? fleetOrder.map(i => best.night[i]).filter(Boolean) : best.night,
        sleepMinutes: sleep, outlook, bottleneck, focus, monthly,
        candidateCount: candidates.length, candidates: byFocus(candidates), profile, horizonDays: horizon,
    };
}
