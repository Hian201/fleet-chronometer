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
| `mission-list.json` | `api_get_member/mission` 回應本體（2026-11-18 進遠征畫面時取得，未附 req）：`api_list_items` 54 條 `{api_mission_id, api_state}`、`api_limit_time:[1797303600]` | `api_limit_time[0]` 是下次月常換期的 Unix 秒（＝2026-12-15 12:00 JST，與 wikiwiki 每月 15 日正午換期一致，KC3Kai `Kcsapi.js` 同樣取 `[0]`）。主檔 65 條中清單缺 11 條：S1／S2 支援遠征，以及 43、44、A5、A6、B3–B6、D3——正好是 KC3Kai `monthlyUnlockTable` 裡本期前置月常尚未成功的那些（B3–B5 在 8 月跑過，現在仍缺），證實「不在清單＝目前不能派」。`api_state`：已通關的一般遠征為 2；本期還沒跑的月常與 33／34 支援遠征為 1；沒有 0。月常本期成功後變 2，見下一列 |
| `mission-list-a4-done.json` | 同上，同一期跑完月常 A4（103）後再進遠征畫面取得 | 與 `mission-list.json` 只差兩條：103 由 1 變 2（月常本期成功後為 2，直到換期），44 出現且為 1（KC3Kai `monthlyUnlockTable` 中 44 的前置是 103）；`api_limit_time` 相同 |
| `equip_slot.json` | `{req, api}`，`api_req_kaisou/slotset`（艦娘215、全空裝狀態下點第三格裝備 item 131566，`req.api_slot_idx="2"`）；`api` 只有裸 `api_result` | 單看這筆看不出裝備最終落點，需搭配 `slot_to_port.json` 交叉比對 |
| `slot_to_port.json` | 上述動作後緊接著的 `api_port/port` 完整回應（裸 `api_result`/`api_data` 外殼，含全員 427 艘船），本檔案較大（~620KB） | 交叉比對艦娘215：`api_slot=[131566,-1,-1,-1,-1]`——證實裝備落在第一個空槽（index 0），不是 `req.api_slot_idx` 指定的格位；遊戲會把裝備自動塞進目前第一個空槽。`state.ts` 的 `api_req_kaisou/slotset` 分支處理方式：目標格為空時找第一個空槽塞入；目標格已有裝備（換裝/替換）時照 idx 直接寫入 |
| `ranking-page-1.json`、`ranking-page-51.json`、`ranking-page-147.json` | `api_req_ranking/mxltvkpyuklh` 回應本體（DevTools 原始回應，含 `api_result`／`api_data` 外殼；2026-11-22 開發者提供，同時附遊戲畫面截圖）。各為排行榜第 1、51、147 頁，每頁 10 列；`api_count:1000`、`api_page_count:100`。已去識別：提督名 `api_mtjmdcwtvhdr` 與留言 `api_itbrdpdbkynm` 清為空字串（第 147 頁的第 1464 名是開發者本人），其餘欄位為原值 | 證實戰果混淆的解法：名次 `api_mxltvkpyuklh`，混淆值 `api_wuhnhojjxmke` 可被 `[8931,1201,1156,5061,4569,4732,3779,4568,5695,4619,4912,5669,6586][名次 % 13]` 整除，同頁 10 個商的最大公因數為該玩家的係數（三頁皆為 44），戰果＝混淆值 ÷ 名次係數 ÷ 玩家係數 − 91。解碼結果與截圖逐列一致：第 1 頁 10336、9741、9191、8681、7999、7638、7359、7271、6665、6290；第 51 頁 2150、2147、2145、2140、2139、2132、2132、2129、2118、2117；第 147 頁 840、840、839、838、837、835、834、833、833、832。演算法與 poi 外掛 `poi-plugin-senka-calc`（MIT）的 `lib/magic.js` 一致。`api_itslcqtmrxtf`、`api_pbgkfylkbjuy`、`api_pcumlrymlujh` 語意未證實，保留原值 |
| `6-5-mapinfo-before-clear.json`、`6-5-battleresult-before-clear.json`、`6-5-battleresult-clear.json`、`6-5-mapinfo-after-clear.json` | 6-5 擊破前後三筆，DevTools 原始回應（含 `api_result`／`api_data` 外殼；2026-11-23 開發者提供）：擊破前開海域選擇時的 `api_get_member/mapinfo`、擊破前一場 Boss 戰 S 勝的 battleresult（提督經驗值比擊破場低，同海域同主力群）、打倒 Boss 那場的 `api_req_sortie/battleresult`、擊破後再進海域選擇時的 mapinfo。開發者確認回港只送 `api_port/port`，沒有 mapinfo | 證實擊破後的 mapinfo 要等再開海域選擇才送。6-5（`api_id` 65）由 `api_cleared:0`、擊破數 5/6 變為 `api_cleared:1`，擊破數兩欄消失；其餘海域不變。兩筆 battleresult 對照：`api_first_clear` 未擊破為 `0`、擊破為 `1`；`api_get_exmap_rate` 未擊破為數字 `0`、擊破為字串 `"250"`（與 6-5 的 EO 固定戰果相同）；`api_get_exmap_useitem_id` 未擊破為 `0`、擊破為字串 `"57"`。只有 6-5 一對，其他 EO 海域未見，語意未定案 |
| `5-6-1-battleresult-landing.json`、`5-6-mapinfo-after-landing.json` | 5-6 第一段（TP 量表）Boss 戰 S 勝的 `api_req_sortie/battleresult`，以及之後再開海域選擇的 `api_get_member/mapinfo`；DevTools 原始回應（含 `api_result`／`api_data` 外殼；2026-11-23 開發者提供，本月首次登陸） | 通常艦隊的 `api_landing_hp` 為數字 `{api_max_hp: 280, api_now_hp: 280, api_sub_value: 79}`；登陸後 mapinfo 的 5-6（`api_id` 56）為 `api_gauge_type: 3`、`api_defeat_count: 79`、`api_required_defeat_count: 280`、無 `api_eventmap`。280 − 79 與已登陸 79 一致，證實 `api_now_hp` 是戰前剩餘量、一般海域 TP 以擊破數欄位表示已登陸量。同一筆結算的 `api_get_exmap_rate` 與 `api_first_clear` 皆為 `0`（多段 EO 的中間段）。mapinfo 另見已通關仍保留計數的 7-4（`api_cleared: 1`、0/5） |
| `ndock-in-dock.json` | `api_get_member/ndock` 回應本體，DevTools 原始回應（含 `api_result`／`api_data` 外殼；2026-11-26 開發者提供）。4 個渠位，渠 4 入渠中（`api_state: 1`、艦 215）。已去識別：`api_member_id` 換成 `99999999`，其餘欄位為原值 | 證實 `api_data` 是渠位陣列，依 `api_id` 1–4 排序，渠位物件與 `api_port/port` 的 `api_ndock` 同形；`api_complete_time` 是毫秒（1795735034881 與 `api_complete_time_str` 的 2026-11-27 08:17:14 JST 一致）。只有單一快照，不能證明入渠自然結束、提早出渠或 cond 補值的行為 |
| `map-info/62-01_info*.json`、`map-info/62-02_info*.json`（各 5 份：基本檔與 `_info<N>` 追加檔） | 遊戲 `kcs2/resources/map/062/<關>_info<N>.json` 原檔，原樣未改；來源 KagamiChan/kcs2-mapdata（MIT）`maps/062/`。`spots[]` 為路線（`no`＝edge id、`x`／`y`＝終點座標、無 `line` 者為出擊點），追加檔另有 `labels[]`（`{x, y, img}`） | 驗證 `utils/map-resource.ts`：合併後以標籤補出的 62-1（29 條）、62-2（39 條）edge 字母與 `utils/map-edge-letters.ts` 逐筆一致；基本檔不含標籤，補不出任何字母 |

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
