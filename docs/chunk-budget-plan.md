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
- 目前各 chunk：`background.js` 1168 kB、`overview-*` 1072 kB、`quest-data-*` 575 kB、
  `ui-prefs-*` 504 kB、`quest-goal-label-*` 401 kB、譯文兩檔 115／140 kB、`panel-*` 144 kB、
  `popup-*` 5 kB。
- 下一個會撞到 1200 kB 預算的是 `background.js`。它是 service worker 單檔、不能用 `import()`，
  要縮只能減少它匯入的內容（見步驟 4 的介面字串表）。
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

每個步驟獨立成一個 session、獨立驗證與 commit。步驟 1（任務目錄譯文依語言動態載入）與步驟 2（共用 chunk 依職責分組）已完成。

### 步驟 3：劇場模式 content script 不再帶整份介面字串表（可選，另案）

**現況**：`content-scripts/theater.js` 374 kB 中有 388 kB（壓縮前）是 `utils/ui-i18n.ts` 的三語
全表，而劇場腳本（視窗適應與獨立視窗共用同一支）實際只用 15 個鍵：`theater.enter`、`exit`、
`mute`、`unmute`、`screenshot`、`popIn`、`hint`、`popoutHint`、`muteNoTab`、`notFound`、
`popInFailed`、`popoutFailed` 與 `screenshot.done`／`failed`／`noReply`。這是唯一在**遊戲頁**裡
解析的大檔，雖不在這次警告內，實際體感成本比擴充頁的 chunk 高。

**做法**：把劇場模式用到的鍵抽成一份小型三語表，`theater.content.ts` 只匯入它；`ui-i18n.ts`
從同一份表合併，維持「同一文案只有一個來源」。加一個測試斷言 `theater.js` 的大小上限，
避免之後又被整表拖回來。

**約束**：只改字串來源，不改 content script 的行為、注入時機或權限（硬約束 1、7）。

**驗證**：三語 × 15 個鍵全部以測試逐一斷言可取得且與 `ui-i18n.ts` 同值（其中 6 個是錯誤與
邊界訊息，手動難觸發，不靠肉眼看）。開發者只需在遊戲頁開一次視窗適應與獨立視窗，確認工具列
仍正常；不必為文案逐語言檢查。

**建議模型**：Sonnet 5.5、中～高 effort。

### 步驟 4：介面字串表依語言拆（目前不建議）

`utils/ui-i18n.ts` 三語共約 390 kB，存在於 `ui-prefs` chunk、`background.js` 與劇場腳本。
依語言拆可讓擴充頁少載約三分之二，但 `t()` 是全專案同步呼叫，改成先載入再繪製要動到每個頁面
的啟動流程；`background.js` 又不能用 `import()`，仍得帶全表。`ui-prefs` chunk 目前 504 kB，
離預算很遠，收益不足以抵銷風險。等它接近預算再評估；屆時建議 Opus 5.5、高 effort，先進
plan mode 列出所有啟動路徑。

## 4. 不做的事

- 不單純調高 `CHUNK_BUDGET_KB`：超標時先找成長來源。
- 不拆 `quest-catalog-data.ts`、`quest-goal-data.ts`、`quest-prep-data.ts`：`state.ts` 的
  reducer 同步使用它們，改成動態載入會動到狀態核心（硬約束 6）。
- 不為了縮小檔案而刪減任務關係圖的來源或翻譯內容。
- 不把 `state`、`battle`、`db`、dexie 另分成 `core` chunk：`state` 一旦集中成固定 chunk，popup
  共用的 `ui-prefs` 會改為依賴它，popup 從約 0.5 MB 連帶變成約 1.4 MB。要讓這些模組也能歸因，
  得先讓 `ui-prefs` 不依賴 `state`，那是程式碼改動，不在本檔範圍。
