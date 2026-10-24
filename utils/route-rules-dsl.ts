// 航路預測規則的寫法小工具 —— 純資料轉寫用的簡寫，無 chrome.*／DOM。
// 規則資料分在 route-rules-eo.ts（Extra Operation）與 route-rules-w*.ts（各大區），由 route-rules-data.ts 彙整。
import type { Cond, GearKind, Rule, ShipGroup, ShipSet } from './route-predict';

export const has = (...g: ShipGroup[]): Cond => ({ count: g, min: 1 });
export const none = (...g: ShipGroup[]): Cond => ({ count: g, max: 0 });
export const atLeast = (n: number, ...g: ShipGroup[]): Cond => ({ count: g, min: n });
export const atMost = (n: number, ...g: ShipGroup[]): Cond => ({ count: g, max: n });
export const exactly = (n: number, ...g: ShipGroup[]): Cond => ({ count: g, min: n, max: n });
/** 群組加指定艦合計（例：(軽空母+あきつ丸)3隻以上）。 */
export const withSets = (g: ShipGroup[], sets: ShipSet[], min?: number, max?: number): Cond => ({ count: g, sets, min, max });
export const ships = (min?: number, max?: number): Cond => ({ ships: { min, max } });
export const hasShip = (set: ShipSet): Cond => ({ set, min: 1 });
export const noShip = (set: ShipSet): Cond => ({ set, max: 0 });
export const all = (...c: Cond[]): Cond => ({ all: c });
export const any = (...c: Cond[]): Cond => ({ any: c });
export const not = (c: Cond): Cond => ({ not: c });
export const only = (...g: ShipGroup[]): Cond => ({ only: g });
export const flagship = (...g: ShipGroup[]): Cond => ({ flagship: g });
/** 低速艦を含む。 */
export const slow: Cond = { not: { speed: 'fast', mode: 'atLeast' } };
export const fastAtLeast: Cond = { speed: 'fast', mode: 'atLeast' };
export const fastExact: Cond = { speed: 'fast', mode: 'exact' };
export const fastPlusAtLeast: Cond = { speed: 'fastPlus', mode: 'atLeast' };
export const fastPlusExact: Cond = { speed: 'fastPlus', mode: 'exact' };
export const fastest: Cond = { speed: 'fastest', mode: 'atLeast' };
export const los = (cn: number, min?: number, below?: number): Cond => ({ los: { cn, min, below } });
export const visited = (node: string): Cond => ({ visited: node });
export const radars = (min?: number, max?: number): Cond => ({ carriers: 'radar', min, max });
export const carriers = (kind: GearKind, min?: number, max?: number): Cond => ({ carriers: kind, min, max });
export const carriersSum = (kinds: GearKind[], min?: number, max?: number): Cond => ({ carriersSum: kinds, min, max });

export const lean = (node: string): readonly [string, null] => [node, null];
export const pc = (node: string, n: number): readonly [string, number] => [node, n];

export const go = (to: string, cond?: Cond, tentative?: boolean): Rule => ({ go: to, ...(cond ? { if: cond } : {}), ...(tentative ? { tentative } : {}) });
export const random = (to: readonly string[], cond?: Cond, bias?: readonly [string, number | null], tentative?: boolean): Rule => ({
    random: to, ...(cond ? { if: cond } : {}), ...(bias ? { bias } : {}), ...(tentative ? { tentative } : {}),
});
export const choice = (to: string[]): Rule => ({ choice: to });
export const unknown = (to: string[], cond?: Cond): Rule => ({ unknown: to, ...(cond ? { if: cond } : {}) });
export const when = (cond: Cond, then: Rule[], tentative?: boolean): Rule => ({ if: cond, then, ...(tentative ? { tentative } : {}) });
