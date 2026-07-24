// 裝備全覽分區的 HTML／CSV 產出驗證（無 DOM，同 ships-overview.test.ts 的作法：
// 只測「純字串產出」的部分，事件與 DOM 綁定留給實際使用）。
import { describe, expect, it } from 'vitest';
import { GameState, type OwnedGearView } from '../utils/state';
import { readFileSync } from 'node:fs';
import { groupGears, type GearGroup } from '../utils/gear-inventory';
import {
    COLUMNS, cardsHtml, gearCsv, tableHtml, visibleColumns, type View,
} from '../entrypoints/overview/sections/equipment';
import { setLang, t } from '../utils/ui-i18n';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const gearMst = (name: string) =>
    master.api_mst_slotitem.find((g: any) => g.api_name === name).api_id as number;

const GUN_41 = gearMst('41cm連装砲');
const RATION = gearMst('戦闘糧食');

function gears(slots: { id: number; mst: number; level?: number; alv?: number }[],
    equippedIds: number[] = []): OwnedGearView[] {
    const state = new GameState();
    state.applyEvent('api_start2/getData', master);
    state.applyEvent('api_get_member/require_info', {
        api_slot_item: slots.map(s => ({
            api_id: s.id, api_slotitem_id: s.mst, api_level: s.level ?? 0, api_alv: s.alv ?? 0,
        })),
    });
    const akashi = master.api_mst_ship.find((m: any) => m.api_id === 182);
    state.applyEvent('api_port/port', {
        api_ship: equippedIds.length ? [{
            api_id: 100, api_ship_id: 182, api_lv: 1, api_exp: [0, 0, 0],
            api_nowhp: akashi.api_taik[0], api_maxhp: akashi.api_taik[0], api_cond: 49,
            api_soku: akashi.api_soku, api_leng: akashi.api_leng,
            api_slot: equippedIds, api_slot_ex: 0, api_kyouka: [0, 0, 0, 0, 0, 0, 0],
            api_locked: 1, api_sally_area: 0,
            api_karyoku: [0, 0], api_raisou: [0, 0], api_taiku: [0, 0], api_soukou: [0, 0],
            api_taisen: [0, 0], api_kaihi: [0, 0], api_sakuteki: [0, 0], api_lucky: [0, 0],
        }] : [],
        api_deck_port: [{ api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] }],
        api_ndock: [], api_material: [], api_basic: {}, api_count_kdock: 0, api_combined_flag: 0,
    });
    return state.ownedGears();
}

/** 預設欄位＝COLUMNS 裡標了 on 的那些（「裝備中艦娘」預設關閉）。 */
const defaultCols = () => new Set(COLUMNS.filter(c => c.on).map(c => c.id));

const view = (expanded: number[] = [], cols = defaultCols()): View =>
    ({ sort: 'sortNo', dir: 'asc', expanded: new Set(expanded), cols });

describe('詳細清單', () => {
    const groups = groupGears(gears(
        [{ id: 1, mst: GUN_41, level: 10 }, { id: 2, mst: GUN_41 }, { id: 3, mst: RATION }], [1]));

    it('欄序即使用者指定的順序；「裝備中艦娘」在其中但預設關閉（平常看展開列）', () => {
        expect(COLUMNS.map(c => c.id)).toEqual([
            'name', 'count', 'star', 'holder',
            'houg', 'houm', 'leng', 'luck', 'houk', 'baku', 'raig', 'saku', 'tais', 'tyku', 'souk',
        ]);
        expect(COLUMNS.find(c => c.id === 'holder')!.on).toBe(false);
        expect(tableHtml(groups, view())).not.toContain('eq-c-holder');
    });

    it('欄位開關：關掉的欄不出現，打開的欄照 COLUMNS 順序插回原位', () => {
        const only = new Set(['count', 'holder']);
        const cols = visibleColumns(view([], only)).map(c => c.id);
        // 裝備名不可關閉（always），故一定在最前面；holder 回到 count 之後的原位
        expect(cols).toEqual(['name', 'count', 'holder']);

        const html = tableHtml(groups, view([], only));
        expect(html.match(/<th /g)).toHaveLength(3);
        expect(html).toContain('eq-c-holder');
        expect(html).not.toContain('eq-c-houg');
    });

    it('表頭欄數與每列儲存格數一致，展開列的 colspan 跟著欄數走（才不會錯位）', () => {
        const shown = visibleColumns(view()).length;
        const html = tableHtml(groups, view());
        expect(html.match(/<th /g)).toHaveLength(shown);
        // 每一種裝備一列，各列的 <td> 數等於欄數
        expect(html.match(/<td /g)).toHaveLength(shown * groups.length);
        expect(tableHtml(groups, view([GUN_41]))).toContain(`colspan="${shown}"`);
    });

    it('素質 0 畫成弱化的點，非零直接出數字', () => {
        const html = tableHtml(groups.filter(g => g.mst === GUN_41), view());
        const gun = master.api_mst_slotitem.find((g: any) => g.api_id === GUN_41);
        expect(html).toContain(`>${gun.api_houg}<`);   // 火力 20
        expect(html).toContain('eq-zero">·<');          // 爆裝等 0 值
    });

    it('展開列把同規格的實例疊成一行 ×N（不逐顆列）', () => {
        // 三顆 ★0 全閒置 → 展開後只有一行，帶 ×3
        const many = groupGears(gears([
            { id: 11, mst: GUN_41 }, { id: 12, mst: GUN_41 }, { id: 13, mst: GUN_41 },
        ]));
        const html = tableHtml(many, view([GUN_41]));
        expect(html.match(/<li>/g)).toHaveLength(1);
        expect(html).toContain('×3');
    });

    it('只有一顆時不畫 ×1（每行掛個 ×1 只是雜訊）', () => {
        const one = groupGears(gears([{ id: 11, mst: GUN_41 }]));
        const html = tableHtml(one, view([GUN_41]));
        expect(html).toContain('<li>');
        expect(html).not.toContain('×1');
    });

    it('展開才輸出逐顆實例，收合時不輸出', () => {
        expect(tableHtml(groups, view())).not.toContain('eq-inst');
        const open = tableHtml(groups, view([GUN_41]));
        expect(open).toContain('eq-inst');
        // 一顆裝在明石身上、一顆閒置，兩者都要列出來
        expect(open).toContain('明石');
        expect(open).toContain(t('ov.eqIdle'));
        expect(open).toContain('★10');
    });

    it('展開列的 aria-expanded 與展開狀態一致', () => {
        expect(tableHtml(groups, view([GUN_41]))).toContain(`data-mst="${GUN_41}" aria-expanded="true"`);
        expect(tableHtml(groups, view())).toContain(`data-mst="${GUN_41}" aria-expanded="false"`);
    });

    it('消耗品標記出來（不計入裝備欄上限）', () => {
        expect(tableHtml(groups, view())).toContain(t('ov.eqConsumableTag'));
    });
});

describe('圖磚', () => {
    const groups = groupGears(gears([{ id: 1, mst: GUN_41 }, { id: 2, mst: GUN_41 }], [1]));

    it('比例條寬度＝裝備中佔比', () => {
        // 兩顆裡一顆裝備中 → 50%
        expect(cardsHtml(groups, view())).toContain('width:50%');
    });

    it('只列非零素質（裝備多數素質是 0，全列會蓋掉重點）', () => {
        const html = cardsHtml(groups, view());
        expect(html).toContain(t('ov.rsColFire'));    // 火力 20，要出現
        expect(html).not.toContain(t('ov.eqColBaku')); // 爆裝 0，不出現
    });
});

describe('HTML escape', () => {
    // 裝備名來自遊戲封包，理論上不含標記，但輸出一律轉義——名稱是外部資料，不是常數。
    const hostile = '<img src=x onerror=alert(1)>';
    const group: GearGroup = {
        ...groupGears(gears([{ id: 1, mst: GUN_41 }]))[0],
        name: hostile,
        catName: hostile,
        holders: [{ name: hostile, sub: '', kind: 'ship', count: 1 }],
    };

    it('裝備名／類別名在兩種模式下都被轉義', () => {
        for (const html of [tableHtml([group], view()), cardsHtml([group], view())]) {
            expect(html).not.toContain('<img src=x');
            expect(html).toContain('&lt;img src=x');
        }
    });

    it('展開列的持有者名也被轉義（持有者只在展開列出現，不是欄位）', () => {
        const evil = { ...group, instances: group.instances.map(i => ({
            ...i, holder: { kind: 'ship' as const, name: hostile, sub: '', ex: false },
        })) };
        const html = tableHtml([evil], view([evil.mst]));
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x');
    });
});

describe('CSV 匯出', () => {
    const groups = groupGears(gears([{ id: 1, mst: GUN_41, level: 10 }, { id: 2, mst: GUN_41 }], [1]));

    it('標題列＋每種一列，欄數＝目前顯示的欄位（畫面顯示什麼就匯出什麼）', () => {
        const lines = gearCsv(groups, view()).split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0].split(',')).toHaveLength(visibleColumns(view()).length);
    });

    it('內容為純文字（改修分佈攤平，不含 HTML）', () => {
        const csv = gearCsv(groups, view());
        expect(csv).not.toContain('<');
        expect(csv).toContain('★10×1 ★0×1');
    });

    it('打開「裝備中艦娘」欄後，CSV 才帶持有者——匯出跟著欄位開關走', () => {
        expect(gearCsv(groups, view())).not.toContain('明石');
        const withHolder = view([], new Set([...defaultCols(), 'holder']));
        expect(gearCsv(groups, withHolder)).toContain('明石');
    });

    it('含逗號的欄位加引號', () => {
        const withComma: GearGroup = { ...groups[0], name: 'a,b' };
        expect(gearCsv([withComma], view())).toContain('"a,b"');
    });
});

describe('多語系', () => {
    it('欄位標題隨語言切換（沿用既有的素質標籤 key，不另建一份譯文）', () => {
        const groups = groupGears(gears([{ id: 1, mst: GUN_41 }]));
        setLang('ja');
        expect(tableHtml(groups, view())).toContain('個数');
        setLang('en');
        expect(tableHtml(groups, view())).toContain('Count');
        setLang('zh-TW');
        expect(tableHtml(groups, view())).toContain('數量');
    });
});
