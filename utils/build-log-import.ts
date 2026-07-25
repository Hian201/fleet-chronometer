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
            const hqLvRaw = get('hqLv').trim();
            rows.push({
                ts, kind: kind as 'build' | 'speedup', used,
                ...(Number.isSafeInteger(shipMstRaw) && shipMstRaw > 0 ? { shipMst: shipMstRaw } : {}),
                ...(!Number.isSafeInteger(shipMstRaw) || shipMstRaw <= 0 ? { shipName: get('shipName').trim() || undefined } : {}),
                ...(Number.isSafeInteger(secretaryRaw) && secretaryRaw > 0 ? { secretary: secretaryRaw } : {}),
                ...(!Number.isSafeInteger(secretaryRaw) || secretaryRaw <= 0 ? { secretaryName: get('secretaryName').trim() || undefined } : {}),
                ...(hqLvRaw ? { hqLv: Number(hqLvRaw) } : {}),
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
            const used = emptyUsed();
            used[0] = Number(cells[idx('燃料')]) || 0;
            used[1] = Number(cells[idx('弾薬')]) || 0;
            used[2] = Number(cells[idx('鋼材')]) || 0;
            used[3] = Number(cells[idx('ボーキ')]) || 0;
            used[6] = Number(cells[idx('開発資材')]) || 0;
            const hqLvRaw = (cells[idx('司令部Lv')] ?? '').trim();
            const shipMst = resolveShipMst?.(shipName);
            const secretary = secretaryName ? resolveShipMst?.(secretaryName) : undefined;
            rows.push({
                ts, kind: 'build', used,
                ...(shipMst ? { shipMst } : { shipName }),
                ...(secretary ? { secretary } : secretaryName ? { secretaryName } : {}),
                ...(hqLvRaw && Number.isSafeInteger(Number(hqLvRaw)) ? { hqLv: Number(hqLvRaw) } : {}),
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

function reservationProbe() {
    return { ts: 0, path: '__kc_build_log_import_reservation__', api: null, req: {} };
}

export interface BuildLogImportResult { added: number; duplicates: number; }

export async function importBuildLogRows(database: KcDb, rows: ParsedBuildRow[]): Promise<BuildLogImportResult> {
    let added = 0;
    let duplicates = 0;
    await database.transaction('rw', [database.events, database.factory], async () => {
        const existing = (await database.factory.toArray()).filter(r => r.kind === 'build' || r.kind === 'speedup');
        for (const row of rows) {
            if (existing.some(e => isDuplicateBuild(row, e))) { duplicates++; continue; }
            const id = await database.events.add(reservationProbe());
            if (!Number.isSafeInteger(id) || id < 1) throw new BuildLogImportError('events key generator 已超出安全整數範圍。');
            await database.events.delete(id);
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
