// 任務達成條件的判定（純函式，無 chrome.*／DOM，node 可測）：編成、裝備準備／機種轉換、海域攻略。
//
// 條件表 QUEST_PREP_RAW 由 tools/quest-prep/generate.py 從人工審核資料產生。這類任務的條件是
// 「目前鎮守府的狀態」而非事件計數（裝備準備的廢棄計數另走任務條件表，見 quest-goals.ts），
// 遊戲在任務畫面才判定；本檔只回答「目前狀態是否符合」，符合時介面標「可完成」，要不要領由玩家決定。
// ElectronicObserver Other/Information/kcmemo.md「クライアント側で達成判定がなされる任務」：
// 這類任務條件齊備時 api_state 仍是 2，api_progress_flag 只反映廢棄進度。
//
// 語意：
//   - 艦娘 id 表示「此改造階段以後」，以 countsAs（自身＋所有改造前身）比對，同任務條件表。
//   - 編成任務 fleet 為 'any' 時任一艦隊符合即可（KC3Kai kc3-translations 174／175 備註）。
//   - 裝備任務的艦隊條件看第一艦隊（旗艦即秘書艦）；slots 的 slot 為 1 起算格位，null 為任一格。
//   - hold 只算未裝備（不在艦上、不在基地航空隊）且未鎖定的裝備；★ 為改修值下限，alv 要求熟練度 ≫（7）。
//   - 秘書艦的裝備會被轉換或消耗時須未鎖定（keep 為留在艦上的例外）：鎖定時任務達成但無法領取
//     （KC3Kai kc3-translations 614〜616 備註）。鎖定狀態不可考時當作未鎖定，與遊戲新取得裝備的預設相同。
//   - 道具、資源、家具幣或海域狀態不可考時，該項為 null（不可考），整體不判為「可完成」。
import { QUEST_PREP_RAW } from './quest-prep-data';

export type PrepReq =
    | { k: 'flag'; ships?: number[]; lv?: [number, number | null] }
    | { k: 'second'; ships: number[]; lv?: [number, number | null] }
    | { k: 'ships'; ships: number[]; n: number }
    | { k: 'flagType'; types: number[] }
    | { k: 'types'; types: number[]; n: number }
    | { k: 'flagClass'; classes: number[]; lv?: [number, number | null] }
    | { k: 'classes'; classes: number[]; n: number; lv?: [number, number | null]; exclude?: number[] }
    | { k: 'classesMax'; classes: number[]; n: number }
    | { k: 'size'; min?: number; max?: number }
    | { k: 'ban'; types: number[] }
    | { k: 'fast' };

export interface PrepItem { kind: 'useitem' | 'material' | 'fcoin'; id: number; n: number }

export interface QuestPrepDef {
    kind: 'composition' | 'equipment' | 'map';
    code: string;
    fleet?: number | 'any';
    reqs?: PrepReq[];
    slots?: { slot: number | null; gear: number; star?: number; alv?: boolean; keep?: boolean }[];
    hold?: { gear: number; n: number; star?: number }[];
    res?: [number, number, number, number];
    items?: PrepItem[];
    /** 廢棄條件（任務條件表格式），只在任務條件表未收錄時才有。 */
    scrap?: Record<string, unknown>;
    /** 秘書艦條件要在廢棄當下成立，廢棄才會計入。 */
    gate?: boolean;
    map?: number;
}

export function questPrepDef(no: number): QuestPrepDef | null {
    return (QUEST_PREP_RAW[String(no)] as QuestPrepDef | undefined) ?? null;
}

/** 一個艦隊的事實（依編成順序）。 */
export interface PrepFleet {
    countsAs: readonly (readonly number[])[];
    stype: readonly number[];
    ctype: readonly number[];
    lv: readonly number[];
    /** 航速（api_soku）；10 以上為高速。 */
    soku: readonly number[];
}

export interface PrepGear { mst: number; level: number; alv: number; locked?: boolean }

export interface PrepFacts {
    /** 第 1〜4 艦隊；未開放或空艦隊為空陣列。 */
    fleets: readonly PrepFleet[];
    /** 第一艦隊旗艦的一般裝備格（依格位，空格為 null）。 */
    secretarySlots: readonly (PrepGear | null)[];
    /** 未裝備的裝備（不在艦上、不在基地航空隊）；裝備清單尚未收到時為 null。 */
    freeGears: readonly PrepGear[] | null;
    /** 燃彈鋼鋁＋高速建造材、高速修復材、開發資材、改修資材（api_material 的 id 1〜8 依序）；不可考為 null。 */
    materials: readonly number[] | null;
    useItems: ReadonlyMap<number, number> | null;
    furnitureCoins: number | null;
    /** 海域是否已攻略；不可考為 null。 */
    mapCleared: (mapId: number) => boolean | null;
}

export type PrepCheckKind = PrepReq['k'] | 'slot' | 'hold' | 'resource' | 'item' | 'map';

/** 一項條件對照目前狀態的結果；ok 為 null 表示不可考。 */
export interface PrepCheck {
    kind: PrepCheckKind;
    ok: boolean | null;
    /** 依 kind：艦娘／艦種／艦級／裝備 master id。 */
    ids: number[];
    need: number;
    have: number | null;
    lv?: [number, number | null];
    /** size：艦隊艘數的下限與上限。 */
    min?: number;
    max?: number;
    slot?: number | null;
    star?: number;
    alv?: boolean;
    /** resource：0〜3 為燃彈鋼鋁；item：道具來源。 */
    resource?: number;
    item?: PrepItem;
    /** hold：符合條件但鎖定中的件數；slot：該裝備鎖定中。 */
    locked?: number;
}

export interface PrepResult {
    checks: PrepCheck[];
    /** 全部符合為 true；有不符合為 false；只差不可考的項目為 null。 */
    ready: boolean | null;
    /** 判定所用的艦隊（1 起算）；未指定艦隊時為最接近符合的那一隊。 */
    fleet: number | null;
}

const countsAny = (ids: readonly number[] | undefined, goal: readonly number[]) => (ids ?? []).some(id => goal.includes(id));
const lvOk = (lv: number | undefined, range: [number, number | null] | undefined) =>
    !range || (lv !== undefined && lv >= range[0] && (range[1] === null || lv <= range[1]));

function fleetCheck(req: PrepReq, fleet: PrepFleet): PrepCheck {
    const size = fleet.countsAs.length;
    const indexes = Array.from({ length: size }, (_, index) => index);
    const pick = (match: (index: number) => boolean) => indexes.filter(match).length;
    switch (req.k) {
        case 'flag': {
            const ok = size > 0 && (!req.ships?.length || countsAny(fleet.countsAs[0], req.ships)) && lvOk(fleet.lv[0], req.lv);
            return { kind: req.k, ok, ids: req.ships ?? [], need: 1, have: ok ? 1 : 0, ...(req.lv ? { lv: req.lv } : {}) };
        }
        case 'second': {
            const ok = size > 1 && countsAny(fleet.countsAs[1], req.ships) && lvOk(fleet.lv[1], req.lv);
            return { kind: req.k, ok, ids: req.ships, need: 1, have: ok ? 1 : 0, ...(req.lv ? { lv: req.lv } : {}) };
        }
        case 'ships': {
            const have = pick(index => countsAny(fleet.countsAs[index], req.ships));
            return { kind: req.k, ok: have >= req.n, ids: req.ships, need: req.n, have };
        }
        case 'flagType': {
            const ok = size > 0 && req.types.includes(fleet.stype[0]);
            return { kind: req.k, ok, ids: req.types, need: 1, have: ok ? 1 : 0 };
        }
        case 'types': {
            const have = pick(index => req.types.includes(fleet.stype[index]));
            return { kind: req.k, ok: have >= req.n, ids: req.types, need: req.n, have };
        }
        case 'flagClass': {
            const ok = size > 0 && req.classes.includes(fleet.ctype[0]) && lvOk(fleet.lv[0], req.lv);
            return { kind: req.k, ok, ids: req.classes, need: 1, have: ok ? 1 : 0, ...(req.lv ? { lv: req.lv } : {}) };
        }
        case 'classes': {
            const have = pick(index => req.classes.includes(fleet.ctype[index]) && lvOk(fleet.lv[index], req.lv)
                && !(req.exclude && countsAny(fleet.countsAs[index], req.exclude)));
            return { kind: req.k, ok: have >= req.n, ids: req.classes, need: req.n, have, ...(req.lv ? { lv: req.lv } : {}) };
        }
        case 'classesMax': {
            const have = pick(index => req.classes.includes(fleet.ctype[index]));
            return { kind: req.k, ok: have <= req.n, ids: req.classes, need: req.n, have };
        }
        case 'size': {
            const ok = size >= (req.min ?? 1) && size <= (req.max ?? Infinity);
            return { kind: req.k, ok, ids: [], need: 0, have: size, ...(req.min ? { min: req.min } : {}), ...(req.max ? { max: req.max } : {}) };
        }
        case 'ban': {
            const have = pick(index => req.types.includes(fleet.stype[index]));
            return { kind: req.k, ok: have === 0, ids: req.types, need: 0, have };
        }
        case 'fast': {
            const slow = pick(index => fleet.soku[index] < 10);
            return { kind: req.k, ok: size > 0 && slow === 0, ids: [], need: 0, have: slow };
        }
    }
}

function fleetChecks(reqs: readonly PrepReq[], fleets: readonly PrepFleet[], target: number | 'any'): { checks: PrepCheck[]; fleet: number | null } {
    if (target !== 'any') {
        const fleet = fleets[target - 1];
        return { checks: reqs.map(req => fleetCheck(req, fleet ?? EMPTY_FLEET)), fleet: target };
    }
    // 任一艦隊：取符合項目最多的那一隊（同分取編號小的）。
    let best: { checks: PrepCheck[]; fleet: number | null; score: number } = { checks: reqs.map(req => fleetCheck(req, EMPTY_FLEET)), fleet: null, score: -1 };
    fleets.forEach((fleet, index) => {
        if (!fleet.countsAs.length) return;
        const checks = reqs.map(req => fleetCheck(req, fleet));
        const score = checks.filter(check => check.ok).length;
        if (score > best.score) best = { checks, fleet: index + 1, score };
    });
    return { checks: best.checks, fleet: best.fleet };
}

const EMPTY_FLEET: PrepFleet = { countsAs: [], stype: [], ctype: [], lv: [], soku: [] };

const gearOk = (gear: PrepGear | null | undefined, want: { gear: number; star?: number; alv?: boolean }) =>
    !!gear && gear.mst === want.gear && gear.level >= (want.star ?? 0) && (!want.alv || gear.alv >= 7);
const unlockedOk = (gear: PrepGear | null | undefined, want: { keep?: boolean }) => !!want.keep || !gear?.locked;

function itemHave(item: PrepItem, facts: PrepFacts): number | null {
    if (item.kind === 'fcoin') return facts.furnitureCoins;
    if (item.kind === 'material') return facts.materials ? facts.materials[item.id - 1] ?? null : null;
    return facts.useItems ? facts.useItems.get(item.id) ?? 0 : null;
}

export function checkPrep(def: QuestPrepDef, facts: PrepFacts): PrepResult {
    if (def.kind === 'map') {
        const cleared = def.map === undefined ? null : facts.mapCleared(def.map);
        return { checks: [{ kind: 'map', ok: cleared, ids: def.map === undefined ? [] : [def.map], need: 1, have: cleared === null ? null : cleared ? 1 : 0 }], ready: cleared, fleet: null };
    }
    const { checks, fleet } = fleetChecks(def.reqs ?? [], facts.fleets, def.fleet ?? 1);
    // 指定格位的條件先各自認領格位；任一格的條件不可重複使用同一件裝備（639 要求兩種魚雷各一）。
    const used = new Set<number>();
    for (const want of def.slots ?? []) {
        let index: number;
        if (want.slot !== null) {
            index = gearOk(facts.secretarySlots[want.slot - 1], want) ? want.slot - 1 : -1;
        } else {
            // 同條件的裝備有多件時優先認領未鎖定的那件。
            const free = (i: number, gear: PrepGear | null) => !used.has(i) && gearOk(gear, want);
            index = facts.secretarySlots.findIndex((gear, i) => free(i, gear) && unlockedOk(gear, want));
            if (index < 0) index = facts.secretarySlots.findIndex((gear, i) => free(i, gear));
        }
        if (index >= 0) used.add(index);
        const locked = index >= 0 && !unlockedOk(facts.secretarySlots[index], want);
        const ok = index >= 0 && !locked;
        checks.push({ kind: 'slot', ok, ids: [want.gear], need: 1, have: ok ? 1 : 0, slot: want.slot,
            ...(want.star ? { star: want.star } : {}), ...(want.alv ? { alv: true } : {}), ...(locked ? { locked: 1 } : {}) });
    }
    for (const want of def.hold ?? []) {
        const match = facts.freeGears?.filter(gear => gear.mst === want.gear && gear.level >= (want.star ?? 0)) ?? null;
        const have = match ? match.filter(gear => !gear.locked).length : null;
        const locked = match ? match.length - (have ?? 0) : 0;
        checks.push({ kind: 'hold', ok: have === null ? null : have >= want.n, ids: [want.gear], need: want.n, have,
            ...(want.star ? { star: want.star } : {}), ...(locked ? { locked } : {}) });
    }
    (def.res ?? []).forEach((need, index) => {
        if (!need) return;
        const have = facts.materials ? facts.materials[index] ?? null : null;
        checks.push({ kind: 'resource', ok: have === null ? null : have >= need, ids: [], need, have, resource: index });
    });
    for (const item of def.items ?? []) {
        const have = itemHave(item, facts);
        checks.push({ kind: 'item', ok: have === null ? null : have >= item.n, ids: [item.id], need: item.n, have, item });
    }
    const ready = checks.some(check => check.ok === false) ? false : checks.some(check => check.ok === null) ? null : true;
    return { checks, ready, fleet };
}

/** 廢棄計數的閘門：秘書艦（艦隊條件與裝備格）在廢棄當下是否成立。 */
export function prepGateOpen(def: QuestPrepDef, facts: PrepFacts): boolean {
    if (!def.gate) return true;
    return checkPrep({ kind: def.kind, code: def.code, fleet: def.fleet, reqs: def.reqs, slots: def.slots }, facts).ready === true;
}
