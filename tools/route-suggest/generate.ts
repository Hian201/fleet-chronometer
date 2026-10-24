// 常規導航「到王編成參考」產生器：ぜかまし各海域「ルート固定」的編成例 → utils/route-suggestions.ts（產生物，勿手改）。
//
//   python3 tools/route-suggest/zekamashi.py          # 先抓頁面並切成區塊（快取於 .cache/）
//   npx vite-node --config vitest.config.ts tools/route-suggest/generate.ts [--report]
//
// 每個區塊＝一組或多組編成例＋路線【…】(各點性質)＋※需求。這裡只取事實（艦種、數量、路線字母、
// 各點性質、航速／索敵／裝備需求數值），不收錄文章文字。
//
// 另用判定器（utils/route-predict.ts）把每組編成實際跑一次：預測航路落在該區塊列出的路線內＝一致。
// 不一致的組合列在 --report 輸出，供核對 wiki 分岐法則的轉寫；產生物只標示一致與否，不改內容。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_SPOTS } from '../../utils/map-spots';
import { ROUTE_RULES } from '../../utils/route-rules-data';
import { SHIP_SETS, goalsOf, predictRoutes, type GearKind, type RoutePath, type ShipSet } from '../../utils/route-predict';
import {
    expandSuggestRoute, rulesFingerprint, suggestionFleet,
    type SuggestBlock, type SuggestComp, type SuggestPart, type SuggestReqs, type SuggestShip,
} from '../../utils/route-suggest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(root, 'utils/route-suggestions.ts');
const RAW = resolve(root, 'tools/route-suggest/.cache/zekamashi.json');
const REPORT = process.argv.includes('--report');

// ── 編成用語 → 鍵 ─────────────────────────────────────────────────
// 鍵是 ShipGroup（route-predict.ts）、SHIP_SETS 的指定艦，或 FREE（自由枠）／CRUISER（巡洋艦）。
const TERMS: Record<string, string> = {
    '駆逐': 'DD', '軽巡': 'CL', '重巡': 'CA', '航巡': 'CAV', '重巡級': 'CAclass', '軽巡級': 'CLclass', '雷巡': 'CLT', '練巡': 'CT',
    '戦艦': 'BB', '低戦': 'SBB', '高戦': 'FBB', '航戦': 'BBV', '戦艦級': 'BBclass',
    '空母': 'CVclass', '正空': 'CV', '軽空': 'CVL', '軽母': 'CVL', '装空': 'CV',
    '水母': 'AV', '揚陸': 'LHA', '潜水': 'SS', '潜母': 'AS', '補給': 'AO', '海防': 'DE',
    '自由': 'FREE', '巡洋艦': 'CRUISER',
};
const NAMES: [string, ShipSet][] = [
    ['長門改二', 'nagatoKai2'], ['陸奥改二', 'mutsuKai2'], ['翔鶴', 'shoukaku'], ['瑞鶴', 'zuikaku'], ['夕張', 'yuubari'],
    ['祥鳳', 'shouhou'], ['羽黒', 'haguro'], ['神風', 'kamikaze'], ['足柄', 'ashigara'], ['妙高', 'myoukou'], ['高雄', 'takao'],
    ['秋津洲', 'akitsushima'], ['如月', 'kisaragi'], ['あきつ丸', 'akitsuMaru'], ['大鷹型', 'taiyouClass'],
];

/** 「翔鶴瑞鶴駆逐2自由2」「●戦艦2軽巡1」「(駆逐+海防)2」「軽巡0-2」→ 各部分。 */
function parseComp(text: string): SuggestComp | null {
    const parts: SuggestPart[] = [];
    let rest = text.replace(/[～~]/g, '-');
    while (rest.length) {
        let flag = false;
        if (rest.startsWith('●')) { flag = true; rest = rest.slice(1); }
        const named = NAMES.find(([jp]) => rest.startsWith(jp));
        if (named) {
            rest = rest.slice(named[0].length);
            const m = rest.match(/^(\d)(?:-(\d))?/);
            const n = m ? Number(m[1]) : 1;
            if (m) rest = rest.slice(m[0].length);
            parts.push({ keys: [named[1]], n, ...(m?.[2] ? { max: Number(m[2]) } : {}), ...(flag ? { flag } : {}) });
            continue;
        }
        const m = rest.match(/^(\(([^()]+)\)|[^\d()]+?)(\d)(?:-(\d))?/);
        if (!m) return null;
        const words = m[2] ? m[2].split(/\+|or/) : [m[1]];
        let etc = false;
        const keys = words.map((w) => {
            let word = w.trim();
            if (word.endsWith('他')) { etc = true; word = word.slice(0, -1); }
            return TERMS[word] ?? NAMES.find(([jp]) => jp === word)?.[1];
        });
        if (keys.some((k) => !k)) return null;
        parts.push({
            keys: keys as string[], n: Number(m[3]),
            ...(m[4] ? { max: Number(m[4]) } : {}), ...(etc ? { etc } : {}), ...(flag ? { flag } : {}),
        });
        rest = rest.slice(m[0].length);
    }
    return parts.length ? { parts } : null;
}

// ── ※需求 ─────────────────────────────────────────────────────────
function parseReqs(notes: string[]): SuggestReqs {
    const text = notes.join(' ');
    const reqs: SuggestReqs = {};
    if (/最速統一/.test(text)) reqs.speed = 'fastest';
    else if (/高速\+(?:以上)?統一/.test(text)) reqs.speed = 'fastPlus';
    else if (/高速(?:以上)?統一/.test(text)) reqs.speed = 'fast';
    if (/要低速艦|低速艦を含|高速化不可/.test(text)) reqs.slow = true;
    // 「係数4で索敵値58以上」「索敵値33式分岐点係数2で66以上」兩種語序
    const los = [...text.matchAll(/係数\D{0,3}(\d)\D{0,10}?(?:索敵(?:値|スコア)?)?\D{0,3}?(\d+)([?？])?\s*(?:\([^)]*\))?以上/g)];
    if (los.length) reqs.los = los.map((m) => ({ cn: Number(m[1]), min: Number(m[2]), ...(m[3] ? { approx: true } : {}) }));
    // 取第一個有值的擷取群組（替代寫法各有自己的群組）
    const gear = (re: RegExp) => { const n = text.match(re)?.slice(1).find((x) => x !== undefined); return n ? Number(n) : undefined; };
    const drum = gear(/(\d)隻にドラム缶|ドラム缶[^。]{0,12}?(\d)隻/);
    // 「電探を1以上装備すること」才是需求；「電探1以上の装備でG→Fの確率が35%」只是說明
    const radar = gear(/電探を(\d)(?:隻|個)?以上/) ?? gear(/電探[^。]{0,8}?(\d)隻/);
    const daihatsu = gear(/大発[^。]{0,12}?(\d)隻/);
    const g: Partial<Record<GearKind, number>> = {};
    if (drum) g.drum = drum;
    if (radar) g.radar = radar;
    if (daihatsu) g.daihatsu = daihatsu;
    if (Object.keys(g).length) reqs.gear = g;
    // 「ドラム缶を4隻に装備するか、大発動艇系を4隻に装備」：二選一
    if (Object.keys(g).length > 1 && /装備するか/.test(text)) reqs.gearAny = true;
    if (/ボス固定不可|固定不可|ランダム|逸れ/.test(text)) reqs.notFixed = true;
    return reqs;
}

/** 「A:潜水 D:潜水 F:潜水 J:ボス」→ 道中戰數（渦潮等非戰鬥點與王點不計）。 */
function battlesOf(map: string, legend: string, routes: string[]): number | null {
    if (!legend) return null;
    // 「AD:通常」一次標兩點、「F通常」漏冒號都要能讀
    const names = Object.keys(MAP_SPOTS[map].spots).sort((x, y) => y.length - x.length);
    const kind = new Map<string, string>();
    for (const [, nodes, k] of legend.replace(/[()（）]/g, ' ').matchAll(/([A-Z][A-Z0-9]*)\s*[:：]?\s*([^\sA-Z0-9:：]+)/g)) {
        // 「B,Hに潜水艦」之類的說明句不是圖例
        if (!/^(?:[\p{sc=Han}\p{sc=Katakana}]|PT)/u.test(k)) continue;
        for (let i = 0; i < nodes.length;) {
            const n = names.find((x) => nodes.startsWith(x, i));
            if (!n) break;
            kind.set(n, k);
            i += n.length;
        }
    }
    if (!kind.size) return null;
    const NON_BATTLE = /渦潮|資源|揚陸|能動|ボス|気のせい|空襲?無し|港/;
    // 圖例沒列的點視為非戰鬥；多條路線取最少的
    const counts = routes.flatMap((r) => expandRoutes(map, [r])).map((nodes) =>
        nodes.slice(0, -1).filter((n) => kind.has(n) && !NON_BATTLE.test(kind.get(n)!)).length);
    return counts.length ? Math.min(...counts) : null;
}

// ── 驗證用艦隊 ────────────────────────────────────────────────────
const master = JSON.parse(readFileSync(resolve(root, 'samples/start2-master.json'), 'utf8'));
const mstShips = new Map<number, { api_stype: number; api_soku: number; api_ctype: number }>(
    (master.api_data ?? master).api_mst_ship.map((s: any) => [s.api_id, s]));

const REP: Record<string, { stype: number; soku: number }> = {
    DD: { stype: 2, soku: 10 }, CL: { stype: 3, soku: 10 }, CA: { stype: 5, soku: 10 }, CAV: { stype: 6, soku: 10 },
    CAclass: { stype: 5, soku: 10 }, CLclass: { stype: 3, soku: 10 }, CLT: { stype: 4, soku: 10 }, CT: { stype: 21, soku: 5 },
    BB: { stype: 8, soku: 10 }, SBB: { stype: 9, soku: 5 }, FBB: { stype: 8, soku: 10 }, BBV: { stype: 10, soku: 5 },
    BBclass: { stype: 8, soku: 10 }, CVclass: { stype: 11, soku: 10 }, CV: { stype: 11, soku: 10 }, CVL: { stype: 7, soku: 10 },
    AV: { stype: 16, soku: 10 }, LHA: { stype: 17, soku: 5 }, SS: { stype: 13, soku: 5 }, AS: { stype: 20, soku: 5 },
    AO: { stype: 22, soku: 5 }, DE: { stype: 1, soku: 5 }, FREE: { stype: 5, soku: 10 }, CRUISER: { stype: 5, soku: 10 },
};
// 自由枠と「戦艦」は代表を変えて再試行する（自由＝何でもよい、戦艦は速力で分かれる）
const FREE_ALTS = ['CA', 'CAV', 'CLT', 'CL', 'DD'];
const BB_ALTS = ['FBB', 'SBB'];

function repShip(key: string, alt: Record<string, string>): SuggestShip {
    if (key in SHIP_SETS) {
        const def = SHIP_SETS[key as ShipSet] as { mst?: readonly number[]; ctype?: readonly number[] };
        const mst = def.mst?.[0] ?? [...mstShips.entries()].find(([id, s]) => id < 1500 && def.ctype!.includes(s.api_ctype))![0];
        const s = mstShips.get(mst)!;
        return { stype: s.api_stype, soku: s.api_soku, mst, ctype: s.api_ctype };
    }
    return { ...REP[alt[key] ?? key] };
}

function buildFleet(comp: SuggestComp, reqs: SuggestReqs, alt: Record<string, string>): SuggestShip[] | null {
    if (comp.parts.some((p) => p.max !== undefined)) return null;   // 範圍表記は驗證しない
    const ordered = [...comp.parts].sort((a, b) => Number(!!b.flag) - Number(!!a.flag));
    const ships = ordered.flatMap((p) => Array.from({ length: p.n }, () => repShip(p.keys[0], alt)));
    if (!ships.length || ships.length > 7) return null;
    const floor = reqs.speed === 'fastest' ? 20 : reqs.speed === 'fastPlus' ? 15 : reqs.speed === 'fast' ? 10 : 0;
    for (const s of ships) if (floor) s.soku = Math.max(s.soku, floor);
    const gears = Object.entries(reqs.gear ?? {}) as [GearKind, number][];
    // 擇一時用第一種驗證
    for (const [kind, n] of reqs.gearAny ? gears.slice(0, 1) : gears) {
        for (let i = 0; i < Math.min(n, ships.length); i++) (ships[i].gears ??= []).push(kind);
    }
    return ships;
}

const expandRoutes = (map: string, routes: string[]) => routes.flatMap((r) => expandSuggestRoute(map, r));

const nodesOf = (p: RoutePath) => p.steps.filter((s) => s.from !== '').map((s) => s.to).join(',');

/** 路線的每一段都要是地圖上真的存在的路線（起點要能從出擊點到達）。 */
function onGraph(map: string, route: string[]): boolean {
    const spots = MAP_SPOTS[map];
    const edges = new Set(Object.values(spots.routes).map(([a, b]) => `${a}>${b}`));
    const first = route[0];
    if (!spots.starts.includes(first) && !spots.starts.some((st) => edges.has(`${st}>${first}`))) return false;
    return route.every((n, i) => i === 0 || edges.has(`${route[i - 1]}>${n}`));
}

/** 1-6 等終點不是王的海域，來源的路線有時省略最後的終點：補上。 */
function withGoal(map: string, route: string[]): string[] {
    const rules = ROUTE_RULES[map];
    const goals = [...rules.goal, ...(rules.stages ?? []).flatMap((st) => st.goal)];
    const last = route[route.length - 1];
    if (goals.includes(last)) return route;
    const edges = Object.values(MAP_SPOTS[map].routes);
    const next = goals.find((g) => edges.some(([a, b]) => a === last && b === g));
    return next ? [...route, next] : route;
}

type Verdict = 'match' | 'partial' | 'mismatch';

/**
 * match＝預測航路全落在列出的路線內（能動分岐的另一側除外）；partial＝列出的路線會發生，但規則顯示還有
 * 其他（隨機或不可考）去向；mismatch＝列出的路線依規則不會發生。索敵用來源寫的需求值（沒寫為足夠）。
 */
function verify(map: string, fleet: SuggestShip[], reqs: SuggestReqs, expected: string[][]): { verdict: Verdict; got: string[] } {
    const rules = ROUTE_RULES[map];
    const want = new Set(expected.map((r) => r.join(',')));
    const goalOf = expected[0]?.[expected[0].length - 1];
    const stage = rules.stages?.find((s) => s.goal.includes(goalOf))?.id ?? null;
    const losValue: Record<number, number> = {};
    for (const l of reqs.los ?? []) losValue[l.cn] = l.min;
    const { paths } = predictRoutes(map, rules, suggestionFleet(fleet, losValue), stage);
    const got = [...new Set(paths.map(nodesOf))];
    const hit = paths.filter((p) => want.has(nodesOf(p)));
    if (!hit.length) return { verdict: 'mismatch', got };
    // 能動分岐の別ルートは玩家が選ばない限り通らない
    const others = paths.filter((p) => !want.has(nodesOf(p)) && !p.steps.some((s) => s.kind === 'choice'));
    return { verdict: others.length ? 'partial' : 'match', got };
}

/** 顯示用的路線字串也補上省略的終點。 */
function withGoalText(map: string, route: string): string {
    const alts = expandRoutes(map, [route]);
    const full = withGoal(map, alts[0] ?? []);
    const added = full.length > (alts[0]?.length ?? 0) ? full[full.length - 1] : '';
    return route + added;
}

// ── 主程式 ────────────────────────────────────────────────────────
interface RawBlock { comps: string[]; routes: string[]; legend: string; notes: string[] }
const raw: Record<string, { modified: string | null; routes: { heading: string | null; blocks: RawBlock[] }[] }> = JSON.parse(readFileSync(RAW, 'utf8'));
const store: Record<string, SuggestBlock[]> = {};
let total = 0, skipped = 0, unparsed = 0, stale = 0;
const counts = { match: 0, partial: 0, mismatch: 0 };
const problems: string[] = [];
for (const map of Object.keys(MAP_SPOTS)) {
    const blocks: SuggestBlock[] = [];
    const page = raw[map] ?? { modified: null, routes: [] };
    for (const sec of page.routes) {
        for (const b of sec.blocks) {
            // 地圖上不存在的路線段（來源筆誤或簡寫）丟棄；可選節點只有部分展開成立時，只留成立的展開
            const kept: string[] = [];
            for (const r of b.routes) {
                const alts = expandRoutes(map, [r]);
                const valid = alts.filter((alt) => onGraph(map, withGoal(map, alt)));
                if (valid.length === alts.length) kept.push(r);
                else if (valid.length) kept.push(...valid.map((alt) => alt.join('')));
                else problems.push(`${map} 路線不在地圖上，略過：${r}`);
            }
            // 只收到王（目標點）的路線：來源同區塊裡的逸出路線、機關點路線不列
            const goals = goalsOf(ROUTE_RULES[map], null);
            for (let i = kept.length - 1; i >= 0; i--) {
                const end = withGoal(map, expandRoutes(map, [kept[i]])[0]).at(-1);
                if (!end || !goals.includes(end)) { problems.push(`${map} 不是到王路線，略過：${kept[i]}`); kept.splice(i, 1); }
            }
            const routes = expandRoutes(map, kept).map((r) => withGoal(map, r));
            if (!routes.length) continue;
            const reqs = parseReqs(b.notes);
            // 不一致時以較新的一方為準：wiki 分岐法則更新日比來源頁新，該組編成視為過時不列
            const wikiDate = ROUTE_RULES[map].updated;
            const wikiNewer = !!wikiDate && !!page.modified && wikiDate > page.modified;
            const comps: SuggestComp[] = [];
            for (const c of b.comps) {
                const [compText, compNote] = c.split('\t');
                const comp = parseComp(compText);
                if (!comp) { unparsed++; problems.push(`${map} 編成無法解析：${c}`); continue; }
                total++;
                // 編成後面的「(高速統一)」是這一組自己的航速需求
                const own = compNote ? parseReqs([compNote]).speed : undefined;
                if (own) comp.speed = own;
                const compReqs: SuggestReqs = own ? { ...reqs, speed: own } : reqs;
                const rank: Record<Verdict, number> = { match: 0, partial: 1, mismatch: 2 };
                let result: { verdict: Verdict; got: string[] } | null = null;
                outer: for (const free of FREE_ALTS) for (const bb of BB_ALTS) {
                    const fleet = buildFleet(comp, compReqs, { FREE: free, CRUISER: free, BB: bb, BBclass: bb });
                    if (!fleet) break outer;
                    const r = verify(map, fleet, compReqs, routes);
                    if (!result || rank[r.verdict] < rank[result.verdict]) result = r;
                    if (r.verdict === 'match') break outer;
                }
                if (!result) { skipped++; comp.verified = 'skip'; }
                else {
                    comp.verified = result.verdict;
                    counts[result.verdict]++;
                    if (result.verdict === 'mismatch') {
                        const why = `${c}【${b.routes.join('/')}】 需求 ${JSON.stringify(compReqs)} → 推算 ${result.got.join(' | ')}`;
                        if (wikiNewer) {
                            counts.mismatch--; stale++;
                            problems.push(`${map} 來源（${page.modified}）比分岐法則（${wikiDate}）舊，不列：${why}`);
                            continue;
                        }
                        problems.push(`${map} 不一致：${why}`);
                    }
                }
                comps.push(comp);
            }
            if (!comps.length) continue;
            blocks.push({ routes: kept.map((r) => withGoalText(map, r)), battles: battlesOf(map, b.legend, kept), reqs, comps });
        }
    }
    store[map] = blocks;
}
console.log(`編成 ${total}：一致 ${counts.match}、部分（另有隨機去向）${counts.partial}、不一致 ${counts.mismatch}、來源過時不列 ${stale}、未驗證（範圍表記）${skipped}；無法解析 ${unparsed}`);
if (REPORT) console.log(problems.join('\n'));
const lines = [
    '// 常規導航「到王編成參考」—— **產生物，勿手改**：',
    '//     python3 tools/route-suggest/zekamashi.py && npx vite-node --config vitest.config.ts tools/route-suggest/generate.ts',
    '//',
    '// 各海域的固定編成例、路線、道中戰數與需求，取自ぜかまし各海域攻略「ルート固定」段落的事實（見 THIRD-PARTY-NOTICES.md）。',
    '// verified 是用 utils/route-rules-data.ts 的分岐法則實際推算的結果；RULES_FINGERPRINT 對不上時 tests/route-suggest.test.ts 會要求重跑。',
    "import type { SuggestBlock } from './route-suggest';",
    '',
    `export const RULES_FINGERPRINT = '${rulesFingerprint(ROUTE_RULES)}';`,
    '',
    `export const ROUTE_SUGGESTIONS: Record<string, SuggestBlock[]> = ${JSON.stringify(store)};`,
    '',
];
writeFileSync(OUT, lines.join('\n'));
