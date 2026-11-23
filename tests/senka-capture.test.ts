import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KcDb } from '../utils/db';
import { calibrateMonthlySenka, evaluateSenkaTarget } from '../utils/senka-calibration';
import { RANKING_RANK_FACTORS, RANKING_SCORE_OFFSET } from '../utils/senka-ranking';
import { loadSenkaRankingsForMonth } from '../utils/senka-readings';
import {
    captureSenkaRanking, deleteManualCutoff, extractSenkaRankingRows,
    RANKING_API_PATH, saveManualCutoff, saveSenkaMonthFinal,
    senkaCutoffKey, senkaMonthKey, senkaSelfKey,
} from '../utils/senka-store';

const SAMPLES_DIR = resolve(process.cwd(), 'samples');

function loadSampleApi(file: string): { api_disp_page: number; api_list: Record<string, unknown>[] } {
    const raw = JSON.parse(readFileSync(resolve(SAMPLES_DIR, file), 'utf8')) as {
        api_data: { api_disp_page: number; api_list: Record<string, unknown>[] };
    };
    return raw.api_data;
}

/** 依真實混淆規則構造合成排行榜頁（與 decodeRankingPage 反向對應）。 */
function makeRankingPage(
    entries: readonly { rank: number; nickname: string; score: number }[],
    playerFactor = 44,
    page = 50,
) {
    return {
        api_disp_page: page,
        api_list: entries.map(e => ({
            api_mxltvkpyuklh: e.rank,
            api_mtjmdcwtvhdr: e.nickname,
            api_wuhnhojjxmke: (e.score + RANKING_SCORE_OFFSET) * playerFactor * RANKING_RANK_FACTORS[e.rank % 13],
        })),
    };
}

// 2026-11-30 15:00 JST = 2026-11-30 06:00 UTC（11 月最後一次公開榜）
const PUB_NOV_30_15 = Date.UTC(2026, 10, 30, 6, 0);
// 2026-11-01 03:00 JST = 2026-10-31 18:00 UTC（11 月第一次公開榜）
const PUB_NOV_01_03 = Date.UTC(2026, 9, 31, 18, 0);
// 2026-10-31 15:00 JST = 2026-10-31 06:00 UTC（10 月最後一次公開榜）
const PUB_OCT_31_15 = Date.UTC(2026, 9, 31, 6, 0);
// 2026-12-01 03:00 JST = 2026-11-30 18:00 UTC（12 月第一次公開榜）
const PUB_DEC_01_03 = Date.UTC(2026, 10, 30, 18, 0);

const databases: KcDb[] = [];
let seq = 0;

function createDb(): KcDb {
    const database = new KcDb(`senka-capture-${Date.now()}-${seq++}`);
    databases.push(database);
    return database;
}

beforeEach(async () => {
    // 每個測試自行建立獨立資料庫
});

afterEach(async () => {
    for (const database of databases.splice(0)) {
        database.close();
        await Dexie.delete(database.name);
    }
});

describe('排行榜封包擷取（真實樣本與邊界規則）', () => {
    it('第 1 頁樣本只自動記第 5 名榜線（7999），不寫入 1–4／6–10 名也不存提督名', async () => {
        const db = createDb();
        await db.open();
        await db.snapshot.put({
            path: 'api_port/port',
            ts: PUB_NOV_30_15 + 60_000,
            api: { api_basic: { api_nickname: '測試提督' } },
        });

        const page1 = loadSampleApi('ranking-page-1.json');
        const ts = PUB_NOV_30_15 + 10 * 60_000;
        const written = await captureSenkaRanking(db, {
            id: 101, ts, path: RANKING_API_PATH, api: page1,
        });

        expect(written).toBe(1);
        const rows = await db.senkaRankings.toArray();
        expect(rows).toEqual([{
            key: senkaCutoffKey(PUB_NOV_30_15, 5),
            kind: 'cutoff',
            publishedAt: PUB_NOV_30_15,
            rank: 5,
            score: 7999,
            mode: 'auto',
            ts,
            eventId: 101,
        }]);
        // 確認未儲存他人提督名
        expect('nickname' in rows[0]).toBe(false);
    });

    it('第 51 頁樣本（501–510 名）不含標準群別榜線也不含本人時不寫任何列', async () => {
        const db = createDb();
        await db.open();
        await db.snapshot.put({
            path: 'api_port/port',
            ts: PUB_NOV_30_15 + 60_000,
            api: { api_basic: { api_nickname: '測試提督' } },
        });

        const page51 = loadSampleApi('ranking-page-51.json');
        const written = await captureSenkaRanking(db, {
            id: 102, ts: PUB_NOV_30_15 + 10 * 60_000, path: RANKING_API_PATH, api: page51,
        });

        expect(written).toBe(0);
        expect(await db.senkaRankings.count()).toBe(0);
    });

    it('第 147 頁樣本比對母港提督名命中第 1464 名（838）時只寫本人紀錄', async () => {
        const db = createDb();
        await db.open();
        await db.snapshot.put({
            path: 'api_port/port',
            ts: PUB_NOV_30_15 + 60_000,
            api: { api_basic: { api_nickname: 'イケン' } },
        });

        const page147 = loadSampleApi('ranking-page-147.json');
        // 樣本去識別後提督名為空字串，於第 1464 名（index 3）填入本人提督名
        page147.api_list[3] = { ...page147.api_list[3], api_mtjmdcwtvhdr: 'イケン' };
        const ts = PUB_NOV_30_15 + 12 * 60_000;
        const written = await captureSenkaRanking(db, {
            id: 103, ts, path: RANKING_API_PATH, api: page147,
        });

        expect(written).toBe(1);
        expect(await db.senkaRankings.toArray()).toEqual([{
            key: senkaSelfKey(PUB_NOV_30_15),
            kind: 'self',
            publishedAt: PUB_NOV_30_15,
            rank: 1464,
            score: 838,
            ts,
            eventId: 103,
        }]);
    });

    it('標準榜線 20／100／500 與本人位於同頁時一併記錄；無母港快照或同頁重名時不誤認本人', async () => {
        const db = createDb();
        await db.open();
        const page50 = makeRankingPage([
            { rank: 499, nickname: 'イケン', score: 4210 },
            { rank: 500, nickname: '他提督', score: 4200 },
            { rank: 100, nickname: '二群守門', score: 5100 },
            { rank: 20, nickname: '一群守門', score: 6300 },
        ]);
        const ts = PUB_NOV_30_15 + 15 * 60_000;

        // 無母港快照：只記榜線，不記本人
        await captureSenkaRanking(db, { id: 10, ts, path: RANKING_API_PATH, api: page50 });
        expect((await db.senkaRankings.toArray()).map(r => r.key).sort()).toEqual([
            senkaCutoffKey(PUB_NOV_30_15, 100),
            senkaCutoffKey(PUB_NOV_30_15, 20),
            senkaCutoffKey(PUB_NOV_30_15, 500),
        ]);

        // 補上母港快照後重跑新事件：本人與榜線皆到位
        await db.snapshot.put({
            path: 'api_port/port',
            ts,
            api: { api_basic: { api_nickname: 'イケン' } },
        });
        await captureSenkaRanking(db, { id: 11, ts: ts + 1000, path: RANKING_API_PATH, api: page50 });
        expect(await db.senkaRankings.get(senkaSelfKey(PUB_NOV_30_15))).toMatchObject({
            kind: 'self', rank: 499, score: 4210, eventId: 11,
        });

        // 同頁兩個同名提督：extractSenkaRankingRows 不誤認本人
        const dupPage = makeRankingPage([
            { rank: 498, nickname: 'イケン', score: 4220 },
            { rank: 499, nickname: 'イケン', score: 4210 },
        ]);
        expect(extractSenkaRankingRows({ id: 12, ts, path: RANKING_API_PATH, api: dupPage }, 'イケン')).toEqual([]);

        // 同頁出現同名次並列時，同一主鍵留最後一筆
        const tiedPage = makeRankingPage([
            { rank: 500, nickname: '甲', score: 4201 },
            { rank: 500, nickname: '乙', score: 4200 },
        ]);
        expect(extractSenkaRankingRows({ id: 13, ts, path: RANKING_API_PATH, api: tiedPage }, null)).toEqual([{
            key: senkaCutoffKey(PUB_NOV_30_15, 500),
            kind: 'cutoff',
            publishedAt: PUB_NOV_30_15,
            rank: 500,
            score: 4200,
            mode: 'auto',
            ts,
            eventId: 13,
        }]);
    });

    it('解碼失敗、非排行榜 path 或異常封包一律靜默略過且不拋例外', async () => {
        const db = createDb();
        await db.open();
        const broken = loadSampleApi('ranking-page-1.json');
        broken.api_list[0] = { ...broken.api_list[0], api_wuhnhojjxmke: 1234567 }; // 無法整除

        expect(await captureSenkaRanking(db, {
            id: 20, ts: PUB_NOV_30_15 + 1000, path: RANKING_API_PATH, api: broken,
        })).toBe(0);
        expect(await captureSenkaRanking(db, {
            id: 21, ts: PUB_NOV_30_15 + 1000, path: 'api_port/port', api: broken,
        })).toBe(0);
        expect(await db.senkaRankings.count()).toBe(0);
    });

    it('SW recovery 重跑同一事件冪等，且結算延遲後較晚翻頁會覆寫較早舊榜', async () => {
        const db = createDb();
        await db.open();
        await db.snapshot.put({
            path: 'api_port/port',
            ts: PUB_NOV_30_15,
            api: { api_basic: { api_nickname: 'イケン' } },
        });

        const stalePage = makeRankingPage([
            { rank: 500, nickname: '守門', score: 4050 },
            { rank: 512, nickname: 'イケン', score: 4020 },
        ]);
        const freshPage = makeRankingPage([
            { rank: 500, nickname: '守門', score: 4200 },
            { rank: 505, nickname: 'イケン', score: 4180 },
        ]);

        // 15:01 結算尚未刷新，先記到舊值
        expect(await captureSenkaRanking(db, {
            id: 30, ts: PUB_NOV_30_15 + 60_000, path: RANKING_API_PATH, api: stalePage,
        })).toBe(2);
        // 同一筆事件 recovery 重跑：不重寫（written = 0）
        expect(await captureSenkaRanking(db, {
            id: 30, ts: PUB_NOV_30_15 + 60_000, path: RANKING_API_PATH, api: stalePage,
        })).toBe(0);

        // 15:10 重開看到真新榜：較晚觀測覆寫
        expect(await captureSenkaRanking(db, {
            id: 31, ts: PUB_NOV_30_15 + 10 * 60_000, path: RANKING_API_PATH, api: freshPage,
        })).toBe(2);
        expect(await db.senkaRankings.get(senkaSelfKey(PUB_NOV_30_15))).toMatchObject({
            score: 4180, rank: 505, eventId: 31,
        });
        expect(await db.senkaRankings.get(senkaCutoffKey(PUB_NOV_30_15, 500))).toMatchObject({
            score: 4200, mode: 'auto', eventId: 31,
        });

        // 舊事件 30 若再重跑，不得倒蓋較新事件 31
        expect(await captureSenkaRanking(db, {
            id: 30, ts: PUB_NOV_30_15 + 60_000, path: RANKING_API_PATH, api: stalePage,
        })).toBe(0);
        expect(await db.senkaRankings.get(senkaCutoffKey(PUB_NOV_30_15, 500))).toMatchObject({
            score: 4200, eventId: 31,
        });
    });
});

describe('雙寫入者 rw 交易競態交錯與手動操作', () => {
    it('background 讀完母港暱稱與總括手動登錄交錯時，較舊 auto 絕不覆蓋較新 manual', async () => {
        const db = createDb();
        await db.open();
        await db.snapshot.put({
            path: 'api_port/port',
            ts: PUB_NOV_30_15,
            api: { api_basic: { api_nickname: 'イケン' } },
        });

        const staleAutoTs = PUB_NOV_30_15 + 60_000;      // 15:01 舊榜
        const newerManualTs = PUB_NOV_30_15 + 5 * 60_000; // 15:05 玩家手動更正
        const stalePage = makeRankingPage([
            { rank: 500, nickname: '守門', score: 4050 },
            { rank: 501, nickname: '他提督', score: 4049 },
        ]);

        // 模擬情境 1：background 正在等 snapshot.get 時，overview 先提交 manual（ts 較新），
        // 接著 background 才進 rw 交易執行讀、比、寫 → 較舊 auto 不得蓋過 manual。
        let markSnapStarted!: () => void;
        let releaseSnap!: () => void;
        const snapStarted = new Promise<void>(resolve => { markSnapStarted = resolve; });
        const origGet = db.snapshot.get.bind(db.snapshot);
        const wrappedDb = {
            snapshot: {
                async get(path: string) {
                    const row = await origGet(path);
                    markSnapStarted();
                    await new Promise<void>(r => { releaseSnap = r; });
                    return row;
                },
            },
            senkaRankings: db.senkaRankings,
            transaction: db.transaction.bind(db),
        };

        const autoPromise = captureSenkaRanking(wrappedDb, {
            id: 40, ts: staleAutoTs, path: RANKING_API_PATH, api: stalePage,
        });
        await snapStarted;

        await saveManualCutoff(db, {
            publishedAt: PUB_NOV_30_15, rank: 500, score: 4200, ts: newerManualTs,
        });
        releaseSnap();
        const written = await autoPromise;

        expect(written).toBe(0);
        expect(await db.senkaRankings.get(senkaCutoffKey(PUB_NOV_30_15, 500))).toEqual({
            key: senkaCutoffKey(PUB_NOV_30_15, 500),
            kind: 'cutoff',
            publishedAt: PUB_NOV_30_15,
            rank: 500,
            score: 4200,
            mode: 'manual',
            ts: newerManualTs,
        });
    });

    it('background 與手動登錄並發進入 rw 交易時依序序列化，最終仍保留較新的手動更正', async () => {
        const db = createDb();
        await db.open();
        await db.snapshot.put({
            path: 'api_port/port',
            ts: PUB_NOV_30_15,
            api: { api_basic: { api_nickname: 'イケン' } },
        });

        const staleAutoTs = PUB_NOV_30_15 + 60_000;
        const newerManualTs = PUB_NOV_30_15 + 5 * 60_000;
        const stalePage = makeRankingPage([
            { rank: 500, nickname: '守門', score: 4050 },
            { rank: 501, nickname: '他提督', score: 4049 },
        ]);

        // 同時對真實 IndexedDB（fake-indexeddb）啟動兩筆 rw 交易，且先記錄交易順序。
        const txEvents: string[] = [];
        const origBulkGet = db.senkaRankings.bulkGet.bind(db.senkaRankings);
        const origBulkPut = db.senkaRankings.bulkPut.bind(db.senkaRankings);
        const origPut = db.senkaRankings.put.bind(db.senkaRankings);

        db.senkaRankings.bulkGet = ((keys: string[]) => {
            txEvents.push('auto:read');
            return origBulkGet(keys);
        }) as typeof db.senkaRankings.bulkGet;
        db.senkaRankings.bulkPut = ((rows: Parameters<typeof origBulkPut>[0]) => {
            txEvents.push('auto:write');
            return origBulkPut(rows);
        }) as typeof db.senkaRankings.bulkPut;
        db.senkaRankings.put = ((row: Parameters<typeof origPut>[0]) => {
            txEvents.push('manual:write');
            return origPut(row);
        }) as typeof db.senkaRankings.put;

        await Promise.all([
            captureSenkaRanking(db, {
                id: 50, ts: staleAutoTs, path: RANKING_API_PATH, api: stalePage,
            }),
            saveManualCutoff(db, {
                publishedAt: PUB_NOV_30_15, rank: 500, score: 4200, ts: newerManualTs,
            }),
        ]);

        // 無論哪一筆 rw 交易先拿到鎖，auto:read 與 auto:write 中間都不可能插入 manual:write
        const readIdx = txEvents.indexOf('auto:read');
        const writeIdx = txEvents.indexOf('auto:write');
        const manualIdx = txEvents.indexOf('manual:write');
        expect(readIdx).toBeGreaterThanOrEqual(0);
        expect(manualIdx).toBeGreaterThanOrEqual(0);
        if (writeIdx !== -1) {
            expect(manualIdx < readIdx || manualIdx > writeIdx).toBe(true);
        }

        // 不論交易順序，最終資料庫內必定是較新的手動值 4200
        expect(await db.senkaRankings.get(senkaCutoffKey(PUB_NOV_30_15, 500))).toEqual({
            key: senkaCutoffKey(PUB_NOV_30_15, 500),
            kind: 'cutoff',
            publishedAt: PUB_NOV_30_15,
            rank: 500,
            score: 4200,
            mode: 'manual',
            ts: newerManualTs,
        });
    });

    it('先手動登錄後翻到較新排行榜頁時以封包自動覆寫；deleteManualCutoff 不誤刪 auto', async () => {
        const db = createDb();
        await db.open();
        const manualTs = PUB_NOV_30_15 + 5 * 60_000;
        const autoTs = PUB_NOV_30_15 + 20 * 60_000;

        await saveManualCutoff(db, { publishedAt: PUB_NOV_30_15, rank: 500, score: 4195, ts: manualTs });
        await saveManualCutoff(db, { publishedAt: PUB_NOV_30_15, rank: 501, score: 4190, ts: manualTs });

        const page50 = makeRankingPage([
            { rank: 499, nickname: '甲', score: 4205 },
            { rank: 500, nickname: '乙', score: 4200 },
        ]);
        expect(await captureSenkaRanking(db, {
            id: 60, ts: autoTs, path: RANKING_API_PATH, api: page50,
        })).toBe(1);

        expect(await db.senkaRankings.get(senkaCutoffKey(PUB_NOV_30_15, 500))).toMatchObject({
            score: 4200, mode: 'auto', eventId: 60,
        });

        // auto 列不會被 deleteManualCutoff 刪掉；manual 列（501 名）可正常刪除
        expect(await deleteManualCutoff(db, PUB_NOV_30_15, 500)).toBe(false);
        expect(await db.senkaRankings.get(senkaCutoffKey(PUB_NOV_30_15, 500))).toBeDefined();

        expect(await deleteManualCutoff(db, PUB_NOV_30_15, 501)).toBe(true);
        expect(await db.senkaRankings.get(senkaCutoffKey(PUB_NOV_30_15, 501))).toBeUndefined();
    });
});

describe('逐月最終結果與月次查詢整合', () => {
    it('saveSenkaMonthFinal 寫入、更新並於傳入 null 時刪除列', async () => {
        const db = createDb();
        await db.open();
        const nov = { year: 2026, month: 11 };

        await saveSenkaMonthFinal(db.senkaMonths, nov, 'top500', PUB_NOV_30_15);
        expect(await db.senkaMonths.get(senkaMonthKey(nov))).toEqual({
            month: '2026-11',
            finalTier: 'top500',
            updatedAt: PUB_NOV_30_15,
        });

        await saveSenkaMonthFinal(db.senkaMonths, '2026-11', 'top100', PUB_NOV_30_15 + 1000);
        expect(await db.senkaMonths.get('2026-11')).toEqual({
            month: '2026-11',
            finalTier: 'top100',
            updatedAt: PUB_NOV_30_15 + 1000,
        });

        await saveSenkaMonthFinal(db.senkaMonths, nov, null);
        expect(await db.senkaMonths.get('2026-11')).toBeUndefined();
    });

    it('loadSenkaRankingsForMonth 依作戰月邊界精確篩選，並直接銜接校準與目標比較', async () => {
        const db = createDb();
        await db.open();
        await db.snapshot.put({
            path: 'api_port/port',
            ts: PUB_NOV_01_03,
            api: { api_basic: { api_nickname: 'イケン' } },
        });

        // 寫入 10 月末、11 月初、11 月末、12 月初四個榜次
        await captureSenkaRanking(db, {
            id: 1, ts: PUB_OCT_31_15 + 60_000, path: RANKING_API_PATH,
            api: makeRankingPage([{ rank: 500, nickname: '守門', score: 3900 }, { rank: 467, nickname: 'イケン', score: 3950 }]),
        });
        await captureSenkaRanking(db, {
            id: 2, ts: PUB_NOV_01_03 + 60_000, path: RANKING_API_PATH,
            api: makeRankingPage([{ rank: 500, nickname: '守門', score: 300 }, { rank: 120, nickname: 'イケン', score: 318 }]),
        });
        await captureSenkaRanking(db, {
            id: 3, ts: PUB_NOV_30_15 + 60_000, path: RANKING_API_PATH,
            api: makeRankingPage([{ rank: 500, nickname: '守門', score: 4200 }, { rank: 512, nickname: 'イケン', score: 4180 }]),
        });
        await captureSenkaRanking(db, {
            id: 4, ts: PUB_DEC_01_03 + 60_000, path: RANKING_API_PATH,
            api: makeRankingPage([{ rank: 500, nickname: '守門', score: 250 }, { rank: 200, nickname: 'イケン', score: 260 }]),
        });

        const novMonth = { year: 2026, month: 11 };
        const novData = await loadSenkaRankingsForMonth(db.senkaRankings, novMonth);
        expect(novData.selfRankings.map(r => r.publishedAt)).toEqual([PUB_NOV_01_03, PUB_NOV_30_15]);
        expect(novData.cutoffs.map(r => r.publishedAt)).toEqual([PUB_NOV_01_03, PUB_NOV_30_15]);

        // 直接餵進順序 5 的校準與目標比較函式
        const now = PUB_NOV_30_15 + 3 * 3_600_000;
        const cal = calibrateMonthlySenka({
            month: novMonth,
            now,
            readings: [
                { ts: PUB_NOV_01_03 - 6 * 3_600_000, exp: 1_000_000 },
                { ts: PUB_NOV_01_03 - 2 * 3_600_000, exp: 1_000_000 },
                { ts: PUB_NOV_30_15 - 2 * 3_600_000, exp: 1_000_000 },
                { ts: now - 60_000, exp: 1_100_000 }, // 統計後 +70 普通戰果
            ],
            sorties: [],
            questClaims: [],
            questLookup: () => null,
            selfRankings: novData.selfRankings,
        });
        expect(cal.status).toBe('calibrated');
        if (cal.status === 'calibrated') {
            expect(cal.publishedScore).toBe(4180);
            expect(cal.publishedRank).toBe(512);
            const target = evaluateSenkaTarget({
                month: novMonth,
                target: { type: 'rank', rank: 500 },
                estimate: cal.estimate,
                cutoffs: novData.cutoffs,
                selfRankings: novData.selfRankings,
                now,
            });
            expect(target.type).toBe('rank');
            if (target.type === 'rank') {
                expect(target.cutoff?.score).toBe(4200);
                expect(target.gapAtPublication).toBe(-20);
                expect(target.gapToTarget).toEqual({ min: 50, max: 50 });
            }
        }
    });
});
