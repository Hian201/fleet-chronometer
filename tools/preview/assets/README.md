# 出擊預覽圖示來源

目前正式面板與離線出擊預覽都以 `public/icons/tactical/` 為唯一圖示來源。
本目錄不再保存副本；若需新增或替換支援圖示，只更新 `public/icons/tactical/`，再檢查
正式面板與預覽。預覽輸出的相對路徑會由 `tools/preview/panel-sortie.ts` 指向該正式資產目錄。
