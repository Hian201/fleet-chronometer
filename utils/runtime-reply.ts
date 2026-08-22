// runtime.onMessage 的回覆契約（全瀏覽器版本相容寫法）。
//
// **為什麼不能直接 `return somePromise`**：Chrome 官方 messaging 文件明載「從 Chrome 148
// 起才能從 message listener 回傳 promise，且這項能力是逐步推出，不是所有使用者的瀏覽器
// 都已啟用」。在尚未啟用的瀏覽器上，回傳 Promise 等同「這個 listener 不回覆」——訊息本身
// 照常處理，但 sender 端的 sendMessage() 會**立刻 resolve 成 undefined**（不是 reject，
// 所以 .catch() 也接不到）。實際症狀：拍照永遠拿不到 dataUrl、靜音狀態列永遠顯示
// 「沒有連線到遊戲分頁」。
//
// 本專案沒有 webextension-polyfill（@wxt-dev/browser 的 `browser` 就是原生
// chrome/browser namespace），也不以 minimum_chrome_version 排除尚未支援 Promise listener 的瀏覽器，
// 故一律走官方建議的全版本相容寫法：`sendResponse` ＋ `return true`。
//
// 純函式、無 chrome.* 相依，node 可直接測（tests/runtime-reply.test.ts）。

export type SendResponse = (response?: unknown) => void;

/**
 * 把非同步結果接到 `sendResponse` 上，並回傳 `true` 讓瀏覽器保持回覆通道開啟。
 *
 * 用法一律是 `return replyWhenSettled(work, sendResponse)`——**回傳值必須交回給
 * listener**，少了那個 `true` 通道會立刻關閉，回覆同樣送不到。
 *
 * @param onError 失敗時要回覆的內容（例如 `{ error }`）。未提供則回覆 undefined：
 *   sender 至少會 resolve，不會卡在「等一個永遠不來的回覆」。
 */
export function replyWhenSettled<T>(
    work: PromiseLike<T>,
    sendResponse: SendResponse,
    onError?: (error: unknown) => unknown,
): true {
    const reply = (value: unknown) => {
        // sender 已經不在了（popup 關閉、分頁換頁）時 sendResponse 會丟例外。
        // 回覆送不到不是錯誤，也不該讓 listener 的其餘工作連帶失敗。
        try { sendResponse(value); } catch { /* 通道已關閉 */ }
    };
    Promise.resolve(work).then(
        value => reply(value),
        error => reply(onError ? onError(error) : undefined),
    );
    return true;
}
