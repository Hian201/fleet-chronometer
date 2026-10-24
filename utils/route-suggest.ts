// 常規導航「到王編成參考」的資料型別與共用函式 —— 純函式，無 chrome.*／DOM。
//
// 內容由 tools/route-suggest/ 從攻略站各海域「ルート固定」的實戰編成例整理（utils/route-suggestions.ts）。
// 這裡放產生器、測試與介面共用的部分：型別、規則指紋，以及把一組編成還原成判定器可用的艦隊。
import { MAP_SPOTS } from './map-spots';
import type { GearKind, MapRules, RouteFleet } from './route-predict';

/**
 * 編成的一部分：keys 是 ShipGroup 鍵（route-predict.ts SHIP_GROUPS）、SHIP_SETS 的指定艦鍵，
 * 或 FREE（自由枠）、CRUISER（巡洋艦）；多個鍵＝合計（例：(駆逐+海防)2）。
 */
export interface SuggestPart {
    keys: string[];
    n: number;
    /** 數量為範圍時的上限（例：軽巡0-2 → n 0、max 2）。 */
    max?: number;
    /** 「他」：列出的艦種以外也可以。 */
    etc?: boolean;
    /** 旗艦。 */
    flag?: boolean;
}

export interface SuggestComp {
    parts: SuggestPart[];
    /** 這一組自己的航速需求（來源寫在編成後面，優先於區塊需求）。 */
    speed?: SuggestReqs['speed'];
    /**
     * 以本專案分岐法則推算的結果：match＝預測航路全在列出的路線內；partial＝列出的路線會發生但另有隨機或
     * 不可考的去向；mismatch＝依規則不會走列出的路線；skip＝含範圍表記未驗證。
     */
    verified?: 'match' | 'partial' | 'mismatch' | 'skip';
}

export interface SuggestReqs {
    speed?: 'fast' | 'fastPlus' | 'fastest';
    /** 要含低速艦（不能高速化）。 */
    slow?: boolean;
    /** approx：來源標「?」的門檻。 */
    los?: { cn: number; min: number; approx?: boolean }[];
    /** 搭載指定裝備的艦數下限。 */
    gear?: Partial<Record<GearKind, number>>;
    /** gear 列出的裝備擇一即可（否則全部都要）。 */
    gearAny?: boolean;
    /** 不能固定到王（含隨機）。 */
    notFixed?: boolean;
}

export interface SuggestBlock {
    /** 路線（不含出擊點）；多條為替代路線，括號內節點可經由也可不經由。 */
    routes: string[];
    /** 道中戰數（不含王點與渦潮等非戰鬥點）；來源未標各點性質時為 null。 */
    battles: number | null;
    reqs: SuggestReqs;
    comps: SuggestComp[];
}

export interface SuggestHop {
    node: string;
    /** 可經由也可不經由（來源寫成括號）。 */
    optional: boolean;
}

/**
 * 路線字串 → 節點序列。節點名可能多字元（A1、C2），依該圖實際節點名由長到短比對；
 * 有無法辨識的字元時回傳空陣列。
 */
export function suggestRouteHops(map: string, route: string): SuggestHop[] {
    const names = Object.keys(MAP_SPOTS[map]?.spots ?? {}).sort((a, b) => b.length - a.length);
    const out: SuggestHop[] = [];
    let optional = false;
    for (let i = 0; i < route.length;) {
        const ch = route[i];
        if (ch === '(' || ch === ')') { optional = ch === '('; i++; continue; }
        const name = names.find((n) => route.startsWith(n, i));
        if (!name) return [];
        out.push({ node: name, optional });
        i += name.length;
    }
    return out;
}

/** 路線字串 → 所有可能的節點陣列：括號內的節點群整組經由或不經由。 */
export function expandSuggestRoute(map: string, route: string): string[][] {
    const hops = suggestRouteHops(map, route);
    let acc: string[][] = [[]];
    for (let i = 0; i < hops.length;) {
        if (!hops[i].optional) { const n = hops[i++].node; acc = acc.map((a) => [...a, n]); continue; }
        const group: string[] = [];
        while (i < hops.length && hops[i].optional) group.push(hops[i++].node);
        acc = acc.flatMap((a) => [a, [...a, ...group]]);
    }
    return acc.filter((a) => a.length);
}

/** 依目標點篩選並排序：道中戰數少的在前（不明放最後），同戰數時路線短的在前。 */
export function suggestionsFor(map: string, blocks: readonly SuggestBlock[], goals: readonly string[]): SuggestBlock[] {
    const ends = (b: SuggestBlock) => b.routes.some((r) => {
        const hops = suggestRouteHops(map, r);
        return goals.includes(hops[hops.length - 1]?.node);
    });
    const len = (b: SuggestBlock) => Math.min(...b.routes.map((r) => suggestRouteHops(map, r).filter((h) => !h.optional).length));
    return blocks.filter(ends).sort((a, b) =>
        (a.battles ?? Infinity) - (b.battles ?? Infinity) || len(a) - len(b));
}

/** 驗證用的一艘船：判定只需要艦種、航速、指定艦的 master id／艦型與搭載的裝備種類。 */
export interface SuggestShip {
    stype: number;
    soku: number;
    mst?: number;
    ctype?: number;
    gears?: GearKind[];
}

/** 很高的索敵值：驗證時假設索敵已達需求。 */
export const LOS_HIGH = 999;

// 判定器只看 master id（輸送桶）或 api_type[2]（大發、電探）；這裡用最基本的一件代表
const GEAR_SAMPLE: Record<GearKind, { mst: number; type: number }> = {
    drum: { mst: 75, type: 30 },
    daihatsu: { mst: 68, type: 24 },
    radar: { mst: 27, type: 12 },
};

export function suggestionFleet(ships: readonly SuggestShip[], losValue: Readonly<Record<number, number>> = {}): RouteFleet {
    return {
        ships: ships.map((s) => ({
            mst: s.mst ?? 0,
            stype: s.stype,
            ctype: s.ctype ?? null,
            soku: s.soku,
            gears: (s.gears ?? []).map((k) => GEAR_SAMPLE[k]),
        })),
        los: (cn) => losValue[cn] ?? LOS_HIGH,
    };
}

/** 規則與路線資料的指紋：產生物記錄產生當下的值，規則改了測試就要求重跑產生器。 */
export function rulesFingerprint(rules: Readonly<Record<string, MapRules>>): string {
    const text = JSON.stringify(Object.keys(rules).sort().map((k) => [k, rules[k], MAP_SPOTS[k]]));
    // FNV-1a 32 位元
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
