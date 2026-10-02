import { describe, expect, it } from 'vitest';
import { QUEST_CATALOG_RAW } from '../utils/quest-catalog-data';
import translations from '../utils/quest-catalog-translations.json';
import { PLACE_NAMES } from '../utils/map-names';

// 任務日文原文出現地名索引（utils/map-names.ts PLACE_NAMES）裡的地名時，譯文必須使用索引的
// 寫法，或改以關卡編號（2-3、[W2-3]、World 2、2 圖）指稱。新任務沿用同一份索引，不另起譯名。

type Locale = 'zh-TW' | 'en';

// 譯文刻意省略地名的條目（不是寫法衝突）。key：`${任務編號} ${欄位} ${語系}`。
const OMITTED = new Map<string, string>([
    // 遠征類任務的說明只列遠征編號
    ...['189', '410', '432', '433', '438', '440', '442'].flatMap(no => (['zh-TW', 'en'] as const)
        .map(locale => [`${no} detail ${locale}`, '遠征／編成任務只列條件，未提地名'] as [string, string])),
    ['438 name en', '英文標題只寫週期與類別（Annual Expeditions - August）'],
    ['255 name en', '英文標題省略地點'],
    ['888 name en', '英文標題只寫週期與艦隊（Quarterly Mikawa Fleet）'],
    ['1018 name en', '英文標題只寫週期與艦隊'],
    ['927 name en', '「ペナン沖海戦」的史實英文名稱是 The Battle of the Malacca Strait'],
]);

const MAP_REFERENCE = /\[W[1-7]|(?<![0-9])[1-7]-[1-6](?![0-9])|\bWorld [1-7]\b|[1-7]\s*圖/;
const normalizeEn = (text: string) => text.toLowerCase().replace(/[\s\-‐]/g, '');

function mismatches(): string[] {
    // 長詞先比，命中後遮掉，避免「南西諸島海域」又被「南西諸島」重複判定
    const places = [...PLACE_NAMES].sort((a, b) => b.jp.length - a.jp.length);
    const found: string[] = [];
    for (const row of QUEST_CATALOG_RAW as unknown as unknown[][]) {
        const [no, , jpName, jpDetail] = row as [number, unknown, string, string];
        for (const locale of ['zh-TW', 'en'] as Locale[]) {
            const text = (translations as Record<string, Partial<Record<Locale, { name: string; detail: string }>>>)[String(no)]?.[locale];
            if (!text) continue;
            for (const [field, jp, translated] of [['name', jpName, text.name], ['detail', jpDetail, text.detail]] as const) {
                if (OMITTED.has(`${no} ${field} ${locale}`) || MAP_REFERENCE.test(translated)) continue;
                let rest = jp ?? '';
                for (const place of places) {
                    if (!rest.includes(place.jp)) continue;
                    rest = rest.split(place.jp).join('□');
                    const want = locale === 'en' ? place.en : place.zhTW;
                    const ok = locale === 'en'
                        ? normalizeEn(translated).includes(normalizeEn(want))
                        : translated.includes(want);
                    if (!ok) found.push(`${no} ${field} ${locale}: ${place.jp} → 應含「${want}」：${translated}`);
                }
            }
        }
    }
    return found;
}

describe('任務譯文的地名與地名索引一致', () => {
    it('原文提到的地名，譯文使用索引寫法或關卡編號', () => {
        expect(mismatches()).toEqual([]);
    });

    it('省略清單的條目仍存在於任務目錄（任務改版後要重新檢查）', () => {
        const ids = new Set((QUEST_CATALOG_RAW as unknown as unknown[][]).map(row => String(row[0])));
        for (const key of OMITTED.keys()) expect(ids.has(key.split(' ')[0]), key).toBe(true);
    });

    it('索引的日文詞不重複', () => {
        const jp = PLACE_NAMES.map(place => place.jp);
        expect(new Set(jp).size).toBe(jp.length);
    });
});
