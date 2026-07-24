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
> `panel_20260718.png` 等）版權屬 DMM／Kadokawa Games（艦隊これくしょん
> -艦これ-）；`KC3kai_sortie_log.png` 為 KC3Kai 專案介面截圖（供設計對照）；
> 這些僅作為開發期參照與文件說明使用，本專案不主張、也未曾主張其著作權。

---

## 1. 遠征需求資料 (Expedition requirement data)

- **用途**：`utils/expedition-data.ts` 的遠征成功／大成功條件、報酬資料。
- **來源**：poi-plugin-expedition — https://github.com/poooi/plugin-expedition
- **授權**：MIT License
- **版權**：Copyright (c) 2015 Yudachi

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
- **曾參照（現已不再散布其資產）**：開發期間曾短暫採用 ElectronicObserverEN
  （https://github.com/ElectronicObserverEN/ElectronicObserver ，MIT，
  Copyright (c) 2014 Andante）的 PNG 圖示作為過渡，並用其
  `ElectronicObserver.Core/Types/EquipmentIconType.cs` 確認 icon id 的語意對應
  （該對應為遊戲 API 的事實性資料）。**現行版本已全數換為原創 SVG，
  未散布該專案任何檔案**，保留此段僅為開發歷程的誠實記錄。

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
  關係**（同一字母可對到多條 edge）。本專案先後試過 ASCII 推算與編號排序兩種規則，
  皆被使用者提供的真實對照否證（見 `utils/map-node-letters.ts` 檔頭）。
- **更新方式**：重新下載上游 `edges.json` 覆蓋 `tools/map-edges/edges.json` 後重跑產生器；
  新活動海域在上游更新前會顯示原始編號，UI 已明講原因。

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

## MIT License 全文

上述第 1、2、5、6 項（及第 3 項曾參照的 ElectronicObserverEN）均採用 MIT License，
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
