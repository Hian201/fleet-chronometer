# 劇場、靜音、獨立視窗、拍照與關頁警示

## 視窗適應（劇場模式）與遊戲靜音（`entrypoints/theater.content.ts`＋`utils/theater.ts`）

**需求**：把包在 DMM 網頁裡的遊戲畫面「彈出來」單獨顯示、滑鼠隨意縮放、隨時還原（DMM 的
點數儲值仍在原頁），**全程不重新整理**，外加靜音開關。

**不搬 iframe、不另開遊戲頁**：搬動 `<iframe>` 到另一個視窗或 Document PiP 會摧毀 nested
browsing context 並重新載入；另開或替換遊戲頁可能產生第二個遊戲執行個體。因此有兩種模式，
都不重新載入：**視窗適應**（劇場模式）讓遊戲框留在原位置，只貼標記屬性＋設 CSS 變數
（`transform`＋`clip-path`），離開時完全還原原頁；**獨立視窗**搬的是整個分頁（見下）。
視窗適應讓 KC3Kai 等 DevTools 面板維持嵌在同一視窗（獨立視窗中 DevTools 只能另開），兩種模式都要保留。

**DMM 遊戲網址**：舊的
`www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/` 現在 **302 導向登入頁**；實際遊玩頁
是 `https://play.games.dmm.com/game/kancolle`（200）。新頁是 **Vite + React 的 SPA**
（`<div id="root">`，遊戲框由 JS 動態插入、隨時可能重繪），**沒有任何可依賴的固定 id／class**，
而且沒有帳號就看不到登入後的真實 DOM。故：

- **遊戲框靠 src 主機名＋尺寸辨識**（`pickGameFrame()`）：先認 `kancolle-server.com`／
  `osapi.dmm.com`／`/gadgets/ifr`（確定證據），沒命中才取「夠大的那個」（≥400×300）；
  兩者皆無**回 null 不亂挑**——挑錯框會把 DMM 的廣告放大到整個視窗，比沒作用更糟。
  追蹤／分析框（googletagmanager 等）一律排除。
- **標記屬性＋外部樣式表，不寫 inline style 到 DMM 的元素上**（inline 要逐項記錄原值才
  還原得回去）；React 重繪把屬性洗掉後由 MutationObserver 重新貼標，新插入的廣告也會被
  補上隱藏標記。
- **不用 `position: fixed` 當主要手段**：祖先若有 `transform`／`filter`／`contain` 會變成
  containing block，fixed 就不再對齊視窗。改為「祖先鏈以外的東西藏起來、祖先鏈撐滿視窗」，
  對未知結構最不挑。

**框的層次（新入口，實機確認）**：`play.games.dmm.com` 頁面的直接子框是 DMM 的 gadget 框
`osapi.dmm.com/gadgets/ifr`，頁面上沒有任何 `kancolle-server.com` 的直接子框；遊戲框
（bridge 與 interceptor 所在）位於 gadget 框之內。證據是開發者 2026-11-10 在遊戲分頁最上層
console 執行 `[...document.querySelectorAll('iframe')].map(f => f.src)` 的輸出。gadget 框
以下的確切層數沒有列舉。

```text
DMM 頁面（play.games.dmm.com，劇場腳本）
  └─ gadget 框（osapi.dmm.com/gadgets/ifr，擴充不注入；含頁尾按鈕與白底）
       └─ 遊戲框（kancolle-server.com，bridge／interceptor）
```

**顯示的是「遊戲畫面」不是「整個 iframe」**：
劇場腳本縮放的是 gadget 框，框裡除了遊戲，還包著頁尾按鈕（作戦要綱／艦娘／用語…）與大片
白底，拿整個框去 fit 會讓遊戲縮得比視窗小、下方留一大條白，故以 `clip-path: inset(...)` 裁掉
其餘部分並把遊戲畫面置中（`framePlacement()`）。裁切矩形的來源依序為：

- **bridge 回報的 `canvas` bounding rect**：只信任「直接子框」的回覆
  （`e.source === frame.contentWindow`），因為別層框回報的座標基準不是被縮放的那個框，採用會
  歪掉。新入口的量測請求只送得到 gadget 框，那裡沒有 bridge，所以**這條路徑在新入口得不到
  回覆**；它只在遊戲框本身就是直接子框的版面生效。
- **`fallbackGameArea()`**：框內左上、寬度撐滿的 5:3 區域（使用者提供的實機畫面佐證），只有
  框確實比遊戲畫面高出一截才裁切，否則不裁。新入口實際走的是這條。
- 要在新入口取得精確畫布位置，得把 gadget 框的網域納入 optional origins，並以 `allFrames`
  注入一份只做「加上自身 iframe 偏移後往上轉發」的中繼。這會擴大權限範圍，在後備區域足夠
  準確的前提下不實作。
- `transform-origin` 固定 `0 0`、遊戲框強制 `display: block`：座標運算才是單純的
  `螢幕 = translate + zoom × 框內座標`，`50% 0` 之類的原點會讓「裁切後置中」變成兩層互相
  牽動的補償量（`tests/theater.test.ts` 有鎖這兩條）。

**工具列固定佔住底部一條，絕不覆蓋遊戲畫面**：滑鼠移到遊戲畫面上時事件全被 iframe 吃掉，
父頁無法依 hover 自動閃避，因此使用底部 `BAR_HEIGHT`（19px）的實體條，fit 計算一律扣掉它。
shadow CSS 裡 `button { display: inline-flex }` 是**作者樣式**，會覆蓋瀏覽器對 `[hidden]` 的
`display:none`（與 specificity 無關），因此必須明寫
`[hidden] { display: none !important }`。

**視窗縮放要自動跟著 refit**：
`fitMode` 預設開啟，resize 時重算縮放；**只有使用者親手縮放過（按鈕／滾輪）才脫離 fit**，
按「適應」再回來。工具列的「適應」鈕在 fit 模式下亮色，讓使用者知道現在會不會自動跟上。

**`fitZoom()` 固定使用 contain，不使用 cover**：畫面必須等比例完整可見，比例不合時保留
黑邊，不裁切內容。`enter()`／resize refit／「適應」鈕的視窗縮放路徑都經同一支
`fitZoom()`，任何「消除黑邊」的需求都得換別的手段（例如既有的 `fitWindow()`／
`MSG_THEATER_FIT_WINDOW` 改調整瀏覽器外框尺寸去貼合遊戲原生比例，而不是裁切畫面內容）。

**`enter()` 直接做「適應」的完整動作**：`enter()` 呼叫 `fitWindow()`（內部含
`applyTransform()`），會連帶調整瀏覽器外框尺寸去貼合遊戲原生比例、把黑邊縮到最小。
這樣「畫面完整、盡量沒有黑邊」在點下劇場模式的當下就一次到位。自動恢復劇場狀態（`stored.active`）
的啟動路徑同樣經過 `enter()`，故重新整理後自動回到劇場也會一併觸發，行為一致。
**已知殘留**：`enter()` 當下畫布可能還沒被精準量到（`gameRect` 為 null，`fitWindow()`
用 `fallbackGameArea()` 的 5:3 估計值計算視窗尺寸），稍後 `requestMeasure()` 量到精確值
只會重算 CSS 縮放（`applyTransform(true)`），不會重新觸發一次視窗尺寸調整——多數情況下
估計值夠準，殘留誤差頂多是一點點黑邊，不影響「畫面完整不裁切」這個第一原則。

**實跑驗證（playwright-core，`channel:"chrome"`，模仿 SPA 結構＋框內有頁尾白底的合成頁）**：
fit 依畫布而非整框計算（1000×700 視窗下 zoom=0.833＝1000/1200，非 0.72）、頁尾被 `inset`
裁掉、工具列在畫布下方不重疊、resize 自動 refit、手動縮放後 resize 不再改動、
連按放大／模擬 React 重繪（換掉頁首＋插入新廣告）／離開，全程 **iframe 內的
`window.__loadId` 完全不變 ＝ 沒有重新載入**；離開後標記歸零、`transform: none`、
頁首與廣告回復原位。

**滑鼠與鍵盤事件會被遊戲框吃掉**：一旦放大到蓋滿視窗，滾輪、拖曳與
Esc 全部落進框內文件，父頁**再也收不到**。解法分兩邊：

- 遊戲框內的 bridge 轉發 **Alt+滾輪**（縮放）與 **Esc**（離開）到 `window.top`；
  **一律 passive、不 stopPropagation／preventDefault**——遊戲照樣收到原本的事件，
  我們沒有改變遊戲行為（AGENTS.md 硬約束 1）。轉發內容只有互動意圖，不含任何遊戲資料。
- 工具列在**溢出視窗時才出現**四顆平移鈕。這不是裝飾：那種情況下工具列（Shadow DOM，
  事件必達）是唯一還能平移的手段。空白邊的拖曳平移保留，但只在有空白邊時有用。

**靜音以整個遊戲分頁為準**：background 以 `tabs.update({ muted })` 靜音含有遊戲框的分頁。
這是瀏覽器層級的靜音，涵蓋 BGM、語音與音效，不必知道遊戲用 WebAudio 還是 media 元素播音，
也不在遊戲頁包裝 `AudioContext` 或改寫 `HTMLMediaElement` 原型——MAIN world 不改動遊戲頁的
任何原生物件（`tests/interceptor-capture.test.ts` 把關）。代價是需要 `tabs` 權限，且 DMM 頁面
的聲音也一併靜音；不讀取分頁內容。
bridge 以 `PORT_MUTE` 長連線登記自己所在的分頁（連線不傳資料）：background 靠它知道要靜音
哪些分頁，連上時偏好若為靜音就立刻套用，故新開或重新載入的遊戲分頁不必再按一次。使用者
用瀏覽器的分頁選單自行解除靜音時，聲音會恢復而靜音鈕仍顯示靜音；再按一次靜音鈕即回到一致。
只靠分頁靜音的效果已由開發者實機確認（Edge／macOS，2026-11-10）。

**「靜音沒反應」的第一嫌疑是遊戲分頁沒有 F5**：content script 改動後必須重新注入，
而劇場模式是用 `executeScript` 立刻注入才會馬上生效，
interceptor／bridge **不會**——未重新注入的既有分頁沒有登記連線，popup 的靜音找不到對象，故
background 在靜音回覆裡附上 `connected`（目前連上的遊戲分頁數），popup 與劇場工具列在
`connected === 0` 時直接顯示「請在遊戲分頁按 F5」。劇場工具列送出的切換另以發送者分頁為
對象，連線尚未建立時仍能靜音。

**狀態存放**：靜音開關與語言鏡像存 `db.meta['game-page']`（`GamePageMetaRow`）——SW 沒有
localStorage，而 `chrome.storage` 要新增權限。語言的真相仍在擴充頁面的 localStorage
（`ui-prefs.ts`），這裡只是鏡像：劇場模式跑在 dmm.com，跨 origin 讀不到擴充頁面的
localStorage，讀不到鏡像時退回瀏覽器語言偵測。**這一列不參與投影、不引用任何 event id**，
故 `backup.ts` 的 `restoreMarker()` 會略過它（否則按過一次靜音就會讓備份還原判定為
「來源不明的既有資料」而被拒）。縮放倍率與「上次是否在劇場」存 DMM 頁自己的 localStorage
（`kc-theater`），不進 Dexie、不進備份。

**授權流程**：popup 的「劇場模式」→ `permissions.request()`（**必須是點擊手勢的第一個
呼叫**，先 await 別的事情會失去手勢資格）→ `scripting.registerContentScripts`
（`persistAcrossSessions`，日後開遊戲頁自動生效）→ 對當前分頁 `executeScript` 立即注入
（否則要使用者自己 F5）。已注入的分頁先試 `tabs.sendMessage` 切換，失敗才注入；
content script 另有 `__kcTheaterInstalled` 旗標防重複注入長出第二條工具列。

### 獨立視窗（popout）

**與視窗適應並存的第二個選項**：把**整個遊戲分頁**移進 `type:'popup'` 視窗（只有標題列＋唯讀
網址列），回來時再移回原視窗。上面「不搬 iframe」的禁令仍成立——這裡搬的是分頁
（`windows.create({ tabId, type:'popup' })`），與滑鼠把分頁拖成新視窗同一機制，文件與遊戲框
不重建，故不重新整理；DevTools 綁在分頁上，連線不受搬移影響。不需新增權限（`windows` API
免宣告）。popup 視窗的唯讀網址列是 Chromium 的安全設計，擴充無法隱藏。

- **流程**：popup 選單送 `MSG_THEATER_TOGGLE {mode:'popout'}` → 劇場 content script 量遊戲區、
  送 `MSG_POPOUT_OPEN` → background 記下原視窗 `{windowId, index}` 並搬分頁 → content script
  等 resize 後以 popup 實際外框差重新 `fitWindow()`。初始尺寸只用原視窗外框差估算。
- **回來**：工具列 ✕ 與 Esc 在獨立視窗中改為「回到原視窗」（`MSG_POPOUT_CLOSE`）。先
  `tabs.move` 回原視窗原位置（超出分頁數就放最後）；原視窗已關或搬不回去時改用
  `windows.create({ tabId, type:'normal' })` 接住分頁，同樣不重新整理。進獨立視窗前已在視窗
  適應就維持適應，否則完全還原 DMM 頁面。
- **狀態放 `sessionStorage`（`kc-popout`）**：跟著分頁走、F5 後仍在、關分頁即消失。F5 後先以
  `MSG_POPOUT_STATE` 確認分頁仍在 popup 視窗才恢復版面。獨立視窗中的進出**不寫** `kc-theater`，
  否則關掉獨立視窗後下次開遊戲會自動進入視窗適應。
- **比例鎖定（只在獨立視窗）**：擴充無法限制拖曳比例，故 resize 停止 350ms 後依變動較大
  的一軸算倍率（`lockedZoom()`，上限為螢幕可用區），再以帶 `zoom` 的 `MSG_THEATER_FIT_WINDOW`
  把視窗修成遊戲比例；拖曳中途不修正，以免跟滑鼠拉扯。一般視窗不做，因為那會改到其他分頁的版面。
- **DevTools 不能嵌入**：Chromium 只允許 DevTools 嵌入一般視窗，popup 視窗一律獨立開啟，擴充無 API 可改。
- **直接關閉 popup 視窗＝關掉遊戲分頁**：進入時提示講明，關頁警示照常生效。
- **實機確認（Edge／macOS）**：工具列 ✕ 從 popup 以 `tabs.move` 移回原視窗成功；
  原視窗已開的 DevTools（含 KC3Kai 面板）會隨分頁一起搬進獨立視窗，KC3Kai 在獨立視窗中持續收到資料。
- **捲動歸零**：`framePlacement()` 假設遊戲框版面原點在視窗 (0,0)，但 `overflow:hidden` 不會把
  已捲動的位置歸零；原頁面捲動過時，視窗適應與獨立視窗都會切掉部分遊戲畫面。`applyTransform()`
  一律先捲回原點，`enter()` 記下原捲動位置，`exit()` 還原。

## 拍照（`utils/screenshot.ts`＋`MSG_CAPTURE_TAB`）

只擷取「遊戲畫面」、不含 DMM 頁面其餘部分。入口有兩個：popup 選單的「拍照」與劇場模式
工具列的相機鈕（後者的 `.bar[data-mode="on"]` 底部條高度為
`BAR_HEIGHT=19`，見 `utils/theater.ts`；靜音與相機圖示鈕字級貼近列高以減少留白）。

**裁切矩形絕不重新推算一次**：兩個入口都呼叫 `theater.content.ts` 的
`measureScreenshotRect()`，它直接沿用劇場模式本身已經校準過的
`pickGameFrame`／`contentArea`／`fallbackGameArea`（`utils/theater.ts`）與跨源畫布量測
協定（向遊戲框內的 bridge 要 canvas rect），並用 `iframe.getBoundingClientRect().width /
frame.offsetWidth` 換算目前有效縮放——劇場模式開著、手動縮放過都算得對，因為
`getBoundingClientRect()` 本來就反映套用在 iframe 上的 CSS transform。量不到畫布時回傳
`rect: null`，呼叫端據此誠實回報「找不到遊戲畫面」，不猜一個矩形（同 `theater.notFound`
的既有原則）。popup 走 `MSG_SCREENSHOT_RECT` 訊息問正在跑（或臨時注入）的 content script；
劇場工具列的相機鈕就在同一支腳本裡，直接呼叫函式，不必繞一圈訊息。

**`tabs.captureVisibleTab()` 抓整分頁截圖，裁切用 `utils/screenshot.ts` 的
`cropRectPx()`（純函式，`tests/screenshot.test.ts` 覆蓋含邊界夾限）＋
`downloadCroppedScreenshot()`（Blob + 臨時 `<a download>`，同 overview 的
`downloadText` 手法，零額外權限）。兩個入口共用同一份，不各自實作一次。**

**截圖權限使用 `activeTab`**。劇場模式的 `optional_host_permissions`（dmm.com，用來注入
content script）不涵蓋 `captureVisibleTab()`；Chrome 官方文件規定該 API
**只認 `<all_urls>` 或 `activeTab` 兩者之一**，不認一般的 origin
host permission。`<all_urls>` 違反權限精簡（AGENTS.md 硬約束 7），改用 `activeTab`：manifest 裡
不顯示任何警告、不進 `host_permissions`，且只在使用者「呼叫擴充」（點圖示開 popup／
快捷鍵／右鍵選單）當下對「那個分頁」暫時授予，分頁換頁或關閉即失效——`tests/manifest.test.ts`
已更新斷言 `permissions` 含 `activeTab`。

**content script 沒有 `tabs` API**：抓截圖這步一律經 background 轉手
（`MSG_CAPTURE_TAB`，`entrypoints/background.ts`）；popup 本身雖有 `tabs` 存取權，仍走
同一條訊息而非直接呼叫——單一實作，兩邊的錯誤處理才不會分岔。`windowId` 由呼叫端帶（popup
知道自己查到的 tab），content script 呼叫時不必帶，background 改用
`sender.tab.windowId`（content script 的訊息一定帶 `sender.tab`）。

**已知未驗證的邊角**：`activeTab` 的授予由「呼叫擴充」的動作觸發，且只在該分頁未換頁期間
有效。popup 開啟必定觸發，因此 popup 的拍照鈕可用；劇場工具列的相機鈕屬於頁面內容點擊，
若劇場模式由 `stored.active` 自動恢復且該分頁尚未開過 popup，可能因未取得 `activeTab` 而
回報 `screenshot.failed`。

## 關閉分頁前警示（`entrypoints/bridge.content.ts`）

避免手滑關掉／重新整理／導覽離開正在進行出擊或遠征的分頁。標準 `beforeunload` +
`e.preventDefault()`，瀏覽器規格保證只要有一個 frame 取消就會跳原生「離開此網站？」對話框；
規格本身**無法區分**「關閉分頁」「重新整理」「離開網址」三者，也**無法自訂對話框文字**
（現代瀏覽器一律顯示自己的固定文字，`e.returnValue` 的內容只看真假值）。

**這是關鍵功能，不能靠使用者先授權才生效**：`beforeunload` 掛在
`bridge.content.ts`（遊戲框本身，kancolle-server.com），由 manifest 靜態注入；安裝當下、
零額外授權、零使用者互動就生效，涵蓋新舊 DMM 入口。

**已知代價，刻意接受**：跨源 iframe 掛 `beforeunload` 時，Chromium 可能在按「取消」後再次
顯示對話框；這是
Chromium 對「跨源 iframe 掛 `beforeunload`」的已知問題（社群回報，如
crbug.com/1119438）：跨源子框與分頁本身的關閉協商是分開處理的（Site Isolation 下通常落在
不同 renderer process），瀏覽器 UI 層可能各問一次。**兩害相權**：零權限、
可能跳兩次，優先於單次跳窗但需要先授權——跳兩次終究還是能擋下誤關，沒有保護才是真正的風險。

**只在「最外層」的 kancolle-server.com 框安裝**（`isOutermostGameFrame()`）：避免遊戲
內部若真有巢狀同源子框時各自掛一份、放大重複跳窗機率。判定靠讀 `window.parent.location`
會不會丟 `SecurityError`——讀得到代表 parent 跟自己同源（也是巢狀在遊戲裡的框），這裡不裝；
讀不到（跨源，通常是 DMM 頂層頁）才是最外層，才裝這份；`window===window.top` 時也視為
最外層（沒有 parent 可比較）。**這是防禦性寫法，不是雙跳問題的根本解**——上面那段已經
說明雙跳更可能源自跨源 frame 與分頁本身的 Site Isolation 協商，不是同源巢狀框重複掛載；
沒有實機證據顯示遊戲內部真的有巢狀同源框，這條只是零成本的保險。

## 視窗適應的實機驗證限制

版面邏輯以模仿 SPA 結構的合成頁在真實 Chrome 驗過；框的層次另有開發者提供的實機輸出
（見上方「框的層次」）。agent 沒有登入真正的 DMM 遊戲頁，下列項目仍無實機證據：

- gadget 框以下的確切層數，以及遊戲框內 `canvas` 的實際位置。
- 是否有祖先層級的 stacking context 造成版面偏移。
