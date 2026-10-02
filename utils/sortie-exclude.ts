// 「不記錄的海域」：使用者指定的通常海域，之後的出擊不寫入 db.sorties／db.replays。
//
// 只影響 EventProjector 的 derived 寫入；GameState.applyEvent() 照常執行，任務條件計數、
// 戰況顯示與 raw events 都不受影響。已存在的出擊紀錄也不會被刪除或隱藏。
//
// 只收通常海域（world 1–9）：活動海域的 Boss HP 斬殺線與斬殺旗標要從 db.sorties／
// db.replays 回推，排除後會讓量表推算失去依據。
//
// 偏好存 localStorage（panel 與 overview 同一 extension origin 共享），不用 chrome.storage，
// 理由同 utils/ui-prefs.ts。讀寫失敗一律回退為「沒有排除任何海域」，寧可多記也不漏記。

const STORAGE_KEY = 'kc-sortie-exclude-maps';
const MAP_RE = /^([1-9])-([1-9])$/;

/** 正規化成 `${world}-${mapnum}`；非通常海域或格式不符回 null。 */
export function normalizeExcludedMap(raw: string): string | null {
    const text = raw.trim().replace(/[－ー—–]/g, '-').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    return MAP_RE.test(text) ? text : null;
}

/** 解析儲存值：只留有效、去重，依海域序排列。 */
export function parseExcludedMaps(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const maps = new Set<string>();
    for (const item of raw) {
        if (typeof item !== 'string') continue;
        const map = normalizeExcludedMap(item);
        if (map) maps.add(map);
    }
    return [...maps].sort((a, b) => {
        const [aw, am] = a.split('-').map(Number);
        const [bw, bm] = b.split('-').map(Number);
        return aw - bw || am - bm;
    });
}

export interface ExcludeAreaGroup {
    area: number;
    maps: string[];
}

/** 下拉候選依海域編號分組（1-x、2-x…），已排除的不再列出。 */
export function excludeCandidateGroups(candidates: Iterable<string>, excluded: readonly string[]): ExcludeAreaGroup[] {
    const skip = new Set(excluded);
    const groups = new Map<number, string[]>();
    for (const map of parseExcludedMaps([...candidates])) {
        if (skip.has(map)) continue;
        const area = Number(map.split('-')[0]);
        const maps = groups.get(area) ?? [];
        maps.push(map);
        groups.set(area, maps);
    }
    return [...groups].map(([area, maps]) => ({ area, maps }));
}

export function loadExcludedMaps(): string[] {
    try {
        return parseExcludedMaps(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    } catch {
        return [];
    }
}

export function saveExcludedMaps(maps: readonly string[]): string[] {
    const normalized = parseExcludedMaps(maps);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch { /* 隱私模式等：維持記憶體值 */ }
    return normalized;
}

/** 其他已開頁面改了清單時通知（storage 事件只在非發動變更的頁面觸發）。 */
export function onExcludedMapsChange(cb: (maps: string[]) => void): void {
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY) cb(loadExcludedMaps());
    });
}
