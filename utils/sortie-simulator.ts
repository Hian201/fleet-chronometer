// 出擊紀錄 → KC3Kai kancolle-replay simulator 的中間輸入。
//
// 中間物件仍用 simulator 的 fleetF／nodes 語意組裝敵我艦隊與節點旗標，但跳轉網址
// 必須走 `#backup=`（見 sortie-simulator-settings.ts）。直接把 `{ fleetF, nodes }`
// 放進 hash 會呼叫 initSimImport，隱藏編成介面並立刻開跑；`{ fleet1, battles }`
// 的重播匯入與 `#backup=` 才會停在可編輯畫面。#backup= 另能帶補強增設與 subOnly，
// 並用 LZMA 壓進 fragment 上限。這不是 utils/deckbuilder.ts 的 f1～f4 編成卡。
//
// 出擊時的主隊、隨伴、支援與基地航空隊來自 ReplayRow 在 map/start 保存的快照；
// 每個敵艦隊、陣形、夜戰與陸航波次則來自該節點的原始戰鬥封包。沒有快照或封包的
// 欄位保持缺席，不用目前母港狀態補猜歷史資料。
import type {
    ReplayLbasSquadron, ReplayNode, ReplayRow, ReplayShip, ReplaySupportShip,
} from './db';
import { repairLegacyReplayFleet } from './replay';
import { supportUse } from './sortie-detail';

/** KC3Kai simulator 讀取的裝備欄位。 */
export interface SortieSimulatorEquip {
    masterId: number;
    improve?: number;
    proficiency?: number;
}

/** KC3Kai simulator 讀取的艦娘／敵艦欄位。 */
export interface SortieSimulatorShip {
    masterId: number;
    LVL?: number;
    stats?: {
        HP?: number;
        FP?: number;
        TP?: number;
        AA?: number;
        AR?: number;
        EV?: number;
        ASW?: number;
        LOS?: number;
        LUK?: number;
        RNG?: number;
        SPD?: number;
        SLOTS?: number[];
        TACC?: number | null;
        type?: number | string;
    };
    HPInit?: number;
    fuelInit?: number;
    ammoInit?: number;
    morale?: number;
    equips?: SortieSimulatorEquip[];
    /** 0＝stats 不含裝備加成；1＝stats 已含裝備加成。 */
    includesEquipStats?: 0 | 1;
    /** 敵方遠端／不可考 HP 的 simulator 特殊標記。 */
    isFaraway?: boolean;
}

export interface SortieSimulatorFleet {
    ships: SortieSimulatorShip[];
    shipsC?: SortieSimulatorShip[];
    combineType?: number;
    formation?: number;
}

export interface SortieSimulatorLbas {
    slots: number[];
    equips: SortieSimulatorEquip[];
}

export interface SortieSimulatorNode {
    fleetE: SortieSimulatorFleet;
    doNB?: boolean;
    NBOnly?: boolean;
    airOnly?: boolean;
    airRaid?: boolean;
    noAmmo?: boolean;
    formationOverride?: number;
    lbas?: number[];
    useNormalSupport?: boolean;
    /** simulator 不使用的原始 edge id；保留在標準 node 物件中供人查對。 */
    node?: number;
    boss?: boolean;
}

/** 摘要列中的節點，供保存沒有對應戰鬥封包的路線節點。 */
export interface SortieSimulatorRouteNode {
    node: number;
    boss?: boolean;
    kind?: 'battle' | 'raid';
    enemyIds?: number[];
    enemyIdsEscort?: number[];
}

export interface SortieSimulatorOptions {
    /** 只用已載入的 master 艦種辨識純潛水艦節點，不以艦船編號猜艦種。 */
    masterShips?: ReadonlyMap<number, { stype: number }>;
    /** 依出擊摘要判定 boss；沒有傳入時才退回 ReplayNode.boss。 */
    bossNodes?: ReadonlySet<number>;
    /** 完整路線摘要，包含沒有原始戰鬥封包的空襲／未結算節點。 */
    routeNodes?: readonly SortieSimulatorRouteNode[];
}

export interface SortieSimulatorInput {
    fleetF: SortieSimulatorFleet;
    fleetSupportN?: SortieSimulatorFleet;
    fleetSupportB?: SortieSimulatorFleet;
    lbas?: Array<SortieSimulatorLbas | null>;
    nodes: SortieSimulatorNode[];
    /** simulator 會忽略的來源識別欄位；保留出擊海域。 */
    world: number;
    mapnum: number;
    map: string;
    /** 不影響 simulator，保存 simulator 標準欄位無法表達的原始出擊資訊。 */
    fleetChronometer: {
        sortieKey: number;
        routeNodes: SortieSimulatorRouteNode[];
        supportUses: {
            node: number;
            boss: boolean;
            deckId: number;
            kind: 'air' | 'shell' | 'torpedo' | 'asw';
            flag: number;
            shipIds: number[];
        }[];
        lbas: {
            areaId: number;
            rid: number;
            action: number;
            distance: number;
            squadrons: ReplayLbasSquadron[];
        }[];
        lbasWaves: {
            node: number;
            baseId: number;
            planes: { masterId: number; count: number }[];
        }[];
    };
}

/** KC3Kai simulator 直接匯入頁面。 */
export const KC3_SORTIE_SIMULATOR_URL = 'https://kc3kai.github.io/kancolle-replay/simulator.html';
/** URL fragment 過長時改開空白頁並複製 JSON，沿用重播匯出的瀏覽器安全界線。 */
export const KC3_SORTIE_SIMULATOR_DIRECT_URL_LIMIT = 30_000;

type ApiObject = Record<string, any>;

function apiObject(value: unknown): ApiObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const object = value as ApiObject;
    return Object.keys(object).some(key => key.startsWith('api_')) ? object : undefined;
}

function battleApi(entry: ReplayNode): ApiObject {
    return apiObject(entry.data) ?? apiObject(entry.yasen) ?? {};
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function integer(value: unknown): number | undefined {
    const number = finiteNumber(value);
    return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

function arrayAt(value: unknown, index: number): any[] | undefined {
    return Array.isArray(value) && Array.isArray(value[index]) ? value[index] : undefined;
}

function statsFromParam(value: unknown, index: number): NonNullable<SortieSimulatorShip['stats']> {
    const row = arrayAt(value, index);
    if (!row) return {};
    const stats: NonNullable<SortieSimulatorShip['stats']> = {};
    const keys: ('FP' | 'TP' | 'AA' | 'AR')[] = ['FP', 'TP', 'AA', 'AR'];
    keys.forEach((key, i) => {
        const n = finiteNumber(row[i]);
        if (n !== undefined) stats[key] = n;
    });
    return stats;
}

function appendHpStats(stats: NonNullable<SortieSimulatorShip['stats']>, maxHp: unknown): void {
    const hp = finiteNumber(maxHp);
    if (hp !== undefined && hp > 0) stats.HP = hp;
}

function shipEquips(ship: ReplayShip | ReplaySupportShip): SortieSimulatorEquip[] {
    const equips: SortieSimulatorEquip[] = [];
    // 模擬器玩家艦固定 5 一般槽＋第 6 格增設。空槽也要佔位，否則後面的裝備與增設會左移。
    const regular = ship.equip ?? [];
    const regularCount = Math.max(regular.length, 5);
    for (let index = 0; index < regularCount; index++) {
        const masterId = regular[index] ?? -1;
        equips.push({
            masterId: Math.max(0, masterId),
            improve: Math.max(0, ship.stars?.[index] ?? 0),
            proficiency: Math.max(0, ship.ace?.[index] ?? 0),
        });
    }
    // 補強增設不在 stars／ace 陣列裡（與 KC3Kai logger／本專案快照同契約），改讀獨立欄。
    // 快照缺 exstars／exace 時退回 0；來源沒有欄位時不能用現在母港狀態回填歷史。
    if (ship.exequip > 0) {
        equips.push({
            masterId: ship.exequip,
            improve: Math.max(0, ship.exstars ?? 0),
            proficiency: Math.max(0, ship.exace ?? 0),
        });
    }
    return equips;
}

function playerShip(
    ship: ReplayShip | ReplaySupportShip,
    params: unknown,
    index: number,
    includeHp: boolean,
): SortieSimulatorShip {
    const out: SortieSimulatorShip = {
        masterId: ship.mst_id,
        LVL: ship.lv,
        equips: shipEquips(ship),
    };
    const stats = statsFromParam(params, index);
    if (includeHp) appendHpStats(stats, ship.maxhp);
    if (Object.keys(stats).length) {
        out.stats = stats;
        // api_fParam 是 simulator 的 statsBase；裝備加成由 simulator 依 equips 加上。
        if (Object.keys(stats).some(key => ['FP', 'TP', 'AA', 'AR'].includes(key))) out.includesEquipStats = 0;
    }
    if (includeHp && finiteNumber(ship.nowhp) !== undefined) out.HPInit = ship.nowhp;
    if (ship.cond !== undefined) out.morale = ship.cond;
    return out;
}

function supportFleet(row: ReplayRow, deckId: number): SortieSimulatorFleet | undefined {
    const ships = deckId === 3 ? row.fleet3 : deckId === 4 ? row.fleet4 : undefined;
    if (!ships?.length) return undefined;
    return { ships: ships.map((ship, index) => playerShip(ship, undefined, index, false)), combineType: 0 };
}

/** simulator 的事件海域敵艦 master id 與 KC3Kai 轉換器相同。 */
function simulatorEnemyShipId(mst: number, world: number): number {
    return world !== 0 && world !== 1 && mst < 1000 ? mst + 1000 : mst;
}

/** start2 的艦種表用封包原 id；simulator 可能已 +1000，兩邊都查才不漏潛艦點。 */
function masterStype(
    id: number,
    master?: ReadonlyMap<number, { stype: number }>,
): number | undefined {
    if (!master) return undefined;
    return master.get(id)?.stype
        ?? (id >= 1000 ? master.get(id - 1000)?.stype : undefined)
        ?? master.get(id + 1000)?.stype;
}

function isSubmarineStype(stype: number | undefined): boolean {
    return stype === 13 || stype === 14;
}

function isSubOnlyEnemy(
    api: ApiObject,
    world: number,
    master?: ReadonlyMap<number, { stype: number }>,
): boolean {
    const main = Array.isArray(api.api_ship_ke) ? api.api_ship_ke : [];
    const escort = Array.isArray(api.api_ship_ke_combined) ? api.api_ship_ke_combined : [];
    const mainIds = main.map(integer).filter((id): id is number => id !== undefined && id > 0);
    if (!mainIds.length) return false;
    if (escort.map(integer).some(id => id !== undefined && id > 0)) return false;
    return mainIds.every(id => isSubmarineStype(
        masterStype(id, master) ?? masterStype(simulatorEnemyShipId(id, world), master),
    ));
}

/** simulator 的 abyssal 裝備 id 轉換與 KC3Kai 公開轉換器相同。 */
function simulatorEnemyEquipId(mst: number, enemyShipId: number): number {
    return enemyShipId >= 1000 && mst > 500 && mst < 1000 ? mst + 1000 : mst;
}

function enemyShips(
    api: ApiObject,
    world: number,
    idKey: 'api_ship_ke' | 'api_ship_ke_combined',
    lvKey: 'api_ship_lv' | 'api_ship_lv_combined',
    hpKey: 'api_e_maxhps' | 'api_e_maxhps_combined',
    paramKey: 'api_eParam' | 'api_eParam_combined',
    slotKey: 'api_eSlot' | 'api_eSlot_combined',
): SortieSimulatorShip[] {
    const ids = Array.isArray(api[idKey]) ? api[idKey] : [];
    const levels = api[lvKey];
    const rawHps = api[hpKey];
    const fallbackHpsKey = hpKey === 'api_e_maxhps_combined' ? 'api_maxhps_combined' : 'api_maxhps';
    const fallbackHps = api[fallbackHpsKey];
    // 舊封包有時把敵我 HP 合併放在 api_maxhps；切片位置依 KC3Kai 公開轉換器的契約。
    const hps = Array.isArray(rawHps)
        ? rawHps
        : Array.isArray(fallbackHps)
            ? fallbackHps.slice(6 + (fallbackHps[0] === -1 ? 1 : 0))
            : undefined;
    const params = api[paramKey];
    const slots = api[slotKey];
    const ships: SortieSimulatorShip[] = [];
    ids.forEach((rawId: unknown, index: number) => {
        const sourceId = integer(rawId);
        if (sourceId === undefined || sourceId <= 0) return;
        const masterId = simulatorEnemyShipId(sourceId, world);
        const ship: SortieSimulatorShip = { masterId, equips: [] };
        const level = finiteNumber(Array.isArray(levels) ? levels[index] : undefined);
        if (level !== undefined) ship.LVL = level;
        const stats = statsFromParam(params, index);
        appendHpStats(stats, Array.isArray(hps) ? hps[index] : undefined);
        if (Object.keys(stats).length) {
            ship.stats = stats;
            if (Object.keys(stats).some(key => ['FP', 'TP', 'AA', 'AR'].includes(key))) ship.includesEquipStats = 0;
        }
        const hp = finiteNumber(Array.isArray(hps) ? hps[index] : undefined);
        if (hp !== undefined && hp > 0) ship.HPInit = hp;
        if (Array.isArray(hps) && hps[index] === 'N/A') ship.isFaraway = true;
        if (Array.isArray(slots) && Array.isArray(slots[index])) {
            ship.equips = slots[index]
                .map((rawEquip: unknown) => integer(rawEquip))
                .filter((equip): equip is number => equip !== undefined && equip > 0)
                .map(equip => ({ masterId: simulatorEnemyEquipId(equip, masterId), improve: 0, proficiency: 0 }));
        }
        ships.push(ship);
    });
    return ships;
}

function formationAt(api: ApiObject, index: number): number | undefined {
    return Array.isArray(api.api_formation) ? integer(api.api_formation[index]) : undefined;
}

function supportUses(row: ReplayRow, bossNodes: ReadonlySet<number>): {
    node: number;
    boss: boolean;
    deckId: number;
    kind: 'air' | 'shell' | 'torpedo' | 'asw';
    flag: number;
    shipIds: number[];
}[] {
    return row.battles.flatMap(entry => {
        const use = supportUse(battleApi(entry));
        if (!use) return [];
        return [{ node: entry.node, boss: bossNodes.has(entry.node) || entry.boss === true, ...use }];
    });
}

function lbasWaveRows(api: ApiObject, node: number): SortieSimulatorInput['fleetChronometer']['lbasWaves'] {
    if (!Array.isArray(api.api_air_base_attack)) return [];
    return api.api_air_base_attack.flatMap((rawWave: any) => {
        if (!rawWave || typeof rawWave !== 'object') return [];
        const planes = Array.isArray(rawWave.api_squadron_plane)
            ? rawWave.api_squadron_plane.flatMap((rawPlane: any) => {
                const masterId = integer(rawPlane?.api_mst_id);
                if (masterId === undefined || masterId <= 0) return [];
                return [{ masterId, count: finiteNumber(rawPlane?.api_count) ?? 0 }];
            })
            : [];
        return [{ node, baseId: integer(rawWave.api_base_id) ?? 0, planes }];
    });
}

function lbasNodeIds(api: ApiObject): number[] {
    if (!Array.isArray(api.api_air_base_attack)) return [];
    return api.api_air_base_attack
        .map((wave: any) => integer(wave?.api_base_id))
        .filter((id: number | undefined): id is number => id !== undefined && id >= 1 && id <= 3);
}

function simulatorLbas(row: ReplayRow): Array<SortieSimulatorLbas | null> | undefined {
    if (!row.lbas?.length) return undefined;
    const out: Array<SortieSimulatorLbas | null> = [null, null, null];
    for (const base of row.lbas) {
        if (!Number.isInteger(base.rid) || base.rid < 1 || base.rid > 3) continue;
        const active = base.squadrons.filter(squadron => squadron.state === 1 && squadron.mst > 0);
        if (!active.length) continue;
        out[base.rid - 1] = {
            // simulator 的 slots 同時是開始時的機數與中隊容量；count 才是出擊當下的事實。
            slots: active.map(squadron => Math.max(0, squadron.count)),
            equips: active.map(squadron => ({
                masterId: squadron.mst,
                improve: Math.max(0, squadron.stars),
                proficiency: Math.max(0, squadron.ace),
            })),
        };
    }
    return out.some(base => base !== null) ? out : undefined;
}

function routeNodesFrom(options: SortieSimulatorOptions, row: ReplayRow): SortieSimulatorRouteNode[] {
    if (options.routeNodes) {
        return options.routeNodes.map(node => ({
            node: node.node,
            ...(node.boss === undefined ? {} : { boss: node.boss }),
            ...(node.kind === undefined ? {} : { kind: node.kind }),
            ...(node.enemyIds === undefined ? {} : { enemyIds: [...node.enemyIds] }),
            ...(node.enemyIdsEscort === undefined ? {} : { enemyIdsEscort: [...node.enemyIdsEscort] }),
        }));
    }
    return row.battles.map(entry => ({ node: entry.node, ...(entry.boss === undefined ? {} : { boss: entry.boss }) }));
}

function nodeFlags(api: ApiObject, hasDay: boolean, hasNight: boolean): Pick<SortieSimulatorNode, 'doNB' | 'NBOnly' | 'airOnly' | 'airRaid'> {
    const flags: Pick<SortieSimulatorNode, 'doNB' | 'NBOnly' | 'airOnly' | 'airRaid'> = {};
    if (hasNight) flags.doNB = true;
    if (!hasDay && hasNight) flags.NBOnly = true;
    if (api.api_kouku2 !== undefined) flags.airOnly = true;
    const name = typeof api.api_name === 'string' ? api.api_name : '';
    if (name.includes('ld_airbattle') || (!name && api.api_opening_atack === undefined
        && api.api_kouku2 === undefined && api.api_n_support_flag === undefined)) {
        flags.airRaid = true;
    }
    return flags;
}

export function buildSortieSimulator(row: ReplayRow, options: SortieSimulatorOptions = {}): SortieSimulatorInput {
    row = repairLegacyReplayFleet(row);
    const bossNodes = options.bossNodes ?? new Set(row.battles.filter(entry => entry.boss).map(entry => entry.node));
    const firstApi = row.battles.map(battleApi).find(api => Object.keys(api).length > 0) ?? {};
    const firstEscortParams = row.battles.map(battleApi)
        .find(api => Array.isArray(api.api_fParam_combined))?.api_fParam_combined;
    const mainParams = firstApi.api_fParam;
    const fleetF: SortieSimulatorFleet = {
        combineType: row.combined,
        ships: row.fleet1.map((ship, index) => playerShip(ship, mainParams, index, true)),
    };
    const firstFormation = formationAt(firstApi, 0);
    if (firstFormation !== undefined) fleetF.formation = firstFormation;
    if (row.combined > 0 && row.fleet2.length) {
        fleetF.shipsC = row.fleet2.map((ship, index) => playerShip(ship, firstEscortParams, index, true));
    }

    const uses = supportUses(row, bossNodes);
    const normalUse = uses.find(use => !use.boss && (use.deckId === 3 || use.deckId === 4));
    const bossUse = uses.find(use => use.boss && (use.deckId === 3 || use.deckId === 4));
    const normalFleet = normalUse ? supportFleet(row, normalUse.deckId) : undefined;
    const bossFleet = bossUse ? supportFleet(row, bossUse.deckId) : undefined;
    const standardLbas = simulatorLbas(row);
    const standardNodes: SortieSimulatorNode[] = row.battles.map((entry, index) => {
        const api = battleApi(entry);
        const hasDay = !!apiObject(entry.data);
        const hasNight = !!apiObject(entry.yasen);
        const enemyMain = enemyShips(api, row.world, 'api_ship_ke', 'api_ship_lv', 'api_e_maxhps', 'api_eParam', 'api_eSlot');
        const enemyEscort = enemyShips(api, row.world, 'api_ship_ke_combined', 'api_ship_lv_combined', 'api_e_maxhps_combined', 'api_eParam_combined', 'api_eSlot_combined');
        const fleetE: SortieSimulatorFleet = { ships: enemyMain };
        if (enemyEscort.length) fleetE.shipsC = enemyEscort;
        const node: SortieSimulatorNode = {
            fleetE,
            ...nodeFlags(api, hasDay, hasNight),
            node: entry.node,
        };
        if (!enemyMain.some(ship => ship.isFaraway) && isSubOnlyEnemy(api, row.world, options.masterShips)) {
            node.noAmmo = true;
        }
        const playerFormation = formationAt(api, 0);
        if (playerFormation !== undefined) node.formationOverride = playerFormation;
        const enemyFormation = formationAt(api, 1);
        if (enemyFormation !== undefined) fleetE.formation = enemyFormation;
        const lbas = lbasNodeIds(api);
        if (lbas.length) node.lbas = lbas;
        const use = uses.find(candidate => candidate.node === entry.node);
        if (use && index === row.battles.length - 1 && !use.boss
            && normalUse?.deckId === use.deckId) {
            node.useNormalSupport = true;
        }
        if (bossNodes.has(entry.node) || entry.boss === true) node.boss = true;
        return node;
    });

    const lbasWaves = row.battles.flatMap(entry => lbasWaveRows(battleApi(entry), entry.node));
    const routeNodes = routeNodesFrom(options, row);
    return {
        fleetF,
        ...(normalFleet ? { fleetSupportN: normalFleet } : {}),
        ...(bossFleet ? { fleetSupportB: bossFleet } : {}),
        ...(standardLbas ? { lbas: standardLbas } : {}),
        nodes: standardNodes,
        world: row.world,
        mapnum: row.mapnum,
        map: `${row.world}-${row.mapnum}`,
        fleetChronometer: {
            sortieKey: row.sortieKey,
            routeNodes,
            supportUses: uses,
            lbas: (row.lbas ?? []).map(base => ({
                areaId: base.areaId, rid: base.rid, action: base.action, distance: base.distance,
                squadrons: base.squadrons.map(squadron => ({ ...squadron })),
            })),
            lbasWaves,
        },
    };
}

export function toSortieSimulatorUrl(row: ReplayRow, options: SortieSimulatorOptions = {}): string {
    return `${KC3_SORTIE_SIMULATOR_URL}#${encodeURIComponent(JSON.stringify(buildSortieSimulator(row, options)))}`;
}

