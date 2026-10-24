// 南西諸島海域 2-1～2-4 の分岐ルール（2-5 は EO：route-rules-eo.ts）。
// 転記の約束は route-rules-data.ts の檔頭を参照。
import {
    all, atLeast, atMost, any, exactly, fastAtLeast, go, has, lean, none, only, pc, random, ships, when,
} from './route-rules-dsl';
import type { MapRules } from './route-predict';

export const W2_RULES: Record<string, MapRules> = {
    '2-1': {
        updated: null, checked: '2026/10/21', goal: ['H'],
        nodes: {
            C: [
                go('B', atLeast(3, 'CVclass')),
                go('B', atLeast(2, 'BBV')),
                go('B', all(has('AO'), none('SS'))),
                when(has('BBV'), [
                    random(['B', 'E'], has('AV', 'AS'), pc('B', 70)),
                    random(['B', 'D'], undefined, pc('B', 70)),
                ]),
                go('E', has('AV', 'AS')),
                random(['D', 'E']),
            ],
            E: [
                go('F', atLeast(5, 'BBclass', 'CVclass')),
                when(ships(6, 6), [
                    go('D', has('BBclass', 'CVclass')),
                    go('H', exactly(6, 'DD', 'DE')),
                    go('H', all(exactly(1, 'CL'), exactly(5, 'DD', 'DE'))),
                    go('H', all(fastAtLeast, exactly(1, 'CL'), exactly(4, 'DD'))),
                    go('D'),
                ]),
                when(ships(undefined, 5), [
                    go('H', exactly(5, 'DD', 'DE')),
                    go('H', all(exactly(1, 'CL'), exactly(4, 'DD', 'DE'))),
                    go('H', all(fastAtLeast, exactly(1, 'CL'), exactly(3, 'DD'))),
                    random(['D', 'F'], undefined, pc('D', 60)),
                ]),
            ],
            F: [
                go('G', atLeast(5, 'BBclass', 'CVclass')),
                go('H', atLeast(3, 'DD')),
                go('H', all(has('CL'), atLeast(2, 'DD'))),
                random(['G', 'H'], undefined, pc('H', 60)),
            ],
        },
    },
    '2-2': {
        updated: '2026/05/15', checked: '2026/10/21', goal: ['K'],
        nodes: {
            C: [
                go('B', atLeast(3, 'CVclass')),
                go('B', atLeast(2, 'BBV')),
                go('B', all(has('AO'), none('SS'))),
                when(has('BBV'), [
                    random(['B', 'E'], has('AV', 'AS'), pc('B', 70)),
                    // wiki：Bマス70%・Dマス10%・Eマス20%
                    random(['B', 'D', 'E'], all(exactly(1, 'CL', 'CT'), exactly(4, 'DD', 'DE')), pc('B', 70)),
                    random(['B', 'D'], undefined, pc('B', 70)),
                ]),
                go('E', has('AV', 'AS')),
                random(['D', 'E'], all(has('CL', 'CT'), atLeast(4, 'DD', 'DE')), pc('E', 90)),
                random(['D', 'E']),
            ],
            E: [
                go('G', atLeast(4, 'BBclass', 'CVclass')),
                go('F', atLeast(2, 'DE')),
                random(['G', 'K'], exactly(3, 'BBclass', 'CVclass'), pc('G', 70)),
                random(['G', 'K'], exactly(2, 'BBclass', 'CVclass')),
                random(['G', 'K'], exactly(1, 'BBclass', 'CVclass'), pc('K', 70)),
                go('F', all(atLeast(3, 'DD', 'DE'), has('AS'))),
                when(atLeast(2, 'DD', 'DE'), [
                    go('K', all(has('CL'), fastAtLeast)),
                    random(['F', 'K'], undefined, pc('K', 70)),
                ]),
                random(['G', 'K']),
            ],
            G: [
                go('H', has('CVclass')),
                go('H', none('DD')),
                random(['H', 'K']),
            ],
            H: [
                random(['I', 'K'], atLeast(4, 'BBclass', 'CVclass'), lean('I')),
                go('K', has('CVclass', 'CAV', 'AV')),
                random(['I', 'K'], has('SS'), lean('I')),
                random(['J', 'K'], atLeast(2, 'DD', 'DE')),
                random(['I', 'J', 'K'], exactly(1, 'DD', 'DE')),
                random(['I', 'K']),
            ],
        },
    },
    '2-3': {
        updated: '2022/10/30', checked: '2026/10/21', goal: ['N'],
        nodes: {
            '1': [
                go('C', only('SS', 'AS')),
                random(['A', 'B']),
            ],
            C: [random(['D', 'F'], undefined, pc('D', 60))],
            D: [
                go('G', all(has('AV', 'AO'), atLeast(2, 'DD', 'DE'))),
                go('G', all(atLeast(2, 'SS'), has('AS'))),
                random(['F', 'G'], only('SS'), pc('G', 65)),
                random(['F', 'G'], all(has('SS'), has('BBclass', 'CVclass')), pc('F', 65), true),
                // 「(駆逐+海防)が多いほどGマス寄り」
                random(['F', 'G'], undefined, lean('G')),
            ],
            F: [
                random(['G', 'J'], has('CVclass', 'CL', 'AV'), pc('J', 90)),
                random(['G', 'J'], all(atLeast(2, 'SS'), has('AS')), pc('G', 80), true),
                // wiki：Gマス25%：Hマス35%：Jマス40%
                random(['G', 'H', 'J']),
            ],
            G: [
                random(['I', 'K'], all(atLeast(2, 'SS'), has('AS')), pc('I', 60), true),
                random(['I', 'K'], only('SS'), pc('I', 55)),
                go('K', atMost(1, 'CL', 'DD', 'DE')),
                random(['I', 'K'], all(has('AV', 'AO'), atLeast(2, 'DD', 'DE')), pc('I', 65)),
                random(['I', 'K'], atLeast(3, 'DD', 'DE'), pc('K', 55)),
                random(['I', 'K'], has('DD', 'DE'), pc('K', 65)),
                go('K', none('DD', 'DE')),
            ],
            J: [
                go('N', all(has('CL'), atLeast(4, 'DD'))),
                // 「軽巡1隻 かつ 重巡5隻でN（航巡は不可）」
                go('N', all(exactly(1, 'CL'), exactly(5, 'CA'))),
                random(['M', 'N'], only('SS'), pc('N', 90)),
                random(['L', 'M', 'N'], has('SS'), pc('M', 10)),
                go('L', exactly(6, 'BBclass', 'CVclass')),
                random(['L', 'N'], exactly(5, 'BBclass', 'CVclass'), pc('L', 85)),
                random(['L', 'N'], exactly(4, 'BBclass', 'CVclass'), pc('N', 75)),
                random(['L', 'N'], exactly(3, 'BBclass', 'CVclass'), pc('N', 80)),
                random(['L', 'N'], atMost(2, 'BBclass', 'CVclass'), pc('N', 90)),
            ],
        },
    },
    '2-4': {
        // 2-4／2-5 は同じ虚構海域（2-5 は 2-4 の東側）
        updated: null, checked: '2026/10/21', goal: ['P'],
        nodes: {
            B: [
                go('G', exactly(6, 'DD'), true),
                // 「(軽巡+練巡)1隻 かつ 駆逐4隻 に加えて (重巡級+駆逐+海防?)1隻」＝6隻編成
                go('G', all(ships(6, 6), exactly(1, 'CL', 'CT'), atLeast(4, 'DD'), exactly(5, 'CAclass', 'DD', 'DE')), true),
                when(atMost(2, 'DD', 'DE'), [
                    go('C', atLeast(3, 'CVclass')),
                    go('C', atLeast(3, 'BBclass', 'CV')),
                    random(['C', 'G'], exactly(2, 'BBclass', 'CV'), pc('C', 80)),
                    random(['C', 'G'], has('CV'), pc('C', 60)),
                    random(['C', 'G'], has('SS'), lean('C')),
                ]),
                random(['C', 'G'], undefined, lean('G')),
            ],
            C: [
                go('G', has('AS', 'AO')),
                random(['F', 'G']),
            ],
            F: [
                // 範囲表記（90～95％など）は下限値を採り推定扱い
                random(['A', 'J'], all(has('CVL'), atLeast(2, 'DD', 'DE')), pc('J', 90), true),
                random(['A', 'J'], has('CVL'), pc('J', 80), true),
                random(['A', 'J'], atLeast(2, 'DD'), pc('J', 75)),
                go('A', atMost(1, 'DD')),
            ],
            H: [
                // 「(軽巡+練巡)1隻 かつ 駆逐4隻 に加えて (重巡級+軽巡+練巡+駆逐)1隻」＝6隻編成
                go('L', all(ships(6, 6), atLeast(1, 'CL', 'CT'), atLeast(4, 'DD'), exactly(6, 'CAclass', 'CL', 'CT', 'DD'))),
                go('I'),
            ],
            I: [
                random(['E', 'K'], all(has('CVL'), has('CL')), pc('K', 90), true),
                random(['E', 'K'], has('CVL'), pc('K', 80), true),
                random(['E', 'K'], has('CL'), pc('K', 75), true),
                random(['E', 'K'], undefined, lean('E')),
            ],
            J: [
                go('L', atLeast(4, 'BBclass', 'CVclass')),
                go('M', exactly(3, 'BBclass', 'CVclass')),
                go('M', exactly(2, 'CV')),
                go('L', none('CV')),
                random(['L', 'M'], undefined, pc('M', 65)),
            ],
            K: [
                go('N', atLeast(2, 'AS', 'AO')),
                when(has('AV', 'AS', 'AO'), [
                    random(['L', 'N'], atLeast(2, 'DD', 'DE'), lean('L')),
                    // 以下 2 行は wiki が「?」付きで割合を記載（L35～40％:N35～40％:O20～25％ ほか）
                    random(['L', 'N', 'O'], exactly(1, 'DD', 'DE'), undefined, true),
                    random(['L', 'N', 'O'], none('DD', 'DE'), undefined, true),
                ]),
                random(['L', 'N'], atLeast(2, 'DE'), lean('L')),
                go('L', atLeast(2, 'DD', 'DE')),
                random(['L', 'O'], exactly(1, 'DD', 'DE'), pc('L', 65)),
                // 以降 4 行は wiki が全体に「？」を付けた推定規則
                when(has('CAV'), [
                    random(['L', 'O'], has('BB'), lean('O'), true),
                    random(['L', 'O'], undefined, lean('L'), true),
                ], true),
                random(['L', 'O'], atLeast(2, 'BBclass'), pc('O', 70), true),
                random(['L', 'O'], undefined, pc('O', 65), true),
            ],
            L: [
                go('M', exactly(4, 'BBclass', 'CVclass')),
                go('P', all(has('CL'), atLeast(2, 'DD'))),
                go('P', atMost(2, 'BBclass', 'CV')),
                random(['M', 'P'], undefined, pc('M', 60), true),
            ],
        },
    },
};
