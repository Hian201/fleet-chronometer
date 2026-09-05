# 第三方開源資源聲明 (Third-Party Notices)

本專案使用或參照了以下第三方開源資源。相關檔案／邏輯的授權歸屬於各原作者，
以下一併列出出處與授權條款。

> **本專案自身授權**：程式碼採 MIT License，詳見根目錄 `LICENSE`；
> `public/icons/`／`public/icon/`／`tools/app-icon/` 的原創圖示與 App icon
> **不含在 MIT 授權範圍內**，另採版權所有、不開放複製散布，詳見根目錄
> `ASSETS-LICENSE`。
>
> **`samples/` 內的截圖與參考圖非本專案資產**：遊戲畫面截圖（如
> `Fleet_formation.png`／`ships.png`／`equips.png`／`kanmusu_filter.png`／
> 其他開發參考圖等）版權屬 DMM／Kadokawa Games（艦隊これくしょん
> -艦これ-）；`KC3kai_sortie_log.png` 為 KC3Kai 專案介面截圖（供設計對照）；
> 這些僅作為開發期參照與文件說明使用，本專案不主張、也未曾主張其著作權。

---

## 1. 遠征需求資料 (Expedition requirement data)

- **用途**：`utils/expedition-data.ts` 的遠征成功／大成功條件、報酬資料。
- **來源**：poi-plugin-expedition — https://github.com/poooi/plugin-expedition
- **授權**：MIT License
- **版權**：Copyright (c) 2015 Yudachi
- **補充來源（2026-08-03）**：id 41–46／103–105／112–115／131–133／141–142（poi 資料自
  2018 年後未再更新、缺這批遠征）的出擊條件，轉寫自 ElectronicObserver 的
  `MissionClearCondition.cs`——https://github.com/andanteyk/ElectronicObserver ，
  MIT License，Copyright (c) 2014 Andante。這批項目的實際收益數字
  （`reward_fuel/bullet/steel/alum`）取自 wikiwiki.jp/kancolle/遠征（日文「艦隊これくしょん
  -艦これ- 攻略 Wiki*」）的詳細一覧表，事實性數值（遊戲內建機制數字，非著作權標的），
  與 `samples/start2-master.json` 的 `api_win_item1/2`／`api_win_mat_level`（封包事實）
  逐筆交叉比對一致；`reward_items` 的道具種類同樣直接取自封包 `api_win_item1/2`。
  id 301／302（活動支援遠征）之出擊條件與零收益皆為封包事實，未使用外部資料。

## 1b. 遠征資源加成（大発動艇系裝備）機制數值

- **用途**：`utils/expedition-bonus.ts` 的裝備加成率表與公式（`遠征資源加成`功能，
  2026-08-03 新增）。
- **來源**：wikiwiki.jp/kancolle/遠征（`#daihatsu` 節）與 wikiwiki.jp/kancolle/特大発動艇
  （`#bonus` 節），直接讀取原始 HTML 逐字核對，非摘要轉述。
- **性質**：遊戲機制數值（裝備加成百分比、公式），屬事實性資訊非著作權標的，記錄來源供
  日後校對，非授權義務。

## 2. 戰鬥預測邏輯 (Battle prediction logic)

- **用途**：`utils/battle.ts` 的戰鬥階段重放與勝利判定（rank）邏輯，
  為參照其公開演算法重新實作（clean-room re-implementation, *inspired by* KC3Kai），
  並非原始碼逐字複製。
- **來源**：KC3Kai — https://github.com/KC3Kai/KC3Kai
- **授權**：MIT License
- **版權**：Copyright (c) 2015-2026 dragonjet

## 3. 裝備／資源圖示 (Equipment & resource icons) — 本專案原創，非第三方

`public/icons/equipment/*.svg`（檔名即 `api_slotitem.api_type[3]` 的 icon id，1–60）與
`public/icons/resource/*.svg`（燃/彈/鋼/鋁 及四種消耗資材）**為本專案自行繪製的向量圖，
不含任何第三方美術資產**，故不受第三方授權拘束；此節僅為記錄設計來源與參照，非授權義務。

- **設計藍本**：遊戲原圖的**構圖概念**（如大口径主砲＝大和級 46cm 三連装砲塔俯視、
  艦載機依真實機體輪廓＋右下角機種徽章），由本專案重新以幾何圖形描述，
  **非描圖（tracing）亦非任何既有圖示的改作**。
- **配色依據**：各裝備主色取自遊戲的既有色彩慣例（如主砲依口徑由 `#ff8080`→`#ff4040`→`#ff0000`、
  艦載機機身統一綠、徽章依機種著色）。色彩慣例屬事實性資訊，不構成著作權標的。
- **現行資產**：圖示由本專案以幾何圖形重新繪製為 SVG；icon id 的語意只依遊戲 API
  master 資料確認，不散布第三方圖示檔案。

---

## 4. 艦娘官方登場日資料 (Ship release dates)

- **用途**：`utils/ship-debut-data.ts`（由 `tools/ship-debut/generate.py` 從
  `samples/ship-debut-dates.json` 產生）——「艦娘全覽」顯示官方實裝日，並作為玩家
  手填「打撈上任日」的下限驗證。
- **性質**：**日期屬事實性資訊**（某艦於某日實裝），非著作權標的；資料由本專案維護者
  參照官方公告與公開図鑑資料自行彙整成表，**未複製任何第三方資料庫的檔案或結構**。
- **交叉驗證**：彙整結果與遊戲自身 `api_start2/getData` 的 `api_sortno`（図鑑番号）
  比對一致（番号 1–10 ＝長門/陸奥/伊勢/日向/雪風/赤城/加賀/蒼龍/飛龍/島風），
  兩個獨立來源互相印證。
- **註**：`samples/start2-master.json` 為遊戲自身回傳的 master 資料（全玩家相同的
  事實性遊戲資料），僅作為開發期驗證 fixture，非第三方著作。

---

## 5. 節點字母對照資料 (Map node letter data)

- **用途**：`utils/map-edge-letters.ts`（由 `tools/map-edges/generate.py` 從
  `tools/map-edges/edges.json` 產生）——出擊紀錄與面板把封包的**路線段（edge）id**
  顯示成攻略圈慣用的節點字母（A／B／…／ZZ）。
- **來源**：KC3Kai `src/data/edges.json` —— https://github.com/KC3Kai/KC3Kai
- **授權**：MIT License
- **版權**：Copyright (c) 2015-2026 dragonjet
- **散布內容**：`tools/map-edges/edges.json` 為原始檔的副本（取得日 2026-07-22）；
  產生物只保留「edge id → 終點字母」，**已捨棄原檔的起點欄位**。
- **為何非用不可**：字母不在任何遊戲封包裡（封包只給 edge 編號），且編號與字母**沒有可推導的
  關係**（同一字母可對到多條 edge）。因此必須使用上游 edge 對照資料；沒有對照的海域顯示
  原始編號，不從編號推算字母（見 `utils/map-node-letters.ts`）。
- **更新方式**：重新下載上游 `edges.json` 覆蓋 `tools/map-edges/edges.json` 後重跑產生器；
  新活動海域在上游更新前會顯示原始編號，UI 已明講原因。

---

## 5b. 渦潮燃彈扣減與基地空襲損失種別

- **用途**：`utils/maelstrom.ts`／`utils/maelstrom-data.ts`（渦潮查表＋電探減輕逐艦扣燃彈）；
  `utils/air-raid-lost-kind.ts`（`api_lost_kind` 1–4 文案對照）。
- **來源**：KC3Kai — https://github.com/KC3Kai/KC3Kai
  - 渦潮公式：`src/library/objects/Node.js#reduceFleetRscOnMaelstrom`（clean-room 重寫，
    *inspired by* KC3Kai，非逐字複製）
  - 渦潮比例表：`src/data/fud_weekly.json` 的 `maelstromLoss`（轉寫為 TypeScript 常數表）
  - lost_kind 文案：`Meta.airraiddamage`／遊戲畫面既有四段訊息（事實性語意對照）
- **授權**：MIT License
- **版權**：Copyright (c) 2015-2026 dragonjet
- **限制**：表外渦潮節點不猜不扣；連合艦隊 A／B 兩種電探計算法 KC3Kai 亦未完整處理，
  本專案同樣擱置（出擊中各隊合併計電探、合併扣減）。

---

## 6. 節點類型語意 (Map node event semantics)

- **用途**：`utils/map-node-kind.ts` 把 `api_event_id`／`api_event_kind` 對應成節點類型
  （資源獲得／渦潮／能動分歧／空襲戰／敵連合艦隊…），供出擊紀錄標示節點性質。
- **性質**：對應表描述的是**遊戲 API 的事實性語意**（某欄位的某個值代表哪種節點），
  非著作權標的；本專案自行以 TypeScript 撰寫，**未複製任何原始碼**。
- **參照來源**：航海日誌拡張版（Nishisonic/logbook，fork 自 nekopanda/logbook）的
  `main/logbook/dto/MapCellDto.java` `getNextKind()` —— https://github.com/Nishisonic/logbook
- **授權**：MIT License（`LICENSE.txt`）
- **版權**：Copyright (c) 2014-2015 ヒイラギ／Nekopanda ほか
- **交叉驗證**：`api_event_kind` 的三個值另有本專案樣本的獨立佐證（KC3Kai 匯出的
  `nodes[].desc` 與同一筆 `eventKind` 對得上：6＝空襲、5＝深海聯合艦隊、1＝一般戰鬥）；
  **沒有樣本佐證的值一律不對應**（回 null），見該檔案註解。

---

## 7. LZ-String URI 安全壓縮

- **用途**：`utils/lz-string-uri.ts` 把 KC3Kai battleplayer 可貼上的 JSON 編成
  `#fromLZString=` fragment，讓連合艦隊等較大重播能直接播放。
- **來源**：Pieroxy lz-string 1.4.4——https://github.com/pieroxy/lz-string
  與 KC3Kai kancolle-replay 內建的 `reader/lz-string.js` 同一版。只保留
  `compressToEncodedURIComponent`／`decompressFromEncodedURIComponent`。
- **授權**：WTFPL Version 2
- **版權**：Copyright (c) 2013 Pieroxy

```
DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
Version 2, December 2004

Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>

Everyone is permitted to copy and distribute verbatim or modified
copies of this license document, and changing it is allowed as long
as the name is changed.

DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

0. You just DO WHAT THE FUCK YOU WANT TO.
```

---

## 7b. LZMA-JS（模擬器設定備份壓縮）

- **用途**：`utils/sortie-simulator-settings.ts` 把模擬器可編輯設定編成
  `#backup=` fragment，與 KC3Kai kancolle-replay 的 Backup／分享網址同一契約。
- **來源**：Nathan Rugg lzma-js 2.3.2——https://github.com/LZMA-JS/LZMA-JS
  （npm 套件 `lzma`）。
- **授權**：MIT License
- **版權**：Copyright (c) 2016 Nathan Rugg

---

## 8. PNG alpha 藏字（steganography.js 演算法）

- **用途**：`utils/steganography.ts` 把 `toKc3Replay()` JSON 寫進出擊分享卡 PNG 的
  alpha，讓 KC3Kai battleplayer 的 Upload image 能解出同一份重播。
- **來源演算法**：Peter Eigenschink steganography.js v1.0.1——
  https://github.com/petereigenschink/steganography.js
  與 KC3Kai kancolle-replay 內建的 `reader/steganography.js` 同一套預設
  （t=3、threshold=1、codeUnitSize=16）。本專案只保留 ImageData 編解碼，無 DOM。
- **授權**：MIT License
- **版權**：Copyright (C) 2012, Peter Eigenschink

---

## MIT License 全文

上述第 1、2、5、5b、6、7b、8 項均採用 MIT License，
其條款內容相同，全文如下：

```
The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 各上游專案的完整原始版權檔請參閱其 repository 內的 `LICENSE`。
