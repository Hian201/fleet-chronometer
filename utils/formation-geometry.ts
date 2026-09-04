/**
 * Canonical 6×6 ship-marker rectangles for the sortie formation icons.
 *
 * The inline SVG in the formal panel and the offline preview both consume
 * these same top-left coordinates. Keeping the rectangle convention here is
 * intentional: the old implementations mixed rectangle origins with dot
 * centres, which shifted several formations toward the upper-left corner.
 */
export type FormationRect = readonly [number, number];

const FORMATION_RECT_LAYOUTS: Record<number, readonly FormationRect[]> = {
    1: [[28, 5], [28, 14], [28, 23], [28, 31], [28, 40], [28, 49]],
    2: [[20, 11], [36, 11], [20, 27], [36, 27], [20, 43], [36, 43]],
    3: [[28, 8], [28, 21], [28, 34], [28, 46], [9, 27], [47, 27]],
    4: [[42, 11], [36, 18], [30, 24], [24, 30], [18, 36], [11, 42]],
    5: [[5, 27], [14, 27], [23, 27], [32, 27], [40, 27], [49, 27]],
    // 已確認置中的警戒陣保留原本放大預覽的六艦位置。
    6: [[28, 7], [15, 21], [41, 21], [28, 31], [28, 41], [28, 50]],
    11: [[7, 23], [7, 33], [18, 14], [18, 23], [18, 33], [18, 42], [29, 28], [35, 10], [35, 46], [43, 19], [43, 37], [49, 28]],
    12: [[7, 24], [7, 34], [15, 24], [15, 34], [23, 24], [23, 34], [31, 24], [31, 34], [39, 29], [47, 19], [47, 29], [47, 39]],
    13: [[6, 29], [19, 26], [19, 32], [20, 17], [20, 41], [27, 26], [27, 32], [34, 17], [34, 41], [35, 26], [35, 32], [48, 29]],
    14: [[7, 24], [7, 34], [15, 24], [15, 34], [21, 29], [29, 29], [35, 24], [35, 34], [42, 29], [43, 21], [43, 37], [50, 29]],
};

const DOT_CENTER = 31;
const DOT_SIZE = 6;
const TOP_LEFT_CENTER = DOT_CENTER - DOT_SIZE / 2;

const roundCoordinate = (value: number) => Math.round(value * 2) / 2;

/**
 * Centre each layout by its outer marker bounds while retaining the original
 * relative spacing. A half-pixel is allowed because the SVG is scaled down;
 * it keeps the visual envelope centred without changing the game-like pattern.
 */
const centredLayout = (rects: readonly FormationRect[]): FormationRect[] => {
    const xs = rects.map(([x]) => x);
    const ys = rects.map(([, y]) => y);
    const dx = roundCoordinate(TOP_LEFT_CENTER - (Math.min(...xs) + Math.max(...xs)) / 2);
    const dy = roundCoordinate(TOP_LEFT_CENTER - (Math.min(...ys) + Math.max(...ys)) / 2);
    return rects.map(([x, y]) => [roundCoordinate(x + dx), roundCoordinate(y + dy)]);
};

/**
 * Rectangles are exported after centring so every renderer has one source of
 * truth and every dot remains safely inside the circular frame.
 */
export const FORMATION_RECTS: Readonly<Record<number, readonly FormationRect[]>> = Object.freeze(
    Object.fromEntries(Object.entries(FORMATION_RECT_LAYOUTS).map(([id, rects]) => [
        id,
        Number(id) === 6 ? rects : centredLayout(rects),
    ])) as Record<number, readonly FormationRect[]>,
);

export const formationRects = (id: number): readonly FormationRect[] =>
    FORMATION_RECTS[id] ?? FORMATION_RECTS[1];

