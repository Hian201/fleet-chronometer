import { getKcsapiPath, parseKcsapiResponse, readFetchRequestBody } from '../utils/kcsapi';
import { IdleCaptureQueue, type IdleDeadlineLike } from '../utils/idle-capture-queue';
import { installAudioMute } from '../utils/audio-mute';
import { MUTE_MARK, type MuteBridgeMessage } from '../utils/game-page';

export default defineContentScript({
    matches: ['*://*.kancolle-server.com/*'],
    world: 'MAIN',
    runAt: 'document_start',
    allFrames: true,
    main() {
        console.log('[KC-Monitor] interceptor 已注入:', location.href);

        // 靜音 hook：**必須在遊戲建立音訊圖之前安裝**，故掛在這個 document_start 的 MAIN
        // world 注入點。實際開關狀態由 background 持有，經 bridge（ISOLATED）同源
        // postMessage 傳進來；background 另以分頁靜音保底涵蓋無法攔截的 BGM。
        const audio = installAudioMute(window as any);
        // [debug] 靜音沒反應時，在**遊戲分頁**的 console（frame 選遊戲框）執行：
        //   __kcAudio.contextCount()   ← 0 代表遊戲根本沒用 WebAudio（那就是走 media 元素）
        //   __kcAudio.isMuted()        ← 目前狀態
        // 最常見的原因是擴充更新後遊戲分頁沒有 F5，
        // 那時連 __kcAudio 都不存在——這正好是判斷依據。
        (window as any).__kcAudio = audio;
        window.addEventListener('message', (e) => {
            if (e.source !== window || e.origin !== location.origin) return;
            const data = e.data as MuteBridgeMessage | undefined;
            if (!data || (data as any)[MUTE_MARK] !== 1) return;
            audio.setMuted(!!data.muted);
            console.log('[KC-Monitor] 靜音', data.muted ? 'ON' : 'OFF',
                '（已接管的 AudioContext：' + audio.contextCount() + '）');
        });

        const emit = (path: string, reqBody: string, text: string) => {
            try {
                // [debug] 擷取戰鬥封包，方便驗證：在「遊戲分頁」的 DevTools console 執行
                //   copy(__kcLastBattle)   ← 複製最後一場戰鬥的完整 JSON
                // 只為既有戰鬥 debug 解析；一般母港／編成／改裝封包一律留給 background 解析。
                // [debug] 擷取戰鬥／結算封包，方便驗證：對印出的物件按右鍵 →「Copy object」複製 JSON
                //   （與 console context 無關）
                if (path.includes('battle')) {
                    const api = parseKcsapiResponse(text);
                    if (path.endsWith('result')) {
                        (window as any).__kcLastResult = api;
                        console.log('[KC-Monitor] 結算封包 (' + path + ') ↓ 右鍵此物件可 Copy object：', api);
                    } else {
                        (window as any).__kcLastBattle = api;
                        console.log('[KC-Monitor] 戰鬥封包 (' + path + ') ↓ 右鍵此物件可 Copy object：', api);
                    }
                }
                // 傳原始文字而非解析後的巢狀物件：structured clone 只需處理字串，不會在遊戲
                // renderer 深拷貝 start2 等多 MB 封包。background 會用同一套規則取 api_data。
                window.postMessage(
                    { __kc_monitor__: 1, path, req: reqBody, apiText: text },
                    location.origin
                );
            } catch { /* 非 JSON,忽略 */ }
        };

        // 初始登入會連續回傳 start2／port／require_info 等大封包。不能只把 postMessage
        // 包在 setTimeout(0)：XHR load callback 仍會同步 materialize responseText，下一輪
        // task 又會一次送完所有待處理封包。改在 idle slice 一次處理一筆，讓遊戲 UI 優先。
        const requestIdle = (callback: (deadline: IdleDeadlineLike) => void) => {
            if (typeof globalThis.requestIdleCallback === 'function') {
                globalThis.requestIdleCallback(callback, { timeout: 1000 });
                return;
            }
            // Chrome 支援 requestIdleCallback；這個 fallback 仍保持單筆處理與順序，並保證
            // 在不支援的瀏覽器不會永久積壓封包。
            setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 50);
        };
        // 監看器的狀態允許晚一點更新，遊戲介面切換則不能掉幀。使用者每次點擊、按鍵或
        // 滾動後先留出一段完整的安靜時間，尤其避免工廠載入時與裝備庫繪製撞在一起。
        const INPUT_QUIET_MS = 750;
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
                // 工廠等介面可能在切換時取得整個裝備庫（require_info／slot_item）。這些
                // 回應必須保存，但不該在使用者剛點擊的轉場期間 materialize/傳輸，否則
                // 會與遊戲 renderer 的裝備清單繪製競爭。所有 path 一律套用，無須猜測
                // 特定未驗證端點的資料形狀。
                nextEligibleDelayMs: () => Math.max(0, INPUT_QUIET_MS - (performance.now() - lastUserInputAt)),
                onError: (path, error) => console.warn('[KC-Monitor] 延後讀取封包失敗，略過此筆', path, error),
            },
        );

        // 攔 fetch
        const origFetch = window.fetch;
        window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
            const p = getKcsapiPath(url);
            // Request 必須在原始 fetch 消耗前 clone；只啟動非同步讀取，絕不 await，
            // 因此不會延後或改變原始 fetch 的回應／錯誤傳遞。
            const reqBody = p ? readFetchRequestBody(args[0], args[1]) : null;
            const res = await origFetch.apply(this, args as Parameters<typeof fetch>);
            if (p && reqBody) {
                // clone 必須在原始 Response 被遊戲讀取前完成；但 .text() 會 materialize 大型
                // 字串，交給 idle queue 再做。完成後也會等下一個 idle 才跨 world 傳輸。
                try {
                    const responseCopy = res.clone();
                    void reqBody.then((body) => captureQueue.enqueue(p, body, () => responseCopy.text()));
                } catch (error) {
                    // 擷取失敗只能略過該筆，絕不能改變遊戲可取得的 Response。
                    console.warn('[KC-Monitor] 無法複製 fetch 回應，略過此筆', p, error);
                }
            }
            return res;
        };

        // 攔 XHR
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
            // 正常情況每個 API 都是新 XHR，responseText 會留到 idle 才讀。若遊戲重用同一
            // 個 XHR，open 會清掉上一筆 response，故此時才強制把尚未讀取的舊回應 materialize，
            // 寧可極少數重用情境有成本，也不能靜默遺失擷取事件。
            try {
                (this as any).__kcPendingResponse?.read();
            } catch (error) {
                // 這層防護不可讓擷取例外冒到遊戲自己的 open()。
                console.warn('[KC-Monitor] 無法保留被重用 XHR 的前一筆回應，略過此筆', error);
            }
            (this as any).__kcPath = getKcsapiPath(String(url));
            return (origOpen as any).call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (body?: any) {
            const p = (this as any).__kcPath;
            // { once: true }：若遊戲重用同一個 XHR 實例送出下一筆請求，這個 listener 不能
            // 留著——留著的話下一次 load 事件會被這個「舊」listener 跟這次新註冊的一起觸發，
            // 屆時 this.responseText 已經是新請求的內容，卻會被舊 listener 標成舊的 path
            // 重複入列。每個 send() 呼叫只該對應它自己
            // 那一次 load。
            if (p) this.addEventListener('load', () => {
                // 不在 load callback 讀 this.responseText；取得大型字串與 postMessage 都留給
                // idle queue。read() 具快取，只有 XHR 被重用時才可能提早執行一次。
                let read = false;
                let text = '';
                const pendingResponse = {
                    read: () => {
                        if (!read) {
                            read = true;
                            if ((this as any).__kcPendingResponse === pendingResponse)
                                delete (this as any).__kcPendingResponse;
                            text = this.responseText;
                        }
                        return text;
                    },
                };
                (this as any).__kcPendingResponse = pendingResponse;
                captureQueue.enqueue(p, String(body ?? ''), pendingResponse.read);
            }, { once: true });
            return origSend.call(this, body);
        };
    },
});
