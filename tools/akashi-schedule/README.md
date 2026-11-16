# akashi-schedule

把 wikiwiki.jp/kancolle「改修表」與 KC3Kai（MIT）的 `src/data/akashi.json` 合成 `utils/akashi-schedule-data.ts`
（裝備 × 曜日 × 第一艦隊二番艦）。查詢在 `utils/akashi-schedule.ts`，產生物勿手改。

```bash
python3 tools/akashi-schedule/generate.py            # 有快取就不連網
python3 tools/akashi-schedule/generate.py --offline  # 只讀 tools/akashi-schedule/.cache/
```

- wiki 是主要來源；KC3Kai 固定 commit（`generate.py` 的 `KC3_COMMIT`，上游自 2025-06 起未更新）只用來交叉比對，
  並補 wiki 沒有的裝備（記在 `AKASHI_KC3_ONLY`）。更新 wiki 資料時刪掉 `.cache/wiki-kaishuhyo.html` 重跑；
  換 KC3Kai commit 時一併更新 `THIRD-PARTY-NOTICES.md` 第 12 節。
- 每次執行會印出交叉比對結果（一致／差異筆數與樣本）、wiki 對不到 start2 的艦名／裝備名、旗標未填而略過的列。
  差異不中止：上游新舊不同是預期的，但要看過差異樣本再採用。
- 名稱對照用 `samples/start2-master.json`（NFKC＋不分大小寫、去空白）；對不到的才放進 `generate.py` 的
  `SHIP_ALIASES`／`GEAR_ALIASES`／`FORM_IDS`，每筆註明依據，不做模糊比對。
- 二番艦欄的 tooltip 註記只認 `generate.py` 檔頭列出的語法，遇到其他寫法會中止，要人工確認後再擴充。
- 展開規則：列出的艦名含其後所有改造形態（`api_aftershipid` 與 `api_mst_shipupgrade`，兩者目前完全一致）；
  同一件裝備另外單獨列出較後面的形態時，該形態只採它自己的記載（wiki「表の読み方」例 5）。
