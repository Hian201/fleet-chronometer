// 通常海域的大區名與各關名（台灣華語／英文），純資料＋查表，無 chrome.*／DOM。
// 出擊紀錄「不記錄的海域」與任務導覽的海域標示共用這一份，同一關不會有兩種譯名。
//
// 日文名一律以 start2 `api_mst_mapinfo.api_name` 為準；表中 `jp` 用來確認譯名對應的是
// 遊戲目前的關名。官方曾改名（例：2-1、2-2、4-1～4-4），有 master 名稱且對不上時不給譯名，
// 避免把舊關名的譯名套到新關上。表中 `jp` 由 tests/map-names.test.ts 與 start2 樣本逐關鎖定。
//
// 台灣華語譯名原則（全專案寫到關卡處皆同）：只有地名、假名與人名做台灣在地化——真實地名用
// 台灣通行譯名（巴士海峽、汶萊、檳城、爪哇、拉包爾）；營運以偽名影射的地點譯回實際地名
// （カレー洋→印度洋、サーモン→所羅門群島、モーレイ海→白令海…），對照由開發者確認。
// 偽名帶英文縮寫者保留縮寫（KW 瓜加林環礁、MS 馬紹爾群島），讓介面原文有跡可尋。
// 遊戲介面是「海域名＋作戰名」，海域名可跨關重複（4-1 ジャム島沖與 7-5 ジャワ島沖都譯
// 爪哇島沖），顯示時要連同作戰名才分得出來。
// 日文漢字一律沿用（沖、哨戒線、前面、製油所、諸島…），只換成繁體字形，方便對照遊戲畫面。
// 英文來源見 THIRD-PARTY-NOTICES.md §5a。

export type MapNameLocale = 'zh-TW' | 'en' | 'ja';

interface Names { zhTW: string; en: string }

export const AREA_NAMES: Readonly<Record<number, Names & { jp: string }>> = {
    1: { jp: '鎮守府海域', zhTW: '鎮守府海域', en: 'Naval Base Waters' },
    2: { jp: '南西諸島海域', zhTW: '南西諸島海域', en: 'Nansei Island Waters' },
    3: { jp: '北方海域', zhTW: '北方海域', en: 'Northern Waters' },
    4: { jp: '西方海域', zhTW: '西方海域', en: 'Western Waters' },
    5: { jp: '南方海域', zhTW: '南方海域', en: 'Southern Waters' },
    6: { jp: '中部海域', zhTW: '中部海域', en: 'Central Waters' },
    7: { jp: '南西海域', zhTW: '南西海域', en: 'South Western Waters' },
};

export const MAP_NAMES: Readonly<Record<string, Names & { jp: string }>> = {
    '1-1': { jp: '鎮守府正面海域', zhTW: '鎮守府正面海域', en: 'Sea in Front of the Naval Base' },
    '1-2': { jp: '南西諸島沖', zhTW: '南西諸島沖', en: 'Sea around the Nansei Islands' },
    '1-3': { jp: '製油所地帯沿岸', zhTW: '製油所地帶沿岸', en: 'Coastal Refinery Zone' },
    '1-4': { jp: '南西諸島防衛線', zhTW: '南西諸島防衛線', en: 'Nansei Islands Defense Line' },
    '1-5': { jp: '鎮守府近海', zhTW: '鎮守府近海', en: 'Seas Near the Naval Base' },
    '1-6': { jp: '鎮守府近海航路', zhTW: '鎮守府近海航路', en: 'Sea Route Near Naval Base' },
    '2-1': { jp: '南西諸島近海', zhTW: '南西諸島近海', en: 'Nansei Islands Coastal Waters' },
    '2-2': { jp: 'バシー海峡', zhTW: '巴士海峽', en: 'Bashi Channel' },
    '2-3': { jp: '東部オリョール海', zhTW: '東部奧廖爾海', en: 'Eastern Orel Bay' },
    '2-4': { jp: '沖ノ島海域', zhTW: '沖之島海域', en: 'Okinoshima Island' },
    '2-5': { jp: '沖ノ島沖', zhTW: '沖之島沖', en: 'Okinoshima Sea' },
    '3-1': { jp: 'モーレイ海', zhTW: '白令海', en: 'The Moray Sea' },
    '3-2': { jp: 'キス島沖', zhTW: '基斯卡島沖', en: 'The Kis Island' },
    '3-3': { jp: 'アルフォンシーノ方面', zhTW: '阿留申群島方面', en: 'The Alfonsinoes' },
    '3-4': { jp: '北方海域全域', zhTW: '北方海域全域', en: 'Throughout the Northern Sea' },
    '3-5': { jp: '北方AL海域', zhTW: '北方AL海域', en: 'Aleutian Islands Campaign' },
    '4-1': { jp: 'ジャム島沖', zhTW: '爪哇島沖', en: 'Jam Island' },
    '4-2': { jp: 'カレー洋海域', zhTW: '印度洋海域', en: 'Curry Ocean Area' },
    '4-3': { jp: 'リランカ島', zhTW: '斯里蘭卡島', en: 'Ri-Lanka Island' },
    '4-4': { jp: 'カスガダマ島', zhTW: '馬達加斯加島', en: 'Casgadama Island' },
    '4-5': { jp: 'カレー洋リランカ島沖', zhTW: '印度洋斯里蘭卡島沖', en: 'Curry Ocean Ri-Lanka Island' },
    '5-1': { jp: '南方海域前面', zhTW: '南方海域前面', en: 'The Forefront of the Southern Sea' },
    '5-2': { jp: '珊瑚諸島沖', zhTW: '珊瑚諸島沖', en: 'The Coral Islands' },
    '5-3': { jp: 'サブ島沖海域', zhTW: '薩沃島沖海域', en: 'Sav Island' },
    '5-4': { jp: 'サーモン海域', zhTW: '所羅門群島海域', en: 'Salmon Sea Area' },
    '5-5': { jp: 'サーモン海域北方', zhTW: '所羅門群島海域北方', en: 'Northern Salmon Sea Area' },
    '5-6': { jp: 'ラバウル方面海域', zhTW: '拉包爾方面海域', en: 'Rabaul Sea Area' },
    '6-1': { jp: '中部海域哨戒線', zhTW: '中部海域哨戒線', en: 'Central Waters Patrol Line' },
    '6-2': { jp: 'MS諸島沖', zhTW: 'MS 馬紹爾群島沖', en: 'MS Archipelago' },
    '6-3': { jp: 'グアノ環礁沖海域', zhTW: '強斯頓環礁沖海域', en: 'Guano Atoll Sea' },
    '6-4': { jp: '中部北海域ピーコック島沖', zhTW: '中部北海域威克島沖', en: 'Peacock Island' },
    '6-5': { jp: 'KW環礁沖海域', zhTW: 'KW 瓜加林環礁沖海域', en: 'KW Atoll Sea' },
    '7-1': { jp: 'ブルネイ泊地沖', zhTW: '汶萊泊地沖', en: 'Brunei Anchorage' },
    '7-2': { jp: 'タウイタウイ泊地沖', zhTW: '塔威塔威泊地沖', en: 'Tawi-Tawi Anchorage' },
    '7-3': { jp: 'ペナン島沖', zhTW: '檳城島沖', en: 'Penang Island' },
    '7-4': { jp: '昭南本土航路', zhTW: '昭南本土航路', en: 'Shounan Mainland Route' },
    '7-5': { jp: 'ジャワ島沖', zhTW: '爪哇島沖', en: 'Off Java Island' },
};

// 作戰名（start2 `api_mst_mapinfo.api_opetext`；遊戲畫面上關名下方的大字）。日文已與 wikiwiki
// 各大區頁逐關核對一致。英文以開發者手動查閱的 en.kancollewiki.net 為準（2-2 該站日文寫作
// 「柳輸送作戦」，遊戲為「柳作戦」，英文仍採該站）。華語以史實海戰為名者用史實譯名（5-3、5-5
// 第一／二次所羅門海戰）；7-4「ヒ船団」的ヒ取自ヒリピン（菲律賓），保留代號並括註實際地名。
export const OPERATION_NAMES: Readonly<Record<string, { jp: string; zhTW: string; en: string | null }>> = {
    '1-1': { jp: '近海警備', zhTW: '近海警備', en: 'Coastal Waters Defense' },
    '1-2': { jp: '南西諸島沖警備', zhTW: '南西諸島沖警備', en: 'Nansei Islands Sea Defense' },
    '1-3': { jp: '海上護衛作戦', zhTW: '海上護衛作戰', en: 'Maritime Escort Operation' },
    '1-4': { jp: '南1号作戦', zhTW: '南1號作戰', en: '1st Southern Operation' },
    '1-5': { jp: '鎮守府近海対潜哨戒', zhTW: '鎮守府近海對潛哨戒', en: 'Anti-submarine Patrol in Seas Near the Naval Base' },
    '1-6': { jp: '輸送船団護衛作戦', zhTW: '輸送船團護衛作戰', en: 'Convoy Escort Operation' },
    '2-1': { jp: '南西諸島哨戒', zhTW: '南西諸島哨戒', en: 'Nansei Islands Patrol' },
    '2-2': { jp: '柳作戦', zhTW: '柳作戰', en: 'Weeping Willow Transport Tactics' },
    '2-3': { jp: 'オリョール哨戒', zhTW: '奧廖爾哨戒', en: 'Orel Patrol' },
    '2-4': { jp: 'あ号艦隊決戦', zhTW: '阿號艦隊決戰', en: 'Operation A-Go: The Fleet\'s Decisive Battle' },
    '2-5': { jp: '沖ノ島沖戦闘哨戒', zhTW: '沖之島沖戰鬥哨戒', en: 'Combat Patrol Off Okinoshima' },
    '3-1': { jp: 'モーレイ海哨戒', zhTW: '白令海哨戒', en: 'Moray Sea Patrol' },
    '3-2': { jp: 'キス島撤退作戦', zhTW: '基斯卡島撤退作戰', en: 'Kis Island Withdrawal Tactics' },
    '3-3': { jp: 'アルフォンシーノ方面進出', zhTW: '阿留申群島方面進出', en: 'The Advance for Alfonsinoes' },
    '3-4': { jp: '北方海域艦隊決戦', zhTW: '北方海域艦隊決戰', en: 'Northern Sea Fleet Decisive Battle' },
    '3-5': { jp: '北方海域戦闘哨戒', zhTW: '北方海域戰鬥哨戒', en: 'Northern Sea Combat Patrol' },
    '4-1': { jp: 'ジャム島攻略作戦', zhTW: '爪哇島攻略作戰', en: 'Jam Island Capture Tactics' },
    '4-2': { jp: 'カレー洋制圧戦', zhTW: '印度洋制壓戰', en: 'Curry Ocean Takeover Battle' },
    '4-3': { jp: 'リランカ島空襲', zhTW: '斯里蘭卡島空襲', en: 'Ri Lanka Air Raid' },
    '4-4': { jp: 'カスガダマ沖海戦', zhTW: '馬達加斯加沖海戰', en: 'Casgadama Island Naval Battle' },
    '4-5': { jp: '深海東洋艦隊漸減作戦', zhTW: '深海東洋艦隊漸減作戰', en: 'Reduction of Abyssal Eastern Ocean Fleet' },
    '5-1': { jp: '南方海域進出作戦', zhTW: '南方海域進出作戰', en: 'Southern Sea Advancement Tactics' },
    '5-2': { jp: '珊瑚諸島沖海戦', zhTW: '珊瑚諸島沖海戰', en: 'Coral Islands Naval Battle' },
    '5-3': { jp: '第一次サーモン沖海戦', zhTW: '第一次所羅門海戰', en: 'First Battle of the Solomon Sea' },
    '5-4': { jp: '東京急行', zhTW: '東京急行', en: 'Tokyo Express' },
    '5-5': { jp: '第二次サーモン海戦', zhTW: '第二次所羅門海戰', en: 'Second Battle of the Solomon Sea' },
    '5-6': { jp: 'ラバウル空襲艦隊を討て', zhTW: '討伐拉包爾空襲艦隊', en: 'Destroy the Rabaul Air Raid Force' },
    '6-1': { jp: '潜水艦作戦', zhTW: '潛水艦作戰', en: 'Submarine Operation' },
    '6-2': { jp: 'MS諸島防衛戦', zhTW: 'MS 馬紹爾群島防衛戰', en: 'Defense of the MS Archipelago' },
    '6-3': { jp: 'K作戦', zhTW: 'K作戰', en: 'Operation K' },
    '6-4': { jp: '離島再攻略作戦', zhTW: '離島再攻略作戰', en: 'Island Recapture Operation' },
    '6-5': { jp: '空母機動部隊迎撃戦', zhTW: '空母機動部隊迎擊戰', en: 'Carrier Task Force Interception' },
    '7-1': { jp: 'ブルネイ泊地沖哨戒', zhTW: '汶萊泊地沖哨戒', en: 'Brunei Anchorage Sea Patrol' },
    '7-2': { jp: 'セレベス海戦闘哨戒', zhTW: '西里伯斯海戰鬥哨戒', en: 'Celebes Sea Combat Patrol' },
    '7-3': { jp: 'マラッカ海峡を抜けて', zhTW: '穿越麻六甲海峽', en: 'Breaking Through Malacca Strait' },
    '7-4': { jp: 'ヒ船団海上護衛作戦', zhTW: 'ヒ（菲律賓）船團海上護衛作戰', en: 'Hi Convoy Maritime Escort Operation' },
    '7-5': { jp: 'スラバヤ沖海戦・バタビア沖海戦', zhTW: '泗水沖海戰・巴達維亞沖海戰', en: 'Battle of Surabaya and Battle of Batavia' },
};

// 地名索引：任務文、關名、作戰名裡會出現的地名詞（日文原文的最小詞），新任務或新海域的
// 譯文一律從這裡取用。zhTW 依 docs/translation-guidelines.md「海域與關卡名稱」（偽名譯回實際
// 地名）；en 沿用 wiki 慣用寫法（偽名不替換），real 是給英文附註用的實際地名。
// 新地名先經開發者確認對照，再加進來；tests/map-names.test.ts 會用它掃任務譯文是否一致。
// 不收與一般詞彙同形的地名（例：「スロット」在任務裡多指裝備欄位，不是 The Slot）。
export interface PlaceName { jp: string; zhTW: string; en: string; real?: string }

export const PLACE_NAMES: readonly PlaceName[] = [
    // 大區
    { jp: '鎮守府海域', zhTW: '鎮守府海域', en: 'Naval Base Waters' },
    { jp: '南西諸島海域', zhTW: '南西諸島海域', en: 'Nansei Island Waters' },
    { jp: '北方海域', zhTW: '北方海域', en: 'Northern Waters' },
    { jp: '西方海域', zhTW: '西方海域', en: 'Western Waters' },
    { jp: '南方海域', zhTW: '南方海域', en: 'Southern Waters' },
    { jp: '中部海域', zhTW: '中部海域', en: 'Central Waters' },
    { jp: '南西海域', zhTW: '南西海域', en: 'South Western Waters' },
    // 偽名（遊戲虛構，影射真實地點）
    { jp: 'オリョール', zhTW: '奧廖爾', en: 'Orel' },
    { jp: 'モーレイ海', zhTW: '白令海', en: 'Moray Sea', real: 'Bering Sea' },
    { jp: 'キス島', zhTW: '基斯卡島', en: 'Kis Island', real: 'Kiska Island' },
    { jp: 'アルフォンシーノ', zhTW: '阿留申群島', en: 'Alfonsino', real: 'Aleutian Islands' },
    { jp: 'ジャム島', zhTW: '爪哇島', en: 'Jam Island', real: 'Java' },
    { jp: 'カレー洋', zhTW: '印度洋', en: 'Curry Ocean', real: 'Indian Ocean' },
    { jp: 'リランカ', zhTW: '斯里蘭卡', en: 'Ri-Lanka', real: 'Sri Lanka' },
    { jp: 'カスガダマ', zhTW: '馬達加斯加', en: 'Casgadama', real: 'Madagascar' },
    { jp: 'サブ島', zhTW: '薩沃島', en: 'Sav Island', real: 'Savo Island' },
    { jp: 'サーモン', zhTW: '所羅門群島', en: 'Salmon', real: 'Solomon Islands' },
    { jp: 'MS諸島', zhTW: 'MS 馬紹爾群島', en: 'MS Islands', real: 'Marshall Islands' },
    { jp: 'グアノ環礁', zhTW: '強斯頓環礁', en: 'Guano Atoll', real: 'Johnston Atoll' },
    { jp: 'ピーコック島', zhTW: '威克島', en: 'Peacock Island', real: 'Wake Island' },
    { jp: 'KW環礁', zhTW: 'KW 瓜加林環礁', en: 'KW Atoll', real: 'Kwajalein Atoll' },
    { jp: 'ヒ船団', zhTW: 'ヒ（菲律賓）船團', en: 'Hi Convoy', real: 'Philippines' },
    // 真實地名
    { jp: '南西諸島', zhTW: '南西諸島', en: 'Nansei Islands' },
    { jp: '珊瑚諸島', zhTW: '珊瑚諸島', en: 'Coral Islands' },
    { jp: '沖ノ島', zhTW: '沖之島', en: 'Okinoshima' },
    { jp: 'バシー', zhTW: '巴士', en: 'Bashi' },
    { jp: 'ブルネイ', zhTW: '汶萊', en: 'Brunei' },
    { jp: 'タウイタウイ', zhTW: '塔威塔威', en: 'Tawi-Tawi' },
    { jp: 'ペナン', zhTW: '檳城', en: 'Penang' },
    { jp: 'マラッカ', zhTW: '麻六甲', en: 'Malacca' },
    { jp: 'セレベス', zhTW: '西里伯斯', en: 'Celebes' },
    { jp: 'ジャワ', zhTW: '爪哇', en: 'Java' },
    { jp: 'スラバヤ', zhTW: '泗水', en: 'Surabaya' },
    { jp: 'バタビア', zhTW: '巴達維亞', en: 'Batavia' },
    { jp: 'ラバウル', zhTW: '拉包爾', en: 'Rabaul' },
    { jp: 'ソロモン', zhTW: '所羅門', en: 'Solomon' },
    { jp: '昭南', zhTW: '昭南', en: 'Shounan' },
    { jp: '鉄底海峡', zhTW: '鐵底海峽', en: 'Ironbottom Sound' },
];

// 英文沿用 wiki 慣用的偽名（Curry Ocean、Salmon…），實際地名只放在附註，不取代原文。
export const PSEUDONYM_NOTES_EN: Readonly<Record<string, string>> = {
    '3-1': 'Moray Sea = Bering Sea',
    '3-2': 'Kis Island = Kiska Island',
    '3-3': 'Alfonsino = Aleutian Islands',
    '4-1': 'Jam Island = Java',
    '4-2': 'Curry Ocean = Indian Ocean',
    '4-3': 'Ri-Lanka = Sri Lanka',
    '4-4': 'Casgadama = Madagascar',
    '4-5': 'Curry Ocean = Indian Ocean; Ri-Lanka = Sri Lanka',
    '5-3': 'Sav Island = Savo Island',
    '5-4': 'Salmon = Solomon Islands',
    '5-5': 'Salmon = Solomon Islands',
    '6-2': 'MS Islands = Marshall Islands',
    '6-3': 'Guano Atoll = Johnston Atoll',
    '6-4': 'Peacock Island = Wake Island',
    '6-5': 'KW Atoll = Kwajalein Atoll',
    '7-4': 'Hi = Philippines',
};

/**
 * 關名。日文介面直接用 master 名稱；華語／英文查表。
 * 有 master 名稱但與表中日文不一致（遊戲已改名）時回 null；沒有 master 時信任表（已由樣本鎖定）。
 */
export function mapName(map: string, locale: MapNameLocale, masterName?: string): string | null {
    const entry = MAP_NAMES[map];
    if (locale === 'ja') return masterName || entry?.jp || null;
    if (!entry || (masterName && entry.jp !== masterName)) return null;
    return locale === 'en' ? entry.en : entry.zhTW;
}

/** 作戰名。判斷規則同 mapName()：master 作戰名與表中日文不一致時回 null。 */
export function operationName(map: string, locale: MapNameLocale, masterOpetext?: string): string | null {
    const entry = OPERATION_NAMES[map];
    if (locale === 'ja') return masterOpetext || entry?.jp || null;
    if (!entry || (masterOpetext && entry.jp !== masterOpetext)) return null;
    return locale === 'en' ? entry.en : entry.zhTW;
}

/** 大區名；沒收錄回 null，由呼叫端退回 master 名稱或通用字串。 */
export function areaName(area: number, locale: MapNameLocale): string | null {
    const entry = AREA_NAMES[area];
    if (!entry) return null;
    return locale === 'en' ? entry.en : locale === 'ja' ? entry.jp : entry.zhTW;
}
