// 建造紀錄（db.factory 中 kind==='build'|'speedup' 的列）的 CSV 匯出／匯入。設計與
// utils/drop-log-import.ts 同一套（provider-contract 例外路徑：借 event ID、不寫 raw event、
// 每列標 imported: true），細節見該檔頭註解，這裡只記錄本表特有的差異。
//
// ── 相容「航海日誌拡張版」的建造報告書 ───────────────────────────────────
// 同樣是 Tab 分隔＋CRLF 的「CSV」（`CreateReportLogic.writeCsv()`），表頭固定為：
//   No. / 日付 / 種類 / 名前 / 艦種 / 燃料 / 弾薬 / 鋼材 / ボーキ / 開発資材 / 空きドック / 秘書艦 / 司令部Lv
// （來源：`CreateReportLogic.getCreateShipHeader()`／`getCreateShipBody()`）。
// 逐欄：日付同戰績報表（`yyyy-MM-dd HH:mm:ss`，本地時間）；種類／艦種／空きドック為描述文字，
// 本專案 schema 沒有對應欄位，忽略；名前／秘書艦是**艦名字串**，不是 master id——只能靠目前
// master 反查（`reverseShipLookup`），查不到就存進 `importedShipName`／`importedSecretaryName`
// 讓 UI 至少能顯示原始名字，不假裝知道是哪個 master id。資材五欄對應
// `FactoryLogRow.used` 的 index 0/1/2/3/6（燃彈鋼鋁／開発資材）；該報表沒有「高速建造材」欄，
// 故 used[4] 一律為 0，匯入列 kind 固定為 'build'（航海日誌沒有另外記錄「高速完工」事件）。
import type { FactoryLogRow, KcDb } from './db';
import { parseDelimitedText, parseTimestamp, rowsToCsv } from './csv';
import { borrowEventId } from './event-id-borrow';
import { TimeBucketIndex } from './time-bucket-index';

export class BuildLogImportError extends Error {
    constructor(message: string) { super(message); this.name = 'BuildLogImportError'; }
}

const OWN_HEADER = [
    'ts', 'kind', 'shipMst', 'shipName', 'fuel', 'ammo', 'steel', 'bauxite', 'devmat', 'torch',
    'secretary', 'secretaryName', 'hqLv',
];

const LOGBOOK_HEADER_PREFIX = [
    'No.', '日付', '種類', '名前', '艦種', '燃料', '弾薬', '鋼材', 'ボーキ', '開発資材', '空きドック', '秘書艦', '司令部Lv',
];

export interface ParsedBuildRow {
    ts: number;
    kind: 'build' | 'speedup';
    used: number[];
    shipMst?: number;
    shipName?: string;   // 只在 shipMst 解不出來時才有值（顯示用備援）
    secretary?: number;
    secretaryName?: string;
    hqLv?: number;
}

export interface BuildLogParseResult {
    format: 'own' | 'logbook';
    rows: ParsedBuildRow[];
    skipped: { line: number; reason: string }[];
}

function isOwnHeader(header: string[]): boolean {
    return OWN_HEADER.every((label, i) => header[i] === label);
}

function isLogbookHeader(header: string[]): boolean {
    return LOGBOOK_HEADER_PREFIX.every((label, i) => header[i] === label);
}

const emptyUsed = () => [0, 0, 0, 0, 0, 0, 0, 0];

/** 有限非負整數；空字串視為 0（匯出寫 0）。拒絕負數／小數／非數字，勿 Number||0 靜默改寫。 */
function parseNonNegInt(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return 0;
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * 司令部等級是可選欄位：空欄＝來源沒記（維持缺席，別補 0 假裝知道），有值就必須是
 * 合法整數。`Number('あ')` 會得到 NaN，寫進 DB 之後 JSON 序列化成 null、UI 直接顯示
 * 「NaN」，故非法值一律回 'invalid' 交由呼叫端 skip。
 */
function parseOptionalHqLv(raw: string): number | undefined | 'invalid' {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const parsed = parseNonNegInt(trimmed);
    return parsed == null ? 'invalid' : parsed;
}

/**
 * 解析 CSV／TSV。`resolveShipMst` 用目前 master 反查艦名（見 reverseShipLookup），
 * 查不到不算錯誤——那一列仍會匯入，只是 shipMst 缺席、改存 shipName 供顯示。
 */
export function parseBuildLogCsv(text: string, resolveShipMst?: (name: string) => number | undefined): BuildLogParseResult {
    const parsed = parseDelimitedText(text);
    if (!parsed || parsed.header.length === 0) throw new BuildLogImportError('檔案是空的或無法辨識分隔符。');
    const { header, rows: dataRows } = parsed;

    if (isOwnHeader(header)) {
        const rows: ParsedBuildRow[] = [];
        const skipped: BuildLogParseResult['skipped'] = [];
        dataRows.forEach((cells, i) => {
            const line = i + 2;
            const get = (name: string) => cells[OWN_HEADER.indexOf(name)] ?? '';
            const ts = parseTimestamp(get('ts'));
            if (ts == null) { skipped.push({ line, reason: 'ts 欄位不是可解析的時間戳。' }); return; }
            const kind = get('kind').trim();
            if (kind !== 'build' && kind !== 'speedup') { skipped.push({ line, reason: `kind 欄位「${kind}」必須是 build 或 speedup。` }); return; }
            const used = emptyUsed();
            const materialFields: { name: string; index: number }[] = [
                { name: 'fuel', index: 0 }, { name: 'ammo', index: 1 },
                { name: 'steel', index: 2 }, { name: 'bauxite', index: 3 },
                { name: 'torch', index: 4 }, { name: 'devmat', index: 6 },
            ];
            for (const { name, index } of materialFields) {
                const value = parseNonNegInt(get(name));
                if (value == null) {
                    skipped.push({ line, reason: `${name} 欄位「${get(name).trim()}」不是有限非負整數。` });
                    return;
                }
                used[index] = value;
            }
            const shipMstRaw = Number(get('shipMst'));
            const secretaryRaw = Number(get('secretary'));
            const hqLv = parseOptionalHqLv(get('hqLv'));
            if (hqLv === 'invalid') {
                skipped.push({ line, reason: `hqLv 欄位「${get('hqLv').trim()}」不是有限非負整數。` });
                return;
            }
            rows.push({
                ts, kind: kind as 'build' | 'speedup', used,
                ...(Number.isSafeInteger(shipMstRaw) && shipMstRaw > 0 ? { shipMst: shipMstRaw } : {}),
                ...(!Number.isSafeInteger(shipMstRaw) || shipMstRaw <= 0 ? { shipName: get('shipName').trim() || undefined } : {}),
                ...(Number.isSafeInteger(secretaryRaw) && secretaryRaw > 0 ? { secretary: secretaryRaw } : {}),
                ...(!Number.isSafeInteger(secretaryRaw) || secretaryRaw <= 0 ? { secretaryName: get('secretaryName').trim() || undefined } : {}),
                ...(hqLv === undefined ? {} : { hqLv }),
            });
        });
        return { format: 'own', rows, skipped };
    }

    if (isLogbookHeader(header)) {
        const idx = (label: string) => LOGBOOK_HEADER_PREFIX.indexOf(label);
        const rows: ParsedBuildRow[] = [];
        const skipped: BuildLogParseResult['skipped'] = [];
        dataRows.forEach((cells, i) => {
            const line = i + 2;
            const ts = parseTimestamp(cells[idx('日付')] ?? '');
            if (ts == null) { skipped.push({ line, reason: '日付欄位不是可解析的時間戳。' }); return; }
            const shipName = (cells[idx('名前')] ?? '').trim();
            if (!shipName) { skipped.push({ line, reason: '名前欄位是空的。' }); return; }
            const secretaryName = (cells[idx('秘書艦')] ?? '').trim();
            // 這份報表沒有實機樣本佐證，欄位內容不合預期是常態；一律嚴格解析、不符就整列
            // 跳過並記原因（`Number(x) || 0` 會把「あ」與「-5」靜默寫成 0／負值，那是把
            // 無法解讀的來源資料偽裝成精確的投入資材，之後再也分不出來）。
            const used = emptyUsed();
            const materialFields: { label: string; index: number }[] = [
                { label: '燃料', index: 0 }, { label: '弾薬', index: 1 },
                { label: '鋼材', index: 2 }, { label: 'ボーキ', index: 3 },
                { label: '開発資材', index: 6 },
            ];
            const badMaterial = materialFields.find(({ label, index }) => {
                const value = parseNonNegInt(cells[idx(label)] ?? '');
                if (value == null) return true;
                used[index] = value;
                return false;
            });
            if (badMaterial) {
                const raw = (cells[idx(badMaterial.label)] ?? '').trim();
                skipped.push({ line, reason: `${badMaterial.label}欄位「${raw}」不是有限非負整數。` });
                return;
            }
            const hqLv = parseOptionalHqLv(cells[idx('司令部Lv')] ?? '');
            if (hqLv === 'invalid') {
                skipped.push({ line, reason: `司令部Lv欄位「${(cells[idx('司令部Lv')] ?? '').trim()}」不是有限非負整數。` });
                return;
            }
            const shipMst = resolveShipMst?.(shipName);
            const secretary = secretaryName ? resolveShipMst?.(secretaryName) : undefined;
            rows.push({
                ts, kind: 'build', used,
                ...(shipMst ? { shipMst } : { shipName }),
                ...(secretary ? { secretary } : secretaryName ? { secretaryName } : {}),
                ...(hqLv === undefined ? {} : { hqLv }),
            });
        });
        return { format: 'logbook', rows, skipped };
    }

    throw new BuildLogImportError('不是本分區匯出的 CSV，也不是航海日誌拡張版的建造報告書格式。');
}

// ── 合併同渠建造與高速加速 ──────────────────────────────────────────────────

// 艦これ最長建造時間為 8 小時（大和／武藏）；取 12 小時作配對上界，容忍系統時鐘微調，
// 同時避免先前未加速的同艦同渠建造，與數日後未錄到建造發起的孤立 speedup 誤合併。
const MAX_SPEEDUP_GAP_MS = 12 * 60 * 60 * 1000;

function sameShip(a: FactoryLogRow, b: FactoryLogRow): boolean {
    if (a.shipMst && b.shipMst) return a.shipMst === b.shipMst;
    if (a.shipMst || b.shipMst) return false;
    return Boolean(a.importedShipName) && a.importedShipName === b.importedShipName;
}

function withAddedTorch(used: number[], add: number): number[] {
    const next = Array.from({ length: Math.max(8, used.length) }, (_, i) => used[i] ?? 0);
    next[4] += add;
    return next;
}

/**
 * 將同一次建造的 `build`（建造發起）與後續 `speedup`（高速建造材加速）合併成單筆建造紀錄。
 * `db.factory` 仍保留兩筆原始列，讓離散資材分帳能依各自發生時刻對帳；建造紀錄介面與 CSV 匯出
 * 則呈現為同一艘船的一次建造，並把高速建造材消耗量併入原 `build` 列的 `used[4]`（時間、旗艦、
 * 司令部等級沿用建造發起當下）。未配對的孤立 `speedup`（例如安裝擴充前已開始建造）保留原列。
 * 回傳依時間新到舊排序（同毫秒以 eventId 新到舊）。
 */
export function mergeBuildRows(rows: readonly FactoryLogRow[]): FactoryLogRow[] {
    const ordered = rows
        .filter(r => r.kind === 'build' || r.kind === 'speedup')
        .sort((a, b) => (a.ts - b.ts)
            || ((a.kind === 'speedup' ? 1 : 0) - (b.kind === 'speedup' ? 1 : 0))
            || (a.eventId - b.eventId));
    const merged: FactoryLogRow[] = [];
    // 各建造渠目前最新、尚未加速的 build 在 merged 中的索引；同一渠開始新建造即覆蓋（前艦必已領取）。
    const activeByDock = new Map<number, number>();
    // 舊版 CSV 匯入列沒有 kdockId，另以無渠位的未加速 build 串列由新往舊配對。
    const openNoDock: number[] = [];

    for (const row of ordered) {
        if (row.kind === 'build') {
            const idx = merged.length;
            merged.push(row);
            if (row.kdockId != null) {
                if ((row.used[4] ?? 0) === 0) activeByDock.set(row.kdockId, idx);
                else activeByDock.delete(row.kdockId);
            } else if ((row.used[4] ?? 0) === 0) {
                openNoDock.push(idx);
            }
            continue;
        }

        const torch = row.used[4] ?? 0;
        if (row.kdockId != null) {
            const idx = activeByDock.get(row.kdockId);
            if (idx !== undefined) {
                activeByDock.delete(row.kdockId);
                const target = merged[idx];
                if (sameShip(target, row) && row.ts - target.ts <= MAX_SPEEDUP_GAP_MS) {
                    merged[idx] = { ...target, used: withAddedTorch(target.used, torch) };
                    continue;
                }
            }
            merged.push(row);
            continue;
        }

        let matchedPos = -1;
        for (let pos = openNoDock.length - 1; pos >= 0; pos--) {
            const target = merged[openNoDock[pos]];
            if (row.ts - target.ts > MAX_SPEEDUP_GAP_MS) break;
            if (sameShip(target, row)) { matchedPos = pos; break; }
        }
        if (matchedPos >= 0) {
            const idx = openNoDock[matchedPos];
            const target = merged[idx];
            merged[idx] = { ...target, used: withAddedTorch(target.used, torch) };
            openNoDock.splice(matchedPos, 1);
        } else {
            merged.push(row);
        }
    }

    return merged.sort((a, b) => (b.ts - a.ts) || (b.eventId - a.eventId));
}

// ── 匯出 ────────────────────────────────────────────────────────────────

export function buildLogCsvRows(rows: FactoryLogRow[], shipName: (mst: number | undefined) => string): string[][] {
    return [OWN_HEADER, ...rows.map(r => [
        new Date(r.ts).toISOString(),
        r.kind,
        r.shipMst != null ? String(r.shipMst) : '',
        r.shipMst != null ? shipName(r.shipMst) : (r.importedShipName ?? ''),
        String(r.used[0] ?? 0), String(r.used[1] ?? 0), String(r.used[2] ?? 0), String(r.used[3] ?? 0),
        String(r.used[6] ?? 0), String(r.used[4] ?? 0),
        String(r.secretary ?? ''),
        r.secretary ? shipName(r.secretary) : (r.importedSecretaryName ?? ''),
        r.hqLv != null ? String(r.hqLv) : '',
    ])];
}

export function buildLogCsvText(rows: FactoryLogRow[], shipName: (mst: number | undefined) => string): string {
    return rowsToCsv(buildLogCsvRows(rows, shipName));
}

// ── 落地 ────────────────────────────────────────────────────────────────

// 建造事件比掉落密集得多、常見「同一分鐘內排開好幾艘同配方」的情境，時間容差故意收窄；
// 另外要求投入資材完全相同才視為同一筆——同配方在同時間附近各自建了一艘，資材量多半仍會
// 因司令部等級／既有加成等差異而略有不同，這樣可以避免誤把兩艘不同的船當成重複匯入。
const TIME_TOLERANCE_MS = 2 * 60 * 1000;

function sameUsed(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === (b[i] ?? 0));
}

function isDuplicateBuild(a: ParsedBuildRow, b: FactoryLogRow): boolean {
    if (b.kind !== a.kind) return false;
    if (Math.abs(a.ts - b.ts) > TIME_TOLERANCE_MS) return false;
    if (!sameUsed(a.used, b.used)) return false;
    if (a.shipMst && b.shipMst) return a.shipMst === b.shipMst;
    if (a.shipMst || b.shipMst) return false;
    return (a.shipName ?? '') === (b.importedShipName ?? '');
}

const RESERVATION_DEBUG_PATH = '__kc_build_log_import_reservation__';

export interface BuildLogImportResult { added: number; duplicates: number; }

export async function importBuildLogRows(database: KcDb, rows: ParsedBuildRow[]): Promise<BuildLogImportResult> {
    let added = 0;
    let duplicates = 0;
    await database.transaction('rw', [database.events, database.factory], async () => {
        const existing = new TimeBucketIndex<FactoryLogRow>(TIME_TOLERANCE_MS, r => r.kind, r => r.ts);
        const rawBuilds = (await database.factory.toArray())
            .filter(r => r.kind === 'build' || r.kind === 'speedup');
        for (const r of rawBuilds) existing.add(r);
        // 匯出 CSV 已把同渠 build＋speedup 合併成帶 torch 的單筆 build，重匯入時也要認出它與既有配對重複。
        if (rawBuilds.some(r => r.kind === 'speedup')) {
            for (const r of mergeBuildRows(rawBuilds)) {
                if (r.kind === 'build' && (r.used[4] ?? 0) > 0) existing.add(r);
            }
        }
        const fresh: FactoryLogRow[] = [];
        for (const row of rows) {
            if (existing.some(row.kind, row.ts, e => isDuplicateBuild(row, e))) { duplicates++; continue; }
            const id = await borrowEventId(database.events, RESERVATION_DEBUG_PATH, {
                onOverflow: (message) => { throw new BuildLogImportError(message); },
            });
            const inserted: FactoryLogRow = {
                eventId: id, ts: row.ts, kind: row.kind, used: row.used,
                secretary: row.secretary ?? 0, imported: true,
                ...(row.shipMst ? { shipMst: row.shipMst } : {}),
                ...(row.shipName ? { importedShipName: row.shipName } : {}),
                ...(row.secretaryName ? { importedSecretaryName: row.secretaryName } : {}),
                ...(row.hqLv != null ? { hqLv: row.hqLv } : {}),
            };
            fresh.push(inserted);
            existing.add(inserted);
            added++;
        }
        // 去重判斷只看記憶體索引，與 DB 寫入順序無關；event ID 仍逐列借用（見 event-id-borrow.ts）。
        if (fresh.length) await database.factory.bulkPut(fresh);
    });
    return { added, duplicates };
}
