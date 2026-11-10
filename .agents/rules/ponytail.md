---
name: ponytail
description: >
  寫或改程式碼時的取捨階梯：用最少的新程式碼把整件事做完。本專案的輔助規則，
  從屬於 AGENTS.md；兩者不一致時以 AGENTS.md 為準。
license: MIT
---

# Ponytail：最小而完整的改動

本檔是 `AGENTS.md` 的輔助規則，只管「這次改動要寫多少程式碼」。硬約束、Live 遊戲安全、驗證方式、
回報格式、語言與註解規範一律依 `AGENTS.md`；本檔任何一句與它不一致時，以 `AGENTS.md` 為準。

原則：最好的程式碼是不必寫的程式碼。偷懶的對象是解法，不是理解問題，也不是把事情做完。

## 動手之前

先讀任務與它會碰到的程式碼，列出這次改動必須到達的每個地方。本專案容易漏掉的：

- 呼叫端、型別匯出，以及 `tests/` 裡直接比對原始碼或文件字串的測試。
- zh-TW、en、ja 三語文案（`utils/ui-i18n.ts`）與 `tools/preview/` 的離線預覽。
- `docs/engineering/` 對應主題檔、`THIRD-PARTY-NOTICES.md`、`docs/structure.html` 的版本錨點。
- 資料格式變更時的相容處理或遷移（備份、IndexedDB、匯入）。

再確認改動會不會破壞使用者的東西：會遺失或外洩的資料、會停止運作的呼叫端。以上是範圍；
沒人要求的額外功能不是。

## 階梯

由上往下，取第一個能完整解決問題的：

1. **需要存在嗎？** 沒人要求的功能、選項與彈性不做，用一行說明略過了什麼。需求模糊時先做能完成
   核心工作的最小版本。
2. **專案裡已經有了嗎？** 有就照周圍程式碼的用法重用。常見的：`utils/date-format.ts`、
   `utils/html-escape.ts`、`utils/csv.ts`、`utils/stype-label.ts`、`entrypoints/overview/lib.ts`
   的偏好讀寫與格式化函式。
3. **標準函式庫或平台原生功能做得到嗎？** 用它，除非專案已有自己的做法。專案的共用元件優先於
   原生元件；專案沒有時才用原生的，例如折疊用 `<details>`。
4. **已安裝的相依套件做得到嗎？** 用它。不為幾行程式碼新增相依套件，也不為省事新增 manifest 權限。
5. **能寫成一眼看懂的一行嗎？** 就寫一行。需要解讀的一行不算短。
6. **以上都不行**：寫能運作的最少程式碼。

## 規則

- 對解法偷懶，對改動本身不偷懶：任務需要的每個部分都要做完，包含被這次改動弄壞的呼叫端與測試。
- 不加沒人要求的抽象層、包裝、型別轉換、選項、設定、樣板或「以後會用到」的程式碼。保留既有的
  分層、介面與命名。
- 能刪就不要加，但只刪這次任務範圍內的東西。使用者資料、歷史紀錄、備份相容處理與遷移不在可刪之列。
- 知道改動必須碰到哪些地方之後，最短且能運作的 diff 最好。
- 修 bug 先 grep 被改函式的所有呼叫端，在共用處把根因修一次，不在每個呼叫端各補一個判斷。
- 搬移或合併的程式碼保留原有的錯誤處理與驗證。同名但行為不同的函式不合併。
- 兩個做法大小相同時，選邊界情況正確的那個。
- 新的非瑣碎邏輯（分支、迴圈、解析器、資料格式或安全相關路徑）要留一個 Vitest 測試；瑣碎改動不必。
- 有已知上限的捷徑，留一行繁體中文註解：`// 捷徑：<上限>；<何時該升級>`。

## 不可省略

`AGENTS.md` 的全部硬約束與「不可破壞的目前契約」、信任邊界的輸入驗證、防止資料遺失的錯誤處理、
安全措施、無障礙基本要求、三語排版核對，以及使用者明確要求的任何東西。使用者堅持要完整版本時
直接做，不再爭論。

## 回報

依 `AGENTS.md`「完成前回報」的格式，另外用一兩行寫出：略過了什麼、什麼沒檢查，以及使用者必須
知道的風險。

<!--
改寫自 ponytail（https://github.com/dietrichgebert/ponytail），依本專案規則調整並譯為台灣華語。

MIT License

Copyright (c) 2026 DietrichGebert

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
-->
