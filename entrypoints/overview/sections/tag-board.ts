// 活動配船板：自由池 × 標籤欄網格。以 planByShip 為分配真相；stages 保留路線規則。
//
// 版面與互動對齊 `.preview/tag-board-mock.html` v2；本檔負責現行的自由池、標籤與路線檢視。
// 鎖定／快照／觀測規則同 utils/event-plan.ts；本檔只負責 DOM。
import type { OverviewSection, SectionContext } from './types';
import type { GameState, OwnedShipView } from '@/utils/state';
import { db, type EventPlanRow } from '@/utils/db';
import {
    ensureUniqueStageKeys, establishedTags, grantedTagsOf, newStageKey, nextSallySnapshot,
    observeGrantedTags, reconcileStages, resolveSallyRoster,
    type GrantObservation, type PlanStage, type SallyObservationInput, type SallyShip,
} from '@/utils/event-plan';
import {
    DEFAULT_STYPE_GROUPS, TAG_COLOR_COUNT, applyObservedTagBindings, assignPlanTag, boardBudget,
    bindUnboundEstablishedTags, cardState, checkRoute, columnGroupsWithMaps, columnOf,
    defaultColorForTag, deletePlanTag, grantTagsOnMap, isPlanByShipEmpty, knownTagIds, mapsForTag,
    mergeObservedGrants, migrateSlotsToPlanByShip, resolveTagColor, setMapGrantTags,
    stagesHaveShipSlots, stypeGroupKey, syncPlanFromActual, unbindTagFromMap,
} from '@/utils/tag-board';
import {
    matchEquip, matchSpeed, type EquipFilter, type SpeedFilter,
} from '@/utils/ship-filter';
import { t } from '@/utils/ui-i18n';
import { esc } from '../lib';

const EVENT_AREA_MIN = 10;

// 自由池的航速／可裝備篩選：語意與選項順序一律沿用 ship-picker.ts 的同名下拉
// （斷言在 utils/ship-filter.ts），兩處不得各自定義，否則「僅大發」之類的組合會分歧。
const SPEEDS: SpeedFilter[] = ['all', 'slow', 'fast', 'fastPlus'];
const SPEED_KEYS: Record<SpeedFilter, string> = {
    all: 'ov.spAll', slow: 'ov.spSlow', fast: 'ov.spFast', fastPlus: 'ov.spFastPlus',
};
const EQUIPS: EquipFilter[] = [
    'all', 'landingCraft', 'landingOnly', 'naikatei', 'naikateiOnly',
    'both', 'either', 'neither', 'commandFacility', 'seaplaneFighter',
];
const EQUIP_KEYS: Record<EquipFilter, string> = {
    all: 'ov.spAll',
    landingCraft: 'ov.spLandingCraft',
    landingOnly: 'ov.spLandingOnly',
    naikatei: 'ov.spNaikatei',
    naikateiOnly: 'ov.spNaikateiOnly',
    both: 'ov.spBoth',
    either: 'ov.spEither',
    neither: 'ov.spNeither',
    commandFacility: 'ov.spCommandFacility',
    seaplaneFighter: 'ov.spSeaplaneFighter',
};

interface BoardShip {
    id: number;
    name: string;
    lv: number;
    stypeId: number;
    sallyArea: number;
    /** 航速 `api_soku`。master 未載入時為 0＝不可考，不落入任何具體航速篩選。 */
    soku: number;
    /** 可裝備類別 id（`GameState.equipTypesOf()`）。查不到一律空陣列。 */
    equipTypes: number[];
}

const toSallyShips = (ships: OwnedShipView[]): SallyShip[] =>
    ships.map(s => ({ id: s.id, name: s.name, sallyArea: s.sallyArea }));

function detectEventAreas(state: GameState): number[] {
    const areas = new Set<number>();
    for (const m of state.masterMapInfo.values()) {
        if (m.area >= EVENT_AREA_MIN) areas.add(m.area);
    }
    for (const key of state.mapGauges.keys()) {
        const area = Math.floor(key / 10);
        if (area >= EVENT_AREA_MIN) areas.add(area);
    }
    return [...areas].sort((a, b) => a - b);
}

const blankPlan = (areaId: number): EventPlanRow => ({
    areaId, title: '', tags: [], stages: [], updatedTs: Date.now(), planByShip: {},
});

async function savePlan(plan: EventPlanRow): Promise<void> {
    plan.updatedTs = Date.now();
    await db.eventPlans.put(plan);
}

async function saveSallySnapshotIfNeeded(
    plan: EventPlanRow, liveShips: SallyShip[], areaIsCurrentInMaster: boolean,
): Promise<void> {
    const snapshot = nextSallySnapshot(plan.sallySnapshot, liveShips, areaIsCurrentInMaster);
    if (!snapshot) return;
    plan.sallySnapshot = snapshot;
    plan.updatedTs = Date.now();
    await db.eventPlans.put(plan);
}

const tagName = (plan: EventPlanRow, id: number): string =>
    plan.tags.find(tg => tg.sallyArea === id)?.name || t('ov.eoTagUnnamed', { n: id });

const tagFull = (plan: EventPlanRow, id: number) => `#${id} ${tagName(plan, id)}`;

async function loadObservations(): Promise<Map<number, GrantObservation[]>> {
    const rows = await db.events.where('path')
        .anyOf(['api_port/port', 'api_req_map/start']).sortBy('id');
    const inputs: SallyObservationInput[] = [];
    for (const row of rows) {
        const api = row.api as any;
        if (row.path === 'api_req_map/start') {
            const area = Number(api?.api_maparea_id);
            const no = Number(api?.api_mapinfo_no);
            if (Number.isInteger(area) && Number.isInteger(no)) {
                inputs.push({ kind: 'sortie', ts: row.ts, mapKey: area * 10 + no });
            }
        } else if (Array.isArray(api?.api_ship)) {
            inputs.push({
                kind: 'port', ts: row.ts,
                tags: new Map(api.api_ship.map((sh: any) =>
                    [Number(sh.api_id), Number(sh.api_sally_area) || 0])),
            });
        }
    }
    return observeGrantedTags(inputs);
}

function ensureTagEntries(plan: EventPlanRow, ids: number[]): boolean {
    let changed = false;
    const have = new Set(plan.tags.map(tg => tg.sallyArea));
    for (const id of ids) {
        if (have.has(id)) continue;
        plan.tags.push({
            sallyArea: id, name: '', nameSource: 'manual', color: defaultColorForTag(id),
        });
        have.add(id);
        changed = true;
    }
    for (const tg of plan.tags) {
        if (tg.color == null) {
            tg.color = defaultColorForTag(tg.sallyArea);
            changed = true;
        }
    }
    return changed;
}

function colorVar(plan: EventPlanRow, tagId: number): string {
    const tg = plan.tags.find(x => x.sallyArea === tagId);
    const c = tg ? resolveTagColor(tg) : defaultColorForTag(tagId);
    return `var(--tag-${c})`;
}

export const tagBoardSection: OverviewSection = {
    id: 'event-ops',
    titleKey: 'ov.eventOps',
    async render(el: HTMLElement, ctx: SectionContext) {
        // 先畫殼、再 await 資料（Dexie 升級卡住時仍看得到工具列）。
        el.innerHTML = `
            <div class="tb-root" id="tb-root">
                <div class="tb-top" id="tb-top"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
                <div class="tb-filters" id="tb-filters" hidden></div>
                <div class="tb-banner" id="tb-banner" hidden></div>
                <div class="tb-migrate" id="tb-migrate" hidden></div>
                <div class="tb-main" id="tb-main" hidden>
                    <aside class="tb-pool-pane">
                        <div class="tb-pool-head">
                            <div class="tb-pool-title">${esc(t('ov.tbPool'))}
                                <span class="tb-pill" id="tb-pool-n">0</span>
                                <button type="button" class="ov-btn tb-pool-collapse" id="tb-collapse-pool">${
                                    esc(t('ov.tbPoolCollapseAll'))}</button>
                            </div>
                            <div class="tb-pool-meta">${esc(t('ov.tbPoolMeta'))}</div>
                            <div class="tb-pool-tools">
                                <input type="search" id="tb-pool-q" placeholder="${esc(t('ov.tbPoolFilter'))}" autocomplete="off">
                            </div>
                        </div>
                        <div class="tb-pool-body" id="tb-pool-body"></div>
                    </aside>
                    <div class="tb-board-pane" id="tb-board-pane">
                        <table class="tb-board" id="tb-board"></table>
                    </div>
                </div>
                <div class="tb-dropdock" id="tb-dropdock"></div>
                <details class="tb-rules" id="tb-rules" hidden>
                    <summary>${esc(t('ov.tbRules'))}</summary>
                    <p class="dim tb-rules-help">${esc(t('ov.tbRulesHelp'))}</p>
                    <div id="tb-rules-body"></div>
                </details>
                <div class="tb-legend" id="tb-legend" hidden></div>
                <div class="tb-palette" id="tb-palette" hidden></div>
            </div>`;

        const root = el.querySelector<HTMLElement>('#tb-root')!;
        const topEl = el.querySelector<HTMLElement>('#tb-top')!;
        const filtersEl = el.querySelector<HTMLElement>('#tb-filters')!;
        const bannerEl = el.querySelector<HTMLElement>('#tb-banner')!;
        const migrateEl = el.querySelector<HTMLElement>('#tb-migrate')!;
        const mainEl = el.querySelector<HTMLElement>('#tb-main')!;
        const poolBody = el.querySelector<HTMLElement>('#tb-pool-body')!;
        const boardEl = el.querySelector<HTMLTableElement>('#tb-board')!;
        const dockEl = el.querySelector<HTMLElement>('#tb-dropdock')!;
        const rulesEl = el.querySelector<HTMLDetailsElement>('#tb-rules')!;
        const rulesBody = el.querySelector<HTMLElement>('#tb-rules-body')!;
        const legendEl = el.querySelector<HTMLElement>('#tb-legend')!;
        const paletteEl = el.querySelector<HTMLElement>('#tb-palette')!;

        const state = ctx.state;
        const owned = state.ownedShips();
        const liveShips = toSallyShips(owned);
        const ownedById = new Map(owned.map(s => [s.id, s]));

        let saved: EventPlanRow[];
        let observations: Map<number, GrantObservation[]>;
        try {
            saved = await db.eventPlans.toArray();
            observations = await loadObservations();
        } catch (error) {
            topEl.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            return;
        }

        const areas = [...new Set([...detectEventAreas(state), ...saved.map(p => p.areaId)])]
            .sort((a, b) => a - b);

        if (!areas.length) {
            el.innerHTML = `<div class="ov-empty">
                <p>${esc(t('ov.eoNoEvent'))}</p>
                <p class="dim">${esc(t('ov.eoCreateHint'))}</p>
                <div class="ov-toolbar" style="justify-content:center">
                    <input id="tb-new-area" class="tb-num" type="number" min="${EVENT_AREA_MIN}" value="62">
                    <button class="ov-btn" id="tb-create">${esc(t('ov.eoCreate'))}</button>
                </div>
            </div>`;
            el.querySelector('#tb-create')!.addEventListener('click', async () => {
                const v = Number(el.querySelector<HTMLInputElement>('#tb-new-area')!.value);
                if (!Number.isInteger(v) || v < EVENT_AREA_MIN) return;
                await db.eventPlans.put(blankPlan(v));
                ctx.rerender();
            });
            return;
        }

        let areaId = areas[areas.length - 1]!;
        let plan = saved.find(p => p.areaId === areaId) ?? blankPlan(areaId);
        let ships: SallyShip[] = [];
        let byId = new Map<number, SallyShip>();
        let boardShips: BoardShip[] = [];
        let established = new Set<number>();

        let checkMode = false;
        let routeKey = '';
        let fleetIdx = 0;
        let selected = new Set<number>();
        let q = '';
        let poolQ = '';
        let poolOpenGroups = new Set(DEFAULT_STYPE_GROUPS.map(g => g.key));
        let stypeFilter = '';
        let speedFilter: SpeedFilter = 'all';
        let equipFilter: EquipFilter = 'all';
        let dragIds: number[] | null = null;
        let filtersBound = false;
        let migrateNote = '';

        const areaIsCurrentInMaster = () => state.mapsOfArea(areaId).length > 0;

        const refreshRoster = () => {
            const roster = resolveSallyRoster(liveShips, plan.sallySnapshot, areaIsCurrentInMaster());
            ships = roster.ships;
            byId = new Map(ships.map(s => [s.id, s]));
            established = establishedTags(ships);
            boardShips = ships.map(s => {
                const o = ownedById.get(s.id);
                return {
                    id: s.id, name: s.name, lv: o?.lv ?? 0,
                    stypeId: o?.stypeId ?? 0, sallyArea: s.sallyArea,
                    soku: o?.soku ?? 0, equipTypes: o?.equipTypes ?? [],
                };
            });
        };

        /** 已貼標的船強制同步計畫＝實際（不可逆，無「套用」選擇）。 */
        const syncActualIntoPlan = async () => {
            if (!plan.planByShip) plan.planByShip = {};
            const out = syncPlanFromActual(plan.planByShip, ships);
            if (!out.changed) return;
            plan.planByShip = out.planByShip;
            await savePlan(plan);
        };

        const planMap = () => plan.planByShip ?? {};

        const syncStages = () => {
            plan.stages = reconcileStages(plan.stages, state.mapsOfArea(areaId));
        };

        const ensurePlanByShip = async () => {
            if (!isPlanByShipEmpty(plan.planByShip) || !stagesHaveShipSlots(plan.stages)) {
                if (!plan.planByShip) plan.planByShip = {};
                return;
            }
            const mig = migrateSlotsToPlanByShip(plan.stages);
            plan.planByShip = mig.planByShip;
            const n = Object.keys(mig.planByShip).length;
            if (n || mig.dropped.length || mig.skipped.length) {
                migrateNote = t('ov.tbMigrateNote', {
                    n, d: mig.dropped.length, s: mig.skipped.length,
                });
            }
            await savePlan(plan);
        };

        /** 出擊觀測到的「關卡→標籤」自動寫入計畫（釘死事實；並持久化以免 events 裁剪後遺失）。 */
        const applyObservations = async () => {
            syncStages();
            const masterNos = state.mapsOfArea(areaId).map(m => m.no);
            const merged = mergeObservedGrants(plan.observedGrants, observations);
            let dirty = false;
            if (merged.changed) {
                plan.observedGrants = merged.stored;
                dirty = true;
            }
            const bound = applyObservedTagBindings(
                plan.stages, plan.tags, areaId, masterNos, merged.observations,
            );
            if (bound.changed) {
                plan.stages = bound.stages;
                plan.tags = bound.tags;
                dirty = true;
            }
            // restore／無 raw：船上已有卻未綁、觀測也沒提到的標籤 → 掛到已有 grants 的最早關當多階段
            const observedTagIds = new Set<number>();
            for (const list of merged.observations.values()) {
                for (const o of list) observedTagIds.add(o.tagId);
            }
            const establishedIds = [...new Set(
                ships.filter(s => s.sallyArea > 0).map(s => s.sallyArea),
            )];
            const unbound = bindUnboundEstablishedTags(
                plan.stages, plan.tags, establishedIds, masterNos, observedTagIds,
            );
            if (unbound.changed) {
                plan.stages = unbound.stages;
                plan.tags = unbound.tags;
                dirty = true;
            }
            if (dirty) await savePlan(plan);
        };

        const uniquified = ensureUniqueStageKeys(plan.stages);
        if (uniquified.changed) {
            plan.stages = uniquified.stages;
            await savePlan(plan);
        }
        syncStages();
        await ensurePlanByShip();
        refreshRoster();
        await applyObservations();
        await saveSallySnapshotIfNeeded(plan, liveShips, areaIsCurrentInMaster());
        refreshRoster();
        await syncActualIntoPlan();

        const isLocked = (tagId: number | null) =>
            tagId != null && established.has(tagId) && !plan.unlocked;
        const stageLocked = (stage: PlanStage) =>
            isLocked(stage.grantsTag) || stage.allowedTags.some(id => isLocked(id));

        const mapOf = (no: number | null | undefined) =>
            no == null ? undefined : state.mapsOfArea(areaId).find(x => x.no === no);

        const stageTitle = (stage: PlanStage) => {
            const m = mapOf(stage.mapNo);
            if (stage.phase) return stage.label || (m ? `E${m.no}` : t('ov.eoStageUnnamed'));
            if (m) return `E${m.no}　${m.opetext || m.name}`;
            return stage.label || t('ov.eoStageUnnamed');
        };

        /** 標題只顯示一次：有封包活動名就用它；自訂名與活動名相同時不重複。 */
        const titleHtml = () => {
            const gameName = state.mapAreaName(areaId);
            const custom = plan.title.trim();
            if (gameName) {
                // 外文副標尚未見於封包；有遊戲名就只顯示這一條，不另開自訂欄造成重複。
                return `<b class="tb-title">${esc(gameName)}</b>`;
            }
            if (custom) return `<b class="tb-title">${esc(custom)}</b>`;
            return `<input id="tb-title" value="" placeholder="${esc(t('ov.eoTitlePlaceholder'))}">`;
        };

        const tagIds = () => {
            const ids = knownTagIds(plan.tags, ships, plan.planByShip);
            if (ensureTagEntries(plan, ids)) void savePlan(plan);
            return ids;
        };

        const layoutTags = () => {
            const ids = tagIds();
            return ids.map(id => ({ id, maps: mapsForTag(plan.stages, id) }));
        };

        const matchShip = (s: BoardShip, query: string) => {
            if (stypeFilter && stypeGroupKey(s.stypeId) !== stypeFilter) return false;
            if (!matchSpeed(s.soku, speedFilter)) return false;
            if (!matchEquip(s.equipTypes, equipFilter)) return false;
            if (!query) return true;
            return s.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
        };

        const fleetShipIds = (): number[] => {
            const deck = state.decks[fleetIdx];
            if (!deck?.api_ship) return [];
            return (deck.api_ship as number[]).filter(id => Number.isSafeInteger(id) && id > 0);
        };

        const routeStages = () => plan.stages.filter(st =>
            (st.label && st.label.trim()) || st.mapNo != null);

        async function commit() {
            if (!plan.planByShip) plan.planByShip = {};
            await savePlan(plan);
            drawBoardVisual();
            drawRules();
            fillRoutes();
        }

        function moveShips(ids: number[], toTag: number) {
            let next = { ...(plan.planByShip ?? {}) };
            for (const id of ids) {
                const ship = byId.get(id);
                if (!ship) continue;
                const planTag = next[id] ?? 0;
                if (cardState(planTag, ship.sallyArea) === 'stamped') continue;
                next = assignPlanTag(next, id, toTag);
            }
            plan.planByShip = next;
            selected.clear();
            void commit();
        }

        // ── 殼：工具列／篩選（只建一次）──
        function drawShell() {
            filtersEl.hidden = false;
            mainEl.hidden = false;
            rulesEl.hidden = false;
            legendEl.hidden = false;

            topEl.innerHTML = `
                <div class="ov-toolbar tb-toolbar">
                    ${areas.length > 1 ? `<select id="tb-area">${areas.map(a => {
                        const name = state.mapAreaName(a);
                        return `<option value="${a}" ${a === areaId ? 'selected' : ''}>${
                            esc(name || t('ov.eoAreaN', { n: a }))}</option>`;
                    }).join('')}</select>` : ''}
                    ${titleHtml()}
                    <span class="tb-budget" id="tb-budget"></span>
                    <span class="grow"></span>
                    <button class="ov-btn" id="tb-check">${esc(t('ov.tbCheck'))}</button>
                    ${established.size ? `<button class="ov-btn ${plan.unlocked ? '' : 'pin on'}" id="tb-unlock">${
                        esc(plan.unlocked ? t('ov.eoRelock') : t('ov.eoUnlock'))}</button>` : ''}
                    <button class="ov-btn" id="tb-add-tag">${esc(t('ov.tbAddTag'))}</button>
                </div>`;

            if (!filtersBound) {
                filtersEl.innerHTML = `
                    <label>${esc(t('ov.tbKeyword'))}
                        <input type="search" id="tb-q" placeholder="" autocomplete="off"></label>
                    <label>${esc(t('ov.tbStypeFilter'))}
                        <select id="tb-stype">
                            <option value="">${esc(t('ov.tbAllStypes'))}</option>
                            ${DEFAULT_STYPE_GROUPS.map(g =>
                                `<option value="${esc(g.key)}">${esc(t(g.labelKey))}</option>`).join('')}
                        </select></label>
                    <label>${esc(t('ov.spSpeed'))}
                        <select id="tb-speed">
                            ${SPEEDS.map(v =>
                                `<option value="${esc(v)}">${esc(t(SPEED_KEYS[v]))}</option>`).join('')}
                        </select></label>
                    <label>${esc(t('ov.spEquip'))}
                        <select id="tb-equip">
                            ${EQUIPS.map(v =>
                                `<option value="${esc(v)}">${esc(t(EQUIP_KEYS[v]))}</option>`).join('')}
                        </select></label>
                    <label id="tb-route-wrap" hidden>${esc(t('ov.tbCheckRoute'))}
                        <select id="tb-route"></select></label>
                    <label id="tb-fleet-wrap" hidden>${esc(t('ov.tbCheckFleet'))}
                        <select id="tb-fleet">
                            ${[0, 1, 2, 3].map(i =>
                                `<option value="${i}">${esc(t('ov.tbFleetN', { n: i + 1 }))}</option>`).join('')}
                        </select></label>
                    <span class="grow"></span>
                    <span class="tb-pill" id="tb-sel-count" hidden></span>
                    <button class="ov-btn" id="tb-clear-sel" hidden>${esc(t('ov.tbClearSel'))}</button>
                    <span class="tb-hint dim">${esc(t('ov.tbSelHint'))}</span>`;
                filtersBound = true;
                bindFilters();
            }

            legendEl.innerHTML = `
                <span class="tb-leg"><span class="tb-chip">${esc('…')}</span>${esc(t('ov.tbLegendPool'))}</span>
                <span class="tb-leg"><span class="tb-chip planned">${esc('…')}</span>${esc(t('ov.tbLegendPlanned'))}</span>
                <span class="tb-leg"><span class="tb-chip stamped" style="--c:var(--tag-4)">${esc('…')}</span>${esc(t('ov.tbLegendStamped'))}</span>
                <span class="tb-leg">${esc(t('ov.tbLegendMap'))}</span>
                <span class="tb-leg">${esc(t('ov.tbLegendDock'))}</span>`;

            if (migrateNote) {
                migrateEl.hidden = false;
                migrateEl.textContent = migrateNote;
            } else {
                migrateEl.hidden = true;
            }

            bindTop();
            fillRoutes();
        }

        function fillRoutes() {
            const sel = filtersEl.querySelector<HTMLSelectElement>('#tb-route');
            if (!sel) return;
            const stages = routeStages();
            const prev = routeKey;
            sel.innerHTML = stages.map(st =>
                `<option value="${esc(st.key)}">${esc(stageTitle(st))}</option>`).join('')
                || `<option value="">${esc(t('ov.eoNoStages'))}</option>`;
            if (stages.some(st => st.key === prev)) sel.value = prev;
            else routeKey = stages[0]?.key ?? '';
            if (routeKey) sel.value = routeKey;
        }

        function bindTop() {
            topEl.querySelector<HTMLSelectElement>('#tb-area')?.addEventListener('change', async e => {
                areaId = Number((e.currentTarget as HTMLSelectElement).value);
                plan = (await db.eventPlans.get(areaId)) ?? blankPlan(areaId);
                const fixed = ensureUniqueStageKeys(plan.stages);
                if (fixed.changed) { plan.stages = fixed.stages; await savePlan(plan); }
                syncStages();
                migrateNote = '';
                await ensurePlanByShip();
                refreshRoster();
                await applyObservations();
                await saveSallySnapshotIfNeeded(plan, liveShips, areaIsCurrentInMaster());
                refreshRoster();
                await syncActualIntoPlan();
                selected.clear();
                drawShell();
                drawBoardVisual();
                drawRules();
            });
            topEl.querySelector<HTMLInputElement>('#tb-title')?.addEventListener('change', e => {
                plan.title = (e.currentTarget as HTMLInputElement).value.trim();
                void commit();
            });
            topEl.querySelector('#tb-check')?.addEventListener('click', e => {
                checkMode = !checkMode;
                (e.currentTarget as HTMLButtonElement).classList.toggle('on', checkMode);
                filtersEl.querySelector<HTMLElement>('#tb-route-wrap')!.hidden = !checkMode;
                filtersEl.querySelector<HTMLElement>('#tb-fleet-wrap')!.hidden = !checkMode;
                drawBoardVisual();
            });
            topEl.querySelector('#tb-unlock')?.addEventListener('click', () => {
                plan.unlocked = !plan.unlocked;
                void commit().then(() => { drawShell(); drawBoardVisual(); drawRules(); });
            });
            topEl.querySelector('#tb-add-tag')?.addEventListener('click', () => {
                addTag(null);
            });
        }

        /** 新增標籤；mapNo 有值時綁到該關。優先重用「已確立卻未綁 grants」的標籤 id。 */
        function addTag(mapNo: number | null) {
            const used = new Set(tagIds());
            const bound = new Set(
                plan.stages.map(s => s.grantsTag).filter((x): x is number => x != null && x >= 1),
            );
            const unboundEstablished = [...new Set(
                ships.filter(s => s.sallyArea > 0).map(s => s.sallyArea),
            )].filter(id => !bound.has(id)).sort((a, b) => a - b);
            let next = unboundEstablished[0];
            if (next == null) {
                next = 1;
                while (used.has(next)) next++;
                plan.tags.push({
                    sallyArea: next, name: '', nameSource: 'manual',
                    color: defaultColorForTag(next),
                });
            } else if (!plan.tags.some(tg => tg.sallyArea === next)) {
                plan.tags.push({
                    sallyArea: next, name: '', nameSource: 'manual',
                    color: defaultColorForTag(next),
                });
            }
            if (mapNo != null && mapNo > 0) {
                syncStages();
                const out = setMapGrantTags(
                    plan.stages, plan.tags, mapNo, [...grantTagsOnMap(plan.stages, mapNo), next],
                );
                plan.stages = out.stages;
                plan.tags = out.tags;
            }
            void commit().then(() => { fillRoutes(); drawRules(); drawBoardVisual(); });
        }

        function bindFilters() {
            filtersEl.querySelector('#tb-q')!.addEventListener('input', e => {
                q = (e.currentTarget as HTMLInputElement).value;
                drawBoardVisual();
            });
            el.querySelector('#tb-pool-q')!.addEventListener('input', e => {
                poolQ = (e.currentTarget as HTMLInputElement).value;
                drawPoolOnly();
            });
            el.querySelector('#tb-collapse-pool')!.addEventListener('click', () => {
                poolOpenGroups.clear();
                drawPoolOnly();
            });
            filtersEl.querySelector('#tb-stype')!.addEventListener('change', e => {
                stypeFilter = (e.currentTarget as HTMLSelectElement).value;
                drawBoardVisual();
            });
            filtersEl.querySelector('#tb-speed')!.addEventListener('change', e => {
                speedFilter = (e.currentTarget as HTMLSelectElement).value as SpeedFilter;
                drawBoardVisual();
            });
            filtersEl.querySelector('#tb-equip')!.addEventListener('change', e => {
                equipFilter = (e.currentTarget as HTMLSelectElement).value as EquipFilter;
                drawBoardVisual();
            });
            filtersEl.querySelector('#tb-route')!.addEventListener('change', e => {
                routeKey = (e.currentTarget as HTMLSelectElement).value;
                drawBoardVisual();
            });
            filtersEl.querySelector('#tb-fleet')!.addEventListener('change', e => {
                fleetIdx = Number((e.currentTarget as HTMLSelectElement).value) || 0;
                drawBoardVisual();
            });
            filtersEl.querySelector('#tb-clear-sel')!.addEventListener('click', () => {
                selected.clear();
                updateSelUi();
                drawBoardVisual();
            });
        }

        function updateSelUi() {
            const n = selected.size;
            const sc = filtersEl.querySelector<HTMLElement>('#tb-sel-count')!;
            const clr = filtersEl.querySelector<HTMLElement>('#tb-clear-sel')!;
            root.classList.toggle('has-sel', n > 0);
            if (n) {
                sc.hidden = false;
                sc.textContent = t('ov.tbSelected', { n });
                clr.hidden = false;
            } else {
                sc.hidden = true;
                clr.hidden = true;
            }
        }

        function chipHtml(s: BoardShip, compact = false): string {
            const planTag = planMap()[s.id] ?? 0;
            const st = cardState(planTag, s.sallyArea);
            const col = columnOf(planTag, s.sallyArea);
            const c = col ? colorVar(plan, col) : 'transparent';
            // 已貼＝鎖定；其餘可拖。偏差在 syncActualIntoPlan 後不應再出現。
            const draggable = st !== 'stamped';
            let badge = '';
            if (st === 'stamped') {
                badge = `<span class="tb-badge stamp" style="--c:${c}">${esc(t('ov.tbBadgeStamp'))}</span>`;
            }
            const sel = selected.has(s.id) ? ' selected' : '';
            const short = compact && s.name.length > 8 ? `${s.name.slice(0, 7)}…` : s.name;
            return `<span class="tb-chip ${st}${sel}" draggable="${draggable}" data-id="${s.id}"
                style="--c:${c}" title="${esc(s.name)} Lv.${s.lv}">
                ${esc(short)}<span class="tb-lv">${s.lv}</span>${badge}
            </span>`;
        }

        function drawPoolOnly() {
            const free = boardShips.filter(s => {
                const planTag = planMap()[s.id] ?? 0;
                return cardState(planTag, s.sallyArea) === 'pool' && matchShip(s, poolQ || q);
            });
            let html = '';
            for (const g of DEFAULT_STYPE_GROUPS) {
                const list = free.filter(s => stypeGroupKey(s.stypeId) === g.key);
                if (!list.length) continue;
                html += `<details class="tb-pool-group" data-pool-group="${esc(g.key)}"${
                    poolOpenGroups.has(g.key) ? ' open' : ''}>
                    <summary><span class="tb-chev"></span>${esc(t(g.labelKey))}
                        <span class="n">${list.length}</span></summary>
                    <div class="tb-chips">${list.map(s => chipHtml(s, true)).join('')}</div>
                </details>`;
            }
            poolBody.innerHTML = html || `<div class="tb-empty">${esc(t('ov.tbPoolEmpty'))}</div>`;
            poolBody.querySelectorAll<HTMLDetailsElement>('details[data-pool-group]').forEach(details => {
                details.addEventListener('toggle', () => {
                    const key = details.dataset.poolGroup;
                    if (!key) return;
                    if (details.open) poolOpenGroups.add(key);
                    else poolOpenGroups.delete(key);
                });
            });
            el.querySelector('#tb-pool-n')!.textContent = String(
                boardShips.filter(s => cardState(planMap()[s.id] ?? 0, s.sallyArea) === 'pool').length,
            );
            bindChips(poolBody);
        }

        function drawBudget() {
            const b = boardBudget(ships, plan.planByShip);
            const elB = topEl.querySelector('#tb-budget');
            if (!elB) return;
            elB.innerHTML = `
                <span><b>${b.free}</b> ${esc(t('ov.tbBudgetFree'))}</span>
                <span><b>${b.planned}</b> ${esc(t('ov.tbBudgetPlanned'))}</span>
                <span><b>${b.stamped}</b> ${esc(t('ov.tbBudgetStamped'))}</span>
                <span class="tb-mis"><b>${b.mismatch}</b> ${esc(t('ov.tbBudgetMismatch'))}</span>`;
        }

        function drawCheckBanner() {
            if (!checkMode) {
                bannerEl.hidden = true;
                bannerEl.innerHTML = '';
                return;
            }
            bannerEl.hidden = false;
            const stage = plan.stages.find(st => st.key === routeKey);
            if (!stage) {
                bannerEl.innerHTML = `<b>${esc(t('ov.eoNoStages'))}</b>`;
                return;
            }
            const r = checkRoute(
                fleetShipIds(), byId, plan.planByShip, stage.allowedTags, stage.grantsTag,
            );
            if (r.unknown) {
                bannerEl.innerHTML = `<b>${esc(t('ov.tbCheckUnknown'))}</b>`;
                return;
            }
            const nameOf = (id: number) => byId.get(id)?.name ?? `#${id}`;
            const blocked = r.blocked.map(nameOf).join('、') || t('ov.tbCheckNone');
            const will = r.willStamp.map(nameOf).join('、') || t('ov.tbCheckNone');
            const tag = stage.grantsTag != null ? tagFull(plan, stage.grantsTag) : t('ov.eoGrantsNone');
            bannerEl.innerHTML = `${esc(t('ov.tbCheck'))} <b>${esc(stageTitle(stage))}</b>｜${
                esc(t('ov.tbFleetN', { n: fleetIdx + 1 }))} —
                <span class="tb-ok">${esc(String(r.ok.length))}</span>／
                <span class="tb-bad">${esc(blocked)}</span>／
                <span class="tb-stamp">${esc(tag)}：${esc(will)}（${r.willStamp.length}）</span>`;
        }

        function drawDropdock(groups: ReturnType<typeof columnGroupsWithMaps>) {
            let html = `<span class="tb-dock-lab">${esc(t('ov.tbDropdock'))}</span>`;
            html += `<div class="tb-dropzone pool" data-col="0">${esc(t('ov.tbPool'))}</div>`;
            for (const g of groups) {
                for (const id of g.tags) {
                    const map = g.mapId === 'SHARED' ? t('ov.tbShared') : `E${g.mapId}`;
                    html += `<div class="tb-dropzone" data-col="${id}" style="--c:${colorVar(plan, id)}">
                        <span class="tb-sw"></span>${esc(tagName(plan, id))}
                        <span class="tb-dock-map">${esc(map)}</span></div>`;
                }
            }
            dockEl.innerHTML = html;
            dockEl.querySelectorAll('.tb-dropzone').forEach(z => {
                z.addEventListener('dragover', e => {
                    e.preventDefault();
                    z.classList.add('over');
                });
                z.addEventListener('dragleave', () => z.classList.remove('over'));
                z.addEventListener('drop', e => {
                    e.preventDefault();
                    z.classList.remove('over');
                    const ids = dragIds ?? [];
                    root.classList.remove('dragging');
                    dragIds = null;
                    moveShips(ids, Number((z as HTMLElement).dataset.col));
                });
            });
        }

        function drawRules() {
            const ids = tagIds();
            const hasMaster = state.mapsOfArea(areaId).length > 0;
            rulesBody.innerHTML = `
                <div class="tb-rule-list">
                    ${plan.stages.map((st, i) => {
                        const locked = stageLocked(st);
                        const chips = ids.map(id => `<label class="tb-rchip ${st.allowedTags.includes(id) ? 'on' : ''}">
                            <input type="checkbox" data-stage="${esc(st.key)}" data-tag="${id}"
                                ${st.allowedTags.includes(id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
                            ${esc(tagFull(plan, id))}</label>`).join('');
                        // 主列：此關「會貼哪些標籤」可複選（一標籤＝一路線／階段）；phase 列只顯示本階段的單一 grants
                        const mapGrantHtml = st.mapNo != null && !st.phase
                            ? `<div class="tb-rule-field"><span class="dim">${esc(t('ov.eoGrantsMap'))}</span>
                                <div>${ids.map(id => {
                                    const on = grantTagsOnMap(plan.stages, st.mapNo!).includes(id);
                                    const chipLocked = isLocked(id);
                                    return `<label class="tb-rchip ${on ? 'on' : ''}">
                                        <input type="checkbox" data-map-grant="${st.mapNo}" data-tag="${id}"
                                            ${on ? 'checked' : ''} ${chipLocked ? 'disabled' : ''}>
                                        ${esc(tagFull(plan, id))}</label>`;
                                }).join('') || `<span class="dim">${esc(t('ov.eoNoTags'))}</span>`}</div>
                                <div class="dim">${esc(t('ov.eoGrantsMapHint'))}</div></div>`
                            : `<div class="tb-rule-field"><span class="dim">${esc(t('ov.eoGrants'))}</span>
                                <select data-grants="${esc(st.key)}" ${locked ? 'disabled' : ''}>${
                                    [`<option value="">${esc(t('ov.eoGrantsNone'))}</option>`]
                                        .concat(ids.map(id => `<option value="${id}" ${st.grantsTag === id ? 'selected' : ''}>${
                                            esc(tagFull(plan, id))}</option>`)).join('')
                                }</select></div>`;
                        const seen = st.mapNo == null ? []
                            : grantedTagsOf(observations, areaId * 10 + st.mapNo);
                        const obs = !st.phase && st.mapNo != null
                            ? (seen.length
                                ? `<div class="dim">${esc(t('ov.eoObservedList', {
                                    map: `E${st.mapNo}`, tags: seen.map(id => tagFull(plan, id)).join('、'),
                                }))}</div>`
                                : `<div class="dim">${esc(t('ov.eoObservedNone'))}</div>`)
                            : '';
                        return `<div class="tb-rule-row">
                            <div class="tb-rule-name">${esc(stageTitle(st))}${locked ? ' 🔒' : ''}
                                ${hasMaster && !st.phase && st.mapNo != null
                                    ? `<button type="button" class="ov-btn tb-add-phase-for" data-map="${st.mapNo}"
                                        title="${esc(t('ov.tbAddPhaseForMap', { n: st.mapNo }))}">＋ ${esc(t('ov.eoAddPhase'))}</button>`
                                    : ''}
                            </div>
                            <div class="tb-rule-field"><span class="dim">${esc(t('ov.eoAllowed'))}</span>
                                <div>${chips || `<span class="dim">${esc(t('ov.eoNoTags'))}</span>`}</div></div>
                            ${mapGrantHtml}
                            ${obs}
                            ${!hasMaster || st.phase ? `<button type="button" class="ov-btn danger tb-del-stage"
                                data-idx="${i}">${esc(t('ov.eoDelete'))}</button>` : ''}
                        </div>`;
                    }).join('') || `<div class="ov-empty">${esc(t('ov.eoNoStages'))}</div>`}
                </div>
                ${hasMaster ? `<div class="tb-add-phase-bar">
                    <label class="dim">${esc(t('ov.tbAddPhaseMap'))}
                        <select id="tb-phase-map">${state.mapsOfArea(areaId).map(m =>
                            `<option value="${m.no}">E${m.no}${m.opetext ? `　${esc(m.opetext)}` : ''}</option>`
                        ).join('')}</select></label>
                    <button type="button" class="ov-btn" id="tb-add-phase">＋ ${esc(t('ov.eoAddPhase'))}</button>
                </div>`
                    : `<button type="button" class="ov-btn" id="tb-add-stage">＋ ${esc(t('ov.eoAddStage'))}</button>`}`;

            const addPhaseForMap = (mapNo: number) => {
                if (!Number.isInteger(mapNo) || mapNo < 1) return;
                const existing = plan.stages.filter(s => s.mapNo === mapNo && s.phase).length;
                const key = newStageKey(plan.stages.map(s => s.key));
                plan.stages.push({
                    key,
                    label: t('ov.tbPhaseLabel', { n: mapNo, i: existing + 1 }),
                    allowedTags: [],
                    grantsTag: null,
                    slots: [],
                    mapNo,
                    phase: true,
                });
                void commit().then(() => { fillRoutes(); drawRules(); });
            };

            rulesBody.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-stage]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const stage = plan.stages.find(s => s.key === cb.dataset.stage);
                    if (!stage || stageLocked(stage)) return;
                    const tag = Number(cb.dataset.tag);
                    if (cb.checked) {
                        if (!stage.allowedTags.includes(tag)) stage.allowedTags.push(tag);
                    } else {
                        stage.allowedTags = stage.allowedTags.filter(x => x !== tag);
                    }
                    void commit();
                });
            });
            rulesBody.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-map-grant]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const mapNo = Number(cb.dataset.mapGrant);
                    const tag = Number(cb.dataset.tag);
                    if (!Number.isInteger(mapNo) || mapNo < 1 || isLocked(tag)) return;
                    const cur = grantTagsOnMap(plan.stages, mapNo);
                    const next = cb.checked
                        ? [...new Set([...cur, tag])]
                        : cur.filter(x => x !== tag);
                    const out = setMapGrantTags(plan.stages, plan.tags, mapNo, next);
                    plan.stages = out.stages;
                    plan.tags = out.tags;
                    void commit().then(() => { fillRoutes(); drawRules(); drawBoardVisual(); });
                });
            });
            rulesBody.querySelectorAll<HTMLSelectElement>('select[data-grants]').forEach(sel => {
                sel.addEventListener('change', () => {
                    const stage = plan.stages.find(s => s.key === sel.dataset.grants);
                    if (!stage || stageLocked(stage)) return;
                    stage.grantsTag = sel.value ? Number(sel.value) : null;
                    void commit().then(() => { drawBoardVisual(); drawRules(); });
                });
            });
            rulesBody.querySelector('#tb-add-stage')?.addEventListener('click', () => {
                const key = newStageKey(plan.stages.map(s => s.key));
                plan.stages.push({
                    key, label: '', allowedTags: [], grantsTag: null, slots: [],
                });
                void commit().then(() => { fillRoutes(); drawRules(); });
            });
            rulesBody.querySelector('#tb-add-phase')?.addEventListener('click', () => {
                const sel = rulesBody.querySelector<HTMLSelectElement>('#tb-phase-map');
                const mapNo = Number(sel?.value);
                addPhaseForMap(mapNo);
            });
            rulesBody.querySelectorAll<HTMLButtonElement>('.tb-add-phase-for').forEach(btn => {
                btn.addEventListener('click', () => {
                    addPhaseForMap(Number(btn.dataset.map));
                });
            });
            rulesBody.querySelectorAll<HTMLButtonElement>('.tb-del-stage').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.idx);
                    if (!Number.isInteger(idx)) return;
                    plan.stages.splice(idx, 1);
                    void commit().then(() => { fillRoutes(); drawRules(); drawBoardVisual(); });
                });
            });
        }

        function drawBoardVisual() {
            syncStages();
            const tags = layoutTags();
            const masterNos = state.mapsOfArea(areaId).map(m => m.no);
            const groups = columnGroupsWithMaps(masterNos, tags);
            type Col = { kind: 'tag'; id: number } | { kind: 'placeholder'; mapNo: number };
            const cols: Col[] = [];
            for (const g of groups) {
                for (const id of g.tags) cols.push({ kind: 'tag', id });
                // 尚無標籤的關卡才保留整欄入口；已有欄位時改由關卡名稱旁的小入口新增。
                if (typeof g.mapId === 'number' && !g.tags.length) {
                    cols.push({ kind: 'placeholder', mapNo: g.mapId });
                }
            }
            const route = plan.stages.find(st => st.key === routeKey);
            const allowed = new Set(route?.allowedTags ?? []);
            const showDim = checkMode && !!route && route.allowedTags.length > 0;

            let mapRow = `<th class="tb-stype-h map"></th>`;
            for (const g of groups) {
                // 關卡群組：空關卡留一個新增欄；已有標籤時不再多佔一欄。
                const span = Math.max(1, g.tags.length);
                const cls = g.mapId === 'SHARED' ? 'map shared' : 'map';
                const label = g.mapId === 'SHARED' ? t('ov.tbShared') : `E${g.mapId}`;
                const op = g.mapId === 'SHARED'
                    ? t('ov.tbSharedOp')
                    : (mapOf(g.mapId)?.opetext || '');
                const add = typeof g.mapId === 'number' && g.tags.length
                    ? `<button type="button" class="ov-btn tb-add-map-tag tb-map-add" data-add-map="${g.mapId}">${
                        esc(t('ov.tbAddTagInline'))}</button>`
                    : '';
                mapRow += `<th class="${cls}" colspan="${span}"><span class="tb-map-title">${esc(label)}${add}</span>${
                    op ? `<span class="op">${esc(op)}</span>` : ''}</th>`;
            }

            let tagRow = `<th class="tb-stype-h tagcol">${esc(t('ov.tbStypeCol'))}</th>`;
            for (const col of cols) {
                if (col.kind === 'placeholder') {
                    tagRow += `<th class="tb-colhead tagcol tb-placeholder" data-add-map="${col.mapNo}">
                        <button type="button" class="ov-btn tb-add-map-tag" data-add-map="${col.mapNo}">${
                            esc(t('ov.tbAddTagForMap', { n: col.mapNo }))}</button>
                    </th>`;
                    continue;
                }
                const id = col.id;
                const locked = isLocked(id);
                const tg = plan.tags.find(x => x.sallyArea === id);
                const dim = showDim && !allowed.has(id) ? ' dimmed' : '';
                let plannedN = 0, stampedN = 0;
                for (const s of boardShips) {
                    if (columnOf(planMap()[s.id] ?? 0, s.sallyArea) !== id) continue;
                    if (cardState(planMap()[s.id] ?? 0, s.sallyArea) === 'stamped') stampedN++;
                    else plannedN++;
                }
                const maps = mapsForTag(plan.stages, id);
                const mapHint = maps.length > 1 ? maps.map(n => `E${n}`).join('·') : '';
                const singleMap = maps.length === 1 ? maps[0]! : null;
                const canUnbind = singleMap != null && !locked;
                const onShip = ships.some(s => s.sallyArea === id);
                const canDelete = !locked && !onShip;
                tagRow += `<th class="tb-colhead tagcol${dim}" style="--c:${colorVar(plan, id)}" data-tag="${id}">
                    <div class="tb-banner">
                        <button type="button" class="tb-swatch" data-color="${id}" title="${esc(t('ov.tbColorPick'))}"
                            style="--c:${colorVar(plan, id)}"></button>
                        <input class="tb-name" data-rename="${id}" value="${esc(tg?.name ?? '')}"
                            placeholder="${esc(t('ov.eoTagUnnamed', { n: id }))}" ${locked ? 'readonly' : ''}>
                        ${locked ? '<span title="locked">🔒</span>' : ''}
                        ${canUnbind ? `<button type="button" class="tb-tag-x" data-unbind-tag="${id}" data-unbind-map="${singleMap}"
                            title="${esc(t('ov.tbUnbindTag'))}">×</button>` : ''}
                        ${!canUnbind && canDelete ? `<button type="button" class="tb-tag-x" data-delete-tag="${id}"
                            title="${esc(t('ov.tbDeleteTag'))}">×</button>` : ''}
                    </div>
                    <div class="tb-meta">
                        <span>${esc(t('ov.tbColPlanned'))} <b>${plannedN}</b></span>
                        <span>${esc(t('ov.tbColStamped'))} <b>${stampedN}</b></span>
                        ${mapHint ? `<span>${esc(mapHint)}</span>` : ''}
                    </div>
                    <div class="tb-col-hint">${esc(t('ov.tbColHint'))}</div>
                </th>`;
            }

            let body = '';
            for (const g of DEFAULT_STYPE_GROUPS) {
                if (stypeFilter && g.key !== stypeFilter) continue;
                const list = boardShips.filter(s =>
                    stypeGroupKey(s.stypeId) === g.key
                    && cardState(planMap()[s.id] ?? 0, s.sallyArea) !== 'pool'
                    && matchShip(s, q));
                const byCol = new Map<number, BoardShip[]>();
                for (const col of cols) {
                    if (col.kind === 'tag') byCol.set(col.id, []);
                }
                for (const s of list) {
                    const c = columnOf(planMap()[s.id] ?? 0, s.sallyArea);
                    byCol.get(c)?.push(s);
                }
                body += `<tr><td class="tb-stype">${esc(t(g.labelKey))}
                    <span class="cnt">${list.length}</span></td>`;
                for (const col of cols) {
                    if (col.kind === 'placeholder') {
                        body += `<td class="tb-cell tb-placeholder" data-add-map="${col.mapNo}">
                            <span class="tb-empty dim">${esc(t('ov.tbEmptyMap'))}</span></td>`;
                        continue;
                    }
                    const cell = byCol.get(col.id) ?? [];
                    const dim = showDim && !allowed.has(col.id) ? ' dimmed' : '';
                    body += `<td class="tb-cell${dim}" data-col="${col.id}" style="--c:${colorVar(plan, col.id)}">
                        <div class="tb-chips">${cell.length
                            ? cell.map(s => chipHtml(s)).join('')
                            : `<span class="tb-empty">${esc(t('ov.tbEmptyCell'))}</span>`}</div></td>`;
                }
                body += '</tr>';
            }

            if (!groups.length) {
                boardEl.innerHTML = `<tbody><tr><td class="ov-empty">${esc(t('ov.eoNoEvent'))}</td></tr></tbody>`;
            } else {
                boardEl.innerHTML = `<thead><tr>${mapRow}</tr><tr>${tagRow}</tr></thead><tbody>${body}</tbody>`;
            }

            drawBudget();
            drawPoolOnly();
            drawDropdock(groups);
            drawCheckBanner();
            updateSelUi();
            bindBoard();
        }

        function drawBody() {
            drawBoardVisual();
            drawRules();
        }

        function bindChips(rootEl: HTMLElement) {
            rootEl.querySelectorAll<HTMLElement>('.tb-chip[draggable="true"]').forEach(c => {
                c.addEventListener('dragstart', e => {
                    const id = Number(c.dataset.id);
                    dragIds = selected.has(id) && selected.size ? [...selected] : [id];
                    dragIds = dragIds.filter(i => {
                        const s = byId.get(i);
                        if (!s) return false;
                        return cardState(planMap()[i] ?? 0, s.sallyArea) !== 'stamped';
                    });
                    e.dataTransfer!.effectAllowed = 'move';
                    e.dataTransfer!.setData('text/plain', String(id));
                    root.classList.add('dragging');
                });
                c.addEventListener('dragend', () => {
                    root.classList.remove('dragging');
                    dragIds = null;
                });
                c.addEventListener('click', e => {
                    const id = Number(c.dataset.id);
                    if (selected.has(id)) selected.delete(id); else selected.add(id);
                    c.classList.toggle('selected', selected.has(id));
                    updateSelUi();
                });
            });
        }

        function bindBoard() {
            bindChips(boardEl);
            boardEl.querySelectorAll<HTMLElement>('td.tb-cell').forEach(td => {
                td.addEventListener('dragover', e => {
                    e.preventDefault();
                    td.classList.add('drop');
                });
                td.addEventListener('dragleave', () => td.classList.remove('drop'));
                td.addEventListener('drop', e => {
                    e.preventDefault();
                    td.classList.remove('drop');
                    const ids = dragIds ?? [];
                    root.classList.remove('dragging');
                    dragIds = null;
                    moveShips(ids, Number(td.dataset.col));
                });
            });
            boardEl.querySelectorAll<HTMLButtonElement>('.tb-add-map-tag').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const mapNo = Number(btn.dataset.addMap);
                    if (Number.isInteger(mapNo) && mapNo > 0) addTag(mapNo);
                });
            });
            boardEl.querySelectorAll<HTMLElement>('th.tb-colhead[data-tag]').forEach(th => {
                th.addEventListener('click', e => {
                    if ((e.target as HTMLElement).closest(
                        '[data-color], input, [data-rename], [data-unbind-tag], [data-delete-tag]',
                    )) return;
                    if (!selected.size) return;
                    moveShips([...selected], Number(th.dataset.tag));
                });
            });
            boardEl.querySelectorAll<HTMLButtonElement>('[data-unbind-tag]').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const tagId = Number(btn.dataset.unbindTag);
                    const mapNo = Number(btn.dataset.unbindMap);
                    if (isLocked(tagId) || !(mapNo > 0)) return;
                    const out = unbindTagFromMap(
                        plan.stages, plan.tags, plan.planByShip, ships, mapNo, tagId,
                    );
                    if (!out.changed) return;
                    plan.stages = out.stages;
                    plan.tags = out.tags;
                    void commit().then(() => { fillRoutes(); drawBoardVisual(); drawRules(); });
                });
            });
            boardEl.querySelectorAll<HTMLButtonElement>('[data-delete-tag]').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const tagId = Number(btn.dataset.deleteTag);
                    if (isLocked(tagId)) return;
                    const out = deletePlanTag(
                        plan.stages, plan.tags, plan.planByShip, ships, tagId,
                    );
                    if (out.blocked) {
                        bannerEl.hidden = false;
                        bannerEl.textContent = t('ov.tbDeleteTagBlocked');
                        return;
                    }
                    if (!out.changed) return;
                    plan.stages = out.stages;
                    plan.tags = out.tags;
                    plan.planByShip = out.planByShip;
                    void commit().then(() => { fillRoutes(); drawBoardVisual(); drawRules(); });
                });
            });
            boardEl.querySelectorAll<HTMLElement>('[data-color]').forEach(b => {
                b.addEventListener('click', e => {
                    e.stopPropagation();
                    openPalette(Number(b.dataset.color), b);
                });
            });
            boardEl.querySelectorAll<HTMLInputElement>('[data-rename]').forEach(inp => {
                inp.addEventListener('click', e => e.stopPropagation());
                inp.addEventListener('change', () => {
                    const id = Number(inp.dataset.rename);
                    if (isLocked(id)) return;
                    let tg = plan.tags.find(x => x.sallyArea === id);
                    if (!tg) {
                        tg = {
                            sallyArea: id, name: '', nameSource: 'manual',
                            color: defaultColorForTag(id),
                        };
                        plan.tags.push(tg);
                    }
                    tg.name = inp.value.trim();
                    tg.nameSource = 'manual';
                    void commit();
                });
            });
        }

        function openPalette(tagId: number, anchor: HTMLElement) {
            const tg = plan.tags.find(x => x.sallyArea === tagId);
            const cur = tg ? resolveTagColor(tg) : defaultColorForTag(tagId);
            paletteEl.hidden = false;
            paletteEl.innerHTML = `<div class="tb-pal-title">${esc(t('ov.tbColorPick'))}</div>
                <div class="tb-palette-grid">${Array.from({ length: TAG_COLOR_COUNT }, (_, i) => i + 1).map(i =>
                    `<button type="button" class="${cur === i ? 'on' : ''}" data-pick="${i}"
                        style="background:var(--tag-${i})"></button>`).join('')}</div>`;
            const r = anchor.getBoundingClientRect();
            const host = el.getBoundingClientRect();
            paletteEl.style.left = `${Math.min(r.left - host.left, host.width - 220)}px`;
            paletteEl.style.top = `${r.bottom - host.top + 6}px`;
            paletteEl.querySelectorAll<HTMLElement>('[data-pick]').forEach(b => {
                b.addEventListener('click', () => {
                    let tag = plan.tags.find(x => x.sallyArea === tagId);
                    if (!tag) {
                        tag = {
                            sallyArea: tagId, name: '', nameSource: 'manual',
                            color: Number(b.dataset.pick),
                        };
                        plan.tags.push(tag);
                    } else {
                        tag.color = Number(b.dataset.pick);
                    }
                    paletteEl.hidden = true;
                    void commit();
                });
            });
        }

        document.addEventListener('click', onDocClick);
        function onDocClick(e: MouseEvent) {
            if (!paletteEl.isConnected) {
                document.removeEventListener('click', onDocClick);
                return;
            }
            if (paletteEl.hidden) return;
            if ((e.target as HTMLElement).closest('#tb-palette, [data-color]')) return;
            paletteEl.hidden = true;
        }

        drawShell();
        drawBody();
    },
};
