// 艦型表與兩層國籍規則的驗證。
// **遊戲不提供艦型名與國籍**，本表為人工參照資料，故測試重點如下：
//   1. samples/start2-master.json 的每個図鑑艦 ctype 都在 SHIP_CLASSES 有列（漏登即失敗）
//   2. SHIP_CLASSES 的每個 ctype 都存在於真實 master（防手滑打錯 id）
//   3. 呂500（ctype 86）基本國籍為 de，四艘雙國籍艦的 nationsOf() 與非改名形態的單國籍規則
//   4. 未收錄的新 ctype 與 ctype 0 一律回傳 null（不可預設落回日本）
//   5. 艦型顯示名稱、搜尋別名與多面向收斂（含 0 艘保留與最小図鑑番號排序）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    SHIP_CLASSES, matchShipClassQuery, shipClassLabel, shipClassOptions,
} from '../utils/ship-class';
import { NATIONS, nationOf, nationsOf, type Nation } from '../utils/ship-nationality';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
/** 図鑑內艦（api_sortno > 0）。深海棲艦等不在収録範囲。 */
const playable: any[] = master.api_mst_ship.filter((s: any) => s.api_sortno);

/** 拉丁／西里爾／附加符號字母＝非日文艦名。用來反推「這艘應該是外國艦」。 */
const LATIN = /[A-Za-zА-Яа-яÀ-ÿ]/;

/**
 * 移交他國並改名的形態：艦名是外文，但**就役時所屬海軍為日本**，故第一層為 jp。
 */
const TRANSFER_FROM_JP = new Set(['Верный']);

/**
 * 就役於外國海軍、戰時移交日本並改為漢字艦名的形態：第一層維持原就役海軍（de／it）。
 */
const TRANSFER_TO_JP = new Set(['呂500', '伊503', '伊504']);

describe('艦型與國籍表與真實 master 的一致性', () => {
    it('start2 的每個図鑑艦 ctype 在 SHIP_CLASSES 都有一列（漏登即失敗）', () => {
        const missing = [...new Set<number>(playable.map(s => s.api_ctype))]
            .sort((a, b) => a - b)
            .filter(c => !(c in SHIP_CLASSES));
        expect(missing).toEqual([]);
    });

    it('表裡的每個 ctype 都真的存在於 master', () => {
        const known = new Set<number>(playable.map(s => s.api_ctype));
        for (const ctype of Object.keys(SHIP_CLASSES).map(Number)) {
            expect(known.has(ctype), `ctype ${ctype} 不存在於 master`).toBe(true);
        }
    });

    it('所有外文艦名的艦都不是日本（移交自日本者除外）', () => {
        const missed = playable
            .filter(s => LATIN.test(s.api_name) && !TRANSFER_FROM_JP.has(s.api_name))
            .filter(s => nationOf(s.api_ctype) === 'jp')
            .map(s => `${s.api_name}(ctype ${s.api_ctype})`);
        expect(missed).toEqual([]);
    });

    it('歸為外國的艦型裡不會混進日本艦（移交日本的形態除外）', () => {
        const odd = playable
            .filter(s => nationOf(s.api_ctype) !== 'jp')
            .filter(s => !LATIN.test(s.api_name) && !TRANSFER_TO_JP.has(s.api_name))
            .map(s => `${s.api_name}(ctype ${s.api_ctype})`);
        expect(odd).toEqual([]);
    });

    it('每個宣告的國家都至少對到一個艦型——不做空選項', () => {
        const used = new Set<Nation>(Object.values(SHIP_CLASSES).map(c => c.nation));
        for (const nation of NATIONS) expect(used.has(nation), `${nation} 沒有任何艦型`).toBe(true);
    });

    it('NATIONS 涵蓋表裡出現的所有國家（顯示順序不可漏列）', () => {
        for (const nation of new Set(Object.values(SHIP_CLASSES).map(c => c.nation))) {
            expect(NATIONS).toContain(nation);
        }
    });
});

describe('第一層基本國籍（就役時所屬海軍）與降級行為', () => {
    const byName = (name: string) => master.api_mst_ship.find((s: any) => s.api_name === name);

    it('ctype 0（master 未載入）與未收錄的新 ctype 都回傳 null，不可預設落回日本', () => {
        expect(nationOf(0)).toBeNull();
        expect(nationOf(9999)).toBeNull();
        expect(playable.filter(s => !s.api_ctype)).toEqual([]);
    });

    it('呂500（ctype 86）的基本國籍為 de', () => {
        const ro500 = byName('呂500');
        expect(ro500.api_id).toBe(436);
        expect(ro500.api_ctype).toBe(86);
        expect(nationOf(ro500.api_ctype)).toBe('de');
    });

    it('移交形態與外國建造日本就役艦皆依就役時所屬海軍判定', () => {
        expect(nationOf(byName('金剛').api_ctype)).toBe('jp');
        expect(nationOf(byName('神威').api_ctype)).toBe('jp');
        expect(nationOf(byName('Thonburi').api_ctype)).toBe('th');
        expect(nationOf(byName('Верный').api_ctype)).toBe('jp');
        expect(nationOf(byName('General Belgrano').api_ctype)).toBe('us');
        expect(nationOf(byName('Leonardo da Vinci').api_ctype)).toBe('us');
        expect(nationOf(byName('伊504').api_ctype)).toBe('it');
        expect(nationOf(byName('伊503').api_ctype)).toBe('it');
    });
});

describe('第二層國籍篩選標籤（四艘雙國籍艦）', () => {
    const byId = (id: number) => master.api_mst_ship.find((s: any) => s.api_id === id);

    it.each([
        [147, 'Верный', 'jp', ['jp', 'su']],
        [436, '呂500', 'de', ['de', 'jp']],
        [530, '伊504', 'it', ['it', 'jp']],
        [940, '伊503', 'it', ['it', 'jp']],
    ] as [number, string, Nation, Nation[]][])(
        'masterId %i (%s)：第一層 %s、第二層 %j',
        (id, name, base, tags) => {
            const ship = byId(id);
            expect(ship.api_name).toBe(name);
            expect(nationOf(ship.api_ctype)).toBe(base);
            expect(nationsOf(ship.api_id, ship.api_ctype)).toEqual(tags);
        },
    );

    it('非移交日本改名形態（U-511、Luigi Torelli、UIT-25、C.Cappellini、UIT-24）維持單國籍', () => {
        const byName = (name: string) => master.api_mst_ship.find((s: any) => s.api_name === name);
        expect(nationsOf(byName('U-511').api_id, byName('U-511').api_ctype)).toEqual(['de']);
        expect(nationsOf(byName('Luigi Torelli').api_id, byName('Luigi Torelli').api_ctype)).toEqual(['it']);
        expect(nationsOf(byName('UIT-25').api_id, byName('UIT-25').api_ctype)).toEqual(['it']);
        expect(nationsOf(byName('C.Cappellini').api_id, byName('C.Cappellini').api_ctype)).toEqual(['it']);
        expect(nationsOf(byName('UIT-24').api_id, byName('UIT-24').api_ctype)).toEqual(['it']);
    });

    it('ctype 不可考或未收錄時不套用逐艦覆蓋', () => {
        expect(nationsOf(147, 0)).toEqual([]);
        expect(nationsOf(436, 9999)).toEqual([]);
        expect(nationsOf(1, 28)).toEqual(['jp']);
    });
});

describe('艦型名稱、搜尋別名與多面向選項', () => {
    it('三語名稱符合規範，未收錄 ctype 退回 #編號（代表艦名）', () => {
        expect(shipClassLabel(54, 'zh-TW')).toBe('秋月型');
        expect(shipClassLabel(91, 'zh-TW')).toBe('Fletcher級');
        expect(shipClassLabel(87, 'zh-TW')).toBe('John C.Butler級');
        expect(shipClassLabel(124, 'zh-TW')).toBe('Marcello級');
        expect(shipClassLabel(134, 'zh-TW')).toBe('Courageous級');
        expect(shipClassLabel(135, 'zh-TW')).toBe('Glorious級');
        expect(shipClassLabel(91, 'en')).toBe('Fletcher-class');
        expect(shipClassLabel(999, 'zh-TW', '新艦娘')).toBe('#999（新艦娘）');
        expect(shipClassLabel(999, 'en', 'NewShip')).toBe('#999 (NewShip)');
        expect(shipClassLabel(999, 'zh-TW', '#999')).toBe('#999');
        expect(shipClassLabel(0, 'zh-TW')).toBe('');
    });

    it('系別與史實別名、外國艦中文音譯可搜尋命中', () => {
        // 特型 → 吹雪(12)、綾波(1)、暁(5)
        for (const c of [12, 1, 5]) expect(matchShipClassQuery(c, '特型')).toBe(true);
        expect(matchShipClassQuery(12, '特I型')).toBe(true);
        expect(matchShipClassQuery(54, '乙型')).toBe(true);
        expect(matchShipClassQuery(101, '丁型')).toBe(true);
        // 甲型同時命中陽炎(30)、夕雲(38)、択捉(77)
        for (const c of [30, 38, 77]) expect(matchShipClassQuery(c, '甲型')).toBe(true);
        // 海防艦：御蔵(94)、日振(85)、鵜来(117)屬乙型系，104 屬丁型
        for (const c of [94, 85, 117]) expect(matchShipClassQuery(c, '乙型')).toBe(true);
        expect(matchShipClassQuery(104, '丁型')).toBe(true);
        // 史實別名與中文音譯
        expect(matchShipClassQuery(46, '丸優')).toBe(true);
        expect(matchShipClassQuery(96, '改良型利安德級')).toBe(true);
        expect(matchShipClassQuery(96, 'Modified Leander')).toBe(true);
        expect(matchShipClassQuery(58, 'Littorio')).toBe(true);
        expect(matchShipClassQuery(133, 'Eidsvold')).toBe(true);
        expect(matchShipClassQuery(91, '弗萊徹')).toBe(true);
        expect(matchShipClassQuery(91, '強斯頓')).toBe(true);
    });

    it('多面向選項依最小図鑑番號排序，已選但 0 艘的艦型保留並標 count=0', () => {
        const minBook = new Map<number, number>([[19, 1], [12, 11], [91, 362]]);
        const opts = shipClassOptions(
            [{ ctype: 12 }, { ctype: 19 }, { ctype: 12 }],
            [91],
            'zh-TW',
            undefined,
            c => minBook.get(c) ?? null,
        );
        expect(opts).toEqual([
            { ctype: 19, label: '長門型', count: 1, minBookNo: 1, selected: false },
            { ctype: 12, label: '吹雪型', count: 2, minBookNo: 11, selected: false },
            { ctype: 91, label: 'Fletcher級', count: 0, minBookNo: 362, selected: true },
        ]);
    });
});
