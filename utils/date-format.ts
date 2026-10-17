// 介面上的日期一律「年/月/日」順序（專案規範，見 docs/design-guidelines.md「日期與時間」）。
//
// 不用 toLocaleString／toLocaleDateString：英文介面會變成「月/日/年」、時間還會變 12 小時制，
// 三語排序不一致，混在同一欄也無法依字串比對先後。時間一律 24 小時制、本機時區。
// 機器讀的格式（CSV、檔名、<input type="date"> 的值）另用 ISO 8601，不走這裡。
// 純函式，無 chrome.*／DOM。

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026/09/28` */
export function formatDate(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** `2026/09/28 21:32:05`；`seconds: false` 時為 `2026/09/28 21:32`。 */
export function formatDateTime(ts: number, seconds = true): string {
    const d = new Date(ts);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;
    return `${formatDate(ts)} ${time}`;
}

/** `21:32:05`（只需時刻的地方，例如偵錯清單）。 */
export function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
