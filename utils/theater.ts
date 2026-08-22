// 視窗適應（把 DMM 頁面裡的遊戲框等比填滿瀏覽器視窗）的**純函式核心**：
// 遊戲框辨識、fit 幾何、注入用 CSS 產生器。無 chrome.*、無 DOM 型別依賴
// （只吃 `{src,width,height}` 這種最小形狀），故可用 node 直接測（CLAUDE.md 設計原則 4）。
// UI 不暴露手動縮放／平移；`zoomByWheel`／`clampPan` 等僅供幾何／測試使用。
//
// 為什麼需要這一層：DMM 遊戲頁已改版為 `play.games.dmm.com/game/kancolle`，是 Vite+React
// 的 SPA（`<div id="root">` 由 JS 動態插入遊戲框），**DOM 結構沒有任何可依賴的固定 id
// 或 class**，而且我們無法在沒有帳號的情況下取得登入後的真實 DOM。故辨識一律走
// 「src 主機名＋尺寸」這種與版面實作無關的證據，且必須能在 React 重繪後重新套用。

/** 遊戲框候選（DOM 的最小抽象：跨源 iframe 的 src 屬性在父頁一律讀得到）。 */
export interface FrameCandidate {
    src: string;
    width: number;
    height: number;
}

/**
 * 辨識規則：`host` 比對**解析後的主機名**（精確或子網域後綴），`path` 比對 pathname 前綴。
 *
 * **只能對解析後的主機名與路徑比對**：`https://attacker.example/ad?ref=
 * kancolle-server.com` 這種 URL 不得命中「確定證據」那一層，避免惡意頁面把自己的框
 * 冒充成遊戲框、被放大到整個視窗，連拍照裁切矩形都跟著算到它身上。
 */
interface FrameRule { host?: string; path?: string }

// 已知會承載遊戲的主機／路徑。舊入口（www.dmm.com/netgame/social/…）走
// `osapi.dmm.com/gadgets/ifr`，新入口（play.games.dmm.com）的中間層尚未實測，
// 故一律以「kancolle-server 或 DMM gadget」為第一優先，其餘退回尺寸啟發式。
const GAME_FRAME_HINTS: FrameRule[] = [
    { host: 'kancolle-server.com' },
    { host: 'osapi.dmm.com' },
    // gadget 路徑只在 DMM 自己的主機上才算證據，否則任何站台放個 /gadgets/ifr 就能冒充。
    { host: 'dmm.com', path: '/gadgets/ifr' },
];
// 明確排除的追蹤／廣告框：它們常是 0×0 或隱藏，但尺寸啟發式仍可能誤中。
// `/ns.html` 是 GTM 的 noscript 框，不限主機——這裡多排除只會少挑一個候選，方向是安全的。
const NEVER_GAME: FrameRule[] = [
    { host: 'googletagmanager.com' },
    { host: 'doubleclick.net' },
    { host: 'google-analytics.com' },
    { path: '/ns.html' },
];
// 尺寸啟發式的下限：遊戲框（Flight-IIA 為 1200×720 級距）遠大於任何裝飾用 iframe。
const MIN_GAME_WIDTH = 400;
const MIN_GAME_HEIGHT = 300;

interface FrameLocation { hostname: string; pathname: string }

/** 解析框的 src。**解析不出來（相對路徑、about:blank、空字串…）一律當不可用，不猜。** */
function frameLocation(src: string): FrameLocation | null {
    let url: URL;
    try {
        url = new URL(src);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { hostname: url.hostname.toLowerCase(), pathname: url.pathname.toLowerCase() };
}

/** 主機名比對：精確相同或其子網域；`evil-kancolle-server.com` 這種同尾綴別的網域不算。 */
function hostMatches(hostname: string, host: string): boolean {
    return hostname === host || hostname.endsWith(`.${host}`);
}

function ruleMatches(location: FrameLocation, rule: FrameRule): boolean {
    if (rule.host !== undefined && !hostMatches(location.hostname, rule.host)) return false;
    if (rule.path !== undefined && !location.pathname.startsWith(rule.path)) return false;
    return rule.host !== undefined || rule.path !== undefined;
}

/**
 * 從頁面上的 iframe 候選裡挑出遊戲框。
 * 先看主機名（確定證據），沒有命中才用「夠大的那個」（啟發式）；兩者皆無則回 null，
 * **絕不亂挑一個**——挑錯框會把 DMM 的廣告框放大到整個視窗。
 */
export function pickGameFrame<T extends FrameCandidate>(candidates: readonly T[]): T | null {
    const usable: { candidate: T; location: FrameLocation }[] = [];
    for (const candidate of candidates) {
        const location = frameLocation(candidate.src);
        if (!location) continue;
        if (NEVER_GAME.some(rule => ruleMatches(location, rule))) continue;
        usable.push({ candidate, location });
    }
    type Entry = (typeof usable)[number];
    const byArea = (a: Entry, b: Entry) =>
        b.candidate.width * b.candidate.height - a.candidate.width * a.candidate.height;
    const hinted = usable.filter(e => GAME_FRAME_HINTS.some(rule => ruleMatches(e.location, rule)));
    if (hinted.length) return hinted.sort(byArea)[0].candidate;
    const big = usable.filter(e =>
        e.candidate.width >= MIN_GAME_WIDTH && e.candidate.height >= MIN_GAME_HEIGHT);
    return big.length ? big.sort(byArea)[0].candidate : null;
}

// ── 縮放幾何 ──────────────────────────────────────────
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** 按鈕用的固定級距；滾輪另走連續倍率。 */
export const ZOOM_STEP = 1.25;

export function clampZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) return 1;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 滾輪一格的倍率：deltaY 向上（負）放大。用倍率而非加法，縮小時才不會愈來愈鈍。 */
export function zoomByWheel(zoom: number, deltaY: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(zoom);
    // deltaMode 差異（像素／行）交由呼叫端正規化；這裡只看方向與量級上限，
    // 避免觸控板的高頻大 delta 一次跳到底。
    const magnitude = Math.min(Math.abs(deltaY), 120) / 120;
    const factor = Math.exp(-Math.sign(deltaY) * magnitude * 0.35);
    return clampZoom(zoom * factor);
}

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

/**
 * 實際要顯示的「畫面」＝遊戲框內部的遊戲畫布區域（`content`），不是整個 iframe。
 *
 * DMM 的遊戲框除了遊戲，還包著頁尾按鈕與大片白底，拿整個 iframe 去 fit 會讓遊戲縮得
 * 比視窗小、下方留一大條白。遊戲畫布的位置只有框內的
 * content script 量得到（跨源），量到才裁；量不到就退回整個 iframe（誠實地不猜）。
 */
export function contentArea(frame: Size, content: Rect | null): Rect {
    if (!content || content.width <= 0 || content.height <= 0) {
        return { x: 0, y: 0, width: frame.width, height: frame.height };
    }
    return content;
}

/**
 * 使用者提供的實機畫面證實：遊戲畫面固定從框內左上角開始，比例為 1600×960（5:3）；
 * 後方才是「作戰要綱／艦娘／用語…」按鈕與白底。canvas 量測因跨框架或遊戲載入時機失敗時，
 * 以這份可見畫面證據作為保守後備，只有框確實比遊戲畫面高一截才裁切。
 */
export const GAME_SCREEN_ASPECT = 5 / 3;
export function fallbackGameArea(frame: Size): Rect | null {
    if (frame.width <= 0 || frame.height <= 0) return null;
    const height = frame.width / GAME_SCREEN_ASPECT;
    // 沒有足夠明顯的框外內容就不猜；這也涵蓋本來就只有 1200×720 遊戲畫面的情況。
    if (frame.height - height < 24) return null;
    return { x: 0, y: 0, width: frame.width, height };
}

/**
 * 「適應視窗」：畫面完整可見、等比例呈現——取兩軸較嚴格者（`Math.min`，同 CSS
 * `object-fit: contain`），比例跟視窗不同時寧可留黑邊，也絕不裁掉畫面的任何一部分。
 *
 * 黑邊是可接受的代價，裁掉任何一部分畫面不是；
 * 兩者互斥時（視窗比例跟遊戲畫面比例不同時必然互斥）一律選前者。
 */
export function fitZoom(viewport: Size, area: Size, padding = 0): number {
    if (area.width <= 0 || area.height <= 0) return 1;
    const w = Math.max(0, viewport.width - padding * 2);
    const h = Math.max(0, viewport.height - padding * 2);
    return clampZoom(Math.min(w / area.width, h / area.height));
}

/**
 * 視窗大小改變時，保留使用者相對於「適應」的手動倍率。
 * 例如原本適應是 80%、使用者放大到 100%（1.25 倍），新視窗的適應若變成 96%，結果就
 * 應是 120%，而不是死守舊的 100% 造成黑邊。無法得知舊適應值時保守維持原倍率。
 */
export function resizeZoom(zoom: number, previousFit: number, nextFit: number): number {
    if (!Number.isFinite(previousFit) || previousFit <= 0 || !Number.isFinite(nextFit) || nextFit <= 0) {
        return clampZoom(zoom);
    }
    return clampZoom(zoom * nextFit / previousFit);
}

export interface Pan { x: number; y: number }

/**
 * 平移量夾限：只有「放大到超出視窗」的那個軸才允許平移，且不得把畫面拉到只剩空白。
 * 未超出時強制回 0——否則使用者不小心拖一下，遊戲就飄到角落找不回來。
 */
export function clampPan(pan: Pan, viewport: Size, area: Size, zoom: number): Pan {
    const overflowX = Math.max(0, area.width * zoom - viewport.width) / 2;
    const overflowY = Math.max(0, area.height * zoom - viewport.height) / 2;
    const clamp = (v: number, limit: number) =>
        !Number.isFinite(v) || limit <= 0 ? 0 : Math.min(limit, Math.max(-limit, v));
    return { x: clamp(pan.x, overflowX), y: clamp(pan.y, overflowY) };
}

export interface Placement {
    /** transform-origin 為 `0 0` 時的位移；先 translate 再 scale。 */
    translateX: number;
    translateY: number;
    /** `clip-path: inset(...)` 的字串；不裁切時為 `none`。 */
    clip: string;
}

/**
 * 把「遊戲畫面區域」擺到視窗正中央並裁掉框內其餘部分。
 * transform-origin 固定 `0 0`：座標運算才是單純的 `螢幕 = translate + zoom × 框內座標`，
 * 用 `50% 0` 之類的原點會讓「裁切後置中」變成兩層互相牽動的補償量，改一個參數就歪。
 */
export function framePlacement(
    viewport: Size, frame: Size, content: Rect | null, zoom: number, pan: Pan,
): Placement {
    const area = contentArea(frame, content);
    const translateX = (viewport.width - area.width * zoom) / 2 - area.x * zoom + pan.x;
    const translateY = (viewport.height - area.height * zoom) / 2 - area.y * zoom + pan.y;
    const px = (v: number) => `${Math.max(0, Math.round(v))}px`;
    const clip = content && content.width > 0 && content.height > 0
        ? `inset(${px(area.y)} ${px(frame.width - area.x - area.width)} `
        + `${px(frame.height - area.y - area.height)} ${px(area.x)})`
        : 'none';
    return { translateX, translateY, clip };
}

// ── 注入用 CSS ────────────────────────────────────────
// 標記屬性（JS 只負責「貼標」，樣式全交給這份 CSS）：React 重繪會把 inline style 洗掉，
// 但重繪後我們用 MutationObserver 重新貼標即可恢復；inline style 則要逐項記錄與還原。
export const ATTR_ACTIVE = 'data-kc-theater';       // <html>：劇場模式開啟中
export const ATTR_FRAME = 'data-kc-theater-frame';  // 遊戲 iframe 本體
export const ATTR_ANCESTOR = 'data-kc-theater-box'; // 遊戲框的祖先鏈（含 body 底下那層）
export const ATTR_HIDDEN = 'data-kc-theater-off';   // 祖先鏈上的兄弟節點（DMM 頁首／廣告等）
export const CSS_ZOOM = '--kc-theater-zoom';
export const CSS_TX = '--kc-theater-tx';
export const CSS_TY = '--kc-theater-ty';
export const CSS_CLIP = '--kc-theater-clip';
/**
 * 工具列預留的底部條高度：工具列**不覆蓋遊戲畫面**，fit 計算會扣掉這一條。
 * 加了拍照鈕後從 26 調到 38——26px 只夠塞下縮放群組＋靜音，按鈕擠在一起難點；
 * 這是唯一要改的常數，`viewport()`／`fitTheaterWindow()`／CSS 全部從它推導。
 */
export const BAR_HEIGHT = 38;

/**
 * 劇場模式樣式。三個要點：
 *  1. **絕不改變遊戲框在 DOM 裡的位置**——移動節點會摧毀 iframe 的 browsing context，
 *     等於重新載入遊戲（使用者要求「不重新整理」）。只改樣式、只貼屬性。
 *  2. 不用 `position: fixed` 當主要手段：祖先若有 transform／filter／contain 會變成
 *     containing block，fixed 就不再對齊視窗。改為「把祖先鏈以外的東西藏起來、祖先鏈
 *     撐滿視窗」，版面自然乾淨，且對未知的 SPA 結構最不挑。
 *  3. 全部 `!important`＋屬性選擇器：與 DMM 自己的樣式競爭時要贏，且不碰 inline style。
 */
export function theaterCss(): string {
    return `
html[${ATTR_ACTIVE}], html[${ATTR_ACTIVE}] body {
    margin: 0 !important; padding: 0 !important;
    width: 100% !important; height: 100% !important;
    max-width: none !important; max-height: none !important;
    overflow: hidden !important;
    background: #05080d !important;
}
html[${ATTR_ACTIVE}] [${ATTR_HIDDEN}] { display: none !important; }
html[${ATTR_ACTIVE}] [${ATTR_ANCESTOR}] {
    display: block !important;
    position: static !important;
    margin: 0 !important; padding: 0 !important; border: 0 !important;
    width: 100% !important; height: 100% !important;
    min-width: 0 !important; min-height: 0 !important;
    max-width: none !important; max-height: none !important;
    overflow: visible !important;
    background: transparent !important;
    /* containing block／裁切／堆疊來源一律解除，否則遊戲框會被祖先夾住 */
    transform: none !important; filter: none !important; perspective: none !important;
    contain: none !important; will-change: auto !important; clip-path: none !important;
    opacity: 1 !important; visibility: visible !important;
}
html[${ATTR_ACTIVE}] [${ATTR_FRAME}] {
    /* display:block 去掉行內取代元素的 baseline 空隙，框的版面原點才等於容器左上角，
       framePlacement() 的座標運算才成立 */
    display: block !important;
    margin: 0 !important; border: 0 !important; padding: 0 !important;
    max-width: none !important; max-height: none !important;
    transform-origin: 0 0 !important;
    transform: translate(var(${CSS_TX}, 0px), var(${CSS_TY}, 0px)) scale(var(${CSS_ZOOM}, 1)) !important;
    /* 只顯示遊戲畫布那一塊，框內的頁尾按鈕與白底一律裁掉 */
    clip-path: var(${CSS_CLIP}, none) !important;
    /* 縮放中的 iframe 重繪成本高，交給合成層 */
    will-change: transform !important;
}
`;
}
