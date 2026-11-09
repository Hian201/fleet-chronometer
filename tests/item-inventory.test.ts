import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { itemCatalog, itemMatches, uncataloguedUseItem } from '../utils/item-catalog';

describe('道具持有量', () => {
    it('從 require_info 與 useitem 完整快照讀取數量，並保留「尚未取得」與 0 的差別', () => {
        const state = new GameState();
        expect(state.useItemCount(78)).toBeNull();

        state.applyEvent('api_get_member/require_info', {
            api_slot_item: [], api_kdock: [], api_useitem: [{ api_id: 78, api_count: 3 }],
        });
        expect(state.useItemCount(78)).toBe(3);
        expect(state.useItemCount(74)).toBe(0);

        state.applyEvent('api_get_member/useitem', [{ api_id: 78, api_count: 0 }]);
        expect(state.useItemCount(78)).toBe(0);

        state.applyEvent('api_get_member/useitem', null);
        expect(state.useItemCount(78)).toBe(0);
    });

    it('格式不完整或有重複 id 的回應不會覆蓋最後一份有效快照', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/useitem', [{ api_id: 78, api_count: 3 }]);

        state.applyEvent('api_get_member/useitem', [{ api_id: 78, api_count: -1 }]);
        expect(state.useItemCount(78)).toBe(3);

        state.applyEvent('api_get_member/useitem', [
            { api_id: 78, api_count: 1 }, { api_id: 78, api_count: 2 },
        ]);
        expect(state.useItemCount(78)).toBe(3);

        state.applyEvent('api_get_member/useitem', [{ api_id: 78, api_count: null }]);
        expect(state.useItemCount(78)).toBe(3);

        state.applyEvent('api_get_member/useitem', [{ api_id: 78, api_count: '0' }]);
        expect(state.useItemCount(78)).toBe(3);
    });

    it('從 start2 主檔補上新道具日文名稱，未建目錄的新 ID 仍可顯示和搜尋', () => {
        const state = new GameState();
        state.applyEvent('api_start2/getData', {
            api_mst_ship: [], api_mst_slotitem: [],
            api_mst_useitem: [{ api_id: 106, api_name: '確認済みの新道具' }],
        });
        state.applyEvent('api_get_member/useitem', [{ api_id: 106, api_count: 2 }]);

        const observed = state.observedUseItems_();
        expect(observed).toContainEqual({ id: 106, count: 2 });
        expect(state.useItemName(106)).toBe('確認済みの新道具');
        const fallback = uncataloguedUseItem(106, state.useItemName(106));
        expect(fallback.inventory).toBe('other');
        expect(itemMatches(fallback, '確認済みの新道具')).toBe(true);
        expect(fallback.names['zh-TW']).toBe('未收錄道具（ID 106）');
        expect(fallback.names.en).toBe('Untranslated item (ID 106)');
    });

    it('目錄涵蓋標準、擴張和其他來源的道具，名稱別名仍對應同一筆 ID', () => {
        expect(itemCatalog.some(item => item.id === 49 && item.inventory === 'standard')).toBe(true);
        expect(itemCatalog.some(item => item.id === 102 && item.inventory === 'expansion')).toBe(true);
        expect(itemCatalog.some(item => item.id === 79 && item.inventory === 'other')).toBe(true);
        expect(itemCatalog.find(item => item.countSource.kind === 'payitem' && item.countSource.id === 16))
            .toMatchObject({ inventory: 'other', names: { 'zh-TW': '母港擴張', ja: '母港拡張', en: 'Port Expansion' } });

        const keys = itemCatalog.map(item => `${item.inventory}:${item.countSource.kind}:${
            item.countSource.kind === 'slotitem' ? item.countSource.nameJa :
                item.countSource.kind === 'material' ? item.countSource.apiId : item.countSource.id}`);
        expect(new Set(keys).size).toBe(itemCatalog.length);
        const report = itemCatalog.find(item => item.names['zh-TW'] === '戰鬥詳報')!;
        for (const term of ['戰鬥詳報', '戦闘詳報', 'action report']) expect(itemMatches(report, term)).toBe(true);
    });

    it('沿用公開工具的已知獲得與消耗回應更新 useitem 計數', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/useitem', [{ api_id: 78, api_count: 3 }]);

        state.applyEvent('api_req_mission/result', {
            api_get_item1: { api_useitem_id: 78, api_useitem_count: 2 },
        });
        expect(state.useItemCount(78)).toBe(5);

        state.applyEvent('api_req_kousyou/remodel_slotlist_detail', {
            api_req_useitem_id: 78, api_req_useitem_num: 2,
        }, { api_id: '315', api_slot_id: '20581' });
        expect(state.useItemCount(78)).toBe(5);
        // remodel_slot 回應沒有道具欄位；依剛才確認畫面的需求扣，失敗也照扣。
        state.applyEvent('api_req_kousyou/remodel_slot', { api_remodel_flag: 0 },
            { api_id: '315', api_slot_id: '20581', api_certain_flag: '0' });
        expect(state.useItemCount(78)).toBe(3);

        state.applyEvent('api_req_combined_battle/battleresult', {
            api_get_useitem: { api_useitem_id: 78 }, api_get_exmap_useitem_id: 78,
        });
        expect(state.useItemCount(78)).toBe(5);

        const unknown = new GameState();
        unknown.applyEvent('api_req_mission/result', {
            api_get_item1: { api_useitem_id: 78, api_useitem_count: 2 },
        });
        expect(unknown.useItemCount(78)).toBeNull();
    });

    it('改修確認畫面只記需求：取消、換裝備或重複嘗試都不多扣', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/useitem', [{ api_id: 78, api_count: 10 }, { api_id: 75, api_count: 10 }]);
        const detail = (slotId: string) => state.applyEvent('api_req_kousyou/remodel_slotlist_detail', {
            api_req_useitem_id: 78, api_req_useitem_num: 2,
            api_req_useitem_id2: 75, api_req_useitem_num2: 1,
        }, { api_id: '315', api_slot_id: slotId });
        const remodel = (slotId: string) => state.applyEvent('api_req_kousyou/remodel_slot',
            { api_remodel_flag: 1 }, { api_id: '315', api_slot_id: slotId, api_certain_flag: '0' });

        detail('1'); detail('1');
        expect(state.useItemCount(78)).toBe(10);

        detail('1'); remodel('2');   // 不同裝備：不扣
        expect(state.useItemCount(78)).toBe(10);

        detail('1'); remodel('1');
        expect([state.useItemCount(78), state.useItemCount(75)]).toEqual([8, 9]);
        remodel('1');   // 沒有新的確認畫面：需求已用過，不重複扣
        expect([state.useItemCount(78), state.useItemCount(75)]).toEqual([8, 9]);
    });

    it('近代化改修帶 api_limited_feed_type=1 時扣 1 個南瓜；一般改修與未取得清單時不動', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/useitem', [{ api_id: 96, api_count: 3 }]);
        const powerup = (req: Record<string, string>) =>
            state.applyEvent('api_req_kaisou/powerup', { api_powerup_flag: 1 }, req);

        powerup({ api_id: '1', api_id_items: '2', api_slot_dest_flag: '0' });
        expect(state.useItemCount(96)).toBe(3);
        powerup({ api_id: '1', api_id_items: '2', api_limited_feed_type: '1' });
        expect(state.useItemCount(96)).toBe(2);
        powerup({ api_id: '1', api_id_items: '3', api_limited_feed_type: '1' });
        powerup({ api_id: '1', api_id_items: '4', api_limited_feed_type: '1' });
        powerup({ api_id: '1', api_id_items: '5', api_limited_feed_type: '1' });
        expect(state.useItemCount(96)).toBe(0);   // 不會扣成負數

        const unknown = new GameState();
        unknown.applyEvent('api_req_kaisou/powerup', { api_powerup_flag: 1 },
            { api_id: '1', api_id_items: '2', api_limited_feed_type: '1' });
        expect(unknown.useItemCount(96)).toBeNull();
    });

    it('遊戲不再重送 useitem 的固定消耗操作：每次請求補扣 1 個', () => {
        const cases: [string, number][] = [
            ['api_req_kaisou/marriage', 55], ['api_req_kaisou/open_exslot', 64],
            ['api_req_hensei/preset_expand', 49], ['api_req_kaisou/preset_slot_expand', 49],
            ['api_req_kousyou/open_new_dock', 49], ['api_req_nyukyo/open_new_dock', 49],
            ['api_req_map/anchorage_repair', 91], ['api_req_air_corps/expand_base', 73],
            ['api_req_air_corps/expand_maintenance_level', 73], ['api_req_air_corps/cond_recovery', 102],
        ];
        for (const [path, id] of cases) {
            const state = new GameState();
            state.applyEvent('api_get_member/useitem', [{ api_id: id, api_count: 2 }]);
            state.applyEvent(path, {}, {});
            expect([path, state.useItemCount(id)]).toEqual([path, 1]);
            const unknown = new GameState();
            unknown.applyEvent(path, {}, {});
            expect(unknown.useItemCount(id)).toBeNull();
        }
    });

    it('道具兌換得到的裝備依回應實例加入裝備清單，不推算道具消耗量', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/useitem', [{ api_id: 68, api_count: 50 }]);
        state.applyEvent('api_get_member/slot_item', [{ api_id: 1, api_slotitem_id: 10, api_level: 0, api_locked: 0 }]);
        expect(state.slotItems.size).toBe(1);

        state.applyEvent('api_req_member/itemuse', {
            api_caution_flag: 0, api_flag: 1,
            api_getitem: [
                null,
                { api_usemst: 2, api_mst_id: 118, api_getcount: 1,
                  api_slotitem: { api_id: 77, api_slotitem_id: 118, api_level: 0, api_locked: 0 } },
                { api_usemst: 6, api_mst_id: 70, api_getcount: 2 },
            ],
        }, { api_useitem_id: '68', api_exchange_type: '34', api_force_flag: '0' });
        expect(state.slotItems.size).toBe(2);
        expect(state.slotItems.get(77)?.mst).toBe(118);
        expect(state.useItemCount(68)).toBe(50);

        // 缺欄位或格式不明的回應不動既有資料
        state.applyEvent('api_req_member/itemuse', { api_getitem: null }, {});
        state.applyEvent('api_req_member/itemuse', { api_getitem: [{ api_slotitem: { api_id: 78 } }] }, {});
        state.applyEvent('api_req_member/itemuse', {}, {});
        expect(state.slotItems.size).toBe(2);
    });

    it('間宮／伊良湖依 api_use_type 位元各扣 1 個', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/useitem', [{ api_id: 54, api_count: 5 }, { api_id: 59, api_count: 5 }]);
        const use = (type: string) => state.applyEvent('api_req_member/itemuse_cond', {}, { api_deck_id: '1', api_use_type: type });
        use('1');
        expect([state.useItemCount(54), state.useItemCount(59)]).toEqual([4, 5]);
        use('2');
        expect([state.useItemCount(54), state.useItemCount(59)]).toEqual([4, 4]);
        use('3');
        expect([state.useItemCount(54), state.useItemCount(59)]).toEqual([3, 3]);
        state.applyEvent('api_req_member/itemuse_cond', {}, { api_deck_id: '1' });
        expect([state.useItemCount(54), state.useItemCount(59)]).toEqual([3, 3]);
    });

    it('以 payitem、材料 API id 與裝備 master 名稱讀取不同來源的數量', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/payitem', [
            { api_payitem_id: 11, api_count: 4 }, { api_payitem_id: 14, api_count: 2 },
            { api_payitem_id: 16, api_count: 1 },
        ]);
        expect(state.payItemCount(11)).toBe(4);
        expect(state.payItemCount(14)).toBe(2);
        expect(state.payItemCount(16)).toBe(1);
        state.applyEvent('api_get_member/payitem', []);
        expect(state.payItemCount(16)).toBe(0);

        state.materials = [100, 200, 300, 400, 50, 60, 70, 80];
        expect(state.materialCount(8)).toBe(80);
        expect(state.materialCount(9)).toBeNull();

        state.masterGears.set(501, {
            name: '戦闘糧食', icon: 0, cat: 0, aa: 0, los: 0, distance: 0, sortNo: 0,
            stats: { houg: 0, houm: 0, leng: 0, luck: 0, houk: 0, baku: 0, raig: 0, saku: 0, tais: 0, tyku: 0, souk: 0 },
        });
        expect(state.slotItemCountByJapaneseName('戦闘糧食')).toBeNull();
        state.applyEvent('api_get_member/require_info', {
            api_slot_item: [{ api_id: 1, api_slotitem_id: 501 }], api_kdock: [], api_useitem: [],
        });
        expect(state.slotItemCountByJapaneseName('戦闘糧食')).toBe(1);
    });
});
