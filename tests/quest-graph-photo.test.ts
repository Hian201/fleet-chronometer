import { describe, expect, it } from 'vitest';
import {
    QUEST_GRAPH_PHOTO_MAX_SIDE, questGraphPhotoFilename, questGraphPhotoScale, wrapQuestGraphText,
} from '../utils/quest-graph-photo';

// 每個字元寬 10 的等寬量測
const measure = (value: string) => [...value].length * 10;

describe('關係圖拍照', () => {
    it('預設 2 倍輸出；太大時縮到單邊上限，但不低於 1 倍', () => {
        expect(questGraphPhotoScale(1200, 1500)).toBe(2);
        expect(questGraphPhotoScale(6000, 1000)).toBeCloseTo(QUEST_GRAPH_PHOTO_MAX_SIDE / 6000);
        expect(questGraphPhotoScale(20000, 1000)).toBe(1);
        expect(questGraphPhotoScale(0, 100)).toBe(1);
    });

    it('漢字逐字斷行，超過行數時最後一行以…收尾', () => {
        expect(wrapQuestGraphText('第一線航空母艦鳳翔改二演習開始', 50, 2, measure))
            .toEqual(['第一線航空', '母艦鳳翔…']);
        expect(wrapQuestGraphText('短名', 50, 2, measure)).toEqual(['短名']);
    });

    it('拉丁文優先在空白處斷行，單字比整行長時才硬斷', () => {
        expect(wrapQuestGraphText('Daily Victory', 100, 2, measure)).toEqual(['Daily', 'Victory']);
        expect(wrapQuestGraphText('Supercalifragilistic', 50, 2, measure)).toEqual(['Super', 'cali…']);
    });

    it('檔名帶任務代號與本機時間，代號只留安全字元', () => {
        const ts = new Date(2026, 9, 6, 9, 5, 7).getTime();
        expect(questGraphPhotoFilename('B214', ts)).toBe('quest-graph-B214-20261006-090507.png');
        expect(questGraphPhotoFilename('2412B7', ts)).toBe('quest-graph-2412B7-20261006-090507.png');
        expect(questGraphPhotoFilename('「？」', ts)).toBe('quest-graph-quest-20261006-090507.png');
    });
});
