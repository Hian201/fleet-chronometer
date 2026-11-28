// 艦型（api_ctype）三語名稱、搜尋別名與第一層基本國籍（就役時所屬海軍）對照表。
//
// 純資料＋純函式，無 chrome.* 與 DOM，不匯入 ui-i18n／gamedata-i18n／state.ts，
// 可獨立編譯用 node 驗證（AGENTS.md 硬約束 6），且不得出現在 service worker 的匯入鏈
// （tests/state-format.test.ts 把關）。
//
// ── 資料來源與規則 ──────────────────────────────────────────────────────
// 1. 遊戲 API 只提供數字 `api_ctype`，不提供艦型名稱與國籍；本表以真實 start2 全部 140 個
//    図鑑艦 ctype 逐一列舉，不設「未列出一律日本」預設，避免未登錄艦型靜默落回日本。
// 2. 日文艦型名以 KC3Kai/kc3-translations 的 `data/en/ctype.json`（陣列索引＝ctype）為底並與
//    wikiwiki 交叉核對；KC3Kai 只作名稱參考，不作國籍依據（例如 ctype 86 呂號潛水艦在 KC3Kai
//    歸日本，本專案依「就役時所屬海軍」歸德國 `de`，另由 ship-nationality.ts 第二層補上日本
//    篩選標籤）。詳細出處登錄於 THIRD-PARTY-NOTICES.md。
// 3. 一個 ctype 就是一個選項，不合併同級的不同 ctype（例如 75 春日丸級／76 大鷹型、57 IXC型U艇
//    ／86 呂號潛水艦、134 Courageous級／135 Glorious級），因為遊戲在補強增設、任務條件與先制
//    對潛都直接以 ctype 判定。
// 4. 系別分型（特型、甲型、乙型、丙型、丁型等）不建第三層介面，只放進 `aliases` 供搜尋命中。
//    海防艦史實分型：択捉型＝甲型（改甲型）、御蔵型＝乙型、鵜来型＝改乙型、ctype 104＝丁型。
// 5. 繁體中文主顯示：日本艦型沿用原文漢字並轉繁體字形（〇〇型），外國艦型寫原名＋「級」不加空格
//    （如 Fletcher級、John C.Butler級、Гангут級），少數含假名者依史料（如 UボートIXC型→IXC型U艇）；
//    中文艦名音譯與別稱放進 aliases 方便搜尋。
// 支援語系字面量（與 gamedata-i18n.ts 的 Lang 相同；不匯入它以免遞移引用字串表模組）。
export type ShipClassLang = 'zh-TW' | 'ja' | 'en';

import type { Nation } from './ship-nationality';

export interface ShipClassDef {
    ja: string;
    'zh-TW': string;
    en: string;
    /** 第一層基本國籍：該艦型就役時所屬海軍。 */
    nation: Nation;
    /** 搜尋別名：系別、史實別名、中文艦名音譯、常見英文拼寫等。 */
    aliases?: readonly string[];
}

/** 全部 140 個図鑑內艦型（`samples/start2-master.json` 核對，tests/ship-nationality.test.ts 鎖定）。 */
export const SHIP_CLASSES: Readonly<Record<number, ShipClassDef>> = {
    1: { ja: '綾波型', 'zh-TW': '綾波型', en: 'Ayanami-class', nation: 'jp', aliases: ['特型', '特II型', '特2型', '特型駆逐艦', '特型驅逐艦'] },
    2: { ja: '伊勢型', 'zh-TW': '伊勢型', en: 'Ise-class', nation: 'jp' },
    3: { ja: '加賀型', 'zh-TW': '加賀型', en: 'Kaga-class', nation: 'jp' },
    4: { ja: '球磨型', 'zh-TW': '球磨型', en: 'Kuma-class', nation: 'jp' },
    5: { ja: '暁型', 'zh-TW': '曉型', en: 'Akatsuki-class', nation: 'jp', aliases: ['特型', '特III型', '特3型', '特型駆逐艦', '特型驅逐艦'] },
    6: { ja: '金剛型', 'zh-TW': '金剛型', en: 'Kongou-class', nation: 'jp', aliases: ['Kongo'] },
    7: { ja: '古鷹型', 'zh-TW': '古鷹型', en: 'Furutaka-class', nation: 'jp' },
    8: { ja: '高雄型', 'zh-TW': '高雄型', en: 'Takao-class', nation: 'jp' },
    9: { ja: '最上型', 'zh-TW': '最上型', en: 'Mogami-class', nation: 'jp' },
    10: { ja: '初春型', 'zh-TW': '初春型', en: 'Hatsuharu-class', nation: 'jp' },
    11: { ja: '祥鳳型', 'zh-TW': '祥鳳型', en: 'Shouhou-class', nation: 'jp', aliases: ['Shoho'] },
    12: { ja: '吹雪型', 'zh-TW': '吹雪型', en: 'Fubuki-class', nation: 'jp', aliases: ['特型', '特I型', '特1型', '特型駆逐艦', '特型驅逐艦'] },
    13: { ja: '青葉型', 'zh-TW': '青葉型', en: 'Aoba-class', nation: 'jp' },
    14: { ja: '赤城型', 'zh-TW': '赤城型', en: 'Akagi-class', nation: 'jp' },
    15: { ja: '千歳型', 'zh-TW': '千歲型', en: 'Chitose-class', nation: 'jp' },
    16: { ja: '川内型', 'zh-TW': '川內型', en: 'Sendai-class', nation: 'jp' },
    17: { ja: '蒼龍型', 'zh-TW': '蒼龍型', en: 'Souryuu-class', nation: 'jp', aliases: ['Soryu'] },
    18: { ja: '朝潮型', 'zh-TW': '朝潮型', en: 'Asashio-class', nation: 'jp' },
    19: { ja: '長門型', 'zh-TW': '長門型', en: 'Nagato-class', nation: 'jp' },
    20: { ja: '長良型', 'zh-TW': '長良型', en: 'Nagara-class', nation: 'jp' },
    21: { ja: '天龍型', 'zh-TW': '天龍型', en: 'Tenryuu-class', nation: 'jp', aliases: ['Tenryu'] },
    22: { ja: '島風型', 'zh-TW': '島風型', en: 'Shimakaze-class', nation: 'jp', aliases: ['丙型', '丙型駆逐艦', '丙型驅逐艦'] },
    23: { ja: '白露型', 'zh-TW': '白露型', en: 'Shiratsuyu-class', nation: 'jp' },
    24: { ja: '飛鷹型', 'zh-TW': '飛鷹型', en: 'Hiyou-class', nation: 'jp', aliases: ['Hiyo'] },
    25: { ja: '飛龍型', 'zh-TW': '飛龍型', en: 'Hiryuu-class', nation: 'jp', aliases: ['Hiryu'] },
    26: { ja: '扶桑型', 'zh-TW': '扶桑型', en: 'Fusou-class', nation: 'jp', aliases: ['Fuso'] },
    27: { ja: '鳳翔型', 'zh-TW': '鳳翔型', en: 'Houshou-class', nation: 'jp', aliases: ['Hosho'] },
    28: { ja: '睦月型', 'zh-TW': '睦月型', en: 'Mutsuki-class', nation: 'jp' },
    29: { ja: '妙高型', 'zh-TW': '妙高型', en: 'Myoukou-class', nation: 'jp', aliases: ['Myoko'] },
    30: { ja: '陽炎型', 'zh-TW': '陽炎型', en: 'Kagerou-class', nation: 'jp', aliases: ['Kagero', '甲型', '甲型駆逐艦', '甲型驅逐艦'] },
    31: { ja: '利根型', 'zh-TW': '利根型', en: 'Tone-class', nation: 'jp' },
    32: { ja: '龍驤型', 'zh-TW': '龍驤型', en: 'Ryuujou-class', nation: 'jp', aliases: ['Ryujo'] },
    33: { ja: '翔鶴型', 'zh-TW': '翔鶴型', en: 'Shoukaku-class', nation: 'jp', aliases: ['Shokaku'] },
    34: { ja: '夕張型', 'zh-TW': '夕張型', en: 'Yuubari-class', nation: 'jp', aliases: ['Yubari'] },
    35: { ja: '海大VI型', 'zh-TW': '海大VI型', en: 'Kaidai VI-class', nation: 'jp', aliases: ['海大6型', '伊168'] },
    36: { ja: '巡潜乙型改二', 'zh-TW': '巡潛乙型改二', en: 'Junsen Type B Mod.2', nation: 'jp', aliases: ['伊58'] },
    37: { ja: '大和型', 'zh-TW': '大和型', en: 'Yamato-class', nation: 'jp' },
    38: { ja: '夕雲型', 'zh-TW': '夕雲型', en: 'Yuugumo-class', nation: 'jp', aliases: ['Yugumo', '甲型', '甲型駆逐艦', '甲型驅逐艦'] },
    39: { ja: '巡潜乙型', 'zh-TW': '巡潛乙型', en: 'Junsen Type B', nation: 'jp', aliases: ['伊19', '伊26', '伊36'] },
    40: { ja: '巡潜3型', 'zh-TW': '巡潛3型', en: 'Junsen Type 3', nation: 'jp', aliases: ['巡潜III型', '巡潛III型', '伊8'] },
    41: { ja: '阿賀野型', 'zh-TW': '阿賀野型', en: 'Agano-class', nation: 'jp' },
    43: { ja: '大鳳型', 'zh-TW': '大鳳型', en: 'Taihou-class', nation: 'jp', aliases: ['Taiho'] },
    44: { ja: '潜特型(伊400型潜水艦)', 'zh-TW': '潛特型(伊400型潛水艦)', en: 'Sentoku (I-400)-class', nation: 'jp', aliases: ['伊400型', '伊401'] },
    45: { ja: '特種船丙型', 'zh-TW': '特種船丙型', en: 'Type C Special Ship', nation: 'jp', aliases: ['あきつ丸', '秋津丸'] },
    46: { ja: '三式潜航輸送艇', 'zh-TW': '三式潛航輸送艇', en: 'Type 3 Submergence Transport', nation: 'jp', aliases: ['まるゆ', '丸優'] },
    47: { ja: 'Bismarck級', 'zh-TW': 'Bismarck級', en: 'Bismarck-class', nation: 'de', aliases: ['俾斯麥'] },
    48: { ja: 'Z1型', 'zh-TW': 'Z1型', en: 'Type 1934 (Z1)-class', nation: 'de', aliases: ['Z1級', 'Z3', '1934型'] },
    49: { ja: '明石型', 'zh-TW': '明石型', en: 'Akashi-class', nation: 'jp' },
    50: { ja: '大鯨型', 'zh-TW': '大鯨型', en: 'Taigei-class', nation: 'jp' },
    51: { ja: '龍鳳型', 'zh-TW': '龍鳳型', en: 'Ryuuhou-class', nation: 'jp', aliases: ['Ryuho'] },
    52: { ja: '大淀型', 'zh-TW': '大淀型', en: 'Ooyodo-class', nation: 'jp', aliases: ['Oyodo'] },
    53: { ja: '雲龍型', 'zh-TW': '雲龍型', en: 'Unryuu-class', nation: 'jp', aliases: ['Unryu'] },
    54: { ja: '秋月型', 'zh-TW': '秋月型', en: 'Akizuki-class', nation: 'jp', aliases: ['乙型', '乙型駆逐艦', '乙型驅逐艦'] },
    55: { ja: 'Admiral Hipper級', 'zh-TW': 'Admiral Hipper級', en: 'Admiral Hipper-class', nation: 'de', aliases: ['希佩爾海軍上將', '歐根親王', 'Prinz Eugen'] },
    56: { ja: '香取型', 'zh-TW': '香取型', en: 'Katori-class', nation: 'jp' },
    57: { ja: 'UボートIXC型', 'zh-TW': 'IXC型U艇', en: 'Type IXC', nation: 'de', aliases: ['Type IXC級', 'U-511', 'IXC型'] },
    58: { ja: 'V.Veneto級', 'zh-TW': 'V.Veneto級', en: 'Vittorio Veneto-class', nation: 'it', aliases: ['Littorio級', '利托里奧', '維內托', '羅馬', 'Italia'] },
    59: { ja: '秋津洲型', 'zh-TW': '秋津洲型', en: 'Akitsushima-class', nation: 'jp' },
    60: { ja: '改風早型', 'zh-TW': '改風早型', en: 'Modified Kazahaya-class', nation: 'jp', aliases: ['速吸'] },
    61: { ja: 'Maestrale級', 'zh-TW': 'Maestrale級', en: 'Maestrale-class', nation: 'it', aliases: ['西北風', '西南風', '東北風', '東南風', 'Libeccio', 'Grecale', 'Scirocco'] },
    62: { ja: '瑞穂型', 'zh-TW': '瑞穗型', en: 'Mizuho-class', nation: 'jp' },
    63: { ja: 'Graf Zeppelin級', 'zh-TW': 'Graf Zeppelin級', en: 'Graf Zeppelin-class', nation: 'de', aliases: ['齊柏林伯爵'] },
    64: { ja: 'Zara級', 'zh-TW': 'Zara級', en: 'Zara-class', nation: 'it', aliases: ['札拉', '波拉', 'Pola'] },
    65: { ja: 'Iowa級', 'zh-TW': 'Iowa級', en: 'Iowa-class', nation: 'us', aliases: ['愛荷華'] },
    66: { ja: '神風型', 'zh-TW': '神風型', en: 'Kamikaze-class', nation: 'jp' },
    67: { ja: 'Queen Elizabeth級', 'zh-TW': 'Queen Elizabeth級', en: 'Queen Elizabeth-class', nation: 'gb', aliases: ['伊麗莎白女王', '厭戰', '英勇', 'Warspite', 'Valiant'] },
    68: { ja: 'Aquila級', 'zh-TW': 'Aquila級', en: 'Aquila-class', nation: 'it', aliases: ['天鷹'] },
    69: { ja: 'Lexington級', 'zh-TW': 'Lexington級', en: 'Lexington-class', nation: 'us', aliases: ['列星頓', '薩拉托加', 'Saratoga'] },
    70: { ja: 'C.Teste級', 'zh-TW': 'C.Teste級', en: 'Commandant Teste-class', nation: 'fr', aliases: ['Commandant Teste級', '塔斯特指揮官'] },
    71: { ja: '巡潜甲型改二', 'zh-TW': '巡潛甲型改二', en: 'Junsen Type A Mod.2', nation: 'jp', aliases: ['伊13', '伊14'] },
    72: { ja: '神威型', 'zh-TW': '神威型', en: 'Kamoi-class', nation: 'jp' },
    73: { ja: 'Гангут級', 'zh-TW': 'Гангут級', en: 'Gangut-class', nation: 'su', aliases: ['甘古特', '十月革命'] },
    74: { ja: '占守型', 'zh-TW': '占守型', en: 'Shimushu-class', nation: 'jp' },
    75: { ja: '春日丸級', 'zh-TW': '春日丸級', en: 'Kasuga Maru-class', nation: 'jp', aliases: ['八幡丸'] },
    76: { ja: '大鷹型', 'zh-TW': '大鷹型', en: 'Taiyou-class', nation: 'jp', aliases: ['Taiyo', '雲鷹', '神鷹'] },
    77: { ja: '択捉型', 'zh-TW': '擇捉型', en: 'Etorofu-class', nation: 'jp', aliases: ['甲型', '改甲型', '甲型海防艦'] },
    78: { ja: 'Ark Royal級', 'zh-TW': 'Ark Royal級', en: 'Ark Royal-class', nation: 'gb', aliases: ['皇家方舟'] },
    79: { ja: 'Richelieu級', 'zh-TW': 'Richelieu級', en: 'Richelieu-class', nation: 'fr', aliases: ['黎胥留', '讓·巴爾', 'Jean Bart'] },
    80: { ja: 'Guglielmo Marconi級', 'zh-TW': 'Guglielmo Marconi級', en: 'Guglielmo Marconi-class', nation: 'it', aliases: ['Marconi級', '馬可尼', '路易吉·托雷利', 'Luigi Torelli', 'UIT-25', '伊504'] },
    81: { ja: 'Ташкент級', 'zh-TW': 'Ташкент級', en: 'Tashkent-class', nation: 'su', aliases: ['塔什干'] },
    82: { ja: 'J級', 'zh-TW': 'J級', en: 'J-class', nation: 'gb', aliases: ['賈維斯', '傑納斯', '標槍', 'Jervis', 'Janus', 'Javelin'] },
    83: { ja: 'Casablanca級', 'zh-TW': 'Casablanca級', en: 'Casablanca-class', nation: 'us', aliases: ['卡薩布蘭卡', '甘比爾灣', 'Gambier Bay'] },
    84: { ja: 'Essex級', 'zh-TW': 'Essex級', en: 'Essex-class', nation: 'us', aliases: ['艾塞克斯', '無畏', '胡蜂', 'Intrepid', 'Wasp'] },
    85: { ja: '日振型', 'zh-TW': '日振型', en: 'Hiburi-class', nation: 'jp', aliases: ['乙型', '改乙型', '乙型海防艦'] },
    // KC3Kai 將 ctype 86 標為日本（單欄取捨）；本專案第一層依就役時所屬海軍歸德國（原 U-511），
    // 日本篩選歸屬另於 utils/ship-nationality.ts 的 NATION_FILTER_OVERRIDES 補上。
    86: { ja: '呂号潜水艦', 'zh-TW': '呂號潛水艦', en: 'Ro-series Submarine', nation: 'de', aliases: ['呂500', 'Ro-500', 'Type IXC', 'U-511'] },
    87: { ja: 'John C.Butler級', 'zh-TW': 'John C.Butler級', en: 'John C. Butler-class', nation: 'us', aliases: ['John C. Butler級', '巴特勒', '山繆·B·羅伯茲', 'Samuel B.Roberts'] },
    88: { ja: 'Nelson級', 'zh-TW': 'Nelson級', en: 'Nelson-class', nation: 'gb', aliases: ['納爾遜', '羅德尼', 'Rodney'] },
    89: { ja: 'Gotland級', 'zh-TW': 'Gotland級', en: 'Gotland-class', nation: 'se', aliases: ['哥特蘭'] },
    90: { ja: '日進型', 'zh-TW': '日進型', en: 'Nisshin-class', nation: 'jp' },
    91: { ja: 'Fletcher級', 'zh-TW': 'Fletcher級', en: 'Fletcher-class', nation: 'us', aliases: ['弗萊徹', '佛萊契爾', '強斯頓', 'Johnston', 'Heywood', 'Richard P.Leary'] },
    92: { ja: 'L.d.S.D.d.Abruzzi級', 'zh-TW': 'L.d.S.D.d.Abruzzi級', en: 'Duca degli Abruzzi-class', nation: 'it', aliases: ['Abruzzi級', '阿布魯齊公爵', '朱塞佩·加里波底', 'G.Garibaldi'] },
    93: { ja: 'Colorado級', 'zh-TW': 'Colorado級', en: 'Colorado-class', nation: 'us', aliases: ['科羅拉多', '馬里蘭', 'Maryland'] },
    94: { ja: '御蔵型', 'zh-TW': '御藏型', en: 'Mikura-class', nation: 'jp', aliases: ['乙型', '乙型海防艦'] },
    95: { ja: 'Northampton級', 'zh-TW': 'Northampton級', en: 'Northampton-class', nation: 'us', aliases: ['北安普頓', '休士頓', 'Houston'] },
    96: { ja: 'Perth級', 'zh-TW': 'Perth級', en: 'Perth-class', nation: 'au', aliases: ['伯斯', '改良型利安德級', 'Modified Leander'] },
    97: { ja: '陸軍特種船(R1)', 'zh-TW': '陸軍特種船(R1)', en: 'Army Special Ship (R1)', nation: 'jp', aliases: ['神州丸'] },
    98: { ja: 'De Ruyter級', 'zh-TW': 'De Ruyter級', en: 'De Ruyter-class', nation: 'nl', aliases: ['戴·魯伊特'] },
    99: { ja: 'Atlanta級', 'zh-TW': 'Atlanta級', en: 'Atlanta-class', nation: 'us', aliases: ['亞特蘭大', '里諾', 'Reno'] },
    100: { ja: '迅鯨型', 'zh-TW': '迅鯨型', en: 'Jingei-class', nation: 'jp' },
    101: { ja: '松型', 'zh-TW': '松型', en: 'Matsu-class', nation: 'jp', aliases: ['丁型', '丁型駆逐艦', '丁型驅逐艦'] },
    102: { ja: 'South Dakota級', 'zh-TW': 'South Dakota級', en: 'South Dakota-class', nation: 'us', aliases: ['南達科他', '印第安納', '麻薩諸塞', 'Indiana', 'Massachusetts'] },
    103: { ja: '巡潜丙型', 'zh-TW': '巡潛丙型', en: 'Junsen Type C', nation: 'jp', aliases: ['伊47'] },
    104: { ja: '丁型海防艦', 'zh-TW': '丁型海防艦', en: 'Type D Coastal Defense Ship', nation: 'jp', aliases: ['丁型', '第四号海防艦', '第二十二号海防艦', '第三〇号海防艦'] },
    105: { ja: 'Yorktown級', 'zh-TW': 'Yorktown級', en: 'Yorktown-class', nation: 'us', aliases: ['約克鎮', '黃蜂', 'Hornet'] },
    106: { ja: 'St. Louis級', 'zh-TW': 'St. Louis級', en: 'St. Louis-class', nation: 'us', aliases: ['St.Louis級', '聖路易', '海倫娜', 'Helena'] },
    107: { ja: 'North Carolina級', 'zh-TW': 'North Carolina級', en: 'North Carolina-class', nation: 'us', aliases: ['北卡羅來納', '華盛頓', 'Washington'] },
    108: { ja: 'Town級', 'zh-TW': 'Town級', en: 'Town-class', nation: 'gb', aliases: ['城級', '雪菲爾', 'Sheffield'] },
    109: { ja: '潜高型', 'zh-TW': '潛高型', en: 'Sentaka-class', nation: 'jp', aliases: ['伊201', '伊203'] },
    110: { ja: 'Brooklyn級', 'zh-TW': 'Brooklyn級', en: 'Brooklyn-class', nation: 'us', aliases: ['布魯克林', '檀香山', '鳳凰城', '貝爾格蘭諾將軍號', 'Honolulu', 'Phoenix', 'General Belgrano'] },
    111: { ja: '耐氷型雑用運送艦', 'zh-TW': '耐冰型雜用運送艦', en: 'Icebreaker Transport', nation: 'jp', aliases: ['宗谷'] },
    112: { ja: 'Illustrious級', 'zh-TW': 'Illustrious級', en: 'Illustrious-class', nation: 'gb', aliases: ['光輝', '勝利', 'Victorious'] },
    113: { ja: 'Conte di Cavour級', 'zh-TW': 'Conte di Cavour級', en: 'Conte di Cavour-class', nation: 'it', aliases: ['加富爾伯爵'] },
    114: { ja: 'Gato級', 'zh-TW': 'Gato級', en: 'Gato-class', nation: 'us', aliases: ['貓鯊', '鼓魚', '斯坎普', '刺鮁', '鰷魚', 'Drum', 'Scamp', 'Wahoo', 'Dace', 'Leonardo da Vinci'] },
    115: { ja: '特2TL型', 'zh-TW': '特2TL型', en: 'Type 2TL', nation: 'jp', aliases: ['山汐丸'] },
    116: { ja: 'Independence級', 'zh-TW': 'Independence級', en: 'Independence-class', nation: 'us', aliases: ['獨立', '蘭利', 'Langley'] },
    117: { ja: '鵜来型', 'zh-TW': '鵜來型', en: 'Ukuru-class', nation: 'jp', aliases: ['乙型', '改乙型', '乙型海防艦'] },
    118: { ja: 'Ranger級', 'zh-TW': 'Ranger級', en: 'Ranger-class', nation: 'us', aliases: ['遊騎兵'] },
    119: { ja: '特種船M丙型', 'zh-TW': '特種船M丙型', en: 'Type M-C Special Ship', nation: 'jp', aliases: ['熊野丸'] },
    120: { ja: '二等輸送艦', 'zh-TW': '二等輸送艦', en: 'No.101-class LST', nation: 'jp', aliases: ['第百一号輸送艦'] },
    121: { ja: 'New Orleans級', 'zh-TW': 'New Orleans級', en: 'New Orleans-class', nation: 'us', aliases: ['紐奧良', '塔斯卡盧薩', '明尼亞波利斯', 'Tuscaloosa', 'Minneapolis'] },
    122: { ja: 'Salmon級', 'zh-TW': 'Salmon級', en: 'Salmon-class', nation: 'us', aliases: ['鮭魚'] },
    123: { ja: '改敷島型', 'zh-TW': '改敷島型', en: 'Modified Shikishima-class', nation: 'jp', aliases: ['朝日'] },
    124: { ja: 'Marcello級', 'zh-TW': 'Marcello級', en: 'Marcello-class', nation: 'it', aliases: ['改Marcello級', '馬切羅', '卡佩里尼', 'C.Cappellini', 'UIT-24', '伊503'] },
    125: { ja: 'Nevada級', 'zh-TW': 'Nevada級', en: 'Nevada-class', nation: 'us', aliases: ['內華達'] },
    126: { ja: '改氷川丸級', 'zh-TW': '改冰川丸級', en: 'Modified Hikawa Maru-class', nation: 'jp', aliases: ['平安丸', '日枝丸'] },
    127: { ja: '巡潜乙型改一', 'zh-TW': '巡潛乙型改一', en: 'Junsen Type B Mod.1', nation: 'jp', aliases: ['伊41'] },
    128: { ja: 'La Galissonnière級', 'zh-TW': 'La Galissonnière級', en: 'La Galissonnière-class', nation: 'fr', aliases: ['La Galissonniere', '拉·加利索尼埃', '葛羅瓦', 'Gloire'] },
    129: { ja: 'Mogador級', 'zh-TW': 'Mogador級', en: 'Mogador-class', nation: 'fr', aliases: ['莫加多爾'] },
    130: { ja: '大泊型', 'zh-TW': '大泊型', en: 'Ootomari-class', nation: 'jp', aliases: ['Otomari'] },
    131: { ja: 'Киров級', 'zh-TW': 'Киров級', en: 'Kirov-class', nation: 'su', aliases: ['基洛夫'] },
    132: { ja: '特1TL型', 'zh-TW': '特1TL型', en: 'Type 1TL', nation: 'jp', aliases: ['しまね丸', '島根丸'] },
    133: { ja: 'Norge級', 'zh-TW': 'Norge級', en: 'Norge-class', nation: 'no', aliases: ['Eidsvold級', '挪威', '艾茲沃爾'] },
    134: { ja: 'Courageous級', 'zh-TW': 'Courageous級', en: 'Courageous-class', nation: 'gb', aliases: ['光榮', 'Glorious'] },
    135: { ja: 'Glorious級', 'zh-TW': 'Glorious級', en: 'Glorious-class', nation: 'gb', aliases: ['Courageous級', '光榮'] },
    136: { ja: '野埼型', 'zh-TW': '野埼型', en: 'Nosaki-class', nation: 'jp', aliases: ['南海'] },
    137: { ja: 'Thonburi級', 'zh-TW': 'Thonburi級', en: 'Thonburi-class', nation: 'th', aliases: ['吞武里'] },
    138: { ja: 'Algérie級', 'zh-TW': 'Algérie級', en: 'Algérie-class', nation: 'fr', aliases: ['Algerie', '阿爾及利亞'] },
    139: { ja: 'Aigle級', 'zh-TW': 'Aigle級', en: 'Aigle-class', nation: 'fr', aliases: ['鷹級', '禿鷲', 'Vautour'] },
    140: { ja: 'Visby級', 'zh-TW': 'Visby級', en: 'Visby-class', nation: 'se', aliases: ['維斯比'] },
    141: { ja: 'Béarn級', 'zh-TW': 'Béarn級', en: 'Béarn-class', nation: 'fr', aliases: ['Bearn', '貝亞恩'] },
};

/**
 * 艦型顯示名稱。`ctype <= 0` 回傳空字串；未收錄的新艦型退回 `#編號（代表艦名）`
 * （英文 `#編號 (代表艦名)`），沒有代表艦名時只顯示 `#編號`。
 */
export function shipClassLabel(ctype: number, lang: ShipClassLang, fallbackRep?: string | null): string {
    if (!ctype || ctype <= 0) return '';
    const entry = SHIP_CLASSES[ctype];
    if (entry) return entry[lang];
    const rep = fallbackRep?.trim();
    if (rep && rep !== `#${ctype}`) {
        return lang === 'en' ? `#${ctype} (${rep})` : `#${ctype}（${rep}）`;
    }
    return `#${ctype}`;
}

/** 艦型搜尋比對：大小寫不敏感，同時比對三語名稱、aliases、退路代表艦名與 ctype 編號。 */
export function matchShipClassQuery(ctype: number, query: string, fallbackRep?: string | null): boolean {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return true;
    const entry = SHIP_CLASSES[ctype];
    if (entry) {
        if (entry.ja.toLocaleLowerCase().includes(needle)) return true;
        if (entry['zh-TW'].toLocaleLowerCase().includes(needle)) return true;
        if (entry.en.toLocaleLowerCase().includes(needle)) return true;
        if (entry.aliases?.some(a => a.toLocaleLowerCase().includes(needle))) return true;
    }
    if (fallbackRep && fallbackRep.toLocaleLowerCase().includes(needle)) return true;
    return `#${ctype}`.includes(needle);
}

export interface ShipClassOption {
    ctype: number;
    label: string;
    count: number;
    minBookNo: number | null;
    selected: boolean;
}

/**
 * 依「艦型以外的其他條件篩出後的艦娘」計算艦型候選選項（多面向收斂）。
 * 已選中但目前為 0 艘的艦型一律保留並標 count=0，避免使用者切換其他條件時遺失選擇。
 * 選項依該艦型最小図鑑番號升冪排序，三語一致且接近遊戲圖鑑順序；缺值排最後。
 */
export function shipClassOptions(
    ships: readonly { ctype: number }[],
    selectedCtypes: readonly number[],
    lang: ShipClassLang,
    repOf?: (ctype: number) => string | null,
    minBookOf?: (ctype: number) => number | null,
): ShipClassOption[] {
    const counts = new Map<number, number>();
    for (const s of ships) {
        if (s.ctype > 0) counts.set(s.ctype, (counts.get(s.ctype) ?? 0) + 1);
    }
    const selectedSet = new Set(selectedCtypes.filter(c => c > 0));
    const allCtypes = new Set<number>([...counts.keys(), ...selectedSet]);
    const out: ShipClassOption[] = [];
    for (const ctype of allCtypes) {
        out.push({
            ctype,
            label: shipClassLabel(ctype, lang, repOf?.(ctype)),
            count: counts.get(ctype) ?? 0,
            minBookNo: minBookOf?.(ctype) ?? null,
            selected: selectedSet.has(ctype),
        });
    }
    return out.sort((a, b) => {
        if (a.minBookNo == null && b.minBookNo == null) return a.ctype - b.ctype;
        if (a.minBookNo == null) return 1;
        if (b.minBookNo == null) return -1;
        return a.minBookNo - b.minBookNo || a.ctype - b.ctype;
    });
}
