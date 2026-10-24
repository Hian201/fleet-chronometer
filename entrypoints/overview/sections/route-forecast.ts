// 常規導航：選海域與艦隊，依 wikiwiki 分岐法則（utils/route-rules-data.ts）推算航路。
// 只讀 GameState，不寫 DB。背景是 Natural Earth 真實地理（utils/map-geo-data.ts），
// 節點與路線座標取自遊戲地圖資源（utils/map-spots.ts）。
//
// 工具列（海域／艦隊／階段）只在進入分區時畫一次；切換選項只重畫內容區，不重建控制項。
import type { OverviewSection, SectionContext } from './types';
import { getLang, t } from '@/utils/ui-i18n';
import { AREA_NAMES, mapName } from '@/utils/map-names';
import { MAP_SPOTS } from '@/utils/map-spots';
import { MAP_GEO, WORLD_PICKER } from '@/utils/map-geo-data';
import { MAP_LOCATION_UNKNOWN, MAP_LOCATIONS } from '@/utils/map-locations';
import { ROUTE_RULES } from '@/utils/route-rules-data';
import {
    evalCond, exitsOf, goalsOf, goalVerdict, predictRoutes,
    type MapRules, type RouteFleet, type RoutePath, type Rule, type StepKind,
} from '@/utils/route-predict';
import { formatOutcome, formatRuleCond, formatSuggestPart, formatSuggestReqs } from '@/utils/route-format';
import { ROUTE_SUGGESTIONS } from '@/utils/route-suggestions';
import { suggestionsFor, suggestRouteHops, type SuggestBlock, type SuggestComp } from '@/utils/route-suggest';
import { buildStypeLabels, stypeDisplayLabel } from '@/utils/stype-label';
import { esc, loadJsonPrefs, saveJsonPrefs } from '../lib';

const PREFS_KEY = 'kc-route-forecast';
const MAX_LISTED = 12;

interface Prefs { map: string; fleet: number; stage: Record<string, string> }

const MAP_KEYS = Object.keys(MAP_SPOTS).sort((a, b) => {
    const [aw, an] = a.split('-').map(Number);
    const [bw, bn] = b.split('-').map(Number);
    return aw - bw || an - bn;
});

function loadPrefs(): Prefs {
    const fallback: Prefs = { map: Object.keys(ROUTE_RULES)[0] ?? MAP_KEYS[0], fleet: 0, stage: {} };
    return loadJsonPrefs(PREFS_KEY, fallback, (raw) => {
        const r = raw as Partial<Prefs> | null;
        return {
            map: typeof r?.map === 'string' && MAP_SPOTS[r.map] ? r.map : fallback.map,
            fleet: Number.isInteger(r?.fleet) && r!.fleet! >= 0 && r!.fleet! < 4 ? r!.fleet! : 0,
            stage: r?.stage && typeof r.stage === 'object' ? r.stage as Record<string, string> : {},
        };
    });
}

const locale = () => getLang() as 'zh-TW' | 'en' | 'ja';
const mapLabel = (map: string) => `${map} ${mapName(map, locale()) ?? ''}`.trim();

/**
 * 艦隊特徵：判定會用到的全部輸入（艦、艦種、航速、裝備、各係數的索敵值）。即時更新時只在它
 * 改變才重畫——不靠封包 path 清單判斷，換船、換裝、改造、退避等任何改變編成的封包都不會漏。
 */
function fleetSignature(data: { fleet: RouteFleet; slots: readonly FleetSlot[] } | null): string {
    if (!data) return '';
    const ships = data.fleet.ships.map((s) => [s.mst, s.stype, s.ctype, s.soku, s.gears.map((g) => g.mst)]);
    // 等級只影響編成欄的顯示，一併納入才會在升級後更新
    return JSON.stringify([ships, data.slots.map((s) => s.lv), [1, 2, 3, 4].map((cn) => data.fleet.los(cn))]);
}

interface FleetSlot { stype: string; name: string; lv: number }

/** 遊戲狀態 → 判定器用的艦隊事實。退避艦不計（f33 同樣不計）。 */
function routeFleet(ctx: SectionContext, deckIdx: number): { fleet: RouteFleet; slots: FleetSlot[] } | null {
    const view = ctx.state.fleets()[deckIdx];
    if (!view) return null;
    const owned = ctx.state.ownedShips();
    const byId = new Map(owned.map((s) => [s.id, s]));
    buildStypeLabels(owned, new Map());
    const ships = view.ships.filter((s) => !s.escaped);
    return {
        fleet: {
            ships: ships.map((s) => {
                const o = byId.get(s.id);
                return {
                    mst: s.mst,
                    stype: s.stypeId,
                    ctype: o?.ctype ?? s.ctype ?? null,
                    soku: o?.soku ?? 0,
                    gears: [...s.gears, s.exGear].flatMap((g) => g ? [{ mst: g.mst, type: g.type }] : []),
                };
            }),
            los: (cn) => ctx.state.f33(deckIdx, cn),
        },
        slots: ships.map((s) => {
            const o = byId.get(s.id);
            return { stype: o ? stypeDisplayLabel(o) : s.stype, name: s.name, lv: s.lv };
        }),
    };
}

/** 編成：同遊戲編成畫面，兩欄由左而右、由上而下（1 2／3 4／5 6），空位也畫出來。 */
function fleetGridHtml(slots: readonly FleetSlot[]): string {
    const count = Math.max(6, slots.length);
    const cells = Array.from({ length: count }, (_, i) => {
        const s = slots[i];
        if (!s) return `<div class="rf-slot rf-slot-empty"><span class="rf-slot-no">${i + 1}</span></div>`;
        return `<div class="rf-slot${i === 0 ? ' rf-slot-flag' : ''}" title="${esc(`${s.stype} ${s.name} Lv${s.lv}`)}"><span class="rf-slot-no">${i + 1}</span><span class="rf-slot-stype">${esc(s.stype)}</span><span class="rf-slot-name">${esc(s.name)}</span><span class="rf-slot-lv">${s.lv}</span></div>`;
    }).join('');
    return `<div class="rf-fleetgrid">${cells}</div>`;
}

// ── 航路統計 ──────────────────────────────────────────────────────
interface EdgeUse {
    sure: Set<string>;
    maybe: Set<string>;
    nodes: Set<string>;
    /** 路段 → 這一步的成因（同一段可能在不同航路有不同成因）。 */
    kinds: Map<string, Set<StepKind>>;
}

function edgeUse(paths: readonly RoutePath[]): EdgeUse {
    const counts = new Map<string, number>();
    const nodes = new Set<string>();
    const kinds = new Map<string, Set<StepKind>>();
    for (const p of paths) {
        const seen = new Set<string>();
        for (const s of p.steps) {
            if (s.from === '') { nodes.add(s.to); continue; }
            const key = `${s.from}>${s.to}`;
            nodes.add(s.from); nodes.add(s.to);
            (kinds.get(key) ?? kinds.set(key, new Set()).get(key)!).add(s.kind);
            if (!seen.has(key)) { seen.add(key); counts.set(key, (counts.get(key) ?? 0) + 1); }
        }
    }
    const sure = new Set<string>();
    const maybe = new Set<string>();
    for (const [k, n] of counts) (n === paths.length ? sure : maybe).add(k);
    return { sure, maybe, nodes, kinds };
}

/** 路段的成因分類（畫線用）：能動分岐 > 隨機 > 不可考 > 分岐後的路段。 */
function edgeCause(kinds: ReadonlySet<StepKind> | undefined): 'choice' | 'random' | 'unknown' | 'maybe' {
    if (!kinds) return 'maybe';
    if (kinds.has('choice')) return 'choice';
    if (kinds.has('random')) return 'random';
    if (kinds.has('unknown') || kinds.has('uncertain')) return 'unknown';
    return 'maybe';
}

/** 從圖結構反推：哪些節點還到得了目標（不看規則）。 */
function canReach(map: string, goals: readonly string[]): Set<string> {
    const routes = Object.values(MAP_SPOTS[map]?.routes ?? {});
    const ok = new Set(goals);
    let grew = true;
    while (grew) {
        grew = false;
        for (const [src, dst] of routes) if (ok.has(dst) && !ok.has(src)) { ok.add(src); grew = true; }
    }
    return ok;
}

interface Deviation { node: string; to: string; rule: number[] | null; kind: StepKind }

/**
 * 每條沒到目標的航路，第一個「走了到不了目標的出口、但還有別的出口到得了」的節點。
 * kind 區分成因：fixed＝條件把艦隊帶離目標；choice＝能動分岐選了另一邊；random／unknown／uncertain 另列。
 */
function deviations(map: string, paths: readonly RoutePath[], goals: readonly string[]): Deviation[] {
    const reach = canReach(map, goals);
    const out = new Map<string, Deviation>();
    for (const p of paths) {
        if (p.reachesGoal) continue;
        for (const s of p.steps) {
            if (s.from === '' || reach.has(s.to) || !exitsOf(map, s.from).some((e) => reach.has(e))) continue;
            out.set(`${s.from}>${s.to}`, { node: s.from, to: s.to, rule: s.rule, kind: s.kind });
            break;
        }
    }
    return [...out.values()];
}

/** 規則裡有能動分岐的節點（海域本身的性質，與編成無關）。 */
function choiceNodes(rules: MapRules | undefined): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const walk = (node: string, list: readonly Rule[]) => {
        for (const r of list) {
            if ('choice' in r) out.set(node, [...r.choice]);
            if ('then' in r) walk(node, r.then);
        }
    };
    for (const [node, list] of Object.entries(rules?.nodes ?? {})) walk(node, list);
    return out;
}

function ruleAt(rules: readonly Rule[], pos: readonly number[]): Rule | null {
    let list = rules;
    let r: Rule | null = null;
    for (const i of pos) {
        r = list[i] ?? null;
        if (!r) return null;
        list = 'then' in r ? r.then : [];
    }
    return r;
}

// ── 地圖 SVG ─────────────────────────────────────────────────────
// 出擊點（船舵）與王點（赤鬼）的圖示：本專案自繪的扁平剪影，不使用遊戲素材。
// viewBox 以原點為中心，<use> 時以節點座標為中心放置。
const ICON_DEFS = `<symbol id="rf-wheel" viewBox="-32 -32 64 64">
        <g class="rf-wheel-spokes">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) =>
            `<g transform="rotate(${a})"><line x1="0" y1="-6" x2="0" y2="-24"/><circle cx="0" cy="-27" r="4"/></g>`).join('')}</g>
        <circle class="rf-wheel-ring" r="17"/><circle class="rf-wheel-hub" r="6"/>
    </symbol>
    <symbol id="rf-oni" viewBox="-32 -32 64 64">
        <path class="rf-oni-face" d="M-15-19L-23-31L-6-22Q0-24 6-22L23-31L15-19Q22-12 22 0Q22 22 0 24Q-22 22-22 0Q-22-12-15-19Z"/>
        <path class="rf-oni-eye" d="M-15-5L-3 0L-14 3ZM15-5L3 0L14 3Z"/>
        <path class="rf-oni-mouth" d="M-10 10L10 10L7 16L-7 16Z"/>
        <path class="rf-oni-eye" d="M-9 10L-6 14L-3 10ZM3 10L6 14L9 10Z"/>
    </symbol>`;

/** 節點徽章：能動分岐（海域性質）、隨機與條件偏移（依目前編成）。 */
interface NodeMarks { choice: ReadonlySet<string>; random: ReadonlySet<string>; drift: ReadonlySet<string> }

function badgeHtml(x: number, y: number, marks: NodeMarks, name: string): string {
    const list: string[] = [];
    if (marks.drift.has(name)) list.push('drift');
    if (marks.choice.has(name)) list.push('choice');
    if (marks.random.has(name)) list.push('random');
    return list.map((kind, i) => {
        const bx = x + 17 + i * 22, by = y - 17;
        const glyph = kind === 'choice'
            ? `<path d="M${bx} ${by + 6}V${by}M${bx} ${by}L${bx - 5} ${by - 5}M${bx} ${by}L${bx + 5} ${by - 5}"/>`
            : `<text x="${bx}" y="${by + 5}">${kind === 'random' ? '?' : '!'}</text>`;
        return `<g class="rf-badge rf-badge-${kind}"><circle cx="${bx}" cy="${by}" r="10"/>${glyph}</g>`;
    }).join('');
}

function svgHtml(map: string, rules: MapRules | undefined, use: EdgeUse, goals: readonly string[], selected: string | null, marks: NodeMarks): string {
    const spots = MAP_SPOTS[map];
    const geo = MAP_GEO[map];
    const bosses = rules ? (rules.boss ?? rules.goal) : [];
    const r = 18;
    // 圖示節點（出擊點、王點）比圓點大，線段要多留一段距離
    const radius = (name: string) => spots.starts.includes(name) ? 30 : bosses.includes(name) ? 28 : goals.includes(name) ? r + 3 : r;
    const seen = new Set<string>();
    const edges: string[] = [];
    for (const [src, dst] of Object.values(spots.routes)) {
        const key = `${src}>${dst}`;
        if (src === dst || seen.has(key)) continue;
        seen.add(key);
        const [x1, y1] = spots.spots[src];
        const [x2, y2] = spots.spots[dst];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const kind = use.sure.has(key) ? 'sure' : use.maybe.has(key) ? edgeCause(use.kinds.get(key)) : 'base';
        const cls = kind === 'base' ? 'rf-e' : `rf-e rf-e-${kind}`;
        const a = radius(src), b = radius(dst) + 6;
        edges.push(`<line class="${cls}" x1="${(x1 + ux * a).toFixed(1)}" y1="${(y1 + uy * a).toFixed(1)}" x2="${(x2 - ux * b).toFixed(1)}" y2="${(y2 - uy * b).toFixed(1)}" marker-end="url(#rf-arrow-${kind})"/>`);
    }
    const multiStart = spots.starts.length > 1;
    const nodes = Object.entries(spots.spots).map(([name, [x, y]]) => {
        const isStart = spots.starts.includes(name);
        const isBoss = bosses.includes(name);
        const cls = ['rf-n',
            isStart ? 'rf-n-start' : '',
            isBoss ? 'rf-n-boss' : '',
            goals.includes(name) ? 'rf-n-goal' : '',
            use.nodes.has(name) ? 'rf-n-on' : '',
            name === selected ? 'rf-n-sel' : ''].filter(Boolean).join(' ');
        const title = isStart ? t('route.start', { n: name }) : isBoss ? `${name}（${t('route.legend.boss')}）` : name;
        let body: string;
        if (isStart || isBoss) {
            const size = 64;
            const label = isStart ? (multiStart ? name : '') : name;
            body = `<circle class="rf-halo" cx="${x}" cy="${y}" r="${radius(name) + 2}"/>`
                + `<use href="#${isStart ? 'rf-wheel' : 'rf-oni'}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}"/>`
                + (label ? `<text class="rf-n-tag" x="${x + 24}" y="${y + 34}">${esc(label)}</text>` : '');
        } else {
            body = `<circle cx="${x}" cy="${y}" r="${goals.includes(name) ? r + 3 : r}"/><text x="${x}" y="${y + 6}">${esc(name)}</text>`;
        }
        return `<g class="${cls}" data-node="${esc(name)}" tabindex="0" role="button" aria-label="${esc(title)}"><title>${esc(title)}</title>${body}${badgeHtml(x, y, marks, name)}</g>`;
    }).join('');
    const marker = (id: string) => `<marker id="rf-arrow-${id}" class="rf-arrow-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker>`;
    return `<svg class="rf-svg" viewBox="0 0 1200 720" role="img" aria-label="${esc(mapLabel(map))}">
        <defs>${['base', 'maybe', 'sure', 'choice', 'random', 'unknown'].map(marker).join('')}${ICON_DEFS}</defs>
        <rect class="rf-sea" width="1200" height="720"/>
        ${geo?.land ? `<path class="rf-land" d="${geo.land}"/>` : ''}
        ${geo?.reef ? `<path class="rf-reef" d="${geo.reef}"/>` : ''}
        ${edges.join('')}${nodes}</svg>`;
}

// ── 世界地圖選擇 ───────────────────────────────────────────────────
// 各大區一個框（列出該區各關），框的位置手動排開避免互相重疊；點是各關的實際位置。
// 位置以 [經, 緯] 指框的左上角。
const AREA_BOX: Readonly<Record<number, readonly [number, number]>> = {
    1: [143, 45], 2: [124, 15], 3: [140, 61], 4: [44, 27], 5: [136, -13], 6: [178, 39], 7: [84, -12],
};

function worldXY(lon: number, lat: number): [number, number] {
    const shifted = lon < 0 ? lon + 360 : lon;
    return [(shifted - WORLD_PICKER.west) * WORLD_PICKER.px, (WORLD_PICKER.north - lat) * WORLD_PICKER.px];
}

const pct = (v: number, total: number) => `${(v / total * 100).toFixed(2)}%`;

function areaLabel(area: number): string {
    const names = AREA_NAMES[area];
    if (!names) return String(area);
    return locale() === 'ja' ? names.jp : locale() === 'en' ? names.en : names.zhTW;
}

function worldPickerHtml(current: string): string {
    const { width, height } = WORLD_PICKER;
    // 同一位置的多關共用一個點
    const dots = new Map<string, { x: number; y: number; area: number; maps: string[] }>();
    for (const map of MAP_KEYS) {
        const loc = MAP_LOCATIONS[map];
        if (!loc) continue;
        const [x, y] = worldXY(loc[0], loc[1]);
        const key = `${Math.round(x)},${Math.round(y)}`;
        const dot = dots.get(key) ?? { x, y, area: Number(map.split('-')[0]), maps: [] };
        dot.maps.push(map);
        dots.set(key, dot);
    }
    const dotSvg = [...dots.values()].map((d) => `<circle class="rf-wd rf-wd-a${d.area}${d.maps.includes(current) ? ' rf-wd-sel' : ''}${d.maps.some((m) => MAP_LOCATION_UNKNOWN.has(m)) ? ' rf-wd-unk' : ''}" data-maps="${d.maps.join(' ')}" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="5"><title>${esc(d.maps.join(' / '))}</title></circle>`).join('');
    const boxes = Object.entries(AREA_BOX).map(([areaKey, [lon, lat]]) => {
        const area = Number(areaKey);
        const [x, y] = worldXY(lon, lat);
        const chips = MAP_KEYS.filter((k) => Number(k.split('-')[0]) === area).map((k) => {
            const name = mapName(k, locale()) ?? '';
            const unknown = MAP_LOCATION_UNKNOWN.has(k) ? `（${t('route.locUnknown')}）` : '';
            const title = `${k} ${name}${unknown}${ROUTE_RULES[k] ? '' : t('route.noRules')}`;
            return `<button type="button" class="rf-wchip${k === current ? ' on' : ''}${ROUTE_RULES[k] ? '' : ' off'}" data-map="${k}" title="${esc(title)}">${k.split('-')[1]}</button>`;
        }).join('');
        return `<div class="rf-wbox rf-wbox-a${area}" style="left:${pct(x, width)};top:${pct(y, height)}"><span class="rf-wbox-title">${area} ${esc(areaLabel(area))}</span><span class="rf-wchips">${chips}</span></div>`;
    }).join('');
    return `<div class="rf-world-map"><svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect class="rf-sea" width="${width}" height="${height}"/><path class="rf-land" d="${WORLD_PICKER.land}"/>${dotSvg}</svg>${boxes}</div>`;
}

// ── 側欄 ─────────────────────────────────────────────────────────
const KIND_TAG: Partial<Record<StepKind, string>> = {
    random: 'route.k.random', choice: 'route.k.choice', unknown: 'route.k.unknown', uncertain: 'route.k.unknown',
};

function pathHtml(p: RoutePath): string {
    const parts: string[] = [];
    for (const s of p.steps) {
        if (parts.length === 0) parts.push(`<span class="rf-hop">${esc(s.from === '' ? s.to : s.from)}</span>`);
        if (s.from === '') continue;
        const tag = KIND_TAG[s.kind];
        parts.push(`<span class="rf-arr${tag ? ` rf-arr-${s.kind}` : ''}"${tag ? ` title="${esc(t(tag))}"` : ''}>→</span><span class="rf-hop">${esc(s.to)}</span>`);
    }
    return `<li class="${p.reachesGoal ? 'rf-path-goal' : ''}">${parts.join('')}${p.reachesGoal ? ' <span class="rf-goal-mark">✓</span>' : ''}</li>`;
}

function rulesHtml(rules: readonly Rule[], fleet: RouteFleet, visited: ReadonlySet<string>, phases: Readonly<Record<string, boolean>>): string {
    // decided：已有確定成立的規則，之後的都不會判定。外層不可考時，內層命中也不算確定。
    let decided = false;
    // reached＝外層條件沒有不成立（外層不成立時，內層規則根本不會判定）。
    const walk = (list: readonly Rule[], sure: boolean, reached = true): string => list.map((r) => {
        let mark: 'hit' | 'true' | 'false' | 'unknown' | 'skip';
        const v = r.if ? evalCond(r.if, { fleet, visited, phases }) : true;
        if (decided || !reached) mark = 'skip';
        else if (v === false) mark = 'false';
        else if (v === null || !sure) mark = 'unknown';
        else mark = 'then' in r ? 'true' : 'hit';
        const inner = 'then' in r ? `<ol class="rf-rules">${walk(r.then, sure && v === true, reached && !decided && v !== false)}</ol>` : '';
        if (mark === 'hit') {
            decided = true;
            // 去向本身不可考（wiki 只寫「索敵」等）：已輪到這條，但結果仍未知
            if ('unknown' in r) mark = 'unknown';
        }
        const out = 'then' in r ? '' : `<span class="rf-to">→ ${esc(formatOutcome(r))}</span>`;
        return `<li class="rf-r rf-r-${mark}"><span class="rf-r-mark" title="${esc(t(`route.mark.${mark}`))}"></span><span class="rf-r-cond">${esc(formatRuleCond(r))}${r.tentative ? ` <span class="rf-tag">${esc(t('route.tentative'))}</span>` : ''}</span>${out}${inner}</li>`;
    }).join('');
    return `<ol class="rf-rules">${walk(rules, true)}</ol>`;
}

function detailHtml(map: string, rules: MapRules | undefined, node: string, fleet: RouteFleet, paths: readonly RoutePath[], phases: Readonly<Record<string, boolean>>): string {
    const nodeRules = rules?.nodes[node];
    const exits = exitsOf(map, node);
    // 經過集合取第一條走到此點的航路（「已經過 X」條件依路線而定）
    const via = paths.find((p) => p.steps.some((s) => s.to === node || s.from === node));
    const visited = new Set<string>();
    if (via) {
        for (const s of via.steps) {
            if (s.from === node) break;
            if (s.from) visited.add(s.from);
            visited.add(s.to);
        }
    }
    let body: string;
    if (nodeRules) body = rulesHtml(nodeRules, fleet, visited, phases);
    else if (exits.length === 1) body = `<p class="rf-note">${esc(t('route.fixedExit', { to: exits[0] }))}</p>`;
    else if (exits.length === 0) body = `<p class="rf-note">${esc(t('route.endNode'))}</p>`;
    else body = `<p class="rf-note">${esc(t('route.noNodeRules'))}</p>`;
    const title = MAP_SPOTS[map].starts.includes(node) ? t('route.start', { n: node }) : node;
    return `<h3>${esc(t('route.detail', { node: title }))}</h3>${body}`;
}

// ── 到王編成參考 ─────────────────────────────────────────────────
function suggestRouteHtml(map: string, route: string): string {
    return suggestRouteHops(map, route).map((h, i) =>
        `${i ? '<span class="rf-arr">→</span>' : ''}<span class="rf-hop${h.optional ? ' rf-hop-opt' : ''}">${esc(h.optional ? `(${h.node})` : h.node)}</span>`).join('');
}

function suggestCompHtml(c: SuggestComp): string {
    const v = c.verified && c.verified !== 'match'
        ? ` <span class="rf-sg-v rf-sg-v-${c.verified}" title="${esc(t(`route.sug.v.${c.verified}Tip`))}">${esc(t(`route.sug.v.${c.verified}`))}</span>` : '';
    const speed = c.speed ? ` <span class="rf-tag">${esc(t(`route.c.speed.${c.speed}.atLeast`))}</span>` : '';
    return `<li>${c.parts.map((p) => `<span class="rf-sg-part">${esc(formatSuggestPart(p))}</span>`).join('')}${speed}${v}</li>`;
}

function suggestBlockHtml(map: string, b: SuggestBlock): string {
    const battles = b.battles === null ? t('route.sug.battlesUnknown') : t('route.sug.battles', { n: b.battles });
    const reqs = formatSuggestReqs(b.reqs).map((r) => `<span class="rf-tag">${esc(r)}</span>`).join('');
    return `<article class="rf-sg-card">
        <div class="rf-sg-head"><span class="rf-sg-battles">${esc(battles)}</span>${b.routes.map((r) => `<span class="rf-sg-route">${suggestRouteHtml(map, r)}</span>`).join('')}</div>
        ${reqs ? `<div class="rf-sg-reqs">${reqs}</div>` : ''}
        <ul class="rf-sg-comps">${b.comps.map(suggestCompHtml).join('')}</ul></article>`;
}

function suggestHtml(map: string, goals: readonly string[]): string {
    const blocks = suggestionsFor(map, ROUTE_SUGGESTIONS[map] ?? [], goals);
    if (!blocks.length) return `<p class="rf-note">${esc(t('route.sug.none'))}</p>`;
    const optional = blocks.some((b) => b.routes.some((r) => r.includes('(')));
    return `<p class="rf-note">${esc(t('route.sug.hint'))}${optional ? ` ${esc(t('route.sug.optional'))}` : ''}</p>
        <div class="rf-sg-grid">${blocks.map((b) => suggestBlockHtml(map, b)).join('')}</div>`;
}

function sourceHtml(map: string, rules: MapRules): string {
    const area = AREA_NAMES[Number(map.split('-')[0])]?.jp;
    const url = area ? `https://wikiwiki.jp/kancolle/${encodeURIComponent(area)}/${map}` : 'https://wikiwiki.jp/kancolle/';
    const text = t('route.src', { updated: rules.updated ?? t('route.srcNoDate'), checked: rules.checked });
    return `<p class="rf-src"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a></p><p class="rf-src">${esc(t('route.bgNote'))}</p>`;
}

export const routeForecastSection: OverviewSection = {
    id: 'route-forecast', titleKey: 'ov.routeForecast',
    render(el, ctx) {
        const prefs = loadPrefs();
        let selected: string | null = null;
        const optgroups = [...new Set(MAP_KEYS.map((k) => Number(k.split('-')[0])))].map((area) => {
            const opts = MAP_KEYS.filter((k) => Number(k.split('-')[0]) === area).map((k) =>
                `<option value="${k}" ${k === prefs.map ? 'selected' : ''}>${esc(mapLabel(k))}${ROUTE_RULES[k] ? '' : esc(t('route.noRules'))}</option>`).join('');
            const label = AREA_NAMES[area] ? (locale() === 'ja' ? AREA_NAMES[area].jp : locale() === 'en' ? AREA_NAMES[area].en : AREA_NAMES[area].zhTW) : String(area);
            return `<optgroup label="${esc(label)}">${opts}</optgroup>`;
        }).join('');
        el.innerHTML = `<div class="rf"><p class="rf-disclaimer" role="note">${esc(t('route.disclaimer'))}</p><div class="ov-toolbar rf-bar">
            <label class="rs-inline"><span>${esc(t('route.map'))}</span><select class="rf-map">${optgroups}</select></label>
            <details class="rf-world"><summary>${esc(t('route.worldMap'))}</summary><div class="rf-world-pop">
                <div class="rf-world-view"><div class="rf-world-scroll"></div>
                    <button type="button" class="rf-world-pan rf-world-pan-l" data-dir="-1" aria-label="${esc(t('route.worldPanL'))}" title="${esc(t('route.worldPanL'))}" hidden>‹</button>
                    <button type="button" class="rf-world-pan rf-world-pan-r" data-dir="1" aria-label="${esc(t('route.worldPanR'))}" title="${esc(t('route.worldPanR'))}" hidden>›</button></div>
                <p class="rf-note rf-world-panhint" hidden>${esc(t('route.worldPanHint'))}</p>
                <div class="rf-world-foot"><span class="rf-note">${esc(t('route.worldHint'))}</span><button type="button" class="ov-btn rf-world-close">${esc(t('route.worldDone'))}</button></div>
            </div></details>
            <label class="rs-inline rf-stage-wrap" hidden><span>${esc(t('route.stage'))}</span><select class="rf-stage"></select></label>
        </div><div class="rf-body"><section class="rf-mapcard"><div class="ov-empty">${esc(t('ov.loading'))}</div></section>
            <aside class="rf-side"><div class="rf-fleet-head"><span class="rf-fleet-label">${esc(t('route.currentFleet'))}</span>
                <div class="rf-fleet-tabs" role="group" aria-label="${esc(t('route.fleet'))}">${[0, 1, 2, 3].map((i) =>
                    `<button type="button" class="rf-fleet-tab" data-fleet="${i}" aria-pressed="${i === prefs.fleet}">${esc(t('route.fleetN', { n: i + 1 }))}</button>`).join('')}</div></div>
            <div class="rf-side-body"></div></aside></div>
            <details class="rf-sg" open><summary>${esc(t('route.sug.title'))}</summary><div class="rf-sg-body"></div></details></div>`;
        const body = el.querySelector<HTMLElement>('.rf-body')!;
        const mapCard = el.querySelector<HTMLElement>('.rf-mapcard')!;
        const sideBody = el.querySelector<HTMLElement>('.rf-side-body')!;
        const fleetTabs = [...el.querySelectorAll<HTMLButtonElement>('.rf-fleet-tab')];
        const mapSel = el.querySelector<HTMLSelectElement>('.rf-map')!;
        const stageWrap = el.querySelector<HTMLElement>('.rf-stage-wrap')!;
        const stageSel = el.querySelector<HTMLSelectElement>('.rf-stage')!;
        const sugBody = el.querySelector<HTMLElement>('.rf-sg-body')!;

        const syncStage = () => {
            const stages = ROUTE_RULES[prefs.map]?.stages;
            stageWrap.hidden = !stages;
            if (!stages) return;
            const cur = prefs.stage[prefs.map] ?? '';
            stageSel.innerHTML = `<option value="">${esc(t('route.stageAny'))}</option>${stages.map((s) =>
                `<option value="${esc(s.id)}" ${s.id === cur ? 'selected' : ''}>${esc(t(s.labelKey))}</option>`).join('')}`;
        };

        // 編成參考只跟海域與階段有關：艦隊即時更新與點選分岐點都不重畫，展開狀態不受影響
        const drawSuggest = () => {
            const rules = ROUTE_RULES[prefs.map];
            const stage = rules?.stages?.find((s) => s.id === prefs.stage[prefs.map]) ?? null;
            sugBody.innerHTML = suggestHtml(prefs.map, goalsOf(rules, stage));
        };

        let shownSignature = '';
        const draw = () => {
            const map = prefs.map;
            const rules = ROUTE_RULES[map];
            const stage = rules?.stages?.find((s) => s.id === prefs.stage[map]) ?? null;
            const goals = goalsOf(rules, stage);
            const fleetData = routeFleet(ctx, prefs.fleet);
            shownSignature = fleetSignature(fleetData);
            const empty: EdgeUse = { sure: new Set(), maybe: new Set(), nodes: new Set(), kinds: new Map() };
            const choices = choiceNodes(rules);
            let marks: NodeMarks = { choice: new Set(choices.keys()), random: new Set(), drift: new Set() };
            let side: string;
            let use = empty;
            if (!rules) {
                side = `<div class="ov-empty">${esc(t('route.noRulesBody'))}</div>`;
            } else if (!fleetData) {
                side = `<div class="ov-empty">${esc(t('route.noState'))}</div>`;
            } else if (fleetData.fleet.ships.length === 0) {
                side = `${fleetGridHtml([])}<div class="ov-empty">${esc(t('route.noFleet'))}</div>`;
            } else {
                const { paths, truncated } = predictRoutes(map, rules, fleetData.fleet, stage?.id ?? null);
                use = edgeUse(paths);
                const goalText = goals.join(' / ');
                const hit = paths.filter((p) => p.reachesGoal).length;
                const devs = deviations(map, paths, goals);
                const drift = devs.filter((d) => d.kind === 'fixed');
                const chance = devs.filter((d) => d.kind !== 'fixed' && d.kind !== 'choice');
                let verdict: string = goalVerdict(paths);
                // 沒到目標的航路全是能動分岐選了另一邊：選對就能到
                if (verdict === 'possible' && devs.length && devs.every((d) => d.kind === 'choice')) verdict = 'choice';
                const randomFrom = new Set(paths.flatMap((p) => p.steps.filter((x) => x.kind === 'random').map((x) => x.from)));
                marks = { choice: marks.choice, random: randomFrom, drift: new Set(drift.map((d) => d.node)) };
                const phases = stage?.flags ?? {};
                const branchOnRoute = paths[0]?.steps.find((x) => x.from && exitsOf(map, x.from).length > 1)?.from;
                if (!selected || !MAP_SPOTS[map].spots[selected]) selected = drift[0]?.node ?? chance[0]?.node ?? devs[0]?.node ?? branchOnRoute ?? null;
                const reach = canReach(map, goals);
                const devLine = (d: Deviation) => {
                    const r = d.rule && rules.nodes[d.node] ? ruleAt(rules.nodes[d.node], d.rule) : null;
                    const cond = r ? formatRuleCond(r) : t('route.k.unknown');
                    return `<li><button type="button" class="rf-link" data-node="${esc(d.node)}">${esc(t('route.devLine', { node: d.node, cond, to: d.to }))}</button></li>`;
                };
                const section = (key: string, cls: string, items: string[]) => items.length
                    ? `<h3 class="rf-h-${cls}">${esc(t(key))}</h3><ul class="rf-devs">${items.join('')}</ul>` : '';
                // 能動分岐：只列這次航路會經過的點；往目標的出口只有一部分時才建議
                const choiceItems = [...choices].filter(([node]) => use.nodes.has(node)).map(([node, list]) => {
                    const good = list.filter((x) => reach.has(x));
                    const text = good.length && good.length < list.length
                        ? t('route.choiceLine', { node, list: list.join(' / '), goal: goalText, good: good.join(' / ') })
                        : t('route.choiceLineNone', { node, list: list.join(' / ') });
                    return `<li><button type="button" class="rf-link" data-node="${esc(node)}">${esc(text)}</button></li>`;
                });
                side = `${fleetGridHtml(fleetData.slots)}
                    <div class="rf-verdict rf-verdict-${verdict}">${esc(t(`route.v.${verdict}`, { goal: goalText, hit, n: paths.length }))}</div>
                    ${section('route.deviation', 'drift', drift.map(devLine))}
                    ${section('route.chanceSec', 'random', chance.map(devLine))}
                    ${section('route.choiceSec', 'choice', choiceItems)}
                    <h3>${esc(t('route.paths'))}</h3><ol class="rf-paths">${paths.slice(0, MAX_LISTED).map(pathHtml).join('')}</ol>
                    <p class="rf-arrkey"><span class="rf-arr">→</span>${esc(t('route.k.fixed'))}<span class="rf-arr rf-arr-choice">→</span>${esc(t('route.k.choice'))}<span class="rf-arr rf-arr-random">→</span>${esc(t('route.k.random'))}<span class="rf-arr rf-arr-unknown">→</span>${esc(t('route.k.unknown'))}</p>
                    ${paths.length > MAX_LISTED ? `<p class="rf-note">${esc(t('route.pathsMore', { n: paths.length - MAX_LISTED }))}</p>` : ''}
                    ${truncated ? `<p class="rf-note">${esc(t('route.truncated'))}</p>` : ''}
                    <div class="rf-detail">${selected ? detailHtml(map, rules, selected, fleetData.fleet, paths, phases) : `<p class="rf-note">${esc(t('route.detailHint'))}</p>`}</div>`;
            }
            const lgLine = (cls: string, key: string) => `<span class="rf-lg rf-lg-${cls}">${esc(t(key))}</span>`;
            const lgBadge = (cls: string, glyph: string, key: string) => `<span class="rf-lg-icon"><svg viewBox="-12 -12 24 24" aria-hidden="true"><g class="rf-badge rf-badge-${cls}"><circle r="10"/>${glyph}</g></svg>${esc(t(key))}</span>`;
            const lgIcon = (id: string, key: string) => `<span class="rf-lg-icon"><svg viewBox="-32 -32 64 64" aria-hidden="true"><use href="#${id}" x="-32" y="-32" width="64" height="64"/></svg>${esc(t(key))}</span>`;
            // 艦隊分頁標題列只建一次：這裡只更新選中狀態與遊戲內艦隊名
            const decks = ctx.state.fleets();
            fleetTabs.forEach((tab, i) => {
                tab.setAttribute('aria-pressed', String(i === prefs.fleet));
                tab.title = decks[i]?.name ?? '';
            });
            const deckName = decks[prefs.fleet]?.name;
            if (deckName && fleetData) side = `<p class="rf-fleet-name">${esc(deckName)}</p>${side}`;
            sideBody.innerHTML = side;
            mapCard.innerHTML = `${svgHtml(map, rules, use, goals, selected, marks)}
                <div class="rf-legend">${lgLine('sure', 'route.legend.sure')}${lgLine('maybe', 'route.legend.after')}${lgLine('choice', 'route.legend.choice')}${lgLine('random', 'route.legend.random')}${lgLine('unknown', 'route.legend.unknown')}</div>
                <div class="rf-legend">${lgIcon('rf-wheel', 'route.legend.start')}${lgIcon('rf-oni', 'route.legend.boss')}${lgLine('goal', 'route.legend.goal')}${lgBadge('drift', '<text y="5">!</text>', 'route.legend.drift')}${lgBadge('choice', '<path d="M0 6V0M0 0L-5-5M0 0L5-5"/>', 'route.legend.choice')}${lgBadge('random', '<text y="5">?</text>', 'route.legend.random')}</div>
                ${rules ? sourceHtml(map, rules) : ''}`;
        };

        const pick = (node: string | undefined) => {
            if (!node) return;
            selected = node;
            draw();
        };
        body.addEventListener('click', (event) => {
            const target = (event.target as Element).closest<HTMLElement | SVGGElement>('[data-node]');
            pick(target?.dataset.node);
        });
        body.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const target = (event.target as Element).closest<SVGGElement>('g[data-node]');
            if (!target) return;
            event.preventDefault();
            pick(target.dataset.node);
        });
        mapSel.addEventListener('change', () => {
            prefs.map = mapSel.value; selected = null; saveJsonPrefs(PREFS_KEY, prefs); syncStage(); draw(); drawSuggest();
        });
        for (const tab of fleetTabs) {
            tab.addEventListener('click', () => {
                const n = Number(tab.dataset.fleet);
                if (n === prefs.fleet) return;
                prefs.fleet = n; selected = null; saveJsonPrefs(PREFS_KEY, prefs); draw();
            });
        }
        stageSel.addEventListener('change', () => {
            if (stageSel.value) prefs.stage[prefs.map] = stageSel.value; else delete prefs.stage[prefs.map];
            selected = null; saveJsonPrefs(PREFS_KEY, prefs); draw(); drawSuggest();
        });
        // 世界地圖：開啟時才畫（跟著目前選的海域）；點海域即切換並收起。點浮層外、按 Esc、「完成」都會收起。
        const world = el.querySelector<HTMLDetailsElement>('.rf-world')!;
        const worldScroll = world.querySelector<HTMLElement>('.rf-world-scroll')!;
        // 窄視窗時地圖會比浮層寬：兩側顯示箭頭與漸層、下方提示可左右移動，開啟時先捲到目前海域
        const worldView = world.querySelector<HTMLElement>('.rf-world-view')!;
        const panL = world.querySelector<HTMLButtonElement>('.rf-world-pan-l')!;
        const panR = world.querySelector<HTMLButtonElement>('.rf-world-pan-r')!;
        const panHint = world.querySelector<HTMLElement>('.rf-world-panhint')!;
        const syncPan = () => {
            const max = worldScroll.scrollWidth - worldScroll.clientWidth;
            const canL = max > 1 && worldScroll.scrollLeft > 1;
            const canR = max > 1 && worldScroll.scrollLeft < max - 1;
            panL.hidden = !canL; panR.hidden = !canR; panHint.hidden = max <= 1;
            worldView.classList.toggle('rf-can-l', canL);
            worldView.classList.toggle('rf-can-r', canR);
        };
        worldScroll.addEventListener('scroll', syncPan, { passive: true });
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncPan).observe(worldScroll);
        world.addEventListener('toggle', () => {
            if (!world.hasAttribute('open')) return;
            worldScroll.innerHTML = worldPickerHtml(prefs.map);
            const on = worldScroll.querySelector<HTMLElement>('.rf-wchip.on');
            if (on && worldScroll.scrollWidth > worldScroll.clientWidth + 1) {
                const a = on.getBoundingClientRect(), v = worldScroll.getBoundingClientRect();
                worldScroll.scrollLeft += (a.left + a.width / 2) - (v.left + v.width / 2);
            }
            syncPan();
        });
        // 滑鼠可直接拖曳地圖平移（觸控本來就能滑動）；從海域編號或按鈕開始的不算
        let drag: { x: number; left: number; moved: boolean } | null = null;
        worldScroll.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as Element).closest('button')) return;
            drag = { x: event.clientX, left: worldScroll.scrollLeft, moved: false };
        });
        worldScroll.addEventListener('pointermove', (event) => {
            if (!drag) return;
            const dx = event.clientX - drag.x;
            if (!drag.moved && Math.abs(dx) < 4) return;
            if (!drag.moved) { drag.moved = true; worldScroll.setPointerCapture(event.pointerId); worldScroll.classList.add('rf-dragging'); }
            worldScroll.scrollLeft = drag.left - dx;
        });
        const endDrag = () => { drag = null; worldScroll.classList.remove('rf-dragging'); };
        worldScroll.addEventListener('pointerup', endDrag);
        worldScroll.addEventListener('pointercancel', endDrag);
        const closeWorld = () => { world.open = false; world.querySelector('summary')?.focus(); };
        world.addEventListener('click', (event) => {
            const target = event.target as Element;
            if (target.closest('.rf-world-close')) { closeWorld(); return; }
            const pan = target.closest<HTMLButtonElement>('.rf-world-pan');
            if (pan) { worldScroll.scrollBy({ left: Number(pan.dataset.dir) * worldScroll.clientWidth * 0.6, behavior: 'smooth' }); return; }
            const chip = target.closest<HTMLButtonElement>('.rf-wchip');
            if (!chip?.dataset.map) return;
            mapSel.value = chip.dataset.map;
            mapSel.dispatchEvent(new Event('change'));
            closeWorld();
        });
        // 滑過或聚焦海域編號時，亮起該關的位置點
        const highlight = (map: string | null) => worldScroll.querySelectorAll<SVGCircleElement>('.rf-wd').forEach((dot) =>
            dot.classList.toggle('rf-wd-hl', !!map && (dot.dataset.maps ?? '').split(' ').includes(map)));
        for (const type of ['pointerover', 'focusin'] as const) {
            worldScroll.addEventListener(type, (event) => highlight((event.target as Element).closest<HTMLElement>('.rf-wchip')?.dataset.map ?? null));
        }
        worldScroll.addEventListener('pointerleave', () => highlight(null));
        el.addEventListener('click', (event) => { if (world.open && !world.contains(event.target as Node)) world.open = false; });
        el.addEventListener('keydown', (event) => { if (event.key === 'Escape' && world.open) closeWorld(); });
        // 即時更新：編成改變才重畫內容區；工具列、展開中的世界地圖、選中的分岐點都保留
        ctx.onStateChange?.(() => {
            if (!el.isConnected) return;
            if (fleetSignature(routeFleet(ctx, prefs.fleet)) === shownSignature) return;
            try { draw(); } catch (error) { mapCard.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`; }
        });
        syncStage();
        try { draw(); } catch (error) { mapCard.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`; }
        try { drawSuggest(); } catch (error) { sugBody.innerHTML = `<div class="ov-empty">${esc(String(error))}</div>`; }
    },
};
