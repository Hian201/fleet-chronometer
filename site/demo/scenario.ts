// 產品介紹頁 demo 的示範情境：把建置時抽出的 master、61-4 實戰封包與任務樣本，
// 組成「母港 → 五個節點 → 回港」的 raw event 序列，交給正式面板投影。
// 母港、裝備、入渠與遠征是依 state.ts 讀取的欄位組出的示意資料，不是任何玩家的封包；
// 戰鬥封包保留原樣，因此預測、大破判定與斬殺線都由正式邏輯算出。
import { GameState } from '@/utils/state';
import { nodeLetter } from '@/utils/map-node-letters';

export interface DemoEvent { path: string; api: any; req: Record<string, string> }
export interface DemoStep { id: string; node?: string; events: DemoEvent[] }

interface Kc3Ship { mst_id: number; level: number; morale: number; stats: { ev: number; ls: number; as: number }; kyouka: number[]; equip: number[]; stars: number[]; ace: number[] }
interface Kc3Plane { squad: number; mst_id: number; count: number; max_count: number; stars: number; ace: number; state: number; morale: number }
interface Kc3Base { rid: number; range: number; action: number; planes: Kc3Plane[] }
interface Kc3Battle { node: number; rating: string; drop: number; mvp: number[]; data: any; yasen: any }
interface Kc3Node { id: number; eventId: number; eventKind: number; eventColorNo: number }

export interface DemoData {
    master: any;
    sortie: {
        world: number; mapnum: number; diff: number;
        fleets: Kc3Ship[][]; lbas: Kc3Base[];
        eventmap: { api_max_maphp: number; api_gauge_type: number; api_gauge_num: number };
        nodes: Kc3Node[]; battles: Kc3Battle[];
    };
    quests: any[];
}

// 示意母港的板凳艦（入渠用）與建造中艦；只取 master id，數值由 master 推得。
const BENCH = [{ mst: 541, lv: 99, hp: 41 }, { mst: 591, lv: 99, hp: 60 }];
// 遠征：37／38 東京急行、21 北方鼠輸送作戦。剩餘時間刻意錯開，方便看到倒數。
const EXPEDITIONS = [{ id: 37, mins: 6 }, { id: 38, mins: 47 }, { id: 21, mins: 83 }];
const QUEST_NOS = [201, 214, 226, 210, 303, 402, 503, 605];

export function buildScenario(data: DemoData, now: number): { seed: DemoEvent[]; steps: DemoStep[] } {
    const { master, sortie } = data;
    const mstShip = new Map<number, any>(master.api_mst_ship.map((s: any) => [s.api_id, s]));
    const mstStype = new Map<number, any>(master.api_mst_stype.map((s: any) => [s.api_id, s]));
    const slotItems: any[] = [];
    const addItem = (mst: number, level = 0, alv = -1) => {
        const id = slotItems.length + 1;
        slotItems.push({ api_id: id, api_slotitem_id: mst, api_locked: 0, api_level: level, ...(alv >= 0 ? { api_alv: alv } : {}) });
        return id;
    };

    let nextShipId = 1;
    const ships: any[] = [];
    const firstBattle = sortie.battles[0].data;
    const makeShip = (k: Kc3Ship, hp?: { now: number; max: number }) => {
        const m = mstShip.get(k.mst_id);
        const slotNum = m.api_slot_num as number;
        const equip = k.equip.map(v => v > 0 ? v : -1);
        const slot = equip.slice(0, slotNum).map((mst, i) => mst > 0 ? addItem(mst, k.stars[i], k.ace[i]) : -1);
        const exIndex = equip.findIndex((mst, i) => i >= slotNum && mst > 0);
        const maxhp = hp?.max ?? m.api_taik[0];
        const stat = (pair: number[] | undefined) => [pair?.[1] ?? 0, pair?.[1] ?? 0];
        const ship = {
            api_id: nextShipId++, api_sortno: m.api_sortno, api_ship_id: k.mst_id, api_lv: k.level,
            api_exp: [0, 0, 0], api_nowhp: hp?.now ?? maxhp, api_maxhp: maxhp,
            api_soku: m.api_soku, api_leng: m.api_leng,
            api_slot: [...slot, ...Array(5 - slot.length).fill(-1)],
            api_onslot: [...(m.api_maxeq ?? [0, 0, 0, 0, 0])].slice(0, 5),
            api_slot_ex: exIndex >= 0 ? addItem(equip[exIndex], k.stars[exIndex], k.ace[exIndex]) : -1,
            api_kyouka: k.kyouka, api_backs: m.api_backs ?? 1,
            api_fuel: m.api_fuel_max, api_bull: m.api_bull_max, api_slotnum: slotNum,
            api_ndock_time: 0, api_ndock_item: [0, 0], api_srate: 0, api_cond: Math.min(k.morale, 85),
            api_karyoku: stat(m.api_houg), api_raisou: stat(m.api_raig), api_taiku: stat(m.api_tyku),
            api_soukou: stat(m.api_souk), api_kaihi: [k.stats.ev, k.stats.ev], api_taisen: [k.stats.as, k.stats.as],
            api_sakuteki: [k.stats.ls, k.stats.ls], api_lucky: [m.api_luck?.[0] ?? 10, m.api_luck?.[1] ?? 50],
            api_locked: 1, api_locked_equip: 0, api_sally_area: 0,
        };
        ships.push(ship);
        return ship;
    };

    const fleets = sortie.fleets.map((list, deck) => list.map((k, i) => makeShip(k, deck === 0
        ? { now: firstBattle.api_f_nowhps[i], max: firstBattle.api_f_maxhps[i] } : undefined)));
    const bench = BENCH.map(b => {
        const m = mstShip.get(b.mst);
        const ship = makeShip({ mst_id: b.mst, level: b.lv, morale: 40, stats: { ev: 60, ls: 40, as: 0 }, kyouka: [0, 0, 0, 0, 0], equip: [], stars: [], ace: [] });
        ship.api_nowhp = Math.min(b.hp, m.api_taik[0]);
        return ship;
    });

    // 基地航空隊：中隊裝備也要在裝備清單內，api_slotid 才查得到。
    const airBase = sortie.lbas.map(base => ({
        api_area_id: sortie.world, api_rid: base.rid,
        api_name: `第${['一', '二', '三'][base.rid - 1]}基地航空隊`,
        api_distance: { api_base: base.range, api_bonus: 0 }, api_action_kind: base.action,
        api_plane_info: base.planes.map(p => ({
            api_squadron_id: p.squad, api_state: p.state, api_slotid: addItem(p.mst_id, p.stars, p.ace),
            api_count: p.count, api_max_count: p.max_count, api_cond: p.morale || 1,
        })),
    }));
    // 未裝備的庫存，讓調度分頁有閒置裝備可看。
    for (const [mst, n] of [[68, 6], [75, 8], [286, 3], [412, 2], [131, 4]] as const)
        for (let i = 0; i < n; i++) addItem(mst);

    const minute = 60_000;
    const decks = fleets.map((list, i) => ({
        api_id: i + 1, api_name: `第${i + 1}艦隊`, api_name_id: '', api_flagship: '0',
        api_mission: i === 0 ? [0, 0, 0, 0] : [1, EXPEDITIONS[i - 1].id, now + EXPEDITIONS[i - 1].mins * minute, 0],
        api_ship: [...list.map(s => s.api_id), ...Array(6 - list.length).fill(-1)],
    }));
    const ndock = [0, 1, 2, 3].map(i => {
        const ship = bench[i];
        return {
            api_id: i + 1, api_state: ship ? 1 : 0, api_ship_id: ship?.api_id ?? 0,
            api_complete_time: ship ? now + (i ? 154 : 18) * minute : 0, api_complete_time_str: '0',
            api_item1: 0, api_item2: 0, api_item3: 0, api_item4: 0,
        };
    });
    const materials = [312480, 298115, 341020, 187655, 2210, 2984, 3150, 812];
    const port = (shipList: any[]) => ({
        api_material: materials.map((v, i) => ({ api_id: i + 1, api_value: v })),
        api_deck_port: decks, api_ndock: ndock, api_ship: shipList,
        api_basic: { api_nickname: 'Demo', api_level: 120, api_max_chara: 600, api_max_slotitem: 2400, api_count_deck: 4, api_count_kdock: 4, api_count_ndock: 4 },
        api_combined_flag: 0, api_parallel_quest_count: 10,
    });

    const kdock = [
        { api_id: 1, api_state: 2, api_created_ship_id: 131, api_complete_time: now + 192 * minute, api_complete_time_str: '0', api_item1: 4000, api_item2: 6000, api_item3: 6000, api_item4: 2000, api_item5: 20 },
        { api_id: 2, api_state: 3, api_created_ship_id: 183, api_complete_time: 0, api_complete_time_str: '0', api_item1: 300, api_item2: 30, api_item3: 400, api_item4: 300, api_item5: 1 },
        { api_id: 3, api_state: 0, api_created_ship_id: 0, api_complete_time: 0, api_complete_time_str: '0', api_item1: 0, api_item2: 0, api_item3: 0, api_item4: 0, api_item5: 0 },
        { api_id: 4, api_state: 0, api_created_ship_id: 0, api_complete_time: 0, api_complete_time_str: '0', api_item1: 0, api_item2: 0, api_item3: 0, api_item4: 0, api_item5: 0 },
    ];
    const quests = QUEST_NOS.map(no => data.quests.find(q => q.api_no === no)).filter(Boolean)
        .map(q => ({ ...q, api_state: 2, api_progress_flag: q.api_no === 214 ? 1 : 0 }));

    // 活動海域：目前血量壓在 Boss 血量以下，demo 一開始就是斬殺期。
    const bossBattle = sortie.battles[sortie.battles.length - 1].data;
    const mapId = sortie.world * 10 + sortie.mapnum;
    const eventmap = {
        api_now_maphp: Math.min(bossBattle.api_e_maxhps[0], sortie.eventmap.api_max_maphp),
        api_max_maphp: sortie.eventmap.api_max_maphp, api_state: 1, api_selected_rank: sortie.diff,
    };
    const seed: DemoEvent[] = [
        { path: 'api_start2/getData', api: master, req: {} },
        { path: 'api_get_member/require_info', api: { api_slot_item: slotItems, api_kdock: kdock, api_useitem: [] }, req: {} },
        { path: 'api_port/port', api: port(ships), req: {} },
        { path: 'api_get_member/questlist', api: { api_count: quests.length, api_list: quests }, req: { api_tab_id: '0' } },
        {
            path: 'api_get_member/mapinfo', req: {}, api: {
                api_map_info: [{ api_id: mapId, api_cleared: 0, api_gauge_type: sortie.eventmap.api_gauge_type, api_gauge_num: sortie.eventmap.api_gauge_num, api_eventmap: eventmap }],
                api_air_base: airBase, api_air_base_expanded_info: [{ api_area_id: sortie.world, api_maintenance_level: 3 }],
            },
        },
    ];

    // ── 出擊：map/start → (戰鬥 → 結算 → map/next)… → 回港 ──
    const cell = (node: Kc3Node, extra: object = {}) => ({
        api_maparea_id: sortie.world, api_mapinfo_no: sortie.mapnum, api_no: node.id,
        api_color_no: node.eventColorNo, api_event_id: node.eventId, api_event_kind: node.eventKind,
        api_next: 1, api_bosscell_no: sortie.nodes[sortie.nodes.length - 1].id, api_rashin_flg: 1, api_rashin_id: 1,
        ...extra,
    });
    const steps: DemoStep[] = [];
    sortie.nodes.forEach((node, i) => {
        const battle = sortie.battles[i];
        const isEc = !!battle.data.api_ship_ke_combined;
        const isAirRaid = !battle.data.api_hougeki1 && !battle.data.api_opening_atack && node.eventKind === 6;
        const move: DemoEvent = i === 0
            ? { path: 'api_req_map/start', api: cell(node, { api_eventmap: { ...eventmap, api_gauge_type: sortie.eventmap.api_gauge_type }, api_gauge_num: sortie.eventmap.api_gauge_num }), req: { api_deck_id: '1', api_maparea_id: String(sortie.world), api_mapinfo_no: String(sortie.mapnum) } }
            : { path: 'api_req_map/next', api: cell(node), req: {} };
        const letter = nodeLetter(`${sortie.world}-${sortie.mapnum}`, node.id) ?? String(node.id);
        steps.push({ id: i === 0 ? 'start' : 'next', node: letter, events: [move] });
        const dayPath = isEc ? 'api_req_combined_battle/ec_battle' : isAirRaid ? 'api_req_sortie/ld_airbattle' : 'api_req_sortie/battle';
        steps.push({ id: node.eventId === 5 ? 'boss' : isAirRaid ? 'airRaid' : 'battle', node: letter, events: [{ path: dayPath, api: battle.data, req: { api_formation: String(battle.data.api_formation?.[0] ?? 1) } }] });
        if (battle.yasen) {
            steps.push({ id: 'night', node: letter, events: [{ path: isEc ? 'api_req_combined_battle/ec_midnight_battle' : 'api_req_battle_midnight/battle', api: battle.yasen, req: {} }] });
        }
        const drop = battle.drop > 0 ? mstShip.get(battle.drop) : null;
        steps.push({
            id: 'result', node: letter, events: [{
                path: isEc ? 'api_req_combined_battle/battleresult' : 'api_req_sortie/battleresult', req: {},
                api: {
                    api_win_rank: battle.rating === 'SS' ? 'S' : battle.rating, api_mvp: battle.mvp?.[0] ?? 1,
                    api_get_exp: 0, api_get_base_exp: 0, api_member_lv: 120, api_first_clear: 0,
                    api_quest_name: '', api_quest_level: 1, api_get_flag: [0, drop ? 1 : 0, 0],
                    api_enemy_info: { api_level: '', api_rank: '', api_deck_name: '' },
                    ...(drop ? { api_get_ship: { api_ship_id: drop.api_id, api_ship_type: mstStype.get(drop.api_stype)?.api_name ?? '', api_ship_name: drop.api_name, api_ship_getmes: '' } } : {}),
                },
            }],
        });
    });

    // 回港：用正式 GameState 跑一遍出擊，取戰後血量與面板估算的燃彈、搭載數，母港封包照這份帶回。
    // GameState 會直接改寫收到的艦娘物件，模擬必須吃拷貝，否則母港封包會先帶著戰後數值。
    const sim = new GameState();
    for (const ev of structuredClone([...seed, ...steps.flatMap(s => s.events)])) sim.applyEvent(ev.path, ev.api, ev.req, now);
    const homeShips = ships.map(s => {
        const after = (sim as any).ships.get(s.api_id);
        return after ? { ...s, api_nowhp: after.api_nowhp, api_fuel: after.api_fuel, api_bull: after.api_bull, api_onslot: after.api_onslot, api_cond: after.api_cond } : s;
    });
    steps.push({ id: 'port', events: [{ path: 'api_port/port', api: port(homeShips), req: {} }] });
    return { seed, steps };
}
