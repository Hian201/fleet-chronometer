import RAW_EXPED from './expedition-data';
import { analyzeBattle, taihaFlags } from './battle';
import { localizeShip, localizeGear } from './gamedata-i18n';
import { t } from './ui-i18n';
import { resolveQuestGoal, meetsRank, type QuestActionKind, type QuestGoal } from './quest-progress';
import { collectLandingCraftGears, computeExpeditionBonus, applyExpeditionBonus } from './expedition-bonus';
import {
    LBAS_COND_EXHAUSTED, LBAS_COND_MILD, LBAS_COND_TIRED,
    lbasCondCertainty, lbasCondDowngrade, lbasRecoveryRate,
} from './lbas-cond';
import { lookupMaelstromLoss, MAELSTROM_RADAR_CATS } from './maelstrom-data';
import { planMaelstromLosses, readMaelstromHappening, type MaelstromShipSnap } from './maelstrom';

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
    /** true＝出擊條件已核對（ElectronicObserver `MissionClearCondition.cs`），但
     * `reward_fuel/bullet/steel/alum` 尚無可信來源、僅為佔位 0。`reward_items` 不受影響
     * （直接來自封包 `api_win_item1/2`，即使條件未收錄的遠征也一樣是封包事實）。 */
    rewardAmountsUnverified?: boolean;
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
// countEst：`count`（搭載數）是出擊途中的**估算值**而非封包實數（見
// GameState.queuePlaneLoss／spreadPlaneLoss）。UI 必須據此標示，回港後即恢復為 false。
export interface GearView { mst: number; name: string; short: string; cat: string; type: number; asw: number; icon: number; level: number; alv: number; count?: number; countMax?: number; countEst?: boolean }
export interface ShipView {
    name: string;
    // nameJa：封包原始日文艦名（api_mst_ship 的 api_name）。面板以譯名顯示，hover 才
    // 給原名——譯名查得到的船在遊戲畫面上長的是原名，對照時需要看得到它。master 未載入
    // 時退回 name（不留空字串，避免 tooltip 顯示成空白）。
    nameJa: string;
    stype: string; lv: number; hp: number; maxhp: number; cond: number;
    fuel: number; maxFuel: number; bull: number; maxBull: number;
    // 火力／運＝艦實例的顯示素質（api_karyoku[0]／api_lucky[0]，**已含裝備加成**，
    // 與 ownedShips() 的 stats 同一份封包事實）。艦隊全覽的艦卡要顯示運、艦隊列要顯示
    // 火力合計，故一併帶進 view，不讓顯示層自己去 ownedShips() 反查 id（那會為了兩個
    // 數字重算全鎮守府的裸素質與可裝備表）。缺欄位一律 0＝不可考，不猜。
    firepower: number; luck: number;
    // mst／stypeId：艦 master id 與艦種 id。僅有艦種縮寫字串無法判定
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
    // 入渠完成時刻（api_ndock 的 api_complete_time，毫秒）。未入渠為 null。
    dockCompleteAt: number | null;
    // 本次出擊已由艦隊司令部施設退避：已離開艦隊，不再參戰，也不計入該隊的
    // 等級／制空／索敵／TP（見 GameState.escapedShipIds）。回港即歸零。
    escaped: boolean;
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
    // 出擊標籤（api_sally_area）。0＝無標籤；>0＝已被貼上該 id 的標籤。欄位已用真封包確認
    // （samples/slot_to_port.json 每艘 api_ship 末三欄 api_locked/api_locked_equip/
    // api_sally_area），但樣本取自非活動期故值全為 0——「id N 對應遊戲裡哪個標籤」的語意
    // 尚未實測。只透出遊戲給的數字，標籤名 API 不提供，見 utils/event-plan.ts 檔頭。
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
    // 已由艦隊司令部施設退避（不再參戰）。缺席＝否，讓既有的手捏測資不必補欄位。
    escaped?: boolean;
    // 機制上不會被擊沉（目前只有連合艦隊的第二艦隊旗艦）。見 battle.ts takeDamage。
    unsinkable?: boolean;
}
export interface BattleFleetView {
    playerMain: BattleShipView[];
    playerEscort: BattleShipView[];
    enemyMain: BattleShipView[];
    enemyEscort: BattleShipView[];
}

/** 戰鬥記錄用的單艘 HP 快照。null 代表原始封包該位置沒有艦。 */
export interface BattleHpView {
    hp: number;
    maxHp: number;
    sunk: boolean;
}

/** 戰鬥記錄用的四隊 HP 快照，保留有效艦的先後順序，供時間線與編成對齊。 */
export interface BattleHpSnapshot {
    playerMain: (BattleHpView | null)[];
    playerEscort: (BattleHpView | null)[];
    enemyMain: (BattleHpView | null)[];
    enemyEscort: (BattleHpView | null)[];
}

/**
 * 原始戰鬥封包中的交戰階段。這些名稱只描述封包結構，不延伸推測遊戲沒有送出的細節。
 * packet 是 apiList 的位置：0 通常為晝戰，1 通常為夜戰；保留原始位置供 UI 誠實標示。
 */
export type BattlePhaseKind =
    | 'jetBase' | 'landBase' | 'jet' | 'air' | 'airSecond'
    | 'supportAir' | 'supportShell' | 'supportTorpedo' | 'supportAsw'
    | 'openingAntiSub' | 'openingTorpedo'
    | 'shelling1' | 'shelling2' | 'shelling3' | 'torpedo'
    | 'friendlyShelling' | 'friendlyTorpedo' | 'nightShelling';

export type BattleEventSide = 'player' | 'enemy' | 'friendly';
export type BattleDamageKind = 'ship' | 'torpedo' | 'air' | 'landBase' | 'support';

/**
 * 交戰流程中的一筆原始傷害事件。砲擊／夜戰／雷擊在封包提供攻擊陣列時保留攻擊方與目標位置；
 * 航空、陸航、支援的封包仍以階段來源表示，沒有逐艦索引時以 null 表示，禁止猜測個別艦載機歸屬。
 * critical 只有封包帶有命中判定欄位時才會填入；支援砲擊的 2 代表暴擊，1 代表一般命中。
 * attackType／specialType／attackSlots 是同一筆砲擊或夜戰攻擊的原始攻擊欄位：
 * `api_at_type[i]`、`api_sp_list[i]`、`api_si_list[i]`。它們只保存封包明示的代碼與
 * 裝備 master id；攻擊名稱由顯示層依已載入的裝備類別辨識，無法辨識時保留原始代碼。
 */
export interface BattleDamageEvent {
    kind: BattleDamageKind;
    attackerSide: BattleEventSide | null;
    attackerIndex: number | null;
    defenderSide: BattleEventSide | null;
    defenderIndex: number | null;
    damage: number;
    critical: boolean | null;
    /** `api_at_type[i]`；沒有此欄位時為 null。 */
    attackType: number | null;
    /** `api_sp_list[i]`；沒有此欄位時為 null。 */
    specialType: number | null;
    /** `api_si_list[i]` 中可辨識的正數 master id；-1／缺席不補成裝備。 */
    attackSlots: number[];
    beforeHp: number | null;
    afterHp: number | null;
    maxHp: number | null;
    sunk: boolean;
}

export interface BattlePhaseView extends BattleHpSnapshot {
    kind: BattlePhaseKind;
    packet: number;
    /** ownDamage＝我方受到的傷害；enemyDamage＝敵方受到的傷害。皆依既有 parser 切捨。 */
    ownDamage: number;
    enemyDamage: number;
    /** 依該階段原始封包順序排列；空陣列代表封包沒有可辨識的逐筆傷害欄位。 */
    events: BattleDamageEvent[];
}

/** 夜戰開始時由封包／出擊快照確認的夜戰裝備效果。 */
export interface BattleNightEffectsView {
    /** `api_flare_pos[0]` 指向我方照明彈使用位置。 */
    starShell: boolean;
    /** 夜戰封包的我方 `api_touch_plane[0]` 是夜偵 master id。 */
    nightRecon: boolean;
    /** 探照燈已由出擊快照與夜戰時機確認，或攻擊欄明確帶出。 */
    searchlight: boolean;
}

export interface BattleInfoView {
    resultFleets: BattleFleetView | null;
    rank: string;
    mvp: number[];       // [mainMVP, escortMVP]
    // 有「進擊會被轟沈」的艦。不含主隊旗艦（改由 flagshipTaiha 表達）、第二艦隊旗艦
    // （不會被擊沉）與已退避艦，詳見 battle.ts 的判定說明。
    isTaiha: boolean;
    // 主隊旗艦大破＝遊戲禁止進擊、強制返航。
    flagshipTaiha: boolean;
    // 旗艦身上尚未消耗的損管（0無／1応急修理要員／2応急修理女神）；>0 時結算後
    // 可選擇使用以突破「旗艦大破不能進擊」的限制。非旗艦大破時恆為 0。
    flagshipDamecon: number;
    enemyIds: number[];        // 敵主隊 master id（與 enemyMain 同序）
    enemyIdsEscort: number[];  // 敵隨伴 master id（與 enemyEscort 同序；聯合艦隊時）
    // 敵艦等級／素質／裝備，與上面兩個 id 陣列同序（見 BattleEnemyShipView）。
    enemyDetail: { main: BattleEnemyShipView[]; escort: BattleEnemyShipView[] };
    formation: number[]; // [player, enemy, engagement]
    seiku: number; // 0=互角, 1=確保, 2=優勢, 3=劣勢, 4=喪失
    // `api_search[0]`：1–3 為我方發現、4–6 為未發現；其他值或缺席不作推論。
    search?: 'success' | 'failed' | 'unknown';
    touchPlane: number[]; // [player, enemy]
    planes: {
        playerFighter: { count: number, lost: number },
        playerBomber: { count: number, lost: number },
        enemyFighter: { count: number, lost: number },
        enemyBomber: { count: number, lost: number }
    };
    drop: string | null;
    // 這次掉落是不是本鎮守府還沒有的船（以基礎形態比對，見 GameState.ownsShip）。
    // 沒有掉落時恆為 false。判定必須在 battleresult 當下做——見寫入處的說明。
    dropIsNew: boolean;
    supportFlag: number;
    aaci: number; // 0 if none, else AACI kind ID
    midnightFlag: boolean;
    /** 夜戰裝備發動標記；舊手捏測資可能沒有此欄位。 */
    nightEffects?: BattleNightEffectsView;
    /** `enemyIds` 中每個 master id 在封包 `api_ship_ke` 的原始位置；供逐筆事件反查名稱。 */
    enemyPositions?: number[];
    /** `enemyIdsEscort` 對應 `api_ship_ke_combined` 的原始位置。 */
    enemyPositionsEscort?: number[];
    // 友軍艦隊編成（master id）；活動海域 boss 夜戰才可能出現，其餘一律 null。
    // 已用 samples/61-3.json 驗證 api_friendly_info/api_friendly_battle 同層出現。
    friendlyFleetIds: number[] | null;
    // 基地航空隊這一節點的戰果；沒有出擊（無 api_air_base_attack）時為 null。
    lbas: BattleLbasView | null;
    // 支援艦隊這一節點的戰果；沒有支援出動（無 api_support_info）時為 null。
    support: BattleSupportView | null;
    hasResult: boolean;
    /** 戰鬥記錄用的階段後 HP 快照；舊測資／手動建立的 view 可能沒有此欄位。 */
    timeline?: { initial: BattleHpSnapshot; phases: BattlePhaseView[] };
}
/**
 * 單艘敵艦的等級／素質／裝備（戰鬥封包欄位，見 battle.ts `readEnemyDetail` 的驗證說明）。
 * 缺席一律回可辨識的空值（lv 0／param null／slots 空陣列），呼叫端顯示「不可考」，不補猜測值。
 */
export interface BattleEnemyShipView {
    /** `api_ship_lv`；0＝封包沒帶或不可考。 */
    lv: number;
    /** `api_eParam`＝[火力, 雷裝, 對空, 裝甲]；null＝封包沒帶。 */
    param: number[] | null;
    /** `api_eSlot` 的裝備 master id（已去掉 -1 空格）。 */
    slots: number[];
}
/**
 * 支援艦隊在單一節點的戰果。`api_support_info` 底下 `api_support_airatack`（航空支援類）
 * 與 `api_support_hourai`（砲擊支援類）擇一非 null，兩者都帶 `api_deck_id` 與
 * `api_ship_id[]`（**艦實例 id 不是 master id**）——已用 samples/61-3.json（砲擊）與
 * 61-5-jibun-rengou-node52.json（航空）驗證。
 *
 * `api_damage`／`api_cl_list` 逐格對應敵艦位置：敵單艦隊封包會在第 0 格保留一個
 * 佔位，敵聯合艦隊則直接使用主隊 0–5、隨伴 6–11；analyzeBattle 會先正規化成同一套
 * 0-based 位置，再套用 HP 並交給 UI 顯示艦名。`damage` 仍保留整場支援傷害合計供摘要使用。
 */
export interface BattleSupportView {
    /** 'air'＝航空支援／'shelling'＝砲擊支援／'torpedo'＝雷擊支援／'asw'＝對潛支援。 */
    kind: 'air' | 'shelling' | 'torpedo' | 'asw';
    /** 支援艦隊的編成編號（`api_deck_id` 原值；缺席為 0＝不可考）。 */
    deckId: number;
    /** 對敵造成的傷害合計（與 applyDmg 實際套用的是同一批欄位）。 */
    damage: number;
    /** 支援艦隊成員的**艦實例 id**（呼叫端負責反查名稱）。 */
    shipIds: number[];
}
/**
 * 基地航空隊在單一節點的戰果彙總。欄位皆為封包事實，已用真封包核對
 * （samples/61-3.json、61-4.json、61-5-jibun-rengou-node52.json、6-5-ec_battle.json）：
 *   · `api_air_base_attack` 是**陣列**，一波一個元素（基地防空的同名欄位是物件，走別條路徑）。
 *   · `api_stage1.api_f_count`＝該波出擊機數、`api_f_lostcount`＝制空戰損失；
 *     `api_stage2.api_f_lostcount`＝對空砲火損失。兩段都要算，只讀 stage1 會少報。
 *   · 對敵傷害在 `api_stage3.api_edam`（敵主隊）與 `api_stage3_combined.api_edam`
 *     （敵隨伴），**可能帶小數**（實測 0.1），與其他傷害欄一致先切捨再加總。
 *   · `api_base_id` 在部分封包缺席（6-5 ec_battle 樣本就沒有），缺席一律記 0＝不可考，
 *     不猜是第幾基地。
 */
export interface BattleLbasView {
    /** 出擊機數合計。 */
    sent: number;
    /** 損失機數合計（制空戰＋對空砲火）。 */
    lost: number;
    /** 對敵造成的傷害合計。 */
    damage: number;
    /**
     * 逐波明細（順序即封包順序），供面板 tooltip 展開。
     * `seiku`＝該波的制空狀態（`api_stage1.api_disp_seiku`，0互角/1確保/2優勢/3劣勢/4喪失）；
     * `null`＝這一波沒有制空戰（雙方都沒出動艦載機時遊戲照樣送 `api_disp_seiku: 1`，
     * 直接照抄會誤報「確保」，判準與主隊航空戰一致：兩軍機數合計為 0 就是沒有航空戰）。
     */
    waves: { baseId: number; sent: number; lost: number; damage: number; seiku: number | null }[];
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
// 關卡進度。已用 api_get_member/mapinfo、api_req_map/select_eventmap_rank
// 與 api_req_map/start 的封包結構驗證兩種量表類型：
//   gaugeType 1：擊破數式（一般圖5番艦隊決戦等）— api_defeat_count / api_required_defeat_count
//   gaugeType 2：HP量表式（活動圖／EO 拡張作戦等）— api_eventmap.api_now_maphp / api_max_maphp
//     （mapinfo 的 9999/9999 是尚未取得實際量表時的佔位值；選定難度的回應與出擊起點
//      回應會提供該難度的實際總 HP，不能只以先前的 mapinfo 快照判定。）
export interface MapGaugeView {
    cleared: boolean;
    gaugeType: number;   // 0=無量表, 1=擊破數式, 2/3=HP量表式
    defeatCount: number;
    requiredDefeatCount: number;
    nowHp: number;
    maxHp: number;
    // api_eventmap.api_selected_rank；由選難度請求的 api_rank 與 mapinfo 同步。沒有這兩者
    // 的有效值時一律為 0，不能從其他 event-map 欄位推測。
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
// createship（建造發起）回應不含投入量；api_get_member/kdock 的渠物件帶
// api_item1~api_item5，分別表示燃彈、鋼、鋁與開發資材的實際投入。封包沒有標示大型建造
// 的布林欄位，BuildStartView 直接呈現這些數字；applyEvent 以 created_ship_id 變化辨識新建造，
// 並涵蓋 state 2 與 3。api_item1~5 維持建造投入量，不因高速完工改變；高速建造材的消耗量
// 未由 createship_speedchange 回應提供，故不推定。
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
// missionId＝遠征 master id（`api_mission[1]`）。顯示層要靠它辨識活動限定的支援遠征
// （301/302），dispNo 是給人看的字串、不當鍵用。
/**
 * 退避成立的編制種類（見 GameState.retreatAvailability）。三顆司令部系裝備各自綁定一種
 * 編制，`combined` 是護衛退避（大破艦＋一艘健康驅逐艦一起離場），另兩種是單艦退避
 * （只有大破艦離場、不需要護衛艦）。
 */
export type RetreatFacilityKind = 'combined' | 'striking' | 'torpedo';
export interface RetreatAvailability {
    state: 'none' | 'ready' | 'noEscort';
    /** 成立的是哪一顆司令部；`state === 'none'` 時為 null。 */
    kind: RetreatFacilityKind | null;
}
/**
 * 退避位置（結算封包的 1-based 位置）解出來的「哪一艘、在哪一隊的第幾格」。
 * escapedShipIds 與 battleInfo.resultFleets 兩邊都要標到同一格，故一起帶著走
 * （見 GameState.shipAtSortiePos 的說明）。
 */
interface EscapeSlot { id: number; escort: boolean; index: number }
export interface MissionView { fleet: string; missionId: number; dispNo: string; name: string; completeAt: number }
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
    // `api_cond` 是面板用的狀態碼，不是遊戲內部 0–46 的疲勞值。
    // 0/1=無標記、2=黃標記、3=紅標記；其餘值保留為未知，避免猜測。
    cond: number | null;
}
export interface AirBaseView {
    areaId: number; rid: number;
    name: string;
    actionKind: number;     // 0=待機, 1=出擊, 2=防空, 3=退避, 4=休息
    distance: number;       // 作戰半徑 (base + bonus)
    squadrons: SquadronView[];
    airPower: { min: number; max: number };
    // 疲勞（`SquadronView.cond`）是這個時刻的觀測值，不是「現在」的值——遊戲的疲勞回復
    // 不推封包（見 utils/lbas-cond.ts）。null＝沒看過任何帶 plane_info 的封包。
    condAsOf: number | null;
    // 自 `condAsOf` 起看過的最慢回復速度（每 3 分鐘 tick 的回復量）
    condRate: number;
}

/**
 * 基地航空隊的唯一鍵＝**海域(maparea) id ＋ rid**，就是 `GameState.airBases` 的 map key
 * 本身——所有組鍵處一律呼叫這一支，避免不同分隔符造成查詢失敗。
 *
 * ⚠️ **rid 單獨不是唯一鍵**：rid 是「該海域的第幾個基地」，中部海域與活動海域各自都有
 * 第一/第二/第三基地航空隊。若只用 rid，來自不同海域的基地會互相覆蓋，造成海域名稱與
 * 顯示範圍錯配；**任何以基地為單位的資料結構都必須使用複合鍵**——要嘛用
 * 這支的複合鍵，要嘛以「海域」為單位（顯示範圍開關就是走後者，見
 * entrypoints/overview/lib.ts 的 FleetMarkdownScope）。
 */
export const airBaseKey = (b: { areaId: number | string; rid: number | string }): string =>
    `${b.areaId}_${b.rid}`;

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

// 會在航空戰（制空戰 stage1 ／對空砲火 stage2）折損的艦載機類別，即實際出擊參戰的
// 那幾類：6艦戰 7艦爆 8艦攻 11水爆 45水戰 56-58噴式機。偵察機系（9艦偵/10水偵/
// 41大艇）與對潛機系（25回轉翼/26對潛哨戒）只做觸接／索敵／對潛，不編入航空戰的
// 出擊機數，故不分攤損失。**這是機制轉寫（wikiwiki 航空戰頁），非封包欄位事實**，
// 只用於 spreadPlaneLoss 的估算分攤（見該方法說明）。
const AIR_COMBAT_CATS = new Set([6, 7, 8, 11, 45, 56, 57, 58]);

// 制空値の「機種類型加成」對象（`BONUS_F`／`BONUS_SPB` 查表，依熟練度階級）。
// 依日wiki「艦載機熟練度」：**艦戦・水戦・陸戦・局戦**吃戰鬥機表、**水爆**吃水爆表，
// **艦攻・艦爆・噴式機・陸攻・全偵察機一律 0**。
//
// ⚠️ 分類必須維持：56／57 是**噴式戦闘機／噴式戦闘爆撃機**，真正的局地戦闘機是
// **48**。戰鬥機表只套用艦戦（6）、水戦（45）與局戦／陸戦（48）；噴式機不套用這組
// 機種類型加成，否則會同時漏算局戰制空並誤加噴式機加成。
const AIR_TB_FIGHTER = new Set([6, 45, 48]);   // 艦戦・水戦・局戦（＝陸戦）
const AIR_TB_SEAPLANE_BOMBER = 11;             // 水爆
// 制空値の改修★補正：艦戦・水戦・局戦 +0.2×★、艦爆 +0.25×★。噴式機的★補正**未經
// 查證**，噴式機目前套用 0.2×★；機種類型加成與改修補正分開計算。
const AIR_IMP_FIGHTER = new Set([6, 45, 48, 56, 57]);

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
    // baseShipId() 的結果快取。輸入只有上面兩張 master 表（start2 之後就不再變動），故
    // 快取只需在 start2 重建它們時清空。**沒有快取會很痛**：ownsShip() 每次打撈都要對
    // 全名冊（常 300-500 艘）各跑一次帶 visited 的圖搜尋，而 battleresult 在面板啟動
    // 重播時會逐筆重跑，成本再乘上歷史結算筆數；艦娘全覽也是每艘各查一次。
    private baseShipIdCache = new Map<number, number | null>();
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
    // `api_get_member/mapinfo.api_air_base_expanded_info[]`：以海域 area_id 為單位的
    // 基地整備等級（api_maintenance_level），不是個別航空隊或中隊的 api_level。
    // 本專案尚未有原始封包樣本，欄位與範圍以公開檢視器的封包處理及遊戲 UI 機制交叉確認；
    // 因此只保存封包明示的原始整數，缺席維持不可考，絕不以 0 補值。
    airBaseMaintenanceLevels = new Map<number, number>();
    // 中隊疲勞（api_cond）是**觀測時刻的快照**：遊戲的疲勞回復在伺服器端每 3 分鐘進行一次，
    // 且回復時不推任何封包（見 utils/lbas-cond.ts）。故必須記住「這份 cond 是什麼時候的」，
    // 否則面板會一直掛著遊戲裡早就消失的疲勞標記。key 同 airBases。
    airBaseCondAsOf = new Map<string, number>();
    // 自上述時刻起、該基地出現過的**最慢**回復速度（札會被玩家中途改掉；取最慢＝保守，
    // 只會晚一點才判定回復完成，不會提早）。key 同 airBases。
    airBaseCondMinRate = new Map<string, number>();
    lastDayBattle: any = null;
    // `lastDayBattle` 當下（＝晝戰開打前）的損管狀態。夜戰接續會把晝戰封包整場重放一次，
    // 損管必須用**那一刻**的值：晝戰觸發過損管的艦已被記進 damaconUsed，若在夜戰重算
    // getPlayerDamecons()，重放晝戰傷害時那艘船會沒有損管可用而被誤判轟沈（連帶洗掉
    // 血量與 rank）。故與 lastDayBattle 成對保存、成對清空。
    private lastDayDamecons: { main: number[]; escort: number[] } | null = null;
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
    // 同一活動海域可能有多個 Boss 節點；保存已實戰觀測到的最高旗艦 HP，避免後打到的
    // 較低 HP 旁支 Boss 把斬殺線覆蓋掉。面板重開時會由持久化 replays＋sorties 恢復。
    mapBossHp = new Map<number, number>();          // key 同上：已觀測 Boss 旗艦最大HP
    private sallyKeySampleCount = 0;  // 未知 sally 系欄位樣本擷取次數上限（標籤名驗證鉤子）
    private maelstromUnknownCount = 0; // 渦潮表外節點樣本上限（查表未收錄時才抓）
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
    // 本節點各航空戰段待套用的艦載機損失架數（與 pendingConsumption 同一個 pattern，
    // 生命週期也完全一致）。**交戰途中不寫回**：寫回會讓編成的制空在打到一半時往下掉，
    // 但戰鬥中要看的正是「這一場交戰時的制空」。結算（battleresult）才逐段套用。
    private pendingPlaneLoss: number[] = [];
    // 応急修理要員／女神本場出擊已觸發過的艦（key: 艦實例 id）。遊戲不會在節點之間重送裝備
    // 欄位，故 getDamecon() 單看目前裝備欄位無法分辨「還沒用過」與「已經用掉、封包只是還沒
    // 反映」——同一艘船在下個節點又被打到 0 血時會誤判成再次獲救（甚至連帶壓下大破警告，見
    // battle.ts isTaiha 的 damecon===0 判斷），而非正確判定轟沈。故額外記本場出擊已消耗的艦，
    // 於 api_req_map/start 歸零（見下方分支）。
    private damaconUsed = new Set<number>();
    // 本場出擊觸發過応急修理女神的艦（key: 艦實例 id）。女神除了 HP 全快，燃彈也全快，
    // 但燃彈消耗是在 battleresult 才一併寫回（見 applyConsumption），所以不能在戰鬥封包
    // 當下就補滿——會被緊接著的消耗再扣一次。改在 battleresult 套完消耗後補，然後清空。
    private goddessRestored = new Set<number>();

    // ── 退避（艦隊司令部施設）────────────────────────────────────────────
    // 本次出擊已退避的艦（艦實例 id）。退避艦離開艦隊：不再參戰、不再消耗燃彈，
    // 該隊的等級／制空／索敵／TP 一律按剩下的船重算（七艘退避一艘就是六艘繼續進擊）。
    // api_req_map/start 與 api_port/port 清空。
    //
    // inspired by KC3Kai `SortieManager.checkFCF`／`sendFCFHome`（MIT）：
    // `api_escape_idx`／`api_tow_idx` 陣列可能列多艘候補，但一場只退一艘——**只取各陣列
    // [0]**；索引 1-based，連合時 >6 屬第二艦隊。缺欄位就不標（維持大破警告）。
    escapedShipIds = new Set<number>();
    // 最近一次 battleresult 收斂後的退避位置，要等 goback_port 才算數。
    private pendingEscape: { escape: number; tow: number | null } | null = null;

    // ── 出擊途中的艦載機戰損（估算）──────────────────────────────────────
    // 本次出擊已被 spreadPlaneLoss 估算調整過搭載數的艦（艦實例 id）。這批艦的
    // api_onslot 已經不是封包實數而是估算值，UI 必須標示（見 ShipView.gears 的
    // GearView.countEst）。api_req_map/start 與 api_port/port 清空——回港的
    // api_port/port 會帶實數搭載，那一刻起又是封包事實。
    private planeLossEstimated = new Set<number>();

    // ── 熟練度（api_alv）過時旗標 ────────────────────────────────────────
    // 艦載機被擊墜之後熟練度會下降，制空值跟著掉（`airPower()` 的 BONUS_F／EXP_LO/HI
    // 三項都吃 alv）。但**沒有任何一個出擊中／回港的封包帶熟練度**：已逐一查證
    // `api_port/port`（samples/slot_to_port.json：只有 api_ship，無 slotitem）與
    // `battleresult`（samples/6-5-ec_result.json：只有 rank/掉落/經驗/MVP）皆不帶。
    // `slotItems` 只有 `api_get_member/require_info`（登入）與
    // `api_get_member/slot_item`（開裝備畫面等）會整批刷新。
    //
    // 也就是說：撈完回港之後，遊戲裡的熟練度已經掉了，本擴充卻還握著出擊前那份，
    // **制空會顯示偏高的舊值，直到遊戲再送一次帶裝備資料的封包**。
    //
    // 這個集合記的是「熟練度可能已經不準」的**裝備實例 id**（逐格而非逐艦）：哪幾格真的
    // 被擊墜過就只標那幾格；整批 `require_info`／`slot_item` 刷新才一次清掉。
    // ⚠️ ship3／ship_deck 的 `api_slot_data` **不是**裝備＋alv（KC3Kai／EO：等同 unsetslot），
    // 不可拿來消過時標記。
    //
    // ⚠️ 刻意**不推算掉了多少**：制空公式本身早就實作好了（見 airPower()），缺的是輸入值
    // alv——部分損耗的下降量 wiki 沒給公式。誠實標示「可能偏高，開一次裝備庫即校正」。
    private alvStaleGears = new Set<number>();
    /** 任何一格的熟練度可能已過時（＝制空可能偏高）。 */
    get alvStale(): boolean { return this.alvStaleGears.size > 0; }

    // 出擊當下各艦載機格的搭載數（裝備實例 id → 架數）。**熟練度是在「回港那一刻」依
    // 「出撃時の残数 vs 帰投時の残数」結算的**（日wiki 艦載機熟練度），不是每場戰鬥即時
    // 掉——所以出擊途中我們手上的 alv 其實還是對的，回港才開始不準。兩端的搭載數都要
    // 留著才比得出來：出擊時這一份是母港封包的實數（尚未被 spreadPlaneLoss 的估算動過），
    // 回港那一份直接取母港封包。api_req_map/start 重建，回港結算完清空。
    private sortieStartOnslot = new Map<number, number>();

    // ── 抵達 boss 節點當下的大破狀態 ────────────────────────────────────
    // `null`＝這次出擊還沒踏進 boss 節點（也包含面板中途才開、沒看到那一步的情況）。
    //
    // 用途：**純顯示層的版面決策**，不參與任何大破判定。boss 是路線最後一個節點，之後
    // 沒有節點可以進擊，使用者沒有「要不要進擊」要決定，面板因此不必把警告展開成遮蔽式
    // 大框（警告本身照樣顯示）。**這不代表 boss 的大破無害**——大破進王一樣會被轟沈，
    // 夜戰也照樣可能被打沉；不展開的理由只有「沒有下一個節點」這一條。
    // 但「進 boss 之前就已經大破」是另一回事——那是玩家自己冒險帶傷進來的，照舊大聲講。
    //
    // **只在第一次抵達 boss 節點時拍一次，之後不再更新**：它要回答的是「進去之前的狀態」，
    // boss 戰打完的血量不能污染這個問題。`null` 一律不當「沒有大破」用（未知不是安全）。
    bossEntryTaiha: boolean | null = null;

    // ── 泊地修理／給糧的計時器錨點（key: deckIdx，值為該艦隊「最後一次重置計時」的時間戳）──
    // 遊戲**不送任何泊地修理封包**，20 分／15 分是伺服器內部從「編成完了」起算的計時，
    // 只能靠觀察會重置它的封包來推算，故一律視為估算值（UI 需標示）。
    // 重置（依使用者提供之遊戲行為）：[變更]改動該隊成員、該隊出擊/遠征後回港。
    // **不重置**：陣容保存/讀取（preset_select）、隨伴艦一括解除（change 的 api_ship_id=-2）、
    // 僅更換裝備、其他艦隊的任何操作——這幾條是刻意的例外，別「順手」補進重置清單。
    // null＝該隊出門中（出擊/遠征），回港時才重新錨定。
    // **兩個機制的週期不同（修理20分／給糧15分）故各存一份錨點**：共用一份無法表達
    // 「經過15分時給糧已結算、修理還沒」這種不同步狀態，結算後重新起算也會互相打架。
    repairAnchorByDeck = new Map<number, number | null>();
    moraleAnchorByDeck = new Map<number, number | null>();

    private resetRepairAnchor(deckIdx: number, ts: number) {
        if (deckIdx < 0) return;
        this.repairAnchorByDeck.set(deckIdx, ts);
        this.moraleAnchorByDeck.set(deckIdx, ts);
    }

    /**
     * 遊戲編成不會留下空位：id>0 的艦一律往前擠，尾端補 -1，陣列長度不變（6 或遊撃 7）。
     * `api_req_hensei/change` 的回應通常不含新編成（只有一括解除才帶 api_change_count），
     * 必須在本機維持這個不變量；漏補會讓後續請求的 api_ship_idx 對到錯格，把還在隊上的艦蓋掉。
     */
    private compactDeckShips(deck: any) {
        const ships = deck?.api_ship;
        if (!Array.isArray(ships)) return;
        const kept = ships.filter((id: number) => id > 0);
        for (let i = 0; i < ships.length; i++) ships[i] = i < kept.length ? kept[i] : -1;
    }

    /**
     * `ship_deck`／`ship3` 的 api_deck_data 可以只回傳剛被讀取的一支艦隊，且陣列
     * 順序不是艦隊位置；艦隊位置只能由 api_id 決定。直接指定整個陣列會使「第3艦隊」
     * 變成索引 0，並遺失其餘艦隊。KC3Kai 的 PlayerManager.setFleets 與 poi 的
     * mergeIndexifiedFleets 都以 api_id 合併，這裡維持同一個不變量。
     */
    private mergeDeckData(deckData: unknown) {
        if (!Array.isArray(deckData)) return;
        const merged = this.decks.slice();
        let changed = false;
        for (const deck of deckData) {
            const deckIdx = Number(deck?.api_id) - 1;
            if (!Number.isInteger(deckIdx) || deckIdx < 0 || deckIdx > 3) continue;
            merged[deckIdx] = deck;
            changed = true;
        }
        if (changed) this.decks = merged;
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

    /** 只接受非負的整數槽位；未知欄位不應被轉成 0 而誤改狀態。 */
    private static slotIndex(value: unknown): number | null {
        if (value == null || String(value).trim() === '') return null;
        const n = Number(value);
        return Number.isSafeInteger(n) && n >= 0 ? n : null;
    }

    /** 同步交換裝備實例與對應搭載數，確保艦載機換位後制空資料仍跟著槽位走。 */
    private swapShipSlots(ship: any, first: number, second: number): boolean {
        const slots = ship?.api_slot;
        if (!Array.isArray(slots) || first === second
            || first < 0 || second < 0 || first >= slots.length || second >= slots.length) return false;
        [slots[first], slots[second]] = [slots[second], slots[first]];

        const onslot = ship.api_onslot;
        if (Array.isArray(onslot) && first < onslot.length && second < onslot.length)
            [onslot[first], onslot[second]] = [onslot[second], onslot[first]];
        return true;
    }

    /** 裝備／艦／艦隊實例 id 一律正規化成正整數，避免封包字串鍵與 Map 數字鍵分裂。 */
    private static positiveId(value: unknown): number | null {
        if (value == null || typeof value === 'boolean'
            || (typeof value === 'string' && value.trim() === '')) return null;
        const n = Number(value);
        return Number.isSafeInteger(n) && n > 0 ? n : null;
    }

    /** 僅接受明確的非負整數；缺席或格式不明都回 null。 */
    private static nonNegativeIntOrNull(value: unknown): number | null {
        if (value == null || typeof value === 'boolean'
            || (typeof value === 'string' && value.trim() === '')) return null;
        const n = Number(value);
        return Number.isSafeInteger(n) && n >= 0 ? n : null;
    }

    /** 缺席欄位沿用既有值；有值但格式不明時也不以猜測值覆蓋。 */
    private static nonNegativeInt(value: unknown, fallback: number): number {
        return GameState.nonNegativeIntOrNull(value) ?? fallback;
    }

    /** 接受明確的陣列或單筆物件；不把未知物件的欄位順序當成資料語意。 */
    private static recordList(value: unknown): any[] | null {
        if (Array.isArray(value)) return value;
        return value && typeof value === 'object' ? [value] : null;
    }

    /** 只寫入同一筆同時帶有裝備實例 id 與 master id 的資料。 */
    private upsertSlotItem(record: any): number | null {
        const id = GameState.positiveId(record?.api_id);
        const mst = GameState.positiveId(record?.api_slotitem_id);
        if (id == null || mst == null) return null;

        const previous = this.slotItems.get(id);
        const parsedLevel = GameState.nonNegativeIntOrNull(record.api_level);
        const parsedAlv = GameState.nonNegativeIntOrNull(record.api_alv);
        const level = parsedLevel ?? previous?.level ?? 0;
        const alv = parsedAlv ?? previous?.alv ?? 0;
        this.slotItems.set(id, { mst, level, alv });
        // 只有封包明確送出有效熟練度時才算完成校正；僅有 id/master 或改修值的局部資料
        // 不能證明既有熟練度仍正確。
        if (parsedAlv != null) this.alvStaleGears.delete(id);
        return id;
    }

    /**
     * 裝備實例的唯一共用入口。整批資料才允許 replace；編成／改裝等局部資料只合併，
     * 並且整批必須先通過「每筆都有正確 api_id＋api_slotitem_id」的檢查，避免半猜半寫。
     */
    private ingestSlotItems(value: unknown, replace = false): boolean {
        const list = GameState.recordList(value);
        if (!list || !list.every((it: any) => it && typeof it === 'object'
            && GameState.positiveId(it.api_id) != null
            && GameState.positiveId(it.api_slotitem_id) != null)) return false;

        if (replace) {
            this.slotItems.clear();
            this.alvStaleGears.clear();
        }
        for (const it of list) this.upsertSlotItem(it);
        return true;
    }

    /** 只接受帶 api_id 的艦娘局部資料；Map key 正規化，payload 本身保留原始欄位。 */
    private ingestShips(value: unknown, opts?: { requireMaster?: boolean }): boolean {
        const list = GameState.recordList(value);
        if (!list || !list.every((s: any) => s && typeof s === 'object'
            && GameState.positiveId(s.api_id) != null
            && (!opts?.requireMaster || GameState.positiveId(s.api_ship_id) != null))) return false;
        for (const s of list) {
            const id = GameState.positiveId(s.api_id);
            if (id != null) this.ships.set(id, s);
        }
        return true;
    }

    // ts：該封包的擷取時間戳。replay 時必須帶入原始 event.ts，否則泊地修理計時器會被
    // 重播當下的時間污染；live 事件未帶時退回 Date.now()。
    applyEvent(path: string, api: any, req?: Record<string, string>, ts: number = Date.now()) {
        if (path === 'api_start2/getData') {
            this.remodelPrev.clear();
            this.baseShipIdCache.clear();   // 反解來源要重建了，舊答案一律作廢
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
            // 整批刷新＝所有格的熟練度都回到封包事實。**不可在 api_port/port 歸零**：
            // 回港封包根本不帶裝備資料，歸在那裡等於謊稱已校正（見 alvStaleGears）。
            // ingestSlotItems 只有整批形狀完整時才會清 map，並同時清掉整批過時標記。
            this.ingestSlotItems(list, true);
            // 登入必送的 require_info 也帶 api_kdock（KC3/poi 一登入就能顯示建造渠的資料源）。
            // 防禦性讀取：欄位存在才覆蓋，避免 slot_item 端點（無此欄位）誤清空。
            if (Array.isArray(api.api_kdock)) this.kdockData = api.api_kdock;
        } else if (path === 'api_get_member/ship_deck' || path === 'api_get_member/ship3'
            || path === 'api_get_member/ship2') {
            // KC3Kai／EO：ship3 的 `api_slot_data`＝**未裝備清單（等同 unsetslot）**，不是
            // 裝備實例＋alv。熟練度刷新只靠 require_info／slot_item。這裡只合併船／艦隊。
            // 要求每筆帶 api_ship_id，才不把「只有 api_id」的局部物件蓋掉完整狀態。
            // ship2 的 decks 在我們的 api_data 邊界外（KC3Kai 讀 response.api_data_deck），
            // 本管線拿不到就略過，等 port／ship3 校正。
            if (path === 'api_get_member/ship2') {
                this.ingestShips(api, { requireMaster: true });
            } else {
                this.ingestShips(api?.api_ship_data, { requireMaster: true });
                this.mergeDeckData(api?.api_deck_data);
            }
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
            this.ingestShips(api.api_ship);
            this.ingestSlotItems(api.api_slotitem);
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
                this.upsertSlotItem(it);
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
            const afterId = this.upsertSlotItem(after);
            const afterItem = afterId == null ? undefined : this.slotItems.get(afterId);
            for (const cid of api?.api_use_slot_id ?? []) {
                const id = GameState.positiveId(cid);
                if (id != null) this.slotItems.delete(id);
            }
            const used = this.updateMaterials(api?.api_after_material);
            const remodelSuccess = Number(api?.api_remodel_flag ?? 0) === 1;
            this.lastImprove = {
                gearMst: afterItem?.mst ?? before?.mst ?? 0,
                levelBefore,
                levelAfter: afterItem?.level ?? levelBefore,
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
            // 2020-03-27 起 API 不再分頁：單一 tab 回傳該分類的**全部**任務（遊戲 UI 仍
            // 可能分頁顯示）。api_tab_id：0=全て／1=デイリー／2=ウィークリー／3=マンスリー／
            // 4=単発／5=他／9=遂行中（EO apilist／KC3Kai QuestManager.definePage）。
            // tab 0 與 9 是完整集合——缺席＝已不在受注中／達成（領獎後消失、或過期重置），
            // 必須刪除本機追蹤；其餘 tab 只是子集，只能更新出現的列，不能因缺席而刪。
            const tabId = Number(req?.api_tab_id);
            const completeTab = tabId === 0 || tabId === 9;
            const list = api.api_list;
            // api_list 為 null：該 tab 目前 0 件（EO：任務完遂時會變 null）。完整 tab
            // 才可清掉本機清單；子集 tab 的 null 不代表其他分類也空了。
            if (list == null) {
                if (completeTab) {
                    this.quests.clear();
                    this.questProgress.clear();
                }
            } else if (Array.isArray(list)) {
                const seen = new Set<number>();
                for (const q of list) {
                    // 空欄是 -1（不是物件），不可當任務讀。
                    if (!q || typeof q !== 'object' || !(q.api_no > 0)) continue;
                    seen.add(q.api_no);
                    if (q.api_state === 2 || q.api_state === 3) {
                        this.quests.set(q.api_no, {
                            name: q.api_title,
                            detail: q.api_detail ?? '',
                            done: q.api_state === 3,
                        });
                        // 進度只在「本機第一次看到這個任務編號」時初始化——重複的 questlist
                        // 不得把已累積的計數洗回 0。
                        if (!this.questProgress.has(q.api_no)) {
                            const goal = resolveQuestGoal(q.api_no, q.api_title ?? '', q.api_detail ?? '');
                            if (goal) this.questProgress.set(q.api_no, { ...goal, count: 0 });
                        }
                    } else {
                        // state 1=未受注：若已追蹤過（例如放棄後），從面板拿掉。
                        this.quests.delete(q.api_no);
                        this.questProgress.delete(q.api_no);
                    }
                }
                if (completeTab) {
                    for (const no of [...this.quests.keys()]) {
                        if (seen.has(no)) continue;
                        this.quests.delete(no);
                        this.questProgress.delete(no);
                    }
                }
            }
        } else if ((path === 'api_req_quest/clearitemget' || path === 'api_req_quest/stop') && req) {
            // 達成後領取獎勵（clearitemget）或放棄任務（stop）：該任務即從清單消失。
            // 即時刪除；完整 tab 的下一次 questlist 也會以缺席同步清掉（見上方）。
            // 獎勵欄只在它真的帶「實例 api_id＋master api_slotitem_id」時才寫入。舊格式／
            // 未驗證的 api_bounus.api_id 可能只是 master id，不能拿它當裝備實例鍵；保留原始
            // 事件，等待後續 slot_item 或局部快照補齊，避免把兩件後期裝備誤合併成假實例。
            this.ingestSlotItems(api?.api_slot_data);
            this.ingestSlotItems(api?.api_slotitem);
            this.ingestSlotItems(api?.api_slot_item);
            const questId = Number(req.api_quest_id);
            if (Number.isFinite(questId) && questId > 0) {
                this.quests.delete(questId);
                this.questProgress.delete(questId);
            }
        } else if (path === 'api_port/port') {
            this.ships.clear();
            this.ingestShips(api.api_ship);
            this.decks = api.api_deck_port;
            // 遠征中的艦隊：記錄其 mission id 為該艦隊「上次遠征」（回港後 api_mission 歸零，故在此捕捉）
            this.decks.forEach((d: any, i: number) => {
                const mid = d.api_mission?.[1] ?? 0;
                if (mid > 0) this.lastMissionByDeck.set(i, mid);
            });
            this.pendingConsumption = [];
            this.pendingPlaneLoss = [];
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
            this.lastDayDamecons = null;
            // 回港＝出擊結束，退避狀態隨之解除（退避艦本來就已經先回到母港）。
            this.escapedShipIds.clear();
            this.pendingEscape = null;
            this.goddessRestored.clear();
            // 母港封包帶的是搭載數實數（api_onslot，上面 api_ship 已整批覆蓋），
            // 途中的估算到此校正完畢，估算標記隨之解除。
            this.planeLossEstimated.clear();
            // 熟練度也在「回港這一刻」結算（全滅→歸零／部分損耗→標過時）。必須排在
            // api_ship 已寫入 this.ships 之後，比較的才是帰投時的實數。
            this.settlePlaneProficiency();
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
        } else if (path === 'api_req_map/select_eventmap_rank' && req) {
            const area = Number(req.api_maparea_id);
            const mapNo = Number(req.api_map_no);
            const rank = Number(req.api_rank);
            const maphp = api?.api_maphp;
            const nowHp = Number(maphp?.api_now_maphp);
            const maxHp = Number(maphp?.api_max_maphp);
            const gaugeType = Number(maphp?.api_gauge_type);
            if (Number.isSafeInteger(area) && area > 0
                && Number.isSafeInteger(mapNo) && mapNo > 0
                && Number.isSafeInteger(rank) && rank > 0
                && Number.isSafeInteger(nowHp) && nowHp >= 0
                && Number.isSafeInteger(maxHp) && maxHp > 0) {
                const mapId = area * 10 + mapNo;
                const previous = this.mapGauges.get(mapId);
                this.mapGauges.set(mapId, {
                    cleared: previous?.cleared ?? false,
                    gaugeType: Number.isSafeInteger(gaugeType) && gaugeType >= 0
                        ? gaugeType : (previous?.gaugeType ?? 0),
                    defeatCount: previous?.defeatCount ?? 0,
                    requiredDefeatCount: previous?.requiredDefeatCount ?? 0,
                    nowHp,
                    maxHp,
                    selectedRank: rank,
                });
            }
        } else if (path === 'api_req_map/start' && req) {
            this.currentSortieFleetId = Number(req.api_deck_id) - 1;
            // 出擊中：計時器歸零、且要等回港才重新起算，故先標 null（見 repairAnchorByDeck）。
            this.markFleetAway(this.currentSortieFleetId);
            if (this.combinedFlag > 0 && this.currentSortieFleetId === 0) this.markFleetAway(1);
            this.battleInfo = null;
            this.lastDayBattle = null;
            this.lastDayDamecons = null;
            this.pendingConsumption = [];
            this.pendingPlaneLoss = [];
            this.damaconUsed.clear();
            this.goddessRestored.clear();
            this.escapedShipIds.clear();
            this.pendingEscape = null;
            this.planeLossEstimated.clear();
            // 熟練度是回港時依「出撃時 vs 帰投時の残数」結算的，故出擊當下要先拍一份
            // 搭載數實數留著比（見 settlePlaneProficiency）。
            this.snapshotSortieOnslot();
            this.bossEntryTaiha = null;
            const startNode = sortieNodeOf(api);
            this.sortieInfo = {
                mapArea: api.api_maparea_id,
                mapNo: api.api_mapinfo_no,
                nodes: [startNode],
            };
            const eventmap = api?.api_eventmap;
            const nowHp = Number(eventmap?.api_now_maphp);
            const maxHp = Number(eventmap?.api_max_maphp);
            if (Number.isSafeInteger(nowHp) && nowHp >= 0
                && Number.isSafeInteger(maxHp) && maxHp > 0) {
                const mapId = api.api_maparea_id * 10 + api.api_mapinfo_no;
                const previous = this.mapGauges.get(mapId);
                this.mapGauges.set(mapId, {
                    cleared: previous?.cleared ?? false,
                    gaugeType: previous?.gaugeType ?? 0,
                    defeatCount: previous?.defeatCount ?? 0,
                    requiredDefeatCount: previous?.requiredDefeatCount ?? 0,
                    nowHp,
                    maxHp,
                    selectedRank: previous?.selectedRank ?? 0,
                });
            }
            this.noteBossEntry(startNode);
            this.applyMaelstromIfAny(api, startNode.id);
            this.bumpQuestProgress('sortie');
        } else if (path === 'api_req_map/next') {
            if (this.sortieInfo) {
                const node = sortieNodeOf(api);
                this.sortieInfo.nodes.push(node);
                // 血量此刻＝上一個節點戰鬥寫回後的值（戰鬥封包就即時寫回，見 applyEvent
                // 的戰鬥分支），故這裡量到的正是「踏進這個節點時」的狀態。
                this.noteBossEntry(node);
                this.applyMaelstromIfAny(api, node.id);
            }
        } else if (path === 'api_req_hensei/change' && req) {
            const deck = this.decks[Number(req.api_id) - 1];
            if (!deck || !Array.isArray(deck.api_ship)) return;
            const deckIdx = Number(req.api_id) - 1;
            const idx = Number(req.api_ship_idx);
            const newId = Number(req.api_ship_id);
            if (newId === -2) {
                // 隨伴艦一括解除：遊戲內部**不算**編成調整，泊地修理計時器不重置
                // （使用者實測的既知 bug feature，見 repairAnchorByDeck 註解）。
                deck.api_ship = deck.api_ship.map((v: number, i: number) => (i === 0 ? v : -1));
                return;
            }
            if (!Number.isInteger(idx) || idx < 0 || idx >= deck.api_ship.length) return;
            const oldId = deck.api_ship[idx];
            if (newId > 0) {
                for (const d of this.decks) {
                    const j = d.api_ship.indexOf(newId);
                    if (j >= 0) {
                        d.api_ship[j] = oldId;
                        // 換上來的艦若位於別隊，那一隊的成員也被改動了 → 一併重置。
                        // 目標格若是空的，來源格會變成 -1，必須立刻補位，否則來源艦隊也會留洞。
                        if (d !== deck) {
                            this.compactDeckShips(d);
                            this.resetRepairAnchor(this.decks.indexOf(d), ts);
                        }
                    }
                }
            }
            // 寫入指定格後一律補位：移除（-1）會把後面的艦往前擠；點到空格加入時
            // req.api_ship_idx 只是點擊格、不是最終落點（與裝備 slotset 空格補位同一類行為）。
            deck.api_ship[idx] = newId;
            this.compactDeckShips(deck);
            this.resetRepairAnchor(deckIdx, ts);
        } else if (path === 'api_req_hensei/preset_select' && req) {
            const idx = Number(req.api_deck_id) - 1;
            if (api && this.decks[idx]) this.decks[idx] = api;
        } else if (path === 'api_req_hensei/combined') {
            // 母港「連合艦隊」切換鈕：型別值在 req.api_combined_type（1=機動、3=輸送
            // 兩個值都已用真封包交叉驗證，見 samples/hensei-combined-*.json），2=水上
            // 用刪去法推得（僅 3 種型別，1/3 已確定，未直接驗證）。api_data.api_combined
            // api_data.api_combined 恆為 1，是「連合已啟用」的通用成功旗標、不是型別值；
            // 編制類型必須讀取 req.api_combined_type。
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
            // 除籍等同改動了所在艦隊的編成成員，比照 api_req_hensei/change 的規則重置該隊
            // 泊地修理／給糧計時器錨點；只重置真的受影響的隊，不影響其他艦隊。
            this.decks.forEach((d, di) => {
                if (!d.api_ship.some((id: number) => ids.includes(id))) return;
                d.api_ship = d.api_ship.map((id: number) => (ids.includes(id) ? -1 : id));
                this.compactDeckShips(d);
                this.resetRepairAnchor(di, ts);
            });
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
        } else if (path === 'api_req_kaisou/remodeling') {
            // 現代真封包樣本仍缺席，回應欄位不可拿來覆蓋完整艦／艦隊／裝備狀態。
            // 原始事件照常保存；後續已驗證的 port／require_info 快照會完成校正。
        } else if (path === 'api_req_kaisou/powerup' && req) {
            // 近代化改修：餌艦(api_id_items)消滅・強化先(api_ship)更新
            this.ingestShips(api?.api_ship);
            const feeders = (req.api_id_items ?? '').split(',').map(Number).filter(n => n > 0);
            for (const sid of feeders) this.ships.delete(sid);
            // 餌艦被移出編成同等改動成員，比照 api_req_hensei/change 的規則重置該隊計時器錨點。
            this.decks.forEach((d, di) => {
                if (!d.api_ship.some((id: number) => feeders.includes(id))) return;
                d.api_ship = d.api_ship.map((id: number) => (feeders.includes(id) ? -1 : id));
                this.compactDeckShips(d);
                this.resetRepairAnchor(di, ts);
            });
            // 近代化改修没有失敗判定（有餌就必定吃成功），故每次呼叫都算一次成功。
            this.bumpQuestProgress('modernization');
        } else if (path === 'api_req_kaisou/slot_exchange_index' && req) {
            // 拖曳交換同艦兩個已裝備槽位（制空／艦載機換位的主要觸發路徑）。**已用真封包
            // 驗證**（samples/slot-exchange-index.json，三筆，含互為逆操作的一組
            // src/dst_idx=3/0 與 0/3）：請求為 api_id/api_src_idx/api_dst_idx（0-based，
            // 與 slotset 的 api_slot_idx 同慣例），回應的 api_ship_data 是**完整艦快照**
            // （與 api_port/port 單艦記錄同形，含 api_slot／api_onslot／hp／燃彈／cond／
            // 各項素質／api_sally_area 等），不是局部物件，故直接整艦 ingestShips 覆蓋，
            // 不必也不該手動拼湊挑選欄位。api_id 需與請求一致才採信，避免格式異常時
            // 誤植出一艘幽靈艦。
            const shipData = api?.api_ship_data;
            if (shipData && typeof shipData === 'object'
                && GameState.positiveId(shipData.api_id) === GameState.positiveId(req.api_id)) {
                this.ingestShips([shipData]);
            }
        } else if (path === 'api_req_kaisou/slotset' && req) {
            // 一般裝備欄（0-3 番）。已用真實封包排除補強增設走這條的假設——現行版本
            // 補強增設是獨立端點 api_req_kaisou/slotset_ex（見下），這裡恆定收到有效 idx。
            const s = this.ships.get(Number(req.api_id));
            if (s) {
                const idx = GameState.slotIndex(req.api_slot_idx);
                const itemId = Number(req.api_item_id);   // -1 = 卸下
                if (idx != null && Number.isSafeInteger(itemId) && Array.isArray(s.api_slot)
                    && idx < s.api_slot.length) {
                    // 裝備到「目前是空格」的槽位時，遊戲會自動塞進當下第一個空槽，
                    // req.api_slot_idx 只是使用者點擊當下的格位、不是最終落點——已用真封包
                    // 驗證（samples/equip_slot.json + slot_to_port.json：全空裝艦點第三格
                    // [idx=2]，回港快照證實實際落在 index 0）。換裝／替換既有裝備（目標格
                    // 本身已有東西，非空格）不涉及遞補，idx 才是真正目標格，維持直接寫入。
                    // 若 itemId 已在同一艘艦的另一格，則是同艦換位／拖曳的另一種請求形態，
                    // 必須把來源格清成目標格原值，不能只寫目標格造成同一顆裝備被重複引用。
                    const sourceIdx = itemId > 0
                        ? s.api_slot.findIndex((v: number) => Number(v) === itemId) : -1;
                    if (sourceIdx >= 0 && sourceIdx !== idx) {
                        this.swapShipSlots(s, sourceIdx, idx);
                    } else if (itemId > 0 && Number(s.api_slot[idx]) <= 0) {
                        const emptyIdx = s.api_slot.findIndex((v: number) => Number(v) <= 0);
                        if (emptyIdx >= 0) s.api_slot[emptyIdx] = itemId;
                    } else {
                        s.api_slot[idx] = itemId;
                    }
                }
            }
            // 現有真封包樣本的回應只有裸 api_result；請求投影已涵蓋已驗證的動作結果。
            // 不讀取未驗證的假想回應欄位，避免局部物件覆蓋完整艦船或裝備狀態。
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
            this.airBaseCondAsOf.clear();
            this.airBaseCondMinRate.clear();
            if (Array.isArray(api)) {
                for (const ab of api) {
                    const key = airBaseKey({ areaId: ab.api_area_id, rid: ab.api_rid });
                    this.airBases.set(key, ab);
                    this.markAirBaseCondObserved(key, ts);
                }
            }
        } else if (path === 'api_get_member/mapinfo') {
            if (api?.api_air_base && Array.isArray(api.api_air_base)) {
                for (const ab of api.api_air_base) {
                    const key = airBaseKey({ areaId: ab.api_area_id, rid: ab.api_rid });
                    this.airBases.set(key, ab);
                    this.markAirBaseCondObserved(key, ts);
                }
            }
            // 基地整備為「海域」層級，不在 api_air_base 個別航空隊物件上。資料缺席時保留
            // 既有觀測值：mapinfo 的完整性尚未有本專案真封包佐證，不能把缺席誤作 Lv.0。
            if (Array.isArray(api?.api_air_base_expanded_info)) {
                for (const info of api.api_air_base_expanded_info) {
                    const areaId = Number(info?.api_area_id);
                    const level = Number(info?.api_maintenance_level);
                    if (Number.isSafeInteger(areaId) && areaId > 0
                        && Number.isSafeInteger(level) && level >= 0) {
                        this.airBaseMaintenanceLevels.set(areaId, level);
                    }
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
            const keys = this.resolveAirBaseKeys(req);
            const key = keys.length === 1 ? keys[0]!.key : undefined;
            const ab = key ? this.airBases.get(key) : undefined;
            if (ab && key && api) {
                if (api.api_plane_info) {
                    ab.api_plane_info = mergeSquadrons(ab.api_plane_info, api.api_plane_info);
                    this.markAirBaseCondObserved(key, ts);
                }
                if (api.api_distance) ab.api_distance = api.api_distance;
            } else {
                // 同 supply 分支：解不出唯一基地（api_base_id 逗號分隔、或 api_area_id 缺席
                // 且 rid 撞號）時**不猜**，但一定要留下痕跡——靜默 no-op 正是 2026-08-04
                // 「面板一直顯示補給前機數」那個 bug 難查的原因，這條路徑會讓中隊配置
                // 停在變更前而 console 一片乾淨。
                console.warn('[KC-Monitor] 基地航空隊配置變更無法套用，面板中隊可能停在變更前',
                    { req, bases: keys, hasPlaneInfo: !!api?.api_plane_info });
            }
        } else if (path === 'api_req_air_corps/set_action' && req) {
            // set_action 可同時設定多個航空隊 (api_base_id=1,2 / api_action_kind=1,2)
            const actions = (req.api_action_kind ?? '').split(',');
            this.resolveAirBaseKeys(req).forEach(({ key, index: i }) => {
                const ab = this.airBases.get(key);
                if (!ab) return;
                ab.api_action_kind = Number(actions[i] ?? actions[0]);
                // 札一改，回復速度就變了。取「這段期間看過的最慢速度」作為推論依據
                // ——中途從休息改成出撃時，若還用現在的札回算，會把疲勞提早判定成回復。
                const prev = this.airBaseCondMinRate.get(key);
                const rate = lbasRecoveryRate(ab.api_action_kind);
                this.airBaseCondMinRate.set(key, prev == null ? rate : Math.min(prev, rate));
            });
        } else if (path === 'api_req_air_corps/supply' && req) {
            // 補給後的機數只能從這裡更新——戰鬥封包不帶 api_count，下一次 base_air_corps／
            // mapinfo 才會校正。這裡漏掉就等於面板一直顯示補給前的機數。
            // 補給後的資材餘額（samples/air-corps-supply.json 實測：只送燃料與鋁土，
            // 那正是配置飛機會消耗的兩項）。只就地更新這兩格，其餘沿用母港封包
            // ——同 api_req_hokyu/charge 的既定寫法，絕不整批覆蓋 materials。
            // 資源紀錄（db.resources）不受影響：那條路徑只認帶完整八項的封包。
            if (Number.isFinite(api?.api_after_fuel)) this.materials[0] = api.api_after_fuel;
            if (Number.isFinite(api?.api_after_bauxite)) this.materials[3] = api.api_after_bauxite;
            const keys = this.resolveAirBaseKeys(req);
            if (keys.length === 1 && api?.api_plane_info) {
                const key = keys[0]!.key;
                const ab = this.airBases.get(key);
                if (ab) {
                    ab.api_plane_info = mergeSquadrons(ab.api_plane_info, api.api_plane_info);
                    this.markAirBaseCondObserved(key, ts);
                }
            } else {
                // 多個基地一次補給時，無法確定回應的 api_plane_info 各屬哪一個基地
                // （沒有樣本，squadron id 在各基地內都是 1–4，硬分會分錯）；查不到基地
                // 亦同。兩種情況都**不猜**，但要留下痕跡——靜默失敗正是這個 bug 難查的原因。
                console.warn('[KC-Monitor] 基地航空隊補給無法套用，面板機數可能停在補給前',
                    { req, bases: keys, hasPlaneInfo: !!api?.api_plane_info });
            }
        } else if (path === 'api_req_air_corps/change_name' && req) {
            // 同 set_plane／supply：一律經 resolveAirBaseKeys，別自己組鍵（api_base_id
            // 可能逗號分隔、api_area_id 可能缺席）。改名只影響顯示，故解不出來時
            // 降級成 debug 級別的紀錄即可，但仍不靜默。
            const keys = this.resolveAirBaseKeys(req);
            const ab = keys.length === 1 ? this.airBases.get(keys[0]!.key) : undefined;
            if (ab) ab.api_name = req.api_name ?? ab.api_name;
            else console.warn('[KC-Monitor] 基地航空隊改名無法套用，面板仍顯示舊名', { req, bases: keys });
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
                // 遊撃部隊的戰鬥封包本身會明示 api_deck_id（本次第3艦隊七船封包實證）。
                // currentSortieFleetId 是 map/start 時的快照；面板中途開啟、歷史事件裁剪或
                // 狀態不完整時，不能讓它的預設第1艦隊把這場戰鬥的 HP 寫到錯誤艦隊。
                // 僅接受 1–4 且目前確有該編成的值，缺席仍沿用 map/start 的既有狀態。
                const battleDeckId = Number(api?.api_deck_id);
                const battleDeckIdx = battleDeckId - 1;
                if (Number.isInteger(battleDeckIdx) && battleDeckIdx >= 0
                    && battleDeckIdx < this.decks.length && this.decks[battleDeckIdx]) {
                    this.currentSortieFleetId = battleDeckIdx;
                }
                const isNightOnly = path.includes('sp_midnight');
                const isNight = path.includes('midnight');
                // 演習「挑戰次數」在晝戰當下就算一次，不必等結果——夜戰接續是同一場
                // 演習的延續，不會重複觸發 api_req_practice/battle。
                if (path === 'api_req_practice/battle') this.bumpQuestProgress('practiceAttempt');

                // Get player damecons
                const playerDamecons = this.getPlayerDamecons(api);
                // 退避艦的位置旗標（與 damecons 同序）：已退避者不列入大破警告與 rank。
                const escaped = this.getEscapedFlags(api);
                const opts = { escapedMain: escaped.main, escapedEscort: escaped.escort };

                // 實際餵給 analyzeBattle 的損管狀態。**必須與 apiList 的第一包同一時刻**：
                // 夜戰接續是把晝戰整場重放一次，用當下重算的 playerDamecons 會讓晝戰已觸發
                // 損管的艦在重放時無損管可用 → 誤報轟沈（見 lastDayDamecons 宣告處）。
                let usedDamecons = playerDamecons;
                // Record daytime battle data for MVP prediction if needed
                if (!isNight) {
                    this.lastDayBattle = api;
                    this.lastDayDamecons = playerDamecons;
                    this.battleInfo = analyzeBattle([api], usedDamecons, opts);
                } else if (this.lastDayBattle && isNight && !isNightOnly) {
                    usedDamecons = this.lastDayDamecons ?? playerDamecons;
                    this.battleInfo = analyzeBattle([this.lastDayBattle, api], usedDamecons, opts);
                } else {
                    this.battleInfo = analyzeBattle([api], usedDamecons, opts);
                }
                // 把戰鬥模擬後的 HP 寫回 this.ships，讓編成面板即時反映受損
                if (this.battleInfo?.resultFleets) {
                    this.applyBattleHp(this.battleInfo.resultFleets);
                    // 比對基準同樣要用餵進去的那一份（Set 皆為冪等，夜戰重放時重複標記同一艘
                    // 不會有副作用）。
                    this.markDameconConsumed(usedDamecons, this.battleInfo.resultFleets);
                }
                // 艦載機戰損（估算）：只累積、不當場寫回——戰鬥中要看的是這一場交戰時的
                // 制空值，結算才一併扣（見 pendingPlaneLoss／queuePlaneLoss）。
                this.queuePlaneLoss(api);
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
                // Boss 節點（color=5）：記錄已觀測到的最高 boss 旗艦 HP，供 HP量表式關卡
                // （gaugeType 2）估剩餘次數與斬殺線。同一活動海域可能有多個 Boss 節點，
                // 較低 HP 的旁支 Boss 不得覆蓋已知的較高門檻。
                if (atBoss && map) {
                    const bossHp = this.battleInfo?.resultFleets?.enemyMain?.[0]?.maxHp ?? 0;
                    this.observeMapBossHp(map.mapArea, map.mapNo, bossHp);
                }
            } catch (e) {
                console.error("BattlePrediction Error", e);
            }
        } else if (path === 'api_req_sortie/battleresult' || path === 'api_req_combined_battle/battleresult') {
            if (this.battleInfo) {
                this.battleInfo.hasResult = true;
                this.battleInfo.drop = api.api_get_ship ? localizeShip(api.api_get_ship.api_ship_id, api.api_get_ship.api_ship_name) : null;
                // 是否為「本鎮守府還沒有的船」。**在這裡判定而不是留給面板**：新船要等
                // api_port/port 才會進 this.ships，回港後再問就永遠答「已持有」。
                this.battleInfo.dropIsNew = api.api_get_ship
                    ? !this.ownsShip(Number(api.api_get_ship.api_ship_id))
                    : false;
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
            // 艦載機戰損同樣延到結算才寫回，理由與燃彈相同（見 pendingPlaneLoss）。
            // 逐段套用：分攤按各格當下搭載數的比例算，一段一段來才與實際順序一致。
            for (const lost of this.pendingPlaneLoss) this.spreadPlaneLoss(lost);
            this.pendingPlaneLoss = [];
            // 応急修理女神：HP 全快（battle.ts 已寫回）＋燃彈全快。放在消耗之後才不會被
            // 這一節點的燃彈消耗再扣一次。
            this.restoreGoddessSupply();
            // 退避位置：結算畫面先給選項，玩家按 goback_port 才算數（見 parseEscapeIdx）。
            this.pendingEscape = GameState.parseEscapeIdx(api?.api_escape);
        } else if (path.endsWith('/goback_port')) {
            // 艦隊司令部施設的退避（KC3Kai 同：取各陣列 [0]）。解不出就不標。
            for (const at of this.pendingEscape ? this.resolveEscape(this.pendingEscape) : []) {
                this.escapedShipIds.add(at.id);
                // 同步標記戰鬥檢視上的同一格，讓下面的大破警告重算看得到這艘已離隊。
                // 隊別與隊內索引直接沿用 shipAtSortiePos 解出來的結果（不在這裡重推一次
                // 連合／索引規則），且只處理它解得出 id 的位置，兩邊不會各自漂移。
                const views = at.escort
                    ? this.battleInfo?.resultFleets?.playerEscort
                    : this.battleInfo?.resultFleets?.playerMain;
                const view = views?.[at.index];
                if (view) view.escaped = true;
                // 退避的代價（大破艦與護衛艦皆同，使用者提供之遊戲設定、非封包驗證）：
                // 燃料歸 0、cond 一律變成 22（不論退避前是多少）。回港時另有 cond-15
                // ＝合計 7，那一段由 api_port/port 的實數覆蓋，此處不模擬。
                const s = this.ships.get(at.id);
                if (s) { s.api_fuel = 0; s.api_cond = 22; }
            }
            this.pendingEscape = null;
            // **退避後按剩下的船重算大破警告**：退避的意義就是「讓剩下的船繼續進擊」，
            // 退掉唯一那艘大破艦之後還掛著警告，等於叫玩家別做他剛剛才做完的事。
            // 這裡沒有新的戰鬥封包會觸發重算，故必須在這條路徑自己算一次。
            if (this.battleInfo?.resultFleets) {
                Object.assign(this.battleInfo, taihaFlags(this.battleInfo.resultFleets));
            }
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
            // 演習不消耗實際燃彈（遊戲機制），故不呼叫 applyConsumption；但演習戰鬥分支
            // 一樣會把費率 push 進 pendingConsumption（與正式出擊共用同一段計算），這裡若不清空
            // 就會在陣列裡留下不會被套用的殘留項——目前僅因 api_req_map/start 無條件重置才不
            // 會誤扣，但那個防護不屬於這段程式碼本身保證，故仍在此明確清空。
            this.pendingConsumption = [];
            // 演習同樣不消耗艦載機，累積的損失一併丟棄（理由同上）。
            this.pendingPlaneLoss = [];
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
                // 退避艦已離開艦隊，血量停在退避當下——戰鬥封包若仍帶著它的位置，
                // 那個值不該覆蓋回來（位置本身仍要保留，否則整排索引會錯位）。
                if (this.escapedShipIds.has(id)) return;
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

    /**
     * 出擊途中的艦載機戰損（**估算**，與燃彈估算同一個模式：途中封包不給實數 → 估算 →
     * 回港 `api_port/port` 以實數校正）。
     *
     * 為什麼只能估算（**封包契約的資訊限制**）：
     * wikiwiki「航空戰」明載制空戰損失是**逐格獨立亂數**——
     * `⌊｛搭載數 ×[A + 制空常數/4]｝/10⌋`（A＝0～制空常數/3 的亂數；確保時常數＝1），
     * 對空砲火段亦為逐攻擊機格的獨立判定（艦戰不受對空砲火）。遊戲先各自擲完再加總，
     * 戰鬥封包只吐整場合計（`api_stage1/2.api_f_lostcount`），**沒有任何逐格殘量欄位**
     * （已逐一檢查 samples/ 的 6-5 ec_battle 與 61-3／61-4／61-5）。因此「從合計反推
     * 哪一格掉幾架」資訊論上無解——不是樣本不夠，是封包根本沒帶那個資訊。重跑 wiki
     * 公式也救不了：要重現每一格的亂數與敵方對空分配，被動觀測做不到，且結果還會與
     * 封包已給定的合計打架。
     *
     * 分攤規則（與燃彈估算同層）：按各格**目前搭載數**的比例攤到參戰的艦載機格
     * （AIR_COMBAT_CATS），大數餘額法補足零頭，使**合計必定等於封包給的損失數**；單格
     * 不會扣成負數，扣不下的餘額順延給其他格。偵察機／對潛機不參戰故不分攤。已退避艦
     * 不分攤（已離開艦隊）。回港 `api_port/port` 以實數校正。
     *
     * `api_plane_from`（哪些艦放了飛機）刻意不使用：它的索引基準（連合艦隊時主隊／隨伴
     * 怎麼編號）沒有真封包佐證，讀錯會把損失整批攤到錯的艦上——寧可攤得平一點，也不要
     * 建立在沒驗證過的欄位語意上（見 CLAUDE.md 驗證原則）。
     */
    private queuePlaneLoss(api: any) {
        // 噴式強襲／航空戰／二巡航空戰各自結算。夜戰封包沒有這些欄位，故夜戰接續把
        // 晝戰重放給 analyzeBattle 時也不會重複扣（本方法只吃當下這一則封包）。
        for (const key of ['api_injection_kouku', 'api_kouku', 'api_kouku2']) {
            const ph = api?.[key];
            if (!ph) continue;
            const lost = Math.max(0, Math.floor(Number(ph.api_stage1?.api_f_lostcount) || 0))
                + Math.max(0, Math.floor(Number(ph.api_stage2?.api_f_lostcount) || 0));
            // **不當場扣**：扣了會讓編成的制空在交戰途中就往下掉，但戰鬥中要看的正是
            // 「這一場打的時候制空是多少」。與燃彈同一個 pattern（見 pendingConsumption）
            // ——戰鬥封包只累積，結算（battleresult）才一次寫回。逐段分開存而不先加總：
            // 分攤是按各格當下的搭載數比例算的，一段一段套才與實際發生順序一致。
            if (lost > 0) this.pendingPlaneLoss.push(lost);
        }
    }

    /** queuePlaneLoss 的分攤本體：把 `total` 架損失攤到出擊艦隊的參戰艦載機格上。 */
    private spreadPlaneLoss(total: number) {
        // 出擊的那一隊（連合時加上隨伴第2艦隊，基準同 applyConsumption）。
        const decks = [this.decks[this.currentSortieFleetId]];
        if (this.combinedFlag > 0 && this.currentSortieFleetId === 0 && this.decks[1]) decks.push(this.decks[1]);
        const slots: { ship: any; idx: number; gid: number; count: number }[] = [];
        for (const deck of decks) {
            for (const sid of deck?.api_ship ?? []) {
                if (sid <= 0 || this.escapedShipIds.has(sid)) continue;
                const s = this.ships.get(sid);
                if (!s || !Array.isArray(s.api_onslot)) continue;
                (s.api_slot ?? []).forEach((gid: number, idx: number) => {
                    const count = Number(s.api_onslot[idx]) || 0;
                    if (gid <= 0 || count <= 0) return;
                    const cat = this.masterGears.get(this.slotItems.get(gid)?.mst ?? -1)?.cat ?? 0;
                    if (AIR_COMBAT_CATS.has(cat)) slots.push({ ship: s, idx, gid, count });
                });
            }
        }
        const pool = slots.reduce((n, sl) => n + sl.count, 0);
        if (!pool) {
            console.warn('[KC-Monitor] 找不到可分攤艦載機損失的參戰搭載格', { total, pool });
            return;
        }
        if (total > pool) {
            // 物理上不可能從目前可辨識的參戰格扣掉更多飛機；這代表機種集合、裝備快照或
            // 封包理解至少有一項不完整。最多只能歸零可辨識的格，必須明確留下診斷訊號，
            // 不可靜默宣稱已完整分攤封包合計。
            console.warn('[KC-Monitor] 艦載機損失超過可辨識的參戰搭載數', { total, pool });
        }
        // 大數餘額法：先按比例切捨分配，剩下的零頭依小數部分由大到小補一架。
        const share = slots.map(sl => (sl.count * total) / pool);
        const alloc = share.map(v => Math.floor(v));
        const order = share
            .map((v, i) => ({ i, frac: v - Math.floor(v) }))
            .sort((a, b) => b.frac - a.frac);
        let rest = Math.min(total, pool) - alloc.reduce((n, v) => n + v, 0);
        for (const { i } of order) {
            if (rest <= 0) break;
            alloc[i]++; rest--;
        }
        // 單格扣不下的部分順延給還有機的格子，確保合計仍等於封包的損失數。
        let carry = 0;
        slots.forEach((sl, i) => {
            const take = Math.min(sl.count, alloc[i]);
            carry += alloc[i] - take;
            sl.count -= take;
        });
        for (const sl of slots) {
            if (carry <= 0) break;
            const take = Math.min(sl.count, carry);
            sl.count -= take; carry -= take;
        }
        for (const sl of slots) {
            sl.ship.api_onslot[sl.idx] = sl.count;
            this.planeLossEstimated.add(sl.ship.api_id);
            // ⚠️ 這裡**刻意不標熟練度過時**：熟練度是回港那一刻才依「出撃時 vs 帰投時的
            // 残数」結算的（見 sortieStartOnslot），出擊途中手上的 alv 仍是對的。在這裡標
            // 會讓整趟出擊都掛著一個當下並不成立的警示。標記時機在 settlePlaneProficiency()。
        }
    }

    /**
     * 回港時結算艦載機熟練度（日wiki「艦載機熟練度」）。**必須在母港封包已寫入
     * `this.ships` 之後呼叫**——比的是同一格的「出撃時の残数 vs 帰投時の残数」。
     *
     * 兩種結果，語意完全不同：
     *   ・**全滅（帰投時 0 架）→ 熟練度歸零（帯なし）**。wiki 明載的絕對規則，且兩端的
     *     搭載數都是母港封包實數，故這是**確定值不是估算**：直接把 alv 寫成 0，並解除
     *     該格的過時標記。
     *   ・**部分損耗 → 依「残数比率」下降，但 wiki 沒給下降量的數字**（只說常時發生、
     *     即使制空確保也約有 3.5% 損耗）。故只標過時、不推算，等遊戲下次送裝備資料校正。
     * 沒損耗的格子完全不動——連標記都不加。
     */
    private settlePlaneProficiency() {
        for (const [gid, before] of this.sortieStartOnslot) {
            if (!(before > 0)) continue;
            const after = this.onslotOfGear(gid);
            if (after === null || after >= before) continue;   // 查不到或沒少 → 不動
            if (after === 0) {
                const it = this.slotItems.get(gid);
                if (it) it.alv = 0;                 // 全滅＝帯なし（確定值）
                this.alvStaleGears.delete(gid);
            } else {
                this.alvStaleGears.add(gid);        // 部分損耗：降了多少不可考
            }
        }
        this.sortieStartOnslot.clear();
    }

    /** 這顆裝備實例現在裝在哪一格、還剩幾架；找不到（已卸下／解體）回 null，不猜 0。 */
    private onslotOfGear(gid: number): number | null {
        for (const s of this.ships.values()) {
            const idx = (s.api_slot ?? []).indexOf(gid);
            if (idx < 0) continue;
            if (!Array.isArray(s.api_onslot) || idx >= s.api_onslot.length) return null;
            const count = Number(s.api_onslot[idx]);
            return Number.isSafeInteger(count) && count >= 0 ? count : null;
        }
        return null;
    }

    /** 出擊當下拍下各艦載機格的搭載數（母港封包實數，尚未被 spreadPlaneLoss 的估算動過）。 */
    private snapshotSortieOnslot() {
        this.sortieStartOnslot.clear();
        for (const s of this.ships.values()) {
            (s.api_slot ?? []).forEach((gid: number, idx: number) => {
                if (gid <= 0) return;
                const cat = this.masterGears.get(this.slotItems.get(gid)?.mst ?? -1)?.cat ?? 0;
                if (!AIRCRAFT_CATS.has(cat)) return;
                this.sortieStartOnslot.set(gid, Number(s.api_onslot?.[idx]) || 0);
            });
        }
    }

    // 戰前 damecon>0、戰後 battle.ts 回報變 0 ⇒ 本場觸發並消耗（battle.ts 的 takeDamage 只在
    // 觸發時才把 s.damecon 歸零，未觸發則整場維持原值不變，故這個比對可靠）。記下後
    // getDamecon() 下個節點才不會誤把同一顆道具當成還沒用過（見欄位宣告處的說明）。
    private markDameconConsumed(pre: { main: number[]; escort: number[] }, f: BattleFleetView) {
        const mark = (deck: any, preArr: number[], post: (BattleShipView | null)[]) => {
            if (!deck) return;
            const ids = deck.api_ship.filter((id: number) => id > 0);
            ids.forEach((id: number, i: number) => {
                if (!((preArr[i] ?? 0) > 0 && post[i] && post[i]!.damecon === 0)) return;
                this.damaconUsed.add(id);
                // 女神（種別2）另需補回燃彈，但要等本節點的燃彈消耗套用完才補（見 restoreGoddessSupply）
                if (preArr[i] === 2) this.goddessRestored.add(id);
            });
        };
        mark(this.decks[this.currentSortieFleetId], pre.main, f.playerMain);
        if (this.currentSortieFleetId === 0 && this.decks[1]) mark(this.decks[1], pre.escort, f.playerEscort);
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
                // 退避艦已先行回港，不再跟著消耗燃彈
                if (this.escapedShipIds.has(id)) continue;
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

    /**
     * 渦潮：`api_happening` 出現時依 KC3Kai 查表＋電探減輕逐艦扣燃／彈。
     * 表外節點不猜、不扣（與 KC3Kai 相同）。連合 A／B 各隊分開計電探同樣擱置。
     */
    private applyMaelstromIfAny(api: any, edgeId: number): void {
        const happening = readMaelstromHappening(api);
        if (!happening || !this.sortieInfo) return;
        const { mapArea, mapNo } = this.sortieInfo;
        const decks = [this.decks[this.currentSortieFleetId]];
        if (this.combinedFlag > 0 && this.currentSortieFleetId === 0 && this.decks[1]) {
            decks.push(this.decks[1]);
        }
        const snaps: MaelstromShipSnap[] = [];
        for (const deck of decks) {
            for (const sid of deck?.api_ship ?? []) {
                if (!(sid > 0)) continue;
                const s = this.ships.get(sid);
                if (!s) continue;
                const hasRadar = (s.api_slot ?? []).some((gid: number) => {
                    if (!(gid > 0)) return false;
                    const cat = this.masterGears.get(this.slotItems.get(gid)?.mst ?? -1)?.cat ?? 0;
                    return MAELSTROM_RADAR_CATS.has(cat);
                });
                snaps.push({
                    id: sid,
                    fuel: Math.max(0, Math.floor(Number(s.api_fuel) || 0)),
                    ammo: Math.max(0, Math.floor(Number(s.api_bull) || 0)),
                    hasRadar,
                    escaped: this.escapedShipIds.has(sid),
                });
            }
        }
        const planned = planMaelstromLosses(mapArea, mapNo, edgeId, happening, snaps);
        if (!planned.def || planned.losses.size === 0) return;
        for (const [id, loss] of planned.losses) {
            const s = this.ships.get(id);
            if (!s) continue;
            if (planned.rsc === 'fuel') {
                s.api_fuel = Math.max(0, Math.floor(Number(s.api_fuel) || 0) - loss);
            } else {
                s.api_bull = Math.max(0, Math.floor(Number(s.api_bull) || 0) - loss);
            }
        }
    }

    /**
     * 結算封包的 api_escape → 實際要退的位置（1-based）。
     * inspired by KC3Kai：陣列可能列多艘候補，**只取 [0]**；沒有 escape 就不標。
     */
    private static parseEscapeIdx(escape: any): { escape: number; tow: number | null } | null {
        if (!escape || typeof escape !== 'object') return null;
        const first = (v: unknown): number | null => {
            const n = Number(Array.isArray(v) ? v[0] : undefined);
            return Number.isSafeInteger(n) && n >= 1 && n <= 12 ? n : null;
        };
        const escapePos = first(escape.api_escape_idx);
        if (escapePos == null) return null;
        return { escape: escapePos, tow: first(escape.api_tow_idx) };
    }

    /**
     * 這艘能不能當護衛退避的曳航艦（使用者提供之遊戲設定）：駆逐艦、未退避、**損傷未達
     * 小破**（殘 HP > 最大值的 75%）。⚠️ 門檻是「未達小破」不是「滿血」——かすり傷照樣
     * 拖得動；用滿血判定會謊報「沒有退避選項」。呼叫端已負責排除第2艦隊旗艦（位置條件）。
     * 僅供 `retreatAvailability()` 預告用；實際 goback_port 標記走封包 [0]（見 resolveEscape）。
     */
    private canTowEscort(id: number): boolean {
        if (this.escapedShipIds.has(id)) return false;
        const s = this.ships.get(id);
        if (!s) return false;
        if (this.master.get(s.api_ship_id)?.stype !== 2) return false;   // 駆逐艦
        const hp = Number(s.api_nowhp), maxHp = Number(s.api_maxhp);
        return hp > 0 && maxHp > 0 && hp * 4 > maxHp * 3;
    }

    /**
     * 位置 → 這次實際退避的艦（最多兩艘）。inspired by KC3Kai：只認 parseEscapeIdx 留下的
     * 各 [0]；單艦隊不採 tow（護衛退避只屬連合）。旗艦哨兵解不出則整筆不標。
     */
    private resolveEscape(pending: { escape: number; tow: number | null }): EscapeSlot[] {
        const escapee = this.shipAtSortiePos(pending.escape);
        if (!escapee) return [];
        const combined = this.combinedFlag > 0 && this.currentSortieFleetId === 0;
        if (!combined || pending.tow == null) return [escapee];
        const tow = this.shipAtSortiePos(pending.tow);
        if (!tow || tow.id === escapee.id) return [escapee];
        return [escapee, tow];
    }

    // 退避位置（1-based）→ 艦實例 id。連合艦隊出擊時 1-6＝主隊、7-12＝隨伴（第2艦隊）；
    // 非連合出擊（含七艘的遊撃部隊）則整段落在出擊那一隊，7 就是第七艘。
    //
    // **連同解出的「哪一隊、隊內第幾格」一起回傳**：呼叫端（goback_port）還要拿同一個
    // 位置去標記戰鬥檢視上的那一格，若讓它自己再推一次連合／索引規則，日後這條規則一改
    // 就會有一邊沒跟上，變成 escapedShipIds 與 battleInfo 標到不同艘船。
    private shipAtSortiePos(pos: number): EscapeSlot | null {
        const combined = this.combinedFlag > 0 && this.currentSortieFleetId === 0;
        // 兩隊的旗艦都不可能退避（大破艦、護衛艦皆然）。這同時是索引基準的哨兵：
        // 真的解到旗艦位置就代表我們對 api_escape_idx 的基準推定錯了，此時**寧可不標**
        // （警告維持原樣）也不要標錯船。
        if (pos === 1 || (combined && pos === 7)) return null;
        const escort = combined && pos > 6;
        const index = escort ? pos - 7 : pos - 1;
        const deck = this.decks[escort ? 1 : this.currentSortieFleetId];
        const ids = (deck?.api_ship ?? []).filter((id: number) => id > 0);
        const id = ids[index];
        return id > 0 ? { id, escort, index } : null;
    }

    // 退避旗標陣列（與 getPlayerDamecons 同序：各艦隊「存在艦」的 0-based 位置）。
    private getEscapedFlags(api: any): { main: boolean[]; escort: boolean[] } {
        if (this.escapedShipIds.size === 0) return { main: [], escort: [] };
        const flags = (deck: any): boolean[] => (deck?.api_ship ?? [])
            .filter((id: number) => id > 0)
            .map((id: number) => this.escapedShipIds.has(id));
        return {
            main: flags(this.decks[this.currentSortieFleetId]),
            escort: GameState.hasEscortFleet(api) && this.currentSortieFleetId === 0
                ? flags(this.decks[1]) : [],
        };
    }

    /**
     * 抵達某節點時，若它是 boss（`api_color_no === 5`）就把當下的大破狀態拍進
     * `bossEntryTaiha`。同一次出擊只拍第一次抵達（`!== null` 即跳過）——重複抵達
     * boss 節點在機制上不會發生，但夜戰接續等封包不該把已拍好的快照覆蓋掉。
     */
    private noteBossEntry(node: SortieNode) {
        if (node.color !== 5 || this.bossEntryTaiha !== null) return;
        this.bossEntryTaiha = this.sortieFleetHasTaiha();
    }

    /**
     * 出擊中的艦隊（含連合隨伴）現在有沒有大破艦。
     *
     * 這裡用的是**最素的大破定義**：殘 HP > 0 且 ≤ 最大值的 25%、且未退避。刻意不比照
     * `analyzeBattle` 的 `isTaiha`（那支還排除主隊旗艦、隨伴旗艦與帶損管者，因為它回答
     * 的是「進擊會不會被轟沈」）——本方法回答的是「進 boss 之前身上有沒有傷」，旗艦大破
     * 同樣算，那也是玩家帶傷進來的證據。
     */
    private sortieFleetHasTaiha(): boolean {
        const decks = [this.decks[this.currentSortieFleetId]];
        // 連合艦隊出擊時第2艦隊一起進去；判定基準同 applyConsumption（旗艦隊必須是第1隊）。
        if (this.combinedFlag > 0 && this.currentSortieFleetId === 0 && this.decks[1]) decks.push(this.decks[1]);
        for (const deck of decks) {
            for (const sid of deck?.api_ship ?? []) {
                if (sid <= 0 || this.escapedShipIds.has(sid)) continue;
                const s = this.ships.get(sid);
                if (!s) continue;
                const hp = Number(s.api_nowhp), maxHp = Number(s.api_maxhp);
                if (hp > 0 && maxHp > 0 && hp * 4 <= maxHp) return true;
            }
        }
        return false;
    }

    // 応急修理女神發動後燃彈全快。呼叫時機見 battleresult 分支（消耗套用之後）。
    private restoreGoddessSupply() {
        for (const id of this.goddessRestored) {
            const s = this.ships.get(id);
            const m = s && this.master.get(s.api_ship_id);
            if (!s || !m) continue;
            s.api_fuel = m.fuelMax;
            s.api_bull = m.bullMax;
        }
        this.goddessRestored.clear();
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
        if (this.damaconUsed.has(shipId)) return 0;
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
        const cached = this.baseShipIdCache.get(start);
        if (cached !== undefined) return cached;
        const resolved = this.resolveBaseShipId(start);
        this.baseShipIdCache.set(start, resolved);
        return resolved;
    }

    /** baseShipId() 的實作本體（未快取）。輸入已驗證為正整數 master id。 */
    private resolveBaseShipId(start: number): number | null {
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

    /**
     * 名冊裡是否已經有這艘船，以**基礎形態**比對——手上是「吹雪改二」時打撈到「吹雪」
     * 算已持有（同 baseShipId 的圖鑑視角）。master 未載入時 baseShipId 會退化成回傳
     * 自己，此時等同精確 master id 比對，仍是誠實的保守答案。
     *
     * ⚠️ **要在 battleresult 當下呼叫才有意義**：這一場打撈到的新船要等
     * `api_port/port` 才會進 `this.ships`，故此刻的名冊正好是「打撈之前」的狀態。
     */
    ownsShip(masterId: number | undefined): boolean {
        const base = this.baseShipId(masterId);
        if (base == null) return false;
        for (const s of this.ships.values()) {
            if (this.baseShipId(s.api_ship_id) === base) return true;
        }
        return false;
    }

    // 図鑑番号（api_sortno）。0/缺＝不在図鑑（深海棲艦、佔位條目等）→ 回 null。
    pictureBookNo(masterId: number | undefined): number | null {
        const no = masterId == null ? undefined : this.master.get(masterId)?.sortno;
        return Number.isSafeInteger(no as number) && (no as number) > 0 ? (no as number) : null;
    }

    // 名稱本地化的唯一入口：master id → 目前顯示語言的譯名，缺譯回退封包日文原名。
    // 譯名資料由 utils/gamedata-names.ts 產生，透過 gamedata-i18n.ts 的查表函式使用；
    // 面板亦一律透過這兩個方法取名（含敵艦名），確保翻譯只有一個掛鉤點。
    shipName(masterId: number | undefined): string {
        return localizeShip(masterId, masterId == null ? undefined : this.master.get(masterId)?.name);
    }
    gearName(mstId: number | undefined): string {
        return localizeGear(mstId, mstId == null ? undefined : this.masterGears.get(mstId)?.name);
    }
    // 封包原始日文艦名（不經譯表）。顯示一律走 shipName()，這支只給「hover 看原名」這種
    // 對照用途；master 未載入時回退譯名解析結果，不回空字串。
    shipNameJa(masterId: number | undefined): string {
        return (masterId == null ? undefined : this.master.get(masterId)?.name) || this.shipName(masterId);
    }
    // 封包原始日文裝備名（不經譯表）。顯示一律走 gearName()，這支只給「hover 看原名」
    // 這類對照用途；master 未載入時回退譯名解析結果，不回空字串。
    gearNameJa(mstId: number | undefined): string {
        return (mstId == null ? undefined : this.masterGears.get(mstId)?.name) || this.gearName(mstId);
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
            /** 是否套用了大発動艇系裝備加成（面板據此決定資源數字要不要變色標示）。 */
            bonusActive: boolean;
            /** false＝出擊條件已知，但 fuel/bullet/steel/alum 尚無可信來源（面板須改顯示
             * 「尚未收錄」而非把佔位 0 當真的數字）。`items` 不受影響，一律是封包事實。 */
            amountsVerified: boolean;
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

        // itemtype 1–6 是 poi 資料（2015–2018 年凍結快照）自訂的內部編號，1–3 恰好與目前
        // 封包 api_win_item 的原始值相同（2026-08-03 用 wikiwiki.jp/kancolle/遠征 逐筆核對
        // 確認：1＝高速修復材、2＝高速建造材），但
        // 4/5/6（家具箱小/中/大）在封包裡目前已改用 10/11/12，只有 poi 舊資料仍用 4/5/6，
        // 故兩組數字並存、不可合併。7/11/12/59 是新增遠征（id 41 起）直接取用封包原始值，
        // 其中改修資材撞上舊編號 4（家具箱小），改配 7 這個新編號避免衝突。
        const rewardNames: Record<number, string> = {
            1: '高速修復材', 2: '高速建造材', 3: '開発資材',
            4: '家具箱(小)', 5: '家具箱(中)', 6: '家具箱(大)',
            7: '改修資材', 11: '家具箱(中)', 12: '家具箱(大)',
            59: '給糧艦「伊良湖」',
        };
        const items = (data.reward_items ?? []).map((it: any, i: number, arr: any[]) => ({
            name: rewardNames[it.itemtype] ?? `種別${it.itemtype}`,
            max: it.max_number,
            guaranteed: arr.length >= 2 && i === arr.length - 1,   // 推測:複数ある場合、最後は大成功限定
        }));
        // 大発動艇系裝備的資源加成（社群機制轉寫，非封包驗證，見 expedition-bonus.ts）。
        const bonus = computeExpeditionBonus(collectLandingCraftGears(ships, this.slotItems));
        const rewards = {
            normal: {
                fuel: applyExpeditionBonus(data.reward_fuel, bonus),
                bullet: applyExpeditionBonus(data.reward_bullet, bonus),
                steel: applyExpeditionBonus(data.reward_steel, bonus),
                alum: applyExpeditionBonus(data.reward_alum, bonus),
            },
            great: {
                fuel: applyExpeditionBonus(data.reward_fuel, bonus, 1.5),
                bullet: applyExpeditionBonus(data.reward_bullet, bonus, 1.5),
                steel: applyExpeditionBonus(data.reward_steel, bonus, 1.5),
                alum: applyExpeditionBonus(data.reward_alum, bonus, 1.5),
            },
            items,
            bonusActive: bonus.active,
            amountsVerified: !data.rewardAmountsUnverified,
        };
        return { rows, gsRows, known: true, time: mst.time, rewards, greatSuccess };
    }

    // ── 制空・索敵 ──────────────────────────────
    private static EXP_LO = [0, 10, 25, 40, 55, 70, 85, 100];
    private static EXP_HI = [9, 24, 39, 54, 69, 84, 99, 120];
    private static BONUS_F = [0, 0, 2, 5, 9, 14, 14, 22];
    private static BONUS_SPB = [0, 0, 1, 1, 1, 3, 3, 6];

    // 以下四個艦隊合計（制空／索敵／TP／fleetSummary 的 Lv・速力）一律**排除退避艦**：
    // 退避後就是剩下的船在繼續進擊，戰力必須按剩下的船重算（見 escapedShipIds）。
    airPower(deckIdx: number): { min: number; max: number } {
        const deck = this.decks[deckIdx];
        let min = 0, max = 0;
        if (!deck) return { min, max };
        for (const sid of deck.api_ship) {
            if (this.escapedShipIds.has(sid)) continue;
            const s = this.ships.get(sid);
            if (!s) continue;
            (s.api_slot ?? []).forEach((instId: number, i: number) => {
                const onslot = s.api_onslot?.[i] ?? 0;
                if (onslot <= 0 || instId <= 0) return;
                const it = this.slotItems.get(instId);
                const g = it && this.masterGears.get(it.mst);
                if (!it || !g) return;
                const t = g.cat;
                // 艦上機（艦戦6／艦爆7／艦攻8）・水上機（水戦45／水爆11）・噴式機（56/57）
                // 才參與制空。局戦(48) 併在 AIR_TB_FIGHTER 裡一起判——它裝不上艦，實務上
                // 不會命中，但共用同一個集合可確保艦上／基地兩支的戰鬥機定義不會各自漂移。
                const isDB = t === 7, isSPB = t === AIR_TB_SEAPLANE_BOMBER;
                if (!(AIR_TB_FIGHTER.has(t) || isDB || t === 8 || isSPB || t === 56 || t === 57)) return;
                const aa = g.aa + (AIR_IMP_FIGHTER.has(t) ? 0.2 * it.level : isDB ? 0.25 * it.level : 0);
                const alv = Math.min(7, it.alv);
                // 機種類型加成：戰鬥機系查 BONUS_F、水爆查 BONUS_SPB，其餘（含噴式機）為 0。
                // 下面的 √(内部熟練度/10) 則是**所有機種都有**，故噴式機仍非全無加成。
                const tb = AIR_TB_FIGHTER.has(t) ? GameState.BONUS_F[alv]
                    : isSPB ? GameState.BONUS_SPB[alv] : 0;
                const base = aa * Math.sqrt(onslot) + tb;
                min += Math.floor(base + Math.sqrt(GameState.EXP_LO[alv] / 10));
                max += Math.floor(base + Math.sqrt(GameState.EXP_HI[alv] / 10));
            });
        }
        return { min, max };
    }

    /**
     * 這一隊有沒有「熟練度可能已過時」的艦載機格（見 alvStaleGears）。退避艦不算
     * ——牠已經離隊，不計入這一隊的制空，過不過時都不影響顯示的數字。
     */
    private deckAlvStale(deckIdx: number): boolean {
        if (this.alvStaleGears.size === 0) return false;
        for (const sid of this.decks[deckIdx]?.api_ship ?? []) {
            if (sid <= 0 || this.escapedShipIds.has(sid)) continue;
            const s = this.ships.get(sid);
            if (s?.api_slot?.some((gid: number) => this.alvStaleGears.has(gid))) return true;
        }
        return false;
    }

    f33(deckIdx: number, cn = 1): number {
        const deck = this.decks[deckIdx];
        if (!deck) return 0;
        let equipTerm = 0, shipTerm = 0, n = 0;
        for (const sid of deck.api_ship) {
            if (this.escapedShipIds.has(sid)) continue;   // 退避艦不計，艦數修正 2×(6-n) 也跟著變
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
    // 公開輸送作戰表：基本TP = Σ艦種別 + Σ裝備。此為 S勝利基準值（皆整數），
    // 最終TP = floor(基本TP × rank倍率[S1.0/A0.7/B0.4]，C以下揚陸失敗)。
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
        // 未列艦種（雷巡、重巡、輕空母、戰艦、正空、潛水艦、工作艦、海防艦等）→ 0
    };
    // 裝備類別預設 TP（api_mst_slotitem_equiptype id），提供未知新裝備同類別備援。
    private static TP_BY_GEAR_CAT: Record<number, number> = {
        24: 8, // 上陸用舟艇
        30: 5, // 簡易輸送部材
        46: 2, // 特型内火艇
        43: 1, // 戦闘糧食
    };
    // 裝備 master id 專屬 TP（含陸戰部隊等非通用類別之裝備與全部大發/內火艇/糧食等明細表）。
    private static TP_BY_GEAR_MST: Record<number, number> = {
        // 上陸用舟艇 (8 TP)
        68: 8,    // 大発動艇
        166: 8,   // 大発動艇(八九式中戦車&陸戦隊)
        193: 8,   // 特大発動艇
        230: 8,   // 特大発動艇+戦車第11連隊
        355: 8,   // M4A1 DD
        408: 8,   // 装甲艇(AB艇)
        409: 8,   // 武装大発
        436: 8,   // 大発動艇(II号戦車/北アフリカ仕様)
        449: 8,   // 特大発動艇+一式砲戦車
        482: 8,   // 特大発動艇+Ⅲ号戦車(北アフリカ仕様)
        494: 8,   // 特大発動艇+チハ
        495: 8,   // 特大発動艇+チハ改
        514: 8,   // 特大発動艇+Ⅲ号戦車J型
        576: 8,   // 大発動艇(R35&フランス兵)

        // 簡易輸送部材 (5 TP)
        75: 5,    // ドラム缶(輸送用)

        // 特型内火艇 (2 TP)
        167: 2,   // 特二式内火艇
        525: 2,   // 特四式内火艇
        526: 2,   // 特四式内火艇改

        // 戦闘糧食 (1 TP)
        145: 1,   // 戦闘糧食
        150: 1,   // 秋刀魚の缶詰
        241: 1,   // 戦闘糧食(特別なおにぎり)

        // 陸戦部隊（第百一号輸送艦專用）
        496: 5,   // 陸軍歩兵部隊
        497: 7,   // 九七式中戦車(チハ)
        498: 9,   // 九七式中戦車 新砲塔(チハ改)
        499: 14,  // 陸軍歩兵部隊+チハ改
    };
    // 特殊艦娘固有 TP 加成（未退避時生效；例如鬼怒改二自帶大發效果 +8 TP）
    private static TP_BY_SHIP_MST: Record<number, number> = {
        487: 8, // 鬼怒改二
    };

    // 出擊編成的 S勝利基本輸送量。回傳 { total, gear }（gear>0 才是輸送編成，顯示端據此判斷）。
    // 已退避艦不計（見 escapedShipIds）；轟沈艦仍計入——本專案不追蹤轟沈，且轟沈在
    // 遊戲裡本來就會直接強制返航，不存在「帶著轟沈艦繼續輸送」的情境。
    fleetTP(deckIdx: number): { total: number; gear: number } {
        const deck = this.decks[deckIdx];
        if (!deck) return { total: 0, gear: 0 };
        let shipTP = 0, gearTP = 0;
        for (const sid of deck.api_ship) {
            if (sid <= 0 || this.escapedShipIds.has(sid)) continue;
            const s = this.ships.get(sid);
            if (!s) continue;
            const stype = this.master.get(s.api_ship_id)?.stype ?? 0;
            shipTP += GameState.TP_BY_STYPE[stype] ?? 0;   // 未列 = 0

            // 艦娘固有 TP 加成（例如鬼怒改二內建大發效果 +8 TP）
            const shipBonusTP = GameState.TP_BY_SHIP_MST[s.api_ship_id] ?? 0;
            gearTP += shipBonusTP;

            const slots = [...(s.api_slot ?? []), s.api_slot_ex > 0 ? s.api_slot_ex : -1];
            for (const instId of slots) {
                if (instId <= 0) continue;
                const it = this.slotItems.get(instId);
                if (!it) continue;
                // 優先查 master id 明細表，若無則按裝備類別（cat）預設值備援
                const mstTP = GameState.TP_BY_GEAR_MST[it.mst];
                if (mstTP !== undefined) {
                    gearTP += mstTP;
                } else {
                    const cat = this.masterGears.get(it.mst)?.cat ?? 0;
                    gearTP += GameState.TP_BY_GEAR_CAT[cat] ?? 0;
                }
            }
        }
        return { total: shipTP + gearTP, gear: gearTP };
    }

    fleetSummary(deckIdx: number, cn = 1) {
        const deck = this.decks[deckIdx];
        if (!deck) return null;
        let lvSum = 0, minSoku = 20;
        for (const sid of deck.api_ship) {
            if (this.escapedShipIds.has(sid)) continue;
            const s = this.ships.get(sid);
            if (!s) continue;
            lvSum += s.api_lv ?? 0;
            minSoku = Math.min(minSoku, s.api_soku ?? 20);
        }
        const speed = minSoku >= 20 ? t('speed.fastest') : minSoku >= 15 ? t('speed.fastPlus') : minSoku >= 10 ? t('speed.fast') : t('speed.slow');
        // airStale：這一隊制空的熟練度成分可能已經過時（見 alvStaleGears）。呼叫端必須
        // 標示，不能讓偏高的舊值裝成封包事實。
        return {
            lvSum, speed, air: this.airPower(deckIdx), airStale: this.deckAlvStale(deckIdx),
            f33: this.f33(deckIdx, cn), tp: this.fleetTP(deckIdx),
        };
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
                if (this.escapedShipIds.has(sid)) continue;
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
        return {
            lvSum, speed, air: { min: airMin, max: airMax },
            airStale: this.deckAlvStale(0) || this.deckAlvStale(1),
            f33, tp: { total: tpTotal, gear: tpGear },
        };
    }

    // ── 退避可用性（面板提示用；使用者提供之遊戲設定，非封包驗證）─────────────────
    // 三顆司令部系裝備**各自綁定一種編制，不可互換**：
    //   · 107 艦隊司令部施設      → 連合艦隊。護衛退避（大破艦＋一艘健康驅逐艦一起離場）。
    //   · 272 遊撃部隊 艦隊司令部 → 七艘編成的遊撃部隊。單艦退避。
    //   · 413 精鋭水雷戦隊 司令部 → 水雷戦隊（輕巡系旗艦帶驅逐艦等小型艦）。單艦退避。
    // 裝了不對應編制的那一顆＝沒有退避選項（例：連合艦隊帶 272 無效、單艦隊帶 107 無效）。
    // **一律只看出擊主隊旗艦那一格**——裝在其他艦上完全無效，這是最常被誤解的一條。
    private static COMMAND_FACILITY_COMBINED = 107;
    private static COMMAND_FACILITY_STRIKING = 272;
    private static COMMAND_FACILITY_TORPEDO = 413;
    // 水雷戦隊編成的艦種門檻（api_mst_stype：1 海防艦／2 駆逐艦／3 軽巡洋艦／
    // 4 重雷装巡洋艦／21 練習巡洋艦）。**使用者提供之描述「以輕巡洋艦為旗艦帶領驅逐艦等
    // 小型艇」的轉寫，非封包驗證**；雷巡／練巡是否真的算旗艦資格未逐條確認，故取「能裝
    // 得上這顆的輕巡系」這個較寬的讀法——寧可提示成立、由玩家以遊戲畫面確認，也不要
    // 因為漏列一個艦種就謊報「沒有退避選項」。
    private static TORPEDO_FLAGSHIP_STYPES = new Set([3, 4, 21]);
    private static TORPEDO_CONSORT_STYPES = new Set([1, 2, 3, 4, 21]);

    private flagshipHasGear(deckIdx: number, mstIds: number[]): boolean {
        const flagshipId = (this.decks[deckIdx]?.api_ship ?? []).find((id: number) => id > 0);
        const s = flagshipId > 0 ? this.ships.get(flagshipId) : null;
        if (!s) return false;
        const slots = [...(s.api_slot ?? []), s.api_slot_ex > 0 ? s.api_slot_ex : -1];
        return slots.some((instId: number) => {
            const it = instId > 0 ? this.slotItems.get(instId) : null;
            return !!it && mstIds.includes(it.mst);
        });
    }

    /** 該艦實例的艦種 id（master 未載入時 0＝不可考）。 */
    private stypeOfShip(shipId: number): number {
        const s = this.ships.get(shipId);
        return (s && this.master.get(s.api_ship_id)?.stype) ?? 0;
    }

    /**
     * 這一隊是不是「水雷戦隊」編成＝精鋭水雷戦隊 司令部(413) 的成立前提。
     * 旗艦為輕巡系、其餘皆為驅逐艦等小型艦（門檻見 TORPEDO_*_STYPES 的說明）。
     * **使用者提供之遊戲設定的轉寫，非封包驗證**，面板只當提示。
     */
    private isTorpedoSquadron(shipIds: number[]): boolean {
        if (shipIds.length < 2) return false;
        if (!GameState.TORPEDO_FLAGSHIP_STYPES.has(this.stypeOfShip(shipIds[0]))) return false;
        return shipIds.slice(1).every(id => GameState.TORPEDO_CONSORT_STYPES.has(this.stypeOfShip(id)));
    }

    /**
     * 這次出擊「大破艦有沒有退避這條路可走」，以及成立的是哪一顆司令部。
     *
     * `state`：
     * - `'none'`     沒有任何一顆司令部**在對應的編制下**成立 → 不會出現退避選項。
     * - `'ready'`    條件看起來成立。
     * - `'noEscort'` 連合艦隊限定：旗艦帶了艦隊司令部施設，但第2艦隊找不到可當護衛艦的
     *                驅逐艦 → **遊戲不會給退避選項**。這個狀態必須讓使用者看到：
     *                「沒出現護衛退避」不等於「沒有人大破」，誤會這點就會大破進擊。
     *
     * `kind`：成立的編制種類，讓呼叫端挑正確的說明文案——**連合是「護衛退避」（大破艦
     * ＋一艘健康驅逐艦一起離場），遊撃部隊／水雷戦隊是「單艦退避」（只有大破艦離場、
     * 不需要護衛艦）**，兩者的條件與後果都不同，不能共用一套說明。
     *
     * 護衛艦規則（連合限定，使用者提供之遊戲設定）：從**第2艦隊**的 2 號艦起，**依隊內
     * 順位由上到下**挑第一艘「損傷未達小破」的驅逐艦；第1艦隊的驅逐艦再健康也不能當護衛
     * 艦，第2艦隊旗艦同樣不行。⚠️ **門檻是「未達小破」不是「滿血」**——かすり傷（殘 HP
     * 高於 75%）照樣拖得動，用滿血判定會把它謊報成 `'noEscort'`（＝「沒有退避選項」），
     * 那正是最危險的誤讀方向。判定集中在 canTowEscort()（僅供本預告）；goback_port
     * 實際標記走封包各陣列 [0]（KC3Kai），不在這裡重濾。
     */
    retreatAvailability(): RetreatAvailability {
        const none: RetreatAvailability = { state: 'none', kind: null };
        const deckIdx = this.currentSortieFleetId;
        const ships = (this.decks[deckIdx]?.api_ship ?? []).filter((id: number) => id > 0);
        const combined = this.combinedFlag > 0 && deckIdx === 0;

        if (combined) {
            // 連合艦隊只認 107。272／413 在連合艦隊完全無效，故這裡不回退去看它們。
            if (!this.flagshipHasGear(deckIdx, [GameState.COMMAND_FACILITY_COMBINED])) return none;
            const escortable = (this.decks[1]?.api_ship ?? [])
                .filter((id: number) => id > 0)
                .slice(1)                                   // 第2艦隊旗艦不能當護衛艦
                .some((id: number) => this.canTowEscort(id));
            return { state: escortable ? 'ready' : 'noEscort', kind: 'combined' };
        }

        // 單艦隊：兩顆司令部各綁一種編制，**不可互換**，107 在此完全無效。
        // 兩者都是單艦退避（不需要護衛艦），故只有 ready／none 兩態，沒有 noEscort。
        // **一顆不成立要繼續看下一顆**：旗艦可能同時帶著 272＋413（例：輕巡旗艦的六艘
        // 水雷戦隊），272 因艦數不是 7 而不成立時若直接回 none，實際成立的 413 單艦退避
        // 就會被謊報成「沒有退避選項」——那正是「沒出現退避選項 ≠ 沒有人大破」的誤讀。
        // 遊撃部隊＝七艘編成。七艘這件事本身就是 272 做出來的（封包事實，見 CLAUDE.md
        // 出擊紀錄「連合艦隊編成類型」），故艦數即編制的判準。
        if (ships.length === 7 && this.flagshipHasGear(deckIdx, [GameState.COMMAND_FACILITY_STRIKING])) {
            return { state: 'ready', kind: 'striking' };
        }
        if (this.isTorpedoSquadron(ships) && this.flagshipHasGear(deckIdx, [GameState.COMMAND_FACILITY_TORPEDO])) {
            return { state: 'ready', kind: 'torpedo' };
        }
        return none;
    }

    fleets(): FleetView[] {
        const dockCompleteById = new Map<number, number>();
        for (const n of this.ndockData) {
            if (n.api_state > 0 && n.api_ship_id > 0) {
                const at = Number(n.api_complete_time);
                dockCompleteById.set(n.api_ship_id as number, Number.isFinite(at) && at > 0 ? at : 0);
            }
        }
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
                        nameJa: this.shipNameJa(s.api_ship_id),
                        stype: STYPE_ABBR[mst?.stype ?? 0] ?? '',
                        mst: s.api_ship_id, stypeId: mst?.stype ?? 0,
                        ndockTime: Number(s.api_ndock_time ?? 0),
                        inDock: dockCompleteById.has(id),
                        dockCompleteAt: dockCompleteById.get(id) || null,
                        escaped: this.escapedShipIds.has(id),
                        lv: s.api_lv, hp: s.api_nowhp, maxhp: s.api_maxhp, cond: s.api_cond,
                        fuel: s.api_fuel ?? 0, maxFuel: mst?.fuelMax ?? 0,
                        bull: s.api_bull ?? 0, maxBull: mst?.bullMax ?? 0,
                        firepower: Array.isArray(s.api_karyoku) ? Number(s.api_karyoku[0]) || 0 : 0,
                        luck: Array.isArray(s.api_lucky) ? Number(s.api_lucky[0]) || 0 : 0,
                        gears: slots.map((gid: number, idx: number) => {
                            const gv = this.gearOf(gid);
                            // 裝備為飛機的槽才附搭載數；滿載數取 master 的 maxeq
                            // （可能 undefined，見上方註解）。出擊途中的 api_onslot 已由
                            // spreadPlaneLoss 依封包的合計損失估算調整過，故一併標 countEst。
                            if (gv) {
                                const it = this.slotItems.get(gid);
                                const mg = it && this.masterGears.get(it.mst);
                                if (mg && AIRCRAFT_CATS.has(mg.cat)) {
                                    gv.count = s.api_onslot?.[idx] ?? 0;
                                    gv.countMax = mst?.maxeq?.[idx];
                                    if (this.planeLossEstimated.has(id) && AIR_COMBAT_CATS.has(mg.cat)) gv.countEst = true;
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
                    missionId: Number(d.api_mission[1]) || 0,
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

    /**
     * 基地航空隊**出撃**制空。公式與艦上 `airPower()` 不同（wikiwiki／KC3Kai）：
     *
     *   各中隊 = ⌊(対空 + 1.5×迎撃 + 改修補正) × √搭載 + 機種熟練補正⌋
     *   合計   = ⌊Σ中隊 × 陸偵倍率⌋
     *
     * ⚠️ 以下三項都會影響基地航空隊制空，計算不可省略：
     *   1. **迎撃×1.5**（局戦/陸戦 `api_type[2]=48` 才有；`api_houk` 在這類裝備＝迎撃
     *      不是迴避）。隼II型(64戦隊) 一格就差約 +32。
     *   2. **陸偵出撃倍率**：同隊有 type 49 時依索敵 ≥9 → ×1.18、否則 ×1.15
     *      （只認陸上偵察機，艦偵／水偵不套這條；防空倍率是另一套，本函式不算防空）。
     *   3. **改修★**：陸攻 0.5√★、陸偵 0.2×★（艦戦/局戦仍是 0.2×★）。陸攻這項
     *      舊 wiki 曾寫「改修不影響制空」，但 KC3Kai 與實測對得上的是 0.5√★。
     */
    lbasAirPower(areaId: number, rid: number): { min: number; max: number } {
        const ab = this.airBases.get(airBaseKey({ areaId, rid }));
        let min = 0, max = 0;
        if (!ab) return { min, max };
        let reconModifier = 1;
        for (const sq of ab.api_plane_info ?? []) {
            if (sq.api_state !== 1 || sq.api_slotid <= 0) continue;
            const onslot = sq.api_count ?? 0;
            if (onslot <= 0) continue;
            const it = this.slotItems.get(sq.api_slotid);
            const g = it && this.masterGears.get(it.mst);
            if (!it || !g) continue;
            const t = g.cat;
            // 制空參與機種：艦戦(6)・水戦(45)・**局戦/陸戦(48)**・艦爆(7)・艦攻(8)・
            //              水爆(11)・陸攻(47)・陸偵(49)・噴式機(56/57)。
            // ⚠️ 48 是局戦／陸戦，必須納入基地航空隊制空；56/57 是噴式機，不屬於局戦／陸戦。
            const isDB = t === 7;
            const isSPB = t === AIR_TB_SEAPLANE_BOMBER;
            const isInterceptor = t === 48;   // 局戦/陸戦（迎撃欄位只在這類成立）
            const isLBA = t === 47;           // 陸攻
            const isLBR = t === 49;           // 陸偵
            if (!(AIR_TB_FIGHTER.has(t) || isDB || t === 8 || isSPB || isLBA || isLBR
                || t === 56 || t === 57)) continue;
            // 改修補正：艦戦/水戦/局戦/陸偵 +0.2★、艦爆 +0.25★、陸攻 0.5√★
            const improve = AIR_IMP_FIGHTER.has(t) || isLBR ? 0.2 * it.level
                : isDB ? 0.25 * it.level
                : isLBA ? 0.5 * Math.sqrt(it.level)
                : 0;
            // 出撃対空相當値＝対空 + 1.5×迎撃（迎撃＝局戦的 api_houk）+ 改修
            const intercept = isInterceptor ? (g.stats.houk ?? 0) : 0;
            const aa = g.aa + 1.5 * intercept + improve;
            const alv = Math.min(7, it.alv);
            const tb = AIR_TB_FIGHTER.has(t) ? GameState.BONUS_F[alv]
                : isSPB ? GameState.BONUS_SPB[alv] : 0;
            const base = aa * Math.sqrt(onslot) + tb;
            min += Math.floor(base + Math.sqrt(GameState.EXP_LO[alv] / 10));
            max += Math.floor(base + Math.sqrt(GameState.EXP_HI[alv] / 10));
            if (isLBR) {
                // 多架陸偵取最高倍率（KC3Kai fighterPowerReconModifier）
                reconModifier = Math.max(reconModifier, g.los >= 9 ? 1.18 : 1.15);
            }
        }
        return {
            min: Math.floor(min * reconModifier),
            max: Math.floor(max * reconModifier),
        };
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
                        cond: Number.isFinite(sq.api_cond) ? sq.api_cond : null,
                    };
                }
                const it = this.slotItems.get(sq.api_slotid);
                const g = it && this.masterGears.get(it.mst);
                const icon = GEAR_ICON[g?.icon ?? 0] ?? { s: '装', c: 'c-etc' };
                return {
                    slotId: sq.api_slotid,
                    state: sq.api_state,
                    name: this.gearName(it?.mst),
                    short: icon.s, cat: icon.c, icon: g?.icon ?? 0, mst: it?.mst ?? 0,
                    level: it?.level ?? 0, alv: it?.alv ?? 0,
                    count: sq.api_count ?? 0, maxCount: sq.api_max_count ?? 0,
                    cond: Number.isFinite(sq.api_cond) ? sq.api_cond : null,
                };
            });
            const dist = ab.api_distance;
            const distance = (dist?.api_base ?? 0) + (dist?.api_bonus ?? 0);
            const airPower = this.lbasAirPower(ab.api_area_id, ab.api_rid);
            const key = airBaseKey({ areaId: ab.api_area_id, rid: ab.api_rid });
            result.push({
                areaId: ab.api_area_id, rid: ab.api_rid,
                name: ab.api_name ?? `第${ab.api_rid}航空隊`,
                actionKind: ab.api_action_kind ?? 0,
                distance,
                squadrons,
                airPower,
                condAsOf: this.airBaseCondAsOf.get(key) ?? null,
                condRate: this.airBaseCondMinRate.get(key) ?? lbasRecoveryRate(ab.api_action_kind),
            });
        }
        // 按 area_id → rid 排序
        result.sort((a, b) => a.areaId - b.areaId || a.rid - b.rid);
        return result;
    }

    /**
     * 由 `api_req_air_corps/*` 的請求參數找出要更新的基地 key。
     *
     * ⚠️ 這一族端點（set_plane／supply／set_action／change_name）**完全沒有真封包樣本**，
     * 欄位名依社群工具慣例推定，故解析一律防禦：
     *  - `api_base_id` 可能是逗號分隔的多個基地（`set_action` 已實測會這樣送，補給若有
     *    「一括補給」極可能同形）；必須逐項解析，否則無法更新對應基地的機數。
     *  - `api_area_id` 缺席時，若該 rid 在目前的 airBases 裡唯一就用那一個；不唯一不猜。
     */
    /*
     * 2026-08-04 追記（samples/air-corps-supply.json）：真封包的 supply 請求是
     * `api_area_id=62, api_base_id=1, api_squadron_id=4`——**單一基地、逐中隊**，
     * api_area_id 有送。故實務上一律走「單一 key」那條路；逗號分隔與 area 缺席的
     * 退路目前只有 set_action 用得到（那個是實測會送 `1,2`），其餘屬防禦性保留。
     */
    private resolveAirBaseKeys(req: Record<string, string>): { key: string; index: number }[] {
        const area = req.api_area_id;
        const out: { key: string; index: number }[] = [];
        // index＝該基地在 api_base_id 裡的位置：同一族請求的其他參數（如 set_action 的
        // api_action_kind）是**逐位對應**的，解不出來的位置不能讓後面的整排位移。
        String(req.api_base_id ?? '').split(',').forEach((raw, index) => {
            const rid = raw.trim();
            if (!rid) return;
            const key = airBaseKey({ areaId: area, rid });
            if (this.airBases.has(key)) { out.push({ key, index }); return; }
            // area 對不上（或沒送）時的唯一解退路
            const sameRid = [...this.airBases.keys()].filter(k => k.endsWith(`_${rid}`));
            if (sameRid.length === 1) out.push({ key: sameRid[0]!, index });
        });
        return out;
    }

    /** 記下「這個基地的 cond 是這一刻觀測到的」，並把回復速度重設為當下的札 */
    private markAirBaseCondObserved(key: string, ts: number) {
        if (!Number.isFinite(ts)) return;
        this.airBaseCondAsOf.set(key, ts);
        this.airBaseCondMinRate.set(key, lbasRecoveryRate(this.airBases.get(key)?.api_action_kind));
    }

    actionLabel(kind: number): string {
        return kind >= 0 && kind <= 4 ? t(`ab.action.${kind}`) : t('ab.action.unknown', { n: kind });
    }

    /**
     * 基地航空隊中隊疲勞的面板狀態碼。
     *
     * **`api_cond` 是顯示碼，不是遊戲內部的 0–46 疲勞值**（0 若是原始值就會是最慘的赤，
     * 但收到全 0 的那份封包時遊戲畫面六隊全無標記）。對照（2026-08-04 以四份真封包
     * ＋實機畫面定案，同一隊 62_2 在一晚內隨著連續出撃走完 0→1→2→3）：
     *
     *   · `0` → 全滿／完全休息，無標記　`samples/mapinfo-air-base.json`（六隊 24 中隊全 0）
     *   · `1` → **輕度疲勞，但遊戲同樣不顯示標記**　`samples/mapinfo-air-base-tired.json`
     *     ＋ `samples/air-corps-supply.json`（剛出撃回來補給的中隊）。KC3Kai 會把 0 與 1
     *     畫成兩種不同表情，本專案同樣分開（1 給淡色小點，不給黃臉）。
     *   · `2` → 橙（中度疲勞）　`samples/mapinfo-air-base-exhausted.json`
     *   · `3` → 赤（重度疲勞）　`samples/mapinfo-air-base-red.json`（使用者確認「紅臉更疲勞」）
     *   · 其餘 → `unknown`，顯示原始值不猜
     *
     * ⚠️ 四段對照固定為：0/1 都無標記、2 橙、3 赤；未知值保留原始數字，不推測語意。
     */
    lbasCondState(cond: number | null): 'normal' | 'mild' | 'tired' | 'exhausted' | 'unknown' {
        if (cond == null || !Number.isFinite(cond)) return 'unknown';
        if (cond === 0) return 'normal';
        if (cond === LBAS_COND_MILD) return 'mild';
        if (cond === LBAS_COND_TIRED) return 'tired';
        if (cond === LBAS_COND_EXHAUSTED) return 'exhausted';
        return 'unknown';
    }

    /**
     * 套用「經過時間」後的疲勞狀態——**面板一律用這支，不要直接用 `lbasCondState()`**。
     *
     * `api_cond` 是觀測當下的快照；遊戲每 3 分鐘在伺服器端回復一次且不推封包，所以放著
     * 不處理會讓面板持續顯示遊戲中已消失的標記。這裡只做單向推論：
     * **連最慢的回復速度都足以到達下一段時**才降級（赤→橙→輕度），其餘原樣回傳。
     * 詳見 `utils/lbas-cond.ts`。
     */
    lbasCondStateNow(
        cond: number | null,
        base: Pick<AirBaseView, 'condAsOf' | 'condRate'>,
        now = Date.now(),
    ): ReturnType<GameState['lbasCondState']> {
        if (base.condAsOf == null) return this.lbasCondState(cond);
        // 降級是連續的（赤→橙→無標記），不是「有標記／沒標記」兩態——
        // 赤已經確定回到橙時就該畫黃臉，繼續畫紅臉同樣是過度斷言。
        return this.lbasCondState(lbasCondDowngrade(cond, base.condRate, now - base.condAsOf));
    }

    /**
     * 這個疲勞標記現在有多少把握——`certain`＝確定還在、`possiblyRecovered`＝可能已退掉
     * （面板要淡化表現、不得斷言）、`clear`＝必定已退（`lbasCondStateNow` 會直接回 normal）。
     * 本來就沒有標記或未知碼時回 null。詳見 `utils/lbas-cond.ts`。
     */
    lbasCondCertaintyNow(
        cond: number | null,
        base: Pick<AirBaseView, 'condAsOf' | 'condRate'>,
        now = Date.now(),
    ): 'certain' | 'possiblyRecovered' | 'clear' | null {
        if (base.condAsOf == null) return lbasCondCertainty(cond, base.condRate, 0);
        return lbasCondCertainty(cond, base.condRate, now - base.condAsOf);
    }

    /** 正常中隊回空字串，讓面板如遊戲本體般不額外顯示標記。 */
    lbasCondLabel(cond: number | null): string {
        return this.lbasCondLabelOf(this.lbasCondState(cond), cond);
    }

    /**
     * 依**狀態**取標籤——經過時間降級後的狀態要用這支，不能再拿原始 cond 去查
     * （赤降級成橙之後，標籤必須跟著變）。
     */
    lbasCondLabelOf(kind: ReturnType<GameState['lbasCondState']>, cond: number | null): string {
        if (kind === 'normal') return '';
        if (kind === 'mild') return t('lbas.cond.mild');
        if (kind === 'tired') return t('lbas.cond.tired');
        if (kind === 'exhausted') return t('lbas.cond.exhausted');
        return t('lbas.cond.unknown', { n: cond ?? '?' });
    }

    /** 某海域的基地整備等級；尚未收過 mapinfo 的擴充資訊時回 null（不可考）。 */
    airBaseMaintenanceLevel(areaId: number): number | null {
        return this.airBaseMaintenanceLevels.get(areaId) ?? null;
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

    /** 累積某海域已實戰觀測到的最高 Boss 旗艦 HP。 */
    observeMapBossHp(mapArea: number, mapNo: number, bossHp: number): void {
        if (!Number.isFinite(bossHp) || bossHp <= 0) return;
        const mapId = mapArea * 10 + mapNo;
        const known = this.mapBossHp.get(mapId) ?? 0;
        if (bossHp > known) this.mapBossHp.set(mapId, bossHp);
    }

    // 目前出擊海域的 mapId；沒在出擊時為 null。下面兩支的預設對象。
    private currentMapId(): number | null {
        return this.sortieInfo ? this.sortieInfo.mapArea * 10 + this.sortieInfo.mapNo : null;
    }

    // 「尚未攻略的 boss 撃破型量表」清單（mapId 由小到大）。**不需要正在出擊**——量表值
    // 來自 api_get_member/mapinfo（點開出擊海域選單就送來），斬殺線來自本機出擊紀錄，
    // 兩者在母港都已到齊。面板據此在未出擊時也能顯示各活動海域的攻略進度。
    // maxHp=9999＝尚未選擇難度的佔位值，不是真實滿血，一律排除。
    unclearedHpGaugeMaps(): { mapId: number; mapArea: number; mapNo: number; gauge: MapGaugeView }[] {
        const out: { mapId: number; mapArea: number; mapNo: number; gauge: MapGaugeView }[] = [];
        for (const [mapId, gauge] of this.mapGauges) {
            if (gauge.cleared || gauge.gaugeType !== 2) continue;
            if (gauge.maxHp <= 0 || gauge.maxHp === 9999 || gauge.nowHp <= 0) continue;
            out.push({ mapId, mapArea: Math.floor(mapId / 10), mapNo: mapId % 10, gauge });
        }
        return out.sort((a, b) => a.mapId - b.mapId);
    }

    // boss擊破型量表的剩餘攻略次數估算。boss HP 需先實戰擊破一次才知。
    // TP輸送型不以艦隊TP反推場數：面板直接顯示封包的剩餘TP，避免把不同勝利
    // 評價、退避與裝備變動造成的推測值誤當成確定次數。
    // mapId 省略＝目前出擊海域（沿用舊呼叫端語意）；帶入即可查任一海域，不必正在出擊。
    mapRemainingRuns(mapId?: number): number | null {
        const id = mapId ?? this.currentMapId();
        if (id == null) return null;
        const g = this.mapGauges.get(id);
        if (!g || g.maxHp <= 0 || g.maxHp === 9999) return null;
        if (g.gaugeType === 2) {
            const bossHp = this.mapBossHp.get(id);
            if (!bossHp || bossHp <= 0) return null;
            return Math.max(0, Math.ceil(g.nowHp / bossHp));
        }
        return null;
    }

    // boss 撃破型量表是否已進入斬殺期。遊戲機制的門檻是「殘量嚴格小於 boss 旗艦 HP」；
    // 兩者相等時 ceil(殘量 / boss HP) 雖然也是 1，仍不可提早標成斬殺期。
    // 同上：mapId 省略＝目前出擊海域，帶入即可在母港查任一海域。
    mapInFinalPhase(mapId?: number): boolean {
        const id = mapId ?? this.currentMapId();
        if (id == null) return false;
        const g = this.mapGauges.get(id);
        if (!g || g.cleared || g.gaugeType !== 2 || g.nowHp <= 0
            || g.nowHp >= g.maxHp || g.maxHp <= 1 || g.maxHp === 9999) return false;
        // **唯一不需要 Boss HP 的判定**：量表進入最終段後，對 boss 旗艦的傷害不會把它打到
        // 0，而是 floor 在 1（唯有實際沉沒 boss 旗艦才變 0＝通關，見「關卡進度」一節）。
        // 所以 nowHp===1 這個值本身就是「已在最終段」的封包事實——只要 boss 旗艦 HP > 1
        // 就必然成立，不必知道它到底是多少。零紀錄的新環境在最後一場也能標出斬殺期。
        if (g.nowHp === 1) return true;
        const bossHp = this.mapBossHp.get(id);
        return bossHp != null && bossHp > 0 && g.nowHp < bossHp;
    }

    // ── 待驗證封包自動偵測 ──────────────────────────────
    // 比照 KC3Kai 已可轉寫的機制，僅保留「表／欄位更新」類且不會洗版的鉤子。
    // 命中時回傳人類可讀分類；main.ts 只在 live 事件呼叫並寫入 db.wanted。
    wantedTag(path: string, api: any, _req?: Record<string, string>): string | null {
        // 渦潮：表內已查表扣減；表外且真有 api_happening 才抓（活動新紫點，供補表）。
        if ((path === 'api_req_map/next' || path === 'api_req_map/start')
            && this.sortieInfo && this.maelstromUnknownCount < 3) {
            const happening = readMaelstromHappening(api);
            const edgeId = Number(api?.api_no);
            if (happening && Number.isFinite(edgeId)
                && !lookupMaelstromLoss(this.sortieInfo.mapArea, this.sortieInfo.mapNo, edgeId)) {
                this.maelstromUnknownCount++;
                return t('wanted.tagMaelstromUnknown', {
                    map: `${this.sortieInfo.mapArea}-${this.sortieInfo.mapNo}`,
                    edge: edgeId,
                    n: this.maelstromUnknownCount,
                });
            }
        }
        // 未知 sally 系欄位＝標籤名最可能的所在（查不到＝只能手動命名）。
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

/**
 * 依 `api_squadron_id` 合併中隊，未被提及的中隊原樣保留。
 *
 * 為什麼不能直接覆蓋整排：`set_plane`／`supply` 的回應**只帶被更動的中隊**，不是完整四格。
 * 回應只帶被更動的中隊，直接覆蓋 `ab.api_plane_info` 會把沒動到的中隊整個丟掉——換一架
 * 飛機就剩一格、換兩架剩兩格，且 `lbasAirPower()` 與 `airBases_()` 都直接讀這個陣列，
 * 所以制空與格數會一起錯，要回母港收到完整的 `base_air_corps` 才會修回來。
 *
 * 合併在「回應是完整四格」的情況下與覆蓋等價（四個 id 都會被蓋掉），故不論回應是部分
 * 還是完整都安全。中隊被卸下時遊戲送的是 `api_state:0` 的條目而非缺席，不會殘留舊值。
 */
function mergeSquadrons(current: unknown, incoming: unknown): unknown {
    if (!Array.isArray(incoming)) return current;
    if (!Array.isArray(current) || current.length === 0) return incoming;
    const byId = new Map<unknown, any>();
    for (const sq of current) byId.set(sq?.api_squadron_id, sq);
    for (const sq of incoming) {
        // 沒有 api_squadron_id 可對位就無從合併，退回整排覆蓋，不猜測缺失的對位。
        if (sq?.api_squadron_id == null) return incoming;
        byId.set(sq.api_squadron_id, sq);
    }
    return [...byId.values()].sort(
        (a, b) => (a?.api_squadron_id ?? 0) - (b?.api_squadron_id ?? 0));
}

// 已知的 sally 系欄位。出現在這之外的 sally 系 key＝標籤名驗證鉤子的命中目標（見 wantedTag）。
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
