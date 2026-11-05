# 母港快照、備份還原與重播保留

## 母港快照與資料備份還原

**快照用途**：LLM 報告是給人／LLM 讀的 Markdown，格式不可逆解析；母港狀態也不能只靠
重播 `db.events` 即時重建，而 `db.events` 本身會被事件裁剪到約兩個登入世代，完全解除
安裝再重裝＝`db.events` 歸零，重播出來什麼都沒有，要等使用者重新登入遊戲才會恢復。

**解法：新增 `db.snapshot` 表**（`utils/db.ts` `SnapshotRow`，schema v7）——不受事件裁剪
影響，`path` 為主鍵、每個 path 只留最新一筆。`background.ts` 的 `SNAPSHOT_PATHS` 定義
寫入時機（`ingestEvent()` 收到以下 path 就 `put`）：
`api_start2/getData`（**最關鍵**：艦種/裝備 master 表唯一來源，缺了它 `shipName()`/
`gearName()` 只能回退日文原名、`stype`/`maxeq` 等衍生欄位全缺）、`api_port/port`
（艦娘/艦隊/資源/暱稱/Lv）、`api_get_member/require_info`／`slot_item`（裝備庫）、
`api_get_member/base_air_corps`／`mapinfo`（基地航空隊/關卡量表）。刻意不含
`api_get_member/questlist`（任務清單靠多頁累積，單一 path 只留最新一筆的快照設計留不住
完整分頁，優先權較低）。`planStateRecovery()` 只在 raw events 為空時採用 legacy snapshot；
raw events 存在時，僅採用 `eventId` 嚴格小於第一筆 retained raw event ID 的 snapshot 作
baseline，再以同一套 `GameState.applyEvent()` reducer 重播 raw events，避免較新的 snapshot
污染較舊事件的 state context。

**現行備份契約（`BACKUP_SCHEMA_VERSION = 8`，`kind: full`）**：一份完整檔帶 `snapshot`、`sorties`、
`expeditions`、`factory`、`wanted`、`shipObtained`、`eventPlans`、`resources`、`resourceMarks`、
`questObserved`、`questSeen` 與 `replays`。不含 raw `events`、`notified`、projection metadata，也不含
語言／主題／各分區篩選等顯示偏好。

- 選填欄位 `questFlow`：任務導覽的釘選與人工完成（`api_no` 名單），還原後覆寫本機這兩項；舊檔
  缺席則不碰既有釘選。
- 選填欄位 `sortieExclude`：「不記錄的海域」名單（見 [records.md](records.md)）。匯出帶當下名單，
  還原在 IndexedDB 提交後才覆寫本機名單，缺席則不碰；只接受正規寫法的通常海域編號
  （`1-1`～`9-9`）且不得重複。只有這項設定、資料表全空時仍視為空備份，不寫檔。
- `questObserved` 以來源 event id 冪等保存；`questSeen` 以 questNo 為主鍵、min／max 合併首末觀測，
  兩個 event id 都進 `highestReferencedEventId()`。`eventPlans` 是純使用者輸入、不參照 event id，
  不進 `highestReferencedEventId()`。
- 出擊紀錄的 optional 欄位（`SortieLogRow.getExp`／`mvp`／`mvpEscort`／`enemyName`、
  `ReplayRow.fleet3`／`fleet4`／`lbas`）缺席即維持缺席，舊備份不會被拒，也不補預設值。
- `wanted` 匯入時重配自身自增 id，但保留 eventId reference。

**舊版相容**：每個版本的表組合各自固定（`determineKind()`），舊檔不會因缺少後來新增的表被拒，
新檔也不得少帶或夾帶。

| 版本 | 形式 | 新增 |
|---|---|---|
| v1 | legacy-full（無 kind） | — |
| v2 | restore／replays 拆檔 | — |
| v3 | 拆檔 | `shipObtained` |
| v4 | 拆檔 | `eventPlans` |
| v5 | 拆檔 | `resources`、`resourceMarks` |
| v6 | 單一 full | 拆檔合併為完整檔 |
| v7 | full | `questObserved` |
| v8 | full | `questSeen`、選填 `sortieExclude` |

v1 與 v6 以後可單檔匯入；v2–v5 的拆檔可同次選取，或分兩次選取後由介面在記憶體暫存湊成一對，
再正規化成現行完整版本以一個 transaction 還原。

匯入**不是 merge，也不會警告後覆寫**。第一次僅接受沒有 raw events、notified、projection
metadata、目標 rows，且 events generator 未被未知資料推進的乾淨環境。後續只有
`meta['backup-restore']` marker 證明的 complementary split file 可接續；重複匯入與來源不明
既有資料一律拒絕。validation、destination preflight、所有 writes、event-ID sequence reservation／
high-water 與 import marker 在同一 transaction；任一失敗完整 rollback。future local raw event ID
保證高於備份所有相關來源 event ID。restore/replays 可依受支援順序接續，但不表示兩檔必然同源。

## 雲端備份與重播保留

**雲端備份邊界**：Google Drive／WebDAV 原生 API 需要額外權限；備份大小與重播保留策略則
由資料內容決定，兩者分開處理。

**(A) 雲端備份走 File System Access API（`entrypoints/overview/fsa.ts`），不碰任何新權限。**
Google Drive／WebDAV 原生 API 需 `identity`(OAuth)＋`host_permissions`（googleapis）或
`optional_host_permissions`（WebDAV 主機），都是「新增權限」，違反權限精簡（與 LLM 子系統
採相同權限邊界）。FSA 是 secure context 網頁 API，overview 一般頁面即可用：使用者選
一次資料夾（指向 Google Drive Desktop／WebDAV 掛載磁碟等**同步夾**），擴充只把檔案寫進去，
上雲同步是桌面同步客戶端的事——延續 MCP 路徑「存檔就結束、出不出境由使用者 OS 決定」的
同一套哲學。目錄 handle 存獨立原生 IndexedDB（`kc-fsa`，不動 Dexie schema）；重開分頁後
handle 仍在但需使用者手勢重新授權（`queryPermission`→`requestPermission`）。無 FSA 支援
的瀏覽器（Firefox/Safari）退回純下載。

**(B) 備份使用單一完整檔。** 檔名以 `backupFileName()` 產生的
`kanmusu-backup-YYYY-MM-DD-HHmmss.json` 為準（本地時間；同秒撞名加序號）；舊的
`kanmusu-backup.json` 仍可相容匯入。完整檔同時帶 snapshot、所有永久紀錄與 `db.replays`。
完整檔才能還原編成、逐節點戰鬥、支援與基地航空隊；空間管理仍由保留規則明確
決定，裁剪後的詳情不會在後續完整備份中假裝存在。

`viewer.html`（`viewer-html.ts`）隨資料夾備份一併寫入：單檔離線、內聯 `toKc3Replay`，任何人用
瀏覽器開它、載入完整備份就能逐場複製 battleplayer 物件／開公開重播頁，**不需要擴充**。

**(C) 重播保留規則（`utils/retention.ts`＋backup 分區「重播層裁剪」UI＋sortie-log 釘選/刪除）。**
玩家取捨＝「大部分週回/路過場是耗材、少數關鍵場是紀念品」，故先保護、剩下才進裁剪窗。
`planRetention()` 保護判定（由上而下，任一命中即永久保留）：手動 ★ 釘選（`ReplayRow.pinned`）
→ 打撈到新船（`firstOwnedDropKeys`：該 master 首次「持有」且有 auto 觀測證據，非僅掉落名稱首見）→ 斬殺（`SortieLogRow.cleared`）→ 活動
boss（`diff>0` 且 boss）→ **所屬海域尚未通關（攻略中全保留**，解謎/索敵過程場先留，直到量表
擊破）；皆非則只留最近 `keepRecentDays` 天（預設 45，覆蓋一次活動全期）且保底最近
`keepRecentCount` 場（久違回歸者不被清光）。設定存 localStorage，UI 顯示「可裁剪場數／估計
釋放 MB」、手動裁剪只刪 `db.replays`（保留 sorties 摘要索引）。純函式已用 node 餵情境驗證
（新船/斬殺/釘選/攻略中/保底 N 場/超窗裁剪）。
