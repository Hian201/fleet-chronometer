// `analyzeBattle` 的節點附加資訊：基地航空隊戰果（BattleLbasView）、支援艦隊戰果
// （BattleSupportView）與敵艦詳細（BattleEnemyShipView）。三者都只供面板顯示，
// 不影響血量歸屬與 rank 判定。
//
// 全部數字取自**真封包**（samples/*.json 為 KC3Kai logger 匯出，battles[].data 就是原封的
// kcsapi 戰鬥封包），欄位佈局照 CLAUDE.md 驗證原則先對照過再實作：
//   · `api_air_base_attack` 是陣列，一波一個元素（基地防空的同名欄位是物件，不走這裡）。
//   · 陸航損失＝`api_stage1.api_f_lostcount`（制空戰）＋`api_stage2.api_f_lostcount`（對空砲火）。
//   · 陸航對敵傷害＝`api_stage3.api_edam` ＋ `api_stage3_combined.api_edam`，先切捨再加總。
//   · 支援艦隊：`api_support_airatack`（航空）與 `api_support_hourai`（砲擊）擇一非 null。
//     傷害只加總、不逐位置歸屬——真封包的陣列長度時而 7 時而 12，索引基準尚未定案。
//   · 敵艦詳細：`api_ship_lv`／`api_eParam`／`api_eSlot`（＋`*_combined`）與
//     `api_ship_ke` 同序，皆 0-indexed；過濾掉 id<=0 的位置後仍須對齊原始索引。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeBattle } from '../utils/battle';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));

/** 只餵戰鬥封包即可——本測試看的是彙總欄位，不依賴損管與退避狀態。 */
const analyze = (api: unknown) => analyzeBattle([api], { main: [], escort: [] });

describe('基地航空隊戰果彙總', () => {
    const sample = load('61-4.json');
    const lbasBattle = sample.battles.find((b: any) => Array.isArray(b.data?.api_air_base_attack));

    it('61-4 節點55：四波合計與逐波明細與真封包一致', () => {
        const lbas = analyze(lbasBattle.data).lbas!;
        expect(lbas).not.toBeNull();
        expect(lbas.waves).toHaveLength(4);
        expect(lbas.waves.map(w => w.baseId)).toEqual([1, 1, 2, 2]);
        expect(lbas.waves.map(w => w.sent)).toEqual([58, 58, 58, 58]);
        expect(lbas.waves.map(w => w.lost)).toEqual([20, 24, 36, 27]);
        expect(lbas.waves.map(w => w.damage)).toEqual([628, 565, 478, 885]);
        expect(lbas.sent).toBe(232);
        expect(lbas.lost).toBe(107);
        expect(lbas.damage).toBe(2556);
    });

    it('逐波帶各自的制空狀態（api_stage1.api_disp_seiku）', () => {
        // 面板的陸航 hover 要逐波講「這一波是優勢還是劣勢」，故制空狀態必須逐波留著，
        // 不能只留整場合計。61-4 節點55：前兩波劣勢(3)、後兩波喪失(4)。
        expect(analyze(lbasBattle.data).lbas!.waves.map(w => w.seiku)).toEqual([3, 3, 4, 4]);
    });

    it('雙方都沒出動艦載機的波次不報制空狀態（回 null，不照抄 api_disp_seiku）', () => {
        // 判準與主隊航空戰一致：兩軍機數合計為 0 就是沒有制空戰。這裡用手捏封包
        // ——真封包樣本的陸航波次都有敵機，湊不出這個邊界。
        const noAir = {
            api_f_nowhps: [40], api_f_maxhps: [40],
            api_e_nowhps: [90], api_e_maxhps: [90], api_ship_ke: [1501],
            api_air_base_attack: [{
                api_base_id: 1,
                api_stage1: { api_f_count: 0, api_f_lostcount: 0, api_e_count: 0, api_e_lostcount: 0, api_disp_seiku: 1 },
            }],
        };
        expect(analyze(noAir).lbas!.waves.map(w => w.seiku)).toEqual([null]);
    });

    it('沒有 api_air_base_attack 的節點回 null（不是 0/0/0）', () => {
        const plain = sample.battles.find((b: any) => !b.data?.api_air_base_attack);
        expect(analyze(plain.data).lbas).toBeNull();
    });

    it('傷害欄的小數先切捨再加總（6-5 ec_battle 實測有 0.1）', () => {
        const ec = load('6-5-ec_battle.json');
        const waves = ec.api_air_base_attack;
        expect(Array.isArray(waves)).toBe(true);
        const lbas = analyze(ec).lbas!;
        // 0.1 切捨為 0，故該格不貢獻傷害；總和仍等於各整數格之和。
        const expected = waves.reduce((sum: number, w: any) => sum
            + [...(w.api_stage3?.api_edam ?? []), ...(w.api_stage3_combined?.api_edam ?? [])]
                .reduce((n: number, v: number) => n + Math.max(0, Math.floor(v ?? 0)), 0), 0);
        expect(lbas.damage).toBe(expected);
    });

    it('封包沒帶 api_base_id 時記 0＝不可考，不猜是第幾基地', () => {
        const ec = load('6-5-ec_battle.json');
        expect(analyze(ec).lbas!.waves.every(w => w.baseId === 0)).toBe(true);
    });
});

describe('支援艦隊戰果彙總', () => {
    /** 樣本中每個帶 api_support_info 的節點 → 期望值（由原始封包逐格切捨加總算出）。 */
    const cases: { file: string; node: number; kind: 'air' | 'shelling'; deckId: number; damage: number }[] = [
        { file: '61-3.json', node: 25, kind: 'shelling', deckId: 3, damage: 103 },
        { file: '61-3.json', node: 51, kind: 'shelling', deckId: 3, damage: 186 },
        // 決戰支援出動了但一發沒中：0 是事實，不是「沒有支援」——故仍要有 support 物件。
        { file: '61-3.json', node: 53, kind: 'shelling', deckId: 4, damage: 0 },
        { file: '61-5-jibun-rengou-node52.json', node: 1, kind: 'air', deckId: 4, damage: 135 },
        { file: '61-5-jibun-rengou-node52.json', node: 15, kind: 'air', deckId: 4, damage: 36 },
        { file: '61-5-jibun-rengou-node52.json', node: 55, kind: 'shelling', deckId: 3, damage: 452 },
    ];

    for (const c of cases) {
        it(`${c.file} 節點${c.node}：${c.kind} 第${c.deckId}艦隊 傷害${c.damage}`, () => {
            const battle = load(c.file).battles.find((b: any) => b.node === c.node);
            const support = analyze(battle.data).support!;
            expect(support).not.toBeNull();
            expect(support.kind).toBe(c.kind);
            expect(support.deckId).toBe(c.deckId);
            expect(support.damage).toBe(c.damage);
            // api_ship_id 是艦實例 id，原樣保留（反查名稱是呼叫端的事）
            expect(support.shipIds).toHaveLength(6);
        });
    }

    it('沒有 api_support_info 的節點回 null', () => {
        const plain = load('61-3.json').battles.find((b: any) => !b.data?.api_support_info);
        expect(analyze(plain.data).support).toBeNull();
    });
});

describe('敵艦詳細（等級／素質／裝備）', () => {
    // 61-3 節點53 是敵聯合，主隊與隨伴兩組平行陣列都在同一則封包裡，一次驗兩邊。
    const battle = load('61-3.json').battles.find((b: any) => b.node === 53).data;

    it('主隊與 api_ship_ke 同序、逐項對上真封包', () => {
        const { enemyIds, enemyDetail } = analyze(battle);
        expect(enemyIds).toEqual([2343, 1759, 1759, 1664, 2322, 2319]);
        expect(enemyDetail.main).toHaveLength(enemyIds.length);
        expect(enemyDetail.main[0].param).toEqual([360, 170, 105, 295]);
        expect(enemyDetail.main[0].slots).toEqual([1578, 1578, 1657, 1580, 1575]);
    });

    it('隨伴讀 *_combined，-1 空格不列入裝備', () => {
        const { enemyIdsEscort, enemyDetail } = analyze(battle);
        expect(enemyIdsEscort).toEqual([1862, 2051, 2051, 2051, 1623, 1623]);
        expect(enemyDetail.escort).toHaveLength(enemyIdsEscort.length);
        expect(enemyDetail.escort[0].param).toEqual([122, 98, 108, 108]);
        // 原始封包是 [1550, 1550, 1545, 1525, -1]
        expect(enemyDetail.escort[0].slots).toEqual([1550, 1550, 1545, 1525]);
    });

    it('欄位缺席時回可辨識的空值，不補猜測值', () => {
        // 只給敵艦 id，其餘平行陣列全缺。
        const { enemyDetail } = analyze({ api_ship_ke: [1501, 1502] });
        expect(enemyDetail.main).toEqual([
            { lv: 0, param: null, slots: [] },
            { lv: 0, param: null, slots: [] },
        ]);
        expect(enemyDetail.escort).toEqual([]);
    });

    it('api_ship_ke 中間有空格時，詳細仍對齊原始位置', () => {
        const { enemyIds, enemyDetail } = analyze({
            api_ship_ke: [1501, 0, 1503],
            api_eParam: [[10, 11, 12, 13], [0, 0, 0, 0], [30, 31, 32, 33]],
            api_eSlot: [[1], [2], [3]],
            api_ship_lv: [5, 6, 7],
        });
        expect(enemyIds).toEqual([1501, 1503]);
        // 第二艘取的是原始 index 2 那格，不是過濾後的 index 1
        expect(enemyDetail.main[1]).toEqual({ lv: 7, param: [30, 31, 32, 33], slots: [3] });
    });
});
