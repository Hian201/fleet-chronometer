import { describe, expect, it } from 'vitest';
import { cropRectPx } from '../utils/screenshot';

describe('cropRectPx：CSS px 裁切矩形 → 擷取圖（裝置像素）來源矩形', () => {
    it('依 dpr 換算並四捨五入', () => {
        const crop = cropRectPx({ x: 10, y: 20, width: 300, height: 200 }, 2, 2000, 1500);
        expect(crop).toEqual({ sx: 20, sy: 40, sw: 600, sh: 400 });
    });

    it('dpr=1 時原樣通過', () => {
        const crop = cropRectPx({ x: 0, y: 0, width: 1200, height: 720 }, 1, 1200, 720);
        expect(crop).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 720 });
    });

    it('矩形超出擷取圖範圍時夾在圖片邊界內（頁面被捲動導致框只剩一部分可見）', () => {
        const crop = cropRectPx({ x: 900, y: 600, width: 400, height: 300 }, 1, 1000, 700);
        expect(crop).toEqual({ sx: 900, sy: 600, sw: 100, sh: 100 });
    });

    it('矩形完全落在擷取圖範圍外時回 null，不裁出負尺寸的圖', () => {
        expect(cropRectPx({ x: 2000, y: 2000, width: 100, height: 100 }, 1, 1000, 700)).toBeNull();
        // 右緣 -500+100=-400 仍在畫面左側之外，整個矩形都看不到
        expect(cropRectPx({ x: -500, y: 0, width: 100, height: 100 }, 1, 1000, 700)).toBeNull();
    });

    it('負座標的矩形先夾在 0，寬高跟著扣掉超出的部分', () => {
        const crop = cropRectPx({ x: -50, y: -20, width: 200, height: 100 }, 1, 1000, 700);
        expect(crop).toEqual({ sx: 0, sy: 0, sw: 150, sh: 80 });
    });
});
