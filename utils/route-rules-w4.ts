// 西方海域 4-1～4-4 の分岐ルール（4-5 は EO：route-rules-eo.ts）。
// 転記の約束は route-rules-data.ts の檔頭を参照。
import {
    all, any, atLeast, atMost, exactly, fastAtLeast, go, has, lean, none, pc, random, slow, unknown, when,
} from './route-rules-dsl';
import type { MapRules } from './route-predict';

export const W4_RULES: Record<string, MapRules> = {
    '4-1': {
        updated: '2020/10/03', checked: '2026/10/21', goal: ['J'],
        nodes: {
            '1': [random(['A', 'C'])],
            C: [
                go('E', atLeast(5, 'BBclass', 'CVclass')),
                random(['E', 'F'], exactly(4, 'BBclass', 'CVclass'), pc('E', 70)),
                random(['E', 'F'], exactly(3, 'BBclass', 'CVclass')),
                go('F', atMost(2, 'BBclass', 'CVclass')),
            ],
            D: [
                go('H', atLeast(5, 'BBclass', 'CVclass')),
                random(['G', 'H'], has('SS'), pc('H', 70), true),
                go('G', exactly(4, 'BBclass', 'CVclass')),
                go('G', atMost(1, 'DD', 'DE')),
                go('H', none('BBclass', 'CVclass')),
                go('H', atLeast(4, 'DD', 'DE')),
                go('G', exactly(3, 'DD', 'DE')),
                go('G', none('CL')),
                go('H', all(has('CAclass'), exactly(3, 'CAclass', 'CL', 'CT'))),
                random(['G', 'H']),
            ],
            F: [
                go('D', has('BBclass', 'CVclass')),
                go('D', atMost(3, 'DD', 'DE')),
                go('H', has('CL', 'CT')),
                go('H', none('CAclass')),
                go('D'),
            ],
            H: [
                // 「潜水艦を含むとランダム（1隻でランダム、2隻以上でI？）」
                when(has('SS'), [
                    random(['I', 'J'], exactly(1, 'SS')),
                    go('I', undefined, true),
                ]),
                go('I', atLeast(5, 'BBclass', 'CVclass')),
                go('J', atMost(1, 'BBclass', 'CVclass')),
                random(['I', 'J']),
            ],
        },
    },
    '4-2': {
        updated: '2020/03/18', checked: '2026/10/21', goal: ['L'],
        nodes: {
            '1': [
                // wiki：(駆逐+海防)が多いほどAマス寄り（2隻以上。1隻以下だとB寄り）。空母系の隻数も関係？
                random(['A', 'B'], atLeast(2, 'DD', 'DE'), lean('A')),
                random(['A', 'B'], undefined, lean('B')),
            ],
            A: [
                go('E', atMost(1, 'DD', 'DE')),
                random(['C', 'E'], has('SS')),
                go('C', atLeast(4, 'DD', 'DE')),
                go('C', all(has('CL'), atLeast(3, 'DD', 'DE'))),
                random(['C', 'E'], exactly(3, 'DD', 'DE'), pc('C', 85)),
                random(['C', 'E'], all(has('CL'), exactly(2, 'DD', 'DE')), pc('C', 85)),
                random(['C', 'E'], undefined, pc('C', 55), true),
            ],
            C: [
                go('G', atMost(1, 'DD', 'DE')),
                go('G', atLeast(4, 'BBclass', 'CVclass')),
                when(exactly(3, 'BBclass', 'CVclass'), [
                    random(['G', 'L'], none('CL'), pc('G', 85), true),
                    random(['G', 'L'], undefined, pc('G', 65), true),
                ]),
                go('L', has('CL')),
                go('L', atLeast(4, 'DD', 'DE')),
                random(['G', 'L'], undefined, pc('G', 65), true),
            ],
            D: [
                go('H', exactly(6, 'BBclass', 'CVclass')),
                when(atMost(2, 'BBclass', 'CVclass'), [
                    go('C', atLeast(2, 'DD', 'DE')),
                    random(['C', 'H'], undefined, pc('H', 60)),
                ]),
                random(['C', 'H'], atMost(1, 'DD', 'DE'), pc('H', 85)),
                random(['C', 'H'], exactly(4, 'BBclass'), pc('H', 70)),
                random(['C', 'H']),
            ],
            G: [
                go('L', atLeast(3, 'DD', 'DE')),
                when(exactly(2, 'DD', 'DE'), [
                    go('L', has('CL', 'CAV', 'AV')),
                    go('L', exactly(4, 'BBclass')),
                    random(['F', 'L'], undefined, pc('L', 65)),
                ]),
                random(['F', 'L'], has('SS'), lean('F')),
                random(['F', 'I', 'L'], atLeast(5, 'BBclass', 'CVclass'), lean('I')),
                random(['F', 'L'], atMost(1, 'BBclass', 'CVclass'), pc('L', 85), true),
                random(['F', 'L'], undefined, lean('L'), true),
            ],
            H: [
                go('G', atLeast(2, 'DD')),
                random(['G', 'K'], atLeast(2, 'DD', 'DE'), pc('G', 80), true),
                random(['G', 'K'], atLeast(5, 'BBclass', 'CVclass'), pc('K', 80), true),
                random(['G', 'K'], undefined, undefined, true),
            ],
        },
    },
    '4-3': {
        updated: '2020/06/23', checked: '2026/10/21', goal: ['N'],
        nodes: {
            '1': [
                go('C', has('CV')),
                when(atLeast(4, 'DD', 'DE'), [
                    go('D', fastAtLeast),
                    go('D', none('BBclass', 'CVL')),
                ]),
                go('D', all(atLeast(3, 'DD', 'DE'), has('CL'))),
                go('A', all(atLeast(2, 'DD', 'DE'), has('CL', 'AO'))),
                random(['A', 'C']),
            ],
            A: [
                go('B', has('AV', 'AO', 'BBV')),
                go('D', all(atLeast(2, 'CA'), atLeast(2, 'DD', 'DE'))),
                go('B', has('CVL')),
                random(['B', 'D']),
            ],
            B: [
                go('E', atMost(1, 'DD', 'DE')),
                go('E', atLeast(3, 'BBclass', 'CVL')),
                go('G', fastAtLeast),
                random(['E', 'G'], undefined, pc('E', 65)),
            ],
            C: [
                go('F', atLeast(4, 'BBclass', 'CVclass')),
                go('D', all(none('SS'), exactly(1, 'CL'), atLeast(2, 'DD', 'DE'))),
                random(['D', 'F'], undefined, pc('F', 80), true),
            ],
            F: [
                go('K', has('SS')),
                go('K', none('DD')),
                go('K', none('CVclass')),
                go('H', all(fastAtLeast, atMost(2, 'BBclass', 'CVclass'), atLeast(2, 'DD'))),
                random(['H', 'K'], undefined, lean('K')),
            ],
            G: [
                go('J', none('CVL')),
                random(['H', 'I'], undefined, pc('H', 65)),
            ],
            H: [
                random(['I', 'N'], exactly(2, 'CVclass'), pc('N', 90)),
                random(['I', 'N'], all(none('CVclass'), exactly(2, 'CA')), pc('N', 75), true),
                random(['I', 'N'], undefined, pc('N', 70)),
            ],
            K: [
                go('L', has('SS')),
                go('L', any(atLeast(3, 'CVclass'), none('CVclass'))),
                go('L', atMost(1, 'DD', 'DE')),
                random(['L', 'N'], all(exactly(1, 'CV'), has('AV', 'CVL')), pc('L', 55), true),
                random(['L', 'N'], exactly(2, 'CVclass'), pc('L', 65), true),
                random(['L', 'N'], exactly(1, 'CVclass'), pc('L', 80), true),
                random(['L', 'N'], undefined, lean('L')),
            ],
            L: [
                go('M', none('CL', 'DD', 'DE')),
                go('M', atLeast(5, 'BBclass', 'CVclass')),
                go('M', none('CVclass')),
                go('M', exactly(3, 'CV'), true),
                go('N', atLeast(2, 'CA')),
                random(['M', 'N'], has('SS')),
                go('N', atMost(2, 'BBclass', 'CVclass')),
                random(['M', 'N']),
            ],
        },
    },
    '4-4': {
        updated: null, checked: '2026/10/21', goal: ['K'],
        nodes: {
            '1': [
                go('A', atLeast(2, 'DD', 'DE')),
                random(['A', 'B']),
            ],
            B: [
                go('A', atLeast(4, 'BBclass', 'CVclass')),
                random(['D', 'F'], has('CAclass'), lean('D')),
                go('D', undefined, true),
            ],
            E: [
                go('G', atLeast(4, 'BBclass', 'CV')),
                go('I', all(has('CAclass', 'CL'), atLeast(2, 'DD', 'DE'))),
                go('C', atLeast(3, 'DE')),
                go('C', all(atLeast(2, 'DE'), has('AO', 'AS'))),
                when(atLeast(2, 'DD', 'DE'), [
                    random(['G', 'I'], atLeast(4, 'BBclass', 'CVclass'), pc('G', 80), true),
                    random(['G', 'I'], atMost(3, 'BBclass', 'CVclass'), pc('I', 65), true),
                ]),
                go('G', atLeast(4, 'SS'), true),
                random(['G', 'I']),
            ],
            F: [
                go('H', atLeast(3, 'BBclass', 'CVclass'), true),
                go('I', undefined, true),
            ],
            // wiki：C:I:J＝25?%:50?%:25?%
            G: [random(['C', 'I', 'J'], undefined, undefined, true)],
            I: [
                when(atLeast(2, 'DD', 'DE'), [
                    go('K', exactly(2, 'CV')),
                    go('K', exactly(2, 'CAclass')),
                    go('K', all(none('CV'), has('CL'))),
                    random(['H', 'K'], undefined, pc('K', 75)),
                ]),
                random(['H', 'K'], undefined, undefined, true),
            ],
        },
    },
};
