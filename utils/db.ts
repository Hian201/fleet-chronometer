import Dexie, { type Table } from 'dexie';
import type { PlanStage, PlanTag } from './event-plan';

// 事件日誌一筆 = provider 合約的載體。所有封包來源（目前 MAIN world interceptor；
// 未來 Native Companion / Proxy）交件時都必須滿足以下不變量，下游（GameState、面板）
// 才能對「封包從哪來」一無所知地運作：
//   · path：已去 `/kcsapi/` 前綴與 `svdata=`，形如 `api_port/port`（interceptor 負責）
//   · api ：已 JSON.parse 且取出 `api_data`（無則為整包）
//   · req ：URLSearchParams 解出的表單欄位，且已剔除 `api_token`、`api_verno`
//           （token 不落地為硬約束，見 CLAUDE.md 設計原則 2，bridge 負責）
// 交件唯一入口是 background.ts 的 ingestEvent()，勿在他處直接 db.events.add（繞過合約）。
export interface ApiEventRow {
    id?: number;
    ts: number;
    path: string;
    api: unknown;
    req: Record<string, string>;
    // Batch 2.1 的 bridge 傳輸識別碼。歷史事件沒有此欄位，故保持 optional。
    captureId?: string;
    // 後續 post-processing 的處理狀態。未標記的歷史事件不是待處理工作。
    postProcessState?: 'pending' | 'processing' | 'done';
    // 封包來源。在各傳輸邊界標記（runtime message = main、connectNative = native…），
    // 多來源並存時用來除錯分辨髒資料出自哪個 provider。未標記者視為 'main'（相容歷史事件）。
    source?: 'main' | 'native' | 'proxy';
}

// 待驗證封包（自動擷取）：GameState.wantedTag() 判定符合待驗證條件時記一筆，
// 供「動態」分頁直接複製，不必再手動翻 Network 面板。見 CLAUDE.md「怎麼撈封包驗證」。
export interface WantedRow {
    id?: number;
    eventId: number;   // 對應 events.id，取完整 api 時用
    tag: string;        // 人類可讀分類，如「自軍聯合艦隊戰鬥」
    ts: number;
    path: string;
}

// 出擊紀錄（消化後的摘要，「紀錄」分頁用）。獨立於原始事件日誌：
// events 表會被裁剪（見 background.ts pruneEvents），本表永久保留、每筆 <1KB。
// 主鍵 eventId（battleresult 或基地空襲 map/next 的 events.id）→ 重播時 put 冪等，
// 面板重開會自動從既有事件回填，不會重複。
export interface SortieLogRow {
    eventId: number;
    sortieKey: number;   // 本次出擊的 api_req_map/start 事件 id（分組用）
    ts: number;
    map: string;         // '6-5'
    node: number;        // 當前節點 edge id
    boss: boolean;
    kind: 'battle' | 'raid';   // raid = 基地空襲（api_destruction_battle）
    rank: string;              // 結算 rank；raid 時為空字串
    seiku: number | null;      // 制空 0互角/1確保/2優勢/3劣勢/4喪失；無航空戰 = null
    enemyIds: number[];        // 敵主隊 master id
    enemyIdsEscort: number[];
    drop: string | null;
    // battle-result 已驗證的 api_get_ship.api_ship_id。舊資料可能沒有；不得由 drop 名稱反推。
    dropMst?: number;
    // 舊版曾用於打撈新船篩選修正；保留以相容既有備份，現行判定不讀取此欄位。
    newShipOverride?: 'old';
    taiha: boolean;
    raidLostKind?: number;     // 基地空襲損失種別（api_lost_kind；1–4 見 air-raid-lost-kind.ts）
    // 斬殺旗標：這場 boss 出擊擊破了該海域量表（api_cleared 由 0→1／HP量表歸 0／擊破數達標）。
    // 由 EventProjector 的轉變偵測寫入（見 event-projector.ts）。用於重播保留規則「斬殺永久保留」。
    // ⚠️ 判定用的 api_cleared/api_now_maphp 欄位已實測，但「擊破當下緊接的 mapinfo」轉變本身
    //    尚未用真封包觀測（見待辦），屬防禦性實作。
    cleared?: boolean;
    // ── 以下皆取自 battleresult 封包（已用 samples/6-5-ec_result.json 逐欄驗證）。
    //    歷史資料可能缺少這些欄位，UI 一律當「不可考」處理，不得回填猜測值。
    /** 提督經驗值（`api_get_exp`）。※「基礎經驗值」不在封包裡（KC3Kai 靠自帶的海域資料庫），故不顯示。 */
    getExp?: number;
    /** MVP 位置（`api_mvp`，**1-based**）。已與 `analyzeBattle` 的傷害推算在真封包上比對一致。 */
    mvp?: number;
    /** 隨伴艦隊 MVP（`api_mvp_combined`，1-based；非連合時封包為 null → 不寫入）。 */
    mvpEscort?: number;
    /** 敵艦隊名（`api_enemy_info.api_deck_name`，例「任務部隊 主力群」）。 */
    enemyName?: string;
    /**
     * 基礎經驗值。**遊戲封包沒有這個欄位**（本機擷取一律沒有）；只有從 KC3Kai logger 匯出
     * 的 JSON 匯入時才有（它自己算出來的 `baseEXP`）。UI 有值才顯示，不可當成必有欄位。
     */
    baseExp?: number;
    // 節點類型（`api_req_map/start|next` 的 `api_event_id`／`api_event_kind`，封包事實）。
    // 語意對照見 utils/map-node-kind.ts。**存原始值不存推導出的標籤**——語意對照若調整，
    // 歷史紀錄才能套用新解讀；存標籤會固化擷取當下的理解。缺欄時維持不可考。
    nodeEventId?: number;
    nodeEventKind?: number;
    // CSV 匯入（utils/drop-log-import.ts）產生的列一律標記，UI 顯示徽章區分
    // 「本機擷取」與「外部謄寫」。本機擷取的紀錄一律不帶此欄位（不是 false，是缺席）。
    imported?: boolean;
}

// 工廠紀錄（開發／建造／改修的消化後摘要，「工廠」分頁用）。與 sorties 同設計：
// 獨立於原始事件日誌、永久保留、每筆 <1KB；主鍵 eventId + put ⇒ 冪等，面板重播自動回填。
// 名稱不落地（只存 master id），渲染時經 state.gearName/shipName 取當前語言譯名。
export interface FactoryLogRow {
    eventId: number;
    ts: number;
    kind: 'develop' | 'build' | 'improve' | 'speedup';
    used: number[];            // 8 項資材消耗量（正值；燃彈鋼鋁/桶/開發資材/ネジ）
    secretary: number;         // 秘書艦（第一艦隊旗艦）master id；開發/改修結果受其影響
    /** 歸檔當下的司令部等級。舊紀錄沒有這項，UI 必須標為不可考而非取目前等級回填。 */
    hqLv?: number;
    // develop：一次請求 1 或 3 個結果；mst=-1 為開發失敗
    results?: { mst: number }[];
    // build：shipMst 在歸檔當下即已知（直接取自 api_get_member/kdock 該渠的
    // api_created_ship_id，見 state.ts BuildStartView 註解），不需要事後回填。
    // speedup（高速建造材完工）：shipMst/kdockId 為被完工的那艘船／渠，used 只有
    // index4（高速建造材）非零。
    shipMst?: number;
    kdockId?: number;
    // improve
    gearMst?: number;
    levelBefore?: number;
    levelAfter?: number;
    success?: boolean;
    certain?: boolean;         // 確実化（保證成功）
    // 2026-07-23 新增：CSV 匯入（utils/build-log-import.ts）。同 SortieLogRow.imported。
    imported?: boolean;
    // 匯入來源給的艦名／秘書艦名對不上目前 master（例如該艦形態已改造、或 master 未載入）
    // 時的備援顯示文字——**只用於顯示**，不得回頭當作 shipMst/secretary 使用；
    // 解得出 master id 時兩者都不寫，UI 一律以 shipMst/secretary 為準。
    importedShipName?: string;
    importedSecretaryName?: string;
}

// 出擊重播紀錄（KC3Kai battleplayer 相容格式）。與 sorties 的分工：
//   · sorties＝「消化後的摘要」（rank/掉落/大破…），面板/總括快速列表用，每筆 <1KB。
//   · replays＝「原始戰鬥封包＋出擊時艦隊快照」，可原封輸出成 KC3Kai kancolle-replay
//     battleplayer 能重播（並轉存圖片）的物件。體積較大（每節點原始封包數 KB），
//     故獨立成表、可個別裁剪。主鍵 sortieKey（api_req_map/start 事件 id）＝一次出擊一筆，
//     put 冪等、面板重播自動回填（同 sorties 設計）。
// 欄位命名對齊 KC3Kai 替播物件（fleet1/fleet2/battles[].data/yasen/node…），
// 匯出時 utils/replay.ts 的 toKc3Replay() 直接組裝，不需再做欄位翻譯（格式已用
// player.js 解析端與 poi→kc3 轉換器交叉確認，見 CLAUDE.md 出擊紀錄章節）。
export interface ReplayShip {
    mst_id: number;          // api_ship_id（艦 master id）
    lv: number;
    equip: number[];         // 各裝備槽 master id（api_slotitem_id；空槽 -1）
    stars: number[];         // 各裝備改修值（與 equip 同序）
    ace: number[];           // 各裝備熟練度（與 equip 同序）
    exequip: number;         // 補強增設 master id（無則 -1）
    // 補強增設的改修／熟練。與一般槽的 stars／ace 分開存——KC3Kai 的 stars／ace
    // 只對齊 equip、不含 ex；舊快照缺這兩欄＝不可考（匯出時退回 0，不假裝有值）。
    exstars?: number;
    exace?: number;
    nowhp: number; maxhp: number;
    // Fleet Chronometer 的公開 toKc3Replay() 格式刻意不帶士氣；由該格式重新匯入時
    // 必須保留「來源未提供」，不可用 0 假裝成赤疲勞。
    cond?: number;
    kyouka?: number[];       // 近代化改修加值（api_kyouka，可選）
}
// KC3Kai logger 的第 3／4 艦隊快照有艦種、等級、裝備與士氣，但沒有 HP。
// 這不是格式錯誤；支援艦隊 HP 在來源中本來就不可考。用獨立型別表達缺席，避免把
// maxhp=0 這種無法通過 backup validator、也會誤導 UI 的假值持久化。
export interface ReplaySupportShip extends Omit<ReplayShip, 'nowhp' | 'maxhp'> {
    nowhp?: number;
    maxhp?: number;
}
export interface ReplayNode {
    node: number;            // 節點 edge id（api_no）
    data: unknown;           // 晝戰原始 api_data（api_req_sortie/battle 等）
    yasen?: unknown;         // 夜戰原始 api_data（api_req_battle_midnight/* 等）
    rank?: string;           // battleresult 的 api_win_rank
    // 以下逐節點結算欄位**只有單場 JSON 匯入（KC3Kai logger）才有**（見 utils/sortie-import.ts）：
    // 那份來源的 wrapper 自帶這些摘要，本機擷取的重播一律缺席（原始封包裡沒有 baseEXP，
    // 其餘則在 sorties 摘要列裡）。列在這裡是因為它們確實會落地到 db.replays，
    // 備份的欄位白名單（utils/backup.ts）必須認得，否則往返會靜默掉資料。
    dropMst?: number;
    mvp?: number;            // 1-based
    mvpEscort?: number;      // 1-based
    getExp?: number;
    baseExp?: number;
    boss?: boolean;
}
// 出擊當下的基地航空隊快照（一支中隊一筆）。**戰鬥封包只帶「有出擊的那幾波」**
// （api_air_base_attack），要知道「這次出擊時三個基地各自的編成與行動」只能在
// api_req_map/start 當下快照——同艦隊快照的道理。行動 api_action_kind：
// 0待機/1出擊/2防空/3退避/4休息（與 GameState.airBases_() 同一組值）。
export interface ReplayLbasSquadron {
    mst: number;             // 裝備 master id
    count: number;           // 現有機數
    maxCount: number;
    stars: number;           // 改修 ★
    ace: number;             // 熟練度
    state: number;           // api_state：0未配置/1配置済/2配置転換中
    cond: number;            // api_cond 顯示狀態碼（0/1無標記、2黃、3紅）
}
export interface ReplayLbas {
    areaId: number;          // api_area_id（＝出擊海域 world）
    rid: number;             // 第幾基地
    action: number;          // api_action_kind
    distance: number;        // 戰鬥行動半徑
    squadrons: ReplayLbasSquadron[];
}
export interface ReplayRow {
    sortieKey: number;       // api_req_map/start 事件 id（主鍵）
    ts: number;
    world: number;           // 海域 area（api_maparea_id）
    mapnum: number;          // 海域 no（api_mapinfo_no）
    diff: number;            // 難度 api_selected_rank（0=未選/一般圖）
    // `api_gauge_num` 的原始整數，只作同一張活動圖不同血條的識別鍵；不解讀其數字語意。
    // 舊重播沒有這欄，不能拿來推導目前血條。
    gaugeNum?: number;
    // api_req_map/start／next 的 `api_bosscell_no`。同一張活動圖在破甲等路線上仍可能抵達
    // api_event_id=5 的舊階段 Boss；只有這個目前血條的目標 Boss 節點可以更新 baseHp。
    // 舊重播沒有這欄，恢復時走保守相容規則，不能假裝知道當時的目標節點。
    bossCellNo?: number;
    combined: number;        // 0=單艦隊, 1=機動, 2=水上, 3=輸送（api_combined_flag）
    fleetnum: number;        // 出擊艦隊編號（1-4；聯合時為 1）
    fleet1: ReplayShip[];    // 主隊（聯合時第一艦隊）
    fleet2: ReplayShip[];    // 隨伴隊（聯合時第二艦隊；單艦隊為空）
    // 第3／第4艦隊快照＝支援艦隊候補（2026-07-22 新增，舊紀錄沒有）。戰鬥封包的
    // api_support_info 只給**艦實例 id**，沒有等級與裝備；要像 KC3Kai 那樣把「道中支援／
    // 決戰支援」當艦隊顯示，只能在出擊當下快照（同 fleet1/fleet2 的理由）。
    // 出擊時第3/4隊不一定是支援隊，故只是候補——實際有沒有出動看封包，對應靠 api_deck_id。
    fleet3?: ReplaySupportShip[];
    fleet4?: ReplaySupportShip[];
    // 出擊當下的基地航空隊（同海域的全部基地，2026-07-22 新增，舊紀錄沒有）
    lbas?: ReplayLbas[];
    battles: ReplayNode[];   // 依節點順序
    hqLv?: number;
    nickname?: string;
    // 手動 ★ 釘選：使用者在「出擊紀錄」標記為紀念場，永不被保留規則裁剪（見 utils/retention.ts）。
    // 非索引欄位（保留規則一律 toArray 全載計算，不需要索引）。
    pinned?: boolean;
    // 由單場 JSON 匯入（utils/sortie-import.ts），**不是本機觀測**。這個標記只代表來源，
    // 不代表結算欄位必然缺席：KC3Kai logger 匯出可帶 rating/drop/mvp/hqEXP/baseEXP，
    // Fleet Chronometer 自身的 toKc3Replay() 才通常沒有那些摘要。匯入時一併 pinned。
    imported?: boolean;
}

// 遠征紀錄（api_req_mission/result 消化後摘要，「遠征紀錄」分區用）。同 sorties/factory
// 設計：獨立於事件裁剪、永久保留、每筆 <1KB；主鍵 eventId + put ⇒ 冪等、重播自動回填。
export interface ExpeditionRow {
    eventId: number;
    ts: number;
    deckId: number;          // req.api_deck_id
    missionId: number;       // 遠征編號（api_quest_level 或 req；見 archive 註解）
    name: string;            // 遠征名（api_quest_name，原文）
    result: number;          // api_clear_result：0=失敗, 1=成功, 2=大成功
    resources: number[];     // api_get_material：[燃, 彈, 鋼, 鋁]（可能缺，補 0）
    items: { id: number; count: number }[];   // api_get_item1/2（回航道具，如ネジ/バケツ/開発資材）
    // 結算封包到達時的艦隊快照。舊紀錄沒有這筆資料，UI 必須誠實顯示不可考。
    fleet?: { name: string; level: number }[];
}

// 母港快照：不受 M6 event 裁剪影響的「重建目前狀態所需關鍵原始封包」，每個 path 只留
// 最新一筆（primary key = path，put 覆蓋）。存在理由：db.events 會被裁剪到約兩個登入
// 世代（見 background.ts pruneEvents），且擴充若被完全解除安裝再重裝，db.events 直接歸零
// ——這種情況下光靠 db.events 重播出來的 GameState 會沒有任何艦娘/裝備/艦隊資料，要等
// 使用者重新登入遊戲才會恢復。本表獨立於裁剪機制，讓「資料備份與還原」匯出的檔案在全新
// 安裝匯入後，總括頁能立即用 GameState.applyEvent() 重建可瀏覽的狀態（不必等待重新登入）。
// 寫入時機：background.ts ingestEvent() 收到 SNAPSHOT_PATHS 內的 path 就 put 一筆
// （與 M6 pruneEvents 的 KEEP_RECENT 保護名單概念一致，但那份只在同一次安裝內生效，
// 這份要撐過重灌）。api/req 格式與 ApiEventRow 相同，匯入時直接餵同一套 applyEvent()
// reducer，不需要另外設計反序列化邏輯。
export interface SnapshotRow {
    path: string;   // 主鍵，如 'api_start2/getData'／'api_port/port'
    ts: number;
    api: unknown;
    req?: Record<string, string>;
    eventId?: number;
}

// 投影進度 metadata。缺少或 version !== 3 時必須視為 throughEventId=0，讓目前仍保留的
// raw events 完整重投影；不可用 snapshot eventId 或未知版本的數值補造進度。
export interface ProjectionMetaRow {
    key: 'projection';
    version: number;
    throughEventId: number;
    updatedAt: number;
}

// 安全還原 session metadata。沿用 v10 已存在的 meta object store，不改 IndexedDB
// schema/version；v6 完整備份以一次 transaction 同時標兩項完成，v1–v5 舊拆檔才用它辨識
// 「目前非空資料確實來自前一個已完成的安全匯入」。不能用它宣稱舊兩檔必然同源。
export interface BackupRestoreMetaRow {
    key: 'backup-restore';
    importedRestore: boolean;
    importedReplays: boolean;
    highestSourceEventId: number;
    // 下一次 auto-increment 應配出的 key；complementary 匯入用 guard 實際核對，
    // 可辨識「rows 已刪但 generator 被未知本機寫入推進」的來源不明環境。
    nextEventId: number;
    updatedAt: number;
}

// 遊戲頁（DMM）相關的使用者偏好，由 background 持有：靜音開關，以及擴充頁面語言的鏡像。
// **為什麼放在 SW 這一側**：靜音狀態要在遊戲分頁重新載入後仍然生效，而 service worker
// 沒有 localStorage，chrome.storage 又要新增 storage 權限（權限精簡是硬約束）。語言的
// 真相仍在擴充頁面的 localStorage（utils/ui-prefs.ts），這裡只是給跑在 dmm.com 的劇場
// 模式工具列讀的鏡像——那支 content script 跨 origin，讀不到擴充頁面的 localStorage。
// 這一列**不參與投影、不引用任何 event id**，故備份還原的「乾淨環境」判定會略過它
// （見 utils/backup.ts restoreMarker）。
export interface GamePageMetaRow {
    key: 'game-page';
    muted: boolean;
    lang?: string;
    updatedAt: number;
}

export type DatabaseMetaRow =
    | ProjectionMetaRow
    | BackupRestoreMetaRow
    | GamePageMetaRow;

// 艦娘入手紀錄（收藏日誌）。遊戲 API 的艦娘物件**沒有入手日期欄位**——只有 api_id
// （艦實例 id，單調遞增、不重用）代表「首次進入鎮守府的順序」，沒有時間戳。故本表補記
// 「打撈上任日」：background.ts ingestEvent 於 api_port/port 到達時，對「從沒見過的
// api_id」記一筆自動入手日（source='auto'）。**首次追蹤（表為空）時的全 roster 當基準線**
// ——那批是「擴充安裝前既有的船」，真實入手日不可考，obtainedTs 留 null（source=null），
// 交給玩家在鎮守府情報總括自填（填寫下限＝該艦官方登場日，見 ship-debut-data）。
// 「官方初次登場日」是每艦 master 的參照常數，不存在本表、由參照資料查得（display/驗證時套用）。
export interface ShipObtainedRow {
    id: number;                          // api_id（艦實例 id＝入手順序），主鍵
    mst: number;                         // api_ship_id（艦 master），還原/查 debut 日用
    obtainedTs: number | null;           // 打撈上任日(ms)；null＝既有基準線，待玩家自填
    source: 'auto' | 'manual' | null;    // auto＝首次觀測自動填；manual＝玩家填；null＝基準線未知
    // 首次把這筆艦實例觀測進收藏日誌的 raw api_port/port event ID。舊資料可能沒有，禁止猜補。
    observedEventId?: number;
}

// 活動作戰板：一次活動一筆計畫（主鍵＝活動海域 maparea id，例 61）。
// **與其他表的性質不同**：這是使用者手輸的攻略意圖，不是從 events 投影出來的衍生資料，
// 故由 overview 直接讀寫（同 shipObtained 的手填入手日），不經 EventProjector。
//
// 標籤的**成員名單刻意不存**——那是 api_sally_area 即時算得出來的權威事實（見
// utils/event-plan.ts groupBySally），存下來只會過期。本表只存 API 給不出的東西：
// 標籤名、關卡的標籤約束（攻略情報）、計畫編成、解謎 checklist。
export interface EventPlanRow {
    areaId: number;
    title: string;              // 使用者命名，例「2025 秋活」
    tags: PlanTag[];
    stages: PlanStage[];
    updatedTs: number;
    // 解除鎖定。預設 undefined／false＝鎖定生效：**已確立的標籤**（遊戲裡實際已有船帶著它）
    // 其名稱與相關關卡的標籤約束一律唯讀——實際貼標是不可逆的事實，計畫端再去改只會讓
    // 兩邊對不上。僅當次活動進行中可暫時解除；活動結束後整份計畫刪除，不留到下一檔。
    unlocked?: boolean;
    // 活動仍在目前 master、且即時名冊有非零標籤且內容改變時，才更新「當時誰帶什麼標籤」。
    // 活動結束（該 area 從 master 消失）會刪除整份計畫，快照也不沿用——標籤分類是單次
    // 活動限定。key＝艦實例 id（api_id），value＝標籤 id。
    sallySnapshot?: Record<number, number>;
    /**
     * 配船板的計畫歸屬：艦實例 id → 計畫標籤 id（≥1）。
     * **省略＝自由池**（不得存 0）。新 UI 以本欄為分配真相來源；stages[].slots 僅保留
     * 相容舊資料，開啟時若本欄缺／空且 slots 有船，會一次性遷移（見 tag-board.ts）。
     * 非索引 optional 欄位——不升 Dexie schema 版本。
     */
    planByShip?: Record<number, number>;
    /**
     * 出擊觀測到的「mapKey → 貼出過的標籤 id[]」。
     * raw events 會被 M6 裁剪、restore 也不含 events——若不把觀測寫進計畫，第二條路線貼出的
     * 標籤會永遠停在「共用」。只增不減（標籤一旦觀測過就是事實）。非索引 optional。
     */
    observedGrants?: Record<number, number[]>;
}

// 資源時間序列（「資源紀錄」分區）。**與 db.snapshot 的分工是「歷史 vs 現狀」**：
// snapshot 的 api_port/port 只留最新一筆（主鍵＝path），答得出「現在有多少燃料」，
// 答不出「這次活動花了多少」。本表每收到一筆帶完整八項餘額的封包就記一列，
// 不受 M6 事件裁剪影響（裁剪只動 db.events）。
//
// 主鍵刻意用來源 raw event id 而非自增：SW recovery 會重跑同一筆事件的 post-processing，
// put 冪等才不會把同一個時刻記兩次（同 sorties/factory 的作法）。
export interface ResourceRow {
    eventId: number;
    ts: number;
    /**
     * 八項資材餘額，順序＝遊戲的 api_material：
     * 0燃料 1彈藥 2鋼材 3鋁土 4高速建造材 5高速修復材 6開發資材 7改修資材。
     * （與 FactoryLogRow.used、panel 的 MAT_KEYS 同一組索引。）
     */
    m: number[];
}

// 資源紀錄的「特殊時間點」標記：活動海域的開打與量表歸零，用來把資源序列切成
// 「這一關花了多少」的區段（見 utils/resource-log.ts buildMilestones）。
//
// **為什麼不從 db.sorties 推導**：sorties 是面板（EventProjector）投影出來的，面板沒開
// 就不會有；而資源序列由 background 持續累積，兩者涵蓋範圍不同的話區段會對不起來。
// 故標記與資源同樣在 background 落地（見 utils/resource-capture.ts）。
//
// **為什麼需要 'gauge-seen'**：量表歸零只能從 mapinfo 觀測，而「一裝上擴充就看到某圖
// 已經是 cleared」不代表剛剛打通（同 EventProjector 的 gaugeSeenUncleared 守則）。
// 故必須先觀測到該圖「未歸零」，之後的歸零才算數；'gauge-seen' 就是那個守衛的落地形式
// （SW 隨時會死，不能用記憶體變數）。記到 'gauge-clear' 時刪掉，下一段量表再重新武裝。
export interface ResourceMarkRow {
    /** 主鍵：`open:${mapKey}` / `seen:${mapKey}` / `clear:${mapKey}#${seq}` */
    key: string;
    kind: 'stage-open' | 'gauge-clear' | 'gauge-seen';
    /** 海域鍵＝`mapArea * 10 + mapNo`（例 621＝活動 area 62 的 E1） */
    mapKey: number;
    ts: number;
    /** 來源 raw event id（除錯用；標記本身不參照它做任何運算） */
    eventId: number;
    /** gauge-clear：這是該海域第幾次觀測到量表歸零（0 起）。 */
    seq?: number;
    /** 觀測當下的 `api_gauge_num` 原始值。**語意未經真封包驗證**，只存不推導。 */
    gaugeNum?: number;
}

// 已提前通知過的遠征（防重複通知）。狀態必須持久化，才能跨 service worker 重啟維持
// 「SW 不持跨事件狀態」的資料契約；以 deckId 為主鍵，同艦隊只需一筆、天然去重。
export interface NotifiedRow {
    deckId: number;
    completeAt: number;   // 需比對到完全相同的完成時刻才算「已通知過」，避免誤殺同艦隊之後的新遠征
    ts: number;
}

export class KcDb extends Dexie {
    events!: Table<ApiEventRow, number>;
    wanted!: Table<WantedRow, number>;
    sorties!: Table<SortieLogRow, number>;
    notified!: Table<NotifiedRow, number>;
    factory!: Table<FactoryLogRow, number>;
    replays!: Table<ReplayRow, number>;
    expeditions!: Table<ExpeditionRow, number>;
    snapshot!: Table<SnapshotRow, string>;
    shipObtained!: Table<ShipObtainedRow, number>;
    eventPlans!: Table<EventPlanRow, number>;
    resources!: Table<ResourceRow, number>;
    resourceMarks!: Table<ResourceMarkRow, string>;
    meta!: Table<DatabaseMetaRow, string>;
    constructor(name = 'kc-monitor') {
        super(name);
        this.version(1).stores({ events: '++id, ts, path' });
        this.version(2).stores({ events: '++id, ts, path', wanted: '++id, eventId, tag, ts' });
        this.version(3).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
        });
        this.version(4).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
        });
        this.version(5).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
        });
        // v6：出擊重播（KC3Kai 相容）＋遠征紀錄。既有表 schema 不變（Dexie 只需列出，
        // 未列出的表沿用；此處全列以維持可讀性）。replays 以 sortieKey 為主鍵、
        // expeditions 以 eventId 為主鍵，皆非自增（put 冪等回填）。
        this.version(6).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
        });
        // v7：母港快照（見上方 SnapshotRow 註解）＋真正的資料備份還原（overview 的
        // backup.ts）所需。path 為主鍵（非自增字串鍵），每個 path 恆只有一筆。
        this.version(7).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
        });
        // v8：sorties 加 cleared（斬殺旗標）、replays 加 pinned（手動釘選）——皆為非索引
        // 欄位，Dexie 不需要遷移即可讀寫，此處 bump 版本純為文件化欄位新增（stores 不變）。
        this.version(8).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
        });
        // v9：艦娘入手紀錄（收藏日誌，見 ShipObtainedRow）。主鍵 id=api_id、另索引 mst。
        this.version(9).stores({
            events: '++id, ts, path',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
            shipObtained: 'id, mst',
        });
        // v10：為去重／post-processing／投影進度預留欄位與 metadata 表。
        // 不執行 upgrade 回填：歷史 events 維持沒有 captureId 與 postProcessState，
        // meta 亦保持空白；Batch 2.7 首次啟動時會把缺少 metadata 視為游標 0，僅對目前
        // 仍保留的 raw events 做一次完整、冪等 persist replay。
        this.version(10).stores({
            events: '++id, ts, path, &captureId, postProcessState',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
            shipObtained: 'id, mst',
            meta: 'key',
        });
        // v11：活動作戰板（見 EventPlanRow）。主鍵 areaId＝活動海域 maparea id，一次活動一筆。
        // 純新增表，既有表 schema 不變、不需要任何資料遷移。
        this.version(11).stores({
            events: '++id, ts, path, &captureId, postProcessState',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
            shipObtained: 'id, mst',
            eventPlans: 'areaId',
            meta: 'key',
        });
        // v12：資源紀錄（見 ResourceRow／ResourceMarkRow）。兩張表皆為純新增，既有表
        // schema 與資料完全不變、無遷移。**不回填歷史**：v12 之前沒有任何資源時間序列
        // 可考（db.events 早被裁剪、snapshot 只有最新一筆），從安裝當下開始累積。
        this.version(12).stores({
            events: '++id, ts, path, &captureId, postProcessState',
            wanted: '++id, eventId, tag, ts',
            sorties: 'eventId, sortieKey, ts',
            notified: 'deckId',
            factory: 'eventId, ts, kind',
            replays: 'sortieKey, ts, world',
            expeditions: 'eventId, ts, deckId',
            snapshot: 'path, ts',
            shipObtained: 'id, mst',
            eventPlans: 'areaId',
            resources: 'eventId, ts',
            resourceMarks: 'key, mapKey, ts',
            meta: 'key',
        });
    }
}
export const db = new KcDb();
