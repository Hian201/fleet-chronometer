import { describe, expect, it } from 'vitest';
import {
    COMBINED_GAP, HEAD_H, LBAS_SUB_H, PHOTO_REGIONS,
    basePhotoSignature, defaultFleetPhotoType, isBlankSample, photoLayout, regionToCanvasPx, shipPhotoSignature,
} from '../utils/fleet-photo';

describe('regionToCanvasPx', () => {
    it('原生 1200×720 畫布原樣回傳', () => {
        expect(regionToCanvasPx(PHOTO_REGIONS.ship, 1200, 720)).toEqual(PHOTO_REGIONS.ship);
    });
    it('依畫布實際像素等比換算', () => {
        expect(regionToCanvasPx(PHOTO_REGIONS.lbas, 2400, 1440)).toEqual({ x: 1724, y: 548, width: 668, height: 844 });
    });
    it('夾在畫布範圍內，量不到畫布時回 null', () => {
        expect(regionToCanvasPx({ x: 1100, y: 600, width: 300, height: 300 }, 1200, 720)).toEqual({ x: 1100, y: 600, width: 100, height: 120 });
        expect(regionToCanvasPx(PHOTO_REGIONS.ship, 0, 720)).toBeNull();
        expect(regionToCanvasPx({ x: 1300, y: 0, width: 10, height: 10 }, 1200, 720)).toBeNull();
    });
});

describe('isBlankSample', () => {
    it('全透明或全同色視為空白', () => {
        expect(isBlankSample([0, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
        expect(isBlankSample([0, 0, 0, 255, 0, 0, 0, 255])).toBe(true);
    });
    it('有不同顏色的不透明像素就不是空白', () => {
        expect(isBlankSample([240, 236, 224, 255, 40, 40, 40, 255])).toBe(false);
    });
});

describe('defaultFleetPhotoType', () => {
    it('連合艦隊依 combined flag', () => {
        expect(defaultFleetPhotoType('combined', 12, 1)).toBe('ctf');
        expect(defaultFleetPhotoType('combined', 12, 2)).toBe('stf');
        expect(defaultFleetPhotoType('combined', 12, 3)).toBe('tef');
        expect(defaultFleetPhotoType('combined', 12, 0)).toBe('normal');
    });
    it('七艘為遊擊部隊，其餘為通常艦隊', () => {
        expect(defaultFleetPhotoType('fleet', 7, 0)).toBe('striking');
        expect(defaultFleetPhotoType('fleet', 6, 1)).toBe('normal');
    });
});

describe('photoLayout', () => {
    it('單一艦隊 2 欄、由左而右再往下（2/3 尺寸與範例圖同為 912×1092）', () => {
        const l = photoLayout({ kind: 'fleet', counts: [6], header: false, scale: 2 / 3 });
        expect([l.width, l.height]).toEqual([912, 1092]);
        expect(l.cells.map(c => [c.x, c.y])).toEqual([[0, 0], [456, 0], [0, 364], [456, 364], [0, 728], [456, 728]]);
    });
    it('七艘排 4 列，第七艘在左欄', () => {
        const l = photoLayout({ kind: 'fleet', counts: [7], header: true, scale: 1 });
        expect(l.height).toBe(HEAD_H + 4 * 546);
        expect(l.cells[6]).toMatchObject({ x: 0, y: HEAD_H + 3 * 546 });
    });
    it('連合艦隊主力｜護衛並排，中間留間距', () => {
        const l = photoLayout({ kind: 'combined', counts: [6, 6], header: true, scale: 1 });
        expect(l.width).toBe(4 * 684 + COMBINED_GAP);
        expect(l.blocks[1].x).toBe(2 * 684 + COMBINED_GAP);
        expect(l.cells.filter(c => c.block === 1)[0]).toMatchObject({ x: 2 * 684 + COMBINED_GAP, y: HEAD_H });
    });
    it('基地航空隊依基地數排一列，第二行標題逐欄對齊', () => {
        const l = photoLayout({ kind: 'lbas', counts: [2], header: true, lbasSub: true, scale: 1 });
        expect([l.width, l.height]).toEqual([2 * 334, HEAD_H + LBAS_SUB_H + 422]);
        expect(l.columnX).toEqual([0, 334]);
        const noSub = photoLayout({ kind: 'lbas', counts: [3], header: true, lbasSub: false, scale: 1 });
        expect(noSub.subHeight).toBe(0);
    });
});

describe('變更簽章', () => {
    const ship = { id: 10, mst: 545, gears: [{ mst: 9, level: 10 }, null], exGear: { mst: 66, level: 0 } };
    it('換裝備或改修會改變，Lv 等其他欄位不列入', () => {
        const base = shipPhotoSignature(ship);
        expect(shipPhotoSignature({ ...ship, lv: 99 } as typeof ship)).toBe(base);
        expect(shipPhotoSignature({ ...ship, gears: [{ mst: 9, level: 9 }, null] })).not.toBe(base);
        expect(shipPhotoSignature({ ...ship, mst: 546 })).not.toBe(base);
    });
    it('基地航空隊只看中隊配置與改修', () => {
        const sq = [{ state: 1, mst: 168, level: 2 }, { state: 2, mst: 0, level: 0 }];
        expect(basePhotoSignature(sq)).toBe('168+2,-');
        expect(basePhotoSignature([{ ...sq[0], level: 3 }, sq[1]])).not.toBe(basePhotoSignature(sq));
    });
});
