// 鎮守府海域 1-1～1-4 の分岐ルール（1-5／1-6 は EO：route-rules-eo.ts）。
// 転記の約束は route-rules-data.ts の檔頭を参照。出擊点は節點名 '1'。
import {
    all, any, atLeast, atMost, exactly, fastAtLeast, go, has, lean, none, pc, random, ships, when,
} from './route-rules-dsl';
import { exitsOf } from './route-predict';
import type { MapRules } from './route-predict';

const e14 = (n: string) => exitsOf('1-4', n);

export const W1_RULES: Record<string, MapRules> = {
    '1-1': {
        updated: null, checked: '2026/10/21', goal: ['C'],
        nodes: {
            // wiki：Cマス進行割合は艦隊人数で変わる（6隻55%…1隻80%）
            A: [
                random(['B', 'C'], ships(6, 6), pc('C', 55)),
                random(['B', 'C'], ships(5, 5), pc('C', 60)),
                random(['B', 'C'], ships(4, 4), pc('C', 65)),
                random(['B', 'C'], ships(3, 3), pc('C', 70)),
                random(['B', 'C'], ships(2, 2), pc('C', 75)),
                random(['B', 'C'], ships(1, 1), pc('C', 80)),
            ],
        },
    },
    '1-2': {
        updated: null, checked: '2026/10/21', goal: ['E'],
        nodes: {
            '1': [
                go('A', all(exactly(4, 'DD', 'DE'), ships(undefined, 5))),
                // 「それ以外はランダム（(駆逐+海防)5隻もランダム）」：Aマスへの割合は艦数で変わる
                random(['A', 'B'], ships(6, 6), pc('A', 40)),
                random(['A', 'B'], ships(5, 5), pc('A', 50)),
                random(['A', 'B'], ships(4, 4), pc('A', 60)),
                random(['A', 'B'], ships(undefined, 3), pc('A', 70)),
            ],
            A: [
                go('E', fastAtLeast),
                go('D', atMost(3, 'DD', 'DE')),
                go('E', exactly(6, 'DD', 'DE')),
                go('E', all(exactly(1, 'CL', 'CT'), exactly(5, 'DD', 'DE'))),
                go('E', all(exactly(1, 'CL'), atLeast(4, 'DD'))),
                random(['D', 'E'], undefined, pc('E', 65)),
            ],
        },
    },
    '1-3': {
        updated: '2020/02/28', checked: '2026/10/21', goal: ['J'],
        nodes: {
            '1': [
                go('A', has('AO')),
                go('A', has('AV')),
                go('C', has('CVclass')),
                random(['A', 'C']),
            ],
            A: [
                go('D', has('AO')),
                go('D', atLeast(4, 'DE')),
                random(['D', 'E'], has('AV'), pc('D', 80)),
                random(['D', 'E'], atLeast(4, 'DD', 'DE'), pc('D', 80)),
                go('E', has('SS')),
                random(['D', 'E']),
            ],
            F: [
                go('H', has('CV')),
                go('H', has('SBB')),
                go('J', all(has('CAV'), atLeast(2, 'DD'))),
                go('J', atLeast(4, 'DD')),
                go('J', all(has('CL', 'CT'), atLeast(4, 'DD', 'DE'))),
                random(['H', 'J'], fastAtLeast, lean('J')),
                random(['H', 'J'], undefined, lean('H')),
            ],
            H: [
                go('G', has('AO')),
                go('J', has('AV')),
                go('J', has('CAV')),
                go('J', all(has('CL', 'CT'), atLeast(2, 'DD'))),
                // 「駆逐2隻以上でランダム（Iマスへの割合は低め）」：去向は I／J
                random(['I', 'J'], atLeast(2, 'DD'), lean('J')),
                random(['I', 'J'], undefined, lean('I')),
            ],
        },
    },
    '1-4': {
        updated: null, checked: '2026/10/21', goal: ['L'],
        nodes: {
            '1': [random(e14('1'))],
            B: [
                go('D', atLeast(3, 'CVclass')),
                go('D', atLeast(3, 'BBclass')),
                go('D', none('DD', 'DE')),
                go('C', atLeast(3, 'DD', 'DE')),
                random(['C', 'D'], has('CL'), pc('C', 80)),
                random(['C', 'D'], undefined, pc('C', 60)),
            ],
            D: [
                go('E', has('AS')),
                go('G', has('AV')),
                random(['E', 'G']),
            ],
            F: [
                go('E', atLeast(4, 'DD', 'DE')),
                when(atLeast(2, 'DD', 'DE'), [
                    go('E', any(has('AV', 'AS', 'AO'), exactly(2, 'BBV'))),
                    random(['E', 'H'], exactly(3, 'DD', 'DE'), pc('E', 80)),
                    random(['E', 'H'], undefined, pc('E', 60)),
                ]),
                random(['H', 'I']),
            ],
            J: [
                go('L', all(has('CL'), has('AV'), atLeast(2, 'DD', 'DE'))),
                go('L', atLeast(4, 'DD')),
                random(['K', 'L'], atLeast(2, 'DD'), pc('L', 75)),
                random(['K', 'L'], undefined, pc('L', 65)),
            ],
        },
    },
};
