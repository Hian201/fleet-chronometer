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

## 5a. 通常海域關名與作戰名（英文） (Normal map & operation names)

- **用途**：`utils/map-names.ts`——出擊紀錄「不記錄的海域」選單與任務導覽的海域標示共用的
  大區名與各關名。日文以 start2 `api_mst_mapinfo.api_name`／`api_opetext` 為準；台灣華語由本專案依
  `docs/translation-guidelines.md`「海域與關卡名稱」自行校訂，未使用外部譯文。
- **性質**：英文關名與作戰名是遊戲官方日文名稱的短譯，屬社群共用詞彙，不是單一專案獨有。同一批
  英文名同時見於 KC3Kai TsunDB-webpage、KC3Kai kc3-translations（MIT）、Electronic Observer EN
  翻譯資料、KanColle Wiki（CC BY-SA）等多個獨立專案。單一名稱屬通用名詞與短語（我國著作權法
  第 9 條第 1 項第 3 款「通用之符號、名詞」），本身不受著作權保護。本專案只逐關取用名稱短詞，
  表格結構、欄位與台灣華語譯名皆自行編製，未複製任何來源檔案的編排或其他內容。下列來源僅供
  追溯與致意，不是授權依據。
- **參考來源**（取得日 2026-10-02）：
  - KC3Kai TsunDB-webpage `src/data/mapNames.json` —— https://github.com/KC3Kai/TsunDB-webpage
  - KanColle Wiki（Fandom）Sortie 與 World 7 各關頁面 —— https://kancolle.fandom.com/wiki/Sortie
  - 大區名、2-1、2-2、4-1～4-4、5-6、7-4、7-5 由開發者依 Fandom 提供。
  - 作戰名（英文）：開發者手動查閱較新的 KanColle Wiki（https://en.kancollewiki.net ）提供全
    37 關；英文保留 wiki 慣用偽名，實際地名僅作附註。
- **日文作戰名核對**：wikiwiki.jp/kancolle 各大區頁（鎮守府海域…南西海域）的「作戦名」欄，
  直接讀原始 HTML 逐關比對，與 `api_mst_mapinfo.api_opetext` 37 關全數一致；表中日文仍以
  封包為準。
- **取捨**：兩邊都有時採 KC3Kai；KC3Kai 沒有或其日文關名與遊戲目前不同時採 Fandom／開發者
  提供的名稱。表中日文與 `samples/start2-master.json` 逐關一致，並以 `tests/map-names.test.ts`
  鎖定；遊戲改名後名稱不一致即不顯示譯名。

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

## 9. 裝備藍字加成表 (Equipment bonus table)

- **用途**：`utils/equip-bonus-table.json`（由 `utils/equip-ref.ts` 讀取）——情報總括「配裝參考」列出特定艦×裝備的藍字補正。
- **來源**：KC3Kai kancolle-replay `js/data/mst_slotitem_bonus.json`
  —— https://github.com/KC3Kai/kancolle-replay （對應 wikiwiki.jp/kancolle 裝備ボーナス）
- **授權**：MIT License
- **版權**：Copyright (c) 2015-2026 dragonjet
- **限制**：社群機讀表，**不是**遊戲封包驗證。UI 必須標明來源；欄位語意未以真封包核對者不自行命名或推導。

## 9b. 主砲命中適性（fit）表

- **用途**：`utils/equip-ref.ts` 的 `buildFitRules()`——配裝參考的晝戰命中項／過重。
- **來源**：wikiwiki.jp/kancolle「命中と回避」#BBfit，轉寫為以 start2 日文原名解析的裝備 id 與艦級條件。
- **性質**：遊戲機制數值（命中項），屬事實性資訊非著作權標的；Atlanta／大淀已從輕巡標準懲罰排除，避免與個別表疊加。未標 unverified 以外的新口徑不猜。

## 10. 任務導覽目錄

- **用途**：`utils/quest-catalog-data.ts`（由 `utils/quest-flow.ts` 讀取）——任務 `api_no`、週期、前置與開放邊，供情報總括任務導覽使用；`utils/quest-catalog-rewards.json`——任務資源、固定報酬與選擇報酬，供任務導覽和 panel 共用。
- **翻譯資料**：`utils/quest-catalog-translations.json` 的英譯及早期繁中對照參考 KC3Kai kc3-translations 的 `data/en/quests.json` 與 `data/tcn/quests.json`（commit `74b37f83b52df52bb4d76f62e4463603fcc7ec3a`）。`zh-TW` 文案由本專案以台灣華語重新校訂；上游資料只作對照，不作為台灣用語或任務條件的定稿依據。上游缺少的任務由本專案補譯。
  - 專案：https://github.com/KC3Kai/kc3-translations
  - 授權與版權：MIT License，Copyright (c) 2015-2021 KC3改。
- **來源**：
  - 任務獎勵 `utils/quest-catalog-rewards.json`：依 wikiwiki 任務總表及各任務分類表的獎勵欄整理；新任務與已封存的期間限定任務另查「新着任務」及「過去の期間限定任務」。資源數值沿用各欄位，其他獎勵保留固定／選擇分組；來源代號留在資料列供追查。
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E5%87%BA%E6%92%83%E4%BB%BB%E5%8B%99
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E7%B7%A8%E6%88%90%E4%BB%BB%E5%8B%99
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E6%BC%94%E7%BF%92%E4%BB%BB%E5%8B%99
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E9%81%A0%E5%BE%81%E4%BB%BB%E5%8B%99
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E5%B7%A5%E5%BB%A0%E4%BB%BB%E5%8B%99
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E6%96%B0%E7%9D%80%E4%BB%BB%E5%8B%99
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E9%81%8E%E5%8E%BB%E3%81%AE%E6%9C%9F%E9%96%93%E9%99%90%E5%AE%9A%E4%BB%BB%E5%8B%99
  - `utils/quest-catalog-reward-names.json` 的既有艦名、裝備名與消耗品譯名取自本專案 `samples/i18n/ship-names-i18n-player.csv`、`samples/i18n/equipment-names-i18n.csv` 及 `utils/item-catalog.ts`；未收錄的獎勵名稱由本專案依日文名稱撰寫台灣華語與英文對照。
  - 開放邊 `KC3_UNLOCKS_RAW`：KC3Kai 任務解鎖關係，只保留「前置 → 後續」的數字邊。
    https://github.com/KC3Kai/KC3Kai
  - 名稱、內文、wiki 代號、週期與前置清單：自社群任務目錄整理的事實欄位；來源網址不寫進資料檔。
  - 開放条件 `WIKI_QUEST_GRAPH_RAW`（`utils/quest-graph-data.ts`）：由 `tools/quest-graph/generate.py` 解析 wikiwiki 任務總表「開放条件/備考」欄產生，只保留前置 `api_no`、AND／OR 組合與【検証中】等驗證旗標，不收錄頁面文字。只在開發者更新任務資料時手動執行，一次一個請求；擴充執行時不連網。
    https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99
  - 前提／後續 `ZEKAMASHI_QUEST_GRAPH_RAW`（同檔）：同一產生器解析ぜかまし各任務攻略「前提に…あり。後続に…あり。」敘述，只保留任務 `api_no` 關係與「要確認」「他不明」等註記旗標，不收錄文章內容。頁面快取於 `tools/quest-graph/.cache/`（不進 git），之後只重抓 sitemap lastmod 有變動或新發表的文章，請求間隔至少 2 秒。
    https://zekamashi.net/
  - 前置 `QUEST_PLANNER_GRAPH_RAW`（同檔）：同一產生器讀取 poi-plugin-quest-planner 固定 commit（`8b18557b8c19e4d3caa8ff08b6d129c20da825ba`）的 `data/quests.json`，只保留 `dependencies` 的任務 `api_no` 與期間限定前置代號，取代目錄裡同源（kcQuests）的舊版 poi 前置。
    https://github.com/RikaKagurasaka/poi-plugin-quest-planner
    授權與版權：MIT License，Copyright (c) 2026 Rika。
  - 單發任務樹 `TSUKINOHASHI_QUEST_GRAPH_RAW`（同檔）：同一產生器解析艦これ単発任務マネージャ `main.js` 的任務連線與各任務說明開頭的紅字前置，只保留任務 `api_no` 關係；只在其他來源衝突時作為額外引用與投票，不推翻沒有衝突的結果。
    https://tsukinohashi.com/mission-manager
  - 前置 `KCWIKI_QUEST_GRAPH_RAW`（同檔）：同一產生器解析舰娘百科任務總表的「前置」欄（只抓總表一頁並快取；該站 robots.txt 為 Crawl-delay 100），只保留任務 `api_no` 關係與「待验证」等旗標，不收錄頁面文字。poi／kcQuests 的前置由此站抽出，兩者計票時合為一票。
    https://zh.kcwiki.cn/wiki/%E4%BB%BB%E5%8A%A1
    網站內容授權：知识共享署名-非商业性使用-相同方式共享（CC BY-NC-SA）；本專案只取任務關係事實。
  - 代號與名稱補齊 `QUEST_CATALOG_SUPPLEMENT_RAW`（同檔）：目錄有 `api_no` 卻缺 wiki 代號或名稱的任務（例：1020＝2409B1），由上述 kc3-translations 同一 commit 的 `data/jp/quests.json` 補上。
- **攻略事實核對**：任務條件以遊戲日文任務原文為基礎，優先查對 wikiwiki 任務表及 Zekamashi 對應攻略；必要時參考 wikiwiki 或 Zekamashi 的海域攻略。英文任務資料只供輔助比對，不得推翻日文任務表或上述攻略。僅整理艦種、艦名、編成位置、數量、海域、節點與勝利條件等事實，文案由本專案自行撰寫。
  - https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99
  - https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E5%87%BA%E6%92%83%E4%BB%BB%E5%8B%99
  - https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E7%B7%A8%E6%88%90%E4%BB%BB%E5%8B%99
  - https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E6%BC%94%E7%BF%92%E4%BB%BB%E5%8B%99
  - https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E3%82%B1%E3%83%83%E3%82%B3%E3%83%B3%E3%82%AB%E3%83%83%E3%82%B3%E3%82%AB%E3%83%AA%E4%BB%BB%E5%8B%99
  - https://wikiwiki.jp/kancolle/%E9%8E%AE%E5%AE%88%E5%BA%9C%E6%B5%B7%E5%9F%9F/1-6
  - https://wikiwiki.jp/kancolle/%E5%8C%97%E6%96%B9%E6%B5%B7%E5%9F%9F/3-5
  - https://wikiwiki.jp/kancolle/%E5%8D%97%E8%A5%BF%E8%AB%B8%E5%B3%B6%E6%B5%B7%E5%9F%9F/2-2
  - https://wikiwiki.jp/kancolle/%E5%8D%97%E6%96%B9%E6%B5%B7%E5%9F%9F
  - https://zekamashi.net/kancolle-kouryaku/yonsuisen-zyunbi/
  - https://zekamashi.net/kancolle-kouryaku/1-3/
  - https://zekamashi.net/kancolle-kouryaku/3-5/
  - https://zekamashi.net/kancolle-kouryaku/akashi-goei/
  - https://zekamashi.net/kancolle-kouryaku/kaiboukan-mamoru/
  - https://zekamashi.net/kancolle-kouryaku/kuma-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/hamanami-tekityuu/
  - https://zekamashi.net/kancolle-kouryaku/haguro-penang/
  - https://zekamashi.net/kancolle-kouryaku/noshirokaini-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/seiei-sisihunzin/
  - https://zekamashi.net/kancolle-kouryaku/yonkousen-zenryoku/
  - https://zekamashi.net/kancolle-kouryaku/yamakaze-batubyou/
  - https://zekamashi.net/kancolle-kouryaku/inagikaini-batubyou/
  - https://zekamashi.net/kancolle-kouryaku/sanzyuuniku-tukizisentousyoukai/
  - https://zekamashi.net/kancolle-kouryaku/soubi-kaisyuu-syuutyuu/
  - https://zekamashi.net/kancolle-kouryaku/soubi-kaisyuu-2/
  - https://zekamashi.net/kancolle-kouryaku/kaiboukan-sinpatu/
  - https://zekamashi.net/kancolle-kouryaku/2026syoka-kousyouseiri/
  - https://zekamashi.net/kancolle-kouryaku/2-5/
  - https://zekamashi.net/kancolle-kouryaku/1yb3h-tekityuutoppa/
  - https://zekamashi.net/kancolle-kouryaku/daikyuusentai/
  - https://zekamashi.net/kancolle-kouryaku/tamokutekitousaibokan-kitakamikaisan/
  - https://zekamashi.net/kancolle-kouryaku/kisonsoubi-taikuuheisoukaihatu/
  - https://zekamashi.net/kancolle-kouryaku/kaizyouhokyuusen-kakuho/
  - https://zekamashi.net/kancolle-kouryaku/sigurekaisan-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/syoka-seieikidoubutai/
  - https://zekamashi.net/kancolle-kouryaku/hayanami-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/hubukikaisan-batubyou/
  - https://zekamashi.net/kancolle-kouryaku/hiryuukaisan-sippuudotou/
  - https://zekamashi.net/kancolle-kouryaku/akizukikaini-suisan/
  - https://zekamashi.net/kancolle-kouryaku/tamanami-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/senryakuheitan-yusou/
  - https://zekamashi.net/kancolle-kouryaku/senryakuheitan-kakutyou/
  - https://zekamashi.net/kancolle-kouryaku/nansei-kiti/
  - https://zekamashi.net/kancolle-kouryaku/hisendan-yawatamaru/
  - https://zekamashi.net/kancolle-kouryaku/1-6/
  - https://zekamashi.net/kancolle-kouryaku/kiyosimokaini-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/hayasimokaini-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/ukurugata-bouei/
  - https://zekamashi.net/kancolle-kouryaku/nitouyusoukan-unnyou/
  - https://zekamashi.net/kancolle-kouryaku/yusousendangoeibutai-syutugeki/
  - https://zekamashi.net/kancolle-kouryaku/2026syoka-suizyoudageki/
  - https://zekamashi.net/kancolle-kouryaku/bay-batubyou/
  - https://zekamashi.net/kancolle-kouryaku/yuudati-harusame/
  - https://zekamashi.net/kancolle-kouryaku/daikyuusentai-zensen/
  - https://zekamashi.net/kancolle-kouryaku/tamokutekitousaibokan-kitakamikaisan/
  - https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E6%9C%9F%E9%96%93%E9%99%90%E5%AE%9A2
  - https://wikiwiki.jp/kancolle/%E9%8E%AE%E5%AE%88%E5%BA%9C%E6%B5%B7%E5%9F%9F/1-1
  - https://wikiwiki.jp/kancolle/%E4%B8%AD%E9%83%A8%E6%B5%B7%E5%9F%9F/6-4
  - https://wikiwiki.jp/kancolle/%E6%97%A9%E9%9C%9C%E6%94%B9%E4%BA%8C
  - https://wikiwiki.jp/kancolle/%E4%BB%BB%E5%8B%99/%E6%96%B0%E7%9D%80%E4%BB%BB%E5%8B%99
- **海域標籤與編號對照**：依各海域介紹核對海域名稱、地圖編號與世界範圍；多階段地圖另保留攻略慣用的關卡編號。
  - https://zekamashi.net/kancolle-kouryaku/tinzyuhu-kaiiki/
  - https://zekamashi.net/kancolle-kouryaku/nanseisyotou-kaiiki/
  - https://zekamashi.net/kancolle-kouryaku/hoppou-kaiiki/
  - https://zekamashi.net/kancolle-kouryaku/seihou-kaiiki/
  - https://zekamashi.net/category/kancolle-kouryaku/nanpou-kaiiki/
  - https://zekamashi.net/kancolle-kouryaku/tyuubu-kaiiki/
  - https://zekamashi.net/kancolle-kouryaku/nansei-kaiiki/
- **授權**：任務譯文沿用 KC3Kai kc3-translations 的 MIT License；開放邊沿用 KC3Kai 的 MIT License（見下方全文）。
- **版權**：KC3Kai 部分 Copyright (c) 2015-2026 dragonjet。任務名稱與內文屬遊戲原文（DMM／Kadokawa），本專案不主張其著作權。
- **限制**：不是封包驗證。週期只用來判斷本機領獎是否仍屬本期；年任開始月未進目錄，不對齊年度。

## 11. 任務進度條件表 (Quest goal data)

- **用途**：`utils/quest-goal-data.ts`（由 `tools/quest-goal/generate.py` 產生）的逐任務進度條件：
  計數事件、海域、節點 edge、旗艦／僚艦／艦種／艦級等篩選與所需次數。只收錄結構化條件，
  不收錄原說明文字。
- **來源**：poi — https://github.com/poooi/poi 的 `assets/data/fcd/questgoal.json`，
  固定 commit `013c81dc0a8725ab0b3e1af89830f9c3ee2efa52`（資料版本 2026/09/15/02）。
- **判定邏輯**：`utils/quest-goals.ts` 依該專案 `skills/quest-goal-data/SKILL.md` 記載的欄位語意
  （艦娘 id 表示該改造階段以後、僚艦條目的 OR／AND 與是否含旗艦、mapcell 為 edge 編號等）
  由本專案自行實作，未複製其程式碼。
- **授權**：MIT License
- **版權**：Copyright (c) 2015-2021 poi contributors

---

## 先制對潛條件

- **來源**：wikiwiki.jp/kancolle「対潜攻撃」的「対潜先制爆雷攻撃／発動条件」表與補充說明，核對日期 2026-10-01。
  https://wikiwiki.jp/kancolle/対潜攻撃#oasw
- **用途**：`utils/opening-asw.ts` 自行實作艦型、改造階段、顯示對潛值與原始裝備對潛值的條件判定；未複製第三方程式碼或頁面文字。艦與裝備 ID 以本專案真實 start2 樣本核對。遊戲不提供資格旗標，因此介面標為推算。

---

## MIT License 全文

上述第 1、2、5、5b、6、7b、8、9、10、11 項均採用 MIT License，
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
