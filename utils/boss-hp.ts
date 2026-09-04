import type { ReplayRow, SortieLogRow } from './db';

function packetBossHp(packet: unknown): number | null {
    if (!packet || typeof packet !== 'object') return null;
    const values = (packet as { api_e_maxhps?: unknown }).api_e_maxhps;
    if (!Array.isArray(values)) return null;
    const hp = Number(values[0]);
    return Number.isSafeInteger(hp) && hp > 0 ? hp : null;
}

/**
 * 回傳重播列對目前難度／血條的身分精確度；`null` 表示明確不相符。
 * `0` 代表舊資料沒有保存任何身分，只有在沒有更精確候選時才能相容回退。
 */
export function bossHpReplaySpecificity(
    replay: ReplayRow,
    diff?: number,
    gaugeNum?: number,
): number | null {
    if (gaugeNum === undefined) {
        // 目前不知道血條身分時，不把已標記其他血條的資料混進來。
        if (replay.gaugeNum !== undefined) return null;
    } else if (replay.gaugeNum !== undefined && replay.gaugeNum !== gaugeNum) {
        return null;
    }
    // diff=0 是舊重播的「未保存難度」，不是可用來排除目前難度的證據。
    if (diff != null && replay.diff !== diff && replay.diff !== 0) return null;
    const gaugeExact = gaugeNum !== undefined && replay.gaugeNum === gaugeNum;
    const diffExact = diff != null && replay.diff === diff;
    // 血條身分比難度更能排除活動破甲回打的舊 Boss。
    return (gaugeExact ? 4 : 0) + (diffExact ? 2 : 0);
}

/**
 * 從仍保留的本機出擊紀錄恢復某海域同一條血條的 Boss baseHp。
 *
 * 目前血條先以 `gaugeNum`／難度與 `bossCellNo` 對齊；同一目標 Boss 的較低最終形態
 * 向下更新 baseHp。舊重播沒有目標節點身分時，以所有可相容的 Boss 觀測值取最大值，
 * 避免破甲回打的較低 HP 舊 Boss 把現行斬殺線向下污染。缺席身分的舊資料只在沒有
 * 更精確候選時回退使用；外部匯入資料不拿來推導目前遊戲狀態。
 */
export function observedBossHp(
    replays: readonly ReplayRow[],
    sorties: readonly SortieLogRow[],
    mapArea: number,
    mapNo: number,
    diff?: number,
    gaugeNum?: number,
): number | null {
    const map = `${mapArea}-${mapNo}`;
    const bossBattles = new Set(
        sorties
            .filter(row => !row.imported && row.boss && row.map === map
                && (row.nodeEventId === undefined || row.nodeEventId === 5))
            .map(row => `${row.sortieKey}:${row.node}`),
    );
    // `diff=0` 與缺席 `gaugeNum` 都代表舊重播未保存該身分，不是可拿來和已知值
    // 直接比較的真實難度／血條。先找身分最完整的候選；只有沒有精確候選時，才退回
    // 未知欄位的舊資料，保留舊版本已存在的斬殺線而不讓不同血條互相倒灌。
    const candidates: { replay: ReplayRow; specificity: number }[] = [];
    for (const replay of replays) {
        if (replay.imported || replay.world !== mapArea || replay.mapnum !== mapNo) continue;
        const specificity = bossHpReplaySpecificity(replay, diff, gaugeNum);
        if (specificity == null) continue;
        candidates.push({ replay, specificity });
    }

    const specificityLevels = [...new Set(candidates.map(candidate => candidate.specificity))]
        .sort((left, right) => right - left);
    for (const level of specificityLevels) {
        let exactBaseHp: number | null = null;
        let legacyBaseHp: number | null = null;
        for (const candidate of candidates) {
            if (candidate.specificity !== level) continue;
            const { replay } = candidate;
            const bossCellNo = Number(replay.bossCellNo);
            const hasBossCell = Number.isSafeInteger(bossCellNo) && bossCellNo > 0;
            for (const battle of replay.battles ?? []) {
                if (!bossBattles.has(`${replay.sortieKey}:${battle.node}`)) continue;
                if (hasBossCell && battle.node !== bossCellNo) continue;
                const hp = packetBossHp(battle.data) ?? packetBossHp(battle.yasen);
                if (hp == null) continue;
                if (hasBossCell) exactBaseHp = exactBaseHp == null ? hp : Math.min(exactBaseHp, hp);
                else legacyBaseHp = legacyBaseHp == null ? hp : Math.max(legacyBaseHp, hp);
            }
        }
        if (exactBaseHp != null || legacyBaseHp != null) return exactBaseHp ?? legacyBaseHp;
    }
    return null;
}
