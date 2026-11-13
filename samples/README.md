# 真實封包樣本

驗證用真實 kcsapi 封包。命名：`<海域>-<類型>.json`。

| 檔案 | 內容 | 用途 |
|------|------|------|
| `6-5-ec_battle.json` | 敵聯合艦隊晝戰（含 api_kouku 航空戰、api_air_base_attack 基地航空隊、api_injection_kouku 噴式強襲） | 驗證 *_combined 索引、航空機損失、rank |
| `6-5-ec_result.json` | 上面那場的結算封包（rank S、drop 鈴谷） | 校準 predictRank |
| `kousyou_1.json` | 裝備開發（單發，失敗） | 驗證 `api_req_kousyou/createitem` 回應結構 |
| `kousyou_2.json` | 裝備開發（連續三發，2成功1失敗）＋`api_unset_items`（裝備庫已滿的同型候補，換裝提示用，未實作） | 同上；確認 `api_get_items` 恆為陣列、`api_material` 為純數字陣列 |
| `remodel_1.json` | `{req, api}` 完整配對，明石改修**成功**（★8→9，同型消耗1筆） | 驗證 `api_req_kousyou/remodel_slot` 回應結構＋**req 欄位名**（`api_slot_id`/`api_certain_flag`） |
| `remodel_2.json` | `{req, api}` 完整配對，**同一顆裝備**（req.api_slot_id 與 remodel_1 相同）緊接著再次挑戰卻**失敗** | 證實失敗時 `api_after_slot` 整個不存在（非「存在但值不變」），`api_use_slot_id` 仍出現（飼料無論成敗都消耗）——`remodel_slot` 已完整驗證，無需再擷取 |
| `build_1.json` | `api_get_member/kdock`，4 個渠快照。dock1＝**已用 createship_speedchange 高速完工**（state 3、complete_time 0、created_ship_id 56，投入量仍是正常的 30/30/30/30/1）；dock2＝大型艦建造中（ship86，同 build_2 的 dock2） | 證實渠的 `api_item1-5` 只反映最初送出建造時的投入量，不受後續是否高速完工影響；`state.ts` 的新建造偵測接受 state 2 或 3，因為 SW 重啟可能錯過 state 2 的瞬間，若只認 state 2 會漏記建造 |
| `build_2.json` | 同上端點，dock1＝ship11（正常建造中，40/40/40/40/1），dock2＝ship86（與 build_1 相同） | 證實 `api_get_member/kdock` 每個渠自帶 `api_item1~5`——**不需要**猜 `api_req_kousyou/createship` 的 `req`（`api_large_flag`／`api_highspeed` 兩個欄位在此資料源中不存在）；新建造單以 kdock 快照比對偵測，見 `state.ts` BuildStartView 註解 |
| `hensei-combined.json` | `api_req_hensei/combined`（母港切連合艦隊）**只有回應本體**（沒存到 req），`api_data.api_combined:1` | 沒有 req 無法判定型別值，回應中的 `api_combined:1` 不是型別值（見下兩筆 `{req,api}` 配對）。規則：enum 型欄位至少要覆蓋兩個不同值才算驗證 |
| `hensei-combined-task.json` | `{req, api}`，選「空母機動部隊」：`req.api_combined_type="1"`、`api.api_combined:1` | 與 transport 那筆交叉比對：**型別值在 `req.api_combined_type`**（1=機動），回應的 `api_combined` 兩筆都是 1，是「連合已啟用」的通用成功旗標、不是型別值 |
| `hensei-combined-transport.json` | `{req, api}`，選「運輸護衛部隊」：`req.api_combined_type="3"`、`api.api_combined:1` | 同上；`req` 值 1↔3 隨型別變動、`api` 恆為 1，兩相對照才真正定案（2=水上打撃部隊用刪去法推得，僅 3 種型別、1/3 已直接驗證，未直接驗證過 2） |
| `practice-battle-result.json` | `api_req_practice/battle_result` 回應本體（使用者提供，未附 req；`api_enemy_info` 的提督名為空字串）。`api_win_rank:"A"`、`api_ship_id` 為 6 個艦娘 master id（576 Nelson改／668 矢矧改二乙／553 伊勢改二／920 Samuel B.Roberts Mk.II／506 最上改二特／204 深雪改）、`api_get_ship_exp` 帶 leading -1 共 7 格 | 證實演習結算端點與 `api_win_rank` 欄位存在，沒有任何海域欄位。`api_ship_id` 是對手艦隊（見下方 `-s`／`-c` 兩筆的交叉比對）；`api_win_rank` 與出擊 `battleresult` 共用同一套評價字串 |
| `practice-list-after-battles.json` | `api_get_member/practice` 回應本體，同一輪對手清單打完兩場後重新進入演習畫面時取得。已去識別：`api_enemy_id` 換成 1–5，提督名、留言及其 id 清為空字串，其餘欄位為原值。`api_state` 依序為 0／3／0／0／6 | 證實 `api_state`：0＝本輪未交戰；對手 2（旗艦 538）＝3、對 `-c` 的評價 C；對手 5（旗艦 911）＝6、對 `-s` 的評價 S。與 KC3Kai `natsuiro.js` `PvPList` 的 `["","E","D","C","B","A","S"][api_state]` 一致。開發者同時確認本輪還剩三場 |
| `practice-battle-result-s.json` | `api_req_practice/battle_result` 回應本體，對上面清單的對手 5（單艦，旗艦 911）。`api_win_rank:"S"`，`api_ship_id:[911]` | 對手只有一艘、`api_ship_id` 也只有一格且等於對手旗艦，證實 `api_ship_id` 是對手艦隊 |
| `practice-midnight-battle.json` | `api_req_practice/midnight_battle` 回應本體（同一輪第三場，對清單的對手 1、旗艦 369；未附對應晝戰）。夜戰欄位與出擊夜戰同形：`api_hougeki` 含 `api_n_mother_list`、`api_sp_list`，`api_si_list` 為字串；`api_f_nowhps`／`api_e_nowhps` 是晝戰結束後的值 | 證實演習夜戰端點名稱與封包形狀；`tests/taiha-escape.test.ts`「演習夜戰接續」用它驗證夜戰傷害寫入戰況 |
| `practice-battle-result-c.json` | 同上端點，對上面清單的對手 2（6 艘，旗艦 538）。`api_win_rank:"C"`，`api_ship_id` 首格 538 | 與 `-s` 交叉比對：`api_ship_id[0]` 等於清單中該對手的 `api_enemy_flag_ship` |
| `equip_slot.json` | `{req, api}`，`api_req_kaisou/slotset`（艦娘215、全空裝狀態下點第三格裝備 item 131566，`req.api_slot_idx="2"`）；`api` 只有裸 `api_result` | 單看這筆看不出裝備最終落點，需搭配 `slot_to_port.json` 交叉比對 |
| `slot_to_port.json` | 上述動作後緊接著的 `api_port/port` 完整回應（裸 `api_result`/`api_data` 外殼，含全員 427 艘船），本檔案較大（~620KB） | 交叉比對艦娘215：`api_slot=[131566,-1,-1,-1,-1]`——證實裝備落在第一個空槽（index 0），不是 `req.api_slot_idx` 指定的格位；遊戲會把裝備自動塞進目前第一個空槽。`state.ts` 的 `api_req_kaisou/slotset` 分支處理方式：目標格為空時找第一個空槽塞入；目標格已有裝備（換裝/替換）時照 idx 直接寫入 |

`remodel_*.json` 是面板「複製 JSON」擷取的結果，格式為 `{req, api}`（`req` 已含
`api_slot_id`/`api_certain_flag` 等表單欄位，`api` 為 kcsapi 回應本身）。`build_*.json`
則是用 DevTools Network 面板直接存的原始回應（含 `api_result`/`api_data` 外殼，未經
bridge 剝殼），與其他樣本格式不同，讀取時需自行取 `.api_data`。`kousyou_*.json`
只有裸 `api`（無 `req` 外殼）。三種格式並存，讀樣本前先看內容
判斷屬於哪一種。

**工廠子系統（開發/建造/改修）目前已全數驗證完畢**，`state.ts` 不再有已知的欄位佈局
猜測（僅 `createship_speedchange` 高速建造材本身的實際資材扣除量仍未驗證，非核心
功能——該端點回應不帶資料，需要材料前後對照樣本；渠狀態切換本身已由 build_1.json
間接驗證無誤）。
