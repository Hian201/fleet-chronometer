// 編成寫真（面板拍照托盤）的純函式：遊戲畫面裁切範圍、合成圖版面、預設艦隊類型與
// 「拍完之後編成是否變過」的簽章。無 chrome.*／DOM 相依，可用 Vitest 直接驗證。

/** 遊戲畫布的原生座標系。裁切範圍一律以此表示，再依實際畫布像素換算。 */
export const GAME_W = 1200;
export const GAME_H = 720;

export interface PhotoRect { x: number; y: number; width: number; height: number }

/**
 * 遊戲畫面上要擷取的區塊（遊戲 1200×720 座標）。
 *
 * - `ship`：「編成」→ 艦娘「詳細」右側的艦船ステータス面板（艦名列到補強增設列、含卡圖）。
 * - `lbas`：出擊 → 基地航空隊面板，自「第N基地航空隊」名稱列起到第四中隊，
 *   不含上方的海域橫幅（行動與半徑改由標題列繪製）。
 *
 * 兩者都是以縮放過的實機截圖換算量得，精度約 ±2px；首次以原生畫布實拍後需再校準。
 */
export const PHOTO_REGIONS = {
    ship: { x: 485, y: 154, width: 684, height: 546 },
    lbas: { x: 862, y: 274, width: 334, height: 422 },
} as const satisfies Record<string, PhotoRect>;
export type PhotoRegion = keyof typeof PHOTO_REGIONS;

/** 把遊戲座標的裁切範圍換算成實際畫布像素（畫布解析度不一定等於 1200×720）。 */
export function regionToCanvasPx(region: PhotoRect, canvasW: number, canvasH: number): PhotoRect | null {
    if (!(canvasW > 0) || !(canvasH > 0)) return null;
    const sx = canvasW / GAME_W, sy = canvasH / GAME_H;
    const x = Math.round(region.x * sx), y = Math.round(region.y * sy);
    const width = Math.min(Math.round(region.width * sx), canvasW - x);
    const height = Math.min(Math.round(region.height * sy), canvasH - y);
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

/**
 * 判斷讀回來的像素是不是「空白」：WebGL 畫布在繪製週期外讀取時會得到全透明或全黑。
 * `data` 是 RGBA 取樣；所有樣本都透明，或全部同一個顏色，就視為沒有讀到畫面。
 */
export function isBlankSample(data: ArrayLike<number>): boolean {
    if (data.length < 4) return true;
    let opaque = false;
    const r0 = data[0], g0 = data[1], b0 = data[2];
    let uniform = true;
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] !== 0) opaque = true;
        if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) uniform = false;
    }
    return !opaque || uniform;
}

// ── 艦隊類型 ───────────────────────────────────────
export const FLEET_PHOTO_TYPES = ['normal', 'striking', 'ctf', 'stf', 'tef', 'vanguard', 'decisive'] as const;
export type FleetPhotoType = typeof FLEET_PHOTO_TYPES[number];

/**
 * 預設艦隊類型：連合艦隊依遊戲回報的連合種別（`api_combined_flag` 1/2/3）；
 * 七艘編成為遊擊部隊；其餘為通常艦隊。支援艦隊無法從封包判斷，只能由使用者選。
 */
export function defaultFleetPhotoType(target: 'fleet' | 'combined', shipCount: number, combinedFlag: number): FleetPhotoType {
    if (target === 'combined') {
        if (combinedFlag === 1) return 'ctf';
        if (combinedFlag === 2) return 'stf';
        if (combinedFlag === 3) return 'tef';
        return 'normal';
    }
    return shipCount >= 7 ? 'striking' : 'normal';
}

// ── 合成圖版面 ──────────────────────────────────────
/** 連合艦隊主力與護衛之間的間距（原尺寸 px）。 */
export const COMBINED_GAP = 48;
/** 標題列第一行（類型＋摘要）高度。 */
export const HEAD_H = 52;
/** 基地航空隊標題列第二行（各隊行動／半徑，逐欄對齊）高度。 */
export const LBAS_SUB_H = 34;

export interface PhotoLayoutInput {
    /** fleet：單一艦隊 2 欄；combined：主力｜護衛並排；lbas：一列。 */
    kind: 'fleet' | 'combined' | 'lbas';
    /** 各區塊的格數（combined 為 [主力, 護衛]，其餘只有一個）。 */
    counts: number[];
    header: boolean;
    /** 基地航空隊標題列是否畫第二行。 */
    lbasSub?: boolean;
    /** 輸出縮放（1＝原尺寸）。 */
    scale: number;
}
export interface PhotoCell { block: number; index: number; x: number; y: number; width: number; height: number }
export interface PhotoLayout {
    width: number; height: number;
    headHeight: number; subHeight: number;
    blocks: PhotoRect[];
    cells: PhotoCell[];
    /** 基地航空隊各欄左緣（標題列第二行逐欄對齊用）。 */
    columnX: number[];
}

/**
 * 合成圖版面。艦隊與遊戲編成畫面相同：2 欄、由左而右再往下；連合艦隊主力在左、
 * 護衛在右；基地航空隊依該海域基地數排成一列。格子位置只依序號決定，未拍的格子
 * 留空而不往前遞補，避免順序錯位。
 */
export function photoLayout(input: PhotoLayoutInput): PhotoLayout {
    const s = input.scale;
    const region = input.kind === 'lbas' ? PHOTO_REGIONS.lbas : PHOTO_REGIONS.ship;
    const cw = Math.round(region.width * s), ch = Math.round(region.height * s);
    const headHeight = input.header ? Math.round(HEAD_H * s) : 0;
    const subHeight = input.header && input.kind === 'lbas' && input.lbasSub ? Math.round(LBAS_SUB_H * s) : 0;
    const top = headHeight + subHeight;
    const blocks: PhotoRect[] = [];
    const cells: PhotoCell[] = [];
    const columnX: number[] = [];
    let x = 0;
    input.counts.forEach((count, b) => {
        const cols = input.kind === 'lbas' ? Math.max(1, count) : 2;
        const rows = Math.max(1, Math.ceil(count / cols));
        if (b > 0) x += Math.round(COMBINED_GAP * s);
        blocks.push({ x, y: top, width: cols * cw, height: rows * ch });
        for (let i = 0; i < count; i++) {
            cells.push({ block: b, index: i, x: x + (i % cols) * cw, y: top + Math.floor(i / cols) * ch, width: cw, height: ch });
        }
        if (input.kind === 'lbas') for (let c = 0; c < cols; c++) columnX.push(x + c * cw);
        x += cols * cw;
    });
    const height = top + Math.max(0, ...blocks.map(bk => bk.height));
    return { width: x, height, headHeight, subHeight, blocks, cells, columnX };
}

// ── 變更偵測 ──────────────────────────────────────
interface GearLike { mst: number; level: number }
interface ShipLike { id: number; mst: number; gears: (GearLike | null)[]; exGear: GearLike | null }
interface SquadronLike { state: number; mst: number; level: number }

/**
 * 艦船狀態卡會因為「換船、改造、換裝備、改修」而改變。Lv／HP／熟練度在出擊後天天變，
 * 若算進來每場戰鬥都會把整排標成需重拍，故刻意不列入。
 */
export function shipPhotoSignature(ship: ShipLike): string {
    const g = (x: GearLike | null) => (x ? `${x.mst}+${x.level}` : '-');
    return `${ship.id}:${ship.mst}:${ship.gears.map(g).join(',')}|${g(ship.exGear)}`;
}

/** 基地航空隊面板的中隊配置與改修。機數、疲勞會隨出擊變動，不列入。 */
export function basePhotoSignature(squadrons: SquadronLike[]): string {
    return squadrons.map(sq => (sq.state === 1 ? `${sq.mst}+${sq.level}` : '-')).join(',');
}
