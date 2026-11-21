// 遠征紀錄的離線預覽：合成紀錄涵蓋四種資材、三種家具箱、伊良湖及未知編號，不連遊戲。
// npx vite-node --config vitest.config.ts tools/preview/exped-log.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { COLUMNS, defaultPlanPrefs, planResultHtml, planShellHtml, routeOf, summaryHtml, tableHtml } from '../../entrypoints/overview/sections/exped-log';
import { summarize } from '../../utils/expedition-stats';
import { DEFAULT_CHOSEN, planExpeditions, resourceNeeds, type PlanKey, type PlanMission, type ResourceNeed } from '../../utils/expedition-plan';
import { STOCKPILE_KEYS, stockpileCap } from '../../utils/stockpile';
import type { ExpeditionRow } from '../../utils/db';
import { setLang } from '../../utils/ui-i18n';
// 離線預覽也要顯示艦名與介面文案：安裝 state.ts 的顯示命名（見 utils/state-format.ts）。
import '../../utils/state-display';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(resolve(root, 'entrypoints/overview/index.html'), 'utf8');
const css = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
const rows = [1, 2, 3, 4, 10, 11, 12, 59, 99999].map((id, i) => ({
    eventId: i + 1, ts: 1794733200000 - i * 3600000, deckId: 2, missionId: 5,
    name: '海上護衛任務', result: 1, resources: [200, 200, 20, 20],
    items: [{ id, count: i + 1 }, { id: id === 10 ? 3 : 10, count: 2 }],
}));

// 建議區：兩種狀態（有流量、預設勾選＋改修資材、有期限／沒有流量、只勾鋁土與高速修復材），
// 紀錄涵蓋常跑（≥ MIN_RUNS）、少跑與沒跑過（以固定報酬推算）的遠征及月常。
const mission = (id: number, dispNo: string, name: string, time: number, winItems: [number, number][], use: [number, number], resetType = 0): PlanMission =>
    ({ id, dispNo, name, time, resetType, winItems, use });
const missions: PlanMission[] = [
    mission(2, '02', '長距離練習航海', 30, [[1, 1], [0, 0]], [0.5, 0]),
    mission(5, '05', '海上護衛任務', 90, [[0, 0], [0, 0]], [0.5, 0]),
    mission(6, '06', '防空射撃演習', 40, [[10, 1], [0, 0]], [0.3, 0.2]),
    mission(11, '11', 'ボーキサイト輸送任務', 300, [[10, 1], [1, 1]], [0.5, 0]),
    mission(9, '09', 'タンカー護衛任務', 240, [[10, 1], [1, 2]], [0.5, 0]),
    mission(24, '24', '北方航路海上護衛', 500, [[3, 2], [1, 1]], [0.9, 0.6]),
    mission(40, '40', '水上機前線輸送', 410, [[10, 3], [1, 1]], [0.8, 0.7]),
    mission(37, '37', '東京急行', 165, [[10, 1], [0, 0]], [0.8, 0.8]),
    mission(45, '45', 'ボーキサイト船団護衛', 200, [[11, 1], [0, 0]], [0.6, 0.4]),
    mission(101, 'A2', '海峡警備行動', 55, [[3, 1], [1, 1]], [0.5, 0.2]),
    mission(110, 'B1', '南西方面航空偵察作戦', 35, [[10, 1], [1, 1]], [0.45, 0.15]),
    mission(42, '42', '強行輸送艦隊、抜錨！', 90, [[0, 0], [0, 0]], [0.5, 0.5], 1),
    mission(43, '43', '兵站強化任務', 120, [[0, 0], [0, 0]], [0.5, 0.5], 1),
];
// NEW 起的紀錄有道具標記，OLD 是沒有標記的舊紀錄。
const NEW = Date.parse('2026-11-15T03:00:00Z'), OLD = NEW - 86400000;
const fleet = [{ name: '睦月', level: 80 }, { name: '如月', level: 80 }, { name: '弥生', level: 80 }, { name: '卯月', level: 80 }];
const shipMax = new Map(fleet.map(ship => [ship.name, [15, 15] as const]));
const run = (missionId: number, ts: number, result: number, resources: number[], items: ExpeditionRow['items'] = []): ExpeditionRow =>
    ({ eventId: ts + missionId, ts, deckId: 2, missionId, name: missions.find(m => m.id === missionId)!.name, result, resources, items, fleet, ...(ts >= NEW ? { flagItems: true } : {}) });
const many = (n: number, f: (i: number) => ExpeditionRow) => Array.from({ length: n }, (_, i) => f(i));
const records: ExpeditionRow[] = [
    ...many(12, i => run(5, NEW + i, 2, [360, 360, 36, 36])),
    ...many(12, i => run(6, NEW + i, 2, [0, 0, 0, 144])),
    ...many(12, i => run(11, NEW + i, 2, [0, 0, 0, 450], [{ id: 1, count: 1 }])),
    ...many(12, i => run(37, OLD + i, 2, [0, 684, 486, 0])),
    run(101, OLD, 2, [126, 72, 0, 18]),
    run(42, NEW - 86400000 * 12, 1, [0, 0, 0, 0], [{ id: 4, count: 1 }]), run(43, NEW, 0, [0, 0, 0, 0]),
];
const flow = { fromTs: NEW - 86400000 * 28, toTs: NEW + 86400000, weeks: 4, rates: {
    fuel: { low: -2000, high: 800, mean: -600 }, ammo: { low: -4000, high: 0, mean: -2000 },
    steel: { low: -1000, high: 500, mean: -300 }, bauxite: { low: -800, high: 600, mean: -50 },
    drum: { low: 0, high: 20, mean: 2 },
    torch: { low: 0, high: 3, mean: 1.5 }, devmat: { low: -20, high: 6, mean: -10 }, screw: { low: 0, high: 1, mean: 0.5 },
} };
const stock = { fuel: 257000, ammo: 217000, steel: 279000, bauxite: 166000, drum: 1692, torch: 972, devmat: 383, screw: 67 };
const caps = Object.fromEntries(STOCKPILE_KEYS.map(key => [key, stockpileCap(key)])) as Record<PlanKey, number>;
const planHtml = (withFlow: boolean) => {
    const chosen: PlanKey[] = withFlow ? [...DEFAULT_CHOSEN, 'screw'] : ['bauxite', 'drum'];
    const needs = resourceNeeds(chosen, stock, caps, withFlow ? flow : null, records, missions, shipMax);
    const plan = planExpeditions({ missions, records, intervalMinutes: 60, sleepMinutes: withFlow ? 420 : 0, needs, horizonDays: withFlow ? 44 : 28, untilFull: !withFlow, shipMax });
    return planShellHtml({ ...defaultPlanPrefs(), chosen, hours: 1, sleep: withFlow ? 7 : 0 },
        planResultHtml({ plan, chosen: needs.map(need => need.key), hasMaster: true, noFlow: !withFlow, deadline: withFlow ? '2026-12-31' : null }))
        .replaceAll('<details class="el-plan-all" data-part', '<details class="el-plan-all" open data-part');
};

// 多階段情境：真實主檔、收 2 小時、睡 8 小時、五項資材 15 萬／2000、輕支出、大成功 30%＋大發 1.2，
// 第二～第四艦隊正在跑 D1／13／38。計算約數秒，只算一次，三語共用。
const master = JSON.parse(readFileSync(resolve(root, 'samples/start2-master.json'), 'utf8'));
const masterMissions: PlanMission[] = ((master.api_data ?? master).api_mst_mission as Record<string, number | string>[]).map(m => ({
    id: m.api_id as number, dispNo: m.api_disp_no as string, name: m.api_name as string, time: m.api_time as number, resetType: m.api_reset_type as number,
    winItems: [m.api_win_item1, m.api_win_item2] as unknown as [number, number][], use: [m.api_use_fuel, m.api_use_bull] as unknown as [number, number],
}));
const phaseRecords: ExpeditionRow[] = Array.from({ length: 10 }, (_, i) => ({
    eventId: i + 1, ts: 1_700_000_000_000 + i, deckId: 2, missionId: 1, name: 'x', result: i < 3 ? 2 : 1,
    resources: [0, Math.round(30 * (i < 3 ? 1.5 : 1) * 1.2), 0, 0], items: [], fleet: [{ name: 'DD', level: 80 }, { name: 'DD', level: 80 }],
}));
const phaseKeys: PlanKey[] = ['fuel', 'ammo', 'steel', 'bauxite', 'drum'];
const phaseSpend = { fuel: -1500, ammo: -1200, steel: -600, bauxite: -400, drum: -5 };
const phaseNeeds: ResourceNeed[] = phaseKeys.map(key => ({ key, have: key === 'drum' ? 2000 : 150000, cap: stockpileCap(key), base: phaseSpend[key as keyof typeof phaseSpend], current: null }));
const idOf = (dispNo: string) => masterMissions.find(m => m.dispNo === dispNo)!.id;
const phasePlan = planExpeditions({
    missions: masterMissions, records: phaseRecords, shipMax: new Map([['DD', [15, 20] as const]]), intervalMinutes: 120, sleepMinutes: 480,
    needs: phaseNeeds, horizonDays: 28, untilFull: true,
    running: [{ deck: 1, missionId: idOf('D1') }, { deck: 2, missionId: idOf('13') }, { deck: 3, missionId: idOf('38') }],
});
// 沿用路線情境：玩家照第一段跑完（存量推進到第一段結束、第一段的三隊還在跑），帶上次的路線重開，目前在第 2 階段。
const firstSegment = phasePlan.phases!.segments[0];
const keptPlan = planExpeditions({
    missions: masterMissions, records: phaseRecords, shipMax: new Map([['DD', [15, 20] as const]]), intervalMinutes: 120, sleepMinutes: 480,
    needs: phaseNeeds.map(need => ({ ...need, have: firstSegment.end[need.key] ?? need.have })), horizonDays: 28, untilFull: true,
    running: firstSegment.fleets.flatMap((fleet, i) => (fleet.day ?? fleet.night ? [{ deck: fleet.deck ?? i + 1, missionId: (fleet.day ?? fleet.night)!.missionId }] : [])),
    route: routeOf(phasePlan),
});
const planPage = (plan: typeof phasePlan) => planShellHtml({ ...defaultPlanPrefs(), chosen: phaseKeys, hours: 2, sleep: 8 },
    planResultHtml({ plan, chosen: phaseKeys, hasMaster: true, noFlow: false, deadline: null }))
    .replaceAll('<details class="el-plan-all" data-part', '<details class="el-plan-all" open data-part');
const phaseHtml = () => planPage(phasePlan) + planPage(keptPlan);
const describePhase = (plan: typeof phasePlan) => (plan.phases
    ? `${plan.phases.segments.length} 段、階段 ${plan.phases.stage.join(',')}／${plan.phases.stageCount}、沿用路線 ${plan.phases.routeKept}、${plan.phases.days.toFixed(1)} 天` : '沒有採用多階段');
console.log(`多階段情境：${describePhase(phasePlan)}\n沿用路線情境：${describePhase(keptPlan)}`);

mkdirSync(resolve(root, '.preview'), { recursive: true });
for (const lang of ['zh-TW', 'en', 'ja'] as const) {
    setLang(lang);
    for (const theme of ['dark', 'light']) {
        const page = `<!doctype html><html lang="${lang}" data-theme="${theme}"><meta charset="utf-8">
<title>遠征紀錄預覽</title><style>${css}</style><body style="display:block"><div style="padding:20px;min-width:0">
${phaseHtml()}${planHtml(true)}${planHtml(false)}
${summaryHtml(summarize(rows), null, null, rows)}${tableHtml(rows, COLUMNS.filter(c => c.on))}
</div></body></html>`.replaceAll('src="/icons/', 'src="/public/icons/');
        writeFileSync(resolve(root, `.preview/exped-log-${lang}-${theme}.html`), page);
    }
}
