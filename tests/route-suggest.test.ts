import { describe, expect, it } from 'vitest';
import { MAP_SPOTS } from '../utils/map-spots';
import { goalsOf, predictRoutes } from '../utils/route-predict';
import { ROUTE_RULES } from '../utils/route-rules-data';
import { formatSuggestPart, formatSuggestReqs } from '../utils/route-format';
import { ROUTE_SUGGESTIONS, RULES_FINGERPRINT } from '../utils/route-suggestions';
import { expandSuggestRoute, rulesFingerprint, suggestionFleet, suggestionsFor, suggestRouteHops, type SuggestBlock } from '../utils/route-suggest';
import { setLang } from '../utils/ui-i18n';

const edgeSet = (map: string) => new Set(Object.values(MAP_SPOTS[map].routes).map(([a, b]) => `${a}>${b}`));

describe('到王編成參考', () => {
    it('產生物的規則指紋與目前規則一致（規則改了要重跑 tools/route-suggest/generate.ts）', () => {
        expect(RULES_FINGERPRINT).toBe(rulesFingerprint(ROUTE_RULES));
    });

    it('37 張常規海域都有編成例', () => {
        expect(Object.keys(ROUTE_SUGGESTIONS).sort()).toEqual(Object.keys(ROUTE_RULES).sort());
        for (const [map, blocks] of Object.entries(ROUTE_SUGGESTIONS)) expect(blocks.length, map).toBeGreaterThan(0);
    });

    it('每條路線都在地圖上、從出擊點可達，終點是該圖的目標點', () => {
        for (const [map, blocks] of Object.entries(ROUTE_SUGGESTIONS)) {
            const edges = edgeSet(map);
            const { starts } = MAP_SPOTS[map];
            const goals = goalsOf(ROUTE_RULES[map], null);
            for (const b of blocks) {
                for (const r of b.routes) {
                    const alts = expandSuggestRoute(map, r);
                    expect(alts.length, `${map} ${r}`).toBeGreaterThan(0);
                    for (const alt of alts) {
                        expect(starts.some((s) => s === alt[0] || edges.has(`${s}>${alt[0]}`)), `${map} ${r} 起點`).toBe(true);
                        alt.slice(1).forEach((n, i) => expect(edges.has(`${alt[i]}>${n}`), `${map} ${r} ${alt[i]}>${n}`).toBe(true));
                        expect(goals, `${map} ${r} 終點`).toContain(alt[alt.length - 1]);
                    }
                }
            }
        }
    });

    it('5-6：較新實測的兩個編成（潜水6 經 C1、戦艦1正空2軽空1駆逐2 經 U）', () => {
        const nodes = (fleet: Parameters<typeof suggestionFleet>[0], stage: string) =>
            predictRoutes('5-6', ROUTE_RULES['5-6'], suggestionFleet(fleet), stage).paths.map((p) => p.steps.map((s) => s.to).join(''));
        expect(nodes(Array(6).fill({ stype: 13, soku: 5 }), 'g2gimmick')).toContain('1A1A2BC1CHR');
        const fleet = [{ stype: 8, soku: 5 }, { stype: 11, soku: 10 }, { stype: 11, soku: 10 }, { stype: 7, soku: 10 }, { stype: 2, soku: 10 }, { stype: 2, soku: 10 }];
        expect(nodes(fleet, 'g3').some((n) => n.includes('QU'))).toBe(true);
        // 軽空母換成駆逐就不是確認過的編成：照分岐表（(戦艦級＋正規空母)3 且無軽巡）走 Q2
        expect(nodes([...fleet.slice(0, 3), { stype: 2, soku: 10 }, ...fleet.slice(4)], 'g3').some((n) => n.includes('QQ2'))).toBe(true);
    });

    it('路線拆解：多字元節點與括號內的可選節點', () => {
        expect(suggestRouteHops('5-6', 'A1A2BC1CHR').map((h) => h.node)).toEqual(['A1', 'A2', 'B', 'C1', 'C', 'H', 'R']);
        expect(expandSuggestRoute('1-3', 'A(DB)EFJ')).toEqual([['A', 'E', 'F', 'J'], ['A', 'D', 'B', 'E', 'F', 'J']]);
        expect(suggestRouteHops('1-1', 'AX?')).toEqual([]);
    });

    it('依目標點篩選，道中戰數少的在前、不明的放最後', () => {
        const blocks: SuggestBlock[] = [
            { routes: ['BFM'], battles: null, reqs: {}, comps: [] },
            { routes: ['BCFM'], battles: 3, reqs: {}, comps: [] },
            { routes: ['ADG'], battles: 1, reqs: {}, comps: [] },
            { routes: ['BFM'], battles: 2, reqs: {}, comps: [] },
        ];
        expect(suggestionsFor('7-2', blocks, ['M']).map((b) => b.battles)).toEqual([2, 3, null]);
        expect(suggestionsFor('7-2', blocks, ['G']).map((b) => b.routes[0])).toEqual(['ADG']);
    });

    it('三語文案沒有未翻譯的鍵或空值', () => {
        for (const lang of ['zh-TW', 'en', 'ja'] as const) {
            setLang(lang);
            for (const [map, blocks] of Object.entries(ROUTE_SUGGESTIONS)) {
                for (const b of blocks) {
                    const text = [...formatSuggestReqs(b.reqs), ...b.comps.flatMap((c) => c.parts.map(formatSuggestPart))].join(' ');
                    expect(text, `${lang} ${map}`).not.toMatch(/route\.|\{\w+\}|undefined|NaN/);
                }
            }
        }
        setLang('zh-TW');
    });
});
