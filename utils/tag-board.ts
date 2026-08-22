// 活動配船板核心：卡片狀態、欄位歸屬、slots→planByShip 遷移、路線檢查、艦種分組。
//
// 純函式、無 chrome.* 與 DOM（CLAUDE.md 設計原則 4）。標籤語意／名稱仍以
// utils/event-plan.ts 檔頭為準——本模組不猜測未驗證的 API 欄位。
import type { PlanStage, PlanTag, SallyShip } from './event-plan';
import { newStageKey } from './event-plan';

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
    /** 同艦被不同 grantsTag 指派時，後續指派無法唯一歸屬，列入 dropped。 */
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
 * 無 master 海域清單時用這支；有 master 時改用 `columnGroupsWithMaps`，確保 E1–En 空關也出現。
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

/**
 * 依遊戲海域清單固定排出 E1…En（可為空欄），再把標籤歸入對應關卡。
 * - maps 恰為 1 且該 mapNo 在 master 內 → 該關
 * - 其餘（未綁／跨關／orphan mapNo）→ SHARED（僅在有此類標籤時出現）
 * master 為空時退回 `columnGroups(tags)`。
 */
export function columnGroupsWithMaps(
    masterMapNos: number[],
    tags: { id: number; maps: number[] }[],
): ColumnGroup[] {
    const maps = masterMapNos.filter(n => Number.isSafeInteger(n) && n > 0);
    if (!maps.length) return columnGroups(tags);

    const known = new Set(maps);
    const shared: number[] = [];
    const byMap = new Map<number, number[]>(maps.map(n => [n, []]));
    for (const t of tags) {
        if (t.maps.length === 1 && known.has(t.maps[0]!)) {
            byMap.get(t.maps[0]!)!.push(t.id);
        } else {
            shared.push(t.id);
        }
    }
    const groups: ColumnGroup[] = [];
    if (shared.length) groups.push({ mapId: 'SHARED', tags: shared });
    for (const mapNo of maps) {
        groups.push({ mapId: mapNo, tags: byMap.get(mapNo) ?? [] });
    }
    return groups;
}

/**
 * 遊戲已貼標（actual>0）時，計畫必須跟實際走——貼標不可逆，沒有「套不套用」的選擇。
 * 回傳是否有變更（呼叫端決定要不要寫回 DB）。
 */
export function syncPlanFromActual(
    planByShip: Record<number, number>,
    ships: SallyShip[],
): { planByShip: Record<number, number>; changed: boolean } {
    let changed = false;
    const next = { ...planByShip };
    for (const s of ships) {
        if (!(s.sallyArea > 0)) continue;
        if (next[s.id] !== s.sallyArea) {
            next[s.id] = s.sallyArea;
            changed = true;
        }
    }
    return { planByShip: next, changed };
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
    // 裝甲空母（stype 18）可搭載艦載機出擊，獨立一組放在正規／輕空母之間，避免與水母／
    // 工作艦等輔助艦混組而難以定位。
    { key: 'CVB', stypeIds: [18], labelKey: 'ov.tbStypeCVB' },
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
    // 其餘（水母／揚陸／工作／潛母／補給…）一律 AV／補助
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

/** 把 live 觀測併入計畫內持久化的 observedGrants（只增不減）。 */
export function mergeObservedGrants(
    stored: Record<number, number[]> | undefined,
    live: Map<number, { tagId: number }[]>,
): { stored: Record<number, number[]>; observations: Map<number, { tagId: number }[]>; changed: boolean } {
    const next: Record<number, number[]> = {};
    for (const [rawKey, ids] of Object.entries(stored ?? {})) {
        const mapKey = Number(rawKey);
        if (!Number.isSafeInteger(mapKey) || mapKey < 1) continue;
        const clean = [...new Set(ids.filter(id => Number.isSafeInteger(id) && id >= 1))]
            .sort((a, b) => a - b);
        if (clean.length) next[mapKey] = clean;
    }
    let changed = false;
    for (const [mapKey, list] of live) {
        if (!(mapKey > 0)) continue;
        const have = new Set(next[mapKey] ?? []);
        const before = have.size;
        for (const o of list) {
            if (Number.isSafeInteger(o.tagId) && o.tagId >= 1) have.add(o.tagId);
        }
        if (have.size !== before || !(mapKey in next)) {
            next[mapKey] = [...have].sort((a, b) => a - b);
            changed = true;
        }
    }
    // 鍵集合是否與 stored 相同（首次寫入也算 changed）
    if (!changed) {
        const oldKeys = Object.keys(stored ?? {}).map(Number).sort((a, b) => a - b);
        const newKeys = Object.keys(next).map(Number).sort((a, b) => a - b);
        if (oldKeys.length !== newKeys.length || oldKeys.some((k, i) => k !== newKeys[i])) {
            changed = true;
        } else {
            for (const k of newKeys) {
                const a = (stored ?? {})[k] ?? [];
                const b = next[k] ?? [];
                if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
                    changed = true;
                    break;
                }
            }
        }
    }
    const observations = new Map<number, { tagId: number }[]>();
    for (const [mapKey, ids] of Object.entries(next)) {
        observations.set(Number(mapKey), ids.map(tagId => ({ tagId })));
    }
    return { stored: next, observations, changed };
}

function bindTagToMap(
    nextStages: PlanStage[],
    mapNo: number,
    tagId: number,
): boolean {
    if (nextStages.some(s => s.mapNo === mapNo && s.grantsTag === tagId)) return false;
    const base = nextStages.find(s => s.mapNo === mapNo && !s.phase)
        ?? nextStages.find(s => s.mapNo === mapNo);
    if (base && base.grantsTag == null) {
        base.grantsTag = tagId;
        if (!base.allowedTags.includes(tagId)) base.allowedTags.push(tagId);
        return true;
    }
    const phaseCount = nextStages.filter(s => s.mapNo === mapNo && s.phase).length;
    const key = newStageKey(nextStages.map(s => s.key));
    nextStages.push({
        key,
        label: `E${mapNo}#${phaseCount + 1}`,
        allowedTags: [tagId],
        grantsTag: tagId,
        slots: [],
        mapNo,
        phase: true,
    });
    return true;
}

/**
 * 從出擊觀測把「這張圖實際貼出過哪些標籤」寫進 stages／tags。
 * 出擊後釘死的事實不該永遠手按「＋再加標籤」——自動確保標籤條目存在，並綁到對應 mapNo
 * （主列 grants 空則填上；已綁別標籤則新增階段）。不覆寫既有不同的 grantsTag。
 *
 * 若某標籤已有觀測地圖集合，會清掉「不在觀測內」的 grants 綁定，避免標籤留在錯誤關卡，
 * 不猜 allowedTags——「可帶哪些已貼標船」與「無標籤會被貼什麼」是兩件事。
 */
export function applyObservedTagBindings(
    stages: PlanStage[],
    tags: PlanTag[],
    areaId: number,
    masterMapNos: number[],
    observations: Map<number, { tagId: number }[]>,
): { stages: PlanStage[]; tags: PlanTag[]; changed: boolean } {
    let changed = false;
    const nextStages = stages.map(s => ({
        ...s,
        allowedTags: [...s.allowedTags],
        slots: s.slots.map(sl => ({ ...sl })),
    }));
    const nextTags = tags.map(tg => ({ ...tg }));
    const haveTag = new Set(nextTags.map(tg => tg.sallyArea));

    const ensureTag = (tagId: number) => {
        if (haveTag.has(tagId)) return;
        nextTags.push({
            sallyArea: tagId, name: '', nameSource: 'manual',
            color: defaultColorForTag(tagId),
        });
        haveTag.add(tagId);
        changed = true;
    };

    /** 本活動內：標籤 → 曾觀測到貼標的 mapNo 集合 */
    const observedMapsByTag = new Map<number, Set<number>>();
    for (const mapNo of masterMapNos) {
        if (!(mapNo > 0)) continue;
        const mapKey = areaId * 10 + mapNo;
        const observed = [...new Set((observations.get(mapKey) ?? []).map(o => o.tagId))]
            .filter(id => Number.isSafeInteger(id) && id >= 1)
            .sort((a, b) => a - b);
        for (const tagId of observed) {
            ensureTag(tagId);
            const set = observedMapsByTag.get(tagId) ?? new Set<number>();
            set.add(mapNo);
            observedMapsByTag.set(tagId, set);
            if (bindTagToMap(nextStages, mapNo, tagId)) changed = true;
        }
    }

    // 有觀測證據的標籤：清掉不在觀測地圖上的 grants，避免未觀測的關卡保留標籤。
    for (const st of nextStages) {
        const tag = st.grantsTag;
        if (tag == null || tag < 1 || st.mapNo == null || st.mapNo < 1) continue;
        const maps = observedMapsByTag.get(tag);
        if (!maps || maps.has(st.mapNo)) continue;
        st.grantsTag = null;
        changed = true;
    }
    // 清掉因此變成空殼的 phase 列（主列保留）
    const kept = nextStages.filter(st => {
        if (!st.phase) return true;
        if (st.grantsTag != null) return true;
        if (st.allowedTags.length > 0) return true;
        if (st.slots.some(sl => sl.shipId != null)) return true;
        if (st.label && st.label.trim()) return true;
        return false;
    });
    if (kept.length !== nextStages.length) changed = true;
    return { stages: kept, tags: nextTags, changed };
}

/**
 * 船上已有、卻尚無任何 grants 綁定、且觀測也沒提到的標籤：
 * 掛到「已有貼標綁定的最早關」當第二／三…階段（restore／裁剪後常見：E1 兩路線貼了 1 與 2，
 * 但計畫只寫了 grants=1）。**不猜**觀測已寫明在別關的標籤。
 */
export function bindUnboundEstablishedTags(
    stages: PlanStage[],
    tags: PlanTag[],
    establishedIds: number[],
    fallbackMapNos: number[],
    observedTagIds: ReadonlySet<number> = new Set(),
): { stages: PlanStage[]; tags: PlanTag[]; changed: boolean } {
    let changed = false;
    const nextStages = stages.map(s => ({
        ...s,
        allowedTags: [...s.allowedTags],
        slots: s.slots.map(sl => ({ ...sl })),
    }));
    const nextTags = tags.map(tg => ({ ...tg }));
    const haveTag = new Set(nextTags.map(tg => tg.sallyArea));
    const bound = new Set(
        nextStages.map(s => s.grantsTag).filter((x): x is number => x != null && x >= 1),
    );
    const mapsWithGrant = [...new Set(
        nextStages.filter(s => s.grantsTag != null && s.mapNo != null && s.mapNo > 0)
            .map(s => s.mapNo!),
    )].sort((a, b) => a - b);
    const fallback = fallbackMapNos.find(n => Number.isSafeInteger(n) && n > 0);
    const targetMap = mapsWithGrant[0] ?? fallback;
    if (targetMap == null) return { stages: nextStages, tags: nextTags, changed: false };

    for (const tagId of [...new Set(establishedIds)].filter(id => id >= 1).sort((a, b) => a - b)) {
        if (bound.has(tagId)) continue;
        if (observedTagIds.has(tagId)) continue; // 觀測會／已負責，不瞎猜關卡
        if (!haveTag.has(tagId)) {
            nextTags.push({
                sallyArea: tagId, name: '', nameSource: 'manual',
                color: defaultColorForTag(tagId),
            });
            haveTag.add(tagId);
            changed = true;
        }
        if (bindTagToMap(nextStages, targetMap, tagId)) {
            bound.add(tagId);
            changed = true;
        }
    }
    return { stages: nextStages, tags: nextTags, changed };
}

/**
 * 設定某關「會貼哪些標籤」（一標籤＝一階段的 grantsTag）。
 * 勾選 → 確保該 map 有對應 grants 列；取消 → 清掉該 grants（空 phase 刪除，主列保留）。
 */
export function setMapGrantTags(
    stages: PlanStage[],
    tags: PlanTag[],
    mapNo: number,
    tagIds: number[],
): { stages: PlanStage[]; tags: PlanTag[]; changed: boolean } {
    if (!(mapNo > 0)) return { stages, tags, changed: false };
    let changed = false;
    let nextStages = stages.map(s => ({
        ...s,
        allowedTags: [...s.allowedTags],
        slots: s.slots.map(sl => ({ ...sl })),
    }));
    let nextTags = tags.map(tg => ({ ...tg }));
    const want = [...new Set(tagIds.filter(id => Number.isSafeInteger(id) && id >= 1))]
        .sort((a, b) => a - b);
    const haveTag = new Set(nextTags.map(tg => tg.sallyArea));
    for (const tagId of want) {
        if (!haveTag.has(tagId)) {
            nextTags.push({
                sallyArea: tagId, name: '', nameSource: 'manual',
                color: defaultColorForTag(tagId),
            });
            haveTag.add(tagId);
            changed = true;
        }
        if (bindTagToMap(nextStages, mapNo, tagId)) changed = true;
    }
    const wantSet = new Set(want);
    for (const st of nextStages) {
        if (st.mapNo !== mapNo || st.grantsTag == null) continue;
        if (wantSet.has(st.grantsTag)) continue;
        st.grantsTag = null;
        changed = true;
    }
    const kept = nextStages.filter(st => {
        if (st.mapNo !== mapNo || !st.phase) return true;
        if (st.grantsTag != null) return true;
        if (st.allowedTags.length > 0) return true;
        if (st.slots.some(sl => sl.shipId != null)) return true;
        if (st.label && st.label.trim()) return true;
        return false;
    });
    if (kept.length !== nextStages.length) changed = true;
    nextStages = kept;
    return { stages: nextStages, tags: nextTags, changed };
}

/** 某關目前 grantsTag 集合（升冪）。 */
export function grantTagsOnMap(stages: PlanStage[], mapNo: number): number[] {
    return [...new Set(
        stages.filter(s => s.mapNo === mapNo && s.grantsTag != null && s.grantsTag >= 1)
            .map(s => s.grantsTag!),
    )].sort((a, b) => a - b);
}

/**
 * 從指定關卡拿掉某標籤的 grants 綁定（＝取消「＋再加標籤」）。
 * 若該標籤之後無處綁定、船上也沒人帶、計畫也沒指派，且名稱空白 → 一併從 tags 刪除。
 */
export function unbindTagFromMap(
    stages: PlanStage[],
    tags: PlanTag[],
    planByShip: Record<number, number> | undefined,
    ships: { sallyArea: number }[],
    mapNo: number,
    tagId: number,
): { stages: PlanStage[]; tags: PlanTag[]; changed: boolean } {
    if (!(mapNo > 0) || !(tagId >= 1)) {
        return { stages, tags, changed: false };
    }
    const cur = grantTagsOnMap(stages, mapNo);
    if (!cur.includes(tagId)) return { stages, tags, changed: false };
    const out = setMapGrantTags(stages, tags, mapNo, cur.filter(x => x !== tagId));
    // 也從該關各階段的 allowedTags 拿掉（僅本關）
    let stages2 = out.stages.map(s => {
        if (s.mapNo !== mapNo || !s.allowedTags.includes(tagId)) return s;
        return { ...s, allowedTags: s.allowedTags.filter(x => x !== tagId) };
    });
    let tags2 = out.tags;
    let changed = out.changed || stages2.some((s, i) => s !== out.stages[i]);

    const stillGranted = stages2.some(s => s.grantsTag === tagId);
    const stillAllowed = stages2.some(s => s.allowedTags.includes(tagId));
    const onShip = ships.some(s => s.sallyArea === tagId);
    const inPlan = Object.values(planByShip ?? {}).some(v => v === tagId);
    const tg = tags2.find(t => t.sallyArea === tagId);
    const emptyName = !tg?.name?.trim();
    if (!stillGranted && !stillAllowed && !onShip && !inPlan && emptyName) {
        tags2 = tags2.filter(t => t.sallyArea !== tagId);
        changed = true;
    }
    return { stages: stages2, tags: tags2, changed };
}

/**
 * 刪除整條標籤（從所有關的 grants／allowed 拿掉，並自 tags 移除）。
 * 船上仍有人帶著時拒絕（回 changed:false）——實際貼標不可靠手動刪掉假裝沒有。
 */
export function deletePlanTag(
    stages: PlanStage[],
    tags: PlanTag[],
    planByShip: Record<number, number> | undefined,
    ships: { sallyArea: number }[],
    tagId: number,
): {
    stages: PlanStage[];
    tags: PlanTag[];
    planByShip: Record<number, number>;
    changed: boolean;
    blocked: boolean;
} {
    if (!(tagId >= 1)) {
        return { stages, tags, planByShip: planByShip ?? {}, changed: false, blocked: false };
    }
    if (ships.some(s => s.sallyArea === tagId)) {
        return { stages, tags, planByShip: planByShip ?? {}, changed: false, blocked: true };
    }
    let changed = false;
    const nextStages = stages.map(s => {
        let allowedTags = s.allowedTags;
        let grantsTag = s.grantsTag;
        if (allowedTags.includes(tagId)) {
            allowedTags = allowedTags.filter(x => x !== tagId);
            changed = true;
        }
        if (grantsTag === tagId) {
            grantsTag = null;
            changed = true;
        }
        return { ...s, allowedTags, grantsTag, slots: s.slots.map(sl => ({ ...sl })) };
    }).filter(st => {
        if (!st.phase) return true;
        if (st.grantsTag != null) return true;
        if (st.allowedTags.length > 0) return true;
        if (st.slots.some(sl => sl.shipId != null)) return true;
        if (st.label && st.label.trim()) return true;
        changed = true;
        return false;
    });
    const nextTags = tags.filter(t => t.sallyArea !== tagId);
    if (nextTags.length !== tags.length) changed = true;
    const nextPlan: Record<number, number> = { ...(planByShip ?? {}) };
    for (const [k, v] of Object.entries(nextPlan)) {
        if (v === tagId) {
            delete nextPlan[Number(k)];
            changed = true;
        }
    }
    return { stages: nextStages, tags: nextTags, planByShip: nextPlan, changed, blocked: false };
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
