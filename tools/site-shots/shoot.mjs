// 介紹頁功能截圖的重拍工具：從 .site/ 的 demo 面板拍下 site/shots/*.webp。
//
//   npm run site:build && node tools/site-shots/shoot.mjs
//
// 需要本機的 Google Chrome（headless，經 DevTools Protocol 操作）與 cwebp（brew install webp）。
// 只開本機靜態伺服器與 demo 面板，不連任何遊戲或外部網站。
// 拍攝步數與高度要和 site/page.ts 的 SHOT_SIZE／SHOT_MARKS 一致；面板版面變動後，
// 標註圓點的位置可能也要跟著調。
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const site = join(root, '.site');
const outDir = join(root, 'site/shots');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = [{ id: 'port', steps: 0 }, { id: 'sortie', steps: 15 }];
const HEIGHT = 560;
if (!existsSync(join(site, 'demo/panel.html'))) throw new Error('先執行 npm run site:build');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path === '/capture.html' ? join(dirname(fileURLToPath(import.meta.url)), 'capture.html') : join(site, path);
    if (!file.startsWith(site) && !file.endsWith('capture.html') || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), 'site-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    chrome.stderr.on('data', d => { buf += d; const m = /ws:\/\/\S+/.exec(buf); if (m) ok(m[0]); });
    chrome.on('exit', () => fail(new Error('Chrome 啟動失敗')));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = new WebSocket(wsUrl);
await new Promise(r => { browser.onopen = r; });
let id = 0;
const pending = new Map();
browser.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => {
    const i = ++id; pending.set(i, r); browser.send(JSON.stringify({ id: i, method, params, sessionId }));
});
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId).then(m => m.result);

try {
    for (const lang of ['zh-TW', 'en', 'ja']) for (const theme of ['dark', 'light']) for (const shot of SHOTS) {
        await page('Emulation.setDeviceMetricsOverride', { width: 370, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
        await page('Page.navigate', { url: `${origin}/capture.html?steps=${shot.steps}&lang=${lang}&theme=${theme}` });
        let ready = false;
        for (let i = 0; i < 200 && !ready; i++) {
            await sleep(150);
            ready = (await page('Runtime.evaluate', { expression: 'document.title' })).result.value === 'ready';
        }
        if (!ready) throw new Error(`demo 沒有在時限內走到第 ${shot.steps} 步（${lang} ${theme}）`);
        await sleep(1200); // 等面板最後一次重繪與字型
        const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 370, height: HEIGHT, scale: 1 } });
        const png = join(profile, 'shot.png');
        writeFileSync(png, Buffer.from(data, 'base64'));
        const name = `${shot.id}-${lang}-${theme}.webp`;
        execFileSync('cwebp', ['-quiet', '-q', '86', png, '-o', join(outDir, name)]);
        console.log(name);
    }
} finally {
    browser.close();
    // Chrome 結束後才刪設定檔資料夾，否則它還在寫入時刪除會失敗。
    await new Promise(r => { chrome.once('exit', r); chrome.kill(); });
    server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
