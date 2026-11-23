// 戰果目標設定的本機偏好持久化（localStorage，panel 與 overview 同 origin 共享）。
//
// 刻意獨立於 utils/ui-prefs.ts：不匯入 state-display／ui-i18n，讓 utils/backup.ts 可在
// 無 DOM／無字串表環境下直接讀寫與驗證，不把多語字典拉進非 UI 打包產物。
// 預設為 null（不設目標、只看累積值），不替玩家假設目標群別；SenkaTarget 型別本身不含 'none'。

import type { SenkaTarget } from './senka-calibration';

export const SENKA_TARGET_KEY = 'kc-senka-target';

/** 介面提供且備份允許的標準目標群別名次（聯合 5／一群 20／二群 100／三群 500）。 */
export const SENKA_TARGET_RANKS = [5, 20, 100, 500] as const;
export type SenkaTargetRank = (typeof SENKA_TARGET_RANKS)[number];

const TARGET_RANK_SET = new Set<number>(SENKA_TARGET_RANKS);

/** 檢查是否為四個標準目標群別名次之一。 */
export function isSenkaTargetRank(value: unknown): value is SenkaTargetRank {
    return typeof value === 'number' && TARGET_RANK_SET.has(value);
}

/** 驗證並正規化戰果目標設定；不合法或空值一律回傳 null（不設目標）。 */
export function parseSenkaTarget(raw: unknown): SenkaTarget | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as { type?: unknown; rank?: unknown; score?: unknown };
    if (obj.type === 'rank') {
        return isSenkaTargetRank(obj.rank) ? { type: 'rank', rank: obj.rank } : null;
    }
    if (obj.type === 'custom') {
        return typeof obj.score === 'number' && Number.isSafeInteger(obj.score) && obj.score >= 0
            ? { type: 'custom', score: obj.score === 0 ? 0 : obj.score }
            : null;
    }
    return null;
}

/** 讀取本機戰果目標設定；無設定、無 localStorage 或壞值時回傳 null（不設目標）。 */
export function loadSenkaTarget(): SenkaTarget | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(SENKA_TARGET_KEY);
        if (raw === null) return null;
        return parseSenkaTarget(JSON.parse(raw));
    } catch {
        return null;
    }
}

/** 寫入本機戰果目標設定；傳入 null（或無效值）時移除鍵以表示不設目標。 */
export function saveSenkaTarget(target: SenkaTarget | null): SenkaTarget | null {
    const normalized = target === null ? null : parseSenkaTarget(target);
    try {
        if (typeof localStorage === 'undefined') return normalized;
        if (normalized === null) localStorage.removeItem(SENKA_TARGET_KEY);
        else localStorage.setItem(SENKA_TARGET_KEY, JSON.stringify(normalized));
    } catch { /* 隱私模式或禁用儲存時維持記憶體狀態 */ }
    return normalized;
}

/** 其他已開頁面變更目標設定時通知（storage 事件只在非發動變更的頁面觸發）。 */
export function onSenkaTargetChange(
    cb: (target: SenkaTarget | null) => void,
    signal?: AbortSignal,
): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    if (signal?.aborted) return;
    const handler = (event: StorageEvent) => {
        if (signal?.aborted) return;
        if (event.key === SENKA_TARGET_KEY || event.key === null) {
            cb(loadSenkaTarget());
        }
    };
    window.addEventListener('storage', handler, signal ? { signal } : undefined);
    // linkedom 不支援 addEventListener 的 AbortSignal 選項，abort 時顯式移除。
    signal?.addEventListener('abort', () => window.removeEventListener('storage', handler), { once: true });
}
