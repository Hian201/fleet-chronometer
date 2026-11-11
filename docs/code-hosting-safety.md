# 程式碼託管平台安全操作規範（GitHub／GitLab）

本檔規範 coding agent（Claude Code、Codex 等）代替開發者操作 GitHub、GitLab 這類程式碼託管平台時的界線。agent 使用的是**開發者本人的帳號與憑證**，平台的自動偵測無法分辨操作來自真人還是 agent；一旦被判定濫用，停權的是開發者的個人帳號，申訴可能要數週。

背景：2026-11 本專案的 GitHub 帳號在一連串 release 操作（push、移動 tag、編輯 release、替換附檔）後不久被停權，平台未告知原因。這些操作本身都合規，但說明了「合規」不等於「不會被自動系統標記」，所以以下規則比平台條款更保守。

## 1. 平台條款的硬性要求

| 來源 | 要求 |
|---|---|
| GitHub 可接受使用政策 §4 | 禁止自動化的過量大批活動、對伺服器造成過度負擔的自動化操作、自動按星或追蹤等排名操弄 |
| GitHub 服務條款 B | 帳號必須由真人建立；可另有一個免費「機器帳號」專門執行自動化，責任歸帳號主人；每人只能有一個免費個人帳號 |
| GitHub REST API 最佳實務 | 寫入請求（POST／PATCH／PUT／DELETE）逐一排隊、不併發，每次之間至少間隔 1 秒；不輪詢 |
| GitHub REST API 速率限制 | 內容建立一般上限每分鐘 80 次、每小時 500 次，網頁操作也計入；被限流仍持續請求可能導致封鎖 |
| GitHub 額外產品條款（Actions） | Actions 只能用於本 repository 的建置、測試、部署、發佈；不得挖礦、不得做與專案無關的運算或排程 |
| GitLab 可接受使用政策 | 不得過度負擔服務、反覆或系統性大量匯出資料、傳送垃圾訊息；GitLab.com 速率限制不給例外 |

## 2. agent 的操作分級

**可直接做（唯讀）**：`git status`／`log`／`diff`／`fetch`、讀取 release 或 issue、`gh`／`glab` 的查詢指令。即使唯讀，也不寫迴圈反覆查詢，不輪詢等待狀態變化。

**開發者要求時才做，每次一個批次**：
- 推送一般 commit。一個任務的 commit 累積好再推一次，不要每個 commit 推一次。
- 建立新的 rc tag，以及依 [發版流程](#4-發版流程) 建立或更新唯一的 Pre-release。

**每一次都要開發者明確同意，不得沿用先前的同意**：
- 任何 force push（分支或 tag）、刪除 tag／分支／release、改寫已推送的歷史。
- 上傳或替換 release 附檔。
- 開 issue、PR、留言，或任何會通知他人的操作（`@` 提及也算）。
- 修改 repository 設定、可見性、webhook、Actions、Pages。

**一律不做**：
- 帳號與安全設定：密碼、Passkey、兩步驟驗證、SSH key、token、OAuth 應用程式授權、建立帳號。
- 按星、追蹤、fork 他人專案，或任何排名或社群互動操作。
- 大量 API 呼叫、批次修改多個 repository、爬取平台內容。
- 新增 GitHub Actions／GitLab CI 來做與建置、測試、發佈無關的事（排程寄信、定時爬蟲、當作伺服器）。
- 把憑證（含遊戲 `api_token`）、DMM Cookie、個人信箱以外的帳號資料寫進 commit。

## 3. 節奏

- 對同一平台的寫入操作逐一執行，前一個完成並確認結果後才做下一個，之間至少間隔數秒，不在同一個指令裡串接多個寫入（例如 push、移 tag、編輯 release、上傳附檔一口氣做完）。
- 單一任務的寫入操作超過 10 次時，先停下來說明原因、問開發者。
- 不重試寫入失敗：遇到 403、429、`secondary rate limit`、「帳號被標記／停權」、登入一直被導回登入頁等訊息，**立刻停止所有對該平台的操作**，回報原始訊息給開發者，不換方式繞過。
- 不在短時間內反覆刪除再重建同一個 tag 或 release。

## 4. 發版流程

- 送審前每次更新打新的 annotated tag `v<版號>-rc.N`，推出後不移動、不 force push；商店過審後在核准的 commit 第一次建立 `v<版號>`。完整流程與 CHANGELOG 規則見 `CHANGELOG.md` 開頭。
- 永遠只留一個 Pre-release；附檔只放上傳商店的同一份 zip，同一版本不反覆上傳。
- release 說明不提第三方工具名，參考來源只登錄於 `THIRD-PARTY-NOTICES.md`。

## 5. 內容

- 單檔超過 5 MB、或新增任何二進位檔（zip、模型、執行檔、安裝包）前先問開發者。打包產物在 gitignore 的 `.output/`，不進版本庫。
- `samples/` 只放已去除帳號識別欄位的封包（見 AGENTS.md 硬約束 2）；新增樣本前確認沒有 `api_token`、提督 ID、暱稱。
- 遊戲素材與第三方內容依既有規則登錄來源；不新增來源不明的素材。

## 6. 對外連結

產品介紹頁（`site/`）與 Chrome 線上應用程式商店的首頁、隱私權政策、聯絡方式，**不得連到任何程式碼託管平台**；隱私權政策由 `PRIVACY.md` 建置在介紹頁的 `/privacy/`。託管平台若出問題，對外資訊不受影響，也避免把使用者導向可被檢舉的位置。

## 7. 目前的遠端設定

- `main` 追蹤 `origin/main`；`origin` 的 fetch 來源是 GitHub，push URL 同時設 GitHub 與 GitLab，`git push` 一次推兩邊。
- `gitlab` remote 只用於讀取或單獨對 GitLab 操作。
- GitLab 操作用 `glab`，GitHub 操作用 `gh`；兩者都依本檔分級。發版時兩邊各建一個 release，附同一份 zip。

## 參考來源

- GitHub Acceptable Use Policies：https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
- GitHub Terms of Service（B. Account Terms）：https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- GitHub Terms for Additional Products and Features（Actions）：https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features
- Best practices for using the REST API：https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- Rate limits for the REST API：https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitLab Acceptable Use Policy：https://handbook.gitlab.com/handbook/legal/acceptable-use-policy/
- GitLab.com rate limits：https://docs.gitlab.com/user/gitlab_com/rate_limits/
