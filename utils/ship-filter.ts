// 鎮守府全船篩選：航速／艦種／可裝備／出擊標籤／關鍵字。
//
// 純函式、無 chrome.* 與 DOM，可獨立編譯用 node 餵資料驗證（CLAUDE.md 設計原則 4）。
// 由「活動作戰板」與「艦娘全覽」兩個分區共用（UI 殼在 overview/ship-picker.ts）。
//
// ── 資料來源與驗證狀態 ────────────────────────────────────────────────
// · 航速 `api_ship.api_soku`：真封包 427 艘實測分佈 {10: 300, 5: 127}＝高速／低速。
//   遊戲另有 15 高速+／20 最速（缶・タービン 組合達成）但該樣本未出現，**值域未實測**，
//   故本檔一律用「>= 門檻」比較、不列舉具體數值，未來出現 15/20 也不必改。
// · 可裝備類別：來自 `GameState.equipTypesOf()`，已用真實完整 start2 驗證逐艦覆蓋規則
//   （`api_mst_equip_ship` 完整覆蓋艦種預設）。**不能只看艦種**——艦種表說駆逐艦不能裝
//   上陸用舟艇，但遊戲裡有 41 艘驅逐艦裝得了大發系。
// · 國籍（建造國）：`ship-nationality.ts` 的人工參照表，鍵＝艦型 ctype。**遊戲 API 不提供
//   國籍**，故它是參照資料而非封包事實；`nation` 為 null＝master 未載入、不可考。
// · 艦種 id：`api_mst_stype` 22 種。注意「高速戦艦」**不是艦種**——id 8 與 9 都叫「戦艦」，
//   高速/低速要靠 api_soku 合判，故本檔把它做成航速篩選 × 艦種篩選的組合，不另立艦種。

import { NATIONS, type Nation } from './ship-nationality';

/** 裝備類別 id（`api_mst_slotitem_equiptype`），已用真實 start2 核對名稱。 */
export const EQUIP_TYPE = {
    landingCraft: 24,   // 上陸用舟艇（大發系）
    commandFacility: 34, // 司令部施設
    seaplaneFighter: 45, // 水上戦闘機
    naikatei: 46,       // 特型内火艇
} as const;

/** 航速門檻。低速 5／高速 10／高速+ 15／最速 20（後兩者未於樣本實測，見檔頭）。 */
export const SOKU = { slow: 5, fast: 10, fastPlus: 15 } as const;

export type SpeedFilter = 'all' | 'slow' | 'fast' | 'fastPlus';

/**
 * 可裝備篩選。七個選項＝「能裝大發系」與「能裝內火艇」兩個布林值的組合，
 * 已用真實 start2 對全 1751 艦驗算，七個桶皆非空（見 CLAUDE.md「鎮守府全船篩選」）。
 */
export type EquipFilter =
    | 'all'
    | 'landingCraft'     // 能裝大發系（不管內火）
    | 'landingOnly'      // 能裝大發系且**不能**裝內火
    | 'naikatei'         // 能裝內火艇（不管大發）
    | 'naikateiOnly'     // 能裝內火艇且**不能**裝大發
    | 'both'             // 兩者皆可
    | 'either'           // 兩者任一
    | 'neither'          // 兩者皆不可
    | 'commandFacility'  // 能裝司令部施設
    | 'seaplaneFighter'; // 能裝水上戦闘機

export interface ShipFilterState {
    speed: SpeedFilter;
    /**
     * 國籍（建造國）白名單；空陣列＝不限。**多選**——「英美」「地中海組」這種組合是實際
     * 會問的問題，做成單選會逼使用者篩三次再自己合併。同艦種篩選的形狀。
     */
    nations: Nation[];
    /** 艦種 id 白名單；空陣列＝不限。 */
    stypeIds: number[];
    equip: EquipFilter;
    /** 出擊標籤篩選：null＝不限、0＝只看無標籤（自由身）、>0＝只看該標籤。 */
    sallyArea: number | null;
    /** 艦名關鍵字（大小寫不敏感、去頭尾空白）。 */
    search: string;
}

export const emptyFilter = (): ShipFilterState => ({
    speed: 'all', nations: [], stypeIds: [], equip: 'all', sallyArea: null, search: '',
});

/** 篩選所需的最小艦娘資訊（`GameState.ownedShips()` 的子集）。 */
export interface FilterableShip {
    id: number;
    name: string;
    stypeId: number;
    /** 國籍（建造國）。由 `nationOf(ctype)` 查得；null＝master 未載入、不可考。 */
    nation: Nation | null;
    /** 國籍篩選標籤；未提供時回退成單一的 `nation`，供舊資料／純函式呼叫端相容。 */
    nations?: Nation[];
    lv: number;
    soku: number;
    equipTypes: number[];
    sallyArea: number;
}

export type ShipSortKey = 'level' | 'stype' | 'name';

/**
 * 航速判定。**匯出**是因為活動配船板的自由池自己有一套艦種分組與關鍵字邏輯，只借
 * 航速／可裝備兩項語意；讓它照抄一份門檻比較會讓兩邊日後不同步（高速+／最速的值域
 * 尚未實測，見檔頭），故兩支斷言由本檔單一提供。
 */
export function matchSpeed(soku: number, f: SpeedFilter): boolean {
    if (f === 'all') return true;
    // 0／非有限值代表欄位缺席或無效，不是「比高速門檻低」的已知航速；任何具體航速
    // 白名單都不可把未知值納入。
    if (!Number.isFinite(soku) || soku <= 0) return false;
    // 低速是「未達高速」而非「等於 5」——避免遊戲日後新增中間值時漏判。
    if (f === 'slow') return soku < SOKU.fast;
    if (f === 'fast') return soku >= SOKU.fast;
    return soku >= SOKU.fastPlus;
}

/** 可裝備判定（匯出理由同 `matchSpeed`）。 */
export function matchEquip(types: number[], f: EquipFilter): boolean {
    if (f === 'all') return true;
    const set = new Set(types);
    const landing = set.has(EQUIP_TYPE.landingCraft);
    const naikatei = set.has(EQUIP_TYPE.naikatei);
    switch (f) {
        case 'landingCraft': return landing;
        case 'landingOnly': return landing && !naikatei;
        case 'naikatei': return naikatei;
        case 'naikateiOnly': return naikatei && !landing;
        case 'both': return landing && naikatei;
        case 'either': return landing || naikatei;
        case 'neither': return !landing && !naikatei;
        case 'commandFacility': return set.has(EQUIP_TYPE.commandFacility);
        case 'seaplaneFighter': return set.has(EQUIP_TYPE.seaplaneFighter);
    }
}

/** 依 filter 篩選並排序。不修改輸入陣列。 */
export function filterShips<T extends FilterableShip>(
    ships: T[], filter: ShipFilterState, sort: ShipSortKey = 'level',
): T[] {
    const needle = filter.search.trim().toLocaleLowerCase();
    const stypes = new Set(filter.stypeIds);
    const nations = new Set(filter.nations);
    const out = ships.filter(s =>
        matchSpeed(s.soku, filter.speed)
        && (stypes.size === 0 || stypes.has(s.stypeId))
        // 國籍不可考（master 未載入）時不落入任何白名單，這是對的——寧可不列，
        // 也不要在缺 master 的情況下宣稱某艘是日艦。
        && (nations.size === 0 || filterNationsOf(s).some(n => nations.has(n)))
        && matchEquip(s.equipTypes, filter.equip)
        && (filter.sallyArea == null || s.sallyArea === filter.sallyArea)
        && (!needle || s.name.toLocaleLowerCase().includes(needle)));

    return out.sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id;
        if (sort === 'stype') return a.stypeId - b.stypeId || b.lv - a.lv || a.id - b.id;
        return b.lv - a.lv || a.id - b.id;
    });
}

/** 目前有哪些標籤（含 0＝自由身），供篩選器列出選項。依標籤 id 升冪，0 恆在首。 */
export function sallyOptions(ships: FilterableShip[]): { sallyArea: number; count: number }[] {
    const byTag = new Map<number, number>();
    for (const s of ships) byTag.set(s.sallyArea, (byTag.get(s.sallyArea) ?? 0) + 1);
    return [...byTag.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([sallyArea, count]) => ({ sallyArea, count }));
}

/**
 * 名冊裡實際有船的國籍（依 NATIONS 的顯示順序）。
 * 不可考（nation 為 null）不列成選項——那不是一個可篩選的類別。
 */
export function nationOptions(ships: FilterableShip[]): { nation: Nation; count: number }[] {
    const counts = new Map<Nation, number>();
    for (const s of ships) {
        for (const nation of filterNationsOf(s)) {
            counts.set(nation, (counts.get(nation) ?? 0) + 1);
        }
    }
    return NATIONS.filter(n => counts.has(n)).map(nation => ({ nation, count: counts.get(nation)! }));
}

/** 取得篩選用國籍標籤；同一艦可同時落在多個國籍選項。 */
function filterNationsOf(ship: FilterableShip): Nation[] {
    return ship.nations ?? (ship.nation == null ? [] : [ship.nation]);
}

/** 目前名冊實際出現過的艦種 id（升冪）——篩選器只列出有船的艦種，不列全 22 種。 */
export function stypeOptions(ships: FilterableShip[]): number[] {
    return [...new Set(ships.map(s => s.stypeId))].sort((a, b) => a - b);
}
