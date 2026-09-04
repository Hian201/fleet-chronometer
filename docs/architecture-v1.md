# 架構書 v1.0（2026-07）— 原始設計基準

> 本文件為專案啟動時的原始架構書，**保留作為設計對照基準**。
> 現況與本書的偏差、可交接的實作契約，見 `CLAUDE.md`「Handoff：持久化、投影與發布契約」。
> 主要偏差摘要：
> - 未拆 monorepo/`kcs-core` 套件——核心（`utils/state.ts`+`battle.ts`）保持零瀏覽器依賴，等 macOS 共用需求出現再拆包。
> - 戰鬥預測未嵌入 KC3Kai `kc3bp.js` 單檔，改為 **clean-room 重寫**（`utils/battle.ts`），授權更乾淨、且已按現行新版 API 格式實作（KC3 舊格式反而不適用）。
> - §4 的「整份 state snapshot + 其後事件」模型不是現況：實作為 path-keyed `snapshot` baseline +
>   retained raw-event replay；baseline 必須早於第一筆 retained raw event，且絕不送入 projector。
> - raw-event pruning 已實作，但受 projection cursor（`meta['projection']` v3）限制；metadata 無效時
>   不裁剪，並保留 `KEEP_RECENT` 基石與 wanted references。
> - 現行權限契約與本原始設計不同：正式 manifest 的 `host_permissions` 為空；目前的
>   `permissions` 與 `optional_host_permissions` 以 `wxt.config.ts` 及
>   `tests/manifest.test.ts` 為準。
> - L1 擷取不再 hook 原生 fetch／XHR：改觀察遊戲 `window.axios` 的 response interceptor
>   （不取代原生網路 API，以免 DevTools `getContent` 對其他擴充變空）。仍只觀察、不改寫、不重放。

---

版本:v1.0(2026-07) 目標:在 Manifest V3 下實現艦隊資料、戰鬥監控、戰鬥結果預測,可移植於所有 Chromium 分支與 Firefox,且資料流不依賴任何 UI 生命週期。

## 1. 設計原則

1. **被動擷取,零額外請求**:僅攔截遊戲自身發出的 `/kcsapi/` 流量,絕不重放、修改或代發任何請求(帳號安全硬約束,與 macOS app 相同)。
2. **擷取/持久化與 UI 解耦**:面板(popup 視窗或 side panel)關閉期間不得漏失任何資料。資料落地點是 service worker 管理的 IndexedDB 事件日誌,UI 只是事件日誌的訂閱者與重放者。
3. **核心邏輯與平台解耦**:解析、狀態機、戰鬥預測寫成不含任何 `chrome.*` / WebKit API 的純 TypeScript 套件(`kcs-core`),同一套核心同時服務本擴充與 macOS app。
4. **UI 載體可替換**:預設用 `windows.create({type:'popup'})` 獨立視窗(全瀏覽器可用); `chrome.sidePanel` 與 Document PiP 作為選配,由使用者手動啟用,不做自動偵測(Vivaldi 存在「API 存在但 UI 壞」的假陽性)。
5. **假設 service worker 隨時死亡**:SW 只做「可被事件喚醒的無狀態工作」——寫日誌、廣播、視窗管理、鬧鐘通知。任何跨事件的狀態一律放 IndexedDB 或 `chrome.storage`。

## 2. 系統總覽

```
┌─ 遊戲分頁 ────────────────────────────────────────────┐
│  game iframe (*.kancolle-server.com)                  │
│  [L1] interceptor.content.ts  (world: MAIN)           │
│       hook fetch/XHR → 剝 svdata= → window.postMessage│
│  [L2] bridge.content.ts  (world: ISOLATED)            │
│       驗證來源/形狀 → chrome.runtime.sendMessage       │
└────────────┼──────────────────────────────────────────┘
┌─ [L3] background.ts (service worker) ─────────────────┐
│  1. append 到 IndexedDB 事件日誌 (events store)        │
│  2. api_port/port 時觸發快照 (snapshots store)         │
│  3. broadcast 給所有存活的擴充頁面                      │
│  4. 依解析結果排 alarms(遠征/入渠)→ notifications      │
│  5. 面板視窗單例管理(windows.create / focus)           │
└────────────┼──────────────────────────────────────────┘
┌─ [L5] panel.html ─────────────────────────────────────┐
│  啟動:載入最新快照 + 重放其後事件 → 得到當前狀態        │
│  執行:訂閱 broadcast,增量餵入 [L4] kcs-core           │
│  [L4] kcs-core(純 TS,無瀏覽器 API)                   │
│   ├ parser / state / prediction                       │
└───────────────────────────────────────────────────────┘
```

## 4. 事件日誌與快照（歷史設計，非目前實作契約）

> 本節保留原始設計供對照。現況不保存 `snapshot.state` 或最近 N 個完整快照，也不以
> `snapshot.lastEventId` 當 replay 邊界；請以 `CLAUDE.md` 的 handoff 契約與
> `utils/state-recovery.ts`／`utils/event-pruning.ts` 為準。

- **快照時機 = `api_port/port`**。port 本來就是全量狀態同步點（母港畫面刷新），語意上等同「天然存檔點」，不需另設計時器快照。
- 面板啟動時：`最新 snapshot.state` + 重放 `events.where('id').above(snapshot.lastEventId)`。出擊途中重開面板，重放量僅為本次出擊事件（通常 < 50 筆）。
- **修剪**：保留最近 N 個快照（預設 3）與其後事件；更早事件若不需戰鬥履歷可刪。若要做出擊紀錄/掉落統計，改為把戰鬥事件歸檔到獨立 `sorties` store 再修剪 `events`。
- `api_token` 在 L2 橋接層剔除，永不落地。

### 生命週期情境

| 情境 | 行為 |
|---|---|
| 出擊中面板被關閉 | 事件持續由 SW 寫入日誌；重開面板 → 快照+重放，戰況無縫恢復 |
| SW 被瀏覽器終止 | 下一則 runtime message 自動喚醒；無狀態遺失 |
| 瀏覽器重啟 | IndexedDB 持久；面板開啟即恢復 |
| 遊戲重整/重登 | `api_start2/getData` + `api_port/port` 自然重建全量狀態 |

## 7. 授權與合規

| 依賴 | 授權 | 使用方式 |
|---|---|---|
| KC3Kai（演算法參考） | MIT | clean-room 重寫，登錄 THIRD-PARTY-NOTICES.md |
| poi-plugin-expedition 資料 | MIT | 資料檔引入 |
| Dexie / WXT | Apache-2.0 / MIT | 一般依賴 |
| kcanotify | GPLv3 | **僅作行為參考，不引入程式碼**（授權傳染） |

行為紅線：不代發/重放/修改任何請求；`api_token` 不落地、不出境；不上傳任何資料。

## 8. 與 macOS app 的共用

核心輸入是 `(ts, path, req, res)` 事件流——與 WKUserScript hook 送進 WKScriptMessageHandler 的資料同構。
macOS 端建議先走 JavaScriptCore（core 打包 UMD 單檔在 JSContext 內跑），fixture 齊備後視效能評估 Swift 重寫。

## 9. 實作里程碑（原始定義）

1. **M1 — 管線打通**：L1→L2→L3 落地 + 面板 raw 事件檢視器。
2. **M2 — 艦隊面板**：master/port/hensei 解析 + 顯示四艦隊、HP、疲勞、遠征入渠倒數（alarms 通知）。
3. **M3 — 戰鬥監控**：戰鬥預測，晝/夜戰終末 HP、rank、MVP、大破警告；fixture 回歸測試。
4. **M4 — 載體完善**：side panel 選配、Document PiP 戰況條、視窗位置記憶、Firefox 打包。
5. **M5 — 擴充**：出擊紀錄歸檔（sorties store）、掉落統計、聯合艦隊/友軍/基地航空隊完整覆蓋。
