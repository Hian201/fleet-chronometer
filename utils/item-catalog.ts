export type ItemInventory = 'standard' | 'expansion' | 'other';
export type ItemCountSource =
    | { kind: 'useitem'; id: number }
    | { kind: 'payitem'; id: number }
    | { kind: 'material'; apiId: number }
    | { kind: 'slotitem'; nameJa: string };
export interface CatalogItem {
    inventory: ItemInventory;
    /** 目錄項目識別碼；道具持有量一律以 countSource 的實際 API 識別碼為準。 */
    id: number;
    countSource: ItemCountSource;
    names: { 'zh-TW': string; ja: string; en: string };
}
export const itemCatalog: readonly CatalogItem[] = [
    { inventory: 'standard', id: 55, countSource: { kind: 'useitem', id: 55 }, names: { 'zh-TW': '書類一式與戒指', ja: '書類一式＆指輪', en: 'Marriage Certificate and Ring' } },
    { inventory: 'standard', id: 57, countSource: { kind: 'useitem', id: 57 }, names: { 'zh-TW': '勳章', ja: '勲章', en: 'Medal' } },
    { inventory: 'standard', id: 58, countSource: { kind: 'useitem', id: 58 }, names: { 'zh-TW': '改裝設計圖', ja: '改装設計図', en: 'Remodeling Blueprint' } },
    { inventory: 'standard', id: 4, countSource: { kind: 'material', apiId: 8 }, names: { 'zh-TW': '改修資材', ja: '改修資材', en: 'Improvement Material' } },
    { inventory: 'standard', id: 59, countSource: { kind: 'useitem', id: 59 }, names: { 'zh-TW': '給糧艦「伊良湖」', ja: '給糧艦「伊良湖」', en: 'Irako' } },
    { inventory: 'standard', id: 60, countSource: { kind: 'useitem', id: 60 }, names: { 'zh-TW': '禮物箱', ja: 'プレゼント箱', en: 'Present Box' } },
    { inventory: 'standard', id: 56, countSource: { kind: 'useitem', id: 56 }, names: { 'zh-TW': '艦娘贈送的巧克力', ja: '艦娘からのチョコ', en: 'Ship-Given Chocolate' } },
    { inventory: 'standard', id: 61, countSource: { kind: 'useitem', id: 61 }, names: { 'zh-TW': '甲種勳章', ja: '甲種勲章', en: 'Medal of Honor' } },
    { inventory: 'standard', id: 74, countSource: { kind: 'useitem', id: 74 }, names: { 'zh-TW': '新型航空機設計圖', ja: '新型航空機設計図', en: 'New Aircraft Blueprint' } },
    { inventory: 'standard', id: 10, countSource: { kind: 'useitem', id: 10 }, names: { 'zh-TW': '家具箱（小）', ja: '家具箱（小）', en: 'Furniture Box (Small)' } },
    { inventory: 'standard', id: 11, countSource: { kind: 'useitem', id: 11 }, names: { 'zh-TW': '家具箱（中）', ja: '家具箱（中）', en: 'Furniture Box (Medium)' } },
    { inventory: 'standard', id: 12, countSource: { kind: 'useitem', id: 12 }, names: { 'zh-TW': '家具箱（大）', ja: '家具箱（大）', en: 'Furniture Box (Large)' } },
    { inventory: 'standard', id: 54, countSource: { kind: 'useitem', id: 54 }, names: { 'zh-TW': '給糧艦「間宮」', ja: '給糧艦「間宮」', en: 'Mamiya' } },
    { inventory: 'standard', id: 52, countSource: { kind: 'useitem', id: 52 }, names: { 'zh-TW': '特注家具職人', ja: '特注家具職人', en: 'Special Furniture Craftsman' } },
    { inventory: 'standard', id: 49, countSource: { kind: 'useitem', id: 49 }, names: { 'zh-TW': '船塢開放鑰匙', ja: 'ドック開放キー', en: 'Dock Key' } },
    { inventory: 'standard', id: 1, countSource: { kind: 'material', apiId: 6 }, names: { 'zh-TW': '高速修復材', ja: '高速修復材', en: 'Instant Repair Material' } },
    { inventory: 'standard', id: 2, countSource: { kind: 'material', apiId: 5 }, names: { 'zh-TW': '高速建造材', ja: '高速建造材', en: 'Instant Construction Material' } },
    { inventory: 'standard', id: 3, countSource: { kind: 'material', apiId: 7 }, names: { 'zh-TW': '開發資材', ja: '開発資材', en: 'Development Material' } },
    { inventory: 'standard', id: 50, countSource: { kind: 'payitem', id: 11 }, names: { 'zh-TW': '應急修理要員', ja: '応急修理要員', en: 'Emergency Repair Personnel' } },
    { inventory: 'standard', id: 51, countSource: { kind: 'payitem', id: 14 }, names: { 'zh-TW': '應急修理女神', ja: '応急修理女神', en: 'Emergency Repair Goddess' } },
    { inventory: 'standard', id: 70, countSource: { kind: 'useitem', id: 70 }, names: { 'zh-TW': '熟練搭乘員', ja: '熟練搭乗員', en: 'Skilled Crew Member' } },
    { inventory: 'standard', id: 65, countSource: { kind: 'useitem', id: 65 }, names: { 'zh-TW': '試製甲板彈射器', ja: '試製甲板カタパルト', en: 'Prototype Flight Deck Catapult' } },
    { inventory: 'standard', id: 71, countSource: { kind: 'useitem', id: 71 }, names: { 'zh-TW': 'Ne式引擎', ja: 'ネ式エンジン', en: 'Ne-Type Engine' } },
    { inventory: 'standard', id: 69, countSource: { kind: 'slotitem', nameJa: '秋刀魚の缶詰' }, names: { 'zh-TW': '秋刀魚罐頭', ja: '秋刀魚の缶詰', en: 'Canned Pacific Saury' } },
    { inventory: 'standard', id: 66, countSource: { kind: 'slotitem', nameJa: '戦闘糧食' }, names: { 'zh-TW': '戰鬥糧食', ja: '戦闘糧食', en: 'Combat Ration' } },
    { inventory: 'standard', id: 67, countSource: { kind: 'slotitem', nameJa: '洋上補給' }, names: { 'zh-TW': '洋上補給', ja: '洋上補給', en: 'Offshore Supply' } },
    { inventory: 'standard', id: 73, countSource: { kind: 'useitem', id: 73 }, names: { 'zh-TW': '設營隊', ja: '設営隊', en: 'Construction Corps' } },
    { inventory: 'standard', id: 95, countSource: { kind: 'useitem', id: 95 }, names: { 'zh-TW': '潛水艦補給物資', ja: '潜水艦補給物資', en: 'Submarine Fleet Supplies' } },
    { inventory: 'standard', id: 62, countSource: { kind: 'useitem', id: 62 }, names: { 'zh-TW': '菱餅', ja: '菱餅', en: 'Hishimochi' } },
    { inventory: 'standard', id: 63, countSource: { kind: 'useitem', id: 63 }, names: { 'zh-TW': '司令部要員', ja: '司令部要員', en: 'Headquarters Personnel' } },
    { inventory: 'standard', id: 64, countSource: { kind: 'useitem', id: 64 }, names: { 'zh-TW': '補強增設', ja: '補強増設', en: 'Reinforcement Expansion' } },
    { inventory: 'standard', id: 68, countSource: { kind: 'useitem', id: 68 }, names: { 'zh-TW': '秋刀魚', ja: '秋刀魚', en: 'Saury' } },
    { inventory: 'standard', id: 72, countSource: { kind: 'useitem', id: 72 }, names: { 'zh-TW': '裝飾材料', ja: 'お飾り材料', en: 'Decoration Material' } },
    { inventory: 'standard', id: 93, countSource: { kind: 'useitem', id: 93 }, names: { 'zh-TW': '沙丁魚', ja: '鰯', en: 'Sardine' } },
    { inventory: 'standard', id: 97, countSource: { kind: 'useitem', id: 97 }, names: { 'zh-TW': '晴天娃娃', ja: 'てるてる坊主', en: 'Teru Teru Bouzu' } },
    { inventory: 'expansion', id: 78, countSource: { kind: 'useitem', id: 78 }, names: { 'zh-TW': '戰鬥詳報', ja: '戦闘詳報', en: 'Action Report' } },
    { inventory: 'expansion', id: 101, countSource: { kind: 'useitem', id: 101 }, names: { 'zh-TW': '夜間熟練搭乘員', ja: '夜間熟練搭乗員', en: 'Night Skilled Crew Member' } },
    { inventory: 'expansion', id: 75, countSource: { kind: 'useitem', id: 75 }, names: { 'zh-TW': '新型砲熕兵裝資材', ja: '新型砲熕兵装資材', en: 'New Model Gun Armament Material' } },
    { inventory: 'expansion', id: 77, countSource: { kind: 'useitem', id: 77 }, names: { 'zh-TW': '新型航空兵裝資材', ja: '新型航空兵装資材', en: 'New Model Aircraft Armament Material' } },
    { inventory: 'expansion', id: 92, countSource: { kind: 'useitem', id: 92 }, names: { 'zh-TW': '新型噴進裝備開發資材', ja: '新型噴進装備開発資材', en: 'New Jet Equipment Development Material' } },
    { inventory: 'expansion', id: 100, countSource: { kind: 'useitem', id: 100 }, names: { 'zh-TW': '海外艦最新技術', ja: '海外艦最新技術', en: 'Latest Overseas Warship Technology' } },
    { inventory: 'expansion', id: 104, countSource: { kind: 'useitem', id: 104 }, names: { 'zh-TW': '工廠資源', ja: '工廠資源', en: 'Arsenal Resource' } },
    { inventory: 'expansion', id: 76, countSource: { kind: 'slotitem', nameJa: '戦闘糧食(特別なおにぎり)' }, names: { 'zh-TW': '戰鬥糧食（特別製飯糰）', ja: '戦闘糧食(特別なおにぎり)', en: 'Special Combat Onigiri' } },
    { inventory: 'expansion', id: 91, countSource: { kind: 'useitem', id: 91 }, names: { 'zh-TW': '緊急修理資材', ja: '緊急修理資材', en: 'Emergency Repair Material' } },
    { inventory: 'expansion', id: 94, countSource: { kind: 'useitem', id: 94 }, names: { 'zh-TW': '新型兵裝資材', ja: '新型兵装資材', en: 'New Model Armament Material' } },
    { inventory: 'expansion', id: 105, countSource: { kind: 'useitem', id: 105 }, names: { 'zh-TW': '格納庫增設', ja: '格納庫増設', en: 'Hangar Expansion' } },
    { inventory: 'expansion', id: 98, countSource: { kind: 'useitem', id: 98 }, names: { 'zh-TW': '海色緞帶', ja: '海色リボン', en: 'Sea-Colored Ribbon' } },
    { inventory: 'expansion', id: 99, countSource: { kind: 'useitem', id: 99 }, names: { 'zh-TW': '白襷', ja: '白たすき', en: 'White Sash' } },
    { inventory: 'expansion', id: 80, countSource: { kind: 'useitem', id: 80 }, names: { 'zh-TW': '聖誕精選禮物箱', ja: 'Xmas Select Gift Box', en: 'Xmas Select Gift Box' } },
    { inventory: 'expansion', id: 85, countSource: { kind: 'useitem', id: 85 }, names: { 'zh-TW': '米', ja: 'お米', en: 'Rice' } },
    { inventory: 'expansion', id: 86, countSource: { kind: 'useitem', id: 86 }, names: { 'zh-TW': '梅乾', ja: '梅干', en: 'Umeboshi' } },
    { inventory: 'expansion', id: 87, countSource: { kind: 'useitem', id: 87 }, names: { 'zh-TW': '海苔', ja: '海苔', en: 'Nori' } },
    { inventory: 'expansion', id: 88, countSource: { kind: 'useitem', id: 88 }, names: { 'zh-TW': '茶', ja: 'お茶', en: 'Tea' } },
    { inventory: 'expansion', id: 89, countSource: { kind: 'useitem', id: 89 }, names: { 'zh-TW': '鳳翔的晚餐券', ja: '鳳翔さんの夕食券', en: "Houshou's Dinner Ticket" } },
    { inventory: 'expansion', id: 90, countSource: { kind: 'useitem', id: 90 }, names: { 'zh-TW': '節分豆', ja: '節分の豆', en: 'Setsubun Beans' } },
    { inventory: 'expansion', id: 96, countSource: { kind: 'useitem', id: 96 }, names: { 'zh-TW': '南瓜', ja: '南瓜', en: 'Pumpkin' } },
    { inventory: 'expansion', id: 102, countSource: { kind: 'useitem', id: 102 }, names: { 'zh-TW': '航空特別增量糧食', ja: '航空特別増加食', en: 'Special Aviation Ration' } },
    { inventory: 'other', id: 79, countSource: { kind: 'useitem', id: 79 }, names: { 'zh-TW': '海峽勳章', ja: '海峡章', en: 'Strait Medal' } },
    { inventory: 'other', id: 81, countSource: { kind: 'useitem', id: 81 }, names: { 'zh-TW': '捷號作戰勳章（甲）', ja: '捷号章（甲）', en: 'Sho-go Medal (Hard)' } },
    { inventory: 'other', id: 82, countSource: { kind: 'useitem', id: 82 }, names: { 'zh-TW': '捷號作戰勳章（乙）', ja: '捷号章（乙）', en: 'Sho-go Medal (Normal)' } },
    { inventory: 'other', id: 83, countSource: { kind: 'useitem', id: 83 }, names: { 'zh-TW': '捷號作戰勳章（丙）', ja: '捷号章（丙）', en: 'Sho-go Medal (Easy)' } },
    { inventory: 'other', id: 84, countSource: { kind: 'useitem', id: 84 }, names: { 'zh-TW': '捷號作戰勳章（丁）', ja: '捷号章（丁）', en: 'Sho-go Medal (Casual)' } },
    { inventory: 'other', id: 103, countSource: { kind: 'useitem', id: 103 }, names: { 'zh-TW': '工廠開放鑰匙', ja: '工廠開放キー', en: 'Arsenal Key' } },
    { inventory: 'other', id: 16, countSource: { kind: 'payitem', id: 16 }, names: { 'zh-TW': '母港擴張', ja: '母港拡張', en: 'Port Expansion' } },
];
export function itemMatches(item: CatalogItem, input: string): boolean {
    const term = input.normalize('NFKC').toLocaleLowerCase().trim();
    return !term || Object.values(item.names).some(name => name.normalize('NFKC').toLocaleLowerCase().includes(term));
}

export function uncataloguedUseItem(id: number, nameJa?: string): CatalogItem {
    const fallback = nameJa || `名称未登録（ID ${id}）`;
    return {
        inventory: 'other',
        id,
        countSource: { kind: 'useitem', id },
        names: {
            'zh-TW': `未收錄道具（ID ${id}）`,
            ja: fallback,
            en: `Untranslated item (ID ${id})`,
        },
    };
}

export const itemDetails: Record<string, { zh: string; en: string }> = {
    'standard:55': { zh: '艦娘結婚時使用的文件與戒指。', en: 'Required for a ship marriage.' },
    'standard:57': { zh: '可兌換資材；累積多枚也可兌換改裝設計圖。', en: 'Exchangeable for resources or, when collected, a remodeling blueprint.' },
    'standard:4': { zh: '用於裝備改修。', en: 'Used to upgrade equipment.' },
    'standard:59': { zh: '提升艦娘士氣，可於編成畫面使用。', en: 'Raises ship morale; used from the fleet screen.' },
    'standard:60': { zh: '開啟時可選擇資源、伊良湖或資材。', en: 'Open it and choose resources, Irako, or materials.' },
    'standard:56': { zh: '可兌換資材，也可以保留。', en: 'Exchange it for resources or keep it.' },
    'standard:61': { zh: '高難度作戰的勝利證明，可兌換資材。', en: 'Awarded for high-difficulty operations; exchangeable for resources.' },
    'standard:74': { zh: '用於新型航空機開發、任務與裝備改修。', en: 'Used for new aircraft development, quests, and equipment upgrades.' },
    'standard:10': { zh: '開啟後取得 200 家具幣。', en: 'Opens for 200 furniture coins.' },
    'standard:11': { zh: '開啟後取得 400 家具幣。', en: 'Opens for 400 furniture coins.' },
    'standard:12': { zh: '開啟後取得 700 家具幣。', en: 'Opens for 700 furniture coins.' },
    'standard:54': { zh: '可於編成畫面恢復艦隊疲勞度。', en: 'Restores fleet fatigue from the fleet screen.' },
    'standard:52': { zh: '用於家具店製作特注家具。', en: 'Used to craft special furniture in the furniture shop.' },
    'standard:1': { zh: '縮短入渠時間。', en: 'Reduces repair time.' },
    'standard:2': { zh: '縮短建造時間。', en: 'Reduces construction time.' },
    'standard:3': { zh: '建造、開發等操作會使用。', en: 'Used for construction, development, and related actions.' },
    'standard:50': { zh: '裝備於艦娘後，可避免一次擊沉。', en: 'Equipped on a ship to prevent one sinking.' },
    'standard:51': { zh: '觸發後可回避擊沉，並完全恢復出擊能力。', en: 'Prevents sinking once and fully restores sortie capability.' },
    'standard:70': { zh: '編成精銳航空隊時消耗。', en: 'Consumed when forming an elite air squadron.' },
    'standard:65': { zh: '用於部分正規空母的改二改裝。', en: 'Used for remodels of certain fleet carriers.' },
    'standard:71': { zh: '可用於任務或裝備改修。', en: 'Used in quests or equipment upgrades.' },
    'standard:69': { zh: '使用後會消耗；也可與飯糰類道具搭配食用。', en: 'Consumed when used; can also be combined with onigiri-type items.' },
    'standard:66': { zh: '裝備後於戰鬥中發動，發動後消耗。', en: 'Equipped and consumed when activated in battle.' },
    'standard:67': { zh: '裝備後可在作戰途中補給艦隊燃料與彈藥；發動後消耗。', en: 'Resupplies fleet fuel and ammo during an operation; consumed when used.' },
    'standard:73': { zh: '用於設施建設，也可擴充基地航空隊。', en: 'Builds facilities and can expand land-based air squadrons.' },
    'standard:95': { zh: '潛水艦隊攻擊時使用並消耗。', en: 'Used and consumed during a submarine fleet attack.' },
    'expansion:78': { zh: '用於艦隊司令部更新與裝備改修；部分用途需要多枚。', en: 'Used for fleet command updates and equipment upgrades; some require multiple reports.' },
    'expansion:101': { zh: '編成夜間航空隊時與部隊合一並消耗。', en: 'Consumed when forming a night air squadron.' },
    'expansion:75': { zh: '用於新型砲熕兵裝開發、任務與裝備改修。', en: 'Used for new gun development, quests, and equipment upgrades.' },
    'expansion:77': { zh: '用於新型航空兵裝開發、任務與裝備改修。', en: 'Used for new aircraft armament development, quests, and equipment upgrades.' },
    'expansion:92': { zh: '用於新型噴進裝備開發。', en: 'Used to develop new jet equipment.' },
    'expansion:100': { zh: '用於海外艦大型改裝及裝備更新任務。', en: 'Used for major overseas ship remodels and equipment update quests.' },
    'expansion:104': { zh: '用於高階改裝、最新裝備改修與改修裝備回復。', en: 'Used for advanced remodels, equipment upgrades, and equipment restoration.' },
    'expansion:76': { zh: '裝備後於戰鬥中發動，發動後消耗。', en: 'Equipped and consumed when activated in battle.' },
    'expansion:94': { zh: '用於新型兵裝開發、實戰配備與裝備改修。', en: 'Used to develop, deploy, and upgrade new-model armaments.' },
    'expansion:105': { zh: '與其他資材搭配擴充航空母艦等艦船的機庫。', en: 'Used with other materials to expand aircraft carrier hangars.' },
    'expansion:98': { zh: '套用於旗艦，能力些微提升；同類緞帶會被覆蓋。', en: 'Applied to the flagship for a small stat boost; replaces the same ribbon.' },
    'expansion:99': { zh: '套用於旗艦，戰鬥力些微提升；同類襷會被覆蓋。', en: 'Applied to the flagship for a small combat boost; replaces the same sash.' },
};
