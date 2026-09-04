import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { KcDb } from '../utils/db';
import { EventProjector, type ProjectableEvent } from '../utils/event-projector';
import { toKc3Replay } from '../utils/replay';
import { GameState } from '../utils/state';

const databases: KcDb[] = [];
let serial = 0;

function createDb() {
    const database = new KcDb(`kc-replay-difficulty-test-${Date.now()}-${serial++}`);
    databases.push(database);
    return database;
}

function fixture<T = any>(name: string): T {
    return JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')) as T;
}

function row(id: number, path: string, api: any, req?: Record<string, string>): ProjectableEvent {
    return { id, ts: 1_726_000_000_000 + id, path, api, req };
}

function mapStart(id: number, mapNo = 1): ProjectableEvent {
    return row(id, 'api_req_map/start', {
        api_maparea_id: 62, api_mapinfo_no: mapNo, api_no: 1, api_color_no: 1,
    }, { api_deck_id: '1' });
}

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('海域難度 reducer', () => {
    it('保存已驗證 fixture 的非零 api_selected_rank', () => {
        const state = new GameState();

        state.applyEvent('api_get_member/mapinfo', fixture('6-5-mapinfo-2.json'));

        expect(state.mapGauges.get(621)?.selectedRank).toBe(4);
    });

    it('rank 為 0、缺少 eventmap 或欄位，以及無效值時安全維持 0', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', {
            api_map_info: [
                { api_id: 1, api_gauge_type: 0 },
                { api_id: 2, api_eventmap: {} },
                { api_id: 3, api_eventmap: { api_selected_rank: 0 } },
                { api_id: 4, api_eventmap: { api_selected_rank: -1 } },
                { api_id: 5, api_eventmap: { api_selected_rank: '4' } },
            ],
        });

        expect([1, 2, 3, 4, 5].map(id => state.mapGauges.get(id)?.selectedRank)).toEqual([0, 0, 0, 0, 0]);
    });

    it('部分 mapinfo 更新省略難度時，保留先前已驗證的難度', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture('6-5-mapinfo-2.json'));
        expect(state.mapGauges.get(621)?.selectedRank).toBe(4);

        state.applyEvent('api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 621,
                api_cleared: 0,
                api_gauge_type: 2,
                api_gauge_num: 3,
                api_eventmap: { api_now_maphp: 840, api_max_maphp: 4_840 },
            }],
        });

        expect(state.mapGauges.get(621)?.selectedRank).toBe(4);
    });

    it('mapinfo 的血條編號位於 eventmap 時也保存血條身分', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', {
            api_map_info: [{
                api_id: 622,
                api_cleared: 0,
                api_gauge_type: 2,
                api_eventmap: {
                    api_now_maphp: 840,
                    api_max_maphp: 4_840,
                    api_selected_rank: 4,
                    api_gauge_num: 3,
                },
            }],
        });

        expect(state.mapGauges.get(622)).toMatchObject({ selectedRank: 4, gaugeNum: 3 });
    });

    it('選定活動難度時，以選擇回應立即更新難度與實際量表', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture('6-5-mapinfo.json'));

        state.applyEvent('api_req_map/select_eventmap_rank', {
            api_maphp: {
                api_now_maphp: 600, api_max_maphp: 600,
                api_gauge_type: 3, api_gauge_num: 1,
            },
        }, { api_maparea_id: '62', api_map_no: '1', api_rank: '4' });

        expect(state.mapGauges.get(621)).toMatchObject({
            selectedRank: 4, gaugeType: 3, nowHp: 600, maxHp: 600,
        });
    });

    it('出擊起點的 eventmap 覆蓋舊 mapinfo 量表，但不臆測難度', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture('6-5-mapinfo.json'));

        state.applyEvent('api_req_map/start', {
            api_maparea_id: 62, api_mapinfo_no: 1, api_no: 1, api_color_no: 1,
            api_eventmap: { api_now_maphp: 540, api_max_maphp: 600 },
        }, { api_deck_id: '1' });

        expect(state.mapGauges.get(621)).toMatchObject({
            selectedRank: 0, nowHp: 540, maxHp: 600,
        });
    });

    it('出擊起點省略難度時，保留先前已選定的活動難度', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture('6-5-mapinfo-2.json'));

        state.applyEvent('api_req_map/start', {
            api_maparea_id: 62, api_mapinfo_no: 1, api_no: 1, api_color_no: 1,
            api_eventmap: { api_now_maphp: 300, api_max_maphp: 354 },
        }, { api_deck_id: '1' });

        expect(state.mapGauges.get(621)).toMatchObject({
            selectedRank: 4, gaugeNum: 1, nowHp: 300, maxHp: 354,
        });
    });
});

describe('replay 難度投影', () => {
    it('選難度回應後出擊，replay 立即保存該難度', async () => {
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables: createDb() });

        await projector.project(row(1, 'api_req_map/select_eventmap_rank', {
            api_maphp: {
                api_now_maphp: 600, api_max_maphp: 600,
                api_gauge_type: 3, api_gauge_num: 1,
            },
        }, { api_maparea_id: '62', api_map_no: '1', api_rank: '4' }));
        await projector.project(mapStart(2));

        expect(projector.currentReplay?.diff).toBe(4);
    });

    it('mapinfo 後的 map/start 依對應 map gauge 設定 diff，且 KC3 匯出保留該值', async () => {
        const projector = new EventProjector({ state: new GameState(), mode: 'persist', tables: createDb() });

        await projector.project(row(1, 'api_get_member/mapinfo', fixture('6-5-mapinfo-2.json')));
        await projector.project(mapStart(2));

        expect(projector.currentReplay?.diff).toBe(4);
        expect((toKc3Replay(projector.currentReplay!) as { diff: number }).diff).toBe(4);
    });

    it('找不到對應 map gauge 時維持 diff: 0', async () => {
        const projector = new EventProjector({ state: new GameState(), tables: createDb() });

        await projector.project(row(1, 'api_get_member/mapinfo', fixture('6-5-mapinfo-2.json')));
        await projector.project(mapStart(2, 2));

        expect(projector.currentReplay?.diff).toBe(0);
    });

    it('state-only 與 persist 產生相同 replay difficulty，重播相同事件不增加 replay', async () => {
        const events = [
            row(1, 'api_get_member/mapinfo', fixture('6-5-mapinfo-2.json')),
            mapStart(2),
            row(3, 'api_req_combined_battle/ec_battle', fixture('6-5-ec_battle.json')),
            row(4, 'api_req_combined_battle/battleresult', fixture('6-5-ec_result.json')),
        ];
        const stateOnly = new EventProjector({ state: new GameState(), mode: 'state-only', tables: createDb() });
        const database = createDb();
        const persist = new EventProjector({ state: new GameState(), mode: 'persist', tables: database });
        const replayed = new EventProjector({ state: new GameState(), mode: 'persist', tables: database });

        for (const event of events) await stateOnly.project(event);
        for (const event of events) await persist.project(event);
        for (const event of events) await replayed.project(event);

        expect(stateOnly.currentReplay?.diff).toBe(4);
        expect(persist.currentReplay?.diff).toBe(4);
        expect((await database.replays.get(2))?.diff).toBe(4);
        expect(await database.replays.count()).toBe(1);
    });
});
