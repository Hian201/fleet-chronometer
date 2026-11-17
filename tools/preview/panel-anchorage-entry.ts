// panel-anchorage 預覽的瀏覽器端入口：以正式 mountGeneral 顯示母港「泊地」分組（修理＋全域給糧計時）。
import { mountGeneral } from '../../entrypoints/panel/general';
import { GameState } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';
import '../../utils/state-display';

const params = new URLSearchParams(location.search);
const lang = (['zh-TW', 'ja', 'en'].includes(params.get('lang') ?? '') ? params.get('lang') : 'zh-TW') as Parameters<typeof setLang>[0];
setLang(lang);
document.documentElement.lang = lang;
if (params.has('theme')) document.documentElement.dataset.theme = params.get('theme')!;

// 假設情境：?min= 距給糧計時重置的分鐘數（預設 31＝已累積 2 次）；?unknown 為計時不可考。
const MIN = 60_000;
const now = Date.now();
const anchor = now - Number(params.get('min') ?? 31) * MIN;
const ship = (id: number, mst: number, cond: number, hp = 40) => ({
    api_id: id, api_ship_id: mst, api_lv: 99, api_nowhp: hp, api_maxhp: 40, api_cond: cond, api_ndock_time: 600_000,
    api_slot: [], api_slot_ex: -1, api_kyouka: [], api_fuel: 10, api_bull: 10,
});
const state = new GameState();
state.applyEvent('api_port/port', {
    api_ship: [
        ship(1, 187, 49), ship(2, 996, 49), ship(3, 1, 49, 30), ship(4, 1, 49), ship(5, 1, 52), ship(6, 1, 46),
        ship(11, 1, 49), ship(12, 1, 49),
        ship(21, 1002, 49), ship(22, 1, 49), ship(23, 1, 50), ship(24, 1, 53), ship(25, 1, 54), ship(26, 1, 49),
    ],
    api_deck_port: [
        { api_id: 1, api_name: '第1艦隊', api_ship: [1, 2, 3, 4, 5, 6], api_mission: [0, 0, 0, 0] },
        { api_id: 2, api_name: '第2艦隊', api_ship: [11, 12, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
        { api_id: 3, api_name: '第3艦隊', api_ship: [21, 22, 23, 24, 25, 26], api_mission: [0, 0, 0, 0] },
        { api_id: 4, api_name: '第4艦隊', api_ship: [-1, -1, -1, -1, -1, -1], api_mission: [0, 0, 0, 0] },
    ],
    api_ndock: [],
}, {}, anchor);
state.repairAnchorByDeck.set(0, now - 7 * MIN);
state.moraleAnchor = params.has('unknown') ? undefined : anchor;
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const general = mountGeneral(state, () => '0:00:00', mmss);
general();
general.showUpkeep();
