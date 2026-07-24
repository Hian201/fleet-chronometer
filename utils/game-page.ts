// 遊戲頁（DMM）相關的共用常數與訊息型別：劇場模式 content script、bridge、background、
// popup 四邊都要用到同一組字串，集中一處避免各自打字。純常數，無 chrome.* 相依。

// DMM 的遊戲入口。**2026-07 已改版**：舊的
// `www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/` 現在 302 導向登入頁，
// 登入後的實際遊玩頁是 `play.games.dmm.com/game/kancolle`（Vite+React SPA，
// `<div id="root">`，遊戲框由 JS 動態插入）。舊路徑仍列在 matches 裡：它只是換了入口，
// 沒有證據顯示舊版版面已完全下線，而多一個 pattern 的代價只是授權對話框多一行。
export const GAME_URL = 'https://play.games.dmm.com/game/kancolle';

/**
 * 劇場模式 content script 的注入範圍＝需要向使用者索取的 optional host permission。
 * 只涵蓋「承載遊戲框的 DMM 頁面本身」，不含 kancolle-server.com（那邊早有靜態注入）。
 */
export const GAME_PAGE_MATCHES = [
    '*://play.games.dmm.com/*',
    '*://www.dmm.com/netgame/*',
];

/** 動態註冊時的 content script id（registerContentScripts／unregister 都用它）。 */
export const THEATER_SCRIPT_ID = 'kc-theater';
/**
 * 建置產物路徑。WXT 對 `registration: 'runtime'` 的 entrypoint 一樣輸出到
 * `content-scripts/<name>.js`，只是不寫進 manifest 的 content_scripts。
 * 路徑寫錯不會有型別錯誤，只會在執行期靜靜失敗——`tests/manifest.test.ts` 常駐核對檔案存在。
 */
export const THEATER_SCRIPT_FILE = '/content-scripts/theater.js';

// ── runtime 訊息 ──────────────────────────────────────
export const MSG_MUTE_GET = 'kc:mute-get';
/** popup →（已注入的）劇場模式 content script：切換劇場模式（`mode:'on'` 為強制進入）。 */
export const MSG_THEATER_TOGGLE = 'kc:theater-toggle';
/** 劇場工具列的「適應」：調整瀏覽器外框，讓內容區容納遊戲原始畫面與工具列。 */
export const MSG_THEATER_FIT_WINDOW = 'kc:theater-fit-window';

export interface TheaterFitWindowMessage {
    type: typeof MSG_THEATER_FIT_WINDOW;
    game: { width: number; height: number };
    barHeight: number;
    inner: { width: number; height: number };
    outer: { width: number; height: number };
}
export const MSG_MUTE_SET = 'kc:mute-set';
/**
 * popup →（已注入的）劇場模式 content script：量測「遊戲畫面」在**本分頁 viewport**
 * 座標系的絕對矩形（CSS px）＋該分頁的 devicePixelRatio，供拍照裁切用。
 *
 * 刻意不在 popup 自己重新推算遊戲畫面位置——劇場模式的裁切（`pickGameFrame`／
 * `contentArea`／`fallbackGameArea`＋跨源畫布量測協定）已經是踩過坑才校準對的邏輯，
 * 拍照的裁切矩形必須是同一套算法的產物，否則兩邊會漸漸長出不一致的「遊戲畫面在哪」。
 * 量不到遊戲框時回傳 `rect: null`，呼叫端據此誠實回報「找不到遊戲畫面」，不猜一個矩形。
 */
export const MSG_SCREENSHOT_RECT = 'kc:screenshot-rect';
export interface ScreenshotRectReply {
    rect: { x: number; y: number; width: number; height: number } | null;
    dpr: number;
}
/**
 * → background：抓整分頁截圖（`tabs.captureVisibleTab()`）。content script（劇場模式
 * 工具列的拍照鈕）沒有 `browser.tabs` 存取權，一律得經 background 轉手；popup 本身有
 * `tabs` 存取權但仍走同一條訊息，避免兩處各自呼叫、各自處理錯誤。`windowId` 未帶時
 * background 改用 `sender.tab.windowId`（content script 呼叫時 sender 帶得到）。
 */
export const MSG_CAPTURE_TAB = 'kc:capture-tab';
export interface CaptureTabMessage { type: typeof MSG_CAPTURE_TAB; windowId?: number }
export type CaptureTabReply = { dataUrl: string } | { error: string };
export const MSG_UI_LANG = 'kc:ui-lang';
/** 擴充頁面 → background：把目前語言鏡像進 db.meta，供 dmm.com 上的工具列讀取。 */
export const MSG_UI_LANG_SET = 'kc:ui-lang-set';
/** 遊戲框（kancolle-server.com）的 bridge 連上來拿靜音狀態的長連線名稱。 */
export const PORT_MUTE = 'kc:mute';

/**
 * 遊戲框 → 最上層 DMM 頁的 window.postMessage 轉發（跨源，只送互動意圖，不含遊戲資料）。
 *
 * 為什麼需要轉發：滑鼠一旦停在遊戲框上、或焦點落進框內（玩遊戲時的常態），滾輪與鍵盤
 * 事件就只送到框內文件，父頁的劇場模式完全收不到。實測（headless Chrome）確認：放大到
 * 超出視窗後，父頁再也收不到任何滾輪與 Esc。
 *
 * **一律 passive、絕不 stopPropagation／preventDefault**：遊戲仍會照常收到原本的事件，
 * 我們只是「順便看一眼」。修改遊戲收到的輸入等於改變遊戲行為，那是紅線。
 */
export const RELAY_MARK = '__kc_theater__';
export type TheaterRelayMessage =
    | { [RELAY_MARK]: 1; kind: 'wheel'; deltaY: number; deltaMode: number }
    | { [RELAY_MARK]: 1; kind: 'exit' }
    // 父頁 → 遊戲框：請回報遊戲畫布的位置與大小
    | { [RELAY_MARK]: 1; kind: 'measure' }
    // 遊戲框 → 父頁：畫布在框內視窗座標的矩形（父頁據此裁切並置中）
    | {
        [RELAY_MARK]: 1; kind: 'game-rect';
        rect: { x: number; y: number; width: number; height: number } | null;
        viewport: { width: number; height: number };
    };

/** bridge（ISOLATED）→ interceptor（MAIN）的同源 postMessage：靜音狀態。 */
export const MUTE_MARK = '__kc_mute__';
export interface MuteBridgeMessage {
    [MUTE_MARK]: 1;
    muted: boolean;
}
