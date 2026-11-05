# fleet-chronometer 開發指引

本檔是 Claude Code、Codex 等 coding agent 共用的唯一專案指引；不另維護 CLAUDE.md，避免兩份規則分歧。

艦これ（KanColle）用 MV3 被動監控擴充：觀察 `kcsapi` 封包，在面板與「鎮守府情報總括」顯示艦隊、遠征、入渠、基地航空隊、關卡、戰鬥與歷史資料。技術棧為 WXT、TypeScript、Dexie（IndexedDB），純前端、無後端。

本檔只放跨功能硬約束與查閱索引。細節按需讀取，不要整本載入：

- 封包欄位、公式、樣本證據、功能細節：[`docs/engineering/`](docs/engineering/README.md)，依主題分檔；先看索引 README，只讀相關的主題檔。
- 介面、圖示、面板尺寸：[`docs/design-guidelines.md`](docs/design-guidelines.md)。
- 譯名與台灣華語：[`docs/translation-guidelines.md`](docs/translation-guidelines.md)。
- `docs/archive/`：封存的原始設計，只在調查原始設計意圖時查閱，平常不讀、不據以實作。

文件與程式碼或測試不一致時，以目前程式碼與測試為準。

## 工作方式

- 回應使用者一律用繁體中文（台灣用語）；程式碼註解用繁體中文。
- 只做當前任務需要的改動；保留既有架構、命名與工具鏈，不做無關的整理或重構，也不因個人偏好改寫既有實作。
- 註解、專案文件與變更說明（commit、PR）只寫目前行為，以及從程式碼看不出的理由、約束或風險。不保留除錯歷程、未合入方案或舊實作；規則寫成「現行規則＋理由」，不敘述演變經過。

## 硬約束

1. **被動觀察**：只觀察遊戲既有流量，不重放、修改、延遲、重排或代發請求，不注入指令、不自動執行遊戲操作、不改變遊戲行為。攔截器只掛在遊戲 `window.axios` 的 response interceptor；**禁止**取代 `window.fetch` 或 `XMLHttpRequest.prototype`，以免影響其他擴充的 DevTools `getContent`。契約見 `tests/interceptor-capture.test.ts`。
2. **資料安全**：axios 觀察器在入列前移除請求的 `api_token`／`api_verno`，避免憑證進入暫存佇列與頁面訊息；bridge 與 background 再次移除。永不寫入 DB、上傳或送出憑證；不得讀寫 DMM Cookie。不得以任何改動默默遺失、覆寫、重複或損壞 events、IndexedDB、出擊／遠征／工廠歷史、replays、備份與還原資料；資料格式變更必須有相容處理或遷移。
3. **唯一擷取入口**：`ApiEventRow` 是 provider 邊界。MAIN world 送出正規化 path、原始 response text 與 request body；bridge 驗證同源、移除敏感欄位、建立固定 `captureId` envelope，retry 最多一次且沿用同一 envelope。background 解析 `apiText` 後只能經 `ingestEvent()` 寫入 `db.events`。單場 JSON／CSV 匯入是例外：只寫 derived tables，不寫 raw event。
4. **持久化順序**：新 raw event 先存 `pending`，transactional claim 後才進 `processing`；副作用成功才標 `done`，失敗回到 `pending`。同 `captureId` 必須 path 與 timestamp 相同，否則拒絕 collision。SW 啟動時回收遺留 processing，recovery 與新 ingestion 共用順序 queue。
5. **投影與裁剪**：`EventProjector` 是 derived tables 的入口；cursor 前事件只重建 state context，cursor 後事件才寫 derived rows。每筆投影成功才推進 cursor。raw event 只會在已投影且通過保護規則時裁剪；投影 metadata 無效時停止裁剪。snapshot 只作 GameState baseline，不送入 projector。
6. **核心可獨立執行**：`utils/state.ts`、`utils/battle.ts` 及其他標示為純函式的核心不得依賴 `chrome.*` 或 DOM，要能用 samples 與 Node／Vitest 驗證。
7. **權限精簡**：正式 manifest 的 permissions 由 `wxt.config.ts` 與 `tests/manifest.test.ts` 定義，目前為 `activeTab`、`alarms`、`notifications`、`scripting`、`tabs`；正式 build 的 `host_permissions` 必須為空。劇場模式的 DMM 存取權走 `optional_host_permissions`，只在使用者操作時請求。新增權限必須說明程式碼看不出的必要性。
8. **未驗證欄位不得猜**：欄位佈局、索引與語意需要下列任一證據：`samples/` 的真實封包，或成熟開源工具（KC3Kai、ElectronicObserver、poi 等）實際解析該欄位的程式碼。採用外部專案時，在註解寫明專案與檔案路徑，能交叉比對兩個專案更好；依 clean-room 重寫、不複製程式碼，並登錄於 `THIRD-PARTY-NOTICES.md`。真實樣本與外部專案不一致時以樣本為準。兩者都沒有時保留原始值或回傳 `null`，UI 顯示「不可考」／「推算」並說明限制，同時註明需要手動驗證或真實封包。wiki 文字可作遊戲機制與公式依據，但不能單獨證明欄位佈局。
9. **UI 狀態與資訊**：
   - 同一事實只完整呈現一次；缺值不是 0，排序時缺值放最後。
   - 帶關鍵字、日期、數字輸入或使用者展開／捲動狀態的分區，不得因每次變更而全量重繪控制項。
   - 非同步分區先畫 shell、綁事件，再讀 DB；載入中或錯誤必須顯示狀態，不得留白。
   - 折疊用原生 `<details>`；語意色不可跨功能挪用；面板主色／輔助色／強調色依 design-guidelines §1.5 的 631 原則。
   - 日期一律「年/月/日」、24 小時制，走 `utils/date-format.ts`，不得用 `toLocaleString()`（§2.6）。
   - 所有可見文案（含 `title`、無障礙說明）只寫功能意義、條件與必要限制，不寫資料來源名稱、網站、連結或「依 Wiki 推算」等歸屬；來源只登錄於 `THIRD-PARTY-NOTICES.md` 與專案文件（§2.5）。
   - 改介面、可見文案或固定欄寬樣式時，台灣華語、英文、日文三語都要核對排版：拉丁文通常比漢字長，日文假名句常比華語長，只看部分語言會漏掉溢出、重疊或裁切。放不下先縮短文案（完整說明移到 `title`），仍不夠才縮小字型。通過條件見 §2.4。
10. **翻譯**：任務導覽與 panel 共用任務目錄翻譯。繁體中文以台灣華語撰寫與校對，不得由簡體中文轉換。專有名詞依三層順序：原文漢字沿用（英文用玩家社群譯名）→ 假名部分依史料 → 都沒有才在地化，活動／任務／遠征譯名統一是第一順位。任務條件以日文原文為準，英文資料只作輔助。

## Live 遊戲安全

只有開發者本人可以登入與操作 live 艦これ。agent 不得登入 DMM、開啟已登入的遊戲頁、操作或自動化遊戲、對 live 伺服器送請求，或從 live 遊戲擷取新封包。

瀏覽器只用於本機頁面：開發頁、擴充 popup／side panel／overview、重播檢視、mock 頁與 `.preview/*.html`。瀏覽器工具無法開 `file://` 時，從專案根目錄在背景啟動 `python3 -m http.server <port>`，改開 `http://localhost:<port>/.preview/<name>.html`，檢視後關閉 server。

需要 live 驗證時，停下來提供開發者手動檢查步驟；除非開發者提供 log、截圖或封包，不得宣稱已驗證 live 行為。

## 建置與驗證

```bash
npm run build       # 正式 Chrome MV3，輸出 .output/chrome-mv3
npm run dev         # 開發模式，輸出 .output/chrome-mv3-dev
npx tsc --noEmit    # 型別檢查
npx wxt prepare     # 型別生成（首次或型別錯誤時）
npm test            # Vitest
```

- 一般改動最低驗證：正式 build 與型別檢查。戰鬥／狀態／資料格式改動另跑相關 Vitest 與 samples 驗證。
- 修改 source 後需重新 build、在 `chrome://extensions` 重新整理擴充；已開啟的遊戲分頁要 F5 才會重新注入 content script。
- 離線 UI 預覽（不連遊戲）：`npx vite-node --config vitest.config.ts tools/preview/<name>.ts`，可用的 `<name>` 見 `tools/preview/`，輸出到 `.preview/`。
- 370px 編成的定版參考是 `.preview/panel-width-hp-resource-zh.html` 的「試排｜七船、原位加高 HP＋油彈條」場景（英文版對應 `-en.html`）：保留原艦種徽章設計與位置、補強增設 chip 完整留在編成列內；新增面板分頁預覽時沿用這個場景的編成 markup 與樣式。

完成前回報：改了哪些檔案、跑了哪些驗證與結果、哪些驗證沒做及原因；需要 live 驗證時附手動步驟。

## 資料流與檔案入口

```text
遊戲 iframe
  → interceptor.content.ts（MAIN，觀察 axios response）
  → bridge.content.ts（ISOLATED，驗證同源、去 token、送 runtime message）
  → background.ts（解析、ingestEvent、snapshot、通知、資源序列、裁剪）
  → panel/main.ts（baseline + raw event projection + 即時 UI）
  → overview/（只讀 GameState／derived tables，不做投影；收 kc:live 後只補套 reducer，見 overview/live-state.ts）
```

| 範圍 | 主要檔案 | 變更前必讀 |
|---|---|---|
| 擷取與生命週期 | `entrypoints/interceptor.content.ts`、`entrypoints/bridge.content.ts`、`entrypoints/background.ts`、`utils/ingestion-persistence.ts`、`utils/background-ingestion-lifecycle.ts` | 本檔硬約束 1–5、`docs/engineering/capture.md`、對應 tests |
| 狀態與投影 | `utils/state.ts`、`utils/battle.ts`、`utils/event-projector.ts`、`utils/projection-cursor.ts`、`utils/event-pruning.ts` | `docs/engineering/battle.md`、`maps.md`、samples |
| 面板 | `entrypoints/panel/`、`panel/index.html` | design-guidelines §7、面板相關 tests、離線 preview |
| 情報總括 | `entrypoints/overview/`、`utils/*-log.ts`、`utils/equip-ref.ts`、`utils/stype-label.ts` | `docs/engineering/` 對應主題檔、design-guidelines §4.7／§4.8 |
| 劇場與拍照 | `entrypoints/theater.content.ts`、`utils/theater.ts`、`utils/audio-mute.ts`、`utils/screenshot.ts`、`entrypoints/panel/fleet-photo.ts`、`utils/fleet-photo.ts` | `docs/engineering/game-page.md`、`fleet-photo.md` |
| 資料庫與備份 | `utils/db.ts`、`entrypoints/overview/sections/backup.ts`、`entrypoints/overview/fsa.ts` | `docs/engineering/capture.md`、`backup.md`；schema 或格式變更先確認相容性 |
| 產生物與圖示 | `utils/gamedata-names.ts`、`utils/map-edge-letters.ts`、`utils/map-spots.ts`、`utils/map-geo-data.ts`、`utils/route-suggestions.ts`、`utils/quest-graph-data.ts`、`utils/quest-goal-data.ts`、`public/icons/` | `docs/engineering/roster.md`「艦名／裝備名譯名表」、各產生器與 `tools/*/README.md`；產生物勿手改 |

## 不可破壞的目前契約

- **IndexedDB**：schema v14。`events` 以 `captureId` unique index 去重並保存 `postProcessState`；`resources` 以來源 event id 冪等保存，`resourceMarks` 保存活動時間點；`questObserved` 保存本機觀測到的任務領獎，`questSeen` 保存曾出現在任務清單的任務（單發前置推論的永久證據）。歷史資料不回填不存在的 capture／processing／projection metadata，也不把 snapshot 當 raw event。
- **匯入與備份**：單場 JSON 只接受本專案 `toKc3Replay()` version 4，或已有 fixture 證實的 KC3Kai logger 格式；CSV 與單場匯入都借 event id 但不寫 raw event。備份還原是乾淨環境的完整 transaction，不是 merge；空資料不得寫成備份。
- **關卡量表**：`mapInFinalPhase()` 對 gaugeType 2 使用同一血條的 Boss HP，門檻為 `nowHp <= bossHp`；`nowHp === 1` 是不需 Boss HP 的唯一特例。gaugeType 3 的量表欄位尚未以真封包驗證，不能用未證實的場數公式取代。
- **戰鬥**：血量與敵方陣列為 0-indexed，沒有舊格式的 leading `-1`；`battleresult` 必須排除 battle 分支。聯合艦隊、航空／基地、友軍與支援欄位只依 samples 與 tests 維護。
- **重播**：原始戰鬥封包存在 `db.replays`；裁剪只影響詳細重播，`db.sorties` 摘要保留。缺出擊開始事件或必要艦隊快照時，只保存可建立的摘要，不補猜編成。
- **待驗證擷取**：`wantedTag()` 只留渦潮表外且真有 `api_happening`、以及未知 sally 系 key。正式 build 預設關閉 debug UI（`utils/debug-ui.ts`）。`db.wanted` 會永久保護對應 raw event，達上限必須明說，不可靜默略過，也不可擴充會洗版的鉤子。
- **活動資料**：節點字母只走 `utils/map-node-letters.ts` 查表，新海域沒有對照時顯示原始 edge id。活動標籤的未驗證語意、`api_sally_flag` 與其他待驗證欄位保留原始值，不自行命名或推導。
- **版面**：面板 content 寬 370px，popup 啟動時把內容區補到 370；編成六／七船在有無 `.fs-ops` 下都以 730px 為目標、740px 為硬上限，七艘完整顯示、裝備槽單行、出擊警告不推動下方系統列。摘要與遠征雙欄以 370px 實際排版核對，9 項以上條件逐列雙欄並允許換行。情報總括左右並排分區在內容區放得下兩欄時不得改單欄（§4.7）；同名艦種篩選／標籤走 `utils/stype-label.ts`（§4.8）。改面板或 overview 版面前先讀 design-guidelines 對應節，其他 CSS 數值以該文件為準。
- **圖示與第三方**：panel 系統圖示維持 design-guidelines §5.1 的剪影語言；第三方邏輯 clean-room 重寫，來源登錄於 `THIRD-PARTY-NOTICES.md`。

## 會影響取捨的待辦

詳細狀態以程式碼、測試與 `docs/engineering/` 對應主題檔為準。

- 新活動的 edge 對照表、活動特殊燃彈費率、TP 量表與新裝備值仍需資料或真封包。
- 掉落統計彙總視圖未完成；斬殺偵測的即時觸發待實際 mapinfo 時序觀測。
- 部分艦載機損耗後的熟練度下降量、第二艦隊旗艦不沉時的殘 HP、遠征回航道具欄位仍不可考，維持估算／原始值／null。
- 活動標籤 id／名稱、`api_sally_flag`、強力友軍消耗、劇場跨源框與音訊路徑待開發者以 live 遊戲手動驗證。
- M4 尚有 side panel、視窗位置記憶與 Firefox 打包驗證。

## 單一真相來源

版本看 `package.json`，manifest 看 `wxt.config.ts` 與 `tests/manifest.test.ts`，資料庫版本看 `utils/db.ts`，測試命令看 `package.json`。本檔不維護里程碑；盤點進度時查 git 與測試。
