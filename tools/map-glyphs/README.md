# map-glyphs

從 KagamiChan/kcs2-mapdata（MIT）的過去活動地圖圖檔，產生節點字母的**二值字形遮罩庫**
`utils/map-glyph-data.ts`，以及 62 活動的測試 fixture `samples/map-glyph/62-*.json`。
辨識在 `utils/map-glyph.ts`，用途與整體設計見 `docs/completion-plan.md` 4.11。產生物勿手改。

```bash
python3 tools/map-glyphs/generate.py                       # 第一次會 git clone --depth 1 到 .cache/
python3 tools/map-glyphs/generate.py --exclude-area 62 --out /tmp/x.ts   # 排除指定海域（留一驗證用）
```

- 只用標準函式庫（PNG 自行解碼，多行程）；全部海域約 10 秒。
- 來源只 clone 一次（`.cache/` 不進版本庫；原圖不得散布）。要更新就刪掉 `.cache/` 重跑；輸出檔頭記錄
  clone 當下的 commit。不逐檔呼叫 GitHub API。
- 字形來源：追加檔標籤 sprite（名稱即影格名，去掉 `<海域>-<關>_text_` 前綴；須是 `A`、`B1`、`ZZ` 形式，且切字後恰為一個字）；
  point 圖層上的字，以 `tools/map-edges/edges.json` 的終點字母監督（該關不在 edges.json 就略過；
  附近 45px 內有追加檔標籤的節點，字母在 sprite 而不在圖層，不監督）。
- 字形尺寸限制：高 13～17px、寬 2～30px。更小的是亮色字身被門檻切碎的殘片（62 活動的 `I`、`V` sprite），
  更大的是節點標記，拿來比對只會誤讀。
- 同一遮罩對到多個名稱：sprite 的名稱優先；只有 point 監督的名稱要有其他名稱 3 倍以上的地圖支持才留，
  否則丟棄（名稱與位置可能指派錯誤）。遊戲 sprite 本身相同的（目前只有 `P`／`R` 的字身）會保留，
  比對時因兩個名稱同分而讀不出。
- 遮罩、切字、指派的參數與 `utils/map-glyph*.ts` 必須一致（見產生器檔頭）；改任一邊都要兩邊同步並重跑
  `tests/map-glyph.test.ts`。
- fixture 只存二值遮罩：`nodes[]`（座標與 KC3Kai 字母；字母只在圖層上的節點另附 110×110 裁切）、
  `sprites[]`（該關標籤 sprite）。
