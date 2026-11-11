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
//     資材進出時才可傳入，否則傳 null（判定規則見 docs/completion-plan.md §4.3）。
//
// 不含：高速修復材（回港後才決定用不用，依 damagedShipIds 在讀取時歸屬）、支援艦隊、
// 基地航空隊的補充（各自在自己的封包結算）。

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
