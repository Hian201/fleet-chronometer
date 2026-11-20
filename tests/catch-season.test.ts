import { describe, expect, it } from 'vitest';
import { jstInputToTs, parseInferredEnds, SeasonEndDetector, seasonRange, tsToJstInput, type CatchSeason } from '../utils/catch-season';

const H = 3_600_000;
const S: CatchSeason = { id: '2030', start: 1_000 * H, end: null };
const list = (n: number) => n ? [{ api_id: 10, api_count: 3 }, { api_id: 68, api_count: n }] : [{ api_id: 10, api_count: 3 }];
const login = (n: number) => ({ api_useitem: list(n) });

describe('SeasonEndDetector', () => {
    it('持有 > 0 → 重新載入 → 清單沒有秋刀魚：範圍是最後一次捕獲到看到回收', () => {
        const d = new SeasonEndDetector(S);
        expect(d.feed('api_get_member/useitem', 1001 * H, list(5), null)).toBeNull();
        expect(d.feed('api_req_sortie/battleresult', 1002 * H, { api_get_useitem: { api_useitem_id: 68 } }, 5)).toBeNull();
        expect(d.feed('api_port/port', 1003 * H, {}, 6)).toBeNull();
        // 回收晚一次維修：第一次重新載入時還在
        d.feed('api_start2/getData', 1100 * H, {}, 6);
        expect(d.feed('api_get_member/require_info', 1100 * H + 1, login(6), 6)).toBeNull();
        d.feed('api_start2/getData', 1500 * H, {}, 6);
        expect(d.feed('api_get_member/require_info', 1500 * H + 1, login(0), 6)).toEqual({ after: 1002 * H, before: 1500 * H + 1 });
    });

    it('季內沒看到捕獲時，範圍從季節開始算', () => {
        const d = new SeasonEndDetector(S);
        d.feed('api_start2/getData', 1010 * H, {}, 5);
        expect(d.feed('api_get_member/require_info', 1010 * H + 1, login(0), 5)).toEqual({ after: S.start, before: 1010 * H + 1 });
    });

    it('重新載入後仍持有就不是結束', () => {
        const d = new SeasonEndDetector(S);
        d.feed('api_start2/getData', 1010 * H, {}, 5);
        expect(d.feed('api_get_member/require_info', 1010 * H + 1, login(5), 5)).toBeNull();
    });

    it('上次清單之後有兌換或任務領獎，就不推定（可能是換光）', () => {
        for (const path of ['api_req_member/itemuse', 'api_req_quest/clearitemget']) {
            const d = new SeasonEndDetector(S);
            d.feed('api_get_member/useitem', 1001 * H, list(5), null);
            d.feed(path, 1002 * H, {}, 5);
            d.feed('api_start2/getData', 1010 * H, {}, 5);
            expect(d.feed('api_get_member/require_info', 1010 * H + 1, login(0), 5)).toBeNull();
        }
    });

    it('領獎之後又撈到秋刀魚（持有必定 ≥ 1），推定恢復', () => {
        const d = new SeasonEndDetector(S);
        d.feed('api_get_member/useitem', 1001 * H, list(5), null);
        d.feed('api_req_quest/clearitemget', 1002 * H, {}, 5);
        d.feed('api_req_sortie/battleresult', 1003 * H, { api_get_useitem: { api_useitem_id: 68 } }, 5);
        d.feed('api_start2/getData', 1010 * H, {}, 6);
        expect(d.feed('api_get_member/require_info', 1010 * H + 1, login(0), 6)).toEqual({ after: 1003 * H, before: 1010 * H + 1 });
    });

    it('重新載入前沒有魚、季節開始前、或已有官方結束時刻都不推', () => {
        const d = new SeasonEndDetector(S);
        d.feed('api_start2/getData', 1010 * H, {}, 0);
        expect(d.feed('api_get_member/require_info', 1010 * H + 1, login(0), 0)).toBeNull();
        const early = new SeasonEndDetector(S);
        early.feed('api_start2/getData', 900 * H, {}, 5);
        expect(early.feed('api_get_member/require_info', 900 * H + 1, login(0), 5)).toBeNull();
        const done = new SeasonEndDetector({ ...S, end: 1005 * H });
        done.feed('api_start2/getData', 1010 * H, {}, 5);
        expect(done.feed('api_get_member/require_info', 1010 * H + 1, login(0), 5)).toBeNull();
    });
});

describe('seasonRange', () => {
    const next: CatchSeason = { id: '2031', start: 2_000 * H, end: null };
    it('官方 → 自填 → 推算 → 下一季開始 → 進行中', () => {
        const inferred = { after: 1400 * H, before: 1410 * H };
        expect(seasonRange({ ...S, end: 1500 * H }, inferred, 1300 * H, [S, next]).endKind).toBe('official');
        expect(seasonRange(S, inferred, 1300 * H, [S, next])).toEqual({ start: S.start, end: 1300 * H, endKind: 'user' });
        expect(seasonRange(S, inferred, null, [S, next])).toEqual({ start: S.start, end: 1410 * H, endKind: 'inferred' });
        expect(seasonRange(S, null, null, [S, next])).toEqual({ start: S.start, end: next.start, endKind: 'next' });
        expect(seasonRange(next, null, null, [S, next]).endKind).toBeNull();
    });

    it('早於季節開始的自填值不採用', () => {
        expect(seasonRange(S, null, 900 * H, [S, next])).toEqual({ start: S.start, end: next.start, endKind: 'next' });
    });

    it('自填欄位以日本時間輸入', () => {
        expect(jstInputToTs('2026-12-08T11:00')).toBe(Date.parse('2026-12-08T02:00:00Z'));
        expect(tsToJstInput(Date.parse('2026-12-08T02:00:00Z'))).toBe('2026-12-08T11:00');
        expect(jstInputToTs('')).toBeNull();
    });
});

describe('parseInferredEnds', () => {
    it('略過格式不符與前後顛倒的值', () => {
        expect(parseInferredEnds({ a: { after: 1, before: 2 }, b: { after: 3, before: 2 }, c: 'x' })).toEqual({ a: { after: 1, before: 2 } });
    });
});
