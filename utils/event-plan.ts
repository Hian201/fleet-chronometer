// 活動作戰板：出擊標籤（api_sally_area）的分群、關卡標籤約束檢查與自由身消耗預告。
//
// 純函式、無 chrome.* 與 DOM，可獨立編譯用 node 餵資料驗證（CLAUDE.md 設計原則 4）。
//
// ── 機制前提（使用者提供，2026-07-21）──────────────────────────────────
// 1. 標籤是**船身上的屬性**，不是編成的容器。一艘船同時只能有一個標籤，貼上後不可逆。
// 2. 貼標時機是**出擊**，由「關卡＋路線」決定，事前無從指定——提督再怎麼安排，
//    最終以出擊實際貼上的為準。故本模組一律以 api_sally_area 為權威，計畫只是意圖標註。
// 3. 關卡按標籤限制路線：**特定的標籤組合才能走特定路線**（allowedTags）。
// 4. 帶無標籤船出擊，該船會被貼上**該關卡會給的標籤**（grantsTag）——與 allowedTags 是
//    兩件不同的事：E2 可能允許 A 標籤的船進入，但無標籤船走某路線會被貼上 B 標籤。
// 5. 標籤 id 全活動唯一、只增不減；後段沿用前段的船時標籤 id 繼續沿用，故一次活動一份計畫。
//
// ── 尚未實測（別當成已驗證）────────────────────────────────────────────
// · api_sally_area 欄位名已用真封包確認（samples/slot_to_port.json），但所有樣本都取自
//   非活動期、值全為 0——「id N 對應遊戲裡哪個標籤」的語意未實測。
// · **標籤名不存在於任何已知封包**：start2 的 master 表清單沒有標籤表，上次活動的出擊紀錄
//   （samples/61-5-jibun-rengou-node52.json，KC3Kai logger 匯出）遞迴掃過 189 個 key
//   零命中——但該檔只含戰鬥封包、不含母港類封包，故**答不了這題**，只能算方向一致。
//   第三方工具（KC3Kai／poi）都手維護標籤名表，通常也代表 API 給不出字串。
//   因此 PlanTag.name 目前一律手動命名；auto 分支（nameSource='auto'）預留但**永遠不會
//   被寫入**，直到 state.ts wantedTag 的標籤驗證鉤子在活動期間撈到真封包為止。
// · allowedTags／grantsTag 是攻略情報，API 不提供完整表；手輸之外，出擊觀測只把 0→N
//   寫成「這張圖會新貼的標籤」。已貼標艦再出不改 grants——後段船回打前段時，會把後段
//   標籤誤掛成 E1 會蓋章。跨關使用改寫 PlanTag.columnMaps（且只往編號 ≥ 已歸類最小關
//   的方向補），讓第三十一戦隊這類札能出現在 E2／E3，卻不會把 E5 札塞進 E1。

// ── 輸入 view ──────────────────────────────────────────────────────────
/** 檢查所需的最小艦娘資訊。取自 GameState.ownedShips()，此處刻意不依賴完整 OwnedShipView。 */
export interface SallyShip {
    id: number;          // 艦實例 id（api_id）
    name: string;
    sallyArea: number;   // 0＝無標籤
}

/** 活動作戰板目前採用的標籤資料來源。 */
export type SallyRosterSource = 'live' | 'snapshot' | 'none';

export interface SallyRosterResolution {
    /**
     * live：目前選定的活動仍在 master，且名冊有非零 api_sally_area。
     * snapshot：不能用即時標籤時，從該活動計畫的歷史快照還原。
     * none：兩者皆不可用；仍回傳目前名冊，但所有標籤均為 0。
     */
    source: SallyRosterSource;
    ships: SallyShip[];
    /** 快照中已不在目前名冊的艦實例 id；呼叫端不得據此猜測艦名或 master id。 */
    missingShipIds: number[];
}

const validSallyArea = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** 從目前名冊擷取可保存的非零標籤。沒有可確認資料時回傳空物件。 */
export function sallySnapshotFrom(ships: SallyShip[]): Record<number, number> {
    const snapshot: Record<number, number> = {};
    for (const ship of ships) {
        if (Number.isSafeInteger(ship.id) && ship.id > 0 && validSallyArea(ship.sallyArea)) {
            snapshot[ship.id] = ship.sallyArea;
        }
    }
    return snapshot;
}

/** JSON／IndexedDB 往返後鍵序不保證一致，故以鍵值集合比較快照內容。 */
export function sameSallySnapshot(
    a: Record<number, number> | undefined,
    b: Record<number, number>,
): boolean {
    const aEntries = Object.entries(a ?? {});
    const bEntries = Object.entries(b);
    return aEntries.length === bEntries.length
        && aEntries.every(([id, area]) => b[Number(id)] === area);
}

const EVENT_AREA_MIN = 10;

/** master 已載入、且該 area 已不在海域清單 → 本次活動結束。 */
export function isEventBoardExpired(masterPresent: boolean, areaInMaster: boolean): boolean {
    return masterPresent && !areaInMaster;
}

/**
 * 配船板要列出的活動 area。master 在時只認目前海域清單裡的活動圖——標籤分類是單次
 * 活動限定，結束後不沿用 gauge／舊計畫。master 還沒到才退回 fallback（gauge、已存計畫）。
 */
export function liveEventAreas(
    masterEventAreaIds: number[],
    masterPresent: boolean,
    fallbackAreaIds: number[] = [],
): number[] {
    const clean = (ids: number[]) => [...new Set(ids.filter(n => Number.isSafeInteger(n) && n >= EVENT_AREA_MIN))]
        .sort((a, b) => a - b);
    const live = clean(masterEventAreaIds);
    if (masterPresent) return live;
    return clean([...live, ...fallbackAreaIds]);
}

export function eventPlanHasBoardData(plan: {
    title: string;
    tags: unknown[];
    stages: unknown[];
    planByShip?: Record<number, number>;
    observedGrants?: Record<number, number[]>;
    sallySnapshot?: Record<number, number>;
    unlocked?: boolean;
}): boolean {
    if (plan.title.trim() || plan.tags.length || plan.stages.length || plan.unlocked) return true;
    if (Object.keys(plan.planByShip ?? {}).length) return true;
    if (Object.keys(plan.observedGrants ?? {}).length) return true;
    if (Object.keys(plan.sallySnapshot ?? {}).length) return true;
    return false;
}

/**
 * 決定是否以目前即時資料更新某個活動計畫的快照。
 *
 * 只允許目前仍存在於 master 的活動寫入；這避免使用者切到歷史計畫時，把另一個活動
 * 的 api_sally_area 寫進去。空即時資料不能覆蓋既有歷史快照；相同內容亦不需重寫 DB。
 */
export function nextSallySnapshot(
    current: Record<number, number> | undefined,
    liveShips: SallyShip[],
    areaIsCurrentInMaster: boolean,
): Record<number, number> | null {
    if (!areaIsCurrentInMaster) return null;
    const snapshot = sallySnapshotFrom(liveShips);
    if (Object.keys(snapshot).length === 0 || sameSallySnapshot(current, snapshot)) return null;
    return snapshot;
}

/**
 * 選擇活動作戰板的完整標籤名冊。即時資料與歷史快照互斥，絕不混成一份看似即時的資料：
 * 只有「選定 area 仍在目前 master 且有非零標籤」才使用 live。
 * master 已載入但該 area 已不在海域清單＝本次活動結束：不讀快照，配船板留空等下一檔。
 * master 尚未載入時才回退快照，避免 start2 還沒到就把當次計畫洗掉。
 */
export function resolveSallyRoster(
    liveShips: SallyShip[],
    snapshot: Record<number, number> | undefined,
    areaIsCurrentInMaster: boolean,
    masterPresent = false,
): SallyRosterResolution {
    if (areaIsCurrentInMaster && Object.keys(sallySnapshotFrom(liveShips)).length > 0) {
        return { source: 'live', ships: liveShips, missingShipIds: [] };
    }
    if (isEventBoardExpired(masterPresent, areaIsCurrentInMaster)) {
        return {
            source: 'none',
            ships: liveShips.map(ship => ({ ...ship, sallyArea: 0 })),
            missingShipIds: [],
        };
    }

    const usableSnapshot = Object.entries(snapshot ?? {})
        .filter(([, area]) => validSallyArea(area));
    if (!usableSnapshot.length) {
        return {
            source: 'none',
            ships: liveShips.map(ship => ({ ...ship, sallyArea: 0 })),
            missingShipIds: [],
        };
    }

    const liveIds = new Set(liveShips.map(ship => ship.id));
    const byShipId = new Map(usableSnapshot.map(([id, area]) => [Number(id), area]));
    return {
        source: 'snapshot',
        ships: liveShips.map(ship => ({ ...ship, sallyArea: byShipId.get(ship.id) ?? 0 })),
        missingShipIds: usableSnapshot.map(([id]) => Number(id))
            .filter(id => !liveIds.has(id)).sort((a, b) => a - b),
    };
}

/** 標籤。sallyArea 是權威 key（來自遊戲）；name 目前只能手填，見檔頭。 */
export interface PlanTag {
    sallyArea: number;
    name: string;
    nameSource: 'auto' | 'manual';
    /** auto 覆蓋手填名時保留原值，供一鍵還原。 */
    manualName?: string;
    /**
     * 配船板欄色（1–13，對應 CSS `--tag-N`）。存起來才不會因標籤增減而重排配色。
     * 缺省時 UI 用 `defaultColorForTag(sallyArea)`（見 utils/tag-board.ts）。
     */
    color?: number;
    /**
     * 配船板欄位歸屬的關卡（E1＝1…）。空＝未歸類。
     * 與 grantsTag 分開：grants 是「這關會新蓋章」；這裡是「這張札用在哪些關」。
     * 第三十一戦隊這類跨關札會同時出現在 E1／E2／E3，不該整疊進未歸類。
     */
    columnMaps?: number[];
}

/** 編成一格：綁具體艦，或只填角色文字（「二線戰艦」「大發驅逐」）待日後指定。 */
export interface PlanSlot {
    shipId?: number;
    role?: string;
}

/** 關卡／解謎步驟。allowedTags 空陣列＝尚未填寫攻略情報，不可據以判紅。 */
export interface PlanStage {
    key: string;
    label: string;           // 「E4-3」「E5 解謎 3」
    allowedTags: number[];   // 哪些標籤的船可以走這條路線
    grantsTag: number | null; // 無標籤船出擊後會被貼上的標籤；null＝未填
    slots: PlanSlot[];
    /**
     * 對應的**真實海域序號**（1＝E1…）。海域 key＝`areaId * 10 + mapNo`——使用者說明的
     * 「61-5 就是 E5」即此結構，故本次活動 area 62 的 E1 就是 621。
     *
     * 為什麼非有不可：`label` 是自由文字（「E4-3」「E5 解謎 1」），程式無從得知那一列對應
     * 遊戲的哪張圖，也就無法拿實際觀測去校對。null＝尚未指定，此時不做任何實際對照。
     * **多個關卡列可以指向同一個 mapNo**（E4-1／E4-2／E4-3 都是 E4 的不同階段）。
     */
    mapNo?: number | null;
    /**
     * 這是某張圖底下的「階段」子列（E4-1／E4-2／E4 解謎 1…）而非該圖的主列。
     *
     * 為什麼需要：關卡列是從遊戲的海域清單自動產生的、一圖一列，但同一張圖的不同階段
     * ／路線**可以有不同的標籤約束**（使用者的 E2 就同時存在兩個標籤）。主列表達「這張圖的
     * 預設安排」，階段子列表達各階段的個別安排；兩者都是完整的 PlanStage，故所有檢查
     * （checkStage／plannedByTag／findPlanConflicts）不必特別處理階段，照舊逐列跑即可。
     */
    phase?: boolean;
}

// ── 燈號 ───────────────────────────────────────────────────────────────
export type SlotStatus =
    | 'ok'         // 已持有本關卡允許的標籤
    | 'blocked'    // 持有**別的**標籤 → 這隊走不了這條路線，得換人
    | 'willStamp'  // 無標籤 → 出擊後會被貼上 grantsTag，**不可逆消耗**
    | 'unknown'    // 本關卡未填 allowedTags，無從判定（不判紅）
    | 'role'       // 只填了角色文字，還沒指定艦
    | 'gone';      // 指定的艦已不在（解體／改造前後 api_id 不變，故多半是解體）

export interface SlotCheck {
    status: SlotStatus;
    shipId: number | null;
    name: string;        // 具體艦＝艦名；role 格＝角色文字；gone＝空字串
    sallyArea: number;   // 該艦目前的標籤；無艦時為 0
}

export interface StageCheck {
    stageKey: string;
    slots: SlotCheck[];
    /** 出擊後會被貼標籤的無標籤艦 id（不可逆消耗預告）。 */
    willStamp: number[];
    /** 持有標籤不在 allowedTags 內、擋住這條路線的艦 id。 */
    blocked: number[];
    /** 這一格能不能出：只要有任何 blocked 就不行。 */
    passable: boolean;
}

// ── 關卡列與遊戲海域的對應 ─────────────────────────────────────────────
/**
 * 從關卡名稱推測對應海域序號。使用者的寫法「E-1」「E4-3」「E5 解謎 1」裡，
 * **E 後面的第一個數字才是海域**（E4-3 是 E4 的第 3 階段，不是 E3）。
 * 只在尚未指定 mapNo 時當預設值用，永不覆寫既有值。
 */
export function guessMapNo(label: string): number | null {
    const m = /E[\s-]*(\d+)/i.exec(label);
    const n = m ? Number(m[1]) : NaN;
    return Number.isInteger(n) && n > 0 && n < 100 ? n : null;
}

/**
 * 產生不與 existing 碰撞的關卡 key。
 * 用 crypto.randomUUID（擴充／現代瀏覽器／Node 皆有）；绝不靠 Date.now 毫秒字串。
 */
export function newStageKey(existing: Iterable<string>): string {
    const taken = existing instanceof Set ? existing : new Set(existing);
    for (let i = 0; i < 32; i++) {
        const key = typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID()
            : `k${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        if (!taken.has(key)) return key;
    }
    let n = 0;
    while (taken.has(`kfallback-${n}`)) n++;
    return `kfallback-${n}`;
}

/**
 * 保守修復空 key／重複 key：保留每一列內容，只改後出現的重複（或空）key。
 * **不刪列**——db.eventPlans 是手輸資料，不能從 events 重投影。
 */
export function ensureUniqueStageKeys(stages: PlanStage[]): { stages: PlanStage[]; changed: boolean } {
    const seen = new Set<string>();
    let changed = false;
    const out = stages.map(st => {
        if (st.key && !seen.has(st.key)) {
            seen.add(st.key);
            return st;
        }
        changed = true;
        const key = newStageKey(seen);
        seen.add(key);
        return { ...st, key };
    });
    return { stages: out, changed };
}

/** 依陣列索引刪一列（髒資料同 key 多列時，刪除只動被點那一列）。 */
export function removeStageAt(stages: PlanStage[], index: number): PlanStage[] {
    if (!Number.isInteger(index) || index < 0 || index >= stages.length) return stages;
    return stages.filter((_, i) => i !== index);
}

/**
 * 把計畫的關卡列對齊遊戲提供的海域清單：一圖一個「主列」，其後接該圖的「階段子列」。
 *
 * **這支的首要職責是不丟資料**——關卡列改成自動產生後，既有計畫必須能無損接上：
 *   · 有 mapNo 的照 mapNo 對應；沒有的用 `guessMapNo(label)` 反推。
 *   · 同一張圖出現第二個主列 → 轉成階段子列，保留該列的資料。
 *   · 對應不上任何海域**但填過東西**的列（有編成／標籤約束）一律保留在末尾。
 *   · 對應不上又完全空白的才會消失——那本來就沒有資訊。
 *
 * maps 為空（活動已結束、master 沒有該區塊）時原樣返回：此時走手填模式，不該亂動。
 */
export function reconcileStages(stages: PlanStage[], maps: { no: number }[]): PlanStage[] {
    if (!maps.length) return stages;
    const known = new Set(maps.map(m => m.no));
    const base = new Map<number, PlanStage>();
    const phases = new Map<number, PlanStage[]>();
    const orphans: PlanStage[] = [];

    for (const st of stages) {
        const no = st.mapNo ?? guessMapNo(st.label);
        if (no != null && known.has(no)) {
            st.mapNo = no;
            if (st.phase || base.has(no)) {
                st.phase = true;
                const list = phases.get(no) ?? [];
                list.push(st);
                phases.set(no, list);
            } else {
                base.set(no, st);
            }
        } else if (st.slots.length || st.allowedTags.length || st.grantsTag != null) {
            orphans.push(st);
        }
    }

    return maps.flatMap(m => [
        base.get(m.no) ?? {
            key: `m${m.no}`, label: '', allowedTags: [], grantsTag: null, slots: [], mapNo: m.no,
        },
        ...(phases.get(m.no) ?? []),
    ]).concat(orphans);
}

// ── 分群 ───────────────────────────────────────────────────────────────
/**
 * 依 api_sally_area 分群。這是「標籤總帳」的資料來源，完全自動、零使用者輸入——
 * 一次回港（api_port/port 全量重建 this.ships）就是一次完整同步。
 * 回傳依標籤 id 升冪；無標籤艦不含在內（用 freeShips() 取）。
 */
export function groupBySally(ships: SallyShip[]): { sallyArea: number; ships: SallyShip[] }[] {
    const byTag = new Map<number, SallyShip[]>();
    for (const s of ships) {
        if (s.sallyArea <= 0) continue;
        const list = byTag.get(s.sallyArea);
        if (list) list.push(s); else byTag.set(s.sallyArea, [s]);
    }
    return [...byTag.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([sallyArea, list]) => ({ sallyArea, ships: list }));
}

/** 自由身：尚未被貼任何標籤，可投入任一關卡（但投入即綁死）。 */
export function freeShips(ships: SallyShip[]): SallyShip[] {
    return ships.filter(s => s.sallyArea <= 0);
}

// ── 關卡檢查 ───────────────────────────────────────────────────────────
/**
 * 逐格判定某關卡的可行性。ships 是 id → 艦的索引（呼叫端自行建，避免重複掃描）。
 *
 * allowedTags 為空＝攻略情報未填，此時一律回 'unknown'——**不可判紅**。使用者還沒填
 * 就滿江紅會讓整張表失去訊號價值。
 */
export function checkStage(stage: PlanStage, ships: Map<number, SallyShip>): StageCheck {
    const allowed = new Set(stage.allowedTags);
    const slots: SlotCheck[] = stage.slots.map(slot => {
        if (slot.shipId == null) {
            return { status: 'role' as const, shipId: null, name: slot.role ?? '', sallyArea: 0 };
        }
        const ship = ships.get(slot.shipId);
        if (!ship) {
            return { status: 'gone' as const, shipId: slot.shipId, name: '', sallyArea: 0 };
        }
        const base = { shipId: ship.id, name: ship.name, sallyArea: ship.sallyArea };
        if (allowed.size === 0) return { ...base, status: 'unknown' as const };
        if (ship.sallyArea <= 0) return { ...base, status: 'willStamp' as const };
        return { ...base, status: allowed.has(ship.sallyArea) ? ('ok' as const) : ('blocked' as const) };
    });

    return {
        stageKey: stage.key,
        slots,
        willStamp: slots.filter(s => s.status === 'willStamp').map(s => s.shipId!),
        blocked: slots.filter(s => s.status === 'blocked').map(s => s.shipId!),
        passable: !slots.some(s => s.status === 'blocked'),
    };
}

// ── 計畫矛盾 ───────────────────────────────────────────────────────────
export interface PlanConflict {
    shipId: number;
    name: string;
    /** 互相衝突的關卡 key（依 stages 出現順序）。 */
    stageKeys: string[];
    /**
     * certain：先跑的關卡會蓋上一個後者不接受的標籤 → 必定衝突，事前就該改。
     * possible：兩關卡的允許標籤有交集但無法確定會蓋上哪個 → 只提示，不判死。
     */
    severity: 'certain' | 'possible';
}

/**
 * 找出「同一艘**無標籤**艦被排進多個關卡，而先跑哪個會決定它從此進不了另一個」的矛盾。
 * 這是出擊前唯一擋得住的錯誤——貼上就不可逆。
 *
 * 已持有標籤的艦重複出現在多關卡不算矛盾（它的標籤已定，各關卡各自用 checkStage 判 ok/blocked）。
 *
 * certain 的判定用 grantsTag：A 關會蓋上標籤 X，而 B 關的 allowedTags 不含 X → 跑完 A 就進不了 B。
 * grantsTag 未填時退回看 allowedTags 是否相交——不相交必定衝突，相交則因為「無從得知會蓋上
 * 哪一個標籤」而只能報 possible。
 */
export function findPlanConflicts(stages: PlanStage[], ships: Map<number, SallyShip>): PlanConflict[] {
    const stagesByShip = new Map<number, PlanStage[]>();
    for (const stage of stages) {
        for (const slot of stage.slots) {
            if (slot.shipId == null) continue;
            const ship = ships.get(slot.shipId);
            if (!ship || ship.sallyArea > 0) continue;   // 已有標籤者不在此檢查範圍
            const list = stagesByShip.get(slot.shipId);
            if (list) { if (!list.includes(stage)) list.push(stage); }
            else stagesByShip.set(slot.shipId, [stage]);
        }
    }

    const conflicts: PlanConflict[] = [];
    for (const [shipId, list] of stagesByShip) {
        if (list.length < 2) continue;
        let severity: 'certain' | 'possible' | null = null;
        for (const a of list) {
            for (const b of list) {
                if (a === b) continue;
                if (b.allowedTags.length === 0) continue;   // 情報未填，不判
                const allowedB = new Set(b.allowedTags);
                if (a.grantsTag != null) {
                    if (!allowedB.has(a.grantsTag)) { severity = 'certain'; break; }
                } else if (a.allowedTags.length > 0) {
                    if (!a.allowedTags.some(tag => allowedB.has(tag))) severity = 'certain';
                    else if (severity == null) severity = 'possible';
                }
            }
            if (severity === 'certain') break;
        }
        if (severity) {
            conflicts.push({
                shipId,
                name: ships.get(shipId)?.name ?? '',
                stageKeys: list.map(s => s.key),
                severity,
            });
        }
    }
    return conflicts;
}

// ── 計畫歸屬 ───────────────────────────────────────────────────────────
/**
 * 計畫格相對於「實際貼標」的狀態。
 *   pending  ＝該艦仍無標籤，計畫尚未實現（出擊後會被貼上此標籤）
 *   fulfilled＝該艦已被貼上**此**標籤，計畫已實現，這筆計畫格是冗餘的
 *   conflict ＝該艦已被貼上**別的**標籤，這筆計畫格已失效，得換人
 */
export type PlannedState = 'pending' | 'fulfilled' | 'conflict';

export interface PlannedMember {
    shipId: number;
    name: string;
    /** 該艦目前的實際標籤；0＝無標籤。 */
    sallyArea: number;
    state: PlannedState;
    /** 來源計畫格，供 UI 提供「從計畫移除」的動作。 */
    stageKey: string;
    slotIndex: number;
}

/**
 * 計畫把哪些艦指向哪個標籤。key＝標籤 id。
 *
 * 存在理由：標籤總帳若只顯示「遊戲實際貼標」，計畫中的艦船不會出現在任何標籤下；並排
 * 顯示「實際」與「計畫」兩欄才能同時呈現觀測值與使用者意圖。
 *
 * 歸屬只認 `grantsTag`（該關卡會蓋上哪個標籤）。`grantsTag` 未填時**不猜**：我們無從得知
 * 那條路線會蓋上哪個標籤，硬用 `allowedTags` 反推會在多標籤共用的關卡上給出錯誤歸屬。
 *
 * **已持有標籤的艦也會列入**（標成 fulfilled／conflict）。這是刻意的：計畫會隨著實際出擊
 * 逐漸過期，使用者需要看到「這筆已經實現了／這筆已經失效」才知道要清掉哪一格。
 *
 * **刻意不去重**：同一艘無標籤艦若被排進兩個 grantsTag 不同的關卡，會同時出現在兩個標籤底下
 * ——那本來就是個必定衝突（`findPlanConflicts` 會報 certain），在兩邊都看得到才有辦法
 * 就地刪掉錯的那一格。計數用途請改用 `sallyBudget()`，那支有去重。
 */
export function plannedByTag(
    stages: PlanStage[], ships: Map<number, SallyShip>,
): Map<number, PlannedMember[]> {
    const byTag = new Map<number, PlannedMember[]>();
    for (const stage of stages) {
        const tag = stage.grantsTag;
        if (tag == null) continue;
        stage.slots.forEach((slot, slotIndex) => {
            if (slot.shipId == null) return;
            const ship = ships.get(slot.shipId);
            if (!ship) return;
            const state: PlannedState = ship.sallyArea === 0 ? 'pending'
                : ship.sallyArea === tag ? 'fulfilled' : 'conflict';
            const member: PlannedMember = {
                shipId: ship.id, name: ship.name, sallyArea: ship.sallyArea,
                state, stageKey: stage.key, slotIndex,
            };
            const list = byTag.get(tag);
            if (list) list.push(member); else byTag.set(tag, [member]);
        });
    }
    return byTag;
}

// ── 實際貼標觀測 ───────────────────────────────────────────────────────
// 「出擊結果才是唯一依歸」，故計畫裡的 grantsTag 必須能被實際觀測校正。
// 推論法＝某艦出擊前無標籤、回港後帶著標籤 N ⇒ 該次出擊的海域會貼出 N。
//
// **只認 0 → N** 寫進 grants。已貼標艦再出不改 grants：後段船回打前段時，編成裡會
// 帶著後段標籤，把它們算成該圖會蓋章會把 E1 塞滿。N → M 亦不採信。
// 跨關使用另見 observeUsedOnMaps：只補 columnMaps，且不把未歸類札的第一次歸類寫成
// 出擊過的那張圖。
//
// 已知限制（UI 必須如實呈現，別假裝這是完整答案）：
//   · 粒度只到「海域」。標籤由**海域＋路線**決定，同一張圖不同路線可貼不同標籤。
//   · 資料來源是 raw events，會被 M6 裁剪（約兩個登入世代），只涵蓋近期出擊。
export type SallyObservationInput =
    | { kind: 'sortie'; ts: number; mapKey: number; deckId?: number }
    | {
        kind: 'port';
        ts: number;
        tags: Map<number, number>;
        decks?: Map<number, number[]>;
        combined?: boolean;
    };

export interface GrantObservation {
    tagId: number;
    shipIds: number[];
    ts: number;
    /** 兩次母港封包之間出現多次出擊，無法斷定是哪一次貼上的。UI 應降低這筆的可信度。 */
    ambiguous: boolean;
}

/**
 * 依時序掃過出擊／母港封包，推論各海域實際貼出過哪些標籤。key＝mapKey。
 * inputs 必須已按事件順序排好；本函式不排序（呼叫端用 raw event id 排序即可）。
 */
export function observeGrantedTags(
    inputs: SallyObservationInput[],
): Map<number, GrantObservation[]> {
    const out = new Map<number, GrantObservation[]>();
    let prev: Map<number, number> | null = null;
    let sinceLastPort: Extract<SallyObservationInput, { kind: 'sortie' }>[] = [];

    for (const input of inputs) {
        if (input.kind === 'sortie') {
            sinceLastPort.push(input);
            continue;
        }

        // 第一筆母港只建立基準線——沒有「之前」就無從判斷轉變。
        if (prev) {
            const byTag = new Map<number, number[]>();
            for (const [shipId, tag] of input.tags) {
                if (tag <= 0) continue;
                if ((prev.get(shipId) ?? 0) !== 0) continue;   // 只認 0 → N
                const list = byTag.get(tag);
                if (list) list.push(shipId); else byTag.set(tag, [shipId]);
            }
            const source = sinceLastPort[sinceLastPort.length - 1];
            if (byTag.size && source && source.mapKey > 0) {
                for (const [tagId, shipIds] of byTag) {
                    const list = out.get(source.mapKey) ?? [];
                    list.push({
                        tagId, shipIds, ts: input.ts,
                        ambiguous: sinceLastPort.length > 1,
                    });
                    out.set(source.mapKey, list);
                }
            }
        }
        prev = input.tags;
        sinceLastPort = [];
    }
    return out;
}

/** 某海域實際貼出過的標籤 id（升冪、去重）。 */
export function grantedTagsOf(
    observations: Map<number, GrantObservation[]>, mapKey: number,
): number[] {
    return [...new Set((observations.get(mapKey) ?? []).map(o => o.tagId))].sort((a, b) => a - b);
}

/**
 * 已貼標艦實際出過哪些圖。key＝mapKey，值＝當時編成身上的標籤。
 * 只讀出擊前一次母港的艦隊；缺 deck 或 deckId 就不猜。連合且從第 1 艦隊出擊時
 * 才併入第 2 艦隊。這不是 grants——後段札回打 E1 不得因此變成「E1 會蓋章」。
 */
export function observeUsedOnMaps(
    inputs: SallyObservationInput[],
): Map<number, number[]> {
    const used = new Map<number, Set<number>>();
    let prevTags: Map<number, number> | null = null;
    let prevDecks: Map<number, number[]> | null = null;
    let prevCombined = false;

    for (const input of inputs) {
        if (input.kind === 'port') {
            prevTags = input.tags;
            prevDecks = input.decks ?? null;
            prevCombined = !!input.combined;
            continue;
        }
        const deckId = input.deckId;
        if (!prevTags || !prevDecks || !(input.mapKey > 0)
            || !Number.isSafeInteger(deckId) || !(deckId! > 0)) continue;
        const shipIds = [...(prevDecks.get(deckId!) ?? [])];
        if (deckId === 1 && prevCombined) shipIds.push(...(prevDecks.get(2) ?? []));
        const tags = new Set<number>();
        for (const shipId of shipIds) {
            const tag = prevTags.get(shipId) ?? 0;
            if (tag >= 1) tags.add(tag);
        }
        if (!tags.size) continue;
        const have = used.get(input.mapKey) ?? new Set<number>();
        for (const tag of tags) have.add(tag);
        used.set(input.mapKey, have);
    }

    const out = new Map<number, number[]>();
    for (const [mapKey, ids] of used) {
        out.set(mapKey, [...ids].sort((a, b) => a - b));
    }
    return out;
}

/**
 * 該標籤是否「已確立」＝遊戲裡實際已有船帶著它。
 * 已確立的標籤與其關卡約束應鎖定不可改（見 CLAUDE.md「活動作戰板」的鎖定規則）：
 * 實際貼標是不可逆的事實，計畫端再去改名或改約束只會讓兩邊對不上。
 */
export function establishedTags(ships: SallyShip[]): Set<number> {
    return new Set(ships.filter(s => s.sallyArea > 0).map(s => s.sallyArea));
}

// ── 標籤預算 ─────────────────────────────────────────────────────────────
export interface SallyBudget {
    /** 目前尚無標籤的艦數。 */
    free: number;
    /** 各標籤目前實際鎖住的艦數（依標籤 id 升冪）。 */
    locked: { sallyArea: number; count: number }[];
    /** 計畫中將被消耗的自由身：去重後的艦 id（同一艘被多關卡排到只算一次）。 */
    plannedStamp: number[];
    /** 計畫跑完後預估剩下的自由身。不會低於 0。 */
    freeAfterPlan: number;
}

/**
 * 活動全域的標籤資源盤點。這本質是分配問題——無標籤船投入哪個關卡＝決定它被綁在哪，
 * 所以總覽要能一眼看到「還剩幾艘自由身、計畫會吃掉幾艘」。
 */
export function sallyBudget(stages: PlanStage[], ships: SallyShip[]): SallyBudget {
    const byId = new Map(ships.map(s => [s.id, s]));
    const stamp = new Set<number>();
    for (const stage of stages) {
        for (const slot of stage.slots) {
            if (slot.shipId == null) continue;
            const ship = byId.get(slot.shipId);
            if (ship && ship.sallyArea <= 0) stamp.add(ship.id);
        }
    }
    const free = freeShips(ships).length;
    return {
        free,
        locked: groupBySally(ships).map(g => ({ sallyArea: g.sallyArea, count: g.ships.length })),
        plannedStamp: [...stamp],
        freeAfterPlan: Math.max(0, free - stamp.size),
    };
}
