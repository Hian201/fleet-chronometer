// 介紹頁的 demo 控制：iframe 內是正式面板，這裡只負責送出「下一步」、顯示步驟說明。
// 主題切換寫進同源 localStorage，面板會經 storage 事件自行套用，不必重新載入。

interface StepCopy { label: string; text: string }
interface DemoCopy {
    lang: string; next: string; auto: string; pause: string; restart: string;
    loading: string; error: string; done: string; steps: Record<string, StepCopy>;
}
interface Step { id: string; node?: string }

const copy = JSON.parse(document.getElementById('demo-copy')!.textContent!) as DemoCopy;
const frame = document.getElementById('panel') as HTMLIFrameElement;
const nextBtn = document.getElementById('demo-next') as HTMLButtonElement;
const autoBtn = document.getElementById('demo-auto') as HTMLButtonElement;
const restartBtn = document.getElementById('demo-restart') as HTMLButtonElement;
const themeBtn = document.getElementById('demo-theme') as HTMLButtonElement;
const caption = document.getElementById('demo-caption')!;
const list = document.getElementById('demo-steps')!;

const AUTO_DELAY_MS = 2600;
let steps: Step[] = [];
let done = 0;
let waiting = false;
let autoTimer: number | null = null;

const fill = (s: string, node?: string) => s.replace('{node}', node ?? '');
const stepCopy = (step: Step | undefined) => {
    const c = copy.steps[step?.id ?? 'ready'] ?? copy.steps.ready;
    return { label: fill(c.label, step?.node), text: fill(c.text, step?.node) };
};

function render() {
    // 第 0 列是母港（尚未送出任何步驟），之後每列對應一個步驟。
    const rows = [stepCopy(undefined), ...steps.map(stepCopy)];
    list.innerHTML = '';
    rows.forEach((row, i) => {
        const li = document.createElement('li');
        li.textContent = row.label;
        if (i < done) li.className = 'past';
        if (i === done) { li.className = 'current'; li.setAttribute('aria-current', 'step'); }
        list.append(li);
    });
    list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
    const finished = steps.length > 0 && done >= steps.length;
    caption.textContent = finished ? `${rows[done].text} ${copy.done}` : rows[done].text;
    nextBtn.disabled = waiting || finished || !steps.length;
    autoBtn.disabled = finished || !steps.length;
    autoBtn.textContent = autoTimer === null ? copy.auto : copy.pause;
    if (finished) stopAuto();
}

function next() {
    if (waiting || done >= steps.length) return;
    waiting = true;
    nextBtn.disabled = true;
    frame.contentWindow?.postMessage({ type: 'demo:step' }, location.origin);
}

function stopAuto() {
    if (autoTimer !== null) clearInterval(autoTimer);
    autoTimer = null;
    autoBtn.textContent = copy.auto;
}

window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const msg = e.data;
    if (msg?.type === 'demo:ready') {
        steps = msg.steps;
        done = 0;
        waiting = false;
        render();
    } else if (msg?.type === 'demo:stepped') {
        done = msg.index;
        waiting = false;
        render();
    } else if (msg?.type === 'demo:error') {
        caption.textContent = copy.error + msg.message;
        stopAuto();
    }
});

nextBtn.addEventListener('click', () => { stopAuto(); next(); });
autoBtn.addEventListener('click', () => {
    if (autoTimer !== null) { stopAuto(); return; }
    next();
    autoTimer = window.setInterval(next, AUTO_DELAY_MS);
    autoBtn.textContent = copy.pause;
});
restartBtn.addEventListener('click', () => {
    stopAuto();
    steps = [];
    done = 0;
    waiting = false;
    caption.textContent = copy.loading;
    list.innerHTML = '';
    nextBtn.disabled = autoBtn.disabled = true;
    frame.src = `/demo/panel.html?lang=${encodeURIComponent(copy.lang)}&t=${Date.now()}`;
});
themeBtn.addEventListener('click', () => {
    try {
        const light = localStorage.getItem('kc-theme') === 'light';
        localStorage.setItem('kc-theme', light ? 'dark' : 'light');
    } catch { /* 儲存被拒時主題維持不變 */ }
});

// 窄螢幕上把 370px 的面板等比縮小，避免頁面橫向捲動。
const frameBox = frame.parentElement!;
function fit() {
    const avail = frameBox.parentElement!.clientWidth;
    const scale = Math.min(1, avail / 370);
    frameBox.style.setProperty('--scale', String(scale));
}
new ResizeObserver(fit).observe(frameBox.parentElement!);
fit();

// 使用者手動選過語言後，根目錄不再依瀏覽器語言導向。
document.querySelectorAll<HTMLAnchorElement>('.langs a[data-lang]').forEach(a => a.addEventListener('click', () => {
    try { localStorage.setItem('site-lang', a.dataset.lang!); } catch { /* 忽略 */ }
}));
try { localStorage.setItem('site-lang', copy.lang); } catch { /* 忽略 */ }
