// 基地航空隊中隊疲勞的「經過時間修正」（純函式，零 chrome.*、零 DOM）。
//
// **為什麼需要這支**：疲勞回復完全發生在伺服器端，**回復時遊戲不推任何封包**
// （wikiwiki：コンディション値は3分ごとに増加）。本擴充是被動擷取、絕不主動發請求，
// 手上的 `api_cond` 因此永遠是「上一次收到基地航空隊資料那一刻」的值——玩家出擊完
// 關掉基地畫面後，面板可能持有遊戲已更新前的疲勞標記；`db.snapshot` 會讓這個觀測值
// 跨重開保留，因此需要以資料年齡計算保守的狀態把握程度。
//
// 資料來源：wikiwiki.jp/kancolle/基地航空隊 §疲労（curl 原始 HTML 逐字讀，見 CLAUDE.md
// 「缺資料先查 wikiwiki」）。逐字要點：
//   - コンディション値 0–46：**30–46 無標記／20–29 橙／0–19 赤**
//   - 「コンディション値は3分ごとに増加し、札状態で回復量が変化する」
//     基本値＝出撃 +1／防空 +2／退避 +3／待機 +4／休息 +8、**基地整備Lv 會再提升**
//   - 札回復の上限は 40（本檔門檻是 30，故上限不影響推論）
//
// ⚠️ **推論方向只有一個**：封包給的是 0–3 四段顯示碼（0=全滿／1=輕度疲勞・遊戲無標記／
// 2=橙／3=赤，見 `GameState.lbasCondState`）、不給 0–46 原始值，且 wiki 自己標明內部
// cond 值域是推測值。
// 故這裡只做「連最慢的回復速度都足以回到無標記時，才把標記拿掉」——
// 不會憑空生出遊戲裡沒有的疲勞，也不會把仍在疲勞的中隊謊報成已回復。整備Lv 的加成量
// 未查證，一律不計入（只會讓實際回復更快，用基本值屬保守側）。

// ── 顯示碼（`api_plane_info[].api_cond`）──────────────────────────────────────
// 詳細對照與佐證見 `GameState.lbasCondState`。這裡只放本檔推論需要的三個常數。
/** 1＝輕度疲勞但遊戲不顯示標記（KC3Kai 也把它跟 0 分成兩種表情） */
export const LBAS_COND_MILD = 1;
/** 2＝橙（中度疲勞），內部值 20–29 */
export const LBAS_COND_TIRED = 2;
/** 3＝赤（重度疲勞），內部值 0–19 */
export const LBAS_COND_EXHAUSTED = 3;

/** 回復 tick：每 3 分鐘一次（伺服器端排程，客端看不到相位） */
export const LBAS_COND_TICK_MS = 3 * 60_000;
/** 30 以上不顯示疲勞標記 */
export const LBAS_COND_NO_MARK_MIN = 30;
/** 20–29 為橙（中度疲勞）；0–19 為赤 */
export const LBAS_COND_TIRED_MIN = 20;

/**
 * 札（`api_action_kind`）別的每 tick 回復量。0=待機 1=出撃 2=防空 3=退避 4=休息，
 * 與 `GameState.actionLabel()` 同一套編碼。
 * 未知札一律取最慢的 +1——保守側（會晚一點才拿掉標記，不會早）。
 */
export function lbasRecoveryRate(actionKind: number | null | undefined): number {
    switch (actionKind) {
        case 0: return 4;   // 待機
        case 1: return 1;   // 出撃
        case 2: return 2;   // 防空
        case 3: return 3;   // 退避
        case 4: return 8;   // 休息
        default: return 1;
    }
}

/**
 * 該顯示碼對應的疲勞值下限（橙 20／赤 0）；非疲勞碼回 null。
 *
 * ⚠️ 顯示碼是 **2=橙／3=赤**（0、1 都無標記）——見 `GameState.lbasCondState` 的四段對照。
 * 寫錯這裡的後果是「橙/赤的算成沒疲勞、完全不做回復推論」。
 */
function bandMin(cond: number | null): number | null {
    if (cond === LBAS_COND_TIRED) return LBAS_COND_TIRED_MIN;
    if (cond === LBAS_COND_EXHAUSTED) return 0;
    return null;
}

/** 該顯示碼對應的疲勞值上限（橙 29／赤 19）；非疲勞碼回 null */
function bandMax(cond: number | null): number | null {
    if (cond === LBAS_COND_TIRED) return LBAS_COND_NO_MARK_MIN - 1;
    if (cond === LBAS_COND_EXHAUSTED) return LBAS_COND_TIRED_MIN - 1;
    return null;
}

/**
 * 經過 `ageMs` 之後，**保證**至少已經好到哪一段——回傳降級後的顯示碼。
 *
 * 回復是連續的：赤 → 橙 → 無標記；因此先判定是否已回到橙，再判定是否已進入無標記區，
 * 避免把仍在橙色區間的狀態誤標為赤色。
 * 0／1（本來就無標記）不做任何推論，原樣回傳。
 */
export function lbasCondDowngrade(cond: number | null, rate: number, ageMs: number): number | null {
    const min = bandMin(cond);
    if (min === null) return cond;
    const safeRate = rate > 0 ? rate : 1;
    const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
    const guaranteed = min + safeRate * Math.floor(age / LBAS_COND_TICK_MS);
    if (guaranteed >= LBAS_COND_NO_MARK_MIN) return LBAS_COND_MILD;
    if (guaranteed >= LBAS_COND_TIRED_MIN) return LBAS_COND_TIRED;
    return LBAS_COND_EXHAUSTED;
}

/**
 * 從收到該筆封包起算，**保證**回到無標記所需的毫秒數；本來就沒有標記（或未知碼）回 null。
 *
 * 長度 L 的時間窗一定含有 `floor(L / tick)` 個 tick，故 `ceil(需要的回復量 / 每tick回復量)`
 * 個 tick 的時間一到就必定已經回復——這是下限推論不是估算。
 */
export function lbasCondClearsInMs(cond: number | null, rate: number): number | null {
    const min = bandMin(cond);
    if (min === null) return null;
    const need = LBAS_COND_NO_MARK_MIN - min;
    const safeRate = rate > 0 ? rate : 1;
    return Math.ceil(need / safeRate) * LBAS_COND_TICK_MS;
}

/** 經過 `ageMs` 之後，這個疲勞標記是否**必定**已經消失 */
export function lbasCondCertainlyClear(cond: number | null, rate: number, ageMs: number): boolean {
    const needMs = lbasCondClearsInMs(cond, rate);
    if (needMs === null) return false;
    if (!Number.isFinite(ageMs) || ageMs < 0) return false;
    return ageMs >= needMs;
}

/**
 * 疲勞標記的**把握程度**——面板要據此決定「斷言」還是「存疑」。
 *
 * 封包只給顯示碼，所以收到的當下我們只知道值落在一個區間（橙＝20–29、赤＝0–19）。
 * 時間一過，區間整段往上平移 `rate × tick 數`：
 *   · 區間**下**限已達 30 → `clear`：連最差情況都回復了，標記必定消失（可放心不顯示）
 *   · 區間**上**限已達 30 → `possiblyRecovered`：**可能已經退掉了，但不能斷定**
 *   · 兩者皆未達 → `certain`：連最好情況都還在標記帶內，確定還在疲勞
 *
 * 出撃札的橙只要 3 分鐘就**可能**退掉，但要 30 分鐘才**保證**退掉；在兩者之間只能
 * 回傳「存疑」，面板不得把不確定的狀態當成確定結果。
 */
export function lbasCondCertainty(
    cond: number | null, rate: number, ageMs: number,
): 'certain' | 'possiblyRecovered' | 'clear' | null {
    const min = bandMin(cond);
    const max = bandMax(cond);
    if (min === null || max === null) return null;
    const safeRate = rate > 0 ? rate : 1;
    const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
    const gained = safeRate * Math.floor(age / LBAS_COND_TICK_MS);
    if (min + gained >= LBAS_COND_NO_MARK_MIN) return 'clear';
    if (max + gained >= LBAS_COND_NO_MARK_MIN) return 'possiblyRecovered';
    return 'certain';
}
