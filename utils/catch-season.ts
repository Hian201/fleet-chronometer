// 秋刀魚祭的季別（純函式＋localStorage 讀寫；無 chrome.*）。規格見 docs/saury-plan.md §2.4。
//
// 每季一列：開始取官方公告的開始維護「預定結束」時刻（伺服器重開後才撈得到魚），結束取官方
// 公告的結束時刻；公告前為 null。每年新增一列、舊的保留，道具捕撈依季別分開統計，
// 新一季的起點不會把舊季的紀錄擋掉。
//
// ── 結束時刻的推算（官方結束時刻補進新版之前） ───────────────────────────
// 秋刀魚在結束維護時回收。遊戲的道具清單只列數量 ≥ 1 的道具：開發者 2026-08-31 的完整備份裡，
// 登入時的 api_get_member/require_info `api_useitem` 共 31 筆、全部 api_count ≥ 1，往年被回收過的
// 秋刀魚（68）整筆不在清單。所以「被回收」與「換光」在清單上一樣，都是整筆不見；
// 改以「中間有沒有消耗」區分：重新載入（api_start2/getData）前持有 > 0、上次完整清單之後沒有
// 消耗類請求，重新載入後的清單裡沒有秋刀魚，就推定活動已經結束。消耗類請求（兌換、任務領獎）
// 一出現就作廢這次推定，寧可推不出來也不誤判。換光之後才結束的季推不出來。
//
// 回收不一定在結束那次維修：2026 年的南瓜在活動結束後沒有回收，等到下一次（秋刀魚祭開始）的
// 維修才回收。所以推算只給範圍：不早於「最後一次撈到秋刀魚」，不晚於「看到已回收」；統計截止取
// 後者，寧可多算幾場無魚的場次，也不漏掉活動中的場次。玩家可以自己填結束時刻（多半來自官方公告），
// 優先於推算：官方（本表）→ 玩家自填 → 推算 → 下一季開始。

export interface CatchSeason {
    /** 顯示用年度，也是 localStorage 的鍵。 */
    id: string;
    start: number;
    /** 官方公告的結束時刻；未公告為 null。 */
    end: number | null;
}

/** 由舊到新。新一季公告後新增一列；官方結束時刻公告後補上 end。 */
export const CATCH_SEASONS: readonly CatchSeason[] = [
    // 2026-11-19 官方推文：11/24 11:00～20:30 維護，完成後開始（docs/saury-plan.md S13）。
    { id: '2026', start: Date.parse('2026-11-24T20:30:00+09:00'), end: null },
];

export const SAURY_ITEM = 68;

/** 最新一季（爆雷提醒、道具捕撈的預設季別）。 */
export function latestSeason(seasons: readonly CatchSeason[] = CATCH_SEASONS): CatchSeason {
    return seasons[seasons.length - 1];
}

export interface InferredEnd {
    /** 最後一次撈到秋刀魚（沒看到就是季節開始）：活動不早於此結束。 */
    after: number;
    /** 重新載入後看到秋刀魚已回收的時刻：活動不晚於此結束。 */
    before: number;
}

export interface SeasonRange {
    start: number;
    /** 統計用的截止：官方 → 玩家自填 → 推算的「不晚於」 → 下一季開始 → null（進行中）。 */
    end: number | null;
    endKind: 'official' | 'user' | 'inferred' | 'next' | null;
}

export function seasonRange(season: CatchSeason, inferred: InferredEnd | null, userEnd: number | null = null,
    seasons: readonly CatchSeason[] = CATCH_SEASONS): SeasonRange {
    if (season.end !== null) return { start: season.start, end: season.end, endKind: 'official' };
    if (userEnd !== null) return { start: season.start, end: userEnd, endKind: 'user' };
    if (inferred) return { start: season.start, end: inferred.before, endKind: 'inferred' };
    const next = seasons[seasons.indexOf(season) + 1];
    return next ? { start: season.start, end: next.start, endKind: 'next' } : { start: season.start, end: null, endKind: null };
}

/** 消耗道具的請求：出現就作廢「持有 > 0」的前提。 */
const CONSUME_PATHS = new Set(['api_req_member/itemuse', 'api_req_quest/clearitemget']);
/** 結算掉落欄位的讀法同 state.ts battleResultUseItemDrops（KC3Kai Node.js）。 */
const CATCH_PATHS = new Set(['api_req_sortie/battleresult', 'api_req_combined_battle/battleresult']);

/** 從一則封包的回應取出完整道具清單裡的秋刀魚數；不是清單回 undefined。 */
function listedSaury(path: string, api: unknown): number | undefined {
    const list = path === 'api_get_member/useitem' ? api
        : path === 'api_get_member/require_info' ? (api as { api_useitem?: unknown } | null)?.api_useitem
            : undefined;
    if (!Array.isArray(list)) return undefined;
    const row = list.find(x => x?.api_id === SAURY_ITEM);
    const n = Number(row?.api_count);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * 依序餵入 raw event（含面板開啟時的重播），推算季節結束。`heldBefore` 是套用這則封包**之前**
 * GameState 的秋刀魚持有數（含結算累加），由呼叫端提供，這樣面板重開後的重播也接得上。
 * 只在季節開始之後、且這季還沒有官方結束時刻時才推。
 */
export class SeasonEndDetector {
    private consumed = false;       // 上次看到持有 > 0 的完整清單之後，出現過消耗類請求
    private reloading = false;      // 重新載入時仍持有、且之前沒有消耗
    private lastCatch: number | null = null;

    constructor(private readonly season: CatchSeason) { }

    /** 回傳這則封包確認的結束推算；沒有則 null。 */
    feed(path: string, ts: number, api: unknown, heldBefore: number | null): InferredEnd | null {
        if (this.season.end !== null || ts < this.season.start) return null;
        if (CATCH_PATHS.has(path) && (api as { api_get_useitem?: { api_useitem_id?: unknown } } | null)?.api_get_useitem?.api_useitem_id === SAURY_ITEM) {
            this.lastCatch = ts;
            return null;
        }
        if (CONSUME_PATHS.has(path)) { this.consumed = true; this.reloading = false; return null; }
        if (path === 'api_start2/getData') {
            this.reloading = (heldBefore ?? 0) > 0 && !this.consumed;
            return null;
        }
        const held = listedSaury(path, api);
        if (held === undefined) return null;
        const found = held === 0 && this.reloading ? { after: this.lastCatch ?? this.season.start, before: ts } : null;
        this.reloading = false;
        if (held > 0) this.consumed = false;
        return found;
    }
}

// ── 推算結果的保存（panel 寫、overview 讀；同源 localStorage，不進備份） ──
const INFERRED_KEY = 'kc-catch-season-end';

export function parseInferredEnds(raw: unknown): Record<string, InferredEnd> {
    const out: Record<string, InferredEnd> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const r = v as Partial<InferredEnd> | null;
        if (Number.isFinite(r?.after) && Number.isFinite(r?.before) && r!.after! <= r!.before!) out[id] = { after: r!.after!, before: r!.before! };
    }
    return out;
}

export function loadInferredEnd(seasonId: string): InferredEnd | null {
    try { return parseInferredEnds(JSON.parse(localStorage.getItem(INFERRED_KEY) ?? 'null'))[seasonId] ?? null; } catch { return null; }
}

/** 同一季只留第一次推出的結果：之後的重新登入只會更晚，不更準。 */
export function saveInferredEnd(seasonId: string, end: InferredEnd): boolean {
    try {
        const all = parseInferredEnds(JSON.parse(localStorage.getItem(INFERRED_KEY) ?? 'null'));
        if (all[seasonId]) return false;
        all[seasonId] = end;
        localStorage.setItem(INFERRED_KEY, JSON.stringify(all));
        return true;
    } catch {
        return false;
    }
}

// ── 玩家自填的結束時刻（overview 寫、panel 讀；同源 localStorage，不進備份） ──
const USER_END_KEY = 'kc-catch-season-user-end';

export function parseUserEnds(raw: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) if (Number.isFinite(v)) out[id] = v as number;
    return out;
}

export function loadUserEnd(seasonId: string): number | null {
    try { return parseUserEnds(JSON.parse(localStorage.getItem(USER_END_KEY) ?? 'null'))[seasonId] ?? null; } catch { return null; }
}

/** null 清除。 */
export function saveUserEnd(seasonId: string, end: number | null): void {
    try {
        const all = parseUserEnds(JSON.parse(localStorage.getItem(USER_END_KEY) ?? 'null'));
        if (end === null) delete all[seasonId]; else all[seasonId] = end;
        localStorage.setItem(USER_END_KEY, JSON.stringify(all));
    } catch { /* 隱私模式等：本次不保存 */ }
}

/** 該季目前採用的期間（官方 → 自填 → 推算 → 下一季）。 */
export function currentSeasonRange(season: CatchSeason): SeasonRange {
    return seasonRange(season, loadInferredEnd(season.id), loadUserEnd(season.id));
}

/** 其他已開頁面改了自填或推算的結束時刻時通知。 */
export function onSeasonEndChange(cb: () => void): void {
    window.addEventListener('storage', event => { if (event.key === USER_END_KEY || event.key === INFERRED_KEY) cb(); });
}

/** 官方公告用日本時間；自填欄位也以日本時間輸入（datetime-local 字串 ↔ 時刻）。 */
export function jstInputToTs(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const ts = Date.parse(`${value}:00+09:00`);
    return Number.isFinite(ts) ? ts : null;
}

export function tsToJstInput(ts: number): string {
    return new Date(ts + 9 * 3_600_000).toISOString().slice(0, 16);
}
