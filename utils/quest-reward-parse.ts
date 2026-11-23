// 任務目錄報酬文字（otherJa）的純函式群組解析（零外部／i18n／DOM 依賴）。

export type QuestRewardGroup = {
    kind: 'fixed' | 'choice';
    index?: number;
    items: Array<{ name: string; quantity?: number; enhancement?: string }>;
};

const REWARD_NAME_ALIASES: Record<string, string> = {
    '家具箱(小)': '家具箱（小）',
    '家具箱(中)': '家具箱（中）',
    '家具箱(大)': '家具箱（大）',
    '家具箱中': '家具箱（中）',
    '家具職人': '特注家具職人',
    '高速修復剤': '高速修復材',
    '書類一式&指輪': '書類一式＆指輪',
};

function cleanRewardItem(source: string): { name: string; quantity?: number; enhancement?: string } | null {
    let value = source.trim();
    if (!value) return null;

    // Wiki footnote markers can appear before or after the explicit item count.
    value = value.replace(/\*+\s*\d+(?=\s*(?:[xX×ｘ]\s*\d+)?\s*$)/, '').trim();
    const quantityMatch = value.match(/\s*[xX×ｘ]\s*(\d+)\s*$/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : undefined;
    if (quantityMatch) value = value.slice(0, quantityMatch.index).trim();
    value = value.replace(/\*+\s*\d+\s*$/, '').trim();
    const enhancementMatch = value.match(/★(?:\+?\d+|X|MAX)$/i);
    const enhancement = enhancementMatch?.[0];
    if (enhancementMatch) value = value.slice(0, enhancementMatch.index).trim();

    if (value.startsWith('家具『') && value.endsWith('』')) value = value.slice(3, -1);
    if (value.startsWith('「') && value.endsWith('」')) value = value.slice(1, -1);
    const openingQuotes = (value.match(/「/g) ?? []).length;
    const closingQuotes = (value.match(/」/g) ?? []).length;
    if (value.startsWith('給糧艦「') && openingQuotes > closingQuotes) value += '」';
    value = REWARD_NAME_ALIASES[value] ?? value;
    return value ? { name: value, quantity, enhancement } : null;
}

/** 將任務目錄 `otherJa` 文字拆分為確定／擇一報酬群組。 */
export function parseQuestRewardGroups(otherJa: string): QuestRewardGroup[] {
    const source = otherJa
        .replace(/\r/g, '')
        .replace(/装備運用枠\s*\n\s*(\+\d+装備分)/g, '装備運用枠$1')
        .replace(/(?=確定報酬|選択報酬)/g, '\n');
    const heading = /確定報酬|選択報酬(\d*)/g;
    const matches = [...source.matchAll(heading)];
    const groups: QuestRewardGroup[] = [];
    matches.forEach((match, index) => {
        const next = matches[index + 1];
        const start = (match.index ?? 0) + match[0].length;
        const end = next?.index ?? source.length;
        const items = source.slice(start, end)
            .split(/[・\n]/)
            .map(cleanRewardItem)
            .filter((item): item is NonNullable<typeof item> => item !== null);
        if (!items.length) return;
        const choice = match[0].startsWith('選択報酬');
        const indexValue = choice && match[1] ? Number(match[1]) : undefined;
        groups.push({ kind: choice ? 'choice' : 'fixed', index: indexValue, items });
    });
    return groups;
}
