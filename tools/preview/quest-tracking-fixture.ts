// 任務進度判定的離線預覽共用情境：以 GameState 重播示意封包，涵蓋四種可信度與需重核。
// 艦娘 master id 與海域名稱取自 samples/start2-master.json；時間與戰果皆為示意。
import { GameState } from '../../utils/state';

const SHIPS: [number, string][] = [[1034, '涼波改二'], [69, '鳥海'], [674, '玉波'], [982, '早波改二'], [485, '藤波'], [1, '睦月'], [83, '赤城'], [84, '加賀'], [90, '蒼龍'], [91, '飛龍'], [89, '鳳翔']];
const MAPS: [number, number, string][] = [[5, 4, 'サーモン海域'], [5, 5, 'サーモン海域北方'], [5, 6, 'ラバウル方面海域'], [5, 2, '珊瑚諸島沖']];
const T0 = new Date(2026, 8, 26, 20, 15).getTime();
const at = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute).getTime();

function port(state: GameState, fleet: number[], ts: number) {
    state.applyEvent('api_port/port', {
        api_ship: fleet.map((mst, i) => ({
            api_id: 101 + i, api_ship_id: mst, api_lv: 90, api_nowhp: 30, api_maxhp: 30,
            api_cond: 49, api_slot: [-1, -1, -1, -1], api_slot_ex: 0, api_fuel: 15, api_bull: 15,
            api_onslot: [], api_soku: 10, api_ndock_time: 0, api_exp: [0, 0, 0],
        })),
        api_deck_port: [{ api_ship: fleet.map((_, i) => 101 + i), api_mission: [0, 0, 0, 0] }],
        api_material: [800, 600, 20000, 5000, 10, 10, 100, 20].map((value, i) => ({ api_id: i + 1, api_value: value })), api_ndock: [], api_basic: {},
    }, undefined, ts);
}

function battle(state: GameState, area: number, no: number, edge: number, boss: boolean, rank: string, ts: number) {
    state.applyEvent('api_req_map/start', { api_maparea_id: area, api_mapinfo_no: no, api_no: 1, api_color_no: 1 }, { api_deck_id: '1' }, ts);
    state.applyEvent('api_req_map/next', { api_no: edge, api_color_no: boss ? 5 : 4, api_event_id: boss ? 5 : 4 }, undefined, ts + 1);
    state.applyEvent('api_req_sortie/battleresult', { api_win_rank: rank }, {}, ts + 60_000);
}

// api_category 依遊戲的任務編號段（2xx→2、10xx→10…）；示意任務 9001／9002 分別當出擊與工廠。
const questApiCategory = (no: number) => no === 9001 ? 9 : no === 9002 ? 6 : Math.floor(no / 100);
const Q = (no: number, title: string, detail: string, flag = 0, state = 2) =>
    ({ api_no: no, api_category: questApiCategory(no), api_state: state, api_title: title, api_detail: detail, api_progress_flag: flag });

export function questTrackingFixture(): GameState {
    const s = new GameState();
    s.applyEvent('api_start2/getData', {
        api_mst_ship: SHIPS.map(([id, name]) => ({
            api_id: id, api_name: name, api_sortno: id, api_aftershipid: '0', api_stype: 2,
            api_taik: [30, 39], api_fuel_max: 15, api_bull_max: 15,
        })),
        api_mst_stype: [{ api_id: 2, api_name: '駆逐艦', api_equip_type: {} }],
        api_mst_slotitem: [
            { api_id: 2, api_name: '12.7cm連装砲', api_type: [1, 1, 1, 1, 0] },
            { api_id: 4, api_name: '14cm単装砲', api_type: [1, 1, 2, 2, 0] },
            { api_id: 19, api_name: '九六式艦戦', api_type: [3, 5, 6, 6, 0] },
            { api_id: 20, api_name: '零式艦戦21型', api_type: [3, 5, 6, 6, 0] },
            { api_id: 35, api_name: '三式弾', api_type: [2, 9, 18, 13, 0] },
            { api_id: 36, api_name: '九一式徹甲弾', api_type: [2, 10, 19, 14, 0] },
            { api_id: 75, api_name: 'ドラム缶(輸送用)', api_type: [9, 19, 30, 25, 0] },
        ],
        api_mst_slotitem_equiptype: [[1, '小口径主砲'], [2, '中口径主砲'], [3, '大口径主砲'], [8, '艦上攻撃機'], [10, '水上偵察機']]
            .map(([id, name]) => ({ api_id: id, api_name: name })),
        api_mst_mapinfo: MAPS.map(([area, no, name]) => ({ api_id: area * 10 + no, api_maparea_id: area, api_no: no, api_name: name })),
    }, undefined, T0 - 2);
    port(s, [1034, 69, 674, 1, 1, 1], T0 - 1);
    const list = (flag1047: number, flag243: number, flag210 = 0) => [
        Q(201, '敵艦隊を撃破せよ！', '艦隊を出撃させ、敵艦隊を捕捉、これを撃滅せよ！', 0, 3),
        Q(1047, '「涼波改二」ラバウルより抜錨せよ！', '「涼波改二/補」旗艦、他に「鳥海」、「鈴谷」、「最上」、「能代」、「玉波」、「藤波」、「早波」2隻以上を含む艦隊で、サ一モン海域、サ一モン海域北方、ラパウル方面海域最深部に反復出撃!ラバウル周辺の敵を駆逐せよ!', flag1047),
        Q(210, '敵艦隊を10回邀撃せよ！', '艦隊全力出撃！遊弋する敵艦隊を10回邀撃せよ！', flag210),
        Q(9001, '（示意）鳥海、出撃せよ！', '「涼波改二」旗艦の艦隊でサーモン海域北方最深部へ出撃、S勝利を達成せよ！', 0),
        Q(854, '戦果拡張任務！「Z作戦」前段作戦', '「第一艦隊」で南西諸島・西方・中部海域の敵を撃滅せよ！', 1),
        Q(243, '南方海域珊瑚諸島沖の制空権を握れ！', '南方海域珊瑚諸島沖に出撃し、敵機動部隊を撃滅せよ！', flag243),
        Q(342, '小艦艇群演習強化任務', '駆逐艦または海防艦計4隻(軽巡級1隻導入可能)を含む演習艦隊を編成、同演習艦隊による演習で本日中に【A判定】以上の勝利を4回以上達成せよ！', 0),
        // 營運重用編號的示意：984 在目錄裡是 2025 年的南瓜任務，這裡換成不同標題。
        Q(984, '【期間限定任務】（示意）14年目実りの秋、南瓜始め！', '（示意）鎮守府近海に出撃し、南瓜を収穫せよ！', 0),
        Q(9002, '（示意）装備を整備せよ！', '（示意）艦隊の装備を整備し、次期作戦に備えよ！', 1),
        Q(626, '精鋭「艦戦」隊の新編成', '要熟練搭乗員：練度max「零戦21型」搭載「鳳翔」秘書艦で「零戦21型」x2「九六艦戦」x1廃棄！', 0),
        Q(645, '「洋上補給」物資の調達', '「三式弾」一つを廃棄し燃料750及び弾薬750と「ドラム缶(輸送用)」二つと「九一式徹甲弾」一つを用意せよ！', 1),
        Q(114, '「南雲機動部隊」を編成せよ！', '一航戦「赤城」「加賀」二航戦「飛龍」「蒼龍」からなる第一機動部隊を編成せよ！', 0),
        Q(967, '海上護衛！ヒ船団を護り抜け！', 'ヒ船団海上護衛任務：南西海域：昭南本土航路における作戦を完遂し、昭南から本土方面に向かうヒ船団を、その脅威から護り抜け！艦隊、基地航空隊、出撃せよ！', 0),
        Q(655, '工廠フル稼働！新兵装を開発せよ！', '工廠任務：「小口径主砲」「中口径主砲」「大口径主砲」「水上偵察機」「艦上攻撃機」各5個を廃棄せよ！', 0),
    ];
    s.applyEvent('api_get_member/questlist', { api_list: list(0, 0) }, { api_tab_id: '0' }, T0);
    s.applyEvent('api_get_member/slot_item', [
        ...[501, 502, 503, 504, 505, 506, 507].map((id, i) => ({ api_id: id, api_slotitem_id: i < 5 ? 2 : 4 })),
        { api_id: 601, api_slotitem_id: 75 }, { api_id: 602, api_slotitem_id: 75 }, { api_id: 603, api_slotitem_id: 36 }, { api_id: 604, api_slotitem_id: 35 },
    ], undefined, T0 + 1);
    s.applyEvent('api_get_member/mapinfo', { api_map_info: [{ api_id: 74, api_cleared: 1, api_gauge_type: 1, api_defeat_count: 0, api_required_defeat_count: 3 }] }, undefined, T0 + 2);
    s.applyEvent('api_get_member/require_info', { api_slot_item: [
        ...[501, 502, 503, 504, 505, 506, 507].map((id, i) => ({ api_id: id, api_slotitem_id: i < 5 ? 2 : 4 })),
        { api_id: 601, api_slotitem_id: 75 }, { api_id: 602, api_slotitem_id: 75 }, { api_id: 603, api_slotitem_id: 36 }, { api_id: 604, api_slotitem_id: 35 },
    ], api_useitem: [{ api_id: 70, api_count: 2 }] }, undefined, T0 + 3);
    s.applyEvent('api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: '604' }, at(27, 21, 0));
    s.applyEvent('api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: '501,502,503,504,505,506,507' }, at(27, 21, 5));
    battle(s, 5, 4, 12, false, 'S', at(27, 22, 47));
    battle(s, 5, 4, 20, true, 'S', at(27, 23, 9));
    battle(s, 5, 2, 20, true, 'S', at(28, 19, 2));
    battle(s, 5, 2, 20, true, 'S', at(28, 19, 30));
    battle(s, 5, 4, 20, true, 'S', at(28, 20, 39));
    battle(s, 5, 5, 20, true, 'A', at(28, 21, 4));
    battle(s, 5, 5, 20, true, 'S', at(28, 21, 31));
    s.applyEvent('api_get_member/questlist', { api_list: list(1, 1, 1) }, { api_tab_id: '0' }, at(28, 21, 40));
    return s;
}
