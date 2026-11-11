# 目標規劃（`utils/remodel-goals.ts`＋`sections/goals.ts`）

**分區的範圍**：「目標規劃」只放玩家自己宣告的終點，並替每個終點算需求、缺口與（有流量資料後
的）到達日。目前唯一的目標種類是改造：玩家指定「某艘艦改到某個形態」，分區列出還缺的等級、
經驗與各項消耗，並依目標的排列順序分配庫存。資材分帳、出擊帳單這類紀錄，以及閒置檢查、遠征
組合這類建議，都不放在這個分區；各自的歸屬與尚未實作的階段見
[`../completion-plan.md`](../completion-plan.md) §3、§4.6。

## 需求的兩種來源，介面必須分開標示

| 項目 | 來源 | 性質 |
|---|---|---|
| 所需等級 | `api_mst_ship.api_afterlv` | 封包事實 |
| 彈藥、鋼材 | `api_mst_ship.api_afterbull`、`api_afterfuel` | 封包事實 |
| 改裝設計圖、試製甲板彈射器、戰鬥詳報、新型航空兵裝資材、新型兵裝資材、海外艦最新技術、新型高溫高壓缶 | `api_mst_shipupgrade` | 封包事實 |
| 開發資材、高速建造材、新型砲熕兵裝資材、改修資材、工廠資源 | `utils/remodel-cost-data.ts` | 推算 |

- **`api_afterfuel` 是鋼材不是燃料**。`samples/start2-master.json` 核對：長門改→長門改二為
  `afterbull` 8800、`afterfuel` 9200，與改造畫面的彈藥 8800、鋼材 9200 一致。
- **`api_mst_shipupgrade` 以「改造前」為鍵**（`GameState.remodelItems`）。同一個改造後形態可有
  多個來源（可逆改裝），而一艘艦只有一個下一段；只收 `api_id` 與該艦 `api_aftershipid` 對得上
  的列。欄位語意以樣本對照 wikiwiki「改造」頁核對，逐欄對照見 `utils/state.ts` 的宣告處。
- **新型高溫高壓缶是裝備**（`api_boiler_count`），庫存以日文原名查裝備持有數，其餘六種查道具
  持有數（id 見 `REMODEL_USEITEM_ID`，名稱沿用 `utils/item-catalog.ts`）。
- **推算類的數量寫死在遊戲 client 裡，master 沒有**。`tools/remodel-cost/generate.py` 從上游的
  逐艦表擷取數值，產出 `utils/remodel-cost-data.ts`；來源與授權見 `THIRD-PARTY-NOTICES.md` §9c。
  表內沒有的艦不代表確定為 0，所以這幾列一律標「推算」。新艦實裝後要重跑產生器。
- **開發資材的通則**（例外表沒列時）：用了設計圖就不耗，少數艦例外
  （`BLUEPRINT_STILL_NEEDS_DEVMAT`）；否則依鋼材量分級——未滿 4500 為 0、未滿 5500 為 10、未滿
  6500 為 15、其餘 20。

## 路徑

`remodelPath()` 沿 `afterShipId` 一段一段走到目標形態，消耗逐段加總，所需等級取各段的最大值。
可逆改裝會互指成環（鈴谷改二 ⇄ 鈴谷航改二、大和改二 ⇄ 大和改二重），繞回走過的形態就停：
`remodelTargets()` 因此讓環上每個形態各出現一次，到不了的目標回傳 `null`，介面顯示「目前的形態
改不到這個目標」而不是猜一條路。

## 經驗

`SHIP_EXP_TOTAL[等級]` 是到達該等級的累計經驗，與 `api_exp[0]` 相減得到差距。表只到 Lv99：
改造所需等級目前最高 98，Lv100 以上牽涉結婚後的累計基準，用不到就不帶；超出範圍時回傳
`null`，介面顯示不可考。

## 庫存分配

`planRemodelGoals()` 依目標陣列的順序逐一分配：排前面的先拿，後面的目標看到的是剩餘量。
不替玩家排優先順序，也不在目標之間平均分配。已達成、艦已不在名冊、到不了的目標不佔庫存。

持有量尚未收到對應封包時是 `null`，該列的「可用」與「缺口」顯示不可考，不以 0 頂替——把不可考
當成 0 會讓每個目標都顯示成缺貨。

## 儲存

目標是玩家的意圖，不是封包衍生資料：存 `db.goals`（schema v15），由分區直接寫入、不經
`EventProjector`，做法同活動作戰板的 `eventPlans`。列的形狀是
`{ key, kind: 'remodel', order, shipId, targetMst }`：

- `key` 是 `remodel:${shipId}`，一艘艦只有一個改造目標；`shipId` 是艦娘實例 id，同名艦可各自
  設目標。主鍵帶種類前綴，日後新增其他種類的目標不必再開表。
- 順序存在每一列的 `order`。分區每次變更都在同一個 transaction 內把 `remodel:` 前綴的列整批
  換掉，避免逐列寫入中途失敗留下半套順序；寫入失敗時畫面退回原狀並顯示原因。
- 隨完整備份帶走（備份格式 v9，見 [backup.md](backup.md)）。

`utils/remodel-goals.ts` 不 import Dexie，只提供 `goalsFromRows()`／`goalsToRows()` 兩個純轉換。
