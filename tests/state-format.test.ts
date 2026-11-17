// state.ts 的顯示命名注入（utils/state-format.ts）。本檔刻意不匯入 ui-i18n：註冊是模組載入的
// 副作用，一旦匯入就沒辦法再觀察未註冊時的預設行為。
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stateFormatters } from '../utils/state-format';
import { importClosure, PROJECT_ROOT } from './helpers/import-closure';

describe('未註冊時的預設行為', () => {
    it('localize 系列回退封包原名，缺名回 ?', () => {
        expect(stateFormatters.localizeShip(1, '睦月')).toBe('睦月');
        expect(stateFormatters.localizeGear(1, '12cm単装砲')).toBe('12cm単装砲');
        expect(stateFormatters.localizeEquipmentType(1, '小口径主砲')).toBe('小口径主砲');
        expect(stateFormatters.localizeShip(1, undefined)).toBe('?');
    });

    it('遠征獎勵物品名回傳封包原名', () => {
        expect(stateFormatters.expedItemDisplayName(4, '高速修復材')).toBe('高速修復材');
        expect(stateFormatters.expedItemFullName(4, '高速修復材')).toBe('高速修復材');
    });

    it('t() 回傳 key、語言為日文：缺註冊是看得見的錯，不是靜默錯譯', () => {
        expect(stateFormatters.t('fleet.default', { n: 1 })).toBe('fleet.default');
        expect(stateFormatters.getLang()).toBe('ja');
    });
});

describe('service worker 不帶字串表與譯名表', () => {
    const banned = ['utils/ui-i18n.ts', 'utils/gamedata-i18n.ts', 'utils/gamedata-names.ts'];

    it('state.ts 的遞移匯入不含兩張表', () => {
        expect(importClosure('utils/state.ts').filter(f => banned.includes(f))).toEqual([]);
    });

    it('background 的遞移匯入不含兩張表', () => {
        expect(importClosure('entrypoints/background.ts').filter(f => banned.includes(f))).toEqual([]);
    });

    it('content script 與 service worker 一樣不得帶表', () => {
        for (const entry of ['entrypoints/bridge.content.ts', 'entrypoints/interceptor.content.ts', 'entrypoints/theater.content.ts']) {
            expect(importClosure(entry).filter(f => banned.includes(f)), entry).toEqual([]);
        }
    });

    it('註冊只放在 state-display：放回 ui-i18n 會讓打包器剪不掉整份表', () => {
        const display = readFileSync(resolve(PROJECT_ROOT, 'utils/state-display.ts'), 'utf8');
        expect(display).toMatch(/setStateFormatters\(\{[\s\S]*localizeShip[\s\S]*\}\)/);
        const i18n = readFileSync(resolve(PROJECT_ROOT, 'utils/ui-i18n.ts'), 'utf8');
        expect(i18n).not.toContain('setStateFormatters');
    });

    it('擴充頁面的三個入口都會安裝（經 ui-prefs）', () => {
        for (const entry of ['entrypoints/panel/main.ts', 'entrypoints/overview/main.ts', 'entrypoints/popup/main.ts']) {
            expect(importClosure(entry), entry).toContain('utils/state-display.ts');
        }
    });
});

describe('離線預覽腳本', () => {
    it('凡遞移匯入 state.ts 的預覽腳本，也必須匯入 state-display.ts（否則輸出會露出未翻譯的 key）', () => {
        const dir = resolve(PROJECT_ROOT, 'tools/preview');
        const missing = readdirSync(dir)
            .filter(f => f.endsWith('.ts'))
            .sort()
            .filter(f => {
                const closure = importClosure(`tools/preview/${f}`);
                return closure.includes('utils/state.ts') && !closure.includes('utils/state-display.ts');
            });
        expect(missing, '以下預覽腳本缺少 import \'../../utils/state-display\';').toEqual([]);
    });
});
