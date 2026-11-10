// 戰鬥檢視的型別定義，純型別、無執行期依賴；供 battle.ts 與 state.ts 共用，避免兩者互相 import。

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
    /** 夜戰封包已明示我方 `api_touch_plane[0]` 為正值（夜間觸接成功）。 */
    nightRecon: boolean;
    /** 探照燈已由出擊快照與夜戰時機確認，或攻擊欄明確帶出。 */
    searchlight: boolean;
}

/** 對空 CI 的封包明細；`api_use_items` 保留發動當下的裝備 master id。 */
export interface BattleAaciView {
    /** 封包 `api_air_fire.api_kind`，對照對空 CI 種別值。 */
    type: number;
    /** 發動艦所在的艦隊；封包位置無法判定時為 unknown。 */
    fleet: 'main' | 'escort' | 'unknown';
    /** 發動艦在主隊／隨伴中的 1-based 位置；0＝封包沒有可辨識位置。 */
    position: number;
    /** 出擊快照能對上的艦實例 id；歷史資料沒有快照時缺席。 */
    shipId?: number;
    /** 出擊快照中的艦 master id；缺席時不補猜。 */
    shipMst?: number;
    /** 封包 `api_air_fire.api_use_items` 的裝備 master id，順序照原始封包。 */
    gearMst: number[];
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
    /** 對空 CI 發動艦、Type 與實際使用的裝備組合；沒有發動時為空陣列。 */
    aaciDetails: BattleAaciView[];
    midnightFlag: boolean;
    /** 夜戰裝備發動標記；舊手捏測資可能沒有此欄位。 */
    nightEffects?: BattleNightEffectsView;
    /** 夜戰封包是否已實際抵達；`midnightFlag` 只代表可進入夜戰，兩者不可混用。 */
    nightObserved?: boolean;
    /** 夜戰封包明示的我方夜間觸接機體 master id；只在夜戰觸接成功時存在。 */
    nightTouchPlane?: number;
    /** 連合艦隊夜戰交戰的敵方艦隊；實戰依 `api_active_deck[1]`，日戰後可標示 KC3Kai 式推測。 */
    nightTarget?: 'main' | 'escort' | 'unknown';
    /** `true` 表示只有日戰結果推測，收到夜戰封包後改為 `false`。 */
    nightTargetEstimated?: boolean;
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
