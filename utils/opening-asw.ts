import type { GearView } from './state';

export interface OpeningAswShip {
    masterId: number;
    stypeId: number;
    ctype?: number;
    nameJa?: string;
    asw: number | null;
    gears: (GearView | null)[];
    exGear: GearView | null;
    aswEquipmentKnown?: boolean;
}

export interface OpeningAswContext {
    combined?: boolean;
    fleetNo?: number;
    openingNight?: boolean;
    escaped?: boolean;
}

// Wiki 發動條件表（2026-10-01）：https://wikiwiki.jp/kancolle/対潜攻撃#oasw
// ID 以 samples/start2-master.json 核對；未收錄於樣本的新形態只比對 master 日文原名。
export const OPENING_ASW_EXEMPT_CTYPES = [91];
export const OPENING_ASW_EXEMPT_SHIPS = [
    141, 478, 624, 1040, // 五十鈴改二、龍田改二、夕張改二丁、吹雪改三護(六式)
    394, 893, 906, // J級改：Jervis改、Janus改、Javelin改；未改裝形態不適用
    681, 920, // Samuel B.Roberts改／Mk.II；未改裝形態不適用
    1062, 1067, // Visby／改
];
const FLETCHER_NOT_EXEMPT = [941, 942]; // 未改裝 Heywood L.E.／Richard P.Leary
const AUTOMATIC_CARRIERS = [646, 380, 381, 382, 529, 536, 889]; // 加賀改二護、大鷹型改／改二
const AVIATION_SPECIALS = [626, 916]; // 神州丸改、大和改二重
const KUMANO_MARU = [943, 948]; // 熊野丸／改
const FUSO_YAMASHIRO = [411, 412];
const FUSO_YAMASHIRO_NAMES = ['扶桑改二', '扶桑改二補', '山城改二', '山城改二補'];
const SONAR_TYPES = [14, 40];
const ROTOR_TYPES = [25, 26];
const ROTOR_IDS = [69, 324, 325];
const HELICOPTER_IDS = [326, 327];
const NORMAL_STYPES = [2, 3, 4, 21, 22];

/** 編成能力推算；不預測敵方潛艦是否存在或實際攻擊順序。 */
export function openingAswEligible(ship: OpeningAswShip, context: OpeningAswContext = {}): boolean {
    if (context.escaped || context.openingNight || (context.combined && context.fleetNo !== 2)) return false;
    if (!Number.isInteger(ship.masterId) || ship.masterId <= 0 || ship.stypeId <= 0) return false;
    const gears = [...ship.gears, ship.exGear].filter((g): g is GearView => g !== null);
    const sonar = gears.some(g => SONAR_TYPES.includes(g.type));
    const attackPlane = (g: GearView) => (g.type === 7 || g.type === 8) && g.asw >= 1;
    const rotor = (g: GearView) => ROTOR_TYPES.includes(g.type);
    const asw = ship.asw;
    const atLeast = (n: number) => asw !== null && Number.isFinite(asw) && asw >= n;

    if (OPENING_ASW_EXEMPT_SHIPS.includes(ship.masterId)
        || (OPENING_ASW_EXEMPT_CTYPES.includes(ship.ctype ?? 0) && !FLETCHER_NOT_EXEMPT.includes(ship.masterId))) return true;

    if (ship.aswEquipmentKnown === false) return false;

    // 日向改二只計指定機型的裝備槽數；裝備加成與剩餘機數不改變此條件。
    if (ship.masterId === 554) {
        return gears.some(g => HELICOPTER_IDS.includes(g.mst))
            || gears.filter(g => ROTOR_IDS.includes(g.mst)).length >= 2;
    }
    if (AUTOMATIC_CARRIERS.includes(ship.masterId)) return gears.some(g => rotor(g) || attackPlane(g));

    if (ship.stypeId === 1) {
        return (atLeast(60) && sonar)
            || (atLeast(75) && gears.reduce((sum, g) => sum + g.asw, 0) >= 4);
    }
    if (ship.stypeId === 7) {
        const strongPlane = gears.some(g => rotor(g) || (g.type === 8 && g.asw >= 7));
        return (strongPlane && (atLeast(65) || (atLeast(50) && sonar && ![508, 509].includes(ship.masterId))))
            || (atLeast(100) && sonar && gears.some(attackPlane));
    }
    if (AVIATION_SPECIALS.includes(ship.masterId)) {
        return atLeast(100) && sonar && gears.some(g => g.type === 11 || g.type === 25);
    }
    if (KUMANO_MARU.includes(ship.masterId)) {
        return atLeast(100) && sonar && gears.some(g => rotor(g) || (g.type === 7 && g.asw >= 1));
    }
    if (FUSO_YAMASHIRO.includes(ship.masterId) || FUSO_YAMASHIRO_NAMES.includes(ship.nameJa ?? '')) {
        return atLeast(100) && sonar && gears.some(g => [11, 25, 15].includes(g.type));
    }
    if (!NORMAL_STYPES.includes(ship.stypeId)) return false;
    // 山汐丸改／しまね丸改：只有對潛 0 的航空攻擊機時，聲納與顯示值仍不足以成立。
    if ([717, 1008].includes(ship.masterId)
        && gears.some(g => (g.type === 7 || g.type === 8) && g.asw === 0)
        && !gears.some(g => attackPlane(g) || rotor(g) || (g.type === 11 && g.asw >= 1))) return false;
    return atLeast(100) && sonar;
}
