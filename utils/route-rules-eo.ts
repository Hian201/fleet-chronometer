// Extra Operation（1-5／1-6／2-5／3-5／4-5／5-5／5-6／6-5）の分岐ルール。
// 転記の約束は route-rules-data.ts の檔頭を参照。
import {
    all, any, atLeast, atMost, exactly, fastAtLeast, fastest, fastPlusAtLeast, fastPlusExact, go, has, los,
    none, not, random, choice, unknown, visited, when, ships, slow,
} from './route-rules-dsl';
import type { MapRules } from './route-predict';

export const EO_RULES: Record<string, MapRules> = {
    // ── Extra Operation ─────────────────────────────────────────────
    '1-5': {
        updated: '2024/10/20', checked: '2026/10/21', goal: ['J'],
        nodes: {
            C: [
                go('J', { only: ['DE'] }),
                go('J', all(exactly(1, 'CL'), exactly(4, 'DE'), ships(5, 5)), true),
                go('B', has('SS')),
                random(['B', 'J'], all(ships(undefined, 4), has('AO'))),
                go('B'),
            ],
            D: [
                go('E', ships(undefined, 1)),
                when(ships(5), [go('F', has('SS')), random(['E', 'F'])]),
                go('E', { only: ['DE'] }),
                go('E', has('AO')),
                go('F'),
            ],
            E: [
                go('C', ships(5)),
                go('J', { only: ['DE'] }),
                go('C'),
            ],
            F: [
                // 「戦艦」不含航空戦艦（wiki 註腳）
                go('I', any(has('BB'), has('CV'), has('SS'))),
                go('I', atLeast(2, 'CVL')),
                go('I', atLeast(3, 'CL')),
                go('G'),
            ],
            G: [
                go('H', ships(5)),
                go('J'),
            ],
        },
    },
    '1-6': {
        // N 是終點（ゴール），不是王
        updated: '2019/11/03', checked: '2026/10/21', goal: ['N'], boss: [],
        nodes: {
            '1': [
                go('C', any(has('BBV'), has('CVL'), has('CA'))),
                go('C', atLeast(2, 'CAV')),
                go('C', atMost(3, 'DD', 'DE')),
                go('A'),
            ],
            G: [
                go('F', all(exactly(1, 'CL'), exactly(5, 'DD', 'DE'))),
                random(['F', 'K'], undefined, ['F', 75]),
            ],
            M: [
                go('L', atLeast(3, 'BBV', 'CA', 'CVL')),
                go('L', atLeast(3, 'BBV', 'CA', 'CAV')),
                go('L', atMost(2, 'DD', 'DE')),
                go('L', los(3, undefined, 28), true),
                random(['J', 'L'], los(3, 28, 30), undefined, true),
                go('J'),
            ],
        },
    },
    '2-5': {
        updated: '2020/06/11', checked: '2026/10/21', goal: ['O'],
        nodes: {
            '1': [
                go('B', atLeast(4, 'SS')),
                when(all(has('SS'), atMost(3, 'BBclass')), [
                    random(['B', 'C'], has('CVclass')),
                    random(['B', 'C'], atLeast(2, 'AV')),
                ]),
                go('C', has('CVclass')),
                go('C', atLeast(2, 'AV')),
                go('B', { carriers: 'drum', min: 2 }),
                go('B', atLeast(4, 'DD', 'DE')),
                go('B', all(has('CL'), atLeast(3, 'DD', 'DE'))),
                go('C', has('BBclass')),
                go('C', all(has('CL', 'CLT'), atLeast(2, 'CAV'))),
                go('C', all(has('CL', 'CLT'), has('CAV'), atLeast(5, 'CAclass', 'CL', 'CLT'))),
                random(['B', 'C'], ships(6), ['B', 80], true),
                // wiki：「かなりCマス寄りのランダム?」，未給比例
                random(['B', 'C'], undefined, undefined, true),
            ],
            B: [
                go('A', atLeast(3, 'SS')),
                go('F'),
            ],
            C: [
                go('D', atLeast(3, 'CVclass')),
                go('D', atLeast(3, 'BBclass')),
                go('E', all(has('CL'), atLeast(2, 'DD'))),
                go('E', all(atLeast(2, 'CAV'), atLeast(2, 'DD'))),
                random(['D', 'E'], undefined, ['E', 70]),
            ],
            E: [
                go('G', has('BBclass')),
                go('I', all(has('CL'), atLeast(4, 'DD', 'DE'))),
                go('G', slow),
                go('G', atLeast(2, 'CV', 'CAclass')),
                go('I', all(has('CL'), atLeast(3, 'DD'))),
                go('G'),
            ],
            F: [
                go('J', slow),
                go('E', atLeast(3, 'DD')),
                go('E', all(has('CL'), atLeast(2, 'DD'))),
                go('J', atLeast(3, 'BBclass')),
                random(['E', 'J'], undefined, ['J', 65]),
            ],
            G: [
                go('I', all(atMost(1, 'BBclass', 'CVclass'), atLeast(4, 'DD', 'DE'))),
                go('I', all(none('BBclass', 'CVclass'), has('CL'), atLeast(3, 'DD'))),
                go('K', los(1, undefined, 37), true),
                random(['K', 'L'], los(1, 37, 41), undefined, true),
                go('L', undefined, true),
            ],
            I: [
                go('H', los(1, undefined, 31)),
                random(['H', 'O'], los(1, 31, 34)),
                go('O'),
            ],
            J: [
                go('H', los(1, undefined, 42), true),
                when(los(1, 42, 49), [
                    random(['H', 'M', 'O'], atLeast(4, 'BBclass', 'CVclass'), undefined, true),
                    random(['H', 'O'], undefined, undefined, true),
                ]),
                random(['M', 'O'], atLeast(4, 'BBclass', 'CVclass')),
                go('O', undefined, true),
            ],
            L: [
                go('O', all(has('CL'), atLeast(2, 'DD'))),
                random(['N', 'O'], none('BBclass', 'CVclass'), ['O', 60], true),
                random(['N', 'O'], undefined, ['N', 60], true),
            ],
        },
    },
    '3-5': {
        // wiki 頁未標分岐法則更新日
        updated: null, checked: '2026/10/21', goal: ['K'],
        nodes: {
            '1': [
                go('B', atLeast(3, 'SS')),
                go('B', atLeast(2, 'BBclass')),
                go('B', atLeast(3, 'BBclass', 'CAclass')),
                go('B', any(has('CVclass'), has('CLT'))),
                go('F', atLeast(5, 'DD')),
                random(['B', 'F'], exactly(4, 'DD'), ['F', 75]),
                random(['B', 'F']),
            ],
            B: [
                go('A', atLeast(4, 'SS')),
                go('A', atLeast(4, 'CVclass')),
                go('A', atLeast(5, 'BBclass', 'CVclass')),
                go('D', atLeast(2, 'CLT')),
                go('D', atLeast(2, 'CVclass')),
                go('D', atLeast(3, 'BBclass')),
                go('D', atLeast(5, 'BBclass', 'CVclass', 'CAclass')),
                go('E', all(none('CVclass'), exactly(1, 'CL'), atLeast(2, 'DD'))),
                go('C'),
            ],
            E: [go('H')],
            F: [
                go('E', atLeast(1, 'BBclass', 'CVclass', 'LHA')),
                go('E', atLeast(4, 'CL', 'CLT')),
                go('E', atLeast(2, 'CAclass')),
                random(['E', 'G'], exactly(1, 'CAclass'), ['G', 75]),
                when(none('CAclass'), [
                    random(['E', 'G'], exactly(3, 'CL'), ['G', 85]),
                    go('G', atMost(2, 'CL')),
                ]),
            ],
            G: [
                go('I', los(4, undefined, 23)),
                random(['I', 'K'], los(4, 23, 28)),
                go('K'),
            ],
            H: [
                go('J', atLeast(4, 'BBclass', 'CVclass')),
                go('J', has('LHA')),
                go('J', los(4, undefined, 35), true),
                random(['J', 'K'], los(4, 35, 40), undefined, true),
                go('K', undefined, true),
            ],
        },
    },
    '4-5': {
        updated: '2020/03/18', checked: '2026/10/21', goal: ['T'],
        nodes: {
            '1': [random(['A', 'C'])],
            A: [choice(['B', 'D'])],
            C: [choice(['D', 'F'])],
            D: [go('H')],
            I: [choice(['G', 'J'])],
            E: [
                go('M', fastPlusAtLeast),
                go('M', has('AO')),
                go('M', atLeast(3, 'BBclass', 'CVclass')),
                go('M', all(has('CL'), atLeast(2, 'DD', 'DE'))),
                go('K'),
            ],
            G: [
                go('H', all(has('CL'), atLeast(2, 'DD', 'DE')), true),
                random(['D', 'H'], undefined, undefined, true),
            ],
            H: [
                go('T', all(fastPlusAtLeast, atMost(4, 'BBclass', 'CVclass'))),
                go('T', all(exactly(1, 'CL'), atLeast(3, 'DD', 'DE'))),
                go('T', all(not(visited('D')), exactly(1, 'CL'), atLeast(2, 'DD', 'DE'))),
                go('K'),
            ],
            K: [
                // wiki：「Eマスを経由済みならM?（反例アリ）」
                go('M', visited('E'), true),
                go('M', atLeast(4, 'BBclass', 'CV')),
                go('M', atLeast(5, 'BBclass', 'CVclass')),
                go('M', has('AO')),
                go('L', los(2, undefined, 63), true),
                when(los(2, 63, 70), [
                    random(['L', 'M', 'T'], has('SS'), undefined, true),
                    random(['L', 'T'], undefined, undefined, true),
                ]),
                random(['M', 'T'], has('SS')),
                go('T', undefined, true),
            ],
            M: [
                go('N', fastest),
                go('R', atMost(1, 'DD')),
                go('N', fastPlusExact),
                go('R', slow),
                go('N', atMost(1, 'BBclass', 'CV')),
                go('R'),
            ],
            N: [go('T')],
            O: [
                go('N', atLeast(5, 'BBclass', 'CVclass'), true),
                random(['N', 'T'], undefined, undefined, true),
            ],
            Q: [
                go('P', los(2, undefined, 55), true),
                when(los(2, 55, 59), [
                    random(['O', 'P'], atLeast(5, 'BBclass', 'CVclass'), undefined, true),
                    random(['O', 'P'], none('DD'), undefined, true),
                    random(['N', 'P'], undefined, undefined, true),
                ]),
                go('O', atLeast(5, 'BBclass', 'CVclass')),
                go('O', none('DD')),
                go('N', undefined, true),
            ],
            R: [
                go('N', fastPlusExact),
                go('N', all(fastAtLeast, has('CL', 'CAV'), atLeast(2, 'DD'))),
                go('S'),
            ],
        },
    },
    '5-5': {
        updated: '2020/02/08', checked: '2026/10/21', goal: ['S'],
        nodes: {
            '1': [
                go('A', atLeast(4, 'DD')),
                go('A', { carriers: 'drum', min: 4 }),
                go('A', { carriers: 'daihatsu', min: 4 }),
                go('B'),
            ],
            B: [
                go('K', atLeast(3, 'CV')),
                go('K', atLeast(4, 'BBclass', 'CLT')),
                go('K', atLeast(3, 'CLT')),
                go('K', atMost(1, 'DD')),
                go('F'),
            ],
            E: [
                go('H', fastest),
                go('H', all(fastPlusExact, atLeast(2, 'DD'))),
                go('G'),
            ],
            F: [choice(['D', 'J'])],
            H: [
                go('N', fastest),
                go('P', atLeast(4, 'BBclass', 'CVclass')),
                go('L', atMost(1, 'DD')),
                go('N'),
            ],
            I: [
                go('L', all(exactly(3, 'BBclass', 'CVclass'), atLeast(2, 'DD'))),
                go('M'),
            ],
            L: [go('N')],
            M: [
                go('O', visited('N')),
                go('L', atLeast(4, 'BBclass', 'CVclass')),
                go('L', atMost(1, 'DD')),
                go('O'),
            ],
            N: [
                go('O', visited('M')),
                go('O', fastPlusAtLeast),
                go('O', has('AO')),
                go('M', has('CV')),
                go('M', atLeast(3, 'BBclass', 'CVL')),
                go('M', atMost(1, 'DD')),
                go('O'),
            ],
            O: [
                go('S', fastPlusAtLeast),
                go('R', los(2, undefined, 63)),
                random(['R', 'S'], any(los(2, 63, 66), has('SS'))),
                go('S'),
            ],
            P: [
                go('S', fastest),
                when(fastPlusExact, [
                    random(['Q', 'S'], has('SS')),
                    go('S', atMost(5, 'BBclass', 'CVclass')),
                    random(['Q', 'S']),
                ]),
                go('Q', los(2, undefined, 73), true),
                random(['Q', 'S'], any(los(2, 73, 80), has('SS'), atLeast(5, 'BBclass', 'CVclass')), undefined, true),
                go('S', undefined, true),
            ],
        },
    },
    '5-6': {
        // 第一ボス G（輸送）、第二ボス N、第三ボス Z；機關階段的目標 R 不是王
        updated: '2026/07/01', checked: '2026/10/21', goal: ['G', 'N', 'Z'], boss: ['G', 'N', 'Z'],
        stages: [
            { id: 'g1', labelKey: 'route.stage.56g1', goal: ['G'], flags: { start2Open: false, gauge2Broken: false } },
            { id: 'g2gimmick', labelKey: 'route.stage.56g2gimmick', goal: ['R'], flags: { start2Open: false, gauge2Broken: false } },
            { id: 'g2', labelKey: 'route.stage.56g2', goal: ['N'], flags: { start2Open: true, gauge2Broken: false } },
            { id: 'g3', labelKey: 'route.stage.56g3', goal: ['Z'], flags: { start2Open: true, gauge2Broken: true } },
        ],
        nodes: {
            '': [
                go('1', not({ phase: 'start2Open' })),
                go('1', any(all(atLeast(2, 'BBclass'), slow), atLeast(1, 'AV', 'LHA'))),
                go('2'),
            ],
            '1': [
                go('A', all(none('CV'), atLeast(4, 'DD'))),
                go('A', all(has('LHA'), atLeast(2, 'DD'))),
                go('A1', all(atLeast(2, 'BBclass'), atMost(2, 'DD'))),
                go('A2', all(none('CV'), atLeast(2, 'DD'))),
                go('A1'),
            ],
            A: [
                go('B', all(has('CAclass'), slow)),
                go('C2', { count: ['BBclass', 'CVclass'], sets: ['akitsuMaru'], max: 0 }),
                go('B'),
            ],
            A2: [
                go('C', all(
                    fastAtLeast, none('CV'), atMost(2, 'BBclass', 'CVL', 'CAclass'), atMost(1, 'CAclass'),
                    any(all(has('CL'), atLeast(2, 'DD')), atLeast(3, 'DD')),
                )),
                go('B'),
            ],
            B: [
                go('C2', all(exactly(2, 'BBV'), exactly(4, 'DD'))),
                // 分岐表依條件會走 C，但 wiki 同頁攻略段落「大回りルート 編成例：潜水6」與較新的實測（攻略站 2026/08/29 確認）
                // 都是 B→C1：只收這個實際確認過的編成，不推廣成條件
                go('C1', exactly(6, 'SS')),
                // 「速力:低速を含み(戦艦級＋軽空母)1隻なら駆逐3隻以下」
                go('C', all(
                    atMost(1, 'BBclass', 'CVL'),
                    any(not(slow), none('BBclass', 'CVL'), atMost(3, 'DD')),
                    none('CV'),
                )),
                go('C1'),
            ],
            C1: [
                go('C2', visited('A')),
                go('C'),
            ],
            E: [unknown(['F', 'G'])],
            '2': [go('I')],
            I: [choice(['J', 'O'])],
            J: [
                go('K1', all(slow, atLeast(3, 'BBclass', 'CV'))),
                go('K', any(all(has('CL'), atLeast(2, 'DD')), atLeast(3, 'DD'))),
                go('K1'),
            ],
            K: [
                go('L', all(fastAtLeast, atMost(2, 'BBclass', 'CVclass'), has('CL'), atLeast(2, 'DD'))),
                go('K2'),
            ],
            L: [unknown(['M', 'N'])],
            O: [choice(['P', 'Q'])],
            Q: [
                go('Q2', not({ phase: 'gauge2Broken' })),
                go('W', fastPlusAtLeast),
                go('W', all(has('CL'), atLeast(3, 'DD'))),
                // 分岐表「(戦艦級＋正規空母)3隻のとき軽巡1隻以上」不成立會走 Q2，但 wiki 同頁攻略段落「低速戦艦1以下最短ルート
                // 編成例：戦艦1,正規空母2,軽空母1,駆逐2」與較新的實測（攻略站 2026/08/29 確認）都是 Q→U：只收這個編成
                go('U', all(exactly(1, 'BBclass'), exactly(2, 'CV'), exactly(1, 'CVL'), exactly(2, 'DD'), ships(6, 6))),
                go('U', all(
                    atMost(3, 'BBclass', 'CV'),
                    any(atMost(2, 'BBclass', 'CV'), has('CL')),
                    atLeast(2, 'DD'),
                )),
                go('Q2'),
            ],
            Q1: [
                unknown(['S'], { losUnknown: true }),
                go('T', all(atMost(1, 'CV'), atLeast(2, 'DD'))),
                go('Q2'),
            ],
            Q2: [
                go('T', visited('P')),
                go('V'),
            ],
            V: [
                go('X', all(fastAtLeast, atMost(3, 'BBclass', 'CVclass'), atMost(2, 'CVclass'), atLeast(2, 'DD'))),
                go('W'),
            ],
            W: [go('X')],
            X: [unknown(['Y', 'Z'])],
        },
    },
    '6-5': {
        updated: '2019/11/09', checked: '2026/10/21', goal: ['M'],
        nodes: {
            '': [
                go('A', none('CL')),
                go('A', any(has('CVclass'), has('CLT'))),
                go('A', atLeast(4, 'BBclass')),
                go('B'),
            ],
            B: [
                go('C', exactly(3, 'BBclass')),
                go('C', atMost(1, 'DD')),
                go('F'),
            ],
            C: [
                go('E', none('DD')),
                go('E', atLeast(2, 'CLT')),
                go('E', atLeast(4, 'BBclass', 'CVclass')),
                go('E', atLeast(5, 'BBclass', 'CVclass', 'CAclass')),
                go('D'),
            ],
            E: [
                go('H', all(has('CVclass'), has('CL'), has('DD'))),
                go('I'),
            ],
            G: [
                go('M', los(3, 50)),
                // 下限值不明：50 未滿是 K 或 K／M 隨機
                unknown(['K', 'M']),
            ],
            I: [
                go('H', none('CL')),
                go('J', atLeast(2, 'DD')),
                go('J', all(none('BBclass'), atMost(4, 'CVclass', 'CAclass'), atMost(2, 'CVclass'), atMost(4, 'CAclass'))),
                go('H'),
            ],
            J: [
                go('M', los(3, 35), true),
                unknown(['L', 'M']),
            ],
        },
    },
};
