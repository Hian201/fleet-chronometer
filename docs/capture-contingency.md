# 連線緊急備案研究

研究日期：2026-11-13～14。對象版本：本專案 1.1.1.1 開發中、遊戲主程式 v6.3.6.1（2026-11-10 靜態分析）。

本檔回答一個問題：遊戲若不再透過 `window.axios` 送出 kcsapi 請求，本專案要怎麼繼續擷取。內容是調查結論與備案比較，**不是現行行為**；現行擷取規則以 `AGENTS.md` 硬約束 1–5 與 [`engineering/capture.md`](engineering/capture.md) 為準。任何備案實作前，先讀第 8 節的待辦。

外部專案的原始碼只做閱讀分析，未複製程式碼；日後依本檔實作時，依 clean-room 重寫並登錄 `THIRD-PARTY-NOTICES.md`。

## 1. 現況與弱點

本專案在遊戲框的 MAIN world 對 `window.axios` 登記一個回應攔截器，只讀回應副本、原封不動交還，不取代 `fetch`、`XMLHttpRequest` 或任何原生物件。這是同類瀏覽器擴充裡干涉最小的做法，代價是依賴遊戲把 axios 放在全域、且用預設實例送請求。

| 遊戲可能的改法 | 本專案（axios 攔截器） | 掛鉤 XHR 的工具 | DevTools／偵錯 API／代理 |
|---|---|---|---|
| 升級 axios，仍掛在 `window.axios` | 不受影響 | 不受影響 | 不受影響 |
| 改用 `axios.create()` 的獨立實例 | 失效（預設實例的攔截器看不到） | 不受影響 | 不受影響 |
| 把 axios 打包進主程式，不再公開 | 失效 | 不受影響 | 不受影響 |
| axios 設定改用 fetch 送出，或改寫成 `fetch` | 失效 | 失效 | 不受影響 |
| 換成其他函式庫 | 失效 | 底層是 XHR 才不受影響 | 不受影響 |

axios 1.7 起支援 fetch 送出，但瀏覽器預設仍優先用 XHR，要另外設定才會改用 fetch。

以上任一情況，`utils/capture-health.ts` 都會在面板顯示擷取失敗：它比對 `PerformanceObserver` 看到的 kcsapi 請求，不依賴 axios，所以不會默默漏記。

## 2. 遊戲端與營運的狀況

- **主程式結構**（v6.3.6.1，開發者另存主程式後的靜態閱讀，主程式檔不放進專案）：axios 是頁面另外載入的腳本，主程式以 `self.axios` 取用，只用到 `post`、`get`、`isAxiosError`；沒有檢查攔截器、原生物件、DevTools 或擴充的程式碼。請求是表單格式的 POST，回應是 `svdata=` 開頭的文字，任何 HTTP 函式庫都能取代 axios，技術上只是小工程。
- **營運對工具的立場**（官方 X @KanColle_STAFF，經 wikiwiki「ツールに対する公式見解」轉錄）：輔助工具與專用瀏覽器「嚴格來說違反規約」，實際取締對象是 BOT、巨集、作弊與遊玩資料異常的帳號；2015 年說明只在規格與規則內運作的專用瀏覽器，不在當時說明的不正工具之列。
- **HTTPS 移轉時的表態**：2023 年 10 月表示會留意玩家已在使用、通訊與功能上沒有問題的非一般瀏覽器環境，移轉謹慎進行；2025 年 1 月宣布全伺服器改加密連線，說明先前觀望時機是考量提督們發展出的、沒有違規連線的相關生態系。這只說明那一次移轉的時機，不是對日後改版的承諾。
- **使用規約條文本身未讀到**：DMM GAMES 規約頁需要登入，依 Live 遊戲安全規則不登入；網路上也找不到公開全文。

## 3. 各工具的擷取方式

| 工具 | 讀取的版本 | 位置 | 做法 |
|---|---|---|---|
| 甲ブラウザ（MIT） | `yukikuri/koubrowser` d98ef7e（2026-11-08） | `src/preload/xhr-hook.ts` | 存下原本的 `window.XMLHttpRequest`，以繼承它的子類別整個取代；覆寫 `open`／`send` 記下網址與請求內容，以 `addEventListener('loadstart'/'loadend')` 讀取，最後呼叫原本的方法。 |
| poi（MIT） | `poooi/poi` 7250299（2026-10-26） | `assets/js/xhr-hack.js` | 同樣以子類別取代 `window.XMLHttpRequest`，用 `xhrHacked` 旗標避免重複安裝，並提供 `hackXhr(win)` 處理子框。另替 `response`／`responseText`／`responseXML` 加上 setter，可把遊戲讀到的回應換掉，能力超出觀察。 |
| 秋津洲の目（閉源） | v3.0.4（2026-11-05 分析） | — | 直接改 `XMLHttpRequest.prototype.send`，影響頁面所有 XHR 實例；另有對外傳送資料。 |
| KC3Kai（MIT） | `KC3Kai/KC3Kai` db1e102（2026-10-17） | `src/library/modules/Network.js`、`src/library/objects/Request.js` | 不碰頁面。以 `devtools_page` 掛 `chrome.devtools.network.onRequestFinished`，用 `getContent` 讀回應；程式註解記錄 Chromium 74 起偶爾拿到空內容。 |
| ElectronicObserver（MIT） | `ElectronicObserverEN/ElectronicObserver` 39acd4c（2026-11-11） | `ElectronicObserver/Observer/APIObserver.cs`、`Browser/WebView2Browser/WebView2ViewModel.cs` | 以 Titanium 在本機開代理伺服器並解密 HTTPS，內建 WebView2 以 `--proxy-server` 走這個代理。 |
| 艦これウィジェット（無授權條款） | v4.9.0（2026-11-05 分析） | — | `webRequest` 只讀請求與完成時點，回應部分靠截圖 OCR；不注入頁面。 |

## 4. 掛鉤 XHR 的衝突機制

兩個工具都以「繼承後取代建構子」安裝，且都呼叫原本的方法、用 `addEventListener` 聽事件時，會一層包一層，彼此正常。會出問題的情況：

1. **過早存下原生物件**：某段程式在別人掛鉤前存了原生 `XMLHttpRequest`，之後以它送請求，就繞過後來的掛鉤。axios 的 XHR 送出端是在送請求當下才讀全域的 `XMLHttpRequest`，所以掛鉤必須在第一個請求前裝好。
2. **兩種寫法混用**：改 prototype 的寫法會影響所有實例，包含別人子類別產生的；取代建構子的寫法抓不到別人事先存好的舊建構子。安裝先後不同，結果就不同。
3. **回應被換掉**：poi 式可覆寫回應的 setter 一旦被外掛使用，排在後面的觀察者讀到的就是改過的資料。
4. **以屬性覆寫事件**：寫 `xhr.onload = …` 會蓋掉別人的處理函式。上述工具都用 `addEventListener`，沒有這個問題。
5. **隔離環境**：Chrome 擴充的 content script 預設在隔離的 world，在那裡改 XHR 不影響頁面；要影響頁面必須注入 MAIN world，並在 `document_start`、涵蓋子框。
6. **fetch 的回應只能讀一次**：若掛鉤 `fetch` 而自己讀了本體卻沒先 `clone()`，遊戲就讀不到資料。
7. **與 DevTools `getContent` 的衝突**：專案 commit `0c70fb6`（2026-09-05）記錄，本專案當時包住 fetch／XHR 時，同時開著的 KC3Kai 開發人員介面以 `getContent` 拿到空內容，因此改為觀察 axios。**Chromium 內部原因未查明**，也無法從工具原始碼確認，需本機重現測試（第 8 節）。

## 5. 不改原生物件時能用的路徑（Chrome）

| 方法 | 能否讀到回應內容 |
|---|---|
| `PerformanceObserver`（擷取失效偵測使用中） | 不能，只有時間與網址 |
| `webRequest`、`declarativeNetRequest` | 不能，只看得到請求與標頭 |
| 在遊戲網域註冊 Service Worker | 不能，擴充無法替別的網站註冊 |
| 新函式庫的全域掛鉤點 | 看函式庫；axios 剛好在全域且有攔截器，ky 的 hooks 綁在各自實例上，從外部拿不到 |
| 讀遊戲內部資料物件 | 理論可行，但依賴混淆過的內部結構，比依賴 axios 更脆弱 |
| 包住 `JSON.parse` | 一樣是改原生物件，全頁 JSON 都會經過，干涉更大 |
| DevTools `getContent`、偵錯 API `chrome.debugger` | 能，XHR 與 fetch 都涵蓋 |

結論：在 Chrome 上堅持不改原生物件，就只剩 DevTools 與偵錯 API；代理伺服器擴充做不到。可以接受改原生物件時，在頁面同時包住 `fetch` 與 XHR，能涵蓋各種函式庫。

## 6. Firefox 的 `webRequest.filterResponseData`

依 MDN：這個 API 為單一請求建立 `StreamFilter`，擴充取得回應串流的完整控制權，可以監看也可以修改；預設行為是讓請求保持開啟、沒有回應，必須由擴充把資料寫回並關閉或中斷串流。需要 `webRequest`、`webRequestBlocking` 與遊戲網域的網站權限，Manifest V3 另需 `webRequestFilterResponse`。

- **隱密性**：在瀏覽器網路層運作，頁面程式碼看不到，不需改原生物件、不需開 DevTools、沒有偵錯橫幅。就「不被頁面察覺」而言，與 DevTools、代理同屬最高一級，優於所有頁面內的做法。
- **但不是最安全**：它不是取得副本，而是讓回應**流經擴充**。擴充若出錯、處理過慢或忘了寫回，遊戲的回應就會延遲、損壞或卡住；機制上也具備改寫回應的能力。相較之下，DevTools `getContent` 是唯讀副本，出錯不會影響遊戲。
- **其他代價**：安裝時需宣告網站權限；多個擴充同時過濾同一回應時依序串接，任一環出錯都會影響後面；只有 Firefox 能用，本專案目前只支援 Chromium 系瀏覽器。

## 7. 備案比較

| 方式 | 優點 | 代價 |
|---|---|---|
| A. DevTools 擷取（`devtools_page` + `getContent`） | 不碰頁面；XHR、fetch 都抓得到；不需新增權限；與 KC3Kai 用同一套 API，可並存 | 遊戲分頁須開著 DevTools；視窗適應可停靠，獨立視窗只能用分離的 DevTools 視窗 |
| B. 偵錯 API（`chrome.debugger`） | 不碰頁面；不需開 DevTools | Chrome 文件明列 `debugger` 不能設為選用權限，安裝時即出現強烈權限警告；連線期間瀏覽器顯示偵錯中的橫幅；遊戲框是跨網域子框，需另行連線；商店審查較嚴 |
| C. 頁面內同時包住 XHR 與 fetch | 不需開 DevTools、不需新權限 | 違反硬約束 1；可能使 KC3Kai 的 `getContent` 變空（第 4 節第 7 點）；易被偵測 |
| D. Firefox `filterResponseData` | 頁面察覺不到；不需開 DevTools | 只限 Firefox；回應流經擴充，出錯會影響遊戲；需網站權限（第 6 節） |
| E. 本機代理 | 最徹底 | 瀏覽器擴充做不到 |

## 8. 建議分層與實作前待辦

1. **平常**：維持 axios 攔截器。
2. **第一備案：A**。事先實作 DevTools 擷取，平常不入庫；只有擷取失效偵測判定 axios 失效（`no-axios`／`not-via-axios`）時才接手，避免同一回應記兩次。實作時須：
   - 經 `ingestEvent()` 入庫，符合唯一擷取入口；DevTools 端產生 `captureId` 並在 retry 時沿用。
   - 與 axios 來源並行期間的去重規則（path＋時間窗＋內容雜湊之類），需先定義並寫測試。
   - 一樣在入列前移除 `api_token`／`api_verno`。
3. **最後手段：C**。只有 axios 失效且不願依賴 DevTools 時考慮；需開發者決定修改硬約束 1，並先完成下列重現測試。
4. **不建議 B**：權限警告與偵錯橫幅的代價，換到的能力與 A 相近。

實作前待辦：

- **`getContent` 重現測試**：在本機頁面（假 axios＋本機伺服器回應）分別以「不包住」「繼承取代 XHR」「改 prototype」「包住 fetch 並 clone」四種方式，搭配一個以 `getContent` 讀取的 DevTools 擴充，確認哪一種會讓內容變空。結論補回本檔第 4 節。
- 遊戲每次大改版時，重做主程式靜態分析，確認 `self.axios` 是否仍為外部載入、是否改用獨立實例或 fetch。

## 來源

- 官方立場：[ツールに対する公式見解 - 艦これ ツール Wiki](https://wikiwiki.jp/kancolletool/official_response)、[@KanColle_STAFF 2015-02](https://x.com/KanColle_STAFF/status/564945644427546624)、[2023-10](https://x.com/KanColle_STAFF/status/1713048810291962131)、[2025-01](https://x.com/KanColle_STAFF/status/1878085419839238224)
- Chrome 權限：[chrome.permissions（不能設為選用的權限）](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- Firefox：[MDN webRequest.filterResponseData()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData)
- 原始碼：[yukikuri/koubrowser](https://github.com/yukikuri/koubrowser)、[poooi/poi](https://github.com/poooi/poi)、[KC3Kai/KC3Kai](https://github.com/KC3Kai/KC3Kai)、[ElectronicObserverEN/ElectronicObserver](https://github.com/ElectronicObserverEN/ElectronicObserver)
