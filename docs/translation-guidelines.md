# 台灣華語翻譯規範

本專案的 `zh-TW` 文案以台灣華語撰寫。繁體字形不代表台灣用語；禁止將簡體中文直接轉成繁體後當作譯文，也不可只做字形替換而略過語意校對。KC3Kai、poi 等上游翻譯可供理解原意與比對條件，不能視為台灣用語的定稿。

## 校對原則

- 以自然、清楚的台灣華語重寫，使用台灣常見標點，並以「」作為引號；避免日文殘留、直譯語序、簡體字及中國慣用詞。
- 不增刪遊戲條件。逐項核對艦名與改裝型態、艦種、旗艦位置、艦隊／艦隊編成、數量、可選條件、海域與節點、勝利等級、次數及消耗物品。
- 任務原文未說清楚而攻略資料能確認時，可把有來源支持的具體條件寫清楚；不可把不確定的理解寫成確定條件。若仍無法確認，保留較窄的原意並標明限制，不自行補數字或編成。
- 任務目錄若只有空白佔位資料、沒有日文名稱與內文，也沒有可核對的 wiki 任務代號，就不可依 API 編號猜寫；保留執行時任務資料的原文回退，等取得可核對的日文來源再補譯。
- 任務導覽與 panel 共用 `utils/quest-catalog-localization.ts`、`utils/quest-catalog-translations.json` 與 `utils/quest-catalog-rewards.json`；任務獎勵以 wikiwiki 任務表為來源，固定資源與固定報酬分開顯示，「選択報酬」必須標成擇一選項，不可誤寫成全數取得。道具譯名先沿用專案既有艦名、裝備與消耗品詞庫，沒有收錄的名稱再以日文原名校訂台灣華語與英文。非日文介面的日文原文對照也要包含獎勵；兩個介面須顯示同一份資料。
- 任務提到海域時，保留玩家慣用的地圖編號（例如 `2-5`），並附上海域名稱；節點條件另保留節點編號或名稱。共用地圖格式化由 `utils/quest-catalog-localization.ts` 負責。
- 任務條件以遊戲日文任務原文為基礎，並優先查對 wikiwiki 的任務表與 Zekamashi 對應攻略；必要時再查該海域攻略。英文任務資料只能輔助理解，不可用來推翻日文任務表或上述攻略。將用到的來源網址登錄於 `THIRD-PARTY-NOTICES.md`。
- 不熟悉或有歧義的中文詞彙，先查教育部《重編國語辭典修訂本》，再依遊戲語境選詞；辭典用來確認詞義與詞形，不取代台灣遊戲社群用語校對。
- 修改可見文字後，至少核對 `zh-TW` 與英文畫面；固定寬度面板要留意較長字串是否溢出、遮蓋或遭裁切。

## 固定用語

| 用途 | 採用寫法 | 校對說明 |
|---|---|---|
| 任務遠征 | 遠征 | 依教育部辭典詞形及遊戲語境統一用語。 |
| 砲類裝備 | 主砲、副砲、高角砲、機關砲 | 裝備名稱維持遊戲慣用字形。 |
| 遊戲資源 | 鋼材 | 依遊戲資源名稱統一用語。 |
| 擊敗敵方艦艇 | 擊沉 | 依教育部辭典詞形及遊戲語境選用。 |
| 任務消耗物 | 消耗／被消耗 | 資源、道具及裝備會被消耗；「消滅」用於確實遭消滅的對象。 |
| 面板港口分頁 | 母港 | 與遊戲內港口畫面的稱呼一致。 |
| 進行中的任務 | 進行中 | 任務狀態採繁體中文介面用語。 |
| 開發用資源 | 開發資材 | 與遊戲內資源名稱一致。 |
| 船艦總稱 | 艦艇／艦隻 | 依句意選用明確稱呼。 |
| 航母類艦種 | 航空母艦、輕航空母艦 | 首次出現寫完整艦種；需要類別統稱時用「航空母艦級」。 |
| 裝備改修 | 改修星數、改修至★max | 以繁體中文說明改修程度。 |
| 勝利判定 | S勝利、A勝利以上、C勝利以上 | 沿用遊戲勝利等級名稱。 |

## 辭典查證

- [教育部《重編國語辭典修訂本》](https://dict.revised.moe.edu.tw/search.jsp?la=0&powerMode=0)
- [遠征](https://dict.revised.moe.edu.tw/dictView.jsp?ID=165383&la=0&powerMode=0)
- [砲](https://dict.revised.moe.edu.tw/dictView.jsp?ID=691&la=0&powerMode=0)
- [鋼材](https://dict.revised.moe.edu.tw/dictView.jsp?ID=70464&q=1&word=%E6%9D%90)
- [鋁土礦](https://dict.revised.moe.edu.tw/dictView.jsp?ID=67544&la=0&powerMode=0)（遊戲資源欄位採用「鋁土」）
- [消耗](https://dict.revised.moe.edu.tw/dictView.jsp?ID=106365&la=0&powerMode=0)、[消滅](https://dict.revised.moe.edu.tw/dictView.jsp?ID=106338&la=0&powerMode=0)
- [「擊沉」用例](https://dict.revised.moe.edu.tw/dictView.jsp?ID=93713&q=1&word=%E9%9A%BB)
- [飛彈](https://dict.revised.moe.edu.tw/dictView.jsp?ID=34148&la=0&powerMode=0)、[攻擊機](https://dict.revised.moe.edu.tw/dictView.jsp?ID=75025&la=0&powerMode=0)
