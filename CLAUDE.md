# CLAUDE.md — fleet-chronometer

艦これ（KanColle）用的 MV3 監控擴充：攔截遊戲 `kcsapi` 封包，面板即時顯示艦隊/遠征/
入渠/基地航空隊/關卡進度，及**戰鬥預測**（終末HP、rank、MVP、大破警告）與燃彈估算。

技術棧：WXT + TypeScript + Dexie(IndexedDB)。純前端，無後端。
原始架構書見 `docs/architecture-v1.md`（含與現況的偏差摘要）；UI／圖示設計綱要見
`docs/design-guidelines.md`（色彩/字距/動效/元件量表，提出介面或圖示修改前先讀）；
進度見文末「里程碑」。

> **本檔是精簡版**（2026-07-24 拆分）：只留審查與日常開發必須遵守的硬約束、架構、
> 資料契約、已驗證封包事實與「別改回去」的既知陷阱。每個功能「為什麼這樣設計」的
> 完整敘事、UX 迭代歷史、使用者原話與曾被否決的方案，全部原封不動保留在
> `docs/engineering-log.md`（拆分前的完整 CLAUDE.md）——需要理解某條規則的來龍去脈
> 時才回去查，日常審查/開發不必載入。下方每小節末的「詳見存檔 §」可直接定位。

## 設計原則（硬約束）

1. **被動擷取**：只攔截遊戲自身流量，絕不重放/修改/代發請求（帳號安全紅線）。
2. **token 不落地**：`api_token` 在 bridge 層剔除，永不寫入 DB、不出境；不上傳任何資料。
3. **擷取與 UI 解耦**：資料落地於 SW 寫入的 IndexedDB 事件日誌；面板只是訂閱者+重放者，
   關閉期間不漏資料。SW 視為隨時會死，不持跨事件狀態。
4. **核心零瀏覽器依賴**：`utils/state.ts`+`battle.ts` 不含 `chrome.*`，可獨立編譯、
   用 node 餵真實封包測試（未來可拆包共用給 macOS app）。
5. **權限精簡**：安裝時的權限為 `alarms`+`notifications`+`scripting`+`activeTab`，且
   **host permission 一律為空**。`scripting` 不授予任何網站存取權；劇場模式/拍照需要的
   dmm.com 存取權走 `optional_host_permissions`，使用者按下按鈕才跳一次原生授權。
   `tests/manifest.test.ts` 常駐斷言 `host_permissions` 為空——WXT 對
   `registration: 'runtime'` 的 content script 會自動把 matches 塞進 host_permissions，
   `wxt.config.ts` 的 `build:manifestGenerated` hook 負責剝掉。任何新增權限都要有明確理由
   （已否決過的方案見存檔 §設計原則）。

---

## 建置與驗證

```bash
npm run build        # 產出 .output/chrome-mv3（瀏覽器「載入未封裝項目」指向此資料夾）
npm run dev           # 開發模式，產出 .output/chrome-mv3-dev（改動自動 rebuild）
npx tsc --noEmit     # 型別檢查
npx wxt prepare      # 生成 .wxt/ 型別（首次或型別報錯時）
npm test              # vitest 套件
```

改完 source 後須 rebuild ＋ 到 `chrome://extensions` 按擴充的重新整理鈕；
**已開著的遊戲分頁還要 F5** 才會重新注入 content script（MV3 通用限制，已決定不解）。

UI 版面離線預覽（真實封包資料＋overview 的同一份 CSS，不連遊戲）：

```bash
npx vite-node --config vitest.config.ts tools/preview/sortie-log.ts     # → .preview/sortie-log{,-light}.html
npx vite-node --config vitest.config.ts tools/preview/resource-log.ts   # → .preview/resource-log{,-light}.html
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
  ▼ hook fetch/XHR
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
  ▼ kc:live
panel/main.ts
  · 啟動：先以安全 snapshot baseline 建 state，再依 retained raw event ID 順序投影
  · EventProjector 對 cursor 前事件只建 state context，cursor 後才寫 sorties/factory/replays/
    expeditions；每筆 derived writes 成功才推進 projection cursor
  · 渲染即時監控分頁（general/sortie/exped/activity）＋艦隊＋基地航空隊
```

**Provider 合約**：`ApiEventRow`（`utils/db.ts`）是擷取來源與下游的正式邊界。MAIN world
interceptor 被動觀察 fetch/XHR，依序送出已去 `/kcsapi/`／`svdata=` 前綴的 path、原始
response text 與 request body；ISOLATED bridge 驗證同源訊息、移除 `api_token`／
`api_verno`，建立一次固定 envelope（UUID `captureId`、timestamp、path、req、`apiText`）後送
runtime message。retry **只一次**，且重用同一 envelope。background 才解析大型 `apiText` 成
`api_data`，並以 `source:'main'` 交 `ingestEvent()`。最終 row 不變量：path 已正規化、api 已
解析、req 無 token/verno；帶 captureId 的 events 以 unique index 去重，若同 captureId 的 path
或 timestamp 不同即拒絕 collision。**任何 provider 都不得繞過 `ingestEvent()` 直接寫
`db.events`**。單場 JSON 匯入／CSV 匯入是唯一的例外路徑（借 event ID、不寫 raw event，見下）。

### 反覆出現的設計慣例（跨分區適用，別在個別分區重新踩一次）

- **有關鍵字／日期／數字輸入框的分區，一律不能全量重繪**：整塊重繪會讓輸入框失焦、
  捲動位置與展開狀態被洗掉。適用：`ship-picker.ts`、`ships.ts`、`equipment.ts`、
  `sortie-log.ts`、`resource-log.ts`、`exped-log.ts`。做法：控制項只建一次（事件綁定
  一次），篩選/排序變更時只重繪結果區塊（`.xx-body` 之類的子容器）。
- **overview 分區一律先畫殼、再 await 資料**：`render()` 第一件事是塞 shell HTML 並綁好
  事件，**之後**才讀 DB。先讀後畫會讓「讀取卡住」（例如 Dexie 版本升級被其他分頁擋住）
  變成整個分區空白、連工具列都按不到，且看不出原因。`overview/main.ts` 的
  `renderSection()` 也用 try/catch 接住例外並顯示原因，任何分區的例外不得靜默留白。
- **折疊一律用原生 `<details>`**，不要用 `transform: rotate` 做展開箭頭——`rotate` 在
  `prefers-reduced-motion` 下要關掉，關掉後兩態長得一樣，狀態訊號就消失了。
- **缺席值不是 0、不是最小值**：排序時缺值一律放最後（不論升冪降冪）；統計算不出來
  （查詢範圍內沒有樣本）一律顯示「不可考」，不得以 0 或猜測值頂替。適用於資源紀錄的
  餘額差分、任務進度計數、艦娘全覽的排序等多處。
- **沒有真封包佐證的欄位語意一律回 null／顯示原始值，不猜**：本專案已被 API 格式坑過
  兩次（見「驗證原則」），節點字母、節點類型、活動札語意等多處因此改用查表或誠實
  顯示「不可考」而非算式推算。
- **語意色變數不可跨功能挪用**：大破/中破/小破色、札狀態色、資源增減色分屬不同語意，
  混用會互相稀釋視覺意義（design-guidelines §4.5）。

### 檔案職責

| 檔案 | 職責 |
|------|------|
| `wxt.config.ts` | manifest（permissions: alarms, notifications, scripting, tabs, activeTab；`optional_host_permissions` 為 DMM 遊戲頁）＋剝除 WXT 自動加上的 `host_permissions` 的 build hook |
| `entrypoints/interceptor.content.ts` | MAIN world 攔封包 + debug 擷取 ＋遊戲靜音 hook 安裝點（`installAudioMute`，須早於遊戲建立音訊圖，掛在 document_start） |
| `entrypoints/bridge.content.ts` | 轉發到 background，去 token；靜音狀態長連線（`runtime.connect`）；劇場模式互動意圖轉發（Alt+滾輪／Esc，一律 passive、不 stopPropagation）；關閉分頁前警示（`beforeunload`，manifest 靜態注入、無需權限） |
| `entrypoints/theater.content.ts` | 劇場模式（DMM 遊戲頁）：遊戲框放大到整個視窗、滾輪縮放、平移、隨時還原。動態註冊（`registration: 'runtime'`），不在 manifest 的 content_scripts 裡 |
| `utils/theater.ts` | 劇場模式的純函式核心（遊戲框辨識／縮放平移幾何／注入用 CSS），無 chrome.*、無 DOM 依賴，node 可測 |
| `utils/audio-mute.ts` | 遊戲框內音訊靜音的純安裝函式：把每個 `AudioContext` 的 `destination` 換成 master GainNode（＋media 元素路徑） |
| `utils/game-page.ts` | 遊戲頁相關共用常數（新遊戲網址、注入範圍、訊息型別），theater／bridge／background／popup 共用 |
| `entrypoints/background.ts` | `ingestEvent()`＝provider 合約唯一入口；以 `BackgroundIngestionLifecycle` 串行 recovery／ingestion，完成後才廣播、寫 snapshot、裁剪與排程通知；`MSG_CAPTURE_TAB` 經此轉手截圖 |
| `entrypoints/popup/` | 擴充圖示點擊後的快捷選單：開面板／開遊戲（DMM）／劇場模式／遊戲分頁靜音／開鎮守府情報總括分頁／拍照。**不提供另開或替換遊戲視窗**，避免產生第二個遊戲執行個體。劇場模式與靜音不關閉 popup |
| `entrypoints/overview/` | 「鎮守府情報總括」獨立分頁；艦隊、艦娘、裝備、活動作戰板、出擊、遠征、建造／開發／改修、資源、LLM、備份分區皆已實作（無 stub 分區） |
| `entrypoints/overview/ship-picker.ts` | 鎮守府全船篩選清單的共用 UI 元件（見「反覆出現的設計慣例」全量重繪陷阱） |
| `entrypoints/overview/sections/ships.ts` | 艦娘全覽：工具列＋篩選抽屜＋條件 chip 列＋詳細表格＋分頁。欄位開關／每頁筆數／排序／素質模式存 localStorage（`kc-ships-view`），不進 Dexie、不進備份 |
| `entrypoints/overview/sections/equipment.ts` | 裝備全覽：圖示篩選架（既有裝備圖示即篩選鈕）＋圖磚／詳細清單雙模式＋逐顆實例展開。模式／排序存 localStorage（`kc-equip-view`） |
| `entrypoints/overview/sections/sortie-log.ts` | 出擊紀錄：通常／活動兩大分類＋海域下拉＋單場 JSON 匯入，一次出擊一張卡（#第幾次・關卡代號・出擊編成・節點軌跡），展開才是編成／支援艦隊／基地航空隊／逐節點作戰資訊。分類存 localStorage（`kc-sortie-view`）。工具列＋匯入面板 markup 由 `shellHtml()` 提供，離線預覽共用 |
| `entrypoints/overview/sections/drop-log.ts` | 打撈紀錄：通常／活動分類＋新船／非新船篩選＋關鍵字／時間篩選＋分頁＋CSV 匯出入。CSV 邏輯全在 `utils/drop-log-import.ts` |
| `entrypoints/overview/sections/exped-log.ts` | 遠征紀錄：期間彙總（期間捷徑／自訂起訖日／活動期間捷徑＋四資源小計＋各遠征次數與收穫）＋可選欄位詳細清單＋分頁＋彙總／明細兩份 CSV。彙總核心在 `utils/expedition-stats.ts` |
| `entrypoints/overview/sections/build-log.ts` | 建造紀錄：可選欄位詳細清單＋分頁＋CSV 匯出入。匯入來源查不到 master id 時顯示 `FactoryLogRow.importedShipName`／`importedSecretaryName` |
| `entrypoints/overview/sections/event-ops.ts` | 活動作戰板：札總帳（自動）＋計畫疊層＋關卡表。直接讀寫 `db.eventPlans`——使用者手輸的攻略意圖、非從 events 投影的衍生資料 |
| `entrypoints/overview/sections/resource-log.ts` | 資源紀錄：最上方一張大折線圖（八項資材疊在同一張圖、圖例逐條開關、y 軸只依顯示中的序列縮放、十字準線）＋活動區段消耗＋詳細清單（表頭與欄位開關皆純圖示無文字）。控制項只建一次、只重繪 `.rl-body`；期間／粒度／欄位／分頁存 localStorage（`kc-resource-view`） |
| `entrypoints/overview/main.ts` | 側欄導覽＋hash 路由＋語言/主題套用；側欄三態（釘選／收合／浮層滑入，`body[data-nav]`）與側欄左右側（`body[data-nav-side]`，與三態正交）。窄視窗（≤760px）強制不釘選 |
| `entrypoints/overview/lib.ts` | `loadGameState()` 依 `planStateRecovery()` 選安全 snapshot baseline 再重播 raw events；overview 不投影、不寫 derived tables |
| `entrypoints/overview/fsa.ts` | File System Access API 封裝（零 manifest 權限的資料夾備份）：目錄選取、讀寫權限請求、寫檔；目錄 handle 存獨立原生 IndexedDB（`kc-fsa`，非 Dexie） |
| `entrypoints/overview/viewer-html.ts` | 離線 `viewer.html` 產生器（單檔、零擴充、零外連）：內聯 `toKc3Replay`，載入 `kanmusu-replays.json` 即可逐場複製 KC3Kai battleplayer 物件／開公開重播頁 |
| `entrypoints/panel/main.ts` | 面板控制器：以 `EventProjector` state-only/persist 兩階段重播與 live 投影、只在成功後推進 cursor、渲染與 autoSwitch |
| `utils/ui-prefs.ts` | UI 偏好持久化（語言＋亮暗主題，localStorage）——panel/popup/overview 共用；SW 不使用。`onPrefsChange()` 用 DOM `storage` 事件做跨頁即時同步 |
| `utils/replay.ts` | 出擊重播組裝（純函式，無 chrome.*）：`snapshotDeck`/`startReplay`/`appendBattle` 累積成 `ReplayRow`、`toKc3Replay()` 輸出 KC3Kai battleplayer 可貼上物件 |
| `utils/map-node-kind.ts` | 節點類型（`api_event_id`／`api_event_kind` → 資源／渦潮／能動分歧／空襲戰／敵連合…）。封包事實，語意轉寫自航海日誌拡張版（MIT） |
| `utils/map-node-letters.ts` | 節點字母查表（純函式）：`nodeLabel(map, edge)` 有對照給字母、沒有給原始 edge 編號。**兩種推算法皆已被真實資料否證**（見存檔「節點字母」），絕不可改回推算 |
| `utils/map-edge-letters.ts` | 上表的資料本體（193 張海域、5904 條 edge）。**產生物、勿手改**——改 `tools/map-edges/edges.json` 後重跑 `tools/map-edges/generate.py` |
| `utils/sortie-import.ts` | 單場出擊 JSON 匯入（解析／去重為純函式，落地為一個 Dexie transaction）：只吃 `toKc3Replay()` version 4 或既有 fixture 證實的 KC3Kai logger 格式。去重在 transaction 內做，命中即拋 `SortieImportDuplicateError` 並整個 rollback。event ID 向 events key generator 借（add→delete）但**不寫任何 raw event** |
| `utils/csv.ts` | CSV／TSV 最小共用解析與序列化（純函式） |
| `utils/drop-log-import.ts` / `utils/build-log-import.ts` | 打撈／建造紀錄 CSV 匯出入，借 event ID 寫入 derived tables（不寫 raw event，逐列去重不整批 rollback） |
| `utils/sortie-detail.ts` | 出擊紀錄「一次出擊」的重建（純函式）：`buildSortieDetail()` 把 `db.sorties` 摘要 × `db.replays` 原始封包合成逐節點作戰資訊。戰鬥細節直接餵 `battle.ts` 的 `analyzeBattle()`（與面板同一支） |
| `utils/resource-capture.ts` | 資源紀錄的擷取層（純函式）：`readMaterials()`／`readEventGauges()`／`captureResources()`。由 background 呼叫而非 EventProjector——資源序列不需要 GameState 上下文，價值在連續 |
| `utils/resource-log.ts` | 資源紀錄分析核心（純函式）：`normalizeSamples()`／`bucketSamples()`／`downsample()`／`buildEventPeriods()`／`toCsv()`。餘額是封包事實、消長是差分，算不出來一律回 null |
| `utils/line-chart.ts` | 折線圖幾何（純函式，無 DOM）：`multiChartGeometry()`／`niceTicks()`／`nearestIndex()`。y 值域只看傳進來的序列 |
| `utils/retention.ts` | 重播保留規則引擎（純函式）：`planRetention()` 依保護規則＋裁剪窗決定 `db.replays` 去留、`firstOwnedDropKeys()` 算新船場 |
| `utils/event-plan.ts` | 活動作戰板核心（純函式）：`groupBySally()`／`checkStage()`／`findPlanConflicts()`／`sallyBudget()` |
| `utils/ship-filter.ts` | 鎮守府全船篩選（純函式）：航速／艦種／國籍／可裝備／出撃札／關鍵字。由活動作戰板與艦娘全覽共用 |
| `utils/ship-nationality.ts` | 艦娘國籍（建造國）參照表，鍵＝艦型 `api_ctype`。遊戲 API 不提供國籍，人工維護；未列出的一律日本 |
| `utils/ship-roster.ts` | 艦娘全覽詳細清單的篩選／排序／分頁核心（純函式）。先制對潛是全檔唯一的推算值（遊戲不送旗標） |
| `utils/gear-inventory.ts` | 裝備全覽的彙總／篩選／排序核心（純函式）：`groupGears()` 把裝備實例依 master 彙總成種類。素質一律是 master 基礎值、**不含改修 ★ 加成** |
| `utils/repair.ts` | 泊地修理（工作艦）＋母港給糧（補給艦野埼）的涵蓋範圍與結算預估（純函式）：`planAnchorageRepair()`／`planMoraleSupply()`／`nextSettlementIn()` |
| `utils/quest-progress.ts` | 任務「本機進度」推算（純函式）：`parseQuestGoal()` 從任務標題反推目標次數與動作種類 |
| `utils/state.ts` | `GameState`：封包 reduce 成狀態；遠征檢查、制空/索敵、戰鬥接線、血量寫回、燃彈估算、關卡量表、TP、`wantedTag`、泊地修理計時器錨點、任務進度計數 |
| `utils/battle.ts` | `analyzeBattle`（傷害重放）+ `predictRank`（勝利判定） |
| `utils/screenshot.ts` | 拍照的純函式核心：`cropRectPx()`／`downloadCroppedScreenshot()` |
| `tests/` | vitest 套件（`npm test`），檔名對應被測模組 |
| `utils/db.ts` | Dexie schema **v12**：stores 為 events、wanted、sorties、notified、factory、replays、expeditions、snapshot、shipObtained、eventPlans、resources、resourceMarks、meta；events 的 `captureId` 為 unique index，並有 `postProcessState` |
| `utils/ingestion-persistence.ts`／`utils/background-ingestion-lifecycle.ts` | raw event 持久化、captureId 去重與 collision 拒絕、pending/processing/done 狀態機，SW recovery 的單一順序 queue |
| `utils/event-projector.ts`／`utils/projection-cursor.ts`／`utils/event-pruning.ts` | derived-table 投影、`meta['projection']` version 3 cursor，只刪已投影 raw event 的安全裁剪 |
| `utils/ship-debut-data.ts` | 艦娘「官方登場日」參照資料，鍵＝基礎形態 master id。**產生物、勿手改**——改 `samples/ship-debut-dates.json` 後重跑 `tools/ship-debut/generate.py` |
| `utils/expedition-data.ts` | poi 遠征需求資料（MIT，見 NOTICE） |
| `utils/expedition-stats.ts` | 遠征紀錄期間彙總核心（純函式）：`filterByPeriod()`／`summarize()`／`groupByMission()`／`statsCsv()`。收入是逐筆事件獲得量，不是餘額差分 |
| `public/icons/**.svg` | 裝備／資源／UI 圖示（原創向量，**由 `tools/icons/` 產生，勿手改**）；裝備檔名即 `api_type[3]` |
| `tools/icons/` | 圖示生成器＋設計約束，改圖示前先讀其 README |
| `samples/` | 真實封包樣本（驗證 fixture）＋機體／UI 參照圖。**PII 已於 2026-07-24 清除**（`slot_to_port.json` 的 member_id/暱稱/時間戳/贅言已匿名化，5 個無引用截圖已刪除） |
| `docs/architecture-v1.md` | 原始架構書（設計對照基準） |
| `docs/design-guidelines.md` | UI／圖示設計綱要 |
| `docs/engineering-log.md` | 本檔精簡前的完整內容，含每個功能的完整決策脈絡 |

### Handoff：持久化、投影與發布契約（以程式碼／測試為準）

**IndexedDB v12**：object stores 為 `events`（`++id, ts, path, &captureId, postProcessState`）、
`wanted`、`sorties`、`notified`、`factory`、`replays`、`expeditions`、`snapshot`、
`shipObtained`、`eventPlans`（v11 新增，主鍵 `areaId`）、`resources`／`resourceMarks`（v12
新增，主鍵分別為來源 event id／字串 key）、`meta`。**不回填歷史** `captureId`／
`postProcessState`／projection metadata／餘額序列；歷史 events 因而不是可恢復的
post-processing 工作，缺／未知／損壞 projection metadata 則從 retained raw events 的 0 重投影。

**Capture／ingestion lifecycle**：MAIN world interceptor 被動觀察後，經 ISOLATED bridge 移除
token／verno，以固定 `captureId` envelope 送往 background；同一 envelope 的一次 retry 仍用
同一 captureId。background 才解析 `apiText` 並透過 `ingestEvent()` 寫入，任何 provider 都不得
直接寫 `db.events`。新 event 必先保存為 `pending`；同 captureId 只允許相同 path 與
timestamp，否則 collision 拒絕。取得 transactional claim 才轉 `processing` 並執行廣播、
snapshot、通知、pruning 等副作用；成功標 `done`，失敗歸還 `pending`。SW 啟動時先將帶
captureId 的遺留 `processing` 歸還 `pending`，再按 event ID recovery；新 ingestion 與
recovery 共用 promise queue。通知使用固定 notification ID，snapshot 與 derived rows 使用
冪等寫入。

**Projection boundary**：`EventProjector` 是四張 derived tables 的入口。投影成功一筆才推進
projection cursor；safe pruning 只刪已投影的 retained raw events，metadata 無效時停止裁剪。
`snapshot` 僅是 GameState baseline，絕不可送入 projector。

**單場 JSON／CSV 匯入不是 raw ingestion**：在 transaction 內寫入 derived tables，借用 events
key generator 後立即刪除 reservation，**不寫 raw event**。去重規則各自見對應檔案職責列。

**v1 產品識別**：package 為 fleet-chronometer 1.0.0，權限 `alarms`、`notifications`、
`scripting`、`activeTab`。品牌名走 i18n（`public/_locales/{en,ja,zh_TW}/messages.json`），
manifest 只放 `__MSG_extName__`／`__MSG_extShortName__`／`__MSG_extDescription__`
（`default_locale: en`）；頁面標題另由 panel/popup/overview 執行期以 `ov.brandShort` 改寫
`document.title`，兩份必須逐語言一致——`tests/manifest.test.ts` 常駐把關。
**`popup/index.html` 的 `<title>` 是 load-bearing 佔位字串，別改成實際名字**：WXT 會把它
寫進 manifest 的 `action.default_title` 並蓋過 `wxt.config.ts` 設定，改成實際名字會鎖死
tooltip 語言。

`GameState.applyEvent(path, api, req, ts = Date.now())` 是核心：一個大 if-else 依 `path`
更新狀態；EventProjector 與 state recovery 必須傳入原始 `event.ts`，live 呼叫未傳時才使用
預設現在時間。面板純讀 `GameState` 渲染。

### 各遊戲介面對應的 kcsapi path（實測，2026-07）

| 介面 | path | 介面 | path |
|------|------|------|------|
| 母港 | `api_port/port` | 工廠 | `api_get_member/preset_dev_items` |
| 遠征 | `api_get_member/mission` | 改修（明石） | `api_req_kousyou/remodel_slotlist` |
| 入渠 | `api_get_member/ndock` | item課金 | `api_get_member/payitem` |
| 編成 | `api_get_member/preset_deck` | 圖鑑 | `api_get_member/picture_book` |
| 改裝 | `api_req_kaisou/can_preset_slot_select` | 任務 | `api_get_member/questlist` |

`autoSwitch` 接線：`api_port/port`→一般、`api_req_map/start`/戰鬥→出擊、
`api_get_member/mission`/`api_req_mission/start`→遠征、`api_get_member/questlist`→一般、
`api_get_member/preset_dev_items`/`api_req_kousyou/remodel_slotlist`/工廠操作→工廠。
補強增設裝備是獨立端點 `api_req_kaisou/slotset_ex`（無 `api_slot_idx`，已實測）。

---

## 戰鬥預測子系統（重點）

流程：戰鬥封包 → `state.ts` 呼叫 `analyzeBattle()` → `battleInfo` → `renderSortie()`；
`battleresult` 補確定 rank 與掉落。戰後血量寫回 `this.ships`，燃彈依費率表估算。
完整決策脈絡見存檔 §戰鬥預測子系統。

### 現行遊戲 API 格式（血淚換來的關鍵知識，別再猜）

- **血量**：`api_f_nowhps`/`api_f_maxhps`（我方主隊）、`api_e_nowhps`/`api_e_maxhps`
  （敵主隊）、`*_combined`（隨伴）。**皆 0-indexed、無 leading -1**（舊版單一
  `api_nowhps`=`[-1,我1..6,敵1..6]` 已不送）。
- **砲擊/夜戰**（`api_hougeki1/2/3`、`api_hougeki`）：`api_at_eflag[i]` 分攻擊方
  （0=我,1=敵），`api_at_list`/`api_df_list` 索引為各方局部 0-5（主）/6-11（隨伴）。
- **雷擊**（`api_raigeki`）：`api_fdam`/`api_edam`=受傷、`api_fydam`/`api_eydam`=造成
  傷害（MVP 用）。damage 可能帶小數，需 floor。**聯合艦隊開幕雷擊陷阱**：
  `api_opening_atack` 的造成傷害欄改叫 `api_fydam_list_items`／`api_eydam_list_items`
  （每格 null 或陣列），不是 flat 的 `api_fydam`／`api_eydam`；漏讀會少算開幕雷擊 MVP 貢獻。
- **航空/基地/噴式**：`api_stage3`=對主隊、`api_stage3_combined`=對隨伴（索引+6 對映）。
  漏算隨伴會 rank 誤判（已用 6-5 封包實證：漏算→A、正確→S）。
- **敵艦 id**：`api_ship_ke`（主）、`api_ship_ke_combined`（隨伴），0-indexed、無 -1。
- **陷阱**：`'...battleresult'.startsWith('...battle')` 為 true——戰鬥分支必須
  `!path.endsWith('result')`，否則結算封包被誤吞、battleInfo 洗空。
- **自軍聯合艦隊**：已用真實 61-5 甲自軍水上部隊封包驗證，主隊/隨伴血量歸屬、局部
  0-11 索引、MVP、rank 皆與 logger 記錄完全一致。
- **友軍艦隊**（活動海域 boss 夜戰）：`api_friendly_info`＋`api_friendly_battle` 為夜戰
  封包 top-level 欄位。`processFriendlyHougeki` 只扣敵 HP（eflag=0 時 df_list 為敵方位置），
  eflag=1（敵方反擊友軍）不影響玩家艦——已用真封包數字逐筆核對，另用極端值驗證不會誤傷
  玩家艦或誤觸大破警告。`processFriendlyRaigeki`（僅讀 `api_edam`）尚無真封包樣本，屬
  防禦性預留。

### 特殊攻擊的傷害歸屬（不是公式問題，是欄位問題）

`analyzeBattle` 不計算傷害——傷害是伺服器算好包在封包裡的數字，我們只負責歸屬與加總，
與命中率/暴擊/裝甲穿透公式無關；唯一風險是「某特殊攻擊把傷害放進沒讀的欄位」。

| 特殊攻擊 | 狀態 |
|---------|------|
| 對潛先制爆雷 | ✅ 已涵蓋（`api_opening_taisen` 走通用陣列） |
| 彈著觀測射撃／空母戰爆連合CI／夜戰CI | ✅ 已涵蓋（讀最終 `api_damage`，不管倍率怎麼來） |
| 噴式強襲 | ✅ 已涵蓋（`api_injection_kouku`） |
| 支援艦隊（對敵） | ✅ 航空(61-5)＋砲擊(61-3)支援兩種欄位路徑皆已驗證 |
| 友軍艦隊 | ✅ `api_hougeki` 已驗證（61-3 甲 boss 夜戰）；`api_raigeki` 未經真封包驗證 |

### 勝利判定 `predictRank`（clean-room 重寫，已用真實資料校準）

損害率 = (開戰殘HP合計 − 現在殘HP合計) / 開戰殘HP合計。由上而下：

1. 敵全滅＋我無轟沈 → `S`（不吐 SS）
2. 敵全滅（我有轟沈）→ `A`（edge 未實測）
3. 我無轟沈＋敵數>1＋敵沉 ≥ `floor(敵數×0.7)` → `A`（**floor 非 ceil**，1-1 boss 實證）
4. 敵損害率 > 我×2.5 → `B`；5. 敵損害率 > 我×0.9 → `C`；6. 其餘 → `D`

### 出擊燃彈消耗費率（依 path＋海域套用）

途中封包不帶燃彈實數，按節點類型估算，回港 `api_port/port` 實數校正。每戰獨立、切捨、
**0<x<1 進位為 1**。**寫回時機**：戰鬥封包只暫存費率（`pendingConsumption`），HP 照常即時
寫回；燃彈延到 `battleresult` 才一併扣（`applyConsumption`）。結婚艦 −15% 不影響途中油量計。

**隨伴艦隊判定必須看封包**（`GameState.hasEscortFleet(api)`）：只有連合艦隊出擊的封包才帶
`api_f_nowhps_combined`，故以該欄位存在與否為唯一證據；`currentSortieFleetId === 0` **不能**
拿來判斷隨伴（第1艦隊單獨出擊時同樣是 0）。已用兩份真封包回歸驗證。

| 節點 | 判斷 | 油 | 彈 |
|------|------|----|----|
| 普通晝戰 | 其餘 `.../battle`、`ec_battle` | 20% | 20% |
| 夜戰接續 | `battle_midnight/battle` | +0% | 補到 ceil(晝彈×1.5) |
| 開幕夜戰 | `sp_midnight` | 10% | 10% |
| 航空戰(雙向) | `airbattle`(非 ld_) | 20% | 20% |
| 空襲戰(單向) | `ld_airbattle`＋6-4/6-5 | 4% | 8% |
| 空襲戰(單向) | `ld_airbattle` 其他(5-2/7-2/活動) | 6% | 4% |
| 反潛點 | 敵主隊全潛水(stype13/14)；boss(color=5)與4-1/4-3例外仍20/20 | 8% | 0% |

> 未涵蓋：活動特殊點按普通處理；大漩渦電探減免待封包。

### 關卡進度與剩餘次數（`api_get_member/mapinfo`，已實測驗證）

- `api_map_info[]`：`api_cleared`、`api_gauge_type`（1=擊破數式；2=HP量表式）。
- 面板一律顯示「剩餘」語意；`maxHp=9999` 為「尚未選擇難度」佔位，非真實滿血。
- **gaugeType 2 擊破機制**：量表每場依「對 boss 旗艦傷害」遞減；進入最終段（殘量 <
  boss 旗艦 HP）後傷害不會打到 0——會 floor 在 1；**唯有實際沉沒 boss 旗艦，量表才真的變
  0＝通關**。`now_maphp===0` 在機制上唯一等價於「這場斬殺成功」，是精確判定；`===1` 正確
  留在「未通關」。`api_first_clear` **不可當斬殺旗標**（語意與直覺相反：未通關時存在）。
- 剩餘次數：gaugeType 2 = `ceil(殘HP/boss旗艦HP)`；gaugeType 3(TP) =
  `ceil(殘量/艦隊基本TP)`，`fleetTP()` 依 wiki 表計算（**但 gaugeType 3 量表欄位缺真實封包**）。

### 出擊重播（KC3Kai battleplayer 相容，`utils/replay.ts`＋`db.replays`）

`toKc3Replay()` 輸出格式：頂層 `{fleet1, fleet2, fleetnum, combined, battles:[{node,data,yasen}],
world, mapnum, diff, time}`；**每個 `battles[i].data` 是一則原封不動的原始 kcsapi 戰鬥封包**。
ship 欄位用 KC3Kai 命名，stats 由 battleplayer 自算不帶。擷取判別：夜戰＝path 含 `midnight`
但排除 `sp_midnight`；`battleresult`＝補 rank 到最後節點。面板中途才開啟（沒看到
`api_req_map/start`）則無從快照艦隊，該次出擊不留重播。

### 出擊紀錄的展開檢視（`utils/sortie-detail.ts`＋`sections/sortie-log.ts`）

一次出擊一張卡：摺疊列兩行（#第幾次・關卡代號・出擊編成成員 ／ 節點軌跡＋結果標記），
展開才給細節（出擊編成／支援艦隊／基地航空隊／逐節點，各自可獨立折疊，一律用
`<details>`）。與 KC3Kai 參照圖的差異：節點字母走對照表；「基礎經驗值」不在遊戲封包裡
（只有 KC3Kai 匯入紀錄才有）。

為此擴充的擷取層欄位（皆為 optional、非索引，不需升 schema 版本，皆已用真封包驗證）：
`SortieLogRow.getExp`（battleresult `api_get_exp`）、`mvp`／`mvpEscort`（`api_mvp`／
`api_mvp_combined`，**1-based**，確定值非預測值）、`enemyName`（`api_deck_name`）、
`baseExp`（僅 KC3Kai 匯入紀錄才有）、`nodeEventId`／`nodeEventKind`（存原始值不存推導標籤）、
`ReplayRow.fleet3`／`fleet4`（支援艦隊快照，出擊當下拍）、`ReplayRow.lbas`（出擊當下同海域
全部基地航空隊）。

**道中支援／決戰支援**：以「該支援有沒有在 boss 節點出動」判定，不看 deck 編號。
**連合艦隊編成類型**：`api_combined_flag` 1＝空母機動部隊／2＝水上打撃部隊／3＝輸送護衛
部隊；`combined===0` 但主隊 7 艘＝遊撃部隊（司令部才做得到，封包事實非猜測）。

**`api_air_base_attack` 是陣列**，一波一個元素（`api_base_id`／`api_squadron_plane[]`／
`api_stage1.api_disp_seiku`）。⚠️ **基地「防空」的 `api_destruction_battle.api_air_base_attack`
是物件不是陣列**，兩者同名不同形，`lbasWaves()` 只認陣列。`api_support_info` 的
`api_support_airatack`／`api_support_hourai` 擇一非 null；`api_ship_id` 是艦實例 id 不是
master id，查不到艦名顯示 `#id`。

**單場 JSON 匯入**只接受 (a) 本專案 `toKc3Replay()` version:4 或 (b) KC3Kai logger fixture
證實的格式，其他一律拒絕。重複判定：海域＋戰鬥節點序列完全相同＋±10 分鐘邊界；雙方都有
封包時比對完整原始封包（物件 key 排序後 FNV-1a），否則才用時間 fallback；判定在 transaction
內做，命中即整個 rollback。event ID 向 generator 借（add→delete）但不寫 raw event。
**KC3Kai 對「沒有夜戰的節點」寫 `"yasen": {}`**（空物件仍是 truthy）——判準改為「至少有一個
`api_` 開頭的欄位」（`hasPacket()`）。KC3Kai 結算鍵名對照：`rating`→`rank`（SS 正規化為
S）、`drop`→`dropMst`／`drop`、`mvp`→`[主隊,隨伴]`（1-based）、`hqEXP`→`getExp`、
`baseEXP`→`baseExp`。

節點標籤走 `utils/map-node-letters.ts` 的查表；有對照顯示字母、沒有顯示原始 edge 編號，
**絕不推算**（兩種推算法皆已被真實資料否證，見存檔「節點字母」）。

---

## 子系統速查

以下各節只列**已驗證事實／公式／欄位名**與**明確的「別改回去」guardrail**；完整決策脈絡、
UX 迭代歷史與使用者原話一律見 `docs/engineering-log.md` 對應同名章節。

### LLM 分析子系統（`entrypoints/overview/sections/llm.ts`）

三條路徑皆避開新增網路權限：(1) **通用備份檔**——`buildFullReport()` 產生 Markdown
（複製/下載，零網路零權限），出擊依海域分組統計（非全域統計＋固定筆數列表）、裝備依種類
彙總持有量＋改修分布（非逐顆列舉）；(2) **MCP 掛載**——純文件提示，指引使用者把下載資料夾
指給支援 MCP 的用戶端，整個流程在擴充之外，不影響權限設定；(3) **Chrome 內建 AI**（Prompt
API／Gemini Nano）——裝置端零網路零出境，`prompt-api.d.ts` 特徵偵測。已知限制：官方語言
清單不含繁中；只餵 `buildQuickContext()` 精簡摘要避免超出 context window；
`promptStreaming()` 分塊語意在不同版本不同，用
`chunk.startsWith(acc) ? chunk : acc + chunk` 防禦寫法涵蓋兩種語意，**不要改回單純 `+=`**。

### 母港快照與資料備份還原

`db.snapshot`（schema v7 引入）不受 M6 裁剪影響，`path` 為主鍵、每個 path 只留最新一筆。
`SNAPSHOT_PATHS`：`api_start2/getData`（master 表唯一來源）、`api_port/port`、
`api_get_member/require_info`／`slot_item`、`api_get_member/base_air_corps`／`mapinfo`。
`planStateRecovery()` 只在 raw events 為空時採用 legacy snapshot；raw events 存在時僅採用
`eventId` 嚴格小於第一筆 retained raw event ID 的 snapshot 作 baseline。

**現行備份契約 v5**：restore envelope 含 `snapshot`／`sorties`／`expeditions`／`factory`／
`wanted`／`shipObtained`／`eventPlans`／`resources`／`resourceMarks`；replays envelope 只含
`replays`。每個 schema 版本的 restore 表組合各自固定（`determineKind()`），舊檔不因缺少後來
新增的表被拒，新檔也不得少帶或夾帶。**匯入不是 merge，也不會警告後覆寫**：第一次僅接受
沒有 raw events、notified、projection metadata、目標 rows 的乾淨環境；後續只有
`meta['backup-restore']` marker 證明的 complementary split file 可接續。validation、
destination preflight、所有 writes、event-ID sequence reservation／high-water 與 import
marker 在同一 transaction，任一失敗完整 rollback。

**雲端備份走 File System Access API**（`entrypoints/overview/fsa.ts`），不碰新權限（Google
Drive／WebDAV 原生 API 需 OAuth／host_permissions，違反權限精簡）。備份拆兩檔：
`kanmusu-restore.json`（重建現狀最小子集，永遠很小）／`kanmusu-replays.json`（重播層，隨
出擊數線性膨脹，可獨立裁剪）。資料夾備份一併寫入 `viewer.html`——單檔離線、不需要擴充。

**重播保留規則**（`utils/retention.ts`）：保護判定由上而下——手動 ★ 釘選 → 打撈到新船
（`firstOwnedDropKeys`，須 `source='auto'`＋`observedEventId`）→ 斬殺 → 活動 boss → 所屬海域
尚未通關；皆非則只留最近 `keepRecentDays`（預設 45）天且保底最近 `keepRecentCount` 場。

**斬殺（cleared）偵測**：`detectClear()` 在 mapinfo 更新後比對量表，觀測到「未擊破→擊破」
就把該圖最近一場 boss 出擊標 `cleared`；只在「本次事件流曾看過該圖未擊破」時才判定轉變。
唯一未驗證：擊破當下遊戲是否即時推一筆 `now_maphp=0` 的 mapinfo（只影響觸發延遲不影響判定）。

### 泊地修理與母港給糧（`utils/repair.ts`）

**遊戲完全不送這兩個機制的封包**——一律是預估，UI 必須標示。master 常數（已用真封包驗證）：
艦艇修理施設＝86；明石 182／明石改 187／朝日 953（stype 21）／朝日改 958（**stype 19**，
改造前後 stype 會變）／野埼 996／野埼改 1002。

**涵蓋艦數**：`（1、2號位工作艦基本數合計）+（該兩艦裝備的艦艇修理施設數合計）`，基本數：
明石／明石改 2、朝日改 0（誰都不修）。**加速**：1、2 號位皆工作艦且 2 號位至少帶 1 個吊車，
倍率約 5/6≈83.3%（估算）。**HP 預估**用 `api_ndock_time`（每1HP時間 = ndock_time / 損傷HP），
`τ < t` 時強制回復 1HP，否則 `H = floor(τ/t)`。**中破以上不修，且被跳過的位置不由後面遞補**。

**計時器錨點**（`repairAnchorByDeck` 20分／`moraleAnchorByDeck` 15分，兩個機制週期不同故
各存一份）：重置＝`api_req_hensei/change`（非 -2）改動該隊成員、出擊/遠征後回港；**刻意不
重置**＝`preset_select`、`change` 的 `api_ship_id=-2`、僅換裝備、其他艦隊操作（既知
bug feature）。進母港時推進：出門中隊回港後重新起算，已跑滿一週期者視為已結算並推進到下一輪。
`applyEvent` 第 4 參數 `ts` 是核心——replay 必須帶原始 `event.ts`，否則錨點被重播時間污染。
**誤差緩衝**：倒數向上取整再加 1 分鐘（`TIMER_SAFETY_MS`）。

**野埼給糧**：須在 1/2 號位，自身需補給完了、小破未滿、cond≥30、非遠征/入渠；每 15 分回復
同隊除自己外全員 cond（野埼+2／改+3，上限 **54**），每艘實際回復消耗燃料 1。可與泊地修理併用。

**尚未實作**：背景 alarms/notifications 提醒；緊急泊地修理（連合艦隊出擊中機制，相關封包
欄位未經真封包驗證）。

### 任務本機進度追蹤（`utils/quest-progress.ts`）

**核心限制**：`questlist` 只給 `api_state`／粗略 `api_progress_flag`，不給精確完成次數。
進度永遠是「自本機面板第一次看到這個任務起算」，可能低於遊戲內實際值（UI 帶 title 提示）。

`parseQuestGoal()` 只認得出「N回」字樣（正規化全形數字，找 `(\d+)回`）；「近代化改修」
必須排在「改修」關鍵字之前判斷，否則會被裝備改修搶先命中。以「隻」為單位的批次條件原則
不支援，**唯一白名單例外**：入渠任務「N隻」（已用 KC3Kai 原始碼交叉驗證，機制上是逐次
入渠請求計數，非同時湊到 N 艘）。

十四種可累加動作各自掛在既有 event 分支上（`GameState.bumpQuestProgress()`）：`sortie`／
`expedition`（`api_clear_result>=1`）／`build`／`development`／`supply`／`dock`／
`modernization`／`remodel`（`api_remodel_flag===1`）／`remodelAttempt`（不論成敗）／
`practiceAttempt`／`practiceWin`（演習結果端點路徑與判定**尚未經真封包驗證**，僅依社群
慣例推定，不影響戰鬥預測主邏輯）／`battleWin`（rank S/A/B）／`battleEngage`（不論勝敗）／
`shipScrap`／`gearScrap`（逐艘/逐個計數，非逐次請求）。

**id 白名單優先於文字解析**：任務 210「10回邀撃」內文同時含「10回」與「出撃」，文字解析
會誤判成 `sortie`；改為 id 白名單優先，查不到才退回文字解析（`QUEST_ID_OVERRIDES`，
`tests/quest-progress.test.ts` 有測資鎖住）。目前已收錄約 21 個 id（含海域/boss/rank 限定與
遠征任務 id 限定），area 用既有 mapKey 慣例、boss 用既有 `color===5` 判定、missionId 查表
沿用 `lastMissionByDeck`。**尚未做**：敵艦種擊沉數計數（8筆待新機制）、指名艦娘/艦型編成
比對（日週月約6筆＋年常55筆，全數複合條件，待新機制）——這兩類需要全新偵測機制，其餘
帶複合條件的任務只記錄不實作（`QUEST_SPECIAL_CONDITIONS`）。

進度只在「本機第一次看到該任務編號」時初始化，不會被之後的 questlist 封包洗回 0；任務從
清單消失即刪除追蹤，同編號任務重新出現則重新從 0 起算。

### 活動作戰板（`utils/event-plan.ts`＋`sections/event-ops.ts`）

**機制前提**：札是船身屬性非編成容器，一艘船同時只有一個札、貼上不可逆；貼標時機是出擊，
由「關卡＋路線」決定，`api_sally_area` 是唯一權威；`allowedTags`（哪些札能走這條路線）與
`grantsTag`（無札船走這條路線會被貼上什麼札）是兩件不同的事；札 id 全活動唯一只增不減，
故一次活動一份計畫（`db.eventPlans` 主鍵 `areaId`）。

三層結構：Layer 1 札總帳（從 `api_sally_area` 即時分群，零輸入且權威）→ Layer 2 計畫
（手輸）→ Layer 3 檢查（純函式）。**燈號語意**：`ok`＝已持有本關允許的札；`blocked`＝持有
別的札走不了；`willStamp`＝**無札船即將被不可逆消耗**（非「安全可調度」）；`allowedTags`
未填一律 `unknown`，**不可判紅**。**計畫矛盾**分 `certain`（用 `grantsTag` 推定）與
`possible`（允許札有交集）兩級。

**「計畫」與「現實」是兩個維度必須並排顯示**（曾被使用者回報三次以為是 bug）：札總帳每列
並排「實際」（`api_sally_area`）與「計畫」（`plannedByTag()`，只認 `grantsTag`）兩欄；計畫欄
要列出已被實際貼標的艦並標警示（`pending`/`fulfilled`/`conflict`）。`plannedByTag()`
**刻意不去重**（同艦排進兩個關卡要在兩邊都看得到）；計數用 `sallyBudget()`（那支有去重）。

**實際貼標觀測**（`observeGrantedTags()`）：只認 `0→N` 的轉變，`N→M` 不採信（更可能是漏收
封包）；只警示＋一鍵套用，**絕不自動覆寫**；使用者按「套用」時不受鎖定限制。

**鎖定規則**：標籤一旦「已確立」（實際已有船帶著它），其名稱與牽涉該標籤的關卡之
`allowedTags`／`grantsTag` 即轉為唯讀，活動結束後使用者明確按「解除鎖定」才可再編輯。

`mapKey = areaId * 10 + mapNo`；`api_mst_maparea[].api_name`＝活動標題，
`api_mst_mapinfo[].api_name`／`api_opetext`＝海域名／作戰名，存進
`GameState.masterMapInfo`。抓得到 master 時關卡列＝遊戲海域清單、不可由使用者建立/刪除。
`reconcileStages()`（純函式）改版不得丟資料：有 mapNo 照 mapNo 對應、沒有的用
`guessMapNo(label)` 反推、對應不上但填過東西的列保留在末尾。

**未驗證**：札 id 實際語意（樣本皆非活動期，值全 0）；札名是否存在於任何封包（`nameSource`
的 `'auto'` 分支預留但目前不會被寫入，UI 一律手動命名）；`api_sally_flag` 是否為出擊制限
旗標。驗證鉤子已埋在 `wantedTag`，下次活動自動撈。

### 鎮守府全船篩選（`utils/ship-filter.ts`）

**可裝備篩選已用真實完整 start2 驗證**：`api_mst_equip_ship` 是「完整覆蓋」不是「追加」——
有例外條目就用它，否則回退 `api_mst_stype[].api_equip_type`。**絕不能只看艦種**：
`api_mst_stype[2].api_equip_type['24']` 是 0（駆逐艦不能裝大發），但實際有 41 艘驅逐艦裝得了
大發系（例外條目覆蓋）。類別 id：24 上陸用舟艇（大發系）／34 司令部施設／45 水上戦闘機／
46 特型内火艇；type 24 值實測全部是 null（整個類別可裝）。

七選項下拉＝兩個布林組合，已對全 1751 艦驗算：大發系 96／內火 199／二者皆可 62／僅大發
34／僅內火 137／二者任一 233／皆不可 1518。**航速**：`api_soku` 只有 `{10:高速, 5:低速}`
兩檔已見樣本，篩選用「>=門檻」不列舉。**「高速戦艦」不是艦種**：`api_mst_stype` 的 8/9
都叫「戦艦」，高速/低速要靠 `api_soku` 合判。**補強增設**：`api_slot_ex` 三態
`0`=無孔／`-1`=有孔未裝／`>0`=已裝。可裝備規則（`api_mst_equip_exslot_ship` 等三張表）
尚未解讀應用。

### 艦娘全覽（`utils/ship-roster.ts`＋`sections/ships.ts`）

十九個排序欄位，**缺值一律排最後**（見「反覆出現的設計慣例」）。裝備欄一律畫滿真實槽數、
空槽畫虛線空框；補強增設無孔時整格不畫。

`OwnedShipView` 欄位皆為封包事實：`stats`（已含裝備加成）／`statsMax`／`kyouka`／
`kyoukaMax`／`remodelDone`／`exSlotOpen`／`exSlotSpecials`／`leng`／`ctype`／`exp`／補給量。
**近代化改修上限＝master 的 (最大−初期)**，已用叢雲改二 420 逐項核對。`api_kyouka`
後三格（運／耐久／對潛）無可比對上限，只能判斷「有沒有加過」。

**補強增設特殊類別**（`GameState.exSlotSpecialTypes`）：`api_mst_equip_exslot_ship` 的
**key 是裝備 master id 而非類別 id**，值以 `api_ship_ids`／`api_stypes`／`api_ctypes` 三種
方式指定對象——**master 必須存 `ctype`**，否則艦級條件全部漏判。已對全 862 艘図鑑內艦驗算。

**素質「不含裝備」是估算**：裸值＝顯示值減裝備 master 自身加成，但裝備ボーナス（隱藏加成）
已計入顯示值卻不在裝備資料裡，相減後會偏高，UI 已標示。

**先制對潛是全功能唯一的推算值**（遊戲不送旗標）：依 wikiwiki 機制頁轉寫，海防艦/輕空母/
例外艦（Fletcher級91、John C.Butler級87，以 ctype 表達）/其餘四類規則，UI 提示須保留
「推算」字樣。開幕雷擊是事實：裝備特殊潜航艇（類別22）即成立。

**國籍＝人工參照表，鍵是艦型 ctype**（`ship-nationality.ts`）。未列出一律日本（862 艘中
僅 58 個 ctype 是外國艦型）。**「建造國」而非「最後所屬國」**：戰後移交他國並改名的形態
沿用本體 ctype（已驗證 Верный=響改二→日本、General Belgrano=Phoenix移交→美國、
Leonardo da Vinci=Dace移交→美國、伊504/伊503→義大利）。收錄 12 國，**沒有丹麥**。

**兩個日期**：date1 官方登場日（`ship-debut-data.ts`，唯讀，鍵＝基礎形態 master id）／
date2 打撈上任日（`db.shipObtained`，`source`：`auto`唯讀／`null` baseline／`manual`手填，
下限綁 date1）。**遊戲 API 完全不提供這兩個日期**。手填一律 `source='manual'`、不補
`observedEventId`（那兩欄是 `retention.ts firstOwnedDropKeys` 的新船場證據，混入會污染判定）。

master 三個關鍵欄位：`api_sortno`＝図鑑番号；`api_aftershipid` **是字串**（'0'代表無後續，
當 number 比對會靜默失效）；`api_mst_shipupgrade.api_original_ship_id` 才是改造→基礎形態
的可靠解法（純走 `api_aftershipid` 反向圖覆蓋率僅94%）。**可逆轉換改裝會讓 aftershipid
形成環**（如 Glorious 戦艦⇄正規空母），反解必須用帶 visited 的圖搜尋，不能用單鏈。

### 裝備全覽（`utils/gear-inventory.ts`＋`sections/equipment.ts`）

母集合是實例、呈現是種類：`groupGears()` 依 master id 彙總成 `GearGroup`，保留
`instances` 供展開列顯示。展開列用 `stackInstances()`：改修★＋熟練度＋持有者三者全同的
實例合成一行並計數；**持有者要連 `ex`（補強增設）一起比**。

十一項素質欄皆為封包事實（`api_houg`/`api_houm`/`api_leng`/`api_luck`/`api_houk`/
`api_baku`/`api_raig`/`api_saku`/`api_tais`/`api_tyku`/`api_souk`），**未含改修★加成**
（公式未經封包驗證，刻意不推導——與艦娘全覽的裸素質估算方向相反：那邊減、這邊不算）。

**持有者反查必須含基地航空隊**：`airBases` 的中隊吃的是同一批裝備實例，漏掉會誤報成閒置；
補強增設同理要算成裝備中。消耗品（`consumableGearIds`）不計入裝備欄上限，獨立標示。

### 資源紀錄（`utils/resource-capture.ts`＋`resource-log.ts`＋`line-chart.ts`）

**兩個貫穿設計的事實**：(1) 封包只給餘額，任何「花了多少」都是兩個時刻的餘額相減，算不出來
一律「不可考」不以 0 頂替；(2) 歷史無法回填（v12 起才有序列）。

**擷取落在 background，不是 EventProjector**（與其他四張 derived tables 相反）：資源列不需要
GameState 上下文，價值在連續，故與 `db.snapshot` 同層，在 `ingestEvent()` post-processing
落地，主鍵用**來源 raw event id**（非自增，SW recovery 重跑同一筆事件需冪等）。取樣來源只
認帶完整八項的 path（`api_port/port`、`api_get_member/material`）；任一項不是有限非負數字
整筆放棄。索引順序：0燃料 1彈藥 2鋼材 3鋁土 4高速建造材 5高速修復材 6開發資材 7改修資材。

**特殊時間點**（`db.resourceMarks`）：`stage-open`（首次出擊到活動海域，add-if-absent）／
`gauge-clear`（首次觀測到量表歸零）。`gauge-seen` 是守衛非里程碑：必須先觀測「未歸零」才
武裝，之後的歸零才算數，**不能是記憶體變數，只能落地**（SW 隨時會死）。`gauge-clear` 的
時間是**觀測到**歸零的時刻，非斬殺當下——UI 已明講。

**趨勢圖是使用者指定的形狀，曾被明確否決過「八張小圖各自 y 軸」的方案，不要改回去**：
最上方一張大圖、八條線、圖例即開關；`multiChartGeometry()` 的 y 值域只由「顯示中」的序列
決定；**雙 y 軸不做**（沒有共同基準）；序列配色是固定順序，資材 i 恆定拿第 i 個色位——
開關序列絕不重新分配顏色。**抽稀是純減量不平滑**（`downsample()` 每桶取最後一筆），平滑
會把「一次活動燒掉十萬燃料」的陡降磨圓。

**兩個踩過的坑，改這張圖時別再犯**：`hidden` 屬性對 SVG 元素無效（要用 CSS
`[hidden]{display:none}`）；不要用 `preserveAspectRatio="none"`（非等比縮放會拉伸 y 軸文字，
改用等比＋`aspect-ratio`，線寬用 `vector-effect: non-scaling-stroke`）。

新增語意色 `--res-gain`／`--res-drain`，**刻意不挪用** `--dmg-*`／`--sally-*`。

### 劇場模式與遊戲靜音（`entrypoints/theater.content.ts`＋`utils/theater.ts`＋`utils/audio-mute.ts`）

DMM 遊戲頁已改版為 SPA（`play.games.dmm.com/game/kancolle`），沒有固定 id/class，故遊戲框靠
**src 主機名＋尺寸辨識**（`pickGameFrame()`），無命中一律回 null 不亂挑。標記屬性＋外部
樣式表，不寫 inline style；不用 `position: fixed` 當主要手段（祖先的 transform/filter/contain
會變成 containing block）。

**顯示的是「遊戲畫布」不是「整個 iframe」**：畫布位置由框內 content script 跨源回報，父頁
`clip-path: inset()` 裁掉其餘部分並置中；**只信任「直接子框」的回覆**（`e.source ===
frame.contentWindow`），量不到就退回整個框不裁切、不猜矩形。`transform-origin` 固定 `0 0`。

**工具列固定佔底部一條，絕不覆蓋遊戲畫面**（浮動 UI 在此環境無法「自動閃避」——滑鼠移到
iframe 上事件全被吃掉，父頁收不到 hover）。`[hidden]` 需 `!important` 蓋過 shadow CSS 的
作者樣式。

**視窗縮放自動 refit**：`fitMode` 預設開啟，只有使用者親手縮放過才脫離 fit。

**`fitZoom()` 硬性維持 contain（`Math.min`），cover（`Math.max`）已被明確否決——這是本檔
目前唯一的黃金準則，未經使用者再次明確指示不得改回 cover**：畫面必須等比例完整呈現，
裁掉畫面任何部分不可接受，優先度高於黑邊。`enter()` 直接呼叫 `fitWindow()`（內含
`applyTransform()`）一次到位，不必使用者再點「適應」。

**滑鼠鍵盤事件會被遊戲框吃掉**：Alt+滾輪（縮放）與 Esc（離開）由框內 bridge 轉發到
`window.top`，**一律 passive、不 stopPropagation／preventDefault**——不改變遊戲行為。

**靜音**：`installAudioMute()` 在 MAIN world（document_start）把每個 `AudioContext` 的
`destination` 換成 master GainNode；`<audio>`/`<video>` 同理。BGM 路徑不可考時背景用
`tabs.update({muted:true})` 保底（新增 `tabs` 權限）。**「靜音沒反應」第一嫌疑是遊戲分頁
沒 F5**：content script 改動須重新注入，劇場模式用 `executeScript` 立即注入才生效，
interceptor／bridge 不會。⚠️ **未驗證**：艦これ用 WebAudio 還是 media 元素播音（兩條路徑
都接了，無樣本佐證）；跨源框存在與否（若有會影響畫布量測，退回不裁切）。

**狀態存放**：靜音開關與語言鏡像存 `db.meta['game-page']`——**這一列不參與投影、不引用
任何 event id**，`backup.ts` 的 `restoreMarker()` 會略過它。縮放倍率存 DMM 頁自己的
localStorage（`kc-theater`），不進 Dexie、不進備份。

**授權流程**：popup「劇場模式」→ `permissions.request()`（**必須是點擊手勢的第一個呼叫**，
先 await 別的事情會失去手勢資格）→ `scripting.registerContentScripts`
（`persistAcrossSessions`）→ 對當前分頁 `executeScript` 立即注入。

### 拍照（`utils/screenshot.ts`＋`MSG_CAPTURE_TAB`）

只擷取遊戲畫面、不含 DMM 頁面其餘部分。**裁切矩形絕不重新推算**：兩個入口（popup／劇場
工具列）都呼叫劇場模式已校準過的 `measureScreenshotRect()`；量不到畫布時回傳 `rect: null`，
誠實回報找不到，不猜矩形。`tabs.captureVisibleTab()` 抓整分頁截圖，`cropRectPx()` 裁切。

**權限：`activeTab`**（不是 `<all_urls>` 也不是既有的 optional host permission）——
`captureVisibleTab()` 只認 `<all_urls>` 或 `activeTab`，不認一般 origin host permission。
manifest 不顯示警告、不進 `host_permissions`，只在使用者「呼叫擴充」當下對「那個分頁」
暫時授予，換頁或關閉即失效。

**已知未驗證邊角**：劇場工具列的相機鈕是頁面內容點擊，不算「呼叫擴充」，全靠這次分頁
生命週期裡稍早是否已開過一次 popup 讓 `activeTab` 授予生效；靠 `stored.active` 自動恢復
劇場模式時若整個瀏覽器工作階段沒開過 popup，相機鈕理論上會失敗，尚未實機遇過。

### 關閉分頁前警示（`entrypoints/bridge.content.ts`）

標準 `beforeunload` + `e.preventDefault()`。**掛在遊戲框本身（kancolle-server.com）而非
頂層 DMM 頁**——manifest 靜態注入、零額外授權、涵蓋新舊 DMM 入口，這是關鍵功能不能靠使用者
先授權才生效（曾被明確否決過掛在需要 optional permission 的頂層 DMM 頁）。

**已知代價，刻意接受**：跨源 iframe 掛 `beforeunload` 可能導致按「取消」後對話框又跳一次
（Chromium 已知問題，crbug.com/1119438；已嘗試用 playwright-core 重現但 CDP 自動化關閉分頁
不會觸發 `beforeunload`，故未能本機重現，依已知 bug 報告與實機回報判斷）。零權限、可能跳
兩次，優先於單次跳窗但需要先授權——沒有保護才是真正的風險。`isOutermostGameFrame()` 只在
最外層安裝，是防禦性寫法非雙跳問題的根本解。

### 打撈紀錄／建造紀錄的 CSV 匯出入（`utils/csv.ts`＋`drop-log-import.ts`＋`build-log-import.ts`）

匯出格式**刻意不跟隨「畫面顯示什麼就匯出什麼」**（與 ships/equipment 不同）：這是可重新
匯入的資料交換格式，改用固定英文欄位集合（`ts,map,node,boss,rank,drop,dropMst` /
`ts,kind,shipMst,shipName,fuel,ammo,steel,bauxite,devmat,torch,secretary,secretaryName,hqLv`）。

CSV 匯入沿用 `sortie-import.ts` 已建立的例外路徑：event ID 向 generator 借（只前進不回頭），
**不寫任何 raw event**，每列標 `imported: true`。去重逐列比對，非整批 rollback（與
`importSortie()` 不同）：打撈紀錄「同海域＋時間±10分鐘＋有 master id 比對它否則比對名稱」，
建造紀錄收窄到 ±2 分鐘**並要求投入資材完全相同**。

**相容「航海日誌拡張版」的匯出**：實為 Tab 分隔＋CRLF、不做欄位跳脫，`parseDelimitedText()`
靠表頭 tab 數 vs 逗號數自動判斷分隔符。逐欄語意依原始碼轉寫、**沒有實機樣本佐證**，任何不
符預期的列一律跳過並記錄原因，不猜值。「マス」欄格式 `"マップ:{area}-{mapNo} セル:{cell}"`
是唯一能可靠取出 map 的欄位（「海域」欄實際是作戰文字非數字編號）；`node` 一律當不可考。
「ランク」欄可能帶額外文字，一律取尾字元。建造報告書的艦名是字串非 master id，查不到時存
`importedShipName`／`importedSecretaryName`，不假裝是哪個 master id。日期無時區資訊，只能
當本地時間解析。

### 遠征紀錄的期間彙總（`utils/expedition-stats.ts`＋`sections/exped-log.ts`）

**為什麼落在遠征紀錄而不是資源紀錄**：遠征收入是逐筆事件獲得量（精確可加總），資源紀錄的
消長是餘額差分（封包只給餘額）——兩者語意不同，混在一起會被拿去互相對照卻對不起來，
缺席規則也相反（資源紀錄無樣本時必須「不可考」，遠征收入照樣算得出來）。

**母集合是「紀錄中的」遠征，不是遊戲的完整歷史**：`db.expeditions` 由面板 EventProjector
投影，面板長期沒開＋raw event 已被 M6 裁剪的期間會永久缺席。**回航道具欄位語意未經真封包
驗證**，一律以 `id×count` 原樣彙總，不併入四資源小計。

**期間捷徑錨點是最後一筆紀錄，不是現在**（同資源紀錄的 `rangeBounds`）。自訂日期只要填任一
端就蓋過捷徑窗。分組鍵是 `missionId` 不是名稱（名稱隨語言變動）；`missionId` 為 0 的舊紀錄
才以名稱分組。摘要把大成功折進成功裡並寫明（避免讀者誤加總）。兩份 CSV 對應兩個問題（彙總
vs 明細），**表頭用目前語言的欄名**——與 drop-log/build-log 的固定英文欄位集合不同（那是
可重新匯入的交換格式，這是唯讀報表匯出）。

---

## 驗證原則與封包擷取

**驗證原則（重要）**：涉及封包欄位結構／索引的機制，**先拿真實封包對照再上**——本專案已
被 API 格式坑過兩次。演算法可從 wiki/KC3Kai/poi 轉寫，但欄位佈局要實測。拿到樣本先存
`samples/`，用 node 跑核心驗證（見「建置與驗證」）。

**自動擷取（優先）**：面板「動態」分頁的「待驗證封包」清單。`GameState.wantedTag(path,api)`
命中即記入 `db.wanted`，附「複製 JSON」按鈕，跨 session 保存。

**手動擷取（備用）**：遊戲分頁 DevTools Console 對 `[KC-Monitor] 戰鬥/結算封包` 物件右鍵
Copy object；或切 frame 後 `copy(__kcLastBattle)`；其他 path 用 Network 篩選。

---

## 慣例

- **一律用繁體中文（台灣用語）回應使用者**，不論提問用什麼語言。
- 程式碼註解用**繁體中文**。
- 第三方邏輯採 **clean-room 重寫**（標 `inspired by KC3Kai, MIT`），登錄
  `THIRD-PARTY-NOTICES.md`。
- 非平凡改動跑 `npx tsc --noEmit`；戰鬥/狀態邏輯改動用真實封包做執行期驗證。
- 面板 UI：分頁自動切換後，使用者手動切過即暫停自動，直到情境變化（`autoSwitch`）。

---

## 里程碑與進度（對照 docs/architecture-v1.md §9）

| 里程碑 | 狀態 | 備註 |
|--------|------|------|
| M1 管線打通 | ✅ | L1→L2→L3→面板事件檢視器全通 |
| M2 艦隊面板 | ✅ | 四艦隊/HP/疲勞/補給/裝備chip、遠征入渠倒數+通知、疲労回復通知、任務 |
| M3 戰鬥監控 | ✅ | clean-room `battle.ts`；敵聯合/航空/空襲/血量寫回/燃彈估算已實測 |
| M4 載體完善 | 🔶 | popup✅、劇場模式＋靜音✅；side panel／視窗位置記憶／Firefox 打包未做 |
| M5 擴充覆蓋 | 🔶 | 基地航空隊✅、關卡量表✅、TP✅、出擊紀錄歸檔✅、友軍艦隊✅、工廠子系統全數完成✅；掉落統計彙總未做 |
| M6 事件裁剪 | ✅ | projection cursor 限制裁剪範圍，未投影資料不會被刪 |
| M7 圖示化 | ✅ | 75 顆原創 SVG（裝備61＋資源8＋UI6），全部原創、無第三方素材 |
| M8 popup＋鎮守府情報總括 | ✅ | 全部分區完工、無 stub；db schema v12 |

### 待辦（依優先序）

1. 基地空襲 `api_destruction_battle` 頂層 key 名稱與 `api_lost_kind` 各值語意仍需原始封包確認。
2. `api_mst_slotitem` 反查 icon id 41「輸送機材」對應何物仍未證實，56–60 正式名稱仍為推定。
3. 節點字母新活動開圖：上游 `edges.json` 未更新前顯示原始 edge 編號，重新下載後重跑產生器即可。
4. 燃彈：活動特殊點與大漩渦電探減免（待 `api_happening` 封包）。
5. gaugeType 3（TP輸送）量表欄位驗證；TP 表新變種裝備補值。
6. 掉落統計彙總（資料已在 `db.sorties.drop`，缺 UI 彙總視圖）。
6b. 斬殺偵測只剩「即時性」待觀測（欄位判定已用真封包定案）。
7. M4 殘項：side panel 選配、視窗位置記憶、Firefox 打包驗證。
8. 亮色主題細部調校；遠征紀錄回航道具欄位未經真封包驗證。
8b. 活動作戰板三項待驗（札 id 語意／札名是否存在於封包／`api_sally_flag` 是否為出擊制限
   旗標）；「札 ← 哪次出擊」自動知識庫與貼錯札事後警示為第二版功能。
9. 友軍艦隊「強力友軍艦隊」支援消耗高速建造材（使用者提供之遊戲設定，非封包驗證）：
   需先取得相關封包，屬與現有 `api_friendly_battle` 不同層次（出擊前選項 vs 戰鬥中友軍）。
10. 劇場模式／靜音實機待驗：跨源框是否存在、WebAudio vs media 元素、stacking context 偏移。
    三者可在下次登入遊戲分頁時用 `__kcAudio.contextCount()` 與 devtools 快速定案。
