// 遠征組合建議與社群推薦的交叉驗證。
// 基準：zh.kcwiki.cn「远征推荐组合」（開發者整理成筆記的版本，查證日 2026-11-17）。
// 社群表的前提：全部大成功、不含大發加成；在線時回來就收（這裡以每 5 分鐘收一次近似），睡覺／維護時依分頁標的時數收。
// 資材都從 0 開始、沒有其他增減，只看遠征本身。主檔用真封包 samples/start2-master.json。
//
// 筆記與 wikiwiki.jp/kancolle「遠征」原始頁面、主檔不一致的地方以後兩者為準（下方測試寫明），
// 包括 7／8／10／16 的大成功道具是高速建造材（主檔 api_win_item），不是高速修復材或開發資材。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExpeditionRow } from '../utils/db';
import { GameState } from '../utils/state';
import { planExpeditions, type PlanKey, type PlanMission, type PlanRow, type ResourceNeed } from '../utils/expedition-plan';
import EXPEDITION_DATA from '../utils/expedition-data';
import { stockpileCap } from '../utils/stockpile';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const state = new GameState();
state.applyEvent('api_start2/getData', master.api_data ?? master);
const missions: PlanMission[] = [...state.masterMissions].map(([id, m]) =>
    ({ id, dispNo: m.dispNo, name: m.name, time: m.time, resetType: m.resetType, winItems: m.winItems, use: m.use }));
const idOf = (code: string) => missions.find(m => m.dispNo.replace(/^0/, '') === code)!.id;
const codeOf = (id: number) => missions.find(m => m.id === id)!.dispNo.replace(/^0/, '');

// 全部大成功：一筆不屬於任何遠征的大成功紀錄，讓玩家的大成功比例為 100%、大發加成水準為 1。
// 補給以一般驅逐艦燃彈上限 15／15 換算（沒跑過的遠征 × 最低編成艘數）。
const records: ExpeditionRow[] = [{ eventId: 1, ts: 0, deckId: 2, missionId: 99999, name: '', result: 2, resources: [0, 0, 0, 0], items: [], fleet: [{ name: 'DD', level: 1 }] }];
const shipMax = new Map([['DD', [15, 15] as const]]);
const need = (key: PlanKey): ResourceNeed => ({ key, have: 0, cap: stockpileCap(key), base: 0, current: 0 });
const run = (chosen: PlanKey[], intervalMinutes: number) =>
    planExpeditions({ missions, records, intervalMinutes, needs: chosen.map(need), horizonDays: 30, shipMax });
const ONLINE = 5;

describe('遠征資料與社群表一致', () => {
    // 社群表的單趟報酬（燃彈鋼鋁，非大成功）與耗時。
    const COMMUNITY: Record<string, [number, number, number, number, string]> = {
        2: [0, 100, 30, 0, '00:30'], 3: [30, 30, 40, 0, '00:20'], 4: [0, 60, 0, 0, '00:50'], 5: [200, 200, 20, 20, '01:30'],
        6: [0, 0, 0, 80, '00:40'], 9: [350, 0, 0, 0, '04:00'], 10: [0, 50, 0, 30, '01:30'], 11: [0, 0, 0, 250, '05:00'],
        13: [240, 300, 0, 0, '04:00'], 15: [0, 0, 300, 400, '12:00'], 16: [500, 500, 200, 200, '15:00'], 18: [0, 0, 300, 100, '05:00'],
        21: [320, 270, 0, 0, '02:20'], 23: [0, 20, 0, 100, '04:00'], 24: [500, 0, 0, 150, '08:20'], 25: [900, 0, 500, 0, '40:00'],
        26: [0, 0, 0, 900, '80:00'], 28: [0, 0, 900, 350, '25:00'], 32: [50, 50, 50, 50, '24:00'], 35: [0, 0, 240, 280, '07:00'],
        36: [480, 0, 200, 200, '09:00'], 37: [0, 380, 270, 0, '02:45'], 38: [420, 0, 200, 0, '02:55'], 40: [300, 300, 0, 100, '06:50'],
        41: [100, 0, 0, 20, '01:00'], 42: [800, 0, 0, 200, '08:00'], 45: [40, 0, 0, 220, '03:20'], A2: [70, 40, 0, 10, '00:55'],
        A3: [120, 0, 60, 60, '02:15'], A4: [80, 120, 0, 100, '01:50'], B1: [0, 0, 10, 30, '00:35'],
        // 筆記有誤、以 wikiwiki「遠征」原始頁面為準：7 觀艦式予行（筆記欄位錯位）、8 觀艦式（筆記兩分頁彈藥 50／100 互相矛盾）、22 艦隊演習（筆記 30）。
        7: [0, 0, 50, 30, '01:00'], 8: [50, 100, 50, 50, '03:00'], 22: [0, 10, 0, 0, '03:00'],
    };

    it.each(Object.entries(COMMUNITY))('%s 的固定報酬與耗時', (code, [fuel, ammo, steel, bauxite, time]) => {
        const id = idOf(code);
        const entry = EXPEDITION_DATA.find(e => e.id === id)!;
        expect([entry.reward_fuel, entry.reward_bullet, entry.reward_steel, entry.reward_alum]).toEqual([fuel, ammo, steel, bauxite]);
        const [h, m] = time.split(':').map(Number);
        expect(missions.find(mission => mission.id === id)!.time).toBe(h * 60 + m);
    });

    it('月常：A4、42 不能連跑（社群表列在一般組合裡，算法不排入）', () => {
        expect(missions.find(m => m.id === idOf('A4'))!.resetType).toBe(1);
        expect(missions.find(m => m.id === idOf('42'))!.resetType).toBe(1);
    });
});

describe('單一資材最大化：與社群推薦一致', () => {
    const CASES: [string, PlanKey, number, string[]][] = [
        ['油最大化', 'fuel', ONLINE, ['5', '21', '38']],
        ['彈最大化', 'ammo', ONLINE, ['2', '5', '37']],
        ['鋁最大化', 'bauxite', ONLINE, ['6', '45', 'B1']],
        ['水桶最大化（社群列四條，取每日最多的三條）', 'drum', ONLINE, ['2', 'A2', 'B1']],
        ['火槍（高速建造材）最大化（A4 為月常不列入）', 'torch', ONLINE, ['7', '8', '10']],
        ['4hr 油最大化', 'fuel', 240, ['21', '38', '9']],
        ['5hr 鋼最大化', 'steel', 300, ['37', '38', '18']],
        ['7hr 彈最大化', 'ammo', 420, ['13', '37', '40']],
        ['7hr 鋁最大化', 'bauxite', 420, ['45', '11', '35']],
        ['9hr 油最大化', 'fuel', 540, ['38', '24', '36']],
    ];
    it.each(CASES)('%s', (_name, key, interval, expected) => {
        expect(run([key], interval).top.map(row => codeOf(row.missionId)).sort()).toEqual([...expected].sort());
    });

    it('每小時收一次只要水桶：B1、A2、41（三條都是大成功必出 1 桶）', () => {
        expect(run(['drum'], 60).top.map(row => codeOf(row.missionId)).sort()).toEqual(['41', 'A2', 'B1']);
    });
});

/** 一組遠征在勾選資材上的每日淨收入。 */
const perDayOf = (rows: PlanRow[], codes: string[], key: PlanKey) =>
    codes.reduce((sum, code) => sum + (rows.find(row => row.missionId === idOf(code))?.perDay[key] ?? 0), 0);

describe('與社群推薦不同、但依同一目標不比社群差', () => {
    it('鋼最大化：20 潜水艦哨戒任務（每小時 75）勝過 38（69），社群表沒列 20', () => {
        const plan = run(['steel'], ONLINE);
        expect(plan.top.map(row => codeOf(row.missionId)).sort()).toEqual(['20', '3', '37']);
        expect(perDayOf(plan.candidates, ['3', '37', '20'], 'steel')).toBeGreaterThan(perDayOf(plan.candidates, ['3', '37', '38'], 'steel'));
    });

    it('開發資材最大化：41 每趟 0～1 個、一小時一趟，勝過 8 的大成功限定 1 個、三小時一趟', () => {
        const plan = run(['devmat'], ONLINE);
        expect(plan.top.map(row => codeOf(row.missionId)).sort()).toEqual(['41', 'A2', 'A3']);
        expect(perDayOf(plan.candidates, ['41'], 'devmat')).toBeGreaterThan(perDayOf(plan.candidates, ['8'], 'devmat'));
    });

    // 綜合類：社群表追求總量並預設某些資材充足（如「鋼通常處於很安全的線上」），這裡資材都從 0 開始，
    // 目標是勾選資材中最缺的一項最多；只驗證算法的組合在這個目標下不比社群組合差。
    const MIXED: [string, PlanKey[], number, string[]][] = [
        ['3hr 油彈鋼', ['fuel', 'ammo', 'steel'], 180, ['21', '37', '38']],
        ['3hr 20min 油彈鋁', ['fuel', 'ammo', 'bauxite'], 200, ['5', '21', '45']],
        ['9hr 綜合', ['fuel', 'ammo', 'steel', 'bauxite'], 540, ['40', '35', '36']],
        ['12hr 綜合（維修）', ['fuel', 'steel', 'bauxite'], 720, ['35', '36', '15']],
    ];
    it.each(MIXED)('%s', (_name, chosen, interval, community) => {
        const plan = run(chosen, interval);
        const ours = plan.top.map(row => codeOf(row.missionId));
        const lowest = (codes: string[]) => Math.min(...chosen.map(key => perDayOf(plan.candidates, codes, key) / stockpileCap(key)));
        expect(lowest(ours)).toBeGreaterThanOrEqual(lowest(community));
    });
});

describe('睡前組合：與社群的睡覺／維修分頁一致', () => {
    // 在線時回來就收，睡前三隊各派一條；社群分頁的時數＝離開時間。
    const CASES: [string, PlanKey, number, string[]][] = [
        ['4hr 油最大化', 'fuel', 240, ['21', '38', '9']],
        ['9hr 油最大化', 'fuel', 540, ['38', '24', '36']],
    ];
    it.each(CASES)('%s', (_name, key, sleep, expected) => {
        const plan = planExpeditions({ missions, records, intervalMinutes: ONLINE, sleepMinutes: sleep, needs: [need(key)], horizonDays: 30, shipMax });
        expect(plan.sleep.map(row => codeOf(row.missionId)).sort()).toEqual([...expected].sort());
    });
});
