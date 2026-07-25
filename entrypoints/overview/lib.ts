// 鎮守府情報總括各分區共用的小工具。overview 是獨立分頁、不消費 live 事件，
// 需要「當前狀態」時就地重建一個 GameState（重播 db.snapshot 墊底＋db.events，同面板
// 啟動流程）——讀取用途，不寫任何 DB（擷取/歸檔是面板的職責，見 panel/main.ts）。
import { db } from '@/utils/db';
import { esc, gearIconHtml, matIconHtml } from '@/utils/html-escape';
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
export function downloadText(filename: string, text: string, mime = 'text/plain') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

// 四艦隊＋基地航空隊的 Markdown 片段。原本只在 fleet-overview.ts 內用，抽到這裡是因為
// llm.ts 的「完整報告」匯出（#7 通用備份檔）也需要同一段內容——兩處輸出格式完全一致，
// 只差外層要嵌在哪一級標題底下，故用 h 參數控制標題層級（fleet-overview 獨立成文件時
// 用 '##'；嵌進完整報告的某個章節底下時用 '###'）。
const AIR_ACTION_KEYS = ['lbas.standby', 'lbas.sortie', 'lbas.airDefense', 'lbas.retreat', 'lbas.rest'];
// lbas：依基地 rid（1-3，穩定的「第幾個基地」）決定去留，不用陣列索引——sort 過的
// airBases_() 順序會先依 areaId 分組，rid 不一定對得上索引位置（見 fleet-overview.ts
// baseHtml() 的同一個註解）。
export interface FleetMarkdownScope { fleets: boolean[]; lbas: boolean[] }

export function fleetMarkdown(state: GameState, h = '##', scope?: FleetMarkdownScope): string {
    const lines: string[] = [];
    state.fleets().forEach((f, i) => {
        if (!f.ships.length) return;
        if (scope && scope.fleets[i] === false) return;
        lines.push(`${h} ${t('ov.fleetN', { n: i + 1 })} — ${f.name}${f.mission ? `（${t('ov.onMission')}）` : ''}`);
        for (const s of f.ships) {
            const gears = s.gears.filter(Boolean).map(g => `${g!.name}${g!.level > 0 ? `★${g!.level}` : ''}`).join(' / ');
            lines.push(`- **${s.stype} ${s.name}** Lv${s.lv}　HP ${s.hp}/${s.maxhp}　cond ${s.cond}${gears ? `　│ ${gears}` : ''}`);
        }
        lines.push('');
    });
    const bases = state.airBases_().filter(b => !scope || scope.lbas[b.rid - 1] !== false);
    if (bases.length) {
        lines.push(`${h} ${t('ov.airCorps')}`);
        for (const b of bases) {
            const sq = b.squadrons.map(s => `${s.name}${s.level > 0 ? `★${s.level}` : ''}`).join(' / ');
            lines.push(`- **${b.name}**（${state.mapAreaName(b.areaId)}） ${t(AIR_ACTION_KEYS[b.actionKind] ?? 'lbas.standby')}　${t('ov.airRadius', { n: b.distance })}　${t('ov.airPower', { min: b.airPower.min, max: b.airPower.max })}${sq ? `　│ ${sq}` : ''}`);
        }
    }
    return lines.join('\n');
}
