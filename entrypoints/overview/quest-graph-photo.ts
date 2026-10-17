// 任務關係圖「拍照」：把放大檢視裡的關係圖（節點＋連線）畫到 canvas，存成 PNG。
// 不用 tabs.captureVisibleTab：情報總括頁上的按鈕不會授予 activeTab，而且只拍得到可視範圍。
// 顏色、字型、虛線框與追蹤高亮都讀畫面上的計算樣式，和目前主題、「顯示已滿足」與高亮一致；
// 輸出整張圖（含捲出畫面的部分），倍率由 questGraphPhotoScale() 決定，不受畫面縮放影響。
import { formatDateTime } from '@/utils/date-format';
import { questGraphPhotoScale, wrapQuestGraphText } from '@/utils/quest-graph-photo';

const PAD = 24;
const HEAD = 44;

const num = (value: string): number => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** 透明或無法解析的顏色回傳 fallback（computed 的 color-mix 結果交給 canvas 解析）。 */
function paint(value: string, fallback: string): string {
    return !value || value === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(value) ? fallback : value;
}

function fontOf(style: CSSStyleDeclaration): string {
    return `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

function drawNode(ctx: CanvasRenderingContext2D, node: HTMLElement, background: string): void {
    const style = getComputedStyle(node);
    const x = num(node.style.left), y = num(node.style.top);
    const w = num(node.style.width), h = num(node.style.height);
    const radius = num(style.borderTopLeftRadius);
    ctx.save();
    ctx.globalAlpha = num(style.opacity) || 1;
    ctx.beginPath();
    ctx.roundRect(x + .5, y + .5, w - 1, h - 1, radius);
    ctx.fillStyle = paint(style.backgroundColor, background);
    ctx.fill();
    ctx.lineWidth = num(style.borderTopWidth) || 1;
    ctx.strokeStyle = paint(style.borderTopColor, '#888');
    ctx.setLineDash(style.borderTopStyle === 'dashed' ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // 「現在就能做」的節點在左緣有一條 3px 色帶（inset box-shadow）
    if (node.classList.contains('is-now')) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = paint(style.borderTopColor, '#888');
        ctx.fillRect(x, y, 3, h);
        ctx.restore();
    }

    const padX = num(style.paddingLeft);
    let cursorY = y + num(style.paddingTop) + num(style.borderTopWidth);
    const innerWidth = w - padX * 2 - 2;
    ctx.textBaseline = 'top';

    const code = node.querySelector<HTMLElement>('b');
    if (code) {
        const codeStyle = getComputedStyle(code);
        const size = num(codeStyle.fontSize);
        let textX = x + padX + 1;
        const mark = code.querySelector<HTMLElement>('.qc-mark');
        if (mark) {
            const markStyle = getComputedStyle(mark);
            const markW = num(markStyle.width) || 4;
            const markH = size * .95;
            const markY = cursorY + (size * 1.2 - markH) / 2;
            const fill = paint(markStyle.backgroundColor, '');
            if (fill) {
                ctx.fillStyle = fill;
                ctx.fillRect(textX, markY, markW, markH);
            } else {
                ctx.lineWidth = 1;
                ctx.strokeStyle = paint(markStyle.borderTopColor, '#888');
                ctx.strokeRect(textX + .5, markY + .5, markW - 1, markH - 1);
            }
            textX += markW + num(markStyle.marginRight);
        }
        ctx.font = fontOf(codeStyle);
        ctx.fillStyle = codeStyle.color;
        ctx.fillText(code.textContent?.trim() ?? '', textX, cursorY);
        cursorY += size * 1.2 + num(style.rowGap || style.gap);
    }

    const name = node.querySelector<HTMLElement>('span');
    if (name) {
        const nameStyle = getComputedStyle(name);
        const lineHeight = num(nameStyle.lineHeight) || num(nameStyle.fontSize) * 1.3;
        ctx.font = fontOf(nameStyle);
        ctx.fillStyle = nameStyle.color;
        const lines = wrapQuestGraphText(name.textContent ?? '', innerWidth, 2, value => ctx.measureText(value).width);
        lines.forEach((line, index) => ctx.fillText(line, x + padX + 1, cursorY + index * lineHeight));
    }
    ctx.restore();
}

/** 畫出 graph（.qf-graph）整張圖，含標題列；回傳 PNG Blob。 */
export async function renderQuestGraphPhoto(graph: HTMLElement, title: string, ts: number): Promise<Blob> {
    const width = num(graph.style.width);
    const height = num(graph.style.height);
    if (!(width > 0 && height > 0)) throw new Error('graph size unavailable');
    const container = graph.closest<HTMLElement>('.qf-graph-dialog') ?? graph;
    const containerStyle = getComputedStyle(container);
    const background = paint(containerStyle.backgroundColor, '#1b2230');
    const heading = container.querySelector<HTMLElement>('h3');
    const headingStyle = heading ? getComputedStyle(heading) : containerStyle;

    const totalW = width + PAD * 2;
    const totalH = height + HEAD + PAD * 2;
    const scale = questGraphPhotoScale(totalW, totalH);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(totalW * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.scale(scale, scale);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, totalW, totalH);

    // 標題列：任務代號與名稱，右側為拍攝時間（年/月/日 24 小時制）
    ctx.textBaseline = 'middle';
    const stamp = formatDateTime(ts, false);
    ctx.font = `400 12px ${containerStyle.fontFamily}`;
    const stampWidth = ctx.measureText(stamp).width;
    ctx.fillStyle = paint(getComputedStyle(container.querySelector('.qf-graph-zoom-value') ?? container).color, '#999');
    ctx.fillText(stamp, totalW - PAD - stampWidth, PAD + 12);
    ctx.font = `600 15px ${headingStyle.fontFamily}`;
    ctx.fillStyle = paint(headingStyle.color, '#e8c26a');
    const [titleLine] = wrapQuestGraphText(title, totalW - PAD * 3 - stampWidth, 1, value => ctx.measureText(value).width);
    ctx.fillText(titleLine ?? '', PAD, PAD + 12);

    ctx.translate(PAD, PAD + HEAD);
    for (const path of graph.querySelectorAll<SVGPathElement>('path.qf-edge')) {
        const style = getComputedStyle(path);
        ctx.save();
        ctx.globalAlpha = num(style.opacity) || 1;
        ctx.strokeStyle = paint(style.stroke, '#888');
        ctx.lineWidth = num(style.strokeWidth) || 1.2;
        ctx.stroke(new Path2D(path.getAttribute('d') ?? ''));
        ctx.restore();
    }
    for (const node of graph.querySelectorAll<HTMLElement>('.qf-node')) drawNode(ctx, node, background);

    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('canvas toBlob failed'))), 'image/png');
    });
}
