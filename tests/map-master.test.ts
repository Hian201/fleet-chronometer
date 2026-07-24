// 海域 master（`api_mst_maparea`／`api_mst_mapinfo`）的讀取驗證。
// 全部以 samples/start2-master.json 餵進 GameState 後取得——該檔取自使用者的真實完整
// start2，內含**本次活動 area 62**，故活動海域這條路徑是真封包驗證而非合成資料。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));

const state = new GameState();
state.applyEvent('api_start2/getData', master);

describe('海域 master 讀入', () => {
    it('42 張圖', () => expect(state.masterMapInfo.size).toBe(42));

    // mapKey = areaId * 10 + mapNo（使用者說明：61-5 就是活動 area 61 的 E5）
    it('key 為 area*10+no', () => {
        expect([...state.masterMapInfo.keys()].filter(k => k >= 620 && k < 630))
            .toEqual([621, 622, 623, 624, 625]);
        expect(state.masterMapInfo.get(11)).toMatchObject({ area: 1, no: 1 });
    });
});

describe('活動海域（area 62，真實資料）', () => {
    it('區塊名即活動標題', () => {
        expect(state.mapAreaName(62)).toBe('反撃！第三十一戦隊の戦い');
    });

    it('五關，依序號升冪', () => {
        expect(state.mapsOfArea(62).map(m => m.no)).toEqual([1, 2, 3, 4, 5]);
    });

    // 活動關卡以「作戰名」為關卡名、「海域名」為副標題（見 CLAUDE.md）。
    it('每關都有海域名與作戰名', () => {
        const maps = state.mapsOfArea(62);
        expect(maps[0]).toEqual({
            no: 1, name: '九州沖/南西諸島沖', opetext: '第三十一戦隊駆逐艦の出撃',
        });
        expect(maps[4].name).toBe('ブレスト沖/大西洋/イギリス本土沖/バルト海');
        expect(maps.every(m => m.name && m.opetext)).toBe(true);
    });
});

describe('一般海域不受影響', () => {
    it('1-1', () => expect(state.mapsOfArea(1)[0])
        .toEqual({ no: 1, name: '鎮守府正面海域', opetext: '近海警備' }));
    it('6-5', () => expect(state.mapsOfArea(6).find(m => m.no === 5)!.name).toBe('KW環礁沖海域'));
    it('不存在的區塊回空陣列', () => expect(state.mapsOfArea(99)).toEqual([]));
});

describe('降級與重建', () => {
    it('無 start2 時回空陣列而非丟例外', () => {
        expect(new GameState().mapsOfArea(62)).toEqual([]);
    });

    // 活動結束後該活動的海域會從 master 消失，故每次 start2 全量重建、不 merge，
    // 否則已結束的活動會永遠留在清單裡。
    it('再次套用 start2 時全量重建', () => {
        const gs = new GameState();
        gs.applyEvent('api_start2/getData', master);
        expect(gs.mapsOfArea(62)).toHaveLength(5);
        gs.applyEvent('api_start2/getData', {
            ...master,
            api_mst_mapinfo: master.api_mst_mapinfo.filter((m: any) => m.api_maparea_id !== 62),
        });
        expect(gs.mapsOfArea(62)).toEqual([]);
        expect(gs.mapsOfArea(1)).not.toHaveLength(0);
    });
});
