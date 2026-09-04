import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sortieGaugeBarHtml } from '../entrypoints/panel/sortie-gauge';
import { GameState, isGaugeBossNode } from '../utils/state';
import { bossHpReplaySpecificity, observedBossHp } from '../utils/boss-hp';
import type { ReplayRow, SortieLogRow } from '../utils/db';

const MAP_ID = 622;
const BOSS_HP = 880;
const MAX_HP = 4_840;
const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');

function stateAt(nowHp: number, options: { cleared?: boolean; gaugeType?: number; selectedRank?: number; gaugeNum?: number } = {}) {
    const state = new GameState();
    state.sortieInfo = { mapArea: 62, mapNo: 2, nodes: [] };
    state.mapGauges.set(MAP_ID, {
        cleared: options.cleared ?? false,
        gaugeType: options.gaugeType ?? 2,
        defeatCount: 0,
        requiredDefeatCount: 0,
        nowHp,
        maxHp: MAX_HP,
        selectedRank: options.selectedRank ?? 4,
        ...(options.gaugeNum === undefined ? {} : { gaugeNum: options.gaugeNum }),
    });
    if (options.gaugeNum === undefined) state.mapBossHp.set(MAP_ID, BOSS_HP);
    return state;
}

describe('斬殺期判定', () => {
    it('目前血條只接受 map/start 明示的目標 Boss 節點', () => {
        expect(isGaugeBossNode({ id: 32, color: 5, eventId: 5 }, 32)).toBe(true);
        expect(isGaugeBossNode({ id: 55, color: 5, eventId: 5 }, 32)).toBe(false);
        expect(isGaugeBossNode({ id: 55, color: 5, eventId: 5 }, undefined)).toBe(true);
        expect(isGaugeBossNode({ id: 55, color: 5, eventId: 5 }, undefined, true)).toBe(false);
    });

    it.each([
        [840, true],
        [879, true],
        [880, true],
        [881, false],
        [0, false],
    ])('nowHp=%i（bossHp=880）時回傳 %s', (nowHp, expected) => {
        expect(stateAt(nowHp).mapInFinalPhase()).toBe(expected);
    });

    // 遊戲不在任何封包裡送 Boss 旗艦 HP（已用真實 mapinfo 的 api_eventmap 與 start2 的
    // 深海棲艦 master 逐一查證），唯一例外是量表 floor 在 1 這個機制事實。
    it('nowHp=1 時不需要 Boss HP 也判定為斬殺期', () => {
        const state = stateAt(1);
        state.mapBossHp.clear();
        expect(state.mapInFinalPhase()).toBe(true);
    });

    it('nowHp=1 但已通關仍不標斬殺期', () => {
        const state = stateAt(1, { cleared: true });
        state.mapBossHp.clear();
        expect(state.mapInFinalPhase()).toBe(false);
    });

    it('nowHp=1 但量表最大值無效時不套用斬殺期 sentinel', () => {
        const state = stateAt(1);
        state.mapGauges.get(MAP_ID)!.maxHp = 1;
        state.mapBossHp.clear();
        expect(state.mapInFinalPhase()).toBe(false);
    });

    it('沒有 Boss HP 時，nowHp>1 一律不猜', () => {
        const state = stateAt(840);
        state.mapBossHp.clear();
        expect(state.mapInFinalPhase()).toBe(false);
        expect(state.mapRemainingRuns()).toBe(null);
    });

    it('已恢復斬殺門檻時，進入海域尚未看到 Boss 也立即判定 Final', () => {
        const state = new GameState();
        state.mapGauges.set(MAP_ID, {
            cleared: false, gaugeType: 2, defeatCount: 0, requiredDefeatCount: 0,
            nowHp: 840, maxHp: MAX_HP, selectedRank: 4, gaugeNum: 2,
        });
        state.observeMapBossHp(62, 2, BOSS_HP, 2);
        state.applyEvent('api_req_map/start', {
            api_maparea_id: 62, api_mapinfo_no: 2, api_no: 1, api_color_no: 4,
            api_bosscell_no: 32,
            api_eventmap: { api_now_maphp: 840, api_max_maphp: MAX_HP },
        }, { api_deck_id: '1' });
        expect(state.sortieInfo?.nodes).toHaveLength(1);
        expect(state.mapInFinalPhase()).toBe(true);
    });

    it('已通關量表不標成斬殺期', () => {
        expect(stateAt(840, { cleared: true }).mapInFinalPhase()).toBe(false);
    });

    it('滿量表即使殘量小於錯誤觀測到的 boss HP，也不會誤標斬殺期', () => {
        const state = stateAt(MAX_HP);
        state.mapBossHp.set(MAP_ID, MAX_HP + 1);
        expect(state.mapInFinalPhase()).toBe(false);
    });

    it('TP 量表不標成斬殺期', () => {
        expect(stateAt(840, { gaugeType: 3 }).mapInFinalPhase()).toBe(false);
    });

    it('活動圖沒有有效難度時不套用任何歷史斬殺線', () => {
        expect(stateAt(840, { selectedRank: 0 }).mapInFinalPhase()).toBe(false);
    });

    it('有明示血條身分時不沿用舊的單一 map Boss HP 快取', () => {
        const state = stateAt(2_765, { gaugeNum: 3 });
        state.mapBossHp.set(MAP_ID, 3_000); // 舊版單一快取，不能代表 gauge 3
        const fresh = new GameState();
        fresh.sortieInfo = state.sortieInfo;
        fresh.mapGauges.set(MAP_ID, state.mapGauges.get(MAP_ID)!);
        fresh.mapBossHp.set(MAP_ID, 3_000);
        expect(fresh.mapInFinalPhase()).toBe(false);
    });

    it('切換活動難度時清除舊難度的 Boss HP 門檻', () => {
        const state = stateAt(840);
        state.applyEvent('api_req_map/select_eventmap_rank', {
            api_maphp: { api_now_maphp: 4_840, api_max_maphp: 4_840, api_gauge_type: 2 },
        }, { api_maparea_id: '62', api_map_no: '2', api_rank: '3' });
        expect(state.mapBossHp.get(MAP_ID)).toBeUndefined();
    });

    it('同一張活動圖切換血條時不沿用前一條血條的 Boss HP', () => {
        const state = stateAt(2_765, { gaugeNum: 2 });
        state.observeMapBossHp(62, 2, 2_766);
        expect(state.mapInFinalPhase()).toBe(true);

        state.applyEvent('api_get_member/mapinfo', {
            api_map_info: [{
                api_id: MAP_ID,
                api_cleared: 0,
                api_gauge_type: 2,
                api_gauge_num: 3,
                api_eventmap: {
                    api_now_maphp: 2_765,
                    api_max_maphp: MAX_HP,
                    api_selected_rank: 4,
                },
            }],
        });

        expect(state.mapInFinalPhase()).toBe(false);
        expect(state.mapRemainingRuns()).toBe(null);

        state.observeMapBossHp(62, 2, 1_100);
        expect(state.mapBossHp.get(MAP_ID)).toBe(1_100);
        state.applyEvent('api_get_member/mapinfo', {
            api_map_info: [{
                api_id: MAP_ID,
                api_cleared: 0,
                api_gauge_type: 2,
                api_gauge_num: 2,
                api_eventmap: {
                    api_now_maphp: 2_765,
                    api_max_maphp: MAX_HP,
                    api_selected_rank: 4,
                },
            }],
        });
        expect(state.mapBossHp.get(MAP_ID)).toBe(2_766);
        expect(state.mapInFinalPhase()).toBe(true);
    });

    it('同一條活動血條的 Boss HP 證據仍可判定斬殺期', () => {
        const state = stateAt(2_765, { gaugeNum: 3 });
        state.observeMapBossHp(62, 2, 2_766);
        expect(state.mapInFinalPhase()).toBe(true);
    });

    // 斬殺線的兩個材料（mapinfo 的量表值、出擊紀錄的 Boss HP）在母港就到齊，判定不得
    // 綁在「正在出擊中」——出擊一次的資源成本很高，把答案鎖在出擊後才給，等於在使用者
    // 要用它決定「該不該出擊」的當下藏起來。
    it('沒在出擊時仍可指定 mapId 判定斬殺期', () => {
        const state = stateAt(840);
        state.sortieInfo = null;
        expect(state.mapInFinalPhase()).toBe(false);          // 沒指定又沒出擊＝無對象
        expect(state.mapInFinalPhase(MAP_ID)).toBe(true);     // 指定海域即可算
        expect(state.mapRemainingRuns(MAP_ID)).toBe(1);
    });

    it('未攻略 HP 量表清單排除已攻略／未選難度／非 HP 量表', () => {
        const state = stateAt(840);
        state.sortieInfo = null;
        state.mapGauges.set(631, { cleared: true, gaugeType: 2, defeatCount: 0, requiredDefeatCount: 0, nowHp: 10, maxHp: 100, selectedRank: 4 });
        state.mapGauges.set(632, { cleared: false, gaugeType: 2, defeatCount: 0, requiredDefeatCount: 0, nowHp: 100, maxHp: 9999, selectedRank: 0 });
        state.mapGauges.set(633, { cleared: false, gaugeType: 3, defeatCount: 0, requiredDefeatCount: 0, nowHp: 100, maxHp: 500, selectedRank: 4 });
        state.mapGauges.set(634, { cleared: false, gaugeType: 2, defeatCount: 0, requiredDefeatCount: 0, nowHp: 300, maxHp: 900, selectedRank: 3 });
        expect(state.unclearedHpGaugeMaps().map(m => m.mapId)).toEqual([MAP_ID, 634]);
        expect(state.unclearedHpGaugeMaps()[1]).toMatchObject({ mapArea: 63, mapNo: 4 });
    });

    it('同一血條的有效 Boss 遇到較低 HP 最終形態會依 KC3Kai baseHp 向下更新', () => {
        const state = stateAt(840);
        state.observeMapBossHp(62, 2, 920);
        state.observeMapBossHp(62, 2, 670);
        expect(state.mapBossHp.get(MAP_ID)).toBe(670);
        expect(state.mapInFinalPhase()).toBe(false);
    });
});

describe('從持久化出擊紀錄恢復 Boss HP', () => {
    const replay = (sortieKey: number, node: number, hp: number, imported = false, diff = 4): ReplayRow => ({
        sortieKey, ts: sortieKey, world: 62, mapnum: 2, diff, combined: 0,
        fleetnum: 1, fleet1: [], fleet2: [], imported,
        battles: [{ node, data: { api_e_maxhps: [hp] } }],
    });
    const sortie = (sortieKey: number, node: number, boss: boolean, imported = false): SortieLogRow => ({
        eventId: sortieKey, sortieKey, ts: sortieKey, map: '62-2', node, boss,
        kind: 'battle', rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [],
        drop: null, taiha: false, imported,
    });

    it('候選身分精確度優先使用血條編號，再使用難度', () => {
        const current = replay(1, 55, 880, false, 4);
        expect(bossHpReplaySpecificity({ ...current, gaugeNum: 3 }, 4, 3)).toBe(6);
        expect(bossHpReplaySpecificity({ ...current, gaugeNum: 3, diff: 0 }, 4, 3)).toBe(4);
        expect(bossHpReplaySpecificity(current, 4, 3)).toBe(2);
        expect(bossHpReplaySpecificity({ ...current, diff: 0 }, 4, 3)).toBe(0);
        expect(bossHpReplaySpecificity({ ...current, gaugeNum: 2 }, 4, 3)).toBe(null);
        expect(bossHpReplaySpecificity({ ...current, gaugeNum: 3 }, 3, 3)).toBe(null);
        expect(bossHpReplaySpecificity({ ...current, gaugeNum: 3 }, 4)).toBe(null);
    });

    it('舊重播無目標 Boss 身分時採最大值，不讓較低 HP 舊 Boss 污染斬殺線', () => {
        const replays = [replay(1, 32, 670), replay(2, 55, 880), replay(3, 43, 920)];
        const sorties = [sortie(1, 32, true), sortie(2, 55, true), sortie(3, 43, true)];
        expect(observedBossHp(replays, sorties, 62, 2)).toBe(920);
    });

    it('破甲回打舊 Boss 時只採 map/start 明示的目前血條目標節點', () => {
        const currentGauge = { ...replay(1, 32, 920), bossCellNo: 32 };
        const oldBossRoute = { ...replay(2, 55, 670), bossCellNo: 32 };
        const sorties = [sortie(1, 32, true), sortie(2, 55, true)];
        expect(observedBossHp([currentGauge, oldBossRoute], sorties, 62, 2)).toBe(920);
    });

    it('同一目標 Boss 的較低 HP 最終形態仍會向下更新 baseHp', () => {
        const normal = { ...replay(1, 32, 920), bossCellNo: 32 };
        const final = { ...replay(2, 32, 880), bossCellNo: 32 };
        const sorties = [sortie(1, 32, true), sortie(2, 32, true)];
        expect(observedBossHp([normal, final], sorties, 62, 2)).toBe(880);
    });

    it('有目標 Boss 身分的新紀錄優先於無身分舊紀錄', () => {
        const legacy = replay(1, 55, 1_500);
        const exact = { ...replay(2, 32, 880), bossCellNo: 32 };
        const sorties = [sortie(1, 55, true), sortie(2, 32, true)];
        expect(observedBossHp([legacy, exact], sorties, 62, 2)).toBe(880);
    });

    it('不採用非 Boss 節點或外部匯入資料', () => {
        const replays = [replay(1, 32, 670), replay(2, 55, 9999, true), replay(3, 43, 5000)];
        const sorties = [sortie(1, 32, true), sortie(2, 55, true, true), sortie(3, 43, false)];
        expect(observedBossHp(replays, sorties, 62, 2)).toBe(670);
    });

    it('api_e_maxhps 不是陣列或首值不是正整數時不猜 Boss HP', () => {
        const malformed = replay(1, 32, 670);
        malformed.battles[0].data = { api_e_maxhps: '999' };
        expect(observedBossHp([malformed], [sortie(1, 32, true)], 62, 2)).toBe(null);
        malformed.battles[0].data = { api_e_maxhps: [12.5] };
        expect(observedBossHp([malformed], [sortie(1, 32, true)], 62, 2)).toBe(null);
    });

    it('不同難度的 Boss HP 不會互相污染斬殺線', () => {
        const rank4Replay = replay(1, 55, 920, false, 4);
        const rank3Replay = replay(2, 55, 670, false, 3);
        const rank4Sortie = sortie(1, 55, true);
        const rank3Sortie = sortie(2, 55, true);
        expect(observedBossHp([rank4Replay, rank3Replay], [rank4Sortie, rank3Sortie], 62, 2, 4)).toBe(920);
        expect(observedBossHp([rank4Replay, rank3Replay], [rank4Sortie, rank3Sortie], 62, 2, 3)).toBe(670);
    });

    it('舊重播未保存難度時，只有在目前難度沒有精確證據才作相容回退', () => {
        const legacy = replay(1, 55, 880, false, 0);
        const exact = replay(2, 55, 920, false, 4);
        const sorties = [sortie(1, 55, true), sortie(2, 55, true)];
        expect(observedBossHp([legacy], sorties, 62, 2, 4)).toBe(880);
        expect(observedBossHp([legacy, exact], sorties, 62, 2, 4)).toBe(920);
    });

    it('已知血條優先於未標記血條，舊難度資料仍可恢復同一血條', () => {
        const legacy = replay(1, 55, 1_500, false, 0);
        const sameGauge = { ...replay(2, 55, 880, false, 0), gaugeNum: 3 };
        const otherGauge = { ...replay(3, 55, 670, false, 0), gaugeNum: 2 };
        const sorties = [sortie(1, 55, true), sortie(2, 55, true), sortie(3, 55, true)];
        expect(observedBossHp([legacy, sameGauge, otherGauge], sorties, 62, 2, 4, 3)).toBe(880);
    });

    it('不同血條的 Boss HP 不會互相污染', () => {
        const gauge2Replay = replay(1, 55, 2_766);
        const gauge3Replay = { ...replay(2, 55, 1_200), gaugeNum: 3 };
        const gauge2Sortie = sortie(1, 55, true);
        const gauge3Sortie = sortie(2, 55, true);
        expect(observedBossHp([gauge2Replay, gauge3Replay], [gauge2Sortie, gauge3Sortie], 62, 2, 4, 3)).toBe(1_200);
    });

    it('目前血條身分未知時，不混入已標記其他血條的舊觀測', () => {
        const legacy = replay(1, 55, 2_766);
        const labelled = { ...replay(2, 55, 1_200), gaugeNum: 3 };
        expect(observedBossHp([legacy, labelled], [sortie(1, 55, true), sortie(2, 55, true)], 62, 2, 4))
            .toBe(2_766);
    });
});

describe('斬殺期量表 HTML', () => {
    it('斬殺期以 Final 與條外實數顯示 meter ARIA', () => {
        const html = sortieGaugeBarHtml({
            now: 840,
            max: MAX_HP,
            finalPhase: true,
            title: '剩餘 840/4840',
            finalLabel: '斬殺期',
        });

        expect(html).toContain('zansatsu');
        // Final 在量表條內；數字在條外，避免兩者互相擠壓。
        expect(html).toMatch(/<span class="s-gauge-bar"[\s\S]*s-gauge-final[\s\S]*<\/span>/);
        expect(html).toContain('<b class="s-gauge-final">Final</b>');
        expect(html).toContain('<strong>840</strong><small>/4840</small>');
        expect(html).toContain('role="meter"');
        expect(html).toContain('aria-valuemin="0"');
        expect(html).toContain('aria-valuemax="4840"');
        expect(html).toContain('aria-valuenow="840"');
    });

    it('非斬殺期不顯示斬殺期標籤', () => {
        const html = sortieGaugeBarHtml({
            now: 880,
            max: MAX_HP,
            finalPhase: false,
            title: '剩餘 880/4840',
            finalLabel: '斬殺期',
        });

        expect(html).not.toContain('zansatsu');
        expect(html).not.toContain('s-gauge-final');
        expect(html).not.toContain('Final');
        expect(html).toContain('<strong>880</strong><small>/4840</small>');
        expect(html).toContain('role="meter"');
    });

    it('斬殺期標籤不再是純白粗體大字', () => {
        const rule = panelHtml.match(/\.s-gauge-final\s*\{([^}]+)\}/)?.[1] ?? '';
        expect(rule).toContain('font-size: 9px');
        expect(rule).toContain('font-weight: 700');
        expect(rule).toContain('color: color-mix(');   // 淡金，不是純白
        expect(rule).not.toContain('font-weight: 800');
        expect(rule).not.toContain('color: #fff');
        expect(rule).not.toContain('font-size: 11px');
    });

    // 這是版面硬約束：量表所在的標題列一長高，整個編成就往下位移，而斬殺期正是最需要
    // 盯著版面不動的時候；撐寬則會讓 flex-wrap 的 .s-header 換行，多一整列把下面釘死的
    // 出擊資訊推到要捲動。故斬殺態不得改動 height／border／min-width。
    it('斬殺期不改變量表尺寸，輪廓只用不佔版面的 inset box-shadow', () => {
        const zansatsuBar = panelHtml.match(/\.s-gauge\.zansatsu \.s-gauge-bar\s*\{([^}]+)\}/)?.[1] ?? '';
        expect(zansatsuBar).toContain('inset 0 0 0 1px');
        expect(zansatsuBar).not.toMatch(/\bheight\s*:/);
        expect(zansatsuBar).not.toMatch(/\bborder\s*:/);
        expect(zansatsuBar).not.toMatch(/\bmin-width\s*:/);
        // 高對比模式同樣不得靠 border-width 加粗（會讓兩個模式高度不同）
        expect(panelHtml).not.toMatch(/\.s-gauge\.zansatsu[^{]*\{[^}]*border-width/);
    });

});
