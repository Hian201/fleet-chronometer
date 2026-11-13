import { attachAxiosResponseCapture, waitForAxios } from '../utils/axios-capture';
import { getKcsapiPath, parseKcsapiResponse } from '../utils/kcsapi';
import { CaptureHealthMonitor } from '../utils/capture-health';
import { IdleCaptureQueue, type IdleDeadlineLike, type QueueTiming } from '../utils/idle-capture-queue';
import { wallNow, type MainCaptureTiming } from '../utils/capture-timing';
import { connectMainChannel, isChannelHandshake, type HandshakeEndpoint, type PortLike } from '../utils/main-channel';

export default defineContentScript({
    matches: ['*://*.kancolle-server.com/*'],
    world: 'MAIN',
    runAt: 'document_start',
    allFrames: true,
    // MAIN world 腳本的頂層變數就是遊戲頁的 window 屬性；WXT 預設會把整支腳本指定給
    // 與 entrypoint 同名的全域變數，故明確關閉。
    globalName: false,
    main() {
        // 遊戲程式與本 world 共用全域物件與 console：正式建置不留除錯全域變數、不印封包。
        // 直接寫建置旗標（不經函式）：正式建置在編譯期折成 false，除錯程式碼整段不進產物。
        // 這裡的 localStorage 屬於遊戲網域，不能用 utils/debug-ui.ts 的 kc-debug-ui 開關。
        const dev = import.meta.env.COMMAND === 'serve';
        if (dev) console.log('[Fleet Chronometer] interceptor 已注入:', location.href);

        // 本檔不包裝、不改寫遊戲頁的任何原生物件（網路、音訊、DOM 原型）：遊戲靜音由
        // background 以分頁靜音處理，不需要在這裡動音訊圖。

        // MAIN → bridge 的私有通道（utils/main-channel.ts）。握手只在這裡經過 window，
        // 並檢查來源為同一 window、同源。
        const endpoint: HandshakeEndpoint = {
            post: (message, transfer) => window.postMessage(message, location.origin, (transfer ?? []) as unknown as Transferable[]),
            listen: (handler) => {
                const listener = (e: MessageEvent) => {
                    if (e.source !== window || e.origin !== location.origin) return;
                    if (!isChannelHandshake(e.data)) return;
                    handler(e.data, e.ports as unknown as readonly PortLike[]);
                };
                window.addEventListener('message', listener);
                return () => window.removeEventListener('message', listener);
            },
        };
        const channel = connectMainChannel(
            endpoint,
            (dropped) => console.warn('[Fleet Chronometer] 擷取通道尚未建立，已丟棄最舊的回應', dropped),
        );

        // 擷取健康度（utils/capture-health.ts）：以 resource timing 看遊戲實際完成的 kcsapi
        // 請求，和 axios 觀察器收到的逐筆配對，遊戲改版讓觀察器失效時能在面板上說出來。
        // PerformanceObserver 只讀瀏覽器已記錄的請求時序，不包裝、不延遲任何網路 API。
        const health = new CaptureHealthMonitor({
            now: () => performance.now(),
            schedule: (callback, delayMs) => { setTimeout(callback, delayMs); },
            onChange: (next) => {
                channel.sendHealth(next);
                if (dev) console.log('[Fleet Chronometer] 擷取健康度', next);
            },
        });
        try {
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    // 非 2xx 的請求 axios 會走 reject，觀察器本來就收不到，不列入配對。
                    // responseStatus 為 0 代表瀏覽器不提供（跨源未授權等），仍列入。
                    const status = (entry as PerformanceResourceTiming).responseStatus;
                    if (typeof status === 'number' && status !== 0 && (status < 200 || status >= 300)) continue;
                    const path = getKcsapiPath(entry.name);
                    if (path) health.noteTraffic(path);
                }
            }).observe({ type: 'resource', buffered: true });
        } catch {
            // 不支援 resource timing 時只是少了失效提示，擷取本身不受影響。
        }

        const emit = (path: string, reqBody: string, text: string, queued: QueueTiming) => {
            try {
                // [debug，僅開發建置] 戰鬥／結算封包存到全域並印出：在遊戲框 console 執行
                //   copy(__kcLastBattle)，或對印出的物件按右鍵 →「Copy object」複製 JSON。
                // 一般封包一律留給 background 解析。
                if (dev && path.includes('battle')) {
                    const api = parseKcsapiResponse(text);
                    if (path.endsWith('result')) {
                        (window as any).__kcLastResult = api;
                        console.log('[Fleet Chronometer] 結算回應 (' + path + ') ↓ 右鍵此物件可 Copy object：', api);
                    } else {
                        (window as any).__kcLastBattle = api;
                        console.log('[Fleet Chronometer] 戰鬥回應 (' + path + ') ↓ 右鍵此物件可 Copy object：', api);
                    }
                }
                // 傳原始文字而非解析後的巢狀物件：structured clone 只需處理字串，不會在遊戲
                // renderer 深拷貝 start2 等多 MB 封包。background 會用同一套規則取 api_data。
                // timing 只供開發用延遲量測（utils/capture-timing.ts），下游不寫入 DB。
                const timing: MainCaptureTiming = {
                    hit: queued.enqueuedAt,
                    head: queued.headAt,
                    quietMs: queued.quietMs,
                    readMs: queued.readMs,
                    dispatch: queued.dispatchAt,
                    emit: wallNow(),
                    size: text.length,
                };
                channel.send({ kind: 'capture', path, req: reqBody, apiText: text, timing });
            } catch { /* 非 JSON,忽略 */ }
        };

        // 初始登入會連續回傳 start2／port／require_info 等大封包。不能只把 postMessage
        // 包在 setTimeout(0)：axios 已在遊戲路徑 materialize 回應，下一輪 task 若一次送完
        // 所有待處理封包仍會卡住繪製。改在 idle slice 一次處理一筆，讓遊戲 UI 優先。
        const requestIdle = (callback: (deadline: IdleDeadlineLike) => void) => {
            if (typeof globalThis.requestIdleCallback === 'function') {
                globalThis.requestIdleCallback(callback, { timeout: 1000 });
                return;
            }
            // Chrome 支援 requestIdleCallback；這個 fallback 仍保持單筆處理與順序，並保證
            // 在不支援的瀏覽器不會永久積壓封包。
            setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 50);
        };
        // 使用者點擊、按鍵或滾動後，至少讓出一個畫面幀（60Hz 約 16.7ms）再處理封包，
        // 不與該次輸入觸發的繪製擠在同一幀。實測單筆佔用主執行緒不到 1ms，更長的安靜期
        // 只會延後面板更新；封包往返通常已超過這段時間，多數情況不會額外等待。
        const INPUT_QUIET_MS = 17;
        // 低於此大小直接排到下一個 task 送出；實測 250K 的 api_port/port 跨 world 傳輸
        // 不到 1ms。更大或大小未知的封包（登入 start2 等）仍等 idle。
        const IMMEDIATE_MAX_CHARS = 512 * 1024;
        let lastUserInputAt = performance.now();
        const noteUserInput = () => { lastUserInputAt = performance.now(); };
        window.addEventListener('pointerdown', noteUserInput, { capture: true, passive: true });
        window.addEventListener('keydown', noteUserInput, { capture: true });
        window.addEventListener('wheel', noteUserInput, { capture: true, passive: true });
        const captureQueue = new IdleCaptureQueue(
            {
                schedule: requestIdle,
                // 刻意不在剩餘很短的同一個 idle slice 立即重排，避免載入海域等連續繪製
                // 期間反覆取得短 idle budget 而空轉。
                defer: (callback, delayMs) => setTimeout(callback, delayMs),
            },
            emit,
            {
                // 所有 path 一律套用輸入後的安靜期，無須猜測特定端點的資料形狀。
                nextEligibleDelayMs: () => Math.max(0, INPUT_QUIET_MS - (performance.now() - lastUserInputAt)),
                onError: (path, error) => console.warn('[Fleet Chronometer] 延後讀取回應失敗，略過此筆', path, error),
                now: wallNow,
                immediateMaxChars: IMMEDIATE_MAX_CHARS,
            },
        );

        // 不可取代 window.fetch／XMLHttpRequest.prototype：Edge 152 起頁面腳本一旦包住
        // 原生網路 API，Network 面板仍可能顯示 svdata，但 chrome.devtools.network.getContent
        // 會對其他擴充（KC3Kai 開發人員介面）回傳空內容。kcs2 的 kcsapi 走全域 axios，
        // 只在 response interceptor 觀察、絕不 reject／改寫 config。
        waitForAxios(
            () => (window as any).axios,
            (axios) => {
                health.noteAxios();
                attachAxiosResponseCapture(
                    axios,
                    (path, reqBody, readText, sizeHint) => {
                        health.noteCapture(path);
                        captureQueue.enqueue(path, reqBody, readText, sizeHint);
                    },
                    (path, error) => console.warn('[Fleet Chronometer] axios 擷取失敗，略過此筆', path, error),
                );
                if (dev) console.log('[Fleet Chronometer] 已掛上 axios 觀察');
            },
            (callback, delayMs) => { setTimeout(callback, delayMs); },
        );
    },
});
