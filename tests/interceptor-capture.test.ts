import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const interceptorSrc = readFileSync(
    new URL('../entrypoints/interceptor.content.ts', import.meta.url),
    'utf8',
);
const axiosCaptureSrc = readFileSync(
    new URL('../utils/axios-capture.ts', import.meta.url),
    'utf8',
);
const bridgeSrc = readFileSync(
    new URL('../entrypoints/bridge.content.ts', import.meta.url),
    'utf8',
);
const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

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
    it('硬約束寫在 AGENTS.md，並指向本測試', () => {
        expect(agents).toContain('window.axios');
        expect(agents).toContain('禁止');
        expect(agents).toContain('window.fetch');
        expect(agents).toContain('XMLHttpRequest.prototype');
        expect(agents).toContain('tests/interceptor-capture.test.ts');
    });

    it('interceptor 只經 axios response 觀察，並把傳輸留給 idle queue', () => {
        expect(interceptorSrc).toContain('attachAxiosResponseCapture');
        expect(interceptorSrc).toContain('waitForAxios');
        expect(interceptorSrc).toContain('captureQueue.enqueue');
        expect(axiosCaptureSrc).toContain('interceptors.response.use');
        expect(axiosCaptureSrc).toMatch(/return response/);
    });

    it('擷取失效偵測只讀 resource timing，並以觀察器實際收到的 path 配對', () => {
        expect(interceptorSrc).toContain("observe({ type: 'resource', buffered: true })");
        expect(interceptorSrc).toContain('health.noteCapture(path)');
        expect(interceptorSrc).toContain('health.noteAxios()');
        expect(interceptorSrc).toContain('channel.sendHealth(');
    });

    it('封包經私有通道交給 bridge，不在 window 上廣播', () => {
        // withoutComments 會把 matches 字串 '*://*…/*' 誤當註解；這裡的比對字串都不出現在註解中。
        const interceptor = interceptorSrc;
        const bridge = bridgeSrc;
        expect(interceptor).toContain('connectMainChannel');
        expect(interceptor).toContain('channel.send(');
        expect(bridge).toContain('offerBridgeChannel');
        // window.postMessage 只能出現在握手 endpoint 內（bridge 另有跨框的劇場 relay，不帶遊戲資料）
        expect(interceptor.match(/window\.postMessage\(/g)).toHaveLength(1);
        expect(interceptor).not.toContain('apiText: text },');
        expect(bridge).not.toContain('__kc_monitor__');
    });

    it('正式建置不在遊戲頁留下除錯全域變數或封包輸出', () => {
        const interceptor = interceptorSrc;
        const globals = interceptor.split('\n').filter(line => /\(window as any\)\.__kc\w+\s*=/.test(line));
        expect(globals.length).toBeGreaterThan(0);
        // 每一處都必須在 dev 判斷之內：單行 if (dev) 或位於 `dev && ...` 區塊
        const devBlock = interceptor.slice(interceptor.indexOf("if (dev && path.includes('battle'))"));
        for (const line of globals) {
            expect(line.includes('if (dev)') || devBlock.includes(line)).toBe(true);
        }
        expect(interceptor).toContain("if (dev && path.includes('battle'))");
        expect(interceptor).toContain("const dev = import.meta.env.COMMAND === 'serve';");
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

    it('entrypoints 與 utils 不得存取 Cookie API', () => {
        const files = [
            ...listTsFiles(join(projectRoot, 'entrypoints')),
            ...listTsFiles(join(projectRoot, 'utils')),
        ];
        const hits: string[] = [];
        const forbidden = new Set(['cookie', 'cookies', 'cookieStore']);
        for (const file of files) {
            const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
            const visit = (node: ts.Node): void => {
                const property = ts.isPropertyAccessExpression(node) ? node.name.text
                    : ts.isElementAccessExpression(node) && node.argumentExpression
                        && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text
                        : null;
                if ((property && forbidden.has(property))
                    || (ts.isIdentifier(node) && node.text === 'cookieStore')) {
                    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
                    hits.push(`${file.replace(projectRoot, '')}:${line + 1}`);
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
        }
        expect(hits).toEqual([]);
    });
});
