# 擷取、持久化與投影

硬約束見 `AGENTS.md` 硬約束 1–5、8；本檔補充這些約束的實作細節與理由。

## 資料流

```
遊戲頁(*.kancolle-server.com, iframe)
  ▼ 觀察 window.axios response（不取代原生 fetch/XHR）
interceptor.content.ts (MAIN world, document_start)
  · 剝 svdata= → 私有 MessagePort；[僅開發建置] __kcLastBattle/__kcLastResult
  ▼ MessageChannel（握手時經 window 一次，之後走私有 port）
bridge.content.ts (ISOLATED)
  · 去 api_token／api_verno → runtime.sendMessage({type:'kc:api', ...})
  ▼
background.ts (service worker)
  · 解析 apiText，構造 ApiEventRow（source:'main'）→ ingestEvent()
  · ingestEvent()：raw event 先落地，再以 pending→processing→done 執行副作用
    → 廣播 kc:live／snapshot／資源序列／任務觀測／裁剪／通知
    → 遠征／入渠 → alarms＋notifications（提前 1 分）
  · kc:open-panel（popup 選單）→ 開 panel 彈出視窗（單例聚焦）；manifest 設了
    action.default_popup，所以 action.onClicked 不會觸發
  ▼ kc:live
panel/main.ts
  · 啟動：安全 snapshot baseline 建 state，再依 retained raw event ID 順序投影
  · EventProjector：cursor 前事件只建 state context，cursor 後才寫 derived rows
  · 渲染即時分頁（general／sortie／exped／activity）＋艦隊＋基地航空隊；
    紀錄的檢視在鎮守府情報總括
```

SW 隨時可能被回收，不持有跨事件狀態；面板關閉期間資料照常落地，面板只是訂閱者＋重放者。
需要跨事件的守衛（例如資源量表的 `gauge-seen`）一律落地到 DB，不放記憶體變數。

## Provider 合約

`ApiEventRow`（`utils/db.ts`）是擷取來源與下游的正式邊界。

- MAIN world interceptor 被動觀察 `window.axios` 的 kcsapi 回應（不取代原生 fetch／XHR，以免
  DevTools `getContent` 對其他擴充變空），送出去掉 `/kcsapi/`／`svdata=` 前綴的 path、原始
  response text 與 request body。
- 送出經 `utils/idle-capture-queue.ts` 依序排程：輸入後至少讓出一幀；512K 字元以下排到下一個
  task，更大或大小未知者等 idle。延遲量測（`utils/capture-timing.ts`）只在開發用 UI 收集、不寫 DB。
- MAIN 與 bridge 之間走 `utils/main-channel.ts` 的 MessageChannel：只有 document_start 的握手經過
  window（驗證同一 window、同源），封包走私有 port（只有 MAIN → bridge 一個方向）、不在頁面上
  廣播；通道建立前的封包在 MAIN 端依序緩衝，不改走 window 備援。MessagePort 從 ISOLATED 經 `window.postMessage`
  轉移到 MAIN world 已在 Edge／macOS 實機確認。
- 正式建置的 MAIN world 不設除錯全域變數、不印封包（建置旗標在編譯期折掉）。腳本本身也不
  指定給全域變數（`globalName: false`；MAIN world 的頂層變數就是遊戲頁的 window 屬性），
  並且不包裝音訊、DOM 原型等任何原生物件。開發者已實機確認遊戲框的 `window.interceptor` 為
  `undefined`、面板照常收到資料（2026-11-10）。
- bridge 移除 `api_token`／`api_verno`，建立一次固定 envelope（UUID `captureId`、timestamp、
  path、req、`apiText`）。retry 只一次且重用同一 envelope；第二次仍失敗時該筆可能遺失。
- background 才解析大型 `apiText`，以 `source:'main'` 交 `ingestEvent()`。最終 row 的不變量：
  path 已正規化、api 已解析、req 無 token／verno。
- 外層 `api_result` 不是 1 的回應在 background 解析時整筆略過、不入庫（`parseKcsapiResponse`
  丟出 `KcsapiResultError`）。這種回應沒有 `api_data`，而部分狀態更新依請求內容推算，照常套用
  會把被伺服器拒絕的動作當成已發生；連線不穩時遊戲重試成功，還會重複套用。判斷只看外層，
  `api_data` 內部有同名欄位。各錯誤碼的意義未驗證，不加以區分。

## 持久化與投影契約

**IndexedDB**（目前版本見 `utils/db.ts`）：

| store | 索引 | 寫入者 |
|---|---|---|
| `events` | `++id, ts, path, &captureId, postProcessState` | `ingestEvent()` |
| `wanted` | `++id, eventId, tag, ts` | 面板（開發用 UI） |
| `sorties`／`factory`／`replays`／`expeditions`／`materialUse`（v16）／`sortieBills`（v17） | 見 db.ts | `EventProjector`（面板） |
| `snapshot` | `path, ts` | background |
| `resources`／`resourceMarks` | `eventId, ts`／`key, mapKey, ts` | background（`resource-capture.ts`） |
| `questObserved`（v13）／`questSeen`（v14） | `eventId, questNo, ts`／`questNo, lastTs` | background |
| `goals`（v15） | `key` | 情報總括「目標規劃」分區（使用者手輸） |
| `shipObtained`、`eventPlans`、`notified`、`meta` | 見 db.ts | 各功能 |

版本升級不回填歷史 `captureId`、`postProcessState` 或 projection metadata，所以歷史 events 不是
可恢復的 post-processing 工作；projection metadata 缺／未知／損壞時從 retained raw events 的 0
重投影。v11 起的新表（`eventPlans`、`resources`、`resourceMarks`、`goals`、`materialUse`、`sortieBills`）都不回填；v13／v14 只從升級當下
仍保留的 raw events 回填 `questObserved`／`questSeen`。

**Ingestion lifecycle**：新 event 先存 `pending`；同 captureId 只允許相同 path 與 timestamp，否則拒絕
collision。取得 transactional claim 才轉 `processing` 並執行廣播、snapshot、通知、pruning 等副作用；
成功標 `done`，失敗回到 `pending`。SW 啟動時先把帶 captureId 的遺留 `processing` 歸還 `pending`，
再按 event ID recovery；新 ingestion 與 recovery 共用 promise queue，副作用不會超前。通知用固定
notification ID，snapshot 與 derived rows 冪等寫入。

**Projection boundary**：`EventProjector` 是 `sorties`／`factory`／`replays`／`expeditions`／`materialUse`／`sortieBills` 的入口，
保存 `dropMst`、replay difficulty 與 replay／sortie 關聯；新船判定結合 `dropMst` 與 `shipObtained`，
不由名稱反推。資源序列與任務觀測不需要 GameState 上下文，而且價值在連續性（面板沒開的日子也要
記），所以由 background 在 post-processing 落地，主鍵用來源 raw event id 以保持冪等。

**Cursor 與裁剪**：cursor 前的事件只重建 state context，cursor 後的事件才寫 derived rows；每筆投影
成功才推進 cursor。raw event 只會在已投影且通過保護規則時裁剪；投影 metadata 無效時停止裁剪。
snapshot 只作 GameState baseline，不送入 projector。

**匯入不是 raw ingestion**：單場 JSON 與 CSV 匯入借用 events key generator（add→delete）後只寫
derived tables，不寫 raw event。細節見 [records.md](records.md)。

`GameState.applyEvent(path, api, req, ts = Date.now())` 依 `path` 更新狀態；EventProjector 與
state recovery 必須傳原始 `event.ts`，否則計時器錨點會被重播當下的時間污染。live 呼叫未傳時才用
現在時間。

## 產品識別

- 版本以 `package.json` 為準，manifest 權限以 `wxt.config.ts` 與 `tests/manifest.test.ts` 為準。
- 品牌名走 i18n：manifest 只放 `__MSG_extName__`／`__MSG_extShortName__`／`__MSG_extDescription__`
  （`default_locale: en`），實際名稱在 `public/_locales/{en,ja,zh_TW}/messages.json`：en「Fleet
  Chronometer」／ja「クロノメーター」／zh_TW「航海鐘」。頁面標題是另一份來源（panel／overview／
  popup 於執行期以 `ov.brandShort` 改寫 `document.title`），兩份必須逐語言一致；預設語系缺任一
  key 時 Chrome 會拒載擴充。`tests/manifest.test.ts` 把關。
- `popup/index.html` 的 `<title>` 必須維持佔位字串：WXT 把它寫進 manifest 的
  `action.default_title` 並蓋過 `wxt.config.ts`，佔位字串在 manifest 裡才會換成當前語系的品牌名。
  HTML 本身不做 `__MSG_` 代換。
- app icon 在 `public/icon/`（來源 `tools/app-icon/`，黃銅萬向環天文鐘意象），與
  `public/icons/` 的遊戲資料圖示是兩套資產。
- UI 偏好（語言、主題）存各擴充頁的 localStorage（`utils/ui-prefs.ts`），以 DOM `storage` 事件跨頁
  同步，不需要 `storage` 權限；SW 不使用。

## 各介面的 kcsapi path 與 autoSwitch

進入介面時的讀取封包（操作另有 `api_req_*` 端點）：

| 介面 | path | 介面 | path |
|------|------|------|------|
| 母港 | `api_port/port` | 工廠 | `api_get_member/preset_dev_items` |
| 遠征 | `api_get_member/mission` | 改修（明石） | `api_req_kousyou/remodel_slotlist` |
| 入渠 | `api_get_member/ndock` | item課金 | `api_get_member/payitem` |
| 編成 | `api_get_member/preset_deck` | 圖鑑 | `api_get_member/picture_book` |
| 改裝 | `api_req_kaisou/can_preset_slot_select` | 任務 | `api_get_member/questlist` |

`autoSwitch`：`api_port/port`→一般、`api_req_map/start`／戰鬥→出擊、`api_get_member/mission`／
`api_req_mission/start`→遠征、`api_get_member/questlist`→一般（任務圖示在遊戲全域頭部列，任何畫面
都會送）、`api_get_member/ndock`／`api_req_nyukyo/start`／`speedchange`→一般分頁母港「入渠」分組的渠位
（只在剛進入入渠情境時定位，同畫面內不重設使用者選的待修檢視）、`preset_dev_items`／`remodel_slotlist`／工廠操作（createitem／createship／getship／
remodel_slot）→工廠。使用者手動切過分頁後暫停自動切換，直到情境變化。

補強增設裝備是獨立端點 `api_req_kaisou/slotset_ex`（沒有 `api_slot_idx`，已實測）。

## 待驗證封包的擷取（開發用）

**自動擷取**：面板「動態」分頁的「待驗證封包」清單，只在 `npm run dev` 或本機
`localStorage.kc-debug-ui='1'` 時顯示與擷取（`utils/debug-ui.ts`）。正式建置預設關閉：營運對玩家
檢視封包敏感，且沒有 UI 時繼續寫 wanted 會永久釘住 raw events。

- `GameState.wantedTag(path, api)` 命中即記入 `db.wanted`，並以 Blob＋`<a download>` 自動下載
  `kc-wanted_{tag}_{path}_{ts}.json`（不需要 `downloads` 權限）。清單保留複製／刪除／清空。
- 上限：同一分類 5 筆、總數 50 筆。`db.wanted` 引用的 raw event 受裁剪永久保護，達上限時清單
  明說並提供刪除，不可改成靜默略過，也不可拿掉保護語意。
- `wantedTag()` 只保留兩類鉤子：渦潮表外且真有 `api_happening`（補 `maelstromLoss` 表）、未知
  sally 系 key（標籤名是否進 API）。可由現有資料或成熟工具驗證的機制、只會產生重複樣本的欄位，
  不得加入。
- 出擊紀錄的「單場 JSON 匯入」同屬開發用 UI，預設不顯示。

**擷取失效偵測**（`utils/capture-health.ts`）：擷取只靠遊戲的全域 `window.axios`，遊戲改版
若改用私有模組或原生 fetch，觀察器會靜靜停止觸發。MAIN world 另以 `PerformanceObserver`
（`type: 'resource'`，只讀瀏覽器已記錄的請求時序，不包裝網路 API）列出遊戲實際完成的 2xx
kcsapi 請求，與 axios 觀察器收到的 path 逐筆配對；過了 5 秒寬限期的最近 3 筆全都沒配對、
且期間觀察器完全沒觸發，才判定失效（原因分 `no-axios`／`not-via-axios`）。只看最近連續
筆數是為了容忍個別端點本來就不經 axios；寬限期吸收兩邊先後不定的時序。沒看到任何 kcsapi
通訊（例如停在標題畫面）時不回報。狀態經私有通道 → bridge → `PORT_GAME_FRAME` 上報
background（只存記憶體；SW 回收後 bridge 重連時重送最新一筆，background 啟動 2 秒後再
廣播一次校正），面板以 `#notice.err` 顯示，優先序低於載入中、積壓與 fatal。

**手動擷取（僅開發建置）**：遊戲分頁 DevTools Console 對 `[Fleet Chronometer] 戰鬥/結算封包` 物件右鍵
Copy object，或切 frame 後 `copy(__kcLastBattle)`。正式建置不印封包，一律用 Network 篩選。
拿到樣本先存 `samples/`，再寫 Vitest 驗證。
