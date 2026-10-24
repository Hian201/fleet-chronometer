// 南方海域 5-1～5-4 の分岐ルール（5-5／5-6 は EO：route-rules-eo.ts）。
// 転記の約束は route-rules-data.ts の檔頭を参照。
// 5-2 の「他N隻が〜」は、指定艦（祥鳳・夕張）を除いた残りの艦種構成なので、指定艦自身が数えられない
// 艦種（祥鳳＝軽空母、夕張＝軽巡）の計数はそのまま使える。
import {
    all, any, atLeast, atMost, carriers, carriersSum, exactly, fastAtLeast, fastPlusAtLeast, fastest, go, has, hasShip,
    lean, los, noShip, none, pc, random, slow, unknown, when,
} from './route-rules-dsl';
import type { MapRules } from './route-predict';

export const W5_RULES: Record<string, MapRules> = {
    '5-1': {
        updated: '2020/03/18', checked: '2026/10/21', goal: ['J'],
        nodes: {
            '1': [
                go('A', atLeast(5, 'BBclass', 'CVclass')),
                go('B', all(atMost(2, 'BBclass', 'CVclass'), atLeast(2, 'DD'))),
                go('B', all(atLeast(4, 'CAclass'), has('CL'))),
                go('B', all(atLeast(2, 'CAclass'), exactly(1, 'CL'))),
                random(['A', 'B'], all(exactly(3, 'BBclass'), exactly(1, 'CL'), exactly(2, 'DD')), pc('B', 75)),
                random(['A', 'B']),
            ],
            B: [
                go('E', has('CV')),
                go('E', atLeast(2, 'CVL')),
                go('C', atMost(2, 'BBclass')),
                go('E', exactly(1, 'CL')),
                go('C', atLeast(2, 'DD')),
                random(['C', 'E'], undefined, undefined, true),
            ],
            F: [
                go('H', none('CL', 'DD')),
                go('H', atLeast(4, 'BBclass', 'CVL')),
                random(['G', 'H', 'J'], exactly(3, 'BBclass', 'CVL')),
                go('J', fastest),
                when(has('CL'), [
                    go('J', atLeast(2, 'DD')),
                    go('G'),
                ]),
                go('J', atLeast(4, 'DD')),
                random(['G', 'J'], exactly(3, 'DD'), lean('J')),
                random(['G', 'J'], exactly(2, 'DD'), lean('G')),
                go('G', exactly(1, 'DD')),
            ],
            G: [
                go('I', atLeast(5, 'BBclass', 'CVclass')),
                random(['I', 'J'], all(has('CVclass'), atLeast(3, 'BBclass', 'CVclass'))),
                random(['I', 'J'], has('SS')),
                go('J', fastPlusAtLeast),
                when(atLeast(4, 'CAclass'), [
                    go('J', none('BBclass', 'CVclass', 'CLT'), true),
                    random(['I', 'J'], undefined, lean('J')),
                ]),
                random(['I', 'J'], has('CV'), lean('I')),
                go('J', atLeast(4, 'DD')),
                go('J', all(atLeast(2, 'CAclass'), atLeast(2, 'DD'))),
                go('J', all(has('CL'), atLeast(2, 'DD'))),
                random(['I', 'J'], all(exactly(3, 'BBclass'), exactly(1, 'CL'), atLeast(2, 'CAclass')), pc('J', 85)),
                random(['I', 'J'], undefined, lean('I')),
            ],
        },
    },
    '5-2': {
        updated: '2026/01/28', checked: '2026/10/21', goal: ['O'],
        nodes: {
            '1': [
                random(['A', 'B'], atLeast(5, 'BBclass', 'CVclass')),
                random(['A', 'B'], atLeast(4, 'BBclass')),
                random(['A', 'B'], atLeast(3, 'CV')),
                random(['A', 'B'], has('SS')),
                go('B'),
            ],
            C: [
                go('D', all(exactly(2, 'CVclass'), exactly(2, 'CAclass'), exactly(2, 'DD'))),
                go('D', all(hasShip('yuubari'), exactly(5, 'CVL', 'CAclass', 'DD', 'AO'))),
                go('D', all(hasShip('shouhou'), exactly(5, 'CAclass', 'CL', 'CT', 'DD', 'AO'))),
                go('E', slow),
                go('D', all(hasShip('shoukaku'), hasShip('zuikaku'), atLeast(2, 'DD'))),
                go('E', atLeast(1, 'BBclass', 'CV')),
                go('D', all(exactly(2, 'CVL'), atLeast(2, 'DD'))),
                go('D', all(exactly(1, 'CVL'), has('CAclass'), atLeast(2, 'DD'))),
                go('E'),
            ],
            D: [
                when(all(hasShip('shouhou'), hasShip('yuubari')), [
                    // 他 4 隻が「駆逐2 かつ (重巡2 または 補給2)」
                    go('G', all(exactly(2, 'DD'), any(exactly(2, 'CA'), exactly(2, 'AO')))),
                ]),
                when(hasShip('shouhou'), [
                    // 他 5 隻のいずれかの構成
                    go('G', any(
                        all(exactly(3, 'DD'), exactly(1, 'CA'), any(exactly(1, 'CL'), exactly(1, 'AO'))),
                        all(exactly(3, 'DD'), exactly(2, 'AO')),
                    )),
                ]),
                when(hasShip('yuubari'), [
                    go('G', any(
                        exactly(5, 'DD'),
                        all(exactly(4, 'DD'), exactly(1, 'AO')),
                        all(exactly(3, 'DD'), exactly(2, 'AO')),
                        all(exactly(2, 'DD'), exactly(2, 'AO'), exactly(1, 'CA')),
                        all(exactly(2, 'DD'), exactly(1, 'AO'), exactly(2, 'CA')),
                    )),
                ]),
                go('F'),
            ],
            F: [
                go('H', los(2, undefined, 63), true),
                when(los(2, 63, 70), [
                    random(['H', 'I'], atLeast(5, 'BBclass', 'CV')),
                    random(['H', 'I', 'O'], atLeast(3, 'BBclass')),
                    random(['H', 'I', 'O'], atLeast(3, 'CVclass')),
                    random(['H', 'O']),
                ], true),
                go('I', atLeast(5, 'BBclass', 'CV')),
                random(['I', 'O'], atLeast(3, 'BBclass'), lean('I')),
                random(['I', 'O'], atLeast(3, 'CVclass'), lean('I')),
                go('O', los(2, 70)),
            ],
            G: [
                random(['J', 'L'], all(hasShip('shouhou'), hasShip('yuubari')), pc('J', 55), true),
                random(['J', 'L'], undefined, pc('J', 85), true),
            ],
            L: [
                when(all(noShip('shouhou'), noShip('yuubari')), [
                    random(['K', 'N'], fastPlusAtLeast),
                    random(['M', 'N'], los(2, undefined, 60)),
                    random(['K', 'M', 'N'], los(2, 60, 62)),
                    random(['K', 'N'], los(2, 62)),
                ]),
                go('K', fastPlusAtLeast),
                go('M', los(2, undefined, 60)),
                random(['K', 'M'], los(2, 60, 62)),
                go('K', los(2, 62)),
            ],
        },
    },
    '5-3': {
        updated: '2023/02/11', checked: '2026/10/21', goal: ['Q'],
        nodes: {
            '1': [
                go('D', fastPlusAtLeast),
                go('C', atLeast(3, 'BBclass', 'CVclass')),
                go('C', all(exactly(2, 'BBclass', 'CVclass'), slow)),
                random(['C', 'D'], has('SS'), pc('D', 60)),
                go('D'),
            ],
            B: [random(['A', 'F'], undefined, pc('A', 65), true)],
            E: [
                random(['B', 'Q'], has('SS')),
                random(['B', 'Q'], all(has('BBclass', 'CVclass'), atMost(1, 'DD')), undefined, true),
                go('Q', has('CL')),
                go('Q', atLeast(4, 'CAclass')),
                go('Q', atLeast(4, 'DD')),
                random(['B', 'Q']),
            ],
            G: [
                go('J', has('BBV', 'CV', 'SS')),
                go('I', none('DD')),
                go('I', atLeast(2, 'CVL')),
                go('J', exactly(1, 'CVL')),
                go('I', exactly(1, 'DD')),
                go('J', atLeast(2, 'SBB')),
                go('I'),
            ],
            I: [
                go('J', has('CVL')),
                go('J', atLeast(3, 'BBclass')),
                go('O', atLeast(3, 'DD')),
                go('O', all(has('CL'), atLeast(2, 'DD'))),
                go('J', atLeast(2, 'BBclass')),
                go('O', atLeast(2, 'DD')),
                go('O', all(has('CL'), atLeast(4, 'CAclass'), exactly(6, 'CAclass', 'CL', 'DD'))),
                random(['J', 'O']),
            ],
            J: [
                random(['L', 'M', 'N'], has('SS')),
                go('M', atLeast(4, 'BBclass', 'CVclass')),
                go('M', has('CV')),
                go('M', atLeast(2, 'CVL')),
                when(exactly(1, 'CVL'), [
                    go('N', atLeast(2, 'SBB')),
                    random(['L', 'N'], has('BBV')),
                    go('L', atLeast(3, 'DD')),
                    go('L', all(has('CL'), atLeast(2, 'DD'))),
                    go('L', all(exactly(3, 'CAclass'), exactly(2, 'DD')), true),
                ]),
                random(['L', 'N'], undefined, undefined, true),
            ],
            O: [{ choice: ['K', 'P'] }],
            K: [
                go('H', atLeast(4, 'DD')),
                go('H', all(exactly(3, 'DD'), exactly(1, 'CL'))),
                when(exactly(2, 'DD'), [
                    go('H', any(
                        fastPlusAtLeast, has('BBV'), has('AO'), has('AS'),
                        carriers('drum', 2), carriers('daihatsu', 2),
                    )),
                ]),
                go('E'),
            ],
        },
    },
    '5-4': {
        updated: '2020/06/08', checked: '2026/10/21', goal: ['P'],
        nodes: {
            '1': [
                go('B', has('CVclass')),
                go('A', atLeast(3, 'BBclass')),
                go('A', atLeast(5, 'CAclass')),
                // 「ドラム缶搭載艦と大発動艇系搭載艦の合計（1隻に両方なら2隻分）が5隻以上」
                go('B', carriersSum(['drum', 'daihatsu'], 5)),
                go('B', atLeast(4, 'DD')),
                go('B', all(exactly(1, 'CL'), atLeast(3, 'DD'))),
                go('A'),
            ],
            A: [
                go('D', has('SS')),
                go('D', atLeast(5, 'BBclass')),
                go('D', atLeast(2, 'DD')),
                go('D', atLeast(3, 'CAclass')),
                go('F'),
            ],
            B: [
                go('C', has('CVclass', 'SS')),
                when(has('BBclass'), [go('D', slow)]),
                go('D', atLeast(2, 'BBV', 'SBB')),
                go('E', fastPlusAtLeast),
                go('E', all(exactly(1, 'CL'), atLeast(3, 'DD'))),
                go('E', atLeast(4, 'DD')),
                go('D', none('DD')),
                random(['D', 'E']),
            ],
            D: [
                go('F', has('SS')),
                go('F', atLeast(2, 'SBB')),
                go('F', atLeast(3, 'BBclass')),
                go('E', atLeast(2, 'DD')),
                go('F'),
            ],
            G: [
                go('K', has('SS'), true),
                go('K', atLeast(4, 'BBclass'), true),
                go('L', atMost(2, 'CV')),
                random(['K', 'L'], undefined, pc('K', 70)),
            ],
            L: [
                go('P', fastPlusAtLeast),
                go('N', los(2, undefined, 56), true),
                random(['N', 'P'], any(los(2, 56, 60), atLeast(5, 'BBclass', 'CV')), undefined, true),
                go('P', los(2, 60), true),
            ],
            M: [
                go('P', fastPlusAtLeast),
                go('O', los(2, undefined, 41), true),
                random(['O', 'P'], los(2, 41, 45), undefined, true),
                go('P', los(2, 45)),
            ],
        },
    },
};
