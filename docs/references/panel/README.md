# Panel 定版參考截圖

`panel-sortie-final.png` 是出擊分頁與下方七艘編成列的定版參考截圖，供版面校對使用。
它不是執行時載入的資產；正式 panel 的編成 DOM 與 CSS 仍以
`entrypoints/panel/main.ts`、`entrypoints/panel/index.html` 為準。

編成定版採 `.ship-body` 雙欄結構：左欄放艦種、艦名與裝備，右欄固定 `96px` 放 HP、狀態、
燃料與彈藥；裝備列維持單行，普通裝備 chip 為 `40px`、增設槽為 `34px`，圖示為 `16px`。
七艘滿編時只收緊艦列內距與 row-gap，不能把補給資訊塞回裝備列，也不能回復成舊的
`.ship-row`／`supply-combo` 版面。
