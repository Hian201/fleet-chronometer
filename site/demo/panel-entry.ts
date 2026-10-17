// 介紹頁 demo 的面板入口：在一般網頁上跑正式 entrypoints/panel/main.ts。
// 面板只用到 runtime.onMessage／sendMessage 與 windows.*，這裡以最小 shim 取代；
// 事件照正式契約寫進本頁 origin 的 IndexedDB，再以 `kc:live` 通知面板消費。
// 每次載入都清空資料庫，demo 從同一個母港狀態開始。
import { db } from '@/utils/db';
import { buildScenario, type DemoData, type DemoStep } from './scenario';

type Listener = (msg: any, sender: unknown, sendResponse: (value?: unknown) => void) => unknown;
const listeners: Listener[] = [];
(globalThis as any).browser = {
    runtime: {
        onMessage: { addListener: (fn: Listener) => { listeners.push(fn); } },
        // 編成寫真的擷取與語言鏡像需要 background；demo 沒有，回 undefined 讓呼叫端走失敗分支。
        sendMessage: async () => undefined,
        getURL: (path: string) => path,
    },
    windows: {
        getCurrent: async () => ({ id: 1 }),
        update: async () => ({}),
    },
};
const dispatch = (msg: unknown) => { for (const fn of listeners) fn(msg, {}, () => { }); };

const params = new URLSearchParams(location.search);
const lang = params.get('lang');
try {
    if (lang === 'zh-TW' || lang === 'en' || lang === 'ja') localStorage.setItem('kc-panel-lang', lang);
    localStorage.setItem('kc-theme', params.get('theme') === 'light' ? 'light' : 'dark');
} catch { /* 儲存被拒時面板退回瀏覽器語言與暗色主題 */ }

const post = (msg: object) => parent.postMessage(msg, location.origin);

async function addEvents(events: DemoStep['events']) {
    const ids: number[] = [];
    for (const ev of events) {
        ids.push(await db.events.add({ ts: Date.now(), path: ev.path, api: ev.api, req: ev.req, postProcessState: 'done' }) as number);
    }
    return ids;
}

async function start() {
    const data = await (await fetch('demo-data.json')).json() as DemoData;
    const { seed, steps } = buildScenario(data, Date.now());
    await db.delete();
    await db.open();
    await addEvents(seed);
    await import('@/entrypoints/panel/main');
    let cursor = 0;
    let busy = false;
    window.addEventListener('message', async e => {
        if (e.origin !== location.origin || e.data?.type !== 'demo:step' || busy || cursor >= steps.length) return;
        busy = true;
        try {
            const step = steps[cursor++];
            for (const id of await addEvents(step.events)) dispatch({ type: 'kc:live', id });
            post({ type: 'demo:stepped', index: cursor });
        } finally { busy = false; }
    });
    post({ type: 'demo:ready', steps: steps.map(s => ({ id: s.id, node: s.node })) });
}

start().catch(error => {
    console.error('[demo] 啟動失敗', error);
    post({ type: 'demo:error', message: String(error?.message ?? error) });
});
