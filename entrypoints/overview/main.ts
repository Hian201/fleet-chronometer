// 鎮守府情報總括 —— 獨立分頁的控制器（scaffold）。
//
// 職責只有三件事：側欄導覽＋hash 路由、語言切換（重繪全頁）、主題切換（data-theme）。
// 各分區內容一概不管——見 sections/types.ts 的架構約定；分區逐項實作時不需要動本檔。
// 資料一律從 utils/db.ts（IndexedDB，擴充頁面同 origin 共享）讀取，與面板互不干擾。
import { t, getLang, LANGS } from '@/utils/ui-i18n';
import type { Lang } from '@/utils/gamedata-i18n';
import { initLang, persistLang, getTheme, applyTheme, persistTheme, onPrefsChange } from '@/utils/ui-prefs';
import { GameState } from '@/utils/state';
import { loadGameState } from './lib';
import { sections } from './sections';
import type { SectionContext } from './sections/types';

const $ = (id: string) => document.getElementById(id)!;
const navEl = $('nav'), contentEl = $('content');
// 與 lib.esc 對齊：導覽／錯誤訊息也可能含引號，屬性語境要跳脫。
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── 側欄：釘選／收合／滑入 ────────────────────────────────────────────
// 三個 body[data-nav] 狀態：
//   pinned＝佔一欄的常駐側欄（預設）
//   hidden＝不佔版面寬度，滑鼠移到左緣熱區（或 tab 進去）才浮出，離開即收回
//   open  ＝浮層被按鈕**固定**打開（窄視窗的抽屜行為，見下）
// 釘選意願存 localStorage（純 UI 偏好，不進 Dexie、不進備份，同各分區的顯示偏好）。
//
// **視窗窄時一律不釘選**：200px 側欄會把內容區壓到不能看。但那只是「當下的有效狀態」，
// 不覆寫使用者的釘選意願——視窗放大就自動釘回去。也因為如此，窄視窗下按鈕不能去切
// 釘選（切了畫面毫無反應，等於壞掉），改成切浮層的開合。
const NAV_KEY = 'kc-overview-nav';
const NAV_SIDE_KEY = 'kc-overview-nav-side';
const NAV_NARROW = 760;

let navPinned = (() => {
    try { return localStorage.getItem(NAV_KEY) !== 'hidden'; } catch { return true; }
})();
/** 僅在「非釘選」時有意義：浮層是否被按鈕固定打開（不靠 hover）。 */
let navOpen = false;
// 側欄靠左／右，與 pinned/hidden/open 三態正交（純版面鏡射，不影響其邏輯）。
let navSide: 'left' | 'right' = (() => {
    try { return localStorage.getItem(NAV_SIDE_KEY) === 'right' ? 'right' : 'left'; } catch { return 'left'; }
})();

const navNarrow = () => window.innerWidth <= NAV_NARROW;

function applyNav() {
    const pinned = navPinned && !navNarrow();
    document.body.dataset.nav = pinned ? 'pinned' : navOpen ? 'open' : 'hidden';
    document.body.dataset.navSide = navSide;
    const btn = $('nav-toggle');
    // 圖示表示「按下去會發生什麼」：目前看得到就給收合符號，看不到就給選單符號。
    const shown = pinned || navOpen;
    btn.textContent = shown ? '⟨' : '☰';
    btn.setAttribute('aria-pressed', String(shown));
    btn.title = shown ? t('ov.navHide') : t('ov.navPin');

    // 按鈕文字＝「按下去會移到哪一側」，同上面 nav-toggle 的「顯示按下去的結果」慣例。
    const sideBtn = $('nav-side-toggle');
    sideBtn.textContent = navSide === 'left' ? '⇥' : '⇤';
    sideBtn.title = navSide === 'left' ? t('ov.navSideToRight') : t('ov.navSideToLeft');
}

/** 抽屜開著時（窄視窗）點了導覽或內容就收起來——這是抽屜的一般預期行為。 */
function closeNavOverlay() {
    if (!navOpen) return;
    navOpen = false;
    applyNav();
}

$('nav-toggle').addEventListener('click', () => {
    if (navNarrow()) {
        navOpen = !navOpen;          // 窄視窗：切浮層開合，不動釘選意願
    } else {
        navPinned = !navPinned;
        navOpen = false;
        try { localStorage.setItem(NAV_KEY, navPinned ? 'pinned' : 'hidden'); } catch { /* 隱私模式：靜默 */ }
    }
    applyNav();
});
$('nav-side-toggle').addEventListener('click', () => {
    navSide = navSide === 'left' ? 'right' : 'left';
    try { localStorage.setItem(NAV_SIDE_KEY, navSide); } catch { /* 隱私模式：靜默 */ }
    applyNav();
});
navEl.addEventListener('click', closeNavOverlay);
contentEl.addEventListener('click', closeNavOverlay);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNavOverlay(); });
window.addEventListener('resize', () => {
    if (!navNarrow()) navOpen = false;   // 放寬後回到釘選／hover 模式，別留一個卡住的浮層
    applyNav();
});

initLang();
applyTheme();
// 其他頁面（面板／另一個總括分頁）切換語言或主題時，本頁即時跟著套用並重繪（#1/#2）。
onPrefsChange(() => renderAll());

// 共用狀態：載入時重播 db.events 重建一次，供各分區讀取（艦隊全覽等）。先給空 state
// 佔位，非同步載入完成後重繪目前分區。
let sharedState = new GameState();
loadGameState().then(gs => { sharedState = gs; renderSection(); });

// ── hash 路由（#/<sectionId>，可直接以網址深連結到特定分區）──────────
function currentSectionId(): string {
    const id = location.hash.replace(/^#\/?/, '');
    return sections.some(s => s.id === id) ? id : sections[0].id;
}

function renderNav() {
    const cur = currentSectionId();
    navEl.innerHTML = sections.map(s =>
        `<a href="#/${s.id}" class="${s.id === cur ? 'active' : ''}">${esc(t(s.titleKey))}</a>`).join('');
}

const ctx: SectionContext = {
    rerender: () => renderSection(),
    get state() { return sharedState; },
    reloadState: async () => { sharedState = await loadGameState(); },
};

// 路由／語言重繪世代：過期的 sec.render 只寫進已卸離的 host，不得蓋掉目前分區。
let renderGeneration = 0;

async function renderSection() {
    const gen = ++renderGeneration;
    const sec = sections.find(s => s.id === currentSectionId())!;
    // 分區名放前面、品牌短名放後面：瀏覽器分頁標題從尾端截斷，會變動的分區名須優先可見
    document.title = `${t(sec.titleKey)} — ${t('ov.brandShort')}`;
    // 分區畫進獨立 host：新一次 render 會清掉 contentEl（卸離舊 host），舊 await
    // 結束後即使繼續寫 host 也不會污染目前畫面。
    const host = document.createElement('div');
    host.className = 'ov-section-host';
    contentEl.replaceChildren(host);
    // 分區 render 丟出例外時**不能靜默留白**——使用者只會看到「介面不見了」，
    // 卻沒有任何線索可回報。一律接住並顯示原因（完整堆疊仍進 Console）。
    try {
        await sec.render(host, ctx);
        if (gen !== renderGeneration) return;
    } catch (error) {
        if (gen !== renderGeneration) return;
        console.error(`[overview] 分區 ${sec.id} render 失敗`, error);
        host.innerHTML =
            `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
    }
}

function renderAll() {
    $('page-title').textContent = t('ov.title');
    applyNav();          // 側欄按鈕的提示文字也吃語言，故跟著整頁重繪
    renderHeaderControls();
    renderNav();
    renderSection();
}

// ── header：語言選單＋主題切換 ─────────────────────────────
function renderHeaderControls() {
    const langSel = $('lang-select') as HTMLSelectElement;
    langSel.innerHTML = LANGS.map(l =>
        `<option value="${l.code}" ${getLang() === l.code ? 'selected' : ''}>${esc(l.label)}</option>`).join('');
    // 主題按鈕顯示「切過去會變成」的那一邊
    $('theme-toggle').textContent = getTheme() === 'dark' ? t('ov.themeLight') : t('ov.themeDark');
}

$('lang-select').addEventListener('change', e => {
    persistLang((e.target as HTMLSelectElement).value as Lang);
    renderAll();
});
$('theme-toggle').addEventListener('click', () => {
    persistTheme(getTheme() === 'dark' ? 'light' : 'dark');
    renderHeaderControls();
});
window.addEventListener('hashchange', () => { renderNav(); renderSection(); });

renderAll();
