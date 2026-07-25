// 可攜式備份格式與還原核心。此檔刻意不依賴 DOM，讓格式邊界與 Dexie transaction
// 可用 fake-indexeddb 獨立測試；overview 的 backup 分區只負責檔案與畫面互動。
import type {
    BackupRestoreMetaRow, DatabaseMetaRow, EventPlanRow, ExpeditionRow, FactoryLogRow, KcDb,
    ReplayRow, ReplayShip, ReplaySupportShip, ResourceMarkRow, ResourceRow, ShipObtainedRow,
    SnapshotRow, SortieLogRow, WantedRow,
} from './db';

// v4 在 restore envelope 新增 eventPlans（活動作戰板）。
// v5 再新增 resources／resourceMarks（資源紀錄的時間序列與活動特殊時間點）——這兩張表
// **不可能重新產生**（餘額歷史只存在於當初收到的封包裡，events 早被裁剪），不進備份等於
// 每次重裝就歸零，那份序列的價值正是長期連續，故必須帶。
// v1 legacy-full／v2 split／v3／v4 仍可匯入——`determineKind()` 依 schemaVersion 決定
// 該版的 restore 表組合，故舊檔不會因為缺少後來新增的表而被拒。
export const BACKUP_SCHEMA_VERSION = 5 as const;

export type BackupKind = 'restore' | 'replays' | 'legacy-full';
type ExportedKind = Exclude<BackupKind, 'legacy-full'>;

export interface BackupTables {
    snapshot?: SnapshotRow[];
    sorties?: SortieLogRow[];
    expeditions?: ExpeditionRow[];
    factory?: FactoryLogRow[];
    replays?: ReplayRow[];
    wanted?: WantedRow[];
    shipObtained?: ShipObtainedRow[];
    eventPlans?: EventPlanRow[];
    resources?: ResourceRow[];
    resourceMarks?: ResourceMarkRow[];
}

export interface BackupEnvelope {
    schemaVersion: number;
    // v1 沒有 kind；早期手動檔案若使用 full 也視為同一種 legacy-full。
    kind?: ExportedKind | 'full';
    exportedAt: number;
    tables: BackupTables;
}

export interface ValidatedBackupEnvelope extends Omit<BackupEnvelope, 'kind'> {
    kind: BackupKind;
}

export class BackupValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackupValidationError';
    }
}

// destination preflight 拒絕與備份格式錯誤必須能由 UI 明確分流；拒絕時 transaction
// 尚未寫入任何使用者資料，既有資料與 event key generator 都保持原樣。
export class BackupDestinationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackupDestinationError';
    }
}

// 一個 restore/replays 拆檔最多各匯入一次，兩次 transaction 都會用一個 auto-generated
// guard 驗證 generator rollback，之後還要保留至少一個 safe integer 給真正 ingestion。
export const MAX_RESTORABLE_SOURCE_EVENT_ID = Number.MAX_SAFE_INTEGER - 2;
const BACKUP_RESTORE_META_KEY = 'backup-restore' as const;
// 純顯示偏好（遊戲頁靜音／語言鏡像），不影響還原語意，故不算「來源不明的既有資料」。
const GAME_PAGE_META_KEY = 'game-page' as const;

type UnknownRecord = Record<string, unknown>;
const TABLE_NAMES = [
    'snapshot', 'sorties', 'expeditions', 'factory', 'replays', 'wanted', 'shipObtained',
    'eventPlans', 'resources', 'resourceMarks',
] as const;

function invalid(message: string): never {
    throw new BackupValidationError(message);
}

function destinationInvalid(message: string): never {
    throw new BackupDestinationError(message);
}

function isPlainObject(value: unknown): value is UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function objectAt(value: unknown, where: string): UnknownRecord {
    if (!isPlainObject(value)) invalid(`${where} 必須是一般物件。`);
    return value;
}

function nonEmptyString(value: unknown, where: string): string {
    if (typeof value !== 'string' || value.trim() === '') invalid(`${where} 必須是非空字串。`);
    return value;
}

function stringValue(value: unknown, where: string): string {
    if (typeof value !== 'string') invalid(`${where} 必須是字串。`);
    return value;
}

function integer(value: unknown, where: string, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        invalid(`${where} 必須是 ${minimum} 以上的安全整數。`);
    }
    return value;
}

function finiteNumber(value: unknown, where: string, minimum = 0): number {
    if (typeof value !== 'number') invalid(`${where} 必須是 ${minimum} 以上的有限數值。`);
    if (!Number.isFinite(value) || value < minimum) {
        invalid(`${where} 必須是 ${minimum} 以上的有限數值。`);
    }
    return value;
}

// 匯出一律寫毫秒數字；匯入也接受標準 ISO 8601 字串，並正規化成 DB 使用的毫秒數字。
function timestamp(value: unknown, where: string): number {
    if (typeof value === 'number') return finiteNumber(value, where);
    if (typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    invalid(`${where} 必須是有限的毫秒時間戳或 ISO 8601 UTC 字串。`);
}

function optionalTimestamp(value: unknown, where: string): number | undefined {
    return value === undefined ? undefined : timestamp(value, where);
}

function booleanValue(value: unknown, where: string): boolean {
    if (typeof value !== 'boolean') invalid(`${where} 必須是布林值。`);
    return value;
}

function arrayAt(value: unknown, where: string): unknown[] {
    if (!Array.isArray(value)) invalid(`${where} 必須是陣列。`);
    return value;
}

function numberArray(value: unknown, where: string, minimum = 0): number[] {
    return arrayAt(value, where).map((entry, index) => finiteNumber(entry, `${where}[${index}]`, minimum));
}

function optionalPositiveInteger(row: UnknownRecord, key: string, where: string): number | undefined {
    return row[key] === undefined ? undefined : integer(row[key], `${where}.${key}`, 1);
}

function optionalBoolean(row: UnknownRecord, key: string, where: string): boolean | undefined {
    return row[key] === undefined ? undefined : booleanValue(row[key], `${where}.${key}`);
}

function safeRequest(value: unknown, where: string): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    const request = objectAt(value, where);
    for (const [key, entry] of Object.entries(request)) {
        if (key === 'api_token' || key === 'api_verno') invalid(`${where} 不得含有 ${key}。`);
        if (typeof entry !== 'string') invalid(`${where}.${key} 必須是字串。`);
    }
    return request as Record<string, string>;
}

// api 的內容不解讀也不改寫，但 token 不落地是全域硬限制：即使 token 被塞在非預期的
// unknown 欄位或 raw api 內，也不能讓它通過備份邊界。
function assertNoApiToken(value: unknown, visited = new WeakSet<object>()): void {
    if (value === null || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
        for (const entry of value) assertNoApiToken(entry, visited);
        return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, entry] of Object.entries(value)) {
        if (key === 'api_token') invalid('備份資料不得含有 api_token。');
        assertNoApiToken(entry, visited);
    }
}

// ── 逐列驗證 ────────────────────────────────────────────────────────────────
// **每個 validateXxx 一律逐欄組出新物件，絕不 `...row` 把未列舉的鍵放行**：備份檔是
// 使用者可以任意編輯的外部輸入，spread 等於讓任何鍵原封不動寫進 IndexedDB，之後被
// 各分區當成自家欄位讀取（例如 UI 對字串欄位呼叫 esc() 會因為拿到物件而整區掛掉）。
// 多餘鍵一律丟棄；已列舉欄位型別不符則整列拒絕（丟 BackupValidationError，整批 rollback）。
// 新增 DB 欄位時**必須同步加進這裡**，否則往返會靜默掉欄位。
function validateSnapshot(value: unknown, index: number): SnapshotRow {
    const where = `tables.snapshot[${index}]`;
    const row = objectAt(value, where);
    return {
        path: nonEmptyString(row.path, `${where}.path`),
        ts: timestamp(row.ts, `${where}.ts`),
        // api 是不解讀的原始封包內容，維持 opaque（token 已由 assertNoApiToken 全域擋下）。
        api: row.api,
        ...(row.req === undefined ? {} : { req: safeRequest(row.req, `${where}.req`) }),
        ...(row.eventId === undefined ? {} : { eventId: integer(row.eventId, `${where}.eventId`, 1) }),
    };
}

function validateSortie(value: unknown, index: number): SortieLogRow {
    const where = `tables.sorties[${index}]`;
    const row = objectAt(value, where);
    const seiku = row.seiku === null ? null : integer(row.seiku, `${where}.seiku`);
    const drop = row.drop === null ? null : nonEmptyString(row.drop, `${where}.drop`);
    if (row.kind !== 'battle' && row.kind !== 'raid') invalid(`${where}.kind 必須是 battle 或 raid。`);
    return {
        eventId: integer(row.eventId, `${where}.eventId`, 1),
        sortieKey: integer(row.sortieKey, `${where}.sortieKey`, 1),
        ts: timestamp(row.ts, `${where}.ts`),
        map: nonEmptyString(row.map, `${where}.map`),
        node: integer(row.node, `${where}.node`),
        boss: booleanValue(row.boss, `${where}.boss`),
        kind: row.kind,
        rank: stringValue(row.rank, `${where}.rank`),
        seiku,
        enemyIds: numberArray(row.enemyIds, `${where}.enemyIds`, 0),
        enemyIdsEscort: numberArray(row.enemyIdsEscort, `${where}.enemyIdsEscort`, 0),
        drop,
        taiha: booleanValue(row.taiha, `${where}.taiha`),
        ...(row.dropMst === undefined ? {} : { dropMst: integer(row.dropMst, `${where}.dropMst`, 1) }),
        ...(row.raidLostKind === undefined ? {} : { raidLostKind: integer(row.raidLostKind, `${where}.raidLostKind`) }),
        ...(row.cleared === undefined ? {} : { cleared: booleanValue(row.cleared, `${where}.cleared`) }),
        // battleresult 追加欄位（2026-07-22）：舊備份沒有這些鍵，缺席即維持缺席，不補預設值。
        ...(row.getExp === undefined ? {} : { getExp: integer(row.getExp, `${where}.getExp`, 0) }),
        ...(row.mvp === undefined ? {} : { mvp: integer(row.mvp, `${where}.mvp`, 1) }),
        ...(row.mvpEscort === undefined ? {} : { mvpEscort: integer(row.mvpEscort, `${where}.mvpEscort`, 1) }),
        ...(row.enemyName === undefined ? {} : { enemyName: nonEmptyString(row.enemyName, `${where}.enemyName`) }),
        ...(row.baseExp === undefined ? {} : { baseExp: integer(row.baseExp, `${where}.baseExp`, 0) }),
        ...(row.nodeEventId === undefined ? {} : { nodeEventId: integer(row.nodeEventId, `${where}.nodeEventId`, 0) }),
        ...(row.nodeEventKind === undefined ? {} : { nodeEventKind: integer(row.nodeEventKind, `${where}.nodeEventKind`, 0) }),
        // CSV 匯入的來源標記（utils/drop-log-import.ts）。本機擷取的列一律缺席，不是 false。
        ...(row.imported === undefined ? {} : { imported: booleanValue(row.imported, `${where}.imported`) }),
    };
}

function validateFactory(value: unknown, index: number): FactoryLogRow {
    const where = `tables.factory[${index}]`;
    const row = objectAt(value, where);
    const kinds: FactoryLogRow['kind'][] = ['develop', 'build', 'improve', 'speedup'];
    const kind = kinds.find(name => name === row.kind);
    if (!kind) invalid(`${where}.kind 不支援。`);
    const resultRows = row.results === undefined ? undefined : arrayAt(row.results, `${where}.results`).map((entry, resultIndex) => {
        const result = objectAt(entry, `${where}.results[${resultIndex}]`);
        return { mst: integer(result.mst, `${where}.results[${resultIndex}].mst`, -1) };
    });
    return {
        // 多渠同時建造時現行 projector 會以 eventId + kdockId / 1000 區分同一 raw event，
        // 因此 factory 的主鍵必須接受正的有限小數，不能誤限為整數。
        eventId: finiteNumber(row.eventId, `${where}.eventId`, 1),
        ts: timestamp(row.ts, `${where}.ts`),
        kind,
        used: numberArray(row.used, `${where}.used`, 0),
        secretary: integer(row.secretary, `${where}.secretary`, 0),
        // CSV 匯入可能只給到 0（來源沒有司令部等級欄），故下限是 0 而非 1。
        ...(row.hqLv === undefined ? {} : { hqLv: integer(row.hqLv, `${where}.hqLv`, 0) }),
        ...(resultRows === undefined ? {} : { results: resultRows }),
        ...(optionalPositiveInteger(row, 'shipMst', where) === undefined ? {} : { shipMst: optionalPositiveInteger(row, 'shipMst', where) }),
        ...(optionalPositiveInteger(row, 'kdockId', where) === undefined ? {} : { kdockId: optionalPositiveInteger(row, 'kdockId', where) }),
        ...(optionalPositiveInteger(row, 'gearMst', where) === undefined ? {} : { gearMst: optionalPositiveInteger(row, 'gearMst', where) }),
        ...(row.levelBefore === undefined ? {} : { levelBefore: integer(row.levelBefore, `${where}.levelBefore`) }),
        ...(row.levelAfter === undefined ? {} : { levelAfter: integer(row.levelAfter, `${where}.levelAfter`) }),
        ...(optionalBoolean(row, 'success', where) === undefined ? {} : { success: optionalBoolean(row, 'success', where) }),
        ...(optionalBoolean(row, 'certain', where) === undefined ? {} : { certain: optionalBoolean(row, 'certain', where) }),
        // CSV 匯入標記與備援顯示名。**這三欄一定要驗型別**：建造紀錄分區把兩個名字直接
        // 當字串餵給 esc()，放行物件／數字會讓整個分區在渲染時炸掉。
        ...(row.imported === undefined ? {} : { imported: booleanValue(row.imported, `${where}.imported`) }),
        ...(row.importedShipName === undefined ? {} : {
            importedShipName: stringValue(row.importedShipName, `${where}.importedShipName`),
        }),
        ...(row.importedSecretaryName === undefined ? {} : {
            importedSecretaryName: stringValue(row.importedSecretaryName, `${where}.importedSecretaryName`),
        }),
    };
}

// 主隊／隨伴一定有 HP；支援艦隊（KC3Kai logger 的第 3／4 艦隊快照）本來就沒有，
// 故以 overload 表達兩種回傳型別，缺席不得用 0 假裝（見 ReplaySupportShip 註解）。
function validateReplayShip(value: unknown, where: string): ReplayShip;
function validateReplayShip(value: unknown, where: string, support: true): ReplaySupportShip;
function validateReplayShip(value: unknown, where: string, support = false): ReplaySupportShip {
    const ship = objectAt(value, where);
    const nowhp = support && ship.nowhp === undefined
        ? undefined : finiteNumber(ship.nowhp, `${where}.nowhp`, 0);
    const maxhp = support && ship.maxhp === undefined
        ? undefined : finiteNumber(ship.maxhp, `${where}.maxhp`, 1);
    if ((nowhp === undefined) !== (maxhp === undefined)) {
        invalid(`${where}.nowhp 與 ${where}.maxhp 必須同時存在或同時缺席。`);
    }
    if (nowhp !== undefined && maxhp !== undefined && nowhp > maxhp) {
        invalid(`${where}.nowhp 不得大於 maxhp。`);
    }
    return {
        mst_id: integer(ship.mst_id, `${where}.mst_id`, 1),
        lv: integer(ship.lv, `${where}.lv`, 1),
        equip: numberArray(ship.equip, `${where}.equip`, -1),
        stars: numberArray(ship.stars, `${where}.stars`, 0),
        // KC3Kai 以 -1 表示沒有熟練度（兩份既有 logger fixture 都有此值）。
        ace: numberArray(ship.ace, `${where}.ace`, -1),
        exequip: integer(ship.exequip, `${where}.exequip`, -1),
        ...(nowhp === undefined ? {} : { nowhp }),
        ...(maxhp === undefined ? {} : { maxhp }),
        // Fleet Chronometer 的 toKc3Replay() 沒有 cond；缺席保持缺席，不用 0 假裝赤疲勞。
        ...(ship.cond === undefined ? {} : { cond: finiteNumber(ship.cond, `${where}.cond`, 0) }),
        ...(ship.kyouka === undefined ? {} : { kyouka: numberArray(ship.kyouka, `${where}.kyouka`, 0) }),
    };
}

function validateReplay(value: unknown, index: number): ReplayRow {
    const where = `tables.replays[${index}]`;
    const row = objectAt(value, where);
    const battles = arrayAt(row.battles, `${where}.battles`).map((entry, battleIndex) => {
        const battleWhere = `${where}.battles[${battleIndex}]`;
        const battle = objectAt(entry, battleWhere);
        return {
            node: integer(battle.node, `${battleWhere}.node`),
            // data/yasen 是已驗證格式外的原始內容，維持 opaque，不嘗試解讀或改寫。
            data: battle.data,
            ...(battle.yasen === undefined ? {} : { yasen: battle.yasen }),
            ...(battle.rank === undefined ? {} : { rank: stringValue(battle.rank, `${battleWhere}.rank`) }),
            // 單場 JSON 匯入（KC3Kai logger）帶的逐節點結算欄位，見 ReplayNode 註解。
            ...(battle.dropMst === undefined ? {} : { dropMst: integer(battle.dropMst, `${battleWhere}.dropMst`, 1) }),
            ...(battle.mvp === undefined ? {} : { mvp: integer(battle.mvp, `${battleWhere}.mvp`, 1) }),
            ...(battle.mvpEscort === undefined ? {} : { mvpEscort: integer(battle.mvpEscort, `${battleWhere}.mvpEscort`, 1) }),
            ...(battle.getExp === undefined ? {} : { getExp: integer(battle.getExp, `${battleWhere}.getExp`, 0) }),
            ...(battle.baseExp === undefined ? {} : { baseExp: integer(battle.baseExp, `${battleWhere}.baseExp`, 0) }),
            ...(battle.boss === undefined ? {} : { boss: booleanValue(battle.boss, `${battleWhere}.boss`) }),
        };
    });
    return {
        sortieKey: integer(row.sortieKey, `${where}.sortieKey`, 1),
        ts: timestamp(row.ts, `${where}.ts`),
        world: integer(row.world, `${where}.world`),
        mapnum: integer(row.mapnum, `${where}.mapnum`),
        diff: integer(row.diff, `${where}.diff`),
        combined: integer(row.combined, `${where}.combined`),
        fleetnum: integer(row.fleetnum, `${where}.fleetnum`, 1),
        fleet1: arrayAt(row.fleet1, `${where}.fleet1`).map((ship, shipIndex) => validateReplayShip(ship, `${where}.fleet1[${shipIndex}]`)),
        fleet2: arrayAt(row.fleet2, `${where}.fleet2`).map((ship, shipIndex) => validateReplayShip(ship, `${where}.fleet2[${shipIndex}]`)),
        // 支援艦隊候補與基地航空隊快照（2026-07-22 新增）：舊備份沒有這些鍵，缺席即維持缺席。
        ...(row.fleet3 === undefined ? {} : {
            fleet3: arrayAt(row.fleet3, `${where}.fleet3`).map((ship, i) => validateReplayShip(ship, `${where}.fleet3[${i}]`, true)),
        }),
        ...(row.fleet4 === undefined ? {} : {
            fleet4: arrayAt(row.fleet4, `${where}.fleet4`).map((ship, i) => validateReplayShip(ship, `${where}.fleet4[${i}]`, true)),
        }),
        ...(row.lbas === undefined ? {} : {
            lbas: arrayAt(row.lbas, `${where}.lbas`).map((entry, i) => {
                const baseWhere = `${where}.lbas[${i}]`;
                const base = objectAt(entry, baseWhere);
                return {
                    areaId: integer(base.areaId, `${baseWhere}.areaId`, 0),
                    rid: integer(base.rid, `${baseWhere}.rid`, 1),
                    action: integer(base.action, `${baseWhere}.action`, 0),
                    distance: integer(base.distance, `${baseWhere}.distance`, 0),
                    squadrons: arrayAt(base.squadrons, `${baseWhere}.squadrons`).map((sq, j) => {
                        const sqWhere = `${baseWhere}.squadrons[${j}]`;
                        const squadron = objectAt(sq, sqWhere);
                        return {
                            mst: integer(squadron.mst, `${sqWhere}.mst`, 0),
                            count: integer(squadron.count, `${sqWhere}.count`, 0),
                            maxCount: integer(squadron.maxCount, `${sqWhere}.maxCount`, 0),
                            stars: integer(squadron.stars, `${sqWhere}.stars`, 0),
                            ace: integer(squadron.ace, `${sqWhere}.ace`, -1),
                            state: integer(squadron.state, `${sqWhere}.state`, 0),
                            cond: integer(squadron.cond, `${sqWhere}.cond`, 0),
                        };
                    }),
                };
            }),
        }),
        battles,
        ...(row.hqLv === undefined ? {} : { hqLv: integer(row.hqLv, `${where}.hqLv`, 1) }),
        ...(row.nickname === undefined ? {} : { nickname: nonEmptyString(row.nickname, `${where}.nickname`) }),
        ...(row.pinned === undefined ? {} : { pinned: booleanValue(row.pinned, `${where}.pinned`) }),
        ...(row.imported === undefined ? {} : { imported: booleanValue(row.imported, `${where}.imported`) }),
    };
}

function validateExpedition(value: unknown, index: number): ExpeditionRow {
    const where = `tables.expeditions[${index}]`;
    const row = objectAt(value, where);
    const items = arrayAt(row.items, `${where}.items`).map((entry, itemIndex) => {
        const item = objectAt(entry, `${where}.items[${itemIndex}]`);
        return {
            id: integer(item.id, `${where}.items[${itemIndex}].id`, 1),
            count: integer(item.count, `${where}.items[${itemIndex}].count`, 0),
        };
    });
    const fleet = row.fleet === undefined ? undefined : arrayAt(row.fleet, `${where}.fleet`).map((entry, fleetIndex) => {
        const ship = objectAt(entry, `${where}.fleet[${fleetIndex}]`);
        return {
            name: nonEmptyString(ship.name, `${where}.fleet[${fleetIndex}].name`),
            level: integer(ship.level, `${where}.fleet[${fleetIndex}].level`, 1),
        };
    });
    return {
        eventId: integer(row.eventId, `${where}.eventId`, 1),
        ts: timestamp(row.ts, `${where}.ts`),
        deckId: integer(row.deckId, `${where}.deckId`, 0),
        missionId: integer(row.missionId, `${where}.missionId`, 0),
        name: stringValue(row.name, `${where}.name`),
        result: integer(row.result, `${where}.result`, 0),
        resources: numberArray(row.resources, `${where}.resources`, 0),
        items,
        ...(fleet === undefined ? {} : { fleet }),
    };
}

function validateWanted(value: unknown, index: number): WantedRow {
    const where = `tables.wanted[${index}]`;
    const row = objectAt(value, where);
    return {
        ...(row.id === undefined ? {} : { id: integer(row.id, `${where}.id`, 1) }),
        eventId: integer(row.eventId, `${where}.eventId`, 1),
        tag: nonEmptyString(row.tag, `${where}.tag`),
        ts: timestamp(row.ts, `${where}.ts`),
        path: nonEmptyString(row.path, `${where}.path`),
    };
}

function validateShipObtained(value: unknown, index: number): ShipObtainedRow {
    const where = `tables.shipObtained[${index}]`;
    const row = objectAt(value, where);
    const sources: ShipObtainedRow['source'][] = ['auto', 'manual', null];
    if (!sources.includes(row.source as ShipObtainedRow['source'])) {
        invalid(`${where}.source 必須是 auto、manual 或 null。`);
    }
    return {
        id: integer(row.id, `${where}.id`, 1),
        mst: integer(row.mst, `${where}.mst`, 1),
        obtainedTs: row.obtainedTs === null ? null : timestamp(row.obtainedTs, `${where}.obtainedTs`),
        source: row.source as ShipObtainedRow['source'],
        ...(row.observedEventId === undefined ? {} : { observedEventId: integer(row.observedEventId, `${where}.observedEventId`, 1) }),
    };
}

// 活動作戰板：**純使用者手輸資料**（標籤名、關卡的標籤約束、編成），不參照任何 event id，
// 故不進 highestReferencedEventId() 的計算。主鍵 areaId。
function validateEventPlan(value: unknown, index: number): EventPlanRow {
    const where = `tables.eventPlans[${index}]`;
    const row = objectAt(value, where);
    const tags = arrayAt(row.tags, `${where}.tags`).map((raw, i) => {
        const w = `${where}.tags[${i}]`;
        const tag = objectAt(raw, w);
        const source: 'auto' | 'manual' = tag.nameSource === 'auto' ? 'auto'
            : tag.nameSource === 'manual' ? 'manual'
                : invalid(`${w}.nameSource 必須是 auto 或 manual。`);
        return {
            sallyArea: integer(tag.sallyArea, `${w}.sallyArea`, 1),
            name: typeof tag.name === 'string' ? tag.name : invalid(`${w}.name 必須是字串。`),
            nameSource: source,
            ...(tag.manualName === undefined ? {} : {
                manualName: typeof tag.manualName === 'string'
                    ? tag.manualName : invalid(`${w}.manualName 必須是字串。`),
            }),
        };
    });
    const stages = arrayAt(row.stages, `${where}.stages`).map((raw, i) => {
        const w = `${where}.stages[${i}]`;
        const st = objectAt(raw, w);
        return {
            key: nonEmptyString(st.key, `${w}.key`),
            label: typeof st.label === 'string' ? st.label : invalid(`${w}.label 必須是字串。`),
            allowedTags: arrayAt(st.allowedTags, `${w}.allowedTags`)
                .map((v, j) => integer(v, `${w}.allowedTags[${j}]`, 1)),
            grantsTag: st.grantsTag === null || st.grantsTag === undefined
                ? null : integer(st.grantsTag, `${w}.grantsTag`, 1),
            slots: arrayAt(st.slots, `${w}.slots`).map((rawSlot, j) => {
                const sw = `${w}.slots[${j}]`;
                const slot = objectAt(rawSlot, sw);
                return {
                    ...(slot.shipId === undefined ? {} : { shipId: integer(slot.shipId, `${sw}.shipId`, 1) }),
                    ...(slot.role === undefined ? {} : {
                        role: typeof slot.role === 'string' ? slot.role : invalid(`${sw}.role 必須是字串。`),
                    }),
                };
            }),
            ...(st.mapNo === null || st.mapNo === undefined
                ? {} : { mapNo: integer(st.mapNo, `${w}.mapNo`, 1) }),
            ...(st.phase === undefined ? {} : { phase: booleanValue(st.phase, `${w}.phase`) }),
        };
    });
    // sallySnapshot：活動結束後 api_sally_area 會被清 0，故留一份當時的貼標快照。
    // key＝艦實例 id（JSON 物件鍵一律是字串，此處驗證其數值形式）。
    let sallySnapshot: Record<number, number> | undefined;
    if (row.sallySnapshot !== undefined) {
        const snapWhere = `${where}.sallySnapshot`;
        const raw = objectAt(row.sallySnapshot, snapWhere);
        sallySnapshot = {};
        for (const [key, value] of Object.entries(raw)) {
            const shipId = Number(key);
            if (!Number.isSafeInteger(shipId) || shipId < 1) invalid(`${snapWhere} 的鍵必須是艦實例 id。`);
            sallySnapshot[shipId] = integer(value, `${snapWhere}.${key}`, 1);
        }
    }
    return {
        areaId: integer(row.areaId, `${where}.areaId`, 1),
        title: typeof row.title === 'string' ? row.title : invalid(`${where}.title 必須是字串。`),
        tags,
        stages,
        updatedTs: timestamp(row.updatedTs, `${where}.updatedTs`),
        ...(row.unlocked === undefined ? {} : { unlocked: booleanValue(row.unlocked, `${where}.unlocked`) }),
        ...(sallySnapshot === undefined ? {} : { sallySnapshot }),
    };
}

// 資源時間序列。八項餘額必須完整（缺一項就無從計算消長），且不接受負值——
// 那不是遊戲會送出的狀態，放行只會讓趨勢圖畫出不存在的谷底。
function validateResource(value: unknown, index: number): ResourceRow {
    const where = `tables.resources[${index}]`;
    const row = objectAt(value, where);
    const materials = numberArray(row.m, `${where}.m`);
    if (materials.length !== 8) invalid(`${where}.m 必須是八項資材餘額。`);
    return {
        eventId: integer(row.eventId, `${where}.eventId`, 1),
        ts: timestamp(row.ts, `${where}.ts`),
        m: materials,
    };
}

// 資源紀錄的特殊時間點。'gauge-seen' 是偵測狀態機的守衛（見 utils/db.ts），
// **一併帶走才不會在還原後把「已經看過它未歸零」的前提弄丟**，故不是只帶里程碑。
function validateResourceMark(value: unknown, index: number): ResourceMarkRow {
    const where = `tables.resourceMarks[${index}]`;
    const row = objectAt(value, where);
    if (row.kind !== 'stage-open' && row.kind !== 'gauge-clear' && row.kind !== 'gauge-seen') {
        invalid(`${where}.kind 必須是 stage-open、gauge-clear 或 gauge-seen。`);
    }
    return {
        key: nonEmptyString(row.key, `${where}.key`),
        kind: row.kind,
        mapKey: integer(row.mapKey, `${where}.mapKey`, 1),
        ts: timestamp(row.ts, `${where}.ts`),
        eventId: integer(row.eventId, `${where}.eventId`, 1),
        ...(row.seq === undefined ? {} : { seq: integer(row.seq, `${where}.seq`, 0) }),
        ...(row.gaugeNum === undefined ? {} : { gaugeNum: integer(row.gaugeNum, `${where}.gaugeNum`, 0) }),
    };
}

function determineKind(schemaVersion: number, kind: unknown, tables: UnknownRecord): BackupKind {
    const names = Object.keys(tables);
    const expected = (allowed: readonly string[]) => names.every(name => allowed.includes(name));
    if (schemaVersion === 1) {
        // legacy-full 是本模組對 v1 無 kind 資料的正規化名稱；接受它可讓 restoreBackup()
        // 安全地再次驗證已解析的 envelope，亦相容曾手動補上 full 的早期檔案。
        if (kind !== undefined && kind !== 'full' && kind !== 'legacy-full') {
            invalid('schemaVersion 1 只支援 legacy-full 備份。');
        }
        const required = ['snapshot', 'sorties', 'expeditions', 'factory', 'replays', 'wanted'];
        if (!required.every(name => names.includes(name)) || !expected(required)) {
            invalid('schemaVersion 1 的 legacy-full 備份必須且只能包含完整的六張表。');
        }
        return 'legacy-full';
    }
    if (kind !== 'restore' && kind !== 'replays') invalid(`schemaVersion ${schemaVersion} 的 kind 必須是 restore 或 replays。`);
    // 每個版本的 restore 表組合各自固定：舊檔不得因為缺少後來新增的表而被拒，
    // 新檔也不得少帶。v4 新增 eventPlans（活動作戰板）、v5 新增資源紀錄兩張表。
    const restoreTables = schemaVersion >= 5
        ? ['snapshot', 'sorties', 'expeditions', 'factory', 'wanted', 'shipObtained', 'eventPlans',
            'resources', 'resourceMarks']
        : schemaVersion === 4
        ? ['snapshot', 'sorties', 'expeditions', 'factory', 'wanted', 'shipObtained', 'eventPlans']
        : schemaVersion === 3
            ? ['snapshot', 'sorties', 'expeditions', 'factory', 'wanted', 'shipObtained']
            : ['snapshot', 'sorties', 'expeditions', 'factory', 'wanted'];
    const required = kind === 'restore' ? restoreTables : ['replays'];
    if (!required.every(name => names.includes(name)) || !expected(required)) {
        invalid(`${kind} 備份的 tables 組合與 schemaVersion ${schemaVersion} 不相容。`);
    }
    return kind;
}

function validateTables(value: unknown): BackupTables {
    const tables = objectAt(value, 'tables');
    for (const name of Object.keys(tables)) {
        if (!(TABLE_NAMES as readonly string[]).includes(name)) invalid(`tables.${name} 不是支援的資料表。`);
        arrayAt(tables[name], `tables.${name}`);
    }
    const unique = <T>(rows: T[], keyOf: (row: T) => string | number, where: string): T[] => {
        const keys = new Set<string | number>();
        for (const row of rows) {
            const key = keyOf(row);
            if (keys.has(key)) invalid(`${where} 含有重複主鍵 ${String(key)}。`);
            keys.add(key);
        }
        return rows;
    };
    const snapshot = tables.snapshot === undefined ? undefined
        : unique((tables.snapshot as unknown[]).map(validateSnapshot), row => row.path, 'tables.snapshot');
    const sorties = tables.sorties === undefined ? undefined
        : unique((tables.sorties as unknown[]).map(validateSortie), row => row.eventId, 'tables.sorties');
    const expeditions = tables.expeditions === undefined ? undefined
        : unique((tables.expeditions as unknown[]).map(validateExpedition), row => row.eventId, 'tables.expeditions');
    const factory = tables.factory === undefined ? undefined
        : unique((tables.factory as unknown[]).map(validateFactory), row => row.eventId, 'tables.factory');
    const replays = tables.replays === undefined ? undefined
        : unique((tables.replays as unknown[]).map(validateReplay), row => row.sortieKey, 'tables.replays');
    const wanted = tables.wanted === undefined ? undefined : (tables.wanted as unknown[]).map(validateWanted);
    const shipObtained = tables.shipObtained === undefined ? undefined
        : unique((tables.shipObtained as unknown[]).map(validateShipObtained), row => row.id, 'tables.shipObtained');
    const eventPlans = tables.eventPlans === undefined ? undefined
        : unique((tables.eventPlans as unknown[]).map(validateEventPlan), row => row.areaId, 'tables.eventPlans');
    const resources = tables.resources === undefined ? undefined
        : unique((tables.resources as unknown[]).map(validateResource), row => row.eventId, 'tables.resources');
    const resourceMarks = tables.resourceMarks === undefined ? undefined
        : unique((tables.resourceMarks as unknown[]).map(validateResourceMark), row => row.key, 'tables.resourceMarks');
    return {
        ...(snapshot === undefined ? {} : { snapshot }),
        ...(sorties === undefined ? {} : { sorties }),
        ...(expeditions === undefined ? {} : { expeditions }),
        ...(factory === undefined ? {} : { factory }),
        ...(replays === undefined ? {} : { replays }),
        ...(wanted === undefined ? {} : { wanted }),
        ...(shipObtained === undefined ? {} : { shipObtained }),
        ...(eventPlans === undefined ? {} : { eventPlans }),
        ...(resources === undefined ? {} : { resources }),
        ...(resourceMarks === undefined ? {} : { resourceMarks }),
    };
}

function continuableSourceEventId(value: unknown, where: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        invalid(`${where} 必須是正的有限來源 event ID。`);
    }
    const reservationKey = Math.ceil(value);
    if (!Number.isSafeInteger(reservationKey)
        || reservationKey > MAX_RESTORABLE_SOURCE_EVENT_ID) {
        invalid(`${where} 超出可安全延續的來源 event ID 範圍。`);
    }
    return value;
}

// 集中列舉所有會引用來源安裝 numeric event ID 的欄位。factory.eventId 可帶小數主鍵，
// 上界會在 reservation 時以 Math.ceil() 正規化，不能只看整數型欄位。
export function highestReferencedEventId(tables: BackupTables): number {
    let highest = 0;
    const include = (value: unknown, where: string) => {
        if (value === undefined) return;
        highest = Math.max(highest, continuableSourceEventId(value, where));
    };

    tables.snapshot?.forEach((row, index) => include(row.eventId, `tables.snapshot[${index}].eventId`));
    tables.sorties?.forEach((row, index) => {
        include(row.eventId, `tables.sorties[${index}].eventId`);
        include(row.sortieKey, `tables.sorties[${index}].sortieKey`);
    });
    tables.factory?.forEach((row, index) => include(row.eventId, `tables.factory[${index}].eventId`));
    tables.replays?.forEach((row, index) => include(row.sortieKey, `tables.replays[${index}].sortieKey`));
    tables.expeditions?.forEach((row, index) => include(row.eventId, `tables.expeditions[${index}].eventId`));
    tables.wanted?.forEach((row, index) => include(row.eventId, `tables.wanted[${index}].eventId`));
    tables.shipObtained?.forEach((row, index) => {
        include(row.observedEventId, `tables.shipObtained[${index}].observedEventId`);
    });
    tables.resources?.forEach((row, index) => include(row.eventId, `tables.resources[${index}].eventId`));
    tables.resourceMarks?.forEach((row, index) => include(row.eventId, `tables.resourceMarks[${index}].eventId`));
    return highest;
}

// 任何寫入之前一次完成全部驗證。回傳值是已驗證、時間戳正規化後的安全資料。
export function validateBackupEnvelope(value: unknown): ValidatedBackupEnvelope {
    const envelope = objectAt(value, '備份 envelope');
    assertNoApiToken(envelope);
    const schemaVersion = integer(envelope.schemaVersion, 'schemaVersion', 1);
    if (schemaVersion > BACKUP_SCHEMA_VERSION) invalid(`不支援較新的備份版本 ${schemaVersion}。`);
    const rawTables = objectAt(envelope.tables, 'tables');
    const kind = determineKind(schemaVersion, envelope.kind, rawTables);
    const tables = validateTables(rawTables);
    highestReferencedEventId(tables);
    return {
        schemaVersion,
        kind,
        exportedAt: timestamp(envelope.exportedAt, 'exportedAt'),
        tables,
    };
}

export function parseBackupJson(text: string): ValidatedBackupEnvelope {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        invalid('備份檔不是有效的 JSON。');
    }
    return validateBackupEnvelope(parsed);
}

export async function buildRestoreEnvelope(
    database: Pick<KcDb, 'snapshot' | 'sorties' | 'expeditions' | 'factory' | 'wanted'
        | 'shipObtained' | 'eventPlans' | 'resources' | 'resourceMarks'>,
): Promise<BackupEnvelope> {
    const [snapshot, sorties, expeditions, factory, wanted, shipObtained, eventPlans,
        resources, resourceMarks] = await Promise.all([
        database.snapshot.toArray(), database.sorties.toArray(), database.expeditions.toArray(),
        database.factory.toArray(), database.wanted.toArray(), database.shipObtained.toArray(),
        database.eventPlans.toArray(), database.resources.toArray(), database.resourceMarks.toArray(),
    ]);
    return {
        schemaVersion: BACKUP_SCHEMA_VERSION, kind: 'restore', exportedAt: Date.now(),
        tables: {
            snapshot, sorties, expeditions, factory, wanted, shipObtained, eventPlans,
            resources, resourceMarks,
        },
    };
}

export async function buildReplaysEnvelope(database: Pick<KcDb, 'replays'>): Promise<BackupEnvelope> {
    return {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        kind: 'replays',
        exportedAt: Date.now(),
        tables: { replays: await database.replays.toArray() },
    };
}

export function countBackupRecords(tables: BackupTables): number {
    return TABLE_NAMES.reduce((count, name) => count + (tables[name]?.length ?? 0), 0);
}

function hasRestoreRows(tables: BackupTables): boolean {
    return Boolean(
        tables.snapshot?.length
        || tables.sorties?.length
        || tables.expeditions?.length
        || tables.factory?.length
        || tables.wanted?.length
        || tables.shipObtained?.length
        || tables.eventPlans?.length
        || tables.resources?.length
        || tables.resourceMarks?.length,
    );
}

function hasReplayRows(tables: BackupTables): boolean {
    return Boolean(tables.replays?.length);
}

function restoreMarker(allMetaRows: DatabaseMetaRow[]): BackupRestoreMetaRow | undefined {
    // 「乾淨環境」判定看的是**會影響還原正確性**的 metadata：projection 游標（代表這台
    // 機器已投影過自己的 raw events）與前一次匯入的 marker。純顯示偏好不在此列——
    // `game-page`（遊戲頁靜音／語言鏡像，見 background.ts）既不引用任何 event id、也不
    // 參與投影，它存在只代表使用者按過靜音鈕，不構成「來源不明的既有資料」。
    // ⚠️ 新增 meta key 前先問：它能不能讓還原後的資料語意出錯？能，就不要放進這個白名單。
    const metaRows = allMetaRows.filter(row => row.key !== GAME_PAGE_META_KEY);
    if (metaRows.length === 0) return undefined;
    if (metaRows.length !== 1 || metaRows[0].key !== BACKUP_RESTORE_META_KEY) {
        destinationInvalid('還原環境已有 projection 或來源不明的 metadata。');
    }
    const marker = metaRows[0];
    if (typeof marker.importedRestore !== 'boolean'
        || typeof marker.importedReplays !== 'boolean'
        || (!marker.importedRestore && !marker.importedReplays)
        || typeof marker.highestSourceEventId !== 'number'
        || !Number.isFinite(marker.highestSourceEventId)
        || marker.highestSourceEventId < 0
        || (marker.highestSourceEventId > 0 && marker.highestSourceEventId < 1)
        || !Number.isSafeInteger(Math.ceil(marker.highestSourceEventId))
        || Math.ceil(marker.highestSourceEventId) > MAX_RESTORABLE_SOURCE_EVENT_ID
        || !Number.isSafeInteger(marker.nextEventId)
        || marker.nextEventId < 1
        || marker.nextEventId > Number.MAX_SAFE_INTEGER
        || marker.nextEventId <= Math.ceil(marker.highestSourceEventId)
        || !Number.isFinite(marker.updatedAt)
        || marker.updatedAt < 0) {
        destinationInvalid('還原環境的安全匯入 metadata 已損壞。');
    }
    return marker;
}

function sequenceProbeRow(id?: number) {
    return {
        ...(id === undefined ? {} : { id }),
        ts: 0,
        path: '__kc_backup_sequence_reservation__',
        api: null,
        req: {},
    };
}

function existingTables(
    snapshot: SnapshotRow[],
    sorties: SortieLogRow[],
    expeditions: ExpeditionRow[],
    factory: FactoryLogRow[],
    replays: ReplayRow[],
    wanted: WantedRow[],
    shipObtained: ShipObtainedRow[],
    eventPlans: EventPlanRow[],
    resources: ResourceRow[],
    resourceMarks: ResourceMarkRow[],
): BackupTables {
    return {
        snapshot, sorties, expeditions, factory, replays, wanted, shipObtained, eventPlans,
        resources, resourceMarks,
    };
}

// destination preflight、所有資料寫入、sequence 推進與 import marker 都鎖在同一個
// transaction。第一次只接受完全乾淨且 generator 未被推進的環境；第二次只接受 marker
// 證明的 complementary split kind。任何拒絕或失敗都不得改動 rows 或 generator。
export async function restoreBackup(database: KcDb, input: unknown): Promise<void> {
    // 這層再次驗證，避免其他未來呼叫端繞過 parseBackupJson() 後直接把不可信值寫進 DB。
    const envelope = validateBackupEnvelope(input);
    const tables = envelope.tables;
    const incomingHighest = highestReferencedEventId(tables);
    await database.transaction('rw', [
        database.events, database.meta, database.notified,
        database.snapshot, database.sorties, database.expeditions, database.factory,
        database.replays, database.wanted, database.shipObtained, database.eventPlans,
        database.resources, database.resourceMarks,
    ], async () => {
        const [
            eventCount, notifiedCount, metaRows,
            currentSnapshot, currentSorties, currentExpeditions, currentFactory,
            currentReplays, currentWanted, currentShipObtained, currentEventPlans,
            currentResources, currentResourceMarks,
        ] = await Promise.all([
            database.events.count(), database.notified.count(), database.meta.toArray(),
            database.snapshot.toArray(), database.sorties.toArray(), database.expeditions.toArray(),
            database.factory.toArray(), database.replays.toArray(), database.wanted.toArray(),
            database.shipObtained.toArray(), database.eventPlans.toArray(),
            database.resources.toArray(), database.resourceMarks.toArray(),
        ]);

        if (eventCount > 0) destinationInvalid('還原環境已有 raw events。');
        if (notifiedCount > 0) destinationInvalid('還原環境已有本機 ingestion side-effect 紀錄。');

        const marker = restoreMarker(metaRows);
        const currentTables = existingTables(
            currentSnapshot, currentSorties, currentExpeditions, currentFactory,
            currentReplays, currentWanted, currentShipObtained, currentEventPlans,
            currentResources, currentResourceMarks,
        );
        const restoreRowsExist = hasRestoreRows(currentTables);
        const replayRowsExist = hasReplayRows(currentTables);

        if (!marker && (restoreRowsExist || replayRowsExist)) {
            destinationInvalid('還原環境已有來源不明的備份目標資料。');
        }
        if (marker && ((!marker.importedRestore && restoreRowsExist)
            || (!marker.importedReplays && replayRowsExist))) {
            destinationInvalid('還原環境含有 import marker 無法解釋的資料。');
        }

        const importsRestore = envelope.kind === 'restore' || envelope.kind === 'legacy-full';
        const importsReplays = envelope.kind === 'replays' || envelope.kind === 'legacy-full';
        if (importsRestore && (restoreRowsExist || marker?.importedRestore)) {
            destinationInvalid('restore envelope 的目標 tables 已有資料或已完成匯入。');
        }
        if (importsReplays && (replayRowsExist || marker?.importedReplays)) {
            destinationInvalid('replays envelope 的目標 table 已有資料或已完成匯入。');
        }

        let currentHighest = 0;
        try {
            currentHighest = highestReferencedEventId(currentTables);
        } catch (error) {
            if (error instanceof BackupValidationError) {
                destinationInvalid('既有 complementary split data 含有無法安全延續的 event ID。');
            }
            throw error;
        }
        const highestSourceEventId = Math.max(
            incomingHighest,
            currentHighest,
            marker?.highestSourceEventId ?? 0,
        );
        const reservationKey = highestSourceEventId === 0 ? 0 : Math.ceil(highestSourceEventId);

        // fake-indexeddb 6.2.5 對 explicit numeric key 的 abort rollback 有缺口；先由真正
        // auto-increment 取得 guard，會登記 generator rollback。真實 IndexedDB 也遵守同一
        // transaction rollback 語意。guard 立刻刪除，不會成為 raw event 或觸發任何副作用。
        const guardId = await database.events.add(sequenceProbeRow());
        if (!Number.isSafeInteger(guardId) || guardId < 1) {
            destinationInvalid('events key generator 已超出安全整數範圍。');
        }
        const expectedGuardId = marker?.nextEventId ?? 1;
        if (guardId !== expectedGuardId) {
            destinationInvalid('events key generator 顯示來源不明的既有 ingestion 歷史。');
        }
        await database.events.delete(guardId);

        if (tables.snapshot?.length) await database.snapshot.bulkPut(tables.snapshot);
        if (tables.sorties?.length) await database.sorties.bulkPut(tables.sorties);
        if (tables.expeditions?.length) await database.expeditions.bulkPut(tables.expeditions);
        if (tables.factory?.length) await database.factory.bulkPut(tables.factory);
        if (tables.replays?.length) await database.replays.bulkPut(tables.replays);
        if (tables.shipObtained?.length) await database.shipObtained.bulkPut(tables.shipObtained);
        if (tables.eventPlans?.length) await database.eventPlans.bulkPut(tables.eventPlans);
        if (tables.resources?.length) await database.resources.bulkPut(tables.resources);
        if (tables.resourceMarks?.length) await database.resourceMarks.bulkPut(tables.resourceMarks);
        if (tables.wanted?.length) {
            await database.wanted.bulkAdd(tables.wanted.map(({ id: _id, ...row }) => row));
        }

        if (reservationKey > 0) {
            await database.events.add(sequenceProbeRow(reservationKey));
            await database.events.delete(reservationKey);
        }
        const nextEventId = Math.max(guardId + 1, reservationKey + 1);
        if (!Number.isSafeInteger(nextEventId) || nextEventId > Number.MAX_SAFE_INTEGER) {
            invalid('匯入後無法保留安全的下一筆 event ID。');
        }
        await database.meta.put({
            key: BACKUP_RESTORE_META_KEY,
            importedRestore: Boolean(marker?.importedRestore || importsRestore),
            importedReplays: Boolean(marker?.importedReplays || importsReplays),
            highestSourceEventId,
            nextEventId,
            updatedAt: Date.now(),
        });
    });
}
