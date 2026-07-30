// 翻譯對照表覆蓋率檢查的驗證。gamedata-known-ids.ts 是由 samples/i18n/*.csv（該次
// 下載 samples/start2-master.json 這個快照時整理的對照表）產生，故拿同一份 master
// 快照跑過 findUnknownShips/findUnknownGears 應該回報「沒有缺漏」——這是產生器與
// 差集邏輯的一致性防線，缺漏只能來自「遊戲更新後的新內容」而非程式錯誤。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findUnknownGears, findUnknownShips } from '../utils/gamedata-coverage';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

describe('findUnknownShips / findUnknownGears', () => {
    it('對照表產生當下的同一份 master 快照，回報零缺漏', () => {
        const shipMap = new Map<number, { name: string }>(
            master.api_mst_ship.map((s: any) => [s.api_id, { name: s.api_name }]));
        const gearMap = new Map<number, { name: string }>(
            master.api_mst_slotitem.map((g: any) => [g.api_id, { name: g.api_name }]));
        expect(findUnknownShips(shipMap)).toEqual([]);
        expect(findUnknownGears(gearMap)).toEqual([]);
    });

    it('對照表沒有的 id 會被抓出來，且依 id 升冪排序', () => {
        const shipMap = new Map<number, { name: string }>([
            [1, { name: '睦月' }],           // 已知
            [999999, { name: '新艦娘' }],     // 未知
            [999998, { name: '另一艘新艦娘' }],
        ]);
        expect(findUnknownShips(shipMap)).toEqual([
            { id: 999998, name: '另一艘新艦娘' },
            { id: 999999, name: '新艦娘' },
        ]);
    });

    it('空 Map 回報零缺漏（不是誤判成全部缺漏）', () => {
        expect(findUnknownShips(new Map())).toEqual([]);
        expect(findUnknownGears(new Map())).toEqual([]);
    });
});
