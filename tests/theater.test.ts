import { describe, expect, it } from 'vitest';
import {
    ATTR_ACTIVE, ATTR_ANCESTOR, ATTR_FRAME, ATTR_HIDDEN,
    CSS_CLIP, CSS_TX, CSS_TY, CSS_ZOOM,
    GAME_SCREEN_ASPECT, MAX_ZOOM, MIN_ZOOM, clampPan, clampZoom, contentArea, fallbackGameArea,
    fitZoom, framePlacement, resizeZoom,
    pickGameFrame, theaterCss, zoomByWheel,
} from '../utils/theater';

describe('pickGameFrame：遊戲框辨識', () => {
    // DMM 遊戲頁是 SPA，DOM 結構不可依賴，故辨識只靠 src 主機名（確定證據）與尺寸（啟發式）。
    it('主機名命中時優先於尺寸，即使廣告框更大', () => {
        const picked = pickGameFrame([
            { src: 'https://ad.example.com/huge', width: 1600, height: 1200 },
            { src: 'http://w01.kancolle-server.com/kcs2/index.php', width: 1200, height: 720 },
        ]);
        expect(picked?.src).toContain('kancolle-server.com');
    });

    it('舊入口的 DMM gadget 框（osapi）同樣視為遊戲框', () => {
        const picked = pickGameFrame([
            { src: 'https://osapi.dmm.com/gadgets/ifr?url=...', width: 1200, height: 720 },
            { src: 'https://www.dmm.com/banner', width: 728, height: 90 },
        ]);
        expect(picked?.src).toContain('osapi.dmm.com');
    });

    it('沒有主機名線索時退回「夠大的那一個」', () => {
        const picked = pickGameFrame([
            { src: 'https://example.com/small', width: 300, height: 250 },
            { src: 'https://example.com/player', width: 1200, height: 720 },
        ]);
        expect(picked?.src).toContain('player');
    });

    // 舊版對整段 src 做子字串比對，惡意頁面只要在 query／路徑裡塞一段遊戲主機名，就能讓
    // 自己的框被當成「確定證據」挑中——被放大到整個視窗，拍照裁切也會算到它身上。
    it('src 裡冒充遊戲主機名的字串不算證據（只認解析後的主機名）', () => {
        const spoofs = [
            'https://attacker.example/ad?ref=kancolle-server.com',
            'https://kancolle-server.com.attacker.example/index.php',
            'https://evil-kancolle-server.com/kcs2/index.php',
            'https://attacker.example/gadgets/ifr?url=x',
            'https://attacker.example/osapi.dmm.com/game',
        ];
        for (const src of spoofs) {
            // 小框：既不是主機名證據，也不夠大，故完全挑不中。
            expect(pickGameFrame([{ src, width: 300, height: 250 }]), src).toBeNull();
            // 大框：仍可能被尺寸啟發式挑中（那是既有行為），但不得升級成「確定證據」而
            // 蓋過真正的遊戲框。
            const picked = pickGameFrame([
                { src, width: 1600, height: 1200 },
                { src: 'http://w01.kancolle-server.com/kcs2/index.php', width: 1200, height: 720 },
            ]);
            expect(picked?.src, src).toContain('w01.kancolle-server.com');
        }
    });

    it('子網域算數，解析不出來的 src 一律當不可用（不猜）', () => {
        expect(pickGameFrame([
            { src: 'https://osapi.dmm.com/gadgets/ifr?url=...', width: 1200, height: 720 },
        ])?.src).toContain('osapi.dmm.com');
        // 相對路徑、about:blank、空字串都不是可用候選，即使尺寸夠大也不挑。
        for (const src of ['/game/iframe.html', 'about:blank', '']) {
            expect(pickGameFrame([{ src, width: 1600, height: 1200 }]), src).toBeNull();
        }
    });

    it('追蹤／分析用框一律排除，即使尺寸被撐大', () => {
        const picked = pickGameFrame([
            { src: 'https://www.googletagmanager.com/ns.html?id=GTM-X', width: 1600, height: 900 },
        ]);
        expect(picked).toBeNull();
    });

    // 挑錯框會把 DMM 的廣告放大到整個視窗，比「沒作用」更糟，故寧可回 null。
    it('全部都是小框時回 null，不亂挑', () => {
        expect(pickGameFrame([
            { src: 'https://example.com/a', width: 300, height: 250 },
            { src: 'https://example.com/b', width: 0, height: 0 },
        ])).toBeNull();
        expect(pickGameFrame([])).toBeNull();
    });
});

describe('縮放與平移幾何', () => {
    it('clampZoom 夾在上下限，壞值回 1', () => {
        expect(clampZoom(100)).toBe(MAX_ZOOM);
        expect(clampZoom(0.01)).toBe(MIN_ZOOM);
        expect(clampZoom(Number.NaN)).toBe(1);
    });

    it('滾輪向上（deltaY 為負）放大、向下縮小，且不越界', () => {
        expect(zoomByWheel(1, -100)).toBeGreaterThan(1);
        expect(zoomByWheel(1, 100)).toBeLessThan(1);
        expect(zoomByWheel(MAX_ZOOM, -1000)).toBe(MAX_ZOOM);
        expect(zoomByWheel(MIN_ZOOM, 1000)).toBe(MIN_ZOOM);
        expect(zoomByWheel(1, 0)).toBe(1);
    });

    it('fitZoom 讓畫面完整可見、等比例呈現（取兩軸較嚴格者，寧可留黑邊也不裁畫面）', () => {
        expect(fitZoom({ width: 1000, height: 600 }, { width: 1200, height: 720 }))
            .toBeCloseTo(1000 / 1200, 5);
        // 高度才是瓶頸時取高度比——寬度會因此留黑邊，但畫面完整不被裁切
        expect(fitZoom({ width: 3000, height: 600 }, { width: 1200, height: 720 }))
            .toBeCloseTo(600 / 720, 5);
        // 尺寸不可考（框還沒 layout）時不要吐 0／Infinity
        expect(fitZoom({ width: 1000, height: 600 }, { width: 0, height: 0 })).toBe(1);
    });

    it('手動倍率在視窗縮放後維持相對於適應的比例', () => {
        // 原本適應 80%，手動放到 100%（= 適應的 1.25 倍）；新視窗的適應為 96%，
        // 應跟著變為 120%，而不是停在 100% 留下黑邊。
        expect(resizeZoom(1, 0.8, 0.96)).toBeCloseTo(1.2, 5);
        // 壞的舊適應值不可讓縮放變成 NaN／Infinity。
        expect(resizeZoom(1, 0, 0.96)).toBe(1);
    });

    // 沒有超出視窗卻還能平移，遊戲會被拖到角落且看起來像壞掉。
    it('未超出視窗的軸強制不平移', () => {
        expect(clampPan({ x: 500, y: 500 }, { width: 1920, height: 1080 }, { width: 1200, height: 720 }, 1))
            .toEqual({ x: 0, y: 0 });
    });

    it('超出視窗時平移量夾在溢出範圍內（兩軸皆為溢出量的一半，因為畫面是置中的）', () => {
        const pan = clampPan(
            { x: 9999, y: 9999 },
            { width: 1000, height: 600 },
            { width: 1200, height: 720 },
            2,
        );
        expect(pan.x).toBe((1200 * 2 - 1000) / 2);
        expect(pan.y).toBe((720 * 2 - 600) / 2);
    });
});

// 使用者實機回報「畫面裁切失敗」：DMM 遊戲框裡除了遊戲，還包著頁尾按鈕與大片白底，
// 拿整個 iframe 去 fit 會讓遊戲縮得比視窗小、下方留一條白。要顯示的是**遊戲畫布**。
describe('裁切到遊戲畫布（contentArea／framePlacement）', () => {
    const frame = { width: 1200, height: 1000 };
    // 畫布在框內偏上，下面 280px 是頁尾與白底
    const canvas = { x: 0, y: 0, width: 1200, height: 720 };

    it('量不到畫布時退回整個框，且不裁切（不猜一個矩形）', () => {
        expect(contentArea(frame, null)).toEqual({ x: 0, y: 0, width: 1200, height: 1000 });
        expect(framePlacement({ width: 1200, height: 1000 }, frame, null, 1, { x: 0, y: 0 }).clip)
            .toBe('none');
    });

    it('畫布量測失敗時，以實機截圖證實的 5:3 遊戲區裁掉明顯頁尾', () => {
        expect(GAME_SCREEN_ASPECT).toBeCloseTo(1600 / 960, 5);
        expect(fallbackGameArea({ width: 1600, height: 1280 }))
            .toEqual({ x: 0, y: 0, width: 1600, height: 960 });
        // 本來就是單純遊戲框時不可憑比例多裁一刀。
        expect(fallbackGameArea({ width: 1200, height: 720 })).toBeNull();
    });

    it('fit 依畫布高度算，不把頁尾白底算進去', () => {
        // 視窗 1200×720：整個框（1000 高）只能縮到 0.72，但畫布（720 高）剛好 1.0
        expect(fitZoom({ width: 1200, height: 720 }, contentArea(frame, null))).toBeCloseTo(0.72, 5);
        expect(fitZoom({ width: 1200, height: 720 }, contentArea(frame, canvas))).toBeCloseTo(1, 5);
    });

    it('裁掉畫布以外的部分（inset 的四邊＝框與畫布的差）', () => {
        const placement = framePlacement({ width: 1200, height: 720 }, frame, canvas, 1, { x: 0, y: 0 });
        // 上 0、右 0、下 280（1000-720）、左 0
        expect(placement.clip).toBe('inset(0px 0px 280px 0px)');
        expect(placement.translateX).toBe(0);
        expect(placement.translateY).toBe(0);
    });

    it('畫布不在框的左上角時，位移要把畫布拉回視窗正中央', () => {
        const offset = { x: 40, y: 60, width: 1000, height: 600 };
        const placement = framePlacement({ width: 1200, height: 800 }, frame, offset, 1, { x: 0, y: 0 });
        // 畫布左上角應落在 ((1200-1000)/2, (800-600)/2) = (100, 100)
        expect(placement.translateX + offset.x).toBe(100);
        expect(placement.translateY + offset.y).toBe(100);
        expect(placement.clip).toBe('inset(60px 160px 340px 40px)');
    });

    it('縮放後仍然置中（位移要把縮放算進去）', () => {
        const placement = framePlacement({ width: 1200, height: 800 }, frame, canvas, 0.5, { x: 0, y: 0 });
        // 畫布縮成 600×360，左上角應在 (300, 220)
        expect(placement.translateX + canvas.x * 0.5).toBe(300);
        expect(placement.translateY + canvas.y * 0.5).toBe(220);
    });
});

describe('theaterCss', () => {
    // 標記屬性與 CSS 變數是 content script 與樣式表之間的唯一契約，改名要兩邊一起改。
    it('涵蓋四個標記屬性與四個 CSS 變數', () => {
        const css = theaterCss();
        for (const attr of [ATTR_ACTIVE, ATTR_ANCESTOR, ATTR_FRAME, ATTR_HIDDEN]) {
            expect(css).toContain(attr);
        }
        for (const cssVar of [CSS_ZOOM, CSS_TX, CSS_TY, CSS_CLIP]) {
            expect(css).toContain(cssVar);
        }
    });

    // 座標運算假設「框的版面原點＝容器左上角」，故這兩條是 framePlacement 成立的前提。
    it('遊戲框固定 transform-origin: 0 0 且為 block（消除行內元素的 baseline 空隙）', () => {
        const css = theaterCss();
        expect(css).toContain('transform-origin: 0 0');
        expect(css).toContain('display: block');
    });

    it('不改變遊戲框的 DOM 位置，只用 transform 縮放（搬動節點＝遊戲重載）', () => {
        const css = theaterCss();
        expect(css).toContain('transform: translate(');
        expect(css).toContain('scale(');
    });
});
