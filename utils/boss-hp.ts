import type { ReplayRow, SortieLogRow } from './db';

function packetBossHp(packet: unknown): number | null {
    if (!packet || typeof packet !== 'object') return null;
    const values = (packet as { api_e_maxhps?: unknown }).api_e_maxhps;
    if (!Array.isArray(values)) return null;
    const hp = Number(values[0]);
    return Number.isSafeInteger(hp) && hp > 0 ? hp : null;
}

/**
 * 從仍保留的本機出擊紀錄恢復某海域已實戰觀測到的最高 Boss 旗艦 HP。
 *
 * 同一活動海域可能有多個 color=5 的 Boss 節點；較低 HP 的旁支 Boss 不得覆蓋已經
 * 觀測到的較高斬殺線。Boss 身分只採本機 sorties 的 `boss` 封包事實，外部匯入資料
 * 不拿來推導目前遊戲狀態。
 */
export function maxObservedBossHp(
    replays: readonly ReplayRow[],
    sorties: readonly SortieLogRow[],
    mapArea: number,
    mapNo: number,
): number | null {
    const map = `${mapArea}-${mapNo}`;
    const bossBattles = new Set(
        sorties
            .filter(row => !row.imported && row.boss && row.map === map)
            .map(row => `${row.sortieKey}:${row.node}`),
    );
    let max: number | null = null;
    for (const replay of replays) {
        if (replay.imported || replay.world !== mapArea || replay.mapnum !== mapNo) continue;
        for (const battle of replay.battles ?? []) {
            if (!bossBattles.has(`${replay.sortieKey}:${battle.node}`)) continue;
            const hp = packetBossHp(battle.data) ?? packetBossHp(battle.yasen);
            if (hp != null && (max == null || hp > max)) max = hp;
        }
    }
    return max;
}
