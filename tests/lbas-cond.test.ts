import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    LBAS_COND_TICK_MS,
    lbasCondCertainty,
    lbasCondCertainlyClear,
    lbasCondClearsInMs,
    lbasRecoveryRate,
} from '../utils/lbas-cond';
import { GameState } from '../utils/state';

const MIN = 60_000;

describe('lbasRecoveryRate', () => {
    // wikiwiki §疲労：出撃+1／防空+2／退避+3／待機+4／休息+8（每 3 分鐘）
    it.each([[0, 4], [1, 1], [2, 2], [3, 3], [4, 8]])('札 %i → +%i/tick', (kind, rate) => {
        expect(lbasRecoveryRate(kind)).toBe(rate);
    });

    // 未知札取最慢＝保守：只會晚一點才判定回復，不會提早把疲勞抹掉
    it.each([[undefined], [null], [9], [-1]])('未知札 %s 一律取最慢的 +1', k => {
        expect(lbasRecoveryRate(k as number)).toBe(1);
    });
});

describe('lbasCondClearsInMs', () => {
    // 顯示碼 1=橙（內部值 20–29，最差 20，回到 30 要 +10）
    it('橙在待機(+4)下：ceil(10/4)=3 tick = 9 分', () => {
        expect(lbasCondClearsInMs(2, 4)).toBe(3 * LBAS_COND_TICK_MS);
    });

    it('橙在出撃(+1)下：10 tick = 30 分', () => {
        expect(lbasCondClearsInMs(2, 1)).toBe(10 * LBAS_COND_TICK_MS);
    });

    // 顯示碼 2=赤（內部值 0–19，最差 0，回到 30 要 +30）
    it('赤在待機(+4)下：ceil(30/4)=8 tick = 24 分', () => {
        expect(lbasCondClearsInMs(3, 4)).toBe(8 * LBAS_COND_TICK_MS);
    });

    it('赤在出撃(+1)下：30 tick = 90 分', () => {
        expect(lbasCondClearsInMs(3, 1)).toBe(30 * LBAS_COND_TICK_MS);
    });

    it.each([[0], [1], [4], [null]])('無標記段／未知碼(%s)回 null', c => {
        expect(lbasCondClearsInMs(c as number | null, 4)).toBeNull();
    });
});

describe('lbasCondCertainlyClear', () => {
    it('未達保證時間一律 false（含剛好差一點）', () => {
        expect(lbasCondCertainlyClear(2, 4, 8 * MIN)).toBe(false);
        expect(lbasCondCertainlyClear(2, 4, 9 * MIN - 1)).toBe(false);
    });

    it('到達保證時間即 true', () => {
        expect(lbasCondCertainlyClear(2, 4, 9 * MIN)).toBe(true);
        expect(lbasCondCertainlyClear(3, 4, 24 * MIN)).toBe(true);
    });

    // 時鐘往回跳／資料時間在未來時不得誤判成已回復
    it('負的經過時間不算回復', () => {
        expect(lbasCondCertainlyClear(2, 4, -60 * MIN)).toBe(false);
    });
});

// ── 面板實際會走的路徑 ───────────────────────────────────────────────────────
// 疲勞回復只發生在伺服器端、**回復時不送封包**；面板手上的 api_cond 是上次開基地畫面
// 時的快照，因此需依時間區間標示狀態把握程度。
const T0 = Date.parse('2026-08-04T12:00:00+09:00');

function stateWithTiredBase(actionKind: number) {
    const state = new GameState();
    state.applyEvent('api_get_member/base_air_corps', [{
        api_area_id: 6, api_rid: 1, api_name: '第一基地',
        api_action_kind: actionKind,
        api_distance: { api_base: 7, api_bonus: 0 },
        api_plane_info: [
            { api_squadron_id: 1, api_state: 1, api_slotid: 1, api_count: 18, api_max_count: 18, api_cond: 2 },
        ],
    }], undefined, T0);
    return state;
}

describe('GameState.lbasCondStateNow', () => {
    it('封包剛到時照封包顯示疲勞', () => {
        const state = stateWithTiredBase(0);
        const ab = state.airBases_()[0]!;
        expect(state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + 1 * MIN)).toBe('tired');
    });

    // 回到無標記帶（≥30）＝降到 `mild`，不是 `normal`：30 剛過的值顯然還不是「全滿」，
    // 而 0（全滿）與 1（輕度）的分界沒有任何佐證，不能猜。要變 normal 只能靠新封包。
    it('待機(+4)經過 9 分後必定回到無標記帶 → 降為 mild', () => {
        const state = stateWithTiredBase(0);
        const ab = state.airBases_()[0]!;
        expect(state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + 9 * MIN)).toBe('mild');
    });

    it('出撃(+1)札回復慢，9 分還不能斷定回復', () => {
        const state = stateWithTiredBase(1);
        const ab = state.airBases_()[0]!;
        expect(state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + 9 * MIN)).toBe('tired');
        expect(state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + 30 * MIN)).toBe('mild');
    });

    // 降級是逐段的：赤先確定回到橙，再回到無標記帶
    it('赤在待機(+4)下先降成橙（15 分）、再降成 mild（24 分）', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/base_air_corps', [{
            api_area_id: 6, api_rid: 1, api_name: '第一基地', api_action_kind: 0,
            api_distance: { api_base: 7, api_bonus: 0 },
            api_plane_info: [
                { api_squadron_id: 1, api_state: 1, api_slotid: 1, api_count: 18, api_max_count: 18, api_cond: 3 },
            ],
        }], undefined, T0);
        const ab = state.airBases_()[0]!;
        const at = (m: number) => state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + m * MIN);
        expect(at(14)).toBe('exhausted');
        expect(at(15)).toBe('tired');     // 0 + 4×5 tick = 20 → 確定進入橙帶
        expect(at(24)).toBe('mild');      // 0 + 4×8 tick = 32 → 確定回到無標記帶
    });

    // 札被中途改掉時取「這段期間最慢的速度」——用改完後的快札回算會提早抹掉疲勞
    it('休息→出撃改札後，以最慢的出撃速度計算', () => {
        const state = stateWithTiredBase(4);   // 休息 +8：本來 6 分就該回復
        state.applyEvent('api_req_air_corps/set_action', {}, {
            api_area_id: '6', api_base_id: '1', api_action_kind: '1',
        }, T0 + 1 * MIN);
        const ab = state.airBases_()[0]!;
        expect(state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + 9 * MIN)).toBe('tired');
    });

    // 新的封包＝新的觀測時刻，計時要重來（出撃完 cond 又掉下去的情形）
    it('收到新的 base_air_corps 會重設觀測時刻', () => {
        const state = stateWithTiredBase(0);
        state.applyEvent('api_get_member/base_air_corps', [{
            api_area_id: 6, api_rid: 1, api_name: '第一基地',
            api_action_kind: 0,
            api_distance: { api_base: 7, api_bonus: 0 },
            api_plane_info: [
                { api_squadron_id: 1, api_state: 1, api_slotid: 1, api_count: 18, api_max_count: 18, api_cond: 2 },
            ],
        }], undefined, T0 + 30 * MIN);
        const ab = state.airBases_()[0]!;
        expect(state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + 33 * MIN)).toBe('tired');
        expect(state.lbasCondStateNow(ab.squadrons[0]!.cond, ab, T0 + 39 * MIN)).toBe('mild');
    });

    // 沒有觀測時刻（例如舊 snapshot 重播前）就不做推論，維持封包原值
    it('condAsOf 為 null 時原樣回傳', () => {
        const state = new GameState();
        expect(state.lbasCondStateNow(2, { condAsOf: null, condRate: 4 }, T0)).toBe('tired');
    });
});

// ── 真封包（samples/mapinfo-air-base.json，2026-08-04 實機擷取） ──────────────
// 六個航空隊 24 個中隊全部 api_cond=0，且封包顯示全部補給完畢、遊戲畫面全無疲勞標記
// → **0 = 無標記**（同時證明 api_cond 是
// 顯示碼不是 0–46 原始值，否則 0 會是最慘的赤）。
describe('真封包 mapinfo 的基地航空隊', () => {
    const fixture = JSON.parse(
        readFileSync(new URL('../samples/mapinfo-air-base.json', import.meta.url), 'utf8'));

    function stateFromFixture() {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture.api, undefined, T0);
        return state;
    }

    it('六個航空隊全部讀得到，機數全滿', () => {
        const bases = stateFromFixture().airBases_();
        expect(bases.map(b => `${b.areaId}_${b.rid}`))
            .toEqual(['6_1', '6_2', '6_3', '7_1', '62_1', '62_2']);
        for (const ab of bases) {
            expect(ab.squadrons).toHaveLength(4);
            for (const sq of ab.squadrons) expect(sq.count).toBe(sq.maxCount);
        }
    });

    // 面板的「未補給」紅框判準（lbasNeedsAttention）在這份封包下必須是 false
    it('全部補給完畢時沒有任何中隊被判為未補給', () => {
        const bases = stateFromFixture().airBases_();
        expect(bases.some(ab => ab.squadrons.some(sq => sq.state === 1 && sq.count < sq.maxCount)))
            .toBe(false);
    });

    it('api_cond: 0 一律判為無疲勞（不是紅疲勞、也不是不明）', () => {
        const state = stateFromFixture();
        for (const ab of state.airBases_()) {
            for (const sq of ab.squadrons) {
                expect(sq.cond).toBe(0);
                expect(state.lbasCondState(sq.cond)).toBe('normal');
                expect(state.lbasCondStateNow(sq.cond, ab, T0 + 60 * MIN)).toBe('normal');
            }
        }
    });

    it('基地整備等級只在封包有給的海域成立，其餘維持不可考', () => {
        const state = stateFromFixture();
        expect(state.airBaseMaintenanceLevel(62)).toBe(3);
        expect(state.airBaseMaintenanceLevel(6)).toBeNull();
    });
});

// ── 輕度疲勞的樣本（samples/mapinfo-air-base-tired.json） ────────────────────
// 62_2 出撃後 api_cond 變成 1，其餘全 0。**1 與 0 一樣都不顯示遊戲標記**，
// 差別只在「全滿」與「已經有點累」——KC3Kai 也把這兩種畫成不同表情。
describe('真封包 mapinfo：api_cond 1 = 輕度疲勞（無標記）', () => {
    const fixture = JSON.parse(
        readFileSync(new URL('../samples/mapinfo-air-base-tired.json', import.meta.url), 'utf8'));

    function stateFromFixture() {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture.api, undefined, T0);
        return state;
    }

    it('cond 1 判為 mild，cond 0 判為 normal——兩者都不是「疲勞標記」', () => {
        const state = stateFromFixture();
        for (const ab of state.airBases_()) {
            const expected = ab.areaId === 62 && ab.rid === 2 ? 'mild' : 'normal';
            for (const sq of ab.squadrons) expect(state.lbasCondState(sq.cond)).toBe(expected);
        }
    });

    // mild 沒有可移除的標記，時間推論不動它（0 與 1 的分界無佐證，不能猜）
    it('mild 不隨時間降級（無佐證可推）', () => {
        const state = stateFromFixture();
        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        expect(state.lbasCondStateNow(base.squadrons[0]!.cond, base, T0 + 600 * MIN)).toBe('mild');
        expect(state.lbasCondCertaintyNow(base.squadrons[0]!.cond, base, T0 + 600 * MIN)).toBeNull();
    });

    // 此樣本的退避札（+3/tick）action_kind 為 3
    it('退避札(3)的回復速度為 +3/tick', () => {
        const base = stateFromFixture().airBases_().find(b => b.areaId === 62 && b.rid === 1)!;
        expect(base.actionKind).toBe(3);
        expect(base.condRate).toBe(3);
    });

});

// ── 橙的樣本（samples/mapinfo-air-base-exhausted.json） ─────────────────────────
// 62_2 再出撃一次後 api_cond 由 1 變成 2＝橙（黃臉）。
describe('真封包 mapinfo：api_cond 2 = 橙', () => {
    const fixture = JSON.parse(
        readFileSync(new URL('../samples/mapinfo-air-base-exhausted.json', import.meta.url), 'utf8'));

    function stateFromFixture() {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture.api, undefined, T0);
        return state;
    }

    it('cond 2 判為橙，其餘維持無標記', () => {
        const state = stateFromFixture();
        for (const ab of state.airBases_()) {
            const expected = ab.areaId === 62 && ab.rid === 2 ? 'tired' : 'normal';
            for (const sq of ab.squadrons) expect(state.lbasCondState(sq.cond)).toBe(expected);
        }
    });

    it('橙在出撃札下 29 分還不能斷定，30 分後降到無標記帶', () => {
        const state = stateFromFixture();
        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        expect(state.lbasCondStateNow(base.squadrons[0]!.cond, base, T0 + 29 * MIN)).toBe('tired');
        expect(state.lbasCondStateNow(base.squadrons[0]!.cond, base, T0 + 30 * MIN)).toBe('mild');
    });
});

// ── 赤的定案樣本（samples/mapinfo-air-base-red.json） ─────────────────────────
// 62_2 再出撃後 api_cond 變成 3，**使用者確認「紅臉、更疲勞」**；這筆樣本固定四段
// 對照：0=全滿、1=輕度、2=橙、3=赤。
describe('真封包 mapinfo：api_cond 3 = 赤', () => {
    const fixture = JSON.parse(
        readFileSync(new URL('../samples/mapinfo-air-base-red.json', import.meta.url), 'utf8'));

    function stateFromFixture() {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture.api, undefined, T0);
        return state;
    }

    it('cond 3 判為赤——不得再回到「不明」', () => {
        const state = stateFromFixture();
        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        for (const sq of base.squadrons) {
            expect(sq.cond).toBe(3);
            expect(state.lbasCondState(sq.cond)).toBe('exhausted');
            expect(state.lbasCondState(sq.cond)).not.toBe('unknown');
            expect(state.lbasCondLabel(sq.cond)).not.toBe('');
        }
    });

    // 出撃札（+1/tick）的赤：60 分確定回到橙帶、90 分確定回到無標記帶。
    // 逐段降級的意義在於：赤色狀態先經過橙色區間，再進入無標記區間。
    it('赤在出撃札下 60 分降成橙、90 分降到無標記帶', () => {
        const state = stateFromFixture();
        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        const at = (m: number) => state.lbasCondStateNow(base.squadrons[0]!.cond, base, T0 + m * MIN);
        expect(at(59)).toBe('exhausted');
        expect(at(60)).toBe('tired');
        expect(at(89)).toBe('tired');
        expect(at(90)).toBe('mild');
    });

    // 這一筆同時有機數耗損（17/18），未補給與疲勞是兩套獨立語意
    it('機數耗損與疲勞各自成立', () => {
        const base = stateFromFixture().airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        expect(base.squadrons[0]!.count).toBe(17);
        expect(base.squadrons.some(sq => sq.state === 1 && sq.count < sq.maxCount)).toBe(true);
    });
});

// ── mapinfo 就是對齊點 ────────────────────────────────────────────────────────
// 點「出擊→海域選擇」時遊戲會送帶完整 api_air_base（含 api_cond）的 mapinfo；正常遊玩流程
// 下，面板每次都會對齊，不必等時間推算。
// 這條路徑必須真的會覆蓋——用三份真封包（無標記→橙→赤）串起來驗證。
describe('連續 mapinfo 會把疲勞狀態對齊到最新', () => {
    const load = (name: string) =>
        JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8')).api;
    const NORMAL = load('mapinfo-air-base.json');            // cond 0：全滿
    const MILD = load('mapinfo-air-base-tired.json');        // cond 1：輕度（無標記）
    const TIRED = load('mapinfo-air-base-exhausted.json');   // cond 2：橙
    const EXHAUSTED = load('mapinfo-air-base-red.json');     // cond 3：赤

    /** 62_2（出撃札那一隊）目前的疲勞狀態 */
    function condOf(state: GameState, now: number) {
        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        return state.lbasCondStateNow(base.squadrons[0]!.cond, base, now);
    }

    // 四份封包呈現 62_2 從全滿 → 輕度 → 橙 → 赤的狀態序列（每多出撃一次往下一段）
    it('全滿 → 輕度 → 橙 → 赤 → 全滿，每一筆都跟著最新封包走', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', NORMAL, undefined, T0);
        expect(condOf(state, T0)).toBe('normal');

        state.applyEvent('api_get_member/mapinfo', MILD, undefined, T0 + 5 * MIN);
        expect(condOf(state, T0 + 5 * MIN)).toBe('mild');

        state.applyEvent('api_get_member/mapinfo', TIRED, undefined, T0 + 10 * MIN);
        expect(condOf(state, T0 + 10 * MIN)).toBe('tired');

        state.applyEvent('api_get_member/mapinfo', EXHAUSTED, undefined, T0 + 20 * MIN);
        expect(condOf(state, T0 + 20 * MIN)).toBe('exhausted');

        // 遊戲裡回復完了、再開一次海域選擇：面板立刻跟著回到無標記，
        // **不必等 90 分鐘的保守推算**（那只是沒有新封包時的退路）
        state.applyEvent('api_get_member/mapinfo', NORMAL, undefined, T0 + 25 * MIN);
        expect(condOf(state, T0 + 25 * MIN)).toBe('normal');
    });

    // 每一筆 mapinfo 都重設觀測時刻，否則「保證回復」的計時會用到過期的起點
    it('每次 mapinfo 都重設 condAsOf', () => {
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', TIRED, undefined, T0);
        state.applyEvent('api_get_member/mapinfo', TIRED, undefined, T0 + 25 * MIN);
        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        expect(base.condAsOf).toBe(T0 + 25 * MIN);
        // 從第一筆算已經 29 分（>30 分才保證回復的門檻仍未到，因為計時從第二筆重來）
        expect(state.lbasCondStateNow(base.squadrons[0]!.cond, base, T0 + 29 * MIN)).toBe('tired');
        expect(state.lbasCondStateNow(base.squadrons[0]!.cond, base, T0 + 55 * MIN)).toBe('mild');
    });
});

// ── 「可能已回復」的把握程度分級 ──────────────────────────────────────────────
// 封包只給三段顯示碼，收到時只知道值落在一個區間（橙＝20–29）。出撃札（+1/tick）下：
// 3 分鐘就**可能**退掉、30 分鐘才**保證**退掉；中間回傳 'possiblyRecovered'，面板淡化表現。
describe('lbasCondCertainty', () => {
    it('橙在出撃札(+1)：0–3 分確定、3–30 分存疑、30 分後必定已退', () => {
        expect(lbasCondCertainty(2, 1, 0)).toBe('certain');
        expect(lbasCondCertainty(2, 1, 3 * MIN - 1)).toBe('certain');
        expect(lbasCondCertainty(2, 1, 3 * MIN)).toBe('possiblyRecovered');
        expect(lbasCondCertainty(2, 1, 29 * MIN)).toBe('possiblyRecovered');
        expect(lbasCondCertainty(2, 1, 30 * MIN)).toBe('clear');
    });

    it('赤在出撃札(+1)：要 33 分才可能退到無標記、90 分才保證', () => {
        expect(lbasCondCertainty(3, 1, 30 * MIN)).toBe('certain');
        expect(lbasCondCertainty(3, 1, 33 * MIN)).toBe('possiblyRecovered');
        expect(lbasCondCertainty(3, 1, 90 * MIN)).toBe('clear');
    });

    it('休息札(+8)回復快，一個 tick 就進入存疑區', () => {
        expect(lbasCondCertainty(2, 8, 3 * MIN - 1)).toBe('certain');
        expect(lbasCondCertainty(2, 8, 3 * MIN)).toBe('possiblyRecovered');
        expect(lbasCondCertainty(2, 8, 6 * MIN)).toBe('clear');
    });

    it('沒有標記或未知碼回 null', () => {
        for (const cond of [0, 1, 4, null]) expect(lbasCondCertainty(cond, 4, 60 * MIN)).toBeNull();
    });

    // clear 與既有的 lbasCondCertainlyClear 必須是同一條線，兩支不得漂移
    it('clear 的時點與 lbasCondCertainlyClear 完全一致', () => {
        for (const cond of [2, 3]) {
            for (const rate of [1, 2, 3, 4, 8]) {
                for (let m = 0; m <= 95; m++) {
                    const age = m * MIN;
                    expect(lbasCondCertainty(cond, rate, age) === 'clear')
                        .toBe(lbasCondCertainlyClear(cond, rate, age));
                }
            }
        }
    });
});

describe('GameState.lbasCondCertaintyNow', () => {
    it('真封包的橙：剛收到是確定，過 3 分鐘變存疑，30 分後標記消失', () => {
        const fixture = JSON.parse(
            readFileSync(new URL('../samples/mapinfo-air-base-exhausted.json', import.meta.url), 'utf8'));
        const state = new GameState();
        state.applyEvent('api_get_member/mapinfo', fixture.api, undefined, T0);
        const base = state.airBases_().find(b => b.areaId === 62 && b.rid === 2)!;
        const cond = base.squadrons[0]!.cond;

        expect(state.lbasCondCertaintyNow(cond, base, T0 + 1 * MIN)).toBe('certain');
        expect(state.lbasCondCertaintyNow(cond, base, T0 + 5 * MIN)).toBe('possiblyRecovered');
        expect(state.lbasCondStateNow(cond, base, T0 + 5 * MIN)).toBe('tired');   // 標記仍在
        expect(state.lbasCondCertaintyNow(cond, base, T0 + 30 * MIN)).toBe('clear');
        expect(state.lbasCondStateNow(cond, base, T0 + 30 * MIN)).toBe('mild');   // 無標記帶
    });
});
