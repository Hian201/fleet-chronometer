// 任務進度判定與可信度（純函式，無 chrome.*／DOM，node 可測）。
//
// 伺服器是任務是否完成的唯一依據；questlist 只給 api_state（受注中／達成）與
// api_progress_flag（任務畫面的 50%／80% 標記），不給精確次數。本機判定因此只是
// 「待伺服器確認的假設」，依條件狀態分四級：
//   verified ：有條件定義，且本機計數曾與伺服器回報的非零進度或達成一致
//   unchecked：有條件定義，尚未有可比對的伺服器結果（或比對出不一致，需重核）
//   text     ：沒有條件定義，只從官方說明文字抽出必要條件，符合者只算「候選」
//   server   ：兩者皆無，只顯示伺服器回報
//
// api_progress_flag：samples/Quest.json 已見 0 與 1（例：404 受注中 flag 1）；2 未見於樣本。
// 1＝50%、2＝80% 是任務畫面標記的對應，換算成次數時只當「推算」下限，不當精確值。

import { rankAtLeast, type BattleReason } from './quest-goals';

export type QuestTier = 'verified' | 'unchecked' | 'text' | 'server';
export type QuestRank = 'S' | 'A' | 'B';

/** 文字級判定用的一場戰鬥事實。fleet＝出擊艦隊（連合時為第一艦隊）的 master id，依編成順序；不可考時為 null。 */
export interface BattleFacts {
    ts: number;
    map: string;
    nodeLetter: string | null;
    boss: boolean;
    rank: string | undefined;
    fleet: readonly number[] | null;
}

export type JudgeReason = BattleReason;

export interface QuestJudgement {
    ts: number;
    map: string;
    nodeLetter: string | null;
    boss: boolean;
    rank: string;
    flagship: number | null;
    counted: boolean;
    /** text 級：符合文字抽出的必要條件，實際是否計入以伺服器為準。 */
    candidate?: boolean;
    /** 抵達節點（map/next）的判定，沒有評價。 */
    reach?: boolean;
    /** 演習結算的判定：沒有海域與節點。 */
    practice?: boolean;
    /** 遠征成功的判定：遠征 id，沒有海域、節點與評價。 */
    mission?: number;
    reason: JudgeReason | null;
}

export type ServerStatus = 'consistent' | 'under' | 'over';
export interface ServerObservation {
    ts: number;
    flag: number | null;
    done: boolean;
    /** 當時的本機計數；沒有條件定義時為 null。 */
    local: number | null;
    target: number | null;
    status: ServerStatus | null;
}

/**
 * 伺服器回報換算成次數範圍（推算）。達成＝target；flag 1／2 以 50%／80% 為下限。
 * 上限在未達成時為 target − 1；flag 0 時另以 50% 以下為上限。
 */
export function serverBounds(flag: number | null, done: boolean, target: number): { lo: number; hi: number } {
    if (done) return { lo: target, hi: target };
    const hi = Math.max(0, target - 1);
    if (flag === 2) return { lo: Math.min(hi, Math.ceil(target * 0.8)), hi };
    if (flag === 1) return { lo: Math.min(hi, Math.ceil(target * 0.5)), hi };
    return { lo: 0, hi: flag === 0 ? Math.min(hi, Math.max(0, Math.ceil(target * 0.5) - 1)) : hi };
}

/**
 * 本機計數與伺服器回報的關係。多海域目標的百分比算法未經封包驗證，
 * 故只有單一目標的任務以 flag 判定「本機多算」；本機已滿而伺服器未達成則一律視為多算。
 */
export function compareWithServer(
    local: number, target: number, flag: number | null, done: boolean, singleTarget: boolean,
): ServerStatus {
    const bounds = serverBounds(flag, done, target);
    if (local < bounds.lo) return 'under';
    if (!done && local >= target) return 'over';
    if (singleTarget && local > bounds.hi) return 'over';
    return 'consistent';
}

/** 本機計數曾在伺服器回報非零進度或達成時一致，才算驗證過。 */
export function isVerified(observations: readonly ServerObservation[]): boolean {
    return observations.some(obs => obs.status === 'consistent' && (obs.local ?? 0) > 0 && (obs.done || (obs.flag ?? 0) >= 1));
}

/** 最近一次伺服器回報與本機不一致（本機多算）時，條件定義需重核。 */
export function needsRecheck(observations: readonly ServerObservation[]): boolean {
    return observations.at(-1)?.status === 'over';
}

export function questTier(hasDefinition: boolean, hasTextRule: boolean, observations: readonly ServerObservation[]): QuestTier {
    if (hasDefinition) return isVerified(observations) && !needsRecheck(observations) ? 'verified' : 'unchecked';
    return hasTextRule ? 'text' : 'server';
}

/** 伺服器下限高於本機計數時（受注前進度或未觀測的戰鬥），顯示推算範圍。 */
export function progressRange(local: number, target: number, latest: ServerObservation | undefined): { lo: number; hi: number } | null {
    if (!latest || latest.status !== 'under') return null;
    const bounds = serverBounds(latest.flag, latest.done, target);
    return bounds.lo === bounds.hi ? null : { lo: Math.max(local, bounds.lo), hi: bounds.hi };
}

// ── 文字級：只從官方說明文字抽出必要條件 ──────────────────────────────

export interface TextRule {
    flagship: readonly number[] | null;
    maps: readonly string[];
    bossOnly: boolean;
    minRank: QuestRank | null;
}

/** 任務文字偶有把長音「ー」誤植成漢字「一」（例：1047 的「サ一モン」）；只在片假名之後修正。 */
function normalizeQuestText(text: string): string {
    return text.normalize('NFKC').replace(/(?<=[゠-ヿ])一/g, 'ー');
}

/**
 * 任務文字以大區名稱指稱整個海域群；對應依遊戲的海域編號（南西海域是 7-X，不是南西諸島的 2-X）。
 * 比對時先用單一海域名稱（較長、較精確），剩下的文字才用大區名稱。
 */
export const QUEST_AREA_NAMES: readonly (readonly [string, number])[] = [
    ['鎮守府海域', 1], ['南西諸島海域', 2], ['北方海域', 3], ['西方海域', 4],
    ['南方海域', 5], ['中部海域', 6], ['南西海域', 7],
];

/**
 * 抽出條件：海域先以 start2 的海域名稱（api_mst_mapinfo.api_name）比對，長名稱優先，
 * 再以 QUEST_AREA_NAMES 的大區名稱比對（展開成該區的所有海域）；
 * 旗艦只認「艦名」緊接「旗艦」且艦名與 master 完全相同者；「最深部」「ボス」視為限定 Boss；
 * 「S勝利」「A勝利」為勝利門檻。沒有抽到任何海域時不建立規則。
 */
export function extractTextRule(
    detail: string,
    mapNames: ReadonlyMap<string, string>,
    shipIdsByName: ReadonlyMap<string, readonly number[]>,
): TextRule | null {
    let text = normalizeQuestText(detail);
    const maps: string[] = [];
    const names = [...mapNames.entries()].filter(([, name]) => name.length >= 2).sort((a, b) => b[1].length - a[1].length);
    for (const [map, name] of names) {
        const key = normalizeQuestText(name);
        if (!text.includes(key)) continue;
        maps.push(map);
        text = text.split(key).join('\u0000');
    }
    for (const [name, area] of QUEST_AREA_NAMES) {
        if (!text.includes(name)) continue;
        for (const map of mapNames.keys()) if (map.startsWith(`${area}-`) && !maps.includes(map)) maps.push(map);
        text = text.split(name).join('\u0000');
    }
    if (!maps.length) return null;
    const flagshipName = normalizeQuestText(detail).match(/「([^」/]+)(?:\/[^」]*)?」\s*旗艦/)?.[1];
    const flagship = flagshipName ? shipIdsByName.get(flagshipName) ?? null : null;
    const plain = normalizeQuestText(detail);
    const minRank: QuestRank | null = /S勝利/.test(plain) ? 'S' : /A勝利/.test(plain) ? 'A' : null;
    return { flagship, maps: maps.sort(), bossOnly: /最深部|ボス/.test(plain), minRank };
}

/** 文字級判定：不在抽出海域的戰鬥不記錄；符合全部抽出條件者為候選。 */
export function judgeTextBattle(rule: TextRule, facts: BattleFacts): QuestJudgement | null {
    if (!rule.maps.includes(facts.map)) return null;
    const base = {
        ts: facts.ts, map: facts.map, nodeLetter: facts.nodeLetter, boss: facts.boss,
        rank: facts.rank ?? '', flagship: facts.fleet?.[0] ?? null, counted: false,
    };
    if (rule.flagship && !facts.fleet) return { ...base, reason: 'fleetUnknown' };
    const flagship = facts.fleet?.[0];
    if (rule.flagship && (flagship === undefined || !rule.flagship.includes(flagship))) return { ...base, reason: 'flagship' };
    if (rule.bossOnly && !facts.boss) return { ...base, reason: 'notBoss' };
    if (rule.minRank && !rankAtLeast(facts.rank, rule.minRank)) return { ...base, reason: 'rank' };
    return { ...base, candidate: true, reason: null };
}

/** 判定紀錄的時間一律帶年月日（本機時區），例：2026-09-28 21:32。 */
export function formatQuestTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
