// inspired by KC3Kai, MIT：使用公開模擬器的設定備份契約（CONVERT.loadSave），
// 讓跳轉停在可編輯介面。hash 若是 `{ fleetF, nodes }` 會走 initSimImport 立刻開跑。
import { LZMA } from 'lzma/src/lzma_worker.js';
import {
    buildSortieSimulator,
    type SortieSimulatorEquip, type SortieSimulatorFleet, type SortieSimulatorInput,
    type SortieSimulatorOptions, type SortieSimulatorShip,
} from './sortie-simulator';
import type { ReplayRow } from './db';

/** 與 KC3Kai CONVERT._SAVE_VERSION_CURRENT 相同；低於此值會再做一次深海裝備 id 位移。 */
const SIMULATOR_SAVE_VERSION = 2;

function equipment(equip: SortieSimulatorEquip) {
    return { mstId: equip.masterId, level: equip.improve ?? 0, rank: equip.proficiency ?? 0 };
}

function shipSettings(ship: SortieSimulatorShip) {
    const statsBase: Record<string, number> = {};
    for (const [source, target] of Object.entries({ FP: 'fp', TP: 'tp', AA: 'aa', AR: 'ar', EV: 'ev', ASW: 'asw', LOS: 'los', LUK: 'luk' } as const)) {
        const value = ship.stats?.[source as keyof NonNullable<SortieSimulatorShip['stats']>];
        if (typeof value === 'number') statsBase[target] = value;
    }
    return {
        mstId: ship.masterId,
        ...(ship.LVL === undefined ? {} : { level: ship.LVL }),
        ...(ship.stats?.HP === undefined ? {} : { hp: ship.stats.HP }),
        ...(ship.HPInit === undefined ? {} : { hpInit: ship.HPInit }),
        ...(ship.morale === undefined ? {} : { morale: ship.morale }),
        ...(ship.isFaraway === undefined ? {} : { isFaraway: ship.isFaraway }),
        statsBase,
        equips: (ship.equips ?? []).map(equipment),
    };
}

function fleetSettings(fleet: SortieSimulatorFleet, enemy = false) {
    return {
        version: SIMULATOR_SAVE_VERSION,
        type: enemy ? (fleet.shipsC?.length ? 1 : 0) : (fleet.combineType || (fleet.ships.length >= 7 ? 7 : 0)),
        ...(fleet.formation === undefined ? {} : { formation: fleet.formation }),
        ships: fleet.ships.map(shipSettings),
        ...(fleet.shipsC ? { shipsEscort: fleet.shipsC.map(shipSettings) } : {}),
    };
}

export function buildSimulatorSettings(input: SortieSimulatorInput) {
    return {
        version: SIMULATOR_SAVE_VERSION,
        fleetFMain: fleetSettings(input.fleetF),
        ...(input.fleetSupportN ? { fleetFSupportN: fleetSettings(input.fleetSupportN) } : {}),
        ...(input.fleetSupportB ? { fleetFSupportB: fleetSettings(input.fleetSupportB) } : {}),
        useSupportN: !!input.fleetSupportN,
        useSupportB: !!input.fleetSupportB,
        ...(input.lbas ? { landBases: input.lbas.map(base => base && ({ slots: [...base.slots], equips: base.equips.map(equipment) })) } : {}),
        battles: input.nodes.map(node => {
            const lbasWaves = [false, false, false, false, false, false];
            for (const baseId of node.lbas ?? []) {
                const first = 2 * (baseId - 1);
                const index = lbasWaves[first] ? first + 1 : first;
                if (index >= 0 && index < lbasWaves.length) lbasWaves[index] = true;
            }
            return {
                ...(node.formationOverride === undefined ? {} : { formation: node.formationOverride }),
                nodeType: node.airRaid ? 6 : node.airOnly ? 4 : node.NBOnly ? 2 : 1,
                doNB: !!node.doNB,
                subOnly: !!node.noAmmo,
                useNormalSupport: node.useNormalSupport ? 1 : 0,
                lbasWaves,
                enemyComps: [{ rate: 0, fleet: fleetSettings(node.fleetE, true) }],
            };
        }),
        settings: { airRaidCostW6: input.world === 6 },
        // 模擬器忽略來源中繼資料；下載設定檔時仍可查對原始路線與未能編入的節點。
        fleetChronometer: { ...input.fleetChronometer, world: input.world, mapnum: input.mapnum },
    };
}

export function toSortieSimulatorUrl(row: ReplayRow, options: SortieSimulatorOptions = {}): string {
    return simulatorSettingsUrl(buildSimulatorSettings(buildSortieSimulator(row, options)));
}

export function simulatorSettingsUrl(settings: ReturnType<typeof buildSimulatorSettings>): string {
    // backup fragment 要求 LZMA-alone＋標準 Base64；不可使用播放器的 LZString 格式。
    const bytes = LZMA.compress(JSON.stringify(settings), 1);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte & 255);
    return `https://kc3kai.github.io/kancolle-replay/simulator.html#backup=${btoa(binary)}`;
}

/** 測試與除錯用：把 `#backup=` 還原成設定物件。 */
export function decodeSimulatorSettingsUrl(url: string): ReturnType<typeof buildSimulatorSettings> {
    const marker = '#backup=';
    const index = url.indexOf(marker);
    if (index < 0) throw new Error('simulator settings URL 缺少 #backup=');
    const binary = atob(url.slice(index + marker.length));
    const bytes = Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(LZMA.decompress(bytes));
}
