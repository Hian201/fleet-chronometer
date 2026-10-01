// header 單行自動縮放：提督名放得下就維持原尺寸；會被截斷時以 1% 為級距調低 --hs，
// 名稱、Lv、艦／裝數量、圖示、間距與相機鈕一起等比縮小（CSS 見 panel/index.html 檔尾）。
// 12 字上限在最寬字形下約需 0.79；下限只是保險，到下限仍放不下才回退成省略號。
export const HEADER_MIN_SCALE = 0.7;

export function fitHeaderScale(header: HTMLElement, minScale = HEADER_MIN_SCALE): number {
    const nick = header.querySelector<HTMLElement>('.nick');
    let scale = 1;
    header.style.setProperty('--hs', '1');
    const tight = () => !!nick && (nick.scrollWidth > nick.clientWidth + 0.5 || header.scrollWidth > header.clientWidth + 0.5);
    while (tight() && scale > minScale) {
        scale = Math.round((scale - 0.01) * 100) / 100;
        header.style.setProperty('--hs', String(scale));
    }
    return scale;
}
