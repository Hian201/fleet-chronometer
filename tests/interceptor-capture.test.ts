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

    it('MAIN world 腳本不留全域名稱，也不碰遊戲頁的音訊與媒體物件', () => {
        // WXT 預設把 MAIN world 腳本指定給同名全域變數（window.interceptor）
        expect(interceptorSrc).toContain('globalName: false');
        const code = withoutComments(interceptorSrc.replace("'*://*.kancolle-server.com/*'", "''"));
        expect(code).not.toMatch(/AudioContext|HTMLMediaElement|MutationObserver/);
        expect(code).not.toMatch(/Object\.defineProperty|new Proxy\(/);
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

    it('地圖圖層讀取只在收到要求時動作，MAIN 不匯入字形庫、比對與靜態表', () => {
        const code = withoutComments(interceptorSrc.replace("'*://*.kancolle-server.com/*'", "''"));
        // 材質快取只在讀取要求的處理函式內存取
        const handler = code.slice(code.indexOf('const onReadPointLayer'), code.indexOf('const channel = connectMainChannel'));
        expect(code.match(/TextureCache/g)).toHaveLength(1);
        expect(handler).toContain('TextureCache');
        expect(code).toContain('onReadPointLayer,');
        // MAIN 會載入的模組：字形庫、比對、靜態表一律不得在執行期匯入（map-glyph 只准 import type）
        for (const file of ['../entrypoints/interceptor.content.ts', '../utils/map-point-layer.ts', '../utils/main-channel.ts', '../utils/map-labels.ts']) {
            const src = readFileSync(new URL(file, import.meta.url), 'utf8');
            expect(src, file).not.toMatch(/from '(?:\.\.\/utils|\.)\/(?:map-glyph-data|map-edge-letters|map-node-letters|map-point-ocr)'/);
            for (const m of src.matchAll(/import\s+(type\s+)?[^;]*?from '(?:\.\.\/utils|\.)\/map-glyph'/g)) expect(m[1], file).toBeTruthy();
        }
    });

    it('bridge 不掛 runtime 訊息監聽：遊戲分頁對 tabs.sendMessage 必須維持「沒有接收端」', () => {
        // popup 的劇場模式（entrypoints/popup/main.ts sendToTheaterScript）以 tabs.sendMessage 丟錯判斷
        // 劇場腳本尚未注入、才 executeScript；bridge 一掛 onMessage，遊戲分頁就永遠有接收端，promise
        // 改為 resolve undefined，popup 誤判已送達而不注入。background → bridge 一律走 bridge 主動連上的 port。
        expect(bridgeSrc).not.toContain('runtime.onMessage');
        expect(withoutComments(bridgeSrc)).not.toMatch(/\bonMessage\.addListener\(\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+/);
        expect(bridgeSrc).toContain('PORT_POINT_LAYER');
    });
});
