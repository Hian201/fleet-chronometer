import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { replyWhenSettled } from '../utils/runtime-reply';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('replyWhenSettled', () => {
    it('回傳 true 讓瀏覽器保持回覆通道開啟', () => {
        expect(replyWhenSettled(Promise.resolve(1), vi.fn())).toBe(true);
    });

    it('成功時把結果交給 sendResponse', async () => {
        const sendResponse = vi.fn();
        replyWhenSettled(Promise.resolve({ muted: true, connected: 2 }), sendResponse);

        expect(sendResponse).not.toHaveBeenCalled();   // 同步階段不得回覆
        await flush();
        expect(sendResponse).toHaveBeenCalledExactlyOnceWith({ muted: true, connected: 2 });
    });

    it('失敗時以 onError 的內容回覆', async () => {
        const sendResponse = vi.fn();
        replyWhenSettled(
            Promise.reject(new Error('captureVisibleTab 失敗')),
            sendResponse,
            error => ({ error: String((error as Error).message) }),
        );

        await flush();
        expect(sendResponse).toHaveBeenCalledExactlyOnceWith({ error: 'captureVisibleTab 失敗' });
    });

    it('沒有 onError 時仍回覆 undefined，不讓 sender 永遠等下去', async () => {
        const sendResponse = vi.fn();
        replyWhenSettled(Promise.reject(new Error('boom')), sendResponse);

        await flush();
        expect(sendResponse).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it('sender 已消失（sendResponse 丟例外）時安靜收場', async () => {
        const sendResponse = vi.fn(() => { throw new Error('message port closed'); });
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        expect(() => replyWhenSettled(Promise.resolve('ok'), sendResponse)).not.toThrow();
        await flush();

        process.off('unhandledRejection', unhandled);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(unhandled).not.toHaveBeenCalled();
    });
});

// ── 靜態掃描：runtime.onMessage listener 的回覆寫法 ──────────────────────
// 回傳 Promise 只有 Chrome 148 起才支援（且逐步推出），在其他瀏覽器上等於「不回覆」，
// sender 會收到 undefined——拍照拿不到 dataUrl、靜音狀態列永遠顯示「沒有遊戲分頁」。
// 這種錯誤型別檢查抓不到、單元測試也測不到（要真的跑在瀏覽器裡才看得出來），
// 故用原始碼掃描把它擋在 commit 前。
//
// 用 TypeScript 自己的 parser 而非自製的字串掃描：手寫掃描器要正確處理註解、樣板字串與
// **內含引號的正則字面值**（`/'/g` 這種）才不會誤判，而那正是它第一次上線就踩到的坑。
const entrypointsRoot = fileURLToPath(new URL('../entrypoints/', import.meta.url));
const LISTENER_MARKER = 'runtime.onMessage.addListener(';
const ALLOWED_RETURNS = ['', 'true', 'false'];

function listTsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return listTsFiles(path);
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    });
}

/** `<something>.runtime.onMessage.addListener(...)`；port.onMessage 之類的不算（那不會回覆）。 */
function isRuntimeOnMessageAddListener(node: ts.CallExpression): boolean {
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'addListener') return false;
    const onMessage = callee.expression;
    if (!ts.isPropertyAccessExpression(onMessage) || onMessage.name.text !== 'onMessage') return false;
    const runtime = onMessage.expression;
    return ts.isPropertyAccessExpression(runtime) && runtime.name.text === 'runtime';
}

function listenerCallbacks(sourceFile: ts.SourceFile): ts.SignatureDeclaration[] {
    const callbacks: ts.SignatureDeclaration[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isRuntimeOnMessageAddListener(node)) {
            const [first] = node.arguments;
            if (first && (ts.isArrowFunction(first) || ts.isFunctionExpression(first))) callbacks.push(first);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return callbacks;
}

/** listener 自身的回傳運算式（含箭頭函式的隱含回傳）；巢狀函式裡的 return 不算。 */
function returnExpressions(callback: ts.SignatureDeclaration, sourceFile: ts.SourceFile): string[] {
    const text = (node: ts.Node) => node.getText(sourceFile).replace(/\s+/g, ' ');
    const body = (callback as ts.ArrowFunction | ts.FunctionExpression).body;
    // `addListener(msg => doWork())`：沒有 return 關鍵字，但一樣是把值交回給瀏覽器。
    if (body && !ts.isBlock(body)) return [text(body)];

    const expressions: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node)) expressions.push(node.expression ? text(node.expression) : '');
        ts.forEachChild(node, visit);
    };
    if (body) ts.forEachChild(body, visit);
    return expressions;
}

/** 回傳所有不相容的回覆寫法；空陣列＝這份原始碼通過。 */
function incompatibleReturns(source: string, fileName = 'test.ts'): string[] {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    return listenerCallbacks(sourceFile)
        .flatMap(callback => returnExpressions(callback, sourceFile))
        .filter(expression =>
            !ALLOWED_RETURNS.includes(expression) && !expression.startsWith('replyWhenSettled('));
}

function listenerCount(source: string): number {
    return listenerCallbacks(ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true)).length;
}

describe('runtime.onMessage 回覆契約（原始碼掃描）', () => {
    const files = listTsFiles(entrypointsRoot).filter(path => readFileSync(path, 'utf8').includes(LISTENER_MARKER));

    it('掃得到 entrypoints 裡的 runtime listener', () => {
        // 掃描標的若被改寫（例如換成別名 import），這條會先亮紅燈，避免掃描靜默失效。
        expect(files.length).toBeGreaterThanOrEqual(3);
    });

    // 掃描器自身的守門：抓不到違規的掃描器等於沒有掃描。
    it('抓得到回傳 Promise 的寫法', () => {
        const offending = `
            browser.runtime.onMessage.addListener((msg, sender) => {
                if (msg?.type === 'a') return readPrefs().then(p => ({ muted: p.muted }));
                if (msg?.type === 'b') return Promise.resolve(true);
                if (msg?.type === 'c') return;
                return true;
            });
        `;
        expect(incompatibleReturns(offending)).toEqual([
            'readPrefs().then(p => ({ muted: p.muted }))',
            'Promise.resolve(true)',
        ]);
    });

    it('抓得到箭頭函式的隱含回傳', () => {
        expect(incompatibleReturns('browser.runtime.onMessage.addListener(msg => handle(msg));'))
            .toEqual(['handle(msg)']);
    });

    it('不把巢狀 callback 的 return 當成 listener 的回傳', () => {
        const source = `
            browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
                work().then(value => { return sendResponse(value); });
                return true;
            });
        `;
        expect(incompatibleReturns(source)).toEqual([]);
    });

    it('不會被註解、字串或含引號的正則字面值騙到', () => {
        const source = `
            const esc = (s) => s.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
            browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
                // 舊寫法是 return somePromise( 這裡故意留一個沒配對的括號
                const label = 'return fake(';
                if (msg?.type === 'x') return replyWhenSettled(work(), sendResponse);
                return;
            });
        `;
        expect(listenerCount(source)).toBe(1);
        expect(incompatibleReturns(source)).toEqual([]);
    });

    it('不把 port.onMessage 之類的非 runtime listener 算進來', () => {
        expect(listenerCount('port.onMessage.addListener(msg => handle(msg));')).toBe(0);
    });

    it.each(files.map(path => [path.slice(entrypointsRoot.length), path]))(
        '%s 的 listener 只用 sendResponse + return true，不回傳 Promise',
        (_label, path) => {
            const source = readFileSync(path, 'utf8');
            expect(listenerCount(source)).toBeGreaterThan(0);
            expect(incompatibleReturns(source, path)).toEqual([]);
        },
    );
});

