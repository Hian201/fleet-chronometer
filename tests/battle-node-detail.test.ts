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
    const cases: { file: string; node: number; kind: 'air' | 'shelling' | 'torpedo' | 'asw'; deckId: number; damage: number }[] = [
        { file: '61-3.json', node: 25, kind: 'shelling', deckId: 3, damage: 103 },
        { file: '61-3.json', node: 51, kind: 'shelling', deckId: 3, damage: 186 },
        // 決戰支援出動了但一發沒中：0 是事實，不是「沒有支援」——故仍要有 support 物件。
        { file: '61-3.json', node: 53, kind: 'shelling', deckId: 4, damage: 0 },
        { file: '61-5-jibun-rengou-node52.json', node: 1, kind: 'asw', deckId: 4, damage: 135 },
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

    it('砲擊支援依敵艦隊位置對應名稱所需的索引，並保留命中／暴擊判定', () => {
        const combined = load('61-5-jibun-rengou-node52.json').battles.find((b: any) => b.node === 55);
        const phase = analyze(combined.data).timeline!.phases.find(p => p.kind === 'supportShell')!;
        expect(phase.events.map(event => ({
            defenderIndex: event.defenderIndex, damage: event.damage, critical: event.critical,
        }))).toEqual([
            { defenderIndex: 7, damage: 123, critical: false },
            { defenderIndex: 8, damage: 329, critical: true },
        ]);
        expect(phase.events.every(event => event.beforeHp !== null && event.afterHp !== null)).toBe(true);
    });

    it('敵單艦隊支援封包的第 0 格佔位會正規化，不把第一發誤配到第二艘敵艦', () => {
        const single = load('61-3.json').battles.find((b: any) => b.node === 25);
        const phase = analyze(single.data).timeline!.phases.find(p => p.kind === 'supportShell')!;
        expect(phase.events.map(event => [event.defenderIndex, event.damage])).toEqual([[0, 103]]);
    });
});

describe('交戰記錄時間線', () => {
    it('依官方階段欄位區分基地噴式、空母噴式與一般基地航空隊順序', () => {
        const packet = {
            api_f_nowhps: [100], api_f_maxhps: [100],
            api_e_nowhps: [100], api_e_maxhps: [100],
            api_air_base_injection: {
                api_stage3: { api_edam: [11] },
            },
            api_injection_kouku: {
                api_stage3: { api_edam: [13] },
            },
            api_air_base_attack: [{
                api_base_id: 1,
                api_stage1: { api_f_count: 18, api_f_lostcount: 0, api_e_count: 0, api_e_lostcount: 0 },
                api_stage3: { api_edam: [17] },
            }],
        };
        const view = analyzeBattle([packet], { main: [], escort: [] });
        expect(view.timeline!.phases.map(phase => phase.kind)).toEqual([
            'jetBase', 'jet', 'landBase',
        ]);
        expect(view.timeline!.phases.map(phase => phase.events[0]?.kind)).toEqual([
            'landBase', 'air', 'landBase',
        ]);
        expect(view.timeline!.phases.map(phase => phase.enemyDamage)).toEqual([11, 13, 17]);
    });

    it('用開幕雷擊的攻擊者／目標陣列還原聯合艦隊隨伴艦，不再只顯示受擊總表', () => {
        const packet = {
            api_f_nowhps: [100, 100, 100, 100, 100, 100],
            api_f_maxhps: [100, 100, 100, 100, 100, 100],
            api_f_nowhps_combined: [100, 100, 100, 100, 100, 100],
            api_f_maxhps_combined: [100, 100, 100, 100, 100, 100],
            api_e_nowhps: [300, 300, 300, 300],
            api_e_maxhps: [300, 300, 300, 300],
            api_opening_atack: {
                // E2_Boss.json 的實際形狀：第 11 格（0-based）是我方隨伴艦第 5 格。
                api_frai_list_items: [null, null, null, null, null, null, null, null, null, null, [3], null],
                api_fydam_list_items: [null, null, null, null, null, null, null, null, null, null, [131], null],
                api_fcl_list_items: [null, null, null, null, null, null, null, null, null, null, [1], null],
                api_erai_list_items: [null, null, null, null],
                api_eydam_list_items: [null, null, null, null],
                api_ecl_list_items: [null, null, null, null],
                api_fdam: [0, 0, 0, 0, 0, 0],
                api_edam: [0, 0, 0, 131],
            },
        };
        const view = analyzeBattle([packet], { main: [], escort: [] });
        const phase = view.timeline!.phases.find(item => item.kind === 'openingTorpedo')!;
        expect(phase.events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                attackerSide: 'player', attackerIndex: 10,
                defenderSide: 'enemy', defenderIndex: 3, damage: 131,
            }),
        ]));
        expect(phase.enemyDamage).toBe(131);
        expect(phase.events.some(event => event.attackerIndex === null)).toBe(false);
    });

    it('開幕雷擊保留封包明示的 0 傷害命中，不製造目標未提供列', () => {
        const packet = {
            api_f_nowhps: [100], api_f_maxhps: [100],
            api_e_nowhps: [100], api_e_maxhps: [100],
            api_opening_atack: {
                api_frai: [0], api_fydam: [0], api_fcl: [1],
                api_erai: [-1], api_eydam: [0], api_ecl: [0],
                api_fdam: [0], api_edam: [0],
            },
        };
        const view = analyzeBattle([packet], { main: [], escort: [] });
        const phase = view.timeline!.phases.find(item => item.kind === 'openingTorpedo')!;
        expect(phase.events).toHaveLength(1);
        expect(phase.events[0]).toMatchObject({
            attackerIndex: 0, defenderIndex: 0, damage: 0,
        });
    });

    it('沿用同一套傷害解析，留下陸航／支援／砲雷擊階段與 HP 快照', () => {
        const sample = load('61-3.json');
        const node = sample.battles.find((b: any) => b.node === 53);
        const view = analyzeBattle([node.data, node.yasen], { main: [], escort: [] });
        expect(view.timeline).toBeDefined();
        expect(view.timeline!.initial.enemyMain).toHaveLength(6);
        expect(view.timeline!.phases.map(phase => phase.kind)).toEqual(expect.arrayContaining([
            'landBase', 'supportShell', 'shelling1', 'torpedo', 'nightShelling',
        ]));
        const shelling = view.timeline!.phases.find(phase => phase.kind === 'shelling1')!;
        expect(shelling.events.length).toBeGreaterThan(0);
        expect(shelling.events.some(event => event.kind === 'ship' && event.attackerIndex !== null)).toBe(true);
        expect(shelling.events.some(event => event.damage > 0 && event.beforeHp !== null && event.afterHp !== null)).toBe(true);
        const last = view.timeline!.phases.at(-1)!;
        expect(last.enemyDamage).toBeGreaterThanOrEqual(0);
        expect(last.playerMain.map(ship => ship?.hp ?? 0)).toEqual(
            view.resultFleets!.playerMain.map(ship => ship.hp),
        );
    });

    it('保留特殊砲擊／夜戰 CI 的攻擊代碼與裝備，且忽略 -1 填充欄位', () => {
        const sample = load('61-5-jibun-rengou-node52.json');
        const node = sample.battles.find((b: any) => b.node === 55);
        const view = analyzeBattle([node.data, node.yasen], { main: [], escort: [] });
        expect(view.nightEffects).toMatchObject({ nightRecon: true }); // yasen 的 api_touch_plane[0] = 469
        const daySpecial = view.timeline!.phases.find(phase => phase.kind === 'shelling1')!;
        expect(daySpecial.events.slice(0, 3).map(event => ({
            attackerIndex: event.attackerIndex,
            defenderIndex: event.defenderIndex,
            damage: event.damage,
            attackType: event.attackType,
            specialType: event.specialType,
        }))).toEqual([
            { attackerIndex: 0, defenderIndex: 4, damage: 1152, attackType: 401, specialType: null },
            { attackerIndex: 0, defenderIndex: 2, damage: 804, attackType: 401, specialType: null },
            { attackerIndex: 0, defenderIndex: 0, damage: 412, attackType: 401, specialType: null },
        ]);

        const night = view.timeline!.phases.find(phase => phase.kind === 'nightShelling')!;
        const torpedoLookout = night.events.filter(event => event.specialType === 9);
        expect(torpedoLookout.map(event => ({
            defenderIndex: event.defenderIndex,
            damage: event.damage,
            attackSlots: event.attackSlots,
        }))).toEqual([
            { defenderIndex: 3, damage: 369, attackSlots: [179, 285, 412] },
        ]);
        expect(torpedoLookout.every(event => event.attackerIndex === 11)).toBe(true);

        const radarSample = load('61-4.json');
        const radarNode = radarSample.battles.find((b: any) => b.node === 55);
        const radarView = analyzeBattle([radarNode.data, radarNode.yasen], { main: [], escort: [] });
        const mainTorpedoRadar = radarView.timeline!.phases
            .find(phase => phase.kind === 'nightShelling')!.events
            .filter(event => event.specialType === 7);
        expect(mainTorpedoRadar[0]).toMatchObject({
            attackerIndex: 3, defenderIndex: 0, damage: 209, attackSlots: [366, 286, 506],
        });
    });

    it('夜戰只標記封包明示或出擊快照可確認的夜戰裝備發動', () => {
        const packet = {
            api_f_nowhps: [20], api_f_maxhps: [20],
            api_e_nowhps: [30], api_e_maxhps: [30],
            api_flare_pos: [0, -1], api_touch_plane: [102, -1],
            api_hougeki: {
                api_at_eflag: [0], api_at_list: [0], api_df_list: [[0]],
                api_damage: [[3]], api_si_list: [[74]],
            },
        };
        const view = analyzeBattle([packet], { main: [], escort: [] }, {
            playerGearIds: { main: [[101, 102, 74]], escort: [] },
        });
        expect(view.nightEffects).toEqual({ starShell: true, nightRecon: true, searchlight: true });

        const noEffect = analyzeBattle([{
            ...packet,
            api_flare_pos: [-1, -1], api_touch_plane: [471, -1],
            api_hougeki: { ...packet.api_hougeki, api_si_list: [[122]] },
        }], { main: [], escort: [] }, {
            playerGearIds: { main: [[122]], escort: [] },
        });
        expect(noEffect.nightEffects).toEqual({ starShell: false, nightRecon: false, searchlight: false });

        const taihaSearchlight = analyzeBattle([{
            ...packet,
            api_f_nowhps: [1], api_flare_pos: [-1, -1], api_touch_plane: [471, -1],
            api_hougeki: { ...packet.api_hougeki, api_si_list: [[74]] },
        }], { main: [], escort: [] });
        expect(taihaSearchlight.nightEffects?.searchlight).toBe(false);

        const striking = analyzeBattle([{
            ...packet,
            api_f_nowhps: [20, 20, 20, 20, 20, 20, 20],
            api_f_maxhps: [20, 20, 20, 20, 20, 20, 20],
            api_flare_pos: [6, -1],
        }], { main: [], escort: [] }, {
            playerGearIds: {
                main: [[], [], [], [], [], [], [101, 102, 74]], escort: [],
            },
        });
        expect(striking.nightEffects?.starShell).toBe(true);
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
