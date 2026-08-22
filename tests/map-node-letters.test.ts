// 節點字母查表。edge id 與節點字母不是可由編號推導的關係，故沒有對照時必須保留原始
// edge 編號；見 utils/map-node-letters.ts 檔頭。
import { describe, expect, it } from 'vitest';
import { EDGE_LETTERS } from '../utils/map-edge-letters';
import { hasNodeLetters, nodeLabel, nodeLetter } from '../utils/map-node-letters';

describe('節點字母', () => {
    it('61-5 的實測路線逐筆相符（使用者提供的 ground truth）', () => {
        const route = [1, 48, 15, 37, 51, 52, 55];
        expect(route.map(edge => nodeLabel('61-5', edge))).toEqual(['A', 'E', 'I', 'Q', 'Y', 'Z', 'ZZ']);
    });

    it('一般海域也有對照（使用者回報「一般海域也變數字」的那個缺口）', () => {
        expect(nodeLabel('1-1', 1)).toBe('A');
        expect(nodeLabel('6-5', 3)).toBe('C');
        expect(nodeLabel('6-5', 5)).toBe('E');
        // 1-1 到 7-x 全數收錄
        const normal = Object.keys(EDGE_LETTERS).filter(map => Number(map.split('-')[0]) <= 7);
        expect(normal.length).toBeGreaterThanOrEqual(37);
    });

    it('兩種推算法都與實測不符 —— 不可改回推算', () => {
        expect(String.fromCharCode(64 + 15)).toBe('O');     // ASCII 推算
        expect(nodeLabel('61-5', 15)).toBe('I');            // 實際
        const edges = Object.keys(EDGE_LETTERS['61-5']).map(Number).sort((a, b) => a - b);
        const letters = edges.map(edge => nodeLetter('61-5', edge)!);
        expect(letters).not.toEqual([...letters].sort());   // 編號排序 ≠ 字母順序
    });

    it('6-5 與使用者提供的 KC3Kai 截圖一致（第二份獨立 ground truth）', () => {
        // samples/KC3kai_sortie_log.png 的 6-5 路線顯示 A C E H G ／ M
        expect([1, 3, 5, 8, 7, 13].map(edge => nodeLabel('6-5', edge)))
            .toEqual(['A', 'C', 'E', 'H', 'G', 'M']);
    });

    it('多個 edge 對到同一個字母是事實（同節點不同進入方向），不是資料錯誤', () => {
        const letters = Object.values(EDGE_LETTERS['6-5']);
        expect(letters.length).toBeGreaterThan(new Set(letters).size);
    });

    it('沒有對照的海域顯示原始 edge 編號，不猜字母', () => {
        expect(nodeLetter('99-9', 3)).toBeNull();
        expect(nodeLabel('99-9', 3)).toBe('3');
        expect(hasNodeLetters('99-9')).toBe(false);
        expect(hasNodeLetters('6-5')).toBe(true);
    });

    it('無效 edge 一律回 ?', () => {
        expect(nodeLabel('6-5', 0)).toBe('?');
        expect(nodeLabel('6-5', -1)).toBe('?');
        expect(nodeLetter('6-5', 0)).toBeNull();
    });
});
