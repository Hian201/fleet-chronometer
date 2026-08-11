import { db, type ApiEventRow } from '@/utils/db';
import { nodeLabel } from '@/utils/map-node-letters';
import { diffLabel, isEventWorld, mapLabel } from '@/utils/sortie-detail';
import { EventProjector, projectEventAndAdvance } from '@/utils/event-projector';
import { advanceProjectionCursor, readProjectionCursor } from '@/utils/projection-cursor';
import {
    GameState,
    type ShipView, type GearView, type FleetView, type BattleEnemyShipView,
    type BattleLbasView,
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
import { maxObservedBossHp } from '@/utils/boss-hp';
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
// 面板顯示語言＋主題：持久化／偵測／跨頁同步抽到 utils/ui-prefs.ts（panel/popup/overview
// 三頁共用；utils/ui-i18n.ts 仍只放純函式，維持 state.ts 可獨立編譯）。
// 語言/主題以「鎮守府情報總括」為控制中心，但任一頁切換都會經 storage 事件廣播到其他
// 已開頁面（#1/#2）——面板收到就套用並整頁重繪。
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
// 大破警告的展開／收縮：null＝依情境的預設（一般節點展開遮蔽、boss 節點新發生的大破
// 收成 banner），true/false＝使用者手動指定。**每收到新的戰鬥／出擊封包就回到 null**
// （見 consume）——收起來一次就整場都不再示警的話，這個警告等於白做。
let taihaOpenOverride: boolean | null = null;
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
// 計時列標籤圖示（入渠＝修理施設吊臂・建造＝造船鎚・遠征＝羅盤）。alt 帶原本的漢字短標籤，
// 圖示載入失敗時自動退回文字；title 由呼叫端的 .t-tag 帶（保留 hover 全名與無障礙）。
const tagIconHtml = (kind: 'dock' | 'build' | 'exped') =>
    `<img class="t-icon" src="/icons/ui/${kind}.svg" alt="${esc(t('tag.' + kind))}">`;
// 任務內容原文換行用字面 <br> 標籤（非 \n，已用 samples/Quest.json 真實封包驗證，見 api_no
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
    // 出擊／建造／開發／改修的「歷史紀錄清單」已移至「鎮守府情報總括」分頁（#5）；
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
    // 正式建置沒有動態分頁：若狀態卡在 activity（舊 session／誤觸），退回一般。
    tab = next === 'activity' && !isDebugUiEnabled() ? 'general' : next;
    if (manual) manualOverride = true;
    generalEl.style.display = tab === 'general' ? '' : 'none';
    document.getElementById('tab-exped')!.style.display = tab === 'exped' ? '' : 'none';
    document.getElementById('tab-sortie')!.style.display = tab === 'sortie' ? '' : 'none';
    document.getElementById('tab-factory')!.style.display = tab === 'factory' ? '' : 'none';
    // 調度分頁要 flex 填滿 #tabpanel（表內部捲動）；其他分頁用預設 block。
    orderEl.style.display = tab === 'order' ? 'flex' : 'none';
    tabpanelEl.classList.toggle('has-order', tab === 'order');
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
// 大破警告的展開／收縮切換。事件委派綁在常駐容器上——renderSortie 每次都整塊重建
// innerHTML，逐次綁在按鈕上會在下一次渲染後失效。
document.getElementById('battle-content')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('#taiha-toggle');
    if (!btn) return;
    taihaOpenOverride = btn.getAttribute('aria-expanded') !== 'true';
    renderSortie();
});
function renderGeneral() {
    // 資源看板：8 項 2 欄×4 列（CSS grid-auto-flow: column），主資源左欄、消耗材右欄。
    // label 為單字佔位（之後預計換圖示），懸浮提示帶完整名稱；數值加千分位便於掃讀。
    const m = state.materials;
    const res = (key: string, v: number | undefined, sec = false) =>
        `<span class="res-item${sec ? ' sec' : ''}" title="${esc(t(key + '.full'))}">${matIconHtml(key)} <b>${(v ?? 0).toLocaleString()}</b></span>`;
    resline.innerHTML = m.length ? [
        res('mat.fuel', m[0]), res('mat.ammo', m[1]), res('mat.steel', m[2]), res('mat.bauxite', m[3]),
        res('mat.torch', m[4], true), res('mat.drum', m[5], true), res('mat.devmat', m[6], true), res('mat.screw', m[7], true),
    ].join('') : '';
    // 遠征（資源右側，保持 row 形式）：羅盤圖示在最前標示「這是遠征」，接艦隊編號，
    // 再接遠征任務編號（不再用中括號框）；遠征名稱預設寬度不佔視覺空間、僅 hover 顯示
    // （row 上的 title＋.exped-name 本身 color:transparent，見 index.html），但仍撐開
    // .grow 把倒數推到最右——使用者手動拉寬 panel 超過 460px 時同一顆 .exped-name 改為
    // 顯示完整名稱（CSS 斷點見 index.html #quests 旁的 @media，同一組斷點）。
    // 活動限定的 S1／S2 支援遠征補「道中／王點」白話註記（見 expedDisplayName）——
    // 名稱欄在窄面板時是透明的，故 title 也要帶，否則加註等於看不到。
    missionsEl.innerHTML = state.missions().map(mm => {
        const name = expedDisplayName(mm.missionId, mm.name);
        return `
      <div class="timer-row" title="${esc(name)}">
        <span class="t-tag" title="${esc(t('tag.exped'))}">${tagIconHtml('exped')}</span>
        <span class="fleet-box">${esc(mm.fleet)}</span>
        <span class="badge">${esc(mm.dispNo)}</span>
        <span class="grow exped-name">${esc(name)}</span>
        <span class="badge">${fmt(mm.completeAt)}</span>
      </div>`;
    }).join('') || `
      <div class="timer-row">
        <span class="t-tag tt-exped" title="${esc(t('tag.exped'))}">${tagIconHtml('exped')}</span>
        <span class="grow dim-txt">${t('common.empty')}</span>
      </div>`;
    // 入渠（左）× 建造（右）並排。空狀態沿用計時列既有色標籤（渠/建），與有資料時視覺語言一致，
    // 避免入渠/建造左右對稱時「無」無法分辨是哪一區塊（見設計討論）。
    ndocksEl.innerHTML = state.ndocks().map(n => `
      <div class="timer-row">
        <span class="t-tag tt-dock" title="${esc(t('tag.dock'))}">${tagIconHtml('dock')}</span>
        <span class="grow" title="${esc(n.ship)}">${esc(n.ship)}</span>
        <span class="badge">${fmt(n.completeAt)}</span>
      </div>`).join('') || `
      <div class="timer-row">
        <span class="t-tag tt-dock" title="${esc(t('tag.dock'))}">${tagIconHtml('dock')}</span>
        <span class="grow dim-txt">${t('common.empty')}</span>
      </div>`;
    // kdock 只有實際點進工廠「建造」分頁才會送封包，單純被動擷取拿不到就是拿不到（見 CLAUDE.md
    // 設計原則1）。跟「有資料但目前沒建造中」區分開來，避免使用者誤以為是顯示 bug；
    // 短標籤放 title 收全文，避免在窄欄內爆版。
    kdocksEl.innerHTML = state.kdocks().map(k => `
      <div class="timer-row">
        <span class="t-tag tt-build" title="${esc(t('tag.build'))}">${tagIconHtml('build')}</span>
        <span class="grow" title="${esc(k.ship)}">${esc(k.ship)}</span>
        <span class="badge">${k.state === 3 ? t('kdock.complete') : fmt(k.completeAt)}</span>
      </div>`).join('') || (state.kdockData.length === 0
        ? `<div class="timer-row" title="${esc(t('kdock.notOpened'))}">
             <span class="t-tag tt-build" title="${esc(t('tag.build'))}">${tagIconHtml('build')}</span>
             <span class="grow dim-txt">${t('kdock.notOpenedShort')}</span>
           </div>`
        : `<div class="timer-row">
             <span class="t-tag tt-build" title="${esc(t('tag.build'))}">${tagIconHtml('build')}</span>
             <span class="grow dim-txt">${t('common.empty')}</span>
           </div>`);
    // 任務雙欄（#quests column-count:2）：每個任務包一層 .quest-cell，展開的詳情留在該欄內、
    // 不打散排版；名稱過長由 CSS 截斷，補 title 懸浮全名。
    questsEl.innerHTML = state.quests_().map(q => {
        const open = expandedQuests.has(q.no);
        // 有解析出目標次數才顯示「已完成/目標」；解不出來（單次型任務、以「隻」為單位者）
        // 回退顯示原本的受注中／達成（見 utils/quest-progress.ts）。
        const progressLabel = !q.done && q.progress
            ? `<span class="num" title="${esc(t('quest.progressHint'))}">${q.progress.count}/${q.progress.target}</span>`
            : `<span class="num">${q.done ? t('quest.done') : t('quest.inProgress')}</span>`;
        return `
      <div class="quest-cell">
        <div class="quest-row ${q.done ? 'done' : ''}" data-no="${q.no}">
          <span class="grow" title="${esc(q.name)}">${esc(q.name)}</span>
          ${progressLabel}
        </div>${open ? `<div class="quest-detail">${q.detail ? escDetail(q.detail) : t('quest.noDetail')}</div>` : ''}
      </div>`;
    }).join('') || `<div class="empty">${t('common.empty')}</div>`;
}
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
 * 出擊當下把編成檢視切到「這次出擊的那一隊」（#10）。出擊前多半在看別隊編組，
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
    // 單隊鈕一律切成只看該隊——聯合檢視只透過專屬「連合艦隊」鈕進入，不再靠
    // 「先點1再點2」自動組合（使用者：規則太隱晦，交給專屬按鈕就好）。
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
    // 倒數獨立成 .rcd 元素並把錨點/週期存進 data-*，讓每秒 tick 只改這顆的文字
    // （見 tickRepairCountdowns）。**不要改成每秒整塊重繪艦隊**：會重建所有裝備圖示，
    // 還會把使用者正打開的索敵倍率 select 關掉。
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
// 艦名 hover：一律顯示**封包原始日文艦名**（不是譯名）。譯名對不上遊戲畫面時這是唯一的
// 對照途徑；聯合檢視原本掛的是譯名，等於把列面已經看得到的字再說一次。原名同時也把
// 聯合檢視省略號截掉的部分補回來（原名是完整的），故不做「相同就省略」的最佳化。
function shipNameTitle(s: ShipView) {
    return ` title="${esc(s.nameJa || s.name)}"`;
}
function shipRow(s: ShipView, maxSlots: number, marks?: { cls: string; mark: string }) {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    const st = r <= 0.25 ? 'st-major' : r <= 0.5 ? 'st-mid' : r <= 0.75 ? 'st-minor' : '';
    const cond = s.cond >= 50 ? 'sparkle' : s.cond <= 19 ? 'heavy' : s.cond <= 29 ? 'tired' : '';
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
            : blankChip('chip-pad', true);
    // 跨艦補位：不同艦的真實槽數本來就不同（如 2 格潛艦排在 5 格戰艦旁），為了讓「全編成
    // 每艘船顯示高度統一」，補到本次渲染中最多槽數的艦相同數量，補位槽完全隱形（見 CSS）。
    const pct = (v: number, max: number) => max ? Math.round(100 * v / max) : 100;
    const fp = pct(s.fuel, s.maxFuel), bp = pct(s.bull, s.maxBull);
    // 燃彈合併成一個裝備格長度的 chip：不用圖示，左半燃料綠、右半彈藥棕（彈棕沿用
    // mat.ammo 圖示主色 #a8763e，見 tools/icons/gen_icons.py 的 ammo_crate）。兩側各是
    // 迷你量表：色塊寬度隨殘量縮短——燃料錨定左緣往左退、彈藥錨定右緣往右退，中間
    // 露出的底色即消耗量（linear-gradient 硬邊即色塊邊界，故百分比得走 inline style）。
    // 放在 .sub-row 內、.chips 之外：與裝備同一行，由 .chips 的 flex:1 推到最右。
    const supplyChip =
        `<span class="chip supply-combo" title="${esc(t('mat.fuel.full'))} ${fp}% ／ ${esc(t('mat.ammo.full'))} ${bp}%">` +
        `<span class="sup-fuel" style="background:linear-gradient(to right,#58a55c ${fp}%,transparent ${fp}%)">${fp}</span>` +
        `<span class="sup-ammo" style="background:linear-gradient(to left,#a8763e ${bp}%,transparent ${bp}%)">${bp}</span></span>`;
    const padCount = maxSlots - s.gears.length;
    const chips = realChips + blankChip('chip-pad').repeat(Math.max(0, padCount));
    return `<div class="ship ${st} ${s.escaped ? 'escaped' : ''} ${marks?.cls ?? ''}">
      <div class="ship-row">
        <span class="grow"${shipNameTitle(s)}>${s.stype ? `<span class="stype">${esc(s.stype)}</span>` : ''}${esc(s.name)}${escapedTag(s)}</span>${marks?.mark ?? ''}<span class="num">Lv${s.lv}</span>
        <span class="hpbar"><i style="width:${Math.round(r * 100)}%"></i></span>
        <span class="num">${s.hp}/${s.maxhp}</span><span class="cond ${cond}">${s.cond}</span>
      </div>
      <div class="sub-row">
        <span class="chips">${chips}</span>${exChip}${supplyChip}
      </div>
    </div>`;
}
function renderExped() {
    if (tab !== 'exped') return;
    expedFleetLabel.textContent = t('exped.checkTarget', { n: currentExpedFleet() + 1 });
    // 選單只在圖鑑載入後、且尚未建立時填充；語言換了也要重建（遠征名與海域標籤都在
    // 選項文字裡，不重建的話整個下拉會停在切換前的語言）。
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
            html += `<option value="${m.id}">[${esc(m.dispNo)}] ${esc(expedDisplayName(m.id, m.name))}</option>`;
        }
        expedSel.innerHTML = html + '</optgroup>';
        expedSelLang = getLang();
        // 重建會把選取洗掉：把使用者原本選的那個遠征選回來，不要因為換語言就跳回第一項。
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
    const { rows, gsRows, known, time, rewards, greatSuccess } = state.expedCheck(currentExpedFleet(), expedId);
    const head = time ? `<div class="dim">${t('exped.timeRequired')} ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}</div>` : '';
    const allOk = rows.length > 0 && rows.every(r => r.ok);
    const successMark = allOk
        ? `<span style="color:#58a55c">${t('exped.successMet')}</span>`
        : `<span style="color:var(--dmg-major)">${t('exped.successNotMet')}</span>`;
    // 大成功率は全遠征で公式値（16 + 15×戰意高昂 + √Lv + Lv/10）。成功条件を満たす場合のみ有効。
    const gsMark = !greatSuccess ? ''
        : !allOk
            ? `<span style="color:var(--dmg-major)">${t('exped.gsExcluded')}</span>`
            : `<span style="color:var(--sparkle)" title="${esc(greatSuccess.note)}">${t('exped.gsRate', { rate: greatSuccess.rate })}</span>`;
    // 有大発動艇系裝備加成時，資源數字整段變色標示（sparkle 金色＝「有加成」語意色，不挪用
    // 資源紀錄的 --res-gain/--res-drain——那組是餘額消長語意，混用會稀釋意義）；title 註明
    // 估算來源，不影響版面。
    const bonusWrap = (s: string) => rewards?.bonusActive
        ? `<span style="color:var(--sparkle)" title="${esc(t('exped.bonusHint'))}">${s}</span>` : s;
    // rewardAmountsUnverified 的遠征（出擊條件已知、燃彈鋼鋁數字尚無可信來源）：不把佔位 0
    // 當真數字顯示，只留成功/大成功判定與（封包事實的）道具，另加一行明講缺什麼。
    const itemsLine = rewards?.items.length ? `<div class="dim">${t('exped.items')} ${rewards.items.map(it =>
        `${esc(it.name)}×${it.max}${it.guaranteed
            ? `<span style="color:var(--sparkle)">${t('exped.gsOnly')}</span>`
            : `<span style="color:var(--dim)">${t('exped.randomOnSuccess')}</span>`}`).join('　')}</div>` : '';
    const resLine = !rewards ? '' : !rewards.amountsVerified ? `
        <div class="dim">${t('exped.success')}　${successMark}</div>
        <div class="dim">${t('exped.greatSuccess')}　${gsMark}</div>
        ${itemsLine}
        <div class="dim">${t('exped.rewardAmountUnverified')}</div>
    ` : `
        <div class="dim">${t('exped.success')}　${bonusWrap(`${t('mat.fuel')}${rewards.normal.fuel} ${t('mat.ammo')}${rewards.normal.bullet} ${t('mat.steel')}${rewards.normal.steel} ${t('mat.bauxite')}${rewards.normal.alum}`)}　${successMark}</div>
        <div class="dim">${t('exped.greatSuccess')}　${bonusWrap(`${t('mat.fuel')}${rewards.great.fuel} ${t('mat.ammo')}${rewards.great.bullet} ${t('mat.steel')}${rewards.great.steel} ${t('mat.bauxite')}${rewards.great.alum}`)}
            　${gsMark}</div>
        ${itemsLine}
    `;
    const warn = known ? '' : `<div class="dim">${t('exped.notRecorded')}</div>`;
    expedCheckEl.innerHTML = head + resLine + warn + rows.map(r => `
      <div class="check-row ${r.ok ? 'ok' : 'ng'}">
        <span class="mark">${r.ok ? '✓' : '✕'}</span>
        <span class="grow">${esc(r.label)}</span>
        ${r.cur ? `<span class="num">${t('exped.current')} ${esc(r.cur)}</span>` : ''}
      </div>`).join('') + gsRows.map(r => `
      <div class="check-row ${r.ok ? 'ok' : 'ng'}">
        <span class="mark">${r.ok ? '✓' : '✕'}</span>
        <span class="grow">${esc(r.label)}</span>
        ${r.cur ? `<span class="num">${t('exped.current')} ${esc(r.cur)}</span>` : ''}
      </div>`).join('');
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
    // class 用 cg-empty（非裸 empty）：裸 .empty 撞到面板另一個全域樣式
    // （「尚無資料」占位文字的 .empty,.dim{padding:2px 6px}，見 index.html），曾經讓
    // 空格意外多出 12px 水平內距、把整排擠到換行——這個 bug 已用無頭 Chrome 量出
    // computed style 撞名證實過，改用命名空間化的 class 徹底避開，不要改回裸 empty。
    const cgBlank = (capacity?: number, ex = false) =>
        `<span class="cg-item cg-empty${ex ? ' ex' : ''}"><span class="g-icon-slot"></span>${capacity ? `<em>${capacity}</em>` : ''}</span>`;
    const slots = s.gears.map((g, i) => g ? cgItem(g) : cgBlank(s.slotCapacity[i]));
    // 補強增設格獨立於一般槽位流之外、固定靠右對齊（同單隊檢視 shipRow 的 exChip
    // 排法）：一般槽位數因艦而異（2-5 格），若跟一般槽位混在同一個 flex-wrap 裡，
    // 打洞格的水平位置會逐艦亂跳（有時緊接在最後一格後面、有時因換行掉到下一行
    // 開頭）。用外層 flex（.c-gear）分兩塊：.c-gear-slots（flex:1，一般槽位自己
    // 允許換行）＋打洞格（flex:none，天然被推到最右）。 */
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
    return `<div class="ship c ${st} ${s.escaped ? 'escaped' : ''} ${marks?.cls ?? ''}">
      <div class="c-top">
        <span class="stype">${esc(s.stype)}</span>
        <span class="grow"${shipNameTitle(s)}>${esc(s.name)}${escapedTag(s)}</span>${marks?.mark ?? ''}
        <span class="lv">Lv${s.lv}</span>
        <span class="cond ${cond}">${s.cond}</span>
      </div>
      <div class="c-bot">
        <span class="hpbar"><i style="width:${Math.round(r * 100)}%"></i></span>
        <span class="num">${s.hp}/${s.maxhp}</span>${supply}
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
    return `<span>${t('fleet.airPower')} <b${stale ? ` class="est" title="${esc(t('fleet.airPowerStaleTitle'))}"` : ''}>${v}</b></span>`;
}
function renderCombinedFleets() {
    const all = state.fleets();
    const sum = state.combinedSummary(cn);
    const totalHead = `<div class="fsummary combined-total">
        <span>${t('fleet.lvTotal')} <b>${sum.lvSum}</b></span>
        ${airPowerHtml(sum.air, sum.airStale)}
        <span>${t('fleet.scouting33')} <b>${sum.f33.toFixed(2)}</b>
          <select class="cn">${[1, 2, 3, 4].map(x =>
        `<option value="${x}" ${x === cn ? 'selected' : ''}>×${x}</option>`).join('')}</select></span>
        <span><b>${sum.speed}</b></span>
        ${sum.tp.gear > 0 ? `<span title="${esc(t('fleet.transportTPTitle'))}">${t('fleet.transportTP')} <b>${sum.tp.total}</b></span>` : ''}
      </div>`;
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
        const { rep, mor, badges: repairBadges } = repairPlansOf(f);
        const head = repairBadges ? `<div class="fsummary compact col">${repairBadges}</div>` : '';
        return `<section class="fleet compact">${head}${f.ships.map((s, idx) => compactShipRow(s, repairMarks(idx, rep, mor))).join('')}</section>`;
    }).join('');
    fleetsEl.innerHTML = `<div class="combined-wrap">${totalHead}<div class="c-fleet-row">${cols}</div></div>`;
}
function renderFleets() {
    if (isCombinedView()) { renderCombinedFleets(); return; }
    const all = state.fleets();
    // 全編成（所有艦隊，非僅目前檢視的分頁）取槽數最大值，讓每艘船的裝備列補到同一
    // 行數／高度——若只算目前顯示的艦隊，切換單隊↔聯合檢視時列高會跳動。
    // 只算一般槽：打洞格已獨立成列尾固定位置（見 shipRow 的 exChip），不佔左側裝備流。
    const maxSlots = Math.max(1, ...all.flatMap(f => f.ships.map(s => s.gears.length)));
    fleetsEl.innerHTML = [...view].sort((a, b) => a - b).map(i => {
        const f = all[i];
        if (!f) return '';
        const sum = state.fleetSummary(i, cn);
        // 秘書艦標記／編成命名已移除（不再顯示 h4 標題列，省下每個艦隊區塊一行高度）；
        // 出擊／大破等需直接顯示的即時狀態併入 fsummary 第一行；未補給只用編成編號紅框提醒。
        const { rep, mor, badges: repairBadges } = repairPlansOf(f);
        const badges =
            (f.mission ? `<span class="badge-tag mission">${t('fleet.onMission')}</span>` : '') +
            (f.ships.some(s => !s.escaped && s.maxhp && s.hp / s.maxhp <= 0.25) ? `<span class="badge-tag danger">${t('fleet.heavyDamage')}</span>` : '') +
            repairBadges;
        const summary = sum ? `<div class="fsummary">
            ${badges}
            <span>${t('fleet.lvTotal')} <b>${sum.lvSum}</b></span>
            ${airPowerHtml(sum.air, sum.airStale)}
            <span>${t('fleet.scouting33')} <b>${sum.f33.toFixed(2)}</b>
              <select class="cn">${[1, 2, 3, 4].map(x =>
            `<option value="${x}" ${x === cn ? 'selected' : ''}>×${x}</option>`).join('')}</select></span>
            <span><b>${sum.speed}</b></span>
            ${sum.tp.gear > 0 ? `<span title="${esc(t('fleet.transportTPTitle'))}">${t('fleet.transportTP')} <b>${sum.tp.total}</b></span>` : ''}
          </div>` : '';
        return `<section class="fleet">${summary}${f.ships.map((s, idx) => shipRow(s, maxSlots, repairMarks(idx, rep, mor))).join('')}</section>`;
    }).join('');
}
fleetsEl.addEventListener('change', e => {
    const sel = (e.target as HTMLElement).closest('select.cn') as HTMLSelectElement | null;
    if (!sel) return;
    cn = Number(sel.value);
    renderFleets();
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
 * 疲勞標記的 markup。未知狀態畫不出對應表情，維持原本的文字（誠實顯示原始值）。
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
    // **舊版的 `String.fromCharCode(64 + edgeId)` 已被真實資料否證**（61-5 實測 48=E、37=Q，
    // 既非 ASCII 推算也非編號排序），故查不到就顯示遊戲的 cell 編號，不再推算。
    return nodeLabel(`${mapArea}-${mapNo}`, edgeId);
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
    const planeLost = (lost: number) => lost > 0 ? `<span class="s-air-lost">-${lost}</span>` : '';
    // 敵我方機數格。**這一節點打完之前顯示「出擊機數 -損失」（238 -23），結算後只留
    // 殘存機數（215）**。
    //   ・交戰中：要看的是這一場投入了多少、掉了多少。夜戰接續沒有航空戰，機數不會再變，
    //     故整個節點期間都維持同一組數字，不中途改口。
    //   ・結算後：`-損失` 已是打完的舊帳，殘存機數才是接下來要帶進下一個節點的東西，
    //     再掛著損失只是雜訊。
    // 舊寫法固定顯示 `殘存/出擊 -損失`（215/238 -23）：三個數字擠在一格，而且交戰中就先
    // 把殘存數當成定局顯示出來。
    const planeCell = (v: { count: number; lost: number }) =>
        info?.hasResult ? `${v.count - v.lost}` : `${v.count}${planeLost(v.lost)}`;
    let html = '<div class="sortie-container">';
    // 標題列：海域編號 + 節點軌跡 + 狀態，合併為一行省高度（#4）
    // 關卡進度：已用真實 mapinfo 封包驗證兩種量表（見 state.ts MapGaugeView 註解）。
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
    const lastNode = sortie.nodes[sortie.nodes.length - 1];
    const atBoss = !!lastNode && lastNode.color === 5;
    let nodeDots = '';
    for (const n of sortie.nodes) {
        const letter = getEdgeLetter(sortie.mapArea, sortie.mapNo, n.id);
        const isBoss = n.color === 5; // usually 5 is boss in KC
        nodeDots += `<div class="s-node visited ${isBoss ? 'boss' : ''}">${letter}</div>`;
    }
    let gaugeHtml = '';
    // 量表本體：一顆圓矩 pill，殘量條當背景、**剩餘實數直接寫在條子裡**。
    // 使用者要求（活動海域）一眼看到 2760/4600 這種攻略血量，而不是由 HP 推估的
    // 「剩 N 次」——推估值不是封包事實，改留在 tooltip 裡當補充說明。
    const gaugeBar = (now: number, max: number, zansatsu: boolean, title: string) => sortieGaugeBarHtml({
        now, max, finalPhase: zansatsu, title, finalLabel: t('sortie.zansatsuLabel'),
    });
    if (gauge?.cleared) {
        // 已攻略關卡回應不再帶量表欄位，一律顯示已攻略勾號
        gaugeHtml = `<div class="s-gauge cleared" title="${esc(t('sortie.cleared'))}">✓</div>`;
    } else if (gauge?.gaugeType === 1 && gauge.requiredDefeatCount > 0) {
        // 擊破數式（一般圖5番/EO）：量表隨擊破遞減，條子裡寫「剩餘擊破次數／需求次數」
        // （與 gaugeType 2 一致採剩餘語意；先前顯示「已擊破數」會被誤讀為剩餘數）
        const remain = Math.max(0, gauge.requiredDefeatCount - gauge.defeatCount);
        // 剩最後 1 次 → 斬殺場提示（該次擊破即攻略）
        const zansatsu = remain === 1;
        const title = [
            t('sortie.remainingHits', { n: remain, done: gauge.defeatCount, total: gauge.requiredDefeatCount }),
            zansatsu ? t('sortie.zansatsuLabel') : '',
        ].filter(Boolean).join('\n');
        gaugeHtml = gaugeBar(remain, gauge.requiredDefeatCount, zansatsu, title);
    } else if ((gauge?.gaugeType === 2 || gauge?.gaugeType === 3) && gauge.maxHp > 0 && gauge.maxHp !== 9999) {
        // HP量表式(gaugeType 2, boss撃破)／TP輸送型(gaugeType 3)：條子裡一律寫封包實數
        // 「剩餘/最大」。剩餘次數是由 boss 旗艦 HP 推估的衍生值，改放 tooltip。
        const isTpGauge = gauge.gaugeType === 3;
        const r = isTpGauge ? null : state.mapRemainingRuns();
        const hint = r != null
            ? t('sortie.hintEstRuns', { n: r, kind: t('sortie.kindDefeat') })
            : isTpGauge ? '' : t('sortie.hintNeedBoss');
        // boss 撃破型殘量嚴格小於 boss HP → 進入斬殺期；TP 輸送型不適用。
        // 不用 `r === 1`：ceil(殘量 / boss HP) 在兩者相等時也是 1，但那還沒進斬殺線。
        const zansatsu = !isTpGauge && state.mapInFinalPhase();
        const title = [
            t('sortie.gaugeTitle', { now: gauge.nowHp, max: gauge.maxHp, hint }),
            zansatsu ? t('sortie.zansatsuLabel') : '',
        ].filter(Boolean).join('\n');
        gaugeHtml = gaugeBar(gauge.nowHp, gauge.maxHp, zansatsu, title);
    } else if (gauge?.gaugeType === 2 && gauge.maxHp === 9999) {
        // maxHp=9999：尚未選擇難度的佔位值（已用兩份真實封包比對驗證），非真實100%
        gaugeHtml = `<div class="s-gauge locked" title="${esc(t('sortie.notChosenDifficulty'))}">🔒</div>`;
    } else if (gauge) {
        gaugeHtml = `<div class="s-gauge uncleared" title="${esc(t('sortie.uncleared'))}">－</div>`;
    }
    html += `
        <div class="s-header">
            <div class="s-map-id" title="${esc(diff ? `${mapCode}・${diff}` : mapCode)}">${esc(mapStr)}${diff ? `<i>${esc(diff)}</i>` : ''}</div>
            ${gaugeHtml}
            <div class="s-nodes">${nodeDots}</div>
            <div class="s-phase${atBoss ? ' active' : ''}">${atBoss ? t('sortie.boss') : t('sortie.advancing')}</div>
        </div>
    `;
    if (info) {
        // ── 大破警告 ──
        // 位置：**釘在右下航空戰欄，一律 absolute**（見 index.html 的 .s-taiha）。展開態
        // 遮住敵我方機數，點一下收成「航空戰 ↔ 敵我方」之間的一條 banner。絕對定位是關鍵
        // ——舊版把警告插在戰鬥列上方的一般流裡，一出現就把 165px 敵艦列與底下的陣型／
        // rank／友軍列整排往下推，而那一列是釘死的（CLAUDE.md 出擊資訊欄硬約束）。
        //
        // 兩種大破訊號語意不同，必須分開講（合成一句會讓使用者不知道到底能不能進擊）：
        //   · 旗艦大破＝遊戲禁止進擊、強制返航；旗艦自己身上還有損管才可突破。
        //   · 其餘艦大破＝可以進擊但會被轟沈；旗艦帶司令部施設時可改成讓該艦退避。
        // 兩者可能同時成立（旗艦與隊員都大破），故不是 else if。
        const taihaLines: { text: string; title?: string; hint?: boolean }[] = [];
        if (info.flagshipTaiha) {
            const dameconMst = info.flagshipDamecon === 1 ? 42 : info.flagshipDamecon === 2 ? 43 : 0;
            taihaLines.push(dameconMst
                ? {
                    text: t('sortie.taihaFlagshipDamecon', { item: state.gearName(dameconMst) }),
                    title: t('sortie.taihaFlagshipDameconTitle'),
                }
                : { text: t('sortie.taihaFlagship') });
        }
        if (info.isTaiha) {
            // 退避提示分三態，且**文案要依成立的是哪一顆司令部而不同**：連合是「護衛退避」
            // （大破艦＋一艘健康驅逐艦一起離場），遊撃部隊／水雷戦隊是「單艦退避」（只有
            // 大破艦離場、不需要護衛艦）。共用一套說明會讓單艦隊玩家去找根本不存在的護衛艦。
            // `noEscort` 一定要講出來——「沒出現護衛退避」不等於「沒有人大破」，把它當成
            // 安全訊號就會大破進擊。
            const retreat = state.retreatAvailability();
            const soloKey = retreat.kind === 'striking'
                ? 'sortie.taihaRetreatSoloStriking' : 'sortie.taihaRetreatSoloTorpedo';
            const hint = retreat.state === 'noEscort' ? t('sortie.taihaRetreatNoEscort')
                : retreat.state !== 'ready' ? ''
                    : retreat.kind === 'combined' ? t('sortie.taihaRetreatHint') : t(soloKey);
            const hintTitle = retreat.state === 'noEscort' ? t('sortie.taihaRetreatNoEscortTitle')
                : retreat.kind === 'combined' ? t('sortie.taihaRetreatHintTitle')
                    : t('sortie.taihaRetreatSoloTitle');
            taihaLines.push({ text: t('sortie.taihaWarning') });
            if (hint) taihaLines.push({ text: hint, hint: true, title: hintTitle });
        }
        // 展開／收縮的預設值。**這是版面決策，不是大破規則**——大破照樣是大破（大破進王
        // 一樣會被轟沈），警告也照樣顯示，這裡只決定要不要用遮蔽式大框。
        //
        // 收成 banner 的唯一理由：boss 是路線最後一個節點，**之後沒有節點可以進擊**，
        // 使用者沒有「要不要進擊」這個決策要做，不需要一個蓋住畫面的大框逼他看。
        // 條件限定「進 boss 之前是安全的」（`bossEntryTaiha === false`）：帶著大破進 boss
        // 是玩家自己冒的險，那種情況照舊展開。`null`（面板中途才開、沒看到抵達那一步）
        // 不套用此例外——未知不等於安全。
        const taihaAtLastNode = atBoss && state.bossEntryTaiha === false;
        const taihaOpen = taihaOpenOverride ?? !taihaAtLastNode;
        const taihaHtml = !taihaLines.length ? '' : `
                    <button type="button" class="taiha-alert s-taiha${taihaOpen ? ' open' : ''}"
                        id="taiha-toggle" aria-expanded="${taihaOpen}"
                        title="${esc([
            ...taihaLines.map(l => l.title ?? l.text),
            taihaAtLastNode ? t('sortie.taihaBossLastNode') : '',
            t(taihaOpen ? 'sortie.taihaCollapseHint' : 'sortie.taihaExpandHint'),
        ].filter(Boolean).join('\n'))}">${taihaLines.map(l =>
            `<span class="${l.hint ? 'taiha-hint' : 'taiha-head'}">${esc(l.text)}</span>`).join('')}</button>`;
        // 敵方編成：晶片式兩欄（隨伴在左、主隊在右，對齊遊戲排版）。
        // 單艦隊無隨伴時，僅顯示主隊單欄、橫向填滿（不留一半空白）。
        const eMain = info.resultFleets?.enemyMain || [];
        const eEsc = info.resultFleets?.enemyEscort || [];
        // 敵艦 hover 的詳細資訊（#14）：等級、素質四項與裝備清單。
        // 全部是戰鬥封包欄位（api_ship_lv／api_eParam／api_eSlot），封包沒帶就不寫那一行
        // ——空著比填 0 誠實（0 火力與「不知道火力」是兩件事）。
        // 逐項一行（素質四項、裝備逐顆）。原本用「／」串成兩長行，敵艦名一長／裝備一多
        // 就被 tooltip 自動折行折在任意位置，反而讀不出哪個數字配哪個標籤。
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
        // 不論敵艦數量都不移動位置（#4）：上緣接晶片頂＝不是跟「主隊/隨伴」文字對齊，
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
        html += `
                <div class="s-stats-mini">
                    <div class="s-stat-row"><span class="lbl">${t('sortie.detection')}</span><span class="val">${t('sortie.detectionOk')}</span></div>
                    <div class="s-stat-row"><span class="lbl">${t('sortie.heading')}</span><span class="val ${info.formation[2] === 4 ? 'bad' : ''}">${eng}</span></div>
                    <div class="s-stat-row"><span class="lbl">${t('sortie.contact')}</span><span class="val">${info.touchPlane[0] > 0 ? t('sortie.yes') : t('sortie.no')} vs ${info.touchPlane[1] > 0 ? t('sortie.yes') : t('sortie.no')}</span></div>
                    <div class="s-stat-row"><span class="lbl">${t('sortie.airBattle')}</span><span class="val ${seikuBad ? 'bad' : ''}">${seikuStr}</span></div>
                </div>
                <div class="s-air-wrap${taihaHtml && taihaOpen ? ' covered' : ''}">
                    <div class="s-air-mini">
                        <span></span><span class="hd">${t('sortie.ourSide')}</span><span class="hd">${t('sortie.enemySide')}</span>
                        <span class="rowlbl"><span class="s-air-icon" style="color:#51cf66;">${t('sortie.fighterAbbr')}</span></span>
                        <span>${planeCell(p.playerFighter)}</span>
                        <span>${planeCell(p.enemyFighter)}</span>
                        <span class="rowlbl"><span class="s-air-icon" style="color:#ff6b6b;">${t('sortie.bomberAbbr')}</span></span>
                        <span>${planeCell(p.playerBomber)}</span>
                        <span>${planeCell(p.enemyBomber)}</span>
                    </div>${taihaHtml}
                </div>
            </div>
        </div>`;
        // 陣形/支援/AACI/夜戰/rank/友軍 一列＋Drop：固定在敵艦晶片區下方，
        // 位置不隨敵艦數量位移（#2, #4）。
        const formationKeys = ['form.unknown', 'form.single', 'form.double', 'form.ring', 'form.ladder', 'form.abreast', 'form.vigilant'];
        const enFormShort = t(formationKeys[info.formation[1]] || 'form.unknown');
        const supp = info.supportFlag > 0 ? t('sortie.support') : t('sortie.none');
        // 支援艦隊：hover 顯示是哪一種支援、第幾艦隊、打了多少（#18）。
        // api_ship_id 是**艦實例 id**，要經 state.ships 反查才拿得到 master id → 艦名。
        const support = info.support;
        const supportTitle = !support ? t('sortie.supportFleetTitle') : [
            t('sortie.supportDamage', {
                kind: t(support.kind === 'air' ? 'sortie.supportKindAir' : 'sortie.supportKindShelling'),
                deck: support.deckId || '?',
                damage: support.damage,
            }),
            support.shipIds.length
                ? t('sortie.supportShips', {
                    ships: support.shipIds
                        .map(id => state.shipName(state.ships.get(id)?.api_ship_id) || `#${id}`)
                        .join('／'),
                })
                : '',
        ].filter(Boolean).join('\n');
        const aaci = info.aaci > 0 ? t('sortie.antiAirCutin') : t('sortie.none');
        const midn = info.midnightFlag ? t('sortie.midnight') : t('sortie.none');
        // rank：結算前顯示「預測值」（虛線框標示），結算後顯示遊戲回傳的「確定值」
        const rankStr = info.rank && info.rank !== '?' ? info.rank : '?';
        const rnkClass = rankStr !== '?' ? `rank-${rankStr.toLowerCase()}` : '';
        const rankPredCls = info.hasResult ? '' : ' predicted';
        const rankTitle = info.hasResult ? t('sortie.ratingConfirmed') : t('sortie.ratingPredicted');
        // 友軍艦隊：活動海域 boss 夜戰才可能出現，滑鼠移上去才顯示編成（title tooltip）
        const friendlyIds = info.friendlyFleetIds;
        const friendlyActive = !!friendlyIds && friendlyIds.length > 0;
        const friendlyTitle = friendlyActive
            ? t('sortie.friendlyFleetTitle', { ships: friendlyIds!.map(id => state.shipName(id)).join('／') })
            : t('sortie.friendlyFleetNone');
        // 基地航空隊戰果（#4）：**只在這一節點真的有出擊時才多一顆圈**——沒有陸航的
        // 一般海域維持原本六顆，版面完全不動（.s-icon-cluster 是固定一列，多塞常駐元素
        // 會在窄面板把 Drop chip 擠掉，見 CLAUDE.md 出擊資訊欄硬約束）。
        // 圈內兩行＝對敵傷害／損失機數，逐波明細留在 tooltip。
        const lbas = info.lbas;
        // 逐波明細一波一段、段內逐項換行（基地／制空／損失／傷害各一行）：一波五、六個
        // 數字擠在同一行用「／」隔開時，波數一多就分不出哪個數字屬於哪一波。
        const lbasWaveLines = (w: BattleLbasView['waves'][number], i: number) => [
            w.baseId ? t('sortie.lbasWaveHead', { i: i + 1, base: w.baseId })
                : t('sortie.lbasWaveHeadNoBase', { i: i + 1 }),
            `　${t('sortie.airBattle')} ${w.seiku != null && seikuKeys[w.seiku] ? t(seikuKeys[w.seiku]) : t('sortie.none')}`,
            `　${t('sortie.lbasWaveLost', { sent: w.sent, lost: w.lost })}`,
            `　${t('sortie.lbasWaveDamage', { damage: w.damage })}`,
        ].join('\n');
        const lbasChip = !lbas ? '' : `<div class="s-icon lbas active" title="${esc([
            t('sortie.lbasTitle', { sent: lbas.sent, lost: lbas.lost, damage: lbas.damage }),
            ...lbas.waves.map(lbasWaveLines),
        ].join('\n'))}"><span class="s-lbas-dmg">${lbas.damage}</span>${
            lbas.lost > 0 ? `<span class="s-air-lost">-${lbas.lost}</span>` : ''}</div>`;
        // drop 為隨機，無法預測，僅結算後顯示實際掉落；用完整艦名 chip（#5）。
        // 新船才上金色（#8）：dropIsNew 在 battleresult 當下就判定好（回港後名冊會
        // 含這艘船，那時再問一律是「已持有」），面板只負責上色。
        const dropChip = info.hasResult && info.drop
            ? `<div class="s-drop${info.dropIsNew ? ' new' : ''}" title="${esc(
                `${t('sortie.dropTitle')}：${info.drop}${info.dropIsNew ? `（${t('sortie.dropNew')}）` : `（${t('sortie.dropOwned')}）`}`)}"
                ><span class="s-drop-tag">Drop</span><span class="s-drop-name">${esc(info.drop)}</span></div>`
            : '';
        html += `
            <div class="s-icons-full">
                <div class="s-icon-cluster">
                    <div class="s-icon" title="${esc(t('sortie.enemyFormationTitle'))}">${enFormShort}</div>
                    <div class="s-icon ${info.supportFlag > 0 ? 'active' : ''}" title="${esc(supportTitle)}">${supp}</div>
                    <div class="s-icon ${info.aaci > 0 ? 'active' : ''}" title="${esc(t('sortie.aaciTitlePrefix'))}: ${info.aaci}">${aaci}</div>
                    <div class="s-icon ${info.midnightFlag ? 'active' : ''}" title="${esc(t('sortie.midnightTitle'))}">${midn}</div>
                    <div class="s-icon ${rnkClass}${rankPredCls}" title="${esc(rankTitle)}">${rankStr}</div>
                    <div class="s-icon ${friendlyActive ? 'active' : ''}" title="${esc(friendlyTitle)}">${t('sortie.friendlyFleet')}</div>
                    ${lbasChip}
                </div>
                ${dropChip}
            </div>
        `;
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
// 歷史紀錄清單（開發/建造/改修）已移至「鎮守府情報總括」分頁（#5，讀 db.factory）；
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
    || path.startsWith('api_req_battle_midnight/');
// 「新的一場戰鬥」＝上面那組扣掉**同一個節點**的結算（battleresult，注意
// `'...battleresult'.startsWith('...battle')` 為 true）與退避（goback_port）。
// 大破警告的手動收縮只該被真正的新戰況重置：使用者為了看敵我機數而收起警告後，
// 同節點的結算封包一到就把它重新展開、又蓋住機數，是使用者做完動作馬上被推翻。
const isNewBattlePacket = (path: string) =>
    isSortieBattlePath(path) && !path.endsWith('result') && !path.endsWith('/goback_port');

async function consume(id: number, ts: number, path: string, api: any, req?: Record<string, string>): Promise<void> {
    if (id <= maxId) return;
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
        // 大破警告的手動展開／收縮只在「同一則戰況」內有效：新的出擊、新的節點、新的戰鬥
        // 都是新的判斷，一律回到情境預設。收起來一次就整場不再示警的話警告等於白做。
        if (path === 'api_req_map/start' || path === 'api_req_map/next' || isNewBattlePacket(path))
            taihaOpenOverride = null;
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
        // 佇列清空＝先前的讀取問題已經恢復，把積壓提示收掉。
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
// 也刻意不用「已知就略過」當快門：同一活動海域可能有多個 Boss 節點，本次 session 先
// 觀測到的可能是 HP 較低的旁支 Boss，紀錄裡的較高門檻仍必須併進來（observeMapBossHp
// 取最大值）。頻率是每次出擊一次，成本可接受。
//
// **不以 sortieInfo 為前提**：斬殺線的兩個材料在母港就到齊了——量表值來自 mapinfo（點開
// 出擊海域選單即送來），Boss HP 來自本機出擊紀錄。把補撈綁在「正在出擊中」會逼使用者
// 花一次出擊的資源才看得到結果，而那次出擊本身正是要靠這條線去決定要不要打的。
//
// 一張圖只掃一次 DB（bossHpScanned）。**不可改用「mapBossHp 已有值就跳過」當快門**：
// 本次 session live 觀測到的可能是 HP 較低的旁支 Boss，紀錄裡的較高門檻仍必須併進來。
const bossHpScanned = new Set<number>();

async function restoreMapBossHp(mapArea: number, mapNo: number): Promise<boolean> {
    const mapId = mapArea * 10 + mapNo;
    const before = state.mapBossHp.get(mapId);
    const map = `${mapArea}-${mapNo}`;
    // sorties 是每筆 <1KB 的摘要，整表過濾成本可忽略；replays 才是帶原始封包的大列。
    const bossRows = await db.sorties
        .filter(row => row.map === map && !!row.boss && !row.imported)
        .toArray();
    let scanned = 0;
    if (bossRows.length > 0) {
        // 逐列串流而不是 toArray()：一張活動海域的重播可能有數十場、每場數則原始戰鬥封包，
        // 整批載入會把幾十 MB 搬進面板記憶體。每次只留一列，交給同一支純函式算。
        await db.replays.where('world').equals(mapArea).each(row => {
            if (row.mapnum !== mapNo || row.imported) return;
            scanned++;
            const hp = maxObservedBossHp([row], bossRows, mapArea, mapNo);
            if (hp != null) state.observeMapBossHp(mapArea, mapNo, hp);
        });
    }
    const after = state.mapBossHp.get(mapId);
    console.log(`[KC-Monitor] bossHp ${map}: 重播=${scanned} Boss紀錄=${bossRows.length} `
        + `記憶體=${before ?? '無'}→${after ?? '無'}`);
    return after !== before;
}

// 對所有「尚未攻略的 boss 撃破型量表」補撈斬殺線。mapinfo 一到就跑（點開出擊海域選單
// 那一刻），面板啟動時也跑一次。回傳是否有任一張圖的斬殺線改變，供呼叫端決定要不要重畫。
async function restoreGaugeBossHp(): Promise<boolean> {
    let changed = false;
    for (const { mapId, mapArea, mapNo } of state.unclearedHpGaugeMaps()) {
        if (bossHpScanned.has(mapId)) continue;
        bossHpScanned.add(mapId);
        try {
            if (await restoreMapBossHp(mapArea, mapNo)) changed = true;
        } catch (e) {
            bossHpScanned.delete(mapId);   // 失敗不算掃過，下次 mapinfo 再試
            console.warn('[KC-Monitor] Boss HP 恢復失敗', mapId, e);
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
        if (isDebugUiEnabled()) void renderWanted();   // 開發用：載入先前 session 的待驗證封包
        void pump();           // 處理啟動期間積在 pending 的 live 事件
    } catch (error) {
        // 啟動重播失敗：pump 同樣不能在這份半成品 state 上繼續（理由見
        // stopAfterProjectionFailure），但訊息要講「啟動失敗」而不是「已停止接收」。
        projectionFailed = true;
        console.error('[KC-Monitor] panel startup failed', error);
        setNotice('fatal', t('panel.loadFailed', { reason: describeError(error) }), t('panel.stoppedHint'));
    }
})();
