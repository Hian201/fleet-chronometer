import { afterEach, describe, expect, it } from 'vitest';
import { expedDisplayName, expedItemDisplayName, expedItemFullName, setLang } from '../utils/ui-i18n';

const EXPECTED_EN: Record<number, string> = {
    1: 'Navigation Practice',
    2: 'Long Distance Navigation Practice',
    3: 'Defense Mission',
    4: 'Anti-Submarine Mission',
    5: 'Maritime Escort Mission',
    6: 'Air Defense Shooting Practice',
    7: 'Naval Review Rehearsal',
    8: 'Naval Review',
    9: 'Tanker Escort Mission',
    10: 'Enforced Reconnaissance Mission',
    11: 'Bauxite Transport Mission',
    12: 'Resource Transport Mission',
    13: 'Rat Transport Operation',
    14: 'Marine Siege Evacuation Operation',
    15: 'Decoy Naval Task Force Support Operation',
    16: 'Decisive Battle Fleet Support Operation',
    17: 'Enemy Territory Reconnaissance Operation',
    18: 'Aircraft Transport Operation',
    19: 'Operation Kita',
    20: 'Submarine Patrol Operation',
    21: 'Northern Rat Transport Operation',
    22: 'Fleet Exercise',
    23: 'Aviation Battleship Exercise Operation',
    24: 'Northern Maritime Sea Passage Escort',
    25: 'Commerce Raid Operation',
    26: 'Enemy Homeport Air-Raid Operation',
    27: 'Submarine Commerce Raid Operation',
    28: 'Western Waters Blockade Operation',
    29: 'Submarine Dispatch Exercise',
    30: 'Submarine Dispatch Operation',
    31: 'Contact with Foreign Ships',
    32: 'High Seas Practice',
    33: 'Vanguard Support Mission',
    34: 'Decisive Battle Fleet Support Mission',
    35: 'Operation MO',
    36: 'Seaplane Base Construction',
    37: 'Tokyo Express',
    38: 'Tokyo Express (2)',
    39: 'Deep Sea Submarine Operation',
    40: 'Seaplane Front Line Transport',
    41: 'Brunei Anchorage Patrol',
    42: 'Mi Convoy Escort (Fleet No.1)',
    43: 'Mi Convoy Escort (Fleet No.2)',
    44: 'Aircraft Equipment Transport Mission',
    45: 'Bauxite Convoy Escort',
    46: 'Southwestern Sea Combat Patrols',
    100: 'Supply Line Strengthening Mission',
    101: 'Strait Defense Line',
    102: 'Long Term Anti-Submarine Mission',
    103: 'SouthWestern Connection Line Patrol',
    104: 'Ogasawara Coastal Patrol Line',
    105: 'Ogasawara Coastal Combat Patrol',
    110: 'South Western Air Reconnaissance Operation',
    111: 'Enemy Harbor Assault Counter Attack Operation',
    112: 'Nansei Island Remote Island Patrolling Operation',
    113: 'Nansei Island Remote Island Defense Operation',
    114: 'Nansei Island Search and Destroy Mission',
    115: 'Elite Destroyer Squadron Night Raid',
    131: 'Western Sea Reconnaissance Operation',
    132: 'Western Submarine Operation',
    133: 'Contact with Friendly European Forces',
    141: 'Rabaul District Fleet Advance',
    142: 'Enforced Rat Transport Operation',
};

const EXPECTED_ITEM_EN = {
    1: { short: 'Repair Bucket', full: 'Instant Repair Material' },
    2: { short: 'Instant Build', full: 'Instant Construction Material' },
    3: { short: 'Dev. Mat.', full: 'Development Material' },
    4: { short: 'Furn. Box S', full: 'Furniture Box (Small)' },
    5: { short: 'Furn. Box M', full: 'Furniture Box (Medium)' },
    6: { short: 'Furn. Box L', full: 'Furniture Box (Large)' },
    7: { short: 'Imp. Mat.', full: 'Improvement Material' },
    10: { short: 'Furn. Box S', full: 'Furniture Box (Small)' },
    11: { short: 'Furn. Box M', full: 'Furniture Box (Medium)' },
    12: { short: 'Furn. Box L', full: 'Furniture Box (Large)' },
    59: { short: 'Irako', full: 'Food Supply Ship Irako' },
} as const;

describe('遠征名稱本地化', () => {
    afterEach(() => setLang('ja'));

    it('英文介面涵蓋目前 master mission 的英文名稱', () => {
        setLang('en');
        for (const [missionId, expected] of Object.entries(EXPECTED_EN)) {
            expect(expedDisplayName(Number(missionId), `原名${missionId}`), missionId).toBe(expected);
        }
    });

    it('活動支援遠征保留英文名稱並附加既有支援註記', () => {
        setLang('en');
        expect(expedDisplayName(301, '前衛支援任務')).toBe('Vanguard Support Mission（Event route support）');
        expect(expedDisplayName(302, '艦隊決戦支援任務')).toBe('Decisive Battle Fleet Support Mission（Event boss support）');
    });

    it('英文介面使用遠征 Wiki 的精簡獎勵名稱，完整名稱保留供提示查閱', () => {
        setLang('en');
        for (const [itemType, expected] of Object.entries(EXPECTED_ITEM_EN)) {
            const rawName = `原始物品${itemType}`;
            expect(expedItemDisplayName(Number(itemType), rawName), itemType).toBe(expected.short);
            expect(expedItemFullName(Number(itemType), rawName), itemType).toBe(expected.full);
        }
    });

    it('未知遠征與非英文介面維持原始封包名稱', () => {
        setLang('en');
        expect(expedDisplayName(999, '未收錄遠征')).toBe('未收錄遠征');
        expect(expedItemDisplayName(999, '未收錄物品')).toBe('未收錄物品');
        expect(expedItemFullName(999, '未收錄物品')).toBe('未收錄物品');

        setLang('zh-TW');
        expect(expedDisplayName(2, '長距離練習航海')).toBe('長距離練習航海');
        expect(expedItemDisplayName(7, '改修資材')).toBe('改修資材');
        expect(expedItemFullName(7, '改修資材')).toBe('改修資材');
    });
});
