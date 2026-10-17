// 活動海域的年份／季節年表。
//
// 純資料＋純函式，無 chrome.* 與 DOM，可獨立編譯用 node 驗證（CLAUDE.md 設計原則 4）。
//
// ── 為什麼需要這張表 ──────────────────────────────────────────────────
// **遊戲 API 完全不提供活動的西元年與季節**。封包只有 `api_maparea_id`（本專案的
// world）與當次 start2 的作戰標題；舊活動結束後標題會從 master 消失。玩家辨識活動
// 的說法是「2026夏季」，不是 area 編號或一長串日文作戰名。
//
// ── 為什麼不能從出擊時間戳反推 ────────────────────────────────────────
// 冬季活動常跨 12／1 月，梅雨夏季、初春、初秋、小型活動也不是「該月＝該季」。
// 從紀錄日期猜季節會在跨年邊界說錯話，故表外一律不猜，退回既有的 master 名／
// `活動海域 #id`。
//
// ── 鍵為什麼是 world（maparea id）────────────────────────────────────
// 一次活動一個 maparea，關卡是同一個 world 底下的 mapnum。年表是活動層級的屬性，
// 不是關卡層級。本專案 `map-edge-letters` 的活動圖從 world 31 起；更早的活動不在
// 表內，匯入舊紀錄時走 fallback，不補假季節。
//
// ── 維護方式 ────────────────────────────────────────────────────────────
// 新活動開圖、start2 出現新的 `api_maparea_id` 時在下表補一列。季節用下方
// `EventSeason` 列舉，特殊檔期（初春／初秋／梅雨夏季／小型）不得硬套春夏秋冬。

export type EventSeason =
    | 'winter'
    | 'spring'
    | 'summer'
    | 'autumn'
    | 'earlySpring'
    | 'earlyFall'
    | 'rainySummer'
    | 'mini';

export interface EventTerm {
    year: number;
    season: EventSeason;
}

const EVENT_TERMS: Readonly<Record<number, EventTerm>> = {
    31: { year: 2015, season: 'summer' },
    32: { year: 2015, season: 'autumn' },
    33: { year: 2016, season: 'winter' },
    34: { year: 2016, season: 'spring' },
    35: { year: 2016, season: 'summer' },
    36: { year: 2016, season: 'autumn' },
    37: { year: 2017, season: 'winter' },
    38: { year: 2017, season: 'spring' },
    39: { year: 2017, season: 'summer' },
    40: { year: 2017, season: 'autumn' },
    41: { year: 2018, season: 'winter' },
    42: { year: 2018, season: 'earlyFall' },
    43: { year: 2019, season: 'winter' },
    44: { year: 2019, season: 'spring' },
    45: { year: 2019, season: 'summer' },
    46: { year: 2019, season: 'autumn' },
    47: { year: 2020, season: 'mini' },
    48: { year: 2020, season: 'rainySummer' },
    49: { year: 2020, season: 'autumn' },
    50: { year: 2021, season: 'spring' },
    51: { year: 2021, season: 'summer' },
    52: { year: 2021, season: 'autumn' },
    53: { year: 2022, season: 'winter' },
    54: { year: 2022, season: 'spring' },
    55: { year: 2022, season: 'summer' },
    56: { year: 2023, season: 'earlySpring' },
    57: { year: 2023, season: 'summer' },
    58: { year: 2024, season: 'earlySpring' },
    59: { year: 2024, season: 'summer' },
    60: { year: 2025, season: 'spring' },
    61: { year: 2025, season: 'autumn' },
    62: { year: 2026, season: 'summer' },
};

export function eventTermOf(world: number): EventTerm | null {
    return EVENT_TERMS[world] ?? null;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 年表命中則回「2026夏季」這類說法；表外回 null，呼叫端再走 master／#id。 */
export function eventTermLabel(world: number, translate: Translate): string | null {
    const term = EVENT_TERMS[world];
    if (!term) return null;
    return translate('event.term', {
        year: term.year,
        season: translate(`event.season.${term.season}`),
    });
}

export function eventTermSeasonLabel(world: number, translate: Translate): { year: number; seasonLabel: string } | null {
    const term = EVENT_TERMS[world];
    if (!term) return null;
    return { year: term.year, seasonLabel: translate(`event.season.${term.season}`) };
}

// ── 作戰名與前後段 ──────────────────────────────────────────────────────
// 遊戲只在活動期間的 start2 送作戰名（`api_mst_maparea.api_name`），活動結束後就從 master
// 消失；且那一欄只放前段名，後段名不在封包裡。故歷代作戰名只能人工維護於此表。
//
// - 日文：活動履歷表（kankore-sheep.blog.jp）＋ wikiwiki.jp/kancolle 各活動頁「前段作戦／後段作戦」；
//   53–58、61、62 前段另與 kcdata `_maparea` 傾印、koubrowser `area_name.ts` 交叉比對一致。
// - 英文：英文玩家社群譯名＝en.kancollewiki.net「Events」頁的 1st／2nd Stage Operations 名稱；
//   要補史料時放括號、社群譯名在前（50：Night Battle off Lunga (Battle of Tassafaronga)）。
// - 台灣華語依 docs/translation-guidelines.md 的三層順序，務求與任務、遠征的譯名索引一致：
//   (1) 原文是漢字就沿用漢字（地中海之戰、坊之岬沖海戰、禮號作戰）；
//   (2) 假名部分依史料，以中文維基百科台灣正體條目核對（シングル→鵝卵石行動、トーチ→火炬行動、
//       ノルマンディー→諾曼第登陸、ナルヴィク→納爾維克戰役、マレー→馬來亞海戰、レイテ→雷伊泰灣海戰、
//       Operation Menace→威嚇行動；ルンガ沖夜戦→塔薩法朗加（Lunga）海戰由開發者指定）；
//   (3) 都沒有來源才在地化翻譯。未使用外部譯文。
// - `firstMap`：該段從第幾關開始（wikiwiki 各活動頁的「【前段作戦】／【後段作戦】」標記）。
//   2021秋（52）前段是通常海域的秋刀魚祭，沒有活動關卡，故 `firstMap: null`；後段從 E1 起。
// 新活動開圖時與 EVENT_TERMS 一併補列；後段名稱在後段開放後補上。

export interface EventOperation {
    jp: string;
    en: string;
    zhTW: string;
    /** 這段的第一關（E 幾）；null＝這段沒有活動海域關卡。 */
    firstMap: number | null;
}

const op = (jp: string, en: string, zhTW: string, firstMap: number | null = 1): EventOperation =>
    ({ jp, en, zhTW, firstMap });

const EVENT_OPERATIONS: Readonly<Record<number, readonly EventOperation[]>> = {
    31: [op('反撃！第二次SN作戦', 'Counterattack! The Second Operation SN', '反擊！第二次SN作戰')],
    32: [op('突入！海上輸送作戦', 'Breakthrough! Maritime Transport Operation', '突入！海上輸送作戰')],
    33: [op('出撃！礼号作戦', 'Sortie! Operation Rei-Go!', '出擊！禮號作戰')],
    34: [op('開設！基地航空隊', 'Deployment! Land-based Aerial Division!', '開設！基地航空隊')],
    35: [op('迎撃！第二次マレー沖海戦', 'Counterattack! The Second Battle off Malay Peninsula', '迎擊！第二次馬來亞海戰')],
    36: [op('発令！「艦隊作戦第三法」', 'Announcement! The Third Fleet Operation Act', '發令！「艦隊作戰第三法」')],
    37: [op('偵察戦力緊急展開！「光」作戦', 'Reconnaissance Force Emergency Deployment! Operation "Hikari"', '偵察戰力緊急展開！「光」作戰')],
    38: [op('出撃！北東方面 第五艦隊', 'Sortie! Fifth Fleet To the North East!', '出擊！北東方面 第五艦隊')],
    39: [op('西方再打通！欧州救援作戦', 'Crossing into the West Again! The European Rescue Operation!', '西方再打通！歐洲救援作戰')],
    40: [op('捷号決戦！邀撃、レイテ沖海戦(前篇)', 'Showdown at Operation Shou-gou! Battle of Leyte Gulf (Part 1)', '捷號決戰！邀擊、雷伊泰灣海戰（前篇）')],
    41: [op('捷号決戦！邀撃、レイテ沖海戦(後篇)', 'Showdown at Operation Shou-Gou! Battle of Leyte Gulf (Part 2)', '捷號決戰！邀擊、雷伊泰灣海戰（後篇）')],
    42: [op('抜錨！連合艦隊、西へ！', 'Set Sail! Combined Fleet, to the West', '拔錨！連合艦隊，向西！')],
    43: [op('邀撃！ブイン防衛作戦', 'Interception! Operation Buin Defense', '邀擊！布因防衛作戰')],
    44: [op('発動！友軍救援「第二次ハワイ作戦」', 'Commence Allied Relief! "The 2nd Hawaii Operation"', '發動！友軍救援「第二次夏威夷作戰」')],
    45: [op('欧州方面反撃作戦 発動！「シングル作戦」', 'European Counterattack Operation! Commence "Operation Shingle"', '歐洲方面反擊作戰 發動！「鵝卵石行動」')],
    46: [op('進撃！第二次作戦「南方作戦」', 'Advance! The 2nd Southern Operation', '進擊！第二次作戰「南方作戰」')],
    47: [op('桃の節句！沖に立つ波', 'Peach Festival! Offshore Waves', '女兒節！海上揚起的浪')],
    48: [op('侵攻阻止！島嶼防衛強化作戦', 'Stop the Invasion! Island Defense Fortification Operation', '侵攻阻止！島嶼防衛強化作戰')],
    49: [op('護衛せよ！船団輸送作戦', 'Escort! Fleet Transport Operation', '護衛吧！船團輸送作戰')],
    50: [op('激突！ルンガ沖夜戦', 'Clash! Night Battle off Lunga (Battle of Tassafaronga)', '激突！塔薩法朗加（Lunga）海戰')],
    51: [op('増援輸送作戦！地中海の戦い', 'Reinforcement Transport Operation! Battle of the Mediterranean', '增援輸送作戰！地中海之戰')],
    52: [
        op('帰ってきた鎮守府秋刀魚祭り', 'Return of the Naval District Saury Festival', '鎮守府秋刀魚祭回來了', null),
        op('海上護衛！本土近海航路の防衛', 'Maritime Escort! Defend the Seas of the Mainland', '海上護衛！本土近海航路的防衛'),
    ],
    53: [op('発令！「捷三号作戦警戒」', 'Announcement! Operation Sho-Go 3 Alert!', '發令！「捷三號作戰警戒」')],
    54: [
        op('激闘！R方面作戦', 'Fierce Battle! R-Area Operation', '激鬥！R方面作戰'),
        op('血戦！異聞坊ノ岬沖海戦', 'Battle to the Death! The Curious Tale of Operation Ten-Go!', '血戰！異聞坊之岬沖海戰', 4),
    ],
    55: [op('大規模反攻上陸！トーチ作戦！', 'Large Scale Counter Landing! Operation Torch!', '大規模反攻上陸！火炬行動！')],
    56: [op('絶対防衛線！「小笠原兵団」救援', 'Absolute Defense Line! "Ogasawara Regiment" Relief', '絕對防衛線！「小笠原兵團」救援')],
    57: [
        op('船団護衛！輸送航路防衛戦', 'Fleet Escort! Transport Route Defence Battle', '船團護衛！輸送航路防衛戰'),
        op('反攻上陸！ノルマンディー上陸作戦', 'Counter Landing! Normandy Landing Operation!', '反攻上陸！諾曼第登陸', 5),
    ],
    58: [op('発動！竜巻作戦', 'Commence! Operation Tatsumaki', '發動！龍捲作戰')],
    59: [
        op('Operation Menace', 'Operation Menace', '威嚇行動'),
        op('新MO作戦', 'New Operation MO', '新MO作戰', 4),
    ],
    60: [
        op('北海道防衛作戦', 'Hokkaido Defence Operation', '北海道防衛作戰'),
        op('突入！第二次礼号作戦', 'Operation Rei-Go Part 2', '突入！第二次禮號作戰', 4),
    ],
    61: [
        op('逆転！ナルヴィク攻防戦', 'Turn the tables! A seesaw battle of Narvik', '逆轉！納爾維克戰役'),
        op('要撃！敵機動部隊捜索撃滅戦', 'Ambush! Battle for Search and Annihilation the Enemy Carrier Task Forces', '要擊！敵機動部隊搜索擊滅戰', 4),
    ],
    62: [
        op('反撃！第三十一戦隊の戦い', 'Counterattack! The Battle of the 31st Squadron', '反擊！第三十一戰隊之戰'),
        op("L'Élan de la Flotte Française -フランス艦隊の躍動-", 'The Momentum of the French Fleet', '法國艦隊的躍動', 4),
    ],
};

/** 依序排列的各段作戰（前段在前）；表外回 null。 */
export function eventOperationsOf(world: number): readonly EventOperation[] | null {
    return EVENT_OPERATIONS[world] ?? null;
}

/** 已收錄年表的所有活動 world（升冪）。 */
export function eventWorlds(): number[] {
    return Object.keys(EVENT_TERMS).map(Number).sort((a, b) => a - b);
}

/**
 * E 幾屬於第幾段（0 起）。依 `firstMap` 切：該段涵蓋到下一個有關卡的段的前一關。
 * 表外或該 world 只有一段時回 0。沒有任何段涵蓋（不該發生）時回 -1。
 */
export function operationIndexOfMap(world: number, mapNo: number): number {
    const ops = EVENT_OPERATIONS[world];
    if (!ops || ops.length <= 1) return 0;
    let hit = -1;
    ops.forEach((o, i) => { if (o.firstMap !== null && o.firstMap <= mapNo) hit = i; });
    return hit;
}

/** 某段涵蓋的關卡範圍 [from, to]；to 為 null＝開放到最後一關。沒有活動關卡的段回 null。 */
export function operationMapRange(world: number, index: number): { from: number; to: number | null } | null {
    const ops = EVENT_OPERATIONS[world];
    const o = ops?.[index];
    if (!ops || !o || o.firstMap === null) return null;
    const next = ops.slice(index + 1).find(x => x.firstMap !== null);
    return { from: o.firstMap, to: next ? next.firstMap! - 1 : null };
}

/** 季節的大類（篩選用）：初春併入春、梅雨夏併入夏、初秋併入秋；卡片仍顯示原季節名。 */
export type SeasonGroup = 'winter' | 'spring' | 'summer' | 'autumn' | 'mini';

export const SEASON_GROUP: Readonly<Record<EventSeason, SeasonGroup>> = {
    winter: 'winter', earlySpring: 'spring', spring: 'spring', rainySummer: 'summer',
    summer: 'summer', earlyFall: 'autumn', autumn: 'autumn', mini: 'mini',
};
