// 重播保留規則引擎——決定 db.replays 每一場「永久保留 / 在裁剪窗內 / 可裁剪」。
// 純函式、無 chrome.*（設計原則 4：核心零瀏覽器依賴，可獨立編譯用 node 餵資料測試）。
//
// 動機（見 CLAUDE.md 待辦「重播裁剪」）：db.replays 每場存原始戰鬥封包，會隨出擊數線性
// 膨脹（KC3Kai 備份長到 300MB＋的同源資料）。但玩家的取捨是「大部分週回/路過場是耗材、
// 少數關鍵場是紀念品」，所以先判斷哪些該永久保護，剩下的才進「最近一段時間」的裁剪窗。
//
// 保留判定（由上而下，任一命中即保留）：
//   1. pinned    ── 手動 ★ 釘選（涵蓋任何無法用規則描述的紀念場）
//   2. newShip   ── 有 master ID＋首次 auto 觀測 event 順序可證明的首次持有掉落
//   3. cleared   ── 斬殺（這場擊破了海域量表；SortieLogRow.cleared）
//   4. eventBoss ── 活動海域（diff>0）的 boss 場（範圍較寬，可關）
//   5. uncleared ── 所屬海域「目前尚未通關」＝攻略中，過程場也先全留（含索敵/routing 確認）
//   6. recent    ── 以上皆非，但在裁剪窗內（最近 N 天，且保底最近 N 場）
//   其餘 → prune（可裁剪）
import type { ReplayRow, ShipObtainedRow, SortieLogRow } from './db';

export type KeepReason = 'pinned' | 'newShip' | 'cleared' | 'eventBoss' | 'uncleared' | 'recent';

export interface RetentionConfig {
    keepRecentDays: number;    // 未保護場次保留天數（預設 45，足以覆蓋一次活動全期）
    keepRecentCount: number;   // 保底：無論多舊都留最近 N 場（避免久違回歸者被清光）
    protectNewShip: boolean;
    protectCleared: boolean;
    protectEventBoss: boolean;
    protectUncleared: boolean;
}

export const DEFAULT_RETENTION: RetentionConfig = {
    keepRecentDays: 45,
    keepRecentCount: 30,
    protectNewShip: true,
    protectCleared: true,
    protectEventBoss: true,
    protectUncleared: true,
};

export interface RetentionDecision {
    sortieKey: number;
    keep: boolean;
    reason: KeepReason | null;   // keep=true 時為保留原因；keep=false 時為 null
}

// 一次出擊（sortieKey）可能有多筆 SortieLogRow（每個戰鬥/空襲節點一筆），聚合成單場屬性。
interface SortieAgg {
    boss: boolean;
    cleared: boolean;
}

function aggregateSorties(sorties: SortieLogRow[]): Map<number, SortieAgg> {
    const m = new Map<number, SortieAgg>();
    for (const s of sorties) {
        let a = m.get(s.sortieKey);
        if (!a) { a = { boss: false, cleared: false }; m.set(s.sortieKey, a); }
        if (s.boss) a.boss = true;
        if (s.cleared) a.cleared = true;
    }
    return m;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
}

// 「真正首次持有的新船」判定：每個 master ID 先取 api_id 最小的收藏紀錄（api_id 是艦實例的
// 入手順序），再要求該筆是 auto 且具可靠 raw event ID。最後只關聯 observation 前、相同
// dropMst、event ID 最大的 battle-result。任何舊欄位缺失或 baseline/manual 證據都不猜測。
export function firstOwnedDropKeys(
    sorties: SortieLogRow[],
    shipObtained: ShipObtainedRow[],
): Set<number> {
    const firstOwnedByMst = new Map<number, ShipObtainedRow>();
    for (const row of [...shipObtained].sort((left, right) => left.id - right.id)) {
        if (!isPositiveSafeInteger(row.id) || !isPositiveSafeInteger(row.mst)
            || firstOwnedByMst.has(row.mst)) continue;
        firstOwnedByMst.set(row.mst, row);
    }

    const keys = new Set<number>();
    for (const [mst, firstOwned] of firstOwnedByMst) {
        if (firstOwned.source !== 'auto' || !isPositiveSafeInteger(firstOwned.observedEventId)) continue;
        let nearest: SortieLogRow | undefined;
        for (const sortie of sorties) {
            if (sortie.kind !== 'battle' || sortie.dropMst !== mst
                || !isPositiveSafeInteger(sortie.eventId)
                || sortie.eventId >= firstOwned.observedEventId) continue;
            if (!nearest || sortie.eventId > nearest.eventId) nearest = sortie;
        }
        if (nearest) keys.add(nearest.sortieKey);
    }
    return keys;
}

// 決定每一場的去留。
//   replays        ── db.replays 全量
//   sorties        ── db.sorties 全量（提供 boss/cleared/dropMst，join by sortieKey）
//   shipObtained   ── db.shipObtained 全量（提供 master ID 的首次持有來源與 raw event 順序）
//   unclearedMaps  ── 目前尚未通關的海域字串集合（如 '61-5'），來自當前 GameState.mapGauges；
//                     不在此集合＝已通關或該圖已不在 mapinfo（活動結束）→ 過程場可老化
//   now            ── 現在時間（ms），裁剪窗基準
export function planRetention(
    replays: ReplayRow[],
    sorties: SortieLogRow[],
    shipObtained: ShipObtainedRow[],
    unclearedMaps: Set<string>,
    cfg: RetentionConfig,
    now: number,
): RetentionDecision[] {
    const agg = aggregateSorties(sorties);
    const newShipKeys = cfg.protectNewShip ? firstOwnedDropKeys(sorties, shipObtained) : new Set<number>();
    const windowStart = now - cfg.keepRecentDays * 86400_000;

    // 先算保護原因；未受保護者收集起來，之後套「最近 N 天／保底 N 場」。
    const decisions: RetentionDecision[] = [];
    const unprotected: ReplayRow[] = [];
    for (const r of replays) {
        const a = agg.get(r.sortieKey);
        const mapStr = `${r.world}-${r.mapnum}`;
        let reason: KeepReason | null = null;
        if (r.pinned) reason = 'pinned';
        else if (newShipKeys.has(r.sortieKey)) reason = 'newShip';
        else if (cfg.protectCleared && a?.cleared) reason = 'cleared';
        else if (cfg.protectEventBoss && r.diff > 0 && a?.boss) reason = 'eventBoss';
        else if (cfg.protectUncleared && unclearedMaps.has(mapStr)) reason = 'uncleared';

        if (reason) decisions.push({ sortieKey: r.sortieKey, keep: true, reason });
        else unprotected.push(r);
    }

    // 未保護：最近 keepRecentDays 天內保留；另保底保留最近 keepRecentCount 場（不論多舊）。
    const byRecent = [...unprotected].sort((a, b) => b.ts - a.ts);
    const flooredKeys = new Set(byRecent.slice(0, cfg.keepRecentCount).map(r => r.sortieKey));
    for (const r of unprotected) {
        const keep = r.ts >= windowStart || flooredKeys.has(r.sortieKey);
        decisions.push({ sortieKey: r.sortieKey, keep, reason: keep ? 'recent' : null });
    }
    return decisions;
}
