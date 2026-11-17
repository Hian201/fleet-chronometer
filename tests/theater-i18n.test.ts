import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGS } from '../utils/lang';
import { THEATER_STRINGS, tTheater } from '../utils/theater-i18n';
import { tFor } from '../utils/ui-i18n';

const ROOT = resolve(__dirname, '..');
const ENTRY = resolve(ROOT, 'entrypoints/theater.content.ts');

// theater.content.ts 實際用到的 15 個鍵（程式碼裡的 t('…') 呼叫）。
const USED_KEYS = [
    'theater.enter', 'theater.exit', 'theater.mute', 'theater.unmute', 'theater.screenshot',
    'theater.popIn', 'theater.hint', 'theater.popoutHint', 'theater.muteNoTab', 'theater.notFound',
    'theater.popInFailed', 'theater.popoutFailed',
    'screenshot.done', 'screenshot.failed', 'screenshot.noReply',
];

describe('劇場工具列文案', () => {
    for (const { code } of LANGS) {
        it(`${code} 的 15 個鍵都可取得，且與 ui-i18n 同值`, () => {
            for (const key of USED_KEYS) {
                const s = tTheater(code, key);
                expect(s, `${code} ${key}`).not.toBe('');
                expect(s, `${code} ${key} 缺譯`).not.toBe(key);
                expect(s, `${code} ${key} 與 ui-i18n 分叉`).toBe(tFor(code, key));
            }
            expect(Object.keys(THEATER_STRINGS[code]).sort()).toEqual([...USED_KEYS].sort());
        });
    }

    it('content script 原始碼用到的 t() 鍵都在小表內', () => {
        const src = readFileSync(ENTRY, 'utf8');
        const used = new Set([...src.matchAll(/\bt\('([\w.]+)'\)/g)].map(m => m[1]));
        expect([...used].sort()).toEqual([...USED_KEYS].sort());
    });
});

// 遞移匯入（排除 import type）靜態追蹤，不依賴 build 產物。
function runtimeImports(file: string): string[] {
    const src = readFileSync(file, 'utf8');
    const out: string[] = [];
    const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;
    for (const m of src.matchAll(re)) {
        if (m[1]) continue;
        const spec = m[2];
        const base = spec.startsWith('@/') ? resolve(ROOT, spec.slice(2))
            : spec.startsWith('.') ? resolve(dirname(file), spec) : null;
        if (!base) continue;
        const hit = [`${base}.ts`, resolve(base, 'index.ts'), base].find(p => p.endsWith('.ts') && existsSync(p));
        if (hit) out.push(hit);
    }
    return out;
}

function closure(entry: string): Set<string> {
    const seen = new Set<string>();
    const todo = [entry];
    while (todo.length) {
        const f = todo.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        todo.push(...runtimeImports(f));
    }
    return seen;
}

describe('劇場 content script 不帶大表', () => {
    it('遞移匯入不含整份介面字串表與譯名表', () => {
        const rel = [...closure(ENTRY)].map(f => f.slice(ROOT.length + 1));
        const banned = ['utils/ui-i18n.ts', 'utils/ui-prefs.ts', 'utils/gamedata-i18n.ts', 'utils/gamedata-names.ts'];
        expect(rel.filter(f => banned.includes(f))).toEqual([]);
        expect(rel).toContain('utils/theater-i18n.ts');
    });
});
