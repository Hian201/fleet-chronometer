import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    decodeFromImageData, encodeIntoImageData, hidingCapacity, replayPngScale, REPLAY_PNG_BASE,
} from '../utils/steganography';

function blank(width: number, height = width): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 24; data[i + 1] = 32; data[i + 2] = 48; data[i + 3] = 255;
    }
    return { data, width, height, colorSpace: 'srgb' };
}

function roundtrip(message: string, size = REPLAY_PNG_BASE): string {
    const image = blank(size);
    encodeIntoImageData(image, message);
    return decodeFromImageData(image);
}

describe('steganography', () => {
    it('400×400 容量是 30000 字，與 KC3Kai exportBattleImg 同一條', () => {
        expect(hidingCapacity(400)).toBe(30_000);
        expect(replayPngScale(30_000)).toBe(2);
        expect(replayPngScale(29_000)).toBe(1);
        expect(replayPngScale(31_000)).toBe(2);
    });

    it('ASCII／中日文／JSON 往返後相同', () => {
        expect(roundtrip('hello')).toBe('hello');
        expect(roundtrip('暁の水平線')).toBe('暁の水平線');
        expect(roundtrip('{"hq":"鎮守府","map":"E5"}')).toBe('{"hq":"鎮守府","map":"E5"}');
    });

    it('連合艦隊真實重播 JSON 放大畫布後仍能解回', () => {
        const json = readFileSync(new URL('../samples/61-5-jibun-rengou-node52.json', import.meta.url), 'utf8');
        const scale = replayPngScale(json.length);
        expect(scale).toBeGreaterThan(1);
        expect(roundtrip(json, REPLAY_PNG_BASE * scale)).toBe(json);
    });
});
