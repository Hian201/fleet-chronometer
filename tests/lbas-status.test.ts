import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

describe('基地航空隊疲勞與整備等級', () => {
    // 2026-08-04 以四份真封包定案（同一隊 62_2 隨連續出撃走完 0→1→2→3）：
    // 0=全滿／1=輕度疲勞（**遊戲同樣不顯示標記**）／2=橙／3=赤。
    // ⚠️ 中途曾依單一次實機回報改成 0=無/1=橙/2=赤，撈到 cond:3 才發現整組錯位
    // （3 變成「不明」、面板連符號都不顯示）。別再改回去。
    it('疲勞以 api_cond 顯示碼判定：0 全滿／1 輕度／2 橙／3 赤', () => {
        const state = new GameState();
        expect(state.lbasCondState(0)).toBe('normal');
        expect(state.lbasCondLabel(0)).toBe('');
        expect(state.lbasCondState(1)).toBe('mild');
        expect(state.lbasCondState(2)).toBe('tired');
        expect(state.lbasCondState(3)).toBe('exhausted');
        // 輕度與橙的標籤必須不同——前者遊戲沒有標記，講成「疲勞」會誤導
        expect(state.lbasCondLabel(1)).not.toBe(state.lbasCondLabel(2));
        expect(state.lbasCondLabel(2)).toBe(state.lbasCondLabel(3));
        expect(state.lbasCondState(null)).toBe('unknown');
        expect(state.lbasCondState(4)).toBe('unknown');
    });

    it('從 mapinfo 的 api_air_base_expanded_info 讀取海域共用的基地整備等級', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', {
            api_air_base_expanded_info: [
                { api_area_id: 6, api_maintenance_level: 3 },
                { api_area_id: 7, api_maintenance_level: 1 },
            ],
        });
        expect(state.airBaseMaintenanceLevel(6)).toBe(3);
        expect(state.airBaseMaintenanceLevel(7)).toBe(1);
        expect(state.airBaseMaintenanceLevel(62)).toBeNull();
    });

    it('整備欄位缺席時不把未知狀態猜成 Lv.0', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', {
            api_air_base_expanded_info: [{ api_area_id: 6, api_maintenance_level: 2 }],
        });
        state.applyEvent('api_get_member/mapinfo', { api_map_info: [] });
        expect(state.airBaseMaintenanceLevel(6)).toBe(2);
        expect(state.airBaseMaintenanceLevel(7)).toBeNull();
    });
});

// 基地航空隊制空值的機種分類。**這一組是為了擋一個曾經很嚴重的錯**：舊碼把制空參與
// 機種寫成 `t===6||45||56||57` 並在註解標成「局戦(56), 陸戦(57)」——但 56／57 是
// **噴式戦闘機／噴式戦闘爆撃機**，真正的局地戦闘機是 **48**。後果是雷電・紫電改・隼・
// Spitfire 等 31 種局戦整批不計入基地航空隊制空，而噴式機反被多給了戰鬥機加成。
// 分類依日wiki「艦載機熟練度」：艦戦・水戦・陸戦/局戦吃戰鬥機加成表，噴式機為 0。
describe('基地航空隊制空值的機種分類', () => {
    const SHIDEN_KAI = 202;   // 紫電二一型 紫電改（局地戦闘機 48、対空 9）
    const KIKKA_KAI = 200;    // 橘花改（噴式戦闘爆撃機 57、対空 12）

    /** 一格中隊的基地：指定裝備 master、搭載數與熟練度。 */
    function baseWith(mst: number, count: number, alv: number) {
        const state = new GameState();
        state.applyEvent('api_start2/getData',
            JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8')));
        state.applyEvent('api_get_member/require_info', {
            api_slot_item: [{ api_id: 1, api_slotitem_id: mst, api_level: 0, api_alv: alv }],
        });
        state.applyEvent('api_get_member/base_air_corps', [{
            api_area_id: 6, api_rid: 1, api_name: '第一航空隊',
            api_distance: { api_base: 5, api_bonus: 0 }, api_action_kind: 1,
            api_plane_info: [{ api_squadron_id: 1, api_state: 1, api_slotid: 1, api_count: count, api_max_count: count, api_cond: 1 }],
        }]);
        return state;
    }

    it('局地戦闘機（48）計入制空，並吃戰鬥機的熟練度加成', () => {
        // 紫電改 対空9、18 搭載、熟練 >>（內部100）→ 9×√18 ＋ 22 ＋ √10 ＝ 38.18＋22＋3.16 → 63
        expect(baseWith(SHIDEN_KAI, 18, 7).lbasAirPower(6, 1).min).toBe(63);
        // 熟練度 0 時只剩本體：9×√18 ＝ 38.18… → 38
        expect(baseWith(SHIDEN_KAI, 18, 0).lbasAirPower(6, 1).min).toBe(38);
    });

    it('噴式機（57）不吃戰鬥機加成，只有 √(內部熟練度/10) 那一項', () => {
        // 橘花改 対空12、18 搭載、熟練 >> → 12×√18 ＋ 0 ＋ √10 ＝ 50.9＋3.16 → 54
        expect(baseWith(KIKKA_KAI, 18, 7).lbasAirPower(6, 1).min).toBe(54);
        // 若誤給戰鬥機加成會是 54+22＝76，差距 22 制空
        expect(baseWith(KIKKA_KAI, 18, 7).lbasAirPower(6, 1).min).toBeLessThan(76);
    });
});
