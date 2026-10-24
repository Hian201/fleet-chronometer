// 北方海域 3-1～3-4 の分岐ルール（3-5 は EO：route-rules-eo.ts）。
// 転記の約束は route-rules-data.ts の檔頭を参照。
import {
    all, any, atLeast, atMost, exactly, fastAtLeast, fastPlusAtLeast, go, has, lean, none, pc, radars, random,
    ships, slow, unknown, when,
} from './route-rules-dsl';
import type { MapRules } from './route-predict';

export const W3_RULES: Record<string, MapRules> = {
    '3-1': {
        updated: '2020/04/13', checked: '2026/10/21', goal: ['G'],
        nodes: {
            C: [
                go('D', atMost(1, 'DD', 'DE')),
                when(atLeast(3, 'BBV', 'CL', 'AV', 'AO'), [
                    random(['B', 'D'], atLeast(3, 'BBclass', 'CVclass')),
                    random(['B', 'F']),
                ]),
                random(['B', 'F'], all(has('AV', 'AO'), atLeast(3, 'DD', 'DE'))),
                random(['D', 'F'], atLeast(3, 'SS')),
                go('D', atLeast(3, 'BBclass', 'CVclass')),
                go('F'),
            ],
            D: [
                go('E', atLeast(5, 'BBclass', 'CVclass')),
                go('E', exactly(6, 'SS')),
                go('G', all(exactly(1, 'AS'), exactly(5, 'SS'))),
                go('F'),
            ],
        },
    },
    '3-2': {
        updated: '2020/03/07', checked: '2026/10/21', goal: ['L'],
        nodes: {
            '1': [
                go('C', has('BBclass', 'CVclass')),
                go('C', all(exactly(1, 'CL'), atLeast(4, 'DD'))),
                go('C', exactly(6, 'DD')),
                go('A'),
            ],
            C: [
                go('A', atMost(3, 'DD')),
                go('A', atLeast(2, 'BBclass', 'CV')),
                random(['A', 'G'], has('SS')),
                go('G', slow),
                // 電探の定義（水上電探のみか全電探か）は wiki 未記載：全電探（小型・大型）として数え、推定扱い
                go('G', radars(undefined, 0), true),
                go('G', atMost(5, 'CL', 'DD', 'AO')),
                go('E', all({ speed: 'fastest', mode: 'atLeast' }, radars(4)), true),
                random(['E', 'G'], fastPlusAtLeast, pc('G', 60)),
                random(['E', 'G'], has('AO'), pc('G', 60)),
                go('G'),
            ],
            E: [
                go('F', fastPlusAtLeast),
                random(['D', 'F'], undefined, pc('F', 80)),
            ],
            G: [
                go('J', has('SS')),
                go('J', has('CV')),
                go('J', exactly(2, 'BBclass', 'CVL')),
                go('H', slow),
                go('H', radars(undefined, 0), true),
                go('H', atMost(5, 'CL', 'DD', 'AO')),
                go('F', fastPlusAtLeast),
                random(['F', 'H'], has('AO'), pc('F', 55)),
                random(['F', 'H'], undefined, pc('H', 65)),
            ],
            H: [
                go('F', exactly(6, 'CL', 'DD', 'AO')),
                go('I'),
            ],
        },
    },
    '3-3': {
        updated: '2020/03/07', checked: '2026/10/21', goal: ['M'],
        nodes: {
            A: [
                go('C', has('CV')),
                go('C', atLeast(4, 'BBclass', 'CVL')),
                go('C', all(exactly(1, 'BBclass', 'CVL'), exactly(1, 'CL'), exactly(4, 'DD'))),
                go('B'),
            ],
            B: [
                random(['D', 'F'], has('SS')),
                go('F', atMost(1, 'BBclass', 'CVL')),
                go('F', all(atMost(2, 'BBclass', 'CVL'), atLeast(2, 'DD'))),
                random(['D', 'F']),
            ],
            C: [
                go('E', atMost(1, 'DD', 'DE')),
                go('E', atLeast(2, 'CV')),
                go('E', atLeast(3, 'BBclass', 'CVclass')),
                go('G', exactly(2, 'BBclass', 'CVclass')),
                go('G', all(exactly(1, 'BBclass', 'CVclass'), exactly(1, 'CL'), exactly(4, 'DD'))),
                go('E'),
            ],
            F: [
                go('G', atMost(1, 'DD')),
                go('G', atLeast(3, 'BBclass')),
                random(['H', 'J'], has('SS')),
                go('J', has('CL')),
                go('J', has('CAV')),
                go('J', has('AV')),
                random(['H', 'J']),
            ],
            G: [
                random(['I', 'M'], has('SS')),
                go('M', atMost(3, 'BBclass', 'CVclass')),
                random(['I', 'M'], exactly(4, 'BBclass', 'CVclass'), undefined, true),
                random(['I', 'M'], exactly(5, 'BBclass', 'CVclass'), pc('I', 65), true),
                random(['I', 'M'], exactly(6, 'BBclass', 'CVclass'), pc('I', 85), true),
            ],
            J: [
                go('M', atLeast(5, 'DD')),
                go('M', all(exactly(1, 'CL'), atLeast(4, 'DD'))),
                go('K'),
            ],
            K: [
                random(['L', 'M'], has('SS'), undefined, true),
                go('M', atMost(1, 'BBclass', 'CVL')),
                random(['L', 'M'], exactly(2, 'BBclass', 'CVL'), pc('M', 75), true),
                random(['L', 'M'], exactly(3, 'BBclass', 'CVL'), undefined, true),
                // wiki は 4 隻以上の場合を記載していない
                unknown(['L', 'M']),
            ],
        },
    },
    '3-4': {
        updated: '2020/05/27', checked: '2026/10/21', goal: ['P'],
        nodes: {
            '1': [
                go('A', none('CL', 'DD', 'DE')),
                go('A', atLeast(3, 'BBclass', 'CVclass')),
                random(['A', 'B'], any(exactly(2, 'BBclass', 'CVclass'), has('SS')), pc('B', 65), true),
                go('B', exactly(1, 'BBclass', 'CVclass')),
                when(none('BBclass', 'CVclass'), [
                    random(['B', 'D'], atMost(2, 'DD'), pc('B', 65), true),
                    go('D'),
                ]),
            ],
            C: [
                go('B', atLeast(3, 'CV')),
                go('B', none('CL', 'DD', 'DE')),
                go('B', atLeast(5, 'BBclass', 'CVclass')),
                go('F', exactly(2, 'BBclass', 'CVclass')),
                go('E', has('AV', 'AO')),
                random(['E', 'F'], has('AS')),
                go('F'),
            ],
            // wiki：F から I へ行く条件は不明（記載なし）なので、I への規則は書かない
            F: [
                go('G', atLeast(5, 'BBclass', 'CVclass', 'CAclass')),
                when(all(atMost(2, 'BBclass', 'CV'), has('CL'), atLeast(2, 'DD', 'DE')), [
                    go('J', fastPlusAtLeast),
                    // wiki：G:J:M＝10%?:45%?:45%?
                    random(['G', 'J', 'M'], undefined, undefined, true),
                ]),
                random(['G', 'M']),
            ],
            H: [
                go('G', any(atMost(2, 'DD'), atMost(3, 'CL', 'DD'), has('CV'), atLeast(2, 'BBclass', 'CVL'))),
                go('L', atLeast(5, 'CL', 'DD')),
                go('G', none('CL')),
                random(['G', 'L'], undefined, pc('L', 65)),
            ],
            L: [
                go('J', exactly(6, 'CAclass', 'CL', 'DD')),
                go('N', none('BBclass', 'CVL')),
                random(['N', 'O']),
            ],
            M: [
                go('P', all(has('CL'), has('DD'))),
                random(['K', 'P']),
            ],
        },
    },
};
