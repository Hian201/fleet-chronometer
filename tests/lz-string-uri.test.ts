import { describe, expect, it } from 'vitest';
import {
    LZ_STRING_URI_BROWSER_SRC, compressToEncodedURIComponent, decompressFromEncodedURIComponent,
} from '../utils/lz-string-uri';
import { viewerHtml } from '../entrypoints/overview/viewer-html';

describe('LZ-String URI 安全壓縮（battleplayer 1.4.4）', () => {
    it('與官方 1.4.4 向量一致，且可往返', () => {
        expect(compressToEncodedURIComponent('hello')).toBe('BYUwNmD2Q');
        expect(decompressFromEncodedURIComponent('BYUwNmD2Q')).toBe('hello');
        const json = '{"combined":2,"fleetnum":1,"battles":[]}';
        expect(decompressFromEncodedURIComponent(compressToEncodedURIComponent(json))).toBe(json);
    });

    it('viewer 內嵌腳本與模組輸出相同', () => {
        const browser = new Function(
            `${LZ_STRING_URI_BROWSER_SRC}; return compressToEncodedURIComponent;`,
        )() as (s: string) => string;
        const sample = '{"combined":2,"world":61,"mapnum":5,"hq":"鎮守府"}';
        expect(browser(sample)).toBe(compressToEncodedURIComponent(sample));
        expect(viewerHtml()).toContain(LZ_STRING_URI_BROWSER_SRC);
    });
});
