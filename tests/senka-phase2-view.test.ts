// 第二期戰果檢視：榜分校準與目標差額組裝（utils/senka-view.ts）、面板托盤榜線區與逐月對帳查詢。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { senkaHeaderButtonHtml, senkaTrayInnerHtml } from '../entrypoints/panel/senka-tray';
import { db } from '../utils/db';
import { senkaMonthWindow, type ExpReading } from '../utils/senka';
import type { SenkaTarget } from '../utils/senka-calibration';
import { loadSenkaReconMonths, type SenkaMonthRankings } from '../utils/senka-readings';
import type { SenkaRankingRow } from '../utils/senka-store';
import {
    buildSenkaMonthView, buildSenkaReconRow, formatSenkaBounds, formatSenkaIntGap, formatSenkaPartBounds,
    formatSignedSenkaBounds,
} from '../utils/senka-view';
import { tFor } from '../utils/ui-i18n';

const MONTH = { year: 2026, month: 11 };
const WIN = senkaMonthWindow(MONTH);
const NOW = Date.UTC(2026, 10, 30, 3, 0); // 11/30 12:00 JST，最後一次公開榜（15:00 JST）之前
const PUB = Date.UTC(2026, 10, 29, 6); // 11/29 15:00 JST 公布、14:00 JST 結算
const TALLY = PUB - 3_600_000;

// 月起點確定（月界前後讀數相等）；結算前普通 700、結算後再 +70。
const readings: ExpReading[] = [
    { ts: WIN.start - 10_000, exp: 1_000_000 },
    { ts: WIN.start + 60_000, exp: 1_000_000 },
    { ts: TALLY - 3_600_000, exp: 2_000_000 },
    { ts: NOW - 60_000, exp: 2_100_000 },
];
const data = { readings, sorties: [], questClaims: [] };

function rankings(cutoffs: { rank: number; score: number }[] = []): SenkaMonthRankings {
    const self: SenkaRankingRow = { key: `self:${PUB}`, kind: 'self', publishedAt: PUB, score: 1010, rank: 512, ts: PUB + 60_000, eventId: 9 };
    const cut: SenkaRankingRow[] = cutoffs.map(c => ({
        key: `cutoff:${PUB}:${c.rank}`, kind: 'cutoff', publishedAt: PUB, rank: c.rank, score: c.score, mode: 'auto', ts: PUB + 60_000, eventId: 9,
    }));
    return {
        selfRankings: [self],
        cutoffs: cut.map(c => ({ publishedAt: c.publishedAt, rank: (c as { rank: number }).rank, score: c.score })),
        rows: [self, ...cut],
    };
}

describe('小數區間格式化', () => {
    it('單值四捨五入、區間下界捨去上界進位，-0 正規化', () => {
        expect(formatSenkaBounds({ min: 4259.6, max: 4259.6 }, 'zh-TW')).toBe('≈4,260');
        expect(formatSenkaBounds({ min: 4259.3, max: 4262.2 }, 'zh-TW')).toBe('≈4,259～4,263');
        expect(formatSenkaPartBounds({ min: 309.6, max: 309.6 }, 'en')).toBe('310');
        expect(formatSignedSenkaBounds({ min: -0.2, max: -0.2 }, 'en')).toBe('0');
        expect(formatSignedSenkaBounds({ min: -3.5, max: 2.5 }, 'en')).toBe('≈−4–+3');
        expect(formatSenkaIntGap(-20, 'zh-TW')).toBe('−20');
        expect(formatSenkaIntGap(0, 'zh-TW')).toBe('0');
    });
});

describe('buildSenkaMonthView 與托盤榜線區', () => {
    it('有本人榜分時校準繼承分，推算＝榜分＋統計後新增，頁首顯示推算值', () => {
        const view = buildSenkaMonthView(data, rankings([{ rank: 500, score: 1000 }]), { type: 'rank', rank: 500 }, NOW);
        expect(view.calibration.status).toBe('calibrated');
        if (view.calibration.status !== 'calibrated') return;
        expect(view.calibration.carry).toEqual({ min: 310, max: 310 });
        expect(view.calibration.estimate).toEqual({ min: 1080, max: 1080 });
        expect(senkaHeaderButtonHtml(view, false, 'zh-TW')).toContain('<b>≈1,080</b>');

        const tray = senkaTrayInnerHtml(view, 'zh-TW');
        expect(tray).toContain(`${tFor('zh-TW', 'senka.estimate')}</span><b>≈1,080</b>`);
        expect(tray).toContain('繼承 310 · 普通 770');
        expect(tray).toContain('11 月作戰 · 三群');
        expect(tray).toContain(tFor('zh-TW', 'senka.lastPublished'));
        expect(tray).toContain('本人 1,010 · 第 500 名 1,000');
        expect(tray).toContain(`<dt>${tFor('zh-TW', 'senka.gap')}</dt><dd>+10</dd>`);
        expect(tray).toContain(`<dt>${tFor('zh-TW', 'senka.since')}</dt><dd>≈+70</dd>`);
        expect(tray).toContain(`<dt>${tFor('zh-TW', 'senka.toCutoff')}</dt><dd>≈+80</dd>`);
    });

    it('目標名次本月沒有榜線時只提示尚未登錄，不顯示差額也不借他月榜線', () => {
        const view = buildSenkaMonthView(data, rankings([{ rank: 500, score: 1000 }]), { type: 'rank', rank: 100 }, NOW);
        const tray = senkaTrayInnerHtml(view, 'zh-TW');
        expect(tray).toContain('第 100 名 —');
        expect(tray).toContain(tFor('zh-TW', 'ov.skNoCutoff'));
        expect(tray).not.toContain(tFor('zh-TW', 'senka.toCutoff'));
        expect(tray).not.toContain(tFor('zh-TW', 'senka.gap'));
    });

    it('自訂目標標「距自訂目標」，不設目標時不顯示榜差', () => {
        const custom: SenkaTarget = { type: 'custom', score: 1200 };
        const tray = senkaTrayInnerHtml(buildSenkaMonthView(data, rankings(), custom, NOW), 'en');
        expect(tray).toContain('Custom 1,200');
        expect(tray).toContain(`<dt>${tFor('en', 'ov.skToCustom')}</dt><dd>≈−120</dd>`);

        const none = senkaTrayInnerHtml(buildSenkaMonthView(data, rankings(), null, NOW), 'zh-TW');
        expect(none).toContain('本人 1,010');
        expect(none).not.toContain(tFor('zh-TW', 'senka.gap'));
        expect(none).toContain(`<span class="ph-target">11 月作戰</span>`);
    });

    it('英文名次帶序數', () => {
        const view = buildSenkaMonthView(data, rankings([{ rank: 500, score: 1000 }]), { type: 'rank', rank: 500 }, NOW);
        expect(senkaTrayInnerHtml(view, 'en')).toContain('500th 1,000');
    });

    it('沒有本人榜分時維持已觀測戰果，目標榜線照樣列出但不算差額', () => {
        const r = rankings([{ rank: 500, score: 1000 }]);
        const view = buildSenkaMonthView(data, { ...r, selfRankings: [] }, { type: 'rank', rank: 500 }, NOW);
        expect(view.calibration.status).toBe('uncalibrated');
        const tray = senkaTrayInnerHtml(view, 'zh-TW');
        expect(tray).toContain(tFor('zh-TW', 'ov.skObserved'));
        expect(tray).toContain('第 500 名 1,000');
        expect(tray).not.toContain(tFor('zh-TW', 'senka.toCutoff'));
    });
});

describe('逐月對帳', () => {
    it('已結束月份以月末計算並取最後一次本人名次；未校準時推算總額為 null', () => {
        const oct = { year: 2026, month: 10 };
        const octWin = senkaMonthWindow(oct);
        const octData = {
            readings: [{ ts: octWin.start - 1, exp: 0 }, { ts: octWin.start + 1, exp: 0 }, { ts: octWin.end - 60_000, exp: 1_000_000 }],
            sorties: [],
            questClaims: [],
        };
        const bare = buildSenkaReconRow(oct, octData, null, 'top500', NOW);
        expect(bare).toMatchObject({ key: '2026-10', inProgress: false, carry: null, total: null, lastRank: null, finalTier: 'top500' });
        expect(bare.regular).toMatchObject({ status: 'exact', points: 700 });

        const lastPub = Date.UTC(2026, 9, 31, 6);
        const withRank = buildSenkaReconRow(oct, octData, {
            selfRankings: [
                { publishedAt: Date.UTC(2026, 9, 30, 18), score: 600, rank: 700 },
                { publishedAt: lastPub, score: 690, rank: 512 },
            ],
            cutoffs: [],
            rows: [],
        }, null, NOW);
        expect(withRank.lastRank).toBe(512);
        expect(withRank.total).not.toBeNull();
    });
});

describe('loadSenkaReconMonths', () => {
    beforeEach(async () => {
        await Promise.all([db.resources.clear(), db.senkaMonths.clear(), db.senkaRankings.clear()]);
    });
    afterEach(async () => {
        await Promise.all([db.resources.clear(), db.senkaMonths.clear(), db.senkaRankings.clear()]);
    });

    it('當月一律列出，過去月份只列有資料或最終結果的月份，新到舊', async () => {
        await db.senkaMonths.put({ month: '2026-09', finalTier: 'top500', updatedAt: 1 });
        await db.resources.put({ eventId: 1, ts: senkaMonthWindow({ year: 2026, month: 7 }).start + 1, m: [0, 0, 0, 0, 0, 0, 0, 0], exp: 10 });
        const rows = await loadSenkaReconMonths(db, NOW);
        expect(rows.map(r => `${r.month.year}-${r.month.month}`)).toEqual(['2026-11', '2026-9', '2026-7']);
        expect(rows[1].finalTier).toBe('top500');
        expect(rows[0].finalTier).toBeNull();
    });
});
