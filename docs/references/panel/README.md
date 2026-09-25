# Panel 定版參考截圖

`panel-sortie-final.png` 是出擊分頁與下方七艘編成列的定版參考截圖，供版面校對使用。
它不是執行時載入的資產；正式 panel 的編成 DOM 與 CSS 仍以
`entrypoints/panel/main.ts`、`entrypoints/panel/index.html` 為準。

編成定版採 `.ship-body`：32px 艦種莖＋主欄兩 sweep。首列 Lv 貼艦名、燃彈殘量與
有狀態才出現的 34px 狀態槽；次列 HP 與 221px 裝備（普通 chip `36px`、增設槽 `31px`，圖示
`14px`）。七艘滿編時只收緊艦列內距與 `.ship-main` row-gap，不能把補給資訊塞回裝備列，
也不能回復成舊的 `.ship-row`／`supply-combo` 或 96px 右欄儀器版面。
