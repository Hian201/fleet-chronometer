// 戰鬥當下斬殺判定、戰後量表推算與 EventProjector 整合測試（計畫步驟 2 與步驟 3）。
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KcDb } from '../utils/db';
import { EventProjector, type ProjectableEvent } from '../utils/event-projector';
import { eoClearsFromMapinfoSnapshot, eoSenkaForMonth } from '../utils/senka';
import { calibrateMonthlySenka } from '../utils/senka-calibration';
import { GameState } from '../utils/state';

const databases: KcDb[] = [];
let serial = 0;

function sample<T = any>(name: string): T {
    return JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')) as T;
}

function createDb(): KcDb {
    const database = new KcDb(`kc-gauge-clear-proj-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function ev(id: number, path: string, api: any, req?: Record<string, string>): ProjectableEvent {
    return { id, ts: 1_760_000_000_000 + id * 1000, path, api, req };
}

function simpleBattle(enemyBeginHp: number, dealtToFlagship: number) {
    return {
        api_deck_id: 1,
        api_formation: [1, 1, 1],
        api_f_nowhps: [50],
        api_f_maxhps: [50],
        api_e_nowhps: [enemyBeginHp],
        api_e_maxhps: [enemyBeginHp],
        api_ship_ke: [1501],
        api_hougeki1: {
            api_at_eflag: [0],
            api_at_list: [0],
            api_df_list: [[0]],
            api_damage: [[dealtToFlagship]],
            api_cl_list: [[1]],
        },
    };
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('EventProjector 與 GameState 戰鬥當下斬殺判定', () => {
    it('真封包：6-5 擊破前與擊破兩場依序投影，僅擊破場標 clearedBy: battle，後續 mapinfo 不覆標', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        const mapBefore = sample('6-5-mapinfo-before-clear.json').api_data;
        const mapAfter = sample('6-5-mapinfo-after-clear.json').api_data;
        const battle = sample('6-5-ec_battle.json');
        const resBefore = sample('6-5-battleresult-before-clear.json').api_data;
        const resClear = sample('6-5-battleresult-clear.json').api_data;

        // 先設 6-5 為 4/6（還差兩次）
        const mapAt4 = {
            ...mapBefore,
            api_map_info: mapBefore.api_map_info.map((m: any) =>
                m.api_id === 65 ? { ...m, api_defeat_count: 4 } : m),
        };

        await projector.project(ev(1, 'api_get_member/mapinfo', mapAt4));
        // 第一場（4/6 → 5/6，未擊破）
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 13, api_color_no: 5, api_event_id: 5,
        }, { api_deck_id: '1' }));
        await projector.project(ev(3, 'api_req_combined_battle/ec_battle', battle));
        await projector.project(ev(4, 'api_req_combined_battle/battleresult', resBefore));

        const row1 = await database.sorties.get(4);
        expect(row1?.cleared).toBeUndefined();
        expect(row1?.clearedBy).toBeUndefined();
        expect(row1?.exmapRate).toBeUndefined();
        expect(row1?.firstClear).toBe(0);
        expect(row1?.flagshipSunk).toBe(true);
        // 戰後量表推算為 5/6 (estimate)
        expect(state.mapGauges.get(65)).toMatchObject({ defeatCount: 5, requiredDefeatCount: 6, cleared: false, source: 'estimate' });

        // 第二場前 mapinfo 送來 5/6（回到 server 值）
        await projector.project(ev(5, 'api_get_member/mapinfo', mapBefore));
        expect(state.mapGauges.get(65)).toMatchObject({ defeatCount: 5, requiredDefeatCount: 6, cleared: false, source: 'server' });

        // 第二場（5/6 → 6/6，擊破，帶 api_get_exmap_rate: "250"）
        await projector.project(ev(6, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 13, api_color_no: 5, api_event_id: 5,
        }, { api_deck_id: '1' }));
        await projector.project(ev(7, 'api_req_combined_battle/ec_battle', battle));
        await projector.project(ev(8, 'api_req_combined_battle/battleresult', resClear));

        const row2 = await database.sorties.get(8);
        expect(row2).toMatchObject({
            cleared: true,
            clearedBy: 'battle',
            exmapRate: 250,
            firstClear: 1,
            flagshipSunk: true,
        });
        expect(state.mapGauges.get(65)).toMatchObject({ cleared: true, source: 'server' });

        // 之後 mapinfo(after-clear) 到達，不覆蓋 row2 也不誤標 row1
        await projector.project(ev(9, 'api_get_member/mapinfo', mapAfter));
        expect((await database.sorties.get(4))?.cleared).toBeUndefined();
        expect(await database.sorties.get(8)).toMatchObject({ cleared: true, clearedBy: 'battle', exmapRate: 250 });
    });

    it('擊破數式最後一擊（無 exmapRate 的 7-5 P1 1/2→2/2）在量表更新前完成判定，且不將 MapGaugeView.cleared 設為 true', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        await projector.project(ev(1, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 75, api_cleared: 0, api_gauge_type: 1, api_gauge_num: 1,
                api_defeat_count: 1, api_required_defeat_count: 2,
            }],
        }));
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 7, api_mapinfo_no: 5, api_no: 11, api_color_no: 5, api_event_id: 5,
        }, { api_deck_id: '1' }));
        await projector.project(ev(3, 'api_req_sortie/battle', simpleBattle(200, 250)));
        await projector.project(ev(4, 'api_req_sortie/battleresult', {
            api_win_rank: 'S', api_get_exmap_rate: 0, api_first_clear: 0,
        }));

        expect(await database.sorties.get(4)).toMatchObject({
            map: '7-5',
            flagshipSunk: true,
            flagshipDamage: 200,
            cleared: true,
            clearedBy: 'battle',
        });
        expect((await database.sorties.get(4))?.exmapRate).toBeUndefined();
        // 中間段歸零：defeatCount 達標，但整圖未通關（cleared 維持 false）
        expect(state.mapGauges.get(75)).toMatchObject({
            defeatCount: 2,
            requiredDefeatCount: 2,
            cleared: false,
        });
    });

    it('已通關的 7-2（3/4，api_cleared: 1）周回擊沉 Boss 不誤標斬殺', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        await projector.project(ev(1, 'api_get_member/mapinfo', sample('6-5-mapinfo-before-clear.json').api_data));
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 7, api_mapinfo_no: 2, api_no: 15, api_color_no: 5, api_event_id: 5,
        }, { api_deck_id: '1' }));
        await projector.project(ev(3, 'api_req_sortie/battle', simpleBattle(200, 250)));
        await projector.project(ev(4, 'api_req_sortie/battleresult', {
            api_win_rank: 'S', api_get_exmap_rate: 0, api_first_clear: 0,
        }));

        const row = await database.sorties.get(4);
        expect(row?.cleared).toBeUndefined();
        expect(row?.clearedBy).toBeUndefined();
    });

    it('HP 量表：非目標 Boss 點不寫 gauge 欄位也不扣量表；目標 Boss 戰扣量推算與最終斬殺正確運作', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        await projector.project(ev(1, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 615, api_cleared: 0, api_gauge_type: 2, api_gauge_num: 4,
                api_eventmap: { api_now_maphp: 1500, api_max_maphp: 8400, api_selected_rank: 4 },
            }],
        }));

        // 第一趟：破甲路線打舊 Boss 節點 32（目標 Boss 為 55）
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 61, api_mapinfo_no: 5, api_no: 32, api_color_no: 5, api_event_id: 5,
            api_bosscell_no: 55,
            api_eventmap: { api_now_maphp: 1500, api_max_maphp: 8400 },
        }, { api_deck_id: '1' }));
        await projector.project(ev(3, 'api_req_sortie/battle', simpleBattle(800, 800)));
        await projector.project(ev(4, 'api_req_sortie/battleresult', { api_win_rank: 'S' }));

        const gimmickRow = await database.sorties.get(4);
        expect(gimmickRow?.flagshipSunk).toBeUndefined();
        expect(gimmickRow?.flagshipDamage).toBeUndefined();
        expect(gimmickRow?.gaugeAtStart).toBeUndefined();
        expect(gimmickRow?.cleared).toBeUndefined();
        expect(state.mapGauges.get(615)).toMatchObject({ nowHp: 1500, source: 'server' });

        // 第二趟：目標 Boss 節點 55，打 700 傷未沉 → 1500→800 (estimate)，仍在 unclearedHpGaugeMaps
        await projector.project(ev(5, 'api_req_map/start', {
            api_maparea_id: 61, api_mapinfo_no: 5, api_no: 55, api_color_no: 5, api_event_id: 5,
            api_bosscell_no: 55,
            api_eventmap: { api_now_maphp: 1500, api_max_maphp: 8400 },
        }, { api_deck_id: '1' }));
        await projector.project(ev(6, 'api_req_sortie/battle', simpleBattle(1200, 700)));
        await projector.project(ev(7, 'api_req_sortie/battleresult', { api_win_rank: 'A' }));

        expect(await database.sorties.get(7)).toMatchObject({
            flagshipSunk: false,
            flagshipDamage: 700,
            gaugeAtStart: { type: 2, now: 1500, max: 8400, gaugeNum: 4 },
        });
        expect((await database.sorties.get(7))?.cleared).toBeUndefined();
        expect(state.mapGauges.get(615)).toMatchObject({ nowHp: 800, source: 'estimate', cleared: false });
        expect(state.unclearedHpGaugeMaps().map(m => m.mapId)).toEqual([615]);

        // 第三趟：61-5 進入最終段 800/8400，擊沉 1200 HP 旗艦 → 歸 0（不設 cleared），移出 unclearedHpGaugeMaps
        await projector.project(ev(8, 'api_req_map/start', {
            api_maparea_id: 61, api_mapinfo_no: 5, api_no: 55, api_color_no: 5, api_event_id: 5,
            api_bosscell_no: 55,
            api_eventmap: { api_now_maphp: 800, api_max_maphp: 8400 },
        }, { api_deck_id: '1' }));
        expect(state.mapGauges.get(615)?.source).toBe('server');
        await projector.project(ev(9, 'api_req_sortie/battle', simpleBattle(1200, 1200)));
        await projector.project(ev(10, 'api_req_sortie/battleresult', { api_win_rank: 'S' }));

        expect(await database.sorties.get(10)).toMatchObject({
            flagshipSunk: true,
            flagshipDamage: 1200,
            gaugeAtStart: { type: 2, now: 800, max: 8400, gaugeNum: 4 },
            cleared: true,
            clearedBy: 'battle',
        });
        expect(state.mapGauges.get(615)).toMatchObject({ nowHp: 0, cleared: false });
        expect(state.unclearedHpGaugeMaps()).toEqual([]);

        // 下一段開始（map/start 帶新滿血與 gaugeNum=5）：重設並回到 server
        await projector.project(ev(11, 'api_req_map/start', {
            api_maparea_id: 61, api_mapinfo_no: 5, api_no: 1, api_color_no: 4,
            api_bosscell_no: 60, api_gauge_num: 5,
            api_eventmap: { api_now_maphp: 5000, api_max_maphp: 5000 },
        }, { api_deck_id: '1' }));
        expect(state.mapGauges.get(615)).toMatchObject({ nowHp: 5000, maxHp: 5000, gaugeNum: 5, source: 'server' });
    });

    it('運輸終點（api_req_map/next 且 api_next=0 帶 api_eventmap）僅更新記憶體 mapGauges，不寫 sorties', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        await projector.project(ev(1, 'api_req_map/start', {
            api_maparea_id: 62, api_mapinfo_no: 1, api_no: 1, api_color_no: 4,
            api_gauge_type: 3, api_gauge_num: 1,
            api_eventmap: { api_now_maphp: 300, api_max_maphp: 500, api_selected_rank: 4 },
        }, { api_deck_id: '1' }));
        // 合成資料（依 KC3Kai src/library/objects/Node.js）：運輸終點
        await projector.project(ev(2, 'api_req_map/next', {
            api_no: 9, api_color_no: 2, api_event_id: 8, api_next: 0,
            api_eventmap: { api_now_maphp: 210, api_max_maphp: 500 },
        }));

        expect(state.mapGauges.get(621)).toMatchObject({
            gaugeType: 3, nowHp: 210, maxHp: 500, source: 'server',
        });
        expect(await database.sorties.count()).toBe(0);
    });

    it('真封包（samples/base-air-raid-3.json）：往 Boss 終點的 map/next 帶戰前 api_eventmap 刷新量表，不影響後續斬殺判定', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });
        const bossNext = sample<{ api: any }>('base-air-raid-3.json').api;

        // 先設 62-2 戰前 mapinfo（4840 滿血、現值 840，目標 Boss 55）
        await projector.project(ev(1, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 622, api_cleared: 0, api_gauge_type: 2, api_gauge_num: 2,
                api_eventmap: { api_now_maphp: 840, api_max_maphp: 4840, api_selected_rank: 4 },
            }],
        }));
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 62, api_mapinfo_no: 2, api_no: 1, api_color_no: 4,
            api_bosscell_no: 55,
            api_eventmap: { api_now_maphp: 840, api_max_maphp: 4840 },
        }, { api_deck_id: '1' }));

        // 套用真實 Boss 終點 map/next（event_id=5、api_next=0、api_eventmap 840/4840）；
        // 本樣本 api_no=55 且同時帶空襲，目標 Boss 設回 55 以驗證進入目標 Boss 後的斬殺判定。
        await projector.project(ev(3, 'api_req_map/next', { ...bossNext, api_bosscell_no: 55 }));
        expect(state.mapGauges.get(622)).toMatchObject({
            gaugeType: 2, nowHp: 840, maxHp: 4840, cleared: false, source: 'server',
        });

        // 接著在 Boss 點擊沉 880 HP 旗艦 → 仍正確判定斬殺、不因先前刷新受干擾
        await projector.project(ev(4, 'api_req_sortie/battle', simpleBattle(880, 880)));
        await projector.project(ev(5, 'api_req_sortie/battleresult', { api_win_rank: 'S' }));

        expect(await database.sorties.get(5)).toMatchObject({
            map: '62-2',
            node: 55,
            boss: true,
            flagshipSunk: true,
            flagshipDamage: 880,
            gaugeAtStart: { type: 2, now: 840, max: 4840, gaugeNum: 2 },
            cleared: true,
            clearedBy: 'battle',
        });
        expect(state.mapGauges.get(622)).toMatchObject({ nowHp: 0, cleared: false });
    });

    it('mapinfo 後備受 gaugeSeenUncleared 時間戳限制：跨裝置通關不誤標更早的舊 Boss 戰', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        // t=1000：看到 1-5 未擊破（2/4）
        await projector.project(ev(1, 'api_get_member/mapinfo', {
            api_map_info: [{ api_id: 15, api_cleared: 0, api_gauge_type: 1, api_defeat_count: 2, api_required_defeat_count: 4 }],
        }));
        // t=2000..4000：本機打了一場未斬（2/4 → 3/4）
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 1, api_mapinfo_no: 5, api_no: 10, api_color_no: 5, api_event_id: 5,
        }, { api_deck_id: '1' }));
        await projector.project(ev(3, 'api_req_sortie/battle', simpleBattle(100, 100)));
        await projector.project(ev(4, 'api_req_sortie/battleresult', { api_win_rank: 'S' }));

        // t=5000：mapinfo 看到 3/4（更新 seenTs=5000）
        await projector.project(ev(5, 'api_get_member/mapinfo', {
            api_map_info: [{ api_id: 15, api_cleared: 0, api_gauge_type: 1, api_defeat_count: 3, api_required_defeat_count: 4 }],
        }));
        // 玩家在別台裝置打掉最後一擊，t=6000 本機看到 mapinfo 已擊破
        await projector.project(ev(6, 'api_get_member/mapinfo', {
            api_map_info: [{ api_id: 15, api_cleared: 1, api_gauge_type: 1 }],
        }));

        // t=4000 的舊 Boss 戰早於 seenTs=5000，不得被誤標斬殺
        expect((await database.sorties.get(4))?.cleared).toBeUndefined();
    });

    it('孤立夜戰接續包缺少晝戰起點：保留 flagshipSunk、不寫 flagshipDamage，不誤標 HP 斬殺（交由 mapinfo 後備）', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        await projector.project(ev(1, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 615, api_cleared: 0, api_gauge_type: 2, api_gauge_num: 4,
                api_eventmap: { api_now_maphp: 800, api_max_maphp: 8400, api_selected_rank: 4 },
            }],
        }));
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 61, api_mapinfo_no: 5, api_no: 55, api_color_no: 5, api_event_id: 5,
            api_bosscell_no: 55,
            api_eventmap: { api_now_maphp: 800, api_max_maphp: 8400 },
        }, { api_deck_id: '1' }));
        // 未經晝戰直接收到夜戰接續包（面板在夜戰畫面才開啟）
        await projector.project(ev(3, 'api_req_battle_midnight/battle', {
            api_deck_id: 1,
            api_formation: [1, 1, 1],
            api_f_nowhps: [50],
            api_f_maxhps: [50],
            api_e_nowhps: [400],
            api_e_maxhps: [1200],
            api_ship_ke: [1501],
            api_hougeki: {
                api_at_eflag: [0],
                api_at_list: [0],
                api_df_list: [[0]],
                api_damage: [[500]],
                api_cl_list: [[1]],
            },
        }));
        await projector.project(ev(4, 'api_req_sortie/battleresult', { api_win_rank: 'S' }));

        const row = await database.sorties.get(4);
        expect(row?.flagshipSunk).toBe(true);
        expect('flagshipDamage' in row!).toBe(false);
        expect(row?.cleared).toBeUndefined();

        // 之後 mapinfo 變 0，由 mapinfo 後備補標
        await projector.project(ev(5, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 615, api_cleared: 1, api_gauge_type: 2, api_gauge_num: 4,
                api_eventmap: { api_now_maphp: 0, api_max_maphp: 8400, api_selected_rank: 4 },
            }],
        }));
        expect(await database.sorties.get(4)).toMatchObject({ cleared: true, clearedBy: 'mapinfo' });
    });

    it('重投影保留既有 clearedBy，但新規則判定為 battle 時優先覆寫', async () => {
        const database = createDb();
        await database.sorties.put({
            eventId: 4, sortieKey: 2, ts: 1_760_000_004_000, map: '6-5', node: 13, boss: true,
            kind: 'battle', rank: 'S', seiku: null, enemyIds: [1501], enemyIdsEscort: [],
            drop: null, taiha: false, cleared: true, clearedBy: 'mapinfo',
        });

        const projector = new EventProjector({ state: new GameState(), tables: database });
        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 6, api_mapinfo_no: 5, api_no: 13, api_color_no: 5, api_event_id: 5,
        }, { api_deck_id: '1' }));
        await projector.project(ev(3, 'api_req_sortie/battle', simpleBattle(200, 250)));
        await projector.project(ev(4, 'api_req_sortie/battleresult', {
            api_win_rank: 'S', api_get_exmap_rate: '250',
        }));

        expect(await database.sorties.get(4)).toMatchObject({
            cleared: true,
            clearedBy: 'battle',
            exmapRate: 250,
        });
    });

    it('onReqMapStart 收到同段伺服器值與推算不同時，非開發版靜默且以伺服器值為準', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const state = new GameState();
            state.applyEvent('api_get_member/mapinfo', {
                api_map_info: [{
                    api_id: 615, api_cleared: 0, api_gauge_type: 2, api_gauge_num: 4,
                    api_eventmap: { api_now_maphp: 2000, api_max_maphp: 8400, api_selected_rank: 4 },
                }],
            });
            state.applyEvent('api_req_map/start', {
                api_maparea_id: 61, api_mapinfo_no: 5, api_no: 55, api_color_no: 5, api_event_id: 5,
                api_bosscell_no: 55,
                api_eventmap: { api_now_maphp: 2000, api_max_maphp: 8400 },
            }, { api_deck_id: '1' });
            state.applyEvent('api_req_sortie/battle', simpleBattle(1200, 500));
            state.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'A' });
            expect(state.mapGauges.get(615)).toMatchObject({ nowHp: 1500, source: 'estimate' });

            // 下一趟出擊伺服器回傳 1480（與推算 1500 不同）→ 一律以伺服器值為準
            state.applyEvent('api_req_map/start', {
                api_maparea_id: 61, api_mapinfo_no: 5, api_no: 1, api_color_no: 4,
                api_bosscell_no: 55,
                api_eventmap: { api_now_maphp: 1480, api_max_maphp: 8400 },
            }, { api_deck_id: '1' });
            expect(state.mapGauges.get(615)).toMatchObject({ nowHp: 1480, source: 'server' });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('真封包：5-6 第一段 TP 登陸後的量表與下一筆 mapinfo 一致，月初重置不殘留舊值', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });
        const before = sample('6-5-mapinfo-before-clear.json').api_data;
        const after = sample('5-6-mapinfo-after-landing.json').api_data;
        const landing = sample('5-6-1-battleresult-landing.json').api_data;

        await projector.project(ev(1, 'api_get_member/mapinfo', before));
        expect(state.mapGauges.get(56)).toMatchObject({ gaugeType: 3, defeatCount: 0, requiredDefeatCount: 280 });

        await projector.project(ev(2, 'api_req_map/start', {
            api_maparea_id: 5, api_mapinfo_no: 6, api_no: 1, api_color_no: 4,
        }, { api_deck_id: '1' }));
        await projector.project(ev(3, 'api_req_sortie/battleresult', landing));
        const postBattle = state.mapGauges.get(56);
        expect(postBattle).toMatchObject({
            gaugeType: 3, defeatCount: 79, requiredDefeatCount: 280, nowHp: 0, maxHp: 0, source: 'server', cleared: false,
        });

        await projector.project(ev(4, 'api_get_member/mapinfo', after));
        expect(state.mapGauges.get(56)).toEqual(postBattle);

        // 月初重置：mapinfo 回到 0/280，量表跟著伺服器值，不殘留登陸後的數字。
        const reset = {
            ...after,
            api_map_info: after.api_map_info.map((m: { api_id: number }) => (m.api_id === 56
                ? { ...m, api_defeat_count: 0 } : m)),
        };
        await projector.project(ev(5, 'api_get_member/mapinfo', reset));
        expect(state.mapGauges.get(56)).toMatchObject({ defeatCount: 0, requiredDefeatCount: 280, nowHp: 0, maxHp: 0 });
    });

    it('1-6 終點帶 api_get_eo_rate: 75 時標記量表、補標最後一戰，戰果 +75 且校準不標為時間不確定', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        const month = { year: 2026, month: 11 };
        const beforeMonthTs = Date.UTC(2026, 9, 31, 12, 0); // 10/31 21:00 JST（月界前）
        const beforeTallyTs = Date.UTC(2026, 10, 10, 4, 30); // 11/10 13:30 JST（14:00 結算前）
        const roundPubTs = Date.UTC(2026, 10, 10, 6, 0);     // 11/10 15:00 JST 公布榜單
        const baseTs = Date.UTC(2026, 10, 10, 7, 0);         // 11/10 16:00 JST 出擊 1-6
        const at = (id: number, offsetSec: number, path: string, api: any, req?: Record<string, string>): ProjectableEvent => ({
            id, ts: baseTs + offsetSec * 1000, path, api, req,
        });

        await projector.project(at(1, 0, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 16, api_cleared: 0, api_defeat_count: 6, api_required_defeat_count: 7,
                api_gauge_type: 1, api_gauge_num: 1,
            }],
        }));
        await projector.project(at(2, 10, 'api_req_map/start', {
            api_maparea_id: 1, api_mapinfo_no: 6, api_no: 1, api_color_no: 4, api_event_id: 4,
        }, { api_deck_id: '1' }));
        // 道中第一戰
        await projector.project(at(3, 20, 'api_req_sortie/battle', simpleBattle(100, 100)));
        await projector.project(at(4, 30, 'api_req_sortie/battleresult', {
            api_win_rank: 'S', api_get_exmap_rate: 0, api_first_clear: 0,
        }));
        // 道中最後一戰（模擬 1-6 B 點空襲戰結算，api_get_exmap_rate 為 0）
        await projector.project(at(5, 40, 'api_req_map/next', {
            api_no: 7, api_color_no: 4, api_event_id: 4, api_event_kind: 6, api_next: 1,
        }));
        await projector.project(at(6, 50, 'api_req_sortie/ld_airbattle', simpleBattle(100, 0)));
        await projector.project(at(7, 60, 'api_req_sortie/battleresult', {
            api_win_rank: 'S', api_get_exmap_rate: 0, api_first_clear: 0,
        }));
        expect(state.mapGauges.get(16)?.cleared).toBe(false);
        expect((await database.sorties.get(7))?.cleared).toBeUndefined();

        // 抵達 1-6 終點（合成資料，依 KancolleSniffer ExMapInfo.cs InspectMapNext()）：第 7 次帶 api_get_eo_rate: 75
        await projector.project(at(8, 70, 'api_req_map/next', {
            api_no: 14, api_color_no: 8, api_event_id: 8, api_next: 0,
            api_get_eo_rate: 75,
            api_itemget_eo_comment: { api_id: 1, api_getcount: 1000 },
        }));

        expect(state.mapGauges.get(16)).toMatchObject({ cleared: true, source: 'server' });
        expect((await database.sorties.get(4))?.cleared).toBeUndefined();
        expect(await database.sorties.get(7)).toMatchObject({
            map: '1-6',
            cleared: true,
            exmapRate: 75,
            clearedBy: 'battle',
        });

        const sorties = await database.sorties.toArray();
        const eo = eoSenkaForMonth(sorties, month);
        expect(eo.total).toBe(75);
        expect(eo.items.find(item => item.map === '1-6')).toMatchObject({
            map: '1-6', points: 75, cleared: true,
        });

        const portTs = baseTs + 120_000;
        const readings = [
            { ts: beforeMonthTs, exp: 10_000_000 },
            { ts: beforeTallyTs, exp: 10_000_000 },
            { ts: portTs, exp: 10_000_000 },
        ];
        const cal = calibrateMonthlySenka({
            month,
            now: portTs + 60_000,
            readings,
            sorties,
            questClaims: [],
            questLookup: () => null,
            selfRankings: [{ publishedAt: roundPubTs, score: 1000, rank: 100 }],
        });
        expect(cal.status).toBe('calibrated');
        if (cal.status === 'calibrated') {
            expect(cal.sinceTally).toEqual({ min: 75, max: 75 });
            expect(cal.estimate).toEqual({ min: 1075, max: 1075 });
            expect(cal.reasons).not.toContain('eo-timing-uncertain');
        }

        // 後續 mapinfo(api_cleared: 1) 到達：不誤標第一戰，合併快照進校準仍不標為時間不確定
        const mapAfter = {
            api_map_info: [{
                api_id: 16, api_cleared: 1, api_gauge_type: 1, api_gauge_num: 1,
            }],
        };
        await projector.project(at(9, 180, 'api_get_member/mapinfo', mapAfter));
        expect((await database.sorties.get(4))?.cleared).toBeUndefined();
        const calWithSnap = calibrateMonthlySenka({
            month,
            now: baseTs + 240_000,
            readings,
            sorties: [
                ...(await database.sorties.toArray()),
                ...eoClearsFromMapinfoSnapshot({ ts: baseTs + 180_000, api: mapAfter }),
            ],
            questClaims: [],
            questLookup: () => null,
            selfRankings: [{ publishedAt: roundPubTs, score: 1000, rank: 100 }],
        });
        expect(calWithSnap.status).toBe('calibrated');
        if (calWithSnap.status === 'calibrated') {
            expect(calWithSnap.estimate).toEqual({ min: 1075, max: 1075 });
            expect(calWithSnap.reasons).not.toContain('eo-timing-uncertain');
        }
    });

    it('1-6 終點 api_get_eo_rate: 0（前 6 次抵達）不計入戰果亦不標通關；不記錄海域無戰鬥列時僅更新量表', async () => {
        const database = createDb();
        const state = new GameState();
        const projector = new EventProjector({ state, tables: database });

        const month = { year: 2026, month: 11 };
        const baseTs = Date.UTC(2026, 10, 10, 7, 0);
        const at = (id: number, path: string, api: any, req?: Record<string, string>): ProjectableEvent => ({
            id, ts: baseTs + id * 1000, path, api, req,
        });

        await projector.project(at(1, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 16, api_cleared: 0, api_defeat_count: 2, api_required_defeat_count: 7,
                api_gauge_type: 1, api_gauge_num: 1,
            }],
        }));
        await projector.project(at(2, 'api_req_map/start', {
            api_maparea_id: 1, api_mapinfo_no: 6, api_no: 1, api_color_no: 4, api_event_id: 4,
        }, { api_deck_id: '1' }));
        await projector.project(at(3, 'api_req_sortie/battle', simpleBattle(100, 100)));
        await projector.project(at(4, 'api_req_sortie/battleresult', {
            api_win_rank: 'S', api_get_exmap_rate: 0, api_first_clear: 0,
        }));
        // 第 3 次抵達終點（未打爆量表）：api_get_eo_rate 為 0
        await projector.project(at(5, 'api_req_map/next', {
            api_no: 14, api_color_no: 8, api_event_id: 8, api_next: 0,
            api_get_eo_rate: 0,
            api_itemget_eo_comment: { api_id: 1, api_getcount: 500 },
        }));

        expect(state.mapGauges.get(16)).toMatchObject({ cleared: false, defeatCount: 2 });
        const row = await database.sorties.get(4);
        expect(row?.cleared).toBeUndefined();
        expect(row?.exmapRate).toBeUndefined();
        expect(row?.clearedBy).toBeUndefined();
        const eo = eoSenkaForMonth(await database.sorties.toArray(), month);
        expect(eo.total).toBe(0);
        expect(eo.items.find(item => item.map === '1-6')?.cleared).toBe(false);

        // 不記錄的海域（skipSortieMap 跳過 1-6，即使開啟 catchOnly）：無一般戰鬥列，只更新記憶體量表
        const skippedDb = createDb();
        const skippedState = new GameState();
        const skippedProjector = new EventProjector({
            state: skippedState,
            tables: skippedDb,
            skipSortieMap: map => map === '1-6',
            recordExcludedCatch: () => true,
        });
        await skippedProjector.project(at(10, 'api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 16, api_cleared: 0, api_defeat_count: 6, api_required_defeat_count: 7,
                api_gauge_type: 1, api_gauge_num: 1,
            }],
        }));
        await skippedProjector.project(at(11, 'api_req_map/start', {
            api_maparea_id: 1, api_mapinfo_no: 6, api_no: 1, api_color_no: 4, api_event_id: 4,
        }, { api_deck_id: '1' }));
        await skippedProjector.project(at(12, 'api_req_sortie/battle', simpleBattle(100, 100)));
        await skippedProjector.project(at(13, 'api_req_sortie/battleresult', {
            api_win_rank: 'S', api_get_exmap_rate: 0,
        }));
        await skippedProjector.project(at(14, 'api_req_map/next', {
            api_no: 14, api_color_no: 8, api_event_id: 8, api_next: 0,
            api_get_eo_rate: '75',
        }));
        expect(skippedState.mapGauges.get(16)).toMatchObject({ cleared: true, source: 'server' });
        const catchRow = await skippedDb.sorties.get(13);
        expect(catchRow?.catchOnly).toBe(true);
        expect(catchRow?.cleared).toBeUndefined();
        expect(catchRow?.exmapRate).toBeUndefined();
    });
});
