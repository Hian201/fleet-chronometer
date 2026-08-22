import {
    createKcApiRuntimeMessage,
    sendKcApiRuntimeMessageWithRetry,
} from '../utils/runtime-message';
import {
    MUTE_MARK, PORT_MUTE, RELAY_MARK,
    type MuteBridgeMessage, type TheaterRelayMessage,
} from '../utils/game-page';

export default defineContentScript({
    matches: ['*://*.kancolle-server.com/*'],
    runAt: 'document_start',
    allFrames: true,
    main() {
        // ── 關閉分頁前警示（避免手滑關掉正在進行的出擊／遠征）──────
        // **關鍵功能不能依賴使用者授權**：掛在 manifest 靜態注入的 kancolle-server.com
        // 框上，安裝後即能在零額外授權與零使用者互動下生效，並涵蓋新舊 DMM 入口。
        //
        // Chromium 的跨源 iframe beforeunload 可能在取消後再次顯示對話框
        // （例如 crbug.com/1119438）；這是瀏覽器限制，但靜態注入仍能在零額外權限下攔下誤關。
        //
        // 只在「最外層」的 kancolle-server.com 框安裝，避免遊戲內部若真有巢狀同源子框時
        // 各自掛一份、放大重複跳窗機率：讀得到 `window.parent.location`（不丟
        // SecurityError）代表 parent 跟自己同源（也是巢狀在遊戲裡的框），這裡不裝；
        // 讀不到（跨源，通常是 DMM 頂層頁）才是最外層，才裝這份。
        const isOutermostGameFrame = () => {
            if (window === window.top) return true;
            try { void window.parent.location.href; return false; }
            catch { return true; }
        };
        if (isOutermostGameFrame()) {
            window.addEventListener('beforeunload', (e) => {
                e.preventDefault();
                e.returnValue = '';
            });
        }

        // ── 靜音狀態下行通道 ──────────────────────────
        // background 持有狀態，MAIN world 的 hook 執行。用長連線而非 tabs.sendMessage：
        // 後者需要對遊戲分頁的 host permission，而 content_scripts 的 matches 不等於
        // host permission（權限精簡原則）。由 content script 主動連上來就完全不需要權限。
        const connectMutePort = () => {
            try {
                const port = browser.runtime.connect({ name: PORT_MUTE });
                port.onMessage.addListener((msg: any) => {
                    if (typeof msg?.muted !== 'boolean') return;
                    window.postMessage(
                        { [MUTE_MARK]: 1, muted: msg.muted } satisfies MuteBridgeMessage,
                        location.origin,
                    );
                });
                // SW 隨時會死（設計原則3）：被系統閒置回收時這個 port 會斷線（分頁本身沒關），
                // 不是分頁關閉。不重連的話靜音鈕對這個分頁永久失效、需要使用者自行重整才會
                // 恢復——故斷線後短延遲重連一次。連線本身失敗（見下方 catch）才代表 extension
                // context 已失效，不再重試。
                port.onDisconnect.addListener(() => {
                    setTimeout(connectMutePort, 250);
                });
            } catch (e) {
                // 連線失敗只代表靜音鈕對這個分頁無效，封包擷取完全不受影響。
                console.warn('[KC-Monitor] 靜音狀態通道連線失敗', e);
            }
        };
        connectMutePort();

        // ── 視窗適應的互動意圖轉發（僅 Esc）────
        // 焦點落進遊戲框內時，鍵盤事件只送到框內文件，父頁收不到 Esc。
        // 故把 Esc 轉發上去（**只送互動意圖，不含任何遊戲資料**）。
        // 不做滾輪轉發：視窗適應永遠 fit，縮放交給瀏覽器原生 Ctrl／⌘＋滾輪。
        // listener 是 passive、不 stopPropagation：遊戲照樣收到該事件。
        const relay = (message: TheaterRelayMessage) => {
            if (window.top === window) return;
            try { window.top?.postMessage(message, '*'); } catch { /* 上層不可達時忽略 */ }
        };
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            relay({ [RELAY_MARK]: 1, kind: 'exit' });
        }, { passive: true, capture: true });

        // ── 遊戲畫布的量測（劇場模式的裁切依據）────────
        // DMM 的遊戲框裡除了遊戲，還有頁尾按鈕與大片白底；父頁跨源看不見框內任何東西，
        // 只有這裡量得到遊戲畫布的位置。父頁問一次才答一次（不主動廣播、不定時輪詢）。
        // 量不到畫布就回 null——父頁會退回「整個框」而不是猜一個矩形。
        const measureGame = () => {
            const rects = [...document.querySelectorAll('canvas')]
                .map(c => c.getBoundingClientRect())
                .filter(r => r.width >= 200 && r.height >= 150);
            if (!rects.length) return null;
            const biggest = rects.sort((a, b) => b.width * b.height - a.width * a.height)[0];
            return {
                x: biggest.left, y: biggest.top,
                width: biggest.width, height: biggest.height,
            };
        };
        window.addEventListener('message', (e) => {
            // theater.content.ts 一律直接對遊戲框的 contentWindow 送出量測請求（見
            // entrypoints/theater.content.ts），故從遊戲框角度看送信者必為 window.parent；
            // 不驗證會讓任何能對這個 frame postMessage 的來源都能觸發一次量測並廣播結果。
            if (e.source !== window.parent) return;
            const data = e.data as TheaterRelayMessage | undefined;
            if (!data || (data as any)[RELAY_MARK] !== 1 || data.kind !== 'measure') return;
            relay({
                [RELAY_MARK]: 1,
                kind: 'game-rect',
                rect: measureGame(),
                viewport: { width: window.innerWidth, height: window.innerHeight },
            });
        });

        window.addEventListener('message', (e) => {
            if (e.source !== window || e.origin !== location.origin) return;
            const d = e.data;
            if (!d || d.__kc_monitor__ !== 1) return;
            const req = Object.fromEntries(new URLSearchParams(d.req ?? ''));
            delete req.api_token;
            delete req.api_verno;
            const message = createKcApiRuntimeMessage(
                { path: d.path, req, apiText: d.apiText },
                { createUuid: () => crypto.randomUUID(), now: () => Date.now() },
            );
            void sendKcApiRuntimeMessageWithRetry(message, {
                send: (runtimeMessage) => browser.runtime.sendMessage(runtimeMessage),
                retryDelay: () => new Promise(resolve => setTimeout(resolve, 300)),
            }).catch((e) => {
                console.warn('[KC-Monitor] 送出封包重試後仍失敗，此筆遺失', e);
            });
        });
    },
});
