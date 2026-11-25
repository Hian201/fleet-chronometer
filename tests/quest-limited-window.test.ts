// 期間限定任務的實裝期間（tools/quest-graph 由 wikiwiki「実装」欄產生的 LIMITED_QUEST_WINDOWS_RAW）。
import { describe, expect, it } from 'vitest';
import { QUEST_CATALOG } from '../utils/quest-flow';

const def = (no: number) => QUEST_CATALOG.find(quest => quest.apiNo === no)!;

describe('期間限定任務的實裝期間', () => {
    it('2026 南瓜任務與第三十一戦隊任務：11/11 維護結束（營運公告）', () => {
        for (const no of [359, 984, 985, 986, 987, 1002, 1038, 1039, 1040, 1119, 1171]) {
            expect(def(no).limitedWindow, `任務 ${no}`).toEqual({ start: '2026-10-14', end: '2026-11-11' });
        }
        for (const no of [199, 382]) {
            expect(def(no).limitedWindow, `任務 ${no}`).toEqual({ start: '2026-06-26', end: '2026-11-11' });
        }
    });

    it('2026-11-11 期間限定演習任務：11/11 更新後開始，結束日未公告', () => {
        for (const no of [381, 386]) {
            expect(def(no).limitedWindow, `任務 ${no}`).toEqual({ start: '2026-11-11', end: null });
        }
    });

    it('2026-11-24 秋刀魚祭任務群：11/24 更新後開始，結束日未公告', () => {
        for (const no of [369, 866, 867, 868, 1110, 1144]) {
            expect(def(no).limitedWindow, `任務 ${no}`).toEqual({ start: '2026-11-24', end: null });
        }
    });

    it('常設任務不給實裝期間（B218 有實裝日但不是期間限定；B82 只有單一實裝日）', () => {
        expect(def(1053).limited).toBe(false);
        expect(def(1053).limitedWindow).toBeUndefined();
        expect(def(830).limitedWindow).toBeUndefined();
    });

    it('來源沒有寫期間的已結束期間限定任務維持未確認', () => {
        expect(def(1048).limited).toBe(true);
        expect(def(1048).limitedWindow).toBeUndefined();
    });
});
