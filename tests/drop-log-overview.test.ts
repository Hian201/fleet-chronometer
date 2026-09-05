// 打撈紀錄的海域欄：單次活動用 E{n}，跨活動並列才帶年份季節。
import { describe, expect, it } from 'vitest';
import { dropMapLabel, dropMapTitle } from '../entrypoints/overview/sections/drop-log';
import type { SortieLogRow } from '../utils/db';
import { GameState } from '../utils/state';
import type { SectionContext } from '../entrypoints/overview/sections/types';
import { setLang } from '../utils/ui-i18n';

setLang('zh-TW');
const ctx = { state: new GameState() } as SectionContext;

const row = (map: string): SortieLogRow => ({
    eventId: 1, sortieKey: 1, ts: 1_700_000_000_000, map, node: 1, boss: true,
    kind: 'battle', rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop: '雪風', taiha: false,
});

describe('打撈紀錄海域欄', () => {
    it('通常海域維持原代號', () => {
        expect(dropMapLabel(row('6-5'), true)).toBe('6-5');
        expect(dropMapTitle(row('6-5'), ctx)).toBe('6-5');
    });

    it('活動關卡不設五關上限，跨活動才帶年份季節', () => {
        expect(dropMapLabel(row('62-7'), false)).toBe('E7');
        expect(dropMapLabel(row('61-3'), true)).toBe('2025秋季 E3');
        expect(dropMapTitle(row('61-3'), ctx)).toBe('2025秋季（61-3）');
    });
});
