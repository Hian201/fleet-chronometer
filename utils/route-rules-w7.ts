// 南西海域 7-1～7-5 の分岐ルール。
// 転記の約束は route-rules-data.ts の檔頭を参照。
// 7-2（第一／第二ボス）・7-3（戦力ゲージ1／2）・7-5（三つのゲージ）は海域階段で目標点を切り替える。
// 7-3 の A／C／D は階段ごとにルールが違うため、{ phase: 'pAppeared' } で分けて書く。
import {
    all, any, atLeast, atMost, exactly, fastAtLeast, fastExact, fastest, fastPlusAtLeast, fastPlusExact, go, has,
    hasShip, los, noShip, none, only, pc, random, ships, slow, unknown, visited, when, withSets,
} from './route-rules-dsl';
import type { Cond, MapRules, Rule } from './route-predict';

const hk: Cond = all(hasShip('haguro'), hasShip('kamikaze'));
const heavyOnly: Cond = only('CA', 'CL', 'DD', 'DE');
const pAppeared: Cond = { phase: 'pAppeared' };

// ── 7-3：A／C／D の階段別ルール ────────────────────────────────────
const a1: Rule[] = [
    go('C', ships(1, 1)),
    go('B', none('CA')),
    go('B', has('CVclass')),
    go('B', none('DD', 'DE')),
    go('B', ships(5)),
    go('C', hk),
    when(ships(4, 4), [
        go('B', atLeast(2, 'CA')),
        go('B', atMost(1, 'DD', 'DE')),
        go('C', heavyOnly),
        go('B'),
    ]),
    when(ships(undefined, 3), [go('C', heavyOnly), go('B')]),
];
const a2: Rule[] = [
    go('C', ships(1, 1)),
    go('B', has('CVclass')),
    go('C', all(exactly(1, 'AO'), atLeast(3, 'DD', 'DE'))),
    go('B', none('CA')),
    go('B', none('DD', 'DE')),
    go('B', all(has('BBclass'), noShip('haguro'))),
    go('C', hk),
    when(ships(5), [
        go('B', all(noShip('haguro'), slow)),
        go('B', atMost(2, 'DD', 'DE')),
        go('C'),
    ]),
    when(ships(4, 4), [
        go('B', atLeast(2, 'CA')),
        go('B', atMost(1, 'DD', 'DE')),
        go('C', heavyOnly),
        go('B'),
    ]),
    when(ships(undefined, 3), [go('C', heavyOnly), go('B')]),
];
const c1: Rule[] = [
    go('D', has('BBclass', 'CVclass')),
    go('D', none('DD', 'DE')),
    go('D', ships(5)),
    when(hk, [
        go('D', atLeast(3, 'CAclass')),
        go('E', any(hasShip('ashigara'), hasShip('myoukou'))),
        go('D', atMost(1, 'DD', 'DE')),
        go('E'),
    ]),
    when(ships(4, 4), [
        go('E', all(hasShip('haguro'), exactly(3, 'DD', 'DE'))),
        go('E', all(hasShip('kamikaze'), exactly(4, 'DD', 'DE'))),
        go('D'),
    ]),
    when(ships(3, 3), [
        go('D', atLeast(2, 'CAclass')),
        go('D', atMost(1, 'DD', 'DE')),
        go('E', only('CA', 'DD', 'DE')),
        go('D'),
    ]),
    go('E', ships(undefined, 2)),
];
const c2: Rule[] = [
    go('D', has('BBclass', 'CVclass')),
    go('D', none('DD', 'DE')),
    go('I', fastest),
    when(ships(5), [
        go('I', all(fastPlusExact, atLeast(4, 'CL', 'DD'))),
        go('D', ships(6, 6)),
        when(hk, [
            go('D', atMost(1, 'DD', 'DE')),
            go('I', any(has('CL'), hasShip('ashigara'))),
            go('D'),
        ]),
        go('I', all(fastExact, exactly(1, 'CA'), exactly(1, 'CL'), exactly(3, 'DD'))),
        go('D'),
    ]),
    when(ships(4, 4), [
        when(hk, [
            go('D', atLeast(3, 'CAclass')),
            go('E', any(hasShip('ashigara'), hasShip('myoukou'))),
            go('D', atMost(1, 'DD', 'DE')),
            go('E'),
        ]),
        go('E', all(hasShip('haguro'), exactly(3, 'DD', 'DE'))),
        go('E', all(hasShip('kamikaze'), exactly(4, 'DD', 'DE'))),
        go('D'),
    ]),
    when(ships(undefined, 3), [
        go('D', atLeast(2, 'CAclass')),
        go('D', atMost(1, 'DD', 'DE')),
        go('E', only('CA', 'DD', 'DE')),
        go('D'),
    ]),
];
const d1: Rule[] = [
    go('F', has('BBclass', 'CVclass')),
    go('F', ships(6, 6)),
    go('F', atLeast(4, 'CAclass')),
    go('F', atLeast(2, 'CAV')),
    go('E'),
];
// wiki：Eへの条件は不明
const d2: Rule[] = [
    go('F', atLeast(3, 'BBclass')),
    go('F', atLeast(3, 'CVclass')),
    go('F', atLeast(3, 'CAV')),
    go('G'),
];

export const W7_RULES: Record<string, MapRules> = {
    '7-1': {
        updated: '2020/03/07', checked: '2026/10/21', goal: ['K'],
        nodes: {
            '1': [
                when(has('SS'), [
                    random(['B', 'D'], has('BBclass', 'CVclass')),
                    random(['B', 'D'], ships(5)),
                    random(['B', 'D', 'F'], ships(undefined, 4)),
                ]),
                go('B', has('BBclass', 'CVclass')),
                go('B', ships(6, 6)),
                go('D', any(ships(5, 5), has('AO'))),
                go('F', ships(undefined, 4)),
            ],
            B: [
                go('A', atLeast(1, 'BBclass', 'CV')),
                go('A', atLeast(2, 'CVL')),
                go('A', atLeast(3, 'CAclass')),
                go('C', atLeast(2, 'DD', 'DE')),
                random(['A', 'C']),
            ],
            D: [
                go('E', all(exactly(1, 'CL'), exactly(4, 'DD'))),
                go('E', all(has('DD'), atLeast(3, 'DE'))),
                go('E', all(has('AO'), atLeast(3, 'DE'))),
                go('E', exactly(5, 'DD', 'DE')),
                when(exactly(4, 'DD', 'DE'), [
                    go('E', has('CT')),
                    go('E', has('AO')),
                    random(['C', 'E'], has('AV')),
                ]),
                go('C'),
            ],
            H: [
                go('K', all(has('CL'), atLeast(4, 'DD'))),
                go('K', all(has('DD'), atLeast(3, 'DE'))),
                random(['I', 'K'], has('AO'), undefined, true),
                go('J', atLeast(2, 'BBclass', 'CVclass')),
                random(['I', 'J', 'K'], exactly(1, 'BBclass', 'CVclass')),
                // wiki：I:J:K＝20～25%?:5～10%?:70～75%?
                random(['I', 'J', 'K'], undefined, pc('K', 70), true),
            ],
        },
    },
    '7-2': {
        updated: '2020/04/19', checked: '2026/10/21', goal: ['G', 'M'], boss: ['G', 'M'],
        stages: [
            { id: 'g1', labelKey: 'route.stage.72g1', goal: ['G'], flags: {} },
            { id: 'g2', labelKey: 'route.stage.72g2', goal: ['M'], flags: {} },
        ],
        nodes: {
            '1': [
                go('A', atMost(1, 'DD', 'DE')),
                go('A', has('SS')),
                when(ships(6, 6), [
                    go('A', atLeast(2, 'CV')),
                    go('A', atLeast(4, 'BBclass', 'CV')),
                    go('A', atLeast(3, 'CL', 'CT')),
                    go('B'),
                ]),
                when(ships(5, 5), [
                    go('A', atLeast(3, 'CV')),
                    go('B', atLeast(1, 'BBclass', 'CV')),
                    go('B', atLeast(2, 'CL', 'CT')),
                    go('B', atMost(2, 'DE')),
                    go('C'),
                ]),
                when(ships(undefined, 4), [
                    go('B', atLeast(1, 'BBclass', 'CV')),
                    go('B', atMost(2, 'DD', 'DE')),
                    go('C'),
                ]),
            ],
            C: [
                go('D', has('AO')),
                go('D', has('SS')),
                when(ships(6, 6), [
                    go('D', atLeast(1, 'BBclass', 'CV')),
                    go('E', atLeast(4, 'DD', 'DE')),
                    go('D'),
                ]),
                when(ships(5, 5), [
                    go('D', atLeast(2, 'BBclass', 'CV')),
                    go('E', atLeast(4, 'DD', 'DE')),
                    go('E', atLeast(3, 'DE')),
                    go('D'),
                ]),
                when(ships(undefined, 4), [
                    go('D', atLeast(2, 'BBclass', 'CV')),
                    go('E', atLeast(3, 'DD', 'DE')),
                    go('E', atLeast(2, 'DE')),
                    go('D'),
                ]),
            ],
            D: [
                go('I', fastPlusAtLeast),
                go('H', atLeast(4, 'BBclass', 'CVclass')),
                go('I', fastAtLeast),
                go('H', exactly(3, 'BBclass', 'CVclass')),
                random(['H', 'I'], exactly(2, 'BBclass', 'CVclass'), pc('I', 65)),
                go('I', atMost(1, 'BBclass', 'CVclass')),
            ],
            // E／I の索敵（分岐点係数 4）。E の下限値は wiki が「?」、46 も推定値
            E: [
                go('G', ships(undefined, 5)),
                go('G', atLeast(5, 'DD', 'DE')),
                go('G', all(has('DD'), atLeast(3, 'DE'))),
                go('G', los(4, 46), true),
                unknown(['F', 'G']),
            ],
            I: [
                go('J', has('AO')),
                go('J', all(has('AV'), atLeast(3, 'DD', 'DE'))),
                go('L', los(4, undefined, 63), true),
                random(['L', 'M'], los(4, 63, 69), undefined, true),
                go('M', los(4, 69)),
            ],
        },
    },
    '7-3': {
        // 戦力ゲージ1（Pマス出現前）／戦力ゲージ2（Pマス出現後）
        updated: '2020/09/23', checked: '2026/10/21', goal: ['E', 'P'], boss: ['E', 'P'],
        stages: [
            { id: 'g1', labelKey: 'route.stage.73g1', goal: ['E'], flags: { pAppeared: false } },
            { id: 'g2', labelKey: 'route.stage.73g2', goal: ['P'], flags: { pAppeared: true } },
        ],
        nodes: {
            A: [when(pAppeared, a2), ...a1],
            C: [when(pAppeared, c2), ...c1],
            D: [when(pAppeared, d2), ...d1],
            G: [
                when(all(none('CA'), atLeast(2, 'DD', 'DE')), [
                    go('H', has('AO')),
                    go('H', atLeast(2, 'AV')),
                ]),
                go('I', has('SS')),
                go('J', has('BBclass', 'CVclass')),
                when(hk, [
                    go('P', ships(undefined, 4)),
                    go('J', atMost(2, 'DD')),
                    go('P', fastPlusExact),
                    go('K', withSets([], ['ashigara', 'myoukou', 'takao'], 2)),
                    go('J', atLeast(3, 'CAclass')),
                    go('J', slow),
                    go('P', hasShip('ashigara')),
                    go('K'),
                ]),
                go('J', atMost(2, 'DD', 'DE')),
                go('J', atLeast(3, 'CAclass')),
                go('I'),
            ],
            I: [
                go('J', has('BBclass', 'CVclass')),
                go('J', atLeast(3, 'CAclass')),
                go('J', none('DD', 'DE')),
                when(hk, [
                    when(atLeast(3, 'DD', 'DE'), [
                        go('J', fastPlusAtLeast),
                        go('M'),
                    ]),
                    when(exactly(2, 'DD', 'DE'), [
                        go('M', fastest),
                        go('L'),
                    ]),
                    go('L', exactly(1, 'DD', 'DE')),
                ]),
                go('J', all(fastest, atLeast(3, 'DD'))),
                go('M', all(any(hasShip('haguro'), hasShip('kamikaze')), hasShip('ashigara'), atLeast(3, 'DD', 'DE'))),
                go('L'),
            ],
            J: [
                go('M', has('BBclass', 'CVclass')),
                go('M', slow),
                go('M', atLeast(4, 'CAclass')),
                when(atLeast(3, 'DD'), [
                    go('P', any(all(hasShip('haguro'), hasShip('ashigara')), hk)),
                    go('M'),
                ]),
                when(exactly(2, 'DD'), [
                    go('P', all(hasShip('haguro'), hasShip('kamikaze'), hasShip('ashigara'))),
                    go('M'),
                ]),
                go('M', atMost(1, 'DD')),
            ],
            M: [
                go('N', has('CV')),
                go('N', atLeast(2, 'BBclass', 'CVclass')),
                go('N', atLeast(4, 'SS')),
                go('O', has('SBB')),
                go('O', has('AO')),
                go('O', atLeast(2, 'AV')),
                go('P'),
            ],
        },
    },
    '7-4': {
        updated: '2025/03/17', checked: '2026/10/21', goal: ['P'],
        nodes: {
            '1': [
                go('C', atLeast(1, 'BB', 'CV', 'SS')),
                go('C', atLeast(2, 'CAclass')),
                go('C', atLeast(2, 'CLclass')),
                go('A', all(hasShip('akitsuMaru'), atLeast(2, 'DE'), atLeast(3, 'DD', 'DE'))),
                go('C', withSets(['BBV', 'CVL'], ['akitsuMaru'], 3)),
                go('A', atLeast(3, 'DD', 'DE')),
                go('A', atLeast(2, 'DE')),
                go('C'),
            ],
            C: [
                go('D', any(atLeast(1, 'BB', 'CV', 'SS'), withSets(['CVL'], ['akitsuMaru'], 3))),
                go('E', any(
                    atLeast(4, 'DD', 'DE'),
                    all(has('CT'), atLeast(3, 'DD', 'DE')),
                    atLeast(3, 'DE'),
                    all(fastPlusExact, atLeast(2, 'DD')),
                )),
                go('D'),
            ],
            // 海防4隻＋(補給・揚陸)から1隻＋(大鷹型・補給・揚陸・駆逐・海防)から1隻の6隻編成
            E: [
                go('G', all(
                    ships(6, 6), atLeast(4, 'DE'), has('AO', 'LHA'),
                    withSets(['DE', 'AO', 'LHA', 'DD'], ['taiyouClass'], 6, 6),
                )),
                go('J'),
            ],
            F: [{ choice: ['H', 'J'] }],
            // G／J／K は wiki が索敵値・条件を記載していない（係数も不明）
            G: [unknown(['I', 'L'])],
            J: [
                go('K', visited('D')),
                unknown(['K', 'L', 'P']),
            ],
            K: [unknown(['M', 'P'])],
            // 索敵値の閾値（45／47）は係数不明で評価できない。ただし「条件のいずれか」を満たせば去向は N／O のみ、
            // 満たさなければ N（索敵45未満）か P（45以上）のどちらか
            M: [
                when(any(
                    atLeast(1, 'SBB', 'CV'),
                    atLeast(2, 'FBB'),
                    atLeast(2, 'BBV'),
                    withSets(['CVL'], ['akitsuMaru'], 2),
                    withSets(['FBB', 'BBV', 'CVL'], ['akitsuMaru'], 3),
                    atMost(1, 'DD', 'DE'),
                ), [unknown(['N', 'O'])]),
                unknown(['N', 'P']),
            ],
        },
    },
    '7-5': {
        updated: '2024/11/12', checked: '2026/10/21', goal: ['K', 'Q', 'T'], boss: ['K', 'Q', 'T'],
        stages: [
            { id: 'g1', labelKey: 'route.stage.75g1', goal: ['K'], flags: {} },
            { id: 'g2', labelKey: 'route.stage.75g2', goal: ['Q'], flags: {} },
            { id: 'g3', labelKey: 'route.stage.75g3', goal: ['T'], flags: {} },
        ],
        nodes: {
            B: [
                go('D', fastPlusAtLeast),
                go('C', atLeast(2, 'CV')),
                go('C', atLeast(2, 'SBB')),
                go('C', has('SS')),
                go('C', none('CL')),
                go('C', atMost(1, 'DD', 'DE')),
                go('D', atLeast(3, 'DD', 'DE')),
                go('C', has('CV')),
                go('C', atLeast(2, 'CVL')),
                go('C', atLeast(3, 'BBclass')),
                go('C', atLeast(3, 'CAclass')),
                go('D'),
            ],
            D: [
                go('F', fastest),
                go('E', atLeast(2, 'CV')),
                go('E', atLeast(3, 'CVclass')),
                go('E', atLeast(3, 'BBclass', 'CV', 'CAclass')),
                go('E', has('SS')),
                go('E', none('CL', 'DD')),
                go('F', fastPlusExact),
                when(exactly(2, 'BBclass'), [
                    go('F', all(fastExact, atLeast(2, 'DD', 'DE'))),
                    go('F', atLeast(3, 'DD', 'DE')),
                    go('E'),
                ]),
                go('F', atLeast(2, 'CL', 'DD', 'DE')),
                go('E'),
            ],
            F: [{ choice: ['G', 'J'] }],
            H: [{ choice: ['I', 'K'] }],
            I: [
                go('M', los(4, 59), true),
                random(['L', 'M'], los(4, 53, 59), undefined, true),
                go('L', los(4, undefined, 53), true),
            ],
            J: [
                go('O', all(exactly(1, 'CVL'), exactly(2, 'CAclass'), exactly(1, 'CL'), exactly(2, 'DD', 'DE'))),
                go('O', fastPlusAtLeast),
                go('N', has('CV')),
                go('N', atLeast(3, 'CVL')),
                go('N', atLeast(2, 'SBB')),
                go('N', atLeast(3, 'BBclass', 'CAclass')),
                go('N', atMost(1, 'DD', 'DE')),
                go('O', atLeast(3, 'DD', 'DE')),
                go('O', fastExact),
                go('N'),
            ],
            O: [{ choice: ['P', 'Q'] }],
            // 索敵スコア58未満はS固定、58～63未満はSとのランダム、それ以上は下の条件でRかT（係数は wiki 未記載）
            P: [
                when(fastest, [unknown(['S', 'T'])]),
                when(any(has('CV'), atLeast(2, 'BBclass', 'CVL'), atLeast(3, 'BBclass', 'CAclass'), none('CL')), [unknown(['R', 'S'])]),
                unknown(['S', 'T']),
            ],
        },
    },
};
