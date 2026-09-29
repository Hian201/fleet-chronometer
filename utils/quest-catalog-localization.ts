import questCatalogTranslations from './quest-catalog-translations.json';
import questCatalogRewardNames from './quest-catalog-reward-names.json';
import questCatalogRewards from './quest-catalog-rewards.json';
import { esc } from './html-escape';
import { tFor } from './ui-i18n';

export type QuestCatalogLocale = 'en' | 'zh-TW';
export type QuestDisplayLocale = QuestCatalogLocale | 'ja';

export interface QuestCatalogTranslation {
    name: string;
    detail: string;
}

const WORLD_AREAS: Record<string, {
    zhTW: string;
    en: string;
    range: string;
}> = {
    '1': { zhTW: '鎮守府海域', en: 'Home Waters', range: '1-1～1-6' },
    '2': { zhTW: '南西諸島海域', en: 'Southwest Islands Sea', range: '2-1～2-5' },
    '3': { zhTW: '北方海域', en: 'Northern Sea', range: '3-1～3-5' },
    '4': { zhTW: '西方海域', en: 'Western Sea', range: '4-1～4-5' },
    '5': { zhTW: '南方海域', en: 'Southern Sea', range: '5-1～5-6' },
    '6': { zhTW: '中部海域', en: 'Central Sea', range: '6-1～6-5' },
    '7': { zhTW: '南西海域', en: 'Southwest Sea', range: '7-1～7-5' },
};

const MAP_NAMES: Record<string, { zhTW: string; en: string }> = {
    '1-1': { zhTW: '鎮守府正面海域', en: 'Home Port Front Sea' },
    '1-2': { zhTW: '南西諸島沖', en: 'Nansei Islands Offshore' },
    '1-3': { zhTW: '煉油廠地帶沿岸', en: 'Oil Refinery Coastal Area' },
    '1-4': { zhTW: '南西諸島防衛線', en: 'Nansei Islands Defense Line' },
    '1-5': { zhTW: '鎮守府近海', en: 'Home Port Offshore' },
    '1-6': { zhTW: '鎮守府近海航路', en: 'Home Port Offshore Route' },
    '2-1': { zhTW: '南西諸島近海', en: 'Nansei Islands Offshore' },
    '2-2': { zhTW: '巴士海峽', en: 'Bashi Strait' },
    '2-3': { zhTW: '東部奧廖爾海', en: 'Eastern Orel Sea' },
    '2-4': { zhTW: '沖之島海域', en: 'Okinoshima Sea' },
    '2-5': { zhTW: '沖之島沖戰鬥哨戒', en: 'Okinoshima Offshore Combat Patrol' },
    '3-1': { zhTW: '莫雷海', en: 'Moray Sea' },
    '3-2': { zhTW: '基斯島沖', en: 'Kis Island Offshore' },
    '3-3': { zhTW: '阿爾馮西諾方面', en: 'Alfonsino Area' },
    '3-4': { zhTW: '北方海域全域', en: 'Northern Sea Area' },
    '3-5': { zhTW: '北方 AL 海域', en: 'Northern AL Sea' },
    '4-1': { zhTW: '爪姆島沖', en: 'Jam Island Offshore' },
    '4-2': { zhTW: '咖哩洋海域', en: 'Curry Ocean' },
    '4-3': { zhTW: '里蘭卡島空襲', en: 'Rilanka Island Air Raid' },
    '4-4': { zhTW: '卡斯達馬島沖海戰', en: 'Kasugadama Island Offshore Battle' },
    '4-5': { zhTW: '咖哩洋里蘭卡島沖', en: 'Curry Ocean Off Rilanka Island' },
    '5-1': { zhTW: '南方海域前面', en: 'Southern Sea Front' },
    '5-2': { zhTW: '珊瑚諸島沖海戰', en: 'Coral Islands Offshore Battle' },
    '5-3': { zhTW: '第一次鮭魚海沖海戰', en: 'First Battle of Salmon Offshore' },
    '5-4': { zhTW: '鮭魚海沖海戰', en: 'Battle of Salmon Offshore' },
    '5-5': { zhTW: '第二次鮭魚海戰', en: 'Second Battle of the Salmon Sea' },
    '5-6': { zhTW: '拉包爾方面海域', en: 'Rabaul Area' },
    '6-1': { zhTW: '中部海域哨戒線', en: 'Central Sea Patrol Line' },
    '6-2': { zhTW: 'MS 諸島防衛戰', en: 'MS Islands Defense Battle' },
    '6-3': { zhTW: 'K 作戰', en: 'Operation K' },
    '6-4': { zhTW: '離島再攻略作戰', en: 'Island Reclamation Operation' },
    '6-5': { zhTW: '空母機動部隊迎擊戰', en: 'Carrier Task Force Interception' },
    '7-1': { zhTW: '汶萊泊地沖哨戒', en: 'Brunei Anchorage Offshore Patrol' },
    '7-2': { zhTW: '塔威塔威泊地沖', en: 'Tawi-Tawi Anchorage Offshore' },
    '7-3': { zhTW: '檳城島近海', en: 'Penang Island Offshore' },
    '7-4': { zhTW: '昭南本土航路', en: 'Shonan Mainland Route' },
    '7-5': { zhTW: '爪哇島近海', en: 'Java Island Offshore' },
};

type RawQuestTranslation = Partial<Record<QuestCatalogLocale, Partial<QuestCatalogTranslation>>>;
const BASE_TRANSLATIONS = questCatalogTranslations as Record<string, RawQuestTranslation>;

type QuestRewardLocale = QuestDisplayLocale;
type RawQuestReward = {
    sourceWikiId: string;
    resources: { fuel: number; ammo: number; steel: number; bauxite: number };
    otherJa: string;
};
type RewardItemName = { 'zh-TW': string; en: string };
type QuestRewardGroup = {
    kind: 'fixed' | 'choice';
    index?: number;
    items: Array<{ name: string; quantity?: number; enhancement?: string }>;
};
type LocalizedQuestRewardGroup = {
    kind: 'fixed' | 'choice';
    index?: number;
    label: string;
    items: string[];
};

export interface LocalizedQuestReward {
    verified: boolean;
    title: string;
    pendingLabel: string;
    resources: Array<{ label: string; amount: number }>;
    groups: LocalizedQuestRewardGroup[];
}

const REWARDS = questCatalogRewards as Record<string, RawQuestReward>;
const REWARD_NAMES = questCatalogRewardNames as Record<string, RewardItemName>;
const RESOURCE_KEYS = [
    ['fuel', 'mat.fuel.full', '燃料'],
    ['ammo', 'mat.ammo.full', '弾薬'],
    ['steel', 'mat.steel.full', '鋼材'],
    ['bauxite', 'mat.bauxite.full', 'ボーキサイト'],
] as const;
const REWARD_NAME_ALIASES: Record<string, string> = {
    '家具箱(小)': '家具箱（小）',
    '家具箱(中)': '家具箱（中）',
    '家具箱(大)': '家具箱（大）',
    '家具箱中': '家具箱（中）',
    '家具職人': '特注家具職人',
    '高速修復剤': '高速修復材',
    '書類一式&指輪': '書類一式＆指輪',
};
const REWARD_RESOURCE_KEYS: Record<string, string> = {
    燃料: 'mat.fuel.full',
    弾薬: 'mat.ammo.full',
    鋼材: 'mat.steel.full',
    ボーキサイト: 'mat.bauxite.full',
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

function localeResourceKey(name: string): string | undefined {
    return REWARD_RESOURCE_KEYS[name];
}

function parseQuestRewardGroups(otherJa: string): QuestRewardGroup[] {
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

function localizedRewardItem(name: string, locale: QuestRewardLocale): string {
    if (locale === 'ja') return name;
    const resourceKey = localeResourceKey(name);
    if (resourceKey) return tFor(locale, resourceKey);
    const inventorySlots = name.match(/^装備運用枠\+(\d+)装備分$/);
    if (inventorySlots) {
        return locale === 'en'
            ? `Equipment storage slots +${inventorySlots[1]}`
            : `裝備持有欄位 +${inventorySlots[1]}`;
    }
    const rankingPoints = name.match(/^戦果\+(\d+)$/);
    if (rankingPoints) {
        return locale === 'en'
            ? `Ranking points +${rankingPoints[1]}`
            : `戰果 +${rankingPoints[1]}`;
    }
    return REWARD_NAMES[name]?.[locale] ?? name;
}

export function localizedQuestReward(
    apiNo: number,
    locale: QuestRewardLocale,
): LocalizedQuestReward {
    const source = REWARDS[String(apiNo)];
    const resources = source
        ? RESOURCE_KEYS.flatMap(([key, labelKey]) => {
            const amount = source.resources[key];
            return amount > 0 ? [{ label: tFor(locale, labelKey), amount }] : [];
        })
        : [];
    const rawGroups = source ? parseQuestRewardGroups(source.otherJa) : [];
    const verified = Boolean(source && (resources.length > 0 || rawGroups.length > 0));
    return {
        verified,
        title: tFor(locale, 'quest.reward.title'),
        pendingLabel: tFor(locale, 'quest.reward.pending'),
        resources,
        groups: rawGroups.map(group => ({
            ...group,
            label: group.kind === 'fixed'
                ? tFor(locale, 'quest.reward.fixed')
                : group.index === undefined
                    ? tFor(locale, 'quest.reward.choice')
                    : tFor(locale, 'quest.reward.choiceNumbered', { n: group.index }),
            items: group.items.map(item => {
                const quantity = item.quantity === undefined ? '' : ` ×${item.quantity}`;
                return `${localizedRewardItem(item.name, locale)}${item.enhancement ?? ''}${quantity}`;
            }),
        })),
    };
}

export function localizedQuestRewardHtml(apiNo: number, locale: QuestRewardLocale): string {
    const reward = localizedQuestReward(apiNo, locale);
    const resources = reward.resources.length
        ? `<div class="quest-reward-resources">${reward.resources.map(resource =>
            `<span>${esc(resource.label)} ${resource.amount.toLocaleString()}</span>`).join('')}</div>`
        : '';
    const groups = reward.groups.map(group => {
        const separator = group.kind === 'choice' ? ' / ' : (locale === 'zh-TW' ? '、' : ', ');
        return `<div class="quest-reward-group"><span class="quest-reward-kind">${esc(group.label)}</span><span class="quest-reward-values">${group.items.map(esc).join(separator)}</span></div>`;
    }).join('');
    const contents = reward.verified
        ? `${resources}${groups}`
        : `<div class="quest-reward-pending">${esc(reward.pendingLabel)}</div>`;
    return `<div class="quest-rewards"><strong class="quest-reward-title">${esc(reward.title)}</strong>${contents}</div>`;
}

export function questCatalogTranslation(
    apiNo: number,
    locale: QuestCatalogLocale,
): QuestCatalogTranslation | undefined {
    const base = BASE_TRANSLATIONS[String(apiNo)]?.[locale];
    if (!base?.name || !base.detail) return undefined;
    return { name: base.name, detail: base.detail };
}

function mapReference(reference: string, locale: QuestCatalogLocale): string {
    const [world, map, node] = reference.split('-');
    const area = WORLD_AREAS[world];
    if (!area) return reference;
    if (!map) {
        return locale === 'en'
            ? `World ${world} (${area.en}; maps ${area.range.replace('～', ' to ')})`
            : `${area.zhTW}（${area.range}）`;
    }

    const mapId = `${world}-${map}`;
    const fullId = canonicalMapReference(reference);
    const specificName = locale === 'en' ? MAP_NAMES[mapId]?.en : MAP_NAMES[mapId]?.zhTW;
    const areaName = locale === 'en' ? area.en : area.zhTW;
    if (locale === 'en') {
        return `${fullId} (${areaName}${specificName ? `; ${specificName}` : ''})`;
    }
    return `${fullId}（${areaName}${specificName ? `；${specificName}` : ''}）`;
}

const MAP_TOKEN = /\[W([1-7](?:-[1-6](?:-[A-Z0-9]+)?)?)\]/g;
const BARE_MAP_ID = /(?<![0-9A-Za-z~～])([1-7]-[1-6](?:-[A-Z0-9]+)?)(?![0-9A-Za-z~～])/g;
const EN_BARE_MAP_ID = /\b(to|in|at|on|map)\s+([1-7]-[1-6](?:-[A-Z0-9]+)?)(?![0-9A-Za-z~～])/gi;
const BARE_MAP_AREA = /(?<![0-9A-Za-z])([1-7])\s*圖/g;

function canonicalMapReference(reference: string): string {
    const [world, map, node] = reference.split('-');
    if (world === '1' && map === '6' && node === 'N') return '1-6';
    if (world === '7' && map === '2' && ['M', 'P2'].includes(node)) return '7-2-2';
    if (world === '7' && map === '3' && node === 'E') return '7-3-1';
    if (world === '7' && map === '3' && node === 'P') return '7-3-2';
    if (world === '7' && map === '5' && node === 'Q') return '7-5-2';
    if (world === '7' && map === '5' && node === 'T') return '7-5-3';
    return reference;
}

export function localizeQuestMapReferences(
    text: string,
    locale: QuestCatalogLocale,
    englishSource = '',
): string {
    if (locale === 'zh-TW') {
        const localized = text
            .replace(BARE_MAP_AREA, (_match, world: string) =>
                mapReference(world, locale));
        const withMapNames = localized
            .replace(BARE_MAP_ID, (_match, reference: string) => mapReference(reference, locale))
            .replace(MAP_TOKEN, (_match, reference: string) => mapReference(reference, locale));
        const existing = new Set<string>();
        const addExisting = (reference: string): void => {
            const canonical = canonicalMapReference(reference);
            existing.add(canonical);
            const [world, map, node] = canonical.split('-');
            if (map && node) existing.add(`${world}-${map}`);
        };
        for (const match of withMapNames.matchAll(BARE_MAP_ID)) {
            addExisting(match[1]);
        }
        for (const match of withMapNames.matchAll(MAP_TOKEN)) {
            addExisting(match[1]);
        }
        const missing = [...englishSource.matchAll(MAP_TOKEN)]
            .map(match => canonicalMapReference(match[1]))
            .filter((reference, index, references) =>
                references.indexOf(reference) === index && !existing.has(reference));
        if (!missing.length) return withMapNames;
        return `${withMapNames}（海域對照：${missing.map(reference =>
            mapReference(reference, locale)).join('；')}）`;
    }

    const localized = text
        .replace(EN_BARE_MAP_ID, (_match, prefix: string, reference: string) =>
            `${prefix} ${mapReference(reference, locale)}`)
        .replace(MAP_TOKEN, (_match, reference: string) => mapReference(reference, locale));
    return localized.replace(/\bNansei Islands Region\b/gi,
        'World 2 (Southwest Islands Sea; maps 2-1 to 2-5)');
}

export function localizedQuestName(
    apiNo: number,
    locale: QuestDisplayLocale,
    japaneseFallback: string,
): string {
    if (locale === 'ja') return japaneseFallback;
    const translation = questCatalogTranslation(apiNo, locale);
    return translation?.name
        ? localizeQuestMapReferences(translation.name, locale)
        : japaneseFallback;
}

export function localizedQuestDetail(
    apiNo: number,
    locale: QuestDisplayLocale,
    japaneseFallback: string,
): string {
    if (locale === 'ja') return japaneseFallback;
    const translation = questCatalogTranslation(apiNo, locale);
    if (!translation?.detail) return japaneseFallback;
    const englishDetail = questCatalogTranslation(apiNo, 'en')?.detail;
    return localizeQuestMapReferences(translation.detail, locale, englishDetail);
}
