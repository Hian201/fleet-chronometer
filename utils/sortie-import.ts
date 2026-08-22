// 單場出擊 JSON 的匯入 —— 解析／去重（純函式）＋落地（Dexie transaction）。
//
// 用途：把一份「重播層 JSON」變成一條可視化的出擊紀錄。只吃兩種已確認來源：
//   · 本擴充「出擊紀錄」的「複製重播JSON／下載JSON」（`utils/replay.ts` toKc3Replay）
//   · KC3Kai kancolle-replay 的匯出（`samples/61-3.json` 即是，逐欄已驗證）
// 先用 `version:4` 或 KC3Kai logger 的 `nodes`＋`eventmap`＋`id` 識別格式，再各自驗證；
// 未知工具、通用 JSON 與只有部分相似的物件一律拒絕，不做第三種格式猜測。
//
// ── 這裡不是備份還原 ──────────────────────────────────────────────────
// `utils/backup.ts` 要的是「整個安裝的精確重建」，故有 clean-destination preflight 那一整套
// 嚴格規則；本模組只加**一場**紀錄，且必須能加進已經有資料的安裝，所以走另一條路：
// 從 events key generator 借出真正的 event ID（同 backup 的 reservation 手法），確保匯入的
// derived rows 不會與未來擷取的 raw event 撞號。**不寫 db.events**——匯入的是別處的紀錄，
// 不是本機觀測到的封包，不得偽裝成 raw event（provider 合約，見 CLAUDE.md 設計原則 3）。
//
// ── 結算資訊：KC3Kai 匯出有，本專案自己的匯出沒有 ──────────────────
// **KC3Kai logger 的匯出每個 battle 都帶結算欄位**（欄位名與 kcsapi 不同，解析時以這些鍵為準）：
//   · `rating` ＝ rank。**KC3Kai 會吐 `SS`（完全勝利），遊戲的 `api_win_rank` 只吐 `S`**
//     （已實測，見 CLAUDE.md predictRank），故一律正規化成 `S`，與本機擷取的紀錄同形狀。
//   · `drop`   ＝ 掉落艦的 **master id**（0＝沒掉）。61-5 樣本的 boss 節點是 135＝長波。
//   · `mvp`    ＝ [主隊, 隨伴] 位置（1-based，同 api_mvp / api_mvp_combined）。
//   · `hqEXP`  ＝ 提督經驗值（同 api_get_exp）、`baseEXP` ＝ 基礎經驗值（遊戲封包沒有這欄，
//     只有匯入的紀錄才會有，UI 有值才顯示）。
//   · `boss`   ＝ boss 節點旗標（與 nodes[].eventColorNo===5 互相補強）。
// 本專案自己的 `toKc3Replay()` 匯出**不含**這些（那是重播格式），故那條路徑仍然 rank 留空、
// 節點卡顯示由封包推算的「推定」rank，掉落顯示為不可考（不是「無掉落」）。
import type {
    KcDb, ReplayLbas, ReplayRow, ReplayShip, ReplaySupportShip, SortieLogRow,
} from './db';
import { analyzeBattle } from './battle';
import { borrowEventId } from './event-id-borrow';

/** JSON 結構不符（缺欄位、型別錯、空 battles…）。UI 需與「已存在」分流顯示。 */
export class SortieImportError extends Error {
    constructor(message: string) { super(message); this.name = 'SortieImportError'; }
}

/** 已存在同一場紀錄。**不是錯誤而是預期結果**，UI 顯示「已存在」即可。 */
export class SortieImportDuplicateError extends Error {
    /** 既有那筆的 sortieKey，供 UI 指向現有紀錄。 */
    readonly sortieKey: number;
    constructor(sortieKey: number, message: string) {
        super(message);
        this.name = 'SortieImportDuplicateError';
        this.sortieKey = sortieKey;
    }
}

/** 兩筆「摘要缺封包」的紀錄要多接近才算同一場（見 isSameSortie 的說明）。 */
export const TIME_TOLERANCE_MS = 10 * 60 * 1000;

export interface SortieSignature {
    map: string;
    /** 戰鬥節點序列（不含基地空襲——兩邊的空襲紀錄不一定都在）。 */
    nodes: number[];
    /** 出擊開始時間（有重播就用重播的 ts，否則退回第一筆摘要的 ts）。 */
    ts: number;
    /** 戰鬥封包內容指紋；沒有封包時為 null。 */
    hash: string | null;
}

/** 解析選項。`shipName` 用來把掉落的 master id 轉成艦名，讓匯入的列與本機擷取同形狀。 */
export interface SortieImportOptions {
    shipName?: (mst: number) => string;
}

export interface ParsedSortie {
    /** 經明確辨識的來源格式；不是依欄位相似度猜出來的通用 JSON。 */
    format: 'fleet-chronometer' | 'kc3kai';
    /** sortieKey 由 importSortie() 從 event ID generator 取得，此處為 0。 */
    replay: ReplayRow;
    /** eventId／sortieKey 同上，由 importSortie() 補。 */
    rows: SortieLogRow[];
    signature: SortieSignature;
}

// ── 指紋與去重 ──────────────────────────────────────────────────────────

/** FNV-1a 32-bit。只用來比對內容是否相同，不是密碼學用途。 */
function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** JSON 內容的穩定序列化：物件 key 排序，陣列順序保留。 */
export function stableSerialize(value: unknown): string {
    const walk = (entry: unknown): string => {
        if (entry === null) return 'null';
        if (typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
        if (typeof entry === 'number') {
            if (!Number.isFinite(entry)) throw new SortieImportError('戰鬥封包含有非有限數值。');
            return JSON.stringify(entry);
        }
        if (Array.isArray(entry)) return `[${entry.map(walk).join(',')}]`;
        if (entry && typeof entry === 'object') {
            const object = entry as Record<string, unknown>;
            return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${walk(object[key])}`).join(',')}}`;
        }
        throw new SortieImportError('戰鬥封包含有非 JSON 值。');
    };
    return walk(value);
}

/**
 * 戰鬥封包指紋：使用節點 id 與 data／實際存在的 yasen 原始封包全文。
 * wrapper 的 rating/drop/MVP/EXP 不屬於兩種來源共同的原始戰鬥內容，刻意不混入。
 */
export function packetHash(battles: { node: number; data: unknown; yasen?: unknown }[]): string | null {
    if (!battles.length) return null;
    return fnv1a(stableSerialize(battles.map(b => ({
        node: b.node,
        data: b.data,
        ...(hasApiObject(b.yasen) ? { yasen: b.yasen } : {}),
    }))));
}

/**
 * 是否同一場出擊。海域與戰鬥節點序列必須完全相同，接著：
 *   · 兩邊都有封包指紋 → 必須在時間容差內且完整封包指紋相同
 *   · 任一邊沒有封包（例如既有紀錄的重播已被裁剪）→ 退回時間近似（10 分鐘內）
 * 時間容差涵蓋本機 map/start 與外部 logger 記錄時點的落差，但不允許相同封包指紋跨日去重。
 */
export function isSameSortie(a: SortieSignature, b: SortieSignature): boolean {
    if (a.map !== b.map) return false;
    if (a.nodes.length !== b.nodes.length) return false;
    if (a.nodes.some((node, i) => node !== b.nodes[i])) return false;
    if (Math.abs(a.ts - b.ts) > TIME_TOLERANCE_MS) return false;
    if (a.hash && b.hash) return a.hash === b.hash;
    return true;
}

// ── 解析 ────────────────────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;
type ImportFormat = ParsedSortie['format'];

const fail = (where: string, message: string): never => {
    throw new SortieImportError(`${where} ${message}`);
};

function isPlainObject(value: unknown): value is UnknownRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function objectAt(value: unknown, where: string): UnknownRecord {
    return isPlainObject(value) ? value : fail(where, '必須是一般物件。');
}

function arrayAt(value: unknown, where: string): unknown[] {
    return Array.isArray(value) ? value : fail(where, '必須是陣列。');
}

function integerAt(value: unknown, where: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        fail(where, `必須是 ${min}${max < Number.MAX_SAFE_INTEGER ? `～${max}` : ' 以上'}的安全整數。`);
    }
    return value as number;
}

function integerArrayAt(value: unknown, where: string, min: number, max = Number.MAX_SAFE_INTEGER): number[] {
    return arrayAt(value, where).map((entry, index) => integerAt(entry, `${where}[${index}]`, min, max));
}

function booleanAt(value: unknown, where: string): boolean {
    return typeof value === 'boolean' ? value : fail(where, '必須是布林值。');
}

function stringAt(value: unknown, where: string, allowEmpty = false): string {
    if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) fail(where, '必須是字串。');
    return value as string;
}

function assertOnlyKeys(row: UnknownRecord, allowed: readonly string[], where: string): void {
    for (const key of Object.keys(row)) {
        if (!allowed.includes(key)) fail(`${where}.${key}`, '不是此格式支援的欄位。');
    }
}

function detectFormat(raw: UnknownRecord): ImportFormat {
    if (raw.version === 4) return 'fleet-chronometer';
    if (raw.version === undefined && Array.isArray(raw.nodes) && isPlainObject(raw.eventmap)
        && Object.hasOwn(raw, 'id') && Array.isArray(raw.battles)) {
        return 'kc3kai';
    }
    throw new SortieImportError('不支援的出擊 JSON 格式；只接受 Fleet Chronometer 或 KC3Kai 匯出。');
}

/**
 * 這個物件是不是真的裝著一則戰鬥封包。
 * **KC3Kai 的匯出對「沒有夜戰的節點」寫的是 `"yasen": {}`**（空物件仍是 truthy），
 * 直接用 `if (entry.yasen)` 會讓每個節點都被標成夜戰接續，還會把空物件餵進 analyzeBattle。
 * 判準：至少有一個 `api_` 開頭的欄位。
 */
function hasApiObject(value: unknown): value is UnknownRecord {
    return isPlainObject(value) && Object.keys(value).some(key => key.startsWith('api_'));
}

function hpPair(packet: UnknownRecord, nowKey: string, maxKey: string, where: string, required: boolean): { now: number[]; max: number[] } | null {
    const nowRaw = packet[nowKey], maxRaw = packet[maxKey];
    if (nowRaw === undefined && maxRaw === undefined && !required) return null;
    if (nowRaw === undefined || maxRaw === undefined) fail(where, `${nowKey} 與 ${maxKey} 必須同時存在。`);
    const now = integerArrayAt(nowRaw, `${where}.${nowKey}`, 0);
    const max = integerArrayAt(maxRaw, `${where}.${maxKey}`, 1);
    if (now.length === 0 || now.length !== max.length) fail(where, `${nowKey}／${maxKey} 長度必須相同且非空。`);
    now.forEach((hp, i) => { if (hp > max[i]) fail(`${where}.${nowKey}[${i}]`, '不得大於對應 maxhp。'); });
    return { now, max };
}

/** 已知戰鬥封包最低形狀：雙方主隊 HP 與敵艦 master id。 */
export function hasPacket(value: unknown): boolean {
    try {
        validateBattlePacket(value, 'battle');
        return true;
    } catch {
        return false;
    }
}

function validateBattlePacket(value: unknown, where: string): UnknownRecord {
    const packet = objectAt(value, where);
    if (!Object.keys(packet).some(key => key.startsWith('api_'))) fail(where, '不是戰鬥封包。');
    hpPair(packet, 'api_f_nowhps', 'api_f_maxhps', where, true);
    const enemyHp = hpPair(packet, 'api_e_nowhps', 'api_e_maxhps', where, true)!;
    const enemyIds = integerArrayAt(packet.api_ship_ke, `${where}.api_ship_ke`, 1);
    if (enemyIds.length !== enemyHp.now.length) fail(`${where}.api_ship_ke`, '長度必須與敵主隊 HP 相同。');

    hpPair(packet, 'api_f_nowhps_combined', 'api_f_maxhps_combined', where, false);
    const enemyCombinedHp = hpPair(packet, 'api_e_nowhps_combined', 'api_e_maxhps_combined', where, false);
    if (packet.api_ship_ke_combined !== undefined || enemyCombinedHp) {
        const combinedHp = enemyCombinedHp ?? fail(where, '敵隨伴艦隊必須同時提供 HP。');
        const ids = integerArrayAt(packet.api_ship_ke_combined, `${where}.api_ship_ke_combined`, 1);
        if (ids.length !== combinedHp.now.length) fail(`${where}.api_ship_ke_combined`, '長度必須與敵隨伴 HP 相同。');
    }
    // 及早拒絕 JSON.parse 不可能產生、但直接呼叫純函式時可能塞入的非 JSON 值。
    stableSerialize(packet);
    return packet;
}

/** `time` 可能是秒（KC3Kai／現行輸出）或毫秒（相容輸入）。以 1e12 為界換算。 */
export function normalizeTime(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
    const normalized = value < 1e12 ? value * 1000 : value;
    return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

/**
 * 艦欄位正規化。KC3Kai 用 `level`/`morale`，本專案匯出用 `lv`/`nowhps`/`maxhps`。
 * KC3Kai 主力／護衛 HP 由第一個戰鬥封包取得；第 3／4 艦隊來源沒有 HP，保持缺席。
 */
function normalizeShip(rawValue: unknown, where: string, format: ImportFormat, hp?: { now: number; max: number }): ReplayShip | ReplaySupportShip {
    const raw = objectAt(rawValue, where);
    const allowed = format === 'fleet-chronometer'
        ? ['mst_id', 'lv', 'level', 'equip', 'stars', 'ace', 'exequip', 'exstars', 'exace', 'nowhps', 'maxhps']
        : ['mst_id', 'level', 'morale', 'stats', 'kyouka', 'effect', 'equip', 'stars', 'ace', 'exequip'];
    assertOnlyKeys(raw, allowed, where);
    const equip = integerArrayAt(raw.equip, `${where}.equip`, -1);
    const stars = integerArrayAt(raw.stars, `${where}.stars`, 0, 10);
    const ace = integerArrayAt(raw.ace, `${where}.ace`, -1, 7);
    if (equip.length !== stars.length || equip.length !== ace.length) {
        fail(where, 'equip／stars／ace 長度必須相同。');
    }
    const mst_id = integerAt(raw.mst_id, `${where}.mst_id`, 1);
    const lv = integerAt(raw[format === 'fleet-chronometer' ? 'lv' : 'level'], `${where}.${format === 'fleet-chronometer' ? 'lv' : 'level'}`, 1);
    if (format === 'fleet-chronometer' && raw.level !== undefined
        && integerAt(raw.level, `${where}.level`, 1) !== lv) {
        fail(`${where}.level`, '必須與 lv 相同。');
    }
    const exequip = raw.exequip === undefined && format === 'kc3kai'
        ? -1 : integerAt(raw.exequip, `${where}.exequip`, -1);
    const common = {
        mst_id, lv, equip, stars, ace, exequip,
        ...(raw.exstars === undefined ? {} : { exstars: integerAt(raw.exstars, `${where}.exstars`, 0, 10) }),
        ...(raw.exace === undefined ? {} : { exace: integerAt(raw.exace, `${where}.exace`, -1, 7) }),
        ...(format === 'kc3kai' ? { cond: integerAt(raw.morale, `${where}.morale`, 0, 100) } : {}),
        ...(raw.kyouka === undefined ? {} : { kyouka: integerArrayAt(raw.kyouka, `${where}.kyouka`, 0) }),
    };
    if (format === 'fleet-chronometer') {
        const nowhp = integerAt(raw.nowhps, `${where}.nowhps`, 0);
        const maxhp = integerAt(raw.maxhps, `${where}.maxhps`, 1);
        if (nowhp > maxhp) fail(`${where}.nowhps`, '不得大於 maxhps。');
        return { ...common, nowhp, maxhp };
    }
    if (!hp) return common;
    if (hp.now > hp.max) fail(where, '戰鬥封包提供的 nowhp 不得大於 maxhp。');
    return { ...common, nowhp: hp.now, maxhp: hp.max };
}

function normalizeFleet(raw: unknown, where: string, format: ImportFormat, hps?: { now: number[]; max: number[] }, minLength = 0, maxLength = 7): Array<ReplayShip | ReplaySupportShip> {
    const list = arrayAt(raw, where);
    if (list.length < minLength || list.length > maxLength) fail(where, `艦數必須介於 ${minLength}～${maxLength}。`);
    if (hps && (hps.now.length < list.length || hps.max.length < list.length)) fail(where, '艦數超過戰鬥封包的 HP 陣列長度。');
    return list.map((ship, i) => normalizeShip(ship, `${where}[${i}]`, format,
        hps ? { now: hps.now[i], max: hps.max[i] } : undefined));
}

/** KC3Kai 的 `lbas`（rid/range/action/planes[]）→ 本專案的 ReplayLbas。 */
function normalizeLbas(raw: unknown, areaId: number): ReplayLbas[] {
    const bases = arrayAt(raw, 'lbas');
    if (bases.length > 3) fail('lbas', '最多只能有 3 個基地。');
    const seen = new Set<number>();
    return bases.map((entry, i) => {
        const where = `lbas[${i}]`;
        const base = objectAt(entry, where);
        assertOnlyKeys(base, ['rid', 'range', 'action', 'level', 'edges', 'planes'], where);
        const rid = integerAt(base.rid, `${where}.rid`, 1, 3);
        if (seen.has(rid)) fail(`${where}.rid`, '不得重複。');
        seen.add(rid);
        const seenSquads = new Set<number>();
        const squadrons = arrayAt(base.planes, `${where}.planes`).map((planeValue, j) => {
            const sqWhere = `${where}.planes[${j}]`;
            const plane = objectAt(planeValue, sqWhere);
            assertOnlyKeys(plane, ['squad', 'mst_id', 'count', 'max_count', 'stars', 'ace', 'state', 'morale'], sqWhere);
            if (j >= 4) fail(`${where}.planes`, '每個基地最多 4 個中隊。');
            const count = integerAt(plane.count, `${sqWhere}.count`, 0);
            const maxCount = integerAt(plane.max_count, `${sqWhere}.max_count`, 0);
            if (count > maxCount) fail(`${sqWhere}.count`, '不得大於 max_count。');
            if (plane.squad !== undefined) {
                const squad = integerAt(plane.squad, `${sqWhere}.squad`, 1, 4);
                if (seenSquads.has(squad)) fail(`${sqWhere}.squad`, '不得重複。');
                seenSquads.add(squad);
            }
            return {
                mst: integerAt(plane.mst_id, `${sqWhere}.mst_id`, 0),
                count, maxCount,
                stars: integerAt(plane.stars, `${sqWhere}.stars`, 0, 10),
                ace: integerAt(plane.ace, `${sqWhere}.ace`, -1, 7),
                state: integerAt(plane.state, `${sqWhere}.state`, 0, 2),
                cond: integerAt(plane.morale, `${sqWhere}.morale`, 0, 3),
            };
        });
        return {
            areaId, rid,
            action: integerAt(base.action, `${where}.action`, 0, 4),
            distance: integerAt(base.range, `${where}.range`, 0),
            squadrons,
        };
    });
}

/**
 * 解析一份重播 JSON。回傳的 rows／replay 尚未配 event ID（由 importSortie 補）。
 * 任何缺漏都寧可拋錯，不要猜——匯進來的紀錄之後會被當成事實統計。
 */
export function parseSortieImport(input: unknown, options: SortieImportOptions = {}): ParsedSortie {
    const raw = objectAt(input, 'JSON 最外層');
    const format = detectFormat(raw);
    if (format === 'fleet-chronometer') {
        assertOnlyKeys(raw, [
            'version', 'combined', 'fleetnum', 'sourceFleetnum', 'fleet1', 'fleet2', 'battles',
            'world', 'mapnum', 'diff', 'time', 'hq',
        ], 'JSON');
        integerAt(raw.version, 'version', 4, 4);
    } else {
        assertOnlyKeys(raw, [
            'diff', 'world', 'mapnum', 'fleetnum', 'combined', 'fleet1', 'fleet2', 'fleet3', 'fleet4',
            'support1', 'support2', 'lbas', 'time', 'eventmap', 'hq', 'id', 'nodes', 'battles',
            'now_maphp', 'max_maphp',
        ], 'JSON');
        integerAt(raw.id, 'id', 1);
        objectAt(raw.eventmap, 'eventmap');
    }

    const world = integerAt(raw.world, 'world', 1);
    const mapnum = integerAt(raw.mapnum, 'mapnum', 1);
    const diff = integerAt(raw.diff, 'diff', 0, 4);
    const combinedFlag = integerAt(raw.combined, 'combined', 0, 3);
    const playerFleetnum = integerAt(raw.fleetnum, 'fleetnum', 1, 4);
    const fleetnum = format === 'fleet-chronometer' && raw.sourceFleetnum !== undefined
        ? integerAt(raw.sourceFleetnum, 'sourceFleetnum', 2, 4)
        : playerFleetnum;
    if (raw.sourceFleetnum !== undefined && (playerFleetnum !== 1 || combinedFlag !== 0)) {
        fail('fleetnum', '帶 sourceFleetnum 時必須是 KC3Kai 可播放的單一第1艦隊格式。');
    }
    const ts = normalizeTime(raw.time) ?? fail('time', '必須是正的有限秒／毫秒時間戳。');
    const rawBattles = arrayAt(raw.battles, 'battles');
    if (rawBattles.length === 0) fail('battles', '至少要有一個戰鬥節點。');

    interface ParsedBattle {
        node: number; data: UnknownRecord; yasen?: UnknownRecord; rank?: string;
        dropMst?: number; mvp?: number; mvpEscort?: number;
        getExp?: number; baseExp?: number; boss?: boolean;
    }
    const battles: ParsedBattle[] = rawBattles.map((entryValue, i) => {
        const where = `battles[${i}]`;
        const entry = objectAt(entryValue, where);
        assertOnlyKeys(entry, format === 'fleet-chronometer'
            ? ['node', 'data', 'yasen']
            : [
                'sortie_id', 'node', 'enemyId', 'data', 'yasen', 'rating', 'drop', 'time', 'baseEXP',
                'hqEXP', 'shizunde', 'mvp', 'fleetStates', 'boss', 'hq', 'id',
            ], where);
        const node = integerAt(entry.node, `${where}.node`, 1);
        const data = validateBattlePacket(entry.data, `${where}.data`);
        let yasen: UnknownRecord | undefined;
        if (format === 'fleet-chronometer') {
            if (hasApiObject(entry.yasen)) {
                yasen = validateBattlePacket(entry.yasen, `${where}.yasen`);
            } else if (entry.yasen !== null && entry.yasen !== undefined
                && (!isPlainObject(entry.yasen) || Object.keys(entry.yasen).length > 0)) {
                fail(`${where}.yasen`, '必須是 null、空物件或戰鬥封包。');
            }
        } else if (hasApiObject(entry.yasen)) {
            yasen = validateBattlePacket(entry.yasen, `${where}.yasen`);
        } else if (!isPlainObject(entry.yasen)) {
            fail(`${where}.yasen`, '必須是空物件或戰鬥封包。');
        }

        let rating = '';
        let dropMst = 0;
        let mvp: number[] = [];
        let hqExp = 0;
        let baseExp = 0;
        let boss = false;
        if (format === 'kc3kai') {
            integerAt(entry.sortie_id, `${where}.sortie_id`, 1);
            integerAt(entry.enemyId, `${where}.enemyId`, 0);
            integerAt(entry.id, `${where}.id`, 1);
            if (normalizeTime(entry.time) === null) fail(`${where}.time`, '必須是正的有限秒／毫秒時間戳。');
            rating = stringAt(entry.rating, `${where}.rating`);
            if (!['SS', 'S', 'A', 'B', 'C', 'D', 'E'].includes(rating)) fail(`${where}.rating`, '不是支援的 rank。');
            dropMst = integerAt(entry.drop, `${where}.drop`, 0);
            mvp = integerArrayAt(entry.mvp, `${where}.mvp`, 0, 7);
            // KC3Kai 單艦隊真實匯出同時存在 [主隊] 與 [主隊, 預設值] 兩種形狀；連合艦隊
            // 才要求第二個隨伴位置。單艦隊的第二值不視為參戰事實，寫入時會忽略。
            if (mvp.length < 1 || mvp.length > 2 || (combinedFlag > 0 && mvp.length !== 2)) {
                fail(`${where}.mvp`, combinedFlag > 0
                    ? '連合艦隊必須是 [主隊, 隨伴] 兩個位置。'
                    : '單艦隊必須是 [主隊] 或 [主隊, 預設值]。');
            }
            hqExp = integerAt(entry.hqEXP, `${where}.hqEXP`, 0);
            baseExp = integerAt(entry.baseEXP, `${where}.baseEXP`, 0);
            // KC3Kai 真實紀錄會以 null 表示未標 boss，語意等同 false。
            boss = entry.boss == null ? false : booleanAt(entry.boss, `${where}.boss`);
        }
        return {
            node, data,
            ...(yasen ? { yasen } : {}),
            ...(rating ? { rank: rating === 'SS' ? 'S' : rating } : {}),
            ...(dropMst > 0 ? { dropMst } : {}),
            ...(mvp[0] > 0 ? { mvp: mvp[0] } : {}),
            ...(combinedFlag > 0 && mvp[1] > 0 ? { mvpEscort: mvp[1] } : {}),
            ...(hqExp > 0 ? { getExp: hqExp } : {}),
            ...(baseExp > 0 ? { baseExp } : {}),
            ...(boss ? { boss: true } : {}),
        };
    });

    // 出擊當下的血量：第一個戰鬥封包就是「還沒被打之前」的狀態
    const firstApi = battles[0].data;
    const mainHps = hpPair(firstApi, 'api_f_nowhps', 'api_f_maxhps', 'battles[0].data', true)!;
    const escortHps = hpPair(firstApi, 'api_f_nowhps_combined', 'api_f_maxhps_combined', 'battles[0].data', false);
    if (combinedFlag > 0 && !escortHps) fail('battles[0].data', '連合艦隊缺少隨伴 HP。');

    const fleet1 = normalizeFleet(raw.fleet1, 'fleet1', format,
        format === 'kc3kai' ? mainHps : undefined, 1) as ReplayShip[];
    const sourceFleet2 = normalizeFleet(raw.fleet2, 'fleet2', format,
        format === 'kc3kai' ? escortHps ?? undefined : undefined,
        combinedFlag > 0 ? 1 : 0) as ReplayShip[];
    if (format === 'fleet-chronometer' && combinedFlag === 0 && sourceFleet2.length > 0) {
        fail('fleet2', '單艦隊格式必須是空陣列。');
    }
    // KC3Kai logger 即使是單艦隊出擊，也可能把母港的第2艦隊快照放在 fleet2（真實
    // fixture samples/61-4.json 即為 combined=0、fleet2 有值）。那不是本次出擊的隨伴，
    // 只做格式驗證後捨棄；不可拒絕整份真實紀錄，也不可誤存成參戰艦隊。
    const fleet2 = combinedFlag > 0 ? sourceFleet2 : [];

    const replay: ReplayRow = {
        sortieKey: 0, ts,
        world, mapnum,
        diff,
        combined: combinedFlag,
        fleetnum,
        fleet1,
        fleet2,
        battles,
        ...(format === 'kc3kai' ? {
            fleet3: normalizeFleet(raw.fleet3, 'fleet3', format, undefined, 0, 6) as ReplaySupportShip[],
            fleet4: normalizeFleet(raw.fleet4, 'fleet4', format, undefined, 0, 6) as ReplaySupportShip[],
        } : {}),
        ...(raw.hq === undefined ? {} : { nickname: stringAt(raw.hq, 'hq') }),
        // 匯入的紀錄一律標記並釘選：它不是本機觀測，且時間戳多半很舊，
        // 不釘的話下一次重播裁剪就會把使用者剛匯入的東西掃掉（見 utils/retention.ts）。
        imported: true,
        pinned: true,
    };
    if (format === 'kc3kai') replay.lbas = normalizeLbas(raw.lbas, world);

    // KC3Kai 的 nodes[]：eventColorNo === 5 為 boss（真封包實測 61-3 的 53、61-4 的 55），
    // 與本專案 reducer 讀的 api_color_no 同語意；沒有 nodes[] 就一律不是 boss，不猜。
    const bossNodes = new Set<number>();
    const raidByNode = new Map<number, any>();
    // 節點類型：KC3Kai 的 nodes[] 直接帶 eventId／eventKind（＝封包的 api_event_id／api_event_kind），
    // 與本機擷取存的是同一組值（見 utils/map-node-kind.ts）。
    const kindByNode = new Map<number, { eventId?: number; eventKind?: number }>();
    if (format === 'kc3kai') {
        const nodes = arrayAt(raw.nodes, 'nodes');
        for (let i = 0; i < nodes.length; i++) {
            const where = `nodes[${i}]`;
            const node = objectAt(nodes[i], where);
            assertOnlyKeys(node, ['id', 'type', 'eventId', 'eventKind', 'eventColorNo', 'desc', 'airRaid'], where);
            const id = integerAt(node.id, `${where}.id`, 1);
            const eventId = integerAt(node.eventId, `${where}.eventId`, 0);
            const eventKind = integerAt(node.eventKind, `${where}.eventKind`, 0);
            const eventColorNo = integerAt(node.eventColorNo, `${where}.eventColorNo`, 0);
            if (node.type !== 'battle') fail(`${where}.type`, '目前只支援 battle 節點。');
            if (node.desc !== undefined) stringAt(node.desc, `${where}.desc`);
            if (eventColorNo === 5) bossNodes.add(id);
            // 基地空襲：KC3Kai 把 api_destruction_battle 掛在該節點的 airRaid
            if (node.airRaid !== undefined) {
                const raid = objectAt(node.airRaid, `${where}.airRaid`);
                const attack = objectAt(raid.api_air_base_attack, `${where}.airRaid.api_air_base_attack`);
                const stage1 = objectAt(attack.api_stage1, `${where}.airRaid.api_air_base_attack.api_stage1`);
                integerAt(stage1.api_disp_seiku, `${where}.airRaid.api_air_base_attack.api_stage1.api_disp_seiku`, 0, 4);
                integerAt(raid.api_lost_kind, `${where}.airRaid.api_lost_kind`, 0);
                raidByNode.set(id, raid);
            }
            kindByNode.set(id, { eventId, eventKind });
        }
        for (let i = 0; i < battles.length; i++) {
            if (!kindByNode.has(battles[i].node)) fail(`battles[${i}].node`, '在 nodes 中找不到對應節點。');
        }
    }
    const kindOf = (node: number) => {
        const hit = kindByNode.get(node);
        return {
            ...(hit?.eventId === undefined ? {} : { nodeEventId: hit.eventId }),
            ...(hit?.eventKind === undefined ? {} : { nodeEventKind: hit.eventKind }),
        };
    };

    const map = `${world}-${mapnum}`;
    const rows: SortieLogRow[] = [];
    for (const battle of battles) {
        const raid = raidByNode.get(battle.node);
        if (raid) {
            const attack = objectAt(raid.api_air_base_attack, 'nodes[].airRaid.api_air_base_attack');
            const stage1 = objectAt(attack.api_stage1, 'nodes[].airRaid.api_air_base_attack.api_stage1');
            rows.push({
                eventId: 0, sortieKey: 0, ts, map,
                node: battle.node, boss: false, kind: 'raid', rank: '',
                seiku: integerAt(stage1.api_disp_seiku, 'nodes[].airRaid.api_air_base_attack.api_stage1.api_disp_seiku', 0, 4),
                enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false,
                raidLostKind: integerAt(raid.api_lost_kind, 'nodes[].airRaid.api_lost_kind', 0),
                ...kindOf(battle.node),
            });
            raidByNode.delete(battle.node);
        }
        const api = battle.data;
        // 摘要欄位一律由原始封包或已確認的 KC3Kai wrapper 取；Fleet 自身匯出沒有結算摘要。
        let taiha = false;
        let seiku: number | null = null;
        try {
            const info = analyzeBattle(battle.yasen ? [api, battle.yasen] : [api], { main: [], escort: [] });
            taiha = info.isTaiha;
            seiku = info.planes.playerFighter.count > 0 && Number.isSafeInteger(info.seiku)
                && info.seiku >= 0 && info.seiku <= 4 ? info.seiku : null;
        } catch { /* 封包異常時只失去 taiha/制空，其餘欄位照常匯入 */ }
        // 掉落：封包給的是 master id，艦名靠呼叫端的解析器補（與本機擷取存的形狀一致）。
        // 解析不出名字（master 未載入）就只留 id，UI 仍可顯示，不編一個假名字。
        const dropName = battle.dropMst && options.shipName ? options.shipName(battle.dropMst) : '';
        rows.push({
            eventId: 0, sortieKey: 0, ts, map,
            node: battle.node,
            boss: bossNodes.has(battle.node) || battle.boss === true,
            kind: 'battle',
            rank: battle.rank ?? '',
            seiku,
            enemyIds: integerArrayAt(api.api_ship_ke, 'battle.data.api_ship_ke', 1),
            enemyIdsEscort: api.api_ship_ke_combined === undefined
                ? [] : integerArrayAt(api.api_ship_ke_combined, 'battle.data.api_ship_ke_combined', 1),
            drop: dropName && dropName !== '?' ? dropName : null,
            taiha,
            ...(battle.dropMst ? { dropMst: battle.dropMst } : {}),
            ...(battle.mvp ? { mvp: battle.mvp } : {}),
            ...(battle.mvpEscort ? { mvpEscort: battle.mvpEscort } : {}),
            ...(battle.getExp ? { getExp: battle.getExp } : {}),
            ...(battle.baseExp ? { baseExp: battle.baseExp } : {}),
            ...kindOf(battle.node),
        });
    }

    return {
        format,
        replay,
        rows,
        signature: {
            map,
            nodes: battles.map(b => b.node),
            ts,
            hash: packetHash(battles),
        },
    };
}

// ── 落地 ────────────────────────────────────────────────────────────────

const RESERVATION_DEBUG_PATH = '__kc_sortie_import_reservation__';

/** 既有紀錄的簽章（同 buildSortieDetail 的分組規則：連續同 sortieKey 為一次出擊）。 */
export function signaturesOf(sorties: SortieLogRow[], replayTs: Map<number, number>, replayHash: Map<number, string | null>): Map<number, SortieSignature> {
    const out = new Map<number, SortieSignature>();
    const ordered = [...sorties].sort((a, b) => a.eventId - b.eventId);
    for (const row of ordered) {
        const hit = out.get(row.sortieKey) ?? {
            map: row.map, nodes: [], ts: replayTs.get(row.sortieKey) ?? row.ts,
            hash: replayHash.get(row.sortieKey) ?? null,
        };
        if (row.kind === 'battle') hit.nodes.push(row.node);
        out.set(row.sortieKey, hit);
    }
    return out;
}

/**
 * 寫入一場匯入的出擊。**去重在 transaction 內做**（避免兩次匯入同時通過檢查），
 * 命中即拋 SortieImportDuplicateError 並整個 rollback，不留半筆。
 *
 * event ID 從 events key generator 借（add→delete，只推進不回頭），故匯入的 derived rows
 * 永遠不會與未來擷取的 raw event 撞號；但**不留下任何 raw event**。
 */
export async function importSortie(database: KcDb, parsed: ParsedSortie): Promise<number> {
    let sortieKey = 0;
    await database.transaction('rw', [database.events, database.sorties, database.replays], async () => {
        // 1) 先比對海域＋戰鬥節點序列，命中的候選才去讀重播（重播列很大，不全載）
        const existing = await database.sorties.toArray();
        const candidates = new Map<number, SortieSignature>();
        for (const [key, signature] of signaturesOf(existing, new Map(), new Map())) {
            if (signature.map === parsed.signature.map
                && signature.nodes.length === parsed.signature.nodes.length
                && signature.nodes.every((node, i) => node === parsed.signature.nodes[i])) {
                candidates.set(key, signature);
            }
        }
        for (const [key, signature] of candidates) {
            const replay = await database.replays.get(key);
            if (replay) {
                signature.ts = replay.ts;
                signature.hash = packetHash(replay.battles);
            }
            if (isSameSortie(signature, parsed.signature)) {
                throw new SortieImportDuplicateError(key, '已存在相同的出擊紀錄。');
            }
        }

        // 2) 借 event ID：一個給重播（sortieKey），其餘給每筆節點摘要
        const ids: number[] = [];
        for (let i = 0; i < parsed.rows.length + 1; i++) {
            const id = await borrowEventId(database.events, RESERVATION_DEBUG_PATH, {
                onOverflow: (message) => { throw new SortieImportError(message); },
            });
            ids.push(id);
        }

        sortieKey = ids[0];
        await database.replays.put({ ...parsed.replay, sortieKey });
        await database.sorties.bulkPut(parsed.rows.map((row, i) => ({
            ...row, sortieKey, eventId: ids[i + 1],
        })));
    });
    return sortieKey;
}
