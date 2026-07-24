// 擴充圖示點選後的快捷選單（manifest action.default_popup，由 WXT 依本目錄自動註冊）。
// 注意：設了 default_popup 之後 browser.action.onClicked 永遠不會觸發（MV3 規格），
// 原本「點圖示直接開面板」改為此選單的第一項——實際開窗／單例聚焦邏輯仍留在
// background（SW 常駐訊息端），popup 只送 kc:open-panel 就關閉自己。
import { t } from '@/utils/ui-i18n';
import { initLang } from '@/utils/ui-prefs';
import {
    GAME_PAGE_MATCHES, GAME_URL, MSG_CAPTURE_TAB, MSG_MUTE_GET, MSG_MUTE_SET, MSG_SCREENSHOT_RECT,
    MSG_THEATER_TOGGLE, THEATER_SCRIPT_FILE, THEATER_SCRIPT_ID,
    type CaptureTabReply, type ScreenshotRectReply,
} from '@/utils/game-page';
import { downloadCroppedScreenshot } from '@/utils/screenshot';

initLang();
// 靜態文字套用翻譯（popup 生命週期極短，開啟時套一次即可，不需監聽切換）。
// 標題同 panel 走執行期在地化：**HTML 不做 `__MSG_` 代換**（只有 manifest 與 CSS 會），
// index.html 裡的 `__MSG_extShortName__` 若不改寫就是原字面值。
document.title = t('ov.brandShort');
document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n!);
});

function bind(id: string, fn: () => Promise<unknown>) {
    document.getElementById(id)!.addEventListener('click', async () => {
        await fn().catch(() => { });
        window.close();
    });
}

// 開面板：交給 background 執行（單例聚焦見 background.ts openPanelWindow）
bind('open-panel', () => browser.runtime.sendMessage({ type: 'kc:open-panel' }));
// 開遊戲：tabs.create 開一般網址不需要 tabs 權限（權限精簡原則不受影響）
bind('open-game', () => browser.tabs.create({ url: GAME_URL }));
// 鎮守府情報總括：獨立分頁（大量資料檢視適合完整分頁而非 420px 彈窗）。
// TODO(細節)：分頁單例化（已開啟就聚焦既有分頁；無 tabs 權限下需仿面板的 ping 機制）
bind('open-overview', () => browser.tabs.create({ url: browser.runtime.getURL('/overview.html') }));

// ── 狀態列（劇場模式／靜音需要就地回饋，故這兩項不自動關閉 popup）──
const statusEl = document.getElementById('status')!;
function status(message: string) {
    statusEl.textContent = message;
    statusEl.hidden = false;
}

// ── 遊戲靜音 ──────────────────────────────────────────
// 狀態持有者是 background（db.meta），實際執行在遊戲框的 MAIN world hook。
const muteStateEl = document.getElementById('mute-state')!;
let muted = false;
let gameTabsConnected = 0;
const renderMute = () => {
    // 沒有任何遊戲分頁連上來＝那些分頁跑的還是舊版 content script（擴充更新後未 F5），
    // 這時按靜音一定沒反應。**這種靜靜失敗最難查，所以直接寫在選單上。**
    muteStateEl.textContent = gameTabsConnected === 0
        ? t('theater.muteNoTab')
        : (muted ? t('theater.muteOn') : t('theater.muteOff'));
};
const readMuteState = (state: any) => {
    muted = !!state?.muted;
    gameTabsConnected = Number(state?.connected ?? 0);
    renderMute();
};
void browser.runtime.sendMessage({ type: MSG_MUTE_GET })
    .then(readMuteState)
    .catch(() => renderMute());
document.getElementById('mute')!.addEventListener('click', async () => {
    muted = !muted;
    renderMute();
    const reply = await browser.runtime.sendMessage({ type: MSG_MUTE_SET, muted }).catch(() => null);
    if (reply) readMuteState({ ...reply, muted });
});

// ── 劇場模式 ──────────────────────────────────────────
// 這是本擴充唯一需要 dmm.com 權限的功能，故走 optional_host_permissions：manifest 預設
// 權限維持只有 alarms/notifications，使用者第一次按下這裡才跳一次原生授權視窗，授權後
// 以 scripting.registerContentScripts 常駐（persistAcrossSessions），日後開遊戲頁自動生效。
// **permissions.request() 必須是點擊手勢的第一個呼叫**——先 await 別的事情會失去手勢資格。
document.getElementById('theater')!.addEventListener('click', async () => {
    const granted = await browser.permissions.request({ origins: GAME_PAGE_MATCHES })
        .catch(() => false);
    if (!granted) { status(t('theater.permissionDenied')); return; }

    await registerTheaterScript();

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') { status(t('theater.needGameTab')); return; }

    const ok = await sendToTheaterScript(tab.id, { type: MSG_THEATER_TOGGLE }).then(() => true, () => false);
    if (!ok) { status(t('theater.needGameTab')); return; }
    window.close();
});

/** 常駐註冊（重複註冊會拋 duplicate id，改成 update；兩者都失敗只影響「下次自動生效」）。 */
async function registerTheaterScript(): Promise<void> {
    const script = {
        id: THEATER_SCRIPT_ID,
        js: [THEATER_SCRIPT_FILE],
        // css 必填（型別要求）：樣式由 content script 自行注入，見 theater.content.ts
        css: [],
        matches: [...GAME_PAGE_MATCHES],
        runAt: 'document_idle' as const,
        allFrames: false,
        persistAcrossSessions: true,
    };
    try {
        await browser.scripting.registerContentScripts([script]);
    } catch {
        await browser.scripting.updateContentScripts([script]).catch(() => { });
    }
}

/**
 * 送訊息給遊戲分頁的劇場模式 content script（劇場模式切換／拍照量測共用同一套判斷）：
 * 已注入就直接送；沒有接收端（尚未 F5／首次使用）才臨時注入一次再重送。
 */
async function sendToTheaterScript<T>(tabId: number, message: unknown): Promise<T> {
    try {
        return await browser.tabs.sendMessage(tabId, message) as T;
    } catch {
        await browser.scripting.executeScript({ target: { tabId }, files: [THEATER_SCRIPT_FILE] });
        return await browser.tabs.sendMessage(tabId, message) as T;
    }
}

// ── 拍照（只擷取遊戲畫面，不含 DMM 頁面其餘部分）──────────────────────
// 裁切矩形由劇場模式 content script 算出（`MSG_SCREENSHOT_RECT`，沿用劇場模式本身的
// pickGameFrame／contentArea／fallbackGameArea＋跨源畫布量測協定，見 theater.content.ts
// 的 measureScreenshotRect）——不在這裡另外猜一次遊戲畫面的位置。
// 抓整分頁截圖（`tabs.captureVisibleTab`）與裁切下載都走跟劇場模式工具列同一套（見
// background.ts 的 MSG_CAPTURE_TAB、utils/screenshot.ts 的 downloadCroppedScreenshot），
// 避免兩個入口各自實作出不一致的行為。dmm.com 的 optional_host_permissions 授權流程仍
// 保留：那是給 scripting.registerContentScripts／executeScript 用的，量測矩形需要它把
// content script 注入到遊戲頁，跟 captureVisibleTab 本身的權限（activeTab，見
// wxt.config.ts）是兩件事。
document.getElementById('screenshot')!.addEventListener('click', async () => {
    const granted = await browser.permissions.request({ origins: GAME_PAGE_MATCHES })
        .catch(() => false);
    if (!granted) { status(t('theater.permissionDenied')); return; }

    await registerTheaterScript();

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number' || typeof tab.windowId !== 'number') {
        status(t('theater.needGameTab')); return;
    }

    const reply = await sendToTheaterScript<ScreenshotRectReply>(tab.id, { type: MSG_SCREENSHOT_RECT })
        .catch(() => null);
    if (!reply?.rect) { status(t('theater.notFound')); return; }

    const capture = await browser.runtime.sendMessage({ type: MSG_CAPTURE_TAB, windowId: tab.windowId })
        .catch((e): CaptureTabReply => ({ error: String(e) })) as CaptureTabReply;
    if (!('dataUrl' in capture)) {
        console.warn('[KC-Monitor] 拍照失敗', capture.error);
        status(t('screenshot.failed'));
        return;
    }
    try {
        await downloadCroppedScreenshot(capture.dataUrl, reply.rect, reply.dpr);
    } catch (e) {
        console.warn('[KC-Monitor] 拍照裁切失敗', e);
        status(t('screenshot.failed'));
        return;
    }
    status(t('screenshot.done'));
    setTimeout(() => window.close(), 700);
});
