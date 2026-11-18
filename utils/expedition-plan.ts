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
//     有作息離開時在線趟數取整數（最後一趟睡前收不回來就不能派）。兩組合一起比同一個目標，求精確解：先以交替搜尋得到近似解，
//     再以它為下限做分枝定界（planExpeditionSteps 分段執行，畫面先顯示近似解）。
//   · 候選＝所有非月常、有收益、目前能派的遠征（最近一次遠征畫面的清單裡有的；從沒收到清單時全部照列）。不檢查編成。
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

// 高速修復材、高速建造材、開發資材只有帶 flagItems 標記的紀錄才有記錄（見 db.ts ExpeditionRow）；
// 沒有標記的舊紀錄這三項不能當 0。用紀錄本身的標記而不是時間切分：更新前的版本寫的紀錄時間再新也缺這三種道具。
const FLAG_ITEM_KEYS: readonly PlanKey[] = ['drum', 'torch', 'devmat'];
const itemsRecorded = (row: ExpeditionRow) => row.flagItems === true;

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
    /** 高速修復材／高速建造材／開發資材平均所依據的紀錄筆數（有道具標記的紀錄）。 */
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
    /** 其中建議組合的遠征本身每日淨收入（已扣補給，不含基本淨增減）。 */
    expRate: number;
    /** 照建議組合到上限的天數（0＝已滿，Infinity＝不會滿）；持有不可考為 null。 */
    planDays: number | null;
}

export interface MonthlyRow {
    missionId: number; dispNo: string; name: string; lastSuccessTs: number | null;
    /** 本期（monthlyExpeditionCycle）已有成功紀錄；失敗可以再跑，不算。 */
    doneThisCycle: boolean;
    /** 本期能不能派：在本期的遠征清單裡才算開放；沒有本期的清單為 null（月常每期換期後前置要重跑，舊清單不算）。 */
    open: boolean | null;
}

/** 最近一次遠征畫面的遠征清單（GameState.missionList）：清單裡的遠征 id、下次月常換期（毫秒）。 */
export interface MissionListView {
    states: ReadonlyMap<number, number>;
    resetAt: number | null;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * 月常遠征的本期起訖（毫秒；end 是下次換期，本期不含 end）。日本時間每月 15 日 12:00 換期，
 * 依 wikiwiki.jp/kancolle「遠征」マンスリー遠征：「開始月15日の昼12:00 ～ 翌月15日の昼12:00まで」、
 * 換期時不必重新登入。日本時間 12:00＝UTC 03:00。
 */
export function monthlyExpeditionCycle(ts: number): { start: number; end: number } {
    const jst = new Date(ts + 9 * HOUR_MS);
    const year = jst.getUTCFullYear(), month = jst.getUTCMonth();
    const at = (m: number) => Date.UTC(year, m, 15, 3);
    return ts >= at(month) ? { start: at(month), end: at(month + 1) } : { start: at(month - 1), end: at(month) };
}

export interface ExpeditionPlan {
    /** 建議的（在線）組合（最多三條，遠征不重複），依對 focus 資材的每日收入排列。 */
    top: PlanRow[];
    /** 睡前組合，與 top 同位置的是同一隊；沒有作息離開時為空陣列。 */
    sleep: PlanRow[];
    /** 每天一次的較長離開（分鐘）；0＝沒有。 */
    sleepMinutes: number;
    /** top、sleep 各條主要補哪一項（同位置對應）；沒有可標的為 null。規則見 rolesOf()。 */
    roles: { top: (PlanKey | null)[]; sleep: (PlanKey | null)[] };
    outlook: ResourceOutlook[];
    /** 建議組合下推算時點存量比例最低（且未滿）的資材；都會滿或不可考為 null。 */
    bottleneck: PlanKey | null;
    /** 最需要補的資材（結論句、top 與 candidates 的排列依據）：有候選遠征給得到、還沒滿的資材中，
     *  不跑遠征時推算時點比例最低的一項（只看持有與基本淨增減，不隨組合或收取間隔改變）；沒有為 null。 */
    focus: PlanKey | null;
    /** 月常小表：本期還能跑的在前，本期未開放的其次，已完成的最後。 */
    monthly: MonthlyRow[];
    /** 月常遠征的本期起訖；有本期的遠征清單時 end 用伺服器給的換期時間。 */
    monthlyCycle: { start: number; end: number };
    /** 有收益、但不在遠征清單裡（目前不能派）而不列入候選的一般遠征數；沒有清單為 0。 */
    lockedCount: number;
    /** 有遠征清單：候選都是能派的，「沒跑過」不必再請玩家確認是否開放。 */
    listKnown: boolean;
    /** 候選遠征數；0 表示沒有可建議的遠征。 */
    candidateCount: number;
    /** 全部候選，依對 focus 資材的每日收入排列（供玩家對照）。 */
    candidates: PlanRow[];
    profile: PlayerProfile;
    /** 推算時點距今的天數；沒設期限時是建議組合全部存滿的天數（最多 UNTIL_FULL_MAX_DAYS），存不滿時為呼叫端的預設。 */
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
    const flagged = records.filter(itemsRecorded);
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
 * 推算時每天的支出照哪一段算（遠征以外的淨增減：自然回復、任務收入減去出擊、工廠等消耗）：
 *   recent：整段觀測期間（最近最多四週）的平均，照常出擊時用。
 *   lightest：觀測期間裡支出最少的一週（lightestWeek()），準備進入備蓄、少出擊時用。
 *   none：不計，只看遠征本身能存多少。
 * 接下來怎麼打只有玩家知道，所以由玩家選，不由程式猜。
 */
export type SpendBasis = 'recent' | 'lightest' | 'none';
export const SPEND_BASES: readonly SpendBasis[] = ['recent', 'lightest', 'none'];

/**
 * 一段期間各資材的基本淨增減＝期間的每日淨增減 − 同期間遠征紀錄的每日淨收入（收益 − 補給）。
 * 遠征的補給算在遠征帳上，換遠征時補給才不會重複算或漏算。
 */
function basesOver(
    fromTs: number, toTs: number, netOf: (key: PlanKey) => number | undefined,
    records: readonly ExpeditionRow[], missions: readonly PlanMission[], shipMax: ShipMaxByName,
): Partial<Record<PlanKey, number>> {
    const days = (toTs - fromTs) / DAY_MS;
    if (!(days > 0)) return {};
    const inWindow = records.filter(row => row.ts > fromTs && row.ts <= toTs);
    const missionById = new Map(missions.map(mission => [mission.id, mission]));
    const supplies = inWindow.map(row => {
        const mission = missionById.get(row.missionId);
        return mission ? fleetSupply(row.fleet, mission.use, shipMax) ?? [0, 0] : [0, 0];
    });
    const bases: Partial<Record<PlanKey, number>> = {};
    for (const key of PLAN_KEYS) {
        const net = netOf(key);
        if (net === undefined) continue;
        const spent = key === 'fuel' ? 0 : key === 'ammo' ? 1 : -1;
        bases[key] = net - inWindow.reduce((sum, row, i) => sum + gainOf(row, key) - (spent >= 0 ? supplies[i][spent] : 0), 0) / days;
    }
    return bases;
}

const BASIC_KEYS: readonly PlanKey[] = ['fuel', 'ammo', 'steel', 'bauxite'];

/**
 * 觀測期間裡支出最少的一週：四大資源基本淨增減 ÷ 上限的總和最大者。沒有各週明細時為 null。
 * itemsRecorded：那週的遠征紀錄都有道具標記；否則那週高速修復材等的遠征收入不全，道具類的基本淨增減不準。
 */
export function lightestWeek(
    flow: ObservedFlow | null, records: readonly ExpeditionRow[],
    missions: readonly PlanMission[] = [], shipMax: ShipMaxByName = new Map(),
): { fromTs: number; toTs: number; bases: Partial<Record<PlanKey, number>>; itemsRecorded: boolean } | null {
    let best: { fromTs: number; toTs: number; bases: Partial<Record<PlanKey, number>>; score: number } | null = null;
    for (const block of flow?.blocks ?? []) {
        const bases = basesOver(block.fromTs, block.toTs, key => block.rates[key], records, missions, shipMax);
        if (BASIC_KEYS.some(key => bases[key] === undefined)) continue;
        const score = BASIC_KEYS.reduce((sum, key) => sum + bases[key]! / stockpileCap(key), 0);
        if (!best || score > best.score) best = { fromTs: block.fromTs, toTs: block.toTs, bases, score };
    }
    return best && {
        fromTs: best.fromTs, toTs: best.toTs, bases: best.bases,
        itemsRecorded: records.every(row => row.ts <= best!.fromTs || row.ts > best!.toTs || itemsRecorded(row)),
    };
}

/**
 * 勾選資材的需求：持有、上限、依 basis 的每日基本淨增減，以及觀測期間的實際步調（current，作對照）。
 * @param free 各資材扣掉改造保留後的持有量；不可考為 null。
 */
export function resourceNeeds(
    chosen: readonly PlanKey[], free: Partial<Record<PlanKey, number | null>>, caps: Record<PlanKey, number>,
    flow: ObservedFlow | null, records: readonly ExpeditionRow[],
    missions: readonly PlanMission[] = [], shipMax: ShipMaxByName = new Map(), basis: SpendBasis = 'recent',
): ResourceNeed[] {
    // 捷徑：觀測期間有沒有道具標記的遠征紀錄時，那些紀錄的道具收入沒算到，高速修復材等的基本淨增減會偏高；
    // 觀測期間（最多四週）的紀錄都有標記後就沒有這個偏差。
    const recent = flow ? basesOver(flow.fromTs, flow.toTs, key => flow.rates[key]?.mean, records, missions, shipMax) : {};
    const week = basis === 'lightest' ? lightestWeek(flow, records, missions, shipMax) : null;
    return PLAN_KEYS.filter(key => chosen.includes(key)).map(key => {
        const raw = free[key];
        const have = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
        const current = flow?.rates[key]?.mean;
        if (current === undefined || recent[key] === undefined) return { key, have, cap: caps[key], base: null, current: null };
        // 支出最少的一週有沒有道具標記的紀錄時，那週的道具類基本淨增減不準，沿用整段平均。
        const base = basis === 'none' ? 0
            : week && week.bases[key] !== undefined && !(FLAG_ITEM_KEYS.includes(key) && !week.itemsRecorded) ? week.bases[key]!
            : recent[key]!;
        return { key, have, cap: caps[key], base, current };
    });
}

const DAY_MINUTES = 1440;

/** 一隊一天的淨收入（八種資材；不可考算 0，不計入速度）。 */
type Daily = Record<PlanKey, number>;

const rateWith = (need: ResourceNeed, fleets: readonly Daily[]) =>
    (need.base ?? 0) + fleets.reduce((sum, fleet) => sum + fleet[need.key], 0);

/**
 * 一個組合的評分。有期限時依序比較：
 *   1. fill：各資材推算時點的存量比例（上限算 1），由小到大排，越大越好。
 *   2. days：各資材到上限的天數，由大到小排，越小越好。期限前都會滿的組合在 fill 全部同分，
 *      這一層讓它們比誰最快滿，不會隨便挑到不給該資材的遠征。
 *   3. total：推算時點仍未滿的勾選資材每日淨增減 ÷ 上限的總和，越大越好（前兩層都同分時，多拿的才是好組合；
 *      已滿資材多拿只是溢出，不算）。
 *   4. byproduct：所有八種資材每日淨收入 ÷ 上限的總和，越大越好。勾選資材完全同分時（例如兩條遠征每天給一樣多的鋼），
 *      順便多給沒勾的資材的那組較好，不由窮舉順序決定。
 * 「到上限天數」：已滿但每日淨增減為負的資材會掉出上限，算存不滿（Infinity）；溢出不算好處，維持在上限才算數。
 */
interface ComboScore { fill: number[]; days: number[]; total: number; byproduct: number }

const daysAtCap = (gap: number, rate: number) => (gap <= 0 ? (rate >= 0 ? 0 : Infinity) : rate > 0 ? gap / rate : Infinity);

/** known：持有可考的勾選資材（不可考的不參與比較，呼叫端先篩好）；sum：三隊每日收入的合計。 */
function scoreOf(known: readonly ResourceNeed[], sum: Daily, horizon: number): ComboScore {
    const rates = known.map(need => (need.base ?? 0) + sum[need.key]);
    const days = known.map((need, i) => daysAtCap(need.cap - need.have!, rates[i])).sort((a, b) => b - a);
    return {
        fill: known.map((need, i) => Math.min(1, (need.have! + rates[i] * horizon) / need.cap)).sort((a, b) => a - b),
        days,
        total: known.reduce((sum, need, i) => sum + (need.have! + rates[i] * horizon < need.cap ? rates[i] / need.cap : 0), 0),
        byproduct: PLAN_KEYS.reduce((acc, key) => acc + sum[key] / stockpileCap(key), 0),
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

/** 沒設期限時，推算時點最多推到幾天後（再遠的「存滿」已沒有參考價值）。 */
export const UNTIL_FULL_MAX_DAYS = 365;

/**
 * 組合裡每條遠征主要補哪一項，給畫面一眼看出「這條為什麼在這裡」。
 * 候選：勾選、持有可考、還沒滿、這條有正收入的資材；推算時點仍未滿的優先（會滿的多拿也不改善目標）。
 * 取這條占組合中該資材遠征收入比例最高的一項（「這項主要靠它」）；比例相同（例如都是唯一來源）時取推算比例較低、較缺的一項。
 */
function rolesOf(outlook: readonly ResourceOutlook[], parts: readonly Daily[]): (PlanKey | null)[] {
    const totals = new Map(outlook.map(line => [line.key, parts.reduce((sum, part) => sum + Math.max(0, part[line.key]), 0)]));
    return parts.map(part => {
        const open = outlook.filter(line => line.have !== null && line.have < line.cap && part[line.key] > 0);
        const short = open.filter(line => line.planAt! < line.cap);
        const pool = short.length ? short : open;
        const share = (line: ResourceOutlook) => part[line.key] / totals.get(line.key)!;
        return [...pool].sort((a, b) => share(b) - share(a) || a.planAt! / a.cap - b.planAt! / b.cap)[0]?.key ?? null;
    });
}

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

export interface PlanInput {
    missions: readonly PlanMission[];
    records: readonly ExpeditionRow[];
    /** 玩家（在線時）多久回來收一次遠征（分鐘）。 */
    intervalMinutes: number;
    /** 每天一次較長的離開（分鐘，睡覺、上班）；0 或省略＝沒有，整天都照 intervalMinutes 收。 */
    sleepMinutes?: number;
    needs: readonly ResourceNeed[];
    /** 推算時點距今的天數（備蓄期限，沒設期限時由呼叫端給預設）。 */
    horizonDays: number;
    /** 沒設期限：目標改為全部存滿的天數最短（推算時點改為那個天數，見 planExpeditions 的說明）。 */
    untilFull?: boolean;
    shipMax?: ShipMaxByName;
    /** 現在時刻（判斷月常本期是否已跑過）；省略為 Date.now()。 */
    now?: number;
    /** 最近一次遠征畫面的清單；沒有（從沒收到）為 null 或省略，候選照列。 */
    missionList?: MissionListView | null;
}

/** 一次算完，回傳精確解（測試與不需要分段的呼叫端用）。 */
export function planExpeditions(input: PlanInput): ExpeditionPlan {
    return finish(planExpeditionSteps(input));
}

/** 把分段的計算一次跑完。 */
function finish<T>(steps: Generator<unknown, T>): T {
    for (;;) {
        const step = steps.next();
        if (step.done) return step.value;
    }
}

/**
 * 分段計算，讓畫面不被精確搜尋卡住：第一次 yield 先給近似解的建議（交替搜尋，約零點幾秒），
 * 之後每段 yield undefined，呼叫端可以隨時接著 next()；結束時 return 精確解。沒有作息離開時近似解就是精確解，直接 return。
 */
export function* planExpeditionSteps(input: PlanInput): Generator<ExpeditionPlan | undefined, ExpeditionPlan> {
    const shipMax = input.shipMax ?? new Map();
    const baseHorizon = Math.max(0, input.horizonDays);
    let horizon = baseHorizon;
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
    const now = input.now ?? Date.now();
    const list = input.missionList ?? null;
    // 清單的換期時間還沒到＝本期的清單：本期截止用伺服器給的時間，月常開放與否才可信。
    const listThisCycle = list !== null && list.resetAt !== null && list.resetAt > now;
    const monthlyCycle = listThisCycle
        ? { start: monthlyExpeditionCycle(list.resetAt! - 1).start, end: list.resetAt! }
        : monthlyExpeditionCycle(now);
    const candidates: PlanRow[] = [];
    let lockedCount = 0;
    for (const mission of input.missions) {
        const records = byMission.get(mission.id) ?? [];
        if (mission.resetType === 1) {
            if (!records.length) continue;
            const successes = records.filter(row => row.result >= 1).map(row => row.ts);
            const lastSuccessTs = successes.length ? Math.max(...successes) : null;
            monthly.push({ missionId: mission.id, dispNo: mission.dispNo, name: mission.name, lastSuccessTs,
                doneThisCycle: lastSuccessTs !== null && lastSuccessTs >= monthlyCycle.start && lastSuccessTs < monthlyCycle.end,
                open: listThisCycle ? list!.states.has(mission.id) : null });
            continue;
        }
        if (!(mission.time > 0)) continue;
        const { income, itemRuns, estimated } = incomeOf(mission, records, profile);
        // 沒有任何收益的遠征（支援遠征等）不列入。
        if (!PLAN_KEYS.some(key => (income[key] ?? 0) > 0)) continue;
        // 不在遠征清單的目前不能派。一般遠征開了就不會再鎖，舊的清單也可用。
        if (list && !list.states.has(mission.id)) { lockedCount++; continue; }
        const { supply, estimated: supplyEstimated } = supplyOf(mission, records, profile, shipMax);
        if (income.fuel !== null) income.fuel -= supply[0];
        if (income.ammo !== null) income.ammo -= supply[1];
        const cyclesPerDay = DAY_MINUTES / (interval * Math.ceil(mission.time / interval));
        const perDay = {} as Income;
        for (const key of PLAN_KEYS) perDay[key] = income[key] === null ? null : income[key]! * cyclesPerDay;
        candidates.push({ missionId: mission.id, dispNo: mission.dispNo, name: mission.name, time: mission.time, income, perDay, runs: records.length, itemRuns, estimated, supply, supplyEstimated });
    }
    candidates.sort((a, b) => a.missionId - b.missionId);
    // 月常：本期還能跑的在前，本期未開放的其次，已完成的最後。
    const monthlyRank = (row: MonthlyRow) => (row.doneThisCycle ? 2 : row.open === false ? 1 : 0);
    monthly.sort((a, b) => monthlyRank(a) - monthlyRank(b) || a.missionId - b.missionId);

    // 一隊一天：睡前遠征一天一趟；在線遠征在扣掉睡前遠征佔用後的時間裡照 interval 收。
    // 睡前遠征佔用＝離開時間，比離開時間長時再加上回來後等到下一個收取點的時間。
    // 有作息離開時在線趟數取整數：醒來出發、睡前收回，最後一趟睡前收不回來就不能派（那一隊也派不了睡前遠征）；
    // 沒有作息離開時整天連續收，一天的趟數不必是整數。
    const cycle = (row: PlanRow) => interval * Math.ceil(row.time / interval);
    const occupied = (row: PlanRow) => (row.time <= sleep ? sleep : sleep + interval * Math.ceil((row.time - sleep) / interval));
    const onlineOf = (night: PlanRow | undefined) => DAY_MINUTES - (night ? occupied(night) : sleep);
    const dayRuns = (row: PlanRow, online: number) => (sleep ? Math.floor(online / cycle(row)) : online / cycle(row));
    const zero = () => {
        const daily = {} as Daily;
        for (const key of PLAN_KEYS) daily[key] = 0;
        return daily;
    };
    const fleetDaily = (day: PlanRow | undefined, night: PlanRow | undefined, online = onlineOf(night)): Daily => {
        const daily = zero();
        const runs = day ? dayRuns(day, online) : 0;
        for (const key of PLAN_KEYS) daily[key] = (day ? (day.income[key] ?? 0) * runs : 0) + (night ? night.income[key] ?? 0 : 0);
        return daily;
    };
    // 窮舉時每個組合都要算，只累計三隊合計，不建每隊的物件。
    interface Pick { day: PlanRow[]; night: PlanRow[]; sum: Daily; score: ComboScore }
    const known = input.needs.filter(need => need.have !== null);
    const pickOf = (day: PlanRow[], night: PlanRow[]): Pick => {
        const sum = zero();
        for (let i = 0; i < Math.max(day.length, night.length); i++) {
            const d = day[i], z = night[i];
            const runs = d ? dayRuns(d, onlineOf(z)) : 0;
            for (const key of PLAN_KEYS) sum[key] += (d ? (d.income[key] ?? 0) * runs : 0) + (z ? z.income[key] ?? 0 : 0);
        }
        return { day, night, sum, score: scoreOf(known, sum, horizon) };
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
    // 先剔除被至少五條其他遠征全面勝過的遠征：組合裡用到它時，至少有一條勝過它的不在組合中、也不和別隊衝突
    // （同組另兩條＋另兩隊的另一組最多排除四條），換上去每項都不減，評分只會更好或同分，所以不影響結果，只減少窮舉量。
    // 「全面勝過」：睡前遠征比每趟收入且佔用不更長；在線遠征比每一種可能的在線時數下的收入（趟數取整數後，
    // 每日收入較高的遠征在某些在線時數下反而較少）。
    // 超過一天才回得來的遠征不能每天睡前派，只當在線組合。
    const nightCandidates = sleep ? candidates.filter(row => occupied(row) <= DAY_MINUTES) : [];
    const onlines = sleep ? [...new Set([DAY_MINUTES - sleep, ...nightCandidates.map(row => onlineOf(row))])] : [DAY_MINUTES];
    const dayVector = (row: PlanRow) => onlines.flatMap(online => PLAN_KEYS.map(key => (row.income[key] ?? 0) * dayRuns(row, online)));
    const nightVector = (row: PlanRow) => PLAN_KEYS.map(key => row.income[key] ?? 0);
    const undominated = (rows: PlanRow[], night: boolean) => {
        const vectors = rows.map(night ? nightVector : dayVector);
        return rows.filter((row, i) => rows.filter((other, j) => j !== i
            && (!night || occupied(other) <= occupied(row))
            && vectors[j].every((v, k) => v >= vectors[i][k])
            && (vectors[j].some((v, k) => v > vectors[i][k]) || (night && occupied(other) < occupied(row)) || other.missionId < row.missionId)).length < 5);
    };
    const dayPool = undominated(candidates, false);
    const daySets = [...combinations(dayPool, Math.min(PLAN_FLEETS, dayPool.length))];
    const nightPool = undominated(nightCandidates, true);
    const nightSets = sleep ? [...combinations(nightPool, Math.min(PLAN_FLEETS, nightPool.length))] : [];

    // 近似解：交替固定一組、窮舉另一組；每一步都含目前的組合，分數不會下降，不再變好就停。
    // 從「先挑在線」與「先挑睡前」兩個起點各跑一次，取較好的，減少卡在局部解。
    // 候選很少時可能每個組合都衝突（沒有解），就停在目前的組合。同一個推算時點只算一次（精確搜尋拿它當起點）。
    const approxByHorizon = new Map<number, Pick>();
    const approxSearch = (): Pick => {
        const cached = approxByHorizon.get(horizon);
        if (cached) return cached;
        let result: Pick;
        if (!sleep) result = argmax(daySets.map(day => pickOf(day, [])))!;
        else {
            const withDay = (night: PlanRow[]) => argmax(mapIter(daySets, day => bestPairing(day, night)));
            const withNight = (day: PlanRow[]) => argmax(mapIter(nightSets, night => bestPairing(day, night)));
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
            result = compareScores(fromNight.score, fromDay.score) > 0 ? fromNight : fromDay;
        }
        approxByHorizon.set(horizon, result);
        return result;
    };

    // 精確解：分枝定界。以近似解為目前最好，對每個在線組合算上界（在線那條取各種在線時數裡最有利的趟數，
    // 睡前取各項收入最高的幾條，不必是同一組）；上界的 fill 與到上限天數都比目前最好差就整組跳過，
    // 再對每個睡前組合用同樣的上界（睡前改用該組的實際收入）篩一次。fill 與天數對每項收入都是單調的，
    // 收入只會更少的組合不可能更好，所以跳過不影響結果。後兩層同分規則（total、byproduct）不單調，上界同分時照常比較。
    const nightSize = Math.min(PLAN_FLEETS, nightPool.length);
    const nightTop = PLAN_KEYS.map(key => nightPool.map(row => row.income[key] ?? 0).sort((a, b) => b - a)
        .slice(0, nightSize).reduce((sum, v) => sum + v, 0));
    const nightSums = nightSets.map(set => PLAN_KEYS.map(key => set.reduce((sum, row) => sum + (row.income[key] ?? 0), 0)));
    const dayBest = new Map(dayPool.map(row => [row, PLAN_KEYS.map(key =>
        Math.max(...onlines.map(online => (row.income[key] ?? 0) * dayRuns(row, online))))]));
    const bound = zero();
    const cannotBeat = (best: Pick) => {
        const score = scoreOf(known, bound, horizon);
        return (compareVectors(score.fill, best.score.fill) || compareVectors(score.days, best.score.days, true)) < 0;
    };
    function* exactSearch(): Generator<undefined, Pick> {
        let best = approxSearch();
        if (!sleep) return best;
        for (let i = 0; i < daySets.length; i++) {
            const day = daySets[i];
            const dayHi = PLAN_KEYS.map((_, k) => day.reduce((sum, row) => sum + dayBest.get(row)![k], 0));
            PLAN_KEYS.forEach((key, k) => { bound[key] = dayHi[k] + nightTop[k]; });
            if (cannotBeat(best)) {
                if (i % 256 === 0) yield;
                continue;
            }
            for (let j = 0; j < nightSets.length; j++) {
                PLAN_KEYS.forEach((key, k) => { bound[key] = dayHi[k] + nightSums[j][k]; });
                if (cannotBeat(best)) continue;
                const pick = bestPairing(day, nightSets[j]);
                if (pick && compareScores(pick.score, best.score) > 0) best = pick;
            }
            yield;
        }
        return best;
    }

    // 沒設期限：目標是全部存滿的天數最短。推算時點先放在一年後找：一年內能讓勾選資材全部存滿的組合比例都是 1，
    // 勝過任何有資材存不滿的組合，再由「到上限天數」挑最快的；推算時點收到這組實際存滿的那天。
    // 一年內怎樣都存不滿（消耗大於遠征補得上的量，或已滿卻會掉出上限）時，「最快存滿」沒有意義，回到預設時點照常比較。
    function* decide(search: () => Generator<undefined, Pick>): Generator<undefined, Pick> {
        horizon = baseHorizon;
        if (!input.untilFull) return yield* search();
        horizon = UNTIL_FULL_MAX_DAYS;
        const far = yield* search();
        const slowest = Math.max(0, ...far.score.days);
        if (slowest <= UNTIL_FULL_MAX_DAYS) { horizon = slowest; return far; }
        horizon = baseHorizon;
        return yield* search();
    }

    const build = (best: Pick): ExpeditionPlan => {
        const outlook: ResourceOutlook[] = input.needs.map(need => {
            const planRate = rateWith(need, [best.sum]);
            const expRate = planRate - (need.base ?? 0);
            if (need.have === null) return { key: need.key, have: null, cap: need.cap, nowAt: null, planAt: null, planRate, expRate, planDays: null };
            return {
                key: need.key, have: need.have, cap: need.cap,
                nowAt: need.current === null ? null : need.have + need.current * horizon,
                planAt: need.have + planRate * horizon,
                planRate, expRate,
                planDays: daysToFill(need.cap - need.have, planRate),
            };
        });
        const lowest = outlook.filter(line => line.planAt !== null && line.planAt < line.cap)
            .sort((a, b) => a.planAt! / a.cap - b.planAt! / b.cap)[0];
        const bottleneck = lowest?.key ?? null;
        // 最需要補：不跑遠征時推算時點比例最低的一項（現況加上最近的消耗），不隨組合或收取間隔改變；
        // 只看有候選遠征給得到、還沒滿的資材（例如改修資材給不到，依它排序沒有意義）。同樣低時取持有比例較低的。
        // 用呼叫端給的推算時點（沒設期限時的延後時點取決於組合，會讓結果又隨收取間隔改變）。
        const bare = (need: ResourceNeed) => (need.have! + (need.base ?? 0) * Math.max(0, input.horizonDays)) / need.cap;
        const focus = input.needs.filter(need => need.have !== null && need.have < need.cap
            && candidates.some(row => (row.perDay[need.key] ?? 0) > 0))
            .sort((a, b) => bare(a) - bare(b) || a.have! / a.cap - b.have! / b.cap)[0]?.key ?? null;
        const focusOrder = (a: PlanRow, b: PlanRow) => focus ? (b.perDay[focus] ?? 0) - (a.perDay[focus] ?? 0) || a.time - b.time : 0;
        const byFocus = (rows: PlanRow[]) => (focus ? [...rows].sort(focusOrder) : rows);
        // 在線組合依 focus 排列，睡前組合跟著同一隊移動。
        const fleetOrder = best.day.map((_, i) => i).sort((a, b) => focusOrder(best.day[a], best.day[b]));
        const top = fleetOrder.map(i => best.day[i]);
        const night = best.day.length ? fleetOrder.map(i => best.night[i]).filter(Boolean) : best.night;
        // 每條遠征在組合裡實際貢獻的每日收入：在線那條按該隊的在線時間換算，睡前那條一天一趟。
        const parts = [
            ...top.map((row, i) => fleetDaily(row, undefined, onlineOf(night[i]))),
            ...night.map(row => fleetDaily(undefined, row)),
        ];
        const roles = rolesOf(outlook, parts);
        return {
            top, sleep: night, sleepMinutes: sleep, roles: { top: roles.slice(0, top.length), sleep: roles.slice(top.length) },
            outlook, bottleneck, focus, monthly, monthlyCycle, lockedCount, listKnown: list !== null,
            candidateCount: candidates.length, candidates: byFocus(candidates), profile, horizonDays: horizon,
        };
    };

    const quick = build(finish(decide(function* () { return approxSearch(); })));
    if (!sleep) return quick;
    yield quick;
    return build(yield* decide(exactSearch));
}
