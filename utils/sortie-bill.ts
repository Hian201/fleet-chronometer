// 出擊帳單：一趟出擊留下多少「待付帳」。純函式模組，不依賴 chrome.*、DOM 或 Dexie。
//
// 做法是比較同一批艦在「出擊開始」與「回港」兩個時刻的狀態，而不是累加途中的估算：
// 回港的母港封包已經是遊戲結算後的實數，所以活動特殊燃彈費率等未驗證的估算規則不影響帳單。
//
// 每個數字的性質（介面必須照此標示）：
//   · 修理（燃料、鋼材）：封包事實。api_ship[].api_ndock_item＝[燃料, 鋼材]，是該艦此刻修到滿
//     的花費（samples/slot_to_port.json；KC3Kai src/library/objects/Ship.js 以
//     `[api_ndock_time].concat(api_ndock_item)` 讀取，Kcsapi.js 的 api_req_nyukyo/start 以它扣資源）。
//     取出擊前後之差，帶傷出擊的舊傷不會算到這一趟。
//   · 補給（燃料、彈藥）：未結婚的艦是封包事實（api_fuel／api_bull 的差）。結婚艦（Lv100 以上）
//     的補給花費打 85 折且無條件捨去，而遊戲是對「補給當下的總缺額」取整；一趟的差額各自取整
//     只是近似，標推算。規則出處：KC3Kai Ship.js calcResupplyCost（折扣套在補給量、補給量為 1
//     時不折），clean-room 重寫。
//   · 艦載機補充（鋁土）：api_onslot 的差是封包事實，每架 5 鋁土是遊戲規則（wikiwiki「補給」），
//     不受結婚折扣影響。
//   · 出擊期間的餘額變動：兩筆完整資材餘額之差，封包事實；它是「途中取得的資源 − 基地航空隊
//     出擊消耗 − 噴射機鋼材」的合計，封包無從再拆。呼叫端只有在兩筆餘額之間沒有其他未追蹤的
//     資材進出時才可傳入，否則傳 null（判定規則見檔尾 keepsMaterialsTracked）。
//
// 不含：高速修復材（回港後才決定用不用，依 damagedShipIds 在讀取時歸屬）、基地航空隊的補充
// （回港後才補，db.materialUse 的 airSupply 列在讀取時歸屬）。支援艦隊另算（supportBill），
// 不併入出擊艦隊的數字。

/** 一艘艦在某個時刻的帳單相關狀態。欄位對應 api_ship[] 的原始欄位。 */
export interface BillShip {
    id: number;
    masterId: number;
    lv: number;
    fuel: number;
    bull: number;
    onslot: number[];
    repairFuel: number;
    repairSteel: number;
}

export interface BillShipCost {
    id: number;
    masterId: number;
    fuel: number;
    ammo: number;
    bauxite: number;
    repairFuel: number;
    repairSteel: number;
    /** 這艘的燃料／彈藥含結婚折扣的近似取整。 */
    estimated?: true;
}

/** 四項基本資源，順序同 api_material：燃料、彈藥、鋼材、鋁土。 */
export type Resources4 = [number, number, number, number];

export interface SortieBill {
    ships: BillShipCost[];
    /** 回港後要付的帳：補給＋艦載機補充＋修理。 */
    payable: Resources4;
    /** 出擊期間的餘額變動（正＝增加）；無法確定時為 null。 */
    balanceDelta: Resources4 | null;
    /**
     * 同一段期間另外四項的餘額變動：高速建造材、高速修復材、開發資材、改修資材。
     * 活動海域的強力友軍會用掉高速建造材、終點的資材點會給這幾項，都只會出現在這裡。
     * 不併入 payable 與淨成本（單位不同）；前後兩筆不是完整八項時為 null。
     */
    specialDelta: Resources4 | null;
    planesLost: number;
    /** payable 的燃料／彈藥含結婚艦的近似取整。 */
    estimated: boolean;
    /** 這一趟新增了修理費的艦；之後的高速修復材依此歸屬。 */
    damagedShipIds: number[];
    /** 出擊前在、回港後不在（轟沈）。其未補給的燃彈不會再付，不計入。 */
    lostShipIds: number[];
    /** 這一趟帶出的支援艦隊（出擊開始時正在跑同海域的支援遠征）；沒有就不寫。 */
    support?: SupportBill[];
}

const MARRIED_LV = 100;
const BAUXITE_PER_PLANE = 5;

const nonNegative = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** api_ship[] 的一筆原始物件 → BillShip；缺必要欄位回 null，不補猜。 */
export function billShipFromApi(raw: any): BillShip | null {
    const id = Number(raw?.api_id), masterId = Number(raw?.api_ship_id);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(masterId) || masterId <= 0) return null;
    if (typeof raw.api_fuel !== 'number' || typeof raw.api_bull !== 'number') return null;
    const repair = Array.isArray(raw.api_ndock_item) ? raw.api_ndock_item : [];
    return {
        id, masterId,
        lv: nonNegative(raw.api_lv),
        fuel: raw.api_fuel, bull: raw.api_bull,
        onslot: Array.isArray(raw.api_onslot) ? raw.api_onslot.map(nonNegative) : [],
        repairFuel: nonNegative(repair[0]), repairSteel: nonNegative(repair[1]),
    };
}

// 結婚艦：補給量大於 1 時打 85 折並捨去小數；補給量為 1 時不折。
const supplyCost = (consumed: number, married: boolean) =>
    (married && consumed > 1 ? Math.floor(consumed * 0.85) : consumed);

/**
 * before＝出擊開始當下、參與出擊的艦；after＝回港後同一批艦（可帶其他艦，會被忽略）。
 * after 多出來、before 沒有的艦不計：沒有出擊前的狀態就無從歸屬。
 */
export function sortieBill(
    before: readonly BillShip[],
    after: readonly BillShip[],
    materials?: { before: readonly number[] | null; after: readonly number[] | null },
): SortieBill {
    const afterById = new Map(after.map(ship => [ship.id, ship]));
    const ships: BillShipCost[] = [];
    const damagedShipIds: number[] = [];
    const lostShipIds: number[] = [];
    let planesLost = 0;
    for (const was of before) {
        const now = afterById.get(was.id);
        if (!now) { lostShipIds.push(was.id); continue; }
        const married = now.lv >= MARRIED_LV;
        // 洋上補給會讓途中的燃彈回升，差額不會是負的花費。
        const fuelUsed = Math.max(0, was.fuel - now.fuel);
        const ammoUsed = Math.max(0, was.bull - now.bull);
        const planes = was.onslot.reduce((sum, count, slot) => sum + Math.max(0, count - (now.onslot[slot] ?? 0)), 0);
        const repairFuel = Math.max(0, now.repairFuel - was.repairFuel);
        const repairSteel = Math.max(0, now.repairSteel - was.repairSteel);
        planesLost += planes;
        if (repairFuel > 0 || repairSteel > 0) damagedShipIds.push(was.id);
        ships.push({
            id: was.id, masterId: now.masterId,
            fuel: supplyCost(fuelUsed, married), ammo: supplyCost(ammoUsed, married),
            bauxite: planes * BAUXITE_PER_PLANE, repairFuel, repairSteel,
            ...(married && (fuelUsed > 1 || ammoUsed > 1) ? { estimated: true as const } : {}),
        });
    }
    const payable: Resources4 = [0, 0, 0, 0];
    for (const ship of ships) {
        payable[0] += ship.fuel + ship.repairFuel;
        payable[1] += ship.ammo;
        payable[2] += ship.repairSteel;
        payable[3] += ship.bauxite;
    }
    const m0 = materials?.before, m1 = materials?.after;
    const complete = (m: readonly number[] | null | undefined): m is readonly number[] =>
        Array.isArray(m) && m.length >= 4 && m.slice(0, 4).every(v => typeof v === 'number' && Number.isFinite(v));
    const balanceDelta = complete(m0) && complete(m1)
        ? [m1[0] - m0[0], m1[1] - m0[1], m1[2] - m0[2], m1[3] - m0[3]] as Resources4 : null;
    const eight = (m: readonly number[]) => m.length >= 8 && m.slice(4, 8).every(v => typeof v === 'number' && Number.isFinite(v));
    const specialDelta = balanceDelta && eight(m0!) && eight(m1!)
        ? [m1![4] - m0![4], m1![5] - m0![5], m1![6] - m0![6], m1![7] - m0![7]] as Resources4 : null;
    return {
        ships, payable, balanceDelta, specialDelta, planesLost,
        estimated: ships.some(ship => ship.estimated), damagedShipIds, lostShipIds,
    };
}

/** 一趟的淨成本＝要付的帳 − 出擊期間的餘額變動；餘額變動不可考時只有要付的帳，partial 為 true。 */
export function netCost(bill: Pick<SortieBill, 'payable' | 'balanceDelta'>): { cost: Resources4; partial: boolean } {
    const delta = bill.balanceDelta;
    return {
        cost: bill.payable.map((value, index) => value - (delta?.[index] ?? 0)) as Resources4,
        partial: delta === null,
    };
}

export interface BillRun {
    bill: Pick<SortieBill, 'payable' | 'balanceDelta' | 'estimated'>;
    reachedBoss: boolean;
    /** Boss 戰的結算 rank；沒打到或沒有結算為 null。 */
    bossRank: string | null;
}

export interface BillSummary {
    runs: number;
    bossReaches: number;
    bossS: number;
    total: Resources4;
    perRun: Resources4;
    /** 總成本除以到達 Boss 的次數（含沒到的那幾趟的成本）；次數為 0 時 null。 */
    perBossReach: Resources4 | null;
    /** 總成本除以 Boss S 勝的次數；次數為 0 時 null。 */
    perBossS: Resources4 | null;
    /** 有任何一趟的餘額變動不可考：total 少算了那幾趟途中的進出。 */
    partial: boolean;
    estimated: boolean;
}

const divide = (total: Resources4, by: number): Resources4 | null =>
    (by > 0 ? total.map(value => value / by) as Resources4 : null);

/** 同一張圖多趟出擊的彙總。「每次到 Boss」「每個 S」的分子都是全部出擊的總成本。 */
export function summarizeBills(runs: readonly BillRun[]): BillSummary | null {
    if (!runs.length) return null;
    const total: Resources4 = [0, 0, 0, 0];
    let partial = false;
    for (const run of runs) {
        const net = netCost(run.bill);
        net.cost.forEach((value, index) => { total[index] += value; });
        partial ||= net.partial;
    }
    const bossReaches = runs.filter(run => run.reachedBoss).length;
    const bossS = runs.filter(run => run.reachedBoss && run.bossRank === 'S').length;
    return {
        runs: runs.length, bossReaches, bossS, total,
        perRun: divide(total, runs.length)!,
        perBossReach: divide(total, bossReaches),
        perBossS: divide(total, bossS),
        partial, estimated: runs.some(run => run.bill.estimated),
    };
}

/**
 * 以目前庫存還能再出擊幾趟：取最先耗盡的那種資源。平均成本不為正的資源不設限；
 * 庫存缺任何一項（尚未收到資材封包）或沒有任何設限的資源時回 null，不猜。
 */
export function affordableRuns(perRun: Resources4, stock: readonly (number | null)[]): number | null {
    let runs: number | null = null;
    for (let index = 0; index < 4; index++) {
        if (perRun[index] <= 0) continue;
        const have = stock[index];
        if (typeof have !== 'number' || !Number.isFinite(have)) return null;
        const can = Math.floor(have / perRun[index]);
        runs = runs === null ? can : Math.min(runs, can);
    }
    return runs;
}

// GameState.materials 只在部分封包更新（母港、補給、開發、改修、基地航空隊補充、高速建造／入渠用桶）。
// 出擊開始時的餘額能不能拿來算「出擊期間的餘額變動」，取決於上一筆母港封包之後是否出現過
// 會動到資材、而 state 沒追蹤的封包。這裡用白名單：只列出確定不動四項基本資源（或 state 會用
// 回應的餘額精確更新）的 path，其餘一律視為可能動過——寧可多判成不可考，也不讓錯的差額進帳單。
const TRACKED_PATHS = new Set([
    'api_start2/getData',
    // 編成／裝備換裝不動資材；改造（remodeling）耗彈藥鋼材，不在此列。
    'api_req_kaisou/slotset', 'api_req_kaisou/slotset_ex', 'api_req_kaisou/unsetslot_all',
    'api_req_kaisou/slot_exchange_index', 'api_req_kaisou/slot_deprive', 'api_req_kaisou/lock',
    'api_req_kaisou/powerup', 'api_req_kaisou/marriage', 'api_req_kaisou/open_exslot',
    // 回應帶補給後的資材餘額，state 照此更新。
    'api_req_hokyu/charge',
    // supply 回應帶補充後的燃料、鋁土（state 照此更新）；set_plane 耗鋁土但 state 不追蹤，不在此列。
    'api_req_air_corps/supply', 'api_req_air_corps/set_action', 'api_req_air_corps/change_name',
    // createitem／remodel_slot 回應帶餘額；createship、解體、廢棄不在此列。
    'api_req_kousyou/createitem', 'api_req_kousyou/remodel_slot', 'api_req_kousyou/remodel_slotlist',
    'api_req_kousyou/remodel_slotlist_detail', 'api_req_kousyou/getship', 'api_req_kousyou/createship_speedchange',
    // 入渠途中用桶只動高速修復材（state 已扣）；nyukyo/start 的修理費 state 不追蹤，不在此列。
    'api_req_nyukyo/speedchange',
    // 遠征出發、召回不動資材；遠征結果（result）會加資材，不在此列。
    'api_req_mission/start', 'api_req_mission/return_instruction',
    // 接任務、取消任務不動資材；領獎（clearitemget）不在此列。
    'api_req_quest/start', 'api_req_quest/stop',
    'api_req_map/select_eventmap_rank',
    'api_req_member/itemuse_cond',
]);
const TRACKED_PREFIXES = [
    'api_get_member/',          // 唯讀
    'api_req_hensei/',          // 編成
    'api_req_kaisou/preset_slot_',
    'api_req_practice/',        // 演習不動資材餘額（燃彈缺額在艦上，回港後才補）
];

/** 這個封包之後，state 裡的資材餘額是否仍與遊戲一致（假設之前一致）。 */
export function keepsMaterialsTracked(path: string): boolean {
    return TRACKED_PATHS.has(path) || TRACKED_PREFIXES.some(prefix => path.startsWith(prefix));
}

// ── 支援艦隊 ─────────────────────────────────────────────────────────
// 支援遠征只對派出後同海域的第一趟出擊有效，本隊回港時一起歸還，不會跨趟；不論支援有沒有出動，
// 燃彈都照扣（wikiwiki「支援艦隊」）。所以花費整筆歸給出擊開始時它正在支援的那一趟。
//   · 燃料：最大搭載量的 50%；彈藥：正規空母、輕空母、水上機母艦合計 3 艘以上時 40%，否則 80%
//     （對潛支援比照航空支援；判定仍是 2013 年以前的舊規格，裝甲空母與揚陸艦不算）。消耗量小數
//     無條件進位，與一般遠征的捨去不同。出處 wikiwiki「支援艦隊」各支援種類與「補給」段；
//     KC3Kai src/library/objects/Fleet.js calcSupportExpeditionCost 的燃料 50%／彈藥 40%·80% 一致。
//   · 艦載機：戰鬥封包 api_support_info／api_n_support_info 的 api_support_airatack 帶支援艦隊編號與
//     stage1、stage2 的 api_f_lostcount（samples/61-5-jibun-rengou-node52.json），每架 5 鋁土。
//   · 結婚艦的補給折扣同出擊艦隊，標推算。噴射機的鋼材未計。

/** 支援艦隊一艘艦的計算材料，取自 master（api_mst_ship）。 */
export interface SupportShip {
    masterId: number;
    lv: number;
    stype: number;
    fuelMax: number;
    bullMax: number;
}

export interface SupportBill {
    /** 1 起算的艦隊編號。 */
    deckId: number;
    payable: Resources4;
    planesLost: number;
    estimated: boolean;
}

// 正規空母、輕空母、水上機母艦（api_mst_stype 11／7／16）
const SUPPORT_LIGHT_AMMO_STYPES = new Set([7, 11, 16]);

export function supportBill(deckId: number, ships: readonly SupportShip[], planesLost: number): SupportBill {
    const carriers = ships.filter(ship => SUPPORT_LIGHT_AMMO_STYPES.has(ship.stype)).length;
    const ammoRate = carriers >= 3 ? 0.4 : 0.8;
    const payable: Resources4 = [0, 0, 0, Math.max(0, planesLost) * BAUXITE_PER_PLANE];
    let estimated = false;
    for (const ship of ships) {
        const married = ship.lv >= MARRIED_LV;
        const fuel = Math.ceil(ship.fuelMax * 0.5);
        const ammo = Math.ceil(ship.bullMax * ammoRate);
        payable[0] += supplyCost(fuel, married);
        payable[1] += supplyCost(ammo, married);
        if (married && (fuel > 1 || ammo > 1)) estimated = true;
    }
    return { deckId, payable, planesLost: Math.max(0, planesLost), estimated };
}

/** 一則戰鬥封包裡各支援艦隊被擊落的艦載機數（deckId → 架數）。 */
export function supportPlanesLost(api: any): Map<number, number> {
    const out = new Map<number, number>();
    for (const info of [api?.api_support_info, api?.api_n_support_info]) {
        const air = info?.api_support_airatack;
        const deckId = Number(air?.api_deck_id);
        if (!Number.isSafeInteger(deckId) || deckId <= 0) continue;
        const lost = nonNegative(air?.api_stage1?.api_f_lostcount) + nonNegative(air?.api_stage2?.api_f_lostcount);
        out.set(deckId, (out.get(deckId) ?? 0) + lost);
    }
    return out;
}
