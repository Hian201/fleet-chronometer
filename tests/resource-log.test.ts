// 資源紀錄的分析核心與折線幾何。重點在「缺席不得被 0 頂替」與「抽稀不得磨掉陡降」——
// 那道陡降正是一次活動燒掉十萬燃料的樣子，是這張圖唯一要看的東西。
import { describe, expect, it } from 'vitest';
import type { ResourceMarkRow, ResourceRow } from '../utils/db';
import {
    bucketSamples, buildEventPeriods, delta, downsample, localDayKey, normalizeSamples,
    sampleAt, toCsv, type Sample,
} from '../utils/resource-log';
import { multiChartGeometry, nearestIndex, niceTicks, type ChartBox } from '../utils/line-chart';

const HOUR = 3_600_000;
const row = (eventId: number, ts: number, fuel: number): ResourceRow =>
    ({ eventId, ts, m: [fuel, 2, 3, 4, 5, 6, 7, 8] });
const at = (ts: number, fuel: number): Sample => ({ ts, m: [fuel, 2, 3, 4, 5, 6, 7, 8] });

describe('normalizeSamples', () => {
    it('依時間升冪，殘缺列（不足八項）直接丟掉', () => {
        const rows = [row(3, 300, 30), row(1, 100, 10), { eventId: 2, ts: 200, m: [1, 2] } as ResourceRow];
        expect(normalizeSamples(rows).map(s => s.ts)).toEqual([100, 300]);
    });

    it('同一毫秒兩筆時取較新的 eventId（後到的觀測才是最後狀態）', () => {
        const samples = normalizeSamples([row(1, 100, 10), row(2, 100, 99)]);
        expect(samples).toHaveLength(1);
        expect(samples[0].m[0]).toBe(99);
    });
});

describe('sampleAt / delta', () => {
    const samples = [at(100, 10), at(200, 20), at(300, 30)];

    it('取當下（含）之前最近的一筆', () => {
        expect(sampleAt(samples, 250)?.ts).toBe(200);
        expect(sampleAt(samples, 200)?.ts).toBe(200);
        expect(sampleAt(samples, 300)?.ts).toBe(300);
    });

    it('第一筆之前一律 null＝不可考，不回退到第一筆', () => {
        expect(sampleAt(samples, 99)).toBeNull();
        expect(sampleAt([], 100)).toBeNull();
    });

    it('任一端缺席時 delta 為 null，不以 0 頂替', () => {
        expect(delta(samples[0], samples[2])![0]).toBe(20);
        expect(delta(null, samples[2])).toBeNull();
        expect(delta(samples[0], null)).toBeNull();
    });
});

describe('bucketSamples', () => {
    const samples = [at(0, 100), at(HOUR / 2, 90), at(HOUR, 80), at(HOUR * 2, 70)];

    it('raw 原樣返回', () => expect(bucketSamples(samples, 'raw')).toEqual(samples));

    it('每小時只留該小時的最後一筆（餘額取平均沒有意義）', () => {
        expect(bucketSamples(samples, 'hour').map(s => s.m[0])).toEqual([90, 80, 70]);
    });

    it('每日依本地時區切，不用 UTC——玩家的「今天」是本地日期', () => {
        const morning = new Date(2026, 6, 22, 1, 0, 0).getTime();
        const night = new Date(2026, 6, 22, 23, 0, 0).getTime();
        const nextDay = new Date(2026, 6, 23, 1, 0, 0).getTime();
        const daily = bucketSamples([at(morning, 100), at(night, 60), at(nextDay, 50)], 'day');
        expect(daily.map(s => s.m[0])).toEqual([60, 50]);
        expect(localDayKey(morning)).toBe('2026-07-22');
    });
});

describe('downsample', () => {
    it('點數在上限內時原樣返回', () => {
        const samples = [at(0, 1), at(10, 2)];
        expect(downsample(samples, 10)).toEqual(samples);
    });

    it('首尾一定保留', () => {
        const samples = Array.from({ length: 500 }, (_, i) => at(i * 1000, 1000 - i));
        const out = downsample(samples, 50);
        expect(out.length).toBeLessThanOrEqual(52);
        expect(out[0]).toEqual(samples[0]);
        expect(out[out.length - 1]).toEqual(samples[samples.length - 1]);
    });

    // 抽稀是「純減量」：輸出的每一筆都必須是原始樣本本人。做成移動平均之類的平滑，
    // 會把一次活動燒掉十萬燃料的那道陡降磨圓——那正是這張圖唯一要看的東西。
    it('不平滑：輸出的每一筆都是原始樣本，陡降後的水位原樣還在', () => {
        const before = Array.from({ length: 200 }, (_, i) => at(i * 1000, 300_000 - i * 10));
        const after = Array.from({ length: 200 }, (_, i) => at(200_000 + i * 1000, 120_000 - i * 10));
        const out = downsample([...before, ...after], 100);
        const originals = new Set([...before, ...after].map(s => `${s.ts}:${s.m[0]}`));
        expect(out.every(s => originals.has(`${s.ts}:${s.m[0]}`))).toBe(true);
        // 陡降之後的水位要看得到（沒有被前後桶平均成一條緩坡）
        expect(out.some(s => s.ts >= 200_000 && s.m[0] <= 120_000)).toBe(true);
        expect(out.some(s => s.ts < 200_000 && s.m[0] > 250_000)).toBe(true);
    });
});

describe('buildEventPeriods', () => {
    const samples = [at(1_000, 300_000), at(2_000, 250_000), at(3_000, 180_000), at(4_000, 120_000)];
    const marks: ResourceMarkRow[] = [
        { key: 'open:621', kind: 'stage-open', mapKey: 621, ts: 1_000, eventId: 1 },
        { key: 'clear:621#0', kind: 'gauge-clear', mapKey: 621, ts: 2_000, eventId: 2, seq: 0 },
        { key: 'clear:622#0', kind: 'gauge-clear', mapKey: 622, ts: 3_000, eventId: 3, seq: 0 },
        // 守衛不是里程碑，不得出現在區段裡
        { key: 'seen:623', kind: 'gauge-seen', mapKey: 623, ts: 3_500, eventId: 4 },
    ];

    it('依 area 分群、依時間排序，gauge-seen 不計入', () => {
        const [period] = buildEventPeriods(marks, samples);
        expect(period.area).toBe(62);
        expect(period.milestones.map(m => `${m.kind}${m.mapNo}`)).toEqual(['open1', 'clear1', 'clear2']);
    });

    it('每段消耗＝相鄰兩個里程碑的餘額差；第一段沒有前一個時間點', () => {
        const [period] = buildEventPeriods(marks, samples);
        expect(period.segments[0].from).toBeNull();
        expect(period.segments[1].delta![0]).toBe(-50_000);   // 300000 → 250000
        expect(period.segments[2].delta![0]).toBe(-70_000);   // 250000 → 180000
        expect(period.total![0]).toBe(-120_000);
    });

    it('里程碑之前完全沒有取樣時整段標成不可考，不猜 0', () => {
        const [period] = buildEventPeriods(marks, [at(3_000, 180_000)]);
        expect(period.milestones[0].sample).toBeNull();
        expect(period.total).toBeNull();
    });

    it('多次活動各自成群，最近的排前面', () => {
        const older: ResourceMarkRow = { key: 'open:611', kind: 'stage-open', mapKey: 611, ts: 100, eventId: 0 };
        expect(buildEventPeriods([...marks, older], samples).map(p => p.area)).toEqual([62, 61]);
    });
});

describe('toCsv', () => {
    it('欄位跟著顯示欄位走，消長各自一欄；缺席寫空白不寫 0', () => {
        const csv = toCsv(
            [{ ts: 0, m: [10, 20, 30, 40, 50, 60, 70, 80], d: null },
            { ts: 1_000, m: [5, 20, 30, 40, 50, 60, 70, 80], d: [-5, 0, 0, 0, 0, 0, 0, 0] }],
            [0, 7], { time: '時間', mats: ['燃料', '彈藥', '鋼材', '鋁土', '高建', '桶', '開發', '螺絲'] }, true,
        );
        const lines = csv.split('\n');
        expect(lines[0]).toBe('時間,燃料,燃料 Δ,螺絲,螺絲 Δ');
        expect(lines[1].endsWith(',10,,80,')).toBe(true);
        expect(lines[2].endsWith(',5,-5,80,0')).toBe(true);
    });

    it('含逗號的欄名要跳脫', () => {
        expect(toCsv([], [0], { time: 'a,b', mats: ['c'] }, false).split('\n')[0]).toBe('"a,b",c');
    });
});

describe('折線幾何', () => {
    const box: ChartBox = { width: 200, height: 50, padTop: 5, padBottom: 5, padLeft: 0, padRight: 0 };
    const series = (key: number, values: number[]) => ({ key, values });

    it('x 依時間比例、不是等距索引（取樣本來就不等距）', () => {
        const geo = multiChartGeometry([0, 900, 1000], [series(0, [1, 2, 3])], 0, 1000, box);
        expect(geo.xs).toEqual([0, 180, 200]);
    });

    it('最大值貼上緣、最小值貼下緣', () => {
        const geo = multiChartGeometry([0, 1000], [series(0, [10, 20])], 0, 1000, box);
        expect(geo.series[0].points.map(p => p.y)).toEqual([45, 5]);
    });

    // 這是「一張圖多條線」能成立的關鍵：關掉燃料之後，螺絲那條要撐滿整張圖，
    // 而不是繼續被十萬級壓在底部。故值域**只看傳進來的序列**。
    it('y 值域只看傳進來的序列——關掉大宗資源，剩下的線就撐滿', () => {
        const both = multiChartGeometry([0, 1000], [
            series(0, [300_000, 200_000]), series(7, [620, 600]),
        ], 0, 1000, box);
        expect(both.min).toBe(600);
        expect(both.max).toBe(300_000);
        // 螺絲那條被壓在底部（兩點的 y 幾乎相同）
        const screwBoth = both.series[1].points.map(p => p.y);
        expect(Math.abs(screwBoth[0] - screwBoth[1])).toBeLessThan(1);

        const alone = multiChartGeometry([0, 1000], [series(7, [620, 600])], 0, 1000, box);
        expect(alone.min).toBe(600);
        expect(alone.max).toBe(620);
        expect(alone.series[0].points.map(p => p.y)).toEqual([5, 45]);
    });

    it('多條線共用同一組 x 座標（十字準線靠這點一次對齊全部）', () => {
        const geo = multiChartGeometry([0, 500, 1000], [series(0, [1, 2, 3]), series(3, [9, 8, 7])], 0, 1000, box);
        expect(geo.series[0].points.map(p => p.x)).toEqual(geo.xs);
        expect(geo.series[1].points.map(p => p.x)).toEqual(geo.xs);
    });

    it('序列的 key 原樣保留——顏色靠它對回資材，不能因為開關而重新分配', () => {
        const geo = multiChartGeometry([0, 1000], [series(3, [1, 2]), series(7, [3, 4])], 0, 1000, box);
        expect(geo.series.map(s => s.key)).toEqual([3, 7]);
    });

    it('整段沒動過的序列不會貼在框邊變成看不見', () => {
        const geo = multiChartGeometry([0, 1000], [series(0, [500, 500])], 0, 1000, box);
        expect(geo.min).toBeLessThan(500);
        expect(geo.max).toBeGreaterThan(500);
        expect(geo.series[0].points.every(p => p.y > box.padTop && p.y < box.height - box.padBottom)).toBe(true);
    });

    it('少於兩點不畫線（改由呼叫端畫單點）', () => {
        expect(multiChartGeometry([0], [series(0, [5])], 0, 1000, box).series[0].line).toBe('');
    });

    it('niceTicks 只給 1/2/2.5/5×10^n，且落在範圍內', () => {
        expect(niceTicks(0, 100, 2)).toEqual([0, 50, 100]);
        expect(niceTicks(12, 87, 3)).toEqual([25, 50, 75]);
        expect(niceTicks(5, 5)).toEqual([]);
    });

    it('nearestIndex 取最近的樣本', () => {
        expect(nearestIndex([0, 50, 100], 51)).toBe(1);
        expect(nearestIndex([0, 50, 100], 90)).toBe(2);
        expect(nearestIndex([], 10)).toBe(-1);
    });
});
