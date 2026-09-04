import { db, type ApiEventRow } from '@/utils/db';
import { nodeLabel } from '@/utils/map-node-letters';
import { diffLabel, isEventWorld, mapLabel } from '@/utils/sortie-detail';
import { EventProjector, projectEventAndAdvance } from '@/utils/event-projector';
import { advanceProjectionCursor, readProjectionCursor } from '@/utils/projection-cursor';
import {
    GameState, isBossNode,
    type ShipView, type GearView, type FleetView, type BattleEnemyShipView,
} from '@/utils/state';
import {
    planAnchorageRepair, planMoraleSupply, nextSettlementIn,
    REPAIR_INTERVAL_MS, MORALE_INTERVAL_MS,
    type AnchorageRepairPlan, type MoralePlan,
} from '@/utils/repair';
import { applySnapshotBaseline, planStateRecovery } from '@/utils/state-recovery';
import { isDebugUiEnabled } from '@/utils/debug-ui';
import { esc, gearIconHtml, matIconHtml as matIconFile } from '@/utils/html-escape';
import { expedDisplayName, getLang, t } from '@/utils/ui-i18n';
import { initLang, applyTheme, onPrefsChange } from '@/utils/ui-prefs';
import { sortieGaugeBarHtml } from './sortie-gauge';
import { bossHpReplaySpecificity, observedBossHp } from '@/utils/boss-hp';
import { NODE_KIND_KEYS, nodeKindKey } from '@/utils/map-node-kind';
import { formationRects } from '@/utils/formation-geometry';
import { mountOrder, renderOrder } from './order';
const $ = (id: string) => document.getElementById(id)!;
const headerEl = $('header'), noticeEl = $('notice'), tabsEl = $('tabs'), generalEl = $('tab-general'), activityEl = $('tab-activity'),
    resline = $('resline'), missionsEl = $('missions'), ndocksEl = $('ndocks'), kdocksEl = $('kdocks'), questsEl = $('quests'),
    log = $('log'), fleetnavEl = $('fleetnav'), fleetsEl = $('fleets'), airBasesEl = $('air-bases'),
    wantedEl = $('wanted'),
    facLiveEl = $('factory-live'),
    orderEl = $('tab-order'),
    tabpanelEl = $('tabpanel');
const state = new GameState();
const projector = new EventProjector({ state, mode: 'persist', tables: db });
const PANEL_INNER_WIDTH = 420;
function fitPanelInnerWidth() {
    document.documentElement.style.setProperty('--panel-inner-width', `${PANEL_INNER_WIDTH}px`);
}
fitPanelInnerWidth();
// 面板顯示語言＋主題：持久化／偵測／跨頁同步抽到 utils/ui-prefs.ts（panel/popup/overview
// 三頁共用；utils/ui-i18n.ts 仍只放純函式，維持 state.ts 可獨立編譯）。
// 語言/主題以「鎮守府情報總括」為控制中心，但任一頁切換都會經 storage 事件廣播到其他
// 已開頁面——面板收到就套用並整頁重繪。
initLang();
applyTheme();
mountOrder(orderEl, () => state);
// 語言／主題變更（其他擴充頁面改的，經 storage 事件送來）：靜態文字、動態渲染，以及
// 兩個「不在 renderAll 裡」的區塊都要跟著換——遠征下拉的選項在 renderExped 內只建一次
// （靠 expedSelLang 偵測語言），待驗證封包清單則要重讀 DB 才能換掉按鈕與說明文字。
onPrefsChange(() => {
    applyStaticI18n();
    renderAll();
    if (isDebugUiEnabled()) void renderWanted().catch(() => { });
});
// 靜態 HTML（index.html 內非 JS 產生的標題文字）的翻譯套用點：切語言時連同動態渲染一起重跑。
function applyStaticI18n() {
    document.title = t('ov.brandShort');   // 面板彈出視窗的標題也用在地化品牌短名
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n!);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle!);
    });
    document.querySelectorAll<HTMLImageElement>('[data-i18n-alt]').forEach(el => {
        el.alt = t(el.dataset.i18nAlt!);
    });
}
applyStaticI18n();
// maxId 只代表本次 panel 已重建到哪一筆；projectionThroughEventId 才是四張 derived tables
// 與 cleared 更新的耐久進度。snapshot、render、wanted 與 autoSwitch 都不得改動後者。
let maxId = 0, projectionThroughEventId = 0, ready = false;
const pending: number[] = [];   // 待消費的 live 事件 id（保持由小到大）
let tab: 'general' | 'exped' | 'activity' | 'sortie' | 'factory' | 'order' = 'general';
let manualOverride = false;          // 使用者手動切過分頁後暫停自動切換
let currentContext: string | null = null;  // 目前情境（port / sortie / exped）
let expedId: number | null = null;
let view: number[] = [0];
let cn = 1;
let showLbas = false;
let selectedLbasArea: number | null = null;
const expandedQuests = new Set<number>();   // 使用者展開查看內容的任務編號
const expandedExped = new Set<number>();    // 使用者展開查看遠征名稱；重繪／倒數不應收回
// 一般大破卡點擊後只隱藏文字，紅框仍固定覆蓋航空戰欄，不另設會擠壓版面的收縮態。
let taihaDetailsHidden = false;
// 裝備／資源／HTML 跳脫：與 overview 共用 utils/html-escape.ts（零 chrome.*）。
// 熟練度以符號表示（對映遊戲內熟練度徽章階層：1-3 直線、4-6 斜線、7 為 ace 雙箭）。
// 不吐數字（數字寬度隨值變動、破壞對齊），確切等級留在 chip 的 title 提示。'>' 需轉義。
const alvMark = (alv: number) =>
    ['', '|', '||', '|||', '/', '//', '///', '&gt;&gt;'][Math.min(7, Math.max(0, alv))];
// 改修：+1~+9 顯示數字，+10（滿改修）顯示五角星、不顯示數字；未改修回空字串。
const impMark = (level: number) =>
    level >= 10 ? '★' : level > 0 ? String(level) : '';
// 資源圖示：面板慣用 i18n key（'mat.fuel'），轉成共用 matIconHtml 的檔名＋alt。
const matIconHtml = (key: string) => matIconFile(key.slice(4), t(key));
// 出擊定版使用的戰術素材。這些圖檔是 extension 的公開資產，正式 panel 與離線預覽
// 共用同一套來源，避免預覽畫得出來、正式頁卻退回文字圓點。風格規範見
// docs/design-guidelines.md §5.1；除非使用者明確指示，panel 系統圖示一律沿用擬真剪影。
const tacticalIcon = (file: string) => `/icons/tactical/${file}`;
const bossNodeSvg = (letter: string) => `<svg class="s-boss-node-svg" viewBox="0 0 100 120"
    preserveAspectRatio="xMidYMid meet" role="presentation" aria-hidden="true" focusable="false">
    <path class="s-boss-head" d="M 50 114 C 23 114 5 95 5 66 C 5 44 16 29 29 22 C 26 15 20 8 14 3 C 27 6 37 16 42 28 C 45 27 48 26 50 26 C 52 26 55 27 58 28 C 63 16 73 6 86 3 C 80 8 74 15 71 22 C 84 29 95 44 95 66 C 95 95 77 114 50 114 Z" />
    <text class="s-boss-letter" x="50" y="86" text-anchor="middle">${esc(letter)}</text>
  </svg>`;
const searchRadarHtml = () => `<svg class="s-system-glyph search" viewBox="0 0 24 24" role="img" aria-label="索敵雷達" focusable="false">
    <circle class="search-ring outer" cx="12" cy="12" r="10" />
    <circle class="search-ring middle" cx="12" cy="12" r="6.8" />
    <circle class="search-ring inner" cx="12" cy="12" r="3.6" />
    <path class="search-grid" d="M 12 2 L 12 22 M 2 12 L 22 12" />
    <path class="search-sweep" d="M 12 12 L 20.8 7 A 10 10 0 0 1 22 12 Z" />
    <path class="search-needle" d="M 12 12 L 20.8 7" />
    <circle class="search-blip" cx="17.2" cy="8.4" r="1.15" />
    <circle class="search-center" cx="12" cy="12" r="1.3" />
  </svg>`;
const aaciGunHtml = () => `<span class="s-system-glyph aaci"><img class="aaci-gun-raster" src="${tacticalIcon('bofors-40mm-aaci-mirrored.png')}" alt="對空 CI" /></span>`;
const lbasAircraftHtml = () => `<span class="s-system-glyph lbas" title="基地航空隊"><img class="lbas-aircraft-raster" src="${tacticalIcon('b25-lbas-support.png')}" alt="基地航空隊" /></span>`;
const supportAircraftHtml = (kind: 'air' | 'shell' | 'torpedo' | 'asw' | 'none') => {
    if (kind === 'air') return `<span class="s-system-glyph support-air" title="航空支援"><img class="support-aircraft-raster" src="${tacticalIcon('comet-air-support.png')}" alt="航空支援" /></span>`;
    if (kind === 'asw') return `<span class="s-system-glyph support-asw" title="對潛支援"><img class="support-asw-raster" src="${tacticalIcon('ka2-asw-support.png')}" alt="對潛支援" /></span>`;
    if (kind === 'torpedo') return `<span class="s-system-glyph support-torpedo" title="雷擊支援"><img class="support-torpedo-raster" src="${tacticalIcon('knox-torpedo-support.png')}" alt="雷擊支援" /></span>`;
    return `<span class="s-system-glyph support-shell" title="砲擊支援"><img class="support-ship-raster" src="${tacticalIcon('yamato-north-style.png')}" alt="砲擊支援" /></span>`;
};
const crescentHtml = () => `<img class="s-night-moon" src="${tacticalIcon('brass-crescent.png')}" alt="" aria-hidden="true" />`;
const formationSvgHtml = (id: number) => {
    const dots = formationRects(id);
    const marks = `<g transform="translate(31 31) scale(.82) translate(-31 -31)">${dots.map(([x, y]) => `<rect x="${x}" y="${y}" width="6" height="6" rx="1" />`).join('')}</g>`;
    return `<svg class="s-formation-icon" viewBox="0 0 62 62" role="img" aria-label="陣形" focusable="false"><circle cx="31" cy="31" r="27" fill="none" stroke="currentColor" stroke-width="3" />${marks}</svg>`;
};
const sakuraAnchorHtml = (isNew: boolean) => {
    const label = isNew ? '新掉落櫻錨' : '已有船櫻錨';
    const file = isNew ? 'sakura-anchor-new.png' : 'sakura-anchor-owned.png';
    return `<img class="s-sakura-anchor ${isNew ? 'new' : 'owned'}" src="${tacticalIcon(file)}" alt="${label}" draggable="false" />`;
};
// 任務內容原文換行用字面 <br> 標籤（非 \n，見 api_no
// 637/643/861 等）；先跳脫全文防 XSS，再把跳脫後的 &lt;br&gt; 還原成真正換行。
// 不做任何翻譯，玩家自行用其他工具查照原文即可。escDetail 留在 panel（組合 esc）。
const escDetail = (s: string) => esc(s).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
const fmt = (t: number) => {
    const s = Math.max(0, Math.floor((t - Date.now()) / 1000));
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
// 與 fmt() 不同：吃「剩餘毫秒」而非絕對時刻，且只到分:秒（泊地修理/給糧的週期
// 都在 20 分內，不需要小時位）。
const mmss = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// 泊地修理／給糧倒數的文字。0＝週期已滿，下次進母港即結算。
const countdownText = (ms: number) => (ms <= 0 ? t('repair.ready') : mmss(ms));
// ── 狀態橫幅 ──────────────────────────────
// 面板「看起來壞掉」的三種狀態（還在載入／讀取暫時失敗積壓中／已停止接收）都必須在
// 畫面上說出原因：只寫 console 的話使用者只會看到一個不動的面板，無從判斷該不該重載。
// fatal 一旦顯示就不再被其他訊息蓋掉——那是使用者唯一的線索，只能由重新載入清除。
type NoticeKind = 'none' | 'loading' | 'backlog' | 'fatal';
let noticeKind: NoticeKind = 'none';
function setNotice(kind: NoticeKind, text = '', hint = '') {
    if (noticeKind === 'fatal' && kind !== 'fatal') return;
    noticeKind = kind;
    if (kind === 'none') {
        noticeEl.hidden = true;
        noticeEl.innerHTML = '';
        return;
    }
    noticeEl.hidden = false;
    noticeEl.className = kind === 'fatal' ? 'err' : '';
    noticeEl.innerHTML = `<span class="grow">${esc(text)}${hint ? ` ${esc(hint)}` : ''}</span>` +
        (kind === 'fatal' ? `<button data-reload="1">${esc(t('panel.reload'))}</button>` : '');
}
noticeEl.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('button[data-reload]')) location.reload();
});
// 例外訊息原樣顯示（Dexie 的版本衝突等錯誤訊息本身就是最有用的線索），不改寫、不吞。
const describeError = (error: unknown) =>
    error instanceof Error ? (error.message || error.name) : String(error);
const expedFleetLabel = document.getElementById('exped-fleet-label')!;
const expedSel = document.getElementById('exped-select') as HTMLSelectElement;
const expedCheckEl = document.getElementById('exped-check')!;
const currentExpedFleet = () => view[0] ?? 0;   // 永遠跟隨艦隊分頁目前選的第一支
let expedFleetShown: number | null = null;   // 遠征分頁上次渲染的艦隊，用來偵測切換以帶出該隊上次遠征
let expedSelLang: ReturnType<typeof getLang> | null = null;   // 遠征下拉建立當下的語言，換語言要重建選項
function renderHeader() {
    const c = state.counts();
    // 標籤改用圖示（艦＝軍艦側影／裝＝金銀齒輪，與遊戲原圖同語彙）；
    // 全名放 title 供 hover 與無障礙，排版不再受各語系字寬影響。
    const stat = (kind: string, label: string, cur: number, max: number, margin: number) =>
        `<span class="stat ${max > 0 && cur >= max - margin ? 'warn' : ''}" title="${esc(label)}">` +
        `<img class="h-icon" src="/icons/ui/${kind}.svg" alt="${esc(label)}"> <b>${cur}/${max || '?'}</b></span>`;
    // 提督名＋等級成組共用一個 title：遊戲限定名稱最長 12 文字，但 12 個全角字在 420px
    // 面板仍會擠掉右側統計，故名稱過長仍以省略號截斷；hover 一次補回「全名　Lv等級」。
    const nick = state.nickname || '???';
    headerEl.innerHTML =
        `<span class="idbox" title="${esc(nick)}　Lv${state.hqLv}">` +
        `<span class="nick">${esc(nick)}</span>` +
        `<span class="num">Lv${state.hqLv}</span>` +
        `</span>` +
        `<span class="grow"></span>` +
        stat('ship', t('header.ships'), c.ships, c.maxShips, 4) +
        stat('equip', t('header.equip'), c.gears, c.maxGears, 20);
}
// 語言/主題切換只在「鎮守府情報總括」進行（單一控制中心，見 utils/ui-prefs.ts）；
// 面板不再放語言選單，改由 onPrefsChange() 監聽 storage 事件被動同步套用＋重繪。
function renderTabs() {
    // 出擊／建造／開發／改修的「歷史紀錄清單」已移至「鎮守府情報總括」分頁；
    // 工廠分頁仍保留（只留「當下」看板：最新開發/改修結果＋建造中渠倒數，見
    // renderFactoryLive）——歷史清單移出不代表即時資訊要跟著消失。
    // 紀錄的擷取/歸檔仍在 consume() 進行（與是否顯示無關），總括頁讀 db 呈現歷史。
    // 「動態」分頁僅開發用 UI（見 utils/debug-ui.ts），上架建置不顯示。
    const activityBtn = isDebugUiEnabled()
        ? `<button data-t="activity" class="${tab === 'activity' ? 'on' : ''}">${t('tab.activity')}</button>`
        : '';
    tabsEl.innerHTML = `
      <button data-t="general" class="${tab === 'general' ? 'on' : ''}">${t('tab.general')}</button>
      <button data-t="sortie" class="${tab === 'sortie' ? 'on' : ''}">${t('tab.sortie')}</button>
      <button data-t="exped" class="${tab === 'exped' ? 'on' : ''}">${t('tab.exped')}</button>
      <button data-t="factory" class="${tab === 'factory' ? 'on' : ''}">${t('tab.factory')}</button>
      <button data-t="order" class="${tab === 'order' ? 'on' : ''}">${t('tab.order')}</button>
      ${activityBtn}`;
}
// 切換分頁的共用函式（manual=true 代表使用者手動點選，會暫停自動切換）
function setTab(next: typeof tab, manual: boolean) {
    // 正式建置沒有動態分頁：若收到 activity 狀態，退回一般。
    tab = next === 'activity' && !isDebugUiEnabled() ? 'general' : next;
    if (manual) manualOverride = true;
    generalEl.style.display = tab === 'general' ? '' : 'none';
    document.getElementById('tab-exped')!.style.display = tab === 'exped' ? '' : 'none';
    document.getElementById('tab-sortie')!.style.display = tab === 'sortie' ? '' : 'none';
    document.getElementById('tab-factory')!.style.display = tab === 'factory' ? '' : 'none';
    // 調度分頁要 flex 填滿 #tabpanel（表內部捲動）；其他分頁用預設 block。
    orderEl.style.display = tab === 'order' ? 'flex' : 'none';
    tabpanelEl.classList.toggle('has-general', tab === 'general');
    tabpanelEl.classList.toggle('has-order', tab === 'order');
    tabpanelEl.classList.toggle('has-exped', tab === 'exped');
    activityEl.style.display = tab === 'activity' && isDebugUiEnabled() ? '' : 'none';
    renderTabs(); renderExped(); renderSortie();
    if (tab === 'factory') renderFactory();
    if (tab === 'order') renderOrder();
}
// 依情境自動切換分頁：
//   - 進入新情境（ctx 改變）→ 一律切換並解除手動暫停
//   - 同一情境內（例如出擊中連續戰鬥）→ 若使用者手動切過分頁則尊重之，不強行切回
function autoSwitch(desired: typeof tab, ctx: string) {
    if (ctx !== currentContext) {
        currentContext = ctx;
        manualOverride = false;
        setTab(desired, false);
    } else if (!manualOverride) {
        setTab(desired, false);
    }
}
tabsEl.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !b.dataset.t) return;
    setTab(b.dataset.t as typeof tab, true);
});
document.getElementById('battle-content')!.addEventListener('click', e => {
    const warning = (e.target as HTMLElement).closest<HTMLButtonElement>('#taiha-toggle');
    if (!warning) return;
    taihaDetailsHidden = !taihaDetailsHidden;
    renderSortie();
});
function renderGeneral() {
    // 資源抬頭固定為 4×2；資源圖示與數字成組靠左，避免在窄面板被欄內對齊拉開。
    const m = state.materials;
    const res = (key: string, v: number | undefined, sec = false) =>
        `<span class="res-item${sec ? ' sec' : ''}" title="${esc(t(key + '.full'))}">${matIconHtml(key)} <b>${(v ?? 0).toLocaleString()}</b></span>`;
    resline.innerHTML = m.length ? [
        res('mat.fuel', m[0]), res('mat.ammo', m[1]), res('mat.steel', m[2]), res('mat.bauxite', m[3]),
        res('mat.torch', m[4], true), res('mat.drum', m[5], true), res('mat.devmat', m[6], true), res('mat.screw', m[7], true),
    ].join('') : '';
    // 三欄資料列不再把身分圖示塞進每一列：欄頂的固定圖示負責辨識種類；遠征列只留
    // 艦隊、任務編號、倒數。名稱以 hover／點列展開，避免長字串壓縮倒數欄。
    missionsEl.innerHTML = state.missions().map(mm => {
        const name = expedDisplayName(mm.missionId, mm.name);
        const fleet = Number(mm.fleet);
        const open = Number.isSafeInteger(fleet) && expandedExped.has(fleet);
        return `
      <div class="g-item">
        <div class="g-chip" data-exped-fleet="${esc(mm.fleet)}" title="${esc(name)}" aria-expanded="${open}">
          <span class="fleet-box">${esc(mm.fleet)}</span>
          <span class="g-eta grow">${esc(mm.dispNo)}</span>
          <span class="g-eta">${fmt(mm.completeAt)}</span>
        </div>
        <div class="exped-detail"${open ? '' : ' hidden'}>${esc(name)}</div>
      </div>`;
    }).join('') || `
      <div class="g-empty">${t('common.empty')}</div>`;
    // 入渠／建造沿用同一種 chip，欄頂固定圖示已在 HTML 中提供身分，不重複塞進資料列。
    ndocksEl.innerHTML = state.ndocks().map(n => `
      <div class="g-chip">
        <span class="g-name" title="${esc(n.ship)}">${esc(n.ship)}</span>
        <span class="g-eta">${fmt(n.completeAt)}</span>
      </div>`).join('') || `<div class="g-empty">${t('common.empty')}</div>`;
    // kdock 只有實際點進工廠「建造」分頁才會送封包，單純被動擷取拿不到就是拿不到（見 CLAUDE.md
    // 設計原則1）。跟「有資料但目前沒建造中」區分開來，避免使用者誤以為是顯示 bug；
    // 短標籤放 title 收全文，避免在窄欄內爆版。
    kdocksEl.innerHTML = state.kdocks().map(k => `
      <div class="g-chip${k.state === 3 ? ' done' : ''}">
        <span class="g-name" title="${esc(k.ship)}">${esc(k.ship)}</span>
        <span class="g-eta">${k.state === 3 ? t('kdock.complete') : fmt(k.completeAt)}</span>
      </div>`).join('') || `<div class="g-empty" title="${esc(state.kdockData.length === 0 ? t('kdock.notOpened') : t('common.empty'))}">${state.kdockData.length === 0 ? t('kdock.notOpenedShort') : t('common.empty')}</div>`;
    // 任務區吃掉資訊區剩餘高度並自行捲動；不可截斷清單，否則第 9 筆以後的受注任務會
    // 完全消失。每個任務包成 cell，展開說明只影響任務區，不會推動上方資訊抬頭。
    const quests = state.quests_();
    questsEl.innerHTML = quests.map(q => {
        const open = expandedQuests.has(q.no);
        // 有解析出目標次數才顯示「已完成/目標」；解不出來（單次型任務、以「隻」為單位者）
        // 無法解析進度時顯示受注中／達成（見 utils/quest-progress.ts）。
        const progressLabel = !q.done && q.progress
            ? `<span class="q-prog" title="${esc(t('quest.progressHint'))}">${q.progress.count}/${q.progress.target}</span>`
            : `<span class="q-st">${q.done ? t('quest.done') : t('quest.inProgress')}</span>`;
        return `
      <div class="quest-cell">
        <div class="quest-row ${q.done ? 'done' : ''}" data-no="${q.no}">
          <span class="grow" title="${esc(q.name)}">${esc(q.name)}</span>
          ${progressLabel}
        </div>${open ? `<div class="quest-detail">${q.detail ? escDetail(q.detail) : t('quest.noDetail')}</div>` : ''}
      </div>`;
    }).join('') || `<div class="empty">${t('common.empty')}</div>`;
}
missionsEl.addEventListener('click', e => {
    const row = (e.target as HTMLElement).closest('[data-exped-fleet]') as HTMLElement | null;
    if (!row) return;
    const fleet = Number(row.dataset.expedFleet);
    if (!Number.isSafeInteger(fleet)) return;
    if (expandedExped.has(fleet)) expandedExped.delete(fleet); else expandedExped.add(fleet);
    renderGeneral();
});
questsEl.addEventListener('click', e => {
    const row = (e.target as HTMLElement).closest('.quest-row') as HTMLElement | null;
    if (!row) return;
    const no = Number(row.dataset.no);
    if (expandedQuests.has(no)) expandedQuests.delete(no); else expandedQuests.add(no);
    renderGeneral();
});
// 目前是否為聯合檢視（恰好第一＋第二艦隊）——view 無序，故用集合語意判斷。
function isCombinedView() {
    return view.length === 2 && view.includes(0) && view.includes(1);
}
// 該隊是否有大破或未補給的船——條件與 renderFleets/renderCombinedFleets 的
// danger/warn badge 相同，供艦隊編號 tab 判斷是否加紅框提醒。
function fleetNeedsAttention(f: FleetView) {
    // 退避艦已離開艦隊，它的大破／未補給不該再讓編成編號亮紅框（回港後才需要處理）。
    return f.ships.some(s => !s.escaped
        && ((s.maxhp && s.hp / s.maxhp <= 0.25) || s.fuel < s.maxFuel || s.bull < s.maxBull));
}
// 基地航空隊沒有大破/燃彈概念，「未補給」對應的是已配備隊有機數耗損未補滿
// （renderAirBases 的 sq.count < sq.maxCount，同一份 depleted 判斷）。
function lbasNeedsAttention() {
    return state.airBases_().some(ab => ab.squadrons.some(sq => sq.state === 1 && sq.count < sq.maxCount));
}
/**
 * 基地航空隊鈕要標的疲勞程度：任一中隊紅標記＝`exhausted`，否則任一黃標記＝`tired`。
 * 兩段各自對應遊戲內的 cond 0–19／20–29（封包送來已是換算好的狀態碼）。
 * **取最嚴重的一段**，不加總也不平均——按鈕只回答「要不要現在去看」，最慘的那一隊決定答案。
 * 範圍是所有海域（同 `lbasNeedsAttention`）：按鈕在收合狀態下不分海域，只挑一個海域看會漏報。
 */
function lbasCondSeverity(): 'tired' | 'exhausted' | null {
    let tired = false;
    for (const ab of state.airBases_()) {
        for (const sq of ab.squadrons) {
            if (sq.state !== 1) continue;
            // `lbasCondStateNow`（非 `lbasCondState`）：疲勞回復不推封包，直接用封包值
            // 會讓按鈕一直亮著遊戲裡早就消失的疲勞
            // 只有橙／赤才染色：`mild`（cond 1）遊戲本身不顯示標記，
            // 染上去等於比遊戲還吵，那是過度提醒的方向。
            const kind = state.lbasCondStateNow(sq.cond, ab);
            if (kind === 'exhausted') return 'exhausted';
            if (kind === 'tired') tired = true;
        }
    }
    return tired ? 'tired' : null;
}
/**
 * 出擊當下把編成檢視切到「這次出擊的那一隊」。出擊前多半在看別隊編組，
 * 一按出擊想看的必然是出擊中的隊；連合艦隊（旗艦隊為第1）自動切成 1+2 併看。
 *
 * 只在 `api_req_map/start` 觸發一次，同一次出擊之後使用者點哪隊就維持哪隊，
 * 故不需要 autoSwitch 那套 manualOverride。`showLbas` 刻意不動——出擊中基地
 * 航空隊同樣是要看的東西，把使用者從那裡拉走是搶操作。
 */
function switchFleetViewToSortie() {
    const fleetId = state.currentSortieFleetId;
    if (!Number.isSafeInteger(fleetId) || fleetId < 0 || fleetId > 3) return;
    view = state.combinedFlag > 0 && fleetId === 0 ? [0, 1] : [fleetId];
}
function renderFleetNav() {
    const names = ['1', '2', '3', '4'];
    const all = state.fleets();
    const lbasCond = lbasCondSeverity();
    fleetnavEl.innerHTML =
        names.map((n, i) => {
            const visible = !showLbas && view.includes(i);
            // 大破／未補給只以編成編號的紅框提醒，故目前正在顯示的艦隊也要保留紅框；
            // 不再於艦隊資訊列重複塞「未補給」文字，避免七船編成多出一行而捲動。
            const cls = [visible ? 'on' : '', all[i] && fleetNeedsAttention(all[i]) ? 'attn' : ''].filter(Boolean).join(' ');
            return `<button data-i="${i}" class="${cls}">${n}</button>`;
        }).join('') +
        // 聯合艦隊＝1+2 同時檢視的捷徑。遊戲當下若真的組了連合艦隊
        // （state.combinedFlag: 1=機動/2=水上/3=輸送），按鈕文字改顯示對應部隊種類，
        // 讓使用者不用猜就知道現在是哪種連合；未組連合時維持通用「連合艦隊」字樣。
        `<button data-combined="1" class="${!showLbas && isCombinedView() ? 'on' : ''}" title="${esc(t('fleet.combinedTitle'))}">${state.combinedFlag ? t(`fleet.combinedType.${state.combinedFlag}`) : t('fleet.combined')}</button>` +
        // 疲勞（中隊 cond）與未補給（機數耗損）是兩種不同的提醒，各走各的 class：
        // 前者染文字與外框（分黃/紅兩段），後者維持既有的紅框。兩者可同時成立。
        `<span class="grow"></span><button data-lbas="1" class="${[showLbas ? 'on' : '', lbasNeedsAttention() ? 'attn' : '', lbasCond ? `cond-${lbasCond}` : ''].filter(Boolean).join(' ')}" ${state.airBases.size === 0 ? `title="${esc(t('lbas.selectAreaFirst'))}"` : ''}>${t('lbas.button')}</button>`;
}
fleetnavEl.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    // LBAS toggle
    if (b.hasAttribute('data-lbas')) {
        showLbas = !showLbas;
        fleetsEl.style.display = showLbas ? 'none' : '';
        airBasesEl.style.display = showLbas ? '' : 'none';
        renderFleetNav();
        if (showLbas) renderAirBases();
        return;
    }
    // 聯合艦隊：切成 1+2 同時檢視；已在聯合狀態再按一次退回單看第一艦隊。
    if (b.hasAttribute('data-combined')) {
        if (showLbas) {
            showLbas = false;
            fleetsEl.style.display = '';
            airBasesEl.style.display = 'none';
            view = [0, 1];
        } else {
            view = isCombinedView() ? [0] : [0, 1];
        }
        renderFleetNav(); renderFleets(); renderExped();
        return;
    }
    if (b.dataset.i === undefined) return;
    if (showLbas) {
        showLbas = false;
        fleetsEl.style.display = '';
        airBasesEl.style.display = 'none';
    }
    // 單隊鈕一律只看該隊；聯合檢視只透過專屬「連合艦隊」鈕進入，避免用點擊順序隱含組合。
    const f = Number(b.dataset.i);
    view = [f];
    renderFleetNav(); renderFleets(); renderExped();
});
// 空白 chip（未裝備槽位／跨艦補位槽共用）：子元素與有裝備的 chip 完全一致，寬高由
// 這些子元素自然撐出，不必硬編尺寸追平。ex=true（打洞格）先天裝不了有熟練度的裝備、
// 也裝不了飛機（無搭載數可言），故只留改修槽、不建 r-col 兩行結構，靠 .chip 既有的
// align-items:center 直接垂直置中（見 shipRow 的 chip() 同款結構說明）。
// capacity：該槽是飛機槽時的滿載容量（即使真的沒裝備艦載機也要顯示，見 ShipView.slotCapacity
// 的說明）。非飛機槽是 undefined；但完全不可能搭載飛機的艦（驅逐艦等），部分實作
// 可能回傳 0 而非 undefined（該槽容量恰好 0＝不能放飛機），兩者都當「不顯示」處理
// （用 || 而非 ??），避免非空母艦種的空格白寫一個沒意義的「0」。
const blankChip = (cls: string, ex = false, capacity?: number) =>
    ex ? `<span class="chip ${cls}"><span class="g-icon-slot"></span><b></b></span>`
        : `<span class="chip ${cls}"><span class="g-icon-slot"></span><span class="r-col"><span class="r-top"><u></u><b></b></span><em class="oc">${capacity || ''}</em></span></span>`;
// chip 結構：左側圖示、右欄（r-col）上排熟練＋改修、下排搭載機數——下排所有 chip
// （含空格、非飛機槽）都保留高度且靠左，確保每艘艦列高一致、對齊點固定。艦載機槽
// （g.count 有值）才有數字：滿載低調灰、戰損（少於滿載）轉橘、全滅轉紅；滿載數
// 未知（缺 start2 maxeq）時只顯示數字不變色。
// 打洞格（ex=true）先天裝不了有熟練度的裝備、也裝不了飛機（無搭載數可言），故
// 只留改修槽、不建 r-col 兩行結構——單一個 <b> 靠 .chip 既有的 align-items:center
// 直接垂直置中，不用另外湊一個永遠空的搭載數行去撐版面。
// 搭載數的 hover 後綴。出擊途中的搭載數是**估算值**（遊戲只送整場合計損失機數，
// 不送逐格殘量，見 GameState.queuePlaneLoss／spreadPlaneLoss），必須標示，回港由母港封包實數校正。
function slotCountTitle(g: GearView) {
    if (g.count == null) return '';
    const est = g.countEst ? `（${t('fleet.slotCountEst')}）` : '';
    return ` [${g.count}${g.countMax != null ? `/${g.countMax}` : ''}]${est}`;
}
function gearChip(g: NonNullable<ShipView['exGear']>, ex = false) {
    const title = `${esc(g.name)}${g.level ? ` ★${g.level}` : ''}${g.alv ? ` »${g.alv}` : ''}${esc(slotCountTitle(g))}`;
    if (ex) return `<span class="chip ${g.cat} ex" title="${title}">${gearIconHtml(g.icon, g.short)}<b>${impMark(g.level)}</b></span>`;
    const ocCls = g.count == null || g.countMax == null ? '' : g.count <= 0 ? 'zero' : g.count < g.countMax ? 'hit' : '';
    return `<span class="chip ${g.cat}" title="${title}">` +
        `${gearIconHtml(g.icon, g.short)}<span class="r-col"><span class="r-top"><u>${alvMark(g.alv)}</u><b>${impMark(g.level)}</b></span>` +
        `<em class="oc ${ocCls}">${g.count ?? ''}</em></span></span>`;
}
// 泊地修理／給糧：算出該艦隊的兩份計畫＋摘要 badge。
// 倒數一律標為估算（遊戲不送這兩個機制的封包，計時器靠觀察編成封包推算）；
// 錨點不可考（面板剛裝、或該筆編成封包已被裁剪）時只顯示範圍、不顯示倒數。
function repairPlansOf(f: FleetView) {
    const now = Date.now();
    const rep = planAnchorageRepair(f, f.repairAnchor == null ? undefined : now - f.repairAnchor);
    const mor = planMoraleSupply(f, f.moraleAnchor == null ? undefined : now - f.moraleAnchor);
    // 倒數獨立成 .rcd 元素並把錨點/週期存進 data-*，讓每秒 tick 只改這顆的文字；
    // 整塊重繪會重建裝備圖示並關閉使用者正打開的索敵倍率 select。
    const countdown = (anchor: number | null | undefined, interval: number) => {
        const ms = nextSettlementIn(anchor, interval);
        if (ms === undefined) return '';
        return ` <span class="rcd" data-anchor="${anchor}" data-interval="${interval}">${countdownText(ms)}</span>`;
    };
    const badges =
        (rep.active
            ? `<span class="badge-tag repair" title="${esc(t('repair.repairTitle'))}">${t('repair.repairBadge', { n: rep.coverage })}${rep.accelerated ? t('repair.accelSuffix') : ''}${countdown(f.repairAnchor, REPAIR_INTERVAL_MS)}</span>`
            : '') +
        (mor.active
            ? `<span class="badge-tag morale" title="${esc(t('repair.moraleTitle'))}">${t('repair.moraleBadge', { n: mor.slots.filter(s => s.willRecover).length })}${countdown(f.moraleAnchor, MORALE_INTERVAL_MS)}</span>`
            : '') +
        // 範圍成立但計時錨點不可考時，明講「倒數不可考」而不是默默不顯示——
        // 否則使用者會以為是功能壞了。
        ((rep.active && f.repairAnchor === undefined) || (mor.active && f.moraleAnchor === undefined)
            ? `<span class="badge-tag est" title="${esc(t('repair.unknownAnchorTitle'))}">${t('repair.unknownAnchor')}</span>`
            : '');
    return { rep, mor, badges };
}
// 泊地修理／給糧的逐艦標記與左緣範圍軌。idx 為該艦在艦隊中的 0-based 位置。
// 回傳 { cls, mark }：cls 疊到 .ship（畫軌條），mark 插進艦名列（說明會不會生效）。
function repairMarks(idx: number, rep: AnchorageRepairPlan, mor: MoralePlan) {
    const cls: string[] = [];
    const mark: string[] = [];
    const repSlot = rep.active ? rep.slots[idx] : undefined;
    if (repSlot) {
        cls.push('rail-rep');
        if (repSlot.willRepair) {
            mark.push(`<span class="rmark rep" title="${esc(t('repair.willRepair'))}">${t('repair.markRepair')}${repSlot.predictedHp != null ? `+${repSlot.predictedHp}` : ''}</span>`);
        } else if (repSlot.skip && repSlot.skip !== 'full') {
            mark.push(`<span class="rmark rep skip" title="${esc(t(`repair.skip.${repSlot.skip}`))}">${t('repair.markRepair')}</span>`);
        }
    }
    const morSlot = mor.active ? mor.slots[idx] : undefined;
    if (morSlot && !(idx === mor.sourceIndex)) {
        cls.push('rail-mor');
        if (morSlot.willRecover) {
            mark.push(`<span class="rmark mor" title="${esc(t('repair.willMorale'))}">${t('repair.markMorale')}${morSlot.predictedCond != null ? morSlot.predictedCond : ''}</span>`);
        } else if (morSlot.skip) {
            mark.push(`<span class="rmark mor skip" title="${esc(t(`repair.skip.${morSlot.skip}`))}">${t('repair.markMorale')}</span>`);
        }
    }
    return { cls: cls.join(' '), mark: mark.join('') };
}
// 退避艦標記：單隊／聯合兩種艦列共用。退避是「這艘已經不在艦隊裡了」的狀態，
// 不是傷害等級，故用中性的灰標＋整列淡出，不佔用大破/中破的語意色。
function escapedTag(s: ShipView) {
    return s.escaped
        ? `<span class="esc-tag" title="${esc(t('fleet.escapedTitle'))}">${esc(t('fleet.escaped'))}</span>`
        : '';
}
// 艦名 hover：一律顯示**封包原始日文艦名**（不是譯名）。這是與遊戲畫面對照的唯一
// 途徑；聯合檢視中原名也能補回省略號截掉的完整名稱，故不做「相同就省略」的最佳化。
function shipNameTitle(s: ShipView) {
    return ` title="${esc(s.nameJa || s.name)}"`;
}
function stClass(s: ShipView) {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    return r <= 0.25 ? 'st-major' : r <= 0.5 ? 'st-mid' : r <= 0.75 ? 'st-minor' : '';
}
function condClass(s: ShipView) {
    return s.cond >= 50 ? 'sparkle' : s.cond <= 19 ? 'heavy' : s.cond <= 29 ? 'tired' : '';
}
const vitSupply = (s: ShipView) => {
    const pct = (v: number, max: number) => max ? Math.round(100 * v / max) : 100;
    const fp = pct(s.fuel, s.maxFuel), bp = pct(s.bull, s.maxBull);
    return `<span class="vit-sup">` +
        `<span class="sup-f" title="${esc(t('mat.fuel.full'))} ${fp}%">${matIconFile('fuel', t('mat.fuel.full'))}${fp}</span>` +
        `<span class="sup-a" title="${esc(t('mat.ammo.full'))} ${bp}%">${matIconFile('ammo', t('mat.ammo.full'))}${bp}</span>` +
        `</span>`;
};
const taihaMark = (s: ShipView) => {
    if (s.escaped || s.inDock || stClass(s) !== 'st-major') return '';
    return `<span class="taiha-mark">${esc(t('fleet.heavyDamage'))}</span>`;
};
const taihaHpMark = (s: ShipView) => {
    if (s.escaped || s.inDock || stClass(s) !== 'st-major') return '';
    return `<span class="taiha-hp-mark">${esc(t('fleet.heavyDamage'))}</span>`;
};
const condDisplay = (s: ShipView) => {
    const cond = condClass(s);
    const isTaiha = !s.escaped && !s.inDock && stClass(s) === 'st-major';
    if (!isTaiha) return `<span class="cond ${cond}">${s.cond}</span>`;
    const label = t('fleet.heavyDamage');
    return `<button type="button" class="taiha-cond-toggle cond ${cond}" aria-expanded="false" aria-label="${esc(`${label}：${t('fleet.heavyDamageReveal')}`)}" title="${esc(t('fleet.heavyDamageReveal'))}">${taihaMark(s)}<span class="taiha-cond-value">${s.cond}</span></button>`;
};
const dockMark = (s: ShipView) => {
    if (!s.inDock) return '';
    return `<span class="dock-mark" title="${esc(t('fleet.inDockTitle'))}">${esc(t('fleet.inDock'))}</span>`;
};
const FLEET_REGULAR_SLOTS = 5;
function shipRow(s: ShipView, _maxSlots: number, marks?: { cls: string; mark: string }) {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    const st = stClass(s);
    // ★改修與熟練恆佔固定寬度的槽（即使該裝備無改修/熟練也保留空槽），使不同艦艇的
    // 同格數裝備列能等寬對齊。空槽由 CSS 的固定寬度撐出。
    // 未裝備的槽位（該艦真實擁有、但 api_slot 為 -1 的槽）也畫出空 chip 佔位，使裝備數
    // 不同的艦仍以相同槽數對齊（例如 4 格全裝 vs 4 格裝 2 個，兩者裝備列同寬）。飛機槽
    // 即使沒裝備艦載機，容量數字（slotCapacity）依然要顯示，不能因為空著就整個消失。
    const realChips = s.gears.map((g, i) => g ? gearChip(g) : blankChip('chip-empty', false, s.slotCapacity[i])).join('');
    // 打洞格（補強增設）不混在一般裝備流裡，改置於列尾、靠右貼著燃彈 chip；未裝備時
    // 畫空格但與一般空裝備格區分（brass 虛線呼應已裝備的 .ex 樣式，見 CSS
    // .chip-empty.ex）；該艦根本無打洞能力時放隱形補位格，讓打洞格／燃彈跨艦垂直對齊。
    const exChip = s.exGear ? gearChip(s.exGear, true)
        : s.exEmpty ? blankChip('chip-empty ex', true)
            : blankChip('chip-pad ex', true);
    const padCount = FLEET_REGULAR_SLOTS - s.gears.length;
    const chips = realChips + blankChip('chip-pad').repeat(Math.max(0, padCount));
    const nameNow = `<span class="grow"${shipNameTitle(s)}>${esc(s.name)}${escapedTag(s)}</span>`;
    return `<div class="ship ${st} ${s.escaped ? 'escaped' : ''} ${s.inDock ? 'in-dock' : ''} ${marks?.cls ?? ''}">
      <div class="ship-body">
        <div class="ship-id">${s.stype ? `<span class="stype">${esc(s.stype)}</span>` : ''}${nameNow}${marks?.mark ?? ''}${dockMark(s)}<span class="num">Lv${s.lv}</span></div>
        <div class="ship-vitals">
          <div class="vit-hp"><span class="hp-num">${s.hp}</span><span class="hp-max">/${s.maxhp}</span>${taihaHpMark(s)}<span class="hpbar"><i style="width:${Math.round(r * 100)}%"></i></span></div>
          <div class="vit-aux"><span class="cond ${condClass(s)}">${s.cond}</span>${vitSupply(s)}</div>
        </div>
        <div class="sub-row"><div class="chips">${chips}${exChip}</div></div>
      </div>
    </div>`;
}
function renderExped() {
    if (tab !== 'exped') return;
    expedFleetLabel.textContent = t('fleet.default', { n: currentExpedFleet() + 1 });
    // 選單只在圖鑑載入後、且尚未建立時填充；語言換了也要重建（遠征名、海域標籤與
    // 時間都在選項文字裡，不重建的話整個下拉會停在切換前的語言）。
    if (expedSel.options.length === 0 || expedSelLang !== getLang()) {
        const cat = state.expedCatalog();
        if (cat.length === 0) { expedCheckEl.innerHTML = `<div class="empty">${t('exped.masterNotLoaded')}</div>`; return; }
        let area = -1, html = '';
        for (const m of cat) {
            if (m.maparea !== area) {
                if (area !== -1) html += '</optgroup>';
                area = m.maparea;
                html += `<optgroup label="${esc(t('exped.area', { n: area }))}">`;
            }
            const timeStr = m.time ? ` (${Math.floor(m.time / 60)}:${String(m.time % 60).padStart(2, '0')})` : '';
            html += `<option value="${m.id}">[${esc(m.dispNo)}] ${esc(expedDisplayName(m.id, m.name))}${timeStr}</option>`;
        }
        expedSel.innerHTML = html + '</optgroup>';
        expedSelLang = getLang();
        // 重建會把選取洗掉：把使用者目前選的遠征選回來，不要因為換語言就跳回第一項。
        if (expedId !== null && expedSel.querySelector(`option[value="${expedId}"]`)) {
            expedSel.value = String(expedId);
        } else {
            expedId = Number(expedSel.value);
        }
    }
    // 切換艦隊時，預設選中該艦隊上次執行/回來的遠征（若已知且存在於選單中）；
    // 同一艦隊內維持使用者目前的選擇，不覆蓋。
    const fleet = currentExpedFleet();
    if (fleet !== expedFleetShown) {
        expedFleetShown = fleet;
        const last = state.lastMissionForDeck(fleet);
        if (last !== null && expedSel.querySelector(`option[value="${last}"]`)) {
            expedId = last;
            expedSel.value = String(last);
        }
    }
    if (expedId === null) return;
    const { rows, gsRows, known, rewards, greatSuccess } = state.expedCheck(currentExpedFleet(), expedId);
    const allOk = rows.length > 0 && rows.every(r => r.ok);
    const successMark = allOk
        ? `<span class="exped-status ok">${t('exped.successMet')}</span>`
        : `<span class="exped-status ng">${t('exped.successNotMet')}</span>`;
    // 大成功率は全遠征で公式値（16 + 15×戰意高昂 + √Lv + Lv/10）。成功条件を満たす場合のみ有効。
    const gsMark = !greatSuccess
        ? '<span class="exped-status dim">-</span>'
        : !allOk
            ? `<span class="exped-status ng">${t('exped.gsExcluded')}</span>`
            : `<span class="exped-status gs" title="${esc(greatSuccess.note)}">${t('exped.gsRate', { rate: greatSuccess.rate })}</span>`;

    const resItems = (r: { fuel: number; bullet: number; steel: number; alum: number }) => {
        const mats: [string, number][] = [
            ['mat.fuel', r.fuel],
            ['mat.ammo', r.bullet],
            ['mat.steel', r.steel],
            ['mat.bauxite', r.alum],
        ];
        const nonZero = mats.filter(([, v]) => v > 0);
        const items = nonZero.length > 0 ? nonZero : mats;
        return items.map(([k, v]) => `<span class="res-item">${matIconHtml(k)} ${v}</span>`).join('');
    };

    // 有大発動艇系裝備加成時，資源數字整段變色標示（sparkle 金色＝「有加成」語意色）；
    // 獲得量靠右對齊，放置於第三欄。
    const normalRes = rewards?.amountsVerified ? `
        <div class="exped-res-line${rewards.bonusActive ? ' bonus' : ''}" title="${esc(rewards.bonusActive ? t('exped.bonusHint') : '')}">
            ${resItems(rewards.normal)}
        </div>` : rewards ? `<div class="exped-res-line"><span class="item-note dim">${t('exped.rewardAmountUnverified')}</span></div>` : '<div class="exped-res-line"></div>';

    const greatRes = rewards?.amountsVerified ? `
        <div class="exped-res-line${rewards.bonusActive ? ' bonus' : ''}" title="${esc(rewards.bonusActive ? t('exped.bonusHint') : '')}">
            ${resItems(rewards.great)}
        </div>` : '<div class="exped-res-line"></div>';

    const itemsText = rewards?.items.map(it => `${it.name}×${it.max}${it.guaranteed ? ` ${t('exped.gsOnly')}` : ` ${t('exped.randomOnSuccess')}`}`).join(' ') ?? '';
    const itemsHtml = rewards?.items.length ? `
        <span class="exped-lbl">${t('exped.items')}</span>
        <div class="exped-items-line" title="${esc(itemsText)}">
            ${rewards.items.map(it => `<span class="item-name">${esc(it.name)}×${it.max}</span>${it.guaranteed
                ? `<span class="item-note gs">${t('exped.gsOnly')}</span>`
                : `<span class="item-note dim">${t('exped.randomOnSuccess')}</span>`}`).join(' ')}
        </div>` : '';

    const yieldGridHtml = `
        <div class="exped-yield-grid">
            <span class="exped-lbl">${t('exped.success')}</span>
            ${successMark}
            ${normalRes}

            <span class="exped-lbl">${t('exped.greatSuccess')}</span>
            ${gsMark}
            ${greatRes}

            ${itemsHtml}
        </div>`;

    const allRows = [...rows, ...gsRows];
    const warn = known ? '' : `<div class="check-row ng"><span class="mark">!</span><span class="grow">${t('exped.notRecorded')}</span></div>`;
    const isMultiCol = allRows.length > 8;
    const checkListHtml = `
        <div class="exped-check-list${isMultiCol ? ' is-multi-col' : ''}">
            ${warn}
            ${allRows.map(r => `
                <div class="check-row ${r.ok ? 'ok' : 'ng'}">
                    <span class="mark">${r.ok ? '✓' : '✕'}</span>
                    <span class="grow" title="${esc(r.label)}">${esc(r.label)}</span>
                    ${r.cur ? `<span class="num${r.ok ? '' : ' ng'}">${esc(r.cur)}</span>` : ''}
                </div>`).join('')}
        </div>`;

    expedCheckEl.innerHTML = yieldGridHtml + checkListHtml;
}
expedSel.addEventListener('change', () => { expedId = Number(expedSel.value); renderExped(); });
// 聯合艦隊檢視專用的精簡艦列：420px 硬約束下兩隊左右並排，每欄只剩約 190px，
// 塞不下單隊檢視原尺寸的裝備 chip 列（含 r-col 熟練/改修兩行的完整結構太寬、
    // 排起來又跟單隊檢視幾乎一樣，聯合檢視應該要更精簡）。取捨後只留出擊當下真正
// 要盯的五件事：艦種＋艦名（辨識）、HP 條與數值（大破判斷）、cond（疲勞）、
// 燃彈殘量（補給）、裝備圖示＋搭載數（辨識制空/雷裝來源）。改修★／熟練度不
// 顯示於列面，收進 title 供 hover 查看即可。
// 全槽展開：未裝備的槽位也畫空圖示佔位（含飛機槽的滿載容量數字），不像早前版本
// 只列出已裝備者——使用者要一眼看出「這艘還有空格能塞裝備」，不必切回單隊檢視確認。
function compactGearRow(s: ShipView) {
    const cgItem = (g: GearView, ex = false) => {
        const title = `${esc(g.name)}${g.level ? ` ★${g.level}` : ''}${g.alv ? ` »${g.alv}` : ''}${esc(slotCountTitle(g))}`;
        const ocCls = g.count == null || g.countMax == null ? '' : g.count <= 0 ? 'zero' : g.count < g.countMax ? 'hit' : '';
        return `<span class="cg-item ${g.cat}${ex ? ' ex' : ''}" title="${title}">${gearIconHtml(g.icon, g.short)}${g.count != null ? `<em class="${ocCls}">${g.count}</em>` : ''}</span>`;
    };
    // class 用 cg-empty（非裸 empty）：面板全域 `.empty,.dim` 有水平 padding，會讓空格
    // 撐寬並使裝備列換行；命名空間化可避免樣式碰撞。
    const cgBlank = (capacity?: number, ex = false) =>
        `<span class="cg-item cg-empty${ex ? ' ex' : ''}"><span class="g-icon-slot"></span>${capacity ? `<em>${capacity}</em>` : ''}</span>`;
    const slots = s.gears.map((g, i) => g ? cgItem(g) : cgBlank(s.slotCapacity[i]));
    // 補強增設格獨立於一般槽位流之外、固定靠右對齊（同單隊檢視 shipRow 的 exChip
    // 排法）：一般槽位數因艦而異（2-5 格），但五格空母的搭載數也必須保持同一列，
    // 不能讓額外換行把該艦列撐高。用外層 flex（.c-gear）分兩塊：.c-gear-slots
    // 固定單列＋打洞格（flex:none，天然被推到最右）。 */
    const exItem = s.exGear ? cgItem(s.exGear, true) : s.exEmpty ? cgBlank(undefined, true) : '';
    if (slots.length === 0 && !exItem) return '';
    return `<div class="c-gear"><span class="c-gear-slots">${slots.join('')}</span>${exItem}</div>`;
}
function compactShipRow(s: ShipView, marks?: { cls: string; mark: string }) {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    const st = r <= 0.25 ? 'st-major' : r <= 0.5 ? 'st-mid' : r <= 0.75 ? 'st-minor' : '';
    const cond = s.cond >= 50 ? 'sparkle' : s.cond <= 19 ? 'heavy' : s.cond <= 29 ? 'tired' : '';
    const pct = (v: number, max: number) => max ? Math.round(100 * v / max) : 100;
    const fp = pct(s.fuel, s.maxFuel), bp = pct(s.bull, s.maxBull);
    // 燃彈沿用單隊檢視的雙色迷你量表，但去掉數字（寬度不夠），實數移到 title。
    const supply =
        `<span class="c-sup" title="${esc(t('mat.fuel.full'))} ${fp}% ／ ${esc(t('mat.ammo.full'))} ${bp}%">` +
        `<i style="background-image:linear-gradient(to right,#58a55c ${fp}%,transparent ${fp}%)"></i>` +
        `<i style="background-image:linear-gradient(to left,#a8763e ${bp}%,transparent ${bp}%)"></i></span>`;
    return `<div class="ship c ${st} ${s.escaped ? 'escaped' : ''} ${s.inDock ? 'in-dock' : ''} ${marks?.cls ?? ''}">
      <div class="c-top">
        <span class="stype">${esc(s.stype)}</span>
        <span class="grow"${shipNameTitle(s)}>${esc(s.name)}${escapedTag(s)}</span>${dockMark(s)}
        ${marks?.mark ?? ''}${condDisplay(s)}
      </div>
      <div class="c-hp"><span class="hpbar"><i style="width:${Math.round(r * 100)}%"></i></span>
        <span class="c-hp-value"><span class="hp-num">${s.hp}</span><span class="hp-max">/${s.maxhp}</span></span>
        <span class="c-aux">${supply}</span>
      </div>
      ${compactGearRow(s)}
    </div>`;
}
// 聯合艦隊：頂部一列「兩隊合計」總覽（Lv／制空／索敵／速力／TP，見
// GameState.combinedSummary），下方第一／第二艦隊左右各佔一欄（不換行堆疊）。
// 每欄自己只留大破警示，數字統計不重複顯示——都在頂部合計列看；未補給只標在編成編號紅框。
// 制空值。熟練度過時（艦載機被擊墜過、但遊戲還沒送過新的裝備資料）時標成估算：
// 值本身照算，只是**可能偏高**——熟練度掉了我們看不到，掉多少也不推算（見
// GameState.alvStale）。虛線底線沿用面板既有的估算視覺語彙（.badge-tag.est）。
function airPowerHtml(air: { min: number; max: number }, stale: boolean) {
    const v = air.min === air.max ? `${air.min}` : `${air.min}~${air.max}`;
    return `<span class="fs-pri">${t('fleet.airPower')} <b${stale ? ` class="est" title="${esc(t('fleet.airPowerStaleTitle'))}"` : ''}>${v}</b></span>`;
}
function fleetMetricsHtml(sum: { lvSum: number; air: { min: number; max: number }; airStale: boolean; f33: number; speed: string; tp?: { total: number; gear: number } }, combined = false) {
    const los = `<span class="fs-pri">${t('fleet.scouting33')} <b>${sum.f33.toFixed(1)}</b>
      <select class="cn">${[1, 2, 3, 4].map(x => `<option value="${x}" ${x === cn ? 'selected' : ''}>×${x}</option>`).join('')}</select></span>`;
    const speed = `<span class="fs-sec"><b>${sum.speed}</b></span>`;
    const level = `<span class="fs-sec">${combined ? t('fleet.lvTotal') : 'Lv'} <b>${sum.lvSum}</b></span>`;
    const tp = sum.tp && sum.tp.gear > 0
        ? `<span class="fs-sec" title="${esc(t('fleet.transportTPTitle'))}">${t('fleet.transportTP')} <b>${sum.tp.total}</b></span>` : '';
    return `<div class="fs-metrics">${airPowerHtml(sum.air, sum.airStale)}${los}${speed}${level}${tp}</div>`;
}
function renderCombinedFleets() {
    const all = state.fleets();
    const sum = state.combinedSummary(cn);
    const totalHead = `<div class="fsummary combined-total">${fleetMetricsHtml(sum, true)}</div>`;
    const cols = [0, 1].map(i => {
        const f = all[i];
        if (!f) return `<section class="fleet compact"><div class="empty">${t('common.empty')}</div></section>`;
        // 左右位置本身就是第1/第2艦隊，不需要再標一次隊名（沒有警示時整列不佔版面）。
        // 未補給只用編成編號紅框提醒。
        //
        // **大破刻意不在這裡掛徽章**：這一列是「有東西才出現」的條件列，大破一發生就憑空
        // 多長一列、把整排艦往下推，正在盯的那一艘突然換位置。改比照單隊檢視，把警示長在
        // 大破艦自己身上（艦名轉紅，見 index.html 的 .ship.c.st-major .c-top .grow），
        // 不佔版面。出擊中的完整大破警告本來就在出擊分頁，不靠這顆徽章。
        return `<section class="fleet compact">${f.ships.map(s => compactShipRow(s)).join('')}</section>`;
    }).join('');
    fleetsEl.innerHTML = `<div class="combined-wrap">${totalHead}<div class="c-fleet-row">${cols}</div></div>`;
}
function renderFleets() {
    if (isCombinedView()) { renderCombinedFleets(); return; }
    const all = state.fleets();
    // 全編成（所有艦隊，非僅目前檢視的分頁）取槽數最大值，讓每艘船的裝備列補到同一
    // 行數／高度——若只算目前顯示的艦隊，切換單隊↔聯合檢視時列高會跳動。
    // 只算一般槽：打洞格已獨立成列尾固定位置（見 shipRow 的 exChip），不佔左側裝備流。
    const maxSlots = FLEET_REGULAR_SLOTS;
    fleetsEl.innerHTML = [...view].sort((a, b) => a - b).map(i => {
        const f = all[i];
        if (!f) return '';
        const sum = state.fleetSummary(i, cn);
        // 艦隊區塊不顯示額外的秘書艦／編成標題列，以保留七艘編成的垂直空間；出擊／大破等
        // 即時狀態併入 fsummary 第一行，未補給只用編成編號紅框提醒。
        const { rep, mor, badges: repairBadges } = repairPlansOf(f);
        const ops =
            (f.mission ? `<span class="fs-tick mission">${t('fleet.onMission')}</span>` : '') +
            (repairBadges ? `<span class="fs-tick repair-state">${repairBadges}</span>` : '');
        const summary = sum ? `<div class="fsummary">
            ${ops ? `<div class="fs-ops">${ops}</div>` : ''}
            ${fleetMetricsHtml(sum)}
          </div>` : '';
        const fleetClass = f.ships.length >= 7
            ? ` fleet-seven${ops ? ' fleet-seven-ops' : ''}`
            : '';
        return `<section class="fleet${fleetClass}">${summary}${f.ships.map((s, idx) => shipRow(s, maxSlots, repairMarks(idx, rep, mor))).join('')}</section>`;
    }).join('');
}
fleetsEl.addEventListener('change', e => {
    const sel = (e.target as HTMLElement).closest('select.cn') as HTMLSelectElement | null;
    if (!sel) return;
    cn = Number(sel.value);
    renderFleets();
});
fleetsEl.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.taiha-cond-toggle');
    if (!btn || !fleetsEl.contains(btn)) return;
    const revealed = btn.getAttribute('aria-expanded') !== 'true';
    btn.classList.toggle('revealed', revealed);
    btn.setAttribute('aria-expanded', String(revealed));
});
// 中隊疲勞標記：遊戲內是三段（內部 cond 30–46 無標記／20–29 黃臉／0–19 紅臉），封包給的
// `api_cond` 是換算好的**顯示碼**（0=全滿／1=輕度疲勞（遊戲同樣不顯示標記）／2=橙／3=赤，
// 四份真封包定案，見 GameState.lbasCondState），故這裡只是換符號、不含任何判定。
// 用**表情**而非「疲勞」二字的理由：(a) 零 i18n（符號不必進三語字典）、(b) 中隊改 2×2
// 雙欄後欄寬只剩一半，兩個漢字要吃掉中隊名約 30px。
// ⚠️ **必須是內聯 SVG**：面板其他圖示走 `<img src>`，SVG 是獨立文件、吃不到外部 CSS，
// 那條路無法用 currentColor 沿用既有的 `.cond-tired`／`.cond-exhausted` 語意色。
// 造型本身也要帶階序（不只靠顏色，色覺障礙者才分得出）：黃臉平眼平嘴、紅臉閉眼苦笑。
const condFaceSvg = (kind: 'tired' | 'exhausted') =>
    `<svg class="cond-face" viewBox="0 0 16 16" aria-hidden="true">` +
    `<circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
    (kind === 'tired'
        ? `<circle cx="5.6" cy="6.5" r=".95" fill="currentColor"/><circle cx="10.4" cy="6.5" r=".95" fill="currentColor"/>` +
        `<path d="M5.3 10.6h5.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>`
        : `<path d="M4.4 6.3l2.2 1.2M11.6 6.3l-2.2 1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>` +
        `<path d="M5.3 11.4q2.7-2.6 5.4 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>`) +
    `</svg>`;
/**
 * 疲勞標記的 markup。未知狀態畫不出對應表情，維持原始值文字。
 * `hint` 是資料時間說明——疲勞值是觀測當下的快照、遊戲回復時不推封包，故標記還在
 * 不代表「此刻」還疲勞（只代表還不能斷定已回復），這件事要講在 title 裡。
 */
function condMarkHtml(
    kind: ReturnType<GameState['lbasCondState']>,
    label: string,
    hint = '',
    certainty: ReturnType<GameState['lbasCondCertaintyNow']> = 'certain',
): string {
    if (!label) return '';
    const title = esc(hint ? `${label}\n${hint}` : label);
    // 輕度疲勞（cond 1）：**遊戲本身不顯示標記**，所以這裡只給一顆很安靜的空心點，
    // 不畫臉也不用警示色——它的用途是「還沒到黃臉、但已經不是全滿」（KC3Kai 同樣分這兩種）。
    if (kind === 'mild') {
        return `<span class="sq-cond mild" title="${title}"><i class="cond-dot"></i></span>`;
    }
    if (kind === 'tired' || kind === 'exhausted') {
        // `unsure`＝可能已回復但不能斷定（見 GameState.lbasCondCertaintyNow）：淡化表現，
        // 不把「還不能斷定」畫成跟「確定還在疲勞」一樣的實心臉。標記仍然留著——
        // 拿掉才是危險方向（把仍疲勞的中隊謊報成正常）。
        const unsure = certainty === 'possiblyRecovered' ? ' unsure' : '';
        // label 仍掛在 title 上：符號不佔版面地保留既有的 i18n 說明與可及性
        return `<span class="sq-cond face cond-${kind}${unsure}" title="${title}">${condFaceSvg(kind)}</span>`;
    }
    return `<span class="sq-cond cond-${kind}" title="${title}">${esc(label)}</span>`;
}
function renderAirBases() {
    const bases = state.airBases_();
    if (bases.length === 0) {
        airBasesEl.innerHTML = `<div class="empty">${t('lbas.noData')}</div>`;
        return;
    }
    const areas = [...new Set(bases.map(b => b.areaId))].sort((a, b) => b - a);
    if (selectedLbasArea === null || !areas.includes(selectedLbasArea)) {
        selectedLbasArea = areas[0]!;
    }
    let html = `<div class="ab-tabs">` + areas.map(a =>
        `<button data-area="${a}" class="${a === selectedLbasArea ? 'on' : ''}">${esc(state.mapAreaName(a))}</button>`
    ).join('') + `</div>`;
    const maintenanceLevel = state.airBaseMaintenanceLevel(selectedLbasArea);
    const maintenance = maintenanceLevel == null ? '' :
        `<span class="ab-maintenance" title="${esc(t('lbas.maintenanceTitle'))}">${esc(t('lbas.maintenance', { n: maintenanceLevel }))}</span>`;
    html += `<h3 class="ab-area-label"><span>${esc(state.mapAreaName(selectedLbasArea))}</span>${maintenance}</h3>`;
    for (const ab of bases.filter(b => b.areaId === selectedLbasArea)) {
        const actCls = `act-${Math.min(ab.actionKind, 4)}`;
        const actLabel = state.actionLabel(ab.actionKind);
        // 疲勞快照的年齡：標記還在只代表「還不能斷定已回復」，不是「此刻確定疲勞」
        const condAsOfHint = ab.condAsOf == null ? ''
            : t('lbas.cond.asOf', { n: Math.max(0, Math.floor((Date.now() - ab.condAsOf) / 60_000)) });
        const airStr = ab.airPower.min === ab.airPower.max
            ? `${ab.airPower.min}` : `${ab.airPower.min}~${ab.airPower.max}`;
        // 抬頭列＋中隊 2×2（見 index.html「基地航空隊」段的版面硬約束）：一個海域最多
        // 三隊、一隊最多四個中隊，三隊必須不捲動就看得完。
        html += `<div class="ab-card">
          <div class="ab-head1">
            <span class="ab-name">${esc(ab.name)}</span>
            <span class="ab-inline-stats">${t('fleet.airPower')} <b>${airStr}</b> · ${t('lbas.radius')} <b>${ab.distance}</b></span>
            <span class="grow"></span>
            <span class="ab-action ${actCls}">${actLabel}</span>
          </div>
          <div class="ab-sq-grid">`;
        for (const sq of ab.squadrons) {
            if (sq.state !== 1) {
                html += `<div class="ab-sq empty-sq"><span class="sq-name">${t('lbas.notDeployed')}</span></div>`;
                continue;
            }
            // 疲勞一律走「經過時間修正後」的狀態（見 GameState.lbasCondStateNow）；
            // 被判定為必定已回復時整個標記不顯示，與遊戲畫面對齊。
            const condState = state.lbasCondStateNow(sq.cond, ab);
            const condLabel = state.lbasCondLabelOf(condState, sq.cond);
            const condCertainty = state.lbasCondCertaintyNow(sq.cond, ab);
            // 「可能已回復」只在真的不能斷定時才講，確定還在疲勞時講會變成雜訊
            const condHint = [
                condAsOfHint,
                condCertainty === 'possiblyRecovered' ? t('lbas.cond.maybeRecovered') : '',
            ].filter(Boolean).join('\n');
            const depleted = sq.count < sq.maxCount;
            html += `<div class="ab-sq">
              <span class="sq-chip ${sq.cat}" title="${esc(sq.name)}${sq.level ? ` ★${sq.level}` : ''}${sq.alv ? ` »${sq.alv}` : ''}">${gearIconHtml(sq.icon, sq.short)}${sq.alv ? `<u>${alvMark(sq.alv)}</u>` : ''}${sq.level ? `<b>${impMark(sq.level)}</b>` : ''}</span>
              <span class="sq-name" title="${esc(sq.name)}">${esc(sq.name)}</span>
              <span class="sq-count ${depleted ? 'depleted' : ''}">${sq.count}/${sq.maxCount}</span>
              ${condMarkHtml(condState, condLabel, condHint, condCertainty)}
            </div>`;
        }
        html += '</div></div>';
    }
    airBasesEl.innerHTML = html;
}
airBasesEl.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (b && b.dataset.area) {
        selectedLbasArea = Number(b.dataset.area);
        renderAirBases();
    }
});
function renderAll() {
    renderHeader(); renderTabs(); renderGeneral(); renderFleetNav(); renderFleets(); renderExped(); renderSortie(); renderFactory();
    renderOrder();
    if (showLbas) renderAirBases();
}
function getEdgeLetter(mapArea: number, mapNo: number, edgeId: number) {
    // 節點字母不在任何封包裡，只能透過 utils/map-node-letters.ts 查對照表。
    // 封包 edge 編號沒有可驗證的字母推導規則，故查不到對照時顯示遊戲的 cell 編號，不推算。
    return nodeLabel(`${mapArea}-${mapNo}`, edgeId);
}

// 節點顏色只使用已有封包語意：能動分歧明確為白色，其餘已驗證的非戰鬥節點為藍色。
// 沒有 event_id／event_kind 的舊紀錄不補猜，維持原本的戰鬥節點樣式。
const NON_BATTLE_NODE_KINDS = new Set<string>([
    NODE_KIND_KEYS.resource,
    NODE_KIND_KEYS.maelstrom,
    NODE_KIND_KEYS.noEnemy,
    NODE_KIND_KEYS.nothing,
    NODE_KIND_KEYS.airRecon,
    NODE_KIND_KEYS.escortSuccess,
    NODE_KIND_KEYS.landing,
]);
function sortieNodeClass(node: { eventId?: number; eventKind?: number }, current: boolean) {
    const kind = nodeKindKey(node.eventId, node.eventKind);
    const classes = ['s-node', 'visited'];
    if (kind === NODE_KIND_KEYS.branch) classes.push('branch');
    else if (kind && NON_BATTLE_NODE_KINDS.has(kind)) classes.push('no-battle');
    if (current) classes.push('current');
    return classes.join(' ');
}
// 未出擊時的關卡量表列。**刻意共用 sortieGaugeBarHtml 與出擊中完全同一組 title／斬殺期
// 判定**——兩處各寫一份遲早會漂移成「出擊中說斬殺期、母港說還要兩次」。沒有任何未攻略的
// HP 量表海域（例如平時只打一般圖）時整塊不出現，不佔版面。
function mapGaugeListHtml(): string {
    const maps = state.unclearedHpGaugeMaps();
    if (maps.length === 0) return '';
    const rows = maps.map(({ mapId, mapArea, mapNo, gauge }) => {
        const mapCode = `${mapArea}-${mapNo}`;
        const isEvent = isEventWorld(mapArea);
        const mapStr = mapLabel({ event: isEvent, mapnum: mapNo, map: mapCode });
        const diff = isEvent ? diffLabel(gauge.selectedRank ?? 0) : '';
        const r = state.mapRemainingRuns(mapId);
        const hint = r != null
            ? t('sortie.hintEstRuns', { n: r, kind: t('sortie.kindDefeat') })
            : t('sortie.hintNeedBoss');
        const zansatsu = state.mapInFinalPhase(mapId);
        const title = [
            t('sortie.gaugeTitle', { now: gauge.nowHp, max: gauge.maxHp, hint }),
            zansatsu ? t('sortie.zansatsuLabel') : '',
        ].filter(Boolean).join('\n');
        return `<div class="s-standby-map">
            <div class="s-map-id" title="${esc(diff ? `${mapCode}・${diff}` : mapCode)}">${esc(mapStr)}${diff ? `<i>${esc(diff)}</i>` : ''}</div>
            ${sortieGaugeBarHtml({
                now: gauge.nowHp, max: gauge.maxHp, finalPhase: zansatsu,
                title, finalLabel: t('sortie.zansatsuLabel'),
            })}
        </div>`;
    }).join('');
    return `<div class="s-standby-maps">${rows}</div>`;
}
function renderSortie() {
    if (tab !== 'sortie') return;
    const info = state.battleInfo;
    const sortie = state.sortieInfo;
    const sortieEl = document.getElementById('battle-content')!;
    if (!sortie) {
        // 未出擊時：列出尚未攻略的 HP 量表海域，含斬殺期標示。**這一格刻意不等出擊**——
        // 「還剩多少、是不是斬殺線內」正是決定要不要出擊、帶什麼編成的依據，出擊一次的
        // 資源成本很高，把答案鎖在出擊後才顯示等於在使用者最需要它的時候藏起來。
        // 量表值來自 mapinfo（點開出擊海域選單就送來），斬殺線來自本機出擊紀錄。
        sortieEl.innerHTML = `<div class="s-standby">
            <div class="s-standby-hint">${t('sortie.notEntered')}</div>
            ${mapGaugeListHtml()}
        </div>`;
        return;
    }
    // 損失機數：>0 時以紅色 -N 顯示（例：-23）
    const planeLost = (lost: number) => lost > 0 ? `<i>−${lost}</i>` : '';
    // 敵我方機數格一律保留本場的紅色損失數。結算後仍需能回看這一戰的代價，不能只剩
    // 殘存數而失去戰損資訊；數值維持「出擊機數 − 損失」的同一語意。
    const planeCell = (v: { count: number; lost: number }) => `<b>${v.count}</b>${planeLost(v.lost)}`;
    let html = '<div class="sortie-container">';
    // 標題列：海域編號 + 節點軌跡 + 狀態，合併為一行省高度。
    // 關卡進度使用 mapinfo 的兩種量表（見 state.ts MapGaugeView 註解）。
    // 無資料（尚未開過海域選擇畫面）時不顯示，難度亦然。
    const gauge = state.currentMapGauge();
    // 海域代號：活動海域用遊戲介面與玩家的說法 E{n}＋難度徽章（甲乙丙丁），內部編號
    // （62-1）只留在 tooltip；一般海域維持 6-5 這種寫法。**與出擊紀錄分區共用
    // sortie-detail.ts 的 mapLabel/diffLabel**，兩邊寫法不會各自漂移。
    // 難度取自 mapinfo 的 api_selected_rank，一般圖／尚未選難度恆為 0＝不顯示徽章。
    const mapCode = `${sortie.mapArea}-${sortie.mapNo}`;
    const isEvent = isEventWorld(sortie.mapArea);
    const mapStr = mapLabel({ event: isEvent, mapnum: sortie.mapNo, map: mapCode });
    const diff = isEvent ? diffLabel(gauge?.selectedRank ?? 0) : '';
    let nodeDots = '';
    for (const [index, n] of sortie.nodes.entries()) {
        const letter = getEdgeLetter(sortie.mapArea, sortie.mapNo, n.id);
        const isBoss = isBossNode(n);
        const nodeClass = sortieNodeClass(n, index === sortie.nodes.length - 1);
        nodeDots += isBoss
            ? `<div class="${nodeClass} boss">${bossNodeSvg(letter)}</div>`
            : `<div class="${nodeClass}">${esc(letter)}</div>`;
    }
    let gaugeHtml = '';
    // 量表本體：一顆圓矩 pill，殘量條當背景、**剩餘實數直接寫在條子裡**。
    // 使用者要求（活動海域）一眼看到 2760/4600 這種攻略血量，而不是由 HP 推估的
    // 「剩 N 次」——推估值不是封包事實，改留在 tooltip 裡當補充說明。
    const gaugeBar = (now: number, max: number, zansatsu: boolean, title: string) => sortieGaugeBarHtml({
        now, max, finalPhase: zansatsu, title,
    });
    if (gauge?.cleared) {
        // 已攻略關卡回應不再帶量表欄位，一律顯示已攻略勾號
        gaugeHtml = `<div class="s-gauge cleared" title="${esc(t('sortie.cleared'))}">✓</div>`;
    } else if (gauge?.gaugeType === 1 && gauge.requiredDefeatCount > 0) {
        // 擊破數式（一般圖5番/EO）：量表隨擊破遞減，條子裡寫「剩餘擊破次數／需求次數」
        // （與 gaugeType 2 一致採剩餘語意，避免把已擊破數誤讀為剩餘數）
        const remain = Math.max(0, gauge.requiredDefeatCount - gauge.defeatCount);
        // 擊破數式沒有可驗證的 boss HP 斬殺線，剩最後一次也不能冒充「Final」。
        gaugeHtml = gaugeBar(
            remain,
            gauge.requiredDefeatCount,
            false,
            t('sortie.remainingHits', { n: remain, done: gauge.defeatCount, total: gauge.requiredDefeatCount }),
        );
    } else if ((gauge?.gaugeType === 2 || gauge?.gaugeType === 3) && gauge.maxHp > 0 && gauge.maxHp !== 9999) {
        // HP量表式(gaugeType 2, boss撃破)／TP輸送型(gaugeType 3)：條子裡一律寫封包實數
        // 「剩餘/最大」。剩餘次數是由 boss 旗艦 HP 推估的衍生值，改放 tooltip。
        const isTpGauge = gauge.gaugeType === 3;
        const r = isTpGauge ? null : state.mapRemainingRuns();
        const hint = r != null
            ? t('sortie.hintEstRuns', { n: r, kind: t('sortie.kindDefeat') })
            : isTpGauge ? '' : t('sortie.hintNeedBoss');
        // boss 撃破型殘量小於或等於最終形態 Boss HP → 進入斬殺期；TP 輸送型不適用。
        // 不用 `r === 1`：這裡直接沿用 mapInFinalPhase 的血條／Boss 證據判定。
        const zansatsu = !isTpGauge && state.mapInFinalPhase();
        const title = [
            t('sortie.gaugeTitle', { now: gauge.nowHp, max: gauge.maxHp, hint }),
            zansatsu ? t('sortie.zansatsuLabel') : '',
        ].filter(Boolean).join('\n');
        gaugeHtml = gaugeBar(gauge.nowHp, gauge.maxHp, zansatsu, title);
    } else if (gauge?.gaugeType === 2 && gauge.maxHp === 9999) {
        // maxHp=9999：尚未選擇難度的佔位值，非真實 100%。
        gaugeHtml = `<div class="s-gauge locked" title="${esc(t('sortie.notChosenDifficulty'))}">🔒</div>`;
    } else if (gauge) {
        gaugeHtml = `<div class="s-gauge uncleared" title="${esc(t('sortie.uncleared'))}">－</div>`;
    }
    html += `
        <div class="s-header">
            <div class="s-map-id" title="${esc(diff ? `${mapCode}・${diff}` : mapCode)}">${esc(mapStr)}${diff ? `<i>${esc(diff)}</i>` : ''}</div>
            ${gaugeHtml}
            <div class="s-nodes">${nodeDots}</div>
        </div>
    `;
    if (info) {
        // ── 大破警告 ──
        // 警告絕對定位於航空戰欄，不參與一般流，避免推動固定高度的敵艦列與系統列。
        // 旗艦大破後不能前往下一節點；因此不得同時顯示司令部退避的選項。
        let taihaHtml = '';
        if (info.flagshipTaiha) {
            const dameconMst = info.flagshipDamecon === 1 ? 42 : info.flagshipDamecon === 2 ? 43 : 0;
            const flagshipWarning = dameconMst
                ? {
                    text: t('sortie.taihaFlagshipDamecon', { item: state.gearName(dameconMst) }),
                    title: t('sortie.taihaFlagshipDameconTitle'),
                }
                : { text: t('sortie.taihaFlagship'), title: t('sortie.taihaFlagship') };
            taihaHtml = `<div class="taiha-alert s-taiha s-taiha-flagship open" title="${esc(flagshipWarning.title)}">
                <span class="taiha-head">${esc(flagshipWarning.text)}</span>
              </div>`;
        } else if (info.isTaiha) {
            const retreat = state.retreatAvailability();
            const canRetreat = retreat.state === 'ready';
            const retreatText = t(canRetreat ? 'sortie.taihaRetreatHint' : 'sortie.taihaRetreatNoEscort');
            const retreatTitle = canRetreat
                ? retreat.kind === 'combined' ? t('sortie.taihaRetreatHintTitle') : t('sortie.taihaRetreatSoloTitle')
                : t('sortie.taihaRetreatNoEscortTitle');
            taihaHtml = `<button type="button" class="taiha-alert s-taiha s-taiha-generic open${taihaDetailsHidden ? ' details-hidden' : ''}"
                id="taiha-toggle" aria-expanded="${!taihaDetailsHidden}"
                title="${esc(`${t('sortie.taihaWarning')}\n${retreatTitle}`)}">
                <span class="taiha-head">${esc(t('sortie.taihaWarning'))}</span>
                <span class="taiha-hint">${esc(retreatText)}</span>
              </button>`;
        }
        // 敵方編成：晶片式兩欄（隨伴在左、主隊在右，對齊遊戲排版）。
        // 單艦隊無隨伴時，僅顯示主隊單欄、橫向填滿（不留一半空白）。
        const eMain = info.resultFleets?.enemyMain || [];
        const eEsc = info.resultFleets?.enemyEscort || [];
        // 敵艦 hover 的詳細資訊：等級、素質四項與裝備清單。
        // 全部是戰鬥封包欄位（api_ship_lv／api_eParam／api_eSlot），封包沒帶就不寫那一行
        // ——空著比填 0 誠實（0 火力與「不知道火力」是兩件事）。
        // 逐項一行（素質四項、裝備逐顆），避免長名稱使 tooltip 任意折行而混淆數字與標籤。
        const enemyTitle = (name: string, hp: number, maxHp: number, d?: BattleEnemyShipView) => {
            const head = d?.lv ? `${name} Lv${d.lv}` : name;
            const lines = [head];
            if (maxHp > 0) lines.push(`HP ${Math.max(0, hp)}/${maxHp}`);
            if (d?.param) {
                lines.push(
                    `${t('sortie.enemyFirepower')} ${d.param[0] ?? 0}`,
                    `${t('sortie.enemyTorpedo')} ${d.param[1] ?? 0}`,
                    `${t('sortie.enemyAa')} ${d.param[2] ?? 0}`,
                    `${t('sortie.enemyArmor')} ${d.param[3] ?? 0}`,
                );
            }
            if (d?.slots.length) {
                lines.push(t('sortie.enemyGears'), ...d.slots.map((g: number) => `　${state.gearName(g)}`));
            }
            return lines.join('\n');
        };
        const enemyChip = (s: typeof eMain[number], id: number, detail?: BattleEnemyShipView) => {
            const r = s.maxHp > 0 ? Math.max(0, s.hp) / s.maxHp : 0;
            const pct = Math.round(r * 100);
            const col = r <= 0 ? 'transparent' : r <= 0.25 ? 'var(--dmg-major)'
                : r <= 0.5 ? 'var(--dmg-mid)' : r <= 0.75 ? 'var(--dmg-minor)' : '#58a55c';
            const name = id > 0 ? state.shipName(id) : '?';
            const sunk = s.hp <= 0;
            return `<div class="s-echip ${sunk ? 'sunk' : ''}" title="${esc(enemyTitle(name, s.hp, s.maxHp, detail))}">
                <span class="s-echip-name">${esc(name)}</span>
                <span class="s-echip-hp"><i style="width:${pct}%;background:${col}"></i></span>
            </div>`;
        };
        const colBody = (ships: typeof eMain, ids: number[], details: BattleEnemyShipView[]) =>
            `<div class="s-ecol-body">${ships.map((s, i) => enemyChip(s, ids[i] || 0, details[i])).join('')}</div>`;
        const singleCls = eEsc.length ? '' : ' single';
        // 敵艦晶片區（左）與索敵/戰爆（右）固定並排在同一個 165px 高的 row，
        // 不論敵艦數量都不移動位置：上緣接晶片頂＝不是跟「主隊/隨伴」文字對齊，
        // 下緣接晶片底＝我方/敵方戰爆的下緣對齊敵艦晶片區下緣。
        html += `<div class="s-battle-row">
            <div class="s-efleet-heads${singleCls}">
                ${eEsc.length ? `<div class="s-ecol-h">${t('sortie.escortFleet')}</div>` : ''}
                <div class="s-ecol-h">${t('sortie.mainFleet')}</div>
            </div>
            <div class="s-efleet-body${singleCls}">
                ${eEsc.length ? colBody(eEsc, info.enemyIdsEscort, info.enemyDetail.escort) : ''}
                ${colBody(eMain, info.enemyIds, info.enemyDetail.main)}
            </div>
            <div class="s-eside">`;
        const engKeys = ['eng.unknown', 'eng.parallel', 'eng.opposite', 'eng.tAdvantage', 'eng.tDisadvantage'];
        const seikuKeys = ['seiku.even', 'seiku.secured', 'seiku.superior', 'seiku.inferior', 'seiku.lost'];
        const eng = t(engKeys[info.formation[2]] || 'eng.unknown');
        const p = info.planes;
        // 制空狀態只在「真的有航空戰」時才有意義：雙方都沒出動艦載機時遊戲照樣送
        // api_stage1 且 api_disp_seiku=1（真封包實證：samples/61-4.json 的 f_count=0／
        // e_count=0／disp_seiku=1），直接照抄會在潛水艦點、水雷戰隊出擊等場合誤報
        // 「確保」。判準與出擊紀錄分區（overview/sections/sortie-log.ts）一致：兩軍
        // 艦戰機數合計為 0 就是沒有航空戰，顯示「無」而非猜一個制空狀態。
        const hasAirBattle = p.playerFighter.count + p.enemyFighter.count > 0;
        const seikuStr = hasAirBattle && seikuKeys[info.seiku] ? t(seikuKeys[info.seiku]) : t('sortie.none');
        const seikuBad = hasAirBattle && (info.seiku === 3 || info.seiku === 4);
        const formationKeys: Record<number, string> = {
            1: 'form.single', 2: 'form.double', 3: 'form.ring', 4: 'form.ladder', 5: 'form.abreast', 6: 'form.vigilant',
            11: 'form.cruise1', 12: 'form.cruise2', 13: 'form.cruise3', 14: 'form.cruise4',
        };
        const enFormShort = t(formationKeys[info.formation[1]] || 'form.unknown');
        const rankStr = info.rank && info.rank !== '?' ? info.rank : '?';
        const rankKey = rankStr.replace(/\?$/, '').toUpperCase();
        const rankName = ({ S: '完全勝利', A: '勝利', B: '戰術的勝利', C: '戰術的敗北', D: '敗北' } as Record<string, string>)[rankKey] ?? '';
        const rnkClass = rankStr !== '?' ? `rank-${rankStr.toLowerCase().replace(/[^a-z]/g, '')}` : 'rank-unknown';
        const rankPredCls = info.hasResult ? '' : ' predicted';
        const rankTitle = info.hasResult ? t('sortie.ratingConfirmed') : t('sortie.ratingPredicted');
        const rankHtml = `<div class="s-rank-result" title="${esc(rankTitle)}">
            <span class="s-rank-grade ${rnkClass}${rankPredCls}">${esc(rankKey || '?')}${rankStr.endsWith('?') ? '<sup>?</sup>' : ''}</span>
            <span class="s-rank-name">${esc(rankName)}</span>
        </div>`;
        const formationHtml = `<div class="s-formation-compact" title="${esc(t('sortie.enemyFormationTitle'))}">
            <span class="s-formation-readout">${formationSvgHtml(info.formation[1])}<b>${esc(enFormShort)}</b></span>
        </div>`;
        const night = info.nightEffects;
        // `api_active_deck[1]` 是連合艦隊夜戰主／伴隊的權威來源；舊資料沒有此欄位時，
        // 才退回交戰事件作為相容顯示，不能把「沒有造成傷害」誤畫成另一個艦隊。
        const nightObserved = info.nightObserved
            ?? !!info.timeline?.phases.some(phase => phase.kind === 'nightShelling');
        const nightTargetIndices = (info.timeline?.phases ?? [])
            .filter(phase => phase.kind === 'nightShelling')
            .flatMap(phase => phase.events)
            .filter(event => event.defenderSide === 'enemy' && Number.isSafeInteger(event.defenderIndex))
            .map(event => event.defenderIndex as number);
        const fallbackNightTargetMain = nightTargetIndices.some(index => index < 6);
        const fallbackNightTargetEscort = nightTargetIndices.some(index => index >= 6);
        const nightTargetMain = info.nightTarget
            ? info.nightTarget === 'main' : fallbackNightTargetMain;
        const nightTargetEscort = info.nightTarget
            ? info.nightTarget === 'escort' : fallbackNightTargetEscort;
        const nightTargetKnown = info.nightTarget
            ? info.nightTarget !== 'unknown' : fallbackNightTargetMain || fallbackNightTargetEscort;
        const nightTargetEstimated = !!info.nightTargetEstimated && !nightObserved;
        // 月亮與主隊／伴隨是固定欄位，和夜偵、探照燈、照明彈一樣不能因為本節點沒有
        // 夜戰而移除；沒有夜戰時只轉暗，避免日戰畫面改變欄位位置。
        const showNightEntry = true;
        const nightEntryUnavailable = !info.midnightFlag && !nightObserved && !info.nightTarget;
        const nightEntryTitle = nightEntryUnavailable
            ? '本節點沒有夜戰；月亮與主隊／伴隨指示以暗色顯示'
            : nightTargetEstimated
                ? '依日戰結果推測夜戰目標；實際隊伍以夜戰封包為準'
                : !nightObserved
                    ? '夜戰尚未由戰鬥封包確認'
                    : !nightTargetKnown
                        ? '夜戰已發生；敵方目標隊伍未由現有傷害事件確認'
                        : '夜戰目標隊伍已由戰鬥事件確認';
        const nightEffectHtml = (kind: string, mst: number, short: string, label: string, active: boolean | undefined) =>
            `<span class="s-night-effect ${kind} ${active === undefined ? 'unknown' : active ? 'on' : 'off'}" title="${esc(`${label}：${active === undefined ? '狀態未知' : active ? '發動' : '未發動'}`)}">${gearIconHtml(state.gearIconId(mst), short)}</span>`;
        // 夜間觸接沿用該場夜戰封包明示的我方飛機 master；未觸接或舊資料缺欄位時，
        // 才退回夜偵通用圖示。這樣不同夜偵不會被錯畫成固定 102。
        const nightReconMst = info.nightTouchPlane && info.nightTouchPlane > 0
            ? info.nightTouchPlane : 102;
        const nightEntryHtml = !showNightEntry ? '' : `<span class="s-night-entry-group${!nightTargetKnown ? ' unknown' : ''}${nightTargetEstimated ? ' estimated' : ''}${nightEntryUnavailable ? ' unavailable' : ''}"
            title="${esc(nightEntryTitle)}" role="group" aria-label="夜戰主隊與伴隨指示">
            <span class="s-night-entry-moon">${crescentHtml()}</span>
            <span class="s-night-entry-cells">
              <span class="s-night-entry-cell main${nightTargetMain ? ' active' : ''}"><i></i><span>主隊</span></span>
              <span class="s-night-entry-cell escort${nightTargetEscort ? ' active' : ''}"><i></i><span>伴隨</span></span>
            </span>
          </span>`;
        const friendlyFleet = info.friendlyFleetIds?.length ? info.friendlyFleetIds : null;
        const friendlyFleetShipNames = friendlyFleet?.map(id => state.shipName(id)).filter(Boolean) ?? [];
        // KC3Kai 的友軍提示是清單而非單行字串；每艘船獨立一行，長艦名才不會把同一格
        // 撐寬或與夜戰目標重疊。title 仍保留換行，沒有自訂 tooltip 時也能取得同樣資訊。
        const friendlyFleetNames = friendlyFleetShipNames.join('\n');
        const friendlyFleetHover = friendlyFleet
            ? `<span class="s-friendly-hover" aria-hidden="true">${friendlyFleetShipNames.map(name => `<span>${esc(name)}</span>`).join('')}</span>`
            : '';
        const friendlyFleetHtml = `<span class="s-friendly-fleet${friendlyFleet ? ' on' : ' off'}" tabindex="0"
            role="img" aria-label="${esc(friendlyFleet ? t('sortie.friendlyFleetTitle', { ships: friendlyFleetNames }) : t('sortie.friendlyFleetNone'))}"
            title="${esc(friendlyFleet ? t('sortie.friendlyFleetTitle', { ships: friendlyFleetNames }) : t('sortie.friendlyFleetNone'))}">
            <img src="${tacticalIcon('friendly-anchor.png')}" alt="" aria-hidden="true" />
            ${friendlyFleetHover}
          </span>`;
        const nightHtml = `<div class="s-night-effects" aria-label="夜戰裝備與夜戰目標">
            <div class="s-night-equipment-list">
              ${nightEffectHtml('searchlight', 74, '探', '探照燈', nightObserved ? night?.searchlight : undefined)}
              ${nightEffectHtml('night-contact', nightReconMst, '夜偵', '夜偵', nightObserved ? night?.nightRecon : undefined)}
              ${nightEffectHtml('star-shell', 101, '照', '照明彈', nightObserved ? night?.starShell : undefined)}
              ${friendlyFleetHtml}
            </div>${nightEntryHtml}
          </div>`;
        const support = info.support;
        const supportKind = support?.kind === 'air' ? 'air' : support?.kind === 'asw' ? 'asw' : support?.kind === 'torpedo' ? 'torpedo' : support ? 'shell' : 'none';
        const supportTitle = !support ? t('sortie.supportFleetTitle') : [
            t('sortie.supportDamage', {
                kind: t(support.kind === 'air' ? 'sortie.supportKindAir' : support.kind === 'asw' ? 'sortie.supportKindAsw' : support.kind === 'torpedo' ? 'sortie.supportKindTorpedo' : 'sortie.supportKindShelling'),
                deck: support.deckId || '?', damage: support.damage,
            }),
            support.shipIds.length ? t('sortie.supportShips', {
                ships: support.shipIds.map(id => state.shipName(state.ships.get(id)?.api_ship_id) || `#${id}`).join('／'),
            }) : '',
        ].filter(Boolean).join('\n');
        const lbas = info.lbas;
        const lbasTitle = !lbas ? '基地航空隊未出擊' : t('sortie.lbasTitle', { sent: lbas.sent, lost: lbas.lost, damage: lbas.damage });
        const lbasHover = lbas
            ? `<span>對敵傷害 <b>${esc(String(lbas.damage))}</b></span>${lbas.lost > 0 ? `<span>我方戰損 <i>-${esc(String(lbas.lost))}</i></span>` : ''}`
            : '';
        const contactFriendMst = info.touchPlane[0] > 0 ? info.touchPlane[0] : 0;
        const contactFriendName = contactFriendMst ? state.gearName(contactFriendMst) : '我方觸接飛機';
        const contactFriendIcon = contactFriendMst ? gearIconHtml(state.gearIconId(contactFriendMst), '偵') : '<span class="s-contact-fallback">我</span>';
        const contactFriendHover = `我方：${contactFriendName}`;
        const contactEnemyHover = '敵方：深海艦載機';
        const hasFriendlyContact = info.touchPlane[0] > 0;
        const hasEnemyContact = info.touchPlane[1] > 0;
        const contactState = hasFriendlyContact || hasEnemyContact ? 'on' : 'off';
        const contactGlyph = hasFriendlyContact && hasEnemyContact
            ? `<span class="s-system-glyph contact-both" role="group" aria-label="敵我雙方觸接"><span class="contact-sub friendly" title="${esc(contactFriendHover)}">${contactFriendIcon}</span><span class="contact-sub enemy" title="${esc(contactEnemyHover)}"><img class="deepsea-aircraft-raster" src="${tacticalIcon('deepsea-carrier-aircraft.png')}" alt="深海艦載機" /></span><span class="s-contact-hover both"><span>${esc(contactFriendHover)}</span><span>${esc(contactEnemyHover)}</span></span></span>`
            : hasFriendlyContact
                ? `<span class="s-system-glyph contact-single friendly" role="img" aria-label="${esc(contactFriendHover)}" title="${esc(contactFriendHover)}">${contactFriendIcon}<span class="s-contact-hover">${esc(contactFriendHover)}</span></span>`
                : hasEnemyContact
                    ? `<span class="s-system-glyph contact-single enemy" role="img" aria-label="${esc(contactEnemyHover)}" title="${esc(contactEnemyHover)}"><img class="deepsea-aircraft-raster" src="${tacticalIcon('deepsea-carrier-aircraft.png')}" alt="深海艦載機" /><span class="s-contact-hover">${esc(contactEnemyHover)}</span></span>`
                    : '<span class="s-system-glyph contact-none" aria-hidden="true">—</span>';
        const systemSignal = (kind: string, glyph: string, label: string, value: string, stateName: 'on' | 'off' | 'warn', title: string, hover = '') => {
            // AACI 明細只保留自訂白色 tooltip；外層原生 title 會再開一個黑色提示，
            // 內容重複且長裝備名會被瀏覽器重新排成單行。
            const titleAttr = kind === 'aaci' || !title ? '' : ` title="${esc(title)}"`;
            return `<div class="s-system-signal ${kind} ${stateName}"${titleAttr}>${glyph}${kind === 'contact' ? '' : `<span class="s-system-copy"><span class="s-system-label">${esc(label)}</span>${value ? `<b class="s-system-val">${esc(value)}</b>` : ''}</span>`}${hover ? `<span class="s-system-hover">${hover}</span>` : ''}</div>`;
        };
        const searchState = info.search === 'success' ? 'on' : info.search === 'failed' ? 'warn' : 'off';
        const searchValue = info.search === 'success' ? t('sortie.searchSuccess')
            : info.search === 'failed' ? t('sortie.searchFailed') : '';
        const searchTitle = info.search === 'success' ? t('sortie.searchSuccessTitle')
            : info.search === 'failed' ? t('sortie.searchFailedTitle') : t('sortie.detection');
        const supportRailLabel = support
            ? t(support.kind === 'air' ? 'sortie.supportRailAir' : support.kind === 'asw' ? 'sortie.supportRailAsw' : support.kind === 'torpedo' ? 'sortie.supportRailTorpedo' : 'sortie.supportRailShelling')
            : t('sortie.supportRailNone');
        const aaciValue = info.aaci > 0 ? `Typ ${info.aaci}` : '';
        const aaciDetails = info.aaciDetails ?? [];
        const aaciShipLabel = (detail: typeof aaciDetails[number]): string => {
            const ship = detail.shipId ? state.ships.get(detail.shipId) : undefined;
            const localized = ship?.api_ship_id ? state.shipName(ship.api_ship_id) : detail.shipMst ? state.shipName(detail.shipMst) : '';
            if (localized) return localized;
            if (detail.position > 0) {
                return t(detail.fleet === 'escort' ? 'sortie.aaciEscortPosition' : 'sortie.aaciMainPosition', { n: detail.position });
            }
            return t('sortie.aaciUnknownShip');
        };
        const aaciGearLabel = (detail: typeof aaciDetails[number]): string => {
            if (!detail.gearMst.length) return t('sortie.aaciUnknownEquipment');
            return detail.gearMst.map(mst => state.gearName(mst) || t('sortie.aaciGearUnknown', { n: mst })).join(' ＋ ');
        };
        const aaciGearHoverHtml = (detail: typeof aaciDetails[number]): string => {
            if (!detail.gearMst.length) return `<span class="s-aaci-equipment-label">${esc(t('sortie.aaciUnknownEquipment'))}</span>`;
            return [
                `<span class="s-aaci-equipment-label">${esc(t('sortie.aaciEquipment'))}</span>`,
                ...detail.gearMst.map(mst => `<span class="s-aaci-gear">・${esc(state.gearName(mst) || t('sortie.aaciGearUnknown', { n: mst }))}</span>`),
            ].join('');
        };
        const aaciHoverHtml = info.aaci > 0 && aaciDetails.length
            ? aaciDetails.map(detail => `<span class="s-aaci-header"><b>${esc(aaciShipLabel(detail))}</b>・Typ ${detail.type}</span>${aaciGearHoverHtml(detail)}`).join('')
            : '';
        const aaciHoverTitle = info.aaci > 0
            ? [
                `${t('sortie.aaciTitlePrefix')}: ${aaciValue}`,
                ...aaciDetails.flatMap(detail => [
                    `${aaciShipLabel(detail)}・Typ ${detail.type}`,
                    `${t('sortie.aaciEquipment')}${aaciGearLabel(detail)}`,
                ]),
            ].join('\n')
            : t('sortie.none');
        const systemRailHtml = `<div class="s-system-rail" aria-label="支援、陸航、索敵、觸接與對空 CI 狀態">
            ${systemSignal('support', supportAircraftHtml(supportKind), supportRailLabel, '', support ? 'on' : 'off', supportTitle)}
            ${systemSignal('lbas', lbasAircraftHtml(), lbas ? t('sortie.lbasArrived') : '陸航', '', lbas ? 'on' : 'off', lbasTitle, lbasHover)}
            ${systemSignal('search', searchRadarHtml(), '', searchValue, searchState, searchTitle)}
            ${systemSignal('contact', contactGlyph, '觸接', '', contactState, hasFriendlyContact && hasEnemyContact ? '敵我雙方觸接' : hasFriendlyContact ? contactFriendHover : hasEnemyContact ? contactEnemyHover : '未觸接')}
            ${systemSignal('aaci', aaciGunHtml(), info.aaci > 0 ? '' : '對空 CI', aaciValue, info.aaci > 0 ? 'on' : 'off', aaciHoverTitle, aaciHoverHtml)}
          </div>`;
        html += `
                <div class="s-priority-row">
                    <div class="s-priority-item ${seikuBad ? 'bad' : 'good'}"><span>${t('sortie.airBattle')}</span><b>${esc(seikuStr)}</b></div>
                    <div class="s-priority-item ${info.formation[2] === 4 ? 'bad' : 'warn'}"><span>${t('sortie.heading')}</span><b>${esc(eng)}</b></div>
                </div>
                <div class="s-rank-row">${rankHtml}${formationHtml}</div>
                <div class="s-air-wrap${taihaHtml && !taihaDetailsHidden ? ' covered' : ''}">
                    <div class="s-air-loss-grid" aria-label="敵我戰鬥機與爆擊機數量及戰損">
                        <div class="s-air-loss-head"><b>${t('sortie.ourSide')}</b><span aria-hidden="true"></span><b>${t('sortie.enemySide')}</b></div>
                        <div class="s-air-loss-row"><span class="s-air-loss-cell friendly">${planeCell(p.playerFighter)}</span><span class="s-air-kind fighter" title="${esc(t('sortie.fighterAbbr'))}">${t('sortie.fighterAbbr')}</span><span class="s-air-loss-cell enemy">${planeCell(p.enemyFighter)}</span></div>
                        <div class="s-air-loss-row"><span class="s-air-loss-cell friendly">${planeCell(p.playerBomber)}</span><span class="s-air-kind bomber" title="${esc(t('sortie.bomberAbbr'))}">${t('sortie.bomberAbbr')}</span><span class="s-air-loss-cell enemy">${planeCell(p.enemyBomber)}</span></div>
                    </div>${taihaHtml}
                </div>
                ${nightHtml}
            </div>
        </div>`;
        // 底部定版：左欄固定五項系統訊號，右欄固定掉落格；掉落內容只在結算後出現。
        const dropChip = info.hasResult && info.drop
            ? `<div class="s-drop-chip sakura-drop ${info.dropIsNew ? 'new' : 'owned'}" role="group" aria-label="${esc(info.drop)}" title="${esc(`${t('sortie.dropTitle')}：${info.drop}`)}">
                <span class="sakura-drop-icon">${sakuraAnchorHtml(info.dropIsNew)}</span>
                <span class="sakura-drop-name">${esc(info.drop)}</span>
              </div>`
            : '';
        html += `<div class="s-action-rail with-system">
            ${systemRailHtml}
            <div class="s-drop-slot ${dropChip ? 'filled' : 'empty'}">
              ${dropChip || '<span class="s-drop-empty">No Drop</span>'}
            </div>
          </div>`;
    }
    html += '</div>';
    sortieEl.innerHTML = html;
}
// 待驗證封包（自動擷取）：顯示清單＋一鍵複製完整 JSON，取代手動翻 Network 面板。
// 見 utils/state.ts 的 wantedTag() 與 CLAUDE.md「怎麼撈封包驗證」。
//
// **擷取有上限**：db.wanted 引用的 raw event 會被 M6 裁剪永久保護（見
// utils/event-pruning.ts 的 protectedEventIds），一筆待驗證紀錄＝一整包原始封包永遠留在
// IndexedDB。無上限的分支（自軍聯合艦隊、支援艦隊、友軍艦隊…）每次出擊都會命中，
// 長期下來就是無界成長，而且被保護的事件連帶拖住裁剪。
// 取捨：**不動「wanted 保護 raw event」的語意**（那是「複製 JSON」拿得到原始內容的唯一
// 保證），改為限制新增＋提供刪除。上限只是「同一種現象留幾份樣本」——驗證封包格式 3 份
// 就夠了，刪掉舊的即可再擷取新的，而且達上限時清單會明說，不靜靜略過。
const WANTED_TAG_LIMIT = 5;
const WANTED_TOTAL_LIMIT = 50;
/** 上次擷取是否因為達上限而略過（達上限要說出來，不能靜靜不擷取）。 */
let wantedSkipped = false;
/**
 * 開發用：把資料存成 JSON 檔案觸發瀏覽器下載（落地到使用者的預設下載資料夾，一般是
 * `~/Downloads/`）。用 Blob＋`<a download>` 即可，不需要 `downloads` 權限
 * （見 CLAUDE.md 設計原則 5 權限精簡）；只在 `isDebugUiEnabled()` 的呼叫路徑上使用。
 */
function downloadJson(filename: string, data: unknown) {
    try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        console.warn('[KC-Monitor] 自動存檔失敗', filename, e);
    }
}
/** 檔名不可用字元（含路徑分隔符）一律換成底線，中日文與其餘符號原樣保留。 */
const sanitizeFilename = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_');
async function captureWanted(eventId: number, tag: string, ts: number, path: string) {
    try {
        const [total, sameTag] = await Promise.all([
            db.wanted.count(),
            db.wanted.where('tag').equals(tag).count(),
        ]);
        if (total >= WANTED_TOTAL_LIMIT || sameTag >= WANTED_TAG_LIMIT) {
            wantedSkipped = true;
            console.warn('[KC-Monitor] 待驗證封包已達上限，未擷取', tag, path);
        } else {
            await db.wanted.add({ eventId, tag, ts, path });
            // 落地即自動存檔，不必再靠清單裡的「複製 JSON」手動取用——這是唯一取得完整
            // req/api 的即時管道；db.wanted 列表仍保留供之後管理／補救重存。
            const row = await db.events.get(eventId).catch(() => undefined);
            if (row) {
                downloadJson(`kc-wanted_${sanitizeFilename(tag)}_${sanitizeFilename(path)}_${ts}.json`,
                    { tag, path, ts, req: row.req ?? {}, api: row.api });
            }
        }
    } catch (e) {
        // 擷取樣本失敗不能連累事件消費（那會讓 pump 停掉）：只記錄，不往外拋。
        console.warn('[KC-Monitor] 待驗證封包擷取失敗', e);
    }
    await renderWanted().catch(() => { });
}
async function renderWanted() {
    const [rows, total] = await Promise.all([
        db.wanted.orderBy('id').reverse().limit(30).toArray(),
        db.wanted.count(),
    ]);
    const list = rows.map(r => `
      <div class="wanted-row">
        <span class="wanted-tag">${esc(r.tag)}</span>
        <span class="grow wanted-path">${esc(r.path)}　${new Date(r.ts).toLocaleTimeString()}</span>
        <button data-copy="${r.eventId}">${t('wanted.copyJson')}</button>
        <button class="wanted-del" data-del="${r.id}" title="${esc(t('wanted.deleteTitle'))}">${t('wanted.delete')}</button>
      </div>`).join('');
    // 上限與清理入口一律顯示：使用者要能看出「為什麼沒再擷取」與「怎麼讓它再擷取」。
    const foot = rows.length ? `
      <div class="wanted-foot">
        <span class="grow">${esc(t('wanted.count', { n: total, max: WANTED_TOTAL_LIMIT, perTag: WANTED_TAG_LIMIT }))}</span>
        <button data-clear="1">${t('wanted.clearAll')}</button>
      </div>` : '';
    const skipped = wantedSkipped ? `<div class="wanted-foot warn">${esc(t('wanted.limitHit'))}</div>` : '';
    wantedEl.innerHTML = (list || `<div class="empty">${t('wanted.empty')}</div>`) + skipped + foot;
}
/** 按鈕短暫顯示結果文字後復原（複製成功／原始事件已不在／複製失敗共用）。 */
function flashButton(btn: HTMLButtonElement, text: string, ok: boolean) {
    const original = btn.textContent ?? '';
    btn.textContent = text;
    btn.classList.toggle('copied', ok);
    btn.classList.toggle('failed', !ok);
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied', 'failed'); }, ok ? 1500 : 3000);
}
wantedEl.addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    const del = target.closest('button[data-del]') as HTMLButtonElement | null;
    if (del) {
        // 刪除待驗證紀錄＝解除它對那筆 raw event 的保護，之後的裁剪就能把封包收走（本意如此）。
        await db.wanted.delete(Number(del.dataset.del)).catch(err =>
            console.warn('[KC-Monitor] 待驗證封包刪除失敗', err));
        wantedSkipped = false;
        await renderWanted().catch(() => { });
        return;
    }
    if (target.closest('button[data-clear]')) {
        if (!confirm(t('wanted.clearConfirm'))) return;
        await db.wanted.clear().catch(err => console.warn('[KC-Monitor] 待驗證封包清除失敗', err));
        wantedSkipped = false;
        await renderWanted().catch(() => { });
        return;
    }
    const btn = target.closest('button[data-copy]') as HTMLButtonElement | null;
    if (!btn) return;
    const row = await db.events.get(Number(btn.dataset.copy)).catch(() => undefined);
    // 原始事件不在了（極端情況：紀錄剛好在保護生效前被裁剪，或使用者匯入過備份）。
    // 靜靜沒反應會讓人以為是按鈕壞了，這裡直接在按鈕上講明。
    if (!row) { flashButton(btn, t('wanted.gone'), false); return; }
    // 連 req 一起複製：部分端點（如 api_req_kousyou/remodel_slot）的請求欄位名
    // （api_slot_id/api_certain_flag 等）仍未驗證，只複製 api 回應會漏掉這些。
    // req 為空物件（GET 型或無表單資料）時仍照複製，維持格式一致。
    try {
        await navigator.clipboard.writeText(JSON.stringify({ req: row.req ?? {}, api: row.api }, null, 2));
    } catch (err) {
        console.warn('[KC-Monitor] 待驗證封包複製失敗', err);
        flashButton(btn, t('wanted.copyFailed'), false);
        return;
    }
    flashButton(btn, t('wanted.copied'), true);
});
// ── 工廠分頁 ──────────────────────────────
// 最新開發/改修結果看板（state 內存，跨 session 由事件重播還原）＋歸檔紀錄
// （db.factory，同 sorties 設計：獨立於事件裁剪、永久保留）。名稱一律渲染時經
// state 解析（master id → 當前語言譯名），語言切換即時生效、舊紀錄也跟著換。
const MAT_KEYS = ['mat.fuel', 'mat.ammo', 'mat.steel', 'mat.bauxite', 'mat.torch', 'mat.drum', 'mat.devmat', 'mat.screw'];
// 資材消耗列：只列有消耗的項目（圖示＋數字），順序固定燃彈鋼鋁→消耗材
const usedHtml = (used: number[] | undefined) =>
    (used ?? []).map((v, i) => v > 0 && MAT_KEYS[i]
        ? `<span class="f-res" title="${esc(t(MAT_KEYS[i] + '.full'))}">${matIconHtml(MAT_KEYS[i])}<b>${v}</b></span>` : '')
        .join('');
// 開發結果/改修對象 chip：mst=-1（開發失敗）用文字標示；圖示經 gearIconId 反查
// （開發失敗沒有裝備實例，不能走 gearOf）
const facGearHtml = (mst: number | undefined) => {
    if (!mst || mst <= 0) return `<span class="f-fail">${t('factory.devFail')}</span>`;
    const name = state.gearName(mst);
    return `${gearIconHtml(state.gearIconId(mst), '')}<span title="${esc(name)}">${esc(name)}</span>`;
};
// 看板（同步、無 DB 存取）：秒針 interval 會定時重畫（建造渠倒數用），與紀錄查詢分離
function renderFactoryLive() {
    if (tab !== 'factory') return;
    let live = '';
    const dev = state.lastDevelop;
    if (dev) {
        live += `<div class="fac-card"><h4>${t('factory.latestDevelop')}<span class="grow"></span>${usedHtml(dev.used)}</h4>` +
            dev.results.map(r => `<div class="fac-result-row">${facGearHtml(r.mst)}</div>`).join('') +
            '</div>';
    }
    const imp = state.lastImprove;
    if (imp) {
        const okStr = imp.success
            ? `<span class="f-ok">${t('factory.improveOk')}</span>`
            : `<span class="f-ng">${t('factory.improveNg')}</span>`;
        live += `<div class="fac-card"><h4>${t('factory.latestImprove')}<span class="grow"></span>${usedHtml(imp.used)}</h4>
            <div class="fac-result-row">${facGearHtml(imp.gearMst)}
                <span class="f-lv">★${imp.levelBefore}→★${imp.levelAfter}</span>
                ${imp.certain ? `<span class="badge">${t('factory.certain')}</span>` : ''}${okStr}</div></div>`;
    }
    // 建造中的渠（與一般分頁同資料）：工廠分頁自成一格，不用切回一般分頁看倒數
    const kd = state.kdocks();
    if (kd.length) {
        live += `<div class="fac-card"><h4>${t('factory.buildingDocks')}</h4>` + kd.map(k => `
          <div class="fac-result-row">
            <span class="grow" title="${esc(k.ship)}">${esc(k.ship)}</span>
            <span class="badge">${k.state === 3 ? t('kdock.complete') : fmt(k.completeAt)}</span>
          </div>`).join('') + '</div>';
    }
    facLiveEl.innerHTML = live || `<div class="empty">${t('factory.noLive')}</div>`;
}
// 歷史紀錄清單（開發/建造/改修）已移至「鎮守府情報總括」分頁（讀 db.factory）；
// 面板只留這份「當下」看板（renderFactoryLive：最新開發/改修結果＋建造中渠倒數）。
function renderFactory() { renderFactoryLive(); }
// 啟動重播期間（ready=false）不逐筆碰 DOM：先在記憶體累積最後 200 筆供重播結束後
// 一次性補上「動態」分頁的 log，避免數千筆歷史事件each觸發一次 log DOM 操作。
const replayLogBuffer: { ts: number; path: string }[] = [];
function appendLogRow(ts: number, path: string) {
    const row = document.createElement('div');
    row.textContent = `${new Date(ts).toLocaleTimeString()}  ${path}`;
    log.prepend(row);
    while (log.children.length > 200) log.lastChild?.remove();
}
// 出擊中的戰鬥相關 path（與 utils/state.ts 戰鬥分支同一組判準，含單艦隊的航空戰／
// 空襲節點 `api_req_sortie/(ld_)airbattle`——只寫 `startsWith('api_req_sortie/battle')`
// 會漏掉它們）。這一組進「出擊」分頁，含同節點的結算與退避。
const isSortieBattlePath = (path: string) =>
    path.startsWith('api_req_sortie/battle')
    || path.includes('airbattle')
    || path.startsWith('api_req_combined_battle/')
    || path.startsWith('api_req_battle_midnight/')
    || path.endsWith('/night_to_day');
const isNewBattlePacket = (path: string) =>
    isSortieBattlePath(path) && !path.endsWith('result') && !path.endsWith('/goback_port');
async function consume(id: number, ts: number, path: string, api: any, req?: Record<string, string>): Promise<void> {
    if (id <= maxId) return;
    if (path === 'api_req_map/start' || path === 'api_req_map/next' || isNewBattlePacket(path))
        taihaDetailsHidden = false;
    // [debug] 效能量測：live 事件才量（重播期間量測沒意義，且會洗版）。
    // 超過 15ms 才印，用來排查「切換到某介面很慢」是卡在 state 處理還是 renderAll()。
    const t0 = ready ? performance.now() : 0;
    let t1 = 0;
    projectionThroughEventId = await projectEventAndAdvance(
        projector,
        { id, ts, path, api, req },
        projectionThroughEventId,
        eventId => advanceProjectionCursor(db, eventId),
        () => { t1 = ready ? performance.now() : 0; },
    );
    // meta write 失敗時不會執行到這裡，記憶體去重位置與耐久游標都保留在失敗事件之前。
    maxId = id;
    // 重播歷史事件（ready=false）時完全不碰 DOM：renderAll() 是整頁 innerHTML 重建，
    // 事件數量可能達數千筆（events 只在 start2 時裁剪到約兩個登入世代），逐筆重render
    // 會讓面板開啟瞬間卡死主執行緒，使用者切換遊戲畫面時感覺「非常慢」。
    // 情境自動切換／待驗證封包擷取／log 列表同理，只在 live 事件時才需要即時反映。
    if (ready) {
        appendLogRow(ts, path);
        // 斬殺線補撈：**mapinfo 一到就跑**（＝點開出擊海域選單的那一刻，此時量表值剛更新），
        // 不必等到真的出擊。map/start 也跑一次，涵蓋沒經過選單直接再戰的情況；一張圖只掃
        // 一次 DB，重複呼叫是免費的（見 restoreGaugeBossHp）。非同步，補到新值才重畫。
        if (path === 'api_get_member/mapinfo' || path === 'api_req_map/start') {
            void restoreGaugeBossHp().then(changed => { if (changed) renderSortie(); });
        }
        if (path === 'api_port/port') autoSwitch('general', 'port');
        else if (path === 'api_req_map/start') { autoSwitch('sortie', 'sortie'); switchFleetViewToSortie(); }
        else if (isSortieBattlePath(path)) autoSwitch('sortie', 'sortie');
        // 進入遠征介面（api_get_member/mission）或發出遠征（mission/start）→ 遠征分頁
        else if (path === 'api_get_member/mission' || path === 'api_req_mission/start') autoSwitch('exped', 'exped');
        // 任務圖示為遊戲全域頭部列常駐圖示，任何畫面下點選都會送這個封包 → 切到一般
        // 分頁（任務清單顯示於此，見 index.html #quests）。
        else if (path === 'api_get_member/questlist') autoSwitch('general', 'quest');
        // 進入工廠（preset_dev_items）/改修工廠（remodel_slotlist）或工廠操作
        // （開發/建造/領艦/改修）→ 工廠分頁（僅顯示當下看板，歷史清單見情報總括）
        else if (path === 'api_get_member/preset_dev_items'
            || path === 'api_req_kousyou/remodel_slotlist'
            || path === 'api_req_kousyou/createitem'
            || path === 'api_req_kousyou/createship'
            || path === 'api_req_kousyou/getship'
            || path === 'api_req_kousyou/remodel_slot') autoSwitch('factory', 'factory');
        // wanted 擷取只在開發用 UI 開啟時進行——正式建置沒有清除／複製介面，
        // 繼續寫入會永久釘住 raw events 卻無法由使用者管理（見 utils/debug-ui.ts）。
        if (isDebugUiEnabled()) {
            const tag = state.wantedTag(path, api, req);
            if (tag) void captureWanted(id, tag, ts, path);
        }
        const t2 = performance.now();
        renderAll();
        const t3 = performance.now();
        if (t3 - t0 > 15) {
            console.log(`[KC-Monitor][perf] ${path} state ${(t1 - t0).toFixed(1)}ms, renderAll ${(t3 - t2).toFixed(1)}ms`);
        }
    } else {
        replayLogBuffer.push({ ts, path });
        if (replayLogBuffer.length > 200) replayLogBuffer.shift();
    }
}
// 泊地修理／給糧倒數：只改 .rcd 的文字，不重繪艦隊區塊（理由見 repairPlansOf 的
// countdown 註解）。錨點與週期存在 data-* 上，故這裡不需要重算 GameState。
function tickRepairCountdowns() {
    for (const el of document.querySelectorAll<HTMLElement>('.rcd[data-anchor]')) {
        const anchor = Number(el.dataset.anchor);
        const interval = Number(el.dataset.interval);
        if (!Number.isFinite(anchor) || !Number.isFinite(interval)) continue;
        const ms = nextSettlementIn(anchor, interval);
        if (ms === undefined) continue;
        const text = countdownText(ms);
        if (el.textContent !== text) el.textContent = text;
    }
}
// 基地航空隊疲勞：回復是時間到就發生、**遊戲不會送封包**，故沒有任何事件會觸發重繪。
// 這裡每秒算一次「目前該顯示哪些標記」的簽章，變了才重畫——不是每秒無條件重繪
// （那會白白重建整個分區的 DOM）。標記消失時編成列的按鈕顏色也要跟著退掉。
function lbasCondSignature(): string {
    return state.airBases_().map(ab =>
        ab.squadrons.map(sq => sq.state !== 1 ? '-'
            : `${state.lbasCondStateNow(sq.cond, ab)[0]}${state.lbasCondCertaintyNow(sq.cond, ab)?.[0] ?? ''}`).join('')
    ).join('|');
}
let lastLbasCondSig = '';
function tickLbasCond() {
    const sig = lbasCondSignature();
    if (sig === lastLbasCondSig) return;
    lastLbasCondSig = sig;
    renderFleetNav();
    if (showLbas) renderAirBases();
}
setInterval(() => {
    if (tab === 'general') renderGeneral();
    if (tab === 'factory') renderFactoryLive();   // 建造渠倒數
    tickRepairCountdowns();                       // 泊地修理/給糧倒數（艦隊區塊常駐顯示）
    tickLbasCond();                               // 基地航空隊疲勞回復（無封包可觸發）
}, 1000);
// 事件消費採「單一有序佇列」：所有 live 事件 id 進 pending，由 pump() 逐一 await
// db.get 後 consume。這樣「啟動重播」與「即時訊息」不會交錯——否則即時訊息的
// db.get 可能在重播 drain 的 await 空檔先 resolve，搶先推高 maxId，害較早的事件
// 被 consume 的 `id<=maxId` 去重誤丟。pump 未 ready 時直接返回，live id 先積著等重播完。
let pumping = false;
let projectionFailed = false;
// 讀取失敗的重試節奏。IndexedDB 暫時讀不到（交易衝突、儲存空間忙碌）跟「投影失敗」
// 是兩回事：前者重試就會過，後者代表衍生資料已經不一致，不能在同一份 GameState 上繼續。
const READ_RETRY_DELAY_MS = 2000;
let readRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReadRetry() {
    if (readRetryTimer !== null) return;
    readRetryTimer = setTimeout(() => { readRetryTimer = null; void pump(); }, READ_RETRY_DELAY_MS);
}
function stopAfterProjectionFailure(error: unknown) {
    projectionFailed = true;
    // 不在同一份已部分變更的 GameState 上繼續；raw event 仍在 db.events，重開 panel 可重建。
    console.error('[KC-Monitor] derived event projection failed; panel pump stopped', error);
    setNotice('fatal', t('panel.stopped', { reason: describeError(error) }), t('panel.stoppedHint'));
}
async function pump() {
    if (pumping || !ready || projectionFailed) return;
    pumping = true;
    try {
        while (pending.length) {
            const id = pending[0];
            if (id <= maxId) {
                pending.shift();
                continue;
            }
            let r: ApiEventRow | undefined;
            try {
                r = await db.events.get(id);
            } catch (error) {
                // 暫時性讀取失敗：事件留在佇列裡等下一輪，**不可** latch 成永久停止——
                // 那會讓面板從此不再更新，而原因只是一次讀取抖動。
                console.warn('[KC-Monitor] 讀取事件失敗，稍後重試', id, error);
                setNotice('backlog', t('panel.queueBacklog', { n: pending.length }));
                scheduleReadRetry();
                return;
            }
            if (!r) {
                pending.shift();
                continue;
            }
            try {
                await consume(r.id!, r.ts, r.path, r.api, r.req);
            } catch (error) {
                stopAfterProjectionFailure(error);
                return;
            }
            pending.shift();
        }
        // 佇列清空＝讀取已恢復，把積壓提示收掉。
        if (noticeKind === 'backlog') setNotice('none');
    } finally { pumping = false; }
}
browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'kc:live') return;
    // id 必須是合法事件 ID 才入佇列：一筆壞訊息就足以讓 db.events.get() 一直丟錯。
    if (!Number.isSafeInteger(msg.id) || msg.id <= 0) return;
    // 已停止消費後不再累積：事件本身在 db.events 裡不會遺失，重新載入面板就會重建，
    // 繼續往 pending 塞只會讓記憶體無止境成長，而且一筆都不會被處理。
    if (projectionFailed) return;
    if (!pending.includes(msg.id)) {
        pending.push(msg.id);
        pending.sort((left, right) => left - right);
    }
    void pump();
});
// 面板視窗單例化：使用者點擴充圖示時 background 會 ping，回報自己的 windowId 供聚焦
// （見 background.ts action.onClicked）。return true = 稍後非同步呼叫 sendResponse。
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'kc:panel-ping') return;
    browser.windows.getCurrent().then(w => sendResponse(w.id));
    return true;
});
// 先畫殼、再讀 DB（同 overview/main.ts renderSection 的慣例）：分頁列與狀態橫幅必須在
// 任何 await 之前就出現。否則 Dexie 版本升級被其他分頁擋住、或重播中途丟例外時，整個
// 面板會是一片空白，連「為什麼」都看不到。
renderTabs();
setNotice('loading', t('panel.loading'));

// 原始 events 會定期裁剪，但 replays（戰鬥封包）與 sorties（Boss 節點事實）另有持久
// 保留規則。面板重開後由兩者恢復 Boss HP，否則 mapBossHp 只存在記憶體，載入正式版
// 擴充後就會失去斬殺線。只查目前出擊海域，避免把整座重播資料庫搬進記憶體。
//
// **時機是「出擊開始」不是「面板啟動」**：sortieInfo 在 api_port/port 會被清空，面板
// 幾乎都是在母港開的，只在啟動時查等於永遠查不到，斬殺線要等這次 session 自己再打一次
// Boss 才會出現——那正是這支要修的問題。故啟動與每次 api_req_map/start 都跑一次。
// 也刻意不用「已知就略過」當快門：目前 gauge 的有效 Boss 可能換成較低 HP 的最終形態；
// 新重播以 bossCellNo 排除破甲路線上的舊 Boss，再交給 observeMapBossHp 向下更新。
// 頻率是每次出擊一次，成本可接受。
//
// **不以 sortieInfo 為前提**：斬殺線的兩個材料在母港就到齊了——量表值來自 mapinfo（點開
// 出擊海域選單即送來），Boss HP 來自本機出擊紀錄。把補撈綁在「正在出擊中」會逼使用者
// 花一次出擊的資源才看得到結果，而那次出擊本身正是要靠這條線去決定要不要打的。
//
// 一張圖／難度／血條只掃一次 DB（bossHpScanned）。**不可改用「mapBossHp 已有值就跳過」當快門**：
// 本次 session live 觀測到的可能是不同形態，掃描結果先以目標 Boss 身分分級，再交給
// observeMapBossHp 依目前血條同一目標 Boss 的 baseHp 觀測值向下更新。
const bossHpScanned = new Set<string>();

async function restoreMapBossHp(mapArea: number, mapNo: number, diff: number, gaugeNum?: number): Promise<boolean> {
    const mapId = mapArea * 10 + mapNo;
    const before = state.mapBossHp.get(mapId);
    const map = `${mapArea}-${mapNo}`;
    // sorties 是每筆 <1KB 的摘要，整表過濾成本可忽略；replays 才是帶原始封包的大列。
    const bossRows = await db.sorties
        .filter(row => row.map === map && !!row.boss && !row.imported)
        .toArray();
    let scanned = 0;
    let bestSpecificity = -1;
    let exactBaseHp: number | null = null;
    let legacyBaseHp: number | null = null;
    if (bossRows.length > 0) {
        // 逐列串流而不是 toArray()：一張活動海域的重播可能有數十場、每場數則原始戰鬥封包，
        // 整批載入會把幾十 MB 搬進面板記憶體。每次只留一列，交給同一支純函式算。
        await db.replays.where('world').equals(mapArea).each(row => {
            if (row.mapnum !== mapNo || row.imported) return;
            scanned++;
            const specificity = bossHpReplaySpecificity(row, diff, gaugeNum);
            if (specificity == null || specificity < bestSpecificity) return;
            const hp = observedBossHp([row], bossRows, mapArea, mapNo, diff, gaugeNum);
            if (hp == null) return;
            // 先完整保留身分較精確的候選；只有沒有精確證據時，才使用舊資料回退。
            // 這個優先序必須跨整個串流維持，不能在每一列單獨判斷後再混合最大／最小值。
            if (specificity > bestSpecificity) {
                bestSpecificity = specificity;
                exactBaseHp = null;
                legacyBaseHp = null;
            }
            const bossCellNo = Number(row.bossCellNo);
            if (Number.isSafeInteger(bossCellNo) && bossCellNo > 0) {
                exactBaseHp = exactBaseHp == null ? hp : Math.min(exactBaseHp, hp);
            } else {
                legacyBaseHp = legacyBaseHp == null ? hp : Math.max(legacyBaseHp, hp);
            }
        });
    }
    // 有目標 Boss 身分的新紀錄時完全忽略舊式無身分推導；沒有時才用舊版最大值相容，
    // 避免舊階段較低 HP Boss 再次污染目前血條。
    const recoveredBaseHp = exactBaseHp ?? legacyBaseHp;
    if (recoveredBaseHp != null) state.observeMapBossHp(mapArea, mapNo, recoveredBaseHp, gaugeNum);
    const after = state.mapBossHp.get(mapId);
    console.log(`[KC-Monitor] bossHp ${map}: 重播=${scanned} Boss紀錄=${bossRows.length} `
        + `記憶體=${before ?? '無'}→${after ?? '無'}`);
    return after !== before;
}

// 對所有「尚未攻略的 boss 撃破型量表」補撈斬殺線。mapinfo 一到就跑（點開出擊海域選單
// 那一刻），面板啟動時也跑一次。回傳是否有任一張圖的斬殺線改變，供呼叫端決定要不要重畫。
async function restoreGaugeBossHp(): Promise<boolean> {
    let changed = false;
    for (const { mapId, mapArea, mapNo, gauge } of state.unclearedHpGaugeMaps()) {
        // 同一活動圖切換血條後，當前 mapinfo 只保留一個 gauge；從既有 replay
        // 的 gaugeNum 收集其他已觀測血條，才能像 KC3Kai 一樣切回時恢復各自 baseHp。
        const gaugeNums = new Set<number | undefined>([gauge.gaugeNum]);
        if (gauge.gaugeNum !== undefined) {
            await db.replays.where('world').equals(mapArea).each(row => {
                const n = row.gaugeNum;
                if (row.mapnum === mapNo && !row.imported
                    && (row.diff === gauge.selectedRank || row.diff === 0)
                    && typeof n === 'number' && Number.isSafeInteger(n) && n > 0) gaugeNums.add(n);
            });
        }
        for (const gaugeNum of gaugeNums) {
            const key = `${mapId}:${gauge.selectedRank}:${gaugeNum ?? '?'}`;
            if (bossHpScanned.has(key)) continue;
            bossHpScanned.add(key);
            try {
                if (await restoreMapBossHp(mapArea, mapNo, gauge.selectedRank, gaugeNum)) changed = true;
            } catch (e) {
                bossHpScanned.delete(key);   // 失敗不算掃過，下次 mapinfo 再試
                console.warn('[KC-Monitor] Boss HP 恢復失敗', key, e);
            }
        }
    }
    return changed;
}

(async () => {
    try {
        const [snapshots, events, storedProjectionCursor] = await Promise.all([
            db.snapshot.toArray(),
            db.events.orderBy('id').toArray(),
            readProjectionCursor(db),
        ]);
        const plan = planStateRecovery(snapshots, events);
        projectionThroughEventId = storedProjectionCursor;
        // baseline 只更新 GameState；不可交給 projector，避免建立 derived rows 或啟動 UI 副作用。
        applySnapshotBaseline(state, plan.baselineSnapshots);
        for (const row of plan.rawEvents) {
            await consume(row.id!, row.ts, row.path, row.api, row.req);
        }
        // 重播完 events 後，mapGauges 已是最新一次 mapinfo 的內容，這裡把各未攻略海域的
        // 斬殺線一次補齊——面板一開（不論在母港或出擊中）就該看得到，不必等下一則封包。
        await restoreGaugeBossHp();
        ready = true;
        setNotice('none');
        // 重播期間累積的 log 一次性補上（陣列已依時間順序，逐筆 prepend 使最新的在最上面）
        replayLogBuffer.forEach(({ ts, path }) => appendLogRow(ts, path));
        renderAll();      // 重播完成後才做第一次整頁渲染
        if (isDebugUiEnabled()) void renderWanted();   // 開發用：載入既有 session 的待驗證封包
        void pump();           // 處理啟動期間積在 pending 的 live 事件
    } catch (error) {
        // 啟動重播失敗：pump 同樣不能在這份半成品 state 上繼續（理由見
        // stopAfterProjectionFailure），但訊息要講「啟動失敗」而不是「已停止接收」。
        projectionFailed = true;
        console.error('[KC-Monitor] panel startup failed', error);
        setNotice('fatal', t('panel.loadFailed', { reason: describeError(error) }), t('panel.stoppedHint'));
    }
})();
