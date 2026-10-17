// 出擊重播分享卡的可見層資料（純函式，無 DOM）。
// 編成只留艦名：論壇縮圖要靠字級讀得清楚，不放編號、等級、rank、艦種。
import type { ReplayRow } from './db';
import { formatDate } from './date-format';
import { eventTermLabel } from './event-calendar';
import { nodeLabel } from './map-node-letters';
import { eventStageLabel, isEventWorld } from './sortie-detail';
import { t } from './ui-i18n';

const COMBINED_KEYS = ['', 'ov.slCombinedCarrier', 'ov.slCombinedSurface', 'ov.slCombinedTransport'];

export interface ReplayCardNode {
    letter: string;
    last: boolean;
}

export interface ReplayCardModel {
    brand: string;
    hq: string;
    combined: string;
    date: string;
    event: string;
    map: string;
    diff: string;
    fleet1Title: string;
    fleet2Title: string;
    fleet1: string[];
    fleet2: string[];
    nodes: ReplayCardNode[];
    hint: string;
}

function combinedLabel(combined: number, mainCount: number): string {
    if (combined > 0) return t(COMBINED_KEYS[combined] || 'ov.slCombinedShort');
    return t(mainCount === 7 ? 'ov.slStrikingForce' : 'ov.slSingleFleet');
}

export function buildReplayCardModel(
    row: ReplayRow,
    shipName: (mst: number) => string,
): ReplayCardModel {
    const map = `${row.world}-${row.mapnum}`;
    const event = isEventWorld(row.world);
    const names = (fleet: ReplayRow['fleet1']) => fleet.map(s => shipName(s.mst_id));
    const battles = row.battles ?? [];
    return {
        brand: t('ov.brandShort'),
        hq: row.nickname?.trim() || t('ov.replayHqUnknown'),
        combined: combinedLabel(row.combined, row.fleet1.length),
        date: formatDate(row.ts),
        event: eventTermLabel(row.world, t) ?? '',
        map: event ? eventStageLabel(row.mapnum) : map,
        diff: row.diff > 0 ? t(`ov.slDiff${row.diff}` as 'ov.slDiff4') : '',
        fleet1Title: row.combined > 0 ? t('ov.slMainFleet') : t('ov.slFleet'),
        fleet2Title: t('ov.slEscortFleet'),
        fleet1: names(row.fleet1),
        fleet2: row.combined > 0 ? names(row.fleet2) : [],
        nodes: battles.map((b, i) => ({
            letter: nodeLabel(map, b.node),
            last: i === battles.length - 1,
        })),
        hint: t('ov.replayCardHint'),
    };
}

export function replayExportStem(row: ReplayRow): string {
    return `replay-${row.world}-${row.mapnum}-${row.sortieKey}`;
}
