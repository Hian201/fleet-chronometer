# 真實封包樣本

驗證用真實 kcsapi 封包。命名：`<海域>-<類型>.json`。

| 檔案 | 內容 | 用途 |
|------|------|------|
| `6-5-ec_battle.json` | 敵聯合艦隊晝戰（含 api_kouku 航空戰、api_air_base_attack 基地航空隊、api_injection_kouku 噴式強襲） | 驗證 *_combined 索引、航空機損失、rank |
| `6-5-ec_result.json` | 上面那場的結算封包（rank S、drop 鈴谷） | 校準 predictRank |
| `kousyou_1.json` | 裝備開發（單發，失敗） | 驗證 `api_req_kousyou/createitem` 回應結構 |
| `kousyou_2.json` | 裝備開發（連續三發，2成功1失敗）＋`api_unset_items`（裝備庫已滿的同型候補，換裝提示用，未實作） | 同上；確認 `api_get_items` 恆為陣列、`api_material` 為純數字陣列 |
| `remodel_1.json` | `{req, api}` 完整配對，明石改修**成功**（★8→9，同型消耗1筆） | 驗證 `api_req_kousyou/remodel_slot` 回應結構＋**req 欄位名**（`api_slot_id`/`api_certain_flag`） |
| `remodel_2.json` | `{req, api}` 完整配對，**同一顆裝備**（req.api_slot_id 與 remodel_1 相同）緊接著再次挑戰卻**失敗** | 證實失敗時 `api_after_slot` 整個不存在（非「存在但值不變」），`api_use_slot_id` 仍出現（飼料無論成敗都消耗）——`remodel_slot` 已完整驗證，不再擷取 |
| `build_1.json` | `api_get_member/kdock`，4 個渠快照。dock1＝**已用 createship_speedchange 高速完工**（state 3、complete_time 0、created_ship_id 56，投入量仍是正常的 30/30/30/30/1）；dock2＝大型艦建造中（ship86，同 build_2 的 dock2） | 證實渠的 `api_item1-5` 只反映最初送出建造時的投入量，不受後續是否高速完工影響；驅動 `state.ts` 把新建造偵測從「只認 state 2」放寬成「state 2 或 3 皆可」，避免 SW 重啟後錯過 state 2 瞬間就漏記建造 |
| `build_2.json` | 同上端點，dock1＝ship11（正常建造中，40/40/40/40/1），dock2＝ship86（與 build_1 相同） | 證實 `api_get_member/kdock` 每個渠自帶 `api_item1~5`——**不需要**猜 `api_req_kousyou/createship` 的 `req`（`api_large_flag`／`api_highspeed` 兩個猜測欄位已證實不存在於這個資料源，程式已改用 kdock 快照比對偵測新建造單，見 `state.ts` BuildStartView 註解） |
| `hensei-combined.json` | `api_req_hensei/combined`（母港切連合艦隊）**只有回應本體**（沒存到 req），`api_data.api_combined:1` | 這份樣本當初讓我誤判「型別值在回應」——單一案例、沒跨型別比對就下結論。已被下面兩筆 `{req,api}` 完整配對推翻，留著當反面教材：**enum 型欄位只驗證一個值不能算驗證過，至少要覆蓋兩個不同值** |
| `hensei-combined-task.json` | `{req, api}`，選「空母機動部隊」：`req.api_combined_type="1"`、`api.api_combined:1` | 跟 transport 那筆（下面）交叉比對後證實：**型別值在 `req.api_combined_type`**（1=機動），回應的 `api_combined` 兩筆都是 1，是「連合已啟用」的通用成功旗標、不是型別值 |
| `hensei-combined-transport.json` | `{req, api}`，選「運輸護衛部隊」：`req.api_combined_type="3"`、`api.api_combined:1` | 同上；`req` 值 1↔3 隨型別變動、`api` 恆為 1，兩相對照才真正定案（2=水上打撃部隊用刪去法推得，僅 3 種型別、1/3 已直接驗證，未直接驗證過 2） |
| `equip_slot.json` | `{req, api}`，`api_req_kaisou/slotset`（艦娘215、全空裝狀態下點第三格裝備 item 131566，`req.api_slot_idx="2"`）；`api` 只有裸 `api_result` | 單看這筆看不出裝備最終落點，需搭配 `slot_to_port.json` 交叉比對 |
| `slot_to_port.json` | 上述動作後緊接著的 `api_port/port` 完整回應（裸 `api_result`/`api_data` 外殼，含全員 427 艘船），本檔案較大（~620KB） | 交叉比對艦娘215：`api_slot=[131566,-1,-1,-1,-1]`——證實裝備落在 **index 0**、不是 req 送的 `idx=2`。推翻「req.api_slot_idx 就是最終格位」的假設，證實遊戲會把裝備自動塞進「目前第一個空槽」；`state.ts` 的 `api_req_kaisou/slotset` 分支已改成：目標格本身是空的才找第一個空槽塞入，目標格已有裝備（換裝/替換）則維持照 idx 直接寫入 |

`remodel_*.json` 是用面板修正後的「複製 JSON」擷取，格式為 `{req, api}`（`req` 已含
`api_slot_id`/`api_certain_flag` 等表單欄位，`api` 為 kcsapi 回應本身）。`build_*.json`
則是用 DevTools Network 面板直接存的原始回應（含 `api_result`/`api_data` 外殼，未經
bridge 剝殼），與其他樣本格式不同，讀取時需自行取 `.api_data`。`kousyou_*.json` 是
面板修正**前**擷取的，只有裸 `api`（無 `req` 外殼）。三種格式並存，讀樣本前先看內容
判斷屬於哪一種。

**工廠子系統（開發/建造/改修）目前已全數驗證完畢**，`state.ts` 不再有已知的欄位佈局
猜測（僅 `createship_speedchange` 高速建造材本身的實際資材扣除量仍未驗證，非核心
功能——該端點回應不帶資料，需要材料前後對照樣本；渠狀態切換本身已由 build_1.json
間接驗證無誤）。
