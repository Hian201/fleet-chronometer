import { afterEach, describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import { setLang } from '../utils/ui-i18n';

function withMaster(areas: { api_id: number; api_name: string }[]): GameState {
    const state = new GameState();
    for (const area of areas) state.masterMapAreas.set(area.api_id, area.api_name);
    return state;
}

afterEach(() => setLang('ja'));

describe('mapAreaName 依介面語言顯示通常海域', () => {
    it('通常海域查共用譯名表，日文用 master 原名', () => {
        const state = withMaster([{ api_id: 1, api_name: '鎮守府海域' }, { api_id: 7, api_name: '南西海域' }]);
        setLang('en');
        expect(state.mapAreaName(1)).toBe('Naval Base Waters');
        expect(state.mapAreaName(7)).toBe('South Western Waters');
        setLang('zh-TW');
        expect(state.mapAreaName(1)).toBe('鎮守府海域');
        setLang('ja');
        expect(state.mapAreaName(1)).toBe('鎮守府海域');
    });

    it('master 已改名時退回 master 原名，不套舊譯名', () => {
        const state = withMaster([{ api_id: 3, api_name: '北方海域（改）' }]);
        setLang('en');
        expect(state.mapAreaName(3)).toBe('北方海域（改）');
    });

    it('活動海域維持 master 名稱', () => {
        const state = withMaster([{ api_id: 62, api_name: '反撃！第三十一戦隊の戦い' }]);
        setLang('en');
        expect(state.mapAreaName(62)).toBe('反撃！第三十一戦隊の戦い');
    });
});
