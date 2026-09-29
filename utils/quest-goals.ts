// 任務進度條件的解讀與比對（純函式，無 chrome.*／DOM，node 可測）。
//
// 條件表 QUEST_GOAL_RAW 由 tools/quest-goal/generate.py 產生。每個任務有一到多個子目標；子目標的
// key 是計數事件（fuzzy 任務為「事件@標籤」），值是篩選條件與 required。語意依來源文件：
//   - 艦娘 id 表示「此改造階段以後」：艦隊中的艦以「自身＋所有改造前身」的 id 集合比對。
//   - escortshipId 的各條目 OR、escortshipIdAll 的各條目 AND；escortshiptype／escortshipclass 各條目 AND。
//     條目為 [ids, 數量, 排除旗艦?]，第三項缺席時旗艦也計入數量。
//   - mapcell 是進入該節點的 edge 編號，maparea 是 area*10+no。
//   - fleetlimit 為艦隊艘數上限；banshiptype 為不可編入的艦種。
//   - missionId 是產生器依 start2 樣本把遠征名稱換成的遠征 id。
// 認不得的篩選欄位不可默默忽略（會讓條件消失而多算），故整個任務標為不支援。
import { QUEST_GOAL_RAW } from './quest-goal-data';
import type { QuestGoal } from './quest-progress';

/** 本專案目前會產生的計數事件：出擊、演習、遠征。工廠與補給入渠類尚未支援。 */
export const SUPPORTED_GOAL_EVENTS = new Set([
    'sally', 'battle', 'battle_win', 'battle_rank_s',
    'battle_boss', 'battle_boss_win', 'battle_boss_win_rank_a', 'battle_boss_win_rank_s',
    'reach_mapcell', 'sinking',
    'practice', 'practice_win', 'practice_win_a', 'practice_win_s',
    'mission_success',
]);

/** 擊沉計數只看這些敵艦種（輕空母、正規空母、潛水艦、補給艦）。 */
export const SINKING_SHIP_TYPES = [7, 11, 13, 15];

export type IdEntry = readonly [readonly number[], number, boolean?];

export interface GoalSubgoal {
    key: string;
    event: string;
    required: number;
    init: number;
    maparea?: readonly number[];
    mapcell?: readonly number[];
    shipType?: readonly number[];
    flagshipId?: readonly number[];
    secondshipId?: readonly number[];
    escortshipId?: readonly IdEntry[];
    escortshipIdAll?: readonly IdEntry[];
    flagshiptype?: readonly number[];
    escortshiptype?: readonly IdEntry[];
    flagshipclass?: readonly number[];
    secondshipclass?: readonly number[];
    escortshipclass?: readonly IdEntry[];
    fleetlimit?: number;
    banshiptype?: readonly number[];
    missionId?: readonly number[];
}

export interface QuestGoalDef {
    no: number;
    /** 1＝子目標計數每日（05:00 JST）歸零，用於「本日中」的單發任務。 */
    resetInterval?: number;
    subgoals: GoalSubgoal[];
    /** 所有子目標的事件與篩選欄位都認得，且事件已支援。 */
    supported: boolean;
}

const FILTER_KEYS = new Set([
    'maparea', 'mapcell', 'shipType', 'flagshipId', 'secondshipId', 'escortshipId', 'escortshipIdAll',
    'flagshiptype', 'escortshiptype', 'flagshipclass', 'secondshipclass', 'escortshipclass',
    'fleetlimit', 'banshiptype', 'missionId',
]);
const QUEST_KEYS = new Set(['type', 'fuzzy', 'resetInterval']);
const SUBGOAL_META = new Set(['required', 'init']);

/** 本機修正：以任務編號整筆覆蓋條件表，格式同 QUEST_GOAL_RAW。 */
export const QUEST_GOAL_OVERRIDES: Readonly<Record<number, Record<string, unknown>>> = {};

function parseDef(no: number, raw: Record<string, unknown>): QuestGoalDef {
    const fuzzy = raw.fuzzy === true;
    let supported = true;
    const subgoals: GoalSubgoal[] = [];
    for (const [key, value] of Object.entries(raw)) {
        if (QUEST_KEYS.has(key)) continue;
        if (!value || typeof value !== 'object') { supported = false; continue; }
        const fields = value as Record<string, unknown>;
        // 非 fuzzy 任務只有與事件同名的 key 會被計數。
        const event = fuzzy ? key.split('@')[0] : key;
        if (!fuzzy && key.includes('@')) supported = false;
        if (!SUPPORTED_GOAL_EVENTS.has(event)) supported = false;
        for (const field of Object.keys(fields)) {
            if (!FILTER_KEYS.has(field) && !SUBGOAL_META.has(field)) supported = false;
        }
        subgoals.push({
            ...(fields as Partial<GoalSubgoal>),
            key, event,
            required: Number(fields.required) || 0,
            init: Number(fields.init) || 0,
        });
    }
    if (!subgoals.length || subgoals.some(sub => sub.required <= 0)) supported = false;
    const resetInterval = typeof raw.resetInterval === 'number' ? raw.resetInterval : undefined;
    return { no, subgoals, supported, ...(resetInterval ? { resetInterval } : {}) };
}

const cache = new Map<number, QuestGoalDef | null>();

export function questGoalDef(no: number): QuestGoalDef | null {
    if (cache.has(no)) return cache.get(no)!;
    const raw = QUEST_GOAL_OVERRIDES[no] ?? QUEST_GOAL_RAW[String(no)];
    const def = raw ? parseDef(no, raw) : null;
    cache.set(no, def);
    return def;
}

// ── 比對 ──────────────────────────────────────────────────────────────

/** 艦隊事實：每艘依編成順序，countsAs＝自身與所有改造前身的 master id。 */
export interface FleetFacts {
    countsAs: readonly (readonly number[])[];
    stype: readonly number[];
    ctype: readonly number[];
}

export type FleetReason = 'flagship' | 'escort' | 'fleetSize' | 'banned';

const countsAsAny = (ids: readonly number[] | undefined, goal: readonly number[]) => (ids ?? []).some(id => goal.includes(id));

function entryCount<T>(values: readonly T[], [goal, , ignoreFlagship]: IdEntry, match: (value: T, goal: readonly number[]) => boolean): number {
    return (ignoreFlagship ? values.slice(1) : values).filter(value => match(value, goal)).length;
}

export function idEntryHolds(entry: IdEntry, fleet: FleetFacts): boolean {
    return entryCount(fleet.countsAs, entry, countsAsAny) >= entry[1];
}

function numberEntryHolds(entry: IdEntry, values: readonly number[]): boolean {
    return entryCount(values, entry, (value, goal) => goal.includes(value)) >= entry[1];
}

/** 編成條件；全部符合回傳 null。 */
export function fleetReason(sub: GoalSubgoal, fleet: FleetFacts): FleetReason | null {
    if (sub.flagshipId && !countsAsAny(fleet.countsAs[0], sub.flagshipId)) return 'flagship';
    if (sub.flagshiptype && !sub.flagshiptype.includes(fleet.stype[0] ?? -1)) return 'flagship';
    if (sub.flagshipclass && !sub.flagshipclass.includes(fleet.ctype[0] ?? -1)) return 'flagship';
    if (sub.secondshipId && !countsAsAny(fleet.countsAs[1], sub.secondshipId)) return 'escort';
    if (sub.secondshipclass && !sub.secondshipclass.includes(fleet.ctype[1] ?? -1)) return 'escort';
    if (sub.escortshipId?.length && !sub.escortshipId.some(entry => idEntryHolds(entry, fleet))) return 'escort';
    if (sub.escortshipIdAll?.some(entry => !idEntryHolds(entry, fleet))) return 'escort';
    if (sub.escortshiptype?.some(entry => !numberEntryHolds(entry, fleet.stype))) return 'escort';
    if (sub.escortshipclass?.some(entry => !numberEntryHolds(entry, fleet.ctype))) return 'escort';
    if (sub.fleetlimit && fleet.countsAs.length > sub.fleetlimit) return 'fleetSize';
    if (sub.banshiptype?.some(type => fleet.stype.includes(type))) return 'banned';
    return null;
}

/** 戰鬥與演習事件要求的最低評價；battle／battle_boss／practice 不看評價。 */
export function eventMinRank(event: string): 'S' | 'A' | 'B' | null {
    if (event === 'battle_rank_s' || event === 'battle_boss_win_rank_s' || event === 'practice_win_s') return 'S';
    if (event === 'battle_boss_win_rank_a' || event === 'practice_win_a') return 'A';
    if (event === 'battle_win' || event === 'battle_boss_win' || event === 'practice_win') return 'B';
    return null;
}

export const isPracticeEvent = (event: string) => event.startsWith('practice');

export const isBattleEvent = (event: string) => event.startsWith('battle');
export const isBossEvent = (event: string) => event.startsWith('battle_boss');

const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'];
export function rankAtLeast(rank: string | undefined, min: 'S' | 'A' | 'B'): boolean {
    const r = RANKS.indexOf(rank ?? '');
    return r >= 0 && r >= RANKS.indexOf(min);
}

export type BattleReason = FleetReason | 'fleetUnknown' | 'notBoss' | 'node' | 'rank' | 'full';
// 同一場戰鬥對多個子目標各自失敗時，回報「走得最遠」的原因（越後面越接近計入）。
const REASON_ORDER: BattleReason[] = ['fleetUnknown', 'banned', 'fleetSize', 'flagship', 'escort', 'notBoss', 'node', 'rank', 'full'];

const FLEET_KEYS: (keyof GoalSubgoal)[] = [
    'flagshipId', 'secondshipId', 'escortshipId', 'escortshipIdAll', 'flagshiptype', 'escortshiptype',
    'flagshipclass', 'secondshipclass', 'escortshipclass', 'fleetlimit', 'banshiptype',
];
export const hasFleetFilter = (sub: GoalSubgoal) => FLEET_KEYS.some(key => sub[key] !== undefined);

/**
 * 演習結算：practice（不論勝敗）、practice_win（B 以上）、_a、_s。演習艦隊不可考時，
 * 帶編成條件的子目標判為 fleetUnknown，不當成符合。
 */
export function judgePracticeGoals(
    def: QuestGoalDef, counts: readonly number[], rank: string | undefined, fleet: FleetFacts | null,
): { counted: number[]; reason: BattleReason | null } | null {
    const counted: number[] = [];
    let best: BattleReason | null = null;
    let relevant = false;
    def.subgoals.forEach((sub, index) => {
        if (!isPracticeEvent(sub.event)) return;
        relevant = true;
        const min = eventMinRank(sub.event);
        const reason: BattleReason | null = (hasFleetFilter(sub) && !fleet ? 'fleetUnknown' : fleet ? fleetReason(sub, fleet) : null)
            ?? (min && !rankAtLeast(rank, min) ? 'rank'
                : (counts[index] ?? 0) >= sub.required ? 'full' : null);
        if (reason === null) counted.push(index);
        else if (best === null || REASON_ORDER.indexOf(reason) > REASON_ORDER.indexOf(best)) best = reason;
    });
    if (!relevant) return null;
    return { counted, reason: counted.length ? null : best };
}

/** 遠征成功：不限遠征或 missionId 含本次遠征的子目標。沒有適用的子目標時回傳 null。 */
export function judgeMissionGoals(
    def: QuestGoalDef, counts: readonly number[], missionId: number | undefined,
): { counted: number[]; reason: BattleReason | null } | null {
    const counted: number[] = [];
    let relevant = false;
    def.subgoals.forEach((sub, index) => {
        if (sub.event !== 'mission_success') return;
        if (sub.missionId && (missionId === undefined || !sub.missionId.includes(missionId))) return;
        relevant = true;
        if ((counts[index] ?? 0) < sub.required) counted.push(index);
    });
    if (!relevant) return null;
    return { counted, reason: counted.length ? null : 'full' };
}

export interface BattleGoalFacts {
    maparea: number;
    mapcell: number;
    boss: boolean;
    rank: string | undefined;
    /** 出擊艦隊不可考（map/start 未保留、戰鬥封包的艦隊與出擊時不同）時為 null：帶編成條件的子目標判為 fleetUnknown。 */
    fleet: FleetFacts | null;
}

/**
 * 一場戰鬥對一個任務的判定：回傳本場計入的子目標索引，以及都未計入時的原因。
 * 沒有任何戰鬥類子目標適用此海域時回傳 null（不記錄）。
 */
export function judgeBattleGoals(
    def: QuestGoalDef, counts: readonly number[], facts: BattleGoalFacts,
): { counted: number[]; reason: BattleReason | null } | null {
    const counted: number[] = [];
    let best: BattleReason | null = null;
    let relevant = false;
    def.subgoals.forEach((sub, index) => {
        if (!isBattleEvent(sub.event)) return;
        if (sub.maparea && !sub.maparea.includes(facts.maparea)) return;
        relevant = true;
        const reason: BattleReason | null = (hasFleetFilter(sub) && !facts.fleet ? 'fleetUnknown' : facts.fleet ? fleetReason(sub, facts.fleet) : null)
            ?? (isBossEvent(sub.event) && !facts.boss ? 'notBoss'
                : sub.mapcell && !sub.mapcell.includes(facts.mapcell) ? 'node'
                    : eventMinRank(sub.event) && !rankAtLeast(facts.rank, eventMinRank(sub.event)!) ? 'rank'
                        : (counts[index] ?? 0) >= sub.required ? 'full' : null);
        if (reason === null) counted.push(index);
        else if (best === null || REASON_ORDER.indexOf(reason) > REASON_ORDER.indexOf(best)) best = reason;
    });
    if (!relevant) return null;
    return { counted, reason: counted.length ? null : best };
}

/** 抵達節點（map/next）：只看 reach_mapcell 子目標，節點相符才回傳。 */
export function judgeReachGoals(
    def: QuestGoalDef, counts: readonly number[], maparea: number, mapcell: number, fleet: FleetFacts | null,
): { counted: number[]; reason: BattleReason | null } | null {
    const counted: number[] = [];
    let best: BattleReason | null = null;
    let relevant = false;
    def.subgoals.forEach((sub, index) => {
        if (sub.event !== 'reach_mapcell') return;
        if (sub.maparea && !sub.maparea.includes(maparea)) return;
        if (sub.mapcell && !sub.mapcell.includes(mapcell)) return;
        relevant = true;
        const reason: BattleReason | null = (hasFleetFilter(sub) && !fleet ? 'fleetUnknown' : fleet ? fleetReason(sub, fleet) : null)
            ?? ((counts[index] ?? 0) >= sub.required ? 'full' : null);
        if (reason === null) counted.push(index);
        else if (best === null || REASON_ORDER.indexOf(reason) > REASON_ORDER.indexOf(best)) best = reason;
    });
    if (!relevant) return null;
    return { counted, reason: counted.length ? null : best };
}

/** 本場擊沉的敵艦種 → 各 sinking 子目標可加的數量。 */
export function sinkingGains(def: QuestGoalDef, sunkTypes: readonly number[]): Map<number, number> {
    const gains = new Map<number, number>();
    def.subgoals.forEach((sub, index) => {
        if (sub.event !== 'sinking') return;
        const n = sunkTypes.filter(type => SINKING_SHIP_TYPES.includes(type) && (!sub.shipType || sub.shipType.includes(type))).length;
        if (n > 0) gains.set(index, n);
    });
    return gains;
}

export function goalTotal(def: QuestGoalDef): number {
    return def.subgoals.reduce((sum, sub) => sum + sub.required, 0);
}

export function goalCount(def: QuestGoalDef, counts: readonly number[]): number {
    return def.subgoals.reduce((sum, sub, index) => sum + Math.min(sub.required, counts[index] ?? 0), 0);
}

/** 遊戲每日 05:00 JST（20:00 UTC）換日；回傳遊戲日序號。 */
export function questDay(ts: number): number {
    return Math.floor((ts - 20 * 3600_000) / 86_400_000);
}

/** 海域清單的顯示：同一海域連號縮成「2-1〜2-5」。 */
export function mapListLabel(mapareas: readonly number[]): string {
    const sorted = [...new Set(mapareas)].sort((a, b) => a - b);
    const parts: string[] = [];
    let start = 0;
    for (let i = 1; i <= sorted.length; i++) {
        const prev = sorted[i - 1], cur = sorted[i];
        if (cur === prev + 1 && Math.floor(cur / 10) === Math.floor(prev / 10)) continue;
        const a = sorted[start], b = prev;
        const code = (n: number) => `${Math.floor(n / 10)}-${n % 10}`;
        parts.push(a === b ? code(a) : b - a === 1 ? `${code(a)}/${code(b)}` : `${code(a)}〜${code(b)}`);
        start = i;
    }
    return parts.join('/');
}

// 條件表收錄、但事件尚未支援的任務：只有「單一子目標、不帶任何篩選」時才沿用舊的動作計數，
// 其餘（演習評價、指定遠征、編成限定……）不推算次數，只顯示伺服器回報。
const SIMPLE_EVENT_KINDS: Record<string, QuestGoal['kind']> = {
    practice: 'practiceAttempt', practice_win: 'practiceWin', mission_success: 'expedition',
    supply: 'supply', repair: 'dock', create_item: 'development', create_ship: 'build',
    remodel_item: 'remodel', remodel_ship: 'modernization', destroy_ship: 'shipScrap',
};

export function simpleGoalFromDef(def: QuestGoalDef): QuestGoal | null {
    if (def.subgoals.length !== 1) return null;
    const [sub] = def.subgoals;
    const filtered = Object.keys(sub).some(key => !['key', 'event', 'required', 'init'].includes(key));
    const kind = SIMPLE_EVENT_KINDS[sub.event];
    return !filtered && kind && !def.resetInterval ? { kind, target: sub.required } : null;
}
