// 上架／GitHub 釋出預設關閉的開發用 UI 開關。
//
// 涵蓋：面板「動態」分頁（待驗證封包／複製 JSON）、出擊紀錄的單場 JSON 匯入。
// 正式建置（`npm run build`）預設關閉——前者對遊戲營運較敏感，後者是測試向匯入路徑，
// 不應出現在一般玩家的介面上。開發模式（`npm run dev`）預設開啟，方便本機驗證。
//
// 若要在已載入的正式建置裡暫時打開（例如本機以「載入未封裝」測匯入），於該擴充頁的
// DevTools Console 執行：`localStorage.setItem('kc-debug-ui', '1')` 後重新整理；
// 關閉：`localStorage.removeItem('kc-debug-ui')`。

/** 目前是否啟用開發用 UI（與背後的 wanted 擷取）。 */
export function isDebugUiEnabled(): boolean {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('kc-debug-ui') === '1') {
            return true;
        }
    } catch { /* 儲存被拒時退回建置旗標 */ }
    return import.meta.env.DEV;
}
