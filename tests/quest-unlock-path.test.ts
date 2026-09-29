import { describe, expect, it } from 'vitest';
import { GameState } from '../utils/state';
import {
    buildQuestFlow, questDownstreamLayers, questRequirementGroups, questUnlockPlan,
} from '../utils/quest-flow';
import { layoutQuestGraph } from '../utils/quest-graph-layout';
import { questFlowDetailHtml, type QuestFlowDetailView } from '../entrypoints/overview/sections/quest-flow';

const VIEW: QuestFlowDetailView = {
    tab: 'path', graphDone: false, pinned: false, manual: false, japaneseOriginalOpen: false, doneOpen: false,
};

function ancestorsOf(no: number): number[] {
    return questUnlockPlan(buildQuestFlow(new GameState()), no)!.ancestors;
}

describe('任務解鎖路線', () => {
    it('攤平整個上游且不重複，拓撲序中前置一定排在後續之前', () => {
        const model = buildQuestFlow(new GameState());
        const plan = questUnlockPlan(model, 1042)!;
        expect(new Set(plan.ancestors).size).toBe(plan.ancestors.length);
        expect(plan.ancestors).not.toContain(1042);
        const index = new Map(plan.ancestors.map((no, i) => [no, i]));
        for (const no of plan.ancestors) {
            for (const prerequisite of model.byNo.get(no)!.prerequisiteNos) {
                if (index.has(prerequisite)) expect(index.get(prerequisite)!).toBeLessThan(index.get(no)!);
            }
        }
        // 舊的巢狀樹只展開五層；B214 的前置鏈遠比這深，必須整條列出。
        expect(plan.step.get(1042)!).toBeGreaterThan(6);
    });

    it('沒有任何完成紀錄時，全部上游都算仍需完成；第 1 步只有自己沒有未完成前置的任務', () => {
        const model = buildQuestFlow(new GameState());
        const plan = questUnlockPlan(model, 186)!;
        expect(plan.done.size).toBe(0);
        expect(plan.needed).toEqual(plan.ancestors);
        for (const no of plan.needed) {
            const unmet = questRequirementGroups(model.byNo.get(no)!).length;
            expect(plan.step.get(no) === 1).toBe(unmet === 0);
        }
    });

    it('步數是每個未滿足群組取最短選項後的最大值', () => {
        const model = buildQuestFlow(new GameState());
        const plan = questUnlockPlan(model, 1042)!;
        for (const no of [...plan.needed, 1042]) {
            const groups = questRequirementGroups(model.byNo.get(no)!)
                .filter(group => !group.some(member => plan.done.has(member)));
            const expected = groups.length
                ? Math.max(...groups.map(group => Math.min(...group.map(member => plan.step.get(member)! + 1))))
                : 1;
            expect(plan.step.get(no)).toBe(expected);
        }
    });

    it('上游全部標記完成時不再需要任何任務，目標在第 1 步', () => {
        const model = buildQuestFlow(new GameState(), new Set(ancestorsOf(187)));
        const plan = questUnlockPlan(model, 187)!;
        expect(plan.needed).toEqual([]);
        expect(plan.done.size).toBe(plan.ancestors.length);
        expect(plan.step.get(187)).toBe(1);
    });

    it('「任一即可」群組已有一項完成時，其他替代前置不列入仍需完成', () => {
        const base = buildQuestFlow(new GameState());
        // B48：205 且（201 或 216）
        expect(questRequirementGroups(base.byNo.get(286)!)).toEqual([[205], [201, 216]]);
        const done = ancestorsOf(286).filter(no => no !== 216);
        const plan = questUnlockPlan(buildQuestFlow(new GameState(), new Set(done)), 286)!;
        expect(plan.needed).toEqual([]);
        expect(plan.ancestors).toContain(216);
    });

    it('前置已出現在任務清單時直接列為第 1 步，不為它重做更上游的定期任務', () => {
        // By8（946）← By6（944）← Gy2（715）← Gy1（714），全是年任。
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 944, api_state: 1, api_title: '鎮守府近海海域の哨戒を実施せよ！', api_detail: '' }],
        }, { api_tab_id: '0' });
        const model = buildQuestFlow(state);
        const plan = questUnlockPlan(model, 946)!;
        expect(plan.needed).toEqual([944]);
        expect(plan.step.get(944)).toBe(1);
        expect(plan.step.get(946)).toBe(2);
        expect(plan.unlocked.has(944)).toBe(true);
        expect(plan.covered.has(715)).toBe(true);
        expect(plan.covered.has(714)).toBe(true);
        expect(plan.ancestors.every(no => plan.done.has(no) || plan.covered.has(no) || plan.needed.includes(no))).toBe(true);

        const html = questFlowDetailHtml(model, model.byNo.get(946)!, VIEW);
        expect(html).toContain('data-qf-item="944"');
        expect(html).not.toContain('data-qf-item="715"');
    });

    it('目標本身已出現在清單時沒有仍需完成的前置', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/questlist', {
            api_list: [{ api_no: 946, api_state: 2, api_title: '', api_detail: '' }],
        }, { api_tab_id: '9' });
        const plan = questUnlockPlan(buildQuestFlow(state), 946)!;
        expect(plan.needed).toEqual([]);
        expect(plan.step.get(946)).toBe(1);
    });

    it('不在目錄裡的任務沒有路線', () => {
        expect(questUnlockPlan(buildQuestFlow(new GameState()), 999_999)).toBeNull();
    });
});

describe('完成後開放', () => {
    it('依距離分層列出全部下游，同一任務只出現一次', () => {
        const model = buildQuestFlow(new GameState());
        const layers = questDownstreamLayers(model, 101);
        expect(layers[0]).toEqual(model.byNo.get(101)!.postrequisiteNos);
        const all = layers.flat();
        expect(new Set(all).size).toBe(all.length);
        expect(all).not.toContain(101);
    });
});

describe('任務關係圖排版', () => {
    it('前置在上層，層＝最長前置路徑；連線從上層接到下層', () => {
        const prerequisites: Record<number, number[]> = { 1: [], 2: [], 3: [1, 2], 4: [3, 1] };
        const layout = layoutQuestGraph([1, 2, 3, 4], no => prerequisites[no]);
        const layer = new Map(layout.nodes.map(node => [node.no, node.layer]));
        expect([layer.get(1), layer.get(2), layer.get(3), layer.get(4)]).toEqual([0, 0, 1, 2]);
        expect(layout.edges).toHaveLength(4);
        const y = new Map(layout.nodes.map(node => [node.no, node.y]));
        for (const edge of layout.edges) expect(y.get(edge.from)!).toBeLessThan(y.get(edge.to)!);
        const widest = 2;
        expect(layout.width).toBe(widest * (layout.nodeWidth + 12) + 12);
    });

    it('序列外的前置不畫，循環不會卡住', () => {
        const layout = layoutQuestGraph([1, 2], no => (no === 1 ? [2, 99] : [1]));
        expect(layout.nodes).toHaveLength(2);
        expect(layout.edges.every(edge => edge.from !== 99)).toBe(true);
    });
});

describe('任務導覽右欄', () => {
    it('解鎖路線逐項列出全部仍需完成的前置與目標，不設展開深度', () => {
        const model = buildQuestFlow(new GameState());
        const plan = questUnlockPlan(model, 1042)!;
        const html = questFlowDetailHtml(model, model.byNo.get(1042)!, VIEW);
        for (const no of [...plan.needed, 1042]) expect(html).toContain(`data-qf-item="${no}"`);
    });

    it('四個分頁只顯示選中的一頁，其餘 hidden', () => {
        const model = buildQuestFlow(new GameState());
        const html = questFlowDetailHtml(model, model.byNo.get(187)!, { ...VIEW, tab: 'graph' });
        expect(html).toMatch(/data-qf-tab="graph"[^>]*aria-selected="true"/);
        expect(html).toMatch(/data-qf-pane="graph"[^>]*aria-labelledby="qf-tab-graph">/);
        for (const tab of ['path', 'post', 'evidence']) {
            expect(html).toMatch(new RegExp(`data-qf-pane="${tab}"[^>]*aria-labelledby="qf-tab-${tab}" hidden>`));
        }
        expect(html).toContain('data-qf-node="187"');
    });
});
