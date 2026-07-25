// 活動作戰板：關卡 × 出撃標籤（api_sally_area）的規劃與檢查。
//
// ── 三層結構（機制決定的，別改成別的形狀）──────────────────────────────
// Layer 1「標籤總帳」：從 api_sally_area 即時分群，**零使用者輸入、且是權威**。標籤由出擊
//   當下依「關卡＋路線」貼上，事前怎麼安排都會被蓋掉，故一律以遊戲實際貼的為準。
// Layer 2「計畫」：使用者手輸的意圖（標籤名、關卡的標籤約束、編成）。API 給不出這些。
// Layer 3「檢查」：兩者的差異報告 → utils/event-plan.ts（純函式，node 已驗證）。
//
// ── 版面（被實際規模與使用者回報修正過三輪，別走回頭路）────────────────
// 實測規模：**一次活動可有 12 個標籤、5～7 個關卡**。
//   · 初版兩者都做成展開卡片 → 整天拉捲軸。改為關卡一行一關、只有選中的那關展開。
//   · 第二版把標籤成員收進摺疊區 → 也錯。「現在每個標籤鎖了哪些船」是本分區第一優先
//     資訊，**必須常駐可見**（使用者原話：藏起來讓人找等於沒做）。
//   · 標籤總帳每列必須**並排「實際」與「計畫」兩欄**——只給實際那半邊時，使用者把船排進
//     計畫後會看到 0 艘、排進去的船像人間蒸發（**回報三次**）。
//   · 摺疊起來的關卡列也要看得到標籤**名稱**（不能只有 #id），否則收起來就認不出是哪個。
//   · 艦娘篩選清單常駐右欄，是**主要**輸入手段；「帶入第 N 艦隊」降為次要按鈕——玩家不可能
//     為了找船一直切回遊戲畫面確認。
//
// ── 鎖定規則 ────────────────────────────────────────────────────────────
// 標籤一旦「已確立」（遊戲裡實際已有船帶著它），其名稱與**牽涉該標籤的關卡**之標籤約束
// 即轉為唯讀。實際貼標不可逆，計畫端再改只會讓兩邊對不上；此時玩家只能依實際標籤填船。
// 活動結束後由使用者明確按下「解除鎖定」（寫入 EventPlanRow.unlocked）才可再編輯。
//
// 本分區直接讀寫 db.eventPlans。這不違反「overview 不寫 derived tables」——計畫是使用者
// 手輸資料，不是從 events 投影出來的衍生資料，性質同 ships 分區的手填打撈上任日。
import type { OverviewSection, SectionContext } from './types';
import type { GameState, OwnedShipView } from '@/utils/state';
import { db, type EventPlanRow } from '@/utils/db';
import {
    checkStage, ensureUniqueStageKeys, establishedTags, findPlanConflicts, grantedTagsOf,
    groupBySally, guessMapNo, newStageKey, nextSallySnapshot, observeGrantedTags, plannedByTag,
    reconcileStages, removeStageAt, resolveSallyRoster, sallyBudget,
    type GrantObservation, type PlanStage, type PlannedMember, type SallyObservationInput,
    type SallyShip, type SlotStatus,
} from '@/utils/event-plan';
import { renderShipPicker, type ShipPickerHandle } from '../ship-picker';
import { t } from '@/utils/ui-i18n';
import { copyWithFeedback, downloadText, esc } from '../lib';

// 一般海域的 maparea 最大為 7；活動海域用獨立的高號段（samples/61-5-…json 的 world=61
// 佐證）。mapGauges 的 key＝mapArea*10+mapNo，故 area＝floor(key/10)。
const EVENT_AREA_MIN = 10;

const STATUS_KEY: Record<SlotStatus, string> = {
    ok: 'ov.eoStatusOk',
    blocked: 'ov.eoStatusBlocked',
    willStamp: 'ov.eoStatusWillStamp',
    unknown: 'ov.eoStatusUnknown',
    role: 'ov.eoStatusRole',
    gone: 'ov.eoStatusGone',
};

// ── 資料存取 ───────────────────────────────────────────────────────────
const toSallyShips = (ships: OwnedShipView[]): SallyShip[] =>
    ships.map(s => ({ id: s.id, name: s.name, sallyArea: s.sallyArea }));

/**
 * 目前遊戲資料裡看得到的活動海域 area id。
 * 主要來源是 start2 的 `api_mst_mapinfo`（登入即有、且在快照裡永久保留）；
 * runtime 的 mapGauges 只作補充——它要玩家開過海域選擇畫面才會有。
 */
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
    areaId, title: '', tags: [], stages: [], updatedTs: Date.now(),
});

async function savePlan(plan: EventPlanRow): Promise<void> {
    plan.updatedTs = Date.now();
    await db.eventPlans.put(plan);
}

/** 只在目前 master 仍存在的活動，以非空且變更過的即時札更新快照。 */
async function saveSallySnapshotIfNeeded(
    plan: EventPlanRow, liveShips: SallyShip[], areaIsCurrentInMaster: boolean,
): Promise<void> {
    const snapshot = nextSallySnapshot(plan.sallySnapshot, liveShips, areaIsCurrentInMaster);
    if (!snapshot) return;
    plan.sallySnapshot = snapshot;
    plan.updatedTs = Date.now();
    await db.eventPlans.put(plan);
}

/** 計畫已宣告的標籤 ∪ 遊戲實際存在的標籤。後段的標籤在跑到之前不會存在於遊戲，故需前者。 */
function knownTagIds(plan: EventPlanRow, ships: SallyShip[]): number[] {
    const ids = new Set<number>(plan.tags.map(tg => tg.sallyArea));
    for (const g of groupBySally(ships)) ids.add(g.sallyArea);
    return [...ids].sort((a, b) => a - b);
}

const tagName = (plan: EventPlanRow, id: number): string =>
    plan.tags.find(tg => tg.sallyArea === id)?.name || t('ov.eoTagUnnamed', { n: id });

const tagFull = (plan: EventPlanRow, id: number) => `#${id} ${tagName(plan, id)}`;

/**
 * 從 raw events 取出實際貼標觀測所需的兩種輸入。只讀 `api_port/port` 與
 * `api_req_map/start` 兩個 path（events 表的 `path` 有索引，不必全表掃描）。
 * 唯讀、不寫任何表；涵蓋範圍受 M6 裁剪限制（約兩個登入世代）。
 */
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

// ── Markdown 匯出 ─────────────────────────────────────────────────────
// 給人／LLM 讀的摘要，不是備份格式（備份走 db.eventPlans 本體）。取捨同 llm.ts：
// 能先算好的就別留給讀者自己對照，故標籤總帳把「實際」「計畫」兩份名單都攤開。
function buildMarkdown(
    plan: EventPlanRow, ships: SallyShip[], byId: Map<number, SallyShip>,
    areaName = '', mapMeta: (no: number | null | undefined) => { name: string; opetext: string } | undefined = () => undefined,
): string {
    const lines: string[] = [];
    // 標題優先序：使用者自訂 → 遊戲提供的活動名（api_mst_maparea）→ 海域編號。
    lines.push(`# ${plan.title || areaName || t('ov.eoAreaN', { n: plan.areaId })}`, '');

    const groups = new Map(groupBySally(ships).map(g => [g.sallyArea, g.ships]));
    const planned = plannedByTag(plan.stages, byId);
    const budget = sallyBudget(plan.stages, ships);
    lines.push(`- ${t('ov.eoFree')}：${budget.free}`);
    lines.push(`- ${t('ov.eoPlannedStamp')}：${budget.plannedStamp.length}`);
    lines.push(`- ${t('ov.eoFreeAfter')}：${budget.freeAfterPlan}`, '');

    // **空分項一律不輸出**（使用者要求）：只有實際就不印計畫欄、只有計畫就不印實際欄，
    // 兩者皆空則整個標籤略過；同理無內容時連 `## 標籤總帳` 標題都不印。
    // 理由：這份 Markdown 是給人／LLM 讀的摘要，印一排「—」只會稀釋訊號。
    const ledger: string[] = [];
    for (const id of knownTagIds(plan, ships)) {
        const actual = groups.get(id) ?? [];
        const plans = planned.get(id) ?? [];
        if (!actual.length && !plans.length) continue;
        ledger.push(`### ${tagFull(plan, id)}`);
        if (actual.length) {
            ledger.push(`- ${t('ov.eoActual')}（${actual.length}）：${actual.map(s => s.name).join('、')}`);
        }
        if (plans.length) {
            ledger.push(`- ${t('ov.eoPlannedCol')}（${plans.length}）：${
                plans.map(m => m.state === 'pending' ? m.name : `${m.name}⚠`).join('、')}`);
        }
        ledger.push('');
    }
    if (ledger.length) lines.push(`## ${t('ov.eoTagLedger')}`, '', ...ledger);

    // 關卡同樣省略空欄位：未填的標籤約束、沒有編成的關卡都不佔篇幅。
    const stages: string[] = [];
    for (const stage of plan.stages) {
        const check = checkStage(stage, byId);
        if (!stage.allowedTags.length && stage.grantsTag == null && !check.slots.length) continue;
        const meta = mapMeta(stage.mapNo);
        stages.push(`### ${stage.label || meta?.opetext || t('ov.eoStageUnnamed')}`);
        if (meta?.name) stages.push(`*${meta.name}*`);
        if (stage.allowedTags.length) {
            stages.push(`- ${t('ov.eoAllowed')}：${stage.allowedTags.map(id => tagFull(plan, id)).join('、')}`);
        }
        if (stage.grantsTag != null) {
            stages.push(`- ${t('ov.eoGrants')}：${tagFull(plan, stage.grantsTag)}`);
        }
        for (const slot of check.slots) {
            const mark = slot.status === 'ok' ? '✅' : slot.status === 'blocked' ? '❌'
                : slot.status === 'willStamp' ? '⚠' : slot.status === 'role' ? '□' : '·';
            const tag = slot.sallyArea > 0 ? `（#${slot.sallyArea}）` : '';
            stages.push(`  - ${mark} ${slot.name || t('ov.eoSlotGone')}${tag}`);
        }
        stages.push('');
    }
    if (stages.length) lines.push(`## ${t('ov.eoStages')}`, '', ...stages);

    return lines.join('\n');
}

// ── 分區本體 ───────────────────────────────────────────────────────────
export const eventOpsSection: OverviewSection = {
    id: 'event-ops',
    titleKey: 'ov.eventOps',
    async render(el: HTMLElement, ctx: SectionContext) {
        // **先畫殼、再讀資料**：eventPlans／observations 可能被 schema 升級堵住。
        el.innerHTML = `
            <div id="eo-top"><div class="ov-empty">${esc(t('ov.loading'))}</div></div>
            <div class="eo-main">
                <div id="eo-stages" class="eo-stages-pane"></div>
                <aside id="eo-picker" class="eo-picker-pane"></aside>
            </div>`;
        const topEl = el.querySelector<HTMLElement>('#eo-top')!;
        const stagesEl = el.querySelector<HTMLElement>('#eo-stages')!;

        const state = ctx.state;
        const owned = state.ownedShips();
        const liveShips = toSallyShips(owned);

        let saved: EventPlanRow[];
        let observations: Map<number, GrantObservation[]>;
        try {
            saved = await db.eventPlans.toArray();
            observations = await loadObservations();
        } catch (error) {
            topEl.innerHTML = `<div class="ov-empty">${esc(t('ov.loadFailed', { msg: String((error as Error)?.message ?? error) }))}</div>`;
            return;
        }

        const areas = [...new Set([...detectEventAreas(state), ...saved.map(p => p.areaId)])].sort((a, b) => a - b);

        // 活動未開始（或活動結束後遊戲已從 mapinfo 移除該海域）時偵測不到 area，
        // 但提督常在活動前就想先排表，故一律提供手動建立——areaId 只是這份計畫的識別。
        if (!areas.length) {
            el.innerHTML = `<div class="ov-empty">
                <p>${esc(t('ov.eoNoEvent'))}</p>
                <p class="dim">${esc(t('ov.eoCreateHint'))}</p>
                <div class="ov-toolbar" style="justify-content:center">
                    <input id="eo-new-area" class="eo-role-input" type="number" min="${EVENT_AREA_MIN}" value="62">
                    <button class="ov-btn" id="eo-create">${esc(t('ov.eoCreate'))}</button>
                </div>
            </div>`;
            el.querySelector('#eo-create')!.addEventListener('click', async () => {
                const v = Number(el.querySelector<HTMLInputElement>('#eo-new-area')!.value);
                if (!Number.isInteger(v) || v < EVENT_AREA_MIN) return;
                await db.eventPlans.put(blankPlan(v));
                ctx.rerender();
            });
            return;
        }

        let areaId = areas[areas.length - 1];
        let plan = saved.find(p => p.areaId === areaId) ?? blankPlan(areaId);
        let selectedKey: string | null = null;
        let ships: SallyShip[] = [];
        let byId = new Map<number, SallyShip>();
        let displayOwned: OwnedShipView[] = [];
        let established = new Set<number>();

        /** 只以目前 master 判定活動是否仍在進行；runtime mapinfo 不能授權快照寫入。 */
        const areaIsCurrentInMaster = () => state.mapsOfArea(areaId).length > 0;
        const refreshSallyRoster = () => {
            const roster = resolveSallyRoster(liveShips, plan.sallySnapshot, areaIsCurrentInMaster());
            ships = roster.ships;
            byId = new Map(ships.map(ship => [ship.id, ship]));
            // ship picker 也必須使用同一份完整資料來源，否則歷史板的篩選／鎖定會和總帳不一致。
            displayOwned = owned.map(ship => ({ ...ship, sallyArea: byId.get(ship.id)?.sallyArea ?? 0 }));
            established = establishedTags(ships);
        };
        // 髒資料同 key 多列：只改後列的 key、不刪列（手輸計畫不能從 events 重投影）。
        const uniquified = ensureUniqueStageKeys(plan.stages);
        if (uniquified.changed) {
            plan.stages = uniquified.stages;
            await savePlan(plan);
        }
        await saveSallySnapshotIfNeeded(plan, liveShips, areaIsCurrentInMaster());
        refreshSallyRoster();

        /** 該標籤已確立＝遊戲實際已貼標，計畫端不得再改（除非使用者解除鎖定）。 */
        const isLocked = (tagId: number | null) =>
            tagId != null && established.has(tagId) && !plan.unlocked;
        /** 關卡的標籤約束是否鎖定：牽涉到任何已確立標籤就鎖，那部分已成事實。 */
        const stageLocked = (stage: PlanStage) =>
            isLocked(stage.grantsTag) || stage.allowedTags.some(id => isLocked(id));

        // 清掉 loading；後續 drawTop／drawStages 會填入實際內容。
        topEl.innerHTML = '';

        /**
         * 該活動 area 的海域清單（帶遊戲提供的海域名與作戰名）。
         * 來自 start2 的 `api_mst_mapinfo`；真的取不到才回退成無名的 E1–E7。
         */
        const mapChoices = (): { no: number; label: string; title: string }[] => {
            const maps = state.mapsOfArea(areaId);
            if (maps.length) {
                return maps.map(m => ({
                    no: m.no,
                    label: `${t('ov.eoMapN', { area: areaId, n: m.no })}${m.opetext ? `　${m.opetext}` : ''}`,
                    title: m.name,
                }));
            }
            return [1, 2, 3, 4, 5, 6, 7].map(no => ({
                no, label: t('ov.eoMapN', { area: areaId, n: no }), title: '',
            }));
        };
        /** 該活動 area 有沒有遊戲提供的海域 master。沒有（舊活動／手動建的板）才走手填模式。 */
        const hasMaster = () => state.mapsOfArea(areaId).length > 0;

        /**
         * **關卡列＝遊戲的海域清單，不由使用者建立**（使用者要求）。抓得到 master 就依
         * `api_mst_mapinfo` 全數列出，名稱直接用「E{n}　作戰名」，不需要命名也不需要選海域。
         *
         * 既有資料以 mapNo 對應；舊資料沒有 mapNo 的用 guessMapNo(label) 補救。**對應不上
         * 又有內容的一律保留在末尾**，不能因為改版就把使用者填過的東西丟掉。
         */
        /** 關卡列＝遊戲的海域清單（見 event-plan.ts reconcileStages 的資料保全規則）。 */
        const syncStages = () => { plan.stages = reconcileStages(plan.stages, state.mapsOfArea(areaId)); };

        const mapOf = (no: number | null | undefined) =>
            no == null ? undefined : state.mapsOfArea(areaId).find(x => x.no === no);
        /** 觀測訊息等處的短標示：E 編號＋作戰名。 */
        const mapLabel = (no: number) => {
            const m = mapOf(no);
            return `${t('ov.eoMapN', { area: areaId, n: no })}${m?.opetext ? `　${m.opetext}` : ''}`;
        };
        /**
         * 關卡顯示名。抓得到 master 就是「**E{n}　作戰名**」（使用者指定的格式：62-1 換算成
         * E1，後面直接接作戰名，不顯示 area 編號——玩家不需要知道 62 是什麼）。
         * 海域名（api_name）退為副標題，只在展開時顯示。
         * 抓不到 master 的舊板才回退到使用者自填的 label。
         */
        const stageTitle = (stage: PlanStage) => {
            const m = mapOf(stage.mapNo);
            if (stage.phase) return stage.label || (m ? `E${m.no}` : t('ov.eoStageUnnamed'));
            if (m) return `E${m.no}　${m.opetext || m.name}`;
            return stage.label || t('ov.eoStageUnnamed');
        };
        /** 該關卡實際觀測到貼出過的標籤（未指定海域則無從對照）。 */
        const observedFor = (stage: PlanStage) => stage.mapNo == null
            ? [] : grantedTagsOf(observations, areaId * 10 + stage.mapNo);

        const selectedStage = () => plan.stages.find(s => s.key === selectedKey) ?? null;
        const pickedIds = () => new Set((selectedStage()?.slots ?? [])
            .map(sl => sl.shipId).filter((v): v is number => v != null));
        const hintText = () => (selectedStage() ? undefined : t('ov.eoSelectStageHint'));
        // 已排進計畫（任一關卡）的艦。與「無標籤」是不同維度——標籤要出擊才會貼上，
        // 排表階段真正想問的是「還有誰沒排」。
        const plannedIds = () => new Set(plan.stages.flatMap(st =>
            st.slots.map(sl => sl.shipId).filter((v): v is number => v != null)));

        const picker: ShipPickerHandle = renderShipPicker(el.querySelector<HTMLElement>('#eo-picker')!, {
            ships: displayOwned,
            tagLabel: id => tagFull(plan, id),
            pickedIds: pickedIds(),
            pickHint: hintText(),
            extraSallyTags: knownTagIds(plan, ships),
            plannedIds: plannedIds(),
            onPick(ship) {
                const stage = selectedStage();
                if (!stage) return;
                if (stage.slots.some(sl => sl.shipId === ship.id)) return;   // 已在此關卡，不重複加
                stage.slots.push({ shipId: ship.id });
                commit();
            },
        });

        async function commit() {
            await savePlan(plan);
            draw();
        }

        function draw() {
            syncStages();
            drawTop();
            drawStages();
            picker.refresh({
                ships: displayOwned, pickedIds: pickedIds(), pickHint: hintText(),
                extraSallyTags: knownTagIds(plan, ships), plannedIds: plannedIds(),
            });
        }

        // ── 上半：海域／預算／標籤總帳／矛盾 ──
        function drawTop() {
            const tagIds = knownTagIds(plan, ships);
            const groups = new Map(groupBySally(ships).map(g => [g.sallyArea, g.ships]));
            const planned = plannedByTag(plan.stages, byId);
            const budget = sallyBudget(plan.stages, ships);
            const conflicts = findPlanConflicts(plan.stages, byId);
            const labelOf = (key: string) => plan.stages.find(s => s.key === key)?.label || key;

            // 計畫欄的每艘船都可就地移除。已被實際貼標者（fulfilled／conflict）額外標警示：
            // 計畫會隨實際出擊逐漸過期，使用者要看得到「這格已經沒用了」才知道清哪一筆。
            const plannedChip = (m: PlannedMember) => {
                const mark = m.state === 'fulfilled' ? '✔' : m.state === 'conflict' ? '⚠' : '';
                const tip = m.state === 'pending' ? t('ov.eoStatusWillStamp')
                    : m.state === 'fulfilled' ? t('ov.eoPlanFulfilled', { tag: `#${m.sallyArea}` })
                        : t('ov.eoPlanConflict', { tag: `#${m.sallyArea}` });
                return `<span class="eo-pchip eo-p-${m.state}" title="${esc(tip)}">${mark}${esc(m.name)}<button
                    class="eo-pchip-del" data-stage="${esc(m.stageKey)}" data-idx="${m.slotIndex}"
                    title="${esc(t('ov.eoRemoveFromPlan'))}">×</button></span>`;
            };

            const ledger = tagIds.map(id => {
                const members = groups.get(id) ?? [];
                const plans = planned.get(id) ?? [];
                const locked = isLocked(id);
                return `<div class="eo-ledger-row">
                    <span class="eo-tag-id">#${id}</span>
                    <input class="eo-tag-name" data-tag="${id}" value="${esc(plan.tags.find(tg => tg.sallyArea === id)?.name ?? '')}"
                           placeholder="${esc(t('ov.eoTagUnnamed', { n: id }))}" ${locked ? 'readonly' : ''}
                           title="${esc(locked ? t('ov.eoLockedHint') : '')}">
                    ${locked ? `<span class="eo-lock" title="${esc(t('ov.eoLockedHint'))}">🔒</span>` : ''}
                    <span class="eo-tag-cols">
                        <span class="eo-tag-col">
                            <span class="eo-col-label dim">${esc(t('ov.eoActual'))}</span>
                            <span class="eo-tag-count">${members.length}</span>
                            <span class="eo-tag-members">${members.length
                                ? members.map(sh => esc(sh.name)).join('　')
                                : `<span class="dim">${esc(t('ov.eoTagEmpty'))}</span>`}</span>
                        </span>
                        <span class="eo-tag-col">
                            <span class="eo-col-label dim">${esc(t('ov.eoPlannedCol'))}</span>
                            <span class="eo-tag-count eo-s-willStamp">${plans.length}</span>
                            <span class="eo-tag-members">${plans.length
                                ? plans.map(plannedChip).join('')
                                : `<span class="dim">${esc(t('ov.eoPlannedNone'))}</span>`}</span>
                        </span>
                    </span>
                    ${members.length === 0 && plans.length === 0
                        ? `<button class="ov-btn danger eo-tag-del" data-tag="${id}">${esc(t('ov.eoDelete'))}</button>`
                        : ''}
                </div>`;
            }).join('');

            topEl.innerHTML = `
                <div class="ov-toolbar">
                    ${areas.length > 1 ? `<select id="eo-area">${areas.map(a => {
                        const name = state.mapAreaName(a);
                        return `<option value="${a}" ${a === areaId ? 'selected' : ''}>${
                            esc(name || t('ov.eoAreaN', { n: a }))}</option>`;
                    }).join('')}</select>` : `<b class="eo-area-name">${
                        esc(state.mapAreaName(areaId) || t('ov.eoAreaN', { n: areaId }))}</b>`}
                    ${state.mapAreaName(areaId) ? '' : `<input id="eo-title" value="${esc(plan.title)}"
                           placeholder="${esc(t('ov.eoTitlePlaceholder'))}">`}
                    <button class="ov-btn" id="eo-md-copy">${esc(t('ov.copyMarkdown'))}</button>
                    <button class="ov-btn" id="eo-md-dl">${esc(t('ov.downloadMarkdown'))}</button>
                    <span class="grow"></span>
                    <span class="eo-budget">
                        <span class="eo-b-item"><b>${budget.free}</b> ${esc(t('ov.eoFree'))}</span>
                        <span class="eo-b-item eo-s-willStamp"><b>${budget.plannedStamp.length}</b> ${esc(t('ov.eoPlannedStamp'))}</span>
                        <span class="eo-b-item"><b>${budget.freeAfterPlan}</b> ${esc(t('ov.eoFreeAfter'))}</span>
                    </span>
                </div>
                <h3 class="ov-subhead">${esc(t('ov.eoTagLedger'))}</h3>
                <p class="ov-note dim">${esc(t('ov.eoTagLedgerNote'))}</p>
                <div class="eo-ledger">
                    ${ledger || `<div class="ov-empty">${esc(t('ov.eoNoTags'))}</div>`}
                </div>
                <div class="ov-toolbar" style="margin:6px 0 10px">
                    <button class="ov-btn" id="eo-add-tag">＋ ${esc(t('ov.eoAddTag'))}</button>
                    ${established.size ? `<button class="ov-btn ${plan.unlocked ? '' : 'pin on'}" id="eo-unlock">${
                        esc(plan.unlocked ? t('ov.eoRelock') : t('ov.eoUnlock'))}</button>` : ''}
                </div>
                ${conflicts.length ? `<ul class="eo-conflicts">${conflicts.map(c => `<li class="eo-conflict ${c.severity}">
                    <span class="eo-badge">${esc(t(c.severity === 'certain' ? 'ov.eoConflictCertain' : 'ov.eoConflictPossible'))}</span>
                    ${esc(t('ov.eoConflictDesc', { name: c.name, stages: c.stageKeys.map(labelOf).join('・') }))}</li>`).join('')}</ul>` : ''}`;
            bindTop();
        }

        // ── 下半左欄：關卡（一行一關，選中才展開）──
        function drawStages() {
            const tagIds = knownTagIds(plan, ships);
            // 摺疊列的欄位含義光靠 chip 與箭頭讀不出來（使用者實際看不懂），故加一列表頭。
            // 成本只有一行，卻讓「可進入 / 會貼上」兩欄的分別一眼可辨。
            const header = `<div class="eo-stage-row eo-stage-head">
                <span>${esc(t('ov.eoColStage'))}</span>
                <span>${esc(t('ov.eoColAllowed'))}</span>
                <span>${esc(t('ov.eoColGrants'))}</span>
                <span>${esc(t('ov.eoColSlots'))}</span>
                <span>${esc(t('ov.eoColStatus'))}</span>
            </div>`;
            stagesEl.innerHTML = `
                <div class="eo-stage-list">
                    ${plan.stages.length ? header + plan.stages.map((s, i) => stageRowHtml(s, tagIds, i)).join('')
                        : `<div class="ov-empty">${esc(t('ov.eoNoStages'))}</div>`}
                </div>
                ${hasMaster() ? '' : `<div class="ov-toolbar" style="margin-top:8px">
                    <button class="ov-btn" id="eo-add-stage">＋ ${esc(t('ov.eoAddStage'))}</button>
                </div>`}`;
            bindStages();
        }

        function stageRowHtml(stage: PlanStage, tagIds: number[], stageIdx: number): string {
            const check = checkStage(stage, byId);
            const open = stage.key === selectedKey;
            const locked = stageLocked(stage);
            const badge = check.blocked.length
                ? `<span class="eo-s-blocked">✕${check.blocked.length}</span>`
                : check.willStamp.length
                    ? `<span class="eo-s-willStamp">▲${check.willStamp.length}</span>`
                    : stage.slots.length ? '<span class="eo-s-ok">✓</span>' : '<span class="dim">—</span>';
            // 摺疊狀態也要看得到標籤**名稱**，不能只有 #id——收起來就認不出是哪個等於沒收。
            const tagChips = stage.allowedTags.length
                ? stage.allowedTags.map(id => `<span class="eo-minitag">${esc(tagFull(plan, id))}</span>`).join('')
                : `<span class="dim">${esc(t('ov.eoGrantsNone'))}</span>`;
            // 摺疊狀態下也要看得到「實際觀測與計畫對不上」，否則要一關一關點開才發現。
            const seen = observedFor(stage);
            const mismatch = seen.length > 0 && stage.grantsTag != null && !seen.includes(stage.grantsTag);
            const summary = `<div class="eo-stage-row${open ? ' open' : ''}${mismatch ? ' mismatch' : ''}${
                stage.phase ? ' phase' : ''}" data-stage="${esc(stage.key)}">
                <span class="eo-stage-name">${esc(stageTitle(stage))}${locked ? ' 🔒' : ''}</span>
                <span class="eo-stage-tags">${tagChips}</span>
                <span class="eo-stage-grant dim">${stage.grantsTag != null ? esc(tagFull(plan, stage.grantsTag)) : '—'}${
                    mismatch ? ` <span class="eo-s-blocked" title="${esc(t('ov.eoObservedMismatch'))}">!</span>` : ''}</span>
                <span class="eo-stage-count dim">${esc(t('ov.eoSlotsN', { n: stage.slots.length }))}</span>
                <span class="eo-stage-badge">${badge}</span>
            </div>`;
            if (!open) return summary;

            const chips = tagIds.map(id => `<label class="eo-chip ${stage.allowedTags.includes(id) ? 'on' : ''}">
                <input type="checkbox" class="eo-allow" data-stage="${esc(stage.key)}" data-tag="${id}"
                       ${stage.allowedTags.includes(id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>${esc(tagFull(plan, id))}</label>`).join('');
            const grants = [`<option value="">${esc(t('ov.eoGrantsNone'))}</option>`]
                .concat(tagIds.map(id => `<option value="${id}" ${stage.grantsTag === id ? 'selected' : ''}>${esc(tagFull(plan, id))}</option>`))
                .join('');
            const slots = check.slots.map((s, i) => `<span class="eo-slot eo-s-${s.status}" title="${esc(t(STATUS_KEY[s.status]))}">
                ${esc(s.name || t('ov.eoSlotGone'))}${s.sallyArea > 0 ? `<span class="eo-slot-tag">#${s.sallyArea}</span>` : ''}
                <button class="eo-slot-del" data-stage="${esc(stage.key)}" data-idx="${i}" title="${esc(t('ov.eoDelete'))}">×</button></span>`).join('');
            const warn = !check.passable
                ? `<div class="eo-warn eo-s-blocked">${esc(t('ov.eoNotPassable', { n: check.blocked.length }))}</div>`
                : check.willStamp.length
                    ? `<div class="eo-warn eo-s-willStamp">${esc(t('ov.eoWillStampN', {
                        n: check.willStamp.length,
                        tag: stage.grantsTag != null ? tagFull(plan, stage.grantsTag) : t('ov.eoGrantsNone'),
                    }))}</div>`
                    : '';
            // **每個欄位一列「標題｜控制項」**，不要把它們排成一條會換行的 flex——
            // 原本那樣在窄一點的寬度下，「無標籤船會被貼上」的標題會留在上一行、下拉選單被
            // 擠到下一行，兩者關聯斷掉，使用者因而讀不懂這串在幹嘛（實際回報過）。
            // 副標題＝海域名（地理位置）。只在展開時顯示——摺疊列一關一行是刻意的密度設計，
            // 多一行副標題會讓 7 關變 14 行，違背當初把卡片壓成單列的理由。
            const sub = mapOf(stage.mapNo)?.name;
            return summary + `<div class="eo-stage-body">
                ${sub ? `<div class="eo-stage-sub dim">${esc(sub)}</div>` : ''}
                <div class="eo-fields">
                    ${mapOf(stage.mapNo) && !stage.phase ? '' : `<div class="eo-field">
                        <span class="eo-field-label">${esc(stage.phase ? t('ov.eoPhaseNameLabel') : t('ov.eoStageNameLabel'))}</span>
                        <span class="eo-field-ctl"><input class="eo-stage-label" data-stage="${esc(stage.key)}"
                            value="${esc(stage.label)}" placeholder="${esc(t('ov.eoStageLabel'))}"></span>
                    </div>`}
                    <div class="eo-field">
                        <span class="eo-field-label">${esc(t('ov.eoAllowed'))}</span>
                        <span class="eo-field-ctl">${chips || `<span class="dim">${esc(t('ov.eoNoTags'))}</span>`}</span>
                    </div>
                    <div class="eo-field">
                        <span class="eo-field-label">${esc(t('ov.eoGrants'))}</span>
                        <span class="eo-field-ctl"><select class="eo-grants" data-stage="${esc(stage.key)}"
                            ${locked ? 'disabled' : ''}>${grants}</select></span>
                    </div>
                    ${mapOf(stage.mapNo) ? '' : `<div class="eo-field">
                        <span class="eo-field-label">${esc(t('ov.eoMapNo'))}</span>
                        <span class="eo-field-ctl"><select class="eo-mapno" data-stage="${esc(stage.key)}">
                            <option value="">${esc(t('ov.eoMapNone'))}</option>
                            ${mapChoices().map(c => `<option value="${c.no}" ${stage.mapNo === c.no ? 'selected' : ''}
                                title="${esc(c.title)}">${esc(c.label)}</option>`).join('')}
                        </select></span>
                    </div>`}
                    <p class="eo-field-help dim">${esc(t('ov.eoRuleHelp'))}</p>
                </div>
                ${observedHtml(stage)}
                ${locked ? `<div class="eo-warn dim">🔒 ${esc(t('ov.eoLockedHint'))}</div>` : ''}
                <div class="eo-slots">${slots || `<span class="dim">${esc(t('ov.eoPickHint'))}</span>`}</div>
                ${warn}
                <div class="ov-toolbar eo-stage-actions">
                    ${[1, 2, 3, 4].map(n => `<button class="ov-btn eo-import" data-stage="${esc(stage.key)}" data-fleet="${n}">${esc(t('ov.eoImportFleet', { n }))}</button>`).join('')}
                    <input class="eo-role-input" data-stage="${esc(stage.key)}" placeholder="${esc(t('ov.eoRolePlaceholder'))}">
                    <button class="ov-btn eo-add-role" data-stage="${esc(stage.key)}">${esc(t('ov.eoAddRole'))}</button>
                    <span class="grow"></span>
                    <button class="ov-btn eo-add-phase" data-stage="${esc(stage.key)}">＋ ${esc(t('ov.eoAddPhase'))}</button>
                    ${mapOf(stage.mapNo) && !stage.phase ? '' : `<button class="ov-btn danger eo-stage-del"
                        data-stage="${esc(stage.key)}" data-stage-idx="${stageIdx}">${esc(t('ov.eoDelete'))}</button>`}
                </div>
            </div>`;
        }

        /**
         * 實際貼標觀測區塊。**只警示、不自動覆寫**——觀測的粒度只到「海域」，而標籤是由
         * 海域＋路線決定的（同一張圖不同階段可貼不同標籤），自動覆寫會把其他階段的正確
         * 設定改錯，且那是鎖定值。要不要採用由使用者按「套用」決定。
         */
        function observedHtml(stage: PlanStage): string {
            if (stage.mapNo == null) return '';
            const seen = observedFor(stage);
            if (!seen.length) return `<div class="eo-observed dim">${esc(t('ov.eoObservedNone'))}</div>`;
            const ambiguous = (observations.get(areaId * 10 + stage.mapNo) ?? []).some(o => o.ambiguous);
            const match = stage.grantsTag != null && seen.includes(stage.grantsTag);
            const list = seen.map(id => esc(tagFull(plan, id))).join('、');
            const apply = match ? '' : seen.map(id =>
                `<button class="ov-btn eo-apply" data-stage="${esc(stage.key)}" data-tag="${id}"
                    >${esc(t('ov.eoApplyTag', { tag: tagFull(plan, id) }))}</button>`).join(' ');
            return `<div class="eo-observed ${match ? 'ok' : 'mismatch'}">
                <b>${esc(t('ov.eoObserved'))}</b>${esc(t('ov.eoObservedList', {
                    map: mapLabel(stage.mapNo), tags: list }))}
                ${ambiguous ? `<span class="dim">${esc(t('ov.eoObservedAmbiguous'))}</span>` : ''}
                ${apply ? `<div class="eo-observed-actions">${apply}</div>` : ''}
            </div>`;
        }

        const stageOf = (key: string | undefined) => plan.stages.find(s => s.key === key);

        /** 從某個計畫格移除一艘船（標籤總帳的計畫欄與關卡的編成格共用）。 */
        function removeSlot(stageKey: string | undefined, idx: number) {
            const stage = stageOf(stageKey);
            if (!stage || !Number.isInteger(idx)) return;
            stage.slots.splice(idx, 1);
            commit();
        }

        function bindTop() {
            topEl.querySelector<HTMLSelectElement>('#eo-area')?.addEventListener('change', async e => {
                areaId = Number((e.currentTarget as HTMLSelectElement).value);
                plan = (await db.eventPlans.get(areaId)) ?? blankPlan(areaId);
                const fixed = ensureUniqueStageKeys(plan.stages);
                if (fixed.changed) {
                    plan.stages = fixed.stages;
                    await savePlan(plan);
                }
                await saveSallySnapshotIfNeeded(plan, liveShips, areaIsCurrentInMaster());
                refreshSallyRoster();
                selectedKey = null;
                draw();
            });
            topEl.querySelector<HTMLInputElement>('#eo-title')?.addEventListener('change', e => {
                plan.title = (e.currentTarget as HTMLInputElement).value.trim();
                commit();
            });
            topEl.querySelector('#eo-md-copy')!.addEventListener('click', e =>
                copyWithFeedback(e.currentTarget as HTMLButtonElement,
                    buildMarkdown(plan, ships, byId, state.mapAreaName(areaId), mapOf), t('ov.copied')));
            topEl.querySelector('#eo-md-dl')!.addEventListener('click', () =>
                downloadText(`event-ops-${plan.areaId}.md`,
                    buildMarkdown(plan, ships, byId, state.mapAreaName(areaId), mapOf), 'text/markdown'));
            topEl.querySelector('#eo-add-tag')!.addEventListener('click', () => {
                const used = new Set(knownTagIds(plan, ships));
                let next = 1;
                while (used.has(next)) next++;
                // 手動宣告的標籤：nameSource 恆為 'manual'。auto 分支預留但目前永遠不會被寫入
                // ——標籤名不存在於任何已知封包，見 utils/event-plan.ts 檔頭。
                plan.tags.push({ sallyArea: next, name: '', nameSource: 'manual' });
                commit();
            });
            topEl.querySelector('#eo-unlock')?.addEventListener('click', () => {
                plan.unlocked = !plan.unlocked;
                commit();
            });
            topEl.querySelectorAll<HTMLInputElement>('.eo-tag-name').forEach(input =>
                input.addEventListener('change', () => {
                    const id = Number(input.dataset.tag);
                    if (isLocked(id)) return;
                    const name = input.value.trim();
                    const existing = plan.tags.find(tg => tg.sallyArea === id);
                    if (existing) { existing.name = name; existing.nameSource = 'manual'; }
                    else plan.tags.push({ sallyArea: id, name, nameSource: 'manual' });
                    commit();
                }));
            topEl.querySelectorAll<HTMLButtonElement>('.eo-tag-del').forEach(btn =>
                btn.addEventListener('click', () => {
                    const id = Number(btn.dataset.tag);
                    if (isLocked(id)) return;
                    plan.tags = plan.tags.filter(tg => tg.sallyArea !== id);
                    for (const s of plan.stages) {
                        s.allowedTags = s.allowedTags.filter(x => x !== id);
                        if (s.grantsTag === id) s.grantsTag = null;
                    }
                    commit();
                }));
            topEl.querySelectorAll<HTMLButtonElement>('.eo-pchip-del').forEach(btn =>
                btn.addEventListener('click', () => removeSlot(btn.dataset.stage, Number(btn.dataset.idx))));
        }

        function bindStages() {
            stagesEl.querySelector('#eo-add-stage')?.addEventListener('click', () => {
                const key = newStageKey(plan.stages.map(s => s.key));
                plan.stages.push({ key, label: '', allowedTags: [], grantsTag: null, slots: [] });
                selectedKey = key;   // 新增後直接展開，省一次點擊
                commit();
            });
            stagesEl.querySelectorAll<HTMLElement>('.eo-stage-row').forEach(row =>
                row.addEventListener('click', e => {
                    // 展開列內的控制項不應觸發收合
                    if ((e.target as HTMLElement).closest('input, select, button')) return;
                    const key = row.dataset.stage!;
                    selectedKey = selectedKey === key ? null : key;
                    drawStages();
                    picker.refresh({ pickedIds: pickedIds(), pickHint: hintText() });
                }));
            stagesEl.querySelectorAll<HTMLInputElement>('.eo-stage-label').forEach(input =>
                input.addEventListener('change', () => {
                    const stage = stageOf(input.dataset.stage);
                    if (!stage) return;
                    stage.label = input.value.trim();
                    // 只在尚未指定時代填，永不覆寫使用者已選的海域。
                    if (stage.mapNo == null) stage.mapNo = guessMapNo(stage.label);
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLButtonElement>('.eo-add-phase').forEach(btn =>
                btn.addEventListener('click', () => {
                    const stage = stageOf(btn.dataset.stage);
                    if (!stage) return;
                    const no = stage.mapNo ?? null;
                    // 預設名沿用使用者表格的寫法：E4-1、E4-2…（依該圖既有階段數編號）
                    const n = plan.stages.filter(s2 => s2.phase && s2.mapNo === no).length + 1;
                    const key = newStageKey(plan.stages.map(s => s.key));
                    plan.stages.push({
                        key, label: no != null ? `E${no}-${n}` : '',
                        allowedTags: [], grantsTag: null, slots: [], mapNo: no, phase: true,
                    });
                    selectedKey = key;   // 新增後直接展開
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLSelectElement>('.eo-mapno').forEach(sel =>
                sel.addEventListener('change', () => {
                    const stage = stageOf(sel.dataset.stage);
                    if (!stage) return;
                    stage.mapNo = sel.value ? Number(sel.value) : null;
                    // 關卡名還空著就用該海域的作戰名代填；已有名稱一律不動。
                    if (!stage.label) stage.label = mapOf(stage.mapNo)?.opetext ?? '';
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLButtonElement>('.eo-apply').forEach(btn =>
                btn.addEventListener('click', () => {
                    const stage = stageOf(btn.dataset.stage);
                    if (!stage) return;
                    // 套用的是**實際觀測值**，故不受鎖定限制——鎖定是防手動改壞，
                    // 而這裡寫入的正是「出擊結果」這個唯一依歸。
                    stage.grantsTag = Number(btn.dataset.tag);
                    commit();
                }));
            // 刪除依陣列索引（data-stage-idx），同 key 髒資料時只動被點那一列，不一次砍多筆。
            stagesEl.querySelectorAll<HTMLButtonElement>('.eo-stage-del').forEach(btn =>
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.stageIdx);
                    if (!Number.isInteger(idx) || idx < 0 || idx >= plan.stages.length) return;
                    const removed = plan.stages[idx];
                    plan.stages = removeStageAt(plan.stages, idx);
                    if (selectedKey === removed.key) selectedKey = null;
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLInputElement>('.eo-allow').forEach(box =>
                box.addEventListener('change', () => {
                    const stage = stageOf(box.dataset.stage);
                    if (!stage || stageLocked(stage)) return;
                    const id = Number(box.dataset.tag);
                    stage.allowedTags = box.checked
                        ? [...stage.allowedTags, id].sort((a, b) => a - b)
                        : stage.allowedTags.filter(x => x !== id);
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLSelectElement>('.eo-grants').forEach(sel =>
                sel.addEventListener('change', () => {
                    const stage = stageOf(sel.dataset.stage);
                    if (!stage || stageLocked(stage)) return;
                    stage.grantsTag = sel.value ? Number(sel.value) : null;
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLButtonElement>('.eo-import').forEach(btn =>
                btn.addEventListener('click', () => {
                    const stage = stageOf(btn.dataset.stage);
                    if (!stage) return;
                    // 依編成順序帶入（旗艦在首），已在格內的艦不重複加。
                    const have = new Set(stage.slots.map(s => s.shipId).filter(Boolean));
                    for (const id of state.fleetShipIds(Number(btn.dataset.fleet))) {
                        if (!have.has(id)) stage.slots.push({ shipId: id });
                    }
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLButtonElement>('.eo-add-role').forEach(btn =>
                btn.addEventListener('click', () => {
                    const stage = stageOf(btn.dataset.stage);
                    const input = stagesEl.querySelector<HTMLInputElement>(`.eo-role-input[data-stage="${btn.dataset.stage}"]`);
                    const role = input?.value.trim();
                    if (!stage || !role) return;
                    stage.slots.push({ role });
                    commit();
                }));
            stagesEl.querySelectorAll<HTMLButtonElement>('.eo-slot-del').forEach(btn =>
                btn.addEventListener('click', () => removeSlot(btn.dataset.stage, Number(btn.dataset.idx))));
        }

        draw();
    },
};
