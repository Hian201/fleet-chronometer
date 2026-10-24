// 中部海域 6-1～6-4 の分岐ルール（6-5 は EO：route-rules-eo.ts）。
// 転記の約束は route-rules-data.ts の檔頭を参照。索敵の分岐点係数は 6-1 G／H＝4、6-2 E／H／I＝3、6-3 H＝3。
import {
    all, any, atLeast, atMost, exactly, fastAtLeast, fastExact, flagship, go, has, hasShip, los, none, not, only,
    pc, random, slow, unknown, when,
} from './route-rules-dsl';
import type { MapRules } from './route-predict';

export const W6_RULES: Record<string, MapRules> = {
    '6-1': {
        updated: '2019/10/16', checked: '2026/10/21', goal: ['K'],
        nodes: {
            '1': [
                go('B', any(atLeast(3, 'BBclass', 'CVclass', 'CAclass'), atLeast(2, 'BBclass'))),
                go('A', all(atLeast(3, 'SS'), only('SS'))),
                go('A', all(exactly(1, 'AS'), atLeast(3, 'SS'), only('SS', 'AS'))),
                go('A', all(exactly(1, 'AS'), exactly(3, 'SS'), exactly(2, 'DD'))),
                go('A', all(exactly(1, 'AS'), exactly(4, 'SS'), exactly(1, 'CL', 'DD'))),
                go('B', none('CL', 'DD')),
                go('C'),
            ],
            A: [
                go('F', has('AS')),
                go('D'),
            ],
            G: [
                go('I', atMost(2, 'SS')),
                go('I', exactly(2, 'BBclass', 'CVclass', 'CAclass')),
                go('I', los(4, undefined, 12)),
                go('H', all(has('AS'), los(4, 16))),
                random(['H', 'I'], all(none('AS'), los(4, 16)), pc('H', 85)),
                random(['H', 'I']),
            ],
            H: [
                go('E', los(4, undefined, 20)),
                when(has('AS'), [
                    random(['E', 'K'], los(4, 20, 25)),
                    go('K', los(4, 25)),
                ]),
                random(['E', 'J', 'K'], los(4, 20, 25)),
                random(['J', 'K'], los(4, 25, 36)),
                go('K', los(4, 36)),
            ],
        },
    },
    '6-2': {
        updated: '2019/10/16', checked: '2026/10/21', goal: ['K'],
        nodes: {
            '1': [
                go('B', atLeast(4, 'CL', 'DD')),
                when(all(atMost(1, 'BBV', 'CAV', 'AV', 'LHA'), atMost(4, 'SS')), [
                    go('B', atLeast(5, 'BBclass', 'CVclass')),
                    random(['B', 'C'], atLeast(4, 'BBclass', 'CVclass'), pc('B', 65)),
                ]),
                go('C'),
            ],
            B: [
                go('D', atLeast(5, 'CL', 'DD')),
                random(['C', 'D'], all(atMost(2, 'CVclass'), none('BBclass')), pc('C', 70)),
                go('C'),
            ],
            C: [
                go('A', exactly(6, 'SS')),
                go('A', atLeast(5, 'BBclass', 'CVclass')),
                go('A', exactly(6, 'BBclass', 'CVclass', 'CAclass')),
                go('A', exactly(6, 'BBclass', 'CVclass', 'SS')),
                go('E', atMost(2, 'BBclass', 'CVclass')),
                go('D'),
            ],
            D: [
                go('F', atMost(2, 'DD')),
                go('F', has('BBclass', 'CVclass')),
                go('F', atMost(4, 'CL', 'DD')),
                go('H'),
            ],
            E: [
                go('F', any(atLeast(2, 'BBclass'), atLeast(2, 'CVclass'), atMost(1, 'DD'))),
                go('I', los(3, undefined, 43)),
                random(['I', 'J'], los(3, 43, 50)),
                go('J', los(3, 50)),
            ],
            // 「索敵不足でG」の下限値は wiki が「?」：32 以上は K、未満は G か K（不可考）
            H: [
                go('K', los(3, 32)),
                unknown(['G', 'K']),
            ],
            I: [
                go('G', atLeast(4, 'SS')),
                go('G', los(3, undefined, 35), true),
                random(['G', 'K'], los(3, 35, 40), undefined, true),
                go('K', los(3, 40)),
            ],
        },
    },
    '6-3': {
        updated: '2019/10/12', checked: '2026/10/21', goal: ['J'],
        nodes: {
            A: [{ choice: ['B', 'C'] }],
            E: [
                when(atMost(1, 'AV'), [
                    go('G', all(atMost(1, 'CL'), atLeast(3, 'DD'))),
                    random(['F', 'G'], atMost(2, 'CL'), pc('F', 60)),
                ]),
                go('F'),
            ],
            H: [
                go('I', los(3, undefined, 36)),
                random(['I', 'J'], los(3, 36, 38)),
                go('J', los(3, 38)),
            ],
        },
    },
    '6-4': {
        updated: '2019/10/16', checked: '2026/10/21', goal: ['N'],
        nodes: {
            '': [
                go('M', any(
                    has('LHA'),
                    has('CVclass'),
                    // 戦艦級 2 隻（長門改二と陸奥改二のペアを除く）
                    all(atLeast(2, 'BBclass'), not(all(hasShip('nagatoKai2'), hasShip('mutsuKai2')))),
                    atLeast(3, 'CAV'),
                )),
                go('B', all(fastExact, any(all(flagship('CL'), exactly(3, 'DD')), atLeast(4, 'DD')))),
                go('A', atLeast(2, 'DD')),
                go('M'),
            ],
            A: [
                go('D', all(hasShip('akitsushima'), any(exactly(1, 'CAV'), has('CL'), atLeast(3, 'DD')))),
                go('E', has('BBclass')),
                go('E', slow),
                go('D', flagship('CL')),
                go('D', atLeast(3, 'DD')),
                go('E'),
            ],
            E: [
                go('D', any(hasShip('akitsushima'), hasShip('kisaragi'))),
                go('D', all(atMost(1, 'CAclass'), has('CL'), fastExact)),
                go('G'),
            ],
            J: [
                go('L', none('CL')),
                go('L', atMost(1, 'DD')),
                go('N', has('LHA')),
                go('L', all(exactly(2, 'CVclass'), slow)),
                go('L', all(exactly(2, 'CVclass'), has('BBclass'))),
                go('I'),
            ],
            K: [
                go('H', exactly(2, 'BBclass')),
                go('H', atLeast(3, 'BBclass', 'CAclass')),
                go('J', atLeast(2, 'DD')),
                go('H'),
            ],
        },
    },
};
