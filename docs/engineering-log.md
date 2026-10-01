# 工程細節與驗證依據

> 本文件集中保存不適合放在日常速查中的**目前有效事實、設計約束、非顯而易見的取捨
> 理由與來源證據**。`CLAUDE.md` 保留審查與日常開發必須知道的硬約束；兩者若有差異，
> 以目前程式碼與測試為準。本文不記錄未合入方案、嘗試過程或使用者討論紀錄。
>
> 新增功能或驗證結果時，只補充仍適用的最終行為、約束、理由與證據；過時內容直接改成
> 目前契約，不保留中間版本。

---

# CLAUDE.md 對應的工程參考

艦これ（KanColle）用的 MV3 監控擴充：攔截遊戲 `kcsapi` 封包，面板即時顯示艦隊/遠征/
入渠/基地航空隊/關卡進度，及**戰鬥預測**（終末HP、rank、MVP、大破警告）與燃彈估算。

技術棧：WXT + TypeScript + Dexie(IndexedDB)。純前端，無後端。
原始架構書見 `docs/architecture-v1.md`（含與現況的偏差摘要）；UI／圖示設計綱要見
`docs/design-guidelines.md`（色彩/字距/動效/元件量表，提出介面或圖示修改前先讀）；
進度見文末「里程碑」。

## 設計原則（硬約束）

1. **被動擷取**：只觀察遊戲自身流量，絕不重放/修改/代發請求（帳號安全紅線）。
   kcsapi 觀察點是遊戲 `window.axios` 的 response interceptor；禁止取代原生 fetch／XHR。
   契約鎖在 `tests/interceptor-capture.test.ts`。
2. **token 不落地**：`api_token` 在 bridge 層剔除，永不寫入 DB、不出境；不上傳任何資料。
3. **擷取與 UI 解耦**：資料落地於 SW 寫入的 IndexedDB 事件日誌；面板只是訂閱者+重放者，
   關閉期間不漏資料。SW 視為隨時會死，不持跨事件狀態。
4. **核心零瀏覽器依賴**：`utils/state.ts`+`battle.ts` 不含 `chrome.*`，可獨立編譯、
   用 node 餵真實封包測試（未來可拆包共用給 macOS app）。
5. **權限精簡**：正式 manifest 的 `permissions` 為 `activeTab`、`alarms`、`notifications`、
   `scripting`、`tabs`；正式 build 的 `host_permissions` 為空。劇場模式需要的 dmm.com 存取權
   走 `optional_host_permissions`，使用者按下按鈕才跳一次原生授權（見「劇場模式」）。
   `scripting` 不授予任何網站存取權、Chrome 也不顯示警告，它只是「能動態注入」的能力。
   任何新增權限都要有明確理由；擴充重載後的動態注入與 LLM 雲端直連均不採用，因為會增加
   host／網路權限。
   `tests/manifest.test.ts` 常駐斷言 `host_permissions` 為空——WXT 對
   `registration: 'runtime'` 的 content script **會自動把 matches 塞進 host_permissions**，
   `wxt.config.ts` 的 `build:manifestGenerated` hook 負責剝掉。

---

## 建置與驗證

```bash
npm run build        # 產出 .output/chrome-mv3（瀏覽器「載入未封裝項目」指向此資料夾）
npm run dev          # 開發模式，產出 .output/chrome-mv3-dev（改動自動 rebuild）
npx tsc --noEmit     # 型別檢查
npx wxt prepare      # 生成 .wxt/ 型別（首次或型別報錯時）
```

改完 source 後須 rebuild ＋ 到 `chrome://extensions` 按擴充的重新整理鈕；
**已開著的遊戲分頁還要 F5** 才會重新注入 content script（MV3 通用限制，已決定不解）。

UI 版面離線預覽（真實封包資料＋overview 的同一份 CSS，不連遊戲）：

```bash
npx vite-node --config vitest.config.ts tools/preview/sortie-log.ts     # → .preview/sortie-log{,-light}.html
npx vite-node --config vitest.config.ts tools/preview/resource-log.ts   # → .preview/resource-log{,-light}.html
npx vite-node --config vitest.config.ts tools/preview/fleet-overview.ts # → .preview/fleet-overview{,-light}.html
npx vite-node --config vitest.config.ts tools/preview/panel-sortie.ts   # → .preview/panel-sortie{,-light}.html
```

核心邏輯獨立驗證（餵真實封包 JSON，樣本在 `samples/`）：

```bash
npx tsc --skipLibCheck --target ES2020 --module ES2020 --moduleResolution bundler \
  --outDir /tmp/out utils/state.ts
# 編譯後需把 /tmp/out/state.js 的相對 import 補 .js 副檔名，再用 node 匯入測試
```

---

## 架構與資料流

```
遊戲頁(*.kancolle-server.com, iframe)
  ▼ 觀察 window.axios response（不取代原生 fetch/XHR）
interceptor.content.ts (MAIN world, document_start)
  · 剝 svdata= → postMessage；[debug] __kcLastBattle/__kcLastResult
  ▼ window.postMessage
bridge.content.ts (ISOLATED)
  · 去 api_token → runtime.sendMessage({type:'kc:api', ...})
  ▼
background.ts (service worker)
  · onMessage 解析 bridge 的原始 apiText，構造 ApiEventRow（source:'main'）→ 呼叫 ingestEvent()
  · ingestEvent()：唯一持久化入口；raw event 先落地，再以 pending→processing→done 執行副作用
    → 廣播 kc:live／快照／裁剪／通知；captureId duplicate 不重複執行已完成副作用
    → 遠征/入渠 → alarms+notifications（提前1分）
  · kc:open-panel（來自 popup 快捷選單）→ 開 panel 彈出視窗（單例聚焦）
    ※ manifest 已設 action.default_popup（entrypoints/popup/），action.onClicked 不再觸發
  ▼ kc:live
panel/main.ts
  · 啟動：先以安全 snapshot baseline 建 state，再依 retained raw event ID 順序投影
  · EventProjector 對 cursor 前事件只建 state context，cursor 後才寫 sorties/factory/replays/
    expeditions；每筆 derived writes 成功才推進 projection cursor
  · 渲染即時監控分頁（general/sortie/exped/activity）＋艦隊＋基地航空隊。
    出擊/工廠紀錄的「檢視」已移至鎮守府情報總括分頁（M8/#5），面板只保留擷取
```

**Provider 合約**：`ApiEventRow`（`utils/db.ts`）是擷取來源與下游的正式邊界。MAIN world
interceptor 被動觀察遊戲 `window.axios` 的 kcsapi 回應（不取代原生 fetch／XHR，以免 DevTools `getContent` 對其他擴充變空），在 idle queue 中依序送出已去 `/kcsapi/`／`svdata=` 前綴的
path、原始 response text 與 request body；ISOLATED bridge 驗證同源訊息、移除
`api_token`／`api_verno`，建立一次固定 envelope（UUID `captureId`、timestamp、path、req、
`apiText`）後送 runtime message。retry **只一次**，且重用同一 envelope；第二次仍失敗時該筆
仍可能遺失。background 才解析大型 `apiText` 成 `api_data`，並以 `source:'main'` 交
`ingestEvent()`。最終 row 不變量為 path 已正規化、api 已解析、req 無 token/verno；帶
captureId 的 events 以 unique index 去重，若同 captureId 的 path 或 timestamp 不同即拒絕
collision。任何 provider 都不得繞過 `ingestEvent()` 直接寫 `db.events`。

### 檔案職責

| 檔案 | 職責 |
|------|------|
| `wxt.config.ts` | manifest（permissions: activeTab, alarms, notifications, scripting, tabs；`optional_host_permissions` 為 DMM 遊戲頁）＋剝除 WXT 自動加上的 `host_permissions` 的 build hook |
| `entrypoints/interceptor.content.ts` | MAIN world 以 axios response interceptor 觀察 kcsapi（不取代 fetch／XHR）+ debug 擷取 ＋**遊戲靜音 hook 的安裝點**（`installAudioMute`，必須早於遊戲建立音訊圖，故掛在 document_start） |
| `utils/axios-capture.ts` | 等 `window.axios`、掛 response interceptor、序列化後交 idle queue；無 chrome.* |
| `entrypoints/bridge.content.ts` | 轉發到 background，去 token；另接**靜音狀態長連線**（`runtime.connect`，故不需要對遊戲分頁的 host permission）與**劇場模式的互動意圖轉發**（Alt+滾輪／Esc，一律 passive、不 stopPropagation）；**關閉分頁前警示**（`beforeunload`，manifest 靜態注入、無需任何權限、涵蓋新舊 DMM 入口——刻意不放在需要 optional permission 的頂層 DMM 頁，見「關閉分頁前警示」一節） |
| `entrypoints/theater.content.ts` | 劇場模式（DMM 遊戲頁）：把遊戲框放到整個視窗、滾輪縮放、平移、隨時還原。**動態註冊**（`registration: 'runtime'`），不在 manifest 的 content_scripts 裡。詳見「劇場模式」 |
| `utils/theater.ts` | 劇場模式的純函式核心（遊戲框辨識／縮放平移幾何／注入用 CSS），無 chrome.*、無 DOM 依賴，node 可測 |
| `utils/audio-mute.ts` | 遊戲框內音訊靜音的純安裝函式：把每個 `AudioContext` 的 `destination` 換成 master GainNode（＋media 元素路徑）。BGM 路徑不可考時由 background 的分頁靜音保底；**艦これ用 WebAudio 還是 `<audio>` 尚無樣本可考，故兩條路徑都接** |
| `utils/game-page.ts` | 遊戲頁相關共用常數（新遊戲網址、注入範圍＝optional host permission、訊息型別），四邊（theater／bridge／background／popup）共用 |
| `entrypoints/background.ts` | `ingestEvent()`＝provider 合約唯一入口；以 `BackgroundIngestionLifecycle` 串行 recovery／ingestion，完成後才廣播、寫 snapshot、裁剪與排程通知 |
| `entrypoints/popup/` | 擴充圖示點擊後的快捷選單（manifest `default_popup`）：開面板／開遊戲（DMM）／**劇場模式（授權入口）**／**遊戲分頁靜音**／開鎮守府情報總括分頁。**不提供另開或替換遊戲視窗**，避免產生第二個遊戲執行個體。劇場模式與靜音**不關閉 popup**，改在 `#status` 就地回饋；`permissions.request()` 必須是點擊手勢的第一個呼叫（先 await 別的事情會失去手勢資格） |
| `entrypoints/overview/` | 「鎮守府情報總括」獨立分頁；艦隊、**艦娘**、**裝備**、**活動作戰板**、出擊、遠征、建造／開發／改修、**資源**、LLM、備份分區皆已實作（無 stub 分區） |
| `entrypoints/overview/ship-picker.ts` | 鎮守府全船篩選清單的共用 UI 元件。**刻意不遵守「全量重繪」慣例**（design-guidelines §4.2）：篩選器控制項只建一次，變更時只重繪結果清單——否則關鍵字輸入框每打一個字就失焦，實際打不了字 |
| `entrypoints/overview/sections/ships.ts` | 艦娘全覽 UI：常駐工具列＋可收合篩選抽屜＋生效條件 chip 列＋詳細表格＋分頁。同 ship-picker **刻意不遵守「全量重繪」慣例**（有關鍵字與等級輸入框）。欄位開關／每頁筆數／排序／素質模式存 localStorage（`kc-ships-view`），不進 Dexie、不進備份 |
| `entrypoints/overview/sections/equipment.ts` | 裝備全覽 UI：**圖示篩選架**（既有裝備圖示即篩選鈕）＋圖磚／詳細清單雙模式＋可展開的逐顆實例。同 ships **刻意不遵守「全量重繪」慣例**（有關鍵字輸入框）。模式／排序存 localStorage（`kc-equip-view`），不進 Dexie、不進備份。詳見「裝備全覽」 |
| `entrypoints/overview/sections/sortie-log.ts` | 出擊紀錄 UI：通常／活動兩大分類＋活動下拉（年份＋季節為主標，跨年依年份分組）＋關卡下拉＋**單場 JSON 匯入**，**一次出擊一張卡**（#第幾次・關卡代號・出擊編成・節點軌跡），展開才是編成／支援艦隊／基地航空隊／逐節點作戰資訊；提供標準 DeckBuilder JSON 複製、制空権シミュレータ跳轉（含各節點敵編成）與 KC3Kai 出擊模擬器開啟／貼上。**刻意不遵守「全量重繪」慣例**（design-guidelines §4.2）：控制項只建一次，篩選只重繪 `.sl-body`——否則每次篩選都會把展開狀態與捲動位置洗掉。分類存 localStorage（`kc-sortie-view`）。工具列＋匯入面板的 markup 由 `shellHtml()` 提供，離線預覽共用同一份。詳見「出擊紀錄的展開檢視」 |
| `entrypoints/overview/sections/drop-log.ts` | 打撈紀錄 UI：通常／活動分類＋活動下拉（與出擊紀錄同一套 `planEventMapFilter`）＋關卡下拉＋新船／非新船篩選＋關鍵字／時間篩選＋分頁＋CSV 匯出入。CSV 匯出入邏輯全在 `utils/drop-log-import.ts`，本檔只負責 UI 狀態（同 sortie-log 單場 JSON 匯入的互動模式：切換面板／選檔或貼上／狀態列三態）。詳見「打撈紀錄／建造紀錄的 CSV 匯出入」 |
| `entrypoints/overview/sections/exped-log.ts` | 遠征紀錄 UI：**期間彙總**（期間捷徑／自訂起訖日／活動期間捷徑＋四資源小計＋各遠征次數與收穫的可排序表）＋可選欄位的詳細清單＋分頁＋彙總／明細兩份 CSV。彙總核心在 `utils/expedition-stats.ts`，本檔只負責 UI 狀態；同 sortie-log **刻意不遵守「全量重繪」慣例**（有關鍵字與日期輸入框）。詳見「遠征紀錄的期間彙總」 |
| `entrypoints/overview/sections/build-log.ts` | 建造紀錄 UI：可選欄位詳細清單＋分頁＋CSV 匯出入。匯入來源查不到 master id 時改顯示 `FactoryLogRow.importedShipName`／`importedSecretaryName`，不落回 shipName(0) 的「？」。詳見「打撈紀錄／建造紀錄的 CSV 匯出入」 |
| `entrypoints/overview/sections/event-ops.ts` | 活動作戰板 UI：標籤總帳（自動）＋計畫疊層＋關卡表。直接讀寫 `db.eventPlans`——那是**使用者手輸的攻略意圖**、非從 events 投影的衍生資料，故不違反「overview 不寫 derived tables」（同 ships 分區的手填打撈上任日） |
| `entrypoints/overview/sections/resource-log.ts` | 資源紀錄 UI：**最上方一張大折線圖**（八項資材疊在同一張圖、圖例逐條開關、y 軸只依顯示中的序列縮放、十字準線）＋活動區段消耗＋詳細清單（表頭與欄位開關皆**純圖示無文字**，欄位開關是表格正上方一排圖示鈕）。同 sortie-log **刻意不遵守「全量重繪」慣例**（要保住十字準線、捲動位置與分頁）。控制項只建一次、只重繪 `.rl-body`；期間／粒度／欄位／分頁存 localStorage（`kc-resource-view`），不進 Dexie、不進備份。純 HTML 建構器抽到 module scope 供離線預覽共用。詳見「資源紀錄」 |
| `entrypoints/overview/main.ts` | 側欄導覽＋hash 路由＋語言/主題套用（`renderSection()` 用 try/catch 接住分區例外並顯示原因，不留白）；另管**側欄三態**（釘選／收合／浮層滑入，`body[data-nav]`＋localStorage `kc-overview-nav`）與**側欄左右側**（`body[data-nav-side]`＋localStorage `kc-overview-nav-side`，與三態正交、純版面鏡射）。窄視窗（≤760px）強制不釘選，且按鈕改切浮層開合；靠右時停用 hover 熱區以免與內容捲軸互搶；`#nav-toggle`／`#nav-side-toggle` 兩顆按鈕也用 CSS `order` 跟著側欄換邊，避免按鈕留在左上角、側欄卻彈在右邊。靠右展開規則必須與收起規則具有相同 specificity，否則泛用三態展開規則無法覆寫 `translateX(100%)`；此約束見 design-guidelines §4.4 的 specificity 段落 |
| `entrypoints/overview/lib.ts` | `loadGameState()` 依 `planStateRecovery()` 選安全 snapshot baseline 再重播 raw events；overview 不投影、不寫 derived tables |
| `entrypoints/overview/fsa.ts` | File System Access API 封裝（**零 manifest 權限**的資料夾備份）：目錄選取（`showDirectoryPicker`）、讀寫權限請求、`fileExists()`、寫檔；目錄 handle 存獨立原生 IndexedDB（`kc-fsa`，非 Dexie）。使用者選一次同步夾（Google Drive Desktop／WebDAV 掛載磁碟…），上雲交給桌面同步客戶端。**選它而非 Drive/WebDAV 原生 API 的理由見檔頭**（後者需 identity/host_permissions，違反權限精簡） |
| `entrypoints/overview/viewer-html.ts` | 離線 `viewer.html` 產生器（單檔、零擴充、零外連）：內聯 `toKc3Replay`，載入 `kanmusu-backup-YYYY-MM-DD-HHmmss.json`（本地時間；亦相容舊 `kanmusu-backup.json`／`kanmusu-replays.json`）即可逐場複製 KC3Kai battleplayer 物件／開公開重播頁。由 `backup` 分區寫進備份資料夾，讓存檔「沒有擴充也能提取單場」 |
| `entrypoints/overview/prompt-api.d.ts` | Chrome 內建 AI「Prompt API」（`LanguageModel`）的最小環境型別宣告，供 `llm.ts` 特徵偵測使用；見「LLM 分析子系統」 |
| `entrypoints/panel/index.html` | 面板結構與 CSS（深色艦これ風） |
| `entrypoints/panel/main.ts` | 面板控制器：以 `EventProjector` state-only/persist 兩階段重播與 live 投影、只在成功後推進 cursor、渲染與 autoSwitch |
| `utils/ui-prefs.ts` | UI 偏好持久化（語言＋亮暗主題，localStorage）——panel/popup/overview 三種擴充頁面共用；SW 不使用。`onPrefsChange()` 用 DOM `storage` 事件做跨頁即時同步（任一頁切換語言/主題→其他已開頁面自動套用重繪，**無需 storage 權限**） |
| `utils/replay.ts` | 出擊重播組裝（純函式，無 chrome.*）：`snapshotDeck`/`startReplay`/`appendBattle` 累積成 `ReplayRow`、`toKc3Replay()` 輸出 KC3Kai battleplayer 可貼上物件、`toKc3ReplayUrl()` 走 `#fromLZString=`。快照讀 GameState 公開原始欄位，state.ts 不必改、維持可獨立編譯 |
| `utils/replay-card.ts` | 出擊分享卡可見層（提督名／編成艦名／節點），純函式；不放編號、等級、rank、艦種 |
| `utils/steganography.ts` | PNG alpha 藏字（steganography.js v1.0.1 預設，與 battleplayer Upload image 同一套）；無 DOM |
| `entrypoints/overview/replay-png.ts` | canvas 畫分享卡＋把 JSON 寫進 PNG 後下載 |
| `utils/lz-string-uri.ts` | LZ-String 1.4.4 URI 安全壓縮（與 battleplayer `reader/lz-string.js` 同一套），供直接播放 URL |
| `utils/map-node-kind.ts` | 節點類型（`api_event_id`／`api_event_kind` → 資源／渦潮／能動分歧／空襲戰／敵連合…）。**封包事實**，與需要對照表的節點字母不同層次；語意轉寫自航海日誌拡張版（MIT，見 THIRD-PARTY-NOTICES §6），**沒有樣本佐證的 eventKind 一律不對應** |
| `utils/map-node-letters.ts` | 節點字母查表（純函式）：`nodeLabel(map, edge)` 有對照給字母（A／B／…／ZZ）、沒有給原始 edge 編號；查不到時顯示原始 edge 編號。面板與 overview 共用 |
| `utils/map-edge-letters.ts` | 上表的資料本體（193 張海域、5904 條 edge）。**產生物、勿手改**——改 `tools/map-edges/edges.json` 後重跑 `tools/map-edges/generate.py`。來源＝KC3Kai `edges.json`（MIT，見 THIRD-PARTY-NOTICES §5） |
| `tools/map-edges/` | 上表的產生器＋上游 `edges.json` 副本（取得日 2026-07-22）。新活動海域要等上游更新，更新後重跑產生器即可 |
| `utils/sortie-import.ts` | 單場出擊 JSON 匯入（解析／去重為純函式，落地為一個 Dexie transaction）：只吃 `toKc3Replay()` version 4 或既有 fixture 證實的 KC3Kai logger 格式，產生 `db.replays`＋`db.sorties` 各一組。**去重在 transaction 內做**（海域＋戰鬥節點序列完全相同，且在 ±10 分鐘內；有封包再比 canonical 完整原始內容，缺封包才只靠時間），命中即拋 `SortieImportDuplicateError` 並整個 rollback。event ID 向 events key generator 借（add→delete，只前進不回頭）**但不寫任何 raw event**——匯入的不是本機觀測，不得偽裝成封包 |
| `utils/csv.ts` | CSV／TSV 最小共用解析與序列化（純函式）：`csvCell`／`rowsToCsv`（逗號＋CRLF＋RFC4046-ish 跳脫）、`parseDelimitedText`（依表頭 tab 數 vs 逗號數自動判斷分隔符，供打撈／建造紀錄的自家格式與航海日誌拡張版 TSV 匯出共用同一支解析器） |
| `utils/drop-log-import.ts` | 打撈紀錄 CSV 匯出入：`dropLogCsvText()` 固定欄位匯出、`parseDropLogCsv()` 辨識自家格式或航海日誌拡張版戦績／ドロップ報告書、`importDropLogRows()` 借 event ID 寫入 `db.sorties`（不寫 raw event，逐列去重不整批 rollback）。詳見「打撈紀錄／建造紀錄的 CSV 匯出入」 |
| `utils/build-log-import.ts` | 建造紀錄 CSV 匯出入，設計同 drop-log-import.ts；相容航海日誌拡張版建造報告書，艦名／秘書艦名查不到 master id 時存 `importedShipName`／`importedSecretaryName` 供顯示 |
| `utils/sortie-detail.ts` | 出擊紀錄「一次出擊」的重建（純函式，無 chrome.*，node 可測）：`buildSortieDetail()` 把 `db.sorties` 摘要 × `db.replays` 原始封包合成逐節點的作戰資訊，並把支援艦隊／基地航空隊波次彙整到出擊層級；`lbasWaves()`／`supportUse()` 解封包欄位、`numberSorties()` 算「該海域第幾次出擊」、`isEventWorld()` 分通常／活動。戰鬥細節**不另寫解析**，直接餵 `battle.ts` 的 `analyzeBattle()`（與面板同一支）。詳見「出擊紀錄的展開檢視」 |
| `utils/event-calendar.ts` | 活動年份／季節年表（純函式）：鍵＝maparea id。遊戲 API 不送西元年與季節，人工維護；表外不從出擊時間戳反推 |
| `utils/deckbuilder.ts` | DeckBuilder 與出擊模擬器格式分開維護：`buildDeckBuilder()`／`buildReplayDeckBuilder()` 產生艦隊與基地航空隊 JSON，`buildReplayAirCalcDeck()` 另加 kc-web 的 `s`／陸航 `sp`，`buildOwnedEquipmentCode()` 產生全持有裝備代碼，`buildSelectedDeckBuilder()` 產生出擊／支援選取艦隊（出擊可含最多三隊基地航空隊）的 DeckBuilder v4 JSON，另提供 `imgBuilderUrl()`／`airCalcUrl()` |
| `utils/sortie-simulator.ts` | `buildSortieSimulator()` 組出擊模擬器中間資料。不載入 LZMA |
| `utils/sortie-simulator-settings.ts` | 中間資料 → `#backup=`（CONVERT.loadSave）；只在按下模擬器鈕時載入。`{ fleetF, nodes }` 會立刻開跑，不用來跳轉 |
| `tools/preview/resource-log.ts` | 資源紀錄版面的**離線預覽產生器**（開發用，不進 bundle）。`samples/` 裡沒有現成的餘額歷史（那要跑好幾週才生得出來），故用**有依據的合成序列**——起訖水位、每場出擊的消耗量級、活動的關卡數與里程碑順序都照 `samples/61-*.json` 那次活動的形狀；合成的是時間軸，欄位語意仍走與分區完全相同的那份程式碼 |
| `tools/preview/sortie-log.ts` | 出擊紀錄版面的**離線預覽產生器**（開發用，不進 bundle）：拿 `samples/` 的 KC3Kai logger 匯出當真實資料、套 overview 的同一份 CSS，產出 `.preview/sortie-log.html`（深／亮兩色）供瀏覽器檢視或 headless 截圖。不連遊戲、不需登入 |
| `utils/resource-capture.ts` | 資源紀錄的擷取層（純函式＋最小 table 合約，node 可測）：`readMaterials()` 取八項餘額、`readEventGauges()` 讀活動量表狀態、`captureResources()` 落地。**由 background 呼叫而非 EventProjector**——資源序列不需要 GameState 上下文，而它的價值就在連續，面板沒開的那幾天要是斷掉就算不出「這次活動花了多少」。詳見「資源紀錄」 |
| `utils/resource-log.ts` | 資源紀錄的分析核心（純函式，無 chrome.*，node 可測）：`normalizeSamples()`／`bucketSamples()`／`downsample()`／`sampleAt()`／`delta()`／`buildEventPeriods()`／`toCsv()`。**餘額是封包事實、消長是差分**，算不出來一律回 null 不以 0 頂替 |
| `utils/line-chart.ts` | 折線圖幾何（純函式，無 DOM）：`multiChartGeometry()`／`niceTicks()`／`nearestIndex()`。只算座標與刻度，SVG 標記由呼叫端組。**y 值域只看傳進來的序列**——這是「一張圖多條線可開關」能成立的關鍵 |
| `utils/retention.ts` | 重播保留規則引擎（純函式，無 chrome.*，node 可測）：`planRetention()` 依「保護規則＋裁剪窗」決定 `db.replays` 每場去留（保護：手動釘選／新船掉落／斬殺／活動 boss／攻略中海域；其餘只留最近 N 天且保底最近 N 場）、`firstOwnedDropKeys()` 算新船場（證據制：每個 master 取最早持有紀錄，須 `source='auto'`＋`observedEventId`，再關聯同 `dropMst` 的前一筆 battle-result；baseline/手填一律不算）。控制重播層不長成 KC3Kai 300MB＋巨檔，見「母港快照與資料備份還原」 |
| `utils/event-plan.ts` | 活動作戰板核心（純函式，無 chrome.*，node 可測）：`groupBySally()` 依 `api_sally_area` 分群、`checkStage()` 出三種燈號（ok／blocked／willStamp）、`findPlanConflicts()` 抓計畫自我矛盾、`sallyBudget()` 算自由身消耗。詳見「活動作戰板」 |
| `utils/ship-filter.ts` | 鎮守府全船篩選（純函式，無 chrome.*，node 可測）：航速／艦種／**國籍**／可裝備／出擊標籤／關鍵字。`EquipFilter` 七選項＝「能裝大發系」與「能裝內火艇」兩個布林的組合（已對全 1751 艦驗算，七桶皆非空）。由活動作戰板與艦娘全覽共用（`ship-roster.ts` 委派共用維度、不重寫一份），UI 殼在 `entrypoints/overview/ship-picker.ts`。**國籍刻意不放進 `OwnedShipView`**——它是 `ship-nationality.ts` 的人工參照表查出來的，不是封包事實，混進 state 的 view 會讓兩層糊在一起；由呼叫端 `nationOf(ctype)` 補上 |
| `utils/ship-nationality.ts` | 艦娘國籍（**建造國**）參照表，鍵＝艦型 `api_ctype`。**遊戲 API 不提供國籍**，人工維護；未列出的 ctype 一律日本。戰後移交他國並改名的形態歸建造國（見「艦娘全覽（詳細清單）」）|
| `utils/ship-roster.ts` | 艦娘全覽**詳細清單**的篩選／排序／分頁核心（純函式，無 chrome.*，node 可測）。共用維度（航速／艦種／可裝備／標籤／關鍵字）委派 `ship-filter.ts`，本檔加上收藏視角專屬的婚艦・編入・鎖定・士氣・改造・近代化改修・射程・開幕・補強增設・多號機・等級範圍，外加十八個排序鍵與分頁。先制對潛是推算值（遊戲不送旗標），詳見「艦娘全覽（詳細清單）」 |
| `utils/stype-label.ts` | 同名艦種消歧（純函式）。`api_mst_stype` 的 8／9 都叫「戰艦」；篩選晶片以名冊多數航速加註「高速」，逐艦欄用該艦自己的 `api_soku`。艦娘全覽與配裝參考共用，**不得用 stype id 當航速捷徑** |
| `utils/gear-inventory.ts` | 裝備全覽的彙總／篩選／排序核心（純函式，無 chrome.*，node 可測）：`groupGears()` 把裝備**實例**依 master 彙總成種類（數量／改修分佈／裝備中艦娘），`filterGears()`／`sortGears()`／`iconOptions()`。素質一律是 master 基礎值、**不含改修 ★ 加成**（加成公式未經封包驗證，刻意不推導）。詳見「裝備全覽」 |
| `utils/repair.ts` | 泊地修理（工作艦）＋母港給糧（補給艦野埼）的涵蓋範圍與結算預估（純函式，無 chrome.*，node 可測）：`planAnchorageRepair()`／`planMoraleSupply()`／`nextSettlementIn()`。詳見「泊地修理與母港給糧」 |
| `utils/quest-progress.ts` | 任務「本機進度」推算（純函式，無 chrome.*，node 可測）：`parseQuestGoal()` 從任務標題/內文的「N回」字樣反推目標次數與動作種類（遠征/建造/開發/近代化改修/裝備改修/演習/出撃）。**遊戲封包完全不給精確完成次數**（只有 `api_state` 受注中/達成與粗略的 `api_progress_flag`），故計數只能是「自本機面板看到這個任務起算」，可能低於遊戲內實際值（同 ship-debut-data.ts 的 baseline 誠實原則）。解不出目標的任務（單次型、或以「隻」為單位）回傳 null，UI 回退顯示受注中/達成。詳見「任務本機進度追蹤」 |
| `utils/state.ts` | `GameState`：封包 reduce 成狀態；遠征檢查、制空/索敵、戰鬥接線、血量寫回、燃彈估算、關卡量表、TP、`wantedTag`、泊地修理計時器錨點、任務進度計數（`bumpQuestProgress()`） |
| `utils/battle.ts` | `analyzeBattle`（傷害重放）+ `predictRank`（勝利判定） |
| `tests/` | vitest 套件（`npm test`）。活動作戰板相關：`event-plan.test.ts`（核心純函式）、`ship-filter.test.ts`（共用篩選，可裝備七桶以真實 master 全 1751 艦驗算）、`map-master.test.ts`（海域 master，含真實 area 62）、`backup-v4-event-plans.test.ts`（envelope v4 往返與舊版相容）；出擊紀錄：`sortie-detail.test.ts`（基地航空隊各波／支援艦隊編組以真封包驗證，摘要×封包合併與「第幾次」計數）、`sortie-import.test.ts`（單場 JSON 匯入與去重）、`map-node-letters.test.ts`（節點字母查表與 61-5／6-5 兩份 ground truth）、`map-node-kind.test.ts`（節點類型，與 KC3Kai 匯出的 desc 交叉驗證）；資源紀錄：`resource-capture.test.ts`（擷取與量表狀態機，量表數值取自 61-3／61-4／61-5 真實 eventmap）、`resource-log.test.ts`（分析核心與折線幾何）、`backup-v5-resources.test.ts`（envelope v5 往返與 v4 相容）；打撈／建造紀錄 CSV：`csv.test.ts`（分隔符偵測／跳脫／往返）、`drop-log-import.test.ts`、`build-log-import.test.ts`（自家格式往返、航海日誌拡張版相容解析、去重與 event ID 借號）；遠征期間彙總：`expedition-stats.test.ts`（分組／加總／排序／CSV，含壞資料不得變 NaN）、`exped-log-overview.test.ts`（分區 HTML 產出：escape、排序箭頭、缺席文案） |
| `utils/db.ts` | Dexie schema **v12**：stores 為 events、wanted、sorties、notified、factory、replays、expeditions、snapshot、shipObtained、eventPlans、resources、resourceMarks、meta；events 的 `captureId` 為 unique index，並有 `postProcessState`；v10 不猜補歷史 captureId／state／metadata；v11 純新增 `eventPlans`（主鍵 areaId）；v12 純新增 `resources`（主鍵＝來源 event id）與 `resourceMarks`（主鍵＝字串 key），既有表不變、無遷移、**不回填歷史**（v12 之前沒有任何餘額序列可考） |
| `utils/ingestion-persistence.ts`／`utils/background-ingestion-lifecycle.ts` | raw event 持久化、captureId 去重與 collision 拒絕、pending/processing/done 狀態機，以及 SW recovery 的單一順序 queue |
| `utils/event-projector.ts`／`utils/projection-cursor.ts`／`utils/event-pruning.ts` | derived-table 投影、`meta['projection']` version 3 cursor，以及只刪已投影 raw event 的安全裁剪 |
| `utils/ship-debut-data.ts` | 艦娘「官方登場日」參照資料（date1），鍵＝**基礎形態** master id。**產生物、勿手改**——改 `samples/ship-debut-dates.json`（人工來源，含 tw/en 譯名）後重跑 `tools/ship-debut/generate.py`。遊戲 API 不提供此日期，見 NOTICE §4 |
| `tools/ship-debut/generate.py` | 上表產生器：來源 JSON（艦名鍵）＋`samples/start2-master.json` → 以基礎形態 master id 為鍵的 TS。艦名拼法別名（`Samuel B. Roberts`→`Samuel B.Roberts`、`Kirov`→`Киров`、`島根丸`→`しまね丸` 等 5 筆）在**產生階段**一次解掉，執行期不帶別名表 |
| `utils/expedition-data.ts` | poi 遠征需求資料（MIT，見 NOTICE） |
| `utils/expedition-stats.ts` | 遠征紀錄的期間彙總核心（純函式，無 chrome.*，node 可測）：`filterByPeriod()`／`summarize()`／`groupByMission()`／`sortStats()`／`statsCsv()`。**收入是逐筆事件的獲得量、不是餘額差分**，故與資源紀錄刻意不共用輸出。詳見「遠征紀錄的期間彙總」 |
| `public/icons/**.svg` | 裝備／資源／UI／數值圖示（原創向量，**由 `tools/icons/` 產生，勿手改**）；裝備檔名即 `api_type[3]`。`ui/airraid.svg` 為出擊紀錄的基地空襲標記（遊戲沒有這顆，本專案新造）。`stat/` 為艦娘數值 17 顆（`gen_stats.py`） |
| `tools/icons/` | 圖示生成器＋設計約束（視角／明度下限／描邊／徽章規則），改圖示前先讀其 README |
| `samples/` | 真實封包樣本（驗證 fixture）＋機體／UI 參照圖（`kanmusu_filter.png` 艦娘篩選、`KC3kai_sortie_log.png` 出擊紀錄展開檢視） |
| `docs/architecture-v1.md` | 原始架構書（設計對照基準） |
| `docs/design-guidelines.md` | UI／圖示設計綱要：色彩角色變數、字距四級距、動效（按下即回饋＋三個無障礙 media query）、元件尺寸量表、刻意不做的事（含理由）。提出介面或圖示修改前先讀，改動落地後回來更新 |

### Handoff：持久化、投影與發布契約（以程式碼／測試為準）

**IndexedDB v12**：object stores 為 `events`（`++id, ts, path, &captureId, postProcessState`）、
`wanted`（`++id, eventId, tag, ts`）、`sorties`（`eventId, sortieKey, ts`）、`notified`（deckId）、
`factory`（`eventId, ts, kind`）、`replays`（`sortieKey, ts, world`）、`expeditions`（`eventId, ts,
deckId`）、`snapshot`（`path, ts`）、`shipObtained`（`id, mst`）、`eventPlans`（`areaId`）、
`resources`（來源 event id）、`resourceMarks`（字串 key）、`meta`（key）。
v9→v10 新增 capture ingestion／post-processing／projection 所需的 events 索引與 `meta`；不回填
歷史 `captureId`、`postProcessState` 或 projection metadata；歷史 events 因而不是可恢復的
post-processing 工作，缺／未知／損壞 projection metadata 則從 retained raw events 的 0 重投影。
v10→v11 僅新增 `eventPlans`（活動作戰板使用者計畫，主鍵 `areaId`）；v11→v12 新增
`resources` 與 `resourceMarks`，既有 store 與資料不回填、不改寫。

**Capture／ingestion lifecycle**：MAIN world interceptor 被動觀察後，經 ISOLATED bridge 移除 token／verno，
以固定 `captureId` envelope 送往 background；同一 envelope 的一次 retry 仍用同一 captureId。background
才解析 `apiText` 並透過 `ingestEvent()` 寫入，任何 provider 都不得直接寫 `db.events`。新 event 必先保存為 `pending`；同 captureId 只允許相同 path 與 timestamp，
否則 collision 拒絕。取得 transactional claim 才轉 `processing` 並執行廣播、snapshot、通知、
pruning 等副作用；成功標 `done`，失敗歸還 `pending`。SW 啟動時先將帶 captureId 的遺留
`processing` 歸還 `pending`，再按 event ID recovery；新 ingestion 與 recovery 共用 promise queue，
故副作用不會超前。通知使用固定 notification ID，snapshot 與 derived rows 使用冪等寫入。

**Projection boundary**：`EventProjector` 是四張 derived tables 的入口。它保存 `dropMst`、
replay difficulty 與 replay／sortie 關聯；新船保留判定結合 `dropMst` 與 `shipObtained`，而非由名稱
反推。投影成功一筆才推進 projection cursor；safe pruning 只刪已投影的 retained raw events，metadata
無效時停止裁剪。`snapshot` 僅是 GameState baseline，絕不可送入 projector。

**單場 JSON 匯入不是 raw ingestion**：只接受 Fleet Chronometer `toKc3Replay()` version 4 與既有
fixture 證實的 KC3Kai logger 格式；它在 transaction 內寫 `sorties`／`replays`，並借用 events key
generator 後立即刪除 reservation，**不寫 raw event**。去重為同海域、完整戰鬥節點序列與 ±10 分鐘；
雙方都有封包時再比 canonical 原始封包，否則才以時間 fallback。Fleet Chronometer 自身匯出沒有結算
欄位；KC3Kai logger 的 `rating`／`drop`／`mvp`／`hqEXP`／`baseEXP` 可帶來結算資訊（`SS` 正規化為 `S`）。

**產品識別與版本**：套件名稱與版本以 `package.json` 為唯一來源；manifest 權限以
`wxt.config.ts` 與 `tests/manifest.test.ts` 為準。本文不重複維護版本與權限清單。
**品牌名走 i18n、不是固定字面值**——manifest 只放 `__MSG_extName__`／`__MSG_extShortName__`／
`__MSG_extDescription__`（`default_locale: en`），實際名稱由 `public/_locales/{en,ja,zh_TW}/messages.json`
決定：en「Fleet Chronometer」／ja「クロノメーター」／zh_TW「航海鐘」。頁面標題是**另一份來源**
（panel／overview 於執行期以 ui-i18n 的 `ov.brandShort` 改寫 `document.title`），兩份必須逐語言
一致，否則同一個擴充在瀏覽器選單與視窗標題上會叫兩個名字——`tests/manifest.test.ts` 常駐把關
（另驗預設語系的三個 key 齊全：預設語系缺一個 key，Chrome 會直接拒載整個擴充）。
**`popup/index.html` 的 `<title>` 是 load-bearing 的佔位字串，別改成實際名字**：WXT 會把 popup
entrypoint 的 `<title>` 寫進 manifest 的 `action.default_title`，而且**蓋過 `wxt.config.ts` 裡
的設定**——佔位字串在 manifest 裡才會被代換成當前語系的品牌名（圖示 tooltip）；改成實際名字
會把 tooltip 鎖死在單一語言；測試的 `default_title` 與 popup `<title>` 兩條
斷言就是這件事的兩端）。**HTML 本身不做 `__MSG_` 代換**（只有 manifest 與 CSS 會），故 popup 的
`document.title` 改由 `popup/main.ts` 於執行期以 `ov.brandShort` 改寫（同 panel）。
extension app icon 位於 `public/icon/`，來源在
`tools/app-icon/`：意象為二戰軍艦航海用的黃銅萬向環天文鐘；它與
`public/icons/equipment`／`resource` 的遊戲資料圖示是兩套資產，不能混用。

`GameState.applyEvent(path, api, req, ts = Date.now())` 是核心：一個大 if-else 依 `path` 更新狀態；
EventProjector 與 state recovery 必須傳入原始 `event.ts`，live 呼叫未傳時才使用預設現在時間。
面板純讀 `GameState` 渲染。

### 各遊戲介面對應的 kcsapi path（實測，2026-07）

進入介面時的「讀取」封包；實際操作（發遠征、解體、改修…）另有 `api_req_*` 端點。
用於 `autoSwitch` 或未來新增介面即時反映功能。

| 介面 | path | 介面 | path |
|------|------|------|------|
| 母港 | `api_port/port` | 工廠 | `api_get_member/preset_dev_items` |
| 遠征 | `api_get_member/mission` | 改修（明石） | `api_req_kousyou/remodel_slotlist` |
| 入渠 | `api_get_member/ndock` | item課金 | `api_get_member/payitem` |
| 編成 | `api_get_member/preset_deck` | 圖鑑 | `api_get_member/picture_book` |
| 改裝 | `api_req_kaisou/can_preset_slot_select` | 任務 | `api_get_member/questlist` |

`autoSwitch` 接線：`api_port/port`→一般、`api_req_map/start`/戰鬥→出擊、
`api_get_member/mission`/`api_req_mission/start`→遠征、`api_get_member/questlist`→一般
（任務圖示為遊戲全域頭部列常駐圖示，任何畫面下點選皆會送此封包）、
`api_get_member/preset_dev_items`/`api_req_kousyou/remodel_slotlist`/工廠操作
（createitem/createship/getship/remodel_slot）→工廠。
補強增設裝備是獨立端點 `api_req_kaisou/slotset_ex`（無 `api_slot_idx`，已實測）。

---

## 戰鬥預測子系統（重點）

流程：戰鬥封包 → `state.ts` 呼叫 `analyzeBattle()` → `battleInfo` → `renderSortie()`；
`battleresult` 補確定 rank 與掉落。戰後血量寫回 `this.ships`，燃彈依費率表估算。

### 現行遊戲 API 格式（血淚換來的關鍵知識，別再猜）

- **血量**：`api_f_nowhps`/`api_f_maxhps`（我方主隊）、`api_e_nowhps`/`api_e_maxhps`
  （敵主隊）、`*_combined`（隨伴）。**皆 0-indexed、無 leading -1**（舊版單一
  `api_nowhps`=`[-1,我1..6,敵1..6]` 已不送）。
- **砲擊/夜戰**（`api_hougeki1/2/3`、`api_hougeki`）：`api_at_eflag[i]` 分攻擊方
  （0=我,1=敵），`api_at_list`/`api_df_list` 索引為各方**局部 0-5（主）/6-11（隨伴）**。
- **雷擊**（`api_raigeki`）：`api_fdam`/`api_edam`=受傷、`api_fydam`/`api_eydam`=造成
  傷害（MVP 用）。damage 可能帶小數，需 floor。
- **航空/基地/噴式**：`api_stage3`=對主隊、`api_stage3_combined`=對隨伴（索引+6 對映）。
  漏算隨伴會 rank 誤判（已用 6-5 封包實證：漏算→A、正確→S）。
- **敵艦 id**：`api_ship_ke`（主）、`api_ship_ke_combined`（隨伴），0-indexed、無 -1。
- **陷阱**：`'...battleresult'.startsWith('...battle')` 為 true——戰鬥分支必須
  `!path.endsWith('result')`，否則結算封包被誤吞、battleInfo 洗空。

### 特殊攻擊的傷害歸屬（不是公式問題，是欄位問題）

`analyzeBattle` 不計算傷害——傷害是伺服器算好包在封包裡的數字，我們只負責**歸屬**
（哪艘打哪艘）與加總。所以命中率/暴擊/裝甲穿透這類公式與我們無關；唯一風險是
「某特殊攻擊把傷害放進一個我們完全沒讀的欄位」，導致漏算。

依 wikiwiki.jp/kancolle 戰鬥機制頁比對（2026-07）：

| 特殊攻擊 | 結構 | 狀態 |
|---------|------|------|
| 對潛先制爆雷 | 跟通常砲擊戰同一種「複數敵→複數傷害陣列」 | ✅ 已涵蓋（`api_opening_taisen` 走 `processHougeki` 通用陣列） |
| 彈著觀測射撃／空母戰爆連合CI／夜戰CI | 倍率已算進最終 `api_damage`，不影響我方讀取 | ✅ 已涵蓋（讀最終數字，不管倍率怎麼來） |
| 噴式強襲 | 跟標準航空戰同公式；基地與空母分別由不同封包欄位提供 | ✅ 已涵蓋（基地：`api_air_base_injection`；空母：`api_injection_kouku`） |
| 支援艦隊（對敵） | `api_support_info.api_support_airatack.api_stage3.api_edam`（航空／對潛系）／`api_support_hourai.api_damage`（砲擊／雷擊系，索引=敵位置） | ✅ 航空／砲擊欄位路徑已以 61-5／61-3 真實封包驗證；`api_support_flag` 1/2/3/4 分類為航空／砲擊／雷擊／對潛，未知值依結構回退 |
| **友軍艦隊** | `api_friendly_battle.api_hougeki`（夜戰封包內獨立 top-level 欄位）；`api_at_eflag` 0=友軍攻擊敵方、1=敵方攻擊友軍（不影響玩家） | ✅ `api_hougeki` 已用 61-3 甲 boss 夜戰驗證（`samples/61-3.json` node53，友軍傷害不計入玩家 MVP）；`api_raigeki` 該樣本未出現，寫法防禦性預留、**未經真封包驗證** |

- **自軍聯合艦隊**：已用真實 61-5 甲自軍水上部隊封包驗證（`samples/61-5-jibun-rengou-*.json`）。
  主隊/隨伴血量歸屬、局部 0-11 索引、MVP `[1,3]` 與 rank `A` 皆與 logger 記錄**完全一致**。
- **聯合艦隊開幕雷擊陷阱**：`api_opening_atack` 的造成傷害欄改叫 `api_fydam_list_items`／
  `api_eydam_list_items`（每格 null 或陣列），**不是** flat 的 `api_fydam`／`api_eydam`。
  傷害/血量走 flat `api_fdam`/`api_edam` 仍正確，但漏讀 `_list_items` 會少算開幕雷擊的
  MVP 貢獻——`processRaigeki` 已補 `creditDmgList`。
- 友軍艦隊出現在活動海域 boss 夜戰：`api_friendly_info`（友軍組成）+
  `api_friendly_battle`（友軍戰鬥行動）為夜戰封包的 top-level 欄位。
  `processFriendlyHougeki` 只扣敵 HP（eflag=0 時 df_list 為敵方位置），
  eflag=1（敵方反擊友軍）不影響玩家艦——已用真封包數字逐筆核對，另用極端值
  （9999 傷害灌進 eflag=1 分支）驗證不會誤傷玩家艦或誤觸大破警告。
  `processFriendlyRaigeki`（僅讀 `api_edam`）尚無真封包樣本，屬防禦性預留。
  友軍砲擊欄位已用樣本驗證，不再列入 `wantedTag`（該函式只留渦潮表外與未知 sally key）。

### 大破・損管・退避（`battle.ts` isTaiha／`state.ts` escapedShipIds）

**三種大破訊號語意不同，面板必須分開講**（合成一句會讓人不知道到底能不能進擊）：

| 情況 | 欄位 | 語意 |
|------|------|------|
| 主隊旗艦大破 | `flagshipTaiha` | 遊戲**禁止**進擊＝強制返航 |
| 主隊旗艦帶著未消耗的損管 | `flagshipDamecon`（0/1/2） | 結算後同意使用即可突破「旗艦大破不能前進」 |
| 其餘艦大破 | `isTaiha` | 可以進擊，但**會被轟沈** |

`isTaiha` 刻意排除三種艦：主隊旗艦（改由 `flagshipTaiha` 表達）、隨伴（第二艦隊）旗艦
（機制上不會被擊沉）、已退避艦。**損管必須裝在大破的旗艦自己身上才有效**，裝在其他隊員
身上不保護旗艦，故 `flagshipDamecon` 只讀旗艦那一格。

`GameState.bossEntryTaiha` 記錄**抵達 boss 節點當下**是否已有大破艦，供出擊紀錄與資料分析
使用；它不再決定大破警告的版面。值在 `api_req_map/start`／`next` 抵達 boss 時拍一次，同一次
出擊不再更新；`null`＝沒看到那一步，不能當作「沒有大破」。判定採殘 HP > 0 且 ≤ 25%、未退避
且包含旗艦，刻意不沿用 `isTaiha` 的排除規則：前者回答「進 boss 前是否已有大破」，後者回答
「一般隊員繼續進擊是否有轟沈風險」。契約鎖在 `tests/boss-entry-taiha.test.ts`。

**損管的回復量**（使用者提供之遊戲設定，非封包驗證）：応急修理要員＝修復至**中破（最大HP
的 50%）**；応急修理女神＝HP＋**燃料彈藥全快**。20% 會讓修復後仍判定大破，與遊戲行為
不符，因此不可採用。女神的燃彈補回排在 `battleresult` 套完
`applyConsumption` 之後（`restoreGoddessSupply`），否則會被同一節點的消耗再扣一次。

**連合艦隊第二艦隊旗艦不會被擊沉**（使用者提供之遊戲設定）：`BattleShipView.unsinkable`，
致命傷時存活；不會沉就不需要損管，故該艦的損管**不發動、留給後面的節點**。殘 HP 取「存活
的最低值 1」——**無真封包佐證**，重點在不誤報轟沈（`predictRank` 的 pSunk 與大破警告都會被
牽動）。

**退避（艦隊司令部施設）**：`GameState.escapedShipIds`（艦實例 id），`api_req_map/start`
與 `api_port/port` 清空。退避艦離開艦隊 → 不再參戰、**不再消耗燃彈**、戰鬥封包若仍帶著它
的血量位置也不寫回，且該隊的**等級／制空／索敵／TP 一律按剩下的船重算**（七艘退避一艘就
是六艘繼續進擊，再大破一艘退避就剩五艘）。`fleetSummary`／`combinedSummary`／`airPower`／
`f33`（連 `2×(6-n)` 的艦數修正一起變）／`fleetTP` 全部排除退避艦。**退避的代價**：大破艦
與護衛艦皆燃料歸 0、cond 一律變 22（回港另有 −15＝合計 7，那段由 port 實數覆蓋不模擬）。

**三顆司令部系裝備各自綁定一種編制，不可互換**（使用者提供之遊戲設定；`retreatAvailability()`
回傳 `{ state, kind }`，`kind` 就是成立的編制種類）。272／413 不得合併為「單艦隊用司令部」
清單，否則 272 在六艘一般編成裡也會誤報「可以退避」：

| 裝備 | 適用編制 | 退避形式 |
|------|---------|---------|
| 107 艦隊司令部施設 | 連合艦隊 | **護衛退避**：大破艦＋一艘健康驅逐艦一起離場 |
| 272 遊撃部隊 艦隊司令部 | 遊撃部隊（單艦隊 7 艘） | **單艦退避**：只有大破艦離場，不需要護衛艦 |
| 413 精鋭水雷戦隊 司令部 | 水雷戦隊（輕巡系旗艦帶驅逐艦等小型艦） | **單艦退避**（另有雷裝／命中加值，本專案未計入） |

裝了不對應編制的那一顆＝沒有退避選項（連合帶 272／單艦隊帶 107 皆無效）。判定條件：272 看
**艦數是否為 7**（第七格本身就是這顆開出來的，屬封包事實），413 看旗艦艦種為輕巡系
（`stype` 3／4／21）且其餘皆小型艦（1／2／3／4／21）——**後者是使用者描述的轉寫、未經封包
驗證**，取較寬的讀法（寧可提示成立、由玩家以遊戲畫面確認，也不要漏列艦種而謊報「不能退避」）。
面板文案必須依 `kind` 分開講：把護衛退避的說明套到單艦隊，會讓玩家去找根本不存在的護衛艦。

**連合艦隊的護衛退避規則**（使用者提供之遊戲設定，非封包驗證）：

- 只有**第1艦隊旗艦**裝備 `艦隊司令部施設`(107) 才成立——裝在其他艦上完全無效。
- 大破艦可以在第1或第2艦隊，但**兩隊的旗艦都不能退避**（第2艦隊旗艦大破也不能退避，
  它靠的是轟沈保護）。**一場戰鬥只能退避一艘**，即使同時兩艘以上大破。
- 護衛艦的挑選是**固定順位、由上到下**：第2艦隊 2 號艦起往下，第一艘「損傷未達小破」的
  驅逐艦即是（旗艦拖不了）；**第1艦隊的驅逐艦再健康也不能當護衛艦**。面板預告用
  `canTowEscort()`／`retreatAvailability()`；實際標記比照 KC3Kai 採封包 `tow_idx[0]`。
- ⚠️ **門檻是「損傷未達小破」不是「滿血」**（殘 HP > 最大值的 75%）：かすり傷照樣拖得動。
  若以 `api_nowhp >= api_maxhp` 判定，38/40 的驅逐艦會被誤報為沒人可當護衛艦＝
  `'noEscort'`＝「沒有退避選項」，因此門檻必須維持 75%。
- ⚠️ **「沒出現護衛退避」≠「沒有人大破」**：挑不到護衛艦時遊戲根本不給退避選項。面板
  因此有 `'noEscort'` 這一態並明講出來——把它讀成安全訊號就會大破進擊。
- 除第2艦隊旗艦外，**兩隊的僚艦都會正常轟沈**——別把旗艦保護誤讀成整隊保護。
- 單艦退避（272／413）**沒有 `'noEscort'` 這一態**：不需要護衛艦，全隊都受損也照樣成立。
- **退避之後要按剩下的船重算大破警告**：退避的意義就是「讓剩下的船繼續進擊」，退掉唯一
  那艘大破艦後還掛著警告，等於叫玩家別做他剛做完的事。`goback_port` 之後**不會再有新的
  戰鬥封包**觸發重算，故該分支自己把退避位置標到 `resultFleets` 上再跑一次
  `battle.ts` 的 `taihaFlags()`（那段抽成獨立函式就是為了這裡與 `analyzeBattle` 共用一套
  判定）。位置對映沿用 `shipAtSortiePos`，且只處理它解得出 id 的位置，兩邊不會各自漂移。

> ⚠️ **`api_escape_idx`／`api_tow_idx` 是「可以退避的船」不是「實際退避的船」**（實機
> 回報反推，2026-07-31）：某次連合出擊只有朝霜曳航大井退避，面板卻把第2艦隊三艘驅逐艦
> 全標成退避——反推位置集合為 `{8, 10, 11, 12}`＝大破的大井（第2艦隊2號艦）＋**全部三艘
> 未損傷驅逐艦**，正是遊戲護衛退避的候補條件。候補陣列不得整批標記為已退避，否則健康艦
> 也會被設為燃料 0、cond 22，並錯誤剔出制空／索敵／TP。
>
> 收斂比照 KC3Kai `SortieManager.checkFCF`：`api_escape_idx`／`api_tow_idx` **各只取
> [0]**（一場只退一艘大破艦、最多一艘護衛）；索引 1-based、連合時 >6 為隨伴；單艦隊不採
> tow。旗艦位置（1／連合的 7）解不出則不標。`wantedTag` 不再為此抓樣本。
> 契約鎖在 `tests/taiha-escape.test.ts`。

### 勝利判定 `predictRank`（clean-room 重寫，已用真實資料校準）

損害率 = (開戰殘HP合計 − 現在殘HP合計) / 開戰殘HP合計。由上而下：

1. 敵全滅＋我無轟沈 → `S`（遊戲對完全勝利也回 S，故**不吐 SS**）
2. 敵全滅（我有轟沈）→ `A`（edge 未實測）
3. 我無轟沈＋**敵數>1**＋敵沉 ≥ `floor(敵數×0.7)` → `A`（**floor 非 ceil**，1-1 boss 實證）
4. 敵損害率 > 我×2.5 → `B`；5. 敵損害率 > 我×0.9 → `C`；6. 其餘 → `D`

### 出擊燃彈消耗費率（日wiki「資材」頁，依 path＋海域套用）

途中封包不帶燃彈實數，按節點類型估算，回港 `api_port/port` 實數校正。
規則：每戰獨立、切捨、**0<x<1 進位為 1**；已用 wiki 睦月型夜戰例驗證。
**寫回時機**：戰鬥封包只暫存費率（`pendingConsumption`），HP 照常即時寫回；燃彈延到
`battleresult`（顯示 rank+掉落時）才一併扣（`applyConsumption`）——途中面板維持戰前油彈，
與遊戲戰鬥畫面一致（油彈餘量影響傷害，過早顯示會誤導）。map/start 與回港會清空 pending。
結婚艦 −15% 是補給折扣、不影響途中油量計，不套用。

**隨伴艦隊的判定必須看封包，不能看 `currentSortieFleetId === 0`**：
第1艦隊「單獨」出擊時 `currentSortieFleetId` 同樣是 0，若據此就把第2艦隊當隨伴，會讓
根本沒出門的第2艦隊被扣燃彈（面板因而跳出未補給提醒）。正解是 `GameState.hasEscortFleet(api)`
——**只有連合艦隊出擊的封包才帶 `api_f_nowhps_combined`**，故以該欄位存在與否為唯一證據；
費率 push 進 `pendingConsumption` 時就一併記下 `hasEscort`（結算時才套用，不能到那時才回頭猜）。
`applyBattleHp` 不需額外判斷——非連合時 `analyzeBattle` 的 `playerEscort` 本來就是空陣列。
已用兩份真封包回歸驗證：`samples/6-5-ec_battle.json`（我方單艦隊 vs 敵連合，**無**
`api_f_nowhps_combined`）第2艦隊須完全未動；`samples/61-5-jibun-rengou-node52.json`
（自軍連合，**有**該欄位）第1＋第2艦隊都須扣除。

| 節點 | 判斷 | 油 | 彈 |
|------|------|----|----|
| 普通晝戰 | 其餘 `.../battle`、`ec_battle` | 20% | 20% |
| 夜戰接續 | `battle_midnight/battle` | +0% | 補到 **ceil(晝彈×1.5)** |
| 開幕夜戰 | `sp_midnight` | 10% | 10% |
| 航空戰(雙向) | `airbattle`(非 ld_) | 20% | 20% |
| 空襲戰(單向) | `ld_airbattle`＋6-4/6-5 | 4% | 8% |
| 空襲戰(單向) | `ld_airbattle` 其他(5-2/7-2/活動) | 6% | 4% |
| 反潛點 | 敵主隊全潛水(stype13/14)；boss(color=5)與4-1/4-3例外仍20/20 | 8% | 0% |

> 未涵蓋：活動特殊點（PT 4/8・雷達 4/0・對潛空襲 12/6）按普通處理；
> 大漩渦電探減免待 `api_req_map/next` 的 `api_happening` 真實封包。

### 出擊途中的艦載機戰損（`GameState.queuePlaneLoss`／`spreadPlaneLoss`，與燃彈同屬估算）

戰鬥封包的航空戰段**只給整場合計損失機數**（`api_stage1.api_f_lostcount` 制空戰＋
`api_stage2.api_f_lostcount` 對空砲火），**沒有任何逐格殘量欄位**（已逐一檢查 samples/ 的
6-5 ec_battle 與 61-3／61-4／61-5 三份聯合艦隊封包）；`api_onslot` 只在
`api_port/port` 與 `api_req_hokyu/charge` 更新，故出擊途中必須另外處理搭載數變化。

**逐格分攤是永久估算，不是待收斂的暫代**（2026-08-07 以 wikiwiki「航空戰」定案）：
遊戲機制是**逐格獨立亂數**——制空戰
`⌊｛搭載數 ×[A + 制空常數/4]｝/10⌋`（A＝0～制空常數/3；確保時常數＝1），對空砲火亦為
逐攻擊機格獨立判定（艦戰不受對空砲火）。封包只吐各格擲完後的合計，資訊論上無法從合計
反推「哪一格掉幾架」；重跑 wiki 公式也救不了（要重現每一格的亂數與敵方對空分配，被動
觀測做不到，且會與封包已給定的合計打架）。因此不可用「先算合計再分攤」的模型收集樣本；
即使增加樣本也無法收斂逐格亂數的真實結果。

現行做法與燃彈**完全同一個模式**（連寫回時機都一樣）：戰鬥封包只把損失架數累積進
`pendingPlaneLoss`，**結算（`battleresult`）才逐段寫回**，回港 `api_port/port` 以實數校正。
⚠️ **不可改成戰鬥封包當場扣**：那會讓編成的制空在交戰打到一半時就往下掉，但戰鬥中要看的
正是「這一場交戰時的制空是多少」（同 `pendingConsumption` 的理由：途中油彈維持戰前值）。
演習的 `battle_result` 一律丟棄不套用（演習不消耗艦載機），同 `pendingConsumption`。

在可辨識參戰格的搭載總數足夠時，**合計扣除量等於封包給的損失數**（合計是封包事實）；逐格
按目前搭載數比例分攤（大數餘額法補零頭，單格不扣成負數、扣不下的餘額順延）。若封包損失
反而大於可辨識搭載池，代表機種集合／快照／欄位理解至少一項不完整：最多只歸零已知格並輸出
診斷警告，不把未分配量謊稱已分攤。`GearView.countEst` 為 true 時，推估**只在 hover title
標示**（`slotCountTitle` 的「（推估）」）——**不得在 chip／compact 列的搭載數前加 `≈`
之類的前綴符號**：那一格的寬度是釘死的（見 docs/design-guidelines.md §7 的裝備列單行預算），多一個字元就會把
數字推擠、打亂整排對齊，而這種程度的推估不值得付版面代價。
噴式強襲／航空戰／二巡航空戰三段各自累積、結算時逐段套用（一段一段來才與實際
發生順序一致）；只吃當下那一則封包，夜戰接續重放晝戰不會重複扣。已退避艦不分攤。
**`api_plane_from` 刻意不使用**——它的索引基準（連合時主隊／隨伴怎麼編號）沒有真封包佐證，
讀錯會把損失整批攤到錯的艦上。參戰機種清單 `AIR_COMBAT_CATS`（6艦戰/7艦爆/8艦攻/11水爆/
45水戰/56-58噴式）是機制轉寫，偵察機系與對潛機系不分攤。契約鎖在 `tests/plane-loss.test.ts`。

**面板的敵我方機數格**（`renderSortie` 的 `planeCell`）跟著同一條時間線：**節點打完之前
顯示「出擊機數 -損失」（`238 -23`），結算後只留殘存機數（`215`）**。交戰中要看的是這一場
投入與折損；夜戰接續沒有航空戰、機數不會再變，故整個節點期間維持同一組數字不中途改口。
結算後 `-損失` 已是打完的資訊（殘存數才是要帶進下一節點的），**不再顯示**。
`殘存/出擊 -損失`（`215/238 -23`）會把三個數字擠在一格，也會在交戰中過早把殘存數當定局。

**熟練度（`api_alv`）連帶問題——制空會顯示偏高的舊值**：擊墜會讓熟練度下降，制空跟著掉
（`airPower()` 的 `BONUS_F`／`EXP_LO`／`EXP_HI` 三項都吃 alv）。但**沒有任何出擊中／回港的
封包帶熟練度**——已逐一查證 `api_port/port`（`samples/slot_to_port.json`：只有 `api_ship`，
無 slotitem）與 `battleresult`（`samples/6-5-ec_result.json`：只有 rank／掉落／經驗／MVP）
皆不帶；`slotItems` 只有 `api_get_member/require_info`（登入）與 `api_get_member/slot_item`
（開裝備畫面等）會整批刷新。故撈完回港後遊戲裡的熟練度已經掉了，本擴充卻還握著出擊前那份。

**制空公式本身沒有問題，缺的是輸入值**（容易誤讀，先講清楚）：`airPower()` 已與遊戲機制
逐項對得上——單格 `floor(對空 × √搭載數 + 機種類型加成 + √(內部熟練度/10))`，小數全程保留、
**只在該格算完才捨去**；`BONUS_F`＝[0,0,2,5,9,14,14,22]（戰鬥機系）、`BONUS_SPB`＝
[0,0,1,1,1,3,3,6]（水爆）、艦攻／艦爆的機種類型加成為 0 但仍吃 √(內部熟練度/10)（故最多
+3）；`EXP_LO`／`EXP_HI` 即 0-7 階的內部熟練度值域，看不到實際值故一律回 min~max 區間。
wiki 例題（對空10、24 搭載、熟練 >>）→ 74 已鎖進 `tests/plane-loss.test.ts`。

⚠️ **機種類型加成必須依正確類別分組**（`AIR_TB_FIGHTER`／`AIR_IMP_FIGHTER`）：56／57 是
噴式戦闘機／噴式戦闘爆撃機，真正的局地戦闘機是 48。若誤把 56／57 當局戦／陸戦，雷電・
紫電改・隼・Spitfire 等 31 種局戦不會計入基地航空隊制空，噴式機反而會多拿最高 +22 的
戰鬥機加成；日 wiki 明載艦攻・艦爆・噴式機的機種類型加成為 0。正確分組：
戰鬥機加成＝艦戦(6)・水戦(45)・局戦/陸戦(48)；水爆(11) 走 `BONUS_SPB`；其餘為 0。
改修★制空補正同組（艦戦/水戦/局戦 +0.2★、艦爆 +0.25★；噴式機的★補正未查證，維持 0.2★）。
契約鎖在 `tests/lbas-status.test.ts`。

**結算時機是「回港那一刻」，不是每場戰鬥**（日wiki：`出撃時の残数と帰投時の残数を比較し、
残数比率によって熟練度が低下する`，發生於母港帰投時）。故**出擊途中手上的 alv 仍然正確、
不可標過時**——在戰鬥當下標會整趟掛著一個當時並不成立的警示。`GameState.snapshotSortieOnslot()`
於 `api_req_map/start` 拍下逐格搭載實數，`settlePlaneProficiency()` 在 `api_port/port`
（`api_ship` 寫入之後）比對結算：

- **全滅（帰投時 0 架）→ 熟練度歸零（帯なし）**。wiki 唯一給出的絕對規則，且兩端搭載數都是
  母港封包實數，故這是**確定值不是估算**：直接寫 `alv = 0` 並解除過時標記。
- **部分損耗 → 依殘數比率下降，但 wiki 明載「低下については要検証」、沒給下降量**（只說
  常時發生，即使制空確保也約 3.5% 損耗）。故只標過時、**不推算**。
- 沒損耗 → 完全不動。

`GameState.alvStaleGears` 記「熟練度可能已過時」的**裝備實例 id**（逐格，不是全域旗標）；
`fleetSummary()`／`combinedSummary()` 以 `airStale` 帶出去，面板把制空值標成估算（虛線＋
說明）。歸零時機**只有** `require_info`／`slot_item`（全量，整批清空）。
⚠️ **不可在 `api_port/port` 歸零**——回港封包不帶裝備資料，歸在那裡等於謊稱已校正。
⚠️ **`ship_deck`／`ship3`／`ship2` 的 `api_slot_data`＝未裝備清單（KC3Kai／EO unsetslot），
不是裝備實例＋alv**——不可拿來消過時標記；那三條路徑只合併帶 `api_ship_id` 的完整艦資料
與 `api_deck_data`。契約鎖在 `tests/plane-loss.test.ts`。

### 關卡進度與剩餘次數（`api_get_member/mapinfo`，已實測驗證）

- `api_map_info[]`：`api_cleared`、`api_gauge_type`（1=擊破數式：`api_defeat_count`/
  `api_required_defeat_count`；2=HP量表式：`api_eventmap.api_now_maphp`/`api_max_maphp`）。
- **面板一律顯示「剩餘」語意**（量表隨進度遞減）：gaugeType 1 顯示「剩 N 次」=
  `required-defeat`（別顯示已擊破數，會被誤讀）；gaugeType 2/3 同理顯示剩餘。已用 6-5 實測（defeat 4/6 → 剩 2）。
- **maxHp=9999 為「尚未選擇難度」佔位**（`api_selected_rank`=0 時），非真實滿血。
- **gaugeType 2（HP量表式）擊破機制**（使用者提供，2026-07-19，已用 `samples/61-5-jibun-rengou-node52.json`
  數字對照：總量表 8400、boss 旗艦 HP 1200＝`api_e_maxhps[0]`、入場 `now_maphp=809`）：
  量表**每場依「對 boss 旗艦造成的傷害」遞減**（非整刀），例如某場僅打 500 傷害＝8400→7900。
  進入「最終段」（殘量 ≤ boss 旗艦 HP，如 809≤1200）後，**傷害不會把量表打到 0——會 floor 在 1**
  （`now_maphp=1` 表「最終段、還差一沉」）；**唯有該場實際把 boss 旗艦沉沒，量表才真的變 0＝通關**
  （打了 900 但沒沉 1200 仍是失敗，量表停在 1）。**推論（斬殺偵測的機制保證）**：`now_maphp===0`
  在機制上唯一等價於「這場斬殺（沉 boss）成功」，故 `detectClear`／`isGaugeBroken` 只認 ===0
  是精確判定、非近似；`now_maphp===1`（最終段未沉）正確留在「未通關→保留」。
- **斬殺偵測的兩個端點皆已用真封包驗證**（`isGaugeBroken` 逐一核對）：未通關端
  `samples/61-5-jibun-rengou-node52.json` eventmap＝`{now_maphp:809, cleared:0}`→False；
  已通關端 `samples/61-4.json` eventmap＝`{now_maphp:0, cleared:1, gauge_num:4}`→True。
  **另定案 `api_first_clear` 不可當斬殺旗標**：它在「未通關」時存在(=1)、「已通關」後反而消失
  （61-5 有、61-4 無），語意與「剛通關」相反。**仍未觀測到的只剩「即時性」**——擊破當下
  遊戲是否立刻推一筆 `now_maphp=0` 的 mapinfo（或要等玩家再開圖才送），這只影響 detectClear
  的觸發延遲、不影響判定正確性。即時 mapinfo 仍待 live 觀測；`wantedTag` 不再為此抓樣本。
- 剩餘次數：gaugeType 2 = `ceil(殘HP/boss旗艦HP)`（boss HP 實戰擷取；此為「最少場數」下界，
  假設每場都 S 沉 boss——`ceil(8400/1200)=7`＝使用者說的「最少 7 次」、`ceil(809/1200)=1`＝剩 1 次）；
  gaugeType 3（TP輸送）的量表欄位與剩餘場數尚未以真實封包驗證；目前 UI 不以
  `fleetTP()` 推估場數。`fleetTP()` 的理論公式可供未來驗證，但不能當成目前契約。
- EO 的 `api_sally_flag` 語意未解（兩份樣本比對過，尚未實際消耗過次數）。

### 出擊重播（KC3Kai battleplayer 相容，`utils/replay.ts`＋`db.replays`）

面板 consume 期間把「出擊時艦隊快照＋各節點原始戰鬥封包」累積成 `ReplayRow`（主鍵
sortieKey，put 冪等、重播回填），`toKc3Replay()` 輸出 KC3Kai kancolle-replay
[battleplayer](https://kc3kai.github.io/kancolle-replay/battleplayer.html) 可貼上／可另存圖片的物件。
**格式來源已交叉確認**（player.js 解析端＋poi→kc3 轉換器，2026-07）：頂層
`{ fleet1, fleet2, fleetnum, combined, battles:[{node,data,yasen}], world, mapnum, diff, time }`；
**每個 `battles[i].data` 就是一則原封不動的原始 kcsapi 戰鬥封包**（與
`samples/61-5-jibun-rengou-node52.json` 同格式——該樣本本身即 KC3Kai logger 匯出）。
ship 欄位用 KC3Kai 命名（`mst_id`/`lv`/`equip`/`stars`/`ace`/`exequip`/`nowhps`/`maxhps`），
stats 由 battleplayer 依 mst_id+lv+equip 自算，故不帶。已用真實封包執行期驗證：
raw packet 原封保存、node/rank 歸位、fleet ship shape 正確。
擷取判別：夜戰＝path 含 `midnight` 但排除 `sp_midnight`（開幕夜戰當該節點主資料）；
`battleresult`＝補 rank 到最後節點；其餘帶 `api_f_nowhps` 者為晝戰/航空戰。
若保留的事件流沒有該次出擊的 `api_req_map/start`，就無從建立出擊時艦隊快照；該場只能保留
可建立的摘要，不能補猜編成或重播內容。面板何時開啟本身不是判定條件。
直接播放走 battleplayer 原生 `#fromLZString=`（官方 1.4.4 URI 安全壓縮），因為連合艦隊
重播的 raw JSON fragment 經常超過 30,000 字元上限、只開得到空白播放器；不經 kcrdb／
tinyurl 上傳。出擊紀錄「下載出擊記錄」把複製 JSON、下載 JSON、下載 PNG 重播圖與直接播放收在同一選單；PNG 可見層是本專案卡片，JSON 寫在 alpha。契約鎖在 `tests/replay-kc3-compat.test.ts`（含 61-5 甲水上打擊樣本）。

### 出擊紀錄的展開檢視（`utils/sortie-detail.ts`＋`sections/sortie-log.ts`＋`utils/deckbuilder.ts`＋`utils/sortie-simulator.ts`，2026-07-22）

**現行呈現**：一次出擊一張卡，摺疊列兩行（行1＝#第幾次・關卡代號・出擊編成成員；
行2＝節點軌跡＋結果標記），展開才給細節。將出擊作為單位可同時辨識隊伍、路線與結果，
避免把同一場出擊拆成難以追溯的節點流水帳。

**資訊密度對照 KC3Kai 的出擊紀錄展開檢視**（參照圖 `samples/KC3kai_sortie_log.png`，
使用者指定的標竿）：四支艦隊各一欄（主力／護衛／道中支援／決戰支援）＋基地航空隊三隊
編成＋逐節點作戰資訊（敵編成與殘血、rank、索敵、航向、觸接、航空戰、雙方機數增減、
陣形、MVP、提督經驗值、掉落有無）。**與 KC3Kai 的兩處差異**：節點字母改走對照表（見「節點字母」小節）；
**「基礎經驗值」不在遊戲封包裡**，故本機擷取的紀錄一律沒有——只有從 KC3Kai 匯出匯入的紀錄
會帶（它自己算的 `baseEXP`），UI 因此是「有值才顯示」並標明來源。

**為此擴充了擷取層（皆為 optional 欄位、非索引，故 schema 不需升版；舊資料一律當
「不可考」，不回填猜測值）**：

| 新欄位 | 來源（皆已用真封包驗證） | 為什麼非存不可 |
|---|---|---|
| `SortieLogRow.getExp` | battleresult `api_get_exp` | 提督經驗值，KC3Kai 那張圖的主要數字之一 |
| `SortieLogRow.mvp`／`mvpEscort` | `api_mvp`／`api_mvp_combined`（**1-based**） | 遊戲回傳的**確定值**（非 `analyzeBattle` 的預測）。已用 `samples/6-5-ec_battle.json`＋`6-5-ec_result.json` 同一場交叉驗證：預測值 4 與 `api_mvp` 4 一致，且傷害最高者為 0-based index 3 ⇒ 確認 1-based |
| `SortieLogRow.enemyName` | `api_enemy_info.api_deck_name` | 敵艦隊名（「任務部隊 主力群」） |
| `SortieLogRow.baseExp` | **不在遊戲封包裡**——只有從 KC3Kai 匯出匯入時才有（`baseEXP`） | 基礎經驗值。本機擷取的紀錄永遠沒有這欄，UI 有值才顯示 |
| `SortieLogRow.nodeEventId`／`nodeEventKind` | `api_req_map/start\|next` 的 `api_event_id`／`api_event_kind` | 節點類型（見下）。**存原始值不存推導出的標籤**——語意對照日後修正時，舊紀錄會跟著變正確 |
| `ReplayRow.fleet3`／`fleet4` | `api_req_map/start` 當下的第3/4艦隊快照 | 支援艦隊編組。**戰鬥封包的 `api_support_info.api_ship_id` 是艦實例 id、沒有等級與裝備**，要像 KC3Kai 那樣把支援畫成艦隊只能事前快照 |
| `ReplayRow.lbas` | 出擊當下同海域的全部基地航空隊 | `api_air_base_attack` 只會出現「有出擊的那幾波」，答不了「這次三個基地各自的編成與行動」（含防空隊） |

**道中支援／決戰支援的分法**：以「該支援有沒有在 boss 節點出動」判定，不看 deck 編號——
玩家可以把任一隊當道中或決戰。61-3 真封包實測正好兩支（第3艦隊在 25／51、第4艦隊在 53），
這也是「必須分兩欄」的依據。

**出擊模擬器跳轉走 `#backup=`**：simulator.html 的 `{ fleetF, nodes }` hash 會呼叫
`initSimImport`、藏起編成介面並立刻開跑；`{ fleet1, battles }` 與 `#backup=` 才會停在
可編輯畫面。後者是模擬器自己的設定備份契約（CONVERT.loadSave），能帶補強增設與純潛艦
節點的 `subOnly`，並用 LZMA 壓進 fragment 上限。艦船 `unknownstats` 警示來自上游資料表
標記，不能靠填猜測素質消除。契約鎖在 `tests/sortie-simulator.test.ts`。

**制空権シミュレータ跳轉走 `#import:{predeck}`**：`?predeck=` 會整段送給 GitHub Pages，
出擊資料超過 request URI 上限就 414；hash 不上伺服器。noro6/kc-web 的
`Convert.loadDeckBuilder()` 除
f1～f4／a1～a3 外，另讀 `s`（`a`＝world、`i`＝mapnum、`c[]`＝各格 `c`／`pf`／`ef`／
`f1`／`f2`）與陸航 `sp`（派遣格，對 `c[].c`）。出擊紀錄因此另組
`buildReplayAirCalcDeck()`，不把這兩欄寫進複製用的標準 DeckBuilder JSON。`f1.t` 帶
`api_combined_flag`，否則 kc-web 把 f1／f2 當兩支單艦隊；支援艦隊不進 f3／f4，以免被
算進我方制空。`c`／`sp` 用出擊 edge id；對得上 kc-web MasterCell 才補節點名並讓陸航對到
該格，對不上時敵艦隊仍匯入。契約鎖在 `tests/air-calc-deck.test.ts`。

**摺疊列（banner）只放「哪一隊、誰帶隊」**：
`#第幾次・關卡代號・**旗艦**・艦隊編制・時間・展開箭頭`＋第二行的節點軌跡與結果標記。
12 艘全名單會把 banner 撐成三行、還把時間與箭頭擠掉；完整名單在展開後逐艘呈現。
編制標籤：連合三種（空母機動／水上打撃／輸送護衛，`api_combined_flag`）＋**遊撃部隊**
（`combined===0` 但主隊 7 艘——只有遊撃部隊艦隊司令部做得到，是封包事實不是猜測）＋單艦隊。

**節點藥丸：節點標籤是主角**。節點字母是 11px 的 `--dim`、rank 是同級距的粗體彩色，
兩個字擠在一起分不清哪個是節點哪個是戰果。現在節點 14px 粗體主要文字色、rank 以一條分隔線
推開並降一級字級；boss 藥丸另加語意色淡底。

**基地空襲節點掛空襲警報圖示**（`public/icons/ui/airraid.svg`，M7 圖示族的第 76 顆）：
節點軌跡的藥丸與節點卡各一顆。**遊戲沒有這個圖示**——它是本專案繪製的回轉警示燈意象，
同樣由 `tools/icons/gen_ui.py` 產生、`normalize.py` 注入描邊，不手改 SVG。

**展開內容一律可折疊**：一次出擊的資訊量太大，全部攤開
反而找不到東西，故分四段、各有自己的開合：

- **出擊編成**：常駐（要看「帶了誰」），但**每艘的裝備預設折疊**——六艘×五格圖示會變成一面
  圖示牆。點艦卡展開單艘，或用區塊標題的「全部裝備」批次開合。艦卡收合時仍顯示 Lv／cond／
  血條／裝備數。
- **支援艦隊／基地航空隊**：整段預設折疊，但**收合時的摘要必須看得出內容**
  （「道中支援 第4艦隊・決戰支援 第3艦隊」「第1基地 出擊・第2基地 出擊・第3基地 防空」）
  ——藏起來讓人找等於沒做（同活動作戰板標籤成員的教訓）。
- **逐節點**：一節點一列、**由上而下＝路線先後順序**（網格排法左→右換行，會讓順序變成
  用猜的），預設收合，可單獨點開或用「全部節點」批次開。收合列放的是要橫向掃描比較的東西
  （節點・rank・boss／夜戰・制空・支援／基地・大破・掉落），細節留給展開。

折疊一律用原生 `<details>`：開合狀態由瀏覽器自己管，分區不必為此多一份 state；方向指示用
`▸`／`▾` 字元而非 `transform: rotate`（rotate 在 `prefers-reduced-motion` 下要關掉，關掉後
兩態長得一樣，狀態訊號就消失了——design-guidelines §4.3）。

**連合艦隊要顯示編成類型**：`api_combined_flag` 1＝空母機動部隊／2＝水上打撃部隊／
3＝輸送護衛部隊（2 已用 `samples/61-5-jibun-rengou-node52.json` 確認）。三者的隨伴艦隊角色
完全不同，只寫「連合艦隊」等於沒說。

### 節點類型（`utils/map-node-kind.ts`）——這個**在**封包裡

`api_req_map/start`／`next` 的 `api_event_id`／`api_event_kind` 直接給出節點性質，**是封包事實**，
與需要外部對照表的節點字母完全不同層次。節點類型必須直接保留這兩欄，才能呈現
「這條路線上有渦潮、有能動分歧、有空襲戰」等資訊。

語意轉寫自**航海日誌拡張版**（Nishisonic/logbook，MIT，見 THIRD-PARTY-NOTICES §6）的
`MapCellDto.getNextKind()`：`api_event_id` 2＝資源獲得／3＝渦潮／4＝戰鬥／5＝boss／
6＋kind＝敵影を見ず・能動分岐・気のせい／7＋kind＝航空偵察・航空戰／8＝船團護衛成功／9＝揚陸地點。

`api_event_kind`（戰鬥節點的細分）**只採用有樣本佐證的三個值**——KC3Kai 匯出的 `nodes[].desc`
與同一筆 `eventKind` 對得上：**6＝空襲戰**（61-3 節點 50、61-5 節點 48/37/51，封包
`fc_ld_airbattle`）、**5＝敵連合艦隊**（61-3 節點 53、61-5 節點 55，desc「深海聯合艦隊」）、
**1＝一般戰鬥**。其餘（2/3/4…）**一律回 null 不猜**——寧可少一個標籤也不要標錯節點類型
（同「節點字母」那次的教訓）。一般戰鬥與 boss 也不標，rank 與 BOSS 徽章已經說明了。

**存原始值、不存推導出的標籤**：語意對照日後若補上更多 eventKind，舊紀錄會自動跟著變正確。

**順帶查證的結論**：航海日誌拡張版**有記錄節點但不做字母**——它的「戰鬥履歷／掉落報告」表格
「マス」欄顯示的是 `MapCellDto.toString()`＝`マップ:6-5 セル:13 (ボス)`，編號＋類型而已。
這是「字母不在封包裡」的第三個獨立佐證（KC3Kai 自維護對照表、航海日誌乾脆不做）。

### 節點字母（`utils/map-node-letters.ts`）——`api_no` 是「路線段」不是「格子」

**關鍵事實**：進軍／戰鬥封包給的 `api_no`（本專案存成 `SortieLogRow.node`）是**路線段（edge）
id**，不是格子 id，更不是字母。KC3Kai 的 `edges.json` 一筆 edge 對到 `[起點字母, 終點字母]`，
我們要的是**終點字母**；而且**多條 edge 會對到同一個字母**（同一節點從不同方向進入——6-5 的
C／G／H／I／M 各有兩條）。所以「編號 → 字母」是多對一，**不可能由編號推算**。

61-5 真實出擊提供的對照如下，證明 edge id 與字母沒有可推導的順序關係：

```
edge    1   48   15   37   51   52   55
letter  A    E    I    Q    Y    Z   ZZ
```

**`api_get_master/mapinfo`／`api_get_master/mapcell` 不提供字母**：
那類 master 端點給的是**格子**（`api_id` 全海域通號／`api_no` 同海域內編號／顏色…），
既沒有字母、也不是我們手上的 edge id；字母是攻略圈的命名慣例，不在任何封包裡。
（`api_req_map/start` 的 `api_cell_data` 同理——ElectronicObserver 的 apilist 明載
`api_id`＝全海域通號、`api_no`＝同海域內編號，兩者都不是字母。）

**解法**：用 KC3Kai 的 `edges.json`（MIT，見 THIRD-PARTY-NOTICES §5）產生
`utils/map-edge-letters.ts`（193 張海域、5904 條 edge，只留終點字母）。
**兩份獨立的真實資料交叉驗證通過**：(a) 使用者提供的 61-5 路線 A/E/I/Q/Y/Z/ZZ 逐筆相符；
(b) 使用者提供的 KC3Kai 6-5 截圖（`samples/KC3kai_sortie_log.png`）顯示 A C E H G M，
與表中 edge 1/3/5/8/7/13 完全一致。

查不到的海域（新活動開圖、上游還沒更新）**顯示原始 edge 編號並在 UI 說明原因，絕不推算**；
原始編號一律留在 tooltip。`EDGE_LETTER_OVERRIDES` 供臨時人工覆蓋（平時應為空）。

**顯示節點的地方一律走同一支 `nodeLabel()`**（面板出擊分頁、出擊紀錄的軌跡／節點卡／基地波次／
支援出動節點、LLM 報告）。節點字母只能使用已驗證的對照表；查不到時顯示原始 edge 編號，
不以 ASCII 或其他推算法補出字母。不同海域的 edge 編號並不共用同一字母順序，直接推算會產生
看似合理但錯誤的節點標籤。

**單場 JSON 匯入（2026-07-22，2026-07-22 收緊）**：分區工具列的「匯入 JSON」只接受兩種
已確認來源：(a) 本專案 `toKc3Replay()` 產生、帶 `version:4` 的固定格式；(b) KC3Kai logger／
kancolle-replay 現有 fixture 證實的格式（`nodes`＋`eventmap`＋logger battle wrapper）。
`parseSortieImport()` 先辨識格式再逐欄驗證；其他通用 JSON、部分相似物件與未知工具格式一律拒絕。

- **重複判定**：海域＋**戰鬥節點序列**必須完全相同，
  且一律受 **±10 分鐘**邊界限制。兩邊都有重播時，比對 `data`＋實際存在的 `yasen` 完整原始
  封包（物件 key 排序後 FNV-1a）；不混入只存在 KC3Kai wrapper 的 rating/drop/MVP/EXP。
  任一邊沒有封包（既有紀錄的重播已裁剪）才在同一時間窗內只靠時間 fallback。故相同封包跨日
  不會誤判，同時間窗內相同路線但實際戰鬥內容不同也不會誤判。判定在 transaction 內做，命中
  即整個 rollback，不留半筆。
  **「已存在」是預期結果不是錯誤**，UI 用獨立的顏色與訊息，與「格式錯誤」分流。
- **event ID 向 generator 借**（`events.add`→`delete`，同 backup 的 reservation 手法）：
  這樣匯入的 derived rows 永遠不會被未來擷取的 raw event 撞號覆蓋。**但不寫任何 raw event**
  ——匯入的是別處的紀錄，不是本機觀測到的封包（provider 合約）。副作用：匯入過的安裝之後
  就不是「乾淨環境」，備份還原會被拒（與擷取過任何封包同一條規則，見「母港快照與資料備份還原」）。
- **KC3Kai 對「沒有夜戰的節點」寫 `"yasen": {}`**（空物件仍是 truthy）：直接 `if (entry.yasen)`
  會讓每個節點都被標成夜戰接續，還會把空物件餵進 `analyzeBattle`。判準改為「至少有一個
  `api_` 開頭的欄位」（`hasPacket()`），`data` 也走同一關。這是靠離線預覽看出來的（見下）。
- **KC3Kai logger 的匯出帶完整結算資訊，但鍵名跟 kcsapi 不一樣**：**檢查欄位缺席前先把整個
  物件的鍵列出來**，避免把不同命名誤判為資料缺席：

  | KC3Kai 鍵 | 意義 | 存進 |
  |---|---|---|
  | `rating` | rank。**會吐 `SS`（完全勝利），遊戲的 `api_win_rank` 只吐 `S`** | `rank`（SS 正規化成 S，與本機擷取同形狀） |
  | `drop` | 掉落艦的 **master id**（0＝沒掉） | `dropMst`＋`drop`（艦名由呼叫端的 `shipName` 解析器補） |
  | `mvp` | `[主隊, 隨伴]` 位置（1-based） | `mvp`／`mvpEscort`（**隨伴只在連合艦隊採用**——單艦隊時它仍會填 1） |
  | `hqEXP` | 提督經驗值（同 `api_get_exp`） | `getExp` |
  | `baseEXP` | 基礎經驗值。**遊戲封包沒有這欄**，只有匯入的紀錄才有 | `baseExp`（UI 有值才顯示，並標明來源） |
  | `boss` | boss 節點旗標 | 與 `nodes[].eventColorNo===5` 互相補強 |

- **本專案自己的 `toKc3Replay()` 匯出不含結算**（那是重播格式，只有戰鬥封包），故走那條路徑
  匯入時 rank 仍為空、節點卡顯示 `analyzeBattle` 依損害率推算的**推定值**（虛線框＋title 標明），
  掉落顯示為不可考、**不顯示「無掉落」**——那是「不知道」不是「沒掉」。
- KC3Kai 的第 3／4 艦隊快照沒有 HP；本專案 `toKc3Replay()` 也沒有 cond。匯入時保留「來源
  未提供」而不是補 0：支援艦隊 HP 在 UI 顯示不可考，主力／護衛 HP 則必須由自身欄位或第一個
  戰鬥封包取得並通過 `0 <= nowhp <= maxhp`、`maxhp > 0` 驗證。
- 匯入的紀錄一律標「匯入」徽章，並自動 `pinned`（否則時間戳很舊的匯入紀錄下一次重播裁剪
  就被掃掉）。
- **清單排序與「第幾次」計數改依時間**（`sortieTime()`）：匯入紀錄拿的是當下最大的 event ID，
  照 ID 排會讓一場三年前的出擊變成「最新一次」。

**版面驗證用離線預覽**（`tools/preview/sortie-log.ts`，開發用、不進 bundle）：
`npx vite-node --config vitest.config.ts tools/preview/sortie-log.ts` 會把 `samples/` 的
KC3Kai logger 匯出轉成本專案的 ReplayRow／SortieLogRow、套 overview 的同一份 CSS，產出
`.preview/sortie-log.html`（深色）與 `-light.html`（亮色），可直接開瀏覽器或用 headless
Chrome 截圖檢視。**完全離線、不連遊戲、不需登入**（帳號安全紅線）。真實資料才看得出
版面問題——手捏假資料看不出 12 艘編成、4 波基地航空隊、12 隻敵艦時會怎麼爆版。

- **「第幾次」是該海域的第幾次出擊**（依時間升冪計數），**不隨篩選變動**——序號是歷史事實，
  篩選只是視窗。故 `numberSorties()` 必須餵全部紀錄，不是篩選後的子集。活動作戰時
  「E3 第 7 次」比時間戳更接近玩家腦中的計數方式。
- **通常／活動兩大分類做成分段控制**（不是下拉）：這是本分區最常切的維度，有幾個選項、
  現在在哪一邊，不展開就該看得到。活動判定＝`world >= 10`，**不列舉活動編號**（每次活動
  都換號，列舉必然過期）。海域下拉只列**該分類裡實際有紀錄的**海域（同裝備全覽的圖示架，
  選項隨資料收斂）。活動再拆「哪一次活動」與「該活動第幾關」：歷次活動各自一組
  En，關卡數跟紀錄走、不寫死五關；切到活動分類預設最新一次。活動主標走
  `event-calendar.ts` 的年份＋季節（「2026夏季」）；遊戲不送這層資訊，表外不從出擊
  時間戳反推。跨年時活動下拉依年份分組、組內只寫季節。卡片在單次活動內顯示
  `E{n}`＋難度徽章，跨活動並列才帶「2025秋季 E3」；官方作戰名與編號（`62-3`）在 title。
- **展開時才解析封包**（含 `analyzeBattle` 戰鬥重放），結果快取；摺疊列只用 `db.sorties`
  摘要＋快照——否則一進分區就要把整個重播層跑一遍。
- **先畫殼、再讀資料**：`render()` 第一件事是 `el.innerHTML = shellHtml()`
  並綁好工具列／匯入面板的事件，**之後**才 await `db.sorties`／`db.replays`。資料讀取慢、丟例外或
  **卡住**（Dexie 版本升級被其他分頁／面板擋住時 `open()` 會無限等待）時，
  整個分區就是一片空白——連「匯入 JSON」都按不到，使用者只看到「介面不見了」而毫無線索。
  現在殼一定先出現，載入中顯示「載入中…」，失敗只影響清單並印出原因（含「關掉其他分頁再
  重新整理」的提示）。`overview/main.ts` 也把 `sec.render()` 包在 try/catch 裡——**任何分區的
  例外都不得靜默留白**。
- **戰鬥細節不另寫一套解析**：直接餵 `utils/battle.ts` 的 `analyzeBattle()`（面板即時監控
用的同一支），故展開看到的與面板顯示的一致，日後解析修正兩邊同時受惠。damecon 由
  快照的裝備 master id 還原（42 要員／43 女神，同 `state.ts getDamecon`），不是猜的。

**兩邊資料的分工要在 UI 上誠實呈現**：節點序列與勝負來自 `db.sorties`（永久保留）；
敵艦等級／制空詳情／基地航空隊組成／支援艦隊編組**只存在於 `db.replays` 的原始封包**，
故沒有重播的舊出擊只顯示摘要那半邊，並明講原因（當時面板未開啟或重播已裁剪），
不假裝那些資訊不存在。

**已用真封包驗證的欄位**（`samples/61-3.json`、`samples/61-5-jibun-rengou-node52.json`，
測試在 `tests/sortie-detail.test.ts`）：

- `api_air_base_attack` 是**陣列**，一波一個元素：`api_base_id`（第幾基地）、
  `api_squadron_plane[]`（`api_mst_id`／`api_count`）、`api_stage1.api_disp_seiku`（該波制空）。
  61-3 boss 節點實測 4 波（基地1×2＋基地2×2），各波制空與損失皆不同，故 UI **一波一行**。
  ⚠️ 基地「防空」的 `api_destruction_battle.api_air_base_attack` 是**物件不是陣列**，
  兩者同名不同形；`lbasWaves()` 只認陣列，空襲節點走 `db.sorties` 的 raid 摘要。
- `api_support_info` 的 `api_support_airatack`（航空／對潛系）與 `api_support_hourai`
  （砲擊系）擇一非 null，兩者都帶 `api_deck_id` 與 `api_ship_id[]`。
  **`api_ship_id` 是艦實例 id 不是 master id**——UI 靠目前的 `GameState.ships` 反查艦名，
  查不到就顯示 `#id`（不猜）。已用 poi/lib-battle 對照與 61-5 真封包確認
  `api_support_flag` 的 1／2／3／4 分別對應航空／砲擊／雷擊／對潛；未知值才依存在的
  支援結構回退，並保留原始 flag 供除錯。
- `api_selected_rank`：1丁 2丙 3乙 4甲（三份甲難度樣本皆為 4）。

**節點標籤走 `utils/map-node-letters.ts` 的查表**：有對照顯示字母、沒有顯示原始 edge 編號，
絕不推算（兩種推算法皆已被真實資料否證，見「節點字母」小節）。

### LLM 分析子系統（`entrypoints/overview/sections/llm.ts`，2026-07-19 定案）

**權限邊界**：擴充不直接呼叫雲端 LLM API（api.openai.com／api.anthropic.com），
因為這需要新增網路權限；即使改用 `optional_host_permissions`＋執行期
`chrome.permissions.request()`（manifest 預設不變、只在使用者按下啟用時才跳一次原生
授權視窗、且僅限使用者填的那個網域）也仍是「新增」，違反本專案權限精簡的立場。
現行功能以三條不增加擴充網路權限的路徑提供分析：

1. **通用備份檔（主線）**：`buildFullReport()` 把提督/資源/四艦隊/基地航空隊
   （複用 `lib.ts` 的 `fleetMarkdown()`，與「艦隊全覽」分區共用同一段輸出，格式保證一致）
   ＋裝備改修方向摘要／依海域統計的出擊紀錄／遠征/工廠（建造·開發·改修）紀錄，整理成
   一份 Markdown。「複製完整報告」／「下載完整報告 (.md)」——純前端組字串＋既有的
   `downloadText`/`copyWithFeedback`，零網路、零權限。可直接貼進或上傳到任何主流
   LLM（Claude.ai／ChatGPT／Gemini…），資料出不出境完全由使用者決定要不要交出檔案。
   **報告摘要原則**：能預先計算的統計由擴充完成，不交給 LLM 從攤平的原始紀錄清單重算。
   出擊資料依海域分組：每個
   海域一行（次數/rank分布/大破次數/常見掉落/最近出擊時間），輸出行數只跟「去過幾個
   海域」成正比、不隨歷史筆數膨脹（查詢不設 limit，全量下去分組運算依然很輕量）；
   保留一份「最近 5 筆」純作時序參考，不作統計依據。裝備同理：**依種類（mst）彙總
   持有量＋改修分布**（例：「41cm連装砲：3個（★0×2 ★6×1）」），不逐顆列舉裝備實例
   （同款常見數十顆會很冗長）——這是回答「裝備改修方向」實際需要的最小必要形狀，
   資料來源是 `GameState.slotItems`（已公開欄位，排除 `consumableGearIds`），不依賴
   「裝備全覽」分區的 UI。**跟「資料備份與還原」的 JSON 是完全不同
   取捨**：JSON 那邊要的是精確可還原（保留每一筆原始紀錄／每一顆裝備實例），這裡
   要的是給 LLM 讀的精簡摘要——兩者故意不共用同一份輸出，混在一起會兩邊都不討好
   （JSON 為了精簡犧牲保真度、或報告為了保真度膨脹到爆 token）。
2. **MCP 掛載（純文件提示，非程式碼功能）**：UI 上一段說明——把下載資料夾指給支援
   MCP 的用戶端（例：Claude Desktop 設定檔加 `@modelcontextprotocol/server-filesystem`
   指向該資料夾）即可讓它直接讀取最新報告，不必每次手動上傳。**這整個流程發生在擴充
   之外**（另一支獨立行程，透過 stdio 跟 LLM client 對話 MCP protocol，讀寫的是使用者
   OS 帳號的檔案系統權限），擴充只做到「存檔」這一步就結束，不知道、也不參與後續——
   不影響本專案任何權限設定，故不需要、也沒有任何程式碼要寫。
3. **Chrome 內建 AI（Prompt API／Gemini Nano，實驗性）**：`entrypoints/overview/prompt-api.d.ts`
   宣告執行期用 `typeof LanguageModel !== 'undefined'` 特徵偵測的最小型別介面（官方文件
   已核對：`LanguageModel.availability()`／`.create({monitor})`／`session.prompt()`／
   `session.promptStreaming()`，見 2026-07 fetch 紀錄）。裝置端整段分析不連網路，同樣
   零權限零出境。**已知限制（務必保留提示文字，不要移除）**：
   - 官方語言清單目前僅列 en/ja/es/de/fr，**不含繁體中文**——本專案 UI 預設語言正是
     zh-TW，故對 zh-TW 內容的輸出品質無法保證，僅能 best-effort。
   - 裝置端 context window 較小，故這裡刻意只餵 `buildQuickContext()`（精簡摘要，非
     上面的完整報告）——避免超出額度；深入分析大量歷史紀錄請引導使用者改用完整報告
     交給雲端 LLM。
   - `promptStreaming()` 的分塊在不同 Chrome 版本可能是「目前為止的全文」或「只有新增的
     token」，且無法用特徵偵測分辨；`chunk.startsWith(acc) ? chunk : acc + chunk` 同時涵蓋
     兩種語意，避免輸出重複或遺漏。

### 艦名／裝備名譯名表（`utils/gamedata-i18n.ts`）

`localizeShip()`/`localizeGear()` 是名稱本地化唯一入口：`SHIP_NAMES`/`GEAR_NAMES`（master id
→ 各語言譯名，型別 `NameTable`）查表命中即回譯名，缺譯（id 不在表裡，或該語言欄未填）一律
回退封包原始日文名——因此「未填 = 顯示日文」，任何時候都能上線、不會出現空白。

**資料來源與產生流程**：`samples/i18n/*.csv` 是人工整理的來源（三份，玩家艦娘／深海棲艦／
裝備），`master_id` 對到真實封包（`samples/start2-master.json`）。英文名取自 kancollewiki
（Ship list／Enemy_Sortable／Equipment List 頁面，使用者另存 HTML 後用 `master_id` 精確比對，
**原始 HTML 不進版控**，只有整理後的 CSV 進 `samples/i18n/`）。繁體中文分兩層：(1) 人工翻譯
（沿用 `samples/ship-debut-dates.json` 既有的 `tw` 欄，332 艘艦娘基礎形態）；(2)
`tools/gamedata-names/fill-mechanical-tw.py` 機械規則補完——**日文原名含假名（ひらがな／
カタカナ）是唯一真例外**，其餘一律可機械處理：全漢字（含數字／半形全形括號／cm・mm 等
單位字母／Mk.II 等型號）用 OpenCC `jp2t`（日文新字體→繁體）轉字形，非漢字部分原樣通過；
改造形態沿用基礎形態的 `name_tw` 接同規律字尾：漢字字尾（改／改二丙…）比照上述轉字形；
外語**序數詞**字尾（德文 zwei/drei、法文 Deux/Trois、義大利文 due/tre、瑞典文
andra/tredje、俄文 два/три——這些在遊戲裡功能上就是該艦娘專屬的「改二／改三」）直接轉寫
成「改二／改三」，不音譯不沿用外語；Mk.II/Mod.2/Flight II 等**型號 designation**（跟
nuovo/amélioration 這類無法歸類的艦線自創字尾）不在此規則自動處理範圍，原樣沿用外語，跟
wiki 英文名同慣例。目前玩家艦娘 862/862 全覆蓋，深海棲艦 617/889、裝備 683/741（其餘為
片假名裝備名／深海棲艦片假名級別字母＋姫名，真正需要人工翻譯）。**新增列後（例如
翻譯缺漏匯出抓到的新內容）先重跑 `fill-mechanical-tw.py` 補機械部分，人工只需處理含假名的
殘餘**。**`utils/gamedata-names.ts` 為產生物、勿手改**——改 CSV 後重跑
`tools/gamedata-names/generate.py`。只寫「有值」的語言欄，缺譯的 id 完全不出現在表裡，靠
`localizeShip`/`localizeGear` 既有 fallback 顯示日文，產生器不補空字串、不猜值。

**翻譯缺漏偵測**（鎮守府情報總括 LLM 分區「翻譯對照缺漏匯出」）：`samples/i18n/*.csv` 只是
某次整理當下的快照，遊戲更新後的新艦娘/新深海棲艦/新裝備不會自動反映。`utils/
gamedata-known-ids.ts`（`tools/gamedata-coverage/generate.py` 產生，同一份 CSV 來源，只存
id 不存名稱）記錄該快照涵蓋的 id；`utils/gamedata-coverage.ts` 的 `findUnknownShips`/
`findUnknownGears` 拿目前封包實際載入的 `GameState.master`/`masterGears` 跟它做差集，UI
匯出「對照表沒有」的 id+日文名 CSV，供之後重新下載 wiki 頁面、重新整理對照表時知道該補哪些。

### 母港快照與資料備份還原（2026-07-19）

**快照用途**：LLM 報告是給人／LLM 讀的 Markdown，格式不可逆解析；母港狀態也不能只靠
重播 `db.events` 即時重建，而 `db.events` 本身會被 M6 裁剪到約兩個登入世代，完全解除
安裝再重裝＝`db.events` 歸零，重播出來什麼都沒有，要等使用者重新登入遊戲才會恢復。

**解法：新增 `db.snapshot` 表**（`utils/db.ts` `SnapshotRow`，schema v7）——不受 M6 裁剪
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

**現行備份契約（v4）**：restore envelope 包含 `snapshot`、`sorties`、`expeditions`、
`factory`、`wanted`、`shipObtained`、`eventPlans`；replays envelope 只包含 `replays`。
（2026-07-22 為出擊紀錄新增的 optional 欄位——`SortieLogRow.getExp`／`mvp`／`mvpEscort`／
`enemyName`、`ReplayRow.fleet3`／`fleet4`／`lbas`——已加進 `backup.ts` 的驗證，
**缺席即維持缺席**，舊備份不會因此被拒、也不會被補上預設值。）一般備份
不含 raw `events`、`notified`、projection metadata，也不含語言／主題／各分區篩選等
顯示偏好。任務導覽的釘選與人工完成（`api_no` 名單）會寫進 envelope 可選欄位
`questFlow`，還原後覆寫本機這兩項；舊檔沒有此欄則不碰既有釘選。v7 起完整檔另含
`questObserved`（本機 `clearitemget` 領獎列，以來源 event id 冪等保存）。日／週／月
以日本時間 05:00 為界，季任以 3／6／9／12 月 1 日 05:00 為界；年任只保存紀錄，目錄尚未
有開始月，不自行對齊年度週期。v8 起完整檔另含 `questSeen`（曾出現在任務清單的任務，
以 questNo 為主鍵、min／max 合併首末觀測；兩個 event id 都進 `highestReferencedEventId()`）；
v7 以前的檔案不含此表，照常匯入、表保持空白。v1 legacy-full、
v2 split、v3 仍可相容匯入——**每個版本的 restore 表組合各自固定**（`determineKind()`），
舊檔不會因為缺少後來新增的表被拒，新檔也不得少帶或夾帶。v3 新增 shipObtained、
v4 新增 eventPlans（活動作戰板，純使用者手輸、不參照任何 event id，故不進
`highestReferencedEventId()`）。`wanted` 匯入時重配自身自增 id，但保留 eventId reference。

匯入**不是 merge，也不會警告後覆寫**。第一次僅接受沒有 raw events、notified、projection
metadata、目標 rows，且 events generator 未被未知資料推進的乾淨環境。後續只有
`meta['backup-restore']` marker 證明的 complementary split file 可接續；重複匯入與來源不明
既有資料一律拒絕。validation、destination preflight、所有 writes、event-ID sequence reservation／
high-water 與 import marker 在同一 transaction；任一失敗完整 rollback。future local raw event ID
保證高於備份所有相關來源 event ID。restore/replays 可依受支援順序接續，但不表示兩檔必然同源。

#### 雲端備份與重播裁剪

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
現行 `BACKUP_SCHEMA_VERSION` 為 **7**（`kind: full`）；v1 legacy-full 可單檔匯入，v2–v5 的
restore/replays 拆分備份則可同次選取，或分兩次選取後由介面只在記憶體暫存、湊成一對；再正規化成完整現行版本，並以
一個 transaction 還原。所有 preflight、寫入、event ID reservation／high-water 與 marker 都在
同一 transaction，任一失敗完整 rollback。

**(C) 重播保留規則（`utils/retention.ts`＋backup 分區「重播層裁剪」UI＋sortie-log 釘選/刪除）。**
玩家取捨＝「大部分週回/路過場是耗材、少數關鍵場是紀念品」，故先保護、剩下才進裁剪窗。
`planRetention()` 保護判定（由上而下，任一命中即永久保留）：手動 ★ 釘選（`ReplayRow.pinned`）
→ 打撈到新船（`firstOwnedDropKeys`：該 master 首次「持有」且有 auto 觀測證據，非僅掉落名稱首見）→ 斬殺（`SortieLogRow.cleared`）→ 活動
boss（`diff>0` 且 boss）→ **所屬海域尚未通關（攻略中全保留**，解謎/索敵過程場先留，直到量表
擊破）；皆非則只留最近 `keepRecentDays` 天（預設 45，覆蓋一次活動全期）且保底最近
`keepRecentCount` 場（久違回歸者不被清光）。設定存 localStorage，UI 顯示「可裁剪場數／估計
釋放 MB」、手動裁剪只刪 `db.replays`（保留 sorties 摘要索引）。純函式已用 node 餵情境驗證
（新船/斬殺/釘選/攻略中/保底 N 場/超窗裁剪）。

**斬殺（cleared）偵測＝防禦性實作，判定欄位已實測、轉變 mapinfo 待真封包**（見待辦）：
`panel/main.ts detectClear()` 在 mapinfo 更新後比對量表，觀測到某海域「未擊破→擊破」
（`api_cleared` 0→1／HP量表 `api_now_maphp` 歸 0／擊破數達標，欄位皆已實測）就把該圖最近一場
boss 出擊標 `cleared`。只在「本次事件流曾看過該圖未擊破」時才判定轉變（避免面板啟動重播時把
「一開始就已通關」誤標到近期某場）；consume 於 replay/live 皆呼叫，歷史斬殺自動回填。
**尚未用真封包觀測到的只有「擊破當下緊接的 mapinfo」這個轉變本身**——`wantedTag` 不再為此抓樣本。
已用真實 `61-5-jibun-rengou-node52.json` 的 eventmap（`now_maphp=809, cleared=0`）確認
`isGaugeBroken` 對「未斬殺場」不誤觸。**已知邊角**：若斬殺後、下一次 mapinfo 到達
前又在同圖 farming，轉變會標到 farming 場而非斬殺場（罕見，且新船掉落＋手動釘選可補）。

### 基地航空隊中隊疲勞（`utils/lbas-cond.ts`）

**疲勞回復完全在伺服器端進行，回復時遊戲不推任何封包**（wikiwiki §疲労：`コンディション値は
3分ごとに増加`）。本擴充被動擷取、不主動發請求，故手上的 `api_cond` **永遠是「上次收到基地
航空隊資料那一刻」的快照**——玩家出擊完關掉基地畫面，面板就會一直掛著遊戲裡早就消失的疲勞
標記，且 `db.snapshot` 會讓它撐過重開（實機回報 2026-08-04：遊戲顯示無疲勞、面板顯示橙）。

機制數字（wikiwiki 原始 HTML 逐字，該頁自標 cond 值為**推測值**）：cond 0–46，**30–46 無標記
／20–29 橙／0–19 赤**；每 3 分鐘回復一次，札別基本量＝出撃 +1／防空 +2／退避 +3／待機 +4／
休息 +8，**基地整備Lv 會再提升**（加成量未查證，一律不計入＝保守側）；札回復上限 40。

**推論方向只有一個**：`lbasCondCertainlyClear()` 只在「連最慢的回復速度都足以回到 30」時才
把標記拿掉（長度 L 的時間窗必定含 `floor(L/3分)` 個 tick，屬下限推論不是估算）。**不得反過來
用最快速度提早抹掉疲勞**——那會把仍疲勞的中隊謊報成正常。札被中途改掉時取
「`condAsOf` 之後看過的最慢速度」（`GameState.airBaseCondMinRate`），用改完後的快札回算會提早
清除。面板一律走 `GameState.lbasCondStateNow()`，**不要直接用 `lbasCondState()`**（含編成列的
基地航空隊鈕染色）；標記還在只代表「還不能斷定已回復」，title 會寫明資料年齡。

**機數（補給）走另一條路，別跟疲勞混為一談**：`api_count` 只有 `base_air_corps`／`mapinfo`／
`set_plane`／`supply` 四條路徑會更新（戰鬥封包不帶），**補給後的即時更新只有 `supply` 那一條**。
`supply` 的真封包形狀已定案（`samples/air-corps-supply.json`）：請求為 `api_area_id` ＋
**單一** `api_base_id` ＋ `api_squadron_id`（**逐中隊補給**），回應的 `api_plane_info`
只帶被補給的那一個中隊（故 `mergeSquadrons` 是必要的，不是邊角防禦），另附
`api_after_fuel`／`api_after_bauxite` 兩項餘額（只就地更新 materials 的這兩格）。
`api_req_air_corps/*` 這一族的其餘請求參數仍無樣本，故一律經 `resolveAirBaseKeys()` 解析：
`api_base_id` 可能逗號分隔（`set_action` 實測如此）、`api_area_id` 可能缺席（rid 唯一時才退路
推定）。**解不出來時要 `console.warn` 不得靜默**；若把整串當 rid 組 key，查不到時面板會
繼續顯示補給前的機數。多基地一次補給時無法確定
`api_plane_info` 各屬哪個基地（squadron id 在各基地內都是 1–4），維持原狀不猜。

**標記的把握程度分三級，面板不得把「不能斷定」畫成「確定」**（`lbasCondCertainty()`）：
封包只給三段顯示碼，收到當下
只知道值落在一個區間（橙＝20–29、赤＝0–19），時間一過整段往上平移 `rate × tick 數`——
區間**下**限達 30＝`clear`（標記必定已退）、**上**限達 30＝`possiblyRecovered`
（可能已退但無法斷定，面板淡化 `.unsure` 並在 title 說明）、皆未達＝`certain`。
出撃札的橙：3 分鐘就進入存疑區、30 分鐘才 clear。**存疑時只能淡化不能隱藏**——
「不能斷定」不等於「已回復」，拿掉是把仍疲勞的中隊謊報成正常。

**降級是逐段的**（`lbasCondDowngrade()`）：赤 →（確定回到 20 以上）→ 橙 →（確定回到 30 以上）
→ `mild`。出撃札的赤要 90 分才確定回到無標記帶，但 60 分就確定已經只是橙；在剩餘 30 分鐘
繼續標紅會過度斷言。⚠️ **回到無標記帶時降為 `mild` 而不是 `normal`**：
剛跨過 30 的值顯然不是「全滿」，而 0 與 1 的分界沒有任何佐證，不能猜；要變 `normal`
只能靠新封包。

**對齊的主要路徑是 `mapinfo`，不是時間推算**：點「出擊→海域選擇」時遊戲會送
`api_get_member/mapinfo`，那一筆帶著完整的 `api_air_base`（含每個中隊的 `api_cond`），
面板收到就整批覆蓋並重設 `condAsOf`。正常遊玩流程下每次出擊前都會對齊一次，
時間推算（`lbasCondStateNow`）只是「兩次封包之間」的退路——別把它當成主要機制。
契約鎖在 `tests/lbas-cond.test.ts`「連續 mapinfo 會把疲勞狀態對齊到最新」。

回復沒有任何封包可以觸發重繪，故面板每秒算一次疲勞狀態簽章、變了才重畫
（`tickLbasCond`，非無條件重繪）。

**`api_cond` 是顯示碼、不是 0–46 原始值，四段對照為 `0`=全滿／`1`=輕度疲勞（**遊戲不顯示
標記**）／`2`=橙／`3`=赤**（2026-08-04 以四份真封包定案：同一隊 62_2 在一晚內隨連續出撃
走完 0→1→2→3，逐筆有實機畫面回報）：

| 值 | 語意 | 遊戲畫面 | 樣本 |
|----|------|----------|------|
| `0` | 全滿／完全休息 | 無標記 | `samples/mapinfo-air-base.json`（六隊 24 中隊全 0） |
| `1` | **輕度疲勞** | **無標記** | `samples/mapinfo-air-base-tired.json`、`samples/air-corps-supply.json`（剛出撃回來） |
| `2` | 橙（中度疲勞） | 黃臉 | `samples/mapinfo-air-base-exhausted.json`（檔名是命名當下的誤判） |
| `3` | 赤（重度疲勞） | 紅臉 | `samples/mapinfo-air-base-red.json` |
| 其他 | `unknown` | — | 顯示原始值不猜 |

`0` 與 `1` 遊戲都不顯示標記，差別只在「全滿」與「已經有點累」——**KC3Kai 也把這兩種畫成
不同表情**，本專案同樣分開：`1` 只給一顆 `--dim` 空心點（`.sq-cond.mild`），不給臉、不染
編成列的按鈕（遊戲本身都沒標記，染了比遊戲還吵）。

⚠️ **這組對照必須四段一起判讀**：只看 0/1/2 會把 1 誤讀成橙、2 誤讀成赤，並讓 `cond: 3`
落入 `unknown`。四段對照與社群工具 KC3Kai 的慣例一致；未知值顯示原始數字，不猜語意。
`utils/lbas-cond.ts` 的 `bandMin()`／`bandMax()` 用同一組碼（2→20–29、3→0–19），
改一邊就要改兩邊。

### 泊地修理與母港給糧（`utils/repair.ts`，2026-07-21）

**核心前提：遊戲完全不送這兩個機制的封包**——泊地修理與野埼給糧都在伺服器端靜默結算，
我們只能從 `api_port/port` 的編成／HP／cond 反推。故 `repair.ts` 的產出**一律是預估**，
UI 必須如實標示（面板倒數用虛線弱化樣式、錨點不可考時明講「倒數不可考」而非默默不顯示）。

**master 常數皆已用 `samples/start2-master.json` 驗證，非推測**：艦艇修理施設＝slotitem **86**
（`api_type[3]=26`）；明石 182（3槽）／明石改 187（4槽）／朝日 953（**stype 21 練習巡洋艦**）／
朝日改 958（**stype 19 工作艦**，3槽）／野埼 996（2槽）／野埼改 1002（3槽）。
**朝日改造前後 stype 會變**（21→19），故「未改造朝日不具工作艦能力」可直接用 mst 判定。

**涵蓋艦數公式**（使用者實測校正，與 wiki 摘要有出入處以實測為準）：
`涵蓋 =（1、2號位工作艦的基本數合計）+（該兩艦裝備的艦艇修理施設數合計）`，
基本數：明石／明石改 **2**、朝日改 **0**。已用實測五例逐一驗證：明石改+4吊=6、明石+3吊=5、
朝日改+0吊=**0（誰都不修）**、朝日改+3吊=3、明石改+1吊=3、明石+朝日改+5吊=7（遊撃全隊）。
**旗艦是明石或朝日改都可以、順序不拘**，但兩者都必須在 1、2 號位。

**加速（雙工作艦）**：1、2 號位皆工作艦，**且 2 號位至少帶 1 個吊車**（實測：2號位完全不帶吊車
則無加速或效果較弱）。倍率取 5/6≈83.3%（實測 82~84%、與雙方等級有關，故**是估算**）。

**HP 預估用 `api_ndock_time`，不要去猜艦種係數表**——遊戲每艘船都直接給「修好所需毫秒」，
`每1HP時間 = api_ndock_time / 損傷HP`，比 wiki 的部分倍率表精確且完整（實測 Lv99 傷4HP
＝2570000ms→10.71分/HP，與 `((Lv/10)+1)×倍率` 的 10.9 吻合）。結算量規則（使用者實測）：
`τ < t` 時**強制回復 1HP**（常見於戰艦/航母），否則 `H = floor(τ / t)`。

**中破以上不修，且範圍內被跳過的位置不由後面的艦遞補**——這條決定 UI 必須能區分
「在範圍內但不會被處理」與「根本不在範圍」（面板用刪除線標記 vs 無軌條）。

**計時器錨點（`repairAnchorByDeck` 20分／`moraleAnchorByDeck` 15分）**：伺服器從「編成完了」
起算，只能觀察會重置它的封包來推算。**兩個機制週期不同故各存一份錨點**——共用一份無法表達
「經過 15 分時給糧已結算、修理還沒」，結算後重新起算也會互相打架。

- **重置**：`api_req_hensei/change`（非 -2）改動該隊成員、該隊出擊/遠征後回港。
- **刻意不重置**（使用者實測的既知 bug feature，別「順手」補進清單）：`preset_select`
  （陣容保存/讀取）、`change` 的 `api_ship_id=-2`（隨伴艦一括解除）、僅更換裝備、其他艦隊的操作。
- **進母港時推進**：計時器在「進入母港畫面」推進，故 `api_port/port` 同時處理兩件事——
  出門中（`null`）的隊回港後重新起算；**已跑滿一個週期者視為本次進港已結算、錨點推進到下一輪**
  （否則倒數會永遠停在「可結算」）。未滿週期時進母港**不重置**（wiki 明載計數繼續）。
- 錨點 `null`＝出門中、`undefined`＝從未觀測到（面板剛裝或事件已被裁剪）→ UI 只顯示範圍、
  不顯示倒數，並明講「倒數不可考」而非默默留白。

**`applyEvent` 因此新增第 4 個參數 `ts`**，replay 時必須帶入原始 `event.ts`，否則錨點會被
重播當下的時間污染（`event-projector.ts`／`state-recovery.ts` 皆已接上）。`api_req_nyukyo/start`
的 `api_complete_time` 同樣以此 `ts + api_ndock_time` 計算；live 未傳 ts 才維持 `Date.now()` 預設，
高速修復不建立新的渠倒數。

**面板倒數每秒跳動但不重繪艦隊區塊**：倒數獨立成 `.rcd` 元素、錨點與週期存 `data-*`，
由既有的 1 秒 `setInterval` 呼叫 `tickRepairCountdowns()` 只改文字。**不要改成每秒整塊重繪**——
會重建所有裝備圖示，還會把使用者正打開的索敵倍率 `select` 關掉。

**誤差緩衝**：使用者實測「系統更新維修時間可能有約 1 分鐘誤差」，故倒數一律向上取整
再加 1 分鐘（`TIMER_SAFETY_MS`），避免玩家提早出擊中斷修理。

**野埼給糧**：須在 1 或 2 號位（比工作艦寬鬆）；自身條件為補給完了、小破未滿、**cond ≥ 30**、
非遠征/入渠。每 15 分回復同隊**除自己以外**全員 cond（野埼 +2／野埼改 +3，**上限 54**，
高於一般的 49、屬キラ區間），**每艘實際回復的艦消耗燃料 1**；已達 54 或入渠中者跳過且不耗燃料。
可與泊地修理同隊併用。

**自動測試固定的既知規則**：`tests/repair.test.ts` 覆蓋工作艦 master／涵蓋與吊車加速、停用與
跳過規則、HP 預估邊界、野埼位置／條件／多 tick／燃料、15 與 20 分鐘倒數；也覆蓋 GameState 的
錨點重設、出門／回港與互不干擾。`tests/state-recovery.test.ts` 驗證歷史入渠重播、snapshot＋retained
raw events 的 SW 恢復結果一致，且 state recovery 不建立 derived rows 或推進 projection cursor。這些
都是沒有專用結算封包下的**預估**測試，不把未驗證規則升格為封包事實。

背景 `alarms`／`notifications` 提醒已由 `entrypoints/background.ts` 實作，面板倒數 badge 並非唯一
提醒來源。

**目前尚未實作**：**緊急泊地修理**（連合艦隊出擊中的機制，與母港泊地修理是不同層次）——使用者提供之規則：
第1個修理裝置對二隊1~3號位、第2個對二隊4~6號位、第3個對一隊4~6號位，回復約最大HP 28%
（明石30%、秋津洲25%）；需要出擊context，且相關封包欄位未經真封包驗證。

### 任務本機進度追蹤（`utils/quest-progress.ts`＋`state.ts` `bumpQuestProgress()`，2026-07-23）

**現行行為**：面板「任務」分頁對可由本機事件累加的「N 回」型任務顯示即時進度，
例如遠征、演習勝利與近代化改修。

**核心限制與現有其他「本機才知道」的欄位同一處境**：`api_get_member/questlist` 只給
`api_state`（1受注可能／2受注中／3達成）與粗略的 `api_progress_flag`，**完全不給精確的
「已完成幾次」數字**。故本功能是「從任務標題/內文文字反推目標次數與動作種類，再用本機
觀測到的封包動作累加計數」，答案永遠是**自本機面板第一次看到這個任務起算**——若任務接受前
就已有進度（例如很早就點了受注、隔了幾天才裝上擴充），這個數字會低於遊戲內實際值。同
「date2 打撈上任日」的 baseline 誠實原則：寧可少算，不假裝知道看不到的部分。UI 的進度數字
帶 title 提示這件事（`quest.progressHint`）。

**`parseQuestGoal()` 只認得出「N回」字樣的任務**（已用真實 `samples/Quest.json` 61 筆任務
逐一驗證）：正規化全形數字（部分任務混用全半形，如 703「近代化改修を１5回成功させよ」是
全形「１」+半形「5」）後找 `(\d+)回`，再依關鍵字判斷種類（**順序刻意講究**：「近代化改修」
必須排在「改修」之前，否則會被裝備改修的關鍵字搶先命中）。以「隻」為單位的任務**原則上
刻意不支援**（撃沈20隻等）——那是「同時湊到 N 艘」的批次條件，語意上不是「累計 N 次」，
勉強套用會算錯，回退顯示受注中／達成。

**入渠任務是「N隻」規則的唯一白名單例外**（2026-07-23 補上）：實測任務「艦隊大整備！」
內文為「各艦隊から整備が必要な艦を5隻以上ドック入りさせ、大規模な整備をしよう！」——用
「隻」不用「回」。已用 KC3Kai 原始碼交叉驗證（clone 後查 `src/data/quests_meta.json` 該
任務 id=503 為 `tracking:[[0,5]]`，且其 `api_req_nyukyo/start` 封包 handler 對此 id 直接
`increment()`）：機制上是「每送出一次入渠請求即計數」，與「N回」語意相同，非要求同時湊到
5 艘在渠內。故 `parseQuestGoal()` 對「數字緊接『隻』、20 字內出現『ドック入り』或『入渠』」
這個已驗證的固定搭配另開一條規則、優先於一般「N回」判斷，回傳 `dock` kind；其餘「N隻」
批次條件（撃沈/撃破數等）不受影響，仍不猜。

**十五種可累加動作，各自掛在既有 event 分支上**（`GameState.bumpQuestProgress(kind, amount,
ctx)`）。`ctx`（`{area, boss, rank, missionId}`）是選填的**這次動作的上下文**，只有任務本身
在 `QuestGoal` 設了對應過濾欄位（`area`／`bossOnly`／`minRank`／`missionIds`）才會拿來篩選，
沒設定的任務（多數）行為不變、維持無條件累加：

| kind | 觸發點 | 判定 |
|---|---|---|
| `sortie` | `api_req_map/start` | 每次出擊呼叫即算一次 |
| `expedition` | `api_req_mission/result` | `api_clear_result >= 1`（與 `EventProjector.archiveExpedition` 同一個已驗證欄位；提早回航 `return_instruction` 不會呼叫這個端點，不會誤算） |
| `build` | `api_get_member/kdock` 偵測到新建造單 | 沿用既有 `newBuilds` 偵測邏輯（見該分支註解），非猜測 |
| `development` | `api_req_kousyou/createitem` | 不論成敗——任務常註明「失敗もOK」 |
| `supply` | `api_req_hokyu/charge` | 每次補給請求算一次，不以實補幾艘/幾多資源猜測次數（例：「艦隊酒保祭り！」補給15回） |
| `dock` | `api_req_nyukyo/start` | 每次入渠請求算一次（含高速修復），對應上述「N隻ドック入り」白名單 |
| `modernization` | `api_req_kaisou/powerup` | 遊戲機制上近代化改修沒有失敗判定，每次呼叫都算成功 |
| `remodel` | `api_req_kousyou/remodel_slot` | 僅 `api_remodel_flag===1`（成功）才算 |
| `remodelAttempt` | `api_req_kousyou/remodel_slot` | 同端點但不論成敗都算（任務619「失敗もOK」，與 `remodel` 各自獨立累加，可能不同步） |
| `practiceAttempt`／`practiceWin` | `api_req_practice/battle`／`api_req_practice/battle_result` | 見下方「未驗證」 |
| `battleWin` | `api_req_sortie/battleresult`／`api_req_combined_battle/battleresult` | rank 為 S/A/B 才算 |
| `battleEngage` | 同上 | 不論勝敗，結算觸發即算（例：任務210「10回邀撃」——是「戰鬥發生次數」不是「出擊次數」，兩者不等價：一次出擊可能打好幾場戰鬥） |
| `shipScrap` | `api_req_kaisou/destroyship` | 逐艘計數，非逐次請求計數（`api_ship_id` 可逗號分隔一次解體多艘） |
| `gearScrap` | `api_req_kaisou/destroyitem2` | 逐個計數，非逐次請求計數（`api_slotitem_ids` 同上可逗號分隔） |

**出擊／工廠／改裝類任務內文常常沒有數字，或用「隻」而非「回」**（2026-07-23 clone
KC3Kai／KanColle-YPS／ElectronicObserver 三個社群工具原始碼＋比對 zh.kcwiki.cn／
wikiwiki.jp 的「定期任務列表」全表後確認）：例如任務 256「潜水艦隊出撃せよ」target=3，
內文「潜水艦戦力を中核とした艦隊で中部海域哨戒線へ反復出撃、敵戦力を漸減せよ！」沒有一個
數字，3 純粹是社群資料探勘才知道的外部知識；任務 605「新装備「開発」指令」內文同樣無數字
（目標次數=1 是隱含的）。且多數出擊任務還帶**艦隊組成／海域限制／敵艦種擊沉數**等複合條件
（例：任務 928「歴戦「第十方面艦隊」」要求特定 4 艦其中 2 艦以上、且要在 3 個指定海域各
出撃 2 次）。三個工具的做法本質相同：逐一 hardcode 任務 id → 目標次數／判定條件——KC3Kai
最簡單（`quests_meta.json` 純資料表 + 封包 handler 直接 `increment()`，不驗證組成/海域是否
真的符合）；KanColle-YPS（`devtools.js`）會驗證海域/boss/rank（`is_current_sortie_map()`）
甚至按敵艦種細分擊沈數（`$e_lost_ship_type_count`）；ElectronicObserver 最徹底，
`ProgressSpecialBattle` 連指名艦娘（`NameReading`）、艦型、旗艦位置、多階段活動量表索引都
逐一驗證，是社群十年來累積的規則庫，不是通用演算法。單純「出撃次數」計數器套用到這些複合
條件任務會嚴重高估（把不符合條件的出撃也算進去），故本專案**只收錄完全無條件、或條件本身
已能用現有追蹤欄位（海域/boss/rank/遠征任務id）驗證的任務**（`quest-progress.ts`
`QUEST_ID_OVERRIDES`）——**指名艦娘/艦型編成比對、敵艦種擊沉數計數**這兩類需要全新偵測
機制，仍暫緩（見下方第二輪擴充後段）：

| id | 任務 | kind／target | id↔title 驗證 |
|---|---|---|---|
| 201 | 敵艦隊を撃破せよ！ | `battleWin` / 1 | 本專案真實封包（`samples/Quest.json`） |
| 216 | 敵艦隊主力を撃滅せよ！ | `battleEngage` / 1 | 五方社群來源交叉比對 |
| 210 | 敵艦隊を10回邀撃せよ！ | `battleEngage` / 10 | 五方社群來源交叉比對（見下方順序陷阱） |
| 605 | 新装備「開発」指令 | `development` / 1 | 本專案真實封包 |
| 606 | 新造艦「建造」指令 | `build` / 1 | 五方社群來源交叉比對 |
| 608 | 艦娘「建造」艦隊強化！ | `build` / 3 | 五方社群來源交叉比對（內文「3隻」非「3回」） |
| 609 | 軍縮条約対応！ | `shipScrap` / 2 | 五方社群來源交叉比對（內文「2隻」＋「解体」） |
| 613 | 資源の再利用 | `gearScrap` / 24 | 五方社群來源交叉比對（內文無數字，24 為外部知識） |
| 619 | 装備の改修強化 | `remodelAttempt` / 1 | 五方社群來源交叉比對（「失敗も可」） |
| 1166 | 続：装備の改修強化 | `remodel` / 1 | 五方社群來源交叉比對 |
| 1167 | 装備の改修集中強化 | `remodel` / 3 | 五方社群來源交叉比對（內文用漢字數字「三回」非阿拉伯數字） |

「五方社群來源交叉比對」＝KC3Kai／KanColle-YPS／ElectronicObserver 三個工具原始碼＋
zh.kcwiki.cn／wikiwiki.jp 兩個 wiki 的「定期任務列表」皆一致，但**不是本專案自己驗證過的
真實封包**——任務 id 在遊戲十餘年間從未變更語意，交叉比對一致度視為足夠可信，仍在程式碼
註解裡如實標明每一筆的驗證方式，不混淆兩種可信度。

**id 白名單優先於文字解析**（`resolveQuestGoal(no, title, detail)`）：任務 210 的內文
「敵艦隊を10回邀撃せよ！艦隊全力出撃！遊弋する敵艦隊を10回邀撃せよ！」剛好同時含「10回」
與「出撃」，若文字解析先跑會誤判成 `{kind:'sortie', target:10}`（把「10次戰鬥」跟「10次
出擊」搞混，兩者不等價：同一次出擊可能打好幾場戰鬥）。故改為 id 白名單優先，查不到才退回
文字解析，`tests/quest-progress.test.ts` 有專門測資鎖住這個陷阱。

**條件式任務支援**：目前白名單支援海域／boss／rank 條件與特定遠征任務 id 條件；指名艦娘／
艦型編成比對及敵艦種擊沉計數需要目前追蹤資料以外的偵測欄位，故不由現有計數器推算：

| id | 任務 | kind／target | 過濾條件 | id↔title 驗證 |
|---|---|---|---|---|
| 226 | 南西諸島海域の制海権を握れ！ | `battleWin` / 5 | area:2-1~2-5、boss、rank≥B | 五方社群來源交叉比對 |
| 229 | 敵東方艦隊を撃滅せよ！ | `battleWin` / 12 | area:4-1~4-5、boss、rank≥B | 五方社群來源交叉比對 |
| 241 | 敵北方艦隊主力を撃滅せよ！ | `battleWin` / 5 | area:3-3~3-5、boss、rank≥B | 五方社群來源交叉比對 |
| 242 | 敵東方中枢艦隊を撃破せよ！ | `battleWin` / 1 | area:4-4、boss、rank≥B | 五方社群來源交叉比對 |
| 243 | 南方海域珊瑚諸島沖の制空権を握れ！ | `battleWin` / 2 | area:5-2、boss、rank=S | 五方社群來源交叉比對 |
| 261 | 海上輸送路の安全確保に努めよ！ | `battleWin` / 3 | area:1-5、boss、rank≥A | 五方社群來源交叉比對 |
| 265 | 海上護衛強化月間 | `battleWin` / 10 | area:1-5、boss、rank≥A | 五方社群來源交叉比對 |
| 410 | 南方への輸送作戦を成功させよ！ | `expedition` / 1 | missionId∈{37,38}（東京急行系） | **本專案真實封包**（`api_mst_mission`） |
| 411 | 南方への鼠輸送を継続実施せよ! | `expedition` / 7 | missionId∈{37,38}（東京急行系） | **本專案真實封包**（`api_mst_mission`） |
| 424 | 輸送船団護衛を強化せよ！ | `expedition` / 4 | missionId=5（海上護衛任務） | **本專案真實封包**（`api_mst_mission`） |

area 用既有的 mapKey 慣例（`mapArea*10+mapNo`）；boss 沿用既有的 `color===5` 判定（與
`EventProjector.archiveSortie` 同一條件）；rank 門檻用 `quest-progress.ts` 的 `meetsRank()`
（S>A>B>C>D 排序，未知/缺席一律視為不達標）。missionId 查表沿用既有的 `lastMissionByDeck`
（`EventProjector.archiveExpedition` 也是靠這張表取得遠征任務 id，兩處共用同一組已驗證欄位）。
**mission id↔任務名稱已由本專案真實封包驗證**（`samples/start2-master.json` 的
`api_mst_mission`：id 5=「海上護衛任務」、37=「東京急行」、38=「東京急行(弐)」，`api_name`
逐字相符），比其餘出擊類白名單單靠「五方社群交叉比對」更進一步。

**其餘帶複合條件的出擊/工廠/改裝任務只記錄不實作**（`quest-progress.ts`
`QUEST_SPECIAL_CONDITIONS`，日/週/月共約 20 筆，reason 分五類：編成／編成+海域／敵艦種擊沉／
資材整備／演習+編成／多階段——「海域」與「遠征ID」兩類已隨第二輪擴充移出此表）——UI 遇到
這些 id 仍回退顯示受注中／達成，純粹供日後查閱要擴充時「這個任務為什麼沒做、卡在哪」不必
重查一次 wiki。**年常任務（55筆，已用 zh.kcwiki.cn 全表核對）全數屬於編成或編成+海域的複合
條件**（幾乎都是指名艦娘＋特定海域組合），無一是純「海域」或純「遠征ID」，故第二輪擴充未
涵蓋任何一筆年常任務，仍不逐條收錄於程式碼，需要時查 zh.kcwiki.cn／wikiwiki.jp「定期任務
列表」年常任務章節。

**尚未做、風險/工程量遞增的兩類**（皆需要全新偵測機制，非接現有欄位）：
1. **敵艦種擊沉數**（211/218/212/230/220/213/221/228，8筆）：需要從戰鬥封包判斷「這場
   沉了敵方哪些艦、各是什麼艦種」，本專案完全沒有這段邏輯，得新建一個子系統，但建好後
   這批任務一次全部受惠。
2. **指名艦娘/艦型編成比對**（日週月約6筆＋年常55筆）：需要比照 EO 的 `ProgressSpecialBattle`
   寫一套「目前出擊艦隊 vs 任務要求編成」比對引擎（艦名/艦種/艦型/旗艦位置），是目前為止
   最大量體的一塊。

比照 KC3Kai 用 `api_progress_flag` 回頭校正低估值的做法（發現本地計數落後遊戲自己的粗略
進度提示時往上調）本專案也尚未導入——那不處理複合條件是否真的符合，只是校正泛用計數器，
與本專案「寧可少算不猜」的立場有取捨上的張力，故先不做。

**演習結果端點**：`api_req_practice/battle_result` 已有真封包樣本（`samples/practice-battle-result.json`，
2026-09-29 使用者提供），證實端點名稱與 `api_win_rank` 欄位，且沒有任何海域欄位。評價字串與出擊
`battleresult` 共用，S/A/B＝勝利沿用出擊端已驗證的判定。**回應的 `api_ship_id` 是對手艦隊**（使用者確認），
不可當成我方編成；演習艦隊改取演習戰鬥封包的 `api_deck_id`（缺席時用請求的 `api_deck_id`）。
算錯的後果僅限於任務進度，**不影響戰鬥預測主邏輯**。

**進度只在「本機第一次看到該任務編號」時初始化，之後的 questlist 封包不會洗回 0**；任務從
清單消失（達成領取 `clearitemget`、放棄 `stop`，或單純不在受注中/達成清單裡）即刪除追蹤，
下次若同編號的任務重新出現（例如每日/每週任務隔天重置後再次接受）會重新從 0 起算——這與
「日期重置＝新的一輪」的直覺一致。

### 任務判定與可信度（`utils/quest-tracking.ts`、`utils/quest-goals.ts`，2026-09-29）

**前提**：伺服器是任務是否完成的唯一依據。`questlist` 只給 `api_state` 與
`api_progress_flag`，本機判定因此只是「待伺服器確認的假設」。面板與總括如實標出把握程度，
不把推算寫成事實。

**四級可信度**（`questTier()`）：
- `verified`：有條件定義（條件表或 `quest-progress.ts` 的目標），且本機計數曾在伺服器回報非零進度或達成時一致。
- `unchecked`：有條件定義，尚無可比對的伺服器結果；或最近一次比對為本機多算（顯示「需重核」）。
- `text`：沒有條件定義，只從官方說明文字抽出必要條件（`extractTextRule()`），符合者只算「候選」。
- `server`：兩者皆無，只顯示伺服器回報。

**條件表**（`utils/quest-goal-data.ts`，由 `tools/quest-goal/generate.py` 從 poi 固定 commit 的
`questgoal.json` 產生，產生物勿手改）：
- 收錄 425 個任務。支援出擊（`sally`、`battle*`、`reach_mapcell`、`sinking`）、演習（`practice`、`practice_win`、`_a`、`_s`）與遠征（`mission_success`）事件：
  - 出擊：273 個全部支援，涵蓋任務目錄 311 個出擊任務中的 273 個，其餘 38 個走文字級。
  - 演習：62 個全部支援。
  - 遠征：43 個全部支援。
  - 工廠、補給入渠、近代化改修類事件尚未支援。
- 遠征以名稱篩選；產生器依 `samples/start2-master.json` 的 `api_mst_mission` 把名稱換成遠征 id（`missionId`，39 個名稱全部唯一對上）。對不上的保留原欄位，任務自動標為不支援。
- 演習艦隊取自演習戰鬥封包的 `api_deck_id`。解不出時，帶編成條件的演習子目標判為 `fleetUnknown`，不當成符合。
- 出擊艦隊在 `map/start` 記下。戰鬥封包明示的 `api_deck_id` 與出擊時不同、或沒有出擊資訊時，本次出擊剩下的判定一律視為艦隊不可考：帶編成條件（旗艦、僚艦、艦種、艦數、禁止艦種）的子目標判為 `fleetUnknown`，不帶的照常計入。下一次 `map/start` 重新記錄。
- 語意（`utils/quest-goals.ts` 自行實作）：
  - 艦娘 id 表示「此改造階段以後」。艦隊中的艦以 `GameState.shipCountsAs()`（自身＋`remodelPrev`／`upgradeOriginal` 走訪到的所有前身）比對，所以涼波改二 1034 也涵蓋涼波改二補 745。
  - 僚艦條目 `[ids, 數量, 排除旗艦?]` 預設把旗艦算進數量。`escortshipId` 的條目 OR，`escortshipIdAll`、`escortshiptype`、`escortshipclass` 的條目 AND。
  - `mapcell` 是進入節點的 edge 編號（不經字母查表），`maparea` 是 area*10+no。
- 認不得的事件或篩選欄位會讓整個任務標為不支援，不默默放寬條件。
- 條件表收錄、但事件尚未支援的任務（工廠、補給入渠、近代化改修）：
  - 單一子目標且不帶篩選時，才沿用舊的動作計數（`simpleGoalFromDef()`）。
  - 其餘不用文字推算次數，只顯示伺服器回報，避免編成或評價限定的演習被當成一般勝利而多算。
- `resetInterval: 1`（「本日中」）的子目標在 05:00 JST 換日後歸回初值。
- 擊沉只算結算後 HP 為 0 的敵輕空母、正規空母、潛水艦、補給艦（`battleInfo.enemyIds` 與 `resultFleets` 同序）。
- 沒有出擊資訊（map/start 已被裁剪）的結算：不限海域的子目標照常計入，限定海域或王點的不計。

**文字級**（`extractTextRule()`）：
- 海域先比對 start2 的單一海域名稱（長名稱優先），再比對大區名稱：鎮守府海域 1-X、南西諸島海域 2-X、北方海域 3-X、西方海域 4-X、南方海域 5-X、中部海域 6-X、南西海域 7-X。
- 旗艦只認「「艦名」旗艦」且與 master 完全相同的艦名。

**本機條件**（`utils/quest-goal-local.ts`）：
- 新活動任務在來源更新前先自行撰寫，或修正來源條件。格式同條件表，每筆記錄撰寫時對照的日文標題、依據（任務說明原文、wikiwiki 任務頁日期、start2 艦名）與日期。
- 套用順序（`questGoalFor()`）：
  1. 本機條件，且標題與即時標題相同；目錄未收錄的新活動任務也能用。
  2. 即時標題與目錄不同：不套用舊條件。
  3. 來源條件表。
- 來源收錄後以 `tools/quest-goal/compare.ts` 比對（`--latest` 抓來源最新版）。比對邏輯在 `utils/quest-goal-compare.ts`：依事件、海域、節點排序子目標後逐欄比較，不比標籤，陣列順序不同不算差異。
  - 一致：刪掉本機那筆。
  - 有差異：查證後決定採用哪一邊。
- 目前只有 1047 一筆範例，用來驗證流程，與來源一致。

**重用編號的防護**（`utils/quest-identity.ts`）：
- 期間限定任務（南瓜、秋刀魚、季節任務）每年內容不同，但營運會重用舊的任務編號。目錄、譯文、獎勵、條件表與 `QUEST_ID_OVERRIDES` 都以編號對應。
- 比對方式：遊戲即時送來的 `api_title` 和目錄日文標題比對。比對前做 NFKC，並去掉空白、括號與「！？」，以吸收同一任務的寫法差異；`samples/Quest.json` 61 個任務全部對上。
- 標題不同（`mismatch`）時視為新任務：
  - 不套用條件表與人工目標，只剩文字推算。
  - panel 與總括改顯示遊戲原文，獎勵標為尚未收錄，並加一行說明。
  - 已觀測的身分差異在任務離開清單後仍保留於 GameState。總括停用舊開放關係、人工裁決與解鎖路線；來源條件涉及重用編號的其他任務也維持不可考，避免刪除前置後誤推論已解鎖。
- 已結束的期間限定任務仍保留在目錄裡，用來辨認重用。
- 條件表固定 commit，不像來源那樣線上更新：新活動開始、來源補上條件後，需手動改 `POI_COMMIT` 重跑產生器。2026 年南瓜活動於 10/14 維護後開始。

**伺服器對照**（`serverBounds()`／`compareWithServer()`）：
- `api_progress_flag` 的 0 與 1 已見於 `samples/Quest.json`（例：404 受注中 flag 1），2 未見於樣本。
- 1／2 只當 50%／80% 的推算下限，不當精確次數。
- 本機少於下限：顯示推算範圍（可能有追蹤前進度或未觀測的戰鬥）。
- 本機已滿但伺服器未達成：一律視為多算，需重核。
- 多海域目標的百分比算法未經封包驗證，只有單一目標的任務才用 flag 上限判定多算。
- `api_basic.api_st_win` 等戰績累計欄位的語意尚未以樣本驗證，未用於斷檔偵測。

**保存範圍**：判定紀錄（`GameState.questTracking`）與 `questProgress` 一樣，只由保留的 raw events 重建，
不新增 DB 表、不改資料格式；raw event 裁剪後，較早的紀錄會隨之消失。每個任務最多保留 100 筆判定、
30 筆伺服器回報；重複的 questlist 只在回報或本機計數變化時才記錄。「開始追蹤」時間是本機第一次在清單
看到該任務的時間，不是受注時間。

**介面**：
- 面板任務列只放進度（計數、推算範圍、需重核、候選數或伺服器回報）；可信度標記與說明在進度分頁第一行。展開後「說明／原文／進度」三選一，日文介面沒有原文分頁；只剩一個分頁時不顯示切換鈕。
- 進度分頁最多四行：伺服器對照、逐子目標進度（短標籤；需要超過 4 次的顯示數字）、上一戰（含年月日）、「詳細紀錄 ›」。
- 「詳細紀錄 ›」指向 `overview.html#/quest-flow?no=<api_no>&tab=progress`：已有情報總括分頁時改寫它的 hash 並切過去（`utils/open-overview.ts`），沒有才另開。任務導覽收到深連結時先重讀 GameState，已開著的舊分頁也看得到最新進度。
- 情報總括任務導覽的「進度紀錄」分頁有四塊：概況、條件核對（對照目前第一艦隊）、逐場判定、伺服器對照。
- 逐場判定的時間連到 `#/sortie-log?ts=<結算時間>`，出擊紀錄解除篩選、翻到該場所在頁並展開。深連結參數套用後即從網址移除。
- 任務導覽頂端固定顯示免責說明 `ov.qfDisclaimer`，不可摺疊。
- 可見文案不寫任何資料來源名稱或「社群」字樣。

**離線核對**：`tools/preview/quest-tracking-panel.ts`（linkedom 跑正式 `mountGeneral()`）與
`tools/preview/quest-tracking-overview.ts`（正式 `questFlowDetailHtml()`）共用
`tools/preview/quest-tracking-fixture.ts` 的示意情境，輸出繁中／英文／日文。

### 任務導覽的單發完成推論（`utils/quest-flow.ts`，2026-09-08）

遊戲不會把已領獎的單發任務再放進 `questlist`，本機也沒有十年歷史。總括因此只在兩種
**可從目前封包證明**的情況下，把單發任務標成「關聯推論完成」，且不與 `clearitemget`
的「本機觀測完成」混用：

1. **前置鏈**：目前受注／可接受，或最近一次 tab 0（全て）／tab 4（単発）完整清單裡
   看得到的任務，若前置關係 `operator === 'all'`，沿該鏈把已知前置標成推論完成。
2. **缺席繼流**：已觀測到 tab 0 或 tab 4 之後，對「若尚未完成就應該出現」的常設單發
   做固定點反推：無已知前置、或列出的前置依 all／any／（unknown／conflict 時需全部
   完成）已滿足，且該 `api_no` 不在完整清單裡。期間限定、未解析非任務條件、以及
   條件組合仍不可考且前置未全部完成的任務維持不可考。

前置關係逐條判斷（2026-09-28）：`tools/quest-graph/generate.py` 產生兩份資料。
- **wikiwiki**：解析現行總表「開放条件」，取代目錄裡同源的舊 wiki 欄（不另計來源，避免同一份
  wiki 重複計票）；總表尚未收錄的任務才沿用目錄。wiki 代號對 `api_no` 必須任務名稱相符，目錄
  別名錯誤（例：B205 掛在 1018）不沿用。「及び」子句為 AND、「または」子句內為 OR。
- **ぜかまし**：解析各任務攻略的「前提に…あり。後続に…あり。」（`zekamashi.py`），前提與後續兩個
  方向合併為獨立來源 `zekamashi`；清單視為全部需要（AND）。文章第一組屬於文章本身的任務（以其他
  文章連入時的名稱、再以標題中最長的任務名對應），後面的組只在小標題寫出任務名時採用。同名多筆
  （機種転換等）只在其他來源恰好列了其中一個時消歧，否則不對應；「（関連）」等泛稱連結與句尾沒有
  「あり／なし／不明」的清單不算前提敘述。對不上的段落寫在 `.cache/zekamashi-unmapped.json`，
  多為目錄未收錄的往年期間限定任務。

- **quest-planner**：poi-plugin-quest-planner 固定 commit 的前置，是 kcQuests 的新版整理，和目錄的
  poi 前置同源，所以取代舊版而不另計來源；期間限定前置有 `questId` 時照常計入，只有代號時列為
  未解析。

- **tsukinohashi**：艦これ単発任務マネージャ的單發任務樹（連線＋說明開頭紅字前置）。樹狀圖多只畫
  一條主線、常少列，所以只在其他來源衝突時加入投票，不改變沒有衝突的任務。
- **舰娘百科**：任務總表「前置」欄（只抓一頁，Crawl-delay 100）。poi／kcQuests 由此站抽出，與目錄
  舊 poi 前置 648 筆中 642 筆相同，所以計票時與 poi（quest-planner）合為一票、取聯集，避免同一份
  資料的兩個副本湊成共識；顯示時仍分別引用。它逐條標「待验证」，明確列出的前置可解除 wiki 的
  【検証中】。同一任務多列時以現行代號那列為準（單發改年任的 F114→Fy10 等，舊代號列是改制前前置）。
- **代號補齊**：目錄有 `api_no` 卻缺 wiki 代號／名稱的任務，由 kc3-translations 日文任務表補上
  （例：1020＝2409B1、450＝2603D1），目錄舊資料中「wiki:2603D1」「poi:2409B1」等未對應字串因此
  轉回前置。
- **週期**：總表依週期分表，任務所在表格的週期只在目錄為 unknown 或與 `api_type`（1 日、2 週、
  3 月、4 單發）一致時覆寫目錄（例：D27 目錄誤記 daily）；與 `api_type` 矛盾時（B135 等）保留目錄。

合併規則：各來源取聯集，每條前置記錄支持來源與待驗證旗標。wiki 與ぜかまし都有逐條註記，只要
其中一方明確列出就解除另一方的待驗證；「他／他不明」的缺口由另一來源補上額外前置才視為已補。
某來源少列或沒列只代表沒提到：沒有任何一個來源列出全部前置的聯集才算 conflict。wiki 與ぜかまし
都有列且彼此一致（一方涵蓋另一方）時由兩者裁決，只有 KC3／poi 多列的前置標 `disputed`（視同
待驗證），不成為 conflict。2026-09-28 資料：conflict 356 → 20（多數共識後 4）、ぜかまし解除 wiki【検証中】122 條；
剩下的多為 wiki 與ぜかまし本身不一致，或ぜかまし沒有資料的舊任務。
這些真正衝突的任務改用多數共識：至少兩個來源（含 tsukinohashi）列出的前置為主要前置，只有單一
來源提出的列為 `remarks`（備考，UI 提示「主要前置都完成仍刷不出時再試」）；沒有任何前置達到兩個
來源才維持 conflict（2026-09-28：20 → 4；加入舰娘百科與代號補齊後為 6，見下）。只在真正衝突時套用，某來源少列的任務不會因此被降級。
人工裁決（`utils/quest-graph-reviewed.ts`，由人維護、非產生物）優先於自動合併：逐項核對來源後定案
主要前置與備考，每筆註明依據與核對日期，UI 標「人工核對（日期）」；可信度仍依來源計票，不因裁決升級。
裁決可標 `undetermined`（前置未定，候選全列備考，可信度檢證中）、`incomplete`（已知前置外可能另有
條件，組合不可考）與 `phases`（營運中途更新觸發條件，依日本時間日期取分段；`questRelation(def, nowTs)`
與 `buildQuestFlow` 的 nowTs 一致）。2026-09-28 裁決：C56 ← B14＋C31；Fy10 前置未定（Gy2／Gy3／B107／F73
候選，ぜかまし現行頁與舰娘百科兩列彼此不一）；C33 ← Cq1（incomplete，B9 是 Cq1 的前置）；Bq9 ← Cd1
（incomplete）；2412B7 ← 361＋1121（推定年末任務沿用 api_no）；2603D1 於 2026-04-07 維護由 2603G3
改為 2604B1。依據逐筆寫在裁決表註解；使用者提供、快取無法查證的證據標「依使用者調查」。
至此自動合併剩下的 conflict 全數經裁決處理（2026-09-28：0 筆）。
組合以
wiki 句型為骨架、ぜかまし多列的前置加為 AND 子句，涵蓋所有來源的前置時才據以決定 all／any，
否則不可考。推論上，玩家看得到的任務（受注中、可接受、完整清單）其單發前置必定已完成：沿主要前置往回標，
不限 all 組合，但不經過待驗證／有爭議的前置、「任一即可」子句裡的前置，以及只有 KC3／poi
單一來源的前置。定期前置只證明曾完成，不標成推論完成（維持本週期未完成、持續觀測），但仍沿
它往上找單發前置。任務未出現時，主要前置中本週期尚未觀測完成的定期任務列為 `periodicBlockerNos`，
UI 提示「本週期先完成」。有待驗證前置或備考的單發不做缺席推論。

tab 9（遂行中）只同步受注中／達成，不得清掉 tab 0 看到的可接受任務，也不得當作完整
單發清單。尚未看過 tab 0／4 時不做缺席推論，只做第 1 項前置鏈。釘選與人工完成存
`localStorage`（`kc-overview-quest-flow`），並隨完整備份的 `questFlow` 往返；搜尋／
聚焦等暫時 UI 不進備份。舊備份沒有此欄時，還原不得清空本機既有釘選。本機觀測完成
（`clearitemget`）另存 `db.questObserved` 並進備份：日／週／月以日本時間 05:00 為界，
季任以 3／6／9／12 月 1 日 05:00 為界；年任保存紀錄但不對齊年度週期（開始月尚未進目錄）。

**任務清單觀測（`db.questSeen`，schema v14，2026-09-28）**：任務出現在清單＝它的單發前置
必定已完成，且單發完成後不會變回未完成，所以「曾經看過」是永久證據。raw questlist 只保留
最近 10 筆、備份也不帶 events，只靠 raw 推論的話，任務做完離開清單又被裁剪、或重裝還原後，
推論就消失、只能重開清單或逐項手動標記。background 對每筆 questlist 把 api_state 1–3 的
任務寫進 `questSeen`（`utils/quest-seen.ts`），v14 升級只從仍保留的 raw 回填。`buildQuestFlow`
把這些任務與目前清單一起當前置鏈起點；任務本身不因「看過」算完成。期間限定任務可能沿用
api_no 換成不同前置，舊觀測不當起點。缺席推論（tab 0／4）仍只看最近一次完整清單。

**右欄呈現（2026-09-28）**：前置鏈深度中位數 9、最深 26 層，上游最多 86 項，且大量共用上游。
巢狀樹逐分支重複列出共用任務、只能展開有限層數，因此右欄改為選中任務標頭＋四個分頁：
- **解鎖路線**（`questUnlockPlan()`）：上游 DAG 去重後依拓撲序攤平。已完成（`isCompletedQuestRow`）
  的前置收進摺疊區；仍需完成的依「第 N 步」分組：第 1 步是自己的前置都已完成的任務，其餘取
  每個未滿足群組最短選項＋1 的最大值。群組來自 `questRequirementGroups()`：wiki 子句恰好涵蓋主要
  前置時沿用 AND-of-OR，operator=any 為單一群組，其餘逐條 AND。任一群組已有一項完成時，其他
  替代前置不列入仍需完成。「不可考」一律當未完成，UI 提示可用人工完成或開任務清單推論。
  目前出現在任務清單（可接受／進行中／達成待領取）的目標或上游視為已開放：它的前置此刻已滿足，
  列在第 1 步、不再往上展開。定期任務本週期沒有完成紀錄也不會被要求重做（例：By6 可接受時，
  By8 的路線只剩 By6，不列 Gy2／Gy1）。被涵蓋的上游歸入「已滿足」摺疊區，以虛線、無刪除線與
  已完成區分；「本週期先完成」指引不重複列出已在步驟中的任務。只認**目前**看得到的任務：
  曾經出現過的定期任務不能證明本週期仍開放（同一週期內完成的條件每期要重做），不據以略過。
- **關係圖**（`utils/quest-graph-layout.ts`）：同一份上游畫成分層節點圖，層＝最長前置路徑，
  重心法上下交替排序減少交叉；預設只畫未完成的上游，可切換顯示已完成。
- **完成後開放**（`questDownstreamLayers()`）：直接開放的任務逐項列出並附各自的「需要」，
  更下游依距離收合。
- **資料來源**：前置關係、可信度、阻擋、本機進度與觀測。

目前分頁與「顯示已完成」存在同一個 localStorage 鍵，不進備份；還原只覆寫釘選／人工完成。

### 活動作戰板：關卡與出擊標籤（`utils/event-plan.ts`＋`sections/event-ops.ts`，2026-07-21）

**機制前提（使用者提供，決定整個資料模型的形狀，別照紙本表格照抄）**：

1. **標籤是船身上的屬性，不是編成的容器**。一艘船同時只能有一個標籤，貼上不可逆。
2. **貼標時機是出擊，由「關卡＋路線」決定**——提督事前怎麼安排都會被蓋掉，
   **只能以出擊實際貼上的為最終標準**。故 `api_sally_area` 是唯一權威，計畫只是意圖標註。
3. **關卡按標籤限制路線**：特定標籤組合才能走特定路線（`allowedTags`）。
4. **帶無標籤船出擊，該船會被貼上「該關卡會給的標籤」**（`grantsTag`）——與 `allowedTags`
   是**兩件不同的事**：某圖可能允許 A 標籤的船進入，但無標籤船走某路線會被貼上 B 標籤。
5. **標籤 id 全活動唯一、只增不減**；後段沿用前段的船時標籤 id 繼續沿用 → 一次活動一份計畫
   （`db.eventPlans` 主鍵 `areaId`），前後段不分檔。

**三層結構**：Layer 1 標籤總帳（從 `api_sally_area` 即時分群，**零輸入且權威**；使用者只需替標籤
取名）→ Layer 2 計畫（手輸：標籤名、`allowedTags`／`grantsTag`、編成）→ Layer 3 檢查（純函式）。
使用者的紙本表格裡「編成」那一欄其實就是標籤的成員名單，**會自己填滿**，不需重抄。

**歷史標籤快照**：選定活動仍存在於目前 master、且目前名冊有非零 `api_sally_area` 時，overview 載入會
以變更過的非零名冊更新 `EventPlanRow.sallySnapshot`；即時名冊無有效標籤時不覆寫。顯示一律優先使用
即時 `api_sally_area`。master 尚未載入才回退快照。master 已載入但該 area 已不在海域清單＝本次活動
結束：刪除該筆 `eventPlans`，不讀快照、不沿用標籤分類。快照只保存艦實例 id→標籤 id。

**燈號語意（⬜ 的意義與直覺相反）**：`ok`＝已持有本關允許的標籤；`blocked`＝
持有別的標籤、**這隊走不了這條路線**；`willStamp`＝**無標籤船不是「安全可調度」而是「即將被
不可逆消耗」**，出擊後就會被貼上 `grantsTag`。`allowedTags` 未填時一律 `unknown`，
**不可判紅**——使用者還沒填就滿江紅會讓整張表失去訊號價值。

**計畫矛盾**是出擊前唯一擋得住的錯誤：同一**無標籤**艦被排進多個關卡，先跑哪個會決定它從此
進不了另一個。`certain`（用 `grantsTag` 推定必衝突）與 `possible`（允許標籤有交集、無從得知
會蓋上哪個）分級。已持有標籤的艦重複出現不算矛盾（它的標籤已定，各關卡各自判 ok/blocked）。

**已驗證**：`api_sally_area` 欄位名與位置已用真封包確認（`samples/slot_to_port.json`，
每艘 `api_ship` 末三欄為 `api_locked`／`api_locked_equip`／`api_sally_area`）；純函式以 node
餵情境跑過 29 項（分群／三燈號／未填不判紅／矛盾三態／預算去重／空輸入）。
`api_port/port` 的 reducer 本來就 `ships.clear()` 後全量重建，**故 Layer 1 零攔截改動、
零新權限**；標籤只能經出擊取得而出擊必以回港收尾，port 必發 → 自我修復，不需監聽 ship2/ship3。

**未驗證（別當成已知）**：標籤 id 的實際語意（所有樣本取自非活動期，值全為 0）；
**標籤名是否存在於任何封包**——start2 的 master 表清單沒有標籤表，上次活動的出擊紀錄
（`samples/61-5-jibun-rengou-node52.json`）遞迴掃過 189 個 key 零命中，但該檔只含戰鬥封包、
不含母港類封包，**答不了這題**。第三方工具（KC3Kai／poi）都手維護標籤名表，方向一致。
故 `PlanTag.nameSource` 的 `'auto'` 分支**預留但目前永遠不會被寫入**，UI 一律手動命名。

**標籤名驗證只走 `wantedTag` 的未知 sally key 鉤子**（`findUnknownSallyKey()`）：已知只有
`api_sally_area`／`api_sally_flag`；冒出第三個就是標籤名最可能的所在，上限 3 筆。
深度上限 3、陣列只看首元素——實測掃 1MB＋ start2 僅 0.2ms，且對現有真封包**零誤觸**。
「首見帶標籤的艦娘清單」不再列入擷取——那類封包會重複出現、洗版並永久釘住 raw event。

**順帶的新假設**：`api_sally_flag`（`api_mst_mapinfo` 與 runtime mapinfo 皆有，1-1 為
`[1,0,0]`）待辦原記為「EO 剩餘挑戰次數，語意未解」——依上述機制，它也可能是**該圖的出擊
制限旗標**（允許哪幾個標籤）。下次活動一測便知。

**版面依實際規模配置**：一次活動可有 **12 個標籤、5～7 個關卡**
（使用者實測，非估計）。

- 關卡**一行一關、只有選中的那關展開**，右欄常駐艦娘篩選清單；這樣可控制 5～7 個關卡的
  垂直高度。
- **「現在每個標籤鎖了哪些船」必須常駐可見**：一行一標籤、無卡片外框、成員名字直接攤開，
  讓 12 個標籤仍維持可掃描密度。
- **「帶入第 N 艦隊」不能當主要輸入手段**——玩家不可能為了找船一直切回遊戲畫面確認，
  故降為次要按鈕，主路徑是在右欄篩選清單裡點選。

**「計畫」與「現實」是兩個維度，UI 必須並排顯示、不可只給一半**，否則兩者的差異容易被
誤讀為同步錯誤。把船排進計畫的關卡**不會**讓它被貼上標籤，標籤只有實際出擊才產生，所以
「排了船但標籤總帳仍顯示 0 艘」是正確行為；但只顯示現實那半邊，排進去的船就像人間蒸發。定案：

- **標籤總帳每列並排兩欄**：「實際」＝`api_sally_area` 已貼標（權威，一般色）／「計畫」＝
  `plannedByTag()`（用 willStamp 的橘色，與「不可逆消耗」同一語意）。
- **計畫歸屬只認 `grantsTag`**，未填就不猜——多標籤共用的關卡用 `allowedTags` 反推會給錯答案。
- **計畫欄要列出已被實際貼標的艦並標警示**（`PlannedState`：`pending`／`fulfilled`＝已貼上
  此標籤、計畫格冗餘／`conflict`＝已貼上別的標籤、計畫格失效），每個 chip 可就地移除。
  計畫會隨實際出擊逐漸過期，看不到就不知道要清哪一筆。`plannedByTag()` **刻意不去重**
  （同艦排進兩個 grantsTag 不同的關卡要在兩邊都看得到才能刪錯的那格）；計數請用
  `sallyBudget()`，那支有去重。
- 篩選清單同理分成兩個獨立控制項：「出擊標籤」（現實）與「計畫：已排入／尚未排入」（意圖）。
  手動宣告但遊戲裡還不存在的標籤也要列進下拉（顯示 0 艘），否則使用者建了標籤卻找不到。

**實際貼標觀測（`observeGrantedTags()`）**：「出擊結果才是唯一依歸」。資料來源是 raw events
的 `api_port/port`＋`api_req_map/start`（`path` 有索引；出擊海域優先讀 response，缺欄才退
`req`；**不需新表、不動 EventProjector**）。

- **只認 `0 → N`**：出擊前無標籤、回港後帶著 N ⇒ 該圖會貼出 N。`N → M` 不採信。兩次母港
  之間多次出擊時，這條歸因到最後一次並標記 `ambiguous`。
- **已貼標艦再出不改關卡歸屬**。後段船回打前段（或簡易難度無鎖）時，編成裡會帶著共用／
  後段標籤；把它們算進該圖會把 E1 塞滿。KC3Kai／poi 以 `api_sally_area` 直接入箱、不依
  出擊關卡分欄——本板有關卡欄，不能沿用那條。
- **已歸類的標籤在每一個對應關卡底下各出現一次**（`PlanTag.columnMaps` ∪ grants）。
  未歸類才進 SHARED。跨關使用來自「已貼標艦實際出過的圖」，只往編號 ≥ 已歸類最小關
  的方向補，避免後段札回打 E1 被寫進 E1。尚未歸類的札由使用者用欄頭關卡鈕指定。
- **未分類的已貼標**：從海域清單開頭連續已有 grants 的關算已分類；其後若只剩一關，船上
  已有、尚未入欄、且編號高於前段已分類區間的標籤掛到那一關（不寫死某一關、不等 0→N）。
  編號仍落在前段區間的未綁色進 SHARED。後面還有兩關以上時不猜。多關活動第一關只留該關
  0→N（無觀測則只留比後面已分類最小 id 更小的色），誤掛的後段色從第一關清掉。
  某一關已有 grants 時，id ≥ 該關最小 grants 的未出擊色仍補到那一關。
- 涵蓋範圍受 M6 裁剪限制，UI 要講明「尚無觀測」可能是沒出擊過**或紀錄已被裁剪**。

**海域編號結構（使用者說明，已用真封包驗證）**：`mapKey = areaId * 10 + mapNo`，`61-5` 就是
活動 area 61 的第五海域 E5；本次活動 area 62 故 E1＝621。

**海域名稱與活動標題都拿得到，不必只顯示編號**（使用者的完整 start2 實測）：
`api_mst_maparea[62].api_name` ＝**活動標題**「反撃！第三十一戦隊の戦い」；
`api_mst_mapinfo[621..625]` 各帶 `api_name`（海域名，如「九州沖/南西諸島沖」）與
`api_opetext`（作戰名，如「第三十一戦隊駆逐艦の出撃」），本次活動正好五關。
存進 `GameState.masterMapInfo`（`mapsOfArea()` 取用）。

**抓得到 master 時，UI 一律不讓使用者重複輸入遊戲已經回答的事**：

- **關卡列＝遊戲的海域清單，不由使用者建立**。`reconcileStages()` 依 `api_mst_mapinfo` 全數
  列出；沒有「新增關卡」「關卡名稱」「對應海域」三個控制項，來自遊戲的關卡也不可刪。
- **關卡名格式＝`E{n}　作戰名`**（`62-1` 換算成 `E1`）。**不顯示 area 編號**——玩家不需要
  知道 62 是什麼。海域名（`api_name`，地理位置、通常又臭又長）退為副標題，且**只在展開時
  顯示**：摺疊列一關一行的密度是刻意的，多一行副標會讓 7 關變 14 行。
- **活動名不需要自己命名**，直接用 `api_mst_maparea` 的活動標題；只有一個活動時連下拉都
  不畫，直接顯示名稱。
- 對應不上任何海域、但**有內容**的既有關卡列一律保留在末尾，保留使用者填過的資料。

抓不到 master（舊活動、或手動建立的板）才回退到「手填關卡名＋選對應海域」的模式。

**階段子列**（`PlanStage.phase`）：同一張圖的不同階段／路線可以有不同的標籤約束（使用者的
E2 就同時存在兩個標籤），故每張圖的主列底下可再開階段（預設命名 `E4-1`、`E4-2`…，即使用者
原始表格的寫法）。主列＝該圖的預設安排，階段＝各段的個別安排；**兩者都是完整的 PlanStage**，
所以 `checkStage`／`plannedByTag`／`findPlanConflicts` 不必特別處理階段，照舊逐列跑。

`reconcileStages()`（純函式，node 已測）的首要職責是**保留既有資料**：有 mapNo 照 mapNo
對應、沒有的用 `guessMapNo(label)` 反推、同圖第二個主列轉成階段而非丟棄、對應不上但填過
東西的列保留在末尾；只有「對應不上又完全空白」才會消失。maps 為空時原樣返回（手填模式）。**這比 runtime 的
`api_get_member/mapinfo` 更早可用**——start2 登入就送、且在 `db.snapshot` 永久保留，
runtime mapinfo 要玩家開過海域選擇畫面才有。master 已載入時只認目前海域清單裡的活動圖；
master 尚未到才退回 mapGauges／已存計畫，避免 start2 延遲把當次板洗掉。
活動結束後該活動海域會從 master 消失，故 `masterMapInfo` 每次 start2 全量重建（不 merge）。
標籤對應關卡是單次活動限定：該 area 從 master 消失時刪除 `db.eventPlans` 那一筆（標籤、
關卡、觀測、快照），配船板留空等下一檔，不沿用 gauge 或舊計畫。`PlanStage.mapNo` 是關卡列與真實海域的連結——
`label` 是自由文字（「E4-3」「E5 解謎 1」），沒有這個欄位就無從拿實際觀測校對。
**多個關卡列可指向同一 mapNo**（E4-1／E4-2／E4-3 都是 E4 的不同階段）。
`guessMapNo()` 從 label 代填預設值時取 **E 後的第一個數字**（E4-3 → 4，不是 3），且只在
`mapNo` 為 null 時填，永不覆寫使用者已選的值。

**鎖定規則**：標籤一旦「已確立」（`establishedTags()`＝遊戲裡實際已有船帶著它），其名稱與
**牽涉該標籤的關卡**之標籤約束（`allowedTags`／`grantsTag`）即轉為唯讀。理由：實際貼標不可逆，
計畫端再改只會讓兩邊對不上，此時玩家只能依實際標籤填船。僅當次活動進行中可暫時解除
（`EventPlanRow.unlocked`）。活動結束後整份計畫刪除，不是解鎖後繼續改舊檔。鎖定狀態
**由實際資料推導**、不另存旗標，只有解除動作才落地——避免兩份狀態要同步。

**摺疊起來的關卡列也要顯示標籤名稱**（不能只有 `#id`）：收起來就認不出是哪個標籤等於沒收。

**Markdown 匯出**（`buildMarkdown()`）：標籤總帳（實際／計畫兩份名單攤開）＋關卡對應標籤與
編成逐格狀態。取捨同 llm.ts——能先算好的就別留給讀者自己對照。這是給人／LLM 讀的摘要，
**不是備份格式**，備份走 `db.eventPlans` 本體。

**術語**：zh-TW 的 UI 字串、程式註解與本文件一律使用臺灣慣用詞；ja 維持遊戲原文，en 為 tag。
程式識別名（`api_sally_area`、`PlanTag`、
`--sally-*` 等）不動。

### 鎮守府全船篩選（`utils/ship-filter.ts`＋`overview/ship-picker.ts`，2026-07-21）

活動作戰板與艦娘全覽共用。**可裝備篩選的規則已用真實完整 start2 驗證**（使用者提供備份，
master 表已併入 `samples/start2-master.json`，該檔現有 12 張表）：

- **`api_mst_equip_ship` 是「完整覆蓋」不是「追加」**：key＝艦 master id，有條目就以它為準。
  以皐月改二(418)／睦月改二(434)／大潮改二(199) 逐一核對——其類別集合恆為「駆逐艦 stype 的
  17 個預設 ∪ 例外類別」，**從不少於預設**。故 `GameState.equipTypesOf()` 的規則是
  「有例外條目就用它，否則回退 `api_mst_stype[].api_equip_type` 中值為 1 者」。
- **絕不能只看艦種**：`api_mst_stype[2].api_equip_type['24']` 是 **0**（駆逐艦不能裝上陸用舟艇），
  但遊戲裡有 **41 艘驅逐艦**裝得了大發系（皐月改二／睦月改二／大潮改二…）。只看艦種會把
  「大發驅逐」整批誤判成不可裝——而那正是輸送作戰的核心編成。
- 類別 id（`api_mst_slotitem_equiptype` 實測）：**24 上陸用舟艇（大發系）／34 司令部施設／
  45 水上戦闘機／46 特型内火艇**。type 24 的值實測**全部是 null**（整個類別可裝），
  尚無「僅限特定裝備」的實例，故篩選忽略 `null` 與 `[ids]` 的差別。
- **七選項下拉＝兩個布林的組合**，已對全 1751 艦驗算且與獨立的 Python 統計完全一致：
  大發系 96／內火 199／二者皆可 62／僅大發 34／僅內火 137／二者任一 233／皆不可 1518。
- **航速**：`api_ship.api_soku`，427 艘實測分佈 `{10: 300, 5: 127}`＝高速／低速。
  15 高速+／20 最速**未見於樣本**，故篩選一律用「>= 門檻」比較、不列舉數值。
- **「高速戦艦」不是艦種**：`api_mst_stype` 的 8 與 9 都叫「戦艦」，高速/低速要靠 `api_soku`
  合判，故做成航速 × 艦種的組合，不另立艦種。另有使用者清單未列的 **12 超弩級戦艦**。
- **補強增設**：`api_slot_ex` 三態實測 `0`=無孔(289)／`-1`=有孔未裝(137)／`>0`=已裝(1)。
  完整 start2 另有 `api_mst_equip_exslot`／`equip_exslot_ship`／`equip_limit_exslot` 三張表
  （已存進 fixture）。目前已解讀並使用 `api_mst_equip_exslot_ship` 的艦娘／艦種／艦型／等級
  條件；其餘補強增設限制表仍未解讀，不得擴大支援範圍。

### 艦娘全覽（詳細清單）：`utils/ship-roster.ts`＋`sections/ships.ts`（2026-07-22）

版面參照 `samples/kanmusu_filter.png`（KC3Kai 風格的艦娘一覽篩選面板），**條件全數涵蓋但
刻意不照抄版面**：參照圖把二十幾組「全部／是／否」常駐攤開，要捲過半個畫面才看得到第一
艘船。版面採三層——**常駐工具列**（關鍵字／每頁筆數／欄位開關／篩選抽屜開關／匯出）＋
**可收合抽屜**（全部條件）＋**生效條件 chip 列常駐**（只列非預設值、每個可單獨 ×）。
第三層是關鍵：抽屜收起來時仍一眼看得出「現在被什麼篩著」，不必展開整面牆去找那顆亮起來
的選項。參照圖裡「顯示滾動條／提示框／鎖定圖示／分頁 顯示隱藏」這類純顯示開關**不照做**
（交給瀏覽器／直接畫在艦名旁／改成使用者要的 10・20・50・100・全部）。

**排序欄位十九個**（表頭可點，數值欄第一次點由大到小）：ID、図鑑番号、艦種、國籍、艦名、Lv、
士氣、血量、火力、雷裝、對空、裝甲、對潛、迴避、索敵、運、夜戰（＝火力＋雷裝）、
Released（實裝日）、Joined（上任日）。**缺值一律排最後、不論升冪降冪**——「沒有図鑑番号／
日期不可考」是資訊缺席，不是「很小的值」，混進大小比較會讓排序看起來壞掉。
裝備欄用圖示，**一律畫滿該艦的真實槽數、空槽畫虛線空框**（「這格空著」與「沒有這一格」
是兩件事）；補強增設無孔時整格不畫，才分得出「沒開孔」與「開了孔沒裝」。

**同名艦種標籤**在 `utils/stype-label.ts`：stype 8／9 都叫「戰艦」時，篩選 checkbox 以該群
名冊多數航速加註「高速戰艦」，低速側維持「戰艦」；列上用該艦自己的 `api_soku`。id 不能當
航速捷徑（stype 8 有低速 Гангут 線、stype 9 有高速深海戰艦棲姫改）。

**為此擴充的 `OwnedShipView` 欄位皆為封包事實**（真封包／完整 start2 核對，見 state.ts
逐欄註解）：八項顯示素質 `stats`（`api_karyoku` 等的 `[0]`，**已含裝備加成**）與 `statsMax`
（`[1]`）、`kyouka`／`kyoukaMax`、`remodelDone`、`exSlotOpen`、`exSlotSpecials`、`leng`、
`ctype`、`exp`、補給量。**近代化改修上限＝master 的 (最大−初期)**：叢雲改二 420 逐項核對
（houg[14,57] 差 43＝kyouka[0]、raig 差 57、tyku 差 47、souk 差 37，四項全中），故「改修
已滿」是精確判定而非近似。`api_kyouka` 後三格（運／耐久／對潛）**沒有可比對的上限**，
只能判斷「有沒有加過」＝特殊改修。

**補強增設「特殊」類別（`GameState.exSlotSpecialTypes`）**：`api_mst_equip_exslot_ship` 的
**key 是裝備 master id 而非類別 id**（已實證：413＝「精鋭水雷戦隊 司令部」、45＝「三式爆雷
投射機」），值以 `api_ship_ids`／`api_stypes`／`api_ctypes` 三種方式指定對象——**故 master
必須存 `ctype`**，否則艦級條件全部漏判。全艦通用清單 `api_mst_equip_exslot`（實測
[16,21,23,27,28,36,39,43,44]）裡的類別**刻意不列進回傳值**：人人都能放，拿來篩選沒有鑑別度。
已對真實 master 全 862 艘図鑑內艦驗算，UI 的七個選項（副砲 77／小型電探 164／大型電探 33／
爆雷 142／登陸艇 2／司令部 120／強化爐 6）皆非空桶，測試常駐把關。

**素質「不含裝備」是估算，UI 已標示**：裸值＝顯示值減去各裝備 master 的自身加成，但遊戲的
**裝備ボーナス**（特定艦×特定裝備的隱藏加成，例 大和型＋51cm）已計入顯示值卻不在裝備資料
裡，相減後會偏高。不要把它當精確值使用。

**先制對潛是推算值**（`isOpeningAsw`）——遊戲**不送這個旗標**，依 wikiwiki 機制
頁轉寫：海防艦（聲納＋對潛 60／對潛裝備＋對潛 75）、輕空母（對潛 65＋對潛攻擊可能機）、
例外艦（不需聲納、對潛 100）、其餘（聲納＋對潛 100）。例外艦**以艦級 ctype 表達**
（Fletcher級 91／John C.Butler級 87，已用真實 master 核對），只有單艦的才列 master id——
列舉每個改造形態的 id 會隨改版腐爛。規則會變，UI 的提示文字必須保留「推算／參考」字樣。
對照之下**開幕雷擊是事實**：裝備了特殊潜航艇（類別 22）即成立。

**國籍（建造國）＝人工參照表，鍵是艦型 ctype**（`utils/ship-nationality.ts`）。遊戲 API
不提供國籍，同「兩個日期」的處境。以 ctype 為鍵而非逐艦：國籍是艦型層級屬性，一個艦型一筆、
新增改造形態不必回來補（逐艦列舉必然腐爛）。**未列出的 ctype 一律日本**——862 艘図鑑內艦分屬
140 個 ctype，其中只有 58 個是外國艦型，逐一列出 82 個日本艦型只會更難維護。

**「建造國」而非「最後的所屬國」——這條看起來像 bug，是刻意的**：遊戲收錄了數個戰後移交
他國並改名的形態，它們沿用本體 ctype。已用真實 master 逐一確認：Верный＝響改二（暁型）→
**日本**；General Belgrano＝Phoenix 的移交形態（Brooklyn級）→ **美國**；Leonardo da Vinci
＝**Dace 的移交形態**（Gato級，改造鏈 Dace → Dace改 → Leonardo da Vinci，yomi 仍是
「デイス」）→ **美國**。反方向同理：伊504（ex Luigi Torelli）／伊503（ex C.Cappellini）
歸**義大利**。這條規則讓表自洽、零逐艦例外——**不要**為了個別艦名「看起來像哪一國」加覆蓋，
那會讓同一艦型的不同形態分屬不同國，篩選結果變得無法解釋。`ctype` 為 0（master 未載入）
時回傳 null＝不可考，**不可當成日本**。收錄國家共 12：日美英德義法蘇荷澳瑞挪泰（**沒有丹麥**，
遊戲目前無丹麥艦）；篩選晶片只列名冊裡實際有船的國家，不做空選項。

**測試**：`tests/ship-nationality.test.ts` 掃全 master 反向驗證——凡艦名含拉丁／西里爾字母者
都必須有國籍歸屬（不得預設落回日本），且歸為外國的艦型裡不得混進日文艦名（已知的移交形態
除外）；另 `tests/ship-roster.test.ts` 以 `samples/start2-master.json` 建 GameState 後餵
`ownedShips()`，不手捏 master；`tests/ships-overview.test.ts` 涵蓋表格 HTML escape、
空槽佔位、CSV 匯出。vitest 需 `@` 別名才能載入用 `@/…` 的 entrypoint 模組，已補進
`vitest.config.ts`（WXT 建置時自帶，vitest 不經過 WXT）。

### 裝備全覽：`utils/gear-inventory.ts`＋`sections/equipment.ts`（2026-07-22）

**主導覽是那排裝備圖示，不是類別下拉**。裝備和艦娘不一樣：玩家心裡的第一層
分類是「圖示長什麼樣」（主砲／魚雷／電探／艦戰…），那也是遊戲裡挑裝備時唯一的視覺線索，
而本專案已經有 M7 的 76 顆原創圖示。故 `.eq-rail` 一顆圖示一個可切換的篩選鈕（多選＝聯集）、
右下角疊持有件數。**只列實際持有的圖示**——全 master 共 59 個圖示 id，全排出來會讓
「我有什麼」這個第一眼問題淹沒在一整面沒有的東西裡。

**母集合是實例、呈現是種類**：遊戲的裝備庫是一顆一顆的實例（各自有 ★、熟練度、裝在誰身上），
但玩家問的幾乎都是種類層級的問題（「我有幾個 41cm？改修到幾星？哪幾顆閒著？」）。故
`groupGears()` 依 master id 彙總成 `GearGroup`，同時**保留 `instances` 原件**供展開列顯示
——彙總答不了「是哪一顆閒著」。

**展開列再疊一層**（`stackInstances()`）：**改修★＋熟練度＋持有者**三者全同的實例合成一行
並計數（★0 閒置 ×18）。逐顆列會讓常見裝備變成一整片一模一樣的方塊——二三十顆「★0 閒置」
佔滿畫面卻只表達了一件事；疊起來後讀法與「改修星數」欄一致。**持有者要連 `ex`（補強增設）
一起比**——同一艘艦的一般槽與增設槽是兩個不同的位置，合成一疊就答不出「這顆在哪一格」。
`count === 1` 時不畫 `×1`（每行掛一個只是雜訊）。usage／improve 兩個篩選是**群組層級**判定（有任一顆符合就
保留整組）：把組拆開只留符合的實例會讓「數量」欄與實際持有量不一致（篩「閒置」時 41cm
顯示 ×1 但其實有 3 顆），比看到整組更難讀。

**兩種模式共用同一組篩選、排序與欄位開關**（切模式不重置，那會讓人以為東西不見了）。
**預設是詳細清單**（使用者指定）——這個分區要回答的是「我有幾個、改修到哪、哪個素質最高」，
那是逐欄比較的問題，表格一次看得到十幾種；圖磚一次只看得到幾張卡，適合瀏覽而非比較。
圖磚上唯一的圖形化編碼是**裝備中／閒置比例條**——「有幾顆閒著可以拿去改修／配基地」是這張表
最常被問的問題，長度比例一眼可比。

**「裝備中艦娘」是可開的欄位，但預設關閉**：同一種裝備動輒裝在十幾艘船上，
塞進一格只能截斷成幾個名字——既答不出完整名單，又把本來就要橫捲的表撐得更寬，平常看展開列
即可。**但 CSV 沒有「展開」這個動作**，要在試算表裡回答「這顆裝在誰身上」就把該欄打開：
**匯出跟著顯示欄位走**（同 ships.ts 的規則；欄位開關若不影響匯出，使用者關掉一堆欄位後匯出
仍是滿滿一片，會覺得開關沒作用）。欄位開關存 localStorage，`name` 欄標 `always` 不可關閉
（它同時是識別與展開鈕，關掉整張表就沒有主詞了）。

**長裝備名在圖磚要換行、在表格要截斷**——兩者刻意不同：卡片有縱向空間，截斷後
「九七式艦攻改(熟練) 試製三号戊型…」這種名字全都長一樣、分不出是哪一顆；表格則要列高一致
才好橫向掃描。裝備名多為日文全形連寫、沒有可斷點，故卡片需 `overflow-wrap: anywhere`，
且 `.eq-name`／`.eq-title` 都要 `min-width: 0`（flex 項目預設不得縮到比內容窄，否則撐破卡片）。

**展開／收合是就地插入 DOM，不重繪整個內容區**（`toggleExpand()`）。詳細清單的捲動容器與
圖磚位置必須保持穩定，否則插入內容會使 `scrollTop` 歸零並讓剛點的卡片移位。排序／升降冪／
切模式的重繪走 `draw(true)` 保留捲動
位置（集合沒變，只是換個排法）；**篩選變更則刻意不保留**——集合都換了，停在原位沒有意義。

**素質是 master 基礎值，未含改修 ★ 加成**（UI 已標示，`ov.eqStatNote`）。改修加成的公式依
裝備類別與戰鬥情境（晝戰／夜戰／對潛…）而異，本專案不自行推導未經封包驗證的公式
（驗證原則）；只呈現遊戲直接給的數字。**與「艦娘全覽」的裸素質是相反方向的取捨**：那邊是
拿顯示值減裝備加成（估算、會偏高），這邊是根本不算。

**表格顯示的欄位皆為封包事實**，已用 `samples/start2-master.json` 全 741 顆核對：十項素質欄
（`api_houg` 火力／`api_houm` 命中／`api_leng` 射程／`api_houk` 迴避／`api_baku` 爆裝／
`api_raig` 雷裝／`api_saku` 索敵／`api_tais` 對潛／`api_tyku` 對空／`api_souk` 裝甲）**每一顆都有值、非可選欄位**；
`api_luck` 保留在共用素質模型供艦娘計算，但不列入裝備全覽表格；`api_sortno`＝裝備圖鑑順（預設瀏覽順序用它，
拿 master id 排會把改修版本散到各處）；類別名來自 `api_mst_slotitem_equiptype`（62 筆）。

**持有者反查必須含基地航空隊**：`airBases` 的中隊（`api_plane_info[].api_slotid`）吃的是
**同一批裝備實例**，漏掉它會把配置在基地的陸攻整批誤報成「閒置」。補強增設（`api_slot_ex`）
同理要算成裝備中。`GameState.ownedGears()` 三種持有者皆已測試涵蓋。

**消耗品獨立標示與篩選**：`consumableGearIds`（洋上補給・戦闘糧食・応急修理要員…）不計入
`counts()` 的裝備欄上限，故它們在清單裡帶「消耗品」標記，並有獨立的顯示／隱藏／只看三態——
但**不預設隱藏**（藏起來會讓人以為資料漏了）。摘要列同時顯示「篩選結果件數」與遊戲的
「裝備欄 n／max」，兩個數字語意不同，不可混為一談。

### 配裝參考：`utils/equip-ref.ts`＋`sections/equip-ref.ts`（2026-09-09）

從鎮守府**目前在案艦**指定一艘，列出她裝得上、且有藍字加成或社群主砲適性的**全圖鑑**裝備；
庫存沒有的加「庫存無」，可篩成只看庫存有。艦清單與裝備庫分別吃 `ownedShips()`／`ownedGears()`。
艦種篩選晶片與列上標籤走 `utils/stype-label.ts`（與艦娘全覽同一套）：stype 8／9 同名「戰艦」時，
多數高速的那群才加註「高速」，低速側與逐艦低速艦維持原樣；鍵仍是 stype id，不用名稱當 Map key。
艦清單／裝備區是左右雙欄：只在 `.er` 容器 ≤520px 才改單欄（`docs/design-guidelines.md` §4.7），
**禁止**用 viewport 820px 這類斷點把清單堆到裝備區上面。

**兩份社群表都不是封包驗證**，UI 的 `ov.erNote` 必須明講：

- 藍字：`utils/equip-bonus-table.json`（KC3Kai replay `mst_slotitem_bonus.json`）。匹配鍵是
  `shipId`／`shipBase`／`shipClass`／`shipType`／`shipCountry` 的**同時成立**（有寫的才檢查）。
  只列該艦 `equipTypes` 裝得上的裝備，不猜未列的相互條件細節（`requiresEquipList` 只標有條件）。
- 適性：wikiwiki「命中と回避」#BBfit 轉寫。戰艦 A/B 群分界用 master `api_taik[0]`（≥93＝B），
  **不能用實例 maxhp**（結婚會加）。Atlanta／大淀從輕巡標準懲罰排除，避免與個別表疊加。
  主砲（cat 1/2/3/38）獨立成段、適性由高到低、旁標射程。

加成表更新：覆蓋 `utils/equip-bonus-table.json` 後跑 `tests/equip-ref.test.ts`。新活動口徑未進
適性表時不要猜。

### 資源紀錄（`utils/resource-capture.ts`＋`resource-log.ts`＋`line-chart.ts`，2026-07-22）

**兩個貫穿全部設計的事實**：

1. **封包只給餘額，不給消耗**。`api_material` 是「現在剩多少」，任何「花了多少」都是
   **兩個時刻的餘額相減**。故 UI 的每一個消長數字都成對顯示起訖時刻；算不出來
   （期間內沒有取樣）一律寫「不可考」，**不以 0 頂替**（同全專案的缺席處理原則）。
2. **歷史無法回填**。序列從擴充安裝那一刻開始累積——`db.events` 早被 M6 裁剪、
   `db.snapshot` 只留最新一筆。故 v12 **不做任何 upgrade 回填**，UI 的空狀態也直說原因。

**擷取落在 background，不是 EventProjector**（與其他四張 derived tables 相反，理由要記住）：
資源列不需要任何 GameState 上下文（封包裡就是八個數字），而它的價值**恰恰在於連續**
——面板沒開的那幾天要是斷掉，「這次活動花了多少」就永遠算不出來。故與 `db.snapshot` 同層，
在 `ingestEvent()` 的 post-processing 落地。主鍵用**來源 raw event id**（非自增）：
SW recovery 會重跑同一筆事件，put 冪等才不會把同一個時刻記兩次。

**取樣來源只認帶完整八項的 path**（`api_port/port`、`api_get_member/material`）。
`charge`／`createitem` 那類只帶部分項目的封包不構成一列快照；任一項不是有限非負數字就
**整筆放棄**——寧可少一列樣本，也不要把 undefined 當 0 畫成一道不存在的暴跌。
索引順序＝`api_material` 順序：0燃料 1彈藥 2鋼材 3鋁土 4高速建造材 5高速修復材
6開發資材 7改修資材（與 `FactoryLogRow.used`、panel 的 `MAT_KEYS` 同一組）。

#### 特殊時間點（`db.resourceMarks`）

使用者要的是「一次活動每個關卡各花了多少」，故要在資源序列上標出界線。兩種標記：

| 標記 | 來源 | 語意 |
|---|---|---|
| `stage-open` | `api_req_map/start` 且 `api_maparea_id >= 10` | 第一次出擊到該活動海域（add-if-absent，只留最早那次） |
| `gauge-clear` | `api_get_member/mapinfo` 的量表歸零 | 首次**觀測到**該海域血量歸零 |

**`gauge-seen` 是第三種 row，但它不是里程碑，是守衛**：量表歸零只能從 mapinfo 觀測，而
「一裝上擴充就看到某圖已經是 cleared」不代表剛剛打通（同 EventProjector 的
`gaugeSeenUncleared` 守則）。故必須先觀測到該圖「未歸零」才武裝，之後的歸零才算數；
記下 `gauge-clear` 時刪掉守衛，下一段量表重生時再重新武裝。SW 隨時會死，這個守衛
**不能是記憶體變數**，只能落地。

**clear 的 `seq` 用「該圖已有幾筆 clear」推導，不用 `api_gauge_num`**——後者語意未經驗證
（61-5 樣本為 4，可能是第幾段也可能是總段數），拿它當主鍵等於賭在猜測上。原始值仍存
（`gaugeNum`），只存不推導。歸零判定與 `EventProjector.isGaugeBroken` 逐條相同、欄位皆已實測：
`api_cleared`／HP 量表 `now_maphp === 0`／擊破數達標；**`now_maphp === 1` 是「最終段、還差
一沉」不是通關**。

**時刻的誠實性**：`gauge-clear` 的時間是「**觀測到**歸零的時刻」，不是斬殺當下——遊戲要等
玩家再開海域選擇畫面才送那筆 mapinfo（見待辦 6b 的「即時性」未觀測項）。UI 文案已明講，
不假裝那是斬殺時刻。

#### 趨勢圖：最上方一張大圖、八條線、圖例即開關

**趨勢圖固定為一張大圖、八條線與可切換圖例**：八項資材共用一個時間軸，便於比較資源變化；
量級差距由序列開關與各自 y 值域處理。

量級差距（燃料十萬級、螺絲千級）的解法是**開關**：`multiChartGeometry()` 的 y 值域
**只由「顯示中」的序列決定**，關掉燃料之後螺絲那條就會撐滿整張圖。工具列另有
「全部顯示」與「只看四大資源」（燃彈鋼鋁量級相近，最常用的一組）兩顆捷徑。
**雙 y 軸仍然不做**——兩套刻度沒有共同基準，任何交叉都是視覺巧合。

**圖例是控制項不是說明**：一顆一項資材，色塊＋圖示＋名稱＋目前值，點了就開關那條線。
關掉的**留在列上**（淡化＋空心色塊），不然使用者不知道還有那一項可以打開。

**序列配色是 dataviz 參考色盤的固定順序，資材 i 恆定拿第 i 個色位**——開關序列時絕不
重新分配顏色，否則關掉一條線會讓其他線全部換色（dataviz 硬規則：色彩跟著實體，不跟著
排名）。深淺兩套色值各自用 `validate_palette.js` 驗過亮度帶／彩度／CVD 分離／對比。

x 依 `ts` 的相對位置而非等距索引——取樣本來就不等距（一天打十場、隔天不上線），
等距畫會把時間軸扭曲。

**SVG 實作約束**：

- **`hidden` 是 HTML 屬性，對 SVG 元素無效**。十字準線與游標點掛 `hidden` 之後照樣畫在
  (0,0)，畫面左上角會出現一顆莫名其妙的點。要用 CSS `[hidden] { display: none }`。
- **不要用 `preserveAspectRatio="none"`**。非等比縮放會把 y 軸刻度的文字橫向拉伸
  （容器 1600px 時字被拉成 1.6 倍寬）。改成等比＋`aspect-ratio: 1000 / 300`，
  線寬另用 `vector-effect: non-scaling-stroke` 固定成實際像素。

**抽稀是純減量，不平滑**（`downsample()` 每個時間桶取最後一筆、首尾必留）：平滑會把
「一次活動燒掉十萬燃料」的那道陡降磨圓，而那正是這張圖唯一要看的東西。粒度收斂
（`bucketSamples()` 每筆／每小時／每日）同理取**最後一筆**而非平均——餘額是「當下有多少」，
取平均沒有意義；每日依**本地時區**切，玩家心裡的「今天」是本地日期。

**新增兩個語意色變數 `--res-gain`／`--res-drain`**（增加／消耗）。刻意不挪用 `--dmg-*`
（大破/中破/小破）或 `--sally-*`（標籤狀態）——那兩組承載的是完全無關的語意，共用會互相
稀釋（design-guidelines §4.5）。色值 `#2f8fcf`／`#cf7526` 已用 dataviz 驗證器對深色
`#182030` 與亮色 `#ffffff` 兩種底色跑過亮度帶／彩度下限／CVD 分離／WCAG 對比四項檢查，皆 PASS。

#### 版面與驗證

分區**刻意不遵守「全量重繪」慣例**（design-guidelines §4.2 的第二種例外）：這裡有使用者
自己造出來的狀態——圖表的十字準線、詳細清單的捲動位置與分頁。控制項只建一次，之後只重繪
`.rl-body`；結果區一律事件委派。**詳細清單的欄位開關做成表格正上方的一排圖示鈕
（`colRackHtml`，一項資材一顆、只放圖示不放文字，同表頭也是純圖示）**，不是藏在下拉選單裡；
名稱靠 title 與圖表圖例補足。欄位開關**跟著 CSV 匯出走**（同 ships／equipment
的規則）。期間／粒度／欄位／每頁筆數存 localStorage（`kc-resource-view`），不進 Dexie、不進備份。

版面驗證走離線預覽（`tools/preview/resource-log.ts`）——上面那兩個坑都是它抓到的
（外加 i18n 字串裡的 Markdown `**` 會原樣顯示在畫面上）。與出擊紀錄的預覽有一點不同：
`samples/` 裡**沒有現成的餘額歷史**（那要跑好幾週才生得出來），故用**有依據的合成序列**
——起訖水位、每場出擊的消耗量級、活動的關卡數與里程碑順序都照 `samples/61-*.json` 那次
活動的形狀。合成的是「時間軸」，欄位語意仍走與分區完全相同的那份程式碼（HTML 建構器抽到
module scope 共用）。真實規模才看得出版面問題——八格折線並排、六位數的欄寬、一次活動
八個里程碑，手捏三筆假資料一切都很好看。

### 艦娘收藏日誌：兩個日期（2026-07-20）

「艦隊收藏」的核心是收藏本身，故「艦娘全覽」每艘顯示兩個日期：

| | 意義 | 來源 | 可改 |
|---|---|---|---|
| **date1 官方登場日** | 該艦在遊戲實裝那天 | `utils/ship-debut-data.ts` 參照資料 | 否 |
| **date2 打撈上任日** | 本鎮守府實際入手日 | `db.shipObtained` | 見下 |

**遊戲 API 完全不提供這兩個日期**——艦娘物件只有 `api_id`（艦實例 id＝入手**順序**，
單調遞增不重用，每位玩家不同），沒有任何時間戳。`api_get_member/record`（戰績頁）也
**沒有提督上任日欄位**（已逐欄檢視真實回應確認），故「入手日不得早於上任日」這條下限
**刻意不做**。

**date2 的三種狀態**（`ShipObtainedRow.source`）：`'auto'`＝擴充追蹤期間首次觀測到該
api_id，是確定事實、**唯讀**；`null`＝baseline（擴充開始追蹤時就已擁有，真實日期不可考）；
`'manual'`＝玩家自填。baseline／manual 開放編輯，**下限綁 date1**（不可能早於實裝日），
date1 未收錄時只擋未來日期、不猜測。**手填一律寫 `source='manual'`、不補
`observedEventId`**——那兩個欄位是 `retention.ts firstOwnedDropKeys` 判定「新船場」的證據，
手填值混入會污染重播保留判定。

**master 三個關鍵欄位（皆已用真實 start2 驗證，見 `samples/start2-master.json`）**：

- **`api_sortno` ＝図鑑番号**。與獨立來源的公開図鑑資料交叉驗證：番号 1–10 依序為
  長門/陸奥/伊勢/日向/雪風/赤城/加賀/蒼龍/飛龍/島風，與 `samples/ship-debut-dates.json`
  的排列完全一致。0/缺＝不在図鑑（深海棲艦等）。
- **`api_aftershipid` 是「字串」**（例 睦月 `'254'`），`'0'` 代表無後續改造。
  **當 number 比對會靜默失效**，務必先 `Number()` 解析。
- **`api_mst_shipupgrade.api_original_ship_id` 才是改造→基礎形態的可靠解法**。只走
  `api_aftershipid` 反向圖覆蓋率僅 **94%**（部分改二不在圖上，例 鈴谷改二 503），
  改以 shipupgrade 直接對應為主、反向圖為備援後達 **100%**（`GameState.baseShipId()`）。
- **可逆轉換改裝會讓 aftershipid 形成「環」，反解必須用帶 visited 的圖搜尋、不能用單鏈**。
  實例：Glorious 可在戦艦／正規空母兩形態間來回改裝且**同名**——
  `1022 Glorious 戦艦(No.612) → 1027 Glorious 正規空母(No.617) → 741 Glorious改 正規空母
  ⇄ 740 Glorious改 戦艦`，其中 740⇄741 互指成環。反解必須收集所有前身、執行圖搜尋，
  再取無前身的根（多根取図鑑番号最小）；四個形態皆可解到 1022。`remodelPrev` 因此存
  `Map<number, number[]>` 而非單一前身。

**維護 `samples/ship-debut-dates.json` 的注意事項**：**活動艦不可一律套同一個日期**——
活動分前後段開放，分屬不同關卡的新艦登場日不同。實例：Glorious `2025-10-30`（前段）與
Dace `2025-11-10`（後段）屬同一次活動但差 11 天。以「該艦所在關卡的開放日」為準，
不是「活動開始日」。

**為何改造形態要反解到基礎形態**：改造形態沿用本體的登場日，故 `SHIP_DEBUT` 只存基礎
形態一筆。另外**図鑑番号也取基礎形態的**——改造形態自身的 sortno 不可靠（睦月=31、
睦月改=1354、睦月改二=234，落在不同區間），拿它排序會讓改造形態離本體很遠。

### 劇場模式與遊戲靜音（`entrypoints/theater.content.ts`＋`utils/theater.ts`＋`utils/audio-mute.ts`，2026-07-24）

**需求**：把包在 DMM 網頁裡的遊戲畫面「彈出來」單獨顯示、滑鼠隨意縮放、隨時還原（DMM 的
點數儲值仍在原頁），**全程不重新整理**，外加靜音開關。

**不提供另開或替換遊戲視窗**：搬動 `<iframe>` 到另一個視窗或 Document PiP 會摧毀 nested
browsing context 並重新載入；直接另開或替換遊戲頁也可能產生第二個遊戲執行個體。因此只保留
**劇場模式**：遊戲框留在原位置，只貼標記屬性＋設 CSS 變數（`transform`＋`clip-path`），不重新
載入；離開時完全還原原頁。

**DMM 遊戲網址已改版（2026-07 實測）**：舊的
`www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/` 現在 **302 導向登入頁**；實際遊玩頁
是 `https://play.games.dmm.com/game/kancolle`（200）。新頁是 **Vite + React 的 SPA**
（`<div id="root">`，遊戲框由 JS 動態插入、隨時可能重繪），**沒有任何可依賴的固定 id／class**，
而且沒有帳號就看不到登入後的真實 DOM。故：

- **遊戲框靠 src 主機名＋尺寸辨識**（`pickGameFrame()`）：先認 `kancolle-server.com`／
  `osapi.dmm.com`／`/gadgets/ifr`（確定證據），沒命中才取「夠大的那個」（≥400×300）；
  兩者皆無**回 null 不亂挑**——挑錯框會把 DMM 的廣告放大到整個視窗，比沒作用更糟。
  追蹤／分析框（googletagmanager 等）一律排除。
- **標記屬性＋外部樣式表，不寫 inline style 到 DMM 的元素上**（inline 要逐項記錄原值才
  還原得回去）；React 重繪把屬性洗掉後由 MutationObserver 重新貼標，新插入的廣告也會被
  補上隱藏標記。
- **不用 `position: fixed` 當主要手段**：祖先若有 `transform`／`filter`／`contain` 會變成
  containing block，fixed 就不再對齊視窗。改為「祖先鏈以外的東西藏起來、祖先鏈撐滿視窗」，
  對未知結構最不挑。

**顯示的是「遊戲畫布」不是「整個 iframe」**：
DMM 的遊戲框裡除了遊戲，還包著頁尾按鈕（作戦要綱／艦娘／用語…）與大片白底，拿整個框去
fit 會讓遊戲縮得比視窗小、下方留一大條白。**畫布位置只有框內的 content script 量得到**
（跨源），故由 bridge 回報 `canvas` 的 bounding rect，父頁據此 `clip-path: inset(...)` 裁掉
其餘部分並把畫布置中（`framePlacement()`）。

- **只信任「直接子框」的回覆**（`e.source === frame.contentWindow`）：中間若隔著 DMM 自己的
  gadget 框（舊入口的 `osapi.dmm.com`），量測值的座標基準就不是我們縮放的那個框，採用會
  歪掉。量不到就**退回整個框、不裁切**，不猜一個矩形。
- 若日後實機證實新版遊戲頁確實多包一層跨源框，補救方向是把該框的網域也納入 optional
  origins、以 `allFrames` 注入一份只做「加上自身 iframe 偏移後往上轉發」的中繼；在有實機
  證據之前不預先實作。
- `transform-origin` 固定 `0 0`、遊戲框強制 `display: block`：座標運算才是單純的
  `螢幕 = translate + zoom × 框內座標`，`50% 0` 之類的原點會讓「裁切後置中」變成兩層互相
  牽動的補償量（`tests/theater.test.ts` 有鎖這兩條）。

**工具列固定佔住底部一條，絕不覆蓋遊戲畫面**：滑鼠移到遊戲畫面上時事件全被 iframe 吃掉，
父頁無法依 hover 自動閃避，因此使用底部 `BAR_HEIGHT`（19px）的實體條，fit 計算一律扣掉它。
shadow CSS 裡 `button { display: inline-flex }` 是**作者樣式**，會覆蓋瀏覽器對 `[hidden]` 的
`display:none`（與 specificity 無關），因此必須明寫
`[hidden] { display: none !important }`。

**視窗縮放要自動跟著 refit**：
`fitMode` 預設開啟，resize 時重算縮放；**只有使用者親手縮放過（按鈕／滾輪）才脫離 fit**，
按「適應」再回來。工具列的「適應」鈕在 fit 模式下亮色，讓使用者知道現在會不會自動跟上。

**`fitZoom()` 固定使用 contain，不使用 cover**：畫面必須等比例完整可見，比例不合時保留
黑邊，不裁切內容。`enter()`／resize refit／「適應」鈕的視窗縮放路徑都經同一支
`fitZoom()`，任何「消除黑邊」的需求都得換別的手段（例如既有的 `fitWindow()`／
`MSG_THEATER_FIT_WINDOW` 改調整瀏覽器外框尺寸去貼合遊戲原生比例，而不是裁切畫面內容）。

**`enter()` 直接做「適應」的完整動作**：`enter()` 呼叫 `fitWindow()`（內部含
`applyTransform()`），會連帶調整瀏覽器外框尺寸去貼合遊戲原生比例、把黑邊縮到最小。
這樣「畫面完整、盡量沒有黑邊」在點下劇場模式的當下就一次到位。自動恢復劇場狀態（`stored.active`）
的啟動路徑同樣經過 `enter()`，故重新整理後自動回到劇場也會一併觸發，行為一致。
**已知殘留**：`enter()` 當下畫布可能還沒被精準量到（`gameRect` 為 null，`fitWindow()`
用 `fallbackGameArea()` 的 5:3 估計值計算視窗尺寸），稍後 `requestMeasure()` 量到精確值
只會重算 CSS 縮放（`applyTransform(true)`），不會重新觸發一次視窗尺寸調整——多數情況下
估計值夠準，殘留誤差頂多是一點點黑邊，不影響「畫面完整不裁切」這個第一原則。

**實跑驗證（playwright-core，`channel:"chrome"`，模仿 SPA 結構＋框內有頁尾白底的合成頁）**：
fit 依畫布而非整框計算（1000×700 視窗下 zoom=0.833＝1000/1200，非 0.72）、頁尾被 `inset`
裁掉、工具列在畫布下方不重疊、resize 自動 refit、手動縮放後 resize 不再改動、
連按放大／模擬 React 重繪（換掉頁首＋插入新廣告）／離開，全程 **iframe 內的
`window.__loadId` 完全不變 ＝ 沒有重新載入**；離開後標記歸零、`transform: none`、
頁首與廣告回復原位。靜音另以真實 `AudioContext` 驗過：`destination` 被換成 GainNode、
`maxChannelCount` 轉發正確、靜音時 gain=0、既有與新播放的 `<audio>` 都被靜音。

**滑鼠與鍵盤事件會被遊戲框吃掉**：一旦放大到蓋滿視窗，滾輪、拖曳與
Esc 全部落進框內文件，父頁**再也收不到**。解法分兩邊：

- 遊戲框內的 bridge 轉發 **Alt+滾輪**（縮放）與 **Esc**（離開）到 `window.top`；
  **一律 passive、不 stopPropagation／preventDefault**——遊戲照樣收到原本的事件，
  我們沒有改變遊戲行為（設計原則 1 的精神）。轉發內容只有互動意圖，不含任何遊戲資料。
- 工具列在**溢出視窗時才出現**四顆平移鈕。這不是裝飾：那種情況下工具列（Shadow DOM，
  事件必達）是唯一還能平移的手段。空白邊的拖曳平移保留，但只在有空白邊時有用。

**靜音以整個遊戲分頁為準**：`installAudioMute()` 在遊戲框的 MAIN world（document_start，
早於遊戲建立音訊圖）把每個 `AudioContext` 的 `destination` 換成 master GainNode，gain 再接
真正的輸出；同時處理 `<audio>`／`<video>`。BGM 不保證走可攔截路徑，故背景以
`tabs.update({muted:true})` 可靠靜音含有遊戲框的分頁。這新增 `tabs` 權限，且連 DMM 頁面聲音也
一併靜音；目的僅是 BGM 與操作語音都停止，不讀取分頁內容。
`destination` 的 `maxChannelCount` 轉回真正的輸出節點（少數音訊庫會讀它）；接管失敗一律
`console.warn` 後維持原樣，**絕不讓例外冒進遊戲程式碼**。
⚠️ **未驗證**：艦これ Flight-IIA 究竟用 WebAudio 還是 media 元素播音，本專案沒有樣本可考
（同驗證原則），故兩條路徑都接、實機再確認。

**「靜音沒反應」的第一嫌疑是遊戲分頁沒有 F5**：content script 改動後必須重新注入，
而劇場模式是用 `executeScript` 立刻注入才會馬上生效，
interceptor／bridge **不會**——未重新注入的既有分頁沒有靜音 hook，故
background 在靜音回覆裡附上 `connected`（目前連上的遊戲分頁數），popup 與劇場工具列在
`connected === 0` 時直接顯示「請在遊戲分頁按 F5」。另外 MAIN world 會掛
`window.__kcAudio`（`contextCount()`／`isMuted()`）：在遊戲框的 console 查得到就代表 hook 已注入，
`contextCount()` 為 0 則代表遊戲根本沒用 WebAudio。

**狀態存放**：靜音開關與語言鏡像存 `db.meta['game-page']`（`GamePageMetaRow`）——SW 沒有
localStorage，而 `chrome.storage` 要新增權限。語言的真相仍在擴充頁面的 localStorage
（`ui-prefs.ts`），這裡只是鏡像：劇場模式跑在 dmm.com，跨 origin 讀不到擴充頁面的
localStorage，讀不到鏡像時退回瀏覽器語言偵測。**這一列不參與投影、不引用任何 event id**，
故 `backup.ts` 的 `restoreMarker()` 會略過它（否則按過一次靜音就會讓備份還原判定為
「來源不明的既有資料」而被拒）。縮放倍率與「上次是否在劇場」存 DMM 頁自己的 localStorage
（`kc-theater`），不進 Dexie、不進備份。

**授權流程**：popup 的「劇場模式」→ `permissions.request()`（**必須是點擊手勢的第一個
呼叫**，先 await 別的事情會失去手勢資格）→ `scripting.registerContentScripts`
（`persistAcrossSessions`，日後開遊戲頁自動生效）→ 對當前分頁 `executeScript` 立即注入
（否則要使用者自己 F5）。已注入的分頁先試 `tabs.sendMessage` 切換，失敗才注入；
content script 另有 `__kcTheaterInstalled` 旗標防重複注入長出第二條工具列。

### 拍照（`utils/screenshot.ts`＋`MSG_CAPTURE_TAB`，2026-07-24）

只擷取「遊戲畫面」、不含 DMM 頁面其餘部分。入口有兩個：popup 選單的「拍照」與劇場模式
工具列的相機鈕（後者的 `.bar[data-mode="on"]` 底部條高度為
`BAR_HEIGHT=19`，見 `utils/theater.ts`；靜音與相機圖示鈕字級貼近列高以減少留白）。

**裁切矩形絕不重新推算一次**：兩個入口都呼叫 `theater.content.ts` 的
`measureScreenshotRect()`，它直接沿用劇場模式本身已經校準過的
`pickGameFrame`／`contentArea`／`fallbackGameArea`（`utils/theater.ts`）與跨源畫布量測
協定（向遊戲框內的 bridge 要 canvas rect），並用 `iframe.getBoundingClientRect().width /
frame.offsetWidth` 換算目前有效縮放——劇場模式開著、手動縮放過都算得對，因為
`getBoundingClientRect()` 本來就反映套用在 iframe 上的 CSS transform。量不到畫布時回傳
`rect: null`，呼叫端據此誠實回報「找不到遊戲畫面」，不猜一個矩形（同 `theater.notFound`
的既有原則）。popup 走 `MSG_SCREENSHOT_RECT` 訊息問正在跑（或臨時注入）的 content script；
劇場工具列的相機鈕就在同一支腳本裡，直接呼叫函式，不必繞一圈訊息。

**`tabs.captureVisibleTab()` 抓整分頁截圖，裁切用 `utils/screenshot.ts` 的
`cropRectPx()`（純函式，`tests/screenshot.test.ts` 覆蓋含邊界夾限）＋
`downloadCroppedScreenshot()`（Blob + 臨時 `<a download>`，同 overview 的
`downloadText` 手法，零額外權限）。兩個入口共用同一份，不各自實作一次。**

**截圖權限使用 `activeTab`**。劇場模式的 `optional_host_permissions`（dmm.com，用來注入
content script）不涵蓋 `captureVisibleTab()`；Chrome 官方文件規定該 API
**只認 `<all_urls>` 或 `activeTab` 兩者之一**，不認一般的 origin
host permission。`<all_urls>` 違反權限精簡（設計原則5），改用 `activeTab`：manifest 裡
不顯示任何警告、不進 `host_permissions`，且只在使用者「呼叫擴充」（點圖示開 popup／
快捷鍵／右鍵選單）當下對「那個分頁」暫時授予，分頁換頁或關閉即失效——`tests/manifest.test.ts`
已更新斷言 `permissions` 含 `activeTab`。

**content script 沒有 `tabs` API**：抓截圖這步一律經 background 轉手
（`MSG_CAPTURE_TAB`，`entrypoints/background.ts`）；popup 本身雖有 `tabs` 存取權，仍走
同一條訊息而非直接呼叫——單一實作，兩邊的錯誤處理才不會分岔。`windowId` 由呼叫端帶（popup
知道自己查到的 tab），content script 呼叫時不必帶，background 改用
`sender.tab.windowId`（content script 的訊息一定帶 `sender.tab`）。

**已知未驗證的邊角**：`activeTab` 的授予由「呼叫擴充」的動作觸發，且只在該分頁未換頁期間
有效。popup 開啟必定觸發，因此 popup 的拍照鈕可用；劇場工具列的相機鈕屬於頁面內容點擊，
若劇場模式由 `stored.active` 自動恢復且該分頁尚未開過 popup，可能因未取得 `activeTab` 而
回報 `screenshot.failed`。

### 編成寫真（`entrypoints/panel/fleet-photo.ts`＋`utils/fleet-photo.ts`，2026-10-01）

面板 header 的相機鈕開啟拍照托盤，取代固定 270px 的 `#tabpanel`（`#photo-tray`，同高，
不推動下方編成）。玩家在遊戲裡逐艘打開艦船ステータス（或逐隊打開基地航空隊），按「拍下一張」
或快捷鍵，擴充讀取該區塊；全部拍完後依遊戲編成畫面的順序合成一張 PNG，頂端加上本擴充繪製的
標題列。拍攝對象跟著下方的艦隊切換鈕：1–4 單隊、連合艦隊（主力／護衛兩段）、基地航空隊
（面板目前選的海域）。點分頁列任一分頁即關閉托盤；autoSwitch 在背後照常運作。

**擷取通道：直接讀遊戲畫布，不用 `captureVisibleTab`。** 面板 → background
（`MSG_FLEET_PHOTO_CAPTURE`）→ 遊戲框 bridge 的長連線（`PORT_GAME_FRAME`，由 content
script 主動連上，與 `PORT_MUTE` 同理，不需要 host permission 或 `activeTab`）。bridge 找出框內
最大的 canvas，在下一個 `requestAnimationFrame` 以 `drawImage` 裁出指定區塊再 `toDataURL`。
WebGL 畫布在繪製週期外讀取會得到空白，排進下一個 frame 是讓遊戲的 ticker 先在同一 frame
畫完；讀回後以 5×5 取樣（`isBlankSample`）判斷，空白時回報 `blank`，不回傳空圖。每個
kancolle-server.com 框各有一條連線，background 只向所選分頁發送請求，取該分頁第一個成功的結果；全部失敗時回報最具體的
原因（`blank`／`failed` 優先於 `no-canvas`），4 秒無回應回報 `timeout`，沒有任何連線回報
`no-game`（多半是擴充更新後遊戲分頁未 F5）。只有一個遊戲分頁時自動選取；多個分頁時須在輸出設定選擇來源，未選時回報 `choose-source`。來源以 port 的 `sender.tab.id` 核對。只讀像素，不觸碰遊戲狀態、通訊或 DOM 結構。

**裁切範圍（遊戲 1200×720 座標，`PHOTO_REGIONS`）**：艦船ステータス `(485,154) 684×546`、
基地航空隊 `(862,274) 334×422`。兩者都由縮放過的實機截圖換算量得（精度約 ±2px），並與社群
流傳的四艦組合圖逐項比對過版面位置。基地航空隊刻意從「第N基地航空隊」名稱列開始，不含海域
橫幅；橫幅裡的行動與作戰半徑改由標題列第二行逐欄繪製（資料取自面板既有的 `AirBaseView`）。
畫布解析度不等於 1200×720 時依比例換算（`regionToCanvasPx`）。

**輸出版面（`photoLayout`）**：艦隊 2 欄、由左而右再往下，與遊戲編成畫面相同（七艘排 4 列、
第七艘在左欄）；連合艦隊主力在左、護衛在右，中間留 48px 深色間距；基地航空隊依該海域的
基地數（1–3）排一列。格子位置只依序號決定，未拍的格子留空不遞補。2/3 尺寸時單隊六艘為
912×1092（加標題列 35px），與常見的 800×480 時代組合圖同尺寸。

**標題列**：艦隊類型＋制空／索敵(33)／航速／TP（基地航空隊為「基地航空隊＋海域名」，第二行為
各隊行動／半徑）。數值沿用面板編成摘要的同一份計算（`fleetSummary`／`combinedSummary`，
索敵依面板目前的分岐點係數，係數不為 1 時標示 ×N）；制空的熟練度成分可能過時（`airStale`）時
數字前加 ≈。預設類型：連合艦隊依 `api_combined_flag`，七艘為遊擊部隊，其餘為通常艦隊；前衛／
決戰支援無法從封包判斷，只能由使用者在「輸出設定」選。標題列語言預設跟隨介面，可獨立指定
（`tFor`）；航速因此改由 `fleetSummary` 多回傳不受語言影響的 `speedKey`。截圖本身是遊戲畫面，
不受語言設定影響。

**變更偵測**：每格記下拍攝當下的簽章（艦：實例 id、艦 master id、各槽裝備 master id＋改修；
基地：各中隊裝備 master id＋改修）。之後封包使簽章改變時格子標示「已變更，需重拍」。Lv、HP、
熟練度、機數與疲勞隨出擊天天變，刻意不列入，否則每場戰鬥都會把整排標成需重拍。拍攝前後簽章或對象不同時，捨棄影像並提示重新拍攝。

**暫存與權限**：截圖只存在面板視窗記憶體，不寫 DB、不進備份，關閉面板即清空。快捷鍵是 manifest
`commands`（預設 Alt+Shift+S，`chrome://extensions/shortcuts` 可改），不是權限；background
收到指令後轉給面板，托盤開著才拍。輸出設定（類型、標題列欄位、語言、尺寸）只在本視窗期間有效。

**header 單行自動縮放**：加入相機鈕後，12 字提督名在預設字級下放不下。改為名稱放得下時維持原
尺寸；會被截斷時以 1% 為級距整排等比縮小（`fitHeaderScale`，CSS 變數 `--hs`），最寬的 12 個
全形字約縮到 0.79。高度固定 39px，與原本相同。

**尚未以實機驗證（開發者手動檢查）**：
1. 開發版載入後遊戲分頁 F5，進「編成」→ 某艘「詳細」，按托盤「拍下一張」：縮圖應為完整的
   艦船ステータス，不是空白；若回報「空白」，代表 rAF 讀取時機在實機無效，需改用其他讀取方式。
2. 以原生畫布拍到的圖核對裁切邊緣（上緣不切到艦名、右緣含卡圖外框、下緣含補強增設列），
   有偏差就修正 `PHOTO_REGIONS`。
3. 基地航空隊：出擊 → 海域 → 基地航空隊，逐隊拍攝，核對上緣不含海域橫幅。
4. 拍攝期間遊戲畫面不應卡頓、遊戲操作不受影響。

離線預覽：`tools/preview/fleet-photo-panel.ts`（打包正式托盤與 header 縮放，假資料＋佔位卡）。

### 關閉分頁前警示（`entrypoints/bridge.content.ts`）

避免手滑關掉／重新整理／導覽離開正在進行出擊或遠征的分頁。標準 `beforeunload` +
`e.preventDefault()`，瀏覽器規格保證只要有一個 frame 取消就會跳原生「離開此網站？」對話框；
規格本身**無法區分**「關閉分頁」「重新整理」「離開網址」三者，也**無法自訂對話框文字**
（現代瀏覽器一律顯示自己的固定文字，`e.returnValue` 的內容只看真假值）。

**這是關鍵功能，不能靠使用者先授權才生效**：`beforeunload` 掛在
`bridge.content.ts`（遊戲框本身，kancolle-server.com），由 manifest 靜態注入；安裝當下、
零額外授權、零使用者互動就生效，涵蓋新舊 DMM 入口。

**已知代價，刻意接受**：跨源 iframe 掛 `beforeunload` 時，Chromium 可能在按「取消」後再次
顯示對話框；這是
Chromium 對「跨源 iframe 掛 `beforeunload`」的已知問題（社群回報，如
crbug.com/1119438）：跨源子框與分頁本身的關閉協商是分開處理的（Site Isolation 下通常落在
不同 renderer process），瀏覽器 UI 層可能各問一次。**兩害相權**：零權限、
可能跳兩次，優先於單次跳窗但需要先授權——跳兩次終究還是能擋下誤關，沒有保護才是真正的風險。

**只在「最外層」的 kancolle-server.com 框安裝**（`isOutermostGameFrame()`）：避免遊戲
內部若真有巢狀同源子框時各自掛一份、放大重複跳窗機率。判定靠讀 `window.parent.location`
會不會丟 `SecurityError`——讀得到代表 parent 跟自己同源（也是巢狀在遊戲裡的框），這裡不裝；
讀不到（跨源，通常是 DMM 頂層頁）才是最外層，才裝這份；`window===window.top` 時也視為
最外層（沒有 parent 可比較）。**這是防禦性寫法，不是雙跳問題的根本解**——上面那段已經
說明雙跳更可能源自跨源 frame 與分頁本身的 Site Isolation 協商，不是同源巢狀框重複掛載；
沒有實機證據顯示遊戲內部真的有巢狀同源框，這條只是零成本的保險。

---

## 驗證原則與封包擷取

**驗證原則（重要）**：涉及封包欄位結構／索引的機制，**先拿真實封包對照再上**——本專案已
被 API 格式坑過兩次。演算法可從 wiki/KC3Kai/poi 轉寫，但欄位佈局要實測。拿到樣本先存
`samples/`，用 node 跑核心驗證（見「建置與驗證」）。

**自動擷取（開發用 UI）**：面板「動態」分頁的「待驗證封包」清單——**僅 `npm run dev` 或本機
`localStorage.kc-debug-ui='1'` 時顯示與擷取**（`utils/debug-ui.ts`）。
正式建置預設關閉（營運對玩家檢視封包敏感；且無 UI 時繼續寫 wanted 會永久
釘住 raw events）。開啟時：`GameState.wantedTag(path,api)` 命中即記入 `db.wanted`，
**同時自動觸發下載**（`downloadJson()`，`entrypoints/panel/main.ts`）把
`{tag,path,ts,req,api}` 存成 `kc-wanted_{tag}_{path}_{ts}.json`，落地到瀏覽器預設下載
資料夾（一般是 `~/Downloads/`）——用 Blob＋`<a download>`，不需要新增 `downloads` 權限
（見設計原則 5 權限精簡）。清單仍保留「複製 JSON」／刪除／清空供事後管理與補救重存。
**有上限**：同一分類 5 筆、總數 50 筆——`db.wanted` 引用的 raw event 受裁剪
永久保護，達上限時清單明說並提供刪除，**不可改成靜靜略過，也不可拿掉保護語意**。
出擊紀錄的「單場 JSON 匯入」同屬開發用 UI，預設不顯示（`utils/sortie-import.ts` 與
測試仍保留）。

`wantedTag()` 只保留兩類能提供新資訊、且不會洗版的鉤子：渦潮**表外**且真有
`api_happening`（供補 `maelstromLoss` 表）、未知 sally 系 key（標籤名是否進 API）。可由現有
資料或社群實作驗證的機制，以及只會產生重複樣本的欄位，不得加入擷取清單。

**手動擷取（備用）**：遊戲分頁 DevTools Console 對 `[KC-Monitor] 戰鬥/結算封包` 物件右鍵
Copy object；或切 frame 後 `copy(__kcLastBattle)`；其他 path 用 Network 篩選。

---

## 慣例

- **一律用繁體中文（台灣用語）回應使用者**，不論提問用什麼語言。
- 程式碼註解用**繁體中文**。
- 第三方邏輯採 **clean-room 重寫**（標 `inspired by KC3Kai, MIT`），登錄
  `THIRD-PARTY-NOTICES.md`（現含 poi-plugin-expedition 資料、KC3Kai 戰鬥預測）。
- 非平凡改動跑 `npx tsc --noEmit`；戰鬥/狀態邏輯改動用真實封包做執行期驗證。
- 面板 UI：分頁自動切換後，使用者手動切過即暫停自動，直到情境變化（`autoSwitch`）。

### 打撈紀錄／建造紀錄的 CSV 匯出入（`utils/csv.ts`＋`drop-log-import.ts`＋`build-log-import.ts`，2026-07-23）

**CSV 契約**：打撈紀錄（`db.sorties` 中有掉落的列）與建造紀錄（`db.factory` 的 `build`／
`speedup`）提供 CSV 匯出入，以便搬移與備份還原前保留資料；格式相容「航海日誌拡張版」
（Nishisonic/logbook，MIT，同 `map-node-kind.ts` 引用的
上游）匯出的戦績／ドロップ報告書、建造報告書。

**匯出格式刻意不跟隨「畫面顯示什麼就匯出什麼」的既有慣例**（ships.ts／equipment.ts）：
那兩區是唯讀報表，這兩區的匯出是**可重新匯入的資料交換格式**，故改用固定欄位集合、
英文小寫識別碼當表頭（`ts,map,node,boss,rank,drop,dropMst` /
`ts,kind,shipMst,shipName,fuel,ammo,steel,bauxite,devmat,torch,secretary,secretaryName,hqLv`），
不受目前欄位開關或語言影響——語言切換不能讓自己匯出的檔案變成自己讀不回來。

**`db.sorties`／`db.factory` 是 provider-contract 的 derived tables，正常只能經
`EventProjector` 投影寫入**（設計原則 3）。CSV 匯入沿用 `utils/sortie-import.ts` 已建立的
例外路徑：event ID 向 events key generator 借（`add`→`delete`，只前進不回頭），確保匯入列
不會與未來擷取的 raw event 撞號，但**不寫任何 raw event**；每一列匯入都標 `imported: true`
（`SortieLogRow`／`FactoryLogRow` 2026-07-23 新增的 optional 欄位，無索引故不升 schema
版本），UI 顯示徽章與 `sl-flag.imported`／`sortie-log.ts` 同一套視覺語意。

**去重刻意不是「整批要嘛全進要嘛全退」**（與 `importSortie()` 不同）：CSV 批量匯入的常見
情境是「這份清單裡有一半我已經有了」，故逐列比對，重複的跳過並計入「重複」，其餘新列照常
寫入，交易只在單一列的 DB 寫入層級失敗時才整個 rollback。打撈紀錄的去重鍵是「同海域＋時間
±10 分鐘＋（有 master id 就比對它否則比對名稱）」；建造紀錄故意收窄到 ±2 分鐘**並要求投入
資材完全相同**——建造事件比掉落密集得多（常見「同時間排開好幾艘同配方」），寬鬆的時間窗
會把兩艘不同的船誤判成同一筆重複。

**相容「航海日誌拡張版」的匯出**：該工具的「CSV」其實是 **Tab 分隔＋CRLF、不做欄位跳脫**
（來源：`logbook/gui/logic/CreateReportLogic.writeCsv()`——`StringUtils.join(header, '\t')`），
`parseDelimitedText()`（`utils/csv.ts`）靠表頭那一行 tab 數 vs 逗號數自動判斷分隔符，兩種
來源共用同一支解析器。逐欄語意皆依原始碼（`CreateReportLogic`／`BattleResultDto`／
`MapCellDto`）轉寫、非猜測，但**沒有實機樣本佐證**，故解析器對任何不符預期的列一律跳過並
記錄原因（`skipped: {line, reason}[]`），不猜一個可能錯誤的值（同 `map-node-kind.ts` 的
「沒有樣本佐證的一律不猜」）：

- 戦績／ドロップ報告書的「マス」欄（`MapCellDto.getReportString()`）格式為
  `"マップ:{area}-{mapNo} セル:{cell}"`（或啟用字母化設定時多帶 `-{字母}`），是唯一能可靠
  取出 `world-mapnum` 的欄位——「海域」欄實際是 `getQuestName()`（作戰文字，非數字編號），
  **不能拿來解析 map**。セル／字母是該工具自己的格子概念，與本專案的 edge id 不是同一種東西
  （見「節點字母」），故 CSV 匯入的 `node` 一律當不可考（`0`，UI 顯示 `?`），只取到海域。
- 「ランク」欄（`ResultRank.toString()`）可能是簡寫 `S` 或完整文字如「完全勝利!!S」「敗北E」
  ——兩種形式恰好都以 rank 字母結尾，故一律取尾字元，不需要分支處理兩種格式。
- 「ドロップ艦娘」為空或等於「※空きなし」代表沒有掉落，這種列**靜默跳過、不計入
  `skipped`**（不是解析錯誤，是「這場沒有掉落」的正常情況，同本機擷取只收「有掉落」列的
  既有規則）。「ドロップアイテム」（裝備掉落）本專案不記錄，忽略。
- 建造報告書的「名前」／「秘書艦」是**艦名字串、不是 master id**，只能靠目前 master 反查
  （`reverseShipLookup()`：對 `GameState.master` 建一次性「艦名→id」表，第一個符合的優先）。
  查不到時存進新欄位 `importedShipName`／`importedSecretaryName`（同樣 2026-07-23 新增的
  optional 欄位）讓 UI 至少能顯示原始名字，**不假裝知道是哪個 master id**、也不得回頭當
  `shipMst`／`secretary` 使用。建造報告書沒有「高速建造材」欄，故其匯入列 `used[4]` 固定
  為 0、`kind` 固定為 `'build'`（航海日誌沒有另外記錄「高速完工」事件）。
- 日期一律是 `yyyy-MM-dd HH:mm:ss`（`AppConstants.DATE_FORMAT`），**無時區資訊，只能當本地
  時間解析**——與封包擷取的絕對時間戳不同源，屬已知的精度限制而非臆測。

**打撈紀錄提供「新船／非新船」篩選**：由 `utils/drop-new-ship.ts` 依 `shipObtained` 的首次
自動入手觀測與基礎形態定位歷史上的入手那一撈，並以 `SortieLogRow.eventId` 區分同一場出擊
的各筆掉落。打撈與建造紀錄共用分頁、關鍵字及時間篩選行為。

**測試**：`tests/csv.test.ts`（分隔符偵測／跳脫／往返）、`tests/drop-log-import.test.ts`、
`tests/build-log-import.test.ts`（自家格式往返、航海日誌相容解析、去重與 event ID 借號皆以
node 純函式＋`fake-indexeddb` 驗證，同 `sortie-import.test.ts` 的手法）。

---

### 遠征資源加成（`utils/expedition-bonus.ts`）

**遊戲完全不送這個機制的封包**——與 `repair.ts` 同類：公式是社群機制轉寫（非封包驗證），
面板必須標示為估算。來源：**直接讀取** wikiwiki.jp/kancolle/遠征（`#daihatsu` 節，裝備
基礎加成率表）與 wikiwiki.jp/kancolle/特大発動艇（`#bonus` 節，完整公式＋特大発超頂 2D
表）的**原始 HTML**，2026-08-03 逐字核對。**別用 WebFetch 對這類數字表格做摘要**——同一份
資料先後兩次用 WebFetch 摘要，兩次結果互相矛盾（且其中一版還混進了一段整段捏造、原頁面
根本不存在的「改修補正公式」），唯有 `curl` 原始 HTML 自己讀表格才收斂到一致且經五個算例
交叉驗證過的版本；日後任何缺資料，同一批 wikiwiki.jp 頁面應優先查，且一律読原始 HTML。

**master id 與基礎加成率**（id 已用 `samples/start2-master.json` 核對，非猜測；百分比為
wikiwiki.jp 原始表格數值）：大発動艇(68) 5%／大発動艇(八九式中戦車＆陸戦隊)(166) 2%／
特大発動艇(193) 5%（另有超頂加成）／武装大発(409) 3%／特二式内火艇(167) 1%／
装甲艇(AB艇)(408) 2%／特四式内火艇(525) 4%／特四式内火艇改(526) 5%。**大発動艇是子字串
會誤中大量改造/合體型裝備**（193/230/449/482/494/495/514/436/576等），比對務必用完整
master id 相等，不可用名稱 `includes`。

**公式**（wikiwiki.jp 原文逐字）：`獲得資源量 ＝ floor(基本量 × 大成功 × {1 ＋
min(基本補正之和,0.2) ＋ (0.2%×艦隊全體大発系★平均值)}) ＋ floor(基本量 × 大成功 ×
特大発補正)`。「基本補正之和」是艦隊全體（六艘）計入裝備的基礎加成率加總（特大発動艇的
基礎5%也算在內），封頂20%；**改修★項是平坦的 `0.2%×平均★`（★0–10，故最高+2%），
與基本補正是否已達20%上限無關**——別誤植成「乘以 min(基本補正,0.2)」，來源公式沒有這層
乘積，兩者是各自獨立的加法項。特大発補正是另一段獨立相加、**不受20%上限**，且**同時吃
「特大発個數」與「同時裝備的一般大発動艇(68)個數」兩個維度**（`TOKU_BONUS_TABLE`，2D
表，特大発+1／+2兩列對大発個數不敏感，+3／4以上兩列才隨大発個數變動 5.0~6.0%）——
**只看特大発個數的 1D 表不符合來源公式**；
`大発動艇(八九式中戦車＆陸戦隊)`等其他上陸用舟艇裝備**不計入這個「大発個數」維度**（wiki
腳注明載，只有大発動艇本體才算）。兩段各自 `floor` 後相加，不可先加總再取一次整。
大成功倍率沿用面板既有的 `×1.5` 慣例（`applyExpeditionBonus` 的 `successMultiplier`
參數），無加成時退化成原本的 `mul15` 行為。公式與 2D 表已用 wiki 原文五個算例（22%／28%／
20%／27.4%／27.8%）鎖進 `tests/expedition-bonus.test.ts`「wiki 原文算例」區塊。

**顯示**：`panel/main.ts` 的 `renderExped()`——直接把加成後數字取代原本的 `reward_*`
顯示值（不並排顯示兩個數字），**只有裝了計入加成的裝備時才變色**（`rewards.bonusActive`）。
變色用 `--sparkle`（金色）＝「有加成」語意色，**不可挪用 `--res-gain`／`--res-drain`**——
那組是資源紀錄的餘額消長語意（見該分區「刻意不共用」的既有注記），混用會稀釋兩邊各自的
視覺意義。**大成功那行不標示 `(×1.5)` 徽章**——`rewards.great.*` 已經是套用完大成功
倍率後的最終數字，並排一個「×1.5」字樣容易被誤讀成「這數字還要再乘1.5」。

**掃描範圍**：只掃 `expedCheck()` 正在檢查的那個艦隊（`deck.api_ship`），與既有的 drum
缶掃描（`DRUM_MST_ID` 同段邏輯）同一顆迴圈風格；不掃補強增設（大発系裝備不會裝在
ex-slot）。

### 遠征資料完整性（`utils/expedition-data.ts`）

**資料覆蓋範圍**：`EXPEDITION_DATA` 的 id 集合以真實 `api_mst_mission`
（`samples/start2-master.json`，2026-07-21 匯出）核對。poi-plugin-expedition 的
`assets/expedition.json` 自 2018-12-10 起未再更新，遊戲後續新增的 20 個遠征（id
41–46／103–105／112–115／131–133／141–142，涵蓋 maparea 1/2/4/5/7）條件取自持續維護的
ElectronicObserver（MIT）`Data/MissionClearCondition.cs`，轉換規則見下。id 301／302
（活動支援遠征，`expedDisplayName()` 已知的 S1/S2）以封包 `api_win_item1/2`／
`api_win_mat_level` 皆為 0 確認零收益，條件比照同為「駆逐2隻」支援任務的 id 33/34。

**條件資料的翻譯規則**（把 EO 的 C# 判定式轉成本專案 `required_shiptypes` 陣列）：
- `CheckShipCountByType(type, n)` → `{shiptype:[id], count:n}`；`CheckSmallShipCount(n)`
  （駆逐+海防）→ `{shiptype:[1,2], count:n}`（沿用既有 id100 等的既定寫法）。
- `CheckEscortFleet()`／`CheckEscortFleetDD3()`／`CheckEscortFleetDD4()` 是 OR 條件
  （軽巡+駆逐/海防N ‖ 護衛空母+... ‖ 駆逐+海防3 ‖ 練巡+海防2），本專案 schema 只能
  表達 AND，**沿用既有 id4/5/9（DD2）、id102（DD3）已經在用的簡化寫法**：只取最常見的
  「軽巡1 +（駆逐+海防）N」分支，即 `[{shiptype:[1,2],count:N},{shiptype:[3],count:1}]`。
  這是 schema 無法表達 OR 時的一致簡化規則。
- `CheckFlagshipType(x)` → `flagship_shiptype`；`CheckEquippedShipCount`／
  `CheckEquipmentCount`（TransportContainer＝輸送用ドラム缶）→ `drum_ship_count`／
  `drum_count`（與既有 id21/37/38 的既定對應逐筆核對一致）。
- id44（航空装備輸送任務）的 EO 條件含 `OrCondition`（水上機母艦2 ‖ 水上機母艦1+空母1），
  取第一分支簡化（與封包 `api_details`「水上機母艦2」的文字描述一致），會漏掉另一分支
  合法但更少見的編成；其餘 19 筆皆為單純 AND。

**收益數字來源**：EO 只驗證出擊「條件」，不含 `reward_fuel/bullet/steel/alum` 這類實際
收益數字。master 的 `api_win_mat_level` 是 0–4 的收益級距，同級距在不同
遠征對應的實際數字差異很大（如 level=1 在不同遠征分別對應 45/50/70/120/240/300 燃料，
無法單獨換算，因此數值取自 wikiwiki.jp/kancolle/遠征 的「詳細一覧表」原始 HTML，並與
`api_win_mat_level` 的 0/非0 pattern 逐筆交叉比對**全數一致**（見 `utils/expedition-data.ts`
檔頭註記）。這 20 筆與其餘 47 筆一樣正常顯示燃彈鋼鋁數字；`state.ts`／`panel/main.ts` 的
`amountsVerified` 分支邏輯予以保留（供之後若又出現條件已知但收益不明的新遠征使用），
只是目前沒有任何一筆會走到那個分支。

**itemtype 對照**：`rewardNames`（`state.ts` 的 `expedCheck()` 內）採 1＝高速修復材、
2＝高速建造材，與封包 `api_win_item` 的值相同。家具箱小／中／大在現行封包使用 10／11／12，
而 poi 2015–2018 快照仍使用 4／5／6；兩組必須同時相容。改修資材使用未占用的編號 7，避免與
舊資料的家具箱小（4）衝突。完整對照與來源寫在 `rewardNames` 旁的註解。

**id 165／166 是未確認資料**：這兩筆存在於 poi 資料裡（`reward_*` 全 0、
`required_shiptypes` 為駆逐2，與 33/34/301/302 同一種「支援任務」樣板），但**不存在於
目前的 `api_mst_mission` 快照**，無法確定是已停用／重新編號，或快照未收錄。因為 `expedCheck()`
只在 `masterMissions.get(expedId)` 查得到時才會用到 `EXPEDITION_DATA`，若遊戲從未送出
這兩個 id，資料不會造成錯誤顯示；在取得明確證據前保留原值。

### 遠征紀錄的期間彙總（`utils/expedition-stats.ts`＋`sections/exped-log.ts`，2026-07-24）

**現行行為**：遠征紀錄可依指定日期區間彙總資源總量與各遠征次數；逐筆資料仍保留供明細查閱。

**為什麼落在遠征紀錄而不是資源紀錄（別搬家）**：兩者的數字語意根本不同——

- 遠征收入是**逐筆事件的獲得量**（`api_get_material`，封包直接給、可加總、精確）；
- 資源紀錄的一切消長是**兩個時刻的餘額差分**（封包只給餘額）。

放同一張表必然被拿去互相對照，但中間還隔著出擊消耗、補給、建造、任務獎勵，本來就對不
起來。缺席規則也相反：期間內沒有餘額取樣時資源紀錄必須寫「不可考」，遠征收入只在
`db.expeditions` 已投影的紀錄中計算。分區頂端的 `ov.expedStatsNote` 就是在
講這件事，**不要因為「畫面太囉唆」把它拿掉**。

**兩個誠實性前提**：

1. **母集合是「已投影紀錄中的」遠征，不是遊戲的完整歷史**。`db.expeditions` 由面板的
   `EventProjector` 投影（資源序列才是 background 落地的例外）。面板未開時投影會延後；
   raw event 只有在投影成功且通過保護規則後才可裁剪，因此不能把未開面板直接等同於永久缺席。
2. **回航道具（`items`）的欄位語意未經真封包驗證**（待辦 8），故一律以 `id × count` 原樣
   彙總，不翻成「螺絲 N 個」，也**不併入四資源小計**。

**設計決定**：

- **期間捷徑的錨點是最後一筆紀錄、不是現在**（同資源紀錄的 `rangeBounds`）：久沒上線時
  以現在為錨會讓「7 天」一片空白，看起來像資料不見了。實際起訖一律寫在彙總列上，且**取
  的是實際落在期間內那幾筆的頭尾**，不是使用者選的那個窗（窗通常比資料寬）。
- **自訂日期只要填了任一端就蓋過捷徑窗**（另一端維持不設限），這樣「從某天以後」也是一次
  輸入就問得出來；此時捷徑鈕一律不亮，否則兩個控制項會同時看起來像正在生效。反過來按捷徑
  會清掉日期，否則按了沒反應。
- **「活動期間」捷徑**借 `resource-log.ts` 的 `buildEventPeriods()`（純函式）從
  `db.resourceMarks` 推出區段，直接回答「這次活動期間遠征賺了多少」。它只是捷徑：該表讀不到
  （v12 之前的舊安裝）就不顯示這個控制項，不影響彙總本身。
- **分組鍵是 `missionId` 不是名稱**（名稱隨語言與改版變動）；但 `missionId` 為 0 的舊紀錄
  只剩名稱可辨識，那批以名稱分組，不把互不相干的遠征全塞進同一列 `#0`。
- **摘要把大成功折進成功裡並寫明**（「成功 54（含大成功 10）」）：`共60 大成功10 成功54
  失敗6` 四個數字並排會被讀者加總（10+54+6≠60），但成功本來就含大成功。逐項比較留給彙總表
  的獨立欄位。
- **兩份 CSV 對應兩個問題**：彙總＝「哪些遠征各幾次、賺了多少」，明細＝逐筆紀錄且**跟著顯示
  欄位走**（同 ships／equipment 的規則）。兩者都是唯讀報表的匯出，**不是**可重新匯入的資料
  交換格式（那是 drop-log／build-log 的固定英文欄位集合），故表頭直接用目前語言的欄名。
- 分區**刻意不遵守「全量重繪」慣例**：有關鍵字與日期輸入框，整塊重繪會讓輸入框每打一個字
  就失焦。控制項只建一次、只重繪 `.el-body`，彙總表的排序走事件委派。

**驗證**：純函式以 `tests/expedition-stats.test.ts` 覆蓋（分組／加總／排序／CSV，含「壞資料
不得讓整個期間的小計變成 NaN」）；HTML 產出以 `tests/exped-log-overview.test.ts` 覆蓋。版面
另以 `playwright-core`（`channel:"chrome"`）實跑 `.output/chrome-mv3/overview.html`、用原生
IndexedDB 塞 60 筆假遠征紀錄驗證過期間切換／表頭排序／關鍵字篩選（含輸入框不失焦）與深淺
兩色主題。**已知殘留**：亮色主題下成功綠 `#7fd17f` 對白底偏淡——那是分區既有「遠征結果」欄
的色值，屬待辦 8 的「亮色主題細部調校」，未在此一併改動（改色需先跑 dataviz 驗證器）。

---

## 里程碑與進度（對照 docs/architecture-v1.md §9，2026-07-14 盤點）

| 里程碑 | 狀態 | 備註 |
|--------|------|------|
| **M1 管線打通** | ✅ | L1→L2→L3→面板事件檢視器（動態分頁）全通 |
| **M2 艦隊面板** | ✅ | 四艦隊/HP/疲勞/補給/裝備chip/艦種縮寫、遠征入渠倒數+通知、疲労回復通知（cond<49，回港時依 ceil(缺口/3)×3 分排 alarm）、遠征需求檢查、任務 |
| **M3 戰鬥監控** | ✅ | clean-room `battle.ts`（非嵌入 kc3bp.js）；敵聯合/航空/空襲/血量寫回/燃彈估算已實測；samples/ 為 fixture |
| **M4 載體完善** | 🔶 | popup 視窗✅；**劇場模式＋遊戲靜音✅**（見「劇場模式與遊戲靜音」；遊戲框的 Document PiP／獨立視窗**已確認規格上不可能**，會重載遊戲）；side panel 選配/面板本身的 Document PiP/視窗位置記憶/Firefox 打包**未做** |
| **M5 擴充覆蓋** | 🔶 | 基地航空隊✅、關卡量表+剩餘次數✅、TP✅、待驗證擷取✅、**出擊紀錄歸檔✅**（`db.sorties`＋「紀錄」分頁：rank/節點/制空/大破/掉落/基地空襲，永久保留）；自軍聯合/支援航空/開幕雷擊已用 61-5 甲驗證✅；命名特殊攻擊(Nelson/CI等)判定已涵蓋；**友軍艦隊✅**（61-3 甲 boss 夜戰驗證）；掉落統計彙總**未做**；**工廠分頁✅**（開發/建造/改修/高速完工皆已涵蓋＋`db.factory` 永久紀錄＋akashi-list 連結；`createitem`／`remodel_slot`（回應＋req，含成功/確実化/失敗）皆已用真封包完整驗證；**建造改吃 `api_get_member/kdock` 快照比對**（每個渠自帶 `api_item1-5` 真實投入量，不需要猜 `createship` 的 `req`——原猜測的 `api_large_flag`/`api_highspeed` 欄位已證實不存在於這個資料源）；`createship_speedchange`（高速建造材完工）消耗量已依使用者提供之遊戲設定實作：普通1個／大型10個（大型判定＝投入資源達 `LARGE_BUILD_MIN`＝1500/1500/2000/1000，非封包驗證，屬固定常數）**M5 工廠子系統至此全數完成** |
| **M6 事件裁剪** | ✅ | start2 與 safety prune 都先受 projection cursor（`meta['projection']` v3）限制：只刪已成功投影且不屬於 `KEEP_RECENT`／wanted 的 raw event；metadata 無效時停止裁剪。面板未開啟可令 derived tables 落後與 raw events 增長，但不會刪未投影資料 |
| **M7 圖示化** | ✅ | 漢字縮寫→原創 SVG 圖示（76 顆＝裝備 61＋資源 8＋UI 7：渠/建/遠征/艦數/裝備數/任務/空襲警報），達成多語系排版一致＋辨識；檔名即 `api_type[3]`，面板無對照表。飛機族 21 顆（有徽章）為真 3D 前左側俯視（仰角 32°，依 `samples/` 參照）；深色底明度下限為硬約束。全部原創、無第三方素材（授權義務已解除）。**全圖示帶描邊**（feMorphology 外輪廓，統一深墨 `#37302a`）——亮底暗底皆可讀，為亮暗主題切換的前提。生成器與設計約束見 `tools/icons/` |
| **M8 popup 選單＋鎮守府情報總括** | ✅ | popup／overview、語言與主題同步、艦隊、**艦娘全覽（詳細清單：十八個排序欄＋涵蓋參照圖全部條件的篩選抽屜＋分頁 10/20/50/100/全部＋CSV 匯出）**、**活動作戰板**、**裝備全覽（圖示篩選架＋圖磚／詳細清單雙模式＋逐顆實例展開＋CSV 匯出）**、**出擊紀錄（通常／活動分類＋一次出擊一張卡＋逐節點作戰資訊展開）**、**資源紀錄（一張大折線圖＋圖例開關＋活動區段消耗＋可選欄位詳細清單＋CSV 匯出）**、遠征／工廠紀錄、重播、LLM、備份皆已實作，**無 stub 分區**。overview 使用安全 snapshot baseline＋raw replay 建立唯讀 GameState；derived projection 仍由 panel 負責（資源序列例外——由 background 落地，見「資源紀錄」） |

### 目前資料界線與驗證限制

1. 基地空襲 `api_destruction_battle` 結構：61-5／61-3 樣本已見內部結構（`api_air_base_attack`
   `.api_stage1.api_disp_seiku`、`api_lost_kind` 見過 2 與 4），sorties 歸檔路徑對應正確；
   但頂層 key 名稱（logger 改叫 `airRaid`）與 `api_lost_kind` 各值語意仍需原始封包確認。
2. `samples/start2-master.json` 是去識別化的 master 子集（
   ship/slotitem/stype/slotitem_equiptype/shipupgrade/maparea/mapinfo/mission 八表，
   1751 艦＋741 裝備）。已藉此驗證 `api_slot_num`／`api_maxeq` 欄位名（不再是推測）。
   目前沒有足夠資料以 `api_mst_slotitem` 反查 60 顆 icon id 的實際裝備名，圖示機型假設仍未
   證實；**id 41「輸送機材」對應何物仍未證實**，56–60 的正式名稱仍為推定。
3. 節點字母使用 `utils/map-edge-letters.ts`（KC3Kai edges.json 產生，193 張海域），查不到
   的新活動海域顯示原始 edge 編號；資料更新後重跑產生器即可。
4. 燃彈的活動特殊點與大漩渦電探減免需要 `api_happening` 真實封包；目前不推算。
5. gaugeType 3（TP 輸送）量表欄位及新變種裝備需要輸送海域樣本；目前不推算。
6. **斬殺偵測的即時性仍未由樣本確認**（欄位判定已用真封包定案，見「雲端備份與重播裁剪」）：
   `detectClear()` 的「未擊破→擊破」兩端點皆已驗證（未通關 61-5 `now_maphp=809`、已通關
   61-4 `now_maphp=0/cleared=1`；`api_first_clear` 已排除當旗標）。唯一未觀測：**擊破當下遊戲
   是否即時推一筆 `now_maphp=0` 的 mapinfo**（或要等玩家再開圖才送）——只影響觸發延遲。
8. **M8 鎮守府情報總括的資料限制**：遠征紀錄回航道具（`api_get_item1/2`）欄位未經真封包驗證，
   best-effort 只顯示 id×count；
   PNG 匯出目前為純文字內聯樣式版（foreignObject 安全模式不載外部圖示，故不含 icon）。
8b. **活動作戰板的未驗證欄位**（見「活動作戰板」）：(a) 標籤 id 的實際語意；
   (b) 標籤名是否存在於任何封包（`findUnknownSallyKey` 鉤子命中即定案，查不到也是有效結論
   ——可據以確定「只能手動命名」並移除 `nameSource:'auto'` 的預留）；(c) `api_sally_flag`
   是否為出擊制限旗標。本文不把「標籤 ← 哪次出擊／哪條路線」的自動知識庫列為現行契約；該功能
   需要新的 derived table、`EventProjector` 投影邊界與已驗證的貼標時機，而目前只能在
   回港的 `api_port/port` 看到 `sally_area`，無法分辨是 `api_req_map/start` 當下就蓋章還是
   路線分歧後才決定）；以及出擊後偵測「貼錯標籤」的事後警示。
9. **劇場模式／靜音的實機驗證限制**（見「劇場模式與遊戲靜音」；已用合成 SPA 頁在真實 Chrome
   逐項驗過，但**沒有登入真正的 DMM 遊戲頁**）：(a) **遊戲框與遊戲畫布之間是否隔著跨源框**——若隔著，畫布量測
   會被 `e.source` 檢查擋下而退回「不裁切」（下方仍會留白底），補救方向見上節；
   (b) 艦これ Flight-IIA 的音訊實作是 WebAudio 還是 media 元素（兩條路徑都接了，但沒有樣本
   佐證，實機可用 `__kcAudio.contextCount()` 判斷）；(c) 是否有祖先層級的 stacking context
   造成版面偏移；(a) 可在遊戲分頁 console 跑
   `[...document.querySelectorAll('iframe')].map(f => f.src)` 看層數。
