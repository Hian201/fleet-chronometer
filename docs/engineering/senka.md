# 本月戰果

面板頁首戰果與 270 px 托盤，以及情報總括「戰果」分區的現行規則。公式依 wikiwiki「称号・戦果」；
排行榜解碼依 `samples/ranking-page-*.json`。介面尺寸與版面見 `docs/design-guidelines.md`，
資料表與備份格式見 [capture.md](capture.md)、[backup.md](backup.md)。

## 時間界線

時間一律以 UTC 毫秒計算，換算成日本時間（JST）時不依賴本機時區（`utils/senka.ts`）。

| 界線 | 時刻（JST） | 用途 |
|---|---|---|
| 作戰月 | 前月末 22:00 起，到當月末 22:00 止（不含） | 普通戰果、月份歸屬。時間戳加 11 小時後取 UTC 年月，大小月與跨年自動成立 |
| EO 戰果 | 當月 1 日 00:00 起，到當月末 22:00 止 | 月末 22:00～23:59 擊破不計入當月，也不計入下月 |
| 任務戰果 | 前月末 14:00 起，到當月末 14:00 止 | 月末 14:00 後領的任務算下個月 |
| 今日新增 | 每日 05:00 換日 | 重用 `questCycleWindow('daily')`，並以作戰月起點夾住，月初不混入前月經驗 |
| 排行榜 | 每日 03:00、15:00 公布，各以前一小時（02:00、14:00）結算 | `rankingRoundAt()`；結算到公布之間與月末 22:00～次月 1 日 02:59 都歸前一次公布榜。月末 15:00 那次是最後公開榜（`isFinalRound`） |

## 三種已觀測戰果

- **普通戰果**：提督經驗值增量 × 7 ÷ 10,000，保留小數。經驗值只在 `api_port/port` 寫入
  `db.resources.exp`；`api_get_member/material` 的列沒有 `exp`，計算時略過。
  `regularSenkaForMonth()` 以月界前最後一筆讀數為起點：
  - 月界前後讀數相等：`exact`。
  - 起點落在前一個作戰月內且經驗值不同：`range`，下界只算月內讀數，上界從起點算起，因為無法分辨那段經驗是月界前還是後拿的。
  - 沒有月界前讀數，或起點早於前一個作戰月（長休）：`no-start`，只顯示月內觀測值。
  - 經驗值倒退：`anomaly`。
- **EO 戰果**：見 [maps.md](maps.md)「EO 戰果防護」。合併 `db.sorties` 與當月 `mapinfo` 快照，同一海域一個月只計一次，封包 `api_get_exmap_rate` 優先於固定表（`EO_SENKA_MAPS`）。
- **任務戰果**：`db.questObserved` 的領獎紀錄 × 任務目錄戰果值（`utils/quest-senka.ts` 從目錄 `otherJa` 解析「戦果+N」）。選擇報酬另計，總額為區間；期間限定任務在實裝期間外領取不計（編號會重用）；只以 `eventId` 去重，所以換季月同一編號可以計兩次。目錄沒收錄戰果的任務不計入，介面另行註記。

## 排行榜擷取

- 路徑 `api_req_ranking/mxltvkpyuklh`。解碼依 clean-room 重寫的 poi-plugin-senka-calc 演算法（`utils/senka-ranking.ts`，登錄於 `THIRD-PARTY-NOTICES.md`）；語意未證實的欄位不使用，無法整除時回 `null`、不記錄。
- background 在 post-processing 呼叫 `captureSenkaRanking()`：以母港快照的提督名比對本頁唯一同名列，命中才寫本人列 `self:${publishedAt}`；名次剛好是 5／20／100／500 的列寫成自動榜線 `cutoff:${publishedAt}:${rank}`。他人的提督名不存。寫入後廣播 `kc:live`，面板收到這條路徑就重讀。
- `db.senkaRankings` 有兩個寫入者（background 自動、總括手動），讀、比、寫與刪除都包在同一個 `rw` 交易。自動列較晚觀測者勝出；已被手動更正的榜線，只有觀測時間不早於手動列的新封包能覆蓋，避免 recovery 重跑把更正蓋回舊值。
- 總括手動登錄只能選當月已公布的榜次，經 `saveManualCutoff()`／`deleteManualCutoff()` 寫入；刪除前核對該列確為 `manual`。

## 校準與推算

`calibrateMonthlySenka()`（`utils/senka-calibration.ts`）：

- 遊戲榜分是無條件捨去的整數、經驗值換算是小數，所以一致判定與夾限容差 ±1（`SENKA_CALIBRATION_TOLERANCE`）。
- 有月起點時，以最早一次本人榜分減去月起點到該次結算時刻的已觀測增量，得到**繼承分**（carry，`kind: 'carry'`）；沒有月起點時以最新榜分當基線（`kind: 'baseline'`）。
- 推算＝最新本人榜分＋該次結算後新增的已觀測增量。新榜分一到就從它重起，已納入的增量不重算。
- 多次榜分推出的繼承分差超過容差時記 `baseline-drift`，某次榜分低於本機到該次結算的已觀測增量、推出負的繼承分（超過容差）時記 `inconsistent-baseline`；這兩種在面板與總括加一行「榜分與本機紀錄不符，可能有在其他裝置取得的戰果」。其餘原因（缺月起點、月界區間、結算前缺讀數、選擇報酬、EO 時刻不確定）已由區間表現，不另加說明。
- `special-senka-gap`（特別戰果空窗）由呼叫端以 `hasSpecialSenkaGap` 傳入；目前沒有呼叫端傳入，因為還沒有能判定特別戰果的封包依據。
- 沒有當月本人榜分時為 `uncalibrated`：主數值維持「已觀測戰果」（普通＋EO＋任務，不含繼承分），目標榜線照樣列出但不算差額。

## 目標與差額

- 目標存本機 localStorage `kc-senka-target`（`utils/senka-prefs.ts`），預設 `null`（不設目標），只在總括設定；面板經 storage 事件同步、只讀不寫。選項是不設目標、第 5／20／100／500 名與自訂分數。不記錄伺服器，介面不顯示伺服器名。目標也隨備份的選填欄位 `senkaTarget` 往返。
- `evaluateSenkaTarget()` 只用指定作戰月的榜線，絕不借他月；取最新公布榜次，同一榜次自動列優先於手動列。當月沒有該名次榜線時只顯示「—」並提示尚未登錄。
- **當次榜差**：同一榜次本人分減榜線，兩個整數相減。**距該榜線／距自訂目標**：推算值減目標，是區間。

## 顯示取整

`utils/senka-view.ts`：

- 小數區間上下界相等時四捨五入成單值；不等時下界無條件捨去、上界無條件進位，確保涵蓋真值。推算值與增量加 ≈（`formatSenkaBounds`、`formatSignedSenkaBounds`）。
- 當次榜差不加 ≈（`formatSenkaIntGap`）。`-0` 一律正規化為 0。
- 名次一律經 `formatSenkaRank()`：英文加 st／nd／rd／th，繁中與日文為純數字。

## 面板

- 頁首戰果由總括的釘選偏好 `kc-panel-senka` 控制（`utils/ui-prefs.ts`）；未釘選時頁首維持提督名與等級，也不讀戰果資料。
- 托盤取代 `#tabpanel`，不遮編成；出擊進點、新戰鬥封包、切分頁、Esc 時收起。
- 收到 `api_port/port`、`api_get_member/mapinfo`、`api_req_quest/clearitemget` 與排行榜路徑時重讀 DB；每分鐘以快取資料重算倒數與差額，跨作戰月時重讀。

## 情報總括

- 分區先畫外殼與控制項（釘選、目標、登錄表單、對帳選單）再讀 DB；之後只覆寫各插槽，不重建帶輸入的控制項（設計規範 §4.2／§4.2.1）。
- 榜線紀錄依公布時刻分組、新到舊；手動列附刪除鈕。
- **逐月對帳**：含當月往回共 12 個作戰月（`SENKA_RECON_MAX_MONTHS`）；當月一律列出，過去月份只列有資料（讀數、榜分、EO、任務）或已填最終結果的月份。過去月份以月界前一刻計算，取最後一次本人名次。「最終結果」（`db.senkaMonths`，聯合／一～三群／未入選）是玩家自填：最終名次由營運另行公布，遊戲封包沒有對應欄位。進行中的月份停用此選單，避免先猜群別；跨月後上個月隨即開放，選回「—」時刪除該列。
