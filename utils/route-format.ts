// 常規導航的條件與去向文字（三語）—— 無 chrome.* 與 DOM，只依賴 ui-i18n 的 t()。
import { t } from './ui-i18n';
import type { Cond, GearKind, Outcome, Rule, ShipGroup } from './route-predict';
import type { SuggestPart, SuggestReqs } from './route-suggest';

const groupLabel = (g: ShipGroup) => t(`route.g.${g}`);

function groupsLabel(groups: readonly ShipGroup[], sets: readonly string[] = []): string {
    const names = [...groups.map(groupLabel), ...sets.map((s) => t(`route.set.${s}`))];
    return names.length === 1 ? names[0] : t('route.c.sum', { list: names.join(t('route.c.plus')) });
}

function countText(label: string, min?: number, max?: number): string {
    if (min !== undefined && max !== undefined) {
        if (min === max) return min === 0 ? t('route.c.none', { g: label }) : t('route.c.exact', { g: label, n: min });
        return t('route.c.between', { g: label, min, max });
    }
    if (min !== undefined) return min === 1 ? t('route.c.has', { g: label }) : t('route.c.min', { g: label, n: min });
    if (max !== undefined) return max === 0 ? t('route.c.none', { g: label }) : t('route.c.max', { g: label, n: max });
    return label;
}

function shipsText(min?: number, max?: number): string {
    if (min !== undefined && max !== undefined && min === max) return t('route.c.shipsExact', { n: min });
    if (min !== undefined && max !== undefined) return t('route.c.shipsBetween', { min, max });
    if (min !== undefined) return t('route.c.shipsMin', { n: min });
    return t('route.c.shipsMax', { n: max ?? 0 });
}

const isSlow = (c: Cond) => 'not' in c && 'speed' in c.not && c.not.speed === 'fast' && c.not.mode === 'atLeast';

export function formatCond(c: Cond): string {
    if (isSlow(c)) return t('route.c.slow');
    if ('count' in c) return countText(groupsLabel(c.count, c.sets), c.min, c.max);
    if ('set' in c) return countText(t(`route.set.${c.set}`), c.min, c.max);
    if ('ships' in c) return shipsText(c.ships.min, c.ships.max);
    if ('only' in c) return t('route.c.only', { g: groupsLabel(c.only) });
    if ('flagship' in c) return t('route.c.flagship', { g: groupsLabel(c.flagship) });
    if ('speed' in c) return t(`route.c.speed.${c.speed}.${c.mode}`);
    if ('los' in c) {
        const { cn, min, below } = c.los;
        if (min !== undefined && below !== undefined) return t('route.c.losBetween', { min, max: below, cn });
        if (min !== undefined) return t('route.c.losMin', { n: min, cn });
        return t('route.c.losBelow', { n: below ?? 0, cn });
    }
    if ('losUnknown' in c) return t('route.c.losUnknown');
    if ('carriers' in c) return countText(t(`route.gear.${c.carriers}`), c.min, c.max);
    if ('carriersSum' in c) {
        const list = c.carriersSum.map((k) => t(`route.gear.${k}`)).join(t('route.c.plus'));
        return countText(t('route.c.sum', { list }), c.min, c.max);
    }
    if ('visited' in c) return t('route.c.visited', { node: c.visited });
    if ('phase' in c) return t(`route.phase.${c.phase}`);
    if ('all' in c) return c.all.map(wrap).join(t('route.c.and'));
    if ('any' in c) return c.any.map(wrap).join(t('route.c.or'));
    if ('visited' in c.not) return t('route.c.notVisited', { node: c.not.visited });
    if ('phase' in c.not) return t(`route.phase.not.${c.not.phase}`);
    return t('route.c.not', { c: formatCond(c.not) });
}

/** 巢狀的且／或加括號，避免讀成另一種結合。 */
function wrap(c: Cond): string {
    const s = formatCond(c);
    return ('all' in c || 'any' in c) ? t('route.c.paren', { c: s }) : s;
}

export function formatOutcome(o: Outcome): string {
    if ('go' in o) return o.go;
    if ('random' in o) {
        const list = o.random.join(' / ');
        if (!o.bias) return t('route.o.random', { list });
        return o.bias[1] === null
            ? t('route.o.randomLean', { list, node: o.bias[0] })
            : t('route.o.randomBias', { list, node: o.bias[0], pct: o.bias[1] });
    }
    if ('choice' in o) return t('route.o.choice', { list: o.choice.join(' / ') });
    if ('unknown' in o) return t('route.o.unknown', { list: o.unknown.join(' / ') });
    return '';
}

export function formatRuleCond(r: Rule): string {
    if (r.if) return formatCond(r.if);
    // 沒有條件的「不可考」：wiki 只寫判定類型（例如「索敵」）或下限未明
    return 'unknown' in r ? t('route.c.unknownRest') : t('route.c.otherwise');
}

// ── 到王編成參考 ───────────────────────────────────────────────────
// 編成鍵：FREE／CRUISER 是編成例專用；小寫開頭是 SHIP_SETS 的指定艦，其餘是 ShipGroup
function suggestKeyLabel(key: string): string {
    if (key === 'FREE') return t('route.sug.free');
    if (key === 'CRUISER') return t('route.sug.cruiser');
    return /^[a-z]/.test(key) ? t(`route.set.${key}`) : groupLabel(key as ShipGroup);
}

export function formatSuggestPart(p: SuggestPart): string {
    const names = p.keys.map(suggestKeyLabel);
    const g = names.length === 1 ? names[0] : t('route.c.sum', { list: names.join(t('route.c.plus')) });
    let s = t('route.sug.part', { g, n: p.max === undefined ? p.n : `${p.n}–${p.max}` });
    if (p.etc) s = t('route.sug.etc', { s });
    return p.flag ? t('route.sug.flag', { s }) : s;
}

export function formatSuggestReqs(r: SuggestReqs): string[] {
    const out: string[] = [];
    if (r.speed) out.push(t(`route.c.speed.${r.speed}.atLeast`));
    if (r.slow) out.push(t('route.sug.slow'));
    for (const l of r.los ?? []) out.push(t('route.sug.los', { n: l.approx ? `${l.min}?` : l.min, cn: l.cn }));
    const gear = (Object.entries(r.gear ?? {}) as [GearKind, number][]).map(([k, n]) =>
        countText(t(`route.gear.${k}`), n));
    if (gear.length) out.push(gear.join(r.gearAny ? t('route.c.or') : t('route.c.and')));
    if (r.notFixed) out.push(t('route.sug.notFixed'));
    return out;
}
