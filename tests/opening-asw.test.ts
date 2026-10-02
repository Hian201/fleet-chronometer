import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, type GearView } from '../utils/state';
import { openingAswEligible, OPENING_ASW_EXEMPT_SHIPS, type OpeningAswShip } from '../utils/opening-asw';
import { openingAswBadge } from '../entrypoints/panel/opening-asw';
import { setLang } from '../utils/ui-i18n';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
function gear(id: number): GearView {
    const m = master.api_mst_slotitem.find((g: any) => g.api_id === id);
    if (!m) throw new Error(`Missing equipment master ${id}`);
    return { mst: id, name: m.api_name, short: '', cat: '', type: m.api_type[2], asw: m.api_tais,
        icon: m.api_type[3], level: 0, alv: 0 };
}
function ship(id: number, asw: number | null, slots: number[] = [], ex?: number): OpeningAswShip {
    const m = master.api_mst_ship.find((s: any) => s.api_id === id);
    if (!m) throw new Error(`Missing ship master ${id}`);
    return { masterId: id, stypeId: m.api_stype, ctype: m.api_ctype, nameJa: m.api_name,
        asw, gears: slots.map(gear), exGear: ex ? gear(ex) : null };
}
const torpedo7 = master.api_mst_slotitem.find((g: any) => g.api_type[2] === 8 && g.api_tais === 7).api_id;
const zeroBomber = master.api_mst_slotitem.find((g: any) => g.api_type[2] === 7 && g.api_tais === 0).api_id;
const seaplane = master.api_mst_slotitem.find((g: any) => g.api_type[2] === 11).api_id;

// 配裝與顯示值是邊界測試情境；艦型、類別、裝備原始素質來自真實 master。
describe('Wiki 先制對潛條件', () => {
    it.each(OPENING_ASW_EXEMPT_SHIPS)('免裝備形態 %i 不要求對潛 100', id => {
        expect(openingAswEligible(ship(id, 1))).toBe(true);
    });
    it.each([562, 596, 628, 629, 689, 692, 726, 737])('Fletcher 級符合形態 %i', id => {
        expect(openingAswEligible(ship(id, 1))).toBe(true);
    });
    it.each([561, 519, 520, 901, 941, 942, 1035])('未列為免裝備形態 %i', id => {
        expect(openingAswEligible(ship(id, 150))).toBe(false);
        expect(openingAswEligible(ship(id, 100, [46]))).toBe(true);
    });
    it.each([
        [376, 59, [46], false], [376, 60, [46], true],
        [376, 74, [226], false], [376, 75, [226], true],
        [376, 75, [456], true], [376, 75, [315], false],
        [376, 75, [88, 88], true], [376, 75, [], false],
        [1, 99, [46], false], [1, 100, [46], true], [1, 100, [45], false],
    ] as const)('艦 %i／對潛 %i／裝備 %j → %s', (id, asw, slots, expected) => {
        expect(openingAswEligible(ship(id, asw, [...slots]))).toBe(expected);
    });
    it('海防艦的增設裝備也計入原始裝備對潛合計', () => {
        expect(openingAswEligible(ship(376, 75, [], 226))).toBe(true);
    });
    it.each([646, 380, 381, 382, 529, 536, 889])('自動航空對潛艦 %i 仍需航空裝備', id => {
        expect(openingAswEligible(ship(id, 1))).toBe(false);
        expect(openingAswEligible(ship(id, 1, [18]))).toBe(true);
        expect(openingAswEligible(ship(id, 1, [60]))).toBe(true);
        expect(openingAswEligible(ship(id, 1, [zeroBomber]))).toBe(false);
    });
    it.each([
        [49, [46, torpedo7], false], [50, [46, torpedo7], true],
        [50, [torpedo7], false], [64, [torpedo7], false], [65, [torpedo7], true],
        [65, [18], false], [65, [60], false], [99, [46, 18], false],
        [100, [46, 18], true], [100, [46, 60], true], [100, [18], false],
        [65, [69], true], [65, [70], true], [50, [46, 69], true], [50, [46, 70], true],
    ] as const)('一般輕空母／對潛 %i／裝備 %j → %s', (asw, slots, expected) => {
        expect(openingAswEligible(ship(117, asw, [...slots]))).toBe(expected);
    });
    it.each([508, 509])('最上型輕空母 %i 不適用 50 門檻', id => {
        expect(openingAswEligible(ship(id, 50, [46, torpedo7]))).toBe(false);
        expect(openingAswEligible(ship(id, 65, [torpedo7]))).toBe(true);
    });
    it('裝備加成與改修不改變航空裝備原始對潛門檻', () => {
        const s = ship(117, 100, [18]);
        s.gears[0]!.level = 10;
        expect(openingAswEligible(s)).toBe(false);
    });
    it.each([626, 916])('航空特殊艦 %i 需要聲納及水爆／旋翼機', id => {
        expect(openingAswEligible(ship(id, 100, [46]))).toBe(false);
        expect(openingAswEligible(ship(id, 100, [46, seaplane]))).toBe(true);
        expect(openingAswEligible(ship(id, 99, [46, 69]))).toBe(false);
        expect(openingAswEligible(ship(id, 100, [46, 69]))).toBe(true);
        expect(openingAswEligible(ship(id, 100, [46, 18]))).toBe(false);
    });
    it.each([943, 948])('熊野丸形態 %i', id => {
        expect(openingAswEligible(ship(id, 100, [46]))).toBe(false);
        expect(openingAswEligible(ship(id, 100, [46, 60]))).toBe(true);
        expect(openingAswEligible(ship(id, 100, [46, 18]))).toBe(false);
        expect(openingAswEligible(ship(id, 100, [46, 70]))).toBe(true);
    });
    it.each([411, 412])('扶桑／山城改二 %i', id => {
        expect(openingAswEligible(ship(id, 100, [46]))).toBe(false);
        for (const g of [seaplane, 69, 45]) expect(openingAswEligible(ship(id, 100, [46, g]))).toBe(true);
        expect(openingAswEligible(ship(id, 100, [46, 60]))).toBe(false);
    });
    it.each(['扶桑改二補', '山城改二補'])('樣本以外的 %s 以 master 原名核對', nameJa => {
        const s = { ...ship(411, 100, [46, 45]), masterId: 999999, nameJa };
        expect(openingAswEligible(s)).toBe(true);
        expect(openingAswEligible({ ...s, gears: [gear(46)] })).toBe(false);
    });
    it('日向改二：S-51 系一槽或指定旋翼機兩槽', () => {
        for (const g of [326, 327]) expect(openingAswEligible(ship(554, 1, [g]))).toBe(true);
        expect(openingAswEligible(ship(554, 100, [46, 69]))).toBe(false);
        expect(openingAswEligible(ship(554, 1, [69, 324]))).toBe(true);
        expect(openingAswEligible(ship(554, 1, [325, 325]))).toBe(true);
        expect(openingAswEligible(ship(554, 100, [70, 70]))).toBe(false);
    });
    it.each([717, 1008])('航空補給艦 %i 只有對潛 0 的攻擊機時不成立', id => {
        expect(openingAswEligible(ship(id, 100, [46]))).toBe(true);
        expect(openingAswEligible(ship(id, 100, [46, zeroBomber]))).toBe(false);
        expect(openingAswEligible(ship(id, 100, [46, zeroBomber, 60]))).toBe(true);
    });
    it('不將一般戰艦、航巡等套用聲納 100 規則，缺少數值不補猜', () => {
        expect(openingAswEligible(ship(136, 100, [46]))).toBe(false);
        expect(openingAswEligible(ship(1, null, [46]))).toBe(false);
    });
    it('裝備資料未取得時不補猜資格，但免裝備艦仍可判定', () => {
        expect(openingAswEligible({ ...ship(1, 100, [46]), aswEquipmentKnown: false })).toBe(false);
        expect(openingAswEligible({ ...ship(141, 1), aswEquipmentKnown: false })).toBe(true);
    });
    it('中大破與航空裝備剩餘機數 0 不取消輕空母的裝備資格', () => {
        const s = ship(117, 65, [torpedo7]);
        s.gears[0]!.count = 0;
        expect(openingAswEligible(s)).toBe(true);
    });
    it('日戰開幕、連合第二艦隊、未退避才可參加', () => {
        const s = ship(141, 1);
        expect(openingAswEligible(s, { openingNight: true })).toBe(false);
        expect(openingAswEligible(s, { escaped: true })).toBe(false);
        expect(openingAswEligible(s, { combined: true, fleetNo: 1 })).toBe(false);
        expect(openingAswEligible(s, { combined: true, fleetNo: 2 })).toBe(true);
    });
});

describe('封包 view 與 ASW 顯示', () => {
    it('fleets() 與 ownedShips() 使用相同對潛值與原始裝備數據', () => {
        const state = new GameState();
        state.applyEvent('api_start2/getData', master);
        state.applyEvent('api_get_member/require_info', { api_slot_item: [{ api_id: 100, api_slotitem_id: 46, api_level: 10, api_alv: 0 }] });
        state.applyEvent('api_port/port', { api_ship: [{ api_id: 1, api_ship_id: 1, api_lv: 99, api_nowhp: 30, api_maxhp: 30,
            api_cond: 49, api_taisen: [100, 100], api_slot: [100, -1, -1], api_slot_ex: 0 }],
        api_deck_port: [{ api_ship: [1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }], api_ndock: [],
        api_material: [], api_basic: {}, api_combined_flag: 0 });
        const fleet = state.fleets()[0].ships[0];
        expect(fleet.asw).toBe(100);
        expect(fleet.gears[0]?.asw).toBe(6);
        expect(state.ownedShips()[0].stats.asw).toBe(fleet.asw);
        for (const lang of ['zh-TW', 'en', 'ja'] as const) {
            setLang(lang);
            const badge = openingAswBadge(fleet);
            expect(badge).toContain('<span>ASW</span>');
            expect(badge).toContain('aria-hidden="true"');
            expect(badge).not.toContain('undefined');
            expect(openingAswBadge({ ...fleet, escaped: true })).toBe('');
            expect(openingAswBadge(fleet, { combined: true, fleetNo: 1 })).toBe('');
        }
        setLang('zh-TW');
        delete state.ships.get(1).api_taisen;
        expect(state.fleets()[0].ships[0].asw).toBeNull();
        expect(openingAswBadge(state.fleets()[0].ships[0])).toBe('');
    });
});
