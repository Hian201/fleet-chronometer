// 把出擊重播畫成正方形分享卡（邊長 400 起跳，JSON 太長再放大），並把 toKc3Replay JSON 寫進 PNG alpha。
// canvas／下載必須在 overview；編碼公式在 utils/steganography.ts。
import { downloadBlob } from './lib';
import { buildReplayCardModel, replayExportStem, type ReplayCardModel } from '../../utils/replay-card';
import { toKc3Replay } from '../../utils/replay';
import type { ReplayRow } from '../../utils/db';
import {
    encodeIntoImageData, replayPngScale, REPLAY_PNG_BASE,
} from '../../utils/steganography';

const COLOR = {
    panel: '#182030',
    line: '#2a3548',
    text: '#cfd6e4',
    dim: '#7d8aa0',
    brass: '#b8860b',
    sparkle: '#e6c35c',
};

function fillRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
}

function drawCard(ctx: CanvasRenderingContext2D, model: ReplayCardModel, size: number) {
    const s = size / REPLAY_PNG_BASE;
    ctx.fillStyle = COLOR.panel;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = COLOR.brass;
    ctx.lineWidth = 2 * s;
    ctx.strokeRect(s, s, size - 2 * s, size - 2 * s);

    const pad = 10 * s;
    let y = 8 * s;
    ctx.font = `${10 * s}px system-ui, sans-serif`;
    ctx.fillStyle = COLOR.dim;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(model.brand, pad, y);
    ctx.textAlign = 'right';
    ctx.fillText('REPLAY', size - pad, y);
    ctx.textAlign = 'left';

    y += 13 * s;
    ctx.font = `700 ${20 * s}px system-ui, sans-serif`;
    ctx.fillStyle = COLOR.sparkle;
    ctx.fillText(model.hq, pad, y, size - pad * 2);

    y += 23 * s;
    ctx.font = `${12 * s}px system-ui, sans-serif`;
    ctx.fillStyle = COLOR.dim;
    ctx.fillText(`${model.combined} · ${model.date}`, pad, y, size - pad * 2);

    y += 16 * s;
    const mapRowH = 24 * s;
    const mapMid = y + mapRowH / 2;
    ctx.textBaseline = 'middle';
    let x = pad;
    if (model.event) {
        ctx.font = `${17 * s}px system-ui, sans-serif`;
        ctx.fillStyle = COLOR.dim;
        ctx.fillText(model.event, x, mapMid);
        x += ctx.measureText(model.event).width + 6 * s;
    }
    ctx.font = `700 ${22 * s}px system-ui, sans-serif`;
    ctx.fillStyle = COLOR.text;
    ctx.fillText(model.map, x, mapMid);
    x += ctx.measureText(model.map).width + 6 * s;
    if (model.diff) {
        ctx.font = `normal 700 ${13 * s}px system-ui, sans-serif`;
        const inset = 5 * s;
        const tw = ctx.measureText(model.diff).width + inset * 2;
        const badgeH = 22 * s;
        const badgeY = mapMid - badgeH / 2;
        fillRound(ctx, x, badgeY, tw, badgeH, 3 * s, COLOR.panel, COLOR.sparkle);
        ctx.fillStyle = COLOR.sparkle;
        ctx.fillText(model.diff, x + inset, mapMid);
    }
    ctx.textBaseline = 'top';

    y += mapRowH + 6 * s;
    const combined = model.fleet2.length > 0;
    const colGap = 10 * s;
    const colW = combined ? (size - pad * 2 - colGap) / 2 : size - pad * 2;
    const cols = combined ? [model.fleet1, model.fleet2] : [model.fleet1];
    const titles = combined ? [model.fleet1Title, model.fleet2Title] : [model.fleet1Title];
    const rows = Math.max(1, ...cols.map(c => c.length));
    const titleH = 14 * s;
    const trailH = 22 * s;
    const hintH = 13 * s;
    const fleetBottom = size - pad - hintH - 3 * s - trailH - 6 * s;
    const rowH = (fleetBottom - y - titleH) / rows;
    const nameSize = clamp(rowH * 0.88, combined ? 18 * s : 20 * s, combined ? 24 * s : 28 * s);

    cols.forEach((ships, i) => {
        const cx = pad + i * (colW + colGap);
        ctx.font = `600 ${12 * s}px system-ui, sans-serif`;
        ctx.fillStyle = COLOR.brass;
        ctx.fillText(titles[i], cx, y);
        ships.forEach((name, n) => {
            ctx.font = `${nameSize}px system-ui, sans-serif`;
            ctx.fillStyle = COLOR.text;
            ctx.fillText(name, cx, y + titleH + n * rowH, colW);
        });
    });

    const trailY = y + titleH + rows * rowH + 4 * s;
    let nx = pad;
    ctx.font = `700 ${13 * s}px system-ui, sans-serif`;
    for (const node of model.nodes) {
        const w = Math.max(22 * s, ctx.measureText(node.letter).width + 10 * s);
        fillRound(
            ctx, nx, trailY, w, trailH, 3 * s, COLOR.panel,
            node.last ? COLOR.sparkle : COLOR.line,
        );
        ctx.fillStyle = node.last ? COLOR.sparkle : COLOR.text;
        ctx.fillText(node.letter, nx + 5 * s, trailY + 3 * s);
        nx += w + 5 * s;
    }
    ctx.font = `${11 * s}px system-ui, sans-serif`;
    ctx.fillStyle = COLOR.dim;
    ctx.fillText(model.hint, pad, trailY + trailH + 3 * s);
}

export async function downloadReplayPng(row: ReplayRow, shipName: (mst: number) => string): Promise<void> {
    const json = JSON.stringify(toKc3Replay(row));
    const scale = replayPngScale(json.length);
    const size = REPLAY_PNG_BASE * scale;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas');
    drawCard(ctx, buildReplayCardModel(row, shipName), size);
    const image = ctx.getImageData(0, 0, size, size);
    encodeIntoImageData(image, json);
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('png')), 'image/png');
    });
    downloadBlob(`${replayExportStem(row)}.png`, blob);
}
