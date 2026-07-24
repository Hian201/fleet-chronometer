// 拍照（螢幕截圖）的共用裁切／下載邏輯。popup 與劇場模式工具列的「拍照」都是同一套流程：
// `tabs.captureVisibleTab()` 抓到「整分頁」的截圖，裁到「遊戲畫面」那一塊再下載。
// 裁切矩形一律來自 `entrypoints/theater.content.ts` 的 `measureScreenshotRect()`（沿用
// 劇場模式的遊戲畫面偵測邏輯——pickGameFrame／contentArea／fallbackGameArea＋跨源畫布量測
// 協定，不在這裡重新推算一次），這裡只負責「像素座標換算＋裁切＋下載」，兩個呼叫端共用
// 同一份，避免各自實作一次而慢慢長出不一致的行為。

export interface CropRect { x: number; y: number; width: number; height: number }

/**
 * 把 CSS px 的裁切矩形換算成擷取圖（裝置像素解析度）的來源矩形，並夾在圖片範圍內。
 * 純函式、無 DOM 依賴，可獨立測試。矩形完全落在可視範圍外（例如頁面被捲動、或量測當下
 * 與擷取當下的版面已經不同）時回 null，呼叫端據此誠實回報失敗，不裁出一張 0×0 或負座標的圖。
 */
export function cropRectPx(
    rect: CropRect, dpr: number, imgWidth: number, imgHeight: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
    // 先算左上／右下兩個邊界再各自夾限，寬高用「夾限後的邊界相減」求——不能直接拿
    // width*dpr 當寬度：矩形左緣被夾到 0 時（例如頁面往右捲動、遊戲框左側已經捲出畫面），
    // 可視寬度會比原本的 width 更窄，用原始 width 會多裁到畫面外的東西。
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.min(imgWidth, Math.round((rect.x + rect.width) * dpr)) - sx;
    const sh = Math.min(imgHeight, Math.round((rect.y + rect.height) * dpr)) - sy;
    if (sw <= 0 || sh <= 0) return null;
    return { sx, sy, sw, sh };
}

/**
 * 把整分頁截圖 dataURL 裁到遊戲畫面矩形後下載（Blob + 臨時 `<a download>`，同 overview
 * 頁 `downloadText` 的手法，純前端零權限）。`rect` 是 CSS px，`dpr` 是量測當下那個分頁
 * 自己的 devicePixelRatio（擷取圖是裝置像素解析度，兩者必須用同一個值換算）。
 */
export async function downloadCroppedScreenshot(dataUrl: string, rect: CropRect, dpr: number): Promise<void> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('screenshot image load failed'));
        el.src = dataUrl;
    });
    const crop = cropRectPx(rect, dpr, img.naturalWidth, img.naturalHeight);
    if (!crop) throw new Error('game screen rect outside captured viewport');

    const canvas = document.createElement('canvas');
    canvas.width = crop.sw;
    canvas.height = crop.sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);

    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), 'image/png');
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kanmusu-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
