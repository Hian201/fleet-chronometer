// 排行榜解碼與榜次推算純函式測試（utils/senka-ranking.ts）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    RANKING_RANK_FACTORS,
    RANKING_SCORE_OFFSET,
    decodeRankingPage,
    findSelfRankingEntry,
    rankingRoundAt,
} from '../utils/senka-ranking';

const loadSampleApiData = (filename: string): unknown =>
    JSON.parse(readFileSync(new URL(`../samples/${filename}`, import.meta.url), 'utf8')).api_data;

const encodeEntry = (rank: number, score: number, playerFactor = 44, nickname = '') => ({
    api_mxltvkpyuklh: rank,
    api_mtjmdcwtvhdr: nickname,
    api_wuhnhojjxmke: (score + RANKING_SCORE_OFFSET) * playerFactor * RANKING_RANK_FACTORS[rank % 13],
});

describe('decodeRankingPage', () => {
    it('真封包：解碼第 1、51、147 頁共 30 列，結果與遊戲畫面截圖逐列一致', () => {
        const p1 = decodeRankingPage(loadSampleApiData('ranking-page-1.json'));
        expect(p1).not.toBeNull();
        expect(p1!.page).toBe(1);
        expect(p1!.playerFactor).toBe(44);
        expect(p1!.entries).toEqual([
            { rank: 1, nickname: '', score: 10336 },
            { rank: 2, nickname: '', score: 9741 },
            { rank: 3, nickname: '', score: 9191 },
            { rank: 4, nickname: '', score: 8681 },
            { rank: 5, nickname: '', score: 7999 },
            { rank: 6, nickname: '', score: 7638 },
            { rank: 7, nickname: '', score: 7359 },
            { rank: 8, nickname: '', score: 7271 },
            { rank: 9, nickname: '', score: 6665 },
            { rank: 10, nickname: '', score: 6290 },
        ]);

        const p51 = decodeRankingPage(loadSampleApiData('ranking-page-51.json'));
        expect(p51).not.toBeNull();
        expect(p51!.page).toBe(51);
        expect(p51!.playerFactor).toBe(44);
        expect(p51!.entries).toEqual([
            { rank: 501, nickname: '', score: 2150 },
            { rank: 502, nickname: '', score: 2147 },
            { rank: 503, nickname: '', score: 2145 },
            { rank: 504, nickname: '', score: 2140 },
            { rank: 505, nickname: '', score: 2139 },
            { rank: 506, nickname: '', score: 2132 },
            { rank: 507, nickname: '', score: 2132 },
            { rank: 508, nickname: '', score: 2129 },
            { rank: 509, nickname: '', score: 2118 },
            { rank: 510, nickname: '', score: 2117 },
        ]);

        const p147 = decodeRankingPage(loadSampleApiData('ranking-page-147.json'));
        expect(p147).not.toBeNull();
        expect(p147!.page).toBe(147);
        expect(p147!.playerFactor).toBe(44);
        expect(p147!.entries).toEqual([
            { rank: 1461, nickname: '', score: 840 },
            { rank: 1462, nickname: '', score: 840 },
            { rank: 1463, nickname: '', score: 839 },
            { rank: 1464, nickname: '', score: 838 },
            { rank: 1465, nickname: '', score: 837 },
            { rank: 1466, nickname: '', score: 835 },
            { rank: 1467, nickname: '', score: 834 },
            { rank: 1468, nickname: '', score: 833 },
            { rank: 1469, nickname: '', score: 833 },
            { rank: 1470, nickname: '', score: 832 },
        ]);
    });

    it('支援帶提督名的多頁合成資料（含 0 分邊界與 api_disp_page 缺席）', () => {
        const res = decodeRankingPage({
            api_list: [
                encodeEntry(999, 12, 37, '甲提督'),
                encodeEntry(1000, 0, 37, '乙提督'),
            ],
        });
        expect(res).toEqual({
            page: null,
            playerFactor: 37,
            entries: [
                { rank: 999, nickname: '甲提督', score: 12 },
                { rank: 1000, nickname: '乙提督', score: 0 },
            ],
        });
    });

    it('任一列無法整除時回傳 null', () => {
        const apiData = loadSampleApiData('ranking-page-1.json') as {
            api_list: { api_wuhnhojjxmke: number }[];
        };
        apiData.api_list[0].api_wuhnhojjxmke += 1;
        expect(decodeRankingPage(apiData)).toBeNull();
    });

    it('全列同分退化頁、單列頁、空陣列、負數、小數與無效輸入皆回傳 null', () => {
        // 全列同分：gcd 會吸收 (score + 91) * playerFactor，商比恆為 1 → score = -90 < 0
        expect(decodeRankingPage({
            api_disp_page: 1,
            api_list: [
                encodeEntry(1, 500, 44, 'A'),
                encodeEntry(2, 500, 44, 'B'),
            ],
        })).toBeNull();

        // 負數戰果（低於偏移量 -91）
        expect(decodeRankingPage({
            api_disp_page: 1,
            api_list: [
                encodeEntry(1, -5, 44, 'A'),
                encodeEntry(2, 100, 44, 'B'),
            ],
        })).toBeNull();

        // 單列與空陣列
        expect(decodeRankingPage({ api_list: [encodeEntry(1, 1000, 44)] })).toBeNull();
        expect(decodeRankingPage({ api_list: [] })).toBeNull();

        // 缺欄位、型別錯誤、0／負／小數名次或混淆值
        expect(decodeRankingPage(null)).toBeNull();
        expect(decodeRankingPage(undefined)).toBeNull();
        expect(decodeRankingPage('invalid')).toBeNull();
        expect(decodeRankingPage({})).toBeNull();
        expect(decodeRankingPage({
            api_list: [
                { api_mxltvkpyuklh: 0, api_wuhnhojjxmke: 1000 },
                encodeEntry(2, 100, 44),
            ],
        })).toBeNull();
        expect(decodeRankingPage({
            api_list: [
                { api_mxltvkpyuklh: 1.5, api_wuhnhojjxmke: 1000 },
                encodeEntry(2, 100, 44),
            ],
        })).toBeNull();
        expect(decodeRankingPage({
            api_list: [
                { api_mxltvkpyuklh: 1, api_wuhnhojjxmke: 0 },
                encodeEntry(2, 100, 44),
            ],
        })).toBeNull();
        expect(decodeRankingPage({
            api_list: [
                { api_mxltvkpyuklh: 1, api_wuhnhojjxmke: '1000' },
                encodeEntry(2, 100, 44),
            ],
        })).toBeNull();
        expect(decodeRankingPage({
            api_list: [null, encodeEntry(2, 100, 44)],
        })).toBeNull();
    });
});

describe('findSelfRankingEntry', () => {
    const entries = [
        { rank: 501, nickname: '鎮守府甲', score: 2150 },
        { rank: 502, nickname: '鎮守府乙', score: 2147 },
        { rank: 503, nickname: '重複名', score: 2145 },
        { rank: 504, nickname: '重複名', score: 2140 },
    ];

    it('僅在提督名唯一命中時回傳該列', () => {
        expect(findSelfRankingEntry(entries, '鎮守府乙')).toEqual({
            rank: 502,
            nickname: '鎮守府乙',
            score: 2147,
        });
        expect(findSelfRankingEntry(entries, '不存在')).toBeNull();
    });

    it('空字串、null、undefined（含去識別空字串頁）與同頁撞名皆回傳 null', () => {
        const redactedPage = decodeRankingPage(loadSampleApiData('ranking-page-147.json'))!;
        expect(findSelfRankingEntry(redactedPage.entries, '')).toBeNull();
        expect(findSelfRankingEntry(redactedPage.entries, null)).toBeNull();
        expect(findSelfRankingEntry(redactedPage.entries, undefined)).toBeNull();
        expect(findSelfRankingEntry(entries, '重複名')).toBeNull();
    });
});

describe('rankingRoundAt', () => {
    it('依 03:00 JST（18:00 UTC）與 15:00 JST（06:00 UTC）切分榜次', () => {
        const jst1500 = Date.UTC(2026, 10, 15, 6, 0, 0);
        const jst0300Prev = Date.UTC(2026, 10, 14, 18, 0, 0);

        // 14:59:59.999 JST 仍屬前一次 03:00 JST 榜
        expect(rankingRoundAt(jst1500 - 1)).toEqual({
            month: { year: 2026, month: 11 },
            publishedAt: jst0300Prev,
            tallyAt: jst0300Prev - 3_600_000,
            isFinalRound: false,
        });

        // 15:00:00 JST 整點進入本輪
        expect(rankingRoundAt(jst1500)).toEqual({
            month: { year: 2026, month: 11 },
            publishedAt: jst1500,
            tallyAt: jst1500 - 3_600_000,
            isFinalRound: false,
        });
    });

    it('月末 15:00 JST 為最後公開榜，且月末 22:00～次月 1 日 02:59 JST 仍歸前月最終榜', () => {
        const novFinal = Date.UTC(2026, 10, 30, 6, 0, 0); // 11/30 15:00 JST
        const nov2300 = Date.UTC(2026, 10, 30, 14, 0, 0); // 11/30 23:00 JST
        const dec0259 = Date.UTC(2026, 10, 30, 17, 59, 59, 999); // 12/01 02:59:59.999 JST
        const dec0300 = Date.UTC(2026, 10, 30, 18, 0, 0); // 12/01 03:00 JST

        for (const ts of [novFinal, nov2300, dec0259]) {
            expect(rankingRoundAt(ts)).toEqual({
                month: { year: 2026, month: 11 },
                publishedAt: novFinal,
                tallyAt: Date.UTC(2026, 10, 30, 5, 0, 0),
                isFinalRound: true,
            });
        }

        expect(rankingRoundAt(dec0300)).toEqual({
            month: { year: 2026, month: 12 },
            publishedAt: dec0300,
            tallyAt: Date.UTC(2026, 10, 30, 17, 0, 0),
            isFinalRound: false,
        });
    });

    it('正確處理平年 2 月、閏年 2 月與跨年最終榜', () => {
        expect(rankingRoundAt(Date.UTC(2026, 1, 28, 6, 0, 0))?.isFinalRound).toBe(true);
        expect(rankingRoundAt(Date.UTC(2024, 1, 28, 6, 0, 0))?.isFinalRound).toBe(false);
        expect(rankingRoundAt(Date.UTC(2024, 1, 29, 6, 0, 0))?.isFinalRound).toBe(true);

        const decFinal = Date.UTC(2025, 11, 31, 6, 0, 0); // 2025/12/31 15:00 JST
        expect(rankingRoundAt(Date.UTC(2025, 11, 31, 17, 59, 59))).toEqual({
            month: { year: 2025, month: 12 },
            publishedAt: decFinal,
            tallyAt: Date.UTC(2025, 11, 31, 5, 0, 0),
            isFinalRound: true,
        });
        expect(rankingRoundAt(Date.UTC(2025, 11, 31, 18, 0, 0))?.month).toEqual({ year: 2026, month: 1 });
    });

    it('非有限數回傳 null', () => {
        expect(rankingRoundAt(Number.NaN)).toBeNull();
        expect(rankingRoundAt(Number.POSITIVE_INFINITY)).toBeNull();
    });
});
