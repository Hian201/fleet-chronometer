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

/**
 * 「這個分頁正在跑艦これ」的比對範圍。**比 GAME_PAGE_MATCHES 窄**：後者是 content script
 * 的注入範圍／要索取的權限範圍，涵蓋整個 `play.games.dmm.com`（DMM 上的其他遊戲也在內），
 * 拿來判斷「遊戲是不是已經開著」會把別款遊戲的分頁誤認成艦これ，於是聚焦到錯的分頁。
 * app_id=854854 是舊入口的艦これ應用編號（見上方 GAME_URL 的改版說明）。
 */
export const GAME_TAB_MATCHES = [
    '*://play.games.dmm.com/game/kancolle*',
    '*://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854*',
];

/**
 * 比對一個 URL 是否符合某個 [match pattern](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)。
 *
 * 為什麼要自己實作：popup 必須在**點擊手勢的第一個呼叫**就送出 `permissions.request()`，
 * 中間不能 await 任何東西（會失去手勢資格），所以「目前分頁是不是遊戲頁」只能在點下去
 * 之前先查好、點擊當下同步判斷——沒有可用的非同步瀏覽器 API 可以在那個瞬間問。
 * 只支援本專案用得到的子集：scheme 為 `*`／`http`／`https`，host 支援 `*` 與 `*.` 前綴，
 * path 以 `*` 為萬用字元（比對對象含 query string，與瀏覽器行為一致）。純函式、無 chrome.*。
 */
export function matchesUrlPattern(url: string, pattern: string): boolean {
    const parts = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/.exec(pattern);
    if (!parts) return false;
    const [, scheme, host, path] = parts;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    const urlScheme = parsed.protocol.replace(/:$/, '');
    if (scheme === '*' ? urlScheme !== 'http' && urlScheme !== 'https' : scheme !== urlScheme) return false;
    if (host !== '*') {
        // `*.example.com` 依規格同時涵蓋 example.com 本身。
        const bare = host.startsWith('*.') ? host.slice(2) : null;
        if (bare === null ? host !== parsed.hostname
            : parsed.hostname !== bare && !parsed.hostname.endsWith(`.${bare}`)) return false;
    }
    const target = parsed.pathname + parsed.search;
    const source = path.split('*').map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`).test(target);
}

/** 這個 URL 是否落在劇場模式／拍照的可注入範圍（＝要索取的 optional host permission）。 */
export const isGamePageUrl = (url: string | undefined): boolean =>
    !!url && GAME_PAGE_MATCHES.some(pattern => matchesUrlPattern(url, pattern));

/** 這個 URL 是不是艦これ本身（單例判斷用，見 GAME_TAB_MATCHES）。 */
export const isGameTabUrl = (url: string | undefined): boolean =>
    !!url && GAME_TAB_MATCHES.some(pattern => matchesUrlPattern(url, pattern));

/**
 * 遊戲框本身（承載 kcsapi 流量的 iframe）的主機。bridge 就注入在這裡
 * （`*://*.kancolle-server.com/*`），故它也是劇場模式互動轉發的唯一合法來源。
 */
export const GAME_FRAME_HOST = 'kancolle-server.com';

/**
 * postMessage 的 `e.origin` 是不是遊戲框所在的伺服器。
 *
 * 為什麼不改用 `e.source === frame.contentWindow`：遊戲框中間可能還隔著 DMM 自己的
 * gadget 框，那時 bridge 的轉發是從**孫框**上來的，比對直接子框會把功能修壞
 * （Esc 離開整個失效）。origin 比對能擋掉「DMM 頁面上任何第三方框（廣告／追蹤）
 * 冒充轉發訊息去關掉視窗適應」，又不預設框架層數。
 */
export function isGameFrameOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === GAME_FRAME_HOST || host.endsWith(`.${GAME_FRAME_HOST}`);
}

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
 * 為什麼需要轉發：焦點落進遊戲框內時，鍵盤事件只送到框內文件，父頁收不到 Esc。
 * 目前只轉發 Esc 離開；滾輪縮放已移除（永遠 fit，縮放交給瀏覽器原生 Ctrl／⌘＋滾輪）。
 *
 * **一律 passive、絕不 stopPropagation／preventDefault**：遊戲仍會照常收到原本的事件。
 */
export const RELAY_MARK = '__kc_theater__';
export type TheaterRelayMessage =
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
