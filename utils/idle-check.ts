// 登出前閒置檢查：指出「哪個標籤裡有空著的產能」。純函式，無 chrome.*／DOM。
// 只回傳數字，細節由玩家點進對應分組看；不排程、不通知（docs/engineering/fleet-status.md「登出前閒置檢查」）。

import { questCycleWindow } from './quest-cycle';
import type { QuestPeriod } from './quest-flow';
import { planAnchorageRepair, planMoraleSupply } from './repair';
import type { GameState } from './state';

const HOUR_MS = 60 * 60 * 1000;

export interface IdleMarks {
    /** 第 2–4 艦隊中有艦、沒出遠征（含支援）、不在出擊、也沒在泊地修理或給糧的隊數。 */
    exped: number;
    /** 有空渠又有可入渠的待修艦時，可以馬上填滿的渠數；否則 0。 */
    dock: number;
    /** 已達成未領獎、且會在下一次 05:00 JST 換期時被清掉的任務數。 */
    quests: number;
    /** 本輪演習剩餘場數；換輪後尚未觀測到新清單時為 null（不可考）。 */
    practice: number | null;
}

/**
 * 演習對手清單的輪次編號：03:00 與 15:00 JST（UTC 18:00、06:00）換新。
 * 同一個編號＝同一輪清單。
 */
export function practiceRound(ts: number): number {
    return Math.floor((ts - 6 * HOUR_MS) / (12 * HOUR_MS));
}

/** 下一次演習清單換新的時刻（毫秒）。 */
export function nextPracticeReset(ts: number): number {
    return (practiceRound(ts) + 1) * 12 * HOUR_MS + 6 * HOUR_MS;
}

// questlist 的 api_type：1 每日、2 每週、3 每月（quest-flow.ts API_TYPE_PERIOD 同一對照）；
// 5 只有帶年任換期月（api_label_type 101–112）時才能確定是年任。季任等其他週期不猜。
function questPeriod(apiType: number | undefined, yearlyMonth: number | undefined): QuestPeriod | null {
    if (apiType === 1) return 'daily';
    if (apiType === 2) return 'weekly';
    if (apiType === 3) return 'monthly';
    if (apiType === 5 && yearlyMonth !== undefined) return 'yearly';
    return null;
}

export function idleMarks(state: GameState, now: number): IdleMarks {
    // 出擊中的艦隊；連合艦隊從第 1 艦隊出擊時第 2 艦隊同行。
    const sortieDecks = new Set<number>();
    if (state.sortieInfo) {
        sortieDecks.add(state.currentSortieFleetId);
        if (state.combinedFlag > 0 && state.currentSortieFleetId === 0) sortieDecks.add(1);
    }

    let exped = 0;
    const fleets = state.fleets();
    state.decks.forEach((deck, i) => {
        if (i < 1 || i > 3 || !deck) return;
        // 連合艦隊編成中的第 2 艦隊不能出遠征，不算閒置。
        if (i === 1 && state.combinedFlag > 0) return;
        const hasShip = (deck.api_ship ?? []).some((id: number) => id > 0);
        // 泊地修理或給糧運作中（面板「泊地」分組有列）的艦隊是在做事，不算閒置。
        const fleet = fleets[i];
        const upkeep = !!fleet && (planAnchorageRepair(fleet).active || planMoraleSupply(fleet).active);
        if (hasShip && !(deck.api_mission?.[0] > 0) && !sortieDecks.has(i) && !upkeep) exped++;
    });

    const emptyDocks = state.ndockSlots().filter(slot => slot.state === 0).length;
    const repairable = state.damagedShips()
        .filter(ship => !ship.onExpedition && !(ship.fleet !== null && sortieDecks.has(ship.fleet - 1)))
        .length;
    const dock = Math.min(emptyDocks, repairable);

    const nextReset = questCycleWindow('daily', now)?.end;
    const yearlyMonths = state.questYearlyResetMonths_();
    let quests = 0;
    for (const [no, quest] of state.quests) {
        if (!quest.done) continue;
        const period = questPeriod(quest.apiType, yearlyMonths.get(no));
        const cycle = period && questCycleWindow(period, now, yearlyMonths.get(no));
        // 換期後還沒重開任務清單時，記著的「達成」屬於上一期，遊戲已經清掉了。
        const seenAt = state.questSeenText_(no)?.ts;
        if (cycle && cycle.end === nextReset && seenAt !== undefined && seenAt >= cycle.start) quests++;
    }

    const list = state.practiceList_();
    const practice = list && practiceRound(list.ts) === practiceRound(now)
        ? Math.max(0, list.opponents.filter(o => o.state === 0 && !o.fought).length - list.battlesSince)
        : null;

    return { exped, dock, quests, practice };
}
