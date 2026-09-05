// 「DeckBuilder」格式輸出——社群通用的艦隊編成 JSON 格式，被多個外部工具採用（見下）。
// 純資料轉換模組（無 chrome.*），只讀 GameState 既有的公開 View API
// （fleets()／airBases_()／ownedShips()），不解析 raw api_ship——同 ownedShips() 本身
// 的「overview 等唯讀介面只能讀此 API」原則。
//
// 為何做這個：使用者想要「艦隊編成卡片圖」與「制空権計算」，但擴充本身絕不碰任何遊戲圖片
// 或美術資產（CLAUDE.md 設計原則、M7 圖示系統的零第三方素材立場）。折衷方案是只輸出
// **純數字**（艦娘/裝備 master id、等級、改修值、熟練度）交給使用者自己選擇的外部工具，
// 由那些工具自己決定要不要用官方美術呈現——本專案的程式碼完全不觸碰、不下載、不合成
// 任何圖片，跟既有「複製完整報告」給 LLM 是同一種「交出資料、外部工具自己處理」模式。
//
// 格式來源已對照兩個實際採用此格式的工具原始碼確認（非猜測，2026-07）：
//   · KanColleImgBuilder（https://github.com/HitomaruKonpaku/KanColleImgBuilder，
//     依 gkcoi 函式庫 https://github.com/Nishisonic/gkcoi 的 DeckBuilder schema）：
//     builder.component.ts 用 `JSON.parse(decodeURI(route.fragment))` 讀網址 hash。
//   · 制空権シミュレータ（noro6/kc-web，https://noro6.github.io/kc-web/）：
//     App.vue 讀 query `predeck` 或 hash `#import:{predeck}`，餵進
//     `Convert.loadDeckBuilder()`。出擊資料會超過 GitHub Pages 的 request URI
//     上限，跳轉一律走 hash（fragment 不上伺服器）。convert.ts 的 DeckBuilderShip interface
//     顯示 fp/tp/aa/ar/asw/ev/los 皆為選填（缺席時該工具會自己用 master+等級回推），
//     故本檔案在附不到精確素質時省略該欄位並非未完成，而是兩個消費端都容許的行為。
// 兩者吃同一種 schema（f1~f4 艦隊、a1~a3 基地航空隊），故艦隊／陸航轉換器共用。
// kc-web 另認 `s`（出擊各格敵編成）與陸航 `sp`（派遣格），出擊紀錄跳轉見
// `buildReplayAirCalcDeck()`；標準複製 JSON 不加這兩欄，以免其他 DeckBuilder 消費端
// 把未知欄位當錯誤。
import { airBaseKey } from './state';
import type { AirBaseView, FleetView, GameState, GearView, ShipView } from './state';
import type { ReplayLbas, ReplayNode, ReplayRow, ReplayShip, ReplaySupportShip } from './db';

// lbas：以**海域（maparea id）**為鍵的開關表（`String(areaId)`），缺席＝送出，見
// entrypoints/overview/lib.ts 的 FleetMarkdownScope 同一份註解——**不可用 rid 當鍵**
// （各海域都有自己的第一/第二/第三基地航空隊，會撞號）。
export interface DeckBuilderScope { fleets: boolean[]; lbas: Record<string, boolean> }

interface DeckBuilderItem { id: number; rf: number; mas?: number; count?: number }
type DeckBuilderItems = Record<string, DeckBuilderItem>;

// 補強增設槽位的 key：kc-web 的 convert.ts 認得 'ix' 這個固定字串（另一種
// `i${槽數+1}` 寫法對可變槽數艦娘不好算，'ix' 兩邊都吃得下，故固定用它）。
const EX_ITEM_KEY = 'ix';

type FleetCodeState = Pick<GameState, 'hqLv' | 'fleets'> & Partial<Pick<GameState, 'airBases_'>>;
type OwnedEquipmentCodeState = Pick<GameState, 'ownedGears'>;

const MAX_DECK_BUILDER_AIR_BASES = 3;

function requireNonNegativeInteger(value: unknown, where: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${where} 不是可安全輸出的非負整數。`);
    }
    return value;
}

function requirePositiveInteger(value: unknown, where: string): number {
    const number = requireNonNegativeInteger(value, where);
    if (number === 0) throw new Error(`${where} 不是可安全輸出的正整數。`);
    return number;
}

function deckBuilderItem(gear: Pick<GearView, 'mst' | 'level' | 'alv'>, where: string): DeckBuilderItem {
    return {
        id: requirePositiveInteger(gear.mst, `${where}.id`),
        rf: requireNonNegativeInteger(gear.level, `${where}.rf`),
        mas: requireNonNegativeInteger(gear.alv, `${where}.mas`),
    };
}

function selectedFleetNumbers(state: FleetCodeState, fleetNos: readonly number[]): number[] {
    if (fleetNos.length === 0) throw new Error('至少需要選擇一隊艦隊。');
    const fleets = state.fleets();
    const unique = new Set<number>();
    for (const fleetNo of fleetNos) {
        const number = requirePositiveInteger(fleetNo, 'fleetNo');
        if (unique.has(number)) throw new Error(`艦隊 ${number} 被重複選取。`);
        if (!fleets[number - 1]?.ships.length) throw new Error(`艦隊 ${number} 沒有可輸出的編成資料。`);
        unique.add(number);
    }
    return [...unique].sort((a, b) => a - b);
}

function selectedFleet(fleet: FleetView, fleetNo: number): Record<string, unknown> {
    if (fleet.ships.length > 7) throw new Error(`艦隊 ${fleetNo} 超過 DeckBuilder 可安全輸出的七艘艦。`);
    const output: Record<string, unknown> = {};
    fleet.ships.forEach((ship, shipIndex) => {
        output[`s${shipIndex + 1}`] = deckBuilderShip(ship, `fleet${fleetNo}.s${shipIndex + 1}`);
    });
    return output;
}

function deckBuilderShip(ship: ShipView, where: string): Record<string, unknown> {
    const items: DeckBuilderItems = {};
    if (!Array.isArray(ship.gears)) throw new Error(`${where}.gears 不是可輸出的裝備槽陣列。`);
    ship.gears.forEach((gear, gearIndex) => {
        if (gear) items[`i${gearIndex + 1}`] = deckBuilderItem(gear, `${where}.items.i${gearIndex + 1}`);
    });
    if (ship.exGear) items[EX_ITEM_KEY] = deckBuilderItem(ship.exGear, `${where}.items.${EX_ITEM_KEY}`);
    return {
        id: requirePositiveInteger(ship.mst, `${where}.id`),
        lv: requireNonNegativeInteger(ship.lv, `${where}.lv`),
        luck: requireNonNegativeInteger(ship.luck, `${where}.luck`),
        // DeckBuilder／らくらく支援編成読込使用的增設開放旗標；有裝備或明確的空孔都代表已開放。
        exa: ship.exGear !== null || ship.exEmpty,
        hp: requireNonNegativeInteger(ship.hp, `${where}.hp`),
        items,
    };
}

function supportDeckBuilderItem(
    gear: Pick<GearView, 'mst' | 'level'>,
    where: string,
): Omit<DeckBuilderItem, 'mas'> {
    return {
        id: requirePositiveInteger(gear.mst, `${where}.id`),
        rf: requireNonNegativeInteger(gear.level, `${where}.rf`),
    };
}

function supportDeckBuilderShip(ship: ShipView, where: string): Record<string, unknown> {
    const items: Record<string, Omit<DeckBuilderItem, 'mas'>> = {};
    if (!Array.isArray(ship.gears)) throw new Error(`${where}.gears 不是可輸出的裝備槽陣列。`);
    ship.gears.forEach((gear, gearIndex) => {
        if (gear) items[`i${gearIndex + 1}`] = supportDeckBuilderItem(gear, `${where}.items.i${gearIndex + 1}`);
    });
    if (ship.exGear) items[EX_ITEM_KEY] = supportDeckBuilderItem(ship.exGear, `${where}.items.${EX_ITEM_KEY}`);
    return {
        id: String(requirePositiveInteger(ship.mst, `${where}.id`)),
        lv: requireNonNegativeInteger(ship.lv, `${where}.lv`),
        luck: requireNonNegativeInteger(ship.luck, `${where}.luck`),
        exa: ship.exGear !== null || ship.exEmpty,
        items,
    };
}

function selectedSupportFleet(fleet: FleetView, fleetNo: number): Record<string, unknown> {
    if (fleet.ships.length > 6) throw new Error(`支援艦隊 ${fleetNo} 超過らくらく支援編成可讀取的六艘艦。`);
    const output: Record<string, unknown> = {};
    fleet.ships.forEach((ship, shipIndex) => {
        output[`s${shipIndex + 1}`] = supportDeckBuilderShip(ship, `fleet${fleetNo}.s${shipIndex + 1}`);
    });
    return output;
}

function deckBuilderAirBase(base: AirBaseView, where: string): Record<string, unknown> {
    if (!Array.isArray(base.squadrons)) throw new Error(`${where}.squadrons 不是可輸出的中隊陣列。`);
    const items: DeckBuilderItems = {};
    base.squadrons.forEach((squadron, squadronIndex) => {
        if (squadron.state !== 1) return;
        items[`i${squadronIndex + 1}`] = deckBuilderItem(squadron, `${where}.items.i${squadronIndex + 1}`);
    });
    if (Object.keys(items).length === 0) throw new Error(`${where} 沒有可輸出的已配備中隊。`);
    return {
        mode: requireNonNegativeInteger(base.actionKind, `${where}.mode`),
        items,
    };
}

function selectedAirBases(state: FleetCodeState, airBaseKeys: readonly string[]): AirBaseView[] {
    if (airBaseKeys.length === 0) return [];
    if (airBaseKeys.length > MAX_DECK_BUILDER_AIR_BASES) {
        throw new Error(`基地航空隊最多只能選擇 ${MAX_DECK_BUILDER_AIR_BASES} 隊。`);
    }
    const airBases = state.airBases_?.();
    if (!airBases) throw new Error('目前狀態沒有可輸出的基地航空隊資料。');

    const requested = new Set<string>();
    for (const key of airBaseKeys) {
        if (typeof key !== 'string' || key.length === 0) throw new Error('基地航空隊選取鍵無效。');
        if (requested.has(key)) throw new Error(`基地航空隊 ${key} 被重複選取。`);
        requested.add(key);
    }
    const selected = airBases.filter(base => requested.has(airBaseKey(base)));
    if (selected.length !== requested.size) throw new Error('選取的基地航空隊不存在於目前狀態。');
    return selected;
}

/**
 * 將鎮守府目前所有裝備轉成可手動貼上的裝備代碼。
 * 這裡只取 `ownedGears()` 的 master id 與改修值，不輸出裝備實例 id 或名稱。
 */
export function buildOwnedEquipmentCode(state: OwnedEquipmentCodeState): string {
    const code = state.ownedGears().map((gear, index) => ({
        id: requirePositiveInteger(gear.mst, `owned[${index}].id`),
        lv: requireNonNegativeInteger(gear.level, `owned[${index}].lv`),
    }));
    return JSON.stringify(code);
}

/**
 * 將使用者選取的艦隊與基地航空隊轉成 DeckBuilder v4 JSON。輸出艦隊會依原艦隊編號
 * 排序後連續填入 f1、f2…；出擊與支援兩組選取因此可以彼此獨立，且不保留原始艦隊空洞。
 * 基地航空隊使用複合鍵選取並依 areaId／rid 順序填入 a1、a2、a3；DeckBuilder 只支援
 * 三個基地欄位，超過時拒絕輸出而不靜默截斷。
 */
export function buildSelectedDeckBuilder(
    state: FleetCodeState,
    fleetNos: readonly number[],
    airBaseKeys: readonly string[] = [],
): object {
    const deck: Record<string, unknown> = { version: 4 };
    if (Number.isSafeInteger(state.hqLv) && state.hqLv > 0) deck.hqlv = state.hqLv;
    const fleets = state.fleets();
    selectedFleetNumbers(state, fleetNos).forEach((fleetNo, index) => {
        deck[`f${index + 1}`] = selectedFleet(fleets[fleetNo - 1]!, fleetNo);
    });
    selectedAirBases(state, airBaseKeys).forEach((base, index) => {
        deck[`a${index + 1}`] = deckBuilderAirBase(base, `airBase${airBaseKey(base)}`);
    });
    return deck;
}

/**
 * 將選取的支援艦隊轉成らくらく「編成出力」相同的 DeckBuilder v4 形狀。
 * 支援頁的編成資料不保存艦娘 HP 或裝備熟練度，因此這裡只輸出其可接受的欄位。
 * `items` 仍保留在代碼中，供會讀取支援艦隊裝備的 DeckBuilder 工具使用。
 */
export function buildSelectedSupportDeckBuilder(
    state: FleetCodeState,
    fleetNos: readonly number[],
): object {
    const deck: Record<string, unknown> = { version: 4 };
    const fleets = state.fleets();
    selectedFleetNumbers(state, fleetNos).forEach((fleetNo, index) => {
        deck[`f${index + 1}`] = selectedSupportFleet(fleets[fleetNo - 1]!, fleetNo);
    });
    return deck;
}

export function buildDeckBuilder(state: GameState, scope: DeckBuilderScope): object {
    // ownedShips() 已含裝備加成的精確素質（見該方法註解），用艦實例 id 反查——
    // fleets() 回傳的 ShipView 本身不帶完整八維素質，兩邊資料源相同、只是取用的
    // View 方法不同，id 是唯一可靠的對應鍵（mst 同型艦會撞號）。
    const statsById = new Map(state.ownedShips().map(s => [s.id, s]));

    const deck: Record<string, unknown> = { hqlv: state.hqLv };

    state.fleets().forEach((f, i) => {
        if (!f.ships.length || scope.fleets[i] === false) return;
        const fleetObj: Record<string, unknown> = {};
        f.ships.slice(0, 7).forEach((s, si) => {
            const items: DeckBuilderItems = {};
            s.gears.forEach((g, gi) => {
                if (g) items[`i${gi + 1}`] = { id: g.mst, rf: g.level, mas: g.alv };
            });
            if (s.exGear) items[EX_ITEM_KEY] = { id: s.exGear.mst, rf: s.exGear.level, mas: s.exGear.alv };
            const owned = statsById.get(s.id);
            const ship: Record<string, unknown> = {
                id: s.mst, lv: s.lv, luck: owned?.stats.luck ?? -1, hp: s.hp, items,
            };
            if (owned) {
                ship.fp = owned.stats.firepower; ship.tp = owned.stats.torpedo; ship.aa = owned.stats.aa;
                ship.ar = owned.stats.armor; ship.asw = owned.stats.asw;
                ship.ev = owned.stats.evasion; ship.los = owned.stats.los;
            }
            fleetObj[`s${si + 1}`] = ship;
        });
        deck[`f${i + 1}`] = fleetObj;
    });

    // a1~a3：DeckBuilder 格式只有三個基地欄位，但鎮守府可以同時擁有**多個海域**的基地
    // （中部海域三個＋活動海域三個），故不能拿 rid 當 key——兩個海域的第一基地航空隊會
    // 互相覆蓋，使用者選了六個卻只送出三個、還不知道被吃掉哪幾個（見 utils/state.ts
    // airBaseKey）。改成**依選取順序**填 a1、a2、a3，滿三個就停：外部工具的欄位數就是
    // 三個，多的沒有地方可放，寧可少送也不要靜靜覆蓋。
    let slot = 0;
    state.airBases_().forEach(b => {
        if (scope.lbas[String(b.areaId)] === false || slot >= 3) return;
        const items: DeckBuilderItems = {};
        b.squadrons.forEach((sq, si) => {
            if (sq.state === 1 && sq.mst > 0) items[`i${si + 1}`] = { id: sq.mst, rf: sq.level, mas: sq.alv };
        });
        if (Object.keys(items).length) deck[`a${++slot}`] = { mode: b.actionKind, items };
    });

    return deck;
}

/**
 * 將一場出擊開始時保存的快照轉成標準 DeckBuilder JSON。
 *
 * 出擊模擬器網址使用模擬器自己的設定備份（`#backup=`），不是這份 f1～f4 編成卡。
 * KC3Kai 的「從文字載入」只認得 `f1`～`f4`／`a1`～`a3`。兩種格式不可混用：
 * 網址可載入不代表複製的 JSON 可貼進 DeckBuilder。
 */
export function buildReplayDeckBuilder(row: ReplayRow): object {
    const deck: Record<string, unknown> = { version: 4 };
    if (typeof row.hqLv === 'number' && Number.isFinite(row.hqLv) && row.hqLv > 0) deck.hqlv = row.hqLv;

    const fleet = (ships: readonly (ReplayShip | ReplaySupportShip)[]) => {
        const out: Record<string, unknown> = {};
        ships.slice(0, 7).forEach((ship, index) => { out[`s${index + 1}`] = replayShip(ship); });
        return out;
    };
    if (row.fleet1.length) deck.f1 = fleet(row.fleet1);
    if (row.fleet2.length) deck.f2 = fleet(row.fleet2);
    if (row.fleet3?.length) deck.f3 = fleet(row.fleet3);
    if (row.fleet4?.length) deck.f4 = fleet(row.fleet4);

    // 一場出擊的快照只會保存該海域的基地，rid 正好對應標準格式 a1～a3。
    for (const base of row.lbas ?? []) {
        if (!Number.isInteger(base.rid) || base.rid < 1 || base.rid > 3) continue;
        const converted = replayLbas(base);
        if (converted) deck[`a${base.rid}`] = converted;
    }
    return deck;
}

function replayShip(ship: ReplayShip | ReplaySupportShip): object {
    const items: DeckBuilderItems = {};
    ship.equip.forEach((id, index) => {
        if (id > 0) items[`i${index + 1}`] = {
            id,
            rf: Math.max(0, ship.stars[index] ?? 0),
            mas: Math.max(0, ship.ace[index] ?? 0),
        };
    });
    if (ship.exequip > 0) {
        items[EX_ITEM_KEY] = {
            id: ship.exequip,
            rf: Math.max(0, ship.exstars ?? 0),
            mas: Math.max(0, ship.exace ?? 0),
        };
    }
    const out: Record<string, unknown> = { id: ship.mst_id, lv: ship.lv, items };
    // 支援艦隊快照沒有 HP；欄位缺席比以不明值補寫更符合 DeckBuilder 契約。
    if ('maxhp' in ship && typeof ship.maxhp === 'number' && ship.maxhp > 0) out.hp = ship.maxhp;
    return out;
}

function replayLbas(base: ReplayLbas): object | undefined {
    const items: DeckBuilderItems = {};
    base.squadrons.forEach((squadron, index) => {
        if (squadron.mst <= 0) return;
        items[`i${index + 1}`] = {
            id: squadron.mst,
            rf: Math.max(0, squadron.stars),
            mas: Math.max(0, squadron.ace),
            count: Math.max(0, squadron.count),
        };
    });
    return Object.keys(items).length ? { mode: base.action, items } : undefined;
}

/** 摘要列中的節點，供沒有原始戰鬥封包的空襲／未結算節點補敵艦 id。 */
export interface AirCalcRouteNode {
    node: number;
    enemyIds?: readonly number[];
    enemyIdsEscort?: readonly number[];
}

export interface AirCalcOptions {
    routeNodes?: readonly AirCalcRouteNode[];
}

/** 制空権シミュレータ首頁。超長 predeck 改開此頁並複製 JSON。 */
export const AIR_CALC_PAGE_URL = 'https://noro6.github.io/kc-web/';
/** URL 過長時改開空白頁並複製 JSON，沿用重播匯出的瀏覽器安全界線。 */
export const AIR_CALC_DIRECT_URL_LIMIT = 30_000;

/**
 * 出擊紀錄 → kc-web 可讀的 DeckBuilder（含各節點敵艦隊）。
 *
 * 標準複製用的 `buildReplayDeckBuilder()` 只給 f1～f4／a1～a3；kc-web 另認
 * `s`（海域＋逐格敵編成）與陸航 `sp`（派遣格）。`f1.t` 必須帶連合旗標，否則
 * convert.ts 會把 f1／f2 當兩支單艦隊。支援艦隊不進 f3／f4——kc-web 會把它們
 * 算進我方制空。`s.c[].c` 與 `sp` 用的是出擊 edge id（`api_no`）；對得上
 * kc-web 的 MasterCell.i 才會補節點名／半徑並讓 `sp` 對到該格，對不上時敵艦隊
 * 仍會匯入、陸航改打最後一格。敵艦 id 用封包原值，不加 KC3Kai 的 +1000。
 * 敵艦裝備不輸出：loadDeckBuilder 只讀 id，裝備改走他們的 master。
 */
export function buildReplayAirCalcDeck(row: ReplayRow, options: AirCalcOptions = {}): object {
    const deck = buildReplayDeckBuilder(row) as Record<string, unknown>;
    delete deck.f3;
    delete deck.f4;
    if (row.combined > 0 && isPlainObject(deck.f1)) {
        deck.f1 = { t: row.combined, ...deck.f1 };
    }
    const cells = airCalcCells(row, options);
    if (cells.length) deck.s = { a: row.world, i: row.mapnum, c: cells };
    for (const [rid, nodes] of lbasStrikeCells(row)) {
        const key = `a${rid}`;
        const airbase = deck[key];
        if (isPlainObject(airbase) && nodes.length) deck[key] = { ...airbase, sp: nodes };
    }
    return deck;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) return parsed;
    }
    return undefined;
}

function battleApi(entry: ReplayNode): Record<string, unknown> | undefined {
    for (const raw of [entry.data, entry.yasen]) {
        if (!isPlainObject(raw)) continue;
        if (Object.keys(raw).some(key => key.startsWith('api_'))) return raw;
    }
    return undefined;
}

function enemyFleet(ids: unknown): { s: { id: number }[] } | undefined {
    if (!Array.isArray(ids)) return undefined;
    const ships = ids.flatMap(raw => {
        const id = integer(raw);
        return id !== undefined && id > 0 ? [{ id }] : [];
    });
    return ships.length ? { s: ships } : undefined;
}

function cellFromPacket(entry: ReplayNode): Record<string, unknown> | undefined {
    const api = battleApi(entry);
    if (!api) return undefined;
    const f1 = enemyFleet(api.api_ship_ke);
    if (!f1) return undefined;
    const f2 = enemyFleet(api.api_ship_ke_combined);
    const formation = Array.isArray(api.api_formation) ? api.api_formation : [];
    const pf = integer(formation[0]);
    const ef = integer(formation[1]);
    return {
        c: entry.node,
        ...(pf === undefined ? {} : { pf }),
        ...(ef === undefined ? {} : { ef }),
        f1,
        ...(f2 ? { f2 } : {}),
    };
}

function cellFromSummary(route: AirCalcRouteNode): Record<string, unknown> | undefined {
    const f1 = enemyFleet(route.enemyIds);
    if (!f1) return undefined;
    const f2 = enemyFleet(route.enemyIdsEscort);
    return { c: route.node, f1, ...(f2 ? { f2 } : {}) };
}

function airCalcCells(row: ReplayRow, options: AirCalcOptions): Record<string, unknown>[] {
    const byNode = new Map<number, Record<string, unknown>>();
    for (const battle of row.battles) {
        const cell = cellFromPacket(battle);
        if (cell) byNode.set(battle.node, cell);
    }
    for (const route of options.routeNodes ?? []) {
        if (byNode.has(route.node)) continue;
        const cell = cellFromSummary(route);
        if (cell) byNode.set(route.node, cell);
    }
    const order: number[] = [];
    const seen = new Set<number>();
    for (const node of options.routeNodes?.map(route => route.node) ?? row.battles.map(battle => battle.node)) {
        if (seen.has(node) || !byNode.has(node)) continue;
        seen.add(node);
        order.push(node);
    }
    for (const node of byNode.keys()) {
        if (seen.has(node)) continue;
        order.push(node);
    }
    return order.map(node => byNode.get(node)!);
}

function lbasStrikeCells(row: ReplayRow): Map<number, number[]> {
    const byBase = new Map<number, number[]>();
    for (const battle of row.battles) {
        const api = battleApi(battle);
        const waves = api?.api_air_base_attack;
        if (!Array.isArray(waves)) continue;
        for (const wave of waves) {
            const rid = integer(isPlainObject(wave) ? wave.api_base_id : undefined);
            if (rid === undefined || rid < 1 || rid > 3) continue;
            const nodes = byBase.get(rid) ?? [];
            nodes.push(battle.node);
            byBase.set(rid, nodes);
        }
    }
    return byBase;
}

// KanColleImgBuilder：網址 hash 用 encodeURI/decodeURI 這一對（非 encodeURIComponent），
// 見 kancolle-builder.component.ts 的 `JSON.parse(decodeURI(route.fragment))`。
export function imgBuilderUrl(deck: object): string {
    return `https://kancolleimgbuilder.web.app/builder#${encodeURI(JSON.stringify(deck))}`;
}

// 制空権シミュレータ：出擊 predeck 走 hash `#import:`（App.vue setUrlFragments）。
// `?predeck=` 會整段進 HTTP request，GitHub Pages 超過約 8KB 就 414。
export function airCalcUrl(deck: object): string {
    return `${AIR_CALC_PAGE_URL}#import:${encodeURIComponent(JSON.stringify({ predeck: deck }))}`;
}
