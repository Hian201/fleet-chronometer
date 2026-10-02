// panel-order 預覽的瀏覽器端入口：以正式 mountOrder 掛上假設持有裝備，檢查裝備艦展開列與檢視切換。
import { mountOrder, renderOrder } from '../../entrypoints/panel/order';
import { GameState, type GearHolderView, type OwnedGearView } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';

const params = new URLSearchParams(location.search);
const lang = (['zh-TW', 'ja', 'en'].includes(params.get('lang') ?? '') ? params.get('lang') : 'zh-TW') as Parameters<typeof setLang>[0];
setLang(lang);
document.documentElement.lang = lang;
if (params.has('theme')) document.documentElement.dataset.theme = params.get('theme')!;

// 假設情境：名稱、數量與持有者只供版面預覽；英文名為暫填，不代表譯名表。
const en = lang === 'en';
const ship = (ja: string, e: string, ex = false): GearHolderView => ({ kind: 'ship', name: en ? e : ja, sub: '', ex });
const lbas = (ja: string, e: string): GearHolderView => ({ kind: 'lbas', name: en ? e : ja, sub: '', ex: false });
const zero = { houg: 0, houm: 0, leng: 0, luck: 0, houk: 0, baku: 0, raig: 0, saku: 0, tais: 0, tyku: 0, souk: 0 };
const kinds: { mst: number; ja: string; en: string; cat: number; stats: Partial<typeof zero>; level?: number; on: GearHolderView[]; idle: number }[] = [
    { mst: 290, ja: '41cm連装砲改二', en: '41cm Twin Gun Mount K2', cat: 3, level: 10, stats: { houg: 22, tyku: 4, houm: 3, leng: 3 },
        on: [ship('長門改二', 'Nagato K2'), ship('長門改二', 'Nagato K2'), ship('陸奥改二', 'Mutsu K2'), ship('陸奥改二', 'Mutsu K2')], idle: 1 },
    { mst: 36, ja: '九一式徹甲弾', en: 'Type 91 AP Shell', cat: 19, level: 6, stats: { houg: 8, houm: 1 },
        on: [ship('長門改二', 'Nagato K2'), ship('陸奥改二', 'Mutsu K2'), ship('大和改二', 'Yamato K2')], idle: 1 },
    { mst: 68, ja: '大発動艇', en: 'Daihatsu Landing Craft', cat: 24, stats: {},
        on: [...Array(3).fill(ship('皐月改二', 'Satsuki K2')), ...Array(3).fill(ship('大潮改二', 'Ooshio K2')),
            ship('霞改二乙', 'Kasumi K2B'), ship('霞改二乙', 'Kasumi K2B'), ship('朝霜改二', 'Asashimo K2')], idle: 3 },
    { mst: 88, ja: '22号対水上電探改四', en: 'Type 22 Surface Radar K4', cat: 12, level: 4, stats: { saku: 6, houm: 5 },
        on: [ship('島風改', 'Shimakaze Kai'), ship('夕立改二', 'Yuudachi K2'), ship('時雨改二', 'Shigure K2'),
            ship('綾波改二', 'Ayanami K2'), ship('雪風改二', 'Yukikaze K2'), ship('磯風乙改', 'Isokaze B Kai'),
            ship('浜風乙改', 'Hamakaze B Kai'), ship('秋月改', 'Akizuki Kai')], idle: 1 },
    { mst: 106, ja: '13号対空電探改', en: 'Type 13 Air Radar Kai', cat: 12, stats: { tyku: 4, saku: 4, houm: 1 },
        on: [ship('雪風改二', 'Yukikaze K2', true), ship('磯風乙改', 'Isokaze B Kai', true), ship('時雨改二', 'Shigure K2'), ship('時雨改二', 'Shigure K2', true)], idle: 4 },
    { mst: 110, ja: '烈風改', en: 'Reppuu Kai', cat: 6, stats: { tyku: 10 },
        on: [ship('赤城改二戊', 'Akagi K2E'), ship('赤城改二戊', 'Akagi K2E'), ship('加賀改二戊', 'Kaga K2E')], idle: 0 },
    { mst: 169, ja: '一式陸攻(野中隊)', en: 'Type 1 Land Attacker (Nonaka)', cat: 47, stats: { raig: 15, tyku: 1, saku: 3 },
        on: [lbas('第1航空隊', 'Air Group 1')], idle: 0 },
    { mst: 168, ja: '九六式陸攻', en: 'Type 96 Land Attacker', cat: 47, stats: { raig: 8, tyku: 1, saku: 2 },
        on: [lbas('第1航空隊', 'Air Group 1'), lbas('第1航空隊', 'Air Group 1'), lbas('第2航空隊', 'Air Group 2')], idle: 1 },
    { mst: 131, ja: '25mm三連装機銃 集中配備', en: '25mm Triple AA (Concentrated)', cat: 21, stats: { tyku: 9 }, on: [], idle: 10 },
    { mst: 16, ja: '九七式艦攻', en: 'Type 97 Torpedo Bomber', cat: 8, stats: { raig: 5, saku: 1 }, on: [], idle: 20 },
    { mst: 15, ja: '61cm四連装(酸素)魚雷', en: '61cm Quad (Oxygen) Torpedo', cat: 5, level: 2, stats: { raig: 10 },
        on: [ship('綾波改二', 'Ayanami K2'), ship('綾波改二', 'Ayanami K2'), ship('夕立改二', 'Yuudachi K2')], idle: 11 },
];
let id = 1;
const gears: OwnedGearView[] = kinds.flatMap(k => [...k.on, ...Array<null>(k.idle).fill(null)].map(holder => ({
    id: id++, mst: k.mst, name: en ? k.en : k.ja, icon: 1, catId: k.cat, catName: '', sortNo: k.mst,
    consumable: false, level: holder ? k.level ?? 0 : 0, alv: 0, stats: { ...zero, ...k.stats }, holder,
})));

const state = new GameState();
for (const g of gears) state.slotItems.set(g.id, { mst: g.mst, level: g.level, alv: 0 });
state.ownedGears = () => gears;

const el = document.getElementById('tab-order')!;
mountOrder(el, () => state);
renderOrder();
document.getElementById('od-mode')!.click();
if (params.get('view') === 'holders') document.querySelector<HTMLButtonElement>('[data-toggle="gearView"]')!.click();
for (const mst of (params.get('open') ?? '').split(',').filter(Boolean)) {
    document.querySelector<HTMLElement>(`[data-gear="${mst}"]`)?.click();
}
