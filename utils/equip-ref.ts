// 配裝參考：指定在案艦之後，列出她裝得上、且有藍字加成或社群主砲適性（fit）的裝備。
//
// 加成表是 KC3Kai replay 的 mst_slotitem_bonus.json（對應 wikiwiki 裝備ボーナス）；
// 適性表轉寫自 wikiwiki「命中と回避」#BBfit。兩者都不是封包驗證，UI 必須明講。
// 純函式，無 chrome.*／DOM。
import type { Nation } from './ship-nationality';
import BONUS_TABLE from './equip-bonus-table.json';

export type BonusStatKey =
    | 'houg' | 'raig' | 'tyku' | 'tais' | 'saku' | 'houm' | 'kaih' | 'souk' | 'baku' | 'leng';

export const BONUS_STAT_KEYS: BonusStatKey[] = [
    'houg', 'raig', 'tyku', 'tais', 'saku', 'houm', 'kaih', 'souk', 'baku', 'leng',
];

export type BonusValue = Partial<Record<BonusStatKey, number>>;

export interface BonusLine {
    bonus: BonusValue;
    shipId?: number[];
    shipBase?: number[];
    shipClass?: number[];
    shipType?: number[];
    shipCountry?: string[];
    num?: number;
    level?: number;
    requiresId?: number[];
    requiresIdLevel?: number;
    requiresIdNum?: number;
    requiresType?: number[];
    requiresAR?: number;
    requiresSR?: number;
    requiresAccR?: number;
    requiresEquipList?: unknown;
}

export interface BonusEntry {
    ids?: number[];
    types?: number[];
    bonuses: BonusLine[];
}

export type BbGroup = 'bc' | 'bbA' | 'bbB' | 'bbvA' | 'bbvB';

export interface FitRule {
    gearIds: number[];
    day: number;
    unverified?: boolean;
    note: string;
    match: {
        bbGroup?: BbGroup;
        ctypes?: number[];
        ids?: number[];
        excludeIds?: number[];
        excludeCtypes?: number[];
        stypes?: number[];
    };
}

export interface EquipRefShip {
    masterId: number;
    baseId: number;
    stype: number;
    ctype: number;
    country: string;
    equipCats: number[];
    bbGroup: BbGroup | null;
}

export interface EquipRefGear {
    id: number;
    cat: number;
    sortNo: number;
    leng: number;
    icon: number;
}

export interface FitHit {
    day: number;
    unverified: boolean;
    note: string;
}

export interface EquipRefRow {
    id: number;
    lines: BonusLine[];
    fit: FitHit | null;
}

export interface EquipRefMarks {
    hasBonus: boolean;
    hasFit: boolean;
    hasOver: boolean;
    n: number;
}

export const MAIN_GUN_CATS = new Set([1, 2, 3, 38]);
export const isMainGunCat = (cat: number) => MAIN_GUN_CATS.has(cat);

export const EQUIP_BONUS_TABLE = BONUS_TABLE as BonusEntry[];

const NATION_TO_COUNTRY: Record<Nation, string> = {
    jp: 'JP', us: 'US', gb: 'GB', de: 'DE', it: 'IT', fr: 'FR',
    su: 'RU', au: 'AU', se: 'SE', nl: 'NL', no: 'NO', th: 'TH',
};

export function nationToBonusCountry(nation: Nation | null | undefined): string {
    return NATION_TO_COUNTRY[nation ?? 'jp'] ?? 'JP';
}

/** 適性表戰艦分群。taik0 必須是 master api_taik[0]，不能用實例 maxhp。 */
export function bbGroupOf(ship: { masterId: number; stype: number; taik0: number }): BbGroup | null {
    if (ship.masterId === 916) return 'bbvB';
    if (ship.stype === 10) return 'bbvA';
    if (ship.stype === 8) return 'bc';
    if (ship.stype === 9) return ship.taik0 >= 93 ? 'bbB' : 'bbA';
    return null;
}

function has(arr: number[] | string[] | undefined, v: number | string): boolean {
    return !!arr && arr.includes(v as never);
}

export function bonusLineMatches(line: BonusLine, ship: EquipRefShip): boolean {
    const checks: boolean[] = [];
    if (line.shipId) checks.push(has(line.shipId, ship.masterId));
    if (line.shipBase) checks.push(has(line.shipBase, ship.baseId));
    if (line.shipClass) checks.push(has(line.shipClass, ship.ctype));
    if (line.shipType) checks.push(has(line.shipType, ship.stype));
    if (line.shipCountry) checks.push(has(line.shipCountry, ship.country));
    return checks.length > 0 && checks.every(Boolean);
}

function gearIdsOf(entry: BonusEntry, gearsByCat: Map<number, number[]>, known: Set<number>): number[] {
    if (entry.ids?.length) return entry.ids.filter(id => known.has(id));
    const out: number[] = [];
    for (const cat of entry.types ?? []) out.push(...(gearsByCat.get(cat) ?? []));
    return out;
}

function fitMatches(rule: FitRule, ship: EquipRefShip): boolean {
    const m = rule.match;
    if (m.bbGroup && ship.bbGroup !== m.bbGroup) return false;
    if (m.stypes && !m.stypes.includes(ship.stype)) return false;
    if (m.ctypes && !m.ctypes.includes(ship.ctype)) return false;
    if (m.ids && !m.ids.includes(ship.masterId)) return false;
    if (m.excludeIds?.includes(ship.masterId)) return false;
    if (m.excludeCtypes?.includes(ship.ctype)) return false;
    return true;
}

function indexGears(gears: EquipRefGear[]) {
    const byCat = new Map<number, number[]>();
    const catOf = new Map<number, number>();
    const known = new Set<number>();
    for (const g of gears) {
        known.add(g.id);
        catOf.set(g.id, g.cat);
        const list = byCat.get(g.cat);
        if (list) list.push(g.id); else byCat.set(g.cat, [g.id]);
    }
    return { byCat, catOf, known };
}

export function collectEquipRef(
    ship: EquipRefShip,
    gears: EquipRefGear[],
    bonus: BonusEntry[],
    fitRules: FitRule[],
): EquipRefRow[] {
    const { byCat, catOf, known } = indexGears(gears);
    const cats = new Set(ship.equipCats);
    const byGear = new Map<number, EquipRefRow>();
    const take = (id: number) => {
        const cat = catOf.get(id);
        if (cat == null || !cats.has(cat) || !known.has(id)) return null;
        let row = byGear.get(id);
        if (!row) {
            row = { id, lines: [], fit: null };
            byGear.set(id, row);
        }
        return row;
    };

    for (const entry of bonus) {
        const ids = gearIdsOf(entry, byCat, known);
        for (const line of entry.bonuses) {
            if (!bonusLineMatches(line, ship)) continue;
            for (const id of ids) take(id)?.lines.push(line);
        }
    }
    for (const rule of fitRules) {
        if (!fitMatches(rule, ship)) continue;
        for (const id of rule.gearIds) {
            const row = take(id);
            if (!row) continue;
            if (!row.fit) row.fit = { day: rule.day, unverified: !!rule.unverified, note: rule.note };
            else {
                row.fit.day += rule.day;
                if (rule.unverified) row.fit.unverified = true;
            }
        }
    }
    return [...byGear.values()];
}

export function shipEquipRefMarks(
    ship: EquipRefShip,
    gears: EquipRefGear[],
    bonus: BonusEntry[],
    fitRules: FitRule[],
): EquipRefMarks {
    return markEquipRefShips([ship], gears, bonus, fitRules)[0];
}

/** 一次建索引後標完所有艦，避免每艘重掃加成表。 */
export function markEquipRefShips(
    ships: EquipRefShip[],
    gears: EquipRefGear[],
    bonus: BonusEntry[],
    fitRules: FitRule[],
): EquipRefMarks[] {
    const { byCat, catOf, known } = indexGears(gears);
    const catSets = ships.map(s => new Set(s.equipCats));
    const idSets = ships.map(() => new Set<number>());
    const hasBonus = ships.map(() => false);
    const fitDays = ships.map(() => new Map<number, number>());

    for (const entry of bonus) {
        const ids = gearIdsOf(entry, byCat, known);
        if (!ids.length) continue;
        for (let i = 0; i < ships.length; i++) {
            const usable = ids.filter(id => catSets[i].has(catOf.get(id) ?? -1));
            if (!usable.length) continue;
            for (const line of entry.bonuses) {
                if (!bonusLineMatches(line, ships[i])) continue;
                hasBonus[i] = true;
                for (const id of usable) idSets[i].add(id);
            }
        }
    }
    for (const rule of fitRules) {
        for (let i = 0; i < ships.length; i++) {
            if (!fitMatches(rule, ships[i])) continue;
            for (const id of rule.gearIds) {
                if (!catSets[i].has(catOf.get(id) ?? -1)) continue;
                idSets[i].add(id);
                fitDays[i].set(id, (fitDays[i].get(id) ?? 0) + rule.day);
            }
        }
    }
    return ships.map((_, i) => ({
        hasBonus: hasBonus[i],
        hasFit: [...fitDays[i].values()].some(v => v > 0),
        hasOver: [...fitDays[i].values()].some(v => v < 0),
        n: idSets[i].size,
    }));
}

function named(byName: Map<string, number>, names: string[]): number[] {
    const ids: number[] = [];
    for (const name of names) {
        const id = byName.get(name);
        if (id) ids.push(id);
    }
    return ids;
}

/**
 * 以 start2 日文原名解析適性表點名的裝備與艦。名稱對不上就略過該條（不猜 id）。
 */
export function buildFitRules(
    gears: { id: number; nameJa: string }[],
    catalog: { id: number; nameJa: string; ctype: number }[],
): FitRule[] {
    const byName = new Map(gears.map(g => [g.nameJa, g.id]));
    const n = (names: string[]) => named(byName, names);
    const ctypeOf = (ja: string, fallback: number) => catalog.find(s => s.nameJa === ja)?.ctype ?? fallback;
    const idsNamed = (...ja: string[]) => catalog.filter(s => ja.includes(s.nameJa)).map(s => s.id);

    const g356 = n([
        '35.6cm連装砲', '試製35.6cm三連装砲', '35.6cm連装砲(ダズル迷彩)',
        '35.6cm三連装砲改(ダズル迷彩仕様)', '35.6cm連装砲改', '35.6cm連装砲改二',
        '38cm連装砲', '38cm連装砲改',
    ]);
    const g38quad = n(['38cm四連装砲', '38cm四連装砲改', '38cm四連装砲改 deux']);
    const g381 = n(['381mm/50 三連装砲', '381mm/50 三連装砲改']);
    const g41twin = n(['41cm連装砲']);
    const g41rest = n([
        '試製41cm三連装砲', '41cm三連装砲改', '41cm三連装砲改二', '41cm連装砲改二',
        '16inch Mk.I三連装砲', '16inch Mk.I三連装砲+AFCT改', '16inch Mk.I三連装砲改+FCR type284',
        '16inch Mk.I連装砲', '16inch Mk.V連装砲', '16inch Mk.VIII連装砲改',
        '16inch三連装砲 Mk.6', '16inch三連装砲 Mk.6 mod.2', '16inch三連装砲 Mk.6+GFCS',
    ]);
    const g41all = [...g41twin, ...g41rest];
    const gMk7 = n(['16inch三連装砲 Mk.7']);
    const gMk7gfcs = n(['16inch三連装砲 Mk.7+GFCS']);
    const gP46 = n(['試製46cm連装砲']);
    const g46 = n(['46cm三連装砲']);
    const g46k = n(['46cm三連装砲改']);
    const g51 = n(['試製51cm連装砲', '51cm連装砲', '試製51cm三連装砲']);
    const g305 = n(['30.5cm三連装砲', '30.5cm三連装砲改']);
    const g320 = n(['320mm/44 連装砲', '320mm/44 三連装砲']);
    const g381en = n(['38.1cm Mk.I連装砲', '38.1cm Mk.I/N連装砲改']);
    const clB = n([
        '15.2cm連装砲', '15.2cm連装砲改', '15.2cm連装砲改二',
        'Bofors 15.2cm連装砲 Model 1930',
        'Bofors 15cm連装速射砲 Mk.9 Model 1938',
        'Bofors 15cm連装速射砲 Mk.9改+単装速射砲 Mk.10改 Model 1938',
        '6inch 連装速射砲 Mk.XXI',
    ]);
    const clC = n(['15.5cm三連装砲', '15.5cm三連装砲改']);
    const clD = n([
        '6inch三連装速射砲 Mk.16', '6inch三連装速射砲 Mk.16 mod.2',
        '6inch Mk.XXIII三連装砲', '152mm/55 三連装速射砲', '152mm/55 三連装速射砲改',
    ]);
    const clE = n(['5inch連装両用砲(集中配備)', 'GFCS Mk.37+5inch連装両用砲(集中配備)']);
    const clF = n([
        '20.3cm連装砲', '20.3cm(2号)連装砲', '20.3cm(3号)連装砲',
        'SKC34 20.3cm連装砲', '203mm/53 連装砲',
    ]);
    const clG = n(['8inch三連装砲 Mk.9', '8inch三連装砲 Mk.9 mod.2']);
    const avMedLight = n([
        '14cm単装砲', '14cm連装砲', '14cm連装砲改', '14cm連装砲改二',
        '15.2cm連装砲', '15.2cm連装砲改', '15.2cm連装砲改二',
    ]);
    const avMedHeavy = n([
        '20.3cm連装砲', '20.3cm(2号)連装砲', '20.3cm(3号)連装砲',
        '8inch三連装砲 Mk.9', '8inch三連装砲 Mk.9 mod.2', '試製20.3cm(4号)連装砲',
    ]);
    const g41kai2 = n(['41cm連装砲改二']);

    const nagatoC = ctypeOf('長門', 19);
    const yamatoC = ctypeOf('大和', 37);
    const kongouC = ctypeOf('金剛', 6);
    const aganoC = ctypeOf('阿賀野', 41);
    const atlantaC = ctypeOf('Atlanta', 99);
    const ooyodoC = ctypeOf('大淀', 20);
    const fletcherC = ctypeOf('Johnston', 91);
    const robertsC = ctypeOf('Samuel B.Roberts', 87);
    const jClassC = ctypeOf('Jervis', 82);
    const mutsukiC = ctypeOf('睦月', 28);
    const tashkentC = ctypeOf('Ташкент', 81);
    const iowaC = ctypeOf('Iowa', 65);
    const bismarckC = ctypeOf('Bismarck', 47);
    const littorioC = ctypeOf('Italia', 58);
    const richelieuC = ctypeOf('Richelieu', 79);
    const gangutC = ctypeOf('Гангут', 73);
    const cavourC = ctypeOf('Conte di Cavour', 113);
    const yamatoKai2 = idsNamed('大和改二');
    const nagatoKai2 = idsNamed('長門改二');
    const verniy = idsNamed('Верный');
    const tashkentIds = catalog.filter(s => s.ctype === tashkentC).map(s => s.id);

    const rules: FitRule[] = [
        { gearIds: g356, day: 4, note: 'bcBase', match: { bbGroup: 'bc' } },
        { gearIds: g356, day: 3, note: 'kongouExtra', match: { bbGroup: 'bc', ctypes: [kongouC] } },
        { gearIds: g38quad, day: -4, unverified: true, note: 'bc38quad', match: { bbGroup: 'bc' } },
        { gearIds: g381, day: -2, note: 'bc381', match: { bbGroup: 'bc' } },
        { gearIds: g381, day: 3, note: 'bismarckLittorio', match: { ctypes: [bismarckC, littorioC] } },
        { gearIds: g41all, day: -5, note: 'bc41', match: { bbGroup: 'bc' } },
        { gearIds: gMk7, day: -5, note: 'bcMk7', match: { bbGroup: 'bc' } },
        { gearIds: gMk7, day: 7, unverified: true, note: 'iowaMk7', match: { ctypes: [iowaC] } },
        { gearIds: gMk7gfcs, day: 14, unverified: true, note: 'iowaMk7gfcs', match: { ctypes: [iowaC] } },
        { gearIds: gP46, day: -7, note: 'bcP46', match: { bbGroup: 'bc' } },
        { gearIds: g46, day: -10, note: 'bc46', match: { bbGroup: 'bc' } },
        { gearIds: g51, day: -10, note: 'bc51', match: { bbGroup: 'bc' } },
        { gearIds: g38quad, day: 2, note: 'richelieu', match: { ctypes: [richelieuC] } },
        { gearIds: g305, day: 12, unverified: true, note: 'gangut305', match: { ctypes: [gangutC] } },
        { gearIds: g320, day: 14, unverified: true, note: 'cavour320', match: { ctypes: [cavourC] } },
        { gearIds: gP46, day: 3, note: 'yamatoKai2', match: { ids: yamatoKai2 } },
        { gearIds: g46, day: 3, note: 'yamatoKai2', match: { ids: yamatoKai2 } },
        { gearIds: g46k, day: 7, note: 'yamatoKai2', match: { ids: yamatoKai2 } },

        { gearIds: g356, day: 2, note: 'bbABase', match: { bbGroup: 'bbA' } },
        { gearIds: g381, day: 2, note: 'bbABase', match: { bbGroup: 'bbA' } },
        { gearIds: g41all, day: 2, note: 'bbABase', match: { bbGroup: 'bbA' } },
        { gearIds: gP46, day: -3, note: 'bbAP46', match: { bbGroup: 'bbA' } },
        { gearIds: g46, day: -7, note: 'bbA46', match: { bbGroup: 'bbA' } },
        { gearIds: g46k, day: -7, note: 'bbA46k', match: { bbGroup: 'bbA' } },
        { gearIds: g41kai2, day: 4, note: 'nagatoKai2', match: { ids: nagatoKai2 } },
        { gearIds: g41rest.filter(id => !g41kai2.includes(id)), day: 3, note: 'nagatoKai2Rest', match: { ids: nagatoKai2 } },
        { gearIds: g41all, day: 2, note: 'nagatoOther', match: { ctypes: [nagatoC], excludeIds: nagatoKai2 } },
        { gearIds: g51, day: -5, note: 'nagato51', match: { ctypes: [nagatoC] } },

        { gearIds: gP46, day: 3, note: 'yamatoClass', match: { bbGroup: 'bbB', ctypes: [yamatoC] } },
        { gearIds: g46, day: 3, note: 'yamatoClass', match: { bbGroup: 'bbB', ctypes: [yamatoC] } },
        { gearIds: g46k, day: 7, note: 'yamatoClass', match: { bbGroup: 'bbB', ctypes: [yamatoC] } },

        { gearIds: g356, day: 4, note: 'bbvABase', match: { bbGroup: 'bbvA' } },
        { gearIds: g381, day: 2, note: 'bbvABase', match: { bbGroup: 'bbvA' } },
        { gearIds: g41all, day: 2, note: 'bbvABase', match: { bbGroup: 'bbvA' } },
        { gearIds: gP46, day: -3, note: 'bbvAP46', match: { bbGroup: 'bbvA' } },
        { gearIds: g46, day: -7, note: 'bbvA46', match: { bbGroup: 'bbvA' } },
        { gearIds: g46k, day: -7, note: 'bbvA46k', match: { bbGroup: 'bbvA' } },

        { gearIds: g356, day: 4, note: 'bbvBBase', match: { bbGroup: 'bbvB' } },
        { gearIds: g381, day: 2, note: 'bbvBBase', match: { bbGroup: 'bbvB' } },
        { gearIds: g41all, day: 2, note: 'bbvBBase', match: { bbGroup: 'bbvB' } },
        { gearIds: g46, day: -8, note: 'bbvB46', match: { bbGroup: 'bbvB' } },
        { gearIds: gP46, day: 3, note: 'yamatoKai2Juu', match: { bbGroup: 'bbvB' } },
        { gearIds: g46, day: 3, note: 'yamatoKai2Juu', match: { bbGroup: 'bbvB' } },
        { gearIds: g46k, day: 7, note: 'yamatoKai2Juu', match: { bbGroup: 'bbvB' } },

        { gearIds: g381en, day: 8, note: 'warspite381', match: { ids: idsNamed('Warspite', 'Warspite改') } },

        { gearIds: clC, day: -5, unverified: true, note: 'cl155', match: { stypes: [3], excludeCtypes: [ooyodoC] } },
        { gearIds: clD, day: -6, note: 'clForeignTriple', match: { stypes: [3] } },
        { gearIds: clE, day: -6, note: 'clAtlantaGun', match: { stypes: [3], excludeCtypes: [atlantaC] } },
        { gearIds: clF, day: -3, note: 'cl203', match: { stypes: [3] } },
        { gearIds: clG, day: -22, note: 'cl8inch', match: { stypes: [3] } },
        { gearIds: clB, day: 5, note: 'agano152', match: { ctypes: [aganoC] } },
        { gearIds: clC, day: -2, note: 'ooyodo155', match: { ctypes: [ooyodoC] } },
        { gearIds: clE, day: 0, note: 'atlantaHistoric', match: { ctypes: [atlantaC] } },

        { gearIds: n(['130mm B-13連装砲']), day: 5, note: 'tashkentVerniy', match: { ids: [...verniy, ...tashkentIds] } },
        { gearIds: n(['5inch単装砲 Mk.30', '5inch単装砲 Mk.30改', '5inch単装砲 Mk.30改+GFCS Mk.37']), day: 4, note: 'fletcher', match: { ctypes: [fletcherC] } },
        { gearIds: n(['5inch単装砲 Mk.30改', '5inch単装砲 Mk.30改+GFCS Mk.37']), day: 4, note: 'roberts', match: { ctypes: [robertsC] } },
        { gearIds: n(['QF 4.7inch砲 Mk.XII改']), day: 3, note: 'jClass', match: { ctypes: [jClassC] } },
        { gearIds: n(['Type124 ASDIC', 'Type144/147 ASDIC', 'HF/DF + Type144/147 ASDIC']), day: 3, unverified: true, note: 'jClassAsdic', match: { ctypes: [jClassC] } },
        { gearIds: n(['12cm単装砲改二']), day: 5, note: 'mutsuki', match: { ctypes: [mutsukiC] } },

        { gearIds: avMedLight, day: -6, note: 'avMedLight', match: { stypes: [16] } },
        { gearIds: avMedHeavy, day: -10, note: 'avMedHeavy', match: { stypes: [16] } },
    ];
    return rules.filter(rule => rule.gearIds.length > 0);
}
