// 艦隊四隊＋基地航空隊全覽。從共用 GameState 讀當前母港狀態，渲染四艦隊與
// 基地航空隊，並可「複製／下載 Markdown」或「下載 PNG」（截圖）。
//
// 版面契約：
//   · 每艘艦一張卡，艦隊以橫向欄呈現；裝備逐列顯示完整名稱，欄寬不足時以 ellipsis 收束。
//     同一份 markup／CSS 同時支援不同寬度，無須另維護窄欄圖示版。
//   · 艦隊與基地航空隊的顯示範圍以 `<details>` 管理，控制項以 sticky 固定在捲動區頂端。
//   · 傳給 KanColleImgBuilder／制空権シミュレータ的範圍獨立於畫面顯示範圍；使用者在
//     `<dialog>` 中選取後才組 DeckBuilder JSON 開新分頁。艦隊代碼工具則只在本機整理
//     裝備與選定艦隊的 JSON，提供分項複製。
//   · 不繪製立繪，因為本擴充不處理遊戲美術資源；艦載機搭載數不佔此區欄寬，熟練度以
//     三段顏色與 `»` 表示，完整階級放在 title。出擊監控仍提供搭載實數。
//   · 艦欄使用 `flex: 0 1 var(--fo-col-w)` 靠左排列；滿編時才平均收縮，避免單艘艦時
//     資訊分散到整行兩端。
//   · 基地航空隊的顯示範圍以海域為單位，lbas 鍵使用 `String(areaId)`。封包只提供
//     maparea 層級的所屬資訊，不能可靠區分同一海域內的個別地圖；`rid` 不是全域鍵。
//
// Markdown／PNG 匯出仍直接吃畫面的顯示範圍 prefs（不跳選擇框）——這兩個是「複製/
// 下載現在看到的東西」，跟「傳去另一個網站」的心智模型不同，沒有必要每次都多問一次。
//
// 匯出設計：
//   · Markdown＝主要、最穩健的輸出（純文字，貼哪都行）。
//   · PNG＝把一份「內聯樣式、純文字（不含外部 <img>）」的匯出用 HTML 包進 SVG
//     foreignObject → canvas → PNG。刻意不含外部圖示：SVG 載入為圖片時處於安全模式、
//     不會載外部資源，含 <img> 會變空白；純文字＋內聯 CSS 則能穩定點陣化，不需任何權限。
//   · DeckBuilder（KanColleImgBuilder／制空権シミュレータ）：見 utils/deckbuilder.ts。
import type { OverviewSection } from './types';
import { airBaseKey } from '@/utils/state';
import type { GameState, FleetView, AirBaseView, ShipView, GearView, SquadronView } from '@/utils/state';
import { t } from '@/utils/ui-i18n';
import {
    AIR_ACTION_KEYS, airBaseAreaLabel, esc, downloadText, copyWithFeedback, fleetMarkdown, gearIconHtml, gearMarkdown,
    loadJsonPrefs, saveJsonPrefs, shipGearsMarkdown, type FleetMarkdownScope,
} from '../lib';
import {
    buildDeckBuilder, buildOwnedEquipmentCode, buildSelectedDeckBuilder, buildSelectedSupportDeckBuilder,
    imgBuilderUrl, airCalcUrl,
} from '@/utils/deckbuilder';

// ── 顯示範圍偏好（localStorage）──────────────────────────────
// lbas 偏好以海域 id 為鍵的表儲存；缺少海域資訊的舊格式無法安全轉換，故不套用其值，
// 以全部顯示作為安全預設。
const PREFS_KEY = 'kc-fleet-overview-view2';
// lbas：`String(海域 id)` → 是否顯示，**缺席＝顯示**。新開的活動海域基地會自動出現在
// 畫面上（不需要預先知道有幾個海域），這正是不能再用固定長度陣列的原因。
interface Prefs { fleets: boolean[]; lbas: Record<string, boolean> }

function loadPrefs(fleetCount: number): Prefs {
    const d: Prefs = { fleets: Array(fleetCount).fill(true), lbas: {} };
    return loadJsonPrefs(PREFS_KEY, d, raw => {
        if (!raw || typeof raw !== 'object') return d;
        const r = raw as { fleets?: unknown; lbas?: unknown };
        const lbas: Record<string, boolean> = {};
        if (r.lbas && typeof r.lbas === 'object' && !Array.isArray(r.lbas)) {
            // 只收 false（＝明確隱藏過的海域）：true 是預設值，存不存都一樣，
            // 而未知鍵一律當「顯示」才不會讓新海域的基地憑空消失。
            for (const [k, v] of Object.entries(r.lbas as Record<string, unknown>)) {
                if (v === false) lbas[k] = false;
            }
        }
        return {
            // 儲存長度與目前艦隊數不符（例如遠征解鎖了新艦隊格）時整組回退全 true，
            // 不強行對齊索引猜測。
            fleets: Array.isArray(r.fleets) && r.fleets.length === fleetCount
                ? r.fleets.map((v: unknown) => v !== false) : d.fleets,
            lbas,
        };
    });
}
const savePrefs = (p: Prefs) => { saveJsonPrefs(PREFS_KEY, p); };

// ── 裝備清單（screen 渲染共用）──────────────────────────────
// 縱向一格一行：圖示＋全名（ellipsis，title 補完整）＋改修★／熟練度符號靠右。欄寬夠時
// （艦隊裡船少、或基地卡）看得到全名，欄擠時（艦隊裡船多，見 shipCol）ellipsis 自然
// 截斷——同一份 markup 兩種寬度都對付得了，不必為窄欄另刻一份圖示版。
//
// **搭載數（艦載機格數）與熟練度數字刻意不顯示**：
// 這一區看的是「這艘船帶了什麼」，一行裡再塞 `18/18 »7` 會把裝備名的可用寬度吃掉
// （名稱是這裡最重要的欄位），故搭載數整個不畫、熟練度只留一個符號、數字退到 title。
// 面板（出擊監控）仍顯示搭載實數；兩區用途不同。
function alvMarkHtml(alv: number): string {
    if (alv <= 0) return '';
    // 遊戲內熟練度是 0-7 階的帶章；本專案不畫帶章，只用一個符號＋分三段的顏色表達
    // 「有／中／滿」，實際階級留在 title（使用者要求不顯示數字）。
    const tier = alv >= 7 ? 'hi' : alv >= 4 ? 'mid' : 'lo';
    return `<span class="fo-gear-alv ${tier}" title="${esc(t('ov.slAce'))} ${alv}">»</span>`;
}

function gearMarkHtml(level: number, alv: number): string {
    const star = level > 0 ? `<b class="fo-gear-mark">★${level}</b>` : '';
    return `${star}${alvMarkHtml(alv)}`;
}

function gearRow(g: GearView | null, extra = ''): string {
    if (!g) {
        return `<div class="fo-gear-row empty${extra}"><span class="g-icon-slot"></span><span class="fo-gear-name dim">${esc(t('ov.rsEmptySlot'))}</span></div>`;
    }
    const title = `${g.name}${g.level > 0 ? ` ★${g.level}` : ''}${g.alv > 0 ? ` ${t('ov.slAce')} ${g.alv}` : ''}`;
    return `<div class="fo-gear-row${extra}" title="${esc(title)}">${gearIconHtml(g.icon, g.short)}<span class="fo-gear-name">${esc(g.name)}</span>${gearMarkHtml(g.level, g.alv)}</div>`;
}

function squadronRow(sq: SquadronView): string {
    if (sq.state !== 1 || sq.icon <= 0) {
        return `<div class="fo-gear-row empty"><span class="g-icon-slot"></span><span class="fo-gear-name dim">${esc(t('ov.rsEmptySlot'))}</span></div>`;
    }
    const title = `${sq.name}${sq.level > 0 ? ` ★${sq.level}` : ''}${sq.alv > 0 ? ` ${t('ov.slAce')} ${sq.alv}` : ''}`;
    return `<div class="fo-gear-row" title="${esc(title)}">${gearIconHtml(sq.icon, sq.short)}<span class="fo-gear-name">${esc(sq.name)}</span>${gearMarkHtml(sq.level, sq.alv)}</div>`;
}

// ── 螢幕渲染 ──────────────────────────────────────────────
// 一艘船一欄（非一整行）：`.fo-ship-row` 用 flex 橫向排開，本函式只負責單欄內容，
// 常駐攤開，讓裝備名稱與狀態可直接掃讀。
//
// 卡片內的三段（艦名／艦種＋Lv／運＋HP＋士氣）保持固定層次。艦名獨佔一列，故不與艦種擠同一行——擠在
// 一起時長艦名（Гангут два／天霧改二丁）會被艦種欄壓成一半寬度。**立繪刻意不畫**：
// 本擴充不碰遊戲美術資源（設計原則：被動擷取、不代發請求），使用者已確認可接受。
function shipCol(s: ShipView): string {
    const gears = s.gears.map(g => gearRow(g)).join('');
    // exEmpty（api_slot_ex===-1）＝有孔未裝，仍要畫空框；exGear/exEmpty 皆無＝無孔，
    // 整格不畫（同 ships.ts gearsCell 的判準）。
    const ex = s.exGear ? gearRow(s.exGear, ' ex')
        : s.exEmpty ? `<div class="fo-gear-row ex empty"><span class="g-icon-slot"></span><span class="fo-gear-name dim">${esc(t('ov.shipsExEquipment'))}</span></div>`
            : '';
    const hpPct = s.maxhp > 0 ? s.hp / s.maxhp : 1;
    const hpCls = s.inDock ? 'dock' : hpPct <= 0.25 ? 'taiha' : hpPct <= 0.5 ? 'chuha' : hpPct < 1 ? 'shouha' : '';
    const condCls = s.cond >= 50 ? 'fo-sparkle' : s.cond <= 19 ? 'fo-heavy' : s.cond <= 29 ? 'fo-tired' : '';
    const dock = s.inDock ? `<span class="fo-dock" title="${esc(t('fleet.inDockTitle'))}">${esc(t('fleet.inDock'))}</span>` : '';
    return `<div class="fo-ship-col">
        <div class="fo-ship-name" title="${esc(s.nameJa && s.nameJa !== s.name ? `${s.name}（${s.nameJa}）` : s.name)}">${esc(s.name)}</div>
        <div class="fo-ship-head">
            <span class="fo-stype">${esc(s.stype)}</span>
            <span class="fo-lv">Lv. ${s.lv}</span>
        </div>
        <div class="fo-ship-stats">
            <span class="fo-luck"><i>${esc(t('ov.rsColLuck'))}</i> ${s.luck}</span>
            <span class="fo-hp ${hpCls}" title="${esc(t('ov.rsColHp'))}">${s.hp}/${s.maxhp}</span>
            ${dock}
            <span class="fo-cond ${condCls}"><i>${esc(t('ov.rsColCond'))}</i> ${s.cond}</span>
        </div>
        <div class="fo-gear-list">${gears}${ex}</div>
    </div>`;
}

/** 艦隊列頂端的合計徽章資料＝`GameState.fleetSummary()` 的回傳（null＝該隊不存在）。 */
export type FleetHeadSummary = NonNullable<ReturnType<GameState['fleetSummary']>>;

// 艦隊標題列的合計徽章（Lv／制空／索敵／速力／TP／火力）。**火力合計在這裡自己加**，
// 不進 fleetSummary()——那支是面板出擊監控的合約（Lv/制空/索敵/速力/TP），火力只有這一
// 區的參照版面要用，且它就是逐艦 api_karyoku[0] 的純加總，沒有排除/修正規則要共用。
// 退避艦一律排除，與 fleetSummary() 內其餘各項同一條規則（見 escapedShipIds）。
function headBadges(f: FleetView, sum: FleetHeadSummary | null): string {
    const firepower = f.ships.reduce((n, s) => n + (s.escaped ? 0 : s.firepower), 0);
    const badge = (label: string, value: string, opts: { title?: string; est?: boolean } = {}) =>
        `<span class="fo-badge"${opts.title ? ` title="${esc(opts.title)}"` : ''}>${esc(label)} <b${opts.est ? ' class="est"' : ''}>${esc(value)}</b></span>`;
    const air = sum ? (sum.air.min === sum.air.max ? `${sum.air.min}` : `${sum.air.min}~${sum.air.max}`) : '';
    return `<div class="fo-badges">
        ${sum ? badge(t('fleet.lvTotal'), String(sum.lvSum)) : ''}
        ${sum ? badge(t('fleet.scouting33'), sum.f33.toFixed(1)) : ''}
        ${sum ? badge(t('fleet.airPower'), air, { est: sum.airStale, title: sum.airStale ? t('fleet.airPowerStaleTitle') : undefined }) : ''}
        ${sum && sum.tp.gear > 0 ? badge(t('fleet.transportTP'), String(sum.tp.total), { title: t('fleet.transportTPTitle') }) : ''}
        ${sum ? `<span class="fo-badge"><b>${esc(sum.speed)}</b></span>` : ''}
        ${badge(t('ov.rsColFire'), String(firepower))}
    </div>`;
}

// export：離線版面預覽（tools/preview/fleet-overview.ts）直接呼叫，與 render() 共用
// 同一份 markup，不另抄一份（同 sortie-log.ts 的 shellHtml/headHtml/detailHtml 作法）。
// sum 由呼叫端傳 `state.fleetSummary(i, cn)`（本函式維持不吃 GameState 的純函式形狀，
// 同 baseHtml 的 areaName）；傳 null 時只是不畫合計徽章，艦卡照常。
export function fleetHtml(f: FleetView, idx: number, sum: FleetHeadSummary | null = null): string {
    if (!f.ships.length) return '';
    return `<section class="fo-fleet">
        <h3>${esc(t('ov.fleetN', { n: idx + 1 }))}　${esc(f.name)}${f.mission ? ` <span class="dim">${esc(t('ov.onMission'))}</span>` : ''}</h3>
        ${headBadges(f, sum)}
        <div class="fo-ship-row">${f.ships.map(shipCol).join('')}</div>
    </section>`;
}

// areaName：呼叫端傳入 state.mapAreaName(b.areaId)——這裡不吃 GameState，維持
// baseHtml() 只需要它接收到的資料就能畫的純函式形狀。
export function baseHtml(b: AirBaseView, areaName: string): string {
    return `<section class="fo-fleet">
        <h3>${esc(b.name)}　<span class="fo-area">${esc(areaName)}</span></h3>
        <div class="fo-lbas-head">
            <span>${esc(t(AIR_ACTION_KEYS[b.actionKind] ?? 'lbas.standby'))}</span>
            <span>${esc(t('ov.airRadius', { n: b.distance }))}</span>
            <span>${esc(t('ov.airPower', { min: b.airPower.min, max: b.airPower.max }))}</span>
        </div>
        <div class="fo-gear-list">${b.squadrons.map(squadronRow).join('')}</div>
    </section>`;
}

// ── Markdown 匯出 ─────────────────────────────────────
// 艦隊＋基地航空隊本體共用 lib.ts 的 fleetMarkdown()（llm.ts 的完整報告匯出也靠它組裝，
// 兩處輸出格式保證一致；那邊不傳 scope＝一律全含，不受這個分區的顯示開關影響）。
//
// **不放提督資訊**（暱稱／司令部 Lv）：這份輸出是拿去貼給別人看編成的，提督暱稱是
// 個人識別資訊，貼出去就散出去了，而它對「這隊帶了什麼」毫無幫助。PNG 匯出仍保留
// 標題列——那是自己留存的截圖用途，使用者要的是這一份純文字不帶身分。
function buildMarkdown(state: GameState, scope: FleetMarkdownScope): string {
    return fleetMarkdown(state, '##', scope);
}

// ── PNG 匯出（內聯樣式、純文字，穩定點陣化）────────────────
// 裝備寫法共用 lib.ts 的 gearMarkdown()（同 Markdown 匯出）：★10 只給星號、熟練度接
// 符號。Markdown 與 PNG 匯出共用同一份純文字格式，確保同一支艦隊的輸出一致。
function buildExportHtml(state: GameState, scope: FleetMarkdownScope): { html: string; height: number } {
    const rows: string[] = [];
    const line = (txt: string, bold = false, indent = 0) =>
        `<div style="margin:${bold ? '10px 0 2px' : '1px 0'};padding-left:${indent}px;font-weight:${bold ? 700 : 400};color:${bold ? '#e6c35c' : '#cfd6e4'}">${esc(txt)}</div>`;
    rows.push(line(`${state.nickname || '???'}　Lv${state.hqLv}`, true));
    state.fleets().forEach((f, i) => {
        if (!f.ships.length || !scope.fleets[i]) return;
        rows.push(line(`${t('ov.fleetN', { n: i + 1 })} — ${f.name}`, true));
        for (const s of f.ships) {
            const gears = shipGearsMarkdown(s);
            rows.push(line(`${s.stype} ${s.name}  Lv${s.lv}  HP${s.hp}/${s.maxhp}  ${gears}`, false, 12));
        }
    });
    for (const b of state.airBases_()) {
        if (scope.lbas[b.rid - 1] === false) continue;
        rows.push(line(`${b.name}（${state.mapAreaName(b.areaId)}）  ${t('ov.airPower', { min: b.airPower.min, max: b.airPower.max })}`, true));
        rows.push(line(b.squadrons.map(gearMarkdown).join(' / '), false, 12));
    }
    const height = 40 + rows.length * 20;
    const html = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:760px;padding:16px;box-sizing:border-box;background:#10151d;font:13px/1.5 sans-serif">${rows.join('')}</div>`;
    return { html, height };
}

function downloadPng(state: GameState, scope: FleetMarkdownScope) {
    const { html, height } = buildExportHtml(state, scope);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 760; canvas.height = height;
        const cx = canvas.getContext('2d')!;
        cx.drawImage(img, 0, 0);
        canvas.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `fleet-${Date.now()}.png`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const fleetOverviewSection: OverviewSection = {
    id: 'fleet-overview',
    titleKey: 'ov.fleetOverview',
    render(el, ctx) {
        const state = ctx.state;
        const fleetsAll = state.fleets();
        const basesAll = state.airBases_();
        // 艦隊空船但已有基地航空隊時仍要顯示／匯出，不能當「無資料」。
        const hasData = fleetsAll.some(f => f.ships.length) || basesAll.length > 0;
        if (!hasData) { el.innerHTML = `<div class="ov-empty">${esc(t('ov.fleetOverviewNone'))}</div>`; return; }
        const prefs = loadPrefs(fleetsAll.length);
        // 基地航空隊**以海域為單位**開關：一個海域最多
        // 三個基地、平常整組一起看，逐基地一顆 checkbox 只是讓那排 chip 更長。海域名在
        // 這裡查一次快取起來（chip 列與基地卡各要用一次，避免兩處算出不一致的字串）。
        const areaIds = [...new Set(basesAll.map(b => b.areaId))].sort((a, b) => a - b);
        const areaLabels = new Map(areaIds.map(id => [id, airBaseAreaLabel(state, id)]));
        const areaCounts = new Map(areaIds.map(id => [id, basesAll.filter(b => b.areaId === id).length]));
        const lbasShown = (b: AirBaseView) => prefs.lbas[String(b.areaId)] !== false;
        const existingFleets = fleetsAll.filter(f => f.ships.length).length;
        const codeFleets = fleetsAll
            .map((fleet, index) => ({ fleet, fleetNo: index + 1 }))
            .filter(({ fleet }) => fleet.ships.length > 0);
        const codeAirBases = basesAll.filter(base => base.squadrons.some(squadron => squadron.state === 1 && squadron.mst > 0));

        // 摺疊起來的「顯示範圍」summary：不展開也看得出目前篩著什麼（同 ships.ts
        // 「生效條件 chip 列常駐」的精神），不然摺起來就變成一個看不出內容的黑盒子。
        function scopeHint(): string {
            const shownFleets = fleetsAll.filter((f, i) => f.ships.length && prefs.fleets[i]).length;
            const shownBases = basesAll.filter(lbasShown).length;
            const hidden = (existingFleets - shownFleets) + (basesAll.length - shownBases);
            return hidden > 0 ? t('ov.fleetOverviewHiddenN', { n: hidden }) : t('ov.fleetOverviewAllShown');
        }

        // 顯示範圍 chip 列的 markup 被畫面本身與匯出選擇 dialog 共用同一種形狀
        // （只有 checkbox 預設勾選狀態不同），抽成函式避免兩處各寫一份還兜不齊。
        const scopeChips = (fleetChecked: (i: number) => boolean, areaChecked: (areaId: number) => boolean) => `
            ${fleetsAll.map((f, i) => f.ships.length
            ? `<label class="eo-chip${fleetChecked(i) ? ' on' : ''}" data-fleet="${i}"><input type="checkbox" ${fleetChecked(i) ? 'checked' : ''}>${esc(t('ov.fleetN', { n: i + 1 }))}</label>`
            : '').join('')}
            ${areaIds.map(id => `<label class="eo-chip${areaChecked(id) ? ' on' : ''}" data-lbas-area="${id}"><input type="checkbox" ${areaChecked(id) ? 'checked' : ''}>${esc(areaLabels.get(id) ?? '')}<span class="fo-area">×${areaCounts.get(id) ?? 0}</span></label>`).join('')}`;

        el.innerHTML = `
            <div class="ov-toolbar">
                <button class="ov-btn" id="fo-md-copy">${esc(t('ov.copyMarkdown'))}</button>
                <button class="ov-btn" id="fo-md-dl">${esc(t('ov.downloadMarkdown'))}</button>
                <button class="ov-btn" id="fo-png">${esc(t('ov.downloadPng'))}</button>
                <button class="ov-btn" id="fo-imgbuilder">${esc(t('ov.exportImgBuilder'))}</button>
                <button class="ov-btn" id="fo-aircalc">${esc(t('ov.exportAirCalc'))}</button>
                <button class="ov-btn" id="fo-fleet-codes">${esc(t('ov.fleetCodesButton'))}</button>
            </div>
            <p class="fo-note">${esc(t('ov.exportExternalNote'))}</p>
            <details class="fo-scope">
                <summary>
                    <span class="fo-scope-label">${esc(t('ov.fleetOverviewScope'))}</span>
                    <span class="fo-scope-hint">${esc(scopeHint())}</span>
                </summary>
                <div class="fo-scope-body">${scopeChips(i => prefs.fleets[i], id => prefs.lbas[String(id)] !== false)}</div>
            </details>
            <div class="fo-body"></div>
            <dialog class="fo-export-dialog">
                <form method="dialog" class="fo-export-form">
                    <p class="fo-export-title">${esc(t('ov.fleetOverviewExportPick'))}</p>
                    <div class="fo-export-choices"></div>
                    <div class="fo-export-actions">
                        <button type="button" class="ov-btn" data-export-cancel>${esc(t('ov.fleetOverviewExportCancel'))}</button>
                        <button type="submit" class="ov-btn" data-export-go>${esc(t('ov.fleetOverviewExportGo'))}</button>
                    </div>
                </form>
            </dialog>
            <dialog class="fo-code-dialog">
                <form method="dialog" class="fo-code-form">
                    <h2 class="fo-code-title">${esc(t('ov.fleetCodesTitle'))}</h2>
                    <p class="fo-code-intro">${esc(t('ov.fleetCodesIntro'))}</p>
                    <section class="fo-code-section">
                        <h3>${esc(t('ov.fleetCodesOwnedTitle'))}</h3>
                        <p>${esc(t('ov.fleetCodesOwnedHint'))}</p>
                        <textarea class="fo-code-output" data-fleet-code="owned" readonly spellcheck="false" aria-label="${esc(t('ov.fleetCodesOwnedTitle'))}"></textarea>
                        <p class="fo-code-error" data-fleet-code-error="owned" role="alert" hidden></p>
                        <button type="button" class="ov-btn" data-copy-fleet-code="owned">${esc(t('ov.fleetCodesCopyOwned'))}</button>
                    </section>
                    <section class="fo-code-section">
                        <h3>${esc(t('ov.fleetCodesSortieTitle'))}</h3>
                        <p>${esc(t('ov.fleetCodesFleetHint'))}</p>
                        <div class="fo-code-fleet-choices" data-fleet-code-choices="sortie">
                            ${codeFleets.map(({ fleet, fleetNo }) => `<label class="fo-code-fleet-choice">
                                <input type="checkbox" data-fleet-code-selection="sortie" data-fleet-no="${fleetNo}">
                                <span>${esc(t('ov.fleetN', { n: fleetNo }))} — ${esc(fleet.name)} <span class="fo-area">×${fleet.ships.length}</span></span>
                            </label>`).join('')}
                        </div>
                        ${codeAirBases.length ? `
                        <p class="fo-code-subtitle">${esc(t('ov.fleetCodesAirBaseTitle'))}</p>
                        <p>${esc(t('ov.fleetCodesAirBaseHint'))}</p>
                        <div class="fo-code-fleet-choices" data-fleet-code-air-base-choices="sortie">
                            ${codeAirBases.map(base => `<label class="fo-code-fleet-choice fo-code-air-base-choice">
                                <input type="checkbox" data-fleet-code-air-base-selection="sortie" data-air-base-key="${esc(airBaseKey(base))}">
                                <span>${esc(t('ov.fleetCodesAirBaseChoice', {
                                    name: base.name,
                                    area: areaLabels.get(base.areaId) ?? '',
                                    rid: base.rid,
                                }))}</span>
                            </label>`).join('')}
                        </div>` : ''}
                        <textarea class="fo-code-output" data-fleet-code="sortie" readonly spellcheck="false" aria-label="${esc(t('ov.fleetCodesSortieTitle'))}"></textarea>
                        <p class="fo-code-error" data-fleet-code-error="sortie" role="alert" hidden></p>
                        <button type="button" class="ov-btn" data-copy-fleet-code="sortie">${esc(t('ov.fleetCodesCopySortie'))}</button>
                    </section>
                    <section class="fo-code-section">
                        <h3>${esc(t('ov.fleetCodesSupportTitle'))}</h3>
                        <p>${esc(t('ov.fleetCodesSupportHint'))}</p>
                        <div class="fo-code-fleet-choices" data-fleet-code-choices="support">
                            ${codeFleets.map(({ fleet, fleetNo }) => `<label class="fo-code-fleet-choice">
                                <input type="checkbox" data-fleet-code-selection="support" data-fleet-no="${fleetNo}">
                                <span>${esc(t('ov.fleetN', { n: fleetNo }))} — ${esc(fleet.name)} <span class="fo-area">×${fleet.ships.length}</span></span>
                            </label>`).join('')}
                        </div>
                        <textarea class="fo-code-output" data-fleet-code="support" readonly spellcheck="false" aria-label="${esc(t('ov.fleetCodesSupportTitle'))}"></textarea>
                        <p class="fo-code-error" data-fleet-code-error="support" role="alert" hidden></p>
                        <button type="button" class="ov-btn" data-copy-fleet-code="support">${esc(t('ov.fleetCodesCopySupport'))}</button>
                    </section>
                    <div class="fo-code-actions">
                        <button type="button" class="ov-btn" data-fleet-codes-close>${esc(t('ov.fleetCodesClose'))}</button>
                    </div>
                </form>
            </dialog>`;

        const bodyEl = el.querySelector<HTMLDivElement>('.fo-body')!;
        const scopeEl = el.querySelector<HTMLDivElement>('.fo-scope')!;
        const scopeHintEl = el.querySelector<HTMLSpanElement>('.fo-scope-hint')!;

        function renderBody() {
            const fleets = fleetsAll.filter((f, i) => f.ships.length && prefs.fleets[i]);
            const bases = basesAll.filter(lbasShown);
            if (!fleets.length && !bases.length) {
                bodyEl.innerHTML = `<div class="ov-empty">${esc(t('ov.fleetOverviewAllHidden'))}</div>`;
                return;
            }
            bodyEl.innerHTML = `
                <div class="fo-fleets">${fleetsAll.map((f, i) => (f.ships.length && prefs.fleets[i]) ? fleetHtml(f, i, state.fleetSummary(i, 1)) : '').join('')}</div>
                ${bases.length ? `<div class="fo-lbas-row">${bases.map(b => baseHtml(b, areaLabels.get(b.areaId) ?? '')).join('')}</div>` : ''}`;
        }
        renderBody();

        // 開關同時決定畫面顯示與 Markdown／PNG 匯出範圍（見檔頭註解），故只需維護
        // prefs 一份狀態；傳去外部工具的範圍是 dialog 自己單獨一份，不共用這裡。
        scopeEl.addEventListener('change', e => {
            const box = (e.target as HTMLElement).closest('input[type=checkbox]') as HTMLInputElement | null;
            if (!box) return;
            const chip = box.closest('.eo-chip') as HTMLElement;
            chip.classList.toggle('on', box.checked);
            const fi = chip.dataset.fleet;
            const area = chip.dataset.lbasArea;
            if (fi !== undefined) prefs.fleets[Number(fi)] = box.checked;
            else if (area !== undefined) prefs.lbas[area] = box.checked;
            savePrefs(prefs);
            scopeHintEl.textContent = scopeHint();
            renderBody();
        });

        const scope = (): FleetMarkdownScope => ({ fleets: prefs.fleets, lbas: prefs.lbas });
        el.querySelector<HTMLButtonElement>('#fo-md-copy')!.addEventListener('click', e =>
            copyWithFeedback(e.currentTarget as HTMLButtonElement, buildMarkdown(state, scope()), t('ov.copied')));
        el.querySelector('#fo-md-dl')!.addEventListener('click', () =>
            downloadText(`fleet-${Date.now()}.md`, buildMarkdown(state, scope()), 'text/markdown'));
        el.querySelector('#fo-png')!.addEventListener('click', () => downloadPng(state, scope()));

        // ── 傳去外部工具前先選範圍 ──
        // dialog 裡的 checkbox 是獨立一份、預設帶入目前畫面顯示範圍當起點，勾選只
        // 影響這次傳送，不寫回 prefs／不影響畫面。
        const dialogEl = el.querySelector<HTMLDialogElement>('.fo-export-dialog')!;
        const choicesEl = dialogEl.querySelector<HTMLDivElement>('.fo-export-choices')!;
        let exportTarget: 'imgbuilder' | 'aircalc' = 'imgbuilder';

        function openExportDialog(target: 'imgbuilder' | 'aircalc') {
            exportTarget = target;
            choicesEl.innerHTML = scopeChips(i => prefs.fleets[i], id => prefs.lbas[String(id)] !== false);
            dialogEl.showModal();
        }
        choicesEl.addEventListener('change', e => {
            const box = (e.target as HTMLElement).closest('input[type=checkbox]') as HTMLInputElement | null;
            box?.closest('.eo-chip')?.classList.toggle('on', box.checked);
        });
        dialogEl.querySelector('[data-export-cancel]')!.addEventListener('click', () => dialogEl.close());
        dialogEl.querySelector('.fo-export-form')!.addEventListener('submit', e => {
            e.preventDefault();
            const exportScope: FleetMarkdownScope = {
                fleets: fleetsAll.map((_, i) =>
                    choicesEl.querySelector<HTMLInputElement>(`[data-fleet="${i}"] input`)?.checked ?? false),
                lbas: Object.fromEntries(areaIds.map(id => [String(id),
                    choicesEl.querySelector<HTMLInputElement>(`[data-lbas-area="${id}"] input`)?.checked ?? false])),
            };
            // DeckBuilder 格式（見 utils/deckbuilder.ts 檔頭）：只送艦娘/裝備代號等純數字，
            // 不碰任何遊戲圖片，交給外部工具自己決定要不要用官方美術呈現。
            const deck = buildDeckBuilder(state, exportScope);
            const url = exportTarget === 'imgbuilder' ? imgBuilderUrl(deck) : airCalcUrl(deck);
            window.open(url, '_blank', 'noopener');
            dialogEl.close();
        });
        el.querySelector('#fo-imgbuilder')!.addEventListener('click', () => openExportDialog('imgbuilder'));
        el.querySelector('#fo-aircalc')!.addEventListener('click', () => openExportDialog('aircalc'));

        // ── 本機代碼複製 ──
        const codeDialog = el.querySelector<HTMLDialogElement>('.fo-code-dialog')!;
        const codeGroups = ['sortie', 'support'] as const;
        type CodeGroup = (typeof codeGroups)[number];

        function selectedFleetNos(group: CodeGroup): number[] {
            return [...codeDialog.querySelectorAll<HTMLInputElement>(
                `input[data-fleet-code-selection="${group}"]:checked`,
            )]
                .map(input => Number(input.dataset.fleetNo))
                .filter(Number.isSafeInteger);
        }

        function selectedAirBaseKeys(): string[] {
            return [...codeDialog.querySelectorAll<HTMLInputElement>(
                'input[data-fleet-code-air-base-selection="sortie"]:checked',
            )]
                .map(input => input.dataset.airBaseKey ?? '')
                .filter(Boolean);
        }

        function refreshCode(group: CodeGroup): void {
            const output = codeDialog.querySelector<HTMLTextAreaElement>(`textarea[data-fleet-code="${group}"]`)!;
            const error = codeDialog.querySelector<HTMLElement>(`[data-fleet-code-error="${group}"]`)!;
            const copy = codeDialog.querySelector<HTMLButtonElement>(`[data-copy-fleet-code="${group}"]`)!;
            const fleetNos = selectedFleetNos(group);
            const airBaseKeys = group === 'sortie' ? selectedAirBaseKeys() : [];
            if (fleetNos.length === 0) {
                output.value = '';
                error.hidden = false;
                error.textContent = t('ov.fleetCodesNeedFleet');
                copy.disabled = true;
                return;
            }
            if (airBaseKeys.length > 3) {
                output.value = '';
                error.hidden = false;
                error.textContent = t('ov.fleetCodesTooManyAirBases');
                copy.disabled = true;
                return;
            }
            try {
                const deck = group === 'support'
                    ? buildSelectedSupportDeckBuilder(state, fleetNos)
                    : buildSelectedDeckBuilder(state, fleetNos, airBaseKeys);
                output.value = JSON.stringify(deck, null, 2);
                error.hidden = true;
                error.textContent = '';
                copy.disabled = false;
            } catch (cause) {
                output.value = '';
                error.hidden = false;
                error.textContent = t('ov.fleetCodesInvalid');
                copy.disabled = true;
                console.warn('[KC-Monitor] 艦隊代碼整理失敗', cause);
            }
        }

        function refreshOwnedCode(): void {
            const output = codeDialog.querySelector<HTMLTextAreaElement>('textarea[data-fleet-code="owned"]')!;
            const error = codeDialog.querySelector<HTMLElement>('[data-fleet-code-error="owned"]')!;
            const copy = codeDialog.querySelector<HTMLButtonElement>('[data-copy-fleet-code="owned"]')!;
            try {
                output.value = buildOwnedEquipmentCode(state);
                error.hidden = true;
                error.textContent = '';
                copy.disabled = false;
            } catch (cause) {
                output.value = '';
                error.hidden = false;
                error.textContent = t('ov.fleetCodesInvalid');
                copy.disabled = true;
                console.warn('[KC-Monitor] 所持裝備代碼整理失敗', cause);
            }
        }

        codeDialog.querySelectorAll<HTMLInputElement>(
            'input[data-fleet-code-selection], input[data-fleet-code-air-base-selection]',
        ).forEach(input => {
            input.addEventListener('change', () => refreshCode(
                (input.dataset.fleetCodeSelection ?? input.dataset.fleetCodeAirBaseSelection) as CodeGroup,
            ));
        });
        codeDialog.querySelectorAll<HTMLButtonElement>('[data-copy-fleet-code]').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.copyFleetCode;
                const output = codeDialog.querySelector<HTMLTextAreaElement>(`textarea[data-fleet-code="${key}"]`);
                if (output?.value) void copyWithFeedback(button, output.value, t('ov.fleetCodesCopied'));
            });
        });
        codeDialog.querySelector('[data-fleet-codes-close]')!.addEventListener('click', () => codeDialog.close());
        el.querySelector<HTMLButtonElement>('#fo-fleet-codes')!.addEventListener('click', () => {
            refreshOwnedCode();
            codeGroups.forEach(refreshCode);
            codeDialog.showModal();
        });
    },
};
