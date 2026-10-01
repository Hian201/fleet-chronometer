// 本機條件（utils/quest-goal-local.ts）與來源條件表的比對報告。
//
//   npx vite-node --config vitest.config.ts tools/quest-goal/compare.ts           # 與目前固定版本比對（不連網）
//   npx vite-node --config vitest.config.ts tools/quest-goal/compare.ts --latest  # 抓來源最新版比對（1 個請求）
//
// --latest 時，遠征名稱依 samples/start2-master.json 換成遠征 id，規則與 generate.py 相同。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUEST_GOAL_RAW, QUEST_GOAL_SOURCE } from '../../utils/quest-goal-data';
import { QUEST_GOAL_LOCAL } from '../../utils/quest-goal-local';
import { localQuestGoalDef, parseGoalDef } from '../../utils/quest-goals';
import { compareGoalDefs } from '../../utils/quest-goal-compare';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LATEST_URL = 'https://raw.githubusercontent.com/poooi/poi/master/assets/data/fcd/questgoal.json';

function missionTable(): Map<string, number[]> {
    const text = readFileSync(resolve(root, 'samples/start2-master.json'), 'utf8');
    const data = JSON.parse(text.slice(text.indexOf('{')));
    const table = new Map<string, number[]>();
    for (const mission of (data.api_data ?? data).api_mst_mission) {
        const key = normalize(mission.api_name);
        table.set(key, [...(table.get(key) ?? []), mission.api_id]);
    }
    return table;
}

const normalize = (name: string) => name.normalize('NFKC').replace(/[ 　]/g, '');

function convertMissions(data: Record<string, Record<string, unknown>>): void {
    const table = missionTable();
    for (const quest of Object.values(data)) {
        for (const value of Object.values(quest)) {
            if (!value || typeof value !== 'object' || !('mission' in value)) continue;
            const sub = value as Record<string, unknown>;
            const ids = (sub.mission as string[]).map(name => table.get(normalize(name)) ?? []);
            if (ids.every(match => match.length === 1)) {
                sub.missionId = ids.map(match => match[0]);
                delete sub.mission;
            }
        }
    }
}

async function source(): Promise<{ label: string; data: Record<string, Record<string, unknown>> }> {
    if (!process.argv.includes('--latest')) {
        return { label: `固定版本 ${QUEST_GOAL_SOURCE.commit.slice(0, 12)}（${QUEST_GOAL_SOURCE.version}）`, data: QUEST_GOAL_RAW };
    }
    const response = await fetch(LATEST_URL);
    if (!response.ok) throw new Error(`抓取失敗：HTTP ${response.status}`);
    const payload = JSON.parse((await response.text()).replace(/^﻿/, ''));
    const data = payload.data as Record<string, Record<string, unknown>>;
    convertMissions(data);
    return { label: `最新版（${payload.meta?.version ?? '版本不明'}）`, data };
}

const { label, data } = await source();
const entries = Object.entries(QUEST_GOAL_LOCAL).sort(([a], [b]) => Number(a) - Number(b));
console.log(`本機條件 ${entries.length} 筆，對照來源：${label}\n`);
const summary = { same: 0, different: 0, sourceMissing: 0 };
for (const [key, local] of entries) {
    const no = Number(key);
    const raw = data[key];
    const result = compareGoalDefs(localQuestGoalDef(no)!, raw ? parseGoalDef(no, raw) : null);
    summary[result.status]++;
    const head = `${no} ${local.title}（${local.written}）`;
    if (result.status === 'same') { console.log(`✓ 一致　${head}：可刪除本機這筆`); continue; }
    if (result.status === 'sourceMissing') { console.log(`… 來源未收錄　${head}`); continue; }
    console.log(`✗ 有差異　${head}`);
    if (result.countMismatch) console.log(`    子目標數不同：本機 ${localQuestGoalDef(no)!.subgoals.length}、來源 ${parseGoalDef(no, raw).subgoals.length}`);
    if (result.resetInterval) console.log(`    resetInterval：本機 ${result.resetInterval.local}、來源 ${result.resetInterval.source}`);
    for (const diff of result.diffs) {
        console.log(`    子目標 ${diff.subgoal + 1} ${diff.field}：本機 ${JSON.stringify(diff.local)}、來源 ${JSON.stringify(diff.source)}`);
    }
}
console.log(`\n一致 ${summary.same}、有差異 ${summary.different}、來源未收錄 ${summary.sourceMissing}`);
