import RAW_EXPED from './expedition-data';
import { analyzeBattle } from './battle';
import { localizeShip, localizeGear } from './gamedata-i18n';
import { t } from './ui-i18n';
import { resolveQuestGoal, meetsRank, type QuestActionKind, type QuestGoal } from './quest-progress';

// ── 遠征需求表的型別(poi-plugin-expedition, MIT)──
interface ExpedEntry {
    id: number;
    flagship_lv: number;
    fleet_lv: number;
    flagship_shiptype: number;
    ship_count: number;
    drum_ship_count: number;
    drum_count: number;
    required_shiptypes: { shiptype: number[]; count: number }[];
    required_extra?: { asw?: number; aa?: number; los?: number; firepower?: number };
    big_success?: string | null;
    [k: string]: any;
}
const EXPEDITION_DATA = RAW_EXPED as ExpedEntry[];

// count/countMax：艦載機槽的目前搭載數／滿載數（僅裝備為飛機的槽有值；滿載數需
// start2 的 api_maxeq，未取得時 countMax 為 undefined、面板只顯示數字不判戰損）。
// mst：裝備 master id。判定特定裝備（如泊地修理的「艦艇修理施設」=86）必須用它——
// icon（api_type[3]）是圖示分類、會與其他裝備共用，拿來當身分判定會誤判。
// type：裝備類別 id（api_type[2]，`api_mst_slotitem_equiptype` 的 id）。cat 是圖示退路用的
// CSS class 字串、icon 是 api_type[3]，兩者都答不了「這顆是不是ソナー／甲標的」，
// 而先制對潛與開幕雷擊的判定正需要類別 id，故獨立一欄。master 未載入時為 0。
export interface GearView { mst: number; name: string; short: string; cat: string; type: number; asw: number; icon: number; level: number; alv: number; count?: number; countMax?: number }
export interface ShipView {
    name: string; stype: string; lv: number; hp: number; maxhp: number; cond: number;
    fuel: number; maxFuel: number; bull: number; maxBull: number;
    // mst／stypeId：艦 master id 與艦種 id。面板原本只有艦種縮寫字串，無法判定
    // 「這艘是不是明石／野埼」，泊地修理與給糧範圍計算需要，故補上原始 id。
    mst: number; stypeId: number;
    // id：艦實例 id（api_id）。艦隊全覽輸出 DeckBuilder 格式（給 KanColleImgBuilder／
    // 制空権シミュレータ）時要拿它去 ownedShips() 反查精確素質（已含裝備加成），
    // 不能用 mst 反查——同型艦會撞號。
    id: number;
    // ndockTime：遊戲直接給的「入渠修好所需毫秒」（api_ndock_time）。泊地修理的
    // 回復量 ≒ 同時長入渠，故用它換算每 1HP 所需時間，**不必猜艦種係數表**。
    // 無損傷時為 0。
    ndockTime: number;
    // 入渠中：泊地修理與野埼給糧都會跳過入渠中的艦。
    inDock: boolean;
    // gears 保留空格為 null（不 filter 掉）：讓面板能畫出空裝備槽位，使不同艦
    // 即使實際裝備數不同，只要槽位數相同就能對齊寬度。
    gears: (GearView | null)[]; exGear: GearView | null;
    // exEmpty：該艦有補強增設能力（打洞格）但目前未裝備。與「exGear === null」
    // 一起看：exGear 有值＝已裝備，exGear 為 null 但 exEmpty＝有格未裝，兩者皆否＝
    // 該艦根本沒有這個格（見 fleets() 的 api_slot_ex 語意註解）。
    exEmpty: boolean;
    // slotCapacity：與 gears 同長度、逐槽對齊。該槽是可搭載飛機的槽（mst.maxeq 有值）
    // 才有數字＝滿載容量；未裝備飛機時（真的空著，或裝了非飛機的裝備）也要顯示這個
    // 容量數字——飛機槽的搭載狀態跟裡面裝什麼是分開的兩件事，跟 GearView.count（只在
    // 裝備本身是飛機時才有、代表即時搭載數）不同層次，故不能塞進 GearView，得獨立一份。
    slotCapacity: (number | undefined)[];
}

// 裝備自身的基礎素質（api_mst_slotitem 的同名欄位，全 741 顆皆有值、非可選欄位）。
// 欄位順序＝「裝備全覽」的欄位順序，改這裡等於改那張表的欄序。
//   houg 火力／houm 命中／leng 射程（0無 1短 2中 3長 4超長）／luck 運／houk 迴避／
//   baku 爆裝／raig 雷裝／saku 索敵／tais 對潛／tyku 對空／souk 裝甲
export interface GearStats {
    houg: number; houm: number; leng: number; luck: number; houk: number; baku: number;
    raig: number; saku: number; tais: number; tyku: number; souk: number;
}

// 鎮守府情報總括的全持有裝備唯讀 view（**一列一顆裝備實例**，非彙總）。
// 彙總（依 master 分組、數量、改修分佈）交給 utils/gear-inventory.ts 的純函式，
// 本層只負責「把 slotItems 的實例接上 master 與持有者」這件需要 GameState 的事。
export interface OwnedGearView {
    /** 裝備實例 id（api_slotitem 的 api_id）。同款裝備的每一顆各自有一個。 */
    id: number;
    mst: number;
    /** 依當前語言解析的裝備名（同 gearName()）。 */
    name: string;
    /** api_type[3]＝圖示 id，對應 public/icons/equipment/<icon>.svg。 */
    icon: number;
    /** api_type[2]＝裝備類別 id。 */
    catId: number;
    /** 類別名（api_mst_slotitem_equiptype）；master 未載入時為空字串。 */
    catName: string;
    sortNo: number;
    /** 消耗品（洋上補給・戦闘糧食・応急修理要員…）。不計入裝備欄上限，故獨立標示。 */
    consumable: boolean;
    /** 改修星數（api_level，0–10）。 */
    level: number;
    /** 艦載機熟練度（api_alv，0–7；非飛機為 0）。 */
    alv: number;
    /** 裝備基礎素質。**未含改修 ★ 加成**（見 masterGears.stats 說明）。 */
    stats: GearStats;
    /** 誰裝著它。null＝閒置（在裝備庫裡沒被任何艦或基地航空隊使用）。 */
    holder: GearHolderView | null;
}

// 持有者。基地航空隊也吃同一批裝備實例，漏掉它會把出擊中的陸攻誤報成「閒置」。
export interface GearHolderView {
    kind: 'ship' | 'lbas';
    /** 艦名或基地航空隊名。 */
    name: string;
    /** 補充說明：艦＝艦種名、基地＝空欄。 */
    sub: string;
    /** 補強增設格（僅 kind='ship'）。 */
    ex: boolean;
}

// 鎮守府情報總括的全持有艦唯讀 view。與 fleets() 不同，這裡以 this.ships 為唯一
// 母集合，因此不會遺漏未編成艦；名稱與裝備仍經既有 shipName()/gearOf() 掛鉤解析。
export interface OwnedShipView {
    id: number;
    masterId: number;
    // 基礎形態的 master id（改造形態沿用本體身分）。查官方登場日一律用它，見 baseShipId()。
    // master 尚未載入（無 start2）時為 null，UI 需可降級。
    baseMst: number | null;
    // 図鑑番号——**取「基礎形態」的 api_sortno**，不是本形態自己的。理由：改造形態自身的
    // sortno 不可靠（真實 start2 實測：睦月=31、睦月改=1354、睦月改二=234，落在不同區間），
    // 拿它排序會讓改造形態跟本體離很遠。用基礎形態的番号，收藏視角才與官方図鑑一致。
    bookNo: number | null;
    name: string;
    stypeId: number;
    stype: string;
    // 艦型（艦級）id＝master 的 api_ctype。先制對潜的例外艦是**整個艦級**適用
    // （Fletcher級 91／John C.Butler級 87），用 ctype 判定比列舉每個改造形態的 id 穩健。
    ctype: number;
    lv: number;
    hp: number;
    maxhp: number;
    cond: number;
    locked: boolean;
    // 航速（api_ship.api_soku，**艦實例上的即時值**，已含裝備加成）。真封包實測 427 艘的
    // 分佈為 {10: 300, 5: 127}＝高速／低速。遊戲另有 15 高速+／20 最速（缶・タービン 組合
    // 達成），但**該樣本未出現**，故值域屬未實測；篩選一律用「>= 門檻」寫法，不列舉數值。
    soku: number;
    // 可裝備的裝備類別 id（見 GameState.equipTypesOf 的驗證說明）。用於「大發系／內火艇／
    // 司令部／水戰」這類篩選——這些的可裝備性是**逐艦**決定的，不能只看艦種。
    equipTypes: number[];
    // 出撃札（api_sally_area）。0＝無札；>0＝已被貼上該 id 的札。欄位已用真封包確認
    // （samples/slot_to_port.json 每艘 api_ship 末三欄 api_locked/api_locked_equip/
    // api_sally_area），但樣本取自非活動期故值全為 0——「id N 對應遊戲裡哪個札」的語意
    // 尚未實測。只透出遊戲給的數字，札名 API 不提供，見 utils/event-plan.ts 檔頭。
    sallyArea: number;
    // 1–4 為所屬艦隊編號；null 表示目前未編成。僅提供編號，避免 view 攜帶未驗證語意。
    fleetNo: number | null;
    // 保留空槽與缺少 slot item 的 null，讓 UI 可安全降級且不猜測缺失裝備。
    gears: (GearView | null)[];
    exGear: GearView | null;
    exEmpty: boolean;

    // ── 以下為「艦娘全覽」詳細清單的欄位／篩選來源 ──────────────────────
    // 累計經驗（api_exp[0]）。
    exp: number;
    // 射程 api_leng：1 短／2 中／3 長／4 超長（真封包實測欄位存在，值域取自遊戲通例）。
    leng: number;
    // 補給狀態（api_fuel/api_bull 對 master 的 api_fuel_max/api_bull_max）。
    fuel: number; fuelMax: number; bull: number; bullMax: number;
    // 顯示素質＝api_karyoku 等的 [0]，**已含裝備加成**；max 為同陣列的 [1]（該項上限）。
    stats: ShipStats;
    statsMax: ShipStats;
    // 裸素質＝顯示值扣掉所有已裝備裝備的自身加成。**估算值**：遊戲的裝備ボーナス
    // （特定艦×特定裝備的隱藏加成）已計入顯示值卻不在裝備 master 裡，相減後會偏高。
    bareStats: ShipStats;
    // 近代化改修累計（api_kyouka）。實測 7 格：[火力,雷装,対空,装甲,運,耐久,対潜]。
    // 前四格對得上 master 的 (max-初期)，故「四項全滿」是精確判定；後三格（運/耐久/対潜）
    // 只有女神・改修材等特殊手段能加，**沒有可比對的上限**，故只判斷「有沒有加過」。
    kyouka: number[];
    // 前四項的上限（master 推得）。master 未載入時為空陣列 → UI 不可判定「已滿」。
    kyoukaMax: number[];
    // 已達改造終點（master api_aftershipid === '0'）。master 未載入時為 null＝不可考。
    remodelDone: boolean | null;
    // 補強增設孔已開（api_slot_ex !== 0；0＝無孔、-1＝有孔未裝、>0＝已裝）。
    exSlotOpen: boolean;
    // 可放進補強增設的「特殊」裝備類別 id（逐艦例外，見 GameState.exSlotSpecialTypes）。
    exSlotSpecials: number[];
}

/** 八項顯示素質。命名用英文以免與 GameState 的 raw 欄位混淆。 */
export interface ShipStats {
    firepower: number; torpedo: number; aa: number; armor: number;
    asw: number; evasion: number; los: number; luck: number;
}

// ── 戰鬥監控 ──
export interface BattleShipView {
    hp: number; maxHp: number;
    beginHp: number;     // 戰鬥開始時的殘 HP（rank 損害率的分母）
    damecon: number;
    sunk: boolean;
    dealtDamage: number;
}
export interface BattleFleetView {
    playerMain: BattleShipView[];
    playerEscort: BattleShipView[];
    enemyMain: BattleShipView[];
    enemyEscort: BattleShipView[];
}
export interface BattleInfoView {
    resultFleets: BattleFleetView | null;
    rank: string;
    mvp: number[];       // [mainMVP, escortMVP]
    isTaiha: boolean;    // 是否有大破進擊危險
    enemyIds: number[];        // 敵主隊 master id（與 enemyMain 同序）
    enemyIdsEscort: number[];  // 敵隨伴 master id（與 enemyEscort 同序；聯合艦隊時）
    formation: number[]; // [player, enemy, engagement]
    seiku: number; // 0=互角, 1=確保, 2=優勢, 3=劣勢, 4=喪失
    touchPlane: number[]; // [player, enemy]
    planes: {
        playerFighter: { count: number, lost: number },
        playerBomber: { count: number, lost: number },
        enemyFighter: { count: number, lost: number },
        enemyBomber: { count: number, lost: number }
    };
    drop: string | null;
    supportFlag: number;
    aaci: number; // 0 if none, else AACI kind ID
    midnightFlag: boolean;
    // 友軍艦隊編成（master id）；活動海域 boss 夜戰才可能出現，其餘一律 null。
    // 已用 samples/61-3.json 驗證 api_friendly_info/api_friendly_battle 同層出現。
    friendlyFleetIds: number[] | null;
    hasResult: boolean;
}
export interface SortieNode {
    id: number;
    color: number; // 4, 5 typically boss, etc.
    // 節點類型（api_req_map/start|next 的 api_event_id／api_event_kind）。**皆為封包事實**，
    // 語意對照見 utils/map-node-kind.ts。舊的出擊紀錄沒有這兩欄 → 一律當不可考。
    eventId?: number;
    eventKind?: number;
}
/** map/start・map/next 的節點欄位（`api_event_id`／`api_event_kind` 缺席就不寫，不補預設值）。 */
export function sortieNodeOf(api: any): SortieNode {
    return {
        id: api?.api_no,
        color: api?.api_color_no,
        ...(Number.isSafeInteger(api?.api_event_id) ? { eventId: api.api_event_id } : {}),
        ...(Number.isSafeInteger(api?.api_event_kind) ? { eventKind: api.api_event_kind } : {}),
    };
}
export interface SortieInfoView {
    mapArea: number;
    mapNo: number;
    nodes: SortieNode[];
}
// 關卡進度。已用真實 api_get_member/mapinfo 封包驗證兩種量表類型：
//   gaugeType 1：擊破數式（一般圖5番艦隊決戦等）— api_defeat_count / api_required_defeat_count
//   gaugeType 2：HP量表式（活動圖／EO 拡張作戦等）— api_eventmap.api_now_maphp / api_max_maphp
//     （maxHp===9999 為「尚未選擇難度」佔位值：api_selected_rank===0 時固定回傳 9999/9999；
//      選定難度(rank>0)後才會換成該難度真正的總HP。已用兩份真實 mapinfo 樣本比對驗證。）
export interface MapGaugeView {
    cleared: boolean;
    gaugeType: number;   // 0=無量表, 1=擊破數式, 2=HP量表式
    defeatCount: number;
    requiredDefeatCount: number;
    nowHp: number;
    maxHp: number;
    // api_eventmap.api_selected_rank。已由 mapinfo 樣本驗證；沒有 eventmap、值無效或尚未
    // 選擇難度時一律為 0，不能從其他 event-map 欄位推測。
    selectedRank: number;
}
// ── 工廠（開發/建造/改修）──────────────────────────────
// createitem 回應結構已用真實封包驗證（samples/kousyou_1.json 單發失敗、
// kousyou_2.json 三發連續（2成功1失敗）＋api_unset_items（裝備庫已滿的同型
// 候補清單，換裝提示用，本專案不涉及庫存管理，略過不處理）：
//   api_create_flag：0/1，至少一項成功即為 1（與各 api_get_items 逐項判定重複，未使用）
//   api_get_items：恆為陣列（單發也是長度1的陣列，無另一種舊格式）
//   api_material：8 項資材「回應後餘額」，皆為純數字（非 {api_value} 物件）
// remodel_slot **已完整驗證**（回應與請求皆有真封包核對，見 samples/remodel_1.json／
// remodel_2.json 系列，含成功／確実化／失敗三種案例，其中最後一組是同一顆裝備先
// 成功（req.api_slot_id=20581 → ★9）、緊接著再次挑戰同一顆卻失敗的真實配對）：
//   req.api_slot_id＝目標裝備實例、req.api_certain_flag＝確実化（'0'/'1'）——欄位名確認正確。
//   成功：api_after_slot={api_id,api_slotitem_id,api_level,...}、api_use_slot_id=消耗的
//     同型裝備實例 id 陣列（可多筆）、api_after_material=8 項純數字餘額。
//   **失敗：api_after_slot 完全不存在（undefined，不是「存在但值不變」）；
//     api_use_slot_id 仍然存在**——飼料無論成敗都會被消耗，這是改修的風險本質。
//     下方 applyEvent 分支本就用 optional chaining／回退鏈處理，兩種案例皆已驗證通過。
//   確実化在回應中無任何可辨識欄位（跟一般成功長得一樣，僅資材消耗量較高），
//   純靠 req.api_certain_flag 判斷，此欄位名現已確認無誤。
//
// createship（建造發起）回應本身不含任何有用資料，但**不需要**靠 req 補——已用
// samples/build_1.json、build_2.json 證實 api_get_member/kdock 的每個渠物件除既有的
// state/created_ship_id/complete_time 外，也帶 api_item1~api_item5（該渠當初投入的
// 燃彈鋼鋁＋開發資材，真實數字非估算）。這比猜 createship 的 req 欄位名可靠得多，
// 也連帶推翻了先前「api_large_flag／api_highspeed 是 createship req 欄位」的猜測——
// build_2.json 的巨額投入（1500/1500/2000/1000，明顯是大型艦）在 kdock 資料上就是
// 普通的 api_item1-4，並無另一個布林欄位標示「這是大型建造」；故 BuildStartView 不再
// 保留 large/highspeed 概念，改直接呈現真實投入量（見 applyEvent 的 api_get_member/kdock
// 分支：比對前後 kdockData 偵測「渠新換了 created_ship_id」＝新送出的建造單，判斷式刻意
// 涵蓋 state 2 與 3 兩種，見下方分支內註解）。build_1.json 後續更新過的內容（dock1＝
// 已用 createship_speedchange 高速完工、state 3、api_complete_time 0、created_ship_id 56）
// 額外證實：**渠的 api_item1-5 只反映最初送出建造時的投入量，不受後續是否高速完工影響**
// ——高速建造材本身消耗的資材仍未驗證（該端點 createship_speedchange 回應本身不帶資料，
// 需要材料前後對照樣本，非本次範圍）。
//
// 名稱不存 view（只存 master id），渲染時經 gearName()/shipName() 取當前語言譯名，
// 語言切換即時生效。
export interface DevelopView {
    results: { mst: number }[];  // 開發結果（1 或 3 筆）；mst=-1 為開發失敗
    secretary: number;           // 秘書艦（第一艦隊旗艦）master id
    used: number[];              // 8 項資材實際消耗（含開發資材）
}
export interface ImproveView {
    gearMst: number;             // 改修後裝備 master id（★max 更新変換時為新裝備）
    levelBefore: number; levelAfter: number;
    success: boolean; certain: boolean;   // certain=確実化（req.api_certain_flag，已用真封包驗證）
    secretary: number;
    used: number[];
}
export interface BuildStartView {
    kdockId: number; shipMst: number; secretary: number;
    used: number[];              // 8 項資材，直接取自 kdock 該渠的 api_item1-5（真封包驗證，非估算）
}
// 高速建造材完工（api_req_kousyou/createship_speedchange）。qty：消耗顆數，依使用者提供
// 的遊戲設定（普通1／大型10，見 LARGE_BUILD_MIN 判定），非封包驗證（該端點回應本身
// 不帶資料，無法用差分校正，屬固定常數）。
export interface SpeedupView {
    kdockId: number; shipMst: number; qty: number; secretary: number;
}
// repairAnchor：泊地修理/給糧計時器的起算時間戳（估算，見 repairAnchorByDeck）。
// null＝出門中、undefined＝從未觀測到重置事件（不可考）——兩者都不該顯示倒數。
export interface FleetView {
    name: string; ships: ShipView[]; mission: boolean;
    repairAnchor: number | null | undefined;
    moraleAnchor: number | null | undefined;
}
export interface MissionView { fleet: string; dispNo: string; name: string; completeAt: number }
export interface NdockView { ship: string; completeAt: number }
// state：-1=未解鎖、0=空塢、2=建造中、3=建造完成待領取（已用真實 api_get_member/kdock 封包驗證）
export interface KdockView { id: number; state: number; ship: string; completeAt: number }
// progress：本機觀測到的「已完成次數/目標次數」，null＝任務內文解不出可累加的目標
// （單次型任務或以「隻」為單位者），UI 應回退顯示受注中／達成。見 quest-progress.ts。
export interface QuestView {
    no: number; name: string; detail: string; done: boolean;
    progress: { count: number; target: number } | null;
}
export interface ExpedCheckRow { label: string; ok: boolean; cur?: string }

// ── 基地航空隊 ──
export interface SquadronView {
    slotId: number;         // 裝備實例 ID
    state: number;          // 1=配備済, 2=未配備
    name: string;           // 裝備名
    short: string;          // 短縮表記（圖示載入失敗時的文字退路）
    cat: string;            // CSS class
    icon: number;           // api_type[3] 原始 id（面板組 /icons/equipment/<id>.png）；未配備＝-1
    mst: number;             // 裝備 master id（api_slotitem 的 mst）；未配備＝0。
                              // DeckBuilder 匯出（艦隊全覽）要用它，icon 只是圖示分類 id 不是唯一裝備識別。
    level: number; alv: number;
    count: number; maxCount: number;
    cond: number;           // 1=通常, 2=橙, 3=赤
}
export interface AirBaseView {
    areaId: number; rid: number;
    name: string;
    actionKind: number;     // 0=待機, 1=出擊, 2=防空, 3=退避, 4=休息
    distance: number;       // 作戰半徑 (base + bonus)
    squadrons: SquadronView[];
    airPower: { min: number; max: number };
}

const GEAR_ICON: Record<number, { s: string; c: string }> = {
    1: { s: '砲', c: 'c-gun' }, 2: { s: '砲', c: 'c-gun' }, 3: { s: '砲', c: 'c-gun' },
    4: { s: '副', c: 'c-sec' }, 5: { s: '雷', c: 'c-torp' }, 6: { s: '戦', c: 'c-ftr' },
    7: { s: '爆', c: 'c-db' }, 8: { s: '攻', c: 'c-tb' }, 9: { s: '偵', c: 'c-rec' },
    10: { s: '水', c: 'c-sea' }, 11: { s: '電', c: 'c-radar' }, 12: { s: '三', c: 'c-sec' },
    13: { s: '徹', c: 'c-etc' }, 14: { s: 'ダ', c: 'c-etc' }, 15: { s: '銃', c: 'c-ftr' },
    16: { s: '高', c: 'c-sec' }, 17: { s: '爆雷', c: 'c-asw' }, 18: { s: 'ソ', c: 'c-asw' },
    19: { s: '機', c: 'c-etc' }, 20: { s: '発', c: 'c-etc' }, 21: { s: '回', c: 'c-sea' },
    22: { s: '哨', c: 'c-asw' }, 24: { s: '探', c: 'c-etc' }, 25: { s: '缶', c: 'c-etc' },
    27: { s: '照', c: 'c-etc' }, 28: { s: '司', c: 'c-etc' }, 30: { s: '射', c: 'c-sec' },
};

const CONSUMABLE_NAMES = new Set([
    '洋上補給', '戦闘糧食', '戦闘糧食(特別なおにぎり)',
    '秋刀魚の缶詰', '応急修理要員', '応急修理女神',
]);

// 艦種 id → 表示名(api_stype)。字典缺該 id 時 t() 回傳 key 本身，回退顯示原始數字。
function stypeName(id: number): string {
    const key = `stype.${id}`;
    const v = t(key);
    return v === key ? String(id) : v;
}

// 艦載機的裝備類別（api_type[2]）：6艦戰 7艦爆 8艦攻 9艦偵 10水偵 11水爆
// 25回轉翼機 26對潛哨戒機 41大型飛行艇 45水戰 56-59噴式機。用於判斷「這個槽
// 顯示搭載機數」；比制空計算用的子集（僅戰/爆/攻）寬，因為搭載數對偵察機等
// 也有意義。陸攻系（47-49）不會裝在艦上，不列。
const AIRCRAFT_CATS = new Set([6, 7, 8, 9, 10, 11, 25, 26, 41, 45, 56, 57, 58, 59]);

// 艦種 id → 英文縮寫（艦名前綴用）
const STYPE_ABBR: Record<number, string> = {
    1: 'DE', 2: 'DD', 3: 'CL', 4: 'CLT', 5: 'CA', 6: 'CAV',
    7: 'CVL', 8: 'BB', 9: 'BB', 10: 'BBV', 11: 'CV', 12: 'BB',
    13: 'SS', 14: 'SSV', 16: 'AV', 17: 'LHA', 18: 'CVB',
    19: 'AR', 20: 'AS', 21: 'CT', 22: 'AO',
};

const DRUM_MST_ID = 75;   // ドラム缶(輸送用)

// 大型艦建造的最低資源門檻 [燃,彈,鋼,鋁]＝1500/1500/2000/1000（開發資材則 1/20/100
// 三選一皆可、不影響是否算大型）。用來判定 createship_speedchange 該扣 1 還是 10 個
// 高速建造材——來源：使用者提供之遊戲設定（非封包驗證，該端點回應本身不帶資料）。
const LARGE_BUILD_MIN = [1500, 1500, 2000, 1000];

// ── 大成功率モデル（日wiki「遠征」大成功節、2020検証値。社群推定・非公式）──
// 遠征により大成功の判定式が異なる。3 種類に分岐（詳細は expedCheck の分岐コメント）。
//
// キー化は dispNo（遊戲実際に表示される遠征番号文字列、例:"37""A2""E2"）で行う。
// api_id（内部管理番号）はイベント系だとゲーム側の割当次第で不定だが、dispNo は wiki の表記と
// 直接一致するため、これなら実測不要でイベント遠征も収録できる。masterMissions は
// api_start2/getData で実戰時にサーバーから貰う値をそのまま使うので、ここでの見た目上の
// 「37」等はただの識別ラベルであり、遊戲内表示と一致する前提。
//
// Model B（ドラム缶型）：理論大成功率 = 5 + 15×キラ + 35×clamp((桶数-n1)/(n2-n1),0,1)（切捨）。
//   n1=成功に必要な桶数（poi成功条件由来。24/40/44 は wiki 明記の 0）、n2=大成功に必要な桶数（wiki表）、
//   ships=桶を積む必要艦数。満載(n2)＋キラ4 で理論 100%超＝確定大成功。桶を n2 超で積んでも上昇せず。
//   桶搭載艦が ships 未満なら満載ボーナス無し（キラ分のみ）。
const GS_DRUM: Record<string, { ships: number; n1: number; n2: number }> = {
    '21': { ships: 3, n1: 3, n2: 4 },    // 北方鼠輸送作戦（n1 は搭載艦3隻ぶんで概算）
    '24': { ships: 1, n1: 0, n2: 2 },    // 北方航路海上護衛（wiki 明記 n1=0）
    '37': { ships: 3, n1: 4, n2: 5 },    // 東京急行
    '38': { ships: 4, n1: 8, n2: 10 },   // 東京急行(弐)
    '40': { ships: 1, n1: 0, n2: 4 },    // 水上機前線輸送（wiki 明記 n1=0）
    '44': { ships: 3, n1: 0, n2: 8 },    // 航空装備輸送任務（wiki: 隻数3・個数8、桶数は「待検証」注記あり）
    'E2': { ships: 3, n1: 3, n2: 6 },    // 強行鼠輸送作戦（n1 は搭載艦3隻ぶんで概算）
};
// Model C（旗艦Lv式）：大成功率 = 16 + 15×キラ + (√旗艦Lv + 旗艦Lv/10)。キラ0でも大成功しうる遠征。
//   wiki 適用/適用可能性リスト全件を dispNo で収録（2020/09時点「検証中」注記あり、変動の可能性）。
const GS_FORMULA = new Set([
    '32', '41', '43', '45', '46',                 // 南西海域/西方海域(数字表記分)
    'A2', 'A3', 'A4', 'A5', 'A6',                  // 鎮守府海域
    'B3', 'B4', 'B5', 'B6',                        // 南西諸島海域
    'D1', 'D2', 'D3',                              // 西方海域
    'E1',                                          // 南方海域
]);
// 上記以外は Model A（通常キラキラ式）：出発時「在籍全艦」がキラキラなら大成功可、1隻でも非キラで大成功せず。
//   全艦キラ時の目安：6隻→100%・5隻→95%・4隻以下→80%（wiki 実測目安）。

// 已確認存在「強うずしお」（大量喪失，基本割合150%）的海域（area-no）。來源：日wiki「資材」頁。
// 座標到節點字母的對應未驗證（getEdgeLetter 是 ASCII 推算），故整張圖的 map/next 都先標起來，
// 事後靠使用者回報「哪一戰扣了資源」來對照。
const UZUSHIO_MAPS = new Set(['1-3', '2-5', '3-3', '3-4', '5-2', '5-4', '5-5', '6-2']);

export class GameState {
    nickname = '';
    hqLv = 1;
    master = new Map<number, {
        name: string; stype: number; fuelMax: number; bullMax: number;
        slotNum?: number; maxeq?: number[]; sortno?: number;
        // 以下四項為「艦娘全覽」的篩選所需，見 api_start2/getData 分支的逐欄說明。
        ctype: number; afterLv: number; afterShipId: number; kyoukaMax: number[];
    }>();
    // 改造形態 → 基礎形態的反解來源（皆由 api_start2/getData 建立，見 baseShipId()）：
    //   upgradeOriginal：api_mst_shipupgrade 的 api_id → api_original_ship_id，**主要解法**
    //   remodelPrev    ：api_aftershipid 的反向圖（改造後 → **所有**前身），備援
    // 只用 aftershipid 覆蓋率僅 94%——部分改二（例 鈴谷改二 503）不在鏈上，唯有 shipupgrade
    // 查得到（→ api_original_ship_id 124 ＝鈴谷）。兩段合用達 100%。
    // **前身必須存成陣列**：可逆轉換改裝（同名不同艦種、可來回改裝）會讓兩個形態互指成環，
    // 例 Glorious改 戦艦(740) ⇄ Glorious改 正規空母(741)。只留單一前身時會困在環裡繞不出去；
    // 存全部前身才能繞經 741 的另一個前身 1027 一路回到真正的基礎形態 1022。
    upgradeOriginal = new Map<number, number>();
    remodelPrev = new Map<number, number[]>();
    // 可裝備類別（裝備篩選用）。兩張表的關係已用真實完整 start2 驗證（見 equipTypesOf）：
    //   stypeEquip       ：api_mst_stype[].api_equip_type 中值為 1 的類別 id（艦種層級預設）
    //   shipEquipOverride：api_mst_equip_ship（逐艦例外，**完整覆蓋** stype 預設而非疊加）
    stypeEquip = new Map<number, Set<number>>();
    shipEquipOverride = new Map<number, Set<number>>();
    masterGears = new Map<number, {
        name: string; icon: number; cat: number; aa: number; los: number; distance: number;
        // sortNo：api_sortno＝遊戲自己的裝備圖鑑排序。「裝備全覽」的預設瀏覽順序用它，
        // 才會與遊戲內的裝備一覧同序（拿 master id 排會把改修版本散到各處）。
        sortNo: number;
        // 裝備自身的素質加成（api_mst_slotitem 的同名欄位）。用途有二：
        //   1. 「艦娘全覽」把 api_ship 的顯示值（**含裝備**）減回裸值。**這是估算**：
        //      遊戲的裝備ボーナス（特定艦×特定裝備的隱藏加成，例 大和型＋51cm）已算進
        //      顯示值卻不在這裡，相減後會偏高，故 UI 標示為估算值。見 ownedShips() 的 bare。
        //   2. 「裝備全覽」直接顯示這顆裝備的基礎素質（未含改修 ★ 加成——加成公式依
        //      裝備類別與戰鬥情境而異，本專案不自行推導，見 ownedGears() 說明）。
        stats: GearStats;
    }>();
    /** 裝備類別 id（api_type[2]）→ 名稱，來自 api_mst_slotitem_equiptype。 */
    masterEquipTypes = new Map<number, string>();
    /**
     * 補強增設（api_slot_ex）可裝什麼，來自 start2 的三張表（皆已用真實 start2 核對）：
     *   exSlotTypes     ：api_mst_equip_exslot＝**全艦通用**可放進增設的裝備類別 id
     *                     （實測 [16,21,23,27,28,36,39,43,44]＝追加装甲/機銃/応急/中大装甲/
     *                     高射装置/水上艦要員/戦闘糧食/補給物資）
     *   exSlotItemShips ：api_mst_equip_exslot_ship＝**逐裝備例外**。key 是
     *                     **slotitem master id 而非類別 id**（已實證：key 413＝
     *                     「精鋭水雷戦隊 司令部」、key 45＝「三式爆雷投射機」），
     *                     值以 ship_ids／stypes／ctypes 三種方式指定哪些艦可放進增設。
     *   exSlotLimit     ：api_mst_equip_limit_exslot＝逐艦的增設**排除**類別（實測值全為
     *                     [27] 追加装甲(中型)）。語意未經真封包行為驗證，目前只存不用。
     */
    exSlotTypes = new Set<number>();
    exSlotItemShips = new Map<number, { shipIds: Set<number>; stypes: Set<number>; ctypes: Set<number>; reqLevel: number }>();
    exSlotLimit = new Map<number, Set<number>>();
    masterMapAreas = new Map<number, string>();
    masterMissions = new Map<number, { dispNo: string; name: string; maparea: number; time: number; deckNum: number }>();
    ships = new Map<number, any>();
    slotItems = new Map<number, { mst: number; level: number; alv: number }>();
    decks: any[] = [];
    ndockData: any[] = [];
    kdockData: any[] = [];
    kdockCap = 0;   // 已解鎖建造渠數（api_port/port 的 api_count_kdock，非即時狀態）
    materials: number[] = [];
    maxChara = 0; maxSlotitem = 0;
    quests = new Map<number, { name: string; detail: string; done: boolean }>();
    // 任務本機進度追蹤：key＝api_no，只有 resolveQuestGoal() 解得出目標的任務才有條目。
    // count 從「本機首次觀測到該任務」起算（baseline 誠實原則，見 quest-progress.ts）。
    // area/bossOnly/minRank/missionIds 為選填過濾條件，沿用 QuestGoal 的欄位（見該檔說明）。
    questProgress = new Map<number, QuestGoal & { count: number }>();
    consumableGearIds = new Set<number>();
    airBases = new Map<string, any>();   // key: `${area_id}_${rid}`
    lastDayBattle: any = null;
    battleInfo: BattleInfoView | null = null;
    sortieInfo: SortieInfoView | null = null;
    currentSortieFleetId: number = 0;
    // 聯合艦隊旗標（api_port/port 的 api_combined_flag）：0=單艦隊, 1=機動, 2=水上, 3=輸送。
    // 出擊重播快照（replayFleetSnapshot）需要它來決定要不要一併帶第二艦隊（隨伴）。
    combinedFlag = 0;
    mapGauges = new Map<number, MapGaugeView>();   // key: api_id = mapArea*10+mapNo
    // 海域 master（`api_mst_mapinfo`）。key＝api_id＝mapArea*10+mapNo。已用真實完整 start2
    // 驗證：一般圖如 11＝「鎮守府正面海域／近海警備」，活動圖如 621＝「九州沖/南西諸島沖／
    // 第三十一戦隊駆逐艦の出撃」。**活動期間 start2 就會帶當次活動的全部海域**，比 runtime
    // 的 api_get_member/mapinfo 更早可用（後者要玩家開過海域畫面才有）。
    masterMapInfo = new Map<number, { area: number; no: number; name: string; opetext: string }>();
    mapBossHp = new Map<number, number>();          // key 同上：boss旗艦最大HP（實戰擷取，估剩餘次數用）
    private mapinfoSampleCount = 0;   // EO api_sally_flag 樣本擷取次數上限（見 wantedTag）
    private sallySampleCount = 0;     // 出撃札（api_sally_area>0）樣本擷取次數上限（見 wantedTag）
    private sallyKeySampleCount = 0;  // 未知 sally 系欄位樣本擷取次數上限（札名驗證鉤子）
    // 工廠分頁的「最新結果」看板（開發/改修/建造發起）。EventProjector 在對應事件到達時
    // 讀取這些 view 歸檔進 db.factory（消化後摘要，同 sorties 設計）。
    lastDevelop: DevelopView | null = null;
    lastImprove: ImproveView | null = null;
    // 通常一次 kdock 事件只會有一筆新建造（見下方分支），但無法排除「extension 全新
    // 安裝時、requireInfo 基準尚未建立前就先收到一筆已有多渠同時在建的 kdock」這種邊界
    // 情況（此時 prevById 為空，多個渠可能同時判定為新建造）——故用陣列而非單一值，
    // 確保 EventProjector 不會漏記除了最後一筆以外的建造。
    newBuilds: BuildStartView[] = [];
    lastSpeedup: SpeedupView | null = null;
    // 各艦隊「上次執行的遠征」master mission id（key: deckIdx）。遠征回港後 api_mission 會歸零，
    // 故在發遠征/母港時捕捉，供遠征分頁切到該艦隊時預設帶出上次的遠征。
    // EventProjector 的遠征紀錄擷取也要讀，故公開（唯讀用途）。
    lastMissionByDeck = new Map<number, number>();
    // 本節點各戰待套用的燃彈消耗費率。出擊途中先不寫回（面板維持戰前油彈，與遊戲戰鬥畫面一致），
    // 直到 battleresult 結算畫面才一併套用（見 battle 分支說明）。
    private pendingConsumption: { fuelRate: number; bullRate: number; nightAmmoBoost: boolean; hasEscort: boolean }[] = [];

    // ── 泊地修理／給糧的計時器錨點（key: deckIdx，值為該艦隊「最後一次重置計時」的時間戳）──
    // 遊戲**不送任何泊地修理封包**，20 分／15 分是伺服器內部從「編成完了」起算的計時，
    // 只能靠觀察會重置它的封包來推算，故一律視為估算值（UI 需標示）。
    // 重置（依使用者提供之遊戲行為）：[變更]改動該隊成員、該隊出擊/遠征後回港。
    // **不重置**：陣容保存/讀取（preset_select）、隨伴艦一括解除（change 的 api_ship_id=-2）、
    // 僅更換裝備、其他艦隊的任何操作——這幾條是刻意的例外，別「順手」補進重置清單。
    // null＝該隊出門中（出擊/遠征），回港時才重新錨定。
    // **兩個機制的週期不同（修理20分／給糧15分）故各存一份錨點**：共用一份無法表達
    // 「經過15分時給糧已結算、修理還沒」這個中間狀態，結算後重新起算也會互相打架。
    repairAnchorByDeck = new Map<number, number | null>();
    moraleAnchorByDeck = new Map<number, number | null>();

    private resetRepairAnchor(deckIdx: number, ts: number) {
        if (deckIdx < 0) return;
        this.repairAnchorByDeck.set(deckIdx, ts);
        this.moraleAnchorByDeck.set(deckIdx, ts);
    }

    private markFleetAway(deckIdx: number) {
        if (deckIdx < 0) return;
        this.repairAnchorByDeck.set(deckIdx, null);
        this.moraleAnchorByDeck.set(deckIdx, null);
    }

    // 這則戰鬥封包是否真的帶隨伴（第2）艦隊——只有連合艦隊出擊才會有 *_combined 血量欄位。
    // **不能只看 currentSortieFleetId === 0**：第1艦隊「單獨」出擊時它同樣是 0，
    // 若據此就把第2艦隊當隨伴，會讓沒出門的第2艦隊被寫回血量／扣燃彈
    // （實際發生過：第1艦隊出擊，面板顯示第2艦隊莫名被扣燃彈並跳出未補給提醒）。
    private static hasEscortFleet(api: any) {
        return Array.isArray(api?.api_f_nowhps_combined) && api.api_f_nowhps_combined.length > 0;
    }

    // ts：該封包的擷取時間戳。replay 時必須帶入原始 event.ts，否則泊地修理計時器會被
    // 重播當下的時間污染；live 事件未帶時退回 Date.now()。
    applyEvent(path: string, api: any, req?: Record<string, string>, ts: number = Date.now()) {
        if (path === 'api_start2/getData') {
            this.remodelPrev.clear();
            for (const s of api.api_mst_ship) {
                this.master.set(s.api_id, {
                    name: s.api_name, stype: s.api_stype ?? 0,
                    fuelMax: s.api_fuel_max ?? 0, bullMax: s.api_bull_max ?? 0,
                    // api_ctype＝艦型（艦級）id。補強增設的逐艦例外表 api_mst_equip_exslot_ship
                    // 以 ship_ids／stypes／**ctypes** 三種方式指定對象，缺這欄就查不了 ctype 條件。
                    ctype: s.api_ctype ?? 0,
                    // 改造鏈：api_afterlv＝下一段改造所需等級，api_aftershipid（**字串**）＝
                    // 改造後 master id，'0' 表示已是最終形態。「完成改造」篩選只認後者。
                    afterLv: s.api_afterlv ?? 0,
                    afterShipId: Number(s.api_aftershipid ?? 0) || 0,
                    // 近代化改修上限：master 的 api_houg/raig/tyku/souk 是 [初期値, 最大値]，
                    // 兩者差＝該項可改修的總量，恰好對得上 api_ship.api_kyouka 的累計值。
                    // **已用真封包核對**（叢雲改二 420：houg[14,57] 差 43＝kyouka[0]、
                    // raig[32,89] 差 57＝kyouka[1]、tyku[27,74] 差 47＝kyouka[2]、
                    // souk[14,51] 差 37＝kyouka[3]，四項全中），故「改修已滿」是精確判定。
                    kyoukaMax: [
                        (s.api_houg?.[1] ?? 0) - (s.api_houg?.[0] ?? 0),
                        (s.api_raig?.[1] ?? 0) - (s.api_raig?.[0] ?? 0),
                        (s.api_tyku?.[1] ?? 0) - (s.api_tyku?.[0] ?? 0),
                        (s.api_souk?.[1] ?? 0) - (s.api_souk?.[0] ?? 0),
                    ],
                    // api_slot_num：該艦真實裝備槽數。api_ship.api_slot 陣列本身可能帶超出
                    // 真實槽數的 -1 padding（例如 3 槽驅逐艦仍收到長度較長的陣列），需靠這個
                    // 欄位截斷，否則會把 padding 誤畫成「未裝備的空槽」。
                    // 已用真實 start2 核對（samples/start2-master.json：必填 number）。
                    slotNum: s.api_slot_num,
                    // api_maxeq：各槽滿載機數（判定艦載機戰損用）。真實 start2 核對為 number[]
                    // （例 睦月 [0,0,0,0,0]）；undefined 時面板僅顯示搭載數、不做戰損變色。
                    maxeq: s.api_maxeq,
                    // api_sortno＝図鑑番号。已與獨立來源的公開図鑑資料交叉驗證（sortno 1~10
                    // ＝長門/陸奥/伊勢/日向/雪風/赤城/加賀/蒼龍/飛龍/島風，與 samples/
                    // ship-debut-dates.json 的排列完全一致）。0/缺 = 不在図鑑（深海棲艦等）。
                    sortno: s.api_sortno,
                });
                // api_aftershipid 是**字串**（真封包實證，例 睦月 '254'），'0' 代表無後續改造。
                // 當 number 比對會靜默失效，務必先 Number() 解析。
                const after = Number(s.api_aftershipid ?? 0);
                if (Number.isSafeInteger(after) && after > 0) {
                    const preds = this.remodelPrev.get(after);
                    if (preds) preds.push(s.api_id); else this.remodelPrev.set(after, [s.api_id]);
                }
            }
            // 改造 → 基礎形態的直接對應（主要解法，見 upgradeOriginal 宣告處說明）
            this.upgradeOriginal.clear();
            for (const u of api.api_mst_shipupgrade ?? []) {
                const id = u?.api_id, base = u?.api_original_ship_id;
                if (Number.isSafeInteger(id) && Number.isSafeInteger(base) && id > 0 && base > 0
                    && !this.upgradeOriginal.has(id)) this.upgradeOriginal.set(id, base);
            }
            for (const g of api.api_mst_slotitem ?? []) {
                this.masterGears.set(g.api_id, {
                    name: g.api_name, icon: g.api_type?.[3] ?? 0,
                    cat: g.api_type?.[2] ?? 0, aa: g.api_tyku ?? 0, los: g.api_saku ?? 0,
                    distance: g.api_distance ?? 0, sortNo: g.api_sortno ?? 0,
                    stats: {
                        houg: g.api_houg ?? 0, houm: g.api_houm ?? 0, leng: g.api_leng ?? 0,
                        luck: g.api_luck ?? 0, houk: g.api_houk ?? 0, baku: g.api_baku ?? 0,
                        raig: g.api_raig ?? 0, saku: g.api_saku ?? 0, tais: g.api_tais ?? 0,
                        tyku: g.api_tyku ?? 0, souk: g.api_souk ?? 0,
                    },
                });
                if (CONSUMABLE_NAMES.has(g.api_name)) this.consumableGearIds.add(g.api_id);
            }
            // 補強增設三張表（見宣告處的欄位說明）。任一缺席就維持空集合，呼叫端需可降級。
            this.exSlotTypes = new Set(
                (Array.isArray(api.api_mst_equip_exslot) ? api.api_mst_equip_exslot : []).map(Number));
            this.exSlotItemShips.clear();
            const exShip = api.api_mst_equip_exslot_ship;
            if (exShip && typeof exShip === 'object') {
                for (const [itemId, entry] of Object.entries<any>(exShip)) {
                    this.exSlotItemShips.set(Number(itemId), {
                        // 三個欄位皆可能是 null（＝不以這種方式指定）；只收值為 1 的 key。
                        shipIds: new Set(Object.keys(entry?.api_ship_ids ?? {}).map(Number)),
                        stypes: new Set(Object.keys(entry?.api_stypes ?? {}).map(Number)),
                        ctypes: new Set(Object.keys(entry?.api_ctypes ?? {}).map(Number)),
                        reqLevel: entry?.api_req_level ?? 0,
                    });
                }
            }
            this.exSlotLimit.clear();
            const exLimit = api.api_mst_equip_limit_exslot;
            if (exLimit && typeof exLimit === 'object') {
                for (const [mstId, types] of Object.entries<any>(exLimit)) {
                    if (Array.isArray(types)) this.exSlotLimit.set(Number(mstId), new Set(types.map(Number)));
                }
            }
            for (const m of api.api_mst_maparea ?? []) {
                this.masterMapAreas.set(m.api_id, m.api_name);
            }
            // 活動結束後該活動的海域會從 master 消失，故每次 start2 全量重建（不 merge）。
            this.masterMapInfo.clear();
            for (const m of api.api_mst_mapinfo ?? []) {
                if (!m?.api_id) continue;
                this.masterMapInfo.set(m.api_id, {
                    area: m.api_maparea_id ?? 0, no: m.api_no ?? 0,
                    name: m.api_name ?? '', opetext: m.api_opetext ?? '',
                });
            }
            // 裝備類別名（「裝備全覽」的種類標示與圖示篩選架的標籤用）。
            this.masterEquipTypes.clear();
            for (const e of api.api_mst_slotitem_equiptype ?? []) {
                if (e?.api_id != null) this.masterEquipTypes.set(Number(e.api_id), String(e.api_name ?? ''));
            }
            // 可裝備類別。api_equip_type 是 { 類別id: 0|1 } 的物件（key 為字串），取值 1 者。
            this.stypeEquip.clear();
            for (const s of api.api_mst_stype ?? []) {
                const et = s?.api_equip_type;
                if (!et || typeof et !== 'object') continue;
                this.stypeEquip.set(s.api_id, new Set(
                    Object.entries(et).filter(([, v]) => v === 1).map(([k]) => Number(k))));
            }
            // 逐艦例外。key 為艦 master id（字串），值 { api_equip_type: { 類別id: null|number[] } }。
            // **這裡刻意忽略 null / [ids] 的差別**：null＝該類別全可裝、[ids]＝僅限特定裝備。
            // 目前唯一的消費者是「這艘艦能不能裝這個類別」的篩選，兩者答案都是「能」；
            // 真封包實測 type 24（上陸用舟艇）全部是 null，尚無需要區分的實例。
            this.shipEquipOverride.clear();
            const equipShip = api.api_mst_equip_ship;
            if (equipShip && typeof equipShip === 'object') {
                for (const [mstId, entry] of Object.entries<any>(equipShip)) {
                    const et = entry?.api_equip_type;
                    if (!et || typeof et !== 'object') continue;
                    this.shipEquipOverride.set(Number(mstId), new Set(Object.keys(et).map(Number)));
                }
            }
            for (const m of api.api_mst_mission ?? [])
                this.masterMissions.set(m.api_id, {
                    dispNo: m.api_disp_no, name: m.api_name,
                    maparea: m.api_maparea_id ?? 0, time: m.api_time ?? 0,
                    deckNum: m.api_deck_num ?? 0,
                });
        } else if (path === 'api_get_member/require_info' || path === 'api_get_member/slot_item') {
            const list = api.api_slot_item ?? api;
            if (Array.isArray(list) && list.every((it: any) => 'api_slotitem_id' in it)) {
                this.slotItems.clear();
                for (const it of list)
                    this.slotItems.set(it.api_id, { mst: it.api_slotitem_id, level: it.api_level ?? 0, alv: it.api_alv ?? 0 });
            }
            // 登入必送的 require_info 也帶 api_kdock（KC3/poi 一登入就能顯示建造渠的資料源）。
            // 防禦性讀取：欄位存在才覆蓋，避免 slot_item 端點（無此欄位）誤清空。
            if (Array.isArray(api.api_kdock)) this.kdockData = api.api_kdock;
        } else if (path === 'api_get_member/kdock') {
            // 建造渠狀態：api_port/port 只帶解鎖數（api_count_kdock），不含每個渠的即時狀態。
            // 這個端點是「動作觸發」而非「進畫面觸發」——已實測：單純進工廠/點建造分頁不會送，
            // 只有實際送出建造（api_req_kousyou/createship）或領取完成船艦（.../getship）
            // 才會順便拉一次。登入時的初始狀態則來自 require_info 的 api_kdock（見上分支）。
            // state 已用真實封包驗證：-1=未解鎖/2=建造中/3=完成待領取。
            //
            // 新建造單偵測（已用 samples/build_1.json、build_2.json 驗證）：每個渠物件帶
            // api_item1~api_item5（真實投入的燃彈鋼鋁＋開發資材，見 BuildStartView 註解）。
            // 拿新舊快照比對，「created_ship_id 換成沒見過的值」即為一筆新送出的建造——
            // 比猜 createship 的 req 可靠。判斷式刻意不要求 api_state===2：用高速建造材
            // （createship_speedchange，不觸發 kdock 重拉）完工的渠，若 SW 剛好在它還是
            // state 2 時重啟、沒能親眼看到那個瞬間，下次看到時已經是 state 3——只認
            // created_ship_id 是否為「這個渠上沒見過的新值」，兩種 state 都算，才不會漏記
            // （已用 build_1.json 的 dock1＝已高速完工/state 3/ship 56 驗證此案例，
            // 且不會對「同一艘船從 state 2 進展到 3」的正常流程重複觸發，因為 created_ship_id
            // 沒變）。newBuilds 每次先清空再視偵測結果推入，避免 getship 觸發的 kdock 刷新
            // （無新建造）誤用上一筆殘留值（EventProjector 依 newBuilds 是否非空
            // 判斷要不要歸檔；用陣列而非單一值，見 newBuilds 欄位註解的邊界情況）。
            this.newBuilds = [];
            const prevById = new Map(this.kdockData.map((k: any) => [k.api_id, k]));
            for (const d of api as any[]) {
                const prev = prevById.get(d.api_id);
                const isNewBuild = (d.api_state === 2 || d.api_state === 3) && d.api_created_ship_id > 0
                    && (!prev || prev.api_created_ship_id !== d.api_created_ship_id);
                if (!isNewBuild) continue;
                const used = [d.api_item1, d.api_item2, d.api_item3, d.api_item4, 0, 0, d.api_item5, 0]
                    .map((v: any) => Number(v) || 0);
                used.forEach((v, i) => {
                    if (v > 0 && typeof this.materials[i] === 'number')
                        this.materials[i] = Math.max(0, this.materials[i] - v);
                });
                this.newBuilds.push({ kdockId: d.api_id, shipMst: d.api_created_ship_id, secretary: this.secretaryMst(), used });
                this.bumpQuestProgress('build');
            }
            this.kdockData = api;
        } else if (path === 'api_req_kousyou/getship') {
            // 建造完成領取：回應本身就帶更新後的 api_kdock（該渠回到 state 0）＋新船 api_ship＋
            // 隨船裝備 api_slotitem，面板可立即反映，不用等下次 api_port/port 才刷新。已用真實封包驗證。
            if (Array.isArray(api.api_kdock)) this.kdockData = api.api_kdock;
            if (api.api_ship) this.ships.set(api.api_ship.api_id, api.api_ship);
            for (const it of api.api_slotitem ?? [])
                this.slotItems.set(it.api_id, { mst: it.api_slotitem_id, level: it.api_level ?? 0, alv: it.api_alv ?? 0 });
        } else if (path === 'api_req_kousyou/createship_speedchange' && req) {
            // 高速建造材：response 不帶任何資料，只能靠 req.api_kdock_id（已用真實封包驗證）
            // 找到對應渠，直接標記為完成待領取（state 3, complete_time 0）。領取仍走 getship 分支。
            // 消耗顆數：普通1／大型10（LARGE_BUILD_MIN 判定，使用者提供之遊戲設定，見常數註解），
            // 用該渠自己的 api_item1-4（送出建造當下的真實投入量，此刻尚未被清空）判斷。
            const dock = this.kdockData.find((k: any) => k.api_id === Number(req.api_kdock_id));
            if (dock) {
                const large = LARGE_BUILD_MIN.every((min, i) => (Number(dock[`api_item${i + 1}`]) || 0) >= min);
                const qty = large ? 10 : 1;
                this.materials[4] = Math.max(0, (this.materials[4] ?? 0) - qty);
                this.lastSpeedup = { kdockId: dock.api_id, shipMst: dock.api_created_ship_id, qty, secretary: this.secretaryMst() };
                dock.api_state = 3;
                dock.api_complete_time = 0;
            }
        } else if (path === 'api_req_kousyou/createitem') {
            // 裝備開發。已用真實封包驗證（samples/kousyou_1.json 單發失敗、
            // kousyou_2.json 三發連續）：api_get_items 恆為陣列（每項
            // {api_id, api_slotitem_id}，失敗時 api_id=-1/api_slotitem_id=-1）、
            // api_material 為 8 項純數字餘額（見 DevelopView 註解）。
            const items: any[] = Array.isArray(api?.api_get_items) ? api.api_get_items : [];
            const results: { mst: number }[] = [];
            for (const it of items) {
                const mst = Number(it?.api_slotitem_id ?? -1);
                if (it?.api_id > 0 && mst > 0)
                    this.slotItems.set(it.api_id, { mst, level: 0, alv: 0 });
                results.push({ mst: mst > 0 ? mst : -1 });
            }
            const used = this.updateMaterials(api?.api_material);
            // 開發資材每次嘗試固定消耗 1 顆（日wiki明載的固定常數，非估算）；資材尚未
            // 播種（未回過母港，updateMaterials 差分讀不到）時才用此值補上。
            if (!used[6]) used[6] = results.length;
            this.lastDevelop = { results, secretary: this.secretaryMst(), used };
            // 開發任務常註明「失敗もOK」，故不論成敗、每次呼叫都算一次「開發」。
            this.bumpQuestProgress('development');
        } else if (path === 'api_req_kousyou/remodel_slot' && req) {
            // 改修（明石の改修工廠）。已用真實封包驗證（見 state.ts 開頭註解，含成功／
            // 確実化／失敗三案例）：req.api_slot_id=對象裝備實例、req.api_certain_flag=
            // 確実化；回應失敗時 api_after_slot 整個不存在（undefined），api_use_slot_id
            // 仍會出現（飼料無論成敗都被消耗）——以下 optional chaining／回退鏈天然覆蓋兩案例。
            const before = this.slotItems.get(Number(req.api_slot_id ?? 0));
            const levelBefore = before?.level ?? 0;
            const after = api?.api_after_slot;
            if (after?.api_id > 0)
                this.slotItems.set(after.api_id, { mst: after.api_slotitem_id, level: after.api_level ?? 0, alv: after.api_alv ?? 0 });
            for (const cid of api?.api_use_slot_id ?? [])
                if (cid > 0) this.slotItems.delete(cid);
            const used = this.updateMaterials(api?.api_after_material);
            const remodelSuccess = Number(api?.api_remodel_flag ?? 0) === 1;
            this.lastImprove = {
                gearMst: after?.api_slotitem_id ?? before?.mst ?? 0,
                levelBefore,
                levelAfter: after?.api_level ?? levelBefore,
                success: remodelSuccess,
                certain: req.api_certain_flag === '1',
                secretary: this.secretaryMst(),
                used,
            };
            // remodelAttempt 不論成敗都算（任務619「装備の改修強化」明講「失敗もOK」）；
            // remodel 僅成功才算（其餘改修類任務，見 quest-progress.ts QUEST_ID_OVERRIDES）。
            this.bumpQuestProgress('remodelAttempt');
            if (remodelSuccess) this.bumpQuestProgress('remodel');
        } else if (path === 'api_get_member/questlist') {
            for (const q of api.api_list ?? []) {
                if (q && q.api_no > 0 && (q.api_state === 2 || q.api_state === 3)) {
                    this.quests.set(q.api_no, { name: q.api_title, detail: q.api_detail ?? '', done: q.api_state === 3 });
                    // 進度只在「本機第一次看到這個任務編號」時初始化——重複的 questlist
                    // 封包（分頁刷新）不得把已累積的計數洗回 0。
                    if (!this.questProgress.has(q.api_no)) {
                        const goal = resolveQuestGoal(q.api_no, q.api_title ?? '', q.api_detail ?? '');
                        if (goal) this.questProgress.set(q.api_no, { ...goal, count: 0 });
                    }
                } else if (q && q.api_no > 0) {
                    this.quests.delete(q.api_no);
                    this.questProgress.delete(q.api_no);
                }
            }
        } else if ((path === 'api_req_quest/clearitemget' || path === 'api_req_quest/stop') && req) {
            // 達成後領取獎勵（clearitemget）或放棄任務（stop）：該任務即從清單消失。
            // questlist 分頁只會刷新目前頁面，無法自動移除已完成的任務，故在此明確刪除。
            this.quests.delete(Number(req.api_quest_id));
            this.questProgress.delete(Number(req.api_quest_id));
        } else if (path === 'api_port/port') {
            this.ships.clear();
            for (const s of api.api_ship) this.ships.set(s.api_id, s);
            this.decks = api.api_deck_port;
            // 遠征中的艦隊：記錄其 mission id 為該艦隊「上次遠征」（回港後 api_mission 歸零，故在此捕捉）
            this.decks.forEach((d: any, i: number) => {
                const mid = d.api_mission?.[1] ?? 0;
                if (mid > 0) this.lastMissionByDeck.set(i, mid);
            });
            this.pendingConsumption = [];
            this.ndockData = api.api_ndock;
            this.kdockCap = api.api_count_kdock ?? this.kdockCap;
            this.materials = (api.api_material ?? []).map((m: any) => m.api_value);
            this.maxChara = api.api_basic?.api_max_chara ?? this.maxChara;
            this.maxSlotitem = api.api_basic?.api_max_slotitem ?? this.maxSlotitem;
            this.nickname = api.api_basic?.api_nickname ?? this.nickname;
            this.hqLv = api.api_basic?.api_level ?? this.hqLv;
            this.combinedFlag = api.api_combined_flag ?? 0;
            this.currentSortieFleetId = 0;
            this.battleInfo = null;
            this.sortieInfo = null;
            this.lastDayBattle = null;
            // 計時器在「進入母港畫面」這一刻推進，故兩件事都在這裡處理：
            // (1) 出門中（anchor=null）的艦隊回港 → 重新起算；仍在遠征的隊維持 null。
            // (2) 已跑滿一個週期 → 遊戲就是在此刻結算的，結算後重新起算下一輪。
            //     未滿一個週期時進母港**不重置**（wiki 明載 20 分未到就查看母港，計數繼續）。
            // 從未觀測過的艦隊不在此建立錨點——沒看過就是「不可考」，UI 顯示範圍但不顯示倒數，
            // 比拿回港時間硬湊一個假倒數誠實。
            const advance = (m: Map<number, number | null>, i: number, deck: any, intervalMs: number) => {
                const anchor = m.get(i);
                if (anchor === undefined) return;                       // 不可考，不硬湊
                if (anchor === null) {                                  // 出門中
                    if (!(deck.api_mission?.[0] > 0)) m.set(i, ts);     // 已回港
                    return;
                }
                if (ts - anchor >= intervalMs) m.set(i, ts);            // 本次進港已結算 → 下一輪
            };
            this.decks.forEach((d: any, i: number) => {
                advance(this.repairAnchorByDeck, i, d, 20 * 60_000);
                advance(this.moraleAnchorByDeck, i, d, 15 * 60_000);
            });
        } else if (path === 'api_req_map/start' && req) {
            this.currentSortieFleetId = Number(req.api_deck_id) - 1;
            // 出擊中：計時器歸零、且要等回港才重新起算，故先標 null（見 repairAnchorByDeck）。
            this.markFleetAway(this.currentSortieFleetId);
            if (this.combinedFlag > 0 && this.currentSortieFleetId === 0) this.markFleetAway(1);
            this.battleInfo = null;
            this.lastDayBattle = null;
            this.pendingConsumption = [];
            this.sortieInfo = {
                mapArea: api.api_maparea_id,
                mapNo: api.api_mapinfo_no,
                nodes: [sortieNodeOf(api)],
            };
            this.bumpQuestProgress('sortie');
        } else if (path === 'api_req_map/next') {
            if (this.sortieInfo) {
                this.sortieInfo.nodes.push(sortieNodeOf(api));
            }
        } else if (path === 'api_req_hensei/change' && req) {
            const deck = this.decks[Number(req.api_id) - 1];
            if (!deck) return;
            const deckIdx = Number(req.api_id) - 1;
            const idx = Number(req.api_ship_idx);
            const newId = Number(req.api_ship_id);
            if (newId === -2) {
                // 隨伴艦一括解除：遊戲內部**不算**編成調整，泊地修理計時器不重置
                // （使用者實測的既知 bug feature，見 repairAnchorByDeck 註解）。
                deck.api_ship = deck.api_ship.map((v: number, i: number) => (i === 0 ? v : -1));
                return;
            }
            const oldId = deck.api_ship[idx];
            if (newId > 0) {
                for (const d of this.decks) {
                    const j = d.api_ship.indexOf(newId);
                    if (j >= 0) {
                        d.api_ship[j] = oldId;
                        // 換上來的艦若原本在別隊，那一隊的成員也被改動了 → 一併重置。
                        if (d !== deck) this.resetRepairAnchor(this.decks.indexOf(d), ts);
                    }
                }
            }
            deck.api_ship[idx] = newId;
            this.resetRepairAnchor(deckIdx, ts);
        } else if (path === 'api_req_hensei/preset_select' && req) {
            const idx = Number(req.api_deck_id) - 1;
            if (api && this.decks[idx]) this.decks[idx] = api;
        } else if (path === 'api_req_hensei/combined') {
            // 母港「連合艦隊」切換鈕：型別值在 req.api_combined_type（1=機動、3=輸送
            // 兩個值都已用真封包交叉驗證，見 samples/hensei-combined-*.json），2=水上
            // 用刪去法推得（僅 3 種型別，1/3 已確定，未直接驗證）。api_data.api_combined
            // 恆為 1，是「連合已啟用」的通用成功旗標、不是型別值——曾經誤讀這個欄位
            // 導致面板不論選哪種都誤顯示成機動部隊，已用兩個不同 req 值（1與3、api
            // 皆回1）證實那個假設是錯的，不要改回去讀 api。
            this.combinedFlag = Number(req?.api_combined_type ?? 0);
        } else if (path === 'api_req_kaisou/destroyship' && req) {
            // 解体：移除艦娘（api_ship_id 可為逗號分隔多艘），面板即時反映艦娘數/編成。
            const ids = (req.api_ship_id ?? '').split(',').map(Number).filter(n => n > 0);
            const destroyGear = req.api_slot_dest === '1';   // 「装備も解体」時は装備も倉庫から消える
            for (const sid of ids) {
                const s = this.ships.get(sid);
                if (s && destroyGear)
                    for (const gid of [...(s.api_slot ?? []), s.api_slot_ex])
                        if (gid > 0) this.slotItems.delete(gid);
                this.ships.delete(sid);
            }
            for (const d of this.decks)
                d.api_ship = d.api_ship.map((id: number) => (ids.includes(id) ? -1 : id));
            // 解体艦娘任務（見 quest-progress.ts QUEST_ID_OVERRIDES，例：任務609「軍縮条約対応！」）：
            // 一次請求可逗號分隔解體多艘，逐艘計數（非逐次請求計數）。
            if (ids.length > 0) this.bumpQuestProgress('shipScrap', ids.length);
        } else if (path === 'api_req_kaisou/destroyitem2' && req) {
            // 装備廃棄：即時に装備数へ反映
            const gearIds = (req.api_slotitem_ids ?? '').split(',').map(Number).filter(n => n > 0);
            for (const gid of gearIds) this.slotItems.delete(gid);
            // 廃棄装備任務（見 quest-progress.ts QUEST_ID_OVERRIDES，例：任務613「資源の再利用」）：
            // 一次請求可逗號分隔廢棄多個，逐個計數（非逐次請求計數）。
            if (gearIds.length > 0) this.bumpQuestProgress('gearScrap', gearIds.length);
        } else if (path === 'api_req_kaisou/powerup' && req) {
            // 近代化改修：餌艦(api_id_items)消滅・強化先(api_ship)更新
            if (api?.api_ship) this.ships.set(api.api_ship.api_id, api.api_ship);
            const feeders = (req.api_id_items ?? '').split(',').map(Number).filter(n => n > 0);
            for (const sid of feeders) this.ships.delete(sid);
            for (const d of this.decks)
                d.api_ship = d.api_ship.map((id: number) => (feeders.includes(id) ? -1 : id));
            // 近代化改修没有失敗判定（有餌就必定吃成功），故每次呼叫都算一次成功。
            this.bumpQuestProgress('modernization');
        } else if (path === 'api_req_kaisou/slotset' && req) {
            // 一般裝備欄（0-3 番）。已用真實封包排除補強增設走這條的假設——現行版本
            // 補強增設是獨立端點 api_req_kaisou/slotset_ex（見下），這裡恆定收到有效 idx。
            const s = this.ships.get(Number(req.api_id));
            if (s) {
                const idx = Number(req.api_slot_idx);
                const itemId = Number(req.api_item_id);   // -1 = 卸下
                // 裝備到「目前是空格」的槽位時，遊戲會自動塞進當下第一個空槽，
                // req.api_slot_idx 只是使用者點擊當下的格位、不是最終落點——已用真封包
                // 驗證（samples/equip_slot.json + slot_to_port.json：全空裝艦點第三格
                // [idx=2]，回港快照證實實際落在 index 0）。換裝／替換既有裝備（目標格
                // 本身已有東西，非空格）不涉及遞補，idx 才是真正目標格，維持直接寫入。
                if (itemId > 0 && s.api_slot[idx] <= 0) {
                    s.api_slot[s.api_slot.findIndex((v: number) => v <= 0)] = itemId;
                } else {
                    s.api_slot[idx] = itemId;
                }
            }
        } else if (path === 'api_req_kaisou/slotset_ex' && req) {
            // 補強增設（ex slot）：無 api_slot_idx，只有 api_id + api_item_id（-1=卸下）。
            // 已用真實封包驗證（req: api_id=215&api_item_id=71340，無 idx 欄位）。
            const s = this.ships.get(Number(req.api_id));
            if (s) s.api_slot_ex = Number(req.api_item_id);
        } else if (path === 'api_req_kaisou/unsetslot_all' && req) {
            // 全裝備解除：一鍵卸下該艦所有一般裝備欄（0-3 番），面板即時反映裝備 chip 清空。
            // req 只帶 api_id（艦船 id）。補強增設（ex slot）為獨立槽位、此按鈕不影響（遊戲上需另行卸下），故保留。
            const s = this.ships.get(Number(req.api_id));
            if (s && Array.isArray(s.api_slot)) s.api_slot = s.api_slot.map(() => -1);
        } else if (path === 'api_req_mission/start' && req) {
            const deckIdx = Number(req.api_deck_id) - 1;
            const deck = this.decks[deckIdx];
            if (deck) deck.api_mission = [1, Number(req.api_mission_id), api.api_complatetime, 0];
            this.lastMissionByDeck.set(deckIdx, Number(req.api_mission_id));
            // 遠征中：同出擊，計時器要等回港才重新起算。
            this.markFleetAway(deckIdx);
        } else if (path === 'api_req_mission/return_instruction' && req) {
            const deck = this.decks[Number(req.api_deck_id) - 1];
            if (deck && api?.api_mission) deck.api_mission = api.api_mission;
        } else if (path === 'api_req_mission/result') {
            // 遠征成功／大成功判定：api_clear_result（0=失敗、≥1=成功），與
            // EventProjector.archiveExpedition 讀取的是同一個已驗證欄位。提早回航
            // （return_instruction）不會走這個端點、故不會被誤算成一次成功。
            // 部分任務限定特定遠征任務 id（例：410/411限定「東京急行」系，見 quest-progress.ts
            // QUEST_ID_OVERRIDES）——missionId 與 EventProjector.archiveExpedition 同一支
            // lastMissionByDeck 查表（req.api_deck_id 兩者皆有，已用真實封包驗證）。
            if (Number(api?.api_clear_result ?? 0) >= 1) {
                const deckId = Number(req?.api_deck_id ?? 0);
                const missionId = this.lastMissionByDeck.get(deckId - 1);
                this.bumpQuestProgress('expedition', 1, { missionId });
            }
        } else if (path === 'api_req_nyukyo/start' && req) {
            // 入渠任務以實際送出的入渠請求計數；高速修復同樣走此端點，仍保留原始
            // 動作事實，不從本機猜測遊戲是否因修理時間而另作判斷。
            this.bumpQuestProgress('dock');
            // nyukyo/start 的回應本身不含修理時間；修復到全快所需的毫秒數
            // 記在艦船物件上（api_ship[].api_ndock_time）。用它算完成時刻，
            // 面板即可即時顯示入渠倒數，不必回母港。
            const shipId = Number(req.api_ship_id);
            const ship = this.ships.get(shipId);
            if (req.api_highspeed === '1') {
                // 高速修復（バケツ）：即時全快、不占入渠槽
                if (ship) { ship.api_nowhp = ship.api_maxhp; ship.api_ndock_time = 0; }
            } else {
                const idx = Number(req.api_ndock_id) - 1;
                const dock = this.ndockData[idx];
                if (dock) {
                    dock.api_state = 1;
                    dock.api_ship_id = shipId;
                    // 使用 reducer 收到的事件時間：歷史重播／SW 恢復時必須以原始 event.ts
                    // 計算，不能把完成時刻錯誤延到重播當下。未傳 ts 的 live 呼叫仍由
                    // applyEvent 的預設值 Date.now() 維持既有行為。
                    dock.api_complete_time = ts + Number(ship?.api_ndock_time ?? 0);
                }
            }
        } else if (path === 'api_req_hokyu/charge') {
            // 補給任務（例：「艦隊酒保祭り！受注中」的補給15回）每次 charge 請求
            // 算一次，不以實際補了幾艘或補了多少資源猜測次數。
            this.bumpQuestProgress('supply');
            // 補給：即時更新艦船燃料/彈藥/艦載機，讓面板不必回母港就反應
            for (const s of api.api_ship ?? []) {
                const ship = this.ships.get(s.api_id);
                if (!ship) continue;
                ship.api_fuel = s.api_fuel;
                ship.api_bull = s.api_bull;
                if (s.api_onslot) ship.api_onslot = s.api_onslot;
            }
            // charge 回應的 api_material 只含前 4 項（燃/弾/鋼/ボ），
            // 直接覆蓋整個陣列會把桶/開/ネジ（index 5,6,7）抹成 undefined。
            // 故只就地更新回傳到的索引，其餘資材沿用母港封包的值。
            // （元素可能是數字或 {api_value} 物件，兩者都相容）
            if (Array.isArray(api.api_material)) {
                api.api_material.forEach((m: any, i: number) => {
                    this.materials[i] = typeof m === 'number' ? m : m.api_value;
                });
            }
            // ── 基地航空隊 ──────────────────────────────
        } else if (path === 'api_get_member/base_air_corps') {
            this.airBases.clear();
            if (Array.isArray(api)) {
                for (const ab of api) {
                    const key = `${ab.api_area_id}_${ab.api_rid}`;
                    this.airBases.set(key, ab);
                }
            }
        } else if (path === 'api_get_member/mapinfo') {
            if (api?.api_air_base && Array.isArray(api.api_air_base)) {
                for (const ab of api.api_air_base) {
                    const key = `${ab.api_area_id}_${ab.api_rid}`;
                    this.airBases.set(key, ab);
                }
            }
            // 關卡進度：已用真實封包驗證（見 MapGaugeView 註解、samples/6-5-mapinfo.json）。
            const mapList = api?.api_map_info;
            if (Array.isArray(mapList)) {
                for (const m of mapList) {
                    if (!m?.api_id) continue;
                    const ev = m.api_eventmap;
                    this.mapGauges.set(m.api_id, {
                        cleared: m.api_cleared === '1' || m.api_cleared === 1,
                        gaugeType: m.api_gauge_type ?? 0,
                        defeatCount: m.api_defeat_count ?? 0,
                        requiredDefeatCount: m.api_required_defeat_count ?? 0,
                        nowHp: ev?.api_now_maphp ?? 0,
                        maxHp: ev?.api_max_maphp ?? 0,
                        selectedRank: Number.isSafeInteger(ev?.api_selected_rank) && ev.api_selected_rank > 0
                            ? ev.api_selected_rank
                            : 0,
                    });
                }
            }
        } else if (path === 'api_req_air_corps/set_plane' && req) {
            // api 回應包含更新後的 api_plane_info + api_distance
            const key = `${req.api_area_id}_${req.api_base_id}`;
            const ab = this.airBases.get(key);
            if (ab && api) {
                if (api.api_plane_info) ab.api_plane_info = api.api_plane_info;
                if (api.api_distance) ab.api_distance = api.api_distance;
            }
        } else if (path === 'api_req_air_corps/set_action' && req) {
            // set_action 可同時設定多個航空隊 (api_base_id=1,2 / api_action_kind=1,2)
            const areaId = req.api_area_id;
            const bases = (req.api_base_id ?? '').split(',');
            const actions = (req.api_action_kind ?? '').split(',');
            bases.forEach((bid: string, i: number) => {
                const ab = this.airBases.get(`${areaId}_${bid}`);
                if (ab) ab.api_action_kind = Number(actions[i] ?? actions[0]);
            });
        } else if (path === 'api_req_air_corps/supply' && req) {
            const key = `${req.api_area_id}_${req.api_base_id}`;
            const ab = this.airBases.get(key);
            if (ab && api?.api_plane_info) {
                ab.api_plane_info = api.api_plane_info;
            }
        } else if (path === 'api_req_air_corps/change_name' && req) {
            const key = `${req.api_area_id}_${req.api_base_id}`;
            const ab = this.airBases.get(key);
            if (ab) ab.api_name = req.api_name ?? ab.api_name;
        } else if (
            (path.startsWith('api_req_sortie/battle')
                || path.includes('airbattle')   // api_req_sortie/(ld_)airbattle・api_req_combined_battle/(ld_)airbattle 航空戰/空襲節點
                || path.startsWith('api_req_combined_battle/')
                || path.startsWith('api_req_battle_midnight/')
                || path.startsWith('api_req_practice/battle'))
            && !path.endsWith('result')   // 排除 battleresult：startsWith('...battle') 會誤吞它
            && api?.api_f_nowhps          // 只處理帶有戰鬥血量的封包（現行格式），避免 goback_port 等把 battleInfo 洗空
        ) {
            try {
                const isNightOnly = path.includes('sp_midnight');
                const isNight = path.includes('midnight');
                // 演習「挑戰次數」在晝戰當下就算一次，不必等結果——夜戰接續是同一場
                // 演習的延續，不會重複觸發 api_req_practice/battle。
                if (path === 'api_req_practice/battle') this.bumpQuestProgress('practiceAttempt');

                // Get player damecons
                const playerDamecons = this.getPlayerDamecons(api);
                
                // Record daytime battle data for MVP prediction if needed
                if (!isNight) {
                    this.lastDayBattle = api;
                    this.battleInfo = analyzeBattle([api], playerDamecons);
                } else if (this.lastDayBattle && isNight && !isNightOnly) {
                    this.battleInfo = analyzeBattle([this.lastDayBattle, api], playerDamecons);
                } else {
                    this.battleInfo = analyzeBattle([api], playerDamecons);
                }
                // 把戰鬥模擬後的 HP 寫回 this.ships，讓編成面板即時反映受損
                if (this.battleInfo?.resultFleets) this.applyBattleHp(this.battleInfo.resultFleets);
                // ── 依節點類型套用燃彈消耗率（日wiki「資材」頁實測值，2024/03 版）──
                // 每戰獨立計算、切捨（0<x<1 時進位為 1）；夜戰彈藥 = 晝彈×1.5 切り上げ。
                // 活動特殊點（PT 4/8・雷達 4/0・對潛空襲 12/6）無法純靠 path 區分，按普通處理；回港校正。
                let fuelRate: number, bullRate: number;
                let nightAmmoBoost = false;
                const map = this.sortieInfo;
                const atBoss = map ? map.nodes[map.nodes.length - 1]?.color === 5 : false;
                if (path.includes('ld_airbattle')) {
                    // 空襲戰（單向）：6-4/6-5 = 4/8；其他（5-2/7-2/活動圖）= 6/4
                    const is64or65 = map?.mapArea === 6 && (map.mapNo === 4 || map.mapNo === 5);
                    fuelRate = is64or65 ? 0.04 : 0.06;
                    bullRate = is64or65 ? 0.08 : 0.04;
                } else if (path.includes('airbattle')) {       // 航空戰（雙向）
                    fuelRate = 0.20; bullRate = 0.20;
                } else if (isNightOnly) {                      // 開幕夜戰點
                    fuelRate = 0.10; bullRate = 0.10;
                } else if (isNight) {
                    // 夜戰接續：燃料不追加；彈藥補到 ceil(晝彈×1.5)（差額在 applyConsumption 算）
                    fuelRate = 0; bullRate = 0; nightAmmoBoost = true;
                } else {                                       // 普通水上晝戰
                    fuelRate = 0.20; bullRate = 0.20;
                    // 反潛點（敵主隊全為潛水艦）→ 8/0。
                    // 例外仍 20/20：boss 節點（color=5）、4-1 D/4-3 C（wiki 明載的道中潛水例外）
                    const eIds = this.battleInfo?.enemyIds ?? [];
                    const allSubs = eIds.length > 0 && eIds.every(id => {
                        const st = this.master.get(id)?.stype ?? 0;
                        return st === 13 || st === 14;
                    });
                    const aswException = atBoss || (map?.mapArea === 4 && (map.mapNo === 1 || map.mapNo === 3));
                    if (allSubs && !aswException) { fuelRate = 0.08; bullRate = 0; }
                }
                // 燃彈消耗延後到結算（battleresult）才寫回：出擊途中面板顯示的油彈維持戰前值，
                // 與遊戲戰鬥畫面一致（油彈餘量會影響戰鬥傷害，過早顯示會誤導）。此處只記錄待套用費率。
                this.pendingConsumption.push({ fuelRate, bullRate, nightAmmoBoost, hasEscort: GameState.hasEscortFleet(api) });
                // Boss 節點（color=5）：記錄 boss 旗艦最大HP，供 HP量表式關卡（gaugeType 2）
                // 估「剩餘攻略次數」= ceil(關卡殘HP / boss旗艦HP)。boss HP 需實戰擊破過一次才知。
                if (atBoss && map) {
                    const bossHp = this.battleInfo?.resultFleets?.enemyMain?.[0]?.maxHp ?? 0;
                    if (bossHp > 0) this.mapBossHp.set(map.mapArea * 10 + map.mapNo, bossHp);
                }
            } catch (e) {
                console.error("BattlePrediction Error", e);
            }
        } else if (path === 'api_req_sortie/battleresult' || path === 'api_req_combined_battle/battleresult') {
            if (this.battleInfo) {
                this.battleInfo.hasResult = true;
                this.battleInfo.drop = api.api_get_ship ? localizeShip(api.api_get_ship.api_ship_id, api.api_get_ship.api_ship_name) : null;
                if (api.api_win_rank) this.battleInfo.rank = api.api_win_rank;
            }
            // 出擊戰鬥任務（見 quest-progress.ts QUEST_ID_OVERRIDES）。多數任務任意海域/節點
            // 皆可（201/210/216 等），少數限定海域＋boss＋rank 門檻（226/229/241/242/243/
            // 261/265）——這批的過濾條件存在 questProgress 各自的 area/bossOnly/minRank
            // 欄位，bumpQuestProgress() 內部判斷，這裡只需照實提供這次結算的上下文。
            // battleEngage 不論勝敗、每次結算就算一次（例：任務210「10回邀撃」）；
            // battleWin 只在 rank 達到門檻（預設 S/A/B，個別任務可能收窄到 A 或 S）才算。
            const map = this.sortieInfo;
            const battleCtx = {
                area: map ? map.mapArea * 10 + map.mapNo : undefined,
                boss: map ? map.nodes[map.nodes.length - 1]?.color === 5 : false,
                rank: api?.api_win_rank,
            };
            this.bumpQuestProgress('battleEngage', 1, battleCtx);
            this.bumpQuestProgress('battleWin', 1, battleCtx);
            // 結算畫面（顯示 rank+掉落）才一併套用本節點各戰累積的燃彈消耗，寫回 this.ships。
            for (const c of this.pendingConsumption) this.applyConsumption(c.fuelRate, c.bullRate, c.nightAmmoBoost, c.hasEscort);
            this.pendingConsumption = [];
        } else if (path === 'api_req_practice/battle_result') {
            // 演習結果端點：路徑名稱依社群工具（poi/KC3Kai）慣例推定，本專案尚無真封包樣本
            // 驗證（見 CLAUDE.md 驗證原則）。rank S/A/B 判定「勝利」同樣是社群慣例、非本專案
            // 逐一驗證過的封包事實——只用於「演習N回勝利」這類任務的粗略計數，不影響戰鬥
            // 預測主邏輯，錯了也只會讓進度多算/少算一次，不會誤導大破等安全相關判斷。
            if (this.battleInfo) {
                this.battleInfo.hasResult = true;
                if (api?.api_win_rank) this.battleInfo.rank = api.api_win_rank;
            }
            if (['S', 'A', 'B'].includes(api?.api_win_rank)) this.bumpQuestProgress('practiceWin');
        }
    }

    // 幫所有「正在追蹤且種類相符」的任務進度 +1（封頂於 target，避免超額顯示）。
    // 一次動作可能同時符合多個任務（例：同天有兩個「遠征N回」任務），故一律全數命中。
    // ctx 帶這次動作的上下文（海域/boss/rank/遠征任務id），只有任務本身設定了對應過濾條件
    // （area/bossOnly/minRank/missionIds）才會用來篩選；沒設定的任務維持無條件累加，行為
    // 與擴充過濾條件前完全相同。
    private bumpQuestProgress(
        kind: QuestActionKind,
        amount = 1,
        ctx?: { area?: number; boss?: boolean; rank?: string; missionId?: number },
    ): void {
        for (const p of this.questProgress.values()) {
            if (p.kind !== kind || p.count >= p.target) continue;
            if (p.area && (ctx?.area === undefined || !p.area.includes(ctx.area))) continue;
            if (p.bossOnly && !ctx?.boss) continue;
            if (p.missionIds && (ctx?.missionId === undefined || !p.missionIds.includes(ctx.missionId))) continue;
            if (kind === 'battleWin' && !meetsRank(ctx?.rank, p.minRank ?? 'B')) continue;
            p.count = Math.min(p.target, p.count + amount);
        }
    }

    // 以回應帶的資材陣列更新庫存，回傳每項消耗差分（正值）。元素可能是數字或
    // {api_value} 物件（與 hokyu/charge 分支同容錯）；未帶該索引的項目沿用現值、差分記 0。
    // 資材尚未播種（未回過母港）時差分全 0，呼叫端自行以 req 配方補正。
    private updateMaterials(list: any): number[] {
        const used = new Array(8).fill(0);
        if (!Array.isArray(list)) return used;
        list.forEach((m: any, i: number) => {
            const v = typeof m === 'number' ? m : m?.api_value;
            if (typeof v !== 'number') return;
            const prev = this.materials[i];
            if (typeof prev === 'number' && prev > v) used[i] = prev - v;
            this.materials[i] = v;
        });
        return used;
    }

    // 秘書艦（第一艦隊旗艦）master id：開發/建造/改修結果受其影響，工廠紀錄一併保存。
    private secretaryMst(): number {
        const sid = this.decks[0]?.api_ship?.[0];
        return sid > 0 ? this.ships.get(sid)?.api_ship_id ?? 0 : 0;
    }

    // 裝備 master id → 圖示 id（api_type[3]）。工廠分頁渲染開發結果/改修對象 chip 用
    // （gearOf 只吃裝備實例 id，開發失敗等情境沒有實例可查）。
    gearIconId(mst: number): number {
        return this.masterGears.get(mst)?.icon ?? 0;
    }

    // 把戰鬥模擬結果的 HP 寫回 this.ships（api_nowhp），供編成面板即時顯示受損。
    // resultFleets 的順序與出擊 deck 中「存在艦（id>0）」的順序一致。
    private applyBattleHp(f: BattleFleetView) {
        const write = (deck: any, ships: BattleShipView[]) => {
            if (!deck) return;
            const ids = deck.api_ship.filter((id: number) => id > 0);
            ids.forEach((id: number, i: number) => {
                const s = this.ships.get(id);
                const bs = ships[i];
                if (s && bs) s.api_nowhp = Math.max(0, bs.hp);
            });
        };
        write(this.decks[this.currentSortieFleetId], f.playerMain);
        // 連合艦隊（出擊第1艦隊時）隨伴為第2艦隊。非連合出擊時封包沒有 *_combined 血量，
        // analyzeBattle 的 playerEscort 會是空陣列、write 自然不寫入任何一艘——
        // 這是第2艦隊不被誤動的保證，改動 playerEscort 語意前先看 hasEscortFleet 的說明。
        if (this.currentSortieFleetId === 0 && this.decks[1]) write(this.decks[1], f.playerEscort);
    }

    // 估算出擊途中的燃彈消耗（遊戲封包不帶途中燃彈實數）。費率由呼叫端依節點類型指定，
    // 規則依日wiki「資材」頁（可用其艦種消費一覽表反推驗證）：
    //   ・每戰獨立計算，端數切捨；但 0<x<1 時進位為 1（最低消費 1）
    //   ・夜戰接續（nightAmmoBoost）：彈藥總量 = ceil(晝戰彈 × 1.5)，此處補扣差額。
    //     例：睦月型彈max15 → 晝3、夜戰込み ceil(4.5)=5、夜追加 2（非 floor(max×10%)=1）
    //   ・結婚艦 −15% 是母港補給成本折扣，不影響出擊中油量計下降，故不套用
    // 回母港 api_port/port 會以實數覆蓋校正。
    private applyConsumption(fuelRate: number, bullRate: number, nightAmmoBoost = false, hasEscort = false) {
        // 單戰消費：切捨、最低 1
        const cost = (max: number, rate: number) => {
            if (max <= 0 || rate <= 0) return 0;
            const x = max * rate;
            return x < 1 ? 1 : Math.floor(x);
        };
        const consumeDeck = (deck: any) => {
            if (!deck) return;
            for (const id of deck.api_ship) {
                if (id <= 0) continue;
                const s = this.ships.get(id);
                if (!s) continue;
                const m = this.master.get(s.api_ship_id);
                const fuelCost = cost(m?.fuelMax ?? 0, fuelRate);
                let bullCost = cost(m?.bullMax ?? 0, bullRate);
                if (nightAmmoBoost) {
                    const day = cost(m?.bullMax ?? 0, 0.2);
                    bullCost += Math.ceil(day * 1.5) - day;
                }
                s.api_fuel = Math.max(0, (s.api_fuel ?? 0) - fuelCost);
                s.api_bull = Math.max(0, (s.api_bull ?? 0) - bullCost);
            }
        };
        consumeDeck(this.decks[this.currentSortieFleetId]);
        // 隨伴（第2）艦隊只在該場戰鬥封包確實帶 *_combined 血量時才一起消耗（見 hasEscortFleet）。
        if (hasEscort && this.currentSortieFleetId === 0 && this.decks[1]) consumeDeck(this.decks[1]);
    }

    private getPlayerDamecons(api: any) {
        const damecons: { main: number[], escort: number[] } = { main: [], escort: [] };

        // Main fleet
        const mainDeck = this.decks[this.currentSortieFleetId];
        if (mainDeck) {
            for (const sid of mainDeck.api_ship) {
                if (sid <= 0) continue;
                damecons.main.push(this.getDamecon(sid));
            }
        }

        // 隨伴艦隊：同 applyConsumption，以封包是否帶 *_combined 為準（見 hasEscortFleet）
        if (GameState.hasEscortFleet(api) && this.currentSortieFleetId === 0 && this.decks[1]) {
            for (const sid of this.decks[1].api_ship) {
                if (sid <= 0) continue;
                damecons.escort.push(this.getDamecon(sid));
            }
        }
        
        return damecons;
    }

    private getDamecon(shipId: number): number {
        const s = this.ships.get(shipId);
        if (!s) return 0;
        const slots = [...(s.api_slot ?? []), s.api_slot_ex > 0 ? s.api_slot_ex : -1];
        for (const instId of slots) {
            if (instId <= 0) continue;
            const it = this.slotItems.get(instId);
            if (it && it.mst === 42) return 1;
            if (it && it.mst === 43) return 2;
        }
        return 0;
    }

    // 改造形態 → 基礎形態的 master id 反解。改造形態（改／改二／改三／艦種轉換）沿用基礎
    // 形態的官方登場日，故查 SHIP_DEBUT 前一律先過這裡（見 utils/ship-debut-data.ts）。
    //
    // 兩段式：先查 api_mst_shipupgrade 的直接對應（主要、O(1)），查無再沿 api_aftershipid
    // 的反向圖往回走（備援）。反向走法是**帶 visited 的圖搜尋而非單鏈**，因為可逆轉換改裝
    // 會形成環（Glorious改 戦艦 740 ⇄ 正規空母 741）：單鏈會困在環裡繞到上限後回傳錯誤答案。
    // 走完取「無任何前身」的根；若有多個根，取図鑑番号最小者（＝最原始形態）。
    // 實測（samples/start2-master.json）：本法對全部 862 個有図鑑番号的形態皆解得出，
    // 且 Glorious 四形態（1022/1027/740/741）一致解到 1022（No.612）。
    baseShipId(masterId: number | undefined): number | null {
        if (!Number.isSafeInteger(masterId as number) || (masterId as number) <= 0) return null;
        const start = masterId as number;
        const direct = this.upgradeOriginal.get(start);
        if (direct) return direct;

        const seen = new Set<number>([start]);
        const stack = [start];
        const roots: number[] = [];
        while (stack.length) {
            const cur = stack.pop()!;
            const preds = this.remodelPrev.get(cur);
            if (!preds?.length) { roots.push(cur); continue; }
            for (const p of preds) {
                if (seen.has(p)) continue;
                seen.add(p);
                stack.push(p);
            }
        }
        if (!roots.length) return start;
        return roots.reduce((best, r) => {
            const rn = this.master.get(r)?.sortno ?? Number.MAX_SAFE_INTEGER;
            const bn = this.master.get(best)?.sortno ?? Number.MAX_SAFE_INTEGER;
            return rn < bn || (rn === bn && r < best) ? r : best;
        });
    }

    // 図鑑番号（api_sortno）。0/缺＝不在図鑑（深海棲艦、佔位條目等）→ 回 null。
    pictureBookNo(masterId: number | undefined): number | null {
        const no = masterId == null ? undefined : this.master.get(masterId)?.sortno;
        return Number.isSafeInteger(no as number) && (no as number) > 0 ? (no as number) : null;
    }

    // 名稱本地化的唯一入口：master id → 目前顯示語言的譯名，缺譯回退封包日文原名。
    // 譯名表在 utils/gamedata-i18n.ts（純資料，內容待外部填入）；面板亦一律透過這兩個
    // 方法取名（含敵艦名），確保翻譯只有一個掛鉤點。
    shipName(masterId: number | undefined): string {
        return localizeShip(masterId, masterId == null ? undefined : this.master.get(masterId)?.name);
    }
    gearName(mstId: number | undefined): string {
        return localizeGear(mstId, mstId == null ? undefined : this.masterGears.get(mstId)?.name);
    }

    private gearOf(instId: number): GearView | null {
        if (instId <= 0) return null;
        const it = this.slotItems.get(instId);
        if (!it) return null;
        const m = this.masterGears.get(it.mst);
        const icon = GEAR_ICON[m?.icon ?? 0] ?? { s: '装', c: 'c-etc' };
        // icon＝api_type[3] 原始 id，面板以此組 /icons/equipment/<id>.png；short/cat 為圖示載入失敗時的文字退路。
        return { mst: it.mst, name: localizeGear(it.mst, m?.name), short: icon.s, cat: icon.c, type: m?.cat ?? 0, asw: m?.stats.tais ?? 0, icon: m?.icon ?? 0, level: it.level, alv: it.alv };
    }

    private fleetName(d: any, i: number) {
        return (d.api_name && d.api_name !== '-') ? d.api_name : t('fleet.default', { n: i + 1 });
    }

    counts() {
        const gears = [...this.slotItems.values()].filter(it => !this.consumableGearIds.has(it.mst)).length;
        return {
            ships: this.ships.size, maxShips: this.maxChara,
            gears, maxGears: this.maxSlotitem
        };
    }

    quests_(): QuestView[] {
        return [...this.quests.entries()].map(([no, q]) => {
            const p = this.questProgress.get(no);
            return {
                no, name: q.name, detail: q.detail, done: q.done,
                progress: p ? { count: p.count, target: p.target } : null,
            };
        });
    }

    // ── 遠征需求檢查 ──────────────────────────────
    // 遠征カタログ(選択メニュー用):海域→表示番号順
    expedCatalog(): { id: number; dispNo: string; name: string; maparea: number }[] {
        return [...this.masterMissions.entries()]
            .map(([id, m]) => ({ id, dispNo: m.dispNo, name: m.name, maparea: m.maparea }))
            .sort((a, b) => a.maparea - b.maparea ||
                a.dispNo.localeCompare(b.dispNo, 'ja', { numeric: true }));
    }

    // 該艦隊上次執行的遠征 master mission id（無紀錄回 null）。遠征分頁切艦隊時用來預設選中。
    lastMissionForDeck(deckIdx: number): number | null {
        return this.lastMissionByDeck.get(deckIdx) ?? null;
    }

    expedCheck(deckIdx: number, expedId: number): {
        rows: ExpedCheckRow[]; gsRows: ExpedCheckRow[]; known: boolean; time: number;
        rewards: {
            normal: { fuel: number; bullet: number; steel: number; alum: number };
            great: { fuel: number; bullet: number; steel: number; alum: number };
            items: { name: string; max: number; guaranteed: boolean }[];
        } | null;
        greatSuccess: { rate: number; note: string } | null;
    } {
        const rows: ExpedCheckRow[] = [];       // 成功条件のみ
        const gsRows: ExpedCheckRow[] = [];     // 大成功に関わる追加条件のみ
        const deck = this.decks[deckIdx];
        const mst = this.masterMissions.get(expedId);
        if (!deck || !mst) return { rows, gsRows, known: false, time: 0, rewards: null, greatSuccess: null };

        const ships = deck.api_ship
            .filter((id: number) => id > 0)
            .map((id: number) => this.ships.get(id))
            .filter(Boolean);
        const stypeOf = (s: any) => this.master.get(s.api_ship_id)?.stype ?? 0;
        const flag = ships[0];

        if (flag) rows.push({ label: t('exped.reqFlagshipNotTaiha'), ok: flag.api_nowhp * 4 > flag.api_maxhp });
        rows.push({
            label: t('exped.reqFullSupply'),
            ok: ships.length > 0 && ships.every((s: any) => {
                const m = this.master.get(s.api_ship_id);
                return s.api_fuel >= (m?.fuelMax ?? 0) && s.api_bull >= (m?.bullMax ?? 0);
            }),
        });

        // ── 大成功率(社群実測による推定式。公式仕様ではない)──
        const sparkleCount = ships.filter((s: any) => s.api_cond >= 50).length;  // 戰意高昂(キラキラ)＝cond≥50
        const flagshipLv = flag?.api_lv ?? 0;
        // 艦隊が積んでいるドラム缶（総数・搭載艦数）。大成功率と成功条件の両方で使う。
        let drumsCarried = 0, drumCarriers = 0;
        for (const s of ships) {
            const c = (s.api_slot ?? []).filter((gid: number) => this.slotItems.get(gid)?.mst === DRUM_MST_ID).length;
            drumsCarried += c;
            if (c > 0) drumCarriers++;
        }

        const data = EXPEDITION_DATA.find(e => e.id === expedId);
        const needCount = data?.ship_count || mst.deckNum || 0;
        if (needCount) rows.push({ label: t('exped.reqShipCount', { n: needCount }), ok: ships.length >= needCount, cur: t('unit.ships', { n: ships.length }) });

        // 大成功率は遠征タイプで判定式が異なる（日wiki「遠征」大成功節）。GS_DRUM/GS_FORMULA/既定 の3分岐。
        // dispNo（実際の遠征表示番号文字列）でキー化——api_id は特にイベント遠征で不定なため。
        const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
        let greatSuccess: { rate: number; note: string };
        const drumCfg = GS_DRUM[mst.dispNo];
        if (drumCfg) {
            // Model B（ドラム缶型）：5 + 15×キラ + 35×満載度。満載度は桶数を n1→n2 で 0→1、
            // かつ桶搭載艦が規定数(ships)以上のときのみ加算（1隻に山積みで満載扱いにさせない）。
            const carriersOk = drumCarriers >= drumCfg.ships;
            const fill = carriersOk && drumCfg.n2 > drumCfg.n1
                ? clamp01((drumsCarried - drumCfg.n1) / (drumCfg.n2 - drumCfg.n1)) : 0;
            const rate = Math.max(0, Math.min(100, Math.floor(5 + 15 * Math.min(sparkleCount, 6) + 35 * fill)));
            greatSuccess = { rate, note: t('exped.gsNoteDrum', { sparkle: sparkleCount, drums: drumsCarried, max: drumCfg.n2, carriers: drumCarriers, need: drumCfg.ships }) };
            // 大成功の目標（満載＋搭載艦数）を追加条件として提示
            gsRows.push({
                label: t('exped.reqDrumGS', { n2: drumCfg.n2, ships: drumCfg.ships }),
                ok: drumsCarried >= drumCfg.n2 && carriersOk,
                cur: `${t('unit.drums', { n: drumsCarried })}/${t('unit.ships', { n: drumCarriers })}`,
            });
        } else if (GS_FORMULA.has(mst.dispNo)) {
            // Model C（旗艦Lv式）：16 + 15×キラ + (√旗艦Lv + 旗艦Lv/10)。キラ0でも大成功しうる遠征。
            const rate = Math.max(0, Math.min(100, Math.floor(
                16 + 15 * sparkleCount + Math.sqrt(flagshipLv) + flagshipLv / 10
            )));
            greatSuccess = { rate, note: t('exped.gsNoteFlagshipLv', { sparkle: sparkleCount, lv: flagshipLv }) };
        } else {
            // Model A（通常キラキラ式）：在籍全艦がキラキラでなければ大成功せず。全艦キラ時 6隻100/5隻95/4隻以下80。
            const present = ships.length;
            const allSparkled = present > 0 && sparkleCount === present;
            const rate = !allSparkled ? 0 : present >= 6 ? 100 : present >= 5 ? 95 : 80;
            greatSuccess = {
                rate,
                note: allSparkled ? t('exped.gsNoteAllSparkled', { n: present }) : t('exped.gsNoteNeedSparkle', { cur: sparkleCount, total: present }),
            };
        }

        if (!data) return { rows, gsRows, known: false, time: mst.time, rewards: null, greatSuccess };

        if (data.flagship_lv)
            rows.push({ label: t('exped.reqFlagshipLv', { n: data.flagship_lv }), ok: flagshipLv >= data.flagship_lv, cur: `Lv${flagshipLv}` });
        if (data.fleet_lv) {
            const tot = ships.reduce((a: number, s: any) => a + (s.api_lv ?? 0), 0);
            rows.push({ label: t('exped.reqFleetLv', { n: data.fleet_lv }), ok: tot >= data.fleet_lv, cur: `${tot}` });
        }
        if (data.flagship_shiptype)
            rows.push({
                label: t('exped.reqFlagshipType', { type: stypeName(data.flagship_shiptype) }),
                ok: flag ? stypeOf(flag) === data.flagship_shiptype : false,
                cur: flag ? stypeName(stypeOf(flag)) : t('common.empty'),
            });
        for (const rq of data.required_shiptypes ?? []) {
            const n = ships.filter((s: any) => rq.shiptype.includes(stypeOf(s))).length;
            rows.push({
                label: t('exped.reqShipTypesCount', { types: rq.shiptype.map(stypeName).join('/'), n: rq.count }),
                ok: n >= rq.count, cur: t('unit.ships', { n }),
            });
        }
        if (data.drum_count || data.drum_ship_count) {
            if (data.drum_count) rows.push({ label: t('exped.reqDrumCount', { n: data.drum_count }), ok: drumsCarried >= data.drum_count, cur: t('unit.drums', { n: drumsCarried }) });
            if (data.drum_ship_count) rows.push({ label: t('exped.reqDrumShipCount', { n: data.drum_ship_count }), ok: drumCarriers >= data.drum_ship_count, cur: t('unit.ships', { n: drumCarriers }) });
        }
        const ex = data.required_extra;
        if (ex) {
            const tot = (key: string) => ships.reduce((a: number, s: any) => a + (s[key]?.[0] ?? 0), 0);
            if (ex.asw) rows.push({ label: t('exped.reqAsw', { n: ex.asw }), ok: tot('api_taisen') >= ex.asw, cur: `${tot('api_taisen')}` });
            if (ex.aa) rows.push({ label: t('exped.reqAa', { n: ex.aa }), ok: tot('api_taiku') >= ex.aa, cur: `${tot('api_taiku')}` });
            if (ex.los) rows.push({ label: t('exped.reqLos', { n: ex.los }), ok: tot('api_sakuteki') >= ex.los, cur: `${tot('api_sakuteki')}` });
            if (ex.firepower) rows.push({ label: t('exped.reqFirepower', { n: ex.firepower }), ok: tot('api_karyoku') >= ex.firepower, cur: `${tot('api_karyoku')}` });
        }

        const rewardNames: Record<number, string> = {
            1: '応急修理要員', 2: '高速修復材', 3: '開発資材',
            4: '家具箱(小)', 5: '家具箱(中)', 6: '家具箱(大)',
        };
        const mul15 = (n: number) => Math.floor(n * 1.5);
        const items = (data.reward_items ?? []).map((it: any, i: number, arr: any[]) => ({
            name: rewardNames[it.itemtype] ?? `種別${it.itemtype}`,
            max: it.max_number,
            guaranteed: arr.length >= 2 && i === arr.length - 1,   // 推測:複数ある場合、最後は大成功限定
        }));
        const rewards = {
            normal: { fuel: data.reward_fuel, bullet: data.reward_bullet, steel: data.reward_steel, alum: data.reward_alum },
            great: {
                fuel: mul15(data.reward_fuel), bullet: mul15(data.reward_bullet),
                steel: mul15(data.reward_steel), alum: mul15(data.reward_alum),
            },
            items,
        };
        return { rows, gsRows, known: true, time: mst.time, rewards, greatSuccess };
    }

    // ── 制空・索敵 ──────────────────────────────
    private static EXP_LO = [0, 10, 25, 40, 55, 70, 85, 100];
    private static EXP_HI = [9, 24, 39, 54, 69, 84, 99, 120];
    private static BONUS_F = [0, 0, 2, 5, 9, 14, 14, 22];
    private static BONUS_SPB = [0, 0, 1, 1, 1, 3, 3, 6];

    airPower(deckIdx: number): { min: number; max: number } {
        const deck = this.decks[deckIdx];
        let min = 0, max = 0;
        if (!deck) return { min, max };
        for (const sid of deck.api_ship) {
            const s = this.ships.get(sid);
            if (!s) continue;
            (s.api_slot ?? []).forEach((instId: number, i: number) => {
                const onslot = s.api_onslot?.[i] ?? 0;
                if (onslot <= 0 || instId <= 0) return;
                const it = this.slotItems.get(instId);
                const g = it && this.masterGears.get(it.mst);
                if (!it || !g) return;
                const t = g.cat;
                const isF = t === 6 || t === 45 || t === 56 || t === 57;
                const isDB = t === 7, isSPB = t === 11;
                if (!(isF || isDB || t === 8 || isSPB)) return;
                const aa = g.aa + (isF ? 0.2 * it.level : isDB ? 0.25 * it.level : 0);
                const alv = Math.min(7, it.alv);
                const tb = isF ? GameState.BONUS_F[alv] : isSPB ? GameState.BONUS_SPB[alv] : 0;
                const base = aa * Math.sqrt(onslot) + tb;
                min += Math.floor(base + Math.sqrt(GameState.EXP_LO[alv] / 10));
                max += Math.floor(base + Math.sqrt(GameState.EXP_HI[alv] / 10));
            });
        }
        return { min, max };
    }

    f33(deckIdx: number, cn = 1): number {
        const deck = this.decks[deckIdx];
        if (!deck) return 0;
        let equipTerm = 0, shipTerm = 0, n = 0;
        for (const sid of deck.api_ship) {
            const s = this.ships.get(sid);
            if (!s) continue;
            n++;
            let equipLos = 0;
            const slots = [...(s.api_slot ?? []), s.api_slot_ex > 0 ? s.api_slot_ex : -1];
            for (const instId of slots) {
                if (instId <= 0) continue;
                const it = this.slotItems.get(instId);
                const g = it && this.masterGears.get(it.mst);
                if (!it || !g) continue;
                equipLos += g.los;
                const t = g.cat;
                const mult = t === 8 ? 0.8 : t === 9 ? 1.0 : t === 10 ? 1.2 : t === 11 ? 1.1 : 0.6;
                const imp = t === 10 ? 1.2 * Math.sqrt(it.level)
                    : (t === 12 || t === 13) ? 1.25 * Math.sqrt(it.level) : 0;
                equipTerm += mult * (g.los + imp);
            }
            shipTerm += Math.sqrt(Math.max(0, (s.api_sakuteki?.[0] ?? 0) - equipLos));
        }
        if (n === 0) return 0;
        const v = cn * equipTerm + shipTerm - Math.ceil(0.4 * this.hqLv) + 2 * (6 - n);
        return Math.round(v * 100) / 100;
    }

    // ── 輸送量(TP) ──────────────────────────────
    // 日wiki「輸送作戦」實測表：基本TP = Σ艦種別 + Σ装備。此為 S勝利基準值（皆整數），
    // 最終TP = floor(基本TP × rank倍率[S1.0/A0.7/B0.4]，C以下揚陸失敗)。已用 wiki 理論値編成例驗證。
    private static TP_BY_STYPE: Record<number, number> = {
        2: 5,   // 駆逐艦
        3: 2,   // 軽巡洋艦
        6: 4,   // 航空巡洋艦
        10: 7,  // (改装)航空戦艦
        16: 9,  // 水上機母艦
        17: 12, // 揚陸艦
        20: 7,  // 潜水母艦
        21: 6,  // 練習巡洋艦
        22: 15, // 補給艦
        // その他(雷巡4/重巡5/軽空7/戦艦8,9,12/正空11/潜水13/潜空14/装母18/工作19)及未列(海防1等) → 1
    };
    private static TP_BY_GEAR_MST: Record<number, number> = {
        68: 16,   // 大発動艇
        193: 20,  // 特大発動艇
        166: 12,  // 大発動艇(八九式中戦車&陸戦隊)
        167: 2,   // 特二式内火艇
        75: 5,    // ドラム缶(輸送用)
        230: 20,  // 特大発動艇+戦車第11連隊
        // 註：表未涵蓋的陸戦隊/戦車系新變種暫記 0（保守少算，不會多報）。待實測樣本再補。
    };

    // 出擊編成的 S勝利基本輸送量。回傳 { total, gear }（gear>0 才是輸送編成，顯示端據此判斷）。
    // 落伍(轟沈/退避)艦不計——此為出擊前的理論值，途中減損由結算校正，此處不模擬。
    fleetTP(deckIdx: number): { total: number; gear: number } {
        const deck = this.decks[deckIdx];
        if (!deck) return { total: 0, gear: 0 };
        let shipTP = 0, gearTP = 0;
        for (const sid of deck.api_ship) {
            if (sid <= 0) continue;
            const s = this.ships.get(sid);
            if (!s) continue;
            const stype = this.master.get(s.api_ship_id)?.stype ?? 0;
            shipTP += GameState.TP_BY_STYPE[stype] ?? 1;   // その他/未列 = 1
            const slots = [...(s.api_slot ?? []), s.api_slot_ex > 0 ? s.api_slot_ex : -1];
            for (const instId of slots) {
                if (instId <= 0) continue;
                const it = this.slotItems.get(instId);
                if (it) gearTP += GameState.TP_BY_GEAR_MST[it.mst] ?? 0;
            }
        }
        return { total: shipTP + gearTP, gear: gearTP };
    }

    fleetSummary(deckIdx: number, cn = 1) {
        const deck = this.decks[deckIdx];
        if (!deck) return null;
        let lvSum = 0, minSoku = 20;
        for (const sid of deck.api_ship) {
            const s = this.ships.get(sid);
            if (!s) continue;
            lvSum += s.api_lv ?? 0;
            minSoku = Math.min(minSoku, s.api_soku ?? 20);
        }
        const speed = minSoku >= 20 ? t('speed.fastest') : minSoku >= 15 ? t('speed.fastPlus') : minSoku >= 10 ? t('speed.fast') : t('speed.slow');
        return { lvSum, speed, air: this.airPower(deckIdx), f33: this.f33(deckIdx, cn), tp: this.fleetTP(deckIdx) };
    }

    // 連合檢視（面板聯合艦隊鈕）頂部總覽列用：第1+第2艦隊合計。Lv／制空／TP 為
    // 純加總（各自獨立可加）；速力取兩隊合計後最慢的一艘（連合艦隊移動速度受限於
    // 全體最慢艦，邏輯與單隊算法一致，只是範圍擴大成 12 艦）。
    // 索敵(33) 是唯一的近似值：官方連合索敵公式以 12 艦一次計算、提督等級修正
    // （-ceil(0.4×hqLv)）與艦數修正（2×(6-n)）都只套一次，不是兩個單隊公式的總和；
    // 這裡沿用「各自套單隊公式再相加」的近似（精確公式未經真封包驗證，clean-room
    // 重寫風險高），數字僅供概覽參考，不追求逐位精確。
    combinedSummary(cn = 1) {
        let lvSum = 0, minSoku = 20, airMin = 0, airMax = 0, f33 = 0, tpTotal = 0, tpGear = 0;
        for (const i of [0, 1]) {
            const deck = this.decks[i];
            if (!deck) continue;
            for (const sid of deck.api_ship) {
                const s = this.ships.get(sid);
                if (!s) continue;
                lvSum += s.api_lv ?? 0;
                minSoku = Math.min(minSoku, s.api_soku ?? 20);
            }
            const air = this.airPower(i);
            airMin += air.min; airMax += air.max;
            f33 += this.f33(i, cn);
            const tp = this.fleetTP(i);
            tpTotal += tp.total; tpGear += tp.gear;
        }
        const speed = minSoku >= 20 ? t('speed.fastest') : minSoku >= 15 ? t('speed.fastPlus') : minSoku >= 10 ? t('speed.fast') : t('speed.slow');
        return { lvSum, speed, air: { min: airMin, max: airMax }, f33, tp: { total: tpTotal, gear: tpGear } };
    }

    fleets(): FleetView[] {
        const inDock = this.shipsInDock();
        return this.decks.map((d, i) => ({
            name: this.fleetName(d, i),
            mission: d.api_mission?.[0] > 0,
            repairAnchor: this.repairAnchorByDeck.get(i),
            moraleAnchor: this.moraleAnchorByDeck.get(i),
            ships: d.api_ship
                .filter((id: number) => id > 0)
                .flatMap((id: number): ShipView[] => {
                    const s = this.ships.get(id);
                    if (!s) return [];
                    const mst = this.master.get(s.api_ship_id);
                    // api_slot 陣列可能超出該艦真實槽數（見 master.slotNum 註解），截斷掉
                    // 超額的 padding，避免多畫出根本不存在的空槽位。
                    const rawSlots: number[] = s.api_slot ?? [];
                    const slots = mst?.slotNum != null ? rawSlots.slice(0, mst.slotNum) : rawSlots;
                    return [{
                        id,
                        name: this.shipName(s.api_ship_id),
                        stype: STYPE_ABBR[mst?.stype ?? 0] ?? '',
                        mst: s.api_ship_id, stypeId: mst?.stype ?? 0,
                        ndockTime: Number(s.api_ndock_time ?? 0),
                        inDock: inDock.has(id),
                        lv: s.api_lv, hp: s.api_nowhp, maxhp: s.api_maxhp, cond: s.api_cond,
                        fuel: s.api_fuel ?? 0, maxFuel: mst?.fuelMax ?? 0,
                        bull: s.api_bull ?? 0, maxBull: mst?.bullMax ?? 0,
                        gears: slots.map((gid: number, idx: number) => {
                            const gv = this.gearOf(gid);
                            // 裝備為飛機的槽才附搭載數（api_onslot 即時反映戰損）；滿載數
                            // 取 master 的 maxeq（可能 undefined，見上方註解）。
                            if (gv) {
                                const it = this.slotItems.get(gid);
                                const mg = it && this.masterGears.get(it.mst);
                                if (mg && AIRCRAFT_CATS.has(mg.cat)) {
                                    gv.count = s.api_onslot?.[idx] ?? 0;
                                    gv.countMax = mst?.maxeq?.[idx];
                                }
                            }
                            return gv;
                        }),
                        // api_slot_ex：0=該艦無補強增設能力、-1=有能力但未裝備、>0=已裝備的
                        // instId。exEmpty 標出 -1 這種「有格但空」，讓面板能畫出空的打洞格
                        // （而非像現在這樣、未裝備時整格連框都不見）。
                        exGear: s.api_slot_ex > 0 ? this.gearOf(s.api_slot_ex) : null,
                        exEmpty: s.api_slot_ex === -1,
                        // 逐槽對齊：該槽是飛機槽（mst.maxeq 有值）就帶容量，跟裡面實際裝了
                        // 什麼裝備無關（真的空著／裝了非飛機裝備都要顯示），讓「未裝備艦載機
                        // 的搭載格數」恆常可見。
                        slotCapacity: slots.map((_gid: number, idx: number) => mst?.maxeq?.[idx]),
                    }];
                }),
        }));
    }

    // 全持有艦 view：overview 等唯讀介面只能讀此 API，不自行解析 raw api_ship。
    // 同 fleets()，master／slot item 缺失時以既有名稱回退與 null 裝備安全降級。
    ownedShips(): OwnedShipView[] {
        const fleetByShip = new Map<number, number>();
        this.decks.forEach((deck, index) => {
            for (const id of deck?.api_ship ?? []) {
                if (id > 0 && !fleetByShip.has(id)) fleetByShip.set(id, index + 1);
            }
        });

        return [...this.ships.entries()].map(([id, s]) => {
            const mst = this.master.get(s.api_ship_id);
            const rawSlots: number[] = Array.isArray(s.api_slot) ? s.api_slot : [];
            const slots = mst?.slotNum != null ? rawSlots.slice(0, mst.slotNum) : rawSlots;
            const baseMst = this.baseShipId(s.api_ship_id);
            const gears = slots.map(gid => this.gearOf(gid));
            const exGear = s.api_slot_ex > 0 ? this.gearOf(s.api_slot_ex) : null;
            const pair = (v: any): [number, number] =>
                Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0] : [0, 0];
            const [karyoku, karyokuMax] = pair(s.api_karyoku);
            const [raisou, raisouMax] = pair(s.api_raisou);
            const [taiku, taikuMax] = pair(s.api_taiku);
            const [soukou, soukouMax] = pair(s.api_soukou);
            const [taisen, taisenMax] = pair(s.api_taisen);
            const [kaihi, kaihiMax] = pair(s.api_kaihi);
            const [sakuteki, sakutekiMax] = pair(s.api_sakuteki);
            const [lucky, luckyMax] = pair(s.api_lucky);
            const stats: ShipStats = {
                firepower: karyoku, torpedo: raisou, aa: taiku, armor: soukou,
                asw: taisen, evasion: kaihi, los: sakuteki, luck: lucky,
            };
            // 裸素質＝顯示值減去裝備自身加成（補強增設也算一格裝備）。見 bareStats 的估算警語。
            const bareStats = { ...stats };
            for (const g of [...gears, exGear]) {
                const ms = g && this.masterGears.get(g.mst)?.stats;
                if (!ms) continue;
                bareStats.firepower -= ms.houg; bareStats.torpedo -= ms.raig;
                bareStats.aa -= ms.tyku; bareStats.armor -= ms.souk;
                bareStats.asw -= ms.tais; bareStats.evasion -= ms.houk;
                bareStats.los -= ms.saku; bareStats.luck -= ms.luck;
            }
            return {
                id,
                masterId: s.api_ship_id ?? 0,
                baseMst,
                bookNo: this.pictureBookNo(baseMst ?? undefined),
                name: this.shipName(s.api_ship_id),
                stypeId: mst?.stype ?? 0,
                stype: stypeName(mst?.stype ?? 0),
                ctype: mst?.ctype ?? 0,
                lv: s.api_lv ?? 0,
                hp: s.api_nowhp ?? 0,
                maxhp: s.api_maxhp ?? 0,
                cond: s.api_cond ?? 0,
                locked: Number(s.api_locked) === 1,
                soku: Number(s.api_soku) || 0,
                equipTypes: [...this.equipTypesOf(s.api_ship_id)],
                sallyArea: Number(s.api_sally_area) || 0,
                fleetNo: fleetByShip.get(id) ?? null,
                gears,
                exGear,
                exEmpty: s.api_slot_ex === -1,
                exp: Array.isArray(s.api_exp) ? Number(s.api_exp[0]) || 0 : 0,
                leng: Number(s.api_leng) || 0,
                fuel: s.api_fuel ?? 0, fuelMax: mst?.fuelMax ?? 0,
                bull: s.api_bull ?? 0, bullMax: mst?.bullMax ?? 0,
                stats,
                statsMax: {
                    firepower: karyokuMax, torpedo: raisouMax, aa: taikuMax, armor: soukouMax,
                    asw: taisenMax, evasion: kaihiMax, los: sakutekiMax, luck: luckyMax,
                },
                bareStats,
                kyouka: Array.isArray(s.api_kyouka) ? s.api_kyouka.map(Number) : [],
                kyoukaMax: mst?.kyoukaMax ?? [],
                remodelDone: mst == null ? null : mst.afterShipId === 0,
                exSlotOpen: Number(s.api_slot_ex) !== 0,
                exSlotSpecials: [...this.exSlotSpecialTypes(s.api_ship_id, s.api_lv ?? 0)],
            };
        });
    }

    /**
     * 全持有裝備 view（**一列一顆實例**）。母集合是 `this.slotItems`＝裝備庫本身，
     * 故裝備中與閒置的都在裡面，不會因為某艘艦沒編成就漏掉。
     *
     * 素質一律是 master 的**基礎值、未含改修 ★ 加成**——改修加成的公式依裝備類別與
     * 戰鬥情境（晝戰／夜戰／對潛…）而異，本專案不自行推導未經封包驗證的公式
     * （CLAUDE.md 驗證原則），故只呈現遊戲直接給的數字，由 UI 標示語意。
     *
     * 持有者反查涵蓋**艦（含補強增設）與基地航空隊**兩種。基地航空隊吃的是同一批裝備
     * 實例，漏掉它會把配置在基地的陸攻整批誤報成「閒置」。
     */
    ownedGears(): OwnedGearView[] {
        const holderOf = new Map<number, GearHolderView>();
        for (const s of this.ships.values()) {
            const name = this.shipName(s.api_ship_id);
            const sub = stypeName(this.master.get(s.api_ship_id)?.stype ?? 0);
            for (const gid of (Array.isArray(s.api_slot) ? s.api_slot : [])) {
                if (gid > 0 && !holderOf.has(gid)) holderOf.set(gid, { kind: 'ship', name, sub, ex: false });
            }
            const exId = Number(s.api_slot_ex) || 0;
            if (exId > 0 && !holderOf.has(exId)) holderOf.set(exId, { kind: 'ship', name, sub, ex: true });
        }
        for (const ab of this.airBases.values()) {
            const name = ab.api_name ?? `第${ab.api_rid}航空隊`;
            for (const sq of ab.api_plane_info ?? []) {
                // state!==1 的中隊沒有配置裝備（api_slotid 也會是 0），一併擋掉。
                const gid = Number(sq?.api_slotid) || 0;
                if (sq?.api_state === 1 && gid > 0 && !holderOf.has(gid)) {
                    holderOf.set(gid, { kind: 'lbas', name, sub: '', ex: false });
                }
            }
        }

        const out: OwnedGearView[] = [];
        for (const [id, it] of this.slotItems) {
            const m = this.masterGears.get(it.mst);
            out.push({
                id,
                mst: it.mst,
                name: localizeGear(it.mst, m?.name),
                icon: m?.icon ?? 0,
                catId: m?.cat ?? 0,
                catName: this.masterEquipTypes.get(m?.cat ?? 0) ?? '',
                sortNo: m?.sortNo ?? 0,
                consumable: this.consumableGearIds.has(it.mst),
                level: it.level,
                alv: it.alv,
                // master 未載入時給全 0，讓 UI 照樣列得出「持有幾顆」而不是整個消失。
                stats: m?.stats ?? {
                    houg: 0, houm: 0, leng: 0, luck: 0, houk: 0, baku: 0,
                    raig: 0, saku: 0, tais: 0, tyku: 0, souk: 0,
                },
                holder: holderOf.get(id) ?? null,
            });
        }
        return out;
    }

    /**
     * 指定海域區塊（maparea）底下的海域清單，依海域序號升冪。
     * 活動作戰板用它列出「這次活動有哪幾關」——資料來自 start2 的 `api_mst_mapinfo`，
     * 登入即有，不必等玩家開過海域選擇畫面。
     */
    mapsOfArea(area: number): { no: number; name: string; opetext: string }[] {
        return [...this.masterMapInfo.values()]
            .filter(m => m.area === area)
            .sort((a, b) => a.no - b.no)
            .map(({ no, name, opetext }) => ({ no, name, opetext }));
    }

    /**
     * 該艦 master 可裝備的裝備類別 id 集合（`api_mst_slotitem_equiptype` 的 id）。
     *
     * **規則已用真實完整 start2 驗證，不是推測**：`api_mst_equip_ship` 有條目就**完整覆蓋**
     * 艦種預設，不是與之疊加——以皐月改二(418)／睦月改二(434)／大潮改二(199) 逐一核對，
     * 其 key 集合恆為「駆逐艦 stype 的 17 個預設 ∪ 例外類別(24/46)」，**從不少於預設**。
     *
     * 為什麼非得用這張表：艦種層級的 `api_mst_stype[2].api_equip_type['24']` 是 **0**
     * （＝駆逐艦不能裝上陸用舟艇），但遊戲裡有 41 艘驅逐艦裝得了大發系（皐月改二、
     * 睦月改二、大潮改二…）。只看艦種會把「大發驅逐」整批誤判成不可裝。
     *
     * master 尚未載入（無 start2）時回傳空集合，呼叫端需可降級（不可把空集合當成「都不能裝」
     * 而據以過濾掉全部艦）。
     */
    equipTypesOf(mstId: number): Set<number> {
        const override = this.shipEquipOverride.get(mstId);
        if (override) return override;
        const stype = this.master.get(mstId)?.stype;
        return (stype != null ? this.stypeEquip.get(stype) : undefined) ?? new Set();
    }

    /**
     * 該艦能放進**補強增設**的「特殊」裝備類別 id 集合。
     *
     * 「特殊」指的是 `api_mst_equip_exslot`（全艦通用清單）**以外**、靠
     * `api_mst_equip_exslot_ship` 逐裝備開放給特定艦的類別——例如「精鋭水雷戦隊 司令部」
     * 只有少數水雷戰隊旗艦放得進增設。全艦通用的那批（機銃・応急修理要員…）人人都有，
     * 拿來篩選沒有鑑別度，故**刻意不含在回傳值裡**。
     *
     * 對象判定：exslot_ship 條目的 `api_ship_ids`（艦 master id）／`api_stypes`（艦種）／
     * `api_ctypes`（艦型）任一命中即可，並須滿足 `api_req_level`。回傳的是**裝備類別 id**
     * （由 slotitem master 的 api_type[2] 換算），因為 UI 篩選問的是「能不能放司令部／電探」
     * 這種類別層級的問題，不是特定某顆裝備。
     *
     * master 未載入時回傳空集合，呼叫端不可把空集合當成「確定不能裝」。
     */
    exSlotSpecialTypes(mstId: number, lv: number): Set<number> {
        const out = new Set<number>();
        const m = this.master.get(mstId);
        if (!m) return out;
        for (const [itemId, rule] of this.exSlotItemShips) {
            if (lv < rule.reqLevel) continue;
            if (!(rule.shipIds.has(mstId) || rule.stypes.has(m.stype) || rule.ctypes.has(m.ctype))) continue;
            const cat = this.masterGears.get(itemId)?.cat;
            // 已在全艦通用清單裡的類別沒有鑑別度（見上方說明），跳過。
            if (cat && !this.exSlotTypes.has(cat)) out.add(cat);
        }
        return out;
    }

    /**
     * 指定艦隊（1–4）的艦實例 id，**依編成順序**（旗艦在首），空位不含在內。
     * ShipView 刻意不帶實例 id，但「把目前艦隊帶進作戰板編成」這類功能需要它且順序有意義
     * （1、2 號位在泊地修理／野埼給糧都有特殊語意），故獨立成一個唯讀 view API，
     * 而不是讓呼叫端去解析 raw decks（見 ownedShips() 的同一條約定）。
     */
    fleetShipIds(fleetNo: number): number[] {
        const deck = this.decks[fleetNo - 1];
        return (deck?.api_ship ?? []).filter((id: number) => id > 0);
    }

    missions(): MissionView[] {
        return this.decks
            .map((d, i) => ({ d, i }))
            .filter(({ d }) => d.api_mission?.[0] > 0 && d.api_mission[2] > 0)
            .map(({ d, i }) => {
                const m = this.masterMissions.get(d.api_mission[1]);
                return {
                    // 遠征艦隊用編成組別編號（僅數字），不用自訂命名
                    fleet: `${i + 1}`,
                    dispNo: m?.dispNo ?? '?', name: m?.name ?? '?',
                    completeAt: d.api_mission[2] as number,
                };
            });
    }

    // 目前在入渠中的艦實例 id。泊地修理與野埼給糧都會跳過入渠中的艦。
    shipsInDock(): Set<number> {
        return new Set(
            this.ndockData.filter(n => n.api_state > 0 && n.api_ship_id > 0).map(n => n.api_ship_id as number),
        );
    }

    ndocks(): NdockView[] {
        return this.ndockData
            .filter(n => n.api_state > 0)
            .map(n => ({
                ship: this.shipName(this.ships.get(n.api_ship_id)?.api_ship_id),
                completeAt: n.api_complete_time as number,
            }));
    }

    // 只列「建造中／完成待領取」（state 2/3）；已解鎖但空塢(0)或未解鎖(-1)不算需要關注的計時項目，
    // 與 missions()/ndocks() 只顯示進行中項目的慣例一致。
    kdocks(): KdockView[] {
        return this.kdockData
            .filter(k => k.api_state === 2 || k.api_state === 3)
            .map(k => ({
                id: k.api_id,
                state: k.api_state,
                ship: k.api_created_ship_id > 0 ? this.shipName(k.api_created_ship_id) : '?',
                completeAt: k.api_complete_time as number,
            }));
    }

    // ── 基地航空隊 ──────────────────────────────

    lbasAirPower(areaId: number, rid: number): { min: number; max: number } {
        const key = `${areaId}_${rid}`;
        const ab = this.airBases.get(key);
        let min = 0, max = 0;
        if (!ab) return { min, max };
        for (const sq of ab.api_plane_info ?? []) {
            if (sq.api_state !== 1 || sq.api_slotid <= 0) continue;
            const onslot = sq.api_count ?? 0;
            if (onslot <= 0) continue;
            const it = this.slotItems.get(sq.api_slotid);
            const g = it && this.masterGears.get(it.mst);
            if (!it || !g) continue;
            const t = g.cat;
            // 制空參與機種: 艦戦(6), 水戦(45), 局戦(56), 陸戦(57), 艦爆(7), 艦攻(8),
            //              水爆(11), 陸攻(47), 噴式戦闘爆撃機(39), 陸偵(49)
            const isF = t === 6 || t === 45 || t === 56 || t === 57;
            const isDB = t === 7;
            const isSPB = t === 11;
            const isLBA = t === 47;   // 陸攻
            const isLBR = t === 49;   // 陸偵
            if (!(isF || isDB || t === 8 || isSPB || isLBA || isLBR)) continue;
            // 改修補正：陸戦/局戦 +0.2★, 艦爆 +0.25★
            const aa = g.aa + (isF ? 0.2 * it.level : isDB ? 0.25 * it.level : 0);
            const alv = Math.min(7, it.alv);
            const tb = isF ? GameState.BONUS_F[alv] : isSPB ? GameState.BONUS_SPB[alv] : 0;
            const base = aa * Math.sqrt(onslot) + tb;
            min += Math.floor(base + Math.sqrt(GameState.EXP_LO[alv] / 10));
            max += Math.floor(base + Math.sqrt(GameState.EXP_HI[alv] / 10));
        }
        return { min, max };
    }

    airBases_(): AirBaseView[] {
        const result: AirBaseView[] = [];
        for (const [, ab] of this.airBases) {
            const squadrons: SquadronView[] = (ab.api_plane_info ?? []).map((sq: any) => {
                if (sq.api_state !== 1 || sq.api_slotid <= 0) {
                    return {
                        slotId: 0, state: sq.api_state ?? 2,
                        name: t('lbas.notDeployed'), short: '—', cat: 'c-etc', icon: -1, mst: 0,
                        level: 0, alv: 0,
                        count: 0, maxCount: sq.api_max_count ?? 0,
                        cond: sq.api_cond ?? 1,
                    };
                }
                const it = this.slotItems.get(sq.api_slotid);
                const g = it && this.masterGears.get(it.mst);
                const icon = GEAR_ICON[g?.icon ?? 0] ?? { s: '装', c: 'c-etc' };
                return {
                    slotId: sq.api_slotid,
                    state: sq.api_state,
                    name: g?.name ?? '?',
                    short: icon.s, cat: icon.c, icon: g?.icon ?? 0, mst: it?.mst ?? 0,
                    level: it?.level ?? 0, alv: it?.alv ?? 0,
                    count: sq.api_count ?? 0, maxCount: sq.api_max_count ?? 0,
                    cond: sq.api_cond ?? 1,
                };
            });
            const dist = ab.api_distance;
            const distance = (dist?.api_base ?? 0) + (dist?.api_bonus ?? 0);
            const airPower = this.lbasAirPower(ab.api_area_id, ab.api_rid);
            result.push({
                areaId: ab.api_area_id, rid: ab.api_rid,
                name: ab.api_name ?? `第${ab.api_rid}航空隊`,
                actionKind: ab.api_action_kind ?? 0,
                distance,
                squadrons,
                airPower,
            });
        }
        // 按 area_id → rid 排序
        result.sort((a, b) => a.areaId - b.areaId || a.rid - b.rid);
        return result;
    }

    actionLabel(kind: number): string {
        return kind >= 0 && kind <= 4 ? t(`ab.action.${kind}`) : t('ab.action.unknown', { n: kind });
    }

    condLabel(cond: number) {
        return cond === 1 ? t('cond.normal') : cond === 2 ? t('cond.tired') : cond === 3 ? t('cond.exhausted') : t('cond.unknown');
    }

    mapAreaName(id: number) {
        const name = this.masterMapAreas.get(id);
        if (name) return name;
        if (id === 6) return t('area.central');
        if (id === 7) return t('area.southwest');
        if (id > 10) return t('area.event');
        return t('area.generic', { n: id });
    }

    // 目前出擊海域的關卡進度（見 mapGauges 的驗證狀態註解）。無資料時回傳 null，
    // 面板端要處理「不顯示」。EO（拡張作戦）剩餘挑戰次數尚未實作——來源封包/欄位未知，
    // 待日後從待驗證清單取得樣本後補上。
    currentMapGauge(): MapGaugeView | null {
        if (!this.sortieInfo) return null;
        const id = this.sortieInfo.mapArea * 10 + this.sortieInfo.mapNo;
        return this.mapGauges.get(id) ?? null;
    }

    // 剩餘攻略次數估算。回傳 { runs, kind } 或 null（顯示端處理）。
    //   gaugeType 2（boss撃破型）：ceil(關卡殘HP / boss旗艦最大HP)。boss HP 需先實戰擊破一次才知。
    //   gaugeType 3（TP輸送型）：ceil(關卡殘量 / 出擊艦隊S勝利基本TP)。假設每次 S 勝利揚陸。
    //     ⚠️ gaugeType 3 的量表欄位結構尚無真實封包驗證（缺輸送海域樣本），為 best-effort；
    //        wantedTag 會擷取 gaugeType 3 的 mapinfo 供日後校正。
    mapRemainingRuns(): { runs: number; kind: 'boss' | 'tp' } | null {
        const g = this.currentMapGauge();
        if (!g || g.maxHp <= 0 || g.maxHp === 9999) return null;
        const mapId = this.sortieInfo!.mapArea * 10 + this.sortieInfo!.mapNo;
        if (g.gaugeType === 2) {
            const bossHp = this.mapBossHp.get(mapId);
            if (!bossHp || bossHp <= 0) return null;
            return { runs: Math.max(0, Math.ceil(g.nowHp / bossHp)), kind: 'boss' };
        }
        if (g.gaugeType === 3) {
            const tp = this.fleetTP(this.currentSortieFleetId).total;
            if (tp <= 0) return null;
            return { runs: Math.max(0, Math.ceil(g.nowHp / tp)), kind: 'tp' };
        }
        return null;
    }

    // ── 待驗證封包自動偵測 ──────────────────────────────
    // 對照 CLAUDE.md「已驗證 vs 待驗證」表。命中時回傳人類可讀分類，
    // 呼叫端（main.ts）負責把該筆事件記進 db.wanted，供「動態」分頁直接複製匯出。
    // 只在收到當下呼叫一次即可，不用管重播（main.ts 會控制只在 live 事件呼叫）。
    wantedTag(path: string, api: any): string | null {
        // 自軍聯合艦隊戰鬥：path 本身就是訊號，不需要額外欄位判斷
        if (path.startsWith('api_req_combined_battle/') && !path.endsWith('result') && api?.api_f_nowhps) {
            return t('wanted.tagCombinedBattle');
        }
        // 基地空襲：api_destruction_battle 結構未驗證（sorties 歸檔目前 best-effort 讀取）
        if (path === 'api_req_map/next' && api?.api_destruction_battle) {
            return t('wanted.tagBaseRaid');
        }
        // 大漩渦候選：已知海域的節點移動封包（見 UZUSHIO_MAPS 定義的來源與限制）
        if (path === 'api_req_map/next' && this.sortieInfo
            && UZUSHIO_MAPS.has(`${this.sortieInfo.mapArea}-${this.sortieInfo.mapNo}`)) {
            return t('wanted.tagUzushio');
        }
        // 支援艦隊攻擊：戰鬥封包自帶 api_support_flag，觸發時附完整 api_support_info 結構
        if ((path.startsWith('api_req_sortie/battle') || path.startsWith('api_req_combined_battle/')
            || path.startsWith('api_req_battle_midnight/'))
            && !path.endsWith('result') && (api?.api_support_flag ?? 0) > 0) {
            return t('wanted.tagSupportFleet');
        }
        // 友軍艦隊：活動海域 boss 夜戰封包含 api_friendly_battle（友軍對敵傷害）
        if ((path.startsWith('api_req_combined_battle/') || path.startsWith('api_req_battle_midnight/'))
            && !path.endsWith('result') && api?.api_friendly_battle) {
            return t('wanted.tagFriendlyFleet');
        }
        // 海域資訊 mapinfo：主結構已驗證。仍待驗證的兩項，偵測到就抓樣本（各限 3 次）：
        //   (a) TP輸送型量表（gaugeType 3）——TP 剩餘次數的量表欄位結構未驗證，最想要
        //   (b) EO 的 api_sally_flag（剩餘挑戰次數語意未知），供比對攻略前後變化
        //   (c) 斬殺（量表擊破）當下的 mapinfo——HP量表歸 0，供校正面板 detectClear 的
        //       「未擊破→擊破」轉變偵測（判定欄位已實測，但轉變 mapinfo 本身尚無真封包）
        if (path === 'api_get_member/mapinfo' && this.mapinfoSampleCount < 3
            && Array.isArray(api?.api_map_info)) {
            const hasTP = api.api_map_info.some((m: any) => m?.api_gauge_type === 3);
            const hasSally = api.api_map_info.some((m: any) => Array.isArray(m?.api_sally_flag));
            const hasClear = api.api_map_info.some((m: any) => m?.api_gauge_type === 2
                && (m?.api_eventmap?.api_now_maphp === 0) && (m?.api_eventmap?.api_max_maphp ?? 0) > 0);
            if (hasTP || hasSally || hasClear) {
                this.mapinfoSampleCount++;
                const kind = hasClear ? t('wanted.tagKindClear') : hasTP ? t('wanted.tagKindTP') : t('wanted.tagKindSally');
                return t('wanted.tagMapinfoSample', { kind, n: this.mapinfoSampleCount });
            }
        }
        // ── 出撃札驗證鉤子（兩條，見 CLAUDE.md「活動作戰板」）─────────────────
        // 現況：api_sally_area 欄位名已用真封包確認，但手上所有樣本都取自非活動期，
        // 值全為 0——札 id 的實際語意、以及「札名是否存在於任何封包」皆未實測。
        // 下列兩條在活動期間會自動撈到真封包，拿到後即可定案，屆時回頭更新本註解。
        //
        // (a) 首見「有船帶著札」的艦娘清單封包。api_port/port 是全量重建（見上方
        //     reducer），ship2/ship3/ship_deck 是否仍在使用尚未實測，故一併納入條件——
        //     真的還在送就會自己浮出來，同時驗證它們帶不帶 api_sally_area。
        if (this.sallySampleCount < 2 && Array.isArray(api?.api_ship)
            && (path === 'api_port/port' || path === 'api_get_member/ship2'
                || path === 'api_get_member/ship3' || path === 'api_get_member/ship_deck')
            && api.api_ship.some((s: any) => Number(s?.api_sally_area) > 0)) {
            this.sallySampleCount++;
            return t('wanted.tagSallyArea', { path, n: this.sallySampleCount });
        }
        // (b) 未知的 sally 系欄位。已知只有 api_sally_area（艦上的札 id）與 api_sally_flag
        //     （mapinfo，語意未解）；若活動期間任何封包冒出第三個 sally 系 key，那就是
        //     札名／札定義表最可能的所在，立刻擷取。查不到也是有效結論——可據以定案
        //     「札名不在 API 裡，只能手動命名」，見 utils/event-plan.ts 檔頭。
        if (this.sallyKeySampleCount < 3) {
            const key = findUnknownSallyKey(api);
            if (key) {
                this.sallyKeySampleCount++;
                return t('wanted.tagSallyKey', { key, path });
            }
        }
        return null;
    }
}

// 已知的 sally 系欄位。出現在這之外的 sally 系 key＝札名驗證鉤子的命中目標（見 wantedTag）。
const KNOWN_SALLY_KEYS = new Set(['api_sally_area', 'api_sally_flag']);

/**
 * 淺層搜尋未知的 sally 系欄位名，命中回傳該 key，否則 null。
 * 深度上限 3、陣列只看首元素——start2 這種 1MB＋、含 1751 艘艦的封包每筆都會經過這裡，
 * 不能全走訪。深度 3 足以涵蓋「新增的頂層 master 表」與「既有表元素上的新欄位」兩種形態。
 */
function findUnknownSallyKey(node: unknown, depth = 0): string | null {
    if (depth > 3 || node == null || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.length ? findUnknownSallyKey(node[0], depth + 1) : null;
    for (const [k, v] of Object.entries(node)) {
        if (k.toLowerCase().includes('sally') && !KNOWN_SALLY_KEYS.has(k)) return k;
        const hit = findUnknownSallyKey(v, depth + 1);
        if (hit) return hit;
    }
    return null;
}
