import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeBattle } from '../utils/battle';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));

describe('對空 CI 發動明細', () => {
    it('保留 Type、api_idx 對應的艦位與 api_use_items 裝備組合', () => {
        const packet = load('6-5-ec_battle.json');
        const view = analyzeBattle([packet], { main: [], escort: [] }, {
            playerAaciShips: {
                main: [
                    { id: 101, masterId: 1 }, { id: 102, masterId: 2 },
                    { id: 103, masterId: 3 }, { id: 104, masterId: 4 },
                    { id: 105, masterId: 5 }, { id: 106, masterId: 6 },
                ],
                escort: [],
            },
        });

        expect(view.aaci).toBe(2);
        expect(view.aaciDetails).toEqual([{
            type: 2,
            fleet: 'main',
            position: 6,
            shipId: 106,
            shipMst: 6,
            gearMst: [533, 450],
        }]);
    });

    it('連合艦隊 api_idx 7 會對到隨伴第二艦，而不是主隊第七艦', () => {
        const packet = load('61-3.json').battles[1].data;
        const view = analyzeBattle([packet], { main: [], escort: [] }, {
            playerAaciShips: {
                main: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, masterId: i + 1 })),
                escort: Array.from({ length: 6 }, (_, i) => ({ id: i + 7, masterId: i + 7 })),
            },
        });

        expect(view.aaci).toBe(34);
        expect(view.aaciDetails[0]).toMatchObject({
            type: 34,
            fleet: 'escort',
            position: 2,
            shipId: 8,
            shipMst: 8,
            gearMst: [308, 308],
        });
    });

    it('api_idx 0 會對到單艦隊第一艦，符合公開封包的 0-based 索引', () => {
        const packet = load('6-5-ec_battle.json');
        packet.api_kouku.api_stage2.api_air_fire.api_idx = 0;
        const view = analyzeBattle([packet], { main: [], escort: [] }, {
            playerAaciShips: {
                main: [
                    { id: 101, masterId: 1 }, { id: 102, masterId: 2 },
                    { id: 103, masterId: 3 }, { id: 104, masterId: 4 },
                    { id: 105, masterId: 5 }, { id: 106, masterId: 6 },
                ],
                escort: [],
            },
        });

        expect(view.aaciDetails[0]).toMatchObject({
            fleet: 'main', position: 1, shipId: 101, shipMst: 1,
        });
    });

    it('沒有 api_air_fire 時不產生虛構明細', () => {
        const packet = {
            api_f_nowhps: [10], api_f_maxhps: [10],
            api_e_nowhps: [10], api_e_maxhps: [10], api_ship_ke: [1501],
        };
        const view = analyzeBattle([packet], { main: [], escort: [] });
        expect(view.aaci).toBe(0);
        expect(view.aaciDetails).toEqual([]);
    });

    it('沒有出擊快照時不把 api_idx 猜成主隊或隨伴艦位', () => {
        const packet = load('6-5-ec_battle.json');
        const view = analyzeBattle([packet], { main: [], escort: [] });

        expect(view.aaciDetails[0]).toMatchObject({
            type: 2,
            fleet: 'unknown',
            position: 0,
            gearMst: [533, 450],
        });
        expect(view.aaciDetails[0]).not.toHaveProperty('shipId');
        expect(view.aaciDetails[0]).not.toHaveProperty('shipMst');
    });
});
