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

// 基地航空隊制空值。**這一組擋過兩次嚴重的錯**：
//   1. 舊碼把制空參與機種寫成 `t===6||45||56||57` 並誤標「局戦(56), 陸戦(57)」——
//      真正的局地戦闘機是 **48**，雷電・紫電改・隼・Spitfire 整批不計入。
//   2. 出撃公式漏了「迎撃×1.5／陸偵倍率／陸攻改修★」，面板制空會明顯低於 KC3Kai
//      （例：隼64+3陸攻 顯示 121〜124，正確 153〜155）。
// 分類依日wiki「艦載機熟練度」：艦戦・水戦・陸戦/局戦吃戰鬥機加成表，噴式機為 0。
// 出撃公式依 wikiwiki／KC3Kai：⌊(対空+1.5×迎撃+改修)×√搭載+熟練⌋，再 × 陸偵倍率。
describe('基地航空隊制空值', () => {
    const SHIDEN_KAI = 202;       // 紫電二一型 紫電改（局戦 48、対空 9、迎撃 3）
    const KIKKA_KAI = 200;        // 橘花改（噴式戦闘爆撃機 57、対空 12）
    const HAYABUSA_64 = 225;      // 一式戦 隼II型(64戦隊)（対空 11、迎撃 5）
    const GINGA_SK = 504;         // 銀河(熟練)（陸攻、対空 3）
    const GINGA_EGUSA = 388;      // 銀河(江草隊)（陸攻、対空 3）
    const B25 = 459;              // B-25（陸攻、対空 4）
    const LB_RECON_SK = 312;      // 二式陸上偵察機(熟練)（陸偵、対空 3、索敵 9）
    const HIRYU_SK = 404;         // 四式重爆 飛龍(熟練)（陸攻、対空 5）
    const HIRYU_GUIDED = 444;     // 四式重爆 飛龍+イ号一型甲 誘導弾（陸攻、対空 5）
    const HIRYU_SK_GUIDED = 484;  // 四式重爆 飛龍(熟練)+イ号一型甲 誘導弾（陸攻、対空 5）

    const master = JSON.parse(
        readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

    /** 一格中隊的基地：指定裝備 master、搭載數與熟練度。 */
    function baseWith(mst: number, count: number, alv: number, level = 0) {
        return baseFrom([[mst, count, alv, level]]);
    }

    /** 多中隊基地：每列 [mst, count, alv, level?]。 */
    function baseFrom(slots: Array<[number, number, number, number?]>) {
        const state = new GameState();
        state.applyEvent('api_start2/getData', master);
        state.applyEvent('api_get_member/require_info', {
            api_slot_item: slots.map(([mst, , alv, level = 0], i) => ({
                api_id: i + 1, api_slotitem_id: mst, api_level: level, api_alv: alv,
            })),
        });
        state.applyEvent('api_get_member/base_air_corps', [{
            api_area_id: 6, api_rid: 1, api_name: '第一航空隊',
            api_distance: { api_base: 5, api_bonus: 0 }, api_action_kind: 1,
            api_plane_info: slots.map(([, count], i) => ({
                api_squadron_id: i + 1, api_state: 1, api_slotid: i + 1,
                api_count: count, api_max_count: count, api_cond: 0,
            })),
        }]);
        return state;
    }

    it('局地戦闘機（48）計入制空，吃戰鬥機熟練加成，並加 1.5×迎撃', () => {
        // 紫電改 対空9＋迎撃3→相當 13.5、18 搭載、熟練 >>
        // → 13.5×√18 ＋ 22 ＋ √10 ＝ 57.28＋22＋3.16 → 82
        expect(baseWith(SHIDEN_KAI, 18, 7).lbasAirPower(6, 1).min).toBe(82);
        // 熟練度 0：13.5×√18 ＝ 57.27… → 57（若漏迎撃會停在 38）
        expect(baseWith(SHIDEN_KAI, 18, 0).lbasAirPower(6, 1).min).toBe(57);
    });

    it('噴式機（57）不吃戰鬥機加成，也不套迎撃×1.5', () => {
        // 橘花改 対空12、houk=1 但 type≠48 → 不加迎撃；12×√18 ＋ √10 → 54
        expect(baseWith(KIKKA_KAI, 18, 7).lbasAirPower(6, 1).min).toBe(54);
        // 若誤給戰鬥機加成會是 54+22＝76；若誤加迎撃會是 ⌊13.5×√18＋√10⌋＝60
        expect(baseWith(KIKKA_KAI, 18, 7).lbasAirPower(6, 1).min).toBeLessThan(60);
    });

    it('隼64 單格出撃制空＝wiki 表 103（迎撃×1.5 的回歸錨）', () => {
        // 対空11＋1.5×迎撃5＝18.5；18 機・熟練 >> → wiki／KC3Kai 皆 103
        expect(baseWith(HAYABUSA_64, 18, 7).lbasAirPower(6, 1)).toEqual({ min: 103, max: 103 });
    });

    it('實戰編成：隼64＋3 陸攻 → 153〜155（對齊 KC3Kai；漏迎撃會變 121〜124）', () => {
        const air = baseFrom([
            [HAYABUSA_64, 18, 7],
            [GINGA_SK, 18, 7],
            [GINGA_EGUSA, 18, 7],
            [B25, 18, 7],
        ]).lbasAirPower(6, 1);
        expect(air).toEqual({ min: 153, max: 155 });
    });

    it('陸偵(熟練) 出撃倍率 ×1.18，陸攻改修吃 0.5√★ → 102〜103', () => {
        // 二式陸偵(熟練)★2 ＋ 飛龍(熟練) ＋ 飛龍誘導弾★4 ＋ 飛龍(熟練)誘導弾★1
        // 漏倍率／改修會停在 81
        const air = baseFrom([
            [LB_RECON_SK, 4, 7, 2],
            [HIRYU_SK, 18, 7],
            [HIRYU_GUIDED, 18, 7, 4],
            [HIRYU_SK_GUIDED, 18, 7, 1],
        ]).lbasAirPower(6, 1);
        expect(air).toEqual({ min: 102, max: 103 });
    });
});
