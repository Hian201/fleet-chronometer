import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const STAT_DIR = join(projectRoot, 'public/icons/stat');
const KEYS = [
    'hp', 'fire', 'armor', 'torp', 'evade', 'aa', 'slot', 'asw',
    'speed', 'los', 'range', 'luck', 'acc', 'bomb', 'morale', 'night', 'air',
] as const;

describe('數值圖示（public/icons/stat）', () => {
    it('17 顆皆由生成器產出，帶統一深墨描邊', () => {
        const files = readdirSync(STAT_DIR).filter((f) => f.endsWith('.svg')).sort();
        expect(files).toEqual([...KEYS].map((k) => `${k}.svg`).sort());
        for (const name of files) {
            const svg = readFileSync(join(STAT_DIR, name), 'utf8');
            expect(svg).toContain('viewBox="0 0 32 32"');
            expect(svg).toContain('feMorphology');
            expect(svg).toContain('#37302a');
            expect(svg).toContain('class="a"');
        }
    });
});
