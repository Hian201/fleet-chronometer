// 任務導覽的可攜偏好：釘選與人工完成以遊戲 api_no 為身分，跟搜尋／篩選等暫時 UI 分開。
// 備份只帶走這兩份名單；還原時覆寫這兩陣列，其餘本機 UI 偏好維持不變。
export const QUEST_FLOW_PREFS_KEY = 'kc-overview-quest-flow';

export interface QuestFlowBackupPrefs {
    pinned: number[];
    manualComplete: number[];
}

export function emptyQuestFlowBackupPrefs(): QuestFlowBackupPrefs {
    return { pinned: [], manualComplete: [] };
}

export function hasQuestFlowBackupPrefs(prefs: QuestFlowBackupPrefs | undefined): boolean {
    return Boolean(prefs && (prefs.pinned.length > 0 || prefs.manualComplete.length > 0));
}

export function normalizeQuestApiNos(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter(no => Number.isSafeInteger(no) && no > 0))]
        .sort((a, b) => a - b);
}

export function readQuestFlowBackupPrefs(): QuestFlowBackupPrefs {
    try {
        if (typeof localStorage === 'undefined') return emptyQuestFlowBackupPrefs();
        const raw = JSON.parse(localStorage.getItem(QUEST_FLOW_PREFS_KEY) ?? 'null');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyQuestFlowBackupPrefs();
        const value = raw as { pinned?: unknown; manualComplete?: unknown };
        return {
            pinned: normalizeQuestApiNos(value.pinned),
            manualComplete: normalizeQuestApiNos(value.manualComplete),
        };
    } catch {
        return emptyQuestFlowBackupPrefs();
    }
}

/** 只覆寫釘選／人工完成；搜尋、聚焦等暫時 UI 偏好原樣留下。 */
export function applyQuestFlowBackupPrefs(prefs: QuestFlowBackupPrefs): void {
    try {
        if (typeof localStorage === 'undefined') return;
        let existing: Record<string, unknown> = {};
        try {
            const raw = JSON.parse(localStorage.getItem(QUEST_FLOW_PREFS_KEY) ?? 'null');
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                existing = raw as Record<string, unknown>;
            }
        } catch { /* 壞值整包換成這次還原的名單 */ }
        localStorage.setItem(QUEST_FLOW_PREFS_KEY, JSON.stringify({
            ...existing,
            pinned: prefs.pinned,
            manualComplete: prefs.manualComplete,
        }));
    } catch { /* 隱私模式等：靜默 */ }
}
