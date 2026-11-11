// 出擊帳單：出擊前後兩個時刻的艦娘狀態之差。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    affordableRuns, billShipFromApi, netCost, sortieBill, summarizeBills, type BillShip,
} from '../utils/sortie-bill';

const ship = (id: number, patch: Partial<BillShip> = {}): BillShip => ({
    id, masterId: 100 + id, lv: 90, fuel: 40, bull: 50, onslot: [0, 0, 0, 0, 0], repairFuel: 0, repairSteel: 0, ...patch,
});

describe('billShipFromApi', () => {
    const port = JSON.parse(readFileSync(new URL('../samples/slot_to_port.json', import.meta.url), 'utf8'));
    const raw = (port.api_data.api_ship as any[]).find(row => row.api_id === 4805);

    it('真實母港封包：api_ndock_item 是［燃料, 鋼材］', () => {
        // 樣本中這艘少 4 HP，修理費 3 燃料／6 鋼材。
        expect(billShipFromApi(raw)).toEqual({
            id: 4805, masterId: 963, lv: 99, fuel: 25, bull: 30, onslot: [0, 0, 0, 0, 0], repairFuel: 3, repairSteel: 6,
        });
    });

    it('樣本內每艘艦都轉得出來；缺必要欄位回 null', () => {
        expect((port.api_data.api_ship as any[]).every(row => billShipFromApi(row) !== null)).toBe(true);
        expect(billShipFromApi({ api_id: 1, api_ship_id: 2 })).toBeNull();
        expect(billShipFromApi(null)).toBeNull();
    });
});

describe('sortieBill', () => {
    it('補給、艦載機、修理各自取出擊前後之差', () => {
        const before = [ship(1, { onslot: [18, 18, 27, 10] }), ship(2)];
        const after = [
            ship(1, { fuel: 24, bull: 30, onslot: [15, 18, 20, 10], repairFuel: 12, repairSteel: 30 }),
            ship(2, { fuel: 32, bull: 40 }),
            ship(9, { fuel: 0 }),   // 沒出擊的艦，忽略
        ];
        const bill = sortieBill(before, after);
        expect(bill.ships).toEqual([
            { id: 1, masterId: 101, fuel: 16, ammo: 20, bauxite: 50, repairFuel: 12, repairSteel: 30 },
            { id: 2, masterId: 102, fuel: 8, ammo: 10, bauxite: 0, repairFuel: 0, repairSteel: 0 },
        ]);
        expect(bill.payable).toEqual([16 + 8 + 12, 30, 30, 50]);
        expect(bill).toMatchObject({ planesLost: 10, estimated: false, damagedShipIds: [1], lostShipIds: [], balanceDelta: null });
    });

    it('帶傷、未補滿出擊：舊傷與舊缺額不算到這一趟', () => {
        const before = [ship(1, { fuel: 30, onslot: [10], repairFuel: 5, repairSteel: 9 })];
        const after = [ship(1, { fuel: 22, bull: 50, onslot: [10], repairFuel: 5, repairSteel: 9 })];
        const bill = sortieBill(before, after);
        expect(bill.payable).toEqual([8, 0, 0, 0]);
        expect(bill.damagedShipIds).toEqual([]);
    });

    it('結婚艦：補給量打 85 折捨去並標推算；補給量為 1 不折；鋁土不折', () => {
        const before = [ship(1, { lv: 120, onslot: [20] }), ship(2, { lv: 120, fuel: 40, bull: 50 })];
        const after = [ship(1, { lv: 120, fuel: 20, bull: 39, onslot: [18] }), ship(2, { lv: 121, fuel: 39, bull: 50 })];
        const bill = sortieBill(before, after);
        expect(bill.ships[0]).toMatchObject({ fuel: 17, ammo: 9, bauxite: 10, estimated: true });   // floor(20×.85)、floor(11×.85)
        expect(bill.ships[1]).toEqual({ id: 2, masterId: 102, fuel: 1, ammo: 0, bauxite: 0, repairFuel: 0, repairSteel: 0 });
        expect(bill.estimated).toBe(true);
    });

    it('途中回升（洋上補給、修理）不產生負的花費；轟沈的艦列入 lostShipIds', () => {
        const before = [ship(1, { fuel: 10, repairFuel: 20, repairSteel: 40 }), ship(2)];
        const after = [ship(1, { fuel: 25, repairFuel: 8, repairSteel: 10 })];
        const bill = sortieBill(before, after);
        expect(bill.payable).toEqual([0, 0, 0, 0]);
        expect(bill.lostShipIds).toEqual([2]);
        expect(bill.ships.map(row => row.id)).toEqual([1]);
    });

    it('餘額變動只在前後兩筆都完整時才算', () => {
        const fleet = [ship(1)];
        expect(sortieBill(fleet, fleet, { before: [1000, 1000, 1000, 1000, 5, 5, 5, 5], after: [900, 950, 1080, 1000, 5, 5, 5, 5] })
            .balanceDelta).toEqual([-100, -50, 80, 0]);
        expect(sortieBill(fleet, fleet, { before: null, after: [1, 2, 3, 4] }).balanceDelta).toBeNull();
        expect(sortieBill(fleet, fleet, { before: [1, 2, 3], after: [1, 2, 3, 4] }).balanceDelta).toBeNull();
    });
});

describe('彙總', () => {
    const bill = (payable: number[], balanceDelta: number[] | null = [0, 0, 0, 0], estimated = false) =>
        ({ payable, balanceDelta, estimated }) as any;

    it('淨成本＝要付的帳 − 出擊期間的餘額變動；不可考時標 partial', () => {
        expect(netCost(bill([100, 80, 30, 20], [-40, -40, 50, 0]))).toEqual({ cost: [140, 120, -20, 20], partial: false });
        expect(netCost(bill([100, 80, 30, 20], null))).toEqual({ cost: [100, 80, 30, 20], partial: true });
    });

    it('每次到 Boss、每個 S 的分子都是全部出擊的總成本', () => {
        const summary = summarizeBills([
            { bill: bill([100, 100, 0, 0]), reachedBoss: true, bossRank: 'S' },
            { bill: bill([100, 100, 40, 0]), reachedBoss: true, bossRank: 'A' },
            { bill: bill([40, 20, 80, 0]), reachedBoss: false, bossRank: null },
            { bill: bill([60, 80, 0, 0], null, true), reachedBoss: true, bossRank: 'S' },
        ])!;
        expect(summary).toMatchObject({
            runs: 4, bossReaches: 3, bossS: 2, total: [300, 300, 120, 0],
            perRun: [75, 75, 30, 0], perBossReach: [100, 100, 40, 0], perBossS: [150, 150, 60, 0],
            partial: true, estimated: true,
        });
    });

    it('沒有任何出擊回 null；沒到過 Boss 時對應的平均為 null', () => {
        expect(summarizeBills([])).toBeNull();
        expect(summarizeBills([{ bill: bill([1, 1, 1, 1]), reachedBoss: false, bossRank: null }]))
            .toMatchObject({ perBossReach: null, perBossS: null });
    });

    it('可再出擊趟數取最先耗盡的資源；庫存不可考或沒有設限的資源時回 null', () => {
        expect(affordableRuns([75, 75, 30, 0], [300000, 1500, 90, 0])).toBe(3);
        expect(affordableRuns([75, 75, -20, 0], [750, 7500, 0, 0])).toBe(10);   // 鋼材淨賺，不設限
        expect(affordableRuns([75, 75, 30, 0], [300000, null, 90, 0])).toBeNull();
        expect(affordableRuns([0, 0, 0, 0], [1, 1, 1, 1])).toBeNull();
    });
});
