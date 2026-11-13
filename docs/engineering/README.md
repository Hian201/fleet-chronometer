# 工程紀錄索引

本目錄保存 `AGENTS.md` 放不下的現行事實：封包欄位證據、公式、非顯而易見的取捨與已知限制。
依任務只讀對應主題檔，不需要整個目錄讀完。內容與程式碼或測試不一致時以程式碼與測試為準，
並順手修正本檔。

撰寫規則：只寫目前行為、證據與理由，不寫演進經過、日期流水帳或已取代的做法；新內容放進對應
主題檔，沒有合適的主題才新增檔案並登錄到下表。UI 規格寫在 `docs/design-guidelines.md`，譯名
規範寫在 `docs/translation-guidelines.md`，不在這裡重複。

| 檔案 | 內容 | 常用程式碼／測試 |
|---|---|---|
| [capture.md](capture.md) | 資料流、provider 合約、DB 各表與寫入者、ingestion／projection 契約、品牌 i18n、kcsapi path 與 autoSwitch、待驗證封包擷取、擷取失效偵測 | `entrypoints/interceptor.content.ts`、`bridge.content.ts`、`background.ts`、`utils/ingestion-persistence.ts`、`event-projector.ts`、`tests/interceptor-capture.test.ts`、`tests/manifest.test.ts` |
| [battle.md](battle.md) | 戰鬥封包格式、特殊攻擊、友軍與支援、大破／損管／退避、`predictRank`、燃彈費率、艦載機戰損與熟練度 | `utils/battle.ts`、`utils/state.ts`、`tests/taiha-escape.test.ts`、`tests/plane-loss.test.ts`、`tests/lbas-status.test.ts` |
| [maps.md](maps.md) | 關卡量表與剩餘次數、節點類型、節點字母（edge 對照）、斬殺偵測 | `utils/map-node-kind.ts`、`map-node-letters.ts`、`map-edge-letters.ts`（產生物）、`boss-hp.ts`、`tests/zansatsu-phase.test.ts` |
| [records.md](records.md) | 出擊重播（KC3Kai 相容）、出擊紀錄展開、出擊帳單估算、單場 JSON 匯入、不記錄的海域、打撈／建造 CSV、工廠紀錄 | `utils/replay.ts`、`sortie-detail.ts`、`sortie-bill.ts`、`sortie-import.ts`、`sortie-exclude.ts`、`drop-log-import.ts`、`build-log-import.ts`、`deckbuilder.ts` |
| [backup.md](backup.md) | 母港快照、備份格式 v1–v8 與還原規則、FSA 資料夾備份、`viewer.html`、重播保留規則 | `utils/backup.ts`、`utils/retention.ts`、`entrypoints/overview/fsa.ts`、`tests/backup*` |
| [quests.md](quests.md) | 任務動作計數（退路）、條件表與可信度、伺服器對照、重用編號防護、任務導覽的前置推論與介面 | `utils/quest-progress.ts`、`quest-tracking.ts`、`quest-goals.ts`、`quest-flow.ts`、`quest-identity.ts`、`quest-seen.ts`、`tools/quest-graph/`、`tools/quest-goal/` |
| [event-ops.md](event-ops.md) | 活動作戰板：出擊標籤機制、三層結構、燈號、實際貼標觀測、master 海域對應 | `utils/event-plan.ts`、`entrypoints/overview/sections/event-ops.ts`、`tests/event-plan.test.ts` |
| [roster.md](roster.md) | 艦名／裝備名譯名表、全船篩選、艦娘全覽、先制對潛、國籍、裝備全覽、配裝參考、收藏日誌兩個日期 | `utils/ship-filter.ts`、`ship-roster.ts`、`opening-asw.ts`、`ship-nationality.ts`、`gear-inventory.ts`、`equip-ref.ts`、`stype-label.ts`、`gamedata-i18n.ts` |
| [resources.md](resources.md) | 資源序列擷取、量表里程碑、趨勢圖、活動資源消耗切分 | `utils/resource-capture.ts`、`resource-log.ts`、`line-chart.ts`、`event-calendar.ts` |
| [expeditions.md](expeditions.md) | 遠征大發加成公式、遠征資料完整性與 EO 條件轉寫、期間彙總 | `utils/expedition-bonus.ts`、`expedition-data.ts`、`expedition-stats.ts` |
| [fleet-status.md](fleet-status.md) | 基地航空隊疲勞推論、泊地修理與野埼給糧、士氣回到 49 的倒數、登出前閒置檢查、疲勞回復通知 | `utils/lbas-cond.ts`、`repair.ts`、`cond.ts`、`idle-check.ts`、`tests/repair.test.ts`、`tests/lbas-cond.test.ts`、`tests/idle-check.test.ts` |
| [game-page.md](game-page.md) | 視窗適應（劇場）、遊戲靜音、獨立視窗、拍照、關閉分頁前警示 | `entrypoints/theater.content.ts`、`utils/theater.ts`、`screenshot.ts`、`entrypoints/bridge.content.ts` |
| [fleet-photo.md](fleet-photo.md) | 面板編成寫真：讀遊戲畫布、裁切範圍、輸出版面、header 縮放 | `entrypoints/panel/fleet-photo.ts`、`utils/fleet-photo.ts`、`tests/fleet-photo.test.ts` |
| [route-forecast.md](route-forecast.md) | 常規導航：分岐規則、節點座標、地理底圖對位、到王編成參考、overview 即時更新 | `utils/route-predict.ts`、`route-rules-*.ts`、`map-spots.ts`、`map-geo-data.ts`、`route-suggest.ts`、`entrypoints/overview/live-state.ts` |
| [goals.md](goals.md) | 目標規劃：改造目標的需求來源、推算類消耗、庫存分配、儲存位置 | `utils/remodel-goals.ts`、`remodel-cost-data.ts`（產生物）、`entrypoints/overview/sections/goals.ts`、`tools/remodel-cost/`、`tests/remodel-goals.test.ts` |
| [llm.md](llm.md) | LLM 分析的三條零權限路徑與報告摘要原則 | `entrypoints/overview/sections/llm.ts`、`prompt-api.d.ts` |

## 樣本

- `samples/` 是真實封包 fixture。`samples/start2-master.json` 是去識別化的 start2 子集（12 張
  master 表，表名與來源見檔內 `_note`），更新流程見 [quests.md](quests.md)「start2 樣本更新」。
- `samples/kanmusu_filter.png`（艦娘篩選）與 `samples/KC3kai_sortie_log.png`（出擊紀錄展開）是
  版面參照圖。
- 裝備圖示 id 41（輸送機材）與 56–60 對應的實際裝備仍未證實，圖示機型為推定；圖示規格見
  `tools/icons/README.md`。
