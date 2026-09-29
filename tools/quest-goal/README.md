# quest-goal

把 poi（MIT）的任務進度條件表 `assets/data/fcd/questgoal.json` 轉成 `utils/quest-goal-data.ts`。

```bash
python3 tools/quest-goal/generate.py            # 抓固定 commit（有快取就不連網）
python3 tools/quest-goal/generate.py --offline  # 只讀 tools/quest-goal/.cache/
```

- 固定 commit 寫在 `generate.py` 的 `POI_COMMIT`；更新時一併改 `THIRD-PARTY-NOTICES.md`。
- 只收錄結構化條件，不收錄 poi 的中文說明文字；介面標籤由子目標結構自行組出。
- 判定引擎在 `utils/quest-goals.ts`，依 poi `skills/quest-goal-data/SKILL.md` 記載的語意自行實作。
  本機修正放在同檔的 `QUEST_GOAL_OVERRIDES`，不要改產生物。
