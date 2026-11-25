// 秋刀魚祭的任務鏈與限量兌換所需尾數（純函式；無 chrome.*／DOM）。資料與來源見 docs/saury-plan.md §2.4。
//
// 持有任務（受注時檢查持有數、不消耗）與消耗（工廠任務、限量兌換）分開算：
// 持有任務都做完才開始消耗時，全部所需 = max(最大持有門檻, 消耗合計)。順序反過來會多要魚，
// 所以介面要提醒「最高持有任務完成前先別消耗」。刺身、塩焼沒有次數上限，不列入。

export type SauryStepKind = 'hold' | 'exercise' | 'consume' | 'exchange';

export interface SauryStep {
    /** 玩家勾選（已換／不做）存檔的鍵。 */
    id: string;
    kind: SauryStepKind;
    /** 任務 api_no；兌換沒有。 */
    quest?: number;
    /** hold：持有門檻；consume／exchange：每次消耗尾數；exercise 為 0。 */
    fish: number;
    /** 次數上限（兌換）；任務為 1。 */
    times: number;
}

/** 每季的步驟，依建議順序排列。新一季公告任務後新增一列；沒有資料的季不顯示任務鏈。 */
export const SAURY_CHAINS: Readonly<Record<string, readonly SauryStep[]>> = {
    // 2026：任務與前置依ぜかまし 2026-11-24～25 實測與 wikiwiki 任務頁留言；兌換尾數與次數依ぜかまし基本資訊頁
    // （蒲焼 2 次、秋刀魚カレー改二偵 1 次）。866 → 369 → 867 → 868／1110，1110 → 1144。
    '2026': [
        { id: 'q866', kind: 'hold', quest: 866, fish: 8, times: 1 },
        { id: 'q369', kind: 'exercise', quest: 369, fish: 0, times: 1 },
        { id: 'q867', kind: 'hold', quest: 867, fish: 16, times: 1 },
        { id: 'q868', kind: 'hold', quest: 868, fish: 27, times: 1 },
        { id: 'q1110', kind: 'consume', quest: 1110, fish: 8, times: 1 },
        { id: 'q1144', kind: 'consume', quest: 1144, fish: 20, times: 1 },
        { id: 'curry', kind: 'exchange', fish: 27, times: 1 },
        { id: 'kabayaki', kind: 'exchange', fish: 7, times: 2 },
    ],
};

export interface SauryNeed {
    /** 還沒完成的持有任務中最高的門檻；都完成為 0。 */
    hold: number;
    /** 還沒完成、也沒勾掉的消耗合計。 */
    consume: number;
    /** 從現在起手上要經手的尾數：max(hold, consume)。 */
    need: number;
    /** 還要再撈幾尾；持有數不可考時為 null。 */
    toCatch: number | null;
}

/**
 * done：已完成的任務步驟 id；marked：玩家勾掉的次數（已兌換或不做），超出範圍會夾到 0～times。
 * 全部步驟都沒完成、也沒勾掉時，need 就是做完整季的最少尾數。
 */
export function sauryNeed(
    steps: readonly SauryStep[],
    done: ReadonlySet<string>,
    marked: Readonly<Record<string, number>>,
    held: number | null,
): SauryNeed {
    let hold = 0, consume = 0;
    for (const s of steps) {
        if (done.has(s.id)) continue;
        if (s.kind === 'hold') hold = Math.max(hold, s.fish);
        else if (s.kind === 'consume' || s.kind === 'exchange') {
            const off = Math.min(s.times, Math.max(0, Math.floor(marked[s.id] ?? 0)));
            consume += s.fish * (s.times - off);
        }
    }
    const need = Math.max(hold, consume);
    return { hold, consume, need, toCatch: held === null ? null : Math.max(0, need - held) };
}

const MARKS_KEY = 'kc-saury-chain';

/** 玩家勾選：{ 季: { 步驟 id: 次數 } }。格式不符的部分丟掉。 */
export function loadSauryMarks(season: string): Record<string, number> {
    try {
        const raw = JSON.parse(localStorage.getItem(MARKS_KEY) ?? 'null')?.[season];
        if (!raw || typeof raw !== 'object') return {};
        return Object.fromEntries(Object.entries(raw).filter(([, n]) => Number.isSafeInteger(n) && (n as number) > 0)) as Record<string, number>;
    } catch {
        return {};
    }
}

export function saveSauryMarks(season: string, marks: Readonly<Record<string, number>>): void {
    try {
        const all = JSON.parse(localStorage.getItem(MARKS_KEY) ?? 'null');
        const next = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
        next[season] = Object.fromEntries(Object.entries(marks).filter(([, n]) => n > 0));
        localStorage.setItem(MARKS_KEY, JSON.stringify(next));
    } catch { /* 隱私模式等：靜默 */ }
}
