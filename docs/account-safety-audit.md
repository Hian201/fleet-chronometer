# 帳號安全與 DMM Cookie 檢查

檢查日期：2026-10-02。版本：1.1.0.6。範圍為目前專案的擴充執行碼、正式 Chrome MV3 產物、資料流與自動測試；未登入 DMM、未開啟遊戲、未擷取真實流量，也未讀取使用者 Cookie 或既有資料庫。

## 結論與可證明範圍

目前執行碼沒有 Cookie 讀寫呼叫，正式 manifest 沒有 `cookies`、`webRequest`、`declarativeNetRequest` 權限。沒有找到主動呼叫遊戲 API、登入 API，或背景上傳資料的路徑。觀察器只使用遊戲既有 axios response interceptor，回傳原本的 response，不修改請求或回應、不重送遊戲請求。bridge 的重試僅重送擴充內部 runtime message。

這些證據支持「目前實作不讀寫 DMM Cookie」，不能證明「所有情境下帳號絕無風險」或「DMM 認可此擴充」。沒有足夠資料判定營運方對擴充的處置、其他已安裝擴充的行為、使用者實際載入的版本，或未來遊戲封包格式。

## 權限與 DMM 頁面接觸範圍

依據 `wxt.config.ts`、`utils/game-page.ts`、`entrypoints/popup/main.ts` 與正式 `.output/chrome-mv3/manifest.json`：

| 項目 | 目前行為 |
| --- | --- |
| 固定 API 權限 | `activeTab`、`alarms`、`notifications`、`scripting`、`tabs` |
| 正式 `host_permissions` | 未宣告 |
| 靜態 content scripts | `*://*.kancolle-server.com/*`，包含子框；觀察器使用 MAIN world，bridge 使用預設隔離環境 |
| DMM 選用網站權限 | `*://play.games.dmm.com/*`、`*://www.dmm.com/netgame/*` |
| DMM 授權入口 | 使用者點選劇場模式或 popup 拍照後才請求；授權後動態註冊的劇場腳本跨工作階段保留 |
| DMM 儲存存取 | 劇場腳本只讀寫 `localStorage['kc-theater']` 的 `active` 顯示偏好 |
| 開啟遊戲 | popup 按鈕可導航至 DMM 遊戲入口；不是自動登入或代發登入請求 |

`host_permissions` 為空不表示擴充沒有網站存取：靜態 content script、已授予的選用網站權限與 `activeTab` 都是必須分開評估的入口。DMM 選用範圍包含同一入口下的其他遊戲，並非只限艦これ路徑；目前不縮減這些既有功能的權限與相容範圍。

沒有 `cookies` 權限只排除 `chrome.cookies` API 的授權，不是排除所有頁面 Cookie 存取的充分條件。還必須檢查 `document.cookie` 與 Cookie Store API 等路徑；目前專案執行碼未使用這些 API。

瀏覽器載入 DMM 頁面時依網站及瀏覽器規則處理 Cookie，與擴充讀取、複製或修改 Cookie 是不同事項。因此不能把本結論解讀成「開啟 DMM 時瀏覽器也不使用 Cookie」。

瀏覽器機制依據：[Chrome cookies API 的權限要求](https://developer.chrome.com/docs/extensions/reference/api/cookies)、[Chrome content script 的宿主頁儲存規則](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)、[Document.cookie 的讀寫機制](https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie)。

## 憑證與被動觀察

`utils/axios-capture.ts` 讀取既有請求的 `config.data` 副本，以 `URLSearchParams` 移除所有 `api_token`／`api_verno` 欄位，再送入 idle queue。遊戲原本的 body 保持不變。這項保護涵蓋已支援的字串、URLSearchParams、FormData 與一般物件格式；不猜測未知 body 格式。

`entrypoints/bridge.content.ts` 只接受同一 window 且同 origin 的封包訊息，再次移除這兩個欄位。`entrypoints/background.ts` 在寫入前再移除請求物件最上層的同名欄位。觀察器不讀取 axios headers、Cookie headers 或登入表單。

保護有明確邊界：同源檢查不等於能辨識同一頁面上的不同腳本；頁面訊息不是秘密或經身分驗證的通道。bridge 與 background 也沒有完整的封包來源驗證與所有欄位的結構驗證，因此不能把頁面訊息視為可信輸入。原始 API response 會保留，不是任意巢狀欄位的通用憑證清除器；若真實樣本出現其他憑證欄位，必須依樣本另行處理，不能宣稱已涵蓋未知欄位。

`utils/backup.ts` 的備份驗證拒絕請求中的 `api_token`／`api_verno`，並遞迴拒絕物件鍵名為 `api_token` 的內容。這是已知欄位保護，不是對任意文字中秘密值的偵測。本次沒有掃描或修改使用者既有資料，也沒有宣稱替既有資料完成憑證清除。

## 儲存、匯出與畫面功能

觀察資料經 background 進入本機 IndexedDB，偏好使用本機儲存。執行碼檢查未找到 `fetch()`、XHR、WebSocket 或 `sendBeacon()` 的背景對外傳輸呼叫。開發模式另有 localhost 開發伺服器連線；此結論以正式建置為準。

外部工具並非完全不存在：使用者點選後，編成、戰鬥重播與模擬設定會透過外部工具網址的 fragment、剪貼簿或下載檔交付。依據 `entrypoints/overview/sections/fleet-overview.ts`、`entrypoints/overview/sections/sortie-log.ts`、`entrypoints/overview/viewer-html.ts`、`utils/deckbuilder.ts`、`utils/replay.ts` 與 `utils/sortie-simulator-settings.ts`。接收頁面可以讀取交付資料；本次未審查那些外部網站目前的程式與後續處理，不能替它們保證不會上傳。

`entrypoints/background.ts` 的一般拍照使用 `captureVisibleTab()` 先取得整個可見分頁影像，`utils/screenshot.ts` 再裁切下載。整頁影像會暫時經過擴充訊息與記憶體，不能宣稱從未取得 DMM 頁面其他部分的像素。編成寫真則由 `entrypoints/bridge.content.ts` 直接讀取遊戲畫布區塊。兩者都不是 Cookie 讀取。

劇場模式修改顯示樣式、框尺寸與瀏覽器視窗尺寸；靜音功能安裝音訊 hook 並設定分頁靜音；bridge 安裝關閉分頁前的提醒。它們會改變顯示、音訊或瀏覽器互動，不改寫遊戲通訊或自動執行遊戲操作。

## 驗證與限制

`tests/axios-capture.test.ts` 驗證入列前移除憑證，包括重複欄位與編碼欄位，並確認原請求內容、物件參照與回應不變。`tests/interceptor-capture.test.ts` 檢查不得包裝 fetch／XHR，並以 TypeScript 語法樹檢查 Cookie 屬性存取與 Cookie Store 識別字。`tests/manifest.test.ts` 重新正式建置並驗證權限與腳本注入範圍。

靜態檢查不是對混淆、動態組合屬性或所有相依套件的形式化安全證明；本次也不是完整供應鏈稽核。沒有介面與版面變更，未做多語畫面檢查。實際瀏覽器授權、DMM 登入流程與正式遊戲行為仍未驗證。

需要實機確認時僅由開發者操作：

1. 載入此次正式建置，核對擴充版本、網站授權與動態註冊腳本，確認未授權劇場／拍照前沒有 DMM 動態注入。
2. 由開發者自行登入並檢查 Network 的 Initiator，確認登入與遊戲請求仍來自網站原本腳本，沒有擴充代發、重送或改寫請求。
3. 以中斷點檢查觀察器入列、bridge 發送與背景入庫邊界，確認請求副本不含 `api_token`／`api_verno`；不要複製或分享原始 token、Cookie 或未清理 HAR。
4. 分別檢查劇場、靜音、一般拍照、編成寫真與外部匯出；確認只有操作對應功能時才執行，沒有自動遊戲操作或背景上傳。
5. Cookie 變動必須與網站正常登入、續期及登出區分；單憑 Cookie 值變動，不能歸因於擴充。

本次 `npm run compile`、`npm run build` 與 `npm test` 均通過；完整測試為 120 個測試檔、1,629 項測試。`git diff --check` 亦通過。這些結果不包含真實遊戲或登入流程驗證。
