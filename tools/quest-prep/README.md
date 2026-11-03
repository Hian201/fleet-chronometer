# quest-prep

編成任務、裝備準備／機種轉換任務與海域攻略任務的達成條件表：
`conditions.py`（人工審核資料）→ `utils/quest-prep-data.ts`（產生物，勿手改）。

```bash
python3 tools/quest-prep/generate.py            # 產生 utils/quest-prep-data.ts
python3 tools/quest-prep/generate.py --report   # 另外列出與 kcwiki-quest-data 舊資料的差異
```

- 條件以 wikiwiki「任務/編成任務」「任務/工廠任務」與 KC3Kai kc3-translations 現行說明逐筆核對後撰寫；
  kcwiki-quest-data（2024-06 後未更新）只當比對草稿，不直接採用。兩個現行來源都寫不清楚的任務放進 `EXCLUDED`；由使用者確認後收錄的條件在該筆註明「使用者確認」與日期。
- 艦名、裝備名寫 start2 日文原名，產生器換成 master id；名稱對不上或同名多筆時報錯、不輸出。
  新艦或新裝備不在 `samples/start2-master.json` 時，先更新樣本再寫條件。
- 廢棄條件：任務進度條件表（`utils/quest-goal-data.ts`）已收錄的任務沿用其計數，兩邊不同時報錯；
  確認來源有誤時改寫 `utils/quest-goal-local.ts`（例：1103）。
- 判定語意見 `utils/quest-prep.ts` 開頭；第三方來源登錄於 `THIRD-PARTY-NOTICES.md` 11b。
