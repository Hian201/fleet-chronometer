import { describe, expect, it } from 'vitest';
import type { SortieLogRow } from '../utils/db';
import { catchAlertQueryFrom, catchAlertsToFire, catchesInWindow, parseCatchAlertRule } from '../utils/catch-alert';

const SAURY = 68;
const H = 3_600_000;
const NOW = 1_800_000_000_000;
const rule = { enabled: true, itemId: SAURY, hours: 6, count: 3 };

let nextId = 1;
function row(hoursAgo: number, drops: number[] | undefined, map = '1-5'): SortieLogRow {
    const id = nextId++;
    const out: SortieLogRow = {
        eventId: id, sortieKey: id, ts: NOW - hoursAgo * H, map, node: 1, boss: false,
        kind: 'battle', rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop: null, taiha: false,
    };
    if (drops) out.useItemDrops = drops;
    return out;
}

describe('catch alert', () => {
    it('達到門檻才通知，不可考與其他道具不算', () => {
        const rows = [row(5, [SAURY]), row(4, [SAURY]), row(3, undefined), row(2, [99])];
        expect(catchAlertsToFire(rows, rule, NOW, new Map())).toEqual([]);
        const more = [...rows, row(1, [SAURY])];
        expect(catchAlertsToFire(more, rule, NOW, new Map())).toEqual([{ area: 1, caught: 3 }]);
    });

    it('時窗外的捕獲不算；活動海域與停用的規則不通知', () => {
        expect(catchAlertsToFire([row(7, [SAURY]), row(2, [SAURY, SAURY])], rule, NOW, new Map())).toEqual([]);
        const event = [row(1, [SAURY]), row(1, [SAURY]), row(1, [SAURY])].map(r => ({ ...r, map: '62-1' }));
        expect(catchAlertsToFire(event, rule, NOW, new Map())).toEqual([]);
        const rows = [row(1, [SAURY]), row(1, [SAURY]), row(1, [SAURY])];
        expect(catchAlertsToFire(rows, { ...rule, enabled: false }, NOW, new Map())).toEqual([]);
    });

    it('大海域分開計算', () => {
        const rows = [row(1, [SAURY], '1-5'), row(1, [SAURY], '1-1'), row(1, [SAURY], '3-3'), row(1, [SAURY], '1-4')];
        expect(catchAlertsToFire(rows, rule, NOW, new Map())).toEqual([{ area: 1, caught: 3 }]);
        expect(catchesInWindow(rows, rule, NOW)).toEqual(new Map([[1, 3], [3, 1]]));
    });

    it('持續在條件內不重複通知', () => {
        const rows = [row(3, [SAURY]), row(2, [SAURY]), row(1, [SAURY]), row(0, [SAURY])];
        const fired = new Map([[1, NOW - 1 * H]]);
        expect(catchAlertsToFire(rows, rule, NOW, fired)).toEqual([]);
    });

    it('中途掉到門檻以下再回來，即使中間沒評估過也再通知一次', () => {
        // 上次通知在 10 小時前（當時 12h~10h 前三條）；之後條數隨時間滑出，現在又撈到三條。
        const rows = [row(12, [SAURY]), row(11, [SAURY]), row(10, [SAURY]), row(2, [SAURY]), row(1, [SAURY]), row(0, [SAURY])];
        const fired = new Map([[1, NOW - 10 * H]]);
        expect(catchAlertsToFire(rows, rule, NOW, fired)).toEqual([{ area: 1, caught: 3 }]);
    });

    it('上次通知太久以前就當成已離開', () => {
        const rows = [row(1, [SAURY]), row(1, [SAURY]), row(1, [SAURY])];
        expect(catchAlertsToFire(rows, rule, NOW, new Map([[1, NOW - 8 * 24 * H]]))).toEqual([{ area: 1, caught: 3 }]);
        expect(catchAlertQueryFrom(rule, NOW, new Map([[1, NOW - 8 * 24 * H]]))).toBe(NOW - 7 * 24 * H - 6 * H);
        expect(catchAlertQueryFrom(rule, NOW, new Map())).toBe(NOW - 6 * H);
    });

    it('儲存值格式不符當成未設定', () => {
        expect(parseCatchAlertRule({ enabled: true, itemId: 68, hours: 6, count: 3 })).toEqual(rule);
        expect(parseCatchAlertRule({ enabled: true, itemId: 68, hours: 0, count: 3 })).toBeNull();
        expect(parseCatchAlertRule({ enabled: true, itemId: 68, hours: 6, count: 1.5 })).toBeNull();
        expect(parseCatchAlertRule({ enabled: 'yes', itemId: 68, hours: 6, count: 3 })).toEqual({ ...rule, enabled: false });
        expect(parseCatchAlertRule(null)).toBeNull();
    });
});
