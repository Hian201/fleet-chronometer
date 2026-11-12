# 出擊、打撈與建造紀錄

## 出擊重播（KC3Kai battleplayer 相容，`utils/replay.ts`＋`db.replays`）

面板 consume 期間把「出擊時艦隊快照＋各節點原始戰鬥封包」累積成 `ReplayRow`（主鍵
sortieKey，put 冪等、重播回填），`toKc3Replay()` 輸出 KC3Kai kancolle-replay
[battleplayer](https://kc3kai.github.io/kancolle-replay/battleplayer.html) 可貼上／可另存圖片的物件。
**格式來源已交叉確認**（player.js 解析端＋poi→kc3 轉換器，2026-07）：頂層
`{ fleet1, fleet2, fleetnum, combined, battles:[{node,data,yasen}], world, mapnum, diff, time }`；
**每個 `battles[i].data` 就是一則原封不動的原始 kcsapi 戰鬥封包**（與
`samples/61-5-jibun-rengou-node52.json` 同格式——該樣本本身即 KC3Kai logger 匯出）。
ship 欄位用 KC3Kai 命名（`mst_id`/`lv`/`equip`/`stars`/`ace`/`exequip`/`nowhps`/`maxhps`），
stats 由 battleplayer 依 mst_id+lv+equip 自算，故不帶。已用真實封包執行期驗證：
raw packet 原封保存、node/rank 歸位、fleet ship shape 正確。
擷取判別：夜戰＝path 含 `midnight` 但排除 `sp_midnight`（開幕夜戰當該節點主資料）；
`battleresult`＝補 rank 到最後節點；其餘帶 `api_f_nowhps` 者為晝戰/航空戰。
若保留的事件流沒有該次出擊的 `api_req_map/start`，就無從建立出擊時艦隊快照；該場只能保留
可建立的摘要，不能補猜編成或重播內容。面板何時開啟本身不是判定條件。
直接播放走 battleplayer 原生 `#fromLZString=`（官方 1.4.4 URI 安全壓縮），因為連合艦隊
重播的 raw JSON fragment 經常超過 30,000 字元上限、只開得到空白播放器；不經 kcrdb／
tinyurl 上傳。出擊紀錄「下載出擊記錄」把複製 JSON、下載 JSON、下載 PNG 重播圖與直接播放收在同一選單；PNG 可見層是本專案卡片，JSON 寫在 alpha。契約鎖在 `tests/replay-kc3-compat.test.ts`（含 61-5 甲水上打擊樣本）。

## 出擊紀錄的展開檢視（`utils/sortie-detail.ts`＋`sections/sortie-log.ts`＋`utils/deckbuilder.ts`＋`utils/sortie-simulator.ts`）

**現行呈現**：一次出擊一張卡，摺疊列兩行（行1＝#第幾次・關卡代號・出擊編成成員；
行2＝節點軌跡＋結果標記），展開才給細節。將出擊作為單位可同時辨識隊伍、路線與結果，
避免把同一場出擊拆成難以追溯的節點流水帳。

**資訊密度對照 KC3Kai 的出擊紀錄展開檢視**（參照圖 `samples/KC3kai_sortie_log.png`，
使用者指定的標竿）：四支艦隊各一欄（主力／護衛／道中支援／決戰支援）＋基地航空隊三隊
編成＋逐節點作戰資訊（敵編成與殘血、rank、索敵、航向、觸接、航空戰、雙方機數增減、
陣形、MVP、提督經驗值、掉落有無）。**與 KC3Kai 的兩處差異**：節點字母改走對照表（見 [maps.md](maps.md)「節點字母」）；
**「基礎經驗值」不在遊戲封包裡**，故本機擷取的紀錄一律沒有——只有從 KC3Kai 匯出匯入的紀錄
會帶（它自己算的 `baseEXP`），UI 因此是「有值才顯示」並標明來源。

**為此擴充了擷取層（皆為 optional 欄位、非索引，故 schema 不需升版；舊資料一律當
「不可考」，不回填猜測值）**：

| 新欄位 | 來源（皆已用真封包驗證） | 為什麼非存不可 |
|---|---|---|
| `SortieLogRow.getExp` | battleresult `api_get_exp` | 提督經驗值，KC3Kai 那張圖的主要數字之一 |
| `SortieLogRow.mvp`／`mvpEscort` | `api_mvp`／`api_mvp_combined`（**1-based**） | 遊戲回傳的**確定值**（非 `analyzeBattle` 的預測）。已用 `samples/6-5-ec_battle.json`＋`6-5-ec_result.json` 同一場交叉驗證：預測值 4 與 `api_mvp` 4 一致，且傷害最高者為 0-based index 3 ⇒ 確認 1-based |
| `SortieLogRow.enemyName` | `api_enemy_info.api_deck_name` | 敵艦隊名（「任務部隊 主力群」） |
| `SortieLogRow.baseExp` | **不在遊戲封包裡**——只有從 KC3Kai 匯出匯入時才有（`baseEXP`） | 基礎經驗值。本機擷取的紀錄永遠沒有這欄，UI 有值才顯示 |
| `SortieLogRow.nodeEventId`／`nodeEventKind` | `api_req_map/start\|next` 的 `api_event_id`／`api_event_kind` | 節點類型（見 [maps.md](maps.md)）。**存原始值不存推導出的標籤**——語意對照日後修正時，舊紀錄會跟著變正確 |
| `ReplayRow.fleet3`／`fleet4` | `api_req_map/start` 當下的第3/4艦隊快照 | 支援艦隊編組。**戰鬥封包的 `api_support_info.api_ship_id` 是艦實例 id、沒有等級與裝備**，要像 KC3Kai 那樣把支援畫成艦隊只能事前快照 |
| `ReplayRow.lbas` | 出擊當下同海域的全部基地航空隊 | `api_air_base_attack` 只會出現「有出擊的那幾波」，答不了「這次三個基地各自的編成與行動」（含防空隊） |

**道中支援／決戰支援的分法**：以「該支援有沒有在 boss 節點出動」判定，不看 deck 編號——
玩家可以把任一隊當道中或決戰。61-3 真封包實測正好兩支（第3艦隊在 25／51、第4艦隊在 53），
這也是「必須分兩欄」的依據。

**出擊模擬器跳轉走 `#backup=`**：simulator.html 的 `{ fleetF, nodes }` hash 會呼叫
`initSimImport`、藏起編成介面並立刻開跑；`{ fleet1, battles }` 與 `#backup=` 才會停在
可編輯畫面。後者是模擬器自己的設定備份契約（CONVERT.loadSave），能帶補強增設與純潛艦
節點的 `subOnly`，並用 LZMA 壓進 fragment 上限。艦船 `unknownstats` 警示來自上游資料表
標記，不能靠填猜測素質消除。契約鎖在 `tests/sortie-simulator.test.ts`。

**制空権シミュレータ跳轉走 `#import:{predeck}`**：`?predeck=` 會整段送給 GitHub Pages，
出擊資料超過 request URI 上限就 414；hash 不上伺服器。noro6/kc-web 的
`Convert.loadDeckBuilder()` 除
f1～f4／a1～a3 外，另讀 `s`（`a`＝world、`i`＝mapnum、`c[]`＝各格 `c`／`pf`／`ef`／
`f1`／`f2`）與陸航 `sp`（派遣格，對 `c[].c`）。出擊紀錄因此另組
`buildReplayAirCalcDeck()`，不把這兩欄寫進複製用的標準 DeckBuilder JSON。`f1.t` 帶
`api_combined_flag`，否則 kc-web 把 f1／f2 當兩支單艦隊；支援艦隊不進 f3／f4，以免被
算進我方制空。`c`／`sp` 用出擊 edge id；對得上 kc-web MasterCell 才補節點名並讓陸航對到
該格，對不上時敵艦隊仍匯入。契約鎖在 `tests/air-calc-deck.test.ts`。

**摺疊列（banner）只放「哪一隊、誰帶隊」**：
`#第幾次・關卡代號・**旗艦**・艦隊編制・時間・展開箭頭`＋第二行的節點軌跡與結果標記。
12 艘全名單會把 banner 撐成三行、還把時間與箭頭擠掉；完整名單在展開後逐艘呈現。
編制標籤：連合三種（空母機動／水上打撃／輸送護衛，`api_combined_flag`）＋**遊撃部隊**
（`combined===0` 但主隊 7 艘——只有遊撃部隊艦隊司令部做得到，是封包事實不是猜測）＋單艦隊。

**節點藥丸：節點標籤是主角**。節點字母是 11px 的 `--dim`、rank 是同級距的粗體彩色，
兩個字擠在一起分不清哪個是節點哪個是戰果。現在節點 14px 粗體主要文字色、rank 以一條分隔線
推開並降一級字級；boss 藥丸另加語意色淡底。

**基地空襲節點掛空襲警報圖示**（`public/icons/ui/airraid.svg`）：
節點軌跡的藥丸與節點卡各一顆。**遊戲沒有這個圖示**——它是本專案繪製的回轉警示燈意象，
同樣由 `tools/icons/gen_ui.py` 產生、`normalize.py` 注入描邊，不手改 SVG。

**展開內容一律可折疊**：一次出擊的資訊量太大，全部攤開
反而找不到東西，故分四段、各有自己的開合：

- **出擊編成**：常駐（要看「帶了誰」），但**每艘的裝備預設折疊**——六艘×五格圖示會變成一面
  圖示牆。點艦卡展開單艘，或用區塊標題的「全部裝備」批次開合。艦卡收合時仍顯示 Lv／cond／
  血條／裝備數。
- **支援艦隊／基地航空隊**：整段預設折疊，但**收合時的摘要必須看得出內容**
  （「道中支援 第4艦隊・決戰支援 第3艦隊」「第1基地 出擊・第2基地 出擊・第3基地 防空」）
  ——藏起來讓人找等於沒做（同活動作戰板標籤成員的教訓）。
- **逐節點**：一節點一列、**由上而下＝路線先後順序**（網格排法左→右換行，會讓順序變成
  用猜的），預設收合，可單獨點開或用「全部節點」批次開。收合列放的是要橫向掃描比較的東西
  （節點・rank・boss／夜戰・制空・支援／基地・大破・掉落），細節留給展開。

折疊一律用原生 `<details>`：開合狀態由瀏覽器自己管，分區不必為此多一份 state；方向指示用
`▸`／`▾` 字元而非 `transform: rotate`（rotate 在 `prefers-reduced-motion` 下要關掉，關掉後
兩態長得一樣，狀態訊號就消失了——design-guidelines §4.3）。

**連合艦隊要顯示編成類型**：`api_combined_flag` 1＝空母機動部隊／2＝水上打撃部隊／
3＝輸送護衛部隊（2 已用 `samples/61-5-jibun-rengou-node52.json` 確認）。三者的隨伴艦隊角色
完全不同，只寫「連合艦隊」等於沒說。

**單場 JSON 匯入**：分區工具列的「匯入 JSON」只接受兩種
已確認來源：(a) 本專案 `toKc3Replay()` 產生、帶 `version:4` 的固定格式；(b) KC3Kai logger／
kancolle-replay 現有 fixture 證實的格式（`nodes`＋`eventmap`＋logger battle wrapper）。
`parseSortieImport()` 先辨識格式再逐欄驗證；其他通用 JSON、部分相似物件與未知工具格式一律拒絕。

- **重複判定**：海域＋**戰鬥節點序列**必須完全相同，
  且一律受 **±10 分鐘**邊界限制。兩邊都有重播時，比對 `data`＋實際存在的 `yasen` 完整原始
  封包（物件 key 排序後 FNV-1a）；不混入只存在 KC3Kai wrapper 的 rating/drop/MVP/EXP。
  任一邊沒有封包（既有紀錄的重播已裁剪）才在同一時間窗內只靠時間 fallback。故相同封包跨日
  不會誤判，同時間窗內相同路線但實際戰鬥內容不同也不會誤判。判定在 transaction 內做，命中
  即整個 rollback，不留半筆。
  **「已存在」是預期結果不是錯誤**，UI 用獨立的顏色與訊息，與「格式錯誤」分流。
- **event ID 向 generator 借**（`events.add`→`delete`，同 backup 的 reservation 手法）：
  這樣匯入的 derived rows 永遠不會被未來擷取的 raw event 撞號覆蓋。**但不寫任何 raw event**
  ——匯入的是別處的紀錄，不是本機觀測到的封包（provider 合約）。副作用：匯入過的安裝之後
  就不是「乾淨環境」，備份還原會被拒（與擷取過任何封包同一條規則，見 [backup.md](backup.md)）。
- **KC3Kai 對「沒有夜戰的節點」寫 `"yasen": {}`**（空物件仍是 truthy）：直接 `if (entry.yasen)`
  會讓每個節點都被標成夜戰接續，還會把空物件餵進 `analyzeBattle`。判準改為「至少有一個
  `api_` 開頭的欄位」（`hasPacket()`），`data` 也走同一關。這是靠離線預覽看出來的（見下）。
- **KC3Kai logger 的匯出帶完整結算資訊，但鍵名跟 kcsapi 不一樣**：**檢查欄位缺席前先把整個
  物件的鍵列出來**，避免把不同命名誤判為資料缺席：

  | KC3Kai 鍵 | 意義 | 存進 |
  |---|---|---|
  | `rating` | rank。**會吐 `SS`（完全勝利），遊戲的 `api_win_rank` 只吐 `S`** | `rank`（SS 正規化成 S，與本機擷取同形狀） |
  | `drop` | 掉落艦的 **master id**（0＝沒掉） | `dropMst`＋`drop`（艦名由呼叫端的 `shipName` 解析器補） |
  | `mvp` | `[主隊, 隨伴]` 位置（1-based） | `mvp`／`mvpEscort`（**隨伴只在連合艦隊採用**——單艦隊時它仍會填 1） |
  | `hqEXP` | 提督經驗值（同 `api_get_exp`） | `getExp` |
  | `baseEXP` | 基礎經驗值。**遊戲封包沒有這欄**，只有匯入的紀錄才有 | `baseExp`（UI 有值才顯示，並標明來源） |
  | `boss` | boss 節點旗標 | 與 `nodes[].eventColorNo===5` 互相補強 |

- **本專案自己的 `toKc3Replay()` 匯出不含結算**（那是重播格式，只有戰鬥封包），故走那條路徑
  匯入時 rank 仍為空、節點卡顯示 `analyzeBattle` 依損害率推算的**推定值**（虛線框＋title 標明），
  掉落顯示為不可考、**不顯示「無掉落」**——那是「不知道」不是「沒掉」。
- KC3Kai 的第 3／4 艦隊快照沒有 HP；本專案 `toKc3Replay()` 也沒有 cond。匯入時保留「來源
  未提供」而不是補 0：支援艦隊 HP 在 UI 顯示不可考，主力／護衛 HP 則必須由自身欄位或第一個
  戰鬥封包取得並通過 `0 <= nowhp <= maxhp`、`maxhp > 0` 驗證。
- 匯入的紀錄一律標「匯入」徽章，並自動 `pinned`（否則時間戳很舊的匯入紀錄下一次重播裁剪
  就被掃掉）。
- **清單排序與「第幾次」計數改依時間**（`sortieTime()`）：匯入紀錄拿的是當下最大的 event ID，
  照 ID 排會讓一場三年前的出擊變成「最新一次」。

**版面驗證用離線預覽**（`tools/preview/sortie-log.ts`，開發用、不進 bundle）：
`npx vite-node --config vitest.config.ts tools/preview/sortie-log.ts` 會把 `samples/` 的
KC3Kai logger 匯出轉成本專案的 ReplayRow／SortieLogRow、套 overview 的同一份 CSS，產出
`.preview/sortie-log.html`（深色）與 `-light.html`（亮色），可直接開瀏覽器或用 headless
Chrome 截圖檢視。**完全離線、不連遊戲、不需登入**（帳號安全紅線）。真實資料才看得出
版面問題——手捏假資料看不出 12 艘編成、4 波基地航空隊、12 隻敵艦時會怎麼爆版。

- **「第幾次」是該海域的第幾次出擊**（依時間升冪計數），**不隨篩選變動**——序號是歷史事實，
  篩選只是視窗。故 `numberSorties()` 必須餵全部紀錄，不是篩選後的子集。活動作戰時
  「E3 第 7 次」比時間戳更接近玩家腦中的計數方式。
- **通常／活動兩大分類做成分段控制**（不是下拉）：這是本分區最常切的維度，有幾個選項、
  現在在哪一邊，不展開就該看得到。活動判定＝`world >= 10`，**不列舉活動編號**（每次活動
  都換號，列舉必然過期）。海域下拉只列**該分類裡實際有紀錄的**海域（同裝備全覽的圖示架，
  選項隨資料收斂）。活動再拆「哪一次活動」與「該活動第幾關」：歷次活動各自一組
  En，關卡數跟紀錄走、不寫死五關；切到活動分類預設最新一次。活動主標走
  `event-calendar.ts` 的年份＋季節（「2026夏季」）；遊戲不送這層資訊，表外不從出擊
  時間戳反推。跨年時活動下拉依年份分組、組內只寫季節。卡片在單次活動內顯示
  `E{n}`＋難度徽章，跨活動並列才帶「2025秋季 E3」；官方作戰名與編號（`62-3`）在 title。
- **展開時才解析封包**（含 `analyzeBattle` 戰鬥重放），結果快取；摺疊列只用 `db.sorties`
  摘要＋快照——否則一進分區就要把整個重播層跑一遍。
- **先畫殼、再讀資料**：`render()` 第一件事是 `el.innerHTML = shellHtml()`
  並綁好工具列／匯入面板的事件，**之後**才 await `db.sorties`／`db.replays`。資料讀取慢、丟例外或
  **卡住**（Dexie 版本升級被其他分頁／面板擋住時 `open()` 會無限等待）時，
  整個分區就是一片空白——連「匯入 JSON」都按不到，使用者只看到「介面不見了」而毫無線索。
  現在殼一定先出現，載入中顯示「載入中…」，失敗只影響清單並印出原因（含「關掉其他分頁再
  重新整理」的提示）。`overview/main.ts` 也把 `sec.render()` 包在 try/catch 裡——**任何分區的
  例外都不得靜默留白**。
- **戰鬥細節不另寫一套解析**：直接餵 `utils/battle.ts` 的 `analyzeBattle()`（面板即時監控
用的同一支），故展開看到的與面板顯示的一致，日後解析修正兩邊同時受惠。damecon 由
  快照的裝備 master id 還原（42 要員／43 女神，同 `state.ts getDamecon`），不是猜的。

**兩邊資料的分工要在 UI 上誠實呈現**：節點序列與勝負來自 `db.sorties`（永久保留）；
敵艦等級／制空詳情／基地航空隊組成／支援艦隊編組**只存在於 `db.replays` 的原始封包**，
故沒有重播的舊出擊只顯示摘要那半邊，並明講原因（當時面板未開啟或重播已裁剪），
不假裝那些資訊不存在。

**已用真封包驗證的欄位**（`samples/61-3.json`、`samples/61-5-jibun-rengou-node52.json`，
測試在 `tests/sortie-detail.test.ts`）：

- `api_air_base_attack` 是**陣列**，一波一個元素：`api_base_id`（第幾基地）、
  `api_squadron_plane[]`（`api_mst_id`／`api_count`）、`api_stage1.api_disp_seiku`（該波制空）。
  61-3 boss 節點實測 4 波（基地1×2＋基地2×2），各波制空與損失皆不同，故 UI **一波一行**。
  ⚠️ 基地「防空」的 `api_destruction_battle.api_air_base_attack` 是**物件不是陣列**，
  兩者同名不同形；`lbasWaves()` 只認陣列，空襲節點走 `db.sorties` 的 raid 摘要。
- `api_support_info` 的 `api_support_airatack`（航空／對潛系）與 `api_support_hourai`
  （砲擊系）擇一非 null，兩者都帶 `api_deck_id` 與 `api_ship_id[]`。
  **`api_ship_id` 是艦實例 id 不是 master id**——UI 靠目前的 `GameState.ships` 反查艦名，
  查不到就顯示 `#id`（不猜）。已用 poi/lib-battle 對照與 61-5 真封包確認
  `api_support_flag` 的 1／2／3／4 分別對應航空／砲擊／雷擊／對潛；未知值才依存在的
  支援結構回退，並保留原始 flag 供除錯。
- `api_selected_rank`：1丁 2丙 3乙 4甲（三份甲難度樣本皆為 4）。

**節點標籤走 `utils/map-node-letters.ts` 的查表**：有對照顯示字母、沒有顯示原始 edge 編號，
絕不推算（兩種推算法皆已被真實資料否證，見 [maps.md](maps.md)「節點字母」）。

## 出擊帳單估算（`utils/sortie-bill.ts`＋`utils/sortie-bill-attribution.ts`＋`db.sortieBills`）

**記帳方式是發生制**：帳單記的是「這一趟留下多少待付的帳」，不是玩家哪天補給、入渠付了多少。
`EventProjector` 在 `api_req_map/start` 套用後擷取參與艦（出擊艦隊；聯合艦隊由第一艦隊出擊時加第二
艦隊）的燃彈、搭載數與 `api_ndock_item`，出擊後第一筆 `api_port/port` 套用後以同一批艦的差結算，寫入
`db.sortieBills`（主鍵 `sortieKey`）。回港不補給、不修、換別的船出擊，或帶傷、未補滿再出擊，都只影響
各趟自己的出擊前狀態，不會重複或漏記；之後的補給、入渠封包不讀。代價：帳最後沒付的情況會多算——
泊地修理修好的傷、修理前就解體或當素材的艦。介面因此標題寫「估算」。

- **要付的帳**＝補給燃彈＋艦載機每架 5 鋁土＋修理燃料、鋼材。結婚艦的補給折扣對總缺額取整，各趟各自
  取整只是近似，標推算。
- **途中進出**＝出擊開始與回港兩筆餘額之差，是「途中取得 − 基地航空隊出擊消耗 − 噴射機鋼材」的合計，
  不再拆。出擊開始的餘額只在上一筆母港封包之後沒有 state 未追蹤的資材進出時才可信（白名單
  `keepsMaterialsTracked()`；任務領獎、解體、廢棄、入渠開始、改造、遠征結果、`set_plane` 等都會讓它變
  不可考）。不可考時淨成本只含要付的帳。
- **淨成本**＝要付的帳 − 途中進出。海域彙總（`summarizeBills()`）以它平均，活動海域依出擊當下的難度
  （`difficulty`）分開。
- **支援艦隊**：出擊開始時正在跑同海域支援遠征（`api_disp_no` 33／34／S1／S2）的艦隊，依消耗規則另算
  一份存在 `support`：燃料 50%、彈藥在正規空母／輕空母／水上機母艦合計 3 艘以上時 40%，否則 80%，
  小數進位；擊落數取戰鬥封包 `api_support_airatack` 的 stage1／stage2 `api_f_lostcount`。噴射機鋼材未計。
- **回港後才付、讀取時歸屬**：`db.materialUse` 的 bucket（帶 `shipId`）歸給之前最近一趟
  `damagedShipIds` 含該艦的出擊；`airSupply`（基地航空隊補充，補充前餘額不可信時花費為 null）歸給之前
  同海域最近一趟。兩者與支援艦隊都另列，不併入淨成本。
- 用桶時 state 把該艦 `api_ndock_item` 清為 `[0, 0]`，否則用桶後不經母港直接出擊會少算修理費。
- 卡片展開後帳單區塊預設折疊，摘要列淨成本；DB v17、備份 v11 起才有，不回填。

## 不記錄的海域（`utils/sortie-exclude.ts`＋`sections/sortie-log.ts`＋`utils/event-projector.ts`）

使用者在出擊紀錄分區指定通常海域（world 1–9），之後在這些海域的出擊不寫 `db.sorties`／
`db.replays`；打撈紀錄由 `db.sorties` 衍生，因此一併不收錄。

- **只擋 derived 寫入**：`EventProjector` 的 `skipSortieMap` 在 `api_req_map/start` 的 reducer
  套用後判定一次（`skipCurrentSortie`），整場沿用，出擊途中改設定不會只記半場。
  `GameState.applyEvent()` 照常執行，任務計數、戰況顯示與 raw events 都不受影響；既有紀錄不刪、
  不藏。
- **斬殺標記**：被排除的海域不執行 `markLatestBossCleared()`，否則斬殺會標到該圖較舊的紀錄上。
- **活動海域不可指定**：活動的 Boss HP 斬殺線與斬殺旗標要從 sorties／replays 回推。
- **設定與時機**：名單存 localStorage（`kc-sortie-exclude-maps`，panel 與 overview 同源共享），
  面板以 `storage` 事件同步；讀寫失敗一律退回「不排除」，寧可多記也不漏記。判定發生在面板投影
  時：面板沒開時累積的事件，於下次開面板補投影時依當下名單判定。名單隨完整備份走
  （`sortieExclude`，見 [backup.md](backup.md)）。
- **候選清單**：start2 `api_mst_mapinfo` 的通常海域，加上紀錄裡出現過、master 已沒有的關；不寫死
  關卡表。選單的大區名、關名與作戰名查 `utils/map-names.ts`（規範見
  `docs/translation-guidelines.md`「海域與關卡名稱」）；master 名稱與表中日文不一致（遊戲改名）時
  省略譯名。
- 測試：`tests/sortie-exclude.test.ts`、`tests/event-projector.test.ts`（不記錄的海域兩則）、
  `tests/backup-sortie-exclude.test.ts`。

## 打撈紀錄／建造紀錄的 CSV 匯出入（`utils/csv.ts`＋`drop-log-import.ts`＋`build-log-import.ts`）

**CSV 契約**：打撈紀錄（`db.sorties` 中有掉落的列）與建造紀錄（`db.factory` 的 `build`／
`speedup`）提供 CSV 匯出入，以便搬移與備份還原前保留資料；格式相容「航海日誌拡張版」
（Nishisonic/logbook，MIT，同 `map-node-kind.ts` 引用的
上游）匯出的戦績／ドロップ報告書、建造報告書。

**匯出格式刻意不跟隨「畫面顯示什麼就匯出什麼」的既有慣例**（ships.ts／equipment.ts）：
那兩區是唯讀報表，這兩區的匯出是**可重新匯入的資料交換格式**，故改用固定欄位集合、
英文小寫識別碼當表頭（`ts,map,node,boss,rank,drop,dropMst` /
`ts,kind,shipMst,shipName,fuel,ammo,steel,bauxite,devmat,torch,secretary,secretaryName,hqLv`），
不受目前欄位開關或語言影響——語言切換不能讓自己匯出的檔案變成自己讀不回來。

**`db.sorties`／`db.factory` 是 provider-contract 的 derived tables，正常只能經
`EventProjector` 投影寫入**（AGENTS.md 硬約束 3）。CSV 匯入沿用 `utils/sortie-import.ts` 已建立的
例外路徑：event ID 向 events key generator 借（`add`→`delete`，只前進不回頭），確保匯入列
不會與未來擷取的 raw event 撞號，但**不寫任何 raw event**；每一列匯入都標 `imported: true`
（`SortieLogRow`／`FactoryLogRow` 的 optional 欄位，無索引故不需升 schema 版本），UI 顯示徽章與 `sl-flag.imported`／`sortie-log.ts` 同一套視覺語意。

**去重刻意不是「整批要嘛全進要嘛全退」**（與 `importSortie()` 不同）：CSV 批量匯入的常見
情境是「這份清單裡有一半我已經有了」，故逐列比對，重複的跳過並計入「重複」，其餘新列照常
寫入，交易只在單一列的 DB 寫入層級失敗時才整個 rollback。打撈紀錄的去重鍵是「同海域＋時間
±10 分鐘＋（有 master id 就比對它否則比對名稱）」；建造紀錄故意收窄到 ±2 分鐘**並要求投入
資材完全相同**——建造事件比掉落密集得多（常見「同時間排開好幾艘同配方」），寬鬆的時間窗
會把兩艘不同的船誤判成同一筆重複。

**相容「航海日誌拡張版」的匯出**：該工具的「CSV」其實是 **Tab 分隔＋CRLF、不做欄位跳脫**
（來源：`logbook/gui/logic/CreateReportLogic.writeCsv()`——`StringUtils.join(header, '\t')`），
`parseDelimitedText()`（`utils/csv.ts`）靠表頭那一行 tab 數 vs 逗號數自動判斷分隔符，兩種
來源共用同一支解析器。逐欄語意皆依原始碼（`CreateReportLogic`／`BattleResultDto`／
`MapCellDto`）轉寫、非猜測，但**沒有實機樣本佐證**，故解析器對任何不符預期的列一律跳過並
記錄原因（`skipped: {line, reason}[]`），不猜一個可能錯誤的值（同 `map-node-kind.ts` 的
「沒有樣本佐證的一律不猜」）：

- 戦績／ドロップ報告書的「マス」欄（`MapCellDto.getReportString()`）格式為
  `"マップ:{area}-{mapNo} セル:{cell}"`（或啟用字母化設定時多帶 `-{字母}`），是唯一能可靠
  取出 `world-mapnum` 的欄位——「海域」欄實際是 `getQuestName()`（作戰文字，非數字編號），
  **不能拿來解析 map**。セル／字母是該工具自己的格子概念，與本專案的 edge id 不是同一種東西
  （見 [maps.md](maps.md)「節點字母」），故 CSV 匯入的 `node` 一律當不可考（`0`，UI 顯示 `?`），只取到海域。
- 「ランク」欄（`ResultRank.toString()`）可能是簡寫 `S` 或完整文字如「完全勝利!!S」「敗北E」
  ——兩種形式恰好都以 rank 字母結尾，故一律取尾字元，不需要分支處理兩種格式。
- 「ドロップ艦娘」為空或等於「※空きなし」代表沒有掉落，這種列**靜默跳過、不計入
  `skipped`**（不是解析錯誤，是「這場沒有掉落」的正常情況，同本機擷取只收「有掉落」列的
  既有規則）。「ドロップアイテム」（裝備掉落）本專案不記錄，忽略。
- 建造報告書的「名前」／「秘書艦」是**艦名字串、不是 master id**，只能靠目前 master 反查
  （`reverseShipLookup()`：對 `GameState.master` 建一次性「艦名→id」表，第一個符合的優先）。
  查不到時存進 optional 欄位 `importedShipName`／`importedSecretaryName`讓 UI 至少能顯示原始名字，**不假裝知道是哪個 master id**、也不得回頭當
  `shipMst`／`secretary` 使用。建造報告書沒有「高速建造材」欄，故其匯入列 `used[4]` 固定
  為 0、`kind` 固定為 `'build'`（航海日誌沒有另外記錄「高速完工」事件）。
- 日期一律是 `yyyy-MM-dd HH:mm:ss`（`AppConstants.DATE_FORMAT`），**無時區資訊，只能當本地
  時間解析**——與封包擷取的絕對時間戳不同源，屬已知的精度限制而非臆測。

**打撈紀錄提供「新船／非新船」篩選**：由 `utils/drop-new-ship.ts` 依 `shipObtained` 的首次
自動入手觀測與基礎形態定位歷史上的入手那一撈，並以 `SortieLogRow.eventId` 區分同一場出擊
的各筆掉落。打撈與建造紀錄共用分頁、關鍵字及時間篩選行為。

**測試**：`tests/csv.test.ts`（分隔符偵測／跳脫／往返）、`tests/drop-log-import.test.ts`、
`tests/build-log-import.test.ts`（自家格式往返、航海日誌相容解析、去重與 event ID 借號皆以
node 純函式＋`fake-indexeddb` 驗證，同 `sortie-import.test.ts` 的手法）。

## 工廠紀錄（`db.factory`）

- 開發（`createitem`）與裝備改修（`remodel_slot`，含成功／確実化／失敗）的回應與請求欄位皆已用
  真封包驗證。
- 建造以 `api_get_member/kdock` 快照比對取得：每個渠自帶 `api_item1`～`api_item5` 的實際投入量，
  不從 `createship` 請求推測（曾猜測的 `api_large_flag`／`api_highspeed` 不在這個資料源）。
- `createship_speedchange`（高速建造材完工）的消耗依使用者提供之遊戲設定：普通 1 個、大型 10 個；
  大型判定是投入量達 `LARGE_BUILD_MIN`（1500／1500／2000／1000，`utils/state.ts`），屬固定常數而非
  封包驗證。
