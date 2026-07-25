// 艦隊四隊＋基地航空隊全覽（#4）。從共用 GameState 讀當前母港狀態，渲染四艦隊與
// 基地航空隊，並可「複製／下載 Markdown」或「下載 PNG」（截圖）。
//
// 版面修正記錄（別走回頭路）：
//   1. 艦艇列先前做成「主資訊＋裝備一路橫向 wrap 的 pill」，使用者回報「有點太亂」——
//      改成縱向一格一行的裝備清單（icon＋全名＋改修/熟練/搭載數），對齊
//      samples/Fleet_formation.png 的清晰度。
//   2. 縱向清單第一版讓每艘船摺疊（`<details>`）省高度，但使用者接著回報「還是浪費
//      太多空間」——問題不是清單本身，是**版面沒用到寬度**：艦隊卡先前是窄欄縱向堆
//      六艘船，瀏覽器明明有 800px 寬只用了 300 多。改法：**一艘船一欄，一整隊一整行
//      橫向排開**（`.fo-ship-row` flex），欄寬用 `flex:1 1 0` 平分——不滿 6/7 艘時
//      每艘自動撐滿整行寬度，7 艘（遊擊部隊）都排得下就不留白。裝備清單**不再折疊**
//      （常駐攤開），欄寬夠時看得到全名，欄擠時 `.fo-gear-name` 的 ellipsis 自然
//      截斷——同一份 markup／CSS 兩種寬度都對付得了，不必為窄欄另刻一份圖示版。
//   3. 基地航空隊卡欄寬同理收窄（`.fo-lbas-row` minmax 240px），目標 820px 內容寬時
//      三隊排一行；量體遠小於艦隊（最多 4 中隊 vs 六艘船各五六格裝備），維持常駐攤開、
//      不比照艦隊做橫向多欄。
//   4. 「顯示範圍」（哪些艦隊/基地要顯示）用 `<details>` 摺疊起來，摺疊時的 summary
//      顯示「已隱藏 N 項」（同 ships.ts「生效條件 chip 列常駐」的精神）。
//   5. 傳給 KanColleImgBuilder／制空権シミュレータ的範圍**獨立於畫面顯示範圍**——
//      使用者要求「先自選哪些編成跟基地航空隊」再送出，故兩顆按鈕改成先跳一個
//      `<dialog>` 讓你單次勾選（預設帶入目前畫面的顯示範圍當起點，不影響畫面本身的
//      顯示範圍設定），確定才組 DeckBuilder JSON 開新分頁。
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
import type { GameState, FleetView, AirBaseView, ShipView, GearView, SquadronView } from '@/utils/state';
import { t } from '@/utils/ui-i18n';
import { esc, downloadText, copyWithFeedback, fleetMarkdown, gearIconHtml, type FleetMarkdownScope } from '../lib';
import { buildDeckBuilder, imgBuilderUrl, airCalcUrl } from '@/utils/deckbuilder';

const AIR_ACTION_KEYS = ['lbas.standby', 'lbas.sortie', 'lbas.airDefense', 'lbas.retreat', 'lbas.rest'];

// ── 顯示範圍偏好（localStorage）──────────────────────────────
const PREFS_KEY = 'kc-fleet-overview-view';
// lbas 固定長度 3、索引＝rid-1（第幾個基地，1-3）。不能用「目前有幾個基地」動態決定
// 長度或用陣列位置當索引，見檔頭註解。
interface Prefs { fleets: boolean[]; lbas: boolean[] }

function loadPrefs(fleetCount: number): Prefs {
    const d: Prefs = { fleets: Array(fleetCount).fill(true), lbas: [true, true, true] };
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
        if (!raw || typeof raw !== 'object') return d;
        return {
            // 儲存長度與目前艦隊數不符（例如遠征解鎖了新艦隊格）時整組回退全 true，
            // 不強行對齊索引猜測。
            fleets: Array.isArray(raw.fleets) && raw.fleets.length === fleetCount
                ? raw.fleets.map((v: unknown) => v !== false) : d.fleets,
            lbas: Array.isArray(raw.lbas) && raw.lbas.length === 3
                ? raw.lbas.map((v: unknown) => v !== false) : d.lbas,
        };
    } catch { return d; }
}
const savePrefs = (p: Prefs) => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* 隱私模式等：靜默 */ }
};

// ── 裝備清單（screen 渲染共用）──────────────────────────────
// 縱向一格一行：圖示＋全名（ellipsis，title 補完整）＋改修/熟練/搭載數靠右。欄寬夠時
// （艦隊裡船少、或基地卡）看得到全名，欄擠時（艦隊裡船多，見 shipCol）ellipsis 自然
// 截斷——同一份 markup 兩種寬度都對付得了，不必為窄欄另刻一份圖示版。
function gearRow(g: GearView | null, extra = ''): string {
    if (!g) {
        return `<div class="fo-gear-row empty${extra}"><span class="g-icon-slot"></span><span class="fo-gear-name dim">${esc(t('ov.rsEmptySlot'))}</span></div>`;
    }
    const suffixText = `${g.level > 0 ? ` ★${g.level}` : ''}${g.alv > 0 ? ` »${g.alv}` : ''}`;
    const countText = g.count != null ? `${g.count}${g.countMax != null ? `/${g.countMax}` : ''}` : '';
    const suffix = `${suffixText}${countText ? ` ${countText}` : ''}`.trim();
    const title = `${g.name}${suffixText}${countText ? ` [${countText}]` : ''}`;
    return `<div class="fo-gear-row${extra}" title="${esc(title)}">${gearIconHtml(g.icon, g.short)}<span class="fo-gear-name">${esc(g.name)}</span>${suffix ? `<b class="fo-gear-mark">${esc(suffix)}</b>` : ''}</div>`;
}

function squadronRow(sq: SquadronView): string {
    if (sq.state !== 1 || sq.icon <= 0) {
        return `<div class="fo-gear-row empty"><span class="g-icon-slot"></span><span class="fo-gear-name dim">${esc(t('ov.rsEmptySlot'))}</span></div>`;
    }
    const suffixText = `${sq.level > 0 ? ` ★${sq.level}` : ''}${sq.alv > 0 ? ` »${sq.alv}` : ''}`;
    const suffix = `${suffixText} ${sq.count}/${sq.maxCount}`.trim();
    const title = `${sq.name}${suffixText} [${sq.count}/${sq.maxCount}]`;
    return `<div class="fo-gear-row" title="${esc(title)}">${gearIconHtml(sq.icon, sq.short)}<span class="fo-gear-name">${esc(sq.name)}</span><b class="fo-gear-mark">${esc(suffix)}</b></div>`;
}

// ── 螢幕渲染 ──────────────────────────────────────────────
// 一艘船一欄（非一整行）：`.fo-ship-row` 用 flex 橫向排開，本函式只負責單欄內容，
// 常駐攤開、不折疊（見檔頭修正記錄 2）。
function shipCol(s: ShipView): string {
    const gears = s.gears.map(g => gearRow(g)).join('');
    // exEmpty（api_slot_ex===-1）＝有孔未裝，仍要畫空框；exGear/exEmpty 皆無＝無孔，
    // 整格不畫（同 ships.ts gearsCell 的判準）。
    const ex = s.exGear ? gearRow(s.exGear, ' ex')
        : s.exEmpty ? `<div class="fo-gear-row ex empty"><span class="g-icon-slot"></span><span class="fo-gear-name dim">${esc(t('ov.shipsExEquipment'))}</span></div>`
            : '';
    const hpPct = s.maxhp > 0 ? s.hp / s.maxhp : 1;
    const hpCls = hpPct <= 0.25 ? 'taiha' : hpPct <= 0.5 ? 'chuha' : hpPct < 1 ? 'shouha' : '';
    const condCls = s.cond >= 50 ? 'fo-sparkle' : s.cond <= 19 ? 'fo-heavy' : s.cond <= 29 ? 'fo-tired' : '';
    return `<div class="fo-ship-col">
        <div class="fo-ship-head">
            <span class="fo-stype">${esc(s.stype)}</span>
            <span class="fo-name" title="${esc(s.name)}">${esc(s.name)}</span>
        </div>
        <div class="fo-ship-stats">
            <span class="fo-lv">Lv${s.lv}</span>
            <span class="fo-hp ${hpCls}">${s.hp}/${s.maxhp}</span>
            <span class="fo-cond ${condCls}">${s.cond}</span>
        </div>
        <div class="fo-gear-list">${gears}${ex}</div>
    </div>`;
}

// export：離線版面預覽（tools/preview/fleet-overview.ts）直接呼叫，與 render() 共用
// 同一份 markup，不另抄一份（同 sortie-log.ts 的 shellHtml/headHtml/detailHtml 作法）。
export function fleetHtml(f: FleetView, idx: number): string {
    if (!f.ships.length) return '';
    return `<section class="fo-fleet">
        <h3>${esc(t('ov.fleetN', { n: idx + 1 }))}　${esc(f.name)}${f.mission ? ` <span class="dim">${esc(t('ov.onMission'))}</span>` : ''}</h3>
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
function buildMarkdown(state: GameState, scope: FleetMarkdownScope): string {
    return `# ${state.nickname || '???'}　Lv${state.hqLv}\n\n` + fleetMarkdown(state, '##', scope);
}

// ── PNG 匯出（內聯樣式、純文字，穩定點陣化）────────────────
function buildExportHtml(state: GameState, scope: FleetMarkdownScope): { html: string; height: number } {
    const rows: string[] = [];
    const line = (txt: string, bold = false, indent = 0) =>
        `<div style="margin:${bold ? '10px 0 2px' : '1px 0'};padding-left:${indent}px;font-weight:${bold ? 700 : 400};color:${bold ? '#e6c35c' : '#cfd6e4'}">${esc(txt)}</div>`;
    rows.push(line(`${state.nickname || '???'}　Lv${state.hqLv}`, true));
    state.fleets().forEach((f, i) => {
        if (!f.ships.length || !scope.fleets[i]) return;
        rows.push(line(`${t('ov.fleetN', { n: i + 1 })} — ${f.name}`, true));
        for (const s of f.ships) {
            const gears = s.gears.filter(Boolean).map(g => `${g!.name}${g!.level > 0 ? `★${g!.level}` : ''}`).join(' / ');
            rows.push(line(`${s.stype} ${s.name}  Lv${s.lv}  HP${s.hp}/${s.maxhp}  ${gears}`, false, 12));
        }
    });
    for (const b of state.airBases_()) {
        if (scope.lbas[b.rid - 1] === false) continue;
        rows.push(line(`${b.name}（${state.mapAreaName(b.areaId)}）  ${t('ov.airPower', { min: b.airPower.min, max: b.airPower.max })}`, true));
        rows.push(line(b.squadrons.map(s => `${s.name}${s.level > 0 ? `★${s.level}` : ''}`).join(' / '), false, 12));
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
        // 海域名只在渲染時查一次快取起來——mapAreaName() 依 master 查表，逐次呼叫成本低，
        // 但同一顆基地在 chip 列與內文各要用一次，避免兩處算出不一致的字串。
        const areaNames = new Map(basesAll.map(b => [b.rid, state.mapAreaName(b.areaId)]));
        const prefs = loadPrefs(fleetsAll.length);
        const existingFleets = fleetsAll.filter(f => f.ships.length).length;

        // 摺疊起來的「顯示範圍」summary：不展開也看得出目前篩著什麼（同 ships.ts
        // 「生效條件 chip 列常駐」的精神），不然摺起來就變成一個看不出內容的黑盒子。
        function scopeHint(): string {
            const shownFleets = fleetsAll.filter((f, i) => f.ships.length && prefs.fleets[i]).length;
            const shownBases = basesAll.filter(b => prefs.lbas[b.rid - 1]).length;
            const hidden = (existingFleets - shownFleets) + (basesAll.length - shownBases);
            return hidden > 0 ? t('ov.fleetOverviewHiddenN', { n: hidden }) : t('ov.fleetOverviewAllShown');
        }

        // 顯示範圍 chip 列的 markup 被畫面本身與匯出選擇 dialog 共用同一種形狀
        // （只有 checkbox 預設勾選狀態不同），抽成函式避免兩處各寫一份還兜不齊。
        const scopeChips = (fleetChecked: (i: number) => boolean, lbasChecked: (rid: number) => boolean) => `
            ${fleetsAll.map((f, i) => f.ships.length
            ? `<label class="eo-chip${fleetChecked(i) ? ' on' : ''}" data-fleet="${i}"><input type="checkbox" ${fleetChecked(i) ? 'checked' : ''}>${esc(t('ov.fleetN', { n: i + 1 }))}</label>`
            : '').join('')}
            ${basesAll.map(b => `<label class="eo-chip${lbasChecked(b.rid) ? ' on' : ''}" data-lbas-rid="${b.rid}"><input type="checkbox" ${lbasChecked(b.rid) ? 'checked' : ''}>${esc(b.name)}　${esc(areaNames.get(b.rid) ?? '')}</label>`).join('')}`;

        el.innerHTML = `
            <div class="ov-toolbar">
                <button class="ov-btn" id="fo-md-copy">${esc(t('ov.copyMarkdown'))}</button>
                <button class="ov-btn" id="fo-md-dl">${esc(t('ov.downloadMarkdown'))}</button>
                <button class="ov-btn" id="fo-png">${esc(t('ov.downloadPng'))}</button>
                <button class="ov-btn" id="fo-imgbuilder">${esc(t('ov.exportImgBuilder'))}</button>
                <button class="ov-btn" id="fo-aircalc">${esc(t('ov.exportAirCalc'))}</button>
            </div>
            <p class="fo-note">${esc(t('ov.exportExternalNote'))}</p>
            <details class="fo-scope">
                <summary>
                    <span class="fo-scope-label">${esc(t('ov.fleetOverviewScope'))}</span>
                    <span class="fo-scope-hint">${esc(scopeHint())}</span>
                </summary>
                <div class="fo-scope-body">${scopeChips(i => prefs.fleets[i], rid => prefs.lbas[rid - 1])}</div>
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
            </dialog>`;

        const bodyEl = el.querySelector<HTMLDivElement>('.fo-body')!;
        const scopeEl = el.querySelector<HTMLDivElement>('.fo-scope')!;
        const scopeHintEl = el.querySelector<HTMLSpanElement>('.fo-scope-hint')!;

        function renderBody() {
            const fleets = fleetsAll.filter((f, i) => f.ships.length && prefs.fleets[i]);
            const bases = basesAll.filter(b => prefs.lbas[b.rid - 1]);
            if (!fleets.length && !bases.length) {
                bodyEl.innerHTML = `<div class="ov-empty">${esc(t('ov.fleetOverviewAllHidden'))}</div>`;
                return;
            }
            bodyEl.innerHTML = `
                <div class="fo-fleets">${fleetsAll.map((f, i) => (f.ships.length && prefs.fleets[i]) ? fleetHtml(f, i) : '').join('')}</div>
                ${bases.length ? `<div class="fo-lbas-row">${bases.map(b => baseHtml(b, areaNames.get(b.rid) ?? '')).join('')}</div>` : ''}`;
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
            const rid = chip.dataset.lbasRid;
            if (fi !== undefined) prefs.fleets[Number(fi)] = box.checked;
            else if (rid !== undefined) prefs.lbas[Number(rid) - 1] = box.checked;
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

        // ── 傳去外部工具前先選範圍（使用者要求，見檔頭修正記錄 5）──
        // dialog 裡的 checkbox 是獨立一份、預設帶入目前畫面顯示範圍當起點，勾選只
        // 影響這次傳送，不寫回 prefs／不影響畫面。
        const dialogEl = el.querySelector<HTMLDialogElement>('.fo-export-dialog')!;
        const choicesEl = dialogEl.querySelector<HTMLDivElement>('.fo-export-choices')!;
        let exportTarget: 'imgbuilder' | 'aircalc' = 'imgbuilder';

        function openExportDialog(target: 'imgbuilder' | 'aircalc') {
            exportTarget = target;
            choicesEl.innerHTML = scopeChips(i => prefs.fleets[i], rid => prefs.lbas[rid - 1]);
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
                lbas: [1, 2, 3].map(rid =>
                    choicesEl.querySelector<HTMLInputElement>(`[data-lbas-rid="${rid}"] input`)?.checked ?? false),
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
    },
};
