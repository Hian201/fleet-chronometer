import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

describe('基地航空隊疲勞與整備等級', () => {
    it('疲勞以 api_cond 顯示狀態碼判定，0 與 1 都不顯示標記', () => {
        const state = new GameState();
        expect(state.lbasCondState(0)).toBe('normal');
        expect(state.lbasCondState(1)).toBe('normal');
        expect(state.lbasCondLabel(0)).toBe('');
        expect(state.lbasCondLabel(1)).toBe('');
        expect(state.lbasCondState(2)).toBe('tired');
        expect(state.lbasCondState(3)).toBe('exhausted');
        expect(state.lbasCondLabel(2)).not.toBe('');
        expect(state.lbasCondLabel(3)).toBe(state.lbasCondLabel(2));
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
