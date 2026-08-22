// 艦娘全覽（詳細清單）的篩選／排序／分頁核心。
//
// 純函式、無 chrome.* 與 DOM，可獨立編譯用 node 餵真實 `ownedShips()` 輸出驗證
// （CLAUDE.md 設計原則 4）。UI 殼在 entrypoints/overview/sections/ships.ts。
//
// ── 與 utils/ship-filter.ts 的分工 ────────────────────────────────────────
// ship-filter 是「鎮守府全船篩選」的**共用**核心（活動作戰板的右欄清單也吃它），
// 只含跨分區都成立的維度：航速／艦種／可裝備／出擊標籤／關鍵字。本檔是艦娘全覽**專屬**的
// 超集，額外處理婚艦・改造・改修・射程・開幕・補強增設・多號機…這些只有收藏視角才問的
// 問題，並負責排序與分頁。共用維度直接委派給 ship-filter，不重寫一份。
//
// ── 驗證狀態（哪些是封包事實、哪些是推算）──────────────────────────────
// 事實（皆已用真實封包／完整 start2 核對）：
//   · 素質八項來自 api_karyoku/raisou/taiku/soukou/taisen/kaihi/sakuteki/lucky 的 [0]
//   · 近代化改修上限＝master 的 (max − 初期)，與 api_kyouka 前四格完全吻合
//   · 改造終點＝api_aftershipid === '0'；補強增設孔＝api_slot_ex 三態 0/-1/>0
//   · 補強增設可裝的特殊類別＝api_mst_equip_exslot_ship（key 是**裝備 master id**）
//   · 出擊標籤＝api_sally_area；航速＝api_soku；射程＝api_leng
// 推算（**遊戲不送這個旗標**，依 wikiwiki.jp/kancolle 機制頁轉寫）：
//   · 先制對潛 isOpeningAsw()。規則會隨遊戲改版變動，例外艦以**艦級 ctype** 表達以降低
//     維護成本，但仍需人工跟進。UI 必須標示為推算值，不可呈現成確定事實。
// 開幕雷擊則是事實：裝備了特殊潜航艇（裝備類別 22）即可，類別 id 由 start2 核對。

import type { OwnedShipView } from './state';
import {
    filterShips,
    type EquipFilter, type ShipFilterState, type SpeedFilter,
} from './ship-filter';
import { NATIONS, nationOf, nationsOf, type Nation } from './ship-nationality';

// ── 裝備類別 id（api_mst_slotitem_equiptype，已用真實 start2 核對名稱）──
export const GEAR_TYPE = {
    secondary: 4,        // 副砲
    torpedoPlane: 8,     // 艦上攻撃機
    divePlane: 7,        // 艦上爆撃機
    seaplaneBomber: 11,  // 水上爆撃機
    smallRadar: 12,      // 小型電探
    largeRadar: 13,      // 大型電探
    sonar: 14,           // ソナー
    depthCharge: 15,     // 爆雷（爆雷投射機も同類別：三式爆雷投射機 id 45 → type[2]=15）
    extraArmor: 16,      // 追加装甲
    boiler: 17,          // 機関部強化（缶・タービン）
    autogyro: 25,        // オートジャイロ
    aswPlane: 26,        // 対潜哨戒機
    midget: 22,          // 特殊潜航艇（甲標的）
    landingCraft: 24,    // 上陸用舟艇（大發系）
    commandFacility: 34, // 司令部施設
    largeSonar: 40,      // 大型ソナー
    largeFlyingBoat: 41, // 大型飛行艇
    seaplaneFighter: 45, // 水上戦闘機
} as const;

/** キラキラ（士氣高昂）門檻。遊戲以 cond ≥ 50 判定，一般上限 49、給糧可到 54。 */
export const SPARKLE_COND = 50;
/** ケッコンカッコカリ（婚艦）門檻。Lv100 以上即為已婚。 */
export const MARRIED_LV = 100;

// ── 先制對潛（推算，見檔頭）────────────────────────────────────────────
/** ソナー系。海防艦の 60 要件・通常艦の 100 要件はどちらもソナー装備が前提。 */
const SONAR_TYPES: number[] = [GEAR_TYPE.sonar, GEAR_TYPE.largeSonar];
/** ソナー以外も含む「対潜装備」。海防艦の対潜 75 要件はこちらで足りる。 */
const ASW_GEAR_TYPES: number[] = [...SONAR_TYPES, GEAR_TYPE.depthCharge];
/** 対潜攻撃可能機（軽空母・護衛空母の 65 要件）。艦攻・艦爆は対潜値を持つものだけ。 */
const ASW_PLANE_TYPES: number[] = [GEAR_TYPE.autogyro, GEAR_TYPE.aswPlane];
const ASW_CAPABLE_PLANE_TYPES: number[] = [GEAR_TYPE.torpedoPlane, GEAR_TYPE.divePlane];

/** 艦種 id（api_mst_stype）。先制對潛的門檻依艦種而異，故需具名。 */
const STYPE = { coastalDefense: 1, lightCarrier: 7 } as const;

/**
 * ソナー不要で先制対潜が成立する例外艦。**艦級（ctype）で表現**——Fletcher級・
 * John C.Butler級は全形態が対象なので、改造形態ごとの master id を並べるより壊れにくい。
 * 単艦のものだけ master id で補う。いずれも真実 start2 で id を確認済み。
 */
export const OASW_EXEMPT_CTYPES: number[] = [91 /* Fletcher級 */, 87 /* John C.Butler級 */];
export const OASW_EXEMPT_SHIPS: number[] = [
    141, // 五十鈴改二
    478, // 龍田改二
    394, // Jervis改
    893, // Janus改
    624, // 夕張改二丁
    717, // 山汐丸改
];

const hasGearType = (ship: OwnedShipView, types: number[]) =>
    ship.gears.some(g => g != null && types.includes(g.type))
    || (ship.exGear != null && types.includes(ship.exGear.type));

/**
 * 先制對潛（推算）。**遊戲不送這個旗標**，以下為 wikiwiki 機制頁的規則轉寫：
 *   1. 海防艦：ソナー装備 かつ 対潜 ≥ 60、または 対潜装備 かつ 対潜 ≥ 75
 *   2. 例外艦（上の ctype／master id）：ソナー不要、対潜 ≥ 100
 *   3. 軽空母・護衛空母：対潜 ≥ 65 かつ 対潜攻撃可能機を装備
 *   4. その他：ソナー装備 かつ 対潜 ≥ 100
 * 対潜値は api_taisen[0]＝**装備込みの表示値**（＝遊戲畫面と同じ数字）を使う。
 */
export function isOpeningAsw(ship: OwnedShipView): boolean {
    const asw = ship.stats.asw;
    if (asw <= 0) return false;   // 対潜 0 の艦（戦艦など）はそもそも対潜攻撃できない
    if (ship.stypeId === STYPE.coastalDefense) {
        return (asw >= 60 && hasGearType(ship, SONAR_TYPES))
            || (asw >= 75 && hasGearType(ship, ASW_GEAR_TYPES));
    }
    if (ship.stypeId === STYPE.lightCarrier) {
        const plane = ship.gears.some(g => g != null
            && (ASW_PLANE_TYPES.includes(g.type)
                || (ASW_CAPABLE_PLANE_TYPES.includes(g.type) && g.asw > 0)));
        return asw >= 65 && plane;
    }
    if (OASW_EXEMPT_CTYPES.includes(ship.ctype) || OASW_EXEMPT_SHIPS.includes(ship.masterId)) {
        return asw >= 100;
    }
    return asw >= 100 && hasGearType(ship, SONAR_TYPES);
}

/** 開幕雷擊。**推算ではなく事実**：特殊潜航艇（類別 22）を装備していれば発動する。 */
export function isOpeningTorpedo(ship: OwnedShipView): boolean {
    return hasGearType(ship, [GEAR_TYPE.midget]);
}

// ── 篩選狀態 ────────────────────────────────────────────────────────────

/** 三態開關。KC3 版面上滿滿的「全部／是／否」一律用這個型別。 */
export type Tri = 'all' | 'yes' | 'no';
/** 改造：已達最終形態／尚有後續改造。master 未載入（remodelDone===null）時兩者皆不符。 */
export type RemodelFilter = 'all' | 'done' | 'pending';
/**
 * 近代化改修：
 *   full    ＝火力・雷装・対空・装甲の四項がすべて上限
 *   partial ＝一項でも未満
 *   special ＝運／耐久／対潜を伸ばしたことがある（女神・改修材などの特殊手段）
 */
export type ModernFilter = 'all' | 'full' | 'partial' | 'special';
/** 開幕：先制對潛／開幕雷擊／両方。 */
export type OpeningFilter = 'all' | 'asw' | 'torpedo' | 'both';
/** 「這艘艦裝得上某類別嗎」的指定裝備篩選（可裝備欄的大發／內火以外的常用類別）。 */
export type NamedEquipFilter =
    'all' | 'commandFacility' | 'seaplaneFighter' | 'seaplaneBomber'
    | 'largeFlyingBoat' | 'extraArmor' | 'midget';
/** 補強增設可放的「特殊」類別（全艦通用的那批不列，見 GameState.exSlotSpecialTypes）。 */
export type ExSlotFilter =
    'all' | 'secondary' | 'radar' | 'depthCharge' | 'landingCraft'
    | 'commandFacility' | 'boiler' | 'any';

const NAMED_EQUIP_TYPE: Record<Exclude<NamedEquipFilter, 'all'>, number> = {
    commandFacility: GEAR_TYPE.commandFacility,
    seaplaneFighter: GEAR_TYPE.seaplaneFighter,
    seaplaneBomber: GEAR_TYPE.seaplaneBomber,
    largeFlyingBoat: GEAR_TYPE.largeFlyingBoat,
    extraArmor: GEAR_TYPE.extraArmor,
    midget: GEAR_TYPE.midget,
};
// 電探是小型／大型兩個類別，故值為陣列（任一命中即可）。
const EX_SLOT_TYPES: Record<Exclude<ExSlotFilter, 'all' | 'any'>, number[]> = {
    secondary: [GEAR_TYPE.secondary],
    radar: [GEAR_TYPE.smallRadar, GEAR_TYPE.largeRadar],
    depthCharge: [GEAR_TYPE.depthCharge],
    landingCraft: [GEAR_TYPE.landingCraft],
    commandFacility: [GEAR_TYPE.commandFacility],
    boiler: [GEAR_TYPE.boiler],
};

export interface RosterFilter {
    search: string;
    stypeIds: number[];
    speed: SpeedFilter;
    /** 射程 api_leng：null＝不限，1 短／2 中／3 長／4 超長。 */
    leng: number | null;
    lvMin: number | null;
    lvMax: number | null;
    married: Tri;
    inFleet: Tri;
    locked: Tri;
    sparkle: Tri;
    exSlotOpen: Tri;
    /** 多號機＝同一**基礎形態**持有兩艘以上（改造形態不同也算同一艘船的重複持有）。 */
    duplicate: Tri;
    remodel: RemodelFilter;
    modern: ModernFilter;
    opening: OpeningFilter;
    equip: EquipFilter;
    namedEquip: NamedEquipFilter;
    exSlot: ExSlotFilter;
    /** 出擊標籤：null＝不限、0＝只看無標籤、>0＝只看該標籤。 */
    sallyArea: number | null;
    /**
     * 國籍（建造國）白名單；空陣列＝不限。**多選**——「英美」「地中海組」這種組合是實際
     * 會問的問題，做成單選會逼使用者篩三次再自己合併。同艦種篩選的形狀。
     */
    nations: Nation[];
}

export const emptyRosterFilter = (): RosterFilter => ({
    search: '', stypeIds: [], speed: 'all', leng: null, lvMin: null, lvMax: null,
    married: 'all', inFleet: 'all', locked: 'all', sparkle: 'all', exSlotOpen: 'all',
    duplicate: 'all', remodel: 'all', modern: 'all', opening: 'all',
    equip: 'all', namedEquip: 'all', exSlot: 'all', sallyArea: null, nations: [],
});

// ── 逐艦的衍生旗標 ──────────────────────────────────────────────────────

/**
 * 清單列＝艦娘 view ＋ 兩個日期 ＋ 算好的衍生旗標。
 * 日期由呼叫端補（date1 來自 ship-debut-data 參照表、date2 來自 db.shipObtained），
 * 本檔不碰資料庫也不碰參照表，維持可獨立編譯。
 */
export interface RosterShip extends OwnedShipView {
    /** date1 官方登場日 'YYYY-MM-DD'；未收錄為 null。 */
    debut: string | null;
    /** date2 打撈上任日的 timestamp；不可考為 null。 */
    obtainedTs: number | null;
    married: boolean;
    sparkle: boolean;
    duplicate: boolean;
    modernFull: boolean;
    modernSpecial: boolean;
    openingAsw: boolean;
    openingTorpedo: boolean;
    /** 夜戰火力＝火力＋雷裝（遊戲夜戰攻擊力的基礎項）。排序欄位之一。 */
    night: number;
    /** 國籍（建造國，由 ctype 查表）。master 未載入時為 null＝不可考，見 nationOf()。 */
    nation: Nation | null;
    /** 國籍篩選標籤；Верный 等因遊戲機制可同時屬於多個篩選國籍。 */
    nations: Nation[];
}

/** 近代化改修四項是否全滿。master 未載入（kyoukaMax 為空）時一律 false——不猜。 */
function isModernFull(ship: OwnedShipView): boolean {
    if (ship.kyoukaMax.length < 4) return false;
    return ship.kyoukaMax.every((max, i) => (ship.kyouka[i] ?? 0) >= max);
}

/** 運／耐久／對潛（api_kyouka[4..6]）是否已有特殊手段提升量。 */
function isModernSpecial(ship: OwnedShipView): boolean {
    return ship.kyouka.slice(4, 7).some(v => (v ?? 0) > 0);
}

export interface RosterAnnotations {
    /** 官方登場日查表（傳入基礎形態 master id）。 */
    debutOf(baseMst: number | null): string | null;
    /** 打撈上任日查表（傳入艦實例 id）。 */
    obtainedOf(shipId: number): number | null;
}

/** 把 ownedShips() 的輸出補成清單列。多號機需要全體脈絡，故一次算完整份名冊。 */
export function annotateRoster(ships: OwnedShipView[], ann: RosterAnnotations): RosterShip[] {
    // 多號機：以**基礎形態**計數，這樣「睦月＋睦月改」也會正確算成同一艘船的兩份。
    // baseMst 未知（master 未載入）時退回本形態 master id，至少不會把全部混成一類。
    const byBase = new Map<number, number>();
    for (const s of ships) {
        const key = s.baseMst ?? s.masterId;
        byBase.set(key, (byBase.get(key) ?? 0) + 1);
    }
    return ships.map(s => ({
        ...s,
        debut: ann.debutOf(s.baseMst),
        obtainedTs: ann.obtainedOf(s.id),
        married: s.lv >= MARRIED_LV,
        sparkle: s.cond >= SPARKLE_COND,
        duplicate: (byBase.get(s.baseMst ?? s.masterId) ?? 0) > 1,
        modernFull: isModernFull(s),
        modernSpecial: isModernSpecial(s),
        openingAsw: isOpeningAsw(s),
        openingTorpedo: isOpeningTorpedo(s),
        night: s.stats.firepower + s.stats.torpedo,
        nation: nationOf(s.ctype),
        nations: nationsOf(s.masterId, s.ctype),
    }));
}

// ── 篩選 ────────────────────────────────────────────────────────────────

const matchTri = (value: boolean, f: Tri) => f === 'all' || (f === 'yes') === value;

function matchModern(ship: RosterShip, f: ModernFilter): boolean {
    if (f === 'all') return true;
    if (f === 'special') return ship.modernSpecial;
    // master 未載入時 modernFull 恆為 false，故「未滿」會把全員收進來——這是刻意的
    // 保守側：寧可多列，也不要因為缺 master 就把艦悄悄藏起來。
    return f === 'full' ? ship.modernFull : !ship.modernFull;
}

function matchOpening(ship: RosterShip, f: OpeningFilter): boolean {
    switch (f) {
        case 'all': return true;
        case 'asw': return ship.openingAsw;
        case 'torpedo': return ship.openingTorpedo;
        case 'both': return ship.openingAsw && ship.openingTorpedo;
    }
}

function matchExSlot(ship: RosterShip, f: ExSlotFilter): boolean {
    if (f === 'all') return true;
    if (f === 'any') return ship.exSlotSpecials.length > 0;
    return EX_SLOT_TYPES[f].some(type => ship.exSlotSpecials.includes(type));
}

/** 篩選（不排序、不分頁）。共用維度委派 ship-filter，本檔只加艦娘全覽專屬的條件。 */
export function filterRoster(ships: RosterShip[], f: RosterFilter): RosterShip[] {
    const shared: ShipFilterState = {
        speed: f.speed, stypeIds: f.stypeIds, equip: f.equip,
        sallyArea: f.sallyArea, search: f.search, nations: f.nations,
    };
    // filterShips 內建排序，但這裡的排序另有一整組欄位，故排序結果直接被下游覆蓋；
    // 傳 'level' 只是取它的預設，沒有語意。
    return filterShips(ships, shared, 'level').filter(s =>
        (f.leng == null || s.leng === f.leng)
        && (f.lvMin == null || s.lv >= f.lvMin)
        && (f.lvMax == null || s.lv <= f.lvMax)
        && matchTri(s.married, f.married)
        && matchTri(s.fleetNo != null, f.inFleet)
        && matchTri(s.locked, f.locked)
        && matchTri(s.sparkle, f.sparkle)
        && matchTri(s.exSlotOpen, f.exSlotOpen)
        && matchTri(s.duplicate, f.duplicate)
        && (f.remodel === 'all' || (f.remodel === 'done') === (s.remodelDone === true))
        && matchModern(s, f.modern)
        && matchOpening(s, f.opening)
        && (f.namedEquip === 'all' || s.equipTypes.includes(NAMED_EQUIP_TYPE[f.namedEquip]))
        && matchExSlot(s, f.exSlot));
    // 國籍是**共用維度**（活動作戰板的右欄清單也要），故已上移到 ship-filter；
    // 共用 ship-filter 的判定，見本檔頭「與 ship-filter 的分工」。
}

// ── 排序 ────────────────────────────────────────────────────────────────

export type RosterSortKey =
    'id' | 'book' | 'name' | 'stype' | 'nation' | 'level' | 'cond' | 'hp'
    | 'firepower' | 'torpedo' | 'aa' | 'armor' | 'asw' | 'evasion' | 'los' | 'luck'
    | 'night' | 'released' | 'joined';
export type SortDir = 'asc' | 'desc';

/** 每個排序欄取一個數值鍵；名稱與艦種另有字串比較路徑（見 sortRoster）。 */
const NUMERIC: Partial<Record<RosterSortKey, (s: RosterShip) => number>> = {
    id: s => s.id,
    level: s => s.lv,
    cond: s => s.cond,
    hp: s => s.hp,
    firepower: s => s.stats.firepower,
    torpedo: s => s.stats.torpedo,
    aa: s => s.stats.aa,
    armor: s => s.stats.armor,
    asw: s => s.stats.asw,
    evasion: s => s.stats.evasion,
    los: s => s.stats.los,
    luck: s => s.stats.luck,
    night: s => s.night,
};

/**
 * 缺值一律排到最後（不論升冪降冪）——「沒有図鑑番号／實裝日不可考／上任日不可考」
 * 是資訊缺席，不是「很小的值」。把它們混進大小比較會讓排序看起來壞掉。
 */
function compareWithMissingLast(a: number | null, b: number | null, dir: SortDir): number {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return dir === 'asc' ? a - b : b - a;
}

/** 排序。不修改輸入陣列；同值一律以艦實例 id 為穩定次序。 */
export function sortRoster(ships: RosterShip[], key: RosterSortKey, dir: SortDir): RosterShip[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...ships].sort((a, b) => {
        let r = 0;
        if (key === 'name') r = sign * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        else if (key === 'stype') r = sign * (a.stypeId - b.stypeId);
        // 國籍依 NATIONS 的顯示順序排，不用字母序（見 ship-nationality.ts）。
        // 不可考者比照缺值排最後。
        else if (key === 'nation') {
            r = compareWithMissingLast(
                a.nation == null ? null : NATIONS.indexOf(a.nation),
                b.nation == null ? null : NATIONS.indexOf(b.nation), dir);
        }
        else if (key === 'book') r = compareWithMissingLast(a.bookNo, b.bookNo, dir);
        // 實裝日是 'YYYY-MM-DD' 字串，字典序即時序，轉數字反而要多一次解析。
        else if (key === 'released') {
            if (a.debut == null || b.debut == null) r = compareWithMissingLast(a.debut == null ? null : 1, b.debut == null ? null : 1, dir);
            else r = sign * a.debut.localeCompare(b.debut);
        } else if (key === 'joined') r = compareWithMissingLast(a.obtainedTs, b.obtainedTs, dir);
        else r = sign * ((NUMERIC[key]?.(a) ?? 0) - (NUMERIC[key]?.(b) ?? 0));
        return r || a.id - b.id;
    });
}

// ── 分頁 ────────────────────────────────────────────────────────────────

/** 每頁筆數。0＝全部（使用者需求的 all）。 */
export type PageSize = 10 | 20 | 50 | 100 | 0;
export const PAGE_SIZES: PageSize[] = [10, 20, 50, 100, 0];

export interface Page<T> {
    rows: T[];
    /** 1-based；資料變少時會被夾回最後一頁，故呼叫端要用回傳值而非自己記的值。 */
    page: number;
    pageCount: number;
    /** 這一頁在全體中的 1-based 起訖（0 筆時為 0）。 */
    from: number;
    to: number;
    total: number;
}

/** 取某一頁。page 超出範圍時夾到有效範圍，不回傳空白頁。 */
export function paginate<T>(rows: T[], size: PageSize, page: number): Page<T> {
    const total = rows.length;
    if (size === 0) return { rows, page: 1, pageCount: 1, from: total ? 1 : 0, to: total, total };
    const pageCount = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(1, page), pageCount);
    const start = (current - 1) * size;
    const slice = rows.slice(start, start + size);
    return {
        rows: slice, page: current, pageCount,
        from: slice.length ? start + 1 : 0, to: start + slice.length, total,
    };
}
