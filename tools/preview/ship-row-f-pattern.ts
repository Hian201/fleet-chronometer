// 單艦隊艦列 F 型資訊階層的離線候選預覽。不改正式 panel。
// 裝備 chip 沿用正式 markup／CSS；只重排列內區塊，列高預算與現行六／七船相同。
//
//   npx vite-node --config vitest.config.ts tools/preview/ship-row-f-pattern.ts
//   → .preview/ship-row-f-pattern.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Lang } from '../../utils/gamedata-i18n';
import { esc, gearIconHtml, matIconHtml } from '../../utils/html-escape';
import { setLang, t } from '../../utils/ui-i18n';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const panelHtml = readFileSync(resolve(root, 'entrypoints/panel/index.html'), 'utf8');
const css = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

const alvMark = (alv: number) =>
    ['', '|', '||', '|||', '/', '//', '///', '&gt;&gt;'][Math.min(7, Math.max(0, alv))];
const alvU = (alv: number) => {
    const cls = alv >= 7 ? 'alv-ace' : alv >= 1 && alv <= 3 ? 'alv-lo' : '';
    return `<u${cls ? ` class="${cls}"` : ''}>${alvMark(alv)}</u>`;
};
const impMark = (level: number) => (level >= 10 ? '★' : level > 0 ? String(level) : '');

type Gear = {
    name: string; short: string; cat: string; icon: number;
    level?: number; alv?: number;
    count?: number; countMax?: number; countEst?: boolean;
};
type Ship = {
    stype: string;
    name: Record<Lang, string>;
    lv: number;
    hp: number; maxhp: number; cond: number;
    fuel: number; maxFuel: number; bull: number; maxBull: number;
    escaped?: boolean; inDock?: boolean;
    gears: (Gear | null)[];
    ex?: Gear | 'empty' | 'none';
    cap?: (number | undefined)[];
    repairMark?: boolean;
    moraleMark?: boolean;
};

const loc = (zh: string, en: string, ja = zh): Record<Lang, string> => ({ 'zh-TW': zh, en, ja });
const tx = (map: Record<Lang, string>) =>
    `<span class="i18n"><span lang="zh-TW">${esc(map['zh-TW'])}</span><span lang="en">${esc(map.en)}</span><span lang="ja">${esc(map.ja)}</span></span>`;

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
        `${gearIconHtml(g.icon, g.short)}<span class="r-col"><span class="r-top">${alvU(g.alv ?? 0)}<b>${impMark(g.level ?? 0)}</b></span>` +
        `<em class="oc ${ocCls}">${g.count ?? ''}</em></span></span>`;
};

const vitSupply = (s: Ship, remain = false) => {
    const pct = (v: number, max: number) => max ? Math.round(100 * v / max) : 100;
    const fp = pct(s.fuel, s.maxFuel), bp = pct(s.bull, s.maxBull);
    const fShow = remain ? s.fuel : fp;
    const aShow = remain ? s.bull : bp;
    const fTitle = `${esc(t('mat.fuel.full'))} ${s.fuel}/${s.maxFuel} (${fp}%)`;
    const aTitle = `${esc(t('mat.ammo.full'))} ${s.bull}/${s.maxBull} (${bp}%)`;
    return `<span class="vit-sup">` +
        `<span class="sup-f" title="${fTitle}">${matIconHtml('fuel', t('mat.fuel.full'))}<span class="sup-n">${fShow}</span></span>` +
        `<span class="sup-a" title="${aTitle}">${matIconHtml('ammo', t('mat.ammo.full'))}<span class="sup-n">${aShow}</span></span>` +
        `</span>`;
};

const stClass = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    return r <= 0.25 ? 'st-major' : r <= 0.5 ? 'st-mid' : r <= 0.75 ? 'st-minor' : '';
};
const condClass = (s: Ship) => s.cond >= 50 ? 'sparkle' : s.cond <= 19 ? 'heavy' : s.cond <= 29 ? 'tired' : '';
const FLEET_REGULAR_SLOTS = 5;

const taihaHpMark = (s: Ship) => {
    if (s.escaped || s.inDock || stClass(s) !== 'st-major') return '';
    return `<span class="taiha-hp-mark">${tx(loc('大破', 'Taiha', '大破'))}</span>`;
};
const dockMark = (s: Ship) => s.inDock
    ? `<span class="dock-mark">${tx(loc('入渠', 'Dock', '入渠'))}</span>`
    : '';
const escapedTag = (s: Ship) => s.escaped
    ? `<span class="esc-tag">${tx(loc('退避', 'Esc', '退避'))}</span>`
    : '';
const otherMarks = (s: Ship) => {
    const bits: string[] = [];
    if (s.repairMark) bits.push(`<span class="rmark rep">${tx(loc('修+3', 'R+3', '修+3'))}</span>`);
    if (s.moraleMark) bits.push(`<span class="rmark mor">${tx(loc('給49', 'M49', '給49'))}</span>`);
    return bits.join('');
};

const shipChips = (s: Ship) => {
    const realChips = s.gears.map((g, i) => g ? gearChip(g) : blankChip('chip-empty', false, s.cap?.[i])).join('');
    const exChip = s.ex && s.ex !== 'none' && s.ex !== 'empty' ? gearChip(s.ex, true)
        : s.ex === 'empty' ? blankChip('chip-empty ex', true)
            : blankChip('chip-pad ex', true);
    const padCount = FLEET_REGULAR_SLOTS - s.gears.length;
    return realChips + blankChip('chip-pad').repeat(Math.max(0, padCount)) + exChip;
};

const shipShell = (s: Ship, inner: string) => {
    const st = stClass(s);
    return `<div class="ship ${st} ${s.escaped ? 'escaped' : ''} ${s.inDock ? 'in-dock' : ''}">${inner}</div>`;
};

const hpNums = (s: Ship) =>
    `<span class="f-hp"><span class="hp-num">${s.hp}</span><span class="hp-max">/${s.maxhp}</span></span>`;

const hpBar = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    return `<span class="f-hpbar" aria-hidden="true"><i style="width:${Math.round(r * 100)}%"></i></span>`;
};

const nameCell = (s: Ship) =>
    `<div class="f-namecell"><span class="f-name">${tx(s.name)}</span>${escapedTag(s)}${otherMarks(s)}</div>`;

const statusSlot = (s: Ship) =>
    `<span class="f-status">${taihaHpMark(s) || dockMark(s)}</span>`;

const condSlot = (s: Ship) =>
    `<span class="cond f-cond ${condClass(s)}">${s.cond}</span>`;

const lvSlot = (s: Ship) => `<span class="f-lv">Lv<span class="f-lv-n">${s.lv}</span></span>`;

const supplySlot = (s: Ship, remain = false) => `<span class="f-supply">${vitSupply(s, remain)}</span>`;

const hpCluster = (s: Ship) =>
    `<div class="f-hp-cluster">${hpNums(s)}${hpBar(s)}</div>`;

const secondSweep = (s: Ship) =>
    `${lvSlot(s)}${supplySlot(s)}<div class="chips">${shipChips(s)}</div>`;

const currentShip = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    const inner = s.escaped ? escapedTag(s) : s.inDock ? dockMark(s) : taihaHpMark(s);
    return shipShell(s, `<div class="ship-body">
      <span class="stype">${esc(s.stype)}</span>
      <div class="ship-main">
        <div class="ship-row1">
          <div class="ship-id"><span class="num">Lv<span class="lv-n">${s.lv}</span></span><span class="grow f-name">${tx(s.name)}</span></div>
          <div class="ship-aux"><span class="ship-ops">${otherMarks(s)}</span><span class="cond ${condClass(s)}"><span class="cond-spark" aria-hidden="true">✦</span><span class="cond-value">${s.cond}</span></span>${vitSupply(s, true)}</div>
          <span class="ship-state">${inner}</span>
        </div>
        <div class="ship-row2">
          <div class="ship-hp"><span class="hpbar" aria-hidden="true"><i style="width:${Math.round(r * 100)}%"></i></span><span class="hp-pair"><span class="hp-num">${s.hp}</span><span class="hp-max">/${s.maxhp}</span></span></div>
          <div class="chips">${shipChips(s)}</div>
        </div>
      </div>
    </div>`);
};

const propA = (s: Ship) => shipShell(s, `<div class="f-body">
  <div class="f-row1 f-sweep-1"><span class="stype">${esc(s.stype)}</span>${nameCell(s)}${hpCluster(s)}${condSlot(s)}${statusSlot(s)}</div>
  <div class="f-row2 f-sweep-2">${secondSweep(s)}</div>
</div>`);

const stateSlot = (s: Ship) => {
    const inner = s.escaped ? escapedTag(s) : s.inDock ? dockMark(s) : taihaHpMark(s);
    return `<span class="f-state">${inner}</span>`;
};

const b2Id = (s: Ship) =>
    `<div class="f-id">${lvSlot(s)}<span class="f-name">${tx(s.name)}</span></div>`;

const opsSlot = (s: Ship) => `<span class="f-ops">${otherMarks(s)}</span>`;

const propB = (s: Ship) => shipShell(s, `<div class="f-body f-body-b">
  <span class="stype f-stem">${esc(s.stype)}</span>
  <div class="f-main">
    <div class="f-row1 f-sweep-1">${nameCell(s)}${hpCluster(s)}${condSlot(s)}${statusSlot(s)}</div>
    <div class="f-row2 f-sweep-2">${secondSweep(s)}</div>
  </div>
</div>`);

const propB2 = (s: Ship) => shipShell(s, `<div class="f-body f-body-b2">
  <span class="stype f-stem">${esc(s.stype)}</span>
  <div class="f-main">
    <div class="f-row1 f-sweep-1">${b2Id(s)}<div class="f-aux">${opsSlot(s)}${supplySlot(s, true)}</div>${stateSlot(s)}</div>
    <div class="f-row2 f-sweep-2"><div class="f-hp-stack">${hpNums(s)}${hpBar(s)}</div>${condSlot(s)}<div class="chips">${shipChips(s)}</div></div>
  </div>
</div>`);

const propC = (s: Ship) => {
    const r = s.maxhp ? s.hp / s.maxhp : 1;
    return shipShell(s, `<div class="f-body f-body-c">
  <div class="f-row1 f-sweep-1"><span class="stype">${esc(s.stype)}</span>${nameCell(s)}${hpNums(s)}${condSlot(s)}${statusSlot(s)}</div>
  <div class="f-hp-rule" aria-hidden="true"><i style="width:${Math.round(r * 100)}%"></i></div>
  <div class="f-row2 f-sweep-2">${secondSweep(s)}</div>
</div>`);
};

const plane = (name: string, short: string, cat: string, icon: number, count: number, alv = 7, level = 0): Gear =>
    ({ name, short, cat, icon, count, countMax: count, alv, level });

const SAMPLE: Ship[] = [
    {
        stype: 'CV', name: loc('加賀改二', 'Kaga Kai Ni', '加賀改二'), lv: 99,
        hp: 100, maxhp: 100, cond: 85, fuel: 100, maxFuel: 100, bull: 100, maxBull: 100,
        ex: 'empty', cap: [20, 20, 46, 12, 3],
        gears: [
            plane('烈風改二', '烈', 'c-ftr', 6, 20, 1),
            plane('烈風改二戊型', '烈', 'c-ftr', 6, 20, 7, 6),
            plane('彗星一二型(六三四空／三号爆弾搭載機)', '彗', 'c-db', 7, 46, 3),
            plane('流星改(一航戦／熟練)', '流', 'c-tb', 8, 12, 2),
            null,
        ],
    },
    {
        stype: 'DD', name: loc('Johnston改', 'Johnston Kai', 'Johnston改'), lv: 87,
        hp: 7, maxhp: 31, cond: 21, fuel: 6, maxFuel: 15, bull: 6, maxBull: 30,
        ex: { name: '強化型艦本式缶', short: '缶', cat: 'c-etc', icon: 19, level: 10 },
        gears: [
            { name: '5inch単装砲 Mk.30改＋GFCS Mk.37', short: '高', cat: 'c-gun', icon: 16, level: 6 },
            { name: '5inch単装砲 Mk.30改＋GFCS Mk.37', short: '高', cat: 'c-gun', icon: 16, level: 4 },
            { name: 'SG レーダー(後期型)', short: '電', cat: 'c-radar', icon: 11, level: 4 },
        ],
    },
    {
        stype: 'CVL', name: loc('Gambier Bay Mk.II', 'Gambier Bay Mk.II', 'Gambier Bay Mk.II'), lv: 92,
        hp: 22, maxhp: 53, cond: 27, fuel: 36, maxFuel: 60, bull: 12, maxBull: 55,
        ex: 'empty', cap: [24, 24, 4, 8],
        gears: [
            plane('F6F-5N', '戰', 'c-ftr', 6, 18, 4),
            plane('TBF', '攻', 'c-tb', 8, 12, 6),
            { name: '夜間作戦航空要員', short: '夜', cat: 'c-etc', icon: 35 },
            null,
        ],
    },
    {
        stype: 'FBB', name: loc('加富爾伯爵 nuovo', 'Conte di Cavour Nuovo', 'Conte di Cavour nuovo'), lv: 84,
        hp: 48, maxhp: 92, cond: 33, fuel: 85, maxFuel: 85, bull: 90, maxBull: 95,
        ex: 'empty',
        gears: [
            { name: '320mm/44 三連装砲', short: '主', cat: 'c-gun', icon: 3, level: 6 },
            { name: '320mm/44 三連装砲', short: '主', cat: 'c-gun', icon: 3, level: 4 },
            { name: '90mm単装高角砲', short: '高', cat: 'c-gun', icon: 16, level: 4 },
            { name: 'Ro.43水偵', short: '偵', cat: 'c-rec', icon: 10, alv: 7, count: 3, countMax: 3 },
        ],
    },
    {
        stype: 'AR', name: loc('明石改', 'Akashi Kai', '明石改'), lv: 94,
        hp: 45, maxhp: 45, cond: 49, fuel: 90, maxFuel: 90, bull: 20, maxBull: 20,
        inDock: true, ex: 'empty',
        gears: [
            { name: '艦艇修理施設', short: '修', cat: 'c-etc', icon: 26 },
            { name: '艦艇修理施設', short: '修', cat: 'c-etc', icon: 26 },
            { name: '改良型艦本式タービン', short: '機', cat: 'c-etc', icon: 17 },
        ],
    },
    {
        stype: 'FBB', name: loc('Октябрьская революция', 'Октябрьская революция', 'Октябрьская революция'), lv: 155,
        hp: 40, maxhp: 91, cond: 12, fuel: 35, maxFuel: 100, bull: 40, maxBull: 160,
        repairMark: true, moraleMark: true,
        ex: { name: '探照灯', short: '探', cat: 'c-etc', icon: 24, level: 8 },
        gears: [
            { name: '41cm三連装砲改二', short: '主', cat: 'c-gun', icon: 3, level: 10 },
            { name: '41cm三連装砲改二', short: '主', cat: 'c-gun', icon: 3, level: 6 },
            { name: '15m二重測距儀＋21号電探改二', short: '電', cat: 'c-radar', icon: 11 },
            { name: '零式水上偵察機', short: '偵', cat: 'c-rec', icon: 10, alv: 7, count: 3, countMax: 3 },
        ],
    },
    {
        stype: 'DD', name: loc('綾波改二', 'Ayanami Kai Ni', '綾波改二'), lv: 139,
        hp: 32, maxhp: 32, cond: 52, fuel: 20, maxFuel: 20, bull: 25, maxBull: 25,
        escaped: true,
        ex: { name: '改良型艦本式タービン', short: '機', cat: 'c-etc', icon: 17, level: 10 },
        gears: [
            { name: '12.7cm連装砲D型改二', short: '主', cat: 'c-gun', icon: 1, level: 6 },
            { name: '61cm五連装(酸素)魚雷', short: '雷', cat: 'c-torp', icon: 5, level: 10 },
            { name: '61cm五連装(酸素)魚雷', short: '雷', cat: 'c-torp', icon: 5, level: 8 },
        ],
    },
];

type Kind = 'current' | 'a' | 'b' | 'b2' | 'c';
const renderShip: Record<Kind, (s: Ship) => string> = {
    current: currentShip,
    a: propA,
    b: propB,
    b2: propB2,
    c: propC,
};

const summary = () => `<div class="fsummary"><div class="fs-metrics">
  <span class="fs-metric fs-air fs-pri"><span class="fs-label">制空</span><b class="fs-value">312~328</b></span>
  <span class="fs-metric fs-los fs-pri"><span class="fs-label">索敵</span><b class="fs-value">48.6</b></span>
  <span class="fs-metric fs-speed fs-sec speed-fast"><span class="fs-label">速力</span><b class="fs-value">${tx(loc('高速', 'Fast'))}</b></span>
  <span class="fs-metric fs-level fs-sec"><span class="fs-label">Lv</span><b class="fs-value">731</b></span>
  <span class="fs-metric fs-tp fs-sec"><span class="fs-label">TP</span><b class="fs-value">27</b></span>
</div></div>`;

const fleetHtml = (kind: Kind, seven: boolean) => {
    const ships = seven ? SAMPLE : SAMPLE.slice(0, 6);
    return `<section class="fleet${seven ? ' fleet-seven' : ''}" data-kind="${kind}" data-n="${ships.length}">
  ${summary()}
  ${ships.map(renderShip[kind]).join('')}
</section>`;
};

const extraCss = `
html, body { height: auto; overflow: auto; }
body {
  display: block; min-height: 0; margin: 0; padding: 20px 24px 48px;
  font: 13px/1.5 system-ui, -apple-system, "Hiragino Sans", sans-serif;
  background: var(--bg); color: var(--text);
}
html[lang="en"] .i18n > :not([lang="en"]),
html[lang="ja"] .i18n > :not([lang="ja"]),
html:not([lang="en"]):not([lang="ja"]) .i18n > :not([lang="zh-TW"]) { display: none; }
.pv-intro { max-width: 1080px; font-size: 13px; color: var(--dim); line-height: 1.65; margin: 0 0 16px; }
.pv-intro b { color: var(--text); }
.pv-intro code { color: var(--sparkle); font-size: 12px; }
.pv-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.pv-bar-group {
  display: flex; align-items: center; gap: 4px;
  background: color-mix(in srgb, var(--panel) 80%, var(--bg));
  padding: 2px 4px; border: 1px solid var(--line); border-radius: 8px;
}
.pv-bar-group label { font-size: 11px; letter-spacing: var(--track-label); color: var(--brass); padding: 0 6px; }
.pv-bar button {
  background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 10px; font: 12px/1.4 inherit; cursor: pointer;
}
.pv-bar button:hover { border-color: var(--brass); }
.pv-bar button.on {
  border-color: var(--brass);
  background: color-mix(in srgb, var(--brass) 16%, var(--panel));
  color: var(--sparkle);
}
.pv-grid { display: flex; flex-wrap: wrap; gap: 28px 24px; align-items: flex-start; }
.pv-col { width: 420px; flex: none; }
.pv-col-label { font-size: 13px; font-weight: 600; letter-spacing: var(--track-title); color: var(--text); margin: 0 0 4px; }
.pv-col-note { font-size: 11px; color: var(--dim); line-height: 1.45; margin: 0 0 8px; min-height: 4.4em; }
.pv-frame {
  width: 420px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px;
  overflow: hidden;
}
.pv-measure { font-size: 11px; color: var(--dim); margin-top: 8px; font-variant-numeric: tabular-nums; }
.pv-measure b { color: var(--text); }
.pv-measure.ok b { color: #58a55c; }
.pv-measure.over b { color: var(--dmg-major); }
.pv-scan {
  display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 8px; font-size: 10px; color: var(--dim);
}
.pv-scan i {
  font-style: normal; padding: 1px 6px; border: 1px solid var(--line); border-radius: 99px;
  letter-spacing: var(--track-tag);
}
.pv-scan i.p1 { border-color: #c45c48; color: #e08b7a; }
.pv-scan i.p2 { border-color: #a67c4a; color: #c4a07a; }
.pv-scan i.p3 { border-color: #2f7a6e; color: #6fb3a8; }
.pv-scan i.p4 { color: var(--stub); border-style: dashed; }

.pv-fdiag {
  display: flex; flex-wrap: wrap; gap: 18px; align-items: center;
  max-width: 720px; margin: 0 0 16px; padding: 12px 14px;
  border: 1px solid var(--line); border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 70%, var(--bg));
}
.pv-fgrid {
  display: grid; grid-template-columns: repeat(6, 18px); grid-template-rows: repeat(5, 14px);
  gap: 2px; flex: none;
}
.pv-fgrid b { display: block; border-radius: 2px; }
.pv-fgrid .s1 { background: #d4654a; }
.pv-fgrid .s1b { background: #a84e3d; }
.pv-fgrid .s1c { background: #6e3a36; }
.pv-fgrid .s2 { background: #b8894a; }
.pv-fgrid .s2b { background: #6d5340; }
.pv-fgrid .stem { background: #2f7a6e; }
.pv-fgrid .blind { background: #2a3140; }
.pv-fleg { font-size: 12px; color: var(--dim); line-height: 1.55; margin: 0; }
.pv-fleg b { font-weight: 600; }
.pv-fleg .c1 { color: #e08b7a; }
.pv-fleg .c2 { color: #c4a07a; }
.pv-fleg .c3 { color: #6fb3a8; }
.pv-fleg .c4 { color: var(--stub); }

.ship:has(.f-body) { padding: 4px 6px; }
.fleet.fleet-seven > .ship:has(.f-body) { padding: 1px 6px; }
.f-body {
  display: flex; flex-direction: column; row-gap: 6px; min-width: 0; position: relative;
}
.fleet.fleet-seven > .ship > .f-body { row-gap: 4px; }

.f-row1, .f-row2 {
  align-items: center;
  min-width: 0;
  column-gap: 6px;
}
.f-row1 {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 126px 32px 44px;
  width: 100%;
  line-height: 1.2;
}
.f-row2 {
  display: grid;
  grid-template-columns: 36px 72px 221px;
  width: fit-content;
  max-width: 100%;
  min-height: 23px;
  justify-items: start;
}

.f-namecell {
  display: flex; align-items: baseline; gap: 4px; min-width: 0;
}
.f-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-size: 12px; line-height: 1.2; min-width: 0; flex: 1;
}
.f-namecell .esc-tag,
.f-namecell .rmark { flex: none; }
.f-row1 .stype,
.f-stem {
  display: inline-flex; align-items: center; justify-content: center;
  box-sizing: border-box;
  width: 32px; min-width: 32px; max-width: 32px;
  font-size: 9px; font-weight: 700; line-height: 1.1;
  letter-spacing: var(--track-tag);
  color: var(--brass);
  background: color-mix(in srgb, var(--brass) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--brass) 40%, transparent);
  border-radius: 3px;
  padding: 0 calc(3px - var(--track-tag)) 0 3px;
  text-align: center;
}

.f-status {
  box-sizing: border-box;
  width: 44px; min-width: 44px; max-width: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.f-status .taiha-hp-mark,
.f-status .dock-mark {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis;
}

.f-hp-cluster {
  display: flex; align-items: center; gap: 6px;
  width: 126px; min-width: 126px; max-width: 126px;
  line-height: 1.1;
}
.f-hp {
  display: flex; align-items: baseline; justify-content: flex-start;
  width: 56px; min-width: 56px; max-width: 56px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
  line-height: 1.1;
}
.f-hp .hp-num {
  min-width: 3ch; text-align: right;
  font-size: 14px; font-weight: 700; line-height: 1.1;
}
.f-hp .hp-max { font-size: 10px; min-width: 4ch; }

.f-hpbar {
  display: block;
  width: 64px; min-width: 64px; max-width: 64px; height: 8px;
  background: var(--line); border-radius: 3px; overflow: hidden;
  align-self: center;
}
.f-hpbar > i {
  display: block; height: 100%; background: #58a55c;
}
.st-minor .f-hpbar > i { background: var(--dmg-minor); }
.st-mid .f-hpbar > i { background: var(--dmg-mid); }
.st-major .f-hpbar > i { background: var(--dmg-major); }

.f-cond {
  box-sizing: border-box;
  width: 32px; min-width: 32px; max-width: 32px;
  text-align: right; font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.f-lv {
  width: 36px; min-width: 36px; max-width: 36px;
  font-size: 10px; line-height: 1.2; color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.f-lv-n {
  display: inline-block;
  width: 3ch; min-width: 3ch; max-width: 3ch;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.f-supply {
  width: 72px; min-width: 72px; max-width: 72px;
  display: flex; align-items: center; overflow: hidden;
}
.f-supply .vit-sup { gap: 4px; }
.f-supply .sup-f,
.f-supply .sup-a {
  min-width: 2.6em;
  font-variant-numeric: tabular-nums;
}
.f-row2 .chips { width: 221px; min-width: 221px; max-width: 221px; }
.f-row2 .chip { width: 36px; min-width: 36px; max-width: 36px; }
.f-row2 .chip .g-icon,
.f-row2 .chip .g-icon-slot { width: 14px; height: 14px; min-width: 14px; max-width: 14px; }
.f-row2 .r-col { width: 19px; min-width: 19px; max-width: 19px; }
.f-row2 .chip u { width: 10px; min-width: 10px; max-width: 10px; }
.f-row2 .chip b { width: 8px; min-width: 8px; max-width: 8px; }
.f-row2 .chip.ex { width: 31px; min-width: 31px; max-width: 31px; }
.f-row2 .chip.ex b { width: 11px; min-width: 11px; max-width: 11px; }
.f-body .vit-sup .m-icon {
  width: 10px; height: 10px; min-width: 10px; max-width: 10px;
}

.f-body-b,
.f-body-b2 {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  column-gap: 6px;
  align-items: center;
}
.f-stem { grid-column: 1; }
.f-main {
  grid-column: 2; min-width: 0;
  display: flex; flex-direction: column; row-gap: 6px;
}
.f-body-b2 .f-main { row-gap: 5px; }
.fleet.fleet-seven > .ship > .f-body-b .f-main { row-gap: 4px; }
.fleet.fleet-seven > .ship > .f-body-b2 .f-main { row-gap: 3px; }
.f-body-b .f-row1 {
  grid-template-columns: minmax(0, 1fr) 134px 32px 44px;
}
.f-body-b .f-hp-cluster { width: 134px; min-width: 134px; max-width: 134px; }
.f-body-b .f-hpbar { width: 72px; min-width: 72px; max-width: 72px; height: 9px; }

.f-body-b2 .f-row1 {
  display: flex;
  align-items: center;
  column-gap: 6px;
  width: 100%;
  min-height: 16px;
}
.f-body-b2 .f-id {
  display: flex; align-items: baseline; gap: 4px;
  flex: 1 0 auto; min-width: 0;
}
.f-body-b2 .f-id .f-lv {
  display: inline-flex; align-items: baseline;
  width: 32px; min-width: 32px; max-width: 32px; flex: none;
  font-size: 10px; font-weight: 400; color: var(--dim);
}
.f-body-b2 .f-id .f-name {
  flex: none; font-weight: 600;
  overflow: visible; white-space: nowrap;
}
.f-body-b2 .f-aux {
  display: flex; align-items: baseline; gap: 6px;
  flex: 0 0 auto; margin-left: auto;
}
.f-body-b2 .f-ops {
  display: inline-flex; align-items: baseline; gap: 4px;
  flex: none; white-space: nowrap;
}
.f-body-b2 .f-ops:empty { display: none; }
.f-body-b2 .f-supply {
  width: 72px; min-width: 72px; max-width: 72px;
}
.f-body-b2 .sup-f,
.f-body-b2 .sup-a {
  display: inline-flex; align-items: center; gap: 1px;
  min-width: 0;
}
.f-body-b2 .sup-n {
  display: inline-block;
  box-sizing: content-box;
  width: 3ch; min-width: 3ch; max-width: 3ch;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.f-body-b2 .f-row2 {
  width: 100%;
  grid-template-columns: minmax(0, 1fr) 32px 221px;
  justify-items: stretch;
}
.f-body-b2 .f-hp-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%; min-width: 0; max-width: none;
  justify-content: center;
}
.f-body-b2 .f-hp {
  display: flex; align-items: baseline; justify-content: flex-start;
  width: auto; min-width: 0; max-width: none;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.f-body-b2 .f-hp .hp-num {
  box-sizing: content-box;
  width: 3ch; min-width: 3ch; max-width: 3ch;
  text-align: left;
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.f-body-b2 .f-hp .hp-max {
  min-width: 4ch;
  text-align: left;
}
.f-body-b2 .f-hpbar {
  width: 100%; min-width: 0; max-width: none; height: 5px;
}
.f-body-b2 .f-cond {
  width: 32px; min-width: 32px; max-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.f-body-b2 .f-state {
  box-sizing: border-box;
  flex: 0 0 34px;
  width: 34px; min-width: 34px; max-width: 34px;
  height: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.f-body-b2 .f-state .taiha-hp-mark,
.f-body-b2 .f-state .dock-mark,
.f-body-b2 .f-state .esc-tag {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  width: 34px; min-width: 34px; max-width: 34px;
  height: 16px; min-height: 16px;
  padding: 0;
  border-width: 1px;
  border-style: solid;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  overflow: hidden;
  white-space: nowrap;
}
.f-body-b2 .f-state .esc-tag {
  color: var(--text);
  border-color: var(--line);
  background: color-mix(in srgb, var(--line) 18%, transparent);
}
.f-body-b2 .f-state .i18n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* 整列退避變暗時，退避標籤維持可讀對比，不跟著吃 0.5 透明度。 */
.ship:has(.f-body-b2).escaped { opacity: 1; }
.ship:has(.f-body-b2).escaped .f-stem,
.ship:has(.f-body-b2).escaped .f-id,
.ship:has(.f-body-b2).escaped .f-aux,
.ship:has(.f-body-b2).escaped .f-row2 { opacity: 0.5; }

.f-body-c .f-row1 {
  grid-template-columns: 32px minmax(0, 1fr) 56px 32px 44px;
}
.f-body-c { row-gap: 1px; }
.fleet.fleet-seven > .ship > .f-body-c { row-gap: 1px; }
.f-hp-rule {
  height: 4px; width: 100%; background: var(--line); border-radius: 2px;
  overflow: hidden; flex: none;
}
.fleet.fleet-seven .f-hp-rule { height: 2px; }
.f-hp-rule > i { display: block; height: 100%; background: #58a55c; }
.st-minor .f-hp-rule > i { background: var(--dmg-minor); }
.st-mid .f-hp-rule > i { background: var(--dmg-mid); }
.st-major .f-hp-rule > i { background: var(--dmg-major); }

.st-major:not(.in-dock) .f-name { color: var(--dmg-major); font-weight: 600; }

body.show-heat .f-sweep-1 {
  background: color-mix(in srgb, #d4654a 22%, transparent);
  border-radius: 3px;
}
body.show-heat .f-sweep-2 {
  background: color-mix(in srgb, #b8894a 20%, transparent);
  border-radius: 3px;
}
body.show-heat .f-stem {
  background: color-mix(in srgb, #2f7a6e 32%, transparent);
}
body.show-heat .f-status:empty,
body.show-heat .f-state:empty {
  outline: 1px dashed color-mix(in srgb, var(--stub) 50%, transparent);
  outline-offset: -1px;
  min-height: 14px;
}
body.show-heat .ship { position: relative; }
body.show-heat .ship-body,
body.show-heat .f-body { isolation: isolate; }
body.show-heat .ship::after {
  content: "盲區";
  position: absolute; right: 6px; bottom: 2px;
  width: 18%; min-width: 48px; height: 38%;
  box-sizing: border-box;
  border: 1px dashed var(--stub); border-radius: 3px;
  color: var(--stub); font-size: 9px; letter-spacing: var(--track-tag);
  display: flex; align-items: flex-end; justify-content: flex-end;
  padding: 2px 4px; pointer-events: none;
}
`;

setLang('zh-TW');

const page = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>單艦隊艦列 F 型預覽</title>
<style>${css}${extraCss}</style>
</head>
<body>
  <p class="pv-intro">
    <b>單艦隊艦列（已落地 B′）</b>
    左欄為正式程式。原方案 B 仍並陳對照。B′ 維持艦種脊垂直置中；Lv 貼在艦名左側；HP／士氣在艦名下方從艦種脊右側填滿到裝備列。
  </p>
  <div class="pv-fdiag" aria-hidden="true">
    <div class="pv-fgrid">
      <b class="s1"></b><b class="s1"></b><b class="s1b"></b><b class="s1c"></b><b class="blind"></b><b class="blind"></b>
      <b class="s2"></b><b class="s2"></b><b class="s2b"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b>
      <b class="stem"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b>
      <b class="stem"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b>
      <b class="stem"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b><b class="blind"></b>
    </div>
    <p class="pv-fleg">
      <b class="c1">第一橫掃</b>　頂列左→右完整掃描（左熱、右仍看得到但較弱）<br>
      <b class="c2">第二橫掃</b>　往下後再掃一次，但明顯更短，停在左中段<br>
      <b class="c3">垂直掃描</b>　沿左緣快速往下（跨艦看艦種／艦名）<br>
      <b class="c4">盲區</b>　右下幾乎掃不到——現況的士氣／油彈正落在這裡
    </p>
  </div>
  <div class="pv-bar">
    <div class="pv-bar-group">
      <label>語系</label>
      <button type="button" data-lang="zh-TW" class="on">台灣華語</button>
      <button type="button" data-lang="en">English</button>
      <button type="button" data-lang="ja">日本語</button>
    </div>
    <div class="pv-bar-group">
      <label>艦數</label>
      <button type="button" data-n="6">六船</button>
      <button type="button" data-n="7" class="on">七船</button>
    </div>
    <div class="pv-bar-group">
      <label>主題</label>
      <button type="button" data-theme>亮／暗</button>
      <button type="button" data-heat>熱區示意</button>
    </div>
  </div>
  <div class="pv-grid" id="grid"></div>
<script>
const FLEETS = {
  current: { 6: ${JSON.stringify(fleetHtml('current', false))}, 7: ${JSON.stringify(fleetHtml('current', true))} },
  b: { 6: ${JSON.stringify(fleetHtml('b', false))}, 7: ${JSON.stringify(fleetHtml('b', true))} },
  b2: { 6: ${JSON.stringify(fleetHtml('b2', false))}, 7: ${JSON.stringify(fleetHtml('b2', true))} },
};
const COLS = [
  { id: 'current', title: '現況（已落地 B′）', scan: [['艦種脊垂直置中', 'p3'], ['Lv 貼艦名｜油彈殘量｜狀態槽', 'p1'], ['HP 填滿名下到裝備列', 'p2']],
    note: '正式單隊列：大破／入渠／退避同一 34px 槽。英文退避簡作 Esc。油彈顯示殘量。退避標籤不跟著整艦變暗。' },
  { id: 'b', title: '方案 B · 原案（對照）', scan: [['左緣艦種垂直置中', 'p3'], ['艦名｜HP＋72px 血條｜士氣｜狀態', 'p1'], ['次列 Lv｜油彈｜裝備', 'p2']],
    note: '上一輪選定的 B：艦種脊跨兩列垂直置中；HP 儀在首列艦名右側。此欄只作對照，沒有套用後來那三點修改。' },
  { id: 'b2', title: '方案 B′ · 名下 HP 填滿', scan: [['艦種脊仍垂直置中', 'p3'], ['Lv 貼艦名｜油彈｜狀態槽', 'p1'], ['HP 填滿名下到裝備列', 'p2']],
    note: '大破／入渠／退避同一 34px 槽。英文退避簡作 Esc。油彈顯示殘量（3ch 對齊）。退避標籤不跟著整艦變暗。' },
];
let n = 7;
function measure(col, fleet) {
  const ships = [...fleet.querySelectorAll(':scope > .ship')];
  const heights = ships.map(s => s.getBoundingClientRect().height);
  const sum = heights.reduce((a, b) => a + b, 0);
  const first = heights[0] || 0;
  const same = heights.every(h => Math.abs(h - first) < 0.6);
  const cur = document.querySelector('.pv-col[data-id="current"] .fleet');
  const curShips = cur ? [...cur.querySelectorAll(':scope > .ship')] : [];
  const curSum = curShips.reduce((a, s) => a + s.getBoundingClientRect().height, 0);
  const kind = col.dataset.id;
  const delta = kind === 'current' ? 0 : sum - curSum;
    const hpEls = [...fleet.querySelectorAll('.f-hp, .ship-hp .hp-num')];
  const hpXs = hpEls.map(el => Math.round(el.getBoundingClientRect().left));
  const hpSpread = hpXs.length ? Math.max(...hpXs) - Math.min(...hpXs) : 0;
  const ok = Math.abs(delta) <= 4;
  const el = col.querySelector('.pv-measure');
  el.className = 'pv-measure ' + (ok ? 'ok' : 'over');
  const tagEls = [...fleet.querySelectorAll('.f-state .taiha-hp-mark, .f-state .dock-mark, .f-state .esc-tag, .ship-state .taiha-hp-mark, .ship-state .dock-mark, .ship-state .esc-tag')];
  const tagWs = tagEls.map(el => Math.round(el.getBoundingClientRect().width * 10) / 10);
  const tagSpread = tagWs.length ? Math.max(...tagWs) - Math.min(...tagWs) : 0;
  const supNs = [...fleet.querySelectorAll('.f-supply .sup-n, .ship-aux .sup-n')];
  const fuelXs = supNs.filter((_, i) => i % 2 === 0).map(el => Math.round(el.getBoundingClientRect().left));
  const ammoXs = supNs.filter((_, i) => i % 2 === 1).map(el => Math.round(el.getBoundingClientRect().left));
  const fuelSpread = fuelXs.length ? Math.max(...fuelXs) - Math.min(...fuelXs) : 0;
  const ammoSpread = ammoXs.length ? Math.max(...ammoXs) - Math.min(...ammoXs) : 0;
  const lvXs = [...fleet.querySelectorAll('.f-id .f-lv-n, .ship-id .lv-n')].map(el => Math.round(el.getBoundingClientRect().left));
  const lvSpread = lvXs.length ? Math.max(...lvXs) - Math.min(...lvXs) : 0;
  const nameXs = [...fleet.querySelectorAll('.f-id .f-name, .ship-id > .grow')].map(el => Math.round(el.getBoundingClientRect().left));
  const nameSpread = nameXs.length ? Math.max(...nameXs) - Math.min(...nameXs) : 0;
  const stateRights = [...fleet.querySelectorAll('.f-state, .ship-state')].map(el => Math.round(el.getBoundingClientRect().right));
  const exRights = [...fleet.querySelectorAll('.chips .ex')].map(el => Math.round(el.getBoundingClientRect().right));
  const exStateDelta = (stateRights.length && exRights.length)
    ? Math.round((Math.max(...stateRights) - Math.max(...exRights)) * 10) / 10 : 0;
  el.innerHTML = '單列 <b>' + first.toFixed(1) + 'px</b> · ' + ships.length +
    ' 船合計 <b>' + sum.toFixed(1) + 'px</b>' +
    (kind === 'current' ? '' : ' · 相對現況 <b>' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'px</b>') +
    (same ? '' : ' · 列高不一致') +
    ' · HP x 差 <b>' + hpSpread + 'px</b>' +
    (kind === 'b2' || kind === 'current' ? ' · 標籤寬差 <b>' + tagSpread + 'px</b> · 油 x 差 <b>' + fuelSpread + 'px</b> · 彈 x 差 <b>' + ammoSpread + 'px</b> · Lv x 差 <b>' + lvSpread + 'px</b> · 艦名 x 差 <b>' + nameSpread + 'px</b> · 狀態／打洞右緣 <b>' + (exStateDelta >= 0 ? '+' : '') + exStateDelta + 'px</b>' : '');
}
function render() {
  const grid = document.getElementById('grid');
  grid.innerHTML = COLS.map(c =>
    '<div class="pv-col" data-id="' + c.id + '">' +
      '<div class="pv-col-label">' + c.title + '</div>' +
      '<div class="pv-scan">' + c.scan.map(([lab, k]) => '<i class="' + k + '">' + lab + '</i>').join('') + '</div>' +
      '<p class="pv-col-note">' + c.note + '</p>' +
      '<div class="pv-frame">' + FLEETS[c.id][n] + '</div>' +
      '<div class="pv-measure"></div>' +
    '</div>'
  ).join('');
  requestAnimationFrame(() => {
    COLS.forEach(c => {
      const col = document.querySelector('.pv-col[data-id="' + c.id + '"]');
      measure(col, col.querySelector('.fleet'));
    });
  });
}
document.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => {
  document.documentElement.lang = btn.dataset.lang;
  document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', b === btn));
  requestAnimationFrame(() => {
    COLS.forEach(c => {
      const col = document.querySelector('.pv-col[data-id="' + c.id + '"]');
      if (col) measure(col, col.querySelector('.fleet'));
    });
  });
}));
document.querySelectorAll('[data-n]').forEach(btn => btn.addEventListener('click', () => {
  n = Number(btn.dataset.n);
  document.querySelectorAll('[data-n]').forEach(b => b.classList.toggle('on', b === btn));
  render();
}));
document.querySelector('[data-theme]').addEventListener('click', () => {
  const on = document.documentElement.getAttribute('data-theme') === 'light';
  if (on) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
});
document.querySelector('[data-heat]').addEventListener('click', (ev) => {
  document.body.classList.toggle('show-heat');
  ev.currentTarget.classList.toggle('on', document.body.classList.contains('show-heat'));
});
render();
</script>
</body></html>`;

const outDir = resolve(root, '.preview');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'ship-row-f-pattern.html');
writeFileSync(outPath, page
    .replace(/src="\/icons\//g, 'src="../public/icons/')
    .replace(/src=\\"\/icons\//g, 'src=\\"../public/icons/'));
console.log(outPath);
