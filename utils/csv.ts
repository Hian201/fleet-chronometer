// CSV／TSV 的最小共用序列化＋解析（純函式，無 chrome.*）。
//
// 目前只有匯出（resource-log.ts／ships.ts／equipment.ts 各自的 toCsv/rosterCsv/gearCsv），
// 沒有任何地方需要「讀回」CSV——直到打撈紀錄／建造紀錄要支援 CSV 匯入才第一次需要解析器，
// 故獨立成本檔共用，而非在既有匯出函式旁邊各自加一份解析邏輯。
//
// 解析同時要吃兩種分隔符：本專案自己的匯出／匯入固定用逗號；相容匯入的「航海日誌拡張版」
// （Nishisonic/logbook，MIT）匯出的所謂 CSV 其實是 Tab 分隔＋CRLF（來源：
// `logbook/gui/logic/CreateReportLogic.writeCsv()`，`StringUtils.join(header, '\t')`），
// 且不做任何欄位跳脫。偵測法：header 那一行 tab 數 > 逗號數就當 TSV，否則當 CSV。

/** RFC4046-ish：含分隔符／雙引號／換行才加雙引號，內部雙引號雙寫。 */
export function csvCell(value: string): string {
    return /["\n\r]/.test(value) || value.includes(',') ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rowsToCsv(rows: string[][]): string {
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * 解析一行分隔文字（逗號或 tab），支援雙引號跳脫（"" → "、跨欄位換行）。
 * 航海日誌的匯出不做跳脫，但一般字串裡不會出現雙引號，本解析器對「無引號」的輸入
 * 行為等同單純 split，兩種來源都適用。
 */
function splitRows(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;
    const push = () => { row.push(cell); cell = ''; };
    const pushRow = () => { push(); rows.push(row); row = []; };
    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            cell += ch; i++; continue;
        }
        if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
        if (ch === delimiter) { push(); i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') { pushRow(); i++; continue; }
        cell += ch; i++;
    }
    if (cell !== '' || row.length > 0) pushRow();
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

export interface DelimitedText {
    header: string[];
    rows: string[][];
    delimiter: string;
}

/** 依表頭那一行猜分隔符（tab 數 > 逗號數即 TSV，同 logbook 的匯出慣例），再切成表格。 */
export function parseDelimitedText(text: string): DelimitedText | null {
    const firstLineEnd = text.search(/[\r\n]/);
    const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
    const tabs = (firstLine.match(/\t/g) ?? []).length;
    const commas = (firstLine.match(/,/g) ?? []).length;
    const delimiter = tabs > commas ? '\t' : ',';
    const all = splitRows(text, delimiter);
    if (all.length === 0) return null;
    const [header, ...rows] = all;
    return { header, rows, delimiter };
}
