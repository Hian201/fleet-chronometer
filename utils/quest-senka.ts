// 任務目錄的戰果獎勵結構化查詢（純函式，無 ui-i18n／chrome.*／DOM 依賴）。
// 從 utils/quest-catalog-rewards.json 的 otherJa 經 parseQuestRewardGroups 解析「戦果+N」，
// 並結合目錄與期間限定任務實裝期間供戰果計算與介面顯示使用。

import questCatalogRewards from './quest-catalog-rewards.json';
import { QUEST_CATALOG_RAW, QUEST_CATALOG_TEXT_OVERRIDES } from './quest-catalog-data';
import { LIMITED_QUEST_WINDOWS_RAW, QUEST_CATALOG_SUPPLEMENT_RAW } from './quest-graph-data';
import { parseQuestRewardGroups } from './quest-reward-parse';
import {
    questSenkaForMonth, type QuestClaimInput, type QuestSenkaResult, type SenkaMonth,
} from './senka';

/** 單一任務的戰果獎勵結構：確定報酬與選擇報酬分別累計。 */
export interface QuestSenkaReward {
    fixed: number;
    choice: number;
}

/** 含戰果獎勵的任務目錄項目摘要。 */
export interface QuestSenkaCatalogEntry {
    apiNo: number;
    wikiId: string;
    nameJa: string;
    reward: QuestSenkaReward;
    limited: boolean;
    limitedWindow?: { start: string; end: string | null };
}

type RawRewardEntry = {
    sourceWikiId?: string;
    otherJa?: string;
};

const SENKA_REWARD_RE = /^戦果\s*[+＋]\s*(\d+)$/;

/** 從任務目錄 `otherJa` 報酬文字解析確定／選擇戰果；沒有戰果時回傳 `null`。 */
export function parseQuestSenkaFromOtherJa(otherJa: string): QuestSenkaReward | null {
    if (!otherJa) return null;
    let fixed = 0;
    let choice = 0;
    for (const group of parseQuestRewardGroups(otherJa)) {
        for (const item of group.items) {
            const match = SENKA_REWARD_RE.exec(item.name);
            if (!match) continue;
            const amount = Number(match[1]);
            if (!Number.isSafeInteger(amount) || amount <= 0) continue;
            if (group.kind === 'fixed') fixed += amount;
            else choice += amount;
        }
    }
    if (fixed === 0 && choice === 0) return null;
    return { fixed, choice };
}

const catalogMeta = new Map<number, { wikiId: string; nameJa: string; limited: boolean }>();
for (const entry of QUEST_CATALOG_RAW as unknown as readonly (readonly [number, readonly string[], string, string, string, string, boolean])[]) {
    const [apiNo, wikiIds, name, , , , limited] = entry;
    catalogMeta.set(apiNo, {
        wikiId: wikiIds[0] ?? '',
        nameJa: name ?? '',
        limited: Boolean(limited),
    });
}

const supplementNames = new Map<number, string>();
for (const [apiNo, , name] of QUEST_CATALOG_SUPPLEMENT_RAW as readonly (readonly [number, string, string])[]) {
    if (name) supplementNames.set(apiNo, name);
}

const limitedWindows = new Map<number, { start: string; end: string | null }>();
for (const [apiNo, start, end] of LIMITED_QUEST_WINDOWS_RAW as readonly (readonly [number, string, string | null])[]) {
    limitedWindows.set(apiNo, { start, end });
}

const overrides = QUEST_CATALOG_TEXT_OVERRIDES as Record<string, { name?: string } | undefined>;

const senkaRewardsMap = new Map<number, QuestSenkaReward>();
const senkaCatalogMap = new Map<number, QuestSenkaCatalogEntry>();

for (const [key, raw] of Object.entries(questCatalogRewards as Record<string, RawRewardEntry>)) {
    const apiNo = Number(key);
    if (!Number.isSafeInteger(apiNo) || apiNo <= 0) continue;
    const reward = parseQuestSenkaFromOtherJa(raw.otherJa ?? '');
    if (!reward) continue;

    const meta = catalogMeta.get(apiNo);
    const limited = meta?.limited ?? false;
    const wikiId = meta?.wikiId || raw.sourceWikiId || '';
    const nameJa = overrides[key]?.name || meta?.nameJa || supplementNames.get(apiNo) || '';
    const window = limited ? limitedWindows.get(apiNo) : undefined;

    senkaRewardsMap.set(apiNo, reward);
    senkaCatalogMap.set(apiNo, {
        apiNo,
        wikiId,
        nameJa,
        reward,
        limited,
        ...(window ? { limitedWindow: { ...window } } : {}),
    });
}

/** 任務目錄中有戰果獎勵的任務報酬對照表。 */
export const QUEST_SENKA_REWARDS: ReadonlyMap<number, QuestSenkaReward> = senkaRewardsMap;

/** 任務目錄中有戰果獎勵的完整結構化項目。 */
export const QUEST_SENKA_CATALOG: ReadonlyMap<number, QuestSenkaCatalogEntry> = senkaCatalogMap;

/** 依任務 `api_no` 查詢戰果獎勵；非戰果任務或未收錄回傳 `null`。 */
export function questSenkaReward(apiNo: number): QuestSenkaReward | null {
    return QUEST_SENKA_REWARDS.get(apiNo) ?? null;
}

/** 依任務 `api_no` 查詢戰果目錄項目；非戰果任務或未收錄回傳 `null`。 */
export function questSenkaCatalogEntry(apiNo: number): QuestSenkaCatalogEntry | null {
    return QUEST_SENKA_CATALOG.get(apiNo) ?? null;
}

/** 依正式任務目錄計算指定作戰月的任務戰果。 */
export function catalogQuestSenkaForMonth(
    claims: readonly QuestClaimInput[],
    month: SenkaMonth,
): QuestSenkaResult {
    return questSenkaForMonth(claims, month, questSenkaCatalogEntry);
}
