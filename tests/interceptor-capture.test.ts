import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const interceptorSrc = readFileSync(
    new URL('../entrypoints/interceptor.content.ts', import.meta.url),
    'utf8',
);
const axiosCaptureSrc = readFileSync(
    new URL('../utils/axios-capture.ts', import.meta.url),
    'utf8',
);
const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');

function listTsFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return listTsFiles(path);
        return entry.name.endsWith('.ts') ? [path] : [];
    });
}

/** 去掉註釋，避免「禁止 window.fetch =」這類說明本身觸發禁令。 */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const NATIVE_NETWORK_WRAP = [
    /\bwindow\.fetch\s*=/,
    /\bglobalThis\.fetch\s*=/,
    /\bXMLHttpRequest\.prototype\.(?:open|send)\s*=/,
    /\bwindow\.XMLHttpRequest\s*=/,
    /Object\.defineProperty\(\s*(?:window|globalThis)\s*,\s*['"]fetch['"]/,
    /Object\.defineProperty\(\s*XMLHttpRequest\.prototype/,
];

describe('kcsapi 擷取不得包裝原生網路 API', () => {
    it('硬約束寫在 CLAUDE.md，並指向本測試', () => {
        expect(claude).toContain('window.axios');
        expect(claude).toContain('禁止');
        expect(claude).toContain('window.fetch');
        expect(claude).toContain('XMLHttpRequest.prototype');
        expect(claude).toContain('tests/interceptor-capture.test.ts');
    });

    it('interceptor 只經 axios response 觀察，並把傳輸留給 idle queue', () => {
        expect(interceptorSrc).toContain('attachAxiosResponseCapture');
        expect(interceptorSrc).toContain('waitForAxios');
        expect(interceptorSrc).toContain('captureQueue.enqueue');
        expect(axiosCaptureSrc).toContain('interceptors.response.use');
        expect(axiosCaptureSrc).toMatch(/return response/);
    });

    it('entrypoints 與 utils 的執行碼不得取代 fetch／XHR', () => {
        const files = [
            ...listTsFiles(join(projectRoot, 'entrypoints')),
            ...listTsFiles(join(projectRoot, 'utils')),
        ];
        expect(files.length).toBeGreaterThan(10);

        const hits: string[] = [];
        for (const file of files) {
            const code = withoutComments(readFileSync(file, 'utf8'));
            for (const pattern of NATIVE_NETWORK_WRAP) {
                if (pattern.test(code)) {
                    hits.push(`${file.replace(projectRoot, '')} 匹配 ${pattern}`);
                }
            }
        }
        expect(hits).toEqual([]);
    });
});
