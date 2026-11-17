# 建置產物與 chunk 預算

正式 build（`npm run build`）的產物在 `.output/chrome-mv3/`，原始碼大小與產物大小是兩件事：
service worker 與 content script 各自打包成單檔，擴充頁面則拆成多個 chunk 共用。

## 預算與警告

`wxt.config.ts` 的 `CHUNK_BUDGET_KB`（目前 1200 kB）不是硬限制，而是**該停下來看一眼的門檻**。
擴充頁的 chunk 都從本機載入，大小只影響解析時間；但 service worker 會頻繁休眠重啟，
`background.js` 的解析成本是反覆付的，content script 又在遊戲頁解析，兩者比擴充頁的 chunk
更值得縮。

- 超標時 `chunk-budget-advice` 外掛會在 build 輸出一則說明成長來源的警告（Vite 內建警告只列
  檔名）。三個 build pass 都涵蓋：`background.js`、擴充頁 chunk、`content-scripts/*`。
- `tests/manifest.test.ts` 另以產物大小斷言把關，所以超標會讓 `npm test` 失敗，不只是警告。
  門檻值從 `wxt.config.ts` 讀，兩邊不會各說各話。
- 調高預算是最後手段：先依檔名找出成長來源。`quest-data` 是任務產生物與獎勵 JSON，
  `quest-catalog-translations.*` 是依語言動態載入的任務譯文，`overview`／`panel` 是入口本身。

## 量測方法

`npx wxt build --analyze` 會在專案根目錄產生 `stats.html`（看完刪掉，不要 commit），裡面有每個
chunk 的模組組成。**量大小前要重跑 `npm run build`**：`tests/manifest.test.ts` 會自己跑一次
build，`npm test` 之後 `.output` 裡的產物與正式 build 不完全相同（實測差約 2.5 kB）。

## 已採用的拆法

| 做法 | 適用 | 現行案例 |
|---|---|---|
| 依語言以 `import()` 動態載入 | 只有目前語言會用到的大型譯文 | 任務目錄譯文（`utils/quest-catalog-localization.ts`，見 [quests.md](quests.md)） |
| 依職責分組（Rolldown `output.codeSplitting.groups`） | 讓共用 chunk 的檔名說得出內容 | `quest-data`（`wxt.config.ts` 的 `shared-chunk-groups` 外掛） |
| 只帶該端要用的文案 | content script 只用整張表的少數鍵 | 劇場工具列 15 鍵（`utils/theater-i18n.ts`，見 [game-page.md](game-page.md)） |
| 把顯示命名改成注入 | 核心模組為了顯示名稱而匯入大表，但某些消費端不需要 | `utils/state-format.ts`（見 [roster.md](roster.md)） |

分組只在 `es` 格式的擴充頁建置套用：WXT 的 background 與 content script 是 iife 單檔，Rolldown
不允許 iife 搭配 code splitting。分組一律加 `minShareCount: 2`，否則只有單一入口用到的模組會被
塞進共用 chunk，另一個入口白多載入。

## 不採用的拆法

- **`state`／`battle`／`db`／dexie 另分成 `core` chunk**：`state` 一旦集中成固定 chunk，popup
  共用的 `ui-prefs` 會改為依賴它，popup 從約 0.5 MB 連帶變成約 1.4 MB。
- **介面字串表（`utils/ui-i18n.ts`）依語言拆**：`t()` 是全專案同步呼叫，改成先載入再繪製要動
  每個頁面的啟動流程；service worker 不能用 `import()`，拆完仍得帶三語全表，對 `background.js`
  毫無幫助（它已改用注入制解決）。`ui-prefs` chunk 離預算還很遠，收益不抵風險。
- **拆 `quest-catalog-data.ts`／`quest-goal-data.ts`／`quest-prep-data.ts`**：`state.ts` 的
  reducer 同步使用它們，改成動態載入會動到狀態核心（AGENTS.md 硬約束 6）。

## 下一個可能超標的產物

`overview` chunk。最大的輸入是 `map-geo-data.ts`（常規導航底圖）與 `equip-bonus-table.json`，
兩者都只有特定分區用得到，照上表第一列的模式以 `import()` 依分區載入即可。
