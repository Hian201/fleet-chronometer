// 打撈紀錄的「新船／非新船」判定（純函式，無 chrome.*、無 Dexie，node 可測）。
//
// **判準與面板出擊資訊的 Drop 晶片同一條**（`GameState.ownsShip()` ＋
// `battleInfo.dropIsNew`）：比對鎮守府全艦娘之後，**這一撈才讓這艘船第一次成為鎮守府
// 的成員**才算新船。兩個要點都跟著面板走：
//
//   1. **以基礎形態比對**：手上是改二時再撈到本體算已持有。艦娘入手紀錄
//      （`db.shipObtained`）的 `mst` 是「首次觀測到那一刻的形態」，改造之後不會回頭改，
//      故一律經 `baseOf()` 正規化再比——用原始 mst 直接比會在名冊改造過之後整批失準。
//   2. **既有的船不算新船**：入手紀錄的 `source` 不是 `'auto'`（`null`＝擴充安裝前就在的
//      基準線、`'manual'`＝玩家手填）代表這艘船進鎮守府那一刻本擴充沒看到，**沒有任何
//      一筆打撈紀錄能是它的入手來源**，故該基礎形態的所有打撈一律非新船。不猜。
//
// ⚠️ **與 `retention.ts` 的 `firstOwnedDropKeys()` 是兩支，別合併**：那支決定「這場重播
// 要不要永久保護不被裁剪」，錯了會刪掉再也拿不回來的原始封包，故刻意嚴格（要求
// `observedEventId` 這種精確錨點、對不上寧可不保護）。本支只決定清單怎麼篩，錯了重新
// 篩一次就好，故可以用時間錨點涵蓋到更多真實情況（含匯入的歷史紀錄）。
import type { ShipObtainedRow, SortieLogRow } from './db';

function isPositiveSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * 回傳「是新船」的那些打撈記錄 event id（`SortieLogRow.eventId`）。
 *
 * @param rows          打撈紀錄列（已篩成有掉落艦的結算列即可，順序不拘）
 * @param shipObtained  `db.shipObtained` 全量
 * @param baseOf        master id → 基礎形態 master id（`GameState.baseShipId`）；
 *                      master 未載入時它會退化成原樣回傳，屆時等同用原始 mst 比對。
 */
export function newShipDropKeys(
    rows: SortieLogRow[],
    shipObtained: ShipObtainedRow[],
    baseOf: (masterId: number | undefined) => number | null,
): Set<number> {
    // 每個基礎形態的「第一位成員」：api_id 是艦實例的入手順序（單調遞增、不重用），
    // 故最小的那筆就是這個基礎形態第一次進鎮守府的那一艘。
    const firstOwnedByBase = new Map<number, ShipObtainedRow>();
    for (const row of [...shipObtained].sort((left, right) => left.id - right.id)) {
        if (!isPositiveSafeInteger(row.id) || !isPositiveSafeInteger(row.mst)) continue;
        const base = baseOf(row.mst);
        if (base == null || firstOwnedByBase.has(base)) continue;
        firstOwnedByBase.set(base, row);
    }

    // 打撈紀錄依基礎形態分組，供下面各自找「入手那一撈」。
    const dropsByBase = new Map<number, SortieLogRow[]>();
    for (const row of rows) {
        if (!isPositiveSafeInteger(row.dropMst)) continue;
        const base = baseOf(row.dropMst);
        if (base == null) continue;
        const list = dropsByBase.get(base);
        if (list) list.push(row); else dropsByBase.set(base, [row]);
    }

    const keys = new Set<number>();
    for (const [base, drops] of dropsByBase) {
        const firstOwned = firstOwnedByBase.get(base);
        // 沒有入手紀錄（名冊還沒觀測到）或不是自動觀測到的入手 → 不猜是哪一撈帶進來的。
        if (!firstOwned || firstOwned.source !== 'auto') continue;
        const observedTs = firstOwned.obtainedTs;
        if (!Number.isFinite(observedTs as number)) continue;
        // 入手紀錄寫在 api_port/port（回港）當下，掉落則發生在同一次出擊的結算，故
        // 「入手那一撈」＝觀測時刻**之前**最後一次撈到這個基礎形態的紀錄。
        // 用時間而非 event ID 當錨點：匯入的歷史紀錄借的是匯入當下的 event ID，
        // 與真實 raw event 順序無關，拿去比會把整批歷史紀錄排到現在之後。
        const eligible = drops.filter(drop => Number.isFinite(drop.ts) && drop.ts <= (observedTs as number));
        if (!eligible.length) continue;
        const newestTs = Math.max(...eligible.map(drop => drop.ts));
        const newestAtSameMs = eligible.filter(drop => drop.ts === newestTs);
        const sameSortieKeys = new Set(newestAtSameMs.map(drop => drop.sortieKey));
        if (sameSortieKeys.size === 1) {
            // 同一場出擊可能有多筆掉落列；每列仍以自己的 eventId 識別，避免修正一筆時
            // 把同場其他艦娘一併排除。
            for (const drop of newestAtSameMs) {
                if (Number.isSafeInteger(drop.eventId)) keys.add(drop.eventId);
            }
            continue;
        }
        // 同毫秒有多場時，只有全部都是本機擷取且 eventId 都有效，才能用 raw event 順序
        // 收斂。匯入列的 eventId 是借號，混入比較會讓結果受匯入先後而非真實順序支配；
        // 此時沒有足夠資料判定入手來源，寧可不標新船。
        if (newestAtSameMs.some(drop => drop.imported === true)) continue;
        const withEventId = newestAtSameMs.filter(drop => Number.isSafeInteger(drop.eventId));
        if (withEventId.length !== newestAtSameMs.length) continue;
        const newestEventId = Math.max(...withEventId.map(drop => drop.eventId as number));
        const eventWinners = withEventId.filter(drop => drop.eventId === newestEventId);
        if (eventWinners.length === 1) keys.add(eventWinners[0].eventId);
    }
    return keys;
}
