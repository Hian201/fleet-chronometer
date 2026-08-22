// 艦娘全覽的「同名艦種消歧」契約（見 sections/ships.ts 的 buildStypeLabels 檔頭註解）。
//
// stype id 不等於航速，真封包可見 stype 8 有低速的 Гангут 線、stype 9 有高速的深海戰艦棲姫改；
// 因此群組層級用多數決加註，逐艦層級使用該艦自己的 api_soku，避免兩個群組都顯示相同名稱。
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStypeLabels, stypeDisplayLabel, type ShipsRow } from '../entrypoints/overview/sections/ships';
import { setLang, t } from '../utils/ui-i18n';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const mstShips: any[] = master.api_mst_ship;

/** 由真封包 master 取該艦的 stype／soku，避免測試自己編一組不存在的組合。 */
function shipRow(name: string): ShipsRow {
    const mst = mstShips.find(s => s.api_name === name);
    if (!mst) throw new Error(`master 找不到 ${name}`);
    return {
        stypeId: mst.api_stype,
        stype: t(`stype.${mst.api_stype}`),
        soku: mst.api_soku,
    } as unknown as ShipsRow;
}

beforeAll(() => setLang('zh-TW'));

describe('同名艦種的篩選標籤', () => {
    it('真封包佐證：stype 8／9 同名「戰艦」，且各自都有反例，故 id 不能當航速捷徑', () => {
        const bb8 = mstShips.filter(s => s.api_stype === 8);
        const bb9 = mstShips.filter(s => s.api_stype === 9);
        expect(t('stype.8')).toBe('戰艦');
        expect(t('stype.9')).toBe('戰艦');
        // stype 8 的低速反例（Гангут 線）與 stype 9 的高速反例（深海戰艦棲姫改）
        expect(bb8.some(s => s.api_soku < 10)).toBe(true);
        expect(bb9.some(s => s.api_soku >= 10)).toBe(true);
    });

    it('群組 checkbox：多數高速的那群加註「高速戰艦」，另一群維持原樣', () => {
        const roster = [
            shipRow('金剛'), shipRow('比叡'), shipRow('榛名'), shipRow('霧島'), // stype 8 高速
            shipRow('Гангут'),                                                  // stype 8 但低速
            shipRow('大和'), shipRow('長門'), shipRow('扶桑'),                   // stype 9 低速
            shipRow('吹雪'),                                                     // stype 2 驅逐，無同名
        ];
        const labels = new Map<number, string>();
        buildStypeLabels(roster, labels);

        expect(labels.get(8)).toBe('高速戰艦');
        expect(labels.get(9)).toBe('戰艦');
        // 兩顆一定不同字，這正是本功能存在的理由
        expect(labels.get(8)).not.toBe(labels.get(9));
        // 沒有同名衝突的艦種一個字都不動
        expect(labels.get(2)).toBe('驅逐');
    });

    it('逐艦欄位：用該艦自己的 api_soku，stype 8 的低速艦不會被謊報成高速', () => {
        const roster = [shipRow('金剛'), shipRow('Гангут'), shipRow('大和'), shipRow('吹雪')];
        buildStypeLabels(roster, new Map());

        expect(stypeDisplayLabel(shipRow('金剛'))).toBe('高速戰艦');
        // 群組多數是高速，但這一艘自己是低速——逐艦層級必須誠實
        expect(stypeDisplayLabel(shipRow('Гангут'))).toBe('戰艦');
        expect(stypeDisplayLabel(shipRow('大和'))).toBe('戰艦');
        expect(stypeDisplayLabel(shipRow('吹雪'))).toBe('驅逐');
    });

    it('航速缺值（soku 0）不加註，不把未知誤判成高速', () => {
        const roster = [shipRow('金剛'), shipRow('大和')];
        buildStypeLabels(roster, new Map());
        const unknown = { stypeId: 8, stype: t('stype.8'), soku: 0 } as unknown as ShipsRow;
        expect(stypeDisplayLabel(unknown)).toBe('戰艦');
    });

    it('名冊裡沒有同名衝突時完全不加註（例如只持有其中一群戰艦）', () => {
        const roster = [shipRow('金剛'), shipRow('比叡'), shipRow('吹雪')];
        const labels = new Map<number, string>();
        buildStypeLabels(roster, labels);
        expect(labels.get(8)).toBe('戰艦');
        expect(stypeDisplayLabel(shipRow('金剛'))).toBe('戰艦');
    });

    it('日文／英文同樣加註（三語 stype 8／9 都同名）', () => {
        for (const [lang, fast, plain] of [['ja', '高速戦艦', '戦艦'], ['en', 'Fast BB', 'BB']] as const) {
            setLang(lang);
            // shipRow() 讀的是目前語言的 stype 名，故要在切語言後才建列
            const labels = new Map<number, string>();
            buildStypeLabels([shipRow('金剛'), shipRow('大和')], labels);
            expect(labels.get(8)).toBe(fast);
            expect(labels.get(9)).toBe(plain);
        }
        setLang('zh-TW');
    });
});
