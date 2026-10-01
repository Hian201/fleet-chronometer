# quest-goal

把 poi（MIT）的任務進度條件表 `assets/data/fcd/questgoal.json` 轉成 `utils/quest-goal-data.ts`。

```bash
python3 tools/quest-goal/generate.py            # 抓固定 commit（有快取就不連網）
python3 tools/quest-goal/generate.py --offline  # 只讀 tools/quest-goal/.cache/
```

- 固定 commit 寫在 `generate.py` 的 `POI_COMMIT`；更新時一併改 `THIRD-PARTY-NOTICES.md`。
- 只收錄結構化條件，不收錄 poi 的中文說明文字；介面標籤由子目標結構自行組出。
- 判定引擎在 `utils/quest-goals.ts`，依 poi `skills/quest-goal-data/SKILL.md` 記載的語意自行實作。
  本機撰寫或修正的條件放在 `utils/quest-goal-local.ts`，不要改產生物。

## 本機條件與比對

新活動任務在來源更新前，先依任務說明原文與 wikiwiki 任務頁寫進 `utils/quest-goal-local.ts`
（格式同產生物，每筆記下對照的日文標題、依據與日期）。來源收錄後執行比對：

```bash
npx vite-node --config vitest.config.ts tools/quest-goal/compare.ts           # 與目前固定版本比對（不連網）
npx vite-node --config vitest.config.ts tools/quest-goal/compare.ts --latest  # 抓來源最新版比對
```

一致就刪掉本機那筆（並視需要更新 `POI_COMMIT` 重跑產生器）；有差異先查證再決定採用哪一邊。
