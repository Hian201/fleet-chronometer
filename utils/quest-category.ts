// 任務種類（純函式，無 chrome.*）：遊戲任務清單以 api_category 分色，面板與任務導覽依此對齊。

export type QuestCategory =
    | 'composition' | 'sortie' | 'practice' | 'expedition'
    | 'supply-dock' | 'arsenal' | 'modernization' | 'unknown';

/**
 * api_category → 種類。對照依 samples/Quest.json 的封包與任務目錄互相核對：
 * 出擊分成 2／8／9／10 四個值（依任務編號段），工廠分成 6／11。未見過的值回傳 unknown，不猜。
 */
const API_CATEGORY: Readonly<Record<number, QuestCategory>> = {
    1: 'composition',
    2: 'sortie',
    3: 'practice',
    4: 'expedition',
    5: 'supply-dock',
    6: 'arsenal',
    7: 'modernization',
    8: 'sortie',
    9: 'sortie',
    10: 'sortie',
    11: 'arsenal',
};

export function questCategoryFromApi(value: unknown): QuestCategory {
    return typeof value === 'number' ? API_CATEGORY[value] ?? 'unknown' : 'unknown';
}

export const QUEST_CATEGORY_LABEL_KEYS: Readonly<Record<QuestCategory, string>> = {
    composition: 'ov.qfCategoryComposition',
    sortie: 'ov.qfCategorySortie',
    practice: 'ov.qfCategoryPractice',
    expedition: 'ov.qfCategoryExpedition',
    'supply-dock': 'ov.qfCategorySupplyDock',
    arsenal: 'ov.qfCategoryArsenal',
    modernization: 'ov.qfCategoryModernization',
    unknown: 'ov.qfCategoryUnknown',
};
