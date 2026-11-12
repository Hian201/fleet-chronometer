import {
    db, type ApiEventRow, type ExpeditionRow, type FactoryLogRow, type MaterialUseRow, type ReplayRow, type SortieBillRow,
    type SortieLogRow,
} from './db';
import { appendBattle, setDifficulty, startReplay } from './replay';
import {
    billShipFromApi, keepsMaterialsTracked, sortieBill, supportBill, supportPlanesLost, type BillShip, type SupportShip,
} from './sortie-bill';
import { GameState, isBossNode, type MapGaugeView } from './state';

export type EventProjectorMode = 'persist' | 'state-only';

interface PutTable<T> {
    put(row: T): PromiseLike<unknown>;
}

interface SortieTable extends PutTable<SortieLogRow> {
    get(key: number): PromiseLike<SortieLogRow | undefined>;
    filter(predicate: (row: SortieLogRow) => boolean): { toArray(): PromiseLike<SortieLogRow[]> };
    update(key: number, changes: Partial<SortieLogRow>): PromiseLike<unknown>;
}

interface ReplayTable extends PutTable<ReplayRow> {
    get(key: number): PromiseLike<ReplayRow | undefined>;
}

// 只暴露 projector 實際需要的 table 合約，讓測試可注入記憶體 adapter，正式環境則直接使用 Dexie。
export interface EventProjectorTables {
    sorties: SortieTable;
    factory: PutTable<FactoryLogRow>;
    replays: ReplayTable;
    expeditions: PutTable<ExpeditionRow>;
    materialUse: PutTable<MaterialUseRow>;
    sortieBills: PutTable<SortieBillRow>;
}

/** 出擊開始當下擷取、等回港結算的帳單上半。 */
interface PendingBill {
    sortieKey: number;
    ts: number;
    map: string;
    difficulty?: number;
    ships: BillShip[];
    /** 出擊開始當下的八項餘額；上一筆母港封包之後有未追蹤的資材進出時為 null。 */
    materials: number[] | null;
    /** 出擊開始時正在跑同海域支援遠征的艦隊；艦載機損失在途中的戰鬥封包累加。 */
    support: { deckId: number; ships: SupportShip[]; planesLost: number }[];
}

// 支援遠征的 api_disp_no：通常海域 33／34（南方海域），活動 S1／S2。辨認方式同 KC3Kai
// src/library/managers/SortieManager.js getSupportingFleet（disp_no＋遠征的海域＝出擊海域）。
const SUPPORT_DISP_NOS = new Set(['33', '34', 'S1', 'S2']);

/** 套用 reducer 之前才讀得到的值（reducer 會改掉它們）。 */
interface BeforeApply {
    /** speedchange：用桶的入渠槽裡的艦（reducer 會清空槽位）。 */
    bucketShipId?: number;
    /** air_corps/supply：補充前的燃料、鋁土。 */
    supplyFuel?: number;
    supplyBauxite?: number;
}

export type ProjectableEvent = Pick<ApiEventRow, 'ts' | 'path' | 'api'> & {
    id: number;
    req?: Record<string, string>;
};

export interface EventProjectorOptions {
    state: GameState;
    mode?: EventProjectorMode;
    tables?: EventProjectorTables;
    /**
     * 回傳 true 的海域（`${mapArea}-${mapNo}`）不寫 sorties／replays。只擋 derived 寫入，
     * state reducer 照常執行，任務計數不受影響。見 utils/sortie-exclude.ts。
     */
    skipSortieMap?: (map: string) => boolean;
}

export class EventProjector {
    readonly state: GameState;
    readonly mode: EventProjectorMode;
    readonly tables: EventProjectorTables;
    currentSortieKey = 0;
    currentReplay: ReplayRow | null = null;
    // 同 currentReplay，state-only 模式也要維護，map/start 在 cursor 前、回港在 cursor 後的出擊才接得上。
    pendingBill: PendingBill | null = null;
    // state.materials 是否與遊戲一致：母港封包設 true，之後出現 keepsMaterialsTracked() 不認得的封包就設
    // false。起始為 false——baseline snapshot 之後到第一筆母港之間發生過什麼無從得知。
    materialsTracked = false;
    readonly gaugeSeenUncleared = new Set<number>();
    readonly gaugeBroken = new Set<number>();
    // 在 map/start 決定整場是否不記錄；出擊途中改設定不會讓同一場只記一半。
    skipCurrentSortie = false;
    private readonly skipSortieMap: (map: string) => boolean;
    private activeMode: EventProjectorMode;
    // projectWithMode() 跨多個 await 步驟共用 this.activeMode；呼叫端（panel/main.ts 的
    // ready/pumping flag）目前保證同一個 projector 一次只處理一筆事件，絕不重入。這面旗標
    // 不是為了讓重入「能運作」，而是把違反這個假設的情況從「activeMode 被悄悄覆蓋、
    // 某些事件的 persist/state-only 判斷跟著讀錯」的靜默錯誤，變成立刻丟出的例外。
    private inFlight = false;

    constructor(options: EventProjectorOptions) {
        this.state = options.state;
        this.mode = options.mode ?? 'persist';
        this.activeMode = this.mode;
        this.tables = options.tables ?? db;
        this.skipSortieMap = options.skipSortieMap ?? (() => false);
    }

    async project(event: ProjectableEvent, afterStateApplied?: () => void): Promise<void> {
        await this.projectWithMode(event, this.mode, afterStateApplied);
    }

    // 啟動 replay 必須在同一個 projector 上逐事件切換模式，才能讓 cursor 前的事件重建
    // currentSortieKey/currentReplay/gauge context，並供 cursor 後的 persist 事件接續使用。
    async projectWithMode(
        event: ProjectableEvent,
        mode: EventProjectorMode,
        afterStateApplied?: () => void,
    ): Promise<void> {
        if (this.inFlight) {
            throw new Error(
                'EventProjector.projectWithMode() called re-entrantly — caller must await each ' +
                'event before projecting the next; activeMode is shared instance state and cannot ' +
                'safely interleave across concurrent calls.',
            );
        }
        this.inFlight = true;
        const previousMode = this.activeMode;
        this.activeMode = mode;
        const { id, ts, path, api, req } = event;

        try {
            // map/start 的事件 ID 是整次出擊的既有分組鍵，必須在 reducer 與各歸檔步驟前更新。
            if (path === 'api_req_map/start') this.currentSortieKey = id;
            const before = this.readBeforeApply(path, req);
            // 帶入原始 event.ts：泊地修理計時器錨點靠它，replay 時不能用「現在」。
            this.state.applyEvent(path, api, req, ts);
            if (path === 'api_req_map/start') {
                const sortie = this.state.sortieInfo;
                this.skipCurrentSortie = !!sortie && this.skipSortieMap(`${sortie.mapArea}-${sortie.mapNo}`);
            }
            afterStateApplied?.();
            await this.archiveSortie(id, ts, path, api);
            await this.archiveFactory(id, ts, path);
            await this.captureReplay(id, ts, path, api);
            await this.archiveExpedition(id, ts, path, api, req);
            await this.archiveMaterialUse(id, ts, path, api, req, before);
            await this.archiveSortieBill(id, ts, path, api);
            await this.detectClear(path);
            // 放在所有歸檔步驟之後：各步驟看到的是「這筆封包之前」的可信度。
            this.materialsTracked = path === 'api_port/port' || (this.materialsTracked && keepsMaterialsTracked(path));
        } finally {
            this.activeMode = previousMode;
            this.inFlight = false;
        }
    }

    private get shouldPersist(): boolean {
        return this.activeMode === 'persist';
    }

    private async archiveSortie(id: number, ts: number, path: string, api: any): Promise<void> {
        const sortie = this.state.sortieInfo;
        if (!sortie || this.skipCurrentSortie) return;
        if (path === 'api_req_sortie/battleresult' || path === 'api_req_combined_battle/battleresult') {
            const info = this.state.battleInfo;
            if (!info) return;
            const last = sortie.nodes[sortie.nodes.length - 1];
            const row: SortieLogRow = {
                eventId: id, sortieKey: this.currentSortieKey, ts,
                map: `${sortie.mapArea}-${sortie.mapNo}`,
                node: last?.id ?? 0, boss: isBossNode(last),
                // 節點類型：reducer 已從 map/start|next 存進 sortieInfo，缺席就不寫（見 db.ts）
                ...(last?.eventId === undefined ? {} : { nodeEventId: last.eventId }),
                ...(last?.eventKind === undefined ? {} : { nodeEventKind: last.eventKind }),
                kind: 'battle', rank: info.rank,
                seiku: info.planes.playerFighter.count > 0 ? info.seiku : null,
                enemyIds: info.enemyIds, enemyIdsEscort: info.enemyIdsEscort,
                drop: info.drop, taiha: info.isTaiha,
            };
            const dropMst = api?.api_get_ship?.api_ship_id;
            // 只接受 battle-result 已驗證的正整數 master ID；名稱僅供顯示，不能反向猜測。
            if (Number.isSafeInteger(dropMst) && dropMst > 0) row.dropMst = dropMst;
            // 結算封包的其餘欄位（皆已用 samples/6-5-ec_result.json 逐欄驗證）：
            // api_get_exp＝提督經驗值、api_mvp/api_mvp_combined＝MVP 位置（1-based，
            // 已與 analyzeBattle 的傷害推算在同一場真封包上比對一致）、
            // api_enemy_info.api_deck_name＝敵艦隊名。缺欄位就不寫，不補預設值。
            const getExp = api?.api_get_exp;
            if (Number.isSafeInteger(getExp) && getExp > 0) row.getExp = getExp;
            const mvp = api?.api_mvp;
            if (Number.isSafeInteger(mvp) && mvp > 0) row.mvp = mvp;
            const mvpEscort = api?.api_mvp_combined;
            if (Number.isSafeInteger(mvpEscort) && mvpEscort > 0) row.mvpEscort = mvpEscort;
            const enemyName = api?.api_enemy_info?.api_deck_name;
            if (typeof enemyName === 'string' && enemyName) row.enemyName = enemyName;
            if (this.shouldPersist) {
                // projection version bump 會重寫相同主鍵；cleared 是後續 mapinfo 轉變補上的旗標，
                // 不能因重投影 battle-result 而洗掉。dropMst 等 raw-derived 欄位仍以本次 row 為準。
                const existing = await this.tables.sorties.get(id);
                if (existing?.cleared) row.cleared = true;
                await this.tables.sorties.put(row);
            }
        } else if (path === 'api_req_map/next' && api?.api_destruction_battle) {
            // 基地空襲欄位仍維持既有 best-effort 讀法，不新增或猜測任何 packet 欄位。
            const destruction = api.api_destruction_battle;
            const row: SortieLogRow = {
                eventId: id, sortieKey: this.currentSortieKey, ts,
                map: `${sortie.mapArea}-${sortie.mapNo}`,
                node: api.api_no ?? 0, boss: false,
                ...(Number.isSafeInteger(api?.api_event_id) ? { nodeEventId: api.api_event_id } : {}),
                ...(Number.isSafeInteger(api?.api_event_kind) ? { nodeEventKind: api.api_event_kind } : {}),
                kind: 'raid', rank: '',
                seiku: destruction?.api_air_base_attack?.api_stage1?.api_disp_seiku ?? null,
                enemyIds: [], enemyIdsEscort: [],
                drop: null, taiha: false,
                raidLostKind: destruction?.api_lost_kind ?? 0,
            };
            if (this.shouldPersist) await this.tables.sorties.put(row);
        }
    }

    private async archiveFactory(id: number, ts: number, path: string): Promise<void> {
        let row: FactoryLogRow | null = null;
        if (path === 'api_req_kousyou/createitem' && this.state.lastDevelop) {
            const develop = this.state.lastDevelop;
            row = { eventId: id, ts, kind: 'develop', used: develop.used, secretary: develop.secretary, hqLv: this.state.hqLv, results: develop.results };
        } else if (path === 'api_req_kousyou/remodel_slot' && this.state.lastImprove) {
            const improve = this.state.lastImprove;
            row = {
                eventId: id, ts, kind: 'improve', used: improve.used, secretary: improve.secretary,
                hqLv: this.state.hqLv, gearMst: improve.gearMst, levelBefore: improve.levelBefore, levelAfter: improve.levelAfter,
                success: improve.success, certain: improve.certain,
            };
        } else if (path === 'api_req_kousyou/createship_speedchange' && this.state.lastSpeedup) {
            const speedup = this.state.lastSpeedup;
            const used = new Array(8).fill(0);
            used[4] = speedup.qty;
            row = {
                eventId: id, ts, kind: 'speedup', used, secretary: speedup.secretary,
                kdockId: speedup.kdockId, shipMst: speedup.shipMst, hqLv: this.state.hqLv,
            };
        }
        if (row && this.shouldPersist) await this.tables.factory.put(row);

        if (path === 'api_get_member/kdock' && this.state.newBuilds.length) {
            const multi = this.state.newBuilds.length > 1;
            for (const [index, build] of this.state.newBuilds.entries()) {
                const buildRow: FactoryLogRow = {
                    eventId: multi && index > 0 ? id + build.kdockId / 1000 : id,
                    ts, kind: 'build', used: build.used, secretary: build.secretary,
                    kdockId: build.kdockId, shipMst: build.shipMst, hqLv: this.state.hqLv,
                };
                if (this.shouldPersist) await this.tables.factory.put(buildRow);
            }
        }
    }

    private async captureReplay(id: number, ts: number, path: string, api: any): Promise<void> {
        if (path === 'api_req_map/start') {
            // reducer 已先更新 decks、combinedFlag 與 currentSortieFleetId，快照順序維持不變。
            if (this.skipCurrentSortie) {
                this.currentReplay = null;
                return;
            }
            this.currentReplay = startReplay(this.state, id, ts, api);
            const gauge = this.state.mapGauges.get(this.currentReplay.world * 10 + this.currentReplay.mapnum);
            setDifficulty(this.currentReplay, gauge?.selectedRank ?? 0);
            return;
        }
        // 回港＝這次出擊結束。reducer 已清掉 sortieInfo；若不關掉 replay，之後的
        // `api_req_practice/midnight_battle` 仍含 midnight，會被當成出擊夜戰寫入，
        // 節點又因沒有 sortieInfo 退成 0，KC3 battleplayer 無法播放。
        if (path === 'api_port/port') {
            this.currentReplay = null;
            return;
        }
        if (!this.currentReplay) return;
        if (path === 'api_req_map/next') {
            const bossCellNo = Number(api?.api_bosscell_no);
            if (Number.isSafeInteger(bossCellNo) && bossCellNo > 0) {
                this.currentReplay.bossCellNo = bossCellNo;
            }
            return;
        }
        // 沒有正在進行的出擊節點就不寫戰鬥。缺席時不可退成 node 0——那不是海域格子。
        const last = this.state.sortieInfo?.nodes[this.state.sortieInfo.nodes.length - 1];
        if (!last) return;
        const node = last.id;
        const isNightToDay = path.endsWith('/night_to_day') || path.endsWith('/ec_night_to_day');
        // 夜轉日回應仍以 `api_n_hougeki*` 表達夜戰；和一般 midnight 一樣併到
        // 同一節點的 yasen，不能因 endpoint 名稱含 day 就另開白天節點。
        // 演習夜戰路徑也含 midnight，但那不是出擊封包；回港事件若已被裁剪，sortieInfo
        // 仍可能殘留，必須在這裡排除，否則會併進最後一個出擊節點。
        const isPractice = path.startsWith('api_req_practice/');
        const isNight = !isPractice
            && ((path.includes('midnight') && !path.includes('sp_midnight')) || isNightToDay);
        const isResult = path.endsWith('battleresult');
        const isDay = !isNight && !isResult && !isPractice
            && (path.startsWith('api_req_sortie/battle') || path.startsWith('api_req_combined_battle/')
                || path.startsWith('api_req_battle_midnight/') || path.includes('airbattle'))
            && api?.api_f_nowhps;
        if (isDay) appendBattle(this.currentReplay, node, 'day', api);
        else if (isNight && api?.api_f_nowhps) appendBattle(this.currentReplay, node, 'night', api);
        else if (isResult) appendBattle(this.currentReplay, node, 'result', null, api?.api_win_rank);
        else return;
        if (this.shouldPersist) {
            // pinned 是使用者在 derived replay 上手動設定，不存在 raw event；重投影不得覆蓋。
            if (!this.currentReplay.pinned) {
                const existing = await this.tables.replays.get(this.currentReplay.sortieKey);
                if (existing?.pinned) this.currentReplay.pinned = true;
            }
            await this.tables.replays.put(this.currentReplay);
        }
    }

    private async archiveExpedition(
        id: number,
        ts: number,
        path: string,
        api: any,
        req?: Record<string, string>,
    ): Promise<void> {
        if (path !== 'api_req_mission/result') return;
        const deckId = Number(req?.api_deck_id ?? 0);
        const items: { id: number; count: number }[] = [];
        // 回航道具的種類看 api_useitem_flag[i]：1 高速修復材、2 高速建造材、3 開發資材，這三種的
        // api_useitem_id 不是正數，數量一律取 api_get_item{i+1}.api_useitem_count；4 以上才看 api_useitem_id
        // （KC3Kai src/library/modules/Kcsapi.js、ElectronicObserver Observer/kcsapi/api_req_mission/result.cs）。
        // flag 1–3 正好等於這三種資材的 useitem id，所以照樣存成 useitem id，items.id 的語意不變。
        const flags: unknown[] = Array.isArray(api?.api_useitem_flag) ? api.api_useitem_flag : [];
        for (const [index, key] of ['api_get_item1', 'api_get_item2'].entries()) {
            const item = api?.[key];
            const flag = Number(flags[index]);
            if (item && (flag === 1 || flag === 2 || flag === 3)) {
                items.push({ id: flag, count: item.api_useitem_count ?? 1 });
            } else if (item && item.api_useitem_id > 0) {
                items.push({ id: item.api_useitem_id, count: item.api_useitem_count ?? 1 });
            }
        }
        const row: ExpeditionRow = {
            eventId: id, ts, deckId,
            missionId: this.state.lastMissionByDeck.get(deckId - 1) ?? 0,
            name: api?.api_quest_name ?? '',
            result: api?.api_clear_result ?? 0,
            // api_get_material 並非永遠是陣列；已知會出現在「遠征中途取消／提前召回而失敗」
            // （result=0）時。確切原始值仍缺真封包樣本佐證，不猜語意，一律視同「沒有資源
            // 資料」退回空陣列，只防禦不臆測。
            resources: Array.isArray(api?.api_get_material)
                ? api.api_get_material.map((value: any) => Number(value) || 0)
                : [],
            items,
        };
        // result 到達時艦隊仍維持本次遠征的編成；把名稱與等級存成摘要，日後改編成也能
        // 回看當時帶了誰。歷史紀錄缺少此欄時不可反推，因此不做回填猜測。
        const fleet = this.state.fleets()[deckId - 1]?.ships
            .map(ship => ({ name: ship.name, level: ship.lv }));
        if (fleet?.length) row.fleet = fleet;
        if (this.shouldPersist) await this.tables.expeditions.put(row);
    }

    private readBeforeApply(path: string, req?: Record<string, string>): BeforeApply {
        if (path === 'api_req_nyukyo/speedchange') {
            const dockId = Number(req?.api_ndock_id);
            const dock = this.state.ndockData.find((d: any) => Number(d?.api_id) === dockId);
            const shipId = Number(dock?.api_ship_id);
            return Number.isSafeInteger(shipId) && shipId > 0 ? { bucketShipId: shipId } : {};
        }
        if (path === 'api_req_air_corps/supply') {
            return { supplyFuel: this.state.materials[0], supplyBauxite: this.state.materials[3] };
        }
        return {};
    }

    private async archiveMaterialUse(
        id: number,
        ts: number,
        path: string,
        api: any,
        req: Record<string, string> | undefined,
        before: BeforeApply,
    ): Promise<void> {
        let row: MaterialUseRow | null = null;
        if (path === 'api_req_nyukyo/start' && req?.api_highspeed === '1') {
            const shipId = Number(req.api_ship_id);
            row = {
                eventId: id, ts, kind: 'bucket', via: 'start',
                ...(Number.isSafeInteger(shipId) && shipId > 0 ? { shipId } : {}),
            };
        } else if (path === 'api_req_nyukyo/speedchange' && Number(req?.api_ndock_id) > 0) {
            row = {
                eventId: id, ts, kind: 'bucket', via: 'speedchange',
                ...(before.bucketShipId === undefined ? {} : { shipId: before.bucketShipId }),
            };
        } else if (path === 'api_req_air_corps/supply') {
            // req.api_area_id 是基地所屬海域（同 GameState.resolveAirBaseKeys 的來源）。缺就不寫，不猜。
            const areaId = Number(req?.api_area_id);
            if (Number.isSafeInteger(areaId) && areaId > 0) {
                // 回應只帶補充後的燃料、鋁土（samples/air-corps-supply.json）；補充前的餘額不可信時花費不可考。
                const spent = (prior: unknown, after: unknown) => (this.materialsTracked
                    && typeof prior === 'number' && Number.isFinite(prior)
                    && typeof after === 'number' && Number.isFinite(after) ? Math.max(0, prior - after) : null);
                row = {
                    eventId: id, ts, kind: 'airSupply', areaId,
                    fuel: spent(before.supplyFuel, api?.api_after_fuel),
                    bauxite: spent(before.supplyBauxite, api?.api_after_bauxite),
                };
            }
        } else if (path === 'api_req_kaisou/remodeling') {
            // req.api_id 是艦實例 id（KC3Kai Kcsapi.js、ElectronicObserver Observer/kcsapi/api_req_kaisou/remodeling.cs）。
            // reducer 不處理 remodeling，所以此刻 state 裡仍是改造前的形態；查不到就不寫，不猜。
            const shipId = Number(req?.api_id);
            const fromMst = Number(this.state.ships.get(shipId)?.api_ship_id);
            if (shipId > 0 && fromMst > 0) row = { eventId: id, ts, kind: 'remodel', shipId, fromMst };
        }
        if (row && this.shouldPersist) await this.tables.materialUse.put(row);
    }

    // 出擊帳單：map/start 套用後擷取出擊前的狀態（此時艦上還是出擊前的燃彈；途中估算要到 battleresult
    // 才寫回），出擊後第一筆母港封包套用後結算。缺出擊開始事件、或不記錄的海域都不寫。
    private async archiveSortieBill(id: number, ts: number, path: string, api: any): Promise<void> {
        if (path === 'api_req_map/start') {
            this.pendingBill = this.skipCurrentSortie ? null : this.captureBillStart(id, ts);
            return;
        }
        if (!this.pendingBill) return;
        if (path !== 'api_port/port') {
            if (this.pendingBill.support.length && !path.startsWith('api_req_practice/')) {
                for (const [deckId, lost] of supportPlanesLost(api)) {
                    const fleet = this.pendingBill.support.find(entry => entry.deckId === deckId);
                    if (fleet) fleet.planesLost += lost;
                }
            }
            return;
        }
        const pending = this.pendingBill;
        this.pendingBill = null;
        const after = pending.ships.flatMap(ship => {
            const raw = this.state.ships.get(ship.id);
            const now = raw ? billShipFromApi(raw) : null;
            return now ? [now] : [];
        });
        const bill = sortieBill(pending.ships, after, { before: pending.materials, after: this.state.materials });
        const row: SortieBillRow = {
            sortieKey: pending.sortieKey, ts: pending.ts, map: pending.map,
            ...(pending.difficulty === undefined ? {} : { difficulty: pending.difficulty }),
            ...bill,
            ...(pending.support.length
                ? { support: pending.support.map(fleet => supportBill(fleet.deckId, fleet.ships, fleet.planesLost)) }
                : {}),
        };
        if (this.shouldPersist) await this.tables.sortieBills.put(row);
    }

    private captureBillStart(sortieKey: number, ts: number): PendingBill | null {
        const sortie = this.state.sortieInfo;
        if (!sortie) return null;
        // 參與的艦＝出擊艦隊；聯合艦隊且由第一艦隊出擊時加上第二艦隊（同 GameState.onReqMapStart）。
        const deckIdx = this.state.currentSortieFleetId;
        const deckIdxs = this.state.combinedFlag > 0 && deckIdx === 0 ? [0, 1] : [deckIdx];
        const ids = deckIdxs.flatMap(index => (this.state.decks[index]?.api_ship ?? [])
            .map(Number).filter((shipId: number) => Number.isSafeInteger(shipId) && shipId > 0));
        const ships: BillShip[] = [];
        for (const shipId of ids) {
            const ship = billShipFromApi(this.state.ships.get(shipId));
            // 任何一艘讀不到就不記這一趟：少一艘的帳單看起來完整，其實少算。
            if (!ship) return null;
            ships.push(ship);
        }
        if (!ships.length) return null;
        const mapId = sortie.mapArea * 10 + sortie.mapNo;
        const rank = this.state.mapGauges.get(mapId)?.selectedRank ?? 0;
        return {
            sortieKey, ts, map: `${sortie.mapArea}-${sortie.mapNo}`,
            ...(Number.isSafeInteger(rank) && rank > 0 ? { difficulty: rank } : {}),
            ships,
            materials: this.materialsTracked && this.state.materials.length >= 4 ? [...this.state.materials] : null,
            support: this.captureSupportFleets(deckIdxs, sortie.mapArea),
        };
    }

    // 出擊開始時正在跑「同海域支援遠征」的艦隊。任何一艘讀不到 master 就不記那一隊，不補猜。
    private captureSupportFleets(sortieDeckIdxs: readonly number[], mapArea: number): PendingBill['support'] {
        const out: PendingBill['support'] = [];
        this.state.decks.forEach((deck, index) => {
            if (sortieDeckIdxs.includes(index)) return;
            const mission = deck?.api_mission;
            // api_mission[0]＝1：遠征中；[1]＝遠征 id
            if (!Array.isArray(mission) || Number(mission[0]) !== 1) return;
            const meta = this.state.masterMissions.get(Number(mission[1]));
            if (!meta || !SUPPORT_DISP_NOS.has(String(meta.dispNo)) || meta.maparea !== mapArea) return;
            const ships: SupportShip[] = [];
            for (const shipId of (deck.api_ship ?? []).map(Number)) {
                if (!Number.isSafeInteger(shipId) || shipId <= 0) continue;
                const ship = this.state.ships.get(shipId);
                const masterId = Number(ship?.api_ship_id);
                const master = this.state.master.get(masterId);
                if (!master || !(master.fuelMax > 0) || !(master.bullMax > 0)) return;
                ships.push({
                    masterId, lv: Number(ship.api_lv) || 0, stype: master.stype,
                    fuelMax: master.fuelMax, bullMax: master.bullMax,
                });
            }
            if (ships.length) out.push({ deckId: index + 1, ships, planesLost: 0 });
        });
        return out;
    }

    private isGaugeBroken(gauge: MapGaugeView): boolean {
        if (gauge.cleared) return true;
        if (gauge.gaugeType === 2 && gauge.maxHp > 0 && gauge.nowHp === 0) return true;
        if (gauge.gaugeType === 1 && gauge.requiredDefeatCount > 0
            && gauge.defeatCount >= gauge.requiredDefeatCount) return true;
        return false;
    }

    private async markLatestBossCleared(map: string): Promise<void> {
        const bosses = (await this.tables.sorties
            .filter(row => row.map === map && row.boss && row.kind === 'battle')
            .toArray())
            .sort((left, right) => right.ts - left.ts);
        const target = bosses.find(row => !row.cleared) ?? bosses[0];
        if (target && !target.cleared) {
            await this.tables.sorties.update(target.eventId, { cleared: true });
        }
    }

    private async detectClear(path: string): Promise<void> {
        if (path !== 'api_get_member/mapinfo') return;
        for (const [id, gauge] of this.state.mapGauges) {
            if (this.isGaugeBroken(gauge)) {
                const map = `${Math.floor(id / 10)}-${id % 10}`;
                // 不記錄的海域沒有這場的 Boss 列，標到舊紀錄上會誤指斬殺場次。
                if (!this.gaugeBroken.has(id) && this.gaugeSeenUncleared.has(id) && this.shouldPersist
                    && !this.skipSortieMap(map)) {
                    await this.markLatestBossCleared(map);
                }
                this.gaugeBroken.add(id);
            } else {
                this.gaugeSeenUncleared.add(id);
                // 量表重生（活動下一段）時允許再次偵測斬殺。
                this.gaugeBroken.delete(id);
            }
        }
    }
}

// cursor 前的 retained event 仍須以 state-only 重建上下文；cursor 後的 event 則先完成全部
// derived writes，再由呼叫端耐久化 cursor。任一步 reject 時指派不會發生，游標自然停在舊值。
export async function projectEventAndAdvance(
    projector: Pick<EventProjector, 'projectWithMode'>,
    event: ProjectableEvent,
    throughEventId: number,
    advanceCursor: (eventId: number) => Promise<number>,
    afterStateApplied?: () => void,
): Promise<number> {
    const mode: EventProjectorMode = event.id <= throughEventId ? 'state-only' : 'persist';
    await projector.projectWithMode(event, mode, afterStateApplied);
    if (mode === 'state-only') return throughEventId;
    return advanceCursor(event.id);
}
