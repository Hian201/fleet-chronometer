# 航海鐘 Fleet Chronometer

[English](README.md) | [日本語](README.ja.md)

<p>
  <a href="https://chromewebstore.google.com/detail/fleet-chronometer-kancoll/akinifhdgdafifijckbbahfeoikkknip">
    <img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Chrome 線上應用程式商店提供" width="206" height="58">
  </a>
</p>

一款**被動式**的艦隊これくしょん（KanColle）通用作戰圖像（COP）瀏覽器擴充——
艦隊、遠征、入渠、基地航空隊、關卡進度、戰鬥預測、燃彈估算全部整合在一個面板，
並有可查詢、可繪圖、可備份的本機歷史紀錄。

本專案為玩家自製的同人工具，**與 DMM.com 或 Kadokawa Games 無任何關係、未經其
認可或贊助**。「艦隊これくしょん -艦これ-」及遊戲內所有素材版權皆屬其原始權利人。

> **公開測試提醒：** 本專案甫上線測試，建議現階段與其他輔助工具並行使用，並交叉
> 確認重要資訊，避免因顯示或預測誤差造成意外。

## 緣起

Chrome／Chromium 正結束 Manifest V2：自 Chromium 150 起持續移除 MV2 相關程式碼與
權宜開關，Chrome 線上應用程式商店亦訂於 **2026 年 8 月 31 日**下架剩餘的 MV2 擴充。
依賴 MV2 的工具（例如 [KC3Kai](https://github.com/KC3Kai/KC3Kai)）因此無法再於現行
Chrome 上可靠使用。本專案是為此而生的 **Manifest V3 緊急應對方案**——只做被動觀測與
本機運算，不取代遊戲本身，也不宣稱功能或資料與既有工具完全對等。

**請勿把本擴充的顯示或預測當作資訊判斷的唯一來源。** 重要紀錄請自行做好備份
（可用本機備份功能，或你慣用的其他方式）。

## 功能

- **即時面板**——艦隊血量/疲勞/補給、遠征與入渠倒數（附通知）、基地航空隊、
  關卡量表進度。
- **戰鬥預測**——終末HP、rank、MVP、大破警告，皆由遊戲送出的封包即時算出。
- **燃彈估算**——出擊途中依節點類型估算消耗，回港後以實際數字校正。
- **出擊紀錄**——一次出擊一張卡：路線、編成、逐節點作戰細節、支援艦隊／基地
  航空隊波次，可匯出成 KC3Kai battleplayer 重播格式。
- **資源紀錄**——八項資材整合在同一張折線圖，附各活動關卡的消耗區間統計。
- **活動作戰板**——追蹤各關卡的出擊標籤規則，避免不小心把船鎖死在錯的
  路線上。
- **艦娘與裝備全覽**——完整可篩選、可排序的收藏清單。
- **本機備份**——匯出/匯入到你指定的資料夾（例如 Google Drive 桌面同步夾），
  附離線 HTML 檢視器，不需安裝擴充也能讀取重播。
- **視窗適應**——讓遊戲畫面等比填滿瀏覽器視窗；大小靠拉動視窗邊框調整，可靜音。

## 運作原理

![遊戲與伺服器之間完全照原本的方式通訊。Fleet Chronometer 只讀取一份遊戲已經收到的
回應副本，先刪掉登入 token，經單一入口寫成紀錄，全部留在瀏覽器的本機資料庫，並在你自己
的機器上推算艦隊狀態與戰鬥預測。它不發送、不修改、不重送遊戲流量，不代打，也不上傳任何
資料。](docs/architecture-zh-TW.svg)

## 隱私與安全，從設計上保證

- **只做被動擷取**——擴充只觀察遊戲自己送出的流量，絕不重放、修改、代發任何請求。
- **帳號憑證不會離開你的瀏覽器**——`api_token` 在存進任何地方或在內部傳遞前
  就已被剔除，永遠不會被保存。
- **不上傳任何資料到任何地方**——所有資料都存在你瀏覽器本機的 IndexedDB，
  沒有後端伺服器。
- **權限精簡**——只有在特定功能真的需要時才會請求（例如視窗適應只有在你按下
  按鈕時才會要求 DMM 遊戲頁的存取權，安裝當下絕不會要求）。

完整的設計約束記載於本專案內部文件。

## 技術棧

[WXT](https://wxt.dev/) + TypeScript + [Dexie](https://dexie.org/)（IndexedDB）。
純前端、Manifest V3、無後端。

## 從原始碼建置

```bash
npm install
npm run build        # 產出 .output/chrome-mv3——以「載入未封裝項目」載入
npm run dev           # 開發模式，改動自動 rebuild
npm test              # vitest 測試套件
```

在 `chrome://extensions` 用「載入未封裝項目」指向 `.output/chrome-mv3`。
改完原始碼後須重新 build，並在擴充管理頁按重新整理；已開著的遊戲分頁也要
手動重新整理一次（MV3 content script 的既知限制）。

## 貢獻

這主要是一人維護的個人專案。歡迎透過 Issues 回報問題或提出建議；外部 pull
request 我可能沒有心力逐一審查與合併——如果你想跑自己的修改版本，歡迎直接
fork。

## 授權

- 程式碼：[MIT](LICENSE)。
- 原創圖示／App icon 資產（`public/icons/`、`public/icon/`、
  `tools/app-icon/`）：**不包含**在 MIT 授權範圍內，見
  [ASSETS-LICENSE](ASSETS-LICENSE)。
- 參照自其他開源專案的第三方資料與演算法，維持其原始授權，見
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
