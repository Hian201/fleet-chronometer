// 艦隊 Markdown 匯出必須含畫面同樣呈現的補強增設欄位。
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { fleetMarkdown, shipGearsMarkdown } from '../entrypoints/overview/lib';
import { setLang, t } from '../utils/ui-i18n';

function stateWithExSlot(): GameState {
    const state = new GameState();
    setLang('zh-TW');
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: [
            { api_id: 1, api_slotitem_id: 2, api_level: 4, api_alv: 0 },
            { api_id: 2, api_slotitem_id: 68, api_level: 6, api_alv: 0 },
        ],
    });
    // master 不載入時 gearName／localize 可能改字形；斷言用 view 回傳的 name，不寫死日文原字。
    state.masterGears.set(2, {
        name: '12.7cm連装砲', icon: 1, cat: 1, aa: 0, los: 0, distance: 0, sortNo: 1,
        stats: { houg: 0, houm: 0, leng: 0, luck: 0, houk: 0, baku: 0, raig: 0, saku: 0, tais: 0, tyku: 0, souk: 0 },
    });
    state.masterGears.set(68, {
        name: '大発動艇', icon: 20, cat: 24, aa: 0, los: 0, distance: 0, sortNo: 1,
        stats: { houg: 0, houm: 0, leng: 0, luck: 0, houk: 0, baku: 0, raig: 0, saku: 0, tais: 0, tyku: 0, souk: 0 },
    });
    state.master.set(1, {
        name: '睦月', nameJa: '睦月', stype: 2, ctype: 28, sortno: 1, aftershipid: '0',
        maxeq: [0, 0, 0, 0, 0], fuelMax: 15, ammoMax: 15,
    } as any);
    state.applyEvent('api_port/port', {
        api_ship: [{
            api_id: 10, api_ship_id: 1, api_lv: 50, api_nowhp: 15, api_maxhp: 15,
            api_cond: 49, api_slot: [1, -1, -1, -1, -1], api_slot_ex: 2,
            api_exp: [0, 0, 0], api_leng: 1, api_soku: 10, api_kyouka: [0, 0, 0, 0, 0, 0, 0],
            api_karyoku: [10, 10], api_raisou: [20, 20], api_taiku: [10, 10], api_soukou: [5, 5],
            api_kaihi: [40, 40], api_taisen: [20, 20], api_sakuteki: [5, 5], api_lucky: [12, 12],
            api_onslot: [0, 0, 0, 0, 0], api_fuel: 15, api_bull: 15, api_locked: 0, api_sally_area: 0,
        }],
        api_deck_port: [
            { api_id: 1, api_name: '第一艦隊', api_ship: [10, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
        ],
        api_material: [], api_basic: { api_level: 100, api_nickname: 'test' }, api_ndock: [],
    });
    return state;
}

describe('艦隊 Markdown 含補強增設', () => {
    it('shipGearsMarkdown 把補強增設接在一般槽後面，並帶改修值', () => {
        const ship = stateWithExSlot().fleets()[0].ships[0];
        const text = shipGearsMarkdown(ship);
        expect(ship.exGear).toBeTruthy();
        expect(text).toContain(`${ship.gears[0]!.name}★4`);
        expect(text).toContain(`[${t('ov.shipsEx')}]${ship.exGear!.name}★6`);
    });

    it('fleetMarkdown 輸出含補強增設（不只畫面有）', () => {
        const state = stateWithExSlot();
        const ship = state.fleets()[0].ships[0];
        const md = fleetMarkdown(state);
        expect(md).toContain(`[${t('ov.shipsEx')}]${ship.exGear!.name}★6`);
        expect(md).toContain(`${ship.gears[0]!.name}★4`);
    });

    it('無補強增設時不硬塞空標籤', () => {
        const state = stateWithExSlot();
        state.ships.get(10)!.api_slot_ex = -1;
        const text = shipGearsMarkdown(state.fleets()[0].ships[0]);
        expect(text).not.toContain(`[${t('ov.shipsEx')}]`);
    });
});
