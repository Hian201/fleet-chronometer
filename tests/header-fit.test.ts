// entrypoints/panel/header-fit.ts 單元測試：驗證有／無 .nick 時的單行縮放行為。
import { describe, expect, it } from 'vitest';
import { fitHeaderScale, HEADER_MIN_SCALE } from '../entrypoints/panel/header-fit';

interface FakeHeaderOpts {
    clientWidth: number;
    scrollWidthAtScale: (scale: number) => number;
    nick?: { clientWidth: number; scrollWidthAtScale: (scale: number) => number };
}

function makeFakeHeader(opts: FakeHeaderOpts): HTMLElement {
    let scale = 1;
    const nickEl = opts.nick
        ? ({
            get clientWidth() { return opts.nick!.clientWidth; },
            get scrollWidth() { return opts.nick!.scrollWidthAtScale(scale); },
        } as unknown as HTMLElement)
        : null;
    return {
        style: {
            setProperty(name: string, value: string) {
                if (name === '--hs') scale = Number(value);
            },
        },
        querySelector(sel: string) {
            return sel === '.nick' ? nickEl : null;
        },
        get clientWidth() { return opts.clientWidth; },
        get scrollWidth() { return opts.scrollWidthAtScale(scale); },
    } as unknown as HTMLElement;
}

describe('fitHeaderScale', () => {
    it('空間足夠時維持 1', () => {
        const header = makeFakeHeader({
            clientWidth: 370,
            scrollWidthAtScale: () => 340,
            nick: { clientWidth: 100, scrollWidthAtScale: () => 80 },
        });
        expect(fitHeaderScale(header)).toBe(1);
    });

    it('.nick 截斷時依 1% 級距縮小到剛好放得下', () => {
        const header = makeFakeHeader({
            clientWidth: 370,
            scrollWidthAtScale: () => 370,
            nick: { clientWidth: 120, scrollWidthAtScale: s => Math.round(140 * s) },
        });
        const scale = fitHeaderScale(header);
        expect(scale).toBe(0.86);
        expect(Math.round(140 * scale)).toBeLessThanOrEqual(120.5);
    });

    it('沒有 .nick（釘選戰果頁首）但整列超出寬度時仍會等比縮小', () => {
        const header = makeFakeHeader({
            clientWidth: 370,
            scrollWidthAtScale: s => Math.round(410 * s),
        });
        const scale = fitHeaderScale(header);
        expect(scale).toBeLessThan(1);
        expect(Math.round(410 * scale)).toBeLessThanOrEqual(370.5);
    });

    it('隱藏的 .nick（clientWidth === 0）不阻礙縮小且整列寬度夠時維持 1', () => {
        const fitHeader = makeFakeHeader({
            clientWidth: 370,
            scrollWidthAtScale: () => 350,
            nick: { clientWidth: 0, scrollWidthAtScale: () => 999 },
        });
        expect(fitHeaderScale(fitHeader)).toBe(1);

        const tightHeader = makeFakeHeader({
            clientWidth: 370,
            scrollWidthAtScale: s => Math.round(560 * s),
            nick: { clientWidth: 0, scrollWidthAtScale: () => 999 },
        });
        expect(fitHeaderScale(tightHeader)).toBe(HEADER_MIN_SCALE);
    });
});
