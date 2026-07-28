// utils/event-plan.ts（活動作戰板核心）的純函式驗證。
//
// 情境資料照使用者提供的真實活動表格建：標籤 #1 第三十一戦隊(9艘)、#2 増強第三十一戦隊(8艘)、
// #5 仏地中海艦隊（尚未產生）。機制前提見該檔檔頭與 CLAUDE.md「活動作戰板」。
import { describe, expect, it } from 'vitest';
import {
    checkStage, ensureUniqueStageKeys, establishedTags, findPlanConflicts, freeShips,
    grantedTagsOf, groupBySally, guessMapNo, newStageKey, nextSallySnapshot, observeGrantedTags,
    plannedByTag, reconcileStages, removeStageAt, resolveSallyRoster, sallyBudget,
    type PlanStage, type SallyObservationInput, type SallyShip,
} from '../utils/event-plan';

const S = (id: number, name: string, sallyArea: number): SallyShip => ({ id, name, sallyArea });

const ships: SallyShip[] = [
    S(101, '大鷹', 1), S(102, '五十鈴', 1), S(103, '潮', 1), S(104, '高波', 1),
    S(105, '沖波', 1), S(106, '早霜', 1), S(107, '冬月', 1), S(108, '瑞穂', 1), S(109, '平安丸', 1),
    S(201, '比叡', 2), S(202, '蒼龍', 2), S(203, '祥鳳', 2), S(204, '那珂', 2),
    S(205, '谷風', 2), S(206, '梅', 2), S(207, '伊168', 2),
    S(208, 'Gloire', 2),                       // 已被前段吃掉，後段想用 → blocked
    S(301, 'Richelieu改二', 0), S(302, 'Jean Bart', 0), S(303, 'Mogador', 0),
    S(304, '球磨', 0), S(305, 'Gotland', 0),
];
const byId = new Map(ships.map(s => [s.id, s]));

const stage = (o: Partial<PlanStage> & { key: string }): PlanStage => ({
    label: o.key, allowedTags: [], grantsTag: null, slots: [], ...o,
});

describe('標籤分群（Layer 1：零輸入且權威）', () => {
    it('依標籤 id 升冪分群，無標籤艦不混入', () => {
        const groups = groupBySally(ships);
        expect(groups.map(g => g.sallyArea)).toEqual([1, 2]);
        expect(groups.map(g => g.ships.length)).toEqual([9, 8]);
        expect(groups.every(g => g.ships.every(s => s.sallyArea > 0))).toBe(true);
    });
    it('自由身 = 5 艘', () => expect(freeShips(ships)).toHaveLength(5));
    it('空名冊', () => expect(groupBySally([])).toEqual([]));
});

describe('標籤快照：即時資料優先與安全更新', () => {
    const historical = { 101: 9, 208: 8, 999: 7 };

    it('現行活動有非零標籤時，以完整即時名冊為準，不讓舊快照覆蓋', () => {
        const out = resolveSallyRoster(ships, historical, true);
        expect(out.source).toBe('live');
        expect(out.ships.find(ship => ship.id === 101)?.sallyArea).toBe(1);
        expect(out.ships.find(ship => ship.id === 208)?.sallyArea).toBe(2);
    });

    it('即時資料可安全產生快照；相同內容不重複更新', () => {
        const snapshot = nextSallySnapshot(undefined, ships, true);
        expect(snapshot).toMatchObject({ 101: 1, 208: 2 });
        expect(nextSallySnapshot(snapshot!, ships, true)).toBeNull();
    });

    it('空即時資料不會清除既有快照', () => {
        expect(nextSallySnapshot(historical, ships.map(ship => ({ ...ship, sallyArea: 0 })), true)).toBeNull();
    });

    it('歷史活動以快照恢復分群與鎖定判定', () => {
        const out = resolveSallyRoster(ships.map(ship => ({ ...ship, sallyArea: 0 })), historical, false);
        expect(out.source).toBe('snapshot');
        expect(groupBySally(out.ships).map(g => [g.sallyArea, g.ships.map(ship => ship.id)])).toEqual([[8, [208]], [9, [101]]]);
        expect([...establishedTags(out.ships)].sort()).toEqual([8, 9]);
    });

    it('現行活動的標籤不會寫進另一個已不在 master 的歷史 area', () => {
        expect(nextSallySnapshot(historical, ships, false)).toBeNull();
    });

    it('舊計畫沒有快照仍可正常使用；不存在的 ship id 不猜測成其他艦', () => {
        const none = resolveSallyRoster(ships.map(ship => ({ ...ship, sallyArea: 0 })), undefined, false);
        expect(none.source).toBe('none');
        expect(groupBySally(none.ships)).toEqual([]);

        const historicalOnly = resolveSallyRoster(ships.map(ship => ({ ...ship, sallyArea: 0 })), historical, false);
        expect(historicalOnly.missingShipIds).toEqual([999]);
        expect(historicalOnly.ships.some(ship => ship.id === 999)).toBe(false);
    });
});

describe('關卡燈號', () => {
    const e43 = stage({
        key: 'E4-3', allowedTags: [5], grantsTag: 5,
        slots: [
            { shipId: 301 },       // 自由身 → willStamp
            { shipId: 302 },       // 自由身 → willStamp
            { shipId: 208 },       // 帶著標籤 #2 → blocked
            { role: '歐洲空母' },   // 只填角色 → role
            { shipId: 999 },       // 已解體 → gone
        ],
    });

    it('六種狀態逐格判定', () => {
        const r = checkStage(e43, byId);
        expect(r.slots.map(s => s.status)).toEqual(['willStamp', 'willStamp', 'blocked', 'role', 'gone']);
        expect(r.willStamp).toEqual([301, 302]);
        expect(r.blocked).toEqual([208]);
        expect(r.passable).toBe(false);
    });

    it('全員持有允許標籤 → 全綠且不消耗自由身', () => {
        const r = checkStage(stage({
            key: 'E1-1', allowedTags: [1], grantsTag: 1,
            slots: [{ shipId: 101 }, { shipId: 102 }, { shipId: 103 }],
        }), byId);
        expect(r.slots.map(s => s.status)).toEqual(['ok', 'ok', 'ok']);
        expect(r.willStamp).toEqual([]);
        expect(r.passable).toBe(true);
    });

    // 使用者還沒填攻略情報就滿江紅，會讓整張表失去訊號價值。
    it('allowedTags 未填 → 一律 unknown，不可判紅', () => {
        const r = checkStage(stage({
            key: 'E5-?', slots: [{ shipId: 208 }, { shipId: 303 }],
        }), byId);
        expect(r.slots.map(s => s.status)).toEqual(['unknown', 'unknown']);
        expect(r.willStamp).toEqual([]);
        expect(r.passable).toBe(true);
    });
});

describe('計畫矛盾（出擊前唯一擋得住的錯誤）', () => {
    const e43 = stage({ key: 'E4-3', allowedTags: [5], grantsTag: 5, slots: [{ shipId: 301 }] });

    it('certain：grantsTag 會蓋上後者不接受的標籤', () => {
        const e51 = stage({ key: 'E5-1', allowedTags: [6], grantsTag: 6, slots: [{ shipId: 301 }] });
        const c = findPlanConflicts([e43, e51], byId);
        expect(c).toHaveLength(1);
        expect(c[0].name).toBe('Richelieu改二');
        expect(c[0].severity).toBe('certain');
        expect(c[0].stageKeys).toEqual(['E4-3', 'E5-1']);
    });

    // 它的標籤已定，各關卡各自判 ok/blocked，不是計畫矛盾。
    it('已持有標籤的艦重複出現不算矛盾', () => {
        const a = stage({ key: 'A', allowedTags: [2], grantsTag: 2, slots: [{ shipId: 208 }] });
        const b = stage({ key: 'B', allowedTags: [9], grantsTag: 9, slots: [{ shipId: 208 }] });
        expect(findPlanConflicts([a, b], byId)).toEqual([]);
    });

    it('possible：允許標籤有交集且 grantsTag 未填（無從得知會蓋上哪個）', () => {
        const p1 = stage({ key: 'P1', allowedTags: [7, 8], slots: [{ shipId: 304 }] });
        const p2 = stage({ key: 'P2', allowedTags: [8], slots: [{ shipId: 304 }] });
        expect(findPlanConflicts([p1, p2], byId).map(c => c.severity)).toEqual(['possible']);
    });

    it('交集為空且 grantsTag 未填 → 仍是 certain', () => {
        const q1 = stage({ key: 'Q1', allowedTags: [7], slots: [{ shipId: 305 }] });
        const q2 = stage({ key: 'Q2', allowedTags: [8], slots: [{ shipId: 305 }] });
        expect(findPlanConflicts([q1, q2], byId).map(c => c.severity)).toEqual(['certain']);
    });

    it('空輸入', () => expect(findPlanConflicts([], byId)).toEqual([]));
});

describe('標籤預算', () => {
    it('自由身消耗跨關卡去重', () => {
        const e43 = stage({ key: 'E4-3', allowedTags: [5], grantsTag: 5, slots: [{ shipId: 301 }, { shipId: 302 }] });
        const e51 = stage({ key: 'E5-1', allowedTags: [6], grantsTag: 6, slots: [{ shipId: 301 }] });
        const b = sallyBudget([e43, e51], ships);
        expect(b.free).toBe(5);
        expect(b.locked).toEqual([{ sallyArea: 1, count: 9 }, { sallyArea: 2, count: 8 }]);
        expect(b.plannedStamp.sort()).toEqual([301, 302]);
        expect(b.freeAfterPlan).toBe(3);
    });
    it('空輸入', () => expect(sallyBudget([], []))
        .toEqual({ free: 0, locked: [], plannedStamp: [], freeAfterPlan: 0 }));
});

// 使用者實際回報三次：把船排進計畫後，標籤總帳仍顯示 0 艘、排進去的船像人間蒸發。
// 「計畫」與「現實」是兩個維度，必須並排顯示。
describe('計畫歸屬（實際 vs 計畫兩個維度）', () => {
    const taiyou = S(401, '大鷹改二', 0);
    const roster = [...ships, taiyou];
    const rosterById = new Map(roster.map(s => [s.id, s]));
    const e1 = stage({ key: 'E-1', allowedTags: [1], grantsTag: 1, slots: [{ shipId: 401 }] });

    it('排入計畫不會改變實際貼標', () => {
        expect(groupBySally(roster).find(g => g.sallyArea === 1)!.ships).toHaveLength(9);
        expect(plannedByTag([e1], rosterById).get(1)!.map(m => m.name)).toEqual(['大鷹改二']);
        expect(plannedByTag([e1], rosterById).get(1)![0].state).toBe('pending');
    });

    it('計畫格會過期：fulfilled／conflict 兩種狀態', () => {
        const done = stage({ key: 'E-1', allowedTags: [1], grantsTag: 1, slots: [{ shipId: 101 }] });
        expect(plannedByTag([done], byId).get(1)![0].state).toBe('fulfilled');

        const stale = stage({ key: 'E-9', allowedTags: [1], grantsTag: 1, slots: [{ shipId: 208 }] });
        const m = plannedByTag([stale], byId).get(1)![0];
        expect(m.state).toBe('conflict');
        expect(m.sallyArea).toBe(2);                       // 實際貼的是別的標籤
        expect([m.stageKey, m.slotIndex]).toEqual(['E-9', 0]);   // 供 UI 就地移除
    });

    // 多標籤共用的關卡用 allowedTags 反推會給錯答案，故未填就不猜。
    it('grantsTag 未填時不猜歸屬；角色格不列入', () => {
        expect([...plannedByTag([{ ...e1, grantsTag: null }], rosterById).keys()]).toEqual([]);
        expect([...plannedByTag([{ ...e1, slots: [{ role: '對空驅逐' }] }], rosterById).keys()]).toEqual([]);
    });

    // 同艦排進兩個不同 grantsTag 的關卡＝必定衝突，要在兩邊都看得到才刪得掉錯的那格。
    it('刻意不去重，但預算仍去重', () => {
        const two = [e1, { ...e1, key: 'E-2', grantsTag: 2 }];
        const dup = plannedByTag(two, rosterById);
        expect([dup.get(1)!.length, dup.get(2)!.length]).toEqual([1, 1]);
        expect(sallyBudget(two, roster).plannedStamp).toEqual([401]);
    });

    it('已確立的標籤＝實際有船帶著它', () => {
        expect([...establishedTags(roster)].sort()).toEqual([1, 2]);
        expect(establishedTags(roster).has(5)).toBe(false);   // 手動宣告但無船
        expect([...establishedTags([])]).toEqual([]);
    });
});

// 「出擊結果才是唯一依歸」：某艦出擊前無標籤、回港後帶著標籤 N ⇒ 該次出擊的海域貼出了 N。
describe('實際貼標觀測', () => {
    const port = (ts: number, pairs: [number, number][]): SallyObservationInput =>
        ({ kind: 'port', ts, tags: new Map(pairs) });
    const sortie = (ts: number, mapKey: number): SallyObservationInput => ({ kind: 'sortie', ts, mapKey });

    it('歸因到出擊的海域，並列出被貼標的艦', () => {
        const obs = observeGrantedTags([
            port(1, [[401, 0], [402, 0], [403, 0]]),
            sortie(2, 621),
            port(3, [[401, 1], [402, 1], [403, 0]]),
        ]);
        expect([...obs.keys()]).toEqual([621]);
        expect(obs.get(621)![0]).toMatchObject({ tagId: 1, shipIds: [401, 402], ambiguous: false });
        expect(grantedTagsOf(obs, 621)).toEqual([1]);
    });

    // 標籤由海域＋路線決定，同一張圖不同路線可貼不同標籤（使用者的 E2 就有兩個）。
    it('同圖多標籤與跨圖', () => {
        const obs = observeGrantedTags([
            port(1, [[401, 0], [402, 0], [403, 0]]),
            sortie(2, 621), port(3, [[401, 1], [402, 0], [403, 0]]),
            sortie(4, 621), port(5, [[401, 1], [402, 3], [403, 0]]),
            sortie(6, 622), port(7, [[401, 1], [402, 3], [403, 5]]),
        ]);
        expect(grantedTagsOf(obs, 621)).toEqual([1, 3]);
        expect(grantedTagsOf(obs, 622)).toEqual([5]);
        expect(grantedTagsOf(obs, 627)).toEqual([]);
    });

    // N → M（換標籤）機制上不會發生，觀測到也不採信——那更可能是漏收封包。
    it('只認 0 → N 的轉變', () => {
        expect([...observeGrantedTags([
            port(1, [[401, 2]]), sortie(2, 621), port(3, [[401, 7]]),
        ]).keys()]).toEqual([]);
    });

    it('第一筆母港只建基準線；沒有出擊就不歸因', () => {
        expect([...observeGrantedTags([port(1, [[401, 0]]), port(2, [[401, 1]])]).keys()]).toEqual([]);
    });

    it('兩次回港間多次出擊 → 歸因到最後一次並標記模糊', () => {
        const obs = observeGrantedTags([
            port(1, [[401, 0]]), sortie(2, 621), sortie(3, 622), port(4, [[401, 4]]),
        ]);
        expect([...obs.keys()]).toEqual([622]);
        expect(obs.get(622)![0].ambiguous).toBe(true);
    });

    it('空輸入', () => expect([...observeGrantedTags([]).keys()]).toEqual([]));
});

describe('關卡名 → 海域序號', () => {
    // E4-3 是 E4 的第 3 階段，不是 E3——取 E 後的第一個數字。
    it.each([['E-1', 1], ['E4-3', 4], ['E5 解謎 1', 5], ['e2', 2]] as [string, number][])(
        '%s → E%i', (label, no) => expect(guessMapNo(label)).toBe(no));
    it.each(['前段主力', ''])('%s → null', label => expect(guessMapNo(label)).toBeNull());
});

// 關卡列改成從遊戲海域清單自動產生後，既有計畫必須能無損接上。
describe('關卡列同步（首要職責：不丟資料）', () => {
    const MAPS = [{ no: 1 }, { no: 2 }, { no: 3 }];

    it('空計畫 → 每張圖各補一個空白主列', () => {
        expect(reconcileStages([], MAPS).map(x => [x.mapNo, !!x.phase]))
            .toEqual([[1, false], [2, false], [3, false]]);
    });

    it('主列在前、該圖的階段緊接其後', () => {
        const out = reconcileStages([
            stage({ key: 'm2', mapNo: 2, grantsTag: 7 }),
            stage({ key: 'p1', mapNo: 2, phase: true, label: 'E2-1' }),
            stage({ key: 'p2', mapNo: 2, phase: true, label: 'E2-2' }),
        ], MAPS);
        expect(out.map(x => [x.mapNo, x.phase ? x.label : 'base']))
            .toEqual([[1, 'base'], [2, 'base'], [2, 'E2-1'], [2, 'E2-2'], [3, 'base']]);
        expect(out.find(x => x.mapNo === 2 && !x.phase)!.grantsTag).toBe(7);
    });

    it('舊資料沒有 mapNo → 由關卡名反推', () => {
        const out = reconcileStages([stage({ key: 'old', label: 'E3-1', slots: [{ shipId: 9 }] })], MAPS);
        expect(out.find(x => x.key === 'old')!.mapNo).toBe(3);
        expect(out.find(x => x.key === 'old')!.phase).toBeUndefined();
    });

    it('同圖第二個主列轉成階段而非丟棄', () => {
        const out = reconcileStages([
            stage({ key: 'a', mapNo: 1, grantsTag: 1 }),
            stage({ key: 'b', mapNo: 1, grantsTag: 2 }),
        ], MAPS).filter(x => x.mapNo === 1);
        expect(out.map(x => [x.key, !!x.phase])).toEqual([['a', false], ['b', true]]);
        expect(out.map(x => x.grantsTag)).toEqual([1, 2]);
    });

    it('對應不上：有內容的保留在末尾，完全空白的才消失', () => {
        const out = reconcileStages([
            stage({ key: 'x', label: '對不上', slots: [{ role: '對空驅逐' }] }),
            stage({ key: 'y', label: '空白也對不上' }),
        ], MAPS);
        expect(out[out.length - 1].key).toBe('x');
        expect(out.some(x => x.key === 'y')).toBe(false);
    });

    it('沒有 master 時原樣返回（手填模式不亂動）', () => {
        expect(reconcileStages([stage({ key: 'keep', label: '手填' })], []).map(x => x.key)).toEqual(['keep']);
    });
});

describe('關卡 key 唯一性', () => {
    it('newStageKey 不與既有集合碰撞', () => {
        const existing = new Set([newStageKey([]), newStageKey([])]);
        const next = newStageKey(existing);
        expect(existing.has(next)).toBe(false);
        expect(next.length).toBeGreaterThan(0);
    });

    it('ensureUniqueStageKeys：重複 key 只改後列、不刪列', () => {
        const { stages, changed } = ensureUniqueStageKeys([
            stage({ key: 'dup', label: '第一', slots: [{ role: 'A' }] }),
            stage({ key: 'dup', label: '第二', slots: [{ role: 'B' }] }),
            stage({ key: 'ok', label: '第三' }),
        ]);
        expect(changed).toBe(true);
        expect(stages).toHaveLength(3);
        expect(stages[0]).toMatchObject({ key: 'dup', label: '第一', slots: [{ role: 'A' }] });
        expect(stages[1].key).not.toBe('dup');
        expect(stages[1]).toMatchObject({ label: '第二', slots: [{ role: 'B' }] });
        expect(stages[2].key).toBe('ok');
        expect(new Set(stages.map(s => s.key)).size).toBe(3);
    });

    it('ensureUniqueStageKeys：已唯一時不改動', () => {
        const input = [stage({ key: 'a' }), stage({ key: 'b' })];
        const { stages, changed } = ensureUniqueStageKeys(input);
        expect(changed).toBe(false);
        expect(stages).toEqual(input);
    });

    it('removeStageAt 只刪指定索引，同 key 另一列保留', () => {
        const stages = [
            stage({ key: 'dup', label: '留' }),
            stage({ key: 'dup', label: '刪' }),
        ];
        const out = removeStageAt(stages, 1);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ key: 'dup', label: '留' });
        expect(removeStageAt(stages, 99)).toEqual(stages);
    });
});
