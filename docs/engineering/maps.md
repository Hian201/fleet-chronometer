# 關卡量表、節點與斬殺

## 關卡進度與剩餘次數（`api_get_member/mapinfo`，已實測驗證）

- `api_map_info[]`：`api_cleared`、`api_gauge_type`（1=擊破數式：`api_defeat_count`/
  `api_required_defeat_count`；2=HP量表式：`api_eventmap.api_now_maphp`/`api_max_maphp`）。
- **面板一律顯示「剩餘」語意**（量表隨進度遞減）：gaugeType 1 顯示「剩 N 次」=
  `required-defeat`（別顯示已擊破數，會被誤讀）；gaugeType 2/3 同理顯示剩餘。已用 6-5 實測（defeat 4/6 → 剩 2）。
- **maxHp=9999 為「尚未選擇難度」佔位**（`api_selected_rank`=0 時），非真實滿血。
- **gaugeType 2（HP量表式）擊破機制**（使用者提供，已用 `samples/61-5-jibun-rengou-node52.json`
  數字對照：總量表 8400、boss 旗艦 HP 1200＝`api_e_maxhps[0]`、入場 `now_maphp=809`）：
  量表**每場依「對 boss 旗艦造成的傷害」遞減**（非整刀），例如某場僅打 500 傷害＝8400→7900。
  進入「最終段」（殘量 ≤ boss 旗艦 HP，如 809≤1200）後，**傷害不會把量表打到 0——會 floor 在 1**
  （`now_maphp=1` 表「最終段、還差一沉」）；**唯有該場實際把 boss 旗艦沉沒，量表才真的變 0＝通關**
  （打了 900 但沒沉 1200 仍是失敗，量表停在 1）。**推論（斬殺偵測的機制保證）**：`now_maphp===0`
  在機制上唯一等價於「這場斬殺（沉 boss）成功」，故 `detectClear`／`isGaugeBroken` 只認 ===0
  是精確判定、非近似；`now_maphp===1`（最終段未沉）正確留在「未通關→保留」。
- **斬殺偵測的兩個端點皆已用真封包驗證**（`isGaugeBroken` 逐一核對）：未通關端
  `samples/61-5-jibun-rengou-node52.json` eventmap＝`{now_maphp:809, cleared:0}`→False；
  已通關端 `samples/61-4.json` eventmap＝`{now_maphp:0, cleared:1, gauge_num:4}`→True。
- **另定案 `api_eventmap.api_first_clear` 不可當斬殺旗標**：它在「未通關」時存在(=1)、「已通關」後反而消失
  （61-5 有、61-4 無），語意與「剛通關」相反。這條只針對 `api_eventmap` 物件；battleresult 頂層的
  同名欄位是另一回事：6-5 未擊破時的 Boss 戰為 `0`、擊破那一場為 `1`
  （`samples/6-5-battleresult-{before-clear,clear}.json`），本專案只將它保存為原始事實並於測試中交叉核對，不參與判定。
- **擊破後的 mapinfo 時序（已實測，`samples/6-5-mapinfo-{before,after}-clear.json`）**：打倒 Boss
  回港只送 `api_port/port`，不送 mapinfo；要等玩家再進出擊、開海域選擇畫面，遊戲才送出反映擊破的
  mapinfo。擊破數制（gaugeType 1）擊破後 `api_cleared` 變 1，`api_defeat_count`／
  `api_required_defeat_count` 兩欄整個消失（6-5：5/6 → 無欄位）；已通關的多段一般圖仍可能保留
  `api_defeat_count`（樣本中已通關的 7-2 為 `api_cleared=1` 且 `3/4`）。
- 剩餘次數：gaugeType 2 = `ceil(殘HP/boss旗艦HP)`（boss HP 實戰擷取；此為「最少場數」下界，
  假設每場都 S 沉 boss——`ceil(8400/1200)=7`＝使用者說的「最少 7 次」、`ceil(809/1200)=1`＝剩 1 次）；
  gaugeType 3（TP輸送）的量表欄位與剩餘場數尚未以真實封包驗證；目前 UI 不以
  `fleetTP()` 推估場數。`fleetTP()` 的理論公式可供未來驗證，但不能當成目前契約。
- EO 的 `api_sally_flag` 語意未解（兩份樣本比對過，尚未實際消耗過次數）。

## 節點類型（`utils/map-node-kind.ts`）——這個**在**封包裡

`api_req_map/start`／`next` 的 `api_event_id`／`api_event_kind` 直接給出節點性質，**是封包事實**，
與需要外部對照表的節點字母完全不同層次。節點類型必須直接保留這兩欄，才能呈現
「這條路線上有渦潮、有能動分歧、有空襲戰」等資訊。

語意轉寫自**航海日誌拡張版**（Nishisonic/logbook，MIT，見 THIRD-PARTY-NOTICES §6）的
`MapCellDto.getNextKind()`：`api_event_id` 2＝資源獲得／3＝渦潮／4＝戰鬥／5＝boss／
6＋kind＝敵影を見ず・能動分岐・気のせい／7＋kind＝航空偵察・航空戰／8＝船團護衛成功／9＝揚陸地點。

`api_event_kind`（戰鬥節點的細分）**只採用有樣本佐證的三個值**——KC3Kai 匯出的 `nodes[].desc`
與同一筆 `eventKind` 對得上：**6＝空襲戰**（61-3 節點 50、61-5 節點 48/37/51，封包
`fc_ld_airbattle`）、**5＝敵連合艦隊**（61-3 節點 53、61-5 節點 55，desc「深海聯合艦隊」）、
**1＝一般戰鬥**。其餘（2/3/4…）**一律回 null 不猜**——寧可少一個標籤也不要標錯節點類型
（同「節點字母」那次的教訓）。一般戰鬥與 boss 也不標，rank 與 BOSS 徽章已經說明了。

**存原始值、不存推導出的標籤**：語意對照日後若補上更多 eventKind，舊紀錄會自動跟著變正確。

**順帶查證的結論**：航海日誌拡張版**有記錄節點但不做字母**——它的「戰鬥履歷／掉落報告」表格
「マス」欄顯示的是 `MapCellDto.toString()`＝`マップ:6-5 セル:13 (ボス)`，編號＋類型而已。
這是「字母不在封包裡」的第三個獨立佐證（KC3Kai 自維護對照表、航海日誌乾脆不做）。

## 節點字母（`utils/map-node-letters.ts`）——`api_no` 是「路線段」不是「格子」

**關鍵事實**：進軍／戰鬥封包給的 `api_no`（本專案存成 `SortieLogRow.node`）是**路線段（edge）
id**，不是格子 id，更不是字母。KC3Kai 的 `edges.json` 一筆 edge 對到 `[起點字母, 終點字母]`，
我們要的是**終點字母**；而且**多條 edge 會對到同一個字母**（同一節點從不同方向進入——6-5 的
C／G／H／I／M 各有兩條）。所以「編號 → 字母」是多對一，**不可能由編號推算**。

61-5 真實出擊提供的對照如下，證明 edge id 與字母沒有可推導的順序關係：

```
edge    1   48   15   37   51   52   55
letter  A    E    I    Q    Y    Z   ZZ
```

**`api_get_master/mapinfo`／`api_get_master/mapcell` 不提供字母**：
那類 master 端點給的是**格子**（`api_id` 全海域通號／`api_no` 同海域內編號／顏色…），
既沒有字母、也不是我們手上的 edge id；字母是攻略圈的命名慣例，不在任何封包裡。
（`api_req_map/start` 的 `api_cell_data` 同理——ElectronicObserver 的 apilist 明載
`api_id`＝全海域通號、`api_no`＝同海域內編號，兩者都不是字母。）

**解法**：用 KC3Kai 的 `edges.json`（MIT，見 THIRD-PARTY-NOTICES §5）產生
`utils/map-edge-letters.ts`（193 張海域、5904 條 edge，只留終點字母）。
**兩份獨立的真實資料交叉驗證通過**：(a) 使用者提供的 61-5 路線 A/E/I/Q/Y/Z/ZZ 逐筆相符；
(b) 使用者提供的 KC3Kai 6-5 截圖（`samples/KC3kai_sortie_log.png`）顯示 A C E H G M，
與表中 edge 1/3/5/8/7/13 完全一致。

查不到的海域（新活動開圖、上游還沒更新）**顯示原始 edge 編號並在 UI 說明原因，絕不推算**；
原始編號一律留在 tooltip。`EDGE_LETTER_OVERRIDES` 供臨時人工覆蓋（平時應為空）。

**顯示節點的地方一律走同一支 `nodeLabel()`**（面板出擊分頁、出擊紀錄的軌跡／節點卡／基地波次／
支援出動節點、LLM 報告）。節點字母只能使用已驗證的對照表；查不到時顯示原始 edge 編號，
不以 ASCII 或其他推算法補出字母。不同海域的 edge 編號並不共用同一字母順序，直接推算會產生
看似合理但錯誤的節點標籤。

## 斬殺偵測與戰後量表推算

### 兩種 `cleared` 的語意區分

- **`SortieLogRow.cleared`**：代表「**這一場打掉了一段量表**」（含活動多段圖各段、EO 整圖，以及 7-5／5-6／首次 7-2、7-3 的中間段）。搭配 `clearedBy: 'battle' | 'mapinfo'` 記錄判定依據（舊列缺席代表既有的 mapinfo 後備規則）。
- **`MapGaugeView.cleared`**：代表「**整張海域已通關**」（來自 `mapinfo` 的 `api_cleared`，或戰鬥結算 `api_get_exmap_rate > 0` 確定 EO 整圖通關）。活動圖與多段圖的 HP／TP／擊破數歸零時，不將 `MapGaugeView.cleared` 設為 `true`，以保留整圖通關語意給 `onReqMapStart()`、`mapCleared()` 與重播保護；面板標題列改依 `isGaugeZeroed()` 在量表歸零時立即顯示 `✓`。

### 戰鬥當下判定（`utils/gauge-clear.ts`、`GameState.onReqSortieBattleresult()`）

判定只在 `GameState.onReqSortieBattleresult()` 執行一次，**必須在更新 `mapGauges` 之前、用戰前量表與出擊起點記錄的 `sortieInfo.gaugeAtStart` 計算**，將原始事實（`flagshipSunk`、`flagshipDamage`、`gaugeAtStart`、`exmapRate`、`firstClear`、`landing`）與判定結果（`cleared`／`clearedBy: 'battle'`）寫入 `battleInfo`，`EventProjector.archiveSortie()` 只照抄不重算。

- **EO 整圖通關**：`api_get_exmap_rate` 解析為正整數（`exmapRate > 0`，見 `samples/6-5-battleresult-clear.json` 的 `"250"`，並對照 KancolleSniffer `ExMapInfo.cs`），不依賴本機量表狀態；同步將 `MapGaugeView.cleared` 設為 `true`（`source: 'server'`）。
- **擊破數式（gaugeType 1）**：`!gauge.cleared`、`requiredDefeatCount > 0`、`defeatCount === requiredDefeatCount - 1` 且目標量表 Boss 旗艦擊沉（`isGaugeBossNode()`＋戰後敵主隊旗艦 HP ≤ 0）。未歸零但旗艦擊沉時遞增 `defeatCount` 並標 `source: 'estimate'`。
- **HP 式（gaugeType 2）**：`!gauge.cleared`、`gaugeAtStart.type === 2`、`gaugeAtStart.now > 0`、`flagshipDamage !== undefined`、`gaugeAtStart.now − flagshipDamage ≤ 0` 且目標量表 Boss 旗艦擊沉。非歸零時推算 `nowHp = max(now − damage, flagshipSunk ? 0 : 1)` 並標 `source: 'estimate'`；`gaugeAtStart.type === 0` 不做 HP 扣量推算，孤立夜戰接續包（缺少晝戰起點）不寫 `flagshipDamage`。
- **TP 式（gaugeType 3）**：`!gauge.cleared`、`api_landing_hp` 帶 `sub > 0` 且 `now − sub ≤ 0`（語意依 KC3Kai `Node.js`：`now` 為戰前剩餘量、`sub` 為本場登陸量；欄位形狀依 kcsapi.ts 由真實樣本產生的型別，數值可能是字串。本專案樣本 `samples/5-6-1-battleresult-landing.json`（通常艦隊，`280/280/79`，皆為數字）與登陸後的 `samples/5-6-mapinfo-after-landing.json`（`api_defeat_count` 79／`api_required_defeat_count` 280）證實 `now` 為戰前值。一般海域的 TP（如 5-6 第一段）在 mapinfo 不帶 `api_eventmap`，以 `api_defeat_count` 表示已登陸量、`api_required_defeat_count` 表示上限，戰後也以同樣欄位更新（`defeatCount = max − max(0, now − sub)`），面板顯示剩餘＝上限－已登陸；活動海域的 TP 仍用 `api_eventmap` 的 now/max）；活動海域戰後以 `max(0, now − sub)` 更新 `nowHp`（`source: 'server'`）。終點節點（`api_req_map/next` 且 `api_next == 0` 帶 `api_eventmap`）直接以伺服器值更新記憶體 `mapGauges`、不寫出擊列，同時涵蓋運輸終點與 Boss 戰終點帶戰前量表的情況（後者見 `samples/base-air-raid-3.json`：`api_event_id=5`、`api_next=0`、`api_eventmap` 840/4840）。
- **介面推算標示與伺服器優先**：`MapGaugeView.source === 'estimate'` 時，面板在量表數值前顯示 `≈`，三語完整推算說明放 `title` 與 `aria-label`；下一筆 `mapinfo`、`select_eventmap_rank` 或 `api_req_map/start` 到達時一律以伺服器值取代並改回 `source: 'server'`。開發版在同段（`gaugeNum` 與 `gaugeType` 相同且未通關）收到與推算不同的伺服器值時，於 console 印出差異供核對。
- **EO 戰果防護（`utils/senka.ts`）**：`clearedBy === 'battle'` 的列只有 `exmapRate > 0` 才計入 EO 戰果（不退回查固定表，避免 7-5／5-6 中間段斬殺誤算）；表內外海域皆以封包 `exmapRate` 優先於固定表與較晚到達的 mapinfo 快照。1-6（無 Boss 戰）維持由 mapinfo 快照補記。

### mapinfo 轉變後備（`EventProjector.detectClear()`）

開面板前打掉、跨裝置通關、孤立夜戰缺起點或欄位缺席時，仍由 `detectClear()` 觀測 `api_get_member/mapinfo` 的「未擊破 → 擊破」轉變補標 `cleared: true, clearedBy: 'mapinfo'`。`gaugeSeenUncleared` 改為 `Map<number, number>`（記錄該圖最近一次觀測到未擊破的 `ts`）：若該圖已有 `row.ts >= seenTs` 且 `clearedBy === 'battle'` 的列則跳過；走後備時同樣只篩選 `row.ts >= seenTs` 的 Boss 戰，避免跨裝置通關或換段後誤標更早的舊戰。不記錄的海域不寫斬殺旗標。`wantedTag` 不為此抓樣本。
