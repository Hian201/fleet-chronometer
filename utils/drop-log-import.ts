// 打撈紀錄（db.sorties 中 kind==='battle' 且有掉落的列）的 CSV 匯出／匯入（純函式＋一個
// transaction）。與 utils/sortie-import.ts 的分工：那支匯入的是**完整一場出擊**（含戰鬥封包，
// 可重播）；這裡匯入的只是**掉落摘要**（沒有節點細節、沒有重播），用途是搬家／備份還原前的
// 舊資料，或把其他工具記錄的掉落謄寫進本機。故不建立 db.replays，也不需要封包指紋去重，
// 去重改用「海域＋時間容差＋掉落艦」（見 isDuplicateDrop）。
//
// ── 為什麼可以直接寫 db.sorties ──────────────────────────────────────────
// db.sorties 是 provider-contract 的 derived table，正常只能經 EventProjector 投影寫入
// （CLAUDE.md 設計原則 3）。這裡走 utils/sortie-import.ts 已建立的例外路徑：event ID 向
// events key generator 借（add→delete，只推進不回頭），確保匯入列不會與未來擷取的 raw event
// 撞號；但**不寫任何 raw event**——匯入的不是本機觀測到的封包。每一列匯入都標 `imported: true`
// 供 UI 顯示徽章，不得偽裝成本機擷取。
//
// ── 相容「航海日誌拡張版」（Nishisonic/logbook，MIT）的匯出 ─────────────────
// 該工具的「戦績」／「ドロップ報告書」CSV 其實是 **Tab 分隔＋CRLF**、不做欄位跳脫、
// UTF-8（來源：`logbook/gui/logic/CreateReportLogic.writeCsv()`：
// `StringUtils.join(header, '\t') + "\r\n"`），檔名仍叫 .csv。表頭固定為：
//   No. / 日付 / 海域 / マス / 出撃 / ランク / 敵艦隊 / ドロップ艦種 / ドロップ艦娘 / ドロップアイテム
// （來源：`CreateReportLogic.getBattleResultHeader()`；之後可能還有其餘擴充欄位，一律忽略）。
// 逐欄語意（`CreateReportLogic.getBattleResultBody()` ＋ `BattleResultDto`）：
//   · 日付＝`yyyy-MM-dd HH:mm:ss`（`AppConstants.DATE_FORMAT`，無時區資訊，只能當本地時間解析）
//   · 海域＝`getQuestName()`（作戰／任務文字，**不是** "6-5" 這種數字編號，無法可靠解析，捨棄）
//   · マス＝`MapCellDto.getReportString()`＝`"マップ:{area}-{mapNo} セル:{cell}"`
//     （或啟用字母化設定時 `"マップ:{area}-{mapNo}-{字母}({cell})"`）——**唯一**能可靠取出
//     `world-mapnum` 的欄位；セル／字母是該工具自己的格子概念，與本專案的 edge id 不是同一種
//     東西（見 CLAUDE.md「節點字母」），故只取 world-mapnum 前綴，node 一律當不可考（0）。
//   · 出撃＝`getBossText()`（"出撃"/"ボス" 之類的組合文字），只用來偵測是否含「ボス」。
//   · ランク＝`ResultRank.toString()`，可能是簡寫 "S" 或完整文字如「完全勝利!!S」「敗北E」——
//     兩種形式恰好都以 rank 字母結尾，故取尾字元。
//   · ドロップ艦娘為空或等於「※空きなし」＝沒有掉落，這種列本來就不該進打撈紀錄（同本機擷取
//     只收「有掉落」列的規則），故整列捨棄不匯入。
//   · ドロップアイテム＝裝備掉落，本專案的 SortieLogRow 不記裝備掉落（只記艦娘），故忽略。
// 這些都是依原始碼轉寫、非猜測；但 **CSV 本身沒有位置測試樣本**，故解析器對任何不符預期的列
// 一律跳過並記錄原因，不猜出一個可能錯誤的值（同 map-node-kind.ts 的「沒有樣本佐證的一律不猜」）。
import type { KcDb, SortieLogRow } from './db';
import { parseDelimitedText, rowsToCsv } from './csv';

export class DropLogImportError extends Error {
    constructor(message: string) { super(message); this.name = 'DropLogImportError'; }
}

/** 本專案自己的匯出／匯入固定欄位＝穩定識別碼（不用畫面語言標籤），語言切換不影響匯入。 */
const OWN_HEADER = ['ts', 'map', 'node', 'boss', 'rank', 'drop', 'dropMst'];

/** 航海日誌拡張版「戦績」報表表頭（前十欄固定，之後可能還有擴充欄位，一律忽略）。 */
const LOGBOOK_HEADER_PREFIX = [
    'No.', '日付', '海域', 'マス', '出撃', 'ランク', '敵艦隊', 'ドロップ艦種', 'ドロップ艦娘', 'ドロップアイテム',
];

export interface ParsedDropRow {
    ts: number;
    map: string;
    node: number;
    boss: boolean;
    rank: string;
    drop: string;
    dropMst?: number;
    enemyName?: string;
}

export interface DropLogParseResult {
    format: 'own' | 'logbook';
    rows: ParsedDropRow[];
    /** 被跳過的原始列與原因（1-based，含表頭那一行）。不是錯誤，是「這幾行看不懂」的報告。 */
    skipped: { line: number; reason: string }[];
}

const RANK_LETTERS = new Set(['S', 'A', 'B', 'C', 'D', 'E']);
const MAP_RE = /^\d+-\d+$/;

function normalizeRank(raw: string): string {
    const trimmed = raw.trim();
    if (RANK_LETTERS.has(trimmed)) return trimmed;
    const last = trimmed.slice(-1).toUpperCase();
    return RANK_LETTERS.has(last) ? last : '';
}

/** ISO 字串（本專案匯出）或 "yyyy-MM-dd HH:mm:ss"（航海日誌，當本地時間解析）。 */
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

/** 從航海日誌「マス」欄取出 world-mapnum；解不出來回 null（呼叫端跳過整列）。 */
function mapFromCellText(raw: string): string | null {
    const m = /マップ[:：]\s*(\d+)-(\d+)/.exec(raw);
    return m ? `${m[1]}-${m[2]}` : null;
}

function isLogbookHeader(header: string[]): boolean {
    return LOGBOOK_HEADER_PREFIX.every((label, i) => header[i] === label);
}

function isOwnHeader(header: string[]): boolean {
    return OWN_HEADER.every((label, i) => header[i] === label);
}

/**
 * 解析 CSV／TSV 文字。已知的兩種格式擇一辨識；其餘一律拒絕（不做第三種格式猜測，
 * 同 sortie-import.ts 對 JSON 格式的態度）。個別資料列有問題只跳過該列並記錄原因。
 */
export function parseDropLogCsv(text: string, resolveShipMst?: (name: string) => number | undefined): DropLogParseResult {
    const parsed = parseDelimitedText(text);
    if (!parsed || parsed.header.length === 0) throw new DropLogImportError('檔案是空的或無法辨識分隔符。');
    const { header, rows: dataRows } = parsed;

    if (isOwnHeader(header)) {
        const rows: ParsedDropRow[] = [];
        const skipped: DropLogParseResult['skipped'] = [];
        dataRows.forEach((cells, i) => {
            const line = i + 2;
            const get = (name: string) => cells[OWN_HEADER.indexOf(name)] ?? '';
            const ts = parseTimestamp(get('ts'));
            const map = get('map').trim();
            const drop = get('drop').trim();
            if (ts == null) { skipped.push({ line, reason: 'ts 欄位不是可解析的時間戳。' }); return; }
            if (!MAP_RE.test(map)) { skipped.push({ line, reason: `map 欄位「${map}」不是 world-mapnum 格式。` }); return; }
            if (!drop) { skipped.push({ line, reason: 'drop 欄位是空的（沒有掉落的列不該匯入）。' }); return; }
            // own-format 的 node 必須是真實 edge id；無效值 skip，勿靜默改成 0
            // （0 是航海日誌 path「不可考」的哨兵，語意不同）。
            const nodeRaw = get('node').trim();
            const node = Number(nodeRaw);
            if (nodeRaw === '' || !Number.isSafeInteger(node) || node <= 0) {
                skipped.push({ line, reason: `node 欄位「${nodeRaw}」不是正整數 edge id。` });
                return;
            }
            const dropMstRaw = get('dropMst').trim();
            const dropMst = dropMstRaw === '' ? undefined : Number(dropMstRaw);
            rows.push({
                ts, map, node,
                boss: get('boss').trim() === '1' || get('boss').trim().toLowerCase() === 'true',
                rank: normalizeRank(get('rank')),
                drop,
                ...(dropMst != null && Number.isSafeInteger(dropMst) && dropMst > 0 ? { dropMst } : {}),
            });
        });
        return { format: 'own', rows, skipped };
    }

    if (isLogbookHeader(header)) {
        const idx = (label: string) => LOGBOOK_HEADER_PREFIX.indexOf(label);
        const rows: ParsedDropRow[] = [];
        const skipped: DropLogParseResult['skipped'] = [];
        dataRows.forEach((cells, i) => {
            const line = i + 2;
            const cellText = cells[idx('マス')] ?? '';
            const dropName = (cells[idx('ドロップ艦娘')] ?? '').trim();
            if (!dropName || dropName === '※空きなし') return; // 沒有掉落，不是錯誤，靜默跳過
            const ts = parseTimestamp(cells[idx('日付')] ?? '');
            if (ts == null) { skipped.push({ line, reason: '日付欄位不是可解析的時間戳。' }); return; }
            const map = mapFromCellText(cellText);
            if (!map) { skipped.push({ line, reason: `マス欄位「${cellText}」看不出海域編號。` }); return; }
            const bossText = cells[idx('出撃')] ?? '';
            const enemyName = (cells[idx('敵艦隊')] ?? '').trim();
            const dropMst = resolveShipMst?.(dropName);
            rows.push({
                ts, map, node: 0,
                boss: cellText.includes('ボス') || bossText.includes('ボス'),
                rank: normalizeRank(cells[idx('ランク')] ?? ''),
                drop: dropName,
                ...(dropMst ? { dropMst } : {}),
                ...(enemyName ? { enemyName } : {}),
            });
        });
        return { format: 'logbook', rows, skipped };
    }

    throw new DropLogImportError('不是本分區匯出的 CSV，也不是航海日誌拡張版的戦績／ドロップ報告書格式。');
}

// ── 匯出 ────────────────────────────────────────────────────────────────

/** 固定欄位、不受目前顯示欄位設定影響——這是可重新匯入的資料交換格式，不是螢幕截圖。 */
export function dropLogCsvRows(rows: SortieLogRow[]): string[][] {
    return [OWN_HEADER, ...rows.map(r => [
        new Date(r.ts).toISOString(),
        r.map,
        String(r.node),
        r.boss ? '1' : '0',
        r.rank,
        r.drop ?? '',
        r.dropMst != null ? String(r.dropMst) : '',
    ])];
}

export function dropLogCsvText(rows: SortieLogRow[]): string {
    return rowsToCsv(dropLogCsvRows(rows));
}

/** 依目前 master 建「艦名→id」反查表（第一個符合的優先），供航海日誌匯入解析 dropMst 用。 */
export function reverseShipLookup(master: Map<number, { name: string }>): (name: string) => number | undefined {
    const byName = new Map<string, number>();
    for (const [id, { name }] of master) if (!byName.has(name)) byName.set(name, id);
    return name => byName.get(name);
}

// ── 落地 ────────────────────────────────────────────────────────────────

/** 兩筆掉落紀錄是否視為同一筆：同海域＋時間容差內＋（有 master id 就比對它，否則比對名稱）。 */
const TIME_TOLERANCE_MS = 10 * 60 * 1000;

function isDuplicateDrop(a: ParsedDropRow, b: SortieLogRow): boolean {
    if (a.map !== b.map) return false;
    if (Math.abs(a.ts - b.ts) > TIME_TOLERANCE_MS) return false;
    if (a.node > 0 && b.node > 0 && a.node !== b.node) return false;
    if (a.dropMst && b.dropMst) return a.dropMst === b.dropMst;
    return a.drop === (b.drop ?? '');
}

function reservationProbe() {
    return { ts: 0, path: '__kc_drop_log_import_reservation__', api: null, req: {} };
}

export interface DropLogImportResult { added: number; duplicates: number; }

/**
 * 寫入匯入的掉落列。**去重在 transaction 內做**（同批次內互相去重，也對既有資料去重），
 * 重複列整批跳過並回報筆數，不覆寫既有紀錄——與 sortie-import.ts 不同的是這裡不是
 * 「整批要嘛全進、要嘛全退」，重複只跳過那一列，其餘新列照常寫入（CSV 批量匯入的常見情境
 * 是「這份清單裡有一半我已經有了」，逐列跳過才是使用者要的合併行為）。
 */
export async function importDropLogRows(database: KcDb, rows: ParsedDropRow[]): Promise<DropLogImportResult> {
    let added = 0;
    let duplicates = 0;
    await database.transaction('rw', [database.events, database.sorties], async () => {
        const existing = (await database.sorties.toArray()).filter(r => r.kind === 'battle' && (r.drop || r.dropMst));
        for (const row of rows) {
            if (existing.some(e => isDuplicateDrop(row, e))) { duplicates++; continue; }
            const id = await database.events.add(reservationProbe());
            if (!Number.isSafeInteger(id) || id < 1) throw new DropLogImportError('events key generator 已超出安全整數範圍。');
            await database.events.delete(id);
            const inserted: SortieLogRow = {
                eventId: id, sortieKey: id, ts: row.ts, map: row.map, node: row.node, boss: row.boss,
                kind: 'battle', rank: row.rank, seiku: null, enemyIds: [], enemyIdsEscort: [],
                drop: row.drop, taiha: false, imported: true,
                ...(row.dropMst ? { dropMst: row.dropMst } : {}),
                ...(row.enemyName ? { enemyName: row.enemyName } : {}),
            };
            await database.sorties.put(inserted);
            existing.push(inserted);
            added++;
        }
    });
    return { added, duplicates };
}
