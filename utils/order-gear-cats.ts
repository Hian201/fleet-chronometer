// 調度分頁裝備分類（對齊遊戲改裝畫面大項）。
//
// 以 `api_type[2]`（裝備類別 id）分組——與 gear-inventory 的 icon（api_type[3]）不同層；
// 大項／二次篩都是 catId 白名單。純資料＋純函式，無 chrome.*。

export interface OrderGearSub {
    id: string;
    /** i18n key。 */
    labelKey: string;
    /** 二次篩的類別 id；空＝用父層全部。 */
    catIds: number[];
}

export interface OrderGearCat {
    id: string;
    labelKey: string;
    /** 大項涵蓋的類別 id。 */
    catIds: number[];
    subs: OrderGearSub[];
}

/**
 * 遊戲側欄大項（使用者定案清單）。魚雷／對潛等未列入者暫不收——要補再開一顆。
 * catId 來自 samples/start2-master.json 的 api_mst_slotitem_equiptype。
 */
export const ORDER_GEAR_CATS: readonly OrderGearCat[] = [
    {
        id: 'fighter', labelKey: 'order.gear.fighter',
        catIds: [6, 48, 56],
        subs: [
            { id: 'cv', labelKey: 'order.gear.fighterCv', catIds: [6] },
            { id: 'land', labelKey: 'order.gear.fighterLand', catIds: [48] },
            { id: 'jet', labelKey: 'order.gear.fighterJet', catIds: [56] },
        ],
    },
    {
        id: 'attacker', labelKey: 'order.gear.attacker',
        catIds: [7, 8, 57, 58],
        subs: [
            { id: 'db', labelKey: 'order.gear.dive', catIds: [7, 57] },
            { id: 'tb', labelKey: 'order.gear.torpedoBomber', catIds: [8, 58] },
        ],
    },
    {
        id: 'seaplane', labelKey: 'order.gear.seaplane',
        catIds: [10, 11, 41, 45],
        subs: [
            { id: 'spr', labelKey: 'order.gear.seaplaneRecon', catIds: [10, 41] },
            { id: 'spb', labelKey: 'order.gear.seaplaneBomber', catIds: [11] },
            { id: 'spf', labelKey: 'order.gear.seaplaneFighter', catIds: [45] },
        ],
    },
    {
        id: 'mainGun', labelKey: 'order.gear.mainGun',
        catIds: [1, 2, 3, 38],
        subs: [
            { id: 'small', labelKey: 'order.gear.gunSmall', catIds: [1] },
            { id: 'med', labelKey: 'order.gear.gunMed', catIds: [2] },
            { id: 'large', labelKey: 'order.gear.gunLarge', catIds: [3, 38] },
        ],
    },
    {
        id: 'shell', labelKey: 'order.gear.shell',
        catIds: [18, 19, 33],
        subs: [
            { id: 'aa', labelKey: 'order.gear.shellAa', catIds: [18] },
            { id: 'ap', labelKey: 'order.gear.shellAp', catIds: [19] },
            { id: 'star', labelKey: 'order.gear.shellStar', catIds: [33] },
        ],
    },
    {
        id: 'aa', labelKey: 'order.gear.aa',
        catIds: [4, 21, 36, 95],
        subs: [
            { id: 'sec', labelKey: 'order.gear.secondary', catIds: [4, 95] },
            { id: 'mg', labelKey: 'order.gear.aaGun', catIds: [21] },
            { id: 'fd', labelKey: 'order.gear.aaFd', catIds: [36] },
        ],
    },
    {
        id: 'radar', labelKey: 'order.gear.radar',
        catIds: [12, 13, 93],
        subs: [
            { id: 'small', labelKey: 'order.gear.radarSmall', catIds: [12] },
            { id: 'large', labelKey: 'order.gear.radarLarge', catIds: [13, 93] },
        ],
    },
    {
        id: 'landing', labelKey: 'order.gear.landing',
        catIds: [24, 46],
        subs: [
            { id: 'daihatsu', labelKey: 'order.gear.daihatsu', catIds: [24] },
            { id: 'tank', labelKey: 'order.gear.naikatei', catIds: [46] },
        ],
    },
    {
        id: 'consumable', labelKey: 'order.gear.consumable',
        catIds: [23, 35, 39, 43, 44],
        subs: [
            { id: 'damecon', labelKey: 'order.gear.damecon', catIds: [23] },
            { id: 'crew', labelKey: 'order.gear.crew', catIds: [35, 39] },
            { id: 'ration', labelKey: 'order.gear.ration', catIds: [43, 44] },
        ],
    },
    {
        id: 'lbas', labelKey: 'order.gear.lbas',
        catIds: [47, 48, 49, 53],
        subs: [
            { id: 'landAtk', labelKey: 'order.gear.landAtk', catIds: [47, 53] },
            { id: 'interceptor', labelKey: 'order.gear.fighterLand', catIds: [48] },
            { id: 'recon', labelKey: 'order.gear.landRecon', catIds: [49] },
        ],
    },
    {
        id: 'engine', labelKey: 'order.gear.engine',
        catIds: [16, 17, 27, 28],
        subs: [
            { id: 'boiler', labelKey: 'order.gear.boiler', catIds: [17] },
            { id: 'armor', labelKey: 'order.gear.armor', catIds: [16, 27, 28] },
        ],
    },
    {
        id: 'light', labelKey: 'order.gear.light',
        catIds: [29, 33, 42],
        subs: [
            { id: 'sl', labelKey: 'order.gear.searchlight', catIds: [29, 42] },
            { id: 'star', labelKey: 'order.gear.shellStar', catIds: [33] },
        ],
    },
] as const;

/** 解析目前生效的 catId 白名單；cat/sub 無效時回 null＝不篩（等同全装備）。 */
export function resolveGearCatIds(catId: string | null, subId: string): number[] | null {
    if (catId == null) return null;
    const cat = ORDER_GEAR_CATS.find(c => c.id === catId);
    if (!cat) return null;
    if (!subId || subId === 'all') return [...cat.catIds];
    const sub = cat.subs.find(s => s.id === subId);
    return sub ? [...sub.catIds] : [...cat.catIds];
}

export function matchGearCat(catId: number, allowed: number[] | null): boolean {
    if (allowed == null) return true;
    return allowed.includes(catId);
}
