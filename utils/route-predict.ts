// 常規導航 —— 純函式，無 chrome.* 與 DOM。
//
// 規則資料（utils/route-rules-data.ts）逐張圖轉寫自 wikiwiki.jp/kancolle 各海域頁的
// 「ルート分岐法則」表：每個分岐點一串由上而下的規則，第一條成立者決定去向。
// 表裡沒有列的節點，出口只有一條時視為固定，沒有出口是終點，出口不只一條則「不可考」。
//
// 判定是三值邏輯：條件可能「不可考」（例如未選的海域階段、wiki 未列的大發系裝備）。
// 不可考的規則同時保留「成立」與「不成立」兩條分支，不替使用者猜。
import { MAP_SPOTS } from './map-spots';

// ── 艦種群組 ──────────────────────────────────────────────────────
// 對應 wikiwiki ルート分岐「注意すべき艦種表記一覧」。api_stype 與表中分類的對應已用
// samples/start2-master.json 核對：山汐丸 22＝補給艦、大和改二 8＝高速戦艦、
// 大和改二重／伊勢改二 10＝航空戦艦、あきつ丸 17＝揚陸艦。
export const SHIP_GROUPS = {
    /** 戦艦（不含航空戦艦）。 */
    BB: [8, 9, 12],
    /** 高速戦艦（艦種，與速力無關）。 */
    FBB: [8],
    /** (低速)戦艦（艦種，與速力無關）。 */
    SBB: [9, 12],
    BBV: [10],
    /** 戦艦級＝戦艦＋航空戦艦。 */
    BBclass: [8, 9, 10, 12],
    /** 正規空母（含装甲空母）。 */
    CV: [11, 18],
    CVL: [7],
    /** 空母系＝正規空母＋軽空母。 */
    CVclass: [7, 11, 18],
    CA: [5],
    CAV: [6],
    /** 重巡級＝重巡＋航巡。 */
    CAclass: [5, 6],
    CL: [3],
    CLT: [4],
    CT: [21],
    /** 軽巡級＝軽巡＋雷巡＋練巡。 */
    CLclass: [3, 4, 21],
    DD: [2],
    DE: [1],
    /** 潜水艦（含潜水空母）。 */
    SS: [13, 14],
    AS: [20],
    /** 補給艦（含特設護衛空母、特務艦等，皆為 stype 22）。 */
    AO: [15, 22],
    AV: [16],
    LHA: [17],
    AR: [19],
} as const satisfies Record<string, readonly number[]>;
export type ShipGroup = keyof typeof SHIP_GROUPS;

// 指定艦：以 api_ctype（艦型）或 master id 判定。
export const SHIP_SETS = {
    /** あきつ丸（161 あきつ丸、166 あきつ丸改；samples/start2-master.json）。 */
    akitsuMaru: { mst: [161, 166] },
    /** 大鷹型（api_ctype 76：大鷹／大鷹改／大鷹改二／神鷹／雲鷹；春日丸級 75 不含）。 */
    taiyouClass: { ctype: [76] },
    // 以下依艦名（含改・改二等各改造階段，wiki 艦種表記頁「特記しない場合は改・改二も含む」）列出 master id；
    // id 取自 samples/start2-master.json 的艦名前綴比對（僅限 id < 1500 的我方艦）。
    nagatoKai2: { mst: [541] },   // 長門改二（6-4 的「長門改二と陸奥改二のペア」限定，不含長門改）
    mutsuKai2: { mst: [573] },    // 陸奥改二
    yuubari: { mst: [115, 293, 622, 623, 624] },
    shouhou: { mst: [74, 282] },
    shoukaku: { mst: [110, 288, 461, 466] },
    zuikaku: { mst: [111, 112, 462, 467] },
    haguro: { mst: [65, 194, 268] },
    kamikaze: { mst: [471, 476] },
    ashigara: { mst: [64, 193, 267] },
    myoukou: { mst: [62, 265, 319] },
    takao: { mst: [66, 269] },
    akitsushima: { mst: [445, 450] },
    kisaragi: { mst: [2, 255, 435] },
} as const;
export type ShipSet = keyof typeof SHIP_SETS;

// ── 裝備 ──────────────────────────────────────────────────────────
// 大發動艇系：wikiwiki ルート分岐「ルート分岐での大発動艇について」明列「含まれる／含まない」。
// master id 以 samples/start2-master.json 的裝備名核對。兩份清單都沒列的上陸用舟艇／特型内火艇
// （api_type[2] 24／46）是否計入不可考。
const DAIHATSU_COUNTED = new Set([68, 193, 166, 436, 449, 409, 167, 525, 526]);
const DAIHATSU_EXCLUDED = new Set([230, 355, 482, 514, 408, 494, 495]);
const DAIHATSU_TYPES = new Set([24, 46]);
/** ドラム缶(輸送用)。 */
const DRUM = 75;

/** radar＝電探（api_type[2] 12 小型・13 大型）。潛水艦用電探（51）與電探搭載機（艦攻 8）不計。 */
export type GearKind = 'drum' | 'daihatsu' | 'radar';

// ── 艦隊事實 ──────────────────────────────────────────────────────
export interface RouteFleetShip {
    mst: number;
    stype: number;
    ctype: number | null;
    /** api_soku：5 低速、10 高速、15 高速+、20 最速。 */
    soku: number;
    /** 裝備 master id 與 api_type[2]（含補強增設）。 */
    gears: { mst: number; type: number }[];
}

export interface RouteFleet {
    ships: RouteFleetShip[];
    /** 判定式(33)；cn 是分岐點係數。null＝不可考。 */
    los(cn: number): number | null;
}

// ── 規則 DSL ──────────────────────────────────────────────────────
export type Cond =
    /** 指定群組（與指定艦，重複者只計一次）的合計艦數落在 [min, max]。 */
    | { count: readonly ShipGroup[]; sets?: readonly ShipSet[]; min?: number; max?: number }
    /** 指定艦（艦型或 master id）的艦數。 */
    | { set: ShipSet; min?: number; max?: number }
    /** 艦隊艦數。 */
    | { ships: { min?: number; max?: number } }
    /** 全員都屬於這些群組。 */
    | { only: readonly ShipGroup[] }
    /** 旗艦屬於這些群組。 */
    | { flagship: readonly ShipGroup[] }
    /**
     * 艦隊速力（最慢艦）。`atLeast`＝「X以上統一」；`exact`＝「X統一」。
     * 低速艦を含む＝{ not: { speed: 'fast', mode: 'atLeast' } }。
     */
    | { speed: 'fastest' | 'fastPlus' | 'fast'; mode: 'atLeast' | 'exact' }
    /** 判定式(33) 分岐點係數 cn 下的索敵值 ≥ min（及／或 < below）。 */
    | { los: { cn: number; min?: number; below?: number } }
    /** wiki 只寫「索敵不足」、沒有門檻：一律不可考。 */
    | { losUnknown: true }
    /** 搭載指定裝備的艦數。 */
    | { carriers: GearKind; min?: number; max?: number }
    /** 各裝備的搭載艦數相加（一艘同時搭載兩種算兩艦，例：5-4 的「ドラム缶搭載艦と大発搭載艦の合計」）。 */
    | { carriersSum: readonly GearKind[]; min?: number; max?: number }
    /** 本次出擊已經過的節點。 */
    | { visited: string }
    /** 海域階段（由使用者選擇；未選＝不可考）。 */
    | { phase: string }
    | { all: readonly Cond[] }
    | { any: readonly Cond[] }
    | { not: Cond };

export type Outcome =
    | { go: string }
    /** 隨機；bias＝wiki 標示的偏向（[節點, 約略比例 %]；只寫「〜寄り」沒給比例時比例為 null），沒寫就不給。 */
    | { random: readonly string[]; bias?: readonly [string, number | null] }
    /** 能動分岐：由玩家選擇。 */
    | { choice: readonly string[] }
    /** wiki 只寫條件類型、沒寫門檻（例如只寫「索敵」）。 */
    | { unknown: readonly string[] }
    /** 巢狀規則（「〜のとき」）。 */
    | { then: readonly Rule[] };

export type Rule = Outcome & {
    /** 省略＝「それ以外」。 */
    if?: Cond;
    /** wiki 標「?」的推定值或推定規則。 */
    tentative?: boolean;
};

/**
 * 海域階段（量表、機關）。階段只能由使用者選：`api_gauge_num` 依專案規則只當血條身分鍵、
 * 不解讀語意，故不從封包推斷目前在哪個階段。
 */
export interface MapStage {
    id: string;
    /** 三語文案 key（ui-i18n 的 route.stage.*）。 */
    labelKey: string;
    /** 此階段的目標點（王點或終點）。 */
    goal: readonly string[];
    /** 規則裡 { phase } 條件的真假。 */
    flags: Readonly<Record<string, boolean>>;
}

export interface MapRules {
    /** wikiwiki「ルート分岐法則更新日」（年/月/日）；頁面沒寫為 null。 */
    updated: string | null;
    /** 本專案最後核對頁面的日期（年/月/日）。 */
    checked: string;
    /** 目標點（王點；沒有王的海域是終點）。有 stages 時以階段為準。 */
    goal: readonly string[];
    /** wiki 敵編成表標「ボス」的節點（畫赤鬼）。省略＝與 goal 相同；終點不是王的海域寫空陣列。 */
    boss?: readonly string[];
    stages?: readonly MapStage[];
    /** 分岐點規則；鍵是節點名，'' 是出擊（多出擊點時選出擊點或第一個節點）。 */
    nodes: Readonly<Record<string, readonly Rule[]>>;
}

// ── 三值邏輯 ──────────────────────────────────────────────────────
export type RouteTri = true | false | null;

const and3 = (vs: RouteTri[]): RouteTri => vs.includes(false) ? false : vs.includes(null) ? null : true;
const or3 = (vs: RouteTri[]): RouteTri => vs.includes(true) ? true : vs.includes(null) ? null : false;
const not3 = (v: RouteTri): RouteTri => v === null ? null : !v;

const SPEED_LEVEL = { fast: 10, fastPlus: 15, fastest: 20 } as const;

function inGroups(stype: number, groups: readonly ShipGroup[]): boolean {
    return groups.some((g) => (SHIP_GROUPS[g] as readonly number[]).includes(stype));
}

function inRange(n: number, min?: number, max?: number): boolean {
    return (min === undefined || n >= min) && (max === undefined || n <= max);
}

function inSet(ship: RouteFleetShip, set: ShipSet): boolean {
    const def = SHIP_SETS[set] as { mst?: readonly number[]; ctype?: readonly number[] };
    return (def.mst?.includes(ship.mst) ?? false) || (ship.ctype !== null && (def.ctype?.includes(ship.ctype) ?? false));
}

/** 該艦是否搭載指定裝備；null＝有 wiki 未列的同類裝備，不可考。 */
function carries(ship: RouteFleetShip, kind: GearKind): RouteTri {
    if (kind === 'drum') return ship.gears.some((g) => g.mst === DRUM);
    if (kind === 'radar') return ship.gears.some((g) => g.type === 12 || g.type === 13);
    if (ship.gears.some((g) => DAIHATSU_COUNTED.has(g.mst))) return true;
    if (ship.gears.some((g) => DAIHATSU_TYPES.has(g.type) && !DAIHATSU_EXCLUDED.has(g.mst))) return null;
    return false;
}

export interface EvalContext {
    fleet: RouteFleet;
    visited: ReadonlySet<string>;
    /** 使用者選的階段；不在 map 裡＝未選。 */
    phases: Readonly<Record<string, boolean>>;
}

export function evalCond(c: Cond, ctx: EvalContext): RouteTri {
    const ships = ctx.fleet.ships;
    if ('count' in c) {
        const n = ships.filter((s) => inGroups(s.stype, c.count) || (c.sets ?? []).some((set) => inSet(s, set))).length;
        return inRange(n, c.min, c.max);
    }
    if ('set' in c) return inRange(ships.filter((s) => inSet(s, c.set)).length, c.min, c.max);
    if ('ships' in c) return inRange(ships.length, c.ships.min, c.ships.max);
    if ('only' in c) return ships.length > 0 && ships.every((s) => inGroups(s.stype, c.only));
    if ('flagship' in c) return ships.length > 0 && inGroups(ships[0].stype, c.flagship);
    if ('speed' in c) {
        // 航速缺值（0）不可當成低速
        if (ships.length === 0 || ships.some((s) => s.soku <= 0)) return null;
        const min = Math.min(...ships.map((s) => s.soku));
        return c.mode === 'atLeast' ? min >= SPEED_LEVEL[c.speed] : min === SPEED_LEVEL[c.speed];
    }
    if ('los' in c) {
        const v = ctx.fleet.los(c.los.cn);
        if (v === null) return null;
        return (c.los.min === undefined || v >= c.los.min) && (c.los.below === undefined || v < c.los.below);
    }
    if ('carriers' in c || 'carriersSum' in c) {
        const kinds = 'carriers' in c ? [c.carriers] : c.carriersSum;
        const flags = kinds.flatMap((k) => ships.map((s) => carries(s, k)));
        const sure = flags.filter((f) => f === true).length;
        const maybe = flags.filter((f) => f === null).length;
        const low = inRange(sure, c.min, c.max);
        if (maybe === 0) return low;
        // 不可考的艦全計／全不計兩端都一樣才有定論
        return low === inRange(sure + maybe, c.min, c.max) ? low : null;
    }
    if ('losUnknown' in c) return null;
    if ('visited' in c) return ctx.visited.has(c.visited);
    if ('phase' in c) return c.phase in ctx.phases ? ctx.phases[c.phase] : null;
    if ('all' in c) return and3(c.all.map((x) => evalCond(x, ctx)));
    if ('any' in c) return or3(c.any.map((x) => evalCond(x, ctx)));
    return not3(evalCond(c.not, ctx));
}

// ── 航路展開 ──────────────────────────────────────────────────────
export type StepKind = 'fixed' | 'random' | 'choice' | 'unknown' | 'uncertain';

export interface RouteStep {
    from: string;
    to: string;
    kind: StepKind;
    /** 命中的規則位置（巢狀時逐層索引）；沒有規則表的固定出口為 null。 */
    rule: number[] | null;
    tentative: boolean;
}

export interface RoutePath {
    steps: RouteStep[];
    /** 最後停在哪裡。 */
    end: string;
    reachesGoal: boolean;
}

interface Pick {
    targets: string[];
    kind: StepKind;
    rule: number[];
    tentative: boolean;
}

/**
 * 依序判定規則，回傳所有可能的去向（不可考時會多於一個）。definite＝已有一條確定成立的規則；
 * 巢狀規則內沒有確定命中時，外層要繼續往下判定。
 */
function pickRules(rules: readonly Rule[], ctx: EvalContext, prefix: number[] = []): { picks: Pick[]; definite: boolean } {
    const out: Pick[] = [];
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const v: RouteTri = r.if ? evalCond(r.if, ctx) : true;
        if (v === false) continue;
        const pos = [...prefix, i];
        const inner = 'then' in r ? pickRules(r.then, ctx, pos) : { picks: [toPick(r, pos)], definite: true };
        const definite = v === true && inner.definite;
        for (const p of inner.picks) out.push(definite ? p : { ...p, kind: 'uncertain' });
        if (definite) return { picks: out, definite: true };
    }
    return { picks: out, definite: false };
}

function toPick(r: Rule, pos: number[]): Pick {
    const tentative = r.tentative ?? false;
    if ('go' in r) return { targets: [r.go], kind: 'fixed', rule: pos, tentative };
    if ('random' in r) return { targets: [...r.random], kind: 'random', rule: pos, tentative };
    if ('choice' in r) return { targets: [...r.choice], kind: 'choice', rule: pos, tentative };
    if ('unknown' in r) return { targets: [...r.unknown], kind: 'unknown', rule: pos, tentative };
    return { targets: [], kind: 'unknown', rule: pos, tentative };
}

/** 節點的出口（依 route 表，去重）。 */
export function exitsOf(map: string, node: string): string[] {
    const spots = MAP_SPOTS[map];
    if (!spots) return [];
    const out: string[] = [];
    for (const [src, dst] of Object.values(spots.routes)) {
        if (src === node && dst !== node && !out.includes(dst)) out.push(dst);
    }
    return out;
}

/** 出擊時的第一步：多出擊點時，目標可以是出擊點本身或出擊點後的節點。 */
function startOf(map: string, target: string): string | null {
    const spots = MAP_SPOTS[map];
    if (!spots) return null;
    if (spots.starts.includes(target)) return target;
    for (const [src, dst] of Object.values(spots.routes)) {
        if (dst === target && spots.starts.includes(src)) return src;
    }
    return null;
}

const MAX_DEPTH = 40;
const MAX_PATHS = 256;

/**
 * 展開所有可能的航路。隨機、能動分岐與不可考都會分岔；同一條路線不重複經過同一節點。
 * 超過 MAX_PATHS 時截斷（回傳的 truncated 為 true）。
 */
export function predictRoutes(
    map: string,
    rules: MapRules | undefined,
    fleet: RouteFleet,
    stageId: string | null = null,
): { paths: RoutePath[]; truncated: boolean } {
    const spots = MAP_SPOTS[map];
    const paths: RoutePath[] = [];
    let truncated = false;
    if (!spots) return { paths, truncated };
    const stage = rules?.stages?.find((x) => x.id === stageId) ?? null;
    // 未選階段：旗標全不可考，目標取所有階段的聯集
    const phases = stage?.flags ?? {};
    const goal = new Set(goalsOf(rules, stage));

    const walk = (node: string, steps: RouteStep[], visited: Set<string>) => {
        if (paths.length >= MAX_PATHS) { truncated = true; return; }
        const exits = exitsOf(map, node);
        const finish = () => paths.push({ steps, end: node, reachesGoal: goal.has(node) });
        if (goal.has(node) || exits.length === 0 || steps.length >= MAX_DEPTH) { finish(); return; }
        const nodeRules = rules?.nodes[node];
        let picks: Pick[];
        if (nodeRules) {
            picks = pickRules(nodeRules, { fleet, visited, phases }).picks;
        } else if (exits.length === 1) {
            picks = [{ targets: exits, kind: 'fixed', rule: [], tentative: false }];
        } else {
            picks = [{ targets: exits, kind: 'unknown', rule: [], tentative: false }];
        }
        for (const p of picks) {
            for (const to of p.targets) {
                if (visited.has(to)) continue;
                const step: RouteStep = {
                    from: node, to, kind: p.kind,
                    rule: nodeRules ? p.rule : null, tentative: p.tentative,
                };
                walk(to, [...steps, step], new Set([...visited, to]));
            }
        }
        if (picks.length === 0) finish();
    };

    // 出擊
    const sortie = rules?.nodes[''];
    if (sortie) {
        for (const p of pickRules(sortie, { fleet, visited: new Set(), phases }).picks) {
            for (const target of p.targets) {
                const start = startOf(map, target);
                if (!start) continue;
                const steps: RouteStep[] = [];
                if (start !== target) {
                    steps.push({ from: start, to: target, kind: p.kind, rule: p.rule, tentative: p.tentative });
                }
                const head = start === target ? [{ from: '', to: start, kind: p.kind, rule: p.rule, tentative: p.tentative }] : [];
                walk(target, [...head, ...steps], new Set([start, target]));
            }
        }
    } else {
        for (const start of spots.starts) walk(start, [], new Set([start]));
    }
    return { paths, truncated };
}

export function goalsOf(rules: MapRules | undefined, stage: MapStage | null): string[] {
    if (!rules) return [];
    if (stage) return [...stage.goal];
    if (rules.stages) return [...new Set(rules.stages.flatMap((x) => x.goal))];
    return [...rules.goal];
}

/** 彙總：所有可能航路都到目標＝固定；部分＝可能；都沒有＝不會。 */
export function goalVerdict(paths: readonly RoutePath[]): 'fixed' | 'possible' | 'never' {
    if (paths.length === 0) return 'never';
    const hits = paths.filter((p) => p.reachesGoal).length;
    return hits === paths.length ? 'fixed' : hits > 0 ? 'possible' : 'never';
}
