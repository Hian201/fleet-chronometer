import { db } from '@/utils/db';
import { nodeLabel } from '@/utils/map-node-letters';
import { EventProjector, projectEventAndAdvance } from '@/utils/event-projector';
import { advanceProjectionCursor, readProjectionCursor } from '@/utils/projection-cursor';
import { GameState, type ShipView, type AirBaseView, type SquadronView, type GearView, type FleetView } from '@/utils/state';
import {
    planAnchorageRepair, planMoraleSupply, nextSettlementIn,
    REPAIR_INTERVAL_MS, MORALE_INTERVAL_MS,
    type AnchorageRepairPlan, type MoralePlan,
} from '@/utils/repair';
import { applySnapshotBaseline, planStateRecovery } from '@/utils/state-recovery';
import { t } from '@/utils/ui-i18n';
import { initLang, applyTheme, onPrefsChange } from '@/utils/ui-prefs';
const $ = (id: string) => document.getElementById(id)!;
const headerEl = $('header'), tabsEl = $('tabs'), generalEl = $('tab-general'), activityEl = $('tab-activity'),
    resline = $('resline'), missionsEl = $('missions'), ndocksEl = $('ndocks'), kdocksEl = $('kdocks'), questsEl = $('quests'),
    log = $('log'), fleetnavEl = $('fleetnav'), fleetsEl = $('fleets'), airBasesEl = $('air-bases'),
    wantedEl = $('wanted'),
    facLiveEl = $('factory-live');
const state = new GameState();
const projector = new EventProjector({ state, mode: 'persist', tables: db });
// 面板顯示語言＋主題：持久化／偵測／跨頁同步抽到 utils/ui-prefs.ts（panel/popup/overview
// 三頁共用；utils/ui-i18n.ts 仍只放純函式，維持 state.ts 可獨立編譯）。
// 語言/主題以「鎮守府情報總括」為控制中心，但任一頁切換都會經 storage 事件廣播到其他
// 已開頁面（#1/#2）——面板收到就套用並整頁重繪。
initLang();
applyTheme();
onPrefsChange(() => { applyStaticI18n(); renderAll(); });
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
let tab: 'general' | 'exped' | 'activity' | 'sortie' | 'factory' = 'general';
let manualOverride = false;          // 使用者手動切過分頁後暫停自動切換
let currentContext: string | null = null;  // 目前情境（port / sortie / exped）
let expedId: number | null = null;
let view: number[] = [0];
let cn = 1;
let showLbas = false;
let selectedLbasArea: number | null = null;
const expandedQuests = new Set<number>();   // 使用者展開查看內容的任務編號
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 裝備／資源圖示：面板是 extension page，public/icons 會複製到擴充根，故 root-relative /icons/… 直接解析。
// 圖示為本專案原創向量重繪（以遊戲原圖構圖概念為藍本，見 THIRD-PARTY-NOTICES）。
// 裝備檔名即 api_type[3] id（1–60），無對照表；alt 帶短縮文字，圖示載入失敗時瀏覽器自動退回顯示 alt，
// 兼作無障礙標籤。icon<=0（未配備／不明）直接用文字退路，不出 <img> 避免 404 破圖。
const gearIconHtml = (icon: number, short: string) =>
    icon > 0 ? `<img class="g-icon" src="/icons/equipment/${icon}.svg" alt="${esc(short)}" loading="lazy">` : esc(short);
// 熟練度以符號表示（對映遊戲內熟練度徽章階層：1-3 直線、4-6 斜線、7 為 ace 雙箭）。
// 不吐數字（數字寬度隨值變動、破壞對齊），確切等級留在 chip 的 title 提示。'>' 需轉義。
const alvMark = (alv: number) =>
    ['', '|', '||', '|||', '/', '//', '///', '&gt;&gt;'][Math.min(7, Math.max(0, alv))];
// 改修：+1~+9 顯示數字，+10（滿改修）顯示五角星、不顯示數字；未改修回空字串。
const impMark = (level: number) =>
    level >= 10 ? '★' : level > 0 ? String(level) : '';
// 資源圖示：key 形如 'mat.fuel'，去掉 'mat.' 前綴即檔名（fuel/ammo/steel/bauxite/torch/drum/devmat/screw）。
const matIconHtml = (key: string) =>
    `<img class="m-icon" src="/icons/resource/${key.slice(4)}.svg" alt="${esc(t(key))}">`;
// 計時列標籤圖示（入渠＝修理施設吊臂・建造＝造船鎚・遠征＝羅盤）。alt 帶原本的漢字短標籤，
// 圖示載入失敗時自動退回文字；title 由呼叫端的 .t-tag 帶（保留 hover 全名與無障礙）。
const tagIconHtml = (kind: 'dock' | 'build' | 'exped') =>
    `<img class="t-icon" src="/icons/ui/${kind}.svg" alt="${esc(t('tag.' + kind))}">`;
// 任務內容原文換行用字面 <br> 標籤（非 \n，已用 samples/Quest.json 真實封包驗證，見 api_no
// 637/643/861 等）；先跳脫全文防 XSS，再把跳脫後的 &lt;br&gt; 還原成真正換行。
// 不做任何翻譯，玩家自行用其他工具查照原文即可。
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
const expedFleetLabel = document.getElementById('exped-fleet-label')!;
const expedSel = document.getElementById('exped-select') as HTMLSelectElement;
const expedCheckEl = document.getElementById('exped-check')!;
const currentExpedFleet = () => view[0] ?? 0;   // 永遠跟隨艦隊分頁目前選的第一支
let expedFleetShown: number | null = null;   // 遠征分頁上次渲染的艦隊，用來偵測切換以帶出該隊上次遠征
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
    tabsEl.innerHTML = `
      <button data-t="general" class="${tab === 'general' ? 'on' : ''}">${t('tab.general')}</button>
      <button data-t="sortie" class="${tab === 'sortie' ? 'on' : ''}">${t('tab.sortie')}</button>
      <button data-t="exped" class="${tab === 'exped' ? 'on' : ''}">${t('tab.exped')}</button>
      <button data-t="factory" class="${tab === 'factory' ? 'on' : ''}">${t('tab.factory')}</button>
      <button data-t="activity" class="${tab === 'activity' ? 'on' : ''}">${t('tab.activity')}</button>`;
}
// 切換分頁的共用函式（manual=true 代表使用者手動點選，會暫停自動切換）
function setTab(t: typeof tab, manual: boolean) {
    tab = t;
    if (manual) manualOverride = true;
    generalEl.style.display = tab === 'general' ? '' : 'none';
    document.getElementById('tab-exped')!.style.display = tab === 'exped' ? '' : 'none';
    document.getElementById('tab-sortie')!.style.display = tab === 'sortie' ? '' : 'none';
    document.getElementById('tab-factory')!.style.display = tab === 'factory' ? '' : 'none';
    activityEl.style.display = tab === 'activity' ? '' : 'none';
    renderTabs(); renderExped(); renderSortie();
    if (tab === 'factory') renderFactory();
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
    missionsEl.innerHTML = state.missions().map(mm => `
      <div class="timer-row" title="${esc(mm.name)}">
        <span class="t-tag" title="${esc(t('tag.exped'))}">${tagIconHtml('exped')}</span>
        <span class="fleet-box">${esc(mm.fleet)}</span>
        <span class="badge">${esc(mm.dispNo)}</span>
        <span class="grow exped-name">${esc(mm.name)}</span>
        <span class="badge">${fmt(mm.completeAt)}</span>
      </div>`).join('') || `
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
    return f.ships.some(s => (s.maxhp && s.hp / s.maxhp <= 0.25) || s.fuel < s.maxFuel || s.bull < s.maxBull);
}
// 基地航空隊沒有大破/燃彈概念，「未補給」對應的是已配備隊有機數耗損未補滿
// （renderAirBases 的 sq.count < sq.maxCount，同一份 depleted 判斷）。
function lbasNeedsAttention() {
    return state.airBases_().some(ab => ab.squadrons.some(sq => sq.state === 1 && sq.count < sq.maxCount));
}
function renderFleetNav() {
    const names = ['1', '2', '3', '4'];
    const all = state.fleets();
    fleetnavEl.innerHTML =
        names.map((n, i) => {
            const visible = !showLbas && view.includes(i);
            // 目前正顯示的艦隊不用紅框——內容區塊（renderFleets/renderCombinedFleets）
            // 已經有 danger/warn badge，tab 上再標一次是重複提醒。只在「沒被看到」時才需要
            // 紅框把使用者引導過去（含 showLbas 開著、任何艦隊都不可見的情況）。
            const cls = [visible ? 'on' : '', all[i] && !visible && fleetNeedsAttention(all[i]) ? 'attn' : ''].filter(Boolean).join(' ');
            return `<button data-i="${i}" class="${cls}">${n}</button>`;
        }).join('') +
        // 聯合艦隊＝1+2 同時檢視的捷徑。遊戲當下若真的組了連合艦隊
        // （state.combinedFlag: 1=機動/2=水上/3=輸送），按鈕文字改顯示對應部隊種類，
        // 讓使用者不用猜就知道現在是哪種連合；未組連合時維持通用「連合艦隊」字樣。
        `<button data-combined="1" class="${!showLbas && isCombinedView() ? 'on' : ''}" title="${esc(t('fleet.combinedTitle'))}">${state.combinedFlag ? t(`fleet.combinedType.${state.combinedFlag}`) : t('fleet.combined')}</button>` +
        `<span class="grow"></span><button data-lbas="1" class="${[showLbas ? 'on' : '', lbasNeedsAttention() ? 'attn' : ''].filter(Boolean).join(' ')}" ${state.airBases.size === 0 ? `title="${esc(t('lbas.selectAreaFirst'))}"` : ''}>${t('lbas.button')}</button>`;
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
function gearChip(g: NonNullable<ShipView['exGear']>, ex = false) {
    const title = `${esc(g.name)}${g.level ? ` ★${g.level}` : ''}${g.alv ? ` »${g.alv}` : ''}${g.count != null ? ` [${g.count}${g.countMax != null ? `/${g.countMax}` : ''}]` : ''}`;
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
    // 放在 .sub-row 內、.chips 容器之外：與裝備 chip 同一行、由 .chips 的 flex:1 推到最右。
    const supplyChip =
        `<span class="chip supply-combo" title="${esc(t('mat.fuel.full'))} ${fp}% ／ ${esc(t('mat.ammo.full'))} ${bp}%">` +
        `<span class="sup-fuel" style="background:linear-gradient(to right,#58a55c ${fp}%,transparent ${fp}%)">${fp}</span>` +
        `<span class="sup-ammo" style="background:linear-gradient(to left,#a8763e ${bp}%,transparent ${bp}%)">${bp}</span></span>`;
    const padCount = maxSlots - s.gears.length;
    const chips = realChips + blankChip('chip-pad').repeat(Math.max(0, padCount));
    return `<div class="ship ${st} ${marks?.cls ?? ''}">
      <div class="ship-row">
        <span class="grow">${s.stype ? `<span class="stype">${esc(s.stype)}</span>` : ''}${esc(s.name)}</span>${marks?.mark ?? ''}<span class="num">Lv${s.lv}</span>
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
    // 選單只在圖鑑載入後、且尚未建立時填充
    if (expedSel.options.length === 0) {
        const cat = state.expedCatalog();
        if (cat.length === 0) { expedCheckEl.innerHTML = `<div class="empty">${t('exped.masterNotLoaded')}</div>`; return; }
        let area = -1, html = '';
        for (const m of cat) {
            if (m.maparea !== area) {
                if (area !== -1) html += '</optgroup>';
                area = m.maparea;
                html += `<optgroup label="${esc(t('exped.area', { n: area }))}">`;
            }
            html += `<option value="${m.id}">[${esc(m.dispNo)}] ${esc(m.name)}</option>`;
        }
        expedSel.innerHTML = html + '</optgroup>';
        expedId = Number(expedSel.value);
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
    const resLine = rewards ? `
        <div class="dim">${t('exped.success')}　${t('mat.fuel')}${rewards.normal.fuel} ${t('mat.ammo')}${rewards.normal.bullet} ${t('mat.steel')}${rewards.normal.steel} ${t('mat.bauxite')}${rewards.normal.alum}　${successMark}</div>
        <div class="dim">${t('exped.greatSuccess')}　${t('mat.fuel')}${rewards.great.fuel} ${t('mat.ammo')}${rewards.great.bullet} ${t('mat.steel')}${rewards.great.steel} ${t('mat.bauxite')}${rewards.great.alum}
            <span style="color:var(--sparkle)">(×1.5)</span>　${gsMark}</div>
        ${rewards.items.length ? `<div class="dim">${t('exped.items')} ${rewards.items.map(it =>
        `${esc(it.name)}×${it.max}${it.guaranteed
            ? `<span style="color:var(--sparkle)">${t('exped.gsOnly')}</span>`
            : `<span style="color:var(--dim)">${t('exped.randomOnSuccess')}</span>`}`).join('　')}</div>` : ''}
    ` : '';
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
        const title = `${esc(g.name)}${g.level ? ` ★${g.level}` : ''}${g.alv ? ` »${g.alv}` : ''}${g.count != null ? ` [${g.count}${g.countMax != null ? `/${g.countMax}` : ''}]` : ''}`;
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
    return `<div class="ship c ${st} ${marks?.cls ?? ''}">
      <div class="c-top">
        <span class="stype">${esc(s.stype)}</span>
        <span class="grow" title="${esc(s.name)}">${esc(s.name)}</span>${marks?.mark ?? ''}
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
// 每欄自己只留隊名＋大破/未補給警示，數字統計不重複顯示——都在頂部合計列看。
function renderCombinedFleets() {
    const all = state.fleets();
    const sum = state.combinedSummary(cn);
    const totalHead = `<div class="fsummary combined-total">
        <span>${t('fleet.lvTotal')} <b>${sum.lvSum}</b></span>
        <span>${t('fleet.airPower')} <b>${sum.air.min === sum.air.max ? sum.air.min : `${sum.air.min}~${sum.air.max}`}</b></span>
        <span>${t('fleet.scouting33')} <b>${sum.f33.toFixed(2)}</b>
          <select class="cn">${[1, 2, 3, 4].map(x =>
        `<option value="${x}" ${x === cn ? 'selected' : ''}>×${x}</option>`).join('')}</select></span>
        <span><b>${sum.speed}</b></span>
        ${sum.tp.gear > 0 ? `<span title="${esc(t('fleet.transportTPTitle'))}">${t('fleet.transportTP')} <b>${sum.tp.total}</b></span>` : ''}
      </div>`;
    const cols = [0, 1].map(i => {
        const f = all[i];
        if (!f) return `<section class="fleet compact"><div class="empty">${t('common.empty')}</div></section>`;
        // 左右位置本身就是第1/第2艦隊，不需要再標一次隊名；只留大破/未補給這類
        // 需要提醒的警示（沒有警示時整列不佔版面）。
        const { rep, mor, badges: repairBadges } = repairPlansOf(f);
        const badges =
            (f.ships.some(s => s.maxhp && s.hp / s.maxhp <= 0.25) ? `<span class="badge-tag danger">${t('fleet.heavyDamage')}</span>` : '') +
            (f.ships.some(s => s.fuel < s.maxFuel || s.bull < s.maxBull) ? `<span class="badge-tag warn">${t('fleet.notResupplied')}</span>` : '') +
            repairBadges;
        const head = badges ? `<div class="fsummary compact col">${badges}</div>` : '';
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
        // 出擊/大破/未補給仍是有用的即時狀態，併入 fsummary 第一行。
        const { rep, mor, badges: repairBadges } = repairPlansOf(f);
        const badges =
            (f.mission ? `<span class="badge-tag mission">${t('fleet.onMission')}</span>` : '') +
            (f.ships.some(s => s.maxhp && s.hp / s.maxhp <= 0.25) ? `<span class="badge-tag danger">${t('fleet.heavyDamage')}</span>` : '') +
            (f.ships.some(s => s.fuel < s.maxFuel || s.bull < s.maxBull) ? `<span class="badge-tag warn">${t('fleet.notResupplied')}</span>` : '') +
            repairBadges;
        const summary = sum ? `<div class="fsummary">
            ${badges}
            <span>${t('fleet.lvTotal')} <b>${sum.lvSum}</b></span>
            <span>${t('fleet.airPower')} <b>${sum.air.min === sum.air.max ? sum.air.min : `${sum.air.min}~${sum.air.max}`}</b></span>
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
    html += `<h3 class="ab-area-label">${esc(state.mapAreaName(selectedLbasArea))}</h3>`;
    for (const ab of bases.filter(b => b.areaId === selectedLbasArea)) {
        const actCls = `act-${Math.min(ab.actionKind, 4)}`;
        const actLabel = state.actionLabel(ab.actionKind);
        const airStr = ab.airPower.min === ab.airPower.max
            ? `${ab.airPower.min}` : `${ab.airPower.min}~${ab.airPower.max}`;
        html += `<div class="ab-card">
          <div class="ab-header">
            <span class="ab-name">${esc(ab.name)}</span>
            <span class="grow"></span>
            <span class="ab-action ${actCls}">${actLabel}</span>
          </div>
          <div class="ab-stats">
            <span>${t('fleet.airPower')} <b>${airStr}</b></span>
            <span>${t('lbas.radius')} <b>${ab.distance}</b></span>
          </div>`;
        for (const sq of ab.squadrons) {
            if (sq.state !== 1) {
                html += `<div class="ab-sq empty-sq"><span class="sq-name">${t('lbas.notDeployed')}</span></div>`;
                continue;
            }
            const condCls = `cond-${Math.min(sq.cond, 3)}`;
            const depleted = sq.count < sq.maxCount;
            html += `<div class="ab-sq">
              <span class="sq-chip ${sq.cat}" title="${esc(sq.name)}${sq.level ? ` ★${sq.level}` : ''}${sq.alv ? ` »${sq.alv}` : ''}">${gearIconHtml(sq.icon, sq.short)}${sq.alv ? `<u>${alvMark(sq.alv)}</u>` : ''}${sq.level ? `<b>${impMark(sq.level)}</b>` : ''}</span>
              <span class="sq-name" title="${esc(sq.name)}">${esc(sq.name)}</span>
              <span class="sq-count ${depleted ? 'depleted' : ''}">${sq.count}/${sq.maxCount}</span>
              <span class="sq-cond ${condCls}">${state.condLabel(sq.cond)}</span>
            </div>`;
        }
        html += '</div>';
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
    if (showLbas) renderAirBases();
}
function getEdgeLetter(mapArea: number, mapNo: number, edgeId: number) {
    // 節點字母不在任何封包裡，只能透過 utils/map-node-letters.ts 查對照表。
    // **舊版的 `String.fromCharCode(64 + edgeId)` 已被真實資料否證**（61-5 實測 48=E、37=Q，
    // 既非 ASCII 推算也非編號排序），故查不到就顯示遊戲的 cell 編號，不再推算。
    return nodeLabel(`${mapArea}-${mapNo}`, edgeId);
}
function renderSortie() {
    if (tab !== 'sortie') return;
    const info = state.battleInfo;
    const sortie = state.sortieInfo;
    const sortieEl = document.getElementById('battle-content')!;
    if (!sortie) {
        sortieEl.innerHTML = `<div style="color:var(--dim); padding:10px;">${t('sortie.notEntered')}</div>`;
        return;
    }
    // 損失機數：>0 時以紅色 -N 顯示（例：-23）
    const planeLost = (lost: number) => lost > 0 ? `<span class="s-air-lost">-${lost}</span>` : '';
    let html = '<div class="sortie-container">';
    // 標題列：海域編號 + 節點軌跡 + 狀態，合併為一行省高度（#4）
    const mapStr = `${sortie.mapArea}-${sortie.mapNo}`;
    const lastNode = sortie.nodes[sortie.nodes.length - 1];
    const atBoss = !!lastNode && lastNode.color === 5;
    let nodeDots = '';
    for (const n of sortie.nodes) {
        const letter = getEdgeLetter(sortie.mapArea, sortie.mapNo, n.id);
        const isBoss = n.color === 5; // usually 5 is boss in KC
        nodeDots += `<div class="s-node visited ${isBoss ? 'boss' : ''}">${letter}</div>`;
    }
    // 關卡進度：已用真實 mapinfo 封包驗證兩種量表（見 state.ts MapGaugeView 註解）。
    // 無資料（尚未開過海域選擇畫面）時不顯示。
    const gauge = state.currentMapGauge();
    let gaugeHtml = '';
    if (gauge?.cleared) {
        // 已攻略關卡回應不再帶量表欄位，一律顯示已攻略勾號
        gaugeHtml = `<div class="s-gauge cleared" title="${esc(t('sortie.cleared'))}">✓</div>`;
    } else if (gauge?.gaugeType === 1 && gauge.requiredDefeatCount > 0) {
        // 擊破數式（一般圖5番/EO）：量表隨擊破遞減，顯示「剩餘擊破次數」
        // （與 gaugeType 2 boss型一致；先前顯示「已擊破數」會被誤讀為剩餘數）
        const remain = Math.max(0, gauge.requiredDefeatCount - gauge.defeatCount);
        const pct = Math.max(0, Math.min(100, Math.round(100 * remain / gauge.requiredDefeatCount)));
        // 剩最後 1 次 → 斬殺場提示（該次擊破即攻略）
        const zansatsu = remain === 1;
        const title = t('sortie.remainingHits', { n: remain, done: gauge.defeatCount, total: gauge.requiredDefeatCount });
        gaugeHtml = `<div class="s-gauge${zansatsu ? ' zansatsu' : ''}" title="${esc(title)}">
            <span class="s-gauge-bar"><i style="width:${pct}%"></i></span>
            <span class="s-gauge-num">${zansatsu ? t('sortie.zansatsuLabel') : t('sortie.remainingShort', { n: remain })}</span>
        </div>`;
    } else if ((gauge?.gaugeType === 2 || gauge?.gaugeType === 3) && gauge.maxHp > 0 && gauge.maxHp !== 9999) {
        // HP量表式(gaugeType 2, boss撃破)／TP輸送型(gaugeType 3)：可估剩餘次數
        const pct = Math.max(0, Math.min(100, Math.round(100 * gauge.nowHp / gauge.maxHp)));
        const r = state.mapRemainingRuns();
        const hint = r
            ? t('sortie.hintEstRuns', { n: r.runs, kind: r.kind === 'tp' ? t('sortie.kindLanding') : t('sortie.kindDefeat') })
            : gauge.gaugeType === 2 ? t('sortie.hintNeedBoss') : t('sortie.hintNoTP');
        // boss撃破型剩最後 1 次 → 斬殺場提示；TP輸送型不適用（仍顯示剩餘揚陸次數）
        const zansatsu = !!r && r.kind === 'boss' && r.runs === 1;
        const title = t('sortie.gaugeTitle', { now: gauge.nowHp, max: gauge.maxHp, hint });
        gaugeHtml = `<div class="s-gauge${zansatsu ? ' zansatsu' : ''}" title="${esc(title)}">
            <span class="s-gauge-bar"><i style="width:${pct}%"></i></span>
            ${r ? `<span class="s-gauge-num">${zansatsu ? t('sortie.zansatsuLabel') : t('sortie.remainingShort', { n: r.runs })}</span>` : ''}
        </div>`;
    } else if (gauge?.gaugeType === 2 && gauge.maxHp === 9999) {
        // maxHp=9999：尚未選擇難度的佔位值（已用兩份真實封包比對驗證），非真實100%
        gaugeHtml = `<div class="s-gauge locked" title="${esc(t('sortie.notChosenDifficulty'))}">🔒</div>`;
    } else if (gauge) {
        gaugeHtml = `<div class="s-gauge uncleared" title="${esc(t('sortie.uncleared'))}">－</div>`;
    }
    html += `
        <div class="s-header">
            <div class="s-map-id">${mapStr}</div>
            ${gaugeHtml}
            <div class="s-nodes">${nodeDots}</div>
            <div class="s-phase${atBoss ? ' active' : ''}">${atBoss ? t('sortie.boss') : t('sortie.advancing')}</div>
        </div>
    `;
    if (info) {
        if (info.isTaiha) {
            html += `<div class="taiha-alert">${t('sortie.taihaWarning')}</div>`;
        }
        // 敵方編成：晶片式兩欄（隨伴在左、主隊在右，對齊遊戲排版）。
        // 單艦隊無隨伴時，僅顯示主隊單欄、橫向填滿（不留一半空白）。
        const eMain = info.resultFleets?.enemyMain || [];
        const eEsc = info.resultFleets?.enemyEscort || [];
        const enemyChip = (s: typeof eMain[number], id: number) => {
            const r = s.maxHp > 0 ? Math.max(0, s.hp) / s.maxHp : 0;
            const pct = Math.round(r * 100);
            const col = r <= 0 ? 'transparent' : r <= 0.25 ? 'var(--dmg-major)'
                : r <= 0.5 ? 'var(--dmg-mid)' : r <= 0.75 ? 'var(--dmg-minor)' : '#58a55c';
            const name = id > 0 ? state.shipName(id) : '?';
            const sunk = s.hp <= 0;
            return `<div class="s-echip ${sunk ? 'sunk' : ''}" title="${esc(name)}">
                <span class="s-echip-name">${esc(name)}</span>
                <span class="s-echip-hp"><i style="width:${pct}%;background:${col}"></i></span>
            </div>`;
        };
        const colBody = (ships: typeof eMain, ids: number[]) =>
            `<div class="s-ecol-body">${ships.map((s, i) => enemyChip(s, ids[i] || 0)).join('')}</div>`;
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
                ${eEsc.length ? colBody(eEsc, info.enemyIdsEscort) : ''}
                ${colBody(eMain, info.enemyIds)}
            </div>
            <div class="s-eside">`;
        const engKeys = ['eng.unknown', 'eng.parallel', 'eng.opposite', 'eng.tAdvantage', 'eng.tDisadvantage'];
        const seikuKeys = ['seiku.even', 'seiku.secured', 'seiku.superior', 'seiku.inferior', 'seiku.lost'];
        const eng = t(engKeys[info.formation[2]] || 'eng.unknown');
        const seikuStr = seikuKeys[info.seiku] ? t(seikuKeys[info.seiku]) : t('sortie.none');
        const p = info.planes;
        html += `
                <div class="s-stats-mini">
                    <div class="s-stat-row"><span class="lbl">${t('sortie.detection')}</span><span class="val">${t('sortie.detectionOk')}</span></div>
                    <div class="s-stat-row"><span class="lbl">${t('sortie.heading')}</span><span class="val ${info.formation[2] === 4 ? 'bad' : ''}">${eng}</span></div>
                    <div class="s-stat-row"><span class="lbl">${t('sortie.contact')}</span><span class="val">${info.touchPlane[0] > 0 ? t('sortie.yes') : t('sortie.no')} vs ${info.touchPlane[1] > 0 ? t('sortie.yes') : t('sortie.no')}</span></div>
                    <div class="s-stat-row"><span class="lbl">${t('sortie.airBattle')}</span><span class="val ${info.seiku === 3 || info.seiku === 4 ? 'bad' : ''}">${seikuStr}</span></div>
                </div>
                <div class="s-air-mini">
                    <span></span><span class="hd">${t('sortie.ourSide')}</span><span class="hd">${t('sortie.enemySide')}</span>
                    <span class="rowlbl"><span class="s-air-icon" style="color:#51cf66;">${t('sortie.fighterAbbr')}</span></span>
                    <span>${p.playerFighter.count - p.playerFighter.lost}/${p.playerFighter.count}${planeLost(p.playerFighter.lost)}</span>
                    <span>${p.enemyFighter.count - p.enemyFighter.lost}/${p.enemyFighter.count}${planeLost(p.enemyFighter.lost)}</span>
                    <span class="rowlbl"><span class="s-air-icon" style="color:#ff6b6b;">${t('sortie.bomberAbbr')}</span></span>
                    <span>${p.playerBomber.count - p.playerBomber.lost}/${p.playerBomber.count}${planeLost(p.playerBomber.lost)}</span>
                    <span>${p.enemyBomber.count - p.enemyBomber.lost}/${p.enemyBomber.count}${planeLost(p.enemyBomber.lost)}</span>
                </div>
            </div>
        </div>`;

        // 陣形/支援/AACI/夜戰/rank/友軍 一列＋Drop：固定在敵艦晶片區下方，
        // 位置不隨敵艦數量位移（#2, #4）。
        const formationKeys = ['form.unknown', 'form.single', 'form.double', 'form.ring', 'form.ladder', 'form.abreast', 'form.vigilant'];
        const enFormShort = t(formationKeys[info.formation[1]] || 'form.unknown');
        const supp = info.supportFlag > 0 ? t('sortie.support') : t('sortie.none');
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
        // drop 為隨機，無法預測，僅結算後顯示實際掉落；用完整艦名 chip（#5）
        const dropChip = info.hasResult && info.drop
            ? `<div class="s-drop" title="${esc(t('sortie.dropTitle'))}"><span class="s-drop-tag">Drop</span><span class="s-drop-name">${esc(info.drop)}</span></div>`
            : '';
        html += `
            <div class="s-icons-full">
                <div class="s-icon-cluster">
                    <div class="s-icon" title="${esc(t('sortie.enemyFormationTitle'))}">${enFormShort}</div>
                    <div class="s-icon ${info.supportFlag > 0 ? 'active' : ''}" title="${esc(t('sortie.supportFleetTitle'))}">${supp}</div>
                    <div class="s-icon ${info.aaci > 0 ? 'active' : ''}" title="${esc(t('sortie.aaciTitlePrefix'))}: ${info.aaci}">${aaci}</div>
                    <div class="s-icon ${info.midnightFlag ? 'active' : ''}" title="${esc(t('sortie.midnightTitle'))}">${midn}</div>
                    <div class="s-icon ${rnkClass}${rankPredCls}" title="${esc(rankTitle)}">${rankStr}</div>
                    <div class="s-icon ${friendlyActive ? 'active' : ''}" title="${esc(friendlyTitle)}">${t('sortie.friendlyFleet')}</div>
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
async function renderWanted() {
    const rows = await db.wanted.orderBy('id').reverse().limit(30).toArray();
    wantedEl.innerHTML = rows.map(r => `
      <div class="wanted-row">
        <span class="wanted-tag">${esc(r.tag)}</span>
        <span class="grow wanted-path">${esc(r.path)}　${new Date(r.ts).toLocaleTimeString()}</span>
        <button data-copy="${r.eventId}">${t('wanted.copyJson')}</button>
      </div>`).join('') || `<div class="empty">${t('wanted.empty')}</div>`;
}
wantedEl.addEventListener('click', async e => {
    const btn = (e.target as HTMLElement).closest('button[data-copy]') as HTMLButtonElement | null;
    if (!btn) return;
    const row = await db.events.get(Number(btn.dataset.copy));
    if (!row) return;
    // 連 req 一起複製：部分端點（如 api_req_kousyou/remodel_slot）的請求欄位名
    // （api_slot_id/api_certain_flag 等）仍未驗證，只複製 api 回應會漏掉這些。
    // req 為空物件（GET 型或無表單資料）時仍照複製，維持格式一致。
    await navigator.clipboard.writeText(JSON.stringify({ req: row.req ?? {}, api: row.api }, null, 2));
    btn.textContent = t('wanted.copied'); btn.classList.add('copied');
    setTimeout(() => { btn.textContent = t('wanted.copyJson'); btn.classList.remove('copied'); }, 1500);
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
        if (path === 'api_port/port') autoSwitch('general', 'port');
        else if (path === 'api_req_map/start') autoSwitch('sortie', 'sortie');
        else if (path.startsWith('api_req_sortie/battle') || path.startsWith('api_req_combined_battle/') || path.startsWith('api_req_battle_midnight/')) autoSwitch('sortie', 'sortie');
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
        const tag = state.wantedTag(path, api);
        if (tag) db.wanted.add({ eventId: id, tag, ts, path }).then(renderWanted);
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
setInterval(() => {
    if (tab === 'general') renderGeneral();
    if (tab === 'factory') renderFactoryLive();   // 建造渠倒數
    tickRepairCountdowns();                       // 泊地修理/給糧倒數（艦隊區塊常駐顯示）
}, 1000);
// 事件消費採「單一有序佇列」：所有 live 事件 id 進 pending，由 pump() 逐一 await
// db.get 後 consume。這樣「啟動重播」與「即時訊息」不會交錯——否則即時訊息的
// db.get 可能在重播 drain 的 await 空檔先 resolve，搶先推高 maxId，害較早的事件
// 被 consume 的 `id<=maxId` 去重誤丟。pump 未 ready 時直接返回，live id 先積著等重播完。
let pumping = false;
let projectionFailed = false;
function stopAfterProjectionFailure(error: unknown) {
    projectionFailed = true;
    // 不在同一份已部分變更的 GameState 上繼續；raw event 仍在 db.events，重開 panel 可重建。
    console.error('[KC-Monitor] derived event projection failed; panel pump stopped', error);
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
            const r = await db.events.get(id);
            if (!r) {
                pending.shift();
                continue;
            }
            await consume(r.id!, r.ts, r.path, r.api, r.req);
            pending.shift();
        }
    } catch (error) {
        stopAfterProjectionFailure(error);
    } finally { pumping = false; }
}
browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'kc:live') return;
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
        ready = true;
        // 重播期間累積的 log 一次性補上（陣列已依時間順序，逐筆 prepend 使最新的在最上面）
        replayLogBuffer.forEach(({ ts, path }) => appendLogRow(ts, path));
        renderAll();      // 重播完成後才做第一次整頁渲染
        void renderWanted();   // 載入先前 session 已擷取的待驗證封包
        void pump();           // 處理啟動期間積在 pending 的 live 事件
    } catch (error) {
        stopAfterProjectionFailure(error);
    }
})();
