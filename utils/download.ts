// Blob 檔案下載（臨時 <a download>）：面板、總括與劇場截圖共用，不需任何權限。

/** 觸發瀏覽器下載。 */
export function downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 保留時間給「下載前詢問儲存位置」的對話框；過早撤銷 blob URL 可能讓下載失敗。
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
