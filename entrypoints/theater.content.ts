// 視窗適應（程式碼／訊息型別仍沿用 theater 識別名，避免改動既有權限與儲存鍵）：
// 讓 DMM 遊戲頁裡的遊戲畫面等比填滿瀏覽器視窗；大小靠使用者拉動視窗邊框，隨時還原。
//
// 三條硬約束（改這個檔前先讀，違反任何一條都會毀掉這個功能存在的理由）：
//
// 1. **絕不搬動遊戲框在 DOM 裡的位置、絕不碰它的 src**。把 iframe 移到別的父節點或另一個
//    視窗（含 Document PiP）都會依規格摧毀它的 nested browsing context ＝ 遊戲重新載入。
//    使用者要的正是「不重新整理」，所以本檔只做兩件事：貼標記屬性、設 CSS 變數。
//    不提供另開或替換遊戲視窗，避免產生第二個遊戲執行個體。
// 2. **還原必須是完全還原**。離開時把所有標記屬性移除，DMM 的頁首、廣告、「ポイントを
//    チャージする」全部原樣回來（課金流程仍在原頁完成）。故一律用屬性選擇器＋外部樣式表，
//    不寫 inline style 到 DMM 自己的元素上（那要逐項記錄原值才還原得回去）。
// 3. **對未知的 DOM 結構要有韌性**。新遊戲頁 `play.games.dmm.com/game/kancolle` 是
//    Vite+React SPA，遊戲框由 JS 動態插入、隨時可能重繪，且沒有登入就看不到真實 DOM。
//    故：遊戲框靠 src／尺寸辨識（utils/theater.ts 的 pickGameFrame），並用 MutationObserver
//    在每次重繪後重新貼標記。
//
// 產品意圖與別改回去的點：
//   a. **顯示的是「遊戲畫布」不是「整個 iframe」**：框裡還有頁尾按鈕與大片白底，拿整個框
//      去 fit 會讓遊戲縮得比視窗小、下面留一大條白。畫布位置只有框內的 bridge 量得到。
//   b. **工具列不覆蓋遊戲畫面**：底部預留一條，fit 計算扣掉它。
//   c. **永遠 contain／fit**：拉瀏覽器邊框就自動 refit。不做手動 +/-／滾輪縮放／平移——
//      那些會脫離 fit、弄出黑邊；縮放交給瀏覽器原生 Ctrl／⌘＋滾輪。
import {
    ATTR_ACTIVE, ATTR_ANCESTOR, ATTR_FRAME, ATTR_HIDDEN, BAR_HEIGHT,
    CSS_CLIP, CSS_TX, CSS_TY, CSS_ZOOM,
    contentArea, fallbackGameArea, fitZoom, framePlacement, pickGameFrame,
    theaterCss, type Rect,
} from '@/utils/theater';
import {
    MSG_CAPTURE_TAB, MSG_MUTE_GET, MSG_MUTE_SET, MSG_SCREENSHOT_RECT, MSG_THEATER_FIT_WINDOW,
    MSG_THEATER_TOGGLE, MSG_UI_LANG, RELAY_MARK, isGameFrameOrigin,
    type CaptureTabReply, type ScreenshotRectReply, type TheaterRelayMessage,
} from '@/utils/game-page';
import { downloadCroppedScreenshot } from '@/utils/screenshot';
import { replyWhenSettled } from '@/utils/runtime-reply';
import { LANGS, setLang, t } from '@/utils/ui-i18n';
import { detectBrowserLang } from '@/utils/ui-prefs';

// 我們自己的 UI 容器標記：貼標時要跳過它（否則會把自己藏起來）。
const UI_ATTR = 'data-kc-theater-ui';
const HOST_ATTR = 'data-kc-theater-host';
// 版面偏好存 DMM 頁面自己的 localStorage（content script 共用宿主頁面的儲存區）。
// 刻意不進 Dexie／備份：這是「這台機器上這個頁面的顯示習慣」，與鎮守府資料無關。
const STORE_KEY = 'kc-theater';

interface Stored { active?: boolean }

export default defineContentScript({
    matches: ['*://play.games.dmm.com/*', '*://www.dmm.com/netgame/*'],
    registration: 'runtime',
    // CSS 由本檔自行注入（runtime 註冊沒有 manifest 的 css 欄位可用）
    cssInjectionMode: 'manual',
    runAt: 'document_idle',
    allFrames: false,
    main() {
        // 只在最上層頁面跑：遊戲框內部另有 kancolle-server.com 的靜態注入負責擷取與靜音。
        if (window.top !== window) return;
        // 重複注入防護：popup 的「視窗適應」會在必要時用 scripting.executeScript 立即注入
        // （才不必等使用者重新整理），若該頁已由動態註冊注入過，第二份會長出第二條工具列。
        // ISOLATED world 的 window 由同一擴充的所有注入共用，故旗標放這裡即可。
        const INSTALLED = '__kcTheaterInstalled';
        if ((window as any)[INSTALLED]) return;
        (window as any)[INSTALLED] = true;

        let frame: HTMLIFrameElement | null = null;
        let active = false;
        let zoom = 1;
        const pan = { x: 0, y: 0 };   // 永遠置中 fit，平移固定 0（保留物件形狀給 framePlacement）
        let muted = false;
        let gameRect: Rect | null = null;   // 遊戲畫布在框內的位置（量不到就是 null＝不裁切）
        let syncScheduled = false;
        let measureTimer = 0;

        const stored: Stored = (() => {
            try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Stored; }
            catch { return {}; }
        })();

        const save = () => {
            try {
                // 只記「是否啟用」；倍率永遠由 fit 當場算出，不持久化手動縮放（已移除）。
                localStorage.setItem(STORE_KEY, JSON.stringify({ active } satisfies Stored));
            } catch { /* 頁面禁用儲存時只是不記住偏好，不影響功能 */ }
        };

        // ── 樣式 ──────────────────────────────────────
        const style = document.createElement('style');
        style.setAttribute(UI_ATTR, '1');
        style.textContent = theaterCss();
        const ensureStyle = () => {
            if (!style.isConnected) (document.head ?? document.documentElement).append(style);
        };
        ensureStyle();

        // ── 遊戲框辨識與標記 ──────────────────────────
        const locate = (): HTMLIFrameElement | null => {
            const frames = [...document.querySelectorAll('iframe')];
            const picked = pickGameFrame(frames.map(el => {
                const rect = el.getBoundingClientRect();
                return { src: el.src || el.getAttribute('src') || '', width: rect.width, height: rect.height, el };
            }));
            return picked?.el ?? null;
        };

        /** 貼標記：遊戲框、它的祖先鏈、以及祖先鏈上所有「不通往遊戲框」的兄弟節點。 */
        const mark = () => {
            if (!frame) return;
            frame.setAttribute(ATTR_FRAME, '1');
            let keep: Element = frame;
            let node = frame.parentElement;
            let first = true;
            while (node && node !== document.documentElement) {
                node.setAttribute(ATTR_ANCESTOR, '1');
                if (first) { node.setAttribute(HOST_ATTR, '1'); first = false; }
                for (const child of [...node.children]) {
                    if (child === keep || child.hasAttribute(UI_ATTR)) continue;
                    child.setAttribute(ATTR_HIDDEN, '1');
                }
                keep = node;
                node = node.parentElement;
            }
        };

        const unmark = () => {
            const selector = `[${ATTR_FRAME}],[${ATTR_ANCESTOR}],[${ATTR_HIDDEN}],[${HOST_ATTR}]`;
            for (const el of document.querySelectorAll(selector)) {
                el.removeAttribute(ATTR_FRAME);
                el.removeAttribute(ATTR_ANCESTOR);
                el.removeAttribute(ATTR_HIDDEN);
                el.removeAttribute(HOST_ATTR);
            }
        };

        // 工具列佔住底部一條，故可用高度要扣掉——工具列**不覆蓋遊戲畫面**（實機回報過
        // 上緣浮動工具列正好蓋住司令部資源列）。
        const viewport = () => ({
            width: window.innerWidth,
            height: Math.max(0, window.innerHeight - BAR_HEIGHT),
        });
        const frameSize = () => ({
            // offsetWidth/Height 是版面尺寸，不受 transform 影響，故可安全用於縮放計算。
            width: frame?.offsetWidth || 0,
            height: frame?.offsetHeight || 0,
        });
        /**
         * 真正要顯示的區域：優先使用框內量到的畫布；量測失敗時，使用者提供的 1600×960
         * 截圖證實遊戲固定在框內左上 5:3 區域，故安全裁掉明顯多出的頁尾白底。
         */
        const area = () => contentArea(frameSize(), gameRect ?? fallbackGameArea(frameSize()));

        const applyTransform = () => {
            const view = viewport();
            const size = frameSize();
            const shown = area();
            // 永遠 contain／fit：拉視窗邊框就自動跟上，不做手動倍率。
            zoom = fitZoom(view, shown);
            const placement = framePlacement(view, size, gameRect ?? fallbackGameArea(size), zoom, pan);
            const root = document.documentElement;
            root.style.setProperty(CSS_ZOOM, String(zoom));
            root.style.setProperty(CSS_TX, `${Math.round(placement.translateX)}px`);
            root.style.setProperty(CSS_TY, `${Math.round(placement.translateY)}px`);
            root.style.setProperty(CSS_CLIP, placement.clip);
            ui.render();
        };

        const fitWindow = () => {
            applyTransform();
            const shown = area();
            // 用目前視窗量到的 outer-inner 差保留各 OS 的標題列與邊框，不硬編平台常數。
            void browser.runtime.sendMessage({
                type: MSG_THEATER_FIT_WINDOW,
                game: { width: Math.round(shown.width), height: Math.round(shown.height) },
                barHeight: BAR_HEIGHT,
                inner: { width: window.innerWidth, height: window.innerHeight },
                outer: { width: window.outerWidth, height: window.outerHeight },
            }).catch(() => { /* 視窗不可調整時，仍保留 iframe 的適應效果 */ });
        };

        // ── 遊戲畫布量測（裁切依據）──────────────────
        // 跨源看不見框內任何東西，只能問框內的 bridge。它是**直接子框**時才採用回覆
        // （靠 e.source 比對確認），中間隔著 DMM 自己的 gadget 框時一律退回不裁切。
        const requestMeasure = () => {
            if (!active || !frame?.contentWindow) return;
            try {
                frame.contentWindow.postMessage({ [RELAY_MARK]: 1, kind: 'measure' } satisfies TheaterRelayMessage, '*');
            } catch { /* 框還沒好，下一次 tick 再試 */ }
        };

        // ── 拍照用：量測「遊戲畫面」在本分頁 viewport 座標系的絕對矩形 ──
        // 不論劇場模式有沒有開啟都能用（拍照不該逼玩家先進劇場）。與劇場模式共用同一套
        // pickGameFrame／contentArea／fallbackGameArea 後備規則與跨源量測協定——
        // 拍照裁切跟劇場模式的視覺裁切算的必須是同一塊區域，不能另外重新推算一次
        // （這條路徑之前吃過抓錯遊戲畫面的苦頭，見 utils/theater.ts 檔頭）。
        // getBoundingClientRect() 已經反映了框上的 CSS transform（劇場模式的縮放/平移），
        // 故不論是否在劇場模式中、有沒有手動縮放，這裡算出來的都是「畫面現在實際顯示在
        // 螢幕上的哪裡」；frameRect.width / size.width 即是目前的有效縮放倍率。
        const measureScreenshotRect = (): Promise<ScreenshotRectReply> => new Promise((resolve) => {
            const found = frame?.isConnected ? frame : locate();
            if (!found) { resolve({ rect: null, dpr: window.devicePixelRatio || 1 }); return; }
            frame = found;
            const size = frameSize();
            if (size.width <= 0 || size.height <= 0) {
                resolve({ rect: null, dpr: window.devicePixelRatio || 1 });
                return;
            }

            const finish = (measured: Rect | null) => {
                const content = measured ?? gameRect ?? fallbackGameArea(size);
                const shown = contentArea(size, content);
                const frameRect = found.getBoundingClientRect();
                const scaleX = frameRect.width / size.width;
                const scaleY = frameRect.height / size.height;
                resolve({
                    rect: {
                        x: frameRect.left + shown.x * scaleX,
                        y: frameRect.top + shown.y * scaleY,
                        width: shown.width * scaleX,
                        height: shown.height * scaleY,
                    },
                    dpr: window.devicePixelRatio || 1,
                });
            };

            let done = false;
            const onMessage = (e: MessageEvent) => {
                const data = e.data as TheaterRelayMessage | undefined;
                if (!data || (data as any)[RELAY_MARK] !== 1 || data.kind !== 'game-rect') return;
                if (!found.contentWindow || e.source !== found.contentWindow) return;
                if (done) return;
                done = true;
                window.removeEventListener('message', onMessage);
                const rect = data.rect && data.rect.width > 0 && data.rect.height > 0 ? data.rect : null;
                if (rect) gameRect = rect;   // 順便更新既有快取，劇場模式下次繪製也受惠
                finish(rect);
            };
            window.addEventListener('message', onMessage);
            try {
                found.contentWindow?.postMessage({ [RELAY_MARK]: 1, kind: 'measure' } satisfies TheaterRelayMessage, '*');
            } catch { /* 框還沒好，走下面的逾時後備 */ }
            setTimeout(() => {
                if (done) return;
                done = true;
                window.removeEventListener('message', onMessage);
                finish(null);
            }, 800);
        });

        const enter = () => {
            const found = frame?.isConnected ? frame : locate();
            if (!found) { ui.flash(t('theater.notFound')); return; }
            frame = found;
            active = true;
            ensureStyle();
            document.documentElement.setAttribute(ATTR_ACTIVE, '1');
            mark();
            // 一進來就做完整適應（CSS 縮放 + 調整瀏覽器外框尺寸）。
            // `fitWindow()` 內部本來就會呼叫 `applyTransform()`，故不必另外呼叫。
            fitWindow();
            requestMeasure();
            // 遊戲載入過程中畫布會晚一點才出現／改變大小，故前幾秒持續量測；之後降頻，
            // 讓「遊戲自己換版面」（例如出擊進戰鬥畫面）也還能跟上。
            clearInterval(measureTimer);
            measureTimer = window.setInterval(requestMeasure, 2000);
            ui.flash(t('theater.hint'), 5000);
            save();
        };

        const exit = () => {
            active = false;
            clearInterval(measureTimer);
            document.documentElement.removeAttribute(ATTR_ACTIVE);
            const root = document.documentElement;
            for (const name of [CSS_ZOOM, CSS_TX, CSS_TY, CSS_CLIP]) root.style.removeProperty(name);
            unmark();
            ui.render();
            save();
        };

        const toggle = () => (active ? exit() : enter());

        // ── React 重繪後的自我修復 ────────────────────
        // SPA 會整片換掉節點：屬性會不見、新插入的廣告／頁首元素沒有標記。故每次 DOM 變動
        // 就重新貼一次（設定屬性不會觸發 childList 觀察，不會形成迴圈）。
        const sync = () => {
            ensureStyle();
            ensureUi();
            if (!active) return;
            if (!frame?.isConnected) {
                const found = locate();
                if (!found) return;   // 遊戲框暫時消失（路由切換中）：保持劇場狀態等它回來
                frame = found;
                gameRect = null;
                requestMeasure();
            }
            mark();
        };
        const schedule = () => {
            if (syncScheduled) return;
            syncScheduled = true;
            requestAnimationFrame(() => { syncScheduled = false; sync(); });
        };
        new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

        // ── 互動 ──────────────────────────────────────
        window.addEventListener('resize', () => {
            if (!active) return;
            applyTransform();
            requestMeasure();
        });

        // 滑鼠在遊戲框上時鍵盤事件只送到框內文件；框內的 bridge 會把 Esc 轉發上來
        // （只送互動意圖，不含任何遊戲資料），並回覆畫布量測。滾輪縮放已移除——
        // Ctrl／⌘＋滾輪留給瀏覽器原生頁面縮放，不要搶。
        window.addEventListener('message', (e) => {
            const data = e.data as TheaterRelayMessage | undefined;
            if (!data || (data as any)[RELAY_MARK] !== 1) return;
            if (data.kind === 'game-rect') {
                // 只信任「我們正在顯示的那個框」直接回覆的量測值
                if (!frame?.contentWindow || e.source !== frame.contentWindow) return;
                gameRect = data.rect && data.rect.width > 0 && data.rect.height > 0 ? data.rect : null;
                // 遊戲載入完成後才量到畫布時，適應倍率會從「整個 iframe」切成真正遊戲區。
                if (active) applyTransform();
                return;
            }
            if (!active) return;
            // Esc 離開只接受遊戲伺服器來源（bridge 就注入在那裡）。RELAY_MARK 只是
            // 訊息辨識碼，不是憑證——DMM 頁面上的廣告／追蹤框同樣送得出來。
            // 刻意**不用** `e.source === frame.contentWindow`：中間隔著 DMM gadget 框時
            // 轉發來自孫框，比對直接子框會把 Esc 離開修壞。
            if (!isGameFrameOrigin(e.origin)) return;
            if (data.kind === 'exit') exit();
        });

        // Esc：焦點在父頁時直接離開。焦點在遊戲框內時由 bridge 轉發（見下方 message）。
        // Ctrl／⌘＋滾輪留給瀏覽器原生頁面縮放，本檔不攔截滾輪。
        window.addEventListener('keydown', (e) => {
            if (!active) return;
            if (e.key === 'Escape') exit();
        });

        // ── 靜音（狀態由 background 持有，遊戲框內的 hook 實際執行）──
        const setMuted = async (next: boolean) => {
            muted = next;
            ui.render();
            const reply: any = await browser.runtime.sendMessage({ type: MSG_MUTE_SET, muted: next })
                .catch(() => null);
            // 遊戲分頁沒有連線＝那個分頁跑的還是舊版 content script（擴充更新後未 F5）。
            // 靜靜沒反應最難查，故明講。
            if (reply && reply.connected === 0) ui.flash(t('theater.muteNoTab'), 6000);
        };

        // ── 拍照（工具列鈕）──────────────────────────
        // 裁切矩形直接用本檔的 measureScreenshotRect()（跟劇場模式的視覺裁切同一套邏輯，
        // 見該函式註解），不論劇場模式有沒有開啟都能拍。content script 沒有 tabs API，
        // 抓整分頁截圖要經 background 轉手（MSG_CAPTURE_TAB）；裁切＋下載走共用的
        // utils/screenshot.ts（popup 的拍照鈕也是同一份，避免兩邊各自實作出不一致的行為）。
        const doScreenshot = async () => {
            const { rect, dpr } = await measureScreenshotRect();
            if (!rect) { ui.flash(t('theater.notFound')); return; }
            // 回覆可能是 undefined（sender 端收不到回覆時 sendMessage 是 resolve 不是 reject，
            // 見 utils/runtime-reply.ts）：對 undefined 用 `in` 會直接丟 TypeError，
            // 整個拍照流程變成「按了完全沒反應」。
            const capture = await browser.runtime.sendMessage({ type: MSG_CAPTURE_TAB })
                .catch((e): CaptureTabReply => ({ error: String(e) })) as CaptureTabReply | undefined;
            if (!capture) {
                console.warn('[KC-Monitor] 拍照失敗：background 沒有回覆');
                ui.flash(t('screenshot.noReply'));
                return;
            }
            if (!('dataUrl' in capture)) {
                console.warn('[KC-Monitor] 拍照失敗', capture.error);
                ui.flash(t('screenshot.failed'));
                return;
            }
            try {
                await downloadCroppedScreenshot(capture.dataUrl, rect, dpr);
                ui.flash(t('screenshot.done'));
            } catch (e) {
                console.warn('[KC-Monitor] 拍照裁切失敗', e);
                ui.flash(t('screenshot.failed'));
            }
        };

        // 回覆一律 sendResponse + return true（見 utils/runtime-reply.ts 檔頭）：舊寫法回傳
        // promise，在尚未支援的瀏覽器上 popup 會收到 undefined，於是量不到矩形就誤報
        // 「找不到遊戲畫面」。
        browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
            if (msg?.type === MSG_THEATER_TOGGLE) {
                if (msg.mode === 'on') {
                    if (!active) void waitForFrame(locate, 20000).then(() => enter());
                } else toggle();
                sendResponse(true);
                return;
            }
            if (msg?.type === MSG_MUTE_SET) { muted = !!msg.muted; ui.render(); }
            if (msg?.type === MSG_SCREENSHOT_RECT) {
                return replyWhenSettled(measureScreenshotRect(), sendResponse);
            }
        });

        // ── UI（Shadow DOM，與 DMM 的樣式完全隔離）────
        const uiRoot = document.createElement('div');
        uiRoot.setAttribute(UI_ATTR, '1');
        const shadow = uiRoot.attachShadow({ mode: 'open' });
        const ensureUi = () => { if (!uiRoot.isConnected) document.documentElement.append(uiRoot); };

        const ui = buildUi(shadow, {
            isActive: () => active,
            isMuted: () => muted,
            onAction: (action) => {
                if (action === 'enter') enter();
                else if (action === 'exit') exit();
                else if (action === 'mute') void setMuted(!muted);
                else if (action === 'screenshot') void doScreenshot();
            },
        });
        ensureUi();

        // ── 啟動 ──────────────────────────────────────
        void (async () => {
            // 語言：content script 讀不到擴充頁面的 localStorage（那是 extension origin），
            // 故向 background 要一份鏡像；沒有紀錄時退回瀏覽器語言偵測（與 ui-prefs 同規則）。
            const saved = await browser.runtime.sendMessage({ type: MSG_UI_LANG }).catch(() => null);
            setLang(LANGS.find(l => l.code === saved)?.code ?? detectBrowserLang());
            const state: any = await browser.runtime.sendMessage({ type: MSG_MUTE_GET }).catch(() => null);
            muted = !!state?.muted;
            ui.render();
            if (stored.active) {
                // 遊戲框是 SPA 動態插入的，載入當下可能還不存在：等它出現再進劇場。
                await waitForFrame(locate, 15000);
                enter();
            }
        })();
    },
});

function waitForFrame(locate: () => HTMLIFrameElement | null, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
        if (locate()) { resolve(); return; }
        const started = Date.now();
        const timer = setInterval(() => {
            if (locate() || Date.now() - started > timeoutMs) { clearInterval(timer); resolve(); }
        }, 300);
    });
}

type UiAction = 'enter' | 'exit' | 'mute' | 'screenshot';

interface UiHooks {
    isActive(): boolean;
    isMuted(): boolean;
    onAction(action: UiAction): void;
}

/**
 * 工具列。**適應中固定佔住底部一條、絕不蓋在遊戲畫面上**。未啟用時縮回右下角小按鈕。
 * 不提供 +/-／平移——大小靠拉瀏覽器邊框；縮放交給瀏覽器原生 Ctrl／⌘＋滾輪。
 */
function buildUi(shadow: ShadowRoot, hooks: UiHooks) {
    shadow.innerHTML = `
<style>
    :host { all: initial; }
    /* [hidden] 必須明寫：底下的 button 規則是作者樣式，會蓋過瀏覽器對 [hidden]
       的 display:none（作者樣式恆勝 UA 樣式，與 specificity 無關）。 */
    [hidden] { display: none !important; }
    .bar {
        position: fixed; z-index: 2147483647;
        display: flex; align-items: center; gap: 2px;
        font: 12px/1.2 system-ui, -apple-system, "Noto Sans TC", sans-serif;
        color: #cfd6e4;
    }
    .bar[data-mode="idle"] {
        right: 12px; bottom: 12px;
        padding: 4px; border-radius: 10px;
        background: rgba(16, 21, 29, .92); border: 1px solid #2a3548;
        box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
        opacity: .35; transition: opacity .15s ease;
    }
    .bar[data-mode="idle"]:hover, .bar[data-mode="idle"]:focus-within { opacity: 1; }
    .bar[data-mode="on"] {
        left: 0; right: 0; bottom: 0; height: ${BAR_HEIGHT}px;
        justify-content: center;
        padding: 0 8px;
        background: #0b1018; border-top: 1px solid #1d2636;
    }
    button {
        all: unset; box-sizing: border-box;
        min-width: 30px; height: 28px; padding: 0 8px;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 6px; cursor: pointer; color: #cfd6e4;
        font: inherit; letter-spacing: .04em; white-space: nowrap;
    }
    button:hover { background: #223049; }
    button:active { background: #2c3d5c; }
    button:focus-visible { outline: 2px solid #e6c35c; outline-offset: 1px; }
    button[data-on="1"] { color: #e6c35c; }
    .sep { width: 1px; height: 14px; background: #2a3548; margin: 0 4px; }
    /* 離開鈕跟其他按鈕拉開距離——唯一「按下去整個適應就沒了」的鈕，避免手滑。 */
    .exit-gap { margin: 0 22px; }
    .flash {
        position: fixed; z-index: 2147483647; left: 50%; bottom: 34px; transform: translateX(-50%);
        padding: 7px 14px; border-radius: 8px; max-width: 70vw;
        background: rgba(11, 16, 24, .96); border: 1px solid #2a3548; color: #cfd6e4;
        font: 12px/1.4 system-ui, -apple-system, "Noto Sans TC", sans-serif;
        pointer-events: none;
    }
    @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
</style>
<div class="bar" part="bar">
    <button data-act="enter" class="enter"></button>
    <span class="sep"></span>
    <button data-act="mute" class="mute"></button>
    <button data-act="screenshot" class="screenshot">📷</button>
    <span class="sep exit-gap" hidden></span>
    <button data-act="exit" class="exit" hidden>✕</button>
</div>
<div class="flash" hidden></div>`;

    const bar = shadow.querySelector('.bar') as HTMLElement;
    const enterBtn = shadow.querySelector('.enter') as HTMLButtonElement;
    const exitBtn = shadow.querySelector('.exit') as HTMLButtonElement;
    const exitGap = shadow.querySelector('.exit-gap') as HTMLElement;
    const muteBtn = shadow.querySelector('.mute') as HTMLButtonElement;
    const screenshotBtn = shadow.querySelector('.screenshot') as HTMLButtonElement;
    const flash = shadow.querySelector('.flash') as HTMLElement;

    bar.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest('button')?.dataset.act as UiAction | undefined;
        if (act) hooks.onAction(act);
    });

    let flashTimer = 0;
    const render = () => {
        const on = hooks.isActive();
        bar.dataset.mode = on ? 'on' : 'idle';
        enterBtn.hidden = on;
        enterBtn.textContent = t('theater.enter');
        exitBtn.hidden = !on;
        exitGap.hidden = !on;
        exitBtn.title = `${t('theater.exit')}（Esc）`;
        const isMuted = hooks.isMuted();
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
        muteBtn.dataset.on = isMuted ? '1' : '0';
        muteBtn.title = isMuted ? t('theater.unmute') : t('theater.mute');
        muteBtn.setAttribute('aria-pressed', String(isMuted));
        screenshotBtn.title = t('theater.screenshot');
    };

    return {
        render,
        flash(message: string, ms = 2500) {
            flash.textContent = message;
            flash.hidden = false;
            clearTimeout(flashTimer);
            flashTimer = window.setTimeout(() => { flash.hidden = true; }, ms);
        },
    };
}
