# 量表與斬殺的戰鬥當下判斷：資料設計提案

狀態：**設計已定案，待開發者確認啟動後開始實作**。本檔動到出擊紀錄的資料格式與備份版本，依 `AGENTS.md` 硬約束 2 與 [`docs/task-template.md`](task-template.md) 分流表，先討論相容做法再動手。

## 1. 目標

量表進度與斬殺在**戰鬥結算當下**就確定，而且記在**真正打掉量表的那一場**，不必等玩家下次開海域選擇畫面。具體要做到：

- EO 擊破在結算當下即寫入 `db.sorties`（戰果值取自封包本身），回港後面板與總括的本月戰果立即反映。
- 活動海域與一般海域多段圖的 HP 量表、擊破數量表、TP 量表在結算當下更新剩餘量；每一段量表的斬殺都標在正確的那一場。
- 伺服器給的值和本機推算的值分開保存，介面看得出哪個是推算；伺服器值到達時一律以伺服器為準。
- 每次出擊都顯示當下這一段的量表。

## 2. 現況

判斷斬殺的地方有三處，全部只靠 `api_get_member/mapinfo` 的前後比對：

| 位置 | 寫入 | 判斷方式 |
|---|---|---|
| `utils/event-projector.ts` `detectClear()` | `SortieLogRow.cleared` | 本次事件流看過某圖「未擊破」，之後的 mapinfo 變「已擊破」，就把該圖**最近一場** Boss 戰標為斬殺 |
| `utils/resource-capture.ts` | `resourceMarks` 的 `gauge-clear` | 同上的守衛規則，在 background 落地（僅活動海域，供活動資源分期使用） |
| `utils/senka-readings.ts` | 無（讀取時合併） | `sorties.cleared` 加上當月 mapinfo 快照的 `api_cleared` |

量表顯示（`GameState.mapGauges`）的現值來自 mapinfo、`api_req_map/select_eventmap_rank` 與 `api_req_map/start` 的 `api_eventmap`。戰鬥之後不更新，要等下一筆伺服器資料。

已實測的時序（`samples/6-5-mapinfo-{before,after}-clear.json`）：打倒 Boss 回港只送 `api_port/port`，玩家再開海域選擇畫面才送反映擊破的 mapinfo。因此現況有三個問題：

1. **延遲**：擊破後到下次開海域選擇之間，量表、斬殺與 EO 戰果都沒更新。
2. **標錯場次**：擊破後、下次 mapinfo 前又在同一張圖出擊，斬殺會標到那一場（[maps.md](engineering/maps.md)「斬殺偵測」已知邊角）。
3. **EO 戰果靠固定表**：`EO_SENKA_MAPS` 要人工維護；改為封包值優先後，有戰鬥的新 EO 不必補表（僅靠 mapinfo 快照補記的情況，例如面板沒開時打掉、或像 1-6 這種沒有戰鬥的 EO，仍需要補表）。

## 3. 證據

依硬約束 8，每個欄位都要有真封包或成熟開源專案實際解析的程式碼。

| 欄位 | 出處 | 證據 | 狀態 |
|---|---|---|---|
| battleresult `api_get_exmap_rate` | `api_req_sortie/battleresult`、`api_req_combined_battle/battleresult` | 樣本：6-5 擊破場 `"250"`（字串）、未擊破場 `0`（數字）。KancolleSniffer `KancolleSniffer/Model/ExMapInfo.cs` `InspectBattleResult()` 以非 0 判定 EO 擊破並取其值為戰果，字串與數字都處理 | 可用 |
| battleresult `api_get_exmap_useitem_id` | 同上 | 樣本：擊破場 `"57"`、未擊破場 `0`。poi `views/redux/info/useitems.ts` 以非 0 累加道具庫存；`state.ts` 已採同樣做法 | 可用（只改註解，不改行為） |
| battleresult `api_first_clear` | 同上 | 樣本：擊破場 `1`、未擊破場 `0`。KC3Kai `src/library/objects/Node.js` 以 `clear \|= api_first_clear` 記錄通關 | 可用，但只當輔助（見 §5.3） |
| battleresult `api_destsf` | 同上 | 樣本：6-5 三場 Boss 皆擊沉，值皆為 `1`。KC3Kai `Node.js` 以它判斷敵主隊旗艦是否擊沉 | 不作為判定依據，只在測試中與戰鬥分析的結果交叉核對（§5.2） |
| battleresult `api_landing_hp` | 同上（運輸作戰） | KC3Kai `Node.js` 讀 `api_now_hp`、`api_max_hp`、`api_sub_value`，三者可能是字串 | 可用，無本專案樣本 |
| `api_req_map/next` 的 `api_eventmap`（運輸終點） | 終點不是戰鬥點時 | KC3Kai `Node.js`：`api_next == 0` 且帶 `api_eventmap` 時，以 `api_now_maphp` 更新剩餘 TP | 可用，無本專案樣本；僅更新記憶體 `GameState.mapGauges`（§5.3） |
| `api_req_map/next` 的 `api_get_eo_rate` | 1-6 終點（無 Boss 戰） | KancolleSniffer `ExMapInfo.cs` `InspectMapNext()` 以非 0 判定 EO 擊破並取其值 | **不採用**（見 §5.4） |
| HP 量表扣量＝Boss 旗艦受傷量，最終段未擊沉停在 1 | 機制 | [maps.md](engineering/maps.md) 第一節，已用 61-5、61-4 真封包驗證 | 已驗證 |

採用時在程式註解寫明專案與檔案路徑，依 clean-room 重寫，並在 `THIRD-PARTY-NOTICES.md` 登錄 KancolleSniffer（Apache-2.0）與 KC3Kai 這兩處讀法。

## 4. 設計原則

KC3Kai 的判斷規則正確，本設計沿用；資料存法則不同，原因如下。

| KC3Kai 的做法 | 問題 | 本設計 |
|---|---|---|
| 戰後把推算值直接寫回 `curhp` | 分不出伺服器值與推算值，介面也無法標示 | 伺服器值與推算值分開保存，推算以 `≈` 標示 |
| 推算與伺服器值都寫進同一個欄位 | 事後分不出哪段時間顯示的是推算 | 伺服器值一到就取代推算（伺服器為準）；開發版可在 console 看到兩者差異 |
| 推算存在 localStorage 的可變狀態 | 無法從原始事件重算 | 推算由原始事件重新投影得出，符合硬約束 5 |
| EO 戰果取固定表 | 新 EO 或分數調整要人工補表 | 封包值優先（表內外皆然），固定表只給舊列與快照補記用 |

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
| `flagshipDamage` | `number` | 本場戰鬥敵主隊旗艦的受傷量：開戰時 `beginHp` 減戰後 `max(0, hp)`（`utils/battle.ts` 已算出）；`0` 是合法值。面板開在夜戰畫面而缺少晝戰起點（孤立夜戰接續包）時不寫 | HP 量表扣量 |
| `gaugeAtStart` | `{ type: number; now: number; max: number; gaugeNum?: number }` | 僅在 `api_req_map/start` 帶 `api_eventmap` 時寫入（`now`/`max` 取伺服器值，`type`/`gaugeNum` 沿用 `onReqMapStart()` 合併後的結果；一般海域無 `api_eventmap` 時不寫） | 推算起點、事後比對 |
| `exmapRate` | `number` | battleresult `api_get_exmap_rate` 解析為正整數時 | EO 擊破與戰果值 |
| `firstClear` | `0 \| 1` | battleresult `api_first_clear` 原始值 | 輔助核對 |
| `landing` | `{ now: number; max: number; sub: number }` | battleresult `api_landing_hp` | TP 量表 |
| `clearedBy` | `'battle' \| 'mapinfo'` | 寫入 `cleared` 的那條規則 | 標示斬殺的依據；舊列缺席＝舊規則 mapinfo |

- `flagshipSunk`、`flagshipDamage`、`gaugeAtStart` 只寫在 `state.ts` 的 `isGaugeBossNode()` 判定為目前量表 Boss 點的場次，避免破甲路線回打舊階段 Boss 污染判斷。
- 欄位缺席一律「不可考」，不補預設值，舊列不回填。
- 不是索引欄位，**不需升 DB 版本**。

### 5.2 斬殺判定（`GameState` 判定，`EventProjector` 照抄寫入）

**執行順序**：`EventProjector.projectWithMode()` 先執行 `state.applyEvent()` 再呼叫 `archiveSortie()`。因此 §5.2 的判定**只在 `GameState.onReqSortieBattleresult()` 跑一次，且必須在更新 `this.mapGauges` 之前、用戰前的 `MapGaugeView`（與出擊起點保存的 `sortieInfo.gaugeAtStart`）計算**。計算出的原始欄位與判定結果（`cleared`／`clearedBy`）比照 `useItemDrops` 寫進 `this.battleInfo`，`EventProjector.archiveSortie()` 只照抄寫入 `SortieLogRow`，不再重算。這樣可確保擊破數式等條件不會讀到戰後值，也讓 `overview` 與 `panel` 的結果完全一致。

`SortieLogRow.cleared` 的語意定為「**這一場打掉了一段量表**」（區別於 `MapGaugeView.cleared` 的「整張海域已通關」）。所有未通關海域的每一段量表歸零都依同一條規則標 `cleared: true, clearedBy: 'battle'`（包含活動各段，以及 7-5／5-6／首次 7-2、7-3 的中間段），不以固定 EO 表切分例外。

| 量表 | 判定打掉的條件 | 依據 |
|---|---|---|
| EO 整圖通關 | `exmapRate > 0` | 封包事實（不依賴本機量表狀態） |
| 擊破數式（一般與活動） | `!gauge.cleared`、`gauge.gaugeType === 1`、`gauge.requiredDefeatCount > 0`、`gauge.defeatCount === gauge.requiredDefeatCount - 1` 且 `flagshipSunk` | KC3Kai 規則；需有伺服器 `mapinfo` 值，否則交給後備 |
| HP 式（活動） | `!gauge.cleared`、`gaugeAtStart.type === 2`、`gaugeAtStart.now > 0`、`flagshipDamage !== undefined`、`gaugeAtStart.now − flagshipDamage ≤ 0` 且 `flagshipSunk` | 已驗證機制（見下） |
| TP 式（一般與活動） | `!gauge.cleared`、`landing.sub > 0` 且 `landing.now − landing.sub ≤ 0` | 封包事實 |

- 非 `exmapRate` 的規則一律要求 `!gauge.cleared`，避免已通關後仍保留 `api_defeat_count` 的海域（如樣本中已通關的 7-2 為 3/4）在周回時重複誤標斬殺。
- `gaugeAtStart.type === 0`（未知量表種類）時不做 HP 扣量推算，避免把 TP 條當 HP 扣。

HP 量表的扣量規則（[maps.md](engineering/maps.md) 第一節已驗證）：每場以 Boss 旗艦受到的傷害扣量表。例如量表 8000、Boss 1000，Boss 被打到剩 200 沒沉，就扣 800，變 7200/8000。量表已低於 Boss HP（如 200/8000）時，只要 Boss 沒被打到 0，量表最低停在 1；只有擊沉 Boss 才歸 0、結束這一段。所以推算值＝`max(現值 − 扣量, flagshipSunk ? 0 : 1)`。

`flagshipSunk` 與 `flagshipDamage` 都從同一份戰鬥 HP 分析取得，不依賴 `api_destsf`，因此不需要另外收「Boss 沒沉」的樣本：沒沉就是戰後 HP 仍大於 0，戰鬥分析本來就算得出來。

符合時直接把**這一場**標為 `cleared: true`、`clearedBy: 'battle'`。`EventProjector.gaugeSeenUncleared` 改為 `Map<number, number>`（記錄該圖最近一次看到未擊破的 `ts`）：之後 mapinfo 轉變到達時，若該圖已有 `clearedBy: 'battle'` 且 `row.ts >= seenTs` 的列，就不再呼叫 `markLatestBossCleared()`；走後備時，`markLatestBossCleared()` 同樣以 `row.ts >= seenTs` 篩選，避免跨裝置通關或換段後誤標更早的舊 Boss 戰。

### 5.3 量表顯示（`GameState.mapGauges`，只在記憶體）

`MapGaugeView` 加一個欄位（不加 `estimatedFromEventId`，免動 `applyEvent()` 簽章）：

- `source?: 'server' | 'estimate'`：伺服器值或本機推算（舊快照／未設定時視為 `'server'`）。

**分工**：斬殺判定與量表更新都放在 `GameState.onReqSortieBattleresult()`（呼叫步驟 1 純函式，**先依戰前量表判定並寫入 `battleInfo`，再更新 `mapGauges`**）；`EventProjector` 只從 `battleInfo` 照抄結果，讓只跑 reducer 的 `overview` 與跑 projector 的 `panel` 行為完全一致。

- **目標 Boss 戰結算後**依 §5.2 規則更新現值：
  - HP 式未歸零：更新 `nowHp = max(nowHp − flagshipDamage, flagshipSunk ? 0 : 1)` 並設 `source: 'estimate'`。
  - HP 式歸零：設 `nowHp = 0`（**不設 `cleared: true`**，保留整圖通關語意給 `onReqMapStart()`、`mapCleared()` 與重播保護）。
  - 擊破數式未歸零但 `flagshipSunk`：遞增 `defeatCount` 並設 `source: 'estimate'`；達標時設 `defeatCount = requiredDefeatCount`（不設 `cleared: true`，除非同時 `exmapRate > 0`）。
  - TP 式帶 `api_landing_hp`：更新 `nowHp = max(0, landing.now − landing.sub)`（`source: 'server'`，封包事實；不設 `cleared: true`）。
  - `exmapRate > 0`：確定整圖通關，設 `cleared: true`（`source: 'server'`）。
- **運輸終點（`api_req_map/next` 且 `api_next == 0` 帶 `api_eventmap`）**：直接以 `api_eventmap` 的伺服器值更新 `GameState.mapGauges`（`source: 'server'`），不寫 `SortieLogRow`。
- `mapinfo`、`select_eventmap_rank`、`api_req_map/start` 到達時一律以伺服器值取代並改回 `source: 'server'`。
- **面板顯示**（`entrypoints/panel/sortie-gauge.ts`、`entrypoints/panel/main.ts` `sortieHeaderHtml()`）：
  - `gauge.cleared` 或量表已歸零（`gaugeType === 1` 達標，或 `gaugeType === 2/3` 且 `maxHp > 0 && maxHp !== 9999 && nowHp === 0`）時，顯示已擊破 `✓`，不猜下一段。
  - `source === 'estimate'` 時沿用專案慣例（見 `resource-log.ts`、`fleet-photo.ts`）：在數值前加 `≈`（不撐寬狹窄標頭），三語完整推算說明放 `title` 與 `aria-label`。
- **不一致的處理**：伺服器值永遠為準，推算不持久化。只有開發版在**同一段**（`gaugeNum` 相同）收到伺服器值、且與推算不同時，於 console 印出兩者，方便發現扣量規則的漏洞。

`api_first_clear` 不參與判定，只在測試中核對它和 §5.2 的結果一致；目前證據只有 EO 一對樣本，活動多段量表的中間段是否為 1 未知。

### 5.4 1-6（無戰鬥的 EO）

1-6 的擊破發生在 `api_req_map/next`，沒有 `SortieLogRow`，維持現行 mapinfo 快照補記，不新增資料表。唯一代價：月末 21:xx 擊破 1-6、22:00 後才開海域選擇，會漏算當月 +75。為了這個邊界新增表並升 DB 版本不划算。

### 5.5 EO 戰果（`utils/senka.ts`）

- `EoSortieInput` 新增 `exmapRate?: number` 與 `clearedBy?: 'battle' | 'mapinfo'`；`loadSenkaMonthData()` 直接將 `SortieLogRow` 傳入，欄位隨之帶過去。
- **中間段防護**：`clearedBy === 'battle'` 的列**只有 `exmapRate > 0` 才計入 EO 戰果**，不得退回查 `EO_SENKA_MAPS`（避免 7-5 P1/P2、5-6 P1 的段落斬殺誤算整圖戰果）。只有舊列（`clearedBy === undefined`）、`clearedBy === 'mapinfo'` 與 mapinfo 快照才退回查表。
- **封包值優先（表內外皆然）**：
  - 同一海域同一作戰月仍只計一次；若同時有帶 `exmapRate > 0` 的戰鬥列與較晚的 mapinfo 快照，**以帶 `exmapRate` 的戰鬥列優先**（避免較晚到達的快照蓋掉封包戰果值與擊破時刻）；同等級時取最新 `ts`。
  - 表內海域只要勝出列有 `exmapRate > 0`，`item.points` 與 `total` 皆以封包值為準，日後官方調整分數不必改表。
  - 表外海域若有 `exmapRate > 0`，一樣計入 `total`、`clearedCount`，並附在 `items` 尾端（`EoSenkaItem.map` 型別放寬為 `string`，`mapCount = items.length`）。表外海域在擊破前不會出現，擊破後總括標題的 `{done}/{total}` 會由 `0/9` 變為 `1/10`。
- **刷新時機**：維持既有的 `api_port/port`／`api_get_member/mapinfo`／`api_req_quest/clearitemget` 刷新清單（打完 EO Boss 必回港送 `api_port/port`），不另監聽 `battleresult`、不做延遲重讀。

### 5.6 備份

- `utils/backup.ts` 的 sortie 驗證逐欄重建，**沒列出的欄位會被丟掉**。所以舊版擴充還原新備份時，§5.1 的新欄位會默默消失，違反硬約束 2。
- 比照 v13（`resources.exp`）：`BACKUP_SCHEMA_VERSION` 升 14，表組合不變，新欄位只在 v14 以後接受（v13 以前夾帶即拒絕）。舊版擴充遇到 v14 會明確回報「不支援較新的備份版本」。這是避免默默遺失資料的唯一做法。
- 驗證下限：`flagshipDamage`、`gaugeAtStart.type`、`gaugeAtStart.now`、`landing.now`、`landing.sub` 皆允許 `0`；`gaugeAtStart.max`、`gaugeAtStart.gaugeNum`、`exmapRate`、`landing.max` 下限 `1`；`firstClear` 嚴格 `0 | 1`；`clearedBy` 嚴格 `'battle' | 'mapinfo'`。
- 第二期排行榜（[panel-monthly-senka-plan.md](panel-monthly-senka-plan.md) 順序 6）若在同一次發版前也改備份格式，併入同一個版號，不再另升。
- 同步更新 `docs/engineering/backup.md` 版本表與 `docs/structure.html` 版本錨點（`tests/structure-doc.test.ts` 會比對）。
- 往返測試：缺席維持缺席；`flagshipDamage: 0`、`landing` 三個數字、`gaugeAtStart` 的 `gaugeNum` 選填都要原樣往返。

### 5.7 投影版本

- **不升 `PROJECTION_META_VERSION`（維持 v3）**。理由：原始事件僅保留約兩個登入週期，補回效益低；若升版重投影並保留 `existing.cleared`，舊規則標錯場次時會與新規則標對的場次並存，造成同一次擊破有兩列 `cleared`，汙染出擊紀錄與重播永久保留。
- 既有 `existing?.cleared` 保留規則在 `archiveSortie()` 照舊，另保留 `existing?.clearedBy`（若本次新規則已判定為 `'battle'`，優先使用新結果）。已裁剪 raw event 的舊場次新欄位維持缺席，不回填。

## 6. 實作順序

| 步驟 | 內容 | 驗收 |
|---|---|---|
| 1 | 純函式（如 `utils/gauge-clear.ts`）：battleresult 欄位解析（`exmapRate`、`firstClear`、`landing`）、旗艦受傷量與擊沉判斷（`flagshipDamage`、`flagshipSunk`，含 0 傷害與孤立夜戰）、§5.2 斬殺判定與量表推算計算，無 `chrome.*`／DOM | 以 `samples/6-5-battleresult-{before-clear,clear}.json` 與 61-x 樣本測試；無樣本的欄位用 KC3Kai 的形狀寫合成資料，註明來源 |
| 2 | `SortieLogRow` 欄位、`GameState` 結算當下先依戰前量表判定並寫入 `battleInfo`、`EventProjector` 照抄寫入 `cleared`／`clearedBy`、`gaugeSeenUncleared` 改 `Map<number, number>` 與 mapinfo 後備去重；備份 v14 與往返測試 | `npm run check`；6-5 兩場依序投影時只有擊破場被標；擊破數式（如 1-5 3/4→4/4 或無 `exmapRate` 的 7-5 P1 1/2→2/2）最後一擊有被標斬殺；7-2 已通關（3/4）不誤標 |
| 3 | `GameState.applyEvent()` 在判定之後更新 `MapGaugeView.source`（戰後推算、歸零不設 `cleared: true`、運輸終點 `api_req_map/next`）、出擊起點比對；面板量表的 `≈` 推算標示與歸零「已擊破」顯示 | 面板預覽三語；比對邏輯與 `onReqMapStart`／`unclearedMaps` 測試；回歸確認步驟 2 的擊破數式最後一擊在量表更新後仍正確標斬殺 |
| 4 | `eoSenkaForMonth()` 改讀 `exmapRate`（戰鬥列只認 `exmapRate > 0`、表內外皆封包優先、戰鬥列優先於快照）；文件（`docs/engineering/maps.md` 寫明兩種 `cleared` 語意、`backup.md`、`docs/structure.html`）與 `THIRD-PARTY-NOTICES.md` | 戰果測試（含 7-5 P1 中間段不誤算、表外新 EO、表內調分、快照覆蓋順序）；`npm run check` |

步驟 2 動資料格式，由主 session 用高強度模型做；步驟 1、4 規格寫死後可以派給子代理。

## 7. 實機檢查

測試時**需要開著面板**（`db.sorties` 由面板的 `EventProjector` 寫入）。步驟 2 完成後，開發者擇一進行：

1. 打一次 EO 的最後一擊（下個月 1-5 最省事）：回港後（`api_port/port` 觸發刷新）面板與總括的 EO 戰果應已加上，不必開海域選擇；出擊紀錄裡被標斬殺的是擊破那一場。
2. 活動期間打掉任一段 HP 量表：同上，且下一段開始時量表回到伺服器值、沒有 `≈` 推算標示。

## 8. 已定案（2026-11-23 開發者確認）

1. 1-6 維持 mapinfo 快照補記（§5.4）；不採用 `api_get_eo_rate`。
2. 推算與伺服器值不一致時以伺服器為準，不持久化（§5.3）。
3. 每趟出擊都顯示當下這一段的量表，目標 Boss 戰結算後扣量以 `≈` 標推算（§5.3）；不加 `estimatedFromEventId`。
4. HP／TP／擊破數歸零時不將 `MapGaugeView.cleared` 設為 `true`（僅 `exmapRate > 0` 確定整圖通關才設），由標題列依歸零顯示已擊破（§5.3）。
5. 段落斬殺採統一規則（選項 A）：所有未通關海域的每一段量表歸零都標 `SortieLogRow.cleared = true`（含活動各段與 7-5／5-6／首次 7-2、7-3 中間段）；`SortieLogRow.cleared` 語意為「打掉一段量表」，與 `MapGaugeView.cleared`（「整圖通關」）區分。
6. 表外 EO 只要有 `exmapRate > 0` 即納入 `eoSenkaForMonth()` 的 `total`／`clearedCount`／`items`；表內海域有 `exmapRate` 時同樣以封包值為準，且戰鬥列優先於較晚的 mapinfo 快照；`clearedBy === 'battle'` 但無 `exmapRate` 的列不查表（§5.5）。
7. 不改 `resourceMarks`（移除原 §5.6）；不另加 `battleresult` 戰果刷新監聽，維持回港 `api_port/port` 刷新。
8. 備份升 v14（§5.6）；第二期若同一次發版也改格式，併入同一版號。
9. 不升 `PROJECTION_META_VERSION`（維持 v3，§5.7）。
10. 斬殺判定只在 `GameState.onReqSortieBattleresult()` 用戰前量表跑一次、結果寫進 `battleInfo` 後才更新 `mapGauges`；`EventProjector` 只照抄（比照 `useItemDrops`，§5.2／§5.3）。
