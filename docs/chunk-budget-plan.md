# chunk 預算超標改善計畫

本檔是**尚未實作的計畫**，不是現行行為。做完並經開發者驗證的步驟，現行事實寫進
`wxt.config.ts` 的註解與 `docs/engineering/quests.md`，再刪除本檔對應段落；全部做完就刪除本檔。
內容與程式碼不一致時以程式碼為準。量測基準：2026-11-16、commit `ae63ac0`、正式 Chrome MV3 build。

## 1. 現況

- 原先超標的共用 chunk（panel 與情報總括共用的模組）已把任務目錄譯文依語言分出，從 1235 kB
  降到 976 kB，build 不再有預算警告。現行做法見 `docs/engineering/quests.md`「任務目錄譯文的載入」。
- 任務產生物與獎勵 JSON 另分成 `quest-data`（575 kB），檔名可歸因；其餘共用模組仍在
  `quest-goal-label-*`（401 kB，實際內容是 `state`、`battle`、`db`、dexie，檔名不說明內容）。
  分組規則與不另設 `core` 組的理由寫在 `wxt.config.ts` 的 `shared-chunk-groups` 外掛註解。
- 注入遊戲頁的劇場腳本不再帶整份介面字串表，`content-scripts/theater.js` 從 374 kB 降到 24 kB；
  工具列 15 個鍵移到 `utils/theater-i18n.ts`，規則與把關測試見 `docs/engineering/game-page.md`。
- 目前各產物：`background.js` 1168 kB、`overview-*` 1072 kB、`quest-data-*` 575 kB、
  `ui-prefs-*` 504 kB、`quest-goal-label-*` 401 kB、譯文兩檔 115／140 kB、`panel-*` 144 kB、
  `theater.js` 24 kB、`bridge.js` 9 kB、`interceptor.js` 8 kB、`popup-*` 5 kB。
- 量大小前要重跑 `npm run build`：`tests/manifest.test.ts` 會自己跑一次 build，`npm test` 之後
  `.output` 裡的產物與正式 build 不完全相同（實測差約 2.5 kB）。
- 狀態核心的顯示命名改成注入後，`background.js` 從 1169 kB 降到 670 kB（餘裕 530 kB）；
  現行規則見 `AGENTS.md`「不可破壞的目前契約」與 `docs/engineering/roster.md`。
- 還沒處理的是 `overview`（1072／1200，餘裕 128 kB），做法見步驟 6。

### 1.1 實測成長（各時點都重新正式 build，單位 kB）

| 日期 | `background.js` | `overview` | 共用 chunk | `ui-prefs` | `theater.js` |
|---|---|---|---|---|---|
| 08-23 | 112 | 287 | （尚未分出） | 340 | 212 |
| 09-30 | 114 | 811 | 795 | 402 | 270 |
| 10-24 | 116 | 996 | 1126 | 444 | 312 |
| 11-11（v1.1.1.0） | 1128 | 1016 | 1200 | 468 | 338 |
| 11-17（本檔） | 1169 | 1072 | 401＋575 | 504 | 24 |

`background.js` 在 10-24→11-11 從 116 kB 跳到 1128 kB：任務進度追蹤讓 background 匯入
`GameState`，連帶把 `ui-i18n`（約 389 kB）與 `gamedata-names`（約 186 kB）帶進 service worker。
之後六天又 +40 kB，來源是這兩張表與任務資料的日常成長（`ui-i18n` 原始碼 17 天內 +65 kB）。
service worker 會頻繁休眠重啟，解析成本反覆付，所以它比擴充頁的 chunk 更值得縮。
- 以下步驟都是可選的改善，沒有急迫性。第 2 節是分出譯文**之前**的量測，保留作為組成比例的參考。

## 2. 量測結果

以 `npx wxt build --analyze` 產生的統計為準（會在專案根目錄產生 `stats.html`，看完刪掉，
不要 commit）。「壓縮前」是打包器回報的模組輸出長度，只用來看比例；「實際」是輸出檔的位元組數。

### 2.1 各輸出檔

| 檔案 | 實際大小 | 誰載入 |
|---|---|---|
| `chunks/quest-goal-label-*.js` | 1235 kB | panel、情報總括 |
| `background.js` | 1168 kB | service worker（單檔，不能拆） |
| `chunks/overview-*.js` | 1074 kB | 情報總括 |
| `chunks/ui-prefs-*.js` | 504 kB | panel、情報總括、popup |
| `content-scripts/theater.js` | 374 kB | 劇場模式注入遊戲頁 |
| `chunks/panel-*.js` | 144 kB | panel |

### 2.2 超標 chunk 的組成（壓縮前，合計 1706 kB）

| 模組 | 壓縮前 | 說明 |
|---|---|---|
| `quest-catalog-translations.json` | 295 kB | 實際 268 kB：英文 114 kB、台灣華語 139 kB，其餘是鍵 |
| `quest-catalog-data.ts` | 256 kB | 任務目錄日文原文，三語都需要 |
| `quest-goal-data.ts` | 156 kB | 達成條件表 |
| `quest-catalog-rewards.json` | 155 kB | 實際 128 kB；其中日文獎勵原文 62 kB |
| `quest-graph-data.ts` | 124 kB | 五份來源的任務關係圖 |
| `quest-prep-data.ts` | 67 kB | 準備條件表 |
| `quest-catalog-reward-names.json` | 39 kB | 實際 32 kB；獎勵物品的英文與台灣華語譯名 |
| **任務資料小計** | **1092 kB** | **64%** |
| `state.ts` | 137 kB | |
| `dexie` | 132 kB | |
| `map-edge-letters.ts` | 67 kB | |
| `battle.ts` | 35 kB | |
| `akashi-schedule-data.ts` | 33 kB | `26998e4` 新增 |
| `expedition-data.ts` | 31 kB | |
| 其餘 44 個模組 | 約 180 kB | |

### 2.3 為什麼全部落在同一個 chunk

`utils/state.ts` 直接匯入 `quest-identity`、`quest-goals`、`quest-prep`，而 panel 與情報總括都
匯入 `state.ts`；`entrypoints/panel/general.ts` 與 `overview/sections/quest-flow.ts` 都匯入
`quest-catalog-localization`。兩個頁面都用到的模組一律進共用 chunk，所以之後任何「兩邊都用」
的新資料表都會繼續加在這個檔案上。

## 3. 步驟

每個步驟獨立成一個 session、獨立驗證與 commit。步驟 1（任務目錄譯文依語言動態載入）、2（共用 chunk 依職責分組）、3（劇場腳本不帶整份字串表）與 5（狀態核心不帶字串表）已完成。

### 步驟 6：`overview` chunk（還有 128 kB 餘裕，先觀察）

最大的輸入是 `map-geo-data.ts`（325 kB，常規導航底圖）與 `equip-bonus-table.json`（159 kB）。
兩者都只有特定分區用得到，照步驟 1 的模式以 `import()` 依分區載入即可，做法已有先例；
等它接近預算再做，屆時 Sonnet 5.5、中 effort 足夠。

### 步驟 4：介面字串表依語言拆（目前不建議）

`utils/ui-i18n.ts` 三語共約 390 kB，存在於 `ui-prefs` chunk、`background.js` 與劇場腳本。
依語言拆可讓擴充頁少載約三分之二，但 `t()` 是全專案同步呼叫，改成先載入再繪製要動到每個頁面
的啟動流程；`background.js` 又不能用 `import()`，仍得帶全表。`ui-prefs` chunk 目前 504 kB，
離預算很遠，收益不足以抵銷風險；它也**幫不到真正快撞線的 `background.js`**——service worker
不能用 `import()`，拆完仍帶三語全表（`background.js` 已另以步驟 5 的注入制縮掉 499 kB）。等它接近預算再評估；屆時建議 Opus 5.5、高 effort，先進
plan mode 列出所有啟動路徑。

## 4. 不做的事

- 不單純調高 `CHUNK_BUDGET_KB`：超標時先找成長來源。
- 不拆 `quest-catalog-data.ts`、`quest-goal-data.ts`、`quest-prep-data.ts`：`state.ts` 的
  reducer 同步使用它們，改成動態載入會動到狀態核心（硬約束 6）。
- 不為了縮小檔案而刪減任務關係圖的來源或翻譯內容。
- 不把 `state`、`battle`、`db`、dexie 另分成 `core` chunk：`state` 一旦集中成固定 chunk，popup
  共用的 `ui-prefs` 會改為依賴它，popup 從約 0.5 MB 連帶變成約 1.4 MB。要讓這些模組也能歸因，
  得先讓 `ui-prefs` 不依賴 `state`，那是程式碼改動，不在本檔範圍。
