// 節點類型對照。api_event_id 的語意轉寫自航海日誌拡張版（Nishisonic/logbook, MIT）的
// MapCellDto.getNextKind()；api_event_kind 的三個值另有本專案樣本的獨立佐證
// （KC3Kai 匯出的 nodes[].desc 與 eventKind 對得上）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NODE_KIND_KEYS, nodeKindKey } from '../utils/map-node-kind';

const sample = (name: string) => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));

describe('節點類型', () => {
    it('api_event_id 的各分類', () => {
        expect(nodeKindKey(2, 0)).toBe(NODE_KIND_KEYS.resource);
        expect(nodeKindKey(3, 0)).toBe(NODE_KIND_KEYS.maelstrom);
        expect(nodeKindKey(6, 1)).toBe(NODE_KIND_KEYS.noEnemy);
        expect(nodeKindKey(6, 2)).toBe(NODE_KIND_KEYS.branch);
        expect(nodeKindKey(6, 9)).toBe(NODE_KIND_KEYS.nothing);
        expect(nodeKindKey(7, 0)).toBe(NODE_KIND_KEYS.airRecon);
        expect(nodeKindKey(7, 1)).toBe(NODE_KIND_KEYS.airBattle);
        expect(nodeKindKey(8, 0)).toBe(NODE_KIND_KEYS.escortSuccess);
        expect(nodeKindKey(9, 0)).toBe(NODE_KIND_KEYS.landing);
    });

    it('戰鬥節點只認有樣本佐證的 kind（空襲戰／敵連合），其餘不猜', () => {
        expect(nodeKindKey(4, 6)).toBe(NODE_KIND_KEYS.airRaid);
        expect(nodeKindKey(5, 5)).toBe(NODE_KIND_KEYS.enemyCombined);
        expect(nodeKindKey(4, 1)).toBeNull();   // 一般戰鬥：rank 已經說明了，不再標
        expect(nodeKindKey(4, 2)).toBeNull();   // 無樣本佐證 → 不猜
        expect(nodeKindKey(4, 3)).toBeNull();
    });

    it('缺欄位（舊紀錄）一律回 null', () => {
        expect(nodeKindKey(undefined, undefined)).toBeNull();
        expect(nodeKindKey(undefined, 6)).toBeNull();
        expect(nodeKindKey(99, 0)).toBeNull();
    });

    it('與 KC3Kai 匯出的 desc 交叉驗證（真實樣本）', () => {
        // 61-5：eventKind 6 的節點 desc 都是「空襲」、eventKind 5 是「深海聯合艦隊」
        const nodes = sample('61-5-jibun-rengou-node52.json').nodes as any[];
        for (const node of nodes) {
            const key = nodeKindKey(node.eventId, node.eventKind);
            if (node.desc === '空襲') expect(key).toBe(NODE_KIND_KEYS.airRaid);
            if (node.eventKind === 5) expect(key).toBe(NODE_KIND_KEYS.enemyCombined);
            if (node.eventKind === 1) expect(key).toBeNull();   // 一般戰鬥
        }
        expect(nodes.some(n => n.desc === '空襲')).toBe(true);
        expect(nodes.some(n => n.eventKind === 5)).toBe(true);
    });
});
