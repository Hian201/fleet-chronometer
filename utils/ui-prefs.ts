// UI 偏好（顯示語言／亮暗主題）的持久化共用層 —— 給「擴充頁面」用（panel／popup／
// overview 皆為同一 extension origin，localStorage 直接共享）。
//
// 分工（沿 CLAUDE.md 設計原則 4/5）：
//   - utils/ui-i18n.ts／gamedata-i18n.ts：純函式＋記憶體變數，零瀏覽器依賴（state.ts 可獨立編譯）。
//   - 本檔：localStorage＋navigator 等瀏覽器 API 集中於此，三個頁面共用同一份持久化邏輯，
//     不再各自複製（原本只有 panel/main.ts 一份，overview 加入後抽出）。
//   - 刻意不用 chrome.storage：維持權限精簡（不新增 storage 權限）。SW 不需讀取偏好。
import { LANGS, setLang, getLang } from './ui-i18n';
import { MSG_UI_LANG_SET } from './game-page';
import type { Lang } from './gamedata-i18n';

// key 沿用面板既有值，既有使用者的語言設定無痛保留
const LANG_KEY = 'kc-panel-lang';
const THEME_KEY = 'kc-theme';

export type Theme = 'dark' | 'light';

// 瀏覽器語言 → 支援語系。**遊戲頁的劇場模式 content script 也用這支**：它跑在 dmm.com，
// 讀不到擴充頁面的 localStorage（不同 origin），只能靠這個偵測或 background 的鏡像。
export function detectBrowserLang(): Lang {
    const n = navigator.language.toLowerCase();
    if (n.startsWith('ja')) return 'ja';
    if (n.startsWith('zh')) return 'zh-TW';
    return 'en';
}

// 啟動時呼叫：讀 localStorage（無效值回退瀏覽器語言偵測）並套用到 i18n 層。回傳生效語言。
export function initLang(): Lang {
    const saved = localStorage.getItem(LANG_KEY);
    const valid = LANGS.find(l => l.code === saved);
    const lang = valid ? valid.code : detectBrowserLang();
    setLang(lang);
    mirrorLangToBackground(lang);
    return lang;
}

// 使用者切換語言時呼叫：套用＋持久化（呼叫端自行重繪）
export function persistLang(l: Lang) {
    setLang(l);
    localStorage.setItem(LANG_KEY, l);
    mirrorLangToBackground(l);
}

// localStorage 仍是擴充頁面的唯一真相；這裡只是把語言**鏡像**一份給 background（db.meta），
// 讓跑在 dmm.com 的劇場模式工具列能跟著同一個語言走。失敗一律忽略：鏡像不存在時
// content script 會退回瀏覽器語言偵測，不影響任何擴充頁面的行為。
function mirrorLangToBackground(lang: Lang) {
    try {
        void browser.runtime.sendMessage({ type: MSG_UI_LANG_SET, lang }).catch(() => { });
    } catch { /* 非擴充環境（測試）時沒有 browser，忽略 */ }
}

// ── 主題 ──────────────────────────────────────────────
// 頁面以 <html data-theme="dark|light"> 承載，CSS 用 :root[data-theme=light] 覆蓋變數。
// 預設 dark（現行面板唯一主題）；亮色版變數各頁面自行定義（M7 圖示已全帶描邊，亮底可讀）。
export function getTheme(): Theme {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function applyTheme(t: Theme = getTheme()) {
    document.documentElement.dataset.theme = t;
}

export function persistTheme(t: Theme) {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
}

// ── 跨頁面即時同步（#1/#2 全域切換）────────────────────────
// 同一擴充 origin 的所有頁面（panel 彈窗、overview 分頁）共用 localStorage；瀏覽器的
// `storage` 事件只在「非發動變更的那個」頁面觸發——正好用來把某頁的語言/主題變更
// 廣播給其他已開頁面。發動變更的頁面自己已同步重繪，不需再收自己的事件。
// 不需要任何權限（storage 事件是 DOM 標準，非 chrome.storage）。
// cb 在偏好已套用（setLang/applyTheme 已呼叫）後被呼叫，呼叫端只需重繪。
export function onPrefsChange(cb: (kind: 'lang' | 'theme') => void) {
    window.addEventListener('storage', e => {
        if (e.key === LANG_KEY) {
            const valid = LANGS.find(l => l.code === e.newValue);
            if (valid && valid.code !== getLang()) { setLang(valid.code); cb('lang'); }
        } else if (e.key === THEME_KEY) {
            applyTheme();   // 讀新值（getTheme 直接讀 localStorage，已是最新）
            cb('theme');
        }
    });
}
