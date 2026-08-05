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
//   6. 艦卡版面改對齊使用者指定的參照圖（2026-08-03）：**一艘船一張卡**——艦名獨佔
//      頂端一列（參照圖裡它壓在立繪上），下面兩列分別是「艦種｜Lv.」與「運｜HP｜士氣」
//      （左右對齊、窄欄可換行），再下面才是裝備清單；艦隊標題下方多一列合計徽章
//      （Lv／索敵／制空／TP／速力／火力，見 headBadges）。三項刻意的取捨：
//        · **立繪不畫**——本擴充不碰遊戲美術資源，使用者已明確表示「沒有大頭貼不要緊」。
//        · **艦載機搭載數（格子數量）整個不顯示**（使用者指定）：這一區看的是「這艘船
//          帶了什麼」，名稱才是主角；搭載實數仍在面板出擊監控顯示，那邊要看的正是戰損
//          後還剩幾架，兩區用途不同，別為了一致把數字加回來。
//        · **熟練度不顯示數字**（使用者指定）：只留一個 `»` 符號＋三段顏色，實際階級退到
//          title。裝備名稱維持單行 ellipsis＋hover 全名（使用者從三個選項裡選的這個，
//          別自作主張改成換行或橫向捲動）。
//   7. 艦欄改成**靠左對齊、不拉伸**（2026-08-03，使用者回報）：修正記錄 2 的
//      `flex: 1 1 0`（欄寬平分整行、不滿編時每欄撐滿）在**只有一艘船**的隊伍上會把
//      艦名／Lv／運／士氣拉開到整行左右兩端，中間一大片空白，反而更難讀。改成
//      `flex: 0 1 var(--fo-col-w)`：不滿編時每欄停在「裝備全名讀得完」的基準寬度
//      （20em）並靠左排，滿編（6/7 艘）擠不下時才依同一個 basis 平均收縮，回到修正
//      記錄 2 的窄欄＋名稱省略。**別改回 `flex: 1 1 0`**——修正記錄 2 要解的是「窄欄
//      縱向堆六艘、寬度沒用到」，靠左排一樣沒有回到那個問題。
//   8. **rid 不是基地的唯一鍵**（2026-08-03，實機回報）：舊碼用 rid 當鍵（顯示範圍
//      prefs、海域名對照、匯出 dialog 的 selector、DeckBuilder 的 a1~a3），但 rid 只是
//      「**該海域的**第幾個基地」——中部海域與活動海域各有自己的第一/第二/第三基地
//      航空隊，撞號後海域名整批被最後一個海域覆蓋，畫面上六個基地全掛同一個活動名、
//      分不出誰是誰，開關也變成兩海域連動。唯一鍵見 `utils/state.ts` 的 `airBaseKey()`；
//      DeckBuilder 的 a1~a3 改成依選取順序填、滿三格就停。
//      同時把海域標籤改成 `airBaseAreaLabel()`：通常海域標成「6 中部海域」（那個 6 就是
//      玩家熟悉的 6-x 的 6）。⚠️ **封包只給海域(maparea)層級**，沒有「這個基地屬於 6-4
//      還是 6-5」這種資訊——基地本來就是整個海域共用，別再去找那個欄位。
//   9. 「顯示範圍」改成 `position: sticky` 釘在捲動區頂端（使用者要求）：展開勾選後往下
//      捲看艦隊時開關仍留在畫面上，才知道自己關掉了什麼。
//  10. 基地航空隊的顯示範圍**以海域為單位、一個海域一顆 checkbox**（使用者指定）：
//      一個海域最多三個基地、平常整組一起看，逐基地一顆只是讓那排 chip 更長（多海域時
//      六顆以上）。chip 標的是海域標籤＋該海域的基地數（`6 中部海域 ×3`）。故 prefs 與
//      兩個 scope 型別（`FleetMarkdownScope`／`DeckBuilderScope`）的 lbas 鍵都是
//      `String(areaId)`——**別改回逐基地鍵，更別改回 rid**（後者見修正記錄 8）。
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
import {
    airBaseAreaLabel, esc, downloadText, copyWithFeedback, fleetMarkdown, gearIconHtml, gearMarkdown,
    loadJsonPrefs, saveJsonPrefs, type FleetMarkdownScope,
} from '../lib';
import { buildDeckBuilder, imgBuilderUrl, airCalcUrl } from '@/utils/deckbuilder';

const AIR_ACTION_KEYS = ['lbas.standby', 'lbas.sortie', 'lbas.airDefense', 'lbas.retreat', 'lbas.rest'];

// ── 顯示範圍偏好（localStorage）──────────────────────────────
// key 換過一次（`…-view` → `…-view2`）：lbas 的資料形狀從「長度 3、索引＝rid-1 的陣列」
// 改成「以海域 id 為鍵的表」，見檔頭修正記錄 8、10。舊 key 的值沒有海域資訊、無法安全
// 對映到新鍵（rid 1 到底是哪個海域的第一基地無從得知），故直接換 key 讓舊值自然作廢
// ＝全部顯示，而不是猜著搬移。
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
// **搭載數（艦載機格數）與熟練度數字刻意不顯示**（使用者指定，見檔頭修正記錄 6）：
// 這一區看的是「這艘船帶了什麼」，一行裡再塞 `18/18 »7` 會把裝備名的可用寬度吃掉
// （名稱是這裡最重要的欄位），故搭載數整個不畫、熟練度只留一個符號、數字退到 title。
// 面板（出擊監控）仍照舊顯示搭載實數——那邊要看的正是戰損後還剩幾架，兩區用途不同。
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
// 常駐攤開、不折疊（見檔頭修正記錄 2）。
//
// 卡片內的三段（艦名／艦種＋Lv／運＋HP＋士氣）＝使用者指定的參照版面（見檔頭修正
// 記錄 6）。艦名獨佔一列（參照圖裡它壓在立繪上方），故不再與艦種擠同一行——擠在
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
    const hpCls = hpPct <= 0.25 ? 'taiha' : hpPct <= 0.5 ? 'chuha' : hpPct < 1 ? 'shouha' : '';
    const condCls = s.cond >= 50 ? 'fo-sparkle' : s.cond <= 19 ? 'fo-heavy' : s.cond <= 29 ? 'fo-tired' : '';
    return `<div class="fo-ship-col">
        <div class="fo-ship-name" title="${esc(s.nameJa && s.nameJa !== s.name ? `${s.name}（${s.nameJa}）` : s.name)}">${esc(s.name)}</div>
        <div class="fo-ship-head">
            <span class="fo-stype">${esc(s.stype)}</span>
            <span class="fo-lv">Lv. ${s.lv}</span>
        </div>
        <div class="fo-ship-stats">
            <span class="fo-luck"><i>${esc(t('ov.rsColLuck'))}</i> ${s.luck}</span>
            <span class="fo-hp ${hpCls}" title="${esc(t('ov.rsColHp'))}">${s.hp}/${s.maxhp}</span>
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
        ${sum ? badge(t('fleet.scouting33'), sum.f33.toFixed(2)) : ''}
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
// 符號。這裡曾自己內聯一份「name + ★level」，於是同一支艦隊兩種匯出寫法不一致。
function buildExportHtml(state: GameState, scope: FleetMarkdownScope): { html: string; height: number } {
    const rows: string[] = [];
    const line = (txt: string, bold = false, indent = 0) =>
        `<div style="margin:${bold ? '10px 0 2px' : '1px 0'};padding-left:${indent}px;font-weight:${bold ? 700 : 400};color:${bold ? '#e6c35c' : '#cfd6e4'}">${esc(txt)}</div>`;
    rows.push(line(`${state.nickname || '???'}　Lv${state.hqLv}`, true));
    state.fleets().forEach((f, i) => {
        if (!f.ships.length || !scope.fleets[i]) return;
        rows.push(line(`${t('ov.fleetN', { n: i + 1 })} — ${f.name}`, true));
        for (const s of f.ships) {
            const gears = s.gears.filter(Boolean).map(g => gearMarkdown(g!)).join(' / ');
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
        // 基地航空隊**以海域為單位**開關（使用者指定，見檔頭修正記錄 10）：一個海域最多
        // 三個基地、平常整組一起看，逐基地一顆 checkbox 只是讓那排 chip 更長。海域名在
        // 這裡查一次快取起來（chip 列與基地卡各要用一次，避免兩處算出不一致的字串）。
        const areaIds = [...new Set(basesAll.map(b => b.areaId))].sort((a, b) => a - b);
        const areaLabels = new Map(areaIds.map(id => [id, airBaseAreaLabel(state, id)]));
        const areaCounts = new Map(areaIds.map(id => [id, basesAll.filter(b => b.areaId === id).length]));
        const lbasShown = (b: AirBaseView) => prefs.lbas[String(b.areaId)] !== false;
        const existingFleets = fleetsAll.filter(f => f.ships.length).length;

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

        // ── 傳去外部工具前先選範圍（使用者要求，見檔頭修正記錄 5）──
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
    },
};
