// 鎮守府情報總括各分區共用的小工具。overview 是獨立分頁、不消費 live 事件，
// 需要「當前狀態」時就地重建一個 GameState（重播 db.snapshot 墊底＋db.events，同面板
// 啟動流程）——讀取用途，不寫任何 DB（擷取/歸檔是面板的職責，見 panel/main.ts）。
import { db } from '@/utils/db';
import { esc, gearIconHtml, matIconHtml } from '@/utils/html-escape';
import { eventTermLabel, eventTermSeasonLabel } from '@/utils/event-calendar';
import { eventWorldLabel, type EventMapFilterPlan, type EventWorldFilter } from '@/utils/sortie-detail';
import { GameState } from '@/utils/state';
import { applyStateRecoveryPlan, planStateRecovery } from '@/utils/state-recovery';
import { t } from '@/utils/ui-i18n';

export { esc, gearIconHtml, matIconHtml };

/** rank → CSS class 後綴（s/a/b/c/d）；非 S/A/B/C/D 回空，避免匯入字串進 class。 */
export function rankClassSuffix(rank: string): string {
    const r = rank.trim().toUpperCase();
    return r === 'S' || r === 'A' || r === 'B' || r === 'C' || r === 'D' ? r.toLowerCase() : '';
}

// ── 清單樣板（prefs／日期／關鍵字／分頁）────────────────────────────────
// key 字串由各分區傳入，不可改（避免使用者偏好被重置）。篩選／DOM 仍留在分區。

/** localStorage JSON 偏好：解析失敗或 parse 拋錯時回 fallback。 */
export function loadJsonPrefs<T>(key: string, fallback: T, parse: (raw: unknown) => T): T {
    try {
        return parse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    } catch {
        return fallback;
    }
}

export function saveJsonPrefs(key: string, prefs: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* 隱私模式等：靜默 */ }
}

/** 活動下拉：`all`＋各次活動。跨年時依年份 optgroup，組內只寫季節以免重複年份。 */
export function eventFilterSelectHtml(
    groups: EventMapFilterPlan['eventGroups'],
    selected: EventWorldFilter,
    allLabel: string,
): string {
    const body = groups.map(group => {
        const options = group.options.map(option =>
            `<option value="${option.world}"${option.world === selected ? ' selected' : ''}>${esc(option.label)}（${option.count}）</option>`).join('');
        return group.label ? `<optgroup label="${esc(group.label)}">${options}</optgroup>` : options;
    }).join('');
    return `<option value="all"${selected === 'all' ? ' selected' : ''}>${esc(allLabel)}</option>${body}`;
}

/** 活動主標：年表命中用「2026夏季」；表外才退 master 標題或 `#id`。 */
export function eventDisplayName(world: number, masterName: string | undefined): string {
    return eventTermLabel(world, t) ?? eventWorldLabel(world, masterName, t('area.event'));
}

/** title 才併官方作戰名；下拉與徽章不重複那串長標題。 */
export function eventDisplayTitle(world: number, masterName: string | undefined): string {
    const name = eventDisplayName(world, masterName);
    const official = masterName?.trim();
    return official && official !== name ? `${name}　${official}` : name;
}

export function eventTermForFilter(world: number): { year: number; seasonLabel: string } | null {
    return eventTermSeasonLabel(world, t);
}

/** 關卡／海域下拉。跨活動時用 optgroup，組內仍是 E{n}，避免兩個 E1 看起來像同一關。 */
export function mapFilterSelectHtml(
    groups: EventMapFilterPlan['mapGroups'],
    selected: string,
    allLabel: string,
): string {
    const body = groups.map(group => {
        const options = group.options.map(option =>
            `<option value="${esc(option.map)}"${option.map === selected ? ' selected' : ''}>${esc(option.label)}（${option.count}）</option>`).join('');
        return group.label ? `<optgroup label="${esc(group.label)}">${options}</optgroup>` : options;
    }).join('');
    return `<option value="all"${selected === 'all' ? ' selected' : ''}>${esc(allLabel)}</option>${body}`;
}

export function readEventWorldFilter(value: string): EventWorldFilter {
    if (value === 'all' || value === '') return 'all';
    const world = Number(value);
    return Number.isSafeInteger(world) && world > 0 ? world : 'all';
}

/** `<input type="date">` → 本地日開始時間戳；空字串／無效回 null。 */
export function dateStart(value: string): number | null {
    if (!value) return null;
    const ts = new Date(`${value}T00:00:00`).getTime();
    return Number.isFinite(ts) ? ts : null;
}

/** `<input type="date">` → 本地日結束時間戳；空字串／無效回 null。 */
export function dateEnd(value: string): number | null {
    if (!value) return null;
    const ts = new Date(`${value}T23:59:59.999`).getTime();
    return Number.isFinite(ts) ? ts : null;
}

/** 不分大小寫的子字串比對（query 先 trim）；空 query 仍比對（空字串為任何字串的子字串）。 */
export function fuzzyMatch(name: string, query: string): boolean {
    return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export interface Page<T> {
    rows: T[];
    /** 1-based；資料變少時會被夾回最後一頁，故呼叫端要用回傳值而非自己記的值。 */
    page: number;
    pageCount: number;
    /** 這一頁在全體中的 1-based 起訖（0 筆時為 0）。 */
    from: number;
    to: number;
    total: number;
}

/** 取某一頁。size===0 為全部；page 超出範圍時夾到有效範圍。對齊 ships 的 paginate 語意。 */
export function paginate<T>(rows: T[], size: number, page: number): Page<T> {
    const total = rows.length;
    if (size === 0) return { rows, page: 1, pageCount: 1, from: total ? 1 : 0, to: total, total };
    const pageCount = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(1, page), pageCount);
    const start = (current - 1) * size;
    const slice = rows.slice(start, start + size);
    return {
        rows: slice, page: current, pageCount,
        from: slice.length ? start + 1 : 0, to: start + slice.length, total,
    };
}

// 重建當前 GameState：共用規劃器會依 retained raw events 的第一筆 ID 選出安全 baseline。
// overview 僅套用 reducer，不經 EventProjector，因此不寫任何 derived tables。
export async function loadGameState(): Promise<GameState> {
    const gs = new GameState();
    const [snapshots, events] = await Promise.all([
        db.snapshot.toArray(),
        db.events.orderBy('id').toArray(),
    ]);
    applyStateRecoveryPlan(gs, planStateRecovery(snapshots, events));
    return gs;
}

// 檔案下載（Blob + 臨時 <a download>）；純前端、不需任何權限。
export function downloadBlob(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
    downloadBlob(filename, new Blob([text], { type: mime }));
}

// 剪貼簿複製＋按鈕暫態回饋（複製成功把按鈕文字換成 doneLabel 1.5 秒）。
export async function copyWithFeedback(btn: HTMLButtonElement, text: string, doneLabel: string) {
    const orig = btn.textContent ?? '';
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = doneLabel;
        setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch { /* 剪貼簿不可用時靜默 */ }
}

export const fmtTs = (ts: number) => new Date(ts).toLocaleString();
export const fmtShortTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 四艦隊＋基地航空隊的 Markdown 片段。fleet-overview 與 llm.ts 的完整報告共用同一段內容，
// 只差外層標題層級，故用 h 參數控制（獨立文件用 '##'，嵌入報告章節用 '###'）。
export const AIR_ACTION_KEYS = ['lbas.standby', 'lbas.sortie', 'lbas.airDefense', 'lbas.retreat', 'lbas.rest'];
// lbas：**以海域（maparea id）為單位**的開關表，鍵是 `String(areaId)`，缺席＝顯示。
// 使用者指定「每個海域一個 checkbox 就好」——一個海域最多三個基地、平常整組一起看，
// 逐基地開關只是讓那排 chip 長得更長。⚠️ lbas 必須以海域 id 為鍵：rid 是「該海域的
// 第幾個基地」，中部海域與活動海域各有自己的第一基地航空隊，用 rid 當鍵會兩個海域連動
// （見 utils/state.ts airBaseKey 的災情註解）。
export interface FleetMarkdownScope { fleets: boolean[]; lbas: Record<string, boolean> }

/**
 * 基地航空隊的「所屬海域」標籤。
 *
 * 封包只給**海域（maparea）層級**的 `api_area_id`，**沒有「是 6-4 還是 6-5 的基地」
 * 這種單張地圖資訊**——同一個海域的基地本來就三張圖共用，這不是漏讀欄位。故通常海域
 * 標成「6 中部海域」：那個 6 就是玩家熟悉的「6-x」的 6，讓兩個海域的第一基地航空隊
 * 一眼分得出來。
 *
 * 活動海域的 maparea id（62 之類）對玩家沒有意義故不標；但**名稱回退成通用字串**
 * （master 查無此 id，例如活動已結束、基地資料還留著）時反而要補上 id，否則兩個舊活動
 * 的基地會同樣顯示「活動海域」而分不出誰是誰。
 */
export function airBaseAreaLabel(state: GameState, areaId: number): string {
    const name = state.mapAreaName(areaId);
    if (areaId <= 10) return `${areaId} ${name}`;
    return state.masterMapAreas.has(areaId) ? name : `${name} #${areaId}`;
}

// 熟練度符號：與面板 chip 同一套階層（1-3 直線、4-6 斜線、7 為 ace 雙箭）。
// Markdown 是純文字，故 ace 用單一字元 '»'（面板用 HTML 實體 &gt;&gt;）。
const ALV_MARKS = ['', '|', '||', '|||', '/', '//', '///', '»'];

/**
 * Markdown 的裝備寫法：`零式艦戦 53 型(岩本隊)★»`。
 *
 * 改修**滿階（★10）只給星號不給數字**——這是使用者指定的寫法，讀者看到光禿禿的
 * ★ 就知道是滿的，不必去記上限是幾；1-9 才寫數字。熟練度接在後面，沒有就不寫。
 *
 * export：fleet-overview 的 PNG 匯出也是同一份純文字內容，共用這支才不會出現
 * 「Markdown 寫 ★»、PNG 寫 ★10」這種同一隊兩種寫法。
 */
export const gearMarkdown = (g: { name: string; level: number; alv: number }) =>
    `${g.name}${g.level >= 10 ? '★' : g.level > 0 ? `★${g.level}` : ''}`
    + (ALV_MARKS[Math.min(7, Math.max(0, g.alv))] ?? '');

/**
 * 一艘艦的裝備列（一般槽＋補強增設）。補強增設有裝才追加，並加 `[補強]` 前綴
 * （同艦娘全覽文字匯出）；空孔／無孔都不寫——Markdown 不需要「這格空著」的精度。
 */
export function shipGearsMarkdown(s: {
    gears: ({ name: string; level: number; alv: number } | null)[];
    exGear: { name: string; level: number; alv: number } | null;
}): string {
    const parts = s.gears.filter(Boolean).map(g => gearMarkdown(g!));
    if (s.exGear) parts.push(`[${t('ov.shipsEx')}]${gearMarkdown(s.exGear)}`);
    return parts.join(' / ');
}

export function fleetMarkdown(state: GameState, h = '##', scope?: FleetMarkdownScope): string {
    const lines: string[] = [];
    state.fleets().forEach((f, i) => {
        if (!f.ships.length) return;
        if (scope && scope.fleets[i] === false) return;
        lines.push(`${h} ${t('ov.fleetN', { n: i + 1 })} — ${f.name}${f.mission ? `（${t('ov.onMission')}）` : ''}`);
        for (const s of f.ships) {
            const gears = shipGearsMarkdown(s);
            lines.push(`- **${s.stype} ${s.name}** Lv${s.lv}　HP ${s.hp}/${s.maxhp}　cond ${s.cond}${gears ? `　│ ${gears}` : ''}`);
        }
        lines.push('');
    });
    const bases = state.airBases_().filter(b => !scope || scope.lbas[String(b.areaId)] !== false);
    if (bases.length) {
        lines.push(`${h} ${t('ov.airCorps')}`);
        for (const b of bases) {
            const sq = b.squadrons.map(gearMarkdown).join(' / ');
            lines.push(`- **${b.name}**（${airBaseAreaLabel(state, b.areaId)}）${t(AIR_ACTION_KEYS[b.actionKind] ?? 'lbas.standby')}　${t('ov.airRadius', { n: b.distance })}　${t('ov.airPower', { min: b.airPower.min, max: b.airPower.max })}${sq ? `　│ ${sq}` : ''}`);
        }
    }
    return lines.join('\n');
}
