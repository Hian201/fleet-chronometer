# 工程紀錄索引

`docs/engineering-log.md` 保留完整的現行契約、證據與取捨。閱讀工程細節時先用本索引定位，再用 Read 只取「行號」欄的區間；不要為了小改動載入整份文件。行號會隨增補漂動，若對不上，以 `rg -n '^#{2,3} ' docs/engineering-log.md` 重新定位後更新本表。行號只供快速定位，不是資料契約；契約以標題、程式碼與測試為準。

| 任務 | 先讀的章節 | 行號 | 常用檔案／測試 |
|---|---|---|---|
| 擷取、token、provider | `設計原則`、`架構與資料流`、`檔案職責`、`各遊戲介面對應的 kcsapi path`、`驗證原則與封包擷取` | 22–43、75–191、246–267、2186–2213 | `entrypoints/interceptor.content.ts`、`bridge.content.ts`、`tests/interceptor-capture.test.ts` |
| ingestion、SW recovery、projection、pruning | `Handoff：持久化、投影與發布契約` | 192–245 | `utils/ingestion-persistence.ts`、`background-ingestion-lifecycle.ts`、`event-projector.ts`、`event-pruning.ts` |
| 戰鬥、rank、燃彈 | `戰鬥預測子系統`、`現行遊戲 API 格式`、`特殊攻擊`、`predictRank`、`出擊燃彈消耗費率` | 268–317、403–443 | `utils/battle.ts`、`utils/state.ts`、`tests/*battle*` |
| 大破、損管、退避 | `大破・損管・退避` | 318–402 | `utils/battle.ts`、`utils/state.ts`、`tests/taiha-escape.test.ts`、`tests/boss-entry-taiha.test.ts` |
| 艦載機戰損、熟練度 | `出擊途中的艦載機戰損` | 444–525 | `utils/state.ts`、`tests/plane-loss.test.ts`、`tests/lbas-status.test.ts` |
| 關卡量表、斬殺、TP | `關卡進度與剩餘次數` | 526–553 | `utils/state.ts`、`utils/boss-hp.ts`、`tests/zansatsu-phase.test.ts` |
| 節點類型／字母 | `節點類型`、`節點字母` | 655–807 | `utils/map-node-kind.ts`、`utils/map-node-letters.ts` |
| 重播與出擊紀錄 | `出擊重播`、`出擊紀錄的展開檢視` | 554–654 | `utils/replay.ts`、`utils/sortie-detail.ts`、`utils/sortie-import.ts` |
| 備份、還原、裁剪 | `母港快照與資料備份還原` | 887–978 | `utils/backup.ts`、`utils/quest-flow-prefs.ts`、`utils/quest-observed.ts`、`utils/quest-seen.ts`、`entrypoints/overview/sections/backup.ts`、`tests/backup*` |
| 遠征加成與資料、CSV | `打撈紀錄／建造紀錄的 CSV 匯出入`、`遠征資源加成`、`遠征資料完整性`、`遠征紀錄的期間彙總` | 2223–2427 | `utils/expedition-bonus.ts`、`utils/expedition-data.ts`、`utils/*-log-import.ts`、`utils/expedition-stats.ts` |
| 任務進度 | `任務本機進度追蹤` | 1124–1273 | `utils/quest-progress.ts`、`tests/quest-progress.test.ts` |
| 任務判定與可信度 | `任務判定與可信度` | 1274–1357 | `utils/quest-tracking.ts`、`utils/quest-goals.ts`、`utils/quest-goal-data.ts`（產生物，`tools/quest-goal/`）、`utils/quest-goal-label.ts`、`utils/quest-identity.ts`、`utils/quest-goal-local.ts`、`utils/quest-goal-compare.ts`、`tools/quest-goal/compare.ts`、`tests/quest-goal-local.test.ts`、`tests/quest-identity.test.ts`、`utils/state.ts`（`questTracking`）、`entrypoints/panel/general.ts`、`entrypoints/overview/sections/quest-flow.ts`、`tools/preview/quest-tracking-*.ts`、`tests/quest-tracking.test.ts` |
| 任務導覽 | `任務導覽的單發完成推論` | 1359–1459 | `utils/quest-flow.ts`、`utils/quest-graph-data.ts`、`utils/quest-graph-reviewed.ts`、`tools/quest-graph/`（wikiwiki＋ぜかまし＋quest-planner＋tsukinohashi＋舰娘百科）、`tools/preview/quest-flow-guide.ts`、`utils/quest-flow-prefs.ts`、`utils/quest-observed.ts`、`utils/quest-seen.ts`、`entrypoints/overview/sections/quest-flow.ts`、`utils/quest-graph-layout.ts`、`tests/quest-flow.test.ts`、`tests/quest-unlock-path.test.ts`、`tests/quest-observed.test.ts`、`tests/quest-seen.test.ts`、`tests/backup-quest-flow.test.ts` |
| 活動標籤與關卡 | `活動作戰板：關卡與出擊標籤` | 1460–1612 | `utils/event-plan.ts`、`entrypoints/overview/sections/event-ops.ts` |
| 艦娘、裝備、補強增設 | `鎮守府全船篩選`、`艦娘全覽`、`裝備全覽`、`艦娘收藏日誌` | 1613–1772、1896–1942 | `utils/ship-filter.ts`、`ship-roster.ts`、`stype-label.ts`、`gear-inventory.ts` |
| 配裝參考 | `配裝參考` | 1773–1793 | `utils/equip-ref.ts`、`entrypoints/overview/sections/equip-ref.ts`、`tests/equip-ref.test.ts`、`tests/ships-stype-label.test.ts`、`tests/overview-two-pane-layout.test.ts` |
| 譯名與產生物 | `艦名／裝備名譯名表` | 854–886 | `utils/gamedata-i18n.ts`、`utils/gamedata-names.ts`、`tools/gamedata-names/` |
| 資源序列與圖表 | `資源紀錄` | 1794–1895 | `utils/resource-capture.ts`、`resource-log.ts`、`line-chart.ts` |
| 基地航空隊疲勞 | `基地航空隊中隊疲勞` | 979–1052 | `utils/lbas-cond.ts`、`tests/lbas-cond.test.ts` |
| 泊地修理、母港給糧 | `泊地修理與母港給糧` | 1053–1123 | `utils/repair.ts`、`tests/repair.test.ts` |
| 劇場、靜音、拍照、關頁警示 | `劇場模式與遊戲靜音`、`拍照`、`關閉分頁前警示` | 1943–2098、2158–2185 | `utils/theater.ts`、`audio-mute.ts`、`screenshot.ts`、`entrypoints/bridge.content.ts` |
| 編成寫真（面板拍照托盤）、header 自動縮放 | `編成寫真` | 2099–2157 | `entrypoints/panel/fleet-photo.ts`、`entrypoints/panel/header-fit.ts`、`utils/fleet-photo.ts`、`entrypoints/bridge.content.ts`（`PORT_GAME_FRAME`）、`tests/fleet-photo.test.ts`、`tools/preview/fleet-photo-panel.ts` |
| LLM 分析 | `LLM 分析子系統` | 808–853 | `entrypoints/overview/sections/llm.ts` |
| UI 版面與圖示 | 改讀 [`docs/design-guidelines.md`](design-guidelines.md) | 面板 §7、情報總括雙欄 §4.7、同名艦種 §4.8、圖示 §5.1 | 相關 preview、`tests/overview-two-pane-layout.test.ts` |

建議查閱方式：用 Read 只取上表行號區間（例如 offset 317、limit 85）。不要整本讀取 `docs/engineering-log.md`。
