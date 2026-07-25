# Privacy Policy — Fleet Chronometer

**Last updated:** 2026-07-25

This privacy policy applies to the **Fleet Chronometer** browser extension
(「航海鐘」／「クロノメーター」), a fan-made companion for KanColle
(艦隊これくしょん -艦これ-).

Contact for privacy questions: open an issue on the project repository, or
use the contact email listed on the Chrome Web Store listing.

---

## Summary

- The extension **does not upload** your data to any server operated by us.
- There is **no backend** and **no analytics / advertising / crash-reporting
  service** built into the extension.
- Game account credentials (`api_token`) are **stripped and never stored**.
- Data stays in **your browser’s local storage** (IndexedDB) on your device,
  unless **you** export a backup file to a folder you choose.

---

## What the extension does

Fleet Chronometer is a **passive** local tool. It observes network responses
that the KanColle game client already requests and receives in your browser,
then derives a local operational picture (fleets, expeditions, docking, battle
estimates, history views, and similar features).

It does **not**:

- log into the game for you;
- replay, modify, or send game API requests on your behalf;
- automate gameplay;
- transmit your game data to a remote service we operate.

---

## Data the extension processes locally

Depending on which game screens you visit while the extension is installed and
active, the extension may process, in your browser only:

| Category | Examples | Stored locally? |
|----------|----------|-----------------|
| Game API payloads (after sanitization) | Fleet composition, ship/equipment state, expedition/dock timers, battle results, map progress, materials | Yes — as event logs and derived records in IndexedDB |
| Account credentials in requests | `api_token`, `api_verno` | **No** — removed in the bridge layer before persistence or internal messaging |
| UI preferences | Language, theme, some view settings | Yes — typically `localStorage` on extension pages |
| Optional feature state | e.g. mute preference, Fit to Window zoom on the game page | Local only (`IndexedDB` meta and/or the game page’s `localStorage`) |
| Backups you export | JSON / HTML files you choose to save | Only if **you** write them to a folder (e.g. via the File System Access API). Those files are under **your** control (local disk, your cloud sync folder, etc.) |

We do not receive copies of the above unless you separately send them to us
(for example by attaching a file in a bug report).

---

## Permissions (why they exist)

Install-time permissions are limited to what the features need:

- **alarms** / **notifications** — remind you before expedition or docking
  timers complete (local notifications).
- **scripting** — inject optional page scripts (e.g. Fit to Window) after you
  grant site access.
- **activeTab** — take a screenshot of the current tab when **you** use the
  capture action (temporary access to that tab).
- **tabs** — mute/unmute the game tab when **you** toggle mute.

**Host access is empty at install.** Access to the DMM game page
(Fit to Window and related page features) is requested only via
**optional** host permissions when you click the relevant control — never
automatically on install.

---

## Network behavior

- The extension does **not** phone home.
- It does **not** upload events, fleets, screenshots, or backups to our servers
  (there are none).
- Optional features that talk to **your** machine only (e.g. writing a backup
  file you selected) do not transmit that file to us.
- If you use a third-party sync folder (for example Google Drive Desktop) for
  backups, that sync is governed by **that provider’s** privacy policy, not
  ours.

Chrome / the browser may still perform its own update checks for the
extension package through the Chrome Web Store; that is outside this
extension’s code.

---

## Data retention and deletion

- Local data remains until you clear the extension’s storage, remove the
  extension, or delete records using in-extension tools (for example backup
  restore rules, pruning, or clearing browser data for the extension).
- Uninstalling the extension removes its extension storage from the browser
  (subject to normal browser behavior).
- Exported backup files on disk are not deleted by uninstall; delete them
  yourself if you no longer want them.

---

## Children

The extension is not directed at children. Do not use it if you are not
allowed to use KanColle / the Chrome Web Store under applicable rules.

---

## Changes to this policy

We may update this policy when the extension’s data practices change. The
“Last updated” date at the top will be revised. Material changes that affect
Chrome Web Store disclosures will be reflected in the listing as required.

---

## Unofficial status

Fleet Chronometer is an unofficial fan project. It is not affiliated with,
endorsed by, or sponsored by DMM.com or Kadokawa Games. KanColle and all game
assets belong to their respective owners.

---

## 繁體中文摘要

- **不上傳**：沒有我們營運的後端；擴充不會把資料送到我們的伺服器。
- **被動擷取**：只觀察遊戲自己的流量，不重放、不修改、不代發請求。
- **token 不落地**：`api_token` 在存檔前剔除，永不保存。
- **資料在本機**：存在瀏覽器 IndexedDB／本機偏好設定；只有你主動匯出備份時，檔案才會寫到你指定的資料夾。
- **權限精簡**：安裝時不要求網站存取權；「視窗適應」等功能在你按下按鈕時才請求 DMM 遊戲頁權限。

完整條款以英文正文為準。

---

## 日本語要約

- **アップロードなし**：運営側のサーバーはなく、拡張機能がこちらへデータを送信することはありません。
- **受動的な観測のみ**：ゲーム自身の通信を観測するだけで、再送・改変・代理送信は行いません。
- **トークンは保存しません**：`api_token` は保存前に除去されます。
- **データは端末内**：ブラウザの IndexedDB 等に保存。バックアップは、あなたが選んだフォルダへ書き出す場合のみです。
- **権限は最小限**：インストール時にサイト権限は要求しません。「ウィンドウ適応」等はボタン操作時のみ DMM ページへのアクセスを要求します。

詳細は上記英文本文に従ってください。
