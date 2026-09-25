// 配裝參考核心：藍字匹配、主砲適性分群、可裝備類別過濾。加成／適性皆社群資料。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { nationOf } from '../utils/ship-nationality';
import {
    EQUIP_BONUS_TABLE, bbGroupOf, buildFitRules, collectEquipRef, isMainGunCat,
    nationToBonusCountry, shipEquipRefMarks,
    type EquipRefGear, type EquipRefShip,
} from '../utils/equip-ref';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

function setup() {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    const gears: EquipRefGear[] = [...state.masterGears.entries()]
        .filter(([, g]) => (g.sortNo ?? 0) > 0)
        .map(([id, g]) => ({
            id, cat: g.cat, sortNo: g.sortNo ?? id, leng: g.stats.leng ?? 0, icon: g.icon,
        }));
    const catalog = [...state.master.entries()]
        .filter(([, m]) => (m.sortno ?? 0) > 0)
        .map(([id, m]) => ({ id, nameJa: m.name, ctype: m.ctype }));
    const fitRules = buildFitRules(
        [...state.masterGears.entries()].map(([id, g]) => ({ id, nameJa: g.name })),
        catalog,
    );
    const byJa = new Map([...state.masterGears.entries()].map(([id, g]) => [g.name, id]));
    const shipByJa = new Map([...state.master.entries()].map(([id, m]) => [m.name, id]));
    const shipOf = (ja: string): EquipRefShip => {
        const masterId = shipByJa.get(ja);
        if (masterId == null) throw new Error(`找不到艦 ${ja}`);
        const m = state.master.get(masterId)!;
        return {
            masterId,
            baseId: state.baseShipId(masterId) ?? masterId,
            stype: m.stype,
            ctype: m.ctype,
            country: nationToBonusCountry(nationOf(m.ctype)),
            equipCats: [...state.equipTypesOf(masterId)],
            bbGroup: bbGroupOf({ masterId, stype: m.stype, taik0: m.taik0 }),
        };
    };
    return { state, gears, fitRules, byJa, shipOf };
}

describe('equip-ref', () => {
    it('金剛改二丙對 35.6cm／38cm 的晝戰命中項為 +7', () => {
        const { gears, fitRules, byJa, shipOf } = setup();
        const ship = shipOf('金剛改二丙');
        expect(ship.bbGroup).toBe('bc');
        const gun = byJa.get('35.6cm連装砲');
        expect(gun).toBeTypeOf('number');
        const row = collectEquipRef(ship, gears, EQUIP_BONUS_TABLE, fitRules).find(r => r.id === gun);
        expect(row?.fit?.day).toBe(7);
        expect(isMainGunCat(gears.find(g => g.id === gun)!.cat)).toBe(true);
    });

    it('大和改二對 46cm三連装砲改的晝戰命中項為 +7', () => {
        const { gears, fitRules, byJa, shipOf } = setup();
        const ship = shipOf('大和改二');
        const gun = byJa.get('46cm三連装砲改');
        const row = collectEquipRef(ship, gears, EQUIP_BONUS_TABLE, fitRules).find(r => r.id === gun);
        expect(row?.fit?.day).toBe(7);
    });

    it('Atlanta 不吃輕巡對 Atlanta 砲的過重，大淀不吃輕巡 15.5cm 標準懲罰', () => {
        const { gears, fitRules, byJa, shipOf } = setup();
        const atlantaGun = byJa.get('5inch連装両用砲(集中配備)');
        const gun155 = byJa.get('15.5cm三連装砲');
        const atlanta = collectEquipRef(shipOf('Atlanta'), gears, EQUIP_BONUS_TABLE, fitRules);
        const sendai = collectEquipRef(shipOf('川内改二'), gears, EQUIP_BONUS_TABLE, fitRules);
        const ooyodo = collectEquipRef(shipOf('大淀改'), gears, EQUIP_BONUS_TABLE, fitRules);
        expect(atlanta.find(r => r.id === atlantaGun)?.fit?.day).toBe(0);
        expect(sendai.find(r => r.id === atlantaGun)?.fit?.day).toBe(-6);
        expect(ooyodo.find(r => r.id === gun155)?.fit?.day).toBe(-2);
        expect(sendai.find(r => r.id === gun155)?.fit?.day).toBe(-5);
    });

    it('戰艦不列出裝不上的艦戰', () => {
        const { gears, fitRules, byJa, shipOf } = setup();
        const fighter = byJa.get('九六式艦戦') ?? byJa.get('零式艦戦21型');
        expect(fighter).toBeTypeOf('number');
        const rows = collectEquipRef(shipOf('金剛改二丙'), gears, EQUIP_BONUS_TABLE, fitRules);
        expect(rows.some(r => r.id === fighter)).toBe(false);
    });

    it('只看有資料：沒有藍字也沒有適性的艦 n 為 0', () => {
        const { gears, fitRules, shipOf } = setup();
        const kongou = shipEquipRefMarks(shipOf('金剛改二丙'), gears, EQUIP_BONUS_TABLE, fitRules);
        expect(kongou.n).toBeGreaterThan(0);
        expect(kongou.hasFit).toBe(true);
    });
});
