# CLAUDE.md — fleet-chronometer

艦これ（KanColle）用 MV3 被動監控擴充：觀察 `kcsapi` 封包，在面板與「鎮守府情報總括」顯示艦隊、遠征、入渠、基地航空隊、關卡、戰鬥與歷史資料。技術棧為 WXT、TypeScript、Dexie（IndexedDB），純前端、無後端。

本檔是日常開發入口，只保留跨功能硬約束與查閱索引。封包欄位、公式、樣本證據與功能細節集中在 [`docs/engineering-log.md`](docs/engineering-log.md)，先用 [`docs/engineering-log-index.md`](docs/engineering-log-index.md) 定位章節；介面、圖示與面板尺寸集中在 [`docs/design-guidelines.md`](docs/design-guidelines.md)。文件若與程式碼或測試不一致，以目前程式碼與測試為準。

## 必須遵守的規則

1. **被動觀察**：只觀察遊戲既有流量，不重放、修改、延遲、重排或代發請求，不自動執行遊戲操作。攔截器只掛在遊戲 `window.axios` 的 response interceptor；**禁止**取代 `window.fetch` 或 `XMLHttpRequest.prototype`，以免影響其他擴充的 DevTools `getContent`。契約見 `tests/interceptor-capture.test.ts`。
2. **資料安全**：bridge 移除 `api_token`／`api_verno`；永不寫入 DB、上傳或送出。不得以任何改動默默遺失、覆寫、重複或損壞 events、歷史、replays、備份與還原資料；資料格式變更必須有相容處理或遷移。
3. **唯一擷取入口**：`ApiEventRow` 是 provider 邊界。MAIN world 送出正規化 path、原始 response text 與 request body；bridge 驗證同源、移除敏感欄位、建立固定 `captureId` envelope，retry 最多一次且沿用同一 envelope。background 解析 `apiText` 後只能經 `ingestEvent()` 寫入 `db.events`。單場 JSON／CSV 匯入是例外：只寫 derived tables，不寫 raw event。
4. **持久化順序**：新 raw event 先存 `pending`，transactional claim 後才進 `processing`；副作用成功才標 `done`，失敗回到 `pending`。同 `captureId` 必須 path 與 timestamp 相同，否則拒絕 collision。SW 啟動時回收遺留 processing，recovery 與新 ingestion 共用順序 queue。
5. **投影與裁剪**：`EventProjector` 是 derived tables 的入口；cursor 前事件只重建 state context，cursor 後事件才寫 derived rows。每筆投影成功才推進 cursor。raw event 只會在已投影且通過保護規則時裁剪；投影 metadata 無效時停止裁剪。snapshot 只作 GameState baseline，不送入 projector。
6. **核心可獨立執行**：`utils/state.ts`、`utils/battle.ts` 及其他標示為純函式的核心不得依賴 `chrome.*` 或 DOM；要能用 samples 與 Node／Vitest 驗證。
7. **權限精簡**：正式 manifest 的 permissions 由 `wxt.config.ts` 與 `tests/manifest.test.ts` 定義，目前為 `activeTab`、`alarms`、`notifications`、`scripting`、`tabs`；正式 build 的 `host_permissions` 必須為空。劇場模式的 DMM 存取權走 `optional_host_permissions`，只在使用者操作時請求。新增權限必須說明程式碼看不出的必要性。
8. **未驗證欄位不得猜**：沒有真實封包證據時，保留原始值或回傳 `null`，UI 顯示「不可考」／「推算」並說明限制。演算法可參考社群資料，但欄位佈局與索引要先用 `samples/` 驗證。
9. **UI 狀態與資訊**：同一事實只完整呈現一次；缺值不是 0，排序時缺值放最後。帶關鍵字、日期、數字輸入或使用者展開／捲動狀態的分區，不得因每次變更而全量重繪控制項。非同步分區先畫 shell、綁事件，再讀 DB；載入或錯誤必須顯示狀態，不得靜默留白。折疊使用原生 `<details>`；語意色不可跨功能挪用。面板的主色／輔助色／強調色取捨遵守 [`docs/design-guidelines.md`](docs/design-guidelines.md) §1.5 的 631 原則。改介面、可見文案或固定欄寬樣式時，至少以台灣華語與英文各核對一次排版——固定幾何下拉丁文通常比漢字長，只看一種語言會漏掉溢出、重疊或裁切。日文長度明顯不同時一併看。核對項目見 [`docs/design-guidelines.md`](docs/design-guidelines.md) §2.4。
10. **語言與註解**：回應使用者一律繁體中文（台灣用語），程式碼註解使用繁體中文。註解與變更說明只寫目前行為、非顯而易見的理由、約束或風險，不保留除錯歷程、未合入方案或舊實作。

## 建置與驗證

```bash
npm run build       # 正式 Chrome MV3，輸出 .output/chrome-mv3
npm run dev         # 開發模式，輸出 .output/chrome-mv3-dev
npx tsc --noEmit    # 型別檢查
npx wxt prepare     # 型別生成（首次或型別錯誤時）
npm test            # Vitest
```

修改 source 後，重新 build、在 `chrome://extensions` 重新整理擴充；已開啟的遊戲分頁需 F5 重新注入 content script。正式 build 與型別檢查是一般改動的最低驗證；戰鬥／狀態／資料格式改動還要執行相關 Vitest 與 samples 驗證。不要宣稱已驗證 live Kancolle 行為；需要 live 驗證時提供開發者手動檢查步驟。

離線 UI 預覽（不連遊戲）按需執行：

```bash
npx vite-node --config vitest.config.ts tools/preview/sortie-log.ts
npx vite-node --config vitest.config.ts tools/preview/drop-log-filter.ts
npx vite-node --config vitest.config.ts tools/preview/resource-log.ts
npx vite-node --config vitest.config.ts tools/preview/fleet-overview.ts
npx vite-node --config vitest.config.ts tools/preview/panel-sortie.ts
npx vite-node --config vitest.config.ts tools/preview/panel-general.ts
```

需要瀏覽器檢視 `.preview/*.html` 時，依 [`AGENTS.md`](AGENTS.md) 先從專案根目錄啟動 localhost HTTP server，檢視後清理 server；不可使用 live 遊戲頁。介面改動不得只看單一語系預覽結案：至少再核對台灣華語與英文（離線對照或正式頁切語言皆可）。

## 資料流與檔案入口

```text
遊戲 iframe
  → interceptor.content.ts（MAIN，觀察 axios response）
  → bridge.content.ts（ISOLATED，驗證同源、去 token、送 runtime message）
  → background.ts（解析、ingestEvent、snapshot、通知、資源序列、裁剪）
  → panel/main.ts（baseline + raw event projection + 即時 UI）
  → overview/（只讀 GameState／derived tables，不做投影）
```

| 範圍 | 主要檔案 | 變更前必讀 |
|---|---|---|
| 擷取與生命週期 | `entrypoints/interceptor.content.ts`、`entrypoints/bridge.content.ts`、`entrypoints/background.ts`、`utils/ingestion-persistence.ts`、`utils/background-ingestion-lifecycle.ts` | 本檔資料契約、index「擷取／Handoff／驗證原則」、對應 tests |
| 狀態與投影 | `utils/state.ts`、`utils/battle.ts`、`utils/event-projector.ts`、`utils/projection-cursor.ts`、`utils/event-pruning.ts` | index「戰鬥／大破／艦載機／關卡」、samples |
| 面板 | `entrypoints/panel/`、`panel/index.html` | `docs/design-guidelines.md` §7、面板相關 tests、離線 preview |
| 情報總括 | `entrypoints/overview/`、`utils/*-log.ts`、`utils/equip-ref.ts`、`utils/stype-label.ts` | 該功能在 engineering log 的同名章節、`docs/design-guidelines.md` §4.7／§4.8 |
| 劇場與拍照 | `entrypoints/theater.content.ts`、`utils/theater.ts`、`utils/audio-mute.ts`、`utils/screenshot.ts` | engineering log 劇場／拍照章節；不得連 live 遊戲驗證 |
| 資料庫與備份 | `utils/db.ts`、`entrypoints/overview/sections/backup.ts`、`entrypoints/overview/fsa.ts` | Handoff、備份還原章節；任何 schema 或格式變更先確認相容性 |
| 產生物與圖示 | `utils/gamedata-names.ts`、`utils/map-edge-letters.ts`、`public/icons/` | index「譯名與產生物」、各產生器與 `tools/*/README.md`；產生物勿手改 |

## 不可破壞的目前契約

- **IndexedDB**：目前 schema v13。`events` 以 `captureId` unique index 去重並保存 `postProcessState`；`resources` 以來源 event id 冪等保存，`resourceMarks` 保存活動時間點；`questObserved` 保存本機觀測到的任務領獎。歷史資料不回填不存在的 capture／processing／projection metadata，也不把 snapshot 當 raw event。
- **匯入**：單場 JSON 只接受本專案 `toKc3Replay()` version 4 或已有 fixture 證實的 KC3Kai logger 格式；CSV 匯入與單場匯入都借 event id 但不寫 raw event。備份還原是乾淨環境的完整 transaction，非 merge；空資料不得寫成備份。
- **關卡量表**：`mapInFinalPhase()` 對 gaugeType 2 使用同一血條的 Boss HP，門檻為 `nowHp <= bossHp`；`nowHp === 1` 是不需 Boss HP 的唯一特例。gaugeType 3 的量表欄位仍未以真封包驗證，不能用未證實的場數公式取代。
- **戰鬥**：現行血量與敵方陣列為 0-indexed，沒有舊格式的 leading `-1`；`battleresult` 必須排除 battle 分支。聯合艦隊、航空／基地、友軍與支援欄位的細節只依 samples 與 tests 維護。
- **重播**：原始戰鬥封包保存在 `db.replays`；裁剪只影響詳細重播，`db.sorties` 摘要仍保留。沒有出擊開始事件或必要艦隊快照時，該場只能保存可建立的摘要，不能補猜編成。
- **待驗證擷取**：`wantedTag()` 只留渦潮表外且真有 `api_happening`、以及未知 sally 系 key。正式 build 預設關閉 debug UI（`utils/debug-ui.ts`）。`db.wanted` 會永久保護對應 raw event，達上限必須明說，不可靜默略過或擴充會洗版的鉤子。
- **活動資料**：節點字母只走 `utils/map-node-letters.ts` 查表；新海域沒有對照時顯示原始 edge id。活動標籤的未驗證語意、`api_sally_flag` 與其他待驗證欄位要保留原始值，不自行命名或推導。
- **版面**：面板固定幾何、七艘編成完整顯示、裝備槽單行、出擊警告不推動下方系統列等限制集中在 `docs/design-guidelines.md` §7。panel 內容寬度是 370px；編成六／七船在有無 `.fs-ops` 下都以 730px 為排版目標、740px 為硬上限。摘要與遠征雙欄條件需以 370px 實際排版核對，不可沿用舊 420px 基準；9 項以上條件逐列雙欄並允許換行。popup 啟動時把內容區補到 370。情報總括左右並排分區在內容區還放得下兩欄時不得改單欄（§4.7）；同名艦種篩選／列上標籤走 `utils/stype-label.ts`（§4.8）。修改面板或 overview 版面前必讀對應節，不在本檔複製其他 CSS 數值。介面完成前至少核對台灣華語與英文排版（§2.4），不得只憑一種語言宣告沒問題。
- **圖示與相容性**：panel 系統圖示維持 `docs/design-guidelines.md` §5.1 的剪影語言；第三方邏輯採 clean-room 重寫，依 `THIRD-PARTY-NOTICES.md` 登錄來源。

## 目前待辦索引

詳細待辦與驗證狀態以程式碼、測試及 engineering log 同名章節為準；以下只列會影響開發取捨的項目：

- 新活動的 edge 對照表、活動特殊燃彈費率、TP 量表與新裝備值仍需資料或真封包證據。
- 掉落統計彙總視圖尚未完成；斬殺偵測的即時觸發仍待實際 mapinfo 時序觀測。
- 部分艦載機損耗後的熟練度下降量、第二艦隊旗艦不沉時的殘 HP、遠征回航道具欄位仍不可考，維持估算／原始值／null。
- 活動標籤 id／名稱、`api_sally_flag`、強力友軍消耗、劇場跨源框與音訊路徑仍待開發者以 live 遊戲手動驗證；agent 不得自行登入或操作。
- M4 尚有 side panel、視窗位置記憶與 Firefox 打包驗證等載體工作。

## 進度與來源的單一真相

版本以 `package.json` 為準，manifest 以 `wxt.config.ts` 與 `tests/manifest.test.ts` 為準，資料庫版本以 `utils/db.ts` 為準，測試命令以 `package.json` 為準。里程碑不在本檔維護，避免狀態複製後過時；需要盤點時查 git、測試與 [`docs/engineering-log.md`](docs/engineering-log.md) 的目前有效段落。
