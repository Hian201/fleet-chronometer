import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sortieGaugeBarHtml } from '../entrypoints/panel/sortie-gauge';
import { GameState } from '../utils/state';
import { maxObservedBossHp } from '../utils/boss-hp';
import type { ReplayRow, SortieLogRow } from '../utils/db';

const MAP_ID = 622;
const BOSS_HP = 880;
const MAX_HP = 4_840;
const panelHtml = readFileSync(new URL('../entrypoints/panel/index.html', import.meta.url), 'utf8');

function stateAt(nowHp: number, options: { cleared?: boolean; gaugeType?: number } = {}) {
    const state = new GameState();
    state.sortieInfo = { mapArea: 62, mapNo: 2, nodes: [] };
    state.mapGauges.set(MAP_ID, {
        cleared: options.cleared ?? false,
        gaugeType: options.gaugeType ?? 2,
        defeatCount: 0,
        requiredDefeatCount: 0,
        nowHp,
        maxHp: MAX_HP,
        selectedRank: 4,
    });
    state.mapBossHp.set(MAP_ID, BOSS_HP);
    return state;
}

describe('斬殺期判定', () => {
    it.each([
        [840, true],
        [879, true],
        [880, false],
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

    it('已通關量表不標成斬殺期', () => {
        expect(stateAt(840, { cleared: true }).mapInFinalPhase()).toBe(false);
    });

    it('TP 量表不標成斬殺期', () => {
        expect(stateAt(840, { gaugeType: 3 }).mapInFinalPhase()).toBe(false);
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

    it('同海域後遇到較低 HP 的 Boss 不會覆蓋既有斬殺線', () => {
        const state = stateAt(840);
        state.observeMapBossHp(62, 2, 920);
        state.observeMapBossHp(62, 2, 670);
        expect(state.mapBossHp.get(MAP_ID)).toBe(920);
        expect(state.mapInFinalPhase()).toBe(true);
    });
});

describe('從持久化出擊紀錄恢復 Boss HP', () => {
    const replay = (sortieKey: number, node: number, hp: number, imported = false): ReplayRow => ({
        sortieKey, ts: sortieKey, world: 62, mapnum: 2, diff: 4, combined: 0,
        fleetnum: 1, fleet1: [], fleet2: [], imported,
        battles: [{ node, data: { api_e_maxhps: [hp] } }],
    });
    const sortie = (sortieKey: number, node: number, boss: boolean, imported = false): SortieLogRow => ({
        eventId: sortieKey, sortieKey, ts: sortieKey, map: '62-2', node, boss,
        kind: 'battle', rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [],
        drop: null, taiha: false, imported,
    });

    it('E2 多個 Boss 節點取本機實戰觀測到的最高 HP', () => {
        const replays = [replay(1, 32, 670), replay(2, 55, 880), replay(3, 43, 920)];
        const sorties = [sortie(1, 32, true), sortie(2, 55, true), sortie(3, 43, true)];
        expect(maxObservedBossHp(replays, sorties, 62, 2)).toBe(920);
    });

    it('不採用非 Boss 節點或外部匯入資料', () => {
        const replays = [replay(1, 32, 670), replay(2, 55, 9999, true), replay(3, 43, 5000)];
        const sorties = [sortie(1, 32, true), sortie(2, 55, true, true), sortie(3, 43, false)];
        expect(maxObservedBossHp(replays, sorties, 62, 2)).toBe(670);
    });

    it('api_e_maxhps 不是陣列或首值不是正整數時不猜 Boss HP', () => {
        const malformed = replay(1, 32, 670);
        malformed.battles[0].data = { api_e_maxhps: '999' };
        expect(maxObservedBossHp([malformed], [sortie(1, 32, true)], 62, 2)).toBe(null);
        malformed.battles[0].data = { api_e_maxhps: [12.5] };
        expect(maxObservedBossHp([malformed], [sortie(1, 32, true)], 62, 2)).toBe(null);
    });
});

describe('斬殺期量表 HTML', () => {
    it('斬殺期顯示可見標籤、實數與 meter ARIA', () => {
        const html = sortieGaugeBarHtml({
            now: 840,
            max: MAX_HP,
            finalPhase: true,
            title: '剩餘 840/4840',
            finalLabel: '斬殺期',
        });

        expect(html).toContain('zansatsu');
        // 標籤在量表條**之內**，不是條子外的第二顆徽章（並排會撐寬標題列導致換行）
        expect(html).toMatch(/<span class="s-gauge-bar"[\s\S]*s-gauge-final[\s\S]*<\/span>/);
        expect(html).toContain('<b class="s-gauge-final">斬殺期</b>');
        expect(html).toContain('840/4840');
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
        expect(html).not.toContain('斬殺期');
        expect(html).toContain('880/4840');
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
