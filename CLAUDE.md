# CLAUDE.md — fleet-chronometer

艦これ（KanColle）用的 MV3 監控擴充：攔截遊戲 `kcsapi` 封包，面板即時顯示艦隊/遠征/
入渠/基地航空隊/關卡進度，及**戰鬥預測**（終末HP、rank、MVP、大破警告）與燃彈估算。

技術棧：WXT + TypeScript + Dexie(IndexedDB)。純前端，無後端。
原始架構書見 `docs/architecture-v1.md`（含與現況的偏差摘要）；UI／圖示設計綱要見
`docs/design-guidelines.md`（色彩/字距/動效/元件量表／**§7 面板彈窗**，提出介面或
圖示修改前先讀；改面板分頁前必讀 §7）；進度見文末「里程碑」。

> **本檔是精簡版**：只保留審查與日常開發必須遵守的硬約束、架構、資料契約、已驗證
> 封包事實，以及無法直接從程式碼看出的理由。較完整的工程依據見
> `docs/engineering-log.md`；該檔同樣只記錄現行行為、證據與必要取捨。

## 設計原則（硬約束）

1. **註釋與變更說明最高原則**：註釋只寫無法直接從程式碼看出的原因、約束或風險，禁止保留
   中間嘗試、除錯歷程、未合入狀態、舊實作或遭否決方案。PR 描述只寫最終行為與 diff 看不出的
   取捨，不得提及從未合入的狀態。維護文件記錄規則時，以「現行規則＋理由」表達，不敘述演變過程。
2. **被動擷取**：只觀察遊戲自身流量，絕不重放/修改/代發請求（帳號安全紅線）。
   kcsapi 觀察點是遊戲 `window.axios` 的 **response** interceptor；**禁止**取代
   `window.fetch`／`XMLHttpRequest.prototype`（否則 DevTools `getContent` 會讓並行的
   KC3Kai 開發人員介面變空）。契約鎖在 `tests/interceptor-capture.test.ts`。
3. **token 不落地**：`api_token` 在 bridge 層剔除，永不寫入 DB、不出境；不上傳任何資料。
4. **擷取與 UI 解耦**：資料落地於 SW 寫入的 IndexedDB 事件日誌；面板只是訂閱者+重放者，
   關閉期間不漏資料。SW 視為隨時會死，不持跨事件狀態。
5. **核心零瀏覽器依賴**：`utils/state.ts`+`battle.ts` 不含 `chrome.*`，可獨立編譯、
   用 node 餵真實封包測試（未來可拆包共用給 macOS app）。
6. **權限精簡**：安裝時的權限為 `alarms`+`notifications`+`scripting`+`activeTab`+`tabs`
   （`tabs` 僅供 `tabs.update({muted})` 遊戲分頁靜音保底使用，見劇場模式一節），且
   **host permission 一律為空**。`scripting` 不授予任何網站存取權；劇場模式/拍照需要的
   dmm.com 存取權走 `optional_host_permissions`，使用者按下按鈕才跳一次原生授權。
   `tests/manifest.test.ts` 常駐斷言**正式建置**的 `host_permissions` 為空——WXT 對
   `registration: 'runtime'` 的 content script 會自動把 matches 塞進 host_permissions，
   `wxt.config.ts` 的 `build:manifestGenerated` hook 負責剝掉。開發模式（`npm run
   dev`）則保留 `localhost`，否則擴充頁載入 Vite `@vite/client` 會被 CORS 擋下。任何新增
   權限都要有明確且無法從 manifest 看出的理由。
7. **不要重複資訊**（UI 最高原則）：同一事實只在一個位置完整呈現。別處若需要狀態訊號，
   只標「是什麼」、不把數字／倒數／明細再抄一遍。例：入渠倒數只在一般分頁入渠欄；編成列
   只寫「入渠」。已有完整呈現的地方再抄一次，等於讓使用者對照兩處是否一致，也浪費編成
   列的單行預算。

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
npx vite-node --config vitest.config.ts tools/preview/fleet-overview.ts # → .preview/fleet-overview{,-light}.html
npx vite-node --config vitest.config.ts tools/preview/panel-sortie.ts   # → .preview/panel-sortie{,-light}.html
npx vite-node --config vitest.config.ts tools/preview/panel-general.ts  # → .preview/panel-general{,-light}.html
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
  ▼ kc:live
panel/main.ts
  · 啟動：先以安全 snapshot baseline 建 state，再依 retained raw event ID 順序投影
  · EventProjector 對 cursor 前事件只建 state context，cursor 後才寫 sorties/factory/replays/
    expeditions；每筆 derived writes 成功才推進 projection cursor
  · 渲染即時監控分頁（general/sortie/exped/activity）＋艦隊＋基地航空隊
```

**Provider 合約**：`ApiEventRow`（`utils/db.ts`）是擷取來源與下游的正式邊界。MAIN world
interceptor 被動觀察遊戲 `window.axios` 的 kcsapi 回應（不取代原生 fetch／XHR，以免 DevTools `getContent` 對其他擴充變空），依序送出已去 `/kcsapi/`／`svdata=` 前綴的 path、原始
response text 與 request body；ISOLATED bridge 驗證同源訊息、移除 `api_token`／
`api_verno`，建立一次固定 envelope（UUID `captureId`、timestamp、path、req、`apiText`）後送
runtime message。retry **只一次**，且重用同一 envelope。background 才解析大型 `apiText` 成
`api_data`，並以 `source:'main'` 交 `ingestEvent()`。最終 row 不變量：path 已正規化、api 已
解析、req 無 token/verno；帶 captureId 的 events 以 unique index 去重，若同 captureId 的 path
或 timestamp 不同即拒絕 collision。**任何 provider 都不得繞過 `ingestEvent()` 直接寫
`db.events`**。單場 JSON 匯入／CSV 匯入是唯一的例外路徑（借 event ID、不寫 raw event，見下）。

### 反覆出現的設計慣例（跨分區適用，別在個別分區重新踩一次）

- **不要重複資訊**：同一事實只出現一次（見設計原則 7）。狀態標籤可以出現在第二處，
  倒數、數量、明細不行。例：一般分頁入渠欄已有艦名＋倒數，編成 `.dock-mark` 只寫「入渠」；
  一般分頁入渠／建造欄頂已有類別圖示，列內不再重複圖示。
- **面板出擊／編成版面釘死＋七船單行裝備**：見文末「慣例」同名硬約束；改
 `#tabpanel`／`.s-battle-row`／`.chips`／`.chip` 前必讀，勿為「空白好看」拆釘或讓
 裝備換行。
- **面板一般分頁**：見文末「慣例」同名硬約束；改 `#tab-general`／`.resblock`／`.g-cat`
／`#quests` 前必讀；五塊直向堆疊會讓任務超出固定高度，因此禁止採用。
- **一般分頁任務硬約束**：`#quests` 最多顯示 8 個任務，固定兩欄四列，採欄式填入為左 4、右 4；
  收合狀態必須在 270px `#tabpanel` 內完成，不以捲軸解決基本排版。只有使用者展開任務說明時，
  才允許任務區自身出現捲動，不能讓 `#tabpanel` 或下面編成區被推動。
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
  兩次（見「驗證原則」），節點字母、節點類型、活動標籤語意等多處因此改用查表或誠實
  顯示「不可考」而非算式推算。
- **語意色變數不可跨功能挪用**：大破/中破/小破色、標籤狀態色、資源增減色分屬不同語意，
  混用會互相稀釋視覺意義（design-guidelines §4.5）。

### 檔案職責

| 檔案 | 職責 |
|------|------|
| `wxt.config.ts` | manifest（permissions: alarms, notifications, scripting, tabs, activeTab；`optional_host_permissions` 為 DMM 遊戲頁）＋剝除 WXT 自動加上的 `host_permissions` 的 build hook＋`build.modulePreload: false`（必須關閉模組預載：Vite 一律替 `<link rel="modulepreload">` 加 `crossorigin`，擴充頁載入自家 chrome-extension:// 資源的 fetch 模式對不上，Chrome 每頁吐一則 `cross-world extension resource mismatch` 警告並白抓一次檔案。chunk 都是本機檔案、預載零價值，模組仍由 `<script type="module">` 的 import 圖載入） |
| `entrypoints/interceptor.content.ts` | MAIN world 以 axios response interceptor 觀察 kcsapi（不取代 fetch／XHR；契約鎖在 `tests/interceptor-capture.test.ts`）+ debug 擷取 ＋遊戲靜音 hook 安裝點（`installAudioMute`，須早於遊戲建立音訊圖，掛在 document_start） |
| `utils/axios-capture.ts` | 掛上 axios 觀察的純函式（等 `window.axios`、序列化後交 idle queue）；無 chrome.* |
| `entrypoints/bridge.content.ts` | 轉發到 background，去 token；靜音狀態長連線（`runtime.connect`）；視窗適應互動意圖轉發（僅 Esc，一律 passive、不 stopPropagation）；關閉分頁前警示（`beforeunload`，manifest 靜態注入、無需權限） |
| `entrypoints/theater.content.ts` | 視窗適應（DMM 遊戲頁）：遊戲畫面等比填滿瀏覽器視窗、拉邊框自動 refit、隨時還原。動態註冊（`registration: 'runtime'`），不在 manifest 的 content_scripts 裡 |
| `utils/theater.ts` | 視窗適應的純函式核心（遊戲框辨識／fit 幾何／注入用 CSS），無 chrome.*、無 DOM 依賴，node 可測 |
| `utils/audio-mute.ts` | 遊戲框內音訊靜音的純安裝函式：把每個 `AudioContext` 的 `destination` 換成 master GainNode（＋media 元素路徑） |
| `utils/game-page.ts` | 遊戲頁相關共用常數（新遊戲網址、注入範圍、訊息型別），theater／bridge／background／popup 共用 |
| `entrypoints/background.ts` | `ingestEvent()`＝provider 合約唯一入口；以 `BackgroundIngestionLifecycle` 串行 recovery／ingestion，完成後才廣播、寫 snapshot、裁剪與排程通知；`MSG_CAPTURE_TAB` 經此轉手截圖 |
| `entrypoints/popup/` | 擴充圖示點擊後的快捷選單：開面板／開遊戲（DMM）／視窗適應／遊戲分頁靜音／開鎮守府情報總括分頁／拍照。**不提供另開或替換遊戲視窗**，避免產生第二個遊戲執行個體——「開遊戲」以 `tabs.query(GAME_TAB_MATCHES)` 聚焦既有分頁，找不到才 `tabs.create`。視窗適應與靜音不關閉 popup（失敗時亦不關，見 `bind()`）。視窗適應／拍照**先同步判斷目前分頁是否為遊戲頁再 `permissions.request()`**：分頁資訊在 popup 開啟當下就查好（點擊後才 await 會失去手勢資格），查詢尚未回來時不擋 |
| `entrypoints/overview/` | 「鎮守府情報總括」獨立分頁；艦隊、艦娘、裝備、活動作戰板、出擊、遠征、建造／開發／改修、資源、LLM、備份分區皆已實作（無 stub 分區）；艦隊全覽另提供本機裝備、出擊（可含基地航空隊）與支援艦隊代碼複製 |
| `entrypoints/overview/ship-picker.ts` | 鎮守府全船篩選清單的共用 UI 元件（見「反覆出現的設計慣例」全量重繪陷阱） |
| `entrypoints/overview/sections/ships.ts` | 艦娘全覽：工具列＋篩選抽屜＋條件 chip 列＋詳細表格＋分頁。欄位開關／每頁筆數／排序／素質模式存 localStorage（`kc-ships-view`），不進 Dexie、不進備份 |
| `entrypoints/overview/sections/equipment.ts` | 裝備全覽：圖示篩選架（既有裝備圖示即篩選鈕）＋圖磚／詳細清單雙模式＋逐顆實例展開。模式／排序存 localStorage（`kc-equip-view`） |
| `entrypoints/overview/sections/sortie-log.ts` | 出擊紀錄：通常／活動兩大分類＋海域下拉＋單場 JSON 匯入，一次出擊一張卡（#第幾次・關卡代號・出擊編成・節點軌跡），展開才是編成／支援艦隊／基地航空隊／逐節點作戰資訊；提供標準 DeckBuilder JSON 複製與 KC3Kai 出擊模擬器開啟／貼上。分類存 localStorage（`kc-sortie-view`）。工具列＋匯入面板 markup 由 `shellHtml()` 提供，離線預覽共用 |
| `entrypoints/overview/sections/drop-log.ts` | 打撈紀錄：通常／活動分類＋新船／非新船篩選＋關鍵字／時間篩選＋分頁＋CSV 匯出入。CSV 邏輯全在 `utils/drop-log-import.ts`；新船判定走 `utils/drop-new-ship.ts`（**不是** retention 那支） |
| `utils/drop-new-ship.ts` | 打撈紀錄「新船」判定（純函式）：`newShipDropKeys()`。判準與面板 Drop 晶片同一條——比對鎮守府全艦娘（**以基礎形態**）後這一撈才讓它第一次成為成員才算。**與 `retention.ts` 的 `firstOwnedDropKeys()` 是兩支，別合併**（見該檔說明） |
| `entrypoints/overview/sections/exped-log.ts` | 遠征紀錄：**主體是逐筆明細**（一趟回來拿了什麼／多少／成功還是失敗，可選欄位＋分頁，編成欄預設收合）；上方一行期間總計，下方收合的「各遠征次數與收穫」為次要查詢工具。期間捷徑／自訂起訖日／活動期間捷徑＋明細／彙總兩份 CSV。彙總核心在 `utils/expedition-stats.ts` |
| `entrypoints/overview/sections/build-log.ts` | 建造紀錄：可選欄位詳細清單＋分頁＋CSV 匯出入。匯入來源查不到 master id 時顯示 `FactoryLogRow.importedShipName`／`importedSecretaryName` |
| `entrypoints/overview/sections/event-ops.ts` | 活動作戰板：標籤總帳（自動）＋計畫疊層＋關卡表。直接讀寫 `db.eventPlans`——使用者手輸的攻略意圖、非從 events 投影的衍生資料 |
| `entrypoints/overview/sections/resource-log.ts` | 資源紀錄：最上方一張大折線圖（八項資材疊在同一張圖、圖例逐條開關、y 軸只依顯示中的序列縮放、十字準線）＋活動區段消耗＋詳細清單（表頭與欄位開關皆純圖示無文字）。控制項只建一次、只重繪 `.rl-body`；期間／粒度／欄位／分頁存 localStorage（`kc-resource-view`） |
| `entrypoints/overview/main.ts` | 側欄導覽＋hash 路由＋語言/主題套用；側欄三態（釘選／收合／浮層滑入，`body[data-nav]`）與側欄左右側（`body[data-nav-side]`，與三態正交）。窄視窗（≤760px）強制不釘選 |
| `entrypoints/overview/lib.ts` | `loadGameState()` 依 `planStateRecovery()` 選安全 snapshot baseline 再重播 raw events；overview 不投影、不寫 derived tables |
| `entrypoints/overview/fsa.ts` | File System Access API 封裝（零 manifest 權限的資料夾備份）：目錄選取、讀寫權限請求、`fileExists()`、寫檔；目錄 handle 存獨立原生 IndexedDB（`kc-fsa`，非 Dexie） |
| `entrypoints/overview/viewer-html.ts` | 離線 `viewer.html` 產生器（單檔、零擴充、零外連）：內聯 `toKc3Replay`，載入 `kanmusu-backup-YYYY-MM-DD-HHmmss.json`（亦相容舊 `kanmusu-backup.json`／`kanmusu-replays.json`）即可逐場複製 KC3Kai battleplayer 物件／開公開重播頁 |
| `entrypoints/panel/main.ts` | 面板控制器：以 `EventProjector` state-only/persist 兩階段重播與 live 投影、只在成功後推進 cursor、渲染與 autoSwitch |
| `utils/ui-prefs.ts` | UI 偏好持久化（語言＋亮暗主題，localStorage）——panel/popup/overview 共用；SW 不使用。`onPrefsChange()` 用 DOM `storage` 事件做跨頁即時同步 |
| `utils/ui-i18n.ts` | 面板／核心自產 UI 文字的三語字典＋`t()`。另有 `expedDisplayName()`：活動限定的支援遠征（真封包 start2 實測 id 301＝S1 前衛支援／302＝S2 艦隊決戦支援，`api_maparea_id` 為活動海域）補「道中／王點」白話註記——**以 mission master id 為鍵而非 `api_disp_no`**，一般海域的 33／34 不在此列 |
| `utils/gamedata-i18n.ts` | 艦名／裝備名本地化唯一入口 `localizeShip()`/`localizeGear()`；`SHIP_NAMES`/`GEAR_NAMES` 從 `gamedata-names.ts` 匯入，缺譯回退封包日文原名 |
| `utils/gamedata-names.ts` | **產生物、勿手改**——`tools/gamedata-names/generate.py` 由 `samples/i18n/*.csv` 產生的譯名表 |
| `utils/gamedata-coverage.ts` / `utils/gamedata-known-ids.ts` | 翻譯缺漏偵測：純函式差集 `findUnknownShips`/`findUnknownGears` ＋ `tools/gamedata-coverage/generate.py` 產生的已知 id 集合，供 LLM 分區「匯出翻譯缺漏」使用 |
| `utils/maelstrom-data.ts`／`utils/maelstrom.ts` | 渦潮比例表（KC3Kai `fud_weekly.json#maelstromLoss`）＋`planMaelstromLosses`（純函式）；`GameState` 在 map start/next 套用 |
| `utils/air-raid-lost-kind.ts` | 基地空襲 `api_lost_kind` 1–4 文案對照（inspired by KC3Kai） |
| `utils/replay.ts` | 出擊重播組裝（純函式，無 chrome.*）：`snapshotDeck`/`startReplay`/`appendBattle` 累積成 `ReplayRow`、`toKc3Replay()` 輸出 KC3Kai battleplayer 可貼上物件 |
| `utils/map-node-kind.ts` | 節點類型（`api_event_id`／`api_event_kind` → 資源／渦潮／能動分歧／空襲戰／敵連合…）。封包事實，語意轉寫自航海日誌拡張版（MIT） |
| `utils/map-node-letters.ts` | 節點字母查表（純函式）：`nodeLabel(map, edge)` 有對照給字母、沒有給原始 edge 編號。節點字母沒有符合真實資料的可靠推算規則，因此只能查表 |
| `utils/map-edge-letters.ts` | 上表的資料本體（193 張海域、5904 條 edge）。**產生物、勿手改**——改 `tools/map-edges/edges.json` 後重跑 `tools/map-edges/generate.py` |
| `utils/sortie-import.ts` | 單場出擊 JSON 匯入（解析／去重為純函式，落地為一個 Dexie transaction）：只吃 `toKc3Replay()` version 4 或既有 fixture 證實的 KC3Kai logger 格式。去重在 transaction 內做，命中即拋 `SortieImportDuplicateError` 並整個 rollback。event ID 向 events key generator 借（add→delete）但**不寫任何 raw event** |
| `utils/csv.ts` | CSV／TSV 最小共用解析與序列化（純函式） |
| `utils/drop-log-import.ts` / `utils/build-log-import.ts` | 打撈／建造紀錄 CSV 匯出入，借 event ID 寫入 derived tables（不寫 raw event，逐列去重不整批 rollback） |
| `utils/sortie-detail.ts` | 出擊紀錄「一次出擊」的重建（純函式）：`buildSortieDetail()` 把 `db.sorties` 摘要 × `db.replays` 原始封包合成逐節點作戰資訊。戰鬥細節直接餵 `battle.ts` 的 `analyzeBattle()`（與面板同一支） |
| `utils/deckbuilder.ts` | DeckBuilder 與出擊模擬器格式分開維護：`buildDeckBuilder()`／`buildReplayDeckBuilder()` 產生艦隊與基地航空隊 JSON，`buildOwnedEquipmentCode()` 產生全持有裝備代碼，`buildSelectedDeckBuilder()` 產生出擊／支援選取艦隊（出擊可含最多三隊基地航空隊）的 DeckBuilder v4 JSON，另提供 `imgBuilderUrl()`／`airCalcUrl()` |
| `utils/sortie-simulator.ts` | `buildSortieSimulator()`／`toSortieSimulatorUrl()` 產生 KC3Kai 出擊模擬器使用的 `fleetF`／`nodes` 格式，含支援艦隊與基地航空隊資料；不與 DeckBuilder 格式混用 |
| `utils/resource-capture.ts` | 資源紀錄的擷取層（純函式）：`readMaterials()`／`readEventGauges()`／`captureResources()`。由 background 呼叫而非 EventProjector——資源序列不需要 GameState 上下文，價值在連續 |
| `utils/resource-log.ts` | 資源紀錄分析核心（純函式）：`normalizeSamples()`／`bucketSamples()`／`downsample()`／`buildEventPeriods()`／`toCsv()`。餘額是封包事實、消長是差分，算不出來一律回 null |
| `utils/line-chart.ts` | 折線圖幾何（純函式，無 DOM）：`multiChartGeometry()`／`niceTicks()`／`nearestIndex()`。y 值域只看傳進來的序列 |
| `utils/retention.ts` | 重播保留規則引擎（純函式）：`planRetention()` 依保護規則＋裁剪窗決定 `db.replays` 去留、`firstOwnedDropKeys()` 算新船場 |
| `utils/event-plan.ts` | 活動作戰板核心（純函式）：`groupBySally()`／`checkStage()`／`findPlanConflicts()`／`sallyBudget()` |
| `utils/ship-filter.ts` | 鎮守府全船篩選（純函式）：航速／艦種／國籍／可裝備／出擊標籤／關鍵字。由活動作戰板與艦娘全覽共用；`matchSpeed`／`matchEquip` 另行匯出給活動配船板自由池借用（那邊有自己的艦種分組與關鍵字邏輯，只借這兩項語意，不得各自複製門檻） |
| `utils/ship-nationality.ts` | 艦娘基本國籍（建造國）參照表，鍵＝艦型 `api_ctype`。遊戲 API 不提供國籍，人工維護；篩選層 `nationsOf` 可依已確認的活動機制為特殊艦加掛額外陣營標籤（目前 Верный 同時列入日本／蘇聯）；未列出的一律日本 |
| `utils/ship-roster.ts` | 艦娘全覽詳細清單的篩選／排序／分頁核心（純函式）。先制對潛是全檔唯一的推算值（遊戲不送旗標） |
| `utils/gear-inventory.ts` | 裝備全覽的彙總／篩選／排序核心（純函式）：`groupGears()` 把裝備實例依 master 彙總成種類。素質一律是 master 基礎值、**不含改修 ★ 加成** |
| `utils/repair.ts` | 泊地修理（工作艦）＋母港給糧（補給艦野埼）的涵蓋範圍與結算預估（純函式）：`planAnchorageRepair()`／`planMoraleSupply()`／`nextSettlementIn()` |
| `utils/expedition-bonus.ts` | 遠征資源加成（大発動艇系裝備）試算（純函式）：`computeExpeditionBonus()`／`applyExpeditionBonus()`／`collectLandingCraftGears()`。遊戲不送任何加成封包，公式為社群機制轉寫 |
| `utils/lbas-cond.ts` | 基地航空隊中隊疲勞的「經過時間修正」（純函式）：`lbasRecoveryRate()`／`lbasCondClearsInMs()`／`lbasCondCertainlyClear()`。疲勞回復在伺服器端每 3 分鐘一次且**不推封包**，故 `api_cond` 永遠是觀測當下的快照 |
| `utils/quest-progress.ts` | 任務「本機進度」推算（純函式）：`parseQuestGoal()` 從任務標題反推目標次數與動作種類 |
| `utils/state.ts` | `GameState`：封包 reduce 成狀態；遠征檢查、制空/索敵、戰鬥接線、血量寫回、燃彈估算、關卡量表、TP、`wantedTag`、泊地修理計時器錨點、任務進度計數 |
| `utils/battle.ts` | `analyzeBattle`（傷害重放、損管發動、第二艦隊旗艦不沉、大破/旗艦大破判定）+ `predictRank`（勝利判定） |
| `utils/screenshot.ts` | 拍照的純函式核心：`cropRectPx()`／`downloadCroppedScreenshot()` |
| `tests/` | vitest 套件（`npm test`），檔名對應被測模組 |
| `utils/db.ts` | Dexie schema **v12**：stores 為 events、wanted、sorties、notified、factory、replays、expeditions、snapshot、shipObtained、eventPlans、resources、resourceMarks、meta；events 的 `captureId` 為 unique index，並有 `postProcessState` |
| `utils/ingestion-persistence.ts`／`utils/background-ingestion-lifecycle.ts` | raw event 持久化、captureId 去重與 collision 拒絕、pending/processing/done 狀態機，SW recovery 的單一順序 queue |
| `utils/event-projector.ts`／`utils/projection-cursor.ts`／`utils/event-pruning.ts` | derived-table 投影、`meta['projection']` version 3 cursor，只刪已投影 raw event 的安全裁剪 |
| `utils/ship-debut-data.ts` | 艦娘「官方登場日」參照資料，鍵＝基礎形態 master id。**產生物、勿手改**——改 `samples/ship-debut-dates.json` 後重跑 `tools/ship-debut/generate.py` |
| `utils/expedition-data.ts` | poi 遠征需求資料（MIT，見 NOTICE）＋ 2026-08-03 補上 poi 未收錄的 20 個遠征條件（轉寫自 ElectronicObserver，見 NOTICE）＋ id 301/302（活動支援遠征，封包事實） |
| `utils/expedition-stats.ts` | 遠征紀錄期間彙總核心（純函式）：`filterByPeriod()`／`summarize()`／`groupByMission()`／`statsCsv()`。收入是逐筆事件獲得量，不是餘額差分 |
| `public/icons/**.svg` | 裝備／資源／UI 圖示（原創向量，**由 `tools/icons/` 產生，勿手改**）；裝備檔名即 `api_type[3]` |
| `tools/icons/` | 圖示生成器＋設計約束，改圖示前先讀其 README |
| `samples/` | 真實封包樣本（驗證 fixture）＋機體／UI 參照圖。所有樣本必須匿名化；`slot_to_port.json` 不含 member_id、暱稱、時間戳或贅言，Git 歷史不得含提督識別資訊或無引用截圖 |
| `docs/architecture-v1.md` | 原始架構書（設計對照基準） |
| `docs/design-guidelines.md` | UI／圖示設計綱要（含 §7 面板彈窗 420×850） |
| `docs/engineering-log.md` | 深入工程依據，含各功能的現行行為、來源證據與必要取捨 |

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

**艦隊全覽代碼複製**：只讀 `GameState` 已完成的 view，在本機組成全持有裝備 JSON 與兩份
DeckBuilder v4 JSON；按鈕只複製到使用者的剪貼簿，不開啟外部網站、不傳送資料。出擊與支援
兩組艦隊選取彼此獨立，出擊代碼另可選取最多三隊基地航空隊並填入 `a1`、`a2`、`a3`；
艦隊依編號順序連續填入 `f1`、`f2`…。沒有選取艦隊或資料不完整時停止輸出並顯示原因，
不以空資料或猜測值代替。

**產品識別**：package 為 fleet-chronometer 1.1.0.3，權限 `alarms`、`notifications`、
`scripting`、`activeTab`、`tabs`。品牌名走 i18n（`public/_locales/{en,ja,zh_TW}/messages.json`），
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

**拖曳交換同艦兩個已裝備槽位**（母港編成畫面把裝備直接拖到另一個已裝備的槽位上，非
點擊式的 `slotset`）走獨立端點 `api_req_kaisou/slot_exchange_index`。**已用真封包驗證**
（`samples/slot-exchange-index.json`，三筆，含互為逆操作的一組 `src_idx`/`dst_idx`
`3`↔`0`）：請求為 `api_id`/`api_src_idx`/`api_dst_idx`（0-based，與 `slotset` 的
`api_slot_idx` 同慣例），回應的 `api_ship_data` 是**完整艦快照**（與 `api_port/port`
單艦記錄同形，含 HP／燃彈／cond／各項素質／`api_sally_area` 等，不是只帶 `api_slot`／
`api_onslot` 的局部物件）。`applyEvent` 因此直接 `ingestShips([api_ship_data])` 整艦
覆蓋，不手動挑欄位、不用 src/dst idx 自行猜 swap——回應本身已是交換完的最終結果。
`api_id` 需與請求一致才採信，避免格式異常時誤植出一艘幽靈艦。此路徑必須寫回完整艦快照，
否則艦載機拖曳交換後的制空（`airPower()`）不會依新槽位重算；`swapShipSlots()` 只處理點擊式
`slotset` 的同艦互換，管不到這條路徑。
契約鎖在 `tests/equipment-position.test.ts`（含直接餵樣本檔的解析測試）與
`tests/plane-loss.test.ts`「拖曳交換槽位後制空重新計算」。

---

## 戰鬥預測子系統（重點）

流程：戰鬥封包 → `state.ts` 呼叫 `analyzeBattle()` → `battleInfo` → `renderSortie()`；
`battleresult` 補確定 rank 與掉落。戰後血量寫回 `this.ships`，燃彈依費率表估算。
完整證據與必要取捨見 `docs/engineering-log.md` §戰鬥預測子系統。

### 現行遊戲 API 格式（必須依真實封包，不得推測）

- **血量**：`api_f_nowhps`/`api_f_maxhps`（我方主隊）、`api_e_nowhps`/`api_e_maxhps`
  （敵主隊）、`*_combined`（隨伴）。**皆 0-indexed、無 leading -1**；單一
  `api_nowhps`=`[-1,我1..6,敵1..6]` 不屬於現行封包格式。
- **砲擊/夜戰**（`api_hougeki1/2/3`、`api_hougeki`）：`api_at_eflag[i]` 分攻擊方
  （0=我,1=敵），`api_at_list`/`api_df_list` 索引為各方局部 0-5（主）/6-11（隨伴）。
- **雷擊**（`api_raigeki`）：`api_fdam`/`api_edam`=受傷、`api_fydam`/`api_eydam`=造成
  傷害（MVP 用）。damage 可能帶小數，需 floor。**聯合艦隊開幕雷擊陷阱**：
  `api_opening_atack` 的造成傷害欄改叫 `api_fydam_list_items`／`api_eydam_list_items`
  （每格 null 或陣列），不是 flat 的 `api_fydam`／`api_eydam`；漏讀會少算開幕雷擊 MVP 貢獻。
- **航空/基地/噴式**：`api_stage3`=對主隊、`api_stage3_combined`=對隨伴（索引+6 對映）。
  漏算隨伴會 rank 誤判（已用 6-5 封包實證：漏算→A、正確→S）。
- **敵艦 id**：`api_ship_ke`（主）、`api_ship_ke_combined`（隨伴），0-indexed、無 -1。
- **敵艦等級／素質／裝備**：`api_ship_lv`／`api_eParam`／`api_eSlot`（＋各自的 `*_combined`）
  與 `api_ship_ke` **同序、同長度、0-indexed**。`api_eParam[i]`＝[火力, 雷裝, 對空, 裝甲]
  （順序轉寫自社群工具，並由同封包 `api_fParam` 的「戰艦格第 2 項恆為 0」交叉佐證）；
  `api_eSlot[i]` 為裝備 master id、`-1`＝空格。⚠️ 過濾掉 `api_ship_ke` 的 0 之後，這三個
  平行陣列**必須用原始位置索引**去查，用過濾後的新索引會在中間有空格時整排錯位。
- **陷阱**：`'...battleresult'.startsWith('...battle')` 為 true——戰鬥分支必須
  `!path.endsWith('result')`，否則結算封包被誤吞、battleInfo 洗空。
- **陷阱**：**雙方都沒出動艦載機時 `api_kouku.api_stage1` 照樣存在，且
  `api_disp_seiku` 為 1（確保）**（真封包實證：samples/61-4.json 的 `api_f_count=0`／
  `api_e_count=0`／`api_disp_seiku=1`）。直接照抄會在潛水艦點、水雷戰隊出擊誤報「確保」。
  顯示端一律先判 `playerFighter.count + enemyFighter.count > 0`，否則顯示「無」
  （面板 `renderSortie` 與 `sections/sortie-log.ts` 用同一條判準，別只改一邊）。
- **支援艦隊的傷害陣列長度不固定**：`api_support_hourai.api_damage`／
  `api_support_airatack.api_stage3.api_edam` 實測時而長度 7（敵單艦隊）、時而 12（敵聯合），
  **索引基準尚未由真封包定案**。故 `BattleSupportView.damage` 只做加總、不逐位置歸屬；
  血量歸屬仍走既有的 `applyDmg`，兩者讀同一批欄位，不另立第二套解讀。
- **自軍聯合艦隊**：已用真實 61-5 甲自軍水上部隊封包驗證，主隊/隨伴血量歸屬、局部
  0-11 索引、MVP、rank 皆與 logger 記錄完全一致。
- **夜戰目標與夜戰效果**：比照 KC3Kai `Node.engageNight`，敵方連合艦隊實際交戰隊伍只
  讀夜戰封包的 `api_active_deck[1]`（1=主隊、2=隨伴）；缺欄時維持未知，不從日戰傷害
  位置猜測。`api_flare_pos[0]` 是照明彈實際發動位置，正的 `api_touch_plane[0]` 是夜間
  觸接機體 master id；探照燈則依當時作用艦隊的可用裝備與夜戰攻擊欄判定。夜間觸接圖示
  沿用封包明示的機體，不固定套用單一夜偵 id。日戰尚未收到夜戰封包時，才比照 KC3Kai
  CalculatorManager 的隨伴存活分數顯示推測目標，並明確標成推測。
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
| 噴式強襲 | ✅ 已涵蓋（基地：`api_air_base_injection`；空母：`api_injection_kouku`） |
| 支援艦隊（對敵） | ✅ 航空／砲擊欄位路徑已以 61-5／61-3 驗證；`api_support_flag` 1/2/3/4 分類為航空／砲擊／雷擊／對潛，未知值依結構回退 |
| 友軍艦隊 | ✅ `api_hougeki` 已驗證（61-3 甲 boss 夜戰）；`api_raigeki` 未經真封包驗證 |

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
| 反潛點 | 敵主隊全潛水(stype13/14)；Boss 節點與4-1/4-3例外仍20/20 | 8% | 0% |

> 未涵蓋：活動特殊點按普通處理。大漩渦燃彈另見 `utils/maelstrom.ts`（KC3Kai 查表＋
> `api_happening`；表外不扣；連合 A／B 各隊分開計電探擱置）。

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
之類的前綴符號**：那一格的寬度是釘死的（見「慣例」的裝備列單行預算），多一個字元就會把
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

- `api_map_info[]`：`api_cleared`、`api_gauge_type`（1=擊破數式；2=HP量表式）。
- 面板一律顯示「剩餘」語意；`maxHp=9999` 為「尚未選擇難度」佔位，非真實滿血。
- **gaugeType 2 擊破機制**：量表每場依「對 boss 旗艦傷害」遞減；進入最終段（殘量 <
  boss 旗艦 HP）後傷害不會打到 0——會 floor 在 1；**唯有實際沉沒 boss 旗艦，量表才真的變
  0＝通關**。`now_maphp===0` 在機制上唯一等價於「這場斬殺成功」，是精確判定；`===1` 正確
  留在「未通關」。`api_first_clear` **不可當斬殺旗標**（語意與直覺相反：未通關時存在）。
- 剩餘次數：gaugeType 2 = `ceil(殘HP/boss旗艦HP)`；gaugeType 3（TP）直接顯示封包的剩餘
  TP，不以艦隊基本 TP 推估場數（**量表欄位仍缺真實封包驗證**）。
- **Boss 旗艦 HP 無法由 master 或 mapinfo 封包取得**（2026-08-02 以真封包逐一查證）：
  `api_get_member/mapinfo` 的 `api_eventmap` 實測只有 `api_now_maphp`／`api_max_maphp`／
  `api_state`／`api_selected_rank`／`api_limit_flag` 五個欄位（樣本 `samples/6-5-mapinfo-2.json`
  的 `api_id:621`，真實活動海域）；`api_mst_ship` 裡 **889 艘深海棲艦完全沒有素質欄位**
  （只有 id／名稱／艦種／艦型／速度／格數，`api_taik` 是玩家艦 862 艘專屬），start2 也沒有
  任何「海域→敵艦」對照表（只有 `api_mst_maparea`／`api_mst_mapinfo` 兩張名稱表）。
  **敵艦 HP 只在戰鬥封包的 `api_e_maxhps` 出現＝必須實際打過**，故斬殺線只能靠本機
  `db.replays` 觀測值。唯一例外見下一條。
- **同一活動海域可能同時存在多條血條**：`api_map_info[]` 外層的
  `api_gauge_num`（部分工具會在 `api_eventmap.api_gauge_num` 暴露同一欄位）只作原始血條
  身分鍵，不解讀數字語意。比照 KC3Kai，Boss HP baseHp
  必須以 map／難度／同一個 `gaugeNum` 分開保存；並先以 map/start／next 的 `api_bosscell_no`
  限定目前血條的目標 Boss 節點，再讓同一 Boss 的較低最終形態向下更新。**不能只看
  `api_event_id=5` 就把整張圖所有 Boss 混在一起**：破甲路線回打舊階段 Boss 時仍是 Boss 戰，
  但其 HP 不屬於目前血條。
  舊重播沒有該欄時，只有在目前難度／血條沒有更精確紀錄時才作保守回退，避免前一條血條
  把新的量表誤標成斬殺期。
- **斬殺期的視覺標示不得改變量表尺寸**（`entrypoints/panel/sortie-gauge.ts`＋`.s-gauge-final`）：
  標籤併在量表條**之內**（`斬殺期 840/4840`），不是條子外的第二顆徽章——並排兩顆會把
  `.s-header`（flex-wrap）撐到換行，多一整列就把下面釘死的出擊資訊推到要捲動。高度兩態
  一律 13px，輪廓只准用 inset `box-shadow`（不佔版面），**不准改 `height`／加 `border`／
  動 `min-width`**，高對比 media block 同樣不准用 `border-width` 加粗。標籤字級 9px／
  700／淡金（`color-mix`），不用 11px／800／純白——那組會糊成一團且亮度壓過真正要讀的
  數值。契約鎖在 `tests/zansatsu-phase.test.ts`；版面用
  `npx vite-node --config vitest.config.ts tools/preview/sortie-gauge.ts` 離線比對，
  **不必為了調字重去打一次斬殺線**。
- **`nowHp === 1` 是唯一不需要 Boss HP 的斬殺期判定**：最終段的傷害會 floor 在 1（唯有沉沒
  boss 旗艦才變 0），故這個值本身就是「已在最終段」的機制事實，零紀錄的新環境也成立。
  **不可把這條推廣成「殘量很小就算斬殺期」**——多小算小需要 boss HP，那就回到猜測。
- **斬殺期標示（`GameState.mapInFinalPhase()`）門檻是「殘量小於或等於同一條血條的 boss
  旗艦 HP」**，
  不可改用 `mapRemainingRuns() === 1`——`ceil(殘量/bossHP)` 在兩者相等時也是 1，不能
  取代血條門檻。⚠️ **遊戲從不送 boss 旗艦 HP**，`mapBossHpByGauge` 只能以實戰觀測
  （`api_e_maxhps[0]`）建立，並由 `panel/main.ts` 從保留的重播資料恢復；故「量表明明已在
  斬殺線內卻沒有標示」的第一嫌疑一律是**這張圖的同血條 Boss HP 沒載到**，不是判定式寫錯。
  `panel/main.ts` 的 `restoreGaugeBossHp()` 從
  `db.replays`＋`db.sorties`（保留規則護著的持久資料，核心在 `utils/boss-hp.ts`）撈回來，
  **時機是面板啟動＋每次 `api_req_map/start`**：`sortieInfo` 在 `api_port/port` 會被清空，
  面板幾乎都是在母港開的，只掛啟動那一次等於永遠查不到。同一活動海域可能有多個 boss
  節點，故**不可用「已知就略過」當快門**；新重播必須保存 map/start／next 的
  `bossCellNo` 排除舊階段 Boss；活動圖若尚未取得目標節點身分，寧可不建立新門檻，也不能
  把任意 `api_event_id=5` 當成目前 gauge 的 Boss。確認節點身分後，再讓
  `observeMapBossHp()` 取同一有效 Boss 的最低形態 HP。舊重播缺少 `bossCellNo` 時採最大
  Boss HP 作保守相容，不能以全 Boss 最低值污染目前斬殺線。從未在
  面板開著時打過該圖 boss ⇒ 沒有斬殺線可標，這是機制限制不是 bug。

### 出擊重播（KC3Kai battleplayer 相容，`utils/replay.ts`＋`db.replays`）

`toKc3Replay()` 輸出格式：頂層 `{fleet1, fleet2, fleetnum, combined, battles:[{node,data,yasen}],
world, mapnum, diff, time}`；**每個 `battles[i].data` 是一則原封不動的原始 kcsapi 戰鬥封包**。
沒有夜戰時 `yasen` 仍須輸出 `{}`，不可輸出 `null`：KC3Kai player.js 會直接呼叫
`Object.keys(battle.yasen)`。`ReplayRow.ts` 的毫秒時間戳在輸出時須轉為 KC3Kai 使用的 UNIX 秒；
`toKc3ReplayUrl()` 使用 battleplayer 原生的 JSON URL fragment 建立一鍵播放連結，不經第三方
重播資料庫上傳；超過 30,000 字元時不直接導航，改為開啟空白播放器並複製 JSON，避免瀏覽器
截斷長 fragment。
ship 等級同時輸出本專案再匯入用的 `lv` 與 KC3Kai 艦隊詳情使用的 `level`，stats 由
battleplayer 自算不帶。單艦隊第2～4隊獨立出擊時，KC3Kai 播放格式以 `fleetnum:1`＋`fleet1`
表達，另以 `sourceFleetnum` 保存原編號供本專案再匯入還原（KC3Kai 會依 `fleetnum` 直接索引
同名 fleet 欄位，原樣輸出會讀到不存在的 `fleet3`／`fleet4`）。擷取判別：夜戰＝path 含 `midnight`
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

陸航逐波戰果（`BattleLbasView`，面板出擊資訊的陸航圈）：出擊機數＝`api_stage1.api_f_count`；
**損失＝`api_stage1.api_f_lostcount`（制空戰）＋`api_stage2.api_f_lostcount`（對空砲火）**，
只讀 stage1 會少報；對敵傷害＝`api_stage3.api_edam`＋`api_stage3_combined.api_edam`，
**可能帶小數**（6-5 ec_battle 樣本有 0.1），與其他傷害欄一致先切捨再加總。`api_base_id`
在部分封包缺席（同一份 6-5 樣本），缺席記 0＝不可考，不猜是第幾基地。

**單場 JSON 匯入**只接受 (a) 本專案 `toKc3Replay()` version:4 或 (b) KC3Kai logger fixture
證實的格式，其他一律拒絕。重複判定：海域＋戰鬥節點序列完全相同＋±10 分鐘邊界；雙方都有
封包時比對完整原始封包（物件 key 排序後 FNV-1a），否則才用時間 fallback；判定在 transaction
內做，命中即整個 rollback。event ID 向 generator 借（add→delete）但不寫 raw event。
**KC3Kai 對「沒有夜戰的節點」寫 `"yasen": {}`**（空物件仍是 truthy）——判準是「至少有一個
`api_` 開頭的欄位」（`hasPacket()`）。KC3Kai 結算鍵名對照：`rating`→`rank`（SS 正規化為
S）、`drop`→`dropMst`／`drop`、`mvp`→`[主隊,隨伴]`（1-based）、`hqEXP`→`getExp`、
`baseEXP`→`baseExp`。

節點標籤走 `utils/map-node-letters.ts` 的查表；有對照顯示字母、沒有顯示原始 edge 編號，
**絕不推算**，因為節點字母不存在符合真實資料的可靠推導規則。

---

## 子系統速查

以下各節只列**已驗證事實／公式／欄位名**與無法直接從程式碼看出的 guardrail；完整證據與
必要取捨見 `docs/engineering-log.md` 對應同名章節。

### LLM 分析子系統（`entrypoints/overview/sections/llm.ts`）

三條路徑皆避開新增網路權限：(1) **通用備份檔**——`buildFullReport()` 產生 Markdown
（複製/下載，零網路零權限），出擊依海域分組統計（非全域統計＋固定筆數列表）、裝備依種類
彙總持有量＋改修分布（非逐顆列舉）；(2) **MCP 掛載**——純文件提示，指引使用者把下載資料夾
指給支援 MCP 的用戶端，整個流程在擴充之外，不影響權限設定；(3) **Chrome 內建 AI**（Prompt
API／Gemini Nano）——裝置端零網路零出境，`prompt-api.d.ts` 特徵偵測。已知限制：官方語言
清單不含繁中；只餵 `buildQuickContext()` 精簡摘要避免超出 context window；
`promptStreaming()` 分塊語意在不同版本不同，用
`chunk.startsWith(acc) ? chunk : acc + chunk` 防禦寫法涵蓋兩種語意；單純 `+=` 無法正確處理
累積式 chunk。

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

### 母港快照與資料備份還原

`db.snapshot`（schema v7 引入）不受 M6 裁剪影響，`path` 為主鍵、每個 path 只留最新一筆。
`SNAPSHOT_PATHS`：`api_start2/getData`（master 表唯一來源）、`api_port/port`、
`api_get_member/require_info`／`slot_item`、`api_get_member/base_air_corps`／`mapinfo`。
`planStateRecovery()` 只在 raw events 為空時採用 legacy snapshot；raw events 存在時僅採用
`eventId` 嚴格小於第一筆 retained raw event ID 的 snapshot 作 baseline。

**baseline 的重播順序是「觀測時間」不是固定 path 順序**（`orderSnapshots()`）：每個 path
只留最新一筆，但**不同 path 的新舊互不相干**。`mapinfo` 與
`base_air_corps` 都會寫 `GameState.airBases`，而玩家的實際操作順序是「開海域選擇
（mapinfo）→ 開基地航空隊（base_air_corps）→ 補給」，固定順序把 mapinfo 排在後面，
固定順序會用**較舊的** mapinfo 覆蓋較新的 base_air_corps，使補給後的機數消失。
`api_start2/getData` 是唯讀 master 參照，
**永遠排最前**、不參與時間排序；`SNAPSHOT_ORDER` 退為白名單與平手時的次序。
契約鎖在 `tests/state-recovery.test.ts`。

**現行備份契約 v6**：只輸出 `kind:'full'` 的單一完整檔，檔名
`kanmusu-backup-YYYY-MM-DD-HHmmss.json`（本地時間，見 `backupFileName()`；資料夾裡若
同秒撞名則 `-2`、`-3`，見 `unusedBackupFileName()`），含
`snapshot`／`sorties`／`expeditions`／`factory`／`replays`／`wanted`／`shipObtained`／
`eventPlans`／`resources`／`resourceMarks`。`sorties` 只是摘要，沒有 `replays` 就不能重建
出擊編成與逐節點內容，故完整還原絕不可拆開。**備份表全空（全新安裝尚未擷取／還原）不得
寫檔**——空檔會蓋掉資料夾裡同日或舊固定檔名的備份；契約鎖在 `isEmptyBackup()`。v1 legacy-full 可單檔匯入；v2–v5 的舊
restore/replays 可在同一次檔案選取中同時提供，或由介面在兩次選取間暫存一檔、湊成一對後，再由
`combineBackupEnvelopes()` 先正規化成 v6 full；湊齊前絕不寫入資料庫。每個舊 schema 的表組合仍固定，舊檔不因缺少後來新增的表被拒。**匯入不是 merge，
也不會警告後覆寫**：第一次僅接受沒有 raw events、notified、projection metadata、目標 rows
的乾淨環境；validation、destination preflight、所有 writes、event-ID sequence reservation／
high-water 與 import marker 都在同一 transaction，任一失敗完整 rollback。marker 只為相容
舊拆檔的低層 restore 路徑保留，UI 不再逐檔匯入。

**雲端備份走 File System Access API**（`entrypoints/overview/fsa.ts`），不碰新權限（Google
Drive／WebDAV 原生 API 需 OAuth／host_permissions，違反權限精簡）。資料夾備份寫入一個
帶日期與時間的完整檔與 `viewer.html`——後者單檔離線、不需要擴充。空備份不寫檔；同一秒撞名加序號，不覆寫舊檔。

**重播保留規則**（`utils/retention.ts`）：保護判定由上而下——手動 ★ 釘選 → 打撈到新船
（`firstOwnedDropKeys`，須 `source='auto'`＋`observedEventId`）→ 斬殺 → 活動 boss → 所屬海域
尚未通關；皆非則只留最近 `keepRecentDays`（預設 45）天且保底最近 `keepRecentCount` 場。
裁剪的是重播原始封包，之後的完整備份也無法帶回該場展開細節；出擊摘要仍會保留並如實顯示。

**斬殺（cleared）偵測**：`detectClear()` 在 mapinfo 更新後比對量表，觀測到「未擊破→擊破」
就把該圖最近一場 boss 出擊標 `cleared`；只在「本次事件流曾看過該圖未擊破」時才判定轉變。
唯一未驗證：擊破當下遊戲是否即時推一筆 `now_maphp=0` 的 mapinfo（只影響觸發延遲不影響判定）。

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

背景 `alarms`／`notifications` 提醒已由 `entrypoints/background.ts` 實作；目前尚未實作的是
緊急泊地修理（連合艦隊出擊中機制，相關封包欄位未經真封包驗證）。

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

**機制前提**：標籤是船身屬性非編成容器，一艘船同時只有一個標籤、貼上不可逆；貼標時機是出擊，
由「關卡＋路線」決定，`api_sally_area` 是唯一權威；`allowedTags`（哪些標籤能走這條路線）與
`grantsTag`（無標籤船走這條路線會被貼上什麼標籤）是兩件不同的事；標籤 id 全活動唯一只增不減，
故一次活動一份計畫（`db.eventPlans` 主鍵 `areaId`）。

三層結構：Layer 1 標籤總帳（從 `api_sally_area` 即時分群，零輸入且權威）→ Layer 2 計畫
（手輸）→ Layer 3 檢查（純函式）。**燈號語意**：`ok`＝已持有本關允許的標籤；`blocked`＝持有
別的標籤走不了；`willStamp`＝**無標籤船即將被不可逆消耗**（非「安全可調度」）；`allowedTags`
未填一律 `unknown`，**不可判紅**。**計畫矛盾**分 `certain`（用 `grantsTag` 推定）與
`possible`（允許標籤有交集）兩級。

**「計畫」與「現實」是兩個維度，必須並排顯示以免被誤讀為不同步**：標籤總帳每列並排
「實際」（`api_sally_area`）與「計畫」（`plannedByTag()`，只認 `grantsTag`）兩欄；計畫欄
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

**未驗證**：標籤 id 實際語意（2026-08-04 已用真封包確認 `api_port/port` 會帶非零
`api_sally_area`，同一鎮守府多艘船同時掛 1/2/3/4 四種不同 id——但 id 對應遊戲裡哪個
標籤仍不知道，`wantedTag` 對應這條已收斂，見該函式註解）；標籤名是否存在於任何封包
（`nameSource` 的 `'auto'` 分支預留但目前不會被寫入，UI 一律手動命名）；`api_sally_flag`
是否為出擊制限旗標。剩餘驗證鉤子已埋在 `wantedTag`，下次活動自動撈。

### 鎮守府全船篩選（`utils/ship-filter.ts`）

**可裝備篩選已用真實完整 start2 驗證**：`api_mst_equip_ship` 是「完整覆蓋」不是「追加」——
有例外條目就用它，否則回退 `api_mst_stype[].api_equip_type`。**絕不能只看艦種**：
`api_mst_stype[2].api_equip_type['24']` 是 0（駆逐艦不能裝大發），但實際有 41 艘驅逐艦裝得了
大發系（例外條目覆蓋）。類別 id：24 上陸用舟艇（大發系）／34 司令部施設／45 水上戦闘機／
46 特型内火艇；type 24 值實測全部是 null（整個類別可裝）。

七選項下拉＝兩個布林組合，已對全 1751 艦驗算：大發系 96／內火 199／二者皆可 62／僅大發
34／僅內火 137／二者任一 233／皆不可 1518。**航速**：`api_soku` 只有 `{10:高速, 5:低速}`
兩檔已見樣本，篩選用「>=門檻」不列舉。**「高速戦艦」不是艦種**：`api_mst_stype` 的 8/9
都叫「戦艦」，高速/低速要靠 `api_soku` 合判——**篩選邏輯（`matchSpeed`／量表統計）永遠不得
拿 stype id 當航速捷徑**（真封包實測：stype 8 有 3 艘低速的 Гангут 線，stype 9 有 3 艘高速的
深海戰艦棲姫改）。⚠️ **但「不精確」不等於「什麼都不標」**：篩選抽屜的艦種 checkbox 若兩顆
都寫「戰艦」，使用者無法分辨群組。現行規則鎖在 `tests/ships-stype-label.test.ts`：
`buildStypeLabels()` **只在艦種
名稱真的重複時**才加註，群組層級用名冊多數決（多數高速→「高速戰艦」，另一群維持原樣
「戰艦」，低速側刻意不加註），逐艦的艦種欄則用**該艦自己的 `api_soku`**（故 Гангут 顯示
「戰艦」不是「高速戰艦」）、缺值回原樣；兩個篩選項不得使用相同標籤。
**補強增設**：`api_slot_ex` 三態
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

**趨勢圖固定為一張大圖、八條線，讓各資材共享同一時間軸並能直接比較變化**；圖例即開關，
`multiChartGeometry()` 的 y 值域只由「顯示中」的序列
決定；**雙 y 軸不做**（沒有共同基準）；序列配色是固定順序，資材 i 恆定拿第 i 個色位——
開關序列絕不重新分配顏色。**抽稀是純減量不平滑**（`downsample()` 每桶取最後一筆），平滑
會把「一次活動燒掉十萬燃料」的陡降磨圓。

**SVG 實作約束**：`hidden` 屬性對 SVG 元素無效，必須用 CSS `[hidden]{display:none}`；
`preserveAspectRatio="none"` 會拉伸 y 軸文字，因此採等比縮放＋`aspect-ratio`，線寬使用
`vector-effect: non-scaling-stroke`。

新增語意色 `--res-gain`／`--res-drain`，**刻意不挪用** `--dmg-*`／`--sally-*`。

### 視窗適應與遊戲靜音（`entrypoints/theater.content.ts`＋`utils/theater.ts`＋`utils/audio-mute.ts`）

產品意圖是**讓遊戲畫面等比填滿瀏覽器視窗**（不是全螢幕、不是手動縮放劇場）。UI 文案為
「視窗適應」／Fit to Window／ウィンドウ適応；程式碼／訊息型別仍沿用 `theater` 識別名。

DMM 遊戲頁已改版為 SPA（`play.games.dmm.com/game/kancolle`），沒有固定 id/class，故遊戲框靠
**src 主機名＋尺寸辨識**（`pickGameFrame()`），無命中一律回 null 不亂挑。標記屬性＋外部
樣式表，不寫 inline style；不用 `position: fixed` 當主要手段（祖先的 transform/filter/contain
會變成 containing block）。

**顯示的是「遊戲畫布」不是「整個 iframe」**：畫布位置由框內 content script 跨源回報，父頁
`clip-path: inset()` 裁掉其餘部分並置中；**只信任「直接子框」的回覆**（`e.source ===
frame.contentWindow`），量不到就退回整個框不裁切、不猜矩形。`transform-origin` 固定 `0 0`。

**工具列固定佔底部一條，絕不覆蓋遊戲畫面**（浮動 UI 在此環境無法「自動閃避」）。只留進入／
離開／靜音／拍照——**不做 +/-、百分比、1:1、平移鈕**（那些會脫離 fit、弄出黑邊）。

**永遠 contain／fit，拉邊框自動 refit**：`fitZoom()` 硬性維持 contain（`Math.min`），cover
（`Math.max`）會裁掉部分遊戲畫面，因此不得採用，也不得加入會脫離 fit 的手動縮放 UI。
`enter()` 直接呼叫 `fitWindow()` 一次到位。頁面縮放交給瀏覽器原生 Ctrl／⌘＋滾輪。

**Esc 離開**：焦點在遊戲框內時由 bridge 轉發到 `window.top`，**一律 passive、不
stopPropagation／preventDefault**；並驗 `e.origin` 為 `kancolle-server.com`。

**靜音**：`installAudioMute()` 在 MAIN world（document_start）把每個 `AudioContext` 的
`destination` 換成 master GainNode；`<audio>`/`<video>` 同理。BGM 路徑不可考時背景用
`tabs.update({muted:true})` 保底（新增 `tabs` 權限）。**「靜音沒反應」第一嫌疑是遊戲分頁
沒 F5**：content script 改動須重新注入，視窗適應用 `executeScript` 立即注入才生效，
interceptor／bridge 不會。⚠️ **未驗證**：艦これ用 WebAudio 還是 media 元素播音（兩條路徑
都接了，無樣本佐證）；跨源框存在與否（若有會影響畫布量測，退回不裁切）。

**狀態存放**：靜音開關與語言鏡像存 `db.meta['game-page']`——**這一列不參與投影、不引用
任何 event id**，`backup.ts` 的 `restoreMarker()` 會略過它。是否啟用存 DMM 頁自己的
localStorage（`kc-theater`），不進 Dexie、不進備份。

**授權流程**：popup「視窗適應」→ `permissions.request()`（**必須是點擊手勢的第一個呼叫**，
先 await 別的事情會失去手勢資格）→ `scripting.registerContentScripts`
（`persistAcrossSessions`）→ 對當前分頁 `executeScript` 立即注入。

### 拍照（`utils/screenshot.ts`＋`MSG_CAPTURE_TAB`）

只擷取遊戲畫面、不含 DMM 頁面其餘部分。**裁切矩形絕不重新推算**：兩個入口（popup／視窗適應
工具列）都呼叫已校準過的 `measureScreenshotRect()`；量不到畫布時回傳 `rect: null`，
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
先授權才生效；掛在頂層 DMM 頁會依賴 optional permission，無法提供同等保護。

**已知代價，刻意接受**：跨源 iframe 掛 `beforeunload` 可能導致按「取消」後對話框又跳一次
（Chromium 已知問題，crbug.com/1119438；CDP 自動化關閉分頁不會觸發 `beforeunload`，因此
此行為只能依已知 bug 報告與實機回報判斷）。零權限、可能跳
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

### 遠征紀錄（`sections/exped-log.ts`＋`utils/expedition-stats.ts`）

**這一區的主體是「逐筆明細」，不是統計**：一趟遠征回來拿了什麼資源、多少、成功還是失敗，
是本區的核心資料。依遠征種類加總的「各遠征次數與
收穫」回答的是另一個問題（哪個遠征跑最多／最賺），**是次要的查詢工具**，故收進 `<details>`
放在明細**下方**且預設收合。版面順序固定為：期間總計（一行脈絡）→ 逐筆明細（主體）→
收合的彙總。
- 彙總的展開狀態**必須持久化**（`Prefs.statsOpen`）：表頭排序會觸發整塊重繪，不記狀態的話
  每點一次排序就自己收合。`toggle` 事件不冒泡、無法用 body 委派，每次重繪後就地重綁。
- 明細的**編成欄預設收合**（`<details class="el-fleet-d">`，summary 顯示「N艘」）：六艘 chip
  攤開會讓每一列高好幾倍。折疊一律用原生 `<details>`＋`::before` 字元 caret，不用
  `transform: rotate`（design-guidelines §4.3）。CSV 仍匯出完整編成——收合只是顯示層的事。
- 契約鎖在 `tests/exped-log-overview.test.ts`。

**為什麼落在遠征紀錄而不是資源紀錄**：遠征收入是逐筆事件獲得量（精確可加總），資源紀錄的
消長是餘額差分（封包只給餘額）——兩者語意不同，混在一起會被拿去互相對照卻對不起來，
缺席規則也相反（資源紀錄無樣本時必須「不可考」，遠征收入照樣算得出來）。

**母集合是「紀錄中的」遠征，不是遊戲的完整歷史**：`db.expeditions` 由面板 EventProjector
投影，面板長期沒開＋raw event 已被 M6 裁剪的期間會永久缺席。**回航道具欄位語意未經真封包
驗證**，一律以 `id×count` 原樣彙總，不併入四資源小計。**`api_get_material` 並非永遠是陣列**
（實機已驗證觸發情境：遠征中途取消／提前召回而失敗，`api_clear_result=0`）——`archiveExpedition`
用 `Array.isArray` 防禦，非陣列一律視同無資源資料退回 `[]`；確切非陣列時的原始值仍缺真封包
樣本佐證，不猜語意。**中途取消的遊戲機制**（使用者提供之遊戲設定，非封包驗證）：不獲得任何
遠征物資與報酬（故退回 `[]` 語意上就是對的，非僅防禦性容錯）；出發時已扣的燃彈與已花費時間
不退還；提督（司令部）經驗值降到原本 30%，艦娘自身經驗不受影響——後兩者本專案目前未追蹤
遠征的經驗/燃彈扣還，這裡僅記錄機制供之後若要做相關功能時參考。

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

**自動擷取（開發用 UI）**：面板「動態」分頁的「待驗證封包」清單——**僅
`npm run dev` 或本機 `localStorage.kc-debug-ui='1'` 時顯示與擷取**（`utils/debug-ui.ts`）。
上架／`npm run build` 預設關閉（營運對玩家檢視封包敏感；且無 UI 時繼續寫 wanted 會永久
釘住 raw events）。開啟時：`GameState.wantedTag(path,api)` 命中即記入 `db.wanted`，
**同時自動觸發下載**（`downloadJson()`，`entrypoints/panel/main.ts`）把
`{tag,path,ts,req,api}` 存成 `kc-wanted_{tag}_{path}_{ts}.json`，落地到瀏覽器預設下載
資料夾（一般是 `~/Downloads/`）——用 Blob＋`<a download>`，不需要新增 `downloads` 權限
（見設計原則 5 權限精簡）。清單仍保留「複製 JSON」／刪除／清空供事後管理與補救重存。
**有上限**：同一分類 5 筆、總數 50 筆——`db.wanted` 引用的 raw event 受裁剪
永久保護，達上限時清單明說並提供刪除，**不可改成靜靜略過，也不可拿掉保護語意**。
出擊紀錄的「單場 JSON 匯入」同屬開發用 UI，正式建置不顯示（`utils/sortie-import.ts` 與
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
  `THIRD-PARTY-NOTICES.md`。
- 非平凡改動跑 `npx tsc --noEmit`；戰鬥/狀態邏輯改動用真實封包做執行期驗證。
- **面板系統圖示擬真剪影風格（定版）**：砲擊支援、雷擊支援、航空支援、對潛支援、
  陸航、索敵雷達、觸接、對空 CI、夜戰、友軍及未來新增的 panel 系統圖示，除非使用者
  明確指示，全部遵守 `docs/design-guidelines.md` §5.1；正式 panel 與離線預覽共用
  `public/icons/tactical/` 的透明剪影資產，不得任意改成 emoji、文字圓點或另一套圖示語言。
- 面板 UI：分頁自動切換後，使用者手動切過即暫停自動，直到情境變化（`autoSwitch`）。
- **出擊資訊欄＋艦隊編成版面（硬約束）**：
  1. **釘死**：`#tabpanel` 固定 `height: 270px`（**禁止**改 `max-height` 讓不足時
     收縮——編成會隨分頁內容上下跑）；戰鬥列第二列固定 `165px`；陣型／支援／対空CI／
     夜戰／rank／友軍列釘在敵艦區下方，**不隨敵艦數量位移**。敵艦少於 6 時列內留白
     是刻意的。
     2. **七船**：窗高 850（`background.ts openPanelWindow`，實機截圖校準）。單隊把
     編成區多出來的高度還給列距／列內距（一般列 `.ship:has(.ship-body)` padding 4px、
     `.ship-body` `row-gap` 6px；七船 `.fleet-seven` 再收至 padding 1px、
     `row-gap` 2px；若摘要出現 `.fs-ops` 狀態列，另加 `.fleet-seven-ops` 並把
     `.ship-vitals` 的 gap 收至 1px，以吸收狀態列高度；艦隊 chip 圖示固定 16px，
     以免第 7 艘被裁切）。實機窗高 850
     **含標題列**，七船用掉必須落在離線預覽硬安全線 **≤740px**，否則第 7 艘會被裁掉。
     **不准加高視窗、
     不准長出捲軸**；連合 compact 不吃這筆，且 compact 的一般裝備槽（含搭載數）必須
     維持單一 row，不得因五格空母而換行撐高艦列。要再收高度只准收 `#tabpanel` 或
     fleetnav／fleets／艦列 padding，
     七船由 `main.ts` 依 `f.ships.length >= 7` 加上 `.fleet-seven`，CSS 只對
     `.fleet.fleet-seven` 收緊；不可用 `.ship:nth-of-type(7)`，因為摘要 `.fsummary`
     也是 `div`，會讓艦列序號判斷失真。
     **不准拆 165px 釘、不准讓陣型列跟著上移**。
  3. **裝備列單行**：`.chips { flex-wrap: nowrap }`；一般格／打洞鎖 min/max（現為
     40／34，`.chips` gap 2、`.sub-row` gap 5——**動格寬前照這組數字重算**：
     5×40＋gap 8＝208，再加打洞格仍須留出右欄間距）。左欄只放五格＋打洞
     （`.sub-row { grid-column: 1 }`），**打洞格永遠在第五格之後**：一般槽補位固定
     補到 5，不可改成「目前編成最大槽數」——沒有 5 槽艦時打洞格會逐艦往左跑。
     士氣／燃彈在跨兩列的 96px `.ship-vitals`
     （對齊預覽右窗）。內容區必須是 420px 內寬——`windows.create({width:420})`
     含外框，面板啟動時 `fitPanelInnerWidth` 只對 popup 補差值；`html,body`
     `overflow:hidden` 避免直向捲軸再偷寬。`.chips` 必須 `max-width:100%` 且
     `width:244px`、`max-width:100%` 且 `overflow:visible`，不得侵入右欄，也不得裁切增設槽；
     只准長不准縮。HP 條必須蓋過
     預設 `.hpbar{width:56px}`。燃彈是 10px `.vit-sup`（圖示鎖 min/max 10px，
     SVG viewBox 不得把 flex min-width 撐成 32px），禁止把 24px `supply-combo`
     chip 放回裝備列。SVG 與「///」不可撐破預算；**禁止** `display: contents`＋
     打洞 `margin-left: auto`，這會裁掉整列；也**禁止**把士氣／燃彈塞進
     裝備列（那會讓彈藥溢出右緣）。
  4. **不准裁字**：燃彈「100」必須完整可見（`.vit-sup` 綠／棕數字，不是 56px chip）。
  4b. **編成區的大破警示長在艦身上，不進摘要、不掛條件列徽章**：摘要徽章一 wrap 就把
     七船裁掉；聯合檢視欄頭條件列一出現就憑空多長一列、整排艦往下推。單隊列用列底
     洗紅＋右緣 3px 紅軌＋列內 `.taiha-mark`＋殘 HP 轉紅；連合同一套（compact 無
     96px 右欄，血量橫列）。退避艦不算大破。入渠中的艦無法出擊，改顯示 `.dock-mark`
     （只寫「入渠」，**不附倒數**——倒數在一般分頁入渠欄），不算大破警示。選擇器
     `.st-major:not(.in-dock) .ship-id .grow, .ship.c.st-major:not(.in-dock) .c-top .grow`。連合**不顯示**泊地
     修理／給糧。出擊中的完整大破警告本來就在出擊分頁（見第 5 點）。
     摘要兩列互不 wrap：有狀態才出現上面 `.fs-ops`（全稱線框）；`.fs-metrics` 制空／
     索敵為主（`--text`／600），航速／Lv／TP 為 metadata。索敵顯示 `toFixed(1)`。
  5. **大破警告一律 absolute，不參與版面計算**（`.s-taiha`，釘在航空戰欄的
     `.s-air-wrap` 上）：一般大破預設以紅色覆蓋框顯示「大破！」與退避條件，覆蓋敵我方
     飛機戰損。點擊後只隱藏這兩行文字，保留原位置、原尺寸的紅框，同時重新顯示飛機
     戰損；**沒有收縮態，且不得把警告移到航空戰欄外**。旗艦大破優先顯示強制返航訊息，
     不得同時出現司令部退避。若放入戰鬥列的一般流，警告一出現就會把敵艦列與下方固定
     資訊整排往下推。驗收時量 `.s-battle-row` 與下方系統列的位置：完整警示／隱藏文字／
     無大破三態都必須相同。
  6. **無障礙覆寫要連 `.s-taiha.open` 一起列**：它自帶不透明底色（要遮住機數），選擇器比
     `.taiha-alert` specific，`prefers-contrast: more`／`prefers-reduced-transparency`
     兩個 media block 只寫 `.taiha-alert` 會有一態吃不到覆寫。
  7. **大破警告文案的 `\n` 是刻意斷行點，別當成可有可無的空白刪掉**：框只有約 180px 寬，
     中日文沒有空格可斷，自動折行會把「大破艦」「強制返航」從中間切開；長度不固定的
     `{item}`（裝備名）**必須單獨佔一行**。展開態靠 `.s-taiha.open .taiha-head/.taiha-hint`
     的 `white-space: pre-line` 生效。隱藏文字態不顯示文案，紅框仍維持原尺寸。英文靠空格自然折行、不加
     硬斷點，但行內字串要夠短，否則框會長到蓋住上面的航空戰列。
  回歸參考：`samples/fleet_slot*.png`。視覺階層、預覽量測與約束理由見
  `docs/design-guidelines.md` §7。實作見 `panel/index.html`／`panel/main.ts` 註解 `#2`／`#4`。
- **面板一般分頁（硬約束）**：資源全寬 4×2（圖示＋數字成組靠左，組距大於組內距）；
  遠征／入渠／建造三欄並排，身分用分界線上的色線＋圖示騎線（不另開標題列、不進資料列）；
  任務吃剩餘高度、區內自捲。`#tabpanel.has-general` 本身不捲（比照調度 `has-order`）。
  五塊直向堆疊會在全滿時把任務推到 270px 摺線下，並讓抬頭跟著捲走，因此禁止採用。
  遠征名稱不常駐佔欄寬（hover／點列展開）。契約鎖在 `tests/general-tab-layout.test.ts`。

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
| M7 圖示化 | ✅ | 76 顆原創 SVG（裝備61＋資源8＋UI7），全部原創、無第三方素材 |
| M8 popup＋鎮守府情報總括 | ✅ | 全部分區完工、無 stub；db schema v12 |

### 待辦（依優先序）

1. 節點字母新活動開圖：上游 `edges.json` 未更新前顯示原始 edge 編號，重新下載後重跑產生器即可。
2. 活動特殊點燃彈費率；連合 A／B 各隊分開計算大漩渦電探數。
3. gaugeType 3（TP輸送）量表欄位驗證；TP 表新變種裝備補值。
4. 掉落統計彙總（資料已在 `db.sorties.drop`，缺 UI 彙總視圖）。
5. 斬殺偵測的即時性待觀測；欄位判定已用真封包定案。
6. 第二艦隊旗艦不沉時的殘 HP 值仍缺封包證據。
7. 部分艦載機損耗的熟練度下降量仍待 wiki 或封包證據；目前只標 `alvStale`，不推算。
8. M4 殘項：side panel 選配、視窗位置記憶、Firefox 打包驗證。
9. 亮色主題細部調校；遠征紀錄回航道具欄位未經真封包驗證。
10. 活動作戰板三項待驗：標籤 id 語意、標籤名是否存在於封包、`api_sally_flag` 是否為出擊制限
    旗標；「標籤 ← 哪次出擊」自動知識庫與貼錯標籤事後警示為第二版功能。現有三份
    `api_sally_flag` 樣本在基地航空隊出擊前後維持相同值，無法支持「剩餘挑戰次數」語意；
    後續擷取必須鎖定值發生變化才觸發，避免每次載入 mapinfo 都產生相同樣本。
11. 友軍艦隊「強力友軍艦隊」支援消耗高速建造材（使用者提供之遊戲設定，非封包驗證）：
   需先取得相關封包，屬與現有 `api_friendly_battle` 不同層次（出擊前選項 vs 戰鬥中友軍）。
12. 劇場模式／靜音實機待驗：跨源框是否存在、WebAudio vs media 元素、stacking context 偏移。
    三者可在下次登入遊戲分頁時用 `__kcAudio.contextCount()` 與 devtools 快速定案。
13. id 165/166（poi 舊資料，現行 master 快照查無此 id）性質待確認，暫留不動（見「遠征資料
    完整性」節）。
