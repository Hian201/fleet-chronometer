// 國籍對照表的驗證。**遊戲不提供國籍**，本表是人工參照資料，故測試的重點是
// 「表與真實 master 的結構一致」而非「表的內容正確」（後者只能靠人工核對）：
//   1. 表裡的每個 ctype 在真實 master 裡都存在（防手滑打錯 id → 該列永遠不生效）
//   2. 沒有被歸為日本的外國艦（掃全 master 的非日文艦名，逐一必須在表裡）
//   3. 反過來，被歸為外國的艦型裡不能混進純日文名的艦（除了已知的戰後移交形態）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NATIONS, NATION_BY_CTYPE, nationOf, type Nation } from '../utils/ship-nationality';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
/** 図鑑內艦（api_sortno > 0）。深海棲艦等不在収録範囲。 */
const playable: any[] = master.api_mst_ship.filter((s: any) => s.api_sortno);

/** 拉丁／西里爾／附加符號字母＝非日文艦名。用來反推「這艘應該是外國艦」。 */
const LATIN = /[A-Za-zА-Яа-яÀ-ÿ]/;

/**
 * 戰後移交他國並改名的形態：艦名是外文，但**建造國是日本**，故其 ctype 不在表裡。
 * 這是 ship-nationality.ts 檔頭「以建造國為準」規則的唯一方向（日→外）實例。
 */
const POSTWAR_TRANSFER_FROM_JP = new Set(['Верный']);

describe('國籍對照表與真實 master 的一致性', () => {
    it('表裡的每個 ctype 都真的存在於 master', () => {
        const known = new Set<number>(playable.map(s => s.api_ctype));
        for (const ctype of Object.keys(NATION_BY_CTYPE).map(Number)) {
            expect(known.has(ctype), `ctype ${ctype} 不存在於 master`).toBe(true);
        }
    });

    it('所有外文艦名的艦都有國籍歸屬，不會被預設成日本', () => {
        const missed = playable
            .filter(s => LATIN.test(s.api_name) && !POSTWAR_TRANSFER_FROM_JP.has(s.api_name))
            .filter(s => nationOf(s.api_ctype) === 'jp')
            .map(s => `${s.api_name}(ctype ${s.api_ctype})`);
        expect(missed).toEqual([]);
    });

    it('歸為外國的艦型裡不會混進日本艦（戰後移交日本的形態除外）', () => {
        // 伊503（ex C.Cappellini）／伊504（ex Luigi Torelli）是義大利建造後移交日本，
        // 艦名是漢字但國籍為義大利——這正是「以建造國為準」要處理的反方向實例。
        const transferredToJp = new Set(['伊503', '伊504']);
        const odd = playable
            .filter(s => nationOf(s.api_ctype) !== 'jp')
            .filter(s => !LATIN.test(s.api_name) && !transferredToJp.has(s.api_name))
            .map(s => `${s.api_name}(ctype ${s.api_ctype})`);
        expect(odd).toEqual([]);
    });

    it('每個宣告的國家都至少對到一個艦型——不做空選項', () => {
        const used = new Set<Nation>(Object.values(NATION_BY_CTYPE));
        used.add('jp');   // 日本是預設值，不會出現在表裡
        for (const nation of NATIONS) expect(used.has(nation), `${nation} 沒有任何艦型`).toBe(true);
    });

    it('NATIONS 涵蓋表裡出現的所有國家（顯示順序不可漏列）', () => {
        for (const nation of new Set(Object.values(NATION_BY_CTYPE))) {
            expect(NATIONS).toContain(nation);
        }
    });
});

describe('nationOf 的降級行為', () => {
    it('ctype 0（master 未載入）回傳 null，不可當成日本', () => {
        expect(nationOf(0)).toBeNull();
    });

    it('未列出的 ctype 一律日本；真實 master 沒有図鑑內艦的 ctype 為 0', () => {
        expect(nationOf(2)).toBe('jp');   // 睦月型
        expect(playable.filter(s => !s.api_ctype)).toEqual([]);
    });

    it('戰後移交形態歸建造國（三個真實實例）', () => {
        const byName = (name: string) => master.api_mst_ship.find((s: any) => s.api_name === name);
        expect(nationOf(byName('Верный').api_ctype)).toBe('jp');              // 響改二
        expect(nationOf(byName('General Belgrano').api_ctype)).toBe('us');    // ex Phoenix
        expect(nationOf(byName('Leonardo da Vinci').api_ctype)).toBe('us');   // ex Dace
        expect(nationOf(byName('伊504').api_ctype)).toBe('it');               // ex Luigi Torelli
    });
});
