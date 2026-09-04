// 面板「出擊」分頁的離線預覽（開發用，不進擴充 bundle）。
// 套 panel/index.html 的同一份 CSS，下半部搭載真實單隊七船編成。
// 左窗＝正式面板 markup＋CSS；右窗＝參考覆寫與對照情境。
// 上方場景選項也包含同頁的連合艦隊編成雙欄預覽。
//
//   npx vite-node --config vitest.config.ts tools/preview/panel-sortie.ts
//   → .preview/panel-sortie{,-light}.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, gearIconHtml, matIconHtml } from '../../utils/html-escape';
import { formationRects } from '../../utils/formation-geometry';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
setLang('zh-TW');

// 實機標題列會吃掉預覽假窗的一段可用高度；740px 是目前以實際 Chrome 渲染校準的
// 編成硬安全線。超過就必須在預覽中直接標紅，不能等使用者在正式面板才發現第 7 艘被裁。
const FLEET_SAFE_HEIGHT = 740;

const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

// ── 7 船編成假資料（對齊正式 panel 編成資料）────────────────────────────────
const alvMark = (alv: number) =>
    ['', '|', '||', '|||', '/', '//', '///', '&gt;&gt;'][Math.min(7, Math.max(0, alv))];
const impMark = (level: number) => (level >= 10 ? '★' : level > 0 ? String(level) : '');

type Gear = {
    name: string; short: string; cat: string; icon: number;
    level?: number; alv?: number;
    count?: number; countMax?: number; countEst?: boolean;
};
type Ship = {
    stype: string; name: string; nameJa: string; lv: number;
    hp: number; maxhp: number; cond: number;
    fuel: number; maxFuel: number; bull: number; maxBull: number;
    escaped?: boolean; inDock?: boolean;
    gears: (Gear | null)[];
    ex?: Gear | 'empty' | 'none';
    cap?: (number | undefined)[];
};

const blankChip = (cls: string, ex = false, capacity?: number) =>
    ex
        ? `<span class="chip ${cls}"><span class="g-icon-slot"></span><b></b></span>`
        : `<span class="chip ${cls}"><span class="g-icon-slot"></span><span class="r-col"><span class="r-top"><u></u><b></b></span><em class="oc">${capacity || ''}</em></span></span>`;

const slotCountTitle = (g: Gear) => {
    if (g.count == null) return '';
    const est = g.countEst ? `（${t('fleet.slotCountEst')}）` : '';
    return ` [${g.count}${g.countMax != null ? `/${g.countMax}` : ''}]${est}`;
};

const gearChip = (g: Gear, ex = false) => {
    const title = `${esc(g.name)}${g.level ? ` ★${g.level}` : ''}${g.alv ? ` »${g.alv}` : ''}${esc(slotCountTitle(g))}`;
    if (ex) {
        const exValue = g.count != null ? String(g.count) : impMark(g.level ?? 0);
        return `<span class="chip ${g.cat} ex" title="${title}">${gearIconHtml(g.icon, g.short)}<b>${exValue}</b></span>`;
    }
    const ocCls = g.count == null || g.countMax == null ? '' : g.count <= 0 ? 'zero' : g.count < g.countMax ? 'hit' : '';
    return `<span class="chip ${g.cat}" title="${title}">` +
        `${gearIconHtml(g.icon, g.short)}<span class="r-col"><span class="r-top"><u>${alvMark(g.alv ?? 0)}</u><b>${impMark(g.level ?? 0)}</b></span>` +
        `<em class="oc ${ocCls}">${g.count ?? ''}</em></span></span>`;
};

const vitSupply = (s: Ship) => {
    const pct = (v: number, max: number) => max ? Math.round(100 * v / max) : 100;
    const fp = pct(s.fuel, s.maxFuel), bp = pct(s.bull, s.maxBull);
    return `<span class="vit-sup">` +
        `<span class="sup-f" title="${esc(t('mat.fuel.full'))} ${fp}%">${matIconHtml('fuel', t('mat.fuel.full'))}${fp}</span>` +
        `<span class="sup-a" title="${esc(t('mat.ammo.full'))} ${bp}%">${matIconHtml('ammo', t('mat.ammo.full'))}${bp}</span>` +
        `</span>`;
};
const stClass = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    return r <= 0.25 ? 'st-major' : r <= 0.5 ? 'st-mid' : r <= 0.75 ? 'st-minor' : '';
};
const condClass = (s: Ship) => s.cond >= 50 ? 'sparkle' : s.cond <= 19 ? 'heavy' : s.cond <= 29 ? 'tired' : '';
const FLEET_REGULAR_SLOTS = 5;
const taihaMark = (s: Ship) => {
    if (s.escaped || s.inDock || stClass(s) !== 'st-major') return '';
    return `<span class="taiha-mark">${esc(t('fleet.heavyDamage'))}</span>`;
};
const taihaHpMark = (s: Ship) => {
    if (s.escaped || s.inDock || stClass(s) !== 'st-major') return '';
    return `<span class="taiha-hp-mark">${esc(t('fleet.heavyDamage'))}</span>`;
};
const condDisplay = (s: Ship) => {
    const cond = condClass(s);
    const isTaiha = !s.escaped && !s.inDock && stClass(s) === 'st-major';
    if (!isTaiha) return `<span class="cond ${cond}">${s.cond}</span>`;
    const label = t('fleet.heavyDamage');
    return `<button type="button" class="taiha-cond-toggle cond ${cond}" aria-expanded="false" aria-label="${esc(`${label}：${t('fleet.heavyDamageReveal')}`)}" title="${esc(t('fleet.heavyDamageReveal'))}">${taihaMark(s)}<span class="taiha-cond-value">${s.cond}</span></button>`;
};

const shipRow = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    const st = stClass(s);
    const realChips = s.gears.map((g, i) => g ? gearChip(g) : blankChip('chip-empty', false, s.cap?.[i])).join('');
    const exChip = s.ex && s.ex !== 'none' && s.ex !== 'empty' ? gearChip(s.ex, true)
        : s.ex === 'empty' ? blankChip('chip-empty ex', true)
            : blankChip('chip-pad ex', true);
    const padCount = FLEET_REGULAR_SLOTS - s.gears.length;
    const chips = realChips + blankChip('chip-pad').repeat(Math.max(0, padCount));
    const dock = s.inDock ? `<span class="dock-mark">${esc(t('fleet.inDock'))}</span>` : '';
    return `<div class="ship ${st} ${s.escaped ? 'escaped' : ''} ${s.inDock ? 'in-dock' : ''}">
      <div class="ship-body">
        <div class="ship-id">${s.stype ? `<span class="stype">${esc(s.stype)}</span>` : ''}<span class="grow" title="${esc(s.nameJa || s.name)}">${esc(s.name)}</span>${dock}<span class="num">Lv${s.lv}</span></div>
        <div class="ship-vitals">
          <div class="vit-hp"><span class="hp-num">${s.hp}</span><span class="hp-max">/${s.maxhp}</span>${taihaHpMark(s)}<span class="hpbar"><i style="width:${Math.round(r * 100)}%"></i></span></div>
          <div class="vit-aux"><span class="cond ${condClass(s)}">${s.cond}</span>${vitSupply(s)}</div>
        </div>
        <div class="sub-row"><div class="chips">${chips}${exChip}</div></div>
      </div>
    </div>`;
};

const SEVEN_SHIPS: Ship[] = [
    {
        stype: 'AS', name: '長鯨改', nameJa: '長鯨改', lv: 86, hp: 37, maxhp: 37, cond: 76,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100, ex: 'none',
        gears: [
            { name: '大発動艇', short: '上', cat: 'c-sea', icon: 10, alv: 7, count: 2 },
            { name: '大発動艇', short: '上', cat: 'c-sea', icon: 10, alv: 7, count: 2 },
            { name: '特大発動艇', short: '特', cat: 'c-sea', icon: 14, alv: 7, count: 2 },
        ],
    },
    {
        stype: 'SSV', name: '伊41改', nameJa: '伊41改', lv: 74, hp: 18, maxhp: 18, cond: 53,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100, ex: 'none',
        gears: [
            { name: '後期型艦首魚雷(6門)', short: '雷', cat: 'c-torp', icon: 5 },
            { name: '潜水艦搭載電探＆水防式望遠鏡', short: '潜', cat: 'c-sea', icon: 10, count: 1 },
        ],
    },
    {
        stype: 'SSV', name: '伊13改', nameJa: '伊13改', lv: 84, hp: 21, maxhp: 21, cond: 52,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100, ex: { name: '後期型艦首魚雷(6門)', short: '雷', cat: 'c-torp', icon: 5, count: 2 },
        gears: [
            { name: '後期型艦首魚雷(6門)', short: '雷', cat: 'c-torp', icon: 5, count: 2 },
            { name: '潜水艦搭載電探＆水防式望遠鏡', short: '潜', cat: 'c-sea', icon: 10, count: 3 },
            { name: '後期型艦首魚雷(6門)', short: '雷', cat: 'c-torp', icon: 5, count: 4 },
        ],
    },
    {
        stype: 'SSV', name: '伊36改', nameJa: '伊36改', lv: 83, hp: 18, maxhp: 18, cond: 53,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100, ex: { name: '潜水艦搭載電探＆水防式望遠鏡', short: '潜', cat: 'c-sea', icon: 10, count: 2 },
        gears: [
            { name: '後期型艦首魚雷(6門)', short: '雷', cat: 'c-torp', icon: 5 },
            { name: '潜水艦搭載電探＆水防式望遠鏡', short: '潜', cat: 'c-sea', icon: 10, count: 3 },
        ],
    },
    {
        stype: 'SS', name: '伊47改', nameJa: '伊47改', lv: 65, hp: 18, maxhp: 18, cond: 52,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100, ex: 'none',
        gears: [
            { name: '後期型艦首魚雷(6門)', short: '雷', cat: 'c-torp', icon: 5, count: 2 },
            { name: '後期型艦首魚雷(6門)', short: '雷', cat: 'c-torp', icon: 5, count: 4 },
        ],
    },
    {
        stype: 'DD', name: '照月改', nameJa: '照月改', lv: 98, hp: 37, maxhp: 37, cond: 52,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100, ex: { name: '改良型艦本式タービン', short: '機', cat: 'c-etc', icon: 24, count: 8 },
        gears: [
            { name: '10cm連装高角砲+高射装置', short: '高', cat: 'c-etc', icon: 16, count: 6 },
            { name: '10cm連装高角砲+高射装置', short: '高', cat: 'c-etc', icon: 16, count: 6 },
            { name: '94式高射装置', short: '高', cat: 'c-etc', icon: 24 },
        ],
    },
    {
        stype: 'DD', name: '綾波改二', nameJa: '綾波改二', lv: 139, hp: 39, maxhp: 39, cond: 52,
        fuel: 100, maxFuel: 100, bull: 100, maxBull: 100, ex: { name: '改良型艦本式タービン', short: '機', cat: 'c-etc', icon: 24, count: 8 },
        gears: [
            { name: '12.7cm連装砲D型改二', short: '主', cat: 'c-gun', icon: 1 },
            { name: '61cm五連装(酸素)魚雷', short: '雷', cat: 'c-torp', icon: 5, count: 8 },
            { name: '61cm五連装(酸素)魚雷', short: '雷', cat: 'c-torp', icon: 5, count: 4 },
        ],
    },
];

const SEVEN_FLEET_HTML = `<section class="fleet fleet-seven">
  <div class="fsummary">
    <div class="fs-metrics">
      <span class="fs-pri">${t('fleet.airPower')} <b>69~70</b></span>
      <span class="fs-pri">${t('fleet.scouting33')} <b>24.0</b> <select class="cn"><option selected>×1</option><option>×2</option><option>×3</option><option>×4</option></select></span>
      <span class="fs-sec"><b>低速</b></span>
      <span class="fs-sec">${t('fleet.lvTotal')} <b>628</b></span>
      <span class="fs-sec" title="輸送作戰 TP 貢獻值">${t('fleet.transportTP')} <b>25</b></span>
    </div>
  </div>
  ${SEVEN_SHIPS.map(s => shipRow(s)).join('')}
</section>`;
const SEVEN_TAIHA_SHIPS = SEVEN_SHIPS.map((s, i) => i === 0 ? { ...s, hp: 8 } : s);
const sevenFleetHtml = (ships: Ship[], ops = '') => `<section class="fleet fleet-seven${ops ? ' fleet-seven-ops' : ''}">
  <div class="fsummary">
    ${ops ? `<div class="fs-ops">${ops}</div>` : ''}
    <div class="fs-metrics">
      <span class="fs-pri">${t('fleet.airPower')} <b>69~70</b></span>
      <span class="fs-pri">${t('fleet.scouting33')} <b>24.0</b> <select class="cn"><option selected>×1</option><option>×2</option><option>×3</option><option>×4</option></select></span>
      <span class="fs-sec"><b>低速</b></span>
      <span class="fs-sec">${t('fleet.lvTotal')} <b>628</b></span>
      <span class="fs-sec" title="輸送作戰 TP 貢獻值">${t('fleet.transportTP')} <b>25</b></span>
    </div>
  </div>
  ${ships.map(s => shipRow(s)).join('')}
</section>`;
const SEVEN_FLEET_TAIHA_HTML = sevenFleetHtml(SEVEN_TAIHA_SHIPS);

// 連合艦隊編成預覽沿用同一頁的切換場景，不另開獨立頁面。
// 這裡只重用既有七船 fixture 的資料切成兩欄，專門量測兩隊並列時的列寬與 HP／補給欄。
const compactGearRow = (s: Ship) => {
    const cgItem = (g: Gear, ex = false) => {
        const title = `${esc(g.name)}${g.level ? ` ★${g.level}` : ''}${g.alv ? ` »${g.alv}` : ''}${esc(slotCountTitle(g))}`;
        return `<span class="cg-item ${g.cat}${ex ? ' ex' : ''}" title="${title}">${gearIconHtml(g.icon, g.short)}${g.count != null ? `<em>${g.count}</em>` : ''}</span>`;
    };
    const cgBlank = (capacity?: number, ex = false) =>
        `<span class="cg-item cg-empty${ex ? ' ex' : ''}"><span class="g-icon-slot"></span>${capacity ? `<em>${capacity}</em>` : ''}</span>`;
    const slots = s.gears.map((g, i) => g ? cgItem(g) : cgBlank(s.cap?.[i]));
    const exItem = s.ex && s.ex !== 'none' && s.ex !== 'empty' ? cgItem(s.ex, true)
        : s.ex === 'empty' ? cgBlank(undefined, true) : '';
    if (slots.length === 0 && !exItem) return '';
    return `<div class="c-gear"><span class="c-gear-slots">${slots.join('')}</span>${exItem}</div>`;
};

const compactShipRow = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    const st = stClass(s);
    const pct = (v: number, max: number) => max ? Math.round(100 * v / max) : 100;
    const fp = pct(s.fuel, s.maxFuel), bp = pct(s.bull, s.maxBull);
    const supply = `<span class="c-sup" title="${esc(t('mat.fuel.full'))} ${fp}% ／ ${esc(t('mat.ammo.full'))} ${bp}%">` +
        `<i style="background-image:linear-gradient(to right,#58a55c ${fp}%,transparent ${fp}%)"></i>` +
        `<i style="background-image:linear-gradient(to left,#a8763e ${bp}%,transparent ${bp}%)"></i></span>`;
    return `<div class="ship c ${st}">
      <div class="c-top"><span class="stype">${esc(s.stype)}</span><span class="grow" title="${esc(s.nameJa || s.name)}">${esc(s.name)}</span>${condDisplay(s)}</div>
      <div class="c-hp"><span class="hpbar"><i style="width:${Math.round(r * 100)}%"></i></span><span class="c-hp-value"><span class="hp-num">${s.hp}</span><span class="hp-max">/${s.maxhp}</span></span><span class="c-aux">${supply}</span></div>
      ${compactGearRow(s)}
    </div>`;
};

const combinedFleetColumn = (ships: Ship[]) =>
    `<section class="fleet compact">${ships.map(compactShipRow).join('')}</section>`;

// 這組只用來重現使用者提供的連合艦隊版面；裝備槽沿用既有 fixture，避免把未提供的
// 封包資料當成真實遊戲資料。艦名、等級、HP、cond 與總覽數字依參考畫面抄錄。
const previewShip = (base: Ship, over: Partial<Ship>): Ship => ({ ...base, ...over, nameJa: String(over.name ?? base.name) });
const SEVEN_FUNCTION_FLEET = (name: string, stype: string) => [
    previewShip(SEVEN_SHIPS[0], { stype, name }),
    ...SEVEN_SHIPS.slice(1),
];
const SEVEN_FLEET_REPAIR_HTML = sevenFleetHtml(
    SEVEN_FUNCTION_FLEET('明石改', 'AR'),
    '<span class="fs-tick repair-state"><span class="badge-tag repair">泊地修理 6艦</span></span>',
);
const SEVEN_FLEET_MORALE_HTML = sevenFleetHtml(
    SEVEN_FUNCTION_FLEET('野埼改', 'AO'),
    '<span class="fs-tick repair-state"><span class="badge-tag morale">給糧 6艦</span></span>',
);
// 五格空母的搭載數是 compact 裝備列最容易觸發換行的案例；這是離線版面 fixture，
// 不是對任何真實艦娘裝備狀態的推定。
const FIVE_SLOT_CARRIER = previewShip(SEVEN_SHIPS[2], {
    stype: 'CV', name: '加賀改二', lv: 99, hp: 98, maxhp: 98,
    gears: [
        { name: '艦載機', short: '戰', cat: 'c-ftr', icon: 9, count: 20, countMax: 20 },
        { name: '艦載機', short: '戰', cat: 'c-ftr', icon: 9, count: 20, countMax: 20 },
        { name: '艦載機', short: '爆', cat: 'c-db', icon: 10, count: 44, countMax: 44 },
        { name: '艦載機', short: '攻', cat: 'c-tb', icon: 11, count: 12, countMax: 12 },
        null,
    ],
    cap: [20, 20, 44, 12, 3],
    ex: 'empty',
});
const COMBINED_FIRST_SHIPS: Ship[] = [
    previewShip(SEVEN_SHIPS[0], { stype: 'BBV', name: '大和改二重', lv: 173, hp: 107, maxhp: 107, cond: 100 }),
    previewShip(SEVEN_SHIPS[1], { stype: 'BB', name: '武蔵改二', lv: 99, hp: 99, maxhp: 99, cond: 49 }),
    FIVE_SLOT_CARRIER,
    previewShip(SEVEN_SHIPS[3], { stype: 'CV', name: '無畏改', lv: 99, hp: 69, maxhp: 69, cond: 49 }),
    previewShip(SEVEN_SHIPS[4], { stype: 'CVL', name: '隼鷹改二', lv: 99, hp: 55, maxhp: 55, cond: 54 }),
    previewShip(SEVEN_SHIPS[5], { stype: 'CL', name: '多摩改二', lv: 99, hp: 46, maxhp: 46, cond: 49 }),
];
const COMBINED_SECOND_SHIPS: Ship[] = [
    previewShip(SEVEN_SHIPS[1], { stype: 'AO', name: '野埼改', lv: 61, hp: 14, maxhp: 14, cond: 86 }),
    previewShip(SEVEN_SHIPS[2], { stype: 'DD', name: '文月改二', lv: 98, hp: 27, maxhp: 27, cond: 52 }),
    previewShip(SEVEN_SHIPS[3], { stype: 'DD', name: '皐月改二', lv: 98, hp: 28, maxhp: 28, cond: 52 }),
    previewShip(SEVEN_SHIPS[4], { stype: 'DD', name: '橘改', lv: 85, hp: 27, maxhp: 27, cond: 52 }),
    previewShip(SEVEN_SHIPS[5], { stype: 'DD', name: '杉改', lv: 90, hp: 27, maxhp: 27, cond: 52 }),
    previewShip(SEVEN_SHIPS[6], { stype: 'CL', name: '阿賀野改', lv: 97, hp: 45, maxhp: 45, cond: 52 }),
];

// 大破示範只改離線預覽 fixture 的 HP；不把這組假資料當成封包狀態。
const COMBINED_TAIHA_FIRST_SHIPS = COMBINED_FIRST_SHIPS.map((s, i) => i === 0 ? { ...s, hp: 20 } : s);
const COMBINED_TAIHA_SECOND_SHIPS = COMBINED_SECOND_SHIPS.map((s, i) => i === 0 ? { ...s, hp: 3 } : s);
const combinedFleetHtml = (first: Ship[], second: Ship[]) => `<div class="combined-wrap sortie-combined-fleet">
  <div class="fsummary combined-total"><div class="fs-metrics"><span class="fs-pri">制空 <b>27~28</b></span><span class="fs-pri">索敵(33) <b>22.5</b> <select class="cn"><option selected>×1</option><option>×2</option><option>×3</option><option>×4</option></select></span><span class="fs-sec"><b>低速</b></span><span class="fs-sec">Lv <b>1197</b></span><span class="fs-sec">TP <b>113</b></span></div></div>
  <div class="c-fleet-row">${combinedFleetColumn(first)}${combinedFleetColumn(second)}</div>
</div>`;
const COMBINED_FLEET_HTML = combinedFleetHtml(COMBINED_FIRST_SHIPS, COMBINED_SECOND_SHIPS);
const COMBINED_FLEET_TAIHA_HTML = combinedFleetHtml(COMBINED_TAIHA_FIRST_SHIPS, COMBINED_TAIHA_SECOND_SHIPS);

const NAV_HTML = `<button type="button">1</button><button type="button">2</button><button type="button" class="on">3</button><button type="button">4</button><button type="button">連合艦隊</button><span class="grow"></span><button type="button">基地航空隊</button>`;

// 陣形圖稿：只在離線預覽內聯，避免把外部工具的 PNG 資產帶進正式 bundle。
type FormationSpec = { id: number; label: string; group: string; geometry: string };
const formationBlocks = (id: number, width = 6, height = 6) =>
    formationRects(id).map(([x, y]) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="1" />`).join('');
const FORMATIONS: FormationSpec[] = [
    { id: 1, label: '單縱陣', group: '單艦隊／遊擊', geometry: formationBlocks(1) },
    { id: 2, label: '複縱陣', group: '單艦隊／遊擊', geometry: formationBlocks(2) },
    { id: 3, label: '輪形陣', group: '單艦隊／遊擊', geometry: formationBlocks(3) },
    { id: 4, label: '梯形陣', group: '單艦隊／遊擊', geometry: formationBlocks(4) },
    { id: 5, label: '單橫陣', group: '單艦隊／遊擊', geometry: formationBlocks(5) },
    { id: 6, label: '警戒陣', group: '單艦隊／遊擊', geometry: formationBlocks(6) },
    { id: 11, label: '第一警戒', group: '連合艦隊', geometry: formationBlocks(11) },
    { id: 12, label: '第二警戒', group: '連合艦隊', geometry: formationBlocks(12) },
    { id: 13, label: '第三警戒', group: '連合艦隊', geometry: formationBlocks(13) },
    { id: 14, label: '第四警戒', group: '連合艦隊', geometry: formationBlocks(14) },
];

const formationSpec = (id: number) => FORMATIONS.find(f => f.id === id) ?? FORMATIONS[0];
const formationSvg = (id: number, selected = false) => {
    const f = formationSpec(id);
    return `<svg class="s-formation-icon${selected ? ' selected' : ''}" viewBox="0 0 62 62" role="img" aria-label="${esc(f.label)}" focusable="false"><circle cx="31" cy="31" r="27" fill="none" stroke="currentColor" stroke-width="3"/><g transform="translate(31 31) scale(.82) translate(-31 -31)" fill="currentColor">${f.geometry}</g></svg>`;
};
const formationReadout = (id: number, text: string) => {
    const f = formationSpec(id);
    return `<span class="s-formation-readout" title="${esc(f.label)}"><span class="s-formation-current">${formationSvg(id, true)}</span><b>${esc(text)}</b></span>`;
};

const lamp = (label: string, value: string, state: 'on' | 'off' | 'warn' | 'predicted', title: string) =>
    `<span class="s-lamp ${state}" title="${esc(title)}"><span class="s-lamp-mark">${esc(label)}</span><b>${esc(value)}</b></span>`;

const rankGradeClass = (rank: string) => {
    const r = rank.toUpperCase().replace(/\?$/, '');
    return r === 'SS' ? 'rank-ss'
        : r === 'S' ? 'rank-s'
            : r === 'A' ? 'rank-a'
                : r === 'B' ? 'rank-b'
                    : r === 'C' ? 'rank-c'
                        : r === 'D' ? 'rank-d'
                            : r === 'E' ? 'rank-e'
                                : 'rank-unknown';
};

const rankResultHtml = (rank: string, predicted = false, title = '', name = '') => {
    const cls = rankGradeClass(rank);
    const predClass = predicted ? ' predicted' : '';
    const safeTitle = title || (predicted ? '戰鬥結果預測中' : `戰鬥結果 ${rank}`);
    const rankLabel = rank.endsWith('?') ? rank.slice(0, -1) : rank;
    const mark = rank.endsWith('?') ? '<sup>?</sup>' : '';
    const nameHtml = name ? `<span class="s-rank-name">${esc(name)}</span>` : '';
    return `<div class="s-rank-result" title="${esc(safeTitle)}"><span class="s-rank-grade ${cls}${predClass}">${esc(rankLabel)}${mark}</span>${nameHtml}</div>`;
};

const BOSS_NODE_SVG = `<svg class="s-boss-node-svg" viewBox="0 0 100 120" preserveAspectRatio="xMidYMid meet" role="presentation" aria-hidden="true" focusable="false">
  <path class="s-boss-head" d="M 50 114 C 23 114 5 95 5 66 C 5 44 16 29 29 22 C 26 15 20 8 14 3 C 27 6 37 16 42 28 C 45 27 48 26 50 26 C 52 26 55 27 58 28 C 63 16 73 6 86 3 C 80 8 74 15 71 22 C 84 29 95 44 95 66 C 95 95 77 114 50 114 Z" />
  <text class="s-boss-letter" x="50" y="86" text-anchor="middle">Z</text>
</svg>`;

const bossNodeHtml = (letter: string, visited = false, current = false) => {
    const svg = BOSS_NODE_SVG.replace('>Z<', `>${esc(letter)}<`);
    return `<div class="s-node boss${visited ? ' visited' : ''}${current ? ' current' : ''}">${svg}</div>`;
};

type PreviewNodeKind = 'battle' | 'no-battle' | 'branch';
const sortieNodeHtml = (letter: string, visited = false, isBoss = false, kind: PreviewNodeKind = 'battle', current = false) => {
    const stateClass = kind === 'no-battle' ? ' no-battle' : kind === 'branch' ? ' branch' : '';
    if (isBoss) return bossNodeHtml(letter, visited, current);
    return `<div class="s-node${visited ? ' visited' : ''}${stateClass}${current ? ' current' : ''}">${esc(letter)}</div>`;
};

type TacticalSupportKind = 'air' | 'shell' | 'torpedo' | 'asw';
type SupportShipVariant = 'north-carolina' | 'north-carolina-half' | 'yamato';
type AswSupportVariant = 'ka2' | 'tracker';
type FriendlyFleetVariant = 'text' | 'anchor';

// 出擊系統圖示沿用專案公開素材；預覽輸出位於 .preview/，所以用相對路徑
// 直接讀取 public/，避免預覽自己再維護一套替代圖檔。風格規範見
// docs/design-guidelines.md §5.1；預覽必須與正式 panel 維持同一套擬真剪影資產。
const TACTICAL_ICON_ROOT = '../public/icons/tactical';
const tacticalIcon = (file: string) => `${TACTICAL_ICON_ROOT}/${file}`;

const tacticalSupportIconHtml = (kind: TacticalSupportKind = 'shell', shipVariant: SupportShipVariant = 'yamato', aswVariant: AswSupportVariant = 'ka2') => {
    if (kind === 'air') {
        return `<span class="s-system-glyph support-air" title="航空支援"><img class="support-aircraft-raster" src="${tacticalIcon('comet-air-support.png')}" alt="航空支援" /></span>`;
    }
    if (kind === 'asw') {
        const file = aswVariant === 'ka2' ? 'ka2-asw-support.png' : 'tracker-s2-asw-support.png';
        const label = aswVariant === 'ka2' ? '對潛支援（Ka-2）' : '對潛支援（Tracker S-2）';
        return `<span class="s-system-glyph support-asw" title="${label}"><img class="support-asw-raster" src="${tacticalIcon(file)}" alt="${label}" /></span>`;
    }
    if (kind === 'torpedo') {
        return `<span class="s-system-glyph support-torpedo" title="雷擊支援"><img class="support-torpedo-raster" src="${tacticalIcon('knox-torpedo-support.png')}" alt="雷擊支援" /></span>`;
    }
    const file = shipVariant === 'north-carolina-half'
        ? 'north-carolina-support-half.png'
        : shipVariant === 'north-carolina'
            ? 'north-carolina-support.png'
            : 'yamato-north-style.png';
    const label = shipVariant === 'north-carolina-half'
        ? '砲擊支援（北卡右半）'
        : shipVariant === 'north-carolina'
            ? '砲擊支援（北卡全艦）'
            : '砲擊支援（大和北卡風）';
    return `<span class="s-system-glyph support-shell" title="${label}"><img class="support-ship-raster" src="${tacticalIcon(file)}" alt="${label}" /></span>`;
};

const lbasAircraftIconHtml = () =>
    `<span class="s-system-glyph lbas" title="基地航空隊"><img class="lbas-aircraft-raster" src="${tacticalIcon('b25-lbas-support.png')}" alt="基地航空隊" /></span>`;

const aaciGunIconHtml = () =>
    `<span class="s-system-glyph aaci"><img class="aaci-gun-raster" src="${tacticalIcon('bofors-40mm-aaci-mirrored.png')}" alt="對空 CI" /></span>`;

const searchRadarIconHtml = () =>
    `<svg class="s-system-glyph search" viewBox="0 0 24 24" role="img" aria-label="索敵雷達" focusable="false">
      <circle class="search-ring outer" cx="12" cy="12" r="10" />
      <circle class="search-ring middle" cx="12" cy="12" r="6.8" />
      <circle class="search-ring inner" cx="12" cy="12" r="3.6" />
      <path class="search-grid" d="M 12 2 L 12 22 M 2 12 L 22 12" />
      <path class="search-sweep" d="M 12 12 L 20.8 7 A 10 10 0 0 1 22 12 Z" />
      <path class="search-needle" d="M 12 12 L 20.8 7" />
      <circle class="search-blip" cx="17.2" cy="8.4" r="1.15" />
      <circle class="search-center" cx="12" cy="12" r="1.3" />
    </svg>`;

const contactIconHtml = (contact: string, equipment?: { icon: number; short: string; name: string } | null) => {
    const friendlyName = equipment?.name ?? '我方觸接飛機';
    const friendlyHover = `我方：${friendlyName}`;
    const enemyHover = '敵方：深海艦載機';
    if (contact === '我' && equipment) {
        return `<span class="s-system-glyph contact-single friendly" role="img" aria-label="${esc(friendlyHover)}" title="${esc(friendlyHover)}">${gearIconHtml(equipment.icon, equipment.short)}<span class="s-contact-hover">${esc(friendlyHover)}</span></span>`;
    }
    if (contact === '敵') {
        return `<span class="s-system-glyph contact-single enemy" role="img" aria-label="${esc(enemyHover)}" title="${esc(enemyHover)}"><img class="deepsea-aircraft-raster" src="${tacticalIcon('deepsea-carrier-aircraft.png')}" alt="深海艦載機" /><span class="s-contact-hover">${esc(enemyHover)}</span></span>`;
    }
    if (contact === '雙') {
        const friendGear = equipment ? gearIconHtml(equipment.icon, equipment.short) : gearIconHtml(9, '偵');
        return `<span class="s-system-glyph contact-both" role="group" aria-label="敵我雙方觸接" title="敵我雙方觸接"><span class="contact-sub friendly" title="${esc(friendlyHover)}">${friendGear}</span><span class="contact-sub enemy" title="${esc(enemyHover)}"><img class="deepsea-aircraft-raster" src="${tacticalIcon('deepsea-carrier-aircraft.png')}" alt="深海艦載機" /></span><span class="s-contact-hover both" aria-hidden="true"><span>${esc(friendlyHover)}</span><span>${esc(enemyHover)}</span></span></span>`;
    }
    return `<svg class="s-system-glyph contact-recon" viewBox="0 0 24 24" role="img" aria-label="觸接機影" focusable="false">
      <path class="recon-silhouette" d="M 12 2.2 C 12.8 2.2 13.5 3.1 13.5 4.3 L 13.7 9.1 L 22.8 13.1 C 23.3 13.3 23.6 13.8 23.4 14.3 C 23.2 14.8 22.7 15.1 22.2 14.9 L 13.7 12.8 L 13.7 18.2 L 16.4 20.4 C 16.8 20.7 16.9 21.2 16.7 21.6 C 16.5 22 16 22.2 15.6 22 L 12 20.6 L 8.4 22 C 8 22.2 7.5 22 7.3 21.6 C 7.1 21.2 7.2 20.7 7.6 20.4 L 10.3 18.2 L 10.3 12.8 L 1.8 14.9 C 1.3 15.1 0.8 14.8 0.6 14.3 C 0.4 13.8 0.7 13.3 1.2 13.1 L 10.3 9.1 L 10.5 4.3 C 10.5 3.1 11.2 2.2 12 2.2 Z" />
    </svg>`;
};

const friendlyFleetIconHtml = (variant: FriendlyFleetVariant = 'anchor') => {
    if (variant === 'anchor') {
        return `<span class="s-system-glyph friendly friendly-anchor" title="友軍艦隊（櫻錨標示）"><img class="friendly-fleet-raster" src="${tacticalIcon('friendly-anchor.png')}" alt="友軍艦隊" /></span>`;
    }
    return `<svg class="s-system-glyph friendly" viewBox="0 0 24 24" role="img" aria-label="友軍艦隊" focusable="false">
      <path class="friendly-hull" d="M 2.4 15.6 L 4.8 10.2 L 19.2 10.2 L 21.6 15.6 C 19.2 17.6 14.8 18.6 12 18.6 C 9.2 18.6 4.8 17.6 2.4 15.6 Z" />
      <path class="friendly-bridge" d="M 9.6 10.2 L 10.2 6.6 L 13.8 6.6 L 14.4 10.2 Z" />
      <line class="friendly-mast" x1="12" y1="2.4" x2="12" y2="6.6" />
      <line class="friendly-yard" x1="9.8" y1="4.2" x2="14.2" y2="4.2" />
      <path class="friendly-wave" d="M 1.2 19.8 C 4 18.6 6.8 21 9.6 19.8 C 12.4 18.6 15.2 21 18 19.8 C 19.8 19 21.4 19.6 22.8 20.4" />
    </svg>`;
};

const sakuraAnchorSvg = (styleOrIsNew: 'bloom' | 'halo' | 'plain' | boolean = 'bloom', state: 'new' | 'owned' = 'new') => {
    const actualState = typeof styleOrIsNew === 'boolean' ? (styleOrIsNew ? 'new' : 'owned') : state;
    const isNew = actualState === 'new';
    const label = isNew ? '新掉落櫻錨' : '已有船櫻錨';
    const file = isNew ? 'sakura-anchor-new.png' : 'sakura-anchor-owned.png';
    return `<img class="pv-sakura-anchor ${actualState}" src="${tacticalIcon(file)}" alt="${label}" draggable="false" />`;
};

const panelDropChip = (name: string, isNewOrState: boolean | 'new' | 'owned' = true) => {
    const isNew = typeof isNewOrState === 'boolean' ? isNewOrState : isNewOrState === 'new';
    const cls = isNew ? 'new' : 'owned';
    const isLong = name.length > 8;
    const longCls = isLong ? ' long-name' : '';
    return `<div class="s-drop-chip sakura-drop ${cls}${longCls}" role="group" aria-label="${isNew ? '新掉落' : '已有船'}：${esc(name)}" title="${isNew ? '新艦娘掉落' : '掉落艦娘'}：${esc(name)}">
      <span class="sakura-drop-icon">${sakuraAnchorSvg('bloom', isNew ? 'new' : 'owned')}</span>
      <span class="sakura-drop-name">${esc(name)}</span>
    </div>`;
};

type NightEffectState = 'on' | 'off' | 'unknown';
type NightEffectKind = 'searchlight' | 'night-contact' | 'star-shell';
type NightEntryState = 'none' | 'available' | 'escort' | 'main';

const NIGHT_EFFECT_ICONS: Record<NightEffectKind, { icon: number; short: string; label: string }> = {
    searchlight: { icon: 24, short: '探', label: '探照燈' },
    'night-contact': { icon: 9, short: '夜偵', label: '九八式水上偵察機(夜連)' },
    'star-shell': { icon: 27, short: '照', label: '照明彈' },
};

const nightEffectBadge = (kind: NightEffectKind, state: NightEffectState) => {
    const spec = NIGHT_EFFECT_ICONS[kind];
    const title = `${spec.label}：${state === 'on' ? '發動' : state === 'off' ? '未發動' : '未裝備／狀態未知'}`;
    return `<span class="s-night-effect ${kind} ${state}" title="${esc(title)}">${gearIconHtml(spec.icon, spec.short)}</span>`;
};

const nightEntryHtml = (state: NightEntryState, title = '') => {
    const moonImg = `<img class="s-night-moon" src="${tacticalIcon('brass-crescent.png')}" alt="" aria-hidden="true" />`;
    const unavailable = state === 'none';
    const safeTitle = title || (state === 'main' ? '夜戰進入：主隊' : state === 'escort' ? '夜戰進入：隨伴艦隊' : state === 'available' ? '夜戰突入可能' : '本節點沒有夜戰；圖示維持暗色');
    const escortActive = state === 'escort';
    const mainActive = state === 'main';
    const groupClass = `${state === 'available' || unavailable ? ' unknown' : ''}${unavailable ? ' unavailable' : ''}`;
    const groupLabel = state === 'available' ? `${safeTitle}；目標隊伍未確定` : safeTitle;
    return `<span class="s-night-entry-group${groupClass}" role="group" aria-label="${esc(groupLabel)}" title="${esc(safeTitle)}">
      <span class="s-night-entry-moon" aria-hidden="true">${moonImg}</span>
      <span class="s-night-entry-cells">
        <span class="s-night-entry-cell main${mainActive ? ' active' : ''}"><i aria-hidden="true"></i><span class="s-night-entry-label" data-label-zh="主隊" data-label-ja="本隊" data-label-en="Main">主隊</span></span>
        <span class="s-night-entry-cell escort${escortActive ? ' active' : ''}"><i aria-hidden="true"></i><span class="s-night-entry-label" data-label-zh="伴隨" data-label-ja="随伴" data-label-en="Esc">伴隨</span></span>
      </span>
    </span>`;
};

const nightEffectsHtml = (
    effects: Record<NightEffectKind, NightEffectState>,
    entry: NightEntryState = 'none',
    title = '',
    friendlyState: 'on' | 'off' | 'warn' | 'predicted' = 'off',
    friendlyTitle = '友軍艦隊狀態',
    friendlyShips: string[] = [],
) => `<div class="s-night-effects${entry === 'main' || entry === 'escort' ? ' combined' : ''}" aria-label="夜戰裝備與友軍狀態">
  <div class="s-night-equipment-list">
    ${nightEffectBadge('searchlight', effects.searchlight)}
    ${nightEffectBadge('night-contact', effects['night-contact'])}
    ${nightEffectBadge('star-shell', effects['star-shell'])}
    <span class="s-night-friendly ${friendlyState}" tabindex="0" role="img" aria-label="${esc(friendlyTitle)}" title="${esc(friendlyTitle)}">
      ${friendlyFleetIconHtml('anchor')}
      ${friendlyShips.length ? `<span class="s-friendly-hover" aria-hidden="true">${friendlyShips.map(ship => `<span>${esc(ship)}</span>`).join('')}</span>` : ''}
    </span>
  </div>
  ${nightEntryHtml(entry, title)}
</div>`;

const systemSignal = (
    kind: string,
    label: string,
    value: string,
    state: 'on' | 'off' | 'warn' | 'predicted',
    title: string,
    supportKind: TacticalSupportKind | null = null,
    contactEquipment?: { icon: number; short: string; name: string } | null,
    supportShipVariant: SupportShipVariant = 'yamato',
    aswSupportVariant: AswSupportVariant = 'ka2',
    friendlyVariant: FriendlyFleetVariant = 'anchor',
    hoverHtml = '',
) => {
    let glyph = '';
    if (kind === 'support') glyph = tacticalSupportIconHtml(supportKind ?? 'shell', supportShipVariant, aswSupportVariant);
    else if (kind === 'lbas') glyph = lbasAircraftIconHtml();
    else if (kind === 'search') glyph = searchRadarIconHtml();
    else if (kind === 'contact') glyph = contactIconHtml(value, contactEquipment);
    else if (kind === 'aaci') glyph = aaciGunIconHtml();
    else if (kind === 'friendly') glyph = friendlyFleetIconHtml(friendlyVariant);
    const valueHtml = value ? `<b class="s-system-val">${esc(value)}</b>` : '';
    const hoverBadge = hoverHtml ? `<span class="s-system-hover" aria-hidden="true">${hoverHtml}</span>` : '';
    const copyHtml = kind === 'contact' ? '' : `<span class="s-system-copy"><span class="s-system-label">${esc(label)}</span>${valueHtml}</span>`;
    const signalTitle = kind === 'contact' || kind === 'aaci' ? '' : title;
    const titleAttr = signalTitle ? ` title="${esc(signalTitle)}"` : '';
    return `<div class="s-system-signal ${kind} ${state}"${titleAttr}>
      ${glyph}
      ${copyHtml}
      ${hoverBadge}
    </div>`;
};

// ── 出擊對照 CSS（左右平衡與底部等寬模組）────────────────────────────────────
const extraCss = `
html, body {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  height: auto !important;
  min-height: 100vh !important;
}

.pv-notes {
  margin: 12px 0 16px;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--panel);
  border: 1px solid var(--line);
  font-size: 12.5px;
  line-height: 1.6;
}
.pv-notes b { color: var(--sparkle); }
.pv-notes ul { margin: 6px 0 0 18px; padding: 0; }
.pv-notes li { margin: 3px 0; color: var(--dim); }

.pv-bar {
  display: flex;
  gap: 6px;
  margin: 10px 0 12px;
  flex-wrap: wrap;
}
.pv-bar button {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--dim);
  font-size: 12px;
  cursor: pointer;
}
.pv-bar button.on {
  border-color: var(--sparkle);
  color: var(--sparkle);
  background: color-mix(in srgb, var(--sparkle) 12%, var(--panel));
}

.pv-wins {
  display: flex;
  gap: 12px;
  flex-wrap: nowrap;
  align-items: flex-start;
  overflow-x: auto;
}
.pv-win {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 420px;
  min-width: 420px;
  flex: 0 0 auto;
}
.pv-win-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  color: var(--dim);
}
.pv-win.pv-left .pv-win-label { color: var(--text); }
.pv-win.pv-right .pv-win-label { color: var(--sparkle); }
.pv-app {
  width: 420px;
  height: 850px;
  max-height: 850px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, .4);
  display: flex;
  flex-direction: column;
}
.pv-measure {
  font-size: 11px;
  color: var(--dim);
  line-height: 1.4;
  padding: 4px 2px;
  width: 420px;
  max-width: 420px;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.pv-measure.over { color: var(--dmg-major); }

.pv-prop #tabpanel {
  overflow: hidden;
}
.pv-prop .sortie-container {
  box-sizing: border-box;
  height: 258px;
  max-height: 258px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 0;
  padding: 0;
  background: transparent;
}
.pv-prop .s-header { height: 21px; min-height: 21px; flex: none; gap: 4px; }
.pv-prop .s-header-right { display: none; }
.pv-prop .s-map-id { border-radius: 2px; padding: 2px 4px; }
.pv-prop .s-gauge { flex: 0 0 auto; }
.pv-prop .s-nodes {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  flex-wrap: nowrap;
  gap: 2px;
  /* 目前節點的藍綠／紅色光暈不能被容器左緣吃掉；內縮只佔節點列
     自己的可用空間，不會把量表或後續戰鬥欄位往外推。 */
  padding-inline: 4px;
  box-sizing: border-box;
}

.pv-prop .pv-final-gauge {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; min-width: 0;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pv-prop .pv-final-gauge-track {
  position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 50px; width: 50px; height: 13px;
  box-sizing: border-box; overflow: hidden; border-radius: 999px;
  background: var(--gauge-track); border: 1px solid color-mix(in srgb, var(--dmg-major) 72%, var(--line));
}
.pv-prop .pv-final-gauge-track > i {
  position: absolute; inset: 0 auto 0 0; background: var(--dmg-major); opacity: .84;
}
.pv-prop .pv-final-gauge-track > b {
  position: relative; z-index: 1; color: #e0bd70; font-size: 8px; font-weight: 700; letter-spacing: .04em; line-height: 1;
}
.pv-prop .pv-final-gauge-value { display: inline-flex; align-items: baseline; gap: 1px; line-height: 1; }
.pv-prop .pv-final-gauge-value strong { color: var(--dmg-major); font-size: 9px; font-weight: 750; }
.pv-prop .pv-final-gauge-value small { color: #8caab8; font-size: 7.5px; }
.pv-prop .pv-final-gauge.normal .pv-final-gauge-track {
  border-color: color-mix(in srgb, var(--brass) 70%, var(--line));
}
.pv-prop .pv-final-gauge.normal .pv-final-gauge-track > i {
  background: var(--brass);
  opacity: .86;
}
.pv-prop .pv-final-gauge.normal .pv-final-gauge-value strong { color: var(--text); }

.pv-prop .s-node {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #1a1a1a;
  border: 1px solid #555;
  color: #ccc;
  font-size: 8px;
  box-shadow: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pv-prop .s-node.visited {
  background: #8b0000;
  border-color: #ff4444;
  color: #fff;
  box-shadow: 0 0 4px rgba(255, 0, 0, .38);
}
.pv-prop .s-node.boss {
  width: 17px;
  height: 21px;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  position: relative;
  top: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.pv-prop .s-node.boss::before,
.pv-prop .s-node.boss::after { display: none; }
.pv-prop .s-node.boss .s-boss-node-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.pv-prop .s-node.boss .s-boss-head {
  fill: #3a1515;
  stroke: #250909;
  stroke-width: 4.5px;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.pv-prop .s-node.boss .s-boss-letter {
  fill: #b09090;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 50px;
  font-weight: 900;
}
.pv-prop .s-node.boss.visited {
  background: transparent;
  border: none;
  filter: drop-shadow(0 0 3px rgba(255, 0, 0, .5));
}
.pv-prop .s-node.boss.visited .s-boss-head {
  fill: #bd1616;
  stroke: #480505;
  stroke-width: 4.5px;
}
.pv-prop .s-node.boss.visited .s-boss-letter { fill: #ffffff; }

/* 所有 node 共用 21px 的垂直文字框；一般 node 仍以圓形內圈呈現，
   讓圓形字母基準與含角的 boss 字母一致，不因外框高度不同而上下跳動。 */
.pv-prop .s-node:not(.boss) {
  width: 16px;
  height: 21px;
  padding: 2.8px 0 0;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  background: transparent;
  position: relative;
  top: 0;
  box-shadow: none;
  isolation: isolate;
}
.pv-prop .s-node:not(.boss)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3.9px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1px solid #555;
  border-radius: 50%;
  background: #1a1a1a;
  box-shadow: none;
  z-index: -1;
}
.pv-prop .s-node:not(.boss).visited::before {
  border-color: #ff4444;
  background: #8b0000;
  box-shadow: 0 0 4px rgba(255, 0, 0, .38);
}
.pv-prop .s-node:not(.boss).no-battle::before {
  border-color: #5aaecb;
  background: #16465f;
  box-shadow: 0 0 4px rgba(77, 180, 204, .42);
}
.pv-prop .s-node:not(.boss).branch {
  color: #18232d;
}
.pv-prop .s-node:not(.boss).branch::before {
  border-color: #f0f1e8;
  background: #f0f1e8;
  box-shadow: 0 0 4px rgba(235, 239, 232, .34);
}
.pv-prop .s-node:not(.boss).current::before {
  box-shadow:
    0 0 0 1px rgba(102, 218, 201, .84),
    0 0 8px 2px rgba(69, 188, 199, .58);
}
.pv-prop .s-node.boss.current {
  filter:
    drop-shadow(0 0 3px rgba(102, 218, 201, .84))
    drop-shadow(0 0 8px rgba(69, 188, 199, .58));
}

/* ── 戰鬥核心列（左右平衡 B：密度補償與同高底板）── */
.pv-prop .s-battle-row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr);
  grid-template-rows: auto 163px;
  column-gap: 10px;
  row-gap: 2px;
  margin-top: 1px;
}

.pv-prop .s-eside {
  grid-column: 1;
  grid-row: 1 / span 2;
  height: 181px;
  min-height: 181px;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0;
  padding: 12px 7px 4px;
  align-self: stretch;
  box-sizing: border-box;
  border: 0;
  border-radius: 4px;
  background: color-mix(in srgb, var(--panel) 32%, transparent);
  min-width: 0;
  overflow: hidden;
}

.pv-prop .s-efleet-heads,
.pv-prop .s-efleet-body {
  grid-column: 2;
  padding-inline: 7px;
  background: color-mix(in srgb, var(--panel) 30%, transparent);
}
.pv-prop .s-efleet-heads {
  grid-row: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 6px;
  border-radius: 4px 4px 0 0;
}
.pv-prop .s-efleet-heads.single { grid-template-columns: 1fr; }
.pv-prop .s-efleet-body {
  grid-row: 2;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(0, 1fr);
  gap: 4px 6px;
  align-content: stretch;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border-radius: 0 0 4px 4px;
}
.pv-prop .s-efleet-heads:not(.single),
.pv-prop .s-efleet-body:not(.single) {
  /* 連合艦隊右欄總寬固定，只把少量寬度由隨伴讓給主隊。 */
  grid-template-columns: minmax(0, .96fr) minmax(0, 1.04fr);
  grid-template-rows: minmax(0, 1fr);
}
.pv-prop .s-efleet-body.single { grid-template-columns: 1fr; }
.pv-prop .s-ecol-body { display: flex; flex-direction: column; justify-content: flex-start; gap: 2px; height: 100%; min-height: 0; min-width: 0; }
.pv-prop .s-ecol-h {
  min-height: 15px;
  box-sizing: border-box;
  padding: 1px 0 2px;
  margin: 0;
  font-size: 10px;
  line-height: 1.2;
}

.pv-prop .s-echip {
  display: flex;
  flex: 0 0 25px;
  flex-direction: column;
  justify-content: space-between;
  box-sizing: border-box;
  padding: 2px 5px;
  min-height: 25px;
  height: 25px;
  background: var(--panel);
  border: .5px solid var(--line);
  border-radius: 4px;
}
.pv-prop .s-echip-name {
  display: block;
  font-size: 10.5px;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pv-prop .s-echip-hp {
  display: block;
  width: auto;
  flex: 0 0 4px;
  height: 4px;
  margin-top: 2px;
  background: var(--line);
  border-radius: 2px;
  overflow: hidden;
}
.pv-prop .s-efleet-body:not(.single) .s-echip { padding-inline: 5px; }
.pv-prop .s-efleet-body:not(.single) .s-echip-name { font-size: 10.5px; }
.pv-prop .s-efleet-body:not(.single) .s-echip-hp { width: auto; }
.pv-prop .s-echip.sunk .s-echip-name { text-decoration: line-through; color: var(--dim); }

/* ── 左側決策順序 ── */
.pv-prop .s-priority-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  height: 27px;
  min-height: 27px;
  align-items: center;
  align-content: center;
  padding: 0;
  box-sizing: border-box;
}
.pv-prop .s-priority-item {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  color: var(--dim);
  font-size: 9px;
  white-space: nowrap;
}
.pv-prop .s-priority-item b {
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
  color: var(--text);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pv-prop .s-priority-item.good b { color: #58a55c; }
.pv-prop .s-priority-item.bad b { color: var(--dmg-major); }
.pv-prop .s-priority-item.warn b { color: var(--dmg-mid); }

.pv-prop .s-rank-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
  align-items: center;
  height: 33px;
  min-height: 33px;
  padding: 4px 0;
  box-sizing: border-box;
  position: relative;
}
.pv-prop .s-rank-row::before,
.pv-prop .s-rank-row::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  border-color: var(--line);
  border-style: solid;
}
.pv-prop .s-rank-row::before { top: 0; border-width: 1px 0 0; }
.pv-prop .s-rank-row::after { bottom: 0; border-width: 0 0 1px; }

.pv-prop .s-rank-result {
  display: grid;
  /* 長 rank 名稱保留完整；先縮小圖示欄與間距，不能用省略號取代結果文字。 */
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.pv-prop .s-rank-grade {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 21px;
  box-sizing: border-box;
  font-family: Georgia, "Times New Roman", "Noto Serif TC", serif;
  font-size: 21px;
  font-style: italic;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -.09em;
  transform: skewX(-5deg);
  -webkit-text-stroke: .55px currentColor;
  text-shadow: 1px 1px 0 color-mix(in srgb, var(--bg) 84%, transparent), 0 0 3px color-mix(in srgb, currentColor 45%, transparent);
}
.pv-prop .s-rank-grade.rank-ss { color: #ffe066; }
.pv-prop .s-rank-grade.rank-s { color: #f3d342; }
.pv-prop .s-rank-grade.rank-a { color: #ef4b3f; }
.pv-prop .s-rank-grade.rank-b { color: #ed762e; }
.pv-prop .s-rank-grade.rank-c { color: #e8d047; }
.pv-prop .s-rank-grade.rank-d { color: #4fc363; }
.pv-prop .s-rank-grade.rank-e { color: #4d8ee8; }
.pv-prop .s-rank-grade.rank-unknown { color: var(--dim); }
.pv-prop .s-rank-grade.predicted { opacity: .72; filter: saturate(.72); }
.pv-prop .s-rank-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 9.5px;
  letter-spacing: -.03em;
  font-weight: 650;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv-prop .s-formation-compact {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  width: 100%;
  min-width: 0;
  color: var(--dim);
  font-size: 10px;
  white-space: nowrap;
  box-sizing: border-box;
}
.pv-prop .s-formation-compact .s-formation-readout {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  line-height: 1;
}
.pv-prop .s-formation-icon { color: var(--brass); }
.pv-prop .s-formation-compact .s-formation-current {
  width: 22px;
  height: 22px;
  color: var(--dim);
  display: inline-flex;
}
.pv-prop .s-formation-compact .s-formation-readout b {
  color: var(--text);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

/* ── 飛機戰損格與大破警示（預設實心警示／點選半透明透視）── */
.pv-prop .s-air-wrap {
  position: relative;
  height: 44px;
  min-height: 44px;
  padding: 0;
  box-sizing: border-box;
}
.pv-prop .s-air-loss-grid {
  display: grid;
  /* 預覽必須沿用正式版的列高與垂直置中，避免點開大破警示後
     紅框上緣壓住「我方／敵方」標題。 */
  grid-template-rows: 9px repeat(2, 13px);
  gap: 1px 0;
  height: 100%;
  min-height: 0;
  padding: 0;
  box-sizing: border-box;
  align-content: center;
}
.pv-prop .s-air-loss-head,
.pv-prop .s-air-loss-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr);
  align-items: center;
  min-width: 0;
}
.pv-prop .s-air-loss-head {
  color: #dfb95f;
  font-size: 8.5px;
  line-height: 1;
  text-align: center;
}
.pv-prop .s-air-loss-head span { color: var(--dim); }
.pv-prop .s-air-loss-head b { font-weight: 700; }
.pv-prop .s-air-loss-head b:last-child { color: #dfb95f; }

.pv-prop .s-air-kind {
  color: var(--dim);
  font-size: 8px;
  text-align: center;
  line-height: 1;
}
.pv-prop .s-air-kind.fighter { color: #58a55c; }
.pv-prop .s-air-kind.bomber { color: var(--dmg-major); }

.pv-prop .s-air-loss-cell {
  display: flex;
  align-items: baseline;
  gap: 2px;
  min-width: 0;
  font-size: 10px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  justify-content: center;
}
.pv-prop .s-air-loss-cell b { color: var(--text); font-weight: 700; font-size: 10px; }
.pv-prop .s-air-loss-cell i { color: var(--dmg-major); font-size: 8px; font-style: normal; font-weight: 700; }

.pv-prop .s-taiha {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  border: 1px solid var(--dmg-major);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 6px;
  box-sizing: border-box;
  line-height: 1.2;
  font-family: inherit;
  margin: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
  z-index: 2;
}
.pv-prop .s-taiha.open {
  top: 0;
  bottom: 0;
  height: 100%;
  background: color-mix(in srgb, var(--dmg-major) 40%, var(--panel));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.pv-prop .s-taiha.open .taiha-head {
  display: block;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.1;
}
.pv-prop .s-taiha.open .taiha-hint {
  font-size: 9px;
  font-weight: 650;
  line-height: 1.3;
  text-align: center;
  color: #ffffff;
  display: block;
  white-space: pre-line;
}
.pv-prop .s-taiha.open.s-taiha-generic.details-hidden { background: transparent; }
.pv-prop .s-taiha-generic.details-hidden .taiha-head,
.pv-prop .s-taiha-generic.details-hidden .taiha-hint { display: none; }
/* ── 夜戰裝備與友軍 ── */
.pv-prop .s-night-effects {
  display: flex;
  align-items: center;
  align-content: center;
  height: 23px;
  min-height: 23px;
  min-width: 0;
  padding: 2px 0;
  box-sizing: border-box;
}
.pv-prop .s-night-friendly {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 20px;
  height: 18px;
  min-height: 18px;
  margin-left: 3px;
  color: var(--dim);
  line-height: 1;
  white-space: nowrap;
  cursor: help;
  outline: none;
}
.pv-prop .s-night-friendly.on { color: var(--sparkle); }
.pv-prop .s-night-friendly.off .s-system-glyph { opacity: .38; }
.pv-prop .s-night-friendly.warn { color: var(--dmg-mid); }
.pv-prop .s-night-friendly.predicted { color: var(--text); }
.pv-prop .s-night-friendly .s-system-glyph { width: 20px; height: 18px; flex: 0 0 20px; }
.pv-prop .s-night-friendly .s-friendly-hover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 4px);
  z-index: 6;
  display: none;
  min-width: max-content;
  max-width: calc(100vw - 16px);
  padding: 3px 6px;
  transform: translateX(-50%);
  border: 1px solid #9b9b9b;
  border-radius: 3px;
  background: #f4f4f4;
  color: #171717;
  box-shadow: 0 2px 6px rgba(0,0,0,.28);
  font-size: 9px;
  font-weight: 500;
  line-height: 1.25;
  white-space: normal;
  overflow-wrap: anywhere;
  pointer-events: none;
}
.pv-prop .s-night-friendly .s-friendly-hover > span { display: block; }
.pv-prop .s-night-friendly:hover .s-friendly-hover,
.pv-prop .s-night-friendly:focus-visible .s-friendly-hover { display: block; }
.pv-prop .s-night-friendly:focus-visible { outline: 1px solid var(--sparkle); outline-offset: 1px; }
.pv-prop .s-night-equipment-list {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  min-height: 18px;
  min-width: 0;
}
.pv-prop .s-night-effect {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 18px;
  flex: 0 0 20px;
  color: var(--dim);
  cursor: help;
}
.pv-prop .s-night-effect.on { color: var(--sparkle); opacity: 1; }
.pv-prop .s-night-effect.off { color: var(--dim); opacity: .34; }
.pv-prop .s-night-effect.unknown { color: var(--text); opacity: .56; }
.pv-prop .s-night-effect .g-icon { display: block; width: 20px; height: 20px; object-fit: contain; }
.pv-prop .s-night-entry-available {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  width: 16px;
  height: 16px;
  color: var(--sparkle);
  cursor: help;
}
.pv-prop .s-night-entry-available .s-night-moon { display: block; width: 12px; height: 12px; object-fit: contain; }
.pv-prop .s-night-entry-group {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex: 0 0 auto;
  min-width: 0;
  margin-left: auto;
  padding-left: 8px;
  height: 18px;
  white-space: nowrap;
}
.pv-prop .s-night-entry-moon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--sparkle);
  line-height: 1;
  width: 16px;
  height: 18px;
  flex: 0 0 16px;
}
.pv-prop .s-night-entry-moon .s-night-moon { display: block; width: 16px; height: 16px; object-fit: contain; }
.pv-prop .s-night-entry-cells {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  height: 18px;
  white-space: nowrap;
}
.pv-prop .s-night-entry-cell {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 8px;
  min-width: 0;
  color: var(--dim);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Noto Sans CJK TC", "Noto Sans TC", sans-serif;
  font-size: 8.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.pv-prop .s-night-entry-cell i {
  display: inline-block;
  width: 5px;
  height: 5px;
  flex: 0 0 5px;
  border: 1px solid currentColor;
  border-radius: 50%;
  box-sizing: border-box;
  opacity: .62;
}
.pv-prop .s-night-entry-cell.active { color: var(--sparkle); font-weight: 550; }
.pv-prop .s-night-entry-cell.active i { background: currentColor; opacity: 1; }
.pv-prop .s-night-entry-group.unknown .s-night-entry-cell { opacity: .82; }
.pv-prop .s-night-entry-group.unavailable { opacity: .34; }
.pv-prop .s-night-entry-label { min-width: 0; overflow: visible; white-space: nowrap; font-size: 0; }
.pv-prop .s-night-entry-label::before { content: attr(data-label-zh); font-size: 8px; }

/* ── 最下列系統圖示與 Drop 列（底部 A 等寬雙模組）── */
.pv-prop .s-action-rail.with-system {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 8px;
  gap: 0;
  height: 35px;
  min-height: 35px;
  margin-top: 4px;
  margin-bottom: 0;
  border-top: 0;
}
.pv-prop .s-action-rail.with-system > .s-system-rail,
.pv-prop .s-action-rail.with-system > .s-drop-slot {
  min-width: 0;
  max-width: 100%;
}
.pv-prop .s-action-rail.with-system > .s-system-rail { grid-column: 1; }
.pv-prop .s-action-rail.with-system > .s-drop-slot { grid-column: 2; }
.pv-prop .s-action-rail.with-system > .s-system-rail {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(5, minmax(35px, 1fr));
  justify-content: center;
  column-gap: 2px;
  height: 35px;
  min-height: 35px;
  border: 0;
  /* Keep the last AA-CI cell inside the left module before the drop slot. */
  padding: 0 8px 0 0;
  box-sizing: border-box;
}
.pv-app .sortie-combined-fleet {
  gap: 2px;
}
.pv-app .sortie-combined-fleet .c-fleet-row {
  gap: 8px;
}
.pv-app .sortie-combined-fleet section.fleet.compact {
  min-width: 0;
}
.pv-prop .s-system-signal {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0;
  width: auto;
  min-width: 0;
  overflow: visible;
  color: var(--dim);
  line-height: 1;
}
.pv-prop .s-system-signal.search { row-gap: 2px; }
.pv-prop .s-system-signal.search.on { color: var(--sparkle); }
.pv-prop .s-system-signal.contact .s-system-val { display: none; }
.pv-prop .s-system-glyph {
  width: 20px;
  height: 18px;
  flex: 0 0 18px;
  display: block;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pv-prop .s-system-glyph.support-shell,
.pv-prop .s-system-glyph.support-torpedo { width: 28px; }
.pv-prop .s-system-copy {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK TC", "Noto Sans TC", sans-serif;
  font-size: 8.5px;
  line-height: 1;
  min-height: 9px;
  letter-spacing: .015em;
  -webkit-font-smoothing: antialiased;
}
.pv-prop .s-system-label {
  color: var(--dim);
  font-family: inherit;
  font-size: 8.5px;
  font-weight: 500;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-prop .s-system-signal.support .s-system-label,
.pv-prop .s-system-signal.lbas .s-system-label {
  overflow: visible;
  text-overflow: clip;
  letter-spacing: -.04em;
}
.pv-prop .s-system-signal.aaci .s-system-label,
.pv-prop .s-system-signal.aaci .s-system-val {
  overflow: visible;
  text-overflow: clip;
  letter-spacing: -.06em;
  font-size: 7.5px;
}
.pv-prop .s-system-signal.aaci {
  padding-inline-end: 6px;
  box-sizing: border-box;
}
.pv-prop .s-system-copy b,
.pv-prop .s-system-copy .s-system-val {
  color: currentColor;
  font-family: inherit;
  font-size: 8.5px;
  font-weight: 500;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

/* 未抵達 / 未發動：使用灰色（灰階＋清晰亮度對比） */
.pv-prop .s-system-signal.off .s-system-glyph,
.pv-prop .s-system-signal:not(.on):not(.warn) .s-system-glyph {
  opacity: .82;
  color: var(--dim);
}
.pv-prop .s-system-signal.off .support-ship-raster,
.pv-prop .s-system-signal.off .support-torpedo-raster,
.pv-prop .s-system-signal.off .support-aircraft-raster,
.pv-prop .s-system-signal.off .support-asw-raster,
.pv-prop .s-system-signal.off .lbas-aircraft-raster,
.pv-prop .s-system-signal.off .aaci-gun-raster,
.pv-prop .s-system-signal.off .friendly-fleet-raster,
.pv-prop .s-system-signal:not(.on):not(.warn) .support-ship-raster,
.pv-prop .s-system-signal:not(.on):not(.warn) .support-torpedo-raster,
.pv-prop .s-system-signal:not(.on):not(.warn) .support-aircraft-raster,
.pv-prop .s-system-signal:not(.on):not(.warn) .support-asw-raster,
.pv-prop .s-system-signal:not(.on):not(.warn) .lbas-aircraft-raster,
.pv-prop .s-system-signal:not(.on):not(.warn) .aaci-gun-raster,
.pv-prop .s-system-signal:not(.on):not(.warn) .friendly-fleet-raster {
  filter: grayscale(100%) brightness(0.92);
  opacity: .82;
}

[data-theme="light"] .pv-prop .s-system-signal.off .support-ship-raster,
[data-theme="light"] .pv-prop .s-system-signal.off .support-torpedo-raster,
[data-theme="light"] .pv-prop .s-system-signal.off .support-aircraft-raster,
[data-theme="light"] .pv-prop .s-system-signal.off .support-asw-raster,
[data-theme="light"] .pv-prop .s-system-signal.off .lbas-aircraft-raster,
[data-theme="light"] .pv-prop .s-system-signal.off .aaci-gun-raster,
[data-theme="light"] .pv-prop .s-system-signal.off .friendly-fleet-raster,
[data-theme="light"] .pv-prop .s-system-signal:not(.on):not(.warn) .support-ship-raster,
[data-theme="light"] .pv-prop .s-system-signal:not(.on):not(.warn) .support-torpedo-raster,
[data-theme="light"] .pv-prop .s-system-signal:not(.on):not(.warn) .support-aircraft-raster,
[data-theme="light"] .pv-prop .s-system-signal:not(.on):not(.warn) .support-asw-raster,
[data-theme="light"] .pv-prop .s-system-signal:not(.on):not(.warn) .lbas-aircraft-raster,
[data-theme="light"] .pv-prop .s-system-signal:not(.on):not(.warn) .aaci-gun-raster,
[data-theme="light"] .pv-prop .s-system-signal:not(.on):not(.warn) .friendly-fleet-raster {
  filter: grayscale(100%) brightness(0.48);
  opacity: .88;
}

/* 抵達 / 發動：使用原黃銅金色 */
.pv-prop .s-system-signal.on .s-system-glyph,
.pv-prop .s-system-signal.on .support-ship-raster,
.pv-prop .s-system-signal.on .support-torpedo-raster,
.pv-prop .s-system-signal.on .support-aircraft-raster,
.pv-prop .s-system-signal.on .support-asw-raster,
.pv-prop .s-system-signal.on .lbas-aircraft-raster,
.pv-prop .s-system-signal.on .aaci-gun-raster,
.pv-prop .s-system-signal.on .friendly-fleet-raster {
  filter: none;
  opacity: 1;
}
.pv-prop .s-system-signal.on .s-system-label {
  color: var(--sparkle);
  font-weight: 500;
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
}
.pv-prop .s-system-signal.on .s-system-copy b,
.pv-prop .s-system-signal.on .s-system-copy .s-system-val {
  color: var(--sparkle);
  font-weight: 500;
}

.pv-prop .s-system-signal.warn .s-system-label {
  color: var(--dmg-mid);
  font-weight: 500;
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
}
.pv-prop .s-system-signal.warn .s-system-copy b,
.pv-prop .s-system-signal.warn .s-system-copy .s-system-val {
  color: var(--dmg-mid);
  font-weight: 500;
}

.pv-prop .s-system-signal:hover,
.pv-prop .s-system-signal:focus-within { z-index: 5; overflow: visible; }
.pv-prop .s-system-hover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 4px);
  display: none;
  min-width: max-content;
  padding: 3px 6px;
  transform: translateX(-50%);
  border: 1px solid #9b9b9b;
  border-radius: 3px;
  background: #f4f4f4;
  color: #171717;
  box-shadow: 0 2px 6px rgba(0,0,0,.28);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK TC", "Noto Sans TC", sans-serif;
  font-size: 9px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  -webkit-font-smoothing: antialiased;
}
.pv-prop .s-system-signal:hover .s-system-hover,
.pv-prop .s-system-signal:focus-within .s-system-hover { display: inline-flex; align-items: baseline; gap: 4px; }
.pv-prop .s-system-signal.aaci .s-system-hover {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  white-space: nowrap;
}
.pv-prop .s-system-hover b { color: #171717; font-size: 9px; font-weight: 600; font-family: inherit; font-variant-numeric: tabular-nums; }
.pv-prop .s-system-hover i { color: var(--dmg-major); font-size: 9px; font-style: normal; font-weight: 600; font-family: inherit; font-variant-numeric: tabular-nums; }
.pv-prop .s-system-signal.aaci .s-system-hover {
  min-width: 0;
  width: max-content;
  max-width: calc(100vw - 16px);
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.25;
}
.pv-prop .s-system-signal.aaci .s-system-hover > span { display: block; }
.pv-prop .s-system-signal.aaci .s-aaci-gear { padding-left: 4px; }

.pv-prop .s-system-glyph .support-ship-raster,
.pv-prop .s-system-glyph .support-torpedo-raster,
.pv-prop .s-system-glyph .support-aircraft-raster,
.pv-prop .s-system-glyph .support-asw-raster,
.pv-prop .s-system-glyph .lbas-aircraft-raster,
.pv-prop .s-system-glyph .aaci-gun-raster,
.pv-prop .s-system-glyph .friendly-fleet-raster {
  display: block;
  width: 20px;
  height: 18px;
  object-fit: contain;
}
.pv-prop .s-system-glyph.support-shell .support-ship-raster { width: 28px; }
.pv-prop .s-system-glyph.support-torpedo .support-torpedo-raster { width: 28px; height: 18px; }
.pv-prop .s-system-glyph.support-asw .support-asw-raster { width: 20px; height: 18px; }

/* 敵我觸接要保留兩個方向的圖示，並排而非互相覆蓋。 */
.pv-prop .s-system-glyph.contact-both {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 30px;
  height: 18px;
  flex: 0 0 30px;
  overflow: visible;
}
.pv-prop .s-system-glyph.contact-both .contact-sub {
  position: static;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 16px;
  flex: 0 0 13px;
  overflow: visible;
}
.pv-prop .s-system-glyph.contact-single {
  position: relative;
  width: 20px;
  height: 18px;
  overflow: visible;
}
.pv-prop .s-system-glyph.contact-single > .g-icon,
.pv-prop .s-system-glyph.contact-single > .deepsea-aircraft-raster {
  display: block;
  width: 16px;
  height: 16px;
  margin: 1px auto;
  object-fit: contain;
}
.pv-prop .s-contact-hover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 4px);
  z-index: 20;
  display: none;
  min-width: max-content;
  padding: 3px 6px;
  transform: translateX(-50%);
  border: 1px solid #9b9b9b;
  border-radius: 3px;
  background: #f4f4f4;
  color: #171717;
  box-shadow: 0 2px 6px rgba(0,0,0,.28);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Noto Sans CJK TC", "Noto Sans TC", sans-serif;
  font-size: 9px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  -webkit-font-smoothing: antialiased;
}
.pv-prop .s-contact-hover.both {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.pv-prop .s-system-glyph.contact-single:hover .s-contact-hover,
.pv-prop .s-system-glyph.contact-both:hover .s-contact-hover {
  display: inline-flex;
}
.pv-prop .s-system-glyph.contact-both .contact-sub.friendly .g-icon {
  display: block;
  width: 13px;
  height: 13px;
  object-fit: contain;
}
.pv-prop .s-system-glyph.contact-both .contact-sub.enemy {
  width: 13px;
  height: 13px;
  flex-basis: 13px;
}
.pv-prop .s-system-glyph.contact-both .contact-sub.enemy.deepsea-aircraft-raster {
  display: block;
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  object-fit: contain;
}
.pv-prop .s-system-glyph.contact-both .contact-sub.enemy .deepsea-aircraft-raster {
  display: block;
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  object-fit: contain;
}

.pv-prop .s-system-glyph.search .search-sweep { fill: currentColor; stroke: currentColor; stroke-width: .35; opacity: .34; }
.pv-prop .s-system-glyph.search .search-ring.outer { stroke-width: 1.15; }
.pv-prop .s-system-glyph.search .search-ring.middle { stroke-width: .8; opacity: .62; }
.pv-prop .s-system-glyph.search .search-ring.inner { stroke-width: .7; opacity: .54; }
.pv-prop .s-system-glyph.search .search-grid { stroke-width: .7; opacity: .48; }
.pv-prop .s-system-glyph.search .search-needle { stroke-width: 1; opacity: .84; }
.pv-prop .s-system-glyph.search .search-center,
.pv-prop .s-system-glyph.search .search-blip { fill: currentColor; stroke: none; }
.pv-prop .s-system-glyph.search .search-center { opacity: .92; }
.pv-prop .s-system-glyph.search .search-blip { opacity: .86; }

/* ── 掉落格與櫻錨 ── */
.pv-prop .s-drop-divider { display: none; }
.pv-prop .s-action-rail.with-system .s-drop-slot {
  width: 100%;
  border-left: 0;
  display: flex;
  align-items: center;
}
.pv-prop .s-action-rail.with-system .s-drop-slot.filled {
  position: relative;
  height: 35px;
  min-height: 35px;
  padding-inline: 5px;
  border: 0;
  border-radius: 4px;
  background: color-mix(in srgb, var(--panel) 30%, transparent);
  box-shadow: none;
  justify-content: center;
}
.pv-prop .s-action-rail.with-system .s-drop-slot.empty {
  display: flex;
  height: 35px;
  min-height: 35px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: color-mix(in srgb, var(--panel) 30%, transparent);
  color: var(--dim);
  justify-content: center;
  align-items: center;
  line-height: 1;
  letter-spacing: 0;
}
}
.pv-prop .sakura-drop {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: auto;
  max-width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.pv-prop .sakura-drop-icon { display: inline-flex; flex: 0 0 24px; width: 24px; height: 24px; align-items: center; justify-content: center; }
.pv-prop .sakura-drop .pv-sakura-anchor { width: 24px; height: 24px; }
.pv-prop .sakura-drop-name {
  min-width: 0;
  overflow: hidden;
  color: #e2bb67;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK TC", "Noto Sans TC", sans-serif;
  font-size: 9.5px;
  font-weight: 550;
  line-height: 1;
  letter-spacing: .01em;
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-font-smoothing: antialiased;
}
.pv-prop .sakura-drop.owned .sakura-drop-name { color: #8ea0b0; }
.pv-prop .pv-sakura-anchor { display: block; width: 24px; height: 24px; object-fit: contain; }
.pv-prop .sakura-drop.new .pv-sakura-anchor {
  filter:
    drop-shadow(0 0 5px rgba(255, 218, 105, .92))
    drop-shadow(0 0 13px rgba(236, 169, 42, .62));
}
.pv-prop .sakura-drop.owned .pv-sakura-anchor { opacity: .88; }

.pv-prop .s-drop-slot.filled .s-drop-chip.sakura-drop.long-name { display: grid; grid-template-columns: 1fr; grid-template-rows: 21px 10px; justify-items: center; align-content: center; gap: 0; }
.pv-prop .sakura-drop.long-name .sakura-drop-icon { width: 21px; height: 21px; flex-basis: 21px; }
.pv-prop .sakura-drop.long-name .pv-sakura-anchor { width: 21px; height: 21px; }
.pv-prop .sakura-drop.long-name .sakura-drop-name { max-width: 126px; font-size: 8.5px; line-height: 10px; font-weight: 550; }

/* Drop 欄固定為「櫻錨在前、艦名在後」，長艦名也不改成上下堆疊。 */
.pv-prop .s-action-rail.with-system .s-drop-slot.filled .s-drop-chip.sakura-drop.long-name {
  display: inline-flex;
  grid-template-columns: none;
  grid-template-rows: none;
  align-items: center;
  justify-items: initial;
  align-content: initial;
  gap: 5px;
}
.pv-prop .s-action-rail.with-system .sakura-drop.long-name .sakura-drop-icon {
  width: 24px;
  height: 24px;
  flex-basis: 24px;
}
.pv-prop .s-action-rail.with-system .sakura-drop.long-name .pv-sakura-anchor {
  width: 24px;
  height: 24px;
}
.pv-prop .s-action-rail.with-system .sakura-drop.long-name .sakura-drop-name {
  max-width: calc(100% - 29px);
  font-size: 9.5px;
  line-height: 1;
}

.pv-drop-reference,
.pv-support-reference,
.pv-air-loss-reference,
.pv-formation-board {
  max-width: 900px;
  margin: 0 0 16px;
  padding: 8px 12px 10px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.pv-drop-reference-head,
.pv-support-reference-head,
.pv-air-loss-reference-head,
.pv-formation-board-head { display: flex; align-items: baseline; gap: 8px; color: var(--dim); font-size: 10px; margin-bottom: 7px; }
.pv-drop-reference-head b,
.pv-support-reference-head b,
.pv-air-loss-reference-head b,
.pv-formation-board-head b { color: var(--text); font-size: 11px; }

.pv-drop-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.pv-drop-option { min-width: 0; padding: 6px 7px 7px; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--bg) 48%, transparent); }
.pv-drop-option-head { display: flex; align-items: baseline; justify-content: space-between; gap: 5px; margin-bottom: 6px; }
.pv-drop-option-head b { color: var(--text); font-size: 10px; }
.pv-drop-option-head em { color: var(--brass); font-size: 8px; font-style: normal; }
.pv-drop-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.pv-drop-state { min-width: 0; min-height: 56px; display: grid; grid-template-columns: 39px minmax(0, 1fr); align-items: center; gap: 4px; padding: 5px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); }
.pv-drop-state.new { border-color: color-mix(in srgb, var(--sparkle) 72%, var(--line)); background: color-mix(in srgb, var(--sparkle) 8%, var(--panel)); }
.pv-drop-icon { display: flex; align-items: center; justify-content: center; width: 39px; height: 39px; }
.pv-sakura-anchor { display: block; width: 38px; height: 38px; object-fit: contain; }
.pv-drop-state.new .pv-sakura-anchor {
  filter:
    drop-shadow(0 0 5px rgba(255, 218, 105, .92))
    drop-shadow(0 0 13px rgba(236, 169, 42, .62));
}
.pv-drop-state.owned .pv-sakura-anchor { opacity: .88; }
.pv-drop-copy { min-width: 0; }
.pv-drop-copy b { display: block; overflow: hidden; font-size: 12px; font-weight: 750; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
.pv-drop-state.new .pv-drop-copy b { color: #e2bb67; }
.pv-drop-state.owned .pv-drop-copy b { color: #8ea0b0; }

.pv-support-reference-items { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.pv-support-reference-item { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; color: var(--dim); font-size: 10px; min-width: 76px; }
.pv-support-reference-item .s-system-glyph { width: 20px; height: 18px; color: var(--sparkle); }
.pv-support-reference-item .s-system-glyph.support-shell { width: 28px; }
.pv-support-reference-item.active { padding: 4px 8px 5px; border: 1px solid color-mix(in srgb, var(--brass) 74%, var(--line)); border-radius: 4px; background: color-mix(in srgb, var(--bg) 48%, transparent); }
.pv-support-reference-item b { color: var(--text); font-weight: 650; }
.pv-support-reference-item em { color: var(--brass); font-size: 9px; font-style: normal; }

.s-formation-icon { width: 22px; height: 22px; display: block; flex: none; }
.s-formation-icon.selected { color: var(--sparkle); }
.pv-formation-groups { display: flex; flex-wrap: wrap; gap: 12px 20px; }
.pv-formation-group { min-width: 260px; }
.pv-formation-group-label { display: block; color: var(--brass); font-size: 10px; letter-spacing: var(--track-label); margin-bottom: 4px; }
.pv-formation-grid { display: flex; flex-wrap: wrap; gap: 5px 8px; }
.pv-formation-item { display: inline-flex; align-items: center; gap: 3px; color: var(--dim); font-size: 9px; white-space: nowrap; }
.pv-formation-item .s-formation-icon { width: 25px; height: 25px; color: var(--dim); }

/* 參考畫面是定版的基準場景；所有提案場景沿用同一組欄寬與縱向節奏。 */
.pv-reference .s-battle-row {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr);
}
.pv-reference .s-header {
  margin-bottom: 0;
}
.pv-reference #header .stat b {
  color: var(--text);
}
.pv-reference #header .stat {
  font-size: 14px;
}
.pv-reference .s-eside {
  grid-column: 1;
}
.pv-reference .s-efleet-heads,
.pv-reference .s-efleet-body {
  grid-column: 2;
}
.pv-reference .s-efleet-body.single .s-ecol-body {
  gap: 2px;
}
.pv-reference .s-efleet-body:not(.single) .s-ecol-body {
  gap: 2px;
}
.pv-reference .s-echip.flagship {
  border-color: color-mix(in srgb, var(--sparkle) 80%, var(--line));
}
.pv-reference .s-echip-name {
  font-size: 10.5px;
}
.pv-reference .s-echip-hp {
  height: 4px;
}
.pv-reference .s-night-effects {
  opacity: 1;
}
.pv-reference .s-night-entry-moon .s-night-moon {
  width: 16px;
  height: 16px;
}
.pv-reference .s-night-entry-cells {
  gap: 2px;
}
.pv-reference .s-system-rail {
  gap: 0;
}
.pv-reference .s-action-rail.with-system {
  column-gap: 8px;
  height: 35px;
  min-height: 35px;
}
.pv-reference .s-action-rail.with-system > .s-system-rail {
  column-gap: 2px;
  height: 35px;
  min-height: 35px;
}
.pv-reference .s-system-signal {
  overflow: visible;
}
.pv-reference .s-system-signal.contact {
  overflow: visible;
}
.pv-reference .s-system-signal.search.on {
  color: var(--sparkle);
}
.pv-reference .s-rank-result {
  gap: 2px;
}
.pv-reference .s-formation-compact {
  gap: 5px;
}
.pv-reference .s-formation-compact .s-formation-readout {
  gap: 5px;
}
.pv-reference .s-system-copy {
  font-size: 8px;
}
`;

/** Final pill 樣式 */
const finalGaugeHtml = (now: number, max: number, percent: number) => `<div class="pv-final-gauge" role="meter" aria-label="Final ${now}/${max}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}" title="Final ${now}/${max}">
  <span class="pv-final-gauge-track"><i style="width:${percent}%"></i><b>Final</b></span>
  <span class="pv-final-gauge-value"><strong>${now}</strong><small>/${max}</small></span>
</div>`;
const normalGaugeHtml = (now: number, max: number, percent: number) => `<div class="pv-final-gauge normal" role="meter" aria-label="${now}/${max}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}" title="海域量表 ${now}/${max}">
  <span class="pv-final-gauge-track"><i style="width:${percent}%"></i></span>
  <span class="pv-final-gauge-value"><strong>${now}</strong><small>/${max}</small></span>
</div>`;

type TacticalSideParams = {
    air: string; airTone: 'good' | 'bad' | 'warn'; heading: string; headingTone: 'good' | 'bad' | 'warn';
    rank: string; rankState: 'on' | 'off' | 'warn' | 'predicted'; rankResult: string; formationId: number; formation: string;
    support: string; supportKind?: TacticalSupportKind | null; supportShipVariant?: SupportShipVariant; aswSupportVariant?: AswSupportVariant; supportState: 'on' | 'off' | 'warn' | 'predicted';
    lbas: string; lbasLost?: string; lbasState: 'on' | 'off' | 'warn' | 'predicted';
    search: string; searchState: 'on' | 'off' | 'warn' | 'predicted';
    contact: string; contactState: 'on' | 'off' | 'warn' | 'predicted'; contactEquipment?: { icon: number; short: string; name: string } | null;
    aaci: string; aaciState: 'on' | 'off' | 'warn' | 'predicted';
    /** 預覽用的對空 CI 明細；正式面板由戰鬥封包與出擊快照填入同一欄位。 */
    aaciDetails?: { ship: string; type: number; gears: string[] }[];
    friendly: string; friendlyState: 'on' | 'off' | 'warn' | 'predicted'; friendlyFleetVariant?: FriendlyFleetVariant;
    fighterFriend: string; fighterFriendLost: string; fighterEnemy: string; fighterEnemyLost: string;
    bomberFriend: string; bomberFriendLost: string; bomberEnemy: string; bomberEnemyLost: string;
    nightEffects: Record<NightEffectKind, NightEffectState>; nightEntry: NightEntryState; nightTitle: string;
    warning?: boolean; retreatAvailable?: boolean; retreatKind?: 'combined' | 'striking' | 'torpedo';
};

const tacticalSideHtml = (s: TacticalSideParams) => {
    const supportActive = s.supportState === 'on' && s.support !== '—';
    const supportKindName = s.supportKind === 'air' ? '航空支援' : s.supportKind === 'asw' ? '對潛支援' : s.supportKind === 'torpedo' ? '雷擊支援' : '砲擊支援';
    const supportLabel = supportActive ? supportKindName : '支援';
    const supportValue = supportActive ? '' : s.support;
    const supportTitle = supportActive
        ? `支援艦隊已到著：${s.supportKind === 'air' ? '彗星俯視剪影' : s.supportKind === 'asw' ? (s.aswSupportVariant === 'ka2' ? 'Ka-2 旋翼機' : 'Tracker S-2') : '大和北卡風'}`
        : '支援狀態';
    const lbasActive = s.lbasState === 'on' && s.lbas !== '—';
    const lbasLabel = lbasActive ? '陸航' : '陸航';
    const lbasValue = lbasActive ? '' : s.lbas;
    const lbasTitle = lbasActive ? `陸航抵達；傷害 ${s.lbas}${s.lbasLost ? `；戰損 ${s.lbasLost}` : ''}` : '陸航狀態';
    const lbasHoverHtml = lbasActive ? `<b>${esc(s.lbas)}</b>${s.lbasLost ? `<i>${esc(s.lbasLost)}</i>` : ''}` : '';
    const searchActive = s.searchState === 'on';
    const searchFailed = s.searchState === 'warn';
    const searchLabel = searchActive || searchFailed ? '' : '索敵';
    const searchValue = searchActive ? '成功' : searchFailed ? '失敗' : s.search;
    const searchTitle = searchActive ? '命中・回避力 UP' : searchFailed ? '對空・回避力 DOWN' : '索敵結果';
    const aaciFired = s.aaciState === 'on' && s.aaci !== '—';
    const aaciLabel = aaciFired ? '' : '對空 CI';
    const aaciDetails = aaciFired ? (s.aaciDetails ?? [{
        ship: '秋月改',
        type: Number(s.aaci.replace(/\D/g, '')) || 0,
        gears: ['10cm連裝高角砲', '對空電探'],
    }]) : [];
    const aaciGearHoverHtml = (detail: { ship: string; type: number; gears: string[] }): string => detail.gears.length
        ? ['<span class="s-aaci-equipment-label">裝備：</span>', ...detail.gears.map(gear => `<span class="s-aaci-gear">・${esc(gear)}</span>`)].join('')
        : '<span class="s-aaci-equipment-label">裝備組合不可考</span>';
    const aaciHoverHtml = aaciDetails.map(detail => `<span class="s-aaci-header"><b>${esc(detail.ship)}</b>・Typ ${detail.type}</span>${aaciGearHoverHtml(detail)}`).join('');
    const aaciTitle = aaciFired
        ? [`對空 CI 發動 ${s.aaci}`, ...aaciDetails.flatMap(detail => [`${detail.ship}・Typ ${detail.type}`, `裝備：${detail.gears.join(' ＋ ')}`])].join('\n')
        : '對空 CI 狀態';
    const contactTitle = s.contact === '雙'
        ? `觸接：我方${s.contactEquipment?.name ?? '裝備圖示'}與敵方深海艦載機同時成立`
        : s.contact === '我'
            ? `觸接：我方${s.contactEquipment?.name ?? '裝備圖示'}`
            : s.contact === '敵'
                ? '觸接：敵方深海艦載機'
                : '觸接：未成立或無資料';
    const retreatText = s.retreatAvailable ? '司令部裝備，可退避' : '注意，不可退避';
    const warning = s.warning ? `<button type="button" class="taiha-alert s-taiha s-taiha-generic open" aria-expanded="true" title="大破！\n${retreatText}">
      <span class="taiha-head">大破！</span><span class="taiha-hint">${retreatText}</span>
    </button>` : '';
    const friendlyArrived = s.friendlyState === 'on';
    const friendlyShips = friendlyArrived
        ? ['武蔵改二', '清霜改二', '藤波改二', '早波改', '大井改二']
        : [];
    const friendlyTitle = friendlyArrived
        ? `友軍陣容：\n${friendlyShips.join('\n')}`
        : '友軍尚未抵達；錨標示維持黯淡';
    const airLossHtml = `<div class="s-air-loss-grid" aria-label="敵我戰鬥機與爆擊機數量及戰損">
  <div class="s-air-loss-head"><b>我方</b><span aria-hidden="true"></span><b>敵方</b></div>
  <div class="s-air-loss-row"><span class="s-air-loss-cell friendly"><b>${esc(s.fighterFriend)}</b><i>${esc(s.fighterFriendLost)}</i></span><span class="s-air-kind fighter" title="戰鬥機">戰</span><span class="s-air-loss-cell enemy"><b>${esc(s.fighterEnemy)}</b><i>${esc(s.fighterEnemyLost)}</i></span></div>
  <div class="s-air-loss-row"><span class="s-air-loss-cell friendly"><b>${esc(s.bomberFriend)}</b><i>${esc(s.bomberFriendLost)}</i></span><span class="s-air-kind bomber" title="爆擊機／攻擊機">爆</span><span class="s-air-loss-cell enemy"><b>${esc(s.bomberEnemy)}</b><i>${esc(s.bomberEnemyLost)}</i></span></div>
</div>`;
    return `<div class="s-priority-row">
  <div class="s-priority-item ${s.airTone}"><span>制空</span><b>${esc(s.air)}</b></div>
  <div class="s-priority-item ${s.headingTone}"><span>航向</span><b>${esc(s.heading)}</b></div>
</div>
<div class="s-rank-row">
  ${rankResultHtml(s.rank, s.rankState === 'predicted', s.rankState === 'predicted' ? '戰鬥結果尚未結算；目前只顯示預測 rank' : `戰鬥結果 ${s.rank} 已結算`, s.rankResult)}
  <div class="s-formation-compact">${formationReadout(s.formationId, s.formation)}</div>
</div>
<div class="s-air-wrap${s.warning ? ' covered' : ''}">
${airLossHtml}${warning}
</div>
${nightEffectsHtml(s.nightEffects, s.nightEntry, s.nightTitle, s.friendlyState, friendlyTitle, friendlyShips)}
<div class="s-system-rail" aria-label="支援、陸航、索敵、觸接與對空 CI 狀態">
  ${systemSignal('support', supportLabel, supportValue, s.supportState, supportTitle, s.supportKind ?? null, null, s.supportShipVariant ?? 'yamato', s.aswSupportVariant ?? 'ka2')}
  ${systemSignal('lbas', lbasLabel, lbasValue, s.lbasState, lbasTitle, null, null, 'yamato', 'tracker', 'anchor', lbasHoverHtml)}
  ${systemSignal('search', searchLabel, searchValue, s.searchState, searchTitle)}
  ${systemSignal('contact', '觸接', s.contact, s.contactState, contactTitle, null, s.contactEquipment ?? null)}
  ${systemSignal('aaci', aaciLabel, s.aaci, s.aaciState, aaciTitle, null, null, 'yamato', 'ka2', 'anchor', aaciHoverHtml)}
</div>`;
};

const NORMAL_SIDE_HTML = tacticalSideHtml({
    air: '劣勢', airTone: 'bad', heading: 'T字不利', headingTone: 'bad',
    rank: 'C?', rankState: 'predicted', rankResult: '戰術的敗北', formationId: 1, formation: '單縱陣',
    support: '—', supportKind: null, supportState: 'off', lbas: '—', lbasLost: '', lbasState: 'off',
    search: '失敗', searchState: 'warn', contact: '敵', contactState: 'warn',
    aaci: '—', aaciState: 'off', friendly: '—', friendlyState: 'off',
    fighterFriend: '142', fighterFriendLost: '−38', fighterEnemy: '220', fighterEnemyLost: '−12',
    bomberFriend: '78', bomberFriendLost: '−28', bomberEnemy: '110', bomberEnemyLost: '−8',
    nightEffects: { searchlight: 'unknown', 'night-contact': 'unknown', 'star-shell': 'unknown' }, nightEntry: 'available',
    nightTitle: 'api_midnight_flag 只表示夜戰選項可出現，不代表值得進入',
});

const ADVANTAGE_SIDE_HTML = tacticalSideHtml({
    air: '確保', airTone: 'good', heading: 'T字有利', headingTone: 'good',
    rank: 'S', rankState: 'on', rankResult: '完全勝利', formationId: 1, formation: '單縱陣',
    support: '有', supportKind: 'asw', aswSupportVariant: 'ka2', supportState: 'on', lbas: '—', lbasLost: '', lbasState: 'off',
    search: '成功', searchState: 'on', contact: '我', contactState: 'on',
    contactEquipment: { icon: 9, short: '偵', name: '零式水上偵察機11型乙' },
    aaci: 'Typ 2', aaciState: 'on', friendly: '—', friendlyState: 'off',
    fighterFriend: '142', fighterFriendLost: '', fighterEnemy: '0', fighterEnemyLost: '',
    bomberFriend: '78', bomberFriendLost: '', bomberEnemy: '0', bomberEnemyLost: '',
    nightEffects: { searchlight: 'off', 'night-contact': 'off', 'star-shell': 'off' }, nightEntry: 'none',
    nightTitle: '此節點沒有夜戰封包；敵艦已全滅',
});

const SHELL_SUPPORT_SIDE_HTML = tacticalSideHtml({
    air: '確保', airTone: 'good', heading: 'T字有利', headingTone: 'good',
    rank: 'S', rankState: 'on', rankResult: '完全勝利', formationId: 1, formation: '單縱陣',
    support: '有', supportKind: 'shell', supportShipVariant: 'yamato', supportState: 'on', lbas: '—', lbasLost: '', lbasState: 'off',
    search: '成功', searchState: 'on', contact: '我', contactState: 'on',
    contactEquipment: { icon: 9, short: '偵', name: '零式水上偵察機11型乙' },
    aaci: 'Typ 2', aaciState: 'on', friendly: '—', friendlyState: 'off',
    fighterFriend: '142', fighterFriendLost: '', fighterEnemy: '0', fighterEnemyLost: '',
    bomberFriend: '78', bomberFriendLost: '', bomberEnemy: '0', bomberEnemyLost: '',
    nightEffects: { searchlight: 'off', 'night-contact': 'off', 'star-shell': 'off' }, nightEntry: 'none',
    nightTitle: '此節點沒有夜戰封包；敵艦已全滅',
});

const TORPEDO_SUPPORT_SIDE_HTML = SHELL_SUPPORT_SIDE_HTML
    .replace(/砲擊支援/g, '雷擊支援')
    .replace(/support-shell/g, 'support-torpedo')
    .replace(/support-ship-raster/g, 'support-torpedo-raster')
    .replace(/yamato-north-style\.png/g, 'knox-torpedo-support.png')
    .replace(/大和北卡風/g, 'Knox-class 護衛艦剪影');

const COMBINED_SIDE_HTML = tacticalSideHtml({
    air: '優勢', airTone: 'good', heading: '反航戰', headingTone: 'warn',
    rank: 'A?', rankState: 'predicted', rankResult: '勝利', formationId: 14, formation: '第四警戒',
    support: '有', supportKind: 'air', supportState: 'on', lbas: '384', lbasLost: '−12', lbasState: 'on',
    search: '成功', searchState: 'on', contact: '雙', contactState: 'on',
    contactEquipment: { icon: 9, short: '偵', name: '零式水上偵察機11型乙' },
    aaci: 'Typ 2', aaciState: 'on', friendly: '有', friendlyState: 'on', friendlyFleetVariant: 'anchor',
    fighterFriend: '198', fighterFriendLost: '−14', fighterEnemy: '240', fighterEnemyLost: '−86',
    bomberFriend: '86', bomberFriendLost: '−22', bomberEnemy: '110', bomberEnemyLost: '−60',
    nightEffects: { searchlight: 'on', 'night-contact': 'on', 'star-shell': 'on' }, nightEntry: 'main',
    nightTitle: '聯合艦隊夜戰進入：主隊；三項夜戰裝備的實際狀態請以各自圖示 tooltip 查看',
    warning: true, retreatAvailable: true, retreatKind: 'combined',
});

const COMBINED_CLEAR_SIDE_HTML = COMBINED_SIDE_HTML
    .replace(/<button type="button" class="taiha-alert s-taiha open"[\s\S]*?<\/button>/, '')
    .replace('s-air-wrap covered', 's-air-wrap');

const STRIKING_FCF_SIDE_HTML = tacticalSideHtml({
    air: '優勢', airTone: 'good', heading: '同航戰', headingTone: 'good',
    rank: 'S', rankState: 'on', rankResult: '勝利', formationId: 1, formation: '警戒陣',
    support: '有', supportKind: 'air', supportState: 'on', lbas: '240', lbasLost: '−6', lbasState: 'on',
    search: '成功', searchState: 'on', contact: '我', contactState: 'on',
    contactEquipment: { icon: 9, short: '偵', name: '零式水上偵察機11型乙' },
    aaci: 'Typ 8', aaciState: 'on', friendly: '—', friendlyState: 'off',
    fighterFriend: '156', fighterFriendLost: '−8', fighterEnemy: '180', fighterEnemyLost: '−42',
    bomberFriend: '72', bomberFriendLost: '−12', bomberEnemy: '90', bomberEnemyLost: '−30',
    nightEffects: { searchlight: 'on', 'night-contact': 'on', 'star-shell': 'off' }, nightEntry: 'main',
    nightTitle: '遊撃部隊夜戰進入；夜戰裝備狀態依實際觸發標示',
    warning: true, retreatAvailable: true, retreatKind: 'striking',
});

const TORPEDO_FCF_SIDE_HTML = tacticalSideHtml({
    air: '劣勢', airTone: 'bad', heading: '反航戰', headingTone: 'warn',
    rank: 'A', rankState: 'on', rankResult: '勝利', formationId: 1, formation: '單縱陣',
    support: '—', supportState: 'off', lbas: '—', lbasState: 'off',
    search: '成功', searchState: 'on', contact: '—', contactState: 'off',
    aaci: 'Typ 1', aaciState: 'on', friendly: '—', friendlyState: 'off',
    fighterFriend: '0', fighterFriendLost: '0', fighterEnemy: '110', fighterEnemyLost: '−12',
    bomberFriend: '0', bomberFriendLost: '0', bomberEnemy: '68', bomberEnemyLost: '−8',
    nightEffects: { searchlight: 'on', 'night-contact': 'off', 'star-shell': 'on' }, nightEntry: 'main',
    nightTitle: '水雷戰隊夜戰突入；旗艦帶精鋭水雷戰隊司令部',
    warning: true, retreatAvailable: true, retreatKind: 'torpedo',
});

const NO_RETREAT_SIDE_HTML = tacticalSideHtml({
    air: '優勢', airTone: 'good', heading: '反航戰', headingTone: 'warn',
    rank: 'A?', rankState: 'predicted', rankResult: '勝利', formationId: 14, formation: '第四警戒',
    support: '有', supportKind: 'air', supportState: 'on', lbas: '384', lbasLost: '−12', lbasState: 'on',
    search: '成功', searchState: 'on', contact: '雙', contactState: 'on',
    contactEquipment: { icon: 9, short: '偵', name: '零式水上偵察機11型乙' },
    aaci: 'Typ 2', aaciState: 'on', friendly: '有', friendlyState: 'on', friendlyFleetVariant: 'anchor',
    fighterFriend: '198', fighterFriendLost: '−14', fighterEnemy: '240', fighterEnemyLost: '−86',
    bomberFriend: '86', bomberFriendLost: '−22', bomberEnemy: '110', bomberEnemyLost: '−60',
    nightEffects: { searchlight: 'on', 'night-contact': 'on', 'star-shell': 'on' }, nightEntry: 'main',
    nightTitle: '夜戰進入；未裝備司令部或無可用護衛艦',
    warning: true, retreatAvailable: false,
});

// ── 預設參考畫面：E3 甲斬殺期、敵方連合艦隊 ─────────────────────────────
// 這組資料只用來校對離線預覽的資訊層級與密度；不代表新的封包語意。
const REFERENCE_SIDE_HTML = `<div class="s-priority-row">
  <div class="s-priority-item good"><span>航空戰</span><b>互角</b></div>
  <div class="s-priority-item bad"><span>航向</span><b>T字不利</b></div>
</div>
<div class="s-rank-row">
  ${rankResultHtml('A?', true, '戰鬥結果尚未結算；目前只顯示預測 rank', '勝利')}
  <div class="s-formation-compact">${formationReadout(1, '單縱陣')}</div>
</div>
<div class="s-air-wrap covered">
  <div class="s-air-loss-grid" aria-label="敵我戰鬥機與爆擊機數量及戰損">
    <div class="s-air-loss-head"><b>我方</b><span aria-hidden="true"></span><b>敵方</b></div>
    <div class="s-air-loss-row"><span class="s-air-loss-cell friendly"><b>4</b></span><span class="s-air-kind fighter" title="戰鬥機">戰</span><span class="s-air-loss-cell enemy"><b>71</b><i>−15</i></span></div>
    <div class="s-air-loss-row"><span class="s-air-loss-cell friendly"><b>0</b></span><span class="s-air-kind bomber" title="爆擊機／攻擊機">爆</span><span class="s-air-loss-cell enemy"><b>24</b><i>−21</i></span></div>
  </div>
  <button type="button" class="taiha-alert s-taiha s-taiha-generic open" aria-expanded="true" title="大破！\n注意，不可退避">
    <span class="taiha-head">大破！</span><span class="taiha-hint">注意，不可退避</span>
  </button>
</div>
${nightEffectsHtml({ searchlight: 'unknown', 'night-contact': 'unknown', 'star-shell': 'unknown' }, 'main', '夜戰進入：主隊', 'off', '友軍艦隊未抵達')}
<div class="s-system-rail" aria-label="支援、陸航、索敵、觸接與對空 CI 狀態">
  ${systemSignal('support', '砲擊支援', '', 'on', '道中砲擊支援已抵達', 'shell', null, 'yamato')}
  ${systemSignal('lbas', '陸航到着', '', 'on', '基地航空隊已到著', null, null, 'yamato', 'tracker', 'anchor')}
  ${systemSignal('search', '成功', '', 'on', '索敵成功')}
  ${systemSignal('contact', 'Type 48', '雙', 'on', '敵我雙方觸接', null, { icon: 9, short: '偵', name: '零式水上偵察機' })}
  ${systemSignal('aaci', 'Typ 48', '', 'on', '對空 CI：Typ 48 發動')}
</div>`;

const REFERENCE_ESCORT_ENEMY_NAMES = [
    '輕巡ツ級',
    '驅逐ナ級後期型',
    '驅逐ナ級後期型',
    '驅逐ナ級後期型',
    '驅逐ハ級後期型',
    'PT小鬼群',
];
const REFERENCE_MAIN_ENEMY_NAMES = [
    '環礁空母泊地棲姫-壊',
    '空母ヲ級',
    '空母ヲ級',
    '輸送ワ級',
    '輸送ワ級',
    '輸送ワ級',
];

const referenceEnemyHtml = (names: string[], column: 'escort' | 'main') => names.map((name, index) => {
    const flagship = column === 'main' && index === 0;
    const active = column === 'escort' && index === names.length - 1;
    const cls = `${flagship ? ' flagship' : ''}${active ? ' active' : ''}`;
    const hpColor = flagship ? '#d9b84f' : active ? '#58a55c' : '#273246';
    const hpWidth = flagship ? '55%' : active ? '100%' : '0%';
    return `<div class="s-echip${cls}" title="${esc(name)}">
  <span class="s-echip-name">${esc(name)}</span>
  <span class="s-echip-hp"><i style="width:${hpWidth};background:${hpColor}"></i></span>
</div>`;
}).join('');

const REFERENCE_ESCORT_ENEMY_HTML = referenceEnemyHtml(REFERENCE_ESCORT_ENEMY_NAMES, 'escort');
const REFERENCE_MAIN_ENEMY_HTML = referenceEnemyHtml(REFERENCE_MAIN_ENEMY_NAMES, 'main');

const REFERENCE_SORTIE_HTML = `<div class="sortie-container">
  <div class="s-header">
    <div class="s-map-id">E3<i>甲</i></div>
    ${normalGaugeHtml(500, 5500, 9.1)}
    <div class="s-nodes">${sortieNodeHtml('R', true)}${sortieNodeHtml('T', true, false, 'no-battle')}${sortieNodeHtml('V', true, false, 'branch')}${sortieNodeHtml('X', true)}${sortieNodeHtml('Y', true, false, 'no-battle')}${sortieNodeHtml('B', true)}${sortieNodeHtml('C', true, false, 'branch')}${sortieNodeHtml('D', true, false, 'no-battle')}${sortieNodeHtml('F', true)}${sortieNodeHtml('Z', true, true, 'battle', true)}</div>
  </div>
  <div class="s-battle-row">
    <div class="s-eside"></div>
    <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
    <div class="s-efleet-body"><div class="s-ecol-body">${REFERENCE_ESCORT_ENEMY_HTML}</div><div class="s-ecol-body">${REFERENCE_MAIN_ENEMY_HTML}</div></div>
  </div>
  <div class="s-action-rail with-system"><div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div></div>
</div>`;

// ── 完整出擊情境定義 ──────────────────────────────────────────────────────
// ── 完整出擊情境定義 ──────────────────────────────────────────────────────
const SCENES = [
    {
        id: 'reference',
        label: '參考畫面｜E3 甲斬殺期',
        note: '以參考畫面校正：E3 甲斬殺期、10 個節點（非戰鬥藍色／能動分歧白色／目前節點藍綠光暈）、敵方連合艦隊隨伴與主隊雙欄。',
        current: REFERENCE_SORTIE_HTML,
        proposed: REFERENCE_SORTIE_HTML,
    },
    {
        id: 'combined-fleet',
        label: '編成預覽｜連合艦隊雙欄',
        note: '同一個出擊預覽頁內切換的連合艦隊編成；第一艦隊與第二艦隊放在同一張編成區左右並列。',
        current: REFERENCE_SORTIE_HTML,
        proposed: REFERENCE_SORTIE_HTML,
        fleet: COMBINED_FLEET_HTML,
    },
    {
        id: 'combined-fleet-taiha',
        label: '編成預覽｜連合艦隊大破狀態',
        note: '同一個連合艦隊雙欄版面加入第一／第二艦隊各一艘大破示範，確認紅名、紅色 HP 條、大破標記與 Lv／士氣／燃彈不互相遮住。',
        current: REFERENCE_SORTIE_HTML,
        proposed: REFERENCE_SORTIE_HTML,
        fleet: COMBINED_FLEET_TAIHA_HTML,
    },
    {
        id: 'single-fleet-taiha',
        label: '編成預覽｜單艦隊大破狀態',
        note: '同一個出擊預覽頁內顯示單艦隊的大破列：整列紅色警示、士氣位置顯示大破標籤，點擊標籤可查看原本士氣。',
        current: REFERENCE_SORTIE_HTML,
        proposed: REFERENCE_SORTIE_HTML,
        fleet: SEVEN_FLEET_TAIHA_HTML,
    },
    {
        id: 'single-fleet-repair',
        label: '編成預覽｜七船泊地修理標籤',
        note: '第一艘為明石改的七船編成，確認泊地修理摘要標籤出現時第 7 艘仍留在固定面板安全線內。',
        current: REFERENCE_SORTIE_HTML,
        proposed: REFERENCE_SORTIE_HTML,
        fleet: SEVEN_FLEET_REPAIR_HTML,
    },
    {
        id: 'single-fleet-morale',
        label: '編成預覽｜七船給糧標籤',
        note: '第一艘為野埼改的七船編成，確認給糧摘要標籤出現時第 7 艘仍留在固定面板安全線內。',
        current: REFERENCE_SORTIE_HTML,
        proposed: REFERENCE_SORTIE_HTML,
        fleet: SEVEN_FLEET_MORALE_HTML,
    },
    {
        id: 'combined-boss',
        label: '活動 E3 聯合艦隊 Boss 戰＋大破警告',
        note: '敵我連合艦隊 12 艘對抗：中段採密度補償同高底板，大破警示預設展開遮蔽戰損格，點選可切換為半透明透視紅框；最下列為等寬雙模組系統圖示軌與櫻花錨 Drop 晶片。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads">
              <div class="s-ecol-h">隨伴</div>
              <div class="s-ecol-h">主隊</div>
            </div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship" title="軽巡ヘ級・殘 HP 0"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip" title="駆逐イ級後期型・殘 HP 14"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship" title="空母棲姫・殘 HP 162"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip" title="空母ヲ級・殘 HP 48"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="軽巡ツ級・殘 HP 0"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads">
              <div class="s-ecol-h">隨伴</div>
              <div class="s-ecol-h">主隊</div>
            </div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship" title="軽巡ヘ級・殘 HP 0"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip" title="駆逐イ級後期型・殘 HP 14"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship" title="空母棲姫・殘 HP 162"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip" title="空母ヲ級・殘 HP 48"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="軽巡ツ級・殘 HP 0"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'combined-clear',
        label: '組合預覽｜無大破警示',
        note: '敵方連合艦隊 12 艘無大破正常狀態：直接檢視制空／航向、Rank／陣形、戰損格與夜戰圖示的完整視覺節奏。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads">
              <div class="s-ecol-h">隨伴</div>
              <div class="s-ecol-h">主隊</div>
            </div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship" title="軽巡ヘ級・殘 HP 0"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip" title="駆逐イ級後期型・殘 HP 14"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship" title="空母棲姫・殘 HP 162"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip" title="空母ヲ級・殘 HP 48"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="軽巡ツ級・殘 HP 0"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads">
              <div class="s-ecol-h">隨伴</div>
              <div class="s-ecol-h">主隊</div>
            </div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship" title="軽巡ヘ級・殘 HP 0"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip" title="駆逐イ級後期型・殘 HP 14"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐イ級後期型・殘 HP 0"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship" title="空母棲姫・殘 HP 162"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip" title="空母ヲ級・殘 HP 48"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="軽巡ツ級・殘 HP 0"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'normal-boss',
        label: '常規 6-5 BOSS 戰（我方不利警示）',
        note: '常規海域 6-5 BOSS 點 M 交戰：索敵失敗、T字不利、航空劣勢等不利狀態保留語意色；未抵達／未發動系統圖示維持清晰灰色。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">6-5</div>
            ${normalGaugeHtml(600, 4000, 15)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">C</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">G</div>
              ${sortieNodeHtml('M', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads single"><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body single">
              <div class="s-ecol-body">
                <div class="s-echip flagship" title="空母棲姫・殘 HP 273"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:78%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip" title="空母ヲ級・殘 HP 96"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
                <div class="s-echip" title="重巡リ級・殘 HP 53"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:70%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip" title="軽巡ツ級・殘 HP 66"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
                <div class="s-echip" title="駆逐ロ級後期型・殘 HP 37"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
                <div class="s-echip" title="駆逐ロ級後期型・殘 HP 37"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line"></div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">6-5</div>
            ${normalGaugeHtml(600, 4000, 15)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">C</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">G</div>
              ${sortieNodeHtml('M', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads single"><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body single">
              <div class="s-ecol-body">
                <div class="s-echip flagship" title="空母棲姫・殘 HP 273"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:78%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip" title="空母ヲ級・殘 HP 96"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
                <div class="s-echip" title="重巡リ級・殘 HP 53"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:70%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip" title="軽巡ツ級・殘 HP 66"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
                <div class="s-echip" title="駆逐ロ級後期型・殘 HP 37"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
                <div class="s-echip" title="駆逐ロ級後期型・殘 HP 37"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:100%;background:var(--dim)"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line"></div>
          </div>
        </div>`,
    },
    {
        id: 'normal-advantage',
        label: '常規 6-5 S 勝結算（我方有利狀態）',
        note: '常規海域 6-5 S 勝結算：索敵成功、T字有利、我方觸接、制空權確保，對潛支援、對空 CI 發動，最下列顯示新艦 Drop 櫻錨晶片。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">6-5</div>
            ${normalGaugeHtml(2400, 4800, 50)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">C</div>
              <div class="s-node visited">D</div>
              <div class="s-node">G</div>
              ${sortieNodeHtml('M', false, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads single"><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body single">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship" title="空母棲姫・殘 HP 0"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="空母ヲ級・殘 HP 0"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="軽巡ツ級・殘 HP 0"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">6-5</div>
            ${normalGaugeHtml(2400, 4800, 50)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">C</div>
              <div class="s-node visited">D</div>
              <div class="s-node">G</div>
              ${sortieNodeHtml('M', false, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads single"><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body single">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship" title="空母棲姫・殘 HP 0"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="空母ヲ級・殘 HP 0"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="重巡リ級・殘 HP 0"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="軽巡ツ級・殘 HP 0"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk" title="駆逐ロ級後期型・殘 HP 0"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'shell-support',
        label: '砲擊支援圖示（面板示範）',
        note: '提案面板直接展示已抵達的砲擊支援艦影（大和北卡風），文字與圖示亮起黃銅色。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">6-5</div>
            ${normalGaugeHtml(2400, 4800, 50)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">C</div>
              <div class="s-node visited">D</div>
              <div class="s-node">G</div>
              ${sortieNodeHtml('M', false, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads single"><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body single">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">6-5</div>
            ${normalGaugeHtml(2400, 4800, 50)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">C</div>
              <div class="s-node visited">D</div>
              <div class="s-node">G</div>
              ${sortieNodeHtml('M', false, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads single"><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body single">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'torpedo-support',
        label: '雷擊支援圖示（Knox-class frigate）',
        note: '修正版使用 Knox-class frigate 黃銅色側面剪影；對潛支援則使用專案既有 Ka-2 旋翼機素材。',
        current: SHELL_SUPPORT_SIDE_HTML,
        proposed: TORPEDO_SUPPORT_SIDE_HTML,
    },
    {
        id: 'fcf-combined',
        label: '大破退避｜連合艦隊（艦隊司令部施設）',
        note: '連合艦隊旗艦裝備「艦隊司令部施設」(107) 時，大破提示顯示「艦隊司令部施設已裝備，可退避」。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'fcf-striking',
        label: '大破退避｜遊撃部隊（遊撃部隊 艦隊司令部）',
        note: '單艦隊 7 艘遊撃部隊旗艦裝備「遊撃部隊 艦隊司令部」(272) 時，大破提示顯示「遊撃部隊艦隊司令部已裝備，可退避」。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'fcf-torpedo',
        label: '大破退避｜水雷戰隊（精鋭水雷戰隊 司令部）',
        note: '水雷戰隊旗艦裝備「精鋭水雷戰隊 司令部」(413) 時，大破提示顯示「精鋭水雷戰隊司令部已裝備，可退避」。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'fcf-none',
        label: '大破退避｜未裝備司令部（注意，不可退避）',
        note: '無司令部裝備或無可用驅逐護衛時，大破提示顯示高警示「注意，不可退避」。',
        current: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
        proposed: `<div class="sortie-container">
          <div class="s-header">
            <div class="s-map-id">E3<i>甲</i></div>
            ${normalGaugeHtml(720, 5200, 14)}
            <div class="s-nodes">
              <div class="s-node visited">A</div>
              <div class="s-node visited">D</div>
              <div class="s-node visited">F</div>
              <div class="s-node visited">H</div>
              <div class="s-node visited">J</div>
              <div class="s-node visited">L</div>
              <div class="s-node visited">O</div>
              ${sortieNodeHtml('Z', true, true)}
            </div>
          </div>
          <div class="s-battle-row">
            <div class="s-eside"></div>
            <div class="s-efleet-heads"><div class="s-ecol-h">隨伴</div><div class="s-ecol-h">主隊</div></div>
            <div class="s-efleet-body">
              <div class="s-ecol-body">
                <div class="s-echip sunk flagship"><span class="s-echip-name">軽巡ヘ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:40%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐イ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
              <div class="s-ecol-body">
                <div class="s-echip flagship"><span class="s-echip-name">空母棲姫</span><span class="s-echip-hp"><i style="width:46%;background:var(--dmg-major)"></i></span></div>
                <div class="s-echip"><span class="s-echip-name">空母ヲ級</span><span class="s-echip-hp"><i style="width:50%;background:var(--dmg-mid)"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">重巡リ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">軽巡ツ級</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
                <div class="s-echip sunk"><span class="s-echip-name">駆逐ロ級後期型</span><span class="s-echip-hp"><i style="width:0%;background:transparent"></i></span></div>
              </div>
            </div>
          </div>
          <div class="s-action-rail with-system">
            <div class="s-signal-line">${panelDropChip('Октябрьская революция')}</div>
          </div>
        </div>`,
    },
    {
        id: 'standby',
        label: '待命：量表列表（含斬殺期）',
        note: '母港未出擊狀態：列出未攻略海域量表，海域代號對齊 brass 類別標籤，斬殺期保持內嵌 inset 樣式。',
        current: `<div class="s-standby">
          <div class="s-standby-hint">尚未出擊</div>
          <div class="s-standby-maps">
            <div class="s-standby-map">
              <div class="s-map-id">7-5<i>甲</i></div>
              ${finalGaugeHtml(840, 4840, 18)}
            </div>
            <div class="s-standby-map">
              <div class="s-map-id">E1<i>甲</i></div>
              ${normalGaugeHtml(2760, 4600, 60)}
            </div>
            <div class="s-standby-map">
              <div class="s-map-id">1-5</div>
              ${normalGaugeHtml(3, 4, 75)}
            </div>
          </div>
        </div>`,
        proposed: `<div class="s-standby">
          <div class="s-standby-hint">尚未出擊</div>
          <div class="s-standby-maps">
            <div class="s-standby-map">
              <div class="s-map-id">7-5<i>甲</i></div>
              ${finalGaugeHtml(840, 4840, 18)}
            </div>
            <div class="s-standby-map">
              <div class="s-map-id">E1<i>甲</i></div>
              ${normalGaugeHtml(2760, 4600, 60)}
            </div>
            <div class="s-standby-map">
              <div class="s-map-id">1-5</div>
              ${normalGaugeHtml(3, 4, 75)}
            </div>
          </div>
        </div>`,
    },
];

const PROPOSED_SIDES: Record<string, string> = {
    reference: REFERENCE_SIDE_HTML,
    'combined-boss': COMBINED_SIDE_HTML,
    'combined-clear': COMBINED_CLEAR_SIDE_HTML,
    'normal-boss': NORMAL_SIDE_HTML,
    'normal-advantage': ADVANTAGE_SIDE_HTML,
    'shell-support': SHELL_SUPPORT_SIDE_HTML,
    'fcf-combined': COMBINED_SIDE_HTML,
    'fcf-striking': STRIKING_FCF_SIDE_HTML,
    'fcf-torpedo': TORPEDO_FCF_SIDE_HTML,
    'fcf-none': NO_RETREAT_SIDE_HTML,
};

const CURRENT_SIDES: Record<string, string> = {
    // 左側使用正式面板；右側套用 reference 覆寫供版面對照。
    reference: REFERENCE_SIDE_HTML,
};

const DROP_REFERENCE_HTML = `<div class="pv-drop-reference">
  <div class="pv-drop-reference-head">
    <b>掉落櫻錨視覺規範（櫻花恆在錨前方）</b>
    <span>新船：金櫻＋光環＋星芒；已持有船：銀灰櫻錨</span>
  </div>
  <div class="pv-drop-options">
    <div class="pv-drop-option">
      <div class="pv-drop-option-head"><b>短艦名示範</b><em>朝日</em></div>
      <div class="pv-drop-pair">
        <div class="pv-drop-state new"><div class="pv-drop-icon">${sakuraAnchorSvg(true)}</div><div class="pv-drop-copy"><b>朝日</b></div></div>
        <div class="pv-drop-state owned"><div class="pv-drop-icon">${sakuraAnchorSvg(false)}</div><div class="pv-drop-copy"><b>朝日</b></div></div>
      </div>
    </div>
    <div class="pv-drop-option">
      <div class="pv-drop-option-head"><b>長艦名示範</b><em>Октябрьская революция</em></div>
      <div class="pv-drop-pair">
        <div class="pv-drop-state new"><div class="pv-drop-icon">${sakuraAnchorSvg(true)}</div><div class="pv-drop-copy"><b>Октябрьская революция</b></div></div>
        <div class="pv-drop-state owned"><div class="pv-drop-icon">${sakuraAnchorSvg(false)}</div><div class="pv-drop-copy"><b>Октябрьская революция</b></div></div>
      </div>
    </div>
  </div>
</div>`;

const SUPPORT_REFERENCE_HTML = `<div class="pv-support-reference">
  <div class="pv-support-reference-head">
    <b>作戰系統圖示規範</b>
    <span>抵達／發動＝黃銅金色＋文字高亮；未抵達／未發動＝清晰灰色</span>
  </div>
  <div class="pv-support-reference-items">
    <div class="pv-support-reference-item active">${tacticalSupportIconHtml('shell', 'yamato')}<b>砲擊支援</b><em>抵達</em></div>
    <div class="pv-support-reference-item">${tacticalSupportIconHtml('air')}<b>航空支援</b><em>抵達</em></div>
    <div class="pv-support-reference-item">${tacticalSupportIconHtml('torpedo')}<b>雷擊支援</b><em>抵達</em></div>
    <div class="pv-support-reference-item">${tacticalSupportIconHtml('asw', 'yamato', 'ka2')}<b>對潛支援</b><em>抵達</em></div>
    <div class="pv-support-reference-item">${lbasAircraftIconHtml()}<b>基地航空隊</b><em>抵達</em></div>
    <div class="pv-support-reference-item">${searchRadarIconHtml()}<b>索敵雷達</b><em>成功</em></div>
    <div class="pv-support-reference-item">${contactIconHtml('我', { icon: 9, short: '偵', name: '零式水偵' })}<b>觸接</b><em>我方</em></div>
    <div class="pv-support-reference-item">${aaciGunIconHtml()}<b>對空 CI</b><em>發動</em></div>
    <div class="pv-support-reference-item">${friendlyFleetIconHtml('anchor')}<b>友軍艦隊</b><em>抵達</em></div>
  </div>
</div>`;

const FORMATION_REFERENCE_HTML = `<div class="pv-formation-board">
  <div class="pv-formation-board-head">
    <b>陣形圖示規範</b>
    <span>遊戲圓形框線與幾何艦位點</span>
  </div>
  <div class="pv-formation-groups">
    <div class="pv-formation-group">
      <span class="pv-formation-group-label">單艦隊／遊擊部隊</span>
      <div class="pv-formation-grid">
        ${FORMATIONS.filter(f => f.id <= 6).map(f => `<span class="pv-formation-item">${formationSvg(f.id, f.id === 1)}<b>${esc(f.label)}</b></span>`).join('')}
      </div>
    </div>
    <div class="pv-formation-group">
      <span class="pv-formation-group-label">連合艦隊警戒陣</span>
      <div class="pv-formation-grid">
        ${FORMATIONS.filter(f => f.id > 6).map(f => `<span class="pv-formation-item">${formationSvg(f.id, f.id === 14)}<b>${esc(f.label)}</b></span>`).join('')}
      </div>
    </div>
  </div>
</div>`;

const page = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>出擊分頁左右比較預覽（420×850）</title>
<style>${css}${extraCss}</style>
</head>
<body>
  <p class="pv-intro">
    <b>出擊分頁左右比較（參考畫面校正版）</b>
    左側為目前面板，右側為修正版；兩個 420×850 假窗使用同一組 E3 甲資料，下方依場景切換單隊七船或連合艦隊雙欄編成並量測 ${FLEET_SAFE_HEIGHT}px 安全線。
  </p>
  <div class="pv-bar">
    ${SCENES.map(s => `<button type="button" data-sc="${s.id}"${s.id === 'reference' ? ' class="on"' : ''}>${esc(s.label)}</button>`).join('')}
    <button type="button" data-theme>亮／暗主題切換</button>
  </div>
  <p class="pv-scene-note" id="scene-note" style="font-size:12px;color:var(--dim);margin:0 0 10px;"></p>
  <div class="pv-wins" id="wins"></div>

<script>
const SCENES = ${JSON.stringify(SCENES)};
const FLEET = ${JSON.stringify(SEVEN_FLEET_HTML)};
const NAV = ${JSON.stringify(NAV_HTML)};
const FLEET_SAFE_HEIGHT = ${FLEET_SAFE_HEIGHT};
const CURRENT_SIDES = ${JSON.stringify(CURRENT_SIDES)};
const PROPOSED_SIDES = ${JSON.stringify(PROPOSED_SIDES)};
let scene = new URLSearchParams(location.search).get('scene') || 'reference';

function chrome(kind, sortieHtml, reference = false, fleetHtml = FLEET) {
  const isProposed = kind === 'proposed';
  const isReferenceCurrent = kind === 'current-reference';
  const appClass = isProposed || isReferenceCurrent ? ' pv-prop' : ' pv-current';
  const prop = appClass + (isProposed && reference ? ' pv-reference' : '');
  const winClass = isProposed ? 'pv-right' : 'pv-left';
  const label = isProposed ? '修正版 · 出擊分頁（右）' : '目前面板 · 出擊分頁（左）';
  return '<div class="pv-win ' + winClass + '">' +
    '<div class="pv-win-label">' + label + '</div>' +
    '<div class="pv-app' + prop + '">' +
      '<div id="header">' +
        '<span class="idbox"><span class="nick">イケン</span><span class="num">Lv120</span></span>' +
        '<span class="grow"></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/ship.svg" alt=""> <b>411/440</b></span>' +
        '<span class="stat"><img class="h-icon" src="/icons/ui/equip.svg" alt=""> <b>2070/2153</b></span>' +
      '</div>' +
      '<div id="tabs">' +
        '<button type="button">一般</button>' +
        '<button type="button" class="on">出擊</button>' +
        '<button type="button">遠征</button>' +
        '<button type="button">工廠</button>' +
        '<button type="button">調度</button>' +
      '</div>' +
      '<div id="tabpanel"><div id="tab-sortie">' + sortieHtml + '</div></div>' +
      '<div id="fleetnav">' + NAV + '</div>' +
      '<div id="fleets">' + fleetHtml + '</div>' +
    '</div>' +
    '<div class="pv-measure"></div>' +
  '</div>';
}

function measure() {
  document.querySelectorAll('.pv-win').forEach(win => {
    const el = win.querySelector('.pv-measure');
    const app = win.querySelector('.pv-app');
    const fleets = win.querySelector('#fleets');
    const nav = win.querySelector('#fleetnav');
    const tabpanel = win.querySelector('#tabpanel');
    const header = win.querySelector('#header');
    const tabs = win.querySelector('#tabs');
    if (!el || !app || !fleets) return;
    const appH = Math.round(app.getBoundingClientRect().height);
    const used = Math.round(fleets.getBoundingClientRect().bottom - app.getBoundingClientRect().top);
    const fleetH = Math.round(fleets.getBoundingClientRect().height);
    const navH = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
    const panelH = tabpanel ? Math.round(tabpanel.getBoundingClientRect().height) : 0;
    const chromeH = (header && tabs)
      ? Math.round(tabs.getBoundingClientRect().bottom - header.getBoundingClientRect().top)
      : 0;
    const n = fleets.querySelectorAll('.ship').length;
    const row = fleets.querySelector('.ship');
    const rowH = row ? Math.round(row.getBoundingClientRect().height * 10) / 10 : 0;
    const over = used > FLEET_SAFE_HEIGHT;
    el.classList.toggle('over', over);
    el.innerHTML = '假窗 <b>' + appH + 'px</b>；七船用掉 <b>' + used + 'px</b> / ' + FLEET_SAFE_HEIGHT + 'px 安全線' +
      '（頂欄 ' + chromeH + '／出擊區 ' + panelH + '／nav ' + navH + '／fleets ' + fleetH +
      '，' + n + ' 艘、列高 ' + rowH + 'px）' +
      (over ? '　⚠️ 超過 ' + FLEET_SAFE_HEIGHT + 'px 安全線，實機可能裁切' : '　✅ 安全線內（未超出）');
  });
}

function render() {
  const sc = SCENES.find(s => s.id === scene) || SCENES[0];
  scene = sc.id;
  document.querySelectorAll('[data-sc]').forEach(b => b.classList.toggle('on', b.getAttribute('data-sc') === scene));
  const fleetHtml = sc.fleet || FLEET;
  document.getElementById('scene-note').textContent = sc.note;
  document.getElementById('wins').innerHTML =
    chrome(scene === 'reference' ? 'current-reference' : 'current', sc.current, false, fleetHtml) +
    chrome('proposed', sc.proposed, scene === 'reference', fleetHtml);
  document.querySelectorAll('.pv-app').forEach(app => {
    const side = app.querySelector('.s-eside');
    const sideMap = app.classList.contains('pv-prop') ? PROPOSED_SIDES : CURRENT_SIDES;
    const sideHtml = sideMap[scene] || PROPOSED_SIDES[scene];
    if (side && sideHtml) side.innerHTML = sideHtml;
    const systemRail = side?.querySelector('.s-system-rail');
    const actionRail = app.querySelector('.s-action-rail');
    if (systemRail && actionRail) {
      const drop = actionRail.querySelector('.s-drop-chip');
      actionRail.replaceChildren(systemRail);
      const dropSlot = document.createElement('div');
      dropSlot.className = 's-drop-slot ' + (drop ? 'filled' : 'empty');
      if (drop) {
        dropSlot.append(drop);
      } else {
        dropSlot.innerHTML = '<span class="s-drop-empty">No Drop</span>';
      }
      actionRail.append(dropSlot);
      actionRail.classList.add('with-system');
    }
  });
  measure();
}

document.querySelectorAll('[data-sc]').forEach(b => {
  b.addEventListener('click', () => {
    scene = b.getAttribute('data-sc');
    document.querySelectorAll('[data-sc]').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
});
document.querySelector('button[data-theme]').addEventListener('click', () => {
  const on = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
});
document.addEventListener('click', e => {
  const cond = e.target.closest('.taiha-cond-toggle');
  if (cond) {
    const revealed = cond.getAttribute('aria-expanded') !== 'true';
    cond.classList.toggle('revealed', revealed);
    cond.setAttribute('aria-expanded', String(revealed));
    return;
  }
  const warning = e.target.closest('.s-taiha-generic');
  if (!warning) return;
  const hidden = !warning.classList.contains('details-hidden');
  warning.classList.toggle('details-hidden', hidden);
  warning.setAttribute('aria-expanded', String(!hidden));
  warning.closest('.s-air-wrap')?.classList.toggle('covered', !hidden);
});
render();
</script>
</body></html>`
    .replace(/src="\/icons\//g, `src="../public/icons/`)
    .replace(/src=\\"\/icons\//g, `src=\\"../public/icons/`);

mkdirSync(resolve(root, '.preview'), { recursive: true });
const dark = resolve(root, '.preview/panel-sortie.html');
const light = resolve(root, '.preview/panel-sortie-light.html');
writeFileSync(dark, page);
writeFileSync(light, page.replace('<html lang="zh-TW">', '<html lang="zh-TW" data-theme="light">'));
console.log('Preview updated successfully');
