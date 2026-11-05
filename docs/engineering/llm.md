# LLM 分析（`entrypoints/overview/sections/llm.ts`）

**權限邊界**：擴充不直接呼叫雲端 LLM API（api.openai.com／api.anthropic.com），
因為這需要新增網路權限；即使改用 `optional_host_permissions`＋執行期
`chrome.permissions.request()`（manifest 預設不變、只在使用者按下啟用時才跳一次原生
授權視窗、且僅限使用者填的那個網域）也仍是「新增」，違反本專案權限精簡的立場。
現行功能以三條不增加擴充網路權限的路徑提供分析：

1. **通用備份檔（主線）**：`buildFullReport()` 把提督/資源/四艦隊/基地航空隊
   （複用 `lib.ts` 的 `fleetMarkdown()`，與「艦隊全覽」分區共用同一段輸出，格式保證一致）
   ＋裝備改修方向摘要／依海域統計的出擊紀錄／遠征/工廠（建造·開發·改修）紀錄，整理成
   一份 Markdown。「複製完整報告」／「下載完整報告 (.md)」——純前端組字串＋既有的
   `downloadText`/`copyWithFeedback`，零網路、零權限。可直接貼進或上傳到任何主流
   LLM（Claude.ai／ChatGPT／Gemini…），資料出不出境完全由使用者決定要不要交出檔案。
   **報告摘要原則**：能預先計算的統計由擴充完成，不交給 LLM 從攤平的原始紀錄清單重算。
   出擊資料依海域分組：每個
   海域一行（次數/rank分布/大破次數/常見掉落/最近出擊時間），輸出行數只跟「去過幾個
   海域」成正比、不隨歷史筆數膨脹（查詢不設 limit，全量下去分組運算依然很輕量）；
   保留一份「最近 5 筆」純作時序參考，不作統計依據。裝備同理：**依種類（mst）彙總
   持有量＋改修分布**（例：「41cm連装砲：3個（★0×2 ★6×1）」），不逐顆列舉裝備實例
   （同款常見數十顆會很冗長）——這是回答「裝備改修方向」實際需要的最小必要形狀，
   資料來源是 `GameState.slotItems`（已公開欄位，排除 `consumableGearIds`），不依賴
   「裝備全覽」分區的 UI。**跟「資料備份與還原」的 JSON 是完全不同
   取捨**：JSON 那邊要的是精確可還原（保留每一筆原始紀錄／每一顆裝備實例），這裡
   要的是給 LLM 讀的精簡摘要——兩者故意不共用同一份輸出，混在一起會兩邊都不討好
   （JSON 為了精簡犧牲保真度、或報告為了保真度膨脹到爆 token）。
2. **MCP 掛載（純文件提示，非程式碼功能）**：UI 上一段說明——把下載資料夾指給支援
   MCP 的用戶端（例：Claude Desktop 設定檔加 `@modelcontextprotocol/server-filesystem`
   指向該資料夾）即可讓它直接讀取最新報告，不必每次手動上傳。**這整個流程發生在擴充
   之外**（另一支獨立行程，透過 stdio 跟 LLM client 對話 MCP protocol，讀寫的是使用者
   OS 帳號的檔案系統權限），擴充只做到「存檔」這一步就結束，不知道、也不參與後續——
   不影響本專案任何權限設定，故不需要、也沒有任何程式碼要寫。
3. **Chrome 內建 AI（Prompt API／Gemini Nano，實驗性）**：`entrypoints/overview/prompt-api.d.ts`
   宣告執行期用 `typeof LanguageModel !== 'undefined'` 特徵偵測的最小型別介面（官方文件
   已核對：`LanguageModel.availability()`／`.create({monitor})`／`session.prompt()`／
   `session.promptStreaming()`，見 2026-07 fetch 紀錄）。裝置端整段分析不連網路，同樣
   零權限零出境。**已知限制（務必保留提示文字，不要移除）**：
   - 官方語言清單目前僅列 en/ja/es/de/fr，**不含繁體中文**——本專案 UI 預設語言正是
     zh-TW，故對 zh-TW 內容的輸出品質無法保證，僅能 best-effort。
   - 裝置端 context window 較小，故這裡刻意只餵 `buildQuickContext()`（精簡摘要，非
     上面的完整報告）——避免超出額度；深入分析大量歷史紀錄請引導使用者改用完整報告
     交給雲端 LLM。
   - `promptStreaming()` 的分塊在不同 Chrome 版本可能是「目前為止的全文」或「只有新增的
     token」，且無法用特徵偵測分辨；`chunk.startsWith(acc) ? chunk : acc + chunk` 同時涵蓋
     兩種語意，避免輸出重複或遺漏。
