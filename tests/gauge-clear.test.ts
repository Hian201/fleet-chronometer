// 量表與斬殺戰鬥當下純函式測試（utils/gauge-clear.ts）。
// 涵蓋真封包（6-5、61-5、61-4）與 KC3Kai 形狀的合成資料（api_landing_hp）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeBattle } from '../utils/battle';
import {
    computePostBattleGauge,
    evaluateBattleGaugeClear,
    extractFlagshipOutcome,
    gaugeEstimateMismatch,
    isGaugeZeroed,
    parseBattleResultGaugeFields,
    parsePacketInt,
    type GaugeViewLike,
} from '../utils/gauge-clear';

const loadSample = (name: string) =>
    JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));

const noDamecons = { main: [], escort: [] };

const makeGauge = (overrides: Partial<GaugeViewLike> = {}): GaugeViewLike => ({
    cleared: false,
    gaugeType: 2,
    defeatCount: 0,
    requiredDefeatCount: 0,
    nowHp: 2400,
    maxHp: 4800,
    selectedRank: 4,
    gaugeNum: 2,
    source: 'server',
    ...overrides,
});

describe('parsePacketInt 與 parseBattleResultGaugeFields', () => {
    it('數字與純數字字串皆可解析，拒絕空白、負數、小數與非數字', () => {
        expect(parsePacketInt(0, 0)).toBe(0);
        expect(parsePacketInt('0', 0)).toBe(0);
        expect(parsePacketInt('250', 1)).toBe(250);
        expect(parsePacketInt(' 75 ', 1)).toBe(75);
        expect(parsePacketInt(0, 1)).toBeUndefined();
        expect(parsePacketInt('0', 1)).toBeUndefined();
        expect(parsePacketInt('', 0)).toBeUndefined();
        expect(parsePacketInt('-1', 0)).toBeUndefined();
        expect(parsePacketInt('12.5', 0)).toBeUndefined();
        expect(parsePacketInt('250pt', 0)).toBeUndefined();
        expect(parsePacketInt(null, 0)).toBeUndefined();
        expect(parsePacketInt(undefined, 0)).toBeUndefined();
    });

    it('真封包：6-5 擊破前與擊破場 battleresult 解析（並核對 api_first_clear）', () => {
        const before = loadSample('6-5-battleresult-before-clear.json').api_data;
        const clear = loadSample('6-5-battleresult-clear.json').api_data;

        expect(parseBattleResultGaugeFields(before)).toEqual({
            firstClear: 0,
        });
        expect(parseBattleResultGaugeFields(clear)).toEqual({
            exmapRate: 250,
            firstClear: 1,
        });
    });

    it('合成資料（依 KC3Kai src/library/objects/Node.js 形狀）：api_landing_hp 同時接受字串與數字', () => {
        const asStrings = parseBattleResultGaugeFields({
            api_landing_hp: {
                api_now_hp: '320',
                api_max_hp: '500',
                api_sub_value: '98',
            },
            api_first_clear: 0,
        });
        expect(asStrings).toEqual({
            firstClear: 0,
            landing: { now: 320, max: 500, sub: 98 },
        });

        const asNumbers = parseBattleResultGaugeFields({
            api_landing_hp: {
                api_now_hp: 90,
                api_max_hp: 500,
                api_sub_value: 98,
            },
        });
        expect(asNumbers).toEqual({
            landing: { now: 90, max: 500, sub: 98 },
        });

        // 欄位不全或 maxHp 為 0 時視為無效，不寫入
        expect(parseBattleResultGaugeFields({
            api_landing_hp: { api_now_hp: '90', api_max_hp: '0', api_sub_value: '98' },
        })).toEqual({});
    });
});

describe('extractFlagshipOutcome（含真封包、0 傷與孤立夜戰）', () => {
    it('真封包：61-5 與 61-4 Boss 晝+夜分析結果算出敵主隊旗艦受傷量與擊沉', () => {
        for (const [sampleName, expectedBegin] of [
            ['61-5-jibun-rengou-node52.json', 1200],
            ['61-4.json', 930],
        ] as const) {
            const sample = loadSample(sampleName);
            const boss = sample.battles[sample.battles.length - 1];
            const info = analyzeBattle([boss.data, boss.yasen], noDamecons);
            const outcome = extractFlagshipOutcome(info.resultFleets);
            // 兩份樣本 Boss 皆為 S 勝擊沉敵旗艦，整場受傷量等於開戰滿血
            expect(outcome).toEqual({ flagshipSunk: true, flagshipDamage: expectedBegin });
        }
    });

    it('真封包：6-5 ec_battle 敵主隊旗艦擊沉結果與 battleresult api_destsf 一致', () => {
        const battle = loadSample('6-5-ec_battle.json');
        const result = loadSample('6-5-ec_result.json');
        const info = analyzeBattle([battle], noDamecons);
        const outcome = extractFlagshipOutcome(info.resultFleets);
        expect(outcome.flagshipSunk).toBe(result.api_destsf === 1);
    });

    it('真封包：僅看晝戰（未擊沉）算出實際受傷量且 flagshipSunk 為 false', () => {
        const sample = loadSample('61-5-jibun-rengou-node52.json');
        const boss = sample.battles[sample.battles.length - 1];
        const dayOnly = analyzeBattle([boss.data], noDamecons);
        const outcome = extractFlagshipOutcome(dayOnly.resultFleets);
        // 61-5 晝戰結束後敵旗艦剩 425（由 1200 扣 775）
        expect(outcome).toEqual({ flagshipSunk: false, flagshipDamage: 1200 - 425 });
    });

    it('敵主隊旗艦 0 傷害時 flagshipDamage 明確回傳 0（不是 undefined）', () => {
        const outcome = extractFlagshipOutcome({
            playerMain: [],
            playerEscort: [],
            enemyMain: [{ hp: 800, maxHp: 800, beginHp: 800, damecon: 0, sunk: false, dealtDamage: 0 }],
            enemyEscort: [{ hp: 0, maxHp: 100, beginHp: 100, damecon: 0, sunk: true, dealtDamage: 0 }],
        });
        expect(outcome).toEqual({ flagshipSunk: false, flagshipDamage: 0 });
    });

    it('孤立夜戰接續包（missingDayStart）保留 flagshipSunk 但不寫 flagshipDamage', () => {
        const sample = loadSample('61-5-jibun-rengou-node52.json');
        const boss = sample.battles[sample.battles.length - 1];
        const isolatedNight = analyzeBattle([boss.yasen], noDamecons);
        const outcome = extractFlagshipOutcome(isolatedNight.resultFleets, { missingDayStart: true });
        expect(outcome).toEqual({ flagshipSunk: true });
        expect('flagshipDamage' in outcome).toBe(false);
    });
});

describe('evaluateBattleGaugeClear（§5.2 斬殺判定）', () => {
    it('EO 整圖通關：6-5 真封包 exmapRate > 0 直接判定通關（不依賴量表狀態），未擊破場為 false', () => {
        const mapinfo = loadSample('6-5-mapinfo-before-clear.json').api_data;
        const m65 = mapinfo.api_map_info.find((m: any) => m.api_id === 65);
        const gauge65 = makeGauge({
            cleared: false,
            gaugeType: m65.api_gauge_type,
            defeatCount: m65.api_defeat_count,
            requiredDefeatCount: m65.api_required_defeat_count,
            nowHp: 0,
            maxHp: 0,
            selectedRank: 0,
            gaugeNum: m65.api_gauge_num,
        });

        const clearFields = parseBattleResultGaugeFields(loadSample('6-5-battleresult-clear.json').api_data);
        expect(evaluateBattleGaugeClear({
            gauge: null,
            atGaugeBoss: false,
            ...clearFields,
        })).toBe(true);
        // 核對 api_first_clear 與判定結果一致
        expect(clearFields.firstClear).toBe(1);

        // 6-5 未擊破場（5/6 之前，例如 4/6 時）不應判定通關
        const beforeFields = parseBattleResultGaugeFields(loadSample('6-5-battleresult-before-clear.json').api_data);
        expect(evaluateBattleGaugeClear({
            gauge: { ...gauge65, defeatCount: 4 },
            atGaugeBoss: true,
            flagshipSunk: true,
            ...beforeFields,
        })).toBe(false);
        expect(beforeFields.firstClear).toBe(0);
    });

    it('擊破數式：最後一擊（defeatCount === required - 1 且旗艦擊沉）判定斬殺；已通關 7-2（3/4）不誤標', () => {
        const mapinfo = loadSample('6-5-mapinfo-before-clear.json').api_data;
        const m72 = mapinfo.api_map_info.find((m: any) => m.api_id === 72);

        // 1-5 或 7-5 P1 無 exmapRate 時的最後一擊
        expect(evaluateBattleGaugeClear({
            gauge: makeGauge({ gaugeType: 1, defeatCount: 3, requiredDefeatCount: 4, nowHp: 0, maxHp: 0 }),
            atGaugeBoss: true,
            flagshipSunk: true,
        })).toBe(true);

        // 沒沉旗艦不標
        expect(evaluateBattleGaugeClear({
            gauge: makeGauge({ gaugeType: 1, defeatCount: 3, requiredDefeatCount: 4, nowHp: 0, maxHp: 0 }),
            atGaugeBoss: true,
            flagshipSunk: false,
        })).toBe(false);

        // 非目標 Boss 點（破甲回打舊 Boss）不標
        expect(evaluateBattleGaugeClear({
            gauge: makeGauge({ gaugeType: 1, defeatCount: 3, requiredDefeatCount: 4, nowHp: 0, maxHp: 0 }),
            atGaugeBoss: false,
            flagshipSunk: true,
        })).toBe(false);

        // 樣本中已通關的 7-2（api_cleared=1、api_defeat_count=3/4）絕不誤標
        expect(evaluateBattleGaugeClear({
            gauge: makeGauge({
                cleared: m72.api_cleared === 1,
                gaugeType: m72.api_gauge_type,
                defeatCount: m72.api_defeat_count,
                requiredDefeatCount: m72.api_required_defeat_count,
                nowHp: 0,
                maxHp: 0,
            }),
            atGaugeBoss: true,
            flagshipSunk: true,
        })).toBe(false);
    });

    it('HP 式：61-5 最終段（809/8400）擊沉 1200 HP 旗艦判定斬殺；未擊沉或傷害不足不標；type=0 不標', () => {
        const s615 = loadSample('61-5-jibun-rengou-node52.json');
        const ev = s615.eventmap;
        const gauge = makeGauge({
            cleared: ev.api_cleared === 1,
            gaugeType: ev.api_gauge_type,
            nowHp: ev.api_now_maphp,
            maxHp: ev.api_max_maphp,
            gaugeNum: ev.api_gauge_num,
        });
        const gaugeAtStart = {
            type: ev.api_gauge_type,
            now: ev.api_now_maphp,
            max: ev.api_max_maphp,
            gaugeNum: ev.api_gauge_num,
        };

        // 擊沉且傷害 ≥ 809 → 斬殺
        expect(evaluateBattleGaugeClear({
            gauge, atGaugeBoss: true, gaugeAtStart, flagshipSunk: true, flagshipDamage: 1200,
        })).toBe(true);

        // 傷害超過 809 但沒沉（例如 Boss 1200 打 900 剩 300）→ 停在 1，不斬殺
        expect(evaluateBattleGaugeClear({
            gauge, atGaugeBoss: true, gaugeAtStart, flagshipSunk: false, flagshipDamage: 900,
        })).toBe(false);

        // 孤立夜戰缺 flagshipDamage → 不可考，交給後備
        expect(evaluateBattleGaugeClear({
            gauge, atGaugeBoss: true, gaugeAtStart, flagshipSunk: true,
        })).toBe(false);

        // gaugeAtStart.type === 0（未知量表種類）不誤當 HP
        expect(evaluateBattleGaugeClear({
            gauge, atGaugeBoss: true, gaugeAtStart: { ...gaugeAtStart, type: 0 },
            flagshipSunk: true, flagshipDamage: 1200,
        })).toBe(false);
    });

    it('TP 式（合成資料）：sub > 0 且 now - sub <= 0 判定斬殺；sub=0 或已通關不標', () => {
        const tpGauge = makeGauge({ gaugeType: 3, nowHp: 90, maxHp: 500 });
        expect(evaluateBattleGaugeClear({
            gauge: tpGauge, atGaugeBoss: true, landing: { now: 90, max: 500, sub: 98 },
        })).toBe(true);
        expect(evaluateBattleGaugeClear({
            gauge: tpGauge, atGaugeBoss: true, landing: { now: 120, max: 500, sub: 98 },
        })).toBe(false);
        expect(evaluateBattleGaugeClear({
            gauge: tpGauge, atGaugeBoss: true, landing: { now: 0, max: 500, sub: 0 },
        })).toBe(false);
        expect(evaluateBattleGaugeClear({
            gauge: { ...tpGauge, cleared: true }, atGaugeBoss: true, landing: { now: 90, max: 500, sub: 98 },
        })).toBe(false);
    });
});

describe('computePostBattleGauge、isGaugeZeroed 與 gaugeEstimateMismatch', () => {
    it('HP 式未歸零扣減並標 estimate；最終段未擊沉停在 1；擊沉歸 0 但不設 cleared', () => {
        const gauge = makeGauge({ gaugeType: 2, nowHp: 809, maxHp: 8400, gaugeNum: 4 });
        const start = { type: 2, now: 809, max: 8400, gaugeNum: 4 };

        // 打 500 未沉 → 309（estimate）
        const partial = computePostBattleGauge(gauge, {
            atGaugeBoss: true, gaugeAtStart: start, flagshipSunk: false, flagshipDamage: 500,
        })!;
        expect(partial.nowHp).toBe(309);
        expect(partial.source).toBe('estimate');
        expect(partial.cleared).toBe(false);

        // 打 900 未沉 → floor 在 1（estimate）
        const floored = computePostBattleGauge(gauge, {
            atGaugeBoss: true, gaugeAtStart: start, flagshipSunk: false, flagshipDamage: 900,
        })!;
        expect(floored.nowHp).toBe(1);
        expect(floored.source).toBe('estimate');
        expect(floored.cleared).toBe(false);
        expect(isGaugeZeroed(floored)).toBe(false);

        // 擊沉打 1200 → 歸 0，不設 cleared: true，但 isGaugeZeroed 為 true
        const broken = computePostBattleGauge(gauge, {
            atGaugeBoss: true, gaugeAtStart: start, flagshipSunk: true, flagshipDamage: 1200,
        })!;
        expect(broken.nowHp).toBe(0);
        expect(broken.source).toBe('server');
        expect(broken.cleared).toBe(false);
        expect(isGaugeZeroed(broken)).toBe(true);

        // gaugeAtStart.type === 0 不做 HP 扣量推算
        const unknownType = computePostBattleGauge(gauge, {
            atGaugeBoss: true, gaugeAtStart: { ...start, type: 0 }, flagshipSunk: false, flagshipDamage: 500,
        })!;
        expect(unknownType).toEqual(gauge);
    });

    it('擊破數式遞增標 estimate；達標不設 cleared（除非同時有 exmapRate > 0）', () => {
        const gauge = makeGauge({
            gaugeType: 1, defeatCount: 2, requiredDefeatCount: 4, nowHp: 0, maxHp: 0, selectedRank: 0,
        });

        const step = computePostBattleGauge(gauge, { atGaugeBoss: true, flagshipSunk: true })!;
        expect(step.defeatCount).toBe(3);
        expect(step.source).toBe('estimate');
        expect(step.cleared).toBe(false);

        // 7-5 P1 中間段最後一擊（無 exmapRate）
        const phaseClear = computePostBattleGauge(step, { atGaugeBoss: true, flagshipSunk: true })!;
        expect(phaseClear.defeatCount).toBe(4);
        expect(phaseClear.cleared).toBe(false);
        expect(isGaugeZeroed(phaseClear)).toBe(true);

        // EO 整圖通關（有 exmapRate）才設 cleared: true
        const eoClear = computePostBattleGauge(step, {
            atGaugeBoss: true, flagshipSunk: true, exmapRate: 75,
        })!;
        expect(eoClear.defeatCount).toBe(4);
        expect(eoClear.cleared).toBe(true);
        expect(eoClear.source).toBe('server');
    });

    it('TP 式帶 api_landing_hp 以伺服器事實更新 nowHp（source: server），不設 cleared', () => {
        const gauge = makeGauge({ gaugeType: 3, nowHp: 320, maxHp: 500, gaugeNum: 1 });
        const mid = computePostBattleGauge(gauge, {
            atGaugeBoss: true, landing: { now: 320, max: 500, sub: 98 },
        })!;
        expect(mid.nowHp).toBe(222);
        expect(mid.source).toBe('server');
        expect(mid.cleared).toBe(false);

        const done = computePostBattleGauge(mid, {
            atGaugeBoss: true, landing: { now: 90, max: 500, sub: 98 },
        })!;
        expect(done.nowHp).toBe(0);
        expect(done.source).toBe('server');
        expect(done.cleared).toBe(false);
        expect(isGaugeZeroed(done)).toBe(true);
    });

    it('真封包：5-6 第一段一般海域 TP 以已登陸量更新，與登陸後的 mapinfo 一致且不寫 nowHp／maxHp', () => {
        const mapinfoBefore = loadSample('6-5-mapinfo-before-clear.json').api_data.api_map_info;
        const mapinfoAfter = loadSample('5-6-mapinfo-after-landing.json').api_data.api_map_info;
        const result = loadSample('5-6-1-battleresult-landing.json').api_data;
        const m56Before = mapinfoBefore.find((m: { api_id: number }) => m.api_id === 56);
        const m56After = mapinfoAfter.find((m: { api_id: number }) => m.api_id === 56);
        expect(m56Before).toMatchObject({ api_gauge_type: 3, api_defeat_count: 0, api_required_defeat_count: 280 });
        expect(m56After).toMatchObject({ api_gauge_type: 3, api_defeat_count: 79, api_required_defeat_count: 280 });

        const fields = parseBattleResultGaugeFields(result);
        // 通常艦隊的結算回傳數字；api_now_hp 是戰前剩餘量（280 = 上限，本月首次登陸）。
        expect(fields).toEqual({ firstClear: 0, landing: { now: 280, max: 280, sub: 79 } });
        // 中間段沒有 EO 戰果值，不會被當成整圖通關。
        expect(result.api_get_exmap_rate).toBe(0);

        const gauge = makeGauge({
            gaugeType: 3, defeatCount: 0, requiredDefeatCount: 280, nowHp: 0, maxHp: 0, selectedRank: 0, gaugeNum: 1,
        });
        const input = { atGaugeBoss: true, flagshipSunk: true, landing: fields.landing };
        expect(evaluateBattleGaugeClear({ gauge, ...input })).toBe(false);
        const post = computePostBattleGauge(gauge, input)!;
        expect(post).toMatchObject({
            defeatCount: m56After.api_defeat_count,
            requiredDefeatCount: m56After.api_required_defeat_count,
            nowHp: 0,
            maxHp: 0,
            source: 'server',
            cleared: false,
        });
        expect(isGaugeZeroed(post)).toBe(false);

        // 最後一次登陸把剩餘量打到 0：判定打掉該段，量表視為歸零但不設整圖通關。
        const finalInput = { atGaugeBoss: true, flagshipSunk: true, landing: { now: 42, max: 280, sub: 79 } };
        const nearlyDone = { ...post, defeatCount: 238 };
        expect(evaluateBattleGaugeClear({ gauge: nearlyDone, ...finalInput })).toBe(true);
        const done = computePostBattleGauge(nearlyDone, finalInput)!;
        expect(done).toMatchObject({ defeatCount: 280, requiredDefeatCount: 280, cleared: false });
        expect(isGaugeZeroed(done)).toBe(true);
    });

    it('gaugeEstimateMismatch 只在同段推算與伺服器值不符時回報差異', () => {
        const estHp = makeGauge({ gaugeType: 2, nowHp: 1800, maxHp: 4800, gaugeNum: 2, source: 'estimate' });
        const srvSame = makeGauge({ gaugeType: 2, nowHp: 1800, maxHp: 4800, gaugeNum: 2, source: 'server' });
        const srvDiff = makeGauge({ gaugeType: 2, nowHp: 1750, maxHp: 4800, gaugeNum: 2, source: 'server' });
        const srvNextPhase = makeGauge({ gaugeType: 2, nowHp: 3200, maxHp: 3200, gaugeNum: 3, source: 'server' });

        expect(gaugeEstimateMismatch(estHp, srvSame)).toBeNull();
        expect(gaugeEstimateMismatch(estHp, srvDiff)).toEqual({
            gaugeType: 2, gaugeNum: 2, estimate: 1800, server: 1750,
        });
        expect(gaugeEstimateMismatch(estHp, srvNextPhase)).toBeNull();
        expect(gaugeEstimateMismatch({ ...estHp, source: 'server' }, srvDiff)).toBeNull();
        expect(gaugeEstimateMismatch(estHp, { ...srvDiff, cleared: true })).toBeNull();
    });
});
