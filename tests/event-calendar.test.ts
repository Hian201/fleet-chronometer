import { describe, expect, it } from 'vitest';
import {
    SEASON_GROUP, eventOperationsOf, eventTermLabel, eventTermOf, eventWorlds, operationIndexOfMap, operationMapRange,
} from '../utils/event-calendar';
import { setLang, t } from '../utils/ui-i18n';

describe('活動年表', () => {
    it('以 maparea id 對到年份與季節，表外不猜', () => {
        expect(eventTermOf(62)).toEqual({ year: 2026, season: 'summer' });
        expect(eventTermOf(61)).toEqual({ year: 2025, season: 'autumn' });
        expect(eventTermOf(42)).toEqual({ year: 2018, season: 'earlyFall' });
        expect(eventTermOf(47)).toEqual({ year: 2020, season: 'mini' });
        expect(eventTermOf(48)).toEqual({ year: 2020, season: 'rainySummer' });
        expect(eventTermOf(56)).toEqual({ year: 2023, season: 'earlySpring' });
        expect(eventTermOf(31)).toEqual({ year: 2015, season: 'summer' });
        expect(eventTermOf(7)).toBeNull();
        expect(eventTermOf(30)).toBeNull();
    });

    it('顯示字串依語系組年份＋季節，不帶作戰標題', () => {
        setLang('zh-TW');
        expect(eventTermLabel(62, t)).toBe('2026夏季');
        expect(eventTermLabel(61, t)).toBe('2025秋季');
        expect(eventTermLabel(42, t)).toBe('2018初秋');
        expect(eventTermLabel(30, t)).toBeNull();

        setLang('ja');
        expect(eventTermLabel(62, t)).toBe('2026夏');
        expect(eventTermLabel(47, t)).toBe('2020ミニ');

        setLang('en');
        expect(eventTermLabel(62, t)).toBe('2026 Summer');
        expect(eventTermLabel(48, t)).toBe('2020 Rainy-Summer');
    });
});

describe('作戰名與前後段', () => {
    it('年表裡每次活動都有作戰名，三語皆非空、段落依關卡遞增', () => {
        for (const world of eventWorlds()) {
            const ops = eventOperationsOf(world);
            expect(ops, `world ${world}`).not.toBeNull();
            for (const op of ops!) {
                expect(op.jp.trim(), `world ${world}`).not.toBe('');
                expect(op.en.trim(), `world ${world}`).not.toBe('');
                expect(op.zhTW.trim(), `world ${world}`).not.toBe('');
            }
            const firsts = ops!.flatMap(op => (op.firstMap === null ? [] : [op.firstMap]));
            expect(firsts.length, `world ${world} 至少一段有關卡`).toBeGreaterThan(0);
            expect(firsts[0], `world ${world} 第一個有關卡的段從 E1 起`).toBe(1);
            expect([...firsts].sort((a, b) => a - b)).toEqual(firsts);
        }
    });

    it('依 firstMap 把關卡分到前段／後段，最後一段開放到底', () => {
        expect(operationIndexOfMap(62, 1)).toBe(0);
        expect(operationIndexOfMap(62, 3)).toBe(0);
        expect(operationIndexOfMap(62, 4)).toBe(1);
        expect(operationIndexOfMap(57, 4)).toBe(0);
        expect(operationIndexOfMap(57, 5)).toBe(1);
        expect(operationMapRange(62, 0)).toEqual({ from: 1, to: 3 });
        expect(operationMapRange(62, 1)).toEqual({ from: 4, to: null });
        // 單段活動與表外 world 都視為一段
        expect(operationIndexOfMap(55, 6)).toBe(0);
        expect(operationIndexOfMap(99, 2)).toBe(0);
    });

    it('2021秋前段是通常海域的秋刀魚祭：沒有活動關卡，E1 屬於後段', () => {
        const ops = eventOperationsOf(52)!;
        expect(ops).toHaveLength(2);
        expect(ops[0].firstMap).toBeNull();
        expect(operationIndexOfMap(52, 1)).toBe(1);
        expect(operationMapRange(52, 0)).toBeNull();
        expect(operationMapRange(52, 1)).toEqual({ from: 1, to: null });
    });

    it('季節大類：初春併入春、梅雨夏併入夏、初秋併入秋', () => {
        expect(SEASON_GROUP.earlySpring).toBe('spring');
        expect(SEASON_GROUP.rainySummer).toBe('summer');
        expect(SEASON_GROUP.earlyFall).toBe('autumn');
        expect(SEASON_GROUP.mini).toBe('mini');
    });
});
