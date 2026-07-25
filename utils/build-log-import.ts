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
import { parseDelimitedText, rowsToCsv } from './csv';
import { reverseShipLookup } from './drop-log-import';
import { borrowEventId } from './event-id-borrow';

export { reverseShipLookup };

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

function parseTimestamp(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const iso = Date.parse(trimmed);
    if (Number.isFinite(iso)) return iso;
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
    return Number.isFinite(local) ? local : null;
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
        const existing = (await database.factory.toArray()).filter(r => r.kind === 'build' || r.kind === 'speedup');
        for (const row of rows) {
            if (existing.some(e => isDuplicateBuild(row, e))) { duplicates++; continue; }
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
            await database.factory.put(inserted);
            existing.push(inserted);
            added++;
        }
    });
    return { added, duplicates };
}
