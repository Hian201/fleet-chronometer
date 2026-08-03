// 「新船／已持有」判定：面板打撈晶片（`GameState.ownsShip()` ＋ `battleInfo.dropIsNew`）
// 與打撈紀錄分區的新船篩選（`newShipDropKeys()`）。兩者**必須是同一條判準**，故鎖在同一
// 個檔案裡：比對鎮守府全艦娘（以基礎形態比對）之後，這一撈才讓它第一次成為成員才算新船。
//
// 兩件事要鎖住：
//   1. **比對用基礎形態**：手上是改二時打撈到本體算已持有（同 baseShipId 的圖鑑視角）。
//   2. **判定時機**：新船要等 `api_port/port` 才會進名冊，故必須在 battleresult 當下判定。
//      若改成事後從名冊回推，回港之後永遠會答「已持有」——這條測試就是為了擋那個回歸。
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { newShipDropKeys } from '../utils/drop-new-ship';
import type { ShipObtainedRow, SortieLogRow } from '../utils/db';

/** 最小 master：吹雪(1) → 吹雪改(2) → 吹雪改二(3)；另有一艘無關的睦月(10)。 */
function master() {
    return {
        api_mst_ship: [
            { api_id: 1, api_name: '吹雪', api_sortno: 1, api_aftershipid: '2', api_stype: 2 },
            { api_id: 2, api_name: '吹雪改', api_sortno: 0, api_aftershipid: '3', api_stype: 2 },
            { api_id: 3, api_name: '吹雪改二', api_sortno: 0, api_aftershipid: '0', api_stype: 2 },
            { api_id: 10, api_name: '睦月', api_sortno: 2, api_aftershipid: '0', api_stype: 2 },
        ],
        api_mst_shipupgrade: [
            { api_id: 1, api_current_ship_id: 2, api_original_ship_id: 1 },
            { api_id: 2, api_current_ship_id: 3, api_original_ship_id: 1 },
        ],
        api_mst_stype: [{ api_id: 2, api_name: '駆逐艦', api_equip_type: {} }],
        api_mst_slotitem: [],
    };
}

/** 只帶艦娘名冊的 port 封包（其餘欄位不影響本測試）。 */
const port = (ships: { api_id: number; api_ship_id: number }[]) => ({
    api_ship: ships.map(s => ({
        ...s, api_lv: 1, api_nowhp: 10, api_maxhp: 10, api_cond: 49,
        api_slot: [-1, -1, -1, -1], api_slot_ex: 0, api_fuel: 10, api_bull: 10,
        api_onslot: [], api_soku: 10, api_ndock_time: 0, api_exp: [0, 0, 0],
    })),
    api_material: [0, 0, 0, 0, 0, 0, 0, 0],
    api_deck_port: [],
    api_ndock: [],
    api_basic: {},
});

/** 結算封包：帶掉落艦。 */
const battleResult = (dropMst: number, dropName: string) => ({
    api_win_rank: 'S',
    api_get_ship: { api_ship_id: dropMst, api_ship_name: dropName },
});

function stateWith(ownedMstIds: number[]) {
    const s = new GameState();
    s.applyEvent('api_start2/getData', master(), undefined, 1_726_000_000_000);
    s.applyEvent('api_port/port', port(
        ownedMstIds.map((mst, i) => ({ api_id: 100 + i, api_ship_id: mst })),
    ), undefined, 1_726_000_000_001);
    return s;
}

describe('GameState.ownsShip', () => {
    it('持有本體時，本體算已持有', () => {
        expect(stateWith([1]).ownsShip(1)).toBe(true);
    });

    it('持有改二時，打撈到本體也算已持有（以基礎形態比對）', () => {
        expect(stateWith([3]).ownsShip(1)).toBe(true);
    });

    it('沒有這條艦線就是沒有', () => {
        expect(stateWith([10]).ownsShip(1)).toBe(false);
    });

    it('id 缺席／非法一律回 false，不猜', () => {
        const s = stateWith([1]);
        expect(s.ownsShip(undefined)).toBe(false);
        expect(s.ownsShip(0)).toBe(false);
        expect(s.ownsShip(-1)).toBe(false);
    });
});

describe('battleInfo.dropIsNew', () => {
    /** battleresult 需要先有 battleInfo，故補一則最小戰鬥封包。 */
    function fightThenResult(s: GameState, dropMst: number, dropName: string) {
        s.applyEvent('api_req_sortie/battle', {
            api_f_nowhps: [10], api_f_maxhps: [10],
            api_e_nowhps: [1], api_e_maxhps: [1],
            api_formation: [1, 1, 1],
        }, undefined, 1_726_000_000_010);
        s.applyEvent('api_req_sortie/battleresult',
            battleResult(dropMst, dropName), undefined, 1_726_000_000_020);
        return s.battleInfo!;
    }

    it('名冊沒有的船 → 新船', () => {
        expect(fightThenResult(stateWith([10]), 1, '吹雪').dropIsNew).toBe(true);
    });

    it('名冊已有（含改造形態）→ 不是新船', () => {
        expect(fightThenResult(stateWith([3]), 1, '吹雪').dropIsNew).toBe(false);
    });

    it('沒有掉落時恆為 false', () => {
        const s = stateWith([10]);
        s.applyEvent('api_req_sortie/battle', {
            api_f_nowhps: [10], api_f_maxhps: [10],
            api_e_nowhps: [1], api_e_maxhps: [1],
            api_formation: [1, 1, 1],
        }, undefined, 1_726_000_000_010);
        s.applyEvent('api_req_sortie/battleresult', { api_win_rank: 'S' }, undefined, 1_726_000_000_020);
        expect(s.battleInfo!.drop).toBeNull();
        expect(s.battleInfo!.dropIsNew).toBe(false);
    });

    it('回港後名冊多了這艘船，已判好的 dropIsNew 不被洗掉', () => {
        const s = stateWith([10]);
        const info = fightThenResult(s, 1, '吹雪');
        expect(info.dropIsNew).toBe(true);
        // 回港：新船進名冊。此時再問 ownsShip 會答「有」，但 battleInfo 的結論不變。
        s.applyEvent('api_port/port', port([
            { api_id: 110, api_ship_id: 10 },
            { api_id: 111, api_ship_id: 1 },
        ]), undefined, 1_726_000_000_030);
        expect(s.ownsShip(1)).toBe(true);
        expect(info.dropIsNew).toBe(true);
    });
});

// 打撈紀錄分區（鎮守府情報總括）的新船篩選。**判準要與上面的 dropIsNew 同一條**：
// 比對鎮守府全艦娘（以基礎形態比對）後，這一撈才讓它第一次成為成員才算新船。
describe('newShipDropKeys（打撈紀錄的新船篩選）', () => {
    const T = 1_726_000_000_000;
    // 測試用的基礎形態解析：吹雪線（1/2/3）→ 1，其餘原樣（同 GameState.baseShipId 的行為）。
    const baseOf = (mst: number | undefined) =>
        mst == null || mst <= 0 ? null : [1, 2, 3].includes(mst) ? 1 : mst;

    const drop = (over: Partial<SortieLogRow> & { sortieKey: number; ts: number; dropMst: number }): SortieLogRow => ({
        eventId: over.sortieKey, map: '1-1', node: 1, boss: true, kind: 'battle',
        rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop: '吹雪', taiha: false,
        ...over,
    });
    const owned = (over: Partial<ShipObtainedRow> & { id: number; mst: number }): ShipObtainedRow => ({
        obtainedTs: T + 100, source: 'auto', ...over,
    });

    it('自動觀測到入手的那一撈＝新船，同艦線後續的打撈都不是', () => {
        const rows = [
            drop({ sortieKey: 1, ts: T + 10, dropMst: 1 }),
            drop({ sortieKey: 2, ts: T + 200, dropMst: 1 }),
        ];
        const keys = newShipDropKeys(rows, [owned({ id: 500, mst: 1 })], baseOf);
        expect([...keys]).toEqual([1]);
    });

    it('以基礎形態比對：名冊那筆已是改二形態也對得上本體的打撈', () => {
        const rows = [drop({ sortieKey: 1, ts: T + 10, dropMst: 1 })];
        // 首次觀測後改造成吹雪改二，shipObtained.mst 停在觀測當下的形態
        const keys = newShipDropKeys(rows, [owned({ id: 500, mst: 3 })], baseOf);
        expect([...keys]).toEqual([1]);
    });

    it('擴充安裝前就有的船（基準線 source=null）→ 所有打撈都不是新船', () => {
        const rows = [drop({ sortieKey: 1, ts: T + 10, dropMst: 1 })];
        const owned0: ShipObtainedRow = { id: 500, mst: 1, obtainedTs: null, source: null };
        expect(newShipDropKeys(rows, [owned0], baseOf).size).toBe(0);
    });

    it('手填入手日（manual）同樣不猜是哪一撈帶進來的', () => {
        const rows = [drop({ sortieKey: 1, ts: T + 10, dropMst: 1 })];
        const keys = newShipDropKeys(rows, [owned({ id: 500, mst: 1, source: 'manual' })], baseOf);
        expect(keys.size).toBe(0);
    });

    it('入手觀測之後才發生的打撈不算（那時它已經是成員了）', () => {
        const rows = [drop({ sortieKey: 1, ts: T + 500, dropMst: 1 })];
        const keys = newShipDropKeys(rows, [owned({ id: 500, mst: 1, obtainedTs: T + 100 })], baseOf);
        expect(keys.size).toBe(0);
    });

    it('同艦線有多筆名冊紀錄時以 api_id 最小的那筆為準（＝第一位成員）', () => {
        const rows = [drop({ sortieKey: 1, ts: T + 10, dropMst: 1 })];
        const keys = newShipDropKeys(rows, [
            owned({ id: 900, mst: 2, obtainedTs: T + 900 }),
            owned({ id: 500, mst: 1, obtainedTs: T + 100 }),
        ], baseOf);
        expect([...keys]).toEqual([1]);
    });

    it('匯入的歷史紀錄以時間為錨點（borrow 來的 event ID 不參與比較）', () => {
        // 匯入列的 eventId 是匯入當下借的（很大），但 ts 是真實的歷史時間。
        const rows = [drop({ sortieKey: 1, eventId: 99999, ts: T + 10, dropMst: 1, imported: true })];
        const keys = newShipDropKeys(rows, [owned({ id: 500, mst: 1, obtainedTs: T + 100 })], baseOf);
        expect([...keys]).toEqual([1]);
    });

    it('同毫秒混合本機與匯入列時不拿借來的 event ID 猜入手來源', () => {
        const local = drop({ sortieKey: 1, eventId: 10, ts: T + 10, dropMst: 1 });
        const imported = drop({
            sortieKey: 2, eventId: 99999, ts: T + 10, dropMst: 1, imported: true,
        });
        const obtained = [owned({ id: 500, mst: 1, obtainedTs: T + 100 })];
        expect(newShipDropKeys([local, imported], obtained, baseOf).size).toBe(0);
        expect(newShipDropKeys([imported, local], obtained, baseOf).size).toBe(0);
    });

    it('同毫秒且都是本機擷取時才以 raw event ID 收斂', () => {
        const rows = [
            drop({ sortieKey: 1, eventId: 10, ts: T + 10, dropMst: 1 }),
            drop({ sortieKey: 2, eventId: 11, ts: T + 10, dropMst: 1 }),
        ];
        const keys = newShipDropKeys(rows, [owned({ id: 500, mst: 1, obtainedTs: T + 100 })], baseOf);
        expect([...keys]).toEqual([2]);
    });

    it('沒有 dropMst 的舊資料一律跳過，不由艦名反推', () => {
        const rows: SortieLogRow[] = [{
            eventId: 1, sortieKey: 1, ts: T + 10, map: '1-1', node: 1, boss: true, kind: 'battle',
            rank: 'S', seiku: null, enemyIds: [], enemyIdsEscort: [], drop: '吹雪', taiha: false,
        }];
        expect(newShipDropKeys(rows, [owned({ id: 500, mst: 1 })], baseOf).size).toBe(0);
    });
});
