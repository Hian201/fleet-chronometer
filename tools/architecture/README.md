# tools/architecture

README 用架構圖的產生器。**`docs/architecture-*.svg` 是產生物，勿手改**——改
`generate.py` 再重跑。

```bash
python3 tools/architecture/generate.py
# → docs/architecture-en.svg / architecture-zh-TW.svg / architecture-ja.svg
```

三份 README（`README.md` / `README.zh-TW.md` / `README.ja.md`）各引用同語言那一份。

## 設計約束

- **面向一般使用者**：主軸是「遊戲照常運作 → 只複製一份唯讀副本 → 全在本機處理」，
  技術詞只出現在卡片的小標（content script／service worker／IndexedDB），不出現在主句。
- **自帶不透明底色**：GitHub 亮／暗兩種主題都要可讀，不做 `prefers-color-scheme` 分歧。
- **不用 `<style>` 與 CSS class**：GitHub 會清洗 README 內嵌的 SVG，樣式一律走
  presentation attribute（`fill=` / `font-size=` …）才保證顯示一致。
- **不用 `marker`／漸層**：同上，箭頭一律畫成顯式 `<polygon>`，圖示用平塗色。
- **不做自動斷行**：CJK 與拉丁字寬差太多，換行位置由 `STRINGS` 裡的字串陣列人工決定；
  改文案時要一併確認不會溢出卡片（卡片內寬 221px，正文 12.5px）。
- **色彩取自既有系統**：亮色主題變數見 `entrypoints/panel/index.html`，語意色見
  `docs/design-guidelines.md` §1.2。

## PNG（可選）

SVG 已能直接在 GitHub README 顯示，故儲存庫只收 SVG。需要點陣圖（例如商店頁截圖、
簡報）時用 headless Chrome 轉，輸出到 gitignore 的 `.preview/`：

```bash
mkdir -p .preview/arch
for L in en zh-TW ja; do
  printf '<!doctype html><meta charset="utf-8"><body style="margin:0">' > .preview/arch/$L.html
  cat docs/architecture-$L.svg >> .preview/arch/$L.html
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=old --disable-gpu --no-first-run --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1280,1010 \
    --user-data-dir=/tmp/fc-arch-chrome \
    --screenshot=".preview/arch/$L.png" "file://$PWD/.preview/arch/$L.html"
done
```

`--headless=old` 是刻意的：`--headless=new` 在本機實測會截完圖不結束程序。
