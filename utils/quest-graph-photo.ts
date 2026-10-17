// 任務關係圖「拍照」的純函式：節點名稱換行、輸出比例與檔名（無 chrome.*／DOM）。
// 繪製本身在 entrypoints/overview/quest-graph-photo.ts，讀畫面上的實際樣式畫到 canvas。

/** canvas 單邊上限：Chrome 對單一 canvas 的面積與邊長都有限制，超過會畫不出來。 */
export const QUEST_GRAPH_PHOTO_MAX_SIDE = 8000;

/**
 * 輸出倍率：預設 2 倍讓字清楚；圖太大時縮到單邊不超過上限，但至少 1 倍。
 * 圖再大就照 1 倍輸出（單邊上限內），不為了塞進上限把字縮到看不清。
 */
export function questGraphPhotoScale(width: number, height: number, preferred = 2): number {
    if (!(width > 0 && height > 0)) return 1;
    const fit = Math.min(QUEST_GRAPH_PHOTO_MAX_SIDE / width, QUEST_GRAPH_PHOTO_MAX_SIDE / height);
    return Math.max(1, Math.min(preferred, fit));
}

/**
 * 依寬度斷行，最多 maxLines 行，超出的最後一行以「…」收尾（同畫面上兩行截斷）。
 * 漢字與假名可在任意字元間斷行；拉丁文優先在空白處斷，單字本身比整行長時才硬斷。
 */
export function wrapQuestGraphText(
    text: string, maxWidth: number, maxLines: number, measure: (value: string) => number,
): string[] {
    const chars = [...text.replace(/\s+/g, ' ').trim()];
    const lines: string[] = [];
    let index = 0;
    while (index < chars.length && lines.length < maxLines) {
        let end = index;
        while (end < chars.length && measure(chars.slice(index, end + 1).join('')) <= maxWidth) end++;
        if (end === index) end = index + 1;
        if (end < chars.length) {
            const space = chars.slice(index, end).lastIndexOf(' ');
            if (space > 0 && /[A-Za-z0-9]/.test(chars[end])) end = index + space + 1;
        }
        lines.push(chars.slice(index, end).join('').trim());
        index = end;
        while (chars[index] === ' ') index++;
    }
    if (index < chars.length && lines.length) {
        let last = lines[lines.length - 1];
        while (last && measure(`${last}…`) > maxWidth) last = [...last].slice(0, -1).join('');
        lines[lines.length - 1] = `${last.trimEnd()}…`;
    }
    return lines;
}

/** 下載檔名：`quest-graph-<任務代號>-<本機時間>.png`；代號只留檔名安全的字元。 */
export function questGraphPhotoFilename(code: string, ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const safe = code.replace(/[^0-9A-Za-z_-]+/g, '') || 'quest';
    return `quest-graph-${safe}-${stamp}.png`;
}
