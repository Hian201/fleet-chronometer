import { db, type ApiEventRow, type ExpeditionRow, type FactoryLogRow, type ReplayRow, type SortieLogRow } from './db';
import { appendBattle, setDifficulty, startReplay } from './replay';
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
}

export type ProjectableEvent = Pick<ApiEventRow, 'ts' | 'path' | 'api'> & {
    id: number;
    req?: Record<string, string>;
};

export interface EventProjectorOptions {
    state: GameState;
    mode?: EventProjectorMode;
    tables?: EventProjectorTables;
}

export class EventProjector {
    readonly state: GameState;
    readonly mode: EventProjectorMode;
    readonly tables: EventProjectorTables;
    currentSortieKey = 0;
    currentReplay: ReplayRow | null = null;
    readonly gaugeSeenUncleared = new Set<number>();
    readonly gaugeBroken = new Set<number>();
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
            // 帶入原始 event.ts：泊地修理計時器錨點靠它，replay 時不能用「現在」。
            this.state.applyEvent(path, api, req, ts);
            afterStateApplied?.();
            await this.archiveSortie(id, ts, path, api);
            await this.archiveFactory(id, ts, path);
            await this.captureReplay(id, ts, path, api);
            await this.archiveExpedition(id, ts, path, api, req);
            await this.detectClear(path);
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
        if (!sortie) return;
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
        for (const key of ['api_get_item1', 'api_get_item2']) {
            const item = api?.[key];
            if (item && item.api_useitem_id > 0) {
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
                if (!this.gaugeBroken.has(id) && this.gaugeSeenUncleared.has(id) && this.shouldPersist) {
                    await this.markLatestBossCleared(`${Math.floor(id / 10)}-${id % 10}`);
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
