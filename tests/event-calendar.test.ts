import { describe, expect, it } from 'vitest';
import { eventTermLabel, eventTermOf } from '../utils/event-calendar';
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
