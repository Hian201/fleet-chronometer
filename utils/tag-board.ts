// 活動配船板核心：卡片狀態、欄位歸屬、slots→planByShip 遷移、路線檢查、艦種分組。
//
// 純函式、無 chrome.* 與 DOM（CLAUDE.md 設計原則 4）。標籤語意／名稱仍以
// utils/event-plan.ts 檔頭為準——本模組不猜測未驗證的 API 欄位。
import type { PlanStage, PlanTag, SallyShip } from './event-plan';

/** 配船卡片四態（相對「計畫標籤」與「實際 api_sally_area」）。 */
export type CardState = 'pool' | 'planned' | 'stamped' | 'mismatch';

/**
 * plan＝0 & actual＝0 → pool；
 * actual>0 & plan===actual → stamped；
 * actual>0 & plan!==actual → mismatch（即便 plan＝0）；
 * plan>0 & actual＝0 → planned。
 */
export function cardState(planTag: number, actualTag: number): CardState {
    const plan = planTag > 0 ? planTag : 0;
    const actual = actualTag > 0 ? actualTag : 0;
    if (actual > 0 && plan === actual) return 'stamped';
    if (actual > 0 && plan !== actual) return 'mismatch';
    if (plan > 0) return 'planned';
    return 'pool';
}

/**
 * 卡片應出現在哪一欄（0＝自由池）。
 * mismatch：plan>0 留在計畫欄，否則落到實際欄；stamped／planned 在其標籤欄；pool → 0。
 */
export function columnOf(planTag: number, actualTag: number): number {
    const plan = planTag > 0 ? planTag : 0;
    const actual = actualTag > 0 ? actualTag : 0;
    const state = cardState(plan, actual);
    if (state === 'pool') return 0;
    if (state === 'mismatch') return plan > 0 ? plan : actual;
    return plan > 0 ? plan : actual;
}

export interface MigrateSlotsResult {
    planByShip: Record<number, number>;
    /** 同艦已被先前關卡以不同 grantsTag 指派 → 後到者丟棄。 */
    dropped: { shipId: number; stageKey: string }[];
    /** 有 shipId 但該關 grantsTag 未填 → 無法歸屬。 */
    skipped: { shipId: number; stageKey: string }[];
}

/**
 * 把舊版 stages[].slots 一次性遷移成 planByShip。
 * 依 stages 出現順序；同一艦先到先得；grantsTag 為 null 的格無法歸屬（進 skipped）。
 */
export function migrateSlotsToPlanByShip(stages: PlanStage[]): MigrateSlotsResult {
    const planByShip: Record<number, number> = {};
    const dropped: { shipId: number; stageKey: string }[] = [];
    const skipped: { shipId: number; stageKey: string }[] = [];

    for (const stage of stages) {
        for (const slot of stage.slots) {
            if (slot.shipId == null) continue;
            const shipId = slot.shipId;
            if (!Number.isSafeInteger(shipId) || shipId < 1) continue;
            if (stage.grantsTag == null) {
                skipped.push({ shipId, stageKey: stage.key });
                continue;
            }
            const tag = stage.grantsTag;
            if (tag < 1) {
                skipped.push({ shipId, stageKey: stage.key });
                continue;
            }
            const existing = planByShip[shipId];
            if (existing == null) {
                planByShip[shipId] = tag;
            } else if (existing !== tag) {
                dropped.push({ shipId, stageKey: stage.key });
            }
            // 同標籤重複出現：略過（已指派）
        }
    }
    return { planByShip, dropped, skipped };
}

/** 計畫已宣告 ∪ 實際已貼 ∪ planByShip 鍵值的標籤 id（升冪）。 */
export function knownTagIds(
    planTags: PlanTag[],
    ships: SallyShip[],
    planByShip: Record<number, number> | undefined,
): number[] {
    const ids = new Set<number>();
    for (const tg of planTags) {
        if (tg.sallyArea > 0) ids.add(tg.sallyArea);
    }
    for (const s of ships) {
        if (s.sallyArea > 0) ids.add(s.sallyArea);
    }
    for (const raw of Object.values(planByShip ?? {})) {
        if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 1) ids.add(raw);
    }
    return [...ids].sort((a, b) => a - b);
}

export interface ColumnGroup {
    /** 跨關／未綁定 → 'SHARED'；否則為單一 mapNo。 */
    mapId: 'SHARED' | number;
    tags: number[];
}

/**
 * 欄位群組：maps.length≠1（跨關或多關／未綁）→ SHARED 置前；其餘依單一 mapNo 升冪。
 * tags 陣列內的標籤順序維持輸入順序。
 */
export function columnGroups(
    tags: { id: number; maps: number[] }[],
): ColumnGroup[] {
    const shared: number[] = [];
    const byMap = new Map<number, number[]>();
    for (const t of tags) {
        if (t.maps.length === 1) {
            const mapNo = t.maps[0]!;
            const list = byMap.get(mapNo);
            if (list) list.push(t.id); else byMap.set(mapNo, [t.id]);
        } else {
            shared.push(t.id);
        }
    }
    const groups: ColumnGroup[] = [];
    if (shared.length) groups.push({ mapId: 'SHARED', tags: shared });
    for (const mapNo of [...byMap.keys()].sort((a, b) => a - b)) {
        groups.push({ mapId: mapNo, tags: byMap.get(mapNo)! });
    }
    return groups;
}

export interface BoardBudget {
    free: number;
    planned: number;
    stamped: number;
    mismatch: number;
}

/** 全鎮守府四態計數（planByShip 缺鍵＝計畫 0）。 */
export function boardBudget(
    ships: SallyShip[],
    planByShip: Record<number, number> | undefined,
): BoardBudget {
    const plan = planByShip ?? {};
    let free = 0, planned = 0, stamped = 0, mismatch = 0;
    for (const s of ships) {
        const p = plan[s.id] ?? 0;
        switch (cardState(p, s.sallyArea)) {
            case 'pool': free++; break;
            case 'planned': planned++; break;
            case 'stamped': stamped++; break;
            case 'mismatch': mismatch++; break;
        }
    }
    return { free, planned, stamped, mismatch };
}

export interface RouteCheck {
    ok: number[];
    blocked: number[];
    willStamp: number[];
    /** allowedTags 空＝攻略未填，不判紅。 */
    unknown: boolean;
}

/**
 * 出擊檢查：以實際標籤為準；無標籤時若計畫標籤不在 allowed 且 ≠ grantsTag 亦判 blocked。
 * allowedTags 空 → unknown、不判紅。
 */
export function checkRoute(
    fleetShipIds: number[],
    ships: Map<number, SallyShip>,
    planByShip: Record<number, number> | undefined,
    allowedTags: number[],
    grantsTag: number | null,
): RouteCheck {
    if (allowedTags.length === 0) {
        return { ok: [], blocked: [], willStamp: [], unknown: true };
    }
    const allowed = new Set(allowedTags);
    const plan = planByShip ?? {};
    const ok: number[] = [];
    const blocked: number[] = [];
    const willStamp: number[] = [];

    for (const id of fleetShipIds) {
        if (!Number.isSafeInteger(id) || id < 1) continue;
        const ship = ships.get(id);
        if (!ship) continue;
        const actual = ship.sallyArea > 0 ? ship.sallyArea : 0;
        const planned = (plan[id] ?? 0) > 0 ? plan[id]! : 0;
        if (actual > 0) {
            if (allowed.has(actual)) ok.push(id);
            else blocked.push(id);
        } else if (planned > 0 && !allowed.has(planned) && planned !== grantsTag) {
            blocked.push(id);
        } else {
            willStamp.push(id);
        }
    }
    return { ok, blocked, willStamp, unknown: false };
}

/** 艦種分組（配船板列／自由池 `<details>`）。AV 收其餘未列 id。 */
export interface StypeGroupDef {
    key: string;
    stypeIds: number[];
    /** i18n key（例 ov.tbStypeCV）；AV 用 ov.tbStypeAV。 */
    labelKey: string;
}

export const DEFAULT_STYPE_GROUPS: readonly StypeGroupDef[] = [
    { key: 'CV', stypeIds: [11], labelKey: 'ov.tbStypeCV' },
    { key: 'CVL', stypeIds: [7], labelKey: 'ov.tbStypeCVL' },
    { key: 'BB', stypeIds: [8, 9], labelKey: 'ov.tbStypeBB' },
    { key: 'BBV', stypeIds: [10], labelKey: 'ov.tbStypeBBV' },
    { key: 'CA', stypeIds: [5], labelKey: 'ov.tbStypeCA' },
    { key: 'CAV', stypeIds: [6], labelKey: 'ov.tbStypeCAV' },
    { key: 'CL', stypeIds: [3], labelKey: 'ov.tbStypeCL' },
    { key: 'CLT', stypeIds: [4], labelKey: 'ov.tbStypeCLT' },
    { key: 'DD', stypeIds: [2], labelKey: 'ov.tbStypeDD' },
    { key: 'DE', stypeIds: [1], labelKey: 'ov.tbStypeDE' },
    { key: 'SS', stypeIds: [13, 14], labelKey: 'ov.tbStypeSS' },
    // 其餘（裝甲空母／水母／揚陸／工作／潛母／補給…）一律 AV／補助
    { key: 'AV', stypeIds: [], labelKey: 'ov.tbStypeAV' },
] as const;

/** 依 stypeId 找分組；未命中明確組 → AV。 */
export function stypeGroupKey(stypeId: number): string {
    for (const g of DEFAULT_STYPE_GROUPS) {
        if (g.key === 'AV') continue;
        if (g.stypeIds.includes(stypeId)) return g.key;
    }
    return 'AV';
}

export const TAG_COLOR_COUNT = 13;

/** 標籤 id → 預設色位 1–13（穩定、不因清單重排而變）。 */
export function defaultColorForTag(id: number): number {
    const n = Number.isSafeInteger(id) && id >= 1 ? id : 1;
    return ((n - 1) % TAG_COLOR_COUNT) + 1;
}

/** 正規化色位；非法／缺省 → defaultColorForTag。 */
export function resolveTagColor(tag: PlanTag): number {
    const c = tag.color;
    if (typeof c === 'number' && Number.isSafeInteger(c) && c >= 1 && c <= TAG_COLOR_COUNT) return c;
    return defaultColorForTag(tag.sallyArea);
}

/**
 * 從 stages 推各標籤綁定的 mapNo（只認 grantsTag＋有 mapNo 的列）。
 * 多個 mapNo → 跨關；空 → 未綁定（columnGroups 會歸 SHARED）。
 */
export function mapsForTag(stages: PlanStage[], tagId: number): number[] {
    const maps = new Set<number>();
    for (const st of stages) {
        if (st.grantsTag === tagId && st.mapNo != null && st.mapNo > 0) maps.add(st.mapNo);
    }
    return [...maps].sort((a, b) => a - b);
}

/** 寫入 planByShip：toTag≤0 刪鍵（回自由池）；≥1 設值。不改動 stamped（呼叫端擋）。 */
export function assignPlanTag(
    planByShip: Record<number, number>,
    shipId: number,
    toTag: number,
): Record<number, number> {
    const next = { ...planByShip };
    if (!Number.isSafeInteger(shipId) || shipId < 1) return next;
    if (toTag <= 0) delete next[shipId];
    else next[shipId] = toTag;
    return next;
}

/** planByShip 是否可視為「尚未遷移／空」——缺欄或無任何 ≥1 的指派。 */
export function isPlanByShipEmpty(planByShip: Record<number, number> | undefined): boolean {
    if (!planByShip) return true;
    return !Object.values(planByShip).some(v => typeof v === 'number' && v >= 1);
}

/** stages 是否仍有可遷移的 shipId 格。 */
export function stagesHaveShipSlots(stages: PlanStage[]): boolean {
    return stages.some(st => st.slots.some(sl => sl.shipId != null));
}
