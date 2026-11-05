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
  **另定案 `api_first_clear` 不可當斬殺旗標**：它在「未通關」時存在(=1)、「已通關」後反而消失
  （61-5 有、61-4 無），語意與「剛通關」相反。**仍未觀測到的只剩「即時性」**——擊破當下
  遊戲是否立刻推一筆 `now_maphp=0` 的 mapinfo（或要等玩家再開圖才送），這只影響 detectClear
  的觸發延遲、不影響判定正確性。即時 mapinfo 仍待 live 觀測；`wantedTag` 不再為此抓樣本。
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

## 斬殺偵測

判定欄位已實測，只有「擊破當下緊接的 mapinfo」尚未以真封包觀測（只影響觸發延遲）。
`panel/main.ts detectClear()` 在 mapinfo 更新後比對量表，觀測到某海域「未擊破→擊破」
（`api_cleared` 0→1／HP量表 `api_now_maphp` 歸 0／擊破數達標，欄位皆已實測）就把該圖最近一場
boss 出擊標 `cleared`。只在「本次事件流曾看過該圖未擊破」時才判定轉變（避免面板啟動重播時把
「一開始就已通關」誤標到近期某場）；consume 於 replay/live 皆呼叫，歷史斬殺自動回填。
`wantedTag` 不為此抓樣本。
已用真實 `61-5-jibun-rengou-node52.json` 的 eventmap（`now_maphp=809, cleared=0`）確認
`isGaugeBroken` 對「未斬殺場」不誤觸。**已知邊角**：若斬殺後、下一次 mapinfo 到達
前又在同圖 farming，轉變會標到 farming 場而非斬殺場（罕見，且新船掉落＋手動釘選可補）。
