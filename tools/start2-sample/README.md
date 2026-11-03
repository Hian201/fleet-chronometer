# start2-sample

更新 `samples/start2-master.json`（start2 主資料子集）。新艦、新裝備實裝後要重跑，否則依樣本產生或驗證的資料
（任務達成條件表、三語譯名表的覆蓋檢查、艦娘篩選驗算等）會缺。

```bash
python3 tools/start2-sample/refresh.py --backup <總括頁匯出的完整備份.json>          # 優先：擴充自己擷取的封包
python3 tools/start2-sample/refresh.py --file <start2.json> --source "<來源說明>"    # 例：公開 start2 鏡像
```

- 只保留本專案用得到的表；活動結束後消失的海域與活動遠征保留舊列（真實封包證據）。
- 執行後會列出新增／移除／改名的艦娘與裝備。新艦要補進 `samples/i18n/ship-names-i18n-player.csv`
  （英文名、台灣華語名），再重跑 `tools/gamedata-names/generate.py` 與 `tools/gamedata-coverage/generate.py`；
  `tests/gamedata-coverage.test.ts` 會擋下缺譯名的艦娘。
