# 量表與斬殺的戰鬥當下判斷：資料設計提案

狀態：**提案，待開發者同意後才實作**。本檔動到出擊紀錄的資料格式與備份版本，依 `AGENTS.md` 硬約束 2 與 [`docs/task-template.md`](task-template.md) 分流表，先討論相容做法再動手。

## 1. 目標

量表進度與斬殺在**戰鬥結算當下**就確定，而且記在**真正打掉量表的那一場**，不必等玩家下次開海域選擇畫面。具體要做到：

- EO 擊破在結算當下計入本月戰果，戰果值取自封包本身。
- 活動海域 HP 量表、擊破數量表、TP 量表在結算當下更新剩餘量；每一段量表的斬殺都標在正確的那一場。
- 伺服器給的值和本機推算的值分開保存，介面看得出哪個是推算；伺服器值到達時一律以伺服器為準。
- 每次出擊都顯示當下這一段的量表。

## 2. 現況

判斷斬殺的地方有三處，全部只靠 `api_get_member/mapinfo` 的前後比對：

| 位置 | 寫入 | 判斷方式 |
|---|---|---|
| `utils/event-projector.ts` `detectClear()` | `SortieLogRow.cleared` | 本次事件流看過某圖「未擊破」，之後的 mapinfo 變「已擊破」，就把該圖**最近一場** Boss 戰標為斬殺 |
| `utils/resource-capture.ts` | `resourceMarks` 的 `gauge-clear` | 同上的守衛規則，在 background 落地（面板沒開也要記） |
| `utils/senka-readings.ts` | 無（讀取時合併） | `sorties.cleared` 加上當月 mapinfo 快照的 `api_cleared` |

量表顯示（`GameState.mapGauges`）的現值來自 mapinfo、`api_req_map/select_eventmap_rank` 與 `api_req_map/start` 的 `api_eventmap`。戰鬥之後不更新，要等下一筆伺服器資料。

已實測的時序（`samples/6-5-mapinfo-{before,after}-clear.json`）：打倒 Boss 回港只送 `api_port/port`，玩家再開海域選擇畫面才送反映擊破的 mapinfo。因此現況有三個問題：

1. **延遲**：擊破後到下次開海域選擇之間，量表、斬殺與 EO 戰果都沒更新。
2. **標錯場次**：擊破後、下次 mapinfo 前又在同一張圖出擊，斬殺會標到那一場（[maps.md](engineering/maps.md)「斬殺偵測」已知邊角）。
3. **EO 戰果靠固定表**：`EO_SENKA_MAPS` 要人工維護，新增 EO 海域時會漏。

## 3. 證據

依硬約束 8，每個欄位都要有真封包或成熟開源專案實際解析的程式碼。

| 欄位 | 出處 | 證據 | 狀態 |
|---|---|---|---|
| battleresult `api_get_exmap_rate` | `api_req_sortie/battleresult`、`api_req_combined_battle/battleresult` | 樣本：6-5 擊破場 `"250"`（字串）、未擊破場 `0`（數字）。KancolleSniffer `KancolleSniffer/Model/ExMapInfo.cs` `InspectBattleResult()` 以非 0 判定 EO 擊破並取其值為戰果，字串與數字都處理 | 可用 |
| battleresult `api_get_exmap_useitem_id` | 同上 | 樣本：擊破場 `"57"`、未擊破場 `0`。poi `views/redux/info/useitems.ts` 以非 0 累加道具庫存；`state.ts` 已採同樣做法 | 可用（只改註解，不改行為） |
| battleresult `api_first_clear` | 同上 | 樣本：擊破場 `1`、未擊破場 `0`。KC3Kai `src/library/objects/Node.js` 以 `clear \|= api_first_clear` 記錄通關 | 可用，但只當輔助（見 §5.3） |
| battleresult `api_destsf` | 同上 | 樣本：6-5 三場 Boss 皆擊沉，值皆為 `1`。KC3Kai `Node.js` 以它判斷敵主隊旗艦是否擊沉 | 不作為判定依據，只在測試中與戰鬥分析的結果交叉核對（§5.2） |
| battleresult `api_landing_hp` | 同上（運輸作戰） | KC3Kai `Node.js` 讀 `api_now_hp`、`api_max_hp`、`api_sub_value`，三者可能是字串 | 可用，無本專案樣本 |
| `api_req_map/next` 的 `api_eventmap`（運輸終點） | 終點不是戰鬥點時 | KC3Kai `Node.js`：`api_next == 0` 且帶 `api_eventmap` 時，以 `api_now_maphp` 推算 TP 減少量 | 可用，無本專案樣本 |
| `api_req_map/next` 的 `api_get_eo_rate` | 1-6 終點（無 Boss 戰） | KancolleSniffer `ExMapInfo.cs` `InspectMapNext()` 以非 0 判定 EO 擊破並取其值 | 可用，無本專案樣本 |
| HP 量表扣量＝Boss 旗艦受傷量，最終段未擊沉停在 1 | 機制 | [maps.md](engineering/maps.md) 第一節，已用 61-5、61-4 真封包驗證 | 已驗證 |

採用時在程式註解寫明專案與檔案路徑，依 clean-room 重寫，並在 `THIRD-PARTY-NOTICES.md` 登錄 KancolleSniffer（Apache-2.0）與 KC3Kai 這兩處讀法。

## 4. 設計原則

KC3Kai 的判斷規則正確，本設計沿用；資料存法則不同，原因如下。

| KC3Kai 的做法 | 問題 | 本設計 |
|---|---|---|
| 戰後把推算值直接寫回 `curhp` | 分不出伺服器值與推算值，介面也無法標示 | 伺服器值與推算值分開保存，推算標為「推算」 |
| 推算與伺服器值都寫進同一個欄位 | 事後分不出哪段時間顯示的是推算 | 伺服器值一到就取代推算（伺服器為準）；開發版可在 console 看到兩者差異 |
| 推算存在 localStorage 的可變狀態 | 無法從原始事件重算 | 推算由原始事件重新投影得出，符合硬約束 5 |
| EO 戰果取固定表 | 新 EO 海域要人工補 | 封包值優先，固定表只給快照補記用 |

另外三條：

- **能確定的就是事實，不叫推算**：HP 量表「最終段＋擊沉」、TP 的 `api_landing_hp`、EO 的 `api_get_exmap_rate` 都是事實，直接標斬殺。只有「HP 量表非最終段的剩餘量」這種靠本機計算的數字才標推算。
- **伺服器起點**：每次出擊，`api_req_map/start` 的 `api_eventmap` 都帶當下現值，所以推算最多跨一趟出擊，誤差不會累積。
- **mapinfo 比對保留為後備**：開面板前打掉、從其他裝置打掉、或欄位缺席時，仍由現行規則補記。

## 5. 資料變更

### 5.1 `SortieLogRow` 新增選填欄位（Boss 戰與帶量表資訊的場次才寫）

存**封包原始事實**，不存推導出的標籤，與 `nodeEventId` 同一原則：解讀規則日後調整時，歷史紀錄可套用新解讀。

| 欄位 | 型別 | 來源 | 用途 |
|---|---|---|---|
| `flagshipSunk` | `boolean` | 戰鬥分析：敵主隊旗艦戰後 HP ≤ 0（`utils/battle.ts` 的 `resultFleets.enemyMain[0]`，已用真封包驗證；敵方連合時只看主隊） | 擊破數量表的擊破、HP 量表最終段是否打掉 |
| `flagshipDamage` | `number` | 本場戰鬥敵主隊旗艦的受傷量：開戰時 `api_e_nowhps[0]` 減戰後 HP（`utils/battle.ts` 已算出） | HP 量表扣量 |
| `gaugeAtStart` | `{ type: number; now: number; max: number; gaugeNum?: number }` | 本趟出擊 `api_req_map/start` 的 `api_eventmap`（伺服器值） | 推算起點、事後比對 |
| `exmapRate` | `number` | battleresult `api_get_exmap_rate` 解析為正整數時 | EO 擊破與戰果值 |
| `firstClear` | `0 \| 1` | battleresult `api_first_clear` 原始值 | 輔助核對 |
| `landing` | `{ now: number; max: number; sub: number }` | battleresult `api_landing_hp` | TP 量表 |
| `clearedBy` | `'battle' \| 'mapinfo'` | 寫入 `cleared` 的那條規則 | 標示斬殺的依據；舊列缺席＝舊規則 mapinfo |

- `flagshipSunk`、`flagshipDamage`、`gaugeAtStart` 只寫在 `state.ts` 的 `isGaugeBossNode()` 判定為目前量表 Boss 點的場次，避免破甲路線回打舊階段 Boss 污染判斷。
- 欄位缺席一律「不可考」，不補預設值，舊列不回填。
- 不是索引欄位，**不需升 DB 版本**。

### 5.2 斬殺判定（`EventProjector`，結算當下）

| 量表 | 判定打掉的條件 | 依據 |
|---|---|---|
| EO（擊破數式，含 HP 式 EO） | `exmapRate > 0` | 封包事實 |
| 擊破數式（一般與活動） | `flagshipSunk` 且 `gaugeAtStart` 或最近 mapinfo 的擊破數為「差 1」 | KC3Kai 規則；差 1 的前提要有伺服器值，否則交給後備 |
| HP 式（活動） | `gaugeAtStart.now − flagshipDamage ≤ 0` 且 `flagshipSunk` | 已驗證機制（見下） |
| TP 式 | `landing.now − landing.sub ≤ 0` | 封包事實 |
| 1-6 | `api_req_map/next` 的 `api_get_eo_rate > 0` | 見 §5.4 |

HP 量表的扣量規則（[maps.md](engineering/maps.md) 第一節已驗證）：每場以 Boss 旗艦受到的傷害扣量表。例如量表 8000、Boss 1000，Boss 被打到剩 200 沒沉，就扣 800，變 7200/8000。量表已低於 Boss HP（如 200/8000）時，只要 Boss 沒被打到 0，量表最低停在 1；只有擊沉 Boss 才歸 0、結束這一段。所以推算值＝`max(現值 − 扣量, flagshipSunk ? 0 : 1)`。

`flagshipSunk` 與 `flagshipDamage` 都從同一份戰鬥 HP 分析取得，不依賴 `api_destsf`，因此不需要另外收「Boss 沒沉」的樣本：沒沉就是戰後 HP 仍大於 0，戰鬥分析本來就算得出來。

符合時直接把**這一場**標為 `cleared: true`、`clearedBy: 'battle'`。之後 mapinfo 轉變到達時，若該圖已有 `clearedBy: 'battle'` 的列且時間在上次「看過未擊破」之後，就不再呼叫 `markLatestBossCleared()`，避免重複或標錯。

### 5.3 量表顯示（`GameState.mapGauges`，只在記憶體）

`MapGaugeView` 加兩個欄位：

- `source: 'server' | 'estimate'`：伺服器值或本機推算。
- `estimatedFromEventId?: number`：推算基於哪一場戰鬥。

戰鬥結算後依 §5.2 的規則更新現值並設 `source: 'estimate'`；mapinfo、`select_eventmap_rank`、`api_req_map/start` 到達時直接以伺服器值取代並改回 `'server'`。面板量表（`entrypoints/panel/sortie-gauge.ts`）目前沒有推算標示，要新增三語文案，版面依設計規範核對。這部分由原始事件重放得出，**不進 DB、不進備份**。

**每一段都顯示當下階段**：
- 出擊時以 `api_req_map/start` 的 `api_eventmap`（伺服器值，含 `gaugeNum`）作為這一段的起點，所以每趟出擊顯示的一定是當下階段。
- 同一趟出擊內，每場戰鬥後扣量並標「推算」。
- 這一段被打掉後只顯示「已擊破」，不猜下一段：下一段的上限與 Boss 只有伺服器知道，等下一次 mapinfo 或出擊起點送來。

**不一致的處理**：伺服器值永遠為準，推算不持久化。換段後舊段的量表不會再出現，沒有東西可對照。只有開發版在**同一段**（`gaugeNum` 相同）收到伺服器值、且與推算不同時，於 console 印出兩者，方便發現扣量規則的漏洞。

`api_first_clear` 不參與判定，只在測試中核對它和 §5.2 的結果一致；目前證據只有 EO 一對樣本，活動多段量表的中間段是否為 1 未知。

### 5.4 1-6（無戰鬥的 EO）

1-6 的擊破發生在 `api_req_map/next`，沒有 `SortieLogRow`，維持現行 mapinfo 快照補記，不新增資料表。唯一代價：月末 21:xx 擊破 1-6、22:00 後才開海域選擇，會漏算當月 +75。為了這個邊界新增表並升 DB 版本不划算。

### 5.5 EO 戰果（`utils/senka.ts`）

- `eoSenkaForMonth()` 的 sortie 輸入改為優先讀 `exmapRate`，有值就用封包值；沒有值（舊列、`clearedBy: 'mapinfo'`）才查 `EO_SENKA_MAPS`。
- mapinfo 快照補記照舊查表，因為快照只有「已擊破」沒有分數。
- 同一海域同一作戰月仍只計一次。

### 5.6 background 的 `resourceMarks`

background 沒有戰鬥分析，無法算 HP 量表扣量。建議只加 EO 一項：battleresult `api_get_exmap_rate > 0` 是純原始欄位，可在 background 直接寫 `gauge-clear`，時刻準確。活動量表維持 mapinfo 規則；資源紀錄的區段標記本來就標明是「觀測到歸零的時刻」，可以接受延遲。

### 5.7 備份

- `utils/backup.ts` 的 sortie 驗證逐欄重建，**沒列出的欄位會被丟掉**。所以舊版擴充還原新備份時，§5.1 的新欄位會默默消失，違反硬約束 2。
- 比照 v13（`resources.exp`）：`BACKUP_SCHEMA_VERSION` 升 14，表組合不變，新欄位只在 v14 以後接受。舊版擴充遇到 v14 會明確回報「不支援較新的備份版本」。這是避免默默遺失資料的唯一做法。
- 第二期排行榜（[panel-monthly-senka-plan.md](panel-monthly-senka-plan.md) 順序 6）若在同一次發版前也改備份格式，併入同一個版號，不再另升。
- 同步更新 `docs/engineering/backup.md` 版本表與 `docs/structure.html` 版本錨點（`tests/structure-doc.test.ts` 會比對）。
- 往返測試：缺席維持缺席；`landing` 三個數字、`gaugeAtStart` 的 `gaugeNum` 選填都要原樣往返。

### 5.8 投影重跑

- projection version 若因本變更而升版，既有 `existing?.cleared` 保留規則照舊，另外保留 `clearedBy`。
- 已裁剪 raw event 的舊場次無法重算，新欄位維持缺席，不回填。

## 6. 實作順序

| 步驟 | 內容 | 驗收 |
|---|---|---|
| 1 | 純函式：battleresult 欄位解析（`exmapRate`、`firstClear`、`landing`）、旗艦受傷量與擊沉判斷（`flagshipDamage`、`flagshipSunk`）與 §5.2 判定，無 `chrome.*`／DOM | 以 `samples/6-5-battleresult-{before-clear,clear}.json` 與 61-x 樣本測試；無樣本的欄位用 KC3Kai／KancolleSniffer 的形狀寫合成資料，註明來源 |
| 2 | `SortieLogRow` 欄位、`EventProjector` 寫入與斬殺判定、`clearedBy`、mapinfo 後備的去重；備份 v14 與往返測試 | `npm run check`；6-5 兩場依序投影時只有擊破場被標 |
| 3 | `MapGaugeView.source` 與戰後推算、出擊起點比對；面板量表的「推算」標示 | 面板預覽三語；比對邏輯測試 |
| 4 | EO 戰果改讀 `exmapRate`；`resourceMarks` 加 EO；文件與 `THIRD-PARTY-NOTICES.md` | 戰果測試；`docs/engineering/maps.md`、`resources.md`、`backup.md` 改寫為現行規則 |

步驟 2 動資料格式，由主 session 用高強度模型做；步驟 1、4 規格寫死後可以派給子代理。

## 7. 實機檢查

步驟 2 完成後，開發者擇一進行：

1. 打一次 EO 的最後一擊（下個月 1-5 最省事）：回港後面板與總括的 EO 戰果應已加上，不必開海域選擇；出擊紀錄裡被標斬殺的是擊破那一場。
2. 活動期間打掉任一段 HP 量表：同上，且下一段開始時量表回到伺服器值、沒有「推算」標示。

## 8. 已定案（2026-11-23 開發者確認）

1. 1-6 維持 mapinfo 快照補記（§5.4）。
2. 推算與伺服器值不一致時以伺服器為準，不持久化（§5.3）。
3. 每趟出擊都顯示當下這一段的量表，段內戰後扣量標「推算」（§5.3）。
4. 備份升 v14；第二期若同一次發版也改格式，併入同一版號（§5.7）。
