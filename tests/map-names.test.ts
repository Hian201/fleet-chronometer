import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREA_NAMES, MAP_NAMES, OPERATION_NAMES, PSEUDONYM_NOTES_EN, areaName, mapName, operationName } from '../utils/map-names';

function masterMapNames(): Map<string, string> {
    const raw = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
    const find = (value: any): any[] | undefined => {
        if (!value || typeof value !== 'object') return undefined;
        if (Array.isArray(value.api_mst_mapinfo)) return value.api_mst_mapinfo;
        for (const child of Object.values(value)) {
            const found = find(child);
            if (found) return found;
        }
        return undefined;
    };
    return new Map(find(raw)!.map(info => [`${info.api_maparea_id}-${info.api_no}`, info.api_name]));
}

function masterOperations(): Map<string, string> {
    const raw = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
    const find = (value: any): any[] | undefined => {
        if (!value || typeof value !== 'object') return undefined;
        if (Array.isArray(value.api_mst_mapinfo)) return value.api_mst_mapinfo;
        for (const child of Object.values(value)) {
            const found = find(child);
            if (found) return found;
        }
        return undefined;
    };
    return new Map(find(raw)!.map(info => [`${info.api_maparea_id}-${info.api_no}`, info.api_opetext]));
}

describe('通常海域英文關名', () => {
    it('對照表的日文關名與 start2 樣本逐關一致', () => {
        const master = masterMapNames();
        for (const [map, entry] of Object.entries(MAP_NAMES)) {
            expect(master.get(map), map).toBe(entry.jp);
        }
        // 反向：樣本裡每個通常海域都有譯名，新關加入時這裡會提醒補表。
        for (const map of master.keys()) {
            if (Number(map.split('-')[0]) < 10) expect(MAP_NAMES[map], map).toBeDefined();
        }
    });

    it('作戰名與 start2 樣本逐關一致，通常海域每關都有', () => {
        const master = masterOperations();
        for (const [map, entry] of Object.entries(OPERATION_NAMES)) expect(master.get(map), map).toBe(entry.jp);
        for (const map of master.keys()) {
            if (Number(map.split('-')[0]) < 10) expect(OPERATION_NAMES[map], map).toBeDefined();
        }
        // 同名海域靠作戰名區分
        expect(mapName('4-1', 'zh-TW')).toBe(mapName('7-5', 'zh-TW'));
        expect(operationName('4-1', 'zh-TW')).not.toBe(operationName('7-5', 'zh-TW'));
        expect(operationName('7-4', 'en')).toBe('Hi Convoy Maritime Escort Operation');
        expect(operationName('1-1', 'zh-TW', '近海警備（改名）')).toBeNull();
    });

    it('英文偽名附註只對應已收錄的關，且不取代原名', () => {
        for (const map of Object.keys(PSEUDONYM_NOTES_EN)) expect(MAP_NAMES[map], map).toBeDefined();
        expect(operationName('4-2', 'en')).toBe('Curry Ocean Takeover Battle');
        expect(PSEUDONYM_NOTES_EN['4-2']).toBe('Curry Ocean = Indian Ocean');
    });

    it('大區名與 start2 樣本一致', () => {
        const raw = readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8');
        for (const entry of Object.values(AREA_NAMES)) expect(raw).toContain(`"${entry.jp}"`);
        expect(areaName(1, 'zh-TW')).toBe('鎮守府海域');
        expect(areaName(7, 'en')).toBe('South Western Waters');
        expect(areaName(8, 'en')).toBeNull();
    });

    it('master 關名對不上（遊戲已改名）時不給譯名；沒有 master 時信任表', () => {
        expect(mapName('1-1', 'en', '鎮守府正面海域')).toBe('Sea in Front of the Naval Base');
        expect(mapName('2-2', 'zh-TW', 'バシー海峡')).toBe('巴士海峽');
        expect(mapName('2-5', 'zh-TW', '沖ノ島沖戦闘哨戒')).toBeNull();
        expect(mapName('2-5', 'ja', '沖ノ島沖戦闘哨戒')).toBe('沖ノ島沖戦闘哨戒');
        expect(mapName('7-5', 'en')).toBe('Off Java Island');
        expect(mapName('9-9', 'zh-TW')).toBeNull();
    });
});
