import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReplayCardModel, replayExportStem } from '../utils/replay-card';
import { GameState } from '../utils/state';
import type { ReplayRow } from '../utils/db';
import { setLang, t } from '../utils/ui-i18n';

const master = JSON.parse(readFileSync(new URL('../samples/start2-master.json', import.meta.url), 'utf8'));
const sample = JSON.parse(readFileSync(new URL('../samples/61-5-jibun-rengou-node52.json', import.meta.url), 'utf8'));

const state = new GameState();

beforeAll(() => {
    setLang('zh-TW');
    state.applyEvent('api_start2/getData', master);
});

function row(): ReplayRow {
    return {
        sortieKey: 27236,
        ts: sample.time * 1000,
        world: sample.world,
        mapnum: sample.mapnum,
        diff: sample.diff,
        combined: sample.combined,
        fleetnum: sample.fleetnum,
        fleet1: sample.fleet1,
        fleet2: sample.fleet2,
        battles: sample.battles,
        nickname: '暁の水平線',
    };
}

describe('buildReplayCardModel', () => {
    it('編成只留艦名，不含等級、編號、rank', () => {
        const card = buildReplayCardModel(row(), mst => state.shipName(mst));
        expect(card.hq).toBe('暁の水平線');
        expect(card.map).toBe('E5');
        expect(card.diff).toBe(t('ov.slDiff4'));
        expect(card.combined).toBe(t('ov.slCombinedSurface'));
        expect(card.fleet1).toContain('大和改二重');
        expect(card.fleet2).toContain('朝霜改二');
        expect(card.fleet1.join(' ')).not.toMatch(/\b99\b|\b164\b/);
        expect(card.nodes.map(n => n.letter)).toEqual(['A', 'E', 'I', 'Q', 'Y', 'Z', 'ZZ']);
        expect(card.nodes.at(-1)?.last).toBe(true);
        expect(replayExportStem(row())).toBe('replay-61-5-27236');
    });

    it('缺提督名時明講不詳，不拿數字佔位', () => {
        const card = buildReplayCardModel({ ...row(), nickname: undefined }, mst => state.shipName(mst));
        expect(card.hq).toBe(t('ov.replayHqUnknown'));
    });
});
